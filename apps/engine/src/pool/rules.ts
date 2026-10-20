/**
 * NIGHT POOL: the rules of 8-ball, as the World Pool-Billiards Association writes them (WPA Rules
 * of Play, effective 2025-09-15: section 4 "8-Ball" and the general rules it refers to, 1.5 Spotting
 * Balls, 1.6 Cue-ball in Hand, 1.7 Standard Call Shot, 2.7 Driven to a Rail, 3 Fouls). Pure
 * functions of the rack and of what the physics says happened during a shot: the server judges
 * every shot with them; the browser uses the same file for practice and for its hints.
 *
 * The groups and the shape of the judgement follow pooltool's ruleset/eight_ball.py (Apache-2.0,
 * see LICENSE-pooltool.txt): legal shot, turn over, game over, the next hittable group. Extended by
 * NIGHTSHIFT to the WPA rules: the break options (4.3), the open table and the 8-ball when a group
 * is cleared (4.4), called shots and safeties (1.7, 4.6), losing the rack (4.8), cue-ball in hand
 * anywhere after a foul and above the head string after a break foul (4.9, 3.10, 3.11), spotting the
 * 8 (1.5, 4.7), and three consecutive fouls (3.13) as an option (WPA 8-ball does not use it).
 *
 * Not modelled, because an online table cannot have them: no foot on floor, touched ball, double hit,
 * push shot, balls still moving, rack template; balls driven off the table (the physics keeps every
 * ball on the cloth). Slow play under the shot clock (3.14) is a foul the game itself calls.
 *
 * Keep apps/engine/src/pool/rules.ts byte-identical to apps/web/src/pool/rules.ts (a test checks it).
 */
import { type Ball, CONTACT, EV, type Frame, HEAD_Y, JAWS, LINES, POCKETED, R, path, rack, spot } from "./physics.js";

export type Group = "solids" | "stripes";
export const SOLIDS = [1, 2, 3, 4, 5, 6, 7] as const;
export const STRIPES = [9, 10, 11, 12, 13, 14, 15] as const;
export const groupOf = (id: number): Group | null => (id >= 1 && id <= 7 ? "solids" : id >= 9 && id <= 15 ? "stripes" : null);
const other = (g: Group): Group => (g === "solids" ? "stripes" : "solids");
const ballsOf = (g: Group): readonly number[] => (g === "solids" ? SOLIDS : STRIPES);
export type Seat = 0 | 1;
/** Where the incoming shooter may put the cue ball: nowhere (it plays from where it lies), above the head string, anywhere. */
export type InHand = "none" | "kitchen" | "anywhere";
/** A call: one ball and one pocket (0–5, physics POCKETS), or a safety (1.7); none on the break. */
export type Call = { ball: number; pocket: number } | "safety" | null;
export type Foul = "scratch" | "no-contact" | "wrong-ball" | "no-rail" | "kitchen" | "time";
/** A choice the rules hand to one player before play goes on (4.3 d, e, f). */
export type Decision =
  | { kind: "illegal-break"; by: Seat; options: ("accept" | "rebreak" | "rebreak-other")[] }
  | { kind: "eight-break"; by: Seat; options: ("spot" | "rebreak")[] }
  | { kind: "eight-break-foul"; by: Seat; options: ("spot" | "rebreak")[] };
