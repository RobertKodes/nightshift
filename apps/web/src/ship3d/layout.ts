/**
 * The operations deck plan: eight rooms in two rows of four with a corridor between them. Each room is
 * laid out in its own frame (x across the room, -z its outer wall, +z the doorway to the corridor) with
 * its seats, the places a frog stands, the lanes it walks and its accent light. ROOMS places each frame
 * on the deck: the back row looks out through the window wall, the front row is turned to face the
 * corridor. Units are the frog's own (a standing frog is 1.8 tall).
 */
export const BAY_W = 12, ROOM_H = 3.4, HALF_D = 5;
/** The corridor between the rows, and where the front row's rooms are centred. */
export const CORRIDOR = { z0: HALF_D + .15, z1: HALF_D + 3.25 }, FRONT_Z = 2 * HALF_D + 3.4;
export const bayX = (bay: number) => (bay % 4) * BAY_W;

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
/** A room's frame on the deck: its centre and its turn (0 for the back row, PI for the front row). */
export type Room = { x: number; z: number; turn: number };
export const ROOMS: Room[] = Array.from({ length: 8 }, (_, bay) => ({ x: bayX(bay), z: bay < 4 ? 0 : FRONT_Z, turn: bay < 4 ? 0 : Math.PI }));
/** A point in a room's frame to deck coordinates. */
export function toDeck(bay: number, x: number, z: number): XZ {
  const room = ROOMS[bay]!, c = Math.cos(room.turn), s = Math.sin(room.turn);
  return [room.x + x * c + z * s, room.z - x * s + z * c];
}

/** A chair rolls back 0.55 and the frog stands 0.42 behind its seated root; from a sofa it steps forward. */
function seat(x: number, z: number, face: number, kind: Furniture, side: number, screen = -1, extra: Partial<Seat> = {}): Seat {
  const fx = Math.sin(face), fz = Math.cos(face), rise = kind === "sofa" ? .3 : -.42;
  const stand: XZ = [x + fx * rise, z + fz * rise];
  return { at: [x, z], face, kind, stand, exit: [stand[0] + Math.cos(face) * side, stand[1] - Math.sin(face) * side], y: 0, screen, fixed: false, ...extra };
}
const spot = (x: number, z: number, face: number, act: Act): Spot => ({ at: [x, z], face, act });
const PI = Math.PI, HALF = PI / 2;
/** Facing from a point toward another. */
const toward = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
const at = (x: number, z: number, tx: number, tz: number, act: Act) => spot(x, z, toward(x, z, tx, tz), act);
/** The doorways in both side walls, for frogs that look through to the next room. */
const doors = [spot(-5.15, .15, -HALF, "look"), spot(5.15, -.15, HALF, "look")];
const ring = (cx: number, cz: number, r: number, n: number, offset = 0): XZ[] => Array.from({ length: n }, (_, i) => [cx + Math.sin(offset + i / n * PI * 2) * r, cz + Math.cos(offset + i / n * PI * 2) * r] as const);
const chain = (from: number, to: number): [number, number][] => Array.from({ length: to - from }, (_, i) => [from + i, from + i + 1]);
/** A walk grid over a room's free floor, minus the cells under its furniture. */
function grid(xs: number[], zs: number[], blocked: (x: number, z: number) => boolean) {
  const nodes: XZ[] = [], index = new Map<string, number>();
  zs.forEach((z, j) => xs.forEach((x, i) => { if (!blocked(x, z)) { index.set(`${i}:${j}`, nodes.length); nodes.push([x, z]); } }));
  const links: [number, number][] = [];
  zs.forEach((_, j) => xs.forEach((_, i) => {
    const a = index.get(`${i}:${j}`); if (a === undefined) return;
    const r = index.get(`${i + 1}:${j}`), d = index.get(`${i}:${j + 1}`);
    if (r !== undefined) links.push([a, r]); if (d !== undefined) links.push([a, d]);
  }));
  return { nodes, links };
}

const TABLE: XZ = [-.5, -1.4];
const table = (degrees: number, side: number, screen: number) => {
  const a = degrees * PI / 180;
  return seat(TABLE[0] + Math.sin(a) * 1.24, TABLE[1] + Math.cos(a) * 1.24, a + PI, "table", side, screen);
};
const VIEW = { eye: [0, 3, 5] as [number, number, number], look: [0, .8, -1.5] as [number, number, number], narrow: [0, .9, -2] as [number, number, number] };

