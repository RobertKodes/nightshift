import type { Seat, RoomKey } from "./world";
import { RADAR, REACTOR } from "./world";
import type { Snapshot } from "./types";

/**
 * Life on the ship, like an AI town: a few frogs at a time get up, hop along their room's aisles to a real spot
 * (the coffee bar, the reactor, a launch pod, the furnace, the radar), wait there and go back to their seat; and
 * the crew talks in short bubbles whose numbers are the ship's live ones. Walks stay inside a room, on its aisles
 * and cross corridor, so nobody walks through a wall or a desk row.
 */
type Pt = [number, number];
export type Walker = { seat: number; key: string; route: Pt[]; at: number; legs: number[]; wait: number; z: number; line: string | null; ph: number };
export type Bubble = { seat: number | null; walker: Walker | null; text: string; from: number; until: number; tone: string };

type Plan = { aisles: number[]; cross: number; target: () => Pt; say: (s: Snapshot) => string } | { ring: Pt; r: number; target: () => Pt; say: (s: Snapshot) => string };
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const n0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const h1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

/** Where each room's crew walks to, and what it says when it gets there (live numbers only). */
const PLANS: Partial<Record<RoomKey, Plan>> = {
  breakroom: { aisles: [3.65, 8.25, 11.85, 15.4], cross: 53.0, target: () => [3.65, rnd(38.2, 51.2)], say: () => pick(["Refill.", "Coffee first.", "Black, no sugar."]) },
  missions: { aisles: [18.46, 20.18, 21.9, 23.62, 25.34, 27.06, 29.3], cross: 53.2, target: () => [29.3, 37.8 + 1.45 * Math.floor(rnd(0, 11))], say: (s) => `${s.totals.onMissions} out on missions` },
  offices: { aisles: [18.68, 21.63, 24.58, 27.53, 30.48], cross: 35.0, target: () => [pick([18.68, 21.63, 24.58, 27.53, 30.48]), rnd(21.6, 33.4)], say: (s) => `${h1(s.totals.perHour)} h/h ship-wide` },
  quarters: { aisles: [3.15, 8.1, 11.1, 14.1], cross: 33.4, target: () => [3.15, rnd(22.6, 32.6)], say: (s) => `${s.totals.watchers} Night Watcher${s.totals.watchers === 1 ? "" : "s"} forged` },
  forge: { aisles: [2.7, 4.75, 12.0, 13.85], cross: 86.7, target: () => [rnd(7.6, 9.4), 85.0], say: (s) => `${s.totals.burned} frogs forged so far` },
  engine: { aisles: [2.85, 4.95, 7.05, 9.25, 22.75, 24.95, 27.05, 29.15], cross: 55.0, target: () => [REACTOR.x + rnd(-2.2, 2.2), REACTOR.y - REACTOR.r - 1.6], say: () => "Reactor's steady." },
  bridge: { ring: [RADAR.x, RADAR.y], r: 8.2, target: () => { const a = rnd(10, 80) * (Math.PI / 180); return [RADAR.x + 3.3 * Math.cos(a), RADAR.y + 3.3 * Math.sin(a)]; }, say: (s) => (s.radar ? `${s.radar.loans.length} loans on radar` : "Radar's quiet.") },
};

/** Two neighbours talking: a question, then an answer with a live number. */
const TALK: Partial<Record<RoomKey, (s: Snapshot) => [string, string]>> = {
  bridge: (s) => ["Radar check?", s.radar ? `${s.radar.loans.length} loans, peg ${s.radar.peg ? s.radar.peg.toFixed(3) : "n/a"}` : "Nothing on it."],
  engine: (s) => ["How's the shift?", `${h1(s.totals.perHour)} h/h, all crew`],
  forge: (s) => ["How many forged?", `${s.totals.burned} frogs, ${s.totals.watchers} Watchers`],
  missions: (s) => ["Who's out?", `${s.totals.onMissions} on missions`],
  breakroom: () => ["Coffee?", "Always. Night shift."],
  offices: (s) => ["Busy?", `${n0(s.totals.held)} frogs aboard`],
  quarters: (s) => ["Holders?", `${n0(s.totals.holders)} wallets`],
};
const TONE: Partial<Record<RoomKey, string>> = { bridge: "#4ad8ff", quarters: "#ffc46b", offices: "#a98bff", breakroom: "#ff5ca8", missions: "#b8ff4a", engine: "#ffb547", forge: "#ff7a3d" };

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const near = (xs: number[], x: number) => xs.reduce((m, v) => (Math.abs(v - x) < Math.abs(m - x) ? v : m), xs[0]!);
/** A ring walk: from the seat straight out to the ring, round it to the target's angle, then in. */
function ringRoute(c: Pt, r: number, from: Pt, to: Pt): Pt[] {
  const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]), a1 = Math.atan2(to[1] - c[1], to[0] - c[0]);
  let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const steps = Math.max(1, Math.ceil(Math.abs(d) / 0.35)), out: Pt[] = [from];
  for (let k = 0; k <= steps; k++) { const a = a0 + (d * k) / steps; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  out.push(to);
  return out;
}

