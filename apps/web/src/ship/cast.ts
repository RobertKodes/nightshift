import { type Frames, type Head, type Key, Faces, POSES, P_IDLE, P_SIT, P_WALK, bodyFrames, headScale } from "./frogs";
import type { Rect } from "./fx";
import type { ShipStatic } from "./types";

/**
 * The crew as whole-body characters in the ship's isometric space: each one's pixel body (its Body trait's
 * outfit, its Skin trait's arms and legs, its accessory; a Night Watcher in its tier's uniform, The Captain in
 * the long white coat) under its own onchain head, in four facings and nine poses (idle, a 4-frame walk, seated,
 * talking). Bodies are shared between characters with the same traits; heads are rasterised once each. One art
 * pixel is U world px for everyone, so a Night Watcher (1.5×) and The Captain (1.75×) are simply drawn bigger.
 */
export const U = 1.6;
/** The scale (atlas px per art px) of the far-away poses. */
const MS = 0.6;
const CROP = { x: 172, y: 104 } as const;

export type Who = { key: Key; k: number; tier: number; tc: string; traits: number[]; fr?: Frames; hd?: Head };
export type Drawn = { x: number; y: number; w: number; h: number; head: Rect | null; hand: [number, number] | null; face: boolean };

export class Cast {
  readonly faces: Faces;
  private bodies = new Map<string, Frames>();
  constructor(st: ShipStatic) { this.faces = new Faces(st); }

  frames(w: Who): Frames {
    if (w.fr) return w.fr;
    const t = w.traits, watcher = w.tier > 0;
    const id = watcher ? `w${w.tier}|${w.tc}|${t[2]}|${w.k}` : `${t[1]}|${t[2]}|${t[6]}`;
    let f = this.bodies.get(id);
    if (!f) {
      f = bodyFrames({ k: w.k, outfit: t[1] ?? 0, skin: this.faces.skins[t[2] ?? 0] ?? this.faces.skins[0]!, acc: t[6] ?? 5, tier: w.tier, tc: w.tc });
      this.bodies.set(id, f);
    }
    return (w.fr = f);
  }

  // ---- far out: each character's few far-away poses, composed once (body and head) into one shared atlas
  private atlas: HTMLCanvasElement | null = null;
  private ag: CanvasRenderingContext2D | null = null;
  private shelf = { x: 0, y: 0, h: 0 };
  private minis = new Map<string, { x: number; y: number; cw: number; ch: number; head: boolean; H: number }>();
  private built = 0;
  /** Call once a frame: how many characters may be composed this frame. */
  frame() { this.built = 0; }
  private miniIndex(dir: number, pose: number) {
    if (pose === P_SIT) return 0;
    if (pose >= P_WALK && pose < P_SIT && (dir === 1 || dir === 2)) return 5 + (dir - 1) * 4 + (pose - P_WALK);
    return 1 + dir;
  }
  /** Draws a far-away character from the atlas in one call; false when it is not composed yet. */
  drawMini(c: CanvasRenderingContext2D, w: Who, x: number, y: number, dir: number, pose: number): boolean {
    const key = String(w.key);
    let m = this.minis.get(key);
    const hd = w.hd ?? (w.hd = this.faces.get(w.key, w.k) ?? undefined);
    if (!m || (!m.head && hd)) { if (this.built >= 24) return Boolean(m && this.blit(c, m, w, x, y, dir, pose)); this.built++; m = this.compose(w, hd ?? null, m) ?? undefined; if (!m) return false; }
    return this.blit(c, m, w, x, y, dir, pose);
  }
  private blit(c: CanvasRenderingContext2D, m: { x: number; y: number; cw: number; ch: number; H: number }, w: Who, x: number, y: number, dir: number, pose: number) {
    const fr = this.frames(w), i = this.miniIndex(dir, pose);
    if (!c.imageSmoothingEnabled) c.imageSmoothingEnabled = true;
    c.drawImage(this.atlas!, m.x + i * m.cw, m.y, m.cw, m.ch, x - fr.cx * U, y - (m.H - 1) * U, (m.cw / MS) * U, (m.ch / MS) * U);
    return true;
  }
  private compose(w: Who, hd: Head | null, old?: { x: number; y: number; cw: number; ch: number; head: boolean; H: number }) {
    if (!this.atlas) { this.atlas = document.createElement("canvas"); this.atlas.width = 2048; this.atlas.height = 2048; this.ag = this.atlas.getContext("2d")!; this.ag.imageSmoothingQuality = "high"; }
    const fr = this.frames(w), H = Math.ceil(38 * w.k), cw = Math.ceil(fr.cw * MS) + 1, ch = Math.ceil(H * MS) + 1;
    let at = old;
    if (!at) {
      if (this.shelf.x + cw * 13 > 2048) { this.shelf.x = 0; this.shelf.y += this.shelf.h; this.shelf.h = 0; }
      if (this.shelf.y + ch > 2048) return null;
      at = { x: this.shelf.x, y: this.shelf.y, cw, ch, head: false, H };
      this.shelf.x += cw * 13; this.shelf.h = Math.max(this.shelf.h, ch);
    }
    const g = this.ag!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(at.x, at.y, cw * 13, ch);
    const cells: [number, number][] = [[0, P_SIT], [0, P_IDLE], [1, P_IDLE], [2, P_IDLE], [3, P_IDLE], [1, P_WALK], [1, P_WALK + 1], [1, P_WALK + 2], [1, P_WALK + 3], [2, P_WALK], [2, P_WALK + 1], [2, P_WALK + 2], [2, P_WALK + 3]];
    cells.forEach(([dir, pose], i) => {
      g.setTransform(MS, 0, 0, MS, at!.x + i * cw, at!.y);
      g.imageSmoothingEnabled = true;
      g.drawImage(fr.sheet, pose * fr.cw, dir * fr.ch, fr.cw, fr.ch, 0, H - fr.ch, fr.cw, fr.ch);
      const cell = dir * POSES + pose, neck = fr.head[cell]! + Math.round(2.2 * w.k);
      if (hd) { const img = dir === 3 ? hd.back : hd.front; g.drawImage(img, fr.cx + fr.hx[cell]! - Math.floor(hd.w / 2), H - 1 + neck - hd.chin); }
      else { const sk = this.faces.skins[w.traits[2] ?? 0] ?? this.faces.skins[0]!; g.fillStyle = sk.s; g.beginPath(); g.ellipse(fr.cx, H - 1 + neck - 7.5 * w.k, 10 * w.k, 7.5 * w.k, 0, 0, Math.PI * 2); g.fill(); }
    });
    g.setTransform(1, 0, 0, 1, 0, 0);
    at.head = Boolean(hd);
    this.minis.set(String(w.key), at);
    return at;
  }

