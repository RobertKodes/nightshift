import type { Who } from "./cast";
import { type Nav, type Pt } from "./nav";
import type { ShipStatic, Snapshot, Station } from "./types";
import { ARCADE, CHART, FURNACE, MARKET, PEG, PLINTHS, PODS, POOL, RADAR, REACTOR, ROOMS, type RoomKey, SEATS, type Seat, type SeatKind, floorZ } from "./world";

/**
 * Life on the ship: every frog and Night Watcher aboard is up and about, each doing its station's work, and each
 * thing it does is a NIGHTSHIFT mechanic. The shift floor works the stations and checks the reactor (shift hours);
 * the Night Watch patrols the bridge and gathers at the radar when a real loan needs marking or liquidating; frogs
 * sent on a mission walk to the pods and launch; the forge crew tends the furnace, and on a real forge its ten frogs
 * walk into the fire and a Night Watcher walks out; the breakroom plays pool and the arcade; the offices carry work
 * to the market. Seats are only for a short spell of work. Every walk comes from the walk grid (nav.ts), so nobody
 * crosses a wall or a desk; every number said or floated is the ship's live one.
 */
export type Dir = 0 | 1 | 2 | 3;
export type Role = "shift" | "bridge" | "control" | "office" | "break" | "officer" | "forge" | "watch" | "captain" | "mission" | "doomed";
export type Mode = "walk" | "stand" | "sit" | "gone" | "launch" | "land" | "vanish" | "appear";
type Kind = "coffee" | "reactor" | "radar" | "patrol" | "forge" | "pool" | "arcade" | "market" | "pods" | "bosses" | "view" | "holo" | "wander" | "furnace";
type Spot = { at: Pt; face: Dir; kind: Kind };
export type Status = "online" | "offline" | "unpaired";
export type Member = { key: string; who: Who; role: Role; room: Station; rate: number; title: string | null; home: number | null; status: Status | null; n: number | null };
export type Agent = Member & {
  x: number; y: number; z: number; dir: Dir; v: number; dist: number; route: Pt[]; leg: number; mode: Mode;
  seat: number | null; spot: Spot | null; next: { seat: number | null; spot: Spot | null } | null;
  until: number; partner: Agent | null; gesture: number; blinkAt: number; ph: number; carry: boolean; t0: number; want: boolean; tag: string | null;
};
export type Bubble = { a: Agent; text: string; from: number; until: number; tone: string };
export type Float = { a: Agent; text: string; from: number; until: number };
/** The world outside the ship the crew talks about: live games and companies (null: not read). */
export type Outside = { games: { total: number; pool: number; pinball: number } | null; companies: { count: number; working: { name: string; title: string }[] } | null };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const n0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const h1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
export const h2 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
export const TONE: Record<RoomKey, string> = { bridge: "#7fd6ff", quarters: "#ffcf86", offices: "#b9a4ff", breakroom: "#ff8fc0", missions: "#c6f27a", engine: "#ffc073", forge: "#ff9a66", drive: "#a996ff" };
/** The screen direction a floor step (dx, dy) faces: 0 toward the camera, 1 left, 2 right, 3 away. Side views win unless the step is nearly straight at or away from the camera. */
export function facing(dx: number, dy: number): Dir {
  const sx = dx - dy, sy = (dx + dy) / 2;
  if (Math.abs(sx) > Math.abs(sy) * (sy < 0 ? 0.3 : 0.9)) return sx > 0 ? 2 : 1;
  return sy > 0 ? 0 : 3;
}
export function roomAt(x: number, y: number): RoomKey { return y < 20 ? "bridge" : y < 36 ? (x < 15 ? "quarters" : "offices") : y < 54 ? (x < 16 ? "breakroom" : "missions") : y < 76 ? "engine" : x < 16 ? "forge" : "drive"; }

