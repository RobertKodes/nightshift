/** What a company is, what it sells, and what it decided to do: the state every view reads. */

export type ProductKind = "report" | "tool" | "template" | "dataset";

export interface Product {
  id: string;
  name: string;
  kind: ProductKind;
  pitch: string;
  /** USDC base units (6 decimals). */
  priceUsdc: bigint;
  /** The owner set this price: the CEO keeps it. */
  priceByOwner?: boolean;
  status: "building" | "live" | "retired";
  /** Where the buyer gets it after paying: the swarm's delivered file or hosted tool. */
  deliverableUrl: string | null;
  taskId: string;
  /** Sales to people and outside agents. Sales to other NIGHTSHIFT companies are counted apart, in b2b*. */
  sales: number;
  revenueUsdc: bigint;
  /** Bought by other NIGHTSHIFT companies (B2B): never added to `sales`, so no number is inflated by them. */
  b2bSales?: number;
  b2bRevenueUsdc?: bigint;
  createdAt: number;
}

export type TaskKind = "research" | "build_product" | "build_site" | "improve_site" | "marketing" | "reprice" | "retire_product";

export type TaskStatus =
  | "planned"
  | "checking" // the free IMD check
  | "awaiting_approval" // over the owner's per-action limit
  | "ordering" // quote, pay, submit
  | "building" // the swarm is on it
  | "done"
  | "failed"
  | "rejected"; // the owner said no

export interface Task {
  id: string;
  cycle: number;
  kind: TaskKind;
  title: string;
  /** The CEO's reason, in its own words. */
  why: string;
  status: TaskStatus;
  /** The body sent to IMD, when the task buys work. */
  imd?: { action: string; input: unknown; orderId?: string; jobId?: string; txHash?: string; plan?: string[] };
  stepsDone: number;
  stepsTotal: number;
  activity: string | null;
  /** IMD base units spent (0 for internal tasks). */
  costImd: bigint;
  result: { siteUrl?: string | null; repoUrl?: string | null; files?: Record<string, string>; note?: string } | null;
  error: string | null;
  productId?: string;
  createdAt: number;
  updatedAt: number;
  /** The flight record: every change of status, step or activity, oldest first. */
  trail?: TrailEntry[];
  /** How the CEO chose this move and the numbers it was looking at. */
  mind?: Mind;
  /** USDC base units paid (or reserved while paying) for a product bought from another company. */
  costUsdc?: bigint;
  /** Research only: the search of the NIGHTSHIFT market before paying the swarm, and what it decided. */
  market?: MarketSearch;
}

/** Why a product on the market was or was not bought. */
export type MarketVerdict = "picked" | "relevant" | "irrelevant" | "pricier" | "over_max" | "same_owner" | "own" | "owned" | "demo" | "cap" | "funds";

export interface MarketCandidate {
  sellerId: string;
  company: string;
  slug: string;
  productId: string;
  name: string;
  kind: ProductKind;
  priceUsd: number;
  /** Relevance to the research brief, 0 to 1. */
  score: number;
  verdict: MarketVerdict;
  why: string;
}

export interface MarketPick {
  sellerId: string;
  company: string;
  slug: string;
  productId: string;
  name: string;
  kind: ProductKind;
  priceUsdc: bigint;
  score: number;
}

export interface MarketSearch {
  at: number;
  doneAt: number;
  /** The brief's key terms, matched against each product's free preview. */
  query: string;
  /** What the same research costs from the swarm, in USD at the IMD price of the moment. */
  swarmUsd: number;
  /** Who scored relevance: the CEO's model, or the keyword score when no model is set (or it failed). */
  by: "model" | "keywords";
  threshold: number;
  costUsd?: number;
  fallback?: string;
  candidates: MarketCandidate[];
  /** The decision, in one sentence. */
  decision: string;
  pick?: MarketPick;
  /** Sent on chain, not landed yet (live only): the settlement key it is followed by. */
  pending?: string;
  paid?: { at: number; usdc: bigint; ledgerId: string; tx: string | null; sim: boolean };
}

/** One purchase between two NIGHTSHIFT companies, as each side keeps it. */
export interface B2bLine {
  at: number;
  /** The one ledger transaction both sides share: b2b:<buyer task id>. */
  ledgerId: string;
  taskId: string;
  productId: string;
  product: string;
  kind: ProductKind;
  usdc: bigint;
  /** The other company: the seller on a purchase, the buyer on a sale. */
  with: { id: string; name: string; slug: string };
  tx: string | null;
  sim: boolean;
}

export interface TrailEntry {
  at: number;
  status: TaskStatus;
  activity: string | null;
  step: number;
}

export interface Mind {
  by: "model" | "playbook" | "owner";
  /** The model that answered (owner view only). */
  model?: string;
  costUsd?: number;
  /** Why the playbook decided instead of the model, when a model is set. */
  fallback?: string;
  saw: { visits7d: number; sales7d: number; revenue7dUsd: number; imdUsd: number; liveProducts: number; direction: boolean };
}

export interface Policy {
  /** Spending stops for the day once this is reached. */
  dailyBudgetUsd: number;
  /** Any single action costing more than this waits for the owner. 0 = everything waits. */
  approvalOverUsd: number;
  /** Run shifts on their own. Off = only when the owner presses run. */
  autopilot: boolean;
  /** Minutes between shifts on autopilot. */
  shiftMinutes: number;
  /** Before paying the swarm for research, buy a relevant, cheaper product another company already sells. */
  marketBuy: boolean;
  /** USDC the company may spend on the market in 24 hours. */
  marketDailyUsd: number;
  /** USDC at most for one product bought on the market. */
  marketMaxUsd: number;
}

export interface JournalEntry {
  at: number;
  cycle: number;
  kind: "plan" | "decision" | "result" | "sale" | "note" | "warning";
  text: string;
}

export interface Company {
  id: string;
  slug: string;
  name: string;
  idea: string;
  /** Who it serves and what it promises, written by the CEO on day one. */
  mission: string;
  audience: string;
  createdAt: number;
  owner: string | null;
  wallet: `0x${string}`;
  policy: Policy;
  status: "active" | "paused";
  cycle: number;
  nextShiftAt: number | null;
  /** The budget is spent: no new shifts until this time (or until the owner raises the budget). */
  restUntil?: number;
  site: { url: string; jobId: string } | null;
  products: Product[];
  tasks: Task[];
  journal: JournalEntry[];
  marketing: { at: number; channel: string; text: string; status: "drafted" | "posted" | "failed"; url?: string; error?: string }[];
  /** Created in simulation: never sells, spends or withdraws in live mode. */
  sim?: boolean;
  /** Where the company posts. The password lives in the vault, never here. */
  social?: { bluesky?: { handle: string; auto: boolean } };
  /** The owner's standing direction to the CEO: read every shift and passed to the swarm with each order. */
  direction?: string;
  /** Where the owner hears about approvals, sales, deliveries and problems: a Telegram chat linked with a one-time code. */
  notify?: { telegram: string; at: number };
  /** Products bought from and sold to other NIGHTSHIFT companies, newest last (the ledger holds every one). */
  b2b?: { bought: B2bLine[]; sold: B2bLine[] };
}

export const USDC_DECIMALS = 6;
export const usdc = (dollars: number): bigint => BigInt(Math.round(dollars * 1e6));
export const fromUsdc = (v: bigint): number => Number(v) / 1e6;
export const fromImd = (v: bigint): number => Number(v / 10n ** 12n) / 1e6;
