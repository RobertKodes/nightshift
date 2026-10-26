import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory } from "@elizaos/core";
import { HOUSE_TOOLS, NightshiftClient, type HouseTool, type PaidOptions, type SignedRequest, type SwarmInput, type SwarmQuote } from "./client.js";

export type PaymentPolicy = PaidOptions & { save?(request: SignedRequest): void | Promise<void> };
const parse = (m: Memory): Record<string, unknown> | null => { try { const p = JSON.parse(String(m.content?.text ?? "")); return p && typeof p === "object" && !Array.isArray(p) ? p : null; } catch { return null; } };

/** The host injects a wallet signer and a budget; chat text never supplies keys. */
export function makeDeskActions(fetchImpl?: typeof fetch, policy?: PaymentPolicy): Action[] {
  const specs = [
    { name: "NIGHTSHIFT_SWARM_QUOTE", paid: false, description: "Hire AI agents: free checked quote to build a website, write a sourced research report, audit Solidity with four specialists and a judge, build contracts, Foundry tests, code review, frontend, image or logo. JSON: {kind,brief,repo?,commit?,chain?,address?,name?,style?}.", accepts: (a: Record<string, unknown>) => typeof a.kind === "string" },
    { name: "NIGHTSHIFT_SWARM_ORDER", paid: true, description: "Hire the IMD swarm with x402 USDC on Base. Pay an exact free checked quote within the host's configured budget. JSON: {quote:{quoteId,kind,priceUsd,expiresAt}}. Returns orderId and private orderToken. If a job fails the desk records a refund owed.", accepts: (a: Record<string, unknown>) => !!a.quote && typeof a.quote === "object" },
    { name: "NIGHTSHIFT_SWARM_JOB", paid: false, description: "Poll Swarm Desk work and result links without payment. JSON: {orderId,token}. Never publish the private order token.", accepts: (a: Record<string, unknown>) => typeof a.orderId === "string" && typeof a.token === "string" },
    { name: "NIGHTSHIFT_HOUSE_TOOL", paid: true, description: `Paid x402 tools for token safety, seller security, verify payment, token price, wallet check, explain transaction, gas and ENS/Basenames. JSON: {tool:<${HOUSE_TOOLS.join("|")}>,input:{...}}. Uses the host's dollar budget and signer.`, accepts: (a: Record<string, unknown>) => (HOUSE_TOOLS as readonly unknown[]).includes(a.tool) && !!a.input && typeof a.input === "object" },
  ];
  return specs.map((s): Action => ({
    name: s.name, description: s.description, similes: [],
    validate: async (_runtime: IAgentRuntime, m: Memory) => { const a = parse(m); return !!a && s.accepts(a) && (!s.paid || !!policy); },
    handler: async (runtime, m, _state, _options, callback?: HandlerCallback): Promise<ActionResult> => {
      const a = parse(m);
      try {
        if (!a || !s.accepts(a)) throw new Error("Use the JSON input described by this action.");
        if (s.paid && (!policy || !Number.isFinite(policy.maxUsd) || policy.maxUsd <= 0)) throw new Error("The agent host must configure a payment signer and a maximum USDC budget.");
        const c = new NightshiftClient({ baseUrl: String(runtime.getSetting?.("NIGHTSHIFT_BASE_URL") || "https://getnightshift.tech"), fetch: fetchImpl });
        const result = s.name === "NIGHTSHIFT_SWARM_QUOTE" ? await c.swarmQuote(a as SwarmInput)
          : s.name === "NIGHTSHIFT_SWARM_ORDER" ? await c.swarmOrder(a.quote as SwarmQuote, { ...policy!, onSigned: policy!.save })
          : s.name === "NIGHTSHIFT_SWARM_JOB" ? await c.swarmJob(String(a.orderId), String(a.token))
          : await (async () => { const request = await c.prepareHouseTool(a.tool as HouseTool, a.input as Record<string, string>, policy!); await policy!.save?.(request); return c.submitPaid(request); })();
        const text = JSON.stringify(result); await callback?.({ text, actions: [s.name] }); return { success: true, text, data: { result } };
      } catch (e) { const text = `NIGHTSHIFT: ${(e as Error).message}`; await callback?.({ text }); return { success: false, text, error: text }; }
    },
    examples: [[{ name: "{{user1}}", content: { text: s.name.endsWith("QUOTE") ? '{"kind":"research","brief":"Research decentralized storage with primary citations."}' : s.name.endsWith("JOB") ? '{"orderId":"sd_example","token":"private-order-token"}' : s.name.endsWith("TOOL") ? '{"tool":"gas-now","input":{}}' : '{"quote":{"quoteId":"from-free-quote","kind":"research","priceUsd":4.90,"expiresAt":"from-free-quote"}}' } }, { name: "{{agent}}", content: { text: "I will use the checked input and the configured budget.", actions: [s.name] } }]],
  }));
}