export type Choice = "accept" | "rebreak" | "rebreak-other" | "spot";
/** The rules a table is played under: WPA (every shot called, ball and pocket) or quick (only the 8 is called; any ball of yours keeps you at the table). */
export type Options = { calls: "all" | "eight"; threeFouls: boolean };
export const WPA: Options = { calls: "all", threeFouls: false };
export const QUICK: Options = { calls: "eight", threeFouls: false };
export type Rack = {
  balls: Ball[];
  /** Who shoots now, and who broke this rack. */
  turn: Seat; breaker: Seat;
  groups: [Group | null, Group | null];
  phase: "break" | "play" | "over";
  inHand: InHand;
  /** Fouls in a row, per player (for three consecutive fouls, and to warn on two). */
  fouls: [number, number];
  decision: Decision | null;
  winner: Seat | null; reason: string | null;
  /** Shots played in this rack, and racks dealt in this game (a re-break deals a new one). */
  shots: number; racks: number;
  /** The game's seed: rack n is dealt from seed + n. */
  seed: number;
};
/** What happened in a shot, as the rules read it. */
export type Summary = {
  /** The first object ball the cue ball touched, and when. */
  first: number | null; firstAt: number;
  /** The balls pocketed, in order, and in which pocket. */
  pocketed: { id: number; pocket: number }[];
  scratch: boolean;
  /** Balls driven to a rail at or after the first contact (2.7: a pocketed ball counts too). */
  railAfter: number[];
  /** Object balls driven to a rail in the whole shot, pocketed ones included (the break needs four). */
  railBalls: number[];
  /** The cue ball went past the head string before its first contact (3.11). */
  crossed: boolean;
};

/** A new game: rack 0 dealt from the seed, this player to break with the cue ball in hand above the head string. */
export function newRack(seed: number, breaker: Seat): Rack {
  return { balls: rack(seed), turn: breaker, breaker, groups: [null, null], phase: "break", inHand: "kitchen", fouls: [0, 0], decision: null, winner: null, reason: null, shots: 0, racks: 0, seed };
}
const onTable = (r: Rack, id: number) => r.balls.some((b) => b.id === id && b.s !== POCKETED);
const cleared = (r: Rack, g: Group) => ballsOf(g).every((id) => !onTable(r, id));
/**
 * The player shoots at the 8 now: their group is off the table; or, on an open table, a whole group
 * is already pocketed and they claim it (4.4).
 */
export function onEight(r: Rack, seat: Seat): boolean {
  const g = r.groups[seat];
  if (g) return cleared(r, g);
  return r.phase === "play" && (cleared(r, "solids") || cleared(r, "stripes"));
}
/** The balls the shooter may strike first (and call): their group, the 8 once it is cleared, any but the 8 on an open table. */
export function targets(r: Rack, seat: Seat = r.turn): number[] {
  const g = r.groups[seat];
  if (r.phase === "break") return [...SOLIDS, 8, ...STRIPES].filter((id) => onTable(r, id));
  if (g) return cleared(r, g) ? [8] : ballsOf(g).filter((id) => onTable(r, id));
  const open = [...SOLIDS, ...STRIPES].filter((id) => onTable(r, id));
  return onEight(r, seat) ? [...open, 8] : open;
}
/** Why a call cannot be made before this shot, or null. */
export function badCall(r: Rack, call: Call, o: Options): string | null {
  if (r.phase === "break") return call === null ? null : "The break is not called.";
  if (call === "safety") return null;
  const eight = onEight(r, r.turn) && (r.groups[r.turn] !== null || call?.ball === 8);
  if (call === null) return o.calls === "all" ? "Call a ball and a pocket, or a safety." : eight && r.groups[r.turn] ? "Call the pocket for the 8-ball." : null;
  if (!Number.isInteger(call.ball) || !Number.isInteger(call.pocket) || call.pocket < 0 || call.pocket > 5) return "Call one ball and one of the six pockets.";
  if (!targets(r).includes(call.ball)) return call.ball === 8 ? "The 8-ball comes last: clear your group first." : "Call a ball you may play: one of your group.";
  if (o.calls === "eight" && call.ball !== 8 && eight) return "Call the pocket for the 8-ball.";
  return null;
}

// ---- reading a shot

