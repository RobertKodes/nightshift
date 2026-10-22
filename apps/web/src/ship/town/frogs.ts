import type { ShipStatic } from "../types";
import { C, type Col, Pix, copy, sheet, tone } from "./pix";

/**
 * The town's frogs, whole body. The head is the frog's own onchain art (its skin, mouth, eyes, headwear and
 * earpiece layers as the NIGHT FROGS renderer stores them), rasterised small and snapped back to the art's own
 * colours so it reads as crisp pixels; under it a little pixel body built from its traits: the Body trait is
 * the outfit, the Skin trait the arms and legs, the Accessory is worn or held. Night Watchers are built 1.5 ×
 * bigger in a uniform of their tier's colour (shoulder plates from II, a cape from III, armour from IV, gold
 * from V); The Captain is bigger still, in a long white coat.
 */
const OFFSETS = [4, 16, 28, 44, 56, 72, 88];
/** The part of the 1000 × 1000 art a head keeps: the head and anything worn on it. */
const CROP = { x: 172, y: 104, w: 656, h: 700 } as const;
const EYES: [number, number][] = [[391, 390], [601, 390]];
const ACCENT: Record<number, string> = { 1: "#7C5CFF", 2: "#C4B4FF", 4: "#B8FF4A", 5: "#FFC46B" };
/** Eyes that close for a blink (shades, the visor and night vision do not). */
const BLINKS = new Set([0, 1, 4, 5, 6, 7]);

export type Key = number | `w${number}`;
export type Head = { front: HTMLCanvasElement; back: HTMLCanvasElement; blink: HTMLCanvasElement | null; w: number; chin: number; top: number };

/** Art units per pixel at each size: a frog's head is ~20 px wide, a Night Watcher's ~30, The Captain's ~36. */
export const headScale = (k: number) => (k >= 1.7 ? 18 : k >= 1.4 ? 21 : k >= 0.8 ? 32 : 56);

