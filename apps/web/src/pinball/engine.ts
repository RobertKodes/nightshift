/**
 * NIGHTSHIFT Space Pinball: the table and its physics, deterministic.
 *
 * The same seed and the same inputs give the same score on every machine: fixed time steps, only
 * + - * / and Math.sqrt (exact in every JavaScript engine), no trigonometry at run time (the
 * flipper angles are a table computed once, offline), and a seeded random generator. The server
 * replays a player's inputs with this exact file to check the score, so a score cannot be faked.
 *
 * Keep apps/engine/src/pinball/engine.ts byte-identical to this file (a test checks it).
 */

export const W = 600;
export const H = 900;
export const TICK = 1 / 240;
const SUB = 3;
const DT = TICK / SUB;
const GRAVITY = 1150;
const BALL_R = 11;
const MAX_SPEED = 2400;
export const BALLS = 3;
/** A game lasts at most this many ticks (150 s), so a replay is always bounded. */
export const MAX_TICKS = 150 * 240;

type V = { x: number; y: number };
type Seg = { a: V; b: V; e: number; kick?: number; tag?: string };
export type Bumper = { x: number; y: number; r: number; kind: 0 | 1 | 2 | 3; flash: number };
export type Target = { x: number; y: number; r: number; down: boolean };

/** The top of the table: an arc from the left wall to the right wall (computed offline). */
const ARC: [number, number][] = [[20, 300], [29.2, 230.12], [56.17, 165], [99.08, 109.08], [155, 66.17], [220.12, 39.2], [290, 30], [359.88, 39.2], [425, 66.17], [480.92, 109.08], [523.83, 165], [550.8, 230.12], [560, 300]];
/** Left flipper direction from rest (+30°) to up (−28°), 20 steps; the right flipper mirrors x. */
const FLIP: [number, number][] = [[0.866025, 0.5], [0.890213, 0.455545], [0.91212, 0.409923], [0.931691, 0.363251], [0.948876, 0.315649], [0.96363, 0.267238], [0.975917, 0.218143], [0.985703, 0.168489], [0.992966, 0.118404], [0.997684, 0.068015], [0.999848, 0.017452], [0.99945, -0.033155], [0.996493, -0.083678], [0.990983, -0.133986], [0.982935, -0.183951], [0.97237, -0.233445], [0.959314, -0.282341], [0.943801, -0.330514], [0.925871, -0.377841], [0.905569, -0.424199], [0.882948, -0.469472]];
const FLIP_STEPS = FLIP.length - 1;
const DTHETA = 0.050615;
const FLIP_LEN = 88;
const FLIP_R = 9;

const seg = (ax: number, ay: number, bx: number, by: number, e = 0.45, kick?: number, tag?: string): Seg => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, e, kick, tag });

function walls(): Seg[] {
  const s: Seg[] = [];
  for (let i = 0; i + 1 < ARC.length; i++) s.push(seg(ARC[i]![0], ARC[i]![1], ARC[i + 1]![0], ARC[i + 1]![1], 0.5));
  s.push(seg(20, 300, 20, 690), seg(560, 300, 580, 330), seg(580, 330, 580, 900)); // left wall; right wall around the shooter lane
  s.push(seg(536, 900, 536, 360, 0.3)); // shooter lane's inner wall
  s.push(seg(20, 690, 192, 806, 0.4), seg(536, 690, 408, 806, 0.4)); // in-lane guides down to the flippers
  s.push(seg(84, 600, 140, 712, 0.4, 400, "sling"), seg(84, 600, 84, 690, 0.4), seg(452, 600, 396, 712, 0.4, 400, "sling"), seg(452, 600, 452, 690, 0.4)); // slingshots
  s.push(seg(150, 255, 175, 205, 0.5), seg(410, 205, 435, 255, 0.5)); // orbit lane posts
  return s;
}

/** A small deterministic random generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the player does, as changes at a tick: left flipper, right flipper, plunger held. */
export type Input = [tick: number, left: 0 | 1, right: 0 | 1, plunger: 0 | 1];
export type Event = { tick: number; kind: "bumper" | "sling" | "target" | "targets" | "hole" | "drain" | "launch" | "orbit" | "skill" | "save" | "meteor-in" | "surge-in"; points: number; send?: Attack };
/** What a duel player sends to the other table: a meteor in the way, or heavier gravity. */
export type Attack = "meteor" | "surge";
/** An attack lands this many ticks (3 s) after it was earned, the same on every machine. */
export const ATTACK_DELAY = 720;
const METEOR_TICKS = 8 * 240;
const MAX_METEORS = 2;
const SURGE_TICKS = 5 * 240;
const SAVE_TICKS = 4 * 240;
export type Meteor = { x: number; y: number; r: number; until: number };

