import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HOLDER_RULE, OFFERS, holderPriceOf, offer, usdOf } from "./catalog.js";
import { SWARM_KINDS, SWARM_PITCH } from "../crews/swarm-kinds.js";
import { FAST_OFFERS } from "./fast-offers.js";
import type { Io, Services } from "./routes.js";

/**
 * The house services as MCP tools on the public server (/mcp/public). Free tools answer at once;
 * paid tools take `payment`, the same base64 x402 payload an HTTP client sends as
 * PAYMENT-SIGNATURE. Without it they answer with the exact payment terms, so an agent with an
 * x402 signer can pay and call again.
 */
const text = (v: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) }], ...(isError ? { isError: true } : {}) });

const annotated = new WeakSet<McpServer>();
/** Payment arguments stay explicit even when a tool only reads public data. */
export function annotateTools(server: McpServer): void {
  if (annotated.has(server)) return;
  annotated.add(server);
  server.registerTool = new Proxy(server.registerTool, {
    apply(target, receiver, args: [string, { annotations?: Record<string, boolean>; description?: string }, unknown]) {
      const [name, config, handler] = args;
      const writes = name === "swarm_order" || name === "watchtower_watch";
      const keywords: Record<string, string> = { token_verdict: "Token safety and security verification.", payment_verify: "Verify payment: did USDC arrive?", swarm_order: "Hire AI agents and pay a checked x402 quote.", research_report: "Sourced research report with cited evidence." };
      return Reflect.apply(target, receiver, [name, { ...config, description: `${keywords[name] ? `${keywords[name]} ` : ""}${config.description ?? ""}`, annotations: { readOnlyHint: !writes, destructiveHint: false, idempotentHint: name !== "swarm_quote", openWorldHint: true, ...config.annotations } }, handler]);
    },
  });
}

