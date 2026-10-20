/**
 * NIGHT POOL: the table and its physics, deterministic.
 *
 * An event-based billiards simulation adapted from pooltool (https://github.com/ekiefl/pooltool,
 * Copyright Evan Kiefl and contributors, Apache License 2.0: see LICENSE-pooltool.txt next to this
 * file). The physics is pooltool's: the sliding, rolling and spinning equations of motion
 * (physics/evolve), the event times from the balls' position polynomials (evolution/event_based/
 * detect), ball-ball collisions with friction and restitution after Alciatore's technical proofs
 * (resolve/ball_ball/frictional_inelastic), ball-cushion collisions after Han 2005
 * (resolve/ball_cushion/han_2005), the cue strike and its squirt (resolve/stick_ball/
 * instantaneous_point), the 7-foot pocket table with its jaws and pockets (objects/table/layout),
 * and the ball, cloth and cue parameters (objects/ball/params, objects/cue).
 *
 * Changed from pooltool by NIGHTSHIFT: ported from Python/numpy/numba to TypeScript; on the table
 * only (2D: no airborne balls, no jumps); unit vectors instead of angles and rotations; a
 * deterministic root isolation (derivatives and fixed-count bisection) instead of numpy's
 * polynomial solver; deterministic sin, cos, exp and atan from + - * / only; the table geometry
 * computed once offline and written here as numbers; a cluster of touching balls (the break, a frozen
 * combination) resolved in waves of simultaneous contacts (cluster()); a minimum parting speed
 * against inelastic collapse (V_SEP); a seeded WPA 8-ball rack; keyframes for replay; an aim guide.
 *
 * Deterministic: the same balls and the same shot give the same result on every machine. JavaScript
 * numbers are IEEE 754 doubles and + - * / and Math.sqrt are exactly rounded in every engine; this
 * file uses nothing else at run time (no Math.sin, cos, exp, pow, hypot, atan or **; a test checks
 * it), no randomness except the seeded rack, and every loop in a fixed order. The server simulates
 * every shot with this file and its result is the only one that counts; the browser runs the very
 * same file to replay the server's keyframes and to draw the aim guide.
 *
 * Keep apps/engine/src/pool/physics.ts byte-identical to apps/web/src/pool/physics.ts (a test checks it).
 * Units are SI: metres, seconds, kilograms, radians per second.
 */

// ---- deterministic math

const PI = 3.141592653589793;
const LN2 = 0.6931471805599453;
const MDEG = PI / 180000;
/** sin x for |x| ≤ π/4, Taylor to x^19 (Horner, + - * / only). */
function sinT(x: number): number {
  const q = x * x;
  return x * (1 - q / 6 * (1 - q / 20 * (1 - q / 42 * (1 - q / 72 * (1 - q / 110 * (1 - q / 156 * (1 - q / 210 * (1 - q / 272 * (1 - q / 342)))))))));
}
/** cos x for |x| ≤ π/4, Taylor to x^20. */
function cosT(x: number): number {
  const q = x * x;
  return 1 - q / 2 * (1 - q / 12 * (1 - q / 30 * (1 - q / 56 * (1 - q / 90 * (1 - q / 132 * (1 - q / 182 * (1 - q / 240 * (1 - q / 306 * (1 - q / 380)))))))));
}
/** sin and cos of an angle in thousandths of a degree (an integer), reduced exactly in integers. */
export function sincos(md: number): [number, number] {
  let k = md % 360000;
  if (k < 0) k += 360000;
  const quad = Math.floor(k / 90000), r = k - quad * 90000;
  let s: number, c: number;
  if (r <= 45000) { const x = r * MDEG; s = sinT(x); c = cosT(x); } else { const x = (90000 - r) * MDEG; s = cosT(x); c = sinT(x); }
  return quad === 0 ? [s, c] : quad === 1 ? [c, -s] : quad === 2 ? [-s, -c] : [-c, s];
}
/** e^x from + - * / only: x = k·ln2 + r, a Taylor series for r, exact powers of two for k. */
export function dexp(x: number): number {
  if (x < -700) return 0;
  if (x > 700) return Infinity;
  const k = Math.round(x / LN2), r = x - k * LN2;
  let s = 1, term = 1;
  for (let i = 1; i <= 20; i++) { term = term * r / i; s += term; }
  const base = k < 0 ? 0.5 : 2;
  for (let i = 0, n = Math.abs(k); i < n; i++) s *= base;
  return s;
}
/** atan x for |x| ≤ 0.2 (the squirt angle is far smaller), its alternating series. */
function atanSmall(x: number): number {
  const q = x * x;
  let s = 0, term = x;
  for (let i = 0; i < 16; i++) { s += term / (2 * i + 1); term = -term * q; }
  return s;
}

// ---- the table: a 7-foot pocket table (78 × 39 inches between the cushion noses), pooltool's layout

/** The playing surface: x across (0 … W), y along (0 … L); y = 0 is the head rail, where the breaker stands. */
export const W = 0.9906;
export const L = 1.9812;
/** The ball radius (2¼ inch balls). */
export const R = 0.028575;
/** The head string: the kitchen is y < HEAD_Y. */
export const HEAD_Y = L / 4;
/** The foot spot, where the apex ball of the rack sits and where the 8-ball is spotted. */
export const FOOT_X = W / 2;
export const FOOT_Y = L * 3 / 4;
/**
 * The cushion noses as segments, [x1, y1, x2, y2, nx, ny] with the unit normal toward the playing
 * side (computed offline from pooltool's create_pocket_table_cushion_segments: 6 rails, 12 jaws).
 */
