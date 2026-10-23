import { randomUUID } from "node:crypto";
import { type ChatAction, type ChatLine, type Company, type CompanyStats, KNOW_HOW, type MarketOffer, companyBrief, fromUsdc } from "@nightshift/core";
import type { ChatMessage, LlmClient } from "@nightshift/llm";

/**
 * The owner's chat with the CEO. It runs on the free model, knows only its own company (the same
 * brief the shift reads, plus the money, the channels and what other companies sell) and coaches
 * the owner toward sales: what to post, where, what to sell next, what only a human can do. Under
 * each answer it offers buttons; nothing happens until the owner presses one, and the engine then
 * does it with the fields stored here, held to the same rules as work ordered by hand.
 */
export interface ChatFacts {
  stats: CompanyStats;
  /** Products of other companies this one may buy, as the market shows them. */
  offers: MarketOffer[];
  usdcUsd: number;
  swarmUsd: number;
  pageUrl: string;
  /** Connected accounts: channel kinds, and "gumroad". */
  connected: string[];
  /** The strong model's limit left today, in USD; null: the CEO thinks with the free model. */
  brainLeftUsd: number | null;
}

export const POST_PLACES = ["x", "bluesky", "telegram", "reddit", "pinterest", "tiktok", "instagram", "linkedin", "facebook", "threads", "mastodon", "discord", "youtube"] as const;
export const CONNECTABLE = ["gumroad", "bluesky", "telegram", "mastodon", "discord"] as const;
const PLACE_ALIAS: Record<string, string> = { twitter: "x", "x.com": "x", ig: "instagram", yt: "youtube", shorts: "youtube", reels: "instagram", fb: "facebook" };
const KEEP = 80;
const HISTORY = 12;

const system = (c: Company) => `You are the CEO of ${c.name}, an online company an AI runs on NIGHTSHIFT, chatting with its owner, a human. You know only this company and talk only about it: never about other NIGHTSHIFT companies, except as sellers in the market list you are given.
Your job here is to get the company its sales. Tell the owner exactly what to do next: what to post, where and when; what to sell next and at what price; what to fix; what to order from the IMD swarm; what to buy from other companies; and what only a human can do (open an account, record a video, answer in a community).
How you answer:
- Short and concrete: under 120 words, plain words, steps the owner can do today. Answer in the owner's language.
- Use only the facts you are given. Never invent results, client stories, testimonials, reviews, page counts, discounts, giveaways, sales or numbers: a post that claims something untrue hurts the company. When you do not know, say so.
- A post speaks as the company, never as a person who used the product: no "it used to take me an hour", no "I tried", no before-and-after stories.
- Never ask for a password, private key or seed phrase. No investment or financial advice, no promises of income.
- Every post you suggest goes in its own POST button (at most 2 per answer), ready to paste: no placeholders, only links from the facts. The words above the buttons say why, where and when, not the post again.
- Only these accounts can be connected here: ${CONNECTABLE.join(", ")}. For any other place (Pinterest, TikTok, a forum), give a TODO.
After the answer, add up to 4 buttons, each starting on its own line, exactly in these forms, and only ones that fit what you said (a POST may run over several lines and ends with "]"):
[ORDER research | what the swarm should research, 20-300 characters]
[ORDER product | name | price in USD | tool, template or dataset | one-line pitch | what goes inside, 20-600 characters]
[ORDER site]
[ORDER site change | what to change, 20-300 characters]
[TODO | one thing only the owner can do]
[POST place | the post, ready to paste]   place: ${POST_PLACES.join(", ")}
[CONNECT account | why]   account: ${CONNECTABLE.join(", ")}
[BUY M1 | why the company needs it]   only products from the market list, by their code`;

