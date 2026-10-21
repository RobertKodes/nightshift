import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";
import { CATALOG, orders as operatorOrders } from "./orders.js";
import { DEV_WALLET, TREASURY_WALLET } from "./shift-launch.js";

/**
 * NIGHTSHIFT's crew roster and work ledger: every IMD order NIGHTSHIFT paid for and every IMD swarm
 * agent (seat) that worked on one, from IMD's public records (GET /requests/paid-by/:wallet for the
 * operator's wallets, the live companies' own jobs, then /jobs/:id and its submissions). Nothing here
 * is self-reported: each row links to the job on IMD's explorer.
 *
 * Read in the background and kept on disk: a page never waits on IMD, a restart serves the last
 * known roster at once, and a finished job is read once and never again. When IMD does not answer,
 * the answer says so (ok: false, error, and when the numbers were last read) instead of going empty.
 * Simulated companies never appear: only live mode adds the companies' jobs.
 */
type Order = { orderId: string; action: string; status: string; paidAt: string | null; payment?: { status?: string } | null; result?: { jobId?: string } | null };
type Submission = { nodeKey: string; role: string; seat?: { tokenId: string; agentId: string } | null; outcome: string; accepted: boolean; usage?: { model?: string; runtime?: string; wallClockMs?: number; outputTokens?: number } | null };
/** One job's read, compact: the state, its title and every seat's attempt on it. */
type Work = { seat: string; agentId: string; role: string; model?: string; runtime?: string; accepted: boolean; ms: number; outputTokens: number };
type JobRead = { at: number; state: string; title: string; work: Work[] };
/** A job NIGHTSHIFT paid for, from whichever record knows it. */
export type JobRef = { id: string; action: string; title?: string; paidAt: string | null; by: string; imd: number };

export type CrewMember = { seat: number; agentId: string; roles: string[]; models: string[]; runtimes: string[]; accepted: number; attempts: number; jobs: number; hours: number; outputTokens: number };
export type CrewJob = { id: string; action: string; title: string; state: string; paidAt: string | null; by: string; imd: number; workers: number; seats: number[]; accepted: number; explorer: string };
export type Crew = {
  /** When these numbers were last read in full; `checkedAt` is the last try. */
  at: number; checkedAt: number;
  /** false when the last read failed in part or whole: the numbers are then the last known ones. */
  ok: boolean; error: string | null;
  payers: string[]; orders: number; paidImd: number; seats: number; acceptedSteps: number;
  jobs: CrewJob[]; crew: CrewMember[]; models: { model: string; steps: number }[]; source: string;
};

const get = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`${url.replace("https://api.imd.fun", "")} answered ${r.status}`);
  return (await r.json()) as T;
};
type FetchJson = <T>(url: string) => Promise<T>;

/** Every IMD action costs 0.5 IMD (GET /requests/capabilities). */
const ACTION_IMD = 0.5;
const FINAL = new Set(["completed", "failed", "cancelled", "canceled", "refused", "expired"]);
const SOURCE = "api.imd.fun (paid-by, jobs, submissions)";
/** Re-read every 10 minutes; after a failed read, retry in 2. */
const FRESH_MS = 10 * 60_000, RETRY_MS = 2 * 60_000;
/** A first read ever (no copy on disk) is waited for this long before the page gets the honest "not yet". */
const FIRST_WAIT_MS = 6_000;

type Saved = { snapshot: Crew | null; reads: Record<string, JobRead>; orders: Record<string, Order[]> };

