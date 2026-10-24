import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CISTERN, ZONES, cisternHeight } from "@nightshift/lastspawn";
import { type Kit, dress, kit, piece, toonWithRim } from "./assets";
import { flame, lightShaft, motes, waterMaterial } from "./fx";
import type { Quality } from "./stage";

/** The stone of the cistern: cold blue-grey under the moon, warmer where the torches reach. */
const STONE = 0x8a93a8;
const DARK = 0x2a2f3d;

export interface Place {
  group: THREE.Group;
  update(t: number, dt: number): void;
  /** where the moon's light points, for water glints */
  moon: THREE.Vector3;
  /** round things a frog can't walk through */
  solids: { x: number; z: number; r: number }[];
  dispose(): void;
}

/**
 * The Cistern under the dead lighthouse: a round chamber of old Tall Folk stone, the hatching pool in a
 * shaft of moonlight from a grate in the vault, Wend's pump turning, a stair climbing the wall to the door.
 */
export async function buildCistern(q: Quality, scene: THREE.Scene): Promise<Place> {
  const stone = await kit("stone");
  const g = new THREE.Group();
  const flickers: { light: THREE.PointLight; base: number; seed: number }[] = [];
  const flames: ReturnType<typeof flame>[] = [];
  const R = CISTERN.radius;

  scene.fog = new THREE.FogExp2(0x060810, 0.026);
  scene.background = new THREE.Color(0x05070c);
  const hemi = new THREE.HemisphereLight(0x4a5c86, 0x1a1512, 1.1);
  g.add(hemi);

  // ---------- floor: big tiles out to the wall, the pool's basin in the middle ----------
  const tiles = ["floor_tile_large", "floor_tile_large", "floor_tile_large", "floor_tile_large_rocks"];
  let k = 0;
  for (let x = -12; x <= 12; x += 4) for (let z = -12; z <= 12; z += 4) {
    const r = Math.hypot(x, z);
    if (r > R + 2 || r < CISTERN.pool + 1.4) continue;
    g.add(dress(piece(stone, tiles[k++ % tiles.length]!, { x, y: 0, z, ry: (k % 4) * Math.PI / 2 }), STONE, { shadows: false }));
  }
  // the basin follows the same ground the server checks, so you wade down into it
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 28; i++) { const r = (CISTERN.pool + 1.5) * i / 28; prof.push(new THREE.Vector2(r, cisternHeight(r, 0) - 0.02)); }
  const basin = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), toonWithRim({ color: new THREE.Color(0x4b5466), rim: 0.05 }));
  basin.material.side = THREE.DoubleSide; basin.receiveShadow = true;
  g.add(basin);
  // the lip: a ring of dressed stones round the pool
  const lipG: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2, b = new THREE.BoxGeometry(1.15, 0.22, 0.55);
    b.rotateY(-a + Math.PI / 2); b.translate(Math.cos(a) * (CISTERN.pool + 0.75), 0.06 + (i % 3) * 0.015, Math.sin(a) * (CISTERN.pool + 0.75));
    lipG.push(b);
  }
  const lip = new THREE.Mesh(mergeGeometries(lipG), toonWithRim({ color: new THREE.Color(0x7d8698), rim: 0.15 }));
  lip.receiveShadow = true; lip.castShadow = true; g.add(lip);

  // the water of the hatching pool
  const water = waterMaterial({ color: 0x1b3440, deep: 0x020609, moon: new THREE.Vector3(0.1, 1, 0.15), radius: CISTERN.pool + 0.9 });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(CISTERN.pool + 0.9, 72), water.mat);
  pool.rotation.x = -Math.PI / 2; pool.position.y = CISTERN.water; pool.renderOrder = 2;
  g.add(pool);

  // ---------- the wall: two courses of stone round the room, pillars at the joints ----------
  const N = 19, wallR = R + 0.55;
  const walls = ["wall", "wall", "wall_cracked", "wall", "wall_arched", "wall", "wall_broken"];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    for (const row of [0, 4]) {
      const name = row === 0 ? walls[i % walls.length]! : (i % 5 === 2 ? "wall_cracked" : "wall");
      const w = piece(stone, name, { x: Math.cos(a) * wallR, y: row, z: Math.sin(a) * wallR, ry: -a - Math.PI / 2 });
      w.scale.x = (2 * Math.PI * wallR / N) / 4 * 1.04;
      g.add(dress(w, row === 0 ? STONE : 0x6f7891, { shadows: false }));
    }
    const pa = a + Math.PI / N;
    for (const row of [0, 4]) g.add(dress(piece(stone, "pillar", { x: Math.cos(pa) * (wallR - 0.35), y: row, z: Math.sin(pa) * (wallR - 0.35), ry: -pa }), 0x7a8399, { shadows: false }));
  }

  // ---------- the vault: dark stone, and a grate over the pool the moon comes through ----------
  const vault = new THREE.Mesh(new THREE.RingGeometry(2.3, R + 1.2, 64, 1), toonWithRim({ color: new THREE.Color(DARK), rim: 0 }));
  vault.rotation.x = Math.PI / 2; vault.position.y = 8; g.add(vault);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) g.add(dress(piece(stone, "floor_tile_grate", { x, y: 8.05, z }), 0x5d6577, { shadows: true }));
  const sky = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), new THREE.MeshBasicMaterial({ color: 0x5c74b8, fog: false }));
  sky.rotation.x = Math.PI / 2; sky.position.y = 9.6; g.add(sky);

  // the moonlight: one shadow-casting spot down the shaft, and the shaft itself
  const moon = new THREE.SpotLight(0xb9caff, q === "low" ? 60 : 90, 20, 0.34, 0.65, 1.4);
  moon.position.set(0.6, 13, 0.4); moon.target.position.set(0, 0, 0);
  moon.castShadow = q !== "low";
  moon.shadow.mapSize.set(q === "high" ? 2048 : 1024, q === "high" ? 2048 : 1024);
  moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.03; moon.shadow.camera.near = 4; moon.shadow.camera.far = 16;
  g.add(moon, moon.target);
  const shaft = lightShaft(2.0, 3.1, 8.4, 0x9cb2ff);
  shaft.mesh.position.y = 8.1; g.add(shaft.mesh);
  const dust = motes({ count: q === "low" ? 50 : 160, box: new THREE.Box3(new THREE.Vector3(-2.6, 0.2, -2.6), new THREE.Vector3(2.6, 7.8, 2.6)), color: 0xbcd0ff, size: q === "high" ? 0.9 : 0.5, speed: 0.12 });
  g.add(dust.points);

  // ---------- the stair: stone steps up the wall to the door ----------
  const s = CISTERN.stair, steps = 26, stepG: THREE.BufferGeometry[] = [];
  for (let i = 0; i < steps; i++) {
    const a = s.a0 + (s.a1 - s.a0) * (i + 0.5) / steps, top = s.top * (i + 1) / steps;
    const arc = ((s.a1 - s.a0) / steps) * (s.inner + s.outer) / 2;
    const b = new THREE.BoxGeometry(s.outer - s.inner + 0.4, top, arc * 1.02);
    b.translate((s.inner + s.outer) / 2 + 0.2, top / 2, 0); b.rotateY(-a);
    stepG.push(b);
  }
  const stair = new THREE.Mesh(mergeGeometries(stepG), toonWithRim({ color: new THREE.Color(0x737c92), rim: 0.12 }));
  stair.castShadow = true; stair.receiveShadow = true; g.add(stair);
  // the door at the top: an arch, the night outside showing through it
  const top = ZONES.cistern.marks.stairTop!;
  const da = s.a1 + 0.12;
  const door = piece(stone, "wall_arched", { x: Math.cos(da) * (wallR - 0.05), y: s.top - 0.2, z: Math.sin(da) * (wallR - 0.05), ry: -da - Math.PI / 2 });
  g.add(dress(door, 0x8a93a8, { shadows: false }));
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.2), new THREE.MeshBasicMaterial({ color: 0x3d5590, fog: false }));
  outside.position.set(Math.cos(da) * (wallR + 0.6), s.top + 1.3, Math.sin(da) * (wallR + 0.6)); outside.lookAt(0, s.top + 1.3, 0);
  g.add(outside);
  const doorLight = new THREE.PointLight(0x6f8cd8, 8, 9, 2); doorLight.position.set(top.x * 0.92, top.y + 1.6, top.z * 0.92); g.add(doorLight);

  // ---------- torches on the wall ----------
  const torchAt = q === "low" ? [0.9, 3.9] : [0.9, 2.4, 3.9, 5.3];
  for (const a of torchAt) {
    const x = Math.cos(a) * (R - 0.15), z = Math.sin(a) * (R - 0.15);
    // its +z (away from the wall) faces the middle of the room
    const t = piece(stone, "torch_mounted", { x, y: 2.6, z, ry: Math.atan2(-Math.cos(a), -Math.sin(a)) });
    g.add(dress(t, 0x9c8a74, { shadows: false }));
    const f = flame(1.1); f.group.position.set(x - Math.cos(a) * 0.32, 3.05, z - Math.sin(a) * 0.32); g.add(f.group); flames.push(f);
    const l = new THREE.PointLight(0xff9346, 7, 10, 2); l.position.set(x - Math.cos(a) * 0.9, 3.1, z - Math.sin(a) * 0.9);
    g.add(l); flickers.push({ light: l, base: 7, seed: Math.random() * 10 });
  }

  // ---------- the pump: Wend's forty-one years of work, turning at last ----------
  const pm = ZONES.cistern.marks.pump!;
  const pump = new THREE.Group();
  const iron = toonWithRim({ color: new THREE.Color(0x5b4a3e), rim: 0.22, rimColor: 0xffb070 });
  const brass = toonWithRim({ color: new THREE.Color(0x9a7a46), rim: 0.3, rimColor: 0xffd29a });
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 2.4, 20), iron); tank.position.y = 1.2; pump.add(tank);
  for (const y of [0.4, 1.2, 2.0]) { const band = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 6, 24), brass); band.rotation.x = Math.PI / 2; band.position.y = y; pump.add(band); }
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.08, 8, 28), brass));
  for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.07), iron); sp.rotation.z = (i / 6) * Math.PI; wheel.add(sp); }
  wheel.position.set(0, 1.5, 1.15); pump.add(wheel);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 6, 10), iron); pipe.position.set(-0.6, 4.2, -0.4); pump.add(pipe);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.2, 10), iron); spout.rotation.z = Math.PI / 2; spout.position.set(1.3, 0.55, 0.2); pump.add(spout);
  pump.position.set(pm.x, 0, pm.z); pump.rotation.y = pm.ry;
  pump.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  g.add(pump);

  // ---------- Wend's corner and the clutter of a life spent down here ----------
  const wend = ZONES.cistern.npcs[0]!.at;
  const props: [string, number, number, number, number?][] = [
    ["chair", wend.x, wend.z, wend.ry], ["table_small", wend.x + 1.2, wend.z - 0.6, 0.3], ["candle_triple", wend.x + 1.2, wend.z - 0.6, 0, 0.78],
    ["shelf_small_candles", wend.x + 2.6, wend.z - 2.8, -0.9], ["barrel_small", wend.x - 1.6, wend.z - 2.2, 0.4], ["stool", wend.x + 2.2, wend.z + 0.6, 0.2],
    ["barrel_large", -9.4, -5.2, 0], ["barrel_small", -8.4, -6.4, 0.6], ["crates_stacked", -4.8, -10.0, 0.4], ["box_small", -6.2, -9.6, 0.1],
    ["rubble_half", 9.3, 5.6, 2.4], ["barrel_small", -9.2, 7.4, 1.1], ["box_small", -5.6, 9.6, 0.8],
  ];
  for (const [name, x, z, ry, y] of props) g.add(dress(piece(stone, name, { x, y: y ?? 0, z, ry }), name.startsWith("candle") ? 0xd6c4a8 : 0x8d8578));
  const candle = new THREE.PointLight(0xffa860, 4.5, 6, 2); candle.position.set(wend.x + 1.2, 1.6, wend.z - 0.6); g.add(candle);
  flickers.push({ light: candle, base: 4.5, seed: 3.3 });
  for (const [dx, dz] of [[1.08, -0.62], [1.26, -0.5], [1.2, -0.72]] as const) {
    const f = flame(0.32, 0xffb060); f.group.position.set(wend.x + dx, 1.62, wend.z + dz); g.add(f.group); flames.push(f);
  }
  // fireflies round the old lampwright
  const flies = motes({ count: q === "low" ? 10 : 22, box: new THREE.Box3(new THREE.Vector3(wend.x - 2, 0.6, wend.z - 2.5), new THREE.Vector3(wend.x + 3, 3.2, wend.z + 1.5)), color: 0xd8ff8a, size: 1.6, speed: 0.35, blink: true });
  g.add(flies.points);

  scene.add(g);
  let nextDrop = 1.5;
  return {
    group: g, moon: new THREE.Vector3(0.05, 1, 0.03),
    solids: [
      { x: pm.x, z: pm.z, r: 1.35 }, { x: wend.x, z: wend.z, r: 0.75 }, { x: wend.x + 1.2, z: wend.z - 0.6, r: 0.6 },
      { x: -9.4, z: -5.2, r: 1 }, { x: -8.4, z: -6.4, r: 0.6 }, { x: -4.8, z: -10, r: 1.2 }, { x: -6.2, z: -9.6, r: 0.5 },
      { x: wend.x - 1.6, z: wend.z - 2.2, r: 0.6 }, { x: -9.2, z: 7.4, r: 0.6 }, { x: -5.6, z: 9.6, r: 0.5 },
    ],
    update(t, dt) {
      water.u.uTime.value = t; shaft.u.uTime.value = t; dust.u.uTime.value = t; flies.u.uTime.value = t;
      for (const f of flames) f.u.uTime.value += dt;
      for (const f of flickers) f.light.intensity = f.base * (0.82 + 0.12 * Math.sin(t * 9 + f.seed) + 0.06 * Math.sin(t * 23 + f.seed * 2));
      wheel.rotation.z -= dt * 0.9;
      // drops from the grate keep falling into the pool
      if (t > nextDrop) { const a = Math.random() * Math.PI * 2, r = Math.random() * 2.2; water.drop(Math.cos(a) * r, Math.sin(a) * r); nextDrop = t + 1.2 + Math.random() * 2.5; }
    },
    dispose() { scene.remove(g); scene.fog = null; },
  };
}

export type { Kit };
