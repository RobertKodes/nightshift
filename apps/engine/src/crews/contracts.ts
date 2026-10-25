/**
 * NIGHTSHIFT Crews: the shared shapes. Crews are the station's working agents, each selling one
 * service: four HOUSE crews operated by NIGHTSHIFT (Watchtower, Research Desk, Build & Check, Swarm Desk) and,
 * later, external operators who registered an agent and passed onboarding. Every job a crew runs is
 * recorded once in the job ledger; the crew pages, the proof dashboard and the season ranking are all
 * computed from it, so nothing shown is typed in by hand.
 *
 * Wallets are stored lowercase. Public views never carry a customer's input, output, IP or full
 * wallet unless the customer opted in to publication (`publish`).
 */

export type HouseCrewId = "watchtower" | "research" | "buildcheck" | "swarm";
/** A house crew, or an external operator's crew: "op:<operatorId>". */
export type CrewKey = HouseCrewId | `op:${string}`;

/** Who paid, and how the payment counts on the proof dashboard. */
export type PaymentClass =
  | "customer" // an outside wallet paid real USDC
  | "internal" // a NIGHTSHIFT wallet (dev, treasury, house) paid: never counted as demand
  | "test"; // simulation or a test network: never counted as revenue

export type JobPayment = { usd: number; payer: string; tx: string | null; network: string; class: PaymentClass };

export type JobStatus = "running" | "done" | "failed";

export type Job = {
  id: string;
  crew: CrewKey;
  /** "house" or the operator id. */
  operator: string;
  /** What was done: "watch.check", "watch.observe", "research.report", "buildcheck.report", "onboarding", ... */
  kind: string;
  status: JobStatus;
  free: boolean;
  payment: JobPayment | null;
  /** Repeat-customer key: "w:<wallet>" for paid jobs, "a:<hash>" (salted, per day) for free ones. */
  customer: string | null;
  startedAt: number;
  endedAt: number | null;
  latencyMs: number | null;
  /** Public-safe error text (never a stack, a credential or the customer's input). */
  error: string | null;
  /** Public-safe one-line summary: "Checked 1 token: 2 changes, 1 check unavailable". */
  summary: string | null;
  /** The customer allowed this job's summary and target to be shown publicly. */
  publish: boolean;
  /** What the job ran on (a URL, an address). Kept only when `publish` is true, so a private job never stores it. */
  target?: string | null;
  /** Attribution tag from the link that brought the customer (utm_source / via / ref), if any. */
  ref: string | null;
  /** Known operating cost of this job in USD (RPC, model and IMD spend we can measure). */
  costUsd: number;
};

export type CrewMetrics = {
  jobs: number; done: number; failed: number;
  paidJobs: number; customerPaidJobs: number;
  /** Distinct outside wallets that paid (customer class only). */
  payingWallets: number;
  /** Outside wallets that paid more than once. */
  repeatWallets: number;
  revenueUsd: number; // customer class only
  knownCostUsd: number;
  successRate: number | null; // done / (done + failed)
  medianLatencyMs: number | null;
  lastJobAt: number | null;
};

/** A crew's public profile, as /api/crews and the crew pages show it. */
export type CrewProfile = {
  id: CrewKey;
  name: string;
  operator: { kind: "house"; name: "NIGHTSHIFT" } | { kind: "external"; id: string; name: string; wallet: string };
  service: string; // one sentence: what it does
  customer: string; // one sentence: who it is for
  sample: { label: string; href: string; free: true };
  pricing: { offer: string; label: string; usd: number; holderUsd: number }[];
  limits: string[]; // spending and rate limits, in plain words
  buy: { http: string; mcpTool: string | null; docs: string };
  metrics: CrewMetrics;
  status: "live" | "preview";
};

/** An outside agent that wants to work as a crew. Activated only after its onboarding job succeeded. */
export type Operator = {
  id: string;
  /** The AGENT ARENA agent it registered with (wallet-signed SIWE), which proves who controls it. */
  agentId: string;
  wallet: string;
  name: string;
  capabilities: string[];
  endpoint: string; // its public MCP or HTTP endpoint (https)
  status: "pending" | "onboarding" | "active" | "failed" | "suspended";
  createdAt: number;
  activatedAt: number | null;
  onboarding: { jobId: string | null; passed: boolean | null; reasons: string[]; at: number | null };
};

/** One crew event for the live feeds (the Ship, the crew pages). Public-safe by construction. */
export type CrewEvent = { at: number; crew: CrewKey; kind: string; status: JobStatus; summary: string | null; paid: boolean; house: boolean };

/** The known NIGHTSHIFT wallets: their payments are "internal", never demand. */
export const INTERNAL_WALLETS = new Set([
  "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5", // dev wallet
  "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69", // treasury
  "0x989d0e896961f02b62f491a329d1ad3554355a36", // NIGHTSHIFT Services (house company) wallet on Base
]);
