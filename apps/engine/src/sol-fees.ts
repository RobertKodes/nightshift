import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { writeAtomic } from "./atomic.js";

/**
 * NIGHTSHIFT's share of the Solana launchpad's fees, split and burned by the server, with no one in the loop.
 *
 * The launch partner on every Meteora curve is a Solana wallet the engine created for itself (the "fee
 * wallet"); its key is made on the server and never leaves it. Every few hours the engine claims the
 * partner's trading fees and launch fees from every pool, all in SOL, and splits what came in.
 * After a launch graduates the partner keeps earning: Meteora's migration hands the fee wallet the NFT of a
 * permanently locked LP position in the token's DAMM v2 pool (half the pool's liquidity), whose trading fees
 * the engine claims too, with the partner's share of the curve's surplus (and of a migration fee, if a
 * config had one). Only SOL enters the split; a fee paid in the token stays in the fee wallet, counted as held:
 *   60% the dev wallet (dev + marketing) · 20% bought as IMD and burned · 20% bought as $SHIFT and burned.
 * (Until 2026-11-16, 10% went to ADAM: the owner moved it to the dev wallet; what was kept for ADAM went there too.)
 * The two burns go through Relay in one Solana transaction each: SOL in on Solana, IMD or $SHIFT out on
 * Ethereum, delivered straight to the burn address (IMD to IMD's BurnExecutor, $SHIFT to 0x…dEaD). The
 * engine never holds an Ethereum key, and the fee wallet can only pay the two wallets named in /setup and
 * Relay's deposit program: every transaction is checked, and simulated, before it is signed.
 */

export const IMD_TOKEN = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
export const SHIFT_TOKEN = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";
export const IMD_BURN_EXECUTOR = "0xe29386719c155b6847ad5a4e97c6674f10ffc750";
export const DEAD = "0x000000000000000000000000000000000000dead";

/** The split, in basis points of every lamport claimed. Fixed in code, the same on the public page. */
export const SPLIT = { adam: 0, dev: 6_000, imd: 2_000, shift: 2_000 } as const;
export type Bucket = keyof typeof SPLIT;
export const SPLIT_LABELS: { key: Bucket; label: string; pct: number }[] = [
  { key: "dev", label: "Dev + marketing", pct: 60 },
  { key: "imd", label: "Bought as IMD and burned", pct: 20 },
  { key: "shift", label: "Bought as $SHIFT and burned", pct: 20 },
];

export const BURNS = {
  imd: { token: IMD_TOKEN, to: IMD_BURN_EXECUTOR, symbol: "IMD", decimals: 18, maxLossPct: 5 },
  shift: { token: SHIFT_TOKEN, to: DEAD, symbol: "SHIFT", decimals: 18, maxLossPct: 9 },
} as const;
export type BurnKey = keyof typeof BURNS;

const SOL = 1_000_000_000n;
/** Kept in the fee wallet for network fees and the rent a claim's temporary SOL account needs. */
export const RESERVE = 15_000_000n; // 0.015 SOL
/** Below this, a payout or a burn waits for the next run (a burn's fixed Relay costs are about $0.35-0.75). */
export const MIN_PAYOUT = 10_000_000n; // 0.01 SOL
export const MIN_BURN = 250_000_000n; // 0.25 SOL
/** BURN NOW (the admin's call, e.g. when trading stopped): a bucket from this much, at a loss the owner accepts, never over the cap. */
export const BURN_NOW_MIN = 5_000_000n; // 0.005 SOL
export const BURN_NOW_MAX_LOSS_PCT = 40;
/** One burn at most this big: $SHIFT's pool is thin, bigger buys move its price too much. */
export const MAX_BURN = 5n * SOL;
const EVERY_MS = 6 * 3600_000;
/** An LP position, a surplus or a migration fee worth less than this waits (each claim costs a network fee). */
export const MIN_EXTRA = 200_000n; // 0.0002 SOL

