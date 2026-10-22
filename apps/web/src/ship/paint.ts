import { type Ctx, HX, HY, HZ, P, type V3, alpha, box, disc, lin, line, mix, path, plane, poly, pool, rad, rng } from "./iso";
import { CHAMFER, FURNACE, L, RADAR, REACTOR, ROOMS, type Room, W, WALL, room } from "./world";

/**
 * The parts of the ship that never move, drawn once into the tile cache: the hull and wings, every floor, the
 * tall port and bow walls with their windows (left open: the stars show through), the low partitions and the
 * rims. Each piece knows its screen box so a tile only draws the pieces it touches.
 */
export type Piece = { box: [number, number, number, number]; draw: (c: Ctx) => void };

export const METAL = { top: "#2c2858", left: "#141230", right: "#1d1a40", edge: "#4a4590", seam: "#0a0918", hi: "#6a64c0" } as const;

/** The screen box of a world box (x, y, z ranges), padded. */
export function bbox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, pad = 8): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) { const [u, v] = P(x, y, z); a = Math.min(a, u); b = Math.min(b, v); c = Math.max(c, u); d = Math.max(d, v); }
  return [a - pad, b - pad, c + pad, d + pad];
}

// ------------------------------------------------------------------ cylinders lying along y (engines, drive cores)
function hull2(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}
export function ring(cx: number, y: number, cz: number, r: number, n = 40): [number, number][] {
  return Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2; return P(cx + r * Math.cos(a), y, cz + r * Math.sin(a)); });
}
const fillPts = (c: Ctx, pts: [number, number][], fill: string | CanvasGradient) => { c.beginPath(); pts.forEach(([a, b], i) => (i ? c.lineTo(a, b) : c.moveTo(a, b))); c.closePath(); c.fillStyle = fill; c.fill(); };
/** A cylinder along y from y0 to y1 (its y1 end faces the camera). */
export function tube(c: Ctx, cx: number, cz: number, r: number, y0: number, y1: number, body: [string, string, string], cap?: string) {
  const pts = hull2([...ring(cx, y0, cz, r), ...ring(cx, y1, cz, r)]);
  // shaded across the tube: lit from above
  const [ax, ay] = P(cx, (y0 + y1) / 2, cz + r), [bx, by] = P(cx, (y0 + y1) / 2, cz - r);
  fillPts(c, pts, lin(c, [ax, ay], [bx, by], [[0, body[0]], [0.45, body[1]], [1, body[2]]]));
  if (cap) fillPts(c, ring(cx, y1, cz, r), cap);
}

// ------------------------------------------------------------------ the pieces
const pieces: Piece[] = [];
const piece = (b: [number, number, number, number], draw: (c: Ctx) => void) => pieces.push({ box: b, draw });

/** Panel seams and rivets on a hull face lying in a wall plane. */
function plating(c: Ctx, len: number, h: number, step: number, seed: number) {
  const r = rng(seed);
  c.lineWidth = 0.035;
  c.strokeStyle = "rgba(4,3,12,.55)";
  for (let u = step; u < len; u += step * (0.7 + r() * 0.6)) { c.beginPath(); c.moveTo(u, 0); c.lineTo(u, h); c.stroke(); }
  for (const v of [h * 0.33, h * 0.7]) { c.beginPath(); c.moveTo(0, v); c.lineTo(len, v); c.stroke(); }
  c.strokeStyle = "rgba(140,130,255,.08)";
  for (const v of [h * 0.33 + 0.05, h * 0.7 + 0.05]) { c.beginPath(); c.moveTo(0, v); c.lineTo(len, v); c.stroke(); }
}

