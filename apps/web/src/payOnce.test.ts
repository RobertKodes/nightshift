import { readFileSync } from "node:fs";
import { type Address, encodeAbiParameters, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECTIONS } from "./site/sitemap";
import { acceptChallenge, formatUsdc, listedPayments, txFromSettlement, usdcUnits, type PayTarget, type ServiceCatalog, type X402Document } from "./payOnce";
import { loadPayTargets, payAll, payOne, resetPayState } from "./payOnceClient";
import type { Eip1193 } from "./wallet";

const buyer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const payTo = "0x2222222222222222222222222222222222222222";
const origin = "https://nightshift.test";
const target = (over: Partial<PayTarget> = {}): PayTarget => ({
  id: "gas-now", name: "Gas Now", price: "0.002", amount: "2000", path: "/api/v1/gas-now", payTo, ...over,
});
const requirement = {
  scheme: "exact" as const, network: "eip155:8453", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Address,
  amount: "2000", payTo: payTo as Address, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" },
};
const challenge = (path = "/api/v1/gas-now", amount = "2000") => ({
  x402Version: 2, resource: { url: `${origin}${path}` }, accepts: [{ ...requirement, amount }],
});

const catalog = (): ServiceCatalog => ({
  network: "eip155:8453", payTo,
  offers: [
    { id: "imd-feed", name: "IMD", priceUsd: 0.001, example: `${origin}/api/v1/imd/launches?chain=ethereum&limit=20`, route: `${origin}/api/v1/imd/{launches|launches/{id}|tokens|swarm|agents/{seat}}` },
    { id: "gas-now", name: "Gas", priceUsd: 0.002, example: `${origin}/api/v1/gas-now`, route: `${origin}/api/v1/gas-now` },
    { id: "token-price", name: "Price", priceUsd: 0.002, example: `${origin}/api/v1/token-price?chain=base&token=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`, route: `${origin}/api/v1/token-price` },
    { id: "name-resolve", name: "Name", priceUsd: 0.002, example: `${origin}/api/v1/name-resolve?chain=ethereum&input=vitalik.eth`, route: `${origin}/api/v1/name-resolve` },
    { id: "payment-verify", name: "Payment", priceUsd: 0.002, example: `${origin}/api/v1/payment-verify?chain=base&tx=0x${"1".repeat(64)}&recipient=${payTo}`, route: `${origin}/api/v1/payment-verify` },
    { id: "wallet-check", name: "Wallet", priceUsd: 0.003, example: `${origin}/api/v1/wallet-check?chain=base&address=${payTo}`, route: `${origin}/api/v1/wallet-check` },
    { id: "tx-explain", name: "Tx", priceUsd: 0.003, example: `${origin}/api/v1/tx-explain?chain=base&tx=0x${"1".repeat(64)}`, route: `${origin}/api/v1/tx-explain` },
    { id: "x402-seller-check", name: "Seller", priceUsd: 0.005, example: `${origin}/api/v1/x402-seller-check?target=getnightshift.tech`, route: `${origin}/api/v1/x402-seller-check` },
    { id: "watchtower-check", name: "Watch", priceUsd: 0.01, example: `${origin}/api/v1/watchtower/check/ethereum/${payTo}`, route: `${origin}/api/v1/watchtower/check/{chain}/{address}` },
  ],
});
const docOf = (index: ServiceCatalog): X402Document => ({
  chainId: 8453,
  resources: index.offers.map((o) => o.example),
  endpoints: index.offers.map((o) => ({ path: decodeURIComponent(new URL(o.route).pathname), method: "GET", price: String(o.priceUsd) })),
});

const response = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

