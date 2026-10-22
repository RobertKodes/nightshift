import type { Pick, ShipStatic, Snapshot, Station } from "../types";
import type { Faces } from "./frogs";
import { C, type Col, Pix, copy, pool, rng, sheet } from "./pix";

/**
 * The seven rooms of the ship, each one hand-laid on a 21 × 10 tile floor under a 3-tile back wall, drawn once
 * into a background (floor, walls, what hangs on them, rugs, the light pools of its lamps) and a set of props
 * (furniture) that are depth-sorted with the frogs, so a frog sits behind its desk and walks in front of it.
 * The live parts are drawn every frame from the snapshot: the radar's loans, the mission board, the pods'
 * riders, the forge's memorial wall, a clock on UTC.
 */
export const W = 352, H = 212, T = 16, GW = 21, GH = 10, OX = 8, OY = 48;
export type Dir = 0 | 1 | 2 | 3; // down, left, right, up
export type SpotKind = "work" | "watch" | "captain" | "boss" | "coffee" | "view" | "play" | "hammer";
export type Spot = { x: number; y: number; tx: number; ty: number; face: Dir; sit: boolean; kind: SpotKind; lift: number; i: number };
export type Live = { snap: Snapshot | null; st: ShipStatic; faces: Faces; t: number; still: boolean; now: number; riders: number[]; burned: number[] };
export type Prop = { x: number; y: number; img: HTMLCanvasElement; base: number; anim?: (p: Pix, L: Live) => void };
export type Hot = { r: [number, number, number, number]; pick: (L: Live, x: number, y: number) => Pick | null; label: string };
export type RoomDef = { key: Station; bg: HTMLCanvasElement; props: Prop[]; walk: Uint8Array; spots: Spot[]; wall: ((p: Pix, L: Live) => void)[]; hots: Hot[] };

const tx2x = (tx: number) => OX + tx * T, ty2y = (ty: number) => OY + ty * T;

class Room {
  bg = sheet(W, H, true); p = this.bg.p;
  props: Prop[] = []; spots: Spot[] = []; walk = new Uint8Array(GW * GH).fill(1);
  wall: ((p: Pix, L: Live) => void)[] = []; hots: Hot[] = [];
  lights: [number, number, number, number, number, boolean][] = [];
  shadows: [number, number, number][] = [];
  r: () => number;
  constructor(public key: Station, seed: number) { this.r = rng(seed); }
  block(tx: number, ty: number, w = 1, h = 1) { for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (x >= 0 && y >= 0 && x < GW && y < GH) this.walk[y * GW + x] = 0; }
  /** A prop at pixel (x, y), w × h, sorted at `base` (its front edge), its shadow on the floor. */
  put(x: number, y: number, w: number, h: number, paint: (p: Pix, r: () => number) => void, o: { base?: number; anim?: Prop["anim"]; shadow?: number } = {}) {
    const s = sheet(w, h, true);
    paint(s.p, this.r);
    const pr: Prop = { x: Math.round(x), y: Math.round(y), img: s.c, base: o.base ?? y + h, anim: o.anim };
    this.props.push(pr);
    if (o.shadow !== 0) this.shadows.push([x + w / 2, y + h - 1, (o.shadow ?? w / 2) + 1]);
    return pr;
  }
  spot(tx: number, ty: number, face: Dir, sit: boolean, kind: SpotKind, dx = 0, dy = 0, lift = 0) {
    this.spots.push({ x: tx2x(tx) + 8 + dx, y: ty2y(ty) + 12 + dy, tx, ty, face, sit, kind, lift, i: this.spots.length });
  }
  /** A lamp's pool: hard-edged, with a thin dithered rim (a wide dither reads as noise). */
  light(x: number, y: number, rx: number, ry: number, core = 0.5, dark = false) { this.lights.push([x, y, rx, ry, Math.max(0.8, core + 0.3), dark]); }
  done(): RoomDef {
    const g = this.p.g, img = g.getImageData(0, 0, W, H);
    for (const [x, y, rx] of this.shadows) pool(img, x, y + 1, rx, 3.2, 0.72, true);
    for (const [x, y, rx, ry, core, dark] of this.lights) pool(img, x, y, rx, ry, core, dark);
    g.putImageData(img, 0, 0);
    frameRoom(this.p);
    // lamps light the furniture too
    for (const pr of this.props) {
      const pg = pr.img.getContext("2d")!, pi = pg.getImageData(0, 0, pr.img.width, pr.img.height);
      for (const [x, y, rx, ry, core, dark] of this.lights) if (x + rx > pr.x && x - rx < pr.x + pr.img.width && y + ry > pr.y && y - ry < pr.y + pr.img.height) pool(pi, x - pr.x, y - pr.y, rx, ry, core, dark);
      pg.putImageData(pi, 0, 0);
      pr.img = copy(pr.img);
    }
    return { key: this.key, bg: copy(this.bg.c), props: this.props, walk: this.walk, spots: this.spots, wall: this.wall, hots: this.hots };
  }
}

// ------------------------------------------------------------------ floors and walls
type WallTheme = { face: Col; seam: Col; low: Col; lowHi: Col; base: Col; trim?: Col };
function walls(R: Room, t: WallTheme, paint?: (p: Pix) => void) {
  const p = R.p;
  p.r(0, 0, W, 48, t.face);
  for (let x = 8; x < W; x += 32) p.r(x, 7, 1, 27, t.seam);
  p.r(0, 34, W, 8, t.low); p.r(0, 34, W, 1, t.lowHi);
  if (t.trim) p.r(0, 13, W, 1, t.trim);
  p.r(0, 42, W, 6, t.base); p.r(0, 42, W, 1, t.lowHi); p.r(0, 47, W, 1, C.ink);
  paint?.(p);
  p.r(0, 0, W, 6, C.ink); p.r(0, 6, W, 1, C.night);
}
/** The room's frame, over whatever the floor painted: the shade under the back wall, the side walls, the front lip. */
function frameRoom(p: Pix) {
  for (let x = 8; x < W - 8; x++) { p.p(x, 48, C.ink); if (x % 2) p.p(x, 49, C.ink); }
  p.r(0, 0, 8, H, C.ink); p.r(W - 8, 0, 8, H, C.ink); p.r(7, 6, 1, H - 10, C.night); p.r(W - 8, 6, 1, H - 10, C.night);
  p.r(0, 208, W, 4, C.ink); p.r(8, 207, W - 16, 1, C.night);
}
function floorPlates(R: Room, a: Col, seam: Col, hi: Col, pw = 32) {
  const p = R.p;
  for (let y = OY; y < 208; y += 16) for (let x = OX; x < W - 8; x += pw) {
    const off = ((y - OY) / 16) % 2 ? pw / 2 : 0, x0 = x - off;
    p.r(x0, y, pw, 16, a); p.r(x0, y + 15, pw, 1, seam); p.r(x0 + pw - 1, y, 1, 16, seam); p.r(x0, y, pw - 1, 1, hi);
    p.p(x0 + 2, y + 2, hi); p.p(x0 + pw - 3, y + 2, hi); p.p(x0 + 2, y + 13, seam); p.p(x0 + pw - 3, y + 13, seam);
    if (R.r() < 0.25) p.r(x0 + 4 + Math.floor(R.r() * (pw - 10)), y + 5 + Math.floor(R.r() * 7), 2 + Math.floor(R.r() * 3), 1, seam);
  }
  p.r(0, OY, OX, 160, C.ink); p.r(W - 8, OY, 8, 160, C.ink);
}
function floorPlanks(R: Room) {
  const p = R.p, cols = [C.wood, C.wood, C.clay2, C.wood];
  for (let y = OY; y < 208; y += 4) {
    let x = OX - Math.floor(R.r() * 30);
    while (x < W - 8) {
      const len = 24 + Math.floor(R.r() * 30), c = cols[Math.floor(R.r() * cols.length)]!;
      p.r(x, y, len, 4, c); p.r(x, y + 3, len, 1, C.bark); p.r(x + len - 1, y, 1, 3, C.bark);
      if (R.r() < 0.6) p.r(x + 3 + Math.floor(R.r() * (len - 8)), y + 1, 3, 1, c === C.clay2 ? C.wood : C.clay2);
      x += len;
    }
  }
}
function floorChecker(R: Room, a: Col, b: Col) {
  const p = R.p;
  for (let y = OY; y < 208; y += 8) for (let x = OX; x < W - 8; x += 8) { const on = ((x - OX) / 8 + (y - OY) / 8) % 2 === 0; p.r(x, y, 8, 8, on ? a : b); if (on) p.p(x, y, C.white); }
}
function floorCarpet(R: Room) {
  const p = R.p;
  p.r(OX, OY, W - 16, 160, C.steel);
  for (let y = OY; y < 208; y += 4) for (let x = OX + ((y / 4) % 2) * 2; x < W - 8; x += 4) p.p(x, y, C.night);
  for (let y = OY + 8; y < 208; y += 32) for (let x = OX + 8; x < W - 8; x += 32) { p.p(x, y, C.slate); p.p(x + 1, y, C.slate); }
}
function floorGrate(R: Room) {
  const p = R.p;
  p.r(OX, OY, W - 16, 160, C.night);
  for (let y = OY; y < 208; y += 4) p.r(OX, y, W - 16, 1, C.steel);
  for (let x = OX; x < W - 8; x += 4) for (let y = OY; y < 208; y += 4) { p.p(x, y + 1, C.steel); p.p(x, y, C.slate); }
  for (let y = OY; y < 208; y += 16) p.r(OX, y + 15, W - 16, 1, C.ink);
  for (let x = OX; x < W - 8; x += 48) p.r(x, OY, 1, 160, C.ink);
}
function floorStone(R: Room) {
  const p = R.p;
  p.r(OX, OY, W - 16, 160, C.plum);
  for (let y = OY; y < 208; y += 12) {
    let x = OX - Math.floor(R.r() * 10);
    while (x < W - 8) {
      const w = 10 + Math.floor(R.r() * 9), c = R.r() < 0.5 ? C.slate : C.steel;
      p.r(x + 1, y + 1, w - 1, 11, c); p.r(x + 1, y + 1, w - 2, 1, c === C.slate ? C.fog : C.slate); p.r(x + 1, y + 11, w - 1, 1, C.night);
      if (R.r() < 0.3) p.p(x + 3 + Math.floor(R.r() * (w - 6)), y + 4 + Math.floor(R.r() * 5), C.night);
      x += w;
    }
  }
}

