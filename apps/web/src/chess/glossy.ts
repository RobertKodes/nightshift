import * as THREE from "three";
import { LITE } from "../lite";

/**
 * A clearcoat (physical) material, or in lite the standard material under it: the same colour,
 * roughness and glow, without the clearcoat and sheen layers that cost a phone the most per pixel.
 */
export function glossy(p: THREE.MeshPhysicalMaterialParameters): THREE.MeshStandardMaterial {
  if (!LITE) return new THREE.MeshPhysicalMaterial(p);
  const { clearcoat: _c, clearcoatRoughness: _cr, sheen: _s, sheenColor: _sc, sheenRoughness: _sr, ...rest } = p;
  return new THREE.MeshStandardMaterial(rest);
}