/** Split what a claim brought in: every lamport goes somewhere, the rounding to the $SHIFT burn. */
export function splitLamports(total: bigint): Record<Bucket, bigint> {
  const adam = (total * BigInt(SPLIT.adam)) / 10_000n;
  const dev = (total * BigInt(SPLIT.dev)) / 10_000n;
  const imd = (total * BigInt(SPLIT.imd)) / 10_000n;
  return { adam, dev, imd, shift: total - adam - dev - imd };
}

// ---------------------------------------------------------------- Relay

export const RELAY_DEPOSITORY = "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2";
export const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
export const SOLANA_RELAY_CHAIN = 792703809;
export const NATIVE_SOL = "11111111111111111111111111111111";

export type RelayIx = { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };
export type RelayQuote = {
  requestId: string;
  instructions: RelayIx[];
  lookupTables: string[];
  sender: string; recipient: string; outToken: string; outAmount: string; minOut: string;
  inUsd: number; outUsd: number;
};

/** Everything that must hold before a burn's Relay deposit is signed. Null when it is safe. */
export function relayProblem(q: RelayQuote, o: { wallet: string; burn: BurnKey; maxLossPct?: number }): string | null {
  const b = BURNS[o.burn];
  if (q.sender !== o.wallet) return "the deposit is not from the fee wallet";
  if (q.recipient.toLowerCase() !== b.to) return `the ${b.symbol} would not go to the burn address`;
  if (q.outToken.toLowerCase() !== b.token) return `the quote is not for ${b.symbol}`;
  if (!q.instructions.length) return "the quote has no deposit";
  for (const ix of q.instructions) {
    if (ix.programId !== RELAY_DEPOSITORY && ix.programId !== COMPUTE_BUDGET) return `an unknown program (${ix.programId}) is in the deposit`;
    for (const k of ix.keys) if (k.isSigner && k.pubkey !== o.wallet) return "the deposit asks another signer";
  }
  if (!(q.inUsd > 0) || !(q.outUsd > 0)) return "the quote has no dollar values";
  const loss = (1 - q.outUsd / q.inUsd) * 100;
  const cap = o.maxLossPct ?? b.maxLossPct;
  if (loss > cap) return `the route costs ${loss.toFixed(1)}% (the limit is ${cap}%)`;
  if (BigInt(q.minOut) <= 0n) return "the quote has no minimum out";
  return null;
}

// ---------------------------------------------------------------- what a claim may touch

/** The programs a claim transaction may call: Meteora's curve (DBC) and DAMM v2, the token programs, nothing else. */
export const CLAIM_PROGRAMS = new Set([
  COMPUTE_BUDGET, NATIVE_SOL, // the system program
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", // Meteora Dynamic Bonding Curve
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", // Meteora DAMM v2
]);

/** Everything that must hold before a claim is signed: known programs only, and the fee wallet the only signer. Null when it is safe. */
export function claimProblem(ixs: { programId: string; keys: { pubkey: string; isSigner: boolean }[] }[], wallet: string): string | null {
  if (!ixs.length) return "the claim is empty";
  for (const ix of ixs) {
    if (!CLAIM_PROGRAMS.has(ix.programId)) return `an unknown program (${ix.programId}) is in the claim`;
    for (const k of ix.keys) if (k.isSigner && k.pubkey !== wallet) return "the claim asks another signer";
  }
  return null;
}

/**
 * The partner's part of a curve's migration fee (Meteora's DBC: the fee is the threshold less the quote that
 * migrates, rounded up; the creator takes its percentage of it, rounded down; the partner the rest).
 */
export function partnerMigrationFee(threshold: bigint, feePct: number, creatorPct: number): bigint {
  if (!(feePct > 0) || threshold <= 0n) return 0n;
  const migrated = (threshold * BigInt(100 - feePct) + 99n) / 100n;
  const fee = threshold - migrated;
  return fee - (fee * BigInt(creatorPct)) / 100n;
}

// ---------------------------------------------------------------- the ledger

