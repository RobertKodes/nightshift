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

/** The operator's alert channel: a Telegram bot message. Never throws. */
export async function telegram(token: string, chatId: string, text: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3500), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  } catch { return false; }
}

/** Admin commands over Telegram: long-polls the bot and answers only the listed user ids. */
export function telegramCommands(token: string, admins: string[], handle: (cmd: string, args: string[]) => Promise<string>): void {
  let offset = 0;
  const loop = async (): Promise<void> => {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}`, { signal: AbortSignal.timeout(35000) });
      const j = (await r.json()) as { result?: { update_id: number; message?: { chat: { id: number }; from?: { id: number }; text?: string } }[] };
      for (const u of j.result ?? []) {
        offset = u.update_id + 1;
        const m = u.message;
        if (!m?.text?.startsWith("/")) continue;
        const [raw, ...args] = m.text.trim().split(/\s+/);
        const cmd = raw!.slice(1).split("@")[0]!.toLowerCase();
        const reply = admins.includes(String(m.from?.id)) ? await handle(cmd, args).catch((e) => `Error: ${(e as Error).message}`) : "Not allowed.";
        await telegram(token, String(m.chat.id), reply);
      }
    } catch { await new Promise((r) => setTimeout(r, 5000)); }
    setTimeout(() => void loop(), 500);
  };
  void loop();
}
