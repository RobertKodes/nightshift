import * as THREE from "three";
import { GeometryBatch } from "../station3d/geometry";
import type { DeckExtra } from "./data";
import { BAY_W, CORRIDOR, HALF_D, LAYOUTS, ROOMS, ROOM_H, bayX, toDeck, type Seat } from "./layout";
import { cables, crate, plant, poolTexture } from "./props";
import { painted } from "./surfaces";
import { ROOM_GLOW, toon } from "./toon";

/*
 * The deck's front row: the Crew bay, the Swarm uplink, the Engine room and the Hangar, plus the corridor
 * that joins the two rows. Bulk geometry is merged in deck coordinates by material; the live pieces
 * (screens, the reactor, the dish, the shuttles) sit in each room's own frame.
 */
const MONO = "ui-monospace, Consolas, monospace", SANS = "system-ui, 'Segoe UI', sans-serif";
const DARK = "#2b2446", DARKER = "#17132a", STEEL = "#463d6e", BLACK = "#0a0814";
const FRONT = [4, 5, 6, 7];

type Canvas = { canvas: HTMLCanvasElement; map: THREE.CanvasTexture; c: CanvasRenderingContext2D | null };
function canvasTexture(width: number, height: number): Canvas {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  return { canvas, map, c: canvas.getContext("2d") };
}
const short = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`;
const ago = (at: number) => { const m = Math.max(0, (Date.now() - at) / 60000); return m < 60 ? `${Math.round(m)} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

