import { type Frames, type Head, type Key, Faces, POSES, bodyFrames, headScale } from "./frogs";
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
const CROP = { x: 172, y: 104 } as const;

export type Who = { key: Key; k: number; tier: number; tc: string; traits: number[] };
export type Drawn = { x: number; y: number; w: number; h: number; head: Rect | null; hand: [number, number] | null; face: boolean };

export class Cast {
  readonly faces: Faces;
  private bodies = new Map<string, Frames>();
  constructor(st: ShipStatic) { this.faces = new Faces(st); }

  frames(w: Who): Frames {
    const t = w.traits, watcher = w.tier > 0;
    const id = watcher ? `w${w.tier}|${w.tc}|${t[2]}|${w.k}` : `${t[1]}|${t[2]}|${t[6]}`;
    let f = this.bodies.get(id);
    if (!f) {
      f = bodyFrames({ k: w.k, outfit: t[1] ?? 0, skin: this.faces.skins[t[2] ?? 0] ?? this.faces.skins[0]!, acc: t[6] ?? 5, tier: w.tier, tc: w.tc });
      this.bodies.set(id, f);
    }
    return f;
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
    const hd = opts.head === false ? null : this.faces.get(w.key, w.k);
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
