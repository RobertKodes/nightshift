import { alpha, glow } from "./iso";
import { VB, at } from "./sprites";

/**
 * What each trait does on the ship, drawn over its character: laser eyes fire, the crown sparkles, the halo
 * glows, the VR visor scrolls, the coffee steams, the earpiece blinks, the hard hat's lamp shines, and so on.
 * Points are in the onchain art's own 1000 × 1000 coordinates, so every effect sits exactly on its trait.
 * Everything is a pure function of time and the frog's number: nothing to store, the same on every screen.
 * Light is drawn from cached sprites in one additive pass (fxLight); the few opaque effects in another (fxSolid).
 */
export type Rect = { x: number; y: number; w: number; h: number };
const TAU = Math.PI * 2;
const frac = (v: number) => v - Math.floor(v);
/** A repeating pulse: 0 most of the time, rising to 1 for `on` of every `period` seconds. */
const pulse = (t: number, period: number, on: number, phase: number) => { const p = frac(t / period + phase) * period; return p < on ? Math.sin((p / on) * Math.PI) : 0; };

let cone: HTMLCanvasElement | null = null, star: HTMLCanvasElement | null = null;
/** The hard hat lamp's beam, drawn once in the art's own space (as wide as the sprite). */
function coneSprite() {
  if (cone) return cone;
  cone = document.createElement("canvas"); cone.width = 230; cone.height = 218;
  const c = cone.getContext("2d")!, s = 230 / VB.w;
  c.scale(s, s); c.translate(-VB.x, -VB.y);
  const g = c.createLinearGradient(500, 286, 0, 260);
  g.addColorStop(0, "rgba(255,242,170,.9)"); g.addColorStop(0.5, "rgba(255,242,170,.25)"); g.addColorStop(1, "rgba(255,242,170,0)");
  c.fillStyle = g; c.beginPath(); c.moveTo(500, 278); c.lineTo(-80, 120); c.lineTo(-80, 400); c.lineTo(500, 294); c.closePath(); c.fill();
  return cone;
}
function starSprite() {
  if (star) return star;
  star = document.createElement("canvas"); star.width = star.height = 48;
  const c = star.getContext("2d")!, x = 24, y = 24, s = 23;
  const g = c.createRadialGradient(x, y, 0, x, y, s); g.addColorStop(0, "rgba(255,250,225,1)"); g.addColorStop(0.2, "rgba(255,240,200,.5)"); g.addColorStop(1, "rgba(255,240,200,0)");
  c.fillStyle = g; c.fillRect(0, 0, 48, 48);
  c.fillStyle = "rgba(255,252,235,1)";
  c.beginPath(); c.moveTo(x, y - s); c.quadraticCurveTo(x, y, x + s * 0.22, y); c.quadraticCurveTo(x, y, x, y + s); c.quadraticCurveTo(x, y, x - s * 0.22, y); c.quadraticCurveTo(x, y, x, y - s); c.fill();
  c.beginPath(); c.moveTo(x - s, y); c.quadraticCurveTo(x, y, x, y - s * 0.22); c.quadraticCurveTo(x, y, x + s, y); c.quadraticCurveTo(x, y, x, y + s * 0.22); c.quadraticCurveTo(x, y, x - s, y); c.fill();
  return star;
}
/** A four-pointed star of light (cached). */
export function sparkle(c: CanvasRenderingContext2D, x: number, y: number, s: number, k: number) {
  const ga = c.globalAlpha; c.globalAlpha = ga * k; c.drawImage(starSprite(), x - s, y - s, s * 2, s * 2); c.globalAlpha = ga;
}

