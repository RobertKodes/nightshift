import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";
import { publicName } from "./names.js";

/**
 * Telegram identity for the Mini App (/tg) and the bot's game commands.
 * - initData: the query string Telegram hands the Mini App, signed with the bot token
 *   (HMAC-SHA-256, key = HMAC-SHA-256("WebAppData", bot token)). Every Mini App request carries it
 *   and it is checked here every time: the hash, then its age. Nothing the page says about the user
 *   is believed without it.
 * - Profiles: one per Telegram account. The Telegram id is the key on the server and never leaves
 *   it: every view uses the profile's random public id (pid) instead.
 */

// ---- initData

/** The Mini App's user, as Telegram signs it (WebAppUser). */
export type TgUser = { id: number; first_name: string; last_name?: string; username?: string; language_code?: string; is_premium?: boolean; allows_write_to_pm?: boolean; photo_url?: string };
export type InitData = { user: TgUser; authDate: number; startParam: string | null; chatType: string | null; chatInstance: string | null; queryId: string | null };
export type InitCheck = { ok: true; data: InitData } | { ok: false; reason: "missing" | "malformed" | "hash" | "expired" | "future" | "no-user" };

/** initData older than this is refused (seconds). A Mini App left open keeps the initData it was opened with. */
export const INIT_MAX_AGE = 24 * 3600;
const secretOf = (token: string) => createHmac("sha256", "WebAppData").update(token).digest();

/** The data-check-string: every field but hash, sorted by key, "key=value" joined by line feeds. */
function checkString(params: URLSearchParams): string {
  return [...params.entries()].filter(([k]) => k !== "hash").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
}

/**
 * Checks initData against the bot token: the hash first (constant time), then auth_date (not older
 * than maxAge, not from the future), then the user. A missing token refuses everything.
 */
export function validateInitData(raw: unknown, token: string, o: { maxAge?: number; now?: number } = {}): InitCheck {
  if (typeof raw !== "string" || !raw || !token) return { ok: false, reason: "missing" };
  if (raw.length > 8_192) return { ok: false, reason: "malformed" };
  let params: URLSearchParams;
  try { params = new URLSearchParams(raw); } catch { return { ok: false, reason: "malformed" }; }
  const hash = params.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(hash) || params.getAll("hash").length !== 1) return { ok: false, reason: "malformed" };
  const want = createHmac("sha256", secretOf(token)).update(checkString(params)).digest();
  if (!timingSafeEqual(Buffer.from(hash, "hex"), want)) return { ok: false, reason: "hash" };
  const now = Math.floor((o.now ?? Date.now()) / 1000), at = Number(params.get("auth_date"));
  if (!Number.isInteger(at) || at <= 0) return { ok: false, reason: "malformed" };
  if (at > now + 60) return { ok: false, reason: "future" };
  if (now - at > (o.maxAge ?? INIT_MAX_AGE)) return { ok: false, reason: "expired" };
  let user: TgUser;
  try { user = JSON.parse(params.get("user") ?? "null") as TgUser; } catch { return { ok: false, reason: "malformed" }; }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== "string") return { ok: false, reason: "no-user" };
  return { ok: true, data: { user, authDate: at, startParam: params.get("start_param"), chatType: params.get("chat_type"), chatInstance: params.get("chat_instance"), queryId: params.get("query_id") } };
}

/** Signs fields the way Telegram does: for tests and local smoke runs with a made-up token. */
export function signInitData(fields: Record<string, string | number | object>, token: string): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  params.set("hash", createHmac("sha256", secretOf(token)).update(checkString(params)).digest("hex"));
  return params.toString();
}

/** The initData a request carries: `Authorization: tma <initData>` (Telegram's convention). */
export function initDataOf(header: string | undefined): string {
  const h = header ?? "";
  return /^tma /i.test(h) ? h.slice(4).trim() : "";
}

// ---- deep links

/** What a start parameter (t.me/<bot>/<app>?startapp=…, or ?s=… on a web_app button) asks the Mini App to open. */
export type StartTarget =
  | { kind: "chess"; id: string }
  | { kind: "pinball"; id: string }
  | { kind: "watch"; game: "chess" | "pinball" | null; id: string }
  | { kind: "lounge" }
  | { kind: "live" }
  | { kind: "me" };
const ID = "([a-f0-9]{10,40})";
/** Telegram allows A-Z, a-z, 0-9, _ and - (up to 512 characters); anything else is no target. */
export function parseStartParam(raw: unknown): StartTarget | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > 512 || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  if (s === "lounge" || s === "play") return { kind: "lounge" };
  if (s === "live") return { kind: "live" };
  if (s === "me" || s === "profile") return { kind: "me" };
  let m = new RegExp(`^chess_${ID}$`).exec(s);
  if (m) return { kind: "chess", id: m[1]! };
  m = new RegExp(`^pinball_${ID}$`).exec(s);
  if (m) return { kind: "pinball", id: m[1]! };
  m = new RegExp(`^watch_(?:(chess|pinball)_)?${ID}$`).exec(s);
  if (m) return { kind: "watch", game: (m[1] as "chess" | "pinball" | undefined) ?? null, id: m[2]! };
  return null;
}

