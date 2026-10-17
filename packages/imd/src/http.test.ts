import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { HttpImdPlane, IMD_PAYMENT } from "./http.js";

/** A plane whose challenge asks for `amount` of `asset`: what open() does with it is the test. */
function plane(over: Partial<{ amount: string; asset: string; payTo: string; network: string }> = {}) {
  const pay = { network: IMD_PAYMENT.network, asset: IMD_PAYMENT.asset, payTo: IMD_PAYMENT.payTo, amount: IMD_PAYMENT.maxAmount.toString(), ...over };
  let signed = false;
  const fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/requests/quote")) return new Response(JSON.stringify({ order: { id: "o1" } }), { status: 201 });
    if (u.endsWith("/submit") && !(init?.headers as Record<string, string>)?.["PAYMENT-SIGNATURE"]) {
      return new Response(JSON.stringify({ accepts: [{ scheme: "exact", ...pay, maxTimeoutSeconds: 60, extra: {} }], resource: { url: "r" }, quote: { id: "o1", quoteHash: "00", action: "job.open", expiresAt: 9999999999, payment: pay }, requesterScopeHash: "00", resourceUrl: "r" }), { status: 402 });
    }
    signed = true;
    return new Response("{}", { status: 500 });
  }) as unknown as typeof globalThis.fetch;
  const p = new HttpImdPlane({ account: privateKeyToAccount(`0x${"11".repeat(32)}`), fetch });
  return { p, wasSigned: () => signed };
}

describe("IMD payments are signed only as quoted", () => {
  it("refuses a challenge asking for more than the price", async () => {
    const { p, wasSigned } = plane({ amount: (IMD_PAYMENT.maxAmount * 100n).toString() });
    await expect(p.open("job.open" as never, {})).rejects.toThrow(/refused to pay/);
    expect(wasSigned()).toBe(false);
  });
  it("refuses another asset or recipient", async () => {
    await expect(plane({ asset: "0x0000000000000000000000000000000000000001" }).p.open("job.open" as never, {})).rejects.toThrow(/refused to pay/);
    await expect(plane({ payTo: "0x0000000000000000000000000000000000000002" }).p.open("job.open" as never, {})).rejects.toThrow(/refused to pay/);
    await expect(plane({ network: "eip155:8453" }).p.open("job.open" as never, {})).rejects.toThrow(/refused to pay/);
  });
});
