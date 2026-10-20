import type { IncomingMessage, ServerResponse } from "node:http";
import { getAddress } from "viem";
import type { Auth } from "./auth.js";
import { chess } from "./chess.js";
import { config } from "./config.js";
import { lounge } from "./lounge.js";
import * as pinball from "./pinball.js";
import { liveGames } from "./spectate.js";
import { type GameKind, type InitData, type Profile, type Profiles, initDataOf, parseStartParam, playKey, selfView, startLink, validateInitData } from "./tg.js";
import type { TgPlay } from "./tg-play.js";

/**
 * /api/tg/*: the Telegram Mini App's API. Every request carries its initData
 * (`Authorization: tma <initData>`) and every request is checked: the HMAC with the bot token,
 * then its age. The profile comes from that check only, never from anything else the page sends.
 * The Telegram id never leaves the server; the page knows the profile by its public id.
 */
type Context = {
  json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  url: URL; auth: Auth; profiles: Profiles; play: TgPlay;
  /** The escrow lobby's open challenges, for the lounge. */
  challenges?: () => unknown[];
  /** Tests: another bot token and clock. */
  token?: string; now?: number;
};
const GAMES = new Set(["chess", "pinball"]);
const ID = /^[a-f0-9]{1,40}$/;
const REASONS: Record<string, string> = { missing: "Open this from Telegram: the Mini App sends who you are.", malformed: "Telegram's sign-in data could not be read. Close and reopen the Mini App.", hash: "Telegram's sign-in data does not check out. Close and reopen the Mini App.", expired: "This session is too old. Close and reopen the Mini App.", future: "Your device clock is off. Fix the time and reopen the Mini App.", "no-user": "Telegram did not say who you are. Reopen the Mini App from the bot." };

/** The checked Telegram user behind a request, or the reason it is refused. */
export function tgCaller(req: IncomingMessage, token: string, now?: number): { ok: true; data: InitData } | { ok: false; reason: string } {
  const r = validateInitData(initDataOf(req.headers.authorization), token, { maxAge: config.telegramInitMaxAge, now });
  return r.ok ? r : { ok: false, reason: r.reason };
}

/** What the Mini App needs about its user: the profile (no Telegram id), the bot's links, the seats to pick up. */
const meView = (p: Profile, play: TgPlay) => ({
  profile: selfView(p), seats: play.active(p),
  bot: { username: config.telegramBotName, app: config.telegramAppName || null, start: `https://t.me/${config.telegramBotName}?start=play`, lounge: startLink("lounge") },
});

