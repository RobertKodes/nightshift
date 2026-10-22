import { type Ctx, HZ, P, type V3, alpha, cylinder, disc, lin, line, poly, rad } from "./iso";
import { tube } from "./paint";
import type { SeatKind } from "./world";

/**
 * The furniture: what stands behind a character (a chair back, a capsule's far side) and in front of it (its
 * desk, console, bench), drawn round a seat at the origin, and the big set pieces. Seats face the camera, so a
 * desk's long side runs across the screen; a seat's pieces are cached as sprites per zoom level.
 */
const S2 = Math.SQRT1_2;
/** A box facing the camera: centred at (cx, cy), half-width along (1,-1), half-depth along (1,1). */
export function fbox(c: Ctx, cx: number, cy: number, z: number, hw: number, hd: number, h: number, top: string | CanvasGradient, front: string | CanvasGradient, edge?: string) {
  const ux = S2 * hw, uy = -S2 * hw, nx = S2 * hd, ny = S2 * hd;
  const A: V3 = [cx - ux + nx, cy - uy + ny, z], B: V3 = [cx + ux + nx, cy + uy + ny, z];
  const Bt: V3 = [B[0], B[1], z + h], At: V3 = [A[0], A[1], z + h];
  const Ct: V3 = [cx + ux - nx, cy + uy - ny, z + h], Dt: V3 = [cx - ux - nx, cy - uy - ny, z + h];
  poly(c, [A, B, Bt, At], front);
  poly(c, [At, Bt, Ct, Dt], top);
  if (edge) line(c, At, Bt, edge, 1);
}
/** A flat panel standing upright, facing the camera (a chair back, a screen). */
export function fpanel(c: Ctx, cx: number, cy: number, z: number, hw: number, h: number, fill: string | CanvasGradient, round = 0) {
  const [a, b] = P(cx, cy, z), w = hw * 45.25, hh = h * HZ;
  c.beginPath();
  if (round > 0) { const r = Math.min(round * 45.25, w); c.moveTo(a - w, b); c.lineTo(a - w, b - hh + r); c.quadraticCurveTo(a - w, b - hh, a - w + r, b - hh); c.lineTo(a + w - r, b - hh); c.quadraticCurveTo(a + w, b - hh, a + w, b - hh + r); c.lineTo(a + w, b); }
  else c.rect(a - w, b - hh, 2 * w, hh);
  c.closePath(); c.fillStyle = fill; c.fill();
}
/** In front of the frog along the camera axis: (d, d) in world units. */
const F = (d: number) => d * S2;

export type Piece = { draw: (c: Ctx) => void; box: [number, number, number, number] };
const B = (w: number, up: number, down: number): [number, number, number, number] => [-w, -up, w, down];

