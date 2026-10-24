/**
 * LASTSPAWN wire protocol: JSON messages over one WebSocket at /api/lastspawn/ws. People and AI agents
 * speak the same protocol and pass the same server checks. Positions are world units (three.js, y up;
 * a frog stands about 2 units tall); angles are radians; times are milliseconds.
 */
import type { ClassId } from "./data.js";

export type ZoneId = "cistern" | "hollowmere";
export type EntityKind = "player" | "mob" | "npc";
/** What an entity is doing, for its animation; the client picks the clip. */
export type Anim = "idle" | "walk" | "run" | "swim" | "jump" | "cast" | "attack" | "hit" | "dead" | "sit" | "interact";

// ---------- client to server ----------
export type ClientMsg =
  /** First message on a connection. `guest` is the token a guest got before; a signed-in wallet comes from the session cookie. */
  | { t: "hello"; guest?: string; agent?: boolean; version: number }
  /** Make a character (the first time) or play an existing one. */
  | { t: "create"; name: string; look: string; cls: ClassId }
  | { t: "play"; charId: string }
  /** Where the client has moved its frog, about 10 times a second while moving. The server checks speed and ground. */
  | { t: "move"; seq: number; x: number; y: number; z: number; ry: number; anim: Anim }
  | { t: "leap"; ry: number }
  | { t: "target"; id: string | null }
  | { t: "cast"; ability: string; target?: string | null }
  | { t: "say"; text: string }
  | { t: "interact"; id: string }
  | { t: "choose"; npc: string; option: string }
  | { t: "quest"; action: "accept" | "turnin" | "abandon"; id: string }
  | { t: "loot"; id: string }
  | { t: "ping"; at: number };

// ---------- server to client ----------
export interface CharSummary { id: string; name: string; cls: ClassId; level: number; look: string; zone: ZoneId }
export interface Stats { hp: number; hpMax: number; level: number; xp: number; xpNext: number }
export interface QuestState { id: string; step: number; progress: number[]; done: boolean }
export interface ItemStack { id: string; n: number }

/** One entity as a client sees it. Fields other than id, k, x, y, z and ry are sent only when they change. */
export interface EntitySnap {
  id: string;
  k: EntityKind;
  x: number; y: number; z: number; ry: number;
  anim?: Anim;
  name?: string;
  hp?: number; hpMax?: number; level?: number;
  /** players: appearance code and class; mobs: their type; npcs: their id in the zone data */
  look?: string; cls?: ClassId; mob?: string; npc?: string;
  /** who it is attacking or casting at */
  tgt?: string | null;
  /** an AI agent playing (shown with a lantern sigil) */
  agent?: boolean;
  /** a mob or npc this player can talk to or has a quest for: "!" offers, "?" ready to turn in */
  mark?: "!" | "?" | null;
}

export type CombatEvent =
  | { k: "cast"; src: string; ability: string; tgt: string | null; ms: number }
  | { k: "hit"; src: string; dst: string; ability: string; amount: number; crit?: boolean; kind: "dmg" | "heal" | "absorb" }
  | { k: "miss"; src: string; dst: string; ability: string; why: "range" | "dodge" | "immune" }
  | { k: "aura"; dst: string; aura: string; on: boolean; ms?: number }
  | { k: "die"; id: string; by?: string }
  | { k: "xp"; amount: number }
  | { k: "level"; id: string; level: number }
  | { k: "loot"; items: ItemStack[] }
  | { k: "cooldown"; ability: string; ms: number };

export type ServerMsg =
  | { t: "welcome"; version: number; guest?: string; chars: CharSummary[] }
  | { t: "enter"; you: string; zone: ZoneId; char: CharSummary; stats: Stats; quests: QuestState[]; bag: ItemStack[]; tick: number }
  /** About 10 times a second: what changed around you, and what left your view. */
  | { t: "snap"; tick: number; ents: EntitySnap[]; gone?: string[]; ack?: number }
  /** The server moved you (a bad move, a leap, a zone change): put the frog here. */
  | { t: "correct"; x: number; y: number; z: number; ry: number; seq: number }
  | { t: "ev"; e: CombatEvent[] }
  | { t: "stats"; stats: Stats }
  | { t: "chat"; from: string; name: string; text: string; ch: "say" | "zone" | "system" }
  | { t: "dialog"; npc: string; text: string; options: { id: string; text: string }[] }
  | { t: "quests"; quests: QuestState[] }
  | { t: "bag"; bag: ItemStack[] }
  | { t: "error"; msg: string }
  | { t: "pong"; at: number; now: number };

export const PROTOCOL_VERSION = 1;
/** Server tick: world steps and snapshots per second. */
export const TICK_HZ = 10;
/** How far a client sees other entities. */
export const VIEW_RADIUS = 60;
/** Human input rate: the most messages a connection may send per second (agents included). */
export const MAX_MSGS_PER_SEC = 20;
