import type { Color, Move } from "chess.js";

export type TimeControl = "3+2" | "5+0" | "10+0";
export const CONTROLS = { "3+2": { time: 180_000, increment: 2_000, label: "Blitz", note: "2 seconds back per move" }, "5+0": { time: 300_000, increment: 0, label: "Blitz", note: "Five minutes. Trust yourself." }, "10+0": { time: 600_000, increment: 0, label: "Rapid", note: "A little room to think" } };
export type PlayerView = { name: string; color: Color; rating: number; you: boolean; connected: boolean; awayUntil?: number | null; grace?: number | null };
export type MatchView = {
  id: string; tc: TimeControl; currency: "FREE" | "IMD" | "SHIFT"; stake: string | null; escrow: string | null; version: number; now: number; startedAt: number | null;
  status: "waiting" | "countdown" | "playing" | "finished"; fen: string; turn: Color; check: boolean;
  clocks: Record<Color, number>; lastMove: Move | null; moves: Move[]; ply: number; done: boolean; reason: string | null;
  winner: Color | null; you: Color | null; winnerIsYou: boolean; drawOffer: "you" | "rival" | null;
  rematchRequested: boolean; rivalWantsRematch: boolean; rematchId: string | null; players: PlayerView[];
  /** An open game in the lounge: since when it waits, whether its host takes any clock, why it closed unplayed, or the table it moved to. */
  waitingSince?: number; any?: boolean; expired?: "away" | "timeout" | null; movedTo?: string | null;
  /** A staked game: when it is void if both players have not been at the table (server clock). */
  showBy?: number | null;
  /** The house exhibition: two house bots, never rated, staked or bet on. */
  house?: boolean;
};
export type BoardEntry = { name: string; rating: number; games: number; wins: number };
export type Leaderboard = { board: BoardEntry[]; best: BoardEntry[] };
export const cleanName = (name: string) => { const n = name.replace(/[^\w .-]/g, "").trim().slice(0, 18); return !n || /^(nightshift|admin|imd)$/i.test(n.replace(/[ ._-]/g, "")) ? "Night crew" : n; };
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/chess/${path}`, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}
export function clockText(ms: number) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
