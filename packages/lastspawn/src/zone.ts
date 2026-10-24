/**
 * The ground of each zone, as one function both sides use: the client builds its terrain from it and
 * the server checks moves against it. Plus where things stand: spawns, portals, NPCs, mob camps.
 * three.js axes: y up, -z north.
 */
import type { ZoneId } from "./protocol.js";

// ---------- deterministic noise ----------
const hash = (x: number, z: number) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const fade = (t: number) => t * t * (3 - 2 * t);
export function noise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  const u = fade(xf), v = fade(zf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm = (x: number, z: number, oct = 4) => {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise(x * f, z * f); f *= 2; amp *= 0.5; }
  return s / (1 - Math.pow(0.5, oct));
};
export const smooth = (e0: number, e1: number, x: number) => fade(Math.max(0, Math.min(1, (x - e0) / (e1 - e0))));

export interface Spot { x: number; y: number; z: number; ry: number }
export interface Portal { at: Spot; radius: number; to: ZoneId; arrive: Spot; label: string }
export interface NpcPlace { id: string; at: Spot }
export interface MobCamp { mob: string; at: Spot; spread: number; count: number }
/** A walkway on stilts: flat at y, or a ramp from y at one end to y1 at the other, along x or z. */
export interface Deck { x0: number; z0: number; x1: number; z1: number; y: number; y1?: number; along?: "x" | "z" }
export const deckY = (d: Deck, x: number, z: number) =>
  d.y1 === undefined ? d.y : d.along === "x" ? d.y + (d.y1 - d.y) * (x - d.x0) / (d.x1 - d.x0) : d.y + (d.y1 - d.y) * (z - d.z0) / (d.z1 - d.z0);
export interface ZoneDef {
  id: ZoneId; name: string;
  /** the walkable square: |x| and |z| up to this */
  half: number;
  /** water surface height, or null where there is none */
  water: number | null;
  heightAt(x: number, z: number): number;
  /** boardwalks and ramps a frog stands on above the ground or the water */
  decks: Deck[];
  spawn: Spot;
  portals: Portal[];
  npcs: NpcPlace[];
  camps: MobCamp[];
  /** places the client dresses (the lighthouse, the pump, the stair) */
  marks: Record<string, Spot>;
}

// ---------- the Cistern: a round chamber under the lighthouse, the hatching pool in the middle ----------
export const CISTERN = {
  radius: 12, pool: 4.6, poolFloor: -1.4, water: -0.25,
  /** the stair climbs the wall from angle a0 to a1 (radians, from +x toward +z) */
  stair: { inner: 10.1, outer: 11.7, a0: Math.PI * 0.25, a1: Math.PI * 1.35, top: 6 },
};
const stairAngle = (x: number, z: number) => {
  let a = Math.atan2(z, x); if (a < 0) a += Math.PI * 2; return a;
};
export function cisternHeight(x: number, z: number): number {
  const r = Math.hypot(x, z), s = CISTERN.stair;
  if (r < CISTERN.pool + 0.6) {
    // the pool: a stone lip, then down to its floor
    return CISTERN.poolFloor + (0 - CISTERN.poolFloor) * smooth(CISTERN.pool - 1.2, CISTERN.pool + 0.2, r);
  }
  if (r >= s.inner && r <= s.outer) {
    const a = stairAngle(x, z);
    if (a >= s.a0 && a <= s.a1) return s.top * (a - s.a0) / (s.a1 - s.a0);
  }
  return 0;
}
const stairAt = (a: number) => {
  const s = CISTERN.stair, r = (s.inner + s.outer) / 2;
  return { x: Math.cos(a) * r, y: s.top * (a - s.a0) / (s.a1 - s.a0), z: Math.sin(a) * r };
};
const stairTop = stairAt(CISTERN.stair.a1);
/** where you come down into the Cistern: a few steps below the door, not in its doorway */
const stairArrive = stairAt(CISTERN.stair.a1 - 0.4);

