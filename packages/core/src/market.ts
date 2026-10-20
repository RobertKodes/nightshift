import type { LlmClient } from "@nightshift/llm";
import { DEFAULT_POLICY } from "./policy.js";
import type { Company, MarketCandidate, MarketPick, MarketVerdict, ProductKind, Task } from "./types.js";
import { fromUsdc } from "./types.js";

/**
 * "Buy from the market first": before a company pays the IMD swarm for research, it looks for a
 * product another NIGHTSHIFT company already sells on the same topic. Only real demand: never from a
 * company with the same owner, never its own product or one it already bought, only when it is
 * relevant to the brief and cheaper than the swarm order, inside the owner's market limits.
 */

/** A product on sale, as the market search returns it, with its free preview. */
export interface MarketOffer {
  seller: { id: string; name: string; slug: string; owner: string | null; sim: boolean };
  product: { id: string; name: string; kind: ProductKind; pitch: string; priceUsdc: bigint };
  preview: { title: string; outline: string[]; opening: string } | null;
}

/** What the buyer gets once the purchase is booked on both sides. */
export interface MarketReceipt {
  /** The file, as a link the buyer may open (signed for this purchase). */
  url: string;
  ledgerId: string;
  tx: string | null;
  sim: boolean;
}

export interface MarketDeps {
  /** Every product on sale with its free preview (the agent market's search). */
  offers(buyer: Company): Promise<MarketOffer[]>;
  /** USDC the company may spend from its own wallet, in base units. */
  usdc(buyer: Company): Promise<bigint>;
  /**
   * Pays the seller over x402 from the buyer's wallet and books both sides. Throws an error with
   * `pending` (the settlement key) when the payment was sent and has not landed yet.
   */
  pay(buyer: Company, pick: MarketPick, t: Task): Promise<MarketReceipt>;
}

/**
 * Relevance thresholds. Keywords: the product's free preview must contain at least 40% of the
 * brief's key terms, and at least 3 of them (all of them when the brief has fewer). Model: a score of
 * 0.7 or more, where 1 answers the same question for the same audience and 0.5 is the same topic only.
 */
export const RELEVANT = { keywords: 0.4, model: 0.7, minShared: 3 } as const;

const DAY = 24 * 60 * 60 * 1000;

/** The owner's market limits, with the defaults for companies made before they existed. */
export function marketLimits(c: Company): { on: boolean; dailyUsd: number; maxUsd: number } {
  return {
    on: c.policy.marketBuy ?? DEFAULT_POLICY.marketBuy,
    dailyUsd: c.policy.marketDailyUsd ?? DEFAULT_POLICY.marketDailyUsd,
    maxUsd: c.policy.marketMaxUsd ?? DEFAULT_POLICY.marketMaxUsd,
  };
}

/** USDC paid or reserved for market buys in the last 24 hours. */
export function marketSpentToday(c: Company, now: number, except?: Task): bigint {
  let s = 0n;
  for (const t of c.tasks) if (t !== except && t.costUsdc && now - t.updatedAt < DAY) s += t.costUsdc;
  return s;
}

/** USDC held for market buys that are paying now and not booked yet. */
export function marketReserved(c: Company, except?: Task): bigint {
  let s = 0n;
  for (const t of c.tasks) if (t !== except && t.costUsdc && t.market && !t.market.paid && (t.status === "ordering" || t.status === "building")) s += t.costUsdc;
  return s;
}

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "about", "your", "their", "them", "they", "you", "our", "who", "what", "when", "where",
  "which", "while", "how", "why", "are", "was", "were", "has", "have", "had", "will", "would", "should", "could", "can", "not", "but", "all", "any",
  "each", "every", "more", "most", "less", "than", "then", "there", "here", "out", "get", "getting", "got", "make", "makes", "making", "use", "using",
  "one", "two", "three", "four", "five", "six", "ten", "first", "new", "best", "top", "very", "just", "also", "only", "own", "other", "some", "such",
  "today", "now", "week", "weekly", "daily", "day", "around", "list", "evidence", "demand", "price", "prices", "point", "points", "pay", "pays", "paid",
  "sell", "sells", "selling", "sold", "product", "products", "report", "reports", "research", "market", "guide", "find", "need", "needs", "want",
  "people", "help", "helps", "doing", "done", "way", "ways", "thing", "things", "everything", "start", "started", "step", "steps", "context",
  "mission", "serve", "serves", "buyer", "buyers", "online", "practical", "sourced", "concrete", "specific", "simple", "via", "per",
]);

const stem = (w: string) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** The key terms of a text: lowercase words of 3+ letters, without filler, plurals folded. */
export function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")) {
    if (w.length < 3 || /^\d+$/.test(w) || STOP.has(w)) continue;
    out.add(stem(w));
  }
  return out;
}

/** What a product says about itself before anyone pays: its name, pitch and free preview. */
export const offerText = (o: MarketOffer) => [o.product.name, o.product.pitch, o.preview?.title ?? "", ...(o.preview?.outline ?? []), o.preview?.opening ?? ""].join(" ");

