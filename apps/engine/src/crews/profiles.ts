import type { CrewKey, CrewMetrics, CrewProfile, HouseCrewId, Operator } from "./contracts.js";
import { shortWallet } from "./operators.js";

/**
 * The crews' public profiles: what each sells, to whom, the free sample, prices, limits and how
 * to buy, with metrics computed from the job ledger. House facts are written here once; prices
 * come from the services catalogue the caller passes in, so a crew without a price is "preview".
 */
export const HOUSE_CREWS: { id: HouseCrewId; name: string }[] = [
  { id: "watchtower", name: "Watchtower" },
  { id: "research", name: "Research Desk" },
  { id: "buildcheck", name: "Build & Check" },
];

/** $SHIFT on Ethereum (IMD launch #2124): a real ERC-20 with a Uniswap v4 hook, used as Watchtower's sample. */
const SHIFT = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";
export const HOLDER_NOTE = "Holders of 500,000+ $SHIFT (wallet plus staked), a NIGHT FROG or a Night Watcher pay half on every house crew.";
const NO_RECURRING = "No recurring charges: each call is paid once over x402 (USDC on Base).";

export type HousePrice = { offer: string; label: string; usd: number; holderUsd: number; crew: HouseCrewId };

export function houseProfiles(input: { prices: HousePrice[]; metrics: (crew: CrewKey) => CrewMetrics; base: string }): CrewProfile[] {
  const { base } = input;
  const price = (crew: HouseCrewId) => input.prices.filter((p) => p.crew === crew).map(({ offer, label, usd, holderUsd }) => ({ offer, label, usd, holderUsd }));
  const house = { kind: "house", name: "NIGHTSHIFT" } as const;
  const make = (id: HouseCrewId, p: Omit<CrewProfile, "id" | "name" | "operator" | "pricing" | "metrics" | "status">): CrewProfile => {
    const pricing = price(id);
    return { id, name: HOUSE_CREWS.find((c) => c.id === id)!.name, operator: house, ...p, pricing, metrics: input.metrics(id), status: pricing.length ? "live" : "preview" };
  };
  return [
    make("watchtower", {
      service: "Monitors Ethereum ERC-20 tokens and Uniswap v4 hooks for material changes: owner or admin, upgrades, fees, pause, supply and liquidity.",
      customer: "Holders, traders and agents who depend on a token or hook and need to know when its rules change.",
      sample: { label: "Free sample check of a token", href: `${base}/api/watchtower/sample?address=${SHIFT}`, free: true },
      limits: [
        "A watch is one prepaid term: 7 days of hourly checks, paid once, never renewed.",
        NO_RECURRING,
        "Per-IP rate limits on the free sample and the paid routes.",
        HOLDER_NOTE,
      ],
      buy: { http: `GET ${base}/api/v1/watchtower/check/ethereum/{address} (one check); GET ${base}/api/v1/watchtower/watch/ethereum/{address}?days=7 (a 7-day watch)`, mcpTool: "watchtower_sample", docs: `${base}/api/crews/watchtower` },
    }),
    make("research", {
      service: "Source-linked answers and short evidence reports from SWARM MIND: the IMD swarm's published research, audits, contracts and sites.",
      customer: "Agents and people who need what the IMD swarm already found, with a link to check every source.",
      sample: { label: "Free: ask SWARM MIND with the MCP tool swarm_mind_ask", href: `${base}/mcp/public`, free: true },
      limits: [NO_RECURRING, "Per-IP rate limits on the free tool and the paid route.", HOLDER_NOTE],
      buy: { http: `GET ${base}/api/v1/research?q={question}`, mcpTool: "swarm_mind_ask", docs: `${base}/api/crews/research` },
    }),
    make("buildcheck", {
      service: "Checks a public agent service's integration (MCP reachability, x402 discovery readiness, OpenAPI, discovery documents) and returns each check with a curl command to reproduce it.",
      customer: "Builders and operators of MCP servers and x402 APIs who want agents to find, call and pay their service.",
      sample: { label: "Free quick check of our own MCP server", href: `${base}/api/crews/buildcheck/sample?url=${encodeURIComponent(`${base}/mcp/public`)}`, free: true },
      limits: [
        "Free quick check: 5 per IP per hour.",
        "Each check makes at most 12 requests (8 s each) to the target's own origin: no redirects to another host, no cookies or credentials sent.",
        NO_RECURRING,
        HOLDER_NOTE,
      ],
      buy: { http: `GET ${base}/api/v1/buildcheck?url={url}`, mcpTool: null, docs: `${base}/api/crews/buildcheck` },
    }),
  ];
}

/** Active external operators as crews. Pending, failed and suspended operators are not listed; prices are theirs, so none are shown. */
export function externalProfiles(operators: readonly Operator[] | { all(): Operator[] }, metrics: (crew: CrewKey) => CrewMetrics): CrewProfile[] {
  const list = Array.isArray(operators) ? operators : (operators as { all(): Operator[] }).all();
  return list.filter((o) => o.status === "active" && o.activatedAt !== null).map((o): CrewProfile => {
    const id = `op:${o.id}` as const;
    return {
      id, name: o.name,
      operator: { kind: "external", id: o.id, name: o.name, wallet: shortWallet(o.wallet) },
      service: `An outside agent crew offering ${o.capabilities.join(", ")}. Run by its operator, not by NIGHTSHIFT; it passed a Build & Check onboarding.`,
      customer: `Agents and people who need ${o.capabilities.join(", ")}.`,
      sample: { label: "Its public endpoint", href: o.endpoint, free: true },
      pricing: [],
      limits: ["Prices, limits and terms are set by the operator, not by NIGHTSHIFT."],
      buy: { http: o.endpoint, mcpTool: null, docs: o.endpoint },
      metrics: metrics(id),
      status: "live",
    };
  });
}
