import { existsSync, readFileSync } from "node:fs";
import { formatUnits } from "viem";
import { writeAtomic } from "./atomic.js";
import type { StakeRow } from "./stake-history.js";

/**
 * THE LEADERBOARDS: who stakes on NIGHTSHIFT and how much, and who was paid the most, from what is recorded,
 * never estimated. Two boards, each with a list per source:
 *   - stakers: $SHIFT staked in ShiftRewards (its own Staked/Withdrawn events, the stake-history index) and
 *     NIGHT FROGS / Night Watchers held in soft staking (staking.json);
 *   - earners: $SHIFT staking rewards paid (RewardPaid), the frog pot claimed (FrogsClaimed), staked duels
 *     won and lost (GameEscrow), live bets won and lost (BetPool), the Night Watch's liquidation bonus kept,
 *     and shift hours (points, never money).
 * Different tokens are never added up as one: each amount keeps its unit, and a dollar figure is given only
 * where a price is known (today's), summed across units only as dollars. A game or a bet counts net: what
 * the wallet was paid less what it put in; a bet still to be claimed (a win or a refund) counts once claimed.
 * The NIGHTSHIFT wallets (dev, treasury, house) are left out.
 *
 * The escrow and the bet pool keep only their last weeks, so their full history is read here from their own
 * events, once, one range at a time, and kept in DATA_DIR/leaderboards.json (PayoutIndex).
 */

export type Sym = "ETH" | "SHIFT" | "IMD";
export type Unit = Sym | "USD" | "HOURS";
export type Prices = Record<Sym, number | null>;
export const STAKER_SOURCES = ["shift", "frogs"] as const;
export type StakerSource = (typeof STAKER_SOURCES)[number];
export const EARNER_SOURCES = ["staking", "frogpot", "games", "bets", "watch", "hours"] as const;
export type EarnerSource = (typeof EARNER_SOURCES)[number];
/** live: complete to `asOfBlock`; syncing: still being read (what is shown stops short); off: not running here; error: could not be read. */
export type SourceState = { state: "live" | "syncing" | "off" | "error"; asOfBlock?: number };

export type FrogWallet = { wallet: string; hours: number; frogs: number; watchers: number; perHour: number; imdSeat: boolean };
export type KeeperEarning = { keeper: string; owner: string | null; watcher: number | null; usd: number; bites: number };
/** One contract event as kept: its name, its arguments as lowercase strings, block, transaction and log index. */
export type EventRow = { e: string; a: Record<string, string>; b: number; t: string; i: number };
export type FeedKey = "games" | "bets" | "frogpot";

export type Amount = { unit: Unit; amount: string; usd: number | null };
export type Part = { amounts: Amount[]; usd: number | null; stats: Record<string, number> };
export type EarnerRow = { wallet: string; usd: number | null; partial: boolean; parts: Partial<Record<EarnerSource, Part>> };
export type StakerRow = {
  wallet: string;
  /** `lockedUntil`: when the last of its locks ends (seconds), null when nothing is locked now. */
  shift: { amount: string; usd: number | null; stakes: number; lockedUntil: number | null } | null;
  frogs: { frogs: number; watchers: number; perHour: number; hours: number; imdSeat: boolean } | null;
};
export type Boards = {
  at: number; prices: Prices; excluded: number;
  stakers: {
    sources: Record<StakerSource, SourceState>;
    totals: { shift: { amount: string; usd: number | null; wallets: number }; frogs: { frogs: number; watchers: number; wallets: number } };
    lists: Record<"all" | StakerSource, StakerRow[]>;
  };
  earners: { sources: Record<EarnerSource, SourceState>; lists: Record<"all" | EarnerSource, EarnerRow[]> };
};