type Sol = string; // lamports, as a decimal string
export type BurnRecord = {
  at: number; burn: BurnKey; lamports: Sol; requestId: string; solTx: string;
  state: "sent" | "done" | "refunded"; out: string | null; ethTx: string | null; usd: number;
};
export type PayRecord = { at: number; to: "adam" | "dev"; lamports: Sol; tx: string };
export type ClaimRecord = { at: number; lamports: Sol; pools: number; txs: string[]; extras?: number };
type Ledger = {
  owed: Record<Bucket, Sol>;
  totals: { claimed: Sol; adam: Sol; dev: Sol; imd: Sol; shift: Sol; imdOut: string; shiftOut: string };
  claims: ClaimRecord[]; pays: PayRecord[]; burns: BurnRecord[];
  /** pools whose launch fee was claimed (it is paid once) */
  creationDone: string[];
  /** pools whose partner migration fee was withdrawn (it is paid once) */
  migrationDone: string[];
  /** fees that came in the launched token, not SOL (raw units by mint): kept in the fee wallet, never split */
  tokensHeld: Record<string, string>;
  lastRun: number | null; lastError: string | null;
};
const EMPTY: Ledger = {
  owed: { adam: "0", dev: "0", imd: "0", shift: "0" },
  totals: { claimed: "0", adam: "0", dev: "0", imd: "0", shift: "0", imdOut: "0", shiftOut: "0" },
  claims: [], pays: [], burns: [], creationDone: [], migrationDone: [], tokensHeld: {}, lastRun: null, lastError: null,
};
const KEEP = 200;

// ---------------------------------------------------------------- the chain, behind a port (tests use a fake)

export type FeePort = {
  balance(address: string): Promise<bigint>;
  /** The partner's trading fees waiting in each pool, and the launch fee at most still owed when it was not claimed yet. */
  claimable(pools: string[]): Promise<{ pool: string; lamports: bigint; creation: bigint }[]>;
  /** Claims one pool's partner trading fees (and its launch fee, once) into the wallet. */
  claim(wallet: Keypair, pool: string, creation: boolean): Promise<{ sig: string; creationClaimed: boolean }>;
  /** After graduation: the owner's LP positions in the launches' DAMM v2 pools, and the partner's surplus and migration fee on each curve. */
  extras(pools: string[], owner: string): Promise<Extra[]>;
  /** Claims one of them into the wallet (simulated first); `tokens` is what arrived in the launched token, if anything. */
  claimExtra(wallet: Keypair, e: Extra): Promise<{ sig: string; tokens: bigint }>;
  /** Plain SOL transfers from the wallet, in one transaction. */
  pay(wallet: Keypair, to: { address: string; lamports: bigint }[]): Promise<string>;
  quote(o: { wallet: string; burn: BurnKey; lamports: bigint }): Promise<RelayQuote>;
  /** Simulates the deposit first: the wallet may lose at most `lamports` plus the network fee. */
  deposit(wallet: Keypair, q: RelayQuote, lamports: bigint): Promise<string>;
  status(requestId: string): Promise<{ state: "pending" | "done" | "refunded"; ethTx: string | null; out: string | null }>;
};

/**
 * Something else the partner is owed on a launch: `position` = the fee wallet's locked LP position in the
 * graduated DAMM v2 pool (`ref` is the position, its fees `lamports` in SOL and `tokens` in the token);
 * `surplus` / `migration` = the partner's share of the curve's surplus or migration fee (`ref` is the curve).
 */
export type Extra = { kind: "position" | "surplus" | "migration"; pool: string; ref: string; mint: string; lamports: bigint; tokens: bigint };

export type FeeSettings = { on: boolean; adam: string | null; dev: string | null; partner: string | null; network: "mainnet" | "devnet" };

const big = (s: Sol) => BigInt(s);
const add = (a: Sol, b: bigint) => (big(a) + b).toString();

