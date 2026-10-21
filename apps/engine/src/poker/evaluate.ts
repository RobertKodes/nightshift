import { type Card, rankOf, suitOf } from "./cards.js";

/**
 * The best five-card hand out of five to seven cards (two hole cards and the board). Written here,
 * not taken from a package: it is small, and it is checked against pokersolver (MIT, a test-only
 * dependency) over random hands in poker-eval.test.ts, plus every category, kicker and tie by hand.
 *
 * The score orders hands exactly: the category times 16^5, then up to five ranks (0 = deuce …
 * 12 = ace) in order of importance. Equal scores split the pot. The wheel (A-2-3-4-5) is a
 * five-high straight; the ace counts low only there.
 */
export const CATEGORIES = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"] as const;
export type Evaluation = { score: number; category: number; best: Card[]; name: string };

const NAMES = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "jack", "queen", "king", "ace"];
const many = (r: number) => (r === 4 ? "sixes" : `${NAMES[r]}s`);
const pack = (category: number, ranks: number[]) => ranks.reduce((s, r, i) => s + r * 16 ** (4 - i), category * 16 ** 5);

/** The top rank of the best straight in a 13-bit rank mask (3 for the wheel), or -1. */
export function straightTop(mask: number): number {
  for (let t = 12; t >= 4; t--) if (((mask >> (t - 4)) & 0x1f) === 0x1f) return t;
  return (mask & 0xf) === 0xf && mask & (1 << 12) ? 3 : -1;
}
const straightRanks = (top: number) => (top === 3 ? [3, 2, 1, 0, 12] : [top, top - 1, top - 2, top - 3, top - 4]);

export function evaluate(cards: readonly Card[]): Evaluation {
  if (cards.length < 5 || cards.length > 7 || new Set(cards).size !== cards.length) throw new Error("A hand is five to seven different cards");
  const byRank: Card[][] = Array.from({ length: 13 }, () => []), bySuit: Card[][] = [[], [], [], []];
  for (const c of cards) { byRank[rankOf(c)]!.push(c); bySuit[suitOf(c)]!.push(c); }
  const desc = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
  const make = (category: number, ranks: number[], best: Card[], name: string): Evaluation => ({ score: pack(category, ranks), category, best, name });
  // cards of the same suit sort by rank when sorted by number
  const flush = bySuit.find((s) => s.length >= 5)?.slice().sort((a, b) => b - a) ?? null;
  if (flush) {
    const top = straightTop(flush.reduce((m, c) => m | (1 << rankOf(c)), 0));
    if (top >= 0) return make(8, [top], straightRanks(top).map((r) => flush.find((c) => rankOf(c) === r)!), top === 12 ? "Royal flush" : `Straight flush, ${NAMES[top]} high`);
  }
  const quads = desc.filter((r) => byRank[r]!.length === 4), trips = desc.filter((r) => byRank[r]!.length === 3), pairs = desc.filter((r) => byRank[r]!.length === 2);
  /** The highest ranks present other than `not`, n of them, with one card each. */
  const kickers = (not: number[], n: number) => desc.filter((r) => byRank[r]!.length && !not.includes(r)).slice(0, n);
  if (quads.length) {
    const q = quads[0]!, [k] = kickers([q], 1) as [number];
    return make(7, [q, k], [...byRank[q]!, byRank[k]![0]!], `Four of a kind, ${many(q)}`);
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0]!, p = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return make(6, [t, p], [...byRank[t]!, ...byRank[p]!.slice(0, 2)], `Full house, ${many(t)} over ${many(p)}`);
  }
  if (flush) {
    const best = flush.slice(0, 5);
    return make(5, best.map(rankOf), best, `Flush, ${NAMES[rankOf(best[0]!)]} high`);
  }
  const top = straightTop(cards.reduce((m, c) => m | (1 << rankOf(c)), 0));
  if (top >= 0) return make(4, [top], straightRanks(top).map((r) => byRank[r]![0]!), `Straight, ${NAMES[top]} high`);
  if (trips.length) {
    const t = trips[0]!, ks = kickers([t], 2);
    return make(3, [t, ...ks], [...byRank[t]!, ...ks.map((r) => byRank[r]![0]!)], `Three of a kind, ${many(t)}`);
  }
  if (pairs.length >= 2) {
    const [a, b] = pairs as [number, number], ks = kickers([a, b], 1);
    return make(2, [a, b, ...ks], [...byRank[a]!, ...byRank[b]!, ...ks.map((r) => byRank[r]![0]!)], `Two pair, ${many(a)} and ${many(b)}`);
  }
  if (pairs.length) {
    const p = pairs[0]!, ks = kickers([p], 3);
    return make(1, [p, ...ks], [...byRank[p]!, ...ks.map((r) => byRank[r]![0]!)], `Pair of ${many(p)}`);
  }
  const ks = kickers([], 5);
  return make(0, ks, ks.map((r) => byRank[r]![0]!), `High card, ${NAMES[ks[0]!]}`);
}