/** What a seat of each kind draws behind its character. Box: local screen px round the seat point. */
export const BACK: Partial<Record<SeatKind, Piece>> = {
  console: { box: B(34, 20, 16), draw: (c) => { disc(c, 0, 0, 0, 0.42, "rgba(0,0,0,.35)"); } },
  control: { box: B(34, 20, 16), draw: (c) => { disc(c, 0, 0, 0, 0.42, "rgba(0,0,0,.35)"); } },
  station: { box: B(34, 20, 16), draw: (c) => { disc(c, 0, 0, 0, 0.42, "rgba(0,0,0,.4)"); } },
  desk: { box: B(34, 30, 16), draw: (c) => { disc(c, 0, 0, 0, 0.42, "rgba(0,0,0,.35)"); fpanel(c, -F(0.22), -F(0.22), 0.28, 0.34, 0.78, lin(c, [0, -40], [0, 0], [[0, "#3a3168"], [1, "#1c1838"]]), 0.12); } },
  bar: { box: B(34, 20, 16), draw: (c) => { disc(c, 0, 0, 0, 0.4, "rgba(0,0,0,.35)"); } },
  table: { box: B(34, 20, 16), draw: (c) => { disc(c, 0, 0, 0, 0.4, "rgba(0,0,0,.35)"); } },
  anvil: { box: B(34, 20, 16), draw: (c) => { disc(c, 0, 0, 0, 0.42, "rgba(0,0,0,.4)"); } },
  bench: {
    box: B(36, 32, 16), draw: (c) => {
      disc(c, 0, 0, 0, 0.42, "rgba(0,0,0,.35)");
      fpanel(c, -F(0.18), -F(0.18), 0.22, 0.52, 0.62, lin(c, [0, -30], [0, 0], [[0, "#4a1a3a"], [1, "#22101c"]]), 0.1);
      fpanel(c, -F(0.18), -F(0.18), 0.8, 0.5, 0.04, "rgba(255,92,168,.7)", 0);
    },
  },
  officer: {
    box: B(38, 46, 16), draw: (c) => {
      disc(c, 0, 0, 0, 0.5, "rgba(0,0,0,.35)");
      fpanel(c, -F(0.2), -F(0.2), 0.18, 0.5, 1.18, lin(c, [0, -46], [0, 0], [[0, "#5a2c3e"], [1, "#2a1420"]]), 0.22);
      fpanel(c, -F(0.2), -F(0.2), 1.25, 0.42, 0.06, "rgba(255,196,107,.5)", 0);
    },
  },
  watch: {
    box: B(40, 50, 18), draw: (c) => {
      disc(c, 0, 0, 0, 0.5, "rgba(0,0,0,.35)");
      // a tall, slim seat back of dark glass with a lit edge
      fpanel(c, -F(0.2), -F(0.2), 0.18, 0.4, 1.32, lin(c, [0, -46], [0, 0], [[0, "rgba(40,54,110,.92)"], [1, "rgba(12,14,36,.95)"]]), 0.26);
      const [a, b] = P(-F(0.2), -F(0.2), 0.18);
      c.strokeStyle = "rgba(74,216,255,.55)"; c.lineWidth = 1; c.beginPath(); c.moveTo(a - 18, b); c.lineTo(a - 18, b - 34); c.quadraticCurveTo(a - 18, b - 42, a - 10, b - 42); c.lineTo(a + 10, b - 42); c.quadraticCurveTo(a + 18, b - 42, a + 18, b - 34); c.lineTo(a + 18, b); c.stroke();
      c.fillStyle = "rgba(74,216,255,.3)"; c.fillRect(a - 12, b - 38, 24, 1.2);
    },
  },
  throne: {
    box: B(64, 100, 24), draw: (c) => {
      disc(c, 0, 0, 0, 0.8, "rgba(0,0,0,.4)");
      const [a, b] = P(-F(0.3), -F(0.3), 0.2);
      c.fillStyle = lin(c, [a, b - 96], [a, b], [[0, "#f4f0ff"], [0.3, "#8a84c8"], [0.7, "#2a2658"], [1, "#151330"]]);
      c.beginPath();
      c.moveTo(a - 34, b); c.lineTo(a - 34, b - 62); c.lineTo(a - 24, b - 84); c.lineTo(a - 12, b - 72); c.lineTo(a, b - 96); c.lineTo(a + 12, b - 72); c.lineTo(a + 24, b - 84); c.lineTo(a + 34, b - 62); c.lineTo(a + 34, b);
      c.closePath(); c.fill();
      c.strokeStyle = "rgba(233,228,255,.85)"; c.lineWidth = 1.4; c.stroke();
      c.fillStyle = "#08070d"; c.beginPath(); c.moveTo(a - 22, b); c.lineTo(a - 22, b - 56); c.lineTo(a + 22, b - 56); c.lineTo(a + 22, b); c.fill();
      c.fillStyle = "#e9e4ff"; c.beginPath(); c.arc(a, b - 80, 3, 0, Math.PI * 2); c.fill();
    },
  },
  plinth: {
    box: B(36, 40, 22), draw: (c) => {
      disc(c, 0, 0, 0, 0.75, "rgba(0,0,0,.45)");
      cylinder(c, 0, 0, 0, 0.62, 0.42, lin(c, [-28, 0], [28, 0], [[0, "#3a2a10"], [0.5, "#ffc46b"], [1, "#3a2a10"]]), "#2a1e12", "rgba(255,196,107,.9)");
      disc(c, 0, 0, 0.42, 0.48, null, "rgba(255,196,107,.5)", 1);
    },
  },
  pod: {
    box: B(36, 58, 22), draw: (c) => {
      disc(c, 0, 0, 0, 0.62, "rgba(0,0,0,.4)");
      cylinder(c, 0, 0, 0, 0.6, 0.18, "#1b2a22", "#24382c", "rgba(184,255,74,.8)");
      // the far half of the capsule
      const [a, b] = P(0, 0, 0.18);
      c.fillStyle = "rgba(20,40,36,.75)"; c.beginPath(); c.ellipse(a, b - 26, 26, 40, 0, Math.PI, 0); c.lineTo(a + 26, b); c.lineTo(a - 26, b); c.closePath(); c.fill();
    },
  },
};

