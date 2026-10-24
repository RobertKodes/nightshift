import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { type ClassId, type Look, decodeLook, signed, unit } from "@nightshift/lastspawn";
import { load, toonRamp } from "./assets";

/** HSV bytes (0-255 each) as a colour. */
export function hsv(h: number, s: number, v: number): THREE.Color {
  const c = new THREE.Color();
  c.setHSL(0, 0, 0);
  const H = (h / 255) * 360, S = s / 255, V = v / 255;
  const f = (n: number) => { const k = (n + H / 60) % 6; return V - V * S * Math.max(0, Math.min(k, 4 - k, 1)); };
  return c.setRGB(f(5), f(3), f(1), THREE.SRGBColorSpace);
}

/**
 * The frog's skin: one shader reads the colour regions painted into the model (belly, lips, pads) and
 * draws the chosen pattern on the skin only, under the toon ramp, with a rim light.
 */
function skinMaterial() {
  const u = {
    uSkin: { value: new THREE.Color() }, uBelly: { value: new THREE.Color() }, uLips: { value: new THREE.Color() }, uPads: { value: new THREE.Color() },
    uPat: { value: 0 }, uPatScale: { value: 1 }, uPatMix: { value: 0.4 }, uPatColor: { value: new THREE.Color() },
    uRim: { value: 0.32 }, uRimColor: { value: new THREE.Color(0xa8c4ff) }, uWet: { value: 0.0 },
  };
  const mat = new THREE.MeshToonMaterial({ gradientMap: toonRamp() });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 color;\nvarying vec4 vMask;\nvarying vec3 vObj;")
      .replace("#include <morphtarget_vertex>", "#include <morphtarget_vertex>\nvObj = transformed;\nvMask = color;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform vec3 uSkin, uBelly, uLips, uPads, uPatColor, uRimColor;
uniform float uPat, uPatScale, uPatMix, uRim, uWet;
varying vec4 vMask;
varying vec3 vObj;
vec3 h3(vec3 p) { p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return fract(sin(p) * 43758.5453); }
float cells(vec3 p) {
  vec3 i = floor(p), f = fract(p); float d = 1.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z)); vec3 o = h3(i + g); d = min(d, length(g + o - f));
  }
  return d;
}
float pattern(vec3 p) {
  if (uPat < 0.5) return 0.0;
  if (uPat < 1.5) return 1.0 - smoothstep(0.28, 0.34, cells(p * 7.0 * uPatScale));
  if (uPat < 2.5) return smoothstep(0.35, 0.45, sin(p.y * 26.0 * uPatScale + sin(p.x * 9.0) * 1.4 + cells(p * 3.0) * 2.0) * 0.5 + 0.5);
  return smoothstep(0.62, 0.7, abs(sin(p.y * 9.0 * uPatScale + cells(p * 2.0) * 1.6)));
}`)
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );", `
float belly = smoothstep(0.12, 0.85, vMask.r), lip = smoothstep(0.25, 0.75, vMask.g), pad = smoothstep(0.25, 0.8, vMask.b) * (1.0 - lip);
vec3 base = mix(uSkin, uBelly, belly);
base = mix(base, uPatColor, pattern(vObj) * uPatMix * (1.0 - belly) * (1.0 - lip) * (1.0 - pad));
base = mix(base, uLips, lip);
base = mix(base, uPads, pad);
vec4 diffuseColor = vec4(base, opacity);`)
      .replace("#include <opaque_fragment>", `float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
outgoingLight += uRimColor * rimF * uRim;
// a wet sheen on top of the toon light, strongest on the back of the head
float spec = pow(saturate(dot(reflect(-normalize(vViewPosition), normal), normalize(vec3(0.3, 0.9, 0.2)))), 24.0);
outgoingLight += vec3(0.55, 0.7, 0.9) * spec * (0.12 + uWet * 0.4) * (1.0 - lip);
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => "frog-skin";
  return { mat, u };
}

const flatMat = (color: THREE.ColorRepresentation, shine = 0) => {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() });
  if (shine) m.emissive = new THREE.Color(color).multiplyScalar(shine);
  return m;
};

