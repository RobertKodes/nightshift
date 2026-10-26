import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_USDC, fastServiceIds, paidInput, serviceUrl } from "./paidServices";

const address = `0x${"11".repeat(20)}`;
const tx = `0x${"22".repeat(32)}`;
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden."); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("wallet inputs for fast paid lookups", () => {
  it("builds every new route from separately labeled fields", () => {
    const values: Record<string, Record<string, string>> = {
      "x402-seller-check": { target: "https://seller.test/check?token=one&depth=quick" },
      "payment-verify": { chain: "base", tx, recipient: address, token: "USDC", minAmount: "0.0025" },
      "token-price": { chain: "ethereum", token: BASE_USDC },
      "wallet-check": { chain: "base", address }, "tx-explain": { chain: "ethereum", tx }, "gas-now": {},
      "name-resolve": { chain: "base", input: "alice.base.eth" },
    };
    expect(fastServiceIds).toHaveLength(7);
    for (const id of fastServiceIds) {
      expect(paidInput[id]!.fields).toBeDefined();
      const result = new URL(serviceUrl(id, new URLSearchParams(values[id]).toString()), "https://nightshift.test");
      expect(result.pathname).toBe(`/api/v1/${id}`); expect(Object.fromEntries(result.searchParams)).toEqual(values[id]);
    }
    expect(serviceUrl("gas-now", "")).toBe("/api/v1/gas-now");
  });
  it("refuses invalid input before asking for wallet terms", () => {
    const cases: [string, Record<string, string>][] = [
      ["payment-verify", { chain: "base", tx, recipient: address, minAmount: "-1" }],
      ["payment-verify", { chain: "base", tx, recipient: address, token: "ETH" }],
      ["payment-verify", { chain: "base", tx, recipient: "0x12" }],
      ["tx-explain", { chain: "base", tx: address }], ["token-price", { chain: "base-sepolia", token: BASE_USDC }],
      ["wallet-check", { chain: "base", address: "0x" }], ["name-resolve", { chain: "base", input: "alice.eth" }],
      ["gas-now", { sim: "1" }], ["x402-seller-check", { target: "http://seller.test" }],
      ["x402-seller-check", { target: "https://user:secret@seller.test" }], ["x402-seller-check", { target: "seller.test/path" }],
    ];
    for (const [id, q] of cases) expect(() => serviceUrl(id, new URLSearchParams(q).toString()), id).toThrow();
    expect(() => serviceUrl("gas-now", "target=a&target=b")).toThrow();
  });
  it("supports optional payment expectations and reverse names on both chains", () => {
    expect(serviceUrl("payment-verify", new URLSearchParams({ chain: "base", tx, recipient: address }).toString())).toContain("/api/v1/payment-verify?");
    for (const chain of ["ethereum", "base"]) expect(serviceUrl("name-resolve", new URLSearchParams({ chain, input: address }).toString())).toContain(`chain=${chain}`);
  });
});
