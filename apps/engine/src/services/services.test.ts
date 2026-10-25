import { validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type * as Cache from "./cache.js";
import type * as Catalog from "./catalog.js";
import type * as Context from "./context.js";
import type * as Hook from "./hook.js";
import type * as Mcp from "./mcp.js";
import type * as Net from "./net.js";
import type * as Routes from "./routes.js";
import type * as Source from "./source.js";
import type * as Verdict from "./verdict.js";
import type * as X402 from "@nightshift/x402";

/**
 * The house services on recorded mainnet data (scripts/record-service-fixtures.ts, 2026-10-20):
 * every HTTP answer and RPC result is replayed from the tapes, so nothing here touches a network.
 */
let C: typeof Cache, K: typeof Catalog, X: typeof Context, H: typeof Hook, M: typeof Mcp, N: typeof Net, R: typeof Routes, S: typeof Source, V: typeof Verdict, P: typeof X402;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "services-test-"));
  [C, K, X, H, M, N, R, S, V, P] = await Promise.all([import("./cache.js"), import("./catalog.js"), import("./context.js"), import("./hook.js"), import("./mcp.js"), import("./net.js"), import("./routes.js"), import("./source.js"), import("./verdict.js"), import("@nightshift/x402")]);
});

const SHIFT = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";
const COPYCAT = "0x6d6e7616c60bde669200522908426af1847ce60c";
const UNVERIFIED = "0x1e0381f367a82da1b6136606f894f17ed05d8c5e";
const HOOK = "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc";
const GUARD = "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000";

