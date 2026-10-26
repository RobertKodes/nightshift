import { type Address, encodeAbiParameters, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_USDC, type ServiceIndex, type ServiceOffer, paidRequest, serviceTerms, serviceUrl, signService, validateTerms, walletError } from "./paidServices";
import type { Eip1193 } from "./wallet";
import { buyWithWallet, signPayment } from "./x402pay";

vi.mock("./wallet", () => ({ chooseWallet: vi.fn() }));
const buyer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const payTo: Address = "0x2222222222222222222222222222222222222222";
const offer: ServiceOffer = { id: "token-verdict-quick", name: "Quick verdict", pitch: "", priceUsd: 0.01, route: "", example: "", description: "" };
const index: ServiceIndex = { offers: [offer], network: "eip155:8453", payTo, mode: "live", mcp: "", openapi: "" };
const requirement = { scheme: "exact", network: "eip155:8453", asset: BASE_USDC as Address, amount: "10000", payTo, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } };
const challenge = { x402Version: 2, accepts: [requirement], holderPrice: false };
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function provider(balance = 10_000n, initialChain = 8453, reject = false) {
  let chain = initialChain;
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [buyer.address];
    if (method === "eth_chainId") return `0x${chain.toString(16)}`;
    if (method === "wallet_switchEthereumChain") { chain = Number((params as { chainId: string }[])[0]!.chainId); return null; }
    if (method === "eth_call") return encodeAbiParameters([{ type: "uint256" }], [balance]);
    if (method === "eth_signTypedData_v4") {
      if (reject) throw Object.assign(new Error("User rejected request"), { code: 4001 });
      const typed = JSON.parse((params as string[])[1]!);
      return buyer.signTypedData(typed);
    }
    throw new Error(`Unexpected wallet call ${method}`);
  });
  return { eth: { request, on() {}, removeListener() {} } as Eip1193, request };
}

beforeEach(() => vi.stubGlobal("location", new URL("https://nightshift.test/services")));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("house payment boundaries", () => {
  it("uses accepts[0] unchanged, including a qualifying holder amount", () => {
    const first = { ...requirement, amount: "5000" };
    expect(validateTerms({ ...challenge, accepts: [first, requirement] }, index, offer)).toBe(first);
  });
  it.each([
    { payTo: buyer.address }, { amount: "10001" }, { amount: 10000 }, { amount: "0" }, { amount: "-1" }, { amount: "1.5" },
    { network: "eip155:84532" }, { asset: payTo }, { scheme: "permit" }, { maxTimeoutSeconds: 301 },
    { extra: { name: "Something else", version: "2" } },
  ])("refuses unsafe terms %j", (changed) => {
    expect(() => validateTerms({ ...challenge, accepts: [{ ...requirement, ...changed }] }, index, offer)).toThrow(/Nothing will be signed/);
  });
  it("checks both the displayed price and the latest listing", () => {
    expect(() => validateTerms(challenge, { ...index, offers: [{ ...offer, priceUsd: 0.005 }] }, offer)).toThrow(/listed price/);
    expect(() => validateTerms(challenge, { ...index, offers: [] }, offer)).toThrow(/listed price/);
    expect(() => validateTerms(challenge, { ...index, payTo: null }, offer)).toThrow(/recipient/);
    expect(() => validateTerms(challenge, { ...index, network: "eip155:84532" }, offer)).toThrow(/Base/);
  });
  it("fetches only its own known route, passes the holder and refuses redirects", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(200, index)).mockResolvedValueOnce(response(402, { ...challenge, holderPrice: true, accepts: [{ ...requirement, amount: "5000" }] }));
    vi.stubGlobal("fetch", fetcher);
    const terms = await serviceTerms({ ...offer, example: "https://evil.test/buy", route: "https://evil.test/buy" }, payTo, buyer.address);
    const url = new URL(terms.url);
    expect(url.origin).toBe(location.origin);
    expect(url.pathname).toBe(`/api/v1/verdict/ethereum/${payTo}`);
    expect(url.searchParams.get("holder")).toBe(buyer.address);
    expect(terms.holderPrice).toBe(true);
    expect(fetcher.mock.calls.every(([, init]) => init.mode === "same-origin" && init.redirect === "error")).toBe(true);
  });
  it("uses the engine's address, question and URL validation", () => {
    expect(() => serviceUrl(offer.id, "0x123")).toThrow(/40 hex/);
    expect(serviceUrl("research-report", "  hello\n  world  ")).toBe("/api/v1/research?q=hello+world");
    expect(() => serviceUrl("research-report", "x".repeat(501))).toThrow(/3 to 500/);
    expect(() => serviceUrl("buildcheck-report", "https://a:b@example.com/")).toThrow(/password/);
    expect(() => serviceUrl("buildcheck-report", "https://example.com:8443/")).toThrow(/standard port/);
    expect(serviceUrl("buildcheck-report", "https://example.com/mcp#fragment")).toBe("/api/v1/buildcheck?url=https%3A%2F%2Fexample.com%2Fmcp");
    expect(() => serviceUrl("imd-feed", "launches?sample=1")).toThrow(/Choose/);
    expect(() => serviceUrl("swarm-order", "quote")).toThrow(/quote/);
  });
});

