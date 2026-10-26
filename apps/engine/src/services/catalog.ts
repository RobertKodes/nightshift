import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import type { ProductKind } from "@nightshift/core";
import { requirement } from "@nightshift/x402";
import type { Address } from "viem";
import { SWARM_KINDS, SWARM_PITCH, SWARM_SKILLS, SWARM_OUTPUTS } from "../crews/swarm-kinds.js";
import { FAST_OFFERS } from "./fast-offers.js";
import { type FastId, isFastId } from "./fast-input.js";

/**
 * The house services as products: price, what each call returns, and the discovery
 * metadata (x402 v2 "bazaar" extension, the agent market catalogue, OpenAPI, llms.txt) in one place.
 * Descriptions start with "Use when an agent needs…" and stay under 500 characters, as discovery
 * indexes want (researched 2026-10-20).
 */
export type OfferId = FastId | "token-verdict-quick" | "token-verdict-deep" | "hook-inspector" | "hook-inspector-explained" | "imd-feed" | "research-report" | "buildcheck-report" | "watchtower-check" | "watchtower-watch" | "swarm-order";
/** The house crew that runs each offer: its jobs count on that crew's page, the proof page and the season. */
export type CrewOf = "watchtower" | "research" | "buildcheck" | "swarm";
export type Offer = {
  id: OfferId; name: string; kind: ProductKind; pitch: string; priceUsdc: bigint; method: "GET";
  /** The route, with {params}, and a real example of it. */
  route: string; example: string; page: string;
  description: string;
  query: Record<string, { type: string; description: string; enum?: string[]; required?: boolean }>;
  path: Record<string, { type: string; description: string; pattern?: string }>;
  output: { required: string[]; properties: Record<string, unknown> };
  outputExample: Record<string, unknown>;
  crew: CrewOf;
  /** Swarm work uses a ten-minute quote and has no holder discount. */
  quoted?: boolean;
};

const SHIFT = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";
const HOOK = "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc";
const verdictOut = {
  required: ["verdict", "summary", "confidence", "reasons", "evidence"],
  properties: {
    verdict: { type: "string", enum: ["no_issues_found", "caution", "avoid"] },
    summary: { type: "string" },
    confidence: { type: "object", properties: { level: { type: "string", enum: ["high", "medium", "low"] }, score: { type: "number" }, unknowns: { type: "array", items: { type: "string" } } } },
    reasons: { type: "array", items: { type: "object", properties: { id: { type: "string" }, impact: { type: "string", enum: ["avoid", "caution", "note", "good"] }, text: { type: "string" }, evidence: { type: "array", items: { type: "string" } } } } },
    imd: { type: "object", description: "IMD launch match: launch number, kind, status, repo" },
    source: { type: "object" }, powers: { type: "object" }, proxy: { type: "object" }, market: { type: "object" }, pool: { type: ["object", "null"] }, hook: { type: ["object", "null"] },
    holders: { type: "object" }, simulation: { type: "object" }, copycat: { type: "object" }, explanation: { type: "string", description: "deep only" },
    evidence: { type: "array", items: { type: "object", properties: { id: { type: "string" }, what: { type: "string" }, source: { type: "string" }, url: { type: "string" } } } },
    payment: { type: "object", properties: { tx: { type: "string" }, network: { type: "string" }, priceUsd: { type: "number" } } },
  },
};
// trimmed from a real quick verdict of $SHIFT, 2026-10-20 (docs/services/EXAMPLES.md has the whole answer)
const verdictExample = {
  service: "token-verdict", runBy: "NIGHTSHIFT", chain: "ethereum", token: SHIFT, depth: "quick", verdict: "no_issues_found",
  summary: "$SHIFT (IMD #2124): no issues found in the checks that ran. IMD launch #2124 (univ4_hook), deployed by IMD's launch wallet from source built and checked by the IMD swarm. Source verified on Sourcify (LaunchToken).",
  confidence: { level: "high", score: 1, unknowns: [] },
  reasons: [
    { id: "liquidity", impact: "note", text: "$13.1k can be taken out by sellers (the pool's ETH side; $48.0k in all): thin, so large sells move the price.", evidence: ["e8"] },
    { id: "sell-tax", impact: "note", text: "Selling costs 4.92% beyond the 1.25% pool fee (taken by the hook). Buying has no extra cost.", evidence: ["e12"] },
    { id: "plain", impact: "good", text: "No mint, pause, blacklist, fee or upgrade function anyone controls: a plain ERC-20.", evidence: ["e1", "e6", "e5"] },
  ],
  simulation: { simulated: true, quote: "ETH", buy: { ok: true, taxPct: 0.02 }, sell: { ok: true, taxPct: 4.92 }, router: { ok: true } },
  copycat: { signal: "note", text: "Shares the symbol SHIFT with older IMD launches #2031, #2106, but this one has the deepest liquidity of them; later copies: #2126, #2129." },
  evidence: [{ id: "e12", what: "eth_call: V4 Quoter buy 0.002691 ETH → 102,859.035 tokens; buy-then-sell round trip → 0.002494595 ETH; the same round trip through the Universal Router with real token transfers went through", source: "eth_call" }],
  payment: { tx: "0x5f2c…e1a9", network: "eip155:8453", priceUsd: 0.01 },
};
const hookOut = {
  required: ["summary", "risk", "flags", "callbacks", "powers", "evidence"],
  properties: {
    summary: { type: "string" }, risk: { type: "string", enum: ["low", "medium", "high"] },
    flags: { type: "object", properties: { hex: { type: "string" }, permissions: { type: "array" }, valid: { type: "boolean" } } },
    callbacks: { type: "array" }, template: { type: ["object", "null"] }, source: { type: "object" }, owner: { type: "object" }, upgradeable: { type: "object" },
    pools: { type: "array" }, fees: { type: "object" }, adminFunctions: { type: "array" }, powers: { type: "array" },
    explanation: { type: "object", description: "explain=1 only: text and source excerpts" }, evidence: { type: "array" },
  },
};
const hookExample = {
  service: "hook-inspector", address: HOOK, risk: "low",
  summary: "NightshiftHook. The PoolManager calls beforeInitialize, beforeSwap, afterSwap (with beforeSwapReturnsDelta, afterSwapReturnsDelta). Takes its own fee … to feeSplitter 0x1119…2d44. Owner: wallet 0x6c4c…19b5. Not a proxy and no DELEGATECALL: the code cannot change.",
  flags: { hex: "0x20cc", valid: true }, template: { name: "NightshiftHook", match: "exact address" },
  fees: { swapFee: "125 bps static", hookFee: "takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44" },
  callbacks: [{ name: "beforeSwap", implemented: true }, { name: "afterSwap", implemented: true }, { name: "beforeInitialize", implemented: true }],
  powers: [{ text: "the owner can change fees (setFees), capped by MAX_FEE_BPS = 250", level: "low" }],
  evidence: [{ kind: "source", url: "https://sourcify.dev/server/repo-ui/1/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc" }],
};
const feedOut = {
  required: ["service", "endpoint", "items"],
  properties: { endpoint: { type: "string" }, count: { type: "integer" }, total: { type: "integer" }, items: { type: "array" }, next: { type: "object", properties: { before: { type: ["integer", "null"] }, since: { type: "string" } } }, sources: { type: "array" } },
};
const feedExample = {
  service: "imd-feed", endpoint: "launches", count: 1, total: 731,
  items: [{ launchNumber: 2124, kind: "univ4_hook", status: "live", chain: "ethereum", token: { address: SHIFT, contract: "ShiftToken", symbol: "SHIFT" }, hook: { address: HOOK, contract: "NightshiftHook" }, pool: { poolId: "0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4", lpHeldBy: "IMD LaunchFactory" }, market: { liquidityUsd: 48000, volume24hUsd: 3575, source: "dexscreener" } }],
  next: { before: 2123, since: "2026-10-20T21:40:00.000Z" },
};

