import { BACK, FRONT, type Piece as FPiece, SPILL, coffee, driveCoil, furnace, radarTable, reactor } from "./furniture";
import { blink, fxLight, fxSolid, sparkle, watcherBack, watcherFront } from "./fx";
import { type Ctx, HZ, P, RX, RY, alpha, disc, glow, rad } from "./iso";
import { STATIC, WORLD_BOX, ring } from "./paint";
import { Space } from "./space";
import { type SpriteKey, Sprites } from "./sprites";
import type { Pick, ShipStatic, Snapshot, Station } from "./types";
import { CREW_SEATS, FURNACE, L, PLINTHS, PODS, RADAR, REACTOR, ROOMS, type RoomKey, SEATS, type Seat, THRONE, WALL, WATCH } from "./world";

/**
 * THE SHIP, drawn: a Canvas 2D scene with a camera (drag, wheel, pinch, keys, fly-to). The hull, floors and walls
 * are painted once into 256 px tiles per zoom level and reused; the furniture is cached as sprites per level;
 * every frame draws only what is on screen: space, the tiles, then seats, characters and props sorted back to
 * front, their effects, and the labels. The quality steps down by itself on a slow device.
 */
const LEVELS = [0.125, 0.177, 0.25, 0.354, 0.5, 0.707, 1, 1.414, 2, 2.83, 4];
const TS = 256;
/** A character's size in world px at zoom 1 (the art's bust is 920 × 870). */
export const SW = 50, SH = (SW * 870) / 920;

type Tile = { c: HTMLCanvasElement | null; used: number };
type Occ = { key: SpriteKey; kind: "frog" | "watcher"; id: number; traits: number[]; skin: string; tier: number; color: string; ph: number };
type Ent = { depth: number; seat?: Seat; prop?: { draw: (c: Ctx) => void; box: [number, number, number, number]; key: string; x: number; y: number; z: number }; box: [number, number, number, number] };
export type SceneStats = { fps: number; frameMs: number; drawn: number; tiles: number; sprites: number; quality: number; zoom: number; baked?: boolean };
export type Labels = Partial<Record<RoomKey, { title: string; line: string }>>;

const SEAT_SCALE: Partial<Record<Seat["kind"], number>> = { throne: 1.3, plinth: 1.15, watch: 1.06, pod: 0.98 };
/** The drive room's three coils, one per engine. */
const DRIVE: [number, number][] = [[20.2, 80.0], [24.4, 82.4], [28.4, 84.6]];
/** Seats always drawn live (their glows and rings move): the Night Watch, the Captain's chair, the Night Boss plinths. */
const LIVE = new Set<Seat["kind"]>(["watch", "throne", "plinth"]);
const SEAT_LIFT: Partial<Record<Seat["kind"], number>> = { throne: 0.22, plinth: 0.42, pod: 0.2, watch: 0.08, officer: 0.06 };

