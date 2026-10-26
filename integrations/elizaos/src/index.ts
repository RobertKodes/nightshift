// elizaOS plugin for NIGHTSHIFT. Four actions, all on FREE endpoints.
// ./client.ts is a copy of integrations/nightshift-client/src/index.ts (copied so this folder
// stands alone and no root workspace file has to change).
import { makeDeskActions, type PaymentPolicy } from "./paid-actions.js";
import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, Plugin, State } from "@elizaos/core";
import { NightshiftClient, NightshiftError } from "./client.js";

const ADDRESS = /0x[0-9a-fA-F]{40}/;
const URL_RE = /https?:\/\/[^\s)>"']+/;

function clientFor(runtime: IAgentRuntime, fetchImpl?: typeof fetch) {
  const baseUrl = runtime.getSetting?.("NIGHTSHIFT_BASE_URL") || undefined;
  return new NightshiftClient({ baseUrl: baseUrl as string | undefined, fetch: fetchImpl });
}
const textOf = (m: Memory) => (m.content?.text ?? "").toString();

/** Turn any result into short text for the chat, trimmed so it fits a message. */
function brief(data: unknown, max = 1500): string {
  const s = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return s.length > max ? s.slice(0, max) + "\n…(trimmed)" : s;
}

interface Spec {
  name: string;
  similes: string[];
  description: string;
  /** Returns the input for the call, or null when the message does not contain one. */
  extract: (text: string) => string | null;
  missing: string;
  call: (c: NightshiftClient, input: string) => Promise<unknown>;
  example: { ask: string; reply: string };
}

const specs: Spec[] = [
  {
    name: "NIGHTSHIFT_ASK_SWARM",
    similes: ["ASK_IMD_SWARM", "ASK_NIGHTSHIFT", "IMD_QUESTION"],
    description: "Ask the NIGHTSHIFT swarm-mind (answers about IMD, with cited sources). Free.",
    extract: (t) => (t.trim().length >= 3 ? t.trim().slice(0, 500) : null),
    missing: "Ask a question of at least 3 characters.",
    call: (c, q) => c.askSwarm(q),
    example: { ask: "Ask NIGHTSHIFT: what is IMD?", reply: "Here is what the NIGHTSHIFT swarm says…" },
  },
  {
    name: "NIGHTSHIFT_VERDICT_PREVIEW",
    similes: ["TOKEN_PREVIEW", "CHECK_TOKEN_FREE"],
    description: "Free preview of an Ethereum token (market data, IMD launch match). The full safe/caution/avoid verdict is paid and is not run by this action.",
    extract: (t) => t.match(ADDRESS)?.[0] ?? null,
    missing: "Give me an Ethereum token address (0x…).",
    call: (c, a) => c.verdictPreview(a),
    example: { ask: "Preview token 0xdAC17F958D2ee523a2206206994597C13D831ec7", reply: "Token preview: USDT, liquidity…" },
  },
  {
    name: "NIGHTSHIFT_WATCHTOWER_SAMPLE",
    similes: ["WATCHTOWER", "WHAT_CHANGED_CONTRACT"],
    description: "Free Watchtower sample report for an Ethereum contract: what changed since the last observation, with evidence.",
    extract: (t) => t.match(ADDRESS)?.[0] ?? null,
    missing: "Give me a contract address (0x…).",
    call: (c, a) => c.watchtowerSample(a),
    example: { ask: "What changed on 0xdAC17F958D2ee523a2206206994597C13D831ec7?", reply: "Watchtower sample report…" },
  },
  {
    name: "NIGHTSHIFT_BUILDCHECK_SAMPLE",
    similes: ["BUILDCHECK", "CHECK_MY_INTEGRATION"],
    description: "Free quick integration check of a URL (a site or agent endpoint).",
    extract: (t) => t.match(URL_RE)?.[0] ?? null,
    missing: "Give me a URL (https://…).",
    call: (c, u) => c.buildcheckSample(u),
    example: { ask: "Buildcheck https://example.com", reply: "Quick integration check…" },
  },
];

export function makeActions(fetchImpl?: typeof fetch, payments?: PaymentPolicy): Action[] {
  return [...specs.map((s): Action => ({
    name: s.name,
    similes: s.similes,
    description: s.description,
    validate: async (_rt: IAgentRuntime, message: Memory) => s.extract(textOf(message)) !== null,
    handler: async (
      runtime: IAgentRuntime, message: Memory, _state?: State, _opts?: unknown, callback?: HandlerCallback,
    ): Promise<ActionResult> => {
      const input = s.extract(textOf(message));
      if (!input) {
        await callback?.({ text: s.missing });
        return { success: false, text: s.missing, error: "missing input" };
      }
      try {
        const data = await s.call(clientFor(runtime, fetchImpl), input);
        const text = brief(data);
        await callback?.({ text, actions: [s.name] });
        return { success: true, text, data: { result: data } };
      } catch (e) {
        const status = e instanceof NightshiftError ? e.status : 0;
        const text = `NIGHTSHIFT error${status ? ` (HTTP ${status})` : ""}: ${(e as Error).message}`;
        await callback?.({ text });
        return { success: false, text, error: text };
      }
    },
    examples: [[
      { name: "{{user1}}", content: { text: s.example.ask } },
      { name: "{{agent}}", content: { text: s.example.reply, actions: [s.name] } },
    ]],
  })), ...makeDeskActions(fetchImpl, payments)];
}

export const nightshiftPlugin: Plugin = {
  name: "nightshift",
  description: "Hire AI agents: Swarm Desk quote, x402 pay and private job status; token safety, payment verification, price, wallet, transaction, gas and ENS lookups. Wallet signer and budgets are supplied by the host.",
  config: { NIGHTSHIFT_BASE_URL: null },
  actions: makeActions(),
};

export { NightshiftClient } from "./client.js";
export default nightshiftPlugin;
