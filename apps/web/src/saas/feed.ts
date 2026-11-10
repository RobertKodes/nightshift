import { useEffect, useState } from "react";

/**
 * The live feed of company activity: the front page reads it.
 *
 * The engine's `GET /api/feed?limit=50` is the source. Until that route answers (a 404 on an
 * older engine), the same shape is put together from routes that already exist: the companies
 * list (who was founded, who has earned), the landing's activity lines (what the CEOs did) and
 * the proof page's customer payments (sales, with their transactions). Nothing is invented: an
 * event without a time or a company is left out.
 */
export type FeedKind = "founded" | "shift" | "product" | "sale" | "post" | "price";
export interface FeedItem {
  /** when it happened, in milliseconds */
  at: number;
  kind: FeedKind;
  company: { id: string; slug: string; name: string };
  text: string;
  amountUsd?: number;
  /** a transaction hash (or, from the older routes, a full explorer address) */
  tx?: string;
  chainId?: number;
  href?: string;
}
export interface FeedStats {
  /** companies founded */
  companies: number;
  /** companies with at least one sale */
  earned: number;
  salesUsd: number;
  sales: number;
}
export interface Feed { items: FeedItem[]; stats: FeedStats; /** "feed" from /api/feed, "derived" from the older routes */ source: "feed" | "derived" }

const KINDS: readonly FeedKind[] = ["founded", "shift", "product", "sale", "post", "price"];
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);

/** One item, checked field by field: a malformed row is dropped, never shown half-filled. */
export function parseItem(raw: unknown): FeedItem | null {
  const r = obj(raw), c = obj(r?.company);
  const at = num(r?.at), text = str(r?.text), kind = r?.kind as FeedKind;
  const slug = str(c?.slug), name = str(c?.name);
  if (!r || at == null || !text || !KINDS.includes(kind) || !slug || !name) return null;
  return { at, kind, company: { id: str(c?.id) ?? slug, slug, name }, text, amountUsd: num(r.amountUsd), tx: str(r.tx), chainId: num(r.chainId), href: str(r.href) };
}

/** The engine's answer, checked. Null when it is not the feed shape. */
export function parseFeed(json: unknown): Feed | null {
  const j = obj(json), s = obj(j?.stats);
  if (!j || !Array.isArray(j.items) || !s) return null;
  const items = j.items.map(parseItem).filter((x): x is FeedItem => x !== null).sort((a, b) => b.at - a.at);
  return { items, stats: { companies: num(s.companies) ?? 0, earned: num(s.earned) ?? 0, salesUsd: num(s.salesUsd) ?? 0, sales: num(s.sales) ?? 0 }, source: "feed" };
}

