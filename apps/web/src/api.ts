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
  /** USDC the CEO may spend on the strong model in 24 hours, from the company's own wallet. 0 = the free model only. */
  aiDailyUsd?: number;
}

/** A button under a CEO chat answer: pressed by the owner, done by the engine with exactly these fields. */
export type ChatAction = { id: string; state?: "done" | "failed"; note?: string } & (
  | { type: "order"; kind: "research" | "build_product" | "build_site" | "improve_site"; title: string; brief: string; name?: string; pitch?: string; priceUsd?: number; productKind?: string }
  | { type: "todo"; text: string }
  | { type: "post"; where: string; text: string }
  | { type: "connect"; to: string; why: string }
  | { type: "buy"; sellerId: string; seller: string; productId: string; name: string; priceUsd: number; why: string }
);
export interface ChatLine { id: string; at: number; from: "owner" | "ceo"; text: string; actions?: ChatAction[]; model?: string }
export interface ChatView {
  lines: ChatLine[];
  brain: { strong: boolean; model: string | null; leftUsd: number | null; dailyUsd: number; spentTodayUsd: number; spentTotalUsd: number; usdcUsd: number };
}

export interface CompanyFull {
  id: string; slug: string; name: string; idea: string; mission: string; audience: string; createdAt: number;
  wallet: string; policy: Policy; status: "active" | "paused"; cycle: number; nextShiftAt: number | null;
  site: { url: string; jobId: string } | null; products: ProductView[]; tasks: TaskView[]; journal: JournalView[];
  marketing: { at: number; channel: string; text: string; status: string; url?: string; error?: string }[];
  /** The owner's connected accounts and the posts written for them (no secret is ever here). */
  connections?: { channels: Partial<Record<ChannelKind, { label: string; url: string | null }>>; posts: { id: string; at: number; channel: ChannelKind; text: string; status: string; url?: string; error?: string; sentAt?: number; sim?: boolean }[] };
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
  /** The accounts its owner connected and chose to show. */
  channels?: { kind: string; name: string; label: string; url: string; sim: boolean }[];
}

/** Where a company posts, on accounts its owner made. */
export type ChannelKind = "bluesky" | "telegram" | "mastodon" | "discord";
/** One thing done through a connected account, and how it went. */
export interface ConnEntry { at: number; channel: ChannelKind | "gumroad"; what: string; result: "ok" | "failed" | "waiting" | "blocked" | "sim"; detail?: string; url?: string; taskId?: string }
export interface DeskPost { id: string; channel: ChannelKind; about: string; text: string; status: string; wait: string | null; at: number; sentAt: number | null; url: string | null; error: string | null; sim: boolean; taskId: string | null }
export interface DeskChannel {
  kind: ChannelKind; name: string; max: number; limit: number; available: boolean; bot: string | null;
  account: { label: string; url: string | null; connectedAt: number; approveEach: boolean; dailyMax: number; trusted: boolean; listed: boolean; botFlag: boolean; paused: { at: number; why: string } | null; sim: boolean; today: number } | null;
  last: ConnEntry | null;
}
/** The owner desk's Connections tab: the owner's own accounts and what the CEO did with them. */
export interface DeskConnections {
  sim: boolean;
  gumroad: {
    available: boolean;
    account: { name: string; url: string | null; connectedAt: number; scopes: string; webhooks: boolean; polledAt: number | null; sim: boolean } | null;
    listings: { productId: string; product: string; priceUsd: number; onSale: boolean; taskId: string; state: "draft" | "published" | "unpublished" | null; url: string | null; approved: boolean; declined: boolean; file: boolean; cover: boolean; sales: number; revenueUsd: number; blocked: string | null; error: string | null; sim: boolean }[];
    next: number;
    approvals: { productId: string; product: string; priceUsd: number; url: string | null; file: boolean }[];
    redirect: string;
  };
  channels: DeskChannel[];
  quiet: { from: number; to: number; tz: string };
  approvals: DeskPost[]; queued: DeskPost[]; recent: DeskPost[];
  log: ConnEntry[];
  mastodonRedirect: string;
  alertsLinked: boolean;
}
/** A test post: what the channel would get now, and the request, with nothing sent. */
export interface PostPreview { channel: ChannelKind; about: string; sample: boolean; text: string; chars: number; limit: number; request: { method: string; url: string; body: unknown }; wait: string | null; sent: false }

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
  mind: { by: "model" | "playbook" | "owner"; costUsd: number; model?: string; fallback?: string; avoided?: string[]; saw: { visits7d: number; sales7d: number; revenue7dUsd: number; imdUsd: number; liveProducts: number; direction: boolean } } | null;
  plan: string[]; steps: { done: number; total: number }; trace: FlightSpan[];
  money: { costImd: number; costUsd: number; costUsdc?: number; imdUsd: number; ledger: { id: string; kind: string; memo?: string; at: number; legs: { account: string; asset: string; amount: number }[] }[] };
  /** Research: the market search before paying the swarm (candidates, scores, decision). */
  market?: FlightMarket | null;
  payback: { kind: "product"; name: string; status: string; sales: number; revenueUsd: number; costUsd: number; ratio: number | null; recent: { at: number; usd: number; payer?: string; tx?: string | null }[] } | { kind: "site"; visits: number; costUsd: number } | null;
  /** Each post and Gumroad action of this shift through the owner's connected accounts, with its result. */
  connections?: { at: number; channel: ChannelKind | "gumroad"; what: string; result: ConnEntry["result"]; url?: string; detail?: string }[];
  receipts: { orderId: string | null; jobId: string | null; jobUrl: string | null; txHash: string | null; txUrl: string | null; siteUrl: string | null; files: Record<string, string> | null };
  brief?: string;
  company: { name: string; slug: string };
}

