import * as THREE from "three";
import {
  ABILITIES, BASE_LOOK, CISTERN, CLASSES, type CharSummary, type ClassId, type CombatEvent, type EntitySnap, GCD_MS, ITEMS, type Look,
  type Equip, type ItemStack, QUESTS, type QuestState, SLOTS, SPEED, type ServerMsg, type Slot, ZONES, decodeLook, encodeLook, floorAt, inBounds,
} from "@nightshift/lastspawn";
import { type Place, buildCistern } from "./cistern";
import { Controls } from "./controls";
import { Frog, frogBase, modelsOf } from "./frog";
import { Leech } from "./leech";
import { Net, type NetStatus } from "./net";
import { type Quality, Stage } from "./stage";

export type Phase = "loading" | "title" | "create" | "play";
export interface Hud {
  phase: Phase;
  net: NetStatus;
  chars: CharSummary[];
  error: string | null;
  name: string; cls: ClassId; level: number; hp: number; hpMax: number; xp: number; xpNext: number; armor: number; power: number;
  bag: ItemStack[]; equip: Equip;
  target: { id: string; name: string; hp: number; hpMax: number; level: number; kind: string } | null;
  prompt: string | null;
  dialog: { npc: string; name: string; text: string; options: { id: string; text: string }[] } | null;
  caption: { who: string; text: string } | null;
  quests: { id: string; name: string; steps: { text: string; have: number; need: number }[]; ready: boolean; turnIn: string }[];
  cooldowns: Record<string, number>;
  gcdUntil: number;
  casting: { ability: string; until: number; ms: number } | null;
  floats: { id: number; text: string; kind: "dmg" | "hurt" | "heal" | "miss" | "xp" | "loot"; x: number; y: number }[];
  chat: { id: number; name: string; text: string; ch: string }[];
  dead: boolean;
}

/** Keeper Wend: a hundred and nine, grey-green and spotted with age, lids heavy, mouth turned down. */
const NPC_LOOKS: Record<string, Look> = {
  keeper_wend: { ...BASE_LOOK, skinH: 60, skinS: 70, skinV: 95, bellyH: 38, bellyS: 50, bellyV: 160, lipH: 8, lipS: 80, lipV: 80, padH: 50, padS: 60, padV: 70,
    lidDroop: 190, frown: 120, smug: 0, throat: 150, belly: 120, headFlat: 60, cheeks: 90, pattern: 1, patScale: 60, patMix: 150, patH: 30, irisH: 20, height: 100, eyeSize: 110 },
  brother_cress: { ...BASE_LOOK, skinH: 80, skinS: 60, skinV: 110, bellyH: 40, bellyS: 30, bellyV: 190, lidDroop: 150, frown: 40, smug: 20, belly: 140, height: 120 },
};
const NPC_POSE: Record<string, string> = { keeper_wend: "Sit_Chair_Idle" };
/** How a player's state on the wire plays on its frog. */
const ANIM_CLIP: Record<string, string> = { idle: "Idle", walk: "Walking_A", run: "Running_A", swim: "Walking_A", jump: "Jump_Full_Short", cast: "Spellcasting", sit: "Sit_Floor_Idle", dead: "Death_A_Pose", interact: "Interact" };

type Sample = { t: number; x: number; y: number; z: number; ry: number };
interface Ent {
  id: string; snap: EntitySnap; samples: Sample[];
  root: THREE.Object3D; frog?: Frog; leech?: Leech;
  label: HTMLDivElement | null;
  lastAnim?: string;
}

const decode = (code: string | undefined): Look => (code ? decodeLook(code) : { ...BASE_LOOK });
const statsHud = (s: { hp: number; hpMax: number; level: number; xp: number; xpNext: number; armor?: number; power?: number }) => ({ hp: s.hp, hpMax: s.hpMax, level: s.level, xp: s.xp, xpNext: s.xpNext, armor: s.armor ?? 0, power: s.power ?? 0 });
/** The worn items' models, in slot order. */
const wornModels = (e: Equip) => modelsOf(SLOTS.map((s) => e[s]).filter((i): i is string => Boolean(i)));
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The game on this screen. The world server decides; this draws it: your frog (moved here at once,
 * checked by the server), everyone and everything else a little behind real time so it moves smoothly,
 * and the HUD from what the server says happened.
 */
