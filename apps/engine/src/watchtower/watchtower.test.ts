import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Address, type Hex, decodeFunctionData, encodeAbiParameters, encodeFunctionResult, keccak256, pad, parseAbi, toFunctionSelector, toHex } from "viem";
import { beforeAll, describe, expect, it } from "vitest";
import type * as ContextT from "../services/context.js";
import type { Pair } from "../services/market.js";
import type * as NetT from "../services/net.js";
import type * as DiffT from "./diff.js";
import type * as McpT from "./mcp.js";
import type * as ObserveT from "./observe.js";
import type * as ReportT from "./report.js";
import type * as RoutesT from "./routes.js";
import type * as WatchtowerT from "./watchtower.js";

/**
 * Watchtower on a fake chain and a fake DexScreener: every read is answered in memory (Multicall3
 * batches included), so nothing here touches a network.
 */
let X: typeof ContextT, N: typeof NetT, D: typeof DiffT, M: typeof McpT, O: typeof ObserveT, Rp: typeof ReportT, R: typeof RoutesT, W: typeof WatchtowerT;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "watchtower-test-"));
  [X, N, D, M, O, Rp, R, W] = await Promise.all([import("../services/context.js"), import("../services/net.js"), import("./diff.js"), import("./mcp.js"), import("./observe.js"), import("./report.js"), import("./routes.js"), import("./watchtower.js")]);
}, 120_000); // the first import compiles the engine's service modules

const TOKEN = "0x1111111111111111111111111111111111111111";
const SMALL = "0x2222222222222222222222222222222222222222";
const HOOK = "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc"; // NightshiftHook, a known template
const OWNER_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OWNER_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const IMPL_A = "0xcccccccccccccccccccccccccccccccccccccccc";
const IMPL_B = "0xdddddddddddddddddddddddddddddddddddddddd";
const WALLET = "0x9999999999999999999999999999999999999999";
const PAYER = "0x8888888888888888888888888888888888888888";
const MC3 = "0xca11bde05977b3631167028862be2a173976ca11";
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const MCABI = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  "function getBlockHash(uint256 blockNumber) view returns (bytes32 blockHash)",
]);
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 25, 12, 0, 0);

/** An Ethereum node in memory: code, storage slots and getters, with switches to make it fail. */
class Chain {
  head = 21_000_000n;
  code: Record<string, Hex> = {};
  slots: Record<string, Hex> = {};
  views: Record<string, Hex> = {};
  down = { head: false, call: false };
  set(a: string, sig: string, type: string, v: unknown) { this.views[`${a.toLowerCase()}:${toFunctionSelector(sig)}`] = encodeAbiParameters([{ type }], [v]); }
  one(to: string, data: Hex): { ok: true; data: Hex } | { ok: false; error: string } {
    if (to.toLowerCase() === MC3) {
      const n = BigInt(`0x${data.slice(10)}`);
      return { ok: true, data: n < this.head ? keccak256(toHex(n)) : pad("0x0") }; // the EVM sees only past block hashes
    }
    const v = this.views[`${to.toLowerCase()}:${data.slice(0, 10)}`];
    return v ? { ok: true, data: v } : { ok: false, error: "execution reverted" };
  }
  rpc: NetT.Rpc = {
    head: async () => { if (this.down.head) throw new Error("HTTP request failed. URL: https://node.example/key"); return this.head; },
    code: async (a) => this.code[a.toLowerCase()] ?? "0x",
    storage: async (a, s) => this.slots[`${a.toLowerCase()}:${s}`] ?? pad("0x0"),
    call: async (tx) => {
      if (this.down.call) return { ok: false, error: "429 Too Many Requests" };
      if (tx.to.toLowerCase() !== MC3) return this.one(tx.to, tx.data);
      const { args } = decodeFunctionData({ abi: MCABI, data: tx.data });
      const rows = (args[0] as readonly { target: Address; callData: Hex }[]).map((c) => { const r = this.one(c.target, c.callData); return { success: r.ok, returnData: r.ok ? r.data : ("0x" as Hex) }; });
      return { ok: true, data: encodeFunctionResult({ abi: MCABI, functionName: "aggregate3", result: rows }) };
    },
    logs: async () => [],
  };
}

