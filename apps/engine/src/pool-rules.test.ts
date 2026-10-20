import { describe, expect, it } from "vitest";
import { type Ball, EV, FOOT_X, FOOT_Y, HEAD_Y, L, POCKETED, R, STILL, W, rack, simulate, still } from "./pool/physics.js";
import { type Call, type Options, QUICK, type Rack, type Summary, WPA, badCall, decide, judge, newRack, onEight, summarize, targets, timeFoul } from "./pool/rules.js";
import { mdeg } from "./pool/bot.js";

/** A rack in play with these object balls on the table (spread on a grid), the rest pocketed. */
function table(on: number[], o: Partial<Rack> = {}): Rack {
  const balls: Ball[] = [still(0, W / 2, 0.3)];
  for (let id = 1; id <= 15; id++) {
    const i = id - 1, x = 0.12 + (i % 5) * 0.18, y = 0.62 + Math.floor(i / 5) * 0.32;
    balls.push(on.includes(id) ? still(id, x, y) : { ...still(id, 0, 0), s: POCKETED });
  }
  return { ...newRack(1, 0), balls, phase: "play", inHand: "none", ...o };
}
const all = [...Array(15)].map((_, i) => i + 1);
const without = (...ids: number[]) => all.filter((id) => !ids.includes(id));
/** What the physics saw: defaults to a legal contact with a rail afterwards. */
const sum = (o: Partial<Summary> = {}): Summary => ({ first: null, firstAt: 0.2, pocketed: [], scratch: false, railAfter: [0], railBalls: [], crossed: true, ...o });
/** The balls after a shot: these pocketed (the cue ball too, for a scratch). */
const after = (r: Rack, s: Summary) => r.balls.map((b) => (s.pocketed.some((p) => p.id === b.id) ? { ...b, s: POCKETED } : b));
const play = (r: Rack, call: Call, s: Summary, o: Options = WPA) => judge(r, call, after(r, s), s, o);
const down = (...ids: [number, number][]) => ids.map(([id, pocket]) => ({ id, pocket }));
const brk = (s: Summary) => play({ ...newRack(5, 0) }, null, s);