export class Life {
  walkers: Walker[] = [];
  bubbles: Bubble[] = [];
  private nextWalk = 0;
  private nextTalk = 0;
  constructor(private seats: readonly Seat[]) {}
  /** The seats whose frog is out walking (the scene leaves them empty while it is). */
  away(): Set<number> { return new Set(this.walkers.map((w) => w.seat)); }

  /**
   * One step. `crew` is every occupied seat (index → sprite key, frogs only), `view` the seats on screen.
   * `max` walkers at a time; none while the scene is still (reduced motion).
   */
  step(now: number, snap: Snapshot | null, crew: Map<number, string>, view: (i: number) => boolean, max: number) {
    this.walkers = this.walkers.filter((w) => now < w.at + w.legs.reduce((a, b) => a + b, 0) * 2 + w.wait);
    this.bubbles = this.bubbles.filter((b) => now < b.until && (!b.walker || this.walkers.includes(b.walker)));
    if (!snap) return;
    if (now > this.nextWalk && this.walkers.length < max) {
      this.nextWalk = now + rnd(350, 900);
      const busy = this.away(), pool = [...crew.keys()].filter((i) => !busy.has(i) && view(i) && PLANS[this.seats[i]!.room]);
      if (pool.length) { const i = pick(pool); this.start(now, i, crew.get(i)!, snap); }
    }
    if (now > this.nextTalk) {
      this.nextTalk = now + rnd(1100, 2500);
      const seen = [...crew.keys()].filter((i) => view(i) && !this.away().has(i));
      if (seen.length > 1 && this.bubbles.length < 9) {
        const a = pick(seen), room = this.seats[a]!.room, talk = TALK[room];
        // the neighbour: the closest seated frog in the same room
        let b = -1, bd = 1e9;
        for (const i of seen) { const s = this.seats[i]!; if (i === a || s.room !== room) continue; const d = dist([s.x, s.y], [this.seats[a]!.x, this.seats[a]!.y]); if (d < bd) { bd = d; b = i; } }
        if (talk && b >= 0 && bd < 4) {
          const [q, ans] = talk(snap), tone = TONE[room] ?? "#ecebf3";
          this.bubbles.push({ seat: a, walker: null, text: q, from: now, until: now + 2600, tone });
          this.bubbles.push({ seat: b, walker: null, text: ans, from: now + 1300, until: now + 4600, tone });
        }
      }
    }
  }

  private start(now: number, seatI: number, key: string, snap: Snapshot) {
    const s = this.seats[seatI]!, plan = PLANS[s.room]!;
    const home: Pt = [s.x, s.y], to = plan.target();
    let out: Pt[];
    if ("ring" in plan) out = ringRoute(plan.ring, plan.r, home, to);
    else { const ax = near(plan.aisles, s.x), tx = near(plan.aisles, to[0]); out = [home, [ax, s.y], [ax, plan.cross], [tx, plan.cross], [tx, to[1]], to]; }
    // there and back: the same aisles home
    const route = [...out, ...out.slice(0, -1).reverse()];
    const legs = route.slice(1).map((p, k) => (dist(route[k]!, p) / 1.6) * 1000 / 2); // half the time each way, ~1.6 tiles/s
    const w: Walker = { seat: seatI, key, route, at: now, legs, wait: rnd(2200, 3600), z: s.z, line: plan.say(snap), ph: Math.random() };
    this.walkers.push(w);
    this.bubbles.push({ seat: null, walker: w, text: w.line!, from: now + this.legTime(w, out.length - 1), until: now + this.legTime(w, out.length - 1) + w.wait, tone: TONE[s.room] ?? "#ecebf3" });
  }
  /** Milliseconds from the start to arriving at route point k (the pause is at the far end). */
  private legTime(w: Walker, k: number) { let t = 0; for (let i = 0; i < k; i++) t += w.legs[i]! * 2; return t; }

  /** Where a walker is now, and whether it is moving (for the hop). */
  where(w: Walker, now: number): { x: number; y: number; moving: boolean } {
    const half = (w.route.length + 1) / 2 - 1; // index of the far point
    let t = now - w.at;
    for (let k = 0; k < w.legs.length; k++) {
      if (k === half && t < w.wait) { const p = w.route[k]!; return { x: p[0], y: p[1], moving: false }; }
      if (k === half) t -= w.wait;
      const d = w.legs[k]! * 2;
      if (t < d) { const a = w.route[k]!, b = w.route[k + 1]!, f = t / d; return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, moving: true }; }
      t -= d;
    }
    const p = w.route[w.route.length - 1]!;
    return { x: p[0], y: p[1], moving: false };
  }
}
