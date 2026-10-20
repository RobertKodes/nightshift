import { FacilitatorUnavailable, type Offer, type PaymentPayload, type SettleAnswer, type VerifyAnswer, facilitatorPayload, isTxHash } from "@nightshift/x402";
import type { SignedTx, TxState } from "./chain.js";

/**
 * x402 settlement, idempotent on the buyer's authorization (payer + EIP-3009 nonce). With the CDP
 * facilitator on, it verifies and settles the payment (Coinbase pays the gas, and the settled payment
 * lists the product in the CDP Bazaar); otherwise, or when the facilitator is down and the payment is
 * provably not settled, the company settles it itself. Its settling transaction is signed and saved
 * before it is broadcast. The sale is booked once it lands, whether that is during the request, on a
 * retry with the same header, or in the background after a restart. The chain itself refuses a
 * second use of the nonce, so a retry never charges twice.
 */
export type SettledBy = "cdp" | "self" | "other";

export interface Settlement {
  key: string;
  companyId: string;
  productId: string;
  payer: string;
  value: bigint;
  at: number;
  hash?: `0x${string}`;
  raw?: `0x${string}`;
  nonce?: number;
  booked?: boolean;
  /**
   * Who sent the settling transaction: the CDP facilitator, the company's own wallet, or someone else
   * (found on chain for a payment never handed to the facilitator).
   */
  via?: SettledBy;
  /** Handed to the facilitator's /settle: until the chain says otherwise it may have settled it. */
  handedOff?: boolean;
  /** The company wallet the payment goes to: where a transaction someone else sent is looked for. */
  payTo?: `0x${string}`;
  /** Paid by another NIGHTSHIFT company for one of its shifts: booked as B2B, never as a sale to a person. */
  b2b?: { buyerId: string; taskId: string };
}

export interface CheckoutChain {
  /** USDC authorizationState(from, nonce): true once used, by anyone. */
  used(from: `0x${string}`, nonce: `0x${string}`): Promise<boolean>;
  /** The transaction that used this authorization and moved `value` from `from` to `to`, if there is one. */
  find(from: `0x${string}`, nonce: `0x${string}`, to: `0x${string}`, value: bigint): Promise<`0x${string}` | null>;
  sign(companyId: string, p: PaymentPayload): Promise<SignedTx>;
  broadcast(raw: `0x${string}`): Promise<void>;
  state(companyId: string, hash: `0x${string}`, nonce: number | undefined, waitMs: number): Promise<TxState>;
  refused(e: unknown): boolean;
  /** Whether the company wallet can pay the gas of settling a payment itself. */
  gas?(companyId: string): Promise<boolean>;
}

/** The facilitator as the checkout uses it (CdpFacilitator; a fake in tests). */
export interface CheckoutFacilitator {
  verify(p: PaymentPayload, req: Offer["requirement"]): Promise<VerifyAnswer>;
  settle(p: PaymentPayload, req: Offer["requirement"]): Promise<SettleAnswer>;
}

export interface FacilitatorSetup {
  facilitator: CheckoutFacilitator;
  /** After the facilitator failed to answer a settle: how long the chain is watched for its transaction before the company settles. */
  graceMs?: number;
  /** The facilitator did not answer and the company settled (or tried to) instead. */
  onFallback?: (op: "verify" | "settle", e: FacilitatorUnavailable) => void;
  /** The facilitator's word on the bazaar extension (success, processing, rejected) for a settled payment. */
  onBazaar?: (status: string, reason: string | undefined, productId: string) => void;
}

export const saleKey = (from: string, nonce: string) => `${from.toLowerCase()}:${nonce.toLowerCase()}`;
/** Sent, not mined yet: the same request again gets the download once it lands. */
export class PendingError extends Error {
  constructor() { super("Your payment was sent and is waiting for Base. Send the same request again in a minute for the download; you will not be charged twice."); }
}
/** The facilitator turned the payment down (bad signature, not enough USDC, expired…): nothing moved. */
export class PaymentRefused extends Error {
  constructor(readonly reason: string, detail?: string) { super(`The payment was refused (${reason}${detail ? `: ${detail}` : ""}). Nothing was charged.`); }
}
/** The company would settle the payment itself and has no gas for it: nothing was sent. */
export class NoGasError extends Error {
  constructor() { super("This company cannot take payments right now. Nothing was charged; try again later."); }
}

