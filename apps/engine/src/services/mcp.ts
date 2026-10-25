import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HOLDER_RULE, OFFERS, holderPriceOf, offer, usdOf } from "./catalog.js";
import type { Io, Services } from "./routes.js";

/**
 * The house services as MCP tools on the public server (/mcp/public). Free tools answer at once;
 * paid tools take `payment`, the same base64 x402 payload an HTTP client sends as
 * PAYMENT-SIGNATURE. Without it they answer with the exact payment terms, so an agent with an
 * x402 signer can pay and call again.
 */
const text = (v: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) }], ...(isError ? { isError: true } : {}) });

export function registerServiceTools(server: McpServer, s: Services, io: { ip: string; base: string; limited(key: string, n: number, ms: number): boolean }): void {
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

  server.registerTool("services_pricing", { title: "NIGHTSHIFT Services: prices", description: "The house services run by NIGHTSHIFT (Token Verdict, Hook Inspector, IMD Data Feed): what each returns, its price in USDC (and the 50% holder price) and how to pay over x402. Free.", inputSchema: {} },
    () => call("/api/v1/services", {}));
  server.registerTool("verdict_preview", { title: "Token Verdict preview (free)", description: "Free and fast, no verdict: is this Ethereum token an IMD launch, its market and liquidity (DexScreener), other IMD launches with the same symbol, and its Uniswap v4 hook's permission bits.", inputSchema: { token: addr("ERC-20 token address on Ethereum") } },
    (a: { token: string }) => call(`/api/v1/verdict/ethereum/${a.token}/preview`, {}));
  server.registerTool("verdict_demo", { title: "Token Verdict demo (free, once a day)", description: "One full quick Token Verdict per IP per day, free: no issues found / caution / avoid for an Ethereum token with every reason and its evidence. After that, use token_verdict.", inputSchema: { token: addr("ERC-20 token address on Ethereum") } },
    (a: { token: string }) => call(`/api/v1/verdict/ethereum/${a.token}`, { depth: "quick", demo: "1" }));
  server.registerTool("token_verdict", {
    title: "Token Verdict ($0.02 quick, $0.25 deep)",
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
  server.registerTool("imd_feed", { title: `IMD Data Feed ($${usdOf(offer("imd-feed"))} per call, half for holders)`, description: `${offer("imd-feed").description} Pass the x402 payment as \`payment\`.`, inputSchema: { ...feedArgs, holderWallet, payment } },
    (a: FeedA) => call(feedPath(a), { ...feedQ(a), holder: a.holderWallet }, a.payment));
}

export const SERVICE_TOOLS = ["services_pricing", "verdict_preview", "verdict_demo", "token_verdict", "hook_flags", "hook_inspect", "imd_feed_sample", "imd_feed"];
export const servicePrices = () => OFFERS.map((o) => ({ id: o.id, priceUsd: usdOf(o) }));
