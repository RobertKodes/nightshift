import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { DAMM_V2_POOL_AUTHORITY, DBC_POOL_AUTHORITY, GT_API, holderRows, parseCandles, parseTrades, pickGraduatedPool, SolMarket } from "./sol-market.js";
import type { SolLaunchpad } from "./sol-launch.js";
import { solRoutes } from "./sol-routes.js";

const MINT = "CUFS4ggDUYH4NCGVu3ezDubwPm5vM6rFfxLXtcnr8imd";
const POOL = "CbQPoSYaXP45ob9HFP9NJyqsmaCmR7PtfRChpjmiDnoo";
const DAMM = "8Pm2kZpnxD3hoMmt4bjStX2Pw2Z9abpbHzZxMPqxPmie";
const WSOL = "So11111111111111111111111111111111111111112";
const WALLET = "CfZS6MtCHhPi6L8v6gYt1J2oN9GSPJbQUnMzLvi1Qyq";
const TX = "5Jj6X4FJZCAekVALbLydiQSkXLUMnUtfbcW5Gvyw1NLYhCW6xmek1U5VuxrRPhm1gE4zic2MNgF4Rgvg5PAQHTnc";

/** GeckoTerminal's answers in the shapes it sent on 2026-11-16 for the IMDSOL curve pool. */
const ohlcv = (rows: unknown[]) => ({ data: { id: "x", type: "ohlcv_request_response", attributes: { ohlcv_list: rows } }, meta: {} });
const trade = (o: { kind: "buy" | "sell"; tx?: string; at?: string; sol?: string; tokens?: string; anomalous?: boolean }) => ({
  id: "t", type: "trade",
  attributes: {
    block_timestamp: o.at ?? "2026-11-15T22:44:12Z", tx_hash: o.tx ?? TX, tx_from_address: WALLET, kind: o.kind,
    from_token_address: o.kind === "buy" ? WSOL : MINT, to_token_address: o.kind === "buy" ? MINT : WSOL,
    from_token_amount: o.kind === "buy" ? (o.sol ?? "1.609395472") : (o.tokens ?? "13130089.411577"),
    to_token_amount: o.kind === "buy" ? (o.tokens ?? "13130089.411577") : (o.sol ?? "1.609395472"),
    price_from_in_usd: o.kind === "buy" ? "72.31" : "0.0000088", price_to_in_usd: o.kind === "buy" ? "0.0000088" : "72.31",
    volume_in_usd: "116.38", is_anomalous: o.anomalous ?? false,
  },
});
const poolRow = (address: string, liq: string, base = MINT) => ({ id: `solana_${address}`, type: "pool", attributes: { address, reserve_in_usd: liq }, relationships: { base_token: { data: { id: `solana_${base}` } }, quote_token: { data: { id: `solana_${WSOL}` } } } });

type Answer = { status?: number; body?: unknown; throws?: Error };
function fakeFetch(route: (url: string) => Answer) {
  const calls: { url: string; accept: string }[] = [];
  const fetch = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, accept: init.headers.accept ?? "" });
    const a = route(url);
    if (a.throws) throw a.throws;
    const status = a.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => a.body };
  };
  return { fetch, calls };
}
function clock(t = 1_794_800_000_000) { const c = { t, now: () => c.t }; return c; }

