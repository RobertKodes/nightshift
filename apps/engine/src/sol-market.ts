/**
 * A launch's market on its token page, like pump.fun's: candles and recent trades from GeckoTerminal's free
 * public API, which indexes Meteora DBC pools (and the DAMM v2 pool a token graduates into). The browser never
 * calls GeckoTerminal: everything goes through here, cached per pool and timeframe, with one upstream budget
 * for the whole engine (the free tier allows about 30 calls a minute), timeouts, and empty answers instead of
 * errors when GeckoTerminal has nothing yet or cannot be reached (the page then falls back to its own line).
 */

export const GT_API = "https://api.geckoterminal.com/api/v2/networks/solana";
/** The timeframes the page offers, as GeckoTerminal's OHLCV path and aggregate. */
export const TIMEFRAMES = {
  "1m": { path: "minute", aggregate: 1 },
  "5m": { path: "minute", aggregate: 5 },
  "15m": { path: "minute", aggregate: 15 },
  "1h": { path: "hour", aggregate: 1 },
  "4h": { path: "hour", aggregate: 4 },
  "1d": { path: "day", aggregate: 1 },
} as const;
export type Timeframe = keyof typeof TIMEFRAMES;
export const isTimeframe = (v: unknown): v is Timeframe => typeof v === "string" && Object.hasOwn(TIMEFRAMES, v);

/** [unix seconds, open, high, low, close, volume in USD], prices in USD per whole token, oldest first. */
export type Candle = [number, number, number, number, number, number];
export type Trade = { kind: "buy" | "sell"; account: string; sol: number; tokens: number; usd: number; priceUsd: number; at: number; tx: string };
export type Candles = { candles: Candle[]; pools: string[]; at: number; note?: string };
export type Trades = { trades: Trade[]; pool: string | null; at: number; note?: string };

const WSOL = "So11111111111111111111111111111111111111112";
const KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : NaN; };

/** GeckoTerminal's ohlcv_list ([ts, o, h, l, c, v], newest first) as clean candles, oldest first, one per time. */
export function parseCandles(j: unknown): Candle[] {
  const list = (j as { data?: { attributes?: { ohlcv_list?: unknown } } })?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];
  const by = new Map<number, Candle>();
  for (const r of list) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const c = r.slice(0, 6).map(num) as Candle;
    if (c.some((x) => !Number.isFinite(x)) || c[0] <= 0 || c[2] < c[3] || c[1] < 0 || c[4] < 0) continue;
    by.set(Math.floor(c[0]), [Math.floor(c[0]), c[1], c[2], c[3], c[4], Math.max(0, c[5])]);
  }
  return [...by.values()].sort((a, b) => a[0] - b[0]);
}

/** GeckoTerminal's trades for a pool as the page shows them: buys take SOL in for the token, sells the reverse. */
export function parseTrades(j: unknown, mint: string): Trade[] {
  const list = (j as { data?: unknown })?.data;
  if (!Array.isArray(list)) return [];
  const out: Trade[] = [];
  for (const row of list) {
    const a = (row as { attributes?: Record<string, unknown> })?.attributes;
    if (!a || a.is_anomalous === true) continue;
    const kind = a.kind === "buy" || a.kind === "sell" ? a.kind : null;
    const from = String(a.from_token_address ?? ""), to = String(a.to_token_address ?? "");
    const tx = String(a.tx_hash ?? ""), account = String(a.tx_from_address ?? "");
    const at = Date.parse(String(a.block_timestamp ?? ""));
    if (!kind || !tx || !/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(tx) || !KEY.test(account) || !Number.isFinite(at)) continue;
    // the token's side and the SOL side, whichever way the trade went
    const tokenIn = from === mint, tokenOut = to === mint;
    if (tokenIn === tokenOut) continue;
    if (tokenIn ? to !== WSOL : from !== WSOL) continue;
    const tokens = num(tokenIn ? a.from_token_amount : a.to_token_amount), solAmt = num(tokenIn ? a.to_token_amount : a.from_token_amount);
    const priceUsd = num(tokenIn ? a.price_from_in_usd : a.price_to_in_usd), usd = num(a.volume_in_usd);
    if (!(tokens > 0) || !(solAmt >= 0)) continue;
    out.push({ kind, account, sol: solAmt, tokens, usd: Number.isFinite(usd) ? usd : 0, priceUsd: Number.isFinite(priceUsd) ? priceUsd : 0, at, tx });
  }
  return out.sort((x, y) => y.at - x.at);
}

