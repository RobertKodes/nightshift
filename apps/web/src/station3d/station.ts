import * as THREE from "three";
import { GeometryBatch, glow } from "./geometry";
import { DOCKS } from "./stops";
import { addLandmark, createDockLabel } from "./landmarks";

const RADIUS = 6.05;

/** A beveled slice of the ring, with a narrow expansion joint at either end. */
function ringSegment(a: number, b: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 6.6, a, b, false);
  shape.lineTo(Math.cos(b) * 5.5, Math.sin(b) * 5.5);
  shape.absarc(0, 0, 5.5, b, a, true);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: .62, bevelEnabled: true, bevelSize: .045, bevelThickness: .045, bevelSegments: 1, curveSegments: 3, steps: 1 }).rotateX(-Math.PI / 2);
}

/** A chamfered, extruded portal gives each bay a real recess rather than three flat bars. */
function dockFrame() {
  const shape = new THREE.Shape();
  shape.moveTo(-1.1, -.15); shape.lineTo(1.1, -.15); shape.lineTo(1.1, 1.12);
  shape.lineTo(.88, 1.36); shape.lineTo(-.88, 1.36); shape.lineTo(-1.1, 1.12); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-.84, .02); hole.lineTo(-.84, .95); hole.lineTo(-.67, 1.12);
  hole.lineTo(.67, 1.12); hole.lineTo(.84, .95); hole.lineTo(.84, .02); hole.closePath();
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, { depth: .85, bevelEnabled: true, bevelSize: .035, bevelThickness: .035, bevelSegments: 1, steps: 1 }).translate(0, 0, -.425);
}