describe("GeckoTerminal parsing", () => {
  it("candles come out oldest first, one per time, bad rows dropped", () => {
    const c = parseCandles(ohlcv([
      [1794782400, 7.4e-6, 9.1e-6, 7.4e-6, 9.1e-6, 386.37],
      [1794782100, 5.0e-6, 7.4e-6, 5.0e-6, 7.4e-6, 648.35],
      [1794782100, 5.0e-6, 7.4e-6, 5.0e-6, 7.4e-6, 648.35],
      [1794781800, "x", 1, 1, 1, 1],
      [1794781500, 1, 0.5, 2, 1, 1], // high under low
      "junk",
    ]));
    expect(c.map((x) => x[0])).toEqual([1794782100, 1794782400]);
    expect(c[1]).toEqual([1794782400, 7.4e-6, 9.1e-6, 7.4e-6, 9.1e-6, 386.37]);
    expect(parseCandles({ errors: [{ status: "404" }] })).toEqual([]);
    expect(parseCandles(null)).toEqual([]);
  });

  it("trades read both ways, newest first; anomalous and foreign ones dropped", () => {
    const t = parseTrades({ data: [
      trade({ kind: "buy", at: "2026-11-15T22:44:12Z" }),
      trade({ kind: "sell", at: "2026-11-15T22:50:00Z", sol: "0.5", tokens: "1000" }),
      trade({ kind: "buy", anomalous: true }),
      trade({ kind: "buy", tx: "short" }),
      { attributes: { ...trade({ kind: "buy" }).attributes, to_token_address: "Other1111111111111111111111111111111111111" } },
    ] }, MINT);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ kind: "sell", sol: 0.5, tokens: 1000, account: WALLET, tx: TX, priceUsd: 0.0000088 });
    expect(t[1]).toMatchObject({ kind: "buy", sol: 1.609395472, tokens: 13130089.411577, usd: 116.38, at: Date.parse("2026-11-15T22:44:12Z") });
    expect(parseTrades({}, MINT)).toEqual([]);
  });

  it("a graduated token's pool is its busiest one other than the curve", () => {
    const j = { data: [poolRow(POOL, "9000"), poolRow(DAMM, "8000"), poolRow("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", "100"), poolRow("7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5", "999999", "Other1111111111111111111111111111111111111")] };
    expect(pickGraduatedPool(j, MINT, POOL)).toBe(DAMM);
    expect(pickGraduatedPool({ data: [poolRow(POOL, "9000")] }, MINT, POOL)).toBeNull();
    expect(pickGraduatedPool("nope", MINT, POOL)).toBeNull();
  });
});