const EXPLORERS: Record<number, string> = { 1: "https://etherscan.io/tx/", 8453: "https://basescan.org/tx/", 84532: "https://sepolia.basescan.org/tx/" };
/** Where to check a sale: the block explorer of its chain (company sales settle in USDC on Base, so Base when no chain is named). */
export function txUrl(item: Pick<FeedItem, "tx" | "chainId">): string | null {
  if (!item.tx) return null;
  if (/^https:\/\//.test(item.tx)) return item.tx;
  if (!/^0x[0-9a-fA-F]{64}$/.test(item.tx)) return null;
  const base = EXPLORERS[item.chainId ?? 8453];
  return base ? `${base}${item.tx}` : null;
}

/** An address inside this site only: a feed row never links out except to an explorer. */
export const feedHref = (item: FeedItem): string => (item.href && /^\/(?!\/)/.test(item.href) ? item.href : `/c/${item.company.slug}`);

type CompanyRow = { id?: string; slug?: string; name?: string; createdAt?: number; pnl?: { revenueUsd?: number; sales?: number }; products?: { name?: string }[] };
type ActivityRow = { at?: number; company?: string; slug?: string; text?: string };
type PaymentRow = { at?: string; what?: string; usd?: number; tx?: string };

/** What a CEO's activity line is about, read from its own words. */
export function kindOf(text: string): FeedKind {
  if (/\bprice \$[\d.,]+ (→|->) \$[\d.,]+/.test(text)) return "price";
  if (/^(drafted|published|posted|sent) (a |the )?post\b/i.test(text)) return "post";
  if (/\bis on sale\b|\bis live at \$|\bnew product\b/i.test(text)) return "product";
  return "shift";
}

/** The same feed from the routes every engine has. */
export function deriveFeed(companies: unknown, landing: unknown, proof: unknown, limit = 50): Feed {
  const list: CompanyRow[] = Array.isArray(companies) ? (companies as CompanyRow[]) : [];
  const bySlug = new Map<string, { id: string; slug: string; name: string }>();
  /** companies that have sold, by name: a payment names its company, and names can repeat */
  const sellers = new Map<string, { id: string; slug: string; name: string }[]>();
  const items: FeedItem[] = [];
  let earned = 0, salesUsd = 0, sales = 0;
  for (const c of list) {
    if (!c.slug || !c.name) continue;
    const company = { id: c.id ?? c.slug, slug: c.slug, name: c.name };
    bySlug.set(c.slug, company);
    const revenue = num(c.pnl?.revenueUsd) ?? 0, sold = num(c.pnl?.sales) ?? 0;
    if (sold > 0 || revenue > 0) { earned += 1; sellers.set(c.name.toLowerCase(), [...(sellers.get(c.name.toLowerCase()) ?? []), company]); }
    salesUsd += revenue;
    sales += sold;
    if (num(c.createdAt) != null) items.push({ at: c.createdAt!, kind: "founded", company, text: "A new company was founded." });
  }
  const activity = obj(landing)?.activity;
  for (const a of (Array.isArray(activity) ? (activity as ActivityRow[]) : [])) {
    const company = a.slug ? bySlug.get(a.slug) ?? (a.company ? { id: a.slug, slug: a.slug, name: a.company } : null) : null;
    if (!company || num(a.at) == null || !a.text) continue;
    items.push({ at: a.at!, kind: kindOf(a.text), company, text: a.text });
  }
  // customer payments name a company's product as "Product (COMPANY)": only those are company sales
  const latest = obj(obj(proof)?.payments)?.latest;
  for (const p of (Array.isArray(latest) ? (latest as PaymentRow[]) : [])) {
    const m = /^(.*) \(([^()]+)\)$/.exec(p.what ?? "");
    // two companies can share a name: the sale is shown only when exactly one of them has sold
    const named = m ? sellers.get(m[2]!.toLowerCase()) ?? [] : [];
    const company = named.length === 1 ? named[0] : undefined;
    const at = p.at ? Date.parse(p.at) : NaN;
    if (!m || !company || !Number.isFinite(at)) continue;
    items.push({ at, kind: "sale", company, text: `Sold ${m[1]}.`, amountUsd: num(p.usd), tx: str(p.tx), chainId: 8453 });
  }
  items.sort((a, b) => b.at - a.at);
  return { items: items.slice(0, limit), stats: { companies: list.length, earned, salesUsd, sales }, source: "derived" };
}

const getJson = (url: string): Promise<{ status: number; json: unknown }> =>
  fetch(url, { headers: { accept: "application/json" } }).then(async (r) => ({ status: r.status, json: r.ok ? await r.json().catch(() => null) : null }));

/** Remembered for the visit: once the engine says it has no /api/feed, it is not asked again. */
let noFeedRoute = false;

/** The feed, from /api/feed when the engine has it and from the older routes when it does not. */
export async function loadFeed(limit = 50): Promise<Feed> {
  if (!noFeedRoute) {
    const direct = await getJson(`/api/feed?limit=${limit}`).catch(() => null);
    const parsed = direct?.json ? parseFeed(direct.json) : null;
    if (parsed) return parsed;
    // only "there is no such route" turns the fallback on for good; an engine hiccup tries again next time
    if (direct && (direct.status === 404 || direct.status === 405)) noFeedRoute = true;
  }
  const [companies, landing, proof] = await Promise.all(["/api/companies", "/api/landing", "/api/proof"].map((u) => getJson(u).then((r) => r.json).catch(() => null)));
  if (!Array.isArray(companies)) throw new Error("The feed is not answering.");
  return deriveFeed(companies, landing, proof, limit);
}

/** The feed, refreshed while the page is open and in view. `error` is set only while there is nothing to show. */
export function useFeed(limit = 50, every = 30_000): { feed: Feed | null; error: boolean } {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const read = () => {
      if (document.hidden) return;
      loadFeed(limit).then((f) => { if (alive) { setFeed(f); setError(false); } }).catch(() => { if (alive) setError(true); });
    };
    read();
    const timer = setInterval(read, every);
    const onVisible = () => { if (!document.hidden) read(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [limit, every]);
  return { feed, error };
}

/** "just now", "12 min ago", "3 h ago", "5 d ago", then the date. */
export function since(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