export class Game {
  readonly stage: Stage;
  readonly controls: Controls;
  hud: Hud;
  #listeners = new Set<(h: Hud) => void>();
  #place: Place | null = null;
  #net: Net;
  #me: Frog | null = null;
  #you: string | null = null;
  #ents = new Map<string, Ent>();
  #labels: HTMLDivElement | null = null;
  #pos = new THREE.Vector3(0, CISTERN.water - 1, 0.5);
  #ry = 0;
  #placed = false;
  #seq = 0;
  #sent = { x: 0, y: 0, z: 0, ry: 0, anim: "", at: 0 };
  #anim = "idle";
  #leap: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null = null;
  #camTarget = new THREE.Vector3();
  #clock = new THREE.Clock();
  #t = 0;
  #raf = 0;
  #orbit = 0;
  #look: Look = { ...BASE_LOOK };
  #cls: ClassId = "reedguard";
  #wet = 0;
  #floatId = 0;
  #chatId = 0;
  #ray = new THREE.Raycaster();
  /** a soft light that travels with the camera, so a frog's colours read in the dark (as games do) */
  #fill = new THREE.PointLight(0xffe6c8, 9, 14, 1.6);
  #captionTimer = 0;
  /** auto-attack: after you hit something, the class's first move repeats on it while you stand and it lives */
  #fighting: string | null = null;
  #ring: THREE.Mesh;
  /** development only: walk the frog to a point by itself (the screenshot tests use it) */
  #auto: THREE.Vector2 | null = null;