/** Gear colours by material name: reed, cord, bone, shell, iron, and the lantern's glow. */
const GEAR_COLORS: Record<string, number> = {
  gear_reed: 0x8a7442, gear_reed_node: 0x5a4524, gear_cord: 0x8e3022, gear_bone: 0xd9d0b4, gear_shell: 0x4a4024, gear_scute: 0x80703c, gear_iron: 0x3c3836,
};
let gearScene: THREE.Object3D | null = null;
const gearMats = new Map<string, THREE.Material>();
async function gear(): Promise<THREE.Object3D> {
  if (gearScene) return gearScene;
  gearScene = (await load("gear")).scene;
  gearScene.traverse((c) => {
    const m = c as THREE.Mesh; if (!m.isMesh) return;
    const name = (m.material as THREE.Material).name;
    let mat = gearMats.get(name);
    if (!mat) {
      // both faces: thin pieces (a blade, a cage bar) never show a hole from the far side
      mat = name === "gear_glow" ? new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8ff8a).multiplyScalar(2.2) }) : new THREE.MeshToonMaterial({ color: GEAR_COLORS[name] ?? 0x888888, gradientMap: toonRamp(), side: THREE.DoubleSide });
      gearMats.set(name, mat);
    }
    m.material = mat; m.castShadow = true;
  });
  return gearScene;
}
/** What each class carries, in which hand: the right hand's slot holds a weapon blade-up, as the rig's swords do. */
const KIT: Record<ClassId, { right?: string; left?: string }> = {
  reedguard: { right: "glaive", left: "shield" }, dartsinger: { right: "blowgun" }, lampwright: { left: "lantern" },
};

/** Clips by name, as the rig names them. */
export type Clips = Map<string, THREE.AnimationClip>;
let base: { scene: THREE.Object3D; clips: Clips } | null = null;
export async function frogBase() {
  if (base) return base;
  const g = await load("frog");
  base = { scene: g.scene, clips: new Map(g.animations.map((a) => [a.name, a])) };
  return base;
}

type Action = { clip: string; loop?: boolean; speed?: number; fade?: number; then?: string };

/**
 * One frog in the world: its own copy of the model and skeleton, its look, and an animation state that
 * crossfades between moves and plays one-shots (attacks, casts, hits) over them.
 */
export class Frog {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  #clips: Clips;
  #skin: ReturnType<typeof skinMaterial>;
  #iris: THREE.MeshToonMaterial;
  #morphs: { mesh: THREE.Mesh; dict: Record<string, number> }[] = [];
  #eyes: { o: THREE.Object3D; center: THREE.Vector3; pos: THREE.Vector3; scale: THREE.Vector3 }[] = [];
  #bones = new Map<string, THREE.Bone>();
  #current: THREE.AnimationAction | null = null;
  #currentName = "";
  #oneShot: THREE.AnimationAction | null = null;
  #oneShotEnd = 0;
  look: Look;

  constructor(b: { scene: THREE.Object3D; clips: Clips }, look: string | Look) {
    this.#clips = b.clips;
    this.model = cloneSkinned(b.scene);
    this.#skin = skinMaterial();
    this.#iris = flatMat(0xb07a20, 0.08);
    const eyeWhite = flatMat(0xe9e4d4, 0.04), pupil = flatMat(0x050505);
    this.model.traverse((c) => {
      const m = c as THREE.Mesh;
      if ((c as THREE.Bone).isBone) this.#bones.set(c.name, c as THREE.Bone);
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      m.material = name === "frog_skin" ? this.#skin.mat : name === "frog_iris" ? this.#iris : name === "frog_pupil" ? pupil : eyeWhite;
      m.castShadow = true; m.receiveShadow = true;
      m.frustumCulled = false;
      if (m.morphTargetDictionary) this.#morphs.push({ mesh: m, dict: m.morphTargetDictionary });
    });
    // the eye pieces scale together around each eye's centre
    const eyeObj = (side: string) => this.model.getObjectByName(`Frog_Eye_${side}`);
    for (const side of ["L", "R"]) {
      const centre = eyeObj(side)?.position.clone() ?? new THREE.Vector3();
      for (const part of ["Eye", "Iris", "Pupil", "Lid"]) {
        const o = this.model.getObjectByName(`Frog_${part}_${side}`);
        if (o) this.#eyes.push({ o, center: centre, pos: o.position.clone(), scale: o.scale.clone() });
      }
    }
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.look = typeof look === "string" ? decodeLook(look) : look;
    this.applyLook(this.look);
    this.play({ clip: "Idle", loop: true });
  }

  static async create(look: string | Look) { return new Frog(await frogBase(), look); }

