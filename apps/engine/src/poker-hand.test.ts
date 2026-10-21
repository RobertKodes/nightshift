import { describe, expect, it } from "vitest";
import { type Card, parseCards } from "./poker/cards.js";
import { dealPlan, deckOrder } from "./poker/deck.js";
import { evaluate } from "./poker/evaluate.js";
import { Hand } from "./poker/hand.js";

/**
 * A deck with these hole cards (by seat, given as "As Kd") and this board, the rest in any order.
 * `buttonSeat` and `seats` say who sits where, so the hole cards land where dealPlan puts them.
 */
function rig(seats: number[], button: number, holes: Record<number, string>, board: string): Card[] {
  const order = [...seats.filter((s) => s > button), ...seats.filter((s) => s <= button)];
  const plan = dealPlan(seats.length), deck: (Card | null)[] = Array.from({ length: 52 }, () => null);
  order.forEach((s, i) => { const [a, b] = parseCards(holes[s]!); deck[plan.hole[i]![0]] = a!; deck[plan.hole[i]![1]] = b!; });
  const b = parseCards(board);
  [...plan.flop, plan.turn, plan.river].forEach((pos, i) => { deck[pos] = b[i]!; });
  const used = new Set(deck.filter((c) => c !== null));
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  return deck.map((c) => c ?? rest.shift()!);
}
const table = (stacks: number[], button = 0, sb = 10, bb = 20, deck = deckOrder("x".repeat(64), [], 1)) =>
  new Hand({ n: 1, seats: stacks.map((stack, seat) => ({ seat, stack })), button, sb, bb, deck });
const toActSeat = (h: Hand) => (h.toAct === null ? null : h.players[h.toAct]!.seat);
/** Every chip at the table: the stacks, and the pot while the hand is on. */
const chips = (h: Hand) => h.players.reduce((n, p) => n + p.stack, 0) + (h.street === "done" ? 0 : h.pot());

describe("blinds and the order of play", () => {
  it("heads-up: the button posts the small blind and acts first before the flop, last after it", () => {
    const h = table([1000, 1000], 1);
    expect(h.sbSeat).toBe(1); expect(h.bbSeat).toBe(0);
    expect(h.player(1)).toMatchObject({ bet: 10, stack: 990 }); expect(h.player(0)).toMatchObject({ bet: 20, stack: 980 });
    expect(toActSeat(h)).toBe(1);
    expect(h.legal()).toMatchObject({ check: false, call: 10, raise: { min: 40, max: 1000 } });
    h.act(1, { kind: "call" });
    // the big blind's option: check or raise
    expect(toActSeat(h)).toBe(0);
    expect(h.legal()).toMatchObject({ check: true, call: 0, raise: { min: 40, max: 1000 } });
    h.act(0, { kind: "check" });
    expect(h.street).toBe("flop"); expect(toActSeat(h)).toBe(0);
    h.act(0, { kind: "check" });
    expect(toActSeat(h)).toBe(1);
  });
  it("three or more: small blind after the button, big blind next, the seat after it opens; after the flop the first seat after the button", () => {
    const h = table([1000, 1000, 1000, 1000, 1000, 1000], 3);
    expect([h.sbSeat, h.bbSeat, toActSeat(h)]).toEqual([4, 5, 0]);
    for (const s of [0, 1, 2, 3, 4]) h.act(s, { kind: "call" });
    h.act(5, { kind: "check" });
    expect(h.street).toBe("flop"); expect(toActSeat(h)).toBe(4);
    // a folded small blind: the big blind opens the flop
    const g = table([1000, 1000, 1000], 0);
    expect([g.sbSeat, g.bbSeat, toActSeat(g)]).toEqual([1, 2, 0]);
    g.act(0, { kind: "call" }); g.act(1, { kind: "fold" }); g.act(2, { kind: "check" });
    expect(toActSeat(g)).toBe(2);
  });
  it("a short blind posts what it has; the others still call the full big blind", () => {
    const h = table([1000, 1000, 8], 0);
    expect(h.player(2)).toMatchObject({ bet: 8, allIn: true });
    expect(h.legal()).toMatchObject({ call: 20 });
    h.act(0, { kind: "call" }); h.act(1, { kind: "call" });
    expect(h.street).toBe("flop");
    expect(h.pots().map((p) => [p.amount, p.eligible])).toEqual([[24, [0, 1, 2]], [24, [0, 1]]]);
    // heads-up, a big blind all-in for less than the small blind: nothing to do, the board runs out
    const g = table([1000, 5], 0);
    expect(g.street).toBe("done");
    expect(g.result!.uncalled).toEqual({ seat: 0, amount: 5 });
    expect(chips(g)).toBe(1005);
  });
});