export class Table {
  readonly walls = walls();
  readonly bumpers: Bumper[] = [
    { x: 215, y: 330, r: 34, kind: 0, flash: 0 }, { x: 365, y: 330, r: 34, kind: 1, flash: 0 },
    { x: 290, y: 430, r: 36, kind: 2, flash: 0 }, { x: 290, y: 255, r: 26, kind: 3, flash: 0 },
  ];
  readonly targets: Target[] = [{ x: 62, y: 420, r: 13, down: false }, { x: 62, y: 470, r: 13, down: false }, { x: 62, y: 520, r: 13, down: false }];
  /** The black hole: pulls the ball in, holds it, sends it back out, and raises the multiplier. */
  readonly hole = { x: 290, y: 130, pull: 95, core: 15 };
  ball = { x: 558, y: 860, vx: 0, vy: 0 };
  inLane = true;
  held = 0;
  plunge = 0;
  ballsLeft = BALLS;
  score = 0;
  mult = 1;
  tick = 0;
  over = false;
  orbitArmed = true;
  /** Left and right flipper steps (0 rest … FLIP_STEPS up) and the step they had last tick. */
  fl = 0; fr = 0; plf = 0; prf = 0;
  input = { left: 0, right: 0, plunger: 0 };
  events: Event[] = [];
  /** Duel: attacks waiting to land on this table, the meteors on it, and the gravity surge. */
  incoming: { at: number; kind: Attack }[] = [];
  meteors: Meteor[] = [];
  surgeUntil = 0;
  launchedAt = 0;
  stats = { bumpers: 0, holes: 0, sent: 0, received: 0 };
  #meteorN = 0;
  readonly #rand: () => number;

  readonly seed: number;
  constructor(seed: number) { this.seed = seed; this.#rand = rng(seed); }

  #add(kind: Event["kind"], points: number, send?: Attack) {
    const p = points * (kind === "drain" || kind === "launch" || kind === "save" ? 1 : this.mult);
    this.score += p;
    this.events.push({ tick: this.tick, kind, points: p, ...(send ? { send } : {}) });
    if (send) this.stats.sent++;
    if (kind === "bumper") this.stats.bumpers++;
    if (kind === "hole") this.stats.holes++;
  }

  /** Schedules an attack from the other table (duels only). */
  receive(kind: Attack, at: number): void { this.incoming.push({ at, kind }); }

  /** The flipper as a segment: pivot, tip, and the tip's speed this tick. */
  flipper(side: 0 | 1): { a: V; b: V; omega: number } {
    const step = side === 0 ? this.fl : this.fr;
    const prev = side === 0 ? this.plf : this.prf;
    const [cx, cy] = FLIP[step]!;
    const px = side === 0 ? 192 : 408;
    const py = 806;
    const dx = side === 0 ? cx : -cx;
    // angular velocity in rad/s (sign: the left flipper turns counter-clockwise going up)
    const w = ((step - prev) * DTHETA) / TICK;
    return { a: { x: px, y: py }, b: { x: px + dx * FLIP_LEN, y: py + cy * FLIP_LEN }, omega: side === 0 ? -w : w };
  }

