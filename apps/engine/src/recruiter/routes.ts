import type { IncomingMessage, ServerResponse } from "node:http";
import type { Recruiter } from "./recruiter.js";

/**
 * The owner's recruiter controls, all behind the admin token:
 * GET  /api/admin/recruiter                       the dashboard
 * POST /api/admin/recruiter/pause    {paused}      pause or resume (resume also clears a stop)
 * POST /api/admin/recruiter/stop                   emergency stop: cancels every queued send
 * POST /api/admin/recruiter/channel  {channel, enabled}
 * POST /api/admin/recruiter/run      {dryRun}      one cycle now (a dry run unless dryRun is false)
 * POST /api/admin/recruiter/outbox/:id/approve|skip
 * POST /api/admin/recruiter/responded {opportunityId}   the prospect answered: one follow-up may be drafted
 * POST /api/admin/recruiter/optout    {org}             never contact this organization again
 */
type Ctx = {
  json: (res: ServerResponse, code: number, body: unknown) => void;
  body: (req: IncomingMessage, max?: number) => Promise<Record<string, unknown>>;
  isAdmin(req: IncomingMessage): boolean;
  recruiter: Recruiter;
};

export async function recruiterRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Ctx): Promise<boolean> {
  if (p !== "/api/admin/recruiter" && !p.startsWith("/api/admin/recruiter/")) return false;
  if (!ctx.isAdmin(req)) { ctx.json(res, 401, { error: "Admin only." }); return true; }
  const r = ctx.recruiter;
  if (p === "/api/admin/recruiter") {
    if (req.method !== "GET") { ctx.json(res, 405, { error: "Use GET." }); return true; }
    ctx.json(res, 200, r.dashboard());
    return true;
  }
  if (req.method !== "POST") { ctx.json(res, 405, { error: "Use POST." }); return true; }
  const item = p.match(/^\/api\/admin\/recruiter\/outbox\/([a-f0-9]{6,40})\/(approve|skip)$/);
  if (item) {
    const out = item[2] === "approve" ? r.approve(item[1]!) : r.skip(item[1]!);
    ctx.json(res, out.ok ? 200 : 400, out);
    return true;
  }
  const action = p.slice("/api/admin/recruiter/".length);
  if (!["pause", "stop", "channel", "run", "responded", "optout"].includes(action)) { ctx.json(res, 404, { error: "Not found." }); return true; }
  const b = action === "stop" ? {} : await ctx.body(req, 4_000).catch(() => ({} as Record<string, unknown>));
  if (action === "pause") {
    if (typeof b.paused !== "boolean") { ctx.json(res, 400, { error: "Send {paused: true|false}." }); return true; }
    r.setPaused(b.paused);
    ctx.json(res, 200, { ok: true, state: r.dashboard().state });
  } else if (action === "stop") {
    ctx.json(res, 200, { ok: true, ...r.stop() });
  } else if (action === "channel") {
    if (typeof b.channel !== "string" || typeof b.enabled !== "boolean") { ctx.json(res, 400, { error: "Send {channel, enabled}." }); return true; }
    const out = r.setChannel(b.channel, b.enabled);
    ctx.json(res, out.ok ? 200 : 400, out);
  } else if (action === "run") {
    const out = await r.runCycle({ dryRun: b.dryRun !== false });
    ctx.json(res, out.ok ? 200 : 409, out);
  } else if (action === "responded") {
    const out = r.markResponded(String(b.opportunityId ?? ""));
    ctx.json(res, out.ok ? 200 : 400, out);
  } else {
    const out = r.optOut(String(b.org ?? ""));
    ctx.json(res, out.ok ? 200 : 400, out);
  }
  return true;
}
