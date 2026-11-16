import { useEffect, useState } from "react";

/** IMD TERMINAL's data, from the engine (apps/engine/src/terminal.ts): one merged, cached token list. */
export type Chain = "sol" | "eth" | "rh";
export type TermToken = {
  id: string; chain: Chain; address: string; name: string; symbol: string; image: string | null; href: string;
  ours: boolean; swarm: boolean; status: "curve" | "graduated" | "pool"; progress: number | null; launchNumber: number | null; createdAt: number;
  priceUsd: number | null; mcapUsd: number | null; liquidityUsd: number | null; vol24: number | null;
  change1h: number | null; change24h: number | null; buys24: number | null; sells24: number | null;
  spark: number[] | null; market: { from: string[]; at: number | null };
  /** the cap shown is the fully diluted value: no circulating figure was published */
  capIsFdv?: boolean;
  /** one of the ecosystem's core tokens (IMD, $SHIFT), pinned at the top */
  core?: boolean;
};
export type Activity = {
  kind: "launch" | "buy" | "sell"; at: number; token: Pick<TermToken, "id" | "chain" | "symbol" | "name" | "image" | "href">;
  usd: number | null; account: string | null; tx: string | null;
};
export type Source = { id: "sol" | "imd" | "gt"; label: string; at: number | null; ok: boolean; note?: string };
export type Prices = { solUsd: number | null; imdUsd: number | null; ethUsd: number | null };
export type SectionId = "trending" | "fresh" | "graduating" | "gainers" | "losers" | "volume";
export type Home = {
  at: number; prices: Prices; sources: Source[]; core: TermToken[]; sections: Record<SectionId, TermToken[]>; activity: Activity[];
  counts: { tokens: number; sol: number; eth: number; rh: number; curve: number; graduated: number };
};
export type TokenList = { at: number; tokens: TermToken[]; core: TermToken[]; sources: Source[]; prices: Prices };

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin" });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `The terminal answered ${r.status}.`);
  return j;
}
export const termApi = { home: () => get<Home>("/api/terminal/home"), tokens: () => get<TokenList>("/api/terminal/tokens") };

/** Polls one of the terminal's answers while the page is open (paused in a hidden tab). */
export function usePoll<T>(load: () => Promise<T>, every: number): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => { if (document.visibilityState !== "hidden") load().then((v) => { if (alive) { setData(v); setError(null); } }, (e: Error) => alive && setError(e.message)); };
    run();
    const t = setInterval(run, every);
    const back = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", back);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, [load, every]);
  return { data, error };
}

// ---------------------------------------------------------------- words and numbers

export const CHAIN: Record<Chain, { short: string; name: string }> = { sol: { short: "SOL", name: "Solana" }, eth: { short: "ETH", name: "Ethereum" }, rh: { short: "RH", name: "Robinhood Chain" } };

export const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : a >= 1 ? `$${v.toFixed(0)}` : a > 0 ? `$${v.toFixed(2)}` : "$0";
};
/** A token price with 3 significant digits, however small. */
export const price = (v: number | null | undefined) => {
  if (v == null || !(v > 0)) return "—";
  if (v >= 1) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (v < 1e-9) return `$${v.toExponential(2)}`;
  const z = Math.max(0, -Math.floor(Math.log10(v)) - 1);
  return `$${v.toFixed(Math.min(z + 3, 14))}`;
};
export const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`);
export const tone = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || v === 0 ? "flat" : v > 0 ? "up" : "down");
export const ago = (t: number | null | undefined, now = Date.now()) => {
  if (!t) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 45 ? "now" : s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86_400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86_400)}d`;
};
export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
export const ticker = (t: Pick<TermToken, "symbol">) => (t.symbol ? `$${t.symbol}` : "");

// ---------------------------------------------------------------- the directory's search, filters and sort

export type Sort = "trending" | "newest" | "mcap" | "volume" | "change";
export type Filters = {
  q: string; chain: "all" | Chain; status: "all" | "curve" | "graduated" | "pool";
  fresh: boolean; minLiq: number; minVol: number; sort: Sort;
};
export const SORTS: [Sort, string][] = [["trending", "Trending"], ["newest", "Newest"], ["mcap", "Mcap"], ["volume", "Vol 24h"], ["change", "24h %"]];
export const DEFAULTS: Filters = { q: "", chain: "all", status: "all", fresh: false, minLiq: 0, minVol: 0, sort: "trending" };
const WEEK = 7 * 86_400_000;
const trades = (t: TermToken) => (t.buys24 ?? 0) + (t.sells24 ?? 0);

/** Search matches a name, a ticker (with or without $), an address or an IMD launch number. */
export function matches(t: TermToken, q: string): boolean {
  const s = q.trim().toLowerCase().replace(/^\$/, "");
  if (!s) return true;
  return t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || t.address.toLowerCase() === s || (s.length >= 6 && t.address.toLowerCase().startsWith(s)) || (t.launchNumber != null && String(t.launchNumber) === s.replace(/^#/, ""));
}

export function applyFilters(list: TermToken[], f: Filters, now = Date.now()): TermToken[] {
  const out = list.filter((t) =>
    matches(t, f.q) && (f.chain === "all" || t.chain === f.chain) && (f.status === "all" || t.status === f.status) && (!f.fresh || now - t.createdAt < WEEK)
    // a liquidity floor counts a Solana curve's own reserve only when GeckoTerminal has read it
    && (!f.minLiq || (t.liquidityUsd ?? 0) >= f.minLiq) && (!f.minVol || (t.vol24 ?? 0) >= f.minVol));
  const by: Record<Sort, (a: TermToken, b: TermToken) => number> = {
    trending: (a, b) => trades(b) - trades(a) || (b.vol24 ?? 0) - (a.vol24 ?? 0) || b.createdAt - a.createdAt,
    newest: (a, b) => b.createdAt - a.createdAt,
    mcap: (a, b) => (b.mcapUsd ?? -1) - (a.mcapUsd ?? -1),
    volume: (a, b) => (b.vol24 ?? -1) - (a.vol24 ?? -1),
    // tokens without a 24h change sort last, whichever way
    change: (a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity),
  };
  return out.sort(by[f.sort]);
}

const NUM = (v: string | null) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
/** The directory's state lives in its address, so a link from the front page opens it already sorted. */
export function readQuery(search: string): Filters {
  const p = new URLSearchParams(search);
  const pick = <T extends string>(k: string, ok: readonly T[], d: T): T => { const v = p.get(k) as T | null; return v && ok.includes(v) ? v : d; };
  return {
    q: (p.get("q") ?? "").slice(0, 80), chain: pick("chain", ["all", "sol", "eth", "rh"] as const, "all"), status: pick("status", ["all", "curve", "graduated", "pool"] as const, "all"),
    fresh: p.get("new") === "1", minLiq: NUM(p.get("liq")), minVol: NUM(p.get("vol")), sort: pick("sort", SORTS.map(([s]) => s), "trending"),
  };
}
export function writeQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.chain !== "all") p.set("chain", f.chain);
  if (f.status !== "all") p.set("status", f.status);
  if (f.fresh) p.set("new", "1");
  if (f.minLiq) p.set("liq", String(f.minLiq));
  if (f.minVol) p.set("vol", String(f.minVol));
  if (f.sort !== "trending") p.set("sort", f.sort);
  const s = p.toString();
  return s ? `?${s}` : "";
}