// ------------------------------------------------------------------ things on the walls
type Star = [number, number, Col];
function spaceWindow(R: Room, x: number, y: number, w: number, h: number, o: { planet?: [number, number, number]; panes?: number; frame?: Col } = {}): Star[] {
  const p = R.p, fr = o.frame ?? C.slate;
  p.r(x - 3, y - 3, w + 6, h + 6, C.ink); p.r(x - 2, y - 2, w + 4, h + 4, fr); p.r(x - 2, y - 2, w + 4, 1, C.fog); p.r(x - 1, y - 1, w + 2, h + 2, C.ink);
  p.r(x, y, w, h, C.ink);
  // a nebula, dithered
  for (let k = 0; k < 3; k++) {
    const nx = x + R.r() * w, ny = y + R.r() * h, nr = 6 + R.r() * 12, c = k % 2 ? C.grape : C.navy;
    for (let j = -nr; j < nr; j++) for (let i = -nr * 1.6; i < nr * 1.6; i++) {
      const px = Math.round(nx + i), py = Math.round(ny + j);
      if (px < x || py < y || px >= x + w || py >= y + h) continue;
      const q = Math.hypot(i / 1.6, j) / nr;
      if (q < 1 && (px + py) % 2 === 0 && R.r() > q * 0.9) p.p(px, py, q < 0.45 && (px % 4 === 0) ? c : C.night);
    }
  }
  const stars: Star[] = [];
  for (let k = 0; k < (w * h) / 26; k++) { const sx = x + Math.floor(R.r() * w), sy = y + Math.floor(R.r() * h), c = R.r() < 0.15 ? C.white : R.r() < 0.5 ? C.mist : C.fog; p.p(sx, sy, c); if (k % 5 === 0) stars.push([sx, sy, c]); }
  for (let k = 0; k < Math.max(1, w / 50); k++) { const sx = x + 4 + Math.floor(R.r() * (w - 8)), sy = y + 3 + Math.floor(R.r() * (h - 6)); p.p(sx, sy, C.white); p.p(sx - 1, sy, C.fog); p.p(sx + 1, sy, C.fog); p.p(sx, sy - 1, C.fog); p.p(sx, sy + 1, C.fog); }
  if (o.planet) {
    const [px, py, pr] = o.planet;
    const g = p.g; g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    p.ell(px, py, pr, pr, C.grape); p.ell(px - 1, py - 1, pr - 2, pr - 2, C.rose);
    for (let j = -pr; j <= pr; j++) for (let i = -pr; i <= pr; i++) { const d = Math.hypot(i + pr * 0.35, j + pr * 0.35); if (d < pr * 0.62 && Math.hypot(i, j) < pr - 1) p.p(px + i, py + j, (i + j) % 2 && d > pr * 0.45 ? C.rose : C.pink); }
    for (let j = -pr; j <= pr; j++) for (let i = -pr; i <= pr; i++) if (Math.hypot(i, j) < pr && Math.hypot(i - pr * 0.5, j - pr * 0.4) > pr * 0.95 && (i + j) % 2 === 0) p.p(px + i, py + j, C.grape);
    for (let i = -pr - 7; i <= pr + 7; i++) { const yy = Math.round(py + i * 0.28); if (Math.abs(i) > pr - 2 || yy > py) { p.p(px + i, yy, C.sand); p.p(px + i, yy + 1, C.tan); } }
    g.restore();
  }
  const panes = o.panes ?? 1;
  for (let k = 1; k < panes; k++) { const mx = Math.round(x + (w * k) / panes); p.r(mx - 1, y, 3, h, fr); p.r(mx - 1, y, 1, h, C.fog); p.r(mx + 1, y, 1, h, C.ink); }
  p.r(x - 4, y + h + 2, w + 8, 2, C.fog); p.r(x - 4, y + h + 4, w + 8, 1, C.ink);
  p.p(x + 2, y + 2, C.steel); p.p(x + 3, y + 2, C.steel); p.p(x + 2, y + 3, C.steel);
  return stars;
}
function twinkle(stars: Star[]) {
  return (p: Pix, L: Live) => {
    if (L.still) return;
    const k = Math.floor(L.t / 400);
    for (let i = 0; i < stars.length; i++) if ((i * 7 + k) % 11 === 0) { const [x, y] = stars[i]!; p.p(x, y, C.night); } else if ((i * 3 + k) % 13 === 0) { const [x, y] = stars[i]!; p.p(x, y, C.white); }
  };
}
function sign(R: Room, x: number, y: number, text: string, plate: Col = C.night, ink: Col = C.fog) {
  const p = R.p, w = text.length * 4 + 7;
  p.r(x - w / 2, y, w, 9, C.ink); p.r(x - w / 2 + 1, y + 1, w - 2, 7, plate); p.r(x - w / 2 + 1, y + 1, w - 2, 1, C.slate);
  p.text(text, x, y + 2, ink, 0.5);
}
function clock(R: Room, x: number, y: number) {
  const p = R.p;
  p.ell(x, y, 6, 6, C.ink); p.ell(x, y, 5, 5, C.mist); p.p(x, y - 4, C.slate); p.p(x + 4, y, C.slate); p.p(x, y + 4, C.slate); p.p(x - 4, y, C.slate);
  R.wall.push((pp, L) => {
    const d = new Date(L.now), h = (d.getUTCHours() % 12) + d.getUTCMinutes() / 60, m = d.getUTCMinutes();
    const hand = (a: number, len: number, c: Col) => { for (let k = 1; k <= len; k++) pp.p(Math.round(x + Math.sin(a) * k), Math.round(y - Math.cos(a) * k), c); };
    hand((m / 60) * Math.PI * 2, 4, C.steel); hand((h / 12) * Math.PI * 2, 3, C.ink); pp.p(x, y, C.red);
  });
}
function frame(R: Room, x: number, y: number, w: number, h: number, art: (p: Pix) => void, fr: Col = C.amber) {
  const p = R.p;
  p.r(x - 2, y - 2, w + 4, h + 4, C.ink); p.r(x - 1, y - 1, w + 2, h + 2, fr); p.r(x - 1, y - 1, w + 2, 1, C.lemon); p.r(x, y, w, h, C.ink);
  const g = p.g; g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y); art(p); g.restore();
}
function pipeH(p: Pix, x: number, y: number, w: number, d = 5) { p.r(x, y, w, d, C.slate); p.r(x, y, w, 1, C.fog); p.r(x, y + d - 1, w, 1, C.steel); p.r(x, y + d, w, 1, C.ink); for (let k = x + 12; k < x + w - 4; k += 38) { p.r(k, y - 1, 3, d + 2, C.fog); p.r(k + 2, y - 1, 1, d + 2, C.steel); } }
function pipeV(p: Pix, x: number, y: number, h: number, d = 5) { p.r(x, y, d, h, C.slate); p.r(x, y, 1, h, C.fog); p.r(x + d - 1, y, 1, h, C.steel); for (let k = y + 6; k < y + h - 3; k += 16) { p.r(x - 1, k, d + 2, 2, C.fog); } }