export const LAYOUTS: Layout[] = [
  { // Mission bay: a war room around the mission table; the far consoles face into the room
    seats: [seat(-1.7, -3.2, 0, "console", -1.4, 0), seat(1.7, -3.2, 0, "console", 1.4, 1), seat(-3.9, -.2, HALF, "console", -1.3, 2), seat(3.9, -.2, -HALF, "console", 1.3, 3)],
    homes: [spot(-.8, -1.4, .59, "use"), spot(.85, -1.35, -.64, "use"), spot(2.9, -4.3, PI, "look"), spot(-1.95, .75, 2.0, "use"),
      at(-4.4, 2.6, 0, -.2, "talk"), at(-2.6, 3.3, 0, -.2, "look"), at(-.9, 3.6, 0, -.2, "point"), at(.9, 3.6, 0, -.2, "look"), at(2.6, 3.3, 0, -.2, "talk"), at(4.4, 2.6, 0, -.2, "use"),
      at(-4.6, -3.7, -1.7, -3.2, "talk"), at(4.6, -3.7, 1.7, -3.2, "look")],
    visits: [spot(-2.9, -4.3, PI, "look"), spot(-1.15, .75, 2.26, "use"), spot(1.2, .7, -2.2, "talk"), ...doors],
    nodes: [[-3.1, -3.62], [3.1, -3.62], [-2.6, -1.75], [2.6, -1.75], [-2.2, 1.1], [2.2, 1.1], [-4.6, 1.1], [4.6, 1.1], [-1.9, -.3], [1.9, -.3], [-3.4, 2.9], [3.4, 2.9], [0, 2.9]],
    links: [[0, 2], [2, 8], [8, 4], [4, 5], [5, 9], [9, 3], [3, 1], [4, 6], [5, 7], [6, 10], [10, 12], [12, 11], [11, 7], [4, 12], [5, 12]],
    eye: [1.6, 2.8, 4.7], look: [-.3, .85, -1.5], narrow: [-.2, .9, -1.9], glow: { at: [0, 1.5, -.2], color: "#6fc3ff" },
  },
  { // Company floor: an island of six desks facing in pairs, a row of four facing the room, a galley by the entrance, the server racks
    seats: [seat(-3.4, -2.6, 0, "desk", 1.7, 0), seat(0, -2.6, 0, "desk", 1.7, 1), seat(3.4, -2.6, 0, "desk", -1.7, 2),
      seat(-3.4, -.3, PI, "desk", 1.6, 3), seat(0, -.3, PI, "desk", -1.7, 4), seat(3.4, -.3, PI, "desk", -1.6, 5),
      seat(-3.8, 2.15, 0, "desk", 1.2, 6), seat(-1.4, 2.15, 0, "desk", 1.4, 7), seat(1.4, 2.15, 0, "desk", -1.4, 6), seat(3.8, 2.15, 0, "desk", -1.2, 7)],
    homes: [spot(4.75, 3.95, HALF, "use"), spot(4.96, -2.0, HALF, "use"),
      at(-1.7, -3.95, -1.7, -2.0, "talk"), at(1.7, -3.95, 1.7, -2.0, "point"), at(-5.0, -3.9, -3.4, -2.6, "use"), at(-5.1, .95, -3.4, -.3, "talk")],
    visits: [spot(1.05, .05, -2.76, "point"), spot(1.05, -2.85, -.38, "point"), spot(0, -4.4, PI, "look"), spot(4.9, 1.0, 1.2, "talk"), ...doors],
    nodes: [[-5, -4.3], [-1.7, -4.3], [1.7, -4.3], [-5, -3.02], [-1.7, -3.02], [1.7, -3.02], [-5, .95], [-1.7, .95], [1.7, .95], [5, .95], [0, .95], [0, 4.3]],
    links: [[0, 1], [1, 2], [0, 3], [3, 6], [1, 4], [4, 7], [2, 5], [5, 8], [6, 7], [7, 10], [10, 8], [8, 9], [10, 11]],
    eye: [-2.2, 2.85, 4.7], look: [.4, .85, -1.5], narrow: [1.7, .95, -2.7], glow: { at: [0, 1.6, -1.4], color: "#8fb2ff" },
  },
  { // Games room: a round game table, a sofa under the live-tables screen, a pinball machine
    seats: [table(135, .85, 0), table(225, -.85, 1), table(315, .85, 2), table(45, -.85, 3),
      seat(-4.83, -3.55, HALF, "sofa", 0), seat(-4.83, -2.7, HALF, "sofa", 0)],
    homes: [spot(4.5, -2.6, HALF, "use"), spot(1.45, -1.4, -HALF, "cheer"),
      at(-2.7, -.1, ...TABLE, "cheer"), at(1.4, .3, ...TABLE, "cheer"), at(-.5, 1.0, ...TABLE, "look"), at(3.8, -1.0, 5.2, -2.6, "cheer"),
      at(-3.6, 2.4, -1.6, 3, "talk"), at(-1.6, 3.0, -3.6, 2.4, "talk"), at(1.6, 3.0, 3.6, 2.4, "talk"), at(3.6, 2.4, 1.6, 3, "talk")],
    visits: [spot(2.4, -4.3, PI, "look"), spot(-2.6, -4.35, PI, "look"), spot(-.5, .9, PI, "cheer"), spot(3.4, -.2, -2.3, "talk"), ...doors],
    nodes: [...ring(TABLE[0], TABLE[1], 3.1, 8), [-5, 0], [5, 0], [-3.5, 2.0], [2.5, 2.0]],
    links: [...chain(0, 7), [7, 0], [8, 6], [9, 2], [10, 7], [10, 8], [11, 1], [11, 9]],
    eye: [2.3, 2.8, 4.5], look: [-.8, .75, -1.7], narrow: [-.6, .8, -1.6], glow: { at: [-.5, 1.4, -1.4], color: "#b49cff" },
  },
  { // Watch room: the watch officer's desk at the window facing the Captain, the wall consoles, the radar
    seats: [seat(1.3, -3.5, 0, "console", 1.3, 0), seat(-4.3, -3.0, -HALF, "console", 1.25, 1), seat(4.3, -2.6, HALF, "console", -1.25, 2),
      seat(-2.2, -1.2, PI - .7, "captain", 0, -1, { y: .14, fixed: true })],
    homes: [spot(-1.0, -4.3, PI, "look"), spot(3.3, -4.3, PI, "look"), spot(-2.0, -2.75, -.13, "talk"), spot(2.7, -.4, -2.2, "look"),
      at(-4.6, 2.0, -2.2, -1.2, "look"), at(-2.9, 2.9, -2.2, -1.2, "talk"), at(-1.0, 3.3, -2.2, -1.2, "look"), at(1.0, 3.3, 1.3, -3.5, "point"), at(2.9, 2.9, 4.3, -2.6, "look"), at(4.6, 2.0, 4.3, -2.6, "use"),
      at(.4, -.9, -2.2, -1.2, "talk"), at(3.9, .9, 5.3, -2.6, "point")],
    visits: [spot(-3.5, -2.75, -1.7, "point"), spot(3.4, -1.45, 2.0, "point"), ...doors],
    nodes: [[-.6, -2.0], [2.6, -3.5], [-3.9, -.6], [2.4, -.9], [-3.4, .9], [2.3, .9], [-4.7, .3], [4.7, .3], [-2.2, 2.6], [1.8, 2.6]],
    links: [[0, 3], [1, 3], [2, 4], [3, 5], [4, 5], [2, 6], [6, 4], [3, 7], [7, 5], [4, 8], [8, 9], [9, 5]],
    eye: [-1.4, 2.8, 4.6], look: [.8, .9, -1.9], narrow: [.8, 1.0, -2.8], glow: { at: [0, 1.2, -3.2], color: "#7fd6d0" },
  },
  // ---- the front row (each in its own frame: -z is the outer hull wall, +z the corridor door)
  (() => { // Crew bay: the house crews' stations along the hull wall, and the wardroom table where the quarters crew gathers
    const g = grid([-4.6, -2.3, 0, 2.3, 4.6], [-1.4, .7, 2.8, 4.2], (x, z) => Math.abs(x) < 1.6 && z > .2 && z < 3.2);
    return {
      seats: [seat(-4.4, -2.9, PI, "console", 1.2, 0), seat(-3.0, -2.9, PI, "console", -1.2, 1), seat(-.7, -2.9, PI, "desk", 1.4, 2), seat(.7, -2.9, PI, "desk", -1.4, 3), seat(3.0, -2.9, PI, "console", 1.2, 4), seat(4.4, -2.9, PI, "console", -1.2, 5)],
      homes: [at(-1.9, 1.7, 0, 1.7, "talk"), at(1.9, 1.7, 0, 1.7, "talk"), at(0, .1, 0, 1.7, "look"), at(0, 3.3, 0, 1.7, "talk"), at(-1.2, .6, 0, 1.7, "talk"), at(1.2, 2.8, 0, 1.7, "talk"),
        at(-4.6, 1.0, -3.7, -3.6, "look"), at(4.6, 1.0, 3.7, -3.6, "look"), at(-4.2, 3.6, -5.5, 3.6, "use"), at(4.2, 3.6, 5.5, 3.6, "use")],
      visits: [spot(-3.7, -1.6, PI, "look"), spot(0, -1.6, PI, "point"), spot(3.7, -1.6, PI, "look"), ...doors],
      ...g, ...VIEW, glow: { at: [0, 1.2, -3.4], color: "#ffb86b" },
    };
  })(),
  (() => { // Swarm uplink: the dish on its platform in the middle, consoles around it, terminals on the walls
    const g = grid([-4.6, -2.6, 0, 2.6, 4.6], [-3.8, -1.6, .8, 3.0, 4.2], (x, z) => Math.hypot(x, z + .4) < 2.2);
    return {
      seats: [seat(-2.6, -2.6, toward(-2.6, -2.6, 0, -.4), "console", -1, 0), seat(2.6, -2.6, toward(2.6, -2.6, 0, -.4), "console", 1, 1), seat(-2.6, 2.0, toward(-2.6, 2.0, 0, -.4), "console", -1, 2), seat(2.6, 2.0, toward(2.6, 2.0, 0, -.4), "console", 1, 3)],
      homes: [at(-5.0, -3.0, -6, -3, "use"), at(-5.0, -.8, -6, -.8, "use"), at(5.0, -3.0, 6, -3, "use"), at(5.0, -.8, 6, -.8, "use"), at(0, -3.6, 0, -.4, "look"), at(0, 3.4, 0, -.4, "point"), at(-4.4, 2.8, 0, -.4, "look"), at(4.4, 2.8, 0, -.4, "look")],
      visits: [spot(-2.2, -.4, HALF, "look"), spot(2.2, -.4, -HALF, "look"), ...doors],
      ...g, ...VIEW, glow: { at: [0, 1.6, -.4], color: "#38d2ff" },
    };
  })(),
  (() => { // Engine room: the $SHIFT reactor in the middle, control consoles on the hull wall, engineers around the core
    const g = grid([-4.6, -2.4, 0, 2.4, 4.6], [-1.6, .2, 2.2, 4.0], (x, z) => Math.hypot(x, z + .6) < 2.0);
    return {
      seats: [seat(-3.6, -3.4, PI, "console", 1.2, 0), seat(-1.6, -3.4, PI, "console", -1.2, 1), seat(1.6, -3.4, PI, "console", 1.2, 2), seat(3.6, -3.4, PI, "console", -1.2, 3)],
      homes: [...ring(0, -.6, 2.35, 8, .4).map(([x, z]) => at(x, z, 0, -.6, x > 0 ? "use" : "look")), at(-4.8, 1.0, -6, 1, "use"), at(4.8, 1.0, 6, 1, "use"), at(-4.8, 3.2, -6, 3.2, "use"), at(4.8, 3.2, 6, 3.2, "use"),
        at(-2.6, 3.4, 0, -.6, "talk"), at(2.6, 3.4, 0, -.6, "talk"), at(0, 4.0, 0, -.6, "look"), at(-1.3, 2.6, 0, -.6, "point")],
      visits: [spot(0, 2.0, PI, "look"), ...doors],
      ...g, ...VIEW, glow: { at: [0, 1.4, -.6], color: "#ff7a3d" },
    };
  })(),
  (() => { // Hangar: four launch pads, a flight-control console, the deck crew around the shuttles
    const g = grid([-4.6, -2.0, 0, 2.0, 4.6], [-3.9, -1.0, 1.6, 4.1], (x, z) => (Math.abs(Math.abs(x) - 2.6) < 1.3 && (Math.abs(z + 2.3) < 1.3 || Math.abs(z - 1.5) < 1.3)));
    return {
      seats: [seat(-1.0, 3.6, PI, "console", -1.2, 0), seat(1.0, 3.6, PI, "console", 1.2, 1)],
      homes: [at(-4.4, -2.3, -2.6, -2.3, "use"), at(-.8, -2.3, -2.6, -2.3, "point"), at(.8, -2.3, 2.6, -2.3, "use"), at(4.4, -2.3, 2.6, -2.3, "point"),
        at(-4.4, 1.5, -2.6, 1.5, "use"), at(-.8, 1.5, -2.6, 1.5, "look"), at(.8, 1.5, 2.6, 1.5, "look"), at(4.4, 1.5, 2.6, 1.5, "use"),
        at(-2.6, -.4, -2.6, -2.3, "talk"), at(2.6, -.4, 2.6, 1.5, "talk"), at(-4.8, 3.8, -2.6, 1.5, "look"), at(4.8, 3.8, 2.6, 1.5, "look")],
      visits: [spot(0, -.4, PI, "look"), ...doors],
      ...g, ...VIEW, glow: { at: [0, 1.4, -.4], color: "#b8ff4a" },
    };
  })(),
];

/** Each room's slots in order: seats first (screens first among them), then the places frogs stand. */
export const slotsOf = (bay: number) => LAYOUTS[bay]!.seats.length + LAYOUTS[bay]!.homes.length;

/** The shortest lane route between two floor points, through the room's walk graph. */
export function route(layout: Layout, from: XZ, to: XZ): XZ[] {
  if (!layout.nodes.length) return [to];
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
