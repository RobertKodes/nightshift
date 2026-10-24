import type {
  Ability, Anim, ClassId, ItemStack, MobCamp, MobDef, QuestState, ServerMsg, Spot, ZoneId,
} from "@nightshift/lastspawn";

export interface Connection {
  id: string;
  account: string;
  agent: boolean;
  send(msg: ServerMsg): void;
  close(): void;
}

export interface Character extends Spot {
  id: string;
  account: string;
  name: string;
  cls: ClassId;
  look: string;
  level: number;
  xp: number;
  zone: ZoneId;
  hp: number;
  quests: QuestState[];
  bag: ItemStack[];
  flags: Record<string, string | number | boolean>;
  createdAt: number;
  lastSeen: number;
}

export interface Aura extends NonNullable<Ability["aura"]> {
  source: string;
  ability: string;
  expiresAt: number;
  nextTick: number;
}

interface Fighter {
  hpMax: number;
  anim: Anim;
  target: string | null;
  auras: Map<string, Aura>;
  combatAt: number;
  deadAt: number | null;
}

export interface Session {
  conn: Connection;
  wallet: string | null;
  ready: boolean;
  player: Player | null;
  seen: Map<string, import("@nightshift/lastspawn").EntitySnap>;
  fullSnapshot: boolean;
  dialog: { npc: string; options: Set<string> } | null;
  saidAt: number;
}

export interface Player extends Character, Fighter {
  k: "player";
  session: Session;
  movedAt: number;
  seq: number;
  gcdUntil: number;
  cooldowns: Map<string, number>;
  cast: { ability: string; target: string; endsAt: number; x: number; y: number; z: number } | null;
  portalBlocked: boolean;
}

export interface Mob extends Spot, Fighter {
  k: "mob";
  id: string;
  zone: ZoneId;
  level: number;
  hp: number;
  def: MobDef;
  camp: MobCamp;
  campId: string;
  home: Spot;
  mode: "idle" | "chase" | "leash" | "flee";
  threat: Map<string, number>;
  damage: Map<string, number>;
  hits: Map<string, number>;
  swingAt: number;
  wanderAt: number;
  wander: Spot | null;
  fled: boolean;
  fleeUntil: number;
  fleeTo: Spot | null;
}

export interface Npc extends Spot {
  k: "npc";
  id: string;
  npc: string;
  name: string;
  zone: ZoneId;
}

export type Actor = Player | Mob;
export const distance = (a: Pick<Spot, "x" | "y" | "z">, b: Pick<Spot, "x" | "y" | "z">) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const horizontal = (a: Pick<Spot, "x" | "z">, b: Pick<Spot, "x" | "z">) => Math.hypot(a.x - b.x, a.z - b.z);
export const own = <T extends object>(table: T, key: string): key is Extract<keyof T, string> => Object.hasOwn(table, key);