// ------------------------------------------------------------------ furniture (each drawn in its own little canvas)
function deskArt(p: Pix, r: () => number, o: { w?: number; screen?: boolean; tone?: "wood" | "metal" } = {}) {
  const w = o.w ?? 32, metal = o.tone === "metal";
  const top = metal ? C.fog : C.tan, topHi = metal ? C.mist : C.sand, front = metal ? C.slate : C.wood, frontLo = metal ? C.steel : C.bark;
  p.r(1, 13, w - 2, 9, C.ink); p.r(2, 14, w - 4, 7, top); p.r(2, 14, w - 4, 1, topHi); p.r(2, 20, w - 4, 1, front);
  p.r(1, 21, w - 2, 9, C.ink); p.r(2, 21, w - 4, 7, front); p.r(2, 26, w - 4, 2, frontLo);
  p.r(5, 23, 8, 3, frontLo); p.p(9, 24, topHi); p.r(3, 28, 2, 2, C.ink); p.r(w - 5, 28, 2, 2, C.ink);
  if (o.screen !== false) {
    // a monitor on the right half, its back to us, the screen's light on the desk
    const mx = w - 15;
    p.r(mx, 2, 13, 11, C.ink); p.r(mx + 1, 3, 11, 9, C.steel); p.r(mx + 1, 3, 11, 1, C.slate); p.p(mx + 6, 7, C.slate);
    p.r(mx + 5, 12, 3, 3, C.ink); p.r(mx + 3, 15, 7, 1, C.night);
  }
  // little things: a mug, papers, a plant
  const k = r();
  if (k < 0.35) { p.r(5, 14, 4, 4, C.ink); p.r(6, 14, 2, 3, C.mist); p.p(6, 14, C.bark); p.p(9, 15, C.ink); }
  else if (k < 0.7) { p.r(4, 15, 8, 4, C.mist); p.r(5, 15, 6, 1, C.white); p.r(5, 17, 5, 1, C.fog); }
  else { p.r(5, 9, 5, 5, C.moss); p.p(6, 8, C.leaf); p.p(8, 9, C.leaf); p.r(5, 14, 5, 4, C.rust); p.r(5, 14, 5, 1, C.clay); }
  if (o.screen !== false && r() < 0.5) { p.r(w - 26, 16, 9, 2, C.night); p.r(w - 26, 16, 9, 1, C.slate); }
}
function chairArt(p: Pix, seat: Col = C.night, hi: Col = C.steel) {
  p.r(1, 0, 12, 12, C.ink); p.r(2, 1, 10, 10, seat); p.r(2, 1, 10, 1, hi); p.r(3, 2, 1, 8, hi);
  p.r(5, 12, 4, 2, C.ink);
}
function consoleArt(p: Pix, r: () => number, w = 32) {
  p.r(0, 6, w, 18, C.ink); p.r(1, 7, w - 2, 7, C.slate); p.r(1, 7, w - 2, 1, C.fog);
  p.r(1, 14, w - 2, 9, C.steel); p.r(1, 21, w - 2, 2, C.night);
  // screens facing up at the crew, and a row of buttons
  p.r(3, 0, 11, 8, C.ink); p.r(4, 1, 9, 6, C.teal); p.r(w - 14, 0, 11, 8, C.ink); p.r(w - 13, 1, 9, 6, C.navy);
  for (let i = 0; i < 7; i++) p.p(4 + i * 4, 10, [C.red, C.amber, C.leaf, C.cyan][Math.floor(r() * 4)]!);
  p.r(4, 16, w - 8, 2, C.night); p.r(w / 2 - 3, 12, 6, 1, C.ink);
}
function consoleAnim(x: number, y: number, w = 32, seed = 1) {
  return (p: Pix, L: Live) => {
    const k = L.still ? 0 : Math.floor(L.t / 260 + seed);
    for (let i = 0; i < 4; i++) p.r(x + 5, y + 2 + i, ((k * 3 + i * 5 + seed) % 7) + 1, 1, i % 2 ? C.pine : C.leaf);
    for (let i = 0; i < 3; i++) p.r(x + w - 12, y + 2 + i * 2, ((k + i * 3 + seed) % 6) + 2, 1, C.sky);
    p.p(x + 4 + ((k + seed) % 7) * 4, y + 10, C.white);
  };
}
function plantArt(p: Pix, r: () => number, kind = 0) {
  const pot = kind === 2 ? C.slate : C.rust, potHi = kind === 2 ? C.fog : C.clay;
  p.r(3, 18, 10, 8, C.ink); p.r(4, 19, 8, 6, pot); p.r(4, 19, 8, 1, potHi); p.r(5, 24, 6, 1, C.bark);
  if (kind === 0) {
    for (const [x, h, c] of [[5, 14, C.moss], [7, 18, C.pine], [9, 15, C.moss], [11, 11, C.pine], [6, 10, C.leaf]] as [number, number, Col][]) { p.r(x - 1, 19 - h, 3, h, C.ink); p.r(x, 19 - h + 1, 1, h - 1, c); p.p(x, 19 - h + 1, C.leaf); }
  } else if (kind === 1) {
    p.ell(8, 12, 7, 6, C.ink); p.ell(8, 12, 6, 5, C.moss); p.ell(6, 10, 3, 2, C.leaf); p.p(10, 13, C.pine); p.p(4, 13, C.pine); p.p(11, 9, C.leaf);
  } else {
    for (let k = 0; k < 5; k++) { const a = -2.4 + k * 0.6; for (let s = 0; s < 9; s++) { const x = Math.round(8 + Math.cos(a) * s), y = Math.round(16 + Math.sin(a) * s * 0.9 + (s * s) / 18); p.p(x, y, s > 6 ? C.leaf : C.moss); p.p(x, y + 1, C.pine); } }
    p.r(7, 12, 2, 7, C.bark);
  }
  void r;
}
function shelfArt(p: Pix, r: () => number, w = 30, h = 44) {
  p.r(0, 0, w, h, C.ink); p.r(1, 1, w - 2, h - 2, C.bark); p.r(1, 1, w - 2, 1, C.wood);
  const books = [C.wine, C.navy, C.moss, C.grape, C.amber, C.teal, C.rust, C.slate];
  for (let s = 0; s < 3; s++) {
    const y = 3 + s * 13;
    p.r(2, y, w - 4, 10, C.plum);
    let x = 3;
    while (x < w - 4) {
      if (r() < 0.12) { p.ell(x + 2, y + 7, 2, 2, C.sky); p.p(x + 1, y + 6, C.leaf); p.r(x + 1, y + 9, 3, 1, C.amber); x += 6; continue; }
      const bw = 2 + Math.floor(r() * 2), bh = 6 + Math.floor(r() * 4), c = books[Math.floor(r() * books.length)]!;
      p.r(x, y + 10 - bh, bw, bh, c); p.r(x, y + 10 - bh, 1, bh, C.ink); p.p(x + bw - 1, y + 11 - bh + 1, C.sand);
      x += bw + (r() < 0.2 ? 1 : 0);
    }
    p.r(2, y + 10, w - 4, 2, C.wood); p.r(2, y + 11, w - 4, 1, C.bark);
  }
}
function lampArt(p: Pix) {
  p.r(2, 0, 9, 1, C.ink); p.r(1, 1, 11, 6, C.ink); p.r(2, 1, 9, 5, C.sand); p.r(2, 1, 9, 1, C.white); p.r(2, 5, 9, 1, C.tan); p.r(4, 6, 5, 1, C.lemon);
  p.r(5, 7, 3, 20, C.ink); p.r(6, 7, 1, 20, C.steel); p.r(3, 26, 7, 3, C.ink); p.r(4, 26, 5, 2, C.steel);
}
function tableArt(p: Pix, r: () => number, w: number, h: number, o: { cloth?: boolean } = {}) {
  p.r(0, 0, w, h - 8, C.ink); p.r(1, 1, w - 2, h - 10, C.tan); p.r(1, 1, w - 2, 1, C.sand);
  if (o.cloth) { p.r(4, 1, w - 8, h - 10, C.mist); p.r(4, 1, w - 8, 1, C.white); for (let x = 6; x < w - 6; x += 4) p.p(x, h - 10, C.fog); }
  p.r(0, h - 9, w, 5, C.ink); p.r(1, h - 9, w - 2, 3, C.wood); p.r(1, h - 7, w - 2, 1, C.bark);
  p.r(2, h - 5, 3, 5, C.ink); p.r(w - 5, h - 5, 3, 5, C.ink); p.r(3, h - 5, 1, 4, C.bark); p.r(w - 4, h - 5, 1, 4, C.bark);
  // what is on it
  for (let x = 8; x < w - 8; x += 14) {
    const k = r();
    if (k < 0.4) { p.ell(x, 5 + Math.floor(r() * (h - 18)), 3, 2, C.white); }
    else if (k < 0.7) { const y = 3 + Math.floor(r() * (h - 18)); p.r(x - 1, y, 4, 4, C.ink); p.r(x, y, 2, 3, C.mist); p.p(x, y, C.bark); }
    else { const y = 2 + Math.floor(r() * (h - 18)); p.r(x, y, 2, 5, C.sand); p.p(x, y - 1, C.amber); p.p(x, y - 2, C.lemon); }
  }
}
function roundTableArt(p: Pix) {
  p.ell(15, 7, 14, 6, C.ink); p.ell(15, 7, 13, 5, C.tan); p.ell(15, 6, 11, 3, C.sand); p.r(2, 9, 27, 2, C.wood);
  p.r(13, 12, 5, 9, C.ink); p.r(14, 12, 3, 9, C.steel); p.r(9, 20, 13, 3, C.ink); p.r(10, 20, 11, 2, C.steel);
  p.r(8, 3, 4, 4, C.ink); p.r(9, 3, 2, 3, C.white); p.p(9, 3, C.bark); p.ell(21, 6, 3, 1, C.mist); p.p(21, 5, C.tan);
}
function stoolArt(p: Pix, seat: Col = C.wine) { p.ell(6, 3, 6, 3, C.ink); p.ell(6, 3, 5, 2, seat); p.r(2, 2, 8, 1, C.rose); p.r(5, 6, 3, 6, C.ink); p.r(6, 6, 1, 6, C.fog); p.r(3, 11, 7, 2, C.ink); }
function armchairArt(p: Pix, c: Col = C.wine, hi: Col = C.red) {
  p.r(1, 0, 20, 14, C.ink); p.r(2, 1, 18, 12, c); p.r(2, 1, 18, 1, hi); for (let x = 5; x < 18; x += 5) p.p(x, 6, C.plum);
  p.r(0, 9, 5, 13, C.ink); p.r(1, 10, 3, 11, c); p.r(1, 10, 3, 1, hi); p.r(17, 9, 5, 13, C.ink); p.r(18, 10, 3, 11, c); p.r(18, 10, 3, 1, hi);
  p.r(4, 13, 14, 8, C.ink); p.r(5, 13, 12, 6, c); p.r(5, 13, 12, 1, hi); p.r(2, 21, 2, 2, C.ink); p.r(18, 21, 2, 2, C.ink);
}
function couchArt(p: Pix, w = 50) {
  p.r(0, 0, w, 14, C.ink); p.r(1, 1, w - 2, 12, C.grape); p.r(1, 1, w - 2, 1, C.rose);
  for (let x = 4; x < w - 4; x += 15) { p.r(x, 3, 13, 8, C.rose); p.r(x, 3, 13, 1, C.pink); p.r(x, 10, 13, 1, C.grape); }
  p.r(0, 10, 6, 14, C.ink); p.r(1, 11, 4, 12, C.grape); p.r(1, 11, 4, 1, C.rose); p.r(w - 6, 10, 6, 14, C.ink); p.r(w - 5, 11, 4, 12, C.grape); p.r(w - 5, 11, 4, 1, C.rose);
  p.r(5, 14, w - 10, 9, C.ink); p.r(6, 14, w - 12, 6, C.rose); p.r(6, 14, w - 12, 1, C.pink); p.r(6, 20, w - 12, 2, C.grape);
}
/** A Night Boss's plinth: a round stone pedestal, a gold band, a brass plate. */
function plinthArt(p: Pix, gold: boolean) {
  p.ell(11, 18, 10, 3, C.ink); p.ell(11, 17, 9, 2, C.slate);
  p.r(4, 7, 15, 11, C.ink); p.r(5, 7, 13, 10, C.fog); p.r(5, 7, 2, 10, C.mist); p.r(15, 7, 3, 10, C.slate); p.r(9, 7, 1, 10, C.mist);
  p.r(5, 9, 13, 1, gold ? C.amber : C.slate); p.r(5, 10, 13, 1, gold ? C.bark : C.steel);
  p.ell(11, 6, 9, 3, C.ink); p.ell(11, 6, 8, 2, C.mist); p.ell(10, 5, 5, 1, C.white);
  p.r(8, 12, 7, 3, C.ink); p.r(9, 12, 5, 2, C.amber); p.p(9, 12, C.lemon);
}
function counterArt(p: Pix, r: () => number, w: number) {
  p.r(0, 10, w, 24, C.ink); p.r(1, 11, w - 2, 5, C.sand); p.r(1, 11, w - 2, 1, C.white); p.r(1, 15, w - 2, 1, C.tan);
  for (let x = 1; x < w - 1; x += 6) { p.r(x, 16, 6, 16, C.wood); p.r(x, 16, 1, 16, C.tan); p.r(x + 5, 16, 1, 16, C.bark); }
  p.r(1, 30, w - 2, 2, C.bark);
  // the espresso machine, the mugs, a pastry dome, the till
  p.r(8, 0, 22, 13, C.ink); p.r(9, 1, 20, 11, C.mist); p.r(9, 1, 20, 1, C.white); p.r(26, 2, 2, 9, C.fog); p.r(11, 4, 3, 2, C.lemon); p.p(16, 4, C.red); p.p(19, 4, C.leaf);
  p.r(13, 8, 2, 3, C.ink); p.r(21, 8, 2, 3, C.ink); p.r(12, 11, 4, 2, C.white); p.r(20, 11, 4, 2, C.white);
  for (let k = 0; k < 4; k++) { const x = 36 + k * 6, c = [C.white, C.sky, C.pink, C.leaf][k]!; p.r(x, 8, 5, 5, C.ink); p.r(x + 1, 8, 3, 4, c); p.r(x + 4, 9, 1, 2, C.ink); }
  const dx = Math.min(w - 26, 66);
  p.ell(dx + 7, 9, 7, 5, C.ink); p.ell(dx + 7, 9, 6, 4, C.mist); p.ell(dx + 7, 10, 5, 2, C.tan); p.p(dx + 5, 9, C.wood); p.p(dx + 9, 9, C.wood); p.p(dx + 5, 6, C.white); p.r(dx + 6, 3, 2, 2, C.ink);
  if (w > 96) { const tx = w - 20; p.r(tx, 3, 14, 10, C.ink); p.r(tx + 1, 4, 12, 8, C.steel); p.r(tx + 2, 5, 10, 3, C.pine); p.r(tx + 3, 6, 6, 1, C.leaf); }
  void r;
}
function steamAnim(x: number, y: number) {
  return (p: Pix, L: Live) => {
    if (L.still) return;
    for (let k = 0; k < 3; k++) { const ph = ((L.t / 900 + k / 3) % 1), yy = Math.round(y - ph * 10), xx = Math.round(x + Math.sin(ph * 6 + k) * 1.5); if (ph < 0.85) p.p(xx, yy, ph < 0.5 ? C.white : C.mist); }
  };
}
function arcadeArt(p: Pix, body: Col, side: Col) {
  p.r(0, 0, 18, 42, C.ink); p.r(1, 1, 16, 40, body); p.r(1, 1, 2, 40, side); p.r(15, 1, 2, 40, C.ink);
  p.r(2, 2, 14, 6, C.amber); p.r(2, 2, 14, 1, C.lemon); p.text("NS", 9, 3, C.ink, 0.5);
  p.r(3, 10, 12, 11, C.ink); p.r(4, 11, 10, 9, C.night);
  p.r(1, 22, 16, 6, C.slate); p.r(1, 22, 16, 1, C.fog); p.r(4, 22, 2, 2, C.ink); p.r(4, 21, 2, 1, C.red); p.p(10, 24, C.red); p.p(13, 24, C.sky);
  p.r(5, 31, 8, 4, C.ink); p.r(6, 32, 2, 2, C.amber); p.r(10, 32, 2, 2, C.amber);
}
function arcadeAnim(x: number, y: number, seed: number) {
  return (p: Pix, L: Live) => {
    const k = L.still ? 0 : Math.floor(L.t / 300 + seed * 5);
    for (let i = 0; i < 3; i++) { const ix = x + 5 + ((i * 3 + k) % 6), iy = y + 12 + i * 2; p.p(ix, iy, seed % 2 ? C.leaf : C.pink); p.p(ix + 1, iy, seed % 2 ? C.leaf : C.pink); }
    p.p(x + 5 + (k % 8), y + 18, C.lemon); p.r(x + 4, y + 19, 10, 1, C.steel);
  };
}
function vendingArt(p: Pix) {
  p.r(0, 0, 24, 42, C.ink); p.r(1, 1, 22, 40, C.wine); p.r(1, 1, 22, 1, C.red); p.r(20, 1, 3, 40, C.plum);
  p.r(3, 4, 14, 24, C.ink); p.r(4, 5, 12, 22, C.night);
  const cans = [C.red, C.leaf, C.sky, C.amber, C.pink, C.cyan];
  for (let row = 0; row < 4; row++) { for (let i = 0; i < 4; i++) { p.r(5 + i * 3, 7 + row * 5, 2, 3, cans[(row + i) % cans.length]!); p.p(5 + i * 3, 7 + row * 5, C.white); } p.r(4, 10 + row * 5, 12, 1, C.steel); }
  p.r(18, 6, 2, 6, C.mist); p.p(18, 14, C.leaf); p.p(19, 14, C.red); p.r(4, 31, 12, 5, C.ink); p.r(5, 32, 10, 3, C.plum);
}
function coolerArt(p: Pix) {
  p.ell(6, 5, 5, 5, C.ink); p.ell(6, 5, 4, 4, C.sky); p.r(4, 2, 2, 5, C.cyan); p.r(2, 9, 9, 2, C.ink);
  p.r(1, 10, 11, 18, C.ink); p.r(2, 11, 9, 16, C.mist); p.r(2, 11, 9, 1, C.white); p.r(9, 11, 2, 16, C.fog); p.p(4, 15, C.red); p.p(7, 15, C.sky); p.r(3, 19, 7, 1, C.fog);
}
function podArt(p: Pix) {
  p.r(1, 6, 24, 36, C.ink); p.ell(13, 9, 12, 9, C.ink);
  p.r(2, 9, 22, 32, C.mist); p.ell(13, 9, 11, 8, C.mist); p.ell(10, 6, 6, 3, C.white);
  p.r(20, 9, 4, 32, C.fog); p.r(2, 9, 1, 32, C.white);
  p.ell(13, 18, 7, 7, C.ink); p.ell(13, 18, 6, 6, C.slate); p.ell(13, 18, 5, 5, C.navy); p.p(10, 15, C.sky); p.p(11, 14, C.sky);
  p.r(5, 30, 16, 1, C.fog); p.r(5, 33, 16, 1, C.fog);
  for (let x = 2; x < 24; x += 4) { p.r(x, 38, 2, 3, C.amber); p.r(x + 2, 38, 2, 3, C.ink); }
  p.r(9, 26, 8, 2, C.ink);
}
function crateArt(p: Pix, w = 16, h = 16) {
  p.r(0, 0, w, h, C.ink); p.r(1, 1, w - 2, h - 2, C.wood); p.r(1, 1, w - 2, 1, C.tan); p.r(1, h - 3, w - 2, 2, C.bark);
  for (let k = 1; k < w - 1; k++) { const y = 1 + Math.round(((k - 1) / (w - 3)) * (h - 4)); p.p(k, y, C.bark); }
  p.r(1, 1, 2, h - 2, C.clay2); p.r(w - 3, 1, 2, h - 2, C.clay2);
}
function barrelArt(p: Pix, c: Col = C.red, hi: Col = C.pink, lo: Col = C.wine) {
  p.ell(7, 3, 7, 3, C.ink); p.r(0, 3, 15, 16, C.ink); p.r(1, 3, 13, 15, c); p.r(1, 3, 2, 15, hi); p.r(11, 3, 3, 15, lo);
  p.ell(7, 3, 6, 2, lo); p.ell(7, 3, 4, 1, C.ink); p.r(1, 7, 13, 1, C.ink); p.r(1, 13, 13, 1, C.ink);
}
function panelArt(p: Pix, r: () => number, w = 30) {
  p.r(0, 0, w, 28, C.ink); p.r(1, 1, w - 2, 26, C.slate); p.r(1, 1, w - 2, 1, C.fog); p.r(w - 3, 1, 2, 26, C.steel);
  for (let k = 0; k < 2; k++) { const gx = 7 + k * 13; p.ell(gx, 8, 5, 5, C.ink); p.ell(gx, 8, 4, 4, C.mist); p.p(gx, 4, C.red); }
  p.r(3, 16, w - 6, 5, C.ink); for (let i = 0; i < 5; i++) p.p(5 + i * 5, 18, [C.leaf, C.amber, C.red, C.cyan][Math.floor(r() * 4)]!);
  p.r(5, 22, 2, 5, C.ink); p.r(4, 21, 4, 2, C.red); p.r(w - 9, 22, 2, 5, C.ink); p.r(w - 10, 21, 4, 2, C.amber);
}
function gaugeAnim(x: number, y: number, w = 30, seed = 0) {
  return (p: Pix, L: Live) => {
    for (let k = 0; k < 2; k++) {
      const gx = x + 7 + k * 13, gy = y + 8, a = -2.2 + 1.4 * (0.5 + 0.5 * Math.sin((L.still ? 0 : L.t / (1700 + k * 600)) + seed + k)) * 2.2;
      for (let s = 1; s <= 3; s++) p.p(Math.round(gx + Math.cos(a) * s), Math.round(gy + Math.sin(a) * s), C.ink);
    }
    void w;
  };
}
function anvilArt(p: Pix) {
  p.r(4, 10, 14, 12, C.ink); p.r(5, 11, 12, 10, C.wood); p.r(5, 11, 12, 1, C.tan); p.ell(11, 15, 4, 2, C.bark); p.r(5, 19, 12, 2, C.bark);
  p.r(2, 2, 18, 6, C.ink); p.r(0, 3, 4, 3, C.ink); p.r(3, 3, 16, 4, C.steel); p.r(3, 3, 16, 1, C.fog); p.r(1, 4, 3, 1, C.slate);
  p.r(7, 7, 8, 4, C.ink); p.r(8, 7, 6, 3, C.night);
}
function furnaceArt(p: Pix, w = 76, h = 66) {
  // brick body, an arched mouth, a stone sill
  p.r(2, 14, w - 4, h - 14, C.ink); p.ell(w / 2, 16, w / 2 - 2, 14, C.ink);
  p.r(3, 16, w - 6, h - 17, C.rust); p.ell(w / 2, 16, w / 2 - 3, 13, C.rust);
  for (let y = 4; y < h - 4; y += 5) for (let x = 3 + ((y / 5) % 2) * 5; x < w - 3; x += 10) { p.r(x, y, 1, 5, C.bark); }
  for (let y = 8; y < h - 2; y += 5) p.r(3, y, w - 6, 1, C.bark);
  for (let y = 4; y < 16; y++) for (let x = 3; x < w - 3; x++) if (Math.hypot((x - w / 2) / (w / 2 - 3), (y - 16) / 13) > 1) p.g.clearRect(x, y, 1, 1);
  p.g.clearRect(0, 0, w, 3);
  p.r(3, 16, 3, h - 17, C.clay); p.r(w - 8, 16, 5, h - 17, C.wine);
  const mx = w / 2 - 15;
  p.ell(w / 2, 36, 16, 12, C.ink); p.r(mx - 1, 36, 32, 16, C.ink); p.ell(w / 2, 36, 15, 11, C.plum); p.r(mx, 36, 30, 15, C.plum);
  p.r(mx - 4, 51, 38, 5, C.ink); p.r(mx - 3, 52, 36, 3, C.fog); p.r(mx - 3, 52, 36, 1, C.mist);
  p.r(0, h - 6, w, 6, C.ink); p.r(1, h - 5, w - 2, 4, C.slate); p.r(1, h - 5, w - 2, 1, C.fog);
}
function fireAnim(cx: number, by: number) {
  return (p: Pix, L: Live) => {
    const k = L.still ? 3 : Math.floor(L.t / 110);
    for (let i = -13; i <= 13; i++) {
      const h = Math.max(2, Math.round(9 + 6 * Math.sin(i * 0.5 + k * 0.9) + 3 * Math.sin(i * 1.7 - k * 1.3) - Math.abs(i) * 0.45));
      for (let j = 0; j < h; j++) {
        const f = j / h, c = f < 0.3 ? C.lemon : f < 0.55 ? C.amber : f < 0.8 ? C.orange : C.red;
        if (f > 0.8 && (i + j + k) % 2) continue;
        p.p(cx + i, by - j, c);
      }
    }
    if (!L.still) for (let s = 0; s < 3; s++) { const ph = (L.t / 1300 + s * 0.37) % 1; p.p(Math.round(cx - 8 + s * 8 + Math.sin(ph * 9) * 2), Math.round(by - 14 - ph * 30), ph < 0.5 ? C.lemon : C.orange); }
  };
}