/** The share of the brief's key terms the product's free preview covers, and which ones. */
export function keywordScore(brief: string, o: MarketOffer): { score: number; shared: string[]; of: number } {
  const want = terms(brief);
  const have = terms(offerText(o));
  const shared = [...want].filter((w) => have.has(w));
  return { score: want.size ? Math.round((shared.length / want.size) * 100) / 100 : 0, shared, of: want.size };
}

export const relevantByKeywords = (k: { score: number; shared: string[]; of: number }) => k.score >= RELEVANT.keywords && k.shared.length >= Math.min(RELEVANT.minShared, k.of);

/** The CEO's model scores how well each product answers the brief, from the free preview only. */
export async function modelScores(llm: LlmClient, model: string, brief: string, offers: MarketOffer[]): Promise<{ scores: { score: number; why: string }[]; costUsd: number } | null> {
  const list = offers.map((o, i) => `[${i}] "${o.product.name}" (${o.product.kind}, by ${o.seller.name}): ${o.product.pitch}${o.preview?.outline.length ? `\n    Outline: ${o.preview.outline.slice(0, 10).join("; ")}` : ""}`).join("\n");
  const res = await llm.chat({
    model,
    temperature: 0,
    maxTokens: 500,
    messages: [
      { role: "system", content: 'You decide whether a product another company already sells can replace market research a company is about to commission. Score each product from 0 to 1: 1 = it answers the same question for the same audience; 0.5 = same topic, but another question or audience; 0 = unrelated. Judge only from the title, pitch and outline given. Answer JSON only: {"scores":[{"i":0,"score":0.0,"why":"one short reason"}]}' },
      { role: "user", content: `Research brief: ${brief}\n\nProducts:\n${list}` },
    ],
  });
  const text = res.message.content ?? "";
  try {
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { scores?: { i?: unknown; score?: unknown; why?: unknown }[] };
    const out = offers.map(() => null as { score: number; why: string } | null);
    for (const s of j.scores ?? []) {
      const i = Number(s.i), v = Number(s.score);
      if (Number.isInteger(i) && i >= 0 && i < out.length && Number.isFinite(v)) out[i] = { score: Math.min(1, Math.max(0, Math.round(v * 100) / 100)), why: String(s.why ?? "").slice(0, 160) };
    }
    // every product scored, or the answer is not used
    if (out.some((x) => x === null)) return null;
    return { scores: out as { score: number; why: string }[], costUsd: res.costUsd };
  } catch {
    return null;
  }
}

/** The rules a purchase must pass whatever its relevance: who sells it, what it costs, what the company may spend. */
export function marketRule(c: Company, o: MarketOffer, x: { swarmUsd: number; maxUsd: number; dailyUsd: number; spentUsdc: bigint; availableUsdc: bigint }): { verdict: MarketVerdict; why: string } | null {
  const price = o.product.priceUsdc;
  if (o.seller.id === c.id) return { verdict: "own", why: "made by this company" };
  if (!c.owner || !o.seller.owner) return { verdict: "same_owner", why: "no owner wallet on record, so it cannot be told apart from your own companies" };
  if (o.seller.owner.toLowerCase() === c.owner.toLowerCase()) return { verdict: "same_owner", why: "same owner wallet: never bought, it would be fake volume" };
  if (Boolean(o.seller.sim) !== Boolean(c.sim)) return { verdict: "demo", why: "a demo company never trades with a live one" };
  if ((c.b2b?.bought ?? []).some((b) => b.productId === o.product.id && b.with.id === o.seller.id)) return { verdict: "owned", why: "already bought" };
  if (fromUsdc(price) > x.maxUsd + 1e-9) return { verdict: "over_max", why: `$${fromUsdc(price).toFixed(2)} is over the $${x.maxUsd.toFixed(2)} limit per market buy` };
  if (fromUsdc(price) >= x.swarmUsd - 1e-9) return { verdict: "pricier", why: `$${fromUsdc(price).toFixed(2)} is not cheaper than the swarm ($${x.swarmUsd.toFixed(2)})` };
  if (fromUsdc(x.spentUsdc + price) > x.dailyUsd + 1e-9) return { verdict: "cap", why: `would take today's market spend to $${fromUsdc(x.spentUsdc + price).toFixed(2)}, over the $${x.dailyUsd.toFixed(2)} a day` };
  if (x.availableUsdc < price) return { verdict: "funds", why: `the company holds $${fromUsdc(x.availableUsdc > 0n ? x.availableUsdc : 0n).toFixed(2)} USDC` };
  return null;
}

export type Scored = { o: MarketOffer; score: number; shared: string[]; of: number; why: string; rule: { verdict: MarketVerdict; why: string } | null };

/** A scored product as the flight recorder shows it. */
export function candidate(s: Scored, verdict: MarketVerdict, why: string): MarketCandidate {
  return {
    sellerId: s.o.seller.id, company: s.o.seller.name, slug: s.o.seller.slug, productId: s.o.product.id, name: s.o.product.name, kind: s.o.product.kind,
    priceUsd: fromUsdc(s.o.product.priceUsdc), score: s.score, verdict, why,
  };
}
