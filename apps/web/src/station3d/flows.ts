import * as THREE from "three";
import { DOCKS, CONNECTION_ROUTES } from "./stops";

/** Mesh tubes stay visibly thick on WebGL phones; source colours match the four HTML claims. */
export function createFlows(map: THREE.Texture) {
  const group = new THREE.Group(), point = new THREE.Vector3();
  const dockPoint = (i: number) => new THREE.Vector3(Math.cos(DOCKS[i]!.angle) * 5.95, 1.65, Math.sin(DOCKS[i]!.angle) * 5.95);
  const index = (id: string) => DOCKS.findIndex((dock) => dock.id === id);
  const routes = CONNECTION_ROUTES.map(({ from, to }) => [index(from), index(to)] as const);
  const streams = routes.map(([from, to], i) => {
    const color = new THREE.Color(DOCKS[from]!.color);
    const curve = new THREE.CatmullRomCurve3([
      dockPoint(from), dockPoint(from).multiplyScalar(.62).setY(3.1 + i * .2),
      dockPoint(to).multiplyScalar(.62).setY(3.1 + i * .2), dockPoint(to),
    ]);
    const coreMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .95, depthTest: false, depthWrite: false, toneMapped: false });
    const haloMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .22, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const core = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, .075, 6, false), coreMaterial);
    const halo = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, .19, 6, false), haloMaterial);
    core.renderOrder = 8; halo.renderOrder = 7; group.add(core, halo);
    return { curve, color, coreMaterial, haloMaterial };
  });
  const perStream = 24, count = streams.length * perStream;
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ map, size: .42, vertexColors: true, transparent: true, opacity: 1, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const particles = new THREE.Points(geometry, material); particles.frustumCulled = false; particles.renderOrder = 9; group.add(particles);
  return {
    group,
    update(time: number, amount: number, visibility: readonly number[] = []) {
      group.visible = amount > .005;
      if (!group.visible) return;
      streams.forEach((stream, i) => {
        // The list's clipped visibility drives the corresponding route's bright pulse.
        const seen = visibility[i] ?? 0;
        const pulse = seen * (.5 + .5 * Math.sin(time * 3.2 - i * 1.4));
        stream.coreMaterial.opacity = amount * (.82 + pulse * .18);
        stream.coreMaterial.color.copy(stream.color).multiplyScalar(1.15 + pulse * .8);
        stream.haloMaterial.opacity = amount * (.18 + pulse * .2);
        for (let j = 0; j < perStream; j++) {
          const index = (i * perStream + j) * 3;
          stream.curve.getPoint((j / perStream + time * .18) % 1, point);
          positions[index] = point.x; positions[index + 1] = point.y; positions[index + 2] = point.z;
          const bright = 1.3 + pulse * .8;
          colors[index] = stream.color.r * bright; colors[index + 1] = stream.color.g * bright; colors[index + 2] = stream.color.b * bright;
        }
      });
      material.opacity = amount;
      geometry.attributes.position!.needsUpdate = true; geometry.attributes.color!.needsUpdate = true;
    },
  };
}
