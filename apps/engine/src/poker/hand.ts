import type { Card } from "./cards.js";
import { dealPlan } from "./deck.js";
import { evaluate } from "./evaluate.js";

/**
 * One hand of No-Limit Texas Hold'em for two to six seats, decided here and nowhere else: the
 * blinds, the betting rounds, side pots, the showdown and the split, from a deck the table derived
 * (deck.ts). Pure and deterministic: the tables (poker.ts, poker/ring.ts) hold the clocks, the
 * players' streams and the money; tests play hands straight on this class.
 *
 * The rules, as most card rooms and the TDA apply them:
 * - Heads-up the button posts the small blind and acts first before the flop, last after it. With
 *   three or more the small blind is the seat after the button, the big blind the next; the seat
 *   after the big blind acts first before the flop, the first seat after the button after it.
 * - A short blind posts what it has (all-in); the others still call the full big blind.
 * - A bet or raise is at least the big blind, and a raise at least the last full raise of the
 *   round. An all-in for less is allowed but does not reopen the betting: a player who already
 *   acted may then only call or fold, unless the raises since their action add up to a full raise.
 * - A bet nobody called goes back to its bettor. Side pots: each level of what the players still in
 *   put in is a pot for those who matched it. Ties split; an odd chip goes to the first winner
 *   after the button.
 * - When at most one player can still bet, the rest of the board is dealt and the hands are shown.
 */
export type Street = "preflop" | "flop" | "turn" | "river";
export const STREETS: Street[] = ["preflop", "flop", "turn", "river"];
export type Seated = { seat: number; stack: number };
export type HandPlayer = {
  seat: number; stack: number;
  /** In front of the player this round, and in all this hand. */
  bet: number; total: number;
  hole: [Card, Card]; folded: boolean; allIn: boolean;
  /** The bet they last acted on this round (null: not acted yet); a raise reopens for them only once it is a full raise above it. */
  acted: number | null;
};
export type ActionKind = "fold" | "check" | "call" | "raise";
export type Action = { kind: ActionKind; to?: number };
export type LogLine = { street: Street; seat: number; kind: "sb" | "bb" | "fold" | "check" | "call" | "bet" | "raise"; amount: number; to: number; allIn: boolean };
export type Pot = { amount: number; eligible: number[]; winners: number[]; hand: string | null };
export type Result = {
  pots: Pot[];
  /** Chips each seat won (pots only; an uncalled bet is listed apart). */
  won: Record<number, number>;
  uncalled: { seat: number; amount: number } | null;
  /** Seats whose cards were shown (every hand still in at a showdown). */
  shown: number[];
  hands: Record<number, { name: string; best: Card[]; category: number }>;
  showdown: boolean;
};
export type Legal = { fold: boolean; check: boolean; call: number; raise: { min: number; max: number } | null; allIn: number };

export class PokerError extends Error { readonly status = 409; }

export class Hand {
  readonly n: number; readonly button: number; readonly sb: number; readonly bb: number;
  readonly sbSeat: number; readonly bbSeat: number;
  readonly players: HandPlayer[];
  readonly deck: readonly Card[];
  board: Card[] = [];
  street: Street | "done" = "preflop";
  /** The index (in players) of whoever acts now, or null between rounds and once the hand is over. */
  toAct: number | null = null;
  currentBet = 0; minRaise = 0;
  log: LogLine[] = [];
  result: Result | null = null;
  /** The street on which the betting closed with players all-in (the rest of the board ran out), or null. */
  runout: Street | null = null;
  readonly #plan: ReturnType<typeof dealPlan>;

  constructor(o: { n: number; seats: Seated[]; button: number; sb: number; bb: number; deck: readonly Card[] }) {
    const seats = [...o.seats].filter((s) => s.stack > 0).sort((a, b) => a.seat - b.seat);
    if (seats.length < 2 || seats.length > 10) throw new Error("A hand needs two to ten players with chips");
    if (!seats.some((s) => s.seat === o.button)) throw new Error("The button must be on a dealt seat");
    if (!(o.sb > 0 && o.bb >= o.sb) || o.deck.length !== 52) throw new Error("Bad blinds or deck");
    this.n = o.n; this.button = o.button; this.sb = o.sb; this.bb = o.bb; this.deck = o.deck;
    this.#plan = dealPlan(seats.length);
    const order = this.#from(seats.map((s) => s.seat), o.button, false);
    this.players = seats.map((s) => {
      const i = order.indexOf(s.seat), [a, b] = this.#plan.hole[i]!;
      return { seat: s.seat, stack: s.stack, bet: 0, total: 0, hole: [o.deck[a]!, o.deck[b]!], folded: false, allIn: false, acted: null };
    });
    const heads = seats.length === 2;
    this.sbSeat = heads ? o.button : this.#next(o.button);
    this.bbSeat = this.#next(this.sbSeat);
    this.#post(this.sbSeat, o.sb, "sb");
    this.#post(this.bbSeat, o.bb, "bb");
    this.currentBet = o.bb; this.minRaise = o.bb;
    // heads-up the button (small blind) opens; else the seat after the big blind
    this.toAct = this.#index(heads ? this.sbSeat : this.#next(this.bbSeat));
    this.#progress(true);
  }

