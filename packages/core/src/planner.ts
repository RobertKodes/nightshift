import type { ChatMessage, LlmClient } from "@nightshift/llm";
import type { Company, ProductKind, TaskKind } from "./types.js";
import { fromUsdc } from "./types.js";

/** One move the CEO makes in a shift. */
export interface Decision {
  kind: TaskKind;
  title: string;
  why: string;
  /** What the swarm should build or change, in plain words. */
  brief: string;
  product?: { name: string; kind: ProductKind; pitch: string; priceUsd: number };
  productId?: string;
  priceUsd?: number;
  post?: string;
}

export interface Founding {
  name: string;
  mission: string;
  audience: string;
}

export interface CompanyStats {
  visits7d: number;
  sales7d: number;
  revenue7dUsd: number;
  imdUsd: number;
}

const KINDS: TaskKind[] = ["research", "build_product", "build_site", "improve_site", "marketing", "reprice", "retire_product"];

function summary(c: Company, s: CompanyStats): string {
  const products = c.products.map((p) => `- [${p.id}] ${p.name} (${p.kind}, $${fromUsdc(p.priceUsdc).toFixed(2)}${p.priceByOwner ? " set by the owner, never reprice it" : ""}, ${p.status}, ${p.sales} sales, $${fromUsdc(p.revenueUsdc).toFixed(2)})`).join("\n") || "- none yet";
  const recent = c.tasks.slice(-8).map((t) => `- shift ${t.cycle}: ${t.kind} "${t.title}" → ${t.status}${t.error ? ` (${t.error})` : ""}`).join("\n") || "- nothing yet";
  return `Company: ${c.name}
Idea: ${c.idea}
Mission: ${c.mission}
Audience: ${c.audience}${c.direction ? `\nThe owner's direction (follow it): ${c.direction}` : ""}
Shift: ${c.cycle}
Site: ${c.site ? c.site.url : "none yet"}
Products:
${products}
Last 7 days: ${s.visits7d} visits, ${s.sales7d} sales, $${s.revenue7dUsd.toFixed(2)} revenue
Recent work:
${recent}`;
}

/**
 * The fallback CEO: a fixed playbook that still reads the numbers. It runs when no LLM key is set,
 * and whenever the LLM answer is unusable, so a company never stalls.
 */
export function heuristicDecision(c: Company, s: CompanyStats): Decision {
  const live = c.products.filter((p) => p.status === "live");
  const building = c.tasks.some((t) => t.status === "building" || t.status === "ordering" || t.status === "awaiting_approval");
  const firstProduct = c.products.length === 0;
  if (firstProduct) {
    return {
      kind: "build_product",
      title: `Build the first product for ${c.audience}`,
      why: "Nothing to sell yet. A paid report is the fastest thing the swarm can ship and sell.",
      brief: `A practical, sourced report for ${c.audience}: ${c.idea}. Concrete steps, numbers and examples someone can act on the same day.`,
      product: { name: `${c.name} — The Playbook`, kind: "report", pitch: `Everything ${c.audience} need to get started, in one report.`, priceUsd: 9 },
    };
  }
  if (!c.site && !building) {
    return {
      kind: "build_site",
      title: "Put the company on the web",
      why: "There is a product but nowhere to buy it. A landing page turns visits into sales.",
      brief: `A one-page site for ${c.name}: the promise (${c.mission}), who it is for (${c.audience}), the products with prices, a buy button per product, and a short FAQ.`,
    };
  }
  const lastMarketing = c.marketing.at(-1)?.at ?? 0;
  if (c.site && Date.now() - lastMarketing > 20 * 60 * 60 * 1000) {
    return {
      kind: "marketing",
      title: "Tell people it exists",
      why: s.visits7d < 50 ? "Few visits this week; the product needs eyes before it needs changes." : "Keep the audience warm with something useful.",
      brief: `A short post for ${c.audience} about ${live[0]?.name ?? c.name}.`,
      post: `${c.mission} — ${live[0] ? `${live[0].name}: ${live[0].pitch}` : ""} ${c.site.url}`.trim(),
    };
  }
  if (c.site && s.visits7d >= 40 && s.sales7d === 0 && !building) {
    return {
      kind: "improve_site",
      title: "Fix the page that is not converting",
      why: `${s.visits7d} visits and no sales: the page is losing people before the buy button.`,
      brief: "Rewrite the hero around the single outcome the buyer gets, add a sample of the product, move the buy button above the fold, add three FAQ answers about what is inside.",
    };
  }
  const best = [...live].sort((a, b) => b.sales - a.sales)[0];
  if (best && best.sales >= 3 && live.length < 4 && !building) {
    return {
      kind: "build_product",
      title: `Sell more to the buyers of ${best.name}`,
      why: `${best.name} sold ${best.sales} times. The same buyers will pay for the next step.`,
      brief: `A follow-up to "${best.name}" for ${c.audience}: the advanced version, with templates they can copy.`,
      product: { name: `${best.name} — Advanced`, kind: "template", pitch: "The next step, with templates you can copy.", priceUsd: Math.min(499, Math.max(15, fromUsdc(best.priceUsdc) * 2)) },
    };
  }
  // Research the company paid for is acted on: its strongest finding becomes the next product,
  // instead of the same research being asked for again (which the saver refuses, and the company rests).
  const research = [...c.tasks].reverse().find((t) => t.kind === "research" && t.status === "done");
  const newest = Math.max(0, ...c.products.map((p) => p.createdAt));
  if (research && research.updatedAt > newest && live.length < 4 && !building) {
    const source = Object.values(research.result?.files ?? {})[0] ?? research.result?.note ?? null;
    return {
      kind: "build_product",
      title: `Build what the research found for ${c.audience}`,
      why: "The market research is in. Its strongest finding becomes the next product, priced where the research found buyers paying.",
      brief: `Using the market research the company commissioned ("${research.title}"${source ? `, delivered at ${source}` : ""}), build the product it shows the clearest paid demand for among ${c.audience}, around: ${c.idea}. Make it complementary to "${live[0]?.name ?? c.name}", not a repeat. Concrete, sourced, usable the same day.`,
      product: { name: `${c.name} — Field Kit`, kind: "template", pitch: `The tools ${c.audience} asked for, ready to copy and use.`, priceUsd: Math.min(49, Math.max(12, fromUsdc(live[0]?.priceUsdc ?? 9_000_000n) + 6)) },
    };
  }
  const stale = live.find((p) => !p.priceByOwner && p.sales === 0 && Date.now() - p.createdAt > 5 * 24 * 60 * 60 * 1000);
  if (stale) {
    return { kind: "reprice", title: `Cut the price of ${stale.name}`, why: "Five days without a sale.", brief: "", productId: stale.id, priceUsd: Math.max(3, Math.round(fromUsdc(stale.priceUsdc) * 0.6)) };
  }
  return {
    kind: "research",
    title: "Find the next thing to sell",
    why: "The line is stable. Look for demand the company is not serving yet.",
    brief: `What do ${c.audience} pay for today around "${c.idea}"? List five products with evidence of demand, price points and who sells them.`,
  };
}

const SYSTEM = `You are the CEO of a one-person online company that runs itself. Each shift you choose exactly ONE next move that most increases revenue within budget.
Moves:
- research: commission market research from the IMD swarm (costs one IMD order)
- build_product: commission a sellable digital product (report, template or dataset, delivered as a file) from the IMD swarm, then sell it (costs one IMD order)
- build_site: commission the landing page (costs one IMD order; only if there is none)
- improve_site: commission a change to the existing page (costs one IMD order)
- marketing: write one post for the audience (free)
- reprice: change a product's price (free; needs productId and priceUsd)
- retire_product: stop selling a product (free; needs productId)
Rules: never build a site before there is a product; never start paid work while paid work is still building unless it clearly pays back; be specific about who buys and why; when the owner gives a direction, follow it unless it breaks these rules.
Answer with JSON only: {"kind": ..., "title": ..., "why": ..., "brief": ..., "product"?: {"name","kind","pitch","priceUsd"}, "productId"?, "priceUsd"?, "post"?}`;

export async function llmDecision(llm: LlmClient, model: string, c: Company, s: CompanyStats): Promise<{ decision: Decision; costUsd: number; servedModel: string } | null> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: summary(c, s) },
  ];
  const res = await llm.chat({ model, messages, temperature: 0.4, maxTokens: 700 });
  const text = res.message.content ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const d = JSON.parse(json) as Decision;
    if (!KINDS.includes(d.kind) || !d.title || !d.why) return null;
    if (d.kind === "build_product" && !d.product) return null;
    if ((d.kind === "reprice" || d.kind === "retire_product") && !c.products.some((p) => p.id === d.productId)) return null;
    if (d.kind === "build_site" && c.site) return null;
    if ((d.kind === "build_site" || d.kind === "improve_site") && c.products.length === 0) return null;
    // a reprice is held to the same bounds as a new product's price; a number that is not one is no decision
    if (d.kind === "reprice") {
      const v = Number(d.priceUsd);
      if (!Number.isFinite(v)) return null;
      d.priceUsd = Math.min(499, Math.max(1, v));
    }
    if (d.product) {
      d.product.priceUsd = Math.min(499, Math.max(1, Number(d.product.priceUsd) || 9));
      if (!["report", "template", "dataset"].includes(d.product.kind)) d.product.kind = "template";
    }
    return { decision: { ...d, brief: d.brief ?? "" }, costUsd: res.costUsd, servedModel: res.servedModel };
  } catch {
    return null;
  }
}

/** Day one: turn a raw idea into a name, a mission and an audience. */
export async function found(idea: string, llm: LlmClient | null, model: string): Promise<Founding> {
  if (llm) {
    try {
      const res = await llm.chat({
        model,
        temperature: 0.7,
        maxTokens: 300,
        messages: [
          { role: "system", content: 'You found online companies. From the idea, answer JSON only: {"name": "1-2 word brandable name", "mission": "one sentence promise to the buyer", "audience": "who pays, specific"}' },
          { role: "user", content: idea },
        ],
      });
      const t = res.message.content ?? "";
      const f = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as Founding;
      if (f.name && f.mission && f.audience) return f;
    } catch { /* fall through to the plain founding */ }
  }
  const STOP = new Set(["with", "that", "this", "from", "your", "their", "have", "will", "about", "into", "they", "them", "what", "when", "where", "which", "while", "weekly", "daily", "people", "help", "helps", "make", "makes", "online"]);
  const words = idea.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w.toLowerCase()));
  const name = (words.slice(0, 2).map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join("") || "Nightco").slice(0, 18);
  const forWhom = /\bfor ([^,.;]+?)(?: who | that | to |[,.;]|$)/i.exec(idea)?.[1]?.trim();
  const sentence = idea.trim().replace(/\s+/g, " ");
  return {
    name,
    mission: `${sentence[0]!.toUpperCase()}${sentence.slice(1).replace(/[.!]?$/, ".")}`,
    audience: forWhom && forWhom.length < 60 ? forWhom : "people who need this solved today",
  };
}
