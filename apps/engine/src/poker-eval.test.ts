import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { type Card, cardText, parseCards } from "./poker/cards.js";
import { CATEGORIES, evaluate } from "./poker/evaluate.js";

// pokersolver (MIT, goldfire/pokersolver 2.1.4): a test-only oracle, never shipped
const { Hand: Solver } = createRequire(import.meta.url)("pokersolver") as { Hand: { solve(cards: string[]): { name: string; descr: string }; winners(h: unknown[]): unknown[] } };
const ORACLE: Record<string, number> = { "High Card": 0, Pair: 1, "Two Pair": 2, "Three of a Kind": 3, Straight: 4, Flush: 5, "Full House": 6, "Four of a Kind": 7, "Straight Flush": 8, "Royal Flush": 8 };

const ev = (s: string) => evaluate(parseCards(s));
const cat = (s: string) => CATEGORIES[ev(s).category];
/** Compares two hole-card pairs on one board: 1 when the first wins, -1 when the second does, 0 for a split. */
const duel = (a: string, b: string, board: string) => Math.sign(ev(`${a} ${board}`).score - ev(`${b} ${board}`).score);

/** A small seeded random source, so a failing deal can be replayed. */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296; }; }
function deal(r: () => number, n: number): Card[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [deck[i], deck[j]] = [deck[j]!, deck[i]!]; }
  return deck.slice(0, n);
}