type Job = { id: string; key: Key; k: number };
export class Faces {
  private done = new Map<string, Head>();
  private queue: Job[] = [];
  private queued = new Set<string>();
  private inflight = 0;
  private watchers = new Map<number, { traits: number[]; color: string }>();
  readonly skins: { s: Col; d: Col; l: Col }[];
  ready = 0;
  constructor(private st: ShipStatic) {
    this.skins = st.art.slice(OFFSETS[2]!, OFFSETS[3]!).filter((_, i) => i % 2 === 1).map((svg) => ({
      s: /\.skin\{fill:(#[0-9A-Fa-f]{6})/.exec(svg)?.[1] ?? "#5F9E45", d: /\.shade\{fill:(#[0-9A-Fa-f]{6})/.exec(svg)?.[1] ?? "#3B6638", l: /\.light\{fill:(#[0-9A-Fa-f]{6})/.exec(svg)?.[1] ?? "#8DC665",
    }));
  }
  setWatcher(n: number, traits: number[], color: string) { this.watchers.set(n, { traits, color }); }
  traits(key: Key): { traits: number[]; color: string } | null {
    if (typeof key === "number") { const row = this.st.frogs[key - 1]; if (!row) return null; const t = row.slice(3, 10); return { traits: t, color: ACCENT[t[0]!] ?? "#3FE6FF" }; }
    return this.watchers.get(Number(key.slice(1))) ?? null;
  }
  get pending() { return this.queue.length + this.inflight; }
  /** The head at size k, or null while it is being drawn (asked for now). */
  get(key: Key, k: number): Head | null {
    const id = `${key}@${headScale(k)}`, h = this.done.get(id);
    if (h) return h;
    if (!this.queued.has(id)) { this.queued.add(id); this.queue.push({ id, key, k }); }
    return null;
  }
  pump() {
    while (this.inflight < 4 && this.queue.length) {
      const j = this.queue.shift()!;
      this.inflight++;
      void this.make(j.key, j.k).then((h) => { if (h) { this.done.set(j.id, h); this.ready++; } }).catch(() => {}).finally(() => { this.inflight--; this.queued.delete(j.id); });
    }
  }

  private svg(traits: number[], layers: number[], color: string, W: number, H: number) {
    const art = this.st.art;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CROP.x} ${CROP.y} ${CROP.w} ${CROP.h}" width="${W}" height="${H}" color="${color}">${art[0]}`;
    for (const l of layers) s += art[OFFSETS[l]! + traits[l]! * 2 + 1] ?? "";
    return s + "</svg>";
  }

  private async make(key: Key, k: number): Promise<Head | null> {
    const t = this.traits(key);
    if (!t) return null;
    const sc = headScale(k), W = Math.round(CROP.w / sc), H = Math.round(CROP.h / sc), SS = 4;
    const tr = t.traits, ear = tr[6] === 4 ? [6] : [];
    const front = await raster(this.svg(tr, [2, 3, 4, 5, ...ear], t.color, W * SS, H * SS), W, H, SS);
    const skin = await raster(this.svg(tr, [2], t.color, W * SS, H * SS), W, H, SS);
    const hat = tr[5] !== 7 ? await raster(this.svg(tr, [5, ...ear], t.color, W * SS, H * SS), W, H, SS) : null;
    const sk = this.skins[tr[2]!]!;
    // the back of the head: the head's outline in flat skin, lit on top and shaded under, the headwear over it
    const back = flatBack(skin, sk);
    if (hat) back.p.g.drawImage(hat, 0, 0);
    // a blink: the eyes painted over in skin with a closed lid across each
    let blink: HTMLCanvasElement | null = null;
    if (BLINKS.has(tr[4]!) && tr[5] !== 5) {
      const b = sheet(front.width, front.height);
      b.p.g.drawImage(front, 0, 0);
      for (const [ex, ey] of EYES) {
        const x = (ex - CROP.x) / sc + 1, y = (ey - CROP.y) / sc + 1, rx = Math.max(1.5, 70 / sc), ry = Math.max(1.5, 66 / sc);
        for (let j = Math.floor(y - ry); j <= Math.ceil(y + ry); j++) for (let i = Math.floor(x - rx); i <= Math.ceil(x + rx); i++) {
          if (((i + 0.5 - x) / rx) ** 2 + ((j + 0.5 - y) / ry) ** 2 <= 1) b.p.p(i, j, j < y ? sk.l : sk.s);
        }
        b.p.r(Math.round(x - rx * 0.8), Math.round(y), Math.max(2, Math.round(rx * 1.6)), 1, "#08070D");
      }
      blink = b.c;
    }
    const rows = opaqueRows(front);
    return { front: copy(front), back: copy(back.c), blink: blink ? copy(blink) : null, w: front.width, chin: rows[1], top: rows[0] };
  }
}

/** Draws an SVG at SS × and folds it down to W × H pixels in the art's own colours, with a 1 px ink outline. */
async function raster(svg: string, W: number, H: number, SS: number): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const big = document.createElement("canvas"); big.width = W * SS; big.height = H * SS;
  const bg = big.getContext("2d", { willReadFrequently: true })!;
  bg.drawImage(img, 0, 0, W * SS, H * SS);
  const src = bg.getImageData(0, 0, W * SS, H * SS).data;
  const pal = [...new Set((svg.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).map((h) => parseInt(h.slice(1), 16)))];
  const out = sheet(W + 2, H + 2, true), od = out.p.g.createImageData(W + 2, H + 2), d = od.data, on = new Uint8Array((W + 2) * (H + 2));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) { const q = ((y * SS + j) * W * SS + x * SS + i) * 4, al = src[q + 3]!; r += src[q]! * al; g += src[q + 1]! * al; b += src[q + 2]! * al; a += al; }
    if (a < SS * SS * 255 * 0.5) continue;
    r /= a; g /= a; b /= a;
    let best = 0, bd = Infinity;
    for (const c of pal) { const dr = r - (c >> 16), dg = g - ((c >> 8) & 255), db = b - (c & 255), dd = 2 * dr * dr + 4 * dg * dg + 3 * db * db; if (dd < bd) { bd = dd; best = c; } }
    if (!pal.length) best = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
    const o = ((y + 1) * (W + 2) + x + 1), q = o * 4;
    d[q] = best >> 16; d[q + 1] = (best >> 8) & 255; d[q + 2] = best & 255; d[q + 3] = 255; on[o] = 1;
  }
  // the outline: every empty pixel touching the sprite
  for (let y = 0; y < H + 2; y++) for (let x = 0; x < W + 2; x++) {
    const o = y * (W + 2) + x;
    if (on[o]) continue;
    if ((x > 0 && on[o - 1]) || (x < W + 1 && on[o + 1]) || (y > 0 && on[o - W - 2]) || (y < H + 1 && on[o + W + 2])) { const q = o * 4; d[q] = 8; d[q + 1] = 7; d[q + 2] = 13; d[q + 3] = 255; }
  }
  out.p.g.putImageData(od, 0, 0);
  return out.c;
}

