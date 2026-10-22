import { type Nav, type Pt } from "./nav";
import type { ShipStatic, Snapshot } from "./types";
import { FURNACE, RADAR, REACTOR, type RoomKey, type Seat, floorZ } from "./world";

/**
 * Life on the ship, like an AI town: frogs get up from their seats and walk the aisles and corridors, through the
 * doorways, to a real place on the ship (the coffee bar, the reactor, the radar, the furnace, the launch pods,
 * the Night Bosses, the starboard view), stand there a while and walk back; two neighbours meet halfway to talk,
 * facing each other; two that meet at the coffee bar talk too. Every route comes from the walk grid (nav.ts), so
 * nobody crosses a wall or a desk. What they say is short, and its numbers are the ship's live ones.
 */
export type Dir = 0 | 1 | 2 | 3;
type Mode = "out" | "there" | "wait" | "chat" | "back";
type Kind = "coffee" | "reactor" | "radar" | "forge" | "pods" | "bosses" | "view";
export type Walker = {
  seat: number; key: string; k: number; route: Pt[]; leg: number; x: number; y: number; z: number; dir: Dir; dist: number; v: number;
  mode: Mode; face: Dir; until: number; partner: Walker | null; gesture: number; ph: number; kind: Kind | "pair"; blinkAt: number;
};
export type Bubble = { w: Walker | null; seat: number | null; text: string; from: number; until: number; tone: string };
export type Mover = { key: string; k: number; tier: number; walks: boolean };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const n0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const h1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
export const TONE: Record<RoomKey, string> = { bridge: "#7fd6ff", quarters: "#ffcf86", offices: "#b9a4ff", breakroom: "#ff8fc0", missions: "#c6f27a", engine: "#ffc073", forge: "#ff9a66", drive: "#a996ff" };
/** The screen direction a floor step (dx, dy) faces: 0 toward the camera, 1 left, 2 right, 3 away. */
export function facing(dx: number, dy: number): Dir {
  // side views win unless the step is nearly straight at or away from the camera: faces stay in view
  const sx = dx - dy, sy = (dx + dy) / 2;
  if (Math.abs(sx) > Math.abs(sy) * (sy < 0 ? 0.3 : 0.9)) return sx > 0 ? 2 : 1;
  return sy > 0 ? 0 : 3;
}

/** The places people walk to: points on the deck and the way each one faces there. */
function places(): Record<Kind, { at: Pt; face: Dir }[]> {
  const ring = (c: { x: number; y: number }, r: number, a0: number, a1: number, n: number) => Array.from({ length: n }, (_, k) => {
    const a = ((a0 + ((a1 - a0) * k) / Math.max(1, n - 1)) * Math.PI) / 180, x = c.x + r * Math.cos(a), y = c.y + r * Math.sin(a);
    return { at: [x, y] as Pt, face: facing(c.x - x, c.y - y) };
  });
  return {
    coffee: Array.from({ length: 10 }, (_, k) => ({ at: [3.65, 38.3 + 1.36 * k] as Pt, face: 1 as Dir })),
    reactor: ring(REACTOR, 4.5, 0, 330, 12),
    radar: ring(RADAR, 3.4, 4, 86, 6),
    forge: [{ at: [FURNACE.x + 3.7, FURNACE.y + 0.4] as Pt, face: 3 as Dir }, { at: [FURNACE.x + 0.5, FURNACE.y + 3.8] as Pt, face: 3 as Dir }, { at: [FURNACE.x + 3.9, FURNACE.y + 2.3] as Pt, face: 1 as Dir }, { at: [FURNACE.x + 2.3, FURNACE.y + 3.9] as Pt, face: 2 as Dir }],
    pods: Array.from({ length: 11 }, (_, k) => ({ at: [29.25, 37.8 + 1.45 * k] as Pt, face: 2 as Dir })),
    bosses: Array.from({ length: 4 }, (_, k) => ({ at: [3.15, 22.9 + 3.4 * k] as Pt, face: 1 as Dir })),
    view: Array.from({ length: 6 }, (_, k) => ({ at: [31.0, 22 + 2.4 * k] as Pt, face: 2 as Dir })),
  };
}
/** Where each room's crew likes to go (the rest of the time: a chat with a neighbour). */
const WANT: Record<RoomKey, [Kind | "pair", number][]> = {
  bridge: [["radar", 0.45], ["coffee", 0.15], ["pair", 0.4]],
  quarters: [["bosses", 0.3], ["coffee", 0.3], ["pair", 0.4]],
  offices: [["view", 0.3], ["coffee", 0.3], ["pair", 0.4]],
  breakroom: [["coffee", 0.55], ["pair", 0.45]],
  missions: [["pods", 0.45], ["coffee", 0.15], ["pair", 0.4]],
  engine: [["reactor", 0.45], ["coffee", 0.15], ["pair", 0.4]],
  forge: [["forge", 0.5], ["coffee", 0.1], ["pair", 0.4]],
  drive: [["reactor", 1]],
};
const choose = <T,>(xs: [T, number][]) => { let r = Math.random() * xs.reduce((a, [, w]) => a + w, 0); for (const [v, w] of xs) { r -= w; if (r <= 0) return v; } return xs[0]![0]; };
const len = (r: Pt[]) => r.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - r[i]![0], p[1] - r[i]![1]), 0);
/** The point `d` tiles along a route, and the route up to it. */
function upTo(r: Pt[], d: number): Pt[] {
  const out: Pt[] = [r[0]!];
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1]!, b = r[i]!, s = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s >= d) { const f = d / Math.max(1e-6, s); out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); return out; }
    d -= s; out.push(b);
  }
  return out;
}

