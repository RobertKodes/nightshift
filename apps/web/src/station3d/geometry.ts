import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Bake static details together; their source geometries are released immediately. */
export class GeometryBatch {
  private parts: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, x = 0, y = 0, z = 0, ry = 0, tint: THREE.ColorRepresentation = 0xffffff) {
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    if (part !== geometry) geometry.dispose();
    part.rotateY(ry).translate(x, y, z);
    const color = new THREE.Color(tint), colors = new Float32Array(part.getAttribute("position").count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b; }
    part.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.parts.push(part);
  }

  box(w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0) {
    this.add(new THREE.BoxGeometry(w, h, d), x, y, z, ry);
  }

  mesh(material: THREE.Material) {
    const geometry = mergeGeometries(this.parts, false)!;
    for (const part of this.parts) part.dispose();
    this.parts = [];
    return new THREE.Mesh(geometry, material);
  }
}

/** One small generated texture serves every dock halo and thruster flare. */
export function glowTexture() {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1);
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(Math.max(0, 1 - r) ** 3 * 255);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.needsUpdate = true;
  return texture;
}

export function glow(map: THREE.Texture, color: string, size: number, opacity: number) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sprite.scale.set(size, size, 1);
  return sprite;
}
