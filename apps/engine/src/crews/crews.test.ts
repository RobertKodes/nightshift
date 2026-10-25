import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { type BuildCheckDeps, buildCheck } from "./buildcheck.js";
import type { CrewKey } from "./contracts.js";
import { fakeFetch, mcpRoutes } from "./crews.fake.js";
import { JobLedger } from "./ledger.js";
import { Operators } from "./operators.js";
import { HOUSE_CREWS, externalProfiles, houseProfiles } from "./profiles.js";
import { type CrewCtx, crewRoutes } from "./routes.js";
import { SEASON_DAYS, scoreOf, season } from "./season.js";

const START = Date.parse("2026-10-20T00:00:00Z");
const DAY = 86_400_000;
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const pay = (payer: string, usd: number) => ({ usd, payer, tx: "0xt", network: "eip155:8453" });

describe("season 1", () => {
  it("counts only customer jobs inside the season and ranks house crews by the stated score", () => {
    let t = START - DAY;
    const l = new JobLedger({ file: null, now: () => t });
    const job = (crew: CrewKey, payment: ReturnType<typeof pay> | null, ok = true, cost = 0) => {
      const j = l.start({ crew, operator: "house", kind: "x.report", free: !payment, payment });
      if (ok) l.done(j.id, { summary: "ok", costUsd: cost }); else l.fail(j.id, "failed");
    };
    job("research", pay(A, 5)); // before the season: ignored
    job("research", pay(B, 5));
    t = START + DAY;
    job("research", pay(A, 0.25), true, 0.1);
    job("research", pay(A, 0.25));
    job("research", pay(B, 0.25), false);
    job("research", pay(DEV, 0.25)); // internal
    job("buildcheck", null);
    const s = season(l, { startAt: START, now: START + 2 * DAY });
    expect(s).toMatchObject({ id: "S1", startsAt: START, endsAt: START + SEASON_DAYS * DAY, day: 3, status: "live" });
    expect(s.title).toBe("Season 1: Can an agent crew cover its operating costs by serving real customers?");
    const research = s.house.find((r) => r.crew === "research")!;
    expect(research).toMatchObject({ rank: 1, name: "Research Desk", completedPaidJobs: 2, acceptance: 0.6667, reliability: 0.75, repeatWallets: 1, revenueUsd: 0.5, knownCostUsd: 0.1, coverage: 5 });
    expect(research.score).toBe(scoreOf(research));
    expect(research.score).toBe(13.75); // (2 + 3 × 1) × 0.75 + 10
    expect(s.house.map((r) => r.crew)).toHaveLength(HOUSE_CREWS.length);
    expect(s.house.find((r) => r.crew === "watchtower")).toMatchObject({ completedPaidJobs: 0, acceptance: null, reliability: null, coverage: null, score: 0 });
    expect(s.rules.some((r) => r.startsWith("score = (completedPaidJobs + 3 × repeatWallets) × reliability"))).toBe(true);
  });

  it("has an empty external table when there are no operators", () => {
    const l = new JobLedger({ file: null, now: () => START + DAY });
    expect(season(l, { startAt: START, now: START + DAY }).external).toEqual([]);
    expect(season(l, { startAt: START, now: START + DAY, operators: [] }).external).toEqual([]);
    // an onboarding job alone does not enter an operator in the season
    const j = l.start({ crew: "op:abc123abc123", operator: "abc123abc123", kind: "onboarding", free: true });
    l.done(j.id, { summary: "Onboarding passed" });
    expect(season(l, { startAt: START, now: START + DAY }).external).toEqual([]);
    expect(season(l, { startAt: START, now: START - DAY })).toMatchObject({ status: "upcoming", day: 0 });
  });
});

describe("crew profiles", () => {
  it("lists the four house crews, live only with a price, with metrics from the ledger", () => {
    const l = new JobLedger({ file: null });
    const metrics = (c: CrewKey) => l.metrics(c);
    const none = houseProfiles({ prices: [], metrics, base: "https://n.example" });
    expect(none.map((p) => [p.id, p.name, p.status, p.operator.kind])).toEqual([
      ["watchtower", "Watchtower", "preview", "house"], ["research", "Research Desk", "preview", "house"], ["buildcheck", "Build & Check", "preview", "house"], ["swarm", "Swarm Desk", "preview", "house"],
    ]);
    const priced = houseProfiles({ prices: [{ offer: "buildcheck", label: "Full check", usd: 0.1, holderUsd: 0.05, crew: "buildcheck" }], metrics, base: "https://n.example" });
    expect(priced[2]).toMatchObject({ status: "live", pricing: [{ offer: "buildcheck", label: "Full check", usd: 0.1, holderUsd: 0.05 }], buy: { http: "GET https://n.example/api/v1/buildcheck?url={url}", mcpTool: null } });
    expect(priced[2]!.sample.href).toBe("https://n.example/api/crews/buildcheck/sample?url=https%3A%2F%2Fn.example%2Fmcp%2Fpublic");
    expect(priced[0]!.buy.mcpTool).toBe("watchtower_sample");
    expect(priced[1]!.buy.mcpTool).toBe("swarm_mind_ask");
    expect(externalProfiles([], metrics)).toEqual([]);
  });
});

// ---- routes, with a fake request and response