/** DexScreener and Sourcify in memory. */
class Web {
  pairs: Record<string, Pair[]> = {};
  dexDown: number | null = null;
  sourcify: Record<string, unknown> = {};
  reads = 0;
  net: NetT.Net = {
    json: async <T,>(url: string): Promise<T> => {
      this.reads++;
      if (url.startsWith("https://api.dexscreener.com/tokens/v1/ethereum/")) {
        if (this.dexDown) throw new N.HttpError(this.dexDown, url);
        return (this.pairs[url.split("/").pop()!] ?? []) as T;
      }
      if (url.startsWith("https://sourcify.dev/")) {
        const s = this.sourcify[url.split("/")[7]!.split("?")[0]!];
        if (!s) throw new N.HttpError(404, url);
        return s as T;
      }
      throw new Error(`not faked: ${url}`);
    },
  };
}
const pair = (token: string, usd: number, id: string): Pair => ({
  chainId: "ethereum", dexId: "uniswap", url: `https://dexscreener.com/ethereum/${id}`, pairAddress: id, labels: ["v4"],
  baseToken: { address: token, name: "Test", symbol: "TST" }, quoteToken: { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", name: "Wrapped Ether", symbol: "WETH" }, liquidity: { usd },
});

function world() {
  const clock = { t: T0 };
  const chain = new Chain();
  const web = new Web();
  chain.code[TOKEN] = "0x6080604052";
  chain.set(TOKEN, "owner()", "address", OWNER_A);
  chain.set(TOKEN, "name()", "string", "Test Token");
  chain.set(TOKEN, "symbol()", "string", "TST");
  chain.set(TOKEN, "decimals()", "uint8", 18);
  chain.set(TOKEN, "totalSupply()", "uint256", 1_000_000n * 10n ** 18n);
  web.pairs[TOKEN] = [pair(TOKEN, 100_000, "0xpair1")];
  const ctx = X.context({ net: web.net, rpc: chain.rpc, now: () => clock.t, etherscanKey: "", watchtowerUrl: "" });
  const advance = (ms: number) => { clock.t += ms; chain.head += BigInt(Math.round(ms / 12_000)); };
  return { clock, chain, web, ctx, advance };
}
const tmpFile = () => join(mkdtempSync(join(tmpdir(), "watchtower-state-")), "watchtower.json");
const FORBIDDEN = /\bsafe\b|\bsecure\b|risk-free/i;
/** No reassurance words, outside the one required coverage sentence. */
const clean = (r: ReportT.WatchReport) => !FORBIDDEN.test(r.summary) && !FORBIDDEN.test(r.human.replace(Rp.COVERAGE_NOTE, ""));

describe("observe and diff", () => {
  it("records a baseline, then reports an owner change with before, after, blocks and links", async () => {
    const { chain, ctx, advance } = world();
    const wt = new W.Watchtower({ ctx, file: null });
    const r1 = await wt.check(TOKEN);
    expect(r1.baseline).toBeNull();
    expect(r1.summary).toMatch(/^Baseline recorded at block 21,000,000; nothing to compare yet\. \d+ checks completed, 0 checks unavailable, these checks are not supported: /);
    expect(r1.changes).toEqual([]);
    const o = r1.observation!;
    expect(o).toMatchObject({ chainId: 1, kind: "token", block: { number: 21_000_000, confirmations: 0, hash: null, parentHash: keccak256(toHex(20_999_999n)) } });
    expect(o.checks["owner()"]).toMatchObject({ status: "ok", value: OWNER_A, source: `https://etherscan.io/address/${TOKEN}` });
    expect(o.checks.totalSupply).toMatchObject({ status: "ok", value: (10n ** 24n).toString() });
    expect(o.checks.liquidity).toMatchObject({ status: "ok", value: { totalUsd: 100_000, pairs: 1 }, source: "https://dexscreener.com/ethereum/0xpair1" });
    expect(o.checks["getOwner()"]).toMatchObject({ status: "ok", value: null, display: "not present" });
    // no verified source and no known template: fee settings cannot be located, and are said to be unsupported
    expect(o.checks.fees).toMatchObject({ status: "unsupported" });
    expect(r1.unsupported.map((u) => u.id)).toEqual(expect.arrayContaining(["fees", "transferRestrictions", "roles"]));
    expect(r1.scope).toMatch(/Ethereum mainnet \(chainId 1\) only/);

    advance(HOUR);
    chain.set(TOKEN, "owner()", "address", OWNER_B);
    const r2 = await wt.check(TOKEN);
    expect(r2.baseline).toMatchObject({ block: 21_000_000 });
    expect(r2.changes).toHaveLength(1);
    expect(r2.changes[0]).toMatchObject({ id: "owner()", kind: "change", severity: "high", before: OWNER_A, after: OWNER_B, beforeBlock: 21_000_000, afterBlock: 21_000_300 });
    expect(r2.changes[0]!.evidence).toEqual(expect.arrayContaining([`https://etherscan.io/address/${TOKEN}`, "https://etherscan.io/block/21000000", "https://etherscan.io/block/21000300"]));
    expect(r2.summary).toMatch(/^Block 21,000,300 compared with block 21,000,000: \d+ checks completed, 1 change detected \(1 high\), 0 checks unavailable, these checks are not supported/);
    expect(r2.human).toContain(OWNER_B);
    expect(r2.human).toContain("https://etherscan.io/block/21000300");
    expect(clean(r1) && clean(r2)).toBe(true);
  });

  it("reports an EIP-1967 implementation upgrade as high", async () => {
    const { chain, ctx, advance } = world();
    chain.slots[`${TOKEN}:${IMPL_SLOT}`] = pad(IMPL_A);
    const wt = new W.Watchtower({ ctx, file: null });
    expect((await wt.check(TOKEN)).observation!.checks["eip1967.implementation"]).toMatchObject({ status: "ok", value: IMPL_A });
    advance(HOUR);
    chain.slots[`${TOKEN}:${IMPL_SLOT}`] = pad(IMPL_B);
    const r = await wt.check(TOKEN);
    expect(r.changes.map((c) => [c.id, c.severity, c.before, c.after])).toEqual([["eip1967.implementation", "high", IMPL_A, IMPL_B]]);
  });

  it("reads every supported check and gives each change its default severity", async () => {
    const { chain, web, ctx, advance } = world();
    const BEACON = "0xbeac0000000000000000000000000000000000aa";
    const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
    const BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
    chain.slots[`${TOKEN}:${ADMIN_SLOT}`] = pad(OWNER_A);
    chain.slots[`${TOKEN}:${BEACON_SLOT}`] = pad(BEACON);
    chain.code[BEACON] = "0x60";
    chain.set(BEACON, "implementation()", "address", IMPL_A);
    chain.set(TOKEN, "paused()", "bool", false);
    chain.set(TOKEN, "admin()", "address", OWNER_A);
    chain.set(TOKEN, "getOwner()", "address", OWNER_A);
    chain.set(TOKEN, "sellTax()", "uint256", 5);
    const view = (name: string, out: string) => ({ type: "function", name, inputs: [], outputs: [{ type: out }], stateMutability: "view" });
    web.sourcify[TOKEN] = { abi: [view("sellTax", "uint256"), view("totalFees", "uint256"), view("owner", "address")], sources: { "src/T.sol": { content: "contract T {}" } }, compilation: { name: "T" }, proxyResolution: null, deployment: null };
    const wt = new W.Watchtower({ ctx, file: null });
    const r1 = await wt.check(TOKEN);
    const c = r1.observation!.checks;
    expect(c["fee.sellTax"]).toMatchObject({ status: "ok", value: 5, group: "fee" });
    expect(c["fee.totalFees"]).toBeUndefined(); // a running total, not a setting
    expect(c["eip1967.beaconImplementation"]).toMatchObject({ status: "ok", value: IMPL_A, source: `https://etherscan.io/address/${BEACON}` });
    expect(c["eip1967.admin"]).toMatchObject({ status: "ok", value: OWNER_A });
    expect(Object.values(c).filter((x) => x.status === "unavailable")).toEqual([]);

    advance(HOUR);
    chain.code[TOKEN] = "0x6080604053";
    chain.slots[`${TOKEN}:${ADMIN_SLOT}`] = pad(OWNER_B);
    chain.set(BEACON, "implementation()", "address", IMPL_B);
    chain.set(TOKEN, "paused()", "bool", true);
    chain.set(TOKEN, "admin()", "address", OWNER_B);
    chain.set(TOKEN, "getOwner()", "address", OWNER_B);
    chain.set(TOKEN, "sellTax()", "uint256", 10);
    chain.set(TOKEN, "totalSupply()", "uint256", 1_020_000n * 10n ** 18n);
    chain.set(TOKEN, "symbol()", "string", "NEW");
    chain.set(TOKEN, "decimals()", "uint8", 9);
    const r2 = await wt.check(TOKEN);
    expect(Object.fromEntries(r2.changes.map((x) => [x.id, x.severity]))).toEqual({
      code: "high", "eip1967.admin": "high", "eip1967.beaconImplementation": "high", "admin()": "high", "getOwner()": "high", "paused()": "high",
      decimals: "high", "fee.sellTax": "high", totalSupply: "medium", symbol: "low",
    });
    expect(r2.changes.every((x) => x.evidence.includes("https://etherscan.io/block/21000300"))).toBe(true);

    advance(HOUR);
    chain.set(TOKEN, "totalSupply()", "uint256", 1_025_000n * 10n ** 18n); // +0.5%: under 1%
    chain.set(TOKEN, "sellTax()", "uint256", 3);
    const r3 = await wt.check(TOKEN);
    expect(r3.changes.map((x) => [x.id, x.severity])).toEqual([["fee.sellTax", "medium"]]);
  });

  it("reports a liquidity move only above the threshold: 30% and $5,000 medium, 60% high", async () => {
    const { web, chain, ctx, advance } = world();
    const wt = new W.Watchtower({ ctx, file: null });
    await wt.check(TOKEN);
    advance(HOUR); web.pairs[TOKEN] = [pair(TOKEN, 80_000, "0xpair1")];
    expect((await wt.check(TOKEN)).changes).toEqual([]); // -20%: below 30%
    advance(HOUR); web.pairs[TOKEN] = [pair(TOKEN, 50_000, "0xpair1")];
    const mid = await wt.check(TOKEN); // -37.5% from 80k
    expect(mid.changes).toHaveLength(1);
    expect(mid.changes[0]).toMatchObject({ id: "liquidity", severity: "medium" });
    expect(mid.changes[0]!.note).toMatch(/fell 37.5%/);
    expect(mid.changes[0]!.evidence).toContain("https://dexscreener.com/ethereum/0xpair1");
    advance(HOUR); web.pairs[TOKEN] = [pair(TOKEN, 15_000, "0xpair1"), pair(TOKEN, 4_000, "0xpair2")];
    const high = await wt.check(TOKEN); // -62% from 50k
    expect(high.changes[0]).toMatchObject({ id: "liquidity", severity: "high", after: { totalUsd: 19_000, pairs: 2 } });

    // a big share of a small pool, under $5,000: not a change
    chain.code[SMALL] = "0x6080604052";
    for (const [s, t, v] of [["decimals()", "uint8", 18], ["totalSupply()", "uint256", 10n ** 21n]] as const) chain.set(SMALL, s, t, v);
    web.pairs[SMALL] = [pair(SMALL, 8_000, "0xsmall")];
    await wt.check(SMALL);
    advance(HOUR); web.pairs[SMALL] = [pair(SMALL, 4_000, "0xsmall")];
    expect((await wt.check(SMALL)).changes).toEqual([]);
  });

  it("a check that stops answering is lost coverage, never 'no change', and is compared with its last value when it answers again", async () => {
    const { web, chain, ctx, advance } = world();
    const wt = new W.Watchtower({ ctx, file: null });
    await wt.check(TOKEN);
    advance(HOUR); web.dexDown = 503;
    const r = await wt.check(TOKEN);
    expect(r.observation!.checks.liquidity).toMatchObject({ status: "unavailable", reason: "DexScreener answered 503" });
    expect(r.changes).toEqual([expect.objectContaining({ id: "coverage:liquidity", kind: "coverage", after: "unavailable", before: { totalUsd: 100_000, pairs: 1, top: expect.anything() } })]);
    expect(r.unavailable).toEqual([expect.objectContaining({ id: "liquidity", lastValue: expect.objectContaining({ totalUsd: 100_000 }), lastBlock: 21_000_000 })]);
    expect(r.counts).toMatchObject({ changes: 0, unavailable: 1 });
    expect(r.summary).toMatch(/0 changes detected, 1 check unavailable \(liquidity\)/);
    expect(r.summary).not.toMatch(/nothing changed|no change|unchanged/i);
    expect(r.human).toMatch(/Coverage lost[\s\S]*Liquidity \(DexScreener\): unavailable this run; last value `\$100,000 \(1 pair\)`/);

    // the node refuses the batched call: every getter is unavailable, none of them reads as "absent"
    advance(HOUR); chain.down.call = true;
    const r2 = await wt.check(TOKEN);
    expect(r2.observation!.checks["owner()"]).toMatchObject({ status: "unavailable", value: null });
    expect(r2.changes.map((c) => c.id)).toEqual(expect.arrayContaining(["coverage:owner()", "coverage:paused()", "coverage:totalSupply", "coverage:liquidity"]));
    expect(r2.changes.every((c) => c.kind === "coverage")).toBe(true);
    expect(r2.summary).not.toMatch(/nothing changed|no change/i);
    expect(clean(r) && clean(r2)).toBe(true);

    // both answer again: liquidity is compared with its last known value, at its own block
    advance(HOUR); chain.down.call = false; web.dexDown = null; web.pairs[TOKEN] = [pair(TOKEN, 40_000, "0xpair1")];
    const r3 = await wt.check(TOKEN);
    expect(r3.changes.find((c) => c.id === "liquidity")).toMatchObject({ severity: "high", beforeBlock: 21_000_000, before: expect.objectContaining({ totalUsd: 100_000 }) });
  });

  it("refuses bad input, an empty address and a contract that is neither a token nor a hook; a failed head read records nothing", async () => {
    const { chain, ctx } = world();
    const wt = new W.Watchtower({ ctx, file: null });
    await expect(wt.check("0x1234")).rejects.toMatchObject({ status: 400 });
    await expect(wt.check("0x3333333333333333333333333333333333333333")).rejects.toMatchObject({ status: 404 });
    chain.code["0x4444444444444444444444444444444444444444"] = "0x6080604052";
    await expect(wt.check("0x4444444444444444444444444444444444444444")).rejects.toMatchObject({ status: 422 });
    chain.down.head = true;
    const e = await wt.check(TOKEN).catch((x: Error) => x);
    expect(e).toMatchObject({ status: 503 });
    expect((e as Error).message).not.toContain("node.example"); // never the node URL
    chain.down.head = false;
    expect((await wt.check(TOKEN)).baseline).toBeNull(); // the failed read stored nothing
  });

  it("reads a known hook template's fee getters and calls a raised fee high", async () => {
    const { chain, ctx, advance } = world();
    chain.code[HOOK] = "0x6080604052";
    chain.set(HOOK, "owner()", "address", OWNER_A);
    chain.set(HOOK, "shiftFeeBps()", "uint16", 100);
    chain.set(HOOK, "ethFeeBps()", "uint16", 250);
    chain.set(HOOK, "feeSplitter()", "address", IMPL_A);
    chain.set(HOOK, "tradingOpen()", "bool", true);
    const wt = new W.Watchtower({ ctx, file: null });
    const r1 = await wt.check(HOOK);
    expect(r1.kind).toBe("hook");
    expect(r1.observation!.template).toBe("NightshiftHook");
    expect(r1.observation!.checks["fee.shiftFeeBps"]).toMatchObject({ status: "ok", value: 100 });
    expect(r1.observation!.checks.totalSupply).toBeUndefined();
    expect(r1.unsupported.map((u) => u.id)).toEqual(expect.arrayContaining(["liquidity", "poolFee"]));
    advance(HOUR);
    chain.set(HOOK, "shiftFeeBps()", "uint16", 250);
    chain.set(HOOK, "ethFeeBps()", "uint16", 0);
    chain.set(HOOK, "tradingOpen()", "bool", false);
    const r2 = await wt.check(HOOK);
    const sev = Object.fromEntries(r2.changes.map((c) => [c.id, c.severity]));
    expect(sev).toEqual({ "fee.shiftFeeBps": "high", "gate.tradingOpen": "high", "fee.ethFeeBps": "medium" });
  });

  it("finds fee, recipient and gate getters in a verified ABI, and leaves out counters and constants", () => {
    const f = (name: string, out: string) => ({ type: "function", name, inputs: [], outputs: [{ type: out }], stateMutability: "view" });
    const r = O.readersFromAbi([f("sellTax", "uint256"), f("buyFee", "uint16"), f("totalFees", "uint256"), f("MAX_FEE", "uint256"), f("marketingWallet", "address"), f("tradingEnabled", "bool"), f("owner", "address"), f("name", "string")]);
    expect(r.map((x) => x.field)).toEqual(["fee.sellTax", "fee.buyFee", "feeRecipient.marketingWallet", "gate.tradingEnabled"]);
    expect(() => D.thresholdsOf({ liquidityMediumPct: 0 })).toThrow(/liquidityMediumPct/);
    expect(D.thresholdsOf({ severity: { liquidity: "high" } }).severity.liquidity).toBe("high");
  });
});

describe("watches", () => {
  async function started(o: { notify?: WatchtowerT.WatchtowerOptions["notify"]; file?: string | null; days?: number } = {}) {
    const w = world();
    const jobs: WatchtowerT.JobEvent[] = [];
    const wt = new W.Watchtower({ ctx: w.ctx, file: o.file ?? null, notify: o.notify, onJob: (e) => jobs.push(e) });
    const s = await wt.startWatch({ address: TOKEN, owner: WALLET, days: o.days ?? 7, payment: { usd: 1, payer: PAYER, tx: null } });
    return { ...w, wt, jobs, ...s };
  }

  it("starts one prepaid term with a baseline, alerts a high change once and never repeats the same change", async () => {
    const sent: ReportT.WatchReport[] = [];
    const t = await started({ notify: async (_w, r) => { sent.push(r); return true; } });
    expect(t.watch).toMatchObject({ status: "active", days: 7, intervalMinutes: 60, minSeverity: "medium", term: W.TERM, alerts: { enabled: true, telegramLinked: false } });
    expect(t.report.summary).toMatch(/^Baseline recorded at block 21,000,000/);
    expect(t.manageToken.length).toBeGreaterThan(20);
    expect(t.wt.linkTelegram(t.telegramCode.toLowerCase(), 4242)).toMatchObject({ id: t.watch.id, address: TOKEN });

    t.advance(HOUR); t.chain.set(TOKEN, "owner()", "address", OWNER_B); t.chain.set(TOKEN, "name()", "string", "Renamed");
    expect(await t.wt.tick()).toMatchObject({ ran: 1, failed: 0, delivered: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.changes.map((c) => c.id)).toEqual(["owner()"]); // the name change is low: under the watch's medium
    expect(sent[0]!.human).toContain(OWNER_B);

    t.advance(HOUR);
    await t.wt.tick();
    expect(sent).toHaveLength(1); // same owner: no change, no alert

    t.advance(HOUR); t.web.dexDown = 429;
    await t.wt.tick();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.changes.map((c) => [c.id, c.after])).toEqual([["coverage:liquidity", "unavailable"]]);
    t.advance(HOUR);
    await t.wt.tick(); // still unavailable: the same coverage item, deduplicated
    expect(sent).toHaveLength(2);
    const view = t.wt.getWatch(t.watch.id, { token: t.manageToken });
    expect(view.reports[0]!.changes.map((c) => c.id)).toEqual(["coverage:liquidity"]);
    expect(view.reports).toHaveLength(5);
    expect(view.reports[0]!.observation).not.toBeNull(); // only the newest report keeps its full observation
    expect(view.reports.slice(1).every((r) => r.observation === null)).toBe(true);
    expect(view.deliveries.map((d) => d.status)).toEqual(["sent", "sent"]);

    // jobs: public-safe, no address or wallet in the summary
    expect(t.jobs.map((j) => `${j.kind}:${j.status}`)).toEqual(["watch.start:done", "watch.observe:done", "watch.observe:done", "watch.observe:done", "watch.observe:done"]);
    expect(t.jobs[0]).toMatchObject({ free: false, address: TOKEN, paid: { usd: 1, payer: PAYER } });
    for (const j of t.jobs) expect(j.summary).not.toMatch(/0x[0-9a-f]{6}/i);
  });

  it("keeps a slow liquidity drain against its last reported value, so small steps still add up to a change", async () => {
    const t = await started();
    for (const usd of [85_000, 75_000]) { t.advance(HOUR); t.web.pairs[TOKEN] = [pair(TOKEN, usd, "0xpair1")]; await t.wt.tick(); }
    t.advance(HOUR); t.web.pairs[TOKEN] = [pair(TOKEN, 65_000, "0xpair1")];
    await t.wt.tick();
    const latest = t.wt.getWatch(t.watch.id, { owner: WALLET }).reports[0]!;
    expect(latest.changes).toEqual([expect.objectContaining({ id: "liquidity", severity: "medium", beforeBlock: 21_000_000 })]);
  });

  it("retries a failed alert after 1 and 2 minutes, then gives up", async () => {
    const tries: number[] = [];
    const t = await started({ notify: async () => { tries.push(t0()); if (tries.length === 2) throw new Error("telegram down"); return false; } });
    const t0 = () => t.clock.t;
    t.wt.linkTelegram(t.telegramCode, 1);
    t.advance(HOUR); t.chain.set(TOKEN, "owner()", "address", OWNER_B);
    await t.wt.tick();
    const start = tries[0]!;
    for (const step of [30_000, 30_000, 60_000, 60_000, 600_000]) { t.clock.t += step; await t.wt.tick(); }
    expect(tries.map((x) => x - start)).toEqual([0, 60_000, 180_000]);
    const d = t.wt.getWatch(t.watch.id, { owner: WALLET }).deliveries[0]!;
    expect(d).toMatchObject({ status: "failed", attempts: 3, nextAttemptAt: null });
  });

  it("marks a run failed and stale when the node does not answer, alerts nothing, and retries next interval", async () => {
    const sent: ReportT.WatchReport[] = [];
    const t = await started({ notify: async (_w, r) => { sent.push(r); return true; } });
    t.wt.linkTelegram(t.telegramCode, 1);
    t.advance(HOUR); t.chain.down.head = true;
    expect(await t.wt.tick()).toMatchObject({ ran: 0, failed: 1 });
    const g = t.wt.getWatch(t.watch.id, { owner: WALLET });
    expect(g.reports[0]).toMatchObject({ stale: true, changes: [] });
    expect(g.reports[0]!.summary).toMatch(/^Run failed: .*No new data; the last data is from block 21,000,000 .*changes since then are unknown/);
    expect(g.reports[0]!.summary).not.toMatch(/no change|nothing changed|all clear/i);
    expect(g.watch.lastError).toMatch(/did not answer/);
    expect(t.jobs.at(-1)).toMatchObject({ kind: "watch.observe", status: "failed" });
    expect(sent).toHaveLength(0);
    t.chain.down.head = false;
    t.advance(30 * 60_000);
    expect((await t.wt.tick()).ran).toBe(0); // the retry waits for the next interval
    t.advance(30 * 60_000);
    expect((await t.wt.tick()).ran).toBe(1);
  });

  it("expires at the end of the term and never runs again", async () => {
    const t = await started({ days: 1 });
    t.advance(23 * HOUR);
    expect((await t.wt.tick()).ran).toBe(1);
    t.advance(2 * HOUR);
    expect(await t.wt.tick()).toMatchObject({ ran: 0, expired: 1 });
    t.advance(HOUR);
    expect((await t.wt.tick()).ran).toBe(0);
    const v = t.wt.getWatch(t.watch.id, { owner: WALLET }).watch;
    expect(v).toMatchObject({ status: "expired", nextRunAt: null, runs: 2 });
  });

  it("lets only the owner or the manage token read or stop a watch", async () => {
    const t = await started();
    const id = t.watch.id;
    expect(() => t.wt.getWatch(id, { token: "wrong-token" })).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => t.wt.getWatch(id, { owner: OWNER_B })).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => t.wt.getWatch(id, {})).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => t.wt.getWatch("w_0000000000000000", { owner: WALLET })).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => t.wt.stopWatch(id, { token: "wrong-token" })).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => t.wt.stopWatch(id, { owner: OWNER_A })).toThrow(expect.objectContaining({ status: 403 }));
    expect(t.wt.getWatch(id, { owner: WALLET.toUpperCase().replace("0X", "0x") }).watch.id).toBe(id);
    expect(t.wt.stopWatch(id, { token: t.manageToken })).toMatchObject({ status: "stopped" });
    t.advance(2 * HOUR);
    expect((await t.wt.tick()).ran).toBe(0);
  });

  it("validates the term: 1 to 30 days, at least hourly, a payment", async () => {
    const { ctx } = world();
    const wt = new W.Watchtower({ ctx, file: null });
    const base = { address: TOKEN, owner: WALLET, days: 7, payment: { usd: 1, payer: PAYER, tx: null } };
    await expect(wt.startWatch({ ...base, days: 31 })).rejects.toMatchObject({ status: 400 });
    await expect(wt.startWatch({ ...base, days: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(wt.startWatch({ ...base, intervalMinutes: 30 })).rejects.toMatchObject({ status: 400 });
    await expect(wt.startWatch({ ...base, owner: "nobody" })).rejects.toMatchObject({ status: 400 });
    await expect(wt.startWatch({ ...base, payment: { usd: 1, payer: "x", tx: null } })).rejects.toMatchObject({ status: 400 });
  });

  it("continues the schedule and the dedupe state after a restart on the same file", async () => {
    const file = tmpFile();
    const sent: string[][] = [];
    const notify = async (_w: WatchtowerT.Watch, r: ReportT.WatchReport) => { sent.push(r.changes.map((c) => c.id)); return true; };
    const t = await started({ file, notify });
    t.wt.linkTelegram(t.telegramCode, 7);
    t.advance(HOUR); t.chain.set(TOKEN, "owner()", "address", OWNER_B); t.web.dexDown = 503;
    await t.wt.tick();
    expect(sent).toEqual([["owner()", "coverage:liquidity"]]);
    expect(existsSync(file)).toBe(true);

    const again = new W.Watchtower({ ctx: t.ctx, file, notify });
    t.advance(30 * 60_000);
    expect((await again.tick()).ran).toBe(0); // nextRunAt was kept: not due yet
    t.advance(30 * 60_000);
    expect((await again.tick()).ran).toBe(1);
    expect(sent).toHaveLength(1); // liquidity still unavailable: already alerted before the restart
    const g = again.getWatch(t.watch.id, { token: t.manageToken });
    expect(g.watch).toMatchObject({ runs: 3, alerts: { telegramLinked: true } });
    expect(g.reports).toHaveLength(3);
    // and a new change after the restart is still alerted
    t.advance(HOUR); t.chain.set(TOKEN, "owner()", "address", OWNER_A);
    await again.tick();
    expect(sent.at(-1)).toEqual(["owner()"]);
  });

  it("stops alerts on unsubscribe while monitoring continues", async () => {
    const sent: unknown[] = [];
    const t = await started({ notify: async (_w, r) => { sent.push(r); return true; } });
    t.wt.linkTelegram(t.telegramCode, 1);
    expect(t.wt.unsubscribe("nope")).toBeNull();
    expect(t.wt.unsubscribe(t.manageToken)).toMatchObject({ id: t.watch.id });
    t.advance(HOUR); t.chain.set(TOKEN, "owner()", "address", OWNER_B);
    expect((await t.wt.tick()).ran).toBe(1);
    expect(sent).toHaveLength(0);
    expect(t.wt.getWatch(t.watch.id, { owner: WALLET }).reports[0]!.changes[0]!.id).toBe("owner()");
  });
});

describe("free samples, routes and MCP", () => {
  it("gives 3 free samples per anonymous key per UTC day; a failed sample is not counted", async () => {
    const { ctx, chain, clock } = world();
    const jobs: WatchtowerT.JobEvent[] = [];
    const wt = new W.Watchtower({ ctx, file: null, onJob: (e) => jobs.push(e) });
    chain.down.head = true;
    await expect(wt.sample(TOKEN, "a:one")).rejects.toMatchObject({ status: 503 });
    chain.down.head = false;
    expect((await wt.sample(TOKEN, "a:one")).left).toBe(2);
    expect((await wt.sample(TOKEN, "a:one")).left).toBe(1);
    const third = await wt.sample(TOKEN, "a:one");
    expect(third).toMatchObject({ free: true, left: 0, nextFreeAt: "2026-10-26T00:00:00.000Z" });
    await expect(wt.sample(TOKEN, "a:one")).rejects.toMatchObject({ status: 429, extra: { nextFreeAt: "2026-10-26T00:00:00.000Z" } });
    expect((await wt.sample(TOKEN, "a:two")).left).toBe(2);
    clock.t = Date.UTC(2026, 9, 26, 0, 5);
    expect((await wt.sample(TOKEN, "a:one")).left).toBe(2);
    expect(jobs.filter((j) => j.kind === "watch.sample").map((j) => `${j.status}:${j.free}`)).toEqual(["failed:true", "done:true", "done:true", "done:true", "done:true", "done:true"]);
  });

  it("serves info, sample, a watch and unsubscribe over HTTP, keyed by a hash of the IP", async () => {
    const t = world();
    const wt = new W.Watchtower({ ctx: t.ctx, file: null });
    const s = await wt.startWatch({ address: TOKEN, owner: WALLET, days: 7, payment: { usd: 1, payer: PAYER, tx: null } });
    let out: { status: number; body: unknown } = { status: 0, body: null };
    const res = { setHeader() {} } as unknown as ServerResponse;
    const call = (method: string, url: string, headers: Record<string, string> = {}, owner: string | null = null) =>
      R.watchtowerRoutes({ method, url, headers } as unknown as IncomingMessage, res, url.split("?")[0]!, { json: (_r, status, body) => { out = { status, body }; }, body: async () => ({}), limited: () => false, owner, ip: "203.0.113.5", wt });
    expect(await call("GET", "/api/watchtower/info")).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ chainId: 1, scope: expect.stringMatching(/Ethereum mainnet/), unsupported: expect.arrayContaining([expect.objectContaining({ label: "Other chains" })]) });
    await call("GET", "/api/watchtower/sample?address=0x1234");
    expect(out.status).toBe(400);
    await call("GET", `/api/watchtower/sample?address=${TOKEN}`);
    expect(out).toMatchObject({ status: 200, body: { free: true, left: 2, address: TOKEN } });
    expect(W.anonKeyOf("203.0.113.5", t.clock.t)).not.toContain("203.0.113.5");
    await call("GET", `/api/watchtower/watches/${s.watch.id}`);
    expect(out.status).toBe(403);
    await call("GET", `/api/watchtower/watches/${s.watch.id}`, { "x-watch-token": s.manageToken });
    expect(out).toMatchObject({ status: 200, body: { watch: { id: s.watch.id } } });
    await call("GET", `/api/watchtower/watches/${s.watch.id}`, {}, WALLET);
    expect(out.status).toBe(200);
    await call("GET", "/api/watchtower/unsubscribe?token=nope");
    expect(out.status).toBe(404);
    await call("GET", `/api/watchtower/unsubscribe?token=${encodeURIComponent(s.manageToken)}`);
    expect(out.status).toBe(200);
    await call("POST", `/api/watchtower/watches/${s.watch.id}/stop`, { "x-watch-token": s.manageToken });
    expect(out).toMatchObject({ status: 200, body: { watch: { status: "stopped" } } });
    expect(await call("GET", "/api/watchtower/somethingelse")).toBe(false);
  });

  it("registers the two free MCP tools with short factual descriptions", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { ctx } = world();
    const wt = new W.Watchtower({ ctx, file: null });
    const server = new McpServer({ name: "test", version: "1" });
    M.registerWatchtowerTools(server, wt, { anonKey: W.anonKeyOf("198.51.100.4") });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "t", version: "1" });
    await client.connect(b);
    const tools = (await client.listTools()).tools;
    expect(tools.map((x) => x.name).sort()).toEqual([...M.WATCHTOWER_TOOLS].sort());
    for (const x of tools) { expect(x.description!.length).toBeLessThan(500); expect(x.description).not.toMatch(FORBIDDEN); }
    const r = await client.callTool({ name: "watchtower_sample", arguments: { address: TOKEN } });
    expect(JSON.parse((r.content as { text: string }[])[0]!.text)).toMatchObject({ free: true, kind: "token", baseline: null });
    await client.close();
  });
});
