import * as THREE from "three";
import { createBackdrop } from "./backdrop";
import { createEnvironment } from "./environment";
import { createFlows } from "./flows";
import { createFlight } from "./flight";
import { createLabels } from "./labels";
import { damp, settle, spring } from "./motion";
import { glowTexture } from "./geometry";
import { createShip } from "./ship";
import { createStation } from "./station";
import { LITE } from "../lite";
import { DOCKS, type FlightInput } from "./stops";

type SceneOptions = {
  input: FlightInput; onDemand?: boolean; reduced?: boolean;
  onReady: () => void; onUnavailable: () => void; onDock: (index: number) => void;
};

/** A small, deterministic depth layer; all other light is in the station and Earth. */
function createStars() {
  const geometry = new THREE.BufferGeometry(), positions = new Float32Array(240 * 3), phases = new Float32Array(240);
  let seed = 17;
  const random = () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 240; i++) { positions.set([(random() - .5) * 120, (random() - .25) * 85, -65 - random() * 18], i * 3); phases[i] = random() * 6.28; }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3)); geometry.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, dpr: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float phase; uniform float time; uniform float dpr; varying float vLight;
      void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); vLight = .2 + .35 * (sin(time * .7 + phase) * .5 + .5);
      gl_Position = projectionMatrix * p; gl_PointSize = (1.0 + vLight) * dpr; }`,
    fragmentShader: `varying float vLight; void main() { float r = length(gl_PointCoord - .5); gl_FragColor = vec4(.7, .65, 1.0, (1.0 - smoothstep(.05, .5, r)) * vLight); }`,
  });
  return { points: new THREE.Points(geometry, material), material };
}

/** A reversible scroll flight, or a single render for a still dock header. */
export function createStationScene(canvas: HTMLCanvasElement, options: SceneOptions) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LITE && !matchMedia("(pointer: coarse)").matches, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor("#05030d"); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, .15, 220);
  const environment = createEnvironment(renderer); scene.environment = environment.texture; scene.environmentIntensity = .42;
  const map = glowTexture(), station = createStation(map, options.input.header ? Math.round(options.input.progress) - 1 : -1), ship = createShip(map), flows = createFlows(map), stars = createStars();
  station.group.add(flows.group, ship.group); scene.add(station.group, stars.points, camera);
  scene.add(new THREE.HemisphereLight("#9c8cc9", "#090516", .22));
  const key = new THREE.DirectionalLight("#ffe0bb", 2.15); key.position.set(-8, 13, 14); scene.add(key);
  const rim = new THREE.DirectionalLight("#9865ff", 6); rim.position.set(5, 7, -12); scene.add(rim);
  const blue = new THREE.DirectionalLight("#527fe0", .65); blue.position.set(10, 2, 5); scene.add(blue);
  const atmosphere = new THREE.DirectionalLight("#8b85ff", 1.15); atmosphere.position.set(0, -6, 8); scene.add(atmosphere);

  let width = 1, height = 1, phone = false, inView = true, disposed = false, lost = false, painted = false;
  let frame = 0, previous = 0, elapsed = 0, first = true, direction = 1, lastRaw = options.input.progress;
  const scrollMotion = spring(options.input.progress), speedMotion = spring(0), pointerX = spring(0), pointerY = spring(0);
  const flight = createFlight(camera, station, options.input);
  const labels = createLabels(camera, station, options.input);
  const backdrop = createBackdrop(camera, canvas.getBoundingClientRect().width > 820 && !matchMedia("(pointer: coarse)").matches);
  const count = DOCKS.length;
  const rotations = [-.55, ...DOCKS.map((dock) => dock.angle - Math.PI / 2), DOCKS[count - 1]!.angle - Math.PI / 2 + .25];
  // The guide parks to the port side of every bay, outside the selected doorway's silhouette.
  const entry = (i: number, radius = 7.5) => {
    const a = DOCKS[i]!.angle;
    return new THREE.Vector3(Math.cos(a) * radius - Math.sin(a) * 2.4, 1.9, Math.sin(a) * radius + Math.cos(a) * 2.4);
  };
  const guideCurves = Array.from({ length: count + 1 }, (_, i) => new THREE.CubicBezierCurve3(
    i === 0 ? new THREE.Vector3(4.3, 2.4, 8.2) : entry(i - 1),
    i === 0 ? new THREE.Vector3(5, 3, 9) : entry(i - 1, 8.4),
    i === count ? new THREE.Vector3(-6, 3, 9) : entry(i, 8.4),
    i === count ? new THREE.Vector3(-3.5, 3, 7) : entry(i),
  ));
  const guide = new THREE.Vector3(), heading = new THREE.Matrix4(), guideHeading = new THREE.Quaternion();

  function continuous() { return !options.onDemand && !options.reduced && !options.input.still; }
  function invalidate() {
    if (disposed || lost || document.hidden || !inView || frame) return;
    frame = requestAnimationFrame(tick);
  }
  void backdrop.ready.then(() => { if (!disposed) { painted = true; invalidate(); } }).catch(() => { if (!disposed) unavailable(); });

  function resize() {
    const rect = canvas.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height); phone = width <= 820 || (width <= 1100 && height <= 540 && matchMedia("(pointer: coarse)").matches);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LITE ? 1 : 1.75));
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    stars.material.uniforms.dpr!.value = renderer.getPixelRatio(); flight.resize(width, height); invalidate();
  }
  function tick(now: number) {
    frame = 0;
    if (disposed || lost || !inView || document.hidden) return;
    const cut = !continuous(), dt = previous ? Math.min((now - previous) / 1000, .05) : 1 / 60;
    previous = now; if (!cut) elapsed += dt;
    const raw = THREE.MathUtils.clamp(options.input.progress, 0, count + 1);
    const speed = damp(speedMotion, Math.abs(raw - lastRaw) / dt, .18, dt); lastRaw = raw;
    const p = cut ? raw : THREE.MathUtils.clamp(damp(scrollMotion, settle(raw, speed), .24, dt), 0, count + 1);
    if (cut) { scrollMotion.value = raw; scrollMotion.velocity = 0; }
    if (Math.abs(scrollMotion.velocity) > .005) direction = Math.sign(scrollMotion.velocity);
    const px = cut ? 0 : damp(pointerX, options.input.pointerX, .4, dt), py = cut ? 0 : damp(pointerY, options.input.pointerY, .4, dt);
    const stop = Math.min(count, Math.floor(p)), t = p - stop, eased = t * t * (3 - 2 * t);
    const hero = options.input.header ? 0 : 1 - THREE.MathUtils.smoothstep(p, 1, 1.9);
    station.group.rotation.y = THREE.MathUtils.lerp(rotations[stop]!, rotations[stop + 1]!, eased) + Math.sin(elapsed * .09) * .17 * hero;
    station.group.rotation.x = phone ? Math.sin(elapsed * .18) * .003 : py * .012;
    station.group.updateMatrixWorld(true);
    flight.update(p, elapsed, px, dt, cut);
    backdrop.update(p, px, py, phone); stars.material.uniforms.time!.value = elapsed;
    station.navigation.material.uniforms.time!.value = elapsed;
    station.hubHalo.material.opacity = (options.input.header ? .06 : .19) + Math.sin(elapsed * .45) * .02;
    const arrival = 1 - THREE.MathUtils.smoothstep(Math.abs(p - Math.round(p)), .025, .18);
    const guideProgress = THREE.MathUtils.clamp(p + direction * .1 * (1 - arrival), 0, count + 1);
    const guideSegment = Math.min(count, Math.floor(guideProgress)), guideTime = guideProgress - guideSegment;
    const curve = guideCurves[guideSegment]!;
    curve.getPoint(guideTime, guide); ship.group.position.copy(guide);
    curve.getTangent(guideTime, guide).multiplyScalar(direction).add(ship.group.position);
    // As it settles, the frog faces forward so its eyes and smile remain visible.
    const arrived = DOCKS[THREE.MathUtils.clamp(Math.round(p) - 1, 0, count - 1)]!;
    if (arrival > .8) guide.copy(ship.group.position).add(new THREE.Vector3(Math.cos(arrived.angle), .05, Math.sin(arrived.angle)));
    guideHeading.setFromRotationMatrix(heading.lookAt(guide, ship.group.position, THREE.Object3D.DEFAULT_UP));
    if (cut || first) ship.group.quaternion.copy(guideHeading); else ship.group.quaternion.slerp(guideHeading, 1 - Math.exp(-dt * 5));
    ship.trails.forEach((trail, i) => { trail.scale.z = .96 + Math.sin(elapsed * 11 + i) * .065; });
    station.docks.forEach((dock, i) => {
      const focus = THREE.MathUtils.smoothstep(1 - Math.abs(p - i - 1), 0, 1), pulse = 1 + Math.sin(elapsed * 1.8) * .045 * focus;
      const dim = options.input.header ? .12 + focus * .88 : 1;
      dock.door.position.y = .86 + focus * .58;
      dock.halo.material.opacity = (.35 + focus * .6) * pulse * dim; dock.halo.scale.set(3.3 + focus * .55, 3.3 + focus * .55, 1);
      dock.beacon.material.opacity = (.6 + focus * .4) * dim; dock.interior.material.opacity = (.62 + focus * .28) * dim;
      dock.lighting.color.set(DOCKS[i]!.color).multiplyScalar((1.45 + focus * 1.1) * pulse * dim);
      dock.beam.visible = focus > .02; dock.beam.material.uniforms.strength!.value = focus;
    });
    flows.update(elapsed, THREE.MathUtils.smoothstep(p, count + .25, count + .8), options.input.flowVisibility);
    labels(Math.round(raw) - 1, width, height);
    try { renderer.render(scene, camera); } catch { unavailable(); return; }
    if (first && painted) { first = false; options.onReady(); }
    if (continuous()) invalidate();
  }
  function resume() {
    if (document.hidden || !inView) { cancelAnimationFrame(frame); frame = 0; previous = 0; }
    else { previous = 0; invalidate(); }
  }
  function unavailable() { lost = true; cancelAnimationFrame(frame); frame = 0; options.onUnavailable(); }
  function contextLost(event: Event) { event.preventDefault(); unavailable(); }
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), hits = station.docks.map((dock) => dock.hit);
  let downX = 0, downY = 0;
  function pointerDown(event: PointerEvent) { downX = event.clientX; downY = event.clientY; }
  function pointerUp(event: PointerEvent) {
    if (event.button !== 0 || Math.hypot(event.clientX - downX, event.clientY - downY) > 8 || lost) return;
    const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / width * 2 - 1, -(event.clientY - rect.top) / height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(hits, false)[0]; if (hit) options.onDock(hit.object.userData.dock as number);
  }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
  const observer = new IntersectionObserver(([entry]) => { inView = !!entry?.isIntersecting; resume(); }); observer.observe(canvas);
  canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointerup", pointerUp); canvas.addEventListener("webglcontextlost", contextLost); document.addEventListener("visibilitychange", resume);
  let cancelledFonts = false;
  void document.fonts.ready.then(() => { if (!cancelledFonts) { station.refreshLabels(); invalidate(); } });
  resize();

  return {
    invalidate,
    dispose() {
      if (disposed) return; disposed = true; cancelledFonts = true; cancelAnimationFrame(frame);
      resizeObserver.disconnect(); observer.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointerup", pointerUp); canvas.removeEventListener("webglcontextlost", contextLost); document.removeEventListener("visibilitychange", resume);
      backdrop.dispose(); scene.environment = null; environment.dispose();
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>([map]);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => {
          materials.add(material);
          const texture = (material as THREE.MeshBasicMaterial).map; if (texture) textures.add(texture);
        });
        if (object instanceof THREE.InstancedMesh) object.dispose();
      });
      geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose()); textures.forEach((texture) => texture.dispose());
      scene.clear(); renderer.dispose(); renderer.forceContextLoss();
    },
  };
}