export type Annex = ReturnType<typeof createAnnex>;
export function createAnnex(onTexture: () => void) {
  const group = new THREE.Group();
  const B = { wall: new GeometryBatch(), floor: new GeometryBatch(), desks: new GeometryBatch(), metal: new GeometryBatch(), fabric: new GeometryBatch(), rack: new GeometryBatch(), warm: new GeometryBatch(), accent: new GeometryBatch(), amber: new GeometryBatch(), props: new GeometryBatch() };
  /** Adds a part given in a room's frame (x, y, z, turn) to a deck-space batch. */
  const put = (batch: GeometryBatch, bay: number, g: THREE.BufferGeometry, x: number, y: number, z: number, turn = 0, tint: THREE.ColorRepresentation = 0xffffff) => {
    const [dx, dz] = toDeck(bay, x, z); batch.add(g, dx, y, dz, turn + ROOMS[bay]!.turn, tint);
  };
  const box = (batch: GeometryBatch, bay: number, w: number, h: number, d: number, x: number, y: number, z: number, tint?: THREE.ColorRepresentation, turn = 0) => put(batch, bay, new THREE.BoxGeometry(w, h, d), x, y, z, turn, tint);
  const cyl = (batch: GeometryBatch, bay: number, r0: number, r1: number, h: number, x: number, y: number, z: number, tint?: THREE.ColorRepresentation, seg = 24) => put(batch, bay, new THREE.CylinderGeometry(r0, r1, h, seg), x, y, z, 0, tint);
  const frames = FRONT.map((bay) => { const f = new THREE.Group(); f.position.set(ROOMS[bay]!.x, 0, ROOMS[bay]!.z); f.rotation.y = ROOMS[bay]!.turn; group.add(f); return f; });
  const frame = (bay: number) => frames[bay - 4]!;

  // ---- shell: floors, walls with doorways, base light strips; the corridor between the rows
  for (const bay of FRONT) {
    box(B.floor, bay, BAY_W, .1, 2 * HALF_D, 0, -.05, 0);
    box(B.wall, bay, BAY_W, ROOM_H, .3, 0, ROOM_H / 2, -HALF_D, DARK);
    for (const s of [-1, 1]) box(B.wall, bay, BAY_W / 2 - 1.05, ROOM_H, .3, s * (BAY_W / 4 + .525), ROOM_H / 2, HALF_D, DARK);
    box(B.wall, bay, 2.1, ROOM_H - 2.5, .3, 0, 2.5 + (ROOM_H - 2.5) / 2, HALF_D, DARKER);
    box(B.metal, bay, 2.1, 2.5, .12, 0, 1.25, HALF_D - .05);
    // the room's left wall on the deck (its +x side, as the row is turned); the last room closes the row
    const sides = bay === 7 ? [1, -1] : [1];
    for (const s of sides) {
      for (const z of [-1, 1]) box(B.wall, bay, .3, ROOM_H, HALF_D - .9, s * BAY_W / 2, ROOM_H / 2, z * (HALF_D + .9) / 2, DARK);
      box(B.wall, bay, .3, ROOM_H - 2.4, 1.8, s * BAY_W / 2, 2.4 + (ROOM_H - 2.4) / 2, 0, DARKER);
    }
    for (const s of [-1, 1]) box(B.warm, bay, .07, .03, 2 * HALF_D - .6, s * (BAY_W / 2 - .22), .06, 0);
    box(B.warm, bay, BAY_W - .5, .03, .07, 0, .06, -HALF_D + .22);
    for (const s of [-1, 1]) box(B.warm, bay, BAY_W / 2 - 1.5, .03, .07, s * (BAY_W / 4 + .55), .06, HALF_D - .22);
  }
  const X0 = bayX(0) - BAY_W / 2, X1 = bayX(3) + BAY_W / 2, CZ = (CORRIDOR.z0 + CORRIDOR.z1) / 2, CD = CORRIDOR.z1 - CORRIDOR.z0;
  B.floor.add(new THREE.BoxGeometry(X1 - X0, .1, CD + .3), (X0 + X1) / 2, -.05, CZ);
  B.warm.add(new THREE.BoxGeometry(X1 - X0 - .4, .03, .12), (X0 + X1) / 2, .02, CZ);
  for (const z of [CORRIDOR.z0 + .25, CORRIDOR.z1 - .25]) B.accent.add(new THREE.BoxGeometry(X1 - X0 - .4, .025, .06), (X0 + X1) / 2, .03, z, 0, "#5a3dff");
  for (const s of [-1, 1]) B.wall.add(new THREE.BoxGeometry(.3, ROOM_H, CD + .3), s < 0 ? X0 : X1, ROOM_H / 2, CZ, 0, DARK);

  // ---- screens: one canvas per room, split into regions
  const screens = FRONT.map(() => canvasTexture(1024, 512));
  const screen = (bay: number, region: number, w: number, h: number, x: number, y: number, z: number, turn = 0, tilt = 0) => {
    const g = new THREE.PlaneGeometry(w, h), uv = g.getAttribute("uv"), col = region % 2, row = region >> 1;
    for (let n = 0; n < uv.count; n++) uv.setXY(n, (col + uv.getX(n)) / 2, 1 - (row + 1 - uv.getY(n)) / 2);
    const mesh = new THREE.Mesh(g, materials.screens[bay - 4]!); mesh.position.set(x, y, z); mesh.rotation.set(tilt, turn, 0, "YXZ"); frame(bay).add(mesh); return mesh;
  };
  const materials = {
    screens: screens.map((s, i) => new THREE.MeshBasicMaterial({ map: s.map, color: new THREE.Color(ROOM_GLOW[4 + i]!).lerp(new THREE.Color(1, 1, 1), .55).multiplyScalar(1.6) })),
  };
  /** A console in a seat's frame, with its screen raked toward the frog. */
  const consoleAt = (bay: number, s: Seat, region: number) => {
    const fx = Math.sin(s.face), fz = Math.cos(s.face), ax = s.at[0] + fx * .62, az = s.at[1] + fz * .62;
    put(B.desks, bay, new THREE.BoxGeometry(1.5, .7, .6), ax, .35, az, s.face, DARK);
    put(B.accent, bay, new THREE.BoxGeometry(1.55, .025, .05), s.at[0] + fx * .3, .76, s.at[1] + fz * .3, s.face, ROOM_GLOW[bay]!);
    screen(bay, region, 1.3, .5, s.at[0] + fx * .86, 1.02, s.at[1] + fz * .86, s.face + Math.PI, -.5);
  };
  const deskAt = (bay: number, s: Seat, region: number) => {
    const fx = Math.sin(s.face), fz = Math.cos(s.face);
    put(B.desks, bay, new THREE.BoxGeometry(1.5, .74, .8), s.at[0] + fx * .64, .37, s.at[1] + fz * .64, s.face, DARK);
    put(B.accent, bay, new THREE.BoxGeometry(1.55, .025, .05), s.at[0] + fx * .25, .76, s.at[1] + fz * .25, s.face, ROOM_GLOW[bay]!);
    screen(bay, region, .9, .5, s.at[0] + fx * .92, 1.1, s.at[1] + fz * .92, s.face + Math.PI);
  };

  // ---- Crew bay: Watchtower, Research Desk and Build & Check along the hull wall; the wardroom table and bunks
  {
    const bay = 4, L = LAYOUTS[bay]!;
    L.seats.forEach((s, i) => (s.kind === "desk" ? deskAt : consoleAt)(bay, s, Math.min(3, i >> 1)));
    // Watchtower: a scope mast; Research Desk: book stacks; Build & Check: a workbench with a tool arm
    cyl(B.metal, bay, .25, .35, 1.4, -3.7, .7, -4.3); put(B.metal, bay, new THREE.SphereGeometry(.45, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), -3.7, 1.35, -4.3, 0);
    for (let k = 0; k < 6; k++) box(B.fabric, bay, .32, .12 + (k % 3) * .04, .24, -.9 + (k % 3) * .55, .82 + (k >> 1) * .13, -4.45, ["#6d3a8a", "#2f5a8a", "#8a5a2f"][k % 3]);
    box(B.desks, bay, 2.6, .8, .9, 3.7, .4, -4.35, DARK); cyl(B.metal, bay, .07, .09, .9, 4.6, 1.2, -4.4); put(B.metal, bay, new THREE.BoxGeometry(.08, .08, .8), 4.6, 1.65, -4.0, .5);
    // the wardroom: a round table, and bunks along both side walls for the quarters crew
    cyl(B.desks, bay, 1.15, 1.15, .06, 0, .76, 1.7, STEEL, 40); cyl(B.desks, bay, .18, .26, .74, 0, .37, 1.7, DARK, 12);
    put(B.accent, bay, (() => { const t = new THREE.TorusGeometry(1.15, .02, 6, 48); t.rotateX(Math.PI / 2); return t; })(), 0, .79, 1.7, 0, ROOM_GLOW[bay]!);
    for (const s of [-1, 1]) for (const z of [.9, 3.1]) { box(B.fabric, bay, .9, .35, 2.0, s * 5.35, .35, z, "#3b2c63"); box(B.fabric, bay, .9, .35, 2.0, s * 5.35, 1.35, z, "#3b2c63"); box(B.metal, bay, .06, 1.8, .06, s * 4.92, .9, z - 1); }
    for (const z of [-2.0, -1.0]) box(B.rack, bay, .5, 1.2, .8, -5.65, .6, z, BLACK);
  }
  const crewStations = [{ id: "watchtower", x: -3.7 }, { id: "research", x: 0 }, { id: "buildcheck", x: 3.7 }];
  const jobCubes = new THREE.InstancedMesh(new THREE.BoxGeometry(.16, .16, .16), new THREE.MeshBasicMaterial({ color: new THREE.Color(ROOM_GLOW[4]!).multiplyScalar(2.2) }), 24);
  jobCubes.count = 0; jobCubes.frustumCulled = false; frame(4).add(jobCubes);

  // ---- Swarm uplink: the dish on its platform, consoles around it, wall terminals
  const dish = new THREE.Group(); dish.userData.noClip = true; dish.position.set(0, 0, -.4); frame(5).add(dish);
  {
    const bay = 5, L = LAYOUTS[bay]!;
    L.seats.forEach((s, i) => consoleAt(bay, s, i));
    cyl(B.desks, bay, 1.9, 2.05, .32, 0, .16, -.4, DARK, 40);
    put(B.accent, bay, (() => { const t = new THREE.TorusGeometry(1.95, .03, 6, 56); t.rotateX(Math.PI / 2); return t; })(), 0, .33, -.4, 0, ROOM_GLOW[bay]!);
    for (const s of [-1, 1]) for (const z of [-3.0, -.8]) { box(B.desks, bay, .35, 1.3, 1.2, s * 5.7, .65, z, DARK); box(B.accent, bay, .04, .5, .9, s * 5.5, 1.0, z, ROOM_GLOW[bay]!); }
    for (const z of [2.2, 3.6]) box(B.rack, bay, .5, 1.25, 1.0, -5.65, .62, z, BLACK);
  }
  const dishMaterial = toon({ color: "#6f6799" }), dishGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(ROOM_GLOW[5]!).multiplyScalar(2.4) });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.18, .3, 1.6, 12), dishMaterial); mast.position.y = 1.1; dish.add(mast);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(1.45, 28, 10, 0, Math.PI * 2, 0, Math.PI / 3.2), dishMaterial); bowl.material.side = THREE.DoubleSide;
  const bowlTurn = new THREE.Group(); bowlTurn.position.y = 2.15; bowlTurn.add(bowl); bowl.rotation.x = Math.PI; bowl.position.y = 1.3; dish.add(bowlTurn);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 1.1, 6), dishMaterial); feed.position.y = .55; bowlTurn.add(feed);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.12, 12, 8), dishGlow); beacon.position.y = 1.15; bowlTurn.add(beacon);
  bowlTurn.rotation.z = .35;

  // ---- Engine room: the $SHIFT reactor, its staked gauge, fee pipes, control consoles
  const reactor = new THREE.Group(); reactor.userData.noClip = true; reactor.position.set(0, 0, -.6); frame(6).add(reactor);
  {
    const bay = 6, L = LAYOUTS[bay]!;
    L.seats.forEach((s, i) => consoleAt(bay, s, i));
    cyl(B.desks, bay, 1.6, 1.75, .5, 0, .25, -.6, DARK, 40); cyl(B.metal, bay, 1.25, 1.25, .12, 0, .56, -.6, undefined, 40);
    // fee pipes from the hull walls into the core
    for (const [x, z, turn, len] of [[-3.6, -.6, Math.PI / 2, 4.0], [3.6, -.6, Math.PI / 2, 4.0], [0, 2.6, 0, 3.4]] as const) {
      const pipe = new THREE.CylinderGeometry(.16, .16, len, 12); pipe.rotateX(Math.PI / 2); put(B.metal, bay, pipe, x, .55, z, turn);
    }
    for (const s of [-1, 1]) for (const z of [1.0, 3.2]) box(B.rack, bay, .5, 1.3, 1.1, s * 5.65, .65, z, BLACK);
  }
  const coreMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff8a3d").multiplyScalar(1.6), transparent: true, opacity: .85 });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(.62, .62, 2.3, 28, 1, true), coreMaterial); core.position.y = 1.75; reactor.add(core);
  const coreInner = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, 2.3, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd27a").multiplyScalar(2.2) })); coreInner.position.y = 1.75; reactor.add(coreInner);
  const shell = toon({ color: "#4a4078" });
  for (const y of [.75, 1.75, 2.85]) { const r = new THREE.Mesh(new THREE.TorusGeometry(.78, .09, 8, 32), shell); r.rotation.x = Math.PI / 2; r.position.y = y; reactor.add(r); }
  // a low dark cap with a glowing vent ring, so the core reads as lit from inside
  const capMaterial = toon({ color: "#2b2446" }), vent = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff8a3d").multiplyScalar(2.2) });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.66, .86, .22, 28), capMaterial); cap.position.y = 3.0; reactor.add(cap);
  const ventRing = new THREE.Mesh(new THREE.TorusGeometry(.5, .035, 6, 32), vent); ventRing.rotation.x = Math.PI / 2; ventRing.position.y = 3.12; reactor.add(ventRing);
  for (let k = 0; k < 6; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(.08, .5, .26), capMaterial); const a = k / 6 * Math.PI * 2; fin.position.set(Math.cos(a) * .82, 2.75, Math.sin(a) * .82); fin.rotation.y = -a; reactor.add(fin); }
  const gaugeMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#c9c2ff").multiplyScalar(2.2), side: THREE.DoubleSide });
  const gauge = new THREE.Mesh(new THREE.RingGeometry(1.32, 1.5, 64, 1, Math.PI / 2, .001), gaugeMaterial); gauge.rotation.x = -Math.PI / 2; gauge.position.y = .63; reactor.add(gauge);
  const pipeGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff8a3d").multiplyScalar(1.8) });
  for (const [x, z, turn, len] of [[-3.6, 0, Math.PI / 2, 4.0], [3.6, 0, Math.PI / 2, 4.0], [0, 3.2, 0, 3.4]] as const) {
    const flow = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, len, 6), pipeGlow); flow.rotation.set(Math.PI / 2, turn, 0, "YXZ"); flow.position.set(x, .75, z); reactor.add(flow);
  }

  // ---- Hangar: four launch pads with their shuttles, crates, flight control
  const pads: THREE.Group[] = [];
  {
    const bay = 7, L = LAYOUTS[bay]!;
    L.seats.forEach((s, i) => consoleAt(bay, s, i));
    for (const [x, z] of [[-2.6, -2.3], [2.6, -2.3], [-2.6, 1.5], [2.6, 1.5]] as const) {
      cyl(B.desks, bay, 1.25, 1.3, .1, x, .05, z, DARKER, 36);
      put(B.accent, bay, (() => { const t = new THREE.TorusGeometry(1.15, .035, 6, 48); t.rotateX(Math.PI / 2); return t; })(), x, .11, z, 0, ROOM_GLOW[bay]!);
      for (let k = 0; k < 8; k++) put(B.amber, bay, new THREE.BoxGeometry(.18, .02, .06), x + Math.cos(k / 8 * Math.PI * 2) * 1.0, .11, z + Math.sin(k / 8 * Math.PI * 2) * 1.0, -k / 8 * Math.PI * 2);
      const pad = new THREE.Group(); pad.position.set(x, .1, z); frame(7).add(pad); pads.push(pad);
    }
    for (const [x, z, n] of [[-5.3, -4.2, 3], [5.3, -4.2, 2], [-5.3, 3.4, 2], [5.3, 3.4, 3]] as const) for (let k = 0; k < n; k++) box(B.desks, bay, .7, .5, .7, x + (k % 2) * .2, .25 + k * .5, z - (k % 2) * .15, ["#5a4a2a", "#4a3d6e", "#3a5a4a"][k % 3]);
  }
  // a shuttle in the house livery: pale hull, swept violet wings, a cyan canopy, a frog-green nose with
  // two little eyes and the orange lip stripe, twin engines glowing at the tail. One geometry, shared.
  const shuttleParts = new GeometryBatch();
  {
    const body = new THREE.CylinderGeometry(.34, .42, 1.7, 14); body.rotateX(Math.PI / 2); shuttleParts.add(body, 0, .62, -.1, 0, "#cfc8ee");
    const nose = new THREE.SphereGeometry(.34, 14, 10); nose.scale(1, .9, 1.55); shuttleParts.add(nose, 0, .62, .78, 0, "#4e8a3a");
    for (const x of [-.13, .13]) { shuttleParts.add(new THREE.SphereGeometry(.085, 10, 8), x, .92, .78, 0, "#efe6c8"); shuttleParts.add(new THREE.SphereGeometry(.04, 8, 6), x, .94, .85, 0, "#120e18"); }
    shuttleParts.add(new THREE.BoxGeometry(.34, .045, .05), 0, .5, 1.25, 0, "#e2772f");
    const canopy = new THREE.SphereGeometry(.27, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2); canopy.scale(1, .8, 1.5); shuttleParts.add(canopy, 0, .86, .2, 0, "#5fe0ff");
    const wing = new THREE.Shape([new THREE.Vector2(0, .45), new THREE.Vector2(1.05, -.45), new THREE.Vector2(1.05, -.62), new THREE.Vector2(0, -.62)]);
    for (const s of [-1, 1]) {
      const g = new THREE.ExtrudeGeometry(wing, { depth: .06, bevelEnabled: false }); g.rotateX(Math.PI / 2); if (s < 0) g.scale(-1, 1, 1);
      shuttleParts.add(g, s * .2, .52, -.25, 0, "#8a7cd0");
      shuttleParts.add(new THREE.BoxGeometry(.08, .07, .2), s * 1.22, .5, -.78, 0, "#b8ff4a");
    }
    shuttleParts.add(new THREE.BoxGeometry(.06, .5, .55), 0, .95, -.72, 0, "#8a7cd0");
    for (const x of [-.2, .2]) { const pod = new THREE.CylinderGeometry(.14, .17, .5, 12); pod.rotateX(Math.PI / 2); shuttleParts.add(pod, x, .55, -1.0, 0, "#2b2446"); }
  }
  const shuttleMesh = shuttleParts.mesh(toon({ vertexColors: true, side: THREE.DoubleSide }));
  const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color("#7fe8ff").multiplyScalar(2.4) });
  const shuttles = pads.map((pad) => {
    const s = new THREE.Group(); s.userData.noClip = true; s.add(new THREE.Mesh(shuttleMesh.geometry, shuttleMesh.material));
    for (const x of [-.2, .2]) { const f = new THREE.Mesh(new THREE.CircleGeometry(.12, 12), flame); f.position.set(x, .55, -1.26); f.rotation.y = Math.PI; s.add(f); }
    s.rotation.y = Math.PI; s.visible = false; pad.add(s); return s;
  });

  // ---- set dressing: plants, crates and cable runs in the rooms, plants and cargo along the corridor
  const plantAt = (bay: number, x: number, z: number, size = 1, seed = 1) => { const [dx, dz] = toDeck(bay, x, z); plant(B.props, dx, dz, size, seed); };
  const crateAt = (bay: number, x: number, z: number, w: number, h: number, y = 0, turn = 0, tint?: THREE.ColorRepresentation) => { const [dx, dz] = toDeck(bay, x, z); crate(B.props, dx, y, dz, w, h, turn + ROOMS[bay]!.turn, tint); };
  const run = (bay: number, points: [number, number][], count = 3) => cables(B.props, points.map(([x, z]) => [...toDeck(bay, x, z)] as [number, number]), count);
  plantAt(4, 5.3, -2.2, 1.1, 1); plantAt(4, -5.3, -4.45, .9, 2); run(4, [[-5.7, -3.3], [-4.6, -3.3], [-4.6, -2.4]]); run(4, [[5.7, -3.3], [4.6, -3.3], [4.6, -2.4]]);
  plantAt(5, 5.3, 4.35, 1.1, 3); crateAt(5, 5.2, 1.2, .62, .55, 0, .2, "#3a5a6e"); crateAt(5, 5.25, 1.95, .5, .45, 0, -.1, "#4a3d6e"); crateAt(5, 5.2, 1.2, .48, .4, .55, .5, "#3a5a6e");
  run(5, [[-1.95, -.7], [-5.5, -.7]]); run(5, [[1.95, -.7], [5.5, -.7]]); run(5, [[0, 1.5], [0, 2.4], [-5.5, 2.4]], 2);
  plantAt(6, -5.3, 4.4, 1, 4); plantAt(6, 5.3, 4.4, 1, 5);
  for (const s of [-1, 1]) { crateAt(6, s * 5.2, -4.35, .7, .6, 0, .1 * s, "#5a4a2a"); crateAt(6, s * 5.15, -4.3, .5, .45, .6, -.2 * s, "#4a3d6e"); crateAt(6, s * 4.9, -3.55, .55, .5, 0, .3, "#3a5a4a"); }
  run(6, [[-1.6, -2.9], [-1.0, -2.1]], 2); run(6, [[1.6, -2.9], [1.0, -2.1]], 2);
  for (const [x, z] of [[-2.6, -2.3], [2.6, -2.3], [-2.6, 1.5], [2.6, 1.5]] as const) run(7, [[x + Math.sign(x) * 1.25, z], [Math.sign(x) * 5.7, z]], 2);
  plantAt(7, -1.9, 4.45, .9, 6); plantAt(7, 1.9, 4.45, .9, 7);
  for (let k = 0; k < 3; k++) {
    const x = bayX(k) + BAY_W / 2;
    plant(B.props, x - .7, CORRIDOR.z0 + .42, .95, k); plant(B.props, x + .7, CORRIDOR.z0 + .42, .95, k + 3);
    crate(B.props, x, 0, CORRIDOR.z1 - .45, .6, .5, .15, "#4a3d6e"); crate(B.props, x + .55, 0, CORRIDOR.z1 - .42, .45, .42, -.2, "#5a4a2a");
  }

  // ---- chairs for every front-row seat, one instanced mesh in deck space
  const seats = FRONT.flatMap((bay) => LAYOUTS[bay]!.seats.map((seat) => ({ bay, seat })));
  const chairGeometry = new THREE.BoxGeometry(.5, .5, .5); chairGeometry.translate(0, .45, 0);
  const chairBack = new THREE.BoxGeometry(.5, .55, .08); chairBack.translate(0, .9, -.24);
  const chairs = new THREE.InstancedMesh(mergeChair(chairGeometry, chairBack), painted("fabric", 1, { color: "#bfb6e6" }, onTexture), seats.length);
  chairs.frustumCulled = false; group.add(chairs);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  function chair(seat: Seat, out: number) {
    const i = seats.findIndex((x) => x.seat === seat); if (i < 0) return;
    const bay = seats[i]!.bay, back = .42 + .55 * out, [x, z] = toDeck(bay, seat.at[0] - Math.sin(seat.face) * back, seat.at[1] - Math.cos(seat.face) * back);
    m.compose(at.set(x, seat.y, z), q.setFromAxisAngle(up, seat.face + ROOMS[bay]!.turn), one); chairs.setMatrixAt(i, m); chairs.instanceMatrix.needsUpdate = true;
  }
  seats.forEach(({ seat }) => chair(seat, 0));

  // ---- the batches, in the painted surfaces
  const mats = {
    wall: painted("wall", 2.4, { color: "#cfc8ee", vertexColors: true }, onTexture), floor: painted("floor", 4, { color: "#d8d4e6" }, onTexture),
    desks: painted("console", 1.5, { color: "#b6aee0", vertexColors: true }, onTexture), metal: toon({ color: "#6e6699" }),
    fabric: painted("fabric", 1, { color: "#ffffff", vertexColors: true }, onTexture), rack: painted("rack", 1.2, { color: "#ffffff" }, onTexture),
    warm: new THREE.MeshBasicMaterial({ color: new THREE.Color("#8d6dff").multiplyScalar(2.8) }), accent: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.6, 2.6, 2.6) }),
    amber: new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffb347").multiplyScalar(2.6) }), props: toon({ vertexColors: true }),
  };
  // the plate floor is painted dark; lift it toward the concept's lit lavender deck
  mats.floor.color.setRGB(2.2, 2.0, 2.8);
  for (const [name, batch] of Object.entries(B) as [keyof typeof B, GeometryBatch][]) group.add(batch.mesh(mats[name]));
  // soft light pools on the floor under each room's centrepiece, in the room's colour
  const pool = poolTexture(), POOLS: Record<number, [number, number, number, number][]> = {
    4: [[0, 1.7, 2.0, .7], [-3.7, -3.6, 1.1, .5], [0, -3.6, 1.1, .5], [3.7, -3.6, 1.1, .5]],
    5: [[0, -.4, 2.9, .8], [-2.6, -2.6, .9, .4], [2.6, -2.6, .9, .4], [-2.6, 2.0, .9, .4], [2.6, 2.0, .9, .4]],
    6: [[0, -.6, 2.8, .9], [-2.6, -3.6, 1.6, .45], [2.6, -3.6, 1.6, .45]],
    7: [[-2.6, -2.3, 1.6, .55], [2.6, -2.3, 1.6, .55], [-2.6, 1.5, 1.6, .55], [2.6, 1.5, 1.6, .55], [0, 3.4, 1.4, .4]],
  };
  for (const bay of FRONT) {
    const batch = new GeometryBatch();
    for (const [x, z, r, k] of POOLS[bay]!) { const [dx, dz] = toDeck(bay, x, z); batch.add(new THREE.PlaneGeometry(2 * r, 2 * r).rotateX(-Math.PI / 2), dx, .012 + k * .001, dz, 0, new THREE.Color(k, k, k)); }
    const mesh = batch.mesh(new THREE.MeshBasicMaterial({ map: pool, color: new THREE.Color(ROOM_GLOW[bay]!).multiplyScalar(.5), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    mesh.renderOrder = -1; group.add(mesh);
  }

  let lastBurnSeen = 0, pulse = 0;
  return {
    group, chair,
    /** World position of the uplink dish, where the drone-frogs orbit. */
    dishCenter: new THREE.Vector3(...((): [number, number, number] => { const [x, z] = toDeck(5, 0, -.4); return [x, 0, z]; })()),
    update(dt: number, time: number, extra: DeckExtra, missions: number) {
      bowlTurn.rotation.y = time * .12;
      // the reactor pulses when a new burn lands, and breathes softly between burns
      const burn = extra.token?.lastBurn?.at ?? 0;
      if (burn && burn !== lastBurnSeen) { if (lastBurnSeen) pulse = 1; lastBurnSeen = burn; }
      pulse = Math.max(0, pulse - dt * .35);
      const glow = 1.35 + Math.sin(time * 1.6) * .15 + pulse * 1.6;
      coreMaterial.color.set("#ff8a3d").multiplyScalar(glow); core.scale.set(1 + pulse * .12, 1, 1 + pulse * .12);
      const pct = Math.min(100, Math.max(0, extra.token?.stakedPct ?? 0)) / 100;
      if (gauge.userData.pct !== pct) { gauge.userData.pct = pct; gauge.geometry.dispose(); gauge.geometry = new THREE.RingGeometry(1.32, 1.5, 64, 1, Math.PI / 2, Math.max(.001, pct * Math.PI * 2)); }
      shuttles.forEach((s, i) => { s.visible = i < missions; if (s.visible) { s.position.y = Math.sin(time * 1.2 + i) * .04; s.rotation.y = Math.PI + Math.sin(time * .3 + i) * .08; } });
      // a glowing cube on each crew station per job in the latest activity
      let n = 0;
      for (const station of crewStations) {
        const jobs = extra.jobs.filter((j) => j.crew === station.id).length;
        for (let k = 0; k < Math.min(8, jobs); k++) { m.compose(at.set(station.x - .7 + (k % 4) * .25, .85 + (k >> 2) * .2, -3.75), q.identity(), one); jobCubes.setMatrixAt(n++, m); }
      }
      jobCubes.count = n; jobCubes.instanceMatrix.needsUpdate = true;
    },
    /** The rooms' screens: each crew's latest jobs, the swarm and the desk, the reactor's numbers, flight control. */
    draw(extra: DeckExtra, missions: number) {
      const paint = (i: number, region: number, title: string, accent: string, lines: string[]) => {
        const c = screens[i]!.c; if (!c) return;
        const x = (region % 2) * 512, y = (region >> 1) * 256;
        const g = c.createLinearGradient(0, y, 0, y + 256); g.addColorStop(0, "#1d2a4e"); g.addColorStop(1, "#101a33"); c.fillStyle = g; c.fillRect(x, y, 512, 256);
        c.fillStyle = "#26365f"; c.fillRect(x, y, 512, 40); c.fillStyle = accent; c.fillRect(x, y, 8, 40);
        c.fillStyle = "#eaf1f7"; c.font = `600 22px ${MONO}`; c.textBaseline = "middle"; c.textAlign = "left"; c.fillText(title, x + 20, y + 20);
        c.font = `500 24px ${SANS}`;
        lines.slice(0, 5).forEach((line, k) => { c.fillStyle = k ? "#a9bdd4" : "#ffffff"; let t = line; while (t.length > 3 && c.measureText(t).width > 470) t = t.slice(0, -2); c.fillText(t === line ? t : `${t}...`, x + 20, y + 72 + k * 38); });
      };
      const crewName = (id: string) => extra.crews.find((c) => c.id === id)?.name ?? id;
      crewStations.forEach((s, region) => {
        const jobs = extra.jobs.filter((j) => j.crew === s.id);
        paint(0, region, crewName(s.id).toUpperCase(), ROOM_GLOW[4]!, jobs.length ? [`${jobs.length} recent job${jobs.length === 1 ? "" : "s"}`, ...jobs.slice(0, 3).map((j) => `${ago(j.at)}: ${j.summary}`)] : ["No recent jobs reported"]);
      });
      paint(0, 3, "WARDROOM", ROOM_GLOW[4]!, ["Quarters crew off watch", `${extra.jobs.length} jobs in the latest feed`]);
      const sw = extra.swarm;
      paint(1, 0, "IMD SWARM", ROOM_GLOW[5]!, sw ? [`${sw.agentsOnline?.toLocaleString("en-US") ?? "?"} agents online`, "Drone-frogs: one per ten agents"] : ["Reading the swarm..."]);
      paint(1, 1, "SWARM DESK", ROOM_GLOW[5]!, sw ? [`${sw.orders} orders`, `${sw.delivered} delivered`, `${sw.running} running`] : ["Reading the desk..."]);
      paint(1, 2, "UPLINK", ROOM_GLOW[5]!, ["Link to the IMD swarm", sw ? "Signal live" : "Signal pending"]);
      paint(1, 3, "SEATS", ROOM_GLOW[5]!, ["Office Frogs whose holder", "holds an IMD swarm seat"]);
      const tk = extra.token;
      paint(2, 0, "$SHIFT STAKED", ROOM_GLOW[6]!, tk ? [`${short(tk.staked)} SHIFT`, `${tk.stakedPct.toFixed(1)}% of supply`] : ["Reading the reactor..."]);
      paint(2, 1, "$SHIFT BURNED", ROOM_GLOW[6]!, tk ? [`${short(tk.burnedShift)} SHIFT`, "gone for good"] : ["Reading the reactor..."]);
      paint(2, 2, "LAST BURN", ROOM_GLOW[6]!, tk?.lastBurn ? [`${tk.lastBurn.imd.toFixed(2)} IMD`, ago(tk.lastBurn.at)] : ["No burn reported"]);
      paint(2, 3, "REACTOR", ROOM_GLOW[6]!, ["Core pulses on every burn", "Gauge ring: share staked"]);
      paint(3, 0, "FLIGHT CONTROL", ROOM_GLOW[7]!, [`${missions} Frog${missions === 1 ? "" : "s"} on open missions`, "One shuttle per mission"]);
      paint(3, 1, "PADS", ROOM_GLOW[7]!, [`${Math.min(4, missions)} of 4 pads in use`]);
      screens.forEach((s) => { s.map.needsUpdate = true; });
    },
    dispose() {
      group.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.geometry.dispose(); for (const mat of ([] as THREE.Material[]).concat(mesh.material)) mat.dispose(); } });
      screens.forEach((s) => s.map.dispose());
    },
  };
}

function mergeChair(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  const batch = new GeometryBatch(); batch.add(a, 0, 0, 0, 0, "#ffffff"); batch.add(b, 0, 0, 0, 0, "#ffffff");
  const material = new THREE.MeshBasicMaterial(), mesh = batch.mesh(material); material.dispose(); return mesh.geometry;
}