export class SolFees {
  private file: string;
  private keyFile: string;
  private l: Ledger;
  private kp: Keypair;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(dir: string, private port: () => FeePort, private settings: () => FeeSettings, private pools: () => string[], private now = () => Date.now()) {
    this.file = join(dir, "sol-fees.json");
    this.keyFile = join(dir, "sol-fee-wallet.json");
    this.l = existsSync(this.file) ? { ...structuredClone(EMPTY), ...(JSON.parse(readFileSync(this.file, "utf8")) as Ledger) } : structuredClone(EMPTY);
    // ADAM's share ended 2026-11-16 (the owner's call): what was kept for ADAM goes to the dev wallet
    if (big(this.l.owed.adam) > 0n) { this.l.owed.dev = add(this.l.owed.dev, big(this.l.owed.adam)); this.l.owed.adam = "0"; }
    if (existsSync(this.keyFile)) this.kp = Keypair.fromSecretKey(Buffer.from(JSON.parse(readFileSync(this.keyFile, "utf8")).secret as string, "base64"));
    else {
      this.kp = Keypair.generate();
      writeAtomic(this.keyFile, JSON.stringify({ secret: Buffer.from(this.kp.secretKey).toString("base64") }), { mode: 0o600 });
      try { chmodSync(this.keyFile, 0o600); } catch { /* not on every filesystem */ }
    }
  }

  get address(): string { return this.kp.publicKey.toBase58(); }

  private save() { writeAtomic(this.file, JSON.stringify(this.l)); }

  /** Why the automatic run is off, or null when it runs. */
  blocked(): string | null {
    const s = this.settings();
    if (s.network !== "mainnet") return "The launchpad is on devnet: fees are only split on mainnet.";
    if (!s.on) return "Turned off in the launchpad admin.";
    if (s.partner !== this.address) return "The fee wallet is not the launch partner yet: launches still pay another wallet.";
    if (!s.dev) return "The dev wallet is not set.";
    if (s.adam === this.address || s.dev === this.address) return "ADAM and the dev wallet must be other wallets than the fee wallet.";
    return null;
  }

  start() {
    if (this.timer) return;
    const tick = () => void this.run().catch(() => {});
    setTimeout(tick, 120_000).unref();
    this.timer = setInterval(tick, EVERY_MS);
    this.timer.unref();
  }

  /** One pass: follow the burns in flight, claim, pay ADAM and the dev wallet, burn. Never two at once. */
  async run(): Promise<{ ran: boolean; why?: string }> {
    const why = this.blocked();
    if (why) return { ran: false, why };
    if (this.running) return { ran: false, why: "Already running." };
    this.running = true;
    const port = this.port();
    const s = this.settings();
    try {
      await this.follow(port);
      await this.claim(port);
      await this.payout(port, s);
      for (const b of ["imd", "shift"] as const) await this.burn(port, b);
      this.l.lastError = null;
      return { ran: true };
    } catch (e) {
      this.l.lastError = `${new Date(this.now()).toISOString()}: ${(e as Error).message.slice(0, 200)}`;
      return { ran: true, why: this.l.lastError };
    } finally {
      this.l.lastRun = this.now();
      this.save();
      this.running = false;
    }
  }

