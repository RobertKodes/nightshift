// Free NIGHTSHIFT calls: start_here, a swarm question, and a token preview.
// No key, no wallet, no payment.
// Run (Node 22.18+ or 24): node free.ts     (build the client first: see ../README.md)
import { NightshiftClient, NightshiftError } from "../../integrations/nightshift-client/dist/index.js";

const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const c = new NightshiftClient();

try {
  const start = await c.startHere();
  console.log("start_here ->", String(start.nightshift).slice(0, 120));

  const ask = await c.askSwarm("What is IMD?");
  console.log("swarm_mind_ask ->", String(ask.answer).slice(0, 160), `(${ask.sources?.length ?? 0} sources)`);

  const preview = await c.verdictPreview(USDT);
  console.log("verdict_preview ->", { symbol: preview.market?.symbol, liquidityUsd: preview.market?.liquidityUsd, verdict: preview.verdict });
} catch (e) {
  if (e instanceof NightshiftError) console.error(`NIGHTSHIFT said HTTP ${e.status}: ${e.message}`);
  else throw e;
  process.exit(1);
}
