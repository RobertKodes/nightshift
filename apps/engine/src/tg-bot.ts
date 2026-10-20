import { CONTROLS, type TimeControl } from "./chess.js";
import { config } from "./config.js";
import { type Button, type GameContext, type Reply, type TgFrom, esc, kb, tgResult } from "./social.js";
import { type LiveGame, liveGames } from "./spectate.js";
import { type Profile, type Profiles, appUrl, startLink } from "./tg.js";
import type { Note, TgPlay } from "./tg-play.js";

/**
 * The bot's game side: /play, /live (/watch), /profile, /challenge, a plain /start, inline mode
 * ("@bot chess" in any chat) and DMs to players who pressed Start. Every reply is built here as
 * text and buttons; social.ts sends it. Every command, inline query and DM is rate limited.
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

const TC_LABEL: Record<TimeControl, string> = { "3+2": "3+2 blitz", "5+0": "5+0 blitz", "10+0": "10+0 rapid" };
const tcOf = (s: string | undefined): TimeControl => (s && Object.hasOwn(CONTROLS, s) ? s as TimeControl : "3+2");
/** Opens the Mini App on a target: a web_app button in a private chat (no t.me hop), a t.me link anywhere else. */
export function openButton(text: string, param: string | undefined, privateChat: boolean): Button {
  return privateChat ? { text, web_app: appUrl(param) } : { text, url: startLink(param ?? "lounge") };
}
const record = (p: Profile) => {
  const line = (icon: string, name: string, g: Profile["games"]["chess"]) => `${icon} ${name} · <b>${g.elo}</b> Elo · ${g.played} game${g.played === 1 ? "" : "s"}${g.played ? ` · ${g.wins} W ${g.losses} L ${g.draws} D` : ""}`;
  return [line("♟", "NIGHT CHESS", p.games.chess), line("🎱", "Space Pinball", p.games.pinball)];
};
const joined = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** The challenge card: who, which clock, the one button that accepts it in the Mini App. */
export function challengeCard(host: Profile, inviteId: string, tc: TimeControl): { text: string; buttons: Button[][] } {
  return {
    text: [
      "♟🌙 <b>NIGHT CHESS CHALLENGE</b>", "",
      `<b>${esc(host.name)}</b> (${host.games.chess.elo} Elo) challenges you to a <b>${TC_LABEL[tc]}</b> game.`,
      "Free and rated. The first to accept plays; the clock starts once you both sit down.", "",
      "<i>Open for 30 minutes, right here in Telegram.</i>",
    ].join("\n"),
    buttons: [[{ text: "♟ Accept the challenge", url: startLink(`chess_${inviteId}`) }]],
  };
}

function liveCard(games: LiveGame[], privateChat: boolean): Reply {
  if (!games.length) return { text: "👀 <b>NO LIVE GAMES RIGHT NOW</b>\n\nStart one and the night crew can watch it here.", buttons: [[openButton("🎮 Play now", "lounge", privateChat)], [{ text: "🔄 Refresh", data: "/watch" }]] };
  const shown = games.slice(0, 8);
  const vs = (g: LiveGame) => `${esc(g.players[0]?.name ?? "Player")} vs ${esc(g.players[1]?.name ?? "Player")}`;
  const stake = (g: LiveGame) => (g.stake.currency === "FREE" ? "free" : `💎 ${g.stake.amount.toLocaleString("en-US")} ${g.stake.currency === "SHIFT" ? "$SHIFT" : "IMD"}`);
  const lines = shown.map((g) => `${g.game === "chess" ? "♟" : "🎱"} <b>${vs(g)}</b> · ${g.game === "chess" ? g.tc ?? "chess" : "pinball"} · ${stake(g)}${g.viewers ? ` · 👁 ${g.viewers}` : ""}`);
  return {
    text: [`👀 <b>LIVE NOW</b> · ${games.length} game${games.length === 1 ? "" : "s"}`, "", ...lines, ...(games.length > shown.length ? ["", `…and ${games.length - shown.length} more in the app.`] : [])].join("\n"),
    buttons: [...shown.slice(0, 6).map((g) => [openButton(`👀 Watch ${(g.players[0]?.name ?? "").slice(0, 14)} vs ${(g.players[1]?.name ?? "").slice(0, 14)}`, `watch_${g.game}_${g.id}`, privateChat)]), [openButton("📺 All live games", "live", privateChat), { text: "🔄 Refresh", data: "/watch" }]],
  };
}

export type BotDeps = { profiles: Profiles; play: TgPlay; live?: () => LiveGame[]; token?: () => string; now?: () => number };