/**
 * The link that opens the Mini App on a target, from any chat: the named Mini App
 * (t.me/<bot>/<app>, made with BotFather's /newapp) when TELEGRAM_APP_NAME is set, else the bot's
 * Main Mini App (t.me/<bot>?startapp, set in BotFather's Mini App settings).
 */
export function startLink(param: string, o: { bot?: string; app?: string } = {}): string {
  const bot = o.bot ?? config.telegramBotName, app = o.app ?? config.telegramAppName;
  const p = encodeURIComponent(param);
  return app ? `https://t.me/${bot}/${app}?startapp=${p}` : `https://t.me/${bot}?startapp=${p}`;
}
/** The Mini App's own URL (web_app buttons and the menu button), with a target it opens on. */
export const appUrl = (param?: string, base = config.publicUrl) => `${base}/tg${param ? `?s=${encodeURIComponent(param)}` : ""}`;

// ---- profiles

export type GameKind = "chess" | "pinball";
export type GameStats = { elo: number; played: number; wins: number; losses: number; draws: number; streak: number; best: number };
export type Recent = { game: GameKind; id: string; result: "win" | "loss" | "draw"; vs: string; elo: number; change: number; at: number; tc?: string; reason?: string };
export type Profile = {
  /** The public id: random, and the only id any view or link carries. */
  pid: string;
  /** The Telegram user id: server side only. */
  tg: string;
  name: string;
  /** The name was chosen in the Mini App: Telegram's name no longer overwrites it. */
  named?: boolean;
  /** Telegram's profile photo URL, when the user's privacy settings allow it. Shown to the user only. */
  photo: string | null;
  joinedAt: number; seenAt: number;
  /** A wallet linked by a signed sign-in message: staked duels and the website see the same player. */
  wallet: string | null; walletAt?: number;
  /** Pressed Start in a private chat with the bot (and has not blocked it since): may get DMs. */
  dm: boolean;
  games: Record<GameKind, GameStats>;
  /** Wins in a row across both games; a loss or a draw ends it. */
  streak: number; bestStreak: number;
  recent: Recent[];
};
/** What the player sees of their own profile: everything but the Telegram id. */
export type SelfView = Omit<Profile, "tg">;
/** What anyone may see: no Telegram id, no photo, no wallet. */
export type PublicView = Pick<Profile, "pid" | "name" | "joinedAt" | "streak" | "bestStreak"> & { games: Record<GameKind, Pick<GameStats, "elo" | "played" | "wins" | "losses" | "draws">> };

export const START_ELO = 1200;
const K = 24;
const fresh = (): GameStats => ({ elo: START_ELO, played: 0, wins: 0, losses: 0, draws: 0, streak: 0, best: 0 });
/** The Elo change for a score of 1 (win), 0.5 (draw) or 0 (loss) against a rival rated `rival`. */
export const eloChange = (mine: number, rival: number, score: number) => Math.round(K * (score - 1 / (1 + 10 ** ((rival - mine) / 400))));

/** A display name from Telegram's: the shared public-name rule, else a neutral one of the profile's own. */
export function displayName(u: Pick<TgUser, "first_name" | "last_name">, pid: string): string {
  return publicName([u.first_name, u.last_name].filter(Boolean).join(" "), { max: 18 }) ?? publicName(u.first_name, { max: 18 }) ?? `Crew ${pid.slice(0, 4).toUpperCase()}`;
}
/** Telegram's photo URL, only when it is an https URL on Telegram's own hosts. */
const photoOf = (u: Pick<TgUser, "photo_url">) => { try { const p = new URL(String(u.photo_url ?? "")); return p.protocol === "https:" && /(^|\.)(t\.me|telegram\.org|telesco\.pe|telegram-cdn\.org)$/.test(p.hostname) ? p.toString().slice(0, 300) : null; } catch { return null; } };
const MAX_PROFILES = 200_000;