  step(): void {
    if (this.over) return;
    this.tick++;
    if (this.tick >= MAX_TICKS) { this.over = true; return; }
    // attacks landing now: a meteor in the upper table (its place from its own seeded draw), or a surge
    for (let i = this.incoming.length - 1; i >= 0; i--) {
      const a = this.incoming[i]!;
      if (a.at > this.tick) continue;
      this.incoming.splice(i, 1);
      this.stats.received++;
      if (a.kind === "surge") { this.surgeUntil = this.tick + SURGE_TICKS; this.#add("surge-in", 0); continue; }
      const r = rng((this.seed ^ 0x9e3779b9) + this.#meteorN++);
      this.meteors.push({ x: 110 + r() * 360, y: 210 + r() * 300, r: 20 + r() * 10, until: this.tick + METEOR_TICKS });
      if (this.meteors.length > MAX_METEORS) this.meteors.shift();
      this.#add("meteor-in", 0);
    }
    if (this.meteors.length) this.meteors = this.meteors.filter((m) => m.until > this.tick);
    this.plf = this.fl; this.prf = this.fr;
    this.fl = this.input.left ? Math.min(FLIP_STEPS, this.fl + 2) : Math.max(0, this.fl - 1);
    this.fr = this.input.right ? Math.min(FLIP_STEPS, this.fr + 2) : Math.max(0, this.fr - 1);
    for (const b of this.bumpers) if (b.flash > 0) b.flash--;
    const ball = this.ball;

    if (this.inLane) {
      // The plunger: hold to pull it back (up to 1 s), release to launch.
      if (this.input.plunger) { this.plunge = Math.min(240, this.plunge + 1); return; }
      if (this.plunge > 0) {
        const charge = this.plunge / 240;
        const power = 900 + charge * 1300 + this.#rand() * 40;
        ball.vx = 0; ball.vy = -power; this.plunge = 0; this.inLane = false; this.launchedAt = this.tick;
        this.#add("launch", 0);
        // The skill shot: let go between 70% and 82% of a full pull.
        if (charge >= 0.7 && charge <= 0.82) this.#add("skill", 1000);
      } else return;
    }
    if (this.held > 0) {
      this.held--;
      ball.x = this.hole.x; ball.y = this.hole.y; ball.vx = 0; ball.vy = 0;
      if (this.held === 0) {
        // Out of the black hole, down into the table, slightly left or right.
        const side = this.#rand() < 0.5 ? -1 : 1;
        ball.vx = side * (180 + this.#rand() * 160); ball.vy = 520; ball.y = this.hole.y + this.hole.core + BALL_R + 2;
      }
      return;
    }
    for (let i = 0; i < SUB; i++) this.#move();
    if (ball.y > H + BALL_R) {
      // Ball save: lost in the first 4 s after a launch, it comes back.
      if (this.tick - this.launchedAt < SAVE_TICKS) {
        Object.assign(ball, { x: 558, y: 860, vx: 0, vy: 0 }); this.inLane = true; this.#add("save", 0);
        return;
      }
      this.ballsLeft--;
      this.#add("drain", 0);
      if (this.ballsLeft <= 0) { this.over = true; return; }
      Object.assign(ball, { x: 558, y: 860, vx: 0, vy: 0 });
      this.inLane = true; this.mult = 1;
    }
  }

  #move(): void {
    const b = this.ball;
    // the black hole's pull: stronger closer in, never trigonometry
    const hx = this.hole.x - b.x, hy = this.hole.y - b.y;
    const hd2 = hx * hx + hy * hy;
    if (hd2 < this.hole.pull * this.hole.pull) {
      const hd = Math.sqrt(hd2) + 1e-9;
      if (hd < this.hole.core) {
        this.held = 240; this.mult = Math.min(5, this.mult + 1);
        this.#add("hole", 2000, "meteor");
        return;
      }
      const f = 90000 / (hd * hd + 400);
      b.vx += (hx / hd) * f * DT; b.vy += (hy / hd) * f * DT;
    }
    b.vy += (this.tick < this.surgeUntil ? GRAVITY * 1.35 : GRAVITY) * DT;
    const sp2 = b.vx * b.vx + b.vy * b.vy;
    if (sp2 > MAX_SPEED * MAX_SPEED) { const k = MAX_SPEED / Math.sqrt(sp2); b.vx *= k; b.vy *= k; }
    b.x += b.vx * DT; b.y += b.vy * DT;

    for (const s of this.walls) this.#segment(s.a, s.b, s.e, 0, 0, 0, s.kick, s.tag);
    for (const side of [0, 1] as const) { const f = this.flipper(side); this.#segment(f.a, f.b, 0.25, f.omega, f.a.x, f.a.y, undefined, "flipper", FLIP_R); }
    for (const p of this.bumpers) {
      const dx = b.x - p.x, dy = b.y - p.y, d2 = dx * dx + dy * dy, rr = p.r + BALL_R;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) + 1e-9, nx = dx / d, ny = dy / d;
        b.x = p.x + nx * rr; b.y = p.y + ny * rr;
        const vn = b.vx * nx + b.vy * ny;
        b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny;
        b.vx += nx * 420; b.vy += ny * 420;
        if (p.flash === 0) this.#add("bumper", 100);
        p.flash = 18;
      }
    }
    for (const m of this.meteors) {
      const dx = b.x - m.x, dy = b.y - m.y, d2 = dx * dx + dy * dy, rr = m.r + BALL_R;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) + 1e-9, nx = dx / d, ny = dy / d;
        b.x = m.x + nx * rr; b.y = m.y + ny * rr;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny; }
      }
    }
    for (const t of this.targets) {
      if (t.down) continue;
      const dx = b.x - t.x, dy = b.y - t.y, rr = t.r + BALL_R;
      if (dx * dx + dy * dy < rr * rr) {
        t.down = true; b.vx = -b.vx * 0.8 + 140;
        this.#add("target", 250);
        if (this.targets.every((x) => x.down)) { for (const x of this.targets) x.down = false; this.#add("targets", 1500, "surge"); this.mult = Math.min(5, this.mult + 1); }
      }
    }
    // the top orbit: crossing the top centre going sideways fast
    if (this.orbitArmed && b.y < 60 && (b.vx > 700 || b.vx < -700) && b.x > 280 && b.x < 300) { this.orbitArmed = false; this.#add("orbit", 500, "meteor"); }
    if (b.y > 160) this.orbitArmed = true;
  }

  /** Circle-vs-segment with a moving surface (the flippers spin about a pivot). */
  #segment(a: V, c: V, e: number, omega: number, px: number, py: number, kick?: number, tag?: string, thick = 0): void {
    const b = this.ball;
    const ex = c.x - a.x, ey = c.y - a.y;
    const len2 = ex * ex + ey * ey;
    let t = ((b.x - a.x) * ex + (b.y - a.y) * ey) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a.x + ex * t, qy = a.y + ey * t;
    const dx = b.x - qx, dy = b.y - qy, d2 = dx * dx + dy * dy, rr = BALL_R + thick;
    if (d2 >= rr * rr) return;
    const d = Math.sqrt(d2) + 1e-9, nx = dx / d, ny = dy / d;
    b.x = qx + nx * rr; b.y = qy + ny * rr;
    // surface velocity at the contact point: omega × r
    const sx = -omega * (qy - py), sy = omega * (qx - px);
    const rvx = b.vx - sx, rvy = b.vy - sy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      b.vx = rvx - (1 + e) * vn * nx + sx; b.vy = rvy - (1 + e) * vn * ny + sy;
      if (kick) { b.vx += nx * kick; b.vy += ny * kick; if (tag === "sling") this.#add("sling", 10); }
    }
  }
}