  private async claim(port: FeePort) {
    const done = new Set(this.l.creationDone);
    const pools = this.pools();
    const waiting = (await port.claimable(pools)).map((p) => ({ ...p, creation: done.has(p.pool) ? 0n : p.creation })).filter((p) => p.lamports > 0n || p.creation > 0n);
    // after graduation: the locked LP positions' fees, the surplus, the migration fee (a failed read never stops the curve claims)
    const migDone = new Set(this.l.migrationDone);
    const extras = (await port.extras(pools, this.address).catch(() => [] as Extra[]))
      .filter((e) => e.lamports >= MIN_EXTRA && !(e.kind === "migration" && migDone.has(e.pool)));
    if (!waiting.length && !extras.length) return;
    const before = await port.balance(this.address);
    const txs: string[] = [];
    let most = 0n, n = 0;
    for (const p of waiting) {
      try {
        const r = await port.claim(this.kp, p.pool, p.creation > 0n);
        txs.push(r.sig);
        most += p.lamports + (r.creationClaimed ? p.creation : 0n);
        if (r.creationClaimed) this.l.creationDone.push(p.pool);
      } catch { /* the next run tries this pool again */ }
    }
    for (const e of extras) {
      try {
        const r = await port.claimExtra(this.kp, e);
        txs.push(r.sig);
        n++;
        most += e.lamports;
        if (e.kind === "migration") this.l.migrationDone.push(e.pool);
        // a fee paid in the token stays in the fee wallet: counted here, never split or sold
        if (r.tokens > 0n) this.l.tokensHeld[e.mint] = (big(this.l.tokensHeld[e.mint] ?? "0") + r.tokens).toString();
      } catch { /* the next run tries it again */ }
    }
    if (!txs.length) return;
    // what actually arrived, net of the network fees the claims cost, and never more than the pools held
    // (a Relay refund landing in the same seconds is counted by follow(), not here)
    let got = (await port.balance(this.address)) - before;
    if (got > most) got = most;
    if (got <= 0n) { this.save(); return; }
    const parts = splitLamports(got);
    for (const k of Object.keys(parts) as Bucket[]) this.l.owed[k] = add(this.l.owed[k], parts[k]);
    this.l.totals.claimed = add(this.l.totals.claimed, got);
    this.l.claims = [{ at: this.now(), lamports: got.toString(), pools: txs.length - n, txs, ...(n ? { extras: n } : {}) }, ...this.l.claims].slice(0, KEEP);
    this.save();
  }

  /** What the wallet can spend now, keeping the reserve. */
  private async spendable(port: FeePort): Promise<bigint> {
    const b = (await port.balance(this.address)) - RESERVE;
    return b > 0n ? b : 0n;
  }

  private async payout(port: FeePort, s: FeeSettings) {
    const adam = big(this.l.owed.adam), dev = big(this.l.owed.dev);
    const to: { address: string; lamports: bigint; who: "adam" | "dev" }[] = [];
    if (s.adam && adam >= MIN_PAYOUT) to.push({ address: s.adam!, lamports: adam, who: "adam" });
    if (dev >= MIN_PAYOUT) to.push({ address: s.dev!, lamports: dev, who: "dev" });
    if (!to.length) return;
    const moved = to.reduce((a, t) => a + t.lamports, 0n);
    if ((await this.spendable(port)) < moved) throw new Error("The fee wallet holds less than it owes: it waits for the next claim.");
    const before = await port.balance(this.address);
    const tx = await port.pay(this.kp, to);
    this.chargeFee(before - (await port.balance(this.address)) - moved);
    for (const t of to) {
      this.l.owed[t.who] = add(this.l.owed[t.who], -t.lamports);
      this.l.totals[t.who] = add(this.l.totals[t.who], t.lamports);
      this.l.pays = [{ at: this.now(), to: t.who, lamports: t.lamports.toString(), tx }, ...this.l.pays].slice(0, KEEP);
    }
    this.save();
  }

  /** How much of a bucket one burn takes now: what is owed, at most MAX_BURN, never the reserve. */
  private async burnable(port: FeePort, burn: BurnKey): Promise<bigint> {
    let amount = big(this.l.owed[burn]);
    if (amount > MAX_BURN) amount = MAX_BURN;
    // the network fees came out of the wallet too (see chargeFee): never more than it can spend
    const can = await this.spendable(port);
    return amount > can ? can : amount;
  }

