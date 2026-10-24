import { createHash, randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  ABILITIES, CLASSES, COMMON_ABILITIES, GCD_MS, MAX_LEVEL, MOBS, NPCS, PROTOCOL_VERSION,
  QUESTS, SPEED, TICK_HZ, VIEW_RADIUS, ZONES, floorAt, inBounds, validLook, xpNext,
} from "@nightshift/lastspawn";
import type {
  Ability, CharSummary, ClientMsg, CombatEvent, EntitySnap, ItemStack, MobCamp, QuestDef,
  Spot, Stats, ZoneId,
} from "@nightshift/lastspawn";
import type { Actor, Character, Connection, Mob, Npc, Player, Session } from "./state.js";
import { distance, horizontal, own } from "./state.js";
import { loadCharacters, saveCharacters, validName } from "./store.js";

export type { Connection } from "./state.js";

export interface WorldOptions {
  dataDir: string;
  now?: () => number;
  random?: () => number;
  savedName?: (wallet: string) => string | null;
}

const npcLines: Record<string, string> = {
  keeper_wend: "Rest a moment. There is still light enough for both of us.",
  brother_cress: "The register can wait until your hands stop shaking. Take your time.",
};
const summaries = (c: Character): CharSummary => ({ id: c.id, name: c.name, cls: c.cls, level: c.level, look: c.look, zone: c.zone });
const health = (c: Character) => CLASSES[c.cls].hp + CLASSES[c.cls].hpPerLevel * (c.level - 1);
const statsOf = (p: Player): Stats => ({ hp: p.hp, hpMax: p.hpMax, level: p.level, xp: p.xp, xpNext: xpNext(p.level) });

export class World {
  private readonly file: string;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly characters: Map<string, Character>;
  private readonly sessions = new Map<string, Session>();
  private readonly players = new Map<string, Player>();
  private readonly mobs = new Map<string, Mob>();
  private readonly npcs = new Map<string, Npc>();
  private step = 0;

  constructor(options: WorldOptions) {
    this.file = join(options.dataDir, "lastspawn", "characters.json");
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.characters = loadCharacters(this.file);
    for (const zone of Object.values(ZONES)) {
      zone.camps.forEach((camp, i) => {
        for (let n = 0; n < camp.count; n++) this.spawnMob(zone.id, camp, i, n);
      });
      for (const place of zone.npcs) {
        const def = NPCS[place.id];
        if (def) {
          const npc: Npc = { k: "npc", id: `npc:${zone.id}:${place.id}`, npc: place.id, name: def.name, zone: zone.id, ...place.at };
          this.npcs.set(npc.id, npc);
        }
      }
    }
  }

  connect(conn: Connection): void {
    const old = this.sessions.get(conn.id);
    if (old) this.disconnect(old.conn);
    const wallet = conn.account.startsWith("w:") && conn.account.length > 2 ? conn.account.slice(2).toLowerCase() : null;
    this.sessions.set(conn.id, { conn, wallet, ready: false, player: null, seen: new Map(), fullSnapshot: true, dialog: null, saidAt: -Infinity });
  }

  handle(conn: Connection, msg: ClientMsg): void {
    const s = this.sessions.get(conn.id);
    if (!s || s.conn !== conn) return;
    if (msg.t === "hello") { this.hello(s, msg); return; }
    if (!s.ready) return;
    if (msg.t === "ping") { conn.send({ t: "pong", at: msg.at, now: this.now() }); return; }
    if (msg.t === "create") { this.create(s, msg); return; }
    if (msg.t === "play") { this.play(s, msg.charId); return; }
    const p = s.player;
    if (!p) return;
    if (msg.t === "say") { this.say(p, msg.text); return; }
    if (p.hp <= 0) return;
    switch (msg.t) {
      case "move": this.move(p, msg); break;
      case "leap": this.leap(p, msg.ry); break;
      case "target": {
        if (msg.id === null || this.entity(p.zone, msg.id)) p.target = msg.id;
        break;
      }
      case "cast": this.cast(p, msg.ability, msg.target); break;
      case "interact": this.interact(p, msg.id); break;
      case "choose": this.choose(p, msg.npc, msg.option); break;
      case "quest": this.quest(p, msg.action, msg.id); break;
      // Loot is awarded on death, so there is no client-controlled loot operation.
      case "loot": break;
    }
  }

  disconnect(conn: Connection): void {
    const s = this.sessions.get(conn.id);
    if (!s || s.conn !== conn) return;
    this.leave(s);
    this.sessions.delete(conn.id);
  }

  tick(): void {
    this.step++;
    const now = this.now();
    for (const p of this.players.values()) {
      this.tickAuras(p, now);
      if (p.hp <= 0) {
        if (p.deadAt !== null && now - p.deadAt >= 5000) this.respawnPlayer(p);
        continue;
      }
      if (p.cast && now >= p.cast.endsAt) {
        const cast = p.cast;
        this.interrupt(p);
        const ability = ABILITIES[cast.ability]!;
        const target = this.actor(p.zone, cast.target);
        if (target && target.hp > 0 && distance(p, cast) <= 0.3) this.resolve(p, ability, target);
      }
      const fighting = Array.from(this.mobs.values()).some((m) => m.hp > 0 && m.mode !== "leash" && m.threat.has(p.id));
      if (!fighting && now - p.combatAt >= 5000 && p.hp < p.hpMax) this.setHp(p, Math.min(p.hpMax, p.hp + p.hpMax * 0.04 / TICK_HZ));
      this.portals(p);
    }
    for (const mob of this.mobs.values()) {
      this.tickAuras(mob, now);
      this.tickMob(mob, now);
    }
    for (const s of this.sessions.values()) if (s.player) this.snapshot(s);
  }

