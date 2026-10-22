import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type * as SwapModule from "./swap.js";

let S: typeof SwapModule;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "swap-test-"));
  S = await import("./swap.js");
}, 60_000);

/** LI.FI's and Relay's answers recorded on 2026-10-22 (packages/swap/fixtures): no request leaves the test. */
const fx = (n: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "packages", "swap", "fixtures", `${n}.json`), "utf8"));
const ME = "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69", HOLDER = "0x00000000000000000000000000000000000f0f0f", XRP_ME = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const IMD_RH = "0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127", NATIVE = "0x0000000000000000000000000000000000000000";
const ethToImd = { fromChain: "eth", toChain: "rh", fromToken: NATIVE, toToken: IMD_RH, amount: "100000000000000000", from: ME, to: ME, slippage: 0.02 };

type Call = { url: string; init?: RequestInit };
function fake(o: { lifi?: (u: URL) => [number, unknown]; relay?: (body: Record<string, unknown>) => [number, unknown]; settings?: Partial<SwapModule.SwapSettings> } = {}) {
  const calls: Call[] = [];
  const reads: string[] = [];
  const svc = S.swapService({
    fetch: async (url, init) => {
      calls.push({ url, init });
      const u = new URL(url);
      const [status, body] = u.host === "li.quest"
        ? (o.lifi ?? (() => [200, fx("lifi-quote-eth-rh-imd")]))(u)
        : (o.relay ?? (() => [200, fx("relay-quote-eth-rh-imd-fee")]))(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify(body), { status });
    },
    holds: async (w) => { reads.push(w); return w === HOLDER; },
    settings: () => ({ feeBps: 25, feeWallet: ME, lifiIntegrator: "nightshift", lifiKey: "", relayKey: "", ...o.settings }),
    now: () => 1_000,
  });
  const lifiCalls = () => calls.filter((c) => c.url.startsWith("https://li.quest/v1/quote")).map((c) => new URL(c.url).searchParams);
  const relayCalls = () => calls.filter((c) => c.url === "https://api.relay.link/quote").map((c) => JSON.parse(String(c.init?.body)));
  return { svc, calls, reads, lifiCalls, relayCalls };
}

describe("the fee waiver, decided by the server per wallet", () => {
  it("asks every provider with NIGHTSHIFT's fee for a wallet without a NIGHT FROG", async () => {
    const f = fake();
    const r = await f.svc.quote(ethToImd, ME);
    expect(r.status).toBe(200);
    expect(f.lifiCalls()[0]?.get("fee")).toBe("0.0025");
    expect(f.lifiCalls()[0]?.get("integrator")).toBe("nightshift");
    expect(f.relayCalls()[0]?.appFees).toEqual([{ recipient: ME, fee: "25" }]);
    const body = r.body as { quotes: { provider: string; nightshift: { bps: number; waived: boolean } }[]; fee: { waived: boolean } };
    expect(body.fee.waived).toBe(false);
    expect(body.quotes.map((q) => q.nightshift.bps)).toEqual([25, 25]);
  });
  it("asks with no fee at all for a signed-in holder: LI.FI fee=0, no Relay app fee", async () => {
    const f = fake({ relay: () => [200, fx("relay-quote-eth-rh-imd-fee")] });
    const r = await f.svc.quote({ ...ethToImd, from: HOLDER, to: HOLDER }, HOLDER);
    expect(f.lifiCalls()[0]?.get("fee")).toBe("0");
    expect(f.relayCalls()[0]).not.toHaveProperty("appFees");
    const body = r.body as { fee: { waived: boolean; note: string }; quotes: { nightshift: { waived: boolean; note: string } }[] };
    expect(body.fee).toMatchObject({ waived: true, note: "No NIGHTSHIFT fee: you hold a NIGHT FROG, a Night Watcher or 5M+ $SHIFT." });
    expect(body.quotes.every((q) => q.nightshift.waived)).toBe(true);
  });
  it("never waives it for a holder's address typed by someone who is not signed in as it", async () => {
    const f = fake();
    await f.svc.quote({ ...ethToImd, from: HOLDER, to: HOLDER }, null);
    expect(f.lifiCalls()[0]?.get("fee")).toBe("0.0025");
    expect((await f.svc.fee(null, HOLDER))).toMatchObject({ bps: 25, waived: false, reason: "sign-in", holds: true });
    expect((await f.svc.fee(HOLDER, HOLDER))).toMatchObject({ bps: 0, waived: true, reason: "holder" });
  });
  it("reads holdings once per wallet and keeps them 5 minutes", async () => {
    const f = fake();
    await f.svc.fee(HOLDER, null);
    await f.svc.fee(HOLDER, null);
    await f.svc.quote(ethToImd, HOLDER);
    expect(f.reads).toEqual([HOLDER]);
  });
  it("asks LI.FI without the fee when the integration is not registered, and says so", async () => {
    const f = fake({ lifi: (u) => (u.searchParams.get("fee") === "0" ? [200, fx("lifi-quote-eth-rh-imd")] : [400, fx("lifi-error-1011")]) });
    const r = await f.svc.quote(ethToImd, ME);
    expect(f.lifiCalls().map((p) => p.get("fee"))).toEqual(["0.0025", "0"]);
    const q = (r.body as { quotes: { provider: string; nightshift: { bps: number; note: string } }[] }).quotes.find((x) => x.provider === "lifi");
    expect(q?.nightshift.bps).toBe(0);
    expect(q?.nightshift.note).toContain("not collected on LI.FI routes yet");
    // no integration name at all: no fee on LI.FI, none asked
    const g = fake({ settings: { lifiIntegrator: "" } });
    await g.svc.quote(ethToImd, ME);
    expect(g.lifiCalls()[0]?.get("fee")).toBe("0");
    expect((await g.svc.fee(ME, null)).collect).toEqual({ lifi: false, relay: true });
  });
  it("sends the API keys only from the server, in the providers' headers", async () => {
    const f = fake({ settings: { lifiKey: "lk", relayKey: "rk" } });
    await f.svc.quote(ethToImd, ME);
    const h = (c: Call) => new Headers(c.init?.headers as ConstructorParameters<typeof Headers>[0]);
    expect(h(f.calls.find((c) => c.url.includes("li.quest"))!).get("x-lifi-api-key")).toBe("lk");
    expect(h(f.calls.find((c) => c.url.includes("relay.link"))!).get("x-api-key")).toBe("rk");
  });
});

