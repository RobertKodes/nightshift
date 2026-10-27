import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ABILITIES, ARMOR_K, CLASSES, GCD_MS, ITEMS, MOBS, PROTOCOL_VERSION, STARTER_GEAR, TICK_HZ, ZONES, encodeLook, floorAt, xpNext } from "@nightshift/lastspawn";
import type { ClassId, CombatEvent, Equip, ServerMsg, Slot, Spot, ZoneId } from "@nightshift/lastspawn";
import { World } from "./world.js";
import type { Connection } from "./world.js";
import type { Character } from "./state.js";

const look = encodeLook({}), dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "lastspawn-")); dirs.push(dir); return dir; };

class FakeConnection implements Connection {
  ip?: string;
  agent = false;
  closed = false;
  messages: ServerMsg[] = [];
  seq = 0;
  constructor(public id: string, public account: string) {}
  send(msg: ServerMsg): void { this.messages.push(structuredClone(msg)); }
  close(): void { this.closed = true; }
  all<T extends ServerMsg["t"]>(t: T): Extract<ServerMsg, { t: T }>[] {
    return this.messages.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
  }
  last<T extends ServerMsg["t"]>(t: T): Extract<ServerMsg, { t: T }> { return this.all(t).at(-1)!; }
  events<K extends CombatEvent["k"]>(k: K): Extract<CombatEvent, { k: K }>[] {
    return this.all("ev").flatMap((m) => m.e).filter((e): e is Extract<CombatEvent, { k: K }> => e.k === k);
  }
  clear(): void { this.messages = []; }
}

function character(id = "frog", options: Partial<Character> = {}): Character {
  const c: Character = { id, account: `w:${id}`, name: id[0]!.toUpperCase() + id.slice(1), cls: "reedguard", look,
    // Combat fixtures are explicitly unequipped; create and legacy-save tests cover starter gear.
    level: 1, xp: 0, zone: "cistern", ...ZONES.cistern.spawn, hp: CLASSES.reedguard.hp, quests: [], bag: [], equip: {}, flags: {}, createdAt: 1, lastSeen: 1, ...options };
  c.hp = options.hp ?? CLASSES[c.cls].hp + CLASSES[c.cls].hpPerLevel * (c.level - 1);
  return c;
}

function seeded(seed: number): () => number {
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
}

function game(chars: (Character | Omit<Character, "equip">)[] = [], random: () => number = () => 0.5) {
  const dir = temp(), file = join(dir, "lastspawn", "characters.json");
  if (chars.length) { mkdirSync(join(dir, "lastspawn")); writeFileSync(file, JSON.stringify(chars)); }
  let now = 100000, rng = random, serial = 0;
  const world = new World({ dataDir: dir, now: () => now, random: () => rng() });
  const open = (account = "", guest?: string) => {
    const conn = new FakeConnection(`connection-${++serial}`, account);
    world.connect(conn); world.handle(conn, { t: "hello", version: PROTOCOL_VERSION, guest });
    return conn;
  };
  const play = (c: Character) => { const conn = open(c.account); world.handle(conn, { t: "play", charId: c.id }); return conn; };
  const clock = (ms: number) => { now += ms; };
  const advance = (ms: number) => { for (let i = 0; i < ms; i += 100) { clock(100); world.tick(); } };
  const move = (conn: FakeConnection, zone: ZoneId, x: number, z: number, y = floorAt(zone, x, z).y, ry = 0) => {
    world.handle(conn, { t: "move", seq: ++conn.seq, x, y, z, ry, anim: "run" });
  };
  const walk = (conn: FakeConnection, zone: ZoneId, from: Spot, to: Spot) => {
    const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 2));
    for (let i = 1; i <= n; i++) { clock(1000); move(conn, zone, from.x + (to.x - from.x) * i / n, from.z + (to.z - from.z) * i / n); }
  };
  const snap = (conn: FakeConnection) => { world.tick(); return conn.last("snap"); };
  return { world, dir, file, open, play, clock, advance, move, walk, snap, random: (next: () => number) => { rng = next; } };
}

const at = (zone: ZoneId, x: number, z: number, ry = 0): Spot => ({ x, y: floorAt(zone, x, z).y, z, ry });
const create = (world: World, c: FakeConnection, name: string, cls: ClassId = "reedguard") => world.handle(c, { t: "create", name, cls, look });
const leechId = "mob:cistern:0:0";
const leechCamp = ZONES.cistern.camps[0]!, leech = MOBS[leechCamp.mob]!;
const npcWend = "npc:cistern:keeper_wend";
const cast = (world: World, c: FakeConnection, ability: string, target?: string | null) => world.handle(c, { t: "cast", ability, target });
const hits = (c: FakeConnection, ability: string) => c.events("hit").filter((e) => e.ability === ability && e.kind === "dmg");

function approachMob(g: ReturnType<typeof game>, c: FakeConnection, from: Spot, range: number, id = leechId) {
  // Camp spread and grounding can move the spawn away from the camp's center.
  const zone = c.last("enter").zone, mob = g.snap(c).ents.find((e) => e.id === id)!;
  const spot = at(zone, mob.x, mob.z - range);
  g.walk(c, zone, from, spot);
  return { mob, spot };
}