/** The seats each role works at (a short spell each). */
const SEATS_OF: Partial<Record<Role, (s: Seat) => boolean>> = {
  shift: (s) => s.room === "engine", bridge: (s) => s.room === "bridge" && s.kind === "console", control: (s) => s.room === "missions" && s.kind === "control",
  office: (s) => s.room === "offices", break: (s) => s.room === "breakroom", officer: (s) => s.room === "quarters" && s.kind !== "plinth", forge: (s) => s.room === "forge",
};
/** What each role does next, by weight. "seat": a spell at one of its seats; "home": its own seat; "meet": a word with a neighbour. */
type Plan = Kind | "seat" | "home" | "meet";
const PLANS: Partial<Record<Role, [Plan, number][]>> = {
  shift: [["seat", 0.42], ["reactor", 0.3], ["coffee", 0.08], ["wander", 0.1], ["meet", 0.1]],
  bridge: [["seat", 0.38], ["radar", 0.22], ["holo", 0.12], ["patrol", 0.1], ["meet", 0.12], ["coffee", 0.06]],
  control: [["seat", 0.38], ["pods", 0.3], ["coffee", 0.08], ["wander", 0.1], ["meet", 0.14]],
  office: [["seat", 0.32], ["market", 0.38], ["coffee", 0.1], ["view", 0.08], ["meet", 0.12]],
  break: [["pool", 0.24], ["arcade", 0.22], ["coffee", 0.2], ["seat", 0.14], ["wander", 0.06], ["meet", 0.14]],
  officer: [["seat", 0.34], ["bosses", 0.22], ["coffee", 0.14], ["wander", 0.12], ["meet", 0.18]],
  forge: [["seat", 0.36], ["forge", 0.44], ["wander", 0.08], ["meet", 0.12]],
  watch: [["patrol", 0.45], ["radar", 0.33], ["home", 0.22]],
  captain: [["home", 0.6], ["radar", 0.25], ["patrol", 0.15]],
};
const choose = <T,>(xs: [T, number][]) => { let r = Math.random() * xs.reduce((a, [, w]) => a + w, 0); for (const [v, w] of xs) { r -= w; if (r <= 0) return v; } return xs[0]![0]; };
const FAR: Kind[] = ["coffee", "reactor", "forge", "pool", "market", "radar"];

export class Life {
  agents: Agent[] = [];
  bubbles: Bubble[] = [];
  floats: Float[] = [];
  /** Who sits in each seat now. */
  readonly seated = new Map<number, Agent>();
  /** A pod leaving (out) or coming back (in): its seat and when it began. */
  readonly pods = new Map<number, { t0: number; out: boolean }>();
  private byKey = new Map<string, Agent>();
  private reserved = new Map<number, Agent>();
  private spots: Record<Kind, Spot[]>;
  private cells: Partial<Record<RoomKey, Pt[]>> = {};
  private usable: Set<number>;
  private exits = new Map<number, Pt>();
  private nextTalk = 0;
  private alertAt = 0;
  outside: Outside = { games: null, companies: null };
  /** A flare at the furnace (a frog went in, a Night Watcher came out): the scene lights it up. */
  onFlare?: () => void;

  constructor(private nav: Nav, private st: ShipStatic) {
    const near = (p: Pt) => { const q = nav.nearest(p[0], p[1], 2, 10); return q && nav.reach(q[0], q[1]) ? q : null; };
    const ring = (c: { x: number; y: number }, r: number, a0: number, a1: number, step: number, kind: Kind) => {
      const out: Spot[] = [];
      for (let a = a0; a <= a1; a += step) { const x = c.x + r * Math.cos((a * Math.PI) / 180), y = c.y + r * Math.sin((a * Math.PI) / 180); if (nav.reach(x, y)) out.push({ at: [x, y], face: facing(c.x - x, c.y - y), kind }); }
      return out;
    };
    const at = (list: [number, number, Dir][], kind: Kind) => list.map(([x, y, f]) => { const q = near([x, y]); return q ? { at: q, face: f, kind } : null; }).filter(Boolean) as Spot[];
    this.spots = {
      coffee: at(Array.from({ length: 10 }, (_, k) => [3.65, 38.3 + 1.36 * k, 1] as [number, number, Dir]), "coffee"),
      reactor: ring(REACTOR, 4.5, 0, 345, 15, "reactor"),
      radar: [...ring(RADAR, 3.4, -20, 110, 9, "radar")],
      patrol: ring(RADAR, 8.1, 0, 359, 18, "patrol"),
      forge: at([[FURNACE.x + 3.7, FURNACE.y + 0.4, 3], [FURNACE.x + 0.4, FURNACE.y + 3.8, 3], [FURNACE.x + 3.9, FURNACE.y + 2.3, 1], [FURNACE.x + 2.3, FURNACE.y + 3.9, 2], [FURNACE.x - 0.6, FURNACE.y + 3.2, 2], [FURNACE.x + 3.2, FURNACE.y - 0.8, 1]], "forge"),
      pool: at([[POOL.x - POOL.hx - 0.55, POOL.y - 0.5, 2], [POOL.x - POOL.hx - 0.55, POOL.y + 0.6, 2], [POOL.x + POOL.hx + 0.55, POOL.y, 1], [POOL.x, POOL.y - POOL.hy - 0.55, 0], [POOL.x, POOL.y + POOL.hy + 0.55, 3]], "pool"),
      arcade: at(ARCADE.map(([x, y]) => [x, y + 1.0, 3] as [number, number, Dir]), "arcade"),
      market: at([[MARKET.x - 0.95, MARKET.y - 0.4, 2], [MARKET.x - 0.95, MARKET.y + 0.6, 2], [MARKET.x - 0.3, MARKET.y + 1.0, 3]], "market"),
      pods: at(Array.from({ length: 11 }, (_, k) => [29.25, 37.8 + 1.45 * k, 2] as [number, number, Dir]), "pods"),
      bosses: at(PLINTHS.map((p) => [p.x + 1.25, p.y + 0.3, 1] as [number, number, Dir]), "bosses"),
      view: at(Array.from({ length: 5 }, (_, k) => [31.0, 22 + 2.4 * k, 2] as [number, number, Dir]), "view"),
      holo: at([[PEG.x + 1.2, PEG.y + 0.6, 1], [CHART.x - 0.6, CHART.y + 1.2, 3]], "holo"),
      wander: [], furnace: at([[FURNACE.x + 2.9, FURNACE.y + 0.3, 3]], "furnace"),
    };
    for (const r of ROOMS) this.cells[r.key] = nav.cellsIn(r.x0 + 0.3, r.y0 + 0.3, r.x1 - 0.3, r.y1 - 0.3);
    // the seats a frog can get to and up from
    this.usable = new Set(SEATS.filter((s) => { const e = nav.exitOf(s); if (!e || !nav.reach(e[0], e[1])) return false; this.exits.set(s.i, e); return true; }).map((s) => s.i));
  }
  get(key: string) { return this.byKey.get(key); }
  isUsable(seat: number) { return this.usable.has(seat); }