describe("bets and raises", () => {
  it("a bet is at least the big blind, a raise at least the last full raise; all-in is always allowed", () => {
    const h = table([1000, 1000, 1000], 0);
    expect(() => h.act(0, { kind: "raise", to: 30 })).toThrow(/between 40 and 1000/);
    expect(() => h.act(1, { kind: "call" })).toThrow(/not your turn/);
    h.act(0, { kind: "raise", to: 60 }); // a raise of 40
    expect(h.legal()).toMatchObject({ call: 50, raise: { min: 100, max: 1000 } });
    h.act(1, { kind: "raise", to: 160 }); // a raise of 100
    expect(h.legal()!.raise!.min).toBe(260);
    h.act(2, { kind: "fold" }); h.act(0, { kind: "call" });
    expect(h.street).toBe("flop");
    expect(h.legal()).toMatchObject({ check: true, raise: { min: 20, max: 840 } });
    expect(() => h.act(1, { kind: "raise", to: 19 })).toThrow();
    h.act(1, { kind: "raise", to: 50 });
    expect(h.log.at(-1)).toMatchObject({ kind: "bet", amount: 50 });
    expect(h.legal()!.raise!.min).toBe(100);
    h.act(0, { kind: "raise", to: 840 });
    expect(h.player(0)!.allIn).toBe(true);
    expect(h.legal()).toMatchObject({ call: 790, raise: null }); // nobody left to raise against
    expect(() => h.act(1, { kind: "check" })).toThrow(/790 to call/);
    h.act(1, { kind: "call" });
    expect(h.street).toBe("done");
    expect(chips(h)).toBe(3000);
  });
  it("an all-in for less than a full raise does not reopen the betting; raises adding up to a full one do", () => {
    // seats 0 small blind, 1 big blind, 2 opens with 150 behind, 3 on the button
    const g = table([1000, 1000, 150, 1000], 3);
    g.act(2, { kind: "call" }); g.act(3, { kind: "raise", to: 100 }); // a full raise of 80
    g.act(0, { kind: "call" }); g.act(1, { kind: "call" });
    expect(g.legal()).toMatchObject({ call: 80, raise: { min: 150, max: 150 } });
    g.act(2, { kind: "raise", to: 150 }); // all-in, a raise of 50: less than 80
    // seats 3, 0 and 1 acted on 100: 50 more is no full raise, so they may only call or fold
    for (const s of [3, 0, 1]) { expect(toActSeat(g)).toBe(s); expect(g.legal()).toMatchObject({ call: 50, raise: null }); g.act(s, { kind: "call" }); }
    expect(g.street).toBe("flop");
    expect(g.legal()!.raise).toEqual({ min: 20, max: 850 });
    // two short all-ins after a raise add up to a full raise: the raiser may raise again
    const m = table([2000, 2000, 2000, 150, 200, 2000], 5);
    m.act(2, { kind: "raise", to: 100 }); // a full raise of 80
    m.act(3, { kind: "raise", to: 150 }); // all-in, +50: incomplete
    m.act(4, { kind: "raise", to: 200 }); // all-in, +50 again: 100 above seat 2's action, a full raise in all
    m.act(5, { kind: "call" });
    expect(m.legal()).toMatchObject({ call: 190, raise: { min: 280, max: 2000 } }); // the small blind has not acted yet: open to raise
    m.act(0, { kind: "fold" }); m.act(1, { kind: "fold" });
    expect(toActSeat(m)).toBe(2);
    expect(m.legal()!.raise).toEqual({ min: 280, max: 2000 });
  });
  it("gives an uncalled bet back to its bettor", () => {
    const h = table([1000, 1000], 0);
    h.act(0, { kind: "raise", to: 300 }); h.act(1, { kind: "fold" });
    expect(h.result!.uncalled).toEqual({ seat: 0, amount: 280 });
    expect(h.result!.won).toEqual({ 0: 40 });
    expect(h.player(0)!.stack).toBe(1020);
  });
});