describe("LASTSPAWN accounts and characters", () => {
  it.each([
    ["reedguard", 25, 4], ["dartsinger", 10, 5], ["lampwright", 8, 6],
  ] as const)("creates a %s wearing starter gear outside the bag", (cls, armor, power) => {
    const g = game(), c = g.open();
    create(g.world, c, "New Frog", cls);
    const equip = Object.fromEntries(STARTER_GEAR[cls].map((id) => [ITEMS[id]!.slot, id]));
    expect(c.last("enter")).toMatchObject({ equip, bag: [], stats: { armor, power } });
    const saved = JSON.parse(readFileSync(g.file, "utf8")) as Character[];
    expect(saved[0]!.equip).toEqual(equip); expect(saved[0]!.bag).toEqual([]);
  });

  it.each(["reedguard", "dartsinger", "lampwright"] as const)("restores starter gear for an old %s save", (cls) => {
    const frog = character("frog", { cls, bag: [{ id: "glow_moss", n: 1 }] }), { equip: _equip, ...legacy } = frog;
    const g = game([legacy]), c = g.play(frog);
    const equip = Object.fromEntries(STARTER_GEAR[cls].map((id) => [ITEMS[id]!.slot, id]));
    expect(c.last("enter")).toMatchObject({ equip, bag: frog.bag });
    g.world.save();
    expect((JSON.parse(readFileSync(g.file, "utf8")) as Character[])[0]!.equip).toEqual(equip);
    expect(existsSync(`${g.file}.bad`)).toBe(false);
  });

  it("issues a 24-byte guest token, restores its account, and prefers a signed-in wallet", () => {
    const g = game(), guest = g.open();
    const token = guest.last("welcome").guest!;
    expect(Buffer.from(token, "base64url")).toHaveLength(24);
    expect(guest.account).toMatch(/^g:[a-f0-9]{64}$/);
    create(g.world, guest, "Moss Child");
    const id = guest.last("enter").you;
    g.world.disconnect(guest);
    const again = g.open("", token);
    expect(again.last("welcome").chars.map((c) => c.id)).toEqual([id]);
    expect(again.last("welcome").guest).toBeUndefined();
    const wallet = g.open("w:0xABCD", token);
    expect(wallet.account).toBe("w:0xabcd");
    expect(wallet.last("welcome").chars).toEqual([]);
  });

  it("requires the protocol version, and requires wallets for agents", () => {
    const g = game(), wrong = new FakeConnection("wrong", ""), guest = new FakeConnection("agent", "");
    g.world.connect(wrong); g.world.handle(wrong, { t: "hello", version: 999 });
    expect(wrong.closed).toBe(true); expect(wrong.last("error").msg).toMatch(/version/);
    g.world.connect(guest); g.world.handle(guest, { t: "hello", version: 1, agent: true });
    expect(guest.closed).toBe(true); expect(guest.last("error").msg).toMatch(/wallet/);
    const agent = new FakeConnection("wallet", "w:0x123");
    g.world.connect(agent); g.world.handle(agent, { t: "hello", version: 1, agent: true });
    expect(agent.agent).toBe(true); expect(agent.last("welcome")).toBeDefined();
    expect(g.world.stats().connections).toBe(1);
  });

  it("validates names, look and class, reserves names globally, and limits accounts to three characters", () => {
    const g = game(), c = g.open("w:owner"), other = g.open("w:other");
    for (const name of ["Ab", "9Frog", "Bad_Name", "x".repeat(17), " Frog", "Frog\n"]) create(g.world, c, name);
    g.world.handle(c, { t: "create", name: "Valid", cls: "reedguard", look: "broken" });
    g.world.handle(c, { t: "create", name: "Valid", cls: "constructor" as ClassId, look });
    expect(g.world.stats().characters).toBe(0);
    create(g.world, c, "O'Reed-1");
    expect(c.last("enter")).toMatchObject({ zone: "cistern", stats: { level: 1, hp: 120, hpMax: 120, xp: 0 }, quests: [], bag: [] });
    create(g.world, other, "o'reed-1");
    expect(other.last("error").msg).toMatch(/taken/);
    create(g.world, c, "Second Frog"); create(g.world, c, "Third Frog"); create(g.world, c, "Fourth Frog");
    expect(c.last("error").msg).toMatch(/three/); expect(g.world.stats().characters).toBe(3);
  });

  it("prevents playing another account and kicks the previous connection for the same character", () => {
    const frog = character(), g = game([frog]), first = g.play(frog), other = g.open("w:other");
    g.world.handle(other, { t: "play", charId: frog.id }); expect(other.all("enter")).toHaveLength(0);
    const second = g.play(frog);
    expect(first.closed).toBe(true); expect(second.last("enter").you).toBe(frog.id);
    g.world.disconnect(first);
    expect(g.world.stats().players).toBe(1);
    g.world.handle(first, { t: "say", text: "stale socket" }); expect(second.all("chat")).toHaveLength(0);
  });
});

describe("LASTSPAWN inventory and equipment", () => {
  it("swaps one item from a stack, merges displaced gear, and unequips back to the bag", () => {
    const frog = character("frog", { equip: { hands: "reed_bracers" },
      bag: [{ id: "leech_hide_wraps", n: 2 }, { id: "reed_bracers", n: 1 }] });
    const g = game([frog]), c = g.play(frog);
    g.world.handle(c, { t: "equip", item: "leech_hide_wraps" });
    expect(c.last("bag")).toEqual({ t: "bag", bag: [{ id: "leech_hide_wraps", n: 1 }, { id: "reed_bracers", n: 2 }],
      equip: { hands: "leech_hide_wraps" } });
    expect(c.last("stats").stats).toMatchObject({ armor: 4, power: 0 });
    g.world.handle(c, { t: "equip", item: "leech_hide_wraps" });
    expect(c.last("bag").bag).toEqual([{ id: "reed_bracers", n: 2 }, { id: "leech_hide_wraps", n: 1 }]);
    g.world.handle(c, { t: "unequip", slot: "hands" });
    expect(c.last("bag")).toEqual({ t: "bag", bag: [{ id: "reed_bracers", n: 2 }, { id: "leech_hide_wraps", n: 2 }], equip: {} });
    expect(c.last("stats").stats).toMatchObject({ armor: 0, power: 0 });
    expect(c.all("bag")).toHaveLength(3); expect(c.all("stats")).toHaveLength(3);
    g.world.handle(c, { t: "unequip", slot: "hands" });
    g.world.handle(c, { t: "unequip", slot: "constructor" as Slot });
    expect(c.all("error")).toHaveLength(2); expect(c.all("bag")).toHaveLength(3);
    g.world.save();
    const restored = new World({ dataDir: g.dir }), conn = new FakeConnection("restored", frog.account);
    restored.connect(conn); restored.handle(conn, { t: "hello", version: 1 }); restored.handle(conn, { t: "play", charId: frog.id });
    expect(conn.last("enter")).toMatchObject({ equip: {}, bag: c.last("bag").bag });
  });

  it("checks bag ownership, gear kind, slot, class and minimum level without consuming rejected gear", () => {
    const frog = character("frog", { bag: [{ id: "reed_blowgun", n: 1 }, { id: "glow_moss", n: 1 }, { id: "wend_cloak", n: 1 }] });
    const g = game([frog]), c = g.play(frog), cloak = ITEMS.wend_cloak!, level = cloak.level, slot = cloak.slot;
    for (const item of ["missing", "constructor", "shell_shield", "glow_moss", "reed_blowgun"]) g.world.handle(c, { t: "equip", item });
    expect(c.last("error").msg).toMatch(/class/);
    try {
      cloak.level = 2;
      g.world.handle(c, { t: "equip", item: "wend_cloak" });
      expect(c.last("error").msg).toMatch(/level/);
      cloak.level = undefined; cloak.slot = undefined;
      g.world.handle(c, { t: "equip", item: "wend_cloak" });
      expect(c.all("error")).toHaveLength(7); expect(c.all("bag")).toEqual([]); expect(c.all("stats")).toEqual([]);
      g.world.handle(c, { t: "play", charId: frog.id });
      expect(c.last("enter")).toMatchObject({ bag: frog.bag, equip: {} });
      cloak.slot = slot;
      g.world.handle(c, { t: "equip", item: "wend_cloak" });
      expect(c.last("bag").equip).toEqual({ shoulders: "wend_cloak" });
      expect(c.last("stats").stats).toMatchObject({ armor: 5, power: 2 });
    } finally { cloak.level = level; cloak.slot = slot; }
    const veteran = character("veteran", { level: 2, bag: [{ id: "wend_cloak", n: 1 }] });
    const eligible = game([veteran]), v = eligible.play(veteran);
    try {
      cloak.level = 2;
      eligible.world.handle(v, { t: "equip", item: "wend_cloak" });
      expect(v.last("bag")).toMatchObject({ equip: { shoulders: "wend_cloak" }, bag: [] });
    } finally { cloak.level = level; }
  });

  it("uses glow moss one at a time, caps healing, and broadcasts the use event nearby", () => {
    const frog = character("frog", { hp: 80, bag: [{ id: "glow_moss", n: 2 }] }), peer = character("peer");
    const g = game([frog, peer]), c = g.play(frog), observer = g.play(peer);
    g.world.handle(c, { t: "use", item: "glow_moss" });
    expect(c.last("stats").stats).toMatchObject({ hp: 110, armor: 0, power: 0 });
    expect(c.last("bag")).toEqual({ t: "bag", bag: [{ id: "glow_moss", n: 1 }], equip: {} });
    expect(observer.events("hit")).toContainEqual(expect.objectContaining({ src: frog.id, dst: frog.id, kind: "heal", ability: "use", amount: 30 }));
    g.world.handle(c, { t: "use", item: "glow_moss" });
    expect(c.last("stats").stats.hp).toBe(120); expect(c.last("bag").bag).toEqual([]);
    expect(c.events("hit").at(-1)).toMatchObject({ kind: "heal", ability: "use", amount: 10 });
    g.world.handle(c, { t: "use", item: "glow_moss" });
    expect(c.last("error")).toBeDefined(); expect(c.all("stats")).toHaveLength(2); expect(c.all("bag")).toHaveLength(2);
  });

  it("rejects use of missing items, gear, junk, and consumables while dead", () => {
    const frog = character("frog", { hp: 1, bag: [{ id: "leech_hide_wraps", n: 1 }, { id: "leech_tooth", n: 1 }, { id: "glow_moss", n: 1 }] });
    const g = game([frog]), c = g.play(frog);
    for (const item of ["missing", "constructor", "egg_jelly", "leech_hide_wraps", "leech_tooth"]) g.world.handle(c, { t: "use", item });
    expect(c.all("error")).toHaveLength(5); expect(c.all("bag")).toEqual([]);
    approachMob(g, c, frog, leech.reach / 2); g.advance(leech.swingMs + 100);
    expect(c.last("stats").stats.hp).toBe(0);
    c.clear(); g.world.handle(c, { t: "use", item: "glow_moss" });
    expect(c.last("error").msg).toMatch(/dead/); expect(c.all("stats")).toEqual([]); expect(c.all("bag")).toEqual([]);
    g.world.save(); expect((JSON.parse(readFileSync(g.file, "utf8")) as Character[])[0]!.bag).toEqual(frog.bag);
  });

  it("sends worn models in slot order, including sparse changes and removing the last piece", () => {
    const frog = character("frog", { zone: "hollowmere", ...at("hollowmere", 100, -100),
      equip: { hands: "reed_bracers", chest: "shell_vest", main: "reed_glaive", off: "shell_shield" }, bag: [{ id: "leech_hide_wraps", n: 1 }] });
    const peer = character("peer", { zone: frog.zone, ...at(frog.zone, 101, -100) });
    const g = game([frog, peer]), c = g.play(frog), observer = g.play(peer);
    g.world.tick();
    for (const conn of [c, observer]) expect(conn.last("snap").ents.find((e) => e.id === frog.id)?.gear).toBe("glaive,shield,shell_vest,reed_bracers");
    g.world.handle(c, { t: "equip", item: "leech_hide_wraps" }); g.world.tick();
    expect(observer.last("snap").ents.find((e) => e.id === frog.id)).toEqual({ id: frog.id, k: "player", ...at(frog.zone, 100, -100), gear: "glaive,shield,shell_vest,leech_wraps" });
    for (const slot of ["main", "off", "chest", "hands"] as const) g.world.handle(c, { t: "unequip", slot });
    g.world.tick(); expect(observer.last("snap").ents.find((e) => e.id === frog.id)?.gear).toBe("");
    g.world.tick(); expect(observer.last("snap").ents).toEqual([]);
  });

  it.each([
    { hands: "missing" }, { hands: "glow_moss" }, { main: "reed_bracers" }, { main: "reed_blowgun" }, { invalid: "reed_bracers" }, null,
  ])("rejects invalid persisted equipment: %j", (equip) => {
    const frog = character(), g = game([{ ...frog, equip: equip as Equip }]);
    expect(g.world.stats().characters).toBe(0); expect(existsSync(`${g.file}.bad`)).toBe(true);
  });
});