/** An authorization is valid for an hour at most (MAX_VALID_SECONDS): past this, an unsettled one never can be. */
const AUTH_LIFETIME_MS = 2 * 3_600_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Checkout {
  constructor(
    private readonly records: Map<string, Settlement>,
    private readonly save: () => Promise<void>,
    private readonly chain: CheckoutChain,
    /** Books the sale once (the ledger id is sale:<hash>). */
    private readonly book: (s: Settlement & { hash: `0x${string}` }) => Promise<void>,
    private readonly waitMs = 90_000,
    private readonly now = Date.now,
    /** The CDP facilitator, when it settles; null: the company always settles itself. */
    private readonly cdp: FacilitatorSetup | null = null,
  ) {}

  /** Whether payments go through the facilitator first. */
  get viaFacilitator(): boolean { return this.cdp !== null; }

  /** The settlement on record for this authorization (sent or booked), if any. */
  recordOf(from: string, nonce: string): Settlement | undefined {
    const r = this.records.get(saleKey(from, nonce));
    return r?.hash ? r : undefined;
  }

  /** Never settled by anyone: only then are the payer's balance and the company's gas worth checking. */
  async fresh(from: `0x${string}`, nonce: `0x${string}`): Promise<boolean> {
    return !this.recordOf(from, nonce) && !(await this.chain.used(from, nonce));
  }

  /**
   * Settles (or finds the settlement of) this payment and returns its transaction hash once the sale is
   * booked. `offer` is what the 402 challenge advertised: the facilitator verifies and settles against
   * exactly those terms; without it the company settles itself.
   */
  async settle(companyId: string, wallet: `0x${string}`, productId: string, p: PaymentPayload, b2b?: Settlement["b2b"], offer?: Offer): Promise<`0x${string}`> {
    const a = p.payload.authorization;
    const key = saleKey(a.from, a.nonce);
    let r = this.records.get(key);
    if (r && (r.companyId !== companyId || r.productId !== productId)) throw new Error("This payment was made for another product.");
    if (r?.booked && r.hash) return r.hash;
    if (!r?.hash) {
      r ??= { key, companyId, productId, payer: a.from, value: BigInt(a.value), at: this.now(), payTo: wallet, ...(b2b ? { b2b } : {}) };
      if (await this.chain.used(a.from, a.nonce)) {
        // used already (an earlier try whose answer was lost, or anyone who submitted it): find it, never settle again
        const hash = await this.chain.find(a.from, a.nonce, wallet, BigInt(a.value));
        if (!hash) throw new Error("This payment authorization was already used on chain. If USDC left your wallet, contact us with the transaction.");
        Object.assign(r, { hash, via: r.handedOff ? "cdp" : "other" });
        this.records.set(key, r);
        await this.save();
      } else if (!(this.cdp && offer && (await this.#viaFacilitator(r, wallet, p, offer)))) {
        await this.#settleSelf(r, p);
      }
    }
    return this.#follow(r, this.waitMs);
  }

  /**
   * The facilitator's turn. True: it settled (r.hash is its transaction, or the chain's). False: it did
   * not answer, and the payment is provably not settled, so the company may settle it. A refusal throws.
   */
  async #viaFacilitator(r: Settlement, wallet: `0x${string}`, p: PaymentPayload, offer: Offer): Promise<boolean> {
    const { facilitator, graceMs = 6_000, onFallback, onBazaar } = this.cdp!;
    const a = p.payload.authorization;
    const sent = facilitatorPayload(p, offer);
    try {
      const v = await facilitator.verify(sent, offer.requirement);
      if (!v.isValid) throw new PaymentRefused(v.invalidReason ?? "invalid_payment", v.invalidMessage);
    } catch (e) {
      // verify moves nothing: with no answer the company settles, checked by its own verification already
      if (e instanceof FacilitatorUnavailable) { onFallback?.("verify", e); return false; }
      throw e;
    }
    // on record before the facilitator acts: a crash or a lost answer is looked up on chain, never settled twice
    Object.assign(r, { handedOff: true, payTo: wallet });
    this.records.set(r.key, r);
    await this.save();
    let s: SettleAnswer;
    try {
      s = await facilitator.settle(sent, offer.requirement);
    } catch (e) {
      if (!(e instanceof FacilitatorUnavailable)) { this.records.delete(r.key); await this.save(); throw e; }
      // its answer named a transaction: follow that one
      if (e.transaction) { Object.assign(r, { hash: e.transaction, via: "cdp" }); await this.save(); return true; }
      // it may have sent one before failing: watch the chain a few blocks before settling ourselves
      for (let waited = 0; ; waited += 2_000) {
        if (await this.chain.used(a.from, a.nonce)) {
          const hash = await this.chain.find(a.from, a.nonce, wallet, BigInt(a.value));
          if (!hash) { this.records.delete(r.key); await this.save(); throw new Error("This payment authorization was already used on chain. If USDC left your wallet, contact us with the transaction."); }
          Object.assign(r, { hash, via: "cdp" });
          await this.save();
          return true;
        }
        if (waited >= graceMs) break;
        await sleep(Math.min(2_000, graceMs - waited));
      }
      onFallback?.("settle", e);
      return false;
    }
    const bz = s.extensionResponses?.bazaar;
    if (bz?.status) onBazaar?.(bz.status, bz.rejectedReason, r.productId);
    // settled, or sent and still pending: either way there is a transaction to follow
    if (isTxHash(s.transaction) && (s.success || /pending/i.test(s.errorReason ?? ""))) {
      Object.assign(r, { hash: s.transaction, via: "cdp" });
      await this.save();
      return true;
    }
    this.records.delete(r.key);
    await this.save();
    throw new PaymentRefused(s.errorReason ?? "settle_failed", s.errorMessage);
  }

  /** The company's own settlement: signed and saved, then broadcast. */
  async #settleSelf(r: Settlement, p: PaymentPayload): Promise<void> {
    // a record handed to the facilitator stays: its transaction may still land
    if (this.chain.gas && !(await this.chain.gas(r.companyId))) { if (!r.handedOff) this.records.delete(r.key); throw new NoGasError(); }
    const s = await this.chain.sign(r.companyId, p);
    Object.assign(r, s, { via: "self" });
    this.records.set(r.key, r);
    await this.save();
    try { await this.chain.broadcast(s.raw); } catch (e) {
      if (this.chain.refused(e)) { this.records.delete(r.key); await this.save(); throw new Error(`settlement refused: ${(e as Error).message.split("\n")[0]}`); }
    }
  }

  /** Background: settlements whose answer never came are booked when they land, forgotten when they never can. */
  async resolve(): Promise<void> {
    for (const r of [...this.records.values()]) {
      if (r.booked) { if (this.now() - r.at > 30 * 86_400_000) { this.records.delete(r.key); await this.save(); } continue; }
      if (r.handedOff && r.payTo && (!r.hash || r.via === "cdp")) {
        // handed to the facilitator, and its answer lost (a restart) or its transaction never seen: the chain decides
        const [from, nonce] = r.key.split(":") as [`0x${string}`, `0x${string}`];
        try {
          if (!r.hash && (await this.chain.used(from, nonce))) {
            const hash = await this.chain.find(from, nonce, r.payTo, r.value);
            if (hash) { Object.assign(r, { hash, via: "cdp" }); await this.save(); } else { this.records.delete(r.key); await this.save(); continue; }
          } else if (this.now() - r.at > AUTH_LIFETIME_MS && !(await this.chain.used(from, nonce))) {
            // expired unused: nobody can settle it any more
            this.records.delete(r.key); await this.save(); continue;
          }
        } catch { continue; }
      }
      if (!r.hash) continue;
      try { await this.#follow(r, 0); } catch { /* still waiting, or forgotten */ }
    }
  }

  async #follow(r: Settlement, waitMs: number): Promise<`0x${string}`> {
    const hash = r.hash!;
    const st = await this.chain.state(r.companyId, hash, r.nonce, waitMs);
    if (st === "success") {
      await this.book({ ...r, hash });
      r.booked = true;
      delete r.raw;
      await this.save();
      return hash;
    }
    if (st === "reverted" || st === "dropped") {
      // another transaction may have used the authorization first (the facilitator's, landing after it
      // was thought down): if one paid this company, that is the sale
      const [from, nonce] = r.key.split(":") as [`0x${string}`, `0x${string}`];
      const other = r.via === "self" && r.payTo && (await this.chain.used(from, nonce).catch(() => false))
        ? await this.chain.find(from, nonce, r.payTo, r.value).catch(() => null) : null;
      if (other && other.toLowerCase() !== hash.toLowerCase()) {
        Object.assign(r, { hash: other, via: r.handedOff ? "cdp" : "other" });
        delete r.raw; delete r.nonce;
        await this.save();
        return this.#follow(r, waitMs);
      }
      this.records.delete(r.key);
      await this.save();
      throw new Error(`settlement ${st}: ${hash}`);
    }
    if (r.raw && waitMs === 0) await this.chain.broadcast(r.raw).catch(async (e) => { if (this.chain.refused(e)) { this.records.delete(r.key); await this.save(); } });
    throw new PendingError();
  }
}
