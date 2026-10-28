import * as THREE from "three";
import { GeometryBatch } from "./geometry";
import { DOCKS } from "./stops";
import { createMissionPatch } from "./patch";
import { createDockLabel } from "./landmarks";

const RADIUS = 6.05;

/** Repeating seams, fasteners and directional grain, generated locally once. */
function panelTexture(solar = false) {
  const size = 256, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const seam = solar ? x % 32 < 1 || y % 16 < 1 : x % 128 < 2 || y % 64 < 2;
    const bolt = !solar && x % 128 > 5 && x % 128 < 9 && y % 64 > 5 && y % 64 < 9;
    const grain = ((x * 17 + y * 131) % 19) / 19;
    const v = seam ? 186 : bolt ? 116 : 236 + grain * 10 + y % 3 * 2;
    const i = (y * size + x) * 4;
    // Blue photovoltaic glass retains visible silver-blue bus bars at small screen sizes.
    const cell = grain * 7 + Math.floor(x / 32) % 2 * 4;
    pixels[i] = solar ? seam ? 82 : 24 + cell : v;
    pixels[i + 1] = solar ? seam ? 110 : 49 + cell : v;
    pixels[i + 2] = solar ? seam ? 148 : 91 + cell : v;
    pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.anisotropy = 2; texture.needsUpdate = true;
  return texture;
}

/** Tangent normals and roughness give gold MLI fine folded highlights without more geometry. */
function foilTextures() {
  const size = 128, normal = new Uint8Array(size * size * 4), roughness = new Uint8Array(size * size * 4);
  const height = (x: number, y: number) => Math.sin(x * .31 + Math.sin(y * .19) * 2.8) * .34
    + Math.sin(y * .43 + Math.sin(x * .13) * 3) * .24 + Math.abs(Math.sin(x * .17 + y * .23)) * .42;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, dx = (height(x + 1, y) - height(x - 1, y)) * 1.8, dy = (height(x, y + 1) - height(x, y - 1)) * 1.8;
    const length = Math.hypot(dx, dy, 1);
    normal[i] = (1 - dx / length) * 127.5; normal[i + 1] = (1 - dy / length) * 127.5; normal[i + 2] = (1 + 1 / length) * 127.5; normal[i + 3] = 255;
    roughness[i] = roughness[i + 1] = roughness[i + 2] = 155 + Math.abs(height(x, y)) * 65; roughness[i + 3] = 255;
  }
  const textures = [normal, roughness].map((pixels) => {
    const texture = new THREE.DataTexture(pixels, size, size); texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
    return texture;
  });
  return { normal: textures[0]!, roughness: textures[1]! };
}

function ringSegment(a: number, b: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 5.55, a, b, false); shape.lineTo(Math.cos(b) * 5.12, Math.sin(b) * 5.12);
  shape.absarc(0, 0, 5.12, b, a, true); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: .34, bevelEnabled: false, curveSegments: 2, steps: 1 }).rotateX(-Math.PI / 2);
}

