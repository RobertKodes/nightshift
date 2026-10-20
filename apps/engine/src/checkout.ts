import type { PaymentPayload } from "@nightshift/x402";
import type { SignedTx, TxState } from "./chain.js";

/**
 * x402 settlement, idempotent on the buyer's authorization (payer + EIP-3009 nonce). The settling
 * transaction is signed and saved before it is broadcast, and the sale is booked once it lands,
 * whether that is during the request, on a retry with the same header, or in the background after
 * a restart. The chain itself refuses a second use of the nonce, so a retry never charges twice.
 */
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
}

export const saleKey = (from: string, nonce: string) => `${from.toLowerCase()}:${nonce.toLowerCase()}`;
/** Sent, not mined yet: the same request again gets the download once it lands. */
export class PendingError extends Error {
  constructor() { super("Your payment was sent and is waiting for Base. Send the same request again in a minute for the download; you will not be charged twice."); }
}

export class Checkout {
  constructor(
    private readonly records: Map<string, Settlement>,
    private readonly save: () => Promise<void>,
    private readonly chain: CheckoutChain,
    /** Books the sale once (the ledger id is sale:<hash>). */
    private readonly book: (s: Settlement & { hash: `0x${string}` }) => Promise<void>,
    private readonly waitMs = 90_000,
    private readonly now = Date.now,
  ) {}

  /** The settlement on record for this authorization (sent or booked), if any. */
  recordOf(from: string, nonce: string): Settlement | undefined {
    const r = this.records.get(saleKey(from, nonce));
    return r?.hash ? r : undefined;
  }

  /** Never settled by anyone: only then are the payer's balance and the company's gas worth checking. */
  async fresh(from: `0x${string}`, nonce: `0x${string}`): Promise<boolean> {
    return !this.recordOf(from, nonce) && !(await this.chain.used(from, nonce));
  }

  /** Settles (or finds the settlement of) this payment and returns its transaction hash once the sale is booked. */
  async settle(companyId: string, wallet: `0x${string}`, productId: string, p: PaymentPayload, b2b?: Settlement["b2b"]): Promise<`0x${string}`> {
    const a = p.payload.authorization;
    const key = saleKey(a.from, a.nonce);
    let r = this.records.get(key);
    if (r && (r.companyId !== companyId || r.productId !== productId)) throw new Error("This payment was made for another product.");
    if (r?.booked && r.hash) return r.hash;
    if (!r?.hash) {
      r = { key, companyId, productId, payer: a.from, value: BigInt(a.value), at: this.now(), ...(b2b ? { b2b } : {}) };
      if (await this.chain.used(a.from, a.nonce)) {
        // used already (an earlier try whose answer was lost, or anyone who submitted it): find it, never settle again
        const hash = await this.chain.find(a.from, a.nonce, wallet, BigInt(a.value));
        if (!hash) throw new Error("This payment authorization was already used on chain. If USDC left your wallet, contact us with the transaction.");
        r.hash = hash;
        this.records.set(key, r);
        await this.save();
      } else {
        const s = await this.chain.sign(companyId, p);
        Object.assign(r, s);
        this.records.set(key, r);
        await this.save();
        try { await this.chain.broadcast(s.raw); } catch (e) {
          if (this.chain.refused(e)) { this.records.delete(key); await this.save(); throw new Error(`settlement refused: ${(e as Error).message.split("\n")[0]}`); }
        }
      }
    }
    return this.#follow(r, this.waitMs);
  }

  /** Background: settlements whose answer never came are booked when they land, forgotten when they never can. */
  async resolve(): Promise<void> {
    for (const r of [...this.records.values()]) {
      if (r.booked) { if (this.now() - r.at > 30 * 86_400_000) { this.records.delete(r.key); await this.save(); } continue; }
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
      this.records.delete(r.key);
      await this.save();
      throw new Error(`settlement ${st}: ${hash}`);
    }
    if (r.raw && waitMs === 0) await this.chain.broadcast(r.raw).catch(async (e) => { if (this.chain.refused(e)) { this.records.delete(r.key); await this.save(); } });
    throw new PendingError();
  }
}