describe("LASTSPAWN movement and snapshots", () => {
  it("accepts legal moves and corrects speed, floor, bounds and stale sequences without changing ack", () => {
    const frog = character(), g = game([frog]), c = g.play(frog);
    g.clock(1000); g.move(c, "cistern", 2, 0);
    expect(g.snap(c).ack).toBe(1);
    const pose = c.last("snap").ents.find((e) => e.id === frog.id)!;
    expect(pose.x).toBe(2); expect(pose.y).toBe(floorAt("cistern", 2, 0).y);
    g.move(c, "cistern", 11, 0); expect(c.last("correct")).toMatchObject({ x: 2, seq: 2 });
    g.clock(1000); g.move(c, "cistern", 3, 0, 20); expect(c.last("correct").seq).toBe(3);
    g.clock(10000); g.move(c, "cistern", 99, 0); expect(c.last("correct").seq).toBe(4);
    g.world.handle(c, { t: "move", seq: 1, ...at("cistern", 1, 0), anim: "run" });
    expect(c.last("correct").seq).toBe(1); expect(g.snap(c).ack).toBe(1);
  });

  it("caps elapsed movement time at one second and uses swimming speed", () => {
    const frog = character(), g = game([frog]), c = g.play(frog);
    g.clock(60000); g.move(c, "cistern", 5, 0);
    expect(c.last("correct").x).toBe(0);
    g.move(c, "cistern", 4, 0);
    expect(g.snap(c).ack).toBe(2);
  });

  it("crosses portals and waits for a player to leave an arrival portal before crossing again", () => {
    const top = ZONES.cistern.portals[0]!, start = at("cistern", top.at.x + 2, top.at.z);
    const frog = character("frog", start), g = game([frog]), c = g.play(frog);
    g.world.tick(); c.clear(); g.clock(1000); g.move(c, "cistern", top.at.x, top.at.z);
    expect(c.last("enter").zone).toBe("hollowmere");
    expect(c.last("correct")).toMatchObject(top.arrive);
    const arrived = g.snap(c);
    expect(arrived.gone).toContain(npcWend);
    expect(arrived.ents.find((e) => e.id === frog.id)).toMatchObject({ name: frog.name, look });
    const back = ZONES.hollowmere.portals[0]!;
    g.walk(c, "hollowmere", top.arrive, back.at);
    expect(c.last("enter").zone).toBe("cistern");
    const count = c.all("enter").length;
    g.advance(2000); expect(c.all("enter")).toHaveLength(count);
  });

  it("leaps six units, clamps to bounds and floor, and applies a four-second cooldown", () => {
    const frog = character("frog", at("cistern", 9, 0)), g = game([frog]), c = g.play(frog);
    g.world.handle(c, { t: "leap", ry: Math.PI / 2 });
    const landing = c.last("correct");
    expect(landing.x).toBeCloseTo(11.6); expect(landing.y).toBe(floorAt("cistern", landing.x, landing.z).y);
    expect(c.events("aura")).toContainEqual(expect.objectContaining({ aura: "leaping", on: true, ms: 600 }));
    g.world.handle(c, { t: "leap", ry: Math.PI }); expect(c.last("error").msg).toMatch(/cooldown/);
    g.clock(4000); cast(g.world, c, "leap"); expect(c.all("correct")).toHaveLength(2);
  });

  it("applies the speed multiplier from reedfade when checking moves", () => {
    const frog = character("frog", { cls: "dartsinger", ...at("cistern", 6, -3) }), g = game([frog]), c = g.play(frog);
    cast(g.world, c, "reedfade"); g.clock(1000); g.move(c, "cistern", 6, 4);
    expect(c.last("correct")).toMatchObject({ x: 6, z: -3, seq: 1 });
    g.move(c, "cistern", 6, 3); expect(g.snap(c).ack).toBe(2);
  });

  it("sends full entities once, empty stable snapshots, sparse changes, gone and a full reappearance", () => {
    const frog = character("frog", { zone: "hollowmere", ...at("hollowmere", 100, -100) });
    const other = character("other", { zone: "hollowmere", ...at("hollowmere", 101, -100) });
    const g = game([frog, other]), c = g.play(frog), peer = g.play(other);
    const initial = g.snap(c);
    expect(initial.ents.find((e) => e.id === other.id)).toMatchObject({ name: "Other", look, cls: "reedguard", hp: 120, agent: false });
    expect(g.snap(c).ents).toEqual([]);
    g.world.handle(c, { t: "play", charId: frog.id });
    expect(g.snap(c).ents.find((e) => e.id === other.id)?.name).toBe("Other");
    g.clock(1000); g.move(peer, "hollowmere", 102, -100);
    const changed = g.snap(c).ents.find((e) => e.id === other.id)!;
    expect(changed).toEqual({ id: other.id, k: "player", ...at("hollowmere", 102, -100), anim: "run" });
    expect(changed.name).toBeUndefined(); expect(changed.hp).toBeUndefined();
    g.walk(peer, "hollowmere", at("hollowmere", 102, -100), at("hollowmere", 165, -100));
    expect(g.snap(c).gone).toContain(other.id);
    g.walk(peer, "hollowmere", at("hollowmere", 165, -100), at("hollowmere", 102, -100));
    expect(g.snap(c).ents.find((e) => e.id === other.id)?.name).toBe("Other");
    g.world.disconnect(peer); expect(g.snap(c).gone).toContain(other.id);
  });
});

