import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Address, type Hex, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, toFunctionSelector, toHex } from "viem";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastDeps } from "./fast-tools.js";
import type { Ctx } from "./context.js";
import type { Payer, Io } from "./routes.js";
import type { Listing, Terms } from "./bazaar-index.js";

const { httpsMock, dnsMock } = vi.hoisted(() => ({ httpsMock: vi.fn(), dnsMock: vi.fn() }));
vi.mock("node:https", async (original) => ({ ...await original<typeof import("node:https")>(), request: httpsMock }));
vi.mock("node:dns/promises", async (original) => ({ ...await original<typeof import("node:dns/promises")>(), lookup: dnsMock }));
let F: typeof import("./fast-tools.js"), I: typeof import("./fast-input.js"), B: typeof import("./bazaar-index.js"), S: typeof import("./seller-check.js"), K: typeof import("./catalog.js"), R: typeof import("./routes.js"), M: typeof import("./mcp.js");
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "fast-services-"));
  [F, I, B, S, K, R, M] = await Promise.all([import("./fast-tools.js"), import("./fast-input.js"), import("./bazaar-index.js"), import("./seller-check.js"), import("./catalog.js"), import("./routes.js"), import("./mcp.js")]);
});
const A = `0x${"11".repeat(20)}` as Address, P = `0x${"22".repeat(20)}` as Address, OTHER = `0x${"33".repeat(20)}` as Address;
const TX = `0x${"44".repeat(32)}` as Hex;
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TRANSFER = keccak256(new TextEncoder().encode("Transfer(address,address,uint256)"));
const word = (v: string) => `0x${v.slice(2).padStart(64, "0")}`;
const initialTime = Date.UTC(2026, 9, 26);
let now: number;
const terms = (): Terms => ({ scheme: "exact", network: "eip155:8453", asset: TOKEN, payTo: P, amount: "5000", maxTimeoutSeconds: 60 });
const listing = (changes: Partial<Listing> = {}): Listing => ({ resource: "https://seller.test/check", host: "seller.test", description: "Check a token", accepts: [terms()], createdAt: "2026-09-01T00:00:00.000Z", firstObserved: "2026-09-01T00:00:00.000Z", lastUpdated: "2026-10-25T00:00:00.000Z", lastPaid: "2026-10-25T00:00:00.000Z", lastCalledAt: null, ...changes });
const challenge = (accepts = [terms()]) => { const body = { x402Version: 2, resource: { url: listing().resource }, accepts }; return { status: 402, body, header: Buffer.from(JSON.stringify(body)).toString("base64") }; };
const makeLog = (changes: Record<string, unknown> = {}) => ({ address: TOKEN, topics: [TRANSFER, word(A), word(P)], data: word(toHex(25_000_000n)), transactionHash: TX, blockNumber: "0x64", logIndex: "0x0", ...changes });