/** The first sentence of a job's objective, cut at a word. */
const titleOf = (objective: string | undefined, fallback: string) => {
  const first = (objective ?? "").replace(/[*#`]/g, "").split(/[.\n]/)[0]!.trim();
  return (first.length > 96 ? `${first.slice(0, 96).replace(/[\s,;:(]+\S*$/, "")}…` : first) || fallback;
};

/** Runs `fn` over `items`, `n` at a time. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x); }));
}

export type LedgerOptions = { file: string | null; fetchJson?: FetchJson; payers?: string[]; extra?: () => JobRef[]; now?: () => number; firstWaitMs?: number };

export function crewLedger(o: LedgerOptions) {
  const fetchJson = o.fetchJson ?? get;
  const payers = o.payers ?? [DEV_WALLET, TREASURY_WALLET];
  const now = o.now ?? Date.now;
  let saved: Saved = { snapshot: null, reads: {}, orders: {} };
  try { if (o.file && existsSync(o.file)) saved = { ...saved, ...JSON.parse(readFileSync(o.file, "utf8")) }; } catch { /* start empty */ }
  let running: Promise<void> | null = null;

  async function read(): Promise<void> {
    const errors: string[] = [];
    // 1. the orders: the operator's wallets as IMD records them, then NIGHTSHIFT's own records
    const refs = new Map<string, JobRef>();
    await Promise.all(payers.map(async (p) => {
      try { saved.orders[p] = (await fetchJson<{ orders?: Order[] }>(`https://api.imd.fun/requests/paid-by/${p}`)).orders ?? []; }
      catch (e) { errors.push((e as Error).message); }
    }));
    for (const p of payers) for (const x of saved.orders[p] ?? []) {
      if (x.status === "admitted" && x.result?.jobId) refs.set(x.result.jobId, { id: x.result.jobId, action: x.action, paidAt: x.paidAt, by: "NIGHTSHIFT", imd: ACTION_IMD });
    }
    for (const r of o.extra?.() ?? []) if (!refs.has(r.id)) refs.set(r.id, r);
    // 2. each job once it is finished; open ones on every read
    const todo = [...refs.values()].filter((r) => !FINAL.has(saved.reads[r.id]?.state ?? ""));
    await pool(todo, 4, async (r) => {
      try {
        const [job, subs] = await Promise.all([
          fetchJson<{ state?: string; objective?: string }>(`https://api.imd.fun/jobs/${r.id}`),
          fetchJson<{ submissions?: Submission[] }>(`https://api.imd.fun/jobs/${r.id}/submissions`),
        ]);
        const work = (subs.submissions ?? []).filter((s) => s.seat?.tokenId).map((s): Work => ({
          seat: s.seat!.tokenId, agentId: s.seat!.agentId, role: s.role, model: s.usage?.model, runtime: s.usage?.runtime,
          accepted: Boolean(s.accepted), ms: s.usage?.wallClockMs ?? 0, outputTokens: s.usage?.outputTokens ?? 0,
        }));
        saved.reads[r.id] = { at: now(), state: job.state ?? "unknown", title: titleOf(job.objective, r.action), work };
      } catch (e) { errors.push((e as Error).message); }
    });
    // 3. the roster, from every read job (a job IMD has not answered for yet is listed, unread)
    const members = new Map<string, CrewMember & { jobSet: Set<string> }>();
    const models = new Map<string, number>();
    const jobs: CrewJob[] = [];
    for (const r of refs.values()) {
      const j = saved.reads[r.id];
      const workers = new Set<string>();
      for (const w of j?.work ?? []) {
        workers.add(w.seat);
        const m = members.get(w.seat) ?? { seat: Number(w.seat), agentId: w.agentId, roles: [], models: [], runtimes: [], accepted: 0, attempts: 0, jobs: 0, hours: 0, outputTokens: 0, jobSet: new Set<string>() };
        m.attempts++;
        if (w.accepted) m.accepted++;
        if (w.role && !m.roles.includes(w.role)) m.roles.push(w.role);
        if (w.model && !m.models.includes(w.model)) m.models.push(w.model);
        if (w.runtime && !m.runtimes.includes(w.runtime)) m.runtimes.push(w.runtime);
        m.hours += w.ms / 3_600_000;
        m.outputTokens += w.outputTokens;
        m.jobSet.add(r.id);
        members.set(w.seat, m);
        if (w.model) models.set(w.model, (models.get(w.model) ?? 0) + 1);
      }
      jobs.push({
        id: r.id, action: r.action, title: r.title ?? j?.title ?? r.action, state: j?.state ?? "not read yet", paidAt: r.paidAt, by: r.by, imd: r.imd,
        workers: workers.size, seats: [...workers].map(Number).sort((a, b) => a - b), accepted: (j?.work ?? []).filter((w) => w.accepted).length, explorer: `https://explorer.imd.fun/jobs/${r.id}`,
      });
    }
    const roster = [...members.values()].map(({ jobSet, ...m }) => ({ ...m, jobs: jobSet.size, hours: Math.round(m.hours * 10) / 10 }))
      .sort((a, b) => b.accepted - a.accepted || b.jobs - a.jobs || a.seat - b.seat);
    const t = now(), prev = saved.snapshot;
    // with nothing at all to show, a failed read stays "never read" rather than a real-looking zero
    const nothing = errors.length > 0 && !jobs.length;
    saved.snapshot = {
      at: errors.length ? (prev?.at ?? (nothing ? 0 : t)) : t, checkedAt: t,
      ok: errors.length === 0, error: errors.length ? `IMD's API is not answering (${errors[0]}${errors.length > 1 ? `, and ${errors.length - 1} more` : ""}).` : null,
      payers, orders: jobs.length, paidImd: jobs.reduce((a, j) => a + j.imd, 0), seats: roster.length, acceptedSteps: roster.reduce((a, m) => a + m.accepted, 0),
      jobs: jobs.sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? "")), crew: roster,
      models: [...models].map(([model, steps]) => ({ model, steps })).sort((a, b) => b.steps - a.steps), source: SOURCE,
    };
    if (o.file) try { writeAtomic(o.file, JSON.stringify(saved)); } catch (e) { console.error("crew save", (e as Error).message); }
    if (errors.length) console.error("crew", errors.slice(0, 3).join("; "));
  }

  /** One read at a time, however many pages ask. */
  const refresh = (): Promise<void> => (running ??= read().catch((e) => console.error("crew", (e as Error).message)).finally(() => { running = null; }));

  return {
    refresh,
    /** The roster now: the last known copy at once (a fresh read starts behind it when it is due). */
    async get(): Promise<Crew> {
      const s = saved.snapshot;
      const due = !s || now() - s.checkedAt > (s.ok ? FRESH_MS : RETRY_MS);
      if (due) {
        const r = refresh();
        if (!s) await Promise.race([r, new Promise((ok) => setTimeout(ok, o.firstWaitMs ?? FIRST_WAIT_MS))]);
      }
      return saved.snapshot ?? {
        at: 0, checkedAt: now(), ok: false, error: "IMD's API has not answered yet.", payers, orders: 0, paidImd: 0, seats: 0, acceptedSteps: 0,
        jobs: [], crew: [], models: [], source: SOURCE,
      };
    },
  };
}