/** Blinks: lids closing for a moment every few seconds (eyes that have lids). */
export function blink(c: CanvasRenderingContext2D, r: Rect, eyes: number, skin: string, t: number, ph: number) {
  if (eyes !== 0 && eyes !== 4 && eyes !== 5 && eyes !== 6 && eyes !== 7) return;
  const k = pulse(t, 4.2 + ph * 3, 0.16, ph);
  if (k <= 0) return;
  c.fillStyle = skin;
  for (const ex of [391, 601]) {
    if (eyes === 5 && ex === 601) continue; // the wink's right eye is shut already
    const [x, y] = at(r.x, r.y, r.w, r.h, ex, 392);
    const rx = (92 / 920) * r.w, ry = (85 / 870) * r.h * k;
    c.beginPath(); c.ellipse(x, y - (85 / 870) * r.h * (1 - k), rx, ry + 0.5, 0, 0, TAU); c.fill();
  }
}

/** The light a trait gives off: call with the composite mode already "lighter". `big`: close enough for the fine ones. */
export function fxLight(c: CanvasRenderingContext2D, r: Rect, tr: number[], t: number, ph: number, big: boolean) {
  const P = (ax: number, ay: number) => at(r.x, r.y, r.w, r.h, ax, ay);
  const u = r.w / 920;
  const eyes = tr[4]!, head = tr[5]!, acc = tr[6]!;
  if (eyes === 1) {
    // laser eyes: a burst every few seconds, the beams reaching past the frame
    const k = pulse(t, 5 + ph * 4, 0.7, ph);
    for (const ex of [427, 637]) {
      const [x0, y0] = P(ex, 428);
      glow(c, x0, y0, 60 * u, "#ff4a6e", 0.45 + 0.55 * k);
      if (k > 0) {
        const len = 900 * u * (0.4 + k), n = 274.96, x1 = x0 + (270 / n) * len, y1 = y0 + (52 / n) * len;
        c.lineCap = "round";
        c.strokeStyle = `rgba(255,44,105,${0.35 * k})`; c.lineWidth = 40 * u; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        c.strokeStyle = `rgba(255,140,160,${0.9 * k})`; c.lineWidth = 9 * u; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        glow(c, x1, y1, 40 * u, "#ffd0da", k);
      }
    }
  } else if (eyes === 6) {
    const k = 0.5 + 0.5 * Math.sin(t * 2.2 + ph * 6);
    for (const ex of [391, 601]) { const [x, y] = P(ex, 400); glow(c, x, y, 95 * u, "#b8ff4a", 0.35 + 0.35 * k); }
  } else if (eyes === 3) {
    const [x, y] = P(498, 406);
    glow(c, x, y, 230 * u, "#3fe6ff", 0.18 + 0.08 * Math.sin(t * 3 + ph * 7), 0.4);
  } else if ((eyes === 2 || eyes === 7) && big) {
    const k = pulse(t, 6 + ph * 3, 0.9, ph);
    if (k > 0) {
      const [x0, y0] = eyes === 2 ? P(284 + 424 * k, 360) : P(560 + 80 * k, 360);
      c.strokeStyle = `rgba(255,255,255,${0.7 * Math.sin(k * Math.PI)})`; c.lineWidth = 10 * u;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 - 40 * u, y0 + 110 * u); c.stroke();
    }
  }

  if (head === 0) {
    // the hard hat's lamp and its beam
    const [lx, ly] = P(500, 286), k = 0.75 + 0.25 * Math.sin(t * 3.1 + ph * 9);
    glow(c, lx, ly, 70 * u, "#fff6c8", 0.85 * k);
    if (big) { const ga = c.globalAlpha; c.globalAlpha = ga * 0.35 * k; c.drawImage(coneSprite(), r.x, r.y, r.w, r.h); c.globalAlpha = ga; }
  } else if (head === 3) {
    const tips: [number, number][] = [[302, 192], [446, 155], [559, 155], [702, 192], [500, 264]];
    for (let i = 0; i < tips.length; i++) { const k = pulse(t + i * 0.37, 2.6, 0.5, ph); if (k > 0) sparkle(c, ...P(tips[i]![0], tips[i]![1]), (40 + 30 * k) * u, k); }
  } else if (head === 6) {
    const [hx, hy] = P(500, 220), k = 0.6 + 0.4 * Math.sin(t * 1.4 + ph * 5);
    glow(c, hx, hy, 210 * u, "#d6c8ff", 0.5 * k, 0.28);
    c.strokeStyle = `rgba(255,255,255,${0.45 * k})`; c.lineWidth = 9 * u;
    c.beginPath(); c.ellipse(hx, hy, 190 * u, 37 * u, 0, 0, TAU); c.stroke();
  } else if (head === 5) {
    const k = 0.6 + 0.4 * Math.sin(t * 9 + ph * 20) * Math.sin(t * 2.3);
    for (const ex of [419, 582]) { const [x, y] = P(ex, 283); glow(c, x, y, 60 * u, "#95e63e", 0.55 * k); }
  } else if (head === 2) {
    const [mx, my] = P(652, 622), on = pulse(t, 3.2, 1.6, ph);
    glow(c, mx, my, 30 * u, "#3fe6ff", 0.3 + 0.7 * on);
    if (big && on > 0) for (let k = 1; k <= 3; k++) { c.strokeStyle = `rgba(63,230,255,${on * (0.6 - k * 0.15)})`; c.lineWidth = 6 * u; c.beginPath(); c.arc(mx + 20 * u, my, k * 34 * u, -0.6, 0.6); c.stroke(); }
  }

  if (acc === 4) {
    const [ex, ey] = P(766, 525), on = frac(t * 0.9 + ph) < 0.18 ? 1 : 0.15;
    glow(c, ex, ey, 38 * u, "#7c5cff", on); glow(c, ex, ey, 16 * u, "#3fe6ff", on);
  } else if (acc === 3) {
    const [bx, by] = P(728, 812), k = pulse(t, 2.8, 1.2, ph);
    glow(c, bx, by, 70 * u, "#b8ff4a", 0.15 + 0.5 * k);
  } else if (acc === 0 && big) {
    const k = pulse(t, 4.5, 0.6, ph);
    if (k > 0) sparkle(c, ...P(560, 834), 34 * u, k);
  }
}