function fixture() {
  const receipt = { status: "0x1", blockNumber: "0x64", from: A, to: TOKEN, gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", l1Fee: "0x0", logs: [makeLog()] };
  const tx = { from: A, to: TOKEN, input: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [P, 25_000_000n] }), value: "0x0", blockNumber: "0x64" };
  const rpc = vi.fn(async (chain: string, method: string, params: unknown[]): Promise<unknown> => {
    if (method === "eth_getTransactionReceipt") return receipt;
    if (method === "eth_getTransactionByHash") return tx;
    if (method === "eth_blockNumber") return "0x69";
    if (method === "eth_getCode") return "0x";
    if (method === "eth_getBalance") return toHex(10n ** 18n);
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "eth_getStorageAt") return word("0x0");
    if (method === "eth_feeHistory") return { baseFeePerGas: Array(6).fill(toHex(1_000_000_000n)), reward: Array(5).fill([toHex(10_000_000n), toHex(20_000_000n), toHex(30_000_000n)]) };
    if (method === "eth_getBlockByNumber") { const n = params[0] === "latest" ? 400000n : BigInt(params[0] as string); return { number: toHex(n), timestamp: toHex(BigInt(Math.floor(now / 1000)) - (400000n - n) * 2n) }; }
    if (method === "eth_getLogs") { const q = params[0] as { fromBlock: string; toBlock: string }; return BigInt(q.fromBlock) <= 399995n && BigInt(q.toBlock) >= 399995n ? [makeLog({ blockNumber: toHex(399995n) })] : []; }
    if (method === "eth_call") {
      const { data } = params[0] as { data: string };
      if (data === toFunctionSelector("decimals()")) return word("0x6");
      if (data === toFunctionSelector("symbol()")) return encodeAbiParameters([{ type: "string" }], ["USDC"]);
      if (data.startsWith(toFunctionSelector("balanceOf(address)"))) return word(toHex(50_000_000n));
      if (data.startsWith(toFunctionSelector("resolver(bytes32)"))) return word(OTHER);
      if (data.startsWith(toFunctionSelector("addr(bytes32)"))) return word(P);
      if (data.startsWith(toFunctionSelector("name(bytes32)"))) return encodeAbiParameters([{ type: "string" }], [chain === "base" ? "alice.base.eth" : "alice.eth"]);
      if (data.startsWith(toFunctionSelector("node(address)"))) return word("0x123");
    }
    throw new Error(`Unexpected fixture RPC ${method}`);
  });
  const net = vi.fn(async (url: string): Promise<unknown> => {
    if (url.includes("api.dexscreener.com")) { const token = url.split("/").at(-1)!; return [{ chainId: url.includes("/base/") ? "base" : "ethereum", dexId: "uniswap", url: "https://dexscreener.com/test", pairAddress: OTHER, baseToken: { address: token, symbol: "TEST", name: "Test" }, quoteToken: { address: A, symbol: "USD", name: "USD" }, priceUsd: token === TOKEN ? "1" : "2500", liquidity: { usd: 50000 }, volume: { h24: 1000 }, priceChange: { h24: -2 }, fdv: 100000, marketCap: 90000, pairCreatedAt: now - 86400_000 }]; }
    if (url.includes("sourcify.dev")) return { compilation: { name: "TestToken" }, abi: erc20Abi, sources: {}, proxyResolution: { isProxy: false }, deployment: { blockNumber: "100", transactionHash: TX } };
    throw new Error(`Unexpected fixture HTTP ${url}`);
  });
  const ctx = { d: { now: () => now, etherscanKey: "", net: { json: net } } } as unknown as Ctx;
  const snapshot = B.buildIndex({ [listing().resource]: listing() }, now);
  const deps: FastDeps = { rpc: rpc as FastDeps["rpc"], snapshot: async () => snapshot, probe: vi.fn(async () => challenge()) };
  return { tool: F.fastTools(ctx, deps), ctx, deps, rpc, net, receipt, tx, snapshot };
}
beforeEach(() => { now = initialTime; vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in offline tests."); })); httpsMock.mockReset(); dnsMock.mockReset(); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("fast tool input boundaries", () => {
  it("parses every catalog example and normalizes addresses and names", () => {
    for (const id of I.FAST_IDS) { const o = K.offer(id); expect(() => I.fastInput(id, new URL(o.example, "https://nightshift.test").searchParams), id).not.toThrow(); }
    expect(I.fastInput("name-resolve", new URLSearchParams({ chain: "ethereum", input: "ALICE.eth" })).input).toBe("alice.eth");
    expect(I.fastInput("payment-verify", new URLSearchParams({ chain: "base", tx: TX, recipient: P }))).toMatchObject({ token: "USDC", minAmount: "0" });
  });
  it.each([
    ["payment-verify", { chain: "base", tx: TX, recipient: P, minAmount: "1e6" }], ["payment-verify", { chain: "base", tx: TX, recipient: P, token: "ETH" }],
    ["token-price", { chain: "sepolia", token: TOKEN }], ["token-price", { chain: "base", token: "0x12" }], ["wallet-check", { chain: "base", address: "0x" }],
    ["tx-explain", { chain: "base", tx: P }], ["gas-now", { arbitrary: "value" }], ["name-resolve", { chain: "base", input: "alice.eth" }],
    ["x402-seller-check", { target: "http://seller.test" }], ["x402-seller-check", { target: "https://user:pass@seller.test" }], ["x402-seller-check", { target: "https://seller.test:8443" }],
  ] as const)("refuses bad %s input", (id, q) => { expect(() => I.fastInput(id, new URLSearchParams(q))).toThrow(); });
  it("refuses duplicate query keys and accepts all seller input forms", () => {
    expect(() => I.fastInput("gas-now", new URLSearchParams("holder=a&holder=b"))).toThrow(/repeated/);
    for (const target of [P, "seller.test", "https://seller.test/check?a=1"]) expect(I.fastInput("x402-seller-check", new URLSearchParams({ target })).target).toBe(target);
  });
});

