import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { CLASSES, ITEMS, MAX_LEVEL, QUESTS, ZONES, floorAt, inBounds, validLook } from "@nightshift/lastspawn";
import { writeAtomic } from "../atomic.js";
import type { Character } from "./state.js";
import { own } from "./state.js";

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const integer = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v) && v >= 0;
export const validName = (s: string) => /^[A-Za-z][A-Za-z0-9 '\-]{2,15}$/.test(s);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function validCharacter(v: unknown): v is Character {
  if (!record(v) || typeof v.id !== "string" || !v.id || typeof v.account !== "string"
    || !/^(w:.+|g:[a-f0-9]{64})$/.test(v.account) || typeof v.name !== "string" || !validName(v.name)
    || typeof v.cls !== "string" || !own(CLASSES, v.cls) || typeof v.look !== "string" || !validLook(v.look)
    || typeof v.zone !== "string" || !own(ZONES, v.zone) || !integer(v.level) || v.level < 1 || v.level > MAX_LEVEL
    || !integer(v.xp) || !finite(v.hp) || v.hp < 0 || !finite(v.createdAt) || !finite(v.lastSeen)
    || !finite(v.x) || !finite(v.y) || !finite(v.z) || !finite(v.ry) || !inBounds(v.zone, v.x, v.z)) return false;
  const cls = CLASSES[v.cls];
  if (v.hp > cls.hp + cls.hpPerLevel * (v.level - 1)) return false;
  if (!Array.isArray(v.bag) || !v.bag.every((s: unknown) => record(s) && typeof s.id === "string"
    && own(ITEMS, s.id) && integer(s.n) && s.n > 0)) return false;
  if (!Array.isArray(v.quests) || !v.quests.every((q: unknown) => {
    if (!record(q) || typeof q.id !== "string" || !own(QUESTS, q.id) || !integer(q.step)
      || typeof q.done !== "boolean" || !Array.isArray(q.progress)) return false;
    const steps = QUESTS[q.id]!.steps;
    return q.step <= steps.length && q.progress.length === steps.length
      && q.progress.every((p: unknown, i: number) => integer(p) && p <= steps[i]!.n);
  })) return false;
  return record(v.flags) && Object.values(v.flags).every((x) => typeof x === "string" || typeof x === "boolean" || finite(x));
}

export function loadCharacters(file: string): Map<string, Character> {
  if (!existsSync(file)) return new Map();
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(raw) || !raw.every(validCharacter)) throw new Error("Invalid characters");
    const chars = new Map<string, Character>(), names = new Set<string>(), accounts = new Map<string, number>();
    for (const c of raw as Character[]) {
      const name = c.name.toLowerCase(), n = (accounts.get(c.account) ?? 0) + 1;
      if (chars.has(c.id) || names.has(name) || n > 3 || new Set(c.bag.map((s) => s.id)).size !== c.bag.length
        || new Set(c.quests.map((q) => q.id)).size !== c.quests.length) throw new Error("Duplicate characters");
      // A restart must not restore a dead character without a respawn timer.
      if (!c.hp) { Object.assign(c, ZONES[c.zone].spawn); c.hp = (CLASSES[c.cls].hp + CLASSES[c.cls].hpPerLevel * (c.level - 1)) / 2; }
      const floor = floorAt(c.zone, c.x, c.z).y;
      if (c.y < floor - 0.6 || c.y > floor + 3.2) c.y = floor;
      chars.set(c.id, c); names.add(name); accounts.set(c.account, n);
    }
    return chars;
  } catch {
    try { copyFileSync(file, `${file}.bad`); } catch { /* Keep loading even if the backup cannot be written. */ }
    return new Map();
  }
}

export function saveCharacters(file: string, chars: Iterable<Character>): void {
  const rows = Array.from(chars, (c): Character => ({
    id: c.id, account: c.account, name: c.name, cls: c.cls, look: c.look, level: c.level, xp: c.xp,
    zone: c.zone, x: c.x, y: c.y, z: c.z, ry: c.ry, hp: c.hp, quests: c.quests, bag: c.bag,
    flags: c.flags, createdAt: c.createdAt, lastSeen: c.lastSeen,
  }));
  mkdirSync(dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(rows), { mode: 0o600 });
}