/** The effects that are not light: the VR visor's readout, coffee steam. Normal composite mode. */
export function fxSolid(c: CanvasRenderingContext2D, r: Rect, tr: number[], t: number, ph: number, big: boolean) {
  const u = r.w / 920;
  if (tr[4] === 3 && big) {
    // the visor's readout scrolls (bars kept inside the glass without a clip)
    const [vx, vy] = at(r.x, r.y, r.w, r.h, 300, 366), [wx, wy] = at(r.x, r.y, r.w, r.h, 698, 448);
    const hgt = wy - vy, lh = hgt / 4, bh = Math.max(0.6, 7 * u);
    c.fillStyle = "rgba(181,255,255,.75)";
    for (let k = 0; k < 5; k++) {
      const y = vy + ((k * lh + t * lh * 1.6) % (hgt + lh)) - lh * 0.5;
      if (y < vy || y + bh > wy) continue;
      const len = (0.35 + frac(Math.sin((k + Math.floor((t * 1.6) / 4)) * 91.7 + ph * 13) * 43758) * 0.55) * (wx - vx - 12 * u);
      c.fillRect(vx + 6 * u, y, len, bh);
    }
  }
  if (tr[6] === 2) {
    // coffee steams
    for (let k = 0; k < 3; k++) {
      const p = frac(t / 2.4 + k / 3 + ph);
      const [sx0, sy0] = at(r.x, r.y, r.w, r.h, 690 + k * 22, 700);
      glow(c, sx0 + Math.sin(p * 6 + k + t) * 14 * u, sy0 - p * 170 * u, (26 + p * 30) * u, "#ece6fa", 0.42 * Math.sin(p * Math.PI));
    }
  }
}

/**
 * A Night Watcher's glow, after its card: the tier colour behind it, orbit rings (II and up, a second the other
 * way for a Night Boss, three for The Captain) with a node travelling round, embers rising from III.
 */
