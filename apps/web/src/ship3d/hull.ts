import * as THREE from "three";
import { GeometryBatch } from "../station3d/geometry";
import { BAY_W, CORRIDOR, FRONT_Z, HALF_D, ROOMS, bayX } from "./layout";
import { painted } from "./surfaces";
import { ROOM_GLOW } from "./toon";

const X0 = bayX(0) - BAY_W / 2, X1 = bayX(3) + BAY_W / 2;
/** The deck's depth: from the window wall of the back row to the hull wall of the front row. */
const ZB = -HALF_D, ZF = FRONT_Z + HALF_D, ZM = (ZB + ZF) / 2;
const HULL = "#cdc6ea", PLATE = "#efeaff", DARK = "#5a5480", RIM = "#8f86c0";
/** The roof sits just above the room walls' full height. */
const ROOF_Y = 3.5;

/** A shape given as (across, height) points, extruded along the ship from x0 to x1 with chamfered edges. */
function keel(points: [number, number][], x0: number, x1: number, bevel = .18) {
  const shape = new THREE.Shape(); points.forEach(([z, y], i) => (i ? shape.lineTo(-z, y) : shape.moveTo(-z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0 - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * .7, bevelSegments: 1 });
  g.rotateY(Math.PI / 2); g.translate(x0 + bevel, 0, 0); return g;
}
/** A top-view outline (x, z), extruded upward from y0 to y1 with chamfered edges. */
function slab(points: [number, number][], y0: number, y1: number, bevel = .2) {
  const shape = new THREE.Shape(); points.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0 - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * .7, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2); g.translate(0, y0 + bevel, 0); return g;
}

/**
 * The ship around the operations deck, as an RTS map shows a capital ship: an armoured keel under both
 * rows, a chunky hull band with amber running lights, four engines aft and a prow forward. Zooming all
 * the way out fades in the roof and the upper hull, with each of the eight rooms glowing through its own
 * roof window.
 */
