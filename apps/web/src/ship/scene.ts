import { Cast, type Drawn, U, type Who } from "./cast";
import { BACK, FRONT, type Piece as FPiece, SPILL, coffee, driveCoil, furnace, holoPedestal, radarTable, reactor } from "./furniture";
import { type Key, P_IDLE, P_SIT, P_TALK, P_WALK } from "./frogs";
import { type Rect, fxLight, fxSolid, sparkle, watcherBack, watcherFront } from "./fx";
import { type Ctx, P, RX, RY, alpha, disc, glow, rad } from "./iso";
import { Life, type Mover, type Walker } from "./life";
import { Nav } from "./nav";
import { STATIC, WORLD_BOX } from "./paint";
import { Space } from "./space";
import type { Pick, ShipStatic, Snapshot, Station } from "./types";
import { CHART, COFFEE, CREW_SEATS, DRIVE, FURNACE, L, PEG, PLINTHS, PODS, RADAR, REACTOR, ROOMS, type RoomKey, SEATS, type Seat, THRONE, WALL, WATCH } from "./world";

/**
 * THE SHIP, drawn: the whole ship in one isometric Canvas 2D scene with a camera (inertial drag, eased wheel and
 * slider zoom, pinch, held keys, fly-to, follow). The hull, floors and walls are painted once into 256 px tiles
 * per zoom level and reused; the furniture is cached as sprites per level; far out, the seated crew is baked into
 * tiles too and only what moves is drawn live. Every frame draws what is on screen, back to front: space, the
 * tiles, the seats and their characters, the crew walking about, the machines' light, the trait effects, then
 * labels and speech in screen pixels. The quality steps down by itself on a slow device.
 */
const LEVELS = [0.125, 0.177, 0.25, 0.354, 0.5, 0.707, 1, 1.414, 2, 2.83, 4];
const TS = 256;
export const MAX_ZOOM = 3;
const ORDER: Station[] = ["bridge", "quarters", "offices", "breakroom", "missions", "engine", "forge"];

type Occ = { key: Key; kind: "frog" | "watcher"; id: number; who: Who; color: string; ph: number; tier: number };
type Ent = { depth: number; seat?: Seat; prop?: { draw: (c: Ctx) => void; box: [number, number, number, number]; key: string; x: number; y: number; z: number }; box: [number, number, number, number] };
type Job = { d: Drawn; o: Occ; spill: string | null; body: Rect };
export type SceneStats = { fps: number; frameMs: number; drawn: number; tiles: number; walkers: number; quality: number; zoom: number; baked?: boolean };
export type Labels = Partial<Record<RoomKey, { title: string; line: string }>>;

/** Seats always drawn live (their glows and rings move): the Night Watch, the Captain's chair, the Night Boss plinths. */
const LIVE = new Set<Seat["kind"]>(["watch", "throne", "plinth"]);
const SEAT_LIFT: Partial<Record<Seat["kind"], number>> = { throne: 0.22, plinth: 0.42, pod: 0.2, watch: 0.05, officer: 0.04, console: -0.12, control: -0.12, station: -0.12, desk: -0.12, bar: -0.1, table: -0.1, anvil: -0.12 };
/** Seats a character stands in rather than sits. */
const STAND = new Set<Seat["kind"]>(["plinth", "pod"]);
const ACCENT: Record<number, string> = { 1: "#7C5CFF", 2: "#C4B4FF", 4: "#B8FF4A", 5: "#FFC46B" };
const FONT_UI = "'Space Grotesk', Inter, system-ui, sans-serif", FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

