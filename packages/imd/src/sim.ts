import { randomUUID } from "node:crypto";
import type { Capabilities, CheckResult, ImdAction, ImdPlane, JobResult, JobStatus, Order } from "./types.js";

export interface SimOptions {
  /** How long a simulated job takes, end to end. */
  jobMs?: number;
  /** Produces what the swarm "delivered". The engine uses it to host the built site locally. */
  deliver?: (jobId: string, action: ImdAction, input: unknown) => Promise<Omit<JobResult, "jobId">>;
  now?: () => number;
}

const STEPS: Record<string, string[]> = {
  "job.open": ["plan the work", "build", "independent review", "publish"],
  "job.continue": ["read the project", "build the change", "independent review", "publish"],
  "workflow.open": ["build contracts", "test", "audit panel", "deploy", "build the site", "host on IPFS"],
  "oracle.request": ["draft the question", "panel answers", "attest"],
  "schedule.create": ["register the schedule"],
};

/**
 * A stand-in for api.imd.fun with the same shapes and the same rules: a check that refuses vague
 * bodies, orders that pass through payment and admission, jobs that take time and report steps.
 * Nothing leaves the machine and no IMD is spent.
 */
export class SimImdPlane implements ImdPlane {
  readonly mode = "sim" as const;
  readonly #jobMs: number;
  readonly #deliver: SimOptions["deliver"];
  readonly #now: () => number;
  readonly #orders = new Map<string, { order: Order; at: number; input: unknown }>();
  readonly #jobs = new Map<string, { action: ImdAction; at: number; input: unknown; result?: Omit<JobResult, "jobId"> }>();

  constructor(opts: SimOptions = {}) {
    this.#jobMs = opts.jobMs ?? 45_000;
    this.#deliver = opts.deliver;
    this.#now = opts.now ?? Date.now;
  }

  async capabilities(): Promise<Capabilities> {
    return {
      price: 500000000000000000n,
      asset: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
      payTo: "0x4e0fa57bde726079356537e2f34d671e9f41adbc",
      network: "eip155:1",
      quoteTtlSeconds: 600,
    };
  }

  async check(action: ImdAction, input: unknown): Promise<CheckResult> {
    const objective = String((input as { objective?: string; request?: string; question?: string })?.objective ?? (input as { request?: string })?.request ?? (input as { question?: string })?.question ?? "");
    const blockers = objective.trim().length < 40
      ? [{ code: "objective_too_vague", message: "Say what to build, for whom, and what done looks like." }]
      : [];
    return { action, blockers, suggestions: [], plan: STEPS[action] ?? [] };
  }

  async open(action: ImdAction, input: unknown): Promise<Order> {
    const check = await this.check(action, input);
    if (check.blockers.length) return { orderId: randomUUID(), action, state: "refused", problems: check.blockers.map((b) => b.message) };
    const orderId = randomUUID();
    const jobId = randomUUID();
    const order: Order = { orderId, action, state: "payment_pending", jobId, txHash: `0x${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}` };
    this.#orders.set(orderId, { order, at: this.#now(), input });
    this.#jobs.set(jobId, { action, at: this.#now() + 3000, input });
    return { ...order };
  }

  async order(orderId: string): Promise<Order> {
    const o = this.#orders.get(orderId);
    if (!o) throw new Error(`unknown order ${orderId}`);
    const age = this.#now() - o.at;
    o.order.state = age < 1500 ? "payment_pending" : age < 3000 ? "admission_pending" : "admitted";
    return { ...o.order };
  }

  async job(jobId: string): Promise<JobStatus> {
    const j = this.#jobs.get(jobId);
    if (!j) throw new Error(`unknown job ${jobId}`);
    const steps = STEPS[j.action] ?? ["work"];
    const f = Math.max(0, (this.#now() - j.at) / this.#jobMs);
    const done = Math.min(steps.length, Math.floor(f * steps.length));
    const seat = 100 + (parseInt(jobId.slice(0, 4), 16) % 1900);
    return {
      jobId,
      state: f <= 0 ? "queued" : f >= 1 ? "completed" : "running",
      stepsDone: done,
      stepsTotal: steps.length,
      activity: f >= 1 ? null : `agent #${seat} · ${steps[Math.min(done, steps.length - 1)]}`,
    };
  }

  async result(jobId: string): Promise<JobResult> {
    const j = this.#jobs.get(jobId);
    if (!j) throw new Error(`unknown job ${jobId}`);
    if (!j.result) {
      j.result = this.#deliver
        ? await this.#deliver(jobId, j.action, j.input)
        : { siteUrl: null, repoUrl: null, files: {}, summary: "delivered" };
    }
    return { jobId, ...j.result };
  }
}
