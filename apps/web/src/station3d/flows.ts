import * as THREE from "three";
import { DOCKS, CONNECTION_ROUTES } from "./stops";

/** Fine engineering routes appear only in the connections overview. */
export function createFlows() {
  const group = new THREE.Group();
  const point = (id: string) => {
    const a = DOCKS.find((dock) => dock.id === id)!.angle;
    return new THREE.Vector3(Math.cos(a) * 6, 1.8, Math.sin(a) * 6);
  };
  for (const route of CONNECTION_ROUTES) {
    const a = point(route.from), b = point(route.to);
    const curve = new THREE.QuadraticBezierCurve3(a, new THREE.Vector3(0, 3, 0), b);
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(32)), new THREE.LineBasicMaterial({ color: "#a49ac4", transparent: true, opacity: .5, depthWrite: false })));
  }
  return { group, update(amount: number) { group.visible = amount > .005; group.children.forEach((line) => { ((line as THREE.Line).material as THREE.LineBasicMaterial).opacity = amount * .5; }); } };
}
