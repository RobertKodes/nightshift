import * as THREE from "three";
import { toonRamp } from "./assets";

/**
 * A bog leech: a long body, flat underneath, ringed, wet olive-black with two orange stripes and a
 * sucker at the front. It moves the way a leech does: a wave runs down its body, and it rears to bite.
 */
let geom: THREE.BufferGeometry | null = null;
function leechGeometry(): THREE.BufferGeometry {
  if (geom) return geom;
  const len = 1.5, segs = 48, ring = 18;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, z = (t - 0.5) * len;
    // fat in the middle, a sucker disc at the head (t = 1), a tapering tail
    const r = 0.2 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.55) * (1 + 0.06 * Math.sin(t * 70)) + (t > 0.93 ? 0.03 : 0);
    for (let j = 0; j <= ring; j++) {
      const a = (j / ring) * Math.PI * 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      pos.push(x, y < 0 ? y * 0.45 : y * 1.05, z); uv.push(j / ring, t);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < ring; j++) {
    const a = i * (ring + 1) + j, b = a + ring + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  geom.translate(0, 0.07, 0);
  return geom;
}

export class Leech {
  readonly root = new THREE.Group();
  #u = { uTime: { value: Math.random() * 10 }, uCrawl: { value: 0 }, uRear: { value: 0 }, uHit: { value: 0 } };
  #rear = 0;
  #hit = 0;
  dead = false;

  constructor() {
    const mat = new THREE.MeshToonMaterial({ color: 0x3f5a1c, gradientMap: toonRamp() });
    const u = this.#u;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime, uCrawl, uRear; varying vec2 vUv2;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vUv2 = uv;
          float t = uv.y;
          // the travelling wave, faster when it crawls; rearing lifts the front third
          float ph = t * 9.0 - uTime * (1.5 + uCrawl * 5.0);
          transformed.x += sin(ph) * 0.07 * (0.4 + uCrawl);
          transformed.y += max(0.0, sin(ph + 1.2)) * 0.05 * uCrawl;
          float front = smoothstep(0.62, 1.0, t);
          transformed.y += front * front * uRear * 0.55;
          transformed.z -= front * uRear * 0.18;`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uHit; varying vec2 vUv2;")
        .replace("vec4 diffuseColor = vec4( diffuse, opacity );", `
          float side = abs(vUv2.x - 0.25);
          float stripe = smoothstep(0.07, 0.05, abs(side - 0.11)) * step(0.08, vUv2.y) * step(vUv2.y, 0.9);
          float rings = 0.88 + 0.12 * sin(vUv2.y * 150.0);
          float belly = smoothstep(0.55, 0.75, abs(vUv2.x - 0.75) < 0.2 ? 1.0 : 0.0);
          vec3 c = diffuse * rings;
          c = mix(c, vec3(1.0, 0.52, 0.16), stripe);
          c = mix(c, vec3(0.25, 0.2, 0.12), belly * 0.5);
          c = mix(c, vec3(0.9, 0.35, 0.25), uHit);
          vec4 diffuseColor = vec4(c, opacity);`)
        .replace("#include <opaque_fragment>", `
          vec3 vd = normalize(vViewPosition);
          float rim = pow(1.0 - saturate(dot(normal, vd)), 3.0);
          float spec = pow(saturate(dot(reflect(-vd, normal), normalize(vec3(0.2, 1.0, 0.3)))), 40.0);
          // a wet shine and a bright rim, so a leech reads on dark stone; the stripes glow a little
          outgoingLight += vec3(0.55, 0.7, 0.9) * (rim * 0.22 + spec * 0.45);
          float side2 = abs(vUv2.x - 0.25);
          outgoingLight += vec3(1.0, 0.45, 0.1) * smoothstep(0.07, 0.05, abs(side2 - 0.11)) * 0.35;
          #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => "leech";
    const body = new THREE.Mesh(leechGeometry(), mat);
    body.castShadow = true; body.receiveShadow = true;
    // big enough to read as a threat next to a frog
    body.scale.setScalar(1.7);
    this.root.add(body);
  }

  /** crawl: 0 resting to 1 hurrying; bite: rear up and strike */
  update(dt: number, crawl: number) {
    this.#u.uTime.value += dt;
    this.#u.uCrawl.value += (crawl - this.#u.uCrawl.value) * Math.min(1, dt * 4);
    this.#rear = Math.max(0, this.#rear - dt * 2.2);
    this.#u.uRear.value = Math.sin(Math.min(1, this.#rear) * Math.PI);
    this.#hit = Math.max(0, this.#hit - dt * 4);
    this.#u.uHit.value = this.#hit;
    if (this.dead) this.root.scale.y = Math.max(0.15, this.root.scale.y - dt * 1.2);
  }
  bite() { this.#rear = 1; }
  hurt() { this.#hit = 1; }
}