/** The live companies' own paid IMD jobs (live mode only: simulated companies are never counted). */
let companyJobs: () => JobRef[] = () => [];
let ledger: ReturnType<typeof crewLedger> | null = null;
const theLedger = () => (ledger ??= crewLedger({
  file: join(config.dataDir, "crew.json"),
  // the operator's own orders from the setup page, then the companies'
  extra: () => [
    ...operatorOrders().filter((x) => x.jobId).map((x): JobRef => ({ id: x.jobId!, action: CATALOG.find((c) => c.id === x.id)?.action ?? "launch.open", title: x.title, paidAt: new Date(x.at).toISOString(), by: "NIGHTSHIFT", imd: ACTION_IMD })),
    ...(config.mode === "live" ? companyJobs() : []),
  ],
}));

export const crew = (): Promise<Crew> => theLedger().get();

/** Reads the ledger now and every 10 minutes, so no visitor waits on IMD. */
export function startCrew(jobs: () => JobRef[]): void {
  companyJobs = jobs;
  void theLedger().refresh();
  setInterval(() => void theLedger().refresh(), FRESH_MS).unref();
}

let pulseCache: { at: number; v: unknown } | null = null;
let pulseRunning: Promise<void> | null = null;
/** The swarm's health and totals (the head of GET /swarm), every 10 minutes; served at once from the last read. */
export async function swarmPulse(fetchJson: FetchJson = get): Promise<unknown> {
  const due = !pulseCache || Date.now() - pulseCache.at > 10 * 60_000;
  if (due) {
    pulseRunning ??= (async () => {
      try {
        const s = await fetchJson<{ health?: Record<string, unknown>; counts?: Record<string, unknown> }>("https://api.imd.fun/swarm");
        const h = s.health ?? {}, c = s.counts ?? {};
        pulseCache = { at: Date.now(), v: { at: Date.now(), ok: true, agentsOnline: h.agentsOnline, seatsEnrolled: h.seatsEnrolled, acceptedLastDay: h.acceptedLastDay, jobsDoneLastDay: h.jobsDoneLastDay, oraclesDoneLastDay: h.oraclesDoneLastDay, jobs: c.jobs, launchesLive: c.launchesLive, sites: c.sites, inferenceTokens: c.inferenceTokens, source: "api.imd.fun/swarm" } };
      } catch (e) {
        console.error("swarm pulse", (e as Error).message);
        // keep the last numbers, marked as old; try again in a minute
        if (pulseCache) pulseCache = { at: Date.now() - 9 * 60_000, v: { ...(pulseCache.v as object), ok: false } };
      }
    })().finally(() => { pulseRunning = null; });
    if (!pulseCache) await Promise.race([pulseRunning, new Promise((ok) => setTimeout(ok, FIRST_WAIT_MS))]);
  }
  return pulseCache?.v ?? null;
}
