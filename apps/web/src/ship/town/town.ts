import type { Pick, ShipStatic, Snapshot, Station } from "../types";
import { Faces, type Frames, type Key, P_IDLE, P_SIT, P_TALK, P_WALK, POSES, bodyFrames } from "./frogs";
import { C, Pix, textW } from "./pix";
import { BUILDS, type Dir, GH, GW, H, type Live, OX, OY, ROOM_KEYS, type RoomDef, type Spot, type SpotKind, T, W } from "./rooms";

/**
 * THE SHIP as a cozy pixel town, one room at a time: the room's real crew from the live snapshot (the signed-in
 * wallet's frogs and the Night Watchers first, up to 28 at a time), each one a whole-body pixel frog wearing its
 * onchain face, living a little routine by the real UTC shift: work at its station, get a coffee, chat in pairs
 * (every number in a bubble is the ship's live one), look out of the window, go back. Paths are A* on the room's
 * tile grid, eased at both ends, and everything is depth-sorted. Drawn at 352 × 212 and scaled up by whole pixels.
 */
const CAP = 24, PODS = 4;
type Member = { key: Key; id: number; n: number; k: number; tier: number; tc: string; mine: boolean; captain: boolean; boss: boolean; rate: number };
type Mode = "work" | "walk" | "idle" | "visit" | "chatwait" | "chat";
type Actor = Member & {
  frames: Frames; x: number; y: number; dir: Dir; path: [number, number][]; v: number; dist: number;
  mode: Mode; next: Mode; until: number; spot: Spot | null; home: Spot | null; sit: boolean; lift: number; liftTo: number;
  gesture: number; blinkAt: number; ph: number; partner: Actor | null; tile: number; box: [number, number, number, number] | null; waitSince: number;
};
type Bubble = { a: Actor; text: string; from: number; until: number };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const n0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const h1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
const h2 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const keyOf = (m: { key: Key }) => String(m.key);
/** 0 night (22-06 UTC), 1 day (06-14), 2 swing (14-22): the ship's shifts. */
export const shiftOf = (t: number) => { const h = new Date(t).getUTCHours(); return h >= 22 || h < 6 ? 0 : h < 14 ? 1 : 2; };
const hash = (a: number, b: number) => { let x = (a * 374761393 + b * 668265263) >>> 0; x = ((x ^ (x >>> 13)) * 1274126177) >>> 0; return x ^ (x >>> 16); };

/** The room a frog or a Night Watcher is in, by the same rules as the page's counts (null: forged, or unknown). */
export function roomOf(st: ShipStatic, snap: Snapshot | null, key: string): Station | null {
  if (key.startsWith("w")) { const w = snap?.watchers.find((x) => `w${x.n}` === key); return w ? (w.tier === 5 ? "quarters" : "bridge") : null; }
  const id = Number(key), row = st.frogs[id - 1], f = snap?.frogs[id - 1];
  if (!row || f?.dead) return null;
  return f?.mission && !f.mission.done ? "missions" : st.rules[row[10]!]!.station;
}

export class Town {
  readonly faces: Faces;
  onPick?: (p: Pick | null) => void;
  onHover?: (p: Pick | null, x: number, y: number) => void;
  onRoom?: (info: { room: Station; shown: number; total: number }) => void;
  crew = new Set<string>();
  selected: string | null = null;
  match: ((key: string) => boolean) | null = null;
  inset = { l: 0, r: 0, t: 0, b: 0 };
  room: Station = "bridge";
  private snap: Snapshot | null = null;
  private defs = new Map<Station, RoomDef>();
  private def: RoomDef | null = null;
  private actors: Actor[] = [];
  private bubbles: Bubble[] = [];
  private riders: number[] = [];
  private burned: number[] = [];
  private total = 0;
  private force = new Set<string>();
  private buf: HTMLCanvasElement;
  private p: Pix;
  private g: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private t0 = performance.now();
  private nextTalk = 0;
  private fade = 0;
  private S = 3;
  private ox = 0;
  private oy = 0;
  private pan = { x: 0, y: 0 };
  private zoom = 0;
  private dpr = 1;
  private frames = 0;
  private fpsAt = 0;
  private fps = 0;
  private ms = 0;
  private hover: string | null = null;
  private dirty = true;
  private space: HTMLCanvasElement | null = null;
  private unbind: () => void = () => {};

  constructor(private canvas: HTMLCanvasElement, private st: ShipStatic, private still: boolean) {
    this.faces = new Faces(st);
    this.buf = document.createElement("canvas"); this.buf.width = W; this.buf.height = H;
    this.p = new Pix(this.buf.getContext("2d")!);
    this.g = canvas.getContext("2d")!;
    this.bind();
    this.go("bridge");
    this.raf = requestAnimationFrame(this.loop);
  }
  destroy() { cancelAnimationFrame(this.raf); this.unbind(); }
  getStats() { return { fps: this.fps, frameMs: this.ms }; }
  get pending() { return this.faces.pending; }
  emptyWhy(_seat: number): string | null { return null; }

  setSnapshot(s: Snapshot) {
    this.snap = s;
    for (const w of s.watchers) this.faces.setWatcher(w.n, w.traits, w.color);
    this.populate(false);
  }

  /** Switches to a room (a short dithered fade); `force` keys are shown there whatever the cap. */
  go(room: Station, force: string[] = []) {
    const same = room === this.room && this.def;
    this.force = new Set(force);
    if (!same) {
      this.room = room;
      let d = this.defs.get(room);
      if (!d) { d = BUILDS[room](this.st); this.defs.set(room, d); }
      this.def = d;
      this.actors = []; this.bubbles = []; this.pan = { x: 0, y: 0 };
      this.fade = this.still ? 0 : 1;
    }
    this.populate(!same);
  }

