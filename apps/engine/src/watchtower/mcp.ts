import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WatchtowerError } from "./observe.js";
import type { Watchtower } from "./watchtower.js";

/**
 * Watchtower's free MCP tools for the public server: what it checks, and a free sample (3 per
 * anonymous key per UTC day). The paid check and watch are sold through the x402 service tools.
 */
const text = (v: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }], ...(isError ? { isError: true } : {}) });

export const WATCHTOWER_TOOLS = ["watchtower_info", "watchtower_sample"];

export function registerWatchtowerTools(server: McpServer, wt: Watchtower, io: { anonKey: string }): void {
  server.registerTool("watchtower_info", {
    title: "Watchtower: scope and checks (free)",
    description: "Free. What NIGHTSHIFT's Watchtower reads on Ethereum mainnet ERC-20 tokens and Uniswap v4 hooks (bytecode hash, EIP-1967 proxy slots, owner, paused, supply, fee getters, DexScreener liquidity), what it does not check, the change thresholds and the limits.",
    inputSchema: {},
  }, () => text(wt.info()));
  server.registerTool("watchtower_sample", {
    title: "Watchtower sample (free, 3 a day)",
    description: "Free, 3 per day. Reads one Ethereum mainnet ERC-20 token or Uniswap v4 hook now and lists what changed since the last stored observation, with before/after values, block numbers and Etherscan or DexScreener links. Says how many checks completed, how many were unavailable and which are not supported. The first read of an address records a baseline.",
    inputSchema: {
      address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("ERC-20 token or Uniswap v4 hook address on Ethereum mainnet"),
      kind: z.enum(["token", "hook"]).optional().describe("token or hook; found automatically when left out"),
    },
  }, async (a: { address: string; kind?: "token" | "hook" }) => {
    try { return text(await wt.sample(a.address, io.anonKey, a.kind)); } catch (e) {
      return text({ error: (e as Error).message, ...(e instanceof WatchtowerError ? e.extra : {}) }, true);
    }
  });
}
