import { DAY } from "./clock.js";

/**
 * Scoring a prospect, with every point explained. Points come from a concrete service fit, recent
 * activity, evidence of demand and a permitted channel. Stars and followers are shown but never
 * scored: popularity alone qualifies nothing.
 */

/** Which invitation fits: one of the three house crews, or "run your agent as a crew". */
export type Fit = "watchtower" | "buildcheck" | "research" | "operator";

export type Scored = { score: number; reasons: string[]; crew: Fit | null; qualified: boolean };

export type Prospect = {
  source: "github" | "imd"; name: string; description: string; topics: string[];
  pushedAt: string | null; stars: number; openIssues: number; flags: string[];
};

const FITS: { crew: Fit; label: string; strong: string[]; weak: string[] }[] = [
  { crew: "watchtower", label: "Watchtower", strong: ["uniswap-v4", "uniswap v4", "uniswapv4", "v4-hooks", "v4 hooks", "v4 hook", "univ4", "token launch", "launchpad"], weak: ["hook", "hooks", "erc20", "erc-20", "liquidity", "amm", "pool"] },
  { crew: "operator", label: "agent operators", strong: ["x402", "agent marketplace", "agents marketplace", "agent-marketplace", "identity-md", "imd.fun"], weak: ["mcp", "mcp-server", "model context protocol", "ai agent", "ai-agent", "ai-agents", "autonomous agent", "agents", "agent"] },
  { crew: "buildcheck", label: "Build & Check", strong: ["smart contract audit", "solidity audit"], weak: ["solidity", "foundry", "hardhat", "smart contract", "smart-contract", "smart-contracts", "audit", "fuzzing", "invariant testing"] },
  { crew: "research", label: "Research Desk", strong: [], weak: ["research", "analytics", "indexer", "on-chain data", "onchain data", "market data", "dune"] },
];
/** Words that place a weak match on chain (an "agent" alone could be anything). */
const CONTEXT = ["onchain", "on-chain", "crypto", "ethereum", "evm", "web3", "defi", "uniswap", "solidity", "blockchain", "usdc", "imd", "x402", "erc20", "base-chain", "l2"];
const DEMAND = ["looking for", "help wanted", "feedback", "contributors welcome", "beta", "mainnet", "production", "live on", "launched", "deployed", "monitoring", "alerts", "audit", "testnet"];

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, w: string) => new RegExp(`(?<![a-z0-9])${esc(w)}(?![a-z0-9])`, "i").test(text);

export function qualify(p: Prospect, now: number, o: { channel: string | null; minScore: number }): Scored {
  const reasons: string[] = [];
  const text = `${p.name.replace(/[/_-]/g, " ")} ${p.description} ${p.topics.join(" ")} ${p.topics.map((t) => t.replace(/-/g, " ")).join(" ")}`.toLowerCase();
  if (p.flags.length) return { score: 0, reasons: [`rejected: ${p.flags.join(", ")} (never contacted)`], crew: null, qualified: false };

  // 1. service fit
  const onChain = p.source === "imd" || CONTEXT.some((w) => has(text, w));
  let best: { crew: Fit; label: string; points: number; words: string[] } | null = null;
  for (const f of FITS) {
    const strong = f.strong.filter((w) => has(text, w));
    const weak = f.weak.filter((w) => has(text, w));
    const imd = p.source === "imd" && f.crew === "watchtower";
    if (!strong.length && !imd && !(weak.length && onChain)) continue;
    const words = imd ? ["new IMD launch", ...strong, ...weak] : [...strong, ...weak];
    const points = (strong.length || imd ? 40 : 30) + Math.min(10, 5 * (words.length - 1));
    if (!best || points > best.points) best = { crew: f.crew, label: f.label, points, words };
  }
  let score = 0;
  if (best) { score += best.points; reasons.push(`fit: ${best.label} (${best.words.slice(0, 4).join(", ")})`); }
  else reasons.push("no service fit");

  // 2. recent activity
  const pushed = p.pushedAt ? Date.parse(p.pushedAt) : NaN;
  const days = Number.isFinite(pushed) ? Math.max(0, Math.floor((now - pushed) / DAY)) : Infinity;
  const active = days <= 30;
  if (days <= 7) { score += 20; reasons.push(`active: ${p.source === "imd" ? "launched" : "pushed"} ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}`); }
  else if (active) { score += 10; reasons.push(`active: pushed ${days} days ago`); }
  else reasons.push("inactive: nothing in 30 days");

  // 3. evidence of demand
  const said = DEMAND.filter((w) => has(text, w));
  if (p.source === "imd") { score += 15; reasons.push("demand: a token just went live on IMD"); }
  else if (said.length) { score += 15; reasons.push(`demand: mentions ${said.slice(0, 3).join(", ")}`); }
  else if (p.openIssues >= 5) { score += 15; reasons.push(`demand: ${p.openIssues} open issues (people use it)`); }

  // 4. a permitted channel
  if (o.channel) { score += 15; reasons.push(`channel: ${o.channel} welcomes suggestions`); }
  else reasons.push("channel: none that welcomes suggestions yet, so a draft waits for the owner");

  if (p.stars) reasons.push(`stars: ${p.stars} (not scored)`);
  const qualified = Boolean(best) && active && score >= o.minScore;
  if (best && active && !qualified) reasons.push(`below the bar: ${score} < ${o.minScore}`);
  return { score: Math.min(100, score), reasons, crew: best?.crew ?? null, qualified };
}