// ------------------------------------------------------------------ the radar, the mission board, the pods, the memorial
/** Same scale as the old scene: a blip nearer the centre is a loan closer to the liquidation line. */
const radius = (cr: number) => Math.max(0.08, Math.min(1, Math.log(cr / 100) / Math.log(6)));
function radarArt(p: Pix) {
  p.ell(40, 22, 39, 20, C.ink); p.ell(40, 22, 38, 19, C.slate); p.ell(40, 21, 37, 18, C.fog); p.ell(40, 22, 36, 17, C.slate);
  p.ell(40, 22, 33, 15, C.ink); p.ell(40, 22, 32, 14, C.teal);
  p.ring(40, 22, 22, 9.5, C.pine); p.ring(40, 22, 11, 5, C.pine); p.r(8, 22, 65, 1, C.pine); p.r(40, 8, 1, 29, C.pine);
  p.r(2, 25, 77, 10, C.ink); p.r(3, 25, 75, 9, C.steel); p.r(3, 25, 75, 1, C.slate); p.r(3, 32, 75, 2, C.night);
  for (let x = 8; x < 74; x += 9) p.p(x, 29, x % 2 ? C.amber : C.leaf);
  p.r(30, 34, 21, 10, C.ink); p.r(31, 34, 19, 9, C.night); p.r(31, 34, 19, 1, C.steel);
}
function radarAnim(x: number, y: number) {
  const cx = x + 40, cy = y + 22, rx = 31, ry = 13.5;
  return (p: Pix, L: Live) => {
    const radar = L.snap?.radar;
    if (radar) p.ring(cx, cy, rx * radius(radar.mat), ry * radius(radar.mat), C.red, 3);
    const sweep = L.still ? -0.6 : (L.t / 4500) * Math.PI * 2;
    for (let k = 0; k < 18; k++) {
      const a = sweep - k * 0.05;
      for (let s = 2; s < rx; s += 1) { const px = Math.round(cx + Math.cos(a) * s), py = Math.round(cy + Math.sin(a) * s * (ry / rx)); if (k === 0) p.p(px, py, C.leaf); else if ((px + py + k) % 3 === 0 && k < 12) p.p(px, py, C.moss); }
    }
    if (radar) for (const l of radar.loans) {
      const a = (l.a * Math.PI) / 180, d = radius(l.cr), bx = Math.round(cx + Math.cos(a) * rx * d), by = Math.round(cy + Math.sin(a) * ry * d);
      let since = (sweep - a) % (Math.PI * 2); if (since < 0) since += Math.PI * 2;
      const lit = L.still || since < 2.2;
      const c = l.state === "actionable" ? C.red : l.state === "grace" ? C.pink : l.cr < radar.mat * 1.15 ? C.amber : C.leaf;
      const big = l.debt >= 1000;
      p.p(bx, by, lit ? (since < 0.5 && !L.still ? C.white : c) : C.moss);
      if (big) { p.p(bx + 1, by, lit ? c : C.pine); p.p(bx, by + 1, lit ? c : C.pine); p.p(bx + 1, by + 1, lit ? c : C.pine); }
    }
    // the live count on the pedestal's screen
    p.text(radar ? String(radar.loans.length) : "--", x + 40, y + 36, C.leaf, 0.5);
  };
}
function missionBoard(R: Room, x: number, y: number, w: number, h: number, st: ShipStatic) {
  const p = R.p;
  p.r(x - 2, y - 2, w + 4, h + 4, C.ink); p.r(x - 1, y - 1, w + 2, h + 2, C.slate); p.r(x - 1, y - 1, w + 2, 1, C.fog); p.r(x, y, w, h, C.ink); p.r(x + 1, y + 1, w - 2, h - 2, C.teal);
  p.text("MISSIONS", x + 4, y + 3, C.lemon);
  st.missions.slice(0, 3).forEach((m, i) => {
    const max = Math.floor((w - 12) / 4), t = m.title.length > max ? `${m.title.slice(0, max - 1)}.` : m.title;
    p.r(x + 4, y + 11 + i * 6, 2, 2, C.leaf); p.text(t, x + 8, y + 10 + i * 6, C.mist);
  });
  R.wall.push((pp, L) => {
    const n = L.snap?.totals.onMissions;
    const s = n === undefined ? "OUT --" : `OUT ${n}`;
    pp.r(x + w - 4 - s.length * 4, y + 2, s.length * 4 + 1, 7, C.teal); pp.text(s, x + w - 4, y + 3, n ? C.amber : C.leaf, 1);
    if (!L.still && Math.floor(L.t / 700) % 2) pp.r(x + w - 8, y + h - 4, 3, 1, C.leaf);
  });
}
/** A head of the frog `id` at portrait size, if it is drawn yet. */
function portrait(p: Pix, L: Live, id: number, x: number, y: number, w: number, h: number) {
  const hd = L.faces.get(id, 0.5);
  if (!hd) { p.r(x + 2, y + 3, w - 4, h - 5, C.steel); return; }
  const g = p.g; g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.drawImage(hd.front, Math.round(x + (w - hd.w) / 2), Math.round(y + h - 1 - hd.chin));
  g.restore();
}

