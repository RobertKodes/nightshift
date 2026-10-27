import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { formatUnits } from "viem";
import { checkQuote, type EvmTx, type Quote } from "@nightshift/swap";
import { writeAtomic } from "../atomic.js";
import type { SignedTx, TxState } from "../chain.js";

export const REFILL_IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
export const REFILL_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const REFILL_ETH = "0x0000000000000000000000000000000000000000";
export const BASE_GAS_FLOOR = 500_000_000_000_000n;
export type RefillKind = "imd" | "gas";
export type SwarmCredit = { orderId: string; at: number; units: string; reserveUnits: string; refundOwed: boolean; status?: string; refundPaid?: { tx: string; at: number } };
type Leg = { tx: EvmTx; signed?: SignedTx; submitted?: boolean; broadcastAt?: number; done?: boolean };
export type SwarmRefillOrder = { id: string; at: number; kind: RefillKind; amount: string; target: string; route: Quote; legs: Leg[]; phase: "source" | "bridge" | "done" | "refunded" | "failed"; error?: string; destinationTx?: string; delivered?: string; notified?: boolean; booked?: boolean; refundBooked?: boolean; warnedAt?: number };
type State = { version: 1; fills: SwarmRefillOrder[]; active: string | null; nextAt: number; lastFunds?: { imd: string; eth: string; baseEth: string }; error?: string };
export type SwarmRefillDeps = {
  file: string | null; now?: () => number; enabled(): boolean; float(): bigint; reserved(): bigint; credits(): SwarmCredit[]; house(): string;
  /** The smallest refill worth a cross-chain route, in USDC units; none when absent. */
  minRefill?(): bigint;
  funds(): Promise<{ imd: bigint; eth: bigint; usdc: bigint; baseEth: bigint }>;
  quote(kind: RefillKind, amount: bigint): Promise<Quote>;
  cost(txs: EvmTx[]): Promise<bigint>; sign(tx: EvmTx): Promise<SignedTx>; checkSigned?(tx: SignedTx): Promise<void>;
  broadcast(raw: `0x${string}`): Promise<void>; state(tx: SignedTx): Promise<TxState>;
  delivery(order: SwarmRefillOrder): Promise<{ state: "pending" | "done" | "refunded"; tx?: string; amount?: string }>;
  alert(text: string): Promise<unknown>; spent(order: SwarmRefillOrder): Promise<void>;
};
const HOUR = 3_600_000;
const same = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();

/** The swap metadata and pinned-contract checks must all agree before signing. */
export function checkRefillRoute(q: Quote, kind: RefillKind, amount: bigint, house: string): void {
  const token = kind === "imd" ? REFILL_IMD : REFILL_ETH;
  if (!/^0x[\da-f]{40}$/i.test(house) || !same(q.sender, house) || !same(q.recipient, house)) throw new Error("Refill must pay the house wallet on Ethereum.");
  if (q.fromChain !== "base" || q.toChain !== "eth" || q.fromToken.chain !== "base" || q.toToken.chain !== "eth" || !same(q.fromToken.address, REFILL_USDC) || !same(q.toToken.address, token) || q.fromToken.decimals !== 6 || q.toToken.decimals !== 18) throw new Error("Wrong refill chain or token.");
  if (BigInt(q.fromAmount) !== amount || q.nightshift.bps !== 0 || BigInt(q.nightshift.amount) !== 0n || !Number.isFinite(q.slippage) || q.slippage < 0 || q.slippage > 0.03 || BigInt(q.toAmountMin) * 100n < BigInt(q.toAmount) * 97n) throw new Error("Refill amount, fee or 3% slippage check failed.");
  const issues = checkQuote(q, { fromChain: "base", toChain: "eth", fromToken: REFILL_USDC, toToken: token, from: house, to: house, amount: amount.toString(), slippage: 0.03 }, { from: q.sender, to: q.recipient, needsApproval: true });
  if (issues.length || q.problems.length || !q.approval || q.txs.length !== 1 || q.txs.some((t) => t.kind !== "evm" || t.chainId !== 8453)) throw new Error("Refill route failed the site's swap checks.");
}

