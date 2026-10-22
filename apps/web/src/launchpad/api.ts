import type { LaunchBody, LaunchForm } from "@nightshift/launch";

/** The engine's launchpad routes (apps/engine/src/launchpad.ts): public IMD and DexScreener data, nothing held. */
export type ChainKey = "eth" | "rh";
export type Market = { symbol: string; name: string; priceUsd: number; mcapUsd: number | null; liquidityUsd: number; volume24: number; change1h: number; change24h: number; buys24: number; sells24: number; quote: string; pair: string; url: string; image: string | null };
export type BoardRow = { launchNumber: number; id: string; kind: string; chainId: 1 | 4663; chain: ChainKey; token: string; name: string; symbol: string | null; createdAt: string; logo: string | null; ours: boolean; market: Market | null };
export type Building = { launchNumber: number; id: string; chainId: number; kind: string; name: string | null; symbol: string | null; createdAt: string; ours: boolean };
export type Board = { at: number; sources: string[]; totals: { live: number; priced: number; eth: number; rh: number; building: number; shown: number }; usd: { eth: number | null; imd: number | null }; rows: BoardRow[]; building: Building[] };
export type Stage = "paid" | "refused" | "building" | "needs_input" | "failed" | "deploying" | "live" | "parked";
export type LaunchView = {
  ref: string; stage: Stage; stageText: string;
  payment: { chainId: number; tx: string; payer: string | null; state: string | null; reason: string | null } | null;
  job: { id: string; state: string; blockedReason: string | null; steps: { key: string; label: string; state: string }[] } | null;
  launch: {
    id: string; launchNumber: number; kind: string; status: string; chainId: number; chain: ChainKey | null; createdAt: string; parkedReason: string | null; repo: string | null;
    token: string | null; contracts: { role: string; name: string; address: string }[]; checks: { name: string; status: string; detail: string }[];
    economics: { poolPct: number | null; creatorPct: number | null; swarmPct: number; cap: string | null; pairedWith: string } | null;
    requester: string | null; poolFeeBps: number | null; pool: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string; poolId: string } | null; logo: string | null; ours: boolean;
  } | null;
  coin: { name: string | null; symbol: string | null; supply: string | null; about: string | null; links: { website?: string; x?: string; telegram?: string } } | null;
  market: Market | null;
  links: { imd: string | null; job: string | null; explorer: string | null; dexscreener: string | null; chain: string | null };
};
export type Check = { blockers: { code?: string; detail?: string; message?: string; fact?: string }[] | null; suggestions: { code?: string; detail?: string }[]; plan: { title: string }[]; error: unknown };
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin", ...init });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw Object.assign(new Error(j.error ?? `The launchpad answered ${r.status}.`), { body: j });
  return j;
}

export const lpApi = {
  board: () => get<Board>("/api/launchpad/board"),
  launch: (ref: string) => get<LaunchView>(`/api/launchpad/launch?ref=${encodeURIComponent(ref)}`),
  check: (f: LaunchForm) => get<{ body: LaunchBody; check: Check }>("/api/launchpad/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }),
  chart: (chainId: number, pool: string) => get<{ candles: Candle[]; error?: string; at: number }>(`/api/launchpad/chart?chain=${chainId}&pool=${pool}`),
};

export const CHAIN_NAME: Record<ChainKey, string> = { eth: "Ethereum", rh: "Robinhood Chain" };
/** The chain a buy comes from by default: another one, since this is the "from any chain" button (changeable in the swap). */
export const fromFor = (c: ChainKey) => (c === "eth" ? "base" : "eth");
export const swapLink = (r: { chain: ChainKey; token: string }) => `/swap?to=${r.chain}:${r.token}&from=${fromFor(r.chain)}`;

export const usd = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  return a >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(a >= 100 ? 0 : 2)}`;
};
/** A token price with 3 significant digits, however small. */
export const price = (n: number | null | undefined) => {
  if (n == null || !(n > 0)) return "–";
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (n < 1e-9) return `$${n.toExponential(2)}`;
  const z = Math.max(0, -Math.floor(Math.log10(n)) - 1);
  return `$${n.toFixed(Math.min(z + 3, 14))}`;
};
export const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "–" : `${n >= 0 ? "+" : ""}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`);
export const age = (iso: string, now = Date.now()) => {
  const s = Math.max(1, Math.round((now - Date.parse(iso)) / 1000));
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86_400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86_400)}d`;
};
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The launches started from this browser, newest first (a convenience only: the launch itself lives at IMD). */
const KEY = "ns-launchpad-mine";
export type Mine = { ref: string; symbol: string; name: string; at: number };
export function myLaunches(): Mine[] { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Mine[]; return Array.isArray(v) ? v.slice(0, 20) : []; } catch { return []; } }
export function rememberLaunch(m: Mine): void { try { localStorage.setItem(KEY, JSON.stringify([m, ...myLaunches().filter((x) => x.ref !== m.ref)].slice(0, 20))); } catch { /* private window */ } }