export type LeaderInput = {
  now: number; prices: Prices;
  /** Token address (lowercase, the zero address for ETH) to its symbol. */
  tokens: Record<string, Sym>;
  exclude: ReadonlySet<string>;
  stakes: readonly StakeRow[]; frogs: FrogWallet[]; keepers: KeeperEarning[];
  feeds: Partial<Record<FeedKey, readonly EventRow[]>>;
  sources: { stakers: Record<StakerSource, SourceState>; earners: Record<EarnerSource, SourceState> };
};

const lc = (s: unknown) => String(s ?? "").toLowerCase();
const WALLET = /^0x[0-9a-f]{40}$/;
const NOBODY = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
const SYMS: Sym[] = ["ETH", "SHIFT", "IMD"];
const cents = (x: number) => Math.round(x * 100) / 100;
const big = (s: string | undefined) => { try { return BigInt(s ?? "0"); } catch { return 0n; } };
const add = (m: Map<Sym, bigint>, k: Sym, v: bigint) => m.set(k, (m.get(k) ?? 0n) + v);

/** A decoded event as kept in the index: arguments as lowercase strings (bigints, booleans and numbers too). */
export function eventRow(name: string, args: Record<string, unknown> | readonly unknown[] | undefined, l: { blockNumber?: bigint | null; transactionHash?: string | null; logIndex?: number | null }): EventRow {
  const a: Record<string, string> = {};
  for (const [k, v] of Object.entries(args ?? {})) if (Number.isNaN(Number(k))) a[k] = lc(v);
  return { e: name, a, b: Number(l.blockNumber ?? 0n), t: lc(l.transactionHash), i: l.logIndex ?? 0 };
}

type Acc = { tok: Record<"staking" | "frogpot" | "games" | "bets", Map<Sym, bigint>>; stats: Record<EarnerSource, Record<string, number>>; watch: number; hours: number };
const freshAcc = (): Acc => ({
  tok: { staking: new Map(), frogpot: new Map(), games: new Map(), bets: new Map() },
  stats: { staking: {}, frogpot: {}, games: {}, bets: {}, watch: {}, hours: {} }, watch: 0, hours: 0,
});
const bump = (s: Record<string, number>, k: string, n = 1) => { s[k] = (s[k] ?? 0) + n; };

/** Every staked duel settled on GameEscrow: the winner +payout −stake, the loser −stake, a draw nothing (both refunded). */
function games(rows: readonly EventRow[], tokens: Record<string, Sym>, acc: (w: string) => Acc | null) {
  const opened = new Map<string, { token: string; stake: bigint; a: string }>(), joined = new Map<string, string>();
  for (const r of rows) {
    if (r.e === "Opened") opened.set(r.a.matchId!, { token: r.a.token!, stake: big(r.a.stake), a: r.a.playerA! });
    else if (r.e === "Joined") joined.set(r.a.matchId!, r.a.playerB!);
  }
  for (const r of rows) {
    if (r.e !== "Settled") continue;
    const m = opened.get(r.a.matchId!), b = joined.get(r.a.matchId!), sym = m ? tokens[m.token] : undefined;
    if (!m || !b || !sym) continue;
    if (r.a.draw === "true") { for (const w of [m.a, b]) { const x = acc(w); if (x) bump(x.stats.games, "draws"); } continue; }
    const winner = r.a.winner!, loser = winner === m.a ? b : winner === b ? m.a : null;
    if (!loser) continue;
    const w = acc(winner), l = acc(loser);
    if (w) { add(w.tok.games, sym, big(r.a.payout) - m.stake); bump(w.stats.games, "won"); }
    if (l) { add(l.tok.games, sym, -m.stake); bump(l.stats.games, "lost"); }
  }
}

/**
 * Every BetPool market decided: a wallet that claimed counts what it was paid less what it bet; one that bet
 * only on the losing side of a two-sided market counts its bets lost; a win or a refund not yet claimed waits.
 */
