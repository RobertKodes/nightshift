/**
 * The operations deck plan: four rooms in a row, joined by doorways, each with its seats, the places a
 * frog stands, the lanes it walks and the camera's shot. Units are the frog's own (a standing frog is
 * 1.8 tall); x runs along the deck, -z is the window wall.
 */
export const BAY_W = 12, ROOM_H = 3.4, HALF_D = 5;
export const bayX = (bay: number) => bay * BAY_W;

export type XZ = readonly [number, number];
export type Act = "look" | "use" | "point" | "cheer" | "talk";
export type Furniture = "console" | "desk" | "table" | "sofa" | "captain";
/** Where a frog sits: its seated root, its facing (0 = +z), where it stands once up, its first step out, and its screen. */
export type Seat = { at: XZ; face: number; kind: Furniture; stand: XZ; exit: XZ; y: number; screen: number; fixed: boolean };
/** Where a frog stands to do something. */
export type Spot = { at: XZ; face: number; act: Act };
export type Layout = {
  seats: Seat[]; homes: Spot[]; visits: Spot[]; nodes: XZ[]; links: [number, number][];
  eye: [number, number, number]; look: [number, number, number]; narrow: [number, number, number]; glow: { at: [number, number, number]; color: string };
};

/** A chair rolls back 0.55 and the frog stands 0.42 behind its seated root; from a sofa it steps forward. */
function seat(x: number, z: number, face: number, kind: Furniture, side: number, screen = -1, extra: Partial<Seat> = {}): Seat {
  const fx = Math.sin(face), fz = Math.cos(face), rise = kind === "sofa" ? .3 : -.42;
  const stand: XZ = [x + fx * rise, z + fz * rise];
  return { at: [x, z], face, kind, stand, exit: [stand[0] + Math.cos(face) * side, stand[1] - Math.sin(face) * side], y: 0, screen, fixed: false, ...extra };
}
const spot = (x: number, z: number, face: number, act: Act): Spot => ({ at: [x, z], face, act });
const PI = Math.PI, HALF = PI / 2;
/** The doorways in both side walls, for frogs that look through to the next room. */
const doors = [spot(-5.15, .15, -HALF, "look"), spot(5.15, -.15, HALF, "look")];
const ring = (cx: number, cz: number, r: number, n: number, offset = 0): XZ[] => Array.from({ length: n }, (_, i) => [cx + Math.sin(offset + i / n * PI * 2) * r, cz + Math.cos(offset + i / n * PI * 2) * r] as const);
const chain = (from: number, to: number): [number, number][] => Array.from({ length: to - from }, (_, i) => [from + i, from + i + 1]);

const TABLE: XZ = [-.5, -1.4];
const table = (degrees: number, side: number, screen: number) => {
  const a = degrees * PI / 180;
  return seat(TABLE[0] + Math.sin(a) * 1.24, TABLE[1] + Math.cos(a) * 1.24, a + PI, "table", side, screen);
};

