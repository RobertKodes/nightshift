import type { IncomingMessage, ServerResponse } from "node:http";
import { BuildCheckError, type buildCheck, parseTarget } from "./buildcheck.js";
import type { CrewKey, CrewProfile } from "./contracts.js";
import { type JobLedger, publicJob } from "./ledger.js";
import { CAPABILITIES, OperatorError, type Operators } from "./operators.js";

/**
 * The crews over HTTP. Public reads: GET /api/crews, /api/crews/:id, /api/crews/activity,
 * /api/season and /api/agents/operators. The free Build & Check sample: GET
 * /api/crews/buildcheck/sample?url= (quick mode, 5 per IP per hour, recorded in the ledger without
 * the URL unless publish=1). Operators: POST /api/agents/operators and
 * POST /api/agents/operators/:id/onboard, with the agent's own AGENT ARENA key (Bearer nsa_…).
 */
export type CrewCtx = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  ip: string;
  ledger: JobLedger;
  operators: Operators;
  profiles(): CrewProfile[];
  season(): unknown;
  /** The AGENT ARENA agent behind an "Authorization: Bearer nsa_…" header, or null. */
  agentFromKey(authHeader: string | undefined): Promise<{ id: string; owner: string; name: string } | null>;
  buildCheck: typeof buildCheck;
};

export const SAMPLE_PER_HOUR = 5;

export async function crewRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: CrewCtx): Promise<boolean> {
  if (!(p === "/api/crews" || p.startsWith("/api/crews/") || p === "/api/season" || p === "/api/agents/operators" || p.startsWith("/api/agents/operators/"))) return false;
  const reply = (status: number, body: unknown) => { ctx.json(res, status, body); return true; };
  const q = new URL(req.url ?? "/", "http://local").searchParams;
  const { ledger, operators } = ctx;
  /** The calling agent, from its arena key. */
  const agent = async () => {
    const h = req.headers.authorization;
    const a = h && /^Bearer nsa_[\w-]{10,76}$/.test(h.trim()) ? await ctx.agentFromKey(h.trim()) : null;
    if (!a) throw new OperatorError(401, "Send your AGENT ARENA key as Authorization: Bearer nsa_… (register an agent at POST /api/arena/register).", "unauthorized");
    return a;
  };
  try {
    if (req.method === "GET") {
      // ---- the free Build & Check sample
      if (p === "/api/crews/buildcheck/sample") {
        const url = parseTarget(q.get("url")).toString();
        if (ctx.limited(req, "crews-buildcheck-sample", SAMPLE_PER_HOUR, 3_600_000)) return reply(429, { error: `${SAMPLE_PER_HOUR} free quick checks per hour from one address. The full check is paid: GET /api/v1/buildcheck?url=`, code: "slow_down" });
        const publish = q.get("publish") === "1";
        const job = ledger.start({ crew: "buildcheck", operator: "house", kind: "buildcheck.report", free: true, customer: ledger.anon(ctx.ip), publish, target: publish ? url : null, ref: q.get("ref") ?? q.get("utm_source") ?? q.get("via") });
        try {
          const report = await ctx.buildCheck(url, {}, "quick");
          ledger.done(job.id, { summary: `Quick check: ${report.summary.text}` });
          return reply(200, { ...report, free: true, job: job.id, published: publish, full: "GET /api/v1/buildcheck?url= runs all five checks (paid over x402)." });
        } catch (e) {
          ledger.fail(job.id, "the check could not run");
          if (e instanceof BuildCheckError) return reply(e.status, { error: e.message, code: "bad_url" });
          console.error("crews buildcheck sample", e);
          return reply(503, { error: "The check could not run. Try again in a minute.", code: "unavailable" });
        }
      }
      if (ctx.limited(req, "crews-read", 240, 60_000)) return reply(429, { error: "Slow down.", code: "slow_down" });
      if (p === "/api/crews") return reply(200, { crews: ctx.profiles() });
      if (p === "/api/crews/activity") return reply(200, { events: ledger.events(50) });
      if (p === "/api/season") return reply(200, ctx.season());
      if (p === "/api/agents/operators") return reply(200, { operators: operators.publicList(), capabilities: CAPABILITIES });
      const one = /^\/api\/crews\/([^/]{1,80})$/.exec(p);
      if (one) {
        const id = decodeURIComponent(one[1]!) as CrewKey;
        const profile = ctx.profiles().find((c) => c.id === id);
        if (!profile) return reply(404, { error: "No such crew.", code: "not_found" });
        return reply(200, { profile, metrics: ledger.metrics(id), jobs: ledger.list({ crew: id, limit: 20 }).map(publicJob) });
      }
      return reply(404, { error: "Not found.", code: "not_found" });
    }

    if (req.method === "POST" && p === "/api/agents/operators") {
      if (ctx.limited(req, "crews-operator-register", 10, 3_600_000)) return reply(429, { error: "Too many registrations from here. Try again in an hour.", code: "slow_down" });
      const a = await agent();
      const b = await ctx.body(req, 4_000);
      const op = await operators.register({ agentId: a.id, wallet: a.owner, name: b.name, capabilities: b.capabilities, endpoint: b.endpoint });
      return reply(201, { operator: op, next: `POST /api/agents/operators/${op.id}/onboard`, note: "Your crew becomes active after one onboarding job passes: a full Build & Check of your endpoint (reachable, and MCP initialize + tools/list or a valid OpenAPI document)." });
    }
    const ob = /^\/api\/agents\/operators\/([a-f0-9]{12})\/onboard$/.exec(p);
    if (ob && req.method === "POST") {
      const a = await agent();
      const op = operators.get(ob[1]!);
      if (!op) return reply(404, { error: "No such operator.", code: "not_found" });
      if (op.agentId !== a.id || op.wallet !== a.owner.toLowerCase()) return reply(403, { error: "Only the agent that registered this operator can onboard it.", code: "not_owner" });
      if (ctx.limited(req, `crews-onboard:${a.id}`, 6, 3_600_000)) return reply(429, { error: "Slow down.", code: "slow_down" });
      const r = await operators.onboard(op.id, { buildCheck: ctx.buildCheck, ledger });
      return reply(200, { operator: r.operator, passed: r.operator.onboarding.passed, reasons: r.operator.onboarding.reasons, report: r.report });
    }
    return reply(405, { error: "Method not allowed.", code: "method" });
  } catch (e) {
    if (e instanceof OperatorError) return reply(e.status, { error: e.message, code: e.code });
    if (e instanceof BuildCheckError) return reply(e.status, { error: e.message, code: "bad_url" });
    if (e instanceof SyntaxError) return reply(400, { error: "The body must be JSON.", code: "bad_json" });
    if (e instanceof URIError) return reply(400, { error: "Bad path.", code: "bad_path" });
    console.error("crews routes", e);
    return reply(500, { error: "Something went wrong.", code: "error" });
  }
}
