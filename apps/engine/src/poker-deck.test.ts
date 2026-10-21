import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as web from "../../web/src/poker/fair.js";
import { cardText } from "./poker/cards.js";
import { cleanSeed, commitOf, dealPlan, deckOrder, newServerSeed } from "./poker/deck.js";
import { Hand } from "./poker/hand.js";

const SEED = "5f1c7a3b9e2d4c6a8b0f1e3d5c7a9b2e4d6f8a0c1b3e5d7f9a2c4e6b8d0f1a3c";

describe("the provably fair deck", () => {
  it("commits to SHA-256 of the server seed, and keeps only clean client seeds", () => {
    expect(commitOf(SEED)).toBe(createHash("sha256").update(SEED).digest("hex"));
    expect(newServerSeed()).toMatch(/^[0-9a-f]{64}$/);
    expect(newServerSeed()).not.toBe(newServerSeed());
    expect(cleanSeed("Frog-7_seed")).toBe("Frog-7_seed");
    for (const bad of ["", "a,b", "x".repeat(65), "spa ce", 42, null, "é"]) expect(cleanSeed(bad)).toBe("");
  });
  it("is a whole deck, the same every time for the same seeds, and changes with any seed or the hand number", () => {
    const d = deckOrder(SEED, ["alpha", "bravo"], 7);
    expect(new Set(d).size).toBe(52);
    expect(deckOrder(SEED, ["alpha", "bravo"], 7)).toEqual(d);
    expect(deckOrder(SEED, ["alpha", "bravo!"], 7)).toEqual(deckOrder(SEED, ["alpha", ""], 7)); // an unclean seed counts as none
    expect(deckOrder(SEED, ["alpha", "bravo"], 8)).not.toEqual(d);
    expect(deckOrder(SEED, ["alpha", "brava"], 7)).not.toEqual(d);
    expect(deckOrder(SEED, ["bravo", "alpha"], 7)).not.toEqual(d); // seeds are by seat
    expect(deckOrder(SEED.replace("5f", "5e"), ["alpha", "bravo"], 7)).not.toEqual(d);
    // pinned: the verify page and anyone's own script must get exactly this
    expect(d.slice(0, 9).map(cardText)).toMatchSnapshot();
  });
  it("is rebuilt card for card by the browser's WebCrypto verifier", async () => {
    for (const [seeds, hand] of [[["alpha", "bravo"], 7], [["", "x"], 1], [["a", "b", "c", "d", "e", "f"], 1234], [[], 3]] as const) {
      const seed = newServerSeed();
      expect(await web.deckOrder(seed, seeds, hand)).toEqual(deckOrder(seed, seeds, hand));
      expect(await web.commitOf(seed)).toBe(commitOf(seed));
    }
    expect(web.dealPlan(6)).toEqual(dealPlan(6));
  });
  it("puts every card in every position about equally often (no modulo bias)", () => {
    const counts = Array.from({ length: 52 }, () => 0), last = Array.from({ length: 52 }, () => 0), N = 10_400;
    for (let i = 0; i < N; i++) { const d = deckOrder(SEED, [String(i)], i); counts[d[0]!]!++; last[d[51]!]!++; }
    // chi-square, 51 degrees of freedom: above 90 happens by chance about once in a thousand
    const chi = (c: number[]) => c.reduce((s, x) => s + (x - N / 52) ** 2 / (N / 52), 0);
    expect(chi(counts)).toBeLessThan(90);
    expect(chi(last)).toBeLessThan(90);
  }, 30_000);
  it("deals hole cards round the table from the seat after the button, then burn, flop, burn, turn, burn, river", () => {
    const deck = deckOrder(SEED, ["a", "b", "c"], 1), plan = dealPlan(3);
    expect(plan).toEqual({ hole: [[0, 3], [1, 4], [2, 5]], burns: [6, 10, 12], flop: [7, 8, 9], turn: 11, river: 13 });
    // seats 0, 1, 2 with the button on 0: seat 1 gets the first card, seat 0 the third
    const h = new Hand({ n: 1, seats: [0, 1, 2].map((seat) => ({ seat, stack: 1000 })), button: 0, sb: 10, bb: 20, deck });
    expect(h.player(1)!.hole).toEqual([deck[0], deck[3]]);
    expect(h.player(2)!.hole).toEqual([deck[1], deck[4]]);
    expect(h.player(0)!.hole).toEqual([deck[2], deck[5]]);
    // everyone checks it down
    h.act(0, { kind: "call" }); h.act(1, { kind: "call" }); h.act(2, { kind: "check" });
    for (let s = 0; s < 3; s++) { h.act(1, { kind: "check" }); h.act(2, { kind: "check" }); h.act(0, { kind: "check" }); }
    expect(h.board).toEqual([deck[7], deck[8], deck[9], deck[11], deck[13]]);
  });
});
