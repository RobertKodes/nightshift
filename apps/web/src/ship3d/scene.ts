import * as THREE from "three";
import { BloomEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect } from "postprocessing";
import { LITE, PHONE } from "../lite";
import { createBrains } from "./brain";
import { createDeckCrew } from "./crew";
import { actorsForBay, type Bay, type Entry } from "./data";
import { createInterior } from "./interior";
import { BAY_W, LAYOUTS, bayX, slotsOf } from "./layout";
import { createOutside } from "./outside";

export type DeckInput = { bay: Bay; entries: Entry[]; selected: string | null; paused: boolean };
type Options = { input: DeckInput; reduced: boolean; signal: AbortSignal; onPick: (key: string) => void; onUnavailable: () => void };

const hash = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };
const turn = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Soft reflections of an interior: a grey room, three warm ceiling strips and the dark window. */
function roomEnvironment(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene(), disposables: { dispose(): void }[] = [];
  const add = (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, power: number, x: number, y: number, z: number, side: THREE.Side = THREE.FrontSide) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side }); disposables.push(geometry, material);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); scene.add(mesh); return mesh;
  };
  add(new THREE.BoxGeometry(12, 3.4, 10), "#55575a", .55, 0, .1, 0, THREE.BackSide);
  add(new THREE.BoxGeometry(12, .02, 10), "#24272b", .6, 0, -1.58, 0);
  for (const z of [-2.6, .2, 3.0]) add(new THREE.BoxGeometry(11, .05, .3), "#ffe2bc", 7, 0, 1.75, z);
  add(new THREE.PlaneGeometry(9.4, 2), "#0b1a33", 1.4, 0, .35, -4.9);
  add(new THREE.PlaneGeometry(9.4, .08), "#5d8fff", 3, 0, .05, -4.89);
  const generator = new THREE.PMREMGenerator(renderer);
  try { return generator.fromScene(scene, .03, .1, 40); }
  finally { generator.dispose(); disposables.forEach((d) => d.dispose()); }
}

