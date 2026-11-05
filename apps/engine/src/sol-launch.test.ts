import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lockOf } from "./sol-chain.js";
import { fromPairs, launchpadOf } from "./sol-discover.js";
import { checkMeta, cleanText, type ConfigView, devLock, priceFromSqrt, proxyRpc, safetyChecks, type SolChain, SolInputError, SolLaunchpad, type SolSettings, type SwarmPort, termsProblems, WSOL } from "./sol-launch.js";

const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MINT2 = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const CONFIG = "628VVs4Y3QSD3J6GnXncY9UQkdumy1CdZRGuibtaCDBa";
const CUSTOM = "3rByufzjNhxy7JUg4C2BzCdZC5TYEdsDEz7onUVoDEp3";
const PARTNER = "6FsYW1KM2WURB7G7SB8BXhNq7vZjyvqbyu7dPRmWMHQU";
const CREATOR = "14ZmvqkfaLktiWh2S7efeNpzQqQZ5RxxEae3ufepjiyp";
const POOL = "C2LmaBmAJ74wtuwKoNj7Y29grqFnqtsjLVQpcmSPYYs8";
const VAULT = "2wvUcq9KrGo6AuvKcNQxUHHtFyzk15o4U2TCZhcc7ari";
const SIG = "5".repeat(88);
const PNG = `data:image/png;base64,${Buffer.from("png bytes").toString("base64")}`;
const SUPPLY = 1_000_000_000_000_000n; // 1B with 6 decimals

const cfg: ConfigView = {
  config: CONFIG, feeClaimer: PARTNER, leftoverReceiver: PARTNER, quoteMint: WSOL, threshold: 85_000_000_000n, tokenDecimal: 6, supply: SUPPLY, tokenUpdateAuthority: 1,
  creatorFeePct: 50, partnerLockedPct: 50, creatorLockedPct: 50, partnerLpPct: 0, creatorLpPct: 0, migrationOption: 1, cliffFeeNumerator: 500_000_000n, poolCreationFee: 40_000_000n,
  devLocked: 0n, devCliffSecs: 0, devPeriods: 0, devPeriodSecs: 0,
};
// the creator's own config: 70% locked, 180 days after graduation, then daily over 365 days
const custom: ConfigView = { ...cfg, config: CUSTOM, devLocked: (SUPPLY * 7n) / 10n, devCliffSecs: 180 * 86_400, devPeriods: 365, devPeriodSecs: 86_400 };
// a sqrt price of 2^64 means 1 quote atom per base atom: 0.001 SOL per token at 6 / 9 decimals
const pool = { pool: POOL, config: CONFIG, creator: CREATOR, baseMint: MINT, baseVault: VAULT, quoteReserve: 42_500_000_000n, sqrtPrice: 2n ** 64n, migrated: false, activationPoint: 0 };

function fakeChain(over: Partial<SolChain> = {}): SolChain {
  return {
    poolOf: async (c, m) => (m === MINT || m === MINT2 ? { ...pool, config: c, baseMint: m } : null),
    pools: async (a) => a.map(() => pool),
    config: async (c) => (c === CONFIG ? cfg : c === CUSTOM ? custom : null),
    mint: async () => ({ mintAuthority: null, freezeAuthority: null, supply: SUPPLY, decimals: 6 }),
    holders: async () => [{ account: VAULT, owner: POOL, amount: 800_000_000_000_000n }, { account: "a1", owner: CREATOR, amount: 20_000_000_000_000n }, { account: "a2", owner: "w2", amount: 10_000_000_000_000n }],
    newLaunches: async () => ({ newest: null, mints: [] }),
    onchainMeta: async () => null,
    paidTo: async () => 0n,
    solUsd: async () => 100,
    ...over,
  };
}
const settings = (o: Partial<SolSettings> = {}): (() => SolSettings) => () => ({ network: "mainnet", rpc: "http://rpc", config: CONFIG, partner: PARTNER, review: false, kit: false, ...o });
function fakeSwarm() {
  const orders: { kind: string; brief: string; ref: string }[] = [];
  const state: Record<string, string> = {};
  const port: SwarmPort = {
    ready: () => true,
    order: async (kind, brief, ref) => { orders.push({ kind, brief, ref }); state[ref] = "running"; },
    follow: async (ref) => (state[ref] ? { status: state[ref]!, job: `job-${ref}`, site: ref.startsWith("sol-kit") && state[ref] === "done" ? "https://site.imd" : null } : null),
  };
  return { port, orders, state };
}
const make = (chain = fakeChain(), s = settings(), swarm: SwarmPort | null = null) => new SolLaunchpad(chain, s, mkdtempSync(join(tmpdir(), "sol-")), "https://site.test", swarm);
const input = { mint: MINT, name: "Night Frog", symbol: "nfrog", description: "gm", website: "https://frog.test", twitter: "https://x.com/frog", telegram: "https://t.me/frog", image: PNG };

