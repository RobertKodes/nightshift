import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ImdPlane } from "@nightshift/imd";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACP_AGENT, ACP_OFFERINGS, ACP_WALLET, AcpBridge, acpKind, type AcpEvent } from "./acp-bridge.js";
import { SwarmDesk, SWARM_IMD } from "./swarm.js";
import { JobLedger } from "./ledger.js";

const A = "0x1111111111111111111111111111111111111111";
const NOW = Date.parse("2026-10-26T12:00:00Z");
const BRIEF = "Research the IMD ecosystem with sources and concrete examples.";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    if (!resolve(dir).startsWith(resolve(join(tmpdir(), "nightshift-acp-")))) throw new Error("Unexpected test directory");
    rmSync(dir, { recursive: true, force: true });
  }
});
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "nightshift-acp-")); dirs.push(dir); return dir; };

function harness(dir: string | null = null) {
  const h = { now: NOW, enabled: true, deskOn: true, cap: 100, max: 25, imd: 10n ** 19n, eth: 10n ** 18n,
    blocked: false, failed: false, done: false, crash: false, evaluator: A, trace: [] as string[], events: [] as AcpEvent[],
    history: [] as AcpEvent["entry"][], state: "open", brief: BRIEF, offering: "IMD Swarm: Research report", require: true,
    budgetLost: false, submitLost: false, auth: true, signer: true };
  const created = { kind: "system", event: { type: "job.created", client: A, provider: ACP_WALLET } };
  h.history.push(created);
  const plane: ImdPlane = {
    mode: "live",
    capabilities: vi.fn<ImdPlane["capabilities"]>(async () => ({ price: SWARM_IMD, asset: A, payTo: A, network: "eip155:1", quoteTtlSeconds: 600 })),
    check: vi.fn<ImdPlane["check"]>(async (action) => { h.trace.push("check"); return { action, blockers: h.blocked ? [{ message: "IMD refuses this task" }] : [], suggestions: [], plan: [] }; }),
    open: vi.fn<ImdPlane["open"]>(async (action, _body, hooks) => {
      h.trace.push("open"); await hooks?.onQuote?.("imd-order-1");
      if (h.crash) throw new Error("Lost IMD answer");
      return { orderId: "imd-order-1", action, state: "admitted", jobId: "imd-job-1", txHash: `0x${"a".repeat(64)}` };
    }),
    order: vi.fn<ImdPlane["order"]>(async (orderId) => ({ orderId, action: "job.open", state: "admitted", jobId: "imd-job-1", txHash: `0x${"a".repeat(64)}` })),
    job: vi.fn<ImdPlane["job"]>(async (jobId) => ({ jobId, state: h.failed ? "failed" : h.done ? "completed" : "running", stepsDone: 1, stepsTotal: 2, activity: "working" })),
    result: vi.fn(async (jobId) => ({ jobId, siteUrl: "https://example.ipfs.site", repoUrl: "https://github.com/example/result", files: { "report.md": "https://api.imd.fun/jobs/imd-job-1/report.md", image: "https://api.imd.fun/jobs/imd-job-1/artifacts/image.png" }, summary: "Delivered" })),
  };
  const ledger = new JobLedger({ file: dir ? join(dir, "ledger.json") : null, now: () => h.now });
  const record = vi.fn((o, r) => {
    const j = ledger.start({ key: `${r.payer}:${r.nonce}`, crew: o.crew, operator: "house", kind: r.kind, free: false, payment: { usd: r.usd, payer: r.payer, network: r.network, tx: r.tx } });
    if (!r.pending) { if (r.ok) ledger.done(j.id, { summary: r.summary, costUsd: r.costUsd }); else ledger.fail(j.id, r.error, r.costUsd); }
  });
  const alert = vi.fn(async (_text: string, _topic: string) => true);
  const deps = { file: dir ? join(dir, "swarm.json") : null, plane, enabled: () => h.deskOn, dailyImd: () => h.cap, inFlight: () => h.max,
    price: () => ({ usd: 6.87, at: h.now }), funds: vi.fn(async () => { h.trace.push("funds"); return { imd: h.imd, eth: h.eth, gasRequired: 10n ** 15n }; }),
    settled: vi.fn(() => null), pending: () => false, record, alert, now: () => h.now };
  let desk = new SwarmDesk(deps);
  const runner = {
    run: vi.fn(async (args: string[]): Promise<unknown> => {
      const cmd = args.slice(0, 2).join(" ");
      if (cmd === "agent whoami") { if (!h.auth) throw new Error("Not authenticated"); return { id: ACP_AGENT, walletAddress: ACP_WALLET }; }
      if (cmd === "offering list") return Object.keys(ACP_OFFERINGS).map((name, i) => ({ id: String(i), name, priceType: "fixed", priceValue: 4, isHidden: true, requiredFunds: false }));
      if (cmd === "job list") { if (!h.signer) throw new Error("No local signer"); return { jobs: [{ onChainJobId: "42", chainId: 8453, clientAddress: A, providerAddress: ACP_WALLET, evaluatorAddress: h.evaluator, description: h.offering }] }; }
      if (cmd === "events drain") return { events: h.events.splice(0), remaining: 0 };
      if (cmd === "job history") {
        if (h.require && !h.history.some((e) => e.contentType === "requirement")) h.history.push({ kind: "message", contentType: "requirement", content: JSON.stringify({ brief: h.brief }), from: A });
        return { status: h.state, entries: h.history };
      }
      if (cmd === "provider set-budget") {
        h.trace.push("budget"); h.state = "budget_set"; h.history.push({ kind: "system", event: { type: "budget.set", amount: 4 } });
        if (h.budgetLost) throw new Error("Lost budget answer");
        return { success: true };
      }
      if (cmd === "provider submit") {
        h.trace.push("submit"); h.state = "submitted"; h.history.push({ kind: "system", event: { type: "job.submitted", deliverable: args[args.indexOf("--deliverable") + 1] } });
        if (h.submitLost) throw new Error("Lost submit answer");
        return { success: true };
      }
      if (cmd === "message send") return { success: true };
      throw new Error(`Unexpected CLI command ${cmd}`);
    }),
    listen: vi.fn(() => ({ stop: vi.fn() })),
  };
  const bridgeDeps = () => ({ file: dir ? join(dir, "acp.json") : null, eventsFile: "unused.jsonl", enabled: () => h.enabled, runner, desk, alert, now: () => h.now });
  let bridge = new AcpBridge(bridgeDeps());
  const event = (type: string, extra: Record<string, unknown> = {}) => {
    const entry = { kind: "system", event: { type, ...extra } };
    h.history.push(entry); h.events.push({ jobId: "42", chainId: 8453, roles: ["provider"], status: h.state, entry });
  };
  const fund = async () => { h.now += 30_000; h.state = "funded"; event("job.funded", { client: A, amount: 4 }); await bridge.tick(); };
  return { h, plane, deps, record, ledger, alert, runner, event, fund, get desk() { return desk; }, get bridge() { return bridge; },
    restart: () => { desk = new SwarmDesk(deps); bridge = new AcpBridge(bridgeDeps()); },
    commands: (cmd: string) => runner.run.mock.calls.filter(([args]) => args.slice(0, 2).join(" ") === cmd) };
}