export const LINES: readonly (readonly [number, number, number, number, number, number])[] = [
  [0.022249704426935843, -0.0508, 0.07761953701082994, -0.0048310793217675495, -0.6387678175155977, 0.7693995550468951],
  [-0.0508, 0.022249704426935843, -0.0048310793217675495, 0.07761953701082994, 0.7693995550468951, -0.6387678175155977],
  [0, 0.09100172278778171, 0, 0.91508373076875, 1, 0],
  [-0.0508, 0.9284141466272995, -0.006961860911672622, 0.9229720817461166, 0.12319433307819769, 0.9923825654944861],
  [-0.0508, 1.0527858533727004, -0.006961860911672622, 1.0582279182538834, 0.12319433307820019, -0.992382565494486],
  [0, 1.0661162692312498, 0, 1.8901982772122183, 1, 0],
  [-0.0508, 1.9589502955730642, -0.0048310793217675495, 1.90358046298917, 0.7693995550468962, 0.6387678175155965],
  [0.022249704426935843, 2.032, 0.07761953701082994, 1.9860310793217677, -0.6387678175155967, -0.7693995550468958],
  [0.09100172278778171, 1.9812, 0.8995982772122183, 1.9812, 0, -1],
  [0.9683502955730642, 2.032, 0.9129804629891701, 1.9860310793217677, 0.638767817515597, -0.7693995550468956],
  [1.0414, 1.9589502955730642, 0.9954310793217676, 1.90358046298917, -0.7693995550468954, 0.6387678175155973],
  [0.9906, 1.0661162692312498, 0.9906, 1.8901982772122183, -1, 0],
  [1.0414, 1.0527858533727004, 0.9975618609116726, 1.0582279182538834, -0.12319433307819995, -0.9923825654944858],
  [1.0414, 0.9284141466272995, 0.9975618609116726, 0.9229720817461166, -0.1231943330781975, 0.9923825654944862],
  [0.9906, 0.09100172278778171, 0.9906, 0.91508373076875, -1, 0],
  [1.0414, 0.022249704426935843, 0.9954310793217676, 0.07761953701082994, -0.7693995550468944, -0.6387678175155985],
  [0.9683502955730642, -0.0508, 0.9129804629891701, -0.0048310793217675495, 0.638767817515598, 0.7693995550468948],
  [0.09100172278778171, 0, 0.8995982772122183, 0, 0, 1],
];
/** The rounded jaw tips at each pocket mouth, [x, y, radius]. */
export const JAWS: readonly (readonly [number, number, number])[] = [
  [0.09100172278778171, -0.02095, 0.02095],
  [-0.02095, 0.09100172278778171, 0.02095],
  [-0.00795, 0.91508373076875, 0.00795],
  [-0.00795, 1.0661162692312498, 0.00795],
  [-0.02095, 1.8901982772122183, 0.02095],
  [0.09100172278778171, 2.00215, 0.02095],
  [0.8995982772122183, 2.00215, 0.02095],
  [1.01155, 1.8901982772122183, 0.02095],
  [0.99855, 1.0661162692312498, 0.00795],
  [0.99855, 0.91508373076875, 0.00795],
  [1.01155, 0.09100172278778171, 0.02095],
  [0.8995982772122183, -0.02095, 0.02095],
];
/**
 * The pockets, [x, y, radius]: a ball whose centre enters the circle is pocketed. In order: 0 head
 * left (bottom left), 1 side left, 2 foot left, 3 head right, 4 side right, 5 foot right.
 */
export const POCKETS: readonly (readonly [number, number, number])[] = [
  [-0.029486352775479032, -0.029486352775479032, 0.062],
  [-0.0685, 0.9906, 0.0645],
  [-0.029486352775479032, 2.0106863527754792, 0.062],
  [1.020086352775479, -0.029486352775479032, 0.062],
  [1.0591, 0.9906, 0.0645],
  [1.020086352775479, 2.0106863527754792, 0.062],
];
export const POCKET_NAMES = ["head left", "side left", "foot left", "head right", "side right", "foot right"] as const;

// ---- the balls, the cloth, the cushions and the cue (pooltool's POOL_GENERIC parameters)

const MASS = 0.170097, G = 9.81;
/** Sliding, rolling and spinning friction of the cloth. */
const U_S = 0.2, U_R = 0.01, U_SP = 10 * 2 / 5 / 9 * R;
/** Ball-ball restitution; ball-ball friction is Alciatore's fit u = a + b·e^(−c·v). */
const E_B = 0.95, FB_A = 9.951e-3, FB_B = 0.108, FB_C = 1.088;
/** Cushion restitution and friction (Han 2005), the cushion nose height (64% of the ball's diameter) and its radius. */
const E_C = 0.85, F_C = 0.2, RAIL_H = 0.64 * 2 * R, NOSE = 0.001;
/** sin and cos of the angle between the ball's centre and the cushion's contact point (Han's θ). */
const SIN_A = RAIL_H / R - 1, COS_A = Math.sqrt(1 - SIN_A * SIN_A);
/** A ball on the table touches a cushion when its centre is this far from the nose line (pooltool's 2D contact). */
export const CONTACT = Math.sqrt((R + NOSE) * (R + NOSE) - (RAIL_H - R) * (RAIL_H - R));
/** The cue's mass and the effective mass of its tip end (squirt). */
const CUE_M = 0.567, END_M = MASS / 30;
/** The slowest and the fastest stroke (cue speed, m/s): a full-power break sends the cue ball at about 9 m/s. */
export const V_MIN = 0.05, V_MAX = 6;
/** The tip may strike at most this far from the centre of the ball (a fraction of R): further is a miscue. */
export const MAX_TIP = 0.5;
/** The cue's elevation, at most (thousandths of a degree). */
export const MAX_ELEVATION = 60000;
const EPS = 1e-9;
/**
 * Two balls (or a ball and a cushion) that meet slower than this part at this speed: a ball pushing
 * another one (one sliding, one rolling) would otherwise meet it again and again in ever shorter
 * steps, without end (inelastic collapse). The energy this adds is far below a millijoule.
 */
const V_SEP = 0.005;
/** A shot ends after this many events or this much time at the most: anything still moving stops there. */
export const MAX_EVENTS = 6000;
export const MAX_TIME = 120;

/** Motion states (pooltool's): still, spinning in place, sliding, rolling, pocketed. */
export const STILL = 0, SPIN = 1, SLIDE = 2, ROLL = 3, POCKETED = 4;
/** A ball: 0 is the cue ball, 1–15 the object balls. Spin w: x and y about the table's axes, z about the vertical. */
export type Ball = { id: number; x: number; y: number; vx: number; vy: number; wx: number; wy: number; wz: number; s: number };
/**
 * What the player does: the aim in thousandths of a degree (0 = along +x, counter-clockwise), the
 * power 0–1000, where the tip strikes (thousandths of R: spinX right english positive, spinY
 * follow positive, at most MAX_TIP from the centre) and the cue's elevation (thousandths of a degree).
 */
export type Shot = { aim: number; power: number; spinX: number; spinY: number; elevation: number };
/** Event kinds in a keyframe. */
export const EV = { CUE: 0, BALL: 1, RAIL: 2, JAW: 3, POCKET: 4, ROLLING: 5, STOPPED: 6, SPUN_OUT: 7, HALT: 8 } as const;
/**
 * One event of a shot: its time, kind, what met (ball ids, or a ball and a rail, jaw or pocket
 * index), and the new state of every ball it changed. Between two keyframes of a ball its motion is
 * closed-form (motion()), so a replay from the keyframes is exactly the server's.
 */
