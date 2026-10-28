import * as THREE from "three";

const R = 150;
/**
 * What the windows show: the night side of the Earth close below the station (NASA Black Marble city
 * lights, a thin blue limb warming toward the sunrise) and the stars. It travels with the camera, so it
 * reads as infinitely far away from every room.
 */
export function createOutside(onFail: () => void) {
  const group = new THREE.Group(), uniforms = { map: { value: null as THREE.Texture | null }, ready: { value: 0 } };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 p = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-p.xyz); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `uniform sampler2D map; uniform float ready; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 n = normalize(vN), v = normalize(vV); float facing = max(dot(n, v), 0.0), haze = pow(1.0 - facing, 12.0);
        float l = dot(texture2D(map, vUv).rgb, vec3(.3, .5, .2)) * ready;
        vec3 city = vec3(1.0, .52, .18) * pow(l, 1.1) * 9.0 + vec3(1.0, .84, .58) * pow(l, 2.6) * 14.0;
        vec3 ground = vec3(.003, .006, .014) + vec3(.01, .026, .07) * haze;
        float dawn = smoothstep(.15, .95, n.x) * haze;
        gl_FragColor = vec4(ground + city * (1.0 - haze * .9) + vec3(.05, .16, .45) * haze * .8 + vec3(.6, .25, .06) * dawn * .6, 1.0);
      }`,
  }));
  const limb = new THREE.Mesh(new THREE.SphereGeometry(R * 1.016, 128, 64), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 p = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-p.xyz); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 n = normalize(vN); float rim = 1.0 - abs(dot(n, normalize(vV))), band = pow(rim, 7.0) * 1.4 + pow(rim, 24.0) * 2.5;
        float dawn = smoothstep(-.1, .9, n.x);
        vec3 c = mix(vec3(.16, .42, 1.0), vec3(1.0, .5, .18), dawn * .75) * band;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  const globe = new THREE.Group(); globe.add(earth, limb);
  // the station is over the northern night side, the horizon a little below eye level
  globe.position.set(0, -153.6, -77.5);
  const phi = (10 + 180) * Math.PI / 180, theta = (90 - 44) * Math.PI / 180;
  const city = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
  const base = new THREE.Quaternion().setFromUnitVectors(city, globe.position.clone().negate().normalize()), spin = new THREE.Quaternion(), axis = new THREE.Vector3(1, 0, 0);
  group.add(globe);

  const count = 1400, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  let seed = 11; const random = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < count; i++) {
    const u = random() * 2 - 1, a = random() * Math.PI * 2, s = Math.sqrt(1 - u * u), b = .55 + random() ** 3 * 1.6, warm = random();
    positions.set([Math.cos(a) * s * 320, Math.abs(u) * 320 - 30, Math.sin(a) * s * 320], i * 3);
    colors.set([b * (warm > .8 ? 1 : .86), b * .92, b * (warm < .25 ? 1 : .88)], i * 3);
  }
  const stars = new THREE.BufferGeometry(); stars.setAttribute("position", new THREE.BufferAttribute(positions, 3)); stars.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const starMaterial = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false });
  group.add(new THREE.Points(stars, starMaterial));

  let disposed = false, texture: THREE.Texture | null = null;
  void new THREE.TextureLoader().loadAsync("/art/earth/black-marble-2048.webp").then((map) => {
    if (disposed) { map.dispose(); return; }
    texture = map; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8; uniforms.map.value = map; uniforms.ready.value = 1;
  }).catch(onFail);

  return {
    group,
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