/** The token's busiest pool other than the curve it left: where a graduated token trades now. */
export function pickGraduatedPool(j: unknown, mint: string, curvePool: string | null): string | null {
  const list = (j as { data?: unknown })?.data;
  if (!Array.isArray(list)) return null;
  let best: { pool: string; liq: number } | null = null;
  for (const row of list) {
    const a = (row as { attributes?: Record<string, unknown> })?.attributes;
    const rel = (row as { relationships?: Record<string, { data?: { id?: string } }> })?.relationships;
    const pool = String(a?.address ?? "");
    if (!KEY.test(pool) || pool === curvePool) continue;
    const base = String(rel?.base_token?.data?.id ?? ""), quote = String(rel?.quote_token?.data?.id ?? "");
    if (base !== `solana_${mint}` && quote !== `solana_${mint}`) continue;
    const liq = num(a?.reserve_in_usd);
    if (!best || (Number.isFinite(liq) ? liq : 0) > best.liq) best = { pool, liq: Number.isFinite(liq) ? liq : 0 };
  }
  return best?.pool ?? null;
}

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type Entry<T> = { at: number; ttl: number; v: T };
export type MarketOptions = { fetch?: Fetch; now?: () => number; budget?: number; timeoutMs?: number; maxEntries?: number };

/** Not found upstream (a pool GeckoTerminal has not indexed yet): an empty answer, cached a little longer. */
class Upstream404 extends Error {}
class OverBudget extends Error {}

export class SolMarket {
  private cache = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  private calls: number[] = [];
  private fetch: Fetch;
  private now: () => number;
  private budget: number;
  private timeoutMs: number;
  private maxEntries: number;
  static readonly TTL = { candles: 25_000, trades: 12_000, pools: 600_000, empty: 60_000 };

  constructor(o: MarketOptions = {}) {
    this.fetch = o.fetch ?? ((url, init) => fetch(url, init));
    this.now = o.now ?? Date.now;
    this.budget = o.budget ?? 25;
    this.timeoutMs = o.timeoutMs ?? 8_000;
    this.maxEntries = o.maxEntries ?? 600;
  }

