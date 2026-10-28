import * as THREE from "three";
import { createBackdrop } from "./backdrop";
import { createEnvironment } from "./environment";
import { createFlows } from "./flows";
import { createFlight } from "./flight";
import { createLabels } from "./labels";
import { damp, settle, spring } from "./motion";
import { createStation } from "./station";
import { LITE } from "../lite";
import { DOCKS, type FlightInput } from "./stops";

type SceneOptions = {
  input: FlightInput; onDemand?: boolean; reduced?: boolean;
  onPatch?: (canvas: HTMLCanvasElement) => void;
  onReady: () => void; onUnavailable: () => void; onDock: (index: number) => void;
};

/** A stationary, fine star field with deterministic variation, rather than animated streaks. */
function createStars() {
  const count = LITE ? 240 : 560, geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3), sizes = new Float32Array(count), lights = new Float32Array(count);
  let seed = 17;
  const random = () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < count; i++) {
    positions.set([(random() - .5) * 240, (random() - .5) * 190, -140 - random() * 40], i * 3);
    sizes[i] = .65 + random() ** 4 * 1.4; lights[i] = .15 + random() ** 2 * .65;
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1)); geometry.setAttribute("light", new THREE.BufferAttribute(lights, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { dpr: { value: 1 } }, transparent: true, depthWrite: false,
    vertexShader: `attribute float size; attribute float light; uniform float dpr; varying float vLight;
      void main() { vLight = light; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * dpr; }`,
    fragmentShader: `varying float vLight; void main() { float r = length(gl_PointCoord - .5);
      gl_FragColor = vec4(.86, .9, 1.0, (1.0 - smoothstep(.1, .5, r)) * vLight); }`,
  });
  return { points: new THREE.Points(geometry, material), material };
}

/** Scroll-driven long-lens flight. Hub portraits and reduced motion render only on demand. */
export function createStationScene(canvas: HTMLCanvasElement, options: SceneOptions) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LITE && !matchMedia("(pointer: coarse)").matches, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor("#010203"); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .88;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, .15, 400);
  const environment = createEnvironment(renderer); scene.environment = environment.texture; scene.environmentIntensity = .5;
  const station = createStation(options.input.header ? Math.round(options.input.progress) - 1 : -1), flows = createFlows(), stars = createStars();
  station.group.add(flows.group); scene.add(station.group, camera); camera.add(stars.points);
  const sun = new THREE.DirectionalLight("#fff1db", 4.4); sun.position.set(-14, 6, 4); scene.add(sun);
  const bounce = new THREE.HemisphereLight("#030609", "#5c8cc3", .42); scene.add(bounce);
  const flight = createFlight(camera, station, options.input), labels = createLabels(camera, station, options.input);
  const backdrop = createBackdrop(camera, canvas.getBoundingClientRect().width > 820 && !matchMedia("(pointer: coarse)").matches);
  let width = 1, height = 1, phone = false, inView = true, disposed = false, lost = false, painted = false;
  let frame = 0, previous = 0, elapsed = 0, first = true, lastRaw = options.input.progress;
  const scrollMotion = spring(options.input.progress), speedMotion = spring(0), pointerX = spring(0), pointerY = spring(0);
  const count = DOCKS.length;
  const rotations = [-.55, ...DOCKS.map((dock) => dock.angle - Math.PI / 2), DOCKS[count - 1]!.angle - Math.PI / 2 + .25];
  function continuous() { return !options.onDemand && !options.reduced && !options.input.still; }
  function invalidate() {
    if (disposed || lost || document.hidden || !inView || frame) return;
    frame = requestAnimationFrame(tick);
  }
  void station.ready.then(() => { if (!disposed) { options.onPatch?.(station.patchCanvas); invalidate(); } });
  void backdrop.ready.then(() => { if (!disposed) { painted = true; invalidate(); } }).catch(() => { if (!disposed) unavailable(); });
  function resize() {
    const rect = canvas.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    phone = width <= 820 || (width <= 1100 && height <= 540 && matchMedia("(pointer: coarse)").matches);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LITE ? 1 : phone ? 1.5 : 1.75));
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
    const p = cut ? raw : THREE.MathUtils.clamp(damp(scrollMotion, settle(raw, speed), .32, dt), 0, count + 1);
    if (cut) { scrollMotion.value = raw; scrollMotion.velocity = 0; }
    const px = cut ? 0 : damp(pointerX, options.input.pointerX, .6, dt), py = cut ? 0 : damp(pointerY, options.input.pointerY, .6, dt);
    const stop = Math.min(count, Math.floor(p)), t = p - stop, eased = t * t * (3 - 2 * t);
    const hero = options.input.header ? 0 : 1 - THREE.MathUtils.smoothstep(p, 1, 1.9);
    station.group.rotation.y = THREE.MathUtils.lerp(rotations[stop]!, rotations[stop + 1]!, eased) + Math.sin(elapsed * .055) * .025 * hero;
    station.group.rotation.x = phone ? 0 : py * .004;
    station.group.updateMatrixWorld(true); flight.update(p, elapsed, px * .35, dt, cut);
    backdrop.update(elapsed, phone);
    station.docks.forEach((dock, i) => {
      const focus = THREE.MathUtils.smoothstep(1 - Math.abs(p - i - 1), 0, 1);
      dock.lighting.color.set(DOCKS[i]!.color).multiplyScalar(.45 + focus * .55);
    });
    flows.update(THREE.MathUtils.smoothstep(p, count + .25, count + .8));
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
  void document.fonts.ready.then(() => { if (!disposed) { station.refreshLabels(); invalidate(); } });
  resize();
  return {
    invalidate,
    dispose() {
      if (disposed) return; disposed = true; cancelAnimationFrame(frame);
      resizeObserver.disconnect(); observer.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointerup", pointerUp); canvas.removeEventListener("webglcontextlost", contextLost); document.removeEventListener("visibilitychange", resume);
      station.cancel(); backdrop.dispose(); scene.environment = null; environment.dispose();
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        });
      });
      geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose()); textures.forEach((texture) => texture.dispose());
      scene.clear(); renderer.dispose(); renderer.forceContextLoss();
    },
  };
}