describe("seller evidence and guarded probe", () => {
  it("finds no issues only when all checks ran; does not turn missing reads into a pass", () => {
    expect(S.sellerVerdict([listing()], challenge(), now)).toMatchObject({ verdict: "no_issues_found", validX402: true, unavailable: [] });
    expect(S.sellerVerdict([listing()], null, now).summary).toMatch(/could not check: live x402/);
    expect(S.sellerVerdict([listing({ createdAt: null })], challenge(), now)).toMatchObject({ verdict: "caution" });
  });
  it("flags live price and recipient changes, mismatched headers and invalid accepts", () => {
    expect(S.sellerVerdict([listing()], challenge([{ ...terms(), amount: "6000" }]), now).reasons).toEqual(expect.arrayContaining([expect.objectContaining({ id: "price-changed", impact: "caution" })]));
    expect(S.sellerVerdict([listing()], challenge([{ ...terms(), payTo: OTHER }]), now).verdict).toBe("avoid");
    expect(S.sellerVerdict([listing()], { ...challenge(), header: Buffer.from("{}").toString("base64") }, now).verdict).toBe("avoid");
    for (const bad of [null, { ...terms(), amount: "-1" }, { ...terms(), asset: 123 }, { ...terms(), asset: S.USDC.ethereum }]) expect(S.sellerVerdict([listing()], challenge([bad as Terms]), now).verdict).toBe("avoid");
  });
  it("marks unsupported payment networks unavailable instead of calling them fraudulent", () => {
    const term = { ...terms(), network: "solana:example", payTo: "SolanaPayee", asset: "SolanaAsset" };
    const result = S.sellerVerdict([listing({ accepts: [term] })], challenge([term]), now);
    expect(result).toMatchObject({ verdict: "caution", validX402: null }); expect(result.unavailable.join(" ")).toMatch(/not supported/);
  });
  it("flags historical changes, new listings and near-duplicate listings", () => {
    const rows = Array.from({ length: 10 }, (_, n) => listing({ resource: `https://seller.test/check/${n}`, description: `Check token ${n}`, createdAt: new Date(now - 60000).toISOString(), previousAccepts: [{ ...terms(), amount: "4000" }] }));
    expect(S.sellerVerdict(rows, challenge(), now).reasons.map((v) => v.id)).toEqual(expect.arrayContaining(["similar-listings", "brand-new", "terms-changed"]));
  });
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "100.64.0.1", "[::1]", "[fc00::1]", "[fe80::1]", "[::ffff:127.0.0.1]"])("refuses %s before opening a connection", async (ip) => {
    await expect(S.probeSeller(`https://${ip}/`)).rejects.toThrow(/Refused/); expect(httpsMock).not.toHaveBeenCalled();
  });
  it("refuses a DNS answer containing a private address", async () => {
    dnsMock.mockResolvedValue([{ address: "1.1.1.1", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    await expect(S.probeSeller("https://seller.test/check")).rejects.toThrow(/Refused/); expect(httpsMock).not.toHaveBeenCalled();
  });
  function response(status: number, text: string, headers: Record<string, string> = {}) {
    dnsMock.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
    httpsMock.mockImplementation((_url: URL, _init: unknown, cb: (r: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & { end(): void };
      req.end = () => { const res = Object.assign(new EventEmitter(), { statusCode: status, headers, destroy(this: EventEmitter, error?: Error) { if (error) this.emit("error", error); } }); cb(res); if (status < 300 || status >= 400) { res.emit("data", Buffer.from(text)); res.emit("end"); } }; return req;
    });
  }
  it("makes one GET, pins DNS and refuses redirects even to a private host", async () => {
    response(302, "", { location: "https://127.0.0.1/admin" });
    expect(await S.probeSeller("https://seller.test/check")).toMatchObject({ status: 302, refused: "Redirect not followed." }); expect(httpsMock).toHaveBeenCalledTimes(1);
    const init = httpsMock.mock.calls[0]![1] as { method: string; lookup(h: string, o: unknown, cb: (...v: unknown[]) => void): void };
    expect(init.method).toBe("GET"); const lookup = vi.fn(); init.lookup("seller.test", {}, lookup); expect(lookup).toHaveBeenCalledWith(null, "1.1.1.1", 4);
  });
  it("enforces the small body cap and reads a valid challenge", async () => {
    response(402, "x".repeat(65537)); await expect(S.probeSeller("https://seller.test/check")).rejects.toThrow(/64 KiB/);
    const ch = challenge(); response(402, JSON.stringify(ch.body), { "payment-required": ch.header! }); expect(await S.probeSeller("https://seller.test/check")).toEqual(ch);
  });
});

describe("bounded Bazaar crawler", () => {
  it("resumes the saved offset, publishes only a complete pass, and waits twelve hours", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "bazaar-crawl-")), "bazaar-index.json");
    let fail = true;
    const net = { json: vi.fn(async (url: string) => { const offset = Number(new URL(url).searchParams.get("offset")); if (offset && fail) throw new Error("upstream failed"); return { items: [listing({ resource: `https://seller.test/${offset}` })], pagination: { offset, limit: 1000, total: 1001 } }; }) };
    const pause = vi.fn(async () => {}), first = new B.BazaarIndex(net as never, file, () => now, pause);
    await expect(first.refresh()).rejects.toThrow(/failed/); expect((await first.snapshot()).updatedAt).toBe(0); expect(pause).toHaveBeenCalledWith(600);
    fail = false; const resumed = new B.BazaarIndex(net as never, file, () => now, pause); await resumed.refresh();
    expect(net.json.mock.calls.map(([url]) => new URL(url).searchParams.get("offset"))).toEqual(["0", "1000", "1000"]);
    const snapshot = await resumed.snapshot(); expect(snapshot.byHost["seller.test"]).toHaveLength(2); expect(snapshot.byPayTo[P]).toHaveLength(2); expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(1);
    await resumed.refresh(); expect(net.json).toHaveBeenCalledTimes(3); now += B.BAZAAR_TTL; await resumed.refresh(); expect(net.json).toHaveBeenCalledTimes(5);
  });
  it("keeps observed dates distinct from creation/payment and retains changed terms", () => {
    const old = B.compactListing({ ...listing(), quality: { lastCalledAt: new Date(now).toISOString() }, lastPaid: undefined, createdAt: undefined }, undefined, now)!;
    expect(old.lastPaid).toBeNull(); expect(old.createdAt).toBeNull(); expect(old.lastCalledAt).not.toBeNull();
    const changed = B.compactListing({ ...old, accepts: [{ ...terms(), amount: "6000" }] }, old, now + 1)!;
    expect(changed.previousAccepts?.[0]?.amount).toBe("5000"); expect(changed.firstObserved).toBe(old.firstObserved);
  });
});

