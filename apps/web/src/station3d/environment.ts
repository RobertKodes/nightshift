import * as THREE from "three";

/** A tiny neutral reflection field approximates the sun and blue Earth bounce on metal. */
export function createEnvironment(renderer: THREE.WebGLRenderer) {
  const studio = new THREE.Scene(), geometry = new THREE.SphereGeometry(12, 16, 8);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `varying vec3 vDirection; void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDirection; void main() {
      vec3 d = normalize(vDirection);
      vec3 color = vec3(.001, .002, .003);
      color += vec3(.045, .11, .23) * pow(max(0.0, -d.y), 2.0);
      color += vec3(4.8, 4.4, 3.7) * pow(max(0.0, dot(d, normalize(vec3(-14.0, 6.0, 4.0)))), 64.0);
      color += vec3(.025, .065, .14) * pow(1.0 - abs(d.y), 6.0);
      gl_FragColor = vec4(color, 1.0); }`,
  });
  studio.add(new THREE.Mesh(geometry, material));
  const generator = new THREE.PMREMGenerator(renderer);
  try { return generator.fromScene(studio, .05, .1, 30); }
  finally { geometry.dispose(); material.dispose(); generator.dispose(); studio.clear(); }
}