export class Life {
  walkers: Walker[] = [];
  bubbles: Bubble[] = [];
  private out = new Map<number, Walker>();
  private spots: Record<Kind, { at: Pt; face: Dir }[]>;
  private nextWalk = 0;
  private nextTalk = 0;
  private rest = new Map<string, number>();
  private woke = new Map<string, number>();
  constructor(private nav: Nav, private seats: readonly Seat[], private st: ShipStatic) {
    const raw = places();
    this.spots = Object.fromEntries(Object.entries(raw).map(([k, list]) => [k, list.map((p) => ({ ...p, at: nav.nearest(p.at[0], p.at[1], 2, 8) })).filter((p) => p.at) as { at: Pt; face: Dir }[]])) as Record<Kind, { at: Pt; face: Dir }[]>;
  }
  /** The walker of a seat, if its frog is up. */
  of(seat: number) { return this.out.get(seat); }
  byKey(key: string) { return this.walkers.find((w) => w.key === key); }
  /** The followed character gets up soon, and keeps on the move while it is followed. */
  wake(key: string, now: number) { this.woke.set(key, now + 900); this.rest.delete(key); }

  step(now: number, dt: number, snap: Snapshot | null, occ: Map<number, Mover>, onScreen: (seat: number) => boolean, max: number, follow: string | null) {
    this.occ = occ;
    // walkers whose seat changed hands (a new snapshot) go; the rest move
    for (const w of this.walkers) if (occ.get(w.seat)?.key !== w.key) w.mode = "back", w.route = [], w.until = -1;
    this.walkers = this.walkers.filter((w) => w.until !== -1);
    for (const w of this.walkers) this.move(w, dt, now, snap);
    this.walkers = this.walkers.filter((w) => w.until !== -1);
    this.out = new Map(this.walkers.map((w) => [w.seat, w]));
    this.bubbles = this.bubbles.filter((b) => now < b.until && (!b.w || this.walkers.includes(b.w)) && (b.seat === null || !this.out.has(b.seat)));
    if (!snap) return;
    // the followed one first
    if (follow) {
      const at = this.woke.get(follow);
      const seat = [...occ.entries()].find(([, m]) => m.key === follow)?.[0];
      if (seat !== undefined && !this.out.has(seat) && occ.get(seat)!.walks && at !== undefined && now > at && now > (this.rest.get(follow) ?? 0)) {
        this.woke.delete(follow);
        if (!this.trip(seat, now, true)) this.woke.set(follow, now + 4000);
      } else if (seat !== undefined && !this.out.has(seat) && at === undefined && now > (this.rest.get(follow) ?? 0)) this.woke.set(follow, now + rnd(5000, 9000));
    }
    if (now > this.nextWalk && this.walkers.length < max) {
      this.nextWalk = now + rnd(220, 600);
      const all = [...occ.entries()].filter(([i, m]) => m.walks && !this.out.has(i) && now > (this.rest.get(m.key) ?? 0));
      const seen = all.filter(([i]) => onScreen(i));
      const pool = seen.length && Math.random() < 0.8 ? seen : all;
      if (pool.length) {
        const [i, m] = pick(pool);
        // the Night Watch and the Night Bosses keep their seats more
        if (!m.tier || Math.random() < 0.25) this.start(i, now, occ, onScreen);
      }
    }
    // neighbours at their seats talk now and then
    if (now > this.nextTalk) {
      this.nextTalk = now + rnd(1400, 2800);
      const seen = [...occ.keys()].filter((i) => !this.out.has(i) && onScreen(i));
      if (seen.length > 1 && this.bubbles.length < 7) {
        const a = pick(seen), room = this.seats[a]!.room;
        let b = -1, bd = 1e9;
        for (const i of seen) { const s = this.seats[i]!; if (i === a || s.room !== room) continue; const d = Math.hypot(s.x - this.seats[a]!.x, s.y - this.seats[a]!.y); if (d < bd) { bd = d; b = i; } }
        if (b >= 0 && bd < 3.2) {
          const [q, ans] = this.talk(room, snap);
          if (q) {
            this.bubbles.push({ w: null, seat: a, text: q, from: now, until: now + 2600, tone: TONE[room] });
            this.bubbles.push({ w: null, seat: b, text: ans, from: now + 1300, until: now + 4600, tone: TONE[room] });
          }
        }
      }
    }
  }

