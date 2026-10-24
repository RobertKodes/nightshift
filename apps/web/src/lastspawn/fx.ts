import * as THREE from "three";

/** Water: blue-black, a fresnel sheen, slow ripples, rings where drops fall, and the moon's light on it. */
export function waterMaterial(o: { color?: THREE.ColorRepresentation; deep?: THREE.ColorRepresentation; moon?: THREE.Vector3; radius?: number } = {}) {
  const drops = Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -100, 0));
  const u = {
    uTime: { value: 0 }, uShallow: { value: new THREE.Color(o.color ?? 0x1d3a46) }, uDeep: { value: new THREE.Color(o.deep ?? 0x03080c) },
    uMoon: { value: o.moon ?? new THREE.Vector3(0, 1, 0) }, uRadius: { value: o.radius ?? 0 }, uDrops: { value: drops },
    uGlow: { value: new THREE.Color(0x8fb0ff) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsLib.fog, ...u }, fog: true, transparent: true, depthWrite: false,
    vertexShader: `
      varying vec3 vWorld; varying vec2 vLocal;
      #include <fog_pars_vertex>
      void main() {
        vLocal = position.xz;
        vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime, uRadius; uniform vec3 uShallow, uDeep, uMoon, uGlow; uniform vec4 uDrops[6];
      varying vec3 vWorld; varying vec2 vLocal;
      #include <fog_pars_fragment>
      float wave(vec2 p) { return sin(p.x * 1.7 + uTime * 0.9) * 0.5 + sin(p.y * 2.3 - uTime * 0.7) * 0.5 + sin((p.x + p.y) * 3.1 + uTime * 1.3) * 0.25; }
      void main() {
        vec2 p = vWorld.xz;
        float e = 0.08;
        vec3 n = normalize(vec3(wave(p + vec2(e, 0.0)) - wave(p - vec2(e, 0.0)), 6.0, wave(p + vec2(0.0, e)) - wave(p - vec2(0.0, e))));
        // rings where drops fell: each spreads for two seconds
        for (int i = 0; i < 6; i++) {
          float age = uTime - uDrops[i].z;
          if (age > 0.0 && age < 2.2) {
            float d = length(p - uDrops[i].xy) - age * 1.6;
            n.xz += (vec2(p - uDrops[i].xy) / max(0.001, length(p - uDrops[i].xy))) * sin(d * 18.0) * exp(-d * d * 6.0) * (1.0 - age / 2.2) * 0.6;
          }
        }
        n = normalize(n);
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 col = mix(uDeep, uShallow, 0.25 + fres * 0.75);
        // the moon (or the shaft of moonlight) on the water
        vec3 r = reflect(-v, n);
        float glint = pow(max(dot(r, normalize(uMoon)), 0.0), 220.0);
        col += uGlow * (glint * 2.2 + fres * 0.08);
        float alpha = 0.86 + fres * 0.14;
        if (uRadius > 0.0) alpha *= smoothstep(uRadius, uRadius - 0.6, length(vLocal)) * 0.35 + 0.65;
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });
  let next = 0;
  return {
    mat, u,
    /** A drop falls here now: a ring spreads from it. */
    drop(x: number, z: number) { drops[next % drops.length]!.set(x, z, u.uTime.value, 1); next++; },
  };
}

/** A soft cone of moonlight with dust drifting through it, for a shaft from a grate or a window. */
export function lightShaft(radiusTop: number, radiusBottom: number, height: number, color: THREE.ColorRepresentation = 0x9fb4ff) {
  const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 40, 1, true);
  g.translate(0, -height / 2, 0);
  const u = { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uHeight: { value: height }, uInside: { value: radiusBottom } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vPos; varying vec3 vN; varying vec3 vView; varying float vCamR;
      void main() {
        vPos = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = -mv.xyz;
        vCamR = length(cameraPosition.xz - modelMatrix[3].xz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uTime, uHeight, uInside; uniform vec3 uColor; varying vec3 vPos; varying vec3 vN; varying vec3 vView; varying float vCamR;
      float n2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(n2(i), n2(i + vec2(1, 0)), f.x), mix(n2(i + vec2(0, 1)), n2(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float t = -vPos.y / uHeight;
        float edge = pow(abs(dot(normalize(vN), normalize(vView))), 1.6);
        float streaks = vn(vec2(atan(vPos.z, vPos.x) * 6.0, vPos.y * 0.4 - uTime * 0.12)) * 0.6 + 0.4;
        float a = edge * streaks * smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.75, 1.0, t)) * 0.16;
        // from inside the shaft its walls would haze the whole view: they nearly vanish
        a *= mix(0.12, 1.0, smoothstep(uInside * 0.8, uInside * 1.15, vCamR));
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 5;
  return { mesh, u };
}

/** Drifting points of light: dust in a shaft, fireflies round a lantern, spores over the reeds. */
export function motes(o: { count: number; box: THREE.Box3; color: THREE.ColorRepresentation; size: number; speed: number; blink?: boolean }) {
  const pos = new Float32Array(o.count * 3), seed = new Float32Array(o.count);
  const s = new THREE.Vector3(); o.box.getSize(s);
  for (let i = 0; i < o.count; i++) {
    pos[i * 3] = o.box.min.x + Math.random() * s.x; pos[i * 3 + 1] = o.box.min.y + Math.random() * s.y; pos[i * 3 + 2] = o.box.min.z + Math.random() * s.z;
    seed[i] = Math.random() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
  const u = { uTime: { value: 0 }, uColor: { value: new THREE.Color(o.color) }, uSize: { value: o.size }, uSpeed: { value: o.speed }, uBlink: { value: o.blink ? 1 : 0 },
    uMin: { value: o.box.min.clone() }, uSpan: { value: s.clone() }, uPx: { value: Math.min(1.5, window.devicePixelRatio || 1) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime, uSize, uSpeed, uPx; uniform vec3 uMin, uSpan; attribute float seed; varying float vA;
      uniform float uBlink;
      void main() {
        vec3 p = position;
        float t = uTime * uSpeed + seed;
        p += vec3(sin(t * 0.7 + seed) * 0.6, sin(t * 0.43 + seed * 2.0) * 0.4, cos(t * 0.55 + seed) * 0.6);
        p = uMin + mod(p - uMin, uSpan);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = uBlink > 0.5 ? smoothstep(0.55, 1.0, sin(uTime * 1.3 + seed * 3.0) * 0.5 + 0.5) : 0.6 + 0.4 * sin(uTime + seed);
        // nothing right at the lens: a point there would fill the screen
        float depth = -mv.z;
        vA *= smoothstep(0.4, 1.4, depth);
        gl_PointSize = clamp(uSize * uPx * (60.0 / max(depth, 0.4)), 0.0, 26.0);
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor * a * vA, 1.0); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return { points: pts, u };
}

/** A flame: two crossed glowing cards that flicker, for torches and lanterns (bloom makes them burn). */
export function flame(scale = 1, color: THREE.ColorRepresentation = 0xffa04a) {
  const u = { uTime: { value: Math.random() * 10 }, uColor: { value: new THREE.Color(color) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; uniform float uTime; void main() { vUv = uv; vec3 p = position; p.x += sin(uTime * 9.0 + p.y * 6.0) * 0.03 * p.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uColor;
      void main() {
        vec2 p = vUv - vec2(0.5, 0.15);
        float w = 0.22 * (1.0 - vUv.y) + 0.02;
        float body = smoothstep(w, w * 0.25, abs(p.x + sin(uTime * 7.0 + vUv.y * 8.0) * 0.03 * vUv.y)) * smoothstep(1.0, 0.25, vUv.y) * smoothstep(0.0, 0.12, vUv.y);
        vec3 c = mix(uColor, vec3(1.0, 0.95, 0.75), smoothstep(0.4, 0.9, body) * (1.0 - vUv.y));
        gl_FragColor = vec4(c * body * 2.4, 1.0);
      }`,
  });
  const grp = new THREE.Group();
  for (const r of [0, Math.PI / 2]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34 * scale, 0.62 * scale), mat);
    m.position.y = 0.26 * scale; m.rotation.y = r; grp.add(m);
  }
  return { group: grp, u };
}
