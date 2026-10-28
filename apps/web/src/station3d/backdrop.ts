import * as THREE from "three";

const vertex = `varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** A seamless, aspect-correct nebula sits behind the unchanged painted night Earth. */
export function createBackdrop(camera: THREE.PerspectiveCamera, wide: boolean) {
  const group = new THREE.Group(); camera.add(group);
  const textures = new Set<THREE.Texture>();
  const loader = new THREE.TextureLoader();
  let disposed = false, loaded = false;
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: { aspect: { value: 1 }, drift: { value: new THREE.Vector2() } },
    vertexShader: vertex,
    fragmentShader: `
      varying vec2 vUv;
      uniform float aspect;
      uniform vec2 drift;
      float hash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * .1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float sum = 0.0, amplitude = .5;
        for (int i = 0; i < 4; i++) {
          sum += amplitude * noise(p);
          p = mat2(.8, -.6, .6, .8) * p * 2.03 + 8.7;
          amplitude *= .5;
        }
        return sum;
      }
      void main() {
        // No sampled edges or clamped UVs: the same soft clouds extend beyond every viewport.
        vec2 p = (vUv - .5) * vec2(aspect, 1.0) * 3.2 + drift * 3.0;
        float cloud = fbm(p * 1.4 + vec2(4.0, 9.0));
        float band = exp(-pow((p.x - .5 - p.y * .62) * 1.2, 2.0));
        float light = smoothstep(.32, .76, cloud) * band;
        float dust = smoothstep(.42, .8, cloud) * .6;
        vec3 sky = vec3(.0017, .0008, .005);
        sky += mix(vec3(.019, .009, .065), vec3(.075, .016, .17), dust) * light;
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }`,
    depthWrite: false, depthTest: false, toneMapped: false,
  });
  const earthMaterial = new THREE.ShaderMaterial({
    uniforms: { painting: { value: null }, desktop: { value: null }, wide: { value: wide ? 1 : 0 }, drift: { value: new THREE.Vector2() } },
    vertexShader: vertex,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D painting;
      uniform sampler2D desktop;
      uniform float wide;
      uniform vec2 drift;
      void main() {
        vec2 uv = clamp((vUv - .5) * .95 + .5 + drift, .002, .998);
        // Mobile y=1240..1920: Earth and city lights, with no ship or station.
        vec3 earth = texture2D(painting, vec2(uv.x, uv.y * .35416)).rgb;
        if (wide > .5) {
          vec3 cities = texture2D(desktop, vec2(.69 + uv.x * .31, uv.y * .22)).rgb;
          earth = mix(earth, cities, (1.0 - smoothstep(.2, .7, vUv.y)) * .45);
        }
        float fade = 1.0 - smoothstep(.86, 1.0, vUv.y);
        gl_FragColor = vec4(earth, fade);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, toneMapped: false,
  });
  const geometry = new THREE.PlaneGeometry(1, 1);
  const sky = new THREE.Mesh(geometry, skyMaterial), earth = new THREE.Mesh(geometry, earthMaterial);
  sky.renderOrder = -100; earth.renderOrder = -90;
  group.add(sky, earth); group.visible = false;

  const load = async (path: string) => {
    const texture = await loader.loadAsync(path);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
    if (disposed) texture.dispose(); else textures.add(texture);
    return texture;
  };
  const ready = Promise.all([
    load("/art/station/gate-station-mobile-1080x1920.webp"),
    wide ? load("/art/station/gate-station-2400x1350.webp") : Promise.resolve(null),
  ]).then(([painting, desktop]) => {
    if (disposed) return;
    earthMaterial.uniforms.painting!.value = painting;
    earthMaterial.uniforms.desktop!.value = desktop ?? painting;
    group.visible = true; loaded = true;
  });

  return {
    ready,
    update(progress: number, x: number, y: number, phone: boolean) {
      if (!loaded) return;
      // Scroll changes the distant layers by only a few pixels while the station rotates.
      skyMaterial.uniforms.drift!.value.set(x * .005 + progress * .001, -y * .003);
      skyMaterial.uniforms.aspect!.value = camera.aspect;
      earthMaterial.uniforms.drift!.value.set(x * .009 + progress * .002, -y * .004);
      const distance = 100, h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance, w = h * camera.aspect;
      const view = camera.view;
      const cx = view?.enabled ? view.offsetX / view.fullWidth * w : 0;
      const cy = view?.enabled ? -view.offsetY / view.fullHeight * h : 0;
      sky.scale.set(w * 1.06, h * 1.06, 1); sky.position.set(cx, cy, -distance);
      const fraction = phone ? .48 : .55;
      earth.scale.set(w * 1.06, h * fraction, 1);
      earth.position.set(cx, cy - h * (1 - fraction) / 2 - h * .025, -distance + .1);
    },
    dispose() {
      disposed = true; camera.remove(group);
      textures.forEach((texture) => texture.dispose()); textures.clear();
      geometry.dispose(); skyMaterial.dispose(); earthMaterial.dispose(); group.clear();
    },
  };
}