type Out = { status: number; body: Record<string, unknown> };
function harness() {
  const ledger = new JobLedger({ file: null });
  const operators = new Operators({ file: null, publicUrl: async () => ({ ok: true }) });
  const f = fakeFetch(mcpRoutes("https://agent.example/mcp"));
  const check = ((t: string, _d: BuildCheckDeps, m: "quick" | "full") => buildCheck(t, { fetch: f.fetch }, m)) as typeof buildCheck;
  const hits = new Map<string, number>();
  const agents: Record<string, { id: string; owner: string; name: string }> = {
    "Bearer nsa_owner-key-0123456789": { id: "aaaaaaaaaaaa", owner: A, name: "Owner bot" },
    "Bearer nsa_other-key-0123456789": { id: "bbbbbbbbbbbb", owner: B, name: "Other bot" },
  };
  const ctx: CrewCtx = {
    json: () => {}, ip: "198.51.100.7", ledger, operators, buildCheck: check,
    body: async (req) => (req as unknown as { payload: Record<string, unknown> }).payload ?? {},
    limited: (_req, key, n) => { const c = (hits.get(key) ?? 0) + 1; hits.set(key, c); return c > n; },
    profiles: () => [...houseProfiles({ prices: [], metrics: (c) => ledger.metrics(c), base: "https://n.example" }), ...externalProfiles(operators, (c) => ledger.metrics(c))],
    season: () => season(ledger, { startAt: 0, now: Date.now(), operators: operators.all() }),
    agentFromKey: async (h) => (h ? agents[h] ?? null : null),
  };
  const call = async (method: string, url: string, o: { auth?: string; payload?: Record<string, unknown> } = {}): Promise<Out | null> => {
    let out: Out | null = null;
    const req = { method, url, headers: o.auth ? { authorization: o.auth } : {}, payload: o.payload } as unknown as IncomingMessage;
    const handled = await crewRoutes(req, {} as ServerResponse, url.split("?")[0]!, { ...ctx, json: (_res, status, body) => { out = { status, body: body as Record<string, unknown> }; } });
    return handled ? out : null;
  };
  return { call, ledger, operators };
}

describe("crew routes", () => {
  it("answers the public reads and leaves other paths alone", async () => {
    const h = harness();
    expect(await h.call("GET", "/api/other")).toBeNull();
    expect((await h.call("GET", "/api/crews"))!.body.crews).toHaveLength(4);
    const one = await h.call("GET", "/api/crews/research");
    expect(one).toMatchObject({ status: 200, body: { profile: { id: "research" }, metrics: { jobs: 0 }, jobs: [] } });
    expect((await h.call("GET", "/api/crews/nope"))!.status).toBe(404);
    expect((await h.call("GET", "/api/season"))!.body).toMatchObject({ id: "S1", external: [] });
  });

  it("runs the free quick check, records it without the URL unless published, and limits it to 5 an hour", async () => {
    const h = harness();
    const target = encodeURIComponent("https://agent.example/mcp");
    const r = await h.call("GET", `/api/crews/buildcheck/sample?url=${target}`);
    expect(r).toMatchObject({ status: 200, body: { mode: "quick", free: true, summary: { checks: 3, pass: 2, warn: 1, fail: 0 } } });
    const [job] = h.ledger.list({ crew: "buildcheck" });
    expect(job).toMatchObject({ free: true, status: "done", kind: "buildcheck.report", publish: false, summary: "Quick check: 3 checks: 2 pass, 1 warn, 0 fail, 0 unavailable" });
    expect(job!.customer).toMatch(/^a:/);
    expect(JSON.stringify(job)).not.toContain("agent.example");
    await h.call("GET", `/api/crews/buildcheck/sample?url=${target}&publish=1`);
    expect(h.ledger.list({ crew: "buildcheck" })[0]!.target).toBe("https://agent.example/mcp");
    const activity = await h.call("GET", "/api/crews/activity");
    expect(JSON.stringify(activity!.body)).not.toContain("198.51.100.7");
    expect((activity!.body.events as unknown[]).length).toBe(2);
    expect((await h.call("GET", "/api/crews/buildcheck/sample?url=ftp%3A%2F%2Fx"))!.status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await h.call("GET", `/api/crews/buildcheck/sample?url=${target}`))!.status).toBe(200);
    expect((await h.call("GET", `/api/crews/buildcheck/sample?url=${target}`))!.status).toBe(429);
  });

  it("registers an operator with the agent's key and lets only that agent onboard it", async () => {
    const h = harness();
    const payload = { name: "Agent Labs", capabilities: ["integration-checks"], endpoint: "https://agent.example/mcp" };
    expect((await h.call("POST", "/api/agents/operators", { payload }))!.status).toBe(401);
    expect((await h.call("POST", "/api/agents/operators", { payload, auth: "Bearer nsk_owner-session" }))!.status).toBe(401);
    const made = await h.call("POST", "/api/agents/operators", { payload, auth: "Bearer nsa_owner-key-0123456789" });
    expect(made).toMatchObject({ status: 201, body: { operator: { status: "pending", agentId: "aaaaaaaaaaaa", wallet: A } } });
    const id = (made!.body.operator as { id: string }).id;
    expect((await h.call("POST", `/api/agents/operators/${id}/onboard`, { auth: "Bearer nsa_other-key-0123456789" }))!.status).toBe(403);
    const on = await h.call("POST", `/api/agents/operators/${id}/onboard`, { auth: "Bearer nsa_owner-key-0123456789" });
    expect(on).toMatchObject({ status: 200, body: { passed: true, operator: { status: "active" } } });
    const list = await h.call("GET", "/api/agents/operators");
    expect(list!.body.operators).toMatchObject([{ id, status: "active", wallet: "0x1111…1111", endpoint: "https://agent.example/mcp" }]);
    expect(JSON.stringify(list!.body)).not.toContain(A);
    expect((await h.call("GET", "/api/crews"))!.body.crews).toHaveLength(4);
    expect((await h.call("GET", "/api/crews"))!.body.external).toHaveLength(1);
    expect((await h.call("GET", `/api/crews/${encodeURIComponent(`op:${id}`)}`))!.status).toBe(200);
  });
});