  // ---- seats in table order
  /** Seats in order starting after (or at, `inclusive`) `seat`. */
  #from(seats: number[], seat: number, inclusive: boolean): number[] {
    const s = [...seats].sort((a, b) => a - b), i = s.findIndex((x) => (inclusive ? x >= seat : x > seat));
    return i < 0 ? s : [...s.slice(i), ...s.slice(0, i)];
  }
  #next(seat: number): number { return this.#from(this.players?.map((p) => p.seat) ?? [], seat, false)[0]!; }
  #index(seat: number): number { return this.players.findIndex((p) => p.seat === seat); }
  player(seat: number): HandPlayer | undefined { return this.players.find((p) => p.seat === seat); }
  /** Players still in (not folded), in order from the first seat after the button. */
  inHand(): HandPlayer[] { return this.#from(this.players.map((p) => p.seat), this.button, false).map((s) => this.player(s)!).filter((p) => !p.folded); }
  #active() { return this.players.filter((p) => !p.folded && !p.allIn); }
  /** All chips in the middle: what went in on earlier rounds and what is in front of the players now. */
  pot(): number { return this.players.reduce((n, p) => n + p.total, 0); }

  #post(seat: number, amount: number, kind: "sb" | "bb") {
    const p = this.player(seat)!, put = Math.min(amount, p.stack);
    p.stack -= put; p.bet += put; p.total += put; if (!p.stack) p.allIn = true;
    this.log.push({ street: "preflop", seat, kind, amount: put, to: p.bet, allIn: p.allIn });
  }

  /** What the player to act may do now. */
  legal(): Legal | null {
    if (this.toAct === null || this.street === "done") return null;
    const p = this.players[this.toAct]!, owe = Math.max(0, this.currentBet - p.bet), call = Math.min(owe, p.stack);
    const others = this.#active().filter((x) => x !== p).length;
    // a raise needs chips past the call, someone left to call it, and the betting open to this player
    const open = p.acted === null || this.currentBet - p.acted >= this.minRaise;
    const max = p.bet + p.stack, min = Math.min(max, this.currentBet + this.minRaise);
    const raise = p.stack > owe && others > 0 && open ? { min, max } : null;
    return { fold: true, check: owe === 0, call: owe > 0 ? call : 0, raise, allIn: max };
  }

  /** The player to act (by seat) does this. Anything not allowed throws, and nothing changes. */
  act(seat: number, a: Action): void {
    const l = this.legal();
    if (!l || this.toAct === null) throw new PokerError("The hand is not waiting for an action.");
    const p = this.players[this.toAct]!;
    if (p.seat !== seat) throw new PokerError("It is not your turn.");
    const street = this.street as Street;
    const line = (kind: LogLine["kind"], amount: number) => this.log.push({ street, seat, kind, amount, to: p.bet, allIn: p.allIn });
    if (a.kind === "fold") { p.folded = true; line("fold", 0); }
    else if (a.kind === "check") {
      if (!l.check) throw new PokerError(`You cannot check: ${l.call} to call.`);
      p.acted = this.currentBet; line("check", 0);
    } else if (a.kind === "call") {
      if (!l.call) throw new PokerError("There is nothing to call: check.");
      this.#put(p, l.call); p.acted = this.currentBet; line("call", l.call);
    } else if (a.kind === "raise") {
      if (!l.raise) throw new PokerError(l.call ? "You may only call or fold." : "You cannot raise now.");
      const to = Math.floor(Number(a.to));
      if (!Number.isFinite(to) || to > l.raise.max || (to < l.raise.min && to !== l.raise.max) || to <= this.currentBet) {
        throw new PokerError(`Raise to between ${l.raise.min} and ${l.raise.max}${l.raise.min === l.raise.max ? "" : " (or all-in)"}.`);
      }
      const bet = this.currentBet === 0, added = to - p.bet, increment = to - this.currentBet;
      this.#put(p, added);
      // a full raise sets the next minimum; an all-in for less does not (and reopens for nobody)
      if (increment >= this.minRaise) this.minRaise = increment;
      this.currentBet = to; p.acted = to;
      line(bet ? "bet" : "raise", added);
    } else throw new PokerError("Fold, check, call or raise.");
    this.#progress(false);
  }
  #put(p: HandPlayer, n: number) { p.stack -= n; p.bet += n; p.total += n; if (!p.stack) p.allIn = true; }

  /** The round is over when nobody still able to bet owes anything or has yet to act. */
  #roundDone(): boolean {
    const live = this.players.filter((p) => !p.folded), active = live.filter((p) => !p.allIn);
    if (active.length === 0) return true;
    const most = Math.max(...live.map((p) => p.bet));
    if (active.length === 1 && active[0]!.bet >= most) return true;
    return active.every((p) => p.acted !== null && p.bet === this.currentBet);
  }
  #needs(p: HandPlayer) { return !p.folded && !p.allIn && (p.acted === null || p.bet < this.currentBet); }

  #progress(first: boolean): void {
    for (;;) {
      if (this.players.filter((p) => !p.folded).length === 1) return this.#finish(false);
      if (!this.#roundDone()) {
        if (first && this.toAct !== null && this.#needs(this.players[this.toAct]!)) return;
        // the next seat after the one who just acted (or the opener) that still owes an action
        const start = this.toAct ?? this.#index(this.button);
        for (let k = first ? 0 : 1; k <= this.players.length; k++) {
          const i = (start + k) % this.players.length;
          if (this.#needs(this.players[i]!)) { this.toAct = i; return; }
        }
        throw new Error("No player to act on an open round");
      }
      // the round is over: the next street, or the run-out and the showdown
      const able = this.#active().length;
      if (this.street === "river") return this.#finish(true);
      if (able <= 1 && this.runout === null) this.runout = this.street as Street;
      this.#deal();
      first = true;
      this.toAct = this.runout === null ? this.#index(this.#from(this.#active().map((p) => p.seat), this.button, false)[0]!) : null;
      if (this.runout !== null) return this.#finish(true);
    }
  }
  #deal(): void {
    for (const p of this.players) { p.bet = 0; p.acted = null; }
    this.currentBet = 0; this.minRaise = this.bb;
    const plan = this.#plan;
    if (this.street === "preflop") { this.board = plan.flop.map((i) => this.deck[i]!); this.street = "flop"; }
    else if (this.street === "flop") { this.board = [...this.board, this.deck[plan.turn]!]; this.street = "turn"; }
    else if (this.street === "turn") { this.board = [...this.board, this.deck[plan.river]!]; this.street = "river"; }
  }

  /** The hand is over: the uncalled bet back, the pots built, judged and paid. */
  #finish(showdown: boolean): void {
    this.toAct = null;
    if (showdown) while (this.board.length < 5) this.#deal();
    for (const p of this.players) p.bet = 0;
    // a bet nobody matched goes back to its bettor
    let uncalled: Result["uncalled"] = null;
    const top = Math.max(...this.players.map((p) => p.total)), holders = this.players.filter((p) => p.total === top);
    if (holders.length === 1) {
      const second = Math.max(0, ...this.players.filter((p) => p !== holders[0]).map((p) => p.total)), back = top - second, h = holders[0]!;
      if (back > 0) { h.total -= back; h.stack += back; uncalled = { seat: h.seat, amount: back }; }
    }
    const pots = this.pots(), live = this.inHand();
    const hands: Result["hands"] = {};
    if (showdown) for (const p of live) { const e = evaluate([...p.hole, ...this.board]); hands[p.seat] = { name: e.name, best: e.best, category: e.category }; }
    const scores = new Map(live.map((p) => [p.seat, showdown ? evaluate([...p.hole, ...this.board]).score : 0]));
    const won: Record<number, number> = {};
    // the order an odd chip goes in: the first seat after the button
    const order = this.#from(this.players.map((p) => p.seat), this.button, false);
    for (const pot of pots) {
      const best = Math.max(...pot.eligible.map((s) => scores.get(s) ?? -1));
      pot.winners = pot.eligible.filter((s) => scores.get(s) === best).sort((a, b) => order.indexOf(a) - order.indexOf(b));
      pot.hand = showdown && pot.eligible.length > 1 ? hands[pot.winners[0]!]?.name ?? null : null;
      const share = Math.floor(pot.amount / pot.winners.length);
      let odd = pot.amount - share * pot.winners.length;
      for (const s of pot.winners) { const n = share + (odd > 0 ? 1 : 0); if (odd > 0) odd--; won[s] = (won[s] ?? 0) + n; this.player(s)!.stack += n; }
    }
    this.result = { pots, won, uncalled, shown: showdown ? live.map((p) => p.seat) : [], hands, showdown };
    this.street = "done";
  }

  /**
   * The pots from what each player put in: one per level of what the players still in committed,
   * open to those who matched it (the folded players' chips are in them, their claim is not).
   * Neighbouring pots open to the same players are one pot.
   */
  pots(): Pot[] {
    const live = this.players.filter((p) => !p.folded), levels = [...new Set(live.map((p) => p.total))].sort((a, b) => a - b);
    const pots: Pot[] = [];
    let prev = 0;
    for (const level of levels) {
      const amount = this.players.reduce((n, p) => n + Math.min(p.total, level) - Math.min(p.total, prev), 0);
      const eligible = live.filter((p) => p.total >= level).map((p) => p.seat);
      const last = pots.at(-1);
      if (amount > 0) { if (last && last.eligible.join() === eligible.join()) last.amount += amount; else pots.push({ amount, eligible, winners: [], hand: null }); }
      prev = level;
    }
    // chips above the last level (none: the most anyone put in belongs to a player still in) stay in the last pot
    const rest = this.pot() - pots.reduce((n, p) => n + p.amount, 0);
    if (rest > 0 && pots.length) pots.at(-1)!.amount += rest;
    return pots;
  }
}
