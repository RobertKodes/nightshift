/**
 * The town's pixels: one limited palette (ENDESGA 32) every room, prop and outfit is painted with, a tiny
 * painter that only ever fills whole pixels, a 3 × 5 pixel font for bubbles and plates, and light done the
 * pixel-art way: a lamp's pool swaps each floor colour for the next lighter one in its ramp, dithered at the edge.
 */
export const C = {
  ink: "#181425", night: "#262b44", steel: "#3a4466", slate: "#5a6988", fog: "#8b9bb4", mist: "#c0cbdc", white: "#ffffff",
  plum: "#3e2731", bark: "#733e39", wood: "#b86f50", tan: "#e4a672", sand: "#ead4aa", skin: "#e8b796", clay2: "#c28569",
  rust: "#be4a2f", clay: "#d77643", wine: "#a22633", red: "#e43b44", orange: "#f77622", amber: "#feae34", lemon: "#fee761",
  leaf: "#63c74d", moss: "#3e8948", pine: "#265c42", teal: "#193c3e", navy: "#124e89", sky: "#0099db", cyan: "#2ce8f5",
  hot: "#ff0044", grape: "#68386c", rose: "#b55088", pink: "#f6757a",
} as const;
export type Col = string;

/** Each colour's next lighter one: what a lamp turns it into. */
const LIGHTER: [Col, Col][] = [
  [C.ink, C.night], [C.night, C.steel], [C.steel, C.slate], [C.slate, C.fog], [C.fog, C.mist], [C.mist, C.white],
  [C.plum, C.bark], [C.bark, C.wood], [C.wood, C.tan], [C.tan, C.sand], [C.sand, C.white], [C.clay2, C.skin], [C.skin, C.sand],
  [C.rust, C.clay], [C.clay, C.tan], [C.wine, C.red], [C.red, C.pink], [C.orange, C.amber], [C.amber, C.lemon], [C.lemon, C.white],
  [C.teal, C.pine], [C.pine, C.moss], [C.moss, C.leaf], [C.leaf, C.lemon], [C.navy, C.sky], [C.sky, C.cyan], [C.cyan, C.white],
  [C.grape, C.rose], [C.rose, C.pink], [C.pink, C.skin],
];
const rgb = (h: Col) => parseInt(h.slice(1, 7), 16);
const UP = new Map(LIGHTER.map(([a, b]) => [rgb(a), rgb(b)]));
const DOWN = new Map(LIGHTER.map(([a, b]) => [rgb(b), rgb(a)]));

/** 4 × 4 ordered dither: the pattern every soft edge uses instead of a gradient. */
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)]!;

/**
 * A pool of light (or shade) on an image: inside `core` of the radius every colour steps one along its ramp,
 * out to the radius the step is dithered away. `ry` squashes it into the floor's 3/4 view.
 */
export function pool(img: ImageData, cx: number, cy: number, rx: number, ry: number, core = 0.55, dark = false) {
  const map = dark ? DOWN : UP, d = img.data, W = img.width, H = img.height;
  for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(H, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(W, Math.ceil(cx + rx)); x++) {
      const q = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (q >= 1 || (q > core && bayer(x, y) < (q - core) / (1 - core))) continue;
      const i = (y * W + x) * 4, c = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!, n = map.get(c);
      if (n === undefined) continue;
      d[i] = n >> 16; d[i + 1] = (n >> 8) & 255; d[i + 2] = n & 255;
    }
  }
}

/** Darkens or lightens a hex colour (for the tier colours and the frogs' own, which are not in the palette). */
export function tone(h: Col, f: number): Col {
  const n = rgb(h), k = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `#${((k(n >> 16) << 16) | (k((n >> 8) & 255) << 8) | k(n & 255)).toString(16).padStart(6, "0")}`;
}