describe("side pots", () => {
  it("builds a pot per all-in level with three all-ins, and pays each to the best hand that matched it", () => {
    // seats 0..3 with 100, 300, 600, 1000; the shortest has the best hand, then seat 2, then seat 1
    const deck = rig([0, 1, 2, 3], 3, { 0: "Ac Ad", 1: "Kc Kd", 2: "Qc Qd", 3: "7h 2s" }, "As 9c 5d 3h 8s");
    const h = new Hand({ n: 1, seats: [100, 300, 600, 1000].map((stack, seat) => ({ seat, stack })), button: 3, sb: 10, bb: 20, deck });
    expect(toActSeat(h)).toBe(2);
    h.act(2, { kind: "raise", to: 600 }); h.act(3, { kind: "raise", to: 1000 });
    h.act(0, { kind: "call" }); h.act(1, { kind: "call" });
    const r = h.result!;
    expect(r.showdown).toBe(true);
    expect(r.uncalled).toEqual({ seat: 3, amount: 400 });
    expect(r.pots.map((p) => [p.amount, p.eligible, p.winners])).toEqual([[400, [0, 1, 2, 3], [0]], [600, [1, 2, 3], [1]], [600, [2, 3], [2]]]);
    expect(r.won).toEqual({ 0: 400, 1: 600, 2: 600 });
    expect(h.players.map((p) => p.stack)).toEqual([400, 600, 600, 400]);
    expect(r.shown).toEqual([0, 1, 2, 3]);
    expect(r.hands[0]!.name).toBe("Three of a kind, aces");
  });
  it("five all-in: four pots, a tie in a side pot with its odd chip to the first winner after the button", () => {
    const deck = rig([0, 1, 2, 3, 4], 4, { 0: "Jc Jd", 1: "Ah Kh", 2: "9c 9d", 3: "As Kd", 4: "Qc Tc" }, "2c 7d 9h Js 3s");
    const h = new Hand({ n: 1, seats: [55, 300, 155, 1000, 1000].map((stack, seat) => ({ seat, stack })), button: 4, sb: 10, bb: 20, deck });
    h.act(2, { kind: "raise", to: 155 }); h.act(3, { kind: "raise", to: 1000 }); h.act(4, { kind: "call" });
    h.act(0, { kind: "call" }); h.act(1, { kind: "call" });
    const r = h.result!;
    expect(h.runout).toBe("preflop");
    expect(r.uncalled).toBeNull(); // two players matched the most
    expect(r.pots.map((p) => [p.amount, p.eligible, p.winners])).toEqual([[275, [0, 1, 2, 3, 4], [0]], [400, [1, 2, 3, 4], [2]], [435, [1, 3, 4], [1, 3]], [1400, [3, 4], [3]]]);
    expect(r.won).toEqual({ 0: 275, 2: 400, 1: 218, 3: 1617 });
    expect(h.players.map((p) => p.stack)).toEqual([275, 218, 400, 1617, 0]);
    expect(r.pots.map((p) => p.hand)).toEqual(["Three of a kind, jacks", "Three of a kind, nines", "High card, ace", "High card, ace"]);
  });
  it("keeps folded chips in the pots but not their claim, after side pots were made", () => {
    // seat 0 all-in short; seats 1 and 2 bet on; seat 1 folds the turn: seat 2 takes the side pot, the main goes to the best of 0 and 2
    const deck = rig([0, 1, 2], 2, { 0: "Kc Kd", 1: "Ac Ad", 2: "Qc Jd" }, "2s 7c 9d 4h Th");
    const h = new Hand({ n: 1, seats: [{ seat: 0, stack: 100 }, { seat: 1, stack: 1000 }, { seat: 2, stack: 1000 }], button: 2, sb: 10, bb: 20, deck });
    h.act(2, { kind: "raise", to: 100 }); h.act(0, { kind: "call" }); h.act(1, { kind: "call" });
    expect(h.player(0)!.allIn).toBe(true);
    h.act(1, { kind: "check" }); h.act(2, { kind: "raise", to: 200 }); h.act(1, { kind: "call" }); // flop
    h.act(1, { kind: "check" }); h.act(2, { kind: "raise", to: 300 }); h.act(1, { kind: "fold" }); // turn
    const r = h.result!;
    expect(r.uncalled).toEqual({ seat: 2, amount: 300 });
    expect(r.pots.map((p) => [p.amount, p.eligible, p.winners])).toEqual([[300, [0, 2], [0]], [400, [2], [2]]]);
    expect(h.players.map((p) => p.stack)).toEqual([300, 700, 1100]);
    expect(r.shown).toEqual([0, 2]);
  });
  it("splits a tie and gives the odd chip to the first winner after the button", () => {
    // button 0: the small blind (seat 1) folds its 5, seats 2 and 0 both play the board's straight
    const h = new Hand({ n: 1, seats: [0, 1, 2].map((seat) => ({ seat, stack: 1000 })), button: 0, sb: 5, bb: 10, deck: rig([0, 1, 2], 0, { 1: "2c 3d", 2: "2d 3c", 0: "4h 4s" }, "Ah Kh Qd Js Tc") });
    h.act(0, { kind: "call" }); h.act(1, { kind: "fold" }); h.act(2, { kind: "check" });
    for (let s = 0; s < 3; s++) { h.act(2, { kind: "check" }); h.act(0, { kind: "check" }); }
    expect(h.result!.pots).toEqual([{ amount: 25, eligible: [0, 2], winners: [2, 0], hand: "Straight, ace high" }]);
    expect(h.result!.won).toEqual({ 2: 13, 0: 12 });
    expect(h.players.map((p) => p.stack)).toEqual([1002, 995, 1003]);
    // button 2: the small blind is seat 0 and folds; seat 1 is the first winner after the button
    const g = new Hand({ n: 2, seats: [0, 1, 2].map((seat) => ({ seat, stack: 1000 })), button: 2, sb: 5, bb: 10, deck: rig([0, 1, 2], 2, { 0: "2c 3d", 1: "2d 3c", 2: "4h 4s" }, "Ah Kh Qd Js Tc") });
    g.act(2, { kind: "call" }); g.act(0, { kind: "fold" }); g.act(1, { kind: "check" });
    for (let s = 0; s < 3; s++) { g.act(1, { kind: "check" }); g.act(2, { kind: "check" }); }
    expect(g.result!.won).toEqual({ 1: 13, 2: 12 });
  });
});