/** The cushions a ball is frozen to at the start of a shot (2.7): rails and jaws within half a millimetre of the nose. */
function frozen(b: Ball): Set<string> {
  const out = new Set<string>();
  LINES.forEach(([x1, y1, x2, y2, nx, ny], k) => {
    const d = nx * (b.x - x1) + ny * (b.y - y1) - CONTACT, sx = x2 - x1, sy = y2 - y1, u = ((b.x - x1) * sx + (b.y - y1) * sy) / (sx * sx + sy * sy);
    if (d < 0.0005 && u >= 0 && u <= 1) out.add(`r${k}`);
  });
  JAWS.forEach(([x, y, r], k) => { const dx = b.x - x, dy = b.y - y; if (Math.sqrt(dx * dx + dy * dy) - r - R < 0.0005) out.add(`j${k}`); });
  return out;
}
/** How far a ball's centre is from a rail's or a jaw's contact line (positive on the cloth). */
function away(b: Ball, key: string): number {
  const k = Number(key.slice(1));
  if (key[0] === "r") { const [x1, y1, , , nx, ny] = LINES[k]!; return nx * (b.x - x1) + ny * (b.y - y1) - CONTACT; }
  const [x, y, r] = JAWS[k]!, dx = b.x - x, dy = b.y - y;
  return Math.sqrt(dx * dx + dy * dy) - r - R;
}
/** What the physics says happened, in the rules' terms. */
export function summarize(start: readonly Ball[], frames: readonly Frame[]): Summary {
  const firstHit = frames.find((f) => f.k === EV.BALL && (f.a === 0 || f.b === 0));
  const first = firstHit ? (firstHit.a === 0 ? firstHit.b : firstHit.a) : null, firstAt = firstHit ? firstHit.t : Infinity;
  const pocketed = frames.filter((f) => f.k === EV.POCKET).map((f) => ({ id: f.a, pocket: f.b }));
  // a ball frozen to a cushion is driven to it only if it leaves it and comes back (2.7)
  const frozenTo = new Map(start.filter((b) => b.s !== POCKETED).map((b) => [b.id, frozen(b)]));
  const left = new Set<string>();
  const rail: { id: number; t: number }[] = [];
  for (const f of frames) {
    for (const b of f.balls) for (const key of frozenTo.get(b.id) ?? []) if (away(b, key) > 0.002) left.add(`${b.id}:${key}`);
    if (f.k !== EV.RAIL && f.k !== EV.JAW) continue;
    const key = `${f.k === EV.RAIL ? "r" : "j"}${f.b}`;
    if (frozenTo.get(f.a)?.has(key) && !left.has(`${f.a}:${key}`)) continue;
    rail.push({ id: f.a, t: f.t });
  }
  const railAfter = [...new Set([...rail.filter((x) => x.t >= firstAt).map((x) => x.id), ...pocketed.map((p) => p.id)])].sort((a, b) => a - b);
  const railBalls = [...new Set([...rail.map((x) => x.id), ...pocketed.map((p) => p.id)])].filter((id) => id > 0).sort((a, b) => a - b);
  // the cue ball's centre past the head string before the first contact: at a keyframe, or at the top of a curve between two
  let crossed = false, last = start.find((b) => b.id === 0);
  const past = (b: Ball | undefined, span: number) => {
    if (!b) return false;
    const [, cy, , vy, , ay] = path(b);
    if (cy >= HEAD_Y) return true;
    if (ay < 0 && vy > 0) { const t = -vy / (2 * ay); if (t <= span && cy + vy * t + ay * t * t >= HEAD_Y) return true; }
    const end = cy + vy * span + ay * span * span;
    return end >= HEAD_Y;
  };
  let lastT = 0;
  for (const f of frames) {
    if (f.t > firstAt) break;
    const cue = f.balls.find((b) => b.id === 0);
    if (!cue) continue;
    if (last && f.t > lastT && past(last, f.t - lastT)) { crossed = true; break; }
    if (cue.y >= HEAD_Y) { crossed = true; break; }
    last = cue; lastT = f.t;
  }
  if (!crossed && last && firstAt !== Infinity && past(last, firstAt - lastT)) crossed = true;
  return { first, firstAt, pocketed, scratch: pocketed.some((p) => p.id === 0), railAfter, railBalls, crossed };
}

// ---- judging a shot