describe("routes", () => {
  it("asks only Relay for XRP, and passes the typed XRPL address as the recipient", async () => {
    const f = fake({ relay: () => [200, fx("relay-quote-base-xrp")] });
    const r = await f.svc.quote({ fromChain: "base", toChain: "xrpl", fromToken: NATIVE, toToken: "xrp", amount: "20000000000000000", from: ME, to: XRP_ME, slippage: 0.02 }, null);
    expect(f.lifiCalls()).toEqual([]);
    expect(f.relayCalls()[0]).toMatchObject({ recipient: XRP_ME, destinationChainId: 537724, destinationCurrency: "xrp" });
    const body = r.body as { quotes: { provider: string; problems: string[]; toAmount: string }[] };
    expect(body.quotes).toHaveLength(1);
    expect(body.quotes[0]).toMatchObject({ provider: "relay", problems: [], toAmount: "36100253" });
  });
  it("refuses to quote out of XRP, with the reason", async () => {
    const f = fake();
    const r = await f.svc.quote({ fromChain: "xrpl", toChain: "base", fromToken: "xrp", toToken: NATIVE, amount: "50000000", from: XRP_ME, to: ME, slippage: 0.01 }, null);
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toContain("coming soon");
    expect(f.calls).toEqual([]);
  });
  it("keeps one provider's route when the other fails, and says why", async () => {
    const f = fake({ lifi: () => [429, { message: "Too many requests" }] });
    const body = (await f.svc.quote(ethToImd, ME)).body as { quotes: { provider: string }[]; errors: { provider: string; error: string }[] };
    expect(body.quotes.map((q) => q.provider)).toEqual(["relay"]);
    expect(body.errors).toEqual([{ provider: "lifi", error: "LI.FI is busy right now (rate limit). Try again in a minute." }]);
  });
  it("reuses a quote asked again within 15 seconds", async () => {
    const f = fake();
    await f.svc.quote(ethToImd, ME);
    await f.svc.quote(ethToImd, ME);
    expect(f.lifiCalls()).toHaveLength(1);
    expect(f.relayCalls()).toHaveLength(1);
  });
});

