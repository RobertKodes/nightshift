import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BloomEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect } from "postprocessing";
import { LITE, PHONE } from "../lite";
import { createAnnex } from "./annex";
import { createBrains } from "./brain";
import { SKINS, VESTS, createDeckCrew } from "./crew";
import { actorsForBay, type Bay, type DeckExtra, type Entry } from "./data";
import { createHull } from "./hull";
import { InkEffect } from "./ink";
import { createInterior } from "./interior";
import { BAY_W, CORRIDOR, FRONT_Z, HALF_D, LAYOUTS, ROOMS, slotsOf, toDeck, type Seat } from "./layout";
import { createDrones, createImpostors, createLowFrogs } from "./lowfrog";
import { createMinimap, type Blip } from "./minimap";
import { createOutside } from "./outside";
import { ROOM_GLOW, toon } from "./toon";

export type DeckInput = { bay: Bay; entries: Entry[]; selected: string | null; paused: boolean; extra: DeckExtra };
type Options = {
  input: DeckInput; reduced: boolean; signal: AbortSignal;
  onPick: (key: string) => void; onUnavailable: () => void;
  /** The room under the camera changed because the player panned there. */
  onBay?: (bay: Bay) => void;
};

const hash = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Walls are cut away above this height (a frog is 1.8 tall), except the back row's window wall, which stays whole. */
const CUT = 1.55, BACK = -HALF_D + .42;
/** The RTS camera: about 47 degrees down over the deck so faces read, lowering to about 41 as it pulls out to the whole ship. */
const PITCH = .82, PITCH_OUT = .72;
/** The deck: two rows of four rooms, the corridor between them. */
const X0 = -BAY_W / 2, X1 = 3 * BAY_W + BAY_W / 2, ZB = -HALF_D, ZF = FRONT_Z + HALF_D;
const MID = { x: (X0 + X1) / 2, z: (ZB + ZF) / 2 };
/** Framing boxes (half sizes along the deck and across it): the deck with its hull band, the whole ship, one room. */
const DECK = { along: (X1 - X0) / 2 + 1.9, across: (ZF - ZB) / 2 + 2.0 }, SHIP = { along: 36.5, across: (ZF - ZB) / 2 + 3.2 }, ROOM = { along: BAY_W / 2 + .8, across: HALF_D + .8 };
const DOOR_Z = .9, HATCH_X = 1.05;
/** Full animated frogs lent to the crew nearest a close camera; everyone else is an instanced low-poly frog. */
const POOL = LITE ? 4 : PHONE ? 8 : 14;
const DRONES = 120;

/** Armoured wall tops along the cut: a dark cap plate with a glowing violet line, the room outlines an RTS map reads by. */
function wallCaps() {
  const pieces: THREE.BufferGeometry[] = [], lines: THREE.BufferGeometry[] = [];
  const along = (x0: number, x1: number, z: number, side = 1) => {
    if (x1 - x0 <= .05) return;
    pieces.push(new THREE.BoxGeometry(x1 - x0 + .4, .2, .82).translate((x0 + x1) / 2, CUT + .1, z));
    lines.push(new THREE.BoxGeometry(x1 - x0 + .2, .03, .07).translate((x0 + x1) / 2, CUT + .215, z + .22 * side));
  };
  const across = (x: number, z0: number, z1: number) => {
    if (z1 - z0 <= .05) return;
    pieces.push(new THREE.BoxGeometry(.82, .2, z1 - z0 + .4).translate(x, CUT + .1, (z0 + z1) / 2));
    lines.push(new THREE.BoxGeometry(.07, .03, z1 - z0 + .2).translate(x, CUT + .215, (z0 + z1) / 2));
  };
  const zf0 = FRONT_Z - HALF_D, zf1 = FRONT_Z + HALF_D;
  for (let k = 0; k <= 4; k++) {
    const x = X0 + k * BAY_W, end = k === 0 || k === 4;
    if (end) { across(x, BACK, HALF_D + .15); across(x, CORRIDOR.z0, CORRIDOR.z1); across(x, zf0 - .15, zf1 + .15); }
    else { across(x, BACK, -DOOR_Z); across(x, DOOR_Z, HALF_D); across(x, zf0, FRONT_Z - DOOR_Z); across(x, FRONT_Z + DOOR_Z, zf1); }
  }
  for (let k = 0; k < 4; k++) {
    const X = X0 + BAY_W / 2 + k * BAY_W;
    along(X - BAY_W / 2, X - HATCH_X, HALF_D); along(X + HATCH_X, X + BAY_W / 2, HALF_D);
    along(X - BAY_W / 2, X - HATCH_X, zf0, -1); along(X + HATCH_X, X + BAY_W / 2, zf0, -1);
    along(X - BAY_W / 2, X + BAY_W / 2, zf1, -1);
  }
  const plates = new THREE.Mesh(mergeGeometries(pieces), toon({ color: "#463c6e" })), glow = new THREE.Mesh(mergeGeometries(lines), new THREE.MeshBasicMaterial({ color: new THREE.Color("#7c5cff").multiplyScalar(2.7) }));
  pieces.forEach((p) => p.dispose()); lines.forEach((p) => p.dispose());
  const group = new THREE.Group(); group.add(plates, glow); return group;
}

