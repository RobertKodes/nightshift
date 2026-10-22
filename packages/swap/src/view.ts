import { formatUnits } from "viem";
import { CHAINS } from "./chains.js";
import { pct } from "./fee.js";
import type { Quote } from "./types.js";

/** A token amount for reading: up to 4 decimals above 1, 4 significant digits below. */
export function amountText(v: string | bigint, decimals: number): string {
  const n = Number(formatUnits(BigInt(v), decimals));
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 2 : 4 });
  return n < 1e-6 ? n.toExponential(2) : String(Number(n.toPrecision(4)));
}
export const usdText = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : n > 0 && n < 0.01 ? "under $0.01" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const etaText = (s: number) => (s < 90 ? `about ${Math.max(1, Math.round(s))} s` : `about ${Math.round(s / 60)} min`);

/** The hops of a route, in order: "ETH on Ethereum", "Across", "WETH on Robinhood Chain", "SushiSwap", "IMD". */
export function routePath(q: Quote): string[] {
  const path = [`${q.fromToken.symbol} on ${CHAINS[q.fromChain].name}`];
  for (const s of q.steps) {
    if (s.type === "fee" || s.type === "wrap") continue;
    const where = s.toChain ? CHAINS[s.toChain].name : "";
    path.push(s.tool, `${s.to}${where ? ` on ${where}` : ""}`);
  }
  if (path.length === 1) path.push(q.tool, `${q.toToken.symbol} on ${CHAINS[q.toChain].name}`);
  return path;
}

/** The bridges and exchanges a route goes through, in words. */
function via(q: Quote): string {
  const tools = routePath(q).filter((_, i) => i % 2 === 1);
  if (q.provider !== "relay") return tools.join(", ");
  const swaps = tools.filter((t) => t !== "Relay");
  return `one deposit, filled by a Relay solver${swaps.length ? `, swapped on ${swaps.join(", ")}` : ""}`;
}

const tokens = (q: Quote) => Number(formatUnits(BigInt(q.toAmount), q.toToken.decimals));
/**
 * What each route leaves you with once its gas is paid, in the token received. One price for all of them
 * (providers price the same token a little differently), so only amounts and gas decide.
 */
function netOf(qs: Quote[]): (q: Quote) => number {
  const priced = qs.filter((q) => q.toUsd !== null && tokens(q) > 0);
  const price = priced.length ? priced.reduce((s, q) => s + q.toUsd! / tokens(q), 0) / priced.length : 0;
  return (q) => tokens(q) - (price > 0 ? (q.gasUsd ?? 0) / price : 0);
}

/** How much more or less another route leaves you with, after gas, in the token received. */
export function routeDiff(o: Quote, q: Quote): string {
  const net = netOf([o, q]), d = net(o) - net(q), a = Math.abs(d);
  const n = a >= 1 ? a.toLocaleString("en-US", { maximumFractionDigits: 4 }) : String(Number(a.toPrecision(3)));
  return `${n} ${o.toToken.symbol} ${d >= 0 ? "more" : "less"} after gas`;
}

/** The lines under a quote, in the order a person checks them. */
export function routeRows(q: Quote): { k: string; v: string }[] {
  const out = Number(formatUnits(BigInt(q.toAmount), q.toToken.decimals)), inn = Number(formatUnits(BigInt(q.fromAmount), q.fromToken.decimals));
  const rate = inn > 0 ? out / inn : 0;
  const providerFees = q.fees.length ? q.fees.map((f) => `${f.name} ${usdText(f.usd)}`).join(", ") : "none listed";
  const ns = q.nightshift.waived ? "None: you are a holder" : q.nightshift.bps > 0 ? `${pct(q.nightshift.bps)}, ${usdText(q.nightshift.usd)}` : "None on this route";
  return [
    { k: "Route", v: `${q.providerName}: ${via(q)}` },
    { k: "You get at least", v: `${amountText(q.toAmountMin, q.toToken.decimals)} ${q.toToken.symbol}` },
    { k: "Rate", v: `1 ${q.fromToken.symbol} = ${rate >= 1 ? rate.toLocaleString("en-US", { maximumFractionDigits: 4 }) : String(Number(rate.toPrecision(4)))} ${q.toToken.symbol}` },
    { k: `${q.providerName} fees`, v: providerFees },
    { k: "NIGHTSHIFT fee", v: ns },
    { k: "Network gas", v: usdText(q.gasUsd) },
    { k: "Time", v: etaText(q.etaSeconds) },
    { k: "Slippage", v: pct(Math.round(q.slippage * 10_000)) },
  ];
}

/**
 * Routes best first: the ones that passed every check, then the most received less the gas paid. All routes of
 * one answer deliver the same token, so the amounts compare as they are.
 */
export function bestFirst(qs: Quote[]): Quote[] {
  const net = netOf(qs);
  return [...qs].sort((a, b) => (a.problems.length ? 1 : 0) - (b.problems.length ? 1 : 0) || net(b) - net(a));
}