export function createStation(map: THREE.Texture, focusedDock = -1) {
  const group = new THREE.Group();
  const dim = focusedDock >= 0 ? .3 : 1;
  const hull = new GeometryBatch(), trim = new GeometryBatch(), inlay = new GeometryBatch();
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color("#453b53").multiplyScalar(dim), roughness: .45, metalness: .6, vertexColors: true });
  const silver = new THREE.MeshStandardMaterial({ color: new THREE.Color("#968aa4").multiplyScalar(dim), roughness: .42, metalness: .62 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color("#1b152a").multiplyScalar(dim), roughness: .48, metalness: .55 });
  const rim = new GeometryBatch();
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2, b = (i + 1) / 40 * Math.PI * 2;
    const tint = new THREE.Color().setHSL(.73 + (i % 3) * .008, .06, .7 + (i * 7 % 9) * .013);
    hull.add(ringSegment(a + .012, b - .012), 0, 0, 0, 0, tint);
    const m = (a + b) / 2;
    trim.box(.035, .045, 1.13, RADIUS * Math.cos(m), .72, RADIUS * Math.sin(m), Math.PI / 2 - m);
    inlay.box(.48, .025, .54, RADIUS * Math.cos(m), .7, RADIUS * Math.sin(m), -m);
    trim.box(.34, .018, .018, RADIUS * Math.cos(m), .735, RADIUS * Math.sin(m), -m);
  }
  for (const radius of [5.52, 6.58]) {
    rim.add(new THREE.TorusGeometry(radius, .022, 4, 144).rotateX(Math.PI / 2), 0, .72);
  }
  // Two complete crossing spines continue beyond the rim, as in the painted station.
  for (const angle of [.12, Math.PI / 2 + .12]) {
    hull.box(.68, .48, 15.8, 0, .3, 0, angle);
    trim.box(.83, .08, 15.9, 0, .58, 0, angle);
    inlay.box(.33, .025, 15.65, 0, .635, 0, angle);
    for (let i = -7; i <= 7; i++) {
      if (Math.abs(i) < 2) continue;
      const x = Math.sin(angle) * i, z = Math.cos(angle) * i;
      trim.box(.8, .1, .08, x, .67, z, angle);
      rim.box(.035, .025, .62, x + Math.cos(angle) * .26, .69, z - Math.sin(angle) * .26, angle);
    }
  }
  hull.add(new THREE.CylinderGeometry(1.62, 1.36, 1.35, 32), 0, .15);
  hull.add(new THREE.SphereGeometry(1.62, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), 0, .65);
  trim.add(new THREE.CylinderGeometry(.65, .8, .18, 24), 0, 2.18);
  inlay.add(new THREE.SphereGeometry(.57, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 2.25);
  for (const [r, y] of [[1.61, .55], [1.37, -.5], [1.22, 1.7], [.7, 2.29]]) {
    rim.add(new THREE.TorusGeometry(r!, .025, 4, 64).rotateX(Math.PI / 2), 0, y!);
  }
  trim.box(.05, 1.8, .05, 0, 3.1, 0);
  trim.box(.66, .035, .035, 0, 3.5, 0);
  group.add(hull.mesh(metal), trim.mesh(silver), inlay.mesh(dark));
  group.add(rim.mesh(new THREE.MeshBasicMaterial({ color: new THREE.Color("#9979d9").multiplyScalar(dim), toneMapped: false })));

  // Hundreds of warm windows and fine antennas cost one draw call each.
  const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe0a1").multiplyScalar(dim), toneMapped: false }), 1280);
  const matrix = new THREE.Object3D();
  let index = 0;
  for (const radius of [6.65, 5.45]) for (let i = 0; i < 256; i++) for (let row = 0; row < 2; row++) {
    const a = i / 256 * Math.PI * 2;
    matrix.position.set(Math.cos(a) * radius, .22 + row * .14, Math.sin(a) * radius);
    matrix.rotation.set(0, Math.PI / 2 - a, 0);
    matrix.scale.set(i % 7 === 0 ? .035 : .085, .018, .012);
    matrix.updateMatrix(); windows.setMatrixAt(index++, matrix.matrix);
  }
  for (let i = 0; i < 128; i++) for (let row = 0; row < 2; row++) {
    const a = i / 128 * Math.PI * 2;
    matrix.position.set(Math.cos(a) * 1.64, .22 + row * .2, Math.sin(a) * 1.64);
    matrix.rotation.y = Math.PI / 2 - a;
    matrix.scale.set(.043, .016, .012);
    matrix.updateMatrix(); windows.setMatrixAt(index++, matrix.matrix);
  }
  group.add(windows);
  const ribbons = new GeometryBatch();
  for (const radius of [6.66, 5.44]) for (const y of [.22, .36]) ribbons.add(new THREE.TorusGeometry(radius, .008, 3, 160).rotateX(Math.PI / 2), 0, y);
  group.add(ribbons.mesh(new THREE.MeshBasicMaterial({ color: new THREE.Color("#e8ba7c").multiplyScalar(dim), transparent: true, opacity: .62, depthWrite: false, toneMapped: false })));
  const hubHalo = glow(map, "#8252e9", 5.2, .21); hubHalo.position.y = 1.45; group.add(hubHalo);
  const antennas = new THREE.InstancedMesh(new THREE.CylinderGeometry(.012, .023, 1, 5), silver, 80);
  const tipGeometry = new THREE.OctahedronGeometry(.04);
  tipGeometry.setAttribute("phase", new THREE.InstancedBufferAttribute(Float32Array.from({ length: 80 }, (_, i) => i * .73), 1));
  const tipMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `attribute float phase; varying float vPhase; void main() { vPhase = phase; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float time; varying float vPhase; void main() {
      float flash = .18 + .82 * pow(.5 + .5 * sin(time * 1.7 + vPhase), 12.0);
      vec3 color = mix(vec3(.75, .4, 1.0), vec3(.4, 1.0, .7), step(.5, fract(vPhase * .31)));
      gl_FragColor = vec4(color * flash, 1.0); }`,
    toneMapped: false,
  });
  const navigation = new THREE.InstancedMesh(tipGeometry, tipMaterial, 80);
  for (let i = 0; i < 80; i++) {
    const a = i / 80 * Math.PI * 2, h = .16 + (i % 5) * .12;
    matrix.position.set(Math.cos(a) * (i % 2 ? 6.4 : 5.7), .76 + h / 2, Math.sin(a) * (i % 2 ? 6.4 : 5.7));
    matrix.rotation.set(0, -a, 0); matrix.scale.set(1, h, 1);
    matrix.updateMatrix(); antennas.setMatrixAt(i, matrix.matrix);
    matrix.position.y = .77 + h; matrix.scale.setScalar(1); matrix.updateMatrix(); navigation.setMatrixAt(i, matrix.matrix);
  }
  group.add(antennas, navigation);

  // Small equipment housings and short pipe runs give the hull scale without extra draw calls.
  const equipment = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), dark, 360);
  for (let i = 0; i < 360; i++) {
    const a = i / 240 * Math.PI * 2, r = 5.7 + (i % 4) * .23, h = .045 + i % 3 * .04;
    if (i < 240) matrix.position.set(Math.cos(a) * r, .76 + h / 2, Math.sin(a) * r);
    else {
      const angle = i % 2 ? .12 : Math.PI / 2 + .12, along = ((i - 240) / 120 * 14 - 7);
      matrix.position.set(Math.sin(angle) * along + Math.cos(angle) * .18, .73 + h / 2, Math.cos(angle) * along - Math.sin(angle) * .18);
    }
    matrix.rotation.set(0, -a, 0); matrix.scale.set(.08 + i % 4 * .035, h, .13 + i % 5 * .035);
    matrix.updateMatrix(); equipment.setMatrixAt(i, matrix.matrix);
  }
  const pipes = new THREE.InstancedMesh(new THREE.CylinderGeometry(.018, .018, 1, 6), silver, 120);
  for (let i = 0; i < 120; i++) {
    const a = i / 120 * Math.PI * 2;
    matrix.position.set(Math.cos(a) * 6.3, .81, Math.sin(a) * 6.3);
    matrix.rotation.set(0, Math.PI / 2 - a, Math.PI / 2); matrix.scale.set(1, .18 + i % 3 * .09, 1);
    matrix.updateMatrix(); pipes.setMatrixAt(i, matrix.matrix);
  }
  group.add(equipment, pipes);

  const refreshLabels: (() => void)[] = [];
  const docks = DOCKS.map((dock, i) => {
    const bay = new THREE.Group();
    bay.position.set(Math.cos(dock.angle) * RADIUS, .67, Math.sin(dock.angle) * RADIUS);
    bay.rotation.y = Math.PI / 2 - dock.angle;
    bay.scale.set(1.13, 1.07, 1.1);
    const frame = new GeometryBatch(), darkParts = new GeometryBatch(), light = new GeometryBatch();
    frame.add(dockFrame());
    frame.box(2.25, .13, 1.75, 0, -.13, .38);
    darkParts.box(1.8, 1.15, .08, 0, .58, -.45);
    darkParts.box(1.82, .1, .8, 0, 1.12);
    light.box(.055, 1.18, .08, -.86, .6, .5); light.box(.055, 1.18, .08, .86, .6, .5);
    light.box(1.78, .055, .08, 0, 1.16, .5); light.box(1.78, .04, .08, 0, .03, .5);
    for (let n = 0; n < 4; n++) {
      light.box(.045, .1, .58, -.67 + n * .45, -.045, .7);
      light.box(1.5, .02, .025, 0, .24 + n * .23, -.39);
    }
    addLandmark(dock.landmark, frame, light);
    // A hub portrait dims the shared hull while retaining the chosen bay's metal.
    const bayMetal = focusedDock === i ? metal.clone() : metal, bayDark = focusedDock === i ? dark.clone() : dark;
    if (focusedDock === i) { bayMetal.color.set("#453b53"); bayDark.color.set("#1b152a"); }
    bay.add(frame.mesh(bayMetal), darkParts.mesh(bayDark));
    const lighting = new THREE.MeshBasicMaterial({ color: dock.color, toneMapped: false });
    bay.add(light.mesh(lighting));
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.58, .68, .065), bayDark);
    door.position.set(0, .86, .25); bay.add(door);
    const interior = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.15), new THREE.MeshBasicMaterial({ color: dock.color, transparent: true, opacity: .65, side: THREE.DoubleSide, toneMapped: false }));
    interior.position.set(0, .6, -.35); bay.add(interior);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.6), new THREE.MeshBasicMaterial({ color: dock.color, transparent: true, opacity: focusedDock >= 0 && focusedDock !== i ? .03 : .18, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -.045, .35); bay.add(floor);
    const halo = glow(map, dock.color, 3.3, .5); halo.position.set(0, .6, .8); bay.add(halo);
    const beacon = glow(map, dock.color, .8, .9); beacon.position.set(0, 1.55, .5); bay.add(beacon);
    const core = new THREE.Mesh(new THREE.SphereGeometry(.065, 8, 6), lighting); core.position.copy(beacon.position); bay.add(core);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.42, 1.25, 3.6, 12, 1, true).rotateX(-Math.PI / 2).translate(0, .55, 2.3), new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(dock.color) }, strength: { value: 0 } },
      vertexShader: `varying float vFade; void main() { vFade = clamp((position.z - .5) / 3.6, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 color; uniform float strength; varying float vFade; void main() { gl_FragColor = vec4(color, (1.0 - vFade) * (1.0 - vFade) * strength * .085); }`,
      transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    beam.visible = false; bay.add(beam);
    // The visible frame is also the raycast target; HTML navigation is always available.
    const hit = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.8, 1.8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = .5; hit.userData.dock = i; bay.add(hit);
    const { sprite: label, refresh } = createDockLabel(dock.name, dock.color);
    bay.add(label); refreshLabels.push(refresh);
    group.add(bay);
    return { group: bay, door, halo, beacon, beam, interior, hit, lighting, label };
  });
  return { group, docks, hubHalo, navigation, refreshLabels: () => refreshLabels.forEach((refresh) => refresh()) };
}
