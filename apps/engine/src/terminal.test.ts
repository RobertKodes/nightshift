import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { Board, BoardRow } from "./launchpad.js";
import type { SolView } from "./sol-launch.js";
import type { Trade } from "./sol-market.js";
import { activityOf, CORE, coreToken, fromBoard, fromSol, GRADUATING, mergeTokens, parseGtPools, parseGtTokens, sections, Terminal, type TermToken, terminalRoutes } from "./terminal.js";

const MINT = "CUFS4ggDUYH4NCGVu3ezDubwPm5vM6rFfxLXtcnr8imd";
const POOL = "CbQPoSYaXP45ob9HFP9NJyqsmaCmR7PtfRChpjmiDnoo";
const TOKEN = "0x38e5f5d02fce8f954c2144ca035862ab8580a075";

const sol = (o: Partial<SolView> = {}): SolView => ({
  mint: MINT, name: "first imd.fun sol launch", symbol: "IMDSOL", description: "", website: "", twitter: "", telegram: "", image: "https://example.com/logo.png",
  config: "cfg", pool: POOL, creator: "6ZudSjh6hhgtSpT8gX2Ux138qNhUvgEtSMw6Cq2X7K4r", signature: null, createdAt: 1_000, launchedAt: 2_000, status: "live", note: null,
  quoteReserve: "0", priceSol: 0.0000001, mcapSol: 100, progress: 0.05, graduateSol: 85, options: { feeBps: 100, startMcapUsd: 5000, graduateMcapUsd: 69000, sniper: "off" },
  dev: null, devBuySol: 0, logoIdea: "", checks: [], checkedAt: 0, change1h: null, change24h: null, movedAt: null, swarm: null, nonce: null, uri: "",
  ...o,
} as SolView);

const row = (o: Partial<BoardRow> = {}): BoardRow => ({
  launchNumber: 3200, id: "id-3200", kind: "custom_token", chainId: 1, chain: "eth", token: TOKEN, name: "Pump", symbol: "PUMP", createdAt: "2026-11-14T22:05:11Z", logo: null, ours: false,
  market: { symbol: "PUMP", name: "Pump", priceUsd: 0.00002, mcapUsd: 20_000, liquidityUsd: 5_000, volume24: 900, change1h: 1, change24h: 12, buys24: 7, sells24: 3, quote: "IMD", pair: "0xpool", url: "https://dexscreener.com/x", image: null },
  ...o,
});

const board = (rows: BoardRow[], at = 5_000): Board => ({ at, sources: [], totals: { live: rows.length, priced: rows.length, eth: rows.length, rh: 0, building: 0, shown: rows.length }, usd: { eth: 3000, imd: 5 }, rows, building: [] });

/** GeckoTerminal's /tokens/multi?include=top_pools, as it answers. */
const gtAnswer = (rows: { address: string; network?: string; reserve?: string; vol?: string; h24?: string; buys?: number; pools?: { id: string; reserve: string; h24: string }[] }[]) => ({
  data: rows.map((r) => ({
    id: `${r.network ?? "solana"}_${r.address}`, type: "token",
    attributes: { address: r.address, price_usd: "0.000005", fdv_usd: "5208.4", market_cap_usd: null, total_reserve_in_usd: r.reserve ?? "5128.2", volume_usd: { h24: r.vol ?? "4176.6" }, image_url: "https://assets.geckoterminal.com/x" },
    relationships: { top_pools: { data: (r.pools ?? [{ id: `p_${r.address}`, reserve: r.reserve ?? "5128.2", h24: r.h24 ?? "-11.5" }]).map((p) => ({ id: p.id, type: "pool" })) } },
  })),
  included: rows.flatMap((r) => (r.pools ?? [{ id: `p_${r.address}`, reserve: r.reserve ?? "5128.2", h24: r.h24 ?? "-11.5" }]).map((p) => ({
    id: p.id, type: "pool", attributes: { reserve_in_usd: p.reserve, price_change_percentage: { h1: "-2", h24: p.h24 }, transactions: { h24: { buys: r.buys ?? 35, sells: 18 } } },
  }))),
});

