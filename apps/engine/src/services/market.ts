import type { Address } from "viem";
import { TtlCache } from "./cache.js";
import type { Deps } from "./net.js";

/** Market data from DexScreener: every pair of a token, its liquidity, volume and trades. */
export type Pair = {
  chainId: string; dexId: string; url: string; pairAddress: string; labels?: string[];
  baseToken: { address: string; name: string; symbol: string }; quoteToken: { address: string; name: string; symbol: string };
  priceNative?: string; priceUsd?: string; txns?: { h24?: { buys: number; sells: number } }; volume?: { h24?: number; h1?: number };
  priceChange?: { h1?: number; h24?: number }; liquidity?: { usd?: number; base?: number; quote?: number }; fdv?: number; marketCap?: number; pairCreatedAt?: number;
};
export type MarketRead = { pairs: Pair[]; best: Pair | null; at: number };

const DEX = "https://api.dexscreener.com";
export const dexChain: Record<number, string> = { 1: "ethereum", 4663: "robinhood" };

export function marketReader(d: Deps) {
  const cache = new TtlCache<Pair[]>(3 * 60_000, 3_000, d.now);

  /** Pairs of up to 30 tokens in one call; each token's pairs are kept for three minutes. */
  async function pairsOf(chainId: number, tokens: string[]): Promise<Map<string, Pair[]>> {
    const chain = dexChain[chainId];
    const out = new Map<string, Pair[]>();
    if (!chain) return out;
    const want = tokens.map((t) => t.toLowerCase()).filter((t) => { const hit = cache.peek(`${chainId}:${t}`); if (hit) out.set(t, hit.v); return !hit; });
    for (let i = 0; i < want.length; i += 30) {
      const part = want.slice(i, i + 30);
      const rows = await d.net.json<Pair[]>(`${DEX}/tokens/v1/${chain}/${part.join(",")}`).catch(() => null);
      if (!rows) continue;
      for (const t of part) {
        const mine = (Array.isArray(rows) ? rows : []).filter((p) => p.baseToken?.address?.toLowerCase() === t || p.quoteToken?.address?.toLowerCase() === t);
        cache.set(`${chainId}:${t}`, mine);
        out.set(t, mine);
      }
    }
    return out;
  }

  /** One token: all its pairs, and the deepest (a v4 pair with this pool id first, if one is given). */
  async function marketOf(chainId: number, token: Address, poolId?: string | null): Promise<MarketRead> {
    const pairs = (await pairsOf(chainId, [token])).get(token.toLowerCase()) ?? [];
    const sorted = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const byPool = poolId ? sorted.find((p) => p.pairAddress.toLowerCase() === poolId.toLowerCase()) : undefined;
    return { pairs: sorted, best: byPool ?? sorted[0] ?? null, at: d.now() };
  }

  /** USD per unit of a pool's quote side: ETH (from any ETH-quoted pair of the token) or IMD. */
  async function usdOf(chainId: number, currency: string): Promise<number | null> {
    const c = currency.toLowerCase();
    if (c === "0x0000000000000000000000000000000000000000" || c === "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2") {
      const w = await marketOf(chainId, "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2");
      const p = w.pairs.find((x) => x.baseToken.address.toLowerCase() === "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" && /usd/i.test(x.quoteToken.symbol));
      return p?.priceUsd ? Number(p.priceUsd) : null;
    }
    const m = await marketOf(chainId, c as Address);
    const p = m.pairs.find((x) => x.baseToken.address.toLowerCase() === c);
    return p?.priceUsd ? Number(p.priceUsd) : null;
  }

  return { pairsOf, marketOf, usdOf };
}
export type MarketReader = ReturnType<typeof marketReader>;
