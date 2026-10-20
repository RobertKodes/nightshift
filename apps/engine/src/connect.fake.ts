import type { Http } from "./channels.js";
import type { GumroadSale } from "./gumroad.js";

/**
 * Test support: Gumroad, Bluesky, Telegram, Mastodon and Discord as their APIs answer, in memory.
 * Every request is recorded (method, URL, headers, body) so a test can check exactly what would have
 * been sent; nothing reaches the network.
 */
export const HOOK = "https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

export function fakePlatforms() {
  type Call = { method: string; url: string; headers: Record<string, string>; body: string; bytes: number };
  const calls: Call[] = [];
  const s = {
    calls,
    gumroad: {
      code: "good-code", token: "gr-token-SECRET-0123456789abcdef",
      user: { user_id: "u-owner", name: "Owner Shop", url: "https://owner.gumroad.com" },
      products: new Map<string, Record<string, string>>(), published: new Set<string>(),
      sales: [] as GumroadSale[], subs: [] as string[], parts: [] as { url: string; bytes: number; type: string; length: string }[],
      blockPublish: false, n: 0,
    },
    bsky: {
      password: "abcd-efgh-ijkl-mnop", did: "did:plc:owner123", handle: "owner.bsky.social",
      profile: { cid: "bafyprofile", value: { $type: "app.bsky.actor.profile", displayName: "Owner", description: "My shop" } as Record<string, unknown> } as { cid: string; value: Record<string, unknown> } | null,
      posts: [] as Record<string, unknown>[], logins: 0, refreshes: 0, expireNext: false, rateLimit: false,
    },
    tg: { chat: { id: -1001234567890, type: "channel", title: "Owner News", username: "ownernews" }, botAdmin: true, ownerStatus: "creator", sent: [] as Record<string, unknown>[] },
    masto: { inst: "https://mastodon.example", secret: "masto-client-SECRET-xyz", token: "masto-token-SECRET-abc", bot: false, statuses: [] as { body: Record<string, unknown>; key: string | undefined }[], revoked: false },
    discord: { posts: [] as Record<string, unknown>[] },
  };
  const g = s.gumroad;

  const res = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });
  const formOf = (body: string) => new URLSearchParams(body);

  const gumroad = (method: string, u: URL, body: string, auth: string | undefined): Response => {
    if (auth !== `Bearer ${g.token}`) return res({ success: false, message: "The access token is invalid" }, 401);
    const p = u.pathname.replace(/^\/v2/, "");
    const f = formOf(body);
    if (method === "GET" && p === "/user") return res({ success: true, user: g.user });
    if (method === "POST" && p === "/products") {
      const id = `gp${++g.n}`;
      g.products.set(id, Object.fromEntries(f));
      if (f.get("draft") !== "true" && f.get("published") !== "false") g.published.add(id);
      return res({ success: true, product: { id, short_url: `https://owner.gumroad.com/l/${id}`, published: g.published.has(id) } });
    }
    const m = /^\/products\/([\w-]+)(?:\/(enable|disable|covers))?$/.exec(p);
    if (m && g.products.has(m[1]!)) {
      const id = m[1]!;
      if (method === "PUT" && !m[2]) { Object.assign(g.products.get(id)!, Object.fromEntries(f)); return res({ success: true, product: { id } }); }
      if (method === "PUT" && m[2] === "enable") { if (g.blockPublish) return res({ success: true, product: { id, published: false }, warning: "Confirm your email address to publish" }); g.published.add(id); return res({ success: true, product: { id, published: true, short_url: `https://owner.gumroad.com/l/${id}` } }); }
      if (method === "PUT" && m[2] === "disable") { g.published.delete(id); return res({ success: true, product: { id, published: false } }); }
      if (method === "POST" && m[2] === "covers") { g.products.get(id)!.cover = f.get("url") ?? ""; return res({ success: true }); }
    }
    if (method === "POST" && p === "/files/presign") return res({ success: true, upload_id: "up-1", key: "attachments/k1", parts: [{ part_number: 1, presigned_url: "https://uploads.s3.example.com/k1?partNumber=1&X-Amz-Signature=abc" }] });
    if (method === "POST" && p === "/files/complete") return f.get("upload_id") === "up-1" && f.get("parts[][etag]") === '"etag-1"' ? res({ success: true, file_url: "https://files.gumroad.example/attachments/k1/file.md" }) : res({ success: false, message: "bad parts" }, 400);
    if (method === "POST" && p === "/files/abort") return res({ success: true });
    if (method === "GET" && p === "/sales") return res({ success: true, sales: g.sales });
    const sale = /^\/sales\/([\w=-]+)$/.exec(p);
    if (method === "GET" && sale) { const x = g.sales.find((y) => y.id === sale[1]); return x ? res({ success: true, sale: x }) : res({ success: false, message: "not found" }, 404); }
    if (method === "PUT" && p === "/resource_subscriptions") { const id = `sub-${f.get("resource_name")}`; g.subs.push(id); return res({ success: true, resource_subscription: { id } }); }
    if (method === "DELETE" && p.startsWith("/resource_subscriptions/")) return res({ success: true });
    return res({ success: false, message: `fake gumroad: ${method} ${p}` }, 404);
  };

  const bsky = (u: URL, body: string, auth: string | undefined): Response => {
    const b = s.bsky;
    const nsid = u.pathname.replace("/xrpc/", "");
    const j = body ? JSON.parse(body) as Record<string, unknown> : {};
    if (nsid === "com.atproto.server.createSession") {
      if (j.password !== b.password) return res({ error: "AuthenticationRequired", message: "Invalid identifier or password" }, 401);
      b.logins++;
      return res({ did: b.did, handle: b.handle, accessJwt: `jwt-a-${b.logins}`, refreshJwt: `jwt-r-${b.logins}` });
    }
    if (nsid === "com.atproto.server.refreshSession") { b.refreshes++; return res({ did: b.did, handle: b.handle, accessJwt: `jwt-a-r${b.refreshes}`, refreshJwt: `jwt-r-r${b.refreshes}` }); }
    if (!auth?.startsWith("Bearer jwt-a-")) return res({ error: "AuthMissing", message: "Authentication Required" }, 401);
    if (b.expireNext) { b.expireNext = false; return res({ error: "ExpiredToken", message: "Token has expired" }, 400); }
    if (nsid === "com.atproto.repo.getRecord") return b.profile ? res({ uri: `at://${b.did}/app.bsky.actor.profile/self`, ...b.profile }) : res({ error: "RecordNotFound", message: "Could not locate record" }, 400);
    if (nsid === "com.atproto.repo.putRecord") { b.profile = { cid: "bafyprofile2", value: j.record as Record<string, unknown> }; return res({ uri: "at://x", cid: "bafyprofile2" }); }
    if (nsid === "com.atproto.repo.createRecord") {
      if (b.rateLimit) return res({ error: "RateLimitExceeded", message: "Rate Limit Exceeded" }, 429, { "retry-after": "60" });
      b.posts.push(j);
      return res({ uri: `at://${b.did}/app.bsky.feed.post/3kpost${b.posts.length}`, cid: "bafypost" });
    }
    return res({ error: "MethodNotImplemented" }, 501);
  };

  const telegram = (u: URL, body: string): Response => {
    const t = s.tg;
    const method = u.pathname.split("/").pop();
    const j = JSON.parse(body || "{}") as Record<string, unknown>;
    const ok = (result: unknown) => res({ ok: true, result });
    if (method === "getChat") return j.chat_id === `@${t.chat.username}` || j.chat_id === String(t.chat.id) ? ok(t.chat) : res({ ok: false, error_code: 400, description: "Bad Request: chat not found" }, 400);
    if (method === "getMe") return ok({ id: 999, is_bot: true, username: "nightshiftimdbot" });
    if (method === "getChatMember") return j.user_id === 999 ? ok({ status: t.botAdmin ? "administrator" : "left", can_post_messages: t.botAdmin }) : ok({ status: t.ownerStatus });
    if (method === "sendMessage") { t.sent.push(j); return ok({ message_id: 40 + t.sent.length, chat: t.chat }); }
    return res({ ok: false, error_code: 404, description: "Not Found" }, 404);
  };

  const mastodon = (method: string, u: URL, body: string, headers: Record<string, string>): Response => {
    const m = s.masto;
    const j = body && headers["Content-Type"] === "application/json" ? JSON.parse(body) as Record<string, unknown> : Object.fromEntries(new URLSearchParams(body));
    if (method === "POST" && u.pathname === "/api/v1/apps") return res({ id: "1", name: "NIGHTSHIFT", client_id: "masto-client-id", client_secret: m.secret, redirect_uri: j.redirect_uris, scopes: j.scopes });
    if (method === "POST" && u.pathname === "/oauth/token") return j.code === "masto-code" && j.client_secret === m.secret ? res({ access_token: m.token, token_type: "Bearer", scope: j.scope }) : res({ error: "invalid_grant" }, 400);
    if (method === "POST" && u.pathname === "/oauth/revoke") { m.revoked = true; return res({}); }
    if (headers.Authorization !== `Bearer ${m.token}`) return res({ error: "The access token is invalid" }, 401);
    if (method === "GET" && u.pathname === "/api/v1/accounts/verify_credentials") return res({ id: "7", acct: "owner", url: `${m.inst}/@owner`, bot: m.bot });
    if (method === "PATCH" && u.pathname === "/api/v1/accounts/update_credentials") { m.bot = j.bot === "true"; return res({ id: "7", acct: "owner", bot: m.bot }); }
    if (method === "POST" && u.pathname === "/api/v1/statuses") { m.statuses.push({ body: j, key: headers["Idempotency-Key"] }); return res({ id: `10${m.statuses.length}`, url: `${m.inst}/@owner/10${m.statuses.length}` }); }
    return res({ error: "Record not found" }, 404);
  };

  const discord = (method: string, u: URL, body: string): Response => {
    if (`${u.origin}${u.pathname}` !== HOOK) return res({ message: "Unknown Webhook", code: 10015 }, 404);
    if (method === "GET") return res({ id: "123456789012345678", type: 1, name: "news", channel_id: "222", guild_id: "111" });
    if (method === "POST" && u.searchParams.get("wait") === "true") { s.discord.posts.push(JSON.parse(body) as Record<string, unknown>); return res({ id: `m${s.discord.posts.length}`, channel_id: "222" }); }
    return res({ message: "405: Method Not Allowed" }, 405);
  };

  const http: Http = async (url, init) => {
    const body = typeof init.body === "string" ? init.body : init.body ? Buffer.from(init.body).toString("utf8") : "";
    const headers = init.headers ?? {};
    calls.push({ method: init.method, url, headers, body, bytes: init.body ? (typeof init.body === "string" ? Buffer.byteLength(init.body) : init.body.length) : 0 });
    const u = new URL(url);
    if (u.host === "api.gumroad.com" && u.pathname === "/oauth/token") {
      const f = formOf(body);
      return f.get("code") === g.code && f.get("grant_type") === "authorization_code" && f.get("client_secret") === "gr-app-secret" ? res({ access_token: g.token, token_type: "bearer", scope: "edit_products view_sales view_payouts", created_at: 1 }) : res({ error: "invalid_grant", error_description: "The provided authorization grant is invalid" }, 400);
    }
    if (u.host === "api.gumroad.com") return gumroad(init.method, u, body, headers.Authorization);
    if (u.host === "uploads.s3.example.com" && init.method === "PUT") { g.parts.push({ url, bytes: init.body ? Buffer.from(init.body).length : 0, type: headers["Content-Type"] ?? "", length: headers["Content-Length"] ?? "" }); return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } }); }
    if (u.host === "bsky.social") return bsky(u, body, headers.Authorization);
    if (u.host === "api.telegram.org") return telegram(u, body);
    if (u.origin === s.masto.inst) return mastodon(init.method, u, body, headers);
    if (u.host === "discord.com") return discord(init.method, u, body);
    return res({ error: `fake: nothing at ${u.host}` }, 502);
  };

  return { http, s };
}
