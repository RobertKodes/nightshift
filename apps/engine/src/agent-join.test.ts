import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentJoin, JOIN_NOTICE, JOIN_TEMPLATE, joinGuide, joinMessage, verifyJoinSignature } from "./agent-join.js";
import { joinDiscovery, joinRoutes, joinStationRoutes, registerJoinTools } from "./agent-join-routes.js";
import { Arena, MAX_AGENTS_PER_OWNER } from "./arena.js";
import * as atomic from "./atomic.js";
import { basePublic, eth } from "./chain.js";
import { ChessGames } from "./chess.js";
import type { buildCheck, BuildCheckReport } from "./crews/buildcheck.js";
import { JobLedger } from "./crews/ledger.js";
import { Operators } from "./crews/operators.js";
import type { Vault } from "./vault.js";
import { stationRoutes } from "./station-routes.js";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => []) }));

const WALLET = "0xabcdef0123456789abcdef0123456789abcdef01";
const EP = "https://agent.example/mcp";
const BASE = "https://nightshift.example";
const T0 = Date.parse("2026-10-26T10:00:00.000Z");
const report = { checks: [
  { id: "reachable", label: "Reachable", status: "pass", detail: "reachable" },
  { id: "mcp", label: "MCP", status: "pass", detail: "initialize + tools/list passed" },
], summary: { text: "passed" } } as BuildCheckReport;

function world(o: { file?: string | null; operatorFile?: string | null; resolve?: (u: string) => Promise<unknown>; check?: typeof buildCheck; verify?: (input: Parameters<typeof verifyJoinSignature>[0]) => Promise<boolean> } = {}) {
  let clock = T0;
  const now = () => clock;
  const arena = new Arena({ file: o.file ?? null, seats: async () => null, arenaChess: new ChessGames(null, now), publicChess: new ChessGames(null, now), now });
  const operators = new Operators({ file: o.operatorFile ?? null, now, publicUrl: o.resolve ?? (async (u) => !/(private|localhost|127\.0\.0\.1)/.test(u)) });
  const ledger = new JobLedger({ file: null, now });
  const verify = vi.fn(o.verify ?? (async () => true));
  const check = o.check ?? vi.fn(async () => report) as typeof buildCheck;
  const joins = new AgentJoin({ arena, operators, ledger, buildCheck: check, base: BASE, verify, now });
  const input = (over: Record<string, unknown> = {}) => {
    const name = over.name ?? "Test Agent", address = over.address ?? WALLET;
    return { ...joinMessage(name, address, new Date(clock).toISOString()), signature: "0x1234", ...over };
  };
  return { arena, operators, ledger, verify, check, joins, input, now, add: (ms: number) => { clock += ms; } };
}

class Res extends EventEmitter {
  headers: Record<string, string> = {}; code = 0; value: unknown; ended: unknown;
  setHeader(k: string, v: string) { this.headers[k] = v; }
  writeHead(code: number, headers: Record<string, string>) { this.code = code; Object.assign(this.headers, headers); return this; }
  end(value: unknown) { this.ended = value; }
}
async function http(w: ReturnType<typeof world>, method: string, path: string, body: Record<string, unknown> = {}) {
  const res = new Res();
  const req = { method, url: path, headers: {}, socket: { remoteAddress: "203.0.113.10" } } as IncomingMessage;
  const handled = await joinRoutes(req, res as unknown as ServerResponse, path.split("?")[0]!, {
    vault: {} as Vault, join: w.joins, body: async () => body,
    json: (_res, code, value) => { res.code = code; res.value = value; },
  });
  return { handled, code: res.code, body: res.value as Record<string, unknown>, headers: res.headers };
}
afterEach(() => vi.restoreAllMocks());

