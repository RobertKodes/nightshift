import { OFFERS, usdOf } from "./catalog.js";
import { SWARM_KINDS, SWARM_PITCH, SWARM_OUTPUTS, SWARM_SKILLS } from "../crews/swarm-kinds.js";

const kindSchema = (kind: string) => {
  const repository = ["audit", "review", "tests"].includes(kind), frontend = kind === "frontend", logo = kind === "logo";
  return { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: [kind] }, brief: { type: "string", minLength: logo ? 0 : 20, maxLength: 1500 },
    ...(repository ? { repo: { type: "string", format: "uri", pattern: "^https://github\\.com/[^/]+/[^/?#]+/?$" }, commit: { type: "string", pattern: "^[0-9a-fA-F]{40}$" } } : {}),
    ...(frontend ? { chain: { type: "string", enum: ["ethereum", "base"] }, address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } } : {}),
    ...(logo ? { name: { type: "string", minLength: 1, maxLength: 80 }, style: { type: "string", minLength: 3, maxLength: 300 } } : {}),
  }, required: ["kind", ...(logo ? ["name", "style"] : ["brief"]), ...(repository ? ["repo"] : []), ...(kind === "tests" ? ["commit"] : []), ...(frontend ? ["chain", "address"] : [])] };
};

export const SWARM_TOOL_NAMES = ["swarm_quote", "swarm_order", "swarm_job"];
export const toolOf = (id: string) => id.startsWith("token-verdict") ? "token_verdict" : id.startsWith("hook-inspector") ? "hook_inspect" : id === "imd-feed" ? "imd_feed" : id.replaceAll("-", "_");

/** A2A 0.3 AgentCard; house pricing and schemas use a named extension, not invented standard fields. */
export function houseAgentCard(base: string) {
  const examples = (kind: string) => ({ kind, brief: "Describe the requested work in at least twenty characters", ...(["audit", "review", "tests"].includes(kind) ? { repo: "https://github.com/example/contracts" } : {}), ...(kind === "tests" ? { commit: "0123456789012345678901234567890123456789" } : {}), ...(kind === "frontend" ? { chain: "ethereum", address: "0x1111111111111111111111111111111111111111" } : {}), ...(kind === "logo" ? { name: "Night Owl", style: "White owl on a dark navy circle" } : {}) });
  const skills = [
    ...SWARM_KINDS.map((kind) => ({ id: `swarm-${kind}`, name: `Hire AI agents: ${kind}`, description: `${SWARM_OUTPUTS[kind]} IMD ${kind === "audit" ? "template" : "skill"}: ${SWARM_SKILLS[kind]}. Free checked quote, from $3 USDC on Base; if a job fails, the desk records a refund owed.`, tags: ["hire-ai-agents", "x402", kind, SWARM_SKILLS[kind]], examples: [JSON.stringify({ tool: "swarm_quote", arguments: examples(kind) })], inputModes: ["application/json"], outputModes: ["application/json"] })),
    ...OFFERS.filter((o) => !o.quoted).map((o) => ({ id: o.id, name: o.name, description: `${o.description} USDC on Base: $${usdOf(o)} per call. MCP: ${toolOf(o.id)}.`, tags: ["x402", o.crew, ...o.id.split("-")], examples: [o.example], inputModes: ["application/json"], outputModes: ["application/json"] })),
  ];
  return {
    protocolVersion: "0.3.0", name: "NIGHTSHIFT Swarm Desk", description: SWARM_PITCH, version: "1.3.0", url: `${base}/api/v1/a2a`, preferredTransport: "JSONRPC",
    provider: { organization: "NIGHTSHIFT", url: base }, documentationUrl: `${base}/llms.txt`,
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false, extensions: [{ uri: `${base}/.well-known/agent-card.json#house-tools`, description: "NIGHTSHIFT HTTP/MCP input and output schemas and x402 payment terms", required: false, params: {
      skills: Object.fromEntries(SWARM_KINDS.map((kind) => [`swarm-${kind}`, { inputSchema: kindSchema(kind), outputSchema: { type: "object", required: ["quoteId", "priceUsd", "expiresAt", "pay"], properties: { quoteId: { type: "string", format: "uuid" }, priceUsd: { type: "number", minimum: 3 }, expiresAt: { type: "string", format: "date-time" }, pay: { type: "string", format: "uri" } } }, price: { mode: "dynamic", currency: "USD", min: "3.00", source: `${base}/api/v1/swarm/quote`, exactQuoteRequired: true }, skill: SWARM_SKILLS[kind] }])),
      workers: "Each IMD seat runs its owner's Claude Code or Codex worker. Contract work requires Fable 5.1 or GPT-6 Astra. A verifier checks submissions. IMD WorkRegistry records receipts on Ethereum with ERC-8004 reputation.",
      mcp: { url: `${base}/mcp/public`, transport: "streamable-http", auth: "none" }, payment: { protocol: "x402", version: 2, network: "eip155:8453", asset: "USDC" },
      swarm: { quote: `${base}/api/v1/swarm/quote`, order: `${base}/api/v1/swarm/order`, status: `${base}/api/v1/swarm/jobs/{orderId}?token={orderToken}`, stats: `${base}/api/v1/swarm/stats`, tools: SWARM_TOOL_NAMES, input: { kind: [...SWARM_KINDS], brief: "20..1500 characters except logo", repo: "audit/tests/review: public GitHub repo", commit: "tests: full 40-hex commit", chain: "frontend: ethereum or base", address: "frontend: verified contract", name: "logo: 1..80 characters", style: "logo: 3..300 characters" }, output: { quoteId: "UUID", priceUsd: "exact checked price", orderId: "order reference", orderToken: "private polling capability", refundOwed: "true if a failed job records a refund owed" } },
      tools: OFFERS.map((o) => ({ id: o.id, mcp: toolOf(o.id), method: o.method, route: `${base}${o.route}`, priceUsd: usdOf(o), priceIsMinimum: Boolean(o.quoted), inputSchema: { type: "object", required: [...new Set([...Object.keys(o.path), ...Object.entries(o.query).filter(([, v]) => v.required === true).map(([key]) => key)])], properties: Object.fromEntries(Object.entries({ ...o.path, ...o.query }).map(([key, value]) => { const { required: _required, ...schema } = value as { required?: boolean; type: string; description: string }; return [key, schema]; })) }, outputSchema: { type: "object", ...o.output } })),
    } }] },
    securitySchemes: {}, security: [], defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"], skills,
  };
}

/** x402scan's documented compatibility fan-out manifest. */
export function x402Manifest(base: string) {
  return { version: 1, resources: [...OFFERS].sort((a, b) => Number(Boolean(b.quoted)) - Number(Boolean(a.quoted))).map((o) => `${base}${o.quoted ? "/api/v1/swarm/order" : o.example}`), instructions: `Start with ${base}/api/v1/swarm/quote. ${SWARM_PITCH}` };
}
