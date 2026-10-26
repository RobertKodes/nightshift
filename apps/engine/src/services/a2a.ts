import { randomUUID } from "node:crypto";
import { isFastId } from "./fast-input.js";
import type { Io, Out, Services } from "./routes.js";

const fail = (id: unknown, code: number, message: string): Out => ({ status: 200, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A2A 0.3 JSON-RPC: structured message/send calls and private tasks/get polling. */
export async function a2a(s: Services, io: Io, input: unknown): Promise<Out> {
  if (!object(input) || input.jsonrpc !== "2.0" || !(typeof input.id === "string" || typeof input.id === "number") || typeof input.method !== "string") return fail(null, -32600, "Invalid JSON-RPC request.");
  const id = input.id, p = object(input.params) ? input.params : {};
  if (input.method === "tasks/get") {
    const token = object(p.metadata) ? p.metadata.orderToken : null;
    if (typeof p.id !== "string" || typeof token !== "string") return fail(id, -32602, "tasks/get requires id and metadata.orderToken.");
    const out = await s.handle({ ...io, method: "GET", path: `/api/v1/swarm/jobs/${encodeURIComponent(p.id)}`, query: new URLSearchParams({ token }) });
    if (!out || out.status !== 200) return fail(id, -32001, "Task not found, invalid order token or status unavailable.");
    const job = out.body as { status: string; result?: unknown };
    return { status: 200, body: { jsonrpc: "2.0", id, result: { kind: "task", id: p.id, contextId: p.id, status: { state: job.status === "done" ? "completed" : job.status === "failed" ? "failed" : job.status === "settling" ? "submitted" : "working", timestamp: new Date().toISOString() }, metadata: { nightshift: out.body }, ...(job.result ? { artifacts: [{ artifactId: "result", parts: [{ kind: "data", data: job.result }] }] } : {}) } } };
  }
  if (input.method !== "message/send") return fail(id, -32601, "Supported methods: message/send and tasks/get. Streaming, cancellation and push are not supported.");
  const message = object(p.message) ? p.message : null;
  if (!message || message.role !== "user" || typeof message.messageId !== "string" || !Array.isArray(message.parts)) return fail(id, -32602, "message must have role=user, messageId and a structured data part.");
  const part = message.parts.find((part) => object(part) && part.kind === "data" && object(part.data));
  if (!object(part) || !object(part.data) || typeof part.data.tool !== "string") return fail(id, -32602, "Use a data part with {tool, arguments}; no free-text work is ordered implicitly.");
  const tool = part.data.tool, args = object(part.data.arguments) ? part.data.arguments : {};
  if (Object.values(args).some((v) => v !== undefined && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean")) return fail(id, -32602, "Tool arguments must be scalar values.");
  const query = new URLSearchParams(Object.entries(args).filter(([, v]) => v !== undefined && v !== "").map(([k, v]): [string, string] => [k, String(v)]));
  let path: string;
  if (["swarm_quote", "swarm_order", "swarm_stats"].includes(tool)) path = `/api/v1/swarm/${tool.slice(6)}`;
  else if (tool === "swarm_job") { if (typeof args.orderId !== "string" || typeof args.token !== "string") return fail(id, -32602, "swarm_job requires orderId and token."); path = `/api/v1/swarm/jobs/${encodeURIComponent(args.orderId)}`; query.delete("orderId"); }
  else if (isFastId(tool.replaceAll("_", "-"))) path = `/api/v1/${tool.replaceAll("_", "-")}`;
  else if (tool === "services_pricing") path = "/api/v1/services";
  else if (tool === "token_verdict") { path = `/api/v1/verdict/ethereum/${encodeURIComponent(String(args.token ?? ""))}`; query.delete("token"); }
  else if (tool === "hook_inspect") { path = `/api/v1/hook/${encodeURIComponent(String(args.address ?? ""))}`; query.delete("address"); if (args.explain === true) query.set("explain", "1"); }
  else if (tool === "research_report") { path = "/api/v1/research"; query.set("q", String(args.question ?? "")); query.delete("question"); }
  else if (tool === "buildcheck_report") path = "/api/v1/buildcheck";
  else if (tool === "watchtower_check" || tool === "watchtower_watch") { path = `/api/v1/watchtower/${tool.endsWith("watch") ? "watch" : "check"}/ethereum/${encodeURIComponent(String(args.address ?? ""))}`; query.delete("address"); }
  else if (tool === "imd_feed") { const endpoint = String(args.endpoint ?? "launches"), n = encodeURIComponent(String(args.id ?? "")); path = endpoint === "launch" ? `/api/v1/imd/launches/${n}` : endpoint === "agent" ? `/api/v1/imd/agents/${n}` : `/api/v1/imd/${encodeURIComponent(endpoint)}`; query.delete("endpoint"); query.delete("id"); }
  else return fail(id, -32602, "Unknown tool. Read the AgentCard or call services_pricing.");
  const payment = typeof args.payment === "string" ? args.payment : io.header("payment-signature");
  query.delete("payment"); if (query.has("holderWallet")) { query.set("holder", query.get("holderWallet")!); query.delete("holderWallet"); }
  const out = await s.handle({ ...io, method: "GET", path, query, header: (name) => name === "payment-signature" ? payment : io.header(name) });
  if (!out) return fail(id, -32602, "Unknown service.");
  if (out.status === 402) return out;
  if (out.status >= 400) return { ...fail(id, -32602, String((out.body as { error?: string }).error ?? "Service unavailable")), headers: out.headers };
  return { status: 200, headers: out.headers, body: { jsonrpc: "2.0", id, result: { kind: "message", role: "agent", messageId: randomUUID(), parts: [{ kind: "data", data: object(out.body) ? out.body : { result: out.body } }] } } };
}
