import * as THREE from "three";
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from "postprocessing";

export type Quality = "high" | "medium" | "low";

/** A first guess at what the device can draw smoothly; the player can change it in settings. */
export function pickQuality(): Quality {
  try {
    const saved = localStorage.getItem("ls-quality");
    if (saved === "high" || saved === "medium" || saved === "low") return saved;
  } catch { /* no storage */ }
  const coarse = matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  // most phones of the last few years draw the medium look smoothly: shadows, sharp edges
  if (coarse) return cores >= 6 ? "medium" : "low";
  return cores >= 6 ? "high" : "medium";
}

/** The renderer, the camera and the finishing passes: bloom on what glows, a vignette, filmic tone. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly quality: Quality;
  #bloom: BloomEffect;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: true, powerPreference: "high-performance" });
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(quality === "high" ? Math.min(dpr, 2) : quality === "medium" ? Math.min(dpr, 1.5) : Math.min(dpr, 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = quality !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400);
    this.scene.background = new THREE.Color(0x05070d);
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.#bloom = new BloomEffect({ intensity: quality === "low" ? 0.9 : 1.35, luminanceThreshold: 0.62, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 });
    const effects = [this.#bloom, new VignetteEffect({ darkness: 0.62, offset: 0.28 }), new ToneMappingEffect({ mode: ToneMappingMode.AGX })];
    if (quality !== "low") effects.push(new SMAAEffect() as never);
    this.composer.addPass(new EffectPass(this.camera, ...effects));
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / Math.max(1, h);
    // held upright a phone sees a narrow strip: a wider lens keeps the frog and its surroundings in view
    this.camera.fov = this.camera.aspect < 0.8 ? 66 : 52;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
  }

  render(dt: number) { this.composer.render(dt); }

  dispose() {
    this.composer.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); for (const x of ([] as THREE.Material[]).concat(m.material)) x.dispose(); }
    });
  }
}