const researchOut = {
  required: ["question", "answer", "sources", "coverage"],
  properties: {
    question: { type: "string" }, answer: { type: "string", description: "written only from the works in sources" },
    sources: { type: "array", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" }, kind: { type: "string" }, date: { type: ["string", "null"] }, cited: { type: "boolean" } } } },
    coverage: { type: "string" }, gaps: { type: "array", items: { type: "string" } }, markdown: { type: "string" }, model: { type: ["string", "null"] }, generatedAt: { type: "string" },
    payment: { type: "object", properties: { tx: { type: "string" }, network: { type: "string" }, priceUsd: { type: "number" } } },
  },
};
const researchExample = {
  question: "What has the IMD swarm published about Uniswap v4 hooks?",
  answer: "The swarm's audits of IMD launch hooks found … (each claim numbered against the sources below).",
  sources: [{ title: "Audit: NightshiftHook (launch #2124)", url: "https://explorer.imd.fun/…", kind: "audit", date: "2026-10-18", cited: true }],
  coverage: "Answered from 6 published works of the IMD swarm; nothing outside them.", gaps: ["No work covers hooks deployed outside IMD."],
  generatedAt: "2026-10-25T12:00:00.000Z", model: "free model", payment: { tx: "0x5f2c…e1a9", network: "eip155:8453", priceUsd: 0.25 },
};
const buildcheckOut = {
  required: ["target", "checks", "summary"],
  properties: {
    target: { type: "string" }, origin: { type: "string" }, mode: { type: "string", enum: ["quick", "full"] },
    checks: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, status: { type: "string", enum: ["pass", "fail", "warn", "unavailable"] }, detail: { type: "string" }, reproduce: { type: "string", description: "the exact curl command to rerun it" }, ms: { type: "number" } } } },
    summary: { type: "object", properties: { checks: { type: "integer" }, pass: { type: "integer" }, warn: { type: "integer" }, fail: { type: "integer" }, unavailable: { type: "integer" }, text: { type: "string" } } },
    generatedAt: { type: "string" }, payment: { type: "object" },
  },
};
const buildcheckExample = {
  target: "https://getnightshift.tech/mcp/public", origin: "https://getnightshift.tech", mode: "full",
  checks: [{ id: "mcp", label: "MCP initialize and tools/list", status: "pass", detail: "nightshift-public 1.0.0, protocol 2025-06-18, 18 tools", reproduce: "curl -s -X POST https://getnightshift.tech/mcp/public -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",…}'", ms: 412 }],
  summary: { checks: 5, pass: 4, warn: 1, fail: 0, unavailable: 0, text: "5 checks: 4 pass, 1 warn, 0 fail, 0 unavailable" },
  generatedAt: "2026-10-25T12:00:00.000Z", payment: { tx: "0x5f2c…e1a9", network: "eip155:8453", priceUsd: 0.1 },
};
const watchOut = {
  required: ["address", "chain", "changes", "unavailable", "unsupported", "stale", "summary"],
  properties: {
    address: { type: "string" }, chain: { type: "string", enum: ["ethereum"] }, kind: { type: "string", enum: ["token", "hook"] },
    baseline: { type: ["object", "null"], description: "the previous observation compared against: time and block" },
    changes: { type: "array", items: { type: "object", properties: { field: { type: "string" }, severity: { type: "string", enum: ["info", "low", "medium", "high", "critical"] }, before: {}, after: {}, beforeBlock: { type: "integer" }, afterBlock: { type: "integer" }, evidence: { type: "array", items: { type: "string" } } } } },
    unavailable: { type: "array", description: "checks that could not run this time: never read as no change" }, unsupported: { type: "array", items: { type: "string" } },
    stale: { type: "boolean" }, summary: { type: "string" }, human: { type: "string", description: "the same report in short markdown" }, coverageNote: { type: "string" },
    watch: { type: "object", description: "watch only: id, term, expiry" }, manageToken: { type: "string", description: "watch only: shown once, to read or stop the watch" }, telegram: { type: ["string", "null"], description: "watch only: the link that turns on Telegram alerts" },
  },
};
const watchExample = {
  address: SHIFT, chain: "ethereum", kind: "token", baseline: { at: "2026-10-25T09:00:00.000Z", block: 23650000 },
  changes: [{ field: "liquidityUsd", severity: "medium", before: 45698, after: 29120, beforeBlock: 23650000, afterBlock: 23650300, evidence: ["https://dexscreener.com/ethereum/…"] }],
  unavailable: [], unsupported: ["transfer restrictions (blacklist, max transaction)", "other chains"], stale: false,
  summary: "9 checks completed, 1 change detected (medium), 0 checks unavailable.", coverageNote: "Check coverage is not a probability that a token is safe or profitable.",
};
const watchPath = { chain: { type: "string", description: "ethereum (or 1)", pattern: "^(ethereum|eth|mainnet|1)$" }, address: { type: "string", description: "ERC-20 token or Uniswap v4 hook address", pattern: "^0x[0-9a-fA-F]{40}$" } };
const tokenPath = { chain: { type: "string", description: "ethereum (or 1)", pattern: "^(ethereum|eth|mainnet|1)$" }, token: { type: "string", description: "ERC-20 token address", pattern: "^0x[0-9a-fA-F]{40}$" } };
export const OFFERS: Offer[] = [
  {
    id: "token-verdict-quick", name: "Token Verdict (quick)", kind: "tool", pitch: "Before you buy: no issues found, caution or avoid, with reasons and evidence.", priceUsdc: 10_000n, method: "GET",
    route: "/api/v1/verdict/{chain}/{token}?depth=quick", example: `/api/v1/verdict/ethereum/${SHIFT}?depth=quick`, page: "/services/verdict",
    description: "Use when an agent needs a pre-buy verdict on an Ethereum token, made for IMD launches and Uniswap v4 hook tokens: no_issues_found / caution / avoid with cited reasons and the checks that could not run. Checks IMD launch match, verified source, owner powers (mint, pause, blacklist, fees, proxy), liquidity and v4 pool, holders, a buy-then-sell simulation and copycat symbols. Run by NIGHTSHIFT.",
    query: { depth: { type: "string", enum: ["quick", "deep"], description: "quick ($0.01) or deep ($0.25: adds the hook inspection, IMD admission checks and a written explanation)" } }, path: tokenPath,
    output: verdictOut, outputExample: verdictExample, crew: "watchtower",
  },
  {
    id: "token-verdict-deep", name: "Token Verdict (deep)", kind: "tool", pitch: "The quick verdict plus the full hook inspection, IMD's admission checks and a written memo.", priceUsdc: 250_000n, method: "GET",
    route: "/api/v1/verdict/{chain}/{token}?depth=deep", example: `/api/v1/verdict/ethereum/${SHIFT}?depth=deep`, page: "/services/verdict",
    description: "Use when an agent needs the full pre-buy check on an Ethereum token before a larger trade: everything in the quick Token Verdict plus a full Uniswap v4 hook inspection, IMD admission checks and assurances, a longer holder scan and a written explanation, each claim tied to evidence. Run by NIGHTSHIFT.",
    query: { depth: { type: "string", enum: ["deep"], description: "deep" } }, path: tokenPath,
    output: verdictOut, outputExample: { ...verdictExample, depth: "deep", explanation: "$SHIFT (0xe5e5…c3ac) on Ethereum: no issues found in the checks that ran, with high confidence (100% of the checks ran). …", payment: { tx: "0x5f2c…e1a9", network: "eip155:8453", priceUsd: 0.25 } }, crew: "watchtower",
  },
  {
    id: "hook-inspector", name: "Hook Inspector", kind: "tool", pitch: "What a Uniswap v4 hook can do: permissions, fees, owner powers, upgrades.", priceUsdc: 50_000n, method: "GET",
    route: "/api/v1/hook/{address}", example: `/api/v1/hook/${HOOK}`, page: "/services/hook",
    description: "Use when an agent needs to know what a Uniswap v4 hook on Ethereum can do before trading or providing liquidity through it: permission bits from the address, which callbacks it implements, fee logic and recipients, owner and admin functions with their caps, upgradeability and known templates (IMD launch hooks, NightshiftHook), from verified source or bytecode. Run by NIGHTSHIFT.",
    query: { explain: { type: "string", enum: ["0", "1"], description: "1: add the written explanation and the source lines behind every power ($0.50)" } }, path: { address: { type: "string", description: "hook address", pattern: "^0x[0-9a-fA-F]{40}$" } },
    output: hookOut, outputExample: hookExample, crew: "watchtower",
  },
  {
    id: "hook-inspector-explained", name: "Hook Inspector (explained)", kind: "tool", pitch: "The hook inspection with a written explanation and the source lines behind every power.", priceUsdc: 500_000n, method: "GET",
    route: "/api/v1/hook/{address}?explain=1", example: `/api/v1/hook/${HOOK}?explain=1`, page: "/services/hook",
    description: "Use when an agent or a launch team needs a Uniswap v4 hook explained in plain words: the full Hook Inspector report plus a written explanation of every callback, fee and admin power, with the verified source lines each claim rests on. Ethereum. Run by NIGHTSHIFT.",
    query: { explain: { type: "string", enum: ["1"], description: "1" } }, path: { address: { type: "string", description: "hook address", pattern: "^0x[0-9a-fA-F]{40}$" } },
    output: hookOut, outputExample: { ...hookExample, explanation: { text: "This is the NightshiftHook (NIGHTSHIFT ($SHIFT, IMD launch #2124)). …", excerpts: [{ name: "setFees", code: "// src/NightshiftHook.sol:246 …" }] } }, crew: "watchtower",
  },
  {
    id: "imd-feed", name: "IMD Data Feed", kind: "dataset", pitch: "IMD launches, tokens, swarm health and seats, as JSON.", priceUsdc: 1_000n, method: "GET",
    route: "/api/v1/imd/{launches|launches/{id}|tokens|swarm|agents/{seat}}", example: "/api/v1/imd/launches?chain=ethereum&limit=20", page: "/services/imd-feed",
    description: "Use when an agent needs IMD (imd.fun) ecosystem data: launches with status, token, v4 pool, liquidity and volume; one launch with holders and the seats that built it; every live launch token's market; the swarm's health from the IMD Watchtower; a seat's work history. Poll with since= for changes. $0.001 per call, sample=1 free. Run by NIGHTSHIFT.",
    query: {
      sample: { type: "string", enum: ["1"], description: "free sample of 3 items" }, since: { type: "string", description: "ISO time: only what changed after it (polling)" },
      chain: { type: "string", enum: ["ethereum", "robinhood", "sepolia"], description: "launches: filter by chain" }, kind: { type: "string", description: "launches: custom_token, univ4_hook, evm_contracts, evm_project" },
      status: { type: "string", description: "launches: live, parked, assembling…" }, limit: { type: "integer", description: "page size" }, before: { type: "string", description: "page cursor from next.before" },
    },
    path: { id: { type: "string", description: "launch number or id (launches/{id})" }, seat: { type: "string", description: "seat token id (agents/{seat})", pattern: "^\\d{1,6}$" } },
    output: feedOut, outputExample: feedExample, crew: "research",
  },
  {
    id: "watchtower-check", name: "Watchtower: what changed", kind: "tool", pitch: "What changed on an Ethereum token or v4 hook since the last observation, with before/after values and block evidence.", priceUsdc: 10_000n, method: "GET",
    route: "/api/v1/watchtower/check/{chain}/{address}", example: `/api/v1/watchtower/check/ethereum/${SHIFT}`, page: "/watchtower",
    description: "Use when an agent needs to know what changed on an Ethereum ERC-20 token or Uniswap v4 hook since the previous observation: owner and admin, proxy upgrades, bytecode, pause, fees, supply and liquidity, each change with before/after values, block numbers and links; checks that could not run are listed, never read as unchanged. Run by NIGHTSHIFT's Watchtower crew.",
    query: {}, path: watchPath, output: watchOut, outputExample: watchExample, crew: "watchtower",
  },
  {
    id: "watchtower-watch", name: "Watchtower: 7-day watch", kind: "tool", pitch: "Seven days of hourly watching for one token or hook, one prepaid term, alerts on Telegram, no renewal.", priceUsdc: 1_000_000n, method: "GET",
    route: "/api/v1/watchtower/watch/{chain}/{address}?days=7", example: `/api/v1/watchtower/watch/ethereum/${SHIFT}?days=7`, page: "/watchtower",
    description: "Use when an agent or a holder wants an Ethereum token or Uniswap v4 hook watched: hourly observations for 7 days, one prepaid term with no renewal and no recurring charge, a stop control, and opt-in Telegram alerts on owner, upgrade, fee, pause, supply or liquidity changes and on checks that stop working. Returns the baseline and a manage token. Run by NIGHTSHIFT's Watchtower crew.",
    query: { days: { type: "string", enum: ["7"], description: "7: the term this price buys" } }, path: watchPath, output: watchOut, outputExample: { ...watchExample, changes: [], summary: "Baseline recorded at block 23650000; watching hourly until 2026-11-01.", watch: { id: "w_0123456789abcdef", days: 7 }, manageToken: "…", telegram: "https://t.me/…?start=wt_…" }, crew: "watchtower",
  },
  {
    id: "research-report", name: "Research Desk: evidence report", kind: "report", pitch: "A source-linked answer from the IMD swarm's published work, with what it covers and what it does not.", priceUsdc: 250_000n, method: "GET",
    route: "/api/v1/research?q={question}", example: "/api/v1/research?q=What%20has%20the%20IMD%20swarm%20published%20about%20Uniswap%20v4%20hooks%3F", page: "/crews/research",
    description: "Use when an agent needs a short evidence report on an IMD, onchain or AI-agent question: an answer written only from the IMD swarm's published research, audits, contracts and sites (SWARM MIND), every source linked to explorer.imd.fun, with its coverage and gaps stated. No source, no claim. Run by NIGHTSHIFT's Research Desk crew.",
    query: { q: { type: "string", description: "the question, 3 to 500 characters" } }, path: {},
    output: researchOut, outputExample: researchExample, crew: "research",
  },
  {
    id: "swarm-order", name: "Swarm Desk", kind: "tool", pitch: "Hire 1,000+ IMD agents with USDC: websites, sourced research, Solidity audits and contracts with tests.", priceUsdc: 3_000_000n, method: "GET",
    route: "/api/v1/swarm/order", example: "/api/v1/swarm/order?quoteId=00000000-0000-4000-8000-000000000000", page: "/crews/swarm",
    description: SWARM_PITCH,
    query: { quoteId: { type: "string", description: "The UUID returned by a free checked quote; required to pay. Example: 00000000-0000-4000-8000-000000000000", required: true } }, path: { quoteId: { type: "string", description: "the quoteId returned by GET /api/v1/swarm/quote" } },
    output: { required: ["orderId", "status", "payment"], properties: { orderId: { type: "string" }, status: { type: "string" }, orderToken: { type: "string", description: "Private status token. Keep it; an identical signed payment retry returns the same token." }, payment: { type: "object" } } },
    outputExample: { orderId: "sd_example", status: "running", orderToken: "keep-this-token", payment: { tx: "0x…", network: "eip155:8453", priceUsd: 4.9 } }, crew: "swarm", quoted: true,
  },
  {
    id: "buildcheck-report", name: "Build & Check: integration report", kind: "tool", pitch: "Is your agent service reachable and discoverable? MCP, x402, OpenAPI and discovery documents, each check with the curl to rerun it.", priceUsdc: 100_000n, method: "GET",
    route: "/api/v1/buildcheck?url={url}", example: "/api/v1/buildcheck?url=https%3A%2F%2Fgetnightshift.tech%2Fmcp%2Fpublic", page: "/crews/buildcheck",
    description: "Use when an agent or its builder needs to know if a public agent service works for other agents: MCP initialize and tools/list, the x402 402 challenge and Bazaar metadata, the OpenAPI document and /llms.txt, agent-card and mcp.json, each check pass, warn, fail or unavailable with the exact curl to reproduce it. HTTPS public URLs only. Run by NIGHTSHIFT's Build & Check crew.",
    query: { url: { type: "string", description: "the https URL of the MCP endpoint, paid route or API to check" } }, path: {},
    output: buildcheckOut, outputExample: buildcheckExample, crew: "buildcheck",
  },
  ...FAST_OFFERS,
];
export const offer = (id: OfferId) => OFFERS.find((o) => o.id === id)!;
export const usdOf = (o: Offer) => Number(o.priceUsdc) / 1e6;

/**
 * Holders pay half: a paying wallet holding HOLDER_SHIFT or more $SHIFT (in the wallet plus staked in
 * ShiftRewards), a NIGHT FROG or a Night Watcher. The house services are NIGHTSHIFT's own, so the
 * discount costs no company owner anything.
 */
export const HOLDER_SHIFT = 500_000;
export const holderPriceOf = (o: Offer) => o.quoted ? o.priceUsdc : isFastId(o.id) && o.priceUsdc / 2n < 1_000n ? 1_000n : o.priceUsdc / 2n;
export const HOLDER_RULE = `Holders pay half: a paying wallet that holds ${HOLDER_SHIFT.toLocaleString("en-US")}+ $SHIFT (in the wallet plus staked), a NIGHT FROG or a Night Watcher gets NIGHTSHIFT house checks and reports at 50%. Fast lookup holder prices have a $0.001 minimum. Swarm Desk orders cost the full quoted price. Ask with holder=<that wallet> (MCP: holderWallet) to get the holder terms, then pay from that wallet.`;

/** The route as the Bazaar's template (`/api/v1/hook/:address`), when it is one plain path. */
const patternOf = (o: Offer) => { const r = o.route.split("?")[0]!; return r.includes("|") ? undefined : r.replace(/\{(\w+)\}/g, ":$1"); };
/**
 * The x402 v2 "bazaar" extension a 402 challenge and the catalogue carry: how to call it and what
 * comes back. Built by the x402 project's own declareDiscoveryExtension and enriched for GET on this
 * path, the shape the CDP facilitator validates and lists (as the companies' products are).
 */
export function bazaarOf(o: Offer, path = o.example.split("?")[0]!) {
  // the example's query, typed as the schema says (limit=20 is a number)
  const input = Object.fromEntries([...new URLSearchParams(o.example.split("?")[1] ?? "")].map(([k, v]) => [k, o.query[k]?.type === "integer" ? Number(v) : v]));
  const { bazaar: declared } = declareDiscoveryExtension({
    input,
    inputSchema: { type: "object", properties: Object.fromEntries(Object.entries(o.query).map(([k, { required: _required, ...v }]) => [k, v])), ...(isFastId(o.id) || o.quoted ? { required: Object.entries(o.query).filter(([, v]) => v.required !== false).map(([k]) => k) } : {}) },
    ...(o.quoted && path.startsWith("/api/v1/swarm/order/") ? { pathParamsSchema: { type: "object", properties: o.path, required: Object.keys(o.path) } } : {}),
    output: { example: o.outputExample, schema: { type: "object", required: o.output.required, properties: o.output.properties } },
  });
  return { bazaar: bazaarResourceServerExtension.enrichDeclaration!(declared, { method: "GET", routePattern: o.quoted && path.startsWith("/api/v1/swarm/order/") ? "/api/v1/swarm/order/:quoteId" : patternOf(o), adapter: { getPath: () => path } }) as Record<string, unknown> };
}

/** The services' entries for /api/market/catalog, in the same discovery shape as the companies' products. */
export function catalogItems(base: string, chainId: number, payTo: Address | null) {
  if (!payTo) return [];
  return [...OFFERS].sort((a, b) => Number(Boolean(b.quoted)) - Number(Boolean(a.quoted))).map((o) => ({
    resource: o.quoted ? `${base}/api/v1/swarm/order` : `${base}${o.example}`, type: "http", x402Version: 2, accepts: [requirement(chainId, payTo, o.priceUsdc)],
    description: o.description, mimeType: "application/json", lastUpdated: new Date().toISOString(),
    metadata: {
      id: o.id, name: o.name, kind: o.kind, pitch: o.pitch, priceUsd: usdOf(o), ...(o.quoted ? { priceIsMinimum: true, quote: `${base}/api/v1/swarm/quote` } : {}), route: `${base}${o.route}`, page: `${base}${o.page}`,
      company: { name: "NIGHTSHIFT Services", slug: "nightshift-services", runBy: "NIGHTSHIFT", house: true }, ...bazaarOf(o),
    },
  }));
}

export const SERVICE_PAGES = [
  { path: "/services", title: "NIGHTSHIFT Services", about: "House services run by NIGHTSHIFT, sold over x402 and MCP: Token Verdict, Hook Inspector, IMD Data Feed, Watchtower, Research Desk, Build & Check and Swarm Desk." },
  { path: "/services/verdict", title: "Token Verdict", about: "Before you buy an Ethereum token: no issues found, caution or avoid, with reasons and evidence. Made for IMD launches and Uniswap v4 hook tokens. $0.01 quick, $0.25 deep, one free demo a day." },
  { path: "/services/hook", title: "Hook Inspector", about: "What a Uniswap v4 hook can do: permission bits, callbacks, fees, owner powers, upgrades and known templates. $0.05, or $0.50 explained." },
  { path: "/services/imd-feed", title: "IMD Data Feed", about: "IMD launches, tokens, swarm health and seat work history as JSON for agents and bots. $0.001 per call, free samples." },
  { path: "/crews/swarm", title: "Swarm Desk", about: "Hire the IMD swarm with USDC: websites, research, audits and contracts built by 1,000+ IMD agents. Free checked quotes last 10 minutes, from $3.00, no holder discount. Preview until SWARM_DESK=1." },
];

/** Lines for /llms.txt. */
export function llmsLines(base: string): string[] {
  return [
    "## Swarm Desk: hire AI agents with one USDC payment",
    `- ${SWARM_PITCH} Free quote: GET ${base}/api/v1/swarm/quote?kind=<${SWARM_KINDS.join("|")}>&brief=<work>. Pay: GET ${base}/api/v1/swarm/order?quoteId=<uuid>. Poll: GET ${base}/api/v1/swarm/jobs/<orderId>?token=<orderToken>. MCP: swarm_quote -> swarm_order -> swarm_job. Stats: ${base}/api/v1/swarm/stats. Quotes expire in 10 minutes; from $3; no holder discount.`,
    "## House services (run by NIGHTSHIFT, pay per call over x402 in USDC on Base, or over MCP)",
    ...FAST_OFFERS.map((o) => `- [${o.name}](${base}${o.page}): GET ${base}${o.example} ($${usdOf(o)} USDC; holder $${Number(holderPriceOf(o)) / 1e6}). MCP: ${o.id.replaceAll("-", "_")}. ${o.description}`),
    `- [Token Verdict](${base}/services/verdict): GET ${base}/api/v1/verdict/ethereum/<token>?depth=quick ($0.01) or depth=deep ($0.25). Safe / caution / avoid for an Ethereum token, made for IMD launches and v4 hook tokens, every reason with evidence. Free: ${base}/api/v1/verdict/ethereum/<token>/preview, and one full quick verdict per IP per day with demo=1.`,
    `- [Hook Inspector](${base}/services/hook): GET ${base}/api/v1/hook/<address> ($0.05), explain=1 ($0.50). Free: ${base}/api/v1/hook/<address>/flags.`,
    `- [IMD Data Feed](${base}/services/imd-feed): GET ${base}/api/v1/imd/launches, /imd/launches/<n>, /imd/tokens, /imd/swarm, /imd/agents/<seat> ($0.001 each; sample=1 free; since= for polling).`,
    `- OpenAPI: ${base}/openapi.json · prices and payment terms: ${base}/api/v1/services · MCP tools on ${base}/mcp/public: verdict_preview, verdict_demo, token_verdict, hook_flags, hook_inspect, imd_feed_sample, imd_feed, services_pricing (paid tools take holderWallet for the holder price).`,
    `- ${HOLDER_RULE}`,
  ];
}

/** Skills for the agent card. */
export function agentSkills(base: string) {
  return [
    ...FAST_OFFERS.map((o) => ({ id: o.id, name: o.name, description: o.description, tags: ["x402", o.crew, "lookup"], examples: [`${base}${o.example}`] })), 
    { id: "token-verdict", name: "Token Verdict", description: "Pre-buy verdict (no issues found / caution / avoid) for Ethereum tokens, specialised on IMD launches and Uniswap v4 hook tokens, with cited evidence. x402: $0.01 quick, $0.25 deep.", tags: ["x402", "token-safety", "imd", "uniswap-v4"], examples: [`${base}/api/v1/verdict/ethereum/${SHIFT}?depth=quick`] },
    { id: "hook-inspector", name: "Hook Inspector", description: "Decodes a Uniswap v4 hook: permission bits, callbacks, fees, owner powers, upgradeability, known templates. x402: $0.05, $0.50 explained.", tags: ["x402", "uniswap-v4", "hooks", "security"], examples: [`${base}/api/v1/hook/${HOOK}`] },
    { id: "imd-feed", name: "IMD Data Feed", description: "IMD launches, tokens, swarm health and seat work history as JSON, with since= polling. x402: $0.001 per call, free samples.", tags: ["x402", "imd", "data"], examples: [`${base}/api/v1/imd/launches?sample=1`] },
    { id: "swarm-desk", name: "Swarm Desk", description: offer("swarm-order").description, tags: ["x402", "imd", "websites", "research", "solidity"], examples: [`${base}/api/v1/swarm/quote?kind=research&brief=Research%20the%20IMD%20ecosystem%20with%20sources`] },
  ];
}

/** OpenAPI 3.1 for the services, with the x402 terms and the planned watch plans. */
export function openapi(base: string, chainId: number, payTo: Address | null) {
  const pay = (o: Offer) => ({
    "x-payment-info": { protocols: ["x402"], price: o.quoted ? { mode: "dynamic", currency: "USD", min: "3.00" } : { mode: "fixed", currency: "USD", amount: String(usdOf(o)) }, protocol: "x402", version: 2, scheme: "exact", network: `eip155:${chainId}`, asset: "USDC", amount: o.priceUsdc.toString(), priceUsd: usdOf(o), payTo },
    responses: {
      200: { description: "The answer (and, when paid, a PAYMENT-RESPONSE header with the settlement)", content: { "application/json": { schema: { type: "object", required: o.output.required, properties: o.output.properties }, example: o.outputExample } } },
      402: { description: "Payment required: the x402 v2 challenge (also base64 in the PAYMENT-REQUIRED header), with extensions.bazaar" },
      429: { description: "Too many calls from this IP" }, 503: { description: "Busy or a source did not answer; nothing was charged" },
    },
  });
  const p = (name: string, where: "path" | "query", d: { type: string; description: string; enum?: string[]; pattern?: string; required?: boolean }, required = where === "path" || d.required === true) => ({ name, in: where, required, description: d.description, schema: { type: d.type === "integer" ? "integer" : "string", ...(d.enum ? { enum: d.enum } : {}), ...(d.pattern ? { pattern: d.pattern } : {}) } });
  const v = offer("token-verdict-quick"), h = offer("hook-inspector"), f = offer("imd-feed"), s = offer("swarm-order");
  const feedOp = (summary: string, params: unknown[]) => ({ get: { summary, tags: ["IMD Data Feed"], parameters: [...params, p("sample", "query", f.query.sample!), p("since", "query", f.query.since!)], ...pay(f) } });
  return {
    openapi: "3.1.0",
    info: { title: "NIGHTSHIFT Services", version: "1.0.0", description: "House services run by NIGHTSHIFT, including Swarm Desk for new IMD work paid in USDC. Pay per call with x402 (USDC on Base, EIP-3009), or use the MCP tools at /mcp/public. Automated checks, not financial advice.", contact: { url: base } },
    servers: [{ url: base }],
    paths: {
      "/api/v1/swarm/order": { get: { summary: "Hire AI agents: pay the exact checked quote with USDC on Base", description: SWARM_PITCH, tags: ["Swarm Desk"], parameters: [p("quoteId", "query", { type: "string", description: "UUID from the free checked quote", required: true })], ...pay(s), responses: { ...pay(s).responses, 202: { description: "Settlement pending: retry the identical signed request" }, 502: { description: "Payment settled, IMD job failed; refund owed is recorded" } } } },
      "/api/v1/swarm/stats": { get: { summary: "Live IMD swarm and desk capacity, kinds and prices (free)", responses: { 200: { description: "Live counters or explicit unavailable fields; cached 60 seconds" } } } },
      ...Object.fromEntries(OFFERS.filter((o) => ["research-report", "buildcheck-report", "watchtower-check", "watchtower-watch"].includes(o.id)).map((o) => [o.route.split("?")[0]!, { get: { summary: o.name, description: o.description, parameters: [...Object.entries(o.path).map(([k, v]) => p(k, "path", v)), ...Object.entries(o.query).map(([k, v]) => p(k, "query", v))], ...pay(o) } }])),
      "/api/v1/a2a": { post: { summary: "A2A 0.3 JSON-RPC: message/send and tasks/get", responses: { 200: { description: "A2A Message or Task" }, 402: { description: "x402 payment challenge for the selected paid tool" } } } },
      ...Object.fromEntries(FAST_OFFERS.map((o) => [o.route, { get: { summary: o.name, description: o.description, tags: ["Fast agent tools"], parameters: Object.entries(o.query).map(([k, v]) => p(k, "query", v)), ...pay(o) } }])),
      "/api/v1/services": { get: { summary: "Every service with its price and payment terms (free)", tags: ["Services"], responses: { 200: { description: "Offers" } } } },
      "/api/v1/swarm/quote": { get: { summary: "Free IMD-checked quote, valid for 10 minutes", tags: ["Swarm Desk"], parameters: [p("kind", "query", { type: "string", enum: [...SWARM_KINDS], description: "kind of work" }, true), p("brief", "query", { type: "string", description: "20 to 1500 characters; logo instead requires name and style" }), p("repo", "query", { type: "string", description: "audit/tests/review: public GitHub repository" }), ...["commit", "chain", "address", "name", "style"].map((key) => p(key, "query", { type: "string", description: key === "commit" ? "Full Git commit hash; required for tests" : key === "chain" ? "frontend: ethereum or base" : key === "address" ? "frontend: verified contract address" : `logo: ${key}` }))], responses: { 200: { description: "quoteId, priceUsd, imd, whatYouGet, eta, expiresAt and pay URL" }, 422: { description: "IMD blockers" }, 503: { description: "Desk off or IMD price unavailable" } } } },
      "/api/v1/swarm/order/{quoteId}": { get: { summary: "Pay the exact quote, then hire the IMD swarm", tags: ["Swarm Desk"], parameters: [p("quoteId", "path", s.path.quoteId!)], ...pay(s), "x-payment-info": { ...pay(s)["x-payment-info"], amount: "from the quote", priceUsd: "from the quote", holderDiscount: false }, responses: { ...pay(s).responses, 202: { description: "USDC settlement pending: retry the same authorization" }, 410: { description: "Quote expired: get a new free quote" }, 502: { description: "USDC settled but IMD failed: refund owed is recorded; includes payment transaction" }, 503: { description: "Desk unavailable, or settlement not confirmed: retry the same authorization if payment was submitted" } } } },
      "/api/v1/swarm/jobs/{orderId}": { get: { summary: "Free job status and delivered result links/files", tags: ["Swarm Desk"], parameters: [p("orderId", "path", { type: "string", description: "the NIGHTSHIFT orderId" }), p("token", "query", { type: "string", description: "the private orderToken returned with the paid answer; recover it by retrying the same signed payment" }, true)], responses: { 200: { description: "IMD status and result" }, 404: { description: "Unknown order or invalid token" } } } },
      "/api/v1/verdict/{chain}/{token}": { get: { summary: "Token Verdict: no issues found / caution / avoid with evidence ($0.01 quick, $0.25 deep)", tags: ["Token Verdict"], parameters: [p("chain", "path", v.path.chain!), p("token", "path", v.path.token!), p("depth", "query", v.query.depth!), p("demo", "query", { type: "string", description: "1: the free demo, one quick verdict per IP per day" })], ...pay(v) } },
      "/api/v1/verdict/{chain}/{token}/preview": { get: { summary: "Free preview: IMD launch match, market, copycat signal and hook bits, no verdict", tags: ["Token Verdict"], parameters: [p("chain", "path", v.path.chain!), p("token", "path", v.path.token!)], responses: { 200: { description: "Preview" } } } },
      "/api/v1/hook/{address}": { get: { summary: "Hook Inspector ($0.05; explain=1 $0.50)", tags: ["Hook Inspector"], parameters: [p("address", "path", h.path.address!), p("explain", "query", h.query.explain!)], ...pay(h) } },
      "/api/v1/hook/{address}/flags": { get: { summary: "Free: the hook's permission bits from its address and a known-template match", tags: ["Hook Inspector"], parameters: [p("address", "path", h.path.address!)], responses: { 200: { description: "Flags" } } } },
      "/api/v1/imd/launches": feedOp("IMD launches, newest first ($0.001)", [p("chain", "query", f.query.chain!), p("kind", "query", f.query.kind!), p("status", "query", f.query.status!), p("limit", "query", f.query.limit!), p("before", "query", f.query.before!)]),
      "/api/v1/imd/launches/{id}": feedOp("One IMD launch: record, pool state, holders, builders ($0.001)", [p("id", "path", f.path.id!)]),
      "/api/v1/imd/tokens": feedOp("Every live IMD launch token on Ethereum with its market ($0.001)", [p("limit", "query", f.query.limit!), p("indexed", "query", { type: "string", description: "0: include tokens DexScreener does not index" })]),
      "/api/v1/imd/swarm": feedOp("The IMD swarm's health: IMD Watchtower status and incidents, api.imd.fun/swarm and /health ($0.001)", []),
      "/api/v1/imd/agents/{seat}": feedOp("One seat's record, standing and work history ($0.001)", [p("seat", "path", f.path.seat!), p("before", "query", f.query.before!), p("limit", "query", f.query.limit!)]),
    },
    "x-nightshift-planned": {
      note: "Watch plans (not live yet). Until then, poll any list with since= and send back next.since.",
      watch: {
        "POST /api/v1/imd/watch": { body: { topics: ["launches", "launch:<n>", "swarm", "agent:<seat>"], url: "https://your.agent/webhook", secret: "for the HMAC-SHA256 signature header X-NIGHTSHIFT-Signature" }, plans: { "watch-5": "$5/month: 3 topics, 1-minute polling", "watch-20": "$20/month: 20 topics, 15-second polling" }, payment: "x402 for the first month; renewals by Base spend permission" },
        events: { "launch.created": "a new IMD launch", "launch.status": "a launch changed status (admitted, live, parked)", "swarm.incident": "the IMD Watchtower opened or resolved an incident", "agent.work": "a watched seat submitted or got work accepted" },
        delivery: "at least once, in order per topic, retried with backoff for 24 h; each event carries its id for deduplication",
      },
    },
  };
}