  private start(i: number, now: number, occ: Map<number, Mover>, onScreen: (seat: number) => boolean) {
    const s = this.seats[i]!, m = occ.get(i)!;
    const want = m.tier ? ([["radar", 0.55], ["coffee", 0.2], ["forge", 0.25]] as [Kind, number][]) : WANT[s.room];
    let kind = choose<Kind | "pair">(want);
    // now and then, somewhere else on the ship
    if (kind !== "pair" && Math.random() < 0.18) kind = pick<Kind>(["coffee", "reactor", "radar", "forge"]);
    if (kind === "pair") {
      const near = [...occ.entries()].filter(([j, o]) => j !== i && o.walks && !o.tier && !this.out.has(j) && this.seats[j]!.room === s.room && onScreen(j) && Math.hypot(this.seats[j]!.x - s.x, this.seats[j]!.y - s.y) < 7);
      if (near.length && this.pair(i, pick(near)[0], now)) return;
      kind = "coffee";
    }
    this.trip(i, now, false, kind);
  }

  /** A walk from a seat to a place and back. */
  private trip(i: number, now: number, far: boolean, kind?: Kind): boolean {
    const s = this.seats[i]!, key = this.keyOf(i);
    if (!key) return false;
    const k0: Kind = kind ?? (far ? pick<Kind>(["coffee", "reactor", "radar", "forge", "pods"].filter((x) => x !== this.home(s.room)) as Kind[]) : "coffee");
    const exit = this.nav.exitOf(s);
    if (!exit) return false;
    const taken = this.walkers.filter((w) => w.kind === k0).map((w) => w.route[w.route.length - 1]!);
    const free = this.spots[k0].filter((p) => !taken.some((t) => Math.hypot(t[0] - p.at[0], t[1] - p.at[1]) < 0.8));
    if (!free.length) return false;
    const spot = free.reduce((b, p) => (Math.hypot(p.at[0] - exit[0], p.at[1] - exit[1]) + Math.random() * 6 < Math.hypot(b.at[0] - exit[0], b.at[1] - exit[1]) + Math.random() * 6 ? p : b));
    const path = this.nav.path(exit, spot.at);
    if (!path) return false;
    const w = this.walker(i, key, [[s.x, s.y], ...path], now, k0);
    w.face = spot.face;
    return true;
  }
  private home(r: RoomKey): Kind | null { return r === "breakroom" ? "coffee" : r === "engine" ? "reactor" : r === "bridge" ? "radar" : r === "forge" ? "forge" : r === "missions" ? "pods" : null; }
  private occ = new Map<number, Mover>();
  private keyOf(i: number) { return this.occ.get(i)?.key ?? null; }
  private walker(i: number, key: string, route: Pt[], now: number, kind: Walker["kind"]): Walker {
    const s = this.seats[i]!;
    const w: Walker = { seat: i, key, k: this.occ.get(i)?.k ?? 1, route, leg: 1, x: s.x, y: s.y, z: s.z, dir: 0, dist: 0, v: 0, mode: "out", face: 0, until: 0, partner: null, gesture: 0, ph: Math.random(), kind, blinkAt: now + rnd(800, 4000) };
    this.walkers.push(w);
    this.out.set(i, w);
    return w;
  }

