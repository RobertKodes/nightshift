import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { FacilitatorUnavailable, type Offer, type PaymentPayload, type SettleAnswer, type VerifyAnswer, facilitatorPayload, requirement, signPayment } from "@nightshift/x402";
import type { TxState } from "./chain.js";
import { Checkout, type CheckoutChain, type FacilitatorSetup, NoGasError, PaymentRefused, PendingError, type Settlement } from "./checkout.js";

const seller = privateKeyToAccount(generatePrivateKey());
const buyer = privateKeyToAccount(generatePrivateKey());
const req = requirement(8453, seller.address, 5_000_000n);

function setup(cdp: FacilitatorSetup | null = null, records = new Map<string, Settlement>(), gas = true) {
  const used = new Set<string>();
  const states = new Map<string, TxState>();
  const booked: string[] = [];
  const via: (string | undefined)[] = [];
  let n = 0, signs = 0, saves = 0;
  const onChain = new Map<string, `0x${string}`>();
  const chain: CheckoutChain = {
    used: async (from, nonce) => used.has(`${from}:${nonce}`.toLowerCase()),
    find: async (from, nonce) => onChain.get(`${from}:${nonce}`.toLowerCase()) ?? null,
    sign: async () => { signs++; const hash = `0x${(++n).toString(16).padStart(64, "0")}` as `0x${string}`; return { hash, raw: hash, nonce: n }; },
    broadcast: async () => {},
    state: async (_id, hash) => states.get(hash) ?? "success",
    refused: (e) => /nonce too low/.test(String(e)),
    gas: async () => gas,
  };
  const co = new Checkout(records, async () => { saves++; }, chain, async (s) => { booked.push(s.hash); via.push(s.via); }, 0, Date.now, cdp);
  return { co, chain, records, used, states, booked, via, onChain, signs: () => signs, saves: () => saves };
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

const offer: Offer = {
  requirement: req,
  resource: { url: "https://getnightshift.tech/buy/acme/p-64efeb32-ff92-4f26-9ab9-101dea01a110", description: "A guide.", mimeType: "application/json", serviceName: "NIGHTSHIFT" },
  extensions: { bazaar: { info: { input: { type: "http", method: "GET" } }, schema: { type: "object" } } },
};
const H = (b: string) => `0x${b.repeat(32)}` as `0x${string}`;
const down = (op: "verify" | "settle", status: number | null = 503, transaction?: `0x${string}`) => new FacilitatorUnavailable(op, status, "test outage", transaction);

/** A facilitator that answers as told, and remembers what it was asked. */
function facilitator(o: { verify?: (p: PaymentPayload) => VerifyAnswer | Error; settle?: (p: PaymentPayload) => SettleAnswer | Error }) {
  const asked: { op: string; p: PaymentPayload; req: unknown }[] = [];
  const fallbacks: string[] = [];
  const answer = <T>(x: T | Error) => (x instanceof Error ? Promise.reject(x) : Promise.resolve(x));
  const setup: FacilitatorSetup = {
    graceMs: 0,
    onFallback: (op) => { fallbacks.push(op); },
    facilitator: {
      verify: (p, r) => { asked.push({ op: "verify", p, req: r }); return answer(o.verify ? o.verify(p) : { isValid: true }); },
      settle: (p, r) => { asked.push({ op: "settle", p, req: r }); return answer(o.settle ? o.settle(p) : { success: true, transaction: H("cd"), network: req.network }); },
    },
  };
  return { setup, asked, fallbacks };
}

describe("x402 checkout through the CDP facilitator", () => {
  it("verifies and settles with the advertised terms; the company signs nothing, and a retry is not settled again", async () => {
    const f = facilitator({});
    const t = setup(f.setup);
    const p = await signPayment(buyer, req);
    expect(await t.co.settle("C", seller.address, "P", p, undefined, offer)).toBe(H("cd"));
    expect(f.asked.map((x) => x.op)).toEqual(["verify", "settle"]);
    for (const x of f.asked) { expect(x.req).toEqual(offer.requirement); expect(x.p).toEqual(facilitatorPayload(p, offer)); }
    expect(t.signs()).toBe(0);
    expect(t.booked).toEqual([H("cd")]);
    expect(t.via).toEqual(["cdp"]);
    expect(await t.co.settle("C", seller.address, "P", p, undefined, offer)).toBe(H("cd"));
    expect(f.asked.length).toBe(2);
    expect(t.booked.length).toBe(1);
  });

  it("a payment the facilitator refuses is refused: nothing settled, nothing kept", async () => {
    const p = await signPayment(buyer, req);
    const a = facilitator({ verify: () => ({ isValid: false, invalidReason: "insufficient_funds" }) });
    const t = setup(a.setup);
    const e = await t.co.settle("C", seller.address, "P", p, undefined, offer).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PaymentRefused);
    expect((e as PaymentRefused).reason).toBe("insufficient_funds");
    expect(a.asked.map((x) => x.op)).toEqual(["verify"]);
    const b = facilitator({ settle: () => ({ success: false, errorReason: "invalid_exact_evm_payload_signature", transaction: "", network: req.network }) });
    const u = setup(b.setup);
    await expect(u.co.settle("C", seller.address, "P", p, undefined, offer)).rejects.toBeInstanceOf(PaymentRefused);
    for (const x of [t, u]) { expect(x.signs()).toBe(0); expect(x.records.size).toBe(0); expect(x.booked).toEqual([]); }
  });

  it("verify down: the company settles itself, once", async () => {
    const f = facilitator({ verify: () => down("verify", null) });
    const t = setup(f.setup);
    const hash = await t.co.settle("C", seller.address, "P", await signPayment(buyer, req), undefined, offer);
    expect(f.asked.map((x) => x.op)).toEqual(["verify"]);
    expect(f.fallbacks).toEqual(["verify"]);
    expect(t.signs()).toBe(1);
    expect(t.booked).toEqual([hash]);
    expect(t.via).toEqual(["self"]);
  });

  it("settle down before it sent anything: the chain shows nothing, so the company settles, once", async () => {
    const f = facilitator({ settle: () => down("settle", 500) });
    const t = setup(f.setup);
    const hash = await t.co.settle("C", seller.address, "P", await signPayment(buyer, req), undefined, offer);
    expect(f.fallbacks).toEqual(["settle"]);
    expect(t.signs()).toBe(1);
    expect(t.booked).toEqual([hash]);
    expect(t.via).toEqual(["self"]);
  });

  it("settle down after it did send: found on chain, never settled a second time", async () => {
    const p = await signPayment(buyer, req);
    const key = `${buyer.address}:${p.payload.authorization.nonce}`.toLowerCase();
    let t!: ReturnType<typeof setup>;
    // its transaction lands, then the answer is lost
    const f = facilitator({ settle: () => { t.used.add(key); t.onChain.set(key, H("ef")); return down("settle", 504); } });
    t = setup(f.setup);
    expect(await t.co.settle("C", seller.address, "P", p, undefined, offer)).toBe(H("ef"));
    expect(t.signs()).toBe(0);
    expect(f.fallbacks).toEqual([]);
    expect(t.booked).toEqual([H("ef")]);
    expect(t.via).toEqual(["cdp"]);
    // the buyer's retry gets the same sale
    expect(await t.co.settle("C", seller.address, "P", p, undefined, offer)).toBe(H("ef"));
    expect(t.booked.length).toBe(1);
  });

  it("a failed answer that names its transaction is followed, not settled again", async () => {
    const f = facilitator({ settle: () => down("settle", 502, H("aa")) });
    const t = setup(f.setup);
    expect(await t.co.settle("C", seller.address, "P", await signPayment(buyer, req), undefined, offer)).toBe(H("aa"));
    expect(t.signs()).toBe(0);
    expect(t.via).toEqual(["cdp"]);
    // and a pending settle answer with a transaction is followed until it lands
    const g = facilitator({ settle: () => ({ success: false, errorReason: "settlement_pending", transaction: H("bb"), network: req.network }) });
    const u = setup(g.setup);
    u.states.set(H("bb"), "pending");
    const q = await signPayment(buyer, req);
    await expect(u.co.settle("C", seller.address, "P", q, undefined, offer)).rejects.toBeInstanceOf(PendingError);
    u.states.set(H("bb"), "success");
    await u.co.resolve();
    expect(u.booked).toEqual([H("bb")]);
    expect(u.signs()).toBe(0);
  });

  it("the company's own fallback reverts because the facilitator's transaction landed first: that one is the sale, booked once", async () => {
    const p = await signPayment(buyer, req);
    const key = `${buyer.address}:${p.payload.authorization.nonce}`.toLowerCase();
    const f = facilitator({ settle: () => down("settle", 503) });
    const t = setup(f.setup);
    // ours is mined after the facilitator's: it reverts, and the facilitator's paid the company
    t.states.set(`0x${"1".padStart(64, "0")}`, "reverted");
    t.chain.broadcast = async () => { t.used.add(key); t.onChain.set(key, H("fa")); };
    expect(await t.co.settle("C", seller.address, "P", p, undefined, offer)).toBe(H("fa"));
    expect(t.signs()).toBe(1);
    expect(t.booked).toEqual([H("fa")]);
    expect(t.via).toEqual(["cdp"]);
  });

  it("an answer lost to a restart after the hand-off is found on chain in the background; an expired one is forgotten", async () => {
    const p = await signPayment(buyer, req);
    const key = `${buyer.address}:${p.payload.authorization.nonce}`.toLowerCase();
    const records = new Map<string, Settlement>([[key, { key, companyId: "C", productId: "P", payer: buyer.address, value: 5_000_000n, at: Date.now(), handedOff: true, payTo: seller.address }]]);
    const t = setup(facilitator({}).setup, records);
    // not on chain yet: kept and waited for, never settled by the company
    await t.co.resolve();
    expect(t.records.size).toBe(1);
    t.used.add(key);
    t.onChain.set(key, H("dd"));
    await t.co.resolve();
    expect(t.booked).toEqual([H("dd")]);
    expect(t.via).toEqual(["cdp"]);
    expect(t.signs()).toBe(0);
    const old = new Map<string, Settlement>([[key, { key, companyId: "C", productId: "P", payer: buyer.address, value: 5_000_000n, at: Date.now() - 3 * 3_600_000, handedOff: true, payTo: seller.address }]]);
    const u = setup(facilitator({}).setup, old);
    await u.co.resolve();
    expect(u.records.size).toBe(0);
    expect(u.booked).toEqual([]);
  });

  it("only the company's own settlement needs its gas", async () => {
    const p = await signPayment(buyer, req);
    const t = setup(facilitator({}).setup, new Map(), false);
    expect(await t.co.settle("C", seller.address, "P", p, undefined, offer)).toBe(H("cd"));
    const u = setup(facilitator({ verify: () => down("verify") }).setup, new Map(), false);
    await expect(u.co.settle("C", seller.address, "P", await signPayment(buyer, req), undefined, offer)).rejects.toBeInstanceOf(NoGasError);
    expect(u.signs()).toBe(0);
    expect(u.records.size).toBe(0);
    // without an offer (or a facilitator) the company settles itself, as before
    const w = setup(facilitator({}).setup);
    await w.co.settle("C", seller.address, "P", await signPayment(buyer, req));
    expect(w.signs()).toBe(1);
  });
});
