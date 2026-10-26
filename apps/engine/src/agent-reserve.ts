import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { formatUnits } from "viem";
import { checkQuote, type EvmTx, type Quote } from "@nightshift/swap";
import { writeAtomic } from "./atomic.js";
import { customerPayments, type ProofPayment } from "./proof.js";
import type { SignedTx, TxState } from "./chain.js";
import { bucharest } from "./agent-economy.js";
import { ownerText } from "./owner-stats.js";

export const RESERVE_SHIFT = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";
export const RESERVE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const RESERVE_WALLET = "0x6C4c78f2C3bDf4C4318Fe305FB1C8BC1694d19b5";
export const RESERVE_GAS = 500_000_000_000_000n;
const TRIGGER = 25_000_000n, HOUR = 3_600_000;
type Leg = { tx: EvmTx; signed?: SignedTx; submitted?: boolean; done?: boolean };
export type ReserveBuy = {
  id: string; at: number; amount: string; recipient: string; route: Quote; legs: Leg[];
  phase: "source" | "bridge" | "done" | "failed" | "dry"; error?: string; destinationTx?: string; shiftOut?: string; notified?: boolean;
};
type State = {
  version: 1; credits: { key: string; at: number; halfUnits: string }[]; balanceHalfUnits: string;
  buys: ReserveBuy[]; active: string | null; nextAt: number; attempts: { day: string; count: number }; mode?: "on" | "off" | "dry";
};
export type ReserveProof = { balanceUsd: number; totalInUsd: number; totalBoughtShift: string; inFlightUsd?: number; buys: { at: string; usd: number; shift: string; baseTx: string; ethereumTx: string; recipient: string }[] };
export type ReserveSettings = { enabled: boolean; dry: boolean; wallet: string };
export type ReserveDeps = {
  file: string | null; now?: () => number; settings(): ReserveSettings; configure?(mode: "on" | "off" | "dry"): void;
  house(): string; quote(amount: bigint, recipient: string): Promise<Quote>;
  funds(): Promise<{ usdc: bigint; eth: bigint }>;
  cost(txs: EvmTx[]): Promise<bigint>;
  sign(tx: EvmTx): Promise<SignedTx>; broadcast(raw: `0x${string}`): Promise<void>;
  checkSigned?(tx: SignedTx): Promise<void>;
  state(tx: SignedTx): Promise<TxState>;
  delivery(buy: ReserveBuy): Promise<{ state: "pending" | "done" | "refunded"; tx?: string; shift?: string; warning?: string }>;
  alert(text: string): Promise<unknown>; log?(text: string): void;
  bought(buy: ReserveBuy, proof: ReserveProof): Promise<void>;
};
const same = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
const usd = (micro: string | bigint) => Number(micro) / 1e6;

/** Checks the normalized route again before the house signs anything. */
export function checkReserveRoute(q: Quote, amount: bigint, house: string, recipient: string): void {
  if (!/^0x[0-9a-f]{40}$/i.test(recipient)) throw new Error("Invalid reserve recipient");
  if (!same(q.sender, house) || !same(q.recipient, recipient)) throw new Error("Wrong route sender or recipient");
  if (q.fromChain !== "base" || q.toChain !== "eth" || q.fromToken.chain !== "base" || q.toToken.chain !== "eth") throw new Error("Wrong reserve chains");
  if (!same(q.fromToken.address, RESERVE_USDC) || !same(q.toToken.address, RESERVE_SHIFT) || q.fromToken.decimals !== 6 || q.toToken.decimals !== 18) throw new Error("Wrong reserve token");
  if (!Number.isFinite(q.slippage) || q.slippage < 0 || q.slippage > 0.03 || BigInt(q.toAmountMin) * 100n < BigInt(q.toAmount) * 97n) throw new Error("Reserve slippage exceeds 3%");
  if (BigInt(q.fromAmount) !== amount || q.nightshift.bps !== 0 || BigInt(q.nightshift.amount) !== 0n) throw new Error("Wrong reserve amount or integrator fee");
  const problems = checkQuote(q, { fromChain: "base", toChain: "eth", fromToken: RESERVE_USDC, toToken: RESERVE_SHIFT, amount: amount.toString(), from: house, to: recipient, slippage: 0.03 }, { from: q.sender, to: q.recipient, needsApproval: true });
  if (q.problems.length || problems.length || !q.approval || q.txs.length !== 1 || q.txs.some((t) => t.kind !== "evm" || t.chainId !== 8453)) throw new Error("Reserve route did not pass the swap checks");
}