// ------------------------------------------------------------------ the rooms
type Build = (st: ShipStatic) => RoomDef;

const bridge: Build = (st) => {
  const R = new Room("bridge", 11);
  walls(R, { face: C.steel, seam: C.night, low: C.night, lowHi: C.slate, base: C.ink, trim: C.slate });
  floorPlates(R, C.steel, C.night, C.slate, 32);
  // the dais round the radar, in darker plates
  R.p.ell(176, 120, 92, 40, C.night); R.p.ring(176, 120, 92, 40, C.slate); R.p.ring(176, 120, 84, 36, C.steel);
  const stars = spaceWindow(R, 24, 9, 304, 26, { planet: [66, 33, 15], panes: 6 });
  R.wall.push(twinkle(stars));
  sign(R, 176, 1, "BRIDGE · NIGHT WATCH");
  // the forward consoles under the window, three a side, their crew facing the room
  for (const tx of [1, 3, 5, 14, 16, 18]) {
    const x = tx2x(tx), y = ty2y(1) - 6;
    R.put(x, y, 32, 24, (p, r) => consoleArt(p, r), { anim: consoleAnim(x, y, 32, tx), base: ty2y(2) });
    R.block(tx, 1, 2, 1); R.spot(tx, 0, 0, true, "work", 8);
    R.put(x + 9, ty2y(0) - 4, 14, 14, (p) => chairArt(p), { base: ty2y(0) + 9, shadow: 0 });
  }
  // the Captain's chair, up front in the middle
  R.put(tx2x(10) - 3, ty2y(0) - 2, 22, 28, (p) => {
    p.r(0, 0, 22, 20, C.ink); p.r(1, 1, 20, 18, C.wine); p.r(1, 1, 20, 1, C.red); p.r(3, 3, 16, 14, C.red); p.r(3, 3, 16, 1, C.pink); p.r(10, 3, 2, 14, C.wine);
    p.r(0, 0, 22, 1, C.amber); p.r(0, 0, 1, 20, C.amber); p.r(21, 0, 1, 20, C.amber);
    p.r(0, 16, 22, 8, C.ink); p.r(1, 17, 20, 5, C.wine); p.r(1, 17, 20, 1, C.red); p.r(9, 23, 4, 4, C.ink); p.r(5, 26, 12, 2, C.ink);
  }, { base: ty2y(1) + 10 });
  R.spot(10, 1, 0, true, "captain", 0, 2);
  // the radar and the Night Watch's seats round it
  const rx = tx2x(8) - 0, ry = ty2y(3) + 2;
  R.put(rx, ry, 81, 45, (p) => radarArt(p), { anim: radarAnim(rx, ry), base: ty2y(6) - 2, shadow: 40 });
  R.block(8, 3, 5, 3);
  R.hots.push({ r: [rx + 6, ry + 6, 70, 32], pick: () => ({ kind: "room", station: "bridge" }), label: "The radar: every open imdUSD loan worth a liquidation" });
  // the Night Watch stands its watch round the radar, each seat a plate in the floor
  for (const [tx, ty, f] of [[8, 2, 0], [12, 2, 0], [6, 4, 2], [14, 4, 1], [8, 7, 3], [12, 7, 3]] as [number, number, Dir][]) {
    R.spot(tx, ty, f, false, "watch");
    const cx = tx2x(tx) + 8, cy = ty2y(ty) + 12;
    R.p.ell(cx, cy, 8, 3, C.ink); R.p.ell(cx, cy, 7, 2, C.slate); R.p.ell(cx, cy - 1, 5, 1, C.fog); R.p.p(cx, cy, C.cyan);
  }
  // the side stations
  for (const [tx, ty] of [[1, 4], [1, 7], [18, 4], [18, 7], [4, 8], [15, 8]] as [number, number][]) {
    const x = tx2x(tx), y = ty2y(ty) - 6;
    R.put(x, y, 32, 24, (p, r) => consoleArt(p, r), { anim: consoleAnim(x, y, 32, tx + ty), base: ty2y(ty + 1) });
    R.block(tx, ty, 2, 1); R.spot(tx, ty - 1, 0, true, "work", 8);
  }
  R.put(tx2x(20), ty2y(0) - 14, 13, 28, (p) => coolerArt(p), { base: ty2y(1) - 1 }); R.block(20, 0); R.spot(20, 1, 3, false, "coffee");
  R.put(tx2x(0), ty2y(9) - 12, 16, 26, (p, r) => plantArt(p, r, 0), { base: ty2y(10) }); R.block(0, 9);
  R.put(tx2x(20), ty2y(9) - 12, 16, 26, (p, r) => plantArt(p, r, 2), { base: ty2y(10) }); R.block(20, 9);
  R.spot(8, 0, 3, false, "view"); R.spot(12, 0, 3, false, "view");
  R.light(176, 118, 70, 34, 0.45); R.light(56, 64, 52, 22, 0.4); R.light(296, 64, 52, 22, 0.4);
  void st;
  return R.done();
};