  // ------------------------------------------------------------------ the roster
  /** The crew from a snapshot: new ones come aboard where they would be, the ones that left go, the rest carry on. */
  setCrew(list: Member[], now: number) {
    const keep = new Set(list.map((m) => m.key));
    for (const a of this.agents) if (!keep.has(a.key) && a.role !== "doomed") this.drop(a);
    this.agents = this.agents.filter((a) => keep.has(a.key) || a.role === "doomed");
    for (const m of list) {
      const a = this.byKey.get(m.key);
      if (a) { if (a.role !== "doomed" && a.role !== "mission" && m.role !== "mission") Object.assign(a, { role: m.role, room: m.room }); Object.assign(a, { rate: m.rate, title: m.title, home: m.home, status: m.status, who: m.who, n: m.n }); continue; }
      const b = this.spawn(m, now);
      this.agents.push(b); this.byKey.set(b.key, b);
    }
  }
  private blank(m: Member, now: number): Agent {
    return { ...m, x: 0, y: 0, z: 0, dir: 0, v: 0, dist: 0, route: [], leg: 0, mode: "stand", seat: null, spot: null, next: null, until: now + rnd(0, 6000), partner: null, gesture: 0, blinkAt: now + rnd(500, 5000), ph: Math.random(), carry: false, t0: 0, want: false, tag: null };
  }
  /** A new crew member, placed as if it had been aboard all along: at a seat, at a place, or out on the deck. */
  private spawn(m: Member, now: number): Agent {
    const a = this.blank(m, now);
    if (m.role === "mission") { a.mode = "gone"; return a; }
    if (m.home !== null && (m.role === "captain" || Math.random() < 0.45) && !this.seated.has(m.home)) { this.sitAt(a, m.home, now, rnd(2000, 14000)); return a; }
    const seats = SEATS_OF[m.role];
    if (seats && Math.random() < 0.3) { const s = this.freeSeat(a, seats); if (s !== null) { this.sitAt(a, s, now, rnd(1000, 12000)); return a; } }
    const kinds = (PLANS[m.role] ?? []).filter(([k]) => k !== "seat" && k !== "home" && k !== "meet").map(([k]) => k as Kind);
    const sp = Math.random() < 0.5 && kinds.length ? this.freeSpot(pick(kinds), a) : null;
    if (sp) { a.spot = sp; a.x = sp.at[0]; a.y = sp.at[1]; a.dir = sp.face; }
    else { const c = this.cells[m.room]; const p = c?.length ? pick(c) : (this.cells.engine ?? [[16, 70]])[0]!; a.x = p[0]; a.y = p[1]; a.dir = pick([0, 1, 2] as Dir[]); }
    a.z = floorZ(a.x, a.y);
    return a;
  }
  private drop(a: Agent) {
    if (a.seat !== null) this.seated.delete(a.seat);
    for (const [s, b] of this.reserved) if (b === a) this.reserved.delete(s);
    if (a.partner) a.partner.partner = null;
    this.byKey.delete(a.key);
    this.bubbles = this.bubbles.filter((b) => b.a !== a);
  }