export type Frame = { t: number; k: number; a: number; b: number; balls: Ball[] };
export type Result = { frames: Frame[]; balls: Ball[]; duration: number; truncated: boolean };

export const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
/** A shot inside every limit (integers only, the tip on the ball). */
export function validShot(s: Shot): boolean {
  return isInt(s.aim, 0, 359999) && isInt(s.power, 0, 1000) && isInt(s.spinX, -1000, 1000) && isInt(s.spinY, -1000, 1000) && isInt(s.elevation, 0, MAX_ELEVATION)
    && s.spinX * s.spinX + s.spinY * s.spinY <= MAX_TIP * 1000 * MAX_TIP * 1000;
}

// ---- motion between events (pooltool's evolve_ball_motion, one state at a time)

const copy = (b: Ball): Ball => ({ id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, wx: b.wx, wy: b.wy, wz: b.wz, s: b.s });
/** The spin about the vertical after t: it decays at a constant rate to zero, never past it. */
function spinAfter(wz: number, t: number): number {
  if (wz === 0) return 0;
  const alpha = 5 * U_SP * G / (2 * R), stop = Math.abs(wz) / alpha;
  if (t >= stop) return 0;
  return wz > 0 ? wz - alpha * t : wz + alpha * t;
}
/** The velocity of the contact point on the cloth: zero for a rolling ball, the sliding velocity otherwise. */
function slip(b: Ball): [number, number] { return [b.vx - R * b.wy, b.vy + R * b.wx]; }
/** How long the ball stays in its state. */
export function duration(b: Ball): number {
  if (b.s === SLIDE) { const [ux, uy] = slip(b); return 2 * Math.sqrt(ux * ux + uy * uy) / (7 * U_S * G); }
  if (b.s === ROLL) return Math.sqrt(b.vx * b.vx + b.vy * b.vy) / (U_R * G);
  if (b.s === SPIN) return Math.abs(b.wz) * 2 * R / (5 * U_SP * G);
  return Infinity;
}
/** The ball after t seconds in its state (t no longer than duration(b)). */
export function motion(b: Ball, t: number): Ball {
  if (t <= 0 || b.s === STILL || b.s === POCKETED) return copy(b);
  const o = copy(b);
  if (b.s === SLIDE) {
    const [ux, uy] = slip(b), un = Math.sqrt(ux * ux + uy * uy);
    if (un > 0) {
      const ex = ux / un, ey = uy / un, a = U_S * G, h = 0.5 * a * t * t, k = 2.5 / R * a * t;
      o.x = b.x + b.vx * t - h * ex; o.y = b.y + b.vy * t - h * ey;
      o.vx = b.vx - a * t * ex; o.vy = b.vy - a * t * ey;
      o.wx = b.wx - k * ey; o.wy = b.wy + k * ex;
    }
  } else if (b.s === ROLL) {
    const vn = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (vn > 0) {
      const ex = b.vx / vn, ey = b.vy / vn, a = U_R * G, h = 0.5 * a * t * t;
      o.x = b.x + b.vx * t - h * ex; o.y = b.y + b.vy * t - h * ey;
      o.vx = b.vx - a * t * ex; o.vy = b.vy - a * t * ey;
      o.wx = -o.vy / R; o.wy = o.vx / R;
    }
  }
  o.wz = spinAfter(b.wz, t);
  return o;
}
/** The motion state a ball is in after a collision (pooltool's final_ball_motion_state, on the table). */
function classify(b: Ball): number {
  const [ux, uy] = slip(b);
  if (Math.sqrt(ux * ux + uy * uy) > EPS) return SLIDE;
  if (Math.sqrt(b.vx * b.vx + b.vy * b.vy) > EPS) return ROLL;
  if (Math.abs(b.wz) > EPS) return SPIN;
  return STILL;
}
/** The end of a state (a transition event): sliding becomes rolling, rolling becomes spinning or still, spinning still. */
function transition(b: Ball): { ball: Ball; k: number } {
  const o = copy(b);
  if (b.s === SLIDE) {
    o.wx = -o.vy / R; o.wy = o.vx / R;
    if (Math.sqrt(o.vx * o.vx + o.vy * o.vy) > EPS) { o.s = ROLL; return { ball: o, k: EV.ROLLING }; }
    o.vx = 0; o.vy = 0; o.wx = 0; o.wy = 0;
  } else if (b.s === ROLL) { o.vx = 0; o.vy = 0; o.wx = 0; o.wy = 0; }
  else { o.vx = 0; o.vy = 0; o.wx = 0; o.wy = 0; o.wz = 0; }
  o.s = Math.abs(o.wz) > EPS ? SPIN : STILL;
  if (o.s === STILL) o.wz = 0;
  return { ball: o, k: b.s === SPIN ? EV.SPUN_OUT : EV.STOPPED };
}
/** The ball's centre as c + v·t + a·t² while its state lasts: [cx, cy, vx, vy, ax, ay]. */
export function path(b: Ball): [number, number, number, number, number, number] {
  if (b.s === SLIDE) {
    const [ux, uy] = slip(b), un = Math.sqrt(ux * ux + uy * uy);
    if (un > 0) { const h = -0.5 * U_S * G / un; return [b.x, b.y, b.vx, b.vy, h * ux, h * uy]; }
  } else if (b.s === ROLL) {
    const vn = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (vn > 0) { const h = -0.5 * U_R * G / vn; return [b.x, b.y, b.vx, b.vy, h * b.vx, h * b.vy]; }
  }
  return [b.x, b.y, 0, 0, 0, 0];
}
const moving = (b: Ball) => b.s === SLIDE || b.s === ROLL;

// ---- event times: deterministic real roots