describe("one USDC authorization", () => {
  it("switches only to Base and reads balanceOf before a real EIP-3009 signature", async () => {
    const { eth, request } = provider(20_000n, 1);
    const signed = await signService(eth, buyer.address, { requirement, holderPrice: false, url: "https://nightshift.test/api/v1/verdict" }, () => {});
    const calls = request.mock.calls.map(([r]) => r);
    expect(calls.find((r) => r.method === "wallet_switchEthereumChain")!.params).toEqual([{ chainId: "0x2105" }]);
    const read = calls.findIndex((r) => r.method === "eth_call");
    const sign = calls.findIndex((r) => r.method === "eth_signTypedData_v4");
    expect(read).toBeLessThan(sign);
    const call = (calls[read]!.params as { to: string; data: string }[])[0]!;
    expect(call.to.toLowerCase()).toBe(BASE_USDC);
    expect(call.data).toBe(`0x70a08231${buyer.address.slice(2).toLowerCase().padStart(64, "0")}`);
    const payment = JSON.parse(atob(signed.header));
    expect(payment.accepted).toEqual(requirement);
    const auth = payment.payload.authorization;
    expect(auth).toMatchObject({ from: buyer.address, to: payTo, value: "10000" });
    expect(auth.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    const typed = JSON.parse((calls[sign]!.params as string[])[1]!);
    expect(typed.primaryType).toBe("TransferWithAuthorization");
    expect(Number(typed.domain.chainId)).toBe(8453);
    expect(typed.domain.verifyingContract.toLowerCase()).toBe(BASE_USDC);
    expect(await recoverTypedDataAddress({ ...typed, signature: payment.payload.signature })).toBe(buyer.address);
    expect(Number(auth.validBefore) - Number(auth.validAfter)).toBe(305);
    const next = await signPayment(eth, buyer.address, requirement);
    expect(next.payload.authorization.nonce).not.toBe(auth.nonce);
    expect(calls.every((r) => !/sendTransaction|approve|permit/.test(r.method))).toBe(true);
  });
  it("does not ask for a signature with insufficient USDC", async () => {
    const { eth, request } = provider(9_999n);
    await expect(signService(eth, buyer.address, { requirement, holderPrice: false, url: "/api/v1/verdict" }, () => {})).rejects.toThrow(/Not enough USDC on Base/);
    expect(request.mock.calls.some(([r]) => r.method === "eth_signTypedData_v4")).toBe(false);
  });
  it("reports user rejection", async () => {
    const { eth } = provider(10_000n, 8453, true);
    try { await signService(eth, buyer.address, { requirement, holderPrice: false, url: "/api/v1/verdict" }, () => {}); throw new Error("expected rejection"); }
    catch (e) { expect(walletError(e)).toBe("You rejected the wallet request. Nothing was charged."); }
  });
  it("leaves PublicPage's Base Sepolia purchase behavior available", async () => {
    const { chooseWallet } = await import("./wallet");
    const { eth } = provider();
    vi.mocked(chooseWallet).mockResolvedValue(eth);
    const req = { ...requirement, network: "eip155:84532", asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e", extra: { name: "USDC", version: "2" } };
    const fetcher = vi.fn().mockResolvedValueOnce(response(402, { accepts: [req] })).mockResolvedValueOnce(response(200, { deliverable: "/download", tx: "0x123" }));
    vi.stubGlobal("fetch", fetcher);
    expect(await buyWithWallet("/buy/example")).toEqual({ deliverable: "/download", tx: "0x123" });
    const payment = JSON.parse(atob(fetcher.mock.calls[1]![1].headers["PAYMENT-SIGNATURE"]));
    expect(payment.accepted).toEqual(req);
  });
});

describe("paid responses", () => {
  const signed = { url: "https://nightshift.test/api/v1/verdict?holder=example", header: "one-signature" };
  it("polls 202 with the exact same URL and PAYMENT-SIGNATURE", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(202, { error: "Waiting for Base" })).mockResolvedValueOnce(response(202, {})).mockResolvedValueOnce(response(200, { summary: "Ready", payment: { tx: "0xabc" } }));
    vi.stubGlobal("fetch", fetcher);
    const out = await paidRequest(signed, () => {}, 0);
    expect(out.pending).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetcher.mock.calls) { expect(url).toBe(signed.url); expect(init.headers).toEqual({ "PAYMENT-SIGNATURE": signed.header }); }
  });
  it("bounds polling and leaves an unsettled payment pending", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response(202, { error: "Still pending" })));
    vi.stubGlobal("fetch", fetcher);
    expect((await paidRequest(signed, () => {}, 0)).pending).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it.each([429, 503])("reports %s with nothing charged", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(status, { error: "Try later" })));
    await expect(paidRequest(signed, () => {}, 0)).rejects.toThrow("Try later Nothing was charged.");
  });
  it("shows the reason for another 402 without signing again", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(402, { error: "insufficient_funds" })));
    await expect(paidRequest(signed, () => {}, 0)).rejects.toThrow("Payment refused: insufficient_funds");
  });
  it("keeps a payment unresolved when its settlement receipt is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {})));
    await expect(paidRequest(signed, () => {}, 0)).rejects.toThrow("settlement receipt");
  });
  it("does not send a signed header to another origin", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(paidRequest({ ...signed, url: "https://evil.test/pay" }, () => {}, 0)).rejects.toThrow(/Only this site/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