  save(): void {
    for (const p of this.players.values()) p.lastSeen = this.now();
    saveCharacters(this.file, this.characters.values());
  }

  stats(): { connections: number; players: number; characters: number; mobs: number; tick: number } {
    return { connections: this.sessions.size, players: this.players.size, characters: this.characters.size,
      mobs: Array.from(this.mobs.values()).filter((m) => m.hp > 0).length, tick: this.step };
  }

  private error(s: Session, msg: string): void { s.conn.send({ t: "error", msg }); }

  private hello(s: Session, msg: Extract<ClientMsg, { t: "hello" }>): void {
    if (s.ready) return;
    if (msg.version !== PROTOCOL_VERSION) {
      this.error(s, "Unsupported LASTSPAWN protocol version."); this.disconnect(s.conn); s.conn.close(); return;
    }
    if ((msg.agent === true || s.conn.agent) && !s.wallet) {
      this.error(s, "Agents must sign in with a wallet."); this.disconnect(s.conn); s.conn.close(); return;
    }
    let guest: string | undefined;
    if (s.wallet) s.conn.account = `w:${s.wallet}`;
    else {
      if (msg.guest !== undefined && (!msg.guest || msg.guest.length > 512)) { this.error(s, "Invalid guest token."); return; }
      const token = msg.guest ?? (guest = randomBytes(24).toString("base64url"));
      s.conn.account = `g:${createHash("sha256").update(token).digest("hex")}`;
    }
    s.conn.agent = msg.agent === true || s.conn.agent;
    s.ready = true;
    s.conn.send({ t: "welcome", version: PROTOCOL_VERSION, ...(guest ? { guest } : {}),
      chars: Array.from(this.characters.values()).filter((c) => c.account === s.conn.account).map(summaries) });
  }

  private create(s: Session, msg: Extract<ClientMsg, { t: "create" }>): void {
    if (!validName(msg.name)) { this.error(s, "Names need 3-16 letters, digits, spaces, apostrophes or hyphens, starting with a letter."); return; }
    if (!own(CLASSES, msg.cls) || !validLook(msg.look)) { this.error(s, "Invalid class or appearance."); return; }
    const all = Array.from(this.characters.values());
    if (all.some((c) => c.name.toLowerCase() === msg.name.toLowerCase())) { this.error(s, "That name is already taken."); return; }
    if (all.filter((c) => c.account === s.conn.account).length >= 3) { this.error(s, "An account may have three characters."); return; }
    const c: Character = { id: randomUUID(), account: s.conn.account, name: msg.name, cls: msg.cls, look: msg.look,
      level: 1, xp: 0, zone: "cistern", ...ZONES.cistern.spawn, hp: CLASSES[msg.cls].hp,
      quests: [], bag: [], flags: {}, createdAt: this.now(), lastSeen: this.now() };
    this.characters.set(c.id, c);
    this.play(s, c.id);
    this.save();
  }

  private play(s: Session, id: string): void {
    const c = this.characters.get(id);
    if (!c || c.account !== s.conn.account) { this.error(s, "That character does not belong to you."); return; }
    if (s.player?.id === id) { this.enter(s.player); return; }
    const previous = this.players.get(id);
    if (previous) {
      this.error(previous.session, "This character was opened on another connection.");
      this.disconnect(previous.session.conn);
      previous.session.conn.close();
    }
    this.leave(s);
    const p: Player = { ...c, k: "player", session: s, hpMax: health(c), anim: c.hp > 0 ? "idle" : "dead", target: null,
      auras: new Map(), combatAt: -Infinity, deadAt: c.hp > 0 ? null : this.now(),
      movedAt: this.now(), seq: 0, gcdUntil: 0, cooldowns: new Map(), cast: null, portalBlocked: true };
    s.player = p; s.dialog = null;
    this.players.set(id, p); this.characters.set(id, p);
    this.refreshQuests(p);
    this.enter(p);
  }

  private leave(s: Session): void {
    const p = s.player;
    if (!p) return;
    this.interrupt(p);
    p.lastSeen = this.now();
    this.players.delete(p.id);
    this.forgetPlayer(p);
    s.player = null; s.dialog = null; s.seen.clear();
    this.save();
  }

  private enter(p: Player): void {
    p.session.fullSnapshot = true;
    p.session.conn.send({ t: "enter", you: p.id, zone: p.zone, char: summaries(p), stats: statsOf(p),
      quests: structuredClone(p.quests), bag: structuredClone(p.bag), tick: this.step });
  }

  private correct(p: Player, seq = p.seq): void {
    p.session.conn.send({ t: "correct", x: p.x, y: p.y, z: p.z, ry: p.ry, seq });
  }

