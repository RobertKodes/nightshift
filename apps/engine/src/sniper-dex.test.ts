import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import type { DexPair } from "./imdmarket.js";
import type { LaunchDetail, LaunchRow } from "./services/imd.js";
import type { Slot0 } from "./services/v4pool.js";
import type { VerdictReport } from "./services/verdict.js";
import { type DexDeps, change24, createDex } from "./sniper-dex.js";

const NATIVE = "0x0000000000000000000000000000000000000000";
const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const tok = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const sqrtOf = (ratio: number): bigint => BigInt(Math.floor(Math.sqrt(ratio) * 2 ** 96));
const slot = (ratio: number): Slot0 => ({ sqrtPriceX96: sqrtOf(ratio), tick: 0, protocolFee: 0, lpFee: 12500, liquidity: 1n });

function launch(n: number, o: Partial<LaunchRow> & { quote?: string } = {}): LaunchRow {
  const t = tok(n);
  return {
    id: `id-${n}`, launchNumber: n, kind: "custom_token", status: "live", chainId: 1, sourceRepoUrl: null, createdAt: "2026-10-20T00:00:00Z",
    artifacts: [{ role: "token", name: `T${n}`, address: t }],
    seeded: { pools: [{ fee: 12500, hooks: NATIVE, currency0: o.quote ?? NATIVE, currency1: t, tickSpacing: 60 }] }, ...o,
  };
}

function rig(rows: LaunchRow[], o: { nft?: Address } = {}) {
  let now = Date.parse("2026-10-23T12:00:00Z");
  const ratio = new Map<string, number>(); // tokens per quote, by token
  const d: DexDeps = {
    now: () => now,
    allLaunches: async () => rows,
    detail: async (id) => ({ id, requester: "0x00000000000000000000000000000000000000dd", kind: "custom_token", economics: { poolBps: 8800, initialMarketCapWei: "10000000000000000000" } }) as unknown as LaunchDetail,
    basics: async (t) => ({ name: `Token ${t.slice(-2)}`, symbol: `T${parseInt(t.slice(-4), 16)}`, decimals: 18, totalSupply: 10n ** 27n }),
    // the pool id is not checked here: every pool answers with its token's own price
    slot0: async (_id: Hex) => slot(ratio.get(current) ?? 1e8),
    decimals: async () => 18,
    verdict: async (t) => ({ verdict: "safe", summary: "", reasons: [{ id: "plain", impact: "good", text: "plain", evidence: [] }], asset: { name: null, symbol: null, decimals: 18, totalSupply: "1" }, imd: { isLaunch: true, repo: "x" }, pool: null } as unknown as VerdictReport),
    // DexScreener lists only the first launch's pool
    dexQuotes: async (tokens) => new Map<string, DexPair>(tokens.filter((t) => t === tok(1)).map((t) => [t, { url: "https://dexscreener.com/x", liquidity: { usd: 5000 }, volume: { h24: 100 } } as DexPair])),
    nft: async (a) => (a === o.nft ? { standard: "ERC-721", name: "Sworn", symbol: "SWORN", minted: null, maxSupply: null, price: null, owner: null } : null),
    file: null,
  };
  let current = "";
  const realSlot0 = d.slot0;
  const dex = createDex({ ...d, slot0: async (id) => realSlot0(id) });
  return {
    dex, at: (ms: number) => { now += ms; }, now: () => now,
    price: (n: number, r: number) => { ratio.set(tok(n), r); current = tok(n); },
  };
}

describe("the NIGHT SNIPER dex", () => {
  it("adds every live Ethereum token, a few each minute, priced from its own pool", async () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => launch(n));
    rows.push(launch(9, { chainId: 4663 }), launch(10, { status: "parked" }));
    const r = rig(rows);
    r.price(8, 1e8);
    await r.dex.tick();
    expect(r.dex.size().tokens).toBe(6);
    r.at(60_000);
    await r.dex.tick();
    expect(r.dex.size().tokens).toBe(8);
    // DexScreener is read every 30 minutes: the next read covers the tokens added since
    r.at(30 * 60_000 + 1);
    await r.dex.tick();
    // 1e8 tokens per ETH, 1e9 supply: 10 ETH, launched at 10 ETH
    const v = r.dex.view({ sort: "new" }, (q) => (q === NATIVE ? 2000 : 0));
    expect(v.tokens[0]).toMatchObject({ launch: 8, quote: "ETH", onDexScreener: false });
    expect(v.tokens[0]!.mcapNow).toBeCloseTo(20_000, 0);
    expect(v.tokens[0]!.mcap0).toBeCloseTo(20_000, 0);
    expect(v.tokens[0]!.sinceLaunch).toBeCloseTo(1, 5);
    expect(v.tokens.find((t) => t.launch === 1)!.onDexScreener).toBe(true);
    expect(v.verdicts).toBeGreaterThan(0);
  });

  it("finds a token by symbol, launch number or address, and hides the newest from non-holders", async () => {
    const rows = [launch(11), launch(12, { createdAt: "2026-10-23T11:59:00Z", quote: IMD })];
    const r = rig(rows);
    await r.dex.tick();
    const usd = () => 1;
    expect(r.dex.view({ q: "#12" }, usd).tokens.map((t) => t.launch)).toEqual([12]);
    expect(r.dex.view({ q: tok(11) }, usd).tokens.map((t) => t.launch)).toEqual([11]);
    expect(r.dex.view({ q: "$T11" }, usd).tokens.map((t) => t.launch)).toEqual([11]);
    expect(r.dex.view({ hideNewerThan: Date.parse("2026-10-23T11:00:00Z") }, usd).tokens.map((t) => t.launch)).toEqual([11]);
    expect(r.dex.view({ q: "#12" }, usd).tokens[0]!.quote).toBe("IMD");
  });

  it("lists IMD NFT collections, old ones too", async () => {
    const sworn = "0x39bec7648259d5a128c29b24951eabcd4d1f95a6" as Address;
    const r = rig([launch(2147, { kind: "evm_contracts", artifacts: [{ role: "other", name: "Composer", address: tok(1) }, { role: "other", name: "Registry", address: sworn }] })], { nft: sworn });
    await r.dex.tick();
    expect(r.dex.view({}, () => 1).nfts).toMatchObject([{ launch: 2147, name: "Sworn", symbol: "SWORN", standard: "ERC-721" }]);
  });

  it("measures the 24-hour move from the hourly prices", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    const hourly: [number, number][] = [[now - 24 * 3_600_000, 2], [now - 3_600_000, 3]];
    expect(change24({ hourly, price: 3 }, now)).toBeCloseTo(0.5, 6);
    expect(change24({ hourly: [[now - 3_600_000, 3]], price: 3 }, now)).toBeNull();
  });
});