/** The facts the CEO answers from: its company's brief, money, accounts, the market, and the know-how. */
export function chatFacts(c: Company, f: ChatFacts): string {
  const open = (c.chat ?? []).flatMap((l) => l.actions ?? []).filter((a) => a.type === "todo" && a.state !== "done").map((a) => `- ${(a as { text: string }).text}`);
  const market = f.offers.slice(0, 8).map((o, i) => `- M${i + 1}: "${o.product.name}" (${o.product.kind}, $${fromUsdc(o.product.priceUsdc).toFixed(2)}) by ${o.seller.name}: ${o.product.pitch.slice(0, 140)}`);
  return `${companyBrief(c, f.stats)}
Public page: ${f.pageUrl}
Money: $${f.usdcUsd.toFixed(2)} USDC earned and spendable; one IMD swarm order costs about $${f.swarmUsd.toFixed(2)}, paid in IMD from the company wallet.
CEO brain: ${f.brainLeftUsd === null ? "the free model (the strong model needs USDC in the company and an AI limit above $0)" : `the strong model, paid by the company itself, $${f.brainLeftUsd.toFixed(2)} of today's AI limit left`}.
Connected accounts: ${f.connected.length ? f.connected.join(", ") : "none yet"}${c.products.some((p) => p.gumroad?.state === "published") ? "; some products are on Gumroad" : ""}.
Open to-dos for the owner:
${open.join("\n") || "- none"}
Market (products other companies sell that this one may buy):
${market.join("\n") || "- nothing relevant on sale"}

${KNOW_HOW}`;
}

/** The answer without its button lines, and the buttons that pass the rules (at most 4). */
export function parseAnswer(raw: string, c: Company, offers: MarketOffer[]): { text: string; actions: ChatAction[] } {
  const actions: ChatAction[] = [];
  const keep: string[] = [];
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/\r/g, "");
  const lines = cleaned.split("\n");
  const closed = /\]\s*\**\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:[-*•]\s*)?\**\s*\[\s*(ORDER|TODO|POST|CONNECT|BUY)\b(.*)$/i.exec(lines[i]!);
    if (!m) { keep.push(lines[i]!); continue; }
    // a button runs to the first line that ends with "]" (a post may take several lines)
    let body = m[2]!, j = i;
    while (!closed.test(body) && j + 1 < lines.length && j < i + 25) body += `\n${lines[++j]}`;
    // cut off at the end of the answer (the model ran out of room): dropped, not shown half-written
    if (!closed.test(body) && j + 1 >= lines.length) break;
    if (!closed.test(body)) { keep.push(lines[i]!); continue; }
    i = j;
    const a = action(m[1]!.toUpperCase(), body.replace(closed, ""), c, offers);
    if (a && actions.length < 4 && !actions.some((x) => JSON.stringify({ ...x, id: "" }) === JSON.stringify({ ...a, id: "" }))) actions.push(a);
  }
  const text = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: text.slice(0, 2400), actions };
}

function action(kind: string, rest: string, c: Company, offers: MarketOffer[]): ChatAction | null {
  const [head = "", ...parts] = rest.split("|").map((x) => x.trim());
  const id = randomUUID().slice(0, 8);
  // models sometimes write line breaks as the two characters "\n"
  const tail = parts.join(" | ").replace(/\\n/g, "\n").trim();
  const ok = (s: string, lo: number, hi: number) => s.length >= lo && s.length <= hi;
  if (kind === "TODO") return ok(tail, 4, 300) ? { id, type: "todo", text: tail } : null;
  if (kind === "POST") {
    const where = PLACE_ALIAS[head.toLowerCase()] ?? head.toLowerCase();
    return (POST_PLACES as readonly string[]).includes(where) && ok(tail, 4, 2000) ? { id, type: "post", where, text: tail } : null;
  }
  if (kind === "CONNECT") {
    const to = head.toLowerCase();
    if (!(CONNECTABLE as readonly string[]).includes(to)) return null;
    if (to === "gumroad" ? c.connections?.gumroad : c.connections?.channels[to as "bluesky"]) return null;
    return { id, type: "connect", to, why: tail.slice(0, 200) };
  }
  if (kind === "BUY") {
    const o = offers[Number(/^M(\d+)$/i.exec(head)?.[1] ?? 0) - 1];
    if (!o || !/^M\d+$/i.test(head)) return null;
    return { id, type: "buy", sellerId: o.seller.id, seller: o.seller.name, productId: o.product.id, name: o.product.name, priceUsd: fromUsdc(o.product.priceUsdc), why: tail.slice(0, 200) };
  }
  // ORDER
  const what = head.toLowerCase().replace(/\s+/g, " ");
  if (what === "research") return ok(tail, 20, 1500) ? { id, type: "order", kind: "research", title: `Research: ${tail.slice(0, 70)}${tail.length > 70 ? "…" : ""}`, brief: tail } : null;
  if (what === "site") return !c.site && c.products.some((p) => p.status === "live") ? { id, type: "order", kind: "build_site", title: "Put the company on the web", brief: "" } : null;
  if (what === "site change") return c.site && ok(tail, 20, 1500) ? { id, type: "order", kind: "improve_site", title: `Change the site: ${tail.slice(0, 60)}${tail.length > 60 ? "…" : ""}`, brief: tail } : null;
  if (what === "product") {
    const [name = "", price = "", pk = "", pitch = "", ...inside] = parts;
    const priceUsd = Number(price.replace(/[$\s]/g, ""));
    const brief = inside.join(" | ").trim();
    // "Notion template", "a dataset (CSV)": the kind named anywhere in it
    const productKind = (["template", "dataset", "tool"] as const).find((k) => pk.toLowerCase().includes(k)) ?? (/\bdata\b|csv|sheet/i.test(pk) ? "dataset" : "tool");
    if (!ok(name, 3, 80) || !(priceUsd >= 1 && priceUsd <= 499) || !ok(pitch, 8, 240) || !ok(brief, 20, 1500)) return null;
    return { id, type: "order", kind: "build_product", title: `Build "${name}"`, brief, name, pitch, priceUsd: Math.round(priceUsd * 100) / 100, productKind };
  }
  return null;
}

/** One answer from the CEO to the owner's message: the free model, the company's facts, the last few lines of the chat. */
export async function answerOwner(llm: Pick<LlmClient, "chat">, model: string, c: Company, text: string, facts: ChatFacts, now = Date.now()): Promise<ChatLine> {
  const history: ChatMessage[] = (c.chat ?? []).slice(-HISTORY).map((l) => ({ role: l.from === "owner" ? "user" : "assistant", content: l.from === "owner" ? l.text : `${l.text}${(l.actions ?? []).map((a) => `\n(button offered: ${a.type}${a.state ? `, ${a.state}` : ""})`).join("")}` }));
  const messages: ChatMessage[] = [
    { role: "system", content: system(c) },
    { role: "system", content: `Facts about ${c.name} right now:\n${chatFacts(c, facts)}` },
    ...history,
    { role: "user", content: text },
  ];
  const r = await llm.chat({ model, messages, temperature: 0.5, maxTokens: 1600 });
  const { text: answer, actions } = parseAnswer(r.message.content ?? "", c, facts.offers);
  if (!answer && !actions.length) throw new Error("The CEO had nothing useful to say. Ask again in other words.");
  return { id: randomUUID(), at: now, from: "ceo", text: answer || "Here is what I would do:", ...(actions.length ? { actions } : {}), model: r.servedModel };
}

/** Adds lines to the chat, keeping the newest. */
export function remember(c: Company, ...lines: ChatLine[]): void {
  const chat = (c.chat ??= []);
  chat.push(...lines);
  if (chat.length > KEEP) chat.splice(0, chat.length - KEEP);
}

/** Owner messages in the last 24 hours: the chat is free to run, but not unlimited. */
export const asksToday = (c: Company, now = Date.now()) => (c.chat ?? []).filter((l) => l.from === "owner" && now - l.at < 86_400_000).length;