export const LAYOUTS: Layout[] = [
  { // Mission bay: a war room around the mission table; the far consoles face into the room
    seats: [seat(-1.7, -3.2, 0, "console", -1.4, 0), seat(1.7, -3.2, 0, "console", 1.4, 1), seat(-3.9, -.2, HALF, "console", -1.3, 2), seat(3.9, -.2, -HALF, "console", 1.3, 3)],
    homes: [spot(-.8, -1.4, .59, "use"), spot(.85, -1.35, -.64, "use"), spot(2.9, -4.3, PI, "look"), spot(-1.95, .75, 2.0, "use")],
    visits: [spot(-2.9, -4.3, PI, "look"), spot(-1.15, .75, 2.26, "use"), spot(1.2, .7, -2.2, "talk"), ...doors],
    nodes: [[-3.1, -3.62], [3.1, -3.62], [-2.6, -1.75], [2.6, -1.75], [-2.2, 1.1], [2.2, 1.1], [-4.6, 1.1], [4.6, 1.1], [-1.9, -.3], [1.9, -.3]],
    links: [[0, 2], [2, 8], [8, 4], [4, 5], [5, 9], [9, 3], [3, 1], [4, 6], [5, 7]],
    eye: [1.6, 2.8, 4.7], look: [-.3, .85, -1.5], narrow: [-.2, .9, -1.9], glow: { at: [0, 1.5, -.2], color: "#6fc3ff" },
  },
  { // Company floor: one island of six desks facing in pairs, a galley by the entrance, the server racks
    seats: [seat(-3.4, -2.6, 0, "desk", 1.7, 0), seat(0, -2.6, 0, "desk", 1.7, 1), seat(3.4, -2.6, 0, "desk", -1.7, 2),
      seat(-3.4, -.3, PI, "desk", 1.6, 3), seat(0, -.3, PI, "desk", -1.7, 4), seat(3.4, -.3, PI, "desk", -1.6, 5)],
    homes: [spot(4.7, 3.35, HALF, "use"), spot(4.96, -2.0, HALF, "use")],
    visits: [spot(1.05, .05, -2.76, "point"), spot(1.05, -2.85, -.38, "point"), spot(-1.7, -4.3, PI, "look"), spot(1.7, -4.3, PI, "look"), spot(4.6, 2.35, 1.2, "talk"), ...doors],
    nodes: [[-5, -4.3], [-1.7, -4.3], [1.7, -4.3], [-5, -3.02], [-1.7, -3.02], [1.7, -3.02], [-5, .12], [-1.7, .12], [1.7, .12], [5, .12], [-5, 1.7], [-1.7, 1.7], [1.7, 1.7], [5, 1.7]],
    links: [[0, 1], [1, 2], [10, 11], [11, 12], [12, 13], [0, 3], [3, 6], [6, 10], [1, 4], [4, 7], [7, 11], [2, 5], [5, 8], [8, 12], [9, 13]],
    eye: [-2.2, 2.85, 4.7], look: [.4, .85, -1.5], narrow: [1.7, .95, -2.7], glow: { at: [0, 1.6, -1.4], color: "#8fb2ff" },
  },
  { // Games room: a round game table, a sofa under the live-tables screen, a pinball machine
    seats: [table(135, .85, 0), table(225, -.85, 1), table(315, .85, 2), table(45, -.85, 3),
      seat(-4.83, -3.55, HALF, "sofa", 0), seat(-4.83, -2.7, HALF, "sofa", 0)],
    homes: [spot(4.5, -2.6, HALF, "use"), spot(1.45, -1.4, -HALF, "cheer")],
    visits: [spot(2.4, -4.3, PI, "look"), spot(-2.6, -4.35, PI, "look"), spot(-.5, .9, PI, "cheer"), spot(3.4, -.2, -2.3, "talk"), ...doors],
    nodes: [...ring(TABLE[0], TABLE[1], 3.1, 8), [-5, 0], [5, 0], [-3.5, 2.0], [2.5, 2.0]],
    links: [...chain(0, 7), [7, 0], [8, 6], [9, 2], [10, 7], [10, 8], [11, 1], [11, 9]],
    eye: [2.3, 2.8, 4.5], look: [-.8, .75, -1.7], narrow: [-.6, .8, -1.6], glow: { at: [-.5, 1.4, -1.4], color: "#b49cff" },
  },
  { // Watch room: the watch officer's desk at the window facing the Captain, the wall consoles, the radar
    seats: [seat(1.3, -3.5, 0, "console", 1.3, 0), seat(-4.3, -3.0, -HALF, "console", 1.25, 1), seat(4.3, -2.6, HALF, "console", -1.25, 2),
      seat(-2.2, -1.2, PI - .7, "captain", 0, -1, { y: .14, fixed: true })],
    homes: [spot(-1.0, -4.3, PI, "look"), spot(3.3, -4.3, PI, "look"), spot(-2.0, -2.75, -.13, "talk"), spot(2.7, -.4, -2.2, "look")],
    visits: [spot(-3.5, -2.75, -1.7, "point"), spot(3.4, -1.45, 2.0, "point"), ...doors],
    nodes: [[-.6, -2.0], [2.6, -3.5], [-3.9, -.6], [2.4, -.9], [-3.4, .9], [2.3, .9], [-4.7, .3], [4.7, .3]],
    links: [[0, 3], [1, 3], [2, 4], [3, 5], [4, 5], [2, 6], [6, 4], [3, 7], [7, 5]],
    eye: [-1.4, 2.8, 4.6], look: [.8, .9, -1.9], narrow: [.8, 1.0, -2.8], glow: { at: [0, 1.2, -3.2], color: "#7fd6d0" },
  },
];

/** Each room's slots in order: seats first (screens first among them), then the places frogs stand. */
export const slotsOf = (bay: number) => LAYOUTS[bay]!.seats.length + LAYOUTS[bay]!.homes.length;

/** The shortest lane route between two floor points, through the room's walk graph. */
export function route(layout: Layout, from: XZ, to: XZ): XZ[] {
  const near = (p: XZ) => layout.nodes.reduce((best, n, i) => Math.hypot(n[0] - p[0], n[1] - p[1]) < Math.hypot(layout.nodes[best]![0] - p[0], layout.nodes[best]![1] - p[1]) ? i : best, 0);
  const a = near(from), b = near(to);
  if (Math.hypot(from[0] - to[0], from[1] - to[1]) < Math.hypot(layout.nodes[a]![0] - from[0], layout.nodes[a]![1] - from[1]) + .2) return [to];
  const dist = layout.nodes.map(() => Infinity), prev = layout.nodes.map(() => -1), done = new Set<number>(); dist[a] = 0;
  while (done.size < layout.nodes.length) {
    let u = -1; for (let i = 0; i < dist.length; i++) if (!done.has(i) && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || dist[u] === Infinity || u === b) break; done.add(u);
    for (const [x, y] of layout.links) {
      const v = x === u ? y : y === u ? x : -1; if (v < 0) continue;
      const d = dist[u]! + Math.hypot(layout.nodes[u]![0] - layout.nodes[v]![0], layout.nodes[u]![1] - layout.nodes[v]![1]);
      if (d < dist[v]!) { dist[v] = d; prev[v] = u; }
    }
  }
  const path: XZ[] = [to]; for (let n = b; n >= 0; n = prev[n]!) { path.unshift(layout.nodes[n]!); if (n === a) break; }
  return path;
}
