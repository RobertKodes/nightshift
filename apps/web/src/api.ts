export interface Health { ok: boolean; mode: "sim" | "live"; llm: boolean; imdUsd: number | null; salesChainId: number; requireAuth: boolean; platformFeeBps: number }

export interface TaskView {
  id: string; cycle: number; kind: string; title: string; why: string; status: string;
  stepsDone: number; stepsTotal: number; activity: string | null; costImd: string; error: string | null;
  imd?: { action: string; orderId?: string; jobId?: string; txHash?: string; plan?: string[] };
  result: { siteUrl?: string | null; files?: Record<string, string>; note?: string } | null;
  createdAt: number; updatedAt: number;
}
export interface ProductView { id: string; name: string; kind: string; pitch: string; priceUsdc: string; priceByOwner?: boolean; status: string; deliverableUrl: string | null; sales: number; revenueUsdc: string; createdAt: number }
export interface JournalView { at: number; cycle: number; kind: string; text: string }
export interface Policy {
  dailyBudgetUsd: number; approvalOverUsd: number; autopilot: boolean; shiftMinutes: number;
  /** Buy research from another company on the market first, within these USDC limits. */
  marketBuy?: boolean; marketDailyUsd?: number; marketMaxUsd?: number;
}

export interface CompanyFull {
  id: string; slug: string; name: string; idea: string; mission: string; audience: string; createdAt: number;
  wallet: string; policy: Policy; status: "active" | "paused"; cycle: number; nextShiftAt: number | null;
  site: { url: string; jobId: string } | null; products: ProductView[]; tasks: TaskView[]; journal: JournalView[];
  marketing: { at: number; channel: string; text: string; status: string; url?: string; error?: string }[];
  social?: { bluesky?: { handle: string; auto: boolean } };
  direction?: string;
  holder: { symbol: string; holds: boolean; balance: number; min: number } | null;
  platformFeeBps: number;
  stats: { visits7d: number; sales7d: number; revenue7dUsd: number };
  pnl: { revenueUsd: number; spentImd: number; spentUsd: number; profitUsd: number; imdBalance: number };
  recentSales: { at: number; productId: string; usdc: string; payer: string; tx: string | null; sim: boolean }[];
  series: { bucketMs: number; points: { t: number; visits: number; revenue: number }[] };
  withdrawableUsd: number;
  isOwner: boolean;
  owner: string | null;
}

export interface CompanyCard {
  id: string; slug: string; name: string; mission: string; status: string; cycle: number; site: string | null;
  products: { id: string; name: string; priceUsd: number; sales: number; b2bSales?: number; buyUrl: string; pitch: string; kind: string }[];
  pnl: { revenueUsd: number; spentUsd: number; sales: number }; nextShiftAt: number | null;
  working: { title: string; status: string; activity: string | null } | null; createdAt: number; wallet: string;
  /** The signed-in viewer owns it: the card opens the owner's view instead of the public page. */
  mine?: boolean;
}

export interface PublicCompany extends Omit<CompanyCard, "id" | "nextShiftAt" | "working"> {
  audience: string; shifts: { id: string; cycle: number; kind: string; title: string; status: string; costUsd: number; market?: boolean }[]; mode: "sim" | "live";
  /** Sales to and purchases from other NIGHTSHIFT companies, never added to the sales above. */
  b2b: { sales: number; revenueUsd: number; bought: number; spentUsd: number };
}

/** Why a product on the market was or was not bought, in the flight recorder. */
export type MarketVerdict = "picked" | "relevant" | "irrelevant" | "pricier" | "over_max" | "same_owner" | "own" | "owned" | "demo" | "cap" | "funds";
export interface FlightMarket {
  at: number; by: "model" | "keywords"; threshold: number; swarmUsd: number; decision: string; fallback?: string; query?: string; pending: boolean;
  candidates: { company: string; slug: string; productId: string; name: string; kind: string; priceUsd: number; score: number; verdict: MarketVerdict; why?: string }[];
  bought: { company: string; slug: string; productId: string; name: string; usd: number; sim: boolean; tx: string | null; txUrl: string | null } | null;
}
/** One B2B purchase or sale, as the owner desk lists it. */
export interface B2bItem { at: number; taskId: string; product: string; kind: string; usd: number; with: string; slug: string; tx: string | null; sim: boolean }

