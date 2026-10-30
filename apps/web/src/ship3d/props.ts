import * as THREE from "three";
import type { GeometryBatch } from "../station3d/geometry";

/*
 * Small set dressing shared by both rows of rooms: potted plants, cargo crates and floor cable runs,
 * added to merged batches in deck coordinates (one draw call per material however many there are).
 */
const LEAVES = ["#3f8f4a", "#5fae52", "#2f7a45", "#4c9a3c"];

/** A potted fern: a violet pot with a lit rim and a spray of long leaves. */
export function plant(batch: GeometryBatch, x: number, z: number, size = 1, seed = 1) {
  const s = size;
  batch.add(new THREE.CylinderGeometry(.24 * s, .18 * s, .42 * s, 10), x, .21 * s, z, 0, "#3a2f5e");
  batch.add(new THREE.CylinderGeometry(.26 * s, .26 * s, .05 * s, 10), x, .43 * s, z, 0, "#6a5c9e");
  batch.add(new THREE.CylinderGeometry(.21 * s, .21 * s, .03 * s, 10), x, .44 * s, z, 0, "#2a2018");
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed, tilt = .45 + ((i * 7 + seed * 3) % 5) * .1, long = (.55 + ((i * 3 + seed) % 4) * .1) * s;
    const leaf = new THREE.ConeGeometry(.075 * s, long, 4); leaf.translate(0, long / 2, 0); leaf.scale(1, 1, .35); leaf.rotateX(tilt); leaf.rotateY(a);
    batch.add(leaf, x, .44 * s, z, 0, LEAVES[(i + seed) % LEAVES.length]!);
  }
}

/** A cargo crate with a darker frame band; turn is about y. */
export function crate(batch: GeometryBatch, x: number, y: number, z: number, w: number, h: number, turn = 0, tint: THREE.ColorRepresentation = "#5a4a2a") {
  batch.add(new THREE.BoxGeometry(w, h, w), x, y + h / 2, z, turn, tint);
  for (const k of [.12, .88]) batch.add(new THREE.BoxGeometry(w + .03, .05, w + .03), x, y + h * k, z, turn, "#2a2238");
}

/** A floor cable run through the given points: a few parallel dark cables. */
export function cables(batch: GeometryBatch, points: [number, number][], count = 3) {
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az] = points[i]!, [bx, bz] = points[i + 1]!, len = Math.hypot(bx - ax, bz - az), turn = Math.atan2(bx - ax, bz - az);
    const nx = Math.cos(turn), nz = -Math.sin(turn);
    for (let k = 0; k < count; k++) {
      const o = (k - (count - 1) / 2) * .07;
      batch.add(new THREE.BoxGeometry(.045, .035, len + .05), (ax + bx) / 2 + nx * o, .018, (az + bz) / 2 + nz * o, turn, k === 1 ? "#3d2f6e" : "#1c1830");
    }
  }
}

/** A soft round light pool, for additive floor glows under lit furniture. */
export function poolTexture() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
  const c = canvas.getContext("2d");
  if (c) { const g = c.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(.35, "rgba(255,255,255,.45)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 128, 128); }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  return map;
}