describe("the hand evaluator", () => {
  it("names every category from the best five of seven cards", () => {
    expect(ev("Ah Kh Qh Jh Th 2c 3d")).toMatchObject({ category: 8, name: "Royal flush" });
    expect(ev("9s 8s 7s 6s 5s As Ks")).toMatchObject({ category: 8, name: "Straight flush, nine high" });
    expect(ev("Qd Qc Qh Qs 2d 3c Kd")).toMatchObject({ category: 7, name: "Four of a kind, queens" });
    expect(ev("Kd Kc Kh 7s 7d 2c 3h")).toMatchObject({ category: 6, name: "Full house, kings over sevens" });
    expect(ev("Ad 9d 7d 4d 2d Kc Qs")).toMatchObject({ category: 5, name: "Flush, ace high" });
    expect(ev("Td 9c 8h 7s 6d 2c 2h")).toMatchObject({ category: 4, name: "Straight, ten high" });
    expect(ev("5c 5d 5h Ks 9d 2c 3h")).toMatchObject({ category: 3, name: "Three of a kind, fives" });
    expect(ev("Ac Ad 8h 8s 9d 2c 3h")).toMatchObject({ category: 2, name: "Two pair, aces and eights" });
    expect(ev("6c 6d Ah Ks 9d 2c 3h")).toMatchObject({ category: 1, name: "Pair of sixes" });
    expect(ev("Kc Jd 9h 7s 4d 3c 2h")).toMatchObject({ category: 0, name: "High card, king" });
  });
  it("plays the wheel as a five-high straight, below a six-high one, and the ace high above king-high", () => {
    expect(ev("Ac 2d 3h 4s 5d Kc Kh")).toMatchObject({ category: 4, name: "Straight, five high" });
    expect(ev("Ah 2h 3h 4h 5h Kc Qd")).toMatchObject({ category: 8, name: "Straight flush, five high" });
    expect(Math.sign(ev("2c 3d 4h 5s 6d Kc Jh").score - ev("Ac 2d 3h 4s 5d Kc Jh").score)).toBe(1);
    expect(Math.sign(ev("Ac Kd Qh Js Td 2c 3h").score - ev("Kc Qd Jh Ts 9d 2c 3h").score)).toBe(1);
    // no wrap-around: Q K A 2 3 is no straight
    expect(ev("Qc Kd Ah 2s 3d 8c 9h").category).toBe(0);
    // the best five of the wheel's cards with a six: six high
    expect(ev("Ac 2d 3h 4s 5d 6c Kh").name).toBe("Straight, six high");
  });
  it("picks the right five: the higher trips in two sets, the best pair beside a set, the top flush cards", () => {
    expect(ev("9c 9d 9h 4s 4d 4c Ah").name).toBe("Full house, nines over fours");
    expect(ev("9c 9d 9h 4s 4d Kc Kh").name).toBe("Full house, nines over kings");
    const f = ev("Ah Kh 9h 7h 4h 3h 2h");
    expect(f.best.map(cardText)).toEqual(["Ah", "Kh", "9h", "7h", "4h"]);
    // quads with the best kicker even when a pair is on the board
    expect(ev("8c 8d 8h 8s Ad Kc Kh").best.map(cardText)).toContain("Ad");
    // three pairs: the third pair's card can be the kicker
    expect(ev("Ac Ad Kh Ks Qd Qc 2h").best.map((c) => cardText(c)[0])).toEqual(["A", "A", "K", "K", "Q"]);
    expect(ev("Ac Ad Kh Ks Qd Qc 2h").score).toBe(ev("Ac Ad Kh Ks Qd 2c 3h").score);
    // a straight flush beats the bigger plain straight around it
    expect(ev("8h 7h 6h 5h 4h 9c Tc").category).toBe(8);
  });
  it("splits by kickers, and splits exactly when the board plays", () => {
    expect(duel("As Kd", "Ac Qd", "Ah 7c 5d 3s 2c")).toBe(1); // top pair, king kicker
    expect(duel("As 9d", "Ac 8d", "Ah Kc Qd 5s 2c")).toBe(1); // the fifth card decides
    expect(duel("As 4d", "Ac 3d", "Ah Kc Qd Js 9c")).toBe(0); // both play A A K Q J
    expect(duel("2s 3d", "4c 5d", "Ah Kc Qd Jd Tc")).toBe(0); // the board is the straight
    expect(duel("2s 3d", "Ad 5h", "Ac Ah Kc Kd Qs")).toBe(-1); // full house beats two pair
    expect(duel("Kc Kd", "Ac Ah", "Ks Qh Jd 3c 2s")).toBe(1); // a set beats a bigger pair
    expect(duel("7h 6h", "Ah 2h", "Kh Qh 3h 9c 9d")).toBe(-1); // the higher flush (ace)
    expect(duel("7h 6h", "Ah 2c", "Kh Qh 3h 9c 9d")).toBe(1); // four hearts are no flush
    expect(duel("Th 2c", "9h 8h", "Kh Qh 3h 4h 7d")).toBe(1); // ten-high flush beats nine-high
    expect(duel("Ac Kc", "Ad Kd", "2h 2s 7c 7d 9h")).toBe(0); // same two pair, same kicker
    expect(duel("Qc Jc", "Qd 3d", "Qh Qs 7c 7d Ah")).toBe(0); // full house on queens and sevens either way
    expect(duel("8c 8d", "6c 6d", "8h 6h 5s 2c 2d")).toBe(1); // eights full beats sixes full
    expect(duel("8c 8d", "6c 6d", "8h 6h 6s 2c 2d")).toBe(-1); // four sixes beat eights full
  });
  it("refuses anything that is not five to seven different cards", () => {
    expect(() => evaluate(parseCards("Ah Kh Qh Jh"))).toThrow();
    expect(() => evaluate(parseCards("Ah Ah Qh Jh Th"))).toThrow();
  });
  it("agrees with pokersolver on 20,000 random seven-card deals, both the category and who wins", () => {
    const r = rng(7);
    for (let i = 0; i < 20_000; i++) {
      const c = deal(r, 9), board = c.slice(4), a = [c[0]!, c[1]!, ...board], b = [c[2]!, c[3]!, ...board];
      const sa = Solver.solve(a.map(cardText)), sb = Solver.solve(b.map(cardText));
      const ea = evaluate(a), eb = evaluate(b);
      expect(ea.category, `${a.map(cardText).join(" ")}: ${sa.name}`).toBe(ORACLE[sa.name]);
      expect(eb.category).toBe(ORACLE[sb.name]);
      const w = Solver.winners([sa, sb]);
      const oracle = w.length === 2 ? 0 : w[0] === sa ? 1 : -1;
      expect(Math.sign(ea.score - eb.score), `${a.map(cardText).join(" ")} vs ${b.map(cardText).join(" ")}`).toBe(oracle);
    }
  }, 60_000);
  it("agrees with pokersolver on 3,000 boards with many flushes and straights", () => {
    // decks thinned to two suits and seven ranks: flushes, straights and their ties come often
    const r = rng(11), pool = parseCards("9h Th Jh Qh Kh Ah 8h 9s Ts Js Qs Ks As 8s 2h 2s");
    for (let i = 0; i < 3_000; i++) {
      const d = [...pool];
      for (let k = d.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [d[k], d[j]] = [d[j]!, d[k]!]; }
      const board = d.slice(4, 9), a = [d[0]!, d[1]!, ...board], b = [d[2]!, d[3]!, ...board];
      const sa = Solver.solve(a.map(cardText)), sb = Solver.solve(b.map(cardText)), w = Solver.winners([sa, sb]);
      expect(evaluate(a).category).toBe(ORACLE[sa.name]);
      expect(Math.sign(evaluate(a).score - evaluate(b).score), `${a.map(cardText).join(" ")} vs ${b.map(cardText).join(" ")}`).toBe(w.length === 2 ? 0 : w[0] === sa ? 1 : -1);
    }
  }, 60_000);
});
