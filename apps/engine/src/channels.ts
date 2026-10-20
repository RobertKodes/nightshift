/**
 * The four places a company posts, on accounts its owner made: Bluesky (app password, `bot`
 * self-label), a Telegram channel (the NIGHTSHIFT bot as its admin), Mastodon (OAuth on the owner's
 * instance, bot flag) and a Discord channel webhook. Every call goes through `http`, so the engine
 * decides which hosts are reached and tests answer for the platforms. Nothing here follows, likes,
 * replies, sends direct messages or reads anyone else's posts.
 */

/** One HTTP call, the shape of fetch: real in the engine, a fake in tests. */
export type Http = (url: string, init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array }) => Promise<Response>;

/** A platform said no: its words (never a token or a URL), the HTTP status and when to try again. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null, readonly retryAfter: number | null = null) { super(message); }
}

/** A rate limit, a spam or abuse flag: the channel pauses until its owner resumes it. */
export const pushedBack = (e: unknown): boolean => e instanceof ApiError && (e.status === 429 || /rate.?limit|spam|abuse|flood|too many requests/i.test(`${e.code ?? ""} ${e.message}`));

/** A platform's message, short, with anything that looks like a secret taken out. */
export const clean = (s: unknown): string => String(s ?? "").replace(/https?:\/\/\S+/g, "(link)").replace(/\b(bot\d+:[\w-]+|[A-Za-z0-9_-]{32,})\b/g, "•••").slice(0, 200);

async function read(r: Response): Promise<Record<string, unknown>> {
  return (await r.json().catch(() => ({}))) as Record<string, unknown>;
}

// ---------------------------------------------------------------- Bluesky

export const BSKY = "https://bsky.social/xrpc";
export interface BskySession { did: string; handle: string; accessJwt: string; refreshJwt: string }

async function xrpc<T>(http: Http, method: "GET" | "POST", nsid: string, o: { jwt?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
  const q = o.query ? `?${new URLSearchParams(o.query)}` : "";
  const r = await http(`${BSKY}/${nsid}${q}`, {
    method,
    headers: { Accept: "application/json", ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(o.jwt ? { Authorization: `Bearer ${o.jwt}` } : {}) },
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
  });
  const j = await read(r);
  if (!r.ok) throw new ApiError(`Bluesky: ${clean(j.message ?? j.error ?? `HTTP ${r.status}`)}`, r.status, typeof j.error === "string" ? j.error : null, Number(r.headers.get("retry-after")) || null);
  return j as T;
}

/** Signs in with an app password (never the account password). Kept as a session: Bluesky's sign-in limit is low. */
export async function bskyLogin(http: Http, handle: string, appPassword: string): Promise<BskySession> {
  const s = await xrpc<BskySession>(http, "POST", "com.atproto.server.createSession", { body: { identifier: handle.replace(/^@/, ""), password: appPassword } });
  return { did: s.did, handle: s.handle, accessJwt: s.accessJwt, refreshJwt: s.refreshJwt };
}

export async function bskyRefresh(http: Http, refreshJwt: string): Promise<BskySession> {
  const s = await xrpc<BskySession>(http, "POST", "com.atproto.server.refreshSession", { jwt: refreshJwt });
  return { did: s.did, handle: s.handle, accessJwt: s.accessJwt, refreshJwt: s.refreshJwt };
}

const SELF_LABELS = "com.atproto.label.defs#selfLabels";

/**
 * Bluesky asks bots to identify themselves with the `bot` self-label: it is set on the account's
 * profile record, keeping everything else in it (name, bio, picture), once.
 */
export async function bskyBotLabel(http: Http, s: BskySession): Promise<void> {
  let current: { cid?: string; value?: Record<string, unknown> } = {};
  try {
    current = await xrpc(http, "GET", "com.atproto.repo.getRecord", { jwt: s.accessJwt, query: { repo: s.did, collection: "app.bsky.actor.profile", rkey: "self" } });
  } catch (e) { if (!(e instanceof ApiError && (e.code === "RecordNotFound" || e.status === 400 || e.status === 404))) throw e; }
  const value = current.value ?? {};
  const labels = (value.labels as { values?: { val: string }[] } | undefined)?.values ?? [];
  if (labels.some((l) => l.val === "bot")) return;
  const record = { ...value, $type: "app.bsky.actor.profile", labels: { $type: SELF_LABELS, values: [...labels, { val: "bot" }] } };
  await xrpc(http, "POST", "com.atproto.repo.putRecord", { jwt: s.accessJwt, body: { repo: s.did, collection: "app.bsky.actor.profile", rkey: "self", record, ...(current.cid ? { swapRecord: current.cid } : {}) } });
}

/** A post record: the text, its links made clickable (byte offsets, as Bluesky counts them). */
export function bskyRecord(text: string, now = Date.now()): Record<string, unknown> {
  const enc = new TextEncoder();
  const facets = [...text.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => {
    const start = enc.encode(text.slice(0, m.index)).length;
    return { index: { byteStart: start, byteEnd: start + enc.encode(m[0]).length }, features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] };
  });
  return { $type: "app.bsky.feed.post", text, createdAt: new Date(now).toISOString(), langs: ["en"], ...(facets.length ? { facets } : {}) };
}