  private move(p: Player, msg: Extract<ClientMsg, { t: "move" }>): void {
    const floor = floorAt(p.zone, msg.x, msg.z), now = this.now();
    const elapsed = Math.max(0, Math.min(1, (now - p.movedAt) / 1000));
    const speed = this.hasAura(p, "leaping") ? SPEED.leap : floorAt(p.zone, p.x, p.z).swim ? SPEED.swim : SPEED.run;
    const valid = [msg.x, msg.y, msg.z, msg.ry].every(Number.isFinite) && Number.isSafeInteger(msg.seq)
      && msg.seq > p.seq && !this.rooted(p) && inBounds(p.zone, msg.x, msg.z)
      && horizontal(p, msg) <= speed * this.speedMultiplier(p) * elapsed * 1.35 + 0.5
      && msg.y >= floor.y - 0.6 && msg.y <= floor.y + 3.2;
    if (!valid) { this.correct(p, msg.seq); return; }
    Object.assign(p, { x: msg.x, y: msg.y, z: msg.z, ry: msg.ry, anim: msg.anim, seq: msg.seq, movedAt: now });
    if (p.cast && distance(p, p.cast) > 0.3) this.interrupt(p);
    this.portals(p);
  }

  private grounded(zone: ZoneId, x: number, z: number, ry = 0): Spot {
    const half = ZONES[zone].half;
    x = Math.max(-half, Math.min(half, x)); z = Math.max(-half, Math.min(half, z));
    if (zone === "cistern" && !inBounds(zone, x, z)) {
      const scale = (half - 0.4) / Math.hypot(x, z);
      x *= scale; z *= scale;
    }
    return { x, y: floorAt(zone, x, z).y, z, ry };
  }

  private leap(p: Player, ry: number): void {
    if (!Number.isFinite(ry) || this.rooted(p)) return;
    if ((p.cooldowns.get("leap") ?? 0) > this.now()) { this.error(p.session, "Leap is on cooldown."); return; }
    this.interrupt(p);
    p.cooldowns.set("leap", this.now() + 4000);
    Object.assign(p, this.grounded(p.zone, p.x + Math.sin(ry) * 6, p.z + Math.cos(ry) * 6, ry));
    p.movedAt = this.now(); p.anim = "jump";
    this.addAura(p, p, { id: "leaping", ms: 600 }, "leap");
    p.session.conn.send({ t: "ev", e: [{ k: "cooldown", ability: "leap", ms: 4000 }] });
    this.correct(p); this.portals(p);
  }

  private portals(p: Player): void {
    const portal = ZONES[p.zone].portals.find((v) => distance(p, v.at) <= v.radius);
    if (!portal) { p.portalBlocked = false; return; }
    if (p.portalBlocked) return;
    this.interrupt(p); this.forgetPlayer(p);
    p.zone = portal.to; Object.assign(p, portal.arrive);
    p.target = null; p.anim = "idle"; p.movedAt = this.now(); p.portalBlocked = true;
    p.session.dialog = null;
    this.progress(p, "reach", p.zone);
    this.enter(p); this.correct(p);
  }

  private actor(zone: ZoneId, id: string): Actor | null {
    const a = this.players.get(id) ?? this.mobs.get(id);
    return a?.zone === zone ? a : null;
  }

  private entity(zone: ZoneId, id: string): Actor | Npc | null {
    const a = this.actor(zone, id) ?? this.npcs.get(id);
    return a?.zone === zone ? a : null;
  }

  private hasAura(a: Actor, id: string): boolean { return (a.auras.get(id)?.expiresAt ?? 0) > this.now(); }
  private rooted(a: Actor): boolean { return Array.from(a.auras.values()).some((v) => v.root && v.expiresAt > this.now()); }
  private stealthed(p: Player): boolean { return Array.from(p.auras.values()).some((v) => v.stealth && v.expiresAt > this.now()); }
  private speedMultiplier(a: Actor): number {
    return Array.from(a.auras.values()).filter((v) => v.expiresAt > this.now()).reduce((n, v) => n * (v.speed ?? 1), 1);
  }

  private cast(p: Player, id: string, requested?: string | null): void {
    if (!own(ABILITIES, id) || !(CLASSES[p.cls].abilities as readonly string[]).concat(COMMON_ABILITIES).includes(id)) {
      this.error(p.session, "You do not know that ability."); return;
    }
    if (id === "leap") { this.leap(p, p.ry); return; }
    const ability = ABILITIES[id]!, now = this.now();
    if (p.cast || (p.cooldowns.get(id) ?? 0) > now || (ability.gcd && p.gcdUntil > now)) {
      this.error(p.session, "That ability is not ready."); return;
    }
    const targetId = requested === undefined ? p.target : requested;
    const target = ability.target === "self" ? p : targetId ? this.actor(p.zone, targetId) : ability.target === "friend" ? p : null;
    if (!target || !this.validTarget(p, ability, target)) { this.error(p.session, "Choose a live, valid target."); return; }
    if (!this.inRange(p, ability, target)) { this.event(p, { k: "miss", src: p.id, dst: target.id, ability: id, why: "range" }); return; }
    p.cooldowns.set(id, now + ability.cooldownMs);
    if (ability.gcd) p.gcdUntil = now + GCD_MS;
    p.session.conn.send({ t: "ev", e: [{ k: "cooldown", ability: id, ms: ability.cooldownMs }] });
    if (ability.target === "enemy" || (ability.target === "self" && ability.amount)) this.breakStealth(p);
    if (ability.castMs) {
      p.cast = { ability: id, target: target.id, endsAt: now + ability.castMs, x: p.x, y: p.y, z: p.z };
      p.anim = "cast";
      this.event(p, { k: "cast", src: p.id, ability: id, tgt: target.id, ms: ability.castMs });
    } else this.resolve(p, ability, target);
  }