  /** Two neighbours meet halfway and talk. */
  private pair(a: number, b: number, now: number): boolean {
    const sa = this.seats[a]!, sb = this.seats[b]!, ka = this.keyOf(a), kb = this.keyOf(b);
    if (!ka || !kb) return false;
    const ea = this.nav.exitOf(sa), eb = this.nav.exitOf(sb);
    if (!ea || !eb) return false;
    const p = this.nav.path(ea, eb);
    if (!p) return false;
    const L = len(p);
    if (L < 1.2) return false;
    const ra = upTo(p, L / 2 - 0.42), rb = upTo([...p].reverse(), L / 2 - 0.42);
    const wa = this.walker(a, ka, [[sa.x, sa.y], ...ra], now, "pair"), wb = this.walker(b, kb, [[sb.x, sb.y], ...rb], now, "pair");
    wa.partner = wb; wb.partner = wa;
    return true;
  }

  private move(w: Walker, dt: number, now: number, snap: Snapshot | null) {
    if (w.mode === "there" || w.mode === "chat" || w.mode === "wait") {
      if (now > w.blinkAt + 140) w.blinkAt = now + rnd(2200, 6000);
      if (w.mode === "wait") {
        const p = w.partner;
        if (!p || !this.walkers.includes(p)) { this.goBack(w, now); return; }
        if (p.mode === "wait" && snap) this.chat(w, p, now, snap);
        else if (now - w.until > 9000) this.goBack(w, now);
        return;
      }
      if (now > w.until) {
        if (w.partner && w.mode === "chat") { const p = w.partner; w.partner = null; if (p.partner === w) p.partner = null; }
        this.goBack(w, now);
      }
      return;
    }
    const r = w.route;
    let rem = 0, px = w.x, py = w.y;
    for (let i = w.leg; i < r.length; i++) { rem += Math.hypot(r[i]![0] - px, r[i]![1] - py); px = r[i]![0]; py = r[i]![1]; }
    const vmax = w.k > 1.6 ? 1.45 : w.k > 1.3 ? 1.65 : 1.85, acc = 4.5;
    w.v = Math.min(vmax, w.v + acc * dt, Math.sqrt(2 * acc * rem) + 0.25);
    let step = w.v * dt;
    while (step > 0 && w.leg < r.length) {
      const [tx, ty] = r[w.leg]!, dx = tx - w.x, dy = ty - w.y, d = Math.hypot(dx, dy);
      if (d > 0.02) w.dir = facing(dx, dy);
      if (d <= step) { w.x = tx; w.y = ty; step -= d; w.dist += d; w.leg++; }
      else { w.x += (dx / d) * step; w.y += (dy / d) * step; w.dist += step; step = 0; }
    }
    w.z = floorZ(w.x, w.y);
    if (w.leg < r.length) return;
    w.v = 0;
    if (w.mode === "back") { w.until = -1; this.rest.set(w.key, now + rnd(6000, 14000)); return; }
    // arrived
    if (w.kind === "pair") { w.mode = "wait"; w.until = now; return; }
    w.mode = "there"; w.dir = w.face; w.until = now + rnd(3500, 7000);
    if (!snap) return;
    // someone already here: they talk
    const other = this.walkers.find((o) => o !== w && o.mode === "there" && !o.partner && Math.hypot(o.x - w.x, o.y - w.y) < 1.9);
    if (other) { this.chat(other, w, now, snap); return; }
    if (Math.random() < 0.7 && this.bubbles.length < 9) { const line = this.solo(w, snap); if (line) this.say(w, line, now + 250, 2800); }
  }