function flatBack(skin: HTMLCanvasElement, sk: { s: Col; d: Col; l: Col }) {
  const W = skin.width, H = skin.height, g = skin.getContext("2d")!, d = g.getImageData(0, 0, W, H).data;
  const out = sheet(W, H), [top, bot] = opaqueRows(skin);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const q = (y * W + x) * 4;
    if (d[q + 3]! < 128) continue;
    const ink = d[q]! + d[q + 1]! + d[q + 2]! < 60;
    const edge = ink && (x === 0 || x === W - 1 || d[q - 4 + 3]! < 128 || d[q + 4 + 3]! < 128 || y === 0 || d[q - W * 4 + 3]! < 128 || y === H - 1 || d[q + W * 4 + 3]! < 128);
    const f = (y - top) / Math.max(1, bot - top);
    out.p.p(x, y, edge ? "#08070D" : f < 0.22 ? sk.l : f > 0.78 ? sk.d : sk.s);
  }
  return out;
}

function opaqueRows(c: HTMLCanvasElement): [number, number] {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let top = -1, bot = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]! > 128) { if (top < 0) top = y; bot = y; break; }
  return [Math.max(0, top), bot];
}

// ------------------------------------------------------------------ bodies
type Outfit = { base: Col; shade: Col; light: Col; detail: Col; sleeve?: Col; style: number; legs?: boolean };
/** The Body trait's outfit, in the art's own colours. */
const OUTFITS: Outfit[] = [
  { base: "#191A24", shade: "#101018", light: "#34364c", detail: "#F2EFFF", style: 0 },
  { base: "#52308C", shade: "#30204E", light: "#7550b5", detail: "#F2EFFF", style: 0 },
  { base: "#EA743A", shade: "#A83D2D", light: "#f39a61", detail: "#D6E3BA", sleeve: "#161B25", style: 2 },
  { base: "#5C6574", shade: "#343A48", light: "#7d8796", detail: "#FFC46B", style: 3 },
  { base: "#293C51", shade: "#182534", light: "#3f5875", detail: "#778E9E", style: 4, legs: true },
  { base: "#C89644", shade: "#795125", light: "#e3bb6a", detail: "#FFF0B5", style: 5, legs: true },
];
export type BodySpec = { k: number; outfit: number; skin: { s: Col; d: Col; l: Col }; acc: number; tier: number; tc: Col };
/** Poses, one column each: idle (breathing in, out), the 4-frame walk, sitting, talking (2 frames of a wave). */
export const POSES = 9;
export const P_IDLE = 0, P_WALK = 2, P_SIT = 6, P_TALK = 7;
export type Frames = { sheet: HTMLCanvasElement; cw: number; ch: number; cx: number; by: number; head: Int8Array; hx: Int8Array };

export function bodyFrames(b: BodySpec): Frames {
  const k = b.k, cw = Math.ceil(34 * k), ch = Math.ceil(28 * k), cx = Math.floor(cw / 2), by = ch - 1;
  const s = sheet(cw * POSES, ch * 4), head = new Int8Array(POSES * 4), hx = new Int8Array(POSES * 4);
  for (let dir = 0; dir < 4; dir++) for (let pose = 0; pose < POSES; pose++) {
    const cell = sheet(cw, ch);
    const right = dir === 1 || dir === 2;
    const yT = paint(cell.p, b, right ? 2 : dir, pose, cx, by, "ink") ;
    paint(cell.p, b, right ? 2 : dir, pose, cx, by, "fill");
    const g = s.p.g;
    if (dir === 1) { g.save(); g.translate(pose * cw + cw, dir * ch); g.scale(-1, 1); g.drawImage(cell.c, 0, 0); g.restore(); }
    else g.drawImage(cell.c, pose * cw, dir * ch);
    head[dir * POSES + pose] = yT - by;
    hx[dir * POSES + pose] = dir === 2 ? Math.max(1, Math.round(k)) : dir === 1 ? -Math.max(1, Math.round(k)) : 0;
  }
  return { sheet: s.c, cw, ch, cx, by, head, hx };
}