// ---------- Hollowmere: the lighthouse island, the Posts on stilts, the Cut to the south ----------
export const LIGHTHOUSE = { x: 0, z: 0, island: 13, top: 2.2 };
/** The Posts: Hollowmere's boardwalks on stilts over open water, from the lighthouse island to the chapel. */
export const POSTS_Y = 1.6;
export const POSTS: Deck[] = [
  { x0: 11, z0: -8, x1: 20, z1: -4, y: LIGHTHOUSE.top, y1: POSTS_Y, along: "x" },   // down off the island
  { x0: 20, z0: -8, x1: 30, z1: -4, y: POSTS_Y },                                   // the first walk
  { x0: 30, z0: -18, x1: 46, z1: -2, y: POSTS_Y },                                  // the Landing
  { x0: 36, z0: -32, x1: 40, z1: -18, y: POSTS_Y },
  { x0: 26, z0: -50, x1: 54, z1: -32, y: POSTS_Y },                                 // the Lantern Market
  { x0: 54, z0: -44, x1: 64, z1: -38, y: POSTS_Y },
  { x0: 64, z0: -56, x1: 82, z1: -30, y: POSTS_Y },                                 // the chapel deck
];
export function hollowmereHeight(x: number, z: number): number {
  const r = Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z);
  // marsh: low mounds around water level, deeper channels between
  let h = (fbm(x / 38 + 3.1, z / 38 - 7.7) - 0.5) * 3.2 + 0.15;
  // the Cut: dense hummocks and narrow channels to the south
  const cut = smooth(18, 40, z) * (1 - smooth(150, 175, z));
  h += cut * ((fbm(x / 11 - 4, z / 11 + 2) - 0.45) * 1.8);
  // open water under the Posts (north-east): the stilt-town stands in it
  const posts = smooth(14, 26, x) * (1 - smooth(80, 95, x)) * smooth(-80, -66, z) * (1 - smooth(-12, 0, z));
  h = h * (1 - posts) + -1.8 * posts;
  // the lighthouse island: a raised mound with a flat top
  const isl = 1 - smooth(LIGHTHOUSE.island - 2, LIGHTHOUSE.island + 9, r);
  h = h * (1 - isl) + LIGHTHOUSE.top * isl;
  // the world's edge: deep water
  const edge = smooth(170, 195, Math.max(Math.abs(x), Math.abs(z)));
  return h * (1 - edge) - 3 * edge;
}

export const ZONES: Record<ZoneId, ZoneDef> = {
  cistern: {
    id: "cistern", name: "The Cistern", half: CISTERN.radius, water: CISTERN.water, heightAt: cisternHeight, decks: [],
    spawn: { x: 0, y: CISTERN.water, z: 0, ry: 0 },
    portals: [{ at: { ...stairTop, ry: 0 }, radius: 1.4, to: "hollowmere", arrive: { x: 0, y: LIGHTHOUSE.top, z: 9.5, ry: 0 }, label: "Up to Hollowmere" }],
    npcs: [{ id: "keeper_wend", at: { x: 3.4, y: 0, z: -5.4, ry: Math.PI * 0.85 } }],
    camps: [{ mob: "bog_leech", at: { x: -6.4, y: 0, z: 8.2, ry: 0 }, spread: 3.2, count: 3 }],
    marks: { pump: { x: -7.6, y: 0, z: 5.6, ry: 0.6 }, stairTop: { ...stairTop, ry: 0 } },
  },
  hollowmere: {
    id: "hollowmere", name: "Hollowmere", half: 190, water: 0, heightAt: hollowmereHeight, decks: POSTS,
    spawn: { x: 0, y: LIGHTHOUSE.top, z: 9.5, ry: 0 },
    portals: [{ at: { x: 0, y: LIGHTHOUSE.top, z: 6.2, ry: Math.PI }, radius: 1.3, to: "cistern", arrive: { ...stairArrive, ry: Math.PI }, label: "Down to the Cistern" }],
    npcs: [{ id: "brother_cress", at: { x: 72, y: POSTS_Y, z: -43, ry: Math.PI * 0.5 } }],
    camps: [
      { mob: "bog_leech", at: { x: -8, y: 0, z: 46, ry: 0 }, spread: 9, count: 5 },
      { mob: "midge_swarm", at: { x: 14, y: 0, z: 72, ry: 0 }, spread: 10, count: 4 },
      { mob: "reed_rat", at: { x: -18, y: 0, z: 98, ry: 0 }, spread: 6, count: 3 },
      { mob: "reed_rat", at: { x: 22, y: 0, z: 118, ry: 0 }, spread: 6, count: 3 },
    ],
    marks: { lighthouse: { x: 0, y: LIGHTHOUSE.top, z: 0, ry: 0 }, door: { x: 0, y: LIGHTHOUSE.top, z: 6.2, ry: 0 } },
  },
};

/** Where a frog may stand at x,z: a boardwalk over it, the ground, or swimming at the surface over deep water. */
export function floorAt(zone: ZoneId, x: number, z: number): { y: number; swim: boolean } {
  const Z = ZONES[zone], g = Z.heightAt(x, z);
  let deck = -Infinity;
  for (const d of Z.decks) if (x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) deck = Math.max(deck, deckY(d, x, z));
  if (deck > g && deck > (Z.water ?? -Infinity) - 1) return { y: deck, swim: false };
  if (Z.water !== null && g < Z.water - 0.9) return { y: Z.water - 1.0, swim: true };
  return { y: g, swim: false };
}
export const inBounds = (zone: ZoneId, x: number, z: number) =>
  zone === "cistern" ? Math.hypot(x, z) <= CISTERN.radius - 0.4 : Math.max(Math.abs(x), Math.abs(z)) <= ZONES[zone].half;

/** Movement speeds, world units a second. */
export const SPEED = { walk: 2.4, run: 5.6, swim: 2.8, leap: 7 };
