import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Color, PieceSymbol } from "chess.js";
import { FrogPieces, type Frog } from "./FrogPieces";

export type PieceVisual = { group: THREE.Group; phase: number; fallback?: Frog; baseRing?: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>; contactShadow?: THREE.Mesh; side?: Color };
export type PieceState = "loading" | "ready" | "fallback";
const ROLES: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
type Models = Record<PieceSymbol, THREE.BufferGeometry>;
let models: Promise<Models> | undefined;

/** Poly Haven's CC0 Chess Set by Riley Queen. Cache the six geometries across tables.
 * The bishop has two glTF primitives: merge both so its inset faces stay intact. */
function loadModels(): Promise<Models> {
  return models ??= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}chess/pieces.glb`).then(gltf => {
    const result = {} as Models;
    const originals = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(node => {
      if (node instanceof THREE.Mesh) {
        originals.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
      }
    });
    try {
      for (const [symbol, name] of Object.entries(ROLES)) {
        const node = gltf.scene.getObjectByName(name);
        if (!node) throw new Error(`Missing chess model: ${name}`);
        const parts: THREE.BufferGeometry[] = [];
        node.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          const geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
          // Keep the artist's smooth normals, including intentional hard edges.
          if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
          parts.push(geometry);
        });
        const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
        if (parts.length > 1) parts.forEach(part => part.dispose());
        if (!geometry) throw new Error(`Invalid chess geometry: ${name}`);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
        result[symbol as PieceSymbol] = geometry;
      }
      result.k.computeBoundingBox();
      const scale = .95 / result.k.boundingBox!.max.y;
      for (const geometry of Object.values(result)) {
        geometry.scale(scale, scale, scale);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
      }
      return result;
    } catch (error) {
      Object.values(result).forEach(geometry => geometry.dispose());
      throw error;
    } finally {
      originals.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
    }
  });
}

export class Pieces {
  private models?: Models;
  private fallback?: FrogPieces;
  private disposed = false;
  private ringGeometry = new THREE.TorusGeometry(1, .035, 8, 64);
  private footGeometry = new THREE.CylinderGeometry(1, 1, .014, 48);
  private shadowGeometry = new THREE.PlaneGeometry(.9, .9);
  private goldGeometry = new THREE.TorusGeometry(1, .022, 8, 64);
  private gold = new THREE.MeshStandardMaterial({ color: 0xffc46b, metalness: .65, roughness: .25, emissive: 0xffc46b, emissiveIntensity: .55 });
  private foot = new THREE.MeshStandardMaterial({ color: 0x0d0a1f, metalness: .6, roughness: .28 });
  private rings: Record<Color, THREE.MeshStandardMaterial[]> = { w: [], b: [] };
  private contact: THREE.MeshBasicMaterial;
  private pearl = new THREE.MeshPhysicalMaterial({
    name: "Moonlight pearl", color: "#ece6ff", roughness: .28,
    clearcoat: 1, clearcoatRoughness: .15, sheen: .35, sheenColor: "#c5b4ef", sheenRoughness: .6,
    emissive: "#2a1f55", emissiveIntensity: .18,
  });
  private obsidian = new THREE.MeshPhysicalMaterial({
    name: "Ultraviolet obsidian", color: "#1a1238", roughness: .2,
    clearcoat: 1, clearcoatRoughness: .15,
  });

  constructor() {
    for (const side of ["w", "b"] as const) {
      const color = side === "w" ? 0xe9e2ff : 0x7c5cff;
      this.rings[side] = [.35, .85, 1.8].map(emissiveIntensity => new THREE.MeshStandardMaterial({
        color: 0x03020a, emissive: color, emissiveIntensity, roughness: .3, metalness: .15, toneMapped: false,
      }));
    }
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!, gradient = ctx.createRadialGradient(64, 64, 18, 64, 64, 64);
    gradient.addColorStop(0, "#000000a0"); gradient.addColorStop(.5, "#00000050"); gradient.addColorStop(1, "#00000000");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    this.contact = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, opacity: .55, depthWrite: false });
    // View-space Fresnel adds a quiet violet edge without overlapping shells.
    this.obsidian.onBeforeCompile = shader => {
      shader.uniforms.nightRim = { value: new THREE.Color("#7c5cff") };
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 nightRim;")
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          float nightFresnel = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
          totalEmissiveRadiance += nightRim * nightFresnel * 0.18;`);
    };
    this.obsidian.customProgramCacheKey = () => "night-obsidian-fresnel-v1";
  }

  async load(): Promise<Exclude<PieceState, "loading">> {
    try {
      this.models = await loadModels();
      return "ready";
    } catch {
      // Bundle the fallback so it also works if the model request fails offline.
      // Its procedural geometry is built only on this error path.
      if (!this.disposed) this.fallback = new FrogPieces();
      return "fallback";
    }
  }

  make(type: PieceSymbol, color: Color): PieceVisual | null {
    if (this.disposed) return null;
    if (this.fallback) {
      const frog = this.fallback.make(type, color);
      return this.brand({ group: frog.group, phase: frog.phase, fallback: frog }, type, color, .32);
    }
    if (!this.models) return null;
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(this.models[type], color === "w" ? this.pearl : this.obsidian);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = `${color}-${ROLES[type]}`;
    group.add(mesh);
    // The model's muzzle points toward +Z; each knight faces the opposing rank.
    if (type === "n") group.rotation.y = color === "w" ? Math.PI : 0;
    const box = this.models[type].boundingBox!;
    const radius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + .035;
    return this.brand({ group, phase: Math.random() * Math.PI * 2 }, type, color, radius);
  }

  private brand(visual: PieceVisual, type: PieceSymbol, color: Color, radius: number): PieceVisual {
    // Add a separate plinth; the approved model geometry and pearl/obsidian materials stay intact.
    const foot = new THREE.Mesh(this.footGeometry, this.foot); foot.scale.set(radius, 1, radius); foot.position.y = .004;
    const ring = new THREE.Mesh(this.ringGeometry, this.rings[color][0]!);
    ring.rotation.x = -Math.PI / 2; ring.scale.setScalar(radius); ring.position.y = .012;
    const contact = new THREE.Mesh(this.shadowGeometry, this.contact); contact.rotation.x = -Math.PI / 2; contact.position.y = -.003;
    visual.group.add(foot, ring, contact);
    if (type === "k") {
      const crown = new THREE.Mesh(this.goldGeometry, this.gold); crown.rotation.x = -Math.PI / 2;
      crown.scale.setScalar(radius * 1.09); crown.position.y = .035; visual.group.add(crown);
    }
    return { ...visual, baseRing: ring, contactShadow: contact, side: color };
  }

  highlight(piece: PieceVisual, selectable: boolean, selected: boolean) {
    if (piece.baseRing && piece.side) piece.baseRing.material = this.rings[piece.side][selected ? 2 : selectable ? 1 : 0]!;
  }

  idle(piece: PieceVisual, now: number, reduced: boolean) {
    if (piece.fallback) this.fallback?.idle(piece.fallback, now, reduced);
  }

  dispose() {
    this.disposed = true;
    this.fallback?.dispose();
    this.pearl.dispose();
    this.obsidian.dispose();
    this.ringGeometry.dispose(); this.footGeometry.dispose(); this.shadowGeometry.dispose(); this.goldGeometry.dispose();
    this.gold.dispose(); this.foot.dispose(); this.contact.map?.dispose(); this.contact.dispose();
    for (const materials of Object.values(this.rings)) materials.forEach(material => material.dispose());
    // The module owns the cached geometry; another table may still be using it.
  }
}
