/**
 * Discover: what is moving on Solana's launchpads right now (pump.fun, PumpSwap, Meteora, Raydium,
 * LetsBonk, Bags…), from DexScreener's free public API: its latest token profiles and top boosts on
 * Solana, then each token's pairs. Read-only, cached three minutes; nothing here is launched by
 * NIGHTSHIFT, and the page says so.
 */
export type Discovered = {
  mint: string; name: string; symbol: string; image: string | null; dex: string; launchpad: string | null;
  priceUsd: number | null; mcapUsd: number | null; liquidityUsd: number | null; vol24: number | null; change1h: number | null; change24h: number | null;
  buys24: number; sells24: number; createdAt: number | null; url: string; boosted: boolean;
};

type Pair = {
  chainId: string; dexId: string; url: string; baseToken: { address: string; name: string; symbol: string }; priceNative?: string; priceUsd?: string;
  txns?: { h24?: { buys?: number; sells?: number } }; volume?: { h24?: number }; priceChange?: { h1?: number; h24?: number }; liquidity?: { usd?: number };
  fdv?: number; marketCap?: number; pairCreatedAt?: number; info?: { imageUrl?: string };
};

const API = "https://api.dexscreener.com";
let cache: { at: number; items: Discovered[] } | null = null;
const get = async <T>(path: string): Promise<T | null> => fetch(`${API}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) }).then((r) => (r.ok ? r.json() as Promise<T> : null)).catch(() => null);

/** Which launchpad a Solana mint came from, by the vanity suffix those launchpads give their mints. */
export function launchpadOf(mint: string, dex: string): string | null {
  if (/imd$/.test(mint)) return "IMD · NIGHTSHIFT";
  if (/pump$/.test(mint)) return "pump.fun";
  if (/bonk$/.test(mint)) return "LetsBonk";
  if (/BAGS$/.test(mint)) return "Bags";
  if (dex === "meteoradbc") return "Meteora DBC";
  return null;
}

/** One row per token from its pairs: the deepest pair wins; a pump.fun curve (no USD price) is priced from SOL x 1B supply. */
export function fromPairs(mint: string, pairs: Pair[], solUsd: number | null, boosted: boolean): Discovered | null {
  const own = pairs.filter((p) => p.chainId === "solana" && p.baseToken?.address === mint);
  if (!own.length) return null;
  const best = own.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0) || (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))[0]!;
  const native = Number(best.priceNative ?? NaN);
  const priceUsd = best.priceUsd ? Number(best.priceUsd) : Number.isFinite(native) && solUsd ? native * solUsd : null;
  const mcapUsd = best.marketCap ?? best.fdv ?? (priceUsd != null ? priceUsd * 1e9 : null);
  const buys24 = own.reduce((a, p) => a + (p.txns?.h24?.buys ?? 0), 0), sells24 = own.reduce((a, p) => a + (p.txns?.h24?.sells ?? 0), 0);
  return {
    mint, name: best.baseToken.name.slice(0, 40), symbol: best.baseToken.symbol.slice(0, 12), image: best.info?.imageUrl ?? null, dex: best.dexId,
    launchpad: launchpadOf(mint, best.dexId), priceUsd, mcapUsd, liquidityUsd: best.liquidity?.usd ?? null, vol24: own.reduce((a, p) => a + (p.volume?.h24 ?? 0), 0),
    change1h: best.priceChange?.h1 ?? null, change24h: best.priceChange?.h24 ?? null, buys24, sells24, createdAt: Math.min(...own.map((p) => p.pairCreatedAt ?? Infinity)) || null, url: best.url, boosted,
  };
}

export async function discover(solUsd: number | null): Promise<{ at: number; items: Discovered[] }> {
  if (cache && Date.now() - cache.at < 180_000) return cache;
  const [profiles, boosts] = await Promise.all([get<{ chainId: string; tokenAddress: string }[]>("/token-profiles/latest/v1"), get<{ chainId: string; tokenAddress: string }[]>("/token-boosts/top/v1")]);
  const boosted = new Set((boosts ?? []).filter((x) => x.chainId === "solana").map((x) => x.tokenAddress));
  const mints = [...new Set([...(boosts ?? []), ...(profiles ?? [])].filter((x) => x.chainId === "solana").map((x) => x.tokenAddress))].slice(0, 60);
  const items: Discovered[] = [];
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    const pairs = await get<Pair[]>(`/tokens/v1/solana/${chunk.join(",")}`) ?? [];
    for (const m of chunk) { const d = fromPairs(m, pairs, solUsd, boosted.has(m)); if (d) items.push(d); }
  }
  if (items.length || !cache) cache = { at: Date.now(), items };
  return cache;
}
