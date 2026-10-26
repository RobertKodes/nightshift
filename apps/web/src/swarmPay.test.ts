import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_USDC, paidRequest, swarmQuote, swarmTerms, type SwarmQuote } from "./paidServices";

const payTo = "0x2222222222222222222222222222222222222222";
const quote: SwarmQuote = { quoteId: "01234567-0123-4123-8123-012345678901", kind: "research", priceUsd: 4.9, expiresAt: new Date(Date.now() + 600_000).toISOString(), pay: "https://evil.test/ignored", whatYouGet: "report", eta: "varies" };
const index = { offers: [{ id: "swarm-order", priceUsd: 3, priceIsMinimum: true }], network: "eip155:8453", payTo };
const terms = { x402Version: 2, resource: { url: "https://nightshift.test/api/v1/swarm/order" }, accepts: [{ scheme: "exact", network: "eip155:8453", asset: BASE_USDC, amount: "4900000", payTo, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } }] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => vi.stubGlobal("location", new URL("https://nightshift.test/services")));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Swarm exact quote payment", () => {
  it("pays a checked variable price above the catalog minimum and ignores arbitrary pay URLs", async () => {
    const f = vi.fn().mockResolvedValueOnce(response(index)).mockResolvedValueOnce(response(terms, 402)); vi.stubGlobal("fetch", f);
    const t = await swarmTerms(quote, payTo);
    expect(t.requirement.amount).toBe("4900000"); expect(t.url).toBe(`https://nightshift.test/api/v1/swarm/order?quoteId=${quote.quoteId}`);
    expect(f.mock.calls.every(([url]) => !String(url).includes("evil"))).toBe(true);
  });
  it.each(["price", "resource", "recipient", "network"])("refuses a mismatched %s before signing", async (bad) => {
    const t = structuredClone(terms);
    if (bad === "price") t.accepts[0]!.amount = "4900001";
    if (bad === "resource") t.resource.url += "/another";
    if (bad === "recipient") t.accepts[0]!.payTo = "0x1111111111111111111111111111111111111111";
    if (bad === "network") t.accepts[0]!.network = "eip155:1";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(index)).mockResolvedValueOnce(response(t, 402)));
    await expect(swarmTerms(quote, payTo)).rejects.toThrow(/Nothing will be signed/);
  });
  it("rejects an expired quote without a request and encodes all kind inputs for free quotes", async () => {
    const f = vi.fn().mockResolvedValue(response(quote)); vi.stubGlobal("fetch", f);
    await expect(swarmTerms({ ...quote, expiresAt: "2000-01-01T00:00:00Z" }, payTo)).rejects.toThrow("expired"); expect(f).not.toHaveBeenCalled();
    await swarmQuote({ kind: "tests", brief: "Write Foundry invariant tests", repo: "https://github.com/example/contracts", commit: "a".repeat(40) });
    const u = new URL(f.mock.calls[0]![0], location.origin); expect(u.searchParams.get("commit")).toHaveLength(40); expect(u.searchParams.get("kind")).toBe("tests");
  });
  it("preserves a settled failure receipt and private status token when a refund is owed", async () => {
    const body = { orderId: "sd_example", orderToken: "private", refundOwed: true, payment: { tx: `0x${"a".repeat(64)}` } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, 502)));
    expect(await paidRequest({ url: "https://nightshift.test/api/v1/swarm/order?quoteId=q", header: "same" }, () => {})).toEqual({ body, pending: false });
  });
});