/** Plays a whole game from its inputs: the score the server checks. */
export function replay(seed: number, inputs: Input[]): { score: number; ticks: number; events: Event[] } {
  const t = new Table(seed);
  let i = 0;
  const sorted = inputs.filter((x) => Number.isInteger(x[0]) && x[0] >= 0 && x[0] <= MAX_TICKS).sort((p, q) => p[0] - q[0]);
  while (!t.over) {
    while (i < sorted.length && sorted[i]![0] <= t.tick) { const [, l, r, p] = sorted[i]!; t.input = { left: l ? 1 : 0, right: r ? 1 : 0, plunger: p ? 1 : 0 }; i++; }
    t.step();
    // a held plunger after the last input would never release: the game ends at MAX_TICKS anyway
  }
  return { score: t.score, ticks: t.tick, events: t.events };
}

/** A duel, replayed: both tables step together; what one earns lands on the other ATTACK_DELAY later. */
export function duelReplay(seed: number, a: Input[], b: Input[]): { scores: [number, number]; stats: [Table["stats"], Table["stats"]] } {
  const tables = [new Table(seed), new Table(seed)] as const;
  const logs = [a, b].map((x) => x.filter((y) => Number.isInteger(y[0]) && y[0] >= 0 && y[0] <= MAX_TICKS).sort((p, q) => p[0] - q[0]));
  const at = [0, 0], seen = [0, 0];
  while (!tables[0].over || !tables[1].over) {
    for (const i of [0, 1] as const) {
      const t = tables[i], log = logs[i]!;
      if (t.over) continue;
      while (at[i]! < log.length && log[at[i]!]![0] <= t.tick) { const [, l, r, p] = log[at[i]!]!; t.input = { left: l ? 1 : 0, right: r ? 1 : 0, plunger: p ? 1 : 0 }; at[i]!++; }
      t.step();
    }
    for (const i of [0, 1] as const) {
      const t = tables[i], other = tables[i === 0 ? 1 : 0];
      for (; seen[i]! < t.events.length; seen[i]!++) { const e = t.events[seen[i]!]!; if (e.send) other.receive(e.send, e.tick + ATTACK_DELAY); }
    }
  }
  return { scores: [tables[0].score, tables[1].score], stats: [tables[0].stats, tables[1].stats] };
}