  // ------------------------------------------------------------------ real events
  /** The hourly shift-hours credit: every frog on screen floats what it just earned. */
  credit(now: number, onScreen: (a: Agent) => boolean) {
    for (const a of this.agents) if (a.mode !== "gone" && a.role !== "doomed" && a.rate > 0 && onScreen(a)) { const f = now + rnd(0, 1600); this.floats.push({ a, text: `+${h2(a.rate)} h`, from: f, until: f + 2800 }); }
  }
  /** A real forge: its ten frogs walk into the furnace one by one, then the new Night Watcher walks out to its seat. */
  forge(victims: Member[], born: Member, now: number) {
    const mouth = this.spots.furnace[0]?.at ?? [FURNACE.x + 2.9, FURNACE.y + 0.3];
    const door = this.nav.nearest(8.2, 77.0, 2, 10) ?? mouth;
    victims.forEach((m, i) => {
      let a = this.byKey.get(m.key);
      if (!a || a.mode === "gone") {
        a = this.blank(m, now);
        const p = this.cells.forge?.length ? pick(this.cells.forge) : door;
        a.x = p[0]; a.y = p[1]; a.z = 0;
        this.agents.push(a); this.byKey.set(a.key, a);
      }
      this.release(a);
      a.role = "doomed"; a.tag = born.n === 0 ? "The Captain" : `Night Watcher #${born.n}`; a.mode = "stand"; a.until = now + 400 + i * 650; a.carry = false;
      a.next = { seat: null, spot: { at: mouth, face: 3, kind: "furnace" } }; a.want = false;
      if (i === 0) this.say(a, `${victims.length} of us into ${a.tag}`, now + 300, 4200, true);
    });
    let w = this.byKey.get(born.key);
    if (!w) { w = this.blank(born, now); this.agents.push(w); this.byKey.set(w.key, w); }
    this.release(w);
    w.mode = "gone"; w.t0 = now + 1500 + victims.length * 650 + 9000; w.tag = "fresh";
  }
  /** A real mission begins: the frog walks to a pod, boards, and the pod launches. */
  missionStart(key: string, title: string, now: number) {
    const a = this.byKey.get(key);
    if (!a || a.mode === "gone") return;
    this.release(a);
    a.role = "mission"; a.title = title;
    const pod = PODS.find((p) => !this.seated.has(p.i) && !this.reserved.has(p.i) && this.usable.has(p.i));
    if (!pod) { a.mode = "gone"; return; }
    this.reserved.set(pod.i, a);
    a.next = { seat: pod.i, spot: null }; a.want = true; a.mode = "stand"; a.until = now;
  }
  /** A real mission is done: a pod comes back with the frog, and it walks back to its station. */
  missionEnd(key: string, role: Role, room: Station, now: number) {
    const a = this.byKey.get(key);
    if (!a) return;
    a.role = role; a.room = room; a.title = null;
    if (a.mode !== "gone") return;
    const pod = PODS.find((p) => !this.seated.has(p.i) && !this.reserved.has(p.i) && !this.pods.has(p.i) && this.usable.has(p.i));
    if (!pod) { const c = this.cells.missions; if (c?.length) { const p = pick(c); a.x = p[0]; a.y = p[1]; a.mode = "stand"; a.until = now + 800; } return; }
    this.seated.set(pod.i, a); a.seat = pod.i; a.x = pod.x; a.y = pod.y; a.z = pod.z; a.mode = "land"; a.t0 = now; a.until = now + 3400;
    this.pods.set(pod.i, { t0: now, out: false });
  }
  /** A watch seat's bot came online or went offline. */
  watchChange(key: string, online: boolean, now: number) {
    const a = this.byKey.get(key);
    if (a && a.mode !== "gone") this.say(a, online ? "Bot online: on watch" : "Bot offline", now, 3600, true);
  }