  private async burn(port: FeePort, burn: BurnKey, o: { min: bigint; maxLossPct?: number } = { min: MIN_BURN }): Promise<BurnRecord | null> {
    const amount = await this.burnable(port, burn);
    if (amount < o.min) return null;
    const q = await port.quote({ wallet: this.address, burn, lamports: amount });
    const bad = relayProblem(q, { wallet: this.address, burn, maxLossPct: o.maxLossPct });
    if (bad) throw new Error(`The ${BURNS[burn].symbol} burn waits: ${bad}.`);
    const before = await port.balance(this.address);
    const solTx = await port.deposit(this.kp, q, amount);
    const fee = before - (await port.balance(this.address)) - amount;
    // the burn leaves its bucket first, then the network fee comes out of the $SHIFT share (never below zero)
    this.l.owed[burn] = add(this.l.owed[burn], -amount);
    this.chargeFee(fee);
    const rec: BurnRecord = { at: this.now(), burn, lamports: amount.toString(), requestId: q.requestId, solTx, state: "sent" as const, out: q.outAmount, ethTx: null, usd: q.inUsd };
    this.l.burns = [rec, ...this.l.burns].slice(0, KEEP);
    this.save();
    return rec;
  }

  /**
   * BURN NOW, the admin's call: each bucket holding at least BURN_NOW_MIN. Without `confirm` it only quotes
   * (nothing is signed); with it, it burns through the same checked path as the scheduled run, at the loss the
   * owner accepted (at most BURN_NOW_MAX_LOSS_PCT), never touching the reserve. Never while a run is going.
   */
  async burnNow(o: { confirm: boolean; maxLossPct?: number }) {
    const s = this.settings();
    if (s.network !== "mainnet") throw new Error("The launchpad is on devnet: nothing is burned there.");
    const cap = o.maxLossPct ?? BURN_NOW_MAX_LOSS_PCT;
    if (o.confirm && !(cap > 0 && cap <= BURN_NOW_MAX_LOSS_PCT)) throw new Error(`The accepted loss must be above 0% and at most ${BURN_NOW_MAX_LOSS_PCT}%.`);
    if (this.running) throw new Error("A run is going: try again in a minute.");
    this.running = true;
    const port = this.port();
    const sol = (v: bigint) => Number(v) / 1e9;
    const out: { token: string; sol: number; inUsd: number | null; outUsd: number | null; out: number | null; lossPct: number | null; problem: string | null; sent: { solTx: string; requestId: string } | null; error: string | null }[] = [];
    try {
      if (o.confirm) await this.follow(port);
      for (const burn of ["imd", "shift"] as const) {
        const b = BURNS[burn];
        const amount = await this.burnable(port, burn);
        if (amount < BURN_NOW_MIN) { out.push({ token: b.symbol, sol: sol(amount), inUsd: null, outUsd: null, out: null, lossPct: null, problem: `under ${sol(BURN_NOW_MIN)} SOL to burn`, sent: null, error: null }); continue; }
        if (!o.confirm) {
          const q = await port.quote({ wallet: this.address, burn, lamports: amount }).catch((e: Error) => e);
          if (q instanceof Error) { out.push({ token: b.symbol, sol: sol(amount), inUsd: null, outUsd: null, out: null, lossPct: null, problem: null, sent: null, error: q.message.slice(0, 200) }); continue; }
          const lossPct = q.inUsd > 0 ? +((1 - q.outUsd / q.inUsd) * 100).toFixed(2) : null;
          out.push({ token: b.symbol, sol: sol(amount), inUsd: q.inUsd, outUsd: q.outUsd, out: Number(big(q.outAmount) / 10n ** 12n) / 1e6, lossPct, problem: relayProblem(q, { wallet: this.address, burn, maxLossPct: BURN_NOW_MAX_LOSS_PCT }), sent: null, error: null });
          continue;
        }
        try {
          const r = await this.burn(port, burn, { min: BURN_NOW_MIN, maxLossPct: cap });
          out.push({ token: b.symbol, sol: r ? sol(big(r.lamports)) : sol(amount), inUsd: r?.usd ?? null, outUsd: null, out: r?.out ? Number(big(r.out) / 10n ** 12n) / 1e6 : null, lossPct: null, problem: null, sent: r ? { solTx: r.solTx, requestId: r.requestId } : null, error: null });
        } catch (e) {
          out.push({ token: b.symbol, sol: sol(amount), inUsd: null, outUsd: null, out: null, lossPct: null, problem: null, sent: null, error: (e as Error).message.slice(0, 200) });
        }
      }
    } finally {
      this.save();
      this.running = false;
    }
    return { confirm: o.confirm, maxLossPct: cap, burns: out };
  }