const tape = (name: string): Net.Tape => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.tape.json.gz`, import.meta.url))).toString("utf8"));
/** A context on a tape, with a counter of the reads it made. */
function ctxOn(name: string) {
  const t = tape(name);
  const { net, rpc } = N.replay(t);
  const calls = { n: 0 };
  const counted: Net.Rpc = { head: () => { calls.n++; return rpc.head(); }, code: (a) => { calls.n++; return rpc.code(a); }, storage: (a, s) => { calls.n++; return rpc.storage(a, s); }, call: (x) => { calls.n++; return rpc.call(x); }, logs: (q) => { calls.n++; return rpc.logs(q); } };
  const now = Date.parse(t.recordedAt);
  return { ctx: X.context({ net, rpc: counted, now: () => now, etherscanKey: "", watchtowerUrl: "" }), calls, now };
}
const evidenceOk = (r: { reasons: { evidence: string[] }[]; evidence: { id: string }[] }) => r.reasons.every((x) => x.evidence.every((id) => r.evidence.some((e) => e.id === id)));

describe("token verdict on recorded mainnet data", () => {
  it("$SHIFT (IMD #2124, NightshiftHook): safe, with the hook's 5% sell fee measured and every reason cited", async () => {
    const { ctx } = ctxOn("shift");
    const r = await V.tokenVerdict(ctx, "ethereum", SHIFT, "quick");
    expect(r.verdict).toBe("no_issues_found");
    expect(r.confidence.level).toBe("high");
    expect(r.imd).toMatchObject({ isLaunch: true, launchNumber: 2124, kind: "univ4_hook", role: "token" });
    expect(r.source.verified).toBe(true);
    expect(r.powers.plainErc20).toBe(true);
    expect(r.pool?.key.hooks).toBe(HOOK);
    expect(r.pool?.lpHeldBy).toBe("IMD LaunchFactory");
    expect(r.hook).toMatchObject({ flags: "0x20cc", template: "NightshiftHook" });
    expect(r.simulation.simulated).toBe(true);
    if (r.simulation.simulated) {
      expect(r.simulation.router.ok).toBe(true);
      expect(r.simulation.buy.taxPct!).toBeLessThan(0.5);
      // 2.5% of the SHIFT in and 2.5% of the ETH out, per the hook's source
      expect(r.simulation.sell.taxPct!).toBeGreaterThan(4.5);
      expect(r.simulation.sell.taxPct!).toBeLessThan(5.5);
    }
    expect(r.reasons.find((x) => x.id === "sell-tax")?.impact).toBe("note");
    expect(r.copycat.signal).toBe("note");
    expect(r.copycat.sameSymbol.map((x) => x.launchNumber)).toEqual(expect.arrayContaining([2106, 2129]));
    expect("error" in r.holders).toBe(false);
    if (!("error" in r.holders)) { expect(r.holders.complete).toBe(true); expect(r.holders.count).toBeGreaterThan(100); }
    expect(evidenceOk(r)).toBe(true);
    expect(r.runBy).toBe("NIGHTSHIFT");
  });

  it("deep adds IMD's admission checks, the full hook inspection and a written explanation", async () => {
    const { ctx } = ctxOn("shift");
    const r = await V.tokenVerdict(ctx, "ethereum", SHIFT, "deep");
    expect(r.verdict).toBe("no_issues_found");
    expect(r.reasons.find((x) => x.id === "imd-admission")?.impact).toBe("good");
    expect(r.hook?.inspection?.fees.hookFee).toMatch(/takes its own fee/);
    expect(r.hook?.inspection?.powers.some((p) => /capped by MAX_FEE_BPS = 250/.test(p.text))).toBe(true);
    expect(r.explanation).toMatch(/no issues found in the checks that ran, with high confidence/);
    expect(evidenceOk(r)).toBe(true);
  });

  it("a later launch reusing the symbol is flagged as a likely copycat", async () => {
    const { ctx } = ctxOn("copycat");
    const r = await V.tokenVerdict(ctx, "ethereum", COPYCAT, "quick");
    expect(r.imd).toMatchObject({ isLaunch: true, launchNumber: 2129 });
    expect(r.copycat.signal).toBe("likely");
    expect(r.copycat.text).toMatch(/#2124 has more liquidity/);
    expect(r.reasons.find((x) => x.id === "copycat")?.impact).toBe("caution");
    expect(r.verdict).not.toBe("no_issues_found");
  });

  it("an unverified token is read from its bytecode, marked caution and lower confidence", async () => {
    const { ctx } = ctxOn("unverified");
    const r = await V.tokenVerdict(ctx, "ethereum", UNVERIFIED, "quick");
    expect(r.source.verified).toBe(false);
    expect(r.reasons.find((x) => x.id === "unverified")?.impact).toBe("caution");
    expect(r.confidence.level).not.toBe("high");
    expect(r.confidence.unknowns.join(" ")).toMatch(/verified source/);
    expect(r.verdict).not.toBe("no_issues_found");
  });

  it("refuses other chains and things that are not tokens", async () => {
    const { ctx } = ctxOn("shift");
    await expect(V.tokenVerdict(ctx, "base", SHIFT, "quick")).rejects.toMatchObject({ status: 400 });
    await expect(V.tokenVerdict(ctx, "ethereum", "0x1234", "quick")).rejects.toMatchObject({ status: 400 });
  });
});

describe("hook inspector", () => {
  it("decodes the permission bits from the address", () => {
    const set = (a: string) => H.decodeFlags(a).permissions.filter((p) => p.set).map((p) => p.name);
    expect(H.decodeFlags(HOOK).hex).toBe("0x20cc");
    expect(set(HOOK)).toEqual(["beforeInitialize", "beforeSwap", "afterSwap", "beforeSwapReturnsDelta", "afterSwapReturnsDelta"]);
    expect(set(GUARD)).toEqual(["beforeInitialize"]);
    expect(set("0x0000000000000000000000000000000000003fff")).toHaveLength(14);
    // a return-delta bit without its callback bit: the PoolManager refuses such a hook
    const bad = H.decodeFlags("0x0000000000000000000000000000000000000008");
    expect(bad.valid).toBe(false);
    expect(bad.problems[0]).toMatch(/beforeSwapReturnsDelta is set without beforeSwap/);
    expect(H.decodeFlags("0x00000000000000000000000000000000000000c8").valid).toBe(true);
  });

  it("reads the NightshiftHook from its verified source: fees, capped admin functions, only its own contract", async () => {
    const { ctx } = ctxOn("shift");
    const r = await H.inspectHook(ctx, HOOK, true);
    expect(r.template).toMatchObject({ name: "NightshiftHook", match: "exact address" });
    expect(r.callbacks.filter((c) => c.calledByPoolManager).every((c) => c.inCode && c.implemented)).toBe(true);
    expect(r.fees.hookFee).toMatch(/takes its own fee/);
    expect(r.fees.recipients.map((x) => x.name)).toContain("feeSplitter");
    const setFees = r.adminFunctions.find((f) => f.name === "setFees");
    expect(setFees).toMatchObject({ gate: "owner", power: "fees", capped: "MAX_FEE_BPS = 250" });
    // the bundle compiles FeeSplitter and ShiftRewards too: their functions are not the hook's
    expect(r.adminFunctions.some((f) => f.name === "burnReserve" || f.name === "postRoot")).toBe(false);
    expect(r.owner.kind).toBe("wallet"); // an EIP-7702 delegated EOA
    expect(r.upgradeable.proxy).toBe(false);
    expect(r.pools[0]?.fee).toMatchObject({ type: "static", poolFeeBps: 125 });
    expect(r.explanation?.excerpts.map((e) => e.name)).toEqual(expect.arrayContaining(["beforeSwap", "setFees"]));
    expect(r.risk).not.toBe("high");
  });
});

describe("verified source", () => {
  it("parses Etherscan v2's standard-input source and keeps only the project's files", async () => {
    const row = { SourceCode: `{${JSON.stringify({ language: "Solidity", sources: { "src/Tok.sol": { content: "contract Tok is ERC20 { function mint(address to, uint256 a) external onlyOwner { _mint(to, a); } }" }, "lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol": { content: "contract ERC20 {}" } } })}}`, ABI: "[]", ContractName: "Tok", CompilerVersion: "v0.8.26", Proxy: "0", Implementation: "" };
    const net = { json: async (u: string) => (u.includes("getsourcecode") ? { status: "1", result: [row] } : { status: "1", result: [{ contractCreator: "0x1111111111111111111111111111111111111111", txHash: "0xab", blockNumber: "123" }] }) } as unknown as Net.Net;
    const s = await S.verifiedSource({ net, rpc: {} as Net.Rpc, now: Date.now, etherscanKey: "k", watchtowerUrl: "" }, 1, "0x2222222222222222222222222222222222222222");
    expect(s.verified).toBe(true);
    if (s.verified) {
      expect(s.via).toBe("etherscan");
      expect(Object.keys(s.files)).toEqual(["src/Tok.sol"]);
      expect(s.libraryFiles).toBe(1);
      expect(s.deployBlock).toBe(123);
      const fns = S.functionsOf(s.files);
      expect(fns[0]).toMatchObject({ name: "mint", gate: "owner", power: "mint" });
    }
  });
});

/** A payer like the house company's, without a chain: signatures checked for real, settlement faked. */
function fakePayer(o: { settled: string[] }) {
  const payTo = privateKeyToAccount(generatePrivateKey()).address;
  const payer: Routes.Payer = {
    mode: "live", chainId: 8453, payTo: () => payTo,
    async check(offer, header) {
      const p = P.decodeHeader<X402.PaymentPayload>(header);
      const v = await P.verifyPayment(p, P.requirement(8453, payTo, offer.priceUsdc));
      return v.ok ? { ok: true, payment: p, payer: v.payer } : { ok: false, status: 402, reason: v.reason, challenge: true };
    },
    async settle(offer) { o.settled.push(offer.id); return "0x00000000000000000000000000000000000000000000000000000000000000aa"; },
    async sim() {}, isPending: () => false,
  };
  return { payer, payTo };
}
const io = (path: string, q: Record<string, string> = {}, headers: Record<string, string> = {}, limited = () => false): Routes.Io => ({ method: "GET", path, query: new URLSearchParams(q), header: (n) => headers[n], ip: "203.0.113.7", base: "https://getnightshift.tech", limited });

describe("x402 on the services", () => {
  it("answers an unpaid call with a v2 402 challenge carrying the price, the house wallet and the bazaar metadata", async () => {
    const { ctx } = ctxOn("shift");
    const { payer, payTo } = fakePayer({ settled: [] });
    const s = R.services(ctx, payer);
    const out = (await s.handle(io(`/api/v1/verdict/ethereum/${SHIFT}`, { depth: "quick" })))!;
    expect(out.status).toBe(402);
    type Bz = { info: { input: unknown }; schema: { properties: { output: { properties: { example: { required: string[] } } } } } };
    const b = out.body as X402.Challenge & { extensions: { bazaar: Bz } };
    expect(b.x402Version).toBe(2);
    expect(b.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:8453", amount: "10000", payTo, asset: P.USDC[8453]!.address });
    expect(b.resource.url).toBe(`https://getnightshift.tech/api/v1/verdict/ethereum/${SHIFT}?depth=quick`);
    expect(b.resource.description.length).toBeLessThan(500);
    expect(b.extensions.bazaar.info.input).toMatchObject({ type: "http", method: "GET" });
    expect(b.extensions.bazaar.schema.properties.output.properties.example.required).toEqual(expect.arrayContaining(["verdict", "reasons", "evidence"]));
    expect(P.decodeHeader(out.headers!["PAYMENT-REQUIRED"]!)).toEqual(JSON.parse(JSON.stringify(b)));
    const deep = (await s.handle(io(`/api/v1/verdict/ethereum/${SHIFT}`, { depth: "deep" })))!;
    expect((deep.body as X402.Challenge).accepts[0]!.amount).toBe("250000");
    const hook = (await s.handle(io(`/api/v1/hook/${HOOK}`, { explain: "1" })))!;
    expect((hook.body as X402.Challenge).accepts[0]!.amount).toBe("500000");
    const feed = (await s.handle(io("/api/v1/imd/launches")))!;
    expect((feed.body as X402.Challenge).accepts[0]!.amount).toBe("1000");
  });

  it("quotes half price to a wallet that holds, and full price to anyone else", async () => {
    const { ctx } = ctxOn("shift");
    const holderWallet = privateKeyToAccount(generatePrivateKey()).address;
    const { payer } = fakePayer({ settled: [] });
    const s = R.services(ctx, { ...payer, holder: async (w) => w.toLowerCase() === holderWallet.toLowerCase() });
    type Ch = X402.Challenge & { priceUsd: number; holderPrice: boolean; holderPriceUsd: number; holders: string };
    const full = (await s.handle(io(`/api/v1/verdict/ethereum/${SHIFT}`)))!.body as Ch;
    expect(full.accepts[0]!.amount).toBe("10000");
    expect(full).toMatchObject({ priceUsd: 0.01, holderPrice: false, holderPriceUsd: 0.005 });
    expect(full.holders).toMatch(/500,000\+ \$SHIFT/);
    const half = (await s.handle(io(`/api/v1/verdict/ethereum/${SHIFT}`, { holder: holderWallet })))!.body as Ch;
    expect(half.accepts[0]!.amount).toBe("5000");
    expect(half).toMatchObject({ priceUsd: 0.005, holderPrice: true });
    const other = (await s.handle(io(`/api/v1/verdict/ethereum/${SHIFT}`, { holder: privateKeyToAccount(generatePrivateKey()).address })))!.body as Ch;
    expect(other.accepts[0]!.amount).toBe("10000");
    const header = (await s.handle(io(`/api/v1/hook/${HOOK}`, {}, { "x-holder-wallet": holderWallet })))!.body as Ch;
    expect(header.accepts[0]!.amount).toBe("25000");
  });

  it("checks a signed payment, computes the answer, then settles, and never settles a failed answer", async () => {
    const { ctx } = ctxOn("shift");
    const settled: string[] = [];
    const { payer, payTo } = fakePayer({ settled });
    const s = R.services(ctx, payer);
    const buyer = privateKeyToAccount(generatePrivateKey());
    const pay = async (amount: bigint) => P.encodeHeader(await P.signPayment(buyer, P.requirement(8453, payTo, amount)));
    const short = (await s.handle(io(`/api/v1/verdict/ethereum/${SHIFT}`, {}, { "payment-signature": await pay(5_000n) })))!;
    expect(short.status).toBe(402);
    expect((short.body as X402.Challenge).error).toBe("insufficient_amount");
    const ok = (await s.handle(io(`/api/v1/verdict/ethereum/${SHIFT}`, {}, { "payment-signature": await pay(10_000n) })))!;
    expect(ok.status).toBe(200);
    expect((ok.body as { verdict: string; payment: { tx: string } }).verdict).toBe("no_issues_found");
    expect((ok.body as { payment: { tx: string } }).payment.tx).toMatch(/^0x0+aa$/);
    expect(P.decodeHeader<{ success: boolean }>(ok.headers!["PAYMENT-RESPONSE"]!).success).toBe(true);
    expect(settled).toEqual(["token-verdict-quick"]);
    // a token the tape has never seen: the read fails, the answer is 503 and the payment is not settled
    const quiet = console.error;
    console.error = () => {}; // the handler logs the failed read
    const fail = (await s.handle(io("/api/v1/verdict/ethereum/0x9999999999999999999999999999999999999999", {}, { "payment-signature": await pay(10_000n) })).finally(() => { console.error = quiet; }))!;
    expect(fail.status).toBe(503);
    expect(settled).toHaveLength(1);
  });
});