  focusKey(key: string): boolean {
    const r = roomOf(this.st, this.snap, key);
    // a forged frog: its face is on the Forge's memorial wall
    if (!r) { if (!key.startsWith("w") && this.snap?.frogs[Number(key) - 1]?.dead) { this.go("forge"); return true; } return false; }
    if (r === "missions" && !key.startsWith("w") && this.snap?.frogs[Number(key) - 1]?.mission && !this.snap.frogs[Number(key) - 1]!.mission!.done) { this.go("missions", [key]); return true; }
    this.go(r, [key]);
    const a = this.actors.find((x) => keyOf(x) === key);
    if (a) this.centreOn(a.x, a.y - 14);
    return true;
  }
  focusKeys(keys: string[]) {
    const count = new Map<Station, number>();
    for (const k of keys) { const r = roomOf(this.st, this.snap, k); if (r) count.set(r, (count.get(r) ?? 0) + (k.startsWith("w") ? 3 : 1)); }
    const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) this.go(best[0], keys.filter((k) => roomOf(this.st, this.snap, k) === best[0]).slice(0, 14));
    return Boolean(best);
  }
  focusRoom(k: Station) { this.go(k); }
  zoomBy(f: number) { this.zoom += f > 1 ? 1 : -1; this.zoom = Math.max(-4, Math.min(4, this.zoom)); this.dirty = true; }
  fit() { this.zoom = 0; this.pan = { x: 0, y: 0 }; this.dirty = true; }
  info() { return { room: this.room, shown: this.actors.length + this.riders.filter(Boolean).length, total: this.total }; }

  // ------------------------------------------------------------------ who is in the room
  private members(): { list: Member[]; total: number; riders: number[] } {
    const st = this.st, s = this.snap, room = this.room, shift = shiftOf(Date.now()), day = Math.floor(Date.now() / 86_400_000);
    const out: (Member & { score: number })[] = [];
    const riders: { id: number; score: number }[] = [];
    let total = 0;
    if (s) {
      const captainForged = s.watchers.some((w) => w.n === 0);
      s.frogs.forEach((f, i) => {
        if (f.dead) return;
        const key = String(f.id), mine = this.crew.has(key), forced = this.force.has(key);
        if (f.mission && !f.mission.done) { if (room === "missions") { total++; riders.push({ id: f.id, score: forced ? -2 : mine ? -1 : hash(f.id, day) / 4e9 }); } return; }
        const station = st.rules[st.frogs[i]![10]!]!.station;
        if (station !== room) return;
        total++;
        const captain = f.id === 1 && !captainForged;
        out.push({ key: f.id, id: f.id, n: -1, k: 1, tier: 0, tc: "#3FE6FF", mine, captain, boss: false, rate: f.rate, score: forced ? -10 : mine ? 1 : captain ? 2 : 10 + hash(f.id, day * 3 + shift) / 4.3e9 });
      });
      for (const w of s.watchers) {
        const at: Station = w.tier === 5 ? "quarters" : "bridge";
        if (at !== room) continue;
        total++;
        const key = `w${w.n}` as Key, mine = this.crew.has(String(key)), forced = this.force.has(String(key));
        out.push({ key, id: 1000 + w.n, n: w.n, k: w.n === 0 ? 1.75 : 1.5, tier: w.n === 0 ? 6 : w.tier, tc: w.color, mine, captain: w.n === 0, boss: w.tier === 5, rate: w.rate, score: forced ? -10 : mine ? 0 : w.n === 0 ? 2 : 3 + w.n / 100 });
      }
    }
    out.sort((a, b) => a.score - b.score);
    riders.sort((a, b) => a.score - b.score);
    // as many as the room has places for: its work spots and a dozen more for the ones on a break
    const work = this.def ? this.def.spots.filter((sp) => sp.kind === "work" || sp.kind === "hammer").length : 14;
    const cap = Math.max(20, Math.min(CAP, work + 11)) + out.filter((m) => m.tier).length;
    return { list: out.slice(0, cap), total, riders: riders.slice(0, PODS).map((r) => r.id) };
  }

  private populate(fresh: boolean) {
    const def = this.def!;
    const { list, total, riders } = this.members();
    this.total = total; this.riders = riders;
    this.burned = this.snap ? this.burnedOrder(this.snap) : [];
    const keep = new Map(this.actors.map((a) => [keyOf(a), a]));
    const now = performance.now();
    const next: Actor[] = [];
    for (const m of list) {
      const old = keep.get(keyOf(m));
      if (old) { old.mine = m.mine; old.rate = m.rate; next.push(old); continue; }
      next.push(this.make(m, now));
    }
    this.actors = next;
    this.bubbles = this.bubbles.filter((b) => next.includes(b.a));
    // homes: the Captain's chair, the watch seats, the plinths, then the work spots in a stable order
    const used = new Set<number>(next.filter((a) => a.home).map((a) => a.home!.i));
    const free = (kind: SpotKind) => def.spots.filter((sp) => sp.kind === kind && !used.has(sp.i));
    for (const a of next) {
      if (a.home) continue;
      const kinds: SpotKind[] = a.captain ? ["captain"] : a.boss ? ["boss", "watch"] : a.tier ? ["watch"] : ["work", "hammer"];
      for (const kind of kinds) { const f = free(kind)[0]; if (f) { a.home = f; used.add(f.i); break; } }
    }
    for (const a of next) if (!keep.has(keyOf(a))) this.place(a, now, fresh);
    this.dirty = true;
    this.onRoom?.(this.info());
  }

  private burnedOrder(s: Snapshot) {
    const when = new Map(s.watchers.map((w) => [w.n, w.forgedAt]));
    return s.frogs.filter((f) => f.dead).sort((a, b) => (when.get(b.into ?? -1) ?? 0) - (when.get(a.into ?? -1) ?? 0) || a.id - b.id).map((f) => f.id);
  }

  private make(m: Member, now: number): Actor {
    const t = this.faces.traits(m.key);
    const traits = t?.traits ?? [0, 0, 0, 0, 0, 7, 5];
    const frames = bodyFrames({ k: m.k, outfit: traits[1]!, skin: this.faces.skins[traits[2]!] ?? this.faces.skins[0]!, acc: traits[6]!, tier: m.tier, tc: m.tc });
    return {
      ...m, frames, x: 0, y: 0, dir: 0, path: [], v: 0, dist: 0, mode: "idle", next: "idle", until: now + rnd(400, 5000), spot: null, home: null,
      sit: false, lift: 0, liftTo: 0, gesture: 0, blinkAt: now + rnd(1000, 6000), ph: Math.random() * 1000, partner: null, tile: -1, box: null, waitSince: 0,
    };
  }

  /** Puts an actor down where it would be now: at its home spot, else on a free tile. */
  private place(a: Actor, now: number, fresh: boolean) {
    if (a.home && (this.still || Math.random() < 0.82 || a.tier)) { this.arrive(a, a.home, "work", now); a.until = now + (fresh ? rnd(1500, 30000) : rnd(8000, 30000)); return; }
    const tile = this.freeTile();
    if (tile < 0) return;
    a.x = OX + (tile % GW) * T + 8; a.y = OY + Math.floor(tile / GW) * T + 12; a.tile = tile; a.dir = pick([0, 0, 1, 2] as Dir[]);
    a.mode = "idle"; a.until = now + rnd(500, 4000); a.sit = false; a.liftTo = 0;
  }

  private arrive(a: Actor, s: Spot, mode: Mode, now: number) {
    a.spot = s; a.x = s.x; a.y = s.y; a.dir = s.face; a.sit = s.sit; a.liftTo = s.lift; if (this.still || mode === "work") a.lift = s.lift;
    a.mode = mode; a.tile = s.ty * GW + s.tx; a.path = []; a.v = 0;
  }

  private taken(): Set<number> {
    const t = new Set<number>();
    for (const a of this.actors) { if (a.tile >= 0) t.add(a.tile); if (a.spot) t.add(a.spot.ty * GW + a.spot.tx); }
    return t;
  }
  private spotTaken(s: Spot) { return this.actors.some((a) => a.spot === s || (a.mode === "walk" && a.spot === s)); }
  private freeTile(): number {
    const def = this.def!, taken = this.taken(), spotTiles = new Set(def.spots.map((s) => s.ty * GW + s.tx));
    // a free tile with room round it: nobody on it or next to it, not a seat
    const roomy = (i: number) => { const x = i % GW, y = Math.floor(i / GW); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (taken.has((y + dy) * GW + x + dx)) return false; return true; };
    let fallback = -1;
    for (let k = 0; k < 80; k++) {
      const i = Math.floor(Math.random() * GW * GH);
      if (!def.walk[i] || taken.has(i) || spotTiles.has(i) || i < GW || i % GW === 0 || i % GW === GW - 1) continue;
      if (roomy(i)) return i;
      if (fallback < 0) fallback = i;
    }
    return fallback;
  }

  // ------------------------------------------------------------------ paths: A* on the tile grid, then pulled straight
  private astar(from: number, to: number): number[] | null {
    const walk = this.def!.walk, N = GW * GH;
    if (from === to) return [to];
    const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), open: number[] = [from], closed = new Uint8Array(N);
    const hx = (i: number) => { const dx = Math.abs((i % GW) - (to % GW)), dy = Math.abs(Math.floor(i / GW) - Math.floor(to / GW)); return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy); };
    const f = new Float32Array(N).fill(Infinity);
    g[from] = 0; f[from] = hx(from);
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (f[open[k]!]! < f[open[bi]!]!) bi = k;
      const cur = open.splice(bi, 1)[0]!;
      if (cur === to) { const path = [cur]; let c = cur; while (came[c]! >= 0) { c = came[c]!; path.push(c); } return path.reverse(); }
      closed[cur] = 1;
      const cx = cur % GW, cy = Math.floor(cur / GW);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const ni = ny * GW + nx;
        if (closed[ni] || (!walk[ni] && ni !== to)) continue;
        if (dx && dy && (!walk[cy * GW + nx] || !walk[ny * GW + cx])) continue;
        const ng = g[cur]! + (dx && dy ? Math.SQRT2 : 1);
        if (ng < g[ni]!) { g[ni] = ng; f[ni] = ng + hx(ni); came[ni] = cur; if (!open.includes(ni)) open.push(ni); }
      }
    }
    return null;
  }
  /** Can a frog walk straight from a to b (pixels)? Samples the line every 3 px, a body's width either side. */
  private clear(ax: number, ay: number, bx: number, by: number) {
    const walk = this.def!.walk, d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 3);
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
      for (const ox of [-4, 4]) { const tx = Math.floor((x + ox - OX) / T), ty = Math.floor((y - 6 - OY) / T); if (tx < 0 || ty < 0 || tx >= GW || ty >= GH || !walk[ty * GW + tx]) return false; }
    }
    return true;
  }
  private route(a: Actor, tx: number, ty: number, px: number, py: number): boolean {
    const from = Math.max(0, Math.min(GW * GH - 1, Math.floor((a.y - 6 - OY) / T) * GW + Math.floor((a.x - OX) / T)));
    const tiles = this.astar(this.def!.walk[from] ? from : this.nearestWalk(from), ty * GW + tx);
    if (!tiles) return false;
    const pts: [number, number][] = tiles.map((i) => [OX + (i % GW) * T + 8, OY + Math.floor(i / GW) * T + 12]);
    pts[pts.length - 1] = [px, py];
    // string pulling: skip every point the frog can see past
    const out: [number, number][] = [];
    let cur: [number, number] = [a.x, a.y], k = 0;
    while (k < pts.length) {
      let far = k;
      for (let j = pts.length - 1; j > k; j--) if (this.clear(cur[0], cur[1], pts[j]![0], pts[j]![1])) { far = j; break; }
      out.push(pts[far]!); cur = pts[far]!; k = far + 1;
    }
    a.path = out;
    return true;
  }
  private nearestWalk(i: number) {
    const walk = this.def!.walk, x0 = i % GW, y0 = Math.floor(i / GW);
    for (let r = 1; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = x0 + dx, y = y0 + dy; if (x >= 0 && y >= 0 && x < GW && y < GH && walk[y * GW + x]) return y * GW + x; }
    return i;
  }

  /** Sends an actor to a spot (or a bare tile) to do `then` there. */
  private send(a: Actor, to: Spot | number, then: Mode, now: number): boolean {
    const tx = typeof to === "number" ? to % GW : to.tx, ty = typeof to === "number" ? Math.floor(to / GW) : to.ty;
    const px = typeof to === "number" ? OX + tx * T + 8 : to.x, py = typeof to === "number" ? OY + ty * T + 12 : to.y;
    if (!this.route(a, tx, ty, px, py)) return false;
    a.spot = typeof to === "number" ? null : to; a.tile = ty * GW + tx;
    a.mode = "walk"; a.next = then; a.sit = false; a.liftTo = 0; a.until = now + 40_000;
    return true;
  }

  // ------------------------------------------------------------------ the routine
  private decide(a: Actor, now: number) {
    const def = this.def!, shift = shiftOf(Date.now()), r = Math.random();
    const work = shift === 0 ? 0.62 : shift === 2 ? 0.5 : 0.4;
    const watch = a.tier > 0;
    // the watch stays on watch most of the time
    if (watch && a.home && a.mode !== "work" && r < 0.8) { if (this.send(a, a.home, "work", now)) return; }
    if (watch && a.home && a.mode === "work" && r < 0.7) { a.until = now + rnd(12000, 30000); return; }
    if (a.home && a.mode !== "work" && r < work) { if (this.send(a, a.home, "work", now)) return; }
    if (!a.home && r < work * 0.6) {
      const w = def.spots.filter((s) => (s.kind === "work" || s.kind === "hammer") && !this.spotTaken(s));
      if (w.length && this.send(a, pick(w), "work", now)) return;
    }
    const q = Math.random();
    if (q < 0.33 && this.actors.filter((x) => x.partner).length < 4 && this.chat(a, now)) return;
    if (q < 0.7) {
      const kinds: SpotKind[] = q < 0.52 ? ["coffee"] : ["view", "play"];
      const s = def.spots.filter((sp) => kinds.includes(sp.kind) && !this.spotTaken(sp));
      if (s.length && this.send(a, pick(s), "visit", now)) return;
    }
    const tile = this.freeTile();
    if (tile >= 0 && this.send(a, tile, "idle", now)) return;
    a.until = now + rnd(2000, 5000);
  }

  private chat(a: Actor, now: number): boolean {
    const others = this.actors.filter((b) => b !== a && !b.partner && b.mode !== "walk" && !(b.tier && b.mode === "work") && Math.hypot(b.x - a.x, b.y - a.y) < 150);
    if (!others.length) return false;
    const b = pick(others), walk = this.def!.walk, taken = this.taken();
    const mx = Math.floor(((a.x + b.x) / 2 - OX) / T), my = Math.floor(((a.y + b.y) / 2 - 6 - OY) / T);
    for (let k = 0; k < 30; k++) {
      const tx = mx + Math.round(rnd(-3, 2)), ty = my + Math.round(rnd(-2, 2));
      if (tx < 0 || ty < 1 || tx + 2 >= GW || ty >= GH) continue;
      const i = ty * GW + tx, j = i + 2;
      if (!walk[i] || !walk[j] || !walk[i + 1] || taken.has(i) || taken.has(j)) continue;
      if (!this.send(a, i, "chatwait", now)) return false;
      if (!this.send(b, j, "chatwait", now)) { a.mode = "idle"; a.until = now; return false; }
      a.path[a.path.length - 1] = [OX + (i % GW) * T + 11, OY + ty * T + 12];
      b.path[b.path.length - 1] = [OX + (j % GW) * T + 5, OY + ty * T + 12];
      a.partner = b; b.partner = a;
      return true;
    }
    return false;
  }

  private say(a: Actor, text: string, now: number, ms = 2800) {
    if (this.bubbles.some((b) => b.a === a || b.text === text)) return;
    this.bubbles.push({ a, text, from: now, until: now + ms });
    a.gesture = now + Math.min(ms, 1600);
  }

  /** Two lines for a pair in this room, from the live numbers. */
  private talk(): [string, string] {
    const s = this.snap!, t = s.totals, r = s.radar;
    const P: Record<Station, [string, string][]> = {
      bridge: [r ? ["Radar check?", `${r.loans.length} loans, peg ${r.peg ? r.peg.toFixed(3) : "n/a"}`] : ["Radar check?", "No read yet."], r ? ["What's owed?", `${n0(r.totalDebt)} imdUSD`] : ["Quiet night?", "So far."], ["Watch seats?", `${s.watchers.filter((w) => w.n !== 0).length} of 50 forged`]],
      quarters: [["Holders?", `${n0(t.holders)} wallets`], ["Any Watchers?", `${t.watchers} forged`]],
      offices: [["Busy?", `${n0(t.held)} frogs aboard`], ["Ship-wide?", `${h1(t.perHour)} h/h`]],
      breakroom: [["Coffee?", "Always. Night shift."], ["Earning?", `${h1(t.perHour)} h/h, all of us`], ["Long shift?", "3 AM again."]],
      missions: [["Who's out?", `${t.onMissions} on missions`], ["This week?", pick(this.st.missions)?.title ?? "Missions."]],
      engine: [["How's the shift?", `${h1(t.perHour)} h/h, all crew`], ["Reactor?", "Steady."]],
      forge: [["How many forged?", `${t.burned} frogs, ${t.watchers} Watchers`], ["Next one?", "10 frogs in, 1 out."]],
    };
    const fresh = P[this.room].filter(([q, ans]) => !this.bubbles.some((b) => b.text === q || b.text === ans));
    return fresh.length ? pick(fresh) : ["", ""];
  }
  private solo(a: Actor, kind: SpotKind | null): string | null {
    const s = this.snap!;
    if (kind === "coffee") return pick(["Refill.", "Black, no sugar.", "Coffee first."]);
    if (kind === "view") return pick(["Stars are out.", "Nice view."]);
    if (kind === "play") return pick(["One more round.", "High score!"]);
    if (kind === "watch") return s.radar ? `${s.radar.loans.length} on radar` : "Radar's quiet.";
    if (kind === "hammer") return Math.random() < 0.5 ? "Clang." : `${s.totals.burned} forged so far`;
    if (kind === "work" && Math.random() < 0.5) return a.tier ? `${h2(a.rate)} h/h, +${s.watchers.find((w) => w.n === a.n)?.crew ?? 0}% crew` : `I earn ${h2(a.rate)} h/h`;
    return null;
  }

  private step(now: number, dt: number) {
    for (const a of this.actors) {
      a.lift += (a.liftTo - a.lift) * Math.min(1, dt * 9);
      if (a.mode === "walk") { this.move(a, dt, now); continue; }
      if (a.mode === "chatwait") {
        const b = a.partner;
        if (!b || !this.actors.includes(b) || now - a.waitSince > 9000) { a.partner = null; a.mode = "idle"; a.until = now + 500; continue; }
        if (b.mode === "chatwait" && a.x < b.x) {
          a.dir = 2; b.dir = 1; a.mode = "chat"; b.mode = "chat";
          const [q, ans] = this.talk();
          if (q) { this.say(a, q, now, 2600); this.bubbles.push({ a: b, text: ans, from: now + 1400, until: now + 4600 }); b.gesture = now + 3000; }
          a.until = now + 5200; b.until = now + 5200;
        }
        continue;
      }
      if (now >= a.until) { if (a.mode === "chat") { a.partner = null; } this.decide(a, now); }
      if (now > a.blinkAt + 140) a.blinkAt = now + rnd(2200, 6500);
      if (a.mode === "work" && a.spot?.kind === "hammer" && !this.still) a.gesture = Math.floor(now / 1400) % 3 ? now + 400 : a.gesture;
    }
    // a pair starts talking every few seconds; the watch reports now and then
    if (now > this.nextTalk && this.snap && !this.still) {
      this.nextTalk = now + rnd(3000, 6500);
      const at = this.actors.filter((a) => (a.mode === "work" || a.mode === "visit") && !this.bubbles.some((b) => b.a === a));
      if (at.length && this.bubbles.length < 4) { const a = pick(at), line = this.solo(a, a.spot?.kind ?? null); if (line) this.say(a, line, now); }
    }
    this.bubbles = this.bubbles.filter((b) => now < b.until);
  }

  private move(a: Actor, dt: number, now: number) {
    let rem = 0, px = a.x, py = a.y;
    for (const q of a.path) { rem += Math.hypot(q[0] - px, q[1] - py); px = q[0]; py = q[1]; }
    const vmax = a.k > 1.3 ? 30 : 34, acc = 120;
    a.v = Math.min(vmax, a.v + acc * dt, Math.sqrt(2 * acc * rem) + 3);
    let stepLen = a.v * dt;
    while (stepLen > 0 && a.path.length) {
      const [tx, ty] = a.path[0]!, dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
      if (d > 0.01) {
        const ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax > ay * 1.15) a.dir = dx > 0 ? 2 : 1; else if (ay > ax * 1.15) a.dir = dy > 0 ? 0 : 3;
      }
      if (d <= stepLen) { a.x = tx; a.y = ty; stepLen -= d; a.dist += d; a.path.shift(); }
      else { a.x += (dx / d) * stepLen; a.y += (dy / d) * stepLen; a.dist += stepLen; stepLen = 0; }
    }
    if (!a.path.length) {
      a.v = 0;
      const mode = a.next;
      if (a.spot) { this.arrive(a, a.spot, mode, now); a.lift = 0; }
      else { a.mode = mode; a.dir = mode === "chatwait" ? a.dir : 0; }
      a.waitSince = now;
      a.until = now + (mode === "work" ? (shiftOf(Date.now()) === 0 ? rnd(25000, 70000) : rnd(14000, 40000)) * (a.tier ? 1.6 : 1) : mode === "visit" ? rnd(4000, 8000) : rnd(2500, 6000));
      if (mode === "visit" || (mode === "work" && Math.random() < 0.3)) { const line = this.solo(a, a.spot?.kind ?? null); if (line && this.bubbles.length < 4 && Math.random() < 0.6) this.say(a, line, now); }
    }
  }

  // ------------------------------------------------------------------ drawing
  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (t - (this.last || t)) / 1000);
    this.last = t;
    this.faces.pump();
    if (this.still && !this.dirty && !this.faces.pending) return;
    const t0 = performance.now();
    if (!this.still) this.step(t, dt);
    this.draw(t);
    this.ms = this.ms * 0.9 + (performance.now() - t0) * 0.1;
    this.frames++;
    if (t - this.fpsAt > 1000) { this.fps = Math.round((this.frames * 1000) / (t - this.fpsAt)); this.frames = 0; this.fpsAt = t; }
    this.dirty = this.faces.pending > 0;
  };

  private draw(t: number) {
    const def = this.def;
    if (!def) return;
    const p = this.p, g = p.g, now = Date.now();
    const L: Live = { snap: this.snap, st: this.st, faces: this.faces, t: t - this.t0, still: this.still, now, riders: this.riders, burned: this.burned };
    g.drawImage(def.bg, 0, 0);
    for (const w of def.wall) w(p, L);
    // props and frogs, back to front
    type Item = { y: number; draw: () => void };
    const items: Item[] = def.props.map((pr) => ({ y: pr.base, draw: () => { g.drawImage(pr.img, pr.x, pr.y); pr.anim?.(p, L); } }));
    for (const a of this.actors) items.push({ y: a.y, draw: () => this.drawActor(a, t) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    // over everything: plates, the selection, bubbles
    for (const a of this.actors) this.plate(a, t);
    const placed: [number, number, number, number][] = [];
    for (const b of this.bubbles) if (t >= b.from) this.bubble(b, placed);
    if (this.fade > 0) {
      g.fillStyle = C.ink;
      const f = this.fade;
      for (let y = 0; y < H; y += 2) for (let x = (y / 2) % 2; x < W; x += 2) { const v = ((x * 7 + y * 13) % 16) / 16; if (v < f) g.fillRect(x, y, 2, 2); }
      this.fade = Math.max(0, this.fade - 0.09);
    }
    this.present();
  }

  private drawActor(a: Actor, t: number) {
    const p = this.p, g = p.g, fr = a.frames, key = keyOf(a);
    const moving = a.mode === "walk" && a.v > 1;
    const gest = !moving && a.gesture > t;
    const pose = moving ? P_WALK + (Math.floor(a.dist / (5 * a.k)) % 4) : gest ? P_TALK + (Math.floor(t / 220) % 2) : a.sit ? P_SIT : P_IDLE;
    const dim = this.match ? !this.match(key) : false;
    if (dim) g.globalAlpha = 0.32;
    const x = Math.round(a.x), y = Math.round(a.y - a.lift);
    if (a.lift < 1) { g.globalAlpha *= 0.3; p.ell(x, Math.round(a.y), Math.round(6 * a.k), Math.max(1, Math.round(2 * a.k)), C.ink); g.globalAlpha = dim ? 0.32 : 1; }
    // a Night Watcher's aura: a faint ring of its tier's colour and a few motes
    if (a.tier && !dim) {
      g.globalAlpha = 0.55;
      const pulse = this.still ? 0 : Math.floor((t + a.ph) / 600) % 2;
      p.ring(x, y, Math.round(9 * a.k) + pulse, Math.round(3.2 * a.k), a.tier === 6 ? C.lemon : a.tc, 2);
      g.globalAlpha = 1;
    }
    const cell = a.dir * POSES + pose;
    g.drawImage(fr.sheet, pose * fr.cw, a.dir * fr.ch, fr.cw, fr.ch, x - fr.cx, y - fr.by, fr.cw, fr.ch);
    const hd = this.faces.get(a.key, a.k);
    const breath = !moving && !gest && Math.floor((t + a.ph) / 1100) % 2 ? 1 : 0;
    const neck = fr.head[cell]! + Math.round(2.2 * a.k);
    if (hd) {
      const blink = a.dir !== 3 && hd.blink && t >= a.blinkAt && t < a.blinkAt + 140;
      const img = a.dir === 3 ? hd.back : blink ? hd.blink! : hd.front;
      const hx = x + fr.hx[cell]! - Math.floor(hd.w / 2), hy = y + neck - hd.chin + breath;
      g.drawImage(img, hx, hy);
      a.box = [hx, hy + hd.top, hd.w, y - (hy + hd.top)];
    } else {
      // until its art is drawn: the head's outline in its skin colour
      const sk = this.faces.skins[this.faces.traits(a.key)?.traits[2] ?? 0] ?? this.faces.skins[0]!;
      const rx = Math.round(10 * a.k), ry = Math.round(7.5 * a.k), cy = y + neck - ry + breath;
      p.ell(x, cy, rx + 1, ry + 1, C.ink); p.ell(x, cy, rx, ry, sk.s); p.ell(x - 4 * a.k, cy - ry + 2, 3 * a.k, 3 * a.k, sk.l); p.ell(x + 4 * a.k, cy - ry + 2, 3 * a.k, 3 * a.k, sk.l);
      a.box = [x - rx, cy - ry - 3, rx * 2, y - (cy - ry - 3)];
    }
    if (a.tier && !dim && !this.still) {
      for (let i = 0; i < 3; i++) {
        const ph = ((t + a.ph * 3) / 2200 + i / 3) % 1, mx = Math.round(x + Math.sin(i * 2.3 + a.ph) * 9 * a.k), my = Math.round(y - 4 - ph * 26 * a.k);
        if (ph < 0.8) p.p(mx, my, ph < 0.4 ? (a.tier === 6 ? C.lemon : a.tc) : C.mist);
      }
    }
    g.globalAlpha = 1;
  }

  private plate(a: Actor, t: number) {
    const key = keyOf(a), sel = this.selected === key, hov = this.hover === key;
    if (!a.box || !(a.tier || a.captain || a.mine || sel || hov)) return;
    if (this.match && !this.match(key) && !sel) return;
    const p = this.p, label = a.n === 0 ? "THE CAPTAIN" : a.tier ? `NW ${a.n}` : a.captain ? "#1 CAPTAIN" : `#${a.id}`;
    const w = textW(label) + 5, x = Math.round(a.x - w / 2), y = a.box[1] - 9;
    const col = sel ? C.white : a.mine ? C.lemon : a.tier === 6 ? C.lemon : a.tier ? a.tc : C.mist;
    p.r(x, y, w, 8, C.ink); p.r(x + 1, y + 1, w - 2, 6, C.night); p.r(x + 1, y + 7, w - 2, 1, col);
    p.text(label, x + 3, y + 1, col);
    if (a.mine && !a.tier) { p.p(x - 3, y + 3, C.lemon); p.p(x - 4, y + 3, C.lemon); p.p(x - 3, y + 2, C.lemon); p.p(x - 3, y + 4, C.lemon); p.p(x - 2, y + 3, C.lemon); }
    if (sel) {
      const b = this.still ? 0 : Math.round(Math.sin(t / 180) * 1.5) + 1, ax = Math.round(a.x), ay = y - 6 - b;
      p.r(ax - 3, ay, 7, 1, C.ink); p.r(ax - 3, ay - 1, 7, 1, C.ink);
      for (let k = 0; k < 4; k++) { p.r(ax - 3 + k, ay + k, 7 - k * 2, 1, k === 0 ? C.lemon : C.amber); p.p(ax - 4 + k, ay + k, C.ink); p.p(ax + 4 - k, ay + k, C.ink); }
    }
  }

  private bubble(b: Bubble, placed: [number, number, number, number][]) {
    const a = b.a;
    if (!a.box || !this.actors.includes(a)) return;
    const p = this.p, words = b.text.toUpperCase().split(" "), lines: string[] = [];
    let cur = "";
    for (const w of words) { if ((cur + " " + w).trim().length > 22) { lines.push(cur.trim()); cur = w; } else cur += " " + w; }
    if (cur.trim()) lines.push(cur.trim());
    const w = Math.max(...lines.map(textW)) + 7, h = lines.length * 7 + 5;
    const plated = a.tier || a.captain || a.mine || this.selected === keyOf(a);
    let x = Math.round(a.x - w / 2), y = a.box[1] - h - 5 - (plated ? 9 : 0);
    x = Math.max(9, Math.min(W - 9 - w, x)); y = Math.max(7, y);
    // never over another bubble: up above it, or not at all this frame
    const hits = () => placed.find(([px, py, pw, ph]) => x < px + pw + 1 && x + w + 1 > px && y < py + ph + 2 && y + h + 2 > py);
    for (let k = 0, o = hits(); o; o = hits(), k++) { if (k > 2) return; y = o[1] - h - 3; if (y < 2) return; }
    placed.push([x, y, w, h]);
    p.r(x + 1, y, w - 2, h, C.ink); p.r(x, y + 1, w, h - 2, C.ink); p.r(x + 1, y + 1, w - 2, h - 2, C.white); p.r(x + 1, y + h - 2, w - 2, 1, C.mist);
    const tx = Math.max(x + 3, Math.min(x + w - 5, Math.round(a.x) - 1));
    p.r(tx, y + h - 1, 3, 1, C.white); p.p(tx + 1, y + h, C.white); p.p(tx - 1, y + h - 1, C.ink); p.p(tx + 3, y + h - 1, C.ink); p.p(tx, y + h, C.ink); p.p(tx + 2, y + h, C.ink); p.p(tx + 1, y + h + 1, C.ink);
    lines.forEach((l, i) => p.text(l, x + 4, y + 3 + i * 7, C.ink));
  }

  // ------------------------------------------------------------------ the screen: whole-pixel scaling, panning, pointer
  private layout() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1, cw = c.clientWidth, ch = c.clientHeight;
    if (!cw || !ch) return false;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); this.space = null; }
    this.dpr = dpr;
    const aw = Math.max(120, cw - this.inset.l - this.inset.r), ah = Math.max(120, ch - this.inset.t - this.inset.b);
    // whole device pixels per room pixel; the side panels slide the room over rather than shrink it
    let S = Math.max(1, Math.floor(Math.min(cw / W, ah / H) * dpr));
    // a phone: whole frogs at a good size, the room panned sideways
    if (cw < 700 && S < Math.round(2 * dpr) && ah >= H * 1.6) S = Math.round(2 * dpr);
    S = Math.max(1, S + this.zoom * Math.max(1, Math.round(dpr)));
    this.S = S;
    const rw = W * S, rh = H * S, cx = (this.inset.l + aw / 2) * dpr, cy = (this.inset.t + ah / 2) * dpr;
    const clampX = (v: number) => (rw <= c.width ? v : Math.max(c.width - rw - 8 * dpr, Math.min(8 * dpr, v)));
    const clampY = (v: number) => (rh <= c.height ? v : Math.max(c.height - rh - 8 * dpr, Math.min(8 * dpr, v)));
    const maxX = Math.max(0, (rw - aw * dpr) / 2 + 8 * dpr), maxY = Math.max(0, (rh - ah * dpr) / 2 + 8 * dpr);
    this.pan.x = Math.max(-maxX, Math.min(maxX, this.pan.x)); this.pan.y = Math.max(-maxY, Math.min(maxY, this.pan.y));
    this.ox = Math.round(clampX(cx - rw / 2 + this.pan.x)); this.oy = Math.round(clampY(cy - rh / 2 + this.pan.y));
    return true;
  }
  private centreOn(x: number, y: number) {
    this.layout();
    this.pan.x += (this.canvas.width - (this.inset.r - this.inset.l) * this.dpr) / 2 - (this.ox + x * this.S);
    this.pan.y += (this.canvas.height - (this.inset.b - this.inset.t) * this.dpr) / 2 - (this.oy + y * this.S);
  }
  private present() {
    if (!this.layout()) return;
    const g = this.g, c = this.canvas, S = this.S;
    if (!this.space) this.space = starfield(c.width, c.height, Math.max(1, Math.round(this.dpr * 2)));
    g.imageSmoothingEnabled = false;
    g.drawImage(this.space, 0, 0);
    // the hull round the cutaway
    const k = S * 2;
    g.fillStyle = C.ink; g.fillRect(this.ox - k * 2, this.oy - k * 2, W * S + k * 4, H * S + k * 4);
    g.fillStyle = C.steel; g.fillRect(this.ox - k * 2 + S, this.oy - k * 2 + S, W * S + k * 4 - 2 * S, H * S + k * 4 - 2 * S);
    g.fillStyle = C.slate; g.fillRect(this.ox - k * 2 + S, this.oy - k * 2 + S, W * S + k * 4 - 2 * S, S);
    g.fillStyle = C.ink; g.fillRect(this.ox - S, this.oy - S, W * S + 2 * S, H * S + 2 * S);
    g.drawImage(this.buf, 0, 0, W, H, this.ox, this.oy, W * S, H * S);
  }
  /** Screen (CSS px) to room pixels. */
  private toRoom(cx: number, cy: number): [number, number] { return [(cx * this.dpr - this.ox) / this.S, (cy * this.dpr - this.oy) / this.S]; }
  private hit(rx: number, ry: number): { pick: Pick | null; key: string | null; label?: string } {
    let best: Actor | null = null;
    for (const a of this.actors) { const b = a.box; if (b && rx >= b[0] && rx < b[0] + b[2] && ry >= b[1] && ry <= b[1] + b[3] + 1 && (!best || a.y > best.y)) best = a; }
    if (best) return { pick: best.tier ? { kind: "watcher", n: best.n } : { kind: "frog", id: best.id }, key: keyOf(best) };
    const def = this.def!;
    // an open Night Watch seat on the bridge
    for (const s of def.spots) if ((s.kind === "watch") && !this.actors.some((a) => a.home === s) && Math.abs(rx - s.x) < 7 && ry > s.y - 14 && ry < s.y + 3) return { pick: { kind: "seat", seat: s.i }, key: null, label: "An open Night Watch seat" };
    const L: Live = { snap: this.snap, st: this.st, faces: this.faces, t: 0, still: this.still, now: Date.now(), riders: this.riders, burned: this.burned };
    for (const h of def.hots) { const [x, y, w, hh] = h.r; if (rx >= x && rx < x + w && ry >= y && ry < y + hh) { const pk = h.pick(L, rx, ry); if (pk) return { pick: pk, key: pk.kind === "frog" ? String(pk.id) : null, label: h.label }; } }
    return { pick: null, key: null };
  }

  private bind() {
    const c = this.canvas;
    let down: { x: number; y: number; px: number; py: number; moved: boolean; id: number } | null = null;
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y, moved: false, id: e.pointerId }; c.setPointerCapture?.(e.pointerId); };
    const pm = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.hypot(dx, dy) > 6) down.moved = true;
        if (down.moved) { this.pan.x = down.px + dx * this.dpr; this.pan.y = down.py + dy * this.dpr; this.dirty = true; }
        return;
      }
      if (e.pointerType !== "mouse") return;
      const [rx, ry] = this.toRoom(e.clientX - r.left, e.clientY - r.top), h = this.hit(rx, ry);
      if (this.hover !== h.key) this.dirty = true;
      this.hover = h.key;
      c.style.cursor = h.pick ? "pointer" : "";
      this.onHover?.(h.pick && h.pick.kind !== "room" ? h.pick : null, e.clientX - r.left, e.clientY - r.top);
    };
    const pu = (e: PointerEvent) => {
      const d = down; down = null;
      if (!d || d.moved) return;
      const r = c.getBoundingClientRect(), [rx, ry] = this.toRoom(e.clientX - r.left, e.clientY - r.top), h = this.hit(rx, ry);
      this.onPick?.(h.pick);
      this.dirty = true;
    };
    const pl = () => { this.hover = null; this.onHover?.(null, 0, 0); };
    const kd = (e: KeyboardEvent) => {
      const step = 40 * this.dpr;
      if (e.key === "ArrowLeft") this.pan.x += step; else if (e.key === "ArrowRight") this.pan.x -= step;
      else if (e.key === "ArrowUp") this.pan.y += step; else if (e.key === "ArrowDown") this.pan.y -= step;
      else if (e.key === "+" || e.key === "=") this.zoomBy(2); else if (e.key === "-") this.zoomBy(0.5);
      else if (/^[1-7]$/.test(e.key)) { const k = ROOM_KEYS[Number(e.key) - 1]!; this.go(k); }
      else return;
      e.preventDefault(); this.dirty = true;
    };
    const rs = () => { this.dirty = true; };
    c.addEventListener("pointerdown", pd); c.addEventListener("pointermove", pm); c.addEventListener("pointerup", pu); c.addEventListener("pointerleave", pl); c.addEventListener("keydown", kd);
    addEventListener("resize", rs);
    this.unbind = () => { c.removeEventListener("pointerdown", pd); c.removeEventListener("pointermove", pm); c.removeEventListener("pointerup", pu); c.removeEventListener("pointerleave", pl); c.removeEventListener("keydown", kd); removeEventListener("resize", rs); };
  }
}

/** Deep space behind the cutaway: a few crisp stars, no glow. */
function starfield(w: number, h: number, s: number) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0e0c18"; g.fillRect(0, 0, w, h);
  let seed = 7;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < (w * h) / (900 * s); k++) { g.fillStyle = r() < 0.1 ? C.mist : r() < 0.5 ? C.slate : C.steel; g.fillRect(Math.floor(r() * w / s) * s, Math.floor(r() * h / s) * s, s, s); }
  return c;
}