/** p(t), coefficients highest power first (Horner). */
function poly(c: readonly number[], t: number): number { let v = 0; for (let i = 0; i < c.length; i++) v = v * t + c[i]!; return v; }
/** Real roots of c in (lo, hi), ascending: closed form to degree 2, else through the derivative's roots and bisection. */
function roots(c: readonly number[], lo: number, hi: number): number[] {
  let k = 0;
  while (k < c.length - 1 && c[k] === 0) k++;
  const p = k ? c.slice(k) : c, n = p.length - 1;
  if (n <= 0) return [];
  if (n === 1) { const t = -p[1]! / p[0]!; return t > lo && t < hi ? [t] : []; }
  if (n === 2) {
    const a = p[0]!, b = p[1]!, cc = p[2]!, disc = b * b - 4 * a * cc;
    if (disc < 0) return [];
    const q = -0.5 * (b + (b < 0 ? -Math.sqrt(disc) : Math.sqrt(disc)));
    const out: number[] = [];
    for (const t of q === 0 ? [0] : [q / a, cc / q]) if (t > lo && t < hi && !out.includes(t)) out.push(t);
    return out.sort((x, y) => x - y);
  }
  const d: number[] = [];
  for (let i = 0; i < n; i++) d.push(p[i]! * (n - i));
  const pts = [lo, ...roots(d, lo, hi), hi], out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!, fa = poly(p, a), fb = poly(p, b);
    if (fa === 0 && a > lo) { out.push(a); continue; }
    if ((fa < 0) !== (fb < 0) && fb !== 0) out.push(bisect(p, a, b, fa < 0));
  }
  return out;
}
/** A root of a monotonic piece, by 64 halvings: the same steps on every machine. */
function bisect(p: readonly number[], a: number, b: number, rising: boolean): number {
  let lo = a, hi = b;
  for (let i = 0; i < 64; i++) {
    const m = 0.5 * (lo + hi);
    if (m <= lo || m >= hi) break;
    if ((poly(p, m) < 0) === rising) lo = m; else hi = m;
  }
  return rising ? hi : lo;
}
/**
 * The first time in [0, span] at which f goes from positive to zero or below (two bodies meeting),
 * returned on the positive side so they touch without overlapping; 0 if they are already touching
 * and closing. Infinity if never.
 */
function meet(c: readonly number[], span: number): number {
  const f0 = poly(c, 0), d0 = c[c.length - 2] ?? 0;
  if (f0 <= 0) { if (d0 < 0) return 0; }
  const n = c.length - 1, d: number[] = [];
  for (let i = 0; i < n; i++) d.push(c[i]! * (n - i));
  const pts = [0, ...roots(d, 0, span), span];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!, fa = poly(c, a), fb = poly(c, b);
    if (fa > 0 && fb <= 0) {
      let lo = a, hi = b;
      for (let j = 0; j < 64; j++) { const m = 0.5 * (lo + hi); if (m <= lo || m >= hi) break; if (poly(c, m) > 0) lo = m; else hi = m; }
      return lo;
    }
  }
  return Infinity;
}
/** |c + v t + a t²|² − r², highest power first. */
function quartic(cx: number, cy: number, vx: number, vy: number, ax: number, ay: number, r: number): number[] {
  return [ax * ax + ay * ay, 2 * (ax * vx + ay * vy), vx * vx + vy * vy + 2 * (ax * cx + ay * cy), 2 * (vx * cx + vy * cy), cx * cx + cy * cy - r * r];
}
/** How far a ball's centre may go in `span` seconds, at most. */
function reach(p: readonly number[], span: number): number {
  const v = Math.sqrt(p[2]! * p[2]! + p[3]! * p[3]!), a = Math.sqrt(p[4]! * p[4]! + p[5]! * p[5]!);
  return v * span + a * span * span;
}
type Sim = { ball: Ball; t0: number };
const at = (s: Sim, t: number) => motion(s.ball, t - s.t0);
/** The span a ball's path is good for, from `now`. */
const spanOf = (s: Sim, now: number) => (moving(s.ball) ? Math.min(MAX_TIME, s.t0 + duration(s.ball) - now) : Infinity);

function ballBallTime(i: Sim, j: Sim, now: number): number {
  if (!moving(i.ball) && !moving(j.ball)) return Infinity;
  const span = Math.min(spanOf(i, now), spanOf(j, now));
  if (!(span > 0)) return Infinity;
  const pi = path(at(i, now)), pj = path(at(j, now));
  const cx = pi[0] - pj[0], cy = pi[1] - pj[1];
  if (Math.sqrt(cx * cx + cy * cy) - 2 * R > reach(pi, span) + reach(pj, span)) return Infinity;
  const t = meet(quartic(cx, cy, pi[2] - pj[2], pi[3] - pj[3], pi[4] - pj[4], pi[5] - pj[5], 2 * R), span);
  return t === Infinity ? t : now + t;
}
function railTime(i: Sim, k: number, now: number): number {
  if (!moving(i.ball)) return Infinity;
  const span = spanOf(i, now);
  if (!(span > 0)) return Infinity;
  const p = path(at(i, now)), [x1, y1, x2, y2, nx, ny] = LINES[k]!;
  const d0 = nx * (p[0] - x1) + ny * (p[1] - y1) - CONTACT;
  if (d0 > reach(p, span)) return Infinity;
  const dv = nx * p[2] + ny * p[3], da = nx * p[4] + ny * p[5];
  let t: number;
  if (d0 <= 0) { if (dv >= 0 || d0 < -2 * R) return Infinity; t = 0; } else t = meet([da, dv, d0], span);
  if (t === Infinity) return t;
  // the centre must meet the nose within the segment's length (beyond it the jaw or the pocket takes the ball)
  const x = p[0] + p[2] * t + p[4] * t * t, y = p[1] + p[3] * t + p[5] * t * t;
  const sx = x2 - x1, sy = y2 - y1, u = ((x - x1) * sx + (y - y1) * sy) / (sx * sx + sy * sy);
  return u >= 0 && u <= 1 ? now + t : Infinity;
}
function circleTime(i: Sim, cx0: number, cy0: number, r: number, now: number): number {
  if (!moving(i.ball)) return Infinity;
  const span = spanOf(i, now);
  if (!(span > 0)) return Infinity;
  const p = path(at(i, now)), cx = p[0] - cx0, cy = p[1] - cy0;
  if (Math.sqrt(cx * cx + cy * cy) - r > reach(p, span)) return Infinity;
  const t = meet(quartic(cx, cy, p[2], p[3], p[4], p[5], r), span);
  return t === Infinity ? t : now + t;
}

// ---- collisions

type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3) => Math.sqrt(dot(a, a));
/** A vector in the frame whose x axis is n (unit, in the table plane), and back. */
const toFrame = (v: V3, nx: number, ny: number): V3 => [v[0] * nx + v[1] * ny, -v[0] * ny + v[1] * nx, v[2]];
const fromFrame = (v: V3, nx: number, ny: number): V3 => [v[0] * nx - v[1] * ny, v[0] * ny + v[1] * nx, v[2]];
/** The velocity of a point on the ball's surface (direction d from its centre), less any motion along d. */
const tangentAt = (v: V3, w: V3, d: V3): V3 => add(sub(v, mul(d, dot(v, d))), cross(w, mul(d, R)));

