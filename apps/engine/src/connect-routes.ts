import type { IncomingMessage, ServerResponse } from "node:http";
import { CHANNELS, type ChannelKind, type Company } from "@nightshift/core";
import type { Connect } from "./connect.js";
import { coverPng } from "./gumroad.js";

type Ctx = {
  json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  url: URL;
  connect: Connect;
  /** The signed-in caller's wallet (null: nobody, or a local engine without sign-in). */
  owner: string | null;
  find: (idOrSlug: string) => Company | undefined;
};

const kindOf = (s: string | undefined): ChannelKind | null => (CHANNELS as string[]).includes(s ?? "") ? (s as ChannelKind) : null;

/**
 * The owner's Connections tab: /api/companies/:id/connect/... (the caller was checked as the owner
 * before this is reached). Every change is a POST; answers carry no secret.
 */
export async function ownerConnectRoutes(req: IncomingMessage, res: ServerResponse, c: Company, rest: string[], x: Ctx): Promise<boolean> {
  if (req.method !== "POST") return false;
  if (x.limited(req, `connect:${c.id}`, 40, 60_000)) { x.json(res, 429, { error: "slow down" }); return true; }
  const k = x.connect;
  const [a, b, d] = rest;
  const ok = (v: unknown = { ok: true }) => { x.json(res, 200, v); return true; };
  try {
    if (a === "gumroad" && !b) return ok({ url: k.gumroadStart(c, x.owner) });
    if (a === "gumroad" && b === "disconnect") { await k.gumroadDisconnect(c); return ok(); }
    if (a === "gumroad" && (b === "approve" || b === "decline") && d) { if (b === "approve") k.gumroadApprove(c, d); else k.gumroadDecline(c, d); return ok(); }
    if (a === "quiet") { k.setQuiet(c, await x.body(req)); return ok(); }
    if (a === "posts" && b && (d === "approve" || d === "reject")) { if (d === "approve") k.approvePost(c, b); else k.rejectPost(c, b); return ok(); }
    const kind = kindOf(a);
    if (kind && !b) {
      const v = await x.body(req);
      if (kind === "bluesky") { const ch = await k.connectBluesky(c, String(v.handle ?? ""), String(v.appPassword ?? "")); return ok({ ok: true, label: ch.label }); }
      if (kind === "telegram") { const ch = await k.connectTelegram(c, String(v.chat ?? "")); return ok({ ok: true, label: ch.label }); }
      if (kind === "discord") { const ch = await k.connectDiscord(c, String(v.url ?? "")); return ok({ ok: true, label: ch.label }); }
      return ok({ url: await k.mastodonStart(c, x.owner, String(v.instance ?? "")) });
    }
    if (kind && b === "disconnect") { await k.disconnect(c, kind); return ok(); }
    if (kind && b === "settings") { const ch = k.channelSettings(c, kind, await x.body(req)); return ok({ ok: true, approveEach: ch.approveEach, dailyMax: ch.dailyMax, listed: ch.listed }); }
    if (kind && b === "test") return ok(await k.preview(c, kind));
  } catch (e) {
    x.json(res, 400, { error: (e as Error).message });
    return true;
  }
  return false;
}

/** Back to the owner desk on the company's Connections tab, saying how it went. */
function back(res: ServerResponse, companyId: string | undefined, said: { ok?: string; error?: string }): void {
  const q = new URLSearchParams({ ...(companyId ? { edit: companyId, tab: "connections" } : {}), ...(said.ok ? { connected: said.ok } : {}), ...(said.error ? { error: said.error.slice(0, 200) } : {}) });
  res.writeHead(302, { Location: `/my?${q}`, "Cache-Control": "no-store" });
  res.end();
}

/** The public side: the OAuth callbacks (Gumroad, Mastodon), Gumroad's sale pings, and the covers Gumroad reads. */
export async function connectRoutes(req: IncomingMessage, res: ServerResponse, p: string, x: Ctx): Promise<boolean> {
  const seg = p.split("/").filter(Boolean); // api connect …
  if (seg[0] !== "api" || seg[1] !== "connect") return false;
  const k = x.connect;
  if ((seg[2] === "gumroad" || seg[2] === "mastodon") && seg[3] === "callback" && req.method === "GET") {
    if (x.limited(req, "connect-callback", 30, 60_000)) { x.json(res, 429, { error: "slow down" }); return true; }
    const code = x.url.searchParams.get("code") ?? "", state = x.url.searchParams.get("state") ?? "";
    const denied = x.url.searchParams.get("error");
    if (denied || !code || !state) { back(res, undefined, { error: denied ? "You did not allow it, so nothing was connected." : "That link is missing its code." }); return true; }
    try {
      const c = seg[2] === "gumroad" ? await k.gumroadCallback(code, state, x.owner, x.find) : await k.mastodonCallback(code, state, x.owner, x.find);
      back(res, c.id, { ok: seg[2] });
    } catch (e) {
      back(res, (e as { companyId?: string }).companyId, { error: (e as Error).message });
    }
    return true;
  }
  if (seg[2] === "gumroad" && seg[3] === "ping" && seg[4] && seg[5] && req.method === "POST") {
    if (x.limited(req, `gumroad-ping:${seg[4]}`, 120, 60_000)) { x.json(res, 429, { error: "slow down" }); return true; }
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) { x.json(res, 413, { error: "too large" }); return true; } }
    // Gumroad pings are form fields; JSON is read too
    const fields = new URLSearchParams((req.headers["content-type"] ?? "").includes("json") ? Object.entries(JSON.parse(raw || "{}") as Record<string, unknown>).map(([a, b]): [string, string] => [a, String(b)]) : raw);
    const known = await k.gumroadPing(seg[4], seg[5], fields, x.find).catch((e) => { console.error("gumroad ping", (e as Error).message); return true; });
    x.json(res, known ? 200 : 404, known ? { ok: true } : { error: "not found" });
    return true;
  }
  if (seg[2] === "cover" && seg[3] && seg[4] && req.method === "GET") {
    if (x.limited(req, "connect-cover", 60, 60_000)) { x.json(res, 429, { error: "slow down" }); return true; }
    const c = x.find(seg[3]);
    const product = c?.products.find((y) => `${y.id}.png` === seg[4] && y.status === "live");
    if (!c || !product) { x.json(res, 404, { error: "no such product" }); return true; }
    const png = x.connect.cover(c, product);
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length, "Cache-Control": "public, max-age=3600" });
    res.end(png);
    return true;
  }
  return false;
}
