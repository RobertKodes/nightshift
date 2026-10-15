/** The IMD actions NIGHTSHIFT buys. Every one costs the same unit price (0.5 IMD today). */
export type ImdAction = "job.open" | "job.continue" | "workflow.open" | "oracle.request" | "schedule.create";

export interface Capabilities {
  /** Price per action in IMD base units (18 decimals). */
  price: bigint;
  asset: `0x${string}`;
  payTo: `0x${string}`;
  network: string;
  quoteTtlSeconds: number;
}

/** What a quote would say: free, holds nothing. Empty `blockers` means the body would be accepted. */
export interface CheckResult {
  action: ImdAction;
  blockers: { code?: string; message: string }[];
  suggestions: { message: string }[];
  /** The steps the swarm would take, in plain words, when the plane returns them. */
  plan: string[];
}

export type OrderState =
  | "quoted"
  | "payment_pending"
  | "admission_pending"
  | "admitted"
  | "payment_failed"
  | "expired"
  | "refused";

export interface Order {
  orderId: string;
  action: ImdAction;
  state: OrderState;
  /** Set once admitted. */
  jobId?: string;
  workflowId?: string;
  /** Payment transaction, once confirmed. */
  txHash?: string;
  problems?: string[];
}

export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobStatus {
  jobId: string;
  state: JobState;
  /** Steps done and total, when the plane reports them. */
  stepsDone: number;
  stepsTotal: number;
  /** The latest human-readable step, e.g. "agent #1160 building". */
  activity: string | null;
}

export interface JobResult {
  jobId: string;
  /** Hosted site, when the job published one (IPFS behind ENS on the live plane). */
  siteUrl: string | null;
  /** Source repository, when the job published one. */
  repoUrl: string | null;
  /** Named output files: name → URL. */
  files: Record<string, string>;
  summary: string | null;
}

/** The only surface the company engine sees. The live and simulated planes both implement it. */
export interface ImdPlane {
  readonly mode: "live" | "sim";
  capabilities(): Promise<Capabilities>;
  check(action: ImdAction, input: unknown): Promise<CheckResult>;
  /** Quotes, pays and submits. Never call without a passing `check` first. */
  open(action: ImdAction, input: unknown): Promise<Order>;
  order(orderId: string): Promise<Order>;
  job(jobId: string): Promise<JobStatus>;
  result(jobId: string): Promise<JobResult>;
}

export class ImdError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ImdError";
  }
}

export const IMD_DECIMALS = 18;
export const IMD_MAINNET = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7" as const;