describe("caching and rate limits", () => {
  it("keeps answers for their TTL and shares one computation between callers asking at once", async () => {
    let now = 0, made = 0;
    const c = new C.TtlCache<number>(1_000, 10, () => now);
    const make = () => new Promise<number>((r) => setTimeout(() => r(++made), 5));
    const [a, b] = await Promise.all([c.get("k", make), c.get("k", make)]);
    expect([a.v, b.v, made]).toEqual([1, 1, 1]);
    expect((await c.get("k", make)).hit).toBe(true);
    now = 1_500;
    expect((await c.get("k", make)).v).toBe(2);
  });

  it("serves a repeated verdict from the cache, with no new chain reads", async () => {
    const { ctx, calls } = ctxOn("shift");
    const s = R.services(ctx, fakePayer({ settled: [] }).payer);
    const first = await s.verdict("ethereum", SHIFT, "quick") as { cached: boolean };
    const reads = calls.n;
    const again = await s.verdict("ethereum", SHIFT, "quick") as { cached: boolean; verdict: string };
    expect(first.cached).toBe(false);
    expect(again.cached).toBe(true);
    expect(again.verdict).toBe("no_issues_found");
    expect(calls.n).toBe(reads);
  });

  it("gives one free quick verdict per IP per day, then the payment terms", async () => {
    const { ctx } = ctxOn("shift");
    const s = R.services(ctx, fakePayer({ settled: [] }).payer);
    const first = (await s.handle(io(`/api/v1/verdict/ethereum/${SHIFT}`, { demo: "1" })))!;
    expect(first.status).toBe(200);
    expect((first.body as { demo: { free: boolean; left: number } }).demo).toMatchObject({ free: true, left: 0 });
    const second = (await s.handle(io(`/api/v1/verdict/ethereum/${SHIFT}`, { demo: "1" })))!;
    expect(second.status).toBe(429);
    expect((second.body as { payment: X402.Challenge }).payment.accepts[0]!.amount).toBe("10000");
    expect(second.headers!["PAYMENT-REQUIRED"]).toBeTruthy();
    const otherIp = (await s.handle({ ...io(`/api/v1/verdict/ethereum/${SHIFT}`, { demo: "1" }), ip: "198.51.100.1" }))!;
    expect(otherIp.status).toBe(200);
    const q = new C.DailyQuota(1, () => Date.UTC(2026, 9, 20, 23, 59));
    expect(q.take("a")).toBe(true);
    expect(q.take("a")).toBe(false);
    expect(new Date(q.resetsAt()).toISOString()).toBe("2026-10-21T00:00:00.000Z");
  });

  it("answers 429 when the per-IP limit says so, and 503 when the service is busy", async () => {
    const { ctx } = ctxOn("shift");
    const s = R.services(ctx, fakePayer({ settled: [] }).payer);
    const limited = (await s.handle(io(`/api/v1/hook/${HOOK}/flags`, {}, {}, () => true)))!;
    expect(limited.status).toBe(429);
    const g = new C.Gate(1);
    let release!: () => void;
    const running = g.run(() => new Promise<void>((r) => { release = r; }));
    await expect(g.run(async () => 1)).rejects.toMatchObject({ status: 503 });
    release(); await running;
    expect(await g.run(async () => 2)).toBe(2);
  });
});