export class ShipScene {
  readonly cast: Cast;
  private c: CanvasRenderingContext2D;
  private space = new Space();
  private tiles = new Map<string, { c: HTMLCanvasElement | null; used: number }>();
  private ents: Ent[] = [];
  private nav = new Nav(SEATS);
  private life: Life;
  private occ = new Map<number, Occ>();
  private movers = new Map<number, Mover>();
  private empty = new Map<number, string>();
  private keyToSeat = new Map<string, number>();
  private drawnAt = new Map<string, Drawn>();
  private memorial: HTMLCanvasElement | null = null;
  private memorialKey = "";
  private raf = 0;
  private w = 1; private h = 1; private dpr = 1;
  cam = { x: 0, y: 0, z: 0.4 };
  private fly: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; t0: number; dur: number } | null = null;
  private zoomGoal: { z: number; sx: number; sy: number } | null = null;
  private vel = { x: 0, y: 0 };
  private held = new Set<string>();
  private keyVel = { x: 0, y: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; t: number; moved: number; pinch?: { d: number; z: number; mx: number; my: number } } | null = null;
  private samples: { x: number; y: number; t: number }[] = [];
  private lastTap = { t: 0, x: 0, y: 0 };
  private hover: Pick | null = null;
  private lastPick = 0;
  private flare = 0;
  private quality = 2;
  private frames: number[] = [];
  private work: number[] = [];
  private last = 0;
  private stats: SceneStats = { fps: 0, frameMs: 0, drawn: 0, tiles: 0, walkers: 0, quality: 2, zoom: 0 };
  private dirty = true;
  private away = new Set<number>();
  private podOverflow = 0;
  private jobs: Job[] = [];
  private F: Record<string, unknown> = {};
  snap: Snapshot | null = null;
  labels: Labels = {};
  crew = new Set<string>();
  selected: string | null = null;
  private followKey: string | null = null;
  private matchFn: ((key: string) => boolean) | null = null;
  get match() { return this.matchFn; }
  set match(f: ((key: string) => boolean) | null) { this.matchFn = f; this.rebake(); }
  onPick?: (p: Pick | null) => void;
  onHover?: (p: Pick | null, x: number, y: number) => void;
  onRoom?: (i: { room: Station; shown: number; total: number }) => void;
  onFollow?: (key: string | null) => void;
  private room: Station | null = null;

  constructor(private canvas: HTMLCanvasElement, private st: ShipStatic, private still: boolean) {
    this.c = canvas.getContext("2d", { alpha: false })!;
    this.cast = new Cast(st);
    this.life = new Life(this.nav, SEATS, st);
    let lastRebake = 0;
    this.cast.faces.onReady = () => {
      this.dirty = true;
      const now = performance.now();
      if (this.cast.faces.pending === 0 || now - lastRebake > 1500) { lastRebake = now; this.staleAll(); }
    };
    this.build();
    this.assign();
    this.resize();
    this.fit(false);
    if (this.w < 700) { const [a, b, c2, d] = WORLD_BOX; this.goTo((a + c2) / 2 + 120, (b + d) / 2 - 60, 0.24, false); }
    this.bind();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() { cancelAnimationFrame(this.raf); this.unbind(); }

  // ------------------------------------------------------------------ the cast
  private build() {
    for (const s of SEATS) {
      const [x, y] = P(s.x, s.y, s.z);
      this.ents.push({ depth: s.x + s.y + 0.01, seat: s, box: [x - 70, y - 170, x + 70, y + 40] });
    }
    const prop = (key: string, x: number, y: number, z: number, depth: number, box: [number, number, number, number], draw: (c: Ctx) => void) => {
      const [px, py] = P(x, y, z);
      this.ents.push({ depth, prop: { key, draw, box, x, y, z }, box: [box[0] + px, box[1] + py, box[2] + px, box[3] + py] });
    };
    prop("radar", RADAR.x, RADAR.y, 0.5, RADAR.x + RADAR.y, [-140, -60, 140, 80], (c) => radarTable(c, 0, 0, 0, RADAR.r));
    prop("reactor", REACTOR.x, REACTOR.y, 0, REACTOR.x + REACTOR.y, [-160, -210, 160, 100], (c) => reactor(c, 0, 0, REACTOR.r));
    prop("furnace", FURNACE.x, FURNACE.y, 0, FURNACE.x + FURNACE.y + 1, [-140, -220, 170, 130], (c) => furnace(c, 0, 0));
    for (const [i, [x, y]] of DRIVE.entries()) prop(`drive${i}`, x, y, 0, x + y, [-90, -170, 90, 60], (c) => driveCoil(c, 0, 0));
    prop("coffee", COFFEE.x, COFFEE.y, 0, COFFEE.x + COFFEE.y + 1, [-50, -70, 50, 30], (c) => coffee(c, 0, 0));
    prop("peg", PEG.x, PEG.y, 0.5, PEG.x + PEG.y, [-40, -30, 40, 24], (c) => holoPedestal(c, "rgba(74,216,255,.9)"));
    prop("chart", CHART.x, CHART.y, 0.5, CHART.x + CHART.y, [-40, -30, 40, 24], (c) => holoPedestal(c, "rgba(164,139,255,.9)"));
    this.ents.sort((a, b) => a.depth - b.depth);
  }

  /** Who sits where: each station's frogs by number in its seats, the Night Watch in its arcs, the Night Bosses on the plinths, the frogs out on missions in the pods. */
  assign() {
    this.occ.clear(); this.empty.clear(); this.keyToSeat.clear(); this.movers.clear();
    const st = this.st, snap = this.snap;
    const byStation: Record<Station, number[]> = { bridge: [], quarters: [], offices: [], breakroom: [], missions: [], engine: [], forge: [] };
    st.frogs.forEach((row, i) => { const id = i + 1; if (id !== 1) byStation[st.rules[row[10]!]!.station].push(id); });
    const frog = (id: number): Occ => {
      const traits = st.frogs[id - 1]!.slice(3, 10);
      return { key: id, kind: "frog", id, who: { key: id, k: 1, tier: 0, tc: ACCENT[traits[0]!] ?? "#3FE6FF", traits }, color: "", ph: (id * 0.6180339) % 1, tier: 0 };
    };
    const away = new Map<number, string>();
    const pods: number[] = [];
    if (snap) for (const f of snap.frogs) {
      if (f.dead) away.set(f.id, f.into === null ? "forged" : f.into === 0 ? "forged into The Captain" : `forged into Night Watcher #${f.into}`);
      else if (f.mission && !f.mission.done) { away.set(f.id, `on a mission: ${f.mission.title}`); pods.push(f.id); }
    }
    const put = (seat: Seat, o: Occ | null, why?: string, walks = false) => {
      if (o) {
        this.occ.set(seat.i, o); this.keyToSeat.set(String(o.key), seat.i);
        this.movers.set(seat.i, { key: String(o.key), k: o.who.k, tier: o.tier, walks });
      } else if (why) this.empty.set(seat.i, why);
    };
    for (const k of Object.keys(byStation) as Station[]) {
      byStation[k].forEach((id, j) => { const seat = CREW_SEATS[k][j]; if (seat) put(seat, away.has(id) ? null : frog(id), away.get(id), true); });
    }
    const watcher = (w: { n: number; traits: number[]; color: string; tier: number }): Occ => {
      this.cast.faces.setWatcher(w.n, w.traits, w.color);
      const cap = w.n === 0;
      return { key: `w${w.n}`, kind: "watcher", id: w.n, who: { key: `w${w.n}`, k: cap ? 1.75 : 1.5, tier: cap ? 6 : w.tier, tc: w.color, traits: w.traits }, color: w.color, ph: cap ? 0.3 : (w.n * 0.37) % 1, tier: cap ? 6 : w.tier };
    };
    // the Captain's chair: #1, or The Captain once #1 is forged
    const captain = snap?.watchers.find((w) => w.n === 0);
    if (captain) put(THRONE, watcher(captain));
    else put(THRONE, away.has(1) ? null : frog(1), away.get(1));
    let ring = 0, boss = 0;
    for (const w of snap?.watchers ?? []) {
      if (w.n === 0) continue;
      const seat = w.tier === 5 ? PLINTHS[boss++] : WATCH[ring++];
      if (seat) put(seat, watcher(w), undefined, true);
    }
    pods.sort((a, b) => (snap!.frogs[a - 1]!.mission!.since - snap!.frogs[b - 1]!.mission!.since));
    pods.forEach((id, k) => { const seat = PODS[k]; if (seat) put(seat, frog(id)); });
    this.podOverflow = Math.max(0, pods.length - PODS.length);
    this.memorialKey = "";
    this.rebake();
    this.dirty = true;
    this.room = null;
  }

  setSnapshot(s: Snapshot) {
    const before = this.snap?.watchers.length ?? null;
    this.snap = s;
    if (before !== null && s.watchers.length > before) this.flare = performance.now();
    this.assign();
  }
  /** Where a character sits. */
  seatOf(key: string): Seat | null { const i = this.keyToSeat.get(key); return i === undefined ? null : SEATS[i] ?? null; }
  /** Where a character is now, in world px (feet): walking, or at its seat. */
  private where(key: string): [number, number] | null {
    const w = this.life.byKey(key);
    if (w) return P(w.x, w.y, w.z);
    const s = this.seatOf(key);
    return s ? P(s.x, s.y, s.z + (SEAT_LIFT[s.kind] ?? 0)) : null;
  }
  get pending() { return this.cast.faces.pending; }

  // ------------------------------------------------------------------ the camera
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality >= 2 ? 2 : 1.5);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.dirty = true;
  }
  private fitZoom() { const [a, b, c, d] = WORLD_BOX, f = this.free(); return Math.min(f.w / (c - a), f.h / (d - b)) * 0.96; }
  minZoom() { return Math.min(0.2, this.fitZoom() * 0.85); }
  get maxZoom() { return MAX_ZOOM; }
  private clampZ(z: number) { return Math.max(this.minZoom(), Math.min(MAX_ZOOM, z)); }
  /** The whole ship in view. */
  fit(animate = true) {
    const [a, b, c, d] = WORLD_BOX;
    this.stopFollow();
    this.goTo((a + c) / 2, (b + d) / 2, this.fitZoom(), animate, true);
  }
  /** Screen space the page covers (open panels, sheets), in CSS px: framing keeps targets in the rest. */
  inset = { l: 0, r: 0, t: 0, b: 0 };
  private free() { const i = this.inset; return { w: Math.max(120, this.w - i.l - i.r), h: Math.max(120, this.h - i.t - i.b), cx: (i.l + this.w - i.r) / 2, cy: (i.t + this.h - i.b) / 2 }; }
  goTo(x: number, y: number, z: number, animate = true, framed = false) {
    const zz = this.clampZ(z);
    // framed: (x, y) lands in the middle of the free part of the screen, not the middle of the screen
    const f = this.free(), to = framed ? { x: x - (f.cx - this.w / 2) / zz, y: y - (f.cy - this.h / 2) / zz, z: zz } : { x, y, z: zz };
    this.zoomGoal = null; this.vel = { x: 0, y: 0 };
    if (!animate || this.still) { this.cam = to; this.fly = null; this.dirty = true; return; }
    const d = Math.hypot(to.x - this.cam.x, to.y - this.cam.y) * Math.min(this.cam.z, zz), dz = Math.abs(Math.log(zz / this.cam.z));
    this.fly = { from: { ...this.cam }, to, t0: performance.now(), dur: Math.max(520, Math.min(1300, 420 + d * 0.5 + dz * 260)) };
  }
  /** Flies to a character and frames it in the free part of the screen. */
  focusKey(key: string, z = 1.7) {
    const p = this.where(key);
    if (!p) return false;
    const f = this.free(), k = key.startsWith("w") ? 1.5 : 1;
    this.goTo(p[0], p[1] - 30 * k, Math.min(z, f.h / (140 * k), f.w / 110), true, true);
    return true;
  }
  focusRoom(k: RoomKey) {
    this.stopFollow();
    const r = ROOMS.find((q) => q.key === k)!;
    const corners = [P(r.x0, r.y0, 0), P(r.x1, r.y0, 0), P(r.x1, r.y1, 0), P(r.x0, r.y1, 0), P(r.x0, r.y0, WALL)];
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]), f = this.free();
    const z = Math.min(f.w / (Math.max(...xs) - Math.min(...xs) + 80), f.h / (Math.max(...ys) - Math.min(...ys) + 120));
    this.goTo((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, Math.min(2.2, z), true, true);
  }
  /** Frames a set of characters (a wallet's crew). */
  focusKeys(keys: string[]) {
    const pts = keys.map((k) => this.where(k)).filter((p): p is [number, number] => Boolean(p)).map(([x, y]) => [x, y - 30] as [number, number]);
    if (!pts.length) return;
    if (pts.length === 1) { this.focusKey(keys.find((k) => this.where(k))!); return; }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), f = this.free();
    const z = Math.min(f.w / (Math.max(...xs) - Math.min(...xs) + 240), f.h / (Math.max(...ys) - Math.min(...ys) + 260), 1.7);
    this.goTo((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, z, true, true);
  }
  /** Zooms by a factor round a screen point, eased (the buttons, the keys, the wheel). */
  zoomBy(f: number, sx = this.free().cx, sy = this.free().cy) {
    const base = this.zoomGoal?.z ?? this.fly?.to.z ?? this.cam.z;
    this.fly = null;
    this.zoomGoal = { z: this.clampZ(base * f), sx, sy };
  }
  /** Zooms to a level round the middle of the free screen, eased (the slider). */
  zoomTo(z: number) { this.fly = null; const f = this.free(); this.zoomGoal = { z: this.clampZ(z), sx: f.cx, sy: f.cy }; }
  /** Zooms now (pinch), keeping the point under (sx, sy) where it is. */
  private zoomAt(f: number, sx: number, sy: number) {
    const z0 = this.cam.z, z1 = this.clampZ(z0 * f);
    const wx = this.cam.x + (sx - this.w / 2) / z0, wy = this.cam.y + (sy - this.h / 2) / z0;
    this.cam = { x: wx - (sx - this.w / 2) / z1, y: wy - (sy - this.h / 2) / z1, z: z1 };
    this.fly = null; this.zoomGoal = null; this.clamp(); this.dirty = true;
  }
  private clamp() {
    // room to frame the ends of the ship beside a panel or above a sheet
    const i = this.inset, [a, b, c, d] = WORLD_BOX, m = 120 + Math.max(i.l, i.r, i.t, i.b) / Math.max(0.05, this.cam.z);
    this.cam.x = Math.max(a - m, Math.min(c + m, this.cam.x));
    this.cam.y = Math.max(b - m, Math.min(d + m, this.cam.y));
  }
  toWorld(sx: number, sy: number): [number, number] { return [this.cam.x + (sx - this.w / 2) / this.cam.z, this.cam.y + (sy - this.h / 2) / this.cam.z]; }
  toScreen(wx: number, wy: number): [number, number] { return [(wx - this.cam.x) * this.cam.z + this.w / 2, (wy - this.cam.y) * this.cam.z + this.h / 2]; }
  /** A world px point on the deck (z = 0) as a floor point. */
  private floorAt(wx: number, wy: number): [number, number] { return [(wx / 32 + wy / 16) / 2, (wy / 16 - wx / 32) / 2]; }
  /** The screen's corners on the deck plane (floor units), for the ship map's view frame. */
  viewQuad(): [number, number][] { return ([[0, 0], [this.w, 0], [this.w, this.h], [0, this.h]] as const).map(([x, y]) => this.floorAt(...this.toWorld(x, y))); }
  /** Centres the free screen on a floor point (the ship map), keeping the zoom. */
  lookAt(fx: number, fy: number, animate = true) {
    this.stopFollow();
    const [x, y] = P(fx, fy, 0);
    if (animate) this.goTo(x, y, this.zoomGoal?.z ?? this.cam.z, true, true);
    else { const f = this.free(), z = this.cam.z; this.cam = { x: x - (f.cx - this.w / 2) / z, y: y - (f.cy - this.h / 2) / z, z }; this.fly = null; this.zoomGoal = null; this.vel = { x: 0, y: 0 }; this.clamp(); this.dirty = true; }
  }

  // ------------------------------------------------------------------ following one character
  get following() { return this.followKey; }
  /** Keeps the camera on a character while it walks about (null stops). It gets up and walks soon. */
  follow(key: string | null) {
    if (key === this.followKey) return;
    this.followKey = key;
    if (key) {
      this.life.wake(key, performance.now());
      const p = this.where(key), f = this.free();
      if (p) this.goTo(p[0], p[1] - 34, Math.max(this.cam.z, Math.min(1.6, f.h / 150)), true, true);
    }
    this.onFollow?.(key);
  }
  private stopFollow() { if (this.followKey) { this.followKey = null; this.onFollow?.(null); } }

  // ------------------------------------------------------------------ input
  private handlers: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];
  private bind() {
    const on = <K extends keyof HTMLElementEventMap>(k: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions, t: EventTarget = this.canvas) => { t.addEventListener(k, f as EventListener, o); this.handlers.push([t, k, f as EventListener, o]); };
    on("pointerdown", (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      this.fly = null; this.zoomGoal = null; this.vel = { x: 0, y: 0 }; this.samples = [{ x: e.offsetX, y: e.offsetY, t: performance.now() }];
      if (this.pointers.size === 2) {
        const [p, q] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        this.drag = { x: e.offsetX, y: e.offsetY, t: performance.now(), moved: 99, pinch: { d: Math.hypot(p.x - q.x, p.y - q.y), z: this.cam.z, mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 } };
      } else this.drag = { x: e.offsetX, y: e.offsetY, t: performance.now(), moved: 0 };
    });
    on("pointermove", (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (prev) this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      const d = this.drag;
      if (d && prev) {
        if (d.pinch && this.pointers.size >= 2) {
          const [p, q] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
          const dist = Math.hypot(p.x - q.x, p.y - q.y), mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
          const z = this.clampZ(d.pinch.z * (dist / Math.max(1, d.pinch.d)));
          this.zoomAt(z / this.cam.z, mx, my);
          this.cam.x -= (mx - d.pinch.mx) / this.cam.z; this.cam.y -= (my - d.pinch.my) / this.cam.z;
          d.pinch.mx = mx; d.pinch.my = my;
          this.stopFollow();
        } else if (!d.pinch) {
          const dx = e.offsetX - prev.x, dy = e.offsetY - prev.y;
          d.moved += Math.abs(dx) + Math.abs(dy);
          if (d.moved > 6) this.stopFollow();
          this.cam.x -= dx / this.cam.z; this.cam.y -= dy / this.cam.z;
          const now = performance.now();
          this.samples.push({ x: e.offsetX, y: e.offsetY, t: now });
          while (this.samples.length > 2 && now - this.samples[0]!.t > 90) this.samples.shift();
        }
        this.clamp(); this.dirty = true;
        return;
      }
      if (e.pointerType === "mouse") this.space.lean = { x: (e.offsetX / this.w) * 2 - 1, y: (e.offsetY / this.h) * 2 - 1 };
      if (e.pointerType === "mouse" && performance.now() - this.lastPick > 40) {
        this.lastPick = performance.now();
        const p = this.pick(e.offsetX, e.offsetY);
        if (JSON.stringify(p) !== JSON.stringify(this.hover)) { this.hover = p; this.canvas.style.cursor = p && p.kind !== "room" ? "pointer" : "grab"; this.dirty = true; }
        this.onHover?.(p && p.kind !== "room" ? p : null, e.clientX, e.clientY);
      }
    });
    const up = (e: PointerEvent) => {
      const d = this.drag, now = performance.now();
      this.pointers.delete(e.pointerId);
      if (d && !d.pinch && d.moved < 7 && now - d.t < 500) {
        const p = this.pick(e.offsetX, e.offsetY);
        // a second tap on the floor soon after the first: fly to that room
        const dbl = now - this.lastTap.t < 330 && Math.hypot(e.offsetX - this.lastTap.x, e.offsetY - this.lastTap.y) < 26;
        this.lastTap = { t: dbl ? 0 : now, x: e.offsetX, y: e.offsetY };
        if (dbl && (!p || p.kind === "room")) { const r = this.roomAtScreen(e.offsetX, e.offsetY); if (r) this.focusRoom(r); }
        else this.onPick?.(p && p.kind === "room" ? null : p);
      } else if (d && !d.pinch && this.pointers.size === 0 && this.samples.length >= 2) {
        // let go while moving: the ship glides on and slows
        const a = this.samples[0]!, b = this.samples[this.samples.length - 1]!, dt = Math.max(16, b.t - a.t);
        if (now - b.t < 80) this.vel = { x: -((b.x - a.x) / dt) * 1000 / this.cam.z, y: -((b.y - a.y) / dt) * 1000 / this.cam.z };
      }
      if (this.pointers.size === 0) this.drag = null;
      else if (this.pointers.size === 1) { const [p] = [...this.pointers.values()] as [{ x: number; y: number }]; this.drag = { x: p.x, y: p.y, t: now, moved: 99 }; this.samples = []; }
    };
    on("pointerup", up); on("pointercancel", up);
    on("pointerleave", () => { if (this.hover) { this.hover = null; this.onHover?.(null, 0, 0); this.dirty = true; } });
    on("wheel", (e) => {
      e.preventDefault();
      if (e.ctrlKey) { this.zoomAt(Math.exp(-e.deltaY * 0.012), e.offsetX, e.offsetY); return; }
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.zoomBy(Math.exp(-Math.max(-240, Math.min(240, dy)) * 0.0022), e.offsetX, e.offsetY);
    }, { passive: false });
    on("dblclick", (e) => { e.preventDefault(); });
    // keys anywhere on the page (not while typing): held arrows / WASD pan smoothly
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return Boolean(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))); };
    const PAN: Record<string, [number, number]> = { ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0], ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1] };
    on("keydown", (e) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (PAN[k]) { this.held.add(k); this.fly = null; this.stopFollow(); }
      else if (k === "+" || k === "=") this.zoomBy(1.5);
      else if (k === "-" || k === "_") this.zoomBy(1 / 1.5);
      else if (k === "0") this.fit();
      else if (/^[1-7]$/.test(k)) this.focusRoom(ORDER[Number(k) - 1]!);
      else if (k === "Escape") { if (this.followKey) this.stopFollow(); return; }
      else if ((k === "f" || k === "F") && this.selected) { this.follow(this.followKey === this.selected ? null : this.selected); }
      else return;
      e.preventDefault(); this.dirty = true;
    }, undefined, window);
    on("keyup", (e) => { this.held.delete(e.key); if (e.key.length === 1) { this.held.delete(e.key.toLowerCase()); this.held.delete(e.key.toUpperCase()); } }, undefined, window);
    on("blur", () => this.held.clear(), undefined, window);
    this.PAN = PAN;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.canvas);
    this.ro = ro;
  }
  private PAN: Record<string, [number, number]> = {};
  private ro: ResizeObserver | null = null;
  private unbind() { for (const [t, k, f, o] of this.handlers) t.removeEventListener(k, f, o); this.ro?.disconnect(); }

  private roomAtScreen(sx: number, sy: number): Station | null {
    const [fx, fy] = this.floorAt(...this.toWorld(sx, sy));
    const r = ROOMS.find((q) => fx >= q.x0 && fx < q.x1 && fy >= q.y0 && fy < q.y1);
    return r && r.key !== "drive" ? r.key : r?.key === "drive" ? "engine" : null;
  }
  /** What is under a screen point: a character, an empty seat, or a room. */
  pick(sx: number, sy: number): Pick | null {
    const [wx, wy] = this.toWorld(sx, sy);
    const inside = (d: Drawn) => wx >= d.x && wx <= d.x + d.w && wy >= d.y && wy <= d.y + d.h;
    const toPick = (o: Occ): Pick => (o.kind === "frog" ? { kind: "frog", id: o.id } : { kind: "watcher", n: o.id });
    // the walkers are in front
    for (let i = this.life.walkers.length - 1; i >= 0; i--) {
      const w = this.life.walkers[i]!, d = this.drawnAt.get(w.key), o = this.occ.get(w.seat);
      if (d && o && inside(d)) return toPick(o);
    }
    for (let i = this.ents.length - 1; i >= 0; i--) {
      const s = this.ents[i]!.seat;
      if (!s || this.away.has(s.i)) continue;
      const o = this.occ.get(s.i), d = o ? this.drawnAt.get(String(o.key)) ?? this.estimate(s, o) : this.estimate(s, null);
      if (!inside(d)) continue;
      if (o) return toPick(o);
      if (s.kind === "watch" || s.kind === "plinth" || s.kind === "throne" || this.empty.has(s.i)) return { kind: "seat", seat: s.i };
    }
    const r = this.roomAtScreen(sx, sy);
    return r ? { kind: "room", station: r } : null;
  }
  emptyWhy(seat: number) { return this.empty.get(seat) ?? null; }
  occupant(seat: number) { return this.occ.get(seat) ?? null; }
  get overflow() { return this.podOverflow; }

  /** Where a seat's character is drawn (before it has been): its feet at the seat, its size by its kind. */
  private estimate(s: Seat, o: Occ | null): Drawn {
    const k = o?.who.k ?? 1, [x, y] = P(s.x, s.y, s.z + (SEAT_LIFT[s.kind] ?? 0)), h = (STAND.has(s.kind) ? 36 : 31) * k * U;
    return { x: x - 11 * k * U, y: y - h, w: 22 * k * U, h, head: null, hand: null, face: true };
  }

  // ------------------------------------------------------------------ tiles
  private levelIndex() {
    const ds = this.cam.z * this.dpr * (this.quality >= 1 ? 1 : 0.75);
    let i = LEVELS.findIndex((s) => s >= ds * 0.97);
    if (i < 0) i = LEVELS.length - 1;
    return Math.min(i, this.quality >= 2 ? LEVELS.length - 1 : LEVELS.length - 3);
  }
  private renderTile(li: number, tx: number, ty: number): HTMLCanvasElement {
    const s = LEVELS[li]!, c = document.createElement("canvas");
    c.width = c.height = TS;
    const x = c.getContext("2d")!;
    const wx = (tx * TS) / s, wy = (ty * TS) / s, ww = TS / s;
    x.setTransform(s, 0, 0, s, -wx * s, -wy * s);
    for (const p of STATIC) if (p.box[2] >= wx && p.box[0] <= wx + ww && p.box[3] >= wy && p.box[1] <= wy + ww) p.draw(x);
    return c;
  }
  private drawTiles(c: CanvasRenderingContext2D, budgetEnd: number) {
    const li = this.levelIndex();
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.w, this.h);
    const [A, B, C, D] = WORLD_BOX;
    const now = performance.now();
    const layer = (i: number, render: boolean) => {
      const s = LEVELS[i]!, span = TS / s;
      const ax = Math.floor(Math.max(x0, A) / span), bx = Math.floor(Math.min(x1, C) / span);
      const ay = Math.floor(Math.max(y0, B) / span), by = Math.floor(Math.min(y1, D) / span);
      let missing = 0;
      for (let ty = ay; ty <= by; ty++) for (let tx = ax; tx <= bx; tx++) {
        const k = `${i}:${tx}:${ty}`;
        let t = this.tiles.get(k);
        if (!t?.c) {
          if (render && (performance.now() < budgetEnd || i === 0)) { t = { c: this.renderTile(i, tx, ty), used: now }; this.tiles.set(k, t); this.stats.tiles++; }
          else { missing++; continue; }
        }
        t.used = now;
        const [px, py] = this.toScreen(tx * span, ty * span), [qx, qy] = this.toScreen((tx + 1) * span, (ty + 1) * span);
        const d = this.dpr, rx = Math.round(px * d), ry = Math.round(py * d);
        c.drawImage(t.c!, rx, ry, Math.round(qx * d) - rx, Math.round(qy * d) - ry);
      }
      return missing;
    };
    // a coarser level underneath while this one fills in
    let fallback = li - 1;
    while (fallback > 0 && !this.covered(fallback, x0, y0, x1, y1)) fallback--;
    if (!this.covered(li, x0, y0, x1, y1)) { layer(Math.max(0, fallback), fallback <= 0); this.dirty = true; }
    if (layer(li, true)) this.dirty = true;
    // forget the tiles not seen for a while
    if (this.tiles.size > (this.quality >= 2 ? 260 : 160)) {
      const old = [...this.tiles.entries()].filter(([k]) => !k.startsWith("0:")).sort((a, b) => a[1].used - b[1].used).slice(0, 40);
      for (const [k] of old) this.tiles.delete(k);
    }
  }
  private covered(i: number, x0: number, y0: number, x1: number, y1: number) {
    const s = LEVELS[i]!, span = TS / s, [A, B, C, D] = WORLD_BOX;
    for (let ty = Math.floor(Math.max(y0, B) / span); ty <= Math.floor(Math.min(y1, D) / span); ty++) for (let tx = Math.floor(Math.max(x0, A) / span); tx <= Math.floor(Math.min(x1, C) / span); tx++) if (!this.tiles.get(`${i}:${tx}:${ty}`)?.c) return false;
    return true;
  }

  /** A piece of furniture as a sprite at the current level, packed with the others into one canvas per level. */
  private piece(name: string, p: FPiece, x: number, y: number, into: CanvasRenderingContext2D, li0?: number) {
    const li = Math.min(Math.max(2, li0 ?? this.levelIndex()), this.quality >= 2 ? 9 : 8), s = LEVELS[li]!;
    let A = this.packs.get(li);
    if (!A) {
      const cv = document.createElement("canvas"); cv.width = 2048; cv.height = 2048;
      A = { cv, g: cv.getContext("2d")!, at: new Map(), x: 0, y: 0, row: 0 };
      this.packs.set(li, A);
      if (this.packs.size > 3) this.packs.delete(this.packs.keys().next().value!);
    }
    let r = A.at.get(name);
    if (!r) {
      const [a, b, c2, d] = p.box, w = Math.ceil((c2 - a) * s) + 2, h = Math.ceil((d - b) * s) + 2;
      if (A.x + w > A.cv.width) { A.x = 0; A.y += A.row; A.row = 0; }
      if (A.y + h > A.cv.height) { A.at.clear(); A.g.clearRect(0, 0, A.cv.width, A.cv.height); A.x = 0; A.y = 0; A.row = 0; }
      r = [A.x + 1, A.y + 1, w - 2, h - 2];
      A.g.save(); A.g.beginPath(); A.g.rect(r[0], r[1], r[2], r[3]); A.g.clip();
      A.g.setTransform(s, 0, 0, s, r[0] - a * s, r[1] - b * s);
      p.draw(A.g);
      A.g.restore();
      A.at.set(name, r);
      A.x += w; A.row = Math.max(A.row, h);
    }
    if (!into.imageSmoothingEnabled) into.imageSmoothingEnabled = true;
    into.drawImage(A.cv, r[0], r[1], r[2], r[3], x + p.box[0], y + p.box[1], p.box[2] - p.box[0], p.box[3] - p.box[1]);
  }
  /** A set piece (reactor, furnace…) as its own sprite at the current level. */
  private propSprite(name: string, p: { box: [number, number, number, number]; draw: (c: Ctx) => void }, x: number, y: number) {
    const li = Math.min(Math.max(2, this.levelIndex()), this.quality >= 2 ? 9 : 8), s = LEVELS[li]!, k = `${name}@${li}`;
    let cv = this.propCache.get(k);
    if (!cv) {
      cv = document.createElement("canvas");
      const [a, b, c2, d] = p.box;
      cv.width = Math.max(1, Math.ceil((c2 - a) * s)); cv.height = Math.max(1, Math.ceil((d - b) * s));
      const g = cv.getContext("2d")!;
      g.setTransform(s, 0, 0, s, -a * s, -b * s);
      p.draw(g);
      this.propCache.set(k, cv);
      if (this.propCache.size > 40) this.propCache.delete(this.propCache.keys().next().value!);
    }
    if (!this.c.imageSmoothingEnabled) this.c.imageSmoothingEnabled = true;
    this.c.drawImage(cv, x + p.box[0], y + p.box[1], p.box[2] - p.box[0], p.box[3] - p.box[1]);
  }
  private propCache = new Map<string, HTMLCanvasElement>();
  private packs = new Map<number, { cv: HTMLCanvasElement; g: CanvasRenderingContext2D; at: Map<string, [number, number, number, number]>; x: number; y: number; row: number }>();

  // ------------------------------------------------------------------ the frame
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.cast.faces.pump(this.quality >= 2 ? 8 : 5);
    const moving = this.fly || this.zoomGoal || this.held.size || Math.abs(this.vel.x) + Math.abs(this.vel.y) > 1 || Math.abs(this.keyVel.x) + Math.abs(this.keyVel.y) > 1 || this.followKey;
    if (this.still && !moving && !this.dirty && this.cast.faces.pending === 0) return;
    const t0 = performance.now();
    this.step(now, dt);
    this.dirty = false;
    this.draw(now / 1000, t0 + 7, dt);
    const work = performance.now() - t0;
    this.frames.push(now); this.work.push(work);
    while (this.frames.length && now - this.frames[0]! > 1000) { this.frames.shift(); this.work.shift(); }
    this.stats.fps = this.frames.length; this.stats.frameMs = this.work.reduce((a, b) => a + b, 0) / Math.max(1, this.work.length);
    this.stats.quality = this.quality; this.stats.zoom = this.cam.z; this.stats.walkers = this.life.walkers.length;
    this.adapt(now);
    (window as unknown as { __ship?: SceneStats }).__ship = this.stats;
  };
  private slowSince = 0; private fastSince = 0;
  private adapt(now: number) {
    if (this.frames.length < 30) return;
    const ms = this.stats.frameMs;
    if (ms > 14 || this.stats.fps < 45) { this.fastSince = 0; if (!this.slowSince) this.slowSince = now; if (now - this.slowSince > 2500 && this.quality > 0) { this.quality--; this.slowSince = 0; this.resize(); } }
    else if (ms < 6 && this.stats.fps >= 55) { this.slowSince = 0; if (!this.fastSince) this.fastSince = now; if (now - this.fastSince > 8000 && this.quality < 2) { this.quality++; this.fastSince = 0; this.resize(); } }
    else { this.slowSince = 0; this.fastSince = 0; }
  }
  private step(now: number, dt: number) {
    if (this.fly) {
      const f = this.fly, k = Math.min(1, (now - f.t0) / f.dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const z = f.from.z * Math.pow(f.to.z / f.from.z, e);
      this.cam = { x: f.from.x + (f.to.x - f.from.x) * e, y: f.from.y + (f.to.y - f.from.y) * e, z };
      if (k >= 1) this.fly = null;
      this.dirty = true;
    } else if (this.zoomGoal) {
      // eased zoom: the point under the cursor stays put
      const g = this.zoomGoal, z0 = this.cam.z, f = Math.pow(g.z / z0, 1 - Math.exp(-dt * 11));
      this.zoomAt(f, g.sx, g.sy);
      this.zoomGoal = Math.abs(Math.log(g.z / this.cam.z)) < 0.002 ? null : g;
      if (!this.zoomGoal) this.zoomAt(g.z / this.cam.z, g.sx, g.sy);
    }
    if (!this.drag && Math.abs(this.vel.x) + Math.abs(this.vel.y) > 1) {
      this.cam.x += this.vel.x * dt; this.cam.y += this.vel.y * dt;
      const k = Math.exp(-dt * 4.2); this.vel.x *= k; this.vel.y *= k;
      this.clamp(); this.dirty = true;
    }
    // held keys: pan with a little acceleration and a soft stop
    let kx = 0, ky = 0;
    for (const k of this.held) { const v = this.PAN[k]; if (v) { kx += v[0]; ky += v[1]; } }
    const sp = 820 / this.cam.z, kk = 1 - Math.exp(-dt * 9);
    this.keyVel.x += (Math.sign(kx) * sp - this.keyVel.x) * kk; this.keyVel.y += (Math.sign(ky) * sp - this.keyVel.y) * kk;
    if (Math.abs(this.keyVel.x) + Math.abs(this.keyVel.y) > 1) { this.cam.x += this.keyVel.x * dt; this.cam.y += this.keyVel.y * dt; this.clamp(); this.dirty = true; }
    // following: the camera keeps the character in the middle of the free screen
    if (this.followKey && !this.fly && !this.drag) {
      const p = this.where(this.followKey);
      if (!p) this.stopFollow();
      else {
        const f = this.free(), z = this.cam.z, k = this.followKey.startsWith("w") ? 1.5 : 1;
        const tx = p[0] - (f.cx - this.w / 2) / z, ty = p[1] - 34 * k - (f.cy - this.h / 2) / z, e = 1 - Math.exp(-dt * 4.5);
        this.cam.x += (tx - this.cam.x) * e; this.cam.y += (ty - this.cam.y) * e;
        this.dirty = true;
      }
    }
    // the room in the middle of the free screen, for the page's room bar
    const f = this.free(), r = this.roomAtScreen(f.cx, f.cy) ?? this.room ?? "bridge";
    if (r !== this.room) { this.room = r; this.onRoom?.({ room: r, shown: 0, total: r === "missions" ? this.podOverflow : 0 }); }
  }

  private draw(t: number, budgetEnd: number, dt: number) {
    const c = this.c, d = this.dpr, z = this.cam.z;
    const tt = this.still ? 0 : t;
    const F = ((window as unknown as { __shipFlags?: Record<string, unknown> }).__shipFlags ?? {}) as Record<string, unknown>;
    this.F = F;
    c.setTransform(d, 0, 0, d, 0, 0);
    c.imageSmoothingEnabled = true;
    if (!F.noSpace) this.space.draw(c, this.w, this.h, d, this.cam.x, this.cam.y, z, tt, this.still);
    else { c.fillStyle = "#05060c"; c.fillRect(0, 0, this.w, this.h); }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingQuality = "low";
    if (!F.noTiles) this.drawTiles(c, budgetEnd);
    // the crew's life: who is up and walking
    const ms = performance.now();
    const onScreen = (i: number) => this.onScreen(SEATS[i]!);
    if (!this.still) this.life.step(ms, dt, this.snap, this.movers, onScreen, this.quality >= 2 ? 44 : this.quality === 1 ? 24 : 10, this.followKey);
    const away = new Set(this.life.walkers.map((w) => w.seat));
    for (const i of away) if (!this.away.has(i)) this.staleSeat(i);
    for (const i of this.away) if (!away.has(i)) this.staleSeat(i);
    this.away = away;
    // far out, the seated crew is painted into tiles too; what moves goes on top
    const baked = !F.noBake && z < 0.95 && this.drawCrewTiles(c, budgetEnd);
    this.stats.baked = baked;
    c.setTransform(d * z, 0, 0, d * z, d * (this.w / 2 - this.cam.x * z), d * (this.h / 2 - this.cam.y * z));
    const [x0, y0] = this.toWorld(-60, -80), [x1, y1] = this.toWorld(this.w + 60, this.h + 200);
    this.lightsUnder(c, tt);
    this.drawMemorial(c);
    this.drawBoard(c);
    this.drawPortrait(c);
    const px = U * z * d;
    const fxOn = this.quality >= 1 && px > 0.9, big = px > 2.2;
    let drawn = 0;
    this.jobs.length = 0;
    // the walkers, back to front, merged into the seats and props
    const walkers = this.life.walkers.filter((w) => { const [wx, wy] = P(w.x, w.y, w.z); return wx > x0 && wx < x1 && wy > y0 && wy < y1 + 100; }).sort((a, b) => a.x + a.y - (b.x + b.y));
    let wi = 0;
    for (const e of this.ents) {
      while (wi < walkers.length && walkers[wi]!.x + walkers[wi]!.y < e.depth) this.drawWalker(c, walkers[wi++]!, tt, ms, px, fxOn, big);
      if (e.box[2] < x0 || e.box[0] > x1 || e.box[3] < y0 || e.box[1] > y1) continue;
      drawn++;
      if (e.prop) { if (!baked) { const [ppx, ppy] = P(e.prop.x, e.prop.y, e.prop.z); this.propSprite(e.prop.key, e.prop, ppx, ppy); } if (!F.noFx) this.propFx(c, e.prop.key, tt); continue; }
      if (!F.noSeats) this.drawSeat(c, e.seat!, tt, px, fxOn && !F.noFx, big, baked && !LIVE.has(e.seat!.kind) ? "overlay" : "live");
    }
    while (wi < walkers.length) this.drawWalker(c, walkers[wi++]!, tt, ms, px, fxOn, big);
    this.stats.drawn = drawn;
    // the characters' light and trait effects, over the scene in one pass
    if (!F.noFx) this.drawJobs(c, tt, big);
    this.overFx(c, tt);
    c.setTransform(d, 0, 0, d, 0, 0);
    c.imageSmoothingEnabled = true;
    this.drawLabels(c, tt);
    if (!this.still) this.drawBubbles(c, ms);
    this.grade(c);
  }

  private drawJobs(c: CanvasRenderingContext2D, t: number, big: boolean) {
    const fine = this.quality >= 2 || big;
    for (const j of this.jobs) if (fine && j.d.head) fxSolid(c, j.d.head, j.o.who.traits, t, j.o.ph, big, j.d.hand, j.d.face);
    const prev = c.globalCompositeOperation;
    c.globalCompositeOperation = "lighter";
    for (const j of this.jobs) {
      if (j.spill) glow(c, j.body.x + j.body.w / 2, j.d.y + j.d.h * 0.5, j.body.w * 0.9, j.spill, 0.16, 0.6);
      if (fine && j.d.head) fxLight(c, j.d.head, j.o.who.traits, t, j.o.ph, big, j.d.hand, j.d.face);
    }
    c.globalCompositeOperation = prev;
    for (const j of this.jobs) if (j.o.kind === "watcher") watcherFront(c, j.body, j.o.tier, j.o.color, t, j.o.ph);
  }

  /** A character's body rect for its aura and orbit rings. */
  private bodyRect(x: number, y: number, k: number): Rect { const w = 30 * k * U, h = 38 * k * U; return { x: x - w / 2, y: y - h, w, h }; }

  /**
   * One seat: its back piece, its character, its front piece. "live" draws it all now; "bake" draws it still into
   * a crew tile; "overlay" adds only what moves (markers, effects) over its baked tile.
   */
  private drawSeat(c: CanvasRenderingContext2D, s: Seat, t: number, px: number, fxOn: boolean, big: boolean, mode: "live" | "bake" | "overlay" = "live", li?: number) {
    const [bx, by] = P(s.x, s.y, s.z);
    // a frog out walking leaves its seat
    const o = this.away.has(s.i) ? undefined : this.occ.get(s.i);
    const key = o ? String(o.key) : "";
    const dim = o && this.match ? !this.match(key) : this.match !== null && !o;
    const lift = SEAT_LIFT[s.kind] ?? 0, [cx, cy] = P(s.x, s.y, s.z + lift);
    if (mode === "overlay") {
      if (!o) return;
      const sel = this.selected === key;
      if (this.crew.has(key) || sel) this.marker(c, s.x, s.y, s.z, sel ? "#ffffff" : "#c6f27a", t);
      else if (this.match && !dim) this.found(c, s);
      if (this.isHover(o) && !sel) disc(c, s.x, s.y, s.z, 0.55, null, "rgba(255,255,255,.6)", 1.5 / this.cam.z);
      const est = this.drawnAt.get(key) ?? this.estimate(s, o);
      if (fxOn && !dim) this.jobs.push({ d: est, o, spill: SPILL[s.kind] ?? null, body: this.bodyRect(cx, cy, o.who.k) });
      return;
    }
    if (dim) c.globalAlpha = 0.22;
    // an open Night Watch seat waits, dimmed
    else if (!o && s.kind === "watch") c.globalAlpha = 0.5;
    const back = BACK[s.kind];
    if (s.kind === "watch" || s.kind === "plinth" || s.kind === "throne") this.seatGlow(c, s, o ?? null, t);
    if (back && !this.F.noPieces) this.piece(`b:${s.kind}`, back, bx, by, c, li);
    if (o) {
      const sel = this.selected === key;
      if (mode === "live" && (this.crew.has(key) || sel)) this.marker(c, s.x, s.y, s.z, sel ? "#ffffff" : "#c6f27a", t);
      else if (mode === "live" && this.match && !dim) this.found(c, s);
      const body = this.bodyRect(cx, cy, o.who.k);
      if (o.kind === "watcher" && fxOn) watcherBack(c, body, o.tier, o.color, t, o.ph);
      const live = mode === "live" && !this.still;
      const blink = live && ((t * 1000 + o.ph * 7919) % (3800 + o.ph * 2600)) < 140;
      const breath = live && Math.floor((t * 1000 + o.ph * 1100) / 1300) % 2 ? 1 : 0;
      const dr = this.F.noSprites ? this.estimate(s, o) : this.cast.draw(c, o.who, cx, cy, 0, STAND.has(s.kind) ? P_IDLE : P_SIT, px, { blink, breath });
      if (mode === "live") {
        this.drawnAt.set(key, dr);
        if (fxOn && !dim) this.jobs.push({ d: dr, o, spill: SPILL[s.kind] ?? null, body });
        if (this.isHover(o) && !sel) disc(c, s.x, s.y, s.z, 0.55, null, "rgba(255,255,255,.6)", 1.5 / this.cam.z);
      }
    }
    const front = FRONT[s.kind];
    if (front && !this.F.noPieces) this.piece(`f:${s.kind}`, front, bx, by, c, li);
    if (!o && this.empty.has(s.i) && px > 1.2) {
      // the seat of a frog that is away: a small tag where it sits
      const why = this.empty.get(s.i)!;
      c.fillStyle = why.startsWith("forged") ? "rgba(255,140,90,.7)" : "rgba(198,242,122,.7)";
      c.beginPath(); c.arc(bx, by - 18, 2.2, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
  }

  /** A character out of its seat: walking (legs moving), standing at a place, or talking. */
  private drawWalker(c: CanvasRenderingContext2D, w: Walker, t: number, ms: number, px: number, fxOn: boolean, big: boolean) {
    const o = this.occ.get(w.seat);
    if (!o) return;
    const key = String(o.key), [x, y] = P(w.x, w.y, w.z);
    const dim = this.match ? !this.match(key) : false;
    const moving = (w.mode === "out" || w.mode === "back") && w.v > 0.05;
    const talking = !moving && w.gesture > ms && w.gesture - ms < 1600;
    const pose = moving ? P_WALK + (Math.floor(w.dist / (0.3 * w.k)) % 4) : talking ? P_TALK + (Math.floor(ms / 230) % 2) : P_IDLE;
    if (dim) c.globalAlpha = 0.25;
    // a soft contact shadow
    c.fillStyle = "rgba(4,4,12,.38)"; c.beginPath(); c.ellipse(x, y + 1, 9 * w.k * U * 0.9, 3.6 * w.k * U * 0.9, 0, 0, Math.PI * 2); c.fill();
    const sel = this.selected === key;
    if (this.crew.has(key) || sel || key === this.followKey) this.marker(c, w.x, w.y, w.z, sel || key === this.followKey ? "#ffffff" : "#c6f27a", t, 0.5);
    const body = this.bodyRect(x, y, o.who.k);
    if (o.kind === "watcher" && fxOn && !dim) watcherBack(c, body, o.tier, o.color, t, o.ph);
    const blink = !this.still && ms > w.blinkAt && ms < w.blinkAt + 140;
    const breath = !moving && Math.floor((ms + w.ph * 1100) / 1300) % 2 ? 1 : 0;
    const dr = this.cast.draw(c, o.who, x, y, w.dir, pose, px, { blink, breath });
    this.drawnAt.set(key, dr);
    if (fxOn && !dim) this.jobs.push({ d: dr, o, spill: null, body });
    if (this.isHover(o) && !sel) { c.strokeStyle = "rgba(255,255,255,.6)"; c.lineWidth = 1.5 / this.cam.z; c.beginPath(); c.ellipse(x, y + 1, 11 * w.k * U * 0.8, 4.5 * w.k * U * 0.8, 0, 0, Math.PI * 2); c.stroke(); }
    c.globalAlpha = 1;
    void big;
  }

  private isHover(o: Occ) { const h = this.hover; return Boolean(h && ((h.kind === "frog" && o.kind === "frog" && h.id === o.id) || (h.kind === "watcher" && o.kind === "watcher" && h.n === o.id))); }

  // ------------------------------------------------------------------ the baked crew layer
  private crewTiles = new Map<string, { c: HTMLCanvasElement; li: number }>();
  private crewStale = new Set<string>();
  private crewLevel = -1;
  /** Throws away the baked crew (the seats changed, a filter). */
  rebake() { this.crewTiles.clear(); this.crewStale.clear(); this.dirty = true; }
  /** Marks every baked tile for a redraw, kept on screen until it is (the art came in). */
  private staleAll() { for (const k of this.crewTiles.keys()) this.crewStale.add(k); this.dirty = true; }
  /** A seat's frog got up or sat down: the baked tiles it is on are drawn again. */
  private staleSeat(i: number) {
    const s = SEATS[i]!, [x, y] = P(s.x, s.y, s.z), box = [x - 70, y - 170, x + 70, y + 40];
    for (const [k, v] of this.crewTiles) {
      const span = TS / LEVELS[v.li]!, [, tx, ty] = k.split(":").map(Number) as [number, number, number];
      if (box[2]! >= tx * span && box[0]! <= (tx + 1) * span && box[3]! >= ty * span && box[1]! <= (ty + 1) * span) this.crewStale.add(k);
    }
  }
  private renderCrewTile(li: number, tx: number, ty: number, into?: HTMLCanvasElement): HTMLCanvasElement {
    const s = LEVELS[li]!, cv = into ?? document.createElement("canvas");
    cv.width = cv.height = TS;
    const g = cv.getContext("2d")!;
    const wx = (tx * TS) / s, wy = (ty * TS) / s, ww = TS / s;
    g.setTransform(s, 0, 0, s, -wx * s, -wy * s);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "medium";
    for (const e of this.ents) {
      if (e.box[2] < wx || e.box[0] > wx + ww || e.box[3] < wy || e.box[1] > wy + ww) continue;
      if (e.prop) { const [px, py] = P(e.prop.x, e.prop.y, e.prop.z); g.save(); g.translate(px, py); e.prop.draw(g); g.restore(); continue; }
      if (!LIVE.has(e.seat!.kind)) this.drawSeat(g, e.seat!, 0, U * s, false, false, "bake", li);
    }
    return cv;
  }
  /** Draws the baked crew for the view; false when some of it is not baked yet (then the frame draws it live). */
  private drawCrewTiles(c: CanvasRenderingContext2D, budgetEnd: number): boolean {
    const li = this.levelIndex();
    if (li !== this.crewLevel) {
      this.crewLevel = li;
      // keep the last level's tiles only while this one bakes
      for (const [k, v] of this.crewTiles) if (v.li !== li && Math.abs(v.li - li) > 1) { this.crewTiles.delete(k); this.crewStale.delete(k); }
    }
    const s = LEVELS[li]!, span = TS / s;
    const [x0, y0] = this.toWorld(-60, -80), [x1, y1] = this.toWorld(this.w + 60, this.h + 200);
    const [A, B, C, D] = WORLD_BOX;
    const want: [number, number, string][] = [];
    for (let ty = Math.floor(Math.max(y0, B) / span); ty <= Math.floor(Math.min(y1, D) / span); ty++) for (let tx = Math.floor(Math.max(x0, A) / span); tx <= Math.floor(Math.min(x1, C) / span); tx++) want.push([tx, ty, `${li}:${tx}:${ty}`]);
    let ready = true;
    for (const [tx, ty, k] of want) {
      const have = this.crewTiles.get(k);
      if (!have) { if (performance.now() < budgetEnd) this.crewTiles.set(k, { c: this.renderCrewTile(li, tx, ty), li }); else ready = false; }
      else if (this.crewStale.has(k) && performance.now() < budgetEnd) { this.renderCrewTile(li, tx, ty, have.c); this.crewStale.delete(k); }
    }
    if (this.crewStale.size) this.dirty = true;
    if (!ready) { this.dirty = true; return false; }
    const d = this.dpr;
    for (const [tx, ty, k] of want) {
      const [px, py] = this.toScreen(tx * span, ty * span), [qx, qy] = this.toScreen((tx + 1) * span, (ty + 1) * span);
      const rx = Math.round(px * d), ry = Math.round(py * d);
      c.drawImage(this.crewTiles.get(k)!.c, rx, ry, Math.round(qx * d) - rx, Math.round(qy * d) - ry);
    }
    if (this.crewTiles.size > 120) for (const [k, v] of this.crewTiles) if (v.li !== li) { this.crewTiles.delete(k); this.crewStale.delete(k); }
    return true;
  }

  private seatGlow(c: CanvasRenderingContext2D, s: Seat, o: Occ | null, t: number) {
    const col = s.kind === "plinth" ? "#ffcf86" : s.kind === "throne" ? "#e9e4ff" : o ? o.color : "#7fd6ff";
    const on = o?.kind === "watcher" ? this.onWatch(o.id) : s.kind === "throne" && this.snap?.captain.watch.online;
    const k = o ? (on ? 0.85 + 0.15 * Math.sin(t * 3) : 0.5) : 0.22;
    disc(c, s.x, s.y, s.z, s.kind === "throne" ? 1.1 : 0.62, alpha(col, 0.08 * k), alpha(col, 0.55 * k), 1.2);
    if (!o && s.kind === "watch") {
      // an open seat: its number on the floor
      const [x, y] = P(s.x, s.y, s.z);
      c.fillStyle = "rgba(127,214,255,.4)"; c.font = `600 7px ${FONT_MONO}`; c.textAlign = "center";
      c.fillText(String(WATCH.indexOf(s) + 1), x, y + 3);
    }
    if (!o && s.kind === "plinth" && this.cam.z > 0.9) {
      const [x, y] = P(s.x, s.y, s.z);
      c.fillStyle = "rgba(255,207,134,.85)"; c.font = `700 6px ${FONT_MONO}`; c.textAlign = "center";
      c.fillText("NIGHT BOSS", x, y - 18); c.fillStyle = "rgba(255,207,134,.5)"; c.fillText("NOT FORGED YET", x, y - 11);
    }
  }
  private onWatch(n: number) { return Boolean(this.snap?.watchers.find((w) => w.n === n)?.watch.online); }

  /** A filter's match: a ring of light under it. */
  private found(c: CanvasRenderingContext2D, s: Seat) {
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    const [x, y] = P(s.x, s.y, s.z);
    glow(c, x, y, 42, "#7fd6ff", 0.42, 0.5);
    disc(c, s.x, s.y, s.z, 0.6, null, "rgba(170,236,255,.8)", 1.5 / Math.max(0.4, this.cam.z));
    c.globalCompositeOperation = prev;
  }
  private marker(c: CanvasRenderingContext2D, x: number, y: number, z: number, col: string, t: number, r = 0.72) {
    const k = this.still ? 1 : 0.8 + 0.2 * Math.sin(t * 4);
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    disc(c, x, y, z, r, alpha(col, 0.12 * k), alpha(col, 0.9 * k), 2 / Math.max(0.4, this.cam.z));
    const [px, py] = P(x, y, z);
    glow(c, px, py, 50, col, 0.3 * k, 0.5);
    c.globalCompositeOperation = prev;
  }

  // ------------------------------------------------------------------ live light and machines
  private lightsUnder(c: CanvasRenderingContext2D, t: number) {
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    const fglow = (x: number, y: number, z: number, r: number, col: string, a: number) => { const [px, py] = P(x, y, z); glow(c, px, py, r * RX, col, a * 1.6, 0.5); };
    fglow(RADAR.x, RADAR.y, 0.5, 7.5, "#4ab8e8", 0.09 + 0.02 * Math.sin(t * 1.3));
    fglow(REACTOR.x, REACTOR.y, 0, 10, "#ffb05a", 0.08 + 0.03 * Math.sin(t * 2.1));
    fglow(REACTOR.x, REACTOR.y, 0, 6, "#5ad6f0", 0.08 + 0.04 * Math.sin(t * 3.3 + 1));
    for (const [x, y] of DRIVE) fglow(x, y, 0, 3.2, "#8b74ff", 0.08 + 0.03 * Math.sin(t * 2.6 + x));
    const fl = 0.12 + 0.04 * Math.sin(t * 7.3) * Math.sin(t * 3.1) + (this.flare ? Math.max(0, 1 - (performance.now() - this.flare) / 4000) * 0.4 : 0);
    fglow(FURNACE.x + 1.4, FURNACE.y + 1.4, 0, 8, "#ff7a3a", fl);
    fglow(THRONE.x, THRONE.y, 0.5, 2.4, "#e9e4ff", 0.07);
    c.globalCompositeOperation = prev;
  }

  private propFx(c: CanvasRenderingContext2D, key: string, t: number) {
    const prev = c.globalCompositeOperation;
    if (key === "radar") this.radar(c, t);
    else if (key === "peg") this.pegBoard(c, t);
    else if (key === "chart") this.starChart(c, t);
    else if (key === "furnace") this.furnaceFx(c, t);
    else if (key === "reactor") {
      // the plasma column in the glass, bands of light climbing it, the glow round the chamber
      c.globalCompositeOperation = "lighter";
      const R = REACTOR.r * 0.6, k = 0.75 + 0.25 * Math.sin(t * 2.4);
      const [x0, top] = P(REACTOR.x, REACTOR.y, 4.35), [, bot] = P(REACTOR.x, REACTOR.y, 1.45);
      const w = R * RX * 0.42;
      const g = c.createLinearGradient(x0 - w, 0, x0 + w, 0);
      g.addColorStop(0, "rgba(90,214,240,0)"); g.addColorStop(0.3, `rgba(90,214,240,${0.28 * k})`); g.addColorStop(0.5, `rgba(220,250,255,${0.7 * k})`); g.addColorStop(0.7, `rgba(90,214,240,${0.28 * k})`); g.addColorStop(1, "rgba(90,214,240,0)");
      c.fillStyle = g; c.fillRect(x0 - w, top, w * 2, bot - top);
      glow(c, x0, (top + bot) / 2, R * RX * 1.1, "#5ad6f0", 0.22 * k, 1.25);
      for (let i = 0; i < 4; i++) {
        const p = (t * 0.32 + i / 4) % 1, z = 1.5 + p * 2.8, [, py] = P(REACTOR.x, REACTOR.y, z);
        c.strokeStyle = `rgba(170,240,255,${0.55 * Math.sin(p * Math.PI)})`; c.lineWidth = 1.4;
        c.beginPath(); c.ellipse(x0, py, R * RX * 0.92, R * RY * 0.92, 0, 0, Math.PI * 2); c.stroke();
      }
      const [, ry] = P(REACTOR.x, REACTOR.y, 5.45);
      glow(c, x0, ry, 60, "#ffcf86", 0.24 * k, 0.6);
    } else if (key.startsWith("drive")) {
      c.globalCompositeOperation = "lighter";
      const [x, y] = DRIVE[Number(key.slice(5))]!;
      for (let k = 0; k < 5; k++) {
        const a = 0.2 + 0.45 * Math.max(0, Math.sin(t * 3.2 - k * 0.8 + x));
        const [px, py] = P(x, y, 0.83 + k * 0.62);
        c.strokeStyle = `rgba(170,150,255,${a})`; c.lineWidth = 1.8;
        c.beginPath(); c.ellipse(px, py, 1.06 * RX, 1.06 * RY, 0, 0, Math.PI); c.stroke();
      }
      const [tx, ty] = P(x, y, 4.3);
      glow(c, tx, ty, 30, "#a996ff", 0.35 + 0.15 * Math.sin(t * 5 + x));
    } else if (key === "coffee" && !this.still) {
      for (let k = 0; k < 3; k++) { const p = (t / 2.6 + k / 3) % 1; const [x, y] = P(COFFEE.x + 0.25, COFFEE.y + 0.25, 1.75); c.fillStyle = `rgba(240,236,250,${0.22 * Math.sin(p * Math.PI)})`; c.beginPath(); c.ellipse(x + Math.sin(p * 5 + k) * 4, y - p * 40, 5 + p * 7, 6 + p * 8, 0, 0, Math.PI * 2); c.fill(); }
    }
    c.globalCompositeOperation = prev;
  }

  /** The Night Watch radar: every open imdUSD loan as a blip, nearer the centre the closer it is to liquidation. */
  private radar(c: CanvasRenderingContext2D, t: number) {
    const z = 0.5 + 0.5 + 0.42, R = RADAR.r * 0.94;
    const [cx, cy] = P(RADAR.x, RADAR.y, z);
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    const [bx, by] = P(RADAR.x, RADAR.y, 1.0);
    const beam = c.createLinearGradient(0, by, 0, cy);
    beam.addColorStop(0, "rgba(90,200,240,.14)"); beam.addColorStop(1, "rgba(90,200,240,.02)");
    c.fillStyle = beam;
    c.beginPath(); c.moveTo(bx - R * RX * 0.32, by); c.lineTo(cx - R * RX, cy); c.lineTo(cx + R * RX, cy); c.lineTo(bx + R * RX * 0.32, by); c.closePath(); c.fill();
    c.save(); c.translate(cx, cy); c.scale(1, RY / RX);
    const rr = R * RX;
    c.fillStyle = rad(c, 0, 0, rr, [[0, "rgba(90,200,240,.10)"], [1, "rgba(90,200,240,.03)"]]); c.beginPath(); c.arc(0, 0, rr, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(127,214,255,.5)"; c.lineWidth = 1.3; c.beginPath(); c.arc(0, 0, rr, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = "rgba(127,214,255,.16)"; c.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) { c.beginPath(); c.arc(0, 0, rr * f, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.moveTo(-rr, 0); c.lineTo(rr, 0); c.moveTo(0, -rr); c.lineTo(0, rr); c.stroke();
    const radar = this.snap?.radar;
    // the liquidation line (the vault's mat) in red
    const at = (cr: number) => Math.max(0.05, Math.min(1, Math.log(cr / 100) / Math.log(6)));
    if (radar) { c.strokeStyle = "rgba(255,96,120,.6)"; c.lineWidth = 1.3; c.setLineDash([3, 3]); c.beginPath(); c.arc(0, 0, rr * at(radar.mat), 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
    const sweep = this.still ? -0.6 : (t * Math.PI * 2) / 4.5;
    for (let k = 0; k < 14; k++) {
      c.fillStyle = `rgba(90,200,240,${0.16 * (1 - k / 14)})`;
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, rr, sweep - (k + 1) * 0.06, sweep - k * 0.06); c.closePath(); c.fill();
    }
    c.strokeStyle = "rgba(170,236,255,.85)"; c.lineWidth = 1.3; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(sweep) * rr, Math.sin(sweep) * rr); c.stroke();
    if (radar) for (const l of radar.loans) {
      // blips: in the floor plane, placed by the loan's bearing and collateral ratio
      const a = (l.a * Math.PI) / 180, d = at(l.cr) * rr;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      let since = (sweep - a) % (Math.PI * 2); if (since < 0) since += Math.PI * 2;
      const lit = this.still ? 0.8 : 0.3 + 0.7 * Math.exp(-since / 1.6);
      const col = l.state === "actionable" ? "255,70,95" : l.state === "grace" ? "255,120,180" : l.cr < radar.mat * 1.15 ? "255,200,120" : "130,240,200";
      const s = 1.6 + Math.min(4, Math.sqrt(l.debt) / 9);
      c.fillStyle = `rgba(${col},${0.22 * lit})`; c.beginPath(); c.arc(x, y, s * 2.6, 0, Math.PI * 2); c.fill();
      c.fillStyle = `rgba(${col},${lit})`; c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    c.globalCompositeOperation = prev;
    if (this.cam.z > 0.7) {
      c.font = `600 8px ${FONT_MONO}`; c.textAlign = "center";
      c.fillStyle = radar ? "rgba(190,236,255,.85)" : "rgba(255,210,140,.85)";
      c.fillText(radar ? `IMDUSD VAULT · ${radar.loans.length} LOANS` : "RADAR OFFLINE · NO VAULT READ YET", cx, cy + R * RY + 14);
      if (radar) { c.fillStyle = "rgba(255,130,150,.85)"; c.fillText(`${radar.mat}% LIQUIDATION LINE`, cx, cy + R * RY + 24); }
    }
  }

  /** The imdUSD vault in numbers, over the bridge's port projector: what the Night Watch protects. */
  private pegBoard(c: CanvasRenderingContext2D, t: number) {
    const [x, y] = P(PEG.x, PEG.y, 1.15), r = this.snap?.radar ?? null, w = 92, h = 52, k = this.still ? 1 : 0.9 + 0.1 * Math.sin(t * 2.2);
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    const [bx, by] = P(PEG.x, PEG.y, 0.5 + 0.55);
    const beam = c.createLinearGradient(0, by, 0, y - h);
    beam.addColorStop(0, "rgba(90,200,240,.18)"); beam.addColorStop(1, "rgba(90,200,240,0)");
    c.fillStyle = beam;
    c.beginPath(); c.moveTo(bx - 10, by); c.lineTo(x - w / 2, y); c.lineTo(x + w / 2, y); c.lineTo(bx + 10, by); c.closePath(); c.fill();
    c.fillStyle = `rgba(60,150,200,${0.12 * k})`; c.fillRect(x - w / 2, y - h, w, h);
    c.strokeStyle = `rgba(150,226,255,${0.6 * k})`; c.lineWidth = 0.8; c.strokeRect(x - w / 2, y - h, w, h);
    c.globalCompositeOperation = prev;
    if (this.cam.z < 0.6) return;
    c.textAlign = "left"; c.fillStyle = `rgba(214,244,255,${k})`;
    c.font = `700 5px ${FONT_MONO}`; c.fillText("IMDUSD VAULT · LIVE", x - w / 2 + 5, y - h + 8);
    if (!r) { c.font = `600 5px ${FONT_MONO}`; c.fillText("not read yet", x - w / 2 + 5, y - h + 20); return; }
    c.font = `700 11px ${FONT_MONO}`; c.fillStyle = r.peg !== null && Math.abs(r.peg - 1) > 0.02 ? "#ffcf86" : "#c6f27a";
    c.fillText(r.peg === null ? "peg —" : `${r.peg.toFixed(4)}`, x - w / 2 + 5, y - h + 21);
    c.fillStyle = "rgba(214,244,255,.85)"; c.font = `600 4.6px ${FONT_MONO}`;
    c.fillText(`${Math.round(r.totalDebt).toLocaleString("en-US")} owed · ${r.loans.length} loans`, x - w / 2 + 5, y - h + 30);
    c.fillText(`liquidation under ${r.mat}% · bonus ${r.bonusPct}%`, x - w / 2 + 5, y - h + 37);
    if (r.stale.length) { c.fillStyle = "rgba(255,207,134,.9)"; c.fillText(`stale: ${r.stale.join(", ")}`.slice(0, 34), x - w / 2 + 5, y - h + 45); }
  }

  /** A star chart over the starboard projector: a slowly turning globe of the route (decoration). */
  private starChart(c: CanvasRenderingContext2D, t: number) {
    const [x, y] = P(CHART.x, CHART.y, 1.7), R = 24, a = this.still ? 0.4 : t * 0.35;
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    glow(c, x, y, R * 1.5, "#a996ff", 0.2);
    c.strokeStyle = "rgba(196,180,255,.5)"; c.lineWidth = 0.8;
    c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.stroke();
    for (let k = 0; k < 4; k++) { const rx = Math.abs(Math.cos(a + (k * Math.PI) / 4)) * R; c.beginPath(); c.ellipse(x, y, rx, R, 0, 0, Math.PI * 2); c.stroke(); }
    for (const f of [-0.5, 0, 0.5]) { c.beginPath(); c.ellipse(x, y + f * R, R * Math.sqrt(1 - f * f), R * 0.18, 0, 0, Math.PI * 2); c.stroke(); }
    const ox = x + Math.cos(a * 2.2) * R * 1.35, oy = y + Math.sin(a * 2.2) * R * 0.35;
    glow(c, ox, oy, 6, "#c6f27a", 0.8);
    c.globalCompositeOperation = prev;
  }

  private furnaceFx(c: CanvasRenderingContext2D, t: number) {
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    const [m, n] = P(FURNACE.x + 1.0, FURNACE.y + 1.0, 0.25);
    const f = 0.8 + 0.2 * Math.sin(t * 9) * Math.sin(t * 4.3), flare = this.flare ? Math.max(0, 1 - (performance.now() - this.flare) / 4000) : 0;
    c.save();
    c.beginPath(); c.moveTo(m - 36, n); c.lineTo(m - 36, n - 29); c.quadraticCurveTo(m, n - 60, m + 36, n - 29); c.lineTo(m + 36, n); c.closePath(); c.clip();
    const fire = c.createLinearGradient(0, n - 50, 0, n);
    fire.addColorStop(0, `rgba(255,90,30,${0.45 * f})`); fire.addColorStop(0.6, `rgba(255,170,70,${0.8 * f})`); fire.addColorStop(1, `rgba(255,236,190,${0.9 * f})`);
    c.fillStyle = fire; c.fillRect(m - 36, n - 60, 72, 60);
    for (let k = 0; k < 6; k++) {
      const ph = t * (3 + k * 0.4) + k * 1.7, hgt = 26 + 14 * Math.sin(ph), x = m - 28 + k * 11 + Math.sin(ph * 1.3) * 3;
      c.fillStyle = `rgba(255,246,210,${0.45 + 0.25 * Math.sin(ph)})`;
      c.beginPath(); c.moveTo(x - 6, n); c.quadraticCurveTo(x - 4, n - hgt * 0.6, x + Math.sin(ph) * 3, n - hgt); c.quadraticCurveTo(x + 4, n - hgt * 0.6, x + 6, n); c.closePath(); c.fill();
    }
    c.restore();
    glow(c, m, n - 20, 80 + flare * 80, "#ff8a3a", (0.4 + flare * 0.4) * f);
    glow(c, m, n - 14, 36, "#ffe0a0", 0.38 * f);
    const [cx2, cy2] = P(FURNACE.x + 2.0, FURNACE.y + 2.0, 0);
    glow(c, cx2, cy2, 36, "#ff7a2a", 0.45 * f, 0.5);
    const [h0, h1] = P(FURNACE.x - 0.3, FURNACE.y - 0.3, 2.3);
    if (!this.still) for (let k = 0; k < 10; k++) { const p = (t / 2.2 + k * 0.1) % 1; c.fillStyle = `rgba(255,${150 + k * 8},70,${0.85 * Math.sin(p * Math.PI)})`; c.fillRect(h0 - 8 + ((k * 13) % 16) + Math.sin(p * 9 + k) * 6, h1 - 72 - p * 90, 2, 2); }
    c.globalCompositeOperation = prev;
    // the newest Night Watcher, as a hologram above the furnace
    const latest = [...(this.snap?.watchers ?? [])].sort((a, b) => b.forgedAt - a.forgedAt)[0];
    if (latest) {
      const key = `w${latest.n}`, o = [...this.occ.values()].find((q) => String(q.key) === key);
      const [hx, hy] = P(FURNACE.x + 1.9, FURNACE.y + 1.9, 2.4), k = this.still ? 1 : 0.8 + 0.2 * Math.sin(t * 1.6);
      if (o) {
        c.globalAlpha = 0.6 * k;
        this.cast.draw(c, o.who, hx, hy + Math.sin(t * 1.2) * 2, 0, P_IDLE, U * this.cam.z * this.dpr);
        c.globalAlpha = 1;
        const b = this.bodyRect(hx, hy, o.who.k);
        c.globalCompositeOperation = "lighter";
        for (let y = b.y; y < hy; y += 3) { c.fillStyle = alpha(latest.color, 0.05); c.fillRect(b.x, y, b.w, 1); }
        c.globalCompositeOperation = prev;
      }
      if (this.cam.z > 0.8) { c.font = `600 7px ${FONT_MONO}`; c.textAlign = "center"; c.fillStyle = alpha(latest.color, 0.95); c.fillText(`NEWEST · NIGHT WATCHER #${latest.n} · ${latest.tierName.toUpperCase()}`, hx, hy + 11); }
    }
  }

  /** The forge's memorial wall: every frog it burned, by the Night Watcher it went into. */
  private drawMemorial(c: CanvasRenderingContext2D) {
    const snap = this.snap;
    if (!snap) return;
    const forged = [...snap.watchers].sort((a, b) => a.n - b.n);
    // drawn again when a forge happens or more of its frogs' heads are ready
    const heads = forged.reduce((n, w) => n + (w.n === 0 ? [1] : w.inputs).filter((id) => this.cast.faces.get(id, 1)).length, 0);
    const key = `${forged.map((w) => w.n).join(",")}|${heads}`;
    const y0 = 77.0, len = 10, top = WALL - 1.25;
    if (key !== this.memorialKey) {
      this.memorialKey = key;
      // each forge a plaque: its Night Watcher and the 10 frogs it burned, their heads in sepia
      const pw = 160, cv = document.createElement("canvas"); cv.width = len * pw; cv.height = 1.75 * pw;
      const g = cv.getContext("2d")!;
      g.textAlign = "center";
      g.font = `700 15px ${FONT_MONO}`; g.fillStyle = "rgba(255,170,120,.95)"; g.fillText("FORGED INTO THE NIGHT WATCH", cv.width / 2, 20);
      if (!forged.length) { g.fillStyle = "rgba(255,170,120,.55)"; g.fillText("No frog forged yet", cv.width / 2, 140); }
      const n = Math.max(1, forged.length), colW = Math.min(520, (cv.width - 24) / n);
      const f = Math.min(80, (colW - 26) / 5 - 6, (cv.height - 84) / 2 - 18);
      forged.forEach((w, i) => {
        const x = 12 + i * colW + (colW - (5 * (f + 6) + 14)) / 2 * (n === 1 ? 1 : 0);
        const pwid = 5 * (f + 6) + 14;
        g.fillStyle = "rgba(40,18,14,.75)"; g.fillRect(x, 32, Math.min(pwid, colW - 8), cv.height - 40);
        g.strokeStyle = alpha(w.color, 0.6); g.lineWidth = 2; g.strokeRect(x, 32, Math.min(pwid, colW - 8), cv.height - 40);
        g.font = `700 14px ${FONT_MONO}`; g.fillStyle = alpha(w.color, 1);
        g.fillText(w.n === 0 ? "THE CAPTAIN" : `NIGHT WATCHER #${w.n}`, x + Math.min(pwid, colW - 8) / 2, 52);
        const ids = w.n === 0 ? [1] : w.inputs;
        ids.forEach((id, j) => {
          const cx = x + 10 + (j % 5) * (f + 6), cy = 62 + Math.floor(j / 5) * (f + 20);
          const hd = f >= 14 ? this.cast.faces.get(id, 1) : null;
          if (hd) {
            g.globalAlpha = 0.9; g.filter = "grayscale(1) sepia(.55) brightness(1.05)"; g.imageSmoothingEnabled = false;
            const s = f / hd.w; g.drawImage(hd.front, cx, cy + f - hd.front.height * s, f, hd.front.height * s);
            g.filter = "none"; g.globalAlpha = 1; g.imageSmoothingEnabled = true;
          }
          g.fillStyle = "rgba(255,200,165,.95)"; g.font = `600 ${f >= 14 ? 12 : 11}px ${FONT_MONO}`;
          g.fillText(`#${id}`, cx + f / 2, cy + (f >= 14 ? f * 0.95 + 13 : 10));
        });
      });
      this.memorial = cv;
    }
    if (!this.memorial) return;
    const [ox, oy] = P(0.02, y0 + len, top);
    c.save();
    c.transform(32 / 160, -16 / 160, 0, 32 / 160, ox, oy);
    c.drawImage(this.memorial, 0, 0);
    c.restore();
  }

  /** The wardroom's portrait: #1, the Zero-Sleep Captain (The Captain once it is forged), in its gold frame. */
  private drawPortrait(c: CanvasRenderingContext2D) {
    if (this.cam.z < 0.35) return;
    const k = 40, forged = Boolean(this.snap?.captain.forged), key: Key = forged ? "w0" : 1;
    const hd = this.cast.faces.get(key, forged ? 1.75 : 1);
    if (!hd) return;
    const [ox, oy] = P(0.02, 25.2, WALL - 1.98);
    c.save();
    c.transform(32 / k, -16 / k, 0, 32 / k, ox, oy);
    c.imageSmoothingEnabled = false;
    const h = 0.98 * k, w = (hd.front.width / hd.front.height) * h;
    c.drawImage(hd.front, 0.65 * k - w / 2, 1.04 * k - h, w, h);
    c.imageSmoothingEnabled = true;
    c.restore();
  }

  /**
   * The shift floor's board, on the engine room wall: what the whole crew earns an hour, and the hours accruing
   * since the staking book's last credit (the next hourly credit pays exactly these, if nobody sells meanwhile).
   */
  private drawBoard(c: CanvasRenderingContext2D) {
    const snap = this.snap;
    if (!snap || this.cam.z < 0.42) return;
    const y1 = 54 + 22 - 18.6, k = 40, w = 6.2;
    const [ox, oy] = P(0.02, y1, WALL - 1.2);
    c.save();
    c.transform(32 / k, -16 / k, 0, 32 / k, ox, oy);
    c.translate(-w * k, 0);
    const since = Math.max(0, Date.now() - snap.stakingAt) / 3_600_000, acc = snap.totals.perHour * since;
    c.textBaseline = "alphabetic"; c.textAlign = "left";
    c.fillStyle = "rgba(255,192,115,.85)"; c.font = `700 7px ${FONT_MONO}`;
    c.fillText("THE WHOLE CREW · SHIFT HOURS AN HOUR", 8, 11);
    c.fillStyle = "#ffe8c0"; c.font = `700 22px ${FONT_MONO}`;
    c.fillText(snap.totals.perHour.toLocaleString("en-US", { maximumFractionDigits: 1 }), 8, 34);
    c.fillStyle = "rgba(198,242,122,.95)"; c.font = `700 9px ${FONT_MONO}`;
    c.fillText(`+${acc.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} accruing`, 8, 46);
    c.fillStyle = "rgba(255,192,115,.6)"; c.font = `600 5.5px ${FONT_MONO}`;
    c.fillText(`since the last credit, ${Math.floor(since * 60)} min ago · paid every hour`, 8, 52);
    c.restore();
  }

  private overFx(c: CanvasRenderingContext2D, t: number) {
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    // the engines' exhaust, out of the stern
    for (const ex of [6, 16, 26]) {
      const [nx, ny] = P(ex, L + 6.3, -0.9);
      const f = this.still ? 1 : 0.88 + 0.12 * Math.sin(t * 13 + ex) * Math.sin(t * 5.1);
      for (let k = 0; k < 7; k++) {
        const d = k * 0.9, [px, py] = P(ex, L + 6.3 + d, -0.9), s = 1 - k / 8;
        c.fillStyle = rad(c, px, py, 70 * s, [[0, `rgba(170,230,255,${0.26 * s * f})`], [0.4, `rgba(90,160,255,${0.12 * s * f})`], [1, "rgba(80,120,255,0)"]]);
        c.beginPath(); c.ellipse(px, py, 70 * s, 54 * s, -0.46, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = rad(c, nx, ny, 50, [[0, `rgba(240,252,255,${0.75 * f})`], [0.5, `rgba(130,210,255,${0.32 * f})`], [1, "rgba(80,160,255,0)"]]);
      c.beginPath(); c.ellipse(nx, ny, 46, 40, -0.46, 0, Math.PI * 2); c.fill();
    }
    // navigation lights: red port, green starboard, white at the mast
    if (this.still || (t % 1.6) < 0.2) {
      for (const [x, y, z, col] of [[-11, 58.5, -0.3, "255,80,96"], [43.4, 62.2, -0.8, "100,255,150"], [-1.2, -1.2, 9.05, "255,255,255"]] as const) {
        const [px, py] = P(x, y, z); c.fillStyle = rad(c, px, py, 22, [[0, `rgba(${col},.9)`], [0.25, `rgba(${col},.35)`], [1, `rgba(${col},0)`]]); c.beginPath(); c.arc(px, py, 22, 0, Math.PI * 2); c.fill();
      }
    }
    c.globalCompositeOperation = prev;
    if (this.podOverflow > 0 && this.cam.z > 0.5) {
      const p = PODS[PODS.length - 1]!; const [x, y] = P(p.x, p.y + 1.2, 0);
      c.font = `700 9px ${FONT_MONO}`; c.textAlign = "center"; c.fillStyle = "#c6f27a"; c.fillText(`+${this.podOverflow} MORE OUT`, x, y);
    }
    void sparkle;
  }

  // ------------------------------------------------------------------ labels, speech and grading, in CSS px
  private onScreen(s: Seat) { const [x, y] = this.toScreen(...P(s.x, s.y, s.z)); return x > -30 && x < this.w + 30 && y > -30 && y < this.h + 30; }

  /** Speech bubbles over the crew: short lines with the ship's live numbers, fading in and out, never on top of each other. */
  private drawBubbles(c: CanvasRenderingContext2D, ms: number) {
    const z = this.cam.z;
    if (z < 0.45) return;
    const fs = Math.round(Math.max(11, Math.min(13.5, 9.5 + z * 2)));
    c.font = `600 ${fs}px ${FONT_UI}`;
    c.textBaseline = "middle"; c.textAlign = "left";
    const placed: [number, number, number, number][] = [];
    const list = this.life.bubbles.filter((b) => ms >= b.from).sort((a, b) => a.from - b.from);
    for (const b of list) {
      let wx: number, wy: number;
      if (b.w) { const d = this.drawnAt.get(b.w.key); const [px, py] = P(b.w.x, b.w.y, b.w.z); wx = px; wy = d ? d.y : py - 40 * b.w.k; }
      else { const s = SEATS[b.seat!]!, o = this.occ.get(s.i); if (!o || this.away.has(s.i)) continue; const d = this.drawnAt.get(String(o.key)) ?? this.estimate(s, o); wx = d.x + d.w / 2; wy = d.y; }
      const [sx, sy0] = this.toScreen(wx, wy);
      const a = Math.min(1, (ms - b.from) / 200, (b.until - ms) / 300);
      if (a <= 0) continue;
      const tw = c.measureText(b.text).width, pw = tw + 18, ph = fs + 12;
      let x = sx - pw / 2, y = sy0 - 10 - ph;
      if (x < -pw || x > this.w || y < -ph || y > this.h) continue;
      const hit = () => placed.find(([px, py, qw, qh]) => x < px + qw + 2 && x + pw + 2 > px && y < py + qh + 3 && y + ph + 3 > py);
      let k = 0;
      for (let o = hit(); o; o = hit()) { if (++k > 3) break; y = o[1] - ph - 4; }
      if (k > 3) continue;
      placed.push([x, y, pw, ph]);
      c.globalAlpha = a;
      // a light card with a small tail toward the speaker, its edge in the room's colour
      c.fillStyle = "rgba(10,10,20,.35)"; c.beginPath(); c.roundRect(x + 1, y + 2, pw, ph, 8); c.fill();
      c.fillStyle = "#f6f4fb"; c.beginPath(); c.roundRect(x, y, pw, ph, 8); c.fill();
      const tx = Math.max(x + 10, Math.min(x + pw - 10, sx));
      if (k === 0) { c.beginPath(); c.moveTo(tx - 5, y + ph - 0.5); c.lineTo(tx, y + ph + 6); c.lineTo(tx + 5, y + ph - 0.5); c.closePath(); c.fill(); }
      c.fillStyle = b.tone; c.fillRect(x + 7, y + ph - 3, pw - 14, 1.5);
      c.fillStyle = "#17151f"; c.fillText(b.text, x + 9, y + ph / 2 - 0.5);
    }
    c.globalAlpha = 1;
  }

  private drawLabels(c: CanvasRenderingContext2D, t: number) {
    const z = this.cam.z;
    c.textBaseline = "middle";
    // up close the room speaks for itself (and the room bar names it): the labels fade out
    const la = Math.min(0.96, 1.5 - z * 1.05);
    for (const r of ROOMS) {
      const lab = this.labels[r.key];
      if (!lab || la <= 0.02) continue;
      const [wx, wy] = P(r.label[0], r.label[1], r.key === "bridge" ? 4.4 : r.key === "engine" ? 6.9 : r.key === "forge" ? 6.7 : r.key === "drive" ? 5.3 : 3.2);
      const [x, y] = this.toScreen(wx, wy);
      if (x < -200 || x > this.w + 200 || y < -60 || y > this.h + 60) continue;
      c.globalAlpha = la;
      // a phone gets smaller labels
      const k = this.w < 600 ? 0.84 : 1, f1 = `700 ${(11.5 * k).toFixed(1)}px ${FONT_UI}`, f2 = `500 ${(10.5 * k).toFixed(1)}px ${FONT_MONO}`;
      const ls = (v: string) => { if ("letterSpacing" in c) (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = v; };
      c.font = f1; ls(`${1.6 * k}px`);
      const t1 = c.measureText(lab.title).width;
      ls("0px"); c.font = f2;
      const t2 = c.measureText(lab.line).width, tw = Math.max(t1, t2), pw = tw + 26 * k, ph = 38 * k;
      c.fillStyle = "rgba(9,10,18,.8)"; c.beginPath(); c.roundRect(x - pw / 2, y - ph / 2, pw, ph, 7); c.fill();
      c.strokeStyle = "rgba(255,255,255,.09)"; c.lineWidth = 1; c.stroke();
      c.fillStyle = r.accent; c.beginPath(); c.arc(x - pw / 2 + 11 * k, y - 7.5 * k, 2.6 * k, 0, Math.PI * 2); c.fill();
      c.textAlign = "left";
      c.font = f1; c.fillStyle = "#f4f2fb"; ls(`${1.6 * k}px`);
      c.fillText(lab.title, x - pw / 2 + 19 * k, y - 7.5 * k);
      ls("0px");
      c.font = f2; c.fillStyle = alpha(r.accent, 0.92); c.fillText(lab.line, x - pw / 2 + 11 * k, y + 8.5 * k);
      c.globalAlpha = 1;
    }
    // tags over the wallet's crew, the selected, the followed and the hovered character
    const tags = new Set<string>([...this.crew]);
    if (this.selected) tags.add(this.selected);
    if (this.followKey) tags.add(this.followKey);
    const hk = this.hover?.kind === "frog" ? String(this.hover.id) : this.hover?.kind === "watcher" ? `w${this.hover.n}` : null;
    if (hk) tags.add(hk);
    if (tags.size > 60 && z < 0.9) return;
    c.font = `700 10.5px ${FONT_UI}`; c.textAlign = "center";
    for (const k of tags) {
      const s = this.seatOf(k);
      if (!s) continue;
      const d = this.drawnAt.get(k) ?? this.estimate(s, this.occ.get(s.i) ?? null);
      const [x, y] = this.toScreen(d.x + d.w / 2, d.y);
      if (x < -40 || x > this.w + 40 || y < -20 || y > this.h + 20) continue;
      const label = k.startsWith("w") ? (k === "w0" ? "THE CAPTAIN" : `NW ${k.slice(1)}`) : `#${k}`;
      const w = c.measureText(label).width + 12, bob = this.still ? 0 : Math.sin(t * 3) * 1.2;
      const col = k === this.selected || k === this.followKey ? "#ffffff" : this.crew.has(k) ? "#c6f27a" : "#e9e4ff";
      c.fillStyle = "rgba(9,10,18,.86)"; c.beginPath(); c.roundRect(x - w / 2, y - 24 + bob, w, 16, 8); c.fill();
      c.strokeStyle = alpha(col, 0.7); c.lineWidth = 1; c.stroke();
      c.fillStyle = col; c.fillText(label, x, y - 15.5 + bob);
    }
  }

  private gradeCv: HTMLCanvasElement | null = null; private gradeKey = "";
  private grade(c: CanvasRenderingContext2D) {
    // the shift's light, by the hour in UTC: night 22-06, day 06-14, swing 14-22
    const fh = this.F.hour as number | undefined, h = fh ?? new Date().getUTCHours(), shift = h >= 22 || h < 6 ? "night" : h < 14 ? "day" : "swing";
    const key = `${this.w}x${this.h}:${shift}`;
    if (key !== this.gradeKey) {
      this.gradeKey = key;
      const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(this.w / 3)); cv.height = Math.max(1, Math.round(this.h / 3));
      const g = cv.getContext("2d")!;
      const v = g.createRadialGradient(cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.4, cv.width / 2, cv.height / 2, Math.max(cv.width, cv.height) * 0.8);
      v.addColorStop(0, "rgba(4,4,10,0)"); v.addColorStop(1, shift === "night" ? "rgba(4,4,14,.5)" : shift === "day" ? "rgba(4,4,10,.32)" : "rgba(12,6,8,.4)");
      g.fillStyle = v; g.fillRect(0, 0, cv.width, cv.height);
      this.gradeCv = cv;
    }
    c.drawImage(this.gradeCv!, 0, 0, this.w, this.h);
    if (shift === "swing") { c.globalCompositeOperation = "soft-light"; c.fillStyle = "rgba(255,160,90,.16)"; c.fillRect(0, 0, this.w, this.h); c.globalCompositeOperation = "source-over"; }
  }
  get shift() { const h = new Date().getUTCHours(); return h >= 22 || h < 6 ? "Night shift" : h < 14 ? "Day shift" : "Swing shift"; }
  getStats() { return this.stats; }
}
