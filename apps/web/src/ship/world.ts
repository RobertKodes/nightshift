import type { Station } from "./types";

/**
 * The ship's plan. One deck, 32 × 88 tiles, bow at y = 0 (up-right on screen) and the engines at the stern:
 *   bridge (raised) · captain's quarters | company offices · breakroom | mission bay · engine room (shift floor)
 *   · forge | drive. Every seat is placed here; a frog takes the seat its station and number give it.
 */
export const W = 32, L = 88;
export const WALL = 3.6;

export type RoomKey = Station | "drive";
export type Room = { key: RoomKey; x0: number; y0: number; x1: number; y1: number; z: number; accent: string; floor: string; label: [number, number] };
const Y = { bridge: 20, a: 36, b: 54, engine: 76 } as const;
export const ROOMS: Room[] = [
  { key: "bridge", x0: 0, y0: 0, x1: W, y1: Y.bridge, z: 0.5, accent: "#4ad8ff", floor: "#0f1830", label: [16, 10.5] },
  { key: "quarters", x0: 0, y0: Y.bridge, x1: 15, y1: Y.a, z: 0, accent: "#ffc46b", floor: "#1a1322", label: [7.5, 28] },
  { key: "offices", x0: 15, y0: Y.bridge, x1: W, y1: Y.a, z: 0, accent: "#a98bff", floor: "#141228", label: [23.5, 28] },
  { key: "breakroom", x0: 0, y0: Y.a, x1: 16, y1: Y.b, z: 0, accent: "#ff5ca8", floor: "#1a1026", label: [8, 45] },
  { key: "missions", x0: 16, y0: Y.a, x1: W, y1: Y.b, z: 0, accent: "#b8ff4a", floor: "#101a1e", label: [24, 45] },
  { key: "engine", x0: 0, y0: Y.b, x1: W, y1: Y.engine, z: 0, accent: "#ffb547", floor: "#141220", label: [16, 65] },
  { key: "forge", x0: 0, y0: Y.engine, x1: 16, y1: L, z: 0, accent: "#ff7a3d", floor: "#1c1016", label: [8, 82] },
  { key: "drive", x0: 16, y0: Y.engine, x1: W, y1: L, z: 0, accent: "#8b6cff", floor: "#110f22", label: [24, 82] },
];
export const room = (k: RoomKey) => ROOMS.find((r) => r.key === k)!;
/** The bow's two cut corners (port-bow faces the camera; starboard-bow is seen edge on). */
export const CHAMFER = 5;
export const RADAR = { x: 16, y: 10.5, r: 2.5 } as const;
export const REACTOR = { x: 16, y: 65, r: 3 } as const;
export const FURNACE = { x: 8.5, y: 81.5 } as const;

export type SeatKind = "console" | "watch" | "throne" | "officer" | "plinth" | "desk" | "bar" | "table" | "bench" | "control" | "pod" | "station" | "anvil";
export type Seat = { i: number; x: number; y: number; z: number; kind: SeatKind; room: RoomKey; tag?: string };

const seats: Seat[] = [];
const add = (room: RoomKey, kind: SeatKind, x: number, y: number, tag?: string) => { seats.push({ i: seats.length, x, y, z: room === "bridge" ? 0.5 : 0, kind, room, tag }); };
/** n seats from (x, y), each step (dx, dy). */
const row = (room: RoomKey, kind: SeatKind, x: number, y: number, dx: number, dy: number, n: number) => { for (let k = 0; k < n; k++) add(room, kind, x + dx * k, y + dy * k); };
/** n seats on an arc round (cx, cy), from `a0` to `a1` degrees (0 = +x, 90 = +y). */
const arc = (room: RoomKey, kind: SeatKind, cx: number, cy: number, r: number, a0: number, a1: number, n: number) => {
  for (let k = 0; k < n; k++) { const a = ((a0 + ((a1 - a0) * (k + 0.5)) / n) * Math.PI) / 180; add(room, kind, cx + r * Math.cos(a), cy + r * Math.sin(a)); }
};

