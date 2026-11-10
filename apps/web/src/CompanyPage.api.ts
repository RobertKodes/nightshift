import { type CompanyCard, type CompanyFull, type PublicCompany, authHeaders } from "./api";

/**
 * The companies v2 API, as the founding form, the owner's page, the shop and the market use it:
 * founding with no funding step, free shifts, the CEO's questions, drafts that wait for the owner,
 * made-to-order products, export and closing.
 */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, credentials: "include", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
  const j = (await r.json().catch(() => ({}))) as { error?: string; errors?: string[]; refused?: boolean };
  if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status, errors: j.errors, refused: j.refused === true });
  return j as T;
}

/** Free or funded, the free shifts used, and when the company works next. */
export interface Plan {
  funded: boolean;
  free: { used: number; total: number; left: number; pace: "first" | "slow"; everyHours: number; everyMinutes: number; queued: { until: number } | null };
  nextShiftAt: number | null;
}
export interface OwnerAsk { id: string; at: number; topic: string; text: string; status: "open" | "done" | "dismissed" }

/** The owner's view, with what v2 adds to it. */
export type CompanyV2 = CompanyFull & {
  plan?: Plan;
  /** A shift is running: the CEO is deciding or starting a move. */
  thinking?: boolean;
  shopUrl?: string;
  asks?: OwnerAsk[];
  hidden?: { at: number; reason: string; by: "auto" | "admin" };
  todayUsd?: number;
};

export interface CustomField { key: string; label: string; type: "text" | "textarea" | "select"; required: boolean; min: number; max: number; options?: string[]; help?: string }
/** A made-for-you product's form and promises, and a sample made from a made-up example. */
export interface CustomView { recipe: string; label: string; delivers: string; limits: string; fields: CustomField[]; delivered: number; sample: string | null }
export interface DownloadView { pages: number; sheets: number; lines: number; mb: number; images: string[]; outline: string[] }
export type ShopProduct = PublicCompany["products"][number] & {
  format?: "planner" | "custom" | "download";
  packaged?: boolean;
  custom?: CustomView;
  download?: DownloadView;
  /** The same product on the owner's own Gumroad, where people pay by card. */
  gumroadUrl?: string;
  delivery?: { type: string; what: string };
};
export type ShopCompany = Omit<PublicCompany, "products"> & { products: ShopProduct[]; plan?: "free" | "funded" };
export type CardV2 = CompanyCard & { plan?: "free" | "funded"; hidden?: boolean };

export interface MadeOrderView {
  id: string; status: "writing" | "ready" | "failed" | "paid"; createdAt: number; readyAt: number | null; paid: boolean;
  preview?: { outline: string[]; opening: string; words: number };
  problems?: string[];
  inLine?: number;
}
export interface OrderAnswer { order: MadeOrderView; buy: string; deliverable?: string }

const first = (): string => { try { return localStorage.getItem("ns-from") ?? "direct"; } catch { return "direct"; } };

export const v2 = {
  /** "Surprise me": an idea to found on. Never fails for a busy model. */
  surprise: () => call<{ idea: string; by: "model" | "pool" }>("POST", "/api/ideas/surprise"),
  /** Founds the company. No funding: its first free shift starts at once. */
  found: (idea: string) => call<{ id: string; slug: string; name: string; shop: string }>("POST", "/api/companies", { idea, via: "web", from: first() }),
  company: (id: string) => call<CompanyV2>("GET", `/api/companies/${id}`),
  shop: (slug: string, via?: string | null) => call<ShopCompany>("GET", `/api/public/${slug}${via ? `?via=${encodeURIComponent(via)}` : ""}`),
  answerAsk: (id: string, ask: string, status: "done" | "dismissed") => call("POST", `/api/companies/${id}/asks/${ask}`, { status }),
  decideDraft: (id: string, at: number, yes: boolean) => call("POST", `/api/companies/${id}/drafts/${at}/${yes ? "approve" : "reject"}`),
  simFund: (id: string) => call("POST", `/api/companies/${id}/sim-fund`),
  /** Closes the company in one step: live funds go back to the owner first; it is archived and can be restored. */
  shutdown: (id: string) => call<{ ok: boolean; returned: string[]; txs: string[] }>("POST", `/api/companies/${id}/shutdown`, {}),
  exportUrl: (id: string) => `/api/companies/${id}/export.zip`,
  /** Orders a made-for-you file: it is written and checked first, and paid for only once it is ready. */
  order: (company: string, product: string, input: Record<string, string>) => call<OrderAnswer>("POST", "/api/orders", { company, product, input }),
  /** The order's state; answers when the file is written, or after 25 seconds. */
  orderState: (id: string) => call<OrderAnswer>("GET", `/api/orders/${id}?wait=1`),
};

/** What a product is, in the words a buyer uses. */
export const formatLabel = (p: { format?: string; kind: string }) => (p.format === "custom" ? "made for you" : p.format === "download" ? "PDF pack" : p.format === "planner" ? "planner" : p.kind);
