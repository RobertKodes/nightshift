import * as THREE from "three";

const R = 150;
/**
 * The space around the ship: the night side of the Earth behind it, its thin blue limb arcing across
 * the top of the view, a sharp network of amber city lights traced over the NASA Black Marble map, and
 * stars below the deck. It is a backdrop: it travels with the camera, is drawn first and never
 * depth-tested, so it reads as infinitely far away and the ship always sits in front of it. The Earth
 * fades out down the screen, so the space under the ship shows stars, as in the concept art.
 */
export function createOutside(onFail: () => void, at: THREE.Vector3) {
  const group = new THREE.Group();
  const fade = { res: { value: new THREE.Vector2(1, 1) }, fade: { value: new THREE.Vector2(.42, .6) } };
  const uniforms = { map: { value: null as THREE.Texture | null }, ready: { value: 0 }, ...fade };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 48), new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 p = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-p.xyz); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `uniform sampler2D map; uniform float ready; uniform vec2 res; uniform vec2 fade; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      vec2 hash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
      // distance to the nearest cell border of a jittered grid: thin lines that read as roads between towns
      float border(vec2 p) {
        vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y)), r = g + hash2(i + g) - f; float d = dot(r, r);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        return sqrt(d2) - sqrt(d1);
      }
      void main(){
        float f = smoothstep(fade.x, fade.y, gl_FragCoord.y / res.y); if (f < .01) discard;
        vec3 n = normalize(vN), v = normalize(vV); float facing = max(dot(n, v), 0.0), haze = pow(1.0 - facing, 12.0);
        float l = dot(texture2D(map, vUv).rgb, vec3(.3, .5, .2)) * ready;
        float lines = (1.0 - smoothstep(.0, .05, border(vUv * vec2(1400.0, 700.0)))) * smoothstep(.05, .3, l);
        float towns = smoothstep(.3, .85, l);
        vec3 city = vec3(1.0, .55, .18) * (lines * 1.1 + towns * .9 + pow(l, 1.6) * .4) + vec3(1.0, .85, .55) * pow(towns, 3.0) * 1.2;
        vec3 ground = vec3(.01, .018, .055) + vec3(.02, .05, .14) * haze;
        float dawn = smoothstep(.15, .95, n.x) * haze;
        gl_FragColor = vec4((ground + city * (1.0 - haze * .9) + vec3(.05, .16, .45) * haze * .8 + vec3(.6, .25, .06) * dawn * .6) * f, 1.0);
      }`,
  }));
  const limb = new THREE.Mesh(new THREE.SphereGeometry(R * 1.016, 96, 48), new THREE.ShaderMaterial({
    uniforms: fade, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 p = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-p.xyz); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `uniform vec2 res; uniform vec2 fade; varying vec3 vN; varying vec3 vV;
      void main(){
        float f = smoothstep(fade.x, fade.y, gl_FragCoord.y / res.y); if (f < .01) discard;
        vec3 n = normalize(vN); float rim = 1.0 - abs(dot(n, normalize(vV))), band = pow(rim, 15.0) * 1.4 + pow(rim, 52.0) * 2.6;
        float dawn = smoothstep(-.1, .9, n.x);
        gl_FragColor = vec4(mix(vec3(.16, .42, 1.0), vec3(1.0, .5, .18), dawn * .75) * band * f, 1.0);
      }`,
  }));
  earth.renderOrder = -10; limb.renderOrder = -9;
  const globe = new THREE.Group(); globe.add(earth, limb); globe.position.copy(at);
  const phi = (10 + 180) * Math.PI / 180, theta = (90 - 44) * Math.PI / 180;
  const city = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
  const base = new THREE.Quaternion().setFromUnitVectors(city, globe.position.clone().negate().normalize()), spin = new THREE.Quaternion(), axis = new THREE.Vector3(1, 0, 0);
  group.add(globe);

  // stars all round (the RTS camera looks down, so most of what it sees of the sky is below the ship)
  const count = 2600, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  let seed = 11; const random = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < count; i++) {
    const u = random() * 2 - 1, a = random() * Math.PI * 2, s = Math.sqrt(1 - u * u), b = .45 + random() ** 3 * 1.7, warm = random();
    positions.set([Math.cos(a) * s * 320, u * 320, Math.sin(a) * s * 320], i * 3);
    colors.set([b * (warm > .8 ? 1 : .82), b * .88, b * (warm < .3 ? 1 : .92)], i * 3);
  }
  const stars = new THREE.BufferGeometry(); stars.setAttribute("position", new THREE.BufferAttribute(positions, 3)); stars.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const starMaterial = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false, depthTest: false });
  const points = new THREE.Points(stars, starMaterial); points.renderOrder = -11; group.add(points);

  let disposed = false, texture: THREE.Texture | null = null;
  const ready = new THREE.TextureLoader().loadAsync("/art/earth/black-marble-2048.webp").then((map) => {
    if (disposed) { map.dispose(); return null; }
    texture = map; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8; uniforms.map.value = map; uniforms.ready.value = 1;
    return map;
  }).catch(() => { onFail(); return null; });

  return {
    group, ready,
    /** The drawing buffer size, for the screen-space fade. */
    resize(width: number, height: number) { fade.res.value.set(width, height); },
    /** Follows the camera; the Earth turns slowly below as the station orbits. */
    update(camera: THREE.Camera, time: number) {
      group.position.copy(camera.position);
      globe.quaternion.copy(spin.setFromAxisAngle(axis, time * .0016)).multiply(base);
    },
    dispose() {
      disposed = true; texture?.dispose(); stars.dispose(); starMaterial.dispose();
      for (const m of [earth, limb]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    },
  };
}