// ---- the bridge: the Captain's chair at the top, the Night Watch's 46 seats in three arcs round the radar, the crew at the windows
add("bridge", "throne", 8.6, 4.2, "captain");
// the camera looks along (-1,-1): the arcs open toward it so the radar stays in view
arc("bridge", "watch", RADAR.x, RADAR.y, 4.1, 128, 322, 10);
arc("bridge", "watch", RADAR.x, RADAR.y, 5.6, 122, 328, 16);
arc("bridge", "watch", RADAR.x, RADAR.y, 7.1, 118, 332, 20);
export const WATCH_SEATS = 46;
row("bridge", "console", 9.8, 1.5, 1.38, 0, 13);
row("bridge", "console", 19.7, 3.0, 1.38, 0, 7);
row("bridge", "console", 2.7, 5.1, 1, -1, 3);
row("bridge", "console", 1.6, 7.2, 0, 1.3, 9);
row("bridge", "console", 3.4, 7.8, 0, 1.3, 8);
row("bridge", "console", 28.8, 7.0, 0, 1.3, 9);
row("bridge", "console", 30.6, 7.6, 0, 1.3, 8);
row("bridge", "console", 5.4, 18.9, 1.38, 0, 5);
row("bridge", "console", 21.2, 18.9, 1.38, 0, 5);

// ---- captain's quarters: four Night Boss plinths at the wall, the wardroom table, the officers' armchairs
for (let k = 0; k < 4; k++) add("quarters", "plinth", 1.9, 22.6 + k * 3.4, "boss");
row("quarters", "officer", 4.4, 21.4, 0, 1.38, 9);
row("quarters", "table", 6.6, 21.4, 0, 1.38, 9);
row("quarters", "officer", 9.6, 21.4, 0, 1.38, 9);
row("quarters", "officer", 12.6, 21.4, 0, 1.38, 9);
row("quarters", "officer", 3.3, 34.4, 1.15, 0, 10);

// ---- company offices: five rows of desks
for (let c = 0; c < 5; c++) row("offices", "desk", 17.2 + c * 2.95, 21.4, 0, 1.36, 10);

// ---- breakroom: the coffee bar at the wall, three long tables with crew on both sides
row("breakroom", "bar", 1.7, 37.6, 0, 1.36, 12);
for (let t = 0; t < 3; t++) { row("breakroom", "table", 5.6 + t * 3.6, 37.5, 0, 1.3, 12); row("breakroom", "bench", 7.3 + t * 3.6, 37.5, 0, 1.3, 12); }

// ---- mission bay: seven rows of mission control, the launch pods at the hangar door
for (let c = 0; c < 7; c++) row("missions", "control", 17.6 + c * 1.72, 37.6, 0, 1.36, 12);
row("missions", "pod", 30.6, 37.8, 0, 1.45, 11);

// ---- engine room: the shift floor in rows round the reactor
for (const x of [1.8, 3.9, 6.0, 8.1, 23.9, 26.0, 28.1, 30.2]) row("engine", "station", x, 56.0, 0, 1.32, 15);
for (const x of [10.4, 21.6]) { row("engine", "station", x, 56.0, 0, 1.32, 4); row("engine", "station", x, 70.5, 0, 1.32, 4); }

// ---- the forge: benches round the furnace
for (const x of [1.8, 3.6, 13.0, 14.7]) row("forge", "anvil", x, 78.0, 0, 1.3, 7);
row("forge", "anvil", 5.6, 77.8, 1.25, 0, 6);
row("forge", "anvil", 5.9, 79.6, 0, 1.3, 4);
row("forge", "anvil", 11.0, 79.6, 0, 1.3, 4);

export const SEATS: readonly Seat[] = seats;
/** The seats of each station's crew, in order: frog k of a station (by number) takes seat k. */
export const CREW_SEATS: Record<Station, Seat[]> = {
  bridge: seats.filter((s) => s.room === "bridge" && s.kind === "console"),
  quarters: seats.filter((s) => s.room === "quarters" && s.kind !== "plinth"),
  offices: seats.filter((s) => s.room === "offices"),
  breakroom: seats.filter((s) => s.room === "breakroom"),
  missions: seats.filter((s) => s.room === "missions" && s.kind === "control"),
  engine: seats.filter((s) => s.room === "engine"),
  forge: seats.filter((s) => s.room === "forge"),
};
export const THRONE = seats.find((s) => s.kind === "throne")!;
export const WATCH = seats.filter((s) => s.kind === "watch");
export const PLINTHS = seats.filter((s) => s.kind === "plinth");
export const PODS = seats.filter((s) => s.kind === "pod");