export function watcherBack(c: CanvasRenderingContext2D, r: Rect, tier: number, color: string, t: number, ph: number) {
  const cx = r.x + r.w / 2, cy = r.y + r.h * 0.5, k = 0.75 + 0.25 * Math.sin(t * 1.7 + ph * 4);
  const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
  glow(c, cx, cy, r.w * (0.8 + tier * 0.07), color, 0.42 * k);
  c.globalCompositeOperation = prev;
  orbits(c, r, tier, color, t, ph, true);
}
export function watcherFront(c: CanvasRenderingContext2D, r: Rect, tier: number, color: string, t: number, ph: number) {
  orbits(c, r, tier, color, t, ph, false);
  if (tier >= 3) {
    const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
    const n = 4 * Math.min(tier, 6) - 6;
    for (let k = 0; k < n; k++) {
      const p = frac(t / (3 + (k % 4)) + k * 0.137 + ph);
      const x = r.x + r.w * (k % 2 ? 0.92 - ((k * 37) % 30) / 100 : 0.08 + ((k * 37) % 30) / 100), y = r.y + r.h * (1 - p * 0.9);
      glow(c, x, y, r.w * (0.03 + (k % 3) * 0.012), color, 0.95 * Math.sin(p * Math.PI));
    }
    c.globalCompositeOperation = prev;
  }
  if (tier === 5) {
    // the Night Boss's floating crown (The Captain wears #1's look instead)
    const x = r.x + r.w / 2, y = r.y - r.h * 0.06 + Math.sin(t * 1.6 + ph) * r.h * 0.015, s = r.w * 0.16;
    c.fillStyle = color; c.strokeStyle = "#08070d"; c.lineWidth = Math.max(0.6, r.w * 0.01);
    c.beginPath(); c.moveTo(x - s, y + s * 0.5); c.lineTo(x - s, y - s * 0.2); c.lineTo(x - s * 0.5, y + s * 0.1); c.lineTo(x, y - s * 0.5); c.lineTo(x + s * 0.5, y + s * 0.1); c.lineTo(x + s, y - s * 0.2); c.lineTo(x + s, y + s * 0.5); c.closePath(); c.fill(); c.stroke();
  }
}
function orbits(c: CanvasRenderingContext2D, r: Rect, tier: number, color: string, t: number, ph: number, back: boolean) {
  const rings = tier === 6 ? 3 : tier >= 5 ? 2 : tier >= 2 ? 1 : 0;
  const cx = r.x + r.w / 2, cy = r.y + r.h * 0.56;
  for (let i = 0; i < rings; i++) {
    const rx = r.w * (0.6 + i * 0.08), ry = r.w * (0.16 + i * 0.03), tilt = i === 0 ? -0.18 : i === 1 ? 0.22 : 0.5;
    // the half behind the frog first, the front half after it
    const a0 = back ? Math.PI : 0, a1 = back ? TAU : Math.PI;
    c.strokeStyle = alpha(color, back ? 0.35 : 0.75); c.lineWidth = Math.max(0.6, r.w * 0.016);
    c.setLineDash([r.w * 0.03, r.w * 0.05]);
    c.beginPath(); c.ellipse(cx, cy, rx, ry, tilt, a0, a1); c.stroke();
    c.setLineDash([]);
    const a = ((t / (8 - tier * 0.6)) * TAU * (i % 2 ? -1 : 1) + ph * 7 + i * 2) % TAU, an = a < 0 ? a + TAU : a;
    if ((an < Math.PI) !== back) {
      const x = cx + rx * Math.cos(an) * Math.cos(tilt) - ry * Math.sin(an) * Math.sin(tilt), y = cy + rx * Math.cos(an) * Math.sin(tilt) + ry * Math.sin(an) * Math.cos(tilt);
      c.fillStyle = "#f2efff"; c.beginPath(); c.arc(x, y, Math.max(0.8, r.w * 0.025), 0, TAU); c.fill();
      const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
      glow(c, x, y, Math.max(2, r.w * 0.08), color, 0.8);
      c.globalCompositeOperation = prev;
    }
  }
}
