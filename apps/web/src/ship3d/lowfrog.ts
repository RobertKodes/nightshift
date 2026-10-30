import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toon } from "./toon";

/*
 * The crew as an RTS shows its units: a chunky low-poly NIGHT FROG (green head, heavy-lidded cream eyes,
 * broad orange lips, a violet hoodie), drawn with instancing so a full deck of crew costs a handful of
 * draw calls. Each frog is posed by its brain; up close the deck lends it a fully animated frog instead.
 */
type Lists = { skin: THREE.BufferGeometry[]; cloth: THREE.BufferGeometry[]; face: THREE.BufferGeometry[] };
const CREAM = new THREE.Color("#efe6c8"), PUPIL = new THREE.Color("#120e18"), LIPS = new THREE.Color("#e2772f");

function part(list: THREE.BufferGeometry[], g: THREE.BufferGeometry, at: [number, number, number], { rot = [0, 0, 0] as [number, number, number], scale = [1, 1, 1] as [number, number, number], color }: { rot?: [number, number, number]; scale?: [number, number, number]; color?: THREE.Color } = {}) {
  g.scale(...scale); g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]); g.translate(...at);
  const flat = g.index ? g.toNonIndexed() : g; if (flat !== g) g.dispose();
  if (color) { const c = new Float32Array(flat.getAttribute("position").count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = color.r; c[i + 1] = color.g; c[i + 2] = color.b; } flat.setAttribute("color", new THREE.BufferAttribute(c, 3)); }
  list.push(flat);
}

/** One frog, standing or seated, split by what colours it: skin, hoodie, and the fixed face colours. */
function frog(seated: boolean) {
  const L: Lists = { skin: [], cloth: [], face: [] }, up = seated ? -.46 : 0;
  if (seated) for (const s of [-1, 1]) {
    part(L.skin, new THREE.CylinderGeometry(.095, .105, .46, 6, 1, true), [s * .14, .34, .2], { rot: [Math.PI / 2, 0, 0] });
    part(L.skin, new THREE.SphereGeometry(.13, 6, 4), [s * .15, .3, .46], { scale: [1, .5, 1.4] });
  } else for (const s of [-1, 1]) {
    part(L.skin, new THREE.CylinderGeometry(.09, .1, .5, 6, 1, true), [s * .14, .3, 0]);
    part(L.skin, new THREE.SphereGeometry(.13, 6, 4), [s * .15, .05, .1], { scale: [1, .45, 1.5] });
  }
  part(L.cloth, new THREE.CylinderGeometry(.33, .41, .76, 10), [0, .92 + up, 0]);
  part(L.cloth, new THREE.TorusGeometry(.29, .09, 4, 10), [0, 1.27 + up, -.02], { rot: [Math.PI / 2, 0, 0] });
  part(L.cloth, new THREE.SphereGeometry(.34, 8, 6), [0, 1.36 + up, -.17], { scale: [1.12, .92, .82] });
  for (const s of [-1, 1]) {
    part(L.cloth, new THREE.CylinderGeometry(.085, .1, .5, 6, 1, true), [s * .41, .9 + up, .04], { rot: [seated ? -.7 : 0, 0, s * .22] });
    part(L.skin, new THREE.SphereGeometry(.1, 6, 4), [s * .47, (seated ? .74 : .62) + up, seated ? .3 : .07]);
  }
  part(L.skin, new THREE.SphereGeometry(.4, 12, 8), [0, 1.43 + up, .05], { scale: [1.2, .78, 1.02] });
  for (const s of [-1, 1]) {
    part(L.face, new THREE.SphereGeometry(.15, 8, 6), [s * .2, 1.61 + up, .2], { color: CREAM });
    part(L.face, new THREE.SphereGeometry(.058, 6, 4), [s * .205, 1.585 + up, .345], { color: PUPIL });
    // heavy lids: a skin cap over the top of each eye, tipped forward for the tired look
    part(L.skin, new THREE.SphereGeometry(.162, 8, 4, 0, Math.PI * 2, 0, Math.PI * .44), [s * .2, 1.61 + up, .2], { rot: [.42, 0, 0] });
  }
  part(L.face, new THREE.CylinderGeometry(.06, .06, .5, 6, 1, true), [0, 1.31 + up, .37], { rot: [0, 0, Math.PI / 2], scale: [1, 1, .75], color: LIPS });
  part(L.face, new THREE.CylinderGeometry(.05, .05, .4, 6, 1, true), [0, 1.255 + up, .35], { rot: [0, 0, Math.PI / 2], scale: [1, 1, .7], color: LIPS });
  const merge = (list: THREE.BufferGeometry[]) => { const g = mergeGeometries(list)!; list.forEach((x) => x.dispose()); return g; };
  return { skin: merge(L.skin), cloth: merge(L.cloth), face: merge(L.face) };
}

