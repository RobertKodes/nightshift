/**
 * What the engine's owner routes return (apps/engine/src/server.ts), the same shapes the web owner
 * desk reads (apps/web/src/api.ts). Only views: no engine code runs in the app.
 */

export interface Policy {
  dailyBudgetUsd: number; approvalOverUsd: number; autopilot: boolean; shiftMinutes: number;
  marketBuy?: boolean; marketDailyUsd?: number; marketMaxUsd?: number; aiDailyUsd?: number;
}

export interface Waiting {
  id: string; cycle: number; title: string; why: string; reason: string | null; at: number;
  /** the price it was held at: what the phone signs */
  costUsd: number; imd?: number;
  market?: { product: string; company: string; swarmUsd: number };
}

export interface DeskProduct { id: string; name: string; pitch: string; kind: string; status: string; priceUsd: number; priceByOwner: boolean; sales: number; revenueUsd: number; b2bSales: number; packaged: boolean; format?: string }

export interface DeskCompany {
  id: string; slug: string; name: string; idea: string; mission: string; audience: string; direction: string;
  status: "active" | "paused"; cycle: number; createdAt: number; nextShiftAt: number | null; wallet: string; sim: boolean;
  rest: { until: number; why: "saver" | "budget"; reason?: string | null } | null;
  policy: Policy; site: string | null; alerts: boolean;
  products: DeskProduct[];
  pnl: { revenueUsd: number; spentUsd: number; profitUsd: number };
  todayUsd: number;
  b2b: { bought: { count: number; usd: number }; sold: { count: number; usd: number }; usdcUsd: number };
  stats: { visits7d: number; sales7d: number; revenue7dUsd: number };
  working: { id: string; title: string; status: string; activity: string | null } | null;
  waiting: Waiting[];
  last: { id: string; cycle: number; title: string; status: string; at: number } | null;
}

export interface Desk {
  mode: "sim" | "live"; requireAuth: boolean; signedIn: boolean; imdUsd: number; bot: boolean;
  companies: DeskCompany[];
  archived: { id: string; slug: string; name: string; mission: string; archivedAt: number; products: number; sales: number }[];
}

export interface TaskView {
  id: string; cycle: number; kind: string; title: string; why: string; status: string;
  stepsDone: number; stepsTotal: number; activity: string | null; costImd: string; error: string | null;
  createdAt: number; updatedAt: number;
}
export interface JournalEntry { at: number; cycle: number; kind: string; text: string }
export interface ProductView { id: string; name: string; kind: string; pitch: string; priceUsdc: string; priceByOwner?: boolean; status: string; sales: number; revenueUsdc: string; createdAt: number }

export interface CompanyFull {
  id: string; slug: string; name: string; idea: string; mission: string; audience: string; createdAt: number;
  wallet: string; policy: Policy; status: "active" | "paused"; cycle: number; nextShiftAt: number | null;
  site: { url: string } | null; products: ProductView[]; tasks: TaskView[]; journal: JournalEntry[];
  direction?: string; sim?: boolean;
  stats: { visits7d: number; sales7d: number; revenue7dUsd: number };
  pnl: { revenueUsd: number; spentImd: number; spentUsd: number; profitUsd: number; imdBalance: number; b2bSoldUsd?: number; b2bBoughtUsd?: number; aiUsd?: number };
  todayUsd: number;
  recentSales: { at: number; productId: string; usdc: string; payer: string; tx: string | null; sim: boolean }[];
  withdrawableUsd: number;
  isOwner: boolean;
}

export interface EngineEvent { type: "task" | "journal" | "company" | "sale" | "approval"; companyId: string; payload: unknown; at: number; id?: string }

export type ChatAction = { id: string; state?: "done" | "failed"; note?: string } & (
  | { type: "order"; kind: "research" | "build_product" | "build_site" | "improve_site"; title: string; brief: string; name?: string; pitch?: string; priceUsd?: number; productKind?: string }
  | { type: "todo"; text: string }
  | { type: "post"; where: string; text: string }
  | { type: "connect"; to: string; why: string }
  | { type: "buy"; sellerId: string; seller: string; productId: string; name: string; priceUsd: number; why: string }
);
export interface ChatLine { id: string; at: number; from: "owner" | "ceo"; text: string; actions?: ChatAction[] }
export interface ChatView {
  lines: ChatLine[];
  brain: { strong: boolean; paid: boolean; leftUsd: number | null; dailyUsd: number; spentTodayUsd: number; spentTotalUsd: number; usdcUsd: number };
}

export interface FlightSpan {
  id: string; parentId: string | null; kind: string; name: string; startedAt: number; endedAt: number | null; status: "running" | "ok" | "error";
  attrs: { log?: { at: number; text: string }[]; error?: string; why?: string; [k: string]: unknown };
  costUsd: number; totalCostUsd: number; children: FlightSpan[];
}
export interface Flight {
  id: string; cycle: number; kind: string; title: string; why: string; status: string; error: string | null;
  createdAt: number; endedAt: number | null; durationMs: number; activity: string | null; recorded: boolean;
  mind: { by: "model" | "playbook" | "owner"; costUsd: number; avoided?: string[]; saw: { visits7d: number; sales7d: number; revenue7dUsd: number; imdUsd: number; liveProducts: number; direction: boolean } } | null;
  plan: string[]; steps: { done: number; total: number }; trace: FlightSpan[];
  money: { costImd: number; costUsd: number; costUsdc?: number; imdUsd: number; ledger: { id: string; kind: string; memo?: string; at: number; legs: { account: string; asset: string; amount: number }[] }[] };
  market?: { decision: string; swarmUsd: number; candidates: { company: string; name: string; priceUsd: number; score: number; verdict: string }[]; bought: { company: string; name: string; usd: number } | null } | null;
  payback: { kind: "product"; name: string; status: string; sales: number; revenueUsd: number; costUsd: number; ratio: number | null } | { kind: "site"; visits: number; costUsd: number } | null;
  receipts: { orderId: string | null; jobId: string | null; jobUrl: string | null; txHash: string | null; txUrl: string | null; siteUrl: string | null; files: Record<string, string> | null };
  company: { name: string; slug: string };
}

export interface BooksView {
  days: number | null; imdUsd: number;
  totals: { salesUsd: number; b2bSoldUsd: number; swarmImd: number; swarmUsd: number; b2bBoughtUsd: number; aiUsd: number; profitUsd: number; fundedImd: number; fundedUsd: number; withdrawnUsd: number };
  byDay: { day: string; revenueUsd: number; spendUsd: number }[];
  lines: { at: number; kind: string; memo: string; amount: number; asset: string; tx: string | null }[];
}

export interface DeviceView { id: string; name: string; platform: string; push: boolean; prefs: Record<"approval" | "sale" | "result" | "warning", boolean>; at: number; lastSeenAt: number }
export interface ApiKeyView { id: string; label: string; createdAt: number; lastUsedAt: number | null; spend?: boolean }
/** GET /api/wallet-config: the Reown project the site uses, its origin, the sales chain, and whether email sign-in is on. */
export interface WalletConfig { walletConnect: string | null; site: string; salesChainId: number; social: boolean }
