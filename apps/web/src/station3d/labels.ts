import * as THREE from "three";
import type { createStation } from "./station";
import type { FlightInput } from "./stops";

/** Keep the single selected name at a readable CSS size, inside the scene's clear area. */
export function createLabels(camera: THREE.PerspectiveCamera, station: ReturnType<typeof createStation>, input: FlightInput) {
  const anchor = new THREE.Vector3(), projected = new THREE.Vector3(), local = new THREE.Vector3(), scale = new THREE.Vector3();
  return (selected: number, width: number, height: number) => {
    station.docks.forEach((dock, index) => { dock.label.visible = index === selected; });
    const dock = station.docks[selected]; if (!dock) return;
    const label = dock.label, pixels = 36, ratio = 768 / 168;
    anchor.set(0, 2.65, .25).applyMatrix4(dock.group.matrixWorld);
    const depth = -local.copy(anchor).applyMatrix4(camera.matrixWorldInverse).z;
    if (depth <= camera.near) { label.visible = false; return; }
    const worldHeight = pixels * 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / height;
    dock.group.getWorldScale(scale);
    label.scale.set(worldHeight * ratio / scale.x, worldHeight / scale.y, 1);
    projected.copy(anchor).project(camera);
    const left = 12 + pixels * ratio / 2, right = width - left;
    const top = (input.header ? 10 : (input.heroBottom ?? .1) * height + 10) + pixels / 2;
    const bottom = (input.header ? height - 10 : (input.panelTop ?? .62) * height - 10) - pixels / 2;
    const x = THREE.MathUtils.clamp((projected.x * .5 + .5) * width, left, right);
    const y = THREE.MathUtils.clamp((.5 - projected.y * .5) * height, top, Math.max(top, bottom));
    projected.set(x / width * 2 - 1, 1 - y / height * 2, projected.z).unproject(camera);
    label.position.copy(dock.group.worldToLocal(projected));
    label.material.opacity = 1;
  };
}