/**
 * Ball-ball, pooltool's FrictionalInelastic: equal masses, restitution E_B along the line of
 * centres, and friction between the balls (cut- and spin-induced throw) that either slips the whole
 * contact or stops the slip, whichever happens.
 */
function ballBall(b1: Ball, b2: Ball): void {
  let nx = b2.x - b1.x, ny = b2.y - b1.y;
  const dn = Math.sqrt(nx * nx + ny * ny);
  if (dn === 0) return;
  nx /= dn; ny /= dn;
  const n: V3 = [nx, ny, 0], m: V3 = [-nx, -ny, 0];
  const v1w: V3 = [b1.vx, b1.vy, 0], w1w: V3 = [b1.wx, b1.wy, b1.wz], v2w: V3 = [b2.vx, b2.vy, 0], w2w: V3 = [b2.wx, b2.wy, b2.wz];
  const rel = norm(sub(tangentAt(v1w, w1w, n), tangentAt(v2w, w2w, m)));
  const u = FB_A + FB_B * dexp(-FB_C * rel), e = E_B;
  const v1 = toFrame(v1w, nx, ny), w1 = toFrame(w1w, nx, ny), v2 = toFrame(v2w, nx, ny), w2 = toFrame(w2w, nx, ny);
  const x: V3 = [1, 0, 0], mx: V3 = [-1, 0, 0];
  let v1n = 0.5 * ((1 - e) * v1[0] + (1 + e) * v2[0]), v2n = 0.5 * ((1 + e) * v1[0] + (1 - e) * v2[0]);
  if (v2n - v1n < V_SEP) { const mid = 0.5 * (v1[0] + v2[0]); v1n = mid - 0.5 * V_SEP; v2n = mid + 0.5 * V_SEP; }
  const dvn = Math.abs(v2n - v1n), w1n = w1[0], w2n = w2[0];
  v1[0] = 0; v2[0] = 0; w1[0] = 0; w2[0] = 0;
  const surf = (v: V3, w: V3, d: V3) => add(v, cross(w, mul(d, R)));
  const c12 = sub(surf(v1, w1, x), surf(v2, w2, mx));
  let v1f: V3 = [...v1], w1f: V3 = [...w1], v2f: V3 = [...v2], w2f: V3 = [...w2];
  let slipOk = false;
  if (norm(c12) > EPS) {
    const dv = mul(c12, -u * dvn / norm(c12)), dw = mul(cross(x, dv), 2.5 / R);
    v1f = add(v1, dv); w1f = add(w1, dw); v2f = sub(v2, dv); w2f = add(w2, dw);
    slipOk = dot(c12, sub(surf(v1f, w1f, x), surf(v2f, w2f, mx))) > 0;
  }
  if (!slipOk) {
    const dv = mul(add(sub(v1, v2), mul(cross(add(w1, w2), x), R)), -1 / 7);
    const dw = mul(add(mul(cross(x, sub(v1, v2)), 1 / R), add(w1, w2)), -5 / 14);
    v1f = add(v1, dv); w1f = add(w1, dw); v2f = sub(v2, dv); w2f = add(w2, dw);
  }
  v1f[0] = v1n; v2f[0] = v2n; w1f[0] = w1n; w2f[0] = w2n;
  const a = fromFrame(v1f, nx, ny), aw = fromFrame(w1f, nx, ny), b = fromFrame(v2f, nx, ny), bw = fromFrame(w2f, nx, ny);
  b1.vx = a[0]; b1.vy = a[1]; b1.wx = aw[0]; b1.wy = aw[1]; b1.wz = aw[2];
  b2.vx = b[0]; b2.vy = b[1]; b2.wx = bw[0]; b2.wy = bw[1]; b2.wz = bw[2];
  b1.s = classify(b1); b2.s = classify(b2);
  // touching, never overlapping: rounding may leave them a hair inside each other
  const gap = 2 * R + 1e-10 - dn;
  if (gap > 0) { b1.x -= nx * gap / 2; b1.y -= ny * gap / 2; b2.x += nx * gap / 2; b2.y += ny * gap / 2; }
}
/**
 * Ball-cushion, Han 2005: the impulse at the cushion's contact point above the ball's equator, with
 * restitution E_C and friction F_C, sliding or sticking. `nx, ny` points from the ball into the cushion.
 */
function cushion(b: Ball, nx: number, ny: number): void {
  const v = toFrame([b.vx, b.vy, 0], nx, ny), w = toFrame([b.wx, b.wy, b.wz], nx, ny);
  if (!(v[0] > 0)) return;
  const s = SIN_A, c = COS_A, m = MASS;
  const sx = v[0] * s + R * w[1], sy = -v[1] - R * w[2] * c + R * w[0] * s, cz = -v[0] * c;
  const II = 2 / 5 * m * R * R, A = 7 / 2 / m, B = 1 / m;
  const PzE = -(1 + E_C) * cz / B, s0 = Math.sqrt(sx * sx + sy * sy), PzS = s0 / A;
  let PxE: number, PyE: number;
  if (PzS <= F_C * PzE) { PxE = sx / A; PyE = sy / A; } else { PxE = F_C * PzE * sx / s0; PyE = F_C * PzE * sy / s0; }
  const PX = -PxE * s - PzE * c, PY = PyE, PZ = PxE * c - PzE * s;
  v[0] += PX / m; v[1] += PY / m;
  if (v[0] > -V_SEP) v[0] = -V_SEP;
  w[0] += -R / II * PY * s; w[1] += R / II * (PX * s - PZ * c); w[2] += R / II * PY * c;
  const vt = fromFrame(v, nx, ny), wt = fromFrame(w, nx, ny);
  b.vx = vt[0]; b.vy = vt[1]; b.wx = wt[0]; b.wy = wt[1]; b.wz = wt[2];
  b.s = classify(b);
}

/**
 * Balls closer than this when one of them is struck are one cluster, resolved together (the rack, a
 * frozen combination): see cluster().
 */