describe("LASTSPAWN combat", () => {
  it("reduces swings and periodic latch damage by the total worn armor", () => {
    const run = (equip: Equip) => {
      const frog = character("frog", { equip }), g = game([frog]), c = g.play(frog);
      approachMob(g, c, frog, leech.reach / 2); g.advance(2 * leech.swingMs + 1100);
      return { conn: c, damage: c.events("hit").filter((e) => e.kind === "dmg" && e.dst === frog.id) };
    };
    const bare = run({}), armored = run({ off: "shell_shield", chest: "shell_vest", hands: "reed_bracers" });
    expect(armored.conn.last("enter").stats).toMatchObject({ armor: 25, power: 0 });
    expect(bare.damage.some((e) => e.ability === "latch")).toBe(true);
    expect(armored.damage).toHaveLength(bare.damage.length);
    armored.damage.forEach((hit, i) => expect(hit.amount).toBeCloseTo(bare.damage[i]!.amount * ARMOR_K / (25 + ARMOR_K)));
    expect(armored.conn.all("stats").every((m) => m.stats.armor === 25 && m.stats.power === 0)).toBe(true);
  });

  it("adds worn power to direct and periodic damage", () => {
    const run = (equip: Equip) => {
      const frog = character("frog", { cls: "dartsinger", equip }), g = game([frog]), c = g.play(frog);
      approachMob(g, c, frog, leech.aggro + 1);
      cast(g.world, c, "venom_dart", leechId); g.advance(2000); cast(g.world, c, "dart", leechId);
      return c;
    };
    const bare = run({}), powered = run({ main: "reed_blowgun", shoulders: "wend_cloak" });
    expect(powered.last("enter").stats).toMatchObject({ armor: 5, power: 7 });
    const damage = powered.events("hit").filter((e) => e.kind === "dmg"), baseline = bare.events("hit").filter((e) => e.kind === "dmg");
    expect(damage).toHaveLength(4);
    damage.forEach((hit, i) => expect(hit.amount).toBeCloseTo(baseline[i]!.amount * 1.07));
  });

  it("adds the healer's worn power to healing spells and consumables", () => {
    const healer = character("healer", { cls: "lampwright", hp: 40, zone: "hollowmere", ...at("hollowmere", 100, -100),
      equip: { off: "firefly_lantern", shoulders: "wend_cloak" }, bag: [{ id: "glow_moss", n: 1 }] });
    const friend = character("friend", { hp: 30, zone: healer.zone, ...at(healer.zone, 101, -100), equip: { main: "reed_glaive" } });
    const g = game([healer, friend]), c = g.play(healer), f = g.play(friend);
    cast(g.world, c, "mending_glow", friend.id); g.advance(ABILITIES.mending_glow!.castMs);
    const healed = f.events("hit").find((e) => e.ability === "mending_glow" && e.kind === "heal")!;
    expect(healed.amount).toBeCloseTo(21 * 1.08);
    g.world.handle(c, { t: "use", item: "glow_moss" });
    expect(c.events("hit").find((e) => e.ability === "use")!.amount).toBeCloseTo(30 * 1.08);
    expect(c.last("stats").stats).toMatchObject({ armor: 5, power: 8 });
  });

  it("checks class, target, range, cooldown and GCD before dealing damage", () => {
    const frog = character(), g = game([frog]), c = g.play(frog);
    approachMob(g, c, frog, leech.reach / 2);
    cast(g.world, c, "dart", leechId); expect(c.last("error").msg).toMatch(/know/);
    cast(g.world, c, "thrust", frog.id); expect(hits(c, "thrust")).toHaveLength(0);
    cast(g.world, c, "challenge_croak", leechId);
    cast(g.world, c, "thrust", leechId); expect(hits(c, "thrust")).toHaveLength(0);
    g.clock(GCD_MS); cast(g.world, c, "thrust", leechId);
    expect(hits(c, "thrust")[0]!.amount).toBeGreaterThanOrEqual(ABILITIES.thrust!.amount![0]);
    expect(hits(c, "thrust")[0]!.amount).toBeLessThanOrEqual(ABILITIES.thrust!.amount![1]);
    cast(g.world, c, "thrust", leechId); expect(hits(c, "thrust")).toHaveLength(1);
    g.clock(GCD_MS); cast(g.world, c, "challenge_croak", leechId); expect(c.last("error").msg).toMatch(/ready/);
    const farFrog = character("far"), far = game([farFrog]), f = far.play(farFrog);
    approachMob(far, f, farFrog, ABILITIES.thrust!.range + 2);
    cast(far.world, f, "thrust", leechId); expect(f.events("miss")).toContainEqual(expect.objectContaining({ why: "range" }));
    expect(hits(f, "thrust")).toHaveLength(0);
  });

  it("rolls bounded damage and reproducible critical hits using a seeded random source", () => {
    const run = () => {
      const frog = character("frog", { cls: "dartsinger" }), g = game([frog]), c = g.play(frog);
      approachMob(g, c, frog, leech.aggro + 1);
      g.random(seeded(1));
      for (let i = 0; i < 3; i++) { cast(g.world, c, "dart", leechId); g.clock(GCD_MS); }
      return hits(c, "dart").map(({ amount, crit }) => ({ amount, crit }));
    };
    const rolls = run(); expect(rolls).toEqual(run()); expect(rolls).toHaveLength(3);
    expect(rolls.some((r) => r.crit)).toBe(true);
    for (const roll of rolls) {
      expect(roll.amount).toBeGreaterThanOrEqual(ABILITIES.dart!.amount![0] * (roll.crit ? 1.5 : 1));
      expect(roll.amount).toBeLessThanOrEqual(ABILITIES.dart!.amount![1] * (roll.crit ? 1.5 : 1));
    }
  });

  it("completes casts and interrupts movement and death of a target", () => {
    const frog = character("frog", { cls: "lampwright" }), g = game([frog]), c = g.play(frog);
    const { spot } = approachMob(g, c, frog, leech.aggro + 1), moved = at("cistern", spot.x, spot.z - 1);
    cast(g.world, c, "kindle", leechId);
    expect(c.events("cast")[0]).toMatchObject({ ability: "kindle", ms: ABILITIES.kindle!.castMs });
    g.advance(ABILITIES.kindle!.castMs - 100); expect(hits(c, "kindle")).toHaveLength(0);
    g.advance(100); expect(hits(c, "kindle")).toHaveLength(1);
    cast(g.world, c, "kindle", leechId); g.clock(1000); g.move(c, "cistern", moved.x, moved.z);
    g.advance(2000); expect(hits(c, "kindle")).toHaveLength(1);
    cast(g.world, c, "kindle", leechId);
    g.clock(1000); g.move(c, "cistern", moved.x, moved.z, moved.y + 1);
    g.advance(2000); expect(hits(c, "kindle")).toHaveLength(1);
    const killer = character("killer", { cls: "dartsinger", level: 10 });
    // A second World with both characters lets the target die while the first caster is busy.
    const both = game([frog, killer]), caster = both.play(frog), attacker = both.play(killer);
    const { spot: castingSpot } = approachMob(both, caster, frog, leech.aggro + 1);
    both.walk(attacker, "cistern", killer, castingSpot);
    cast(both.world, caster, "kindle", leechId);
    both.random(() => 0); cast(both.world, attacker, "dart", leechId); both.clock(1000); cast(both.world, attacker, "dart", leechId);
    both.advance(1000); expect(hits(caster, "kindle")).toHaveLength(0);
  });

  it("heals friends to their maximum, absorbs hits, and applies damage reduction", () => {
    const healer = character("healer", { cls: "lampwright" });
    const tank = character("tank", { hp: 30 });
    const g = game([healer, tank]), h = g.play(healer), t = g.play(tank);
    const { spot } = approachMob(g, t, tank, leech.reach / 2);
    g.walk(h, "cistern", healer, spot);
    cast(g.world, h, "lantern_ward", tank.id);
    cast(g.world, t, "shell_wall");
    cast(g.world, t, "challenge_croak", leechId);
    g.advance(GCD_MS); cast(g.world, h, "mending_glow", tank.id); g.advance(ABILITIES.mending_glow!.castMs);
    expect(h.events("hit").some((e) => e.kind === "heal" && e.dst === tank.id)).toBe(true);
    expect(t.last("stats").stats.hp).toBeLessThanOrEqual(CLASSES[tank.cls].hp + CLASSES[tank.cls].hpPerLevel * (tank.level - 1));
    g.advance(3000);
    const absorbed = t.events("hit").filter((e) => e.kind === "absorb" && e.dst === tank.id);
    expect(absorbed.length).toBeGreaterThan(0); expect(absorbed.every((e) => e.amount <= leech.dmg[1])).toBe(true);
  });

  it("rejects a heal when its target moves out of range before it completes", () => {
    const healer = character("healer", { cls: "lampwright", zone: "hollowmere", ...at("hollowmere", 100, -100) });
    const friend = character("friend", { hp: 30, zone: "hollowmere", ...at("hollowmere", 125, -100) });
    const g = game([healer, friend]), c = g.play(healer), f = g.play(friend);
    cast(g.world, c, "mending_glow", friend.id);
    g.clock(1000); g.move(f, "hollowmere", 130, -100); g.clock(800); g.world.tick();
    expect(c.events("hit").filter((e) => e.kind === "heal")).toEqual([]);
    expect(c.events("miss")).toContainEqual(expect.objectContaining({ why: "range", ability: "mending_glow" }));
  });

  it("adds healing threat and forces a taunted mob to attack the caster until the aura expires", () => {
    const tank = character("tank", { hp: 30 });
    const healer = character("healer", { cls: "lampwright" });
    const g = game([tank, healer]), t = g.play(tank), h = g.play(healer);
    const { spot } = approachMob(g, t, tank, leech.reach / 2);
    g.walk(h, "cistern", healer, spot);
    cast(g.world, t, "thrust", leechId);
    for (let i = 0; i < 2; i++) { cast(g.world, h, "mending_glow", tank.id); g.clock(ABILITIES.mending_glow!.castMs); g.world.tick(); }
    expect(h.last("snap").ents.find((e) => e.id === leechId)?.tgt).toBe(healer.id);
    cast(g.world, t, "challenge_croak", leechId); g.world.tick();
    expect(h.last("snap").ents.find((e) => e.id === leechId)?.tgt).toBe(tank.id);
    g.clock(ABILITIES.challenge_croak!.aura!.ms + 100); g.world.tick();
    expect(h.last("snap").ents.find((e) => e.id === leechId)?.tgt).toBe(healer.id);
  });

  it("ticks poison each second through its duration and holds a rooted mob still", () => {
    const frog = character("frog", { cls: "dartsinger" }), g = game([frog]), c = g.play(frog);
    approachMob(g, c, frog, leech.aggro + 1);
    const venom = ABILITIES.venom_dart!.aura!;
    cast(g.world, c, "venom_dart", leechId); g.advance(venom.ms);
    expect(hits(c, "venom_dart").filter((e) => e.amount === venom.dps)).toHaveLength(venom.ms / 1000);
    expect(c.events("aura")).toContainEqual({ k: "aura", dst: leechId, aura: "venom", on: false });
    const pinnedFrog = character("pinned", { cls: "dartsinger" });
    const rooted = game([pinnedFrog]), r = rooted.play(pinnedFrog);
    approachMob(rooted, r, pinnedFrog, (leech.reach + leech.aggro) / 2);
    cast(rooted.world, r, "pinning_dart", leechId);
    const start = rooted.snap(r).ents.find((e) => e.id === leechId)!;
    rooted.advance(ABILITIES.pinning_dart!.aura!.ms - 1000);
    expect(r.all("snap").flatMap((s) => s.ents).filter((e) => e.id === leechId).every((e) => e.x === start.x && e.z === start.z)).toBe(true);
    rooted.advance(1000);
    expect(r.all("snap").flatMap((s) => s.ents).filter((e) => e.id === leechId).at(-1)!.z).toBeLessThan(start.z);
  });

  it("dodges incoming swings while leaping and applies fractional latch ticks", () => {
    const frog = character(), g = game([frog]), c = g.play(frog);
    approachMob(g, c, frog, leech.reach / 2);
    g.advance(2 * leech.swingMs);
    expect(c.events("aura").some((e) => e.aura === "latched")).toBe(false);
    g.advance(100);
    expect(c.events("aura").some((e) => e.aura === "latched" && e.on)).toBe(true);
    g.advance(1000);
    expect(hits(c, "latch").some((e) => e.amount === 1.5)).toBe(true);
    g.advance(leech.swingMs - 1000 - 500);
    g.world.handle(c, { t: "leap", ry: 0 });
    const latch = hits(c, "latch").length;
    g.advance(500); expect(hits(c, "latch")).toHaveLength(latch);
    expect(c.events("miss").some((e) => e.why === "dodge")).toBe(true);
  });

  it("awards loot and xp to the most damaging player, levels and respawns mobs", () => {
    const frog = character("frog", { cls: "dartsinger", xp: xpNext(1) - 1, level: 1 });
    const g = game([frog], () => 0), c = g.play(frog);
    const { mob: spawned } = approachMob(g, c, frog, leech.aggro + 1);
    const hp = leech.hp + leech.hpPerLevel * (spawned.level! - 1), xp = Math.round(leech.xp * spawned.level! / 1.5);
    for (let i = 0; i < Math.ceil(hp / (ABILITIES.dart!.amount![0] * 1.5)); i++) { cast(g.world, c, "dart", leechId); g.clock(GCD_MS); }
    expect(c.events("die").some((e) => e.id === leechId)).toBe(true);
    expect(g.snap(c).ents.find((e) => e.id === leechId)!.hp).toBe(0);
    expect(c.events("xp")[0]!.amount).toBe(xp);
    expect(c.events("level")).toContainEqual(expect.objectContaining({ id: frog.id, level: 2 }));
    const hpMax = CLASSES[frog.cls].hp + CLASSES[frog.cls].hpPerLevel;
    expect(c.last("stats").stats).toMatchObject({ level: 2, xp: frog.xp + xp - xpNext(frog.level), hp: hpMax, hpMax });
    expect(c.last("bag")).toEqual({ t: "bag", bag: [{ id: "leech_tooth", n: 1 }, { id: "egg_jelly", n: 1 }, { id: "leech_hide_wraps", n: 1 }], equip: {} });
    g.clock(leech.respawnMs); const mob = g.snap(c).ents.find((e) => e.id === leechId)!;
    expect(mob.hp).toBe(hp);
  });
});