  // ------------------------------------------------------------------ each frame
  step(now: number, dt: number, snap: Snapshot | null, onScreen: (a: Agent) => boolean, budget: number, follow: string | null) {
    let paths = 0;
    for (const a of this.agents) {
      if (a.mode === "gone") {
        if (a.tag === "fresh" && now > a.t0) this.appear(a, now);
        continue;
      }
      if (a.mode === "walk") { this.move(a, dt, now, snap); continue; }
      if (a.mode === "vanish") { if (now > a.until) { a.mode = "gone"; a.until = -1; } continue; }
      if (a.mode === "appear") { if (now > a.until) { a.mode = "stand"; a.until = now + 1200; a.next = a.home !== null ? { seat: a.home, spot: null } : null; } continue; }
      if (a.mode === "launch") { if (now > a.until) { if (a.seat !== null) { this.seated.delete(a.seat); this.pods.delete(a.seat); } a.seat = null; a.mode = "gone"; } continue; }
      if (a.mode === "land") { if (now > a.until) { if (a.seat !== null) this.pods.delete(a.seat); a.mode = "sit"; a.until = now + 900; } continue; }
      if (now > a.blinkAt + 140) a.blinkAt = now + rnd(2200, 6000);
      // standing at work: the hands keep busy
      if (a.mode === "stand" && a.spot && !a.partner && ["pool", "arcade", "forge", "reactor", "market"].includes(a.spot.kind) && now > a.gesture + 900 && Math.random() < dt * 0.9) a.gesture = now + 1100;
      if (a.mode === "stand" && a.partner && now > a.until) { const p = a.partner; a.partner = null; if (p.partner === a) p.partner = null; }
      // the followed one does not sit for long
      if (a.key === follow && a.mode === "sit" && a.role !== "captain" && a.until > now + 2500) a.until = now + 2500;
      if ((now > a.until || a.want) && paths < budget) { if (this.think(a, now, snap)) paths++; }
    }
    // the forge's frogs that went into the fire are gone for good
    if (this.agents.some((a) => a.until === -1)) { for (const a of this.agents) if (a.until === -1) this.drop(a); this.agents = this.agents.filter((a) => a.until !== -1); }
    this.bubbles = this.bubbles.filter((b) => now < b.until && b.a.mode !== "gone");
    this.floats = this.floats.filter((f) => now < f.until);
    if (!snap) return;
    // the radar: a real loan that needs the Night Watch
    if (now > this.alertAt && snap.radar) {
      this.alertAt = now + rnd(6000, 11000);
      const line = this.alertLine(snap);
      if (line) {
        const on = this.agents.filter((a) => (a.role === "watch" || a.role === "captain") && a.status === "online" && a.mode !== "gone" && !a.partner);
        const who = on.length ? pick(on) : null;
        if (who && who.spot?.kind !== "radar") { this.release(who); const sp = this.freeSpot("radar", who); if (sp) { who.next = { seat: null, spot: sp }; who.want = true; } }
        else if (who) this.say(who, line, now, 3800, true);
        else {
          // no bot on watch: whoever is at the radar says so
          const by = this.agents.filter((a) => a.mode === "stand" && a.spot?.kind === "radar");
          if (by.length) this.say(pick(by), line, now, 3800, true);
        }
      }
    }
    // a word between two standing near each other, on screen
    if (now > this.nextTalk) {
      this.nextTalk = now + rnd(700, 1600);
      const seen = this.agents.filter((a) => a.mode === "stand" && !a.partner && a.role !== "doomed" && onScreen(a) && now < a.until - 1500);
      if (seen.length > 1 && this.bubbles.length < 10) {
        const a = pick(seen);
        let b: Agent | null = null, bd = 2.4;
        for (const o of seen) { if (o === a) continue; const d = Math.hypot(o.x - a.x, o.y - a.y); if (d < bd) { bd = d; b = o; } }
        if (b) this.chat(a, b, now, snap);
        else if (Math.random() < 0.5) { const l = this.solo(a, snap); if (l) this.say(a, l, now, 2800); }
      }
    }
  }
  /** The followed character gets up soon. */
  wake(key: string, now: number) { const a = this.byKey.get(key); if (a && (a.mode === "sit" || a.mode === "stand") && a.role !== "captain") a.until = Math.min(a.until, now + 900); }
  private sitAt(a: Agent, seat: number, now: number, ms: number) {
    const s = SEATS[seat]!;
    this.seated.set(seat, a); a.seat = seat; a.x = s.x; a.y = s.y; a.z = s.z; a.mode = "sit"; a.dir = 0; a.until = now + ms;
  }

  /** Picks what an agent does next and starts its walk there. True when a walk was looked for. */
  private think(a: Agent, now: number, snap: Snapshot | null): boolean {
    a.want = false;
    if (a.role === "mission" && !a.next) { a.until = now + 1e9; return false; }
    let seat: number | null = null, spot: Spot | null = null;
    if (a.next) { seat = a.next.seat; spot = a.next.spot; a.next = null; }
    else {
      const plans = PLANS[a.role];
      if (!plans) { a.until = now + 3000; return false; }
      let p = choose<Plan>(a.role === "watch" && snap?.radar && this.alertLine(snap) && a.status === "online" ? [["radar", 0.8], ["patrol", 0.2]] : plans);
      if (p !== "seat" && p !== "home" && p !== "meet" && p !== "wander" && a.role !== "watch" && a.role !== "captain" && Math.random() < 0.12) p = pick(FAR);
      if (a.role === "office") a.carry = p === "market";
      if (p === "home") seat = a.home !== null && !this.seated.has(a.home) ? a.home : null;
      else if (p === "seat") seat = this.freeSeat(a, SEATS_OF[a.role]!);
      else if (p === "meet") spot = this.meet(a, now);
      else if (p === "wander") { const c = this.cells[a.room]; if (c?.length) { const q = pick(c); spot = { at: q, face: pick([0, 1, 2] as Dir[]), kind: "wander" }; } }
      else spot = this.freeSpot(p, a);
      if (seat === null && !spot) { const c = this.cells[a.room]; if (c?.length) { const q = pick(c); spot = { at: q, face: 0, kind: "wander" }; } }
    }
    if (seat === null && !spot) { a.until = now + rnd(1500, 3000); return false; }
    // from where it is: up out of its seat, or off the spot it stands on
    let start: Pt = [a.x, a.y], lead: Pt[] = [];
    if (a.mode === "sit" && a.seat !== null) { const e = this.exits.get(a.seat); if (e) { lead = [[a.x, a.y]]; start = e; } }
    else if (!this.nav.free(a.x, a.y)) { const q = this.nav.nearest(a.x, a.y, 1, 8); if (q) { lead = [[a.x, a.y]]; start = q; } }
    const target: Pt | undefined = seat !== null ? this.exits.get(seat) : spot!.at;
    if (!target) { a.until = now + 1500; return false; }
    if (seat !== null) this.reserved.set(seat, a);
    const path = this.nav.path(start, target);
    if (!path) { if (seat !== null && this.reserved.get(seat) === a) this.reserved.delete(seat); a.until = now + rnd(1500, 3500); return true; }
    if (a.seat !== null && a.mode === "sit") { this.seated.delete(a.seat); a.seat = null; }
    this.releaseSpot(a);
    a.route = [...lead, ...path, ...(seat !== null ? [[SEATS[seat]!.x, SEATS[seat]!.y] as Pt] : [])];
    a.leg = 1; a.mode = "walk"; a.v = 0; a.spot = spot; a.seat = seat; a.partner = null;
    return true;
  }