/** The operations deck: four lit rooms of working frogs, their live screens, and the Earth outside. */
export async function createDeckScene(canvas: HTMLCanvasElement, options: Options) {
  const crew = await createDeckCrew();
  if (options.signal.aborted) { crew.dispose(); throw new Error("Cancelled"); }
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: LITE, stencil: false, powerPreference: "high-performance" }); }
  catch (error) { crew.dispose(); throw error; }
  const shadows = !LITE && !PHONE;
  renderer.debug.onShaderError = () => options.onUnavailable();
  renderer.setClearColor("#000000"); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = LITE ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping; renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .08, 520);
  const environment = roomEnvironment(renderer); scene.environment = environment.texture; scene.environmentIntensity = .9;
  let composer: EffectComposer | null = null;
  if (!LITE) {
    composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: Math.min(4, renderer.capabilities.maxSamples) });
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new EffectPass(camera, new BloomEffect({ intensity: PHONE ? .75 : .9, luminanceThreshold: .82, luminanceSmoothing: .2, mipmapBlur: true, radius: .66 }), new VignetteEffect({ darkness: .5, offset: .32 }), new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));
  }

  // light rig: it travels with the camera from room to room
  const hemi = new THREE.HemisphereLight("#c9d4e0", "#2c2824", .5);
  const key = new THREE.DirectionalLight("#fff0dc", 1.7);
  if (shadows) {
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -.0004; key.shadow.normalBias = .03; key.shadow.radius = 3;
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 6.5, bottom: -6.5, near: 1, far: 24 }); key.shadow.camera.updateProjectionMatrix();
  }
  const warm = new THREE.PointLight("#ffd5a3", 26, 14, 2), glow = new THREE.PointLight("#6fc3ff", 8, 7, 2), earthLight = new THREE.PointLight("#6c92d6", 18, 11, 2);
  scene.add(hemi, key, key.target, warm, glow, earthLight);
  let anchor = bayX(options.input.bay);
  const glowColor = new THREE.Color(LAYOUTS[options.input.bay]!.glow.color), tmpColor = new THREE.Color();
  function rig(dt: number, cut: boolean) {
    const bay = Math.max(0, Math.min(3, Math.round(camera.position.x / BAY_W))), target = bayX(bay), layout = LAYOUTS[bay]!;
    anchor = cut ? target : anchor + (target - anchor) * (1 - Math.exp(-dt * 3));
    key.position.set(anchor + 2.2, 9, 3.2); key.target.position.set(anchor, 0, -.6);
    warm.position.set(anchor, 3.0, .9); earthLight.position.set(anchor, 1.9, -4.3);
    glow.position.set(anchor + layout.glow.at[0], layout.glow.at[1], layout.glow.at[2]);
    glowColor.lerp(tmpColor.set(layout.glow.color), cut ? 1 : 1 - Math.exp(-dt * 3)); glow.color.copy(glowColor);
  }

  const interior = createInterior(); scene.add(interior.group);
  let disposed = false;
  const outside = createOutside(() => { if (!disposed) invalidate(); }); scene.add(outside.group);
  void interior.ready.then(() => { if (!disposed) invalidate(); });

  // the crew: one actor per slot in every room, with a contact shadow, an ownership ring and a tap target
  const rooms = LAYOUTS.map((_, bay) => Array.from({ length: slotsOf(bay) }, (_, slot) => { const actor = crew.create(bay * 8 + slot, bay); actor.root.visible = false; scene.add(actor.root); return actor; }));
  const brains = createBrains(crew, interior, rooms);
  const blobCanvas = document.createElement("canvas"); blobCanvas.width = blobCanvas.height = 64;
  const blobContext = blobCanvas.getContext("2d");
  if (blobContext) { const g = blobContext.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(0,0,0,.62)"); g.addColorStop(.55, "rgba(0,0,0,.3)"); g.addColorStop(1, "rgba(0,0,0,0)"); blobContext.fillStyle = g; blobContext.fillRect(0, 0, 64, 64); }
  const blobMap = new THREE.CanvasTexture(blobCanvas), blobGeometry = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2), blobMaterial = new THREE.MeshBasicMaterial({ map: blobMap, transparent: true, depthWrite: false, toneMapped: false });
  const ringGeometry = new THREE.RingGeometry(.5, .56, 48).rotateX(-Math.PI / 2), ringMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#bba6df").multiplyScalar(1.8), transparent: true, opacity: .9, depthWrite: false });
  const hitGeometry = new THREE.BoxGeometry(.95, 1.75, .95), hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const extras = rooms.map((room) => room.map(() => {
    const blob = new THREE.Mesh(blobGeometry, blobMaterial), ring = new THREE.Mesh(ringGeometry, ringMaterial), hit = new THREE.Mesh(hitGeometry, hitMaterial);
    blob.renderOrder = 1; ring.renderOrder = 2; scene.add(blob, ring, hit); return { blob, ring, hit, entry: null as Entry | null };
  }));

  // live data into slots: the Captain always takes the Captain's chair
  let lastEntries: Entry[] | null = null, lastSelected: string | null = null;
  const roster: Entry[][] = rooms.map(() => []), rosterCount = rooms.map(() => 0), drawn = rooms.map(() => -Infinity);
  function sync() {
    const { entries, selected } = options.input;
    if (entries === lastEntries && selected === lastSelected) return;
    lastEntries = entries; lastSelected = selected;
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

  // camera: a fixed shot per room with a slow drift, flights through the doorways, a close shot of a picked frog
  const eye = new THREE.Vector3(), look = new THREE.Vector3(), goalEye = new THREE.Vector3(), goalLook = new THREE.Vector3(), current = new THREE.Vector3(), hips = new THREE.Vector3();
  let shown: number = options.input.bay, flight: { curve: THREE.CatmullRomCurve3; sight: THREE.CatmullRomCurve3; t: number; duration: number; bays: Set<number> } | null = null;
  function shot(bay: number, drift: number) {
    const layout = LAYOUTS[bay]!, x = bayX(bay);
    goalLook.set(x + layout.look[0] + Math.sin(drift * .09 + .8) * .3, layout.look[1], layout.look[2]);
    goalEye.set(x + layout.eye[0] + Math.sin(drift * .09) * .45, layout.eye[1] + Math.sin(drift * .13) * .06, layout.eye[2]);
    // a narrow screen sees less of the room from the same place: rise a little and look further down instead of backing through the wall
    if (camera.aspect < 1.2) { goalEye.y += (1.2 - camera.aspect) * .6; goalLook.set(x + layout.narrow[0] + Math.sin(drift * .09 + .8) * .3, layout.narrow[1], layout.narrow[2]); }
  }
  function fly(to: number) {
    const from = shown; shown = to;
    if (still() || first) { flight = null; return; }
    // the eye goes through each doorway above head height; the gaze runs ahead into the next room
    const points = [camera.position.clone()], sights = [current.clone()], step = Math.sign(to - from), bays = new Set([from, to]);
    for (let b = from; b !== to; b += step) {
      const wall = bayX(b) + step * BAY_W / 2; bays.add(b);
      points.push(new THREE.Vector3(wall - step * 3, 2.85, 2.1), new THREE.Vector3(wall, 2.1, 0), new THREE.Vector3(wall + step * 3, 2.85, 2.1));
      sights.push(new THREE.Vector3(wall + step * 2.5, 1.15, -1.2));
    }
    shot(to, elapsed); points.push(goalEye.clone()); sights.push(goalLook.clone());
    flight = { curve: new THREE.CatmullRomCurve3(points, false, "centripetal"), sight: new THREE.CatmullRomCurve3(sights, false, "centripetal"), t: 0, duration: Math.min(3.4, 1.2 + 1.1 * Math.abs(to - from)), bays };
  }
  function aim(dt: number, cut: boolean) {
    if (options.input.bay !== shown) fly(options.input.bay);
    if (flight && !cut) {
      flight.t = Math.min(1, flight.t + dt / flight.duration); const u = ease(flight.t);
      flight.curve.getPointAt(u, eye); flight.sight.getPoint(u, look);
      camera.position.copy(eye); current.copy(look);
      if (flight.t >= 1) flight = null;
    } else {
      flight = null; shot(shown, elapsed);
      const slot = extras[shown]!.findIndex((x) => x.entry?.key === options.input.selected), mind = slot >= 0 ? brains.minds[shown]![slot] : undefined;
      if (mind?.active) {
        // a close shot from in front of the frog, turned toward the room camera, from just above head height
        rooms[shown]![slot]!.hips.getWorldPosition(hips);
        if (focusKey !== options.input.selected) { focusKey = options.input.selected; focusAngle = mind.heading + clamp(turn(Math.atan2(goalEye.x - hips.x, goalEye.z - hips.z) - mind.heading), -.65, .65); }
        goalLook.set(hips.x, mind.y + 1.0, hips.z); goalEye.set(hips.x + Math.sin(focusAngle) * 2.4, mind.y + 2.15, hips.z + Math.cos(focusAngle) * 2.4);
        goalEye.x = clamp(goalEye.x, bayX(shown) - 5.3, bayX(shown) + 5.3); goalEye.z = clamp(goalEye.z, -4.4, 4.5);
      } else focusKey = null;
      const k = cut ? 1 : 1 - Math.exp(-dt * 2.6);
      camera.position.lerp(goalEye, k); current.lerp(goalLook, cut ? 1 : 1 - Math.exp(-dt * 3.2));
    }
    camera.lookAt(current); camera.updateMatrixWorld();
  }
  let focusKey: string | null = null, focusAngle = 0;
  const visibleBays = () => flight ? flight.bays : new Set([shown]);

  // hover tag (pointer devices) above a frog's head
  const tag = document.createElement("div"); tag.className = "pv-deck-tag"; tag.hidden = true; canvas.parentElement?.appendChild(tag);
  let hovered: string | null = null;
  function placeTag() {
    if (!hovered) { tag.hidden = true; return; }
    for (const [bay, room] of extras.entries()) for (const [slot, x] of room.entries()) {
      if (x.entry?.key !== hovered || !visibleBays().has(bay)) continue;
      rooms[bay]![slot]!.hips.getWorldPosition(hips); hips.y = brains.minds[bay]![slot]!.y + 1.95; hips.project(camera);
      if (hips.z > 1) { tag.hidden = true; return; }
      tag.hidden = false; tag.style.transform = `translate(${((hips.x + 1) / 2 * width).toFixed(1)}px, ${((1 - hips.y) / 2 * height).toFixed(1)}px) translate(-50%, -100%)`;
      return;
    }
    tag.hidden = true;
  }

  let frame = 0, previous = 0, elapsed = 0, inView = true, width = 1, height = 1, first = true;
  function still() { return options.reduced || options.input.paused; }
  function invalidate() { if (!disposed && !frame && !document.hidden && inView) frame = requestAnimationFrame(tick); }
  function tick(now: number) {
    frame = 0; if (disposed || document.hidden || !inView) return;
    const dt = previous ? Math.min(.05, (now - previous) / 1000) : 1 / 60; previous = now;
    const cut = still() || first; if (!still()) elapsed += dt;
    sync(); aim(dt, cut); rig(dt, cut);
    const bays = visibleBays();
    rooms.forEach((room, bay) => {
      const showing = bays.has(bay);
      if (showing && !still()) brains.update(bay, dt);
      room.forEach((actor, slot) => {
        const mind = brains.minds[bay]![slot]!, x = extras[bay]![slot]!, on = showing && mind.active;
        actor.root.visible = x.blob.visible = x.hit.visible = on; x.ring.visible = on && !!x.entry && (x.entry.mine || x.entry.key === options.input.selected);
        if (!on) return;
        actor.mixer.update(still() ? 0 : dt);
        actor.hips.getWorldPosition(hips); x.blob.position.set(hips.x, mind.y + .012, hips.z); x.ring.position.set(hips.x, mind.y + .018, hips.z); x.hit.position.set(hips.x, mind.y + .85, hips.z);
      });
    });
    interior.update(still() ? 0 : dt, elapsed);
    for (const bay of bays) if (elapsed - drawn[bay]! >= 1) { interior.draw(bay, roster[bay]!, rosterCount[bay]!, extras[bay]!.map((x) => x.entry), elapsed); drawn[bay] = elapsed; }
    outside.update(camera, elapsed); placeTag();
    try { if (composer) composer.render(dt); else renderer.render(scene, camera); } catch { options.onUnavailable(); return; }
    first = false;
    if (!still() || flight) invalidate();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, LITE ? 1 : PHONE ? 1.5 : 1.75)); renderer.setSize(width, height, false); composer?.setSize(width, height, false);
    camera.aspect = width / height; camera.fov = camera.aspect < 1 ? 58 : camera.aspect < 1.6 ? 50 : 40; camera.updateProjectionMatrix(); first = true; invalidate();
  }
  function visibility() { if (document.hidden || !inView) { cancelAnimationFrame(frame); frame = 0; previous = 0; } else invalidate(); }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
  const intersection = new IntersectionObserver(([entry]) => { inView = !!entry?.isIntersecting; visibility(); }); intersection.observe(canvas);
  const raycaster = new THREE.Raycaster(), point = new THREE.Vector2(); let downX = 0, downY = 0, lastMove = 0;
  const hitAt = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect(); point.set((event.clientX - rect.left) / width * 2 - 1, 1 - (event.clientY - rect.top) / height * 2);
    raycaster.setFromCamera(point, camera);
    const targets = extras.flatMap((room) => room.filter((x) => x.hit.visible).map((x) => x.hit));
    return raycaster.intersectObjects(targets, false)[0]?.object.userData.key as string | undefined;
  };
  const down = (event: PointerEvent) => { downX = event.clientX; downY = event.clientY; };
  const up = (event: PointerEvent) => {
    if (event.button !== 0 || Math.hypot(event.clientX - downX, event.clientY - downY) > 8) return;
    const key = hitAt(event); if (key) options.onPick(key);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || event.timeStamp - lastMove < 70) return; lastMove = event.timeStamp;
    const key = hitAt(event) ?? null; if (key === hovered) return;
    hovered = key; canvas.style.cursor = key ? "pointer" : "";
    const entry = extras.flat().find((x) => x.entry?.key === key)?.entry;
    tag.replaceChildren(); if (entry) { const b = document.createElement("b"), s = document.createElement("span"); b.textContent = entry.title; s.textContent = entry.activity; tag.append(b, s); }
    invalidate();
  };
  const leave = () => { hovered = null; canvas.style.cursor = ""; tag.hidden = true; };
  function lost(event: Event) { event.preventDefault(); options.onUnavailable(); }
  canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("webglcontextlost", lost); document.addEventListener("visibilitychange", visibility);
  resize();
  return {
    invalidate,
    dispose() {
      if (disposed) return; disposed = true; cancelAnimationFrame(frame); resizeObserver.disconnect(); intersection.disconnect(); tag.remove();
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("webglcontextlost", lost); document.removeEventListener("visibilitychange", visibility);
      crew.dispose(); interior.dispose(); outside.dispose(); scene.environment = null; environment.dispose();
      for (const d of [blobMap, blobGeometry, blobMaterial, ringGeometry, ringMaterial, hitGeometry, hitMaterial]) d.dispose();
      composer?.dispose(); scene.clear(); renderer.dispose(); renderer.forceContextLoss();
    },
  };
}
