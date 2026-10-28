import * as THREE from "three";

/** Bake a small violet-blue studio once; curved metal then has something soft to reflect. */
export function createEnvironment(renderer: THREE.WebGLRenderer) {
  const studio = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(12, 24, 12);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `varying vec3 vDirection;
      void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDirection;
      void main() {
        vec3 d = normalize(vDirection);
        vec3 color = mix(vec3(.018, .008, .05), vec3(.12, .17, .3), smoothstep(-.6, .9, d.y));
        color += vec3(.42, .24, .82) * pow(max(0.0, dot(d, normalize(vec3(-.8, .4, -.6)))), 6.0);
        color += vec3(1.2, 1.03, .83) * pow(max(0.0, dot(d, normalize(vec3(.5, .8, .7)))), 18.0);
        gl_FragColor = vec4(color, 1.0);
      }`,
  });
  studio.add(new THREE.Mesh(geometry, material));
  const generator = new THREE.PMREMGenerator(renderer);
  try { return generator.fromScene(studio, .08, .1, 30); }
  finally { geometry.dispose(); material.dispose(); generator.dispose(); studio.clear(); }
}