  private validTarget(p: Player, a: Ability, target: Actor): boolean {
    return target.hp > 0 && p.zone === target.zone && (a.target === "enemy" ? target.k === "mob"
      : a.target === "friend" ? target.k === "player" : target.id === p.id);
  }

  private inRange(p: Player, a: Ability, target: Actor): boolean { return target.id === p.id || distance(p, target) <= a.range + 0.8; }

  private resolve(p: Player, ability: Ability, target: Actor): void {
    if (p.hp <= 0 || !this.validTarget(p, ability, target)) return;
    if (!this.inRange(p, ability, target)) {
      this.event(p, { k: "miss", src: p.id, dst: target.id, ability: ability.id, why: "range" }); return;
    }
    p.anim = "attack";
    if (ability.id === "tongue" && target.k === "mob" && !this.tongue(p, target)) return;
    if (ability.id === "leap_slam") {
      Object.assign(p, this.grounded(p.zone, target.x, target.z, p.ry));
      p.movedAt = this.now(); this.correct(p);
    }
    const offensive = ability.target === "enemy" || (ability.target === "self" && !!ability.amount);
    let targets: Actor[] = [target];
    if (ability.radius) {
      const candidates = offensive ? this.mobs.values() : this.players.values();
      targets = Array.from(candidates as Iterable<Actor>).filter((a) => a.hp > 0 && a.zone === p.zone && distance(a, target) <= ability.radius!);
    }
    for (const dst of targets) {
      if (ability.amount) {
        const scale = (ability.perLevel ?? 0) * (p.level - 1);
        let amount = this.roll(...ability.amount) + scale;
        const crit = this.random() < 0.08;
        if (crit) amount *= 1.5;
        if (offensive) this.damage(p, dst, amount, ability.id, crit, ability.threat ?? 1);
        else this.heal(p, dst, amount, ability.id, crit);
      }
      if (ability.aura && dst.hp > 0 && !(dst.k === "mob" && dst.mode === "leash")) {
        this.addAura(dst, p, ability.aura, ability.id);
        if (dst.k === "mob" && (offensive || ability.aura.taunt)) this.aggro(dst, p, 1);
      }
    }
  }

  private tongue(p: Player, mob: Mob): boolean {
    if (mob.def.weight === "immune" || mob.mode === "leash") {
      this.event(p, { k: "miss", src: p.id, dst: mob.id, ability: "tongue", why: "immune" }); return false;
    }
    if (mob.def.weight === "light") {
      Object.assign(mob, this.grounded(p.zone, p.x + Math.sin(p.ry) * 1.8, p.z + Math.cos(p.ry) * 1.8, mob.ry));
    } else {
      Object.assign(p, this.grounded(p.zone, mob.x + Math.sin(mob.ry) * 2, mob.z + Math.cos(mob.ry) * 2, p.ry));
      p.movedAt = this.now(); this.correct(p);
    }
    if (mob.def.id === "snapper") this.addAura(mob, p, { id: "flipped", ms: 6000 }, "tongue");
    return true;
  }

  private interrupt(p: Player): void {
    p.cast = null;
    if (p.anim === "cast") p.anim = "idle";
  }

  private roll(min: number, max: number): number { return min + Math.floor(this.random() * (max - min + 1)); }

  private event(at: Pick<Actor, "zone" | "x" | "y" | "z" | "ry">, e: CombatEvent): void {
    for (const p of this.players.values()) if (p.zone === at.zone && distance(p, at) <= VIEW_RADIUS) p.session.conn.send({ t: "ev", e: [e] });
  }

  private setHp(a: Actor, hp: number): void {
    a.hp = hp;
    if (a.k === "player") a.session.conn.send({ t: "stats", stats: statsOf(a) });
  }

  private damage(src: Actor, dst: Actor, amount: number, ability: string, crit = false, threat = 1): void {
    if (dst.hp <= 0 || src.zone !== dst.zone) return;
    const immune = dst.k === "mob" && dst.mode === "leash";
    if (immune || this.hasAura(dst, "leaping")) {
      this.event(dst, { k: "miss", src: src.id, dst: dst.id, ability, why: immune ? "immune" : "dodge" }); return;
    }
    if (src.k === "player") this.breakStealth(src);
    if (src.k === "mob" && src.def.trait === "swarm" && dst.k === "player") this.breakStealth(dst);
    if (dst.k === "mob" && dst.def.trait === "armored_front" && !this.hasAura(dst, "flipped")) {
      const angle = Math.atan2(src.x - dst.x, src.z - dst.z);
      const delta = Math.atan2(Math.sin(angle - dst.ry), Math.cos(angle - dst.ry));
      if (Math.abs(delta) <= Math.PI / 3) amount *= 0.4;
    }
    amount = Math.max(0, amount);
    dst.combatAt = src.combatAt = this.now();
    for (const a of Array.from(dst.auras.values())) {
      if (!a.absorb || a.expiresAt <= this.now() || amount <= 0) continue;
      const soaked = Math.min(a.absorb, amount);
      a.absorb -= soaked; amount -= soaked;
      this.event(dst, { k: "hit", src: src.id, dst: dst.id, ability, amount: soaked, kind: "absorb" });
      if (!a.absorb) this.removeAura(dst, a.id);
    }
    for (const a of dst.auras.values()) if (a.expiresAt > this.now()) amount *= a.taken ?? 1;
    const dealt = Math.min(dst.hp, amount);
    this.setHp(dst, dst.hp - dealt);
    this.event(dst, { k: "hit", src: src.id, dst: dst.id, ability, amount: dealt, crit, kind: "dmg" });
    if (dst.k === "mob" && src.k === "player") {
      dst.damage.set(src.id, (dst.damage.get(src.id) ?? 0) + dealt);
      this.aggro(dst, src, dealt * threat);
    }
    if (dst.hp <= 0) this.die(dst, src);
  }