  private move(a: Agent, dt: number, now: number, snap: Snapshot | null) {
    const r = a.route;
    let rem = 0, px = a.x, py = a.y;
    for (let i = a.leg; i < r.length; i++) { rem += Math.hypot(r[i]![0] - px, r[i]![1] - py); px = r[i]![0]; py = r[i]![1]; }
    const vmax = a.role === "doomed" ? 1.25 : a.who.k > 1.6 ? 1.45 : a.who.k > 1.3 ? 1.65 : 1.85, acc = 4.5;
    a.v = Math.min(vmax, a.v + acc * dt, Math.sqrt(2 * acc * rem) + 0.25);
    let step = a.v * dt;
    while (step > 0 && a.leg < r.length) {
      const [tx, ty] = r[a.leg]!, dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
      if (d > 0.02) a.dir = facing(dx, dy);
      if (d <= step) { a.x = tx; a.y = ty; step -= d; a.dist += d; a.leg++; }
      else { a.x += (dx / d) * step; a.y += (dy / d) * step; a.dist += step; step = 0; }
    }
    a.z = a.seat !== null && a.leg >= r.length ? SEATS[a.seat]!.z : floorZ(a.x, a.y);
    if (a.leg < r.length) return;
    a.v = 0;
    if (a.seat !== null) {
      // sat down: a spell of work (a pod: aboard, then away)
      this.reserved.delete(a.seat); this.seated.set(a.seat, a); a.mode = "sit"; a.dir = 0;
      if (a.role === "mission") { a.until = now + 2900; a.t0 = now + 1100; this.pods.set(a.seat, { t0: now + 1100, out: true }); a.mode = "launch"; if (snap) this.say(a, a.title ? `Off on ${a.title}` : "Launching", now, 2200, true); return; }
      a.until = now + (a.role === "captain" ? rnd(14000, 30000) : a.home === a.seat ? rnd(6000, 14000) : rnd(5000, 12000));
      return;
    }
    if (a.role === "doomed") {
      // into the fire
      a.mode = "vanish"; a.until = now + 900; this.onFlare?.();
      return;
    }
    a.mode = "stand"; a.dir = a.spot?.face ?? a.dir;
    const k = a.spot?.kind;
    a.until = now + (k === "wander" ? rnd(1200, 3500) : k === "patrol" ? rnd(1500, 3500) : rnd(3500, 7500));
    if (!snap) return;
    // someone already here: a word
    const other = this.agents.find((o) => o !== a && o.mode === "stand" && !o.partner && o.role !== "doomed" && Math.hypot(o.x - a.x, o.y - a.y) < 1.8);
    if (other && Math.random() < 0.6) { this.chat(a, other, now, snap); return; }
    if (Math.random() < 0.55) { const line = this.solo(a, snap); if (line) this.say(a, line, now + 250, 2900); }
    if (a.role === "office" && k === "market") a.carry = false;
  }

  private appear(a: Agent, now: number) {
    const mouth = this.spots.furnace[0]?.at ?? [FURNACE.x + 2.9, FURNACE.y + 0.3];
    a.x = mouth[0]; a.y = mouth[1]; a.z = 0; a.dir = 0; a.mode = "appear"; a.until = now + 1400; a.tag = null;
    this.onFlare?.();
    this.say(a, a.n === 0 ? "The Captain, fresh from the forge" : `Night Watcher #${a.n}, fresh from the forge`, now + 300, 3800, true);
  }

