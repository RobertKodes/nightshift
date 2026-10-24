import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/** The game's models, loaded once: the frog (with its rig and animations) and the two prop kits. */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();
export function load(name: "frog" | "stone" | "marsh" | "gear"): Promise<GLTF> {
  let p = cache.get(name);
  if (!p) { p = loader.loadAsync(`/lastspawn/${name}.glb`); cache.set(name, p); }
  return p;
}

/** A kit's pieces by name: each top-level node of the file. Use `piece` to place a copy. */
export type Kit = Map<string, THREE.Object3D>;
export async function kit(name: "stone" | "marsh"): Promise<Kit> {
  const g = await load(name);
  const m: Kit = new Map();
  for (const c of g.scene.children) {
    c.position.set(0, 0, 0);
    m.set(c.name, c);
  }
  return m;
}

export function piece(k: Kit, name: string, at?: { x: number; y: number; z: number; ry?: number; s?: number }): THREE.Object3D {
  const src = k.get(name);
  if (!src) throw new Error(`no piece ${name}`);
  const o = src.clone(true);
  if (at) { o.position.set(at.x, at.y, at.z); o.rotation.y = at.ry ?? 0; if (at.s) o.scale.setScalar(at.s); }
  return o;
}

/** A three-step light ramp: the stylized, hand-made look instead of smooth plastic shading. */
let ramp: THREE.DataTexture | null = null;
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const tones = [86, 142, 206, 255];
  const data = new Uint8Array(tones.length * 4);
  tones.forEach((t, i) => data.set([t, t, t, 255], i * 4));
  ramp = new THREE.DataTexture(data, tones.length, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

/**
 * Re-dresses a kit piece in the zone's palette: its atlas stays, tinted, lit by the toon ramp, with a
 * soft rim so shapes read against the dark.
 */
export function dress(o: THREE.Object3D, tint: THREE.ColorRepresentation, opts: { shadows?: boolean; rim?: number } = {}): THREE.Object3D {
  const cache = new Map<THREE.Material, THREE.Material>();
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    let mat = cache.get(src);
    if (!mat) {
      mat = toonWithRim({ map: src.map ?? null, color: new THREE.Color(tint), rim: opts.rim ?? 0.18 });
      cache.set(src, mat);
    }
    m.material = mat;
    m.castShadow = opts.shadows ?? true;
    m.receiveShadow = true;
  });
  return o;
}

/** A toon material with a rim light added after lighting. */
export function toonWithRim(p: { map?: THREE.Texture | null; color: THREE.Color; rim?: number; rimColor?: THREE.ColorRepresentation; emissive?: THREE.ColorRepresentation }): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ map: p.map ?? null, color: p.color, gradientMap: toonRamp(), emissive: p.emissive ?? 0x000000 });
  const rim = { value: p.rim ?? 0.2 }, rimColor = { value: new THREE.Color(p.rimColor ?? 0x9fb8ff) };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = rim; sh.uniforms.uRimColor = rimColor;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uRim; uniform vec3 uRimColor;")
      .replace("#include <opaque_fragment>", "float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);\noutgoingLight += uRimColor * rimF * uRim;\n#include <opaque_fragment>");
  };
  mat.customProgramCacheKey = () => "toon-rim";
  return mat;
}
