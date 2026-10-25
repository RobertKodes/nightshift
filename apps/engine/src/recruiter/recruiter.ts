import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeAtomic } from "../atomic.js";
import { safeFetch } from "../net.js";
import { DAY, HOUR, MIN, fmtLocal, local, localToUtc, nextDay, stamp, utcDay } from "./clock.js";
import { type Candidate, DEFAULT_QUERIES, type Fetch, imdLaunches, searchGithub } from "./discover.js";
import { type Fit, qualify } from "./qualify.js";
import { type SitePath, allowedLink, clean, isAddress, isSitePath, linksOk, redact } from "./safety.js";
import { followUp, invitation, post } from "./templates.js";

/**
 * NIGHTSHIFT's recruitment operator. It runs inside the engine and keeps going on its own:
 * every 6 hours it reads public APIs for builders and agent operators who fit a crew, scores them
 * with reasons, prepares invitations from fixed templates, posts real highlights on our own
 * channels, follows the funnel by ref tag, and sends the owner a digest at 09:00 Bucharest.
 *
 * It cannot pay, reach a shell or the treasury, or open any URL of its choosing: it reads two
 * public hosts, writes links only from the allowlist in safety.ts, and talks only through the
 * channel adapters it was given. First-contact invitations need the owner's approval and a channel
 * that welcomes suggestions (none by default). GitHub is read-only.
 */

export type ChannelName = "telegram" | "bluesky";
export const CHANNELS: readonly ChannelName[] = ["telegram", "bluesky"];
export type LinkButton = { text: string; url: string };
/** The engine's Telegram chat. Text is plain: send it without an HTML parse mode, or escape it. */
export type TelegramAdapter = { send(text: string, buttons?: LinkButton[][]): Promise<{ id: string }>; welcomesSuggestions?: boolean };
/** The project's Bluesky account. `link` is the same link the text carries (for a card). */
export type BlueskyAdapter = { post(text: string, link?: string): Promise<{ id: string }>; welcomesSuggestions?: boolean };
/**
 * A missing adapter means that channel is off ("blocked: no credentials"). `welcomesSuggestions`
 * marks a published collaboration channel or public discussion that explicitly welcomes
 * suggestions: the only place a first-contact invitation may go.
 */
export type Channels = { telegram?: TelegramAdapter; bluesky?: BlueskyAdapter };

/** An adapter throws this when it cannot tell whether the message went out: the item is never resent. */
export class SendUnknown extends Error { readonly unknown = true; }

/** Something real worth sharing: jobs completed today, an operator activated, a new public sample. */
export type Highlight = { id: string; text: string; path?: SitePath; address?: string | null };
export type FunnelCounts = { visits: number; freeResults: number; firstPaid: number; repeat: number };
/** ref tag → funnel counts, from the site's own records. */
export type Attribution = (refs: string[]) => Promise<Record<string, Partial<FunnelCounts>>> | Record<string, Partial<FunnelCounts>>;

export type Settings = {
  paused: boolean;
  /** Emergency stop: nothing runs and every queued send was cancelled. Cleared by setPaused(false). */
  stopped: boolean;
  /** Run every cycle without sending or drafting anything. */
  dryRun: boolean;
  /** The owner's on/off switch per channel. */
  channels: Record<ChannelName, boolean>;
  discoverEveryHours: number;
  highlightsEveryMinutes: number;
  attributionEveryMinutes: number;
  postsPerPlatformPerDay: number;
  minPostGapMinutes: number;
  firstContactsPerDay: number;
  orgCooldownDays: number;
  minScore: number;
  maxPendingDrafts: number;
  maxOpportunities: number;
  /** The digest's hour on the Bucharest clock. */
  digestHour: number;
  /** Nothing may spend on models without a budget; the templates need none. */
  modelBudgetUsd: number;
  /** Optional GitHub token for a higher search quota. Kept in memory only, never saved or shown. */
  githubToken: string;
  githubQueries: string[];
  sendTimeoutMs: number;
};

export const DEFAULT_SETTINGS: Settings = {
  paused: false, stopped: false, dryRun: false,
  channels: { telegram: true, bluesky: true },
  discoverEveryHours: 6, highlightsEveryMinutes: 60, attributionEveryMinutes: 60,
  postsPerPlatformPerDay: 2, minPostGapMinutes: 60, firstContactsPerDay: 3, orgCooldownDays: 30,
  minScore: 55, maxPendingDrafts: 20, maxOpportunities: 500, digestHour: 9,
  modelBudgetUsd: 0, githubToken: "", githubQueries: [...DEFAULT_QUERIES], sendTimeoutMs: 60_000,
};

export type OppStatus = "new" | "qualified" | "rejected" | "drafted" | "contacted" | "responded" | "opted_out";
export type Opportunity = Omit<Candidate, "key"> & {
  id: string; ref: string; crew: Fit | null; score: number; reasons: string[]; status: OppStatus;
  discoveredAt: number; updatedAt: number; contactedAt: number | null; respondedAt: number | null; followUpDrafted: boolean;
};

export type ItemKind = "post" | "first_contact" | "follow_up";
export type ItemStatus = "awaiting_approval" | "queued" | "sending" | "sent" | "failed" | "unknown" | "skipped" | "cancelled";
export type OutboxItem = {
  id: string;
  /** Idempotency key: channel:kind:subject:day. */
  key: string;
  channel: ChannelName | "none";
  kind: ItemKind;
  /** The opportunity id, or the highlight id for a post. */
  subject: string;
  org: string | null;
  text: string; link: string; ref: string; day: string;
  status: ItemStatus; approved: boolean; attempts: number; nextAttemptAt: number;
  /** Its cap and cooldown slot is taken (from the first attempt on). */
  counted: boolean;
  blocked: string | null; lastError: string | null; note: string | null; remoteId: string | null;
  createdAt: number; updatedAt: number; sentAt: number | null;
};

export type Run = {
  at: number; trigger: "tick" | "manual"; dryRun: boolean;
  discovered: number; qualified: number; drafted: number; highlights: number; sent: number; failed: number;
  wouldSend: { id: string; channel: string; kind: ItemKind; subject: string }[];
  notes: string[];
};