// ---- the port wing and the mast, behind the port wall
{
  const z = -0.7, t = 0.35;
  const wing: V3[] = [[0, 40, z], [-11, 56, z], [-11, 61, z], [-2, 70, z], [0, 70, z]];
  piece(bbox(-12, 38, z - 1, 0, 72, z + t + 1), (c) => {
    poly(c, wing.map(([x, y]) => [x, y, z] as V3), METAL.left);
    poly(c, wing.map(([x, y]) => [x, y, z + t] as V3), lin(c, P(0, 55, z), P(-11, 58, z), [[0, "#262250"], [1, "#1a1738"]]));
    // trailing edge, seen from behind: a lit strip
    poly(c, [[-11, 61, z], [-2, 70, z], [-2, 70, z + t], [-11, 61, z + t]], "#100e26");
    line(c, [-11, 56, z + t], [-11, 61, z + t], "#ff5c7a", 1.6);
    for (let k = 1; k < 5; k++) line(c, [0, 42 + k * 5.5, z + t], [-9 + k * 0.4, 56.5 + k * 0.6, z + t], "rgba(10,8,24,.7)", 1);
    line(c, [0, 40, z + t], [-11, 56, z + t], "rgba(170,160,255,.35)", 1.2);
  });
  // the comms mast at the port-bow corner, with its dish
  piece(bbox(-3, -3, 0, 1, 1, 9.5), (c) => {
    const [mx, my] = P(-1.2, -1.2, WALL);
    const [tx, ty] = P(-1.2, -1.2, 9);
    c.strokeStyle = "#2c2858"; c.lineWidth = 5; c.beginPath(); c.moveTo(mx, my); c.lineTo(tx, ty); c.stroke();
    c.strokeStyle = "#4a4590"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(mx - 2, my); c.lineTo(tx - 2, ty); c.stroke();
    for (let k = 0; k < 5; k++) { const [a, b] = P(-1.2, -1.2, WALL + 0.8 + k * 0.95); c.strokeStyle = "#3a3670"; c.lineWidth = 1.4; c.beginPath(); c.moveTo(a - 10, b + 3); c.lineTo(a + 10, b - 3); c.stroke(); }
    const [dx, dy] = P(-1.2, -1.2, 7.2);
    c.save(); c.translate(dx, dy); c.rotate(-0.5);
    c.fillStyle = lin(c, [-26, 0], [26, 0], [[0, "#3c3878"], [0.5, "#8c86d8"], [1, "#2a2656"]]);
    c.beginPath(); c.ellipse(0, 0, 26, 11, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#1a1838"; c.beginPath(); c.ellipse(2, 1, 18, 6.5, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#b8b2ff"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(2, 1); c.lineTo(-6, -14); c.stroke();
    c.restore();
  });
}

// ---- floors
function floorOf(r: Room): V3[] {
  const z = r.z;
  if (r.key === "bridge") return [[0, CHAMFER, z], [CHAMFER, 0, z], [W - CHAMFER, 0, z], [W, CHAMFER, z], [W, r.y1, z], [0, r.y1, z]];
  return [[r.x0, r.y0, z], [r.x1, r.y0, z], [r.x1, r.y1, z], [r.x0, r.y1, z]];
}
for (const r of ROOMS) {
  piece(bbox(r.x0, r.y0, r.z - 0.1, r.x1, r.y1, r.z + 0.1, 4), (c) => {
    const pts = floorOf(r), z = r.z;
    poly(c, pts, r.floor);
    c.save(); path(c, pts); c.clip();
    // the room's pattern, then the grid of floor tiles
    pattern(c, r);
    c.lineWidth = 0.8; c.strokeStyle = "rgba(190,180,255,.055)";
    for (let x = Math.ceil(r.x0); x < r.x1; x++) line(c, [x, r.y0, z], [x, r.y1, z], "rgba(190,180,255,.05)", 0.8);
    for (let y = Math.ceil(r.y0); y < r.y1; y++) line(c, [r.x0, y, z], [r.x1, y, z], "rgba(190,180,255,.05)", 0.8);
    // the room's light, and shade where the floor meets the back walls
    pool(c, r.label[0], r.label[1], z, Math.max(r.x1 - r.x0, r.y1 - r.y0) * 0.55, r.accent, 0.1);
    if (r.x0 === 0) poly(c, [[0, r.y0, z], [1.6, r.y0, z], [1.6, r.y1, z], [0, r.y1, z]], lin(c, P(0, (r.y0 + r.y1) / 2, z), P(1.6, (r.y0 + r.y1) / 2, z), [[0, "rgba(0,0,0,.55)"], [1, "rgba(0,0,0,0)"]]));
    c.restore();
  });
}

function pattern(c: Ctx, r: Room) {
  const z = r.z;
  if (r.key === "missions") plane(c, "floor", [16, 36, z], () => { c.save(); c.translate(14.0, 9.2); c.rotate(-Math.PI / 2); neon(c, "MISSION BAY · LAUNCH LANE", 0, 0, 0.62, "rgba(184,255,74,.55)"); c.restore(); });
  if (r.key === "offices") plane(c, "floor", [15, 20, z], () => { c.save(); c.translate(15.6, 8); c.rotate(-Math.PI / 2); neon(c, "COMPANY OFFICES", 0, 0, 0.6, "rgba(169,139,255,.5)"); c.restore(); });
  if (r.key === "engine") for (const x of [2.85, 4.95, 7.05, 9.25, 22.75, 24.95, 27.05, 29.15]) for (let y = 55.4; y < 75; y += 1.32) disc(c, x, y, z, 0.07, "rgba(255,181,71,.55)");
  if (r.key === "bridge") for (let k = 0; k < 36; k++) { const a = (k / 36) * Math.PI * 2; disc(c, RADAR.x + 8.4 * Math.cos(a), RADAR.y + 8.4 * Math.sin(a), z, 0.06, "rgba(74,216,255,.6)"); }
  if (r.key === "bridge") {
    // the radar's floor: concentric inlays and guide lines toward the windows
    for (const [rr, a] of [[3.2, 0.5], [4.85, 0.22], [6.35, 0.22], [7.85, 0.18], [9.2, 0.1]] as const) disc(c, RADAR.x, RADAR.y, z, rr, null, alpha("#4ad8ff", a), 1.4);
    disc(c, RADAR.x, RADAR.y, z, 3.2, alpha("#4ad8ff", 0.06));
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; line(c, [RADAR.x + 3.2 * Math.cos(a), RADAR.y + 3.2 * Math.sin(a), z], [RADAR.x + 9.2 * Math.cos(a), RADAR.y + 9.2 * Math.sin(a), z], "rgba(74,216,255,.07)", 1); }
    // the Captain's dais
    disc(c, 8.6, 4.2, z, 1.6, "rgba(233,228,255,.06)", "rgba(233,228,255,.35)", 1.2);
  } else if (r.key === "quarters") {
    // the wardroom rug
    poly(c, [[5.4, 20.8, z], [11.2, 20.8, z], [11.2, 33.2, z], [5.4, 33.2, z]], "#2a1528");
    poly(c, [[5.7, 21.1, z], [10.9, 21.1, z], [10.9, 32.9, z], [5.7, 32.9, z]], null, "rgba(255,196,107,.55)", 1.4);
    poly(c, [[6.0, 21.4, z], [10.6, 21.4, z], [10.6, 32.6, z], [6.0, 32.6, z]], null, "rgba(255,196,107,.22)", 1);
    for (let y = 22.5; y < 32.5; y += 2) poly(c, [[8.3, y - 0.6, z], [8.9, y, z], [8.3, y + 0.6, z], [7.7, y, z]], "rgba(255,196,107,.12)");
  } else if (r.key === "breakroom") {
    // checker tiles
    for (let x = 0; x < 16; x++) for (let y = 36; y < 54; y++) if ((x + y) % 2) poly(c, [[x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z]], "rgba(255,92,168,.045)");
  } else if (r.key === "missions") {
    // the launch lane and hazard stripes at the pods
    poly(c, [[29.4, 36.6, z], [32, 36.6, z], [32, 53.4, z], [29.4, 53.4, z]], "rgba(184,255,74,.05)");
    for (let y = 37; y < 53.5; y += 0.8) poly(c, [[29.1, y, z], [29.4, y, z], [29.4, y + 0.4, z], [29.1, y + 0.4, z]], "rgba(255,200,60,.5)");
    for (let y = 37; y < 53; y += 2) line(c, [16.6, y, z], [28.6, y, z], "rgba(184,255,74,.05)", 1);
  } else if (r.key === "engine") {
    // grating plates and the reactor's safety ring
    for (let x = 0; x < 32; x += 2) for (let y = 54; y < 76; y += 2) poly(c, [[x + 0.08, y + 0.08, z], [x + 1.92, y + 0.08, z], [x + 1.92, y + 1.92, z], [x + 0.08, y + 1.92, z]], null, "rgba(0,0,0,.35)", 1);
    disc(c, REACTOR.x, REACTOR.y, z, REACTOR.r + 1.1, "#1a1626");
    c.save();
    c.beginPath(); const [ex, ey] = P(REACTOR.x, REACTOR.y, z);
    c.ellipse(ex, ey, (REACTOR.r + 1.1) * 45.25, (REACTOR.r + 1.1) * 22.63, 0, 0, Math.PI * 2);
    c.ellipse(ex, ey, (REACTOR.r + 0.6) * 45.25, (REACTOR.r + 0.6) * 22.63, 0, 0, Math.PI * 2, true);
    c.clip("evenodd");
    for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2; if (k % 2) continue; poly(c, [[REACTOR.x, REACTOR.y, z], [REACTOR.x + 6 * Math.cos(a), REACTOR.y + 6 * Math.sin(a), z], [REACTOR.x + 6 * Math.cos(a + 0.13), REACTOR.y + 6 * Math.sin(a + 0.13), z]], "rgba(255,190,60,.55)"); }
    c.restore();
  } else if (r.key === "forge") {
    // scorched plates, hot near the furnace
    pool(c, FURNACE.x, FURNACE.y, z, 6, "#ff5a1f", 0.16);
    const g = rng(7);
    for (let k = 0; k < 26; k++) { const a = g() * Math.PI * 2, d = 2.6 + g() * 3.5; line(c, [FURNACE.x + d * Math.cos(a), FURNACE.y + d * Math.sin(a), z], [FURNACE.x + (d + 0.6 + g()) * Math.cos(a + 0.2), FURNACE.y + (d + 0.6 + g()) * Math.sin(a + 0.2), z], `rgba(255,110,40,${0.1 + g() * 0.2})`, 1); }
  } else if (r.key === "drive") {
    for (let x = 16; x < 32; x += 4) line(c, [x, 76, z], [x, 88, z], "rgba(139,108,255,.12)", 2);
    // power conduits from the coils to the stern, where the engines are
    for (const [x, y] of [[20.2, 80.0], [24.4, 82.4], [28.4, 84.6]] as const) {
      poly(c, [[x - 0.22, y, z], [x + 0.22, y, z], [x + 0.22, L, z], [x - 0.22, L, z]], "#1a1640");
      line(c, [x, y + 1.4, z], [x, L, z], "rgba(164,139,255,.75)", 1.4);
      line(c, [x, y + 1.4, z], [x, L, z], "rgba(164,139,255,.18)", 5);
    }
  } else if (r.key === "offices" && false) {
    for (let c0 = 0; c0 < 5; c0++) poly(c, [[16.4 + c0 * 2.95, 20.6, z], [18.3 + c0 * 2.95, 20.6, z], [18.3 + c0 * 2.95, 35.2, z], [16.4 + c0 * 2.95, 35.2, z]], "rgba(169,139,255,.05)");
  }
}