function bets(rows: readonly EventRow[], tokens: Record<string, Sym>, acc: (w: string) => Acc | null) {
  const markets = new Map<string, { sym?: Sym; sides: [bigint, bigint]; outcome: number | null; wallets: Map<string, { sides: [bigint, bigint]; claimed: bigint }> }>();
  const market = (id: string) => { let m = markets.get(id); if (!m) { m = { sides: [0n, 0n], outcome: null, wallets: new Map() }; markets.set(id, m); } return m; };
  for (const r of rows) {
    const m = market(r.a.marketId!);
    if (r.e === "MarketCreated") m.sym = tokens[r.a.token!];
    else if (r.e === "Settled") m.outcome = Number(r.a.outcome);
    else if (r.e === "BetPlaced" || r.e === "Claimed") {
      const w = r.a.bettor!, x = m.wallets.get(w) ?? { sides: [0n, 0n] as [bigint, bigint], claimed: 0n };
      if (r.e === "Claimed") x.claimed += big(r.a.amount);
      else { const side = r.a.side === "1" ? 1 : 0; x.sides[side] += big(r.a.amount); m.sides[side] += big(r.a.amount); }
      m.wallets.set(w, x);
    }
  }
  for (const m of markets.values()) {
    if (!m.sym) continue;
    // one side empty, or void: every bet is refunded, so nothing is lost
    const decided = m.outcome === 0 || m.outcome === 1 ? (m.sides[0] > 0n && m.sides[1] > 0n ? m.outcome : null) : null;
    for (const [wallet, x] of m.wallets) {
      const staked = x.sides[0] + x.sides[1], a = acc(wallet);
      if (!a) continue;
      if (x.claimed > 0n) { add(a.tok.bets, m.sym, x.claimed - staked); bump(a.stats.bets, "markets"); }
      else if (decided !== null && x.sides[decided] === 0n && staked > 0n) { add(a.tok.bets, m.sym, -staked); bump(a.stats.bets, "markets"); }
    }
  }
}