const TOUCH = 0.0005;
/**
 * A cluster of touching balls struck at once (the break, a frozen combination), resolved in waves:
 * every contact closing at that moment parts at E_B times its closing speed, all of them together
 * (projected Gauss-Seidel, 48 sweeps in a fixed order); then the contacts that close because of it,
 * and so on until none closes. Resolved one pair at a time, a nearly touching rack passes the whole
 * stroke down one chain of balls (whichever pair happens to be a hair closer) and the rest of the
 * rack hardly moves; solved as one rigid block, every ball flies. In waves the stroke travels
 * through the rack as it does through a real one and splits evenly where it forks: about 11 balls
 * reach a rail on a full break and about one drops. Normal impulses only: friction between racked
 * balls is small next to the stroke, and a pair of balls alone keeps pooltool's model (ballBall).
 */
function cluster(group: Ball[]): void {
  const contacts: { p: Ball; q: Ball; nx: number; ny: number; target: number; acc: number }[] = [];
  for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const p = group[i]!, q = group[j]!;
    let nx = q.x - p.x, ny = q.y - p.y;
    const d = Math.sqrt(nx * nx + ny * ny);
    if (d - 2 * R > TOUCH || d === 0) continue;
    nx /= d; ny /= d;
    const u0 = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
    contacts.push({ p, q, nx, ny, target: 0, acc: 0 });
  }
  const closing = (c: (typeof contacts)[number]) => (c.p.vx - c.q.vx) * c.nx + (c.p.vy - c.q.vy) * c.ny;
  for (let wave = 0; wave < 64; wave++) {
    const active = contacts.filter((c) => closing(c) > 1e-12);
    if (!active.length) break;
    for (const c of active) { c.target = -E_B * closing(c); c.acc = 0; }
    for (let sweep = 0; sweep < 48; sweep++) {
      for (const c of active) {
        let dl = 0.5 * (closing(c) - c.target);
        const acc = Math.max(0, c.acc + dl);
        dl = acc - c.acc; c.acc = acc;
        c.p.vx -= dl * c.nx; c.p.vy -= dl * c.ny; c.q.vx += dl * c.nx; c.q.vy += dl * c.ny;
      }
    }
  }
  for (const b of group) b.s = classify(b);
}

// ---- the cue strike (pooltool's InstantaneousPoint, Alciatore TP A-30, squirt TP A-31)

/** The cue ball the moment the tip leaves it. */
export function strike(cue: Ball, shot: Shot): Ball {
  const [sinP, cosP] = sincos(shot.aim), [sinE, cosE] = sincos(shot.elevation);
  const V0 = V_MIN + (V_MAX - V_MIN) * shot.power / 1000;
  // pooltool's a is left english positive; b is follow positive (fractions of R)
  const a = -shot.spinX / 1000, b = shot.spinY / 1000;
  const cc = Math.sqrt(1 - a * a - b * b);
  const qa = R * a, qc = R * (cosE * cc - sinE * b), qb = R * (sinE * cc + cosE * b);
  const Im = 2 / 5 * R * R;
  const temp = qa * qa + qb * cosE * qb * cosE + qc * sinE * qc * sinE - 2 * qb * qc * cosE * sinE;
  const v = 2 * V0 / (1 + MASS / CUE_M + temp / Im);
  // in the cue's frame the ball goes along −y; turned by aim + 90° it goes along the aim
  const vB: V3 = [0, -v * cosE, -v * sinE];
  const wB: V3 = mul([-qc * sinE + qb * cosE, qa * sinE, -qa * cosE], v / Im);
  const turn = (p: V3): V3 => [p[0] * -sinP - p[1] * cosP, p[0] * cosP + p[1] * -sinP, p[2]];
  let vt = turn(vB);
  const wt = turn(wB);
  // squirt: the cue ball leaves a little off the aim, away from the side the tip struck
  const an = a, A = 1 - an * an;
  const alpha = -atanSmall(5 / 2 * an * Math.sqrt(A) / (1 + MASS / END_M + 5 / 2 * A));
  const sa = sinT(alpha), ca = cosT(alpha);
  vt = [vt[0] * ca - vt[1] * sa, vt[0] * sa + vt[1] * ca, 0];
  const o: Ball = { ...cue, vx: vt[0], vy: vt[1], wx: wt[0], wy: wt[1], wz: wt[2], s: STILL };
  o.s = classify(o);
  return o;
}

// ---- one shot

/**
 * Plays a shot from these balls (the cue ball is id 0; pocketed balls may be included and stay
 * put): every event in time order until everything is still, as keyframes, and the balls at rest.
 */
