import { CONTROLS, type TimeControl } from "./chess.js";
import { config } from "./config.js";
import { type Button, type GameContext, type Reply, type TgFrom, esc, kb, tgResult } from "./social.js";
import { type LiveGame, liveGames } from "./spectate.js";
import { type Profile, type Profiles, displayName } from "./tg.js";

/**
 * The bot's game side: /play, /live (/watch), /profile, /challenge, a plain /start, /quiet and
 * inline mode ("@bot chess" in any chat). The games are played on the website and its installable
 * app, never inside Telegram: every button here is a plain link to the site, which Telegram opens in
 * its in-app browser (where the site's wallet works). Every reply is built here as text and
 * buttons; social.ts sends it. Every command and inline query is rate limited.
 */

/** A fixed window per key: at most `n` in `ms`. */
export class Limiter {
  #hits = new Map<string, { n: number; reset: number }>();
  constructor(private n: number, private ms: number, private now = () => Date.now()) {}
  hit(key: string): boolean {
    const now = this.now();
    if (this.#hits.size > 50_000) for (const [k, h] of this.#hits) if (h.reset < now) this.#hits.delete(k);
    const h = this.#hits.get(key);
    if (!h || h.reset < now) { this.#hits.set(key, { n: 1, reset: now + this.ms }); return false; }
    h.n++;
    return h.n > this.n;
  }
}

/** The line every game reply ends with: the site installs as an app (the PWA). */
export const INSTALL = "📲 Install the app: open the site and tap Install.";
const TC_LABEL: Record<TimeControl, string> = { "3+2": "3+2 blitz", "5+0": "5+0 blitz", "10+0": "10+0 rapid" };
const tcOf = (s: string | undefined): TimeControl => (s && Object.hasOwn(CONTROLS, s) ? s as TimeControl : "3+2");
/** A page of the website (the games live there and in the installed app). */
export const site = (path = "", base = config.publicUrl) => `${base}${path}`;
const GAME = { chess: { icon: "♟", name: "NIGHT CHESS", path: "/games/chess" }, pinball: { icon: "🎱", name: "Space Pinball", path: "/games/pinball" }, pool: { icon: "🎱", name: "NIGHT POOL", path: "/games/pool" }, poker: { icon: "🃏", name: "NIGHT POKER", path: "/games/poker" } } as const;
/** The three games, the live games and the Game Room, as link buttons. */
const room = (): Button[][] => [
  [{ text: "♟ NIGHT CHESS", url: site(GAME.chess.path) }, { text: "🎱 Space Pinball", url: site(GAME.pinball.path) }],
  [{ text: "🎱 NIGHT POOL", url: site(GAME.pool.path) }, { text: "👀 Live games", url: site("/games/live") }],
  [{ text: "🎮 Open the Game Room", url: site("/games") }],
];
const nameOf = (from: TgFrom) => displayName(from) ?? "A night crew player";
const record = (p: Profile) => {
  const line = (icon: string, name: string, g: Profile["games"]["chess"] | undefined) => g ? `${icon} ${name} · <b>${g.elo}</b> Elo · ${g.played} game${g.played === 1 ? "" : "s"}${g.played ? ` · ${g.wins} W ${g.losses} L ${g.draws} D` : ""}` : null;
  return [line("♟", "NIGHT CHESS", p.games?.chess), line("🎱", "Space Pinball", p.games?.pinball)].filter((x): x is string => !!x);
};
const joined = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** The challenge card: who, which clock, and the link to NIGHT CHESS on the website. */
export function challengeCard(host: string, tc: TimeControl): { text: string; buttons: Button[][] } {
  return {
    text: [
      "♟🌙 <b>NIGHT CHESS CHALLENGE</b>", "",
      `<b>${esc(host)}</b> challenges this chat to a <b>${TC_LABEL[tc]}</b> game of NIGHT CHESS.`,
      `Open NIGHT CHESS on the website, pick ${tc} and press Find a rival: the first player on the same clock sits down. Free and rated.`, "",
      INSTALL,
    ].join("\n"),
    buttons: [[{ text: "♟ Play NIGHT CHESS", url: site(GAME.chess.path) }]],
  };
}

function liveCard(games: LiveGame[]): Reply {
  if (!games.length) return { text: ["👀 <b>NO LIVE GAMES RIGHT NOW</b>", "", "Start one on the website and the night crew can watch it there.", "", INSTALL].join("\n"), buttons: [...room(), [{ text: "🔄 Refresh", data: "/watch" }]] };
  const shown = games.slice(0, 8);
  const vs = (g: LiveGame) => `${esc(g.players[0]?.name ?? "Player")} vs ${esc(g.players[1]?.name ?? "Player")}`;
  const stake = (g: LiveGame) => (g.house ? "HOUSE · exhibition, not rated" : g.stake.currency === "FREE" ? "free" : `💎 ${g.stake.amount.toLocaleString("en-US")} ${g.stake.currency === "SHIFT" ? "$SHIFT" : "IMD"}`);
  const kind = (g: LiveGame) => (g.game === "chess" ? g.tc ?? "chess" : g.game === "pool" ? "pool" : g.game === "poker" ? (g.table ? "poker table" : "poker heads-up") : "pinball");
  const lines = shown.map((g) => `${GAME[g.game].icon} <b>${vs(g)}</b> · ${kind(g)} · ${stake(g)}${g.viewers ? ` · 👁 ${g.viewers}` : ""}`);
  return {
    text: [`👀 <b>LIVE NOW</b> · ${games.length} game${games.length === 1 ? "" : "s"}`, "", ...lines, ...(games.length > shown.length ? ["", `…and ${games.length - shown.length} more on the website.`] : []), "", "Watch any of them on the website.", INSTALL].join("\n"),
    buttons: [...shown.slice(0, 6).map((g) => [{ text: `👀 Watch ${(g.players[0]?.name ?? "").slice(0, 14)} vs ${(g.players[1]?.name ?? "").slice(0, 14)}`, url: site(g.watch) }]), [{ text: "📺 All live games", url: site("/games/live") }, { text: "🔄 Refresh", data: "/watch" }]],
  };
}

export type BotDeps = { profiles: Profiles; live?: () => LiveGame[]; token?: () => string };

/** The game commands and inline mode: every answer links to the games on the website. */
export class GameBot {
  readonly commands = new Limiter(6, 30_000);
  readonly challenges = new Limiter(3, 120_000);
  readonly groups = new Limiter(4, 60_000);
  readonly inlineLimit = new Limiter(30, 60_000);
  #live: () => LiveGame[];
  #token: () => string;
  constructor(private d: BotDeps) {
    this.#live = d.live ?? (() => liveGames());
    this.#token = d.token ?? (() => config.telegramToken);
  }

  /** A game command, or null (not one of ours: the public and operator commands answer it). */
  async command(cmd: string, args: string[], ctx: GameContext): Promise<Reply | null> {
    const known = ["play", "live", "watch", "profile", "me", "challenge", "start", "quiet"];
    if (!known.includes(cmd)) return null;
    // an operator's own /live and /start in a private chat stay the operator's commands
    if (ctx.admin && ctx.private && (cmd === "live" || cmd === "start")) return null;
    if (!ctx.private && !ctx.group) return null;
    // a plain /start and /quiet belong to the private chat with the bot
    if ((cmd === "start" || cmd === "quiet") && !ctx.private) return null;
    const from = ctx.from && !ctx.from.is_bot && Number.isSafeInteger(ctx.from.id) ? ctx.from : null;
    if (!from) return null;
    if (this.commands.hit(`u:${from.id}`)) return null;
    if (ctx.group && !ctx.callback && this.groups.hit(`g:${ctx.chat}:${cmd}`)) return null;
    if (cmd === "play" || cmd === "start") {
      const hello = cmd === "start" ? [`🌙 <b>Welcome to the night shift, ${esc(nameOf(from))}.</b>`, ""] : [];
      return {
        text: [...hello, "🎮 <b>NIGHTSHIFT GAME ROOM</b> · on the website", "",
          "♟ <b>NIGHT CHESS</b> · blitz and rapid, rated, clocks kept by the server",
          "🎱 <b>Space Pinball</b> · PvP duels on the same table, every score verified by replay",
          "🎱 <b>NIGHT POOL</b> · 3D 8-ball on WPA rules, every shot simulated by the server", "",
          "Free to play, or staked in IMD and $SHIFT with your wallet.", "",
          INSTALL].join("\n"),
        buttons: [...room(), ...(ctx.private ? [[{ text: "♟ Challenge a chat", switch_inline: "chess" }]] : [])],
      };
    }
    if (cmd === "quiet") return { text: "🔕 The bot sends no game DMs: the games and their results are on the website." };
    if (cmd === "live" || cmd === "watch") return liveCard(this.#live());
    if (cmd === "profile" || cmd === "me") {
      const p = this.d.profiles.byTg(from.id);
      if (!p) return { text: ["👤 <b>YOUR GAMES ARE ON THE WEBSITE</b>", "", "NIGHT CHESS, Space Pinball and NIGHT POOL keep your Elo, wins and streak on the website.", "", INSTALL].join("\n"), buttons: room() };
      return {
        text: [`👤 <b>${esc(p.name)}</b> · your record from the Telegram Game Room`, "", ...record(p), `🔥 Win streak <b>${p.streak ?? 0}</b> · best ${p.bestStreak ?? 0}`, `🗓 On the night shift since ${joined(p.joinedAt)}`, "", "The games moved to the website: play them there.", INSTALL].join("\n"),
        buttons: room(),
      };
    }
    // /challenge [3+2|5+0|10+0]: a card anyone in the chat can follow to NIGHT CHESS on the website
    if (this.challenges.hit(`c:${from.id}`)) return null;
    const tc = tcOf(args[0]), card = challengeCard(nameOf(from), tc);
    return { text: card.text, buttons: [...card.buttons, ...(ctx.private ? [[{ text: "📤 Send it to a chat", switch_inline: `chess ${tc}` }]] : [])] };
  }

  /** The inline results for "@bot …": NIGHT CHESS (one per clock, or the one asked for), Space Pinball, NIGHT POOL and the live games, each a link to the website. */
  inlineResults(from: TgFrom, query: string): unknown[] {
    if (from.is_bot || !Number.isSafeInteger(from.id)) return [];
    const name = nameOf(from), q = query.toLowerCase().trim();
    const tcs = (Object.keys(CONTROLS) as TimeControl[]);
    const asked = tcs.find((t) => q.includes(t));
    const wantChess = !q || /chess|♟|blitz|rapid|duel|challenge|\d\+\d/.test(q), wantPinball = !q || /pinball|duel/.test(q), wantPool = !q || /pool|8.?ball|billiard/.test(q);
    const thumb = site("/app/apple-touch-icon.png");
    const article = (id: string, title: string, description: string, text: string, buttons: Button[][]) => ({ type: "article", id, title, description, thumbnail_url: thumb, input_message_content: { message_text: text, parse_mode: "HTML", link_preview_options: { is_disabled: true } }, reply_markup: kb(buttons) });
    const out: unknown[] = [];
    if (wantChess) for (const tc of asked ? [asked] : tcs) {
      const card = challengeCard(name, tc);
      out.push(article(`chess-${tc}`, `♟ Challenge to NIGHT CHESS · ${TC_LABEL[tc]}`, `${name} · free and rated, on the website`, card.text, card.buttons));
    }
    if (wantPinball) out.push(article("pinball", "🎱 Space Pinball duel", "PvP on the same table and seed, verified by replay", `🎱🌙 <b>SPACE PINBALL</b>\n\n<b>${esc(name)}</b> is on the table. Black holes throw meteors at your rival, the frog crew sends heavy gravity.\n\nOpen Space Pinball on the website and sit down for a duel.\n\n${INSTALL}`, [[{ text: "🎱 Play Space Pinball", url: site(GAME.pinball.path) }]]));
    if (wantPool) out.push(article("pool", "🎱 NIGHT POOL · 8-ball", "3D 8-ball on WPA rules, on the website", `🎱🌙 <b>NIGHT POOL</b>\n\n<b>${esc(name)}</b> racked them up: 3D 8-ball on WPA rules, every shot simulated by the server.\n\nOpen NIGHT POOL on the website and break.\n\n${INSTALL}`, [[{ text: "🎱 Play NIGHT POOL", url: site(GAME.pool.path) }]]));
    if (!q || /live|watch/.test(q)) out.push(article("live", "👀 Live games", "Watch NIGHT CHESS, Space Pinball and NIGHT POOL being played now", `👀 <b>LIVE ON THE NIGHT SHIFT</b>\n\nNIGHT CHESS, Space Pinball and NIGHT POOL games being played right now. Watch any of them on the website.\n\n${INSTALL}`, [[{ text: "👀 Watch live", url: site("/games/live") }]]));
    return out.slice(0, 50);
  }

  async inline(q: { id: string; from: TgFrom; query: string }): Promise<void> {
    if (this.inlineLimit.hit(`i:${q.from.id}`)) return;
    const results = this.inlineResults(q.from, q.query.slice(0, 256));
    // personal (each card names its sender), and cached only briefly
    await tgResult(this.#token(), "answerInlineQuery", { inline_query_id: q.id, results, cache_time: 5, is_personal: true });
  }
}