/** One random hand to the end: random legal actions, sizes from a min raise to all-in. */
function randomHand(r: () => number, n: number): { h: Hand; before: number[] } {
  const stacks = Array.from({ length: n }, () => (r() < 0.3 ? 1 + Math.floor(r() * 60) : 20 + Math.floor(r() * 3000)));
  const seats = stacks.map((stack, seat) => ({ seat, stack }));
  const h = new Hand({ n: 1, seats, button: Math.floor(r() * n), sb: 5 + Math.floor(r() * 2) * 5, bb: 20, deck: deckOrder(String(r()).padEnd(64, "0"), [], Math.floor(r() * 1e6)) });
  for (let guard = 0; h.street !== "done"; guard++) {
    if (guard > 400) throw new Error("the hand never ended");
    const l = h.legal()!, seat = h.players[h.toAct!]!.seat, x = r();
    if (x < 0.15) h.act(seat, { kind: "fold" });
    else if (x < 0.55) h.act(seat, l.check ? { kind: "check" } : { kind: "call" });
    else if (l.raise) h.act(seat, { kind: "raise", to: x < 0.75 ? l.raise.min : x < 0.9 ? l.raise.max : l.raise.min + Math.floor(r() * (l.raise.max - l.raise.min + 1)) });
    else h.act(seat, l.check ? { kind: "check" } : { kind: "call" });
  }
  return { h, before: stacks };
}
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296; }; }

describe("chips are never made or lost", () => {
  it("over 6,000 random hands of 2 to 6 players: chips conserved, pots paid only to players who matched them, nobody wins more than they covered", () => {
    const r = rng(2026);
    for (let i = 0; i < 6_000; i++) {
      const n = 2 + (i % 5), { h, before } = randomHand(r, n), res = h.result!;
      const total = before.reduce((a, b) => a + b, 0);
      expect(h.players.reduce((a, p) => a + p.stack, 0)).toBe(total);
      expect(h.players.every((p) => p.stack >= 0 && p.bet === 0)).toBe(true);
      expect(res.pots.reduce((a, p) => a + p.amount, 0)).toBe(h.players.reduce((a, p) => a + p.total, 0));
      for (const pot of res.pots) {
        expect(pot.winners.length).toBeGreaterThan(0);
        for (const w of pot.winners) { expect(pot.eligible).toContain(w); expect(h.player(w)!.folded).toBe(false); }
        if (res.showdown) {
          // the winners hold the best hand of those eligible
          const score = (s: number) => evaluate([...h.player(s)!.hole, ...h.board]).score;
          const best = Math.max(...pot.eligible.map(score));
          for (const s of pot.eligible) expect(pot.winners.includes(s)).toBe(score(s) === best);
        }
      }
      // what a player can win is at most what each other player put in, up to their own total
      for (const p of h.players) {
        const cover = h.players.reduce((a, q) => a + Math.min(q.total, p.total), 0);
        expect(res.won[p.seat] ?? 0).toBeLessThanOrEqual(cover);
        if (p.folded) expect(res.won[p.seat] ?? 0).toBe(0);
      }
      if (res.showdown) expect(h.board).toHaveLength(5);
      if (h.players.filter((p) => !p.folded).length > 1) expect(res.showdown).toBe(true);
    }
  }, 60_000);
});