/** The animated selection marker under the picked frog: a segmented ring, as in an RTS. */
function selectionTexture() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d");
  if (c) {
    c.translate(128, 128); c.lineCap = "round";
    c.strokeStyle = "#ffffff"; c.lineWidth = 13;
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; c.beginPath(); c.arc(0, 0, 104, a + .12, a + Math.PI / 3 - .12); c.stroke(); }
    c.globalAlpha = .45; c.lineWidth = 4; c.beginPath(); c.arc(0, 0, 86, 0, Math.PI * 2); c.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The operations deck as an RTS map: eight lit rooms of working frogs seen from above, inside the ship's hull, over the Earth. */
export async function createDeckScene(canvas: HTMLCanvasElement, options: Options) {
  const crew = await createDeckCrew();
  if (options.signal.aborted) { crew.dispose(); throw new Error("Cancelled"); }
  // a weak device, or a visitor who asked for less motion, gets the plain render: no ink pass, no bloom
  const LOW = LITE || options.reduced || (typeof navigator !== "undefined" && (navigator.hardwareConcurrency || 8) <= 4);
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: LOW, stencil: false, powerPreference: "high-performance" }); }
  catch (error) { crew.dispose(); throw error; }
  renderer.debug.onShaderError = () => options.onUnavailable();
  renderer.setClearColor("#000000"); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = LOW ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(34, 1, .5, 900);
  let composer: EffectComposer | null = null;
  if (!LOW) {
    composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: PHONE ? 0 : Math.min(2, renderer.capabilities.maxSamples) });
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new EffectPass(camera, new InkEffect(), new BloomEffect({ intensity: PHONE ? 1.0 : 1.2, luminanceThreshold: .9, luminanceSmoothing: .12, mipmapBlur: true, radius: .7 }), new VignetteEffect({ darkness: .5, offset: .32 }), new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));
  }

  // light rig: neutral ambient, one sun over the whole map, each room's own coloured light (no shadow maps: cel shading carries depth)
  const hemi = new THREE.HemisphereLight("#b8b2d0", "#1a1626", 1.5);
  const key = new THREE.DirectionalLight("#f4f1ff", 1.55);
  scene.add(hemi, key, key.target);
  LAYOUTS.forEach((layout, bay) => {
    const glow = layout.glow.at, [x, z] = toDeck(bay, glow[0], glow[2] - .3);
    const light = new THREE.PointLight(ROOM_GLOW[bay]!, 7, 5.5, 1.4); light.position.set(x, 1.1, z); scene.add(light);
  });
  function rig() { key.position.set(target.x - 8, 22, target.z + 12); key.target.position.set(target.x, 0, target.z); }

  // the rooms: the back row cut away above head height except its window wall, the front row and corridor, the wall caps, the hull
  let disposed = false;
  const repaint = () => { if (!disposed) invalidate(); };
  const interior = createInterior(repaint); scene.add(interior.group);
  const annex = createAnnex(repaint); scene.add(annex.group);
  const cuts = [new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT), new THREE.Plane(new THREE.Vector3(0, 0, -1), BACK)];
  const exempt = (object: THREE.Object3D | null) => { for (let o = object; o; o = o.parent) if (o.userData.noClip) return true; return false; };
  for (const root of [interior.group, annex.group]) root.traverse((object) => {
    const mesh = object as THREE.Mesh; if (!mesh.material || exempt(object)) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if ((material as THREE.ShaderMaterial).isShaderMaterial) continue;
      material.clippingPlanes = cuts; material.clipIntersection = true;
      // the inside of a cut wall shows as solid wall, not a hollow shell
      if ((material as THREE.MeshToonMaterial).isMeshToonMaterial && !material.transparent) material.side = THREE.DoubleSide;
    }
  });
  const caps = wallCaps(); scene.add(caps);
  const hull = createHull(repaint); scene.add(hull.group);
  // the night side of the Earth behind the ship, its limb across the top of the view; stars below the deck
  const outside = createOutside(repaint, new THREE.Vector3(0, -Math.sin(1.553), -Math.cos(1.553)).multiplyScalar(180)); scene.add(outside.group);
  void outside.ready.then((map) => { if (map && !disposed) { interior.windows(map); invalidate(); } });
  void interior.ready.then(repaint);

  // ---- the crew: a mesh-less stand-in per slot in every room's frame, each frame placed and turned on the deck
  const frames = ROOMS.map((room) => { const g = new THREE.Group(); g.position.set(room.x, 0, room.z); g.rotation.y = room.turn; scene.add(g); return g; });
  const rooms = LAYOUTS.map((_, bay) => Array.from({ length: slotsOf(bay) }, (_, slot) => { const actor = crew.proxy(bay * 8 + slot, bay); actor.root.visible = false; frames[bay]!.add(actor.root); return actor; }));
  const seatBay = new Map<Seat, number>(); LAYOUTS.forEach((layout, bay) => layout.seats.forEach((s) => seatBay.set(s, bay)));
  const brains = createBrains(crew, { chair: (seat, out) => ((seatBay.get(seat) ?? 0) < 4 ? interior.chair(seat, out) : annex.chair(seat, out)) }, rooms);
  const total = rooms.reduce((n, room) => n + room.length, 0);
  const low = createLowFrogs(total); scene.add(low.group);
  const far = createImpostors(renderer, total, SKINS[1]!, VESTS[0]!); scene.add(far.mesh);
  const drones = createDrones(DRONES); scene.add(drones.mesh);
  // full animated frogs, lent to the slots nearest a close camera
  const pool = Array.from({ length: POOL }, (_, i) => { const actor = crew.create(i, 0); actor.root.visible = false; scene.add(actor.root); return { actor, slot: null as null | [number, number] }; });
  // contact blobs and ownership rings, instanced; invisible hit boxes for picking
  const blobCanvas = document.createElement("canvas"); blobCanvas.width = blobCanvas.height = 64;
  const blobContext = blobCanvas.getContext("2d");
  if (blobContext) { const g = blobContext.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(0,0,0,.7)"); g.addColorStop(.55, "rgba(0,0,0,.35)"); g.addColorStop(1, "rgba(0,0,0,0)"); blobContext.fillStyle = g; blobContext.fillRect(0, 0, 64, 64); }
  const blobMap = new THREE.CanvasTexture(blobCanvas), blobGeometry = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2), blobMaterial = new THREE.MeshBasicMaterial({ map: blobMap, transparent: true, depthWrite: false, toneMapped: false });
  const ringGeometry = new THREE.RingGeometry(.5, .57, 48).rotateX(-Math.PI / 2), ringMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#a48bff").multiplyScalar(2), transparent: true, opacity: .95, depthWrite: false });
  const blobs = new THREE.InstancedMesh(blobGeometry, blobMaterial, total), rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, total);
  for (const m of [blobs, rings]) { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
  blobs.renderOrder = 1; rings.renderOrder = 2;
  const hitGeometry = new THREE.BoxGeometry(.95, 1.75, .95), hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const extras = rooms.map((room) => room.map(() => { const hit = new THREE.Mesh(hitGeometry, hitMaterial); scene.add(hit); return { hit, entry: null as Entry | null }; }));
  // selection and hover markers
  const selectionMap = selectionTexture(), markerGeometry = new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2);
  const selectionMaterial = new THREE.MeshBasicMaterial({ map: selectionMap, color: new THREE.Color("#5dffa8").multiplyScalar(1.9), transparent: true, depthWrite: false, toneMapped: false });
  const selection = new THREE.Mesh(markerGeometry, selectionMaterial); selection.renderOrder = 3; selection.visible = false;
  const hoverMaterial = new THREE.MeshBasicMaterial({ color: "#e8f1ff", transparent: true, opacity: .55, depthWrite: false });
  const hoverRing = new THREE.Mesh(ringGeometry, hoverMaterial); hoverRing.renderOrder = 3; hoverRing.visible = false;
  scene.add(selection, hoverRing);

  // live data into slots: the Captain always takes the Captain's chair
  let lastEntries: Entry[] | null = null, lastSelected: string | null = null, missions = 0;
  const roster: Entry[][] = rooms.map(() => []), rosterCount = rooms.map(() => 0), drawn = rooms.map(() => -Infinity);
  function sync() {
    const { entries, selected } = options.input;
    if (entries === lastEntries && selected === lastSelected) return;
    lastEntries = entries; lastSelected = selected;
    missions = entries.filter((e) => e.kind === "frog" && e.frog?.mission && !e.frog.mission.done).length;
    const live = entries.some((e) => e.kind === "game");
    rooms.forEach((room, bay) => {
      const list = actorsForBay(entries, bay as Bay, selected, room.length), slots: (Entry | null)[] = room.map(() => null);
      const chair = LAYOUTS[bay]!.seats.findIndex((s) => s.kind === "captain"), captain = list.find((e) => e.key === "watcher:0");
      if (chair >= 0 && captain) slots[chair] = captain;
      let k = 0; for (const entry of list) { if (entry === captain && chair >= 0) continue; while (k < slots.length && slots[k]) k++; if (k < slots.length) slots[k++] = entry; }
      slots.forEach((entry, slot) => {
        const extra = extras[bay]![slot]!;
        if (entry && extra.entry?.key !== entry.key) crew.dress(room[slot]!, hash(entry.key));
        extra.entry = entry; extra.hit.userData.key = entry?.key;
        brains.assign(bay, slot, !!entry, !!entry, live && bay === 2);
      });
      roster[bay] = actorsForBay(entries, bay as Bay, null, 8); rosterCount[bay] = entries.filter((e) => e.bay === bay).length;
      drawn[bay] = -Infinity;
    });
  }
  const hips = new THREE.Vector3();
  /** World position of an on-duty frog by record key. */
  function frogAt(key: string | null, out: THREE.Vector3) {
    if (!key) return null;
    for (const [bay, room] of extras.entries()) for (const [slot, x] of room.entries()) {
      if (x.entry?.key !== key || !brains.minds[bay]![slot]!.active) continue;
      rooms[bay]![slot]!.hips.getWorldPosition(out); out.y = brains.minds[bay]![slot]!.y; return out;
    }
    return null;
  }

  // ---- RTS camera: a target on the deck floor, a distance, a pitch, and a heading (a phone held upright turns the deck to run down the screen)
  const target = new THREE.Vector3(MID.x, 0, MID.z), goal = target.clone();
  let dist = 40, distGoal = 40, shown: Bay = options.input.bay, follow: string | null = null, flying = false, picked = options.input.selected, upright = false;
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const yaw = () => (upright ? Math.PI / 2 : 0);
  const zoom = { min: 9, deck: 40, max: 60, room: 15 };
  /** Pulling out past the deck view lowers the camera, so the hull's armoured sides show. */
  const lidAt = (d: number) => smooth(zoom.deck * 1.04, zoom.max * .97, d);
  const pitchAt = (d: number) => PITCH + (PITCH_OUT - PITCH) * lidAt(d);
  /** What a camera at distance d sees on the floor around its target: half width, and the depth toward the far and near edges. */
  function reach(d: number, p = pitchAt(d)) {
    const v = THREE.MathUtils.degToRad(camera.fov) / 2, h = Math.atan(Math.tan(v) * camera.aspect), H = d * Math.sin(p), D = d * Math.cos(p);
    return { side: d * Math.tan(h), far: H / Math.tan(p - v) - D, near: D - H / Math.tan(p + v) };
  }
  /** The distance that frames a box (half sizes along the deck and across it). */
  function framing(box: { along: number; across: number }, p = PITCH) {
    const r = reach(1, p), [side, depth] = upright ? [box.across, box.along] : [box.along, box.across];
    return Math.max(side / r.side, depth / Math.min(r.far, r.near));
  }
  function ranges() {
    const v = THREE.MathUtils.degToRad(camera.fov) / 2;
    zoom.deck = framing(DECK); zoom.max = Math.max(framing(SHIP, PITCH_OUT), zoom.deck * 1.3); zoom.room = framing(ROOM);
    // close enough to read a frog, never so close that one fills more than a quarter of the view's height
    zoom.min = Math.min(3.1 / Math.tan(v), zoom.room);
  }
  /** Keeps the deck in frame: wide views stay centred on it, close views can pan but never past its hull. */
  function keep(v: THREE.Vector3, d = dist) {
    const r = reach(d), [sx, sz] = upright ? [Math.min(r.far, r.near), r.side] : [r.side, Math.min(r.far, r.near)];
    const lo = X0 - 1.9 + sx * .96, hi = X1 + 1.9 - sx * .96, front = ZB - 2 + sz * .9, back = ZF + 2 - sz * .9;
    v.x = lo > hi ? MID.x : clamp(v.x, lo, hi); v.z = front > back ? MID.z : clamp(v.z, front, back); v.y = 0;
    return v;
  }
  function place() {
    const a = yaw(), p = pitchAt(dist), flat = dist * Math.cos(p);
    camera.position.set(target.x + Math.sin(a) * flat, dist * Math.sin(p), target.z + Math.cos(a) * flat);
    camera.lookAt(target.x, 0, target.z); camera.updateMatrixWorld();
  }
  function floorAt(clientX: number, clientY: number, out: THREE.Vector3) {
    const rect = canvas.getBoundingClientRect();
    ndc.set((clientX - rect.left) / width * 2 - 1, 1 - (clientY - rect.top) / height * 2);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(floor, out);
  }
  /** The room whose floor holds a deck point (or the nearest). */
  const roomAt = (x: number, z: number) => { let best = 0; ROOMS.forEach((room, bay) => { if (Math.hypot(room.x - x, room.z - z) < Math.hypot(ROOMS[best]!.x - x, ROOMS[best]!.z - z)) best = bay; }); return best as Bay; };
  // what the camera sees on the floor: the four corners of the view, the rooms inside it
  const view = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], visible = new Set<number>();
  function survey() {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
    corners.forEach(([x, y], i) => {
      ndc.set(x, y); raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(floor, view[i]!)) view[i]!.set(target.x + x * 80, 0, target.z - 80);
    });
    const xs = view.map((p) => p.x), zs = view.map((p) => p.z), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    visible.clear(); ROOMS.forEach((room, bay) => { if (room.x + BAY_W / 2 >= x0 && room.x - BAY_W / 2 <= x1 && room.z + HALF_D >= z0 && room.z - HALF_D <= z1) visible.add(bay); });
  }
  function aim(dt: number, cut: boolean) {
    if (options.input.bay !== shown) { shown = options.input.bay; follow = null; goal.set(ROOMS[shown]!.x, 0, ROOMS[shown]!.z + .3); distGoal = zoom.room; flying = true; }
    if (options.input.selected !== picked) { picked = options.input.selected; follow = picked; if (follow) { flying = true; distGoal = clamp(Math.min(distGoal, zoom.room * .8), zoom.min, zoom.max); } }
    if (follow) { if (frogAt(follow, hips)) goal.set(hips.x, 0, hips.z); else follow = null; }
    distGoal = clamp(distGoal, zoom.min, zoom.max); keep(goal, distGoal);
    const k = cut ? 1 : 1 - Math.exp(-dt * 4.5);
    target.lerp(goal, k); dist += (distGoal - dist) * k; keep(target);
    if (flying && target.distanceTo(goal) < .04 && Math.abs(dist - distGoal) < .04) flying = false;
    place(); survey();
    // close in on one room and the page's room follows the camera
    const under = roomAt(target.x, target.z);
    if (!flying && dist < zoom.room * 1.35 && under !== shown) { shown = under; options.onBay?.(under); }
  }

  // ---- level of detail: who gets a full animated frog, and the instanced crew for everyone else
  const skin = SKINS.map((c) => new THREE.Color(c)), cloth = VESTS.map((c) => new THREE.Color(c));
  const lodMatrix = new THREE.Matrix4(), bounce = new THREE.Matrix4(), lent = new Set<string>();
  let lodAt = -Infinity;
  function lend(time: number) {
    if (time - lodAt < .3) return; lodAt = time;
    const close = dist < zoom.room * 1.3, want: [number, number, number][] = [];
    if (close) rooms.forEach((room, bay) => { if (!visible.has(bay)) return; room.forEach((actor, slot) => {
      if (!brains.minds[bay]![slot]!.active) return; actor.root.getWorldPosition(hips);
      want.push([hips.distanceToSquared(target) - (extras[bay]![slot]!.entry?.key === options.input.selected ? 1e6 : 0), bay, slot]);
    }); });
    want.sort((a, b) => a[0] - b[0]); const chosen = new Set(want.slice(0, POOL).map(([, b, s]) => `${b}:${s}`));
    for (const p of pool) if (p.slot && !chosen.has(`${p.slot[0]}:${p.slot[1]}`)) { p.slot = null; p.actor.root.visible = false; }
    for (const key of chosen) {
      if (pool.some((p) => p.slot && `${p.slot[0]}:${p.slot[1]}` === key)) continue;
      const free = pool.find((p) => !p.slot); if (!free) break;
      const [b, s] = key.split(":").map(Number) as [number, number]; free.slot = [b, s];
      const proxy = rooms[b]![s]!; crew.dress(free.actor, proxy.skin); crew.wear(free.actor, b); free.actor.clip = ""; crew.play(free.actor, proxy.clip, 0, proxy.speed ?? 1);
    }
    lent.clear(); for (const p of pool) if (p.slot) lent.add(`${p.slot[0]}:${p.slot[1]}`);
  }
  function drawCrew(dt: number, time: number) {
    // pulled right out to the whole ship, every frog is a card; otherwise the instanced low-poly frog
    const distant = lidAt(dist) > .3;
    low.begin(); far.begin(); let nb = 0, nr = 0;
    rooms.forEach((room, bay) => room.forEach((actor, slot) => {
      const mind = brains.minds[bay]![slot]!, x = extras[bay]![slot]!, on = visible.has(bay) && mind.active;
      x.hit.visible = on; if (!on) return;
      actor.root.updateWorldMatrix(true, false); actor.hips.getWorldPosition(hips);
      x.hit.position.set(hips.x, mind.y + .85, hips.z);
      lodMatrix.makeTranslation(hips.x, mind.y + .012, hips.z); blobs.setMatrixAt(nb++, lodMatrix);
      if (x.entry?.mine && x.entry.key !== options.input.selected) { lodMatrix.makeTranslation(hips.x, mind.y + .018, hips.z); rings.setMatrixAt(nr++, lodMatrix); }
      if (lent.has(`${bay}:${slot}`)) return;
      if (distant) { far.add(hips.x, mind.y, hips.z, camera); return; }
      const seated = mind.mode === "seated" || ((mind.mode === "rising" || mind.mode === "sitting") && mind.transit < .5);
      const walking = actor.clip === "Walking_A", cheer = actor.clip.includes("Cheer");
      const lift = still() ? 0 : walking ? Math.abs(Math.sin(time * 9 + slot)) * .06 : cheer ? Math.max(0, Math.sin(time * 6 + slot)) * .12 : Math.sin(time * 2 + slot * 1.7) * .012;
      bounce.makeTranslation(0, lift, 0); lodMatrix.multiplyMatrices(actor.root.matrixWorld, bounce);
      low.add(lodMatrix, skin[actor.skin % skin.length]!, cloth[bay % cloth.length]!, seated);
    }));
    low.end(); far.end(); blobs.count = nb; rings.count = nr; blobs.instanceMatrix.needsUpdate = true; rings.instanceMatrix.needsUpdate = true;
    // the lent frogs follow their stand-ins
    for (const p of pool) {
      if (!p.slot) continue; const proxy = rooms[p.slot[0]]![p.slot[1]]!, a = p.actor;
      if (!visible.has(p.slot[0])) { a.root.visible = false; continue; }
      proxy.root.matrixWorld.decompose(a.root.position, a.root.quaternion, a.root.scale); a.root.visible = true;
      if (a.clip !== proxy.clip) crew.play(a, proxy.clip, .25, proxy.speed ?? 1); else a.action?.setEffectiveTimeScale(proxy.speed ?? 1);
      a.mixer?.update(still() ? 0 : dt);
    }
  }

  // ---- input: drag or keys to pan, wheel or pinch to zoom, edge scrolling, tap to pick
  const pointers = new Map<number, { x: number; y: number }>(), grab = new THREE.Vector3(), probe = new THREE.Vector3(), before = new THREE.Vector3();
  let dragging = false, grabbing = false, downX = 0, downY = 0, pinch = 0, lastMove = 0, inside = false, mouseX = 0, mouseY = 0, edgeTime = 0;
  const keys = new Set<string>();
  const userMoved = () => { follow = null; flying = false; };
  function zoomAt(factor: number, clientX?: number, clientY?: number) {
    const anchored = clientX !== undefined && clientY !== undefined && !follow && floorAt(clientX, clientY, before);
    dist = distGoal = clamp(dist * factor, zoom.min, zoom.max); keep(target); goal.copy(target); place();
    if (anchored && floorAt(clientX!, clientY!, probe)) { target.add(before.sub(probe)); keep(target); goal.copy(target); place(); }
    invalidate();
  }

  // hover tag (pointer devices) above a frog's head
  const tag = document.createElement("div"); tag.className = "pv-deck-tag"; tag.hidden = true; canvas.parentElement?.appendChild(tag);
  let hovered: string | null = null;
  function placeTag() {
    hoverRing.visible = false;
    if (!hovered) { tag.hidden = true; return; }
    for (const [bay, room] of extras.entries()) for (const [slot, x] of room.entries()) {
      if (x.entry?.key !== hovered || !visible.has(bay)) continue;
      rooms[bay]![slot]!.hips.getWorldPosition(hips); const y = brains.minds[bay]![slot]!.y;
      if (hovered !== options.input.selected) { hoverRing.visible = true; hoverRing.position.set(hips.x, y + .02, hips.z); }
      hips.y = y + 1.95; hips.project(camera);
      if (hips.z > 1) { tag.hidden = true; return; }
      tag.hidden = false; tag.style.transform = `translate(${((hips.x + 1) / 2 * width).toFixed(1)}px, ${((1 - hips.y) / 2 * height).toFixed(1)}px) translate(-50%, -100%)`;
      return;
    }
    tag.hidden = true;
  }

  // the minimap in the corner: jump the camera to wherever it is clicked
  const minimap = canvas.parentElement ? createMinimap(canvas.parentElement, (x, z) => { userMoved(); goal.set(x, 0, z); keep(goal); target.copy(goal); invalidate(); }) : null;
  let mapDrawn = -Infinity;
  const blips: Blip[] = [];
  function drawMap(time: number) {
    if (!minimap || time - mapDrawn < .1) return; mapDrawn = time;
    blips.length = 0;
    brains.minds.forEach((room, bay) => room.forEach((mind, slot) => {
      if (!mind.active) return; const entry = extras[bay]![slot]!.entry, [x, z] = toDeck(bay, mind.x, mind.z);
      blips.push({ x, z, mine: !!entry?.mine, picked: !!entry && entry.key === options.input.selected });
    }));
    minimap.draw(blips, view, upright);
  }

  // frame timing, for the dev hook below
  const frameTimes: number[] = [], workTimes: number[] = [];
  let frame = 0, previous = 0, elapsed = 0, clock = 0, inView = true, width = 1, height = 1, first = true, annexDrawn = -Infinity;
  function still() { return options.reduced || options.input.paused; }
  function invalidate() { if (!disposed && !frame && !document.hidden && inView) frame = requestAnimationFrame(tick); }
  function steer(dt: number) {
    // keys and screen edges pan the camera along the screen's own axes; the speed scales with the zoom
    let sx = 0, sy = 0;
    if (keys.has("left")) sx -= 1; if (keys.has("right")) sx += 1; if (keys.has("up")) sy += 1; if (keys.has("down")) sy -= 1;
    if (inside && !grabbing && !options.reduced) {
      const edge = 18, ex = mouseX < edge ? -1 : mouseX > width - edge ? 1 : 0, ey = mouseY < edge ? 1 : mouseY > height - edge ? -1 : 0;
      if (ex || ey) { edgeTime += dt; if (edgeTime > .3) { sx += ex; sy += ey; } } else edgeTime = 0;
    }
    if (keys.has("in")) zoomAt(Math.exp(-dt * 1.6)); if (keys.has("out")) zoomAt(Math.exp(dt * 1.6));
    if (!sx && !sy) return false;
    userMoved(); const a = yaw(), speed = dist * .8 * dt;
    target.x += (Math.cos(a) * sx - Math.sin(a) * sy) * speed; target.z += (-Math.sin(a) * sx - Math.cos(a) * sy) * speed;
    keep(target); goal.copy(target);
    return true;
  }
  function tick(now: number) {
    frame = 0; if (disposed || document.hidden || !inView) return;
    const started = performance.now();
    if (import.meta.env.DEV) { renderer.info.autoReset = false; renderer.info.reset(); }
    const dt = previous ? Math.min(.05, (now - previous) / 1000) : 1 / 60;
    if (previous) { frameTimes.push(now - previous); if (frameTimes.length > 240) frameTimes.shift(); }
    previous = now; clock += dt;
    const cut = options.reduced || first; if (!still()) elapsed += dt;
    sync(); const steering = steer(dt); aim(dt, cut); rig();
    hull.lid(lidAt(dist));
    for (const bay of visible) if (!still()) brains.update(bay, dt);
    lend(clock); drawCrew(dt, elapsed);
    selection.visible = !!frogAt(options.input.selected, hips);
    if (selection.visible) {
      selection.position.set(hips.x, hips.y + .025, hips.z);
      if (!still()) { selection.rotation.y = elapsed * .9; selection.scale.setScalar(1 + Math.sin(elapsed * 5) * .035); }
    }
    interior.update(still() ? 0 : dt, elapsed);
    annex.update(still() ? 0 : dt, elapsed, options.input.extra, missions);
    const agents = options.input.extra.swarm?.agentsOnline ?? 0;
    drones.mesh.visible = visible.has(5) && agents > 0;
    if (drones.mesh.visible) drones.update(Math.min(DRONES, Math.ceil(agents / 10)), annex.dishCenter, elapsed);
    for (const bay of visible) if (bay < 4 && elapsed - drawn[bay]! >= 1) { interior.draw(bay, roster[bay]!, rosterCount[bay]!, extras[bay]!.map((x) => x.entry), elapsed); drawn[bay] = elapsed; }
    if ([...visible].some((b) => b >= 4) && elapsed - annexDrawn >= 1) { annex.draw(options.input.extra, missions); annexDrawn = elapsed; }
    outside.update(camera, elapsed); placeTag(); drawMap(clock);
    try { if (composer) composer.render(dt); else renderer.render(scene, camera); } catch { options.onUnavailable(); return; }
    workTimes.push(performance.now() - started); if (workTimes.length > 240) workTimes.shift();
    first = false;
    const settling = target.distanceTo(goal) > .01 || Math.abs(dist - distGoal) > .01;
    if (!still() || flying || follow || settling || steering || keys.size || (inside && edgeTime > 0)) invalidate();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, LOW ? 1 : PHONE ? 1.25 : 1.75)); renderer.setSize(width, height, false); composer?.setSize(width, height, false);
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2()); outside.resize(buffer.x, buffer.y);
    camera.aspect = width / height; upright = camera.aspect < .9;
    camera.fov = camera.aspect < 1 ? 46 : camera.aspect < 1.6 ? 38 : 34; camera.updateProjectionMatrix();
    ranges();
    // open on the whole deck, framed like the concept: all eight rooms
    if (first) { dist = distGoal = zoom.deck; target.set(MID.x, 0, MID.z); goal.copy(target); }
    else { distGoal = clamp(distGoal, zoom.min, zoom.max); dist = clamp(dist, zoom.min, zoom.max); }
    keep(target); keep(goal, distGoal);
    first = true; invalidate();
  }
  function visibility() { if (document.hidden || !inView) { cancelAnimationFrame(frame); frame = 0; previous = 0; } else invalidate(); }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
  const intersection = new IntersectionObserver(([entry]) => { inView = !!entry?.isIntersecting; visibility(); }); intersection.observe(canvas);
  const hitAt = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect(); ndc.set((event.clientX - rect.left) / width * 2 - 1, 1 - (event.clientY - rect.top) / height * 2);
    raycaster.setFromCamera(ndc, camera);
    const targets = extras.flatMap((room) => room.filter((x) => x.hit.visible).map((x) => x.hit));
    return raycaster.intersectObjects(targets, false)[0]?.object.userData.key as string | undefined;
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); canvas.setPointerCapture(event.pointerId);
    if (pointers.size === 1) { downX = event.clientX; downY = event.clientY; dragging = false; grabbing = !!floorAt(event.clientX, event.clientY, grab); }
    else { dragging = true; grabbing = false; pinch = 0; }
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType === "mouse") { const rect = canvas.getBoundingClientRect(); mouseX = event.clientX - rect.left; mouseY = event.clientY - rect.top; inside = true; }
    const held = pointers.get(event.pointerId);
    if (held) {
      held.x = event.clientX; held.y = event.clientY;
      if (pointers.size >= 2) {
        // pinch to zoom around the midpoint
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) zoomAt(pinch / d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = d; userMoved(); return;
      }
      if (!dragging && Math.hypot(event.clientX - downX, event.clientY - downY) > 7) { dragging = true; userMoved(); canvas.style.cursor = "grabbing"; }
      if (dragging && grabbing && floorAt(event.clientX, event.clientY, probe)) { target.add(grab.clone().sub(probe)); keep(target); goal.copy(target); place(); invalidate(); }
      return;
    }
    if (event.pointerType !== "mouse") return;
    invalidate();
    if (event.timeStamp - lastMove < 70) return; lastMove = event.timeStamp;
    const key = hitAt(event) ?? null; if (key === hovered) return;
    hovered = key; canvas.style.cursor = key ? "pointer" : "";
    const entry = extras.flat().find((x) => x.entry?.key === key)?.entry;
    tag.replaceChildren(); if (entry) { const b = document.createElement("b"), s = document.createElement("span"); b.textContent = entry.title; s.textContent = entry.activity; tag.append(b, s); }
  };
  const up = (event: PointerEvent) => {
    const was = pointers.has(event.pointerId); pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (!pointers.size) { grabbing = false; canvas.style.cursor = hovered ? "pointer" : ""; }
    if (!was || dragging || event.type === "pointercancel") { if (!pointers.size) dragging = false; return; }
    const key = hitAt(event); if (key) options.onPick(key);
  };
  const leave = () => { inside = false; edgeTime = 0; hovered = null; canvas.style.cursor = ""; tag.hidden = true; hoverRing.visible = false; invalidate(); };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
    zoomAt(Math.exp(clamp(delta, -200, 200) * .0015), event.clientX, event.clientY);
  };
  const KEYS: Record<string, string> = { ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right", ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", "+": "in", "=": "in", "-": "out", _: "out" };
  const typing = () => { const el = document.activeElement; return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable); };
  const press = (event: KeyboardEvent) => {
    // keys steer the map while the pointer is over it, or while the map itself has keyboard focus
    const focused = !!canvas.parentElement && document.activeElement === canvas.parentElement;
    const name = KEYS[event.key]; if (!name || !(inside || focused) || typing() || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault(); keys.add(name); invalidate();
  };
  const release = (event: KeyboardEvent) => { const name = KEYS[event.key]; if (name) keys.delete(name); };
  const blur = () => keys.clear();
  function lost(event: Event) { event.preventDefault(); options.onUnavailable(); }
  canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", leave); canvas.addEventListener("wheel", wheel, { passive: false });
  window.addEventListener("keydown", press); window.addEventListener("keyup", release); window.addEventListener("blur", blur);
  canvas.addEventListener("webglcontextlost", lost); document.addEventListener("visibilitychange", visibility);

  // development only: a hook for screenshots and frame timing (stripped from production builds)
  if (import.meta.env.DEV) {
    const stat = (list: number[]) => { const s = [...list].sort((a, b) => a - b); return s.length ? { avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2), p95: +s[Math.floor(s.length * .95)]!.toFixed(2), n: s.length } : null; };
    (window as unknown as { __deck?: unknown }).__deck = {
      view(x: number | "mid", z: number | "mid", d: number | "deck" | "max" | "room" | "min") {
        userMoved(); distGoal = dist = typeof d === "number" ? d : zoom[d]; goal.set(x === "mid" ? MID.x : x, 0, z === "mid" ? MID.z : z); keep(goal, distGoal); target.copy(goal); keep(target); first = true; invalidate();
      },
      select(key?: string) {
        const k = key ?? extras.flat().find((x) => x.entry && x.hit.visible)?.entry?.key ?? null;
        options.input.selected = k; invalidate(); return k;
      },
      zoom: () => ({ ...zoom, dist, upright, low: LOW }),
      scene, composer, renderer,
      /** Renders one frame now and returns the canvas as a PNG data URL (read back in the same task). */
      snap() { cancelAnimationFrame(frame); frame = 0; tick(performance.now()); return canvas.toDataURL("image/png"); },
      crew: () => ({ slots: total, active: brains.minds.flat().filter((m) => m.active).length, lowPoly: low.count(), cards: far.mesh.count, lent: lent.size, drones: drones.mesh.visible ? drones.mesh.count : 0, lowTris: low.triangles, droneTris: drones.triangles }),
      stats: () => ({ frame: stat(frameTimes), work: stat(workTimes), low: LOW, pixelRatio: renderer.getPixelRatio(), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
      reset() { frameTimes.length = 0; workTimes.length = 0; },
    };
  }
  resize();
  return {
    invalidate,
    dispose() {
      if (disposed) return; disposed = true; cancelAnimationFrame(frame); resizeObserver.disconnect(); intersection.disconnect(); tag.remove(); minimap?.dispose();
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", leave); canvas.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", press); window.removeEventListener("keyup", release); window.removeEventListener("blur", blur);
      canvas.removeEventListener("webglcontextlost", lost); document.removeEventListener("visibilitychange", visibility);
      if (import.meta.env.DEV) delete (window as unknown as { __deck?: unknown }).__deck;
      crew.dispose(); interior.dispose(); annex.dispose(); outside.dispose(); hull.dispose(); low.dispose(); far.dispose(); drones.dispose();
      caps.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
      for (const d of [blobMap, blobGeometry, blobMaterial, ringGeometry, ringMaterial, hitGeometry, hitMaterial, selectionMap, markerGeometry, selectionMaterial, hoverMaterial]) d.dispose();
      blobs.dispose(); rings.dispose();
      composer?.dispose(); scene.clear(); renderer.dispose(); renderer.forceContextLoss();
    },
  };
}