export async function tgRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/tg/")) return false;
  const { json, body, limited, url, profiles, play } = ctx;
  const reply = (status: number, value: unknown, headers?: Record<string, string>) => { json(res, status, value, headers); return true; };
  if (limited(req, "tg", 300, 60_000)) return reply(429, { error: "Slow down." });
  const token = ctx.token ?? config.telegramToken;
  if (!token) return reply(503, { error: "The Telegram bot is not set up on this server." });
  const who = tgCaller(req, token, ctx.now);
  if (!who.ok) return reply(401, { error: REASONS[who.reason] ?? "Reopen the Mini App from Telegram.", reason: who.reason });
  const post = req.method === "POST";
  try {
    const me = profiles.upsert(who.data.user);
    // a second budget per player, whatever IP they come from
    const busy = (key: string, n: number, ms: number) => limited(req, `${key}:${me.pid}`, n, ms) || limited(req, key, n * 2, ms);
    if (p === "/api/tg/me" && !post) return reply(200, meView(me, play));
    if (p === "/api/tg/me" && post) {
      if (busy("tg-name", 10, 600_000)) return reply(429, { error: "Too many changes. Try again later." });
      const b = await body(req, 2_000);
      if (b.name !== undefined) profiles.rename(me, b.name);
      return reply(200, meView(me, play));
    }
    if (p === "/api/tg/lounge" && !post) {
      return reply(200, lounge({ chess, pinball, challenges: ctx.challenges ?? (() => []), live: liveGames }, playKey(me)));
    }
    if (p === "/api/tg/live" && !post) return reply(200, { games: liveGames() });
    if (p === "/api/tg/start" && !post) return reply(200, play.resolve(me, parseStartParam(url.searchParams.get("p") ?? who.data.startParam ?? "")));
    if (p === "/api/tg/play" && post) {
      const b = await body(req, 2_000), game = String(b.game ?? ""), action = String(b.action ?? "");
      if (!GAMES.has(game)) return reply(400, { error: "Choose chess or pinball" });
      if (!["queue", "any", "join", "cancel"].includes(action)) return reply(400, { error: "No such action" });
      if (action !== "cancel" && busy("tg-play", 20, 600_000)) return reply(429, { error: "Too many games in a row. Try again shortly." });
      if ((action === "join" || action === "cancel") && !ID.test(String(b.id ?? ""))) return reply(404, { error: "No such game" });
      if (action === "cancel") { play.cancel(me, game as GameKind, String(b.id)); return reply(200, { ok: true }); }
      return reply(200, await play.play(me, { game: game as GameKind, action: action as "queue", tc: b.tc, id: b.id }));
    }
    if (p === "/api/tg/attach" && post) {
      if (busy("tg-attach", 30, 600_000)) return reply(429, { error: "Slow down." });
      const b = await body(req, 2_000), game = String(b.game ?? ""), id = String(b.id ?? ""), player = String(b.player ?? "");
      if (!GAMES.has(game) || !ID.test(id) || !/^[0-9a-f-]{36}$/.test(player)) return reply(404, { error: "No such seat" });
      play.attach(me, game as GameKind, id, player);
      return reply(200, { ok: true });
    }
    if (p === "/api/tg/seat" && !post) {
      const game = url.searchParams.get("game") ?? "", id = url.searchParams.get("id") ?? "";
      const s = GAMES.has(game) && ID.test(id) ? play.seatAt(me, game as GameKind, id) : null;
      return s ? reply(200, s) : reply(404, { error: "No seat of yours at this game" });
    }
    if (p === "/api/tg/invite" && post) {
      if (busy("tg-invite", 20, 600_000)) return reply(429, { error: "Too many challenges. Try again shortly." });
      const b = await body(req, 2_000), inv = play.invite(me, String(b.tc ?? "3+2") as "3+2");
      return reply(200, { invite: play.inviteView(inv), link: startLink(`chess_${inv.id}`), share: `chess ${inv.tc}` });
    }
    const accept = /^\/api\/tg\/invite\/([a-f0-9]{16})\/accept$/.exec(p);
    if (accept && post) {
      if (busy("tg-play", 20, 600_000)) return reply(429, { error: "Too many games in a row. Try again shortly." });
      return reply(200, play.accept(me, accept[1]!));
    }
    // a solo Space Pinball run this player just finished: its replayed score goes on the profile, once
    if (p === "/api/tg/solo" && post) {
      if (busy("tg-solo", 30, 600_000)) return reply(429, { error: "Slow down." });
      const b = await body(req, 2_000), id = String(b.id ?? "");
      const run = ID.test(id) ? pinball.soloClaim(id) : null;
      if (!run) return reply(404, { error: "No finished run to book" });
      return reply(200, { solo: profiles.solo(me, run.score), ...meView(me, play) });
    }
    // a wallet, proved by the site's own sign-in message (EIP-4361, the nonce from /api/auth/nonce)
    if (p === "/api/tg/wallet" && post) {
      if (busy("tg-wallet", 10, 600_000)) return reply(429, { error: "Too many tries. Try again later." });
      const b = await body(req, 4_000);
      if (b.unlink === true) { profiles.linkWallet(me, null); return reply(200, meView(me, play)); }
      if (!/^0x[0-9a-fA-F]{40}$/.test(String(b.address ?? ""))) return reply(400, { error: "That is not a wallet address." });
      const address = getAddress(String(b.address));
      const session = await ctx.auth.verify(address, String(b.nonce ?? ""), String(b.signature ?? "") as `0x${string}`);
      profiles.linkWallet(me, address);
      const secure = config.publicUrl.startsWith("https") ? "; Secure" : "";
      // the cookie where the Mini App runs as its own page (phones, desktop); the token for Telegram Web, where a framed page gets no cookie
      return reply(200, { ...meView(me, play), session }, { "Set-Cookie": `ns_session=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}` });
    }
    return reply(404, { error: "No such Telegram route" });
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    return reply(typeof status === "number" ? status : 400, { error: (err as Error).message.split("\n")[0] });
  }
}