export function createHull(onTexture: () => void = () => {}) {
  const group = new THREE.Group(), lid = new THREE.Group(); group.add(lid);
  const hull = new GeometryBatch(), plates = new GeometryBatch(), trim = new GeometryBatch(), amber = new GeometryBatch(), engines = new GeometryBatch(), flame = new GeometryBatch();
  const upper = new GeometryBatch(), roofTrim = new GeometryBatch();

  // keel under both rows (its bevel grows the outline ~.13, so its top sits well under the floor at y = 0)
  hull.add(keel([[ZB - .8, -.3], [ZF + .9, -.3], [ZF + 1.6, -1.0], [ZF + .7, -2.4], [ZB - .2, -2.4], [ZB - 1.3, -1.0]], X0 - 1.2, X1 + 1.2), 0, 0, 0, 0, HULL);
  // the hull band: front, both ends, and the tall band behind the window wall
  hull.add(new THREE.BoxGeometry(X1 - X0 + 1.6, 1.9, .9), (X0 + X1) / 2, .75, ZF + .6, 0, HULL);
  for (const s of [-1, 1]) hull.add(new THREE.BoxGeometry(.9, 1.9, ZF - ZB + 1.9), s < 0 ? X0 - .6 : X1 + .6, .75, ZM + .1, 0, HULL);
  hull.add(new THREE.BoxGeometry(X1 - X0 + 1.6, 3.75, .5), (X0 + X1) / 2, 1.6, ZB - .58, 0, HULL);
  // armour ribs and raised plates on the band, modules on the keel at every bulkhead, running lights
  for (let x = X0 - .2; x <= X1 + .3; x += 3) hull.add(new THREE.BoxGeometry(.32, 2.0, .3), x, .78, ZF + 1.08, 0, DARK);
  for (let x = X0 + 1.3; x < X1 - 1; x += 3) {
    plates.add(new THREE.BoxGeometry(2.5, 1.1, .08), x, .9, ZF + 1.09, 0, PLATE);
    plates.add(new THREE.BoxGeometry(2.5, .9, .08), x, -1.25, ZF + 1.3, 0, RIM);
  }
  for (let k = 0; k <= 4; k++) {
    const x = X0 + k * BAY_W;
    hull.add(new THREE.BoxGeometry(2.6, 1.2, 1.1), x, -1.55, ZF + 1.15, 0, PLATE);
    amber.add(new THREE.BoxGeometry(.7, .16, .06), x, -1.3, ZF + 1.72);
    for (const z of [ZM - 6, ZM + 6]) hull.add(new THREE.BoxGeometry(2.2, .8, 2.6), x, -2.55, z, 0, RIM);
  }
  for (const s of [-1, 1]) for (let z = ZB + 1.5; z < ZF; z += 3) { hull.add(new THREE.BoxGeometry(.3, 2.0, .32), s < 0 ? X0 - 1.06 : X1 + 1.06, .78, z, 0, DARK); amber.add(new THREE.BoxGeometry(.06, .18, .5), s < 0 ? X0 - 1.07 : X1 + 1.07, .35, z + 1.5); }
  trim.add(new THREE.BoxGeometry(X1 - X0 + 1.8, .07, .14), (X0 + X1) / 2, 1.72, ZF + 1.0);
  for (const s of [-1, 1]) trim.add(new THREE.BoxGeometry(.14, .07, ZF - ZB + 2.0), s < 0 ? X0 - 1.0 : X1 + 1.0, 1.72, ZM + .1);
  trim.add(new THREE.BoxGeometry(X1 - X0 + 1.5, .05, .1), (X0 + X1) / 2, 3.5, ZB - .4);
  trim.add(new THREE.BoxGeometry(X1 - X0 + 2.4, .05, .08), (X0 + X1) / 2, -.85, ZF + 1.62);
  for (let x = X0 + .5; x < X1; x += 1.5) amber.add(new THREE.BoxGeometry(.42, .18, .06), x, .3 + ((x * 7) % 2 > 1 ? .5 : 0), ZF + 1.1);

  // four engines aft (left), in a chamfered housing
  const aft = X0 - 1.3;
  hull.add(slab([[aft, ZB - .6], [aft - 4.6, ZB + 1.2], [aft - 4.6, ZF - 1.2], [aft, ZF + .9]], -2.3, 2.6), 0, 0, 0, 0, HULL);
  for (const z of [ZM - 8.4, ZM - 2.8, ZM + 2.8, ZM + 8.4]) {
    const drive = new THREE.CylinderGeometry(1.75, 1.9, 5.4, 22); drive.rotateZ(Math.PI / 2); engines.add(drive, aft - 6.0, .2, z, 0, PLATE);
    const bell = new THREE.CylinderGeometry(1.95, 1.6, 1.0, 22, 1, true); bell.rotateZ(Math.PI / 2); engines.add(bell, aft - 9.1, .2, z, 0, DARK);
    const ring = new THREE.TorusGeometry(1.72, .16, 8, 26); ring.rotateY(Math.PI / 2); trim.add(ring, aft - 8.65, .2, z);
    const nozzle = new THREE.CircleGeometry(1.55, 24); nozzle.rotateY(-Math.PI / 2); flame.add(nozzle, aft - 9.3, .2, z);
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) engines.add(new THREE.BoxGeometry(3.6, .3, .3), aft - 6.0, .2 + Math.sin(a) * 1.85, z + Math.cos(a) * 1.85, 0, DARK);
    for (const dx of [-1.4, 0, 1.4]) engines.add(new THREE.BoxGeometry(.6, .26, 2.4), aft - 5.6 + dx, 1.75, z, 0, RIM);
  }
  // the prow forward (right): a tapered armoured wedge with a raised plate
  const fore = X1 + 1.3;
  hull.add(slab([[fore, ZB - .8], [fore + 4.4, ZB + 2.6], [fore + 7.6, ZM - 3.2], [fore + 7.6, ZM + 3.2], [fore + 4.4, ZF - 2.4], [fore, ZF + .9]], -2.3, 2.4), 0, 0, 0, 0, HULL);
  hull.add(slab([[fore + .4, ZM - 5.4], [fore + 5.0, ZM - 2.4], [fore + 5.0, ZM + 2.4], [fore + .4, ZM + 5.4]], 2.4, 3.0, .12), 0, 0, 0, 0, PLATE);
  for (const z of [ZB + 1.0, ZF - .8]) amber.add(new THREE.BoxGeometry(.5, .16, .06), fore + 3.0, 1.0, z);
  trim.add(new THREE.BoxGeometry(5.0, .06, .1), fore + 2.6, 2.45, ZM - 5.0); trim.add(new THREE.BoxGeometry(5.0, .06, .1), fore + 2.6, 2.45, ZM + 5.0);

  // the lid: upper hull and a roof with one window per room, faded in when zoomed all the way out
  const top = ROOF_Y + .1, W = 4.9, D = 4.0;
  upper.add(new THREE.BoxGeometry(X1 - X0 + 1.6, ROOF_Y - 1.7, .6), (X0 + X1) / 2, 1.7 + (ROOF_Y - 1.7) / 2, ZF + .55, 0, HULL);
  for (const s of [-1, 1]) upper.add(new THREE.BoxGeometry(.6, ROOF_Y - 1.7, ZF - ZB + 1.6), s < 0 ? X0 - .55 : X1 + .55, 1.7 + (ROOF_Y - 1.7) / 2, ZM + .1, 0, HULL);
  // roof plating around the windows: strips along the rows, between the rooms, and over the corridor
  for (const row of [0, 1]) {
    const cz = row ? FRONT_Z : 0;
    upper.add(new THREE.BoxGeometry(X1 - X0 + 1.6, .22, HALF_D - D + .3), (X0 + X1) / 2, top, cz - (HALF_D + D) / 2 - .1, 0, PLATE);
    upper.add(new THREE.BoxGeometry(X1 - X0 + 1.6, .22, HALF_D - D + .3), (X0 + X1) / 2, top, cz + (HALF_D + D) / 2 + .1, 0, PLATE);
    for (let k = 0; k <= 4; k++) {
      const left = k === 0 ? X0 - .8 : bayX(k - 1) + W, right = k === 4 ? X1 + .8 : bayX(k) - W;
      upper.add(new THREE.BoxGeometry(right - left, .22, 2 * D), (left + right) / 2, top, cz, 0, PLATE);
      if (k > 0 && k < 4) upper.add(new THREE.BoxGeometry(1.1, .5, 2 * D - .8), X0 + k * BAY_W, top + .28, cz, 0, HULL);
    }
  }
  upper.add(new THREE.BoxGeometry(X1 - X0 + 1.6, .22, CORRIDOR.z1 - CORRIDOR.z0 + .4), (X0 + X1) / 2, top, (CORRIDOR.z0 + CORRIDOR.z1) / 2, 0, PLATE);
  upper.add(new THREE.BoxGeometry(X1 - X0 - 2, .6, 1.4), (X0 + X1) / 2, top + .35, (CORRIDOR.z0 + CORRIDOR.z1) / 2, 0, HULL);
  for (let x = X0 + 1; x < X1; x += 4) roofTrim.add(new THREE.BoxGeometry(.5, .07, .5), x, top + .67, (CORRIDOR.z0 + CORRIDOR.z1) / 2, 0, "#ffb347");
  ROOMS.forEach((room, bay) => {
    const glow = ROOM_GLOW[bay]!;
    for (const z of [-D, D]) roofTrim.add(new THREE.BoxGeometry(2 * W + .1, .07, .12), room.x, top + .13, room.z + z, 0, glow);
    for (const x of [-W, W]) roofTrim.add(new THREE.BoxGeometry(.12, .07, 2 * D + .1), room.x + x, top + .13, room.z, 0, glow);
  });
  for (let x = X0 + 3; x < X1; x += 9) upper.add(new THREE.CylinderGeometry(.06, .08, 2.0, 6), x, top + 1.0, ZB - .1, 0, RIM);
  // greebles: vents and service boxes along both roof edges, tanks between the room windows
  for (let x = X0 + .6; x < X1; x += 2.2) for (const [z, k] of [[ZB - .1, 0], [ZF + .3, 1]] as const) {
    const w = .7 + ((x * 13 + k * 5) % 3) * .35, h = .2 + ((x * 7 + k) % 4) * .12;
    upper.add(new THREE.BoxGeometry(w, h, .8), x, top + .11 + h / 2, z + (k ? -.2 : .2), 0, (x * 3) % 2 > 1 ? RIM : DARK);
  }
  for (let k = 1; k < 4; k++) for (const cz of [0, FRONT_Z]) for (const dz of [-2.2, 2.2]) {
    const tank = new THREE.CylinderGeometry(.42, .42, 1.6, 14); tank.rotateX(Math.PI / 2); upper.add(tank, X0 + k * BAY_W, top + .62, cz + dz, 0, PLATE);
  }
  // the bridge tower on the prow, clear of the room windows, with lit window slits and a mast
  const bx = X1 + 4.6, bz = ZM, base = 3.0;
  hull.add(slab([[bx - 2.6, bz - 3.0], [bx + 1.8, bz - 2.4], [bx + 2.8, bz], [bx + 1.8, bz + 2.4], [bx - 2.6, bz + 3.0]], base, base + 1.3, .14), 0, 0, 0, 0, HULL);
  hull.add(slab([[bx - 1.8, bz - 1.9], [bx + 1.1, bz - 1.5], [bx + 1.8, bz], [bx + 1.1, bz + 1.5], [bx - 1.8, bz + 1.9]], base + 1.3, base + 2.4, .12), 0, 0, 0, 0, PLATE);
  for (const s of [-1, 1]) amber.add(new THREE.BoxGeometry(2.4, .12, .06), bx - .3, base + 1.9, bz + s * 1.82);
  amber.add(new THREE.BoxGeometry(.06, .12, 2.6), bx + 1.75, base + 1.9, bz);
  hull.add(new THREE.CylinderGeometry(.07, .1, 3.0, 6), bx - 1.0, base + 3.9, bz, 0, RIM); hull.add(new THREE.CylinderGeometry(.04, .05, 1.8, 6), bx - .1, base + 3.3, bz + .6, 0, RIM);

  const hullMaterial = painted("hull", 6, { color: "#ffffff", vertexColors: true }, onTexture);
  const trimMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#7c5cff").multiplyScalar(2.8) });
  const amberMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffb347").multiplyScalar(3) });
  const lidMaterial = painted("hull", 6, { color: "#ffffff", vertexColors: true, transparent: true }, onTexture);
  const lidTrimMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, color: new THREE.Color(2.6, 2.6, 2.6) });
  const flameMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#9fe8ff").multiplyScalar(2.6), side: THREE.DoubleSide });
  group.add(hull.mesh(hullMaterial), plates.mesh(hullMaterial), engines.mesh(hullMaterial), trim.mesh(trimMaterial), amber.mesh(amberMaterial), flame.mesh(flameMaterial));
  lid.add(upper.mesh(lidMaterial), roofTrim.mesh(lidTrimMaterial));
  // each room's roof window: a tinted pane the room glows through
  const panes = ROOMS.map((room, bay) => {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, 2 * D).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(ROOM_GLOW[bay]), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    pane.position.set(room.x, top, room.z); lid.add(pane); return pane.material;
  });
  lid.visible = false;

  return {
    group,
    /** 0 = open cutaway, 1 = the roof on, rooms glowing through their windows. */
    lid(alpha: number) {
      lid.visible = alpha > .01;
      lidMaterial.opacity = alpha; lidMaterial.depthWrite = alpha > .9; lidTrimMaterial.opacity = alpha;
      for (const pane of panes) pane.opacity = .07 * alpha;
    },
    dispose() {
      group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
    },
  };
}