  // ------------------------------------------------------------------ places and seats
  private freeSeat(a: Agent, ok: (s: Seat) => boolean): number | null {
    const list = SEATS.filter((s) => ok(s) && this.usable.has(s.i) && !this.seated.has(s.i) && !this.reserved.has(s.i));
    if (!list.length) return null;
    // a seat not far off, mostly
    let best: Seat | null = null, bd = Infinity;
    for (let k = 0; k < 6; k++) { const s = pick(list), d = Math.hypot(s.x - a.x, s.y - a.y) + Math.random() * 8; if (d < bd) { bd = d; best = s; } }
    return best!.i;
  }
  private freeSpot(kind: Kind, a: Agent): Spot | null {
    const taken = this.agents.filter((o) => o !== a && o.spot?.kind === kind).map((o) => o.spot!.at);
    const list = this.spots[kind].filter((p) => !taken.some((t) => Math.hypot(t[0] - p.at[0], t[1] - p.at[1]) < 0.7));
    if (!list.length) return null;
    // jitter a little round the place, so a crowd is a crowd and not a stack
    const p = pick(list), j: Pt = [p.at[0] + rnd(-0.25, 0.25), p.at[1] + rnd(-0.25, 0.25)];
    return { ...p, at: this.nav.free(j[0], j[1]) ? j : p.at };
  }
  /** A neighbour standing nearby: walk up beside it for a word. */
  private meet(a: Agent, now: number): Spot | null {
    const b = this.agents.find((o) => o !== a && o.mode === "stand" && !o.partner && o.room === a.room && o.role !== "doomed" && Math.hypot(o.x - a.x, o.y - a.y) < 9 && o.until > now + 4000);
    if (!b) return null;
    for (const [dx, dy] of [[0.7, -0.7], [-0.7, 0.7], [0.8, 0], [0, 0.8], [-0.8, 0], [0, -0.8]] as const) {
      const x = b.x + dx * 0.9, y = b.y + dy * 0.9;
      if (this.nav.free(x, y) && this.nav.reach(x, y)) { b.until = Math.max(b.until, now + 9000); return { at: [x, y], face: facing(b.x - x, b.y - y), kind: "wander" }; }
    }
    return null;
  }
  private release(a: Agent) {
    if (a.seat !== null) { if (this.seated.get(a.seat) === a) this.seated.delete(a.seat); if (this.reserved.get(a.seat) === a) this.reserved.delete(a.seat); }
    for (const [s, b] of this.reserved) if (b === a) this.reserved.delete(s);
    if (a.mode === "sit" && a.seat !== null) { const s = SEATS[a.seat]!, e = this.exits.get(a.seat); if (e) { a.x = e[0]; a.y = e[1]; } else { a.x = s.x; a.y = s.y; } a.z = floorZ(a.x, a.y); }
    if (a.mode === "walk") { a.route = []; a.leg = 0; }
    a.seat = null; a.mode = a.mode === "gone" ? "gone" : "stand"; a.spot = null; a.next = null;
    if (a.partner) { a.partner.partner = null; a.partner = null; }
  }
  private releaseSpot(a: Agent) { a.spot = null; }

