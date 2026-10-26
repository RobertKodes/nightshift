import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { writeAtomic } from "../atomic.js";
import { type CrewEvent, type CrewKey, type CrewMetrics, INTERNAL_WALLETS, type Job, type JobPayment, type JobStatus, type PaymentClass } from "./contracts.js";

/**
 * The job ledger: every job a crew runs, recorded once. Crew pages, the proof dashboard and the
 * season are computed from it, so a number shown anywhere can be traced to the jobs behind it.
 * A paid job is started with an idempotency key (the payment's "payer:nonce" or its tx), so a
 * retried request never counts the same payment twice. The last 5,000 jobs are kept, written with
 * writeAtomic so a crash never leaves the file half written.
 */
export const MAX_JOBS = 5_000;
/** A job still "running" this long after a restart was cut off by the restart: it is failed as "interrupted". */
export const STALE_MS = 15 * 60_000;
/** Payments on these networks are tests: never revenue, never demand. */
export const TEST_NETWORKS = new Set(["eip155:84532", "eip155:11155111", "eip155:17000", "sim"]);

export type PaymentInput = { usd: number; payer: string; tx?: string | null; network: string; test?: boolean; sim?: boolean };
export type StartInput = {
  /** Idempotency: the same key returns the job already recorded (a payment's "payer:nonce" or tx). */
  key?: string;
  crew: CrewKey; operator: string; kind: string; free: boolean;
  payment?: PaymentInput | null;
  customer?: string | null; ref?: string | null; publish?: boolean;
  /** Stored only when publish is true. */
  target?: string | null;
};
/** A job as anyone may see it: no customer key, no attribution tag, no payer or target unless published. */
export type PublicJob = Omit<Job, "payment" | "customer" | "ref" | "target"> & {
  paid: boolean;
  payment: { usd: number; network: string; class: PaymentClass; payer?: string; tx?: string | null } | null;
  target?: string | null;
};

/** How a payment counts: our own wallets are "internal", simulations and test networks "test", the rest "customer". */
export function paymentClass(p: { payer: string; network?: string; test?: boolean; sim?: boolean }): PaymentClass {
  if (INTERNAL_WALLETS.has(p.payer.toLowerCase())) return "internal";
  if (p.test || p.sim || (p.network !== undefined && TEST_NETWORKS.has(p.network))) return "test";
  return "customer";
}

/** Strips everything private from a job: what the public feeds and crew pages show. */
export function publicJob(j: Job): PublicJob {
  const p = j.payment;
  return {
    id: j.id, crew: j.crew, operator: j.operator, kind: j.kind, status: j.status, free: j.free,
    paid: p?.class === "customer",
    payment: p ? { usd: p.usd, network: p.network, class: p.class, ...(j.publish ? { payer: p.payer, tx: p.tx } : {}) } : null,
    startedAt: j.startedAt, endedAt: j.endedAt, latencyMs: j.latencyMs, error: j.error, summary: j.summary, publish: j.publish,
    ...(j.publish && j.target ? { target: j.target } : {}),
    costUsd: j.costUsd,
  };
}

/** A job's current state as a feed event (public-safe: summary and counts only). */
export function eventOf(j: Job): CrewEvent {
  return { at: j.endedAt ?? j.startedAt, crew: j.crew, kind: j.kind, status: j.status, summary: j.summary, paid: j.payment?.class === "customer", house: j.operator === "house" };
}

const CREW = /^(watchtower|research|buildcheck|swarm|op:[a-z0-9_-]{1,40})$/;
const KIND = /^[a-z0-9][a-z0-9._-]{0,39}$/;
/** One plain line: no control characters, bounded. */
const line = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const usd = (n: number) => Math.round(n * 1e6) / 1e6;
const copy = (j: Job): Job => ({ ...j, payment: j.payment ? { ...j.payment } : null });

type Stored = { v: 1; jobs: Job[]; keys: [string, string][] };

export class JobLedger {
  #jobs: Job[] = [];
  readonly #byId = new Map<string, Job>();
  /** Idempotency key → job id. */
  readonly #keys = new Map<string, string>();
  /** Jobs that were "running" when the file was loaded: nothing in this process runs them. */
  readonly #orphans = new Set<string>();
  readonly #file: string | null;
  readonly #now: () => number;
  readonly #onEvent: ((e: CrewEvent) => void) | null;
  readonly #boot: number;
  #salt = randomBytes(16);
  #saltDay = "";