// ---- the bridge's raised edge and its steps
{
  const z = 0.5, y = 20;
  piece(bbox(0, y - 0.2, 0, W, y + 0.2, z), (c) => {
    poly(c, [[0, y, 0], [W, y, 0], [W, y, z], [0, y, z]], lin(c, P(0, y, z), P(0, y, 0), [[0, "#232050"], [1, "#100e24"]]));
    line(c, [0, y, z], [W, y, z], "#4ad8ff", 1.6);
    line(c, [0, y, z - 0.08], [W, y, z - 0.08], "rgba(74,216,255,.25)", 3);
    // the steps down to the main deck, in the middle
    for (let k = 0; k < 3; k++) {
      const s = 0.5 - (k + 1) / 6, d = y + 0.35 * k;
      box(c, 12.5, d, 0, 7, 0.35, s + 1 / 6, { top: "#1c1a3c", left: "#141230", right: "#17153a", edge: "rgba(74,216,255,.35)" });
    }
  });
}

// ---- the tall walls: port (x = 0) the whole length, the bow (y = 0) and its port chamfer
type WallDeco = { y0: number; y1: number; room: Room };
const DECO: WallDeco[] = ROOMS.filter((r) => r.x0 === 0).map((r) => ({ y0: r.key === "bridge" ? CHAMFER : r.y0, y1: r.y1, room: r }));

