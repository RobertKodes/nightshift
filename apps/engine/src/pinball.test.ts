import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type Input, Table, duelReplay, replay } from "./pinball/engine.js";

/** The flipper bot: flips when the ball comes down to a flipper, pulls the plunger `pull` ticks. */
type Bot = { t: Table; inputs: Input[]; last: string; lt: number; rt: number; pull: number };
const bot = (seed: number, pull = 150): Bot => ({ t: new Table(seed), inputs: [], last: "", lt: 0, rt: 0, pull });
function playTo(c: Bot, to: number): void {
  while (!c.t.over && c.t.tick < to) {
    const t = c.t, b = t.ball;
    if (c.lt > 0) c.lt--; if (c.rt > 0) c.rt--;
    if (c.lt === 0 && b.y > 745 && b.y < 815 && b.x < 300) c.lt = 40;
    if (c.rt === 0 && b.y > 745 && b.y < 815 && b.x >= 300) c.rt = 40;
    const k = { left: c.lt > 15 ? 1 : 0, right: c.rt > 15 ? 1 : 0, plunger: t.inLane ? (t.plunge < c.pull ? 1 : 0) : 0 };
    const s = `${k.left}${k.right}${k.plunger}`;
    if (s !== c.last) { c.inputs.push([t.tick, k.left as 0, k.right as 0, k.plunger as 0]); t.input = k; c.last = s; }
    t.step();
  }
}
/** The audit's plunger-only loop: a 75% pull every time the ball is in the lane, no flippers. */
function plungerLoop(seed: number): Table {
  const t = new Table(seed); let hold = 180, last = "";
  t.input = { left: 0, right: 0, plunger: 1 };
  while (!t.over) {
    let p = 0;
    if (t.inLane) { if (hold > 0) { p = 1; hold--; } else if (t.plunge === 0) { hold = 179; p = 1; } }
    if (String(p) !== last) { t.input = { left: 0, right: 0, plunger: p }; last = String(p); }
    t.step();
  }
  return t;
}

describe("space pinball", () => {
  it("runs the very engine the browser runs", () => {
    const here = readFileSync(join(import.meta.dirname, "pinball/engine.ts"), "utf8");
    const web = readFileSync(join(import.meta.dirname, "../../web/src/pinball/engine.ts"), "utf8");
    expect(here).toBe(web);
  });
  it("gives the same score for the same seed and inputs, and a different game for another seed", () => {
    for (const seed of [1, 42, 99]) {
      const g = bot(seed); playTo(g, Infinity);
      expect(g.t.score).toBeGreaterThan(0);
      expect(replay(seed, g.inputs).score).toBe(g.t.score);
    }
  });
  it("saves a ball once, and gives no skill shot on the relaunch of a saved ball (finding 1)", () => {
    for (const seed of [1, 2, 42, 99, 12345]) {
      const t = plungerLoop(seed);
      const kinds = t.events.map((e) => e.kind);
      expect(kinds.filter((k) => k === "drain")).toHaveLength(3);
      expect(t.ballsLeft).toBe(0);
      expect(t.tick).toBeLessThan(36_000);
      expect(kinds.filter((k) => k === "save").length).toBeLessThanOrEqual(3);
      expect(t.score).toBeLessThan(100_000); // was ~860,000 when the save re-armed on every launch
      // a launch after a save scores no skill shot
      for (let i = 0; i < t.events.length; i++) if (t.events[i]!.kind === "save") {
        const next = t.events.findIndex((e, j) => j > i && e.kind === "launch");
        expect(t.events[next + 1]?.kind).not.toBe("skill");
      }
    }
  });
  it("counts one black hole capture once (finding 5)", () => {
    const r = replay(1, [[0, 0, 0, 1], [150, 0, 0, 0]]);
    const holes = r.events.filter((e) => e.kind === "hole");
    expect(holes.map((e) => `${e.tick}:${e.points}`)).toEqual(["365:4000"]);
    expect(r.stats.holes).toBe(1);
    for (let seed = 1; seed <= 30; seed++) {
      const g = bot(seed); playTo(g, Infinity);
      const ticks = g.t.events.filter((e) => e.kind === "hole").map((e) => e.tick);
      expect(new Set(ticks).size).toBe(ticks.length);
      expect(g.t.stats.holes).toBe(ticks.length);
    }
  });
  it("does not score a target again in the tick the frog crew resets (finding 8)", () => {
    let crews = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = bot(seed, 150 + (seed % 40)); playTo(g, Infinity);
      const ev = g.t.events;
      ev.forEach((e, i) => { if (e.kind === "targets") { crews++; expect(ev.slice(i + 1).some((x) => x.tick === e.tick && x.kind === "target")).toBe(false); } });
    }
    expect(crews).toBeGreaterThan(0);
  });
});