/** Only the desk's settled revenue after its reserve share can fund a refill. */
export class SwarmRefill {
  #s: State = { version: 1, fills: [], active: null, nextAt: 0 };
  #running: Promise<void> | null = null;
  constructor(private readonly d: SwarmRefillDeps) {
    if (d.file && !existsSync(d.file) && existsSync(`${d.file}.bak`)) throw new Error("Swarm refill ledger is missing; restore its backup before spending.");
    if (d.file && existsSync(d.file)) {
      const v = JSON.parse(readFileSync(d.file, "utf8")) as State;
      if (v.version !== 1 || !Array.isArray(v.fills) || v.fills.some((f) => !f.id || !/^\d+$/.test(f.amount) || !f.route || !Array.isArray(f.legs)) || (v.active && !v.fills.some((f) => f.id === v.active && ["source", "bridge"].includes(f.phase)))) throw new Error("Unreadable swarm refill ledger; refusing to reset it.");
      this.#s = v;
    }
  }
  #now() { return (this.d.now ?? Date.now)(); }
  #save() { if (this.d.file) writeAtomic(this.d.file, JSON.stringify(this.#s), { mode: 0o600, backup: true }); }
  #change(fn: () => void) { const before = structuredClone(this.#s); try { fn(); this.#save(); } catch (e) { this.#s = before; throw e; } }
  #funding() {
    const seen = new Set<string>(); let revenue = 0n, refunds = 0n, pending = 0n;
    for (const c of this.d.credits()) {
      if (seen.has(c.orderId)) continue; seen.add(c.orderId);
      const gross = BigInt(c.units), reserve = BigInt(c.reserveUnits);
      if (gross < 0n || reserve < 0n || reserve > gross) throw new Error("Invalid per-order refill allocation.");
      if (c.refundPaid) continue;
      if (c.refundOwed) refunds += gross; else if (c.status && c.status !== "done") pending += gross; else revenue += gross - reserve;
    }
    const committed = this.#s.fills.filter((f) => !["failed", "refunded"].includes(f.phase)).reduce((n, f) => n + BigInt(f.amount), 0n);
    return { revenue, committed, unspent: revenue > committed ? revenue - committed : 0n, refunds, pending };
  }
  heldUsdc(): bigint { const f = this.#funding(); return f.unspent + f.refunds + f.pending + this.#s.fills.filter((r) => !r.booked && !["failed", "refunded"].includes(r.phase)).reduce((n, r) => n + BigInt(r.amount), 0n); }
  status() {
    const f = this.#funding(), last = this.#s.lastFunds;
    return { imd: last ? formatUnits(BigInt(last.imd), 18) : null, eth: last ? formatUnits(BigInt(last.eth), 18) : null, baseEth: last ? formatUnits(BigInt(last.baseEth), 18) : null, floatImd: formatUnits(this.d.float(), 18), reservedImd: formatUnits(this.d.reserved(), 18), revenueUsd: Number(f.revenue) / 1e6, unspentUsd: Number(f.unspent) / 1e6, refundsOwedUsd: Number(f.refunds) / 1e6, active: this.#s.active, nextAt: this.#s.nextAt, error: this.#s.error ?? null, refills: this.#s.fills.slice(-10).map(({ id, kind, amount, phase, delivered, destinationTx }) => ({ id, kind, usd: Number(amount) / 1e6, phase, delivered, destinationTx })) };
  }
  tick(): Promise<void> { if (!this.#running) this.#running = this.#tick().finally(() => { this.#running = null; }); return this.#running; }
  async #warn(fill: SwarmRefillOrder | undefined, text: string) {
    if (fill && fill.warnedAt && this.#now() - fill.warnedAt < HOUR) return;
    const sent = await this.d.alert(`Swarm Desk refill: ${text}`);
    if (fill && sent !== false) this.#change(() => { fill.warnedAt = this.#now(); });
  }
  async #fail(fill: SwarmRefillOrder | undefined, text: string) {
    this.#change(() => { if (fill) { fill.phase = "failed"; fill.error = text; delete fill.warnedAt; } this.#s.active = null; this.#s.error = text; this.#s.nextAt = this.#now() + HOUR; });
    await this.#warn(fill, `${text} Retry in one hour; no replacement is sent for an uncertain transaction.`);
  }
  async #tick(): Promise<void> {
    for (const f of this.#s.fills) if (f.phase === "refunded" && f.booked && !f.refundBooked) { await this.d.spent(structuredClone(f)); this.#change(() => { f.refundBooked = true; }); }
    for (const f of this.#s.fills) if (f.phase === "done" && !f.notified) { await this.d.spent(structuredClone(f)); const sent = await this.d.alert(`Swarm Desk ${f.kind} refill completed, $${(Number(f.amount) / 1e6).toFixed(6)} USDC; Ethereum ${f.destinationTx}.`); this.#change(() => { f.notified = sent !== false; }); }
    const active = this.#s.fills.find((f) => f.id === this.#s.active);
    if (active) { await this.#advance(active); return; }
    if (!this.d.enabled() || (this.#now() < this.#s.nextAt && !(this.#s.error?.startsWith("No unspent") && this.#funding().unspent > 0n))) return;
    let fill: SwarmRefillOrder | undefined;
    try {
      const funds = await this.d.funds(); this.#change(() => { this.#s.lastFunds = { imd: funds.imd.toString(), eth: funds.eth.toString(), baseEth: funds.baseEth.toString() }; });
      const available = funds.imd > this.d.reserved() ? funds.imd - this.d.reserved() : 0n, float = this.d.float();
      const kind: RefillKind | null = funds.eth < 1_000_000_000_000_000n ? "gas" : available < float ? "imd" : null;
      if (!kind) return;
      const funding = this.#funding(), physical = funds.usdc > funding.refunds + funding.pending ? funds.usdc - funding.refunds - funding.pending : 0n;
      const budget = funding.unspent < physical ? funding.unspent : physical;
      if (budget <= 0n) { this.#change(() => { this.#s.error = "No unspent Swarm Desk revenue after the Agent Reserve share and refund holds."; this.#s.nextAt = this.#now() + HOUR; }); await this.#warn(undefined, this.#s.error!); return; }
      // a cross-chain route costs a fixed fee: on a few dollars it is far over 3%, so wait quietly for enough revenue
      const min = this.d.minRefill?.() ?? 0n;
      if (budget < min) { this.#change(() => { this.#s.error = `Waiting for $${Number(min) / 1e6} of unspent desk revenue before a ${kind} refill, so route fees stay under 3%.`; this.#s.nextAt = this.#now() + HOUR; }); return; }
      const target = kind === "gas" ? 2_000_000_000_000_000n : float - available;
      let amount = budget, q = await this.d.quote(kind, amount); checkRefillRoute(q, kind, amount, this.d.house());
      const quoted = BigInt(q.toAmountMin);
      if (quoted >= target) {
        amount = (amount * target + quoted - 1n) / quoted;
        for (let n = 0; n < 3; n++) { q = await this.d.quote(kind, amount); checkRefillRoute(q, kind, amount, this.d.house()); if (BigInt(q.toAmountMin) >= target || amount === budget) break; const next = (amount * target + BigInt(q.toAmountMin) - 1n) / BigInt(q.toAmountMin); amount = next > budget ? budget : next; }
      }
      if (kind === "gas" && BigInt(q.toAmountMin) < target) throw new Error("Desk revenue cannot fund the requested 0.002 ETH refill.");
      if (amount > budget || amount <= 0n) throw new Error("Refill exceeds unspent desk revenue.");
      const approval: EvmTx = { kind: "evm", chainId: 8453, to: REFILL_USDC, data: `0x095ea7b3${q.approval!.spender.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`, value: "0" };
      const txs = [approval, ...q.txs as EvmTx[]];
      if (funds.baseEth - await this.d.cost(txs) < BASE_GAS_FLOOR) throw new Error("Refill would breach the 0.0005 ETH Base settlement gas floor.");
      fill = { id: randomUUID(), at: this.#now(), kind, amount: amount.toString(), target: target.toString(), route: q, legs: txs.map((tx) => ({ tx })), phase: "source" };
      this.#change(() => { this.#s.fills.push(fill!); this.#s.active = fill!.id; delete this.#s.error; });
      await this.#warn(fill, `${kind} started, spending $${(Number(amount) / 1e6).toFixed(6)} of the desk's revenue; recipient ${this.d.house()} on Ethereum.`);
      await this.#advance(fill);
    } catch (e) { if (fill?.legs.some((l) => l.submitted)) { await this.#warn(fill, "Waiting for the saved Base transaction; no new route will be bought."); return; } await this.#fail(fill, (e as Error).message.slice(0, 240)); }
  }
  async #advance(fill: SwarmRefillOrder): Promise<void> {
    try {
      for (const leg of fill.legs) {
        if (leg.done) continue;
        if (leg.signed) {
          const state = await this.d.state(leg.signed);
          if (state === "success") { this.#change(() => { leg.done = true; }); continue; }
          if (state === "reverted") { await this.#fail(fill, "Saved Base transaction reverted."); return; }
          if (state === "pending" && leg.submitted && this.#now() - (leg.broadcastAt ?? fill.at) < HOUR) return;
          // A lost broadcast answer can only resend these exact saved bytes after an on-chain check.
        }
        if (!this.d.enabled()) return;
        checkRefillRoute(fill.route, fill.kind, BigInt(fill.amount), this.d.house());
        const funds = await this.d.funds(), remaining = fill.legs.filter((l) => !l.done).map((l) => l.tx), funding = this.#funding();
        if (funds.usdc < BigInt(fill.amount) + funding.refunds + funding.pending || funds.baseEth - await this.d.cost(remaining) < BASE_GAS_FLOOR) throw new Error("Refill funds or Base settlement gas are no longer available.");
        if (!leg.signed) { const signed = await this.d.sign(leg.tx); this.#change(() => { leg.signed = signed; }); }
        await this.d.checkSigned?.(leg.signed!);
        this.#change(() => { leg.submitted = true; leg.broadcastAt = this.#now(); });
        await this.d.broadcast(leg.signed!.raw);
        const state = await this.d.state(leg.signed!);
        if (state === "pending" || state === "dropped") return;
        if (state !== "success") { await this.#fail(fill, "Base refill transaction reverted."); return; }
        this.#change(() => { leg.done = true; });
      }
      if (!fill.booked) { await this.d.spent(structuredClone(fill)); this.#change(() => { fill.booked = true; }); }
      if (fill.phase !== "bridge") this.#change(() => { fill.phase = "bridge"; });
      const delivery = await this.d.delivery(structuredClone(fill));
      if (delivery.state === "refunded") { this.#change(() => { fill.phase = "refunded"; fill.destinationTx = delivery.tx; this.#s.active = null; this.#s.nextAt = this.#now() + HOUR; }); await this.d.spent(structuredClone(fill)); this.#change(() => { fill.refundBooked = true; }); await this.d.alert("Swarm Desk bridge refund proved on Base; retry in one hour."); return; }
      if (delivery.state !== "done") { await this.#warn(fill, "Waiting for on-chain Ethereum delivery proof; no second refill will start."); return; }
      if (!delivery.tx || !/^0x[\da-f]{64}$/i.test(delivery.tx) || !delivery.amount || BigInt(delivery.amount) < BigInt(fill.route.toAmountMin)) throw new Error("Ethereum receipt does not prove the quoted refill.");
      this.#change(() => { fill.phase = "done"; fill.destinationTx = delivery.tx; fill.delivered = delivery.amount; this.#s.active = null; this.#s.nextAt = this.#now() + 60_000; });
      await this.d.spent(structuredClone(fill));
      const sent = await this.d.alert(`Swarm Desk ${fill.kind} refill completed: ${formatUnits(BigInt(fill.delivered!), 18)} ${fill.kind === "imd" ? "IMD" : "ETH"} on Ethereum. $${(Number(fill.amount) / 1e6).toFixed(6)} USDC; ${fill.destinationTx}.`);
      this.#change(() => { fill.notified = sent !== false; });
    } catch (e) {
      if (fill.legs.some((l) => l.submitted) || fill.phase === "bridge" || fill.phase === "done") { await this.#warn(fill, "Rechecking the saved transaction and delivery; no replacement is sent."); return; }
      await this.#fail(fill, (e as Error).message.slice(0, 240));
    }
  }
}