export function simulate(start: readonly Ball[], shot: Shot): Result {
  const cue = start.find((b) => b.id === 0);
  if (!cue || cue.s === POCKETED) return { frames: [], balls: [...start].sort((x, y) => x.id - y.id).map(copy), duration: 0, truncated: false };
  const struck = strike(cue, shot);
  return play(start.map((b) => (b.id === 0 ? struck : b)), [{ t: 0, k: EV.CUE, a: 0, b: -1, balls: [copy(struck)] }]);
}
/** Plays balls on from their states at time 0 (already moving: the stroke is done) until everything is still. */
export function play(start: readonly Ball[], first: Frame[] = []): Result {
  const sims: Sim[] = [...start].sort((x, y) => x.id - y.id).map((b) => ({ ball: copy(b), t0: 0 }));
  const frames: Frame[] = [...first];
  const n = sims.length, NL = LINES.length, NJ = JAWS.length, NP = POCKETS.length;
  const bb: number[][] = sims.map(() => new Array<number>(n).fill(Infinity));
  const rail: number[][] = sims.map(() => new Array<number>(NL).fill(Infinity));
  const jaw: number[][] = sims.map(() => new Array<number>(NJ).fill(Infinity));
  const pocket: number[][] = sims.map(() => new Array<number>(NP).fill(Infinity));
  const next: number[] = new Array<number>(n).fill(Infinity);
  let now = 0, truncated = false;
  const refresh = (i: number) => {
    const s = sims[i]!;
    next[i] = s.ball.s === STILL || s.ball.s === POCKETED ? Infinity : s.t0 + duration(s.ball);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const t = s.ball.s === POCKETED || sims[j]!.ball.s === POCKETED ? Infinity : ballBallTime(s, sims[j]!, now);
      bb[i]![j] = t; bb[j]![i] = t;
    }
    const live = s.ball.s !== POCKETED;
    for (let k = 0; k < NL; k++) rail[i]![k] = live ? railTime(s, k, now) : Infinity;
    for (let k = 0; k < NJ; k++) jaw[i]![k] = live ? circleTime(s, JAWS[k]![0], JAWS[k]![1], JAWS[k]![2] + R, now) : Infinity;
    for (let k = 0; k < NP; k++) pocket[i]![k] = live ? circleTime(s, POCKETS[k]![0], POCKETS[k]![1], POCKETS[k]![2], now) : Infinity;
  };
  for (let i = 0; i < n; i++) refresh(i);
  for (let count = 0; ; count++) {
    // the earliest event; on a tie the first in this fixed order: transitions, balls, rails, jaws, pockets
    let t = Infinity, kind = -1, a = -1, b = -1;
    for (let i = 0; i < n; i++) if (next[i]! < t) { t = next[i]!; kind = EV.ROLLING; a = i; b = -1; }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (bb[i]![j]! < t) { t = bb[i]![j]!; kind = EV.BALL; a = i; b = j; }
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < NL; k++) if (rail[i]![k]! < t) { t = rail[i]![k]!; kind = EV.RAIL; a = i; b = k; }
      for (let k = 0; k < NJ; k++) if (jaw[i]![k]! < t) { t = jaw[i]![k]!; kind = EV.JAW; a = i; b = k; }
      for (let k = 0; k < NP; k++) if (pocket[i]![k]! < t) { t = pocket[i]![k]!; kind = EV.POCKET; a = i; b = k; }
    }
    if (t === Infinity) break;
    if (t > MAX_TIME || count >= MAX_EVENTS) { truncated = true; break; }
    if (t < now) t = now;
    now = t;
    const dirty: number[] = [];
    const take = (i: number) => { const s = sims[i]!; s.ball = at(s, now); s.t0 = now; dirty.push(i); return s.ball; };
    if (kind === EV.ROLLING) {
      const r = transition(take(a)); sims[a]!.ball = r.ball; kind = r.k;
    } else if (kind === EV.BALL) {
      // the balls touching either of the two, and those touching them: one cluster if more than two
      const group = [a, b];
      {
        const here = sims.map((s) => (s.ball.s === POCKETED ? null : at(s, now)));
        for (let g = 0; g < group.length; g++) {
          const p = here[group[g]!]!;
          for (let k = 0; k < n; k++) {
            const q = here[k];
            if (!q || group.includes(k)) continue;
            const dx = q.x - p.x, dy = q.y - p.y;
            if (Math.sqrt(dx * dx + dy * dy) - 2 * R <= TOUCH) group.push(k);
          }
        }
      }
      if (group.length > 2) cluster(group.sort((x, y) => x - y).map((k) => take(k)));
      else ballBall(take(a), take(b));
    } else if (kind === EV.RAIL) {
      const ball = take(a), [, , , , nx, ny] = LINES[b]!;
      cushion(ball, -nx, -ny);
      // touching the nose, never inside it
      const [x1, y1] = LINES[b]!, d = nx * (ball.x - x1) + ny * (ball.y - y1) - CONTACT;
      if (d < 1e-10) { ball.x += nx * (1e-10 - d); ball.y += ny * (1e-10 - d); }
    } else if (kind === EV.JAW) {
      const ball = take(a), [jx, jy, jr] = JAWS[b]!;
      let nx = jx - ball.x, ny = jy - ball.y;
      const dn = Math.sqrt(nx * nx + ny * ny);
      nx /= dn; ny /= dn;
      cushion(ball, nx, ny);
      const gap = jr + R + 1e-10 - dn;
      if (gap > 0) { ball.x -= nx * gap; ball.y -= ny * gap; }
    } else {
      const ball = take(a);
      ball.vx = 0; ball.vy = 0; ball.wx = 0; ball.wy = 0; ball.wz = 0; ball.s = POCKETED;
    }
    frames.push({ t: now, k: kind, a: sims[a]!.ball.id, b: kind === EV.BALL ? sims[b]!.ball.id : b, balls: dirty.map((i) => copy(sims[i]!.ball)) });
    for (const i of dirty) refresh(i);
  }
  const halted: Ball[] = [], sunk = new Map<number, number>();
  for (const f of frames) if (f.k === EV.POCKET) sunk.set(f.a, f.b);
  for (const s of sims) {
    s.ball = at(s, now);
    s.t0 = now;
    // a ball pocketed on this shot rests in its pocket
    const into = sunk.get(s.ball.id);
    if (into !== undefined) { s.ball.x = POCKETS[into]![0]; s.ball.y = POCKETS[into]![1]; continue; }
    if (s.ball.s === POCKETED) continue;
    if (s.ball.s !== STILL) { s.ball = { ...s.ball, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, s: STILL }; halted.push(copy(s.ball)); }
  }
  if (halted.length) frames.push({ t: now, k: EV.HALT, a: -1, b: -1, balls: halted });
  return { frames, balls: sims.map((s) => s.ball), duration: now, truncated };
}

// ---- replay: the balls at any time of a shot, from its keyframes

/** Follows a shot's keyframes: at(t) gives every ball at time t, exactly as the server had it. */
export class Replay {
  private keys = new Map<number, { t: number; ball: Ball }[]>();
  constructor(start: readonly Ball[], frames: readonly Frame[]) {
    for (const b of start) this.keys.set(b.id, [{ t: 0, ball: copy(b) }]);
    for (const f of frames) for (const b of f.balls) { const k = this.keys.get(b.id); if (k) k.push({ t: f.t, ball: copy(b) }); }
  }
  /** Every ball at time t: its last keyframe at or before t, moved on to t. */
  at(t: number): Ball[] {
    const out: Ball[] = [];
    for (const keys of this.keys.values()) {
      let lo = 0, hi = keys.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (keys[m]!.t <= t) lo = m; else hi = m - 1; }
      const k = keys[lo]!;
      out.push(motion(k.ball, Math.min(t - k.t, duration(k.ball))));
    }
    return out;
  }
}

// ---- the rack

/** A small deterministic random generator (mulberry32), for the rack only. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const still = (id: number, x: number, y: number): Ball => ({ id, x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, s: STILL });
/** Where the cue ball waits for the break, in the kitchen. */
export const BREAK_SPOT = { x: W / 2, y: HEAD_Y - 0.12 };
/**
 * The WPA 8-ball rack (4.2): the apex ball on the foot spot, the 8 the first ball directly below it
 * (the middle of the third row), one solid and one stripe on the two back corners, the rest in no
 * pattern; racked tight with a hair's breadth (0.1–0.3 mm, drawn from the seed) between balls, as a
 * real rack is. The cue ball waits in the kitchen.
 */