describe("join signatures (no network)", () => {
  const signed = { address: WALLET as `0x${string}`, message: "test", signature: "0x1234" as `0x${string}` };
  it("accepts an EOA signature through the existing public clients", async () => {
    const base = vi.spyOn(basePublic, "verifyMessage").mockResolvedValue(true);
    const ethereum = vi.spyOn(eth, "verifyMessage").mockResolvedValue(true);
    expect(await verifyJoinSignature(signed)).toBe(true);
    expect(base).toHaveBeenCalledWith(signed);
    expect(ethereum).toHaveBeenCalledWith(signed);
  });
  it.each(["Base", "Ethereum"])("calls the ERC-1271 public-client path on %s for contract wallets", async (chain) => {
    const base = { verifyMessage: vi.fn(async () => chain === "Base") };
    const ethereum = { verifyMessage: vi.fn(async () => chain === "Ethereum") };
    expect(await verifyJoinSignature(signed, [base, ethereum])).toBe(true);
    expect(base.verifyMessage).toHaveBeenCalledWith(signed);
    expect(ethereum.verifyMessage).toHaveBeenCalledWith(signed);
  });
  it("passes an ERC-6492 envelope through unchanged and tolerates the other chain being down", async () => {
    const envelope = { ...signed, signature: `0x${"ab".repeat(4096)}${"6492".repeat(16)}` as `0x${string}` };
    const base = { verifyMessage: vi.fn(async () => true) };
    expect(await verifyJoinSignature(envelope, [base, { verifyMessage: async () => { throw new Error("offline"); } }])).toBe(true);
    expect(base.verifyMessage).toHaveBeenCalledWith(envelope);
  });
  it("refuses invalid signatures and reports unavailable verification without accepting them", async () => {
    expect(await verifyJoinSignature(signed, [{ verifyMessage: async () => false }, { verifyMessage: async () => false }])).toBe(false);
    await expect(verifyJoinSignature(signed, [{ verifyMessage: async () => false }, { verifyMessage: async () => { throw new Error("offline"); } }])).rejects.toMatchObject({ status: 503 });
    const w = world({ verify: async () => false });
    await expect(w.joins.join(w.input(), "one")).rejects.toMatchObject({ status: 401, code: "bad_signature" });
    expect(w.arena.agents()).toEqual([]);
    expect(w.operators.all()).toEqual([]);
  });
});

