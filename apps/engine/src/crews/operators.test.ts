import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type BuildCheckDeps, buildCheck } from "./buildcheck.js";
import { fakeFetch, json, mcpRoutes } from "./crews.fake.js";
import { JobLedger } from "./ledger.js";
import { Operators, REONBOARD_MS } from "./operators.js";
import { externalProfiles } from "./profiles.js";

const W = "0xabcdef0123456789abcdef0123456789abcdef01";
const EP = "https://agent.example/mcp";
const T0 = Date.parse("2026-10-25T10:00:00Z");
/** No DNS in tests: every host is public except "private.example". */
const resolve = async (u: string) => (new URL(u).hostname === "private.example" ? null : { ok: true });
const checkWith = (routes: Parameters<typeof fakeFetch>[0]) => {
  const f = fakeFetch(routes);
  return { calls: f.calls, check: ((t: string, _d: BuildCheckDeps, m: "quick" | "full") => buildCheck(t, { fetch: f.fetch, now: () => T0 }, m)) as typeof buildCheck };
};
const setup = (file: string | null = null) => {
  let t = T0;
  const clock = { now: () => t, add: (ms: number) => { t += ms; } };
  return { clock, ops: new Operators({ file, now: clock.now, publicUrl: resolve }), ledger: new JobLedger({ file: null, now: clock.now }) };
};
const reg = (ops: Operators, agentId: string, over: Record<string, unknown> = {}) =>
  ops.register({ agentId, wallet: W, name: `Crew ${agentId.slice(0, 4)}`, capabilities: ["research"], endpoint: EP, ...over });

