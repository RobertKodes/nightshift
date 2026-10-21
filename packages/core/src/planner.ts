import type { ChatMessage, LlmClient } from "@nightshift/llm";
import { type Sells, sellsLines } from "./sells.js";
import { memoryLines, repeatOf } from "./memory.js";
import type { Company, PostFact, Product, ProductKind, TaskKind } from "./types.js";
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
  /** A post move: the key of the real event it is about, from the list the CEO was shown. */
  fact?: string;
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
  /** The channels the owner connected that may carry a post now. */
  channels?: string[];
  /** Real events not posted yet on some connected channel, from the company's records and books. */
  postable?: PostFact[];
  /** What sold, at what price, through which channel: the company's own data and the NIGHTSHIFT market's only. */
  sells?: Sells;
}

const KINDS: TaskKind[] = ["research", "build_product", "build_site", "improve_site", "marketing", "reprice", "retire_product", "post"];

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
${recent}
What the company already did, made and sold (its memory: never repeat any of it):
${memoryLines(c).join("\n")}${s.sells ? `
What sells (only the company's own sales and visits, and the NIGHTSHIFT market's own listings):
${sellsLines(s.sells).join("\n")}` : ""}${s.channels?.length ? `
Connected channels (the owner's own accounts): ${s.channels.join(", ")}
Real events you may post about (a post move names one by its key; nothing else may be posted):
${(s.postable ?? []).map((f) => `- [${f.key}] ${f.title}`).join("\n") || "- none right now"}` : ""}`;
}

/** Small web tools the playbook can make, one of each: a company that sells nothing tries a new kind. */
const TOOLS = [
  { name: "Checker", pitch: "paste in your work and see exactly what to fix", does: "checks what the buyer pastes in against clear rules and says exactly what to fix, with an example of the fixed version" },
  { name: "Calculator", pitch: "the numbers that matter, worked out from a few inputs", does: "works out the numbers that matter (cost, time saved, expected return) from a few inputs and explains the result in plain words" },
  { name: "Generator", pitch: "ready-to-use text from a few inputs, in seconds", does: "drafts ready-to-use text the buyer can copy (messages, outlines, descriptions) from a few inputs, in several tones" },
  { name: "Planner", pitch: "your goal turned into a dated, step-by-step plan", does: "turns the buyer's goal and deadline into a step-by-step plan with dates they can tick off" },
  { name: "Finder", pitch: "the tools and resources that matter, filtered for you", does: "searches a curated, sourced list of the tools and resources that matter and filters it by what the buyer needs" },
  { name: "Tracker", pitch: "your progress and the next step, kept in your browser", does: "keeps a simple log in the browser and shows progress, streaks and what to do next" },
] as const;

/** Research the playbook can commission, one of each: inputs for the next products, never products themselves. */
const QUESTIONS: ((c: Company) => { title: string; brief: string })[] = [
  (c) => ({ title: "Find the next thing to sell", brief: `What do ${c.audience} pay for today around "${c.idea}"? List five products with evidence of demand, price points and who sells them.` }),
  (c) => ({ title: "Find where the buyers are", brief: `Where do ${c.audience} discover new tools: name the communities, newsletters, directories and marketplaces with links and audience sizes, and how a new tool gets listed or mentioned in each.` }),
  (c) => ({ title: "Find the gaps competitors leave", brief: `Which tools and services already serve ${c.audience} around "${c.idea}", what they charge, and which complaints their users repeat in public reviews and forums.` }),
  (c) => ({ title: "Find the jobs a small tool can do", brief: `Which small, recurring tasks do ${c.audience} still do by hand or in spreadsheets around "${c.idea}"? Five tasks a simple web tool could do, with evidence of how often they come up.` }),
];

/** Site changes the playbook can order when visits do not turn into sales, one of each. */
const PAGE_FIXES = [
  { title: "Fix the page that is not converting", brief: "Rewrite the hero around the single outcome the buyer gets, add a sample of the product, move the buy button above the fold, add three FAQ answers about what is inside." },
  { title: "Show each product working on the page", brief: "Put a live demo or a real sample output of each product at the top of its section, one sentence on what the buyer gets, and its buy button right next to it." },
  { title: "Answer the questions buyers ask before paying", brief: "Add what each product saves the buyer in time or money, who it is not for, and an FAQ with the three questions a first-time buyer asks before paying." },
];

const POSTS: { angle: string; text: (c: Company, p: Product, url: string) => string }[] = [
  { angle: "the promise", text: (c, p, url) => `${c.mission} — ${p.name}: ${p.pitch} ${url}` },
  { angle: "who it is for", text: (c, p, url) => `For ${c.audience}: ${p.pitch} Try ${p.name}: ${url}` },
  { angle: "what it is", text: (c, p, url) => `${p.name} by ${c.name}. ${p.pitch} ${url}` },
];

/** A web tool to build: the first product, another try at a first product, one built from research, or a new kind. */
function toolMove(c: Company, tool: (typeof TOOLS)[number], as: "first" | "retry" | "new", source?: { title: string; at: string | null }): Decision {
  const name = `${c.name} ${tool.name}`;
  const first = as !== "new";
  return {
    kind: "build_product",
    title: as === "first" ? `Build the first product for ${c.audience}` : as === "retry" ? `Build the first product for ${c.audience}: "${name}"`
      : source ? `Build "${name}" from the research "${source.title}"` : `Try a new kind of product: "${name}"`,
    why: as === "first" ? "Nothing to sell yet. A small web tool the buyer uses the same day is the fastest product the swarm can ship."
      : as === "retry" ? "The first product did not ship. A different kind of tool, instead of the same order again."
      : source ? "The market research is in. Its strongest finding becomes the next product, priced where the research found buyers paying."
      : "What it sells now is not selling. A different kind of product reaches buyers the others did not.",
    brief: `A small web tool for ${c.audience} around "${c.idea}": it ${tool.does}.${source ? ` Build it from the market research the company commissioned ("${source.title}"${source.at ? `, delivered at ${source.at}` : ""}): the need it shows the clearest paid demand for.` : ""} One screen, useful in the first minute.`,
    product: { name, kind: "tool", pitch: `A ${tool.name.toLowerCase()} for ${c.audience}: ${tool.pitch}.`, priceUsd: first ? 9 : 12 },
  };
}

/**
 * The fallback CEO: a playbook that reads the numbers and the company's memory. It runs when no LLM key
 * is set, and whenever the LLM answer is unusable or repeats earlier work, so a company never stalls.
 * It lists the moves that fit now, best first; the shift makes the first one the hard rules allow
 * (memory.ts), so the company moves on instead of asking for the same work again. No sales: put the
 * products in front of buyers and try new kinds of product. Sales: improve what sells and build on it.
 */
export function playbook(c: Company, s: CompanyStats, now = Date.now()): Decision[] {
  const out: Decision[] = [];
  const live = c.products.filter((p) => p.status === "live");
  const building = c.tasks.some((t) => t.status === "building" || t.status === "ordering" || t.status === "awaiting_approval");
  const made = new Set(c.products.map((p) => p.name.toLowerCase()));
  const tools = TOOLS.filter((x) => !made.has(`${c.name} ${x.name}`.toLowerCase()));
  if (!c.products.length) {
    // the first product; if that one keeps failing, a different kind of tool
    tools.forEach((x, i) => out.push(toolMove(c, x, i === 0 ? "first" : "retry")));
  } else if (!c.site && !building) {
    out.push({
      kind: "build_site",
      title: "Put the company on the web",
      why: "There is a product but nowhere to buy it. A landing page turns visits into sales.",
      brief: `A one-page site for ${c.name}: the promise (${c.mission}), who it is for (${c.audience}), the products with prices, a buy button per product, and a short FAQ.`,
    });
  }
  // With the owner's accounts connected, the company tells people about real events instead of drafting.
  const lastPost = [...c.tasks].reverse().find((t) => t.kind === "post")?.createdAt ?? 0;
  const fact = s.postable?.[0];
  if (s.channels?.length && fact && now - lastPost > 20 * 60 * 60 * 1000) {
    out.push({ kind: "post", title: `Post: ${fact.title}`, why: `${fact.title} is a real event the connected channels have not carried yet.`, brief: "", fact: fact.key });
  }
  const lastMarketing = c.marketing.at(-1)?.at ?? 0;
  if (!s.channels?.length && c.site && live.length && now - lastMarketing > 20 * 60 * 60 * 1000) {
    // each post about another product, or in other words: the same post twice is no news
    const drafted = new Set(c.marketing.map((m) => m.text.trim()));
    const told = (p: Product) => c.marketing.filter((m) => m.text.includes(p.name)).length;
    const order = [...live].sort((a, b) => (s.sales7d > 0 ? b.sales - a.sales : 0) || told(a) - told(b));
    const post = order.flatMap((p) => POSTS.map((f) => ({ p, angle: f.angle, text: f.text(c, p, c.site!.url).trim().slice(0, 280) }))).find((x) => !drafted.has(x.text));
    if (post) {
      out.push({
        kind: "marketing",
        title: `Tell people about ${post.p.name}: ${post.angle}`,
        why: s.visits7d < 50 ? "Few visits this week; the product needs eyes before it needs changes." : "Keep the audience warm with something useful.",
        brief: `A short post for ${c.audience} about ${post.p.name}.`,
        post: post.text,
      });
    }
  }
  const best = [...live].sort((a, b) => b.sales - a.sales)[0];
  const selling = s.sales7d > 0 && best !== undefined && best.sales > 0;
  const research = [...c.tasks].reverse().find((t) => t.kind === "research" && t.status === "done");
  const newest = Math.max(0, ...c.products.map((p) => p.createdAt));
  // research the company paid for is acted on: a new tool built from its strongest finding
  const fromResearch = research && research.updatedAt > newest && c.products.length && live.length < 6 && !building && tools[0]
    ? toolMove(c, tools[0], "new", { title: research.title, at: Object.values(research.result?.files ?? {})[0] ?? research.result?.note ?? null }) : null;
  const asks: Decision[] = QUESTIONS.map((q) => q(c)).map((q) => ({ kind: "research", title: q.title, why: "Look for demand the company is not serving yet, as input for its next product.", brief: q.brief }));
  if (selling) {
    // it sells: build on the seller first, then the page and the price around it
    if (best.sales >= 2 && live.length < 6 && !building) {
      const kind = best.kind === "report" ? "tool" : best.kind;
      for (const [suffix, pitch] of [["Advanced", "The next step, ready to use."], ["Companion", "Everything that goes with it, ready to use."]] as const) {
        out.push({
          kind: "build_product",
          title: `Sell more to the buyers of ${best.name}: "${best.name} — ${suffix}"`,
          why: `${best.name} sold ${best.sales} times. The same buyers will pay for the next step.`,
          brief: `A ${suffix.toLowerCase()} follow-up to "${best.name}" for ${c.audience}: what its buyers need next, ${kind === "tool" ? "as a small web tool" : "ready to copy and use"}.`,
          product: { name: `${best.name} — ${suffix}`, kind, pitch, priceUsd: Math.min(499, Math.max(15, fromUsdc(best.priceUsdc) * 2)) },
        });
      }
    }
    if (c.site && !building) {
      out.push({
        kind: "improve_site",
        title: `Lead the page with ${best.name}`,
        why: `${best.name} is what sells (${best.sales} sales). The page should open with it.`,
        brief: `Put "${best.name}" first on the page: the outcome its buyers get in one line, a sample of it, and its buy button above the fold. Keep the other products below it.`,
      });
    }
    if (!best.priceByOwner && best.sales >= 5 && s.sales7d >= 3) {
      out.push({ kind: "reprice", title: `Raise the price of ${best.name} to $${Math.min(499, Math.round(fromUsdc(best.priceUsdc) * 1.25))}`, why: `${s.sales7d} sales this week: it can carry a higher price.`, brief: "", productId: best.id, priceUsd: Math.min(499, Math.round(fromUsdc(best.priceUsdc) * 1.25)) });
    }
    if (fromResearch) out.push(fromResearch);
    out.push(...asks);
  } else {
    // nothing sells: fix the page people leave, act on research, then new kinds of product
    if (c.site && s.visits7d >= 40 && !building) for (const f of PAGE_FIXES) out.push({ kind: "improve_site", title: f.title, why: `${s.visits7d} visits and no sales: the page is losing people before the buy button.`, brief: f.brief });
    if (fromResearch) out.push(fromResearch);
    const stale = live.find((p) => !p.priceByOwner && p.sales === 0 && now - p.createdAt > 5 * 24 * 60 * 60 * 1000 && fromUsdc(p.priceUsdc) > 3);
    if (stale) out.push({ kind: "reprice", title: `Cut the price of ${stale.name} to $${Math.max(3, Math.round(fromUsdc(stale.priceUsdc) * 0.6))}`, why: "Five days without a sale.", brief: "", productId: stale.id, priceUsd: Math.max(3, Math.round(fromUsdc(stale.priceUsdc) * 0.6)) });
    // a full shelf of things nobody buys: the oldest goes, to make room for a new kind
    const dead = live.filter((p) => p.sales === 0 && (p.b2bSales ?? 0) === 0 && now - p.createdAt > 10 * 24 * 60 * 60 * 1000).sort((a, b) => a.createdAt - b.createdAt)[0];
    if (live.length >= 5 && dead && tools.length) out.push({ kind: "retire_product", title: `Stop selling ${dead.name}`, why: "Ten days without a sale, on a full shelf: it makes room for a new kind of product.", brief: "", productId: dead.id });
    out.push(...asks);
    if (c.products.length && live.length < 6 && !building) for (const x of tools) out.push(toolMove(c, x, "new"));
  }
  // under the owner's direction the same question or page change is new work: its title says which direction
  if (c.direction) for (const m of out) if (m.kind === "research" || m.kind === "improve_site") m.title = `${m.title}, for "${c.direction.length > 50 ? `${c.direction.slice(0, 49)}…` : c.direction}"`;
  return out.filter((m) => !ruledOut(c.direction, m.kind));
}

// "no more X", "stop X", "don't X" ... within a few words, in one sentence of the direction
const NO = String.raw`\b(?:no|stop|without|skip|pause|don'?t|do not|never)\b[^.;!]{0,24}`;
const ban = (what: string) => new RegExp(`${NO}\\b(?:${what})\\b`, "i");
const BANS: [RegExp, TaskKind[]][] = [
  [ban("research"), ["research"]],
  // "never build a report" is about reports, not about building
  [ban("(?:build|building|making)(?! (?:a |any |more )?reports?\\b)|new products?|products?"), ["build_product", "build_site", "improve_site"]],
  [ban("(?:site|website|page) (?:changes?|edits?|work)"), ["improve_site"]],
  [ban("posts?|posting|marketing"), ["marketing", "post"]],
  [ban("price|prices|pricing|discounts?|repricing"), ["reprice"]],
];

/** The owner's direction, read by the playbook too: "no more research", "no more building now" and the like rule a kind of move out. */
export function ruledOut(direction: string | undefined, kind: TaskKind): boolean {
  return Boolean(direction) && BANS.some(([re, kinds]) => kinds.includes(kind) && re.test(direction!));
}

/** The playbook's move for this shift: the first one the hard rules allow, or its first idea when none is new. */
export function heuristicDecision(c: Company, s: CompanyStats, now = Date.now()): Decision {
  const moves = playbook(c, s, now);
  return moves.find((m) => !repeatOf(c, m, null, now)) ?? moves[0]!;
}

const SYSTEM = `You are the CEO of a one-person online company that runs itself. Each shift you choose exactly ONE next move that most increases revenue within budget.
Moves:
- research: commission market research from the IMD swarm (costs one IMD order)
- build_product: commission a product buyers use from the IMD swarm, then sell it (costs one IMD order). product.kind is "tool" (a small hosted web tool: a checker, calculator, generator, planner, finder), "template" or "dataset"; never a report: research is an input, not a product
- build_site: commission the landing page (costs one IMD order; only if there is none)
- improve_site: commission a change to the existing page (costs one IMD order)
- marketing: write one post for the audience (free)
- reprice: change a product's price (free; needs productId and priceUsd)
- retire_product: stop selling a product (free; needs productId)
- post: tell people about one real event on the owner's connected channels (free; only when channels are listed; needs fact, one key from the list; post is an optional short line of your own with no number, link, @mention or hashtag that the event does not carry)
Rules: never order a product, research, site or site change the company already has or already ordered (see its memory), and never work that failed twice: choose a different move instead; with no sales, put the products in front of buyers and try a different kind of product; with sales, improve what sells and make products related to it; never build a site before there is a product; never start paid work while paid work is still building unless it clearly pays back; be specific about who buys and why; when the owner gives a direction, follow it unless it breaks these rules.
Answer with JSON only: {"kind": ..., "title": ..., "why": ..., "brief": ..., "product"?: {"name","kind","pitch","priceUsd"}, "productId"?, "priceUsd"?, "post"?, "fact"?}`;

export async function llmDecision(llm: LlmClient, model: string, c: Company, s: CompanyStats): Promise<{ decision: Decision; costUsd: number; servedModel: string } | null> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: summary(c, s) },
  ];
  const res = await llm.chat({ model, messages, temperature: 0.4, maxTokens: 1200 });
  const text = res.message.content ?? "";
  try {
    const d = moveIn(text);
    if (!KINDS.includes(d.kind) || !d.title || !d.why) return null;
    if (d.kind === "build_product" && !d.product) return null;
    if ((d.kind === "reprice" || d.kind === "retire_product") && !c.products.some((p) => p.id === d.productId)) return null;
    if (d.kind === "build_site" && c.site) return null;
    // a post is about one of the real events listed, on a channel that is connected: anything else is no decision
    if (d.kind === "post" && (!s.channels?.length || !s.postable?.some((f) => f.key === d.fact))) return null;
    if ((d.kind === "build_site" || d.kind === "improve_site") && c.products.length === 0) return null;
    // a reprice is held to the same bounds as a new product's price; a number that is not one is no decision
    if (d.kind === "reprice") {
      const v = Number(d.priceUsd);
      if (!Number.isFinite(v)) return null;
      d.priceUsd = Math.min(499, Math.max(1, v));
    }
    if (d.product) {
      d.product.priceUsd = Math.min(499, Math.max(1, Number(d.product.priceUsd) || 9));
      // the owner's rule: products are things buyers use, so a report the model asks for is built as a tool
      if (!["tool", "template", "dataset"].includes(d.product.kind)) d.product.kind = "tool";
    }
    return { decision: { ...d, brief: d.brief ?? "" }, costUsd: res.costUsd, servedModel: res.servedModel };
  } catch {
    return null;
  }
}

/**
 * The move in the model's answer: the whole answer as JSON, or else the last balanced {...} in it that parses
 * (a model that thinks out loud, or wraps the JSON in prose, still gives a usable move).
 */
function moveIn(text: string): Decision {
  try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Decision; } catch { /* look for the block */ }
  for (let end = text.lastIndexOf("}"); end > 0; end = text.lastIndexOf("}", end - 1)) {
    for (let depth = 0, i = end; i >= 0; i--) {
      if (text[i] === "}") depth++;
      else if (text[i] === "{" && --depth === 0) {
        try { const d = JSON.parse(text.slice(i, end + 1)) as Decision; if (d && typeof d === "object" && "kind" in d) return d; } catch { /* an inner or broken block */ }
        break;
      }
    }
  }
  throw new Error("no move in the answer");
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
