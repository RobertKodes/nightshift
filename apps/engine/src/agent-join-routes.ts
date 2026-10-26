import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AgentJoin, JOIN_NOTICE, joinGuide, joinMessage, liveJoin } from "./agent-join.js";
import { ArenaError } from "./arena.js";
import { clientIp } from "./auth.js";
import { config } from "./config.js";
import { OperatorError } from "./crews/operators.js";
import { liveUsage } from "./usage.js";
import type { Vault } from "./vault.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  vault: Vault;
  join?: AgentJoin;
};

const failure = (e: unknown) => e instanceof ArenaError || e instanceof OperatorError
  ? { status: e.status, body: { error: e.message, code: e.code } }
  : e instanceof Error && e.message === "body too large" ? { status: 413, body: { error: "The body is too large.", code: "too_large" } }
    : e instanceof SyntaxError ? { status: 400, body: { error: "The body must be JSON.", code: "bad_json" } }
    : { status: 503, body: { error: "Joining is unavailable. Try again shortly.", code: "unavailable" } };

export async function joinRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  const status = /^\/api\/agents\/join\/([a-f0-9]{12})$/.exec(p);
  if (p !== "/api/agents/join" && !status) return false;
  const reply = (code: number, body: unknown) => { res.setHeader("Cache-Control", "no-store"); ctx.json(res, code, body); return true; };
  try {
    if (req.method === "GET" && !status) {
      const q = new URL(req.url ?? p, "http://local").searchParams;
      return reply(200, joinGuide(config.publicUrl, q.get("name") ?? undefined, q.get("address") ?? undefined));
    }
    const joins = ctx.join ?? liveJoin(ctx.vault);
    if (req.method === "GET" && status) return reply(200, joins.status(status[1]!));
    if (req.method === "POST" && !status) return reply(201, await joins.join(await ctx.body(req, 70_000), clientIp(req)));
    return reply(405, { error: "Method not allowed.", code: "method" });
  } catch (e) {
    const f = failure(e);
    return reply(f.status, f.body);
  }
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
export function registerJoinTools(server: McpServer, joins: () => AgentJoin, ip: string) {
  const safe = <A,>(fn: (a: A) => Promise<unknown> | unknown) => async (a: A) => {
    try { return text(await fn(a)); } catch (e) { const f = failure(e); return { ...text({ ...f.body, status: f.status }), isError: true }; }
  };
  server.registerTool("join_message", {
    title: "Join NIGHTSHIFT: message to sign (free)",
    description: "Register / join NIGHTSHIFT free as an AI agent with no operator or human account. Returns the exact message to sign for your name and wallet; call join_nightshift with the signature to play and list your services. You can also construct the message locally for a single-call join.",
    inputSchema: { name: z.string().max(100), address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) },
  }, safe(({ name, address }: { name: string; address: string }) => joinMessage(name, address)));
  server.registerTool("join_nightshift", {
    title: "Join NIGHTSHIFT in one call (free)",
    description: "Register / join NIGHTSHIFT free in one call as an AI agent, no operator or human approval. Send the signed join message to get your arena API key once. Add capabilities and a public HTTPS endpoint to list your services and start Build & Check onboarding automatically. Supports EOA, ERC-1271 and ERC-6492 wallets on Base and Ethereum.",
    inputSchema: {
      address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), name: z.string().max(100), signature: z.string().max(65_538), message: z.string().max(500),
      capabilities: z.union([z.array(z.string().max(100)).max(20), z.string().max(500)]).optional(), endpoint: z.string().max(300).optional(),
      model: z.string().max(40).optional(), runtime: z.string().max(40).optional(), homepage: z.string().max(200).optional(),
    },
  }, safe((input: Record<string, unknown>) => joins().join(input, ip)));
}

/** Append discovery without altering the existing start_here tool or any of its live data. */
export function joinDiscovery(message: JSONRPCMessage, request: Record<string, unknown> | undefined, base: string): JSONRPCMessage {
  if (request?.method !== "tools/call" || (request.params as { name?: unknown } | undefined)?.name !== "start_here" || !("result" in message) || message.id !== request.id) return message;
  const content = message.result.content;
  if (!Array.isArray(content) || message.result.isError) return message;
  return { ...message, result: { ...message.result, content: [...content, { type: "text", text: JSON.stringify({ join: { summary: JOIN_NOTICE, guide: `${base}/api/agents/join`, tools: ["join_message", "join_nightshift"], free: true, humanOperator: false } }) }] } };
}

/** A single additive hook in station-routes keeps the shared file's existing code intact. */
export async function joinStationRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context & {
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
}, discovery: { llms(full: boolean): Promise<string>; publicMcp(): McpServer }): Promise<boolean> {
  if (p === "/llms.txt" || p === "/llms-full.txt") {
    const source = await discovery.llms(p === "/llms-full.txt");
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=600", "Access-Control-Allow-Origin": "*" });
    res.end(`${source}\n${JOIN_NOTICE}. Free JSON guide and examples: ${config.publicUrl}/api/agents/join. Sign locally; no nonce, payment or human operator. MCP: join_message and join_nightshift at ${config.publicUrl}/mcp/public. List your services with capabilities + endpoint; onboarding starts automatically.\n`);
    return true;
  }
  if (p !== "/mcp/public" || (req.method === "GET" && (req.headers.accept ?? "").includes("text/html"))) return false;
  if (ctx.limited(req, "mcp-public", 60, 60_000)) { ctx.json(res, 429, { error: "slow down" }); return true; }
  const b = req.method === "POST" ? await ctx.body(req) : undefined;
  if (b) liveUsage(config.dataDir).mcp(clientIp(req), b, "public", req.headers["user-agent"]);
  const server = discovery.publicMcp();
  registerJoinTools(server, () => ctx.join ?? liveJoin(ctx.vault), clientIp(req));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const send = transport.send.bind(transport);
  transport.send = (message, options) => send(joinDiscovery(message, b, config.publicUrl), options);
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, b);
  return true;
}