describe("operators", () => {
  it("notifies only after a successful new registration", async () => {
    const names: string[] = [];
    const ops = new Operators({ file: null, publicUrl: resolve, onRegistered: (op) => { names.push(op.name); } });
    await reg(ops, "aaaaaaaaaaaa");
    await expect(reg(ops, "aaaaaaaaaaaa")).rejects.toMatchObject({ status: 409 });
    expect(names).toEqual(["Crew aaaa"]);
  });

  it("activates an operator only after its onboarding job passed", async () => {
    const { ops, ledger } = setup();
    const op = await reg(ops, "aaaaaaaaaaaa", { capabilities: ["research", "Data", "research"] });
    expect(op).toMatchObject({ status: "pending", activatedAt: null, capabilities: ["research", "data"], wallet: W });
    expect(externalProfiles(ops, (c) => ledger.metrics(c))).toEqual([]);
    expect(ops.publicList()[0]).toMatchObject({ wallet: "0xabcd…ef01", endpoint: null, status: "pending" });

    const { check, calls } = checkWith(mcpRoutes(EP));
    const r = await ops.onboard(op.id, { buildCheck: check, ledger });
    expect(r.operator).toMatchObject({ status: "active", activatedAt: T0, onboarding: { passed: true, at: T0 } });
    expect(r.report.mode).toBe("full");
    expect(calls.every((c) => c.url.startsWith("https://agent.example/"))).toBe(true);
    const jobs = ledger.list({ crew: `op:${op.id}` });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: "onboarding", free: true, status: "done", operator: op.id, id: r.operator.onboarding.jobId });

    const profiles = externalProfiles(ops, (c) => ledger.metrics(c));
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ id: `op:${op.id}`, status: "live", operator: { kind: "external", wallet: "0xabcd…ef01" }, pricing: [] });
    expect(profiles[0]!.metrics.jobs).toBe(1);
    expect(ops.publicList()[0]!.endpoint).toBe(EP);
    await expect(ops.onboard(op.id, { buildCheck: check, ledger })).rejects.toMatchObject({ status: 409 });
  });

  it("keeps a failing endpoint failed, with reasons, and lets it retry once an hour", async () => {
    const { ops, ledger, clock } = setup();
    const op = await reg(ops, "bbbbbbbbbbbb");
    // reachable, but neither MCP nor OpenAPI
    const { check } = checkWith({ [`GET ${EP}`]: () => json(200, { hello: "world" }) });
    const r = await ops.onboard(op.id, { buildCheck: check, ledger });
    expect(r.operator.status).toBe("failed");
    expect(r.operator.activatedAt).toBeNull();
    expect(r.operator.onboarding.passed).toBe(false);
    expect(r.operator.onboarding.reasons.join(" ")).toContain("MCP: initialize and tools/list (fail)");
    expect(r.operator.onboarding.reasons.join(" ")).toContain("An active crew needs");
    expect(ledger.list({ crew: `op:${op.id}` })[0]).toMatchObject({ status: "failed", kind: "onboarding" });
    expect(externalProfiles(ops.all(), (c) => ledger.metrics(c))).toEqual([]);

    await expect(ops.onboard(op.id, { buildCheck: check, ledger })).rejects.toMatchObject({ status: 429 });
    clock.add(REONBOARD_MS);
    const again = await ops.onboard(op.id, { buildCheck: check, ledger });
    expect(again.operator.status).toBe("failed");
    // a check that cannot run is not held against the operator
    clock.add(REONBOARD_MS);
    const broken = (async () => { throw new Error("boom"); }) as unknown as typeof buildCheck;
    await expect(ops.onboard(op.id, { buildCheck: broken, ledger })).rejects.toMatchObject({ status: 503 });
    expect(ops.get(op.id)!.status).toBe("failed");
  });

  it("allows one operator per agent and three per wallet, and checks names, capabilities and endpoints", async () => {
    const { ops } = setup();
    await reg(ops, "cccccccccccc");
    await expect(reg(ops, "cccccccccccc", { name: "Other name" })).rejects.toMatchObject({ status: 409, code: "already_registered" });
    await reg(ops, "dddddddddddd");
    await reg(ops, "eeeeeeeeeeee");
    await expect(reg(ops, "ffffffffffff")).rejects.toMatchObject({ status: 429, code: "too_many" });
    const other = (id: string, over: Record<string, unknown>) => reg(ops, id, { wallet: "0x9999999999999999999999999999999999999999", ...over });
    await expect(other("111111111111", { name: "ab" })).rejects.toMatchObject({ code: "bad_name" });
    await expect(other("111111111111", { name: "<script>x</script>" })).rejects.toMatchObject({ code: "bad_name" });
    await expect(other("111111111111", { name: "NIGHTSHIFT Ops" })).rejects.toMatchObject({ code: "reserved_name" });
    await expect(other("111111111111", { name: "Crew cccc" })).rejects.toMatchObject({ code: "name_taken" });
    await expect(other("111111111111", { name: "Fine Name", capabilities: [] })).rejects.toMatchObject({ code: "bad_capabilities" });
    await expect(other("111111111111", { name: "Fine Name", capabilities: ["research", "mining"] })).rejects.toMatchObject({ code: "bad_capabilities" });
    await expect(other("111111111111", { name: "Fine Name", endpoint: "http://agent.example/mcp" })).rejects.toMatchObject({ code: "bad_endpoint" });
    await expect(other("111111111111", { name: "Fine Name", endpoint: "https://private.example/mcp" })).rejects.toMatchObject({ code: "bad_endpoint" });
    await expect(other("111111111111", { name: "Fine Name", endpoint: "https://agent.example:8443/mcp" })).rejects.toMatchObject({ code: "bad_endpoint" });
    expect((await other("111111111111", { name: "Fine Name" })).status).toBe("pending");
  });

  it("persists, and a suspended operator cannot onboard", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "crews-ops-")), "operators.json");
    const { ops, ledger } = setup(file);
    const op = await reg(ops, "123456789abc");
    ops.suspend(op.id);
    const back = new Operators({ file, publicUrl: resolve });
    expect(back.get(op.id)).toMatchObject({ status: "suspended", name: op.name });
    await expect(back.onboard(op.id, { buildCheck: checkWith(mcpRoutes(EP)).check, ledger })).rejects.toMatchObject({ status: 403 });
    expect(ledger.list()).toHaveLength(0);
  });
});