/** Both boards from the sources' records. Pure: the caller reads the stores and the chain. */
export function aggregate(i: LeaderInput): Boards {
  const left = new Set<string>();
  const ok = (w: string) => { const k = lc(w); if (!WALLET.test(k) || NOBODY.has(k)) return null; if (i.exclude.has(k)) { left.add(k); return null; } return k; };
  const earners = new Map<string, Acc>();
  const acc = (w: string) => { const k = ok(w); if (!k) return null; let a = earners.get(k); if (!a) { a = freshAcc(); earners.set(k, a); } return a; };

  // $SHIFT staking: what each wallet has in (staked less withdrawn), and the rewards it was paid
  const shift = new Map<string, { net: bigint; stakes: number; unlock: number }>();
  for (const r of i.stakes) {
    const k = ok(r.account);
    if (!k) continue;
    if (r.kind === "paid") { const sym = i.tokens[lc(r.token)], a = acc(k); if (sym && a) { add(a.tok.staking, sym, big(r.amount)); bump(a.stats.staking, "payments"); } continue; }
    const s = shift.get(k) ?? { net: 0n, stakes: 0, unlock: 0 };
    if (r.kind === "staked") { s.net += big(r.amount); s.stakes++; s.unlock = Math.max(s.unlock, r.unlockAt ?? 0); } else s.net -= big(r.amount);
    shift.set(k, s);
  }
  for (const r of i.feeds.frogpot ?? []) {
    const sym = i.tokens[r.a.token!], a = r.e === "FrogsClaimed" ? acc(r.a.account!) : null;
    if (sym && a) { add(a.tok.frogpot, sym, big(r.a.amount)); bump(a.stats.frogpot, "claims"); }
  }
  games(i.feeds.games ?? [], i.tokens, acc);
  bets(i.feeds.bets ?? [], i.tokens, acc);
  for (const k of i.keepers) {
    const a = acc(k.owner ?? k.keeper);
    if (!a || !(k.usd > 0)) continue;
    a.watch += k.usd; bump(a.stats.watch, "liquidations", k.bites);
    if (k.watcher !== null) a.stats.watch.seat = k.watcher;
  }
  for (const f of i.frogs) { const a = f.hours > 0 ? acc(f.wallet) : null; if (a) a.hours += f.hours; }

  // ---- stakers
  const usdOf = (sym: Sym, amount: string) => (i.prices[sym] == null ? null : cents(Number(amount) * i.prices[sym]!));
  const stakers = new Map<string, StakerRow>();
  const staker = (k: string) => { let s = stakers.get(k); if (!s) { s = { wallet: k, shift: null, frogs: null }; stakers.set(k, s); } return s; };
  let shiftTotal = 0n;
  for (const [k, s] of shift) {
    if (s.net <= 0n) continue;
    shiftTotal += s.net;
    const amount = formatUnits(s.net, 18);
    staker(k).shift = { amount, usd: usdOf("SHIFT", amount), stakes: s.stakes, lockedUntil: s.unlock * 1000 > i.now ? s.unlock : null };
  }
  const frogTotal = { frogs: 0, watchers: 0, wallets: 0 };
  for (const f of i.frogs) {
    const k = f.frogs + f.watchers > 0 ? ok(f.wallet) : null;
    if (!k) continue;
    staker(k).frogs = { frogs: f.frogs, watchers: f.watchers, perHour: f.perHour, hours: Math.floor(f.hours), imdSeat: f.imdSeat };
    frogTotal.frogs += f.frogs; frogTotal.watchers += f.watchers; frogTotal.wallets++;
  }
  const wei = (r: StakerRow) => (r.shift ? shift.get(r.wallet)!.net : 0n);
  const shiftCmp = (a: StakerRow, b: StakerRow) => (wei(b) > wei(a) ? 1 : wei(b) < wei(a) ? -1 : 0);
  const frogCmp = (a: StakerRow, b: StakerRow) => (b.frogs?.perHour ?? 0) - (a.frogs?.perHour ?? 0) || ((b.frogs?.frogs ?? 0) + (b.frogs?.watchers ?? 0)) - ((a.frogs?.frogs ?? 0) + (a.frogs?.watchers ?? 0)) || (b.frogs?.hours ?? 0) - (a.frogs?.hours ?? 0);
  const byWallet = (a: { wallet: string }, b: { wallet: string }) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0);
  const all = [...stakers.values()];
  const shiftAmount = formatUnits(shiftTotal, 18);

  // ---- earners
  const tokenPart = (m: Map<Sym, bigint>, stats: Record<string, number>): Part | null => {
    const amounts = SYMS.filter((s) => (m.get(s) ?? 0n) !== 0n).map((unit) => { const amount = formatUnits(m.get(unit)!, 18); return { unit, amount, usd: usdOf(unit, amount) }; });
    if (!amounts.length) return null;
    const known = amounts.filter((a) => a.usd !== null);
    return { amounts, usd: known.length ? cents(known.reduce((t, a) => t + a.usd!, 0)) : null, stats };
  };
  const rows: EarnerRow[] = [];
  for (const [wallet, a] of earners) {
    const parts: Partial<Record<EarnerSource, Part>> = {};
    for (const s of ["staking", "frogpot", "games", "bets"] as const) { const p = tokenPart(a.tok[s], a.stats[s]); if (p) parts[s] = p; }
    if (a.watch > 0) parts.watch = { amounts: [{ unit: "USD", amount: cents(a.watch).toFixed(2), usd: cents(a.watch) }], usd: cents(a.watch), stats: a.stats.watch };
    if (a.hours > 0) parts.hours = { amounts: [{ unit: "HOURS", amount: String(Math.floor(a.hours)), usd: null }], usd: null, stats: {} };
    const money = Object.entries(parts).filter(([s]) => s !== "hours").flatMap(([, p]) => p.amounts);
    if (!Object.values(parts).some((p) => p.amounts.some((x) => Number(x.amount) > 0))) continue;
    const priced = money.filter((x) => x.usd !== null);
    rows.push({ wallet, usd: priced.length ? cents(priced.reduce((t, x) => t + x.usd!, 0)) : null, partial: money.some((x) => x.usd === null), parts });
  }
  const hoursOf = (r: EarnerRow) => Number(r.parts.hours?.amounts[0]?.amount ?? 0);
  const size = (p: Part | undefined) => (p ? p.amounts.reduce((t, x) => t + Number(x.amount), 0) : 0);
  const positive = (p: Part | undefined) => !!p && p.amounts.some((x) => Number(x.amount) > 0);
  const earnerList = (s: EarnerSource) => rows.filter((r) => positive(r.parts[s])).sort((a, b) => (b.parts[s]!.usd ?? 0) - (a.parts[s]!.usd ?? 0) || size(b.parts[s]) - size(a.parts[s]) || byWallet(a, b));

  return {
    at: i.now, prices: i.prices, excluded: left.size,
    stakers: {
      sources: i.sources.stakers,
      totals: { shift: { amount: shiftAmount, usd: usdOf("SHIFT", shiftAmount), wallets: [...shift.values()].filter((s) => s.net > 0n).length }, frogs: frogTotal },
      lists: {
        all: [...all].sort((a, b) => shiftCmp(a, b) || frogCmp(a, b) || byWallet(a, b)),
        shift: all.filter((r) => r.shift).sort((a, b) => shiftCmp(a, b) || byWallet(a, b)),
        frogs: all.filter((r) => r.frogs).sort((a, b) => frogCmp(a, b) || byWallet(a, b)),
      },
    },
    earners: {
      sources: i.sources.earners,
      lists: {
        all: [...rows].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || hoursOf(b) - hoursOf(a) || byWallet(a, b)),
        ...(Object.fromEntries(EARNER_SOURCES.map((s) => [s, earnerList(s)])) as Record<EarnerSource, EarnerRow[]>),
      },
    },
  };
}