/** One span of a shift's flight record (the @nightshift/trace shape). */
export interface FlightSpan {
  id: string; parentId: string | null; kind: string; name: string; startedAt: number; endedAt: number | null; status: "running" | "ok" | "error";
  attrs: { log?: { at: number; text: string }[]; error?: string; by?: string; model?: string; fallback?: string; why?: string; [k: string]: unknown };
  costUsd: number; totalCostUsd: number; children: FlightSpan[];
}
export interface Flight {
  id: string; cycle: number; kind: string; title: string; why: string; status: string; error: string | null;
  createdAt: number; endedAt: number | null; durationMs: number; activity: string | null; recorded: boolean;
  mind: { by: "model" | "playbook" | "owner"; costUsd: number; model?: string; fallback?: string; saw: { visits7d: number; sales7d: number; revenue7dUsd: number; imdUsd: number; liveProducts: number; direction: boolean } } | null;
  plan: string[]; steps: { done: number; total: number }; trace: FlightSpan[];
  money: { costImd: number; costUsd: number; costUsdc?: number; imdUsd: number; ledger: { id: string; kind: string; memo?: string; at: number; legs: { account: string; asset: string; amount: number }[] }[] };
  /** Research: the market search before paying the swarm (candidates, scores, decision). */
  market?: FlightMarket | null;
  payback: { kind: "product"; name: string; status: string; sales: number; revenueUsd: number; costUsd: number; ratio: number | null; recent: { at: number; usd: number; payer?: string; tx?: string | null }[] } | { kind: "site"; visits: number; costUsd: number } | null;
  receipts: { orderId: string | null; jobId: string | null; jobUrl: string | null; txHash: string | null; txUrl: string | null; siteUrl: string | null; files: Record<string, string> | null };
  brief?: string;
  company: { name: string; slug: string };
}

/** The owner desk: the caller's companies, with what needs them, and the ones they deleted. */
export interface DeskCompany {
  id: string; slug: string; name: string; idea: string; mission: string; audience: string; direction: string;
  status: "active" | "paused"; cycle: number; createdAt: number; nextShiftAt: number | null; wallet: string; sim: boolean;
  /** Resting: the saver found nothing new worth paying for, or the day's budget is spent. A shift the owner runs ends it. */
  rest: { until: number; why: "saver" | "budget" } | null;
  policy: Policy; site: string | null; alerts: boolean;
  products: { id: string; name: string; pitch: string; kind: string; status: string; priceUsd: number; priceByOwner: boolean; sales: number; revenueUsd: number; b2bSales: number; packaged: boolean }[];
  pnl: { revenueUsd: number; spentUsd: number; profitUsd: number };
  /** Bought from and sold to other NIGHTSHIFT companies, apart from revenue from people and agents. */
  b2b: { bought: { count: number; usd: number; items: B2bItem[] }; sold: { count: number; usd: number; items: B2bItem[] }; usdcUsd: number };
  stats: { visits7d: number; sales7d: number; revenue7dUsd: number };
  working: { id: string; title: string; status: string; activity: string | null } | null;
  waiting: { id: string; cycle: number; title: string; why: string; costUsd: number; market?: { product: string; company: string; swarmUsd: number } }[];
  last: { id: string; cycle: number; title: string; status: string; at: number } | null;
}
export interface Desk {
  mode: "sim" | "live"; requireAuth: boolean; signedIn: boolean; imdUsd: number; bot: boolean;
  companies: DeskCompany[];
  archived: { id: string; slug: string; name: string; mission: string; archivedAt: number; products: number; sales: number }[];
}

/**
 * A session token the page holds itself, only where no cookie can reach: the Telegram Mini App
 * framed inside Telegram Web. Everywhere else the session stays in the HttpOnly cookie.
 */
let bearer: string | null = null;
export function setBearer(token: string | null): void { bearer = token; }
export const authHeaders = (): Record<string, string> => (bearer ? { Authorization: `Bearer ${bearer}` } : {});

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}

export interface ApiKeyView { id: string; label: string; createdAt: number; lastUsedAt: number | null }