describe("SolMarket: the cached proxy", () => {
  it("asks GeckoTerminal once per pool and timeframe while the cache is fresh, as JSON", async () => {
    const c = clock();
    const f = fakeFetch(() => ({ body: ohlcv([[1794782400, 1, 2, 0.5, 1.5, 10]]) }));
    const mk = new SolMarket({ fetch: f.fetch, now: c.now });
    const a = await mk.candles({ mint: MINT, pool: POOL, graduated: false, tf: "5m" });
    expect(a.candles).toEqual([[1794782400, 1, 2, 0.5, 1.5, 10]]);
    expect(a.pools).toEqual([POOL]);
    await mk.candles({ mint: MINT, pool: POOL, graduated: false, tf: "5m" });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe(`${GT_API}/pools/${POOL}/ohlcv/minute?aggregate=5&limit=300&currency=usd&token=${MINT}`);
    expect(f.calls[0]!.accept).toBe("application/json");
    await mk.candles({ mint: MINT, pool: POOL, graduated: false, tf: "4h" });
    expect(f.calls[1]!.url).toContain("/ohlcv/hour?aggregate=4&");
    c.t += SolMarket.TTL.candles + 1;
    await mk.candles({ mint: MINT, pool: POOL, graduated: false, tf: "5m" });
    expect(f.calls).toHaveLength(3);
  });

  it("visitors asking at once share one call", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    const fetch = async () => { n++; await gate; return { ok: true, status: 200, json: async () => ({ data: [trade({ kind: "buy" })] }) }; };
    const mk = new SolMarket({ fetch, now: clock().now });
    const all = Promise.all([1, 2, 3].map(() => mk.trades({ mint: MINT, pool: POOL, graduated: false })));
    release();
    const r = await all;
    expect(n).toBe(1);
    expect(r.every((x) => x.trades.length === 1)).toBe(true);
  });

  it("a pool not indexed yet answers empty with a note, and is asked again only after a minute", async () => {
    const c = clock();
    const f = fakeFetch(() => ({ status: 404, body: { errors: [{ status: "404", title: "Not Found" }] } }));
    const mk = new SolMarket({ fetch: f.fetch, now: c.now });
    const a = await mk.candles({ mint: MINT, pool: POOL, graduated: false, tf: "1m" });
    expect(a.candles).toEqual([]);
    expect(a.note).toMatch(/fills in/);
    const t = await mk.trades({ mint: MINT, pool: POOL, graduated: false });
    expect(t.trades).toEqual([]);
    expect(t.note).toMatch(/not indexed/);
    c.t += 30_000;
    await mk.candles({ mint: MINT, pool: POOL, graduated: false, tf: "1m" });
    expect(f.calls).toHaveLength(2);
    c.t += SolMarket.TTL.empty;
    await mk.candles({ mint: MINT, pool: POOL, graduated: false, tf: "1m" });
    expect(f.calls).toHaveLength(3);
  });

  it("when GeckoTerminal fails or times out, the last answer is served; with none, an empty one", async () => {
    const c = clock();
    let mode: "ok" | "500" | "throw" = "ok";
    const f = fakeFetch(() => mode === "ok" ? { body: ohlcv([[1794782400, 1, 2, 0.5, 1.5, 10]]) } : mode === "500" ? { status: 500, body: {} } : { throws: new DOMException("timed out", "TimeoutError") });
    const mk = new SolMarket({ fetch: f.fetch, now: c.now });
    await mk.candles({ mint: MINT, pool: POOL, graduated: false, tf: "15m" });
    mode = "500"; c.t += SolMarket.TTL.candles + 1;
    expect((await mk.candles({ mint: MINT, pool: POOL, graduated: false, tf: "15m" })).candles).toHaveLength(1);
    mode = "throw"; c.t += 10_000;
    expect((await mk.candles({ mint: MINT, pool: POOL, graduated: false, tf: "15m" })).candles).toHaveLength(1);
    const fresh = await mk.candles({ mint: MINT, pool: POOL, graduated: false, tf: "1d" });
    expect(fresh.candles).toEqual([]);
    expect(fresh.note).toBeTruthy();
  });

  it("stays inside its budget of calls a minute, then serves empty until the minute passes", async () => {
    const c = clock();
    const f = fakeFetch(() => ({ body: { data: [] } }));
    const mk = new SolMarket({ fetch: f.fetch, now: c.now, budget: 2 });
    const pools = ["9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5", POOL];
    for (const p of pools) await mk.trades({ mint: MINT, pool: p, graduated: false });
    expect(f.calls).toHaveLength(2);
    c.t += 61_000;
    await mk.trades({ mint: MINT, pool: POOL, graduated: false });
    expect(f.calls).toHaveLength(3);
  });

  it("a graduated token's chart runs through graduation: the curve's candles, then the new pool's", async () => {
    const f = fakeFetch((url) => url.includes("/tokens/") ? { body: { data: [poolRow(POOL, "1"), poolRow(DAMM, "5000")] } }
      : url.includes(`/pools/${POOL}/`) ? { body: ohlcv([[100, 1, 1, 1, 1, 1], [200, 2, 2, 2, 2, 2], [300, 3, 3, 3, 3, 3]]) }
      : url.includes(`/pools/${DAMM}/ohlcv`) ? { body: ohlcv([[300, 4, 4, 4, 4, 4], [400, 5, 5, 5, 5, 5]]) }
      : { body: { data: [trade({ kind: "sell" })] } });
    const mk = new SolMarket({ fetch: f.fetch, now: clock().now });
    const a = await mk.candles({ mint: MINT, pool: POOL, graduated: true, tf: "1h" });
    expect(a.candles.map((x) => x[0])).toEqual([100, 200, 300, 400]);
    expect(a.candles[2]![4]).toBe(4);
    expect(a.pools).toEqual([POOL, DAMM]);
    const t = await mk.trades({ mint: MINT, pool: POOL, graduated: true });
    expect(t.pool).toBe(DAMM);
    expect(f.calls.filter((x) => x.url.includes("/tokens/"))).toHaveLength(1);
  });

  it("refuses what is not an address without calling out", async () => {
    const f = fakeFetch(() => ({ body: {} }));
    const mk = new SolMarket({ fetch: f.fetch, now: clock().now });
    expect((await mk.candles({ mint: "../x", pool: POOL, graduated: false, tf: "5m" })).candles).toEqual([]);
    expect((await mk.trades({ mint: MINT, pool: null, graduated: false })).trades).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });
});