export class ShipScene {
  readonly sprites: Sprites;
  private c: CanvasRenderingContext2D;
  private space = new Space();
  private tiles = new Map<string, Tile>();
  private tileQueue: string[] = [];
  private ents: Ent[] = [];
  private occ = new Map<number, Occ>();
  private empty = new Map<number, string>();
  private keyToSeat = new Map<string, number>();
  private memorial: HTMLCanvasElement | null = null;
  private memorialKey = "";
  private raf = 0;
  private w = 1; private h = 1; private dpr = 1;
  cam = { x: 0, y: 0, z: 0.4 };
  private fly: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; t0: number; dur: number } | null = null;
  private vel = { x: 0, y: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; t: number; moved: number; cx: number; cy: number; pinch?: { d: number; z: number; mx: number; my: number } } | null = null;
  private hover: Pick | null = null;
  private lastPick = 0;
  private flare = 0;
  private quality = 2;
  private frames: number[] = [];
  private work: number[] = [];
  private stats: SceneStats = { fps: 0, frameMs: 0, drawn: 0, tiles: 0, sprites: 0, quality: 2, zoom: 0 };
  private dirty = true;
  snap: Snapshot | null = null;
  labels: Labels = {};
  crew = new Set<string>();
  selected: string | null = null;
  private matchFn: ((key: string) => boolean) | null = null;
  get match() { return this.matchFn; }
  set match(f: ((key: string) => boolean) | null) { this.matchFn = f; this.rebake(); }
  onPick?: (p: Pick | null) => void;
  onHover?: (p: Pick | null) => void;

  constructor(private canvas: HTMLCanvasElement, private st: ShipStatic, private still: boolean) {
    this.c = canvas.getContext("2d", { alpha: false })!;
    this.sprites = new Sprites(st);
    this.sprites.onReady = () => { this.dirty = true; if (this.sprites.pending === 0) this.rebake(); };
    this.build();
    this.assign();
    this.resize();
    this.fit(false);
    this.bind();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() { cancelAnimationFrame(this.raf); this.unbind(); }

  // ------------------------------------------------------------------ the cast
  private build() {
    for (const s of SEATS) {
      const [x, y] = P(s.x, s.y, s.z);
      this.ents.push({ depth: s.x + s.y + 0.01, seat: s, box: [x - 70, y - 160, x + 70, y + 40] });
    }
    const prop = (key: string, x: number, y: number, z: number, depth: number, box: [number, number, number, number], draw: (c: Ctx) => void) => {
      this.ents.push({ depth, prop: { key, draw, box, x, y, z }, box: [box[0] + P(x, y, z)[0], box[1] + P(x, y, z)[1], box[2] + P(x, y, z)[0], box[3] + P(x, y, z)[1]] });
    };
    prop("radar", RADAR.x, RADAR.y, 0.5, RADAR.x + RADAR.y, [-140, -60, 140, 80], (c) => radarTable(c, 0, 0, 0, RADAR.r));
    prop("reactor", REACTOR.x, REACTOR.y, 0, REACTOR.x + REACTOR.y, [-160, -210, 160, 100], (c) => reactor(c, 0, 0, REACTOR.r));
    prop("furnace", FURNACE.x, FURNACE.y, 0, FURNACE.x + FURNACE.y + 1, [-140, -220, 170, 130], (c) => furnace(c, 0, 0));
    for (const [i, [x, y]] of DRIVE.entries()) prop(`drive${i}`, x, y, 0, x + y, [-90, -170, 90, 60], (c) => driveCoil(c, 0, 0));
    prop("coffee", 1.0, 36.9, 0, 37.9, [-50, -70, 50, 30], (c) => coffee(c, 0, 0));
    this.ents.sort((a, b) => a.depth - b.depth);
  }

  /** Who sits where: each station's frogs by number in its seats, the Night Watch in its arcs, the Night Bosses on the plinths, the frogs out on missions in the pods. */
  assign() {
    this.occ.clear(); this.empty.clear(); this.keyToSeat.clear();
    const st = this.st, snap = this.snap;
    const byStation: Record<Station, number[]> = { bridge: [], quarters: [], offices: [], breakroom: [], missions: [], engine: [], forge: [] };
    st.frogs.forEach((row, i) => { const id = i + 1; if (id !== 1) byStation[st.rules[row[10]!]!.station].push(id); });
    const frog = (id: number): Occ => { const row = st.frogs[id - 1]!, traits = row.slice(3, 10); return { key: id, kind: "frog", id, traits, skin: this.sprites.skins[traits[2]!] ?? "#5F9E45", tier: 0, color: "", ph: ((id * 0.6180339) % 1) }; };
    const away = new Map<number, string>();
    const pods: number[] = [];
    if (snap) for (const f of snap.frogs) {
      if (f.dead) away.set(f.id, f.into === null ? "forged" : f.into === 0 ? "forged into The Captain" : `forged into Night Watcher #${f.into}`);
      else if (f.mission && !f.mission.done) { away.set(f.id, `on a mission: ${f.mission.title}`); pods.push(f.id); }
    }
    const put = (seat: Seat, o: Occ | null, why?: string) => {
      if (o) { this.occ.set(seat.i, o); this.keyToSeat.set(String(o.key), seat.i); } else if (why) this.empty.set(seat.i, why);
    };
    for (const k of Object.keys(byStation) as Station[]) {
      byStation[k].forEach((id, j) => { const seat = CREW_SEATS[k][j]; if (seat) put(seat, away.has(id) ? null : frog(id), away.get(id)); });
    }
    // the Captain's chair: #1, or The Captain once #1 is forged
    const captain = snap?.watchers.find((w) => w.n === 0);
    if (captain) { this.sprites.setWatcher(0, captain.traits, captain.color); put(THRONE, { key: "w0", kind: "watcher", id: 0, traits: captain.traits, skin: this.sprites.skins[captain.traits[2]!] ?? "#ccc", tier: 6, color: captain.color, ph: 0.3 }); }
    else put(THRONE, away.has(1) ? null : frog(1), away.get(1));
    let ring = 0, boss = 0;
    for (const w of snap?.watchers ?? []) {
      if (w.n === 0) continue;
      this.sprites.setWatcher(w.n, w.traits, w.color);
      const o: Occ = { key: `w${w.n}`, kind: "watcher", id: w.n, traits: w.traits, skin: this.sprites.skins[w.traits[2]!] ?? "#ccc", tier: w.tier, color: w.color, ph: (w.n * 0.37) % 1 };
      const seat = w.tier === 5 ? PLINTHS[boss++] : WATCH[ring++];
      if (seat) put(seat, o);
    }
    pods.sort((a, b) => (snap!.frogs[a - 1]!.mission!.since - snap!.frogs[b - 1]!.mission!.since));
    pods.forEach((id, k) => { const seat = PODS[k]; if (seat) put(seat, frog(id)); });
    this.podOverflow = Math.max(0, pods.length - PODS.length);
    this.memorialKey = "";
    this.rebake();
    this.dirty = true;
  }
  private podOverflow = 0;
  private F: Record<string, unknown> = {};
  private jobs: { r: { x: number; y: number; w: number; h: number }; o: Occ; spill: string | null }[] = [];

  setSnapshot(s: Snapshot) {
    const before = this.snap?.watchers.length ?? null;
    this.snap = s;
    if (before !== null && s.watchers.length > before) this.flare = performance.now();
    this.assign();
  }
  /** Where a character is: its seat's world point. */
  seatOf(key: string): Seat | null { const i = this.keyToSeat.get(key); return i === undefined ? null : SEATS[i] ?? null; }

  // ------------------------------------------------------------------ the camera
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality >= 2 ? 2 : 1.5);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.dirty = true;
  }
  private fitZoom() { const [a, b, c, d] = WORLD_BOX; return Math.min(this.w / (c - a), this.h / (d - b)) * 0.96; }
  private minZoom() { return Math.min(0.2, this.fitZoom() * 0.85); }
  /** The whole ship in view. */
  fit(animate = true) {
    const [a, b, c, d] = WORLD_BOX;
    this.goTo((a + c) / 2, (b + d) / 2, this.fitZoom(), animate);
  }
  /** Screen space the page covers (open panels, sheets), in CSS px: framing keeps targets in the rest. */
  inset = { l: 0, r: 0, t: 0, b: 0 };
  private free() { const i = this.inset; return { w: Math.max(120, this.w - i.l - i.r), h: Math.max(120, this.h - i.t - i.b), cx: (i.l + this.w - i.r) / 2, cy: (i.t + this.h - i.b) / 2 }; }
  goTo(x: number, y: number, z: number, animate = true, framed = false) {
    const zz = Math.max(this.minZoom(), Math.min(3.2, z));
    // framed: (x, y) lands in the middle of the free part of the screen, not the middle of the screen
    const f = this.free(), to = framed ? { x: x - (f.cx - this.w / 2) / zz, y: y - (f.cy - this.h / 2) / zz, z: zz } : { x, y, z: zz };
    if (!animate || this.still) { this.cam = to; this.fly = null; this.dirty = true; return; }
    this.fly = { from: { ...this.cam }, to, t0: performance.now(), dur: 950 };
    this.vel = { x: 0, y: 0 };
  }
  /** Flies to a character and frames it in the free part of the screen. */
  focusKey(key: string, z = 1.9) {
    const s = this.seatOf(key);
    if (!s) return false;
    const [x, y] = P(s.x, s.y, s.z + 0.7);
    const f = this.free();
    this.goTo(x, y, Math.min(z, f.h / 150, f.w / 120), true, true);
    return true;
  }
  focusRoom(k: RoomKey) {
    const r = ROOMS.find((q) => q.key === k)!;
    const corners = [P(r.x0, r.y0, 0), P(r.x1, r.y0, 0), P(r.x1, r.y1, 0), P(r.x0, r.y1, 0), P(r.x0, r.y0, WALL)];
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]), f = this.free();
    const z = Math.min(f.w / (Math.max(...xs) - Math.min(...xs) + 80), f.h / (Math.max(...ys) - Math.min(...ys) + 120));
    this.goTo((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, Math.min(2.2, z), true, true);
  }
  /** Frames a set of characters (a wallet's crew). */
  focusKeys(keys: string[]) {
    const pts = keys.map((k) => this.seatOf(k)).filter((s): s is Seat => Boolean(s)).map((s) => P(s.x, s.y, s.z + 0.7));
    if (!pts.length) return;
    if (pts.length === 1) { this.focusKey(keys.find((k) => this.seatOf(k))!); return; }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), f = this.free();
    const z = Math.min(f.w / (Math.max(...xs) - Math.min(...xs) + 240), f.h / (Math.max(...ys) - Math.min(...ys) + 260), 1.9);
    this.goTo((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, z, true, true);
  }
  zoomBy(f: number, sx = this.w / 2, sy = this.h / 2) {
    const z0 = this.cam.z, z1 = Math.max(this.minZoom(), Math.min(3.2, z0 * f));
    // keep the point under the cursor where it is
    const wx = this.cam.x + (sx - this.w / 2) / z0, wy = this.cam.y + (sy - this.h / 2) / z0;
    this.cam = { x: wx - (sx - this.w / 2) / z1, y: wy - (sy - this.h / 2) / z1, z: z1 };
    this.fly = null; this.clamp(); this.dirty = true;
  }
  private clamp() {
    const [a, b, c, d] = WORLD_BOX, m = 120;
    this.cam.x = Math.max(a - m, Math.min(c + m, this.cam.x));
    this.cam.y = Math.max(b - m, Math.min(d + m, this.cam.y));
  }
  toWorld(sx: number, sy: number): [number, number] { return [this.cam.x + (sx - this.w / 2) / this.cam.z, this.cam.y + (sy - this.h / 2) / this.cam.z]; }
  toScreen(wx: number, wy: number): [number, number] { return [(wx - this.cam.x) * this.cam.z + this.w / 2, (wy - this.cam.y) * this.cam.z + this.h / 2]; }

  // ------------------------------------------------------------------ input
  private handlers: [string, EventListener, AddEventListenerOptions?][] = [];
  private bind() {
    const on = <K extends keyof HTMLElementEventMap>(k: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => { this.canvas.addEventListener(k, f as EventListener, o); this.handlers.push([k, f as EventListener, o]); };
    on("pointerdown", (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      this.fly = null; this.vel = { x: 0, y: 0 };
      if (this.pointers.size === 2) {
        const [p, q] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        this.drag = { x: e.offsetX, y: e.offsetY, t: performance.now(), moved: 99, cx: this.cam.x, cy: this.cam.y, pinch: { d: Math.hypot(p.x - q.x, p.y - q.y), z: this.cam.z, mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 } };
      } else this.drag = { x: e.offsetX, y: e.offsetY, t: performance.now(), moved: 0, cx: this.cam.x, cy: this.cam.y };
    });
    on("pointermove", (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (prev) this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      const d = this.drag;
      if (d && prev) {
        if (d.pinch && this.pointers.size >= 2) {
          const [p, q] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
          const dist = Math.hypot(p.x - q.x, p.y - q.y), mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
          const z = Math.max(this.minZoom(), Math.min(3.2, d.pinch.z * (dist / Math.max(1, d.pinch.d))));
          this.zoomBy(z / this.cam.z, mx, my);
          this.cam.x -= (mx - d.pinch.mx) / this.cam.z; this.cam.y -= (my - d.pinch.my) / this.cam.z;
          d.pinch.mx = mx; d.pinch.my = my;
        } else if (!d.pinch) {
          const dx = e.offsetX - prev.x, dy = e.offsetY - prev.y;
          d.moved += Math.abs(dx) + Math.abs(dy);
          this.cam.x -= dx / this.cam.z; this.cam.y -= dy / this.cam.z;
          this.vel = { x: -dx / this.cam.z, y: -dy / this.cam.z };
        }
        this.clamp(); this.dirty = true;
        return;
      }
      if (e.pointerType === "mouse") { this.space.lean = { x: (e.offsetX / this.w) * 2 - 1, y: (e.offsetY / this.h) * 2 - 1 }; }
      if (e.pointerType === "mouse" && performance.now() - this.lastPick > 40) {
        this.lastPick = performance.now();
        const p = this.pick(e.offsetX, e.offsetY);
        if (JSON.stringify(p) !== JSON.stringify(this.hover)) { this.hover = p; this.onHover?.(p); this.canvas.style.cursor = p && p.kind !== "room" ? "pointer" : "grab"; this.dirty = true; }
      }
    });
    const up = (e: PointerEvent) => {
      const d = this.drag;
      this.pointers.delete(e.pointerId);
      if (d && !d.pinch && d.moved < 7 && performance.now() - d.t < 500) this.onPick?.(this.pick(e.offsetX, e.offsetY));
      if (this.pointers.size === 0) { this.drag = null; if (performance.now() - (d?.t ?? 0) > 650) this.vel = { x: 0, y: 0 }; }
      else if (this.pointers.size === 1) { const [p] = [...this.pointers.values()] as [{ x: number; y: number }]; this.drag = { x: p.x, y: p.y, t: performance.now(), moved: 99, cx: this.cam.x, cy: this.cam.y }; }
    };
    on("pointerup", up); on("pointercancel", up);
    on("pointerleave", () => { if (this.hover) { this.hover = null; this.onHover?.(null); this.dirty = true; } });
    on("wheel", (e) => { e.preventDefault(); this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.offsetX, e.offsetY); }, { passive: false });
    on("dblclick", (e) => this.zoomBy(1.8, e.offsetX, e.offsetY));
    on("keydown", (e) => {
      const step = 90 / this.cam.z;
      const k = e.key;
      if (k === "ArrowLeft" || k === "a") this.cam.x -= step; else if (k === "ArrowRight" || k === "d") this.cam.x += step;
      else if (k === "ArrowUp" || k === "w") this.cam.y -= step; else if (k === "ArrowDown" || k === "s") this.cam.y += step;
      else if (k === "+" || k === "=") this.zoomBy(1.25); else if (k === "-" || k === "_") this.zoomBy(0.8);
      else if (k === "0") this.fit(); else return;
      e.preventDefault(); this.fly = null; this.clamp(); this.dirty = true;
    });
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.canvas);
    this.ro = ro;
  }
  private ro: ResizeObserver | null = null;
  private unbind() { for (const [k, f, o] of this.handlers) this.canvas.removeEventListener(k, f, o); this.ro?.disconnect(); }

  /** What is under a screen point: a character, an empty seat, or a room. */
  pick(sx: number, sy: number): Pick | null {
    const [wx, wy] = this.toWorld(sx, sy);
    for (let i = this.ents.length - 1; i >= 0; i--) {
      const e = this.ents[i]!, s = e.seat;
      if (!s) continue;
      const r = this.occRect(s);
      if (wx < r.x + r.w * 0.14 || wx > r.x + r.w * 0.86 || wy < r.y + r.h * 0.08 || wy > r.y + r.h) continue;
      const o = this.occ.get(s.i);
      if (o) return o.kind === "frog" ? { kind: "frog", id: o.id } : { kind: "watcher", n: o.id };
      if (s.kind === "watch" || s.kind === "plinth" || s.kind === "throne" || this.empty.has(s.i)) return { kind: "seat", seat: s.i };
    }
    // else the room the point is in (on the floor plane)
    const fx = (wx / 32 + wy / 16) / 2, fy = (wy / 16 - wx / 32) / 2;
    const r = ROOMS.find((q) => fx >= q.x0 && fx < q.x1 && fy >= q.y0 && fy < q.y1);
    return r ? { kind: "room", station: r.key } : null;
  }
  emptyWhy(seat: number) { return this.empty.get(seat) ?? null; }
  occupant(seat: number) { return this.occ.get(seat) ?? null; }
  get overflow() { return this.podOverflow; }

  private occRect(s: Seat) {
    const sc = SEAT_SCALE[s.kind] ?? 1, [x, y] = P(s.x, s.y, s.z + (SEAT_LIFT[s.kind] ?? 0));
    const w = SW * sc, h = SH * sc;
    return { x: x - w / 2, y: y - h + 2, w, h };
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
        const d = this.dpr;
        const rx = Math.round(px * d), ry = Math.round(py * d);
        c.drawImage(t.c!, rx, ry, Math.round(qx * d) - rx, Math.round(qy * d) - ry);
      }
      return missing;
    };
    // a coarser level underneath while this one fills in
    const fine = () => layer(li, true);
    let fallback = li - 1;
    while (fallback > 0 && !this.covered(fallback, x0, y0, x1, y1)) fallback--;
    if (!this.covered(li, x0, y0, x1, y1)) { layer(Math.max(0, fallback), fallback <= 0); this.dirty = true; }
    const miss = fine();
    if (miss) this.dirty = true;
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

  /**
   * A piece of furniture as a sprite at the current level, packed with the others into one canvas per level so
   * the GPU draws them from a single texture.
   */
  private piece(name: string, p: FPiece | { box: [number, number, number, number]; draw: (c: Ctx) => void }, x: number, y: number, into: CanvasRenderingContext2D = this.c) {
    const li = Math.min(Math.max(2, this.levelIndex()), this.quality >= 2 ? 9 : 8), s = LEVELS[li]!;
    let A = this.packs.get(li);
    if (!A) {
      const cv = document.createElement("canvas"); cv.width = 2048; cv.height = 2048;
      A = { cv, g: cv.getContext("2d")!, at: new Map(), x: 0, y: 0, row: 0 };
      this.packs.set(li, A);
      if (this.packs.size > 2) this.packs.delete(this.packs.keys().next().value!);
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
    this.c.drawImage(cv, x + p.box[0], y + p.box[1], p.box[2] - p.box[0], p.box[3] - p.box[1]);
  }
  private propCache = new Map<string, HTMLCanvasElement>();
  private packs = new Map<number, { cv: HTMLCanvasElement; g: CanvasRenderingContext2D; at: Map<string, [number, number, number, number]>; x: number; y: number; row: number }>();

  // ------------------------------------------------------------------ the frame
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const animating = !this.still || this.fly || Math.abs(this.vel.x) + Math.abs(this.vel.y) > 0.01;
    if (!animating && !this.dirty && this.sprites.pending === 0) return;
    const t0 = performance.now();
    this.step(now);
    this.dirty = false;
    this.sprites.pump(this.quality >= 2 ? 6 : 4);
    this.draw(now / 1000, t0 + 7);
    const dt = performance.now() - t0;
    this.frames.push(now); this.work.push(dt);
    while (this.frames.length && now - this.frames[0]! > 1000) { this.frames.shift(); this.work.shift(); }
    this.stats.fps = this.frames.length; this.stats.frameMs = this.work.reduce((a, b) => a + b, 0) / Math.max(1, this.work.length);
    this.stats.quality = this.quality; this.stats.zoom = this.cam.z; this.stats.sprites = this.sprites.readyCount;
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
  private step(now: number) {
    if (this.fly) {
      const f = this.fly, k = Math.min(1, (now - f.t0) / f.dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const z = f.from.z * Math.pow(f.to.z / f.from.z, e);
      this.cam = { x: f.from.x + (f.to.x - f.from.x) * e, y: f.from.y + (f.to.y - f.from.y) * e, z };
      if (k >= 1) this.fly = null;
      this.dirty = true;
    } else if (!this.drag && Math.abs(this.vel.x) + Math.abs(this.vel.y) > 0.01) {
      this.cam.x += this.vel.x; this.cam.y += this.vel.y; this.vel.x *= 0.9; this.vel.y *= 0.9; this.clamp(); this.dirty = true;
    }
  }

  private draw(t: number, budgetEnd: number) {
    const c = this.c, d = this.dpr, z = this.cam.z;
    const tt = this.still ? 0 : t;
    const F = ((window as unknown as { __shipFlags?: Record<string, unknown> }).__shipFlags ?? {}) as Record<string, unknown>;
    c.setTransform(d, 0, 0, d, 0, 0);
    if (!F.noSpace) this.space.draw(c, this.w, this.h, d, this.cam.x, this.cam.y, z, tt, this.still);
    else { c.fillStyle = "#03020a"; c.fillRect(0, 0, this.w, this.h); }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = (F.smooth as ImageSmoothingQuality) ?? "low";
    if (!F.noTiles) this.drawTiles(c, budgetEnd);
    this.F = F;
    // far out, the seated crew is painted into tiles too (it does not move); live effects go on top
    const baked = !F.noBake && z < 0.95 && this.sprites.pending === 0 && this.drawCrewTiles(c, budgetEnd);
    this.stats.baked = baked;
    c.setTransform(d * z, 0, 0, d * z, d * (this.w / 2 - this.cam.x * z), d * (this.h / 2 - this.cam.y * z));
    const [x0, y0] = this.toWorld(-40, -60), [x1, y1] = this.toWorld(this.w + 40, this.h + 160);
    this.lightsUnder(c, tt);
    this.drawMemorial(c);
    const devH = SH * z * d;
    const fxOn = this.quality >= 1 && devH > 22, big = devH > 70;
    let drawn = 0;
    this.jobs.length = 0;
    for (const e of this.ents) {
      if (e.box[2] < x0 || e.box[0] > x1 || e.box[3] < y0 || e.box[1] > y1) continue;
      drawn++;
      if (e.prop) { if (!baked) { const [px, py] = P(e.prop.x, e.prop.y, e.prop.z); this.propSprite(e.prop.key, e.prop, px, py); } if (!F.noFx) this.propFx(c, e.prop.key, tt); continue; }
      if (!F.noSeats) this.drawSeat(c, e.seat!, tt, devH, fxOn && !F.noFx, big, baked && !LIVE.has(e.seat!.kind) ? "overlay" : "live");
    }
    this.stats.drawn = drawn;
    // the characters' light and trait effects, over the scene in one pass
    const prev = c.globalCompositeOperation;
    const fine = this.quality >= 2 || big;
    for (const j of this.jobs) if (fine) fxSolid(c, j.r, j.o.traits, tt, j.o.ph, big);
    c.globalCompositeOperation = "lighter";
    for (const j of this.jobs) {
      if (j.spill) glow(c, j.r.x + j.r.w / 2, j.r.y + j.r.h * 0.74, j.r.w * 0.42, j.spill, 0.22, 0.6);
      if (fine) fxLight(c, j.r, j.o.traits, tt, j.o.ph, big);
    }
    c.globalCompositeOperation = prev;
    for (const j of this.jobs) if (j.o.kind === "watcher") watcherFront(c, j.r, j.o.tier, j.o.color, tt, j.o.ph);
    this.overFx(c, tt);
    c.setTransform(d, 0, 0, d, 0, 0);
    this.drawLabels(c, tt);
    this.grade(c);
  }

  /**
   * One seat: its back piece, its character, its front piece. "live" draws it all now; "bake" draws it still into
   * a crew tile; "overlay" adds only what moves (markers, effects) over its baked tile.
   */
  private drawSeat(c: CanvasRenderingContext2D, s: Seat, t: number, devH: number, fxOn: boolean, big: boolean, mode: "live" | "bake" | "overlay" = "live") {
    const [bx, by] = P(s.x, s.y, s.z);
    const o = this.occ.get(s.i);
    const key = o ? String(o.key) : "";
    const dim = o && this.match ? !this.match(key) : this.match !== null && !o;
    if (mode === "overlay") {
      if (!o) return;
      const r = this.occRect(s), sel = this.selected === key;
      if (this.crew.has(key) || sel) this.marker(c, s, sel ? "#ffffff" : "#b8ff4a", t);
      else if (this.match && !dim) this.found(c, s);
      if (this.isHover(o) && !sel) disc(c, s.x, s.y, s.z, 0.55, null, "rgba(255,255,255,.6)", 1.5 / this.cam.z);
      if (fxOn && !dim) this.jobs.push({ r, o, spill: SPILL[s.kind] ?? null });
      return;
    }
    if (dim) c.globalAlpha = 0.22;
    // an open Night Watch seat waits, dimmed
    else if (!o && s.kind === "watch") c.globalAlpha = 0.5;
    const back = BACK[s.kind];
    if (s.kind === "watch" || s.kind === "plinth" || s.kind === "throne") this.seatGlow(c, s, o ?? null, t);
    if (back && !this.F.noPieces) this.piece(`b:${s.kind}`, back, bx, by, c);
    if (o) {
      const r = this.occRect(s);
      const bob = this.still || mode === "bake" ? 0 : Math.sin(t * 1.7 + o.ph * 6.28) * 0.7;
      r.y += bob;
      const sel = this.selected === key;
      if (mode === "live" && (this.crew.has(key) || sel)) this.marker(c, s, sel ? "#ffffff" : "#b8ff4a", t);
      else if (mode === "live" && this.match && !dim) this.found(c, s);
      if (o.kind === "watcher" && fxOn) watcherBack(c, r, o.tier, o.color, t, o.ph);
      if (!this.F.noSprites) this.sprites.draw(c, o.key, r.x, r.y, r.w, r.h, mode === "bake" ? devH * (r.h / SH) : r.h * this.cam.z * this.dpr, o.skin);
      if (mode === "live") {
        if (fxOn && !dim && !this.still) blink(c, r, o.traits[4]!, o.skin, t, o.ph);
        if (fxOn && !dim) this.jobs.push({ r, o, spill: SPILL[s.kind] ?? null });
        if (this.isHover(o) && !sel) disc(c, s.x, s.y, s.z, 0.55, null, "rgba(255,255,255,.6)", 1.5 / this.cam.z);
      }
    }
    const front = FRONT[s.kind];
    if (front && !this.F.noPieces) this.piece(`f:${s.kind}`, front, bx, by, c);
    if (!o && this.empty.has(s.i) && devH > 30) {
      // the seat of a frog that is away: a small tag where it sits
      const why = this.empty.get(s.i)!;
      c.fillStyle = why.startsWith("forged") ? "rgba(255,122,61,.75)" : "rgba(184,255,74,.75)";
      c.beginPath(); c.arc(bx, by - 18, 2.2, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
  }

  private isHover(o: Occ) { const h = this.hover; return Boolean(h && ((h.kind === "frog" && o.kind === "frog" && h.id === o.id) || (h.kind === "watcher" && o.kind === "watcher" && h.n === o.id))); }

  // ------------------------------------------------------------------ the baked crew layer
  private crewTiles = new Map<string, HTMLCanvasElement>();
  private crewLevel = -1;
  /** Throws away the baked crew (the seats changed, a filter, the art finished loading). */
  rebake() { this.crewTiles.clear(); this.dirty = true; }
  private renderCrewTile(li: number, tx: number, ty: number): HTMLCanvasElement {
    const s = LEVELS[li]!, cv = document.createElement("canvas");
    cv.width = cv.height = TS;
    const g = cv.getContext("2d")!;
    const wx = (tx * TS) / s, wy = (ty * TS) / s, ww = TS / s;
    g.setTransform(s, 0, 0, s, -wx * s, -wy * s);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "medium";
    for (const e of this.ents) {
      if (e.box[2] < wx || e.box[0] > wx + ww || e.box[3] < wy || e.box[1] > wy + ww) continue;
      if (e.prop) { const [px, py] = P(e.prop.x, e.prop.y, e.prop.z); g.save(); g.translate(px, py); e.prop.draw(g); g.restore(); continue; }
      if (!LIVE.has(e.seat!.kind)) this.drawSeat(g, e.seat!, 0, SH * s, false, false, "bake");
    }
    return cv;
  }
  /** Draws the baked crew for the view; false when some of it is not baked yet (then the frame draws it live). */
  private drawCrewTiles(c: CanvasRenderingContext2D, budgetEnd: number): boolean {
    const li = this.levelIndex();
    if (li !== this.crewLevel) { this.crewLevel = li; this.crewTiles.clear(); }
    const s = LEVELS[li]!, span = TS / s;
    const [x0, y0] = this.toWorld(-40, -60), [x1, y1] = this.toWorld(this.w + 40, this.h + 160);
    const [A, B, C, D] = WORLD_BOX;
    const want: [number, number, string][] = [];
    for (let ty = Math.floor(Math.max(y0, B) / span); ty <= Math.floor(Math.min(y1, D) / span); ty++) for (let tx = Math.floor(Math.max(x0, A) / span); tx <= Math.floor(Math.min(x1, C) / span); tx++) want.push([tx, ty, `${tx}:${ty}`]);
    let ready = true;
    for (const [tx, ty, k] of want) if (!this.crewTiles.has(k)) { if (performance.now() < budgetEnd) this.crewTiles.set(k, this.renderCrewTile(li, tx, ty)); else ready = false; }
    if (!ready) { this.dirty = true; return false; }
    const d = this.dpr;
    for (const [tx, ty, k] of want) {
      const [px, py] = this.toScreen(tx * span, ty * span), [qx, qy] = this.toScreen((tx + 1) * span, (ty + 1) * span);
      const rx = Math.round(px * d), ry = Math.round(py * d);
      c.drawImage(this.crewTiles.get(k)!, rx, ry, Math.round(qx * d) - rx, Math.round(qy * d) - ry);
    }
    return true;
  }

  private seatGlow(c: CanvasRenderingContext2D, s: Seat, o: Occ | null, t: number) {
    const col = s.kind === "plinth" ? "#ffc46b" : s.kind === "throne" ? "#e9e4ff" : o ? o.color : "#4ad8ff";
    const on = o?.kind === "watcher" ? this.onWatch(o.id) : s.kind === "throne" && this.snap?.captain.watch.online;
    const k = o ? (on ? 0.9 + 0.1 * Math.sin(t * 3) : 0.55) : 0.25;
    disc(c, s.x, s.y, s.z, s.kind === "throne" ? 1.1 : 0.62, alpha(col, 0.1 * k), alpha(col, 0.7 * k), 1.4);
    if (!o && s.kind === "watch") {
      // an open seat: its number on the floor
      const [x, y] = P(s.x, s.y, s.z);
      c.fillStyle = "rgba(74,216,255,.35)"; c.font = "600 7px 'JetBrains Mono', monospace"; c.textAlign = "center";
      c.fillText(String(WATCH.indexOf(s) + 1), x, y + 3);
    }
    if (!o && s.kind === "plinth" && this.cam.z > 0.9) {
      const [x, y] = P(s.x, s.y, s.z);
      c.fillStyle = "rgba(255,196,107,.8)"; c.font = "700 6px 'JetBrains Mono', monospace"; c.textAlign = "center";
      c.fillText("NIGHT BOSS", x, y - 18); c.fillStyle = "rgba(255,196,107,.5)"; c.fillText("NOT FORGED YET", x, y - 11);
    }
  }
  private onWatch(n: number) { return Boolean(this.snap?.watchers.find((w) => w.n === n)?.watch.online); }

  /** A filter's match: a ring of the station's light under it. */
  private found(c: CanvasRenderingContext2D, s: Seat) {
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    const [x, y] = P(s.x, s.y, s.z);
    glow(c, x, y, 46, "#4ad8ff", 0.5, 0.5);
    disc(c, s.x, s.y, s.z, 0.62, null, "rgba(160,240,255,.8)", 1.5 / Math.max(0.4, this.cam.z));
    c.globalCompositeOperation = prev;
  }
  private marker(c: CanvasRenderingContext2D, s: Seat, col: string, t: number) {
    const k = this.still ? 1 : 0.75 + 0.25 * Math.sin(t * 4);
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    disc(c, s.x, s.y, s.z, 0.72, alpha(col, 0.16 * k), alpha(col, 0.95 * k), 2 / Math.max(0.4, this.cam.z));
    const [x, y] = P(s.x, s.y, s.z);
    glow(c, x, y, 56, col, 0.4 * k, 0.5);
    c.globalCompositeOperation = prev;
  }

  // ------------------------------------------------------------------ live light and machines
  private lightsUnder(c: CanvasRenderingContext2D, t: number) {
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    const fglow = (x: number, y: number, z: number, r: number, col: string, a: number) => { const [px, py] = P(x, y, z); glow(c, px, py, r * RX, col, a * 1.6, 0.5); };
    fglow(RADAR.x, RADAR.y, 0.5, 7.5, "#4ad8ff", 0.13 + 0.03 * Math.sin(t * 1.3));
    fglow(REACTOR.x, REACTOR.y, 0, 10, "#ffb547", 0.12 + 0.05 * Math.sin(t * 2.1));
    fglow(REACTOR.x, REACTOR.y, 0, 6, "#3fe6ff", 0.12 + 0.06 * Math.sin(t * 3.3 + 1));
    for (const [x, y] of DRIVE) fglow(x, y, 0, 3.2, "#8b6cff", 0.12 + 0.05 * Math.sin(t * 2.6 + x));
    const fl = 0.16 + 0.06 * Math.sin(t * 7.3) * Math.sin(t * 3.1) + (this.flare ? Math.max(0, 1 - (performance.now() - this.flare) / 4000) * 0.4 : 0);
    fglow(FURNACE.x + 1.4, FURNACE.y + 1.4, 0, 8, "#ff6a2a", fl);
    fglow(THRONE.x, THRONE.y, 0.5, 2.4, "#e9e4ff", 0.1);
    c.globalCompositeOperation = prev;
  }

  private propFx(c: CanvasRenderingContext2D, key: string, t: number) {
    const prev = c.globalCompositeOperation;
    if (key === "radar") this.radar(c, t);
    else if (key === "furnace") this.furnaceFx(c, t);
    else if (key === "reactor") {
      // the plasma column in the glass, bands of light climbing it, the glow round the chamber
      c.globalCompositeOperation = "lighter";
      const R = REACTOR.r * 0.6, k = 0.75 + 0.25 * Math.sin(t * 2.4);
      const [x0, top] = P(REACTOR.x, REACTOR.y, 4.35), [, bot] = P(REACTOR.x, REACTOR.y, 1.45);
      const w = R * RX * 0.42;
      const g = c.createLinearGradient(x0 - w, 0, x0 + w, 0);
      g.addColorStop(0, "rgba(63,230,255,0)"); g.addColorStop(0.3, `rgba(63,230,255,${0.35 * k})`); g.addColorStop(0.5, `rgba(220,255,255,${0.85 * k})`); g.addColorStop(0.7, `rgba(63,230,255,${0.35 * k})`); g.addColorStop(1, "rgba(63,230,255,0)");
      c.fillStyle = g; c.fillRect(x0 - w, top, w * 2, bot - top);
      glow(c, x0, (top + bot) / 2, R * RX * 1.15, "#3fe6ff", 0.32 * k, 1.25);
      for (let i = 0; i < 4; i++) {
        const p = (t * 0.32 + i / 4) % 1, z = 1.5 + p * 2.8, [, py] = P(REACTOR.x, REACTOR.y, z);
        c.strokeStyle = `rgba(170,250,255,${0.7 * Math.sin(p * Math.PI)})`; c.lineWidth = 1.6;
        c.beginPath(); c.ellipse(x0, py, R * RX * 0.92, R * RY * 0.92, 0, 0, Math.PI * 2); c.stroke();
      }
      const [, ry] = P(REACTOR.x, REACTOR.y, 5.45);
      glow(c, x0, ry, 70, "#ffc46b", 0.35 * k, 0.6);
    } else if (key.startsWith("drive")) {
      c.globalCompositeOperation = "lighter";
      const [x, y] = DRIVE[Number(key.slice(5))]!;
      for (let k = 0; k < 5; k++) {
        const a = 0.25 + 0.6 * Math.max(0, Math.sin(t * 3.2 - k * 0.8 + x));
        const [px, py] = P(x, y, 0.83 + k * 0.62);
        c.strokeStyle = `rgba(160,130,255,${a})`; c.lineWidth = 2;
        c.beginPath(); c.ellipse(px, py, 1.06 * RX, 1.06 * RY, 0, 0, Math.PI); c.stroke();
      }
      const [tx, ty] = P(x, y, 4.3);
      glow(c, tx, ty, 34, "#a48bff", 0.5 + 0.2 * Math.sin(t * 5 + x));
    } else if (key === "coffee" && !this.still) {
      for (let k = 0; k < 3; k++) { const p = (t / 2.6 + k / 3) % 1; const [x, y] = P(1.25, 37.15, 1.75); c.fillStyle = `rgba(240,230,255,${0.25 * Math.sin(p * Math.PI)})`; c.beginPath(); c.ellipse(x + Math.sin(p * 5 + k) * 4, y - p * 40, 5 + p * 7, 6 + p * 8, 0, 0, Math.PI * 2); c.fill(); }
    }
    c.globalCompositeOperation = prev;
  }

  /** The Night Watch radar: every open imdUSD loan as a blip, nearer the centre the closer it is to liquidation. */
  private radar(c: CanvasRenderingContext2D, t: number) {
    const z = 0.5 + 0.5 + 0.42, R = RADAR.r * 0.94;
    const [cx, cy] = P(RADAR.x, RADAR.y, z);
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    // the beam up from the pedestal
    const [bx, by] = P(RADAR.x, RADAR.y, 1.0);
    c.fillStyle = c.createLinearGradient(0, by, 0, cy);
    (c.fillStyle as CanvasGradient).addColorStop(0, "rgba(74,216,255,.18)"); (c.fillStyle as CanvasGradient).addColorStop(1, "rgba(74,216,255,.02)");
    c.beginPath(); c.moveTo(bx - R * RX * 0.32, by); c.lineTo(cx - R * RX, cy); c.lineTo(cx + R * RX, cy); c.lineTo(bx + R * RX * 0.32, by); c.closePath(); c.fill();
    c.save(); c.translate(cx, cy); c.scale(1, RY / RX);
    const rr = R * RX;
    c.fillStyle = rad(c, 0, 0, rr, [[0, "rgba(74,216,255,.10)"], [1, "rgba(74,216,255,.03)"]]); c.beginPath(); c.arc(0, 0, rr, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(74,216,255,.55)"; c.lineWidth = 1.4; c.beginPath(); c.arc(0, 0, rr, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = "rgba(74,216,255,.2)"; c.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) { c.beginPath(); c.arc(0, 0, rr * f, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.moveTo(-rr, 0); c.lineTo(rr, 0); c.moveTo(0, -rr); c.lineTo(0, rr); c.stroke();
    const radar = this.snap?.radar;
    // the liquidation line (the vault's mat) in red
    const at = (cr: number) => Math.max(0.05, Math.min(1, Math.log(cr / 100) / Math.log(6)));
    if (radar) { c.strokeStyle = "rgba(255,80,110,.65)"; c.lineWidth = 1.4; c.setLineDash([3, 3]); c.beginPath(); c.arc(0, 0, rr * at(radar.mat), 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
    // the sweep
    const sweep = this.still ? -0.6 : (t * Math.PI * 2) / 4.5;
    for (let k = 0; k < 14; k++) {
      c.fillStyle = `rgba(74,216,255,${0.2 * (1 - k / 14)})`;
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, rr, sweep - (k + 1) * 0.06, sweep - k * 0.06); c.closePath(); c.fill();
    }
    c.strokeStyle = "rgba(160,240,255,.9)"; c.lineWidth = 1.4; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(sweep) * rr, Math.sin(sweep) * rr); c.stroke();
    if (radar) for (const l of radar.loans) {
      // blips: in the floor plane, placed by the loan's bearing and collateral ratio
      const a = (l.a * Math.PI) / 180, d = at(l.cr) * rr;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      let since = (sweep - a) % (Math.PI * 2); if (since < 0) since += Math.PI * 2;
      const lit = this.still ? 0.8 : 0.3 + 0.7 * Math.exp(-since / 1.6);
      const col = l.state === "actionable" ? "255,60,90" : l.state === "grace" ? "255,92,168" : l.cr < radar.mat * 1.15 ? "255,196,107" : "120,255,200";
      const s = 1.6 + Math.min(4, Math.sqrt(l.debt) / 9);
      c.fillStyle = `rgba(${col},${0.25 * lit})`; c.beginPath(); c.arc(x, y, s * 2.6, 0, Math.PI * 2); c.fill();
      c.fillStyle = `rgba(${col},${lit})`; c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    c.globalCompositeOperation = prev;
    if (this.cam.z > 0.7) {
      c.font = "600 8px 'JetBrains Mono', monospace"; c.textAlign = "center";
      c.fillStyle = radar ? "rgba(160,240,255,.85)" : "rgba(255,200,120,.85)";
      c.fillText(radar ? `IMDUSD VAULT · ${radar.loans.length} LOANS` : "RADAR OFFLINE · NO VAULT READ YET", cx, cy + R * RY + 14);
      if (radar) { c.fillStyle = "rgba(255,110,130,.85)"; c.fillText(`${radar.mat}% LIQUIDATION LINE`, cx, cy + R * RY + 24); }
    }
  }

  private furnaceFx(c: CanvasRenderingContext2D, t: number) {
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    const [m, n] = P(FURNACE.x + 1.0, FURNACE.y + 1.0, 0.25);
    const f = 0.75 + 0.25 * Math.sin(t * 9) * Math.sin(t * 4.3), flare = this.flare ? Math.max(0, 1 - (performance.now() - this.flare) / 4000) : 0;
    // inside the arch: the fire
    c.save();
    c.beginPath(); c.moveTo(m - 36, n); c.lineTo(m - 36, n - 29); c.quadraticCurveTo(m, n - 60, m + 36, n - 29); c.lineTo(m + 36, n); c.closePath(); c.clip();
    const fire = c.createLinearGradient(0, n - 50, 0, n);
    fire.addColorStop(0, `rgba(255,80,20,${0.5 * f})`); fire.addColorStop(0.6, `rgba(255,170,60,${0.9 * f})`); fire.addColorStop(1, `rgba(255,240,190,${f})`);
    c.fillStyle = fire; c.fillRect(m - 36, n - 60, 72, 60);
    for (let k = 0; k < 6; k++) {
      const ph = t * (3 + k * 0.4) + k * 1.7, hgt = 26 + 14 * Math.sin(ph), x = m - 28 + k * 11 + Math.sin(ph * 1.3) * 3;
      c.fillStyle = `rgba(255,250,210,${0.55 + 0.3 * Math.sin(ph)})`;
      c.beginPath(); c.moveTo(x - 6, n); c.quadraticCurveTo(x - 4, n - hgt * 0.6, x + Math.sin(ph) * 3, n - hgt); c.quadraticCurveTo(x + 4, n - hgt * 0.6, x + 6, n); c.closePath(); c.fill();
    }
    c.restore();
    glow(c, m, n - 20, 90 + flare * 80, "#ff7a2a", (0.55 + flare * 0.4) * f);
    glow(c, m, n - 14, 40, "#ffe0a0", 0.5 * f);
    // the molten channel glows
    const [cx2, cy2] = P(FURNACE.x + 2.0, FURNACE.y + 2.0, 0);
    glow(c, cx2, cy2, 40, "#ff6a1a", 0.6 * f, 0.5);
    // embers from the chimney
    const [h0, h1] = P(FURNACE.x - 0.3, FURNACE.y - 0.3, 2.3);
    if (!this.still) for (let k = 0; k < 10; k++) { const p = (t / 2.2 + k * 0.1) % 1; c.fillStyle = `rgba(255,${150 + k * 8},60,${Math.sin(p * Math.PI)})`; c.fillRect(h0 - 8 + ((k * 13) % 16) + Math.sin(p * 9 + k) * 6, h1 - 72 - p * 90, 2, 2); }
    c.globalCompositeOperation = prev;
    // the newest Night Watcher, as a hologram above the furnace
    const latest = [...(this.snap?.watchers ?? [])].sort((a, b) => b.forgedAt - a.forgedAt)[0];
    if (latest) {
      const key = `w${latest.n}` as SpriteKey;
      const [hx, hy] = P(FURNACE.x + 1.9, FURNACE.y + 1.9, 2.4);
      const w = SW * 1.5, h = SH * 1.5, k = this.still ? 1 : 0.8 + 0.2 * Math.sin(t * 2);
      c.globalAlpha = 0.55 * k;
      this.sprites.draw(c, key, hx - w / 2, hy - h + Math.sin(t * 1.2) * 2, w, h, h * this.cam.z * this.dpr, "#888");
      c.globalAlpha = 1;
      c.globalCompositeOperation = "lighter";
      c.fillStyle = alpha(latest.color, 0.12); c.fillRect(hx - w / 2, hy - h, w, h);
      for (let y = hy - h; y < hy; y += 3) { c.fillStyle = alpha(latest.color, 0.06); c.fillRect(hx - w / 2, y, w, 1); }
      c.globalCompositeOperation = prev;
      if (this.cam.z > 0.8) { c.font = "600 7px 'JetBrains Mono', monospace"; c.textAlign = "center"; c.fillStyle = alpha(latest.color, 0.95); c.fillText(`NEWEST · NIGHT WATCHER #${latest.n} · ${latest.tierName.toUpperCase()}`, hx, hy + 9); }
    }
  }

  /** The forge's memorial wall: every frog it burned, by the Night Watcher it went into. */
  private drawMemorial(c: CanvasRenderingContext2D) {
    const snap = this.snap;
    if (!snap) return;
    const forged = [...snap.watchers].sort((a, b) => a.n - b.n);
    const key = `${forged.map((w) => w.n).join(",")}|${this.sprites.readyCount}`;
    const y0 = 77.0, len = 10, top = WALL - 1.25;
    if (key !== this.memorialKey) {
      this.memorialKey = key;
      // drawn at 2x for crispness; each forge a plaque: its Night Watcher and the 10 frogs it burned
      const pw = 160, cv = document.createElement("canvas"); cv.width = len * pw; cv.height = 1.75 * pw;
      const g = cv.getContext("2d")!;
      g.textAlign = "center";
      g.font = "700 15px 'JetBrains Mono', monospace"; g.fillStyle = "rgba(255,150,90,.95)"; g.fillText("FORGED INTO THE NIGHT WATCH", cv.width / 2, 20);
      if (!forged.length) { g.fillStyle = "rgba(255,150,90,.55)"; g.fillText("No frog forged yet", cv.width / 2, 140); }
      const n = Math.max(1, forged.length), colW = Math.min(520, (cv.width - 24) / n);
      const f = Math.min(80, (colW - 26) / 5 - 6, (cv.height - 84) / 2 - 18);
      forged.forEach((w, i) => {
        const x = 12 + i * colW + (colW - (5 * (f + 6) + 14)) / 2 * (n === 1 ? 1 : 0);
        const pwid = 5 * (f + 6) + 14;
        g.fillStyle = "rgba(40,16,12,.75)"; g.fillRect(x, 32, Math.min(pwid, colW - 8), cv.height - 40);
        g.strokeStyle = alpha(w.color, 0.7); g.lineWidth = 2; g.strokeRect(x, 32, Math.min(pwid, colW - 8), cv.height - 40);
        g.font = "700 14px 'JetBrains Mono', monospace"; g.fillStyle = alpha(w.color, 1);
        g.fillText(w.n === 0 ? "THE CAPTAIN" : `NIGHT WATCHER #${w.n}`, x + Math.min(pwid, colW - 8) / 2, 52);
        const ids = w.n === 0 ? [1] : w.inputs;
        ids.forEach((id, j) => {
          const cx = x + 10 + (j % 5) * (f + 6), cy = 62 + Math.floor(j / 5) * (f + 20);
          if (f >= 14) {
            g.globalAlpha = 0.9; g.filter = "grayscale(1) sepia(.55) brightness(1.05)";
            this.sprites.draw(g as unknown as CanvasRenderingContext2D, id, cx, cy, f, f * (870 / 920), 60, "#8a6a5a");
            g.filter = "none"; g.globalAlpha = 1;
          }
          g.fillStyle = "rgba(255,190,150,.95)"; g.font = `600 ${f >= 14 ? 12 : 11}px 'JetBrains Mono', monospace`;
          g.fillText(`#${id}`, cx + f / 2, cy + (f >= 14 ? f * 0.95 + 13 : 10));
        });
      });
      this.memorial = cv;
    }
    if (!this.memorial) return;
    // left to right on screen is toward the bow: the decal starts at its stern end
    const [ox, oy] = P(0.02, y0 + len, top);
    c.save();
    c.transform(32 / 160, -16 / 160, 0, 32 / 160, ox, oy);
    c.drawImage(this.memorial, 0, 0);
    c.restore();
  }

  private overFx(c: CanvasRenderingContext2D, t: number) {
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    // the engines' exhaust, out of the stern
    for (const ex of [6, 16, 26]) {
      const [nx, ny] = P(ex, L + 6.3, -0.9);
      const f = this.still ? 1 : 0.85 + 0.15 * Math.sin(t * 13 + ex) * Math.sin(t * 5.1);
      for (let k = 0; k < 7; k++) {
        const d = k * 0.9, [px, py] = P(ex, L + 6.3 + d, -0.9), s = 1 - k / 8;
        c.fillStyle = rad(c, px, py, 70 * s, [[0, `rgba(170,240,255,${0.34 * s * f})`], [0.4, `rgba(74,160,255,${0.18 * s * f})`], [1, "rgba(74,120,255,0)"]]);
        c.beginPath(); c.ellipse(px, py, 70 * s, 54 * s, -0.46, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = rad(c, nx, ny, 50, [[0, `rgba(240,255,255,${0.85 * f})`], [0.5, `rgba(120,220,255,${0.4 * f})`], [1, "rgba(80,160,255,0)"]]);
      c.beginPath(); c.ellipse(nx, ny, 46, 40, -0.46, 0, Math.PI * 2); c.fill();
    }
    // navigation lights: red port, green starboard, white at the mast
    const blinkOn = this.still || (t % 1.6) < 0.2;
    if (blinkOn) {
      for (const [x, y, z, col] of [[-11, 58.5, -0.3, "255,70,90"], [43.4, 62.2, -0.8, "90,255,140"], [-1.2, -1.2, 9.05, "255,255,255"]] as const) {
        const [px, py] = P(x, y, z); c.fillStyle = rad(c, px, py, 24, [[0, `rgba(${col},.95)`], [0.25, `rgba(${col},.4)`], [1, `rgba(${col},0)`]]); c.beginPath(); c.arc(px, py, 24, 0, Math.PI * 2); c.fill();
      }
    }
    c.globalCompositeOperation = prev;
    // the crew out on missions beyond the pods
    if (this.podOverflow > 0 && this.cam.z > 0.5) {
      const p = PODS[PODS.length - 1]!; const [x, y] = P(p.x, p.y + 1.2, 0);
      c.font = "700 9px 'JetBrains Mono', monospace"; c.textAlign = "center"; c.fillStyle = "#b8ff4a"; c.fillText(`+${this.podOverflow} MORE OUT`, x, y);
    }
    void sparkle;
  }

  // ------------------------------------------------------------------ labels and grading, in CSS px
  private drawLabels(c: CanvasRenderingContext2D, t: number) {
    const z = this.cam.z;
    c.textBaseline = "middle";
    for (const r of ROOMS) {
      const lab = this.labels[r.key];
      if (!lab) continue;
      const [wx, wy] = P(r.label[0], r.label[1], r.key === "bridge" ? 4.4 : r.key === "engine" ? 6.9 : r.key === "forge" ? 6.7 : r.key === "drive" ? 5.3 : 3.2);
      const [x, y] = this.toScreen(wx, wy);
      if (x < -200 || x > this.w + 200 || y < -60 || y > this.h + 60) continue;
      const s = Math.max(0.78, Math.min(1.05, 0.7 + z * 0.4));
      // up close the room speaks for itself: its label fades back
      c.globalAlpha = Math.max(0.22, Math.min(1, 1.5 - z * 0.8));
      c.font = `700 ${Math.round(11 * s)}px 'JetBrains Mono', ui-monospace, monospace`;
      const tw = Math.max(c.measureText(lab.title).width, (c.font = `500 ${Math.round(10 * s)}px 'JetBrains Mono', ui-monospace, monospace`, c.measureText(lab.line).width));
      const pw = tw + 24, ph = 34 * s;
      c.fillStyle = "rgba(6,5,16,.72)"; c.beginPath(); c.roundRect(x - pw / 2, y - ph / 2, pw, ph, 4); c.fill();
      c.strokeStyle = alpha(r.accent, 0.5); c.lineWidth = 1; c.stroke();
      c.fillStyle = r.accent; c.fillRect(x - pw / 2, y - ph / 2 + 4, 2, ph - 8);
      c.textAlign = "center";
      c.font = `700 ${Math.round(11 * s)}px 'JetBrains Mono', ui-monospace, monospace`; c.fillStyle = "#f3f1ff"; c.fillText(lab.title, x, y - 7 * s);
      c.font = `500 ${Math.round(10 * s)}px 'JetBrains Mono', ui-monospace, monospace`; c.fillStyle = alpha(r.accent, 0.95); c.fillText(lab.line, x, y + 8 * s);
      c.globalAlpha = 1;
    }
    // tags over the wallet's crew, the selected and the hovered character
    const tags = new Set<string>([...this.crew]);
    if (this.selected) tags.add(this.selected);
    const hk = this.hover?.kind === "frog" ? String(this.hover.id) : this.hover?.kind === "watcher" ? `w${this.hover.n}` : null;
    if (hk) tags.add(hk);
    if (tags.size > 60 && z < 0.9) return;
    c.font = "700 10px 'JetBrains Mono', ui-monospace, monospace"; c.textAlign = "center";
    for (const k of tags) {
      const s = this.seatOf(k);
      if (!s) continue;
      const r = this.occRect(s);
      const [x, y] = this.toScreen(r.x + r.w / 2, r.y);
      if (x < -40 || x > this.w + 40 || y < -20 || y > this.h + 20) continue;
      const label = k.startsWith("w") ? (k === "w0" ? "THE CAPTAIN" : `NW #${k.slice(1)}`) : `#${k}`;
      const w = c.measureText(label).width + 10, bob = this.still ? 0 : Math.sin(t * 3) * 1.5;
      const col = k === this.selected ? "#ffffff" : this.crew.has(k) ? "#b8ff4a" : "#e9e4ff";
      c.fillStyle = "rgba(6,5,16,.85)"; c.beginPath(); c.roundRect(x - w / 2, y - 22 + bob, w, 15, 3); c.fill();
      c.strokeStyle = col; c.lineWidth = 1; c.stroke();
      c.fillStyle = col; c.fillText(label, x, y - 14 + bob);
      c.beginPath(); c.moveTo(x - 3, y - 7 + bob); c.lineTo(x + 3, y - 7 + bob); c.lineTo(x, y - 3 + bob); c.fill();
    }
  }

  private gradeCv: HTMLCanvasElement | null = null; private gradeKey = "";
  private grade(c: CanvasRenderingContext2D) {
    // the shift's light, by the hour in UTC: night 22-06, day 06-14, swing 14-22
    const h = new Date().getUTCHours(), shift = h >= 22 || h < 6 ? "night" : h < 14 ? "day" : "swing";
    const key = `${this.w}x${this.h}:${shift}`;
    if (key !== this.gradeKey) {
      this.gradeKey = key;
      const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(this.w / 3)); cv.height = Math.max(1, Math.round(this.h / 3));
      const g = cv.getContext("2d")!;
      const v = g.createRadialGradient(cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.35, cv.width / 2, cv.height / 2, Math.max(cv.width, cv.height) * 0.75);
      v.addColorStop(0, "rgba(3,2,10,0)"); v.addColorStop(1, shift === "night" ? "rgba(6,3,24,.62)" : shift === "day" ? "rgba(3,2,10,.42)" : "rgba(14,6,10,.5)");
      g.fillStyle = v; g.fillRect(0, 0, cv.width, cv.height);
      if (shift === "day") { g.fillStyle = "rgba(255,230,200,.03)"; g.fillRect(0, 0, cv.width, cv.height); }
      if (shift === "swing") { g.fillStyle = "rgba(255,150,80,.035)"; g.fillRect(0, 0, cv.width, cv.height); }
      if (shift === "night") { g.fillStyle = "rgba(60,40,160,.05)"; g.fillRect(0, 0, cv.width, cv.height); }
      this.gradeCv = cv;
    }
    c.drawImage(this.gradeCv!, 0, 0, this.w, this.h);
  }
  get shift() { const h = new Date().getUTCHours(); return h >= 22 || h < 6 ? "Night shift" : h < 14 ? "Day shift" : "Swing shift"; }
  getStats() { return this.stats; }
}
void HZ;