  private heal(src: Player, dst: Actor, amount: number, ability: string, crit = false): void {
    if (dst.k !== "player" || dst.hp <= 0) return;
    const healed = Math.min(amount, dst.hpMax - dst.hp);
    this.setHp(dst, dst.hp + healed);
    this.event(dst, { k: "hit", src: src.id, dst: dst.id, ability, amount: healed, crit, kind: "heal" });
    for (const mob of this.mobs.values()) {
      if (mob.zone === dst.zone && mob.hp > 0 && mob.mode !== "leash" && mob.threat.has(dst.id) && healed > 0) {
        this.aggro(mob, src, healed / 2); src.combatAt = this.now();
      }
    }
  }

  private addAura(dst: Actor, src: Actor, aura: NonNullable<Ability["aura"]>, ability: string): void {
    const now = this.now();
    dst.auras.set(aura.id, { ...aura, source: src.id, ability, expiresAt: now + aura.ms, nextTick: now + 1000 });
    this.event(dst, { k: "aura", dst: dst.id, aura: aura.id, on: true, ms: aura.ms });
  }

  private removeAura(dst: Actor, id: string): void {
    if (dst.auras.delete(id)) this.event(dst, { k: "aura", dst: dst.id, aura: id, on: false });
  }

  private breakStealth(p: Player): void {
    for (const a of p.auras.values()) if (a.stealth) this.removeAura(p, a.id);
  }

  private tickAuras(dst: Actor, now: number): void {
    for (const aura of Array.from(dst.auras.values())) {
      if (!dst.auras.has(aura.id)) continue;
      while (aura.dps && aura.nextTick <= Math.min(now, aura.expiresAt) && dst.hp > 0) {
        aura.nextTick += 1000;
        const src = this.actor(dst.zone, aura.source);
        if (!src) continue;
        if (aura.dps > 0) this.damage(src, dst, aura.dps, aura.ability);
        else if (src.k === "player") this.heal(src, dst, -aura.dps, aura.ability);
      }
      if (now >= aura.expiresAt) this.removeAura(dst, aura.id);
    }
  }

  private die(dst: Actor, src: Actor): void {
    dst.deadAt = this.now(); dst.anim = "dead"; dst.target = null;
    for (const id of Array.from(dst.auras.keys())) this.removeAura(dst, id);
    this.event(dst, { k: "die", id: dst.id, by: src.id });
    for (const p of this.players.values()) if (p.cast?.target === dst.id) this.interrupt(p);
    if (dst.k === "player") { this.interrupt(dst); return; }
    const scores = dst.damage.size ? dst.damage : dst.threat;
    const winner = Array.from(scores).filter(([id]) => this.players.get(id)?.zone === dst.zone).sort((a, b) => b[1] - a[1])[0];
    const p = winner ? this.players.get(winner[0]) : null;
    if (!p) return;
    this.giveXp(p, Math.round(dst.def.xp * dst.level / 1.5));
    this.progress(p, "kill", dst.def.id);
    const items: ItemStack[] = [];
    for (const loot of dst.def.loot) if (this.random() < loot.chance) items.push({ id: loot.item, n: loot.n ? this.roll(...loot.n) : 1 });
    if (items.length) {
      this.addItems(p, items);
      p.session.conn.send({ t: "ev", e: [{ k: "loot", items }] });
    }
  }

  private giveXp(p: Player, amount: number): void {
    p.session.conn.send({ t: "ev", e: [{ k: "xp", amount }] });
    p.xp += amount;
    while (p.level < MAX_LEVEL && p.xp >= xpNext(p.level)) {
      p.xp -= xpNext(p.level); p.level++; p.hpMax = health(p); p.hp = p.hpMax;
      this.event(p, { k: "level", id: p.id, level: p.level });
    }
    if (p.level === MAX_LEVEL) p.xp = 0;
    p.session.conn.send({ t: "stats", stats: statsOf(p) });
  }

  private respawnPlayer(p: Player): void {
    this.forgetPlayer(p); this.interrupt(p);
    Object.assign(p, ZONES[p.zone].spawn);
    p.hp = p.hpMax / 2; p.deadAt = null; p.anim = "idle"; p.target = null;
    p.movedAt = this.now(); p.combatAt = this.now(); p.portalBlocked = true;
    this.correct(p); p.session.conn.send({ t: "stats", stats: statsOf(p) });
  }