  /** One GeckoTerminal read, inside the engine-wide budget of calls a minute. */
  private async get(path: string): Promise<unknown> {
    const now = this.now();
    while (this.calls.length && now - this.calls[0]! > 60_000) this.calls.shift();
    if (this.calls.length >= this.budget) throw new OverBudget("over budget");
    this.calls.push(now);
    const r = await this.fetch(`${GT_API}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (r.status === 404) throw new Upstream404("not indexed");
    if (!r.ok) throw new Error(`GeckoTerminal answered ${r.status}`);
    return r.json();
  }

  /**
   * A cached read: fresh within its time, else one call (shared by everyone asking at once). When the call fails,
   * the last answer is served as it was, or `empty` (and that empty answer is kept a minute, so a pool nobody
   * indexed yet costs one call a minute, not one per visitor).
   */
  private async cached<T>(key: string, ttl: number, load: () => Promise<T>, empty: (note: string) => T): Promise<T> {
    const hit = this.cache.get(key) as Entry<T> | undefined;
    if (hit && this.now() - hit.at < hit.ttl) return hit.v;
    const busy = this.inflight.get(key) as Promise<T> | undefined;
    if (busy) return busy;
    const p = (async () => {
      try {
        const v = await load();
        this.put(key, v, ttl);
        return v;
      } catch (e) {
        // the last answer, kept a few more seconds so a failing GeckoTerminal is not asked on every visit
        if (hit) { this.put(key, hit.v, 5_000); return hit.v; }
        const note = e instanceof Upstream404 ? "GeckoTerminal has not indexed this pool yet." : e instanceof OverBudget ? "The market data is busy: it fills in shortly." : "The market data could not be read right now.";
        const v = empty(note);
        // a miss is kept briefly (a minute for an unindexed pool, a few seconds otherwise) so the next visitor retries soon
        this.put(key, v, e instanceof Upstream404 ? SolMarket.TTL.empty : 5_000);
        return v;
      } finally { this.inflight.delete(key); }
    })();
    this.inflight.set(key, p);
    return p;
  }

  private put(key: string, v: unknown, ttl: number) {
    this.cache.delete(key);
    this.cache.set(key, { at: this.now(), ttl, v });
    while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
  }

  /** One pool's candles in USD per whole token. */
  private poolCandles(pool: string, mint: string, tf: Timeframe): Promise<Candle[] | null> {
    const t = TIMEFRAMES[tf];
    return this.cached(`c:${pool}:${tf}`, SolMarket.TTL.candles,
      async () => parseCandles(await this.get(`/pools/${pool}/ohlcv/${t.path}?aggregate=${t.aggregate}&limit=300&currency=usd&token=${mint}`)),
      () => null);
  }

  /** Where a graduated token trades now (its DAMM v2 pool), looked up from GeckoTerminal and kept ten minutes. */
  async graduatedPool(mint: string, curvePool: string | null): Promise<string | null> {
    if (!KEY.test(mint)) return null;
    return this.cached(`p:${mint}`, SolMarket.TTL.pools, async () => pickGraduatedPool(await this.get(`/tokens/${mint}/pools`), mint, curvePool), () => null);
  }

  /**
   * The chart: the curve's candles, and for a graduated token the new pool's after them (one line through
   * graduation, like pump.fun). `pools` says which pools the candles came from.
   */
  async candles(o: { mint: string; pool: string | null; graduated: boolean; tf: Timeframe }): Promise<Candles> {
    const at = this.now();
    if (!KEY.test(o.mint)) return { candles: [], pools: [], at, note: "Not a token address." };
    const next = o.graduated ? await this.graduatedPool(o.mint, o.pool) : null;
    const [curve, after] = await Promise.all([o.pool ? this.poolCandles(o.pool, o.mint, o.tf) : null, next ? this.poolCandles(next, o.mint, o.tf) : null]);
    const pools = [o.pool && curve?.length ? o.pool : null, next && after?.length ? next : null].filter((p): p is string => !!p);
    if (!curve && !after) return { candles: [], pools: [], at, note: "No market data yet: the chart fills in after the first trades are indexed." };
    const start = after?.[0]?.[0] ?? Infinity;
    const candles = [...(curve ?? []).filter((c) => c[0] < start), ...(after ?? [])];
    return { candles, pools, at };
  }

  /** The latest trades, newest first (about 50): where the token trades now. */
  async trades(o: { mint: string; pool: string | null; graduated: boolean }): Promise<Trades> {
    const at = this.now();
    const pool = o.graduated ? (await this.graduatedPool(o.mint, o.pool)) ?? o.pool : o.pool;
    if (!pool || !KEY.test(pool) || !KEY.test(o.mint)) return { trades: [], pool: null, at, note: "No pool yet." };
    let note: string | undefined;
    const trades = await this.cached(`t:${pool}`, SolMarket.TTL.trades, async () => parseTrades(await this.get(`/pools/${pool}/trades`), o.mint).slice(0, 50), (n) => { note = n; return [] as Trade[]; });
    return { trades, pool, at, ...(note ? { note } : {}) };
  }
}

// ---------------------------------------------------------------- top holders

/** The owners of Meteora's pool vaults (each program's "pool_authority" PDA): the curve's, and the DAMM v2 pool's after graduation. */
export const DBC_POOL_AUTHORITY = "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM";
export const DAMM_V2_POOL_AUTHORITY = "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC";
export type HolderLabel = "bonding curve" | "pool" | "dev";
export type HolderRow = { owner: string; account: string; tokens: number; pct: number; label: HolderLabel | null };

/**
 * The largest token accounts as the page lists them, like pump.fun: the curve's vault is "bonding curve", the
 * graduated pool's vault "pool", the creator's wallet "dev". `supply` and amounts are in atoms.
 */
export function holderRows(holders: { owner: string | null; account: string; amount: bigint }[], o: { supply: bigint; decimals: number; creator: string; baseVault?: string | null }): HolderRow[] {
  const scale = 10 ** o.decimals;
  return holders.filter((h) => h.amount > 0n).map((h) => {
    const owner = h.owner ?? h.account;
    const label: HolderLabel | null = h.account === o.baseVault || owner === DBC_POOL_AUTHORITY ? "bonding curve" : owner === DAMM_V2_POOL_AUTHORITY ? "pool" : owner === o.creator ? "dev" : null;
    return { owner, account: h.account, tokens: Number(h.amount) / scale, pct: o.supply > 0n ? Number((h.amount * 1_000_000n) / o.supply) / 10_000 : 0, label };
  });
}

let shared: SolMarket | null = null;
/** The engine's one market reader (one cache and one GeckoTerminal budget for every visitor). */
export const solMarket = () => (shared ??= new SolMarket());