/** The game commands, inline mode and DMs, wired to the profiles and the play coordinator. */
export class GameBot {
  readonly commands = new Limiter(6, 30_000);
  readonly challenges = new Limiter(3, 120_000);
  readonly groups = new Limiter(4, 60_000);
  readonly inlineLimit = new Limiter(30, 60_000);
  readonly dms = new Limiter(20, 3_600_000);
  #live: () => LiveGame[];
  #token: () => string;
  constructor(private d: BotDeps) {
    this.#live = d.live ?? liveGames;
    this.#token = d.token ?? (() => config.telegramToken);
  }
  #profile(from: TgFrom | null): Profile | null {
    if (!from || from.is_bot || !Number.isSafeInteger(from.id)) return null;
    return this.d.profiles.upsert({ id: from.id, first_name: from.first_name ?? "", last_name: from.last_name });
  }

  /** Someone pressed Start privately: a profile, and DMs allowed from now on. */
  started(from: TgFrom): void { const p = this.#profile(from); if (p) this.d.profiles.setDm(p, true); }

  /** A game command, or null (not one of ours: the public and operator commands answer it). */
  async command(cmd: string, args: string[], ctx: GameContext): Promise<Reply | null> {
    const known = ["play", "live", "watch", "profile", "me", "challenge", "start", "quiet"];
    if (!known.includes(cmd)) return null;
    // an operator's own /live and /start in a private chat stay the operator's commands
    if (ctx.admin && ctx.private && (cmd === "live" || cmd === "start")) return null;
    if (!ctx.private && !ctx.group) return null;
    // a plain /start and /quiet belong to the private chat with the bot
    if ((cmd === "start" || cmd === "quiet") && !ctx.private) return null;
    const who = String(ctx.from?.id ?? "");
    if (this.commands.hit(`u:${who}`)) return null;
    if (ctx.group && !ctx.callback && this.groups.hit(`g:${ctx.chat}:${cmd}`)) return null;
    const priv = ctx.private;
    if (cmd === "play" || cmd === "start") {
      const p = this.#profile(ctx.from);
      const hello = cmd === "start" && p ? [`🌙 <b>Welcome to the night shift, ${esc(p.name)}.</b>`, ""] : [];
      return {
        text: [...hello, "🎮 <b>NIGHTSHIFT GAME ROOM</b> · now in Telegram", "",
          "♟ <b>NIGHT CHESS</b> · blitz and rapid, rated, clocks kept by the server",
          "🎱 <b>Space Pinball</b> · PvP duels on the same table, every score verified by replay", "",
          "Free to play. Your Elo, wins and streak follow your Telegram profile.",
          ...(cmd === "start" ? ["", "I will DM you when someone joins your game and when a game ends. Send /quiet to stop that, /start to turn it back on."] : [])].join("\n"),
        buttons: [[openButton("🎮 Open the Game Room", "lounge", priv)], [priv ? { text: "♟ Challenge a friend", switch_inline: "chess" } : openButton("👀 Live games", "live", priv)]],
      };
    }
    if (cmd === "quiet") {
      const p = this.#profile(ctx.from);
      if (!p || !priv) return null;
      this.d.profiles.setDm(p, false);
      return { text: "🔕 No more game DMs. Send /start to turn them back on." };
    }
    if (cmd === "live" || cmd === "watch") return liveCard(this.#live(), priv);
    if (cmd === "profile" || cmd === "me") {
      const p = this.#profile(ctx.from);
      if (!p) return null;
      return {
        text: [`👤 <b>${esc(p.name)}</b>`, "", ...record(p), `🔥 Win streak <b>${p.streak}</b> · best ${p.bestStreak}`, `🗓 On the night shift since ${joined(p.joinedAt)}`].join("\n"),
        buttons: [[openButton("📊 Open my profile", "me", priv), openButton("🎮 Play", "lounge", priv)]],
      };
    }
    // /challenge [3+2|5+0|10+0]: a chess invite by the sender, as a card anyone in the chat can accept
    const p = this.#profile(ctx.from);
    if (!p || this.challenges.hit(`c:${p.pid}`)) return null;
    const tc = tcOf(args[0]), inv = this.d.play.invite(p, tc), card = challengeCard(p, inv.id, tc);
    return { text: card.text, buttons: [...card.buttons, ...(priv ? [[{ text: "📤 Send it to a chat", switch_inline: `chess ${tc}` }]] : [])] };
  }

  /** The inline results for "@bot …": chess challenges by the sender (one per clock), Space Pinball and the live games. */
  inlineResults(from: TgFrom, query: string): unknown[] {
    const p = this.#profile(from);
    if (!p) return [];
    const q = query.toLowerCase().trim();
    const tcs = (Object.keys(CONTROLS) as TimeControl[]);
    const asked = tcs.find((t) => q.includes(t));
    const wantChess = !q || /chess|♟|blitz|rapid|duel|challenge|\d\+\d/.test(q), wantPinball = !q || /pinball|🎱|duel/.test(q);
    const thumb = `${config.publicUrl}/app/apple-touch-icon.png`;
    const out: unknown[] = [];
    if (wantChess) for (const tc of asked ? [asked] : tcs) {
      const inv = this.d.play.invite(p, tc), card = challengeCard(p, inv.id, tc);
      out.push({ type: "article", id: `chess-${inv.id}`, title: `♟ Challenge to NIGHT CHESS · ${TC_LABEL[tc]}`, description: `${p.name} · ${p.games.chess.elo} Elo · free and rated, the first to accept plays`, thumbnail_url: thumb, input_message_content: { message_text: card.text, parse_mode: "HTML", link_preview_options: { is_disabled: true } }, reply_markup: kb(card.buttons) });
    }
    if (wantPinball) out.push({ type: "article", id: "pinball", title: "🎱 Space Pinball duel", description: "PvP on the same table and seed, verified by replay", thumbnail_url: thumb, input_message_content: { message_text: `🎱🌙 <b>SPACE PINBALL</b>\n\n<b>${esc(p.name)}</b> is on the table. Black holes throw meteors at your rival, the frog crew sends heavy gravity.\n\nOpen the lounge and sit down for a duel.`, parse_mode: "HTML", link_preview_options: { is_disabled: true } }, reply_markup: kb([[{ text: "🎱 Play Space Pinball", url: startLink("lounge") }]]) });
    if (!q || /live|watch/.test(q)) out.push({ type: "article", id: "live", title: "👀 Live games", description: "Watch NIGHT CHESS and Space Pinball being played now", thumbnail_url: thumb, input_message_content: { message_text: "👀 <b>LIVE ON THE NIGHT SHIFT</b>\n\nNIGHT CHESS and Space Pinball games being played right now. Watch any of them in Telegram.", parse_mode: "HTML", link_preview_options: { is_disabled: true } }, reply_markup: kb([[{ text: "👀 Watch live", url: startLink("live") }]]) });
    return out.slice(0, 50);
  }

  async inline(q: { id: string; from: TgFrom; query: string }): Promise<void> {
    if (this.inlineLimit.hit(`i:${q.from.id}`)) return;
    const results = this.inlineResults(q.from, q.query.slice(0, 256));
    // personal (each card carries its sender's own challenge), and cached only briefly
    await tgResult(this.#token(), "answerInlineQuery", { inline_query_id: q.id, results, cache_time: 5, is_personal: true, button: { text: "🎮 Open the Game Room", start_parameter: "play" } });
  }

  /** A DM, only to a player who pressed Start, at most 20 an hour; a player who blocked the bot is not written to again. */
  async dm(p: Profile, text: string, buttons: Button[][]): Promise<boolean> {
    if (!p.dm || !this.#token() || this.dms.hit(`dm:${p.pid}`)) return false;
    const r = await tgResult(this.#token(), "sendMessage", { chat_id: Number(p.tg), text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb(buttons) });
    if (!r.ok && (r.code === 403 || r.code === 400)) this.d.profiles.setDm(p, false);
    return r.ok;
  }
  /** What the play coordinator reports, as a DM. */
  note(p: Profile, n: Note): Promise<boolean> {
    const name = n.game === "chess" ? "NIGHT CHESS" : "Space Pinball";
    const target = `${n.game}_${n.id}`;
    if (n.kind === "joined") return this.dm(p, `${n.game === "chess" ? "♟" : "🎱"} <b>${esc(n.rival)}</b> joined your ${name} game. It starts in a few seconds.`, [[{ text: n.game === "chess" ? "♟ Back to the board" : "🎱 Back to the table", web_app: appUrl(target) }]]);
    if (n.kind === "accepted") return this.dm(p, `♟ <b>${esc(n.rival)}</b> accepted your ${TC_LABEL[n.tc]} challenge.\nSit down within 5 minutes: the clock starts once you are both at the table.`, [[{ text: "♟ Take your seat", web_app: appUrl(target) }]]);
    const head = n.result === "win" ? "🏆 <b>Victory</b>" : n.result === "draw" ? "⚖️ <b>Draw</b>" : "🌑 <b>Defeat</b>";
    const why = n.reason ? ` (${esc(n.reason)})` : "";
    return this.dm(p, `${head} vs ${esc(n.rival)} · ${name}${why}\nElo <b>${n.elo}</b> (${n.change >= 0 ? "+" : ""}${n.change})`, [[{ text: "🔁 Play again", web_app: appUrl("lounge") }, { text: "📊 My profile", web_app: appUrl("me") }]]);
  }
}