  /**
   * Draws a character with its feet at world (x, y); `dir` 0 toward the camera, 1 left, 2 right, 3 away. `px` is
   * device pixels per art pixel (crisp pixels from 2.4 up, smoothed below). Returns where it was drawn.
   */
  draw(c: CanvasRenderingContext2D, w: Who, x: number, y: number, dir: number, pose: number, px: number, opts: { blink?: boolean; breath?: number; head?: boolean } = {}): Drawn {
    const fr = this.frames(w), cell = dir * POSES + pose, s = U;
    const crisp = px >= 2.4;
    if (c.imageSmoothingEnabled === crisp) c.imageSmoothingEnabled = !crisp;
    c.drawImage(fr.sheet, pose * fr.cw, dir * fr.ch, fr.cw, fr.ch, x - fr.cx * s, y - fr.by * s, fr.cw * s, fr.ch * s);
    const ax = fr.acc[cell * 2]!, hand: [number, number] | null = ax >= 0 ? [x + (ax - fr.cx) * s, y + (fr.acc[cell * 2 + 1]! - fr.by) * s] : null;
    const neck = fr.head[cell]! + Math.round(2.2 * w.k), br = opts.breath ?? 0;
    const hd = opts.head === false ? null : w.hd ?? (w.hd = this.faces.get(w.key, w.k) ?? undefined) ?? null;
    let top: number, head: Rect | null = null;
    if (hd) {
      const img = dir === 3 ? hd.back : opts.blink && hd.blink ? hd.blink : hd.front;
      const hx = x + (fr.hx[cell]! - Math.floor(hd.w / 2)) * s, hy = y + (neck - hd.chin + br) * s;
      c.drawImage(img, hx, hy, img.width * s, img.height * s);
      top = hy + hd.top * s;
      head = headRect(hd, hx, hy, w.k);
    } else {
      // until its art is drawn: the head's shape in its skin colour
      const sk = this.faces.skins[w.traits[2] ?? 0] ?? this.faces.skins[0]!;
      const rx = 10 * w.k * s, ry = 7.5 * w.k * s, cy = y + (neck + br) * s - ry;
      c.fillStyle = "#181425"; c.beginPath(); c.ellipse(x, cy, rx + s, ry + s, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = sk.s; c.beginPath(); c.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2); c.fill();
      top = cy - ry;
    }
    return { x: x - 11 * w.k * s, y: top, w: 22 * w.k * s, h: y - top, head, hand, face: dir !== 3 };
  }
}

/** The rect standing for the onchain art's bust round a drawn head, so the trait effects land on their traits. */
function headRect(hd: Head, hx: number, hy: number, k: number): Rect {
  const u = U / headScale(k);
  void hd;
  return { x: hx + U + (40 - CROP.x) * u, y: hy + U + (130 - CROP.y) * u, w: 920 * u, h: 870 * u };
}
