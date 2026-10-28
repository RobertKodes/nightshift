import * as THREE from "three";
import type { SiteSection } from "../site/sitemap";
import { GeometryBatch } from "./geometry";

/** Silhouettes make the six bays distinct even before their name comes into view. */
export function addLandmark(kind: SiteSection["dock"], hull: GeometryBatch, light: GeometryBatch) {
  if (kind === "workshop") {
    for (const x of [-1.1, 1.1]) { hull.box(.2, 1.9, .24, x, 1.1, -.2); light.box(.045, 1.5, .04, x, 1.2, -.04); }
    hull.box(2.5, .18, .3, 0, 2.05, -.2); hull.box(.13, .6, .13, .45, 1.7, -.15);
    for (const x of [-1.5, 1.5]) { hull.box(.5, .5, .65, x, .25, .2); light.box(.4, .025, .02, x, .45, .54); }
  } else if (kind === "array") {
    for (const x of [-1.2, 1.2]) {
      hull.add(new THREE.CylinderGeometry(.04, .07, 1.55, 8), x, 1.65, -.2);
      hull.add(new THREE.SphereGeometry(.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-.65), x, 2.2, -.2);
      light.add(new THREE.TorusGeometry(.35, .025, 4, 24).rotateX(-.65), x, 2.15, .04);
    }
    for (let i = 0; i < 3; i++) light.box(.08, .12, .03, -.22 + i * .22, 1.5, .3);
  } else if (kind === "arcade") {
    hull.add(new THREE.TorusGeometry(1.15, .13, 6, 32, Math.PI).translate(0, 1.1, -.08));
    light.add(new THREE.TorusGeometry(1.15, .04, 4, 32, Math.PI).translate(0, 1.1, .09));
    for (const x of [-1.3, 1.3]) {
      hull.box(.3, 1.3, .42, x, .6, .6);
      light.box(.18, .65, .025, x, .85, .82);
    }
    light.add(new THREE.OctahedronGeometry(.2), 0, 1.84, .12);
  } else if (kind === "vault") {
    hull.add(new THREE.CylinderGeometry(.7, .9, .2, 6).rotateX(Math.PI / 2), 0, 1.85, -.05);
    light.add(new THREE.TorusGeometry(.5, .035, 4, 6), 0, 1.85, .12);
    light.box(.045, .65, .03, 0, 1.85, .17);
    for (const x of [-1.2, 1.2]) for (let i = 0; i < 3; i++) hull.box(.45, .18, .65, x, .3 + i * .2, .05);
  } else if (kind === "garden") {
    for (const x of [-.68, .68]) {
      hull.add(new THREE.SphereGeometry(.38, 16, 10).scale(1, .7, .6), x, 1.64, -.1);
      light.add(new THREE.SphereGeometry(.15, 12, 8), x, 1.68, .12);
    }
    for (const x of [-1.5, 1.5]) {
      hull.add(new THREE.CylinderGeometry(.42, .3, .3, 12), x, .15, .3);
      light.add(new THREE.SphereGeometry(.42, 12, 6).scale(1, .08, 1), x, .34, .3);
      hull.add(new THREE.SphereGeometry(.18, 12, 6).scale(.65, 2.3, 1), x, .68, .3);
    }
  } else {
    for (const x of [-1.15, 1.15]) {
      hull.box(.4, 1.9, .5, x, .95, -.1);
      for (let i = 0; i < 6; i++) light.box(.3, .035, .025, x, .3 + i * .27, .17);
    }
    hull.box(1.5, .6, .16, 0, 1.7, -.1);
    for (let i = 0; i < 3; i++) light.box(.8 - i * .15, .035, .02, -.1, 1.85 - i * .14, 0);
  }
}

/** Name plates use crisp local textures; sprites always face the camera. */
export function createDockLabel(name: string, color: string) {
  const canvas = document.createElement("canvas"); canvas.width = 768; canvas.height = 168;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, depthTest: false, transparent: true, toneMapped: false });
  const sprite = new THREE.Sprite(material); sprite.scale.set(2.8, .6125, 1); sprite.position.set(0, 2.65, .25); sprite.renderOrder = 10;
  const refresh = () => {
    const context = canvas.getContext("2d"); if (!context) return;
    context.clearRect(0, 0, 768, 168); context.fillStyle = "#100b1ded";
    context.beginPath(); context.roundRect(6, 6, 756, 156, 21); context.fill();
    context.strokeStyle = color; context.lineWidth = 4.5; context.stroke();
    context.font = '600 66px "Space Grotesk", system-ui, sans-serif'; context.fillStyle = "#f8f3ff"; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(name, 384, 85.5, 690); texture.needsUpdate = true;
  };
  refresh();
  return { sprite, refresh };
}
