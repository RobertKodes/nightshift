import { authHeaders } from "../api";
import type { Ball, Frame, Shot } from "./physics";
import type { Call, Decision, Group, InHand, Seat, Verdict } from "./rules";

/** A player's look at the table (pool.ts Look): equipped item ids, serials, level, face, aim guide. */
export type Look = { cue: string; cloth: string; table: string; balls: string; frame: string; banner: string; title: string; effect: string; emotes: string[]; serials?: Record<string, number>; level?: number; avatar?: string | null; guide?: number };
export type PlayerView = { name: string; seat: Seat; rating: number; you: boolean; connected: boolean; group: Group | null; shots: number; potted: number; look: Look; agent?: boolean };
export type LastShot = { n: number; seat: Seat; at: number; call: Call; duration: number; replayMs: number; verdict: Verdict; shot: Shot; start?: Ball[]; frames?: Frame[] };
/** What the server sends for one table (pool.ts view()). */
export type MatchView = {
  id: string; rules: "wpa" | "quick"; currency: "FREE" | "IMD" | "SHIFT"; stake: string | null; escrow: string | null; version: number; now: number; startedAt: number | null;
  status: "waiting" | "countdown" | "playing" | "finished";
  balls: Ball[]; turn: Seat; breaker: Seat; phase: "break" | "play" | "over"; groups: [Group | null, Group | null]; inHand: InHand; fouls: [number, number]; decision: Decision | null; racks: number;
  targets: number[]; onEight: [boolean, boolean]; left: [number, number]; headY: number;
  clock: { turnAt: number; ms: number; deadline: number };
  last: LastShot | null; log: { n: number; seat: Seat; text: string; foul: string | null; at: number }[];
  aim: { seat: Seat; aim: number; power: number; spinX: number; spinY: number; elevation: number; cue: { x: number; y: number } | null; at: number } | null;
  emotes: { seat: Seat; id: string; at: number }[];
  done: boolean; reason: "rack" | "resignation" | "abandonment" | "fouls" | null; rackReason: string | null; winner: Seat | null; winnerIsYou: boolean;
  you: Seat | null; rematchRequested: boolean; rivalWantsRematch: boolean; rematchId: string | null;
  waitingSince: number; expired: "away" | "timeout" | null; movedTo: string | null;
  players: PlayerView[];
  spectating?: boolean; viewers?: number;
};
export type Board = { best: { name: string; rating: number; games: number; wins: number }[]; board: { name: string; rating: number; games: number; wins: number }[] };
export type ShotInput = Shot & { call: Call; cue?: { x: number; y: number } };

/** /api/pool/<path>: GET without a body, POST with one; errors as Error(message). */
export async function pool<T>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(`/api/pool/${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...authHeaders(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status });
  return j as T;
}
/** The gaming profile and locker (locker.ts self()). */
export type SelfProfile = {
  name: string; level: number; avatar: number; joinedAt: number; title: string; frame: string; banner: string; cue: string;
  badges: { id: string; at: number; name: string; line: string }[]; stats: Record<"pool" | "chess" | "pinball" | "poker", { played: number; wins: number; losses: number; draws: number; streak: number; best: number }>; potted: number; editions: number;
  xp: number; next: number; floor: number;
  items: { id: string; serial: number | null; at: number; via: string; edition: string }[];
  equip: { cue: string; cloth: string; table: string; balls: string; frame: string; banner: string; title: string; effect: string; emote: string[] };
  rewards: { id: string; unlock: { by: string; level?: number; badge?: string }; owned: boolean; left: number | null }[];
  catalog?: CatalogItem[];
};
export type CatalogItem = { id: string; kind: string; name: string; line: string; rarity: string; supply: number | null; left: number | null; price: Record<string, string> | null; guide?: number; unlock: { by: string; level?: number; badge?: string } };
export async function locker<T>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(`/api/locker/${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...authHeaders(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status });
  return j as T;
}
export const POCKET_LABEL = ["head left", "side left", "foot left", "head right", "side right", "foot right"];
