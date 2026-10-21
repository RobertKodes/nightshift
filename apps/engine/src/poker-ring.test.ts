import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type * as RingModule from "./poker/ring.js";
import type * as PokerModule from "./poker.js";

let R: typeof RingModule, P: typeof PokerModule;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "poker-ring-test-"));
  R = await import("./poker/ring.js");
  P = await import("./poker.js");
});

type View = ReturnType<RingModule.RingTables["get"]>;
const W = (n: number) => `0x${String(n).repeat(40).slice(0, 40)}`;
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296; }; }
function room(file: string | null = null, house = false, start = Date.UTC(2026, 9, 22, 12)) {
  let now = start;
  const tables = new R.RingTables(file, () => now, rng(9), undefined, house);
  const step = (ms: number) => { for (let t = 0; t < ms; t += 250) { now += 250; tables.tick(); } };
  return { tables, step, now: () => now, set: (t: number) => { now = t; } };
}
/** A table with people only (the room is made without frogs unless a test asks for them). */
const quiet = (r: ReturnType<typeof room>) => r.tables.list()[1]!.id;
const passive = (v: View) => (v.legal!.check ? { kind: "check" as const } : { kind: "call" as const });
/** Steps the table, every seated test player acting with `play` on its turn, until `until` says stop. */
function drive(r: ReturnType<typeof room>, id: string, seats: { player: string; play: ((v: View) => { kind: "fold" | "check" | "call" | "raise"; to?: number }) | null }[], limit: number, until?: (v: View) => boolean) {
  for (let t = 0; t < limit; t += 250) {
    r.step(250);
    for (const s of seats) {
      let v: View;
      try { v = r.tables.get(id, s.player); } catch { continue; }
      if (until?.(v)) return v;
      if (s.play && v.legal) r.tables.act(id, s.player, s.play(v));
    }
  }
  return null;
}

