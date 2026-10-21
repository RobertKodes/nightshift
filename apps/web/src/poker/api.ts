import { authHeaders } from "../api";

/** One line of a hand's action (poker/hand.ts LogLine). */
export type LogLine = { street: "preflop" | "flop" | "turn" | "river"; seat: number; kind: "sb" | "bb" | "fold" | "check" | "call" | "bet" | "raise"; amount: number; to: number; allIn: boolean };
export type Pot = { amount: number; eligible: number[]; winners?: number[]; hand?: string | null };
export type Legal = { fold: boolean; check: boolean; call: number; raise: { min: number; max: number } | null; allIn: number };
export type SeatView = { seat: number; stack: number; bet: number; folded: boolean; allIn: boolean; cards: number[] | null };
export type HandView = {
  n: number; street: "preflop" | "flop" | "turn" | "river" | "done"; button: number; sb: number; bb: number; sbSeat: number; bbSeat: number;
  board: number[]; currentBet: number; minRaise: number; pot: number; pots: Pot[]; seats: SeatView[]; toAct: number | null; commit: string | null;
  result: { pots: Pot[]; won: Record<string, number>; uncalled: { seat: number; amount: number } | null; showdown: boolean; hands: Record<string, { name: string; best: number[]; category: number }> } | null;
  log: LogLine[]; runout: string | null;
};
export type PlayerView = {
  seat: number; name: string; rating: number | null; you: boolean; connected: boolean; bot: boolean; avatar: string | null; level: number | null; emotes: string[]; bank: number;
  agent?: boolean; awayUntil: number | null; grace: number | null;
  /** Free tables: sitting out, or standing up after this hand. */
  sittingOut?: boolean; leaving?: boolean; house?: boolean;
};
export type HandRecord = {
  n: number; button: number; blinds: [number, number]; stacks: number[]; board: number[]; log: LogLine[]; pots: Pot[]; won: Record<string, number>;
  uncalled: { seat: number; amount: number } | null; showdown: boolean; at: number; cut: boolean; hole: (number[] | null)[]; shown: number[];
  hands: Record<string, { name: string; best: number[] }>; commit: string; serverSeed: string | null; clientSeeds: string[];
  /** Free tables: the names at the table for that hand, by seat. */
  names?: (string | null)[];
};
/** What the server sends for one heads-up match (poker.ts view()). */
export type MatchView = {
  id: string; currency: "FREE" | "IMD" | "SHIFT"; stake: string | null; escrow: string | null; version: number; now: number; startedAt: number | null;
  status: "waiting" | "countdown" | "playing" | "finished"; practice: boolean; house: boolean;
  level: number; levelAt: number | null; blinds: [number, number]; nextBlinds: [number, number]; startStack: number;
  hand: HandView | null; you: number | null; legal: Legal | null;
  clock: { seat: number; turnAt: number; actionMs: number; deadline: number } | null;
  next: { n: number; commit: string; dealAt: number | null; seedSent: boolean } | null;
  history: HandRecord[]; emotes: { seat: number; id: string; at: number }[];
  done: boolean; reason: "busted" | "resignation" | "abandonment" | "void" | "paused" | null; winner: number | null; winnerIsYou: boolean;
  rematchRequested: boolean; rivalWantsRematch: boolean; rematchId: string | null; waitingSince: number; expired: "away" | "timeout" | null; movedTo: string | null; showBy: number | null;
  players: PlayerView[];
  spectating?: boolean; viewers?: number;
};
export type Board = { best: { name: string; rating: number; games: number; wins: number }[]; board: { name: string; rating: number; games: number; wins: number }[] };
export type Action = { kind: "fold" | "check" | "call" | "raise"; to?: number };

/** /api/poker/<path>: GET without a body, POST with one; errors as Error(message). */
export async function poker<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/poker/${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...authHeaders() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status });
  return j as T;
}
/** A fresh client seed for one hand: 128 random bits from this browser, as hex. */
export const newClientSeed = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const chips = (n: number) => n.toLocaleString("en-US");

/** A free table as the lobby lists it (poker/ring.ts list()). */
export type TableSummary = { id: string; name: string; seats: number; blinds: [number, number]; buyIn: { min: number; max: number }; people: number; frogs: number; players: { name: string; house: boolean }[]; hand: number | null; live: boolean };
export type TablesList = { tables: TableSummary[]; chips: number | null; buyIn: { min: number; max: number }; blinds: [number, number]; daily: number };
/** One free table for one seat, or for the rail (poker/ring.ts view()). */
export type TableView = {
  id: string; kind: "table"; name: string; seatsMax: number; blinds: [number, number]; buyIn: { min: number; max: number }; version: number; now: number;
  hand: HandView | null; you: number | null; legal: Legal | null;
  clock: { seat: number; turnAt: number; actionMs: number; deadline: number } | null;
  next: { n: number; commit: string; dealAt: number; seedSent: boolean } | null;
  history: HandRecord[]; emotes: { seat: number; id: string; at: number }[];
  players: ((PlayerView & { stack: number }) | null)[];
  chips: number | null; guest: boolean;
  spectating?: boolean; viewers?: number;
};
