import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { load } from "../lastspawn/assets";

/** Natural frog greens; each crew member keeps one by its record. */
const SKINS = ["#4f8a3a", "#5a9441", "#3f7a45", "#4a8752", "#618f3c", "#3d7040", "#6a9a48", "#517d3a"];
/** Department vests: mission navy, company graphite, games plum, watch teal. */
const VESTS = ["#1f2a3d", "#272b31", "#2c2539", "#1c2d30"];
const UPPER = /^(spine|chest|head|upperarm|lowerarm|wrist|hand|elbowik)/i;

/** A clip's tracks frozen at their first key, so a seated body holds still while the arms move. */
function held(track: THREE.KeyframeTrack) {
  const size = track.getValueSize(), Type = track.constructor as new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack;
  return new Type(track.name, [0], Array.from(track.values.slice(0, size)));
}

function skinMaterial(color: THREE.ColorRepresentation) {
  const skin = new THREE.MeshPhysicalMaterial({ color, roughness: .46, metalness: 0, clearcoat: .45, clearcoatRoughness: .32 });
  skin.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 color; varying vec3 vRegions;")
      .replace("#include <color_vertex>", "#include <color_vertex>\nvRegions = color.rgb;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vRegions;")
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );", `vec3 region = mix(diffuse, vec3(.72, .66, .44), smoothstep(.12, .85, vRegions.r));
        region = mix(region, diffuse * .42, smoothstep(.25, .75, vRegions.g));
        region = mix(region, diffuse * .55 + vec3(.02, .02, 0.), smoothstep(.25, .8, vRegions.b) * (1.0 - vRegions.g));
        vec4 diffuseColor = vec4(region, opacity);`);
  };
  skin.customProgramCacheKey = () => "deck-frog-skin-v2";
  return skin;
}

export type DeckActor = { root: THREE.Object3D; hips: THREE.Object3D; mixer: THREE.AnimationMixer; action: THREE.AnimationAction | null; clip: string; skin: number };
/** The LASTSPAWN frog and its clips in restrained realistic materials, in its department's crew vest, plus seated work clips. */
export async function createDeckCrew() {
  const base = await load("frog");
  const clips = [...base.animations], named = (name: string) => clips.find((clip) => clip.name === name);
  const seated = (name: string, arms: string) => {
    const legs = named("Sit_Chair_Idle"), upper = named(arms); if (!legs || !upper) return;
    clips.push(new THREE.AnimationClip(name, upper.duration, [...legs.tracks.filter((t) => !UPPER.test(t.name)).map(held), ...upper.tracks.filter((t) => UPPER.test(t.name))]));
  };
  seated("Seat_Work", "Interact"); seated("Seat_Type", "Use_Item"); seated("Seat_Cheer", "Cheer");
  const skins = SKINS.map((color) => ({ masked: skinMaterial(color), plain: new THREE.MeshPhysicalMaterial({ color, roughness: .46, clearcoat: .45, clearcoatRoughness: .32 }) }));
  const eyes = {
    frog_eye: new THREE.MeshPhysicalMaterial({ color: "#efe6c8", roughness: .12, clearcoat: 1, clearcoatRoughness: .05 }),
    frog_iris: new THREE.MeshPhysicalMaterial({ color: "#b8863a", roughness: .2, clearcoat: 1, clearcoatRoughness: .05 }),
    frog_pupil: new THREE.MeshPhysicalMaterial({ color: "#020304", roughness: .1, clearcoat: 1, clearcoatRoughness: .02 }),
  };
  const vests = VESTS.map((color) => new THREE.MeshStandardMaterial({ color, roughness: .62, metalness: .25, side: THREE.DoubleSide }));
  const actors: DeckActor[] = [];

  function dress(actor: DeckActor, skin: number) {
    actor.skin = skin = ((skin % SKINS.length) + SKINS.length) % SKINS.length;
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
      const actor: DeckActor = { root, hips, mixer: new THREE.AnimationMixer(root), action: null, clip: "", skin };
      dress(actor, skin); actors.push(actor);
      return actor;
    },
    dress,
    /** Cross-fades to a clip; a fade of 0 cuts. */
    play(actor: DeckActor, name: string, fade = .3, speed = 1) {
      if (actor.clip === name) { actor.action?.setEffectiveTimeScale(speed); return; }
      const clip = named(name) ?? named("Idle"); if (!clip) return;
      const next = actor.mixer.clipAction(clip);
      next.reset(); next.setEffectiveTimeScale(speed); next.setEffectiveWeight(1); next.time = Math.random() * clip.duration; next.play();
      if (actor.action && actor.action !== next) { if (fade > 0) next.crossFadeFrom(actor.action, fade, false); else actor.action.stop(); }
      actor.action = next; actor.clip = name;
    },
    dispose() {
      const skeletons = new Set<THREE.Skeleton>();
      for (const actor of actors) {
        actor.mixer.stopAllAction(); actor.mixer.uncacheRoot(actor.root);
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