/** One stretch of the port wall: the face with its windows cut out, trim in the room's colour, and the room's own fittings. */
function portWall(c: Ctx, y0: number, y1: number, r: Room) {
  const z0 = r.z, h = WALL - z0, len = y1 - y0;
  plane(c, "wallX", [0, y0, WALL], () => {
    // the face, with window openings (even-odd: the openings stay clear)
    c.beginPath(); c.rect(0, 0, len, h);
    const wins = windows(len, r);
    for (const [u, v, w, hh] of wins) c.rect(u, v, w, hh);
    c.fillStyle = lin(c, [0, 0], [0, h], [[0, "#24204a"], [0.55, "#181634"], [1, "#0d0b1f"]]);
    c.fill("evenodd");
    plating(c, len, h, 2.2, Math.round(y0 * 7));
    for (const [u, v, w, hh] of wins) {
      // glass: a faint tint and a reflection streak, so the stars read as behind glass
      c.fillStyle = "rgba(120,160,255,.06)"; c.fillRect(u, v, w, hh);
      c.fillStyle = lin(c, [u, v], [u + w, v + hh], [[0, "rgba(255,255,255,0)"], [0.45, "rgba(200,220,255,.07)"], [0.5, "rgba(200,220,255,.02)"], [1, "rgba(255,255,255,0)"]]);
      c.fillRect(u, v, w, hh);
      c.strokeStyle = "#3e3a7a"; c.lineWidth = 0.09; c.strokeRect(u, v, w, hh);
      c.strokeStyle = alpha(r.accent, 0.35); c.lineWidth = 0.03; c.strokeRect(u - 0.06, v - 0.06, w + 0.12, hh + 0.12);
    }
    // baseboard light and the top trim
    c.fillStyle = alpha(r.accent, 0.55); c.fillRect(0, h - 0.2, len, 0.04);
    c.fillStyle = alpha(r.accent, 0.12); c.fillRect(0, h - 0.5, len, 0.3);
    c.fillStyle = "#3a3670"; c.fillRect(0, 0, len, 0.08);
    fittings(c, len, h, r, y0);
  });
  // the wall's top, 0.35 thick
  box(c, -0.35, y0, WALL - 0.02, 0.35, len, 0.02, { top: "#3c3878", left: null, right: "#4a4590" });
  line(c, [0, y0, WALL], [0, y1, WALL], "rgba(180,170,255,.5)", 1);
}

