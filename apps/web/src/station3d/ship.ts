import * as THREE from "three";
import { GeometryBatch, glow } from "./geometry";

/** A rounded frog shuttle, with glossy eye domes, a lip band and paired violet engines. */
export function createShip(map: THREE.Texture) {
  const group = new THREE.Group(), body = new GeometryBatch(), eyes = new GeometryBatch(), pupils = new GeometryBatch(), engines = new GeometryBatch(), highlights = new GeometryBatch();
  const hull = new THREE.SphereGeometry(.58, 32, 20).scale(1, .63, 1.38);
  body.add(hull);
  for (const x of [-.31, .31]) {
    body.add(new THREE.SphereGeometry(.255, 24, 16), x, .32, .29);
    eyes.add(new THREE.SphereGeometry(.195, 24, 16).scale(1, 1, .9), x, .38, .36);
    pupils.add(new THREE.SphereGeometry(.14, 20, 12).scale(1, 1, .75), x, .4, .49);
    highlights.add(new THREE.SphereGeometry(.05, 10, 6), x - .035, .458, .589);
    highlights.add(new THREE.SphereGeometry(.022, 8, 6), x + .043, .363, .585);
    engines.add(new THREE.CylinderGeometry(.115, .14, .36, 12).rotateX(Math.PI / 2), x, -.04, -.69);
  }
  body.add(new THREE.SphereGeometry(.22, 16, 10).scale(1.3, .18, 1.8), -.6, -.11, -.23, -.25);
  body.add(new THREE.SphereGeometry(.22, 16, 10).scale(1.3, .18, 1.8), .6, -.11, -.23, .25);
  group.add(body.mesh(new THREE.MeshStandardMaterial({ color: "#73bb38", roughness: .31, metalness: .22 })));
  group.add(eyes.mesh(new THREE.MeshStandardMaterial({ color: "#d4bc6b", roughness: .16, metalness: .25 })));
  group.add(pupils.mesh(new THREE.MeshStandardMaterial({ color: "#0b0a15", roughness: .09, metalness: .38 })));
  group.add(highlights.mesh(new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false })));
  group.add(engines.mesh(new THREE.MeshStandardMaterial({ color: "#4d435e", roughness: .38, metalness: .65 })));
  const lipMaterial = new THREE.MeshStandardMaterial({ color: "#ff942d", roughness: .3, metalness: .12, emissive: "#b9430b", emissiveIntensity: .28 });
  const lips = new THREE.Mesh(new THREE.TorusGeometry(.565, .05, 8, 48), lipMaterial);
  lips.rotation.x = Math.PI / 2; lips.scale.set(1, 1.38, .8); lips.position.set(0, -.065, .035); group.add(lips);
  const smile = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.46, .015, .49), new THREE.Vector3(-.31, -.06, .735),
    new THREE.Vector3(0, -.095, .825), new THREE.Vector3(.31, -.06, .735), new THREE.Vector3(.46, .015, .49),
  ]);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(smile, 28, .06, 8, false), lipMaterial));
  const trails = [-.31, .31].map((x) => {
    const plume = new THREE.Mesh(new THREE.ConeGeometry(.12, 1.45, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#b28aff", transparent: true, opacity: .68, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    plume.position.set(x, -.04, -1.57); group.add(plume);
    const flare = glow(map, "#ab82ff", .8, .9); flare.position.set(x, -.04, -.87); group.add(flare);
    const trail = new THREE.Mesh(new THREE.PlaneGeometry(.36, 2.7).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ map, color: "#9562ff", opacity: .65, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    trail.position.set(x, -.04, -1.7); group.add(trail);
    return plume;
  });
  group.scale.setScalar(.7875);
  return { group, trails };
}