/** GeckoTerminal's /pools/multi?include=base_token for the two core pools, as it answers (IMD shows under its old name, VIBE). */
const corePools = (o: { imdBase?: string } = {}) => ({
  data: [
    { id: `eth_${CORE[0].pool}`, type: "pool", attributes: { address: CORE[0].pool, name: "VIBE / ETH 1%", base_token_price_usd: "3.108", fdv_usd: "12946233.8", market_cap_usd: null, reserve_in_usd: "1270073.01", volume_usd: { h24: "435999.6" }, price_change_percentage: { h1: "-3.878", h24: "27.632" }, transactions: { h24: { buys: 157, sells: 123 } } },
      relationships: { base_token: { data: { id: `eth_${o.imdBase ?? CORE[0].address}` } } } },
    { id: `eth_${CORE[1].pool}`, type: "pool", attributes: { address: CORE[1].pool, name: "SHIFT / ETH 1.25%", base_token_price_usd: "0.0000345", fdv_usd: "34555.39", market_cap_usd: "30000", reserve_in_usd: "28393.09", volume_usd: { h24: "37.97" }, price_change_percentage: { h1: "0", h24: "3.085" }, transactions: { h24: { buys: 2, sells: 2 } } },
      relationships: { base_token: { data: { id: `eth_${CORE[1].address}` } } } },
  ],
  included: [{ id: `eth_${CORE[0].address}`, type: "token", attributes: { image_url: "https://assets.geckoterminal.com/imd" } }],
});

describe("the core tokens", () => {
  it("reads IMD and $SHIFT from their own pools, and says when the cap is the fully diluted value", () => {
    const m = parseGtPools(corePools());
    const imd = coreToken(CORE[0], m.get(CORE[0].pool) ?? null, 7);
    expect(imd).toMatchObject({ symbol: "IMD", core: true, priceUsd: 3.108, mcapUsd: 12946233.8, capIsFdv: true, liquidityUsd: 1270073.01, vol24: 435999.6, change24h: 27.632, buys24: 157, image: "https://assets.geckoterminal.com/imd", href: "/swap?to=eth:0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7&from=base" });
    expect(imd.market).toEqual({ from: ["GeckoTerminal"], at: 7 });
    const shift = coreToken(CORE[1], m.get(CORE[1].pool) ?? null, 7);
    expect(shift).toMatchObject({ symbol: "SHIFT", mcapUsd: 30000, change24h: 3.085, image: "/brand/shift-icon-512.png", href: "/swap?pool", ours: true });
    expect(shift.capIsFdv).toBeUndefined();
  });
  it("shows no numbers when the pool's base is another token, or nothing was read", () => {
    const wrong = coreToken(CORE[0], parseGtPools(corePools({ imdBase: "0x0000000000000000000000000000000000000001" })).get(CORE[0].pool) ?? null, 7);
    expect(wrong).toMatchObject({ priceUsd: null, mcapUsd: null, change24h: null, market: { from: [], at: null } });
    expect(coreToken(CORE[1], null, null)).toMatchObject({ priceUsd: null, vol24: null, core: true });
  });
});

describe("GeckoTerminal's token answer", () => {
  it("reads each token, its deepest pool's changes and trades, and falls back to the FDV for the market cap", () => {
    const m = parseGtTokens(gtAnswer([{ address: MINT, pools: [{ id: "shallow", reserve: "10", h24: "900" }, { id: "deep", reserve: "5000", h24: "-11.5" }] }]), "sol");
    const g = m.get(MINT)!;
    expect(g).toMatchObject({ priceUsd: 0.000005, mcapUsd: 5208.4, liquidityUsd: 5128.2, vol24: 4176.6, change1h: -2, change24h: -11.5, buys24: 35, sells24: 18 });
  });
  it("says nothing about the change of an empty pool (its 0% is no data) and keys EVM tokens in lowercase", () => {
    const m = parseGtTokens(gtAnswer([{ address: "0xABCdef0000000000000000000000000000000001", network: "eth", reserve: "0.0", h24: "0" }]), "eth");
    const g = m.get("0xabcdef0000000000000000000000000000000001")!;
    expect(g.change24h).toBeNull();
    expect(g.liquidityUsd).toBe(0);
  });
  it("is empty for anything else", () => {
    expect(parseGtTokens(null, "sol").size).toBe(0);
    expect(parseGtTokens({ data: "x" }, "eth").size).toBe(0);
  });
});