describe("chain tools on offline fixtures", () => {
  it("matches real ERC-20 logs, sums split transfers and refuses wrong token/recipient/minimum or reverts", async () => {
    const f = fixture(), input = I.fastInput("payment-verify", new URLSearchParams({ chain: "base", tx: TX, recipient: P, minAmount: "25" }));
    expect(await f.tool.run("payment-verify", input)).toMatchObject({ status: "success", confirmations: 6, from: A, to: P, token: TOKEN, amount: "25", matchesExpected: true });
    expect(await f.tool.run("payment-verify", { ...input, minAmount: "25.000001" })).toMatchObject({ matchesExpected: false });
    expect(await f.tool.run("payment-verify", { ...input, minAmount: "25.0000001" })).toMatchObject({ matchesExpected: false });
    expect(await f.tool.run("payment-verify", { ...input, recipient: OTHER })).toMatchObject({ matchesExpected: false, amount: "0" });
    expect(await f.tool.run("payment-verify", { ...input, token: OTHER })).toMatchObject({ matchesExpected: false });
    const split = fixture(); split.receipt.logs.push(makeLog({ data: word(toHex(1_000_000n)), logIndex: "0x1" })); expect(await split.tool.run("payment-verify", input)).toMatchObject({ amount: "26", matchesExpected: true });
    const reverted = fixture(); reverted.receipt.status = "0x0"; expect(await reverted.tool.run("payment-verify", input)).toMatchObject({ status: "reverted", matchesExpected: false });
  });
  it("distinguishes pending receipts from upstream failure", async () => {
    const f = fixture(); f.rpc.mockImplementation(async (_c, m) => m === "eth_getTransactionReceipt" ? null : m === "eth_getTransactionByHash" ? f.tx : Promise.reject(new Error("unavailable")));
    const input = { chain: "base" as const, tx: TX, recipient: P, minAmount: "0.01", token: "USDC" };
    expect(await f.tool.run("payment-verify", input)).toMatchObject({ status: "pending", matchesExpected: false });
    const missing = fixture(); missing.rpc.mockRejectedValue(new Error("offline")); expect(await missing.tool.run("payment-verify", input)).toMatchObject({ status: "unavailable", matchesExpected: null });
  });
  it("reads token prices and on-chain metadata, rejects quote-side prices and caches for 30 seconds", async () => {
    const f = fixture(), input = { chain: "base" as const, token: TOKEN };
    expect(await f.tool.run("token-price", input)).toMatchObject({ priceUsd: 1, liquidityUsd: 50000, volume24hUsd: 1000, change24hPct: -2, fdv: 100000, marketCap: 90000, symbol: "USDC", decimals: 6, pairAgeSeconds: 86400 });
    const reads = f.net.mock.calls.length; expect(await f.tool.run("token-price", input)).toMatchObject({ cached: true }); expect(f.net).toHaveBeenCalledTimes(reads);
    now += 30001; await f.tool.run("token-price", input); expect(f.net).toHaveBeenCalledTimes(reads + 1);
    const quote = fixture(); quote.net.mockResolvedValue([{ chainId: "base", baseToken: { address: OTHER }, quoteToken: { address: TOKEN }, priceUsd: "2500" }]); expect(await quote.tool.run("token-price", input)).toMatchObject({ priceUsd: null });
  });
  it("classifies delegated EOAs and keeps unavailable code separate from an EOA", async () => {
    const f = fixture(), original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (c, m, p) => m === "eth_getCode" ? `0xef0100${OTHER.slice(2)}` : original(c, m, p));
    expect(await f.tool.run("wallet-check", { chain: "base", address: A })).toMatchObject({ kind: "EOA", delegation: OTHER, ethBalance: "1", usdcBalance: "50", nonce: 7, labels: ["EIP-7702 delegated EOA"] });
    const missing = fixture(); missing.rpc.mockRejectedValue(new Error("offline")); expect(await missing.tool.run("wallet-check", { chain: "base", address: A })).toMatchObject({ kind: null, ethBalance: null });
  });
  it("explains ERC-20 and NFT transfers, verified method and actual execution plus Base L1 gas", async () => {
    const f = fixture(); f.receipt.logs.push(makeLog({ address: OTHER, topics: [TRANSFER, word(A), word(P), word("0x7")], data: "0x" })); f.receipt.l1Fee = toHex(1000n);
    const result = await f.tool.run("tx-explain", { chain: "base", tx: TX });
    expect(result).toMatchObject({ status: "success", method: "transfer", block: 100, from: A, to: TOKEN, gasPaidEth: "0.000021000000001", gasPaidUsd: 0.0525000000025 });
    expect(result.summary).toMatch(/sent 25 USDC/); expect(result.transfers).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "ERC-721", tokenId: "7" })]));
  });
  it("returns gas estimates for both chains and refreshes fee history after 12 seconds", async () => {
    const f = fixture(); const first = await f.tool.run("gas-now", {}); expect(first.chains).toEqual(expect.arrayContaining([expect.objectContaining({ chain: "ethereum", baseFeeGwei: "1", priorityFeeGwei: { slow: "0.01", normal: "0.02", fast: "0.03" } }), expect.objectContaining({ chain: "base" })]));
    expect(await f.tool.run("gas-now", {})).toMatchObject({ cached: true }); now += 12001; await f.tool.run("gas-now", {}); expect(f.rpc.mock.calls.filter(([, m]) => m === "eth_feeHistory")).toHaveLength(4);
  });
  it("resolves and confirms forward/reverse ENS and Basenames; caches names 60 seconds", async () => {
    const f = fixture();
    for (const chain of ["ethereum", "base"] as const) { const name = chain === "base" ? "alice.base.eth" : "alice.eth"; expect(await f.tool.run("name-resolve", { chain, input: name })).toMatchObject({ name, address: P, direction: "forward", forwardConfirmed: true }); expect(await f.tool.run("name-resolve", { chain, input: P })).toMatchObject({ name, address: P, direction: "reverse", forwardConfirmed: true }); }
    expect(await f.tool.run("name-resolve", { chain: "base", input: "alice.base.eth" })).toMatchObject({ cached: true }); now += 60001; expect(await f.tool.run("name-resolve", { chain: "base", input: "alice.base.eth" })).toMatchObject({ cached: false });
  });
  it("counts a complete seven-day log window and records latency on cache hits", async () => {
    const f = fixture(); const answer = await f.tool.run("x402-seller-check", { target: "seller.test" });
    expect(answer).toMatchObject({ verdict: "no_issues_found", bazaar: { listedResources: 1 }, probe: { validX402: true }, inflows: [expect.objectContaining({ count: 1, sumUsdc: "25", complete: true })] });
    const before = f.rpc.mock.calls.length; for (let n = 0; n < 100; n++) await f.tool.run("x402-seller-check", { target: "seller.test" }); expect(f.rpc).toHaveBeenCalledTimes(before); expect(f.tool.latency("x402-seller-check")).toMatchObject({ samples: 101 });
    console.log("Offline seller cache latency", f.tool.latency("x402-seller-check"));
  });
  it("checks Base USDC inflows even when the seller advertises payment on Ethereum", async () => {
    const f = fixture(), term = { ...terms(), network: "eip155:1", asset: S.USDC.ethereum! };
    f.snapshot.byResource[listing().resource]!.accepts = [term]; f.deps.probe = async () => challenge([term]);
    const result = await f.tool.run("x402-seller-check", { target: "seller.test" });
    expect(result.inflows).toEqual([expect.objectContaining({ payTo: P, network: "eip155:8453", count: 1, sumUsdc: "25" })]);
  });
  it("does not report a complete zero when one inflow log chunk failed", async () => {
    const f = fixture(), original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (c, m, p) => { if (m === "eth_getLogs" && BigInt((p[0] as { fromBlock: string }).fromBlock) < 100000n) throw new Error("missing range"); return original(c, m, p); });
    const answer = await f.tool.run("x402-seller-check", { target: "seller.test" });
    expect(answer.inflows).toEqual([expect.objectContaining({ complete: false, count: null, sumUsdc: null, observedCount: 1 })]); expect(answer.verdict).toBe("caution"); expect(answer.summary).toMatch(/incomplete inflow log window/);
  });
  it("keeps transfer details when the USD price upstream stalls", async () => {
    const f = fixture(), original = f.net.getMockImplementation()!;
    f.net.mockImplementation((url) => url.includes("dexscreener") ? new Promise(() => {}) : original(url));
    const answer = await f.tool.run("tx-explain", { chain: "base", tx: TX });
    expect(answer).toMatchObject({ method: "transfer", gasPaidUsd: null, transfers: [expect.objectContaining({ amount: "25", symbol: "USDC" })] }); expect(answer.unavailable).toContain("ETH USD price");
  });
  it("measures warm cached computation for every new offer", async () => {
    const f = fixture(); const measured = [];
    for (const id of I.FAST_IDS) {
      const input = I.fastInput(id, new URL(K.offer(id).example, "https://nightshift.test").searchParams);
      await f.tool.run(id, input);
      for (let n = 0; n < 100; n++) await f.tool.run(id, input);
      const latency = f.tool.latency(id)!; expect(latency.p95Ms).toBeLessThan(1500); measured.push({ id, ...latency });
    }
    console.log("Offline warm computation p50/p95 (ms)", JSON.stringify(measured));
  });
  it("bounds a stalled upstream and labels all missing sources", async () => {
    const f = fixture(); f.net.mockImplementation(() => new Promise(() => {})); f.rpc.mockImplementation(() => new Promise(() => {}));
    const start = performance.now(); const answer = await f.tool.run("token-price", { chain: "base", token: TOKEN }); expect(performance.now() - start).toBeLessThan(1500); expect(answer).toMatchObject({ priceUsd: null, decimals: null }); expect(answer.unavailable).toEqual(expect.arrayContaining(["DexScreener", "on-chain token metadata"]));
  });
});

