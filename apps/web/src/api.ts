export interface Health { ok: boolean; mode: "sim" | "live"; llm: boolean; model: string; imdUsd: number; salesChainId: number }

export interface TaskView {
  id: string; cycle: number; kind: string; title: string; why: string; status: string;
  stepsDone: number; stepsTotal: number; activity: string | null; costImd: string; error: string | null;
  imd?: { action: string; orderId?: string; jobId?: string; txHash?: string; plan?: string[] };
  result: { siteUrl?: string | null; files?: Record<string, string>; note?: string } | null;
  createdAt: number; updatedAt: number;
}
export interface ProductView { id: string; name: string; kind: string; pitch: string; priceUsdc: string; status: string; deliverableUrl: string | null; sales: number; revenueUsdc: string; createdAt: number }
export interface JournalView { at: number; cycle: number; kind: string; text: string }
export interface Policy { dailyBudgetUsd: number; approvalOverUsd: number; autopilot: boolean; shiftMinutes: number }

export interface CompanyFull {
  id: string; slug: string; name: string; idea: string; mission: string; audience: string; createdAt: number;
  wallet: string; policy: Policy; status: "active" | "paused"; cycle: number; nextShiftAt: number | null;
  site: { url: string; jobId: string } | null; products: ProductView[]; tasks: TaskView[]; journal: JournalView[];
  marketing: { at: number; channel: string; text: string; status: string }[];
  stats: { visits7d: number; sales7d: number; revenue7dUsd: number };
  pnl: { revenueUsd: number; spentImd: number; spentUsd: number; profitUsd: number; imdBalance: number };
  recentSales: { at: number; productId: string; usdc: string; payer: string; tx: string | null; sim: boolean }[];
  series: { bucketMs: number; points: { t: number; visits: number; revenue: number }[] };
}

export interface CompanyCard {
  id: string; slug: string; name: string; mission: string; status: string; cycle: number; site: string | null;
  products: { id: string; name: string; priceUsd: number; sales: number; buyUrl: string; pitch: string; kind: string }[];
  pnl: { revenueUsd: number; spentUsd: number; sales: number }; nextShiftAt: number | null;
  working: { title: string; status: string; activity: string | null } | null; createdAt: number; wallet: string;
}

export interface PublicCompany extends Omit<CompanyCard, "id" | "nextShiftAt" | "working"> {
  audience: string; shifts: { cycle: number; kind: string; title: string; status: string }[]; mode: "sim" | "live";
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}

export const api = {
  health: () => req<Health>("GET", "/api/health"),
  companies: () => req<CompanyCard[]>("GET", "/api/companies"),
  company: (id: string) => req<CompanyFull>("GET", `/api/companies/${id}`),
  publicCompany: (slug: string) => req<PublicCompany>("GET", `/api/public/${slug}`),
  create: (idea: string, policy: Partial<Policy>) => req<{ id: string; slug: string }>("POST", "/api/companies", { idea, policy }),
  shift: (id: string) => req("POST", `/api/companies/${id}/shift`),
  pause: (id: string) => req("POST", `/api/companies/${id}/pause`),
  resume: (id: string) => req("POST", `/api/companies/${id}/resume`),
  policy: (id: string, p: Partial<Policy>) => req<Policy>("POST", `/api/companies/${id}/policy`, p),
  approve: (id: string, task: string) => req("POST", `/api/companies/${id}/tasks/${task}/approve`),
  reject: (id: string, task: string) => req("POST", `/api/companies/${id}/tasks/${task}/reject`),
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