/** One page of a board, ranked, with the asking wallet's own row wherever it ranks. */
export function boardView(b: Boards, kind: "stakers" | "earners", source: string, limit: number, wallet: string | null) {
  const board = b[kind], list = (board.lists as Record<string, (StakerRow | EarnerRow)[]>)[source] ?? [];
  const w = wallet ? lc(wallet) : null, at = w ? list.findIndex((r) => r.wallet === w) : -1;
  return {
    at: b.at, kind, source, prices: b.prices, sources: board.sources, ...(kind === "stakers" ? { totals: b.stakers.totals } : {}), excluded: b.excluded,
    count: list.length, rows: list.slice(0, limit).map((r, n) => ({ rank: n + 1, ...r })),
    me: at >= 0 ? { rank: at + 1, ...list[at]! } : null,
  };
}

// ---- the chain index

type Feed = { contract: string; next: number; rows: EventRow[] };
export type FeedSpec = { key: FeedKey; contract: string; from: number };
/** Reads one contract's events in [from, to], already as rows. */
export type FeedReader = (contract: `0x${string}`, from: bigint, to: bigint) => Promise<EventRow[]>;

/**
 * The escrow's, the bet pool's and the frog pot's events, read forward from each contract's first block and kept
 * in a file: a range at a time, each range tried twice and made smaller when a node refuses it, saved as it goes,
 * so a restart or a failed read picks up where it stopped. At most one read runs at a time.
 */