describe("a token from each source", () => {
  it("prices a Solana launch from the chain first and takes volume and liquidity from GeckoTerminal", () => {
    const g = parseGtTokens(gtAnswer([{ address: MINT }]), "sol").get(MINT)!;
    const t = fromSol(sol(), { spark: [1, 2, 3], solUsd: 72, gt: { v: g, at: 9_000 }, at: 10_000 });
    expect(t).toMatchObject({ id: `sol:${MINT}`, chain: "sol", href: `/launchpad/sol/${MINT}`, ours: true, status: "curve", progress: 0.05, createdAt: 2_000, vol24: 4176.6, liquidityUsd: 5128.2, change24h: -11.5, buys24: 35 });
    expect(t.mcapUsd).toBeCloseTo(7200);
    expect(t.priceUsd).toBeCloseTo(0.0000072);
    expect(t.market.from).toEqual(["Solana", "GeckoTerminal"]);
    expect(t.spark).toEqual([1, 2, 3]);
  });
  it("keeps its own 24h change over GeckoTerminal's, and has no market numbers when nobody published any", () => {
    const t = fromSol(sol({ change24h: 40, priceSol: null, mcapSol: null, status: "graduated", progress: 1 }), { spark: [], solUsd: null, at: 1 });
    expect(t).toMatchObject({ change24h: 40, priceUsd: null, mcapUsd: null, vol24: null, liquidityUsd: null, status: "graduated", progress: 1, spark: null });
    expect(t.market).toEqual({ from: [], at: null });
  });
  it("takes an IMD launch's DexScreener numbers first, GeckoTerminal's when DexScreener has none", () => {
    const g = parseGtTokens(gtAnswer([{ address: TOKEN, network: "eth" }]), "eth").get(TOKEN)!;
    const a = fromBoard(row(), { boardAt: 5_000, gt: { v: g, at: 6_000 } });
    expect(a).toMatchObject({ id: `eth:${TOKEN}`, href: "/launchpad/t/3200", status: "pool", progress: null, mcapUsd: 20_000, vol24: 900, change24h: 12, swarm: true });
    const b = fromBoard(row({ market: null }), { boardAt: 5_000, gt: { v: g, at: 6_000 } });
    expect(b).toMatchObject({ mcapUsd: 5208.4, vol24: 4176.6, change24h: -11.5 });
    expect(b.market).toEqual({ from: ["GeckoTerminal"], at: 6_000 });
    expect(fromBoard(row({ market: null, symbol: null }), { boardAt: 1 })).toMatchObject({ symbol: "", mcapUsd: null, market: { from: [], at: null } });
  });
});

const tok = (o: Partial<TermToken> & { id: string }): TermToken => ({
  chain: "eth", address: o.id, name: o.id, symbol: o.id, image: null, href: "/", ours: false, swarm: true, status: "pool", progress: null, launchNumber: 1, createdAt: 0,
  priceUsd: null, mcapUsd: null, liquidityUsd: null, vol24: null, change1h: null, change24h: null, buys24: null, sells24: null, spark: null, market: { from: [], at: null }, ...o,
});

describe("the front page's rows", () => {
  it("merges the lists, one row per token, newest first", () => {
    const m = mergeTokens([tok({ id: "a", createdAt: 1, name: "first" })], [tok({ id: "a", createdAt: 9, name: "second" }), tok({ id: "b", createdAt: 5 })]);
    expect(m.map((t) => [t.id, t.name])).toEqual([["b", "b"], ["a", "first"]]);
  });
  it("puts a token in a row only with the number that row is about", () => {
    const list = [
      tok({ id: "curve80", chain: "sol", status: "curve", progress: 0.8, change24h: 5, createdAt: 3 }),
      tok({ id: "curve69", chain: "sol", status: "curve", progress: GRADUATING - 0.01, createdAt: 2 }),
      tok({ id: "grad", chain: "sol", status: "graduated", progress: 1 }),
      tok({ id: "deep", liquidityUsd: 50_000, change24h: -20, vol24: 10_000, buys24: 3, sells24: 1, createdAt: 4 }),
      tok({ id: "dust", liquidityUsd: 20, change24h: 900, vol24: 5, buys24: 50, sells24: 50 }),
      tok({ id: "nothing", createdAt: 9 }),
    ];
    const s = sections(list);
    expect(s.graduating.map((t) => t.id)).toEqual(["curve80"]);
    expect(s.gainers.map((t) => t.id)).toEqual(["curve80"]); // the dust pool's +900% is left out
    expect(s.losers.map((t) => t.id)).toEqual(["deep"]);
    expect(s.trending.map((t) => t.id)).toEqual(["dust", "deep"]);
    expect(s.volume.map((t) => t.id)).toEqual(["deep", "dust"]);
    expect(s.fresh[0]!.id).toBe("nothing");
    expect(sections([]).trending).toEqual([]);
  });
  it("lists recent launches and trades, newest first, and leaves old launches out", () => {
    const now = 10 * 86_400_000;
    const t = tok({ id: "sol:x", chain: "sol", createdAt: now - 3_600_000 });
    const old = tok({ id: "old", createdAt: now - 8 * 86_400_000 });
    const trade: Trade = { kind: "buy", account: "acc", sol: 1, tokens: 10, usd: 72, priceUsd: 7.2, at: now - 60_000, tx: "tx" };
    const a = activityOf([t, old], [{ token: t, trades: [trade] }], now);
    expect(a.map((x) => [x.kind, x.token.id])).toEqual([["buy", "sol:x"], ["launch", "sol:x"]]);
    expect(a[0]!.usd).toBe(72);
  });
});