  /** Shape, face, size and colours from the creator's sliders. */
  applyLook(l: Look) {
    this.look = l;
    const set = (name: string, v: number) => {
      for (const { mesh, dict } of this.#morphs) { const i = dict[name]; if (i !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[i] = v; }
    };
    set("HeadWide", unit(l.headWide)); set("HeadFlat", unit(l.headFlat)); set("Snout", unit(l.snout)); set("Cheeks", unit(l.cheeks));
    set("Belly", unit(l.belly)); set("Slim", unit(l.slim)); set("Throat", unit(l.throat));
    set("LipsFull", unit(l.lipsFull)); set("Smug", unit(l.smug)); set("Frown", unit(l.frown));
    set("LidDroop", unit(l.lidDroop)); set("LidAngry", unit(l.lidAngry));
    const u = this.#skin.u;
    u.uSkin.value.copy(hsv(l.skinH, l.skinS, l.skinV)); u.uBelly.value.copy(hsv(l.bellyH, l.bellyS, l.bellyV));
    u.uLips.value.copy(hsv(l.lipH, l.lipS, l.lipV)); u.uPads.value.copy(hsv(l.padH, l.padS, l.padV));
    u.uPat.value = l.pattern; u.uPatScale.value = 0.6 + unit(l.patScale) * 0.9; u.uPatMix.value = unit(l.patMix); u.uPatColor.value.copy(hsv(l.patH, 200, 60 + (l.pattern === 3 ? 0 : 60)));
    this.#iris.color.copy(hsv(l.irisH, 200, 190));
    const height = 1 + signed(l.height) * 0.08, build = 1 + signed(l.build) * 0.12, eye = 1 + signed(l.eyeSize) * 0.18;
    this.model.scale.setScalar(height);
    for (const b of ["spine", "chest", "hips"]) this.#bones.get(b)?.scale.set(build, 1, build);
    for (const e of this.#eyes) {
      e.o.position.copy(e.center).addScaledVector(e.pos.clone().sub(e.center), eye);
      e.o.scale.copy(e.scale).multiplyScalar(eye);
    }
  }

  setWet(v: number) { this.#skin.u.uWet.value = v; }

  #gear: THREE.Object3D[] = [];
  /** Put the class's gear in the frog's hands (a lantern brings its own small light). */
  async equip(cls: ClassId | null, light = false) {
    for (const g of this.#gear) g.removeFromParent();
    this.#gear = [];
    if (!cls) return;
    const src = await gear(), kit = KIT[cls];
    const put = (piece: string | undefined, slot: string, at: THREE.Vector3, ry: number) => {
      // the loader strips dots from node names: "handslot.r" arrives as "handslotr"
      const bone = this.#bones.get(THREE.PropertyBinding.sanitizeNodeName(slot)), from = src.getObjectByName(piece ?? "");
      if (!piece || !bone || !from) return;
      const o = from.clone(true); o.position.copy(at); o.rotation.set(0, ry, 0);
      if (piece === "lantern" && light) { const l = new THREE.PointLight(0xc8ff8a, 3.2, 6, 2); l.position.set(0, -0.3, 0); o.add(l); }
      bone.add(o); this.#gear.push(o);
    };
    put(kit.right, "handslot.r", new THREE.Vector3(0, 0.033, 0), Math.PI);
    put(kit.left, "handslot.l", kit.left === "shield" ? new THREE.Vector3(0, 0.017, 0.156) : new THREE.Vector3(0, 0.02, 0), 0);
  }

  /** Loop a move (idle, walk, run...), crossfading from the last one. */
  play(a: Action) {
    if (a.clip === this.#currentName && this.#current) { this.#current.timeScale = a.speed ?? 1; return; }
    const clip = this.#clips.get(a.clip);
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    next.reset(); next.enabled = true; next.setLoop(a.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = a.loop === false; next.timeScale = a.speed ?? 1;
    next.play();
    if (this.#current) this.#current.crossFadeTo(next, a.fade ?? 0.22, false);
    this.#current = next; this.#currentName = a.clip;
  }

  /** Play a move once over the current one (a thrust, a cast), then return to it. */
  once(clip: string, speed = 1) {
    const c = this.#clips.get(clip);
    if (!c) return;
    const act = this.mixer.clipAction(c);
    if (this.#oneShot && this.#oneShot !== act) this.#oneShot.fadeOut(0.1);
    act.reset(); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = false; act.timeScale = speed;
    act.setEffectiveWeight(1); act.fadeIn(0.08); act.play();
    this.#oneShot = act; this.#oneShotEnd = performance.now() + (c.duration / speed) * 1000 - 120;
  }

  get busy() { return performance.now() < this.#oneShotEnd; }

  update(dt: number) {
    if (this.#oneShot && performance.now() >= this.#oneShotEnd) { this.#oneShot.fadeOut(0.15); this.#oneShot = null; }
    this.mixer.update(dt);
  }

  dispose() { this.mixer.stopAllAction(); this.root.removeFromParent(); }
}