  constructor(o: { file: string | null; now?: () => number; onEvent?: (e: CrewEvent) => void }) {
    this.#file = o.file;
    this.#now = o.now ?? Date.now;
    this.#onEvent = o.onEvent ?? null;
    if (o.file && existsSync(o.file)) {
      try {
        const s = JSON.parse(readFileSync(o.file, "utf8")) as Stored;
        this.#jobs = Array.isArray(s.jobs) ? s.jobs : [];
        for (const j of this.#jobs) { this.#byId.set(j.id, j); if (j.status === "running") this.#orphans.add(j.id); }
        for (const [k, id] of Array.isArray(s.keys) ? s.keys : []) if (this.#byId.has(id)) this.#keys.set(k, id);
      } catch (e) {
        // never overwrite a file we could not read: it is set aside for a person to look at
        try { renameSync(o.file, `${o.file}.unreadable-${Date.now()}`); } catch { /* best effort */ }
        console.error("crews ledger: unreadable file set aside", (e as Error).message);
      }
    }
    this.#boot = this.#now();
    this.#sweep();
  }

  /** Fails interrupted local jobs. Swarm Desk follows its own jobs after a restart. */
  #sweep(): void {
    if (!this.#orphans.size) return;
    const now = this.#now();
    let changed = false;
    for (const id of [...this.#orphans]) {
      const j = this.#byId.get(id);
      if (!j || j.status !== "running") { this.#orphans.delete(id); continue; }
      if (j.crew !== "swarm" && j.startedAt < this.#boot && now - j.startedAt > STALE_MS) {
        this.#orphans.delete(id);
        Object.assign(j, { status: "failed", endedAt: now, latencyMs: now - j.startedAt, error: "interrupted" });
        this.#emit(j); changed = true;
      }
    }
    if (changed) this.#save();
  }

  #emit(j: Job): void {
    if (!this.#onEvent) return;
    try { this.#onEvent(eventOf(j)); } catch { /* a listener never breaks the ledger */ }
  }

  #save(): void {
    if (!this.#file) return;
    const keys = [...this.#keys].filter(([, id]) => this.#byId.has(id));
    try { writeAtomic(this.#file, JSON.stringify({ v: 1, jobs: this.#jobs, keys } satisfies Stored)); } catch (e) { console.error("crews ledger: save failed", (e as Error).message); }
  }

  /** A repeat-customer key for a free job: a salted hash of the address, new salt every UTC day, never stored with the address. */
  anon(ip: string): string {
    const day = new Date(this.#now()).toISOString().slice(0, 10);
    if (day !== this.#saltDay) { this.#saltDay = day; this.#salt = randomBytes(16); }
    return `a:${createHash("sha256").update(this.#salt).update(ip).digest("base64url").slice(0, 16)}`;
  }

  /** Records a job as running. With a key already seen, returns that job instead (counted once). */
  start(input: StartInput): Job {
    this.#sweep();
    const key = input.key === undefined ? null : line(input.key, 200);
    if (key) { const id = this.#keys.get(key); const hit = id ? this.#byId.get(id) : undefined; if (hit) return copy(hit); }
    if (!CREW.test(input.crew)) throw new Error(`unknown crew: ${line(input.crew, 50)}`);
    if (!KIND.test(input.kind)) throw new Error("kind: lowercase letters, digits, dots and dashes");
    const operator = line(input.operator, 60);
    if (!operator) throw new Error("operator is required");
    let payment: JobPayment | null = null;
    if (input.payment) {
      const p = input.payment;
      if (!/^0x[0-9a-fA-F]{40}$/.test(p.payer)) throw new Error("payment.payer must be a 0x address");
      if (!Number.isFinite(p.usd) || p.usd < 0 || p.usd > 1_000_000) throw new Error("payment.usd out of range");
      const payer = p.payer.toLowerCase(), network = line(p.network, 40);
      payment = { usd: usd(p.usd), payer, tx: p.tx ? line(p.tx, 100) : null, network, class: paymentClass({ payer, network, test: p.test, sim: p.sim }) };
    }
    const now = this.#now(), publish = input.publish === true;
    const job: Job = {
      id: randomBytes(8).toString("hex"), crew: input.crew, operator, kind: input.kind, status: "running", free: input.free === true,
      payment, customer: input.customer ? line(input.customer, 80) : payment ? `w:${payment.payer}` : null,
      startedAt: now, endedAt: null, latencyMs: null, error: null, summary: null, publish,
      ref: input.ref ? line(input.ref, 30).toLowerCase().replace(/[^a-z0-9._-]/g, "") || null : null,
      ...(publish && input.target ? { target: line(input.target, 300) } : {}),
      costUsd: 0,
    };
    this.#jobs.push(job);
    this.#byId.set(job.id, job);
    if (key) this.#keys.set(key, job.id);
    // bounded: the oldest jobs (and their keys) go first
    if (this.#jobs.length > MAX_JOBS) {
      for (const old of this.#jobs.splice(0, this.#jobs.length - MAX_JOBS)) { this.#byId.delete(old.id); this.#orphans.delete(old.id); }
      for (const [k, id] of this.#keys) if (!this.#byId.has(id)) this.#keys.delete(k);
    }
    this.#save();
    this.#emit(job);
    return copy(job);
  }

  #finish(id: string, status: Exclude<JobStatus, "running">, f: { summary?: string; error?: string; costUsd?: number }): Job {
    const j = this.#byId.get(id);
    if (!j) throw new Error("no such job");
    if (j.status !== "running") return copy(j); // already finished: no second event
    const now = this.#now();
    j.status = status; j.endedAt = now; j.latencyMs = Math.max(0, now - j.startedAt);
    if (f.summary !== undefined) j.summary = line(f.summary, 200) || null;
    if (f.error !== undefined) j.error = line(f.error, 200) || "failed";
    if (f.costUsd !== undefined && Number.isFinite(f.costUsd) && f.costUsd > 0) j.costUsd = usd(j.costUsd + f.costUsd);
    this.#orphans.delete(id);
    this.#save();
    this.#emit(j);
    return copy(j);
  }

  /** The job succeeded. `summary` is public: counts and outcomes, never the customer's input. */
  done(id: string, r: { summary: string; costUsd?: number }): Job { return this.#finish(id, "done", r); }
  /** The job failed. `error` is public-safe text: never a stack, a credential or the customer's input. */
  fail(id: string, error: string, costUsd?: number): Job { return this.#finish(id, "failed", { error, ...(costUsd !== undefined ? { costUsd } : {}) }); }

  get(id: string): Job | null { this.#sweep(); const j = this.#byId.get(id); return j ? copy(j) : null; }

  /** Jobs, newest first. */
  list(q: { crew?: CrewKey; since?: number; status?: JobStatus; limit?: number } = {}): Job[] {
    this.#sweep();
    const limit = Math.max(1, Math.min(MAX_JOBS, Math.floor(q.limit ?? 50)));
    const out: Job[] = [];
    for (let i = this.#jobs.length - 1; i >= 0 && out.length < limit; i--) {
      const j = this.#jobs[i]!;
      if (q.crew && j.crew !== q.crew) continue;
      if (q.since !== undefined && j.startedAt < q.since) continue;
      if (q.status && j.status !== q.status) continue;
      out.push(copy(j));
    }
    return out;
  }

  publicJob(j: Job): PublicJob { return publicJob(j); }

  /** The latest crew events (each job's current state), newest first. */
  events(limit = 50): CrewEvent[] {
    this.#sweep();
    return [...this.#jobs].sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt)).slice(0, Math.max(1, Math.min(500, limit))).map(eventOf);
  }

  /**
   * A crew's numbers from its jobs started in [sinceMs, untilMs). Paid counts take every job that
   * came with a payment; revenue and paying wallets take the customer class only, and only jobs
   * that did not fail (a failed job is never charged).
   */
  metrics(crew: CrewKey, sinceMs = 0, untilMs = Infinity): CrewMetrics {
    this.#sweep();
    let jobs = 0, done = 0, failed = 0, paidJobs = 0, customerPaidJobs = 0, revenue = 0, cost = 0, lastJobAt: number | null = null;
    const lat: number[] = [], wallets = new Map<string, number>();
    for (const j of this.#jobs) {
      if (j.crew !== crew || j.startedAt < sinceMs || j.startedAt >= untilMs) continue;
      jobs++;
      if (j.status === "done") { done++; if (j.latencyMs !== null) lat.push(j.latencyMs); }
      if (j.status === "failed") failed++;
      cost += j.costUsd;
      lastJobAt = Math.max(lastJobAt ?? 0, j.startedAt);
      if (!j.payment) continue;
      paidJobs++;
      if (j.payment.class !== "customer") continue;
      customerPaidJobs++;
      if (j.status === "failed" || (j.payment.network === "virtuals-acp" && j.status !== "done")) continue;
      revenue += j.payment.usd;
      wallets.set(j.payment.payer, (wallets.get(j.payment.payer) ?? 0) + 1);
    }
    lat.sort((a, b) => a - b);
    const mid = lat.length >> 1;
    return {
      jobs, done, failed, paidJobs, customerPaidJobs,
      payingWallets: wallets.size, repeatWallets: [...wallets.values()].filter((n) => n > 1).length,
      revenueUsd: usd(revenue), knownCostUsd: usd(cost),
      successRate: done + failed ? done / (done + failed) : null,
      medianLatencyMs: lat.length ? (lat.length % 2 ? lat[mid]! : Math.round((lat[mid - 1]! + lat[mid]!) / 2)) : null,
      lastJobAt,
    };
  }

  /** Every crew key the ledger has seen, in first-seen order. */
  crews(): CrewKey[] { return [...new Set(this.#jobs.map((j) => j.crew))]; }
}
