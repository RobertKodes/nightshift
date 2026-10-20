import type { Game, LoungeFeed, TimeControl } from "../games/lounge";
import type { MatchView } from "../chess/types";
import { webApp } from "./telegram";

/** The Mini App's API (/api/tg/*): every call carries Telegram's signed initData, which the server checks each time. */
export type GameStats = { elo: number; played: number; wins: number; losses: number; draws: number; streak: number; best: number };
export type Recent = { game: Game; id: string; result: "win" | "loss" | "draw"; vs: string; elo: number; change: number; at: number; tc?: string; reason?: string };
export type Profile = { pid: string; name: string; named?: boolean; photo: string | null; joinedAt: number; seenAt: number; wallet: string | null; walletAt?: number; dm: boolean; games: Record<Game, GameStats>; streak: number; bestStreak: number; recent: Recent[] };
export type ActiveSeat = { game: Game; id: string; player: string; status: string; tc: TimeControl | null; rival: string | null };
export type Me = { profile: Profile; seats: ActiveSeat[]; bot: { username: string; app: string | null; start: string; lounge: string }; session?: string };
export type Seated = { game: Game; match: { id: string; startedAt: number | null; status?: string; players: unknown[] }; player: string };
export type InviteView = { id: string; tc: TimeControl; host: { pid: string; name: string; elo: number } | null; until: number; taken: boolean };
export type Resolved =
  | { kind: "lounge" | "live" | "me" }
  | { kind: "seat"; game: Game; id: string; player: string }
  | { kind: "invite"; invite: InviteView; own: boolean }
  | { kind: "join"; game: Game; id: string; host: string; tc: TimeControl | null }
  | { kind: "watch"; game: Game; id: string }
  | { kind: "gone"; game: Game | null };
export type { LoungeFeed, MatchView };

export class TgError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export async function tg<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/tg/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `tma ${webApp()?.initData ?? ""}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new TgError(r.status, (j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}