export const api = {
  health: () => req<Health>("GET", "/api/health"),
  me: () => req<{ address: string | null; requireAuth: boolean }>("GET", "/api/auth/me"),
  nonce: (address: string) => req<{ nonce: string; message: string }>("GET", `/api/auth/nonce?address=${address}`),
  verify: (address: string, nonce: string, signature: string) => req<{ token?: string; address: string }>("POST", "/api/auth/verify", { address, nonce, signature }),
  logout: () => req("POST", "/api/auth/logout"),
  logoutAll: () => req("POST", "/api/auth/logout-all"),
  keys: () => req<ApiKeyView[]>("GET", "/api/keys"),
  createKey: (label: string) => req<{ key: string; record: ApiKeyView }>("POST", "/api/keys", { label }),
  revokeKey: (id: string) => req("DELETE", `/api/keys/${id}`),
  withdraw: (id: string, amountUsd?: number) => req<{ ok: boolean; sentUsd: number; feeUsd: number; txs: string[] }>("POST", `/api/companies/${id}/withdraw`, amountUsd ? { amountUsd } : {}),
  companies: (mine = false) => req<CompanyCard[]>("GET", `/api/companies${mine ? "?mine=1" : ""}`),
  company: (id: string) => req<CompanyFull>("GET", `/api/companies/${id}`),
  publicCompany: (slug: string) => req<PublicCompany>("GET", `/api/public/${slug}`),
  create: (idea: string, policy: Partial<Policy>) => req<{ id: string; slug: string }>("POST", "/api/companies", { idea, policy }),
  shift: (id: string) => req("POST", `/api/companies/${id}/shift`),
  connectBluesky: (id: string, handle: string, appPassword: string, auto: boolean) => req<{ handle: string }>("POST", `/api/companies/${id}/social`, { handle, appPassword, auto }),
  disconnectBluesky: (id: string) => req("POST", `/api/companies/${id}/social/disconnect`),
  publishPost: (id: string, i: number) => req<{ url: string }>("POST", `/api/companies/${id}/posts/${i}/publish`),
  closeOut: (id: string) => req<{ ok: boolean; txs: string[]; returned: string[] }>("POST", `/api/companies/${id}/close`, {}),
  pause: (id: string) => req("POST", `/api/companies/${id}/pause`),
  resume: (id: string) => req("POST", `/api/companies/${id}/resume`),
  price: (id: string, product: string, priceUsd: number) => req("POST", `/api/companies/${id}/products/${product}/price`, { priceUsd }),
  policy: (id: string, p: Partial<Policy>) => req<Policy>("POST", `/api/companies/${id}/policy`, p),
  approve: (id: string, task: string) => req("POST", `/api/companies/${id}/tasks/${task}/approve`),
  reject: (id: string, task: string) => req("POST", `/api/companies/${id}/tasks/${task}/reject`),
  flight: (id: string, task: string) => req<Flight>("GET", `/api/companies/${id}/shifts/${task}`),
  publicFlight: (slug: string, task: string) => req<Flight>("GET", `/api/public/${slug}/shifts/${task}`),
  desk: () => req<Desk>("GET", "/api/my/companies"),
  profile: (id: string, p: Partial<Pick<DeskCompany, "name" | "mission" | "audience" | "idea" | "direction">>) => req("POST", `/api/companies/${id}/profile`, p),
  product: (id: string, product: string, p: { name?: string; pitch?: string; status?: "live" | "retired" }) => req("POST", `/api/companies/${id}/products/${product}`, p),
  commission: (id: string, w: { kind: "research" | "build_product" | "build_site" | "improve_site"; brief?: string; name?: string; pitch?: string; priceUsd?: number; productKind?: string }) => req<{ ok: boolean; taskId: string; status: string; error: string | null }>("POST", `/api/companies/${id}/commission`, w),
  alertLink: (id: string) => req<{ url: string; code: string }>("POST", `/api/companies/${id}/alerts`),
  alertsOff: (id: string) => req("POST", `/api/companies/${id}/alerts/off`),
  remove: (id: string, confirm: string) => req("POST", `/api/companies/${id}/delete`, { confirm }),
  restore: (id: string) => req<{ ok: boolean; id: string }>("POST", `/api/my/archived/${id}/restore`),
};

/** Subscribes to the engine's live events, optionally for one company. */
export function events(onEvent: (e: { type: string; companyId: string; payload: unknown; at: number }) => void, company?: string): () => void {
  const es = new EventSource(`/api/events${company ? `?company=${company}` : ""}`);
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* ignore */ } };
  return () => es.close();
}

export const usd = (n: number, d = 2) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const fromUsdc = (s: string) => Number(s) / 1e6;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export function until(ms: number | null): string {
  if (!ms) return "manual";
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (s < 60) return `in ${s}s`;
  if (s < 3600) return `in ${Math.floor(s / 60)}m ${s % 60}s`;
  return `in ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
