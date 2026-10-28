import * as THREE from "three";

/** A real globe stays far behind the hardware; the only image is local NASA Black Marble. */
export function createBackdrop(camera: THREE.PerspectiveCamera, wide: boolean) {
  const group = new THREE.Group(); camera.add(group);
  const loader = new THREE.TextureLoader();
  const surface = new THREE.MeshStandardMaterial({ color: "#010204", roughness: 1, metalness: 0, emissive: "#ffffff", emissiveIntensity: 3.1 });
  // Grade the existing image in linear light: protect near-black land/ocean while warming real city pixels.
  surface.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", `
      #ifdef USE_EMISSIVEMAP
        vec3 night = texture2D(emissiveMap, vEmissiveMapUv).rgb;
        float lit = smoothstep(.025, .22, dot(night, vec3(.25, .65, .1)));
        float warm = smoothstep(.6, 1.15, night.r / max(night.b, .001));
        vec3 land = night * vec3(.22, .28, .34);
        vec3 cities = night * vec3(2.1, 1.22, .42);
        totalEmissiveRadiance *= mix(land, cities, lit * warm);
      #endif
    `);
  };
  surface.customProgramCacheKey = () => "black-marble-warm-cities-v1";
  const earth = new THREE.Mesh(new THREE.SphereGeometry(52, wide ? 80 : 48, wide ? 48 : 32), surface);
  earth.rotation.set(.14, 2.4, -.23); group.add(earth);
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(52.22, 48, 32), new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vNormal; varying vec3 vView;
      void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); vNormal = normalize(normalMatrix * normal); vView = normalize(-p.xyz); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `varying vec3 vNormal; varying vec3 vView;
      void main() {
        vec3 normal = normalize(vNormal);
        float fresnel = 1.0 - abs(dot(normal, normalize(vView)));
        float rim = pow(fresnel, 12.0);
        // Only the sunward arc has a narrow orange sunrise, fading inward into the blue limb.
        float sunward = pow(max(0.0, dot(normalize(normal.xy + vec2(.0001)), normalize(vec2(-.88, .42)))), 18.0);
        float sunrise = sunward * smoothstep(.75, .98, fresnel);
        vec3 limb = mix(vec3(.025, .28, 1.25), vec3(2.2, .55, .055), sunrise);
        gl_FragColor = vec4(limb, rim * .86);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  group.add(atmosphere);
  let disposed = false, texture: THREE.Texture | undefined;
  const ready = loader.loadAsync(`/art/earth/black-marble-${wide ? "4096" : "2048"}.webp`).then((image) => {
    if (disposed) { image.dispose(); return; }
    texture = image; texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2; surface.emissiveMap = texture; surface.needsUpdate = true;
  });
  return {
    ready,
    update(time: number, phone: boolean) {
      // Fixed orbital distance; never follows pointer input or scroll as a painted plane.
      group.position.set(phone ? 8 : 20, phone ? -58 : -55, -130);
      earth.rotation.y = 2.4 + time * .0015;
    },
    dispose() {
      disposed = true; camera.remove(group); texture?.dispose();
      earth.geometry.dispose(); surface.dispose(); atmosphere.geometry.dispose(); atmosphere.material.dispose();
    },
  };
}