describe("token details", () => {
  it("checks names, tickers, links and the logo, and strips spoofing characters", () => {
    const { meta, image } = checkMeta(input);
    expect(meta.symbol).toBe("NFROG");
    expect(image && "bytes" in image && image.ext).toBe("png");
    expect(() => checkMeta({ ...input, symbol: "X" })).toThrow(SolInputError);
    expect(() => checkMeta({ ...input, twitter: "https://evil.test/frog" })).toThrow(/x\.com/);
    expect(() => checkMeta({ ...input, website: "http://plain.test" })).toThrow(/https/);
    expect(() => checkMeta({ ...input, image: "data:image/svg+xml;base64,PHN2Zz4=" })).toThrow(/webp, png/);
    expect(() => checkMeta({ ...input, image: `data:image/png;base64,${Buffer.alloc(170_000).toString("base64")}` })).toThrow(/160 KB/);
    expect(() => checkMeta({ ...input, image: "", imageUrl: "" })).toThrow(/logo/);
    // a right-to-left override would show "PIRATE" reversed
    expect(checkMeta({ ...input, name: "Night‮Frog​" }).meta.name).toBe("NightFrog");
    expect(cleanText("‮ETARIP")).toBe("ETARIP");
  });

  it("hosts the metadata JSON and the logo under the mint", () => {
    const pad = make();
    const r = pad.saveMeta(input);
    expect(r.uri).toBe(`https://site.test/api/sol/meta/${MINT}.json`);
    expect(pad.meta(MINT)).toMatchObject({ name: "Night Frog", symbol: "NFROG", image: r.image, extensions: { launchpad: `https://site.test/launchpad/sol/${MINT}` } });
    expect(pad.image(`${MINT}.png`)?.type).toBe("image/png");
    expect(pad.image("../settings.json")).toBeNull();
    expect(pad.list()).toEqual([]);
  });
});