describe("WPA 8-ball: the break (4.3)", () => {
  it("a legal break that drops a ball: the breaker plays on, the table open (c)", () => {
    const { rack: r, verdict: v } = brk(sum({ first: 1, pocketed: down([3, 2]), railBalls: [3] }));
    expect(v).toMatchObject({ foul: null, again: true, assigned: false });
    expect(r).toMatchObject({ phase: "play", turn: 0, groups: [null, null], inHand: "none", decision: null });
  });
  it("four balls to a rail and nothing down: legal, the turn passes, the table open", () => {
    const { rack: r, verdict: v } = brk(sum({ first: 1, railBalls: [1, 4, 9, 12] }));
    expect(v).toMatchObject({ foul: null, again: false });
    expect(r).toMatchObject({ turn: 1, groups: [null, null], inHand: "none", decision: null });
  });
  it("fewer than four to a rail and nothing down: an illegal break, the incoming player chooses (d)", () => {
    const { rack: r, verdict: v } = brk(sum({ first: 1, railBalls: [1, 4, 9] }));
    expect(v.text).toMatch(/Illegal break/);
    expect(r.decision).toEqual({ kind: "illegal-break", by: 1, options: ["accept", "rebreak", "rebreak-other"] });
    // (1) accept the table in position: the incoming player shoots from where the cue ball lies
    expect(decide(r, 1, "accept")).toMatchObject({ turn: 1, phase: "play", inHand: "none", decision: null });
    // (2) re-rack and break; (3) re-rack and let the offender break again
    const re = decide(r, 1, "rebreak");
    expect(re).toMatchObject({ phase: "break", breaker: 1, turn: 1, inHand: "kitchen", racks: 1 });
    expect(re.balls.filter((b) => b.s !== POCKETED)).toHaveLength(16);
    expect(decide(r, 1, "rebreak-other")).toMatchObject({ phase: "break", breaker: 0, turn: 0 });
    expect(() => decide(r, 0, "accept")).toThrow(/no choice for you/);
    expect(() => decide(r, 1, "spot")).toThrow(/not one of the options/);
  });
  it("a scratch on a legal break: a foul, the table open, the cue ball in hand above the head string", () => {
    const { rack: r, verdict: v } = brk(sum({ first: 1, pocketed: down([0, 0], [5, 3]), scratch: true, railBalls: [1, 2, 5, 9] }));
    expect(v.foul).toBe("scratch");
    expect(r).toMatchObject({ turn: 1, inHand: "kitchen", groups: [null, null], decision: null });
    // the ball that dropped stays down (no object ball is ever spotted but the 8, 4.7)
    expect(r.balls.find((b) => b.id === 5)!.s).toBe(POCKETED);
  });
  it("the 8 on a legal break is no foul: the breaker spots it and plays on, or breaks again (e)", () => {
    const { rack: r } = brk(sum({ first: 1, pocketed: down([8, 2]), railBalls: [1, 8] }));
    expect(r.decision).toEqual({ kind: "eight-break", by: 0, options: ["spot", "rebreak"] });
    const spotted = decide(r, 0, "spot");
    expect(spotted).toMatchObject({ turn: 0, phase: "play", inHand: "none" });
    const eight = spotted.balls.find((b) => b.id === 8)!;
    expect(eight.s).toBe(STILL);
    expect(eight.x).toBe(FOOT_X);
    expect(eight.y).toBeGreaterThanOrEqual(FOOT_Y);
    expect(decide(r, 0, "rebreak")).toMatchObject({ phase: "break", breaker: 0 });
  });
  it("the 8 on a break with a scratch: the opponent spots it with the cue ball in the kitchen, or breaks (f)", () => {
    const { rack: r, verdict: v } = brk(sum({ first: 1, pocketed: down([8, 5], [0, 1]), scratch: true, railBalls: [8] }));
    expect(v.foul).toBe("scratch");
    expect(r.decision).toEqual({ kind: "eight-break-foul", by: 1, options: ["spot", "rebreak"] });
    expect(decide(r, 1, "spot")).toMatchObject({ turn: 1, inHand: "kitchen", phase: "play" });
    expect(decide(r, 1, "rebreak")).toMatchObject({ phase: "break", breaker: 1 });
  });
  it("no call on the break", () => {
    expect(badCall(newRack(1, 0), null, WPA)).toBeNull();
    expect(badCall(newRack(1, 0), { ball: 1, pocket: 0 }, WPA)).toMatch(/not called/);
  });
});

