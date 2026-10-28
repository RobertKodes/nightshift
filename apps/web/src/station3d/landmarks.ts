import * as THREE from "three";

/** A single small, oversampled instrument label; all other modules remain unlabelled. */
export function createDockLabel(name: string, color: string) {
  const canvas = document.createElement("canvas"); canvas.width = 768; canvas.height = 168;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, depthTest: false, transparent: true, toneMapped: false });
  const sprite = new THREE.Sprite(material); sprite.renderOrder = 10;
  const refresh = () => {
    const context = canvas.getContext("2d"); if (!context) return;
    context.clearRect(0, 0, 768, 168); context.fillStyle = "#101419f2"; context.fillRect(6, 6, 756, 156);
    context.strokeStyle = "#5a626c"; context.lineWidth = 2; context.strokeRect(6, 6, 756, 156);
    context.fillStyle = color; context.fillRect(6, 6, 7, 156);
    context.font = '500 72px ui-monospace, "Cascadia Mono", Consolas, monospace';
    context.fillStyle = "#e3e7ed"; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(name.toUpperCase(), 384, 86, 690); texture.needsUpdate = true;
  };
  refresh();
  return { sprite, refresh };
}