describe("a launch", () => {
  it("on the shared config is listed once its pool is on chain", async () => {
    const pad = make();
    pad.saveMeta(input);
    const l = await pad.launched(MINT, SIG);
    expect(l).toMatchObject({ status: "live", pool: POOL, creator: CREATOR, source: "nightshift", config: CONFIG, dev: null });
    expect(l.priceSol).toBeCloseTo(0.001);
    expect(l.mcapSol).toBeCloseTo(1_000_000);
    expect(l.progress).toBeCloseTo(0.5);
    expect(pad.list().map((x) => x.mint)).toEqual([MINT]);
    expect(pad.chart(MINT)).toHaveLength(1);
    expect(() => pad.saveMeta(input)).toThrow(/already launched/);
  });

  it("on the creator's own config shows the locked 70% and its schedule", async () => {
    const pad = make();
    pad.saveMeta({ ...input, mint: MINT2 });
    const l = await pad.launched(MINT2, SIG, CUSTOM);
    expect(l.dev).toEqual({ pct: 70, cliffDays: 180, vestDays: 365 });
    expect(l.checks.find((c) => c.key === "devlock")?.says).toMatch(/70% is the creator's.*180 days.*365 days/);
  });

  it("is refused on a config that pays someone else or loosens the guarantees", async () => {
    const pad = make(fakeChain({ config: async (c) => (c === CUSTOM ? { ...custom, feeClaimer: CREATOR, partnerLockedPct: 0, partnerLpPct: 50 } : cfg) }));
    pad.saveMeta(input);
    await expect(pad.launched(MINT, SIG, CUSTOM)).rejects.toThrow(/another wallet.*not 100% locked/);
  });

  it("is refused while the launchpad is closed or before the details are saved", async () => {
    await expect(make(fakeChain(), settings({ partner: null })).launched(MINT, SIG)).rejects.toThrow(/not open/);
    await expect(make().launched(MINT, SIG)).rejects.toThrow(/save its details/);
  });

  it("finds launches made elsewhere with the shared config key", async () => {
    const pad = make(fakeChain({
      newLaunches: async () => ({ newest: SIG, mints: [{ mint: MINT, signature: SIG, at: 1 }] }),
      onchainMeta: async () => ({ name: "Elsewhere", symbol: "ELSE", uri: "https://other.test/m.json" }),
    }));
    await pad.refresh();
    expect(pad.one(MINT)).toMatchObject({ name: "Elsewhere", source: "elsewhere", status: "live", pool: POOL });
  });
});

describe("the IMD swarm on every launch", () => {
  it("orders the swarm's review and follows it to the job page", async () => {
    const sw = fakeSwarm();
    const pad = make(fakeChain(), settings({ review: true }), sw.port);
    pad.saveMeta(input);
    await pad.launched(MINT, SIG);
    await pad.work();
    expect(sw.orders).toMatchObject([{ kind: "research", ref: `sol-review:${MINT}` }]);
    expect(sw.orders[0]!.brief).toMatch(/Night Frog.*NFROG.*verdict/);
    sw.state[`sol-review:${MINT}`] = "done";
    await pad.work();
    expect(pad.one(MINT)?.review).toMatchObject({ state: "done", url: `https://explorer.imd.fun/jobs/job-sol-review:${MINT}` });
    expect((await pad.info()).counts.reviewed).toBe(1);
  });

  it("builds the website only when the launch paid for it, and shows the site", async () => {
    const sw = fakeSwarm();
    const unpaid = make(fakeChain(), settings({ kit: true }), sw.port);
    unpaid.saveMeta({ ...input, kit: true });
    expect((await unpaid.launched(MINT, SIG)).kit).toBeNull();
    // $6 at $100 a SOL is 0.06 SOL; the launch transaction sent it to the partner wallet
    const paid = make(fakeChain({ paidTo: async (_s, a) => (a === PARTNER ? 60_000_000n : 0n) }), settings({ kit: true }), sw.port);
    expect((await paid.info()).imd.kitLamports).toBe("60000000");
    paid.saveMeta({ ...input, kit: true });
    expect((await paid.launched(MINT, SIG)).kit).toMatchObject({ ref: `sol-kit:${MINT}`, paidSol: 0.06 });
    await paid.work();
    sw.state[`sol-kit:${MINT}`] = "done";
    await paid.work();
    expect(paid.one(MINT)?.kit).toMatchObject({ state: "done", url: "https://site.imd" });
  });

  it("offers nothing while the Swarm Desk is not running", async () => {
    const pad = make(fakeChain(), settings({ review: true, kit: true }), { ...fakeSwarm().port, ready: () => false });
    expect((await pad.info()).imd).toMatchObject({ review: false, kit: false, kitLamports: null });
  });
});

describe("prices, locks and checks", () => {
  it("reads the price from the Q64.64 sqrt price", () => {
    expect(priceFromSqrt(2n ** 64n, 6)).toBeCloseTo(0.001);
    expect(priceFromSqrt(2n ** 63n, 6)).toBeCloseTo(0.00025);
  });

  it("reads the creator's lock from a config's locked vesting", () => {
    const v = lockOf({ amountPerPeriod: { toString: () => "1917808219178" }, numberOfPeriod: { toString: () => "365" }, cliffUnlockAmount: { toString: () => "0" }, cliffDurationFromMigrationTime: { toString: () => String(180 * 86_400) }, frequency: { toString: () => "86400" } });
    expect(devLock({ ...cfg, ...v })).toEqual({ pct: 70, cliffDays: 180, vestDays: 365 });
    expect(devLock(cfg)).toBeNull();
  });

  it("names what a config gets wrong", () => {
    expect(termsProblems(cfg, PARTNER)).toEqual([]);
    expect(termsProblems({ ...cfg, tokenUpdateAuthority: 0, migrationOption: 0, quoteMint: MINT }, PARTNER)).toEqual(["it is not priced in SOL", "its tokens are not frozen", "it does not graduate to DAMM v2"]);
  });

  it("leaves the pool's vault out of the holders and flags concentration", () => {
    const ok = safetyChecks({ mintAuthority: null, freezeAuthority: null, supply: 1000n, decimals: 6 }, [{ account: VAULT, owner: POOL, amount: 900n }, { account: "a", owner: CREATOR, amount: 20n }], pool, 1);
    expect(ok.every((c) => c.ok)).toBe(true);
    const bad = safetyChecks({ mintAuthority: "M1nt", freezeAuthority: "Fr33", supply: 1000n, decimals: 6 }, [{ account: "a", owner: CREATOR, amount: 400n }], pool, 9);
    expect(bad.filter((c) => c.ok === false).map((c) => c.key)).toEqual(["mint", "freeze", "top10", "creator", "serial"]);
  });
});

describe("the shared config key", () => {
  it("must claim fees to the partner and match the NIGHTSHIFT terms", async () => {
    const pad = make();
    expect(await pad.verifyConfig(CONFIG, PARTNER)).toMatchObject({ ok: true });
    expect(await pad.verifyConfig(CONFIG, CREATOR)).toMatchObject({ ok: false, why: expect.stringMatching(/another wallet/) });
    expect(await pad.verifyConfig(MINT2, PARTNER)).toMatchObject({ ok: false, why: expect.stringMatching(/No Meteora/) });
  });
});

describe("discovery", () => {
  it("names the launchpad by the mint's suffix", () => {
    expect(launchpadOf("9mWrj77gDZ7w4rwHF6STYXDZmYRMyf39L4go1mXepump", "pumpfun")).toBe("pump.fun");
    expect(launchpadOf("Abcbonk", "raydium")).toBe("LetsBonk");
    expect(launchpadOf("AbcBAGS", "meteora")).toBe("Bags");
    expect(launchpadOf("Abc", "raydium")).toBeNull();
  });

  it("prices a pump.fun curve from SOL and keeps the deepest pair", () => {
    const m = "GWdS5xTBCvxxHivqgvGR9HaARDZSUzJmJLAHTnKfpump";
    const base = { address: m, name: "Betelgeuse", symbol: "BTL" };
    const d = fromPairs(m, [
      { chainId: "solana", dexId: "pumpfun", url: "u1", baseToken: base, priceNative: "0.00000003", txns: { h24: { buys: 5, sells: 2 } }, volume: { h24: 100 } },
      { chainId: "solana", dexId: "pumpswap", url: "u2", baseToken: base, priceNative: "0.00000005", priceUsd: "0.000005", liquidity: { usd: 9000 }, marketCap: 5000, txns: { h24: { buys: 1, sells: 1 } }, volume: { h24: 50 } },
    ], 100, true);
    expect(d).toMatchObject({ dex: "pumpswap", launchpad: "pump.fun", mcapUsd: 5000, buys24: 6, sells24: 3, vol24: 150, boosted: true, url: "u2" });
    const curve = fromPairs(m, [{ chainId: "solana", dexId: "pumpfun", url: "u1", baseToken: base, priceNative: "0.00000003" }], 100, false);
    expect(curve?.mcapUsd).toBeCloseTo(3000);
  });
});

describe("the RPC proxy", () => {
  it("forwards reads and sends, refuses scans", async () => {
    const seen: unknown[] = [];
    const send = async (b: unknown) => { seen.push(b); return { jsonrpc: "2.0", id: (b as { id: unknown }).id, result: { context: { slot: 1 }, value: "ok" } }; };
    await proxyRpc("http://rpc", { jsonrpc: "2.0", id: 1, method: "getLatestBlockhash", params: [] }, send);
    expect(seen).toHaveLength(1);
    await expect(proxyRpc("http://rpc", { jsonrpc: "2.0", id: 2, method: "getProgramAccounts", params: [] }, send)).rejects.toThrow(/not available/);
    await expect(proxyRpc("http://rpc", { method: "getSlot" }, send)).rejects.toThrow(/JSON-RPC/);
    await expect(proxyRpc("http://rpc", Array.from({ length: 11 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "getSlot" })), send)).rejects.toThrow(/1 to 10/);
  });

  it("splits getMultipleAccounts into calls of 10 and joins the answers in order", async () => {
    const send = async (b: unknown) => { const keys = (b as { params: string[][] }).params[0]!; return { jsonrpc: "2.0", id: 7, result: { context: { slot: 5 }, value: keys.map((k) => ({ k })) } }; };
    const keys = Array.from({ length: 23 }, (_, i) => `k${i}`);
    const r = await proxyRpc("http://rpc", { jsonrpc: "2.0", id: 7, method: "getMultipleAccounts", params: [keys, { encoding: "base64" }] }, send) as { result: { value: { k: string }[] } };
    expect(r.result.value.map((v) => v.k)).toEqual(keys);
  });
});