/** The owner desk: the caller's companies, with what needs them, and the ones they deleted. */
export interface DeskCompany {
  id: string; slug: string; name: string; idea: string; mission: string; audience: string; direction: string;
  status: "active" | "paused"; cycle: number; createdAt: number; nextShiftAt: number | null; wallet: string; sim: boolean;
  /** Resting: the saver found nothing new worth paying for, or the day's budget is spent. A shift the owner runs ends it. */
  rest: { until: number; why: "saver" | "budget"; reason?: string | null } | null;
  policy: Policy; site: string | null; alerts: boolean;
  products: { id: string; name: string; pitch: string; kind: string; status: string; priceUsd: number; priceByOwner: boolean; sales: number; revenueUsd: number; b2bSales: number; packaged: boolean }[];
  pnl: { revenueUsd: number; spentUsd: number; profitUsd: number };
  /** Bought from and sold to other NIGHTSHIFT companies, apart from revenue from people and agents. */
  b2b: { bought: { count: number; usd: number; items: B2bItem[] }; sold: { count: number; usd: number; items: B2bItem[] }; usdcUsd: number };
  stats: { visits7d: number; sales7d: number; revenue7dUsd: number };
  working: { id: string; title: string; status: string; activity: string | null } | null;
  waiting: { id: string; cycle: number; title: string; why: string; costUsd: number; market?: { product: string; company: string; swarmUsd: number } }[];
  last: { id: string; cycle: number; title: string; status: string; at: number } | null;
  connections: DeskConnections;
  /** Gumroad sales: the owner's money on Gumroad, in USD, apart from USDC revenue. */
  gumroad: { sales: number; usd: number };
}
export interface Desk {
  mode: "sim" | "live"; requireAuth: boolean; signedIn: boolean; imdUsd: number; bot: boolean;
  companies: DeskCompany[];
  archived: { id: string; slug: string; name: string; mission: string; archivedAt: number; products: number; sales: number }[];
}

/**
 * A session token the page holds itself, only where no cookie can reach (a framed page). Nothing sets
 * one since the Telegram Mini App was removed: the session stays in the HttpOnly cookie.
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
  publicCompany: (slug: string, via?: string | null) => req<PublicCompany>("GET", `/api/public/${slug}${via ? `?via=${encodeURIComponent(via)}` : ""}`),
  create: (idea: string, policy: Partial<Policy>) => req<{ id: string; slug: string }>("POST", "/api/companies", { idea, policy }),
  shift: (id: string) => req("POST", `/api/companies/${id}/shift`),
  closeOut: (id: string) => req<{ ok: boolean; txs: string[]; returned: string[] }>("POST", `/api/companies/${id}/close`, {}),
  pause: (id: string) => req("POST", `/api/companies/${id}/pause`),
  resume: (id: string) => req("POST", `/api/companies/${id}/resume`),
  price: (id: string, product: string, priceUsd: number) => req("POST", `/api/companies/${id}/products/${product}/price`, { priceUsd }),
  chat: (id: string) => req<ChatView>("GET", `/api/companies/${id}/chat`),
  say: (id: string, text: string) => req<{ lines: ChatLine[] }>("POST", `/api/companies/${id}/chat`, { text }),
  chatAct: (id: string, line: string, action: string) => req<{ ok: boolean; note: string; taskId?: string; state?: string }>("POST", `/api/companies/${id}/chat/act`, { line, action }),
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
  // ---- Connections: the owner's own accounts
  gumroadConnect: (id: string) => req<{ url: string }>("POST", `/api/companies/${id}/connect/gumroad`),
  gumroadDisconnect: (id: string) => req("POST", `/api/companies/${id}/connect/gumroad/disconnect`),
  gumroadApprove: (id: string, product: string) => req("POST", `/api/companies/${id}/connect/gumroad/approve/${product}`),
  gumroadDecline: (id: string, product: string) => req("POST", `/api/companies/${id}/connect/gumroad/decline/${product}`),
  connectChannel: (id: string, kind: ChannelKind, body: Record<string, string>) => req<{ ok?: boolean; label?: string; url?: string }>("POST", `/api/companies/${id}/connect/${kind}`, body),
  disconnectChannel: (id: string, kind: ChannelKind) => req("POST", `/api/companies/${id}/connect/${kind}/disconnect`),
  channelSettings: (id: string, kind: ChannelKind, p: { approveEach?: boolean; dailyMax?: number; listed?: boolean; resume?: boolean }) => req("POST", `/api/companies/${id}/connect/${kind}/settings`, p),
  testPost: (id: string, kind: ChannelKind) => req<PostPreview>("POST", `/api/companies/${id}/connect/${kind}/test`),
  quiet: (id: string, q: { from: number; to: number; tz: string }) => req("POST", `/api/companies/${id}/connect/quiet`, q),
  approvePost: (id: string, post: string) => req("POST", `/api/companies/${id}/connect/posts/${post}/approve`),
  rejectPost: (id: string, post: string) => req("POST", `/api/companies/${id}/connect/posts/${post}/reject`),
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