describe("LASTSPAWN mob behavior", () => {
  it("aggroes, chases on the floor, swings, then heals and leashes when the player leaves", () => {
    const frog = character(), g = game([frog]), c = g.play(frog);
    const { mob: home } = approachMob(g, c, frog, (leech.reach + leech.aggro) / 2);
    const initial = g.snap(c).ents.find((e) => e.id === leechId)!;
    expect(initial.tgt).toBe(frog.id); expect(initial.anim).toBe("run");
    expect(initial.y).toBe(floorAt("cistern", initial.x, initial.z).y);
    g.advance(leech.swingMs + 1000);
    expect(c.events("hit").some((e) => e.src === leechId && e.dst === frog.id)).toBe(true);
    cast(g.world, c, "thrust", leechId); expect(hits(c, "thrust")).toHaveLength(1);
    const observer = character("watcher", { ...at("cistern", -home.x, ZONES.cistern.spawn.z), cls: "dartsinger" });
    // Observe the same damaged mob from a second account after its original target leaves.
    const watch = g.open(observer.account); create(g.world, watch, "Watcher", "dartsinger");
    g.walk(watch, "cistern", ZONES.cistern.spawn, observer);
    g.world.disconnect(c); g.world.tick();
    const leashing = watch.last("snap").ents.find((e) => e.id === leechId)!;
    expect(leashing.hp).toBe(leashing.hpMax); expect(leashing.tgt).toBeNull();
    cast(g.world, watch, "dart", leechId);
    expect(watch.events("miss").some((e) => e.why === "immune")).toBe(true);
    g.advance(4000);
    const last = watch.all("snap").flatMap((m) => m.ents).filter((e) => e.id === leechId).at(-1)!;
    expect(last.x).toBeCloseTo(home.x); expect(last.z).toBeCloseTo(home.z);
  });

  it("respawns a dead player at the zone spawn after five seconds with half health", () => {
    const frog = character("frog", { hp: 1 }), g = game([frog]), c = g.play(frog);
    approachMob(g, c, frog, leech.reach / 2);
    g.advance(leech.swingMs + 100); expect(c.events("die").some((e) => e.id === frog.id)).toBe(true);
    const corrections = c.all("correct").length;
    g.advance(4900); expect(c.all("correct")).toHaveLength(corrections);
    g.advance(100); expect(c.last("correct")).toMatchObject(ZONES.cistern.spawn);
    expect(c.last("stats").stats.hp).toBe((CLASSES[frog.cls].hp + CLASSES[frog.cls].hpPerLevel * (frog.level - 1)) / 2);
  });

  it("regenerates four percent per second only after five seconds out of combat", () => {
    const frog = character("frog", { hp: 50, zone: "hollowmere", ...at("hollowmere", 100, -100) }), g = game([frog]), c = g.play(frog);
    g.advance(1000); expect(c.last("stats").stats.hp).toBeCloseTo(54.8);
    const fighter = character("fighter", { hp: 50, level: 10, ...at("cistern", leechCamp.at.x, leechCamp.at.z) });
    const combat = game([fighter], () => 0), f = combat.play(fighter);
    cast(combat.world, f, "leap_slam", leechId);
    expect(f.events("die").filter((e) => e.id.startsWith("mob:")).length).toBe(leechCamp.count);
    combat.advance(4900); expect(f.last("stats").stats.hp).toBe(50);
    const hpMax = CLASSES[fighter.cls].hp + CLASSES[fighter.cls].hpPerLevel * (fighter.level - 1);
    combat.advance(200); expect(f.last("stats").stats.hp).toBeCloseTo(fighter.hp + 2 * hpMax * 0.04 / TICK_HZ);
  });

  it("ignores stealthed players until they attack, retains existing aggro, and breaks stealth on swarm hits", () => {
    const frog = character("frog", { cls: "dartsinger" }), g = game([frog]), c = g.play(frog);
    approachMob(g, c, frog, (leech.reach + leech.aggro) / 2);
    g.world.handle(c, { t: "play", charId: frog.id });
    cast(g.world, c, "reedfade"); g.world.tick();
    expect(c.last("snap").ents.filter((e) => e.mob)).toHaveLength(leechCamp.count);
    expect(c.last("snap").ents.filter((e) => e.mob).every((e) => e.tgt === null)).toBe(true);
    cast(g.world, c, "dart", leechId); g.world.tick();
    expect(c.events("aura")).toContainEqual({ k: "aura", dst: frog.id, aura: "reedfade", on: false });
    expect(c.last("snap").ents.find((e) => e.id === leechId)?.tgt).toBe(frog.id);
    g.clock(ABILITIES.reedfade!.cooldownMs); cast(g.world, c, "reedfade"); g.world.tick();
    expect(c.last("snap").ents.find((e) => e.id === leechId)?.tgt).not.toBeNull();
    const swarmFrog = character("swarm", { cls: "dartsinger", zone: "hollowmere", ...at("hollowmere", 14, 70) });
    const swarmGame = game([swarmFrog], () => 0), s = swarmGame.play(swarmFrog);
    swarmGame.world.tick(); cast(swarmGame.world, s, "reedfade"); swarmGame.advance(1100);
    expect(s.events("aura")).toContainEqual({ k: "aura", dst: swarmFrog.id, aura: "reedfade", on: false });
  });

  it("reduces hits against a snapper's front until flipped", () => {
    const camp = { mob: "snapper", at: at("hollowmere", 100, 100), spread: 0, count: 1 };
    const frog = character("frog", { zone: "hollowmere", ...at("hollowmere", 100, 102) });
    ZONES.hollowmere.camps.push(camp);
    let g: ReturnType<typeof game>;
    try { g = game([frog]); } finally { ZONES.hollowmere.camps.pop(); }
    const c = g.play(frog), id = "mob:hollowmere:4:0";
    cast(g.world, c, "thrust", id); expect(hits(c, "thrust")[0]!.amount).toBe(4);
    g.clock(1000); cast(g.world, c, "tongue", id);
    g.clock(1000); cast(g.world, c, "thrust", id); expect(hits(c, "thrust")[1]!.amount).toBe(10);
    g.clock(5000); cast(g.world, c, "thrust", id); expect(hits(c, "thrust")[2]!.amount).toBe(4);
  });

  it("pulls light mobs, anchors to heavy mobs and flips snappers, but cannot tongue swarms", () => {
    const camp = { mob: "snapper", at: at("hollowmere", 100, 100), spread: 0, count: 1 };
    ZONES.hollowmere.camps.push(camp);
    let g: ReturnType<typeof game>;
    const frog = character("frog", { zone: "hollowmere", ...at("hollowmere", 100, 107) });
    try { g = game([frog]); } finally { ZONES.hollowmere.camps.pop(); }
    const heavy = g.play(frog), snapperId = "mob:hollowmere:4:0";
    cast(g.world, heavy, "tongue", snapperId);
    expect(heavy.last("correct")).toMatchObject(at("hollowmere", 100, 102));
    expect(heavy.events("aura")).toContainEqual(expect.objectContaining({ dst: snapperId, aura: "flipped", ms: 6000 }));
    const lightFrog = character("light"), lightGame = game([lightFrog]), light = lightGame.play(lightFrog);
    const { spot } = approachMob(lightGame, light, lightFrog, (leech.reach + leech.aggro) / 2);
    cast(lightGame.world, light, "tongue", leechId);
    const pulled = lightGame.snap(light).ents.find((e) => e.id === leechId)!;
    expect(pulled.x).toBeCloseTo(spot.x); expect(pulled.z).toBeCloseTo(spot.z + 1.8);
    const swarmFrog = character("swarm", { zone: "hollowmere", ...at("hollowmere", 14, 65) });
    const swarmGame = game([swarmFrog], () => 0), swarm = swarmGame.play(swarmFrog);
    cast(swarmGame.world, swarm, "tongue", "mob:hollowmere:1:0");
    expect(swarm.events("miss")).toContainEqual(expect.objectContaining({ ability: "tongue", why: "immune" }));
  });

  it("aggroes a rat camp together and lets a badly hurt rat flee only once", () => {
    const frog = character("frog", { cls: "dartsinger", zone: "hollowmere", ...at("hollowmere", -18, 92) });
    const g = game([frog], () => 0), c = g.play(frog), ratId = "mob:hollowmere:2:0";
    g.world.tick();
    expect(c.last("snap").ents.filter((e) => e.mob === "reed_rat" && e.tgt === frog.id)).toHaveLength(3);
    for (let i = 0; i < 5; i++) { cast(g.world, c, "dart", ratId); g.clock(1000); }
    g.world.tick(); const start = c.last("snap").ents.find((e) => e.id === ratId)!;
    g.advance(1000);
    const fleeing = c.all("snap").flatMap((s) => s.ents).filter((e) => e.id === ratId).at(-1)!;
    expect(fleeing.z).toBeGreaterThan(start.z);
    g.advance(3100);
    const returning = c.all("snap").flatMap((s) => s.ents).filter((e) => e.id === ratId).at(-1)!;
    expect(returning.z).toBeLessThan(fleeing.z + 1);
  });
});