describe("WPA 8-ball: the open table and the groups (4.4)", () => {
  it("the called ball in the called pocket gives the shooter its group", () => {
    const { rack: r, verdict: v } = play(table(all), { ball: 3, pocket: 2 }, sum({ first: 3, pocketed: down([3, 2]) }));
    expect(v).toMatchObject({ assigned: true, again: true, foul: null });
    expect(r.groups).toEqual(["solids", "stripes"]);
    expect(r.turn).toBe(0);
  });
  it("a combination: hit a solid first to drop a called stripe, and the stripes are the shooter's", () => {
    const { rack: r } = play(table(all), { ball: 10, pocket: 4 }, sum({ first: 3, pocketed: down([10, 4]) }));
    expect(r.groups).toEqual(["stripes", "solids"]);
  });
  it("a ball dropped but not the called one: the table stays open and the turn passes", () => {
    const { rack: r, verdict: v } = play(table(all), { ball: 3, pocket: 2 }, sum({ first: 3, pocketed: down([11, 4]) }));
    expect(v).toMatchObject({ assigned: false, again: false, foul: null });
    expect(r.groups).toEqual([null, null]);
    expect(r.turn).toBe(1);
    expect(r.balls.find((b) => b.id === 11)!.s).toBe(POCKETED);
  });
  it("hitting the 8 first on an open table is a foul", () => {
    const { rack: r, verdict: v } = play(table(all), { ball: 3, pocket: 2 }, sum({ first: 8 }));
    expect(v.foul).toBe("wrong-ball");
    expect(r).toMatchObject({ turn: 1, inHand: "anywhere" });
  });
  it("on an open table with a group cleared, the shooter may claim it and shoot the 8", () => {
    const r = table(without(1, 2, 3, 4, 5, 6, 7));
    expect(onEight(r, 0)).toBe(true);
    expect(targets(r)).toContain(8);
    expect(play(r, { ball: 8, pocket: 1 }, sum({ first: 8, pocketed: down([8, 1]) })).verdict).toMatchObject({ winner: 0 });
    // not claimed (another ball called): the 8 first is still a foul
    expect(play(r, { ball: 9, pocket: 1 }, sum({ first: 8 })).verdict.foul).toBe("wrong-ball");
  });
  it("quick rules: the first ball dropped decides the groups, and only the 8 is called", () => {
    const { rack: r, verdict: v } = play(table(all), null, sum({ first: 2, pocketed: down([12, 1], [5, 3]) }), QUICK);
    expect(v.assigned).toBe(true);
    expect(r.groups).toEqual(["stripes", "solids"]);
    expect(badCall(table(all), null, QUICK)).toBeNull();
    expect(badCall(table(all), null, WPA)).toMatch(/Call a ball/);
  });
  it("targets: the shooter's group, the 8 once it is cleared, never the 8 early", () => {
    expect(targets(table(all))).not.toContain(8);
    expect(targets(table(all, { groups: ["solids", "stripes"] }))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(targets(table(without(1, 2, 3, 4, 5, 6, 7), { groups: ["solids", "stripes"] }))).toEqual([8]);
    expect(badCall(table(all, { groups: ["solids", "stripes"] }), { ball: 9, pocket: 0 }, WPA)).toMatch(/your group/);
    expect(badCall(table(all, { groups: ["solids", "stripes"] }), { ball: 8, pocket: 0 }, WPA)).toMatch(/comes last/);
    expect(badCall(table(without(1, 2, 3, 4, 5, 6, 7), { groups: ["solids", "stripes"] }), null, QUICK)).toMatch(/pocket for the 8/);
  });
});

describe("WPA 8-ball: legal shots and fouls (3, 4.9)", () => {
  const mine = () => table(all, { groups: ["solids", "stripes"] });
  it("your ball in the called pocket: you play on", () => {
    const { rack: r, verdict: v } = play(mine(), { ball: 4, pocket: 0 }, sum({ first: 4, pocketed: down([4, 0]) }));
    expect(v).toMatchObject({ again: true, foul: null });
    expect(r.turn).toBe(0);
  });
  it("a scratch: ball in hand anywhere for the opponent", () => {
    const { rack: r, verdict: v } = play(mine(), { ball: 4, pocket: 0 }, sum({ first: 4, pocketed: down([0, 3]), scratch: true }));
    expect(v.foul).toBe("scratch");
    expect(r).toMatchObject({ turn: 1, inHand: "anywhere", fouls: [1, 0] });
  });
  it("no ball touched, the wrong ball first, no rail after the contact: fouls", () => {
    expect(play(mine(), { ball: 4, pocket: 0 }, sum({ first: null, railAfter: [0] })).verdict.foul).toBe("no-contact");
    expect(play(mine(), { ball: 4, pocket: 0 }, sum({ first: 12 })).verdict.foul).toBe("wrong-ball");
    expect(play(mine(), { ball: 4, pocket: 0 }, sum({ first: 4, railAfter: [] })).verdict.foul).toBe("no-rail");
    // a ball pocketed needs no rail
    expect(play(mine(), { ball: 4, pocket: 0 }, sum({ first: 4, railAfter: [], pocketed: down([2, 5]) })).verdict.foul).toBeNull();
  });
  it("a legal miss: no foul, the turn passes, the cue ball stays where it is", () => {
    const { rack: r, verdict: v } = play(mine(), { ball: 4, pocket: 0 }, sum({ first: 4 }));
    expect(v).toMatchObject({ foul: null, again: false });
    expect(r).toMatchObject({ turn: 1, inHand: "none" });
  });
  it("a safety: what drops stays down, and the opponent shoots", () => {
    const { rack: r, verdict: v } = play(mine(), "safety", sum({ first: 4, pocketed: down([4, 0]) }));
    expect(v).toMatchObject({ foul: null, again: false });
    expect(r.turn).toBe(1);
    expect(r.balls.find((b) => b.id === 4)!.s).toBe(POCKETED);
  });
  it("from the kitchen, the first ball must be on or past the head string unless the cue ball crosses it first (3.11)", () => {
    const r = table(all, { groups: ["solids", "stripes"], inHand: "kitchen" });
    r.balls.find((b) => b.id === 4)!.y = HEAD_Y - 0.2;
    expect(play(r, { ball: 4, pocket: 0 }, sum({ first: 4, crossed: false })).verdict.foul).toBe("kitchen");
    expect(play(r, { ball: 4, pocket: 0 }, sum({ first: 4, crossed: true })).verdict.foul).toBeNull();
    // a ball on the head string is playable
    r.balls.find((b) => b.id === 4)!.y = HEAD_Y - R / 2;
    expect(play(r, { ball: 4, pocket: 0 }, sum({ first: 4, crossed: false })).verdict.foul).toBeNull();
  });
  it("the shot clock running out is a standard foul (3.14); on the break the other player breaks", () => {
    const t = timeFoul(mine());
    expect(t.verdict.foul).toBe("time");
    expect(t.rack).toMatchObject({ turn: 1, inHand: "anywhere", fouls: [1, 0] });
    expect(timeFoul(newRack(3, 0)).rack).toMatchObject({ phase: "break", turn: 1, breaker: 1, inHand: "kitchen" });
  });
  it("with every ball of yours above the head string and the cue ball in the kitchen, the nearest is spotted (1.6)", () => {
    const r = table(without(), { groups: ["solids", "stripes"] });
    for (const b of r.balls) if (b.id >= 1 && b.id <= 7) { b.y = 0.1 + b.id * 0.01; b.x = 0.1 + b.id * 0.1; }
    // a scratch on a legal break hands the incoming player the kitchen
    const broke = judge({ ...r, phase: "break", turn: 1 }, null, after(r, sum({ pocketed: down([0, 1], [9, 2]), scratch: true })), sum({ first: 9, pocketed: down([0, 1], [9, 2]), scratch: true, railBalls: [9, 10, 11, 12] }));
    expect(broke.rack.inHand).toBe("kitchen");
    expect(broke.rack.turn).toBe(0);
    const seven = broke.rack.balls.find((b) => b.id === 7)!;
    expect(seven).toMatchObject({ x: FOOT_X, y: FOOT_Y });
  });
});

describe("WPA 8-ball: the 8-ball decides the rack (4.8)", () => {
  const onThe8 = () => table(without(1, 2, 3, 4, 5, 6, 7), { groups: ["solids", "stripes"] });
  it("the 8 in the called pocket, no foul: the rack is won", () => {
    const { rack: r, verdict: v } = play(onThe8(), { ball: 8, pocket: 5 }, sum({ first: 8, pocketed: down([8, 5]) }));
    expect(v).toMatchObject({ winner: 0 });
    expect(r).toMatchObject({ phase: "over", winner: 0 });
  });
  it("the 8 in another pocket: lost (c)", () => {
    expect(play(onThe8(), { ball: 8, pocket: 5 }, sum({ first: 8, pocketed: down([8, 3]) })).verdict).toMatchObject({ winner: 1 });
  });
  it("the 8 on a foul: lost (a), a scratch or a wrong first ball", () => {
    expect(play(onThe8(), { ball: 8, pocket: 5 }, sum({ first: 8, pocketed: down([8, 5], [0, 2]), scratch: true })).verdict).toMatchObject({ winner: 1 });
    expect(play(onThe8(), { ball: 8, pocket: 5 }, sum({ first: 12, pocketed: down([8, 5]) })).verdict).toMatchObject({ winner: 1 });
  });
  it("the 8 before the group is cleared: lost (b), even with the last ball of the group in the same shot", () => {
    expect(play(table(all, { groups: ["solids", "stripes"] }), { ball: 3, pocket: 1 }, sum({ first: 3, pocketed: down([8, 2]) })).verdict).toMatchObject({ winner: 1 });
    const last = table(without(1, 2, 3, 4, 5, 6), { groups: ["solids", "stripes"] });
    expect(play(last, { ball: 7, pocket: 0 }, sum({ first: 7, pocketed: down([7, 0], [8, 1]) })).verdict).toMatchObject({ winner: 1 });
  });
  it("the 8 on an open table: lost", () => {
    expect(play(table(all), { ball: 2, pocket: 0 }, sum({ first: 2, pocketed: down([8, 4]) })).verdict).toMatchObject({ winner: 1 });
  });
  it("the 8 on a safety: lost (not the called pocket)", () => {
    expect(play(onThe8(), "safety", sum({ first: 8, pocketed: down([8, 0]) })).verdict).toMatchObject({ winner: 1 });
  });
});

describe("three consecutive fouls (3.13): not part of WPA 8-ball, an option", () => {
  const foul = sum({ first: null });
  it("off by default: fouls only cost ball in hand", () => {
    let r = table(all, { groups: ["solids", "stripes"] });
    for (let i = 0; i < 3; i++) { r = play(r, { ball: 4, pocket: 0 }, foul).rack; r = { ...r, turn: 0 }; }
    expect(r.phase).toBe("play");
    expect(r.fouls[0]).toBe(3);
  });
  it("on: the third foul in a row loses the rack, and a legal shot resets the count", () => {
    const o = { ...WPA, threeFouls: true };
    let r = table(all, { groups: ["solids", "stripes"] });
    r = { ...play(r, { ball: 4, pocket: 0 }, foul, o).rack, turn: 0 };
    r = { ...play(r, { ball: 4, pocket: 0 }, foul, o).rack, turn: 0 };
    expect(r.fouls[0]).toBe(2);
    const reset = play(r, { ball: 4, pocket: 0 }, sum({ first: 4 }), o).rack;
    expect(reset.fouls[0]).toBe(0);
    const third = play(r, { ball: 4, pocket: 0 }, foul, o);
    expect(third.verdict).toMatchObject({ winner: 1, reason: "Three fouls in a row lose the rack." });
  });
});

describe("reading a shot from the physics", () => {
  it("a straight pot: the first ball, the pocket, a ball driven to a rail", () => {
    const [px, py] = [-0.0295, -0.0295];
    const start = [still(0, 0.45, 0.45), still(3, 0.2, 0.2), still(12, 0.8, 1.6)];
    const r = simulate(start, { aim: mdeg(0.2 - 0.45, 0.2 - 0.45), power: 300, spinX: 0, spinY: 0, elevation: 0 });
    const s = summarize(start, r.frames);
    expect(s.first).toBe(3);
    expect(s.pocketed).toEqual([{ id: 3, pocket: 0 }]);
    expect(s.railAfter).toContain(3);
    expect(s.scratch).toBe(false);
    void px; void py;
  });
  it("a ball frozen to a rail is not driven to it by being pushed into it (2.7)", () => {
    const y = 0.9, start = [still(0, 0.5, y), still(5, 0.0286, y)];
    const r = simulate(start, { aim: 180000, power: 120, spinX: 0, spinY: 0, elevation: 0 });
    expect(r.frames.some((f) => f.k === EV.RAIL && f.a === 5)).toBe(true);
    const s = summarize(start, r.frames);
    expect(s.first).toBe(5);
    expect(s.railAfter).not.toContain(5);
  });
  it("the cue ball crossing the head string before its first contact (3.11)", () => {
    // from the kitchen, up the table, off the foot rail, back to a ball in the kitchen
    const start = [still(0, 0.5, 0.2), still(4, 0.5, 0.35)];
    const across = simulate([still(0, 0.3, 0.2), still(4, 0.7, 0.3)], { aim: 90000, power: 700, spinX: 0, spinY: 0, elevation: 0 });
    expect(summarize([still(0, 0.3, 0.2), still(4, 0.7, 0.3)], across.frames).crossed).toBe(true);
    const direct = simulate(start, { aim: 90000, power: 200, spinX: 0, spinY: 0, elevation: 0 });
    expect(summarize(start, direct.frames)).toMatchObject({ first: 4, crossed: false });
  });
  it("a full rack judged end to end: a real break is legal or chooses, and never leaves the table in a strange state", () => {
    for (let s = 1; s < 25; s++) {
      const r0 = newRack(s, 0), res = simulate(r0.balls, { aim: mdeg(FOOT_X - r0.balls[0]!.x, FOOT_Y - r0.balls[0]!.y), power: 1000, spinX: 0, spinY: 0, elevation: 0 });
      const { rack: r } = judge(r0, null, res.balls, summarize(r0.balls, res.frames));
      expect(r.phase).toBe("play");
      expect([null, "illegal-break", "eight-break", "eight-break-foul"]).toContain(r.decision?.kind ?? null);
      expect(r.balls.filter((b) => b.s !== POCKETED).every((b) => b.x > -0.07 && b.x < W + 0.07 && b.y > -0.07 && b.y < L + 0.07)).toBe(true);
    }
    void rack;
  });
});
