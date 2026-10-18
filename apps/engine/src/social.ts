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

export type Button = { text: string; data?: string; url?: string };
export type Reply = { text: string; buttons?: Button[][] };
const kb = (b?: Button[][]) => (b?.length ? { inline_keyboard: b.map((row) => row.map((x) => (x.url ? { text: x.text, url: x.url } : { text: x.text, callback_data: x.data ?? x.text }))) } : undefined);

/** One Bot API call; the result, or null when it failed. Never throws. */
export async function tgCall<T = unknown>(token: string, method: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!j.ok) { console.error(`telegram ${method}: ${j.description ?? r.status}`); return null; }
    return (j.result ?? true) as T;
  } catch { return null; }
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
  open: (cmd: string, args: string[]) => Promise<Reply | null>;
  /** A plain message from an admin in a private chat, e.g. a shared X link. */
  adminText?: (text: string) => Promise<Reply | null>;
  /** People joined a chat the bot is in. */
  joined?: (chat: string, names: string[]) => void;
  /** Every group message from a non-admin, before anything else: true when it was removed. */
  guard?: (m: GroupMessage) => Promise<boolean>;
  /** A question in a private chat with the bot, from anyone who is not an operator. */
  ask?: (m: GroupMessage) => Promise<void>;
};
/** Where an operator command was typed, and whose message it answered (for /mute and /unmute). */
export type CommandContext = { chat: string; group: boolean; replyTo?: { id: string; name: string } };
export type GroupMessage = { chat: string; chatUsername?: string; messageId: number; user: string; name: string; text: string; replyToBot?: boolean; private?: boolean };

/**
 * The bot: long-polls Telegram, answers public commands for anyone, operator commands and button
 * presses for the listed user ids only, and registers its command menus and description once.
 */
export function telegramCommands(token: string, admins: string[], h: BotHandlers): void {
  const open = [
    { command: "price", description: "Price, market cap, liquidity" },
    { command: "ca", description: "The official contract address" },
    { command: "links", description: "Website, X, Telegram, Bluesky" },
    { command: "games", description: "The Game Room: Space Pinball and more" },
    { command: "frogs", description: "NIGHT FROGS on OpenSea" },
    { command: "memes", description: "Memes and art from the night crew" },
  ];
  void tg(token, "setMyCommands", { commands: open });
  void tg(token, "setMyCommands", { scope: { type: "all_group_chats" }, commands: open });
  for (const id of admins.filter((x) => Number(x) < 0)) void tg(token, "deleteMyCommands", { scope: { type: "chat", chat_id: Number(id) } });
  for (const id of admins.filter((x) => Number(x) > 0)) void tg(token, "setMyCommands", { scope: { type: "chat", chat_id: Number(id) }, commands: [
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
    { command: "unmute", description: "Unmute someone: reply to them, or /unmute @user" },
    { command: "mute", description: "Mute someone: reply, or /mute @user [minutes]" },
    { command: "help", description: "All commands" },
    ...open,
  ] });
  void tg(token, "setMyDescription", { description: "NIGHTSHIFT: autonomous AI companies built by the IMD swarm. Buy alerts, price and the official links." });
  void tg(token, "setMyShortDescription", { short_description: "NIGHTSHIFT · buys, price, official links" });
  let offset = 0;
  const loop = async (): Promise<void> => {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`, { signal: AbortSignal.timeout(35000) });
      const j = (await r.json()) as { result?: { update_id: number; message?: { message_id: number; chat: { id: number; type: string; username?: string }; from?: { id: number; is_bot?: boolean; first_name?: string; username?: string }; text?: string; caption?: string; new_chat_members?: { first_name: string; is_bot?: boolean }[]; reply_to_message?: { from?: { id: number; is_bot?: boolean; first_name?: string; username?: string } } }; callback_query?: { id: string; from: { id: number }; data?: string; message?: { chat: { id: number }; message_id: number } } }[] };
      for (const u of j.result ?? []) {
        offset = u.update_id + 1;
        const q = u.callback_query;
        const m = u.message;
        const from = String(q?.from.id ?? m?.from?.id ?? "");
        const chat = String(q?.message?.chat.id ?? m?.chat.id ?? "");
        const text = q?.data ?? m?.text ?? "";
        const isAdmin = admins.includes(from);
        if (!chat) continue;
        // The community guard sees every group message from someone who is not an operator.
        if (m && (m.chat.type === "group" || m.chat.type === "supergroup") && m.from && !m.from.is_bot) {
          const name = m.from.username ? `@${m.from.username}` : (m.from.first_name ?? "someone");
          const gm: GroupMessage = { chat, chatUsername: m.chat.username, messageId: m.message_id, user: String(m.from.id), name, text: m.text ?? m.caption ?? "", replyToBot: Boolean(m.reply_to_message?.from?.is_bot) };
          if (!isAdmin && h.guard) { if (await h.guard(gm).catch(() => false)) continue; }
          else if (isAdmin && h.ask && !gm.text.startsWith("/")) void h.ask(gm).catch(() => {});
        }
        const people = (m?.new_chat_members ?? []).filter((x) => !x.is_bot).map((x) => x.first_name);
        if (people.length && h.joined) { h.joined(chat, people); continue; }
        if (!text.startsWith("/")) {
          if (isAdmin && m?.chat.type === "private" && h.adminText) { const rep = await h.adminText(text).catch(() => null); if (rep) await telegram(token, chat, rep.text, rep.buttons); }
          else if (!isAdmin && m?.chat.type === "private" && m.from && h.ask) void h.ask({ chat, messageId: m.message_id, user: String(m.from.id), name: m.from.first_name ?? "", text, private: true }).catch(() => {});
          continue;
        }
        if (q) void tg(token, "answerCallbackQuery", { callback_query_id: q.id });
        const [raw, ...args] = text.trim().split(/\s+/);
        const cmd = raw!.slice(1).split("@")[0]!.toLowerCase();
        const pub = await h.open(cmd, args).catch(() => null);
        const rt = m?.reply_to_message?.from;
        const ctx: CommandContext = { chat, group: m?.chat.type === "group" || m?.chat.type === "supergroup", replyTo: rt && !rt.is_bot ? { id: String(rt.id), name: rt.username ? `@${rt.username}` : (rt.first_name ?? String(rt.id)) } : undefined };
        const adminHere = isAdmin && (!ctx.group || cmd === "mute" || cmd === "unmute");
        const reply: Reply | null = pub ?? (adminHere ? await h.admin(cmd, args, ctx).catch((e) => ({ text: `⚠️ ${esc((e as Error).message)}` })) : m?.chat.type === "private" ? { text: "🌙 Public commands: /price · /ca · /links" } : null);
        if (!reply) continue;
        if (q?.message && cmd !== "stop") await tg(token, "editMessageText", { chat_id: chat, message_id: q.message.message_id, text: reply.text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb(reply.buttons) });
        else await telegram(token, chat, reply.text, reply.buttons);
      }
    } catch { await new Promise((r) => setTimeout(r, 5000)); }
    setTimeout(() => void loop(), 300);
  };
  void loop();
}