const quarters: Build = () => {
  const R = new Room("quarters", 23);
  walls(R, { face: C.wine, seam: C.plum, low: C.bark, lowHi: C.wood, base: C.plum, trim: C.amber }, (p) => {
    for (let x = 12; x < W; x += 8) for (let y = 15; y < 34; y += 2) if ((x + y) % 4 === 0) p.p(x, y, C.plum);
    for (let x = 8; x < W; x += 24) { p.r(x, 35, 1, 7, C.plum); }
  });
  floorPlanks(R);
  // the rug
  const p = R.p, rx = tx2x(5) + 4, ry = ty2y(2) + 4, rw = 16 * 11 - 8, rh = 16 * 6 - 8;
  p.r(rx, ry, rw, rh, C.ink); p.r(rx + 1, ry + 1, rw - 2, rh - 2, C.wine); p.r(rx + 3, ry + 3, rw - 6, rh - 6, C.amber); p.r(rx + 5, ry + 5, rw - 10, rh - 10, C.wine);
  for (let x = rx + 8; x < rx + rw - 8; x += 6) { p.p(x, ry + 3, C.wine); p.p(x, ry + rh - 4, C.wine); }
  for (let y = ry + 10; y < ry + rh - 10; y += 8) for (let x = rx + 12; x < rx + rw - 12; x += 12) { p.p(x, y, C.rose); p.p(x + 1, y + 1, C.rose); p.p(x - 1, y + 1, C.rose); p.p(x, y + 2, C.rose); }
  for (let x = rx; x < rx + rw; x += 3) { p.p(x, ry - 1, C.sand); p.p(x, ry + rh, C.sand); }
  const sL = spaceWindow(R, 72, 12, 30, 20, { frame: C.amber }), sR = spaceWindow(R, 250, 12, 30, 20, { frame: C.amber, planet: [272, 28, 7] });
  R.wall.push(twinkle([...sL, ...sR]));
  frame(R, 152, 10, 48, 24, (q) => {
    q.r(0, 0, 48, 24, C.navy); q.r(0, 14, 48, 10, C.teal); q.ell(34, 8, 4, 4, C.sand); q.p(33, 7, C.white);
    for (let x = 0; x < 48; x += 3) q.p(x, 14 + ((x / 3) % 2), C.sky);
    q.r(8, 10, 12, 4, C.bark); q.r(13, 3, 1, 7, C.sand); q.r(14, 4, 5, 4, C.mist); q.r(10, 14, 8, 1, C.ink);
  });
  sign(R, 176, 37, "WARDROOM", C.plum, C.amber);
  clock(R, 124, 22);
  // the Night Bosses' four plinths
  for (const tx of [1, 4, 16, 19]) {
    const x = tx2x(tx) - 3, y = ty2y(0) - 6;
    R.put(x, y, 22, 20, (q) => plinthArt(q, true), { base: ty2y(0) + 10 });
    R.spot(tx, 0, 0, false, "boss", 0, -1, 7);
  }
  R.hots.push(...[1, 4, 16, 19].map((tx, i) => ({ r: [tx2x(tx) - 3, ty2y(0) - 6, 22, 20] as [number, number, number, number], pick: (L: Live) => (L.snap && L.snap.watchers.filter((w) => w.tier === 5).length <= i ? { kind: "seat" as const, seat: -1 - i } : null), label: "A Night Boss plinth" })));
  // bookcases and the sideboard with the tea
  for (const tx of [6, 13]) { R.put(tx2x(tx) + 1, ty2y(0) - 30, 30, 44, (q, r) => shelfArt(q, r), { base: ty2y(0) + 14 }); R.block(tx, 0, 2, 1); }
  R.put(tx2x(8) + 2, ty2y(0) - 8, 76, 22, (q) => {
    q.r(0, 6, 76, 16, C.ink); q.r(1, 7, 74, 4, C.tan); q.r(1, 7, 74, 1, C.sand); q.r(1, 11, 74, 9, C.bark); for (let x = 6; x < 70; x += 17) { q.r(x, 13, 13, 5, C.plum); q.p(x + 6, 15, C.amber); }
    q.r(10, 0, 9, 8, C.ink); q.r(11, 1, 7, 6, C.mist); q.r(17, 3, 3, 2, C.mist); q.r(12, 1, 5, 1, C.white);
    for (let k = 0; k < 3; k++) { q.r(26 + k * 6, 3, 5, 5, C.ink); q.r(27 + k * 6, 3, 3, 4, C.white); }
    q.r(52, 1, 3, 7, C.sand); q.p(53, 0, C.lemon); q.r(60, 2, 8, 6, C.ink); q.r(61, 3, 6, 4, C.leaf);
  }, { base: ty2y(0) + 14, anim: steamAnim(tx2x(8) + 16, ty2y(0) - 9) });
  R.block(8, 0, 5, 1); R.spot(10, 1, 3, false, "coffee"); R.spot(5, 1, 3, false, "view"); R.spot(15, 1, 3, false, "view");
  // the wardroom table: seven a side
  R.put(tx2x(7), ty2y(3) - 4, 112, 36, (q, r) => tableArt(q, r, 112, 36, { cloth: true }), { base: ty2y(5) - 1 });
  R.block(7, 3, 7, 2);
  for (let tx = 7; tx <= 13; tx++) {
    R.spot(tx, 2, 0, true, "work");
    R.put(tx2x(tx) + 1, ty2y(2) - 2, 14, 14, (q) => chairArt(q, C.wine, C.red), { base: ty2y(2) + 9, shadow: 0 });
    R.spot(tx, 5, 3, true, "work", 0, -4);
    R.put(tx2x(tx) + 1, ty2y(5) + 4, 14, 14, (q) => chairArt(q, C.wine, C.red), { base: ty2y(5) + 15, shadow: 0 });
  }
  // the fireside corner and the Captain's desk
  R.put(tx2x(0), ty2y(7) - 8, 22, 24, (q) => armchairArt(q), { base: ty2y(7) + 6 }); R.spot(0, 7, 2, true, "work", 3, -3);
  R.put(tx2x(3) - 6, ty2y(7) - 8, 22, 24, (q) => armchairArt(q), { base: ty2y(7) + 6 }); R.spot(3, 7, 1, true, "work", -3, -3);
  R.put(tx2x(1) + 6, ty2y(7) - 2, 20, 18, (q) => { q.ell(10, 5, 9, 4, C.ink); q.ell(10, 5, 8, 3, C.tan); q.r(8, 8, 4, 9, C.ink); q.r(9, 8, 2, 9, C.bark); q.r(6, 2, 3, 3, C.white); q.r(12, 3, 5, 2, C.wine); }, { base: ty2y(7) + 14 });
  R.block(1, 7, 2, 1);
  R.put(tx2x(0) + 1, ty2y(9) - 24, 13, 30, (q) => lampArt(q), { base: ty2y(9) + 6 }); R.block(0, 9); R.light(tx2x(0) + 8, ty2y(9) - 2, 46, 26, 0.45);
  R.put(tx2x(16), ty2y(7) - 4, 48, 30, (q, r) => deskArt(q, r, { w: 48, screen: false }), { base: ty2y(8) + 2 });
  R.block(16, 7, 3, 1); R.spot(17, 6, 0, true, "work");
  R.put(tx2x(17) + 1, ty2y(6) - 4, 14, 14, (q) => chairArt(q, C.wine, C.red), { base: ty2y(6) + 9, shadow: 0 });
  R.put(tx2x(20), ty2y(7) - 10, 14, 26, (q) => { q.ell(7, 8, 6, 6, C.ink); q.ell(7, 8, 5, 5, C.sky); q.r(4, 6, 3, 3, C.moss); q.r(8, 9, 3, 2, C.moss); q.p(5, 5, C.cyan); q.ring(7, 8, 7, 7, C.amber); q.r(6, 15, 3, 7, C.ink); q.r(3, 21, 9, 3, C.ink); q.r(4, 21, 7, 2, C.amber); }, { base: ty2y(8) - 2 });
  R.block(20, 7);
  R.put(tx2x(20), ty2y(9) - 12, 16, 26, (q, r) => plantArt(q, r, 1), { base: ty2y(10) }); R.block(20, 9);
  R.light(176, 120, 100, 44, 0.35); R.light(tx2x(17), ty2y(7), 40, 20, 0.4);
  return R.done();
};

const offices: Build = () => {
  const R = new Room("offices", 37);
  walls(R, { face: C.fog, seam: C.slate, low: C.slate, lowHi: C.mist, base: C.steel });
  floorCarpet(R);
  const s = [...spaceWindow(R, 22, 10, 84, 22, { panes: 2 }), ...spaceWindow(R, 246, 10, 84, 22, { panes: 2, planet: [318, 30, 9] })];
  R.wall.push(twinkle(s));
  // the whiteboard: a plan and a chart, no numbers on it
  const p = R.p;
  p.r(122, 9, 76, 26, C.ink); p.r(123, 10, 74, 24, C.slate); p.r(124, 11, 72, 21, C.white); p.r(124, 32, 72, 2, C.fog);
  for (let i = 0; i < 6; i++) p.r(128 + i * 8, 27 - [3, 5, 4, 8, 7, 11][i]!, 5, [3, 5, 4, 8, 7, 11][i]!, i === 5 ? C.leaf : C.sky);
  p.r(128, 27, 46, 1, C.ink); p.text("SHIP IT", 178, 14, C.red); p.r(178, 20, 14, 1, C.navy); p.r(178, 23, 10, 1, C.navy); p.r(178, 26, 12, 1, C.navy);
  p.r(150, 33, 10, 1, C.red); p.r(162, 33, 6, 1, C.sky);
  sign(R, 222, 37, "COMPANY OFFICES", C.steel, C.mist);
  clock(R, 214, 20);
  // three rows of desks, their crew facing the room
  for (const ty of [2, 5, 8]) for (const tx of [1, 4, 7, 12, 15, 18]) {
    const x = tx2x(tx), y = ty2y(ty) - 13;
    R.put(x, y, 32, 30, (q, r) => deskArt(q, r), { base: ty2y(ty) + 15 });
    R.block(tx, ty, 2, 1); R.spot(tx, ty - 1, 0, true, "work", 6);
    R.put(x + 7, ty2y(ty - 1) - 4, 14, 14, (q) => chairArt(q), { base: ty2y(ty - 1) + 9, shadow: 0 });
  }
  R.put(tx2x(10) + 2, ty2y(0) - 14, 13, 28, (q) => coolerArt(q), { base: ty2y(1) - 1 }); R.block(10, 0); R.spot(10, 1, 3, false, "coffee");
  R.put(tx2x(9), ty2y(9) - 12, 16, 26, (q, r) => plantArt(q, r, 2), { base: ty2y(10) }); R.block(9, 9);
  R.put(tx2x(11), ty2y(9) - 14, 16, 28, (q) => { q.r(0, 0, 16, 28, C.ink); q.r(1, 1, 14, 26, C.fog); q.r(1, 1, 14, 1, C.mist); for (let k = 0; k < 3; k++) { q.r(2, 3 + k * 8, 12, 7, C.slate); q.r(6, 5 + k * 8, 4, 1, C.mist); } }, { base: ty2y(10) }); R.block(11, 9);
  R.spot(3, 0, 3, false, "view"); R.spot(17, 0, 3, false, "view");
  R.light(96, 110, 90, 50, 0.4); R.light(256, 110, 90, 50, 0.4);
  return R.done();
};