describe("MCP and discovery", () => {
  it("lists the free and paid service tools, and a paid tool without payment returns the x402 terms", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { ctx } = ctxOn("shift");
    const s = R.services(ctx, fakePayer({ settled: [] }).payer);
    const server = new McpServer({ name: "test", version: "1" });
    M.registerServiceTools(server, s, { ip: "203.0.113.9", base: "https://getnightshift.tech", limited: () => false });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "t", version: "1" });
    await client.connect(b);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining([...M.SERVICE_TOOLS, ...M.CREW_TOOLS]));
    const paid = await client.callTool({ name: "token_verdict", arguments: { token: SHIFT } });
    expect(paid.isError).toBe(true);
    const terms = JSON.parse((paid.content as { text: string }[])[0]!.text);
    expect(terms.paymentRequired).toBe(true);
    expect(terms.challenge.accepts[0].amount).toBe("10000");
    const flags = await client.callTool({ name: "hook_flags", arguments: { address: HOOK } });
    expect(JSON.parse((flags.content as { text: string }[])[0]!.text).flags.hex).toBe("0x20cc");
    await client.close();
  });

  it("publishes catalogue entries, OpenAPI paths and descriptions under 500 characters", () => {
    for (const o of K.OFFERS) expect(o.description.length, o.id).toBeLessThan(500);
    const items = K.catalogItems("https://getnightshift.tech", 8453, "0x1111111111111111111111111111111111111111");
    expect(items).toHaveLength(K.OFFERS.length);
    expect(items[0]).toMatchObject({ type: "http", x402Version: 2, accepts: [{ amount: "10000", network: "eip155:8453" }] });
    expect((items[0]!.metadata.bazaar as { info: { output: { example: unknown } } }).info.output.example).toMatchObject({ verdict: "no_issues_found" });
    // every service's block passes x402's own validation, the check the CDP facilitator runs before listing
    for (const o of K.OFFERS) expect(validateDiscoveryExtension(K.bazaarOf(o).bazaar as never), o.id).toEqual({ valid: true });
    const api = K.openapi("https://getnightshift.tech", 8453, null) as { openapi: string; paths: Record<string, unknown> };
    expect(api.openapi).toBe("3.1.0");
    expect(Object.keys(api.paths)).toEqual(expect.arrayContaining(["/api/v1/verdict/{chain}/{token}", "/api/v1/hook/{address}", "/api/v1/imd/launches", "/api/v1/imd/swarm", "/api/v1/imd/agents/{seat}"]));
  });
});