/** Neon lettering in a plane: (u, v) its centre, `size` its cap height, all in world units. */
export function neon(c: Ctx, text: string, u: number, v: number, size: number, color: string, spacing = 0.18) {
  const k = 40;
  c.save(); c.scale(1 / k, 1 / k);
  c.font = `700 ${size * k}px 'JetBrains Mono', ui-monospace, monospace`;
  c.textAlign = "center"; c.textBaseline = "middle";
  if ("letterSpacing" in c) (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing * size * k}px`;
  c.shadowColor = color; c.shadowBlur = size * k * 0.9;
  c.fillStyle = color; c.fillText(text, u * k, v * k);
  c.shadowBlur = size * k * 0.3; c.fillStyle = "rgba(255,255,255,.85)"; c.fillText(text, u * k, v * k);
  c.restore();
}

/** Window openings along a wall stretch, (u, v, w, h) in wall units. */
function windows(len: number, r: Room): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  if (r.key === "engine" || r.key === "forge") {
    // portholes only, high up: the engine room keeps its wall for machinery
    for (let u = 1.2; u + 1 < len; u += 3.2) out.push([u, 0.45, 1.1, 0.7]);
    return out;
  }
  const top = 0.5, hh = r.key === "bridge" ? 2.0 : 1.35, w = r.key === "bridge" ? 2.2 : 1.9, gap = 0.35;
  for (let u = 0.6; u + w < len - 0.4; u += w + gap) out.push([u, top, w, hh]);
  return out;
}

/** What hangs on each room's wall, in wall units (u along the wall from its bow end, v down from the top). */
function fittings(c: Ctx, len: number, h: number, r: Room, y0: number) {
  const acc = r.accent;
  const screen = (u: number, v: number, w: number, hh: number, col: string, rows = 4) => {
    c.fillStyle = "#07060f"; c.fillRect(u, v, w, hh);
    c.fillStyle = alpha(col, 0.12); c.fillRect(u + 0.05, v + 0.05, w - 0.1, hh - 0.1);
    for (let k = 0; k < rows; k++) { c.fillStyle = alpha(col, 0.5 - k * 0.07); c.fillRect(u + 0.14, v + 0.16 + k * ((hh - 0.3) / rows), (w - 0.28) * (0.4 + ((k * 37 + Math.round(u * 10)) % 50) / 100), 0.05); }
    c.strokeStyle = alpha(col, 0.7); c.lineWidth = 0.035; c.strokeRect(u, v, w, hh);
  };
  if (r.key === "quarters") {
    // a portrait frame for #1 between the windows, gold trim
    c.fillStyle = "#1b1020"; c.fillRect(3.9, 1.98, 1.3, 1.06);
    c.strokeStyle = "#ffc46b"; c.lineWidth = 0.07; c.strokeRect(3.9, 1.98, 1.3, 1.06);
    c.strokeStyle = "rgba(255,196,107,.45)"; c.lineWidth = 0.03; c.strokeRect(3.82, 1.9, 1.46, 1.22);
  }
  if (r.key === "breakroom") {
    // the menu board above the coffee bar
    c.fillStyle = "#12091a"; c.fillRect(1.5, 2.0, 5.5, 0.85);
    c.strokeStyle = alpha(acc, 0.8); c.lineWidth = 0.05; c.strokeRect(1.5, 2.0, 5.5, 0.85);
  }
  if (r.key === "engine") {
    // pipes along the wall and gauges
    for (const [v, col] of [[1.55, "#3a3254"], [1.85, "#2e2846"], [2.6, "#3a3254"]] as const) { c.fillStyle = col; c.fillRect(0, v, len, 0.16); c.fillStyle = "rgba(255,255,255,.06)"; c.fillRect(0, v, len, 0.04); }
    for (let u = 1; u < len; u += 2.4) { c.fillStyle = "#1e1a30"; c.fillRect(u, 1.5, 0.12, 1.4); }
    for (const u of [2.6, 7.4, 20.0]) if (u < len - 1) screen(u, 1.05, 1.6, 0.42, "#ffb547", 2);
    // the frame of the live shift-hours board (its numbers are drawn every frame)
    c.fillStyle = "#0a0810"; c.fillRect(len - 18.6, 1.2, 6.2, 1.3);
    c.strokeStyle = "rgba(255,181,71,.8)"; c.lineWidth = 0.05; c.strokeRect(len - 18.6, 1.2, 6.2, 1.3);
  }
  if (r.key === "forge") {
    // the memorial wall's frame (the frogs it burned are drawn live over it)
    c.fillStyle = "#130a0c"; c.fillRect(1.0, 1.25, len - 2.0, 1.75);
    c.strokeStyle = "rgba(255,122,61,.55)"; c.lineWidth = 0.05; c.strokeRect(1.0, 1.25, len - 2.0, 1.75);
  }
  if (r.key === "bridge") screen(0.7, 2.75, 3.6, 0.55, acc, 2);
  // the room's sign, in its colour, under the windows
  const SIGN: Partial<Record<string, [string, number]>> = { bridge: ["NIGHT WATCH", 0.5], quarters: ["WARDROOM", 0.5], breakroom: ["BREAK ROOM", 0.5], engine: ["SHIFT FLOOR · REACTOR ONE", 0.42], forge: ["THE FORGE", 0.5] };
  const sign = SIGN[r.key];
  // the wall runs toward the stern, right to left on screen: the lettering is mirrored back to read
  if (sign) { c.save(); c.translate(r.key === "breakroom" ? len * 0.34 : r.key === "quarters" ? len * 0.68 : len * 0.5, r.key === "forge" ? 0.75 : r.key === "engine" ? 0.95 : 2.35); c.scale(-1, 1); neon(c, sign[0], 0, 0, sign[1], acc); c.restore(); }
  void y0; void h;
}

for (const d of DECO) piece(bbox(-0.4, d.y0, d.room.z, 0, d.y1, WALL + 0.1, 10), (c) => portWall(c, d.y0, d.y1, d.room));

/**
 * Light through the windows: each opening throws a patch of moonlight on the floor in front of it and a faint
 * shaft through the air down to it (the light falls at 45 degrees, so a window at height z lands z tiles in).
 */
function shafts(c: Ctx, wins: { a: V3; b: V3; z0: number; z1: number; dir: [number, number] }[], col: string, k: number) {
  const prev = c.globalCompositeOperation; c.globalCompositeOperation = "lighter";
  for (const w of wins) {
    const [dx, dy] = w.dir, fz = w.a[2];
    const f = (p: V3, z: number): V3 => [p[0] + dx * (z - fz), p[1] + dy * (z - fz), fz];
    const A0 = f(w.a, w.z0), B0 = f(w.b, w.z0), A1 = f(w.a, w.z1), B1 = f(w.b, w.z1);
    // the patch on the floor
    const [px, py] = P(...A0), [qx, qy] = P(...A1);
    poly(c, [A0, B0, B1, A1], lin(c, [px, py], [qx, qy], [[0, alpha(col, 0.16 * k)], [1, alpha(col, 0.03 * k)]]));
    // the shaft through the air, from the window's lower edge to the patch's far edge
    const top0: V3 = [w.a[0], w.a[1], w.z1], top1: V3 = [w.b[0], w.b[1], w.z1];
    const [sx0, sy0] = P(...top0), [sx1, sy1] = P(...A1);
    poly(c, [top0, top1, B1, A1], lin(c, [sx0, sy0], [sx1, sy1], [[0, alpha(col, 0.07 * k)], [1, alpha(col, 0)]]));
  }
  c.globalCompositeOperation = prev;
}
for (const d of DECO) {
  const r = d.room, len = d.y1 - d.y0;
  const list = windows(len, r).map(([u, v, w, h]) => ({ a: [0, d.y0 + u, r.z] as V3, b: [0, d.y0 + u + w, r.z] as V3, z0: WALL - v - h, z1: WALL - v, dir: [1, 0.35] as [number, number] }));
  piece(bbox(0, d.y0, r.z, 4.5, d.y1 + 1.5, WALL, 10), (c) => shafts(c, list, "#c4b4ff", r.key === "engine" || r.key === "forge" ? 0.6 : 1));
}
// the bow's long window: starlight falling aft onto the bridge
{
  const len = W - 2 * CHAMFER, n = 8, w = (len - 0.8 - 7 * 0.28) / n;
  const list = Array.from({ length: n }, (_, k) => ({ a: [CHAMFER + 0.4 + k * (w + 0.28), 0, 0.5] as V3, b: [CHAMFER + 0.4 + k * (w + 0.28) + w, 0, 0.5] as V3, z0: WALL - 0.42 - 2.05, z1: WALL - 0.42, dir: [0.3, 1] as [number, number] }));
  piece(bbox(CHAMFER, 0, 0.5, W, 5, WALL, 10), (c) => shafts(c, list, "#9debff", 0.8));
}

// the bow: the port chamfer (facing the camera) and the long bow wall, a panorama window each
{
  const z0 = 0.5, h = WALL - z0;
  const bowWall = (c: Ctx, ax: number, ay: number, bx: number, by: number, wins: number) => {
    const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
    const [ox, oy] = P(ax, ay, WALL);
    c.save();
    // the plane: u along the wall, v down
    c.transform((ux - uy) * HX, (ux + uy) * HY, 0, HZ, ox, oy);
    c.beginPath(); c.rect(0, 0, len, h);
    const ws: [number, number, number, number][] = [];
    const w = (len - 0.8 - (wins - 1) * 0.28) / wins;
    for (let k = 0; k < wins; k++) ws.push([0.4 + k * (w + 0.28), 0.42, w, 2.05]);
    for (const [u, v, ww, hh] of ws) c.rect(u, v, ww, hh);
    c.fillStyle = lin(c, [0, 0], [0, h], [[0, "#26224e"], [0.6, "#171536"], [1, "#0c0a1e"]]);
    c.fill("evenodd");
    plating(c, len, h, 2.4, Math.round(ax * 13 + ay));
    for (const [u, v, ww, hh] of ws) {
      c.fillStyle = "rgba(110,170,255,.07)"; c.fillRect(u, v, ww, hh);
      c.fillStyle = lin(c, [u, v], [u + ww, v + hh], [[0, "rgba(255,255,255,0)"], [0.4, "rgba(190,230,255,.08)"], [0.46, "rgba(190,230,255,.015)"], [1, "rgba(255,255,255,0)"]]);
      c.fillRect(u, v, ww, hh);
      c.strokeStyle = "#45408a"; c.lineWidth = 0.1; c.strokeRect(u, v, ww, hh);
    }
    c.fillStyle = "rgba(74,216,255,.6)"; c.fillRect(0, h - 0.2, len, 0.04);
    c.fillStyle = "rgba(74,216,255,.14)"; c.fillRect(0, h - 0.5, len, 0.3);
    c.fillStyle = "#3a3670"; c.fillRect(0, 0, len, 0.08);
    c.restore();
    line(c, [ax, ay, WALL], [bx, by, WALL], "rgba(180,170,255,.55)", 1.2);
  };
  piece(bbox(0, 0, z0, CHAMFER, CHAMFER, WALL + 0.2, 10), (c) => {
    poly(c, [[0, CHAMFER, WALL], [CHAMFER, 0, WALL], [CHAMFER - 0.25, -0.25, WALL], [-0.25, CHAMFER - 0.25, WALL]], "#3c3878");
    bowWall(c, 0, CHAMFER, CHAMFER, 0, 2);
  });
  piece(bbox(CHAMFER, -0.4, z0, W - CHAMFER, 0, WALL + 0.2, 10), (c) => {
    poly(c, [[CHAMFER, 0, WALL], [W - CHAMFER, 0, WALL], [W - CHAMFER, -0.35, WALL], [CHAMFER, -0.35, WALL]], "#3c3878");
    bowWall(c, CHAMFER, 0, W - CHAMFER, 0, 8);
  });
  // the starboard chamfer is seen edge on: its top only
  piece(bbox(W - CHAMFER, 0, z0, W + 0.4, CHAMFER, WALL + 0.2, 10), (c) => {
    poly(c, [[W - CHAMFER, 0, WALL], [W, CHAMFER, WALL], [W + 0.3, CHAMFER - 0.1, WALL], [W - CHAMFER + 0.1, -0.3, WALL]], "#3c3878");
    poly(c, [[W - CHAMFER, 0, z0], [W, CHAMFER, z0], [W, CHAMFER, WALL], [W - CHAMFER, 0, WALL]], "#1b1940");
    line(c, [W - CHAMFER, 0, WALL], [W, CHAMFER, WALL], "rgba(180,170,255,.5)", 1);
  });
}

// ---- low partitions between the rooms, with doorways
type Part = { axis: "x" | "y"; at: number; from: number; to: number; doors: [number, number][]; accent: string };
const PARTS: Part[] = [
  { axis: "y", at: 36, from: 0, to: W, doors: [[6.5, 8.5], [22.5, 25]], accent: "#ff5ca8" },
  { axis: "y", at: 54, from: 0, to: W, doors: [[11.4, 13.6], [18.4, 20.6]], accent: "#ffb547" },
  { axis: "y", at: 76, from: 0, to: W, doors: [[6.8, 9.6], [19, 22]], accent: "#ff7a3d" },
  { axis: "x", at: 15, from: 20, to: 36, doors: [[26.5, 29]], accent: "#a98bff" },
  { axis: "x", at: 16, from: 36, to: 54, doors: [[43.5, 46.5]], accent: "#b8ff4a" },
  { axis: "x", at: 16, from: 76, to: L, doors: [[80.5, 83]], accent: "#8b6cff" },
];
const PH = 0.55, PT = 0.22;
for (const p of PARTS) {
  const spans: [number, number][] = [];
  let a = p.from;
  for (const [d0, d1] of p.doors) { spans.push([a, d0]); a = d1; }
  spans.push([a, p.to]);
  for (const [s0, s1] of spans) {
    const [x, y, w, d] = p.axis === "y" ? [s0, p.at - PT / 2, s1 - s0, PT] : [p.at - PT / 2, s0, PT, s1 - s0];
    piece(bbox(x, y, 0, x + w, y + d, PH + 0.6), (c) => {
      box(c, x, y, 0, w, d, PH, { top: "#3a3672", left: "#1a1838", right: "#221f48", edge: alpha(p.accent, 0.8), lw: 1.2 });
      // a glass pane above it, barely there
      const g: V3[] = p.axis === "y" ? [[x, y + d / 2, PH], [x + w, y + d / 2, PH], [x + w, y + d / 2, PH + 0.5], [x, y + d / 2, PH + 0.5]] : [[x + w / 2, y, PH], [x + w / 2, y + d, PH], [x + w / 2, y + d, PH + 0.5], [x + w / 2, y, PH + 0.5]];
      poly(c, g, "rgba(150,200,255,.05)");
      const [p0, p1] = p.axis === "y" ? [[x, y + d / 2, PH + 0.5], [x + w, y + d / 2, PH + 0.5]] : [[x + w / 2, y, PH + 0.5], [x + w / 2, y + d, PH + 0.5]];
      line(c, p0 as V3, p1 as V3, alpha(p.accent, 0.35), 1);
    });
  }
}

// ---- the front rims (starboard and stern) and the hull below them
const RIM = 0.45;
{
  // starboard rim, with the hangar door open at the mission bay
  const segs: [number, number, number][] = [[CHAMFER, 20, 0.5], [20, 37, 0], [53, L, 0]];
  for (const [y0, y1, z] of segs) piece(bbox(W, y0, z, W + 0.4, y1, z + RIM), (c) => box(c, W, y0, z, 0.4, y1 - y0, RIM, { top: "#3a3672", left: "#1d1a40", right: "#242150", edge: "rgba(150,140,255,.5)" }));
  piece(bbox(0, L, 0, W + 0.4, L + 0.4, RIM), (c) => box(c, 0, L, 0, W + 0.4, 0.4, RIM, { top: "#3a3672", left: "#1d1a40", right: "#242150", edge: "rgba(150,140,255,.5)" }));
  // the hangar door frame
  piece(bbox(W, 36.6, 0, W + 0.6, 53.4, 2.2), (c) => {
    for (const y of [36.6, 53]) box(c, W, y, 0, 0.5, 0.4, 2.0, { top: "#3a3672", left: "#1b1838", right: "#262252", edge: "rgba(184,255,74,.6)" });
    for (let k = 0; k < 10; k++) { const y = 37.3 + k * 1.6; poly(c, [[W + 0.5, y, 0.02], [W + 0.5, y + 0.8, 0.02], [W + 0.5, y + 0.8, -0.2], [W + 0.5, y, -0.2]], k % 2 ? "#ffcc33" : "#141018"); }
  });
}

/** The hull below the deck: a face from the rim down, then a bevel in to the keel. Both faces we see: starboard and stern. */
const KEEL = -2.2, BEVEL = -3.4;
piece(bbox(W - 2, 0, BEVEL, W + 0.4, L + 0.4, 0.5, 10), (c) => {
  const x = W + 0.4;
  // the starboard face
  poly(c, [[x, CHAMFER, 0.5], [x, 20, 0.5], [x, 20, 0], [x, L + 0.4, 0], [x, L + 0.4, KEEL], [x, CHAMFER + 1, KEEL]], lin(c, P(x, 40, 0.5), P(x, 40, KEEL), [[0, "#262350"], [1, "#16142e"]]));
  poly(c, [[x, CHAMFER + 1, KEEL], [x, L + 0.4, KEEL], [x - 1.6, L + 0.4, BEVEL], [x - 1.6, CHAMFER + 3, BEVEL]], "#100e24");
  plane(c, "wallX", [x, L + 0.4, 0], () => {
    // drawn in reverse (u toward the bow) so the lettering reads left to right
    c.save(); c.scale(-1, 1);
    plating(c, L + 0.4 - CHAMFER, -KEEL, 3.1, 11);
    // portholes, lit on the decks behind them
    const g = rng(3);
    for (let u = 2; u < L - 6; u += 1.15) {
      if (u > 34.6 && u < 52.6) continue;
      const lit = g() < 0.72;
      c.fillStyle = lit ? (g() < 0.5 ? "rgba(255,214,140,.85)" : "rgba(140,220,255,.8)") : "#0b0a18";
      c.beginPath(); c.ellipse(u, 0.85, 0.16, 0.12, 0, 0, Math.PI * 2); c.fill();
    }
    // the name
    c.font = "700 1.05px 'JetBrains Mono', ui-monospace, monospace";
    c.fillStyle = "rgba(233,228,255,.88)"; c.textBaseline = "middle";
    c.fillText("N I G H T S H I F T", 56, 1.55);
    c.font = "600 .42px 'JetBrains Mono', ui-monospace, monospace";
    c.fillStyle = "rgba(184,255,74,.75)"; c.fillText("NS-0300 · ALWAYS SHIPPING", 56.2, 2.0);
    c.fillStyle = "#b8ff4a"; c.fillRect(54.2, 1.1, 0.12, 0.9);
    c.restore();
  });
});
piece(bbox(0, L, BEVEL, W + 0.4, L + 0.4, 0.1, 10), (c) => {
  const y = L + 0.4;
  poly(c, [[0, y, 0], [W + 0.4, y, 0], [W + 0.4, y, KEEL], [1.5, y, KEEL]], lin(c, P(16, y, 0), P(16, y, KEEL), [[0, "#24214c"], [1, "#14122c"]]));
  poly(c, [[1.5, y, KEEL], [W + 0.4, y, KEEL], [W - 1.2, y, BEVEL], [3, y, BEVEL]], "#0f0d22");
  plane(c, "wallY", [0, y, 0], () => { plating(c, W + 0.4, -KEEL, 2.6, 21); });
});

// ---- hull detail on the starboard face: a lit strip under the lip, vents, a docking light row
piece(bbox(W, 0, KEEL, W + 0.5, L + 0.5, 0.5, 10), (c) => {
  const x = W + 0.41;
  line(c, [x, CHAMFER + 0.5, -0.08], [x, 20, -0.08], "rgba(74,216,255,.55)", 1.2);
  line(c, [x, 20, -0.08], [x, 36.6, -0.08], "rgba(169,139,255,.55)", 1.2);
  line(c, [x, 53.4, -0.08], [x, L + 0.4, -0.08], "rgba(255,181,71,.5)", 1.2);
  // vents
  for (let y = 24; y < L - 2; y += 9.5) {
    if (y < 55) continue;
    poly(c, [[x, y, -1.15], [x, y + 2.2, -1.15], [x, y + 2.2, -1.65], [x, y, -1.65]], "#0b0a1a");
    for (let k = 1; k < 6; k++) line(c, [x, y + k * 0.37, -1.18], [x, y + k * 0.37, -1.62], "rgba(120,110,200,.35)", 1);
  }
  // the landing lights round the hangar door
  for (let y = 37.2; y < 53; y += 1.3) { const [a, b] = P(x, y, -0.45); c.fillStyle = "rgba(184,255,74,.85)"; c.fillRect(a - 1.5, b - 1, 3, 2); }
});

// ---- the starboard wing, down-right of the hull, and the engines at the stern
{
  const z = -1.2, t = 0.4, x = W + 0.4;
  const top: V3[] = [[x, 46, z + t], [x + 11, 60, z + t], [x + 11, 64.5, z + t], [x + 2, 72, z + t], [x, 72, z + t]];
  piece(bbox(x, 44, z - 0.5, x + 12, 73, z + t + 0.5), (c) => {
    poly(c, [[x + 11, 60, z], [x + 11, 64.5, z], [x + 11, 64.5, z + t], [x + 11, 60, z + t]], "#2a2656");
    poly(c, [[x + 11, 64.5, z], [x + 2, 72, z], [x + 2, 72, z + t], [x + 11, 64.5, z + t]], "#15132e");
    poly(c, top, lin(c, P(x, 58, z + t), P(x + 11, 62, z + t), [[0, "#2e2a5c"], [1, "#24204c"]]));
    for (let k = 1; k < 5; k++) line(c, [x, 47 + k * 5, z + t], [x + 9.5 - k * 0.3, 60.5 + k * 0.7, z + t], "rgba(8,6,20,.75)", 1.2);
    line(c, [x, 46, z + t], [x + 11, 60, z + t], "rgba(190,180,255,.55)", 1.4);
    // a lime stripe along the wing
    poly(c, [[x + 1, 50.2, z + t], [x + 9.4, 61, z + t], [x + 9.4, 61.8, z + t], [x + 1, 51.4, z + t]], "rgba(184,255,74,.35)");
  });
  // the docked shuttle outside the hangar door
  piece(bbox(W + 0.6, 39, -1, W + 6, 50, 2), (c) => shuttle(c, W + 3.2, 44.5));
  // three engines
  for (const ex of [6, 16, 26]) {
    piece(bbox(ex - 3, L, -4, ex + 3, L + 8, 1.6, 12), (c) => {
      tube(c, ex, -0.9, 2.15, L + 0.4, L + 6.2, ["#4a4590", "#24204c", "#0e0c20"]);
      // banding
      for (const y of [L + 1.6, L + 3.4]) { const pts = ring(ex, y, -0.9, 2.2); c.strokeStyle = "rgba(10,8,24,.8)"; c.lineWidth = 2; c.beginPath(); pts.slice(0, 22).forEach(([a, b], i) => (i ? c.lineTo(a, b) : c.moveTo(a, b))); c.stroke(); }
      // the nozzle: an outer lip and the dark throat (its glow is drawn live)
      fillPts(c, ring(ex, L + 6.2, -0.9, 2.15), "#2c2858");
      fillPts(c, ring(ex, L + 6.25, -0.9, 1.75), "#0a0816");
      const pts = ring(ex, L + 6.26, -0.9, 1.75); c.strokeStyle = "rgba(120,220,255,.5)"; c.lineWidth = 1.4; c.beginPath(); pts.forEach(([a, b], i) => (i ? c.lineTo(a, b) : c.moveTo(a, b))); c.closePath(); c.stroke();
    });
  }
}

/** A small shuttle, sitting nose to the bow. */
function shuttle(c: Ctx, cx: number, cy: number) {
  const z = -0.5;
  disc(c, cx, cy, z - 0.1, 2.3, "rgba(0,0,0,.35)");
  tube(c, cx, z + 0.7, 1.05, cy - 3.6, cy + 2.8, ["#8a84d0", "#4a4590", "#1a1838"], "#2a2656");
  // nose cone toward the bow
  const tip = P(cx, cy - 5.1, z + 0.75);
  const base = ring(cx, cy - 3.6, z + 0.7, 1.05, 24);
  c.fillStyle = lin(c, P(cx, cy - 4, z + 1.7), P(cx, cy - 4, z - 0.3), [[0, "#9a94e0"], [1, "#24204c"]]);
  c.beginPath(); c.moveTo(tip[0], tip[1]); base.forEach(([a, b]) => c.lineTo(a, b)); c.closePath(); c.fill();
  // cockpit glass
  const [gx, gy] = P(cx + 0.4, cy - 3.2, z + 1.5);
  c.fillStyle = lin(c, [gx - 12, gy - 6], [gx + 12, gy + 6], [[0, "#9debff"], [1, "#1f5f8a"]]);
  c.beginPath(); c.ellipse(gx, gy, 13, 6, -0.45, 0, Math.PI * 2); c.fill();
  // stubby wings and a lime stripe
  poly(c, [[cx + 0.9, cy - 0.5, z + 0.6], [cx + 2.6, cy + 1.6, z + 0.5], [cx + 2.6, cy + 2.4, z + 0.5], [cx + 0.9, cy + 2.2, z + 0.6]], "#3c3878");
  line(c, [cx + 1.02, cy - 3, z + 0.95], [cx + 1.02, cy + 2.6, z + 0.95], "rgba(184,255,74,.8)", 1.6);
}

export const STATIC: readonly Piece[] = pieces;
export const WORLD_BOX = ((): [number, number, number, number] => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of pieces) { a = Math.min(a, p.box[0]); b = Math.min(b, p.box[1]); c = Math.max(c, p.box[2]); d = Math.max(d, p.box[3]); }
  return [a, b, c, d];
})();
void room; void mix; void rad;