/**
 * A console in front of a seated character: its top's back edge sits at the character's chest, so the body is
 * hidden behind it and the head and shoulders show above, lit by the screen.
 */
function desk(c: Ctx, o: { hw?: number; h?: number; d?: number; hd?: number; body: [string, string]; top: [string, string]; edge: string; screen?: string; strip?: string }) {
  const hw = o.hw ?? 0.6, h = o.h ?? 0.5, d = o.d ?? 0.22, hd = o.hd ?? 0.18;
  fbox(c, F(d), F(d), 0, hw, hd, h, lin(c, [0, -20], [0, 4], [[0, o.top[0]], [1, o.top[1]]]), lin(c, [0, -6], [0, 12], [[0, o.body[0]], [1, o.body[1]]]), o.edge);
  const [fx, fy] = P(F(d + hd), F(d + hd), 0);
  if (o.strip) { c.fillStyle = o.strip; c.fillRect(fx - hw * 45.25 + 3, fy - 3.2, hw * 90.5 - 6, 1.2); }
  // the top's back edge, a hair of light
  const [bx, by] = P(F(d - hd), F(d - hd), h);
  c.fillStyle = "rgba(255,255,255,.07)"; c.fillRect(bx - hw * 45.25, by, hw * 90.5, 1);
  if (o.screen) {
    // a screen set into the top, its glow toward the character
    const [sx, sy] = P(F(d), F(d), h);
    c.fillStyle = "#05040c"; c.fillRect(sx - 15, sy - 2.6, 30, 4.6);
    c.fillStyle = o.screen; c.fillRect(sx - 14, sy - 2.0, 28, 3.4);
    c.fillStyle = "rgba(255,255,255,.55)"; c.fillRect(sx - 12, sy - 1.4, 9, 0.8); c.fillRect(sx - 1, sy - 1.4, 5, 0.8);
  }
  return { fx, fy };
}