describe("tokens and status", () => {
  const tokensFake = () => fake({ lifi: (u) => (u.pathname === "/v1/tokens" ? [200, fx("lifi-tokens")] : [404, {}]) });
  it("lists NIGHTSHIFT's tokens first, then the featured verified ones", async () => {
    const f = tokensFake();
    const eth = (await f.svc.tokens("eth", "")).body as { tokens: { symbol: string; address: string }[] };
    expect(eth.tokens.slice(0, 3).map((t) => t.symbol)).toEqual(["ETH", "SHIFT", "IMD"]);
    expect(eth.tokens.map((t) => t.symbol)).toContain("USDC");
    const rh = (await f.svc.tokens("rh", "")).body as { tokens: { symbol: string }[] };
    expect(rh.tokens.slice(0, 2).map((t) => t.symbol)).toEqual(["ETH", "IMD"]);
    expect(rh.tokens.map((t) => t.symbol)).toEqual(expect.arrayContaining(["WETH", "USDG", "TSLA", "NVDA"]));
    expect(((await f.svc.tokens("xrpl", "")).body as { tokens: { symbol: string }[] }).tokens.map((t) => t.symbol)).toEqual(["XRP"]);
    expect(f.calls.filter((c) => c.url.includes("/v1/tokens"))).toHaveLength(1);
  });
  it("finds tokens by symbol or address", async () => {
    const f = tokensFake();
    const usdc = (await f.svc.tokens("base", "usd")).body as { tokens: { symbol: string }[] };
    expect(usdc.tokens[0]?.symbol).toBe("USDC");
    const byAddr = (await f.svc.tokens("rh", IMD_RH.toUpperCase().replace("0X", "0x"))).body as { tokens: { symbol: string }[] };
    expect(byAddr.tokens.map((t) => t.symbol)).toEqual(["IMD"]);
  });
  it("reads LI.FI and Relay transfer status", async () => {
    const f = fake({ lifi: () => [200, fx("lifi-status-done")], relay: () => [200, {}] });
    const l = await f.svc.status(new URLSearchParams({ provider: "lifi", tx: `0x${"ab".repeat(32)}`, from: "eth", to: "eth", tool: "mayan" }));
    expect(l.body).toMatchObject({ state: "done" });
    expect(new URL(f.calls[0]!.url).searchParams.get("bridge")).toBe("mayan");
    const g = S.swapService({ fetch: async () => new Response(JSON.stringify(fx("relay-status-success"))), holds: async () => false, settings: () => S.swapSettings({}, {}), now: () => 0 });
    expect((await g.status(new URLSearchParams({ provider: "relay", id: `0x${"12".repeat(32)}`, from: "sol", to: "rh" }))).body).toMatchObject({ state: "done", outUrl: expect.stringContaining("robin.etherscan.io") });
    expect((await g.status(new URLSearchParams({ provider: "relay", id: "nope", from: "sol", to: "rh" }))).status).toBe(400);
  });
});

describe("settings", () => {
  it("defaults to 0.25% to the treasury, caps at 1%, reads keys from /setup or the environment", () => {
    const d = S.swapSettings({}, {});
    expect(d).toMatchObject({ feeBps: 25, lifiIntegrator: "", lifiKey: "", relayKey: "" });
    expect(d.feeWallet).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(S.swapSettings({ SWAP_FEE_BPS: "500" }, {}).feeBps).toBe(100);
    expect(S.swapSettings({ SWAP_FEE_BPS: "0" }, {}).feeBps).toBe(0);
    expect(S.swapSettings({ SWAP_FEE_WALLET: "nope" }, {}).feeWallet).toBe(d.feeWallet);
    expect(S.swapSettings({ LIFI_INTEGRATOR: "ns" }, { LIFI_INTEGRATOR: "env", LIFI_API_KEY: "k" })).toMatchObject({ lifiIntegrator: "ns", lifiKey: "k" });
  });
});

describe("the HTTP routes", () => {
  const run = async (method: string, path: string, o: { owner?: string | null; body?: () => Promise<Record<string, unknown>> } = {}) => {
    const f = fake();
    const out: { status?: number; body?: unknown } = {};
    const url = new URL(`http://localhost${path}`);
    const ok = await S.swapRoutes({ method } as never, {} as never, url.pathname, {
      json: (_res, status, body) => { out.status = status; out.body = body; },
      body: o.body ?? (async () => ({})),
      limited: () => false,
      owner: o.owner ?? null,
      url,
    }, f.svc);
    return { ok, ...out, f };
  };
  it("waives the fee for the signed-in session's wallet, never for a wallet in the query alone", async () => {
    expect((await run("GET", `/api/swap/fee?wallet=${HOLDER}`, { owner: HOLDER })).body).toMatchObject({ waived: true, xrplSource: expect.stringContaining("coming soon") });
    expect((await run("GET", `/api/swap/fee?wallet=${HOLDER}`)).body).toMatchObject({ waived: false, reason: "sign-in" });
    const q = await run("POST", "/api/swap/quote", { owner: HOLDER, body: async () => ({ ...ethToImd, from: HOLDER, to: HOLDER }) });
    expect(q.status).toBe(200);
    expect(q.f.lifiCalls()[0]?.get("fee")).toBe("0");
  });
  it("answers 400 to a broken body and leaves other paths alone", async () => {
    expect(await run("POST", "/api/swap/quote", { body: async () => { throw new Error("bad json"); } })).toMatchObject({ ok: true, status: 400 });
    expect((await run("GET", "/api/swap/nope")).ok).toBe(false);
  });
});