const breakroom: Build = () => {
  const R = new Room("breakroom", 41);
  walls(R, { face: C.teal, seam: C.pine, low: C.mist, lowHi: C.white, base: C.fog }, (p) => {
    for (let y = 35; y < 42; y += 3) p.r(0, y, W, 1, C.fog); for (let x = 4; x < W; x += 6) p.r(x, 35, 1, 7, C.fog);
  });
  floorChecker(R, C.sand, C.tan);
  const p = R.p;
  // the menu board
  p.r(20, 8, 84, 25, C.ink); p.r(21, 9, 82, 23, C.wood); p.r(23, 11, 78, 19, C.night);
  p.text("COFFEE", 27, 13, C.sand); p.text("ESPRESSO", 27, 19, C.mist); p.text("OAT LATTE", 27, 25, C.mist); p.r(70, 13, 26, 1, C.pink); p.ell(86, 22, 5, 4, C.mist); p.ell(86, 21, 3, 1, C.bark); p.r(91, 21, 2, 2, C.mist);
  const s = spaceWindow(R, 136, 10, 56, 22, { panes: 2 });
  R.wall.push(twinkle(s));
  clock(R, 208, 20);
  frame(R, 290, 11, 22, 20, (q) => { q.r(0, 0, 22, 20, C.navy); q.ell(11, 11, 6, 6, C.moss); q.ell(9, 8, 2, 2, C.leaf); q.ell(13, 8, 2, 2, C.leaf); q.p(9, 8, C.ink); q.p(13, 8, C.ink); q.r(8, 13, 6, 1, C.ink); q.text("GG", 11, 1, C.lemon, 0.5); }, C.rose);
  // the coffee bar
  R.put(tx2x(0), ty2y(1) - 18, 112, 34, (q, r) => counterArt(q, r, 112), { base: ty2y(2) - 1, anim: steamAnim(tx2x(0) + 14, ty2y(1) - 19) });
  R.block(0, 1, 7, 1);
  R.spot(2, 0, 0, false, "work", 0, -2); R.spot(5, 0, 0, false, "work", 0, -2);
  R.spot(1, 2, 3, false, "coffee"); R.spot(3, 2, 3, false, "coffee"); R.spot(5, 2, 3, false, "coffee");
  R.light(tx2x(3), ty2y(2), 70, 26, 0.5);
  // round tables with stools
  for (const [tx, ty] of [[4, 5], [9, 5], [6, 8]] as [number, number][]) {
    R.put(tx2x(tx) + 1, ty2y(ty) - 7, 31, 23, (q) => roundTableArt(q), { base: ty2y(ty) + 15 });
    R.block(tx, ty, 2, 1);
    R.spot(tx - 1, ty, 2, true, "work", 4, -1); R.spot(tx + 2, ty, 1, true, "work", -4, -1);
    R.put(tx2x(tx - 1) + 6, ty2y(ty) + 3, 12, 13, (q) => stoolArt(q), { base: ty2y(ty) + 10, shadow: 0 });
    R.put(tx2x(tx + 2) - 2, ty2y(ty) + 3, 12, 13, (q) => stoolArt(q), { base: ty2y(ty) + 10, shadow: 0 });
    if (ty === 5) { R.spot(tx, ty - 1, 0, true, "work", 8); R.put(tx2x(tx) + 10, ty2y(ty - 1) + 3, 12, 13, (q) => stoolArt(q), { base: ty2y(ty - 1) + 10, shadow: 0 }); }
  }
  // the couch
  R.put(tx2x(0), ty2y(8) - 10, 50, 24, (q) => couchArt(q), { base: ty2y(8) + 9 });
  for (let k = 0; k < 3; k++) R.spot(k, 8, 0, true, "work", 1, -3);
  R.put(tx2x(0) + 6, ty2y(9) + 1, 38, 12, (q) => { q.r(0, 0, 38, 9, C.ink); q.r(1, 1, 36, 4, C.wood); q.r(1, 1, 36, 1, C.tan); q.r(1, 5, 36, 3, C.bark); q.r(6, 1, 6, 3, C.mist); q.r(24, 0, 4, 4, C.ink); q.r(25, 0, 2, 3, C.pink); }, { base: ty2y(9) + 12 });
  R.block(0, 9, 3, 1);
  // the arcade, the vending machine, the pool table
  for (const [tx, b, sd, seed] of [[14, C.navy, C.grape, 1], [16, C.grape, C.navy, 2]] as [number, Col, Col, number][]) {
    const x = tx2x(tx) - 1, y = ty2y(0) - 30;
    R.put(x, y, 18, 42, (q) => arcadeArt(q, b, sd), { base: ty2y(0) + 12, anim: arcadeAnim(x, y, seed) });
    R.block(tx, 0); R.spot(tx, 1, 3, false, "play", 0, -3);
  }
  R.put(tx2x(18), ty2y(0) - 30, 24, 42, (q) => vendingArt(q), { base: ty2y(0) + 12 }); R.block(18, 0, 2, 1); R.spot(18, 1, 3, false, "coffee");
  R.put(tx2x(20), ty2y(0) - 12, 16, 26, (q, r) => plantArt(q, r, 0), { base: ty2y(1) }); R.block(20, 0);
  R.put(tx2x(14) - 2, ty2y(4) - 6, 68, 38, (q) => {
    q.r(0, 0, 68, 30, C.ink); q.r(1, 1, 66, 28, C.bark); q.r(1, 1, 66, 1, C.wood); q.r(4, 4, 60, 22, C.pine); q.r(5, 5, 58, 20, C.moss); q.r(5, 5, 58, 1, C.leaf);
    for (const [x, y] of [[4, 4], [33, 3], [62, 4], [4, 24], [33, 25], [62, 24]] as [number, number][]) q.r(x - 1, y - 1, 3, 3, C.ink);
    for (const [x, y, c] of [[20, 14, C.white], [44, 10, C.red], [47, 12, C.amber], [45, 15, C.sky], [49, 15, C.lemon], [42, 13, C.ink]] as [number, number, Col][]) { q.r(x, y, 2, 2, c); }
    q.r(12, 18, 20, 1, C.sand); q.r(0, 30, 68, 6, C.ink); q.r(1, 30, 66, 4, C.bark); q.r(3, 34, 4, 4, C.ink); q.r(61, 34, 4, 4, C.ink);
  }, { base: ty2y(6) - 1 });
  R.block(14, 4, 4, 2); R.spot(13, 4, 2, false, "play", 2); R.spot(18, 5, 1, false, "play", -2);
  R.put(tx2x(20), ty2y(9) - 12, 16, 26, (q, r) => plantArt(q, r, 1), { base: ty2y(10) }); R.block(20, 9);
  R.light(tx2x(16), ty2y(5), 56, 26, 0.45);
  return R.done();
};

const missions: Build = (st) => {
  const R = new Room("missions", 53);
  walls(R, { face: C.steel, seam: C.night, low: C.night, lowHi: C.slate, base: C.ink }, (p) => {
    for (let x = 0; x < W; x += 8) { p.r(x, 35, 4, 6, C.amber); }
    for (let x = 0; x < W; x += 8) for (let y = 35; y < 41; y++) p.p(x + ((y - 35) % 8) + 4, y, C.ink);
  });
  floorPlates(R, C.steel, C.night, C.slate, 16);
  const p = R.p;
  // the pod lane, painted
  for (let x = tx2x(12) + 4; x < W - 10; x += 6) { p.r(x, ty2y(2) + 14, 3, 1, C.amber); }
  for (const tx of [13, 15, 17, 19]) { p.ring(tx2x(tx) + 8, ty2y(1) + 12, 11, 5, C.amber, 2); }
  missionBoard(R, 20, 8, 132, 28, st);
  // the hangar door
  p.r(214, 6, 126, 42, C.ink); p.r(216, 8, 122, 39, C.slate); for (let y = 10; y < 44; y += 4) { p.r(216, y, 122, 1, C.steel); p.r(216, y + 1, 122, 1, C.fog); }
  for (let x = 216; x < 338; x += 10) { p.r(x, 41, 5, 6, C.amber); p.r(x + 5, 41, 5, 6, C.ink); }
  p.r(258, 12, 38, 6, C.ink); p.r(259, 13, 36, 4, C.night); for (let x = 262; x < 294; x += 4) p.p(x, 14, C.fog);
  sign(R, 277, 22, "HANGAR", C.amber, C.ink);
  R.wall.push((q, L) => { const on = L.still || Math.floor(L.t / 600) % 2; q.r(219, 11, 3, 3, on ? C.amber : C.rust); q.r(333, 11, 3, 3, on ? C.rust : C.amber); });
  // mission control: two rows of three
  for (const ty of [2, 5]) for (const tx of [1, 4, 7]) {
    const x = tx2x(tx), y = ty2y(ty) - 6;
    R.put(x, y, 32, 24, (q, r) => consoleArt(q, r), { anim: consoleAnim(x, y, 32, tx * ty), base: ty2y(ty + 1) });
    R.block(tx, ty, 2, 1); R.spot(tx, ty - 1, 0, true, "work", 8);
    R.put(x + 9, ty2y(ty - 1) - 4, 14, 14, (q) => chairArt(q), { base: ty2y(ty - 1) + 9, shadow: 0 });
  }
  // the dispatcher's podium
  R.put(tx2x(10), ty2y(2) - 8, 18, 24, (q) => { q.r(0, 4, 18, 20, C.ink); q.r(1, 5, 16, 18, C.slate); q.r(1, 5, 16, 1, C.fog); q.r(2, 0, 14, 7, C.ink); q.r(3, 1, 12, 5, C.teal); q.r(4, 2, 6, 1, C.leaf); q.r(4, 4, 9, 1, C.leaf); q.r(5, 12, 8, 1, C.amber); }, { base: ty2y(3) - 1 });
  R.block(10, 2); R.spot(10, 1, 0, false, "work", 1);
  // the launch pods; a frog out on a mission rides one
  [13, 15, 17, 19].forEach((tx, i) => {
    const x = tx2x(tx) - 5, y = ty2y(1) - 30;
    R.put(x, y, 26, 44, (q) => podArt(q), {
      base: ty2y(1) + 14,
      anim: (q, L) => {
        const id = L.riders[i];
        if (id) { const hd = L.faces.get(id, 0.5); if (hd) { const g = q.g; g.save(); g.beginPath(); g.arc(x + 13.5, y + 18.5, 5.5, 0, Math.PI * 2); g.clip(); g.drawImage(hd.front, Math.round(x + 13.5 - hd.w / 2), Math.round(y + 24 - hd.chin)); g.restore(); } }
        const lit = L.still || Math.floor(L.t / 500 + i) % 3 !== 0;
        q.r(x + 11, y + 27, 4, 1, id ? (lit ? C.amber : C.rust) : lit ? C.leaf : C.moss);
      },
    });
    R.block(tx, 1); R.spot(tx, 2, 3, false, "work");
    R.hots.push({ r: [x, y, 26, 44], pick: (L) => (L.riders[i] ? { kind: "frog", id: L.riders[i]! } : { kind: "room", station: "missions" }), label: "A launch pod" });
  });
  // the workbench, the cargo, the vending machine
  R.put(tx2x(2), ty2y(8) - 13, 48, 30, (q, r) => deskArt(q, r, { w: 48, screen: false, tone: "metal" }), { base: ty2y(8) + 15 });
  R.block(2, 8, 3, 1); R.spot(2, 7, 0, false, "work", 4); R.spot(4, 7, 0, false, "work", -4);
  for (const [tx, ty, st2] of [[17, 8, 2], [19, 8, 1], [18, 6, 1], [20, 6, 0]] as [number, number, number][]) {
    R.put(tx2x(tx), ty2y(ty) - (st2 > 1 ? 16 : 2), 16, st2 > 1 ? 32 : 18, (q) => { crateArt(q, 16, 16); if (st2 > 1) { q.g.drawImage(q.g.canvas, 0, 0, 16, 16, 0, 16, 16, 16); } }, { base: ty2y(ty) + 16 });
    R.block(tx, ty);
  }
  R.put(tx2x(13), ty2y(8) - 4, 15, 22, (q) => barrelArt(q, C.amber, C.lemon, C.orange), { base: ty2y(8) + 16 }); R.block(13, 8);
  R.put(tx2x(11) - 4, ty2y(0) - 30, 24, 42, (q) => vendingArt(q), { base: ty2y(0) + 12 }); R.block(11, 0); R.spot(11, 1, 3, false, "coffee", 0, -2);
  R.light(tx2x(16), ty2y(2), 80, 30, 0.45); R.light(tx2x(5), ty2y(3), 70, 34, 0.35);
  return R.done();
};

