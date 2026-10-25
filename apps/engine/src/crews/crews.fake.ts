/**
 * Test fakes for the crews: a fetch that answers from a table (and records every request), a
 * small MCP server, and a valid x402 challenge. No network.
 */
export type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined; init: RequestInit };
type Answer = Response | null | Promise<Response | null>;
/** Keys: "GET <url>", "POST <url>", or "POST <url> <json-rpc method>" (checked first). */
export type Routes = Record<string, (c: Call) => Answer>;

export function fakeFetch(routes: Routes, fallback: (c: Call) => Answer = () => new Response("not found", { status: 404, headers: { "content-type": "text/plain" } })) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response | null> => {
    const c: Call = { url, method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers).entries()), body: typeof init.body === "string" ? init.body : undefined, init };
    calls.push(c);
    let rpc = "";
    try { rpc = c.body ? String((JSON.parse(c.body) as { method?: string }).method ?? "") : ""; } catch { /* not JSON */ }
    const h = (rpc && routes[`${c.method} ${url} ${rpc}`]) || routes[`${c.method} ${url}`] || fallback;
    return h(c);
  };
  return { fetch, calls };
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export const sse = (msg: unknown, headers: Record<string, string> = {}) =>
  new Response(`event: message\ndata: ${JSON.stringify(msg)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream", ...headers } });

export const TOOLS = [
  { name: "lookup", description: "Looks a thing up.", inputSchema: { type: "object" } },
  { name: "report", description: "Writes a short report.", inputSchema: { type: "object" } },
];

/** An MCP endpoint: answers initialize, the initialized notification and tools/list; a plain GET gets 405. */
export function mcpRoutes(url: string, o: { sse?: boolean; session?: string; tools?: unknown[] } = {}): Routes {
  const wrap = (m: unknown, h: Record<string, string> = {}) => (o.sse ? sse(m, h) : json(200, m, h));
  return {
    [`GET ${url}`]: () => new Response("Method Not Allowed", { status: 405, headers: { "content-type": "text/plain" } }),
    [`POST ${url} initialize`]: () => wrap({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-mcp", version: "1.2.3" } } }, o.session ? { "mcp-session-id": o.session } : {}),
    [`POST ${url} notifications/initialized`]: () => new Response(null, { status: 202 }),
    [`POST ${url} tools/list`]: () => wrap({ jsonrpc: "2.0", id: 2, result: { tools: o.tools ?? TOOLS } }),
  };
}

/** A valid x402 v2 challenge, in the shape NIGHTSHIFT's own services answer with. */
export const CHALLENGE = {
  x402Version: 2,
  error: "payment required",
  resource: { url: "https://svc.example/api/v1/thing", description: "Use when an agent needs a thing.", mimeType: "application/json" },
  accepts: [{ scheme: "exact", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "100000", payTo: "0x989d0e896961f02b62f491a329d1ad3554355a36", maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } }],
  extensions: { bazaar: { info: { input: { type: "http", method: "GET" }, output: { type: "json", example: { ok: true } } }, schema: {} } },
};