/**
 * One frame of a body, drawn twice: once as its ink outline (every part 1 px bigger), once in colour.
 * Returns the torso's top row, where the head's chin goes.
 */
function paint(p: Pix, b: BodySpec, dir: number, pose: number, cx: number, by: number, mode: "ink" | "fill"): number {
  const k = b.k, K = (v: number) => Math.max(1, Math.round(v * k));
  const watcher = b.tier > 0, cap = b.tier === 6;
  const o: Outfit = watcher
    ? cap ? { base: "#d9dcec", shade: C.fog, light: C.white, detail: "#FFC46B", style: 7 } : { base: C.night, shade: "#1b1e33", light: C.steel, detail: b.tc, style: 6 }
    : OUTFITS[b.outfit] ?? OUTFITS[0]!;
  const R = (x: number, y: number, w: number, h: number, c: Col) => { if (mode === "ink") p.r(x - 1, y - 1, w + 2, h + 2, C.ink); else p.r(x, y, w, h, c); };
  const D = (x: number, y: number, w: number, h: number, c: Col) => { if (mode === "fill") p.r(x, y, w, h, c); };
  const walk = pose >= P_WALK && pose < P_SIT ? pose - P_WALK : -1, sit = pose === P_SIT, talk = pose >= P_TALK ? pose - P_TALK : -1;
  const tw = K(13) + (K(13) % 2), ts = K(9), th = K(9), lh = K(5), lw = K(4), aw = K(3), al = K(7);
  const bob = walk === 1 || walk === 3 ? -1 : 0, drop = sit ? K(2) : 0;
  const yB = by - lh + bob + drop, yT = yB - th + 1;
  const legC = o.legs || cap ? o.base : b.skin.s, footC = b.skin.d, sleeve = o.sleeve ?? o.base;
  const tc = b.tc, tcD = tone(tc, -0.45), tcL = tone(tc, 0.3), gold = "#FFC46B";
  const capeOn = watcher && (b.tier >= 3 || cap), capeC = cap ? C.navy : tone(tc, -0.62), capeE = cap ? gold : b.tier === 5 ? gold : tone(tc, -0.25);

  if (dir === 0 || dir === 3) {
    const x0 = cx - tw / 2;
    // the cape, behind the body (front view: its edges at the sides)
    if (capeOn && dir === 0) {
      const cl = by - (yT + 2), cw2 = K(2.5);
      for (const cx2 of [x0 - aw - cw2 + K(1), x0 + tw + aw - K(1)]) { R(cx2, yT + 2, cw2, cl, capeC); D(cx2, yT + 2, cw2, 1, capeE); D(cx2, by - 1, cw2, 1, capeE); D(cx2 + (cx2 < x0 ? 0 : cw2 - 1), yT + 3, 1, cl - 2, tone(capeC, 0.18)); }
    }
    // legs
    if (sit) { R(x0 + K(1), yB + 1, lw, by - yB, legC); R(x0 + tw - K(1) - lw, yB + 1, lw, by - yB, legC); D(x0 + K(1) - 1, by, lw + 1, 1, footC); D(x0 + tw - K(1) - lw, by, lw + 1, 1, footC); }
    else {
      const lift = [walk === 0 ? K(1.5) : 0, walk === 2 ? K(1.5) : 0];
      const lx = [x0 + K(1), x0 + tw - K(1) - lw];
      for (let i = 0; i < 2; i++) {
        const h = by - yB - lift[i]!;
        R(lx[i]!, yB + 1, lw, h, legC);
        D(lx[i]! + (i === 0 ? -1 : 0), yB + h, lw + 1, 1, footC);
        if (mode === "ink") p.r(lx[i]! + (i === 0 ? -2 : -1), yB + h - 1, lw + 3, 3, C.ink);
      }
    }
    // the captain's coat skirt over the legs
    if (cap) { R(x0, yB, tw, Math.max(1, lh - K(1.5)), o.base); D(x0 + tw - 1, yB, 1, lh - K(1.5), o.shade); }
    // arms
    const ys = yT + 1, sw = walk === 0 ? [-1, 1] : walk === 2 ? [1, -1] : [0, 0];
    const arm = (x: number, len: number) => { R(x, ys, aw, len, sleeve); D(x, ys + len - K(2), aw, K(2), b.skin.s); if (o.style === 2) D(x, ys + K(2), aw, len - K(2) * 2, b.skin.s); if (watcher) D(x, ys + len - K(2) - 1, aw, 1, cap ? gold : tc); };
    arm(x0 - aw, al + sw[0]!);
    if (talk >= 0 && dir === 0) {
      // the right arm up, waving
      const ax = x0 + tw, ay = ys + K(2);
      R(ax, ay, K(4), aw, sleeve); R(ax + K(4) - 1, ay - K(3) + talk, aw, K(3) + 1, sleeve); D(ax + K(4) - 1, ay - K(3) + talk, aw, K(2), b.skin.s);
    } else arm(x0 + tw, al + sw[1]!);
    // torso, its shoulders rounded
    R(x0 + 1, yT, tw - 2, 1, o.base); R(x0, yT + 1, tw, th - 1, o.base);
    D(x0, yT + 1, 1, th - 2, o.light); D(x0 + tw - 1, yT + 1, 1, th - 1, o.shade); D(x0, yB, tw, 1, o.shade);
    if (dir === 0) frontDetails(D, o, b, x0, yT, yB, tw, K, tc, tcD, tcL, gold, cap, watcher);
    else {
      if (o.style === 0) D(cx - K(3), yT, K(6), K(2), o.shade);
      if (o.style === 2) D(x0, yT + K(3), tw, 1, o.detail);
      if (o.style === 4 || o.style === 6) D(x0, yB - K(2), tw, 1, watcher ? tcD : C.ink);
      if (o.style === 5) { D(x0 + 1, yT + 1, 1, th - 1, o.detail); D(x0 + tw - 2, yT + 1, 1, th - 1, o.detail); }
      if (capeOn) { R(x0 - 1, yT, tw + 2, by - 1 - yT, capeC); D(x0 - 1, yT, tw + 2, 1, capeE); for (let f = x0 + K(2); f < x0 + tw; f += K(3)) D(f, yT + K(2), 1, by - yT - K(3), tone(capeC, -0.3)); D(x0 - 1, by - 2, tw + 2, 1, capeE); }
      if (watcher && b.tier >= 2) { R(x0 - aw - 1, yT, aw + K(2), K(2), C.slate); R(x0 + tw - K(2) + 1, yT, aw + K(2), K(2), C.slate); D(x0 - aw - 1, yT, aw + K(2), 1, cap ? gold : tcL); D(x0 + tw - K(2) + 1, yT, aw + K(2), 1, cap ? gold : tcL); }
    }
    return yT;
  }

  // ---- facing right (the left frames are these mirrored)
  const x0 = cx - Math.floor(ts / 2), st = K(2);
  if (capeOn) { const sway = walk === 0 || walk === 2 ? 1 : 0; R(x0 - K(1) - sway, yT + 1, K(2) + sway, by - 1 - yT - 1, capeC); D(x0 - K(1) - sway, by - 2, K(2) + sway, 1, capeE); }
  if (sit) {
    R(x0 + 1, yB - K(1), ts + K(3), K(2), legC);
    R(x0 + ts + K(2) - lw + 1, yB, lw, by - yB + 1, legC);
    D(x0 + ts + K(2) - lw + 1, by, lw + 1, 1, footC);
  } else {
    const off = walk === 0 ? [st, -st] : walk === 2 ? [-st, st] : [0, 0], lift = walk === 1 ? [0, 1] : walk === 3 ? [1, 0] : [0, 0];
    const lx = cx - Math.floor(lw / 2);
    for (const i of [1, 0]) {
      const h = by - yB - lift[i]!, x = lx + off[i]!;
      R(x, yB + 1, lw, h, i === 1 ? tone(legC, -0.25) : legC);
      D(x, yB + h, lw + 1, 1, footC);
      if (mode === "ink") p.r(x - 1, yB + h - 1, lw + 3, 3, C.ink);
    }
  }
  if (cap) R(x0, yB, ts, Math.max(1, lh - K(1.5)), o.base);
  R(x0 + 1, yT, ts - 2, 1, o.base); R(x0, yT + 1, ts, th - 1, o.base);
  D(x0, yT + 1, 1, th - 1, o.shade); D(x0 + ts - 1, yT + 1, 1, th - 2, o.light); D(x0, yB, ts, 1, o.shade);
  if (o.style === 0) { D(x0, yT, K(2), K(2), o.shade); D(x0 + ts - K(3), yB - K(2), K(3), K(1), o.shade); }
  if (o.style === 2) { D(x0 + 1, yT + 1, ts - 2, th - 2, o.sleeve!); D(x0 + ts - K(3), yT + 1, K(3), th - 2, o.base); D(x0 + 1, yT + 1, K(2), th - 2, o.base); D(x0 + 1, yT + K(3), ts - 2, 1, o.detail); }
  if (o.style === 3) D(x0 + ts - 2, yT + 1, 1, th - 2, C.ink);
  if (o.style === 4 || o.style === 6) D(x0, yB - K(2), ts, 1, watcher ? (cap ? gold : tcD) : C.ink);
  if (o.style === 5) D(cx, yT + 1, 1, th - 1, o.detail);
  if (cap) { D(x0 + ts - 2, yT + 1, 1, th, gold); }
  if (watcher && b.tier >= 4 && !cap) D(x0 + ts - K(3), yT + 1, K(3), K(3), C.mist);
  if (watcher && b.tier >= 2) { R(cx - K(2), yT, K(4), K(2), C.slate); D(cx - K(2), yT, K(4), 1, cap ? gold : tcL); }
  // the near arm, swinging opposite the near leg
  const asw = walk === 0 ? -st : walk === 2 ? st : 0;
  if (talk >= 0) { R(x0 + ts - 1, yT + K(2) - talk, K(4), aw, sleeve); D(x0 + ts - 1 + K(4) - K(2), yT + K(2) - talk - 1, K(2), aw + 1, b.skin.s); }
  else {
    const ax = cx - Math.floor(aw / 2) + asw;
    R(ax, yT + 1, aw, al, sleeve); D(ax, yT + 1 + al - K(2), aw, K(2), b.skin.s);
    if (o.style === 2) D(ax, yT + 1 + K(2), aw, al - K(4), b.skin.s);
    if (b.acc === 2 && !watcher) { R(ax + aw - 1, yT + al - K(1), K(3), K(3), "#E5E0F1"); D(ax + aw - 1, yT + al - K(1), K(3), 1, "#3A231F"); }
    if (b.acc === 3 && !watcher) { R(ax + aw - 1, yT + al - K(2), K(2), K(4), "#141625"); D(ax + aw - 1, yT + al - K(1), K(2), 1, "#B8FF4A"); }
  }
  return yT;
}