export function registerServiceTools(server: McpServer, s: Services, io: { ip: string; base: string; limited(key: string, n: number, ms: number): boolean }): void {
  annotateTools(server);
  /** Calls the HTTP handler with the payment as its header: one code path for both doors. */
  const call = async (path: string, q: Record<string, string | undefined>, payment?: string) => {
    const query = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== ""));
    const req: Io = { method: "GET", path, query, header: (n) => (payment && (n === "payment-signature") ? payment : undefined), ip: io.ip, base: io.base, limited: io.limited };
    const out = await s.handle(req);
    if (!out) return text({ error: "not found" }, true);
    if (out.status === 402) return text({ paymentRequired: true, how: "Sign an EIP-3009 transferWithAuthorization for accepts[0] (USDC on Base) with any x402 v2 client, base64 the payment payload, and call this tool again with it as `payment`.", challenge: out.body }, true);
    return text(out.body, out.status >= 400);
  };
  const payment = z.string().max(8_000).optional().describe("x402 payment: the base64 PAYMENT-SIGNATURE payload for this call's terms. Leave it out to get the terms.");
  const holderWallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe(`The wallet that will pay, for the holder price (50% off). ${HOLDER_RULE}`);
  const addr = (what: string) => z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe(what);


  server.registerTool("services_pricing", { title: "NIGHTSHIFT Services: prices", description: "The house services and crews: what each returns, USDC prices, holder terms and how to pay over x402. Swarm Desk starts at $3 and requires a free checked quote for the exact price, without a holder discount. Free.", inputSchema: {} },
    () => call("/api/v1/services", {}));
  server.registerTool("swarm_stats", { title: "Swarm Desk: live capacity and prices", description: "Hire AI agents: live IMD agents online, seats, completed jobs, completion rate, desk capacity, kinds and exact current price formula. Free, cached 60 seconds.", inputSchema: {} }, () => call("/api/v1/swarm/stats", {}));
  server.registerTool("swarm_quote", {
    title: "Swarm Desk: free checked quote",
    description: `${SWARM_PITCH} Free quote for hire AI agents, build a website, research report, audit, contract, Foundry tests, adversarial review, frontend, image or logo. Quote expires in 10 minutes; no holder discount.`, 
    inputSchema: { kind: z.enum(SWARM_KINDS).describe("Work kind. Example: research"), brief: z.string().max(1500).optional().describe("20..1500 characters, except logo uses name/style. Example: Research decentralized storage with cited primary sources."), repo: z.string().url().max(2000).optional().describe("audit/tests/review: public GitHub repo. Example: https://github.com/example/contracts"), commit: z.string().regex(/^[0-9a-fA-F]{40}$/).optional().describe("Full pinned commit; required for tests. Example: 0123456789012345678901234567890123456789"), chain: z.enum(["ethereum", "base"]).optional().describe("frontend: verified contract's chain"), address: addr("frontend: verified contract address" ).optional(), name: z.string().min(1).max(80).optional().describe("logo name. Example: Night Owl"), style: z.string().min(3).max(300).optional().describe("logo style. Example: white owl on dark navy") },
  }, (a: { kind: string; brief?: string; repo?: string; commit?: string; chain?: string; address?: string; name?: string; style?: string }) => call("/api/v1/swarm/quote", { ...a }));
  server.registerTool("swarm_order", {
    title: "Swarm Desk: pay a quote and hire the swarm",
    description: `${offer("swarm-order").description} USDC settles first. Keep the private orderToken; recover it with the same verified payment after a lost answer. Never sign a replacement for a pending payment.`,
    inputSchema: { quoteId: z.string().uuid(), payment },
  }, (a: { quoteId: string; payment?: string }) => call("/api/v1/swarm/order", { quoteId: a.quoteId }, a.payment));
  server.registerTool("swarm_job", {
    title: "Swarm Desk: job status and results (free)",
    description: "Follow a Swarm Desk order with its private order token. Returns IMD status and, when delivered, result links and files. Free.",
    inputSchema: { orderId: z.string().max(100), token: z.string().max(100) },
  }, (a: { orderId: string; token: string }) => call(`/api/v1/swarm/jobs/${encodeURIComponent(a.orderId)}`, { token: a.token }));
  for (const o of FAST_OFFERS) {
    const fields = Object.fromEntries(Object.entries(o.query).map(([key, v]) => {
      let schema: z.ZodTypeAny = v.enum ? z.enum(v.enum as [string, ...string[]]) : z.string().max(2_000);
      if (v.required === false) schema = schema.optional();
      const example = new URL(o.example, "https://nightshift.test").searchParams.get(key);
      return [key, schema.describe(`${v.description}${example ? `. Example: ${example}` : ""}`)];
    }));
    server.registerTool(o.id.replaceAll("-", "_"), { title: `${o.name} ($${usdOf(o)})`, description: o.description, inputSchema: { ...fields, holderWallet, payment } },
      (a: Record<string, string | undefined>) => { const { payment: signature, holderWallet: holder, ...q } = a; return call(o.route, { ...q, holder }, signature); });
  }

  server.registerTool("verdict_preview", { title: "Token Verdict preview (free)", description: "Free and fast, no verdict: is this Ethereum token an IMD launch, its market and liquidity (DexScreener), other IMD launches with the same symbol, and its Uniswap v4 hook's permission bits.", inputSchema: { token: addr("ERC-20 token address on Ethereum") } },
    (a: { token: string }) => call(`/api/v1/verdict/ethereum/${a.token}/preview`, {}));
  server.registerTool("verdict_demo", { title: "Token Verdict demo (free, once a day)", description: "One full quick Token Verdict per IP per day, free: no issues found / caution / avoid for an Ethereum token with every reason and its evidence. After that, use token_verdict.", inputSchema: { token: addr("ERC-20 token address on Ethereum") } },
    (a: { token: string }) => call(`/api/v1/verdict/ethereum/${a.token}`, { depth: "quick", demo: "1" }));
  server.registerTool("token_verdict", {
    title: "Token Verdict ($0.01 quick, $0.25 deep)",
    description: `${offer("token-verdict-quick").description} Deep ($${usdOf(offer("token-verdict-deep"))}) adds the full hook inspection, IMD admission checks and a written explanation. Pass the x402 payment as \`payment\`.`,
    inputSchema: { token: addr("ERC-20 token address on Ethereum"), depth: z.enum(["quick", "deep"]).default("quick"), holderWallet, payment },
  }, (a: { token: string; depth: "quick" | "deep"; holderWallet?: string; payment?: string }) => call(`/api/v1/verdict/ethereum/${a.token}`, { depth: a.depth, holder: a.holderWallet }, a.payment));
  server.registerTool("hook_flags", { title: "Hook permission bits (free)", description: "Free: the permission bits of a Uniswap v4 hook from its address (which callbacks the PoolManager will ever call) and a known-template match (IMD's pool guard, NightshiftHook).", inputSchema: { address: addr("Uniswap v4 hook address") } },
    (a: { address: string }) => call(`/api/v1/hook/${a.address}/flags`, {}));
  server.registerTool("hook_inspect", {
    title: "Hook Inspector ($0.05, explained $0.50)",
    description: `${offer("hook-inspector").description} explain=true ($${usdOf(offer("hook-inspector-explained"))}) adds a written explanation with the source lines. Pass the x402 payment as \`payment\`.`,
    inputSchema: { address: addr("Uniswap v4 hook address on Ethereum"), explain: z.boolean().default(false), holderWallet, payment },
  }, (a: { address: string; explain: boolean; holderWallet?: string; payment?: string }) => call(`/api/v1/hook/${a.address}`, { explain: a.explain ? "1" : undefined, holder: a.holderWallet }, a.payment));
  const feedArgs = {
    endpoint: z.enum(["launches", "launch", "tokens", "swarm", "agent"]).describe("launches (list), launch (one, needs id), tokens, swarm, agent (one seat, needs id)"),
    id: z.string().max(40).optional().describe("launch number or id, or seat token id"),
    chain: z.enum(["ethereum", "robinhood", "sepolia"]).optional(), kind: z.string().max(30).optional(), status: z.string().max(20).optional(),
    since: z.string().max(40).optional().describe("ISO time: only changes after it (polling)"), limit: z.number().int().min(1).max(200).optional(), before: z.string().max(40).optional(),
  };
  const feedPath = (a: { endpoint: string; id?: string }) => a.endpoint === "launch" ? `/api/v1/imd/launches/${encodeURIComponent(a.id ?? "")}` : a.endpoint === "agent" ? `/api/v1/imd/agents/${encodeURIComponent(a.id ?? "")}` : `/api/v1/imd/${a.endpoint}`;
  type FeedA = { endpoint: string; id?: string; chain?: string; kind?: string; status?: string; since?: string; limit?: number; before?: string; holderWallet?: string; payment?: string };
  const feedQ = (a: FeedA) => ({ chain: a.chain, kind: a.kind, status: a.status, since: a.since, limit: a.limit ? String(a.limit) : undefined, before: a.before });
  server.registerTool("imd_feed_sample", { title: "IMD Data Feed sample (free)", description: "Free: a 3-item sample of any IMD Data Feed endpoint (launches, one launch, tokens, swarm health, a seat's work).", inputSchema: feedArgs },
    (a: FeedA) => call(feedPath(a), { ...feedQ(a), sample: "1" }));
  server.registerTool("watchtower_check", {
    title: `Watchtower: what changed ($${usdOf(offer("watchtower-check"))}, half for holders)`,
    description: `${offer("watchtower-check").description} Free first: watchtower_sample. Pass the x402 payment as \`payment\`.`,
    inputSchema: { address: addr("ERC-20 token or Uniswap v4 hook address on Ethereum"), holderWallet, payment },
  }, (a: { address: string; holderWallet?: string; payment?: string }) => call(`/api/v1/watchtower/check/ethereum/${a.address}`, { holder: a.holderWallet }, a.payment));
  server.registerTool("watchtower_watch", {
    title: `Watchtower: 7-day watch ($${usdOf(offer("watchtower-watch"))}, half for holders)`,
    description: `${offer("watchtower-watch").description} The paying wallet owns the watch. Pass the x402 payment as \`payment\`.`,
    inputSchema: { address: addr("ERC-20 token or Uniswap v4 hook address on Ethereum"), holderWallet, payment },
  }, (a: { address: string; holderWallet?: string; payment?: string }) => call(`/api/v1/watchtower/watch/ethereum/${a.address}`, { days: "7", holder: a.holderWallet }, a.payment));
  server.registerTool("research_report", {
    title: `Research Desk: evidence report ($${usdOf(offer("research-report"))}, half for holders)`,
    description: `${offer("research-report").description} Free first: swarm_mind_ask. Pass the x402 payment as \`payment\`.`,
    inputSchema: { question: z.string().min(3).max(500), holderWallet, payment },
  }, (a: { question: string; holderWallet?: string; payment?: string }) => call("/api/v1/research", { q: a.question, holder: a.holderWallet }, a.payment));
  server.registerTool("buildcheck_report", {
    title: `Build & Check: integration report ($${usdOf(offer("buildcheck-report"))}, half for holders)`,
    description: `${offer("buildcheck-report").description} Free first: buildcheck_sample. Pass the x402 payment as \`payment\`.`,
    inputSchema: { url: z.string().url().max(2000).describe("https URL of an MCP endpoint, a paid x402 route or an API"), holderWallet, payment },
  }, (a: { url: string; holderWallet?: string; payment?: string }) => call("/api/v1/buildcheck", { url: a.url, holder: a.holderWallet }, a.payment));
  server.registerTool("imd_feed", { title: `IMD Data Feed ($${usdOf(offer("imd-feed"))} per call, half for holders)`, description: `${offer("imd-feed").description} Pass the x402 payment as \`payment\`.`, inputSchema: { ...feedArgs, holderWallet, payment } },
    (a: FeedA) => call(feedPath(a), { ...feedQ(a), holder: a.holderWallet }, a.payment));
}

export const CREW_TOOLS = ["swarm_stats", "research_report", "buildcheck_report", "swarm_quote", "swarm_order", "swarm_job"];
export const SERVICE_TOOLS = [...FAST_OFFERS.map((o) => o.id.replaceAll("-", "_")), "services_pricing", "verdict_preview", "verdict_demo", "token_verdict", "hook_flags", "hook_inspect", "imd_feed_sample", "imd_feed"];
export const servicePrices = () => OFFERS.map((o) => ({ id: o.id, priceUsd: usdOf(o) }));