describe("LASTSPAWN quests, chat and persistence", () => {
  it("finishes first_breath, the_jelly and up_the_stairs with loot, NPC options and persisted done flags", () => {
    const start = at("cistern", leechCamp.at.x, leechCamp.at.z), wend = ZONES.cistern.npcs[0]!.at;
    const frog = character("frog", start), g = game([frog], () => 0), c = g.play(frog);
    g.world.handle(c, { t: "quest", action: "accept", id: "the_jelly" }); expect(c.all("quests")).toHaveLength(0);
    g.walk(c, "cistern", start, wend); g.world.tick();
    expect(c.last("snap").ents.find((e) => e.id === npcWend)?.mark).toBe("!");
    g.world.handle(c, { t: "interact", id: npcWend });
    expect(c.last("dialog").options.map((o) => o.id)).toEqual(["accept:first_breath", "bye"]);
    g.world.handle(c, { t: "choose", npc: npcWend, option: "accept:first_breath" });
    g.walk(c, "cistern", wend, start);
    for (let n = 0; n < leechCamp.count; n++) {
      const hp = leech.hp + leech.hpPerLevel * (leech.level[0] - 1);
      for (let hit = 0; hit < Math.ceil(hp / (ABILITIES.thrust!.amount![0] * 1.5)); hit++) { cast(g.world, c, "thrust", `mob:cistern:0:${n}`); g.clock(GCD_MS); }
    }
    expect(c.last("quests").quests[0]).toMatchObject({ id: "first_breath", progress: [3], done: true });
    g.walk(c, "cistern", start, wend); g.world.tick();
    expect(c.last("snap").ents.find((e) => e.id === npcWend)?.mark).toBe("?");
    g.world.handle(c, { t: "interact", id: npcWend });
    g.world.handle(c, { t: "choose", npc: npcWend, option: "turnin:first_breath" });
    expect(c.last("stats").stats.level).toBe(2);
    expect(c.last("bag").bag).toContainEqual({ id: "glow_moss", n: 2 });
    g.world.handle(c, { t: "quest", action: "accept", id: "the_jelly" });
    expect(c.last("quests").quests[0]).toMatchObject({ progress: [3], done: true });
    g.world.handle(c, { t: "quest", action: "turnin", id: "the_jelly" });
    expect(c.last("bag").bag.some((s) => s.id === "egg_jelly")).toBe(false);
    expect(c.last("bag").bag).toContainEqual({ id: "wend_cloak", n: 1 });
    expect(c.last("bag").equip).toEqual({});
    g.world.handle(c, { t: "quest", action: "accept", id: "up_the_stairs" });
    const portal = ZONES.cistern.portals[0]!;
    g.walk(c, "cistern", wend, portal.at); expect(c.last("enter").zone).toBe("hollowmere");
    const cress = ZONES.hollowmere.npcs[0]!;
    g.walk(c, "hollowmere", portal.arrive, cress.at);
    g.world.handle(c, { t: "interact", id: cress.id });
    expect(c.last("quests").quests[0]).toMatchObject({ id: "up_the_stairs", done: true });
    expect(c.last("dialog").options.map((o) => o.id)).toContain("turnin:up_the_stairs");
    g.world.handle(c, { t: "choose", npc: c.last("dialog").npc, option: "turnin:up_the_stairs" });
    expect(c.last("quests").quests).toEqual([]);
    g.world.disconnect(c);
    const saved = JSON.parse(readFileSync(g.file, "utf8")) as Character[];
    expect(saved[0]!.flags).toEqual({ "quest:first_breath": "done", "quest:the_jelly": "done", "quest:up_the_stairs": "done" });
  });

  it("rejects remote or forged dialog choices and permits abandoning a quest", () => {
    const frog = character("frog", at("cistern", 3.4, -5.4)), g = game([frog]), c = g.play(frog);
    g.world.handle(c, { t: "choose", npc: npcWend, option: "accept:first_breath" }); expect(c.all("quests")).toHaveLength(0);
    g.world.handle(c, { t: "interact", id: npcWend });
    g.world.handle(c, { t: "choose", npc: npcWend, option: "accept:the_jelly" }); expect(c.all("quests")).toHaveLength(0);
    g.world.handle(c, { t: "quest", action: "accept", id: "first_breath" });
    g.world.handle(c, { t: "quest", action: "turnin", id: "first_breath" }); expect(c.last("error").msg).toMatch(/not complete/);
    g.world.handle(c, { t: "quest", action: "abandon", id: "first_breath" }); expect(c.last("quests").quests).toEqual([]);
    g.world.handle(c, { t: "interact", id: npcWend }); g.world.handle(c, { t: "choose", npc: npcWend, option: "bye" });
    g.world.handle(c, { t: "choose", npc: npcWend, option: "accept:first_breath" }); expect(c.last("quests").quests).toEqual([]);
  });

  it("sanitizes nearby chat and limits it to one message per second", () => {
    const frog = character("frog", { zone: "hollowmere", ...at("hollowmere", 100, -100) });
    const near = character("near", { zone: "hollowmere", ...at("hollowmere", 110, -100) });
    const far = character("far", { zone: "hollowmere", ...at("hollowmere", 140, -100) });
    const g = game([frog, near, far]), c = g.play(frog), n = g.play(near), f = g.play(far);
    g.world.handle(c, { t: "say", text: "  Tired\u0000 hands\n  " });
    expect(n.last("chat")).toMatchObject({ text: "Tired hands", ch: "say", from: frog.id }); expect(f.all("chat")).toEqual([]);
    g.world.handle(c, { t: "say", text: "again" }); expect(n.all("chat")).toHaveLength(1);
    g.clock(1000); g.world.handle(c, { t: "say", text: "x".repeat(201) }); expect(n.all("chat")).toHaveLength(1);
    g.world.handle(c, { t: "say", text: "A little further." }); expect(n.all("chat")).toHaveLength(2);
  });

  it("round-trips persisted characters and writes only the persistent fields", () => {
    const frog = character("frog", { ...at("cistern", 3.4, -5.4), bag: [{ id: "egg_jelly", n: 2 }],
      equip: { shoulders: "wend_cloak", hands: "leech_hide_wraps" }, flags: { warmth: true, visits: 3 } });
    const g = game([frog]), c = g.play(frog);
    g.world.handle(c, { t: "quest", action: "accept", id: "first_breath" });
    g.clock(1000); g.move(c, "cistern", 4, -5);
    g.world.save();
    expect(existsSync(`${g.file}.tmp`)).toBe(false);
    const saved = JSON.parse(readFileSync(g.file, "utf8")) as Character[];
    expect(Object.keys(saved[0]!).sort()).toEqual(Object.keys(frog).sort());
    expect(saved[0]!.equip).toEqual(frog.equip);
    const restored = new World({ dataDir: g.dir, now: () => 200000, random: () => 0.5 });
    const conn = new FakeConnection("restored", frog.account); restored.connect(conn);
    restored.handle(conn, { t: "hello", version: 1 }); restored.handle(conn, { t: "play", charId: frog.id });
    expect(conn.last("enter")).toMatchObject({ bag: frog.bag, equip: frog.equip, quests: [{ id: "first_breath", progress: [0], done: false }] });
    expect(conn.last("enter").stats).toMatchObject({ armor: 9, power: 2 });
    restored.tick(); expect(conn.last("snap").ents.find((e) => e.id === frog.id)).toMatchObject({ x: 4, z: -5 });
    expect(saved[0]!.flags).toEqual(frog.flags);
    expect(saved[0]!.lastSeen).toBeGreaterThan(frog.lastSeen);
  });

  it.each(["not json", '[{"id":"broken"}]', '{"characters":[]}'])("keeps a .bad copy of corrupt persistence: %s", (raw) => {
    const dir = temp(), folder = join(dir, "lastspawn"), file = join(folder, "characters.json");
    mkdirSync(folder); writeFileSync(file, raw);
    const world = new World({ dataDir: dir });
    expect(world.stats().characters).toBe(0); expect(readFileSync(`${file}.bad`, "utf8")).toBe(raw);
    world.save(); expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([]);
  });
});