describe("new paid routes, discovery and MCP", () => {
  const payer = (): Payer => ({ mode: "live", chainId: 8453, payTo: () => P, check: vi.fn(async () => ({ ok: true as const, payer: A, payment: { payload: { authorization: { value: "2000", nonce: TX } } } as never })), settle: vi.fn(async () => TX), sim: async () => {}, isPending: () => false, holder: async () => true });
  const io = (example: string, limited = () => false): Io => { const url = new URL(example, "https://nightshift.test"); return { method: "GET", path: url.pathname, query: url.searchParams, header: () => undefined, ip: "fixture", base: url.origin, limited }; };
  it("publishes seven separate resources with valid Bazaar schemas and equal 402 body/header", async () => {
    const { validateDiscoveryExtension } = await import("@x402/extensions/bazaar"); const f = fixture(), service = R.services(f.ctx, payer(), { fast: f.deps });
    for (const id of I.FAST_IDS) { const offer = K.offer(id), out = (await service.handle(io(offer.example)))!;
      expect(out.status, id).toBe(402); expect(JSON.parse(Buffer.from(out.headers!["PAYMENT-REQUIRED"]!, "base64").toString("utf8"))).toEqual(out.body);
      expect(offer.description.startsWith("Use when an agent needs")).toBe(true); expect(offer.description.length).toBeLessThan(480); expect(validateDiscoveryExtension(K.bazaarOf(offer).bazaar as never)).toEqual({ valid: true }); expect(K.holderPriceOf(offer)).toBe(offer.priceUsdc / 2n < 1000n ? 1000n : offer.priceUsdc / 2n);
      expect(K.openapi("https://nightshift.test", 8453, P).paths).toHaveProperty(offer.route); expect(K.llmsLines("https://nightshift.test").join("\n")).toContain(id.replaceAll("-", "_"));
      const discounted = io(offer.example); discounted.query.set("holder", A); const half = (await service.handle(discounted))!.body as { accepts: { amount: string }[] }; expect(half.accepts[0]!.amount).toBe(K.holderPriceOf(offer).toString());
    }
  });
  it("validates before payment, rejects HEAD and applies IP/payer limits", async () => {
    const f = fixture(), p = payer(), service = R.services(f.ctx, p, { fast: f.deps });
    // unpaid: the price first, with the input problem as the reason; paid: refused before anything settles
    expect((await service.handle(io("/api/v1/payment-verify?chain=base&tx=bad")))!.status).toBe(402);
    expect((await service.handle({ ...io("/api/v1/payment-verify?chain=base&tx=bad"), header: (n: string) => n === "payment-signature" ? "sig" : undefined }))!.status).toBe(400); expect(p.check).not.toHaveBeenCalled();
    expect((await service.handle({ ...io(K.offer("gas-now").example), method: "HEAD" }))!.status).toBe(405);
    expect((await service.handle(io(K.offer("gas-now").example, () => true)))!.status).toBe(429);
    const limited = io(K.offer("gas-now").example, (key?: string) => !!key?.startsWith("svc-fast-payer")); limited.header = () => "signed"; expect((await service.handle(limited))!.status).toBe(429); expect(p.settle).not.toHaveBeenCalled();
  });
  it("routes MCP tools through the same paid handler, including holder terms", async () => {
    const f = fixture(), service = R.services(f.ctx, payer(), { fast: f.deps }), names: string[] = [], handlers = new Map<string, (a: Record<string, string>) => Promise<{ content: { text: string }[] }>>();
    const server = { registerTool: (name: string, _config: unknown, handler: never) => { names.push(name); handlers.set(name, handler); } };
    M.registerServiceTools(server as never, service, { ip: "fixture", base: "https://nightshift.test", limited: () => false });
    for (const id of I.FAST_IDS) expect(names).toContain(id.replaceAll("-", "_"));
    const answer = await handlers.get("gas_now")!({ holderWallet: A }); expect(JSON.parse(answer.content[0]!.text)).toMatchObject({ paymentRequired: true, challenge: { holderPrice: true, accepts: [{ amount: "1000" }] } });
  });
});