function provider(balance = 20_000n, initialChain = 8453, reject = false) {
  let chain = initialChain;
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [buyer.address];
    if (method === "eth_chainId") return `0x${chain.toString(16)}`;
    if (method === "wallet_switchEthereumChain") { chain = Number((params as { chainId: string }[])[0]!.chainId); return null; }
    if (method === "wallet_addEthereumChain") return null;
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

beforeEach(() => { vi.stubGlobal("location", new URL(`${origin}/pay-x7k2`)); resetPayState(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("advertised terms", () => {
  it("reads both advertisements and keeps the server's price text", () => {
    const index = catalog();
    const targets = listedPayments(index, docOf(index), origin);
    expect(targets.map((t) => t.id)).toEqual(["imd-feed", "gas-now", "token-price", "name-resolve", "payment-verify", "wallet-check", "tx-explain", "x402-seller-check", "watchtower-check"]);
    expect(targets[0]).toMatchObject({ path: "/api/v1/imd/launches?chain=ethereum&limit=20", price: "0.001", amount: "1000" });
    expect(targets[1]).toMatchObject({ path: "/api/v1/gas-now", amount: "2000" });
    expect(formatUsdc(targets.reduce((sum, t) => sum + BigInt(t.amount), 0n))).toBe("0.03");
  });
  it("refuses a price the two documents do not share", () => {
    const index = catalog();
    const doc = docOf(index);
    doc.endpoints![1]!.price = "0.01";
    expect(() => listedPayments(index, doc, origin)).toThrow(/disagree/);
  });
  it("refuses an example that is not the named call", () => {
    const index = catalog();
    index.offers[0]!.example = `${origin}/api/v1/imd/tokens`;
    expect(() => listedPayments(index, docOf(index), origin)).toThrow(/expected path/);
  });
  it("accepts only the advertised 402", () => {
    expect(acceptChallenge(challenge(), target(), origin).amount).toBe("2000");
    expect(() => acceptChallenge(challenge("/api/v1/gas-now", "1000"), target(), origin)).toThrow(/advertised price/);
    expect(() => acceptChallenge(challenge("/api/v1/token-price"), target(), origin)).toThrow(/different URL/);
    expect(() => acceptChallenge({ ...challenge(), x402Version: 1 }, target(), origin)).toThrow(/Nothing will be signed/);
  });
  it("reads a settlement hash from the body or the payment response", () => {
    const tx = `0x${"ab".repeat(32)}`;
    expect(txFromSettlement({ payment: { tx } }, null)).toBe(tx);
    expect(txFromSettlement({}, { transaction: tx })).toBe(tx);
    expect(txFromSettlement({ payment: { tx: "nope" } }, { transaction: "0x123" })).toBeNull();
    expect(usdcUnits("0.001")).toBe(1000n);
    expect(usdcUnits("1e-3")).toBeNull();
  });
  it("is absent from the site map and the service worker does not store it as the shell", () => {
    expect(JSON.stringify(SECTIONS)).not.toContain("/pay-x7k2");
    const html = readFileSync(new URL("../pay-x7k2/index.html", import.meta.url), "utf8");
    expect(html).toContain('content="noindex, nofollow"');
    expect(html).toContain('src="/src/payOncePage.ts"');
    expect(html).not.toContain("<a ");
    const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
    expect(sw).toContain('u.pathname !== "/pay-x7k2"');
  });
});

describe("one signed payment", () => {
  it("signs EIP-3009 for the 402 amount and retries that header", async () => {
    const tx = `0x${"cd".repeat(32)}`;
    const { eth, request } = provider(20_000n, 1);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(402, challenge()))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response(200, { summary: "Gas", payment: { tx } }));
    vi.stubGlobal("fetch", fetcher);
    const paid = await payOne(eth, buyer.address, target(), () => {}, 0);
    expect(paid.tx).toBe(tx);
    const calls = request.mock.calls.map(([r]) => r);
    expect(calls.find((r) => r.method === "wallet_switchEthereumChain")!.params).toEqual([{ chainId: "0x2105" }]);
    const read = calls.findIndex((r) => r.method === "eth_call");
    const sign = calls.findIndex((r) => r.method === "eth_signTypedData_v4");
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(sign);
    const header = fetcher.mock.calls[2]![1].headers["PAYMENT-SIGNATURE"] as string;
    expect(fetcher.mock.calls[1]![1].headers["PAYMENT-SIGNATURE"]).toBe(header);
    expect(fetcher.mock.calls.every(([url, init]) => new URL(url).origin === origin && init.mode === "same-origin" && init.redirect === "error")).toBe(true);
    const payment = JSON.parse(atob(header));
    expect(payment.x402Version).toBe(2);
    expect(payment.accepted.amount).toBe("2000");
    const typed = JSON.parse((calls[sign]!.params as string[])[1]!);
    expect(await recoverTypedDataAddress({ ...typed, signature: payment.payload.signature })).toBe(buyer.address);
    expect(calls.every((r) => !/sendTransaction|private|approve/.test(r.method))).toBe(true);
  });
  it("does not sign again when the first send fails", async () => {
    const { eth, request } = provider();
    let fail = true;
    const fetcher = vi.fn(async () => {
      if (fail) throw new Error("offline");
      return response(200, { payment: { tx: `0x${"11".repeat(32)}` } });
    });
    vi.stubGlobal("fetch", fetcher);
    fetcher.mockResolvedValueOnce(response(402, challenge()));
    await expect(payOne(eth, buyer.address, target(), () => {}, 0)).rejects.toThrow(/same signature/);
    fail = false;
    await payOne(eth, buyer.address, target(), () => {}, 0);
    expect(request.mock.calls.filter(([r]) => r.method === "eth_signTypedData_v4")).toHaveLength(1);
  });
  it("does not sign when the balance is short, and pay-all stops there", async () => {
    const { eth, request } = provider(1n);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(402, challenge())));
    const rows = await payAll(eth, buyer.address, [target(), target({ id: "token-price", path: "/api/v1/token-price?chain=base&token=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" })], () => {}, () => {}, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ok).toBe(false);
    expect(request.mock.calls.some(([r]) => r.method === "eth_signTypedData_v4")).toBe(false);
  });
  it("loads targets only from this origin", async () => {
    const index = catalog();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, index))
      .mockResolvedValueOnce(response(200, docOf(index)));
    vi.stubGlobal("fetch", fetcher);
    const found = await loadPayTargets(origin);
    expect(found).toHaveLength(9);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`${origin}/api/v1/services`, `${origin}/.well-known/x402.json`]);
  });
});
