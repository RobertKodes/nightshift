import * as THREE from "three";

/** Real collection art, stitched into a local canvas decal; no generated or substituted frog art. */
export function createMissionPatch() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1024;
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const pixels = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const i = (y * 128 + x) * 4, v = 120 + Math.sin(x * 2.1 + y * .65) * 23 + Math.cos(y * 2.3) * 17;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = v; pixels[i + 3] = 255;
  }
  const relief = new THREE.DataTexture(pixels, 128, 128); relief.generateMipmaps = true; relief.minFilter = THREE.LinearMipmapLinearFilter; relief.needsUpdate = true; relief.magFilter = THREE.LinearFilter;
  const material = new THREE.MeshStandardMaterial({ map, bumpMap: relief, bumpScale: .016, roughness: .76, metalness: .12, alphaTest: .4, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 1.65), material);
  mesh.position.set(0, .84, 1.19);
  const context = canvas.getContext("2d"); let cancelled = false;
  const paint = (art?: HTMLImageElement) => {
    if (!context || cancelled) return;
    context.clearRect(0, 0, 1024, 1024);
    context.fillStyle = "#c2a05d"; context.beginPath(); context.arc(512, 512, 494, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#17202a"; context.beginPath(); context.arc(512, 512, 465, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "#e1c58a"; context.lineWidth = 6;
    for (let i = 0; i < 220; i++) { const a = i / 220 * Math.PI * 2; context.beginPath(); context.moveTo(512 + Math.cos(a) * 478, 512 + Math.sin(a) * 478); context.lineTo(512 + Math.cos(a) * 490, 512 + Math.sin(a) * 490); context.stroke(); }
    context.save(); context.beginPath(); context.arc(512, 512, 324, 0, Math.PI * 2); context.clip();
    if (art) { const size = Math.min(art.naturalWidth, art.naturalHeight); context.drawImage(art, (art.naturalWidth - size) / 2, (art.naturalHeight - size) / 2, size, size, 184, 184, 656, 656); }
    context.restore(); context.strokeStyle = "#c2a05d"; context.lineWidth = 10; context.beginPath(); context.arc(512, 512, 329, 0, Math.PI * 2); context.stroke();
    context.fillStyle = "#ede2ca"; context.font = '600 100px ui-monospace, Consolas, monospace'; context.textAlign = "center"; context.textBaseline = "middle";
    const title = "NIGHTSHIFT";
    for (let i = 0; i < title.length; i++) { const a = -.98 + i / (title.length - 1) * 1.96; context.save(); context.translate(512 + Math.sin(a) * 401, 512 - Math.cos(a) * 401); context.rotate(a); context.fillText(title[i]!, 0, 0); context.restore(); }
    context.font = '500 58px ui-monospace, Consolas, monospace'; context.fillText("NIGHT FROGS / 01", 512, 900);
    map.needsUpdate = true;
  };
  paint();
  const ready = new Promise<void>((resolve) => { const art = new Image(); art.onload = () => { paint(art); resolve(); }; art.onerror = () => resolve(); art.src = "/frogs/frog-001.webp"; });
  return { mesh, canvas, ready, cancel() { cancelled = true; } };
}