/** Shared, batched hardware: no shadows, postprocessing or animated hull geometry. */
export function createStation(focusedDock = -1) {
  const group = new THREE.Group(), panel = panelTexture(), cells = panelTexture(true), foil = foilTextures();
  const metal = new THREE.MeshStandardMaterial({ color: "#f2efe5", map: panel, bumpMap: panel, bumpScale: .006, roughness: .48, metalness: .06 });
  const silver = new THREE.MeshStandardMaterial({ color: "#dce3e8", roughness: .23, metalness: .92 });
  const dark = new THREE.MeshStandardMaterial({ color: "#182330", roughness: .35, metalness: .65 });
  const solar = new THREE.MeshPhysicalMaterial({ color: "#dceaff", map: cells, metalness: .25, roughness: .22, clearcoat: .9, clearcoatRoughness: .12, envMapIntensity: 1.35, side: THREE.DoubleSide });
  const ceramic = new THREE.MeshStandardMaterial({ color: "#a9ada8", roughness: .82, metalness: .15 });
  const gold = new THREE.MeshPhysicalMaterial({ color: "#dca83e", metalness: .96, roughness: .34, normalMap: foil.normal, normalScale: new THREE.Vector2(.65, .65), roughnessMap: foil.roughness, clearcoat: .2, clearcoatRoughness: .18 });
  const amber = gold.clone(); amber.color.set("#b97327");
  const radiator = new THREE.MeshStandardMaterial({ color: "#23313e", roughness: .3, metalness: .62 });
  const warm = new THREE.MeshBasicMaterial({ color: "#ffd08a", toneMapped: false });
  const hull = new GeometryBatch(), frames = new GeometryBatch(), recess = new GeometryBatch(), arrays = new GeometryBatch(), radiators = new GeometryBatch(), dishes = new GeometryBatch(), windows = new GeometryBatch();
  // Braced pressure ring and a low, faceted command module.
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * Math.PI * 2, b = (i + 1) / 48 * Math.PI * 2, m = (a + b) / 2;
    hull.add(ringSegment(a + .006, b - .006));
    for (const y of [-.22, .5]) frames.box(.045, .045, .75, Math.cos(m) * 5.35, y, Math.sin(m) * 5.35, -m);
    frames.box(.03, .75, .03, Math.cos(a) * 5.35, .13, Math.sin(a) * 5.35);
    frames.add(new THREE.CylinderGeometry(.018, .018, .92, 4).rotateZ(.65), Math.cos(m) * 5.35, .13, Math.sin(m) * 5.35, -m);
  }
  hull.add(new THREE.CylinderGeometry(1.18, 1.18, 1.48, 8), 0, .54);
  hull.add(new THREE.CylinderGeometry(.75, 1.18, .38, 8), 0, 1.47);
  recess.add(new THREE.CylinderGeometry(.58, .58, .12, 12), 0, 1.71);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    windows.box(.22, .065, .025, Math.sin(a) * 1.1, .95, Math.cos(a) * 1.1, a);
  }
  for (const dock of DOCKS) {
    const x = Math.cos(dock.angle) * 3.25, z = Math.sin(dock.angle) * 3.25;
    hull.add(new THREE.CylinderGeometry(.26, .26, 4.2, 8).rotateX(Math.PI / 2), x, .25, z, Math.PI / 2 - dock.angle);
    for (const y of [-.18, .55]) frames.box(.035, .035, 4.3, x, y, z, Math.PI / 2 - dock.angle);
  }
  // Two long truss booms, four articulated solar wings, and two radiator banks.
  for (const side of [-1, 1]) {
    if (side === 1) for (const z of [-.3, .3]) frames.box(18.8, .055, .055, 0, -.2, z);
    for (let i = -9; i <= 9; i++) {
      if (side === 1) frames.box(.035, .055, .65, i, -.2, 0);
      frames.box(1.14, .035, .035, i, -.2, 0, side * .55);
    }
    for (const along of [-1, 1]) {
      const x = side * 8.7, z = along * 2.75;
      if (along === 1) frames.box(.09, .09, 10.2, x, -.2, 0);
      arrays.box(2.8, .035, 4.5, x, -.15, z);
      for (const edge of [-1, 1]) frames.box(.035, .075, 4.55, x + edge * 1.42, -.15, z);
      for (let n = 0; n <= 6; n++) frames.box(2.85, .055, .025, x, -.12, z - 2.25 + n * .75);
    }
    radiators.box(1.05, .06, 4.2, side * 3.2, .58, -2.9);
    for (let n = 0; n < 16; n++) recess.box(.012, .015, 4.1, side * 3.2 - .46 + n * .06, .62, -2.9);
    frames.box(.06, 2.4, .06, side * 1.2, 2.5, -.6);
    frames.box(1.35, .035, .035, side * 1.2, 3.5, -.6);
  }
  // High-gain dishes, fine communication masts and equipment boxes.
  for (const side of [-1, 1]) {
    frames.add(new THREE.CylinderGeometry(.025, .025, 1.2, 6), side * 2, 1.2, 1.6);
    dishes.add(new THREE.SphereGeometry(.48, 16, 8, 0, Math.PI * 2, 0, .4).rotateX(.7), side * 2, 1.7, 1.6);
    for (let n = 0; n < 5; n++) recess.box(.38, .24, .5, side * (1.8 + n * .6), .65, .1);
  }
  group.add(hull.mesh(metal), frames.mesh(silver), recess.mesh(dark), arrays.mesh(solar), radiators.mesh(radiator), dishes.mesh(ceramic), windows.mesh(warm));
  const patch = createMissionPatch(); group.add(patch.mesh);
  const refreshLabels: (() => void)[] = [];
  const docks = DOCKS.map((dock, i) => {
    const bay = new THREE.Group();
    bay.position.set(Math.cos(dock.angle) * RADIUS, .35, Math.sin(dock.angle) * RADIUS);
    bay.rotation.y = Math.PI / 2 - dock.angle;
    const body = new GeometryBatch(), trim = new GeometryBatch(), collar = new GeometryBatch(), equipment = new GeometryBatch(), glazing = new GeometryBatch();
    // Octagonal pressure vessel, restrained thermal panels and a mechanical docking collar.
    body.add(new THREE.CylinderGeometry(.72, .72, 2.5, 8).rotateX(Math.PI / 2), 0, .58, -.2);
    body.box(1.08, .13, 1.7, 0, 1.16, -.3);
    collar.add(new THREE.CylinderGeometry(.61, .61, .22, 16, 1, true).rotateX(Math.PI / 2), 0, .58, 1.1);
    collar.add(new THREE.TorusGeometry(.56, .065, 4, 24), 0, .58, 1.23);
    equipment.add(new THREE.CylinderGeometry(.5, .5, .06, 16).rotateX(Math.PI / 2), 0, .58, 1.17);
    for (const x of [-1, 1]) {
      trim.box(.055, .055, 2.6, x * .77, .15, -.3);
      equipment.box(.25, .42, .8, x * .74, .65, -.4);
      glazing.box(.15, .065, .025, x * .32, .95, 1.03);
    }
    for (let n = 0; n < 6; n++) {
      const a = n * Math.PI / 3;
      trim.box(.075, .075, .16, Math.cos(a) * .63, .58 + Math.sin(a) * .63, 1.26);
    }
    bay.add(body.mesh(i === 1 ? gold : i === 3 ? amber : metal), trim.mesh(silver), collar.mesh(i === 3 ? amber : gold), equipment.mesh(dark), glazing.mesh(warm));
    const lighting = new THREE.MeshBasicMaterial({ color: dock.color, toneMapped: false });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.12, .025, .018), lighting);
    strip.position.set(0, 1.25, .57); bay.add(strip);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.8, 2.7), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(0, .6, .1); hit.userData.dock = i; bay.add(hit);
    const { sprite: label, refresh } = createDockLabel(dock.name, dock.color);
    bay.add(label); refreshLabels.push(refresh); group.add(bay);
    return { group: bay, hit, lighting, label };
  });
  // White mast lights, red port and green starboard lamps still share one draw call.
  const nav = new GeometryBatch();
  for (const side of [-1, 1]) {
    nav.add(new THREE.SphereGeometry(.035, 6, 4), side * 1.2, 3.72, -.6, 0, "#fff4d8");
    nav.add(new THREE.SphereGeometry(.035, 6, 4), side * 8.7, -.1, 5, 0, side < 0 ? "#ff4934" : "#65e7a1");
  }
  group.add(nav.mesh(new THREE.MeshBasicMaterial({ color: "#ffffff", vertexColors: true, toneMapped: false })));
  if (focusedDock >= 0) docks.forEach((dock, i) => { dock.lighting.color.set(DOCKS[i]!.color).multiplyScalar(i === focusedDock ? 1 : .35); });
  return { group, docks, ready: patch.ready, patchCanvas: patch.canvas, cancel: patch.cancel, refreshLabels: () => refreshLabels.forEach((refresh) => refresh()) };
}
