import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address } from "viem";
import { writeAtomic } from "../atomic.js";
import { DailyQuota, Gate } from "../services/cache.js";
import { type Ctx, RUN_BY } from "../services/context.js";
import { isAddr, lc } from "../services/evm.js";
import { type Change, DEFAULT_SEVERITY, DEFAULT_THRESHOLDS, type Severity, type Thresholds, advance, diffDetailed, isSeverity, mergeHistory, rank, stable, thresholdsOf } from "./diff.js";
import { CHECKS, type Kind, NOT_SUPPORTED, type Observation, TEMPLATE_READERS, WatchtowerError, observe } from "./observe.js";
import { CONFIRMATIONS_NOTE, COVERAGE_NOTE, SCOPE, type WatchReport, buildReport, failedReport, jobSummary, newId, renderHuman } from "./report.js";

/**
 * WATCHTOWER, a HOUSE crew run by NIGHTSHIFT: it watches Ethereum token contracts and Uniswap v4
 * hooks and answers one question, "what changed since the previous observation, and what evidence
 * supports it?". A one-off check compares with the shared public baseline (the last observation
 * anyone paid or sampled); a watch is one prepaid term of runs on a schedule, with alerts.
 * Everything is kept in one JSON file, written atomically, so a restart continues the schedule.
 */
export const LIMITS = {
  freeSamplesPerDay: 3,
  minDays: 1, maxDays: 30,
  minIntervalMinutes: 60, maxIntervalMinutes: 1_440, defaultIntervalMinutes: 60,
  observationsPerAddress: 20, reportsPerWatch: 50, deliveriesPerWatch: 50,
  /** Addresses kept for the public baseline that no watch covers (oldest dropped first). */
  publicAddresses: 50,
  runsPerTick: 10, concurrentRuns: 2, concurrentChecks: 4,
  notifyAttempts: 3, notifyBackoffMs: 60_000,
  /** Stopped or expired watches are deleted this long after they ended. */
  keepEndedWatchesDays: 30,
} as const;
export const TERM = "One prepaid term: no renewal and no recurring charge. Monitoring stops at expiry.";

export type Payment = { usd: number; payer: string; tx: string | null };
export type JobEvent = { kind: string; status: "done" | "failed"; summary: string; free: boolean; address: string; paid?: Payment };
export type Delivery = {
  id: string; reportId: string; changeIds: string[]; createdAt: number;
  attempts: number; nextAttemptAt: number | null;
  status: "pending" | "sent" | "failed" | "cancelled"; sentAt: number | null; lastError: string | null;
};
export type Watch = {
  id: string; address: Address; kind: Kind;
  /** The wallet that paid and manages it (lowercase). */
  owner: string;
  createdAt: number; expiresAt: number; days: number; intervalMinutes: number;
  thresholds: Thresholds; minSeverity: Severity; payment: Payment;
  reservation?: { manageToken: string; telegramCode: string; report: WatchReport };
  paymentKey?: string;
  status: "pending" | "active" | "stopped" | "expired"; endedAt: number | null;
  /** sha256 of the manage token and of the Telegram code: neither is stored in clear. */
  tokenHash: string; telegramHash: string;
  /** Goes in alert links; it can only turn alerts off. */
  unsubToken: string;
  telegram: { chatId: string | null; linkedAt: number | null };
  /** False after unsubscribe: monitoring continues, alerts stop. */
  alerts: boolean;
  nextRunAt: number; lastRunAt: number | null; lastOkAt: number | null;
  runs: number; failedRuns: number; consecutiveFailures: number; lastError: string | null;
  /** What the next run is compared with: the last value of every check (see diff.ts advance()). */
  reference: Observation | null;
  /** Dedupe: change id → the `after` value last alerted for it. */
  alerted: Record<string, string>;
  deliveries: Delivery[];
};
export type WatchView = {
  id: string; address: Address; chain: "ethereum"; chainId: 1; kind: Kind; status: Watch["status"]; term: string;
  createdAt: string; expiresAt: string; endedAt: string | null; days: number; intervalMinutes: number;
  minSeverity: Severity; thresholds: Thresholds;
  nextRunAt: string | null; lastRunAt: string | null; lastOkAt: string | null; runs: number; failedRuns: number; lastError: string | null;
  stale: boolean; alerts: { enabled: boolean; telegramLinked: boolean };
  payment: { usd: number; tx: string | null };
  reference: { block: number; at: string } | null;
};
type WatchInput = { address: string; owner: string; days: number; intervalMinutes?: number; thresholds?: Partial<Thresholds>; minSeverity?: Severity; payment: Payment; kind?: Kind; paymentKey?: string };
type WatchStart = { watch: WatchView; manageToken: string; telegramCode: string; report: WatchReport };
export type WatchtowerOptions = {
  ctx: Ctx; file: string | null; now?: () => number;
  settled?(key: string): string | null;
  /** Sends one alert (Telegram, …). True when delivered; false or a throw is retried with backoff. */
  notify?: (w: Watch, r: WatchReport) => Promise<boolean>;
  /** Every completed or failed run, for the job ledger. Public-safe: counts only. */
  onJob?: (e: JobEvent) => void;
};