describe("one-call agent join", () => {
  it("creates agent + key + operator over HTTP and starts onboarding without waiting for it", async () => {
    let finish!: (r: BuildCheckReport) => void;
    const check = vi.fn(() => new Promise<BuildCheckReport>((resolve) => { finish = resolve; })) as typeof buildCheck;
    const w = world({ check });
    const r = await http(w, "POST", "/api/agents/join", w.input({ capabilities: ["research"], endpoint: EP, model: "model/one", runtime: "Node 24" }));
    expect(r.code).toBe(201);
    expect(r.body).toMatchObject({ agentId: expect.any(String), key: expect.stringMatching(/^nsa_/), operatorId: expect.any(String), onboarding: "onboarding", profileUrl: expect.stringContaining("/api/arena/agents/"), onboardingStatusUrl: expect.stringContaining("/api/agents/join/") });
    expect(r.headers["Cache-Control"]).toBe("no-store");
    expect(w.arena.authenticate(r.body.key as string)).toMatchObject({ id: r.body.agentId, model: "model/one", runtime: "Node 24" });
    expect(w.operators.all()).toHaveLength(1);
    expect(check).toHaveBeenCalledWith(EP, {}, "full");
    expect(w.ledger.list({})).toMatchObject([{ kind: "onboarding", free: true, status: "running" }]);
    finish(report);
    await vi.waitFor(() => expect(w.operators.get(r.body.operatorId as string)?.status).toBe("active"));
    const status = await http(w, "GET", `/api/agents/join/${r.body.agentId}`);
    expect(status.body).toMatchObject({ status: "active", onboarding: { passed: true } });
    expect(JSON.stringify(status.body)).not.toContain(r.body.key);
  });
  it("joins without an endpoint and provides arena, services, checks, MCP and free-tool actions", async () => {
    const w = world();
    const r = await w.joins.join(w.input(), "one");
    expect(r.onboarding).toBe("not_requested");
    expect(r).not.toHaveProperty("operatorId");
    expect(r.next.map((n) => n.action)).toEqual(["Play in the arena", "List your services", "Get checked", "Use MCP", "Use the free tools"]);
    expect(w.check).not.toHaveBeenCalled();
  });
  it("reuses an existing wallet/name, rotates its key once, and never exposes stored keys", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-join-")), file = join(dir, "arena.json"), operatorFile = join(dir, "operators.json");
    const w = world({ file, operatorFile });
    const body = { capabilities: ["research"], endpoint: EP };
    const first = await w.joins.join(w.input(body), "one");
    w.add(1);
    const second = await w.joins.join(w.input(body), "one");
    expect(second.agentId).toBe(first.agentId);
    expect(second.operatorId).toBe(first.operatorId);
    expect(second.key).not.toBe(first.key);
    expect(w.arena.authenticate(first.key)).toBeNull();
    expect(w.arena.authenticate(second.key)?.id).toBe(first.agentId);
    expect(w.arena.agents()).toHaveLength(1);
    expect(w.operators.all()).toHaveLength(1);
    for (const key of [first.key, second.key]) {
      expect(readFileSync(file, "utf8")).not.toContain(key);
      expect(readFileSync(operatorFile, "utf8")).not.toContain(key);
      expect(JSON.stringify(w.arena.profile(first.agentId))).not.toContain(key);
      expect(JSON.stringify(w.joins.status(first.agentId))).not.toContain(key);
    }
    await expect(w.joins.join(w.input(body), "two")).rejects.toMatchObject({ code: "replay" });
  });
  it.each([
    ["wrong prefix", "Join OTHER\nagent: Test Agent\nwallet: " + WALLET + "\nissued: 2026-10-26T10:00:00.000Z", "bad_message"],
    ["different name", joinMessage("Other Agent", WALLET, new Date(T0).toISOString()).message, "bad_message"],
    ["different wallet", joinMessage("Test Agent", "0x1111111111111111111111111111111111111111", new Date(T0).toISOString()).message, "bad_message"],
    ["trailing newline", joinMessage("Test Agent", WALLET, new Date(T0).toISOString()).message + "\n", "bad_message"],
    ["stale", joinMessage("Test Agent", WALLET, new Date(T0 - 600_001).toISOString()).message, "bad_issued"],
    ["future", joinMessage("Test Agent", WALLET, new Date(T0 + 60_001).toISOString()).message, "bad_issued"],
    ["invalid calendar date", joinMessage("Test Agent", WALLET, "2026-02-30T10:00:00Z").message, "bad_issued"],
  ])("refuses %s without calling the verifier", async (_label, message, code) => {
    const w = world();
    await expect(w.joins.join(w.input({ message }), "one")).rejects.toMatchObject({ status: 400, code });
    expect(w.verify).not.toHaveBeenCalled();
    expect(w.arena.agents()).toEqual([]);
  });
  it.each([-600_000, 60_000])("accepts the time boundary %i", async (offset) => {
    const w = world();
    await expect(w.joins.join(w.input({ message: joinMessage("Test Agent", WALLET, new Date(T0 + offset).toISOString()).message }), "one")).resolves.toHaveProperty("key");
  });
  it("refuses replay after restart, across names, and using another representation of the same time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-replay-")), file = join(dir, "arena.json");
    const first = world({ file });
    await first.joins.join(first.input(), "one");
    const restarted = world({ file });
    await expect(restarted.joins.join(restarted.input({ name: "Another Agent" }), "two")).rejects.toMatchObject({ status: 409, code: "replay" });
    await expect(restarted.joins.join(restarted.input({ message: joinMessage("Test Agent", WALLET, "2026-10-26T10:00:00Z").message }), "two")).rejects.toMatchObject({ code: "replay" });
    expect(restarted.verify).not.toHaveBeenCalled();
  });
  it("serializes racing replay attempts at commit", async () => {
    const w = world();
    const results = await Promise.allSettled([w.joins.join(w.input(), "one"), w.joins.join(w.input(), "two")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "replay" } });
    expect(w.arena.agents()).toHaveLength(1);
  });
  it("checks freshness again after slow endpoint validation", async () => {
    let clockAdvance = () => {};
    const w = world({ resolve: async () => { clockAdvance(); return true; } });
    clockAdvance = () => w.add(600_001);
    await expect(w.joins.join(w.input({ capabilities: ["research"], endpoint: EP }), "one")).rejects.toMatchObject({ code: "bad_issued" });
    expect(w.arena.agents()).toEqual([]);
    expect(w.operators.all()).toEqual([]);
  });
  it("limits IPs across restarts, counts failures, retains only salted hashes, and resets after an hour", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-rate-")), file = join(dir, "arena.json");
    const ip = "203.0.113.123", w = world({ file, verify: async () => false });
    for (let i = 0; i < 10; i++) await expect(w.joins.join(w.input(), ip)).rejects.toMatchObject({ code: "bad_signature" });
    const restarted = world({ file });
    await expect(restarted.joins.join(restarted.input(), ip)).rejects.toMatchObject({ status: 429, code: "slow_down" });
    expect(restarted.verify).not.toHaveBeenCalled();
    expect(readFileSync(file, "utf8")).not.toContain(ip);
    restarted.add(3_600_001);
    await expect(restarted.joins.join(restarted.input(), ip)).resolves.toHaveProperty("key");
  });
  it("enforces the arena wallet limit while allowing reuse at the limit", async () => {
    const w = world();
    for (let i = 0; i < MAX_AGENTS_PER_OWNER; i++) await w.arena.register(WALLET, { name: `Agent ${i}` });
    await expect(w.joins.join(w.input(), "one")).rejects.toMatchObject({ status: 429, code: "too_many" });
    const r = await w.joins.join(w.input({ name: "Agent 0" }), "two");
    expect(w.arena.agents()).toHaveLength(MAX_AGENTS_PER_OWNER);
    expect(w.arena.authenticate(r.key)?.name).toBe("Agent 0");
  });
  it("enforces the existing operator wallet limit without orphaning an arena agent", async () => {
    const w = world();
    for (let i = 0; i < 3; i++) await w.operators.register({ agentId: `aaaaaaaaaaa${i}`, wallet: WALLET, name: `Other Crew ${i}`, capabilities: ["research"], endpoint: EP });
    await expect(w.joins.join(w.input({ capabilities: ["research"], endpoint: EP }), "one")).rejects.toMatchObject({ status: 429, code: "too_many" });
    expect(w.arena.agents()).toEqual([]);
    expect(w.operators.all()).toHaveLength(3);
  });
  it.each(["http://agent.example/mcp", "https://user:pass@agent.example/mcp", "https://agent.example:444/mcp", "https://private.example/mcp", "https://127.0.0.1/mcp", "bad url"])("refuses bad endpoint %s with the existing rules", async (endpoint) => {
    const w = world();
    await expect(w.joins.join(w.input({ capabilities: ["research"], endpoint }), "one")).rejects.toMatchObject({ status: 400, code: "bad_endpoint" });
    expect(w.arena.agents()).toEqual([]);
    expect(w.operators.all()).toEqual([]);
    expect(w.check).not.toHaveBeenCalled();
  });
  it.each([{ endpoint: EP }, { capabilities: ["research"] }, { capabilities: ["unknown"], endpoint: EP }, { model: "<script>" }, { runtime: "x".repeat(41) }, { homepage: "http://example.com" }, { name: "NIGHTSHIFT" }])("refuses invalid fields %j before creating records", async (over) => {
    const w = world();
    await expect(w.joins.join(w.input(over), "one")).rejects.toHaveProperty("status", 400);
    expect(w.arena.agents()).toEqual([]);
    expect(w.operators.all()).toEqual([]);
  });
  it("rolls back operator, arena, key rotation and replay when the arena commit cannot persist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-rollback-")), file = join(dir, "arena.json"), operatorFile = join(dir, "operators.json");
    const w = world({ file, operatorFile });
    writeFileSync(operatorFile, JSON.stringify({ operators: [] }));
    const original = await w.arena.register(WALLET, { name: "Test Agent" });
    const write = atomic.writeAtomic;
    const spy = vi.spyOn(atomic, "writeAtomic").mockImplementation((target, data, opts) => {
      if (target === file && JSON.parse(String(data)).joins?.used.length) throw new Error("disk full");
      return write(target, data, opts);
    });
    await expect(w.joins.join(w.input({ capabilities: ["research"], endpoint: EP }), "one")).rejects.toThrow("disk full");
    expect(w.operators.all()).toEqual([]);
    expect(JSON.parse(readFileSync(operatorFile, "utf8")).operators).toEqual([]);
    expect(w.arena.authenticate(original.key)?.id).toBe(original.agent.id);
    expect(JSON.parse(readFileSync(file, "utf8")).joins.used).toEqual([]);
    spy.mockRestore();
    await expect(w.joins.join(w.input({ capabilities: ["research"], endpoint: EP }), "one")).resolves.toHaveProperty("key");
  });
  it("restores the persisted agent and replay guard when operator persistence fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-op-rollback-")), file = join(dir, "arena.json"), operatorFile = join(dir, "operators.json");
    const w = world({ file, operatorFile }), write = atomic.writeAtomic;
    vi.spyOn(atomic, "writeAtomic").mockImplementation((target, data, opts) => {
      if (target === operatorFile) throw new Error("operator disk full");
      return write(target, data, opts);
    });
    await expect(w.joins.join(w.input({ capabilities: ["research"], endpoint: EP }), "one")).rejects.toThrow("operator disk full");
    expect(w.arena.agents()).toEqual([]);
    expect(w.operators.all()).toEqual([]);
    const restarted = world({ file });
    expect(restarted.arena.agents()).toEqual([]);
    await expect(restarted.joins.join(restarted.input(), "two")).resolves.toHaveProperty("key");
  });
  it("rejects a non-object JSON body and a wallet with a trailing newline", async () => {
    const w = world();
    expect((await http(w, "POST", "/api/agents/join", null as unknown as Record<string, unknown>)).body.code).toBe("bad_json");
    await expect(w.joins.join({ name: "Test Agent", address: WALLET + "\n" }, "one")).rejects.toMatchObject({ code: "bad_address" });
  });

});