  private goBack(w: Walker, now: number) {
    const r = w.route.slice(0, Math.max(1, w.leg)).reverse();
    r[0] = [w.x, w.y];
    w.route = r; w.leg = 1; w.mode = "back"; w.partner = null; w.until = now;
  }

  private chat(a: Walker, b: Walker, now: number, snap: Snapshot) {
    a.partner = b; b.partner = a;
    a.mode = b.mode = "chat";
    // face each other, on screen
    const ax = a.x - a.y, bx = b.x - b.y, left = ax < bx || (ax === bx && a.x + a.y < b.x + b.y);
    a.dir = left ? 2 : 1; b.dir = left ? 1 : 2;
    const [q, ans] = this.talk(this.roomAt(a), snap);
    if (q) { this.say(a, q, now + 200, 2600); this.say(b, ans, now + 1500, 3300); }
    a.until = b.until = now + 5400;
  }
  private roomAt(w: Walker): RoomKey { const y = w.y, x = w.x; return y < 20 ? "bridge" : y < 36 ? (x < 15 ? "quarters" : "offices") : y < 54 ? (x < 16 ? "breakroom" : "missions") : y < 76 ? "engine" : x < 16 ? "forge" : "drive"; }

  private say(w: Walker, text: string, from: number, ms: number) {
    if (this.bubbles.some((b) => b.w === w && b.until > from)) return;
    this.bubbles.push({ w, seat: null, text, from, until: from + ms, tone: TONE[this.roomAt(w)] });
    w.gesture = from + Math.min(ms, 1500);
  }

  /** A question and its answer for a room, from the live numbers (or a short neutral line). */
  private talk(room: RoomKey, s: Snapshot): [string, string] {
    const t = s.totals, r = s.radar;
    const P: Record<RoomKey, [string, string][]> = {
      bridge: [r ? ["Radar check?", `${r.loans.length} loans, peg ${r.peg ? r.peg.toFixed(3) : "n/a"}`] : ["Radar check?", "No read yet."], r ? ["What's owed?", `${n0(r.totalDebt)} imdUSD`] : ["Quiet night?", "So far."], ["Watch seats?", `${s.watchers.filter((w) => w.n !== 0).length} of 50 forged`]],
      quarters: [["Holders?", `${n0(t.holders)} wallets`], ["Any Watchers?", `${t.watchers} forged`]],
      offices: [["Busy?", `${n0(t.held)} frogs aboard`], ["Ship-wide?", `${h1(t.perHour)} h/h`]],
      breakroom: [["Coffee?", "Always. Night shift."], ["Earning?", `${h1(t.perHour)} h/h, all of us`], ["Long shift?", "3 AM again."]],
      missions: [["Who's out?", `${t.onMissions} on missions`], ["This week?", pick(this.st.missions)?.title ?? "Missions."]],
      engine: [["How's the shift?", `${h1(t.perHour)} h/h, all crew`], ["Reactor?", "Steady."]],
      forge: [["How many forged?", `${t.burned} frogs, ${t.watchers} Watchers`], ["Next one?", "10 frogs in, 1 out."]],
      drive: [["Engines?", "All three lit."]],
    };
    const fresh = P[room].filter(([q, ans]) => !this.bubbles.some((b) => b.text === q || b.text === ans));
    return fresh.length ? pick(fresh) : ["", ""];
  }
  private solo(w: Walker, s: Snapshot): string | null {
    const t = s.totals;
    switch (w.kind) {
      case "coffee": return pick(["Refill.", "Black, no sugar.", "Coffee first."]);
      case "reactor": return pick(["Reactor's steady.", `${h1(t.perHour)} h/h, all crew`]);
      case "radar": return s.radar ? `${s.radar.loans.length} loans on radar` : "Radar's quiet.";
      case "forge": return `${t.burned} frogs forged so far`;
      case "pods": return `${t.onMissions} out on missions`;
      case "bosses": return `${s.watchers.filter((x) => x.tier === 5).length} of 4 Night Bosses`;
      case "view": return pick(["Stars are out.", "Nice view."]);
      default: return null;
    }
  }
}