/** Posts on the account; the post's public URL. */
export async function bskyPost(http: Http, s: BskySession, text: string): Promise<string> {
  const r = await xrpc<{ uri: string }>(http, "POST", "com.atproto.repo.createRecord", { jwt: s.accessJwt, body: { repo: s.did, collection: "app.bsky.feed.post", record: bskyRecord(text) } });
  return `https://bsky.app/profile/${s.handle}/post/${r.uri.split("/").pop()}`;
}

/** Bluesky app passwords look like xxxx-xxxx-xxxx-xxxx: anything else is refused, so the account password is never taken. */
export const APP_PASSWORD = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i;

// ---------------------------------------------------------------- Telegram

export const tgEndpoint = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

async function tg<T>(http: Http, token: string, method: string, body: unknown): Promise<T> {
  const r = await http(tgEndpoint(token, method), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await read(r)) as { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };
  if (!j.ok) throw new ApiError(`Telegram: ${clean(j.description ?? `HTTP ${r.status}`)}`, j.error_code ?? r.status, null, j.parameters?.retry_after ?? null);
  return j.result as T;
}

/** "@name", "t.me/name", "https://t.me/name" or a numeric id ("-100…"), as Telegram's chat_id. */
export function tgChatId(input: string): string {
  const v = input.trim().replace(/^https?:\/\//, "").replace(/^t\.me\//, "@").replace(/\/$/, "");
  if (/^-?\d{5,20}$/.test(v)) return v;
  const name = v.replace(/^@/, "");
  if (!/^[a-zA-Z][\w]{3,31}$/.test(name)) throw new Error("Give the channel as @name, its t.me link, or its id (-100…).");
  return `@${name}`;
}

/**
 * The channel, checked: it is a channel, the NIGHTSHIFT bot is its admin and may post, and (with the
 * owner's Telegram id, known from their alerts link) the owner is its creator or an admin too.
 */
export async function tgChannel(http: Http, token: string, chat: string, ownerId: string | null): Promise<{ id: string; title: string; username: string | null }> {
  const c = await tg<{ id: number; type: string; title?: string; username?: string }>(http, token, "getChat", { chat_id: chat });
  if (c.type !== "channel") throw new Error("That is not a channel. Make a Telegram channel, then add the bot as an admin of it.");
  const me = await tg<{ id: number }>(http, token, "getMe", {});
  const bot = await tg<{ status: string; can_post_messages?: boolean }>(http, token, "getChatMember", { chat_id: c.id, user_id: me.id });
  if (bot.status !== "administrator" || !bot.can_post_messages) throw new Error('The bot is not an admin of this channel with "Post messages" yet. Add it, then try again.');
  if (ownerId) {
    const you = await tg<{ status: string }>(http, token, "getChatMember", { chat_id: c.id, user_id: Number(ownerId) });
    if (you.status !== "creator" && you.status !== "administrator") throw new Error("Your Telegram account is not an admin of this channel, so it cannot be connected to your company.");
  }
  return { id: String(c.id), title: (c.title ?? c.username ?? "channel").slice(0, 60), username: c.username ?? null };
}

/** A channel post: plain text (no markup to inject), its link shown. */
export const tgBody = (chatId: string, text: string) => ({ chat_id: chatId, text, link_preview_options: { is_disabled: false } });

export async function tgPost(http: Http, token: string, chatId: string, text: string): Promise<number> {
  const m = await tg<{ message_id: number }>(http, token, "sendMessage", tgBody(chatId, text));
  return m.message_id;
}

// ---------------------------------------------------------------- Mastodon

/** Statuses, plus the account (to read it and set the bot flag). Nothing that reads timelines or follows. */
export const MASTO_SCOPES = "read:accounts write:accounts write:statuses";

/** The instance as https://host, from what the owner typed ("mastodon.social", a profile link…). */
export function mastoInstance(input: string): string {
  const v = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^@?[^@\s/]+@/, "").split(/[/?#]/)[0] ?? "";
  if (!/^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(v)) throw new Error("Give your Mastodon server, e.g. mastodon.social.");
  return `https://${v}`;
}

async function masto<T>(http: Http, inst: string, method: string, path: string, o: { token?: string; json?: unknown; form?: Record<string, string>; idem?: string } = {}): Promise<T> {
  const r = await http(`${inst}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(o.json !== undefined ? { "Content-Type": "application/json" } : o.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      ...(o.idem ? { "Idempotency-Key": o.idem } : {}),
    },
    ...(o.json !== undefined ? { body: JSON.stringify(o.json) } : o.form ? { body: new URLSearchParams(o.form).toString() } : {}),
  });
  const j = await read(r);
  if (!r.ok) throw new ApiError(`Mastodon: ${clean(j.error_description ?? j.error ?? `HTTP ${r.status}`)}`, r.status, null, Number(r.headers.get("retry-after")) || null);
  return j as T;
}

/** The app is registered on the owner's own instance, by NIGHTSHIFT, once per connection. */
export async function mastoApp(http: Http, inst: string, redirect: string, website: string): Promise<{ client_id: string; client_secret: string }> {
  const a = await masto<{ client_id: string; client_secret: string }>(http, inst, "POST", "/api/v1/apps", { json: { client_name: "NIGHTSHIFT", redirect_uris: redirect, scopes: MASTO_SCOPES, website } });
  if (!a.client_id || !a.client_secret) throw new Error("That server did not register the app. Is it a Mastodon server?");
  return { client_id: a.client_id, client_secret: a.client_secret };
}

export const mastoAuthorizeUrl = (inst: string, clientId: string, redirect: string, state: string) =>
  `${inst}/oauth/authorize?${new URLSearchParams({ client_id: clientId, scope: MASTO_SCOPES, redirect_uri: redirect, response_type: "code", state })}`;

export async function mastoToken(http: Http, inst: string, app: { client_id: string; client_secret: string }, code: string, redirect: string): Promise<string> {
  const t = await masto<{ access_token?: string }>(http, inst, "POST", "/oauth/token", { json: { grant_type: "authorization_code", code, client_id: app.client_id, client_secret: app.client_secret, redirect_uri: redirect, scope: MASTO_SCOPES } });
  if (!t.access_token) throw new Error("Mastodon did not hand out a token.");
  return t.access_token;
}

export const mastoMe = (http: Http, inst: string, token: string) => masto<{ acct: string; url: string; bot?: boolean }>(http, inst, "GET", "/api/v1/accounts/verify_credentials", { token });

/** The account's bot flag ("Automated account" on its profile). */
export async function mastoBot(http: Http, inst: string, token: string): Promise<void> {
  await masto(http, inst, "PATCH", "/api/v1/accounts/update_credentials", { token, form: { bot: "true" } });
}

export const mastoBody = (text: string) => ({ status: text, visibility: "public", language: "en" });

export async function mastoPost(http: Http, inst: string, token: string, text: string, key: string): Promise<string | null> {
  const s = await masto<{ url?: string }>(http, inst, "POST", "/api/v1/statuses", { token, json: mastoBody(text), idem: key });
  return s.url ?? null;
}

export async function mastoRevoke(http: Http, inst: string, app: { client_id: string; client_secret: string }, token: string): Promise<void> {
  await masto(http, inst, "POST", "/oauth/revoke", { json: { client_id: app.client_id, client_secret: app.client_secret, token } });
}

// ---------------------------------------------------------------- Discord

/** A channel webhook: Server Settings → Integrations → Webhooks → Copy Webhook URL. */
export const DISCORD_HOOK = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{5,25})\/([\w-]{20,200})\/?$/;

export async function discordHook(http: Http, url: string): Promise<{ id: string; name: string | null; channelId: string; guildId: string | null }> {
  if (!DISCORD_HOOK.test(url)) throw new Error("That is not a Discord webhook URL (https://discord.com/api/webhooks/…).");
  const r = await http(url, { method: "GET", headers: { Accept: "application/json" } });
  const j = await read(r);
  if (!r.ok) throw new ApiError(`Discord: ${clean(j.message ?? `HTTP ${r.status}`)}`, r.status);
  return { id: String(j.id), name: typeof j.name === "string" ? j.name.slice(0, 60) : null, channelId: String(j.channel_id), guildId: j.guild_id ? String(j.guild_id) : null };
}

/** The message: no one is ever pinged (allowed_mentions empty), the company's name as the sender. */
export const discordBody = (company: string, text: string) => ({ content: text, username: `${company} · AI agent`.replace(/discord|clyde/gi, "").slice(0, 80), allowed_mentions: { parse: [] } });

export async function discordPost(http: Http, url: string, company: string, text: string): Promise<{ id: string; channelId: string }> {
  const r = await http(`${url.replace(/\/$/, "")}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(discordBody(company, text)) });
  const j = await read(r);
  if (!r.ok) throw new ApiError(`Discord: ${clean(j.message ?? `HTTP ${r.status}`)}`, r.status, null, Number(j.retry_after) || Number(r.headers.get("retry-after")) || null);
  return { id: String(j.id), channelId: String(j.channel_id) };
}
