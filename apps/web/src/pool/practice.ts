import type { MatchView, ShotInput } from "./api";
import { plan } from "./bot";
import { HEAD_Y, POCKETED, STILL, fits, simulate } from "./physics";
import { type Rack, QUICK, WPA, badCall, decide, judge, newRack, onEight, standing, summarize, targets } from "./rules";

/**
 * A practice table in the browser against Frog #7, the practice frog (bot.ts): the very physics
 * and rules the server uses, run here, so practice plays exactly like a real table. Nothing is
 * rated or sent anywhere.
 */
const LOOK = { cue: "cue-crew", cloth: "cloth-night", table: "table-shift", balls: "balls-classic", frame: "frame-none", banner: "banner-shift", title: "title-crew", effect: "effect-sparks", emotes: ["emote-gg", "emote-nice", "emote-oops"], level: 1, guide: 1 };
export class Practice {
  rack: Rack;
  n = 0;
  version = 0;
  last: MatchView["last"] = null;
  log: MatchView["log"] = [];
  turnAt = Date.now();
  done = false;
  winner: 0 | 1 | null = null;
  constructor(readonly name: string, readonly rules: "wpa" | "quick", readonly look = LOOK) {
    this.rack = newRack(Math.floor(Math.random() * 2 ** 31), 0);
  }
  private get opts() { return this.rules === "wpa" ? WPA : QUICK; }
  view(): MatchView {
    const r = this.rack, st = standing(r), now = Date.now();
    return {
      id: "practice", rules: this.rules, currency: "FREE", stake: null, escrow: null, version: this.version, now, startedAt: now - 10_000, status: this.done ? "finished" : "playing",
      balls: r.balls, turn: r.turn, breaker: r.breaker, phase: r.phase, groups: r.groups, inHand: r.inHand, fouls: r.fouls, decision: r.decision, racks: r.racks,
      targets: this.done ? [] : targets(r), onEight: [onEight(r, 0), onEight(r, 1)], left: st.left, headY: HEAD_Y,
      clock: { turnAt: this.turnAt, ms: 3_600_000, deadline: this.turnAt + 3_600_000 },
      last: this.last, log: this.log.slice(-14), aim: null, emotes: [],
      done: this.done, reason: this.done ? "rack" : null, rackReason: r.reason, winner: this.winner, winnerIsYou: this.winner === 0,
      you: 0, rematchRequested: false, rivalWantsRematch: false, rematchId: null, waitingSince: now, expired: null, movedTo: null,
      players: [
        { name: this.name || "Night crew", seat: 0, rating: 1200, you: true, connected: true, group: r.groups[0], shots: 0, potted: 0, look: this.look },
        { name: "Frog #7", seat: 1, rating: 1200, you: false, connected: true, group: r.groups[1], shots: 0, potted: 0, look: { ...LOOK, frame: "frame-lily", title: "title-hustler", avatar: "/games/pinball/frog-3.webp", cue: "cue-lily" } },
      ],
    };
  }
  /** A shot by whoever is to play, checked as the server checks it. */
  shoot(seat: 0 | 1, s: ShotInput): void {
    const r = this.rack;
    if (this.done || r.turn !== seat || r.decision) throw new Error("Not your shot.");
    const bad = badCall(r, s.call, this.opts);
    if (bad) throw new Error(bad);
    const start = r.balls.map((b) => ({ ...b }));
    const cue = start.find((b) => b.id === 0)!;
    if (r.inHand !== "none") {
      if (!s.cue || !fits(start, 0, s.cue.x, s.cue.y) || (r.inHand === "kitchen" && !(s.cue.y < HEAD_Y))) throw new Error("The cue ball must sit on the cloth without touching another ball" + (r.inHand === "kitchen" ? ", behind the head string." : "."));
      Object.assign(cue, { x: s.cue.x, y: s.cue.y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, s: STILL });
    } else if (cue.s === POCKETED) throw new Error("The cue ball is not on the table.");
    const shot = { aim: s.aim, power: s.power, spinX: s.spinX, spinY: s.spinY, elevation: s.elevation };
    const res = simulate(start, shot);
    const { rack, verdict } = judge({ ...r, balls: start }, s.call, res.balls, summarize(start, res.frames), this.opts);
    this.n++;
    const replayMs = Math.min(res.duration * 1000, 12_000) + 700;
    this.last = { n: this.n, seat, at: Date.now(), call: s.call, duration: res.duration, replayMs, verdict, shot, start, frames: res.frames };
    this.log.push({ n: this.n, seat, text: verdict.text, foul: verdict.foul, at: Date.now() });
    this.rack = rack; this.turnAt = Date.now() + replayMs;
    if (rack.phase === "over") { this.done = true; this.winner = rack.winner; }
    this.version++;
  }
  choose(seat: 0 | 1, choice: string): void {
    if (!this.rack.decision || this.rack.decision.by !== seat) throw new Error("No choice for you to make.");
    const racks = this.rack.racks;
    this.rack = decide(this.rack, seat, choice as never);
    if (this.rack.racks !== racks) this.last = null;
    this.turnAt = Date.now(); this.version++;
  }
  /** The frog's turn (a shot or a choice), when it is due. */
  bot(): boolean {
    const r = this.rack;
    if (this.done || Date.now() < this.turnAt + 900) return false;
    if (r.decision?.by === 1) { this.choose(1, r.decision.options.includes("accept" as never) ? "accept" : "spot"); return true; }
    if (r.turn !== 1 || r.decision) return false;
    const p = plan(r, this.opts);
    try { this.shoot(1, { ...p.shot, call: p.call, ...(p.cue ? { cue: p.cue } : {}) }); } catch { this.shoot(1, { ...p.shot, call: this.rules === "wpa" ? "safety" : null, ...(p.cue ? { cue: p.cue } : {}) }); }
    return true;
  }
}
