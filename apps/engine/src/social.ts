/**
 * Real distribution. A company posts from its owner's Bluesky account, signed in with an app
 * password (Settings → Privacy and security → App passwords), never the account password.
 */
const PDS = "https://bsky.social/xrpc";

async function xrpc<T>(path: string, body: unknown, jwt?: string): Promise<T> {
  const r = await fetch(`${PDS}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await r.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!r.ok) throw new Error(`Bluesky: ${j.message ?? j.error ?? r.status}`);
  return j;
}

export async function blueskySession(handle: string, appPassword: string): Promise<{ did: string; jwt: string; handle: string }> {
  const s = await xrpc<{ did: string; accessJwt: string; handle: string }>("com.atproto.server.createSession", { identifier: handle.replace(/^@/, ""), password: appPassword });
  return { did: s.did, jwt: s.accessJwt, handle: s.handle };
}

/** Posts text (max 300 characters on Bluesky), with its links made clickable. Returns the post's URL. */
export type LinkCard = { uri: string; title: string; description: string; thumb?: string };
export async function blueskyPost(handle: string, appPassword: string, text: string, card?: LinkCard): Promise<string> {
  const s = await blueskySession(handle, appPassword);
  let embed: unknown;
  if (card) {
    let thumb: unknown;
    if (card.thumb) {
      try {
        const img = await fetch(card.thumb, { signal: AbortSignal.timeout(10000) });
        if (img.ok) {
          const up = await fetch(`${PDS}/com.atproto.repo.uploadBlob`, { method: "POST", headers: { "Content-Type": img.headers.get("content-type") ?? "image/jpeg", Authorization: `Bearer ${s.jwt}` }, body: Buffer.from(await img.arrayBuffer()), signal: AbortSignal.timeout(20000) });
          if (up.ok) thumb = ((await up.json()) as { blob: unknown }).blob;
        }
      } catch { /* the card works without a picture */ }
    }
    embed = { $type: "app.bsky.embed.external", external: { uri: card.uri, title: card.title, description: card.description, ...(thumb ? { thumb } : {}) } };
  }
  const t = text.length > 300 ? `${text.slice(0, 297)}…` : text;
  const enc = new TextEncoder();
  const facets = [...t.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => {
    const start = enc.encode(t.slice(0, m.index)).length;
    return { index: { byteStart: start, byteEnd: start + enc.encode(m[0]).length }, features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] };
  });
  const r = await xrpc<{ uri: string }>("com.atproto.repo.createRecord", {
    repo: s.did,
    collection: "app.bsky.feed.post",
    record: { $type: "app.bsky.feed.post", text: t, createdAt: new Date().toISOString(), ...(facets.length ? { facets } : {}), ...(embed ? { embed } : {}) },
  }, s.jwt);
  return `https://bsky.app/profile/${s.handle}/post/${r.uri.split("/").pop()}`;
}

/**
 * A button: a callback (data), a link (url) or "share in a chat" (an inline query). Never a Mini App:
 * the games are on the website and its installable app, and a link opens them in Telegram's browser.
 */
export type Button = { text: string; data?: string; url?: string; switch_inline?: string };
/** A command's answer: text and buttons, and optionally an animation or a picture (by URL) that carries the text as its caption. */
export type Reply = { text: string; buttons?: Button[][]; animation?: string; photo?: string };
export const kb = (b?: Button[][]) => (b?.length ? { inline_keyboard: b.map((row) => row.map((x) => (x.url ? { text: x.text, url: x.url } : x.switch_inline !== undefined ? { text: x.text, switch_inline_query: x.switch_inline } : { text: x.text, callback_data: x.data ?? x.text }))) } : undefined);

/**
 * How Bot API calls go out: fetch, unless TELEGRAM_OFFLINE=1 (nothing ever reaches Telegram), or a
 * test put its own in.
 */
type Transport = (url: string, init: { method: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
let transport: Transport | null = null;
let offline = process.env.TELEGRAM_OFFLINE === "1";
/** Tests: every Bot API call goes to `t` instead (null: back to the network, or offline). */
export function setTelegramTransport(t: Transport | null): void { transport = t; }
export function setTelegramOffline(on: boolean): void { offline = on; }
const send: Transport = (url, init) => (transport ?? fetch)(url, init);

/** One Bot API call, with Telegram's answer: ok and the result, or its error code and description. Never throws. */
export async function tgResult<T = unknown>(token: string, method: string, body: unknown): Promise<{ ok: boolean; result?: T; code?: number; description?: string }> {
  if (offline && !transport) return { ok: false, description: "offline" };
  try {
    const r = await send(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
    if (!j.ok) { console.error(`telegram ${method}: ${j.description ?? r.status}`); return { ok: false, code: j.error_code ?? r.status, description: j.description }; }
    return { ok: true, result: (j.result ?? true) as T };
  } catch { return { ok: false }; }
}
/** One Bot API call; the result, or null when it failed. Never throws. */
export async function tgCall<T = unknown>(token: string, method: string, body: unknown): Promise<T | null> {
  const r = await tgResult<T>(token, method, body);
  return r.ok ? (r.result as T) : null;
}
const tg = async (token: string, method: string, body: unknown) => (await tgCall(token, method, body)) !== null;

/** A card with a picture, GIF or video on top (caption up to 1024 characters). */
export async function telegramMedia(token: string, chatId: string, media: string, caption: string, buttons?: Button[][]): Promise<boolean> {
  const method = /\.(gif|mp4)(\?|$)/i.test(media) ? "sendAnimation" : "sendPhoto";
  const key = method === "sendAnimation" ? "animation" : "photo";
  if (await tg(token, method, { chat_id: chatId, [key]: media, caption: caption.slice(0, 1024), parse_mode: "HTML", reply_markup: kb(buttons) })) return true;
  return telegram(token, chatId, caption, buttons);
}

/** The operator's alert channel: a Telegram message (HTML), optionally with buttons. Never throws. */
export async function telegram(token: string, chatId: string, text: string, buttons?: Button[][]): Promise<boolean> {
  return tg(token, "sendMessage", { chat_id: chatId, text: text.slice(0, 3800), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb(buttons) });
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export type BotHandlers = {
  /** Operator commands, for the admin ids only. */
  admin: (cmd: string, args: string[], ctx?: CommandContext) => Promise<Reply>;
  /** Commands anyone may use (null: not a public command). */
  open: (cmd: string, args: string[], where?: { chat: string; username?: string; group: boolean; admin: boolean }) => Promise<Reply | null>;
  /** A plain message from an admin in a private chat, e.g. a shared X link. */
  adminText?: (text: string) => Promise<Reply | null>;
  /** People joined a chat the bot is in. */
  joined?: (chat: string, names: string[]) => void;
  /** Every group message from a non-admin, before anything else: true when it was removed. */
  guard?: (m: GroupMessage) => Promise<boolean>;
  /** A question in a private chat with the bot, from anyone who is not an operator. */
  ask?: (m: GroupMessage) => Promise<void>;
  /** A private /start with a code: an owner linking a company's alerts to this chat (null: not a code). */
  link?: (chat: string, code: string) => Promise<Reply | null>;
  /** The games (/games, /live, /profile, /challenge, a plain /start): links to the website, tried before the public commands (null: not one). */
  games?: (cmd: string, args: string[], ctx: GameContext) => Promise<Reply | null>;
  /** "@bot chess" typed in any chat. */
  inline?: (q: { id: string; from: TgFrom; query: string; chatType?: string }) => Promise<void>;
};
export type TgFrom = { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
/** Who typed a game command, and where. */
export type GameContext = { chat: string; private: boolean; group: boolean; admin: boolean; from: TgFrom | null; callback: boolean };
/** Where an operator command was typed, and whose message it answered (for /mute and /unmute). */
export type CommandContext = { chat: string; group: boolean; private?: boolean; from?: string; messageId?: number; replyTo?: { id: string; name: string } };
export type GroupMessage = { chat: string; chatUsername?: string; messageId: number; user: string; name: string; text: string; replyToBot?: boolean; private?: boolean };

/** One update from Telegram, as far as the bot reads it. */
export type Update = {
  update_id: number;
  message?: { message_id: number; chat: { id: number; type: string; username?: string }; from?: TgFrom; text?: string; caption?: string; new_chat_members?: { first_name: string; is_bot?: boolean }[]; reply_to_message?: { from?: TgFrom } };
  callback_query?: { id: string; from: TgFrom; data?: string; message?: { chat: { id: number; type?: string }; message_id: number } };
  inline_query?: { id: string; from: TgFrom; query: string; chat_type?: string };
};

/**
 * The bot: long-polls Telegram, answers public commands for anyone, operator commands and button
 * presses for the listed user ids only, and registers its command menus and description once. Its
 * menu button is the command list: no Mini App (the games are on the website and its app).
 */
export function telegramCommands(token: string, admins: string[], h: BotHandlers): void {
  if (offline && !transport) { console.log("telegram: TELEGRAM_OFFLINE=1, the bot is not started and nothing is sent"); return; }
  const games = [
    { command: "live", description: "Live games on the website" },
    { command: "challenge", description: "Challenge this chat to NIGHT CHESS" },
    { command: "profile", description: "Your Telegram record, and where to play" },
  ];
  const open = [
    { command: "price", description: "Price, market cap, liquidity" },
    { command: "ca", description: "The official contract address" },
    { command: "links", description: "Website, X, Telegram, Bluesky" },
    { command: "idmradio", description: "Play IDM radio in the group's live stream" },
    { command: "community", description: "Join the NIGHTSHIFT community on X" },
    { command: "games", description: "The Game Room: chess, pinball and pool" },
    { command: "pinball", description: "Space Pinball and its best players" },
    { command: "chess", description: "NIGHT CHESS" },
    { command: "pool", description: "NIGHT POOL: 3D 8-ball on the website" },
    { command: "frogs", description: "NIGHT FROGS on OpenSea" },
    { command: "forge", description: "Night Watchers: every forge, moving, with stats" },
    { command: "ask", description: "SWARM MIND: ask the IMD swarm's memory" },
    { command: "watchtower", description: "Watchtower: what changed on a token or v4 hook" },
    { command: "buildcheck", description: "Build & Check: does an agent service work" },
    { command: "crews", description: "The crews: AI agents that do the work" },
    { command: "weather", description: "SWARM WEATHER: the IMD swarm's day" },
    { command: "brief", description: "BRIEF DOCTOR: check an IMD request before paying" },
    { command: "memes", description: "Memes and art from the night crew" },
    ...(h.games ? games : []),
  ];
  const adminCommands = [
    { command: "status", description: "Mode, companies, swarm, price" },
    { command: "companies", description: "Every company and its money" },
    { command: "market", description: "What is on sale" },
    { command: "token", description: "The platform token" },
    { command: "report", description: "Today's report" },
    { command: "testbuy", description: "Send a sample buy card to the community" },
    { command: "testall", description: "Send every alert and announcement, marked TEST" },
    { command: "post", description: "Post on the project Bluesky: /post <text>" },
    { command: "bluesky", description: "Bluesky account status" },
    { command: "stop", description: "Pause every company now" },
    { command: "live", description: "How many people are on the site right now" },
    { command: "stats", description: "Your private stats: agents, website, crews, sales" },
    { command: "idmradio", description: "Play IDM radio in the group's live stream" },
    { command: "notify", description: "Private notifications: all, money or off" },
    { command: "announce", description: "Public sales announcements: on or off" },
    { command: "reserve", description: "Agent Reserve status: on, off or dry" },
    { command: "swarm", description: "Swarm Desk: status, cap, inflight, on or off" },
    { command: "acp", description: "Virtuals ACP: setup, signer, visibility and status" },
    { command: "unmute", description: "Unmute someone: reply to them, or /unmute @user" },
    { command: "mute", description: "Mute someone: reply, or /mute @user [minutes]" },
    { command: "help", description: "All commands" },
  ];
  void tg(token, "setMyCommands", { commands: open });
  void tg(token, "setMyCommands", { scope: { type: "all_group_chats" }, commands: open });
  for (const id of admins.filter((x) => Number(x) < 0)) void tg(token, "deleteMyCommands", { scope: { type: "chat", chat_id: Number(id) } });
  // an operator's own /live stays the site's visitor count, listed once
  for (const id of admins.filter((x) => Number(x) > 0)) void tg(token, "setMyCommands", { scope: { type: "chat", chat_id: Number(id) }, commands: [...adminCommands, ...open.filter((c) => !adminCommands.some((a) => a.command === c.command))] });
  // the chat menu button is the command list for everyone (this also takes down the old Mini App "Play" button)
  void tg(token, "setChatMenuButton", { menu_button: { type: "commands" } });
  void tg(token, "setMyDescription", { description: "NIGHTSHIFT: autonomous AI companies built by the IMD swarm. Buy alerts, price and the official links." });
  void tg(token, "setMyShortDescription", { short_description: "NIGHTSHIFT · buys, price, official links" });
  let offset = 0;
  const kinds = JSON.stringify(h.inline ? ["message", "callback_query", "inline_query"] : ["message", "callback_query"]);
  const loop = async (): Promise<void> => {
    try {
      const r = await send(`https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}&allowed_updates=${encodeURIComponent(kinds)}`, { method: "GET", signal: AbortSignal.timeout(35000) });
      const j = (await r.json()) as { result?: Update[] };
      for (const u of j.result ?? []) {
        offset = u.update_id + 1;
        await handleUpdate(token, admins, h, u);
      }
    } catch { await new Promise((r) => setTimeout(r, 5000)); }
    setTimeout(() => void loop(), 300);
  };
  void loop();
}

/** One update: an inline query, a button press, a group message or a command. */
/** The bot's own username, asked once (asked again after a failed answer). */
let ownName: Promise<string> | null = null;
const botName = (token: string): Promise<string> => (ownName ??= tgCall<{ username?: string }>(token, "getMe", {}).then((r) => {
  const n = r?.username?.toLowerCase() ?? "";
  if (!n) ownName = null;
  return n;
}));

export async function handleUpdate(token: string, admins: string[], h: BotHandlers, u: Update): Promise<void> {
  const iq = u.inline_query;
  if (iq) { if (h.inline && !iq.from.is_bot) await h.inline({ id: iq.id, from: iq.from, query: iq.query ?? "", chatType: iq.chat_type }).catch(() => {}); return; }
  const q = u.callback_query;
  const m = u.message;
  const from = String(q?.from.id ?? m?.from?.id ?? "");
  const chat = String(q?.message?.chat.id ?? m?.chat.id ?? "");
  const text = q?.data ?? m?.text ?? "";
  const isAdmin = admins.includes(from);
  if (!chat) return;
  // The community guard sees every group message from someone who is not an operator.
  if (m && (m.chat.type === "group" || m.chat.type === "supergroup") && m.from && !m.from.is_bot) {
    const name = m.from.username ? `@${m.from.username}` : (m.from.first_name ?? "someone");
    const gm: GroupMessage = { chat, chatUsername: m.chat.username, messageId: m.message_id, user: String(m.from.id), name, text: m.text ?? m.caption ?? "", replyToBot: Boolean(m.reply_to_message?.from?.is_bot) };
    if (!isAdmin && h.guard) { if (await h.guard(gm).catch(() => false)) return; }
    else if (isAdmin && h.ask && !gm.text.startsWith("/")) void h.ask(gm).catch(() => {});
  }
  const people = (m?.new_chat_members ?? []).filter((x) => !x.is_bot).map((x) => x.first_name);
  if (people.length && h.joined) { h.joined(chat, people); return; }
  if (!text.startsWith("/")) {
    if (isAdmin && m?.chat.type === "private" && h.adminText) { const rep = await h.adminText(text).catch(() => null); if (rep) await telegram(token, chat, rep.text, rep.buttons); }
    else if (!isAdmin && m?.chat.type === "private" && m.from && h.ask) void h.ask({ chat, messageId: m.message_id, user: String(m.from.id), name: m.from.first_name ?? "", text, private: true }).catch(() => {});
    return;
  }
  if (q) void tg(token, "answerCallbackQuery", { callback_query_id: q.id });
  const [raw, ...args] = text.trim().split(/\s+/);
  const cmd = raw!.slice(1).split("@")[0]!.toLowerCase();
  // a command written to another bot in the group (/play@MusicBot) is that bot's, never ours
  const to = raw!.split("@")[1]?.toLowerCase();
  if (to) { const me = await botName(token); if (me && to !== me) return; }
  if (cmd === "start" && args[0] && m?.chat.type === "private" && h.link) {
    const linked = await h.link(chat, args[0]).catch(() => null);
    if (linked) { await telegram(token, chat, linked.text, linked.buttons); return; }
  }
  // a button press has no m: its chat type comes from the message the button sits on, so a group stays a group
  const chatType = m?.chat.type ?? q?.message?.chat.type;
  const group = chatType === "group" || chatType === "supergroup" || chatType === "channel";
  // ACP credentials and approval links are only ever answered in the owner's own private chat.
  if (cmd === "acp") {
    if (!isAdmin || chatType !== "private" || chat !== from || Number(from) <= 0) return;
    const reply = await h.admin(cmd, args, { chat, group: false, private: true, from }).catch(() => ({ text: "ACP command failed. Try /acp status." }));
    await telegram(token, chat, reply.text);
    return;
  }
  const game = h.games ? await h.games(cmd, args, { chat, private: chatType === "private", group, admin: isAdmin, from: q?.from ?? m?.from ?? null, callback: !!q }).catch(() => null) : null;
  const pub = game ?? await h.open(cmd, args, { chat, username: m?.chat.username, group, admin: isAdmin }).catch(() => null);
  const rt = m?.reply_to_message?.from;
  const ctx: CommandContext = { chat, group, private: chatType === "private", messageId: m?.message_id, replyTo: rt && !rt.is_bot ? { id: String(rt.id), name: rt.username ? `@${rt.username}` : (rt.first_name ?? String(rt.id)) } : undefined };
  const adminHere = isAdmin && (!ctx.group || cmd === "mute" || cmd === "unmute" || cmd === "watchroom");
  const reply: Reply | null = pub ?? (adminHere ? await h.admin(cmd, args, ctx).catch((e) => ({ text: `⚠️ ${esc((e as Error).message)}` })) : m?.chat.type === "private" ? { text: "🌙 Public commands: /price · /ca · /links" } : null);
  if (!reply) return;
  if (q?.message && cmd !== "stop") await tg(token, "editMessageText", { chat_id: chat, message_id: q.message.message_id, text: reply.text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb(reply.buttons) });
  // an animation or a picture carries the text as its caption; the plain text when Telegram refuses it
  else if ((reply.animation || reply.photo) && reply.text.length <= 1024 && await tg(token, reply.animation ? "sendAnimation" : "sendPhoto", { chat_id: chat, ...(reply.animation ? { animation: reply.animation } : { photo: reply.photo }), caption: reply.text, parse_mode: "HTML", reply_markup: kb(reply.buttons) })) return;
  else await telegram(token, chat, reply.text, reply.buttons);
}