type State = { v: 1; observations: Record<string, Observation[]>; watches: Record<string, Watch>; reports: Record<string, WatchReport[]> };
const empty = (): State => ({ v: 1, observations: {}, watches: {}, reports: {} });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const telegramCodeOf = () => Array.from({ length: 10 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
const publicError = (e: unknown) => (e instanceof WatchtowerError ? e.message : "A data source did not answer.");
const upstream = (e: unknown) => !(e instanceof WatchtowerError) || e.status >= 500;

/** A per-day anonymous key for free use: a salted hash of the IP and the UTC day. The IP itself is never kept. */
const SALT = randomBytes(16).toString("hex");
export function anonKeyOf(ip: string, now = Date.now()): string {
  return `a:${sha(`${SALT}:${new Date(now).toISOString().slice(0, 10)}:${ip}`).slice(0, 24)}`;
}

export class Watchtower {
  readonly ctx: Ctx;
  readonly file: string | null;
  readonly now: () => number;
  readonly #settled: WatchtowerOptions["settled"];
  readonly #notify: WatchtowerOptions["notify"];
  readonly #onJob: WatchtowerOptions["onJob"];
  readonly #quota: DailyQuota;
  readonly #sampling = new Set<string>();
  readonly #gate = new Gate(LIMITS.concurrentChecks);
  #s: State;
  #ticking = false;
  #starting = new Map<string, Promise<WatchStart>>();

  constructor(o: WatchtowerOptions) {
    this.ctx = o.ctx;
    this.file = o.file;
    this.now = o.now ?? o.ctx.d.now;
    this.#notify = o.notify;
    this.#settled = o.settled;
    this.#onJob = o.onJob;
    this.#quota = new DailyQuota(LIMITS.freeSamplesPerDay, this.now);
    this.#s = this.#load();
  }

  // ------------------------------------------------------------ one-off checks

  /** A paid check: observe now and compare with the shared public baseline, which this observation then joins. Throws (never charge) when the chain cannot be read. */
  async check(address: string, opts: { kind?: Kind; paid?: Payment } = {}): Promise<WatchReport> {
    const a = this.#addr(address);
    const kind = this.#kind(opts.kind) ?? this.#kindOf(a);
    try {
      const r = await this.#gate.run(() => this.#publicCheck(a, kind));
      this.#job({ kind: "watch.check", status: "done", summary: jobSummary(r, "Checked"), free: false, address: a, ...(opts.paid ? { paid: opts.paid } : {}) });
      return r;
    } catch (e) {
      if (upstream(e)) this.#job({ kind: "watch.check", status: "failed", summary: `Check failed: ${publicError(e)}`, free: false, address: a, ...(opts.paid ? { paid: opts.paid } : {}) });
      throw this.#norm(e);
    }
  }

  /** The free version of check(): 3 per anonymous key per UTC day; a failed sample is not counted. */
  async sample(address: string, anonKey: string, kind?: Kind): Promise<WatchReport & { free: true; left: number; nextFreeAt: string }> {
    const a = this.#addr(address);
    const k = this.#kind(kind) ?? this.#kindOf(a);
    if (!anonKey) throw new WatchtowerError(400, "A free sample needs an anonymous key.");
    const nextFreeAt = new Date(this.#quota.resetsAt()).toISOString();
    if (this.#quota.left(anonKey) <= 0) throw new WatchtowerError(429, `The ${LIMITS.freeSamplesPerDay} free samples for today are used. They come back at ${nextFreeAt} (UTC midnight); a paid check is $0.05.`, { nextFreeAt });
    if (this.#sampling.has(anonKey)) throw new WatchtowerError(429, "One free sample at a time: wait for the first one to finish.");
    this.#sampling.add(anonKey);
    try {
      const r = await this.#gate.run(() => this.#publicCheck(a, k));
      this.#quota.take(anonKey);
      this.#job({ kind: "watch.sample", status: "done", summary: jobSummary(r, "Sampled"), free: true, address: a });
      return { ...r, free: true, left: this.#quota.left(anonKey), nextFreeAt };
    } catch (e) {
      if (upstream(e)) this.#job({ kind: "watch.sample", status: "failed", summary: `Sample failed: ${publicError(e)}`, free: true, address: a });
      throw this.#norm(e);
    } finally {
      this.#sampling.delete(anonKey);
    }
  }

  async #publicCheck(a: Address, kind: Kind | undefined): Promise<WatchReport> {
    const obs = await observe(this.ctx, a, kind);
    const baseline = mergeHistory(this.#s.observations[a] ?? []);
    const { changes } = baseline ? diffDetailed(baseline, obs, DEFAULT_THRESHOLDS) : { changes: [] as Change[] };
    const r = buildReport({ obs, baseline, changes, now: this.now() });
    this.#storeObservation(obs);
    this.#save();
    return r;
  }

  // ------------------------------------------------------------ watches

  /** Reserves one prepaid term; only a confirmed payment activates its schedule. */
  async startWatch(o: WatchInput): Promise<WatchStart> {
    if (!o.paymentKey) return this.#startWatch(o);
    const prior = this.#starting.get(o.paymentKey);
    if (prior) { await prior; return this.#startWatch(o); }
    const run = this.#startWatch(o);
    this.#starting.set(o.paymentKey, run);
    try { return await run; } finally { this.#starting.delete(o.paymentKey); }
  }

  async #startWatch(o: WatchInput): Promise<WatchStart> {
    if (o.paymentKey) {
      const prior = Object.values(this.#s.watches).find((w) => w.paymentKey === o.paymentKey);
      if (prior) {
        if (prior.address !== o.address.toLowerCase() || prior.owner !== o.owner.toLowerCase() || prior.days !== o.days || !prior.reservation) throw new WatchtowerError(409, "This payment already reserved a different watch.");
        return { watch: this.#view(prior), ...prior.reservation };
      }
    }
    const a = this.#addr(o.address);
    if (typeof o.owner !== "string" || !isAddr(o.owner)) throw new WatchtowerError(400, "owner must be a wallet address (0x + 40 hex).");
    if (!Number.isInteger(o.days) || o.days < LIMITS.minDays || o.days > LIMITS.maxDays) throw new WatchtowerError(400, `days must be a whole number from ${LIMITS.minDays} to ${LIMITS.maxDays}.`);
    const interval = o.intervalMinutes ?? LIMITS.defaultIntervalMinutes;
    if (!Number.isInteger(interval) || interval < LIMITS.minIntervalMinutes || interval > LIMITS.maxIntervalMinutes) throw new WatchtowerError(400, `intervalMinutes must be a whole number from ${LIMITS.minIntervalMinutes} to ${LIMITS.maxIntervalMinutes}.`);
    let thresholds: Thresholds;
    try { thresholds = thresholdsOf(o.thresholds ?? {}); } catch (e) { throw new WatchtowerError(400, (e as Error).message); }
    const minSeverity = o.minSeverity ?? "medium";
    if (!isSeverity(minSeverity)) throw new WatchtowerError(400, "minSeverity must be info, low, medium, high or critical.");
    const p = o.payment;
    if (!p || typeof p.usd !== "number" || !Number.isFinite(p.usd) || p.usd < 0 || typeof p.payer !== "string" || !isAddr(p.payer) || (p.tx !== null && !(typeof p.tx === "string" && /^0x[0-9a-fA-F]{64}$/.test(p.tx)))) throw new WatchtowerError(400, "payment must be { usd, payer (0x address), tx (0x hash or null) }.");
    const kind = this.#kind(o.kind) ?? this.#kindOf(a);

    let obs: Observation;
    try { obs = await this.#gate.run(() => observe(this.ctx, a, kind)); } catch (e) {
      if (upstream(e)) this.#job({ kind: "watch.start", status: "failed", summary: `Watch not started: ${publicError(e)}`, free: false, address: a, paid: p });
      throw this.#norm(e);
    }
    const now = this.now();
    const manageToken = randomBytes(24).toString("base64url");
    const telegramCode = telegramCodeOf();
    const w: Watch = {
      id: newId("w"), address: a, kind: obs.kind, owner: o.owner.toLowerCase(),
      createdAt: now, expiresAt: now + o.days * 86_400_000, days: o.days, intervalMinutes: interval, thresholds, minSeverity,
      payment: { usd: p.usd, payer: p.payer.toLowerCase(), tx: p.tx },
      paymentKey: o.paymentKey, status: p.tx ? "active" : "pending", endedAt: null, tokenHash: sha(manageToken), telegramHash: sha(telegramCode), unsubToken: randomBytes(18).toString("base64url"),
      telegram: { chatId: null, linkedAt: null }, alerts: true,
      nextRunAt: now + interval * 60_000, lastRunAt: now, lastOkAt: now, runs: 1, failedRuns: 0, consecutiveFailures: 0, lastError: null,
      reference: obs, alerted: {}, deliveries: [],
    };
    const report = buildReport({ obs, baseline: null, changes: [], now });
    if (o.paymentKey) w.reservation = { manageToken, telegramCode, report };
    this.#s.watches[w.id] = w;
    this.#storeObservation(obs);
    this.#addReport(w.id, report);
    this.#save();
    this.#job({ kind: "watch.start", status: "done", summary: `Watch started on 1 ${obs.kind}: ${o.days} day${o.days > 1 ? "s" : ""}, every ${interval} minutes; baseline recorded, ${report.counts.completed} checks completed, ${report.counts.unavailable} unavailable`, free: false, address: a, paid: w.payment });
    return { watch: this.#view(w), manageToken, telegramCode, report };
  }

  /** Activates a reserved watch once, after settlement. */
  confirmPayment(id: string, tx: string): boolean {
    const w = this.#s.watches[id];
    if (!w || !/^0x[0-9a-fA-F]{64}$/.test(tx)) return false;
    if (w.payment.tx && w.payment.tx !== tx) return false;
    w.payment.tx = tx;
    if (w.status === "pending") {
      w.status = "active";
      w.expiresAt = this.now() + w.days * 86_400_000;
      w.nextRunAt = this.now() + w.intervalMinutes * 60_000;
    }
    this.#save();
    return true;
  }

  /** A watch with its reports (newest first) and alert deliveries, for its owner or the holder of its manage token. */
  getWatch(id: string, auth: { owner?: string; token?: string }): { watch: WatchView; reports: WatchReport[]; deliveries: Omit<Delivery, "reportId">[] } {
    const w = this.#authorized(id, auth);
    return {
      watch: this.#view(w),
      reports: [...(this.#s.reports[w.id] ?? [])].reverse(),
      deliveries: w.deliveries.map(({ reportId: _r, ...d }) => d).reverse(),
    };
  }

  /** Stops a watch for good (owner or manage token). The term is not refunded or extended. */
  stopWatch(id: string, auth: { owner?: string; token?: string }): WatchView {
    const w = this.#authorized(id, auth);
    if (w.status === "active") { w.status = "stopped"; w.endedAt = this.now(); this.#save(); }
    return this.#view(w);
  }

  /** Links a Telegram chat to the watch whose code this is: alerts go there from now on. */
  linkTelegram(code: string, chatId: string | number): { id: string; address: Address; kind: Kind; expiresAt: string } | null {
    if (typeof code !== "string" || !code.trim()) return null;
    const h = sha(code.trim().toUpperCase());
    const w = Object.values(this.#s.watches).find((x) => same(x.telegramHash, h));
    if (!w || w.status !== "active") return null;
    w.telegram = { chatId: String(chatId), linkedAt: this.now() };
    w.alerts = true;
    this.#save();
    return { id: w.id, address: w.address, kind: w.kind, expiresAt: iso(w.expiresAt)! };
  }

  /** Turns alerts off (the unsubscribe link's token, or the manage token). Monitoring continues until the watch is stopped or expires. */
  unsubscribe(token: string): { id: string; address: Address } | null {
    if (typeof token !== "string" || !token) return null;
    const h = sha(token);
    const w = Object.values(this.#s.watches).find((x) => same(x.unsubToken, token) || same(x.tokenHash, h));
    if (!w) return null;
    w.alerts = false;
    this.#save();
    return { id: w.id, address: w.address };
  }

  /** The unsubscribe link for a watch's alerts (relative to the site). */
  unsubscribePath(w: Pick<Watch, "unsubToken">): string { return `/api/watchtower/unsubscribe?token=${encodeURIComponent(w.unsubToken)}`; }

  // ------------------------------------------------------------ the schedule

  /**
   * One scheduler pass: expire watches whose term ended, run the due ones (at most 10, two at a
   * time, oldest first), then send due alerts. A run that cannot read the chain is recorded as
   * failed and stale and retried at the next interval; it never alerts.
   */
  async tick(): Promise<{ ran: number; failed: number; expired: number; delivered: number; busy?: true }> {
    if (this.#ticking) return { ran: 0, failed: 0, expired: 0, delivered: 0, busy: true };
    this.#ticking = true;
    try {
      const now = this.now();
      for (const w of Object.values(this.#s.watches)) if (w.status === "pending" && w.paymentKey) {
        const tx = this.#settled?.(w.paymentKey);
        if (tx) this.confirmPayment(w.id, tx);
      }
      let expired = 0;
      for (const w of Object.values(this.#s.watches)) {
        if (w.status === "active" && now >= w.expiresAt) { w.status = "expired"; w.endedAt = w.expiresAt; expired++; }
        if (w.status !== "active" && w.endedAt !== null && now - w.endedAt > LIMITS.keepEndedWatchesDays * 86_400_000 && !w.deliveries.some((d) => d.status === "pending")) {
          delete this.#s.watches[w.id];
          delete this.#s.reports[w.id];
        }
      }
      const due = Object.values(this.#s.watches).filter((w) => w.status === "active" && w.payment.tx && w.nextRunAt <= now).sort((x, y) => x.nextRunAt - y.nextRunAt).slice(0, LIMITS.runsPerTick);
      let next = 0, ran = 0, failed = 0;
      const worker = async () => {
        while (next < due.length) {
          const w = due[next++]!;
          (await this.#run(w)) ? ran++ : failed++;
        }
      };
      await Promise.all(Array.from({ length: Math.min(LIMITS.concurrentRuns, due.length) }, worker));
      // the runs (new references, dedupe state, queued alerts) are on disk before any alert goes out
      if (due.length || expired) this.#save();
      const { attempted, delivered } = await this.#deliver();
      if (attempted) this.#save();
      return { ran, failed, expired, delivered };
    } finally {
      this.#ticking = false;
    }
  }

  async #run(w: Watch): Promise<boolean> {
    const started = this.now();
    w.nextRunAt = started + w.intervalMinutes * 60_000;
    w.lastRunAt = started;
    w.runs++;
    let obs: Observation;
    try { obs = await observe(this.ctx, w.address, w.kind); } catch (e) {
      w.failedRuns++; w.consecutiveFailures++;
      w.lastError = publicError(e);
      const r = failedReport({ address: w.address, kind: w.kind, last: w.reference, reason: w.lastError, now: this.now() });
      this.#addReport(w.id, r);
      this.#job({ kind: "watch.observe", status: "failed", summary: jobSummary(r, "Watched"), free: false, address: w.address });
      return false;
    }
    w.consecutiveFailures = 0; w.lastOkAt = started; w.lastError = null;
    const { changes, held } = w.reference ? diffDetailed(w.reference, obs, w.thresholds) : { changes: [] as Change[], held: [] as string[] };
    const r = buildReport({ obs, baseline: w.reference, changes, now: this.now(), staleAfterMs: this.#staleMs(w) });
    w.reference = advance(w.reference, obs, held);
    this.#storeObservation(obs);
    this.#addReport(w.id, r);
    if (w.status === "active") this.#queueAlerts(w, r);
    this.#job({ kind: "watch.observe", status: "done", summary: jobSummary(r, "Watched"), free: false, address: w.address });
    return true;
  }

  /** Changes at or above the watch's severity, and lost coverage, each alerted once per new `after` value. */
  #queueAlerts(w: Watch, r: WatchReport): void {
    for (const c of r.changes) if (c.kind === "coverage" && c.after === "available") w.alerted[c.id] = stable("available");
    if (!this.#notify || !w.alerts || !w.telegram.chatId) return;
    const fresh = r.changes.filter((c) => ((c.kind === "change" && rank(c.severity) >= rank(w.minSeverity)) || (c.kind === "coverage" && c.after === "unavailable")) && w.alerted[c.id] !== stable(c.after));
    if (!fresh.length) return;
    for (const c of fresh) w.alerted[c.id] = stable(c.after);
    w.deliveries.push({ id: newId("d"), reportId: r.id, changeIds: fresh.map((c) => c.id), createdAt: this.now(), attempts: 0, nextAttemptAt: this.now(), status: "pending", sentAt: null, lastError: null });
    while (w.deliveries.length > LIMITS.deliveriesPerWatch) {
      const i = w.deliveries.findIndex((d) => d.status !== "pending");
      w.deliveries.splice(i >= 0 ? i : 0, 1);
    }
  }

  /** Sends due alerts: up to 3 attempts each, 1 then 2 minutes apart, then given up (kept in the history). */
  async #deliver(): Promise<{ attempted: number; delivered: number }> {
    let sent = 0, attempted = 0;
    for (const w of Object.values(this.#s.watches)) {
      if (w.status !== "active" || !w.payment.tx) continue;
      for (const d of w.deliveries) {
        const now = this.now();
        if (d.status !== "pending" || d.nextAttemptAt === null || d.nextAttemptAt > now) continue;
        attempted++;
        if (!this.#notify || !w.alerts || !w.telegram.chatId) { d.status = "cancelled"; d.nextAttemptAt = null; d.lastError = "alerts were turned off"; continue; }
        const r = (this.#s.reports[w.id] ?? []).find((x) => x.id === d.reportId);
        if (!r) { d.status = "failed"; d.nextAttemptAt = null; d.lastError = "the report is no longer kept"; continue; }
        const only = r.changes.filter((c) => d.changeIds.includes(c.id));
        const alert: WatchReport = { ...r, changes: only, human: renderHuman(r, only) };
        d.attempts++;
        let ok = false;
        try { ok = (await this.#notify(structuredClone(w), alert)) === true; d.lastError = ok ? null : "not delivered"; } catch { d.lastError = "the alert channel failed"; }
        if (ok) { d.status = "sent"; d.sentAt = this.now(); d.nextAttemptAt = null; sent++; }
        else if (d.attempts >= LIMITS.notifyAttempts) { d.status = "failed"; d.nextAttemptAt = null; }
        else d.nextAttemptAt = now + LIMITS.notifyBackoffMs * 2 ** (d.attempts - 1);
      }
    }
    return { attempted, delivered: sent };
  }

  // ------------------------------------------------------------ what it does

  /** Scope, checks, thresholds and limits, in plain words. */
  info() {
    const supported = Object.entries(CHECKS).map(([id, c]) => ({ id, label: c.label, kinds: c.kinds, how: c.how, severity: id === "fees" ? "medium (high when a fee goes up)" : id === "liquidity" ? "medium at 30% and $5,000, high at 60%" : id === "totalSupply" ? "medium above 1%" : DEFAULT_SEVERITY[c.group] }));
    const unsupported = (["token", "hook"] as const).flatMap((k) => NOT_SUPPORTED[k].map((u) => ({ kind: k, label: u.label, reason: u.reason })));
    return {
      service: "watchtower", crew: "watchtower", runBy: RUN_BY, house: true,
      question: "What changed since the previous observation, and what evidence supports it?",
      scope: SCOPE, chain: "ethereum", chainId: 1, kinds: ["token", "hook"],
      supported, templates: Object.keys(TEMPLATE_READERS),
      unsupported: [...unsupported, { kind: "any", label: "Other chains", reason: "Ethereum mainnet only." }],
      thresholds: DEFAULT_THRESHOLDS, severities: DEFAULT_SEVERITY,
      coverage: "A check that ran before and did not answer now is reported as lost coverage, never as no change. Coverage losses are always alerted.",
      confirmations: CONFIRMATIONS_NOTE,
      limits: {
        freeSamplesPerDay: LIMITS.freeSamplesPerDay, watchDays: { min: LIMITS.minDays, max: LIMITS.maxDays },
        intervalMinutes: { min: LIMITS.minIntervalMinutes, max: LIMITS.maxIntervalMinutes, default: LIMITS.defaultIntervalMinutes },
        observationsKept: LIMITS.observationsPerAddress, reportsKept: LIMITS.reportsPerWatch,
        runsPerTick: LIMITS.runsPerTick, concurrentRuns: LIMITS.concurrentRuns,
        alertAttempts: LIMITS.notifyAttempts, alertBackoff: "1 minute, then 2 minutes",
      },
      term: TERM, coverageNote: COVERAGE_NOTE,
    };
  }

  // ------------------------------------------------------------ inside

  #addr(address: string): Address {
    if (typeof address !== "string" || !isAddr(address)) throw new WatchtowerError(400, "The address must be 0x followed by 40 hex characters.");
    return lc(address);
  }
  #kind(k: unknown): Kind | undefined {
    if (k === undefined || k === null || k === "") return undefined;
    if (k !== "token" && k !== "hook") throw new WatchtowerError(400, "kind must be token or hook.");
    return k;
  }
  /** The kind an address was observed as before, so a hook found by an explicit kind stays a hook. */
  #kindOf(a: Address): Kind | undefined { return this.#s.observations[a]?.at(-1)?.kind; }
  #norm(e: unknown): Error {
    if (e instanceof WatchtowerError || typeof (e as { status?: unknown })?.status === "number") return e as Error;
    return new WatchtowerError(503, "A data source did not answer (the Ethereum nodes, DexScreener or Sourcify). Nothing was recorded; try again in a minute.");
  }
  #staleMs(w: Watch): number { return 2 * w.intervalMinutes * 60_000 + 10 * 60_000; }

  #authorized(id: string, auth: { owner?: string; token?: string }): Watch {
    const w = typeof id === "string" ? this.#s.watches[id] : undefined;
    if (!w) throw new WatchtowerError(404, "No such watch.");
    const byOwner = typeof auth.owner === "string" && isAddr(auth.owner) && auth.owner.toLowerCase() === w.owner;
    const byToken = typeof auth.token === "string" && auth.token.length > 0 && same(sha(auth.token), w.tokenHash);
    if (!byOwner && !byToken) throw new WatchtowerError(403, "This watch belongs to another wallet: sign in as its owner or send its manage token (X-Watch-Token).");
    return w;
  }

  #view(w: Watch): WatchView {
    const now = this.now();
    return {
      id: w.id, address: w.address, chain: "ethereum", chainId: 1, kind: w.kind, status: w.status, term: TERM,
      createdAt: iso(w.createdAt)!, expiresAt: iso(w.expiresAt)!, endedAt: iso(w.endedAt), days: w.days, intervalMinutes: w.intervalMinutes,
      minSeverity: w.minSeverity, thresholds: w.thresholds,
      nextRunAt: w.status === "active" ? iso(w.nextRunAt) : null, lastRunAt: iso(w.lastRunAt), lastOkAt: iso(w.lastOkAt),
      runs: w.runs, failedRuns: w.failedRuns, lastError: w.lastError,
      stale: w.status === "active" && (w.lastOkAt === null || now - w.lastOkAt > this.#staleMs(w)),
      alerts: { enabled: w.alerts, telegramLinked: Boolean(w.telegram.chatId) },
      payment: { usd: w.payment.usd, tx: w.payment.tx },
      reference: w.reference ? { block: w.reference.block.number, at: iso(w.reference.at)! } : null,
    };
  }

  #storeObservation(obs: Observation): void {
    const list = (this.#s.observations[obs.address] ??= []);
    list.push(obs);
    if (list.length > LIMITS.observationsPerAddress) list.splice(0, list.length - LIMITS.observationsPerAddress);
    const watched = new Set(Object.values(this.#s.watches).map((w) => w.address));
    const open = Object.entries(this.#s.observations).filter(([a]) => !watched.has(a as Address));
    if (open.length > LIMITS.publicAddresses) {
      open.sort((x, y) => (x[1].at(-1)?.at ?? 0) - (y[1].at(-1)?.at ?? 0));
      for (const [a] of open.slice(0, open.length - LIMITS.publicAddresses)) delete this.#s.observations[a];
    }
  }
  /** Keeps the last 50 reports of a watch. Only the newest keeps its full observation (the address history has the last 20), so the file stays small. */
  #addReport(id: string, r: WatchReport): void {
    const list = (this.#s.reports[id] ??= []);
    for (const old of list) old.observation = null;
    list.push({ ...r });
    if (list.length > LIMITS.reportsPerWatch) list.splice(0, list.length - LIMITS.reportsPerWatch);
  }
  #job(e: JobEvent): void { try { this.#onJob?.(e); } catch { /* the ledger never breaks a run */ } }

  #load(): State {
    if (!this.file) return empty();
    for (const f of [this.file, `${this.file}.bak`]) {
      if (!existsSync(f)) continue;
      try {
        const s = JSON.parse(readFileSync(f, "utf8")) as State;
        if (s?.v === 1 && s.observations && s.watches && s.reports) {
          for (const w of Object.values(s.watches)) if (w.status === "active" && !w.payment.tx) w.status = "pending";
          return s;
        }
      } catch { /* a damaged file: try the backup */ }
    }
    return empty();
  }
  #save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeAtomic(this.file, JSON.stringify(this.#s), { backup: true, mode: 0o600 });
  }
}