describe("space pinball server", () => {
  let pb: typeof import("./pinball.js");
  const told: unknown[] = [];
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 19, 12));
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "pinball-test-"));
    pb = await import("./pinball.js");
    pb.onArcade((e) => told.push(e));
  });

  type Client = Bot & { me: string; landed: { n: number; at: number }[]; got: Set<number>; streamed: number; told: number; done: boolean; error?: string };
  /**
   * Two clients playing a duel against the server, as the browser does: every 250 ms each reads the
   * attacks relayed to it, plays its table up to the match clock and posts what is new.
   */
  async function duel(o: { names?: [string, string]; cheat?: "fake" | "silent" | "keep"; slow?: boolean } = {}) {
    const A = await pb.queue(o.names?.[0] ?? "Alice", null, "FREE", 0, null);
    const offA = pb.listen(A.match.id, A.player, () => {});
    const B = await pb.queue(o.names?.[1] ?? "Bob", null, "FREE", 0, null);
    const offB = pb.listen(B.match.id, B.player, () => {});
    const id = A.match.id;
    expect(B.match.id).toBe(id);
    vi.advanceTimersByTime(6_000);
    const m0 = pb.get(id, A.player)!;
    expect(m0.seed).not.toBeNull();
    const seed = m0.seed!, startedAt = m0.startedAt!;
    const mk = (me: string, pull: number): Client => ({ ...bot(seed, pull), me, landed: [], got: new Set(), streamed: 0, told: 0, done: false });
    const a = mk(A.player, 175), b = mk(B.player, 150);
    for (let step = 0; step < 900 && !pb.get(id)!.done; step++) {
      vi.advanceTimersByTime(250);
      const clock = Math.floor(((Date.now() - startedAt) * 240) / 1000);
      for (const c of [a, b]) {
        if (c.done) continue;
        const cheater = c === a ? o.cheat : undefined;
        // the relay, read every 250 ms (or every 4 s on a slow link: those attacks land late)
        if (cheater !== "keep" && (!o.slow || c === a || step % 16 === 0)) {
          for (const s of pb.get(id, c.me)!.players.find((p) => !p.you)!.attacks) {
            if (c.got.has(s.n) || c.t.over) continue;
            c.got.add(s.n);
            const at = Math.max(s.at, c.t.tick + 1);
            c.t.receive(s.kind, at); c.landed.push({ n: s.n, at });
          }
        }
        playTo(c, clock);
        if (c.t.over) {
          c.done = true;
          try { pb.finish(id, c.me, { inputs: c.inputs, landed: c.landed, tick: c.t.tick }); } catch (e) { c.error = (e as Error).message; }
          continue;
        }
        if (cheater === "silent") continue;
        const chunk = c.inputs.slice(c.streamed), news = c.landed.slice(c.told);
        const junk = cheater === "fake" ? { sent: Array.from({ length: 20 }, (_, i) => ({ kind: "meteor", tick: i * 300 })), landed: [...news, { n: 999, at: 5 }, { n: 0, at: 1 }] } : {};
        try { pb.progress(id, c.me, { inputs: chunk, from: c.streamed, tick: c.t.tick, landed: news, x: c.t.ball.x, y: c.t.ball.y, ...junk }); c.streamed += chunk.length; c.told += news.length; } catch (e) { c.error = (e as Error).message; }
      }
    }
    offA(); offB();
    const m = pb.get(id, a.me)!, mb = pb.get(id, b.me)!;
    expect(m.done).toBe(true);
    return { id, seed, a, b, m, mb, va: m.players.find((p) => p.you)!, vb: mb.players.find((p) => p.you)! };
  }

  it("verifies exactly what an honest duel played, attacks included (finding 2)", async () => {
    const d = await duel();
    expect(d.a.error).toBeUndefined(); expect(d.b.error).toBeUndefined();
    expect(d.va.score).toBe(d.a.t.score);
    expect(d.vb.score).toBe(d.b.t.score);
    expect(d.a.t.stats.received + d.b.t.stats.received).toBeGreaterThan(0);
    // on a good link every attack lands where the lockstep replay puts it
    expect(duelReplay(d.seed, d.a.inputs, d.b.inputs).scores).toEqual([d.a.t.score, d.b.t.score]);
  });
  it("still verifies what was played when the relay is seconds late (finding 2)", async () => {
    // seeds are dealt at random: play until some attack reached the slow player after it was due
    let late = 0;
    for (let i = 0; i < 8 && !late; i++) {
      const d = await duel({ slow: true });
      const due = new Map(d.mb.players.find((p) => !p.you)!.attacks.map((s) => [s.n, s.at]));
      late += d.b.landed.filter((l) => l.at > due.get(l.n)!).length;
      expect(d.vb.score).toBe(d.b.t.score);
      expect(d.va.score).toBe(d.a.t.score);
    }
    expect(late).toBeGreaterThan(0);
  });
  it("relays only attacks the server found in the sender's game: fake ones change nothing (finding 2)", async () => {
    const d = await duel({ cheat: "fake" });
    const real = d.a.t.events.filter((e) => e.send).map((e) => `${e.send}:${e.tick}`);
    const relayed = d.mb.players.find((p) => !p.you)!.attacks.map((s) => `${s.kind}:${s.tick}`);
    expect(real.slice(0, relayed.length)).toEqual(relayed);
    expect(d.vb.score).toBe(d.b.t.score);
    expect(d.va.score).toBe(d.a.t.score);
  });
  it("a player who withholds their stream cannot inject attacks afterwards, and loses (findings 2, 10)", async () => {
    const before = pb.board().board.length, heard = told.length;
    const d = await duel({ cheat: "silent" });
    expect(d.a.error).toMatch(/late/);
    expect(d.b.landed).toHaveLength(0);
    expect(d.vb.score).toBe(d.b.t.score);
    expect(d.va.score).toBe(0);
    expect(d.mb.winnerIsYou).toBe(true);
    expect(d.m.winnerIsYou).toBe(false);
    // one log only: not a duel for the board, and nothing is announced
    expect(pb.board().board.length).toBe(before);
    expect(told.length).toBe(heard);
  });
  it("a player who never places the attacks sent to them hurts only their own score (finding 2)", async () => {
    const d = await duel({ cheat: "keep" });
    expect(d.vb.score).toBe(d.b.t.score);
    expect(d.va.score).not.toBeNull();
  });
  it("names the winner by player, even when both share a name (finding 9)", async () => {
    const d = await duel({ names: ["", ""] });
    expect(d.va.name).toBe("Night crew");
    expect(d.vb.name).toBe("Night crew");
    expect([d.m.winnerIsYou, d.mb.winnerIsYou].filter(Boolean)).toHaveLength(d.m.draw ? 0 : 1);
    expect(d.m.winnerIsYou).toBe(d.a.t.score > d.b.t.score);
  });
  it("hides the rival's verified score until the match is settled (finding 6)", async () => {
    const A = await pb.queue("P", null, "FREE", 0, null), off = pb.listen(A.match.id, A.player, () => {});
    const B = await pb.queue("Q", null, "FREE", 0, null), off2 = pb.listen(B.match.id, B.player, () => {});
    vi.advanceTimersByTime(6_000);
    const c = bot(pb.get(A.match.id, A.player)!.seed!, 175), start = pb.get(A.match.id)!.startedAt!;
    for (let i = 0; i < 80; i++) {
      vi.advanceTimersByTime(250);
      const n = c.inputs.length; playTo(c, Math.floor(((Date.now() - start) * 240) / 1000));
      pb.progress(A.match.id, A.player, { inputs: c.inputs.slice(n), from: n, tick: c.t.tick });
    }
    const v = pb.get(B.match.id, B.player)!.players.find((p) => !p.you)!;
    expect([v.score, v.solo, v.stats, v.finished]).toEqual([null, null, null, false]);
    // a finish long before the game could have ended on the match clock is refused
    expect(() => pb.finish(A.match.id, A.player, { inputs: c.inputs, tick: c.t.tick })).toThrow(/later than the match/);
    off(); off2();
  });
  it("dissolves a match whose second player never connects, and the first waits again (finding 10)", async () => {
    const A = await pb.queue("Here", null, "FREE", 0, null), off = pb.listen(A.match.id, A.player, () => {});
    const B = await pb.queue("Ghost", null, "FREE", 0, null);
    expect(B.match.id).toBe(A.match.id);
    vi.advanceTimersByTime(6_000);
    const v = pb.get(A.match.id, A.player)!;
    expect(v.startedAt).toBeNull();
    expect(v.seed).toBeNull();
    expect(v.players).toHaveLength(1);
    expect(pb.inMatch(A.match.id, B.player)).toBe(false);
    const C = await pb.queue("Next", null, "FREE", 0, null), off2 = pb.listen(C.match.id, C.player, () => {});
    expect(C.match.id).toBe(A.match.id);
    vi.advanceTimersByTime(6_000);
    expect(pb.get(A.match.id, A.player)!.seed).not.toBeNull();
    off(); off2();
  });
  it("streams few frames and sends faces only in the first (finding 4)", async () => {
    const A = await pb.queue("F", null, "FREE", 0, "/games/pinball/frog-2.webp"), off = pb.listen(A.match.id, A.player, () => {});
    const B = await pb.queue("G", null, "FREE", 0, null);
    const frames: Record<string, unknown>[] = [];
    const off2 = pb.listen(B.match.id, B.player, (v) => frames.push(v.players[0] as never));
    vi.advanceTimersByTime(6_000);
    const n = frames.length;
    for (let i = 0; i < 40; i++) { vi.advanceTimersByTime(25); pb.progress(A.match.id, A.player, { tick: 0, x: i, y: 1 }); }
    expect(frames.length - n).toBeLessThanOrEqual(5);
    expect(frames[0]!.avatar).toBe("/games/pinball/frog-2.webp");
    expect(frames.slice(1).every((f) => !("avatar" in f))).toBe(true);
    off(); off2();
  });
  it("shows a rival only our own frog art, never image bytes from the client (finding 7)", async () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><text>SEND IMD TO 0xBAD</text></svg>").toString("base64")}${"A".repeat(200)}`;
    const A = await pb.queue("H", null, "FREE", 0, svg);
    expect(A.match.players[0]!.avatar).toBeNull();
    const B = await pb.queue("I", null, "FREE", 0, "frog:7"); // no signed-in wallet: no frog
    expect(B.match.players[0]!.avatar ?? null).toBeNull();
    pb.leave(A.match.id, A.player); pb.leave(B.match.id, B.player);
  });
  it("screens names (finding 11)", () => {
    expect(pb.cleanName("NIGHTSHIFT")).toBe("Night crew");
    expect(pb.cleanName("N1ght Sh1ft")).toBe("Night crew");
    expect(pb.cleanName("admin")).toBe("Night crew");
    expect(pb.cleanName("IMD team")).toBe("Night crew");
    expect(pb.cleanName("free airdrop")).toBe("Night crew");
    expect(pb.cleanName("Kodes")).toBe("Kodes");
  });

  describe("solo runs (finding 3)", () => {
    /** A run played on the server's clock, its inputs streamed every 250 ms. */
    function run(who: string) {
      const r = pb.soloStart("Solo", who);
      const c = bot(r.seed, 160);
      let streamed = 0;
      while (!c.t.over) {
        vi.advanceTimersByTime(250);
        playTo(c, Math.floor(((Date.now() - r.startedAt) * 240) / 1000));
        if (c.t.over) break;
        pb.soloProgress(r.id, { inputs: c.inputs.slice(streamed), from: streamed, tick: c.t.tick });
        streamed = c.inputs.length;
      }
      return { r, c };
    }
    it("verifies a streamed run played on its clock", () => {
      const { r, c } = run("ip:1");
      const v = pb.soloFinish(r.id, c.inputs);
      expect(v.score).toBe(c.t.score);
      expect(v.rank).not.toBeNull();
    });
    it("keeps one open run per player", () => {
      pb.soloStart("x", "ip:2");
      expect(() => pb.soloStart("x", "ip:2")).toThrow(/still open/);
      expect(() => pb.soloStart("x", "ip:3")).not.toThrow();
    });
    it("refuses a log that is not what was streamed, or that was never streamed", () => {
      const a = pb.soloStart("x", "ip:4");
      const c = bot(a.seed, 160);
      vi.advanceTimersByTime(250); playTo(c, 60);
      pb.soloProgress(a.id, { inputs: c.inputs, from: 0, tick: 60 });
      expect(() => pb.soloFinish(a.id, [[0, 1, 0, 0], ...c.inputs.slice(1)])).toThrow(/do not match/);
      // the audit's case: a 4-input log sent 10 s after the start, never streamed
      const b = pb.soloStart("x", "ip:5");
      vi.advanceTimersByTime(10_000);
      expect(() => pb.soloFinish(b.id, [[0, 0, 0, 1], [180, 0, 0, 0], [927, 0, 0, 1], [1107, 0, 0, 0]])).toThrow();
    });
    it("refuses inputs ahead of the clock, and a run past its time", () => {
      const a = pb.soloStart("x", "ip:6");
      vi.advanceTimersByTime(1_000);
      expect(() => pb.soloProgress(a.id, { inputs: [[600, 0, 0, 1]], from: 0, tick: 0 })).toThrow(/later/);
      const b = pb.soloStart("x", "ip:7");
      vi.advanceTimersByTime(86_400_000);
      expect(() => pb.soloFinish(b.id, [])).toThrow(/expired/);
    });
    it("refuses a finish that comes before the game could have been played", () => {
      const a = pb.soloStart("x", "ip:8");
      vi.advanceTimersByTime(250);
      // nothing streamed but a held plunger: the replayed game runs to the full 150 s
      pb.soloProgress(a.id, { inputs: [[0, 0, 0, 1]], from: 0, tick: 60 });
      expect(() => pb.soloFinish(a.id, [[0, 0, 0, 1]])).toThrow(/later than the run/);
    });
  });

  it("stops a ball ping-ponging between the slingshots (seen on a phone, 2026-10-19)", () => {
    const t = new Table(4) as unknown as { ball: { x: number; y: number; vx: number; vy: number }; inLane: boolean; step(): void; events: { kind: string }[] };
    t.inLane = false; t.ball.x = 390; t.ball.y = 590; t.ball.vx = -500; t.ball.vy = -650;
    for (let k = 0; k < 2400; k++) t.step();
    expect(t.events.filter((e) => e.kind === "sling").length).toBeLessThan(12);
  });
});
