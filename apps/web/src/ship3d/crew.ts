import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { load } from "../lastspawn/assets";
import { toon } from "./toon";

/** Natural frog greens; each crew member keeps one by its record. */
export const SKINS = ["#3d6b30", "#427234", "#376334", "#3d6b3d", "#476e30", "#335e33", "#4b7439", "#3f6631"];
/** Department vests: mission navy, company graphite, games plum, watch teal. */
/** Hoodies per room: deep violets, each room a shade of its own. */
export const VESTS = ["#2e2356", "#262a52", "#3a2350", "#1f2e4c", "#3a2a45", "#1f3346", "#40262f", "#2a3a2c"];
const UPPER = /^(spine|chest|head|upperarm|lowerarm|wrist|hand|elbowik)/i;

/** A clip's tracks frozen at their first key, so a seated body holds still while the arms move. */
function held(track: THREE.KeyframeTrack) {
  const size = track.getValueSize(), Type = track.constructor as new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack;
  return new Type(track.name, [0], Array.from(track.values.slice(0, size)));
}

function skinMaterial(color: THREE.ColorRepresentation) {
  // cel-shaded like the NIGHT FROGS art; the region mask still darkens the back and lightens the belly
  const skin = toon({ color });
  skin.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 color; varying vec3 vRegions;")
      .replace("#include <color_vertex>", "#include <color_vertex>\nvRegions = color.rgb;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vRegions;")
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );", `vec3 region = mix(diffuse, vec3(.72, .66, .44), smoothstep(.12, .85, vRegions.r));
        region = mix(region, diffuse * .42, smoothstep(.25, .75, vRegions.g));
        region = mix(region, diffuse * .55 + vec3(.02, .02, 0.), smoothstep(.25, .8, vRegions.b) * (1.0 - vRegions.g));
        vec4 diffuseColor = vec4(region, opacity);`);
  };
  skin.customProgramCacheKey = () => "deck-frog-skin-toon-v1";
  return skin;
}

/** A frog the deck can animate. A proxy has no mesh: it carries the brain's pose and wanted clip, and is drawn as an instanced low-poly frog or lent a skinned one up close. */
export type DeckActor = { root: THREE.Object3D; hips: THREE.Object3D; mixer: THREE.AnimationMixer | null; action: THREE.AnimationAction | null; clip: string; skin: number; proxy?: boolean; speed?: number; department?: number };
/** The LASTSPAWN frog and its clips in restrained realistic materials, in its department's crew vest, plus seated work clips. */
export async function createDeckCrew() {
  const base = await load("frog");
  const clips = [...base.animations], named = (name: string) => clips.find((clip) => clip.name === name);
  const seated = (name: string, arms: string) => {
    const legs = named("Sit_Chair_Idle"), upper = named(arms); if (!legs || !upper) return;
    clips.push(new THREE.AnimationClip(name, upper.duration, [...legs.tracks.filter((t) => !UPPER.test(t.name)).map(held), ...upper.tracks.filter((t) => UPPER.test(t.name))]));
  };
  seated("Seat_Work", "Interact"); seated("Seat_Type", "Use_Item"); seated("Seat_Cheer", "Cheer");
  const skins = SKINS.map((color) => ({ masked: skinMaterial(color), plain: toon({ color }) }));
  const eyes = {
    frog_eye: toon({ color: "#e6dcbf" }),
    frog_iris: toon({ color: "#c08f40" }),
    frog_pupil: toon({ color: "#020304" }),
  };
  const vests = VESTS.map((color) => toon({ color, side: THREE.DoubleSide }));
  const actors: DeckActor[] = [];

  function dress(actor: DeckActor, skin: number) {
    actor.skin = skin = ((skin % SKINS.length) + SKINS.length) % SKINS.length;
    if (actor.proxy) return;
    actor.root.traverse((object) => {
      const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
      const name = mesh.userData.material as string;
      if (name.startsWith("armor")) return;
      mesh.material = name === "frog_skin" ? mesh.geometry.getAttribute("color") ? skins[skin]!.masked : skins[skin]!.plain : eyes[name as keyof typeof eyes] ?? eyes.frog_eye;
    });
  }
  return {
    create(skin: number, department: number): DeckActor {
      const root = cloneSkinned(base.scene);
      root.traverse((object) => {
        if (object.name.startsWith("Gear_")) object.visible = object.name.startsWith("Gear_shell_vest");
        const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
        mesh.userData.material = (mesh.material as THREE.Material).name; mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false;
        if (object.name.startsWith("Gear_shell_vest")) mesh.material = vests[department % vests.length]!;
      });
      const hips = root.getObjectByName("hips") ?? root;
      const actor: DeckActor = { root, hips, mixer: new THREE.AnimationMixer(root), action: null, clip: "", skin, department };
      dress(actor, skin); actors.push(actor);
      return actor;
    },
    dress,
    /** Puts a frog in a room's hoodie. */
    wear(actor: DeckActor, department: number) {
      if (actor.proxy || actor.department === department) return;
      actor.department = department;
      actor.root.traverse((object) => { if (object.name.startsWith("Gear_shell_vest") && (object as THREE.Mesh).isMesh) (object as THREE.Mesh).material = vests[department % vests.length]!; });
    },
    /** A mesh-less stand-in for one crew slot, posed by its brain. */
    proxy(skin: number, department: number): DeckActor {
      const root = new THREE.Object3D(), hips = new THREE.Object3D(); hips.position.y = .95; root.add(hips);
      return { root, hips, mixer: null, action: null, clip: "Idle", skin, proxy: true, speed: 1, department };
    },
    /** Cross-fades to a clip; a fade of 0 cuts. */
    play(actor: DeckActor, name: string, fade = .3, speed = 1) {
      if (actor.proxy) { actor.clip = name; actor.speed = speed; return; }
      if (actor.clip === name) { actor.action?.setEffectiveTimeScale(speed); return; }
      if (!actor.mixer) return;
      const clip = named(name) ?? named("Idle"); if (!clip) return;
      const next = actor.mixer.clipAction(clip);
      next.reset(); next.setEffectiveTimeScale(speed); next.setEffectiveWeight(1); next.time = Math.random() * clip.duration; next.play();
      if (actor.action && actor.action !== next) { if (fade > 0) next.crossFadeFrom(actor.action, fade, false); else actor.action.stop(); }
      actor.action = next; actor.clip = name;
    },
    dispose() {
      const skeletons = new Set<THREE.Skeleton>();
      for (const actor of actors) {
        actor.mixer?.stopAllAction(); actor.mixer?.uncacheRoot(actor.root);
        actor.root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((o as THREE.SkinnedMesh).skeleton); });
        actor.root.removeFromParent();
      }
      skeletons.forEach((skeleton) => skeleton.dispose());
      for (const s of skins) { s.masked.dispose(); s.plain.dispose(); }
      Object.values(eyes).forEach((material) => material.dispose()); vests.forEach((material) => material.dispose());
      // the source glTF geometry belongs to the shared asset cache and stays there
    },
  };
}
export type DeckCrew = Awaited<ReturnType<typeof createDeckCrew>>;