/** A Terminal on fakes: a clock, a board, GeckoTerminal with a budget, trades. */
function rig(o: { sols?: SolView[]; rows?: BoardRow[]; left?: number; gtFails?: boolean; boardFails?: () => boolean } = {}) {
  let now = 1_000_000;
  const calls = { board: 0, gt: [] as string[], trades: 0 };
  const rows = o.rows ?? [row()];
  const t = new Terminal({
    now: () => now,
    sol: () => ({ list: o.sols ?? [sol({ movedAt: 5 })], spark: () => [1, 2], solUsd: async () => 72 }),
    board: async () => { calls.board++; if (o.boardFails?.()) throw new Error("down"); return board(rows, now); },
    gt: {
      read: async (net, path) => {
        calls.gt.push(`${net}${path}`);
        if (o.gtFails) throw new Error("429");
        if (path.startsWith("/pools/multi/")) return corePools();
        const addrs = path.split("/tokens/multi/")[1]!.split("?")[0]!.split(",");
        return gtAnswer(addrs.map((a) => ({ address: a, network: net })));
      },
      left: () => o.left ?? 25,
    },
    trades: async () => { calls.trades++; return { trades: [{ kind: "sell", account: "a", sol: 1, tokens: 1, usd: 9, priceUsd: 1, at: now - 1_000, tx: "t" }] }; },
  });
  // a stale list is answered at once while the next one builds: `fresh` waits for that build
  const fresh = async () => { await t.tokens(); await new Promise((r) => setTimeout(r, 5)); return t.tokens(); };
  return { t, calls, fresh, tick: (ms: number) => { now += ms; } };
}