const engine: Build = () => {
  const R = new Room("engine", 67);
  walls(R, { face: C.night, seam: C.ink, low: C.steel, lowHi: C.slate, base: C.ink }, (p) => {
    pipeH(p, 0, 12, W); pipeH(p, 0, 24, 150, 4); pipeH(p, 210, 24, W - 210, 4);
    for (const x of [40, 120, 230, 300]) pipeV(p, x, 8, 34, 4);
    for (const [x, c] of [[60, C.red], [282, C.red]] as [number, Col][]) { p.ell(x, 14, 4, 4, C.ink); p.ring(x, 14, 3, 3, c); p.p(x, 14, c); }
    p.r(150, 8, 52, 30, C.ink); p.r(151, 9, 50, 28, C.steel); for (let y = 11; y < 36; y += 3) p.r(153, y, 46, 1, C.ink);
    p.r(84, 28, 26, 9, C.ink); p.r(85, 29, 24, 7, C.amber); p.text("HOT", 97, 30, C.ink, 0.5);
  });
  floorGrate(R);
  const p = R.p;
  // the hazard ring round the reactor
  p.ring(176, 128, 58, 22, C.amber, 3); p.ring(176, 128, 57, 21, C.ink, 3);
  sign(R, 176, 0, "ENGINE ROOM");
  // the reactor
  const x = 176 - 36, y = 34;
  R.put(x, y, 72, 112, (q) => {
    q.ell(36, 96, 35, 14, C.ink); q.ell(36, 96, 34, 13, C.slate); q.ell(36, 95, 32, 11, C.fog); q.ell(36, 96, 28, 9, C.steel);
    q.r(10, 66, 52, 30, C.ink); q.r(11, 66, 50, 29, C.slate); q.r(11, 66, 3, 29, C.fog); q.r(55, 66, 6, 29, C.steel);
    for (let k = 0; k < 6; k++) { q.r(11 + k * 9, 86, 5, 4, C.amber); q.r(16 + k * 9, 86, 4, 4, C.ink); }
    q.r(18, 14, 36, 54, C.ink); q.r(19, 15, 34, 52, C.navy); q.r(19, 15, 2, 52, C.sky); q.r(51, 15, 2, 52, C.teal);
    for (const yy of [20, 40, 60]) { q.r(16, yy, 40, 3, C.ink); q.r(17, yy, 38, 2, C.amber); q.r(17, yy, 38, 1, C.lemon); }
    q.r(12, 0, 48, 16, C.ink); q.r(13, 1, 46, 14, C.slate); q.r(13, 1, 46, 1, C.fog); q.r(13, 12, 46, 3, C.steel); for (let k = 0; k < 5; k++) q.r(18 + k * 8, 5, 4, 2, C.ink);
    q.r(0, 70, 11, 6, C.ink); q.r(0, 71, 11, 4, C.slate); q.r(61, 76, 11, 6, C.ink); q.r(61, 77, 11, 4, C.slate);
  }, {
    base: ty2y(6),
    shadow: 34,
    anim: (q, L) => {
      // the core: bands of light climbing the tube
      const k = L.still ? 0 : L.t / 90;
      for (let yy = 15; yy < 67; yy++) {
        if (yy === 20 || yy === 21 || yy === 40 || yy === 41 || yy === 60 || yy === 61) continue;
        const v = (yy + k) % 12;
        const c = v < 2 ? C.white : v < 5 ? C.cyan : v < 8 ? C.sky : null;
        if (c) q.r(x + 24, y + 81 - yy, 24, 1, c);
        else q.r(x + 24, y + 81 - yy, 24, 1, C.navy);
      }
      q.r(x + 34, y + 15, 4, 52, C.cyan); q.r(x + 35, y + 15, 2, 52, C.white);
      if (!L.still) for (let s = 0; s < 2; s++) { const ph = (L.t / 1500 + s / 2) % 1; q.p(x + 26 + s * 18, Math.round(y + 64 - ph * 48), C.white); }
    },
  });
  R.block(8, 3, 5, 3);
  R.hots.push({ r: [x + 10, y, 52, 96], pick: () => ({ kind: "room", station: "engine" }), label: "The reactor" });
  // control panels at the back, consoles at the front, the crew round the core
  for (const tx of [1, 4, 15, 18]) {
    const px = tx2x(tx) + 1, py = ty2y(1) - 12;
    R.put(px, py, 30, 28, (q, r) => panelArt(q, r), { anim: gaugeAnim(px, py, 30, tx), base: ty2y(2) });
    R.block(tx, 1, 2, 1); R.spot(tx, 0, 0, false, "work", 8, -1);
  }
  for (const tx of [2, 16]) {
    const cx2 = tx2x(tx), cy2 = ty2y(8) - 6;
    R.put(cx2, cy2, 32, 24, (q, r) => consoleArt(q, r), { anim: consoleAnim(cx2, cy2, 32, tx), base: ty2y(9) });
    R.block(tx, 8, 2, 1); R.spot(tx, 7, 0, true, "work", 8);
    R.put(cx2 + 9, ty2y(7) - 4, 14, 14, (q) => chairArt(q), { base: ty2y(7) + 9, shadow: 0 });
  }
  R.spot(7, 4, 2, false, "work", 2); R.spot(13, 4, 1, false, "work", -2); R.spot(9, 6, 3, false, "work", 0, 2); R.spot(11, 6, 3, false, "work", 0, 2);
  R.put(tx2x(20), ty2y(3) - 6, 16, 22, (q) => { crateArt(q, 16, 16); q.r(5, 0, 6, 9, C.ink); q.r(6, 1, 4, 8, C.wine); q.r(6, 1, 4, 1, C.red); q.r(6, 4, 4, 1, C.mist); }, { base: ty2y(4) });
  R.block(20, 3); R.spot(19, 3, 2, false, "coffee");
  for (const [tx, c, hi, lo] of [[0, C.red, C.pink, C.wine], [20, C.navy, C.sky, C.night], [8, C.amber, C.lemon, C.orange]] as [number, Col, Col, Col][]) { R.put(tx2x(tx), ty2y(9) - 6, 15, 22, (q) => barrelArt(q, c, hi, lo), { base: ty2y(10) }); R.block(tx, 9); }
  R.light(176, 126, 90, 40, 0.4); R.light(176, 70, 40, 30, 0.5);
  return R.done();
};

const forge: Build = () => {
  const R = new Room("forge", 79);
  walls(R, { face: C.rust, seam: C.rust, low: C.slate, lowHi: C.fog, base: C.steel }, (p) => {
    for (let y = 7; y < 34; y += 4) { p.r(0, y + 3, W, 1, C.bark); for (let x = ((y / 4) % 2) * 6; x < W; x += 12) p.r(x, y, 1, 3, C.bark); }
    for (let k = 0; k < 40; k++) { const x = (k * 53) % W, y = 8 + ((k * 29) % 24); p.r(x, y, 4, 1, k % 2 ? C.clay : C.wine); }
    // the hood over the furnace
    p.r(204, 6, 64, 36, C.ink); p.r(205, 6, 62, 35, C.steel); p.r(205, 6, 2, 35, C.slate); p.r(262, 6, 5, 35, C.night); p.r(205, 36, 62, 3, C.slate);
    // the tool rack
    p.r(284, 12, 54, 3, C.ink); p.r(285, 12, 52, 2, C.bark);
    for (let k = 0; k < 6; k++) { const x = 290 + k * 8; p.r(x, 14, 2, 14, C.ink); p.r(x, 14, 1, 13, k % 2 ? C.wood : C.bark); if (k % 2) { p.r(x - 2, 26, 6, 4, C.ink); p.r(x - 1, 27, 4, 2, C.steel); } else { p.r(x - 1, 26, 1, 5, C.slate); p.r(x + 2, 26, 1, 5, C.slate); } }
  });
  floorStone(R);
  const p = R.p;
  // the memorial wall: every frog the forge has burned, a frame each
  p.r(14, 7, 150, 34, C.ink); p.r(15, 8, 148, 32, C.plum); p.r(15, 8, 148, 1, C.bark); p.r(15, 39, 148, 1, C.bark);
  const cols = 11, fw = 12, fh = 13;
  R.wall.push((q, L) => {
    const ids = L.burned;
    q.r(16, 9, 60, 7, C.plum);
    q.text(`FORGED ${L.snap ? L.snap.totals.burned : "--"}`, 18, 10, C.amber);
    const shown = ids.length > cols * 2 ? cols * 2 - 1 : ids.length;
    for (let i = 0; i < cols * 2; i++) {
      const fx = 22 + (i % cols) * (fw + 1), fy = 17 + Math.floor(i / cols) * 11 - (i >= cols ? 0 : 0);
      if (i >= cols && fy > 30) continue;
      q.r(fx - 1, fy - 1, fw + 2, 1, C.amber); q.r(fx - 1, fy - 1 + 10, fw + 2, 1, C.bark);
      if (i < shown) portrait(q, L, ids[i]!, fx, fy, fw, 9);
      else if (i === shown && ids.length > shown) q.text(`+${ids.length - shown}`, fx + fw / 2, fy + 2, C.sand, 0.5);
      else q.r(fx + 3, fy + 3, fw - 6, 3, C.bark);
    }
    void fh;
  });
  R.hots.push({ r: [14, 7, 150, 34], pick: (L, hx, hy) => {
    const i = Math.floor((hx - 21) / (fw + 1)) + (hy >= 27 ? cols : 0);
    const ids = L.burned, shown = ids.length > cols * 2 ? cols * 2 - 1 : ids.length;
    return i >= 0 && i < shown && hx >= 21 ? { kind: "frog", id: ids[i]! } : { kind: "room", station: "forge" };
  }, label: "The memorial wall" });
  sign(R, 236, 0, "THE FORGE", C.bark, C.amber);
  // the furnace
  const fx = tx2x(12) - 4, fy = ty2y(0) - 34;
  R.put(fx, fy, 76, 66, (q) => furnaceArt(q), { base: ty2y(2) - 1, shadow: 36, anim: fireAnim(fx + 38, fy + 49) });
  R.block(12, 0, 4, 2);
  R.hots.push({ r: [fx, fy + 10, 76, 56], pick: () => ({ kind: "room", station: "forge" }), label: "The furnace: 10 frogs in, 1 Night Watcher out" });
  R.spot(12, 2, 3, false, "work", 2); R.spot(15, 2, 3, false, "work", -2);
  // the anvils
  for (const [tx, ty] of [[5, 4], [9, 6], [17, 5]] as [number, number][]) {
    R.put(tx2x(tx) - 2, ty2y(ty) - 6, 22, 22, (q) => anvilArt(q), { base: ty2y(ty) + 15 });
    R.block(tx, ty); R.spot(tx, ty - 1, 0, false, "hammer", 0, -1);
  }
  // the quench barrel, the coal, the bench, the water
  R.put(tx2x(11), ty2y(4) - 4, 15, 22, (q) => { barrelArt(q, C.wood, C.tan, C.bark); q.ell(7, 3, 5, 1, C.sky); q.p(5, 3, C.cyan); }, { base: ty2y(5) }); R.block(11, 4);
  R.put(tx2x(17), ty2y(1) - 2, 30, 18, (q) => { for (let k = 0; k < 36; k++) { const a = (k * 37) % 28, b = 14 - Math.round(Math.sqrt(Math.max(0, 1 - ((a - 14) / 15) ** 2)) * ((k * 13) % 12)); q.r(a, b, 3, 2, k % 3 ? C.ink : C.night); q.p(a, b, C.steel); } q.r(0, 15, 30, 3, C.ink); }, { base: ty2y(2) }); R.block(17, 1, 2, 1);
  R.put(tx2x(1), ty2y(8) - 13, 48, 30, (q, r) => deskArt(q, r, { w: 48, screen: false }), { base: ty2y(8) + 15 }); R.block(1, 8, 3, 1);
  R.spot(1, 7, 0, false, "work", 4); R.spot(3, 7, 0, false, "work", -4);
  R.put(tx2x(20), ty2y(7) - 6, 15, 22, (q) => { barrelArt(q, C.navy, C.sky, C.night); q.ell(7, 3, 5, 1, C.cyan); }, { base: ty2y(8) }); R.block(20, 7); R.spot(19, 7, 2, false, "coffee");
  R.spot(4, 0, 3, false, "view"); R.spot(7, 0, 3, false, "view");
  R.light(tx2x(14), ty2y(2) + 6, 110, 50, 0.4); R.light(tx2x(14), ty2y(2), 56, 26, 0.55); R.light(90, 64, 70, 20, 0.3);
  return R.done();
};

export const BUILDS: Record<Station, Build> = { bridge, quarters, offices, breakroom, missions, engine, forge };
export const ROOM_KEYS: Station[] = ["bridge", "quarters", "offices", "breakroom", "missions", "engine", "forge"];
