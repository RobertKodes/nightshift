import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeHeader, encodeHeader, requirement, signPayment, verifyPayment, type PaymentPayload } from "./seller.js";

const seller = privateKeyToAccount(generatePrivateKey());
const buyer = privateKeyToAccount(generatePrivateKey());
const req = requirement(8453, seller.address, 2_000_000n); // 2 USDC
const now = 1_800_000_000;

describe("x402 exact / EIP-3009", () => {
  it("accepts a correctly signed payment and names the payer", async () => {
    const p = await signPayment(buyer, req, now);
    const r = await verifyPayment(decodeHeader<PaymentPayload>(encodeHeader(p)), req, now);
    expect(r).toEqual({ ok: true, payer: buyer.address, value: 2_000_000n });
  });
  it("refuses a payment to someone else, for less, expired, or forged", async () => {
    const p = await signPayment(buyer, req, now);
    expect(await verifyPayment({ ...p, payload: { ...p.payload, authorization: { ...p.payload.authorization, to: buyer.address } } }, req, now)).toMatchObject({ ok: false, reason: "wrong_recipient" });
    expect(await verifyPayment(p, { ...req, amount: "3000000" }, now)).toMatchObject({ ok: false, reason: "insufficient_amount" });
    expect(await verifyPayment(p, req, now + 10_000)).toMatchObject({ ok: false, reason: "expired" });
    const forged = { ...p, payload: { ...p.payload, authorization: { ...p.payload.authorization, value: "9000000" } } };
    expect(await verifyPayment(forged, req, now)).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
});