  /** Solana's network fees for the payouts and burns are paid from the $SHIFT burn's share (they are a few thousand lamports). */
  private chargeFee(fee: bigint) {
    if (fee <= 0n) return;
    const left = big(this.l.owed.shift) - fee;
    this.l.owed.shift = (left > 0n ? left : 0n).toString();
  }

  /** Burns sent earlier: done (counted), or refunded by Relay to the fee wallet (owed again). */
  private async follow(port: FeePort) {
    for (const b of this.l.burns.filter((x) => x.state === "sent")) {
      const st = await port.status(b.requestId).catch(() => null);
      if (!st || st.state === "pending") continue;
      if (st.state === "done") {
        b.state = "done"; b.ethTx = st.ethTx; if (st.out) b.out = st.out;
        this.l.totals[b.burn] = add(this.l.totals[b.burn], big(b.lamports));
        const k = b.burn === "imd" ? "imdOut" : "shiftOut";
        this.l.totals[k] = (big(this.l.totals[k]) + big(b.out ?? "0")).toString();
      } else {
        b.state = "refunded";
        this.l.owed[b.burn] = add(this.l.owed[b.burn], big(b.lamports));
      }
    }
    this.save();
  }

  /** The public page: the split, the totals, the latest burns with their transactions. */
  info() {
    const sol = (v: Sol) => Number(big(v)) / 1e9;
    const tok = (v: string) => Number(big(v) / 10n ** 12n) / 1e6;
    return {
      wallet: this.address,
      split: SPLIT_LABELS,
      running: this.blocked() === null,
      totals: {
        claimedSol: sol(this.l.totals.claimed), adamSol: sol(this.l.totals.adam), devSol: sol(this.l.totals.dev),
        imdBurnSol: sol(this.l.totals.imd), shiftBurnSol: sol(this.l.totals.shift),
        imdBurned: tok(this.l.totals.imdOut), shiftBurned: tok(this.l.totals.shiftOut),
      },
      waitingSol: { imd: sol(this.l.owed.imd), shift: sol(this.l.owed.shift) },
      burns: this.l.burns.slice(0, 20).map((b) => ({ at: b.at, token: BURNS[b.burn].symbol, sol: sol(b.lamports), amount: b.out ? tok(b.out) : null, state: b.state, solTx: b.solTx, ethTx: b.ethTx, to: BURNS[b.burn].to })),
      lastRun: this.l.lastRun,
    };
  }

  /** The admin: everything public plus why it is off, what is owed and the last error. */
  async adminInfo() {
    const balance = await this.port().balance(this.address).then((b) => Number(b) / 1e9).catch(() => null);
    return {
      ...this.info(), balanceSol: balance, blocked: this.blocked(), lastError: this.l.lastError,
      settings: (({ on, adam, dev }) => ({ on, adam, dev }))(this.settings()),
      owedSol: Object.fromEntries(Object.entries(this.l.owed).map(([k, v]) => [k, Number(big(v)) / 1e9])),
      pays: this.l.pays.slice(0, 20), claims: this.l.claims.slice(0, 20),
      // fees paid in a launched token (raw units, 6 decimals): held in the fee wallet, not split, not sold
      tokenFeesHeld: Object.entries(this.l.tokensHeld).filter(([, v]) => big(v) > 0n).map(([mint, raw]) => ({ mint, raw, amount: Number(big(raw)) / 1e6, note: "token fees held" })),
      limits: { reserveSol: Number(RESERVE) / 1e9, minBurnSol: Number(MIN_BURN) / 1e9, maxBurnSol: Number(MAX_BURN) / 1e9, burnNowMinSol: Number(BURN_NOW_MIN) / 1e9, burnNowMaxLossPct: BURN_NOW_MAX_LOSS_PCT },
    };
  }
}