  private addItems(p: Player, items: ItemStack[]): void {
    for (const item of items) {
      const stack = p.bag.find((s) => s.id === item.id);
      if (stack) stack.n += item.n;
      else p.bag.push({ ...item });
    }
    p.session.conn.send({ t: "bag", bag: structuredClone(p.bag) });
    this.refreshQuests(p);
  }

  private spawnMob(zone: ZoneId, camp: MobCamp, campIndex: number, n: number): void {
    const def = MOBS[camp.mob];
    if (!def) return;
    const angle = this.random() * Math.PI * 2, radius = Math.sqrt(this.random()) * camp.spread;
    const home = this.grounded(zone, camp.at.x + Math.sin(angle) * radius, camp.at.z + Math.cos(angle) * radius, camp.at.ry);
    const level = this.roll(...def.level), hpMax = def.hp + def.hpPerLevel * (level - 1);
    const mob: Mob = { k: "mob", id: `mob:${zone}:${campIndex}:${n}`, zone, ...home, home, def, camp,
      campId: `${zone}:${campIndex}`, level, hp: hpMax, hpMax, anim: "idle", target: null, auras: new Map(),
      combatAt: -Infinity, deadAt: null, mode: "idle", threat: new Map(), damage: new Map(), hits: new Map(),
      swingAt: 0, wanderAt: this.now() + this.roll(6000, 12000), wander: null, fled: false, fleeUntil: 0, fleeTo: null };
    this.mobs.set(mob.id, mob);
  }

  private aggro(mob: Mob, p: Player, threat: number, pack = true): void {
    if (mob.hp <= 0 || p.hp <= 0 || mob.zone !== p.zone || mob.mode === "leash") return;
    const wasIdle = mob.mode === "idle";
    mob.threat.set(p.id, (mob.threat.get(p.id) ?? 0) + Math.max(0, threat));
    mob.combatAt = p.combatAt = this.now();
    mob.wander = null;
    if (wasIdle) { mob.mode = "chase"; mob.target = p.id; mob.swingAt = this.now() + mob.def.swingMs; }
    if (pack && wasIdle && mob.def.trait === "pack_flee") {
      for (const other of this.mobs.values()) if (other !== mob && other.campId === mob.campId) this.aggro(other, p, 1, false);
    }
  }

  private forgetPlayer(p: Player): void {
    for (const mob of this.mobs.values()) {
      mob.threat.delete(p.id); mob.hits.delete(p.id);
      if (mob.target === p.id) mob.target = null;
    }
  }

  private chaseTarget(mob: Mob): Player | null {
    const taunt = Array.from(mob.auras.values()).find((a) => a.taunt && a.expiresAt > this.now());
    const forced = taunt ? this.players.get(taunt.source) : null;
    if (forced && forced.hp > 0 && forced.zone === mob.zone) return forced;
    let best: Player | null = null, highest = -Infinity;
    for (const [id, threat] of mob.threat) {
      const p = this.players.get(id);
      if (!p || p.hp <= 0 || p.zone !== mob.zone) { mob.threat.delete(id); continue; }
      if (threat > highest) { best = p; highest = threat; }
    }
    return best;
  }

  private tickMob(mob: Mob, now: number): void {
    if (mob.hp <= 0) {
      if (mob.deadAt !== null && now - mob.deadAt >= mob.def.respawnMs) {
        Object.assign(mob, mob.home);
        mob.hp = mob.hpMax; mob.deadAt = null; mob.anim = "idle"; mob.mode = "idle";
        mob.target = null; mob.threat.clear(); mob.damage.clear(); mob.hits.clear(); mob.auras.clear();
        mob.fled = false; mob.fleeTo = null; mob.wander = null; mob.combatAt = -Infinity;
        mob.wanderAt = now + this.roll(6000, 12000);
      }
      return;
    }
    if (mob.mode === "leash") {
      mob.hp = mob.hpMax;
      if (this.walkMob(mob, mob.home, mob.def.speed * 1.5)) {
        mob.mode = "idle"; mob.anim = "idle"; mob.fled = false; mob.wander = null;
        mob.wanderAt = now + this.roll(6000, 12000);
      }
      return;
    }
    if (mob.mode === "idle") {
      const p = Array.from(this.players.values()).filter((v) => v.zone === mob.zone && v.hp > 0 && !this.stealthed(v)
        && distance(v, mob) <= mob.def.aggro).sort((a, b) => distance(a, mob) - distance(b, mob))[0];
      if (p) this.aggro(mob, p, 1);
      else { this.wanderMob(mob, now); return; }
    }
    const target = this.chaseTarget(mob);
    if (!target || horizontal(mob, mob.home) > mob.def.leash) { this.startLeash(mob); return; }
    mob.target = target.id;
    if (mob.def.trait === "pack_flee" && !mob.fled && mob.hp < mob.hpMax * 0.2) {
      const away = Math.atan2(mob.x - target.x, mob.z - target.z);
      mob.fleeTo = this.grounded(mob.zone, mob.x + Math.sin(away) * 6, mob.z + Math.cos(away) * 6);
      mob.fled = true; mob.mode = "flee"; mob.fleeUntil = now + 3000;
    }
    if (mob.mode === "flee" && now < mob.fleeUntil) {
      if (mob.fleeTo) this.walkMob(mob, mob.fleeTo, mob.def.speed * this.speedMultiplier(mob));
      return;
    }
    mob.mode = "chase";
    if (distance(mob, target) > mob.def.reach) {
      this.walkMob(mob, target, mob.def.speed * this.speedMultiplier(mob));
      return;
    }
    mob.anim = "idle";
    mob.ry = Math.atan2(target.x - mob.x, target.z - mob.z);
    if (now < mob.swingAt) return;
    mob.swingAt = now + mob.def.swingMs; mob.anim = "attack";
    const before = target.hp;
    this.damage(mob, target, this.roll(...mob.def.dmg), "swing");
    if (target.hp < before && target.hp > 0 && mob.def.trait === "latch") {
      const hits = (mob.hits.get(target.id) ?? 0) + 1;
      mob.hits.clear(); mob.hits.set(target.id, hits);
      if (hits >= 2) {
        this.addAura(target, mob, { id: "latched", ms: 6000, dps: 1.5 }, "latch");
        mob.hits.set(target.id, 0);
      }
    }
  }

