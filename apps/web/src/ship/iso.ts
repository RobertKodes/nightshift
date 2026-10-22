/**
 * The Ship's isometric space. World units: x across the ship (port 0 → starboard), y along it (bow 0 → stern),
 * z up; one unit is one floor tile. "World px" are screen pixels at zoom 1: a tile is 64 × 32 and a unit of
 * height 32. The camera looks from +x +y, so the +x and +y faces of a box face it and the bow is up-right.
 */
export const HX = 32, HY = 16, HZ = 32;
export type V3 = [number, number, number];
export const sx = (x: number, y: number) => (x - y) * HX;
export const sy = (x: number, y: number, z = 0) => (x + y) * HY - z * HZ;
export const P = (x: number, y: number, z = 0): [number, number] => [(x - y) * HX, (x + y) * HY - z * HZ];
/** A circle of radius r on the floor is this ellipse on screen. */
export const RX = HX * Math.SQRT2, RY = HY * Math.SQRT2;

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Fill = string | CanvasGradient | CanvasPattern | null;

export function path(c: Ctx, pts: V3[]) {
  c.beginPath();
  pts.forEach(([x, y, z], i) => { const [a, b] = P(x, y, z); if (i) c.lineTo(a, b); else c.moveTo(a, b); });
  c.closePath();
}
export function poly(c: Ctx, pts: V3[], fill: Fill, stroke?: string, lw = 1) {
  path(c, pts);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}
export function line(c: Ctx, a: V3, b: V3, stroke: string, lw = 1) {
  const [x0, y0] = P(...a), [x1, y1] = P(...b);
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.strokeStyle = stroke; c.lineWidth = lw; c.stroke();
}

export type BoxStyle = { top: Fill; left: Fill; right: Fill; edge?: string; lw?: number; glow?: string };
/** A box from (x, y, z) of size w (x) × d (y) × h (z): its top, +y face (left on screen) and +x face (right). */
export function box(c: Ctx, x: number, y: number, z: number, w: number, d: number, h: number, s: BoxStyle) {
  const X = x + w, Y = y + d, Z = z + h;
  if (s.left) poly(c, [[x, Y, z], [X, Y, z], [X, Y, Z], [x, Y, Z]], s.left);
  if (s.right) poly(c, [[X, y, z], [X, Y, z], [X, Y, Z], [X, y, Z]], s.right);
  if (s.top) poly(c, [[x, y, Z], [X, y, Z], [X, Y, Z], [x, Y, Z]], s.top);
  if (s.edge) {
    c.strokeStyle = s.edge; c.lineWidth = s.lw ?? 1;
    path(c, [[x, Y, Z], [X, Y, Z], [X, y, Z]]); c.stroke();
    if (s.glow) { line(c, [x, Y, Z], [X, Y, Z], s.glow, (s.lw ?? 1) * 1.4); line(c, [X, y, Z], [X, Y, Z], s.glow, (s.lw ?? 1) * 1.4); }
  }
}

/** An ellipse lying on the floor plane (a circle in the world). */
export function disc(c: Ctx, x: number, y: number, z: number, r: number, fill: Fill, stroke?: string, lw = 1) {
  const [a, b] = P(x, y, z);
  c.beginPath(); c.ellipse(a, b, r * RX, r * RY, 0, 0, Math.PI * 2);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}

/** A vertical cylinder (pedestal, tank, reactor shell): side band and top. */
export function cylinder(c: Ctx, x: number, y: number, z: number, r: number, h: number, side: Fill, top: Fill, edge?: string) {
  const [a, b] = P(x, y, z), t = b - h * HZ;
  c.beginPath();
  c.ellipse(a, b, r * RX, r * RY, 0, 0, Math.PI);
  c.lineTo(a - r * RX, t);
  c.ellipse(a, t, r * RX, r * RY, 0, Math.PI, 0, true);
  c.closePath();
  if (side) { c.fillStyle = side; c.fill(); }
  c.beginPath(); c.ellipse(a, t, r * RX, r * RY, 0, 0, Math.PI * 2);
  if (top) { c.fillStyle = top; c.fill(); }
  if (edge) { c.strokeStyle = edge; c.lineWidth = 1; c.stroke(); }
}

/**
 * Draws in a plane of the world: `fn` gets a 2D space where (u, v) are world units along the plane's axes.
 * floor: u = +x, v = +y; wallX (a wall at x): u = +y, v = −z (down); wallY (a wall at y): u = +x, v = −z.
 */
export function plane(c: Ctx, kind: "floor" | "wallX" | "wallY", o: V3, fn: () => void) {
  const [ox, oy] = P(...o);
  c.save();
  if (kind === "floor") c.transform(HX, HY, -HX, HY, ox, oy);
  else if (kind === "wallX") c.transform(-HX, HY, 0, HZ, ox, oy);
  else c.transform(HX, HY, 0, HZ, ox, oy);
  fn();
  c.restore();
}

export const lin = (c: Ctx, a: [number, number], b: [number, number], stops: [number, string][]) => {
  const g = c.createLinearGradient(a[0], a[1], b[0], b[1]);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
};
export const rad = (c: Ctx, x: number, y: number, r: number, stops: [number, string][]) => {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
};
/** A colour with alpha: "#4ad8ff" + .3 → "rgba(74,216,255,.3)". */
export function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/** Mixes two hex colours: t 0 → a, 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const c = (u: number, v: number) => Math.round(u + (v - u) * t).toString(16).padStart(2, "0");
  return `#${c(r1!, r2!)}${c(g1!, g2!)}${c(b1!, b2!)}`;
}
/** A soft additive glow (light pool) on the floor. */
export function pool(c: Ctx, x: number, y: number, z: number, r: number, color: string, a: number) {
  const [px, py] = P(x, y, z);
  c.save();
  c.translate(px, py); c.scale(1, 0.5);
  c.fillStyle = rad(c, 0, 0, r * RX, [[0, alpha(color, a)], [0.45, alpha(color, a * 0.45)], [1, alpha(color, 0)]]);
  c.beginPath(); c.arc(0, 0, r * RX, 0, Math.PI * 2); c.fill();
  c.restore();
}
/** A seeded random number generator, so the scene is the same on every visit. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1_000_000) / 1_000_000; };
}

const glows = new Map<string, HTMLCanvasElement>();
/** A soft round light (cached per colour): far cheaper than a gradient per frame. Uses the current composite mode. */
export function glow(c: Ctx, x: number, y: number, r: number, color: string, a: number, sy = 1) {
  if (a <= 0.004 || r <= 0) return;
  let g = glows.get(color);
  if (!g) {
    g = document.createElement("canvas"); g.width = g.height = 64;
    const x2 = g.getContext("2d")!, gr = x2.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, alpha(color, 1)); gr.addColorStop(0.35, alpha(color, 0.45)); gr.addColorStop(0.7, alpha(color, 0.12)); gr.addColorStop(1, alpha(color, 0));
    x2.fillStyle = gr; x2.fillRect(0, 0, 64, 64);
    glows.set(color, g);
  }
  const ga = c.globalAlpha;
  c.globalAlpha = ga * Math.min(1, a);
  c.drawImage(g, x - r, y - r * sy, r * 2, r * 2 * sy);
  c.globalAlpha = ga;
}