function frontDetails(D: (x: number, y: number, w: number, h: number, c: Col) => void, o: Outfit, b: BodySpec, x0: number, yT: number, yB: number, tw: number,
  K: (v: number) => number, tc: Col, tcD: Col, tcL: Col, gold: Col, cap: boolean, watcher: boolean) {
  const cx = x0 + tw / 2, th = yB - yT + 1;
  switch (o.style) {
    case 0: D(x0 + K(2), yB - K(2), tw - K(4), K(2), o.shade); D(x0 + K(2), yB - K(2), tw - K(4), 1, o.light); D(cx - K(2), yT + 1, 1, K(2), o.detail); D(cx + K(2) - 1, yT + 1, 1, K(2), o.detail); D(x0 + 1, yT, tw - 2, 1, o.shade); break;
    case 2: D(x0 + K(3), yT + 1, tw - K(6), th - 2, o.sleeve!); D(x0 + 1, yT + K(3), K(2), 1, o.detail); D(x0 + tw - 1 - K(2), yT + K(3), K(2), 1, o.detail); D(x0 + 1, yT + K(5), K(2), 1, o.detail); D(x0 + tw - 1 - K(2), yT + K(5), K(2), 1, o.detail); break;
    case 3: D(cx, yT + 1, 1, th - 1, C.ink); D(cx - 2, yT, 2, 1, o.light); D(cx + 1, yT, 2, 1, o.light); D(x0 + K(2), yT + K(4), K(2), 1, o.detail); break;
    case 4: D(x0, yB - K(2), tw, 1, C.ink); D(cx - 1, yB - K(2), 2, 1, "#FFC46B"); D(x0 + K(2), yT + K(2), K(2), 1, o.detail); D(cx, yT + 1, 1, K(3), o.shade); break;
    case 5: D(x0 + 1, yT + 1, 1, th - 1, o.detail); D(x0 + tw - 2, yT + 1, 1, th - 1, o.detail); D(cx, yT + 1, 1, th - 2, o.light); break;
    case 6: {
      // the Night Watch uniform: tier collar and belt, shoulder plates from II, a chest plate from IV
      D(x0 + 1, yT, tw - 2, 1, b.tier === 5 ? gold : tc); D(x0, yB - K(2), tw, 1, b.tier === 5 ? gold : tcD); D(cx - 1, yB - K(2), 2, 1, tcL);
      if (b.tier === 1) D(cx - 1, yT + K(2), 2, K(3), tc);
      if (b.tier >= 2) { D(x0 - K(2) - 1, yT, K(2) + K(2), K(2), C.slate); D(x0 + tw - K(2) + 1, yT, K(2) + K(2), K(2), C.slate); D(x0 - K(2) - 1, yT, K(4), 1, b.tier === 5 ? gold : tcL); D(x0 + tw - K(2) + 1, yT, K(4), 1, b.tier === 5 ? gold : tcL); }
      if (b.tier === 2 || b.tier === 3) { D(x0 + K(2), yT + K(2), K(2), K(2), tc); }
      if (b.tier >= 4) { D(x0 + K(2), yT + 1, tw - K(4), K(3), C.mist); D(x0 + K(2), yT + K(3), tw - K(4), 1, C.fog); D(cx - K(1), yT + K(1), K(2), K(1.5), tc); }
      break;
    }
    case 7: {
      // The Captain's coat: gold buttons and epaulettes, a gold sash
      D(cx - 1, yT + 1, 1, th - 1, C.fog); for (let y = yT + K(2); y < yB; y += K(2.5)) { D(cx - K(2), y, 1, 1, gold); D(cx + K(2) - 1, y, 1, 1, gold); }
      D(x0 - K(2) - 1, yT, K(4), K(2), gold); D(x0 + tw - K(2) + 1, yT, K(4), K(2), gold); D(x0 - K(2) - 1, yT + K(2), K(4), 1, "#FFF0B5"); D(x0 + tw - K(2) + 1, yT + K(2), K(4), 1, "#FFF0B5");
      D(x0 + 1, yT + 1, 1, th - 2, C.white); D(x0 + K(2), yT + K(1), K(2), K(1), C.wine);
      break;
    }
  }
  if (watcher || cap) return;
  // what it wears or holds
  if (b.acc === 0) { for (let i = 0; i <= K(3); i++) { D(x0 + K(2) + i, yT + Math.min(i, K(3)), 1, 1, "#FFC46B"); D(x0 + tw - K(2) - 1 - i, yT + Math.min(i, K(3)), 1, 1, "#FFC46B"); } D(cx - 1, yT + K(3), 2, K(2), "#FFC46B"); D(cx - 1, yT + K(3) + K(2) - 1, 2, 1, "#795125"); }
  if (b.acc === 1) { D(cx - K(2), yT + 1, 1, K(2), "#7C5CFF"); D(x0 + K(2), yT + K(3), K(2), K(3), "#E6E5DF"); D(x0 + K(2), yT + K(3) + 1, K(2), 1, "#7C5CFF"); }
  if (b.acc === 2) { D(x0 + tw + K(1), yT + K(4), K(3), K(3), "#E5E0F1"); D(x0 + tw + K(1), yT + K(4), K(3), 1, "#3A231F"); D(x0 + tw + K(1) + K(3), yT + K(5), 1, 1, "#E5E0F1"); }
  if (b.acc === 3) { D(x0 + tw + K(1), yT + K(3), K(2), K(4), "#141625"); D(x0 + tw + K(1), yT + K(4), K(2), 1, "#B8FF4A"); }
}