  private constructor(canvas: HTMLCanvasElement, q: Quality) {
    this.stage = new Stage(canvas, q);
    this.controls = new Controls(canvas);
    this.hud = {
      phase: "loading", net: "connecting", chars: [], error: null, name: "", cls: "reedguard", level: 1, hp: 1, hpMax: 1, xp: 0, xpNext: 100, armor: 0, power: 0, bag: [], equip: {},
      target: null, prompt: null, dialog: null, caption: null, quests: [], cooldowns: {}, gcdUntil: 0, casting: null, floats: [], chat: [], dead: false,
    };
    this.controls.onLeap = () => this.#doLeap();
    this.controls.onInteract = () => this.interact();
    this.controls.onAbility = (i) => { const d = this.hud.dialog; if (d) { const o = d.options[i]; if (o) this.choose(o.id); } else this.useSlot(i); };
    this.controls.onCycle = () => this.#cycleTarget();
    this.controls.onPick = (ndc) => this.#pick(ndc);
    // the ring under what you have targeted
    this.#ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.12, 48), new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.#ring.rotation.x = -Math.PI / 2; this.#ring.visible = false; this.#ring.renderOrder = 3;
    this.stage.scene.add(this.#ring);
    this.#net = new Net((s) => this.#set({ net: s, chars: this.#net?.chars ?? this.hud.chars }));
    this.#net.on((m) => this.#onMsg(m));
  }

  static async start(canvas: HTMLCanvasElement, q: Quality, labels: HTMLDivElement): Promise<Game> {
    const g = new Game(canvas, q);
    g.#labels = labels;
    const [place] = await Promise.all([buildCistern(q, g.stage.scene), frogBase()]);
    g.#place = place;
    g.stage.scene.add(g.#fill);
    g.#me = await Frog.create(g.#look);
    g.#me.root.visible = false;
    g.stage.scene.add(g.#me.root);
    g.#set({ phase: "title" });
    g.#loop();
    return g;
  }

  subscribe(f: (h: Hud) => void) { this.#listeners.add(f); f(this.hud); return () => this.#listeners.delete(f); }
  #set(p: Partial<Hud>) { this.hud = { ...this.hud, ...p }; for (const f of this.#listeners) f(this.hud); }
  resize(w: number, h: number) { this.stage.resize(w, h); }

  // ---------- the creator ----------
  openCreator(look: Look) {
    const me = this.#me!;
    this.#look = look; me.applyLook(look); me.root.visible = true;
    this.#pos.set(0, 0.03, -(CISTERN.pool + 0.8)); this.#ry = 0;
    me.play({ clip: this.#cls === "reedguard" ? "2H_Melee_Idle" : "Idle", loop: true });
    void me.equip(this.#cls);
    this.controls.enabled = false;
    this.#set({ phase: "create", error: null });
  }
  setLook(look: Look) { this.#look = look; this.#me?.applyLook(look); }
  previewClass(cls: ClassId) {
    this.#cls = cls; void this.#me?.equip(cls);
    // the glaive is held ready in both hands; the others stand easy
    this.#me?.play({ clip: cls === "reedguard" ? "2H_Melee_Idle" : "Idle", loop: true });
  }
  get lookCode() { return encodeLook(this.#look); }

  /** Make the frog on the server: it answers with the world. */
  begin(name: string, cls: ClassId) {
    if (this.hud.net !== "online") { this.#set({ error: "The world is not answering yet. Wait a moment and try again." }); return; }
    this.#cls = cls;
    this.#net.send({ t: "create", name, look: encodeLook(this.#look), cls });
  }
  /** Play a frog made before. */
  resume(charId: string) { this.#net.send({ t: "play", charId }); }

  // ---------- what the server says ----------
  #onMsg(m: ServerMsg) {
    switch (m.t) {
      case "welcome": this.#set({ chars: m.chars }); break;
      case "error":
        this.#set({ error: m.msg });
        // a move pressed a moment early is not news; anything else is said where you look
        if (this.hud.phase === "play" && !/not ready|cooldown/i.test(m.msg)) this.#float(m.msg, "miss");
        break;
      case "enter": {
        this.#you = m.you; this.#placed = false;
        this.#cls = m.char.cls; this.#look = decode(m.char.look);
        this.#me!.applyLook(this.#look); void this.#me!.wear(wornModels(m.equip ?? {}), true);
        for (const id of [...this.#ents.keys()]) this.#drop(id);
        this.controls.enabled = true;
        const first = this.hud.phase !== "play";
        this.#set({ phase: "play", name: m.char.name, cls: m.char.cls, ...statsHud(m.stats), quests: this.#questHud(m.quests), bag: m.bag, equip: m.equip ?? {}, error: null, dead: false });
        if (first && m.char.level <= 1 && !m.quests.length) this.#say("Keeper Wend", "Breathe. That's it. Breathe. Come out of the water, child. Slowly.", 7000);
        break;
      }
      case "snap": for (const s of m.ents) this.#snap(s); for (const id of m.gone ?? []) this.#drop(id); break;
      case "correct":
        this.#pos.set(m.x, m.y, m.z); this.#ry = m.ry; this.#leap = null; this.#sent = { ...this.#sent, x: m.x, y: m.y, z: m.z };
        break;
      case "stats": this.#set({ ...statsHud(m.stats) }); break;
      case "quests": this.#set({ quests: this.#questHud(m.quests) }); break;
      case "dialog": this.#set({ dialog: { npc: m.npc, name: this.#ents.get(m.npc)?.snap.name ?? "", text: m.text, options: m.options } }); break;
      case "chat": this.#set({ chat: [...this.hud.chat.slice(-7), { id: ++this.#chatId, name: m.name, text: m.text, ch: m.ch }] }); break;
      case "ev": for (const e of m.e) this.#event(e); break;
      case "bag":
        this.#set({ bag: m.bag, equip: m.equip ?? {} });
        void this.#me?.wear(wornModels(m.equip ?? {}), true);
        break;
      default: break;
    }
  }

  #snap(s: EntitySnap) {
    if (s.id === this.#you) {
      // our own frog: we move it here; the server's position is taken only the first time
      if (!this.#placed) {
        this.#pos.set(s.x, s.y, s.z); this.#ry = s.ry; this.#placed = true;
        this.#sent = { ...this.#sent, x: s.x, y: s.y, z: s.z }; this.controls.yaw = s.ry + Math.PI;
      }
      return;
    }
    let e = this.#ents.get(s.id);
    const now = performance.now();
    if (!e) {
      e = { id: s.id, snap: { ...s }, samples: [], root: new THREE.Group(), label: null };
      this.#ents.set(s.id, e);
      this.stage.scene.add(e.root);
      e.root.position.set(s.x, s.y, s.z); e.root.rotation.y = s.ry;
      void this.#dress(e);
    } else {
      Object.assign(e.snap, s);
      if (s.gear !== undefined) void e.frog?.wear(s.gear ? s.gear.split(",") : []);
    }
    e.samples.push({ t: now, x: s.x, y: s.y, z: s.z, ry: s.ry });
    if (e.samples.length > 4) e.samples.shift();
    if (this.hud.target?.id === s.id && (s.hp !== undefined || s.hpMax !== undefined)) this.#set({ target: { ...this.hud.target, hp: e.snap.hp ?? 0, hpMax: e.snap.hpMax ?? 1 } });
  }

  /** The model for a new entity: a frog for players and NPCs, a leech for a leech. */
  async #dress(e: Ent) {
    const s = e.snap;
    if (s.k === "mob") { e.leech = new Leech(); e.root.add(e.leech.root); }
    else {
      const look = s.k === "npc" ? NPC_LOOKS[s.npc ?? ""] ?? BASE_LOOK : decode(s.look);
      const f = await Frog.create(look);
      if (!this.#ents.has(e.id)) { f.dispose(); return; }
      e.frog = f; e.root.add(f.root);
      if (s.k === "player") void f.wear(e.snap.gear ? e.snap.gear.split(",") : []);
      f.play({ clip: s.k === "npc" ? NPC_POSE[s.npc ?? ""] ?? "Idle" : "Idle", loop: true });
    }
    if (this.#labels && this.#ents.has(e.id)) {
      const d = document.createElement("div");
      d.className = `ls-label ${s.k}`;
      this.#labels.appendChild(d); e.label = d;
    }
  }

  #drop(id: string) {
    const e = this.#ents.get(id); if (!e) return;
    e.frog?.dispose(); e.root.removeFromParent(); e.label?.remove();
    this.#ents.delete(id);
    if (this.hud.target?.id === id) this.#set({ target: null });
  }

  #event(e: CombatEvent) {
    const me = this.#you;
    switch (e.k) {
      case "cast":
        if (e.src !== me) { const a = ABILITIES[e.ability]; const f = this.#ents.get(e.src)?.frog; if (a && f) f.once(a.anim, 1.1); }
        break;
      case "hit": {
        if (e.src === me && this.hud.casting?.ability === e.ability) this.#set({ casting: null });
        const dst = e.dst === me ? null : this.#ents.get(e.dst);
        if (dst?.leech && e.kind === "dmg") dst.leech.hurt();
        if (e.src !== me) this.#ents.get(e.src)?.leech?.bite();
        if (e.dst === me && e.kind === "dmg") this.#me?.once("Hit_A", 1.3);
        const kind = e.kind === "heal" ? "heal" : e.dst === me ? "hurt" : "dmg";
        const n = Math.max(1, Math.round(e.amount));
        const text = e.kind === "absorb" ? `(${n})` : e.kind === "heal" ? `+${n}` : e.dst === me ? `-${n}` : `${n}${e.crit ? "!" : ""}`;
        this.#float(text, kind, e.dst);
        break;
      }
      case "miss": if (e.src === me && this.hud.casting?.ability === e.ability) this.#set({ casting: null });
        if (e.src === me || e.dst === me) this.#float(e.why === "range" ? "Too far" : e.why === "immune" ? "Immune" : "Dodged", "miss", e.dst); break;
      case "die":
        if (e.id === me) {
          this.#me?.play({ clip: "Death_A", loop: false, fade: 0.1 });
          this.controls.enabled = false; this.#set({ dead: true });
          this.#say("Keeper Wend", "Up. Up. You are not allowed to die in my cistern; I have only just got you out of it.", 5200);
          window.setTimeout(() => { this.controls.enabled = true; this.#set({ dead: false }); this.#me?.play({ clip: "Idle", loop: true }); }, 5200);
        } else {
          const t = this.#ents.get(e.id);
          if (t?.leech) t.leech.dead = true;
          t?.frog?.play({ clip: "Death_A", loop: false });
          if (this.hud.target?.id === e.id) this.#set({ target: null });
        }
        break;
      case "xp": this.#float(`+${e.amount} xp`, "xp"); break;
      case "level": if (e.id === me) { this.#float(`Level ${e.level}`, "xp"); this.#me?.once("Cheer"); } break;
      case "loot": this.#float(e.items.map((i) => `${ITEMS[i.id]?.name ?? i.id}${i.n > 1 ? ` ×${i.n}` : ""}`).join(", "), "loot"); break;
      case "cooldown": this.#set({ cooldowns: { ...this.hud.cooldowns, [e.ability]: performance.now() + e.ms } }); break;
      case "aura": break;
    }
  }

  #questHud(qs: QuestState[]): Hud["quests"] {
    return qs.filter((q) => !q.done).map((q) => {
      const d = QUESTS[q.id];
      if (!d) return { id: q.id, name: q.id, steps: [], ready: false, turnIn: "" };
      const steps = d.steps.map((s, i) => ({ text: s.text, have: Math.min(s.n, q.progress[i] ?? 0), need: s.n }));
      return { id: q.id, name: d.name, steps, ready: steps.every((s) => s.have >= s.need), turnIn: d.turnIn };
    });
  }

  #say(who: string, text: string, ms: number) {
    clearTimeout(this.#captionTimer);
    this.#set({ caption: { who, text } });
    this.#captionTimer = window.setTimeout(() => this.#set({ caption: null }), ms);
  }

  // ---------- talking, targeting, fighting ----------
  #nearest(kind: EntitySnap["k"], within: number): Ent | null {
    let best: Ent | null = null, d = within;
    for (const e of this.#ents.values()) {
      if (e.snap.k !== kind || (kind === "mob" && (e.snap.hp ?? 1) <= 0)) continue;
      const x = Math.hypot(e.root.position.x - this.#pos.x, e.root.position.z - this.#pos.z);
      if (x < d) { d = x; best = e; }
    }
    return best;
  }
  interact() {
    if (this.hud.phase !== "play") return;
    if (this.hud.dialog) { this.#set({ dialog: null }); return; }
    const npc = this.#nearest("npc", 3.6);
    if (npc) this.#net.send({ t: "interact", id: npc.id });
  }
  choose(id: string) {
    const d = this.hud.dialog; if (!d) return;
    if (id !== "bye") this.#net.send({ t: "choose", npc: d.npc, option: id });
    this.#set({ dialog: null });
  }
  say(text: string) { const t = text.trim(); if (t) this.#net.send({ t: "say", text: t.slice(0, 200) }); }
  equipItem(item: string) { this.#net.send({ t: "equip", item }); }
  unequip(slot: Slot) { this.#net.send({ t: "unequip", slot }); }
  useItem(item: string) { this.#net.send({ t: "use", item }); }

  get bar(): string[] { return [...CLASSES[this.hud.cls].abilities, "tongue"]; }
  useSlot(i: number) { const id = this.bar[i]; if (id) this.cast(id); }
  cast(id: string) {
    const a = ABILITIES[id], now = performance.now();
    if (!a || this.hud.phase !== "play" || this.#leap || this.hud.dead) return;
    if ((this.hud.cooldowns[id] ?? 0) > now || (a.gcd && this.hud.gcdUntil > now)) return;
    const t = this.hud.target ? this.#ents.get(this.hud.target.id) : null;
    if (a.target === "enemy") {
      if (!t || t.snap.k !== "mob") { this.#float("Pick a target", "miss"); return; }
      if (Math.hypot(t.root.position.x - this.#pos.x, t.root.position.z - this.#pos.z) > a.range + 0.8) { this.#float("Too far", "miss"); return; }
      this.#ry = Math.atan2(t.root.position.x - this.#pos.x, t.root.position.z - this.#pos.z);
      this.#sendMove(true);
    }
    this.#net.send({ t: "cast", ability: id, target: a.target === "self" ? null : t?.id ?? null });
    if (a.target === "enemy" && t) this.#fighting = t.id;
    this.#me?.once(a.anim, a.castMs ? Math.max(0.6, 1400 / a.castMs) : 1.15);
    const cds = { ...this.hud.cooldowns }; if (a.cooldownMs) cds[id] = now + a.cooldownMs;
    this.#set({ cooldowns: cds, gcdUntil: a.gcd ? now + GCD_MS : this.hud.gcdUntil, casting: a.castMs ? { ability: id, until: now + a.castMs, ms: a.castMs } : null });
    // hold still until the server has resolved it (its tick can land a little after our timer)
    if (a.castMs) window.setTimeout(() => { if (this.hud.casting?.ability === id) this.#set({ casting: null }); }, a.castMs + 400);
  }
  #target(e: Ent | null) {
    if (e?.id !== this.#fighting) this.#fighting = null;
    this.#net.send({ t: "target", id: e?.id ?? null });
    this.#set({ target: e ? { id: e.id, name: e.snap.name ?? "", hp: e.snap.hp ?? 0, hpMax: e.snap.hpMax ?? 1, level: e.snap.level ?? 1, kind: e.snap.k } : null });
  }
  #cycleTarget() {
    const live = [...this.#ents.values()].filter((e) => e.snap.k === "mob" && (e.snap.hp ?? 1) > 0)
      .sort((a, b) => a.root.position.distanceTo(this.#pos) - b.root.position.distanceTo(this.#pos)).slice(0, 6);
    if (!live.length) return;
    const i = live.findIndex((e) => e.id === this.hud.target?.id);
    this.#target(live[(i + 1) % live.length]!);
  }
  #pick(ndc: THREE.Vector2) {
    if (this.hud.phase !== "play") return;
    this.#ray.setFromCamera(ndc, this.stage.camera);
    let best: Ent | null = null, bestD = Infinity;
    for (const e of this.#ents.values()) {
      const p = e.root.position.clone().add(new THREE.Vector3(0, e.snap.k === "mob" ? 0.3 : 1.1, 0));
      const d = this.#ray.ray.distanceToPoint(p);
      if (d < (e.snap.k === "mob" ? 1.0 : 1.2) && d < bestD) { best = e; bestD = d; }
    }
    if (!best) return;
    if (best.snap.k === "npc" && best.root.position.distanceTo(this.#pos) < 4) this.#net.send({ t: "interact", id: best.id });
    else this.#target(best);
  }
  #float(text: string, kind: Hud["floats"][number]["kind"], at?: string) {
    const e = at && at !== this.#you ? this.#ents.get(at) : null;
    const p = e ? e.root.position.clone().add(new THREE.Vector3(0, e.snap.k === "mob" ? 0.9 : 2.3, 0)) : this.#pos.clone().add(new THREE.Vector3(0, 2.4, 0));
    p.project(this.stage.camera);
    const id = ++this.#floatId;
    this.#set({ floats: [...this.hud.floats.slice(-10), { id, text, kind, x: (p.x + 1) / 2 + (Math.random() - 0.5) * 0.02, y: (1 - p.y) / 2 }] });
    window.setTimeout(() => this.#set({ floats: this.hud.floats.filter((f) => f.id !== id) }), kind === "loot" ? 2200 : 1300);
  }

  // ---------- moving ----------
  #doLeap() {
    if (this.hud.phase !== "play" || this.#leap || this.hud.dead || (this.hud.cooldowns.leap ?? 0) > performance.now()) return;
    const dir = new THREE.Vector3(Math.sin(this.#ry), 0, Math.cos(this.#ry));
    this.#leap = { from: this.#pos.clone(), to: this.#pos.clone().addScaledVector(dir, 6), t: 0, dur: 0.78 };
    this.#net.send({ t: "leap", ry: this.#ry });
    this.#me?.play({ clip: "Jump_Full_Short", loop: false, speed: 1.25, fade: 0.08 });
    this.#set({ cooldowns: { ...this.hud.cooldowns, leap: performance.now() + 4000 } });
  }

  #blocked(x: number, z: number, fromY: number): boolean {
    if (!inBounds("cistern", x, z)) return true;
    for (const s of this.#place?.solids ?? []) if (Math.hypot(x - s.x, z - s.z) < s.r + 0.35) return true;
    // the door at the stair's top stays shut until Hollowmere is built
    const top = ZONES.cistern.marks.stairTop!;
    if (Math.hypot(x - top.x, z - top.z) < 1.9 && fromY > top.y - 1.2) return true;
    return floorAt("cistern", x, z).y - fromY > 0.7;
  }

  /** Tell the server where we are, ten times a second while it changes. */
  #sendMove(force = false) {
    const now = performance.now(), s = this.#sent;
    if (!this.#placed || (!force && now - s.at < 100)) return;
    const moved = Math.hypot(this.#pos.x - s.x, this.#pos.z - s.z) > 0.03 || Math.abs(this.#pos.y - s.y) > 0.05 || Math.abs(this.#ry - s.ry) > 0.05 || this.#anim !== s.anim;
    if (!moved && !force) return;
    this.#net.send({ t: "move", seq: ++this.#seq, x: +this.#pos.x.toFixed(3), y: +this.#pos.y.toFixed(3), z: +this.#pos.z.toFixed(3), ry: +this.#ry.toFixed(3), anim: this.#anim as never });
    this.#sent = { x: this.#pos.x, y: this.#pos.y, z: this.#pos.z, ry: this.#ry, anim: this.#anim, at: now };
  }

  #step(dt: number) {
    const me = this.#me; if (!me) return;
    const c = this.controls;
    if (this.hud.phase === "play" && this.#placed) {
      c.poll();
      const f = floorAt("cistern", this.#pos.x, this.#pos.z);
      if (this.#leap) {
        const L = this.#leap; L.t += dt / L.dur;
        const t = Math.min(1, L.t);
        const nx = L.from.x + (L.to.x - L.from.x) * t, nz = L.from.z + (L.to.z - L.from.z) * t;
        if (!this.#blocked(nx, nz, this.#pos.y - 3)) { this.#pos.x = nx; this.#pos.z = nz; }
        const ground = floorAt("cistern", this.#pos.x, this.#pos.z).y;
        this.#pos.y = Math.max(ground, THREE.MathUtils.lerp(L.from.y, ground, t) + Math.sin(Math.PI * t) * 1.4);
        this.#anim = "jump";
        if (L.t >= 1) { this.#leap = null; this.#pos.y = ground; me.play({ clip: "Idle", loop: true, fade: 0.15 }); }
      } else if (!this.hud.dead) {
        if (this.#auto && Math.hypot(this.#auto.x - this.#pos.x, this.#auto.y - this.#pos.z) < 0.4) this.#auto = null;
        const mv = this.#auto ? new THREE.Vector2(0, 1) : c.move, moving = mv.lengthSq() > 0.01 && !this.hud.casting && !this.hud.dialog;
        if (moving) {
          const fwd = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw)), right = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
          const dir = this.#auto ? new THREE.Vector3(this.#auto.x - this.#pos.x, 0, this.#auto.y - this.#pos.z).normalize() : fwd.multiplyScalar(mv.y).addScaledVector(right, mv.x).normalize();
          const run = !f.swim && !c.walk && mv.length() >= 0.55;
          const speed = (f.swim ? SPEED.swim : run ? SPEED.run : SPEED.walk) * Math.min(1, mv.length() * 1.3);
          const nx = this.#pos.x + dir.x * speed * dt, nz = this.#pos.z + dir.z * speed * dt;
          if (!this.#blocked(nx, nz, this.#pos.y)) { this.#pos.x = nx; this.#pos.z = nz; }
          else if (!this.#blocked(nx, this.#pos.z, this.#pos.y)) this.#pos.x = nx;
          else if (!this.#blocked(this.#pos.x, nz, this.#pos.y)) this.#pos.z = nz;
          let d = Math.atan2(dir.x, dir.z) - this.#ry; d = Math.atan2(Math.sin(d), Math.cos(d));
          this.#ry += d * Math.min(1, dt * 12);
          this.#anim = f.swim ? "swim" : run ? "run" : "walk";
          me.play(f.swim ? { clip: "Walking_A", loop: true, speed: 0.8 } : run ? { clip: "Running_A", loop: true } : { clip: "Walking_A", loop: true });
        } else {
          this.#anim = f.swim ? "swim" : "idle";
          me.play({ clip: f.swim ? "Idle" : this.#cls === "reedguard" ? "2H_Melee_Idle" : "Idle", loop: true });
        }
        const g = floorAt("cistern", this.#pos.x, this.#pos.z);
        this.#pos.y = g.y < this.#pos.y ? Math.max(g.y, this.#pos.y - dt * 9) : g.y;
        this.#wet = g.swim ? 1 : Math.max(0, this.#wet - dt * 0.08);
      }
      this.#sendMove();
      this.#autoAttack();
      const npc = this.#nearest("npc", 3.6);
      const prompt = this.hud.dialog ? null : npc ? `Talk to ${npc.snap.name}` : null;
      if (prompt !== this.hud.prompt) this.#set({ prompt });
    }
    me.root.position.copy(this.#pos);
    me.root.rotation.y = this.#ry;
    me.setWet(this.#wet);
    me.root.visible = this.hud.phase === "create" || (this.hud.phase === "play" && this.#placed);
    me.update(dt);
    this.#entities(dt);
  }

  /** Keep fighting what you fight: the first move again whenever it is ready, the target alive and in reach. */
  #autoAttack() {
    const id = this.#fighting; if (!id) return;
    const t = this.#ents.get(id), a = ABILITIES[this.bar[0]!];
    if (!t || (t.snap.hp ?? 1) <= 0 || !a || a.target !== "enemy") { this.#fighting = null; return; }
    const now = performance.now();
    if (this.#leap || this.hud.casting || this.hud.dialog || this.hud.dead || this.controls.move.lengthSq() > 0.01) return;
    // a little after our own cooldown ends: the server's tick may not have reached it yet
    if (this.hud.gcdUntil + 150 > now || (this.hud.cooldowns[a.id] ?? 0) + 150 > now) return;
    if (Math.hypot(t.root.position.x - this.#pos.x, t.root.position.z - this.#pos.z) > a.range + 0.6) return;
    this.cast(a.id);
  }

  /** Everyone else, drawn 120 ms behind the newest word from the server, so they move smoothly. */
  #entities(dt: number) {
    const at = performance.now() - 120;
    const cam = this.stage.camera, w = this.stage.renderer.domElement.clientWidth, h = this.stage.renderer.domElement.clientHeight;
    for (const e of this.#ents.values()) {
      const s = e.samples;
      if (!s.length) continue;
      let a = s[0]!, b = s[s.length - 1]!;
      for (let i = 0; i < s.length - 1; i++) if (s[i]!.t <= at && s[i + 1]!.t >= at) { a = s[i]!; b = s[i + 1]!; break; }
      const k = b.t > a.t ? THREE.MathUtils.clamp((at - a.t) / (b.t - a.t), 0, 1) : 1;
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, z = a.z + (b.z - a.z) * k;
      const speed = Math.hypot(b.x - a.x, b.z - a.z) / Math.max(0.05, (b.t - a.t) / 1000);
      e.root.position.set(x, y, z);
      let dr = b.ry - e.root.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      e.root.rotation.y += dr * Math.min(1, dt * 10);
      const anim = e.snap.anim ?? "idle";
      if (e.leech) {
        if (anim === "attack" && e.lastAnim !== "attack") e.leech.bite();
        const dead = (e.snap.hp ?? 1) <= 0;
        if (e.leech.dead && !dead) e.leech.root.scale.set(1, 1, 1);
        e.leech.dead = dead;
        e.leech.update(dt, speed > 0.2 ? 1 : 0);
        e.lastAnim = anim;
      }
      if (e.frog) {
        if (e.snap.k === "player" && anim !== e.lastAnim) {
          if (anim === "attack") e.frog.once("2H_Melee_Attack_Stab", 1.1);
          else if (anim === "hit") e.frog.once("Hit_A", 1.3);
          else e.frog.play({ clip: ANIM_CLIP[anim] ?? "Idle", loop: anim !== "dead" && anim !== "jump", speed: anim === "swim" ? 0.8 : 1 });
          e.lastAnim = anim;
        }
        e.frog.update(dt);
      }
      // the name over the head, and a quest mark over an NPC with something for you
      if (e.label) {
        // over the head: lower for a leech, and for someone sitting down
        const head = e.snap.k === "mob" ? 0.9 : NPC_POSE[e.snap.npc ?? ""] ? 1.9 : 2.35;
        const p = new THREE.Vector3(x, y + head, z).project(cam);
        const near = e.root.position.distanceTo(this.#pos) < 26;
        const alive = (e.snap.hp ?? 1) > 0;
        const show = this.hud.phase === "play" && p.z < 1 && near && (e.snap.k !== "mob" || alive);
        e.label.style.display = show ? "" : "none";
        if (show) {
          e.label.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -100%)`;
          const hp = e.snap.k === "mob" ? `<b style="--hp:${Math.max(0, Math.min(1, (e.snap.hp ?? 0) / Math.max(1, e.snap.hpMax ?? 1)))}"></b>` : "";
          const html = `${e.snap.mark ? `<i>${e.snap.mark}</i>` : ""}<span>${escapeHtml(e.snap.name ?? "")}</span>${hp}${e.snap.agent ? "<em>agent</em>" : ""}`;
          e.label.classList.toggle("on", this.hud.target?.id === e.id);
          if (e.label.innerHTML !== html) e.label.innerHTML = html;
        }
      }
    }
  }

  #targetRing(t: number) {
    const e = this.hud.target ? this.#ents.get(this.hud.target.id) : null;
    this.#ring.visible = Boolean(e) && this.hud.phase === "play";
    if (!e) return;
    this.#ring.position.set(e.root.position.x, e.root.position.y + 0.04, e.root.position.z);
    const s = e.snap.k === "mob" ? 1.25 : 0.8;
    this.#ring.scale.setScalar(s * (1 + Math.sin(t * 4) * 0.04));
    (this.#ring.material as THREE.MeshBasicMaterial).color.set(e.snap.k === "mob" ? 0xff5a4a : 0xd6b36a);
  }

  // ---------- the camera, and the light that travels with it ----------
  #camera(dt: number) {
    const cam = this.stage.camera, c = this.controls;
    if (this.hud.phase === "title" || this.hud.phase === "loading" || (this.hud.phase === "play" && !this.#placed)) {
      this.#orbit += dt * 0.05;
      cam.position.set(Math.sin(this.#orbit) * 9.5, 3.4 + Math.sin(this.#orbit * 0.7) * 0.6, Math.cos(this.#orbit) * 9.5);
      cam.lookAt(0, 1.2, 0);
      return;
    }
    const portrait = cam.aspect < 0.8;
    if (this.hud.phase === "create") {
      // upright, the creator's panel covers the lower half: stand back and show the frog above it
      const back = portrait ? 6.2 : 4.6;
      cam.position.lerp(new THREE.Vector3(this.#pos.x + 0.5, portrait ? 1.1 : 1.55, this.#pos.z + back), 1 - Math.exp(-dt * 4));
      cam.lookAt(this.#pos.x, portrait ? 0.25 : 1.15, this.#pos.z);
      return;
    }
    const target = this.#pos.clone().add(new THREE.Vector3(0, 1.45, 0));
    this.#camTarget.lerp(target, 1 - Math.exp(-dt * 10));
    const cp = Math.cos(c.pitch), want = new THREE.Vector3(Math.sin(c.yaw) * cp, Math.sin(c.pitch), Math.cos(c.yaw) * cp).multiplyScalar(c.dist * (portrait ? 1.18 : 1)).add(this.#camTarget);
    const r = Math.hypot(want.x, want.z);
    if (r > CISTERN.radius - 0.6) { want.x *= (CISTERN.radius - 0.6) / r; want.z *= (CISTERN.radius - 0.6) / r; }
    want.y = THREE.MathUtils.clamp(want.y, floorAt("cistern", want.x, want.z).y + 0.35, 7.4);
    cam.position.copy(want);
    cam.lookAt(this.#camTarget);
  }
  #lights() {
    this.#fill.position.copy(this.stage.camera.position).lerp(this.#pos.clone().add(new THREE.Vector3(0, 2.2, 0)), 0.55);
    this.#fill.intensity = this.hud.phase === "create" ? 7 : this.hud.phase === "play" ? 8 : 4;
  }

  /** Development only: walk the frog to a point (the screenshot tests use it). */
  devWalk(x: number, z: number) { this.#auto = new THREE.Vector2(x, z); }
  devFace(ry: number) { this.controls.yaw = ry + Math.PI; }
  get devBusy() { return this.#auto !== null; }

  #loop = () => {
    this.#raf = requestAnimationFrame(this.#loop);
    const dt = Math.min(0.05, this.#clock.getDelta());
    this.#t += dt;
    this.#step(dt);
    this.#camera(dt);
    this.#lights();
    this.#targetRing(this.#t);
    this.#place?.update(this.#t, dt);
    this.stage.render(dt);
  };

  dispose() {
    cancelAnimationFrame(this.#raf);
    this.#net.close();
    this.controls.dispose();
    for (const id of [...this.#ents.keys()]) this.#drop(id);
    this.#place?.dispose();
    this.stage.dispose();
    this.#listeners.clear();
  }
}