describe("top holders", () => {
  it("labels the curve, the graduated pool and the creator like pump.fun", () => {
    const creator = "Creator111111111111111111111111111111111111";
    const rows = holderRows([
      { account: "Vault1111111111111111111111111111111111111", owner: DBC_POOL_AUTHORITY, amount: 700_000_000_000_000n },
      { account: "DammVault11111111111111111111111111111111", owner: DAMM_V2_POOL_AUTHORITY, amount: 100_000_000_000_000n },
      { account: "Acc11111111111111111111111111111111111111", owner: creator, amount: 25_000_000_000_000n },
      { account: "Acc21111111111111111111111111111111111111", owner: WALLET, amount: 12_345_678_000_000n },
      { account: "Acc31111111111111111111111111111111111111", owner: null, amount: 0n },
    ], { supply: 1_000_000_000_000_000n, decimals: 6, creator });
    expect(rows.map((r) => r.label)).toEqual(["bonding curve", "pool", "dev", null]);
    expect(rows[0]).toMatchObject({ tokens: 700_000_000, pct: 70 });
    expect(rows[3]).toMatchObject({ owner: WALLET, pct: 1.2345 });
  });
});

describe("the routes", () => {
  type Sent = { status: number; body: any; headers: Record<string, string> };
  async function call(path: string, o: { status?: string; limited?: boolean; market?: SolMarket } = {}) {
    const out: Sent[] = [];
    const pad = {
      one: (m: string) => m === MINT ? { mint: MINT, pool: POOL, status: o.status ?? "live" } : null,
      holders: async () => ({ holders: [], at: 1 }),
    } as unknown as SolLaunchpad;
    const ctx = { json: (_res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => { out.push({ status, body, headers }); }, body: async () => ({}), limited: () => !!o.limited, isAdmin: () => false, pad, market: o.market };
    await solRoutes({ method: "GET", url: path } as IncomingMessage, {} as ServerResponse, path.split("?")[0]!, ctx);
    return out[0]!;
  }
  const market = () => new SolMarket({ fetch: fakeFetch((url) => url.includes("/trades") ? { body: { data: [trade({ kind: "buy" })] } } : { body: ohlcv([[1794782400, 1, 2, 0.5, 1.5, 10]]) }).fetch, now: clock().now });

  it("serves candles, trades and holders for a live launch, with short public caching", async () => {
    const mk = market();
    const c = await call(`/api/sol/launches/${MINT}/candles?tf=1h`, { market: mk });
    expect(c.status).toBe(200);
    expect(c.body.candles).toHaveLength(1);
    expect(c.headers["Cache-Control"]).toBe("public, max-age=15");
    const t = await call(`/api/sol/launches/${MINT}/trades`, { market: mk });
    expect(t.body.trades[0].kind).toBe("buy");
    expect((await call(`/api/sol/launches/${MINT}/holders`, { market: mk })).body).toEqual({ holders: [], at: 1 });
  });

  it("refuses a bad timeframe, an unknown or unlaunched token, and too many requests", async () => {
    expect((await call(`/api/sol/launches/${MINT}/candles?tf=2m`, { market: market() })).status).toBe(400);
    expect((await call(`/api/sol/launches/${POOL}/candles?tf=5m`, { market: market() })).status).toBe(404);
    expect((await call(`/api/sol/launches/${MINT}/trades`, { status: "waiting", market: market() })).status).toBe(404);
    expect((await call(`/api/sol/launches/${MINT}/trades`, { limited: true, market: market() })).status).toBe(429);
  });
});