export class PayoutIndex {
  #feeds: Partial<Record<FeedKey, Feed>> = {};
  #head: Partial<Record<FeedKey, number>> = {};
  #failed: Partial<Record<FeedKey, boolean>> = {};
  #syncing: Promise<void> | null = null;
  #lastSync = 0;
  constructor(private o: {
    file: string | null; head(): Promise<bigint>; read: Record<FeedKey, FeedReader>; specs(): FeedSpec[];
    now?: () => number; span?: bigint; everyMs?: number; pauseMs?: number;
  }) {
    try { if (o.file && existsSync(o.file)) this.#feeds = (JSON.parse(readFileSync(o.file, "utf8")) as { feeds?: Partial<Record<FeedKey, Feed>> }).feeds ?? {}; } catch { this.#feeds = {}; }
  }
  #now() { return (this.o.now ?? Date.now)(); }
  #save() { if (this.o.file) writeAtomic(this.o.file, JSON.stringify({ version: 1, feeds: this.#feeds })); }

  /** Reads every feed up to the chain's head (less a block). A feed that fails stops there and is tried again next time. */
  sync(): Promise<void> {
    this.#syncing ??= this.#sync().finally(() => { this.#syncing = null; this.#lastSync = this.#now(); });
    return this.#syncing;
  }
  /** A sync when the last one is older than `everyMs` (5 minutes), without waiting for it. */
  poke(): void { if (!this.#syncing && this.#now() - this.#lastSync > (this.o.everyMs ?? 5 * 60_000)) void this.sync().catch((e) => console.error("leaderboards", (e as Error).message)); }

  async #sync(): Promise<void> {
    const head = Number(await this.o.head()) - 1;
    for (const spec of this.o.specs()) {
      const contract = lc(spec.contract);
      if (!WALLET.test(contract)) continue;
      let f = this.#feeds[spec.key];
      if (!f || f.contract !== contract) { f = { contract, next: Math.max(0, spec.from), rows: [] }; this.#feeds[spec.key] = f; }
      this.#head[spec.key] = head;
      this.#failed[spec.key] = false;
      let span = this.o.span ?? 9_000n;
      while (f.next <= head) {
        const from = BigInt(f.next), to = from + span - 1n > BigInt(head) ? BigInt(head) : from + span - 1n;
        let rows: EventRow[];
        try { rows = await this.o.read[spec.key](contract as `0x${string}`, from, to); } catch {
          await new Promise((r) => setTimeout(r, this.o.pauseMs ?? 1_000));
          try { rows = await this.o.read[spec.key](contract as `0x${string}`, from, to); } catch (e) {
            if (span > 400n) { span /= 4n; continue; }
            this.#failed[spec.key] = true;
            console.error(`leaderboards: ${spec.key} not read from block ${from}:`, (e as Error).message);
            break;
          }
        }
        f.rows.push(...rows.sort((x, y) => x.b - y.b || x.i - y.i));
        f.next = Number(to) + 1;
        this.#save();
      }
    }
  }

  /** Each running feed's rows and how far it has read. */
  view(): { feeds: Partial<Record<FeedKey, readonly EventRow[]>>; state: Record<FeedKey, SourceState> } {
    const all = this.o.specs(), specs = new Map(all.map((s) => [s.key, lc(s.contract)]));
    const feeds: Partial<Record<FeedKey, readonly EventRow[]>> = {};
    const state = {} as Record<FeedKey, SourceState>;
    for (const key of ["games", "bets", "frogpot"] as const) {
      const f = this.#feeds[key], head = this.#head[key];
      if (!specs.has(key) || !WALLET.test(specs.get(key)!)) { state[key] = { state: "off" }; continue; }
      if (!f || f.contract !== specs.get(key)) { state[key] = { state: "syncing" }; continue; }
      feeds[key] = f.rows;
      // read to the head seen by this run's sync: complete; a read that failed part-way shows what it has, as such
      const done = head !== undefined && f.next > head;
      const from = Math.max(0, all.find((s) => s.key === key)!.from);
      state[key] = { state: done ? "live" : this.#failed[key] ? "error" : "syncing", ...(f.next > from ? { asOfBlock: f.next - 1 } : {}) };
    }
    return { feeds, state };
  }
}

// ---- the boards, kept a few minutes

export type LeaderDeps = {
  /** $SHIFT stakes, withdrawals and reward payments; null while staking is not open; throws while being read. */
  stakes(): Promise<{ rows: readonly StakeRow[]; asOfBlock: number } | null>;
  /** Every wallet in soft staking; null while NIGHT FROGS are off. */
  frogs(): FrogWallet[] | null;
  keepers(): KeeperEarning[];
  index: Pick<PayoutIndex, "poke" | "view">;
  prices(): Promise<Prices>;
  tokens(): Record<string, Sym>;
  exclude(): ReadonlySet<string>;
  now?: () => number;
  /** How long a build waits for a slow read (the stake history, a price) before it uses what it has. */
  waitMs?: number;
};

export class Leaderboards {
  #cache: { at: number; ttl: number; boards: Boards } | null = null;
  #building: Promise<Boards> | null = null;
  #stakes: { rows: readonly StakeRow[]; asOfBlock: number } | null = null;
  #prices: Prices = { ETH: null, SHIFT: null, IMD: null };
  constructor(private d: LeaderDeps) {}
  #now() { return (this.d.now ?? Date.now)(); }

  /** The boards: a copy up to 5 minutes old (30 s while a source is still being read); an older copy answers while the next is built. */
  async boards(): Promise<Boards> {
    this.d.index.poke();
    const c = this.#cache;
    if (c && this.#now() - c.at < c.ttl) return c.boards;
    this.#building ??= this.#build().finally(() => { this.#building = null; });
    if (c) { this.#building.catch(() => {}); return c.boards; }
    return this.#building;
  }

  /** `p`, or `fallback` once `waitMs` has passed (p still lands later). */
  #within<T>(p: Promise<T>, fallback: () => T): Promise<T> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(fallback()), this.d.waitMs ?? 8_000);
      (t as { unref?: () => void }).unref?.();
      p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback()); });
    });
  }