describe("join discovery and public MCP", () => {
  it("serves a free self-contained guide with an exact template, fresh timestamp, curl and executable viem example", async () => {
    const r = await http(world(), "GET", "/api/agents/join");
    expect(r.code).toBe(200);
    expect(r.body.template).toBe(JOIN_TEMPLATE);
    expect(Math.abs(Date.parse(r.body.issued as string) - Date.now())).toBeLessThan(1000);
    const guide = joinGuide(BASE, "My Agent", WALLET.toUpperCase().replace("0X", "0x"), T0);
    expect(guide.message).toBe(joinMessage("My Agent", WALLET, new Date(T0).toISOString()).message);
    expect(guide.curl).toContain("POST");
    expect(guide.curl).toContain("\\nagent: My Agent");
    expect(guide.viem).toContain('const message = `Join NIGHTSHIFT\\nagent: ${name}');
    expect(guide.viem).toContain("signMessage");
  });
  it("runs the viem example with a mocked signer and fetch", async () => {
    const guide = joinGuide(BASE), signMessage = vi.fn(async () => "0x1234");
    const fetch = vi.fn(async (_url: string, init: { body: string }) => {
      const request = JSON.parse(init.body);
      const issued = request.message.split("issued: ")[1];
      expect(request.message).toBe(joinMessage("My Agent", WALLET, issued).message);
      expect(request).toMatchObject({ signature: "0x1234", capabilities: ["research"], endpoint: EP });
      return { ok: true, json: async () => ({ key: "nsa_test" }) };
    });
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const execute = new AsyncFunction("privateKeyToAccount", "fetch", "process", guide.viem.replace(/^import[^\n]*\n/, ""));
    await execute(() => ({ address: WALLET, signMessage }), fetch, { env: { AGENT_PRIVATE_KEY: "0xTEST" } });
    expect(signMessage).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("publishes join discovery on the real llms.txt station route", async () => {
    const res = new Res();
    expect(await stationRoutes({ method: "GET", headers: {}, url: "/llms.txt" } as IncomingMessage, res as unknown as ServerResponse, "/llms.txt", {
      json: () => {}, body: async () => ({}), limited: () => false, owner: null, vault: {} as Vault,
      market: () => [], live: () => [], token: async () => ({}), mind: null,
    })).toBe(true);
    expect(res.ended).toContain(JOIN_NOTICE);
    expect(res.ended).toContain("join_nightshift");
  });
  it("adds join discovery to start_here without changing its existing content", () => {
    const request = { method: "tools/call", id: 7, params: { name: "start_here" } };
    const response = { jsonrpc: "2.0" as const, id: 7, result: { content: [{ type: "text", text: "existing" }] } };
    const result = joinDiscovery(response, request, BASE);
    expect(JSON.stringify(result)).toContain(JOIN_NOTICE);
    expect(JSON.stringify(result)).toContain("existing");
    expect(joinDiscovery(response, { ...request, id: 9 }, BASE)).toBe(response);
    expect(joinDiscovery(response, { ...request, params: { name: "crews" } }, BASE)).toBe(response);
  });
  it("adds the one-call route to both llms documents through the station hook", async () => {
    for (const path of ["/llms.txt", "/llms-full.txt"]) {
      const res = new Res(), llms = vi.fn(async () => "existing docs\n");
      expect(await joinStationRoutes({ method: "GET", headers: {} } as IncomingMessage, res as unknown as ServerResponse, path, {
        vault: {} as Vault, body: async () => ({}), json: () => {}, limited: () => false,
      }, { llms, publicMcp: () => { throw new Error("not needed"); } })).toBe(true);
      expect(llms).toHaveBeenCalledWith(path === "/llms-full.txt");
      expect(res.ended).toContain("existing docs");
      expect(res.ended).toContain(JOIN_NOTICE);
    }
  });
  it("exposes keyword-rich public tools and calls the same join flow with shared replay protection", async () => {
    const w = world(), server = new McpServer({ name: "test", version: "1" });
    registerJoinTools(server, () => w.joins, "mcp-test");
    const client = new Client({ name: "test-agent", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(a), client.connect(b)]);
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toEqual(["join_message", "join_nightshift"]);
      for (const tool of listed.tools) for (const word of ["register", "join", "free", "AI agent", "no operator", "list your services"]) expect(tool.description?.toLowerCase()).toContain(word.toLowerCase());
      const message = await client.callTool({ name: "join_message", arguments: { name: "Test Agent", address: WALLET } });
      expect(JSON.stringify(message)).toContain("Join NIGHTSHIFT");
      const joined = await client.callTool({ name: "join_nightshift", arguments: w.input({ capabilities: ["research"], endpoint: EP }) });
      expect(joined.isError).not.toBe(true);
      expect(w.arena.agents()).toHaveLength(1);
      expect(w.operators.all()).toHaveLength(1);
      const replay = await http(w, "POST", "/api/agents/join", w.input());
      expect(replay.code).toBe(409);
      expect(replay.body.code).toBe("replay");
    } finally { await client.close(); await server.close(); }
  });
});