export type Verdict = {
  /** The foul committed, if any (only the most serious one counts, 3). */
  foul: Foul | null;
  /** In words, for both players. */
  text: string;
  /** The shooter stays at the table. */
  again: boolean;
  /** The groups were decided by this shot. */
  assigned: boolean;
  pocketed: number[];
  /** The rack is over: who won and why. */
  winner: Seat | null; reason: string | null;
};
const FOUL_TEXT: Record<Foul, string> = {
  scratch: "Scratch: the cue ball went into a pocket.",
  "no-contact": "Foul: the cue ball touched no ball.",
  "wrong-ball": "Foul: the first ball hit was not one of the shooter's.",
  "no-rail": "Foul: no ball reached a rail after the contact, and nothing dropped.",
  kitchen: "Foul: from the kitchen, the cue ball must cross the head string or hit a ball on or past it first.",
  time: "Foul: the shot clock ran out.",
};
const label = (id: number) => (id === 8 ? "the 8-ball" : `the ${id}`);
/** "the 3", "the 3 and the 11", "the 3, the 9 and the 11". */
const list = (ids: number[]) => { const l = ids.map(label); return l.length < 2 ? l.join("") : `${l.slice(0, -1).join(", ")} and ${l.at(-1)}`; };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const drop = (ids: number[]) => `${cap(list(ids))} ${ids.length > 1 ? "drop" : "drops"}`;
/** The rack after a player's turn passes, with or without a foul. */
function pass(r: Rack, foul: boolean): void {
  const s = r.turn;
  r.turn = (1 - s) as Seat;
  r.inHand = foul ? "anywhere" : "none";
}
/** Ends the rack. */
function end(r: Rack, winner: Seat, reason: string): void { r.phase = "over"; r.winner = winner; r.reason = reason; r.decision = null; r.inHand = "none"; }

/**
 * Judges one shot played from `before` (the rack as it was) to the balls `after`, with what the
 * physics summary says happened. Returns the next rack and the verdict. The call was checked with
 * badCall() before the shot.
 */