describe("the Terminal's reader", () => {
  it("builds the list once a minute, shared by everyone asking at once", async () => {
    const r = rig();
    const [a, b] = await Promise.all([r.t.tokens(), r.t.tokens()]);
    expect(a).toBe(b);
    expect(r.calls.board).toBe(1);
    expect(a.tokens.map((x) => x.id)).toEqual([`eth:${TOKEN}`, `sol:${MINT}`]);
    r.tick(30_000);
    await r.t.tokens();
    expect(r.calls.board).toBe(1);
    r.tick(31_000);
    const stale = await r.t.tokens(); // a stale list is answered while the next one builds
    expect(stale).toBe(a);
    expect((await r.fresh()).at).toBeGreaterThan(a.at);
    expect(r.calls.board).toBe(2);
  });
  it("asks GeckoTerminal per network, 30 tokens a call, at most 3 calls a build, and not again within 5 minutes", async () => {
    const many = Array.from({ length: 100 }, (_, i) => row({ launchNumber: i, id: `id${i}`, token: `0x${i.toString(16).padStart(40, "0")}` }));
    const r = rig({ rows: many });
    const first = await r.t.tokens();
    // the core pools first (one call), then 3 token calls
    expect(r.calls.gt).toHaveLength(4);
    expect(r.calls.gt[0]).toBe(`eth/pools/multi/${CORE[0].pool},${CORE[1].pool}?include=base_token`);
    expect(r.calls.gt[1]).toMatch(new RegExp(`^solana/tokens/multi/${MINT}\\?include=top_pools$`));
    expect(r.calls.gt[2]!.startsWith("eth/tokens/multi/")).toBe(true);
    expect(r.calls.gt[2]!.split("/tokens/multi/")[1]!.split("?")[0]!.split(",")).toHaveLength(30);
    expect(first.core.map((t) => [t.symbol, t.priceUsd])).toEqual([["IMD", 3.108], ["SHIFT", 0.0000345]]);
    expect(first.tokens.find((x) => x.id === `sol:${MINT}`)!.vol24).toBe(4176.6);
    r.tick(61_000);
    await r.fresh();
    expect(r.calls.gt).toHaveLength(6); // the 40 not asked yet: two more calls
    r.tick(61_000);
    await r.fresh();
    expect(r.calls.gt).toHaveLength(6); // nothing older than 5 minutes
    r.tick(5 * 60_000);
    await r.fresh();
    expect(r.calls.gt).toHaveLength(10); // all stale again: the core pools, then the oldest first, 3 calls
  });
  it("pins the core tokens above the lists and does not repeat them there ($SHIFT is also an IMD launch)", async () => {
    const r = rig({ rows: [row(), row({ launchNumber: 2124, id: "id-2124", token: CORE[1].address, name: "NIGHTSHIFT", symbol: "SHIFT" })] });
    const l = await r.t.tokens();
    expect(l.tokens.map((t) => t.id)).not.toContain(`eth:${CORE[1].address}`);
    expect(l.core.map((t) => t.id)).toEqual([`eth:${CORE[0].address}`, `eth:${CORE[1].address}`]);
    expect((await r.t.home()).core).toHaveLength(2);
  });
  it("leaves GeckoTerminal alone when the engine's budget runs low, and says so", async () => {
    const r = rig({ left: 10 });
    const l = await r.t.tokens();
    expect(r.calls.gt).toHaveLength(0);
    expect(l.sources.find((s) => s.id === "gt")).toMatchObject({ ok: false, at: null });
    expect(l.sources.find((s) => s.id === "gt")!.note).toMatch(/busy/);
    expect(l.tokens.find((x) => x.chain === "sol")!.mcapUsd).toBeCloseTo(7200); // the chain's numbers stay
  });
  it("keeps the last IMD board when IMD cannot be read, and lists the Solana launches alone before that", async () => {
    let down = true;
    const r = rig({ boardFails: () => down });
    const a = await r.t.tokens();
    expect(a.tokens.map((x) => x.chain)).toEqual(["sol"]);
    expect(a.sources.find((s) => s.id === "imd")).toMatchObject({ ok: false });
    down = false; r.tick(61_000); const b = await r.fresh();
    expect(b.tokens).toHaveLength(2);
    down = true; r.tick(61_000); const c = await r.fresh();
    expect(c.tokens).toHaveLength(2);
  });
  it("reads trades for the live line at most once a minute", async () => {
    const r = rig();
    const h = await r.t.home();
    expect(h.activity.map((x) => x.kind)).toContain("sell");
    expect(h.counts).toMatchObject({ tokens: 2, sol: 1, eth: 1, curve: 1 });
    await r.t.home();
    expect(r.calls.trades).toBe(1);
  });
});

describe("the routes", () => {
  const call = async (path: string, t: Terminal) => {
    let out: { status: number; body: unknown; headers?: Record<string, string> } | null = null;
    const ctx = { json: (_res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>) => { out = { status, body, headers }; }, limited: () => false };
    const handled = await terminalRoutes({ method: "GET", url: path } as IncomingMessage, {} as ServerResponse, path, ctx, t);
    return { handled, ...(out as unknown as { status: number; body: Record<string, unknown>; headers: Record<string, string> }) };
  };
  it("answers the front page and the list, cacheable, and nothing else", async () => {
    const r = rig();
    const home = await call("/api/terminal/home", r.t);
    expect(home.status).toBe(200);
    expect(Object.keys(home.body.sections as object)).toEqual(["trending", "fresh", "graduating", "gainers", "losers", "volume"]);
    expect(home.headers["Cache-Control"]).toBe("public, max-age=20");
    expect((await call("/api/terminal/tokens", r.t)).body.tokens).toHaveLength(2);
    expect((await call("/api/terminal/nope", r.t)).status).toBe(404);
    expect(await terminalRoutes({ method: "GET" } as IncomingMessage, {} as ServerResponse, "/api/other", { json: () => {}, limited: () => false }, r.t)).toBe(false);
  });
});
