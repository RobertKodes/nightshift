import type { IncomingMessage, ServerResponse } from "node:http";
import { AGENT_GUIDE, discovery, ecosystem } from "./ecosystem.js";
import { proofhouse } from "./proofhouse.js";

type Context = { owner: string | null; url: URL; json: (res: ServerResponse, status: number, data: unknown) => void; body: (req: IncomingMessage, max?: number) => Promise<Record<string, unknown>>; limited: (req: IncomingMessage, key: string, max: number, ms: number) => boolean };
export async function ecosystemRoutes(req: IncomingMessage, res: ServerResponse, path: string, ctx: Context) {
  if (!path.startsWith("/api/ecosystem") && path !== "/.well-known/nightshift-ecosystem.json" && path !== "/town/agents.md") return false;
  const { json } = ctx;
  if (ctx.limited(req, "ecosystem", 120, 60_000)) { json(res, 429, { error: "Slow down" }); return true; }
  try {
    if (req.method === "GET") {
      if (path === "/town/agents.md") { res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }); res.end(AGENT_GUIDE); }
      else if (path === "/.well-known/nightshift-ecosystem.json") json(res, 200, discovery());
      else if (path === "/api/ecosystem") json(res, 200, ecosystem().snapshot());
      else if (path === "/api/ecosystem/proofhouse") json(res, 200, await proofhouse(ctx.url.searchParams.get("wallet") ?? undefined));
      else json(res, 404, { error: "No such ecosystem resource" });
    } else {
      if (!ctx.owner) { json(res, 401, { error: "Wallet sign-in or Nightshift API key required" }); return true; }
      if (ctx.limited(req, "ecosystem-write", 30, 60_000)) { json(res, 429, { error: "Slow down" }); return true; }
      if (path === "/api/ecosystem/presence" && req.method === "PUT") json(res, 200, ecosystem().presence(ctx.owner, await ctx.body(req, 4096)));
      else if (path === "/api/ecosystem/activity" && req.method === "POST") json(res, 201, ecosystem().report(ctx.owner, await ctx.body(req, 4096)));
      else if (path.startsWith("/api/ecosystem/presence/") && req.method === "DELETE") json(res, 200, ecosystem().remove(ctx.owner, path.slice("/api/ecosystem/presence/".length)));
      else json(res, 405, { error: "Unsupported operation" });
    }
  } catch (e) { json(res, 400, { error: (e as Error).message }); }
  return true;
}