export function judge(before: Rack, call: Call, after: readonly Ball[], sum: Summary, o: Options = WPA): { rack: Rack; verdict: Verdict } {
  const r: Rack = { ...before, balls: after.map((b) => ({ ...b })), groups: [...before.groups] as Rack["groups"], fouls: [...before.fouls] as Rack["fouls"], decision: null, shots: before.shots + 1 };
  const s = before.turn, opp = (1 - s) as Seat;
  const potted = sum.pocketed.map((p) => p.id).filter((id) => id > 0);
  const eight = sum.pocketed.find((p) => p.id === 8);
  const v: Verdict = { foul: null, text: "", again: false, assigned: false, pocketed: potted, winner: null, reason: null };
  const finish = (w: Seat, why: string) => { end(r, w, why); v.winner = w; v.reason = why; v.text = why; return { rack: r, verdict: v }; };
  const fouled = (f: Foul) => {
    v.foul = f; v.text = FOUL_TEXT[f];
    r.fouls[s]++;
    if (o.threeFouls && r.fouls[s] >= 3) return finish(opp, "Three fouls in a row lose the rack.");
    pass(r, true);
    return { rack: r, verdict: v };
  };

  // ---- the break (4.3)
  if (before.phase === "break") {
    r.phase = "play";
    const legal = potted.length > 0 || sum.railBalls.length >= 4;
    if (eight) {
      if (sum.scratch) {
        r.fouls[s]++; v.foul = "scratch";
        v.text = "The 8-ball dropped on a scratch: the opponent spots it and takes the cue ball in hand above the head string, or breaks again.";
        r.turn = opp; r.inHand = "kitchen";
        r.decision = { kind: "eight-break-foul", by: opp, options: ["spot", "rebreak"] };
        return { rack: r, verdict: v };
      }
      v.text = "The 8-ball dropped on the break. The breaker spots it and plays on, or breaks again.";
      r.fouls[s] = 0;
      r.decision = { kind: "eight-break", by: s, options: ["spot", "rebreak"] };
      return { rack: r, verdict: v };
    }
    if (!legal) {
      v.text = `Illegal break: no ball dropped and only ${sum.railBalls.length} reached a rail (four are needed). The opponent accepts the table, or re-racks.`;
      if (sum.scratch) { v.foul = "scratch"; r.fouls[s]++; } else r.fouls[s] = 0;
      r.turn = opp; r.inHand = sum.scratch ? "kitchen" : "none";
      r.decision = { kind: "illegal-break", by: opp, options: ["accept", "rebreak", "rebreak-other"] };
      return { rack: r, verdict: v };
    }
    if (sum.scratch) {
      v.foul = "scratch"; r.fouls[s]++;
      v.text = "Scratch on the break. The table is open; the opponent has the cue ball in hand above the head string.";
      r.turn = opp; r.inHand = "kitchen";
      kitchen(r);
      if (o.threeFouls && r.fouls[s] >= 3) return finish(opp, "Three fouls in a row lose the rack.");
      return { rack: r, verdict: v };
    }
    r.fouls[s] = 0; r.inHand = "none";
    if (potted.length) { v.again = true; v.text = `A legal break: ${list(potted)} ${potted.length > 1 ? "drop" : "drops"}. The table is open; the breaker plays on.`; }
    else { v.text = "A legal break. Nothing dropped: the table is open."; pass(r, false); }
    return { rack: r, verdict: v };
  }

  // ---- every other shot
  const legalFirst = targets(before, s);
  const shootingEight = onEight(before, s) && (before.groups[s] !== null || (call !== "safety" && call?.ball === 8));
  const foul: Foul | null = sum.scratch ? "scratch"
    : sum.first === null ? "no-contact"
    : !legalFirst.includes(sum.first) || (!shootingEight && sum.first === 8) ? "wrong-ball"
    : before.inHand === "kitchen" && !sum.crossed && (before.balls.find((b) => b.id === sum.first)?.y ?? HEAD_Y) < HEAD_Y - R ? "kitchen"
    : potted.length === 0 && !sum.railAfter.length ? "no-rail"
    : null;
  // the 8-ball decides the rack (4.8)
  if (eight) {
    const called = call !== null && call !== "safety" && call.ball === 8;
    if (!shootingEight) return finish(opp, "The 8-ball dropped before the shooter's group was cleared: the rack is lost.");
    if (foul) return finish(opp, `The 8-ball dropped on a foul (${FOUL_TEXT[foul].replace(/^[^:]*: /, "").replace(/\.$/, "")}): the rack is lost.`);
    if (o.calls === "all" || before.groups[s] !== null || called) {
      if (!called) return finish(opp, "The 8-ball dropped without being called: the rack is lost.");
      if (call.pocket !== eight.pocket) return finish(opp, "The 8-ball dropped in a pocket that was not called: the rack is lost.");
    }
    return finish(s, "The 8-ball in the called pocket: the rack is won.");
  }
  if (foul) return fouled(foul);
  r.fouls[s] = 0; r.inHand = "none";
  if (call === "safety") {
    v.text = potted.length ? `Safety: ${list(potted)} ${potted.length > 1 ? "stay" : "stays"} down; the opponent shoots.` : "Safety. The opponent shoots.";
    pass(r, false);
    return { rack: r, verdict: v };
  }
  const g = before.groups[s];
  let made: boolean;
  if (o.calls === "all") {
    made = call !== null && sum.pocketed.some((p) => p.id === call.ball && p.pocket === call.pocket);
    if (made && !g) { const ng = groupOf((call as { ball: number }).ball)!; r.groups[s] = ng; r.groups[opp] = other(ng); v.assigned = true; }
  } else if (!g) {
    const firstGroup = potted.map(groupOf).find((x): x is Group => x !== null);
    made = !!firstGroup;
    if (firstGroup) { r.groups[s] = firstGroup; r.groups[opp] = other(firstGroup); v.assigned = true; }
  } else made = potted.some((id) => groupOf(id) === g);
  const mine = r.groups[s];
  if (made) {
    v.again = true;
    v.text = `${drop(potted)}${v.assigned && mine ? `: ${mine} for the shooter, ${other(mine)} for the opponent` : ""}. The shooter plays on${mine && cleared(r, mine) ? ", on the 8-ball" : ""}.`;
  } else {
    v.text = potted.length ? `${drop(potted)}, but not the called ball in the called pocket. The opponent shoots.` : "Nothing dropped. The opponent shoots.";
    pass(r, false);
  }
  return { rack: r, verdict: v };
}

