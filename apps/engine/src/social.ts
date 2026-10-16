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
export async function blueskyPost(handle: string, appPassword: string, text: string): Promise<string> {
  const s = await blueskySession(handle, appPassword);
  const t = text.length > 300 ? `${text.slice(0, 297)}…` : text;
  const enc = new TextEncoder();
  const facets = [...t.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => {
    const start = enc.encode(t.slice(0, m.index)).length;
    return { index: { byteStart: start, byteEnd: start + enc.encode(m[0]).length }, features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] };
  });
  const r = await xrpc<{ uri: string }>("com.atproto.repo.createRecord", {
    repo: s.did,
    collection: "app.bsky.feed.post",
    record: { $type: "app.bsky.feed.post", text: t, createdAt: new Date().toISOString(), ...(facets.length ? { facets } : {}) },
  }, s.jwt);
  return `https://bsky.app/profile/${s.handle}/post/${r.uri.split("/").pop()}`;
}

export type Button = { text: string; data?: string; url?: string };
export type Reply = { text: string; buttons?: Button[][] };
const kb = (b?: Button[][]) => (b?.length ? { inline_keyboard: b.map((row) => row.map((x) => (x.url ? { text: x.text, url: x.url } : { text: x.text, callback_data: x.data ?? x.text }))) } : undefined);

async function tg(token: string, method: string, body: unknown): Promise<boolean> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch { return false; }
}

/** The operator's alert channel: a Telegram message (HTML), optionally with buttons. Never throws. */
export async function telegram(token: string, chatId: string, text: string, buttons?: Button[][]): Promise<boolean> {
  return tg(token, "sendMessage", { chat_id: chatId, text: text.slice(0, 3800), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb(buttons) });
}

export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

/**
 * The admin bot: long-polls Telegram, answers commands and button presses from the listed user ids
 * only, and registers its command menu and description once.
 */
export function telegramCommands(token: string, admins: string[], handle: (cmd: string, args: string[]) => Promise<Reply>): void {
  void tg(token, "setMyCommands", { commands: [
    { command: "status", description: "Mode, companies, swarm, price" },
    { command: "companies", description: "Every company and its money" },
    { command: "market", description: "What is on sale" },
    { command: "token", description: "The platform token" },
    { command: "report", description: "Today's report" },
    { command: "stop", description: "Pause every company now" },
    { command: "help", description: "All commands" },
  ] });
  void tg(token, "setMyDescription", { description: "NIGHTSHIFT control room: autonomous AI companies that build with the IMD swarm. Status, sales, alerts and an emergency stop." });
  void tg(token, "setMyShortDescription", { short_description: "NIGHTSHIFT control room · alerts, sales, emergency stop" });
  let offset = 0;
  const loop = async (): Promise<void> => {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`, { signal: AbortSignal.timeout(35000) });
      const j = (await r.json()) as { result?: { update_id: number; message?: { chat: { id: number }; from?: { id: number }; text?: string }; callback_query?: { id: string; from: { id: number }; data?: string; message?: { chat: { id: number }; message_id: number } } }[] };
      for (const u of j.result ?? []) {
        offset = u.update_id + 1;
        const q = u.callback_query;
        const m = u.message;
        const from = String(q?.from.id ?? m?.from?.id ?? "");
        const chat = String(q?.message?.chat.id ?? m?.chat.id ?? "");
        const text = q?.data ?? m?.text ?? "";
        if (!chat || !text.startsWith("/")) continue;
        if (q) void tg(token, "answerCallbackQuery", { callback_query_id: q.id });
        const [raw, ...args] = text.trim().split(/\s+/);
        const cmd = raw!.slice(1).split("@")[0]!.toLowerCase();
        const reply: Reply = admins.includes(from) ? await handle(cmd, args).catch((e) => ({ text: `⚠️ ${esc((e as Error).message)}` })) : { text: "🔒 This bot answers the NIGHTSHIFT operator only." };
        if (q?.message && cmd !== "stop") await tg(token, "editMessageText", { chat_id: chat, message_id: q.message.message_id, text: reply.text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb(reply.buttons) });
        else await telegram(token, chat, reply.text, reply.buttons);
      }
    } catch { await new Promise((r) => setTimeout(r, 5000)); }
    setTimeout(() => void loop(), 300);
  };
  void loop();
}
