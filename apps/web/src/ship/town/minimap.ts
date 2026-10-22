import type { Station as RoomKey } from "../types";

/**
 * The ship map as a pixel-art ship (176 × 28 pixels, drawn crisp at an integer scale): three engines with
 * flickering exhaust at the stern, the hull, the bow, and the seven rooms where they sit, each with its own icon
 * and a few crew dots that wander inside it. The room you are in glows in its colour. The page lays transparent
 * buttons over the cells (CELLS) for clicks, keys and screen readers.
 */
export const MAP_W = 176, MAP_H = 28;
/** Each room's cell in map pixels: x, y, w, h. */
export const CELLS: Record<RoomKey, [number, number, number, number]> = {
  forge: [14, 4, 28, 20], engine: [44, 4, 32, 20],
  breakroom: [78, 4, 28, 9], missions: [78, 15, 28, 9],
  quarters: [108, 4, 26, 9], offices: [108, 15, 26, 9],
  bridge: [136, 4, 22, 20],
};
const C = { space: "#0b0a12", hull: "#3a4466", hullHi: "#5a6988", hullLo: "#262b44", edge: "#181425", win: "#8b9bb4", flame: "#f77622", flameHi: "#feae34", cell: "#181425" };
/** 7 × 7 icons, one per room ("#" = the room colour, "+" = white). */
const ICON: Record<RoomKey, string[]> = {
  forge: ["...#...", "..##...", "..###..", ".#####.", ".......", "#######", ".##.##."],
  engine: ["..###..", ".#+..#.", "#..+..#", "#.+++.#", "#..+..#", ".#...#.", "..###.."],
  breakroom: [".......", ".#####.", ".#####+", ".#####+", ".#####.", "..###..", "......."],
  missions: ["...+...", "..###..", "..#+#..", "..###..", ".#####.", ".#...#.", "......."],
  quarters: [".......", "#..#..#", "##.#.##", "#######", "#######", ".......", "......."],
  offices: [".......", "..###..", "#######", "#.....#", "#.....#", "#######", "......."],
  bridge: ["..###..", ".#...#.", "#..+..#", "#.+#+.#", "#..+..#", ".#...#.", "..###.."],
};
type Dot = { x: number; y: number; tx: number; ty: number };

export class Minimap {
  private dots = new Map<RoomKey, Dot[]>();
  draw(c: CanvasRenderingContext2D, t: number, room: RoomKey, accent: (k: RoomKey) => string, crew: Partial<Record<RoomKey, number>>, mine: Set<RoomKey>) {
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, MAP_W, MAP_H);
    const px = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    // exhaust: three nozzles at the stern, the flames flicker
    for (const y of [5, 11.5, 18].map(Math.round)) {
      px(6, y, 6, 6, C.hullLo); px(6, y, 6, 1, C.hullHi); px(5, y + 1, 1, 4, C.edge);
      const f = 2 + Math.round((Math.sin(t * 22 + y) + 1) * 1.5);
      px(5 - f, y + 2, f, 2, C.flame); px(5 - Math.max(1, f - 2), y + 2, Math.max(1, f - 2), 1, C.flameHi);
    }
    // the hull: dark outline, a lit top edge, a shaded keel, the pointed bow
    px(12, 1, 148, 26, C.edge); px(13, 2, 146, 24, C.hull); px(13, 2, 146, 1, C.hullHi); px(13, 25, 146, 1, C.hullLo);
    for (let k = 0; k < 12; k++) { px(159 + k, 2 + k, 1, 24 - 2 * k, C.hull); px(159 + k, 1 + k, 1, 1, C.edge); px(159 + k, 26 - k, 1, 1, C.edge); }
    px(171, 12, 2, 4, C.edge);
    // the rooms
    for (const k of Object.keys(CELLS) as RoomKey[]) {
      const [x, y, w, h] = CELLS[k], col = accent(k), on = k === room;
      px(x - 1, y - 1, w + 2, h + 2, on ? col : C.edge);
      px(x, y, w, h, on ? shade(col, 0.32) : C.cell);
      if (on) { const a = 0.5 + 0.5 * Math.sin(t * 4); c.globalAlpha = 0.35 + a * 0.4; px(x - 1, y - 1, w + 2, 1, "#ffffff"); c.globalAlpha = 1; }
      // the icon, at the cell's centre
      const ic = ICON[k], ix = x + Math.floor((w - 7) / 2), iy = y + Math.floor((h - 7) / 2) - (h > 12 ? 2 : 0);
      ic.forEach((row, r) => { for (let q = 0; q < 7; q++) { const ch = row[q]; if (ch === "#") px(ix + q, iy + r, 1, 1, on ? "#ffffff" : col); else if (ch === "+") px(ix + q, iy + r, 1, 1, on ? col : "#f4f4f4"); } });
      // a few crew dots wander in the room (one per ~12 aboard, at most 5)
      const n = Math.min(5, Math.ceil((crew[k] ?? 0) / 12));
      let ds = this.dots.get(k);
      if (!ds || ds.length !== n) { ds = Array.from({ length: n }, () => { const p = spot(x, y, w, h); return { x: p[0], y: p[1], tx: p[0], ty: p[1] }; }); this.dots.set(k, ds); }
      for (const d of ds) {
        if (Math.abs(d.x - d.tx) + Math.abs(d.y - d.ty) < 0.3) [d.tx, d.ty] = spot(x, y, w, h);
        d.x += Math.sign(d.tx - d.x) * Math.min(Math.abs(d.tx - d.x), 0.08); d.y += Math.sign(d.ty - d.y) * Math.min(Math.abs(d.ty - d.y), 0.08);
        px(Math.round(d.x), Math.round(d.y), 1, 1, on ? "#ffffff" : shade(col, 0.85));
      }
      // your crew is here: a yellow flag in the corner
      if (mine.has(k)) { px(x + 1, y + 1, 1, 4, "#fee761"); px(x + 2, y + 1, 2, 2, "#fee761"); }
    }
  }
}
const spot = (x: number, y: number, w: number, h: number): [number, number] => [x + 2 + Math.random() * (w - 4), y + h - 2 - Math.random() * Math.min(3, h - 8)];
/** A colour mixed toward black (k < 1) in sRGB, for unlit floors and dim dots. */
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}
