import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { publicName } from "./names.js";

/**
 * The Telegram players of the former Mini App. The games moved to the website and the installable
 * app (Telegram's Bot Developer Terms §7 allow only TON inside a Mini App, and the games use $SHIFT,
 * IMD and ETH): the bot links there. DATA_DIR/telegram.json is still read so /profile can show a
 * player the record they built in Telegram; it is never rewritten or deleted here.
 * The Telegram id is the key on the server and never leaves it.
 */

export type GameKind = "chess" | "pinball";
export type GameStats = { elo: number; played: number; wins: number; losses: number; draws: number; streak: number; best: number };
/** Verified solo Space Pinball runs: the best replayed score and the latest. */
export type SoloStats = { best: number; bestAt: number; runs: number; last: number; lastAt: number };
export type Recent = { game: GameKind; id: string; result: "win" | "loss" | "draw"; vs: string; elo: number; change: number; at: number; tc?: string; reason?: string };
/** One player, as telegram.json keeps it (the format the Mini App wrote, unchanged). */
export type Profile = {
  /** The public id: random, and the only id any view or link carried. */
  pid: string;
  /** The Telegram user id: server side only. */
  tg: string;
  name: string;
  named?: boolean;
  photo: string | null;
  joinedAt: number; seenAt: number;
  wallet: string | null; walletAt?: number;
  dm: boolean;
  games: Record<GameKind, GameStats>;
  streak: number; bestStreak: number;
  recent: Recent[];
  solo?: SoloStats;
};

/** A display name from Telegram's, by the shared public-name rule (names.ts), or null. */
export function displayName(u: { first_name?: string; last_name?: string }): string | null {
  return publicName([u.first_name, u.last_name].filter(Boolean).join(" "), { max: 18 }) ?? publicName(u.first_name ?? "", { max: 18 });
}

/** The profiles in DATA_DIR/telegram.json, read once at start; an unreadable file never stops the bot. */
export class Profiles {
  #byTg = new Map<string, Profile>();
  #byPid = new Map<string, Profile>();
  constructor(file: string | null = join(config.dataDir, "telegram.json")) {
    try {
      if (file && existsSync(file)) {
        const d = JSON.parse(readFileSync(file, "utf8")) as { profiles?: Profile[] };
        for (const p of d.profiles ?? []) if (p?.pid && p.tg) { this.#byTg.set(String(p.tg), p); this.#byPid.set(p.pid, p); }
      }
    } catch (e) { console.error("telegram profiles not read:", (e as Error).message); }
  }
  get size() { return this.#byTg.size; }
  byTg(id: string | number): Profile | undefined { return this.#byTg.get(String(id)); }
  byPid(pid: string): Profile | undefined { return this.#byPid.get(pid); }
}
