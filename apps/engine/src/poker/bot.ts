import { type Card, rankOf, suitOf } from "./cards.js";
import { evaluate } from "./evaluate.js";
import type { Action, Legal, Street } from "./hand.js";

/**
 * Frog #7 at the poker table (practice, the house exhibition, the house seats at free tables). It
 * sees exactly what a player in its seat sees: its own two cards, the board, the pot, the stacks and
 * the bets. It never reads the deck or another hand (the tables pass it this view and nothing more).
 *
 * Before the flop: Bill Chen's formula for the two cards, tighter with more players left to act,
 * raising its good hands, calling its fair ones, folding the rest; short-stacked (12 big blinds or
 * less) it moves all-in or folds. After the flop: its equity against random hands for each player
 * still in (a quick Monte Carlo), against the pot odds; value bets of half to three quarters of the
 * pot, a raise now and then with a strong hand, and a bluff or a float from time to time so it is
 * not an open book.
 */
export type BotView = {
  hole: [Card, Card]; board: Card[]; street: Street;
  pot: number; bet: number; stack: number; currentBet: number; bb: number;
  /** Players still in the hand besides the bot. */
  opponents: number;
  legal: Legal;
};

/** Bill Chen's points for two hole cards (−1 to 20). */
export function chen(hole: [Card, Card]): number {
  const [hi, lo] = [Math.max(rankOf(hole[0]), rankOf(hole[1])), Math.min(rankOf(hole[0]), rankOf(hole[1]))];
  const base = (r: number) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  let s = base(hi);
  if (hi === lo) return Math.ceil(Math.max(5, s * 2));
  if (suitOf(hole[0]) === suitOf(hole[1])) s += 2;
  const gap = hi - lo - 1;
  s -= gap <= 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 10) s += 1;
  return Math.ceil(s);
}

/** The bot's share of the pot against `opponents` random hands, by `runs` random run-outs. */
export function equity(hole: [Card, Card], board: Card[], opponents: number, random: () => number, runs = 220): number {
  const known = new Set([...hole, ...board]);
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !known.has(c));
  let score = 0;
  for (let r = 0; r < runs; r++) {
    const d = [...rest];
    const need = 5 - board.length + 2 * opponents;
    for (let i = 0; i < need; i++) { const j = i + Math.floor(random() * (d.length - i)); [d[i], d[j]] = [d[j]!, d[i]!]; }
    const full = [...board, ...d.slice(0, 5 - board.length)];
    const mine = evaluate([...hole, ...full]).score;
    let ties = 0, lost = false;
    for (let o = 0; o < opponents; o++) {
      const at = 5 - board.length + 2 * o, s = evaluate([d[at]!, d[at + 1]!, ...full]).score;
      if (s > mine) { lost = true; break; }
      if (s === mine) ties++;
    }
    if (!lost) score += 1 / (ties + 1);
  }
  return score / runs;
}

/** A size as a person would put it: a whole number of small blinds, within what is allowed. */
const clampTo = (l: Legal, to: number, step = 1) => {
  if (!l.raise) return null;
  const t = Math.round(to / step) * step;
  return t >= l.raise.max ? l.raise.max : Math.max(l.raise.min, t);
};
const raiseOr = (l: Legal, to: number, fallback: Action, step = 1): Action => {
  const t = clampTo(l, to, step);
  return t === null ? fallback : { kind: "raise", to: t };
};
const passive = (l: Legal): Action => (l.check ? { kind: "check" } : { kind: "call" });
const giveUp = (l: Legal): Action => (l.check ? { kind: "check" } : { kind: "fold" });

export function botAction(v: BotView, random: () => number = Math.random): Action {
  const l = v.legal, owe = l.call, effective = (v.stack + v.bet) / v.bb;
  const sized = (to: number, fallback: Action) => raiseOr(l, to, fallback, Math.max(1, Math.round(v.bb / 2)));
  if (v.street === "preflop") {
    const c = chen(v.hole), tight = v.opponents <= 1 ? 0 : v.opponents <= 3 ? 2 : 3;
    // short-stacked: all-in or out
    if (effective <= 12) {
      if (c >= 7 + tight - (effective <= 6 ? 2 : 0)) return l.raise ? { kind: "raise", to: l.raise.max } : passive(l);
      return l.check ? { kind: "check" } : owe <= v.bb / 2 && c >= 4 ? { kind: "call" } : { kind: "fold" };
    }
    const facing = v.currentBet > v.bb;
    if (!facing) {
      if (c >= 8 + tight || (c >= 6 + tight && random() < 0.35)) return sized(v.currentBet + v.bb * (2 + random()), passive(l));
      if (l.check) return { kind: "check" };
      return c >= 4 + tight || (owe <= v.bb / 2 && c >= 3) ? { kind: "call" } : { kind: "fold" };
    }
    // facing a raise: how big it is against the bot's stack
    const share = owe / Math.max(1, v.stack);
    if (c >= 12 || (c >= 10 && random() < 0.5)) return sized(v.currentBet * 3, { kind: "call" });
    if (c >= 8 + tight && share <= 0.3) return { kind: "call" };
    if (c >= 6 && share <= 0.08 && random() < 0.5) return { kind: "call" };
    return giveUp(l);
  }
  const eq = equity(v.hole, v.board, Math.max(1, v.opponents), random, v.opponents > 2 ? 140 : 220);
  const pot = v.pot, river = v.street === "river";
  if (owe === 0) {
    if (eq > 0.72) return sized(pot * (0.6 + random() * 0.2), { kind: "check" });
    if (eq > 0.52 && random() < 0.55) return sized(pot * 0.5, { kind: "check" });
    // a bluff now and then, more on the river when nobody showed strength
    if (random() < (river ? 0.14 : 0.08) && v.opponents <= 2) return sized(pot * 0.5, { kind: "check" });
    return { kind: "check" };
  }
  const odds = owe / (pot + owe);
  if (eq > 0.8 && random() < 0.4) return sized(v.currentBet * 2.5 + pot * 0.2, { kind: "call" });
  if (eq >= odds + 0.04) return { kind: "call" };
  // a float on the flop against a small bet, rarely
  if (v.street === "flop" && odds < 0.25 && random() < 0.1) return { kind: "call" };
  return { kind: "fold" };
}

/** How long the frog thinks before acting, like a person: quick on easy spots, longer on big ones. */
export function thinkMs(v: Pick<BotView, "street" | "legal" | "pot" | "bb">, random: () => number = Math.random): number {
  const big = v.legal.call > v.pot * 0.5 || v.legal.call > v.bb * 10;
  const base = v.street === "preflop" ? 700 + random() * 1_300 : 1_100 + random() * 2_200;
  return Math.round(base * (big ? 1.6 : 1));
}
