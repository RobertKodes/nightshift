/**
 * The IMD market, read on the server: every live IMD launch on Ethereum (api.imd.fun/launches,
 * all pages) priced from DexScreener. Measured 2026-10-20: of 301 live Ethereum launch tokens,
 * DexScreener indexed 21 and 15 held more than $2,000 of liquidity, so only those (plus IMD
 * itself) are tradable in the Night League. Every quote carries where and when it was read.
 */
export const IMD_TOKEN = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
/** Pools that hold less than this cannot absorb a sell, so they are listed but never traded. */
export const MIN_LIQUIDITY_USD = 2_000;

export type Launch = { launchNumber: number; kind: string; status: string; chainId: number; token: string | null; name: string | null; repo: string | null; createdAt: string };
export type Quote = {
  address: string; symbol: string; name: string; launch: number | null;
  priceUsd: number; liquidityUsd: number; volume24: number; change1h: number; change24h: number;
  /** The pool's swap fee, in basis points (IMD launch pools 1.25%, the IMD/ETH pool 1%). */
  feeBps: number; quote: string; pair: string; url: string;
};
export type Market = {
  at: number; source: "dexscreener"; launches: number; ethLaunchTokens: number; indexed: number;
  /** Tradable: indexed with at least MIN_LIQUIDITY_USD, IMD first. */
  tokens: Quote[];
};

type DexPair = {
  chainId: string; pairAddress: string; url: string; baseToken: { address: string; name: string; symbol: string }; quoteToken: { symbol: string };
  priceUsd?: string; liquidity?: { usd?: number }; volume?: { h24?: number }; priceChange?: { h1?: number; h24?: number };
};

const get = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return (await r.json()) as T;
};

let launchCache: { at: number; list: Launch[] } | null = null;
/** Every IMD launch, newest first, paging by launch number. Read at most every 30 minutes. */
export async function imdLaunches(fetchJson = get): Promise<Launch[]> {
  if (launchCache && Date.now() - launchCache.at < 30 * 60_000) return launchCache.list;
  const list: Launch[] = [];
  let before = "";
  for (let page = 0; page < 20; page++) {
    const d = await fetchJson<{ launches?: { launchNumber: number; kind: string; status: string; chainId: number; sourceRepoUrl?: string | null; createdAt: string; artifacts?: { role: string; name: string; address: string }[] }[] }>(
      `https://api.imd.fun/launches?limit=500${before ? `&before=${before}` : ""}`);
    const rows = d.launches ?? [];
    for (const l of rows) {
      const t = l.artifacts?.find((a) => a.role === "token");
      list.push({ launchNumber: l.launchNumber, kind: l.kind, status: l.status, chainId: l.chainId, token: t?.address?.toLowerCase() ?? null, name: t?.name ?? null, repo: l.sourceRepoUrl ?? null, createdAt: l.createdAt });
    }
    if (rows.length < 500) break;
    before = String(rows.at(-1)!.launchNumber);
  }
  if (list.length) launchCache = { at: Date.now(), list };
  return launchCache?.list ?? list;
}

/** The deepest pair per token, from DexScreener's batch endpoint (30 tokens a call). */
export async function dexQuotes(addresses: string[], fetchJson = get): Promise<Map<string, DexPair>> {
  const best = new Map<string, DexPair>();
  for (let i = 0; i < addresses.length; i += 30) {
    const pairs = await fetchJson<DexPair[]>(`https://api.dexscreener.com/tokens/v1/ethereum/${addresses.slice(i, i + 30).join(",")}`).catch(() => [] as DexPair[]);
    for (const p of Array.isArray(pairs) ? pairs : []) {
      const k = p.baseToken.address.toLowerCase();
      if ((p.liquidity?.usd ?? 0) > (best.get(k)?.liquidity?.usd ?? -1)) best.set(k, p);
    }
  }
  return best;
}

let market: Market | null = null;
/** The latest market, refreshed at most every 5 minutes; the previous one if a source is down. */
export async function imdMarket(fetchJson = get, maxAgeMs = 5 * 60_000): Promise<Market | null> {
  if (market && Date.now() - market.at < maxAgeMs) return market;
  try {
    const launches = await imdLaunches(fetchJson);
    const eth = launches.filter((l) => l.chainId === 1 && l.status === "live" && l.token);
    const byToken = new Map(eth.map((l) => [l.token!, l]));
    const pairs = await dexQuotes([IMD_TOKEN, ...byToken.keys()], fetchJson);
    const tokens: Quote[] = [];
    for (const [address, p] of pairs) {
      const liq = p.liquidity?.usd ?? 0, price = Number(p.priceUsd ?? 0);
      if (liq < MIN_LIQUIDITY_USD || !(price > 0)) continue;
      const l = byToken.get(address);
      if (!l && address !== IMD_TOKEN) continue;
      tokens.push({
        address, symbol: p.baseToken.symbol, name: p.baseToken.name, launch: l?.launchNumber ?? null,
        priceUsd: price, liquidityUsd: liq, volume24: p.volume?.h24 ?? 0, change1h: p.priceChange?.h1 ?? 0, change24h: p.priceChange?.h24 ?? 0,
        feeBps: address === IMD_TOKEN ? 100 : 125, quote: p.quoteToken.symbol, pair: p.pairAddress, url: p.url,
      });
    }
    tokens.sort((a, b) => (a.address === IMD_TOKEN ? -1 : b.address === IMD_TOKEN ? 1 : b.liquidityUsd - a.liquidityUsd));
    // two launches can share a symbol (there are several HAMSTERs and two SHIFTs): name them by launch number
    const seen = new Map<string, number>();
    for (const t of tokens) seen.set(t.symbol, (seen.get(t.symbol) ?? 0) + 1);
    for (const t of tokens) if ((seen.get(t.symbol) ?? 0) > 1 && t.launch) t.symbol = `${t.symbol}#${t.launch}`;
    if (tokens.length) market = { at: Date.now(), source: "dexscreener", launches: launches.length, ethLaunchTokens: eth.length, indexed: [...pairs.keys()].filter((a) => byToken.has(a)).length, tokens };
  } catch (e) { console.error("imd market", (e as Error).message); }
  return market;
}

/** Tests set the market directly. */
export function setMarketForTest(m: Market | null): void { market = m; }
