import * as THREE from "three";
import { damp, spring } from "./motion";
import type { createStation } from "./station";
import { DOCKS, type FlightInput } from "./stops";

type Station = ReturnType<typeof createStation>;
const smooth = THREE.MathUtils.smoothstep;
const VIEW = {
  workshop: { pitch: .44, side: -.055 }, array: { pitch: .49, side: .045 },
  arcade: { pitch: .40, side: -.04 }, vault: { pitch: .46, side: .055 },
  garden: { pitch: .42, side: -.025 }, archive: { pitch: .48, side: .035 },
};

/** Fit the whole arrival below its headline; other stops frame their own world-space bay. */
export function createFlight(camera: THREE.PerspectiveCamera, station: Station, input: FlightInput) {
  let width = 1, height = 1, phone = false, landscape = false, heroDistance = 45, dirty = true;
  const up = new THREE.Vector3(0, 1, 0), sample = new THREE.Vector3(), target = new THREE.Vector3();
  const origin = new THREE.Vector3(), eye = new THREE.Vector3(), dockTarget = new THREE.Vector3(), outward = new THREE.Vector3();
  const nextTarget = new THREE.Vector3(), nextNormal = new THREE.Vector3(), right = new THREE.Vector3();
  const heroEye = new THREE.Vector3(), overviewEye = new THREE.Vector3();
  const distance = spring(23), centerX = spring(.5), centerY = spring(.4);
  const hullPoints: THREE.Vector3[] = [];
  for (let i = 0; i < 32; i++) for (const y of [-.1, 1.6]) {
    const a = i / 32 * Math.PI * 2;
    hullPoints.push(new THREE.Vector3(Math.cos(a) * 6.8, y, Math.sin(a) * 6.8));
  }
  for (const angle of [.12, Math.PI / 2 + .12]) for (const end of [-8.05, 8.05]) for (const side of [-.45, .45]) {
    hullPoints.push(new THREE.Vector3(Math.sin(angle) * end + Math.cos(angle) * side, .7, Math.cos(angle) * end - Math.sin(angle) * side));
  }
  hullPoints.push(new THREE.Vector3(0, 4.05, 0));
  const bayCorners = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(i & 1 ? 1.8 : -1.8, i & 2 ? 2.4 : -.18, i & 4 ? 1.55 : -.5));
  // Hub portraits prioritise the entrance; the surrounding hull can leave the header.
  const portalCorners = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(i & 1 ? 1.35 : -1.35, i & 2 ? 1.65 : -.18, i & 4 ? 1.2 : -.5));
  station.group.updateMatrixWorld(true);
  for (const dock of station.docks) for (const corner of bayCorners) hullPoints.push(corner.clone().applyMatrix4(dock.group.matrix));

  function lens(x: number, y: number) {
    camera.setViewOffset(width, height, width * (.5 - x), height * (.5 - y), width, height);
  }
  function aim(position: THREE.Vector3, at: THREE.Vector3) {
    camera.position.copy(position); camera.up.copy(up); camera.lookAt(at); camera.updateMatrixWorld();
  }
  function bounds(points: THREE.Vector3[], matrix: THREE.Matrix4) {
    let left = 1, rightEdge = 0, top = 1, bottom = 0;
    for (const point of points) {
      sample.copy(point).applyMatrix4(matrix).project(camera);
      const x = .5 + sample.x * .5, y = .5 - sample.y * .5;
      left = Math.min(left, x); rightEdge = Math.max(rightEdge, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    return { width: rightEdge - left, height: bottom - top, x: (left + rightEdge) / 2, y: (top + bottom) / 2 };
  }
  function heroPose(d: number) {
    heroEye.copy(origin).addScaledVector(up, Math.sin(.48) * d); heroEye.z += Math.cos(.48) * d;
    aim(heroEye, origin);
  }
  function bayPose(i: number, position: THREE.Vector3, normal: THREE.Vector3) {
    const bay = station.docks[i]!.group;
    position.set(0, .6, .45).applyMatrix4(bay.matrixWorld);
    normal.set(0, 0, 1).transformDirection(bay.matrixWorld);
  }

  return {
    resize(w: number, h: number) {
      width = w; height = h; phone = w <= 820 || (w <= 1100 && h <= 540 && matchMedia("(pointer: coarse)").matches); landscape = phone && w > h; dirty = true;
      heroDistance = Math.max(15, 17 / (2 * Math.tan(THREE.MathUtils.degToRad(20)) * camera.aspect * (phone && !landscape ? .9 : .56)));
    },
    update(p: number, time: number, px: number, dt: number, cut = false) {
      const hero = input.header ? 0 : 1 - smooth(p, 1, 1.9), overview = smooth(p, DOCKS.length, DOCKS.length + 1);
      const portrait = phone && !landscape && !input.header;
      const clearance = THREE.MathUtils.clamp(input.panelTop ?? .62, .18, .94);
      const top = Math.min(clearance - .1, (input.heroBottom ?? .1) + .025);
      const room = Math.max(.06, clearance - top - .03), lensHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      station.group.getWorldPosition(origin); origin.y += .7;
      let hx = phone ? landscape ? .25 : .5 : .32, hy = .4;
      // Projection bounds include the ring, spokes, antenna and six landmarks, excluding labels.
      if (hero > 0 || dirty) {
        const areaWidth = portrait ? .9 : phone && landscape ? .44 : .56, areaTop = top, areaBottom = portrait ? clearance - .018 : .86;
        const areaHeight = Math.max(.06, areaBottom - areaTop);
        lens(.5, .5);
        for (let pass = 0; pass < 4; pass++) {
          heroPose(heroDistance);
          const silhouette = bounds(hullPoints, station.group.matrixWorld);
          heroDistance = Math.max(14, heroDistance * Math.max(silhouette.width / areaWidth, silhouette.height / areaHeight));
        }
        heroPose(heroDistance);
        const silhouette = bounds(hullPoints, station.group.matrixWorld);
        hx += .5 - silhouette.x; hy = .5 + (areaTop + areaBottom) / 2 - silhouette.y;
      } else heroPose(heroDistance);
      const dockProgress = THREE.MathUtils.clamp(p - 1, 0, DOCKS.length - 1), i = Math.floor(dockProgress), next = Math.min(DOCKS.length - 1, i + 1);
      const blend = smooth(dockProgress - i, 0, 1);
      bayPose(i, dockTarget, outward); bayPose(next, nextTarget, nextNormal);
      dockTarget.lerp(nextTarget, blend); outward.lerp(nextNormal, blend).normalize();
      const fromView = VIEW[DOCKS[i]!.landmark], toView = VIEW[DOCKS[next]!.landmark];
      const pitch = THREE.MathUtils.lerp(fromView.pitch, toView.pitch, blend), side = THREE.MathUtils.lerp(fromView.side, toView.side, blend);
      right.crossVectors(up, outward).normalize();
      const pose = (d: number) => eye.copy(dockTarget).addScaledVector(outward, Math.cos(pitch) * d).addScaledVector(up, Math.sin(pitch) * d).addScaledVector(right, side * d + (phone ? Math.sin(time * .15) * .025 : px * .2));
      const fraction = input.header ? .48 : phone ? landscape ? .2 : .34 : .19;
      const bayWidth = 2.3 * station.docks[i]!.group.scale.x;
      let near = Math.max(THREE.MathUtils.clamp(bayWidth / (lensHeight * camera.aspect * fraction), input.header ? 4 : 9, 48), portrait ? 3.1 / (lensHeight * room) : 0);
      let cx = input.header ? .5 : phone ? landscape ? .25 : .5 : .32;
      let cy = input.header ? .6 : portrait ? THREE.MathUtils.clamp(.32, top + 2.2 / (lensHeight * near), clearance - .03 - .8 / (lensHeight * near)) : phone ? .43 : .47;
      if (input.header) {
        lens(.5, .5);
        for (let pass = 0; pass < 3; pass++) {
          aim(pose(near), dockTarget);
          const silhouette = bounds(portalCorners, station.docks[i]!.group.matrixWorld);
          near = Math.max(4, near * Math.max(silhouette.width / .88, silhouette.height / .67));
        }
        aim(pose(near), dockTarget);
        const silhouette = bounds(portalCorners, station.docks[i]!.group.matrixWorld);
        cx = 1 - silhouette.x; cy = .5 + .59 - silhouette.y;
      }
      cx = THREE.MathUtils.lerp(cx, hx, hero); cy = THREE.MathUtils.lerp(cy, hy, hero);
      cy = THREE.MathUtils.lerp(cy, portrait ? Math.min(.26, clearance * .5) : .45, overview);
      if (dirty || cut) { distance.value = near; distance.velocity = 0; centerX.value = cx; centerX.velocity = 0; centerY.value = cy; centerY.velocity = 0; }
      const d = damp(distance, near, .3, dt), x = damp(centerX, cx, .24, dt), y = damp(centerY, cy, .24, dt);
      pose(d); target.copy(dockTarget); eye.lerp(heroEye, hero); target.lerp(origin, hero);
      const overviewHeight = portrait ? Math.max(.18, Math.min(.4, clearance - .07)) : .72;
      const overviewDistance = Math.max(heroDistance, 17.5 / (lensHeight * overviewHeight));
      overviewEye.copy(origin).addScaledVector(up, Math.sin(1.25) * overviewDistance); overviewEye.z += Math.cos(1.25) * overviewDistance;
      eye.lerp(overviewEye, overview); target.lerp(origin, overview);
      lens(x, y); aim(eye, target); dirty = false;
    },
  };
}
