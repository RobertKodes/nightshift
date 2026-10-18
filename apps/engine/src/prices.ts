/**
 * Price history for $SHIFT and IMD, for the charts on the site (NIGHT CHESS's control room). Hourly
 * candles from GeckoTerminal's free API, read on the server at most every 5 minutes, so the browser
 * never calls a third party and their rate limit is never reached.
 */
const POOLS = {
  shift: "0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4", // SHIFT/ETH, Uniswap v4
  imd: "0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3", // IMD/ETH 1%, the deepest IMD pool
} as const;
type Series = { t: number; close: number; volume: number }[];
type Prices = { at: number; shift: Series; imd: Series };
let cache: Prices | null = null;

async function candles(pool: string): Promise<Series> {
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/eth/pools/${pool}/ohlcv/hour?aggregate=1&limit=72&currency=usd`, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`geckoterminal ${r.status}`);
  const d = (await r.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  // [time, open, high, low, close, volume], newest first
  return (d.data?.attributes?.ohlcv_list ?? []).map(([t, , , , close, volume]) => ({ t: t! * 1000, close: close!, volume: volume ?? 0 })).reverse();
}

/** The last 72 hours of both, oldest first; the previous copy if GeckoTerminal is down. */
export async function prices(): Promise<Prices | null> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache;
  try {
    const [shift, imd] = await Promise.all([candles(POOLS.shift), candles(POOLS.imd)]);
    if (shift.length || imd.length) cache = { at: Date.now(), shift, imd };
  } catch (e) { console.error("prices", (e as Error).message); }
  return cache;
}