export type LowFrogs = ReturnType<typeof createLowFrogs>;
export function createLowFrogs(capacity: number) {
  const group = new THREE.Group(), skinMaterial = toon(), clothMaterial = toon(), faceMaterial = toon({ vertexColors: true });
  const variants = [frog(false), frog(true)].map((g) => {
    const meshes = { skin: new THREE.InstancedMesh(g.skin, skinMaterial, capacity), cloth: new THREE.InstancedMesh(g.cloth, clothMaterial, capacity), face: new THREE.InstancedMesh(g.face, faceMaterial, capacity) };
    for (const m of Object.values(meshes)) { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(m); }
    meshes.skin.setColorAt(0, new THREE.Color()); meshes.cloth.setColorAt(0, new THREE.Color());
    return { meshes, n: 0 };
  });
  const first = variants[0]!.meshes, triangles = (first.skin.geometry.getAttribute("position").count + first.cloth.geometry.getAttribute("position").count + first.face.geometry.getAttribute("position").count) / 3;
  return {
    group, triangles,
    begin() { for (const v of variants) v.n = 0; },
    /** Adds one frog this frame. */
    add(matrix: THREE.Matrix4, skin: THREE.Color, cloth: THREE.Color, seated: boolean) {
      const v = variants[seated ? 1 : 0]!; if (v.n >= capacity) return;
      v.meshes.skin.setMatrixAt(v.n, matrix); v.meshes.cloth.setMatrixAt(v.n, matrix); v.meshes.face.setMatrixAt(v.n, matrix);
      v.meshes.skin.setColorAt(v.n, skin); v.meshes.cloth.setColorAt(v.n, cloth); v.n++;
    },
    end() {
      for (const v of variants) for (const m of Object.values(v.meshes)) {
        m.count = v.n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    },
    count: () => variants[0]!.n + variants[1]!.n,
    dispose() {
      for (const v of variants) for (const m of Object.values(v.meshes)) { m.geometry.dispose(); m.dispose(); }
      skinMaterial.dispose(); clothMaterial.dispose(); faceMaterial.dispose();
    },
  };
}

/**
 * The far tier: when the camera pulls out to the whole ship a frog is a few pixels tall, so each one is a
 * camera-facing card showing the low-poly frog, baked once into a small texture at start.
 */
export function createImpostors(renderer: THREE.WebGLRenderer, capacity: number, skin: THREE.ColorRepresentation, cloth: THREE.ColorRepresentation) {
  const target = new THREE.WebGLRenderTarget(128, 128, { samples: 4 }), bake = new THREE.Scene(), g = frog(false);
  const materials = [toon({ color: skin }), toon({ color: cloth }), toon({ vertexColors: true })];
  bake.add(new THREE.Mesh(g.skin, materials[0]), new THREE.Mesh(g.cloth, materials[1]), new THREE.Mesh(g.face, materials[2]));
  const sun = new THREE.DirectionalLight("#ffffff", 2.2); sun.position.set(-2, 6, 4); bake.add(sun, new THREE.HemisphereLight("#d8d2f0", "#1a1626", 1.6));
  const eye = new THREE.OrthographicCamera(-1, 1, 1.05, -1.05, .1, 20); eye.position.set(0, .9 + Math.sin(.8) * 6, Math.cos(.8) * 6); eye.lookAt(0, .9, 0);
  const before = renderer.getRenderTarget(), clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha(), clipping = renderer.localClippingEnabled;
  renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.localClippingEnabled = false; renderer.clear(); renderer.render(bake, eye);
  renderer.setRenderTarget(before); renderer.setClearColor(clear, alpha); renderer.localClippingEnabled = clipping;
  g.skin.dispose(); g.cloth.dispose(); g.face.dispose(); materials.forEach((m) => m.dispose());
  const card = new THREE.PlaneGeometry(2, 2.1), material = new THREE.MeshBasicMaterial({ map: target.texture, alphaTest: .45 });
  const mesh = new THREE.InstancedMesh(card, material, capacity); mesh.frustumCulled = false; mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  let n = 0;
  return {
    mesh, triangles: 2,
    begin() { n = 0; },
    /** Adds one frog at a floor point, facing the camera. */
    add(x: number, y: number, z: number, camera: THREE.Camera) { if (n >= capacity) return; m.compose(p.set(x, y + .9, z), camera.quaternion, one); mesh.setMatrixAt(n++, m); },
    end() { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; },
    dispose() { card.dispose(); material.dispose(); target.dispose(); mesh.dispose(); },
  };
}

/**
 * The swarm's drone-frogs: tiny frog heads on glowing rotor rings, orbiting the uplink dish in a holo
 * cloud. Their number follows the IMD agents online, one per ten, capped.
 */
export function createDrones(capacity: number) {
  const L: Lists = { skin: [], cloth: [], face: [] }, GREEN = new THREE.Color("#6fc04e");
  part(L.skin, new THREE.SphereGeometry(.1, 10, 8), [0, 0, 0], { scale: [1.2, .8, 1], color: GREEN });
  for (const s of [-1, 1]) part(L.skin, new THREE.SphereGeometry(.038, 8, 6), [s * .05, .055, .05], { color: CREAM });
  part(L.skin, new THREE.TorusGeometry(.14, .014, 4, 16), [0, -.03, 0], { rot: [Math.PI / 2, 0, 0], color: new THREE.Color("#38d2ff").multiplyScalar(1.5) });
  const geometry = mergeGeometries(L.skin)!; L.skin.forEach((g) => g.dispose());
  const material = toon({ vertexColors: true, emissive: "#0b3a4a" }), mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.frustumCulled = false; mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  // a loose shell round the dish: radius 1.3 to 3.1, from head height to just over the bowl
  const seeds = Array.from({ length: capacity }, (_, i) => ({ r: 1.3 + ((i * 37) % 23) / 23 * 1.8, h: 1.7 + ((i * 53) % 17) / 17 * 1.9, a: i * 2.399, w: (.2 + ((i * 11) % 7) / 7 * .3) * (i % 2 ? 1 : -1) }));
  return {
    mesh, triangles: geometry.getAttribute("position").count / 3,
    update(count: number, center: THREE.Vector3, time: number) {
      mesh.count = Math.min(capacity, count);
      for (let i = 0; i < mesh.count; i++) {
        const d = seeds[i]!, a = d.a + time * d.w;
        p.set(center.x + Math.cos(a) * d.r, center.y + d.h + Math.sin(time * 1.3 + i) * .08, center.z + Math.sin(a) * d.r);
        q.setFromAxisAngle(up, -a + (d.w > 0 ? 0 : Math.PI)); m.compose(p, q, s); mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); },
  };
}