  async #build(): Promise<Boards> {
    type Got = { v: { rows: readonly StakeRow[]; asOfBlock: number } | null; s: SourceState };
    const stakes = this.d.stakes().then((v): Got => { this.#stakes = v; return { v, s: v ? { state: "live", asOfBlock: v.asOfBlock } : { state: "off" } }; },
      (e): Got => ({ v: this.#stakes, s: { state: /still being read/i.test((e as Error).message) ? "syncing" : "error", ...(this.#stakes ? { asOfBlock: this.#stakes.asOfBlock } : {}) } }));
    const prices = this.d.prices().then((p) => { this.#prices = p; return p; });
    const [st, px] = await Promise.all([
      this.#within(stakes, (): Got => ({ v: this.#stakes, s: { state: "syncing", ...(this.#stakes ? { asOfBlock: this.#stakes.asOfBlock } : {}) } })),
      this.#within(prices, () => this.#prices),
    ]);
    let frogs: FrogWallet[] | null = null, keepers: KeeperEarning[] = [];
    try { frogs = this.d.frogs(); } catch (e) { console.error("leaderboards frogs", (e as Error).message); }
    try { keepers = this.d.keepers(); } catch (e) { console.error("leaderboards keepers", (e as Error).message); }
    const idx = this.d.index.view();
    const frogState: SourceState = { state: frogs ? "live" : "off" };
    const boards = aggregate({
      now: this.#now(), prices: px, tokens: this.d.tokens(), exclude: this.d.exclude(),
      stakes: st.v?.rows ?? [], frogs: frogs ?? [], keepers, feeds: idx.feeds,
      sources: {
        stakers: { shift: st.s, frogs: frogState },
        earners: { staking: st.s, frogpot: idx.state.frogpot, games: idx.state.games, bets: idx.state.bets, watch: { state: "live" }, hours: frogState },
      },
    });
    const settled = [st.s, ...Object.values(idx.state)].every((s) => s.state === "live" || s.state === "off");
    this.#cache = { at: this.#now(), ttl: settled ? 5 * 60_000 : 30_000, boards };
    return boards;
  }
}
