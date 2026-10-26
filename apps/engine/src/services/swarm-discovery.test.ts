import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { OFFERS, openapi, llmsLines } from "./catalog.js";
import { houseAgentCard, x402Manifest } from "./discovery.js";
import { registerServiceTools } from "./mcp.js";
import { a2a } from "./a2a.js";
import type { Io, Services } from "./routes.js";

const BASE = "https://getnightshift.tech";
const io: Io = { method: "POST", path: "/api/v1/a2a", query: new URLSearchParams(), header: () => undefined, ip: "203.0.113.1", base: BASE, limited: () => false };

describe("Swarm-first machine discovery", () => {
  it("uses published A2A fields, nine work skills and all house offers", () => {
    const c = houseAgentCard(BASE);
    expect(c).toMatchObject({ protocolVersion: "0.3.0", url: `${BASE}/api/v1/a2a`, preferredTransport: "JSONRPC", security: [], provider: { organization: "NIGHTSHIFT" } });
    expect(c.skills.slice(0, 9).map((s) => s.id)).toEqual(["swarm-website", "swarm-research", "swarm-audit", "swarm-contract", "swarm-tests", "swarm-review", "swarm-frontend", "swarm-image", "swarm-logo"]);
    expect(c.skills).toHaveLength(9 + OFFERS.length - 1);
    expect(c.capabilities.extensions[0]!.params).toMatchObject({ mcp: { auth: "none", url: `${BASE}/mcp/public` }, payment: { network: "eip155:8453", asset: "USDC" } });
    expect(c).not.toHaveProperty("agentsOnline");
    expect(x402Manifest(BASE).resources[0]).toBe(`${BASE}/api/v1/swarm/order`);
    expect(x402Manifest(BASE).resources.filter((u) => u.includes("/swarm/order"))).toHaveLength(1);
  });
  it("puts Swarm Desk first in OpenAPI, prices every paid operation and includes the nine kinds", () => {
    const api = openapi(BASE, 8453, "0x1111111111111111111111111111111111111111");
    expect(Object.keys(api.paths)[0]).toBe("/api/v1/swarm/order");
    expect(api.paths["/api/v1/swarm/order"].get["x-payment-info"]).toMatchObject({ protocols: ["x402"], price: { mode: "dynamic", currency: "USD", min: "3.00" } });
    for (const o of OFFERS) {
      const route = o.id.startsWith("token-verdict") ? "/api/v1/verdict/{chain}/{token}" : o.id === "imd-feed" ? "/api/v1/imd/swarm" : o.route.split("?")[0]!;
      const op = (api.paths as Record<string, { get?: Record<string, unknown> }>)[route]?.get;
      expect(op, o.id).toHaveProperty("x-payment-info");
    }
    expect(llmsLines(BASE).join("\n")).toMatch(/Swarm Desk[\s\S]*swarm_quote -> swarm_order -> swarm_job/);
  });
  it("exposes schemas, routing keywords and read-only annotations over actual MCP transport", async () => {
    const s = new McpServer({ name: "test", version: "1" });
    registerServiceTools(s, { handle: async () => ({ status: 200, body: {} }) } as unknown as Services, io);
    const c = new Client({ name: "test", version: "1" }), [client, server] = InMemoryTransport.createLinkedPair();
    try {
      await s.connect(server); await c.connect(client);
      const tools = (await c.listTools()).tools;
      for (const name of ["swarm_quote", "swarm_order", "swarm_job", "x402_seller_check", "payment_verify", "token_price", "wallet_check", "tx_explain", "gas_now", "name_resolve"]) expect(tools.find((t) => t.name === name), name).toBeTruthy();
      expect(tools.find((t) => t.name === "swarm_order")!.annotations?.readOnlyHint).toBe(false);
      expect(tools.find((t) => t.name === "payment_verify")!.annotations?.readOnlyHint).toBe(true);
      expect(tools.find((t) => t.name === "swarm_quote")!.description).toMatch(/hire AI agents[\s\S]*audit/);
      const schema = tools.find((t) => t.name === "swarm_quote")!.inputSchema;
      expect((schema.properties!.kind as { enum: string[] }).enum).toHaveLength(9);
      expect(schema.properties).toHaveProperty("commit");
    } finally { await c.close(); await s.close(); }
  });
});

describe("A2A structured calls", () => {
  it("routes free checked quotes and private status through the same service handlers", async () => {
    const calls: Io[] = [], s = { handle: async (request: Io) => { calls.push(request); return { status: 200, body: request.path.includes("jobs") ? { status: "done", result: { files: { report: "https://example.test/report" } } } : { quoteId: "quote", priceUsd: 3 } }; } } as unknown as Services;
    const out = await a2a(s, io, { jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "user", messageId: "m1", parts: [{ kind: "data", data: { tool: "swarm_quote", arguments: { kind: "tests", brief: "Write tests for this repository", repo: "https://github.com/example/contracts", commit: "a".repeat(40) } } }] } } });
    expect(out.body).toMatchObject({ result: { kind: "message", parts: [{ kind: "data", data: { priceUsd: 3 } }] } });
    expect(calls[0]!.path).toBe("/api/v1/swarm/quote"); expect(calls[0]!.query.get("commit")).toHaveLength(40);
    const task = await a2a(s, io, { jsonrpc: "2.0", id: 2, method: "tasks/get", params: { id: "sd_example", metadata: { orderToken: "private-token" } } });
    expect(task.body).toMatchObject({ result: { kind: "task", id: "sd_example", status: { state: "completed" }, artifacts: [{ artifactId: "result" }] } });
    expect(calls[1]!.query.get("token")).toBe("private-token");
  });
  it("preserves the exact 402 challenge and refuses implicit free-text orders", async () => {
    const challenge = { status: 402, body: { x402Version: 2, accepts: [{ amount: "3000000" }] }, headers: { "PAYMENT-REQUIRED": "exact" } };
    const s = { handle: async () => challenge } as unknown as Services;
    const call = (parts: unknown[]) => a2a(s, io, { jsonrpc: "2.0", id: "1", method: "message/send", params: { message: { role: "user", messageId: "m", parts } } });
    expect(await call([{ kind: "data", data: { tool: "swarm_order", arguments: { quoteId: "q" } } }])).toBe(challenge);
    expect((await call([{ kind: "text", text: "hire agents now" }])).body).toMatchObject({ error: { code: -32602 } });
  });
});
