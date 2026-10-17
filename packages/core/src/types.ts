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
  sales: number;
  revenueUsdc: bigint;
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
  /** Where the company posts. The password lives in the vault, never here. */
  social?: { bluesky?: { handle: string; auto: boolean } };
}

export const USDC_DECIMALS = 6;
export const usdc = (dollars: number): bigint => BigInt(Math.round(dollars * 1e6));
export const fromUsdc = (v: bigint): number => Number(v) / 1e6;
export const fromImd = (v: bigint): number => Number(v / 10n ** 12n) / 1e6;