  private startLeash(mob: Mob): void {
    mob.mode = "leash"; mob.target = null; mob.hp = mob.hpMax;
    mob.threat.clear(); mob.damage.clear(); mob.hits.clear();
    for (const id of Array.from(mob.auras.keys())) this.removeAura(mob, id);
  }

  private walkMob(mob: Mob, to: Spot, speed: number): boolean {
    const d = horizontal(mob, to);
    if (this.rooted(mob)) { mob.anim = "idle"; return false; }
    if (d <= 0.01) { mob.anim = "idle"; return true; }
    const step = Math.min(d, speed / TICK_HZ);
    const ry = Math.atan2(to.x - mob.x, to.z - mob.z);
    Object.assign(mob, this.grounded(mob.zone, mob.x + Math.sin(ry) * step, mob.z + Math.cos(ry) * step, ry));
    mob.anim = floorAt(mob.zone, mob.x, mob.z).swim ? "swim" : "run";
    return d <= step + 0.01;
  }

  private wanderMob(mob: Mob, now: number): void {
    if (now - mob.combatAt >= 5000) mob.hp = Math.min(mob.hpMax, mob.hp + mob.hpMax * 0.04 / TICK_HZ);
    if (now >= mob.wanderAt) {
      const angle = this.random() * Math.PI * 2, radius = Math.sqrt(this.random()) * mob.camp.spread;
      mob.wander = this.grounded(mob.zone, mob.camp.at.x + Math.sin(angle) * radius, mob.camp.at.z + Math.cos(angle) * radius);
      mob.wanderAt = now + this.roll(6000, 12000);
    }
    if (mob.wander && this.walkMob(mob, mob.wander, mob.def.speed * 0.4)) mob.wander = null;
    if (!mob.wander) mob.anim = "idle";
  }

  private npcNear(p: Player, id: string): Npc | null {
    const npc = this.npcs.get(id) ?? Array.from(this.npcs.values()).find((n) => n.npc === id && n.zone === p.zone);
    return npc && npc.zone === p.zone && distance(p, npc) <= 4 ? npc : null;
  }

  private available(p: Player, q: QuestDef): boolean {
    if (p.level < q.level - 1 || p.flags[`quest:${q.id}`] === "done" || p.quests.some((s) => s.id === q.id)) return false;
    return Object.values(QUESTS).filter((prev) => prev.next === q.id).every((prev) => p.flags[`quest:${prev.id}`] === "done");
  }

  private complete(p: Player, q: QuestDef): boolean {
    const state = p.quests.find((s) => s.id === q.id);
    return !!state && q.steps.every((step, i) => (state.progress[i] ?? 0) >= step.n);
  }

  private interact(p: Player, id: string): void {
    const npc = this.npcNear(p, id);
    if (!npc) { this.error(p.session, "Move closer to speak with them."); return; }
    this.progress(p, "talk", npc.npc);
    const options: { id: string; text: string }[] = [], lines: string[] = [];
    for (const q of Object.values(QUESTS)) {
      if (q.turnIn === npc.npc && this.complete(p, q)) { options.push({ id: `turnin:${q.id}`, text: `Complete: ${q.name}` }); lines.push(q.done); }
      else if (q.giver === npc.npc && this.available(p, q)) { options.push({ id: `accept:${q.id}`, text: `Accept: ${q.name}` }); lines.push(q.offer); }
    }
    options.push({ id: "bye", text: "Leave" });
    p.session.dialog = { npc: npc.id, options: new Set(options.map((o) => o.id)) };
    p.session.conn.send({ t: "dialog", npc: npc.id, text: lines.join("\n\n") || npcLines[npc.npc] || "Stay a while. You have come a long way.", options });
  }

  private choose(p: Player, id: string, option: string): void {
    const npc = this.npcNear(p, id), dialog = p.session.dialog;
    if (!npc || !dialog || dialog.npc !== npc.id || !dialog.options.has(option)) return;
    if (option === "bye") { p.session.dialog = null; return; }
    const [action, questId] = option.split(":");
    if (questId && (action === "accept" || action === "turnin")) this.quest(p, action, questId, npc);
  }