describe("ACP provider bridge", () => {
  it("maps each of the nine exact offering names", () => {
    expect(Object.values(ACP_OFFERINGS).sort()).toEqual(["research", "website", "audit", "contract", "tests", "review", "frontend", "image", "logo"].sort());
    for (const [name, kind] of Object.entries(ACP_OFFERINGS)) expect(acpKind(name)).toBe(kind);
    expect(acpKind("toString")).toBeNull(); expect(acpKind("unknown")).toBeNull();
  });

  it("does nothing while off, including auth and listener startup", async () => {
    const x = harness(); x.h.enabled = false; await x.bridge.tick();
    expect(x.runner.run).not.toHaveBeenCalled(); expect(x.runner.listen).not.toHaveBeenCalled();
  });

  it("waits for the first requirement and checks before proposing $4, reserving IMD", async () => {
    const x = harness(); x.h.require = false; await x.bridge.tick();
    expect(x.commands("provider set-budget")).toHaveLength(0);
    x.h.require = true; await x.bridge.tick();
    expect(x.h.trace.indexOf("check")).toBeLessThan(x.h.trace.indexOf("budget"));
    expect(x.h.trace.indexOf("funds")).toBeLessThan(x.h.trace.indexOf("budget"));
    expect(x.commands("provider set-budget")[0]![0]).toEqual(["provider", "set-budget", "--job-id", "42", "--chain-id", "8453", "--amount", "4.00"]);
    expect(x.desk.reservations()).toBe(SWARM_IMD);
    expect(x.plane.open).not.toHaveBeenCalled(); expect(x.deps.settled).not.toHaveBeenCalled();
    expect(x.alert).toHaveBeenCalledWith(expect.stringContaining("accepted"), expect.any(String));
  });

  it.each(["requirements", "offering", "check", "capacity", "cap", "imd", "gas", "off", "evaluator"])("refuses %s before any budget or IMD payment", async (failure) => {
    const x = harness();
    if (failure === "requirements") x.h.brief = "short";
    if (failure === "offering") x.h.offering = "Unknown";
    if (failure === "check") x.h.blocked = true;
    if (failure === "capacity") x.h.max = 0;
    if (failure === "cap") x.h.cap = 0;
    if (failure === "imd") x.h.imd = SWARM_IMD - 1n;
    if (failure === "gas") x.h.eth = 0n;
    if (failure === "off") x.h.deskOn = false;
    if (failure === "evaluator") x.h.evaluator = `0x${"0".repeat(40)}`;
    await x.bridge.tick();
    expect(x.commands("provider set-budget")).toHaveLength(0); expect(x.plane.open).not.toHaveBeenCalled();
    expect(x.commands("message send")[0]![0]).toContainEqual(expect.stringContaining("cannot accept"));
    expect(x.bridge.status().rejected).toBe(1);
  });

  it.each([null, [], { brief: 42 }, { brief: BRIEF, command: "execute" }, { brief: BRIEF, repo: "https://github.com/example/repo" }])("refuses malformed requirements %j", async (input) => {
    const x = harness(); x.h.require = false;
    x.h.history.push({ kind: "message", from: A, contentType: "requirement", content: JSON.stringify(input) });
    await x.bridge.tick(); expect(x.commands("provider set-budget")).toHaveLength(0);
    expect(x.plane.check).not.toHaveBeenCalled(); expect(x.bridge.status().rejected).toBe(1);
  });

  it("uses the first requirement in history even if a later message drains first", async () => {
    const x = harness(); x.h.require = false;
    x.h.history.push({ kind: "message", from: A, contentType: "requirement", content: '{"brief":"short"}' });
    x.h.events.push({ jobId: "42", chainId: 8453, status: "open", roles: ["provider"], entry: { kind: "message", from: A, contentType: "requirement", content: JSON.stringify({ brief: BRIEF }) } });
    await x.bridge.tick(); expect(x.commands("provider set-budget")).toHaveLength(0); expect(x.bridge.status().rejected).toBe(1);
  });

  it("refuses missing requirements after allowing asynchronous messages to arrive", async () => {
    const x = harness(); x.h.require = false; await x.bridge.tick(); x.h.now += 120_000; await x.bridge.tick();
    expect(x.commands("message send")[0]![0]).toContainEqual(expect.stringContaining("did not arrive"));
    expect(x.commands("provider set-budget")).toHaveLength(0);
  });

  it("refuses subscription jobs which could change the fixed budget", async () => {
    const x = harness(); x.h.require = false;
    x.h.history.push({ kind: "message", from: A, contentType: "requirement", content: JSON.stringify({ brief: BRIEF }), packageId: 1 });
    await x.bridge.tick(); expect(x.commands("provider set-budget")).toHaveLength(0);
    expect(x.commands("message send")[0]![0]).toContainEqual(expect.stringContaining("Subscription"));
  });

  it("opens only after funded and reuses the exact freely checked body", async () => {
    const x = harness(); await x.bridge.tick(); await x.fund();
    expect(x.plane.open).toHaveBeenCalledExactlyOnceWith("job.open", vi.mocked(x.plane.check).mock.calls[0]![1], expect.any(Object));
    expect(x.record).toHaveBeenCalledWith(expect.objectContaining({ crew: "swarm" }), expect.objectContaining({ kind: "swarm.research", payer: A, usd: 4, network: "virtuals-acp", tx: null, pending: true }));
    expect(x.desk.revenue()).toEqual([]);
  });

  it("holds capacity against both ACP and paid desk orders while waiting for funding", async () => {
    const x = harness(); x.h.max = 1; await x.bridge.tick();
    await expect(x.desk.internalOrder({ kind: "research", input: { brief: BRIEF }, payer: A, source: "acp", ref: "8453:other" })).rejects.toMatchObject({ status: 503 });
    const q = await x.desk.quote("research", BRIEF, null, "");
    await expect(x.desk.order(q.quoteId, { payer: A, nonce: "new", usd: q.priceUsd, network: "eip155:8453", validBefore: 0 }, vi.fn(), () => false)).rejects.toMatchObject({ status: 503 });
  });

  it("resumes a funded order after restart and duplicate events without buying again", async () => {
    const dir = temp(), x = harness(dir); await x.bridge.tick(); await x.fund();
    expect(readFileSync(join(dir, "acp.json"), "utf8")).toContain("imd-order-1");
    x.restart(); await x.bridge.tick(); await x.fund();
    expect(x.plane.open).toHaveBeenCalledTimes(1);
    expect(x.plane.order).toHaveBeenCalledWith("imd-order-1");
  });

  it("recovers the gap between the saved desk open and the bridge write", async () => {
    const dir = temp(), x = harness(dir); await x.bridge.tick(); await x.fund();
    const file = join(dir, "acp.json"), data = JSON.parse(readFileSync(file, "utf8"));
    data.jobs[0].phase = "opening"; delete data.jobs[0].imdOrderId; writeFileSync(file, JSON.stringify(data));
    x.restart(); await x.bridge.tick(); expect(x.plane.open).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("never retries an ambiguous IMD open with saved id=%s", async (saved) => {
    const x = harness(temp()); await x.bridge.tick();
    if (saved) x.h.crash = true;
    else vi.mocked(x.plane.open).mockRejectedValue(new Error("Lost answer before onQuote"));
    await x.fund(); x.restart(); await x.bridge.tick();
    expect(x.plane.open).toHaveBeenCalledTimes(1);
    expect(x.commands("provider submit")[0]![0]).toContainEqual(expect.stringContaining("FAILURE"));
  });

  it("reconciles a lost budget response and a lost submission response", async () => {
    const x = harness(temp()); x.h.budgetLost = true; await x.bridge.tick(); x.restart(); await x.bridge.tick();
    expect(x.commands("provider set-budget")).toHaveLength(1);
    await x.fund(); x.h.done = true; x.h.now += 30_000; x.h.submitLost = true;
    await x.bridge.tick(); x.restart(); await x.bridge.tick();
    expect(x.commands("provider submit")).toHaveLength(1); expect(x.plane.open).toHaveBeenCalledTimes(1);
  });

  it("submits artifact URLs, IPFS, report.md, job id and receipt, then books the escrow outcome", async () => {
    const x = harness(); await x.bridge.tick(); await x.fund(); x.h.done = true; x.h.now += 30_000; await x.bridge.tick();
    const args = x.commands("provider submit")[0]![0], delivery = args[args.indexOf("--deliverable") + 1]!;
    for (const value of ["imd-job-1", "imd-order-1", "https://example.ipfs.site", "report.md", "artifacts/image.png", "https://etherscan.io/tx/"]) expect(delivery).toContain(value);
    expect(x.ledger.list()[0]?.status).toBe("running");
    expect(x.ledger.metrics("swarm").revenueUsd).toBe(0);
    x.h.state = "completed"; x.event("job.completed"); await x.bridge.tick();
    expect(x.ledger.list()[0]?.status).toBe("done"); expect(x.ledger.metrics("swarm").revenueUsd).toBe(4);
    await x.fund(); expect(x.plane.open).toHaveBeenCalledTimes(1); expect(x.bridge.status().running).toBe(0);
  });

  it("records returned escrow as failed and alerts once on rejection", async () => {
    const x = harness(); await x.bridge.tick(); await x.fund(); x.h.done = true; x.h.now += 30_000; await x.bridge.tick();
    x.h.state = "rejected"; x.event("job.rejected", { reason: "Client rejected" }); await x.bridge.tick(); await x.bridge.tick();
    expect(x.ledger.list()[0]?.status).toBe("failed"); expect(x.ledger.metrics("swarm").revenueUsd).toBe(0);
    expect(x.alert.mock.calls.filter(([text]) => String(text).includes(" rejected:"))).toHaveLength(1);
  });

  it("submits an honest failure and alerts when IMD fails after funding", async () => {
    const x = harness(); await x.bridge.tick(); await x.fund(); x.h.failed = true; x.h.now += 30_000; await x.bridge.tick();
    const args = x.commands("provider submit")[0]![0];
    expect(args[args.indexOf("--deliverable") + 1]).toContain("Reject this submission to return the ACP escrow");
    expect(x.alert).toHaveBeenCalledWith(expect.stringContaining("FAILURE"), expect.any(String));
    expect(x.bridge.status().delivered).toBe(0); expect(x.ledger.metrics("swarm").revenueUsd).toBe(0);
  });

  it("fails safely if funds disappear after funding, with no IMD open", async () => {
    const x = harness(); await x.bridge.tick(); x.h.eth = 0n; await x.fund();
    expect(x.plane.open).not.toHaveBeenCalled(); expect(x.commands("provider submit")[0]![0]).toContainEqual(expect.stringContaining("FAILURE"));
  });

  it("requires both auth and a local signer before accepting jobs", async () => {
    const x = harness(); x.h.signer = false; await expect(x.bridge.tick()).rejects.toThrow("signer");
    expect(x.bridge.status()).toMatchObject({ auth: true, signer: false }); expect(x.plane.check).not.toHaveBeenCalled();
  });

  it("refuses missing or unreadable state instead of forgetting prior jobs", () => {
    const dir = temp(), x = harness(dir); writeFileSync(join(dir, "acp.json.bak"), "{}");
    expect(() => x.restart()).toThrow("missing"); writeFileSync(join(dir, "acp.json"), "{}");
    expect(() => x.restart()).toThrow("unreadable");
  });
});
