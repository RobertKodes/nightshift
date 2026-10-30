import * as THREE from "three";
import consoleUrl from "./textures/console-front.webp";
import fabricUrl from "./textures/sofa-fabric.webp";
import floorUrl from "./textures/floor-plates.webp";
import hullUrl from "./textures/hull-armor.webp";
import rackUrl from "./textures/server-rack.webp";
import rugUrl from "./textures/rug.webp";
import wallUrl from "./textures/wall-armor.webp";
import { toonRamp } from "./toon";

/*
 * The deck's painted surfaces: tileable textures painted in the concept art's style, mapped by world
 * position (triplanar), so the merged box geometry of walls, floors, desks and the hull needs no UVs
 * and nothing stretches. Each sits on the shared cel-shading ramp.
 */
const URLS = { wall: wallUrl, floor: floorUrl, hull: hullUrl, console: consoleUrl, fabric: fabricUrl, rack: rackUrl, rug: rugUrl } as const;
export type Surface = keyof typeof URLS;
const loader = new THREE.TextureLoader(), textures = new Map<Surface, THREE.Texture>();
/** A surface texture, loaded once and shared; it appears as soon as it arrives. */
export function surface(name: Surface, onLoad?: () => void) {
  let texture = textures.get(name);
  if (!texture) {
    texture = loader.load(URLS[name], onLoad); texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 8; textures.set(name, texture);
  } else if (onLoad) queueMicrotask(onLoad);
  return texture;
}

/**
 * A cel-shaded material whose colour comes from a texture sampled by world position: tile is the size
 * in metres one repeat covers. Instanced meshes are mapped per instance.
 */
export function painted(name: Surface, tile: number, parameters: THREE.MeshToonMaterialParameters = {}, onLoad?: () => void) {
  const material = new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...parameters });
  const uniforms = { triMap: { value: surface(name, onLoad) }, triScale: { value: 1 / tile } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTriPos; varying vec3 vTriNormal;")
      .replace("#include <fog_vertex>", `#include <fog_vertex>
        #ifdef USE_INSTANCING
          vec4 triWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0); vTriNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vec4 triWorld = modelMatrix * vec4(transformed, 1.0); vTriNormal = normalize(mat3(modelMatrix) * objectNormal);
        #endif
        vTriPos = triWorld.xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D triMap; uniform float triScale; varying vec3 vTriPos; varying vec3 vTriNormal;")
      .replace("#include <map_fragment>", `
        vec3 triW = pow(abs(normalize(vTriNormal)), vec3(6.0)); triW /= triW.x + triW.y + triW.z;
        vec3 tp = vTriPos * triScale;
        vec4 triColor = texture2D(triMap, vec2(tp.z, tp.y)) * triW.x + texture2D(triMap, vec2(tp.x, -tp.z)) * triW.y + texture2D(triMap, vec2(tp.x, tp.y)) * triW.z;
        diffuseColor *= triColor;`);
  };
  material.customProgramCacheKey = () => `painted-${name}`;
  return material;
}

/** The round magenta rug, cut out. */
export const rug = (onLoad?: () => void) => new THREE.MeshToonMaterial({ gradientMap: toonRamp(), map: surface("rug", onLoad), transparent: true, alphaTest: .4 });