export function rack(seed: number): Ball[] {
  const r = rng(seed), gap = 0.0002, d = 2 * R + gap, dy = d * Math.sqrt(3) / 2;
  const spots: [number, number][] = [];
  for (let row = 0; row < 5; row++) for (let k = 0; k <= row; k++) spots.push([FOOT_X + (k - row / 2) * d, FOOT_Y + row * dy]);
  const shuffle = (l: number[]) => { for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [l[i], l[j]] = [l[j]!, l[i]!]; } return l; };
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7]), stripes = shuffle([9, 10, 11, 12, 13, 14, 15]);
  const corners = r() < 0.5 ? [solids.pop()!, stripes.pop()!] : [stripes.pop()!, solids.pop()!];
  const rest = shuffle([...solids, ...stripes]);
  const order: number[] = [];
  for (let i = 0; i < 15; i++) order.push(i === 4 ? 8 : i === 10 ? corners[0]! : i === 14 ? corners[1]! : rest.pop()!);
  const balls = order.map((id, i) => still(id, spots[i]![0] + (r() - 0.5) * 0.0001, spots[i]![1] + (r() - 0.5) * 0.0001));
  return [still(0, BREAK_SPOT.x, BREAK_SPOT.y), ...balls].sort((a, b) => a.id - b.id);
}

// ---- placing balls

/** A spot is free when the ball fits on the cloth and touches no other ball (`apart` more to keep it off one). */
export function fits(balls: readonly Ball[], id: number, x: number, y: number, apart = 0): boolean {
  if (!(x >= R && x <= W - R && y >= R && y <= L - R)) return false;
  for (const b of balls) {
    if (b.id === id || b.s === POCKETED) continue;
    const dx = b.x - x, dy = b.y - y, need = 2 * R + (b.id === 0 ? apart : 0);
    if (dx * dx + dy * dy < need * need) return false;
  }
  return true;
}
/**
 * WPA 1.5: a ball is spotted on the long string as close as possible to the foot spot, between it
 * and the foot rail, against the ball in the way if there is one (a small gap from the cue ball);
 * if the long string below the foot spot is all taken, above the foot spot, as close as possible.
 */
export function spot(balls: readonly Ball[], id: number): { x: number; y: number } {
  const x = FOOT_X, keep = 0.002;
  const free = (y: number) => fits(balls, id, x, y + 0, keep);
  if (free(FOOT_Y)) return { x, y: FOOT_Y };
  const touch = (dir: 1 | -1) => {
    const ys: number[] = [];
    for (const b of balls) {
      if (b.id === id || b.s === POCKETED) continue;
      const need = 2 * R + (b.id === 0 ? keep : 0) + 1e-9, dx = b.x - x;
      if (Math.abs(dx) >= need) continue;
      const h = Math.sqrt(need * need - dx * dx);
      ys.push(b.y + h, b.y - h);
    }
    return ys.filter((y) => (dir > 0 ? y >= FOOT_Y && y <= L - R : y <= FOOT_Y && y >= R)).sort((p, q) => (p - q) * dir);
  };
  for (const y of touch(1)) if (free(y)) return { x, y };
  for (const y of touch(-1)) if (free(y)) return { x, y };
  return { x, y: FOOT_Y };
}

// ---- the aim guide: where the cue ball first meets something along a straight line

export type Aim = {
  /** Where the cue ball's centre is when it first touches: a ball (the ghost ball), a cushion or nothing within reach. */
  ghost: { x: number; y: number };
  hit: { kind: "ball"; id: number } | { kind: "rail" } | null;
  /** For a ball: the line of centres (where the object ball goes) and the cue ball's tangent line, unit vectors; for a rail, the bounce. */
  object?: { x: number; y: number }; cue?: { x: number; y: number };
};
/**
 * The guide the player sees, from geometry alone (a straight line; spin, throw and friction are not
 * in it): the first ball or cushion on the cue ball's line, the ghost ball, and where both balls
 * head after a ball contact (the object ball along the line of centres, the cue ball along the
 * tangent). The real shot is what the server simulates.
 */
export function aimAt(balls: readonly Ball[], aim: number): Aim {
  const cue = balls.find((b) => b.id === 0 && b.s !== POCKETED);
  if (!cue) return { ghost: { x: 0, y: 0 }, hit: null };
  const [dy, dx] = sincos(aim);
  let best = Infinity, hit: Aim["hit"] = null;
  for (const b of balls) {
    if (b.id === 0 || b.s === POCKETED) continue;
    const ox = b.x - cue.x, oy = b.y - cue.y, along = ox * dx + oy * dy;
    if (along <= 0) continue;
    const off2 = ox * ox + oy * oy - along * along, r2 = 4 * R * R;
    if (off2 >= r2) continue;
    const t = along - Math.sqrt(r2 - off2);
    if (t < best) { best = t; hit = { kind: "ball", id: b.id }; }
  }
  let railN: [number, number] | null = null;
  for (const [x1, y1, x2, y2, nx, ny] of LINES) {
    const den = nx * dx + ny * dy;
    if (den >= 0) continue;
    const t = (CONTACT - (nx * (cue.x - x1) + ny * (cue.y - y1))) / den;
    if (t < 0 || t >= best) continue;
    const x = cue.x + dx * t, y = cue.y + dy * t, sx = x2 - x1, sy = y2 - y1, u = ((x - x1) * sx + (y - y1) * sy) / (sx * sx + sy * sy);
    if (u < 0 || u > 1) continue;
    best = t; hit = { kind: "rail" }; railN = [nx, ny];
  }
  if (best === Infinity) return { ghost: { x: cue.x + dx, y: cue.y + dy }, hit: null };
  const ghost = { x: cue.x + dx * best, y: cue.y + dy * best };
  if (hit?.kind === "ball") {
    const b = balls.find((x) => x.id === hit.id)!;
    let ox = b.x - ghost.x, oy = b.y - ghost.y;
    const on = Math.sqrt(ox * ox + oy * oy);
    ox /= on; oy /= on;
    // the cue ball leaves along the tangent, on the side it came from
    const side = dx * -oy + dy * ox >= 0 ? 1 : -1;
    return { ghost, hit, object: { x: ox, y: oy }, cue: { x: -oy * side, y: ox * side } };
  }
  if (railN) { const k = 2 * (dx * railN[0] + dy * railN[1]); return { ghost, hit, cue: { x: dx - k * railN[0], y: dy - k * railN[1] } }; }
  return { ghost, hit };
}
