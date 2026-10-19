import { randomUUID } from "node:crypto";
import type { Ledger, Posting } from "@nightshift/ledger";
import type { SignedTx, TxState } from "./chain.js";

/**
 * Withdrawals, one leg at a time. The owner's share leaves first; the platform fee on that money
 * is then owed in the books (co:<id>:fee-due:<dev|treasury>), still in the company wallet but no
 * longer withdrawable, and paid by its own legs, retried until they land. So a failed transfer
 * never charges the fee twice. Every leg is saved before it is broadcast and booked once it lands.
 */
export type FeePart = "dev" | "treasury";
export interface Leg {
  hash: `0x${string}`;
  raw: `0x${string}`;
  nonce: number;
  companyId: string;
  kind: "owner" | FeePart;
  to: `0x${string}`;
  amount: bigint;
  at: number;
  /** Owner leg: what leaves co:<id>:usdc, and the fee it leaves owed. */
  total?: bigint;
  fees?: Record<FeePart, bigint>;
}

/** The chain side, so the money logic can be tested without one. null in sim mode: only the books move. */
export interface PayoutChain {
  sign(companyId: string, to: `0x${string}`, amount: bigint): Promise<SignedTx>;
  broadcast(raw: `0x${string}`): Promise<void>;
  state(companyId: string, hash: `0x${string}`, nonce: number, waitMs: number): Promise<TxState>;
  /** The node refused the transaction outright, so it is not on its way. */
  refused(e: unknown): boolean;
}

export const FEE_PARTS: FeePart[] = ["dev", "treasury"];
const due = (companyId: string, part: FeePart) => `co:${companyId}:fee-due:${part}`;

export class Payouts {
  constructor(
    private readonly ledger: Ledger,
    /** Legs sent and not booked yet, by hash. Persisted with the rest of the state. */
    private readonly pending: Map<string, Leg>,
    /** Writes the state to disk now: called before every broadcast and after every booking. */
    private readonly save: () => Promise<void>,
    private readonly chain: PayoutChain | null,
    private readonly waitMs = 90_000,
    private readonly now = Date.now,
  ) {}

  /** Fee still owed to the platform from earlier withdrawals: in the wallet, not the owner's. */
  async feesOwed(companyId: string): Promise<bigint> {
    let s = 0n;
    for (const p of FEE_PARTS) s += await this.ledger.balance(due(companyId, p), "USDC");
    return s;
  }

  pendingOf(companyId: string): Leg[] { return [...this.pending.values()].filter((l) => l.companyId === companyId); }

  /** Legs sent earlier: booked if they landed, forgotten if they never can. Returns how many still wait. */
  async resolve(companyId: string): Promise<number> {
    for (const l of this.pendingOf(companyId)) {
      const st = await this.chain!.state(companyId, l.hash, l.nonce, 0);
      if (st === "success") await this.#book(l);
      else if (st === "reverted" || st === "dropped") { this.pending.delete(l.hash); await this.save(); }
      else await this.chain!.broadcast(l.raw).catch(async (e) => { if (this.chain!.refused(e)) { this.pending.delete(l.hash); await this.save(); } });
    }
    return this.pendingOf(companyId).length;
  }

  /** The owner's share of `total`, then the fee legs. `feeBps` 0 for holders or when no fee is set. */
  async withdraw(companyId: string, to: `0x${string}`, total: bigint, feeBps: number, dest: Record<FeePart, `0x${string}` | "">): Promise<{ sent: bigint; fee: bigint; tx: string; feeTxs: string[]; feeError?: string }> {
    if (this.pendingOf(companyId).length) throw new Error("An earlier transfer from this wallet is still waiting for the chain. Try again in a few minutes.");
    const available = await this.ledger.balance(`co:${companyId}:usdc`, "USDC");
    if (total <= 0n || total > available) throw new Error(`Nothing to withdraw, or more than the $${(Number(available) / 1e6).toFixed(2)} available.`);
    const fee = dest.treasury ? (total * BigInt(feeBps)) / 10_000n : 0n;
    const dev = dest.dev ? (fee * 2000n) / 10_000n : 0n;
    const fees = { dev, treasury: fee - dev };
    const sent = total - fee;
    const tx = await this.#leg({ companyId, kind: "owner", to, amount: sent, total, fees });
    const r = await this.payFees(companyId, dest);
    return { sent, fee, tx, feeTxs: r.txs, ...(r.error ? { feeError: r.error } : {}) };
  }

  /** Pays what is owed to the platform. A failure leaves it owed for the next try; it never blocks the owner. */
  async payFees(companyId: string, dest: Record<FeePart, `0x${string}` | "">): Promise<{ txs: string[]; error?: string }> {
    const txs: string[] = [];
    for (const kind of FEE_PARTS) {
      const owed = await this.ledger.balance(due(companyId, kind), "USDC");
      const to = dest[kind];
      if (owed <= 0n || !to || this.pendingOf(companyId).some((l) => l.kind === kind)) continue;
      try { txs.push(await this.#leg({ companyId, kind, to, amount: owed })); } catch (e) { return { txs, error: (e as Error).message }; }
    }
    return { txs };
  }

  async #leg(l: Omit<Leg, "hash" | "raw" | "nonce" | "at">): Promise<string> {
    if (!this.chain) {
      const id = randomUUID();
      await this.#book({ ...l, hash: id as `0x${string}`, raw: "0x", nonce: 0, at: this.now() });
      return id;
    }
    const s = await this.chain.sign(l.companyId, l.to, l.amount);
    const leg: Leg = { ...l, ...s, at: this.now() };
    this.pending.set(leg.hash, leg);
    await this.save();
    try { await this.chain.broadcast(leg.raw); } catch (e) {
      if (this.chain.refused(e)) { this.pending.delete(leg.hash); await this.save(); throw e; }
      // unknown: it may be on its way; it stays pending and is followed like any sent transfer
    }
    const st = await this.chain.state(l.companyId, leg.hash, leg.nonce, this.waitMs);
    if (st === "success") { await this.#book(leg); return leg.hash; }
    if (st === "reverted" || st === "dropped") { this.pending.delete(leg.hash); await this.save(); throw new Error(`transfer ${st}: ${leg.hash}`); }
    throw new Error(`Transfer ${leg.hash} was sent and is waiting for the chain. It is booked as soon as it lands; check again in a few minutes.`);
  }

  async #book(l: Leg): Promise<void> {
    const postings: Posting[] = l.kind === "owner"
      ? [
        { account: `co:${l.companyId}:usdc`, asset: "USDC", amount: -l.total! },
        { account: `ext:owner:${l.to.toLowerCase()}`, asset: "USDC", amount: l.amount },
        ...FEE_PARTS.filter((p) => l.fees![p] > 0n).map((p) => ({ account: due(l.companyId, p), asset: "USDC", amount: l.fees![p] })),
      ]
      : [
        { account: due(l.companyId, l.kind), asset: "USDC", amount: -l.amount },
        { account: `ext:platform:${l.kind}`, asset: "USDC", amount: l.amount },
      ];
    await this.ledger.post({
      id: `${l.kind === "owner" ? "withdraw" : "withdraw-fee"}:${l.hash}`, at: new Date(this.now()), kind: "withdrawal",
      memo: l.kind === "owner" ? `to ${l.to}` : `platform fee (${l.kind})`, ...(this.chain ? { ref: { chainTx: l.hash } } : {}), postings,
    });
    this.pending.delete(l.hash);
    await this.save();
  }
}