type DayCount = { posts: number; firstContacts: number; followUps: number; lastPostAt: number };
type State = {
  v: 1;
  settings: Partial<Settings>;
  discover: { lastAt: number; githubBackoffUntil: number; githubStrikes: number };
  highlightsAt: number; attributionAt: number;
  /** The Bucharest date of the last digest. */
  digestDay: string;
  opportunities: Opportunity[];
  outbox: OutboxItem[];
  runs: Run[];
  counters: Record<string, Partial<Record<ChannelName, DayCount>>>;
  /** org → when it was last sent a first contact. */
  contacted: Record<string, number>;
  optOuts: string[];
  /** Highlight ids already used per channel: one highlight is never posted twice. */
  posted: Record<ChannelName, string[]>;
  funnel: Record<string, FunnelCounts & { updatedAt: number }>;
  breakers: Record<ChannelName, { failures: number; openUntil: number }>;
  costs: { modelUsd: number };
};

export type RecruiterOptions = {
  file: string;
  now?: () => number;
  fetch?: Fetch;
  channels: Channels;
  notifyOwner: (text: string) => unknown;
  highlights: () => Highlight[] | Promise<Highlight[]>;
  attribution: Attribution;
  settings?: Partial<Settings>;
  log?: (line: string) => void;
};

const KEEP_RUNS = 200, KEEP_DONE = 500, KEEP_DAYS = 40;
const OPEN: ItemStatus[] = ["awaiting_approval", "queued"];
const LIVE: ItemStatus[] = ["sending", "sent", "unknown"];
const keyOf = (channel: string, kind: ItemKind, subject: string, day: string) => `${channel}:${kind}:${subject}:${day}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1e9) : 0);
const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const PROVIDER_MS = 30_000;

/** Runs `call`, failing with `late()` if it has not answered in `ms`: a hung provider never blocks the recruiter. */
function within<T>(call: () => T | Promise<T>, ms: number, late: () => Error): Promise<T> {
  return new Promise<T>((ok, fail) => {
    const t = setTimeout(() => fail(late()), ms);
    t.unref?.();
    Promise.resolve().then(call).then((v) => { clearTimeout(t); ok(v); }, (e: unknown) => { clearTimeout(t); fail(e); });
  });
}

/** Defaults, then the engine's settings, inside hard limits no setting can pass. */
function resolve(over: Partial<Settings> = {}): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, ...over, channels: { ...DEFAULT_SETTINGS.channels, ...(over.channels ?? {}) } };
  s.postsPerPlatformPerDay = clamp(s.postsPerPlatformPerDay, 0, 4, 2);
  s.firstContactsPerDay = clamp(s.firstContactsPerDay, 0, 5, 3);
  s.orgCooldownDays = clamp(s.orgCooldownDays, 30, 365, 30);
  s.discoverEveryHours = clamp(s.discoverEveryHours, 1, 48, 6);
  s.highlightsEveryMinutes = clamp(s.highlightsEveryMinutes, 1, 1440, 60);
  s.attributionEveryMinutes = clamp(s.attributionEveryMinutes, 5, 1440, 60);
  s.minPostGapMinutes = clamp(s.minPostGapMinutes, 0, 720, 60);
  s.minScore = clamp(s.minScore, 0, 100, 55);
  s.maxPendingDrafts = clamp(s.maxPendingDrafts, 0, 100, 20);
  s.maxOpportunities = clamp(s.maxOpportunities, 50, 2000, 500);
  s.digestHour = Math.floor(clamp(s.digestHour, 0, 23, 9));
  s.modelBudgetUsd = clamp(s.modelBudgetUsd, 0, 1000, 0);
  s.sendTimeoutMs = clamp(s.sendTimeoutMs, 1000, 300_000, 60_000);
  s.githubToken = typeof s.githubToken === "string" ? s.githubToken.trim() : "";
  s.githubQueries = (Array.isArray(s.githubQueries) ? s.githubQueries : DEFAULT_QUERIES).filter((q) => typeof q === "string" && q.trim()).map((q) => q.slice(0, 200)).slice(0, 10);
  s.paused = s.paused === true; s.stopped = s.stopped === true; s.dryRun = s.dryRun === true;
  return s;
}

function blank(): State {
  return {
    v: 1, settings: {}, discover: { lastAt: 0, githubBackoffUntil: 0, githubStrikes: 0 }, highlightsAt: 0, attributionAt: 0, digestDay: "",
    opportunities: [], outbox: [], runs: [], counters: {}, contacted: {}, optOuts: [], posted: { telegram: [], bluesky: [] }, funnel: {},
    breakers: { telegram: { failures: 0, openUntil: 0 }, bluesky: { failures: 0, openUntil: 0 } }, costs: { modelUsd: 0 },
  };
}

/** The saved state (or its backup), with anything missing filled in. `corrupt` when the main file could not be read. */
function load(file: string): { state: State; corrupt: boolean; fromBackup: boolean } {
  let corrupt = false, fromBackup = false;
  for (const f of [file, `${file}.bak`]) {
    if (!existsSync(f)) continue;
    try {
      const raw = JSON.parse(readFileSync(f, "utf8")) as Partial<State>;
      const b = blank();
      const st: State = { ...b, ...raw, v: 1 } as State;
      st.discover = { ...b.discover, ...(raw.discover ?? {}) };
      st.posted = { ...b.posted, ...(raw.posted ?? {}) };
      st.breakers = { ...b.breakers, ...(raw.breakers ?? {}) };
      st.costs = { ...b.costs, ...(raw.costs ?? {}) };
      for (const k of ["opportunities", "outbox", "runs", "optOuts"] as const) if (!Array.isArray(st[k])) (st[k] as unknown[]) = [];
      for (const k of ["counters", "contacted", "funnel", "settings"] as const) if (!st[k] || typeof st[k] !== "object") (st[k] as object) = {};
      return { state: st, corrupt, fromBackup };
    } catch { corrupt = true; fromBackup = true; }
  }
  return { state: blank(), corrupt, fromBackup: false };
}

export class Recruiter {
  readonly #file: string;
  readonly #clock: () => number;
  readonly #fetch: Fetch;
  readonly #channels: Channels;
  readonly #notify: (text: string) => unknown;
  readonly #highlights: () => Highlight[] | Promise<Highlight[]>;
  readonly #attribution: Attribution;
  readonly #out: (line: string) => void;
  #s: Settings;
  #st: State;
  #busy = false;

  constructor(o: RecruiterOptions) {
    this.#file = o.file;
    this.#clock = o.now ?? Date.now;
    this.#fetch = o.fetch ?? (async (url, init) => { const r = await safeFetch(url, init); if (!r) throw new Error("the address was refused"); return r; });
    this.#channels = { ...o.channels };
    this.#notify = o.notifyOwner;
    this.#highlights = o.highlights;
    this.#attribution = o.attribution;
    this.#out = o.log ?? ((line) => console.log(line));
    this.#s = resolve(o.settings);
    try { mkdirSync(dirname(o.file), { recursive: true }); } catch { /* writeAtomic will say */ }
    const { state, corrupt, fromBackup } = load(o.file);
    this.#st = state;
    // the backup is one save behind (a send may already have gone out): start paused for the owner to check
    if (corrupt) this.#log(fromBackup ? "the state file could not be read: restored the backup and starting paused" : "the state file could not be read: starting paused with an empty state");
    // the owner's switches survive a restart; limits come from the code and the engine's settings
    const p = state.settings;
    if (typeof p.paused === "boolean") this.#s.paused = p.paused;
    if (typeof p.stopped === "boolean") this.#s.stopped = p.stopped;
    for (const c of CHANNELS) if (typeof p.channels?.[c] === "boolean") this.#s.channels[c] = p.channels[c];
    if (corrupt) this.#s.paused = true;
    // a send that was in flight when the engine stopped is never repeated: the owner reconciles it
    const now = this.#clock();
    for (const it of state.outbox) {
      if (it.status !== "sending") continue;
      it.status = "unknown"; it.updatedAt = now;
      it.note = "The engine stopped during this send, so it may or may not have gone out. It is never resent: check the channel, then skip it.";
      this.#log(`send ${it.id} on ${it.channel} has an unknown result after a restart`);
    }
    this.#save();
  }

  // ------------------------------------------------------------------ running

  /** Called every minute. Cheap when nothing is due; never throws. */
  async tick(at?: number): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const now = at ?? this.#clock();
      await this.#maybeDigest(now);
      const s = this.#s;
      if (s.paused || s.stopped) return;
      const discover = now >= this.#st.discover.lastAt + s.discoverEveryHours * HOUR;
      const highlights = now >= this.#st.highlightsAt + s.highlightsEveryMinutes * MIN;
      const attribution = now >= this.#st.attributionAt + s.attributionEveryMinutes * MIN;
      // a dry run sends nothing, so a queued item would stay "due": dry runs go by the schedule only
      if (!discover && !highlights && !attribution && (s.dryRun || !this.#anySendable(now))) return;
      await this.#cycle(now, { trigger: "tick", dryRun: s.dryRun, discover, highlights, attribution });
    } catch (e) {
      this.#log(`tick failed: ${msg(e)}`);
    } finally {
      this.#busy = false;
    }
  }

  /** One full cycle now. A dry run reads and scores for real but drafts and sends nothing. */
  async runCycle(o: { dryRun?: boolean } = {}): Promise<{ ok: boolean; error?: string; run?: Run }> {
    if (this.#busy) return { ok: false, error: "A cycle is already running." };
    const dryRun = o.dryRun ?? this.#s.dryRun;
    if (!dryRun && (this.#s.paused || this.#s.stopped)) return { ok: false, error: this.#s.stopped ? "Stopped: resume first (pause off)." : "Paused: resume first." };
    this.#busy = true;
    try {
      const now = this.#clock();
      const discover = now >= this.#st.discover.lastAt + this.#s.discoverEveryHours * HOUR;
      return { ok: true, run: await this.#cycle(now, { trigger: "manual", dryRun, discover, highlights: true, attribution: true }) };
    } catch (e) {
      this.#log(`cycle failed: ${msg(e)}`);
      return { ok: false, error: this.#redact(msg(e)) };
    } finally {
      this.#busy = false;
    }
  }

  async #cycle(now: number, o: { trigger: Run["trigger"]; dryRun: boolean; discover: boolean; highlights: boolean; attribution: boolean }): Promise<Run> {
    const run: Run = { at: now, trigger: o.trigger, dryRun: o.dryRun, discovered: 0, qualified: 0, drafted: 0, highlights: 0, sent: 0, failed: 0, wouldSend: [], notes: [] };
    if (!o.dryRun) this.#expire(now);
    if (o.discover) { await this.#discover(now, run); this.#qualifyAll(now, run); }
    if (!this.#s.stopped) {
      this.#prepareContacts(now, run, o.dryRun);
      if (o.highlights) await this.#preparePosts(now, run, o.dryRun);
      await this.#distribute(now, run, o.dryRun);
    }
    if (o.attribution) await this.#refreshFunnel(now, run);
    this.#prune();
    if (o.trigger === "manual" || o.discover || run.drafted || run.sent || run.failed || run.wouldSend.length || run.notes.length) {
      this.#st.runs.push(run);
      if (this.#st.runs.length > KEEP_RUNS) this.#st.runs.splice(0, this.#st.runs.length - KEEP_RUNS);
    }
    this.#save();
    return run;
  }

  // ------------------------------------------------------------------ discover and qualify

  async #discover(now: number, run: Run): Promise<void> {
    const d = this.#st.discover;
    d.lastAt = now;
    const found: Candidate[] = [];
    if (now < d.githubBackoffUntil) this.#note(run, `GitHub skipped: backing off until ${fmtLocal(d.githubBackoffUntil)} Bucharest`);
    else {
      const g = await searchGithub(this.#fetch, this.#s.githubQueries, now, this.#s.githubToken).catch((e) => ({ candidates: [], errors: [msg(e)], limited: null, calls: 0 }));
      found.push(...g.candidates);
      for (const e of g.errors.slice(0, 3)) this.#note(run, e);
      if (g.limited) {
        if (g.limited.hard) d.githubStrikes = Math.min(d.githubStrikes + 1, 10);
        const backoff = g.limited.hard ? Math.min(6 * HOUR, 15 * MIN * 2 ** (d.githubStrikes - 1)) : 0;
        d.githubBackoffUntil = Math.max(g.limited.until ?? 0, now + backoff);
        this.#note(run, `GitHub rate limit: no more searches until ${fmtLocal(d.githubBackoffUntil)} Bucharest`);
      } else if (!g.errors.length) d.githubStrikes = 0;
    }
    try { found.push(...(await imdLaunches(this.#fetch, now))); } catch (e) { this.#note(run, `IMD launches: ${msg(e)}`); }
    const byId = new Map(this.#st.opportunities.map((x) => [x.id, x]));
    for (const c of found) {
      const id = c.source === "imd" ? `imd-${c.key.slice(4)}` : `gh-${createHash("sha256").update(c.key).digest("hex").slice(0, 10)}`;
      const { key: _key, ...facts } = c;
      const had = byId.get(id);
      if (had) { Object.assign(had, facts, { address: c.address ?? had.address, updatedAt: now }); continue; }
      const o: Opportunity = {
        ...facts, id, ref: `rc-${id}`, crew: null, score: 0, reasons: [], status: this.#st.optOuts.includes(c.org) ? "opted_out" : "new",
        discoveredAt: now, updatedAt: now, contactedAt: null, respondedAt: null, followUpDrafted: false,
      };
      this.#st.opportunities.push(o);
      byId.set(id, o);
      run.discovered++;
    }
  }

  #qualifyAll(now: number, run: Run): void {
    const channel = this.#suggestionChannel();
    for (const o of this.#st.opportunities) {
      if (o.status !== "new" && o.status !== "qualified" && o.status !== "rejected") continue;
      if (this.#st.optOuts.includes(o.org)) { o.status = "opted_out"; continue; }
      const q = qualify(o, now, { channel, minScore: this.#s.minScore });
      if (q.qualified && o.status !== "qualified") run.qualified++;
      Object.assign(o, { score: q.score, reasons: q.reasons, crew: q.crew, status: q.qualified ? "qualified" : "rejected" });
    }
  }

  // ------------------------------------------------------------------ prepare

  /** Invitations for qualified prospects (one open draft per organization), and the one follow-up for those who answered. */
  #prepareContacts(now: number, run: Run, dryRun: boolean): void {
    const st = this.#st, s = this.#s;
    const open = st.outbox.filter((i) => i.kind === "first_contact" && OPEN.includes(i.status));
    const busyOrgs = new Set(open.map((i) => i.org));
    let pending = open.length;
    const ready = st.opportunities.filter((o) => o.status === "qualified" && o.crew).sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
    for (const o of ready) {
      if (pending >= s.maxPendingDrafts) break;
      if (busyOrgs.has(o.org) || st.optOuts.includes(o.org)) continue;
      const last = st.contacted[o.org];
      if (last && now - last < s.orgCooldownDays * DAY) continue;
      if (st.outbox.some((i) => i.kind === "first_contact" && i.subject === o.id)) continue;
      let m: { text: string; link: string };
      try { m = invitation({ source: o.source, name: o.name, crew: o.crew!, ref: o.ref, address: o.address }); } catch (e) { this.#note(run, `no invitation for ${o.id}: ${msg(e)}`); continue; }
      busyOrgs.add(o.org); pending++;
      if (dryRun) { run.notes.push(`would draft an invitation for ${o.name}`); continue; }
      if (this.#add({ kind: "first_contact", channel: this.#suggestionChannel() ?? "none", subject: o.id, org: o.org, ref: o.ref, ...m, status: "awaiting_approval", approved: false }, now)) {
        o.status = "drafted"; o.updatedAt = now; run.drafted++;
      }
    }
    for (const o of st.opportunities) {
      if (o.status !== "responded" || !o.crew || o.followUpDrafted || st.optOuts.includes(o.org)) continue;
      let m: { text: string; link: string };
      try { m = followUp({ crew: o.crew, ref: o.ref, address: o.address }); } catch (e) { this.#note(run, `no follow-up for ${o.id}: ${msg(e)}`); continue; }
      if (dryRun) { run.notes.push(`would draft a follow-up for ${o.name}`); continue; }
      const channel = (st.outbox.find((i) => i.kind === "first_contact" && i.subject === o.id && i.status === "sent")?.channel) ?? this.#suggestionChannel() ?? "none";
      if (this.#add({ kind: "follow_up", channel, subject: o.id, org: o.org, ref: o.ref, ...m, status: "awaiting_approval", approved: false }, now)) {
        o.followUpDrafted = true; run.drafted++;
      }
    }
  }

  /** Owned-channel posts, only from real highlights; nothing to share means nothing is posted. */
  async #preparePosts(now: number, run: Run, dryRun: boolean): Promise<void> {
    this.#st.highlightsAt = now;
    let list: unknown;
    try { list = await within(() => this.#highlights(), PROVIDER_MS, () => new Error("no answer in 30 s")); } catch (e) { this.#note(run, `highlights failed: ${msg(e)}`); return; }
    const hs = (Array.isArray(list) ? list : []).slice(0, 20).map(validHighlight).filter((h): h is NonNullable<ReturnType<typeof validHighlight>> => h !== null);
    run.highlights = hs.length;
    if (!hs.length) return;
    const day = utcDay(now);
    for (const ch of CHANNELS) {
      const posted = (this.#st.posted[ch] ??= []);
      let today = this.#st.outbox.filter((i) => i.kind === "post" && i.channel === ch && i.day === day && i.status !== "skipped" && i.status !== "cancelled").length;
      for (const h of hs) {
        if (today >= this.#s.postsPerPlatformPerDay) break;
        if (posted.includes(h.id)) continue;
        const p = post({ text: h.text, path: h.path, ref: h.ref, address: h.address });
        if (!p) continue;
        today++;
        if (dryRun) { run.notes.push(`would post highlight ${h.id} on ${ch}`); continue; }
        if (this.#add({ kind: "post", channel: ch, subject: h.id, org: null, ref: h.ref, ...p, status: "queued", approved: true }, now)) {
          posted.push(h.id);
          if (posted.length > 500) posted.splice(0, posted.length - 500);
          run.drafted++;
        }
      }
    }
  }

  #add(x: Pick<OutboxItem, "kind" | "channel" | "subject" | "org" | "ref" | "text" | "link" | "status" | "approved">, now: number): OutboxItem | null {
    const day = utcDay(now);
    const key = keyOf(x.channel, x.kind, x.subject, day);
    if (this.#st.outbox.some((i) => i.key === key)) return null;
    const it: OutboxItem = {
      ...x, id: randomBytes(6).toString("hex"), key, day, attempts: 0, nextAttemptAt: 0, counted: false,
      blocked: null, lastError: null, note: null, remoteId: null, createdAt: now, updatedAt: now, sentAt: null,
    };
    this.#st.outbox.push(it);
    return it;
  }

  // ------------------------------------------------------------------ distribute

  /** The first channel that welcomes suggestions and is on. None by default. */
  #suggestionChannel(): ChannelName | null {
    return CHANNELS.find((c) => this.#channels[c]?.welcomesSuggestions === true && this.#s.channels[c]) ?? null;
  }

  #peek(day: string, ch: ChannelName): DayCount {
    return this.#st.counters[day]?.[ch] ?? { posts: 0, firstContacts: 0, followUps: 0, lastPostAt: 0 };
  }
  #firstToday(day: string): number {
    return CHANNELS.reduce((sum, c) => sum + this.#peek(day, c).firstContacts, 0);
  }
  #channelOf(it: OutboxItem): ChannelName | null {
    return it.kind === "post" ? (it.channel === "none" ? null : it.channel) : this.#suggestionChannel();
  }

  /** Why a queued item cannot go out now, or null when it can. */
  #blocked(it: OutboxItem, now: number): string | null {
    const s = this.#s, st = this.#st;
    if (s.stopped) return "stopped by the owner";
    if (s.paused) return "paused by the owner";
    if (it.kind !== "post" && !it.approved) return "waiting: owner approval";
    if (it.org && st.optOuts.includes(it.org)) return "blocked: opted out";
    const ch = this.#channelOf(it);
    if (!ch) return it.kind === "post" ? "blocked: no channel" : "blocked: no channel that welcomes suggestions";
    if (!this.#channels[ch]) return "blocked: no credentials";
    if (!s.channels[ch]) return "blocked: channel turned off by the owner";
    const br = st.breakers[ch];
    if (br && br.openUntil > now) return `blocked: ${ch} failed 3 times in a row, resting until ${fmtLocal(br.openUntil)} Bucharest`;
    if (it.nextAttemptAt > now) return `retrying at ${fmtLocal(it.nextAttemptAt)} Bucharest`;
    if (ch === "bluesky" && it.text.length > 300) return "blocked: too long for Bluesky (skip it)";
    if (!allowedLink(it.link) || !linksOk(it.text, 1)) return "blocked: link check failed";
    const day = utcDay(now), c = this.#peek(day, ch);
    if (it.kind === "post" && !it.counted) {
      if (c.posts >= s.postsPerPlatformPerDay) return "waiting: today's post cap is reached";
      if (c.lastPostAt && now - c.lastPostAt < s.minPostGapMinutes * MIN) return "waiting: spacing between posts";
    }
    if (it.kind === "first_contact" && !it.counted) {
      if (this.#firstToday(day) >= s.firstContactsPerDay) return "waiting: today's invitation cap is reached";
      const last = it.org ? st.contacted[it.org] : undefined;
      if (last && now - last < s.orgCooldownDays * DAY) return `blocked: this organization had a first contact in the last ${s.orgCooldownDays} days`;
    }
    if (it.kind === "follow_up") {
      if (this.#opp(it.subject)?.status !== "responded") return "blocked: a follow-up goes only to a prospect marked responded";
      if (st.outbox.some((x) => x !== it && x.kind === "follow_up" && x.subject === it.subject && LIVE.includes(x.status))) return "blocked: the one follow-up was already sent";
    }
    return null;
  }

  #anySendable(now: number): boolean {
    return this.#st.outbox.some((i) => i.status === "queued" && this.#blocked(i, now) === null);
  }

  /** Takes the item's cap and cooldown slot. */
  #reserve(it: OutboxItem, ch: ChannelName, now: number): void {
    const day = utcDay(now);
    const c = ((this.#st.counters[day] ??= {})[ch] ??= { posts: 0, firstContacts: 0, followUps: 0, lastPostAt: 0 });
    if (it.kind === "post") { c.posts++; c.lastPostAt = now; }
    else if (it.kind === "first_contact") { c.firstContacts++; if (it.org) this.#st.contacted[it.org] = now; }
    else c.followUps++;
  }

  async #distribute(now: number, run: Run, dryRun: boolean): Promise<void> {
    const queued = this.#st.outbox.filter((i) => i.status === "queued").sort((a, b) => a.createdAt - b.createdAt);
    if (dryRun) {
      // the caps are played forward on a copy, so the dry run shows what one real pass would send
      const saved = { counters: structuredClone(this.#st.counters), contacted: { ...this.#st.contacted } };
      try {
        for (const it of queued) {
          if (this.#blocked(it, now)) continue;
          const ch = this.#channelOf(it)!;
          run.wouldSend.push({ id: it.id, channel: ch, kind: it.kind, subject: it.subject });
          if (!it.counted) this.#reserve(it, ch, now);
        }
      } finally { this.#st.counters = saved.counters; this.#st.contacted = saved.contacted; }
      return;
    }
    for (const it of queued) {
      if (this.#s.paused || this.#s.stopped || it.status !== "queued") continue;
      const why = this.#blocked(it, now);
      if (why) { it.blocked = why; continue; }
      await this.#send(it, this.#channelOf(it)!, now, run);
    }
  }

  async #send(it: OutboxItem, ch: ChannelName, now: number, run: Run): Promise<void> {
    if (it.channel !== ch) { it.channel = ch; it.key = keyOf(ch, it.kind, it.subject, it.day); }
    if (this.#st.outbox.some((x) => x !== it && x.key === it.key && LIVE.includes(x.status))) {
      it.status = "cancelled"; it.note = "a duplicate of an item already sent"; it.updatedAt = now;
      return;
    }
    const before = { status: it.status, attempts: it.attempts };
    it.status = "sending"; it.attempts++; it.updatedAt = now; it.blocked = null;
    if (!it.counted) { this.#reserve(it, ch, now); it.counted = true; }
    // the item is on disk as "sending" before anything leaves: a crash now leaves "unknown", never a resend
    if (!this.#save()) { it.status = before.status; it.attempts = before.attempts; this.#note(run, `${it.id} not sent: the state could not be saved`); return; }
    const br = (this.#st.breakers[ch] ??= { failures: 0, openUntil: 0 });
    try {
      const r = await this.#withTimeout(() => (ch === "telegram" ? this.#channels.telegram!.send(it.text) : this.#channels.bluesky!.post(it.text, it.link)));
      it.status = "sent"; it.sentAt = now; it.remoteId = clean(String((r as { id?: unknown } | undefined)?.id ?? ""), 200) || null;
      br.failures = 0;
      const o = it.kind === "post" ? undefined : this.#opp(it.subject);
      if (o && it.kind === "first_contact") { o.status = "contacted"; o.contactedAt = now; o.updatedAt = now; }
      run.sent++;
      this.#log(`sent ${it.kind} ${it.id} on ${ch}`);
    } catch (e) {
      it.lastError = this.#redact(clean(msg(e), 300));
      br.failures++;
      if ((e as { unknown?: unknown })?.unknown === true) {
        it.status = "unknown";
        it.note = "The channel gave no clear answer, so it may have gone out. It is never resent: check the channel, then skip it.";
      } else if (it.attempts >= 3) { it.status = "failed"; run.failed++; }
      else { it.status = "queued"; it.nextAttemptAt = now + 2 * MIN * 2 ** (it.attempts - 1); }
      this.#log(`${it.kind} ${it.id} on ${ch}: ${it.status} after attempt ${it.attempts}: ${it.lastError}`);
      if (br.failures >= 3) {
        br.openUntil = now + 6 * HOUR; br.failures = 0;
        this.#note(run, `${ch} failed 3 times in a row: no sends on it until ${fmtLocal(br.openUntil)} Bucharest`);
        await this.#tell(`Recruiter: ${ch} failed 3 times in a row. Nothing goes out on it until ${fmtLocal(br.openUntil)} (Bucharest).`);
      }
    }
    it.updatedAt = now;
    this.#save();
  }

  /** A send that gets no answer in time may still have gone out: it ends "unknown", never resent. */
  #withTimeout<T>(call: () => Promise<T>): Promise<T> {
    const ms = this.#s.sendTimeoutMs;
    return within(call, ms, () => new SendUnknown(`no answer within ${Math.round(ms / 1000)} s`));
  }

  // ------------------------------------------------------------------ learn

  async #refreshFunnel(now: number, run: Run): Promise<void> {
    this.#st.attributionAt = now;
    const refs = [...new Set([...this.#st.opportunities.map((o) => o.ref), ...this.#st.outbox.filter((i) => i.kind === "post" && i.status === "sent").map((i) => i.ref)])].slice(0, 1000);
    if (!refs.length) return;
    let got: Record<string, Partial<FunnelCounts>> | undefined;
    try { got = await within(() => this.#attribution(refs), PROVIDER_MS, () => new Error("no answer in 30 s")); } catch (e) { this.#note(run, `attribution failed: ${msg(e)}`); return; }
    if (!got || typeof got !== "object") return;
    for (const ref of refs) {
      if (!Object.hasOwn(got, ref)) continue;
      const v = got[ref];
      if (!v || typeof v !== "object") continue;
      this.#st.funnel[ref] = { visits: n(v.visits), freeResults: n(v.freeResults), firstPaid: n(v.firstPaid), repeat: n(v.repeat), updatedAt: now };
    }
  }

  #funnelTotals() {
    const t: FunnelCounts = { visits: 0, freeResults: 0, firstPaid: 0, repeat: 0 };
    for (const f of Object.values(this.#st.funnel)) { t.visits += f.visits; t.freeResults += f.freeResults; t.firstPaid += f.firstPaid; t.repeat += f.repeat; }
    return t;
  }

  // ------------------------------------------------------------------ housekeeping

  #expire(now: number): void {
    for (const it of this.#st.outbox) {
      if (it.kind === "post" && it.status === "queued" && now - it.createdAt > DAY) { it.status = "cancelled"; it.note = "stale: not sent within 24 hours"; it.updatedAt = now; }
      else if (it.kind !== "post" && it.status === "awaiting_approval" && now - it.createdAt > 14 * DAY) { it.status = "cancelled"; it.note = "expired: not approved within 14 days"; it.updatedAt = now; }
      else if (it.kind !== "post" && it.status === "queued" && now - it.createdAt > 30 * DAY) { it.status = "cancelled"; it.note = "expired: no channel to send it on within 30 days"; it.updatedAt = now; }
    }
  }

  #prune(): void {
    const st = this.#st;
    const done = st.outbox.filter((i) => !OPEN.includes(i.status) && i.status !== "sending" && i.status !== "unknown");
    if (done.length > KEEP_DONE) {
      const drop = new Set(done.sort((a, b) => a.updatedAt - b.updatedAt).slice(0, done.length - KEEP_DONE));
      st.outbox = st.outbox.filter((i) => !drop.has(i));
    }
    if (st.opportunities.length > this.#s.maxOpportunities) {
      const keep = (o: Opportunity) => o.status === "drafted" || o.status === "contacted" || o.status === "responded" || o.status === "opted_out";
      st.opportunities = st.opportunities.sort((a, b) => Number(keep(b)) - Number(keep(a)) || b.updatedAt - a.updatedAt).slice(0, this.#s.maxOpportunities);
    }
    for (const d of Object.keys(st.counters).sort().slice(0, -KEEP_DAYS)) delete st.counters[d];
    const live = new Set([...st.opportunities.map((o) => o.ref), ...st.outbox.map((i) => i.ref)]);
    for (const r of Object.keys(st.funnel)) if (!live.has(r)) delete st.funnel[r];
  }

  #opp(id: string): Opportunity | undefined {
    return this.#st.opportunities.find((o) => o.id === id);
  }

  #publicSettings(): Omit<Settings, "githubToken"> {
    const { githubToken: _t, ...rest } = this.#s;
    return { ...rest, channels: { ...rest.channels }, githubQueries: [...rest.githubQueries] };
  }

  #save(): boolean {
    try {
      this.#st.settings = this.#publicSettings();
      writeAtomic(this.#file, JSON.stringify(this.#st), { backup: true });
      return true;
    } catch (e) {
      this.#log(`could not save the state: ${msg(e)}`);
      return false;
    }
  }

  #redact(s: string): string { return redact(s, [this.#s.githubToken]); }
  #log(line: string): void { try { this.#out(this.#redact(`recruiter: ${line}`)); } catch { /* a log line never breaks a cycle */ } }
  #note(run: Run, line: string): void { const l = this.#redact(line).slice(0, 300); run.notes.push(l); this.#log(l); }
  async #tell(text: string): Promise<void> {
    try { await within(() => this.#notify(this.#redact(text)), PROVIDER_MS, () => new Error("no answer in 30 s")); } catch (e) { this.#log(`owner alert failed: ${msg(e)}`); }
  }

  // ------------------------------------------------------------------ the owner's digest

  #nextDigest(now: number): number {
    const l = local(now);
    const today = localToUtc(l.y, l.m, l.d, this.#s.digestHour);
    if (now < today) return today;
    if (this.#st.digestDay !== l.day && now < today + 3 * HOUR) return now;
    const t = nextDay(l);
    return localToUtc(t.y, t.m, t.d, this.#s.digestHour);
  }

  /** Once a day at the digest hour on the Bucharest clock (a late start still sends it until noon). */
  async #maybeDigest(now: number): Promise<void> {
    const l = local(now);
    if (this.#st.digestDay === l.day) return;
    const at = localToUtc(l.y, l.m, l.d, this.#s.digestHour);
    if (now < at || now >= at + 3 * HOUR) return;
    this.#st.digestDay = l.day;
    this.#save();
    await this.#tell(this.digest(now));
    this.#log("daily digest sent");
  }

  /** The digest text: plain, short, numbers first. */
  digest(now = this.#clock()): string {
    const st = this.#st, s = this.#s, since = now - DAY;
    const found = st.opportunities.filter((o) => o.discoveredAt >= since);
    const good = found.filter((o) => o.status !== "new" && o.status !== "rejected" && o.status !== "opted_out");
    const sent = st.outbox.filter((i) => i.status === "sent" && (i.sentAt ?? 0) >= since);
    const failed = st.outbox.filter((i) => i.status === "failed" && i.updatedAt >= since);
    const waiting = st.outbox.filter((i) => i.status === "awaiting_approval").length;
    const unknown = st.outbox.filter((i) => i.status === "unknown").length;
    const f = this.#funnelTotals();
    const suggestion = this.#suggestionChannel();
    const top = [...good].sort((a, b) => b.score - a.score).slice(0, 3).map((o) => `${o.name} (${o.score})`);
    return [
      `Recruiter daily · ${local(now).day} (Bucharest)`,
      `State: ${s.stopped ? "STOPPED" : s.paused ? "paused" : "running"}${s.dryRun ? " · dry run, nothing is sent" : ""}`,
      `Last 24 h: ${found.length} found, ${good.length} qualified, ${sent.filter((i) => i.kind === "post").length} posts and ${sent.filter((i) => i.kind !== "post").length} invitations sent, ${failed.length} failed`,
      ...(top.length ? [`Best new: ${top.join(", ")}`] : []),
      `Waiting for you: ${waiting} draft${waiting === 1 ? "" : "s"} to approve${unknown ? `, ${unknown} send${unknown === 1 ? "" : "s"} with an unknown result to check` : ""}`,
      `Channels: ${CHANNELS.map((c) => `${c} ${this.#channelStatus(c, now)}`).join(" · ")}`,
      `Invitations: ${suggestion ? `through ${suggestion}, after your approval` : "no channel that welcomes suggestions, so none go out"}`,
      `Funnel: ${f.visits} visits · ${f.freeResults} free results · ${f.firstPaid} first paid · ${f.repeat} repeat`,
      `Model spend: $${st.costs.modelUsd.toFixed(2)} (budget $${s.modelBudgetUsd})`,
      `Next discovery: ${fmtLocal(Math.max(now, st.discover.lastAt + s.discoverEveryHours * HOUR))} Bucharest`,
    ].join("\n");
  }

  #channelStatus(c: ChannelName, now: number): string {
    if (!this.#channels[c]) return "blocked: no credentials";
    if (!this.#s.channels[c]) return "off";
    const br = this.#st.breakers[c];
    if (br && br.openUntil > now) return `resting until ${fmtLocal(br.openUntil)}`;
    return "ready";
  }

  // ------------------------------------------------------------------ the owner's controls

  /** Pause or resume. Resuming also clears an emergency stop. */
  setPaused(paused: boolean): void {
    this.#s.paused = paused === true;
    if (!this.#s.paused) this.#s.stopped = false;
    this.#log(this.#s.paused ? "paused by the owner" : "resumed by the owner");
    this.#save();
  }

  /** Emergency stop: nothing runs, and every queued or waiting send is cancelled. */
  stop(): { cancelled: number } {
    const now = this.#clock();
    this.#s.stopped = true; this.#s.paused = true;
    let cancelled = 0;
    for (const it of this.#st.outbox) if (OPEN.includes(it.status)) { it.status = "cancelled"; it.note = "cancelled by the emergency stop"; it.updatedAt = now; cancelled++; }
    this.#log(`emergency stop: ${cancelled} queued sends cancelled`);
    this.#save();
    return { cancelled };
  }

  setChannel(name: string, enabled: boolean): { ok: boolean; error?: string } {
    if (!CHANNELS.includes(name as ChannelName)) return { ok: false, error: `Unknown channel. Channels: ${CHANNELS.join(", ")}.` };
    this.#s.channels[name as ChannelName] = enabled === true;
    this.#log(`channel ${name} turned ${enabled ? "on" : "off"} by the owner`);
    this.#save();
    return { ok: true };
  }

  /** Records the owner's approval. A first contact still needs a channel that welcomes suggestions to go out. */
  approve(id: string): { ok: boolean; error?: string } {
    const it = this.#st.outbox.find((i) => i.id === id);
    if (!it) return { ok: false, error: "No such outbox item." };
    if (it.status === "unknown") return { ok: false, error: "A send with an unknown result is never repeated. Check the channel, then skip it." };
    if (it.status !== "awaiting_approval" && !(it.status === "queued" && it.approved)) return { ok: false, error: `This item is ${it.status}.` };
    it.approved = true; it.status = "queued"; it.updatedAt = this.#clock();
    this.#log(`${it.kind} ${it.id} approved by the owner`);
    this.#save();
    return { ok: true };
  }

  /** Closes an item without sending it (also how an "unknown" send is reconciled). */
  skip(id: string): { ok: boolean; error?: string } {
    const it = this.#st.outbox.find((i) => i.id === id);
    if (!it) return { ok: false, error: "No such outbox item." };
    if (!["awaiting_approval", "queued", "unknown", "failed"].includes(it.status)) return { ok: false, error: `This item is ${it.status}.` };
    it.status = "skipped"; it.updatedAt = this.#clock();
    this.#log(`${it.kind} ${it.id} skipped by the owner`);
    this.#save();
    return { ok: true };
  }

  /** The prospect answered or opted in: the one follow-up may now be drafted (for approval). */
  markResponded(opportunityId: string): { ok: boolean; error?: string } {
    const o = this.#opp(opportunityId);
    if (!o) return { ok: false, error: "No such opportunity." };
    if (o.status === "opted_out" || this.#st.optOuts.includes(o.org)) return { ok: false, error: "This organization opted out." };
    o.status = "responded"; o.respondedAt = this.#clock(); o.updatedAt = o.respondedAt;
    this.#log(`${o.id} marked responded`);
    this.#save();
    return { ok: true };
  }

  /** Never contact this organization again; its waiting drafts are cancelled. */
  optOut(org: string): { ok: boolean; cancelled: number; error?: string } {
    const k = String(org ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{0,60}$/.test(k)) return { ok: false, cancelled: 0, error: "Give the organization as the dashboard shows it." };
    const now = this.#clock();
    if (!this.#st.optOuts.includes(k)) this.#st.optOuts.push(k);
    let cancelled = 0;
    for (const it of this.#st.outbox) if (it.org === k && OPEN.includes(it.status)) { it.status = "cancelled"; it.note = "the organization opted out"; it.updatedAt = now; cancelled++; }
    for (const o of this.#st.opportunities) if (o.org === k) { o.status = "opted_out"; o.updatedAt = now; }
    this.#log(`${k} opted out`);
    this.#save();
    return { ok: true, cancelled };
  }

  // ------------------------------------------------------------------ the owner's view

  dashboard() {
    const now = this.#clock(), st = this.#st, s = this.#s, day = utcDay(now);
    const suggestion = this.#suggestionChannel();
    const view = (i: OutboxItem) => ({
      id: i.id, kind: i.kind, channel: i.kind === "post" ? i.channel : (i.status === "sent" || i.status === "unknown" ? i.channel : suggestion ?? "none"),
      subject: i.subject, org: i.org, status: i.status, approved: i.approved,
      blocked: i.status === "awaiting_approval" ? `waiting: owner approval${suggestion ? "" : "; then blocked: no channel that welcomes suggestions"}` : i.status === "queued" ? this.#blocked(i, now) : null,
      text: i.text, link: i.link, attempts: i.attempts, lastError: i.lastError, note: i.note, remoteId: i.remoteId,
      created: stamp(i.createdAt), sent: i.sentAt ? stamp(i.sentAt) : null,
    });
    const recent = (list: OutboxItem[], by: (i: OutboxItem) => number) => [...list].sort((a, b) => by(b) - by(a)).slice(0, 50).map(view);
    const f = this.#funnelTotals();
    const count = (pred: (o: Opportunity) => boolean) => st.opportunities.filter(pred).length;
    return {
      now: stamp(now),
      state: s.stopped ? "stopped" : s.paused ? "paused" : "running",
      settings: { ...this.#publicSettings(), githubToken: s.githubToken ? "set" : "not set" },
      channels: CHANNELS.map((c) => ({
        name: c, configured: Boolean(this.#channels[c]), enabled: s.channels[c], welcomesSuggestions: this.#channels[c]?.welcomesSuggestions === true,
        status: this.#channelStatus(c, now), postsToday: this.#peek(day, c).posts, postCap: s.postsPerPlatformPerDay,
        breaker: { failures: st.breakers[c]?.failures ?? 0, openUntil: st.breakers[c]?.openUntil ? stamp(st.breakers[c]!.openUntil) : null },
      })),
      firstContacts: { today: this.#firstToday(day), cap: s.firstContactsPerDay, channel: suggestion, blocked: suggestion ? null : "no channel that welcomes suggestions: invitations wait for the owner" },
      queue: st.outbox.filter((i) => OPEN.includes(i.status)).sort((a, b) => a.createdAt - b.createdAt).map(view),
      reconcile: st.outbox.filter((i) => i.status === "unknown").map(view),
      prospects: [...st.opportunities].sort((a, b) => b.discoveredAt - a.discoveredAt || b.score - a.score).slice(0, 50).map((o) => ({
        id: o.id, ref: o.ref, source: o.source, name: o.name, org: o.org, url: o.url, repo: o.repo, description: o.description, topics: o.topics,
        stars: o.stars, pushedAt: o.pushedAt, crew: o.crew, score: o.score, reasons: o.reasons, status: o.status, flags: o.flags,
        discovered: stamp(o.discoveredAt), funnel: st.funnel[o.ref] ?? null,
      })),
      sent: recent(st.outbox.filter((i) => i.status === "sent"), (i) => i.sentAt ?? 0),
      failures: recent(st.outbox.filter((i) => i.status === "failed" || (i.lastError !== null && i.status !== "sent")), (i) => i.updatedAt),
      conversions: {
        totals: { opportunities: st.opportunities.length, qualified: count((o) => ["qualified", "drafted", "contacted", "responded"].includes(o.status)), contacted: count((o) => o.contactedAt !== null), responded: count((o) => o.respondedAt !== null), ...f },
        byRef: Object.entries(st.funnel).sort((a, b) => b[1].visits - a[1].visits).slice(0, 50).map(([ref, v]) => ({ ref, ...v, updated: stamp(v.updatedAt) })),
      },
      costs: { modelUsd: st.costs.modelUsd, modelBudgetUsd: s.modelBudgetUsd, note: "Templates only: no model calls are made." },
      schedule: {
        discover: stamp(Math.max(now, st.discover.lastAt + s.discoverEveryHours * HOUR)),
        highlights: stamp(Math.max(now, st.highlightsAt + s.highlightsEveryMinutes * MIN)),
        attribution: stamp(Math.max(now, st.attributionAt + s.attributionEveryMinutes * MIN)),
        digest: stamp(this.#nextDigest(now)),
      },
      discovery: { lastAt: st.discover.lastAt ? stamp(st.discover.lastAt) : null, githubBackoffUntil: st.discover.githubBackoffUntil > now ? stamp(st.discover.githubBackoffUntil) : null, optOuts: [...st.optOuts] },
      runs: st.runs.slice(-20).reverse().map((r) => ({ ...r, at: stamp(r.at) })),
    };
  }
}

/** A highlight as the provider gave it, checked: a plain id, real words, a page on the allowlist. */
function validHighlight(h: unknown): { id: string; text: string; path: SitePath; address: string | null; ref: string } | null {
  if (!h || typeof h !== "object") return null;
  const x = h as Record<string, unknown>;
  const id = typeof x.id === "string" && /^[A-Za-z0-9:_.-]{1,80}$/.test(x.id) ? x.id : null;
  if (!id || typeof x.text !== "string" || !x.text.trim()) return null;
  const path: SitePath = isSitePath(x.path) ? x.path : "/crews";
  const address = isAddress(x.address) ? (x.address as string).toLowerCase() : null;
  return { id, text: x.text, path, address, ref: `rc-h-${createHash("sha256").update(id).digest("hex").slice(0, 10)}` };
}