  private quest(p: Player, action: "accept" | "turnin" | "abandon", id: string, selectedNpc?: Npc): void {
    if (!own(QUESTS, id)) return;
    const q = QUESTS[id]!;
    if (action === "abandon") {
      if (!p.quests.some((s) => s.id === id)) return;
      p.quests = p.quests.filter((s) => s.id !== id); this.sendQuests(p); p.session.dialog = null; return;
    }
    const npc = selectedNpc ?? this.npcNear(p, action === "accept" ? q.giver : q.turnIn);
    if (!npc || npc.npc !== (action === "accept" ? q.giver : q.turnIn)) { this.error(p.session, "Speak to the quest's keeper nearby."); return; }
    if (action === "accept") {
      if (!this.available(p, q)) { this.error(p.session, "That quest is not available."); return; }
      p.quests.push({ id, step: 0, progress: q.steps.map(() => 0), done: false });
      this.refreshQuests(p, true);
    } else {
      this.refreshQuests(p);
      if (!this.complete(p, q)) { this.error(p.session, "That quest is not complete."); return; }
      for (const step of q.steps) if (step.kind === "collect") {
        const stack = p.bag.find((s) => s.id === step.target);
        if (stack) stack.n -= step.n;
      }
      p.bag = p.bag.filter((s) => s.n > 0);
      p.quests = p.quests.filter((s) => s.id !== id);
      p.flags[`quest:${id}`] = "done";
      this.sendQuests(p); this.giveXp(p, q.xp); this.addItems(p, (q.reward ?? []).map((s) => ({ id: s.item, n: s.n })));
    }
    p.session.dialog = null;
  }

  private progress(p: Player, kind: "kill" | "talk" | "reach", target: string): void {
    let changed = false;
    for (const state of p.quests) {
      QUESTS[state.id]!.steps.forEach((step, i) => {
        if (step.kind === kind && step.target === target && state.progress[i]! < step.n) {
          state.progress[i] = Math.min(step.n, state.progress[i]! + 1); changed = true;
        }
      });
    }
    this.refreshQuests(p, changed);
  }

  private refreshQuests(p: Player, changed = false): void {
    for (const state of p.quests) {
      const q = QUESTS[state.id]!;
      q.steps.forEach((step, i) => {
        if (step.kind !== "collect") return;
        const n = Math.min(step.n, p.bag.find((s) => s.id === step.target)?.n ?? 0);
        if (state.progress[i] !== n) { state.progress[i] = n; changed = true; }
      });
      const next = q.steps.findIndex((step, i) => state.progress[i]! < step.n);
      const index = next < 0 ? q.steps.length : next, done = next < 0;
      if (state.step !== index || state.done !== done) { state.step = index; state.done = done; changed = true; }
    }
    if (changed) this.sendQuests(p);
  }

  private sendQuests(p: Player): void { p.session.conn.send({ t: "quests", quests: structuredClone(p.quests) }); }

  private mark(p: Player, npc: Npc): "!" | "?" | null {
    if (Object.values(QUESTS).some((q) => q.turnIn === npc.npc && this.complete(p, q))) return "?";
    return Object.values(QUESTS).some((q) => q.giver === npc.npc && this.available(p, q)) ? "!" : null;
  }

  private say(p: Player, raw: string): void {
    const text = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim(), now = this.now();
    if (!text || text.length > 200 || now - p.session.saidAt < 1000) return;
    p.session.saidAt = now;
    for (const other of this.players.values()) if (other.zone === p.zone && distance(p, other) <= 30) {
      other.session.conn.send({ t: "chat", from: p.id, name: p.name, text, ch: "say" });
    }
  }

  private snapOf(a: Actor | Npc, viewer: Player): EntitySnap {
    const base = { id: a.id, k: a.k, x: a.x, y: a.y, z: a.z, ry: a.ry };
    if (a.k === "npc") return { ...base, name: a.name, npc: a.npc, look: NPCS[a.npc]!.look, anim: "idle", mark: this.mark(viewer, a) };
    const fighter = { ...base, hp: a.hp, hpMax: a.hpMax, level: a.level, anim: a.anim, tgt: a.target };
    return a.k === "mob" ? { ...fighter, name: a.def.name, mob: a.def.id }
      : { ...fighter, name: a.name, cls: a.cls, look: a.look, agent: a.session.conn.agent };
  }

  private snapshot(s: Session): void {
    const p = s.player!, current = new Map<string, EntitySnap>(), ents: EntitySnap[] = [];
    const entities: (Actor | Npc)[] = [...this.players.values(), ...this.mobs.values(), ...this.npcs.values()];
    for (const a of entities) {
      if (a.zone !== p.zone || distance(a, p) > VIEW_RADIUS) continue;
      const snap = this.snapOf(a, p), old = s.fullSnapshot ? undefined : s.seen.get(a.id);
      current.set(a.id, snap);
      if (!old) { ents.push(snap); continue; }
      const changed = Object.keys(snap).filter((key) => snap[key as keyof EntitySnap] !== old[key as keyof EntitySnap]);
      if (!changed.length) continue;
      // The protocol requires the identity and pose even when only an optional field changed.
      const delta: EntitySnap = { id: a.id, k: a.k, x: a.x, y: a.y, z: a.z, ry: a.ry };
      for (const key of changed) Object.assign(delta, { [key]: snap[key as keyof EntitySnap] });
      ents.push(delta);
    }
    const gone = Array.from(s.seen.keys()).filter((id) => !current.has(id));
    s.seen = current; s.fullSnapshot = false;
    s.conn.send({ t: "snap", tick: this.step, ents, ...(gone.length ? { gone } : {}), ack: p.seq });
  }
}