  // ------------------------------------------------------------------ talk
  private chat(a: Agent, b: Agent, now: number, snap: Snapshot) {
    a.partner = b; b.partner = a;
    const ax = a.x - a.y, bx = b.x - b.y, left = ax < bx || (ax === bx && a.x + a.y < b.x + b.y);
    a.dir = left ? 2 : 1; b.dir = left ? 1 : 2;
    const [q, ans] = this.talk(roomAt(a.x, a.y), snap);
    if (q) { this.say(a, q, now + 150, 2600); this.say(b, ans, now + 1500, 3300); }
    a.until = Math.max(a.until, now + 5200); b.until = Math.max(b.until, now + 5200);
  }
  say(a: Agent, text: string, from: number, ms: number, force = false) {
    if (!force && this.bubbles.some((b) => b.a === a && b.until > from)) return;
    if (force) this.bubbles = this.bubbles.filter((b) => b.a !== a);
    this.bubbles.push({ a, text, from, until: from + ms, tone: TONE[roomAt(a.x, a.y)] });
    a.gesture = from + Math.min(ms, 1500);
  }
  /** What the radar is showing that needs the Night Watch, from the loans' real states (null: nothing to do). */
  alertLine(s: Snapshot): string | null {
    const r = s.radar;
    if (!r) return null;
    const by = (st: string) => r.loans.filter((l) => l.state === st).length;
    const act = by("actionable"), un = by("unmarked"), exp = by("expired"), gr = by("grace");
    const online = s.watchers.some((w) => w.watch.online) || s.captain.watch.online;
    if (act) return online ? `Liquidating: ${act} loan${act === 1 ? "" : "s"} open to it` : `${act} loan${act === 1 ? "" : "s"} open to liquidate`;
    if (un) return online ? `Loan under ${r.mat}%: marking` : `Loan under ${r.mat}%: no bot on watch`;
    if (exp) return `Mark expired: marking again`;
    if (gr) return `Marked: ${gr} in the ${h1(r.lullHours)} h grace`;
    return null;
  }
  private talk(room: RoomKey, s: Snapshot): [string, string] {
    const t = s.totals, r = s.radar, g = this.outside.games, co = this.outside.companies;
    const P: Record<RoomKey, [string, string][]> = {
      bridge: [r ? ["Radar check?", `${r.loans.length} loans, peg ${r.peg ? r.peg.toFixed(3) : "n/a"}`] : ["Radar check?", "No read yet."], r ? ["What's owed?", `${n0(r.totalDebt)} imdUSD`] : ["Quiet night?", "So far."], ["Watch seats?", `${s.watchers.filter((w) => w.n !== 0 && w.tier < 5).length} of 46 taken`]],
      quarters: [["Holders?", `${n0(t.holders)} wallets`], ["Any Watchers?", `${t.watchers} forged`]],
      offices: [co ? ["How many companies?", `${co.count} running`] : ["Busy?", `${n0(t.held)} frogs aboard`], ["Ship-wide?", `${h1(t.perHour)} h/h`]],
      breakroom: [g ? ["Anyone playing?", `${g.total} game${g.total === 1 ? "" : "s"} live now`] : ["Coffee?", "Always. Night shift."], ["Earning?", `${h1(t.perHour)} h/h, all of us`]],
      missions: [["Who's out?", `${t.onMissions} on missions`], ["This week?", pick(this.st.missions)?.title ?? "Missions."]],
      engine: [["How's the shift?", `${h1(t.perHour)} h/h, all crew`], ["Next credit?", `${Math.max(0, 60 - Math.floor((Date.now() - s.stakingAt) / 60000))} min`]],
      forge: [["How many forged?", `${t.burned} frogs, ${t.watchers} Watchers`], ["Next one?", "10 frogs in, 1 out."]],
      drive: [["Engines?", "All three lit."]],
    };
    const fresh = P[room].filter(([q, ans]) => !this.bubbles.some((b) => b.text === q || b.text === ans));
    return fresh.length ? pick(fresh) : ["", ""];
  }
  private solo(a: Agent, s: Snapshot): string | null {
    const t = s.totals, g = this.outside.games, co = this.outside.companies;
    switch (a.spot?.kind) {
      case "coffee": return pick(["Refill.", "Black, no sugar.", "Coffee first."]);
      case "reactor": return pick([`${h1(t.perHour)} h/h, all crew`, "Reactor's steady."]);
      case "radar": return this.alertLine(s) ?? (s.radar ? `Watching ${s.radar.loans.length} loans` : "Radar's quiet.");
      case "patrol": return a.status === "online" ? "On watch." : a.status === "offline" ? "My bot is offline." : null;
      case "forge": return pick([`${t.burned} frogs forged so far`, "Stoking the fire."]);
      case "pool": return g && g.pool ? `${g.pool} pool game${g.pool === 1 ? "" : "s"} live` : g ? `${g.total} games live now` : pick(["Your shot.", "Rack 'em."]);
      case "arcade": return g && g.pinball ? `${g.pinball} pinball live` : g ? `${g.total} games live now` : "High score!";
      case "market": { const w = co?.working.length ? pick(co.working) : null; return w ? `${w.name}: ${w.title}`.slice(0, 34) : co ? `${co.count} companies running` : "Shipped."; }
      case "pods": return `${t.onMissions} out on missions`;
      case "bosses": return `${s.watchers.filter((x) => x.tier === 5).length} of 4 Night Bosses`;
      case "view": return pick(["Stars are out.", "Nice view."]);
      case "holo": return s.radar?.peg ? `Peg ${s.radar.peg.toFixed(4)}` : null;
      default: return a.mode === "sit" ? `I earn ${h2(a.rate)} h/h` : null;
    }
  }

  /** What a crew member is doing, in a few words (the hover and the card). */
  activity(a: Agent, s: Snapshot | null): string {
    const rate = `${h2(a.rate)} h/h`, k = a.spot?.kind;
    switch (a.role) {
      case "doomed": return `Walking into the forge: ${a.tag ?? "a Night Watcher"}`;
      case "mission": return `On a mission: ${a.title ?? "out"}`;
      case "watch": case "captain": {
        if (a.tag === "fresh" || a.mode === "appear") return "Fresh from the forge";
        if (a.status === null) return `The Zero-Sleep Captain · ${rate}`;
        if (a.status === "online") return `Night Watch · watching ${s?.radar ? `${s.radar.loans.length} loans` : "the radar (no read yet)"}`;
        return a.status === "offline" ? "Night Watch · its bot is offline" : "Night Watch · seat not paired yet";
      }
      case "shift": return a.mode === "sit" ? `On shift at a station · ${rate}` : k === "reactor" ? `Checking the reactor · ${rate}` : `On shift · ${rate}`;
      case "bridge": return a.mode === "sit" ? `At a bridge console · ${rate}` : `Bridge crew · ${rate}`;
      case "control": return a.mode === "sit" ? `At mission control · ${rate}` : `Mission control · ${rate}`;
      case "office": return a.carry ? "Carrying work to the market" : `Company work · ${rate}`;
      case "break": return k === "pool" ? "Playing pool" : k === "arcade" ? "At the arcade" : `On a break · ${rate}`;
      case "officer": return `Wardroom officer · ${rate}`;
      case "forge": return a.mode === "sit" ? `At an anvil · ${rate}` : `Tending the forge · ${rate}`;
      default: return rate;
    }
  }
}
export type { SeatKind };
