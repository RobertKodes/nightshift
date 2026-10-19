import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { requirement, signPayment } from "@nightshift/x402";
import type { TxState } from "./chain.js";
import { Checkout, type CheckoutChain, PendingError, type Settlement } from "./checkout.js";

const seller = privateKeyToAccount(generatePrivateKey());
const buyer = privateKeyToAccount(generatePrivateKey());
const req = requirement(8453, seller.address, 5_000_000n);

function setup() {
  const records = new Map<string, Settlement>();
  const used = new Set<string>();
  const states = new Map<string, TxState>();
  const booked: string[] = [];
  let n = 0, signs = 0, saves = 0;
  const onChain = new Map<string, `0x${string}`>();
  const chain: CheckoutChain = {
    used: async (from, nonce) => used.has(`${from}:${nonce}`.toLowerCase()),
    find: async (from, nonce) => onChain.get(`${from}:${nonce}`.toLowerCase()) ?? null,
    sign: async () => { signs++; const hash = `0x${(++n).toString(16).padStart(64, "0")}` as `0x${string}`; return { hash, raw: hash, nonce: n }; },
    broadcast: async () => {},
    state: async (_id, hash) => states.get(hash) ?? "success",
    refused: (e) => /nonce too low/.test(String(e)),
  };
  const co = new Checkout(records, async () => { saves++; }, chain, async (s) => { booked.push(s.hash); }, 0);
  return { co, chain, records, used, states, booked, onChain, signs: () => signs, saves: () => saves };
}

describe("x402 checkout", () => {
  it("books a settled payment once, and a retry with the same header returns it without paying again", async () => {
    const t = setup();
    const p = await signPayment(buyer, req);
    const h1 = await t.co.settle("C", seller.address, "P", p);
    const h2 = await t.co.settle("C", seller.address, "P", p);
    expect(h2).toBe(h1);
    expect(t.signs()).toBe(1);
    expect(t.booked).toEqual([h1]);
  });

  it("saves the settlement before broadcast; one that outlives the request is booked later and delivered on retry", async () => {
    const t = setup();
    t.states.set(`0x${"1".padStart(64, "0")}`, "pending");
    const p = await signPayment(buyer, req);
    await expect(t.co.settle("C", seller.address, "P", p)).rejects.toBeInstanceOf(PendingError);
    const r = t.co.recordOf(buyer.address, p.payload.authorization.nonce);
    expect(r?.hash).toBeDefined();
    expect(t.booked).toEqual([]);
    // it lands while nobody is asking: the background follow-up books it
    t.states.set(r!.hash!, "success");
    await t.co.resolve();
    expect(t.booked).toEqual([r!.hash]);
    // the buyer's retry gets the same sale, nothing settled or booked again
    expect(await t.co.settle("C", seller.address, "P", p)).toBe(r!.hash);
    expect(t.signs()).toBe(1);
    expect(t.booked.length).toBe(1);
  });

  it("finds an authorization already used on chain instead of settling it again", async () => {
    const t = setup();
    const p = await signPayment(buyer, req);
    const key = `${buyer.address}:${p.payload.authorization.nonce}`.toLowerCase();
    t.used.add(key);
    t.onChain.set(key, `0x${"ab".repeat(32)}`);
    expect(await t.co.settle("C", seller.address, "P", p)).toBe(`0x${"ab".repeat(32)}`);
    expect(t.signs()).toBe(0);
    expect(t.booked).toEqual([`0x${"ab".repeat(32)}`]);
  });

  it("refuses a used authorization that did not pay this company", async () => {
    const t = setup();
    const p = await signPayment(buyer, req);
    t.used.add(`${buyer.address}:${p.payload.authorization.nonce}`.toLowerCase());
    await expect(t.co.settle("C", seller.address, "P", p)).rejects.toThrow(/already used/);
    expect(t.booked).toEqual([]);
  });

  it("forgets a settlement that reverted, and does not reuse a payment for another product", async () => {
    const t = setup();
    t.states.set(`0x${"1".padStart(64, "0")}`, "reverted");
    const p = await signPayment(buyer, req);
    await expect(t.co.settle("C", seller.address, "P", p)).rejects.toThrow(/reverted/);
    expect(t.records.size).toBe(0);
    const q = await signPayment(buyer, req);
    await t.co.settle("C", seller.address, "P", q);
    await expect(t.co.settle("C", seller.address, "OTHER", q)).rejects.toThrow(/another product/);
  });

  it("will not ask for a zero or negative price", () => {
    expect(() => requirement(8453, seller.address, 0n)).toThrow(/more than zero/);
    expect(() => requirement(8453, seller.address, -5_000_000n)).toThrow(/more than zero/);
  });
});
