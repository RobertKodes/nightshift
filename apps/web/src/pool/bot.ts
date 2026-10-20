/**
 * NIGHT POOL's practice frog: a simple shot planner. For every ball the shooter may play and every
 * pocket it looks for a clear straight pot (the ghost-ball line), prefers the straightest and
 * shortest, and calls it; with nothing on, it plays a safety off the nearest ball of theirs. With
 * the cue ball in hand it lines up a straight pot first. It plays from inputs only, like a person:
 * the server simulates its shots as it does anyone's. Used by the practice table and by the tests.
 *
 * Keep apps/engine/src/pool/bot.ts byte-identical to apps/web/src/pool/bot.ts (a test checks it).
 */
import { type Ball, BREAK_SPOT, FOOT_X, FOOT_Y, HEAD_Y, POCKETED, POCKETS, R, type Shot, W, L, fits } from "./physics.js";
import { type Call, type Options, type Rack, WPA, onEight, targets } from "./rules.js";

export type Plan = { shot: Shot; call: Call; cue?: { x: number; y: number } };
/** An angle in thousandths of a degree, 0–359999, from a direction. */
export const mdeg = (dx: number, dy: number) => { let a = Math.round(Math.atan2(dy, dx) * 180000 / Math.PI); if (a < 0) a += 360000; return a % 360000; };
/** The closest the segment a→b comes to a point. */
function gap(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}
/** Where to aim inside a pocket: a little in from its centre, toward the table. */
function mouth(k: number): { x: number; y: number } {
  const [px, py] = POCKETS[k]!, cx = W / 2, cy = L / 2, d = Math.hypot(cx - px, cy - py);
  return { x: px + (cx - px) / d * 0.03, y: py + (cy - py) / d * 0.03 };
}
type Pot = { id: number; pocket: number; score: number; aim: number; power: number };
/** The best straight pot from the cue ball where it is, if any. */
function bestPot(balls: readonly Ball[], cue: { x: number; y: number }, ids: readonly number[]): Pot | null {
  let best: Pot | null = null;
  const live = balls.filter((b) => b.s !== POCKETED && b.id !== 0);
  for (const id of ids) {
    const o = live.find((b) => b.id === id);
    if (!o) continue;
    for (let k = 0; k < POCKETS.length; k++) {
      const m = mouth(k), ux0 = m.x - o.x, uy0 = m.y - o.y, op = Math.hypot(ux0, uy0), ux = ux0 / op, uy = uy0 / op;
      const gx = o.x - ux * 2 * R, gy = o.y - uy * 2 * R, cgx = gx - cue.x, cgy = gy - cue.y, cg = Math.hypot(cgx, cgy);
      if (cg < 1e-6) continue;
      const cos = (cgx * ux + cgy * uy) / cg;
      if (cos < 0.3) continue;
      // nothing in the way of the cue ball to the ghost ball, or of the object ball to the pocket
      if (live.some((b) => b.id !== id && gap(cue.x, cue.y, gx, gy, b.x, b.y) < 2 * R + 0.002)) continue;
      if (live.some((b) => b.id !== id && gap(o.x, o.y, m.x, m.y, b.x, b.y) < 2 * R + 0.002)) continue;
      const score = cos * cos / (cg + op + 0.3);
      const power = Math.round(Math.max(140, Math.min(820, 160 + 300 * (cg + op * 1.3) / Math.max(0.35, cos))));
      if (!best || score > best.score) best = { id, pocket: k, score, aim: mdeg(cgx, cgy), power };
    }
  }
  return best;
}
/** A shot for whoever is to play this rack. */
export function plan(r: Rack, o: Options = WPA): Plan {
  const cueBall = r.balls.find((b) => b.id === 0)!;
  const flat = (aim: number, power: number): Shot => ({ aim, power, spinX: 0, spinY: 0, elevation: 0 });
  if (r.phase === "break") return { shot: flat(mdeg(FOOT_X - BREAK_SPOT.x, FOOT_Y - BREAK_SPOT.y), 1000), call: null, cue: { ...BREAK_SPOT } };
  const ids = targets(r), eight = ids.length === 1 && ids[0] === 8, claimEight = !r.groups[r.turn] && onEight(r, r.turn);
  const legal = claimEight ? ids.filter((id) => id !== 8) : ids;
  let cue = r.inHand === "none" ? { x: cueBall.x, y: cueBall.y } : null;
  if (!cue) {
    // in hand: behind a pottable ball on its line to a pocket, else a free spot
    const kitchen = r.inHand === "kitchen";
    for (const d of [0.25, 0.4, 0.15]) {
      const live = r.balls.filter((b) => b.s !== POCKETED && b.id !== 0);
      const order = legal.map((id) => live.find((b) => b.id === id)).filter((b): b is Ball => !!b);
      for (const ob of order) for (let k = 0; k < POCKETS.length && !cue; k++) {
        const m = mouth(k), dx = m.x - ob.x, dy = m.y - ob.y, n = Math.hypot(dx, dy);
        const x = ob.x - dx / n * (2 * R + d), y = ob.y - dy / n * (2 * R + d);
        if ((!kitchen || y < HEAD_Y - 0.001) && fits(r.balls, 0, x, y) && bestPot(r.balls, { x, y }, [ob.id])) cue = { x, y };
      }
      if (cue) break;
    }
    cue ??= [{ ...BREAK_SPOT }, { x: W / 2, y: L / 2 }, { x: W / 4, y: HEAD_Y / 2 }, { x: 3 * W / 4, y: HEAD_Y / 2 }].find((p) => (r.inHand !== "kitchen" || p.y < HEAD_Y) && fits(r.balls, 0, p.x, p.y)) ?? { ...BREAK_SPOT };
  }
  const pot = bestPot(r.balls, cue, legal);
  const placed = r.inHand !== "none" ? { cue } : {};
  if (pot) return { shot: flat(pot.aim, pot.power), call: { ball: pot.id, pocket: pot.pocket }, ...placed };
  // nothing on: roll into the nearest ball of ours, firm enough for a rail
  const live = r.balls.filter((b) => b.s !== POCKETED && legal.includes(b.id)).sort((a, b) => Math.hypot(a.x - cue!.x, a.y - cue!.y) - Math.hypot(b.x - cue!.x, b.y - cue!.y));
  const t = live[0] ?? r.balls.find((b) => b.id === 8)!;
  const call: Call = o.calls === "all" ? "safety" : eight ? { ball: 8, pocket: 0 } : null;
  return { shot: flat(mdeg(t.x - cue.x, t.y - cue.y), 420), call, ...placed };
}
