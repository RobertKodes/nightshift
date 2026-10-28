import type { IncomingMessage, ServerResponse } from "node:http";
import { clientIp } from "./auth.js";
import { PARTNER_CHAINS, PARTNER_TEMPLATE, PartnerError, type Partners, WANTS, livePartners } from "./partners.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  isAdmin(req: IncomingMessage): boolean;
  partners?: Partners;
};

const failure = (e: unknown) => e instanceof PartnerError ? { status: e.status, body: { error: e.message, code: e.code } }
  : e instanceof Error && e.message === "body too large" ? { status: 413, body: { error: "The body is too large.", code: "too_large" } }
    : e instanceof SyntaxError ? { status: 400, body: { error: "The body must be JSON.", code: "bad_json" } }
      : { status: 503, body: { error: "Applications are unavailable. Try again shortly.", code: "unavailable" } };

/** The partner program: the public list and form, and the operators' review. */
export async function partnerRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/partners")) return false;
  const reply = (code: number, body: unknown, cache = "no-store") => { res.setHeader("Cache-Control", cache); ctx.json(res, code, body); return true; };
  const partners = ctx.partners ?? livePartners();
  try {
    const q = new URL(req.url ?? p, "http://local").searchParams;
    if (req.method === "GET" && p === "/api/partners") return reply(200, { partners: partners.list(), chains: Object.fromEntries(Object.entries(PARTNER_CHAINS).map(([k, c]) => [k, c.name])), wants: WANTS }, "public, max-age=60");
    if (req.method === "GET" && p === "/api/partners/message") {
      if (!q.get("project")) return reply(200, { template: PARTNER_TEMPLATE, query: "project, chain, token, wallet (and chainName for chain=other)" });
      return reply(200, partners.message({ project: q.get("project"), chain: q.get("chain"), token: q.get("token"), chainName: q.get("chainName"), wallet: q.get("wallet") }));
    }
    if (req.method === "POST" && p === "/api/partners/apply") return reply(201, await partners.apply(await ctx.body(req, 20_000), clientIp(req)));
    const status = /^\/api\/partners\/status\/([a-f0-9]{12})$/.exec(p);
    if (req.method === "GET" && status) return reply(200, partners.status(status[1]!));
    if (p === "/api/partners/applications" || /^\/api\/partners\/[a-f0-9]{12}\/decide$/.test(p)) {
      if (!ctx.isAdmin(req)) return reply(401, { error: "wrong admin token", code: "admin" });
      if (req.method === "GET" && p === "/api/partners/applications") return reply(200, { applications: partners.applications() });
      if (req.method === "POST") {
        const b = await ctx.body(req, 2_000), decision = b.decision;
        if (decision !== "accept" && decision !== "decline") return reply(400, { error: "decision: accept or decline.", code: "bad_decision" });
        const r = await partners.decide(p.split("/")[3]!, decision, typeof b.note === "string" ? b.note : "");
        return reply(200, { status: r.app.status, announced: r.announced, xDraft: r.xDraft });
      }
    }
    return reply(req.method === "GET" || req.method === "POST" ? 404 : 405, { error: "Not found.", code: "not_found" });
  } catch (e) {
    const f = failure(e);
    return reply(f.status, f.body);
  }
}