/** Half-micro-USDC credits stay exact; only whole onchain units can be spent. */
export class AgentReserve {
  #st: State;
  #running: Promise<void> | null = null;
  constructor(private readonly d: ReserveDeps) {
    this.#st = { version: 1, credits: [], balanceHalfUnits: "0", buys: [], active: null, nextAt: 0, attempts: { day: "", count: 0 } };
    if (d.file && !existsSync(d.file) && existsSync(`${d.file}.bak`)) throw new Error("Agent Reserve ledger is missing but its backup exists; refusing to reset it");
    if (d.file && existsSync(d.file)) {
      const s = JSON.parse(readFileSync(d.file, "utf8")) as State;
      if (s.version !== 1 || !Array.isArray(s.credits) || !Array.isArray(s.buys) || !/^\d+$/.test(s.balanceHalfUnits)) throw new Error("Unreadable Agent Reserve ledger; refusing to reset it");
      const expected = s.credits.reduce((n, c) => n + BigInt(c.halfUnits), 0n) - s.buys.filter((b) => b.phase === "done").reduce((n, b) => n + BigInt(b.amount) * 2n, 0n);
      if (expected !== BigInt(s.balanceHalfUnits) || (s.active && !s.buys.some((b) => b.id === s.active && (b.phase === "source" || b.phase === "bridge")))) throw new Error("Agent Reserve ledger does not balance; refusing to spend");
      this.#st = s;
    }
  }
  #now() { return (this.d.now ?? Date.now)(); }
  #save() { if (this.d.file) writeAtomic(this.d.file, JSON.stringify(this.#st), { mode: 0o600, backup: true }); }
  #change(fn: () => void) {
    const before = structuredClone(this.#st);
    try { fn(); this.#save(); } catch (e) { this.#st = before; throw e; }
  }
  #settings() {
    const s = this.d.settings();
    const mode = this.d.configure ? undefined : this.#st.mode;
    return { ...s, enabled: s.enabled && mode !== "off", dry: s.dry || mode === "dry" };
  }
  credit(p: ProofPayment): boolean {
    return this.creditMany([p]) > 0;
  }
  /** Reconciliation writes a recovered batch once, before any buy can start. */
  creditMany(pays: ProofPayment[]): number {
    const seen = new Set(this.#st.credits.map((c) => c.key));
    const fresh = customerPayments(pays).filter((p) => {
      if (seen.has(p.key) || BigInt(p.units) <= 0n) return false;
      seen.add(p.key); return true;
    });
    if (!fresh.length) return 0;
    this.#change(() => {
      for (const p of fresh) {
        this.#st.credits.push({ key: p.key, at: p.at, halfUnits: p.units });
        this.#st.balanceHalfUnits = (BigInt(this.#st.balanceHalfUnits) + BigInt(p.units)).toString();
      }
    });
    return fresh.length;
  }
  /** Allocated USDC, including receipts still waiting to reach the house books. */
  heldUsdc(): bigint {
    return (BigInt(this.#st.balanceHalfUnits) + 1n) / 2n + this.#st.buys.filter((b) => b.phase === "done" && !b.notified).reduce((n, b) => n + BigInt(b.amount), 0n);
  }
  command(args: string[]): string {
    const mode = args[0];
    if (args.length === 1 && (mode === "on" || mode === "off" || mode === "dry")) {
      this.d.configure?.(mode);
      this.#change(() => { this.#st.mode = mode; });
    }
    const s = this.#settings(), p = this.proof(), last = this.#st.buys.slice(-3).reverse();
    return `🤖 <b>Agent Reserve · ${s.enabled ? s.dry ? "dry" : "on" : "off"}</b>\nBalance: $${(Number(this.#st.balanceHalfUnits) / 2e6).toFixed(7)} · ${this.#st.credits.length} credits\n50% of settled customer payments. Trigger: $25.00.\nBought: ${p.totalBoughtShift} $SHIFT · recipient ${ownerText(s.wallet)} (NIGHTSHIFT team wallet).\n${this.#st.active ? "A buy is in flight; no second buy can start." : `Next check: ${this.#st.nextAt > this.#now() ? new Date(this.#st.nextAt).toISOString() : "when the reserve reaches $25.00"}.`}\n${last.map((b) => `$${usd(b.amount).toFixed(2)} · ${b.phase}${b.error ? ` · ${ownerText(b.error)}` : ""}`).join("\n")}\n/reserve on | off | dry`;
  }
  proof(): ReserveProof {
    const done = this.#st.buys.filter((b) => b.phase === "done");
    return {
      balanceUsd: Number(this.#st.balanceHalfUnits) / 2e6,
      totalInUsd: Number(this.#st.credits.reduce((n, c) => n + BigInt(c.halfUnits), 0n)) / 2e6,
      totalBoughtShift: formatUnits(done.reduce((n, b) => n + BigInt(b.shiftOut!), 0n), 18),
      inFlightUsd: this.#st.active ? usd(this.#st.buys.find((b) => b.id === this.#st.active)!.amount) : 0,
      buys: done.map((b) => ({ at: new Date(b.at).toISOString(), usd: usd(b.amount), shift: formatUnits(BigInt(b.shiftOut!), 18), baseTx: `https://basescan.org/tx/${b.legs.at(-1)!.signed!.hash}`, ethereumTx: `https://etherscan.io/tx/${b.destinationTx}`, recipient: `${b.recipient.slice(0, 6)}…${b.recipient.slice(-4)}` })),
    };
  }
  tick(): Promise<void> {
    if (this.#running) return this.#running;
    this.#running = this.#tick().finally(() => { this.#running = null; });
    return this.#running;
  }
  async #fail(b: ReserveBuy | null, message: string): Promise<void> {
    this.#change(() => {
      if (b) { b.phase = "failed"; b.error = message; }
      const day = bucharest(this.#now()).day;
      if (this.#st.attempts.day !== day) this.#st.attempts = { day, count: 0 };
      this.#st.attempts.count++;
      this.#st.active = null; this.#st.nextAt = this.#now() + HOUR;
    });
    await this.d.alert(`Agent Reserve buy failed: ${message}. Nothing was debited from the reserve; next retry in one hour (at most 3 attempts/day).`);
  }
  async #tick(): Promise<void> {
    for (const b of this.#st.buys) if (b.phase === "done" && !b.notified) {
      await this.d.bought(structuredClone(b), this.proof());
      this.#change(() => { b.notified = true; });
    }
    const active = this.#st.buys.find((b) => b.id === this.#st.active);
    if (active) { await this.#advance(active); return; }
    const s = this.#settings(), now = this.#now(), amount = BigInt(this.#st.balanceHalfUnits) / 2n;
    if (!s.enabled || amount < TRIGGER || now < this.#st.nextAt) return;
    const day = bucharest(now).day;
    if (this.#st.attempts.day !== day) this.#change(() => { this.#st.attempts = { day, count: 0 }; });
    if (this.#st.attempts.count >= 3) return;
    this.#change(() => { this.#st.nextAt = now + 600_000; });
    let b: ReserveBuy | null = null;
    try {
      const route = await this.d.quote(amount, s.wallet);
      checkReserveRoute(route, amount, this.d.house(), s.wallet);
      const approval: EvmTx = { kind: "evm", chainId: 8453, to: RESERVE_USDC, data: `0x095ea7b3${route.approval!.spender.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`, value: "0" };
      const txs = [approval, ...route.txs as EvmTx[]], funds = await this.d.funds(), cost = await this.d.cost(txs);
      if (funds.usdc < amount) throw new Error("House USDC does not cover the reserve");
      if (funds.eth - cost < RESERVE_GAS) throw new Error("House Base ETH would fall below 0.0005 ETH");
      b = { id: createHash("sha256").update(`${now}:${this.#st.buys.length}:${amount}`).digest("hex").slice(0, 24), at: now, amount: amount.toString(), recipient: s.wallet, route, legs: txs.map((tx) => ({ tx })), phase: s.dry ? "dry" : "source" };
      this.#change(() => { this.#st.buys.push(b!); if (!s.dry) this.#st.active = b!.id; });
      if (s.dry) {
        const text = `Agent Reserve DRY: would swap $${usd(amount).toFixed(6)} USDC on Base for $SHIFT on Ethereum to the NIGHTSHIFT team wallet ${s.wallet.slice(0, 6)}…${s.wallet.slice(-4)}. No transaction sent.`;
        this.d.log?.(text); await this.d.alert(text); return;
      }
      await this.#advance(b);
    } catch (e) {
      // An active signed transaction must be reconciled, never replaced after an uncertain answer.
      if (b && b.legs.some((l) => l.submitted && !l.done)) { await this.d.alert("Agent Reserve is waiting for its saved Base transaction; no replacement buy will be sent."); return; }
      await this.#fail(b, (e as Error).message.slice(0, 120));
    }
  }
  async #advance(b: ReserveBuy): Promise<void> {
    try {
      for (const leg of b.legs) {
        if (leg.done) continue;
        if (leg.signed && leg.submitted) {
          const state = await this.d.state(leg.signed);
          if (state === "pending") return;
          if (state !== "success") { await this.#fail(b, `Base transaction ${state}`); return; }
          this.#change(() => { leg.done = true; }); continue;
        }
        const s = this.#settings();
        if (!s.enabled || s.dry) return;
        checkReserveRoute(b.route, BigInt(b.amount), this.d.house(), b.recipient);
        if (!same(s.wallet, b.recipient)) throw new Error("Reserve recipient changed during a buy");
        const remaining = b.legs.filter((l) => !l.done).map((l) => l.tx), funds = await this.d.funds();
        if (funds.usdc < BigInt(b.amount)) throw new Error("House USDC does not cover the reserve");
        if (funds.eth - await this.d.cost(remaining) < RESERVE_GAS) throw new Error("House Base ETH would fall below 0.0005 ETH");
        if (!leg.signed) {
          const signed = await this.d.sign(leg.tx);
          this.#change(() => { leg.signed = signed; });
        }
        await this.d.checkSigned?.(leg.signed!);
        this.#change(() => { leg.submitted = true; });
        await this.d.broadcast(leg.signed!.raw);
        const state = await this.d.state(leg.signed!);
        if (state === "pending") return;
        if (state !== "success") { await this.#fail(b, `Base transaction ${state}`); return; }
        this.#change(() => { leg.done = true; });
      }
      if (b.phase !== "bridge") this.#change(() => { b.phase = "bridge"; });
      const delivered = await this.d.delivery(structuredClone(b));
      if (delivered.state === "refunded") { await this.#fail(b, "The route was refunded on chain"); return; }
      if (delivered.state !== "done") {
        if (delivered.warning) await this.d.alert(delivered.warning);
        return;
      }
      if (!delivered.tx || !/^0x[0-9a-f]{64}$/i.test(delivered.tx) || !delivered.shift || BigInt(delivered.shift) < BigInt(b.route.toAmountMin)) throw new Error("Destination transfer does not prove the quoted SHIFT delivery");
      this.#change(() => {
        b.phase = "done"; b.shiftOut = delivered.shift; b.destinationTx = delivered.tx;
        this.#st.balanceHalfUnits = (BigInt(this.#st.balanceHalfUnits) - BigInt(b.amount) * 2n).toString();
        this.#st.active = null; this.#st.nextAt = Math.max(this.#st.nextAt, this.#now() + 600_000);
      });
      await this.d.bought(structuredClone(b), this.proof());
      this.#change(() => { b.notified = true; });
    } catch (e) {
      const sourceSent = b.legs.some((l) => l.submitted && !l.done) || b.phase === "bridge" || b.phase === "done";
      if (sourceSent) { await this.d.alert("Agent Reserve is reconciling a saved transaction or delivery; no second buy will be sent."); return; }
      await this.#fail(b, (e as Error).message.slice(0, 120));
    }
  }
}

export function reserveBuyMessage(b: ReserveBuy, p: ReserveProof): string {
  return `🤖➡️🌙 <b>Agents just bought $SHIFT</b>\n\n$${usd(b.amount).toFixed(6)} USDC in · <b>${formatUnits(BigInt(b.shiftOut!), 18)} $SHIFT</b> out.\n<a href="https://basescan.org/tx/${b.legs.at(-1)!.signed!.hash}">Base transaction</a> · <a href="https://etherscan.io/tx/${b.destinationTx}">Ethereum transaction</a>\nBought by agents so far: <b>${p.totalBoughtShift} $SHIFT</b>.\n\nThe $SHIFT goes to the NIGHTSHIFT team wallet (${ownerText(b.recipient)}). Funded by 50% of settled customer payments.`;
}
let current: AgentReserve | null = null;
export const liveAgentReserve = () => current;
export const setAgentReserve = (v: AgentReserve | null) => { current = v; };