// 3 × 5 glyphs, rows top to bottom
const GLYPHS: Record<string, string> = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111", F: "111100110100100",
  G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100", Q: "010101101110011", R: "110101110101101",
  S: "011100010001110", T: "111010010010010", U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111", "0": "111101101101111", "1": "010110010010111", "2": "110001010100111", "3": "110001010001110",
  "4": "101101111001001", "5": "111100110001110", "6": "011100110101010", "7": "111001010010010", "8": "010101010101010", "9": "010101011001110",
  ".": "000000000000010", ",": "000000000010100", ":": "000010000010000", "!": "010010010000010", "?": "110001010000010", "'": "010010000000000",
  "-": "000000111000000", "+": "000010111010000", "/": "001001010100100", "%": "101001010100101", "#": "101111101111101", "(": "001010010010001",
  ")": "100010010010100", $: "011110010011110", "=": "000111000111000", "&": "010101010101011", "*": "000101010101000", "<": "001010100010001",
  ">": "100010001010100", "·": "000000010000000", "×": "000101010101000",
};
export const textW = (s: string) => Math.max(0, s.length * 4 - 1);

export class Pix {
  constructor(public g: CanvasRenderingContext2D) {}
  r(x: number, y: number, w: number, h: number, c: Col) { if (w <= 0 || h <= 0) return; this.g.fillStyle = c; this.g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  p(x: number, y: number, c: Col) { this.r(x, y, 1, 1, c); }
  /** A box with an ink edge, a lit top row and a shaded bottom row. */
  box(x: number, y: number, w: number, h: number, fill: Col, hi?: Col, lo?: Col, edge: Col | null = C.ink) {
    if (edge) { this.r(x, y, w, h, edge); x++; y++; w -= 2; h -= 2; }
    this.r(x, y, w, h, fill);
    if (hi) this.r(x, y, w, 1, hi);
    if (lo) this.r(x, y + h - 1, w, 1, lo);
  }
  /** A checker of `c` over a rect: a half tone. */
  dither(x: number, y: number, w: number, h: number, c: Col, ph = 0) {
    this.g.fillStyle = c;
    for (let j = 0; j < h; j++) for (let i = (j + ph) & 1; i < w; i += 2) this.g.fillRect(x + i, y + j, 1, 1);
  }
  /** A pixel ellipse, filled scanline by scanline. */
  ell(cx: number, cy: number, rx: number, ry: number, c: Col) {
    this.g.fillStyle = c;
    for (let dy = -ry; dy <= ry; dy++) { const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2))); this.g.fillRect(Math.round(cx - hw), Math.round(cy + dy), hw * 2 + 1, 1); }
  }
  /** A pixel ellipse's outline; `dash` skips every other run of pixels. */
  ring(cx: number, cy: number, rx: number, ry: number, c: Col, dash = 0) {
    this.g.fillStyle = c;
    const n = Math.max(16, Math.round((rx + ry) * 3.2)), seen = new Set<number>();
    for (let k = 0; k < n; k++) {
      if (dash && Math.floor(k / dash) % 2) continue;
      const a = (k / n) * Math.PI * 2, x = Math.round(cx + Math.cos(a) * rx), y = Math.round(cy + Math.sin(a) * ry), key = x * 4096 + y;
      if (seen.has(key)) continue;
      seen.add(key); this.g.fillRect(x, y, 1, 1);
    }
  }
  /** The 3 × 5 font. `align` 0 left, 0.5 centre, 1 right. */
  text(s: string, x: number, y: number, c: Col, align = 0) {
    const t = s.toUpperCase();
    let cx = Math.round(x - textW(t) * align);
    this.g.fillStyle = c;
    for (const ch of t) {
      const gl = GLYPHS[ch];
      if (gl) for (let k = 0; k < 15; k++) if (gl[k] === "1") this.g.fillRect(cx + (k % 3), y + Math.floor(k / 3), 1, 1);
      cx += 4;
    }
  }
}

/** A canvas of w × h with its painter; `read` for one whose pixels are read back (it is copied before it is drawn). */
export function sheet(w: number, h: number, read = false): { c: HTMLCanvasElement; p: Pix } {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return { c, p: new Pix(c.getContext("2d", { willReadFrequently: read })!) };
}
/** A plain copy of a canvas, for drawing every frame. */
export function copy(src: HTMLCanvasElement): HTMLCanvasElement { const s = sheet(src.width, src.height); s.p.g.drawImage(src, 0, 0); return s.c; }

/** A small deterministic random, so every room is laid out the same way on every visit. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