describe("free tables", () => {
  it("move the button to the next seat dealt in each hand, blinds right after it, and play heads-up rules when two remain", () => {
    const r = room(), id = quiet(r);
    const seats = [0, 1, 3, 5].map((seat, k) => r.tables.sit(id, seat, `P${k}`, W(k + 1), 2_000));
    seats.forEach((s) => r.tables.listen(id, s.player, () => {}));
    const seen: { n: number; button: number; sb: number; bb: number; dealt: number[]; first: number }[] = [];
    const note = (v: View) => { const h = v.hand; if (h && !seen.some((x) => x.n === h.n)) seen.push({ n: h.n, button: h.button, sb: h.sbSeat, bb: h.bbSeat, dealt: h.seats.map((s) => s.seat), first: h.toAct ?? -1 }); return false; };
    drive(r, id, seats.map((s) => ({ player: s.player, play: passive })), 80_000, note);
    expect(seen.length).toBeGreaterThan(3);
    const order = [0, 1, 3, 5];
    for (const h of seen.filter((x) => x.dealt.length === 4)) {
      // the blinds sit right after the button, and the seat after the big blind opens
      const at = order.indexOf(h.button);
      expect(h.sb).toBe(order[(at + 1) % 4]); expect(h.bb).toBe(order[(at + 2) % 4]);
      expect(h.first).toBe(order[(at + 3) % 4]);
    }
    for (let i = 1; i < seen.length; i++) if (seen[i]!.dealt.length === 4 && seen[i - 1]!.dealt.length === 4) expect(seen[i]!.button).toBe(order[(order.indexOf(seen[i - 1]!.button) + 1) % 4]);
    // two players stand up: heads-up, the button posts the small blind and opens
    r.tables.leave(id, seats[1]!.player); r.tables.leave(id, seats[3]!.player);
    const hu: typeof seen = [];
    drive(r, id, [seats[0]!, seats[2]!].map((s) => ({ player: s.player, play: passive })), 60_000, (v) => { const h = v.hand; if (h && h.street !== "done" && h.seats.length === 2 && !hu.some((x) => x.n === h.n)) hu.push({ n: h.n, button: h.button, sb: h.sbSeat, bb: h.bbSeat, dealt: h.seats.map((s) => s.seat), first: h.toAct ?? -1 }); return hu.length >= 3; });
    expect(hu.length).toBe(3);
    for (const h of hu) { expect(h.dealt).toEqual([0, 3]); expect(h.sb).toBe(h.button); if (h.first >= 0) expect([h.button, h.bb]).toContain(h.first); }
    expect(hu[1]!.button).not.toBe(hu[0]!.button);
  });

  it("deal a player who sits down mid-hand from the next hand, fold one who leaves mid-hand and give back the chips", () => {
    const r = room(), id = quiet(r);
    const a = r.tables.sit(id, 0, "Pearl", W(1), 2_000), b = r.tables.sit(id, 2, "Onyx", W(2), 1_500);
    expect(r.tables.chips(W(1))).toBe(R.DAILY_CHIPS - 2_000);
    expect(() => r.tables.sit(id, 2, "Late", W(3), 2_000)).toThrow(/taken/);
    expect(() => r.tables.sit(id, 4, "Pearl again", W(1), 2_000)).toThrow(/already have a seat/);
    expect(() => r.tables.sit(id, 4, "Cheap", W(3), 100)).toThrow(/800 to 2000/);
    r.tables.listen(id, a.player, () => {}); r.tables.listen(id, b.player, () => {});
    drive(r, id, [{ player: a.player, play: null }], 10_000, (v) => !!v.hand && v.hand.street === "preflop");
    const late = r.tables.sit(id, 4, "Jade", W(3), 2_000);
    r.tables.listen(id, late.player, () => {});
    expect(r.tables.get(id, late.player).hand!.seats.map((s) => s.seat)).toEqual([0, 2]);
    const n = r.tables.get(id, late.player).hand!.n;
    // Onyx stands up during the hand: folded on their turn, gone after the hand, chips back
    r.tables.leave(id, b.player);
    drive(r, id, [{ player: a.player, play: passive }, { player: late.player, play: passive }], 30_000, (v) => !!v.hand && v.hand.n > n && v.hand.street === "preflop");
    const v = r.tables.get(id, late.player);
    expect(v.hand!.seats.map((s) => s.seat)).toEqual([0, 4]);
    expect(v.players[2]).toBeNull();
    const onyx = r.tables.chips(W(2))!;
    expect(onyx).toBeGreaterThan(R.DAILY_CHIPS - 1_500);
    expect(onyx).toBeLessThanOrEqual(R.DAILY_CHIPS);
  });

  it("let a player sit out (not dealt in) and come back; a timeout sits them out", () => {
    const r = room(), id = quiet(r);
    const p = [0, 1, 2].map((seat, k) => r.tables.sit(id, seat, `P${k}`, W(k + 4), 2_000));
    p.forEach((s) => r.tables.listen(id, s.player, () => {}));
    r.tables.sitOut(id, p[2]!.player, true);
    const v = drive(r, id, [{ player: p[0]!.player, play: null }], 10_000, (x) => !!x.hand && x.hand.street === "preflop")!;
    expect(v.hand!.seats.map((s) => s.seat)).toEqual([0, 1]);
    r.tables.sitOut(id, p[2]!.player, false);
    const n = v.hand!.n;
    // nobody acts: the clock folds or checks for them, and sits each one out
    drive(r, id, [{ player: p[0]!.player, play: null }], 3 * 60_000, (x) => !!x.hand && x.hand.n > n && x.hand.street === "preflop" && x.hand.seats.length === 3);
    const w = r.tables.get(id, p[2]!.player);
    expect(w.players.filter((x) => x?.sittingOut).length).toBeGreaterThan(0);
  });

  it("make side pots with three all-ins, conserving every chip", () => {
    const r = room(), id = quiet(r);
    const p = [[0, 800], [1, 1_200], [2, 1_600], [3, 2_000]].map(([seat, buy], k) => r.tables.sit(id, seat!, `P${k}`, W(k + 7), buy));
    p.forEach((s) => r.tables.listen(id, s.player, () => {}));
    const shove = (v: View) => (v.legal!.raise ? { kind: "raise" as const, to: v.legal!.raise.max } : v.legal!.check ? { kind: "check" as const } : { kind: "call" as const });
    const done = drive(r, id, p.map((s) => ({ player: s.player, play: shove })), 30_000, (v) => !!v.hand?.result);
    expect(done).not.toBeNull();
    const res = done!.hand!.result!;
    const total = done!.hand!.seats.reduce((n, s) => n + s.stack, 0);
    expect(total).toBe(800 + 1_200 + 1_600 + 2_000);
    // every stack in: 800, 1,200 and 1,600 make three pots, each open to fewer players
    expect(res.pots.map((x) => [x.amount, x.eligible.length])).toEqual([[3_200, 4], [1_200, 3], [800, 2]]);
  });

  it("keep the first table playing with house frogs when nobody is there, fill a table to four for one person, and give seats up to people", () => {
    const r = room(null, true);
    r.step(3_000);
    const [first, second] = r.tables.list();
    expect(first).toMatchObject({ people: 0, frogs: R.TARGET_PLAYERS, live: true });
    expect(second).toMatchObject({ people: 0, frogs: 0 });
    // the first table is on the live list, as a house exhibition while only frogs play
    expect(r.tables.liveTables().find((t) => t.id === first!.id)).toMatchObject({ people: 0, taken: R.TARGET_PLAYERS });
    const w = r.tables.watchView(first!.id);
    expect(w.players.filter(Boolean).every((p) => p!.bot && p!.house && p!.rating === null)).toBe(true);
    expect(w.hand!.seats.every((s) => s.cards === null)).toBe(true);
    // one person at the second table: three frogs join between hands
    const me = r.tables.sit(second!.id, 0, "Pearl", W(1), 2_000);
    r.tables.listen(second!.id, me.player, () => {});
    r.step(3_000);
    expect(r.tables.list()[1]).toMatchObject({ people: 1, frogs: 3 });
    // people arrive at the first table: the frogs stand up between hands, always leaving a free seat
    const empty = () => r.tables.watchView(first!.id).players.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0);
    const people: string[] = [];
    for (let k = 0; k < 5; k++) {
      for (let i = 0; i < 400 && !empty().length; i++) r.step(250);
      const seat = empty()[0]!;
      people.push(r.tables.sit(first!.id, seat, `Guest ${k}`, null, 2_000).player);
      r.tables.listen(first!.id, people.at(-1)!, () => {});
      drive(r, first!.id, people.map((player) => ({ player, play: passive })), 40_000, () => r.tables.list()[0]!.frogs <= Math.max(0, Math.min(R.TARGET_PLAYERS - people.length, R.RING_SEATS - people.length - 1)));
    }
    expect(r.tables.list()[0]).toMatchObject({ people: 5, frogs: 0 });
    expect(empty().length).toBe(1);
  });

  it("are never staked, never bet on, never rated, and tell no profile or prize", () => {
    const r = room(null, true), id = r.tables.list()[0]!.id;
    const told: unknown[] = [];
    P.onPoker((e) => told.push(e));
    r.step(60_000);
    expect(() => r.tables.betInfo(id)).toThrow(/No betting/);
    expect(told).toHaveLength(0);
    const v = r.tables.watchView(id);
    expect(v).not.toHaveProperty("escrow");
    expect(v.history.length).toBeGreaterThan(0);
  });

  it("top up play chips once a UTC day, keep chips held at a table across a restart, and seal a hand's seed while its players sit there", () => {
    const dir = mkdtempSync(join(tmpdir(), "chips-")), file = join(dir, "poker-chips.json");
    const r = room(file), id = quiet(r);
    const a = r.tables.sit(id, 0, "Pearl", W(1), 2_000), b = r.tables.sit(id, 1, "Onyx", W(2), 2_000);
    r.tables.listen(id, a.player, () => {}); r.tables.listen(id, b.player, () => {});
    drive(r, id, [{ player: a.player, play: passive }, { player: b.player, play: passive }], 30_000, (v) => v.history.length >= 2);
    const v = r.tables.get(id, a.player);
    expect(v.history[0]!.serverSeed).toBeNull();
    expect(v.history[0]!.commit).toMatch(/^[0-9a-f]{64}$/);
    // a spectator sees the seed once both have left
    const rail = () => r.tables.watchView(id).history[0]!;
    r.tables.leave(id, a.player); r.tables.leave(id, b.player);
    r.step(1_000);
    expect(rail().serverSeed).toMatch(/^[0-9a-f]{64}$/);
    const after = r.tables.chips(W(1))! + r.tables.chips(W(2))!;
    expect(after).toBe(2 * R.DAILY_CHIPS);
    // chips at a table when the server stops come back on the next start
    const c = r.tables.sit(id, 3, "Pearl", W(1), 1_000);
    expect(r.tables.chips(W(1))).toBeLessThan(R.DAILY_CHIPS);
    void c;
    const again = new R.RingTables(file, () => r.now());
    expect(again.chips(W(1))).toBe(r.tables.chips(W(1))! + 1_000);
    // the next UTC day tops a short wallet up to the daily chips
    r.set(r.now() + 86_400_000);
    expect(r.tables.chips(W(1))).toBe(R.DAILY_CHIPS);
  });
});