/** The shot clock ran out (3.14 with a shot clock): a standard foul, ball in hand to the opponent. */
export function timeFoul(before: Rack, o: Options = WPA): { rack: Rack; verdict: Verdict } {
  const r: Rack = { ...before, balls: before.balls.map((b) => ({ ...b })), groups: [...before.groups] as Rack["groups"], fouls: [...before.fouls] as Rack["fouls"], decision: null };
  const s = before.turn, opp = (1 - s) as Seat;
  const v: Verdict = { foul: "time", text: FOUL_TEXT.time, again: false, assigned: false, pocketed: [], winner: null, reason: null };
  r.fouls[s]++;
  if (o.threeFouls && r.fouls[s] >= 3) { end(r, opp, "Three fouls in a row lose the rack."); v.winner = opp; v.reason = r.reason; v.text = r.reason!; return { rack: r, verdict: v }; }
  // a break that never came: the opponent breaks instead (still from the kitchen)
  if (before.phase === "break") { r.turn = opp; r.breaker = opp; r.inHand = "kitchen"; return { rack: r, verdict: v }; }
  pass(r, true);
  return { rack: r, verdict: v };
}

/**
 * 1.6: with the cue ball in hand above the head string and every ball the shooter may play above it
 * too, the legal object ball nearest the head string is spotted (done for the shooter, who may ask).
 */
function kitchen(r: Rack): void {
  if (r.inHand !== "kitchen" || r.phase !== "play") return;
  const legal = targets(r).map((id) => r.balls.find((b) => b.id === id)!).filter(Boolean);
  if (!legal.length || legal.some((b) => b.y >= HEAD_Y - R)) return;
  const near = [...legal].sort((a, b) => b.y - a.y || a.id - b.id)[0]!;
  const p = spot(r.balls, near.id);
  near.x = p.x; near.y = p.y;
}

/** The player the rules asked chooses (4.3 d, e, f). */
export function decide(before: Rack, seat: Seat, choice: Choice): Rack {
  const d = before.decision;
  if (!d || d.by !== seat) throw new Error("There is no choice for you to make.");
  if (!(d.options as Choice[]).includes(choice)) throw new Error("That is not one of the options.");
  const r: Rack = { ...before, balls: before.balls.map((b) => ({ ...b })), decision: null };
  const rerack = (breaker: Seat): Rack => ({ ...newRack(before.seed + before.racks + 1, breaker), racks: before.racks + 1, fouls: [...before.fouls] as Rack["fouls"], shots: before.shots });
  if (d.kind === "illegal-break") {
    if (choice === "rebreak") return rerack(seat);
    if (choice === "rebreak-other") return rerack((1 - seat) as Seat);
    // accepted: the incoming player shoots the table as it lies (the cue ball in hand above the head string after a scratch)
    r.turn = seat; r.phase = "play";
    kitchen(r);
    return r;
  }
  if (choice === "rebreak") return rerack(seat);
  // the 8 is spotted (1.5, 4.7): the breaker plays on, or after a foul the opponent shoots from the kitchen
  const eight = r.balls.find((b) => b.id === 8)!, p = spot(r.balls.filter((b) => b.id !== 8), 8);
  Object.assign(eight, { x: p.x, y: p.y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, s: 0 });
  r.turn = seat; r.phase = "play";
  r.inHand = d.kind === "eight-break-foul" ? "kitchen" : "none";
  kitchen(r);
  return r;
}

/** The default when the chooser lets the clock run out: take the table (accept, or spot the 8). */
export const defaultChoice = (d: Decision): Choice => (d.kind === "illegal-break" ? "accept" : "spot");

/** Balls left per group, and who is on the 8: what a scoreboard and the betting weights read. */
export function standing(r: Rack): { left: [number, number]; eight: [boolean, boolean] } {
  const left = (seat: Seat) => { const g = r.groups[seat]; return g ? ballsOf(g).filter((id) => onTable(r, id)).length : 7; };
  return { left: [left(0), left(1)], eight: [onEight(r, 0) && r.groups[0] !== null, onEight(r, 1) && r.groups[1] !== null] };
}