/** What a seat draws in front of its character. */
export const FRONT: Partial<Record<SeatKind, Piece>> = {
  console: { box: B(36, 24, 18), draw: (c) => { desk(c, { body: ["#1a2442", "#0a0f22"], top: ["#1e3458", "#122340"], edge: "rgba(74,216,255,.95)", screen: "rgba(74,216,255,.85)", strip: "rgba(74,216,255,.6)" }); } },
  control: { box: B(36, 24, 18), draw: (c) => { const { fx, fy } = desk(c, { body: ["#1a2a20", "#0a120c"], top: ["#1e3a26", "#10241a"], edge: "rgba(184,255,74,.95)", screen: "rgba(184,255,74,.8)", strip: "rgba(184,255,74,.55)" }); c.fillStyle = "rgba(255,200,60,.9)"; c.fillRect(fx + 14, fy - 10, 3, 3); } },
  station: {
    box: B(38, 24, 18), draw: (c) => {
      const { fx, fy } = desk(c, { hw: 0.62, body: ["#2c2638", "#120f1c"], top: ["#3a3040", "#221c2a"], edge: "rgba(255,181,71,.95)", screen: "rgba(255,181,71,.8)" });
      // two gauges on the front
      for (const gx of [-12, 2]) { c.fillStyle = "#07060c"; c.beginPath(); c.arc(fx + gx, fy - 8, 3.4, 0, Math.PI * 2); c.fill(); c.strokeStyle = "rgba(255,181,71,.85)"; c.lineWidth = 0.9; c.beginPath(); c.arc(fx + gx, fy - 8, 3.4, Math.PI * 0.8, Math.PI * 2.2); c.stroke(); c.beginPath(); c.moveTo(fx + gx, fy - 8); c.lineTo(fx + gx + 2.2, fy - 10); c.stroke(); }
      c.fillStyle = "rgba(63,230,255,.8)"; c.fillRect(fx + 10, fy - 9.5, 8, 2.4);
    },
  },
  desk: {
    box: B(40, 40, 18), draw: (c) => {
      desk(c, { hw: 0.64, h: 0.46, body: ["#2a2250", "#120e26"], top: ["#4a3c7a", "#2e2656"], edge: "rgba(169,139,255,.8)" });
      // a monitor standing at the right of the desk
      const [mx, my] = P(F(0.2) + S2 * 0.4, F(0.2) - S2 * 0.4, 0.46);
      c.fillStyle = "#0a0914"; c.fillRect(mx - 1, my - 3, 2, 3);
      c.fillStyle = "#0a0914"; c.fillRect(mx - 9, my - 18, 18, 14);
      c.fillStyle = lin(c, [mx, my - 17], [mx, my - 5], [[0, "rgba(169,139,255,.9)"], [1, "rgba(90,60,200,.7)"]]); c.fillRect(mx - 8, my - 17, 16, 12);
      c.fillStyle = "rgba(255,255,255,.6)"; c.fillRect(mx - 6, my - 15, 8, 1); c.fillRect(mx - 6, my - 12.5, 11, 1); c.fillRect(mx - 6, my - 10, 6, 1);
      // a mug and a sheet of paper
      const [px, py] = P(F(0.22), F(0.22), 0.46);
      c.fillStyle = "rgba(233,228,255,.7)"; c.fillRect(px - 20, py - 1, 9, 2.4);
      c.fillStyle = "#c4b4ff"; c.fillRect(px - 6, py - 5, 4, 4.5);
    },
  },
  bar: {
    box: B(40, 30, 20), draw: (c) => {
      const { fx, fy } = desk(c, { hw: 0.66, h: 0.58, d: 0.24, body: ["#36142c", "#160810"], top: ["#5a2044", "#3a1430"], edge: "rgba(255,92,168,1)", strip: "rgba(255,92,168,.8)" });
      const [a, b] = P(F(0.24), F(0.24), 0.58);
      c.fillStyle = "#e8e0f4"; c.fillRect(a + 6, b - 7, 6, 6.5); c.fillStyle = "#3a231f"; c.fillRect(a + 7, b - 7, 4, 1.4);
      c.strokeStyle = "rgba(232,224,244,.9)"; c.lineWidth = 1; c.beginPath(); c.arc(a + 13, b - 4, 2, -1.2, 1.2); c.stroke();
      c.fillStyle = "rgba(255,92,168,.35)"; c.fillRect(fx - 26, fy - 12, 52, 1);
    },
  },
  table: {
    box: B(40, 26, 22), draw: (c) => {
      desk(c, { hw: 0.64, h: 0.42, d: 0.3, hd: 0.28, body: ["#241a38", "#0f0a1a"], top: ["#3a2e56", "#2a2040"], edge: "rgba(255,255,255,.22)" });
      const [a, b] = P(F(0.3), F(0.3), 0.42);
      c.fillStyle = "#d8d0ea"; c.beginPath(); c.ellipse(a - 8, b - 1, 7, 3, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#ffb547"; c.beginPath(); c.ellipse(a - 8, b - 1.4, 4, 1.6, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#c4b4ff"; c.fillRect(a + 6, b - 7, 5, 6);
    },
  },
  anvil: {
    box: B(38, 26, 18), draw: (c) => {
      const { fx, fy } = desk(c, { hw: 0.56, h: 0.5, body: ["#2e1c1a", "#120a0a"], top: ["#463030", "#2a1c1c"], edge: "rgba(255,122,61,.9)" });
      const [a, b] = P(F(0.22), F(0.22), 0.5);
      c.fillStyle = lin(c, [a - 13, 0], [a + 13, 0], [[0, "#ff3a10"], [0.5, "#ffe08a"], [1, "#ff3a10"]]); c.fillRect(a - 13, b - 2.6, 26, 3.4);
      for (const rx of [-20, 20]) { c.fillStyle = "rgba(255,255,255,.18)"; c.beginPath(); c.arc(fx + rx, fy - 8, 1.2, 0, Math.PI * 2); c.fill(); }
    },
  },
  officer: {
    box: B(40, 22, 20), draw: (c) => {
      for (const s of [-1, 1]) { const [a, b] = P(F(0.12) + s * S2 * 0.5, F(0.12) - s * S2 * 0.5, 0); c.fillStyle = lin(c, [0, b - 16], [0, b], [[0, "#5a2c3e"], [1, "#2a1420"]]); c.fillRect(a - 4.5, b - 16, 9, 16); c.fillStyle = "rgba(255,196,107,.75)"; c.fillRect(a - 4.5, b - 16, 9, 1.4); }
    },
  },
  watch: {
    box: B(40, 22, 20), draw: (c) => {
      for (const s of [-1, 1]) { const [a, b] = P(F(0.1) + s * S2 * 0.48, F(0.1) - s * S2 * 0.48, 0); c.fillStyle = "#141838"; c.fillRect(a - 3.5, b - 14, 7, 14); c.fillStyle = "rgba(74,216,255,.8)"; c.fillRect(a - 3.5, b - 14, 7, 1.3); }
    },
  },
  pod: {
    box: B(36, 62, 20), draw: (c) => {
      const [a, b] = P(0, 0, 0.18);
      c.fillStyle = lin(c, [a - 26, b - 60], [a + 26, b], [[0, "rgba(184,255,74,.16)"], [0.5, "rgba(120,220,200,.06)"], [1, "rgba(184,255,74,.14)"]]);
      c.beginPath(); c.ellipse(a, b - 26, 26, 40, 0, Math.PI, 0); c.lineTo(a + 26, b); c.lineTo(a - 26, b); c.closePath(); c.fill();
      c.strokeStyle = "rgba(184,255,74,.55)"; c.lineWidth = 1.2; c.stroke();
      c.strokeStyle = "rgba(255,255,255,.35)"; c.lineWidth = 2; c.beginPath(); c.ellipse(a, b - 26, 20, 34, 0, Math.PI * 1.15, Math.PI * 1.45); c.stroke();
    },
  },
};
/** The colour of the light a seat's screen throws on its character's face. */
export const SPILL: Partial<Record<SeatKind, string>> = { console: "#4ad8ff", control: "#b8ff4a", station: "#ffb547", desk: "#a98bff", anvil: "#ff7a3d", bar: "#ff5ca8" };

// ------------------------------------------------------------------ the set pieces
export type Prop = { x: number; y: number; z: number; depth: number; box: [number, number, number, number]; draw: (c: Ctx) => void; key: string };

/** The radar table's pedestal (its hologram is drawn live). */
export function radarTable(c: Ctx, x: number, y: number, z: number, r: number) {
  disc(c, x, y, z, r + 0.35, "rgba(0,0,0,.45)");
  cylinder(c, x, y, z, r, 0.5, lin(c, P(x - r, y + r, z), P(x + r, y - r, z), [[0, "#0e1a30"], [0.5, "#24406a"], [1, "#0e1a30"]]), "#0b1424", "rgba(74,216,255,.9)");
  disc(c, x, y, z + 0.5, r * 0.92, null, "rgba(74,216,255,.35)", 1);
  disc(c, x, y, z + 0.5, r * 0.3, "#102a44", "rgba(74,216,255,.6)", 1);
}

/** The reactor: a ribbed base, a tall glass chamber (its plasma is drawn live), a crown housing. */
export function reactor(c: Ctx, x: number, y: number, r: number) {
  disc(c, x, y, 0, r + 0.5, "rgba(0,0,0,.45)");
  cylinder(c, x, y, 0, r, 0.45, lin(c, P(x - r, y + r, 0), P(x + r, y - r, 0), [[0, "#141020"], [0.5, "#3a3050"], [1, "#141020"]]), "#241e36", "rgba(255,181,71,.9)");
  cylinder(c, x, y, 0.45, r * 0.82, 1.0, lin(c, P(x - r, y + r, 1), P(x + r, y - r, 1), [[0, "#100e1c"], [0.4, "#4a4270"], [0.7, "#2a2448"], [1, "#0c0a18"]]), "#1e1a30", "rgba(255,181,71,.5)");
  // the glass chamber: dark, see-through
  cylinder(c, x, y, 1.45, r * 0.6, 2.9, "rgba(10,24,40,.72)", "rgba(20,40,60,.6)");
  // struts round the glass
  for (const a of [0.5, 1.3, 2.1, 2.9]) {
    const sx2 = x + r * 0.62 * Math.cos(a + Math.PI / 4), sy2 = y + r * 0.62 * Math.sin(a + Math.PI / 4);
    const [p, q] = P(sx2, sy2, 1.45), [, q2] = P(sx2, sy2, 4.35);
    c.fillStyle = lin(c, [p - 4, 0], [p + 4, 0], [[0, "#2a2448"], [0.5, "#6a62a8"], [1, "#1a1630"]]); c.fillRect(p - 3.5, q2, 7, q - q2);
  }
  cylinder(c, x, y, 4.35, r * 0.82, 0.7, lin(c, P(x - r, y + r, 4.6), P(x + r, y - r, 4.6), [[0, "#100e1c"], [0.4, "#4a4270"], [0.7, "#2a2448"], [1, "#0c0a18"]]), "#2a2442", "rgba(255,181,71,.65)");
  cylinder(c, x, y, 5.05, r * 0.42, 0.4, "#2a2442", "#3a3466", "rgba(63,230,255,.6)");
  for (const zz of [0.75, 1.15, 4.6, 4.85]) { const [p, q] = P(x, y, zz); c.strokeStyle = "rgba(255,181,71,.45)"; c.lineWidth = 1.4; c.beginPath(); c.ellipse(p, q, r * 0.83 * 45.25, r * 0.83 * 22.63, 0, 0.08, Math.PI - 0.08); c.stroke(); }
}

/** The forge: a stone furnace under an iron hood, its mouth to the camera (the fire is drawn live), an anvil before it. */
export function furnace(c: Ctx, x: number, y: number) {
  disc(c, x, y, 0, 3.0, "rgba(0,0,0,.5)");
  fbox(c, x, y, 0, 1.9, 1.3, 2.4, lin(c, [0, -90], [0, 0], [[0, "#40302e"], [1, "#2a1c1c"]]), lin(c, P(x, y, 2.4), P(x, y, 0), [[0, "#3e2826"], [1, "#160c0c"]]), "rgba(255,122,61,.85)");
  // stone courses
  for (let k = 1; k < 8; k++) { const [a, b] = P(x + 0.92, y + 0.92, k * 0.3); c.strokeStyle = "rgba(0,0,0,.4)"; c.lineWidth = 1; c.beginPath(); c.moveTo(a - 84, b); c.lineTo(a + 84, b); c.stroke(); for (let j = -3; j <= 3; j++) { c.beginPath(); c.moveTo(a + j * 24 + (k % 2) * 12, b); c.lineTo(a + j * 24 + (k % 2) * 12, b + 9.6); c.stroke(); } }
  // the hood and chimney
  const [hx, hy] = P(x, y, 2.4);
  c.fillStyle = lin(c, [hx - 70, 0], [hx + 70, 0], [[0, "#1e1414"], [0.5, "#4a3232"], [1, "#1a1010"]]);
  c.beginPath(); c.moveTo(hx - 76, hy + 16); c.lineTo(hx - 30, hy - 40); c.lineTo(hx + 30, hy - 40); c.lineTo(hx + 76, hy + 16); c.closePath(); c.fill();
  c.strokeStyle = "rgba(255,122,61,.55)"; c.lineWidth = 1.2; c.stroke();
  c.fillStyle = lin(c, [hx - 18, 0], [hx + 18, 0], [[0, "#1e1414"], [0.5, "#4a3030"], [1, "#160e0e"]]); c.fillRect(hx - 18, hy - 120, 36, 82);
  c.fillStyle = "#0c0606"; c.beginPath(); c.ellipse(hx, hy - 120, 18, 7, 0, 0, Math.PI * 2); c.fill();
  for (const yy of [-100, -70]) { c.fillStyle = "rgba(255,122,61,.4)"; c.fillRect(hx - 18, hy + yy, 36, 2); }
  // the mouth: an arch (the fire is drawn live over it)
  const [m, n] = P(x + 1.0, y + 1.0, 0.25);
  c.fillStyle = "#1a0604"; c.beginPath(); c.moveTo(m - 38, n); c.lineTo(m - 38, n - 30); c.quadraticCurveTo(m, n - 62, m + 38, n - 30); c.lineTo(m + 38, n); c.closePath(); c.fill();
  c.strokeStyle = "#5a3a30"; c.lineWidth = 4; c.stroke();
  // a molten channel to the front and the great anvil
  poly(c, [[x + 1.3, y + 1.3, 0.01], [x + 2.6, y + 2.6, 0.01], [x + 2.75, y + 2.45, 0.01], [x + 1.45, y + 1.15, 0.01]], "#ff6a1a");
  fbox(c, x + 2.3, y + 2.3, 0, 0.75, 0.32, 0.45, "#4a4450", "#22202a", "rgba(255,255,255,.25)");
  const [ax, ay] = P(x + 2.3, y + 2.3, 0.45);
  c.fillStyle = "#2a2830"; c.beginPath(); c.moveTo(ax - 30, ay - 2); c.lineTo(ax + 26, ay - 2); c.quadraticCurveTo(ax + 40, ay - 4, ax + 36, ay - 10); c.lineTo(ax - 30, ay - 10); c.closePath(); c.fill();
  c.fillStyle = "rgba(255,255,255,.25)"; c.fillRect(ax - 30, ay - 10, 60, 1.2);
}

/** A drive coil: a tall magnetic column with rings (lit live) feeding an engine. */
export function driveCoil(c: Ctx, x: number, y: number) {
  disc(c, x, y, 0, 1.7, "rgba(0,0,0,.45)");
  cylinder(c, x, y, 0, 1.45, 0.4, "#1c1838", "#2a2450", "rgba(139,108,255,.9)");
  cylinder(c, x, y, 0.4, 0.75, 3.6, lin(c, P(x - 1, y + 1, 2), P(x + 1, y - 1, 2), [[0, "#141230"], [0.45, "#5a54a8"], [0.6, "#2c2858"], [1, "#0e0c20"]]), "#3a3672");
  for (let k = 0; k < 5; k++) cylinder(c, x, y, 0.75 + k * 0.62, 1.05, 0.16, lin(c, P(x - 1, y + 1, 1), P(x + 1, y - 1, 1), [[0, "#24204a"], [0.5, "#7a72d0"], [1, "#1a1838"]]), "#3a3672");
  cylinder(c, x, y, 4.0, 0.95, 0.3, "#2a2656", "#4a4590", "rgba(139,108,255,.8)");
}

/** A small holo projector on a pedestal (the bridge's side displays). */
export function holoPedestal(c: Ctx, col: string) {
  disc(c, 0, 0, 0, 0.75, "rgba(0,0,0,.4)");
  cylinder(c, 0, 0, 0, 0.6, 0.55, lin(c, P(-0.6, 0.6, 0), P(0.6, -0.6, 0), [[0, "#0e1a30"], [0.5, "#2a4470"], [1, "#0e1a30"]]), "#0b1424", col);
  disc(c, 0, 0, 0.55, 0.32, col, undefined);
}

/** The coffee machine at the breakroom wall. */
export function coffee(c: Ctx, x: number, y: number) {
  fbox(c, x, y, 0, 0.6, 0.35, 1.7, "#2a1428", lin(c, P(x, y, 1.7), P(x, y, 0), [[0, "#3a1a32"], [1, "#160a14"]]), "rgba(255,92,168,.9)");
  const [a, b] = P(x + 0.25, y + 0.25, 1.0);
  c.fillStyle = "#0a0610"; c.fillRect(a - 14, b - 18, 28, 20);
  c.fillStyle = "rgba(255,92,168,.8)"; c.fillRect(a - 10, b - 30, 20, 4);
  c.fillStyle = "#e8e0f4"; c.fillRect(a - 4, b - 6, 8, 7);
}

/** A ring of light on the floor (a pad, a seat marker). */
export function padRing(c: Ctx, x: number, y: number, z: number, r: number, col: string) {
  disc(c, x, y, z, r, alpha(col, 0.08), alpha(col, 0.6), 1.2);
}
void rad;