describe("LASTSPAWN limits on free guest characters", () => {
  const guest = (world: World, n: number, ip: string) => {
    const conn = new FakeConnection(`guest-${n}`, ""); conn.ip = ip;
    world.connect(conn); world.handle(conn, { t: "hello", version: PROTOCOL_VERSION });
    return conn;
  };
  it("lets one address make six new guest characters an hour", () => {
    let now = 100000;
    const world = new World({ dataDir: temp(), now: () => now });
    for (let i = 0; i < 6; i++) create(world, guest(world, i, "198.51.100.7"), `Guest${"abcdef"[i]}`);
    const seventh = guest(world, 6, "198.51.100.7"); create(world, seventh, "Guestg");
    expect(seventh.last("error").msg).toMatch(/Too many new characters/);
    create(world, guest(world, 7, "198.51.100.8"), "Guesth");
    now += 3_600_001; create(world, guest(world, 8, "198.51.100.7"), "Guesti");
    expect(world.stats().characters).toBe(8);
  });
  it("makes room in a full world from idle level-1 guests only, and refuses when there is none", () => {
    const idle = character("idle", { account: `g:${"a".repeat(64)}`, lastSeen: 1 }), hero = character("hero", { account: `g:${"b".repeat(64)}`, level: 4, lastSeen: 1 });
    const g = game([idle, hero]);
    let now = 15 * 86_400_000;
    const world = new World({ dataDir: g.dir, now: () => now, maxCharacters: 2 });
    create(world, guest(world, 1, "198.51.100.9"), "Newfrog");
    expect(world.stats().characters).toBe(2);
    const full = guest(world, 2, "198.51.100.10"); create(world, full, "Nextfrog");
    expect(full.last("error").msg).toMatch(/world is full/);
  });
});