/** The profiles, kept in DATA_DIR/telegram.json (0600: it maps Telegram ids to players). */
export class Profiles {
  #byTg = new Map<string, Profile>();
  #byPid = new Map<string, Profile>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private file: string | null = join(config.dataDir, "telegram.json"), private now = () => Date.now()) {
    try {
      if (file && existsSync(file)) {
        const d = JSON.parse(readFileSync(file, "utf8")) as { profiles?: Profile[] };
        for (const p of d.profiles ?? []) if (p?.pid && p.tg) this.#index(p);
      }
    } catch (e) { console.error("telegram profiles not read:", (e as Error).message); }
  }
  #index(p: Profile) { this.#byTg.set(p.tg, p); this.#byPid.set(p.pid, p); }
  get size() { return this.#byTg.size; }
  /** Saved a moment after the last change: a burst of games is one write. */
  save(): void {
    if (!this.file || this.#timer) return;
    this.#timer = setTimeout(() => { this.#timer = null; this.flush(); }, 500);
    this.#timer.unref?.();
  }
  flush(): void {
    if (!this.file) return;
    try { mkdirSync(dirname(this.file), { recursive: true }); writeAtomic(this.file, JSON.stringify({ profiles: [...this.#byTg.values()] }), { mode: 0o600 }); } catch (e) { console.error("telegram.json not saved:", (e as Error).message); }
  }
  byTg(id: string | number): Profile | undefined { return this.#byTg.get(String(id)); }
  byPid(pid: string): Profile | undefined { return this.#byPid.get(pid); }
  /** Creates the profile on first sight, else refreshes Telegram's name (unless one was chosen) and photo. */
  upsert(u: Pick<TgUser, "id" | "first_name" | "last_name" | "photo_url">): Profile {
    const tg = String(u.id), now = this.now();
    let p = this.#byTg.get(tg);
    if (!p) {
      if (this.#byTg.size >= MAX_PROFILES) throw new Error("Too many players right now. Try again later.");
      const pid = randomBytes(8).toString("hex");
      p = { pid, tg, name: displayName(u, pid), photo: photoOf(u), joinedAt: now, seenAt: now, wallet: null, dm: false, games: { chess: fresh(), pinball: fresh() }, streak: 0, bestStreak: 0, recent: [] };
      this.#index(p);
    } else {
      if (!p.named) p.name = displayName(u, p.pid);
      if (u.photo_url !== undefined) p.photo = photoOf(u);
      p.seenAt = now;
    }
    this.save();
    return p;
  }
  rename(p: Profile, raw: unknown): Profile {
    const n = publicName(raw, { max: 18 });
    if (!n) throw new Error("Use letters, digits, spaces, . - or _ (up to 18), and not a name that reads as ours.");
    p.name = n; p.named = true; this.save();
    return p;
  }
  linkWallet(p: Profile, wallet: string | null): Profile {
    p.wallet = wallet ? wallet.toLowerCase() : null;
    if (wallet) p.walletAt = this.now(); else delete p.walletAt;
    this.save();
    return p;
  }
  /** Pressed Start (true), or blocked the bot (false). */
  setDm(p: Profile, on: boolean): void { if (p.dm !== on) { p.dm = on; this.save(); } }
  /**
   * One finished game for this profile: played, the result, the streaks, the Elo (`elo` given by
   * the game, as NIGHT CHESS does, or worked out here from the rival's), and the recent list.
   */
  record(p: Profile, r: { game: GameKind; id: string; result: Recent["result"]; vs: string; rival: number; elo?: number; tc?: string; reason?: string }): Recent {
    const s = p.games[r.game] ?? (p.games[r.game] = fresh());
    const before = s.elo;
    s.elo = r.elo ?? before + eloChange(before, r.rival, r.result === "win" ? 1 : r.result === "draw" ? 0.5 : 0);
    s.played++;
    if (r.result === "win") { s.wins++; s.streak++; s.best = Math.max(s.best, s.streak); p.streak++; p.bestStreak = Math.max(p.bestStreak, p.streak); }
    else { if (r.result === "loss") s.losses++; else s.draws++; s.streak = 0; p.streak = 0; }
    const item: Recent = { game: r.game, id: r.id, result: r.result, vs: r.vs, elo: s.elo, change: s.elo - before, at: this.now(), ...(r.tc ? { tc: r.tc } : {}), ...(r.reason ? { reason: r.reason } : {}) };
    p.recent = [item, ...p.recent].slice(0, 12);
    this.save();
    return item;
  }
}

/** The player's own view: never the Telegram id. */
export function selfView(p: Profile): SelfView { const { tg: _tg, ...rest } = p; return structuredClone(rest); }
/** What anyone may see of a player. */
export function publicView(p: Profile): PublicView {
  const g = (s: GameStats) => ({ elo: s.elo, played: s.played, wins: s.wins, losses: s.losses, draws: s.draws });
  return { pid: p.pid, name: p.name, joinedAt: p.joinedAt, streak: p.streak, bestStreak: p.bestStreak, games: { chess: g(p.games.chess), pinball: g(p.games.pinball) } };
}
/** The key a Telegram player without a linked wallet plays under (ratings, "your own game"): its pid, never its Telegram id. */
export const playKey = (p: Profile) => p.wallet ?? `tg:${p.pid}`;
