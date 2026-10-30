import * as THREE from "three";

let ramp: THREE.DataTexture | null = null;
/** The deck's cel-shading ramp: four hard light steps, shared by the rooms, the hull and the crew. */
export function toonRamp() {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([84, 140, 205, 255]), 4, 1, THREE.RedFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.generateMipmaps = false; ramp.needsUpdate = true;
  }
  return ramp;
}

/** A cel-shaded material on the shared ramp. */
export const toon = (parameters: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...parameters });

/** Room accents, left to right: Mission violet, Company cyan, Games magenta, Watch teal. */
export const ROOM_GLOW = ["#8f6bff", "#38d2ff", "#ff4fb4", "#2fe3c8", "#ffb86b", "#38d2ff", "#ff7a3d", "#b8ff4a"] as const;
