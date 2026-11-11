import { CHANNELS, type Company, fromUsdc } from "@nightshift/core";
import { type PayerClass, payerClass } from "./proof.js";
import type { Metrics } from "./store.js";

/**
 * The public live feed for the front page: what the companies did, newest first, read from their own
 * records and books. GET /api/feed?limit=50. Only what a visitor may already see on a company's public
 * page is in it: no owner's question, no draft, no log line. Companies hidden by moderation, retired
 * demo companies on a live engine and the house company are left out. Sales are the same sales the
 * proof page counts as demand (proof.ts): a payment from a NIGHTSHIFT wallet, the seller's owner, any
 * company owner or another NIGHTSHIFT company is never a sale here, and no buyer's wallet is shown.
 */
export type FeedKind = "founded" | "shift" | "product" | "sale" | "post" | "price";
export interface FeedItem {
  /** Milliseconds since 1970. */
  at: number;
  kind: FeedKind;
  company: { id: string; slug: string; name: string };
  /** One line that follows the company's name (the page shows the name first): "sold \"X\" for $4.00". */
  text: string;
  /** A sale's amount; a product's list price; a price change's new price. */
  amountUsd?: number;
  /** A sale's settlement transaction, and the chain it is on. */
  tx?: string;
  chainId?: number;
  /** Where the line leads: a path on this site, or the post's own address. */
  href?: string;
}
export interface Feed {
  items: FeedItem[];
  stats: {
    /** Companies shown on the site. */
    companies: number;
    /** Everything the companies earned, in USD: the USDC sales below plus what their owners' Gumroad accounts took by card. */
    earned: number;
    /** How many of the companies shown have earned anything: a counted sale, or a real sale on Gumroad. */
    earners: number;
    /** USDC paid by outside buyers (people and agents), and how many such payments. */
    salesUsd: number;
    sales: number;
  };
}

export interface FeedInput {
  /** Every company on the engine: buyers are classified against all of them. */
  all: Company[];
  /** Which of them the public may see. */
  listed: (c: Company) => boolean;
  metrics: (id: string) => Metrics;
  mode: "sim" | "live";
  /** Where sales settle (8453: Base). */
  chainId: number;
  now?: number;
}

/** Work a visitor may read about as a shift of its own (a product, a price and a post have their own lines). */
const SHIFT_KINDS = new Set(["research", "build_site", "improve_site", "improve_listing", "retire_product"]);
const CHANNEL_NAME: Record<string, string> = { bluesky: "Bluesky", telegram: "Telegram", mastodon: "Mastodon", discord: "Discord" };
const money = (n: number) => `$${n.toFixed(2)}`;
const round = (n: number) => Math.round(n * 100) / 100;
const one = (s: string, max: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : t; };

/** Is this recorded payment a sale the public feed counts? Live: an outside wallet with its settlement. Simulation: the simulator's own buyers, marked as such. */
function counted(cls: PayerClass, s: Metrics["sales"][number], mode: "sim" | "live"): boolean {
  if (mode === "sim") return cls === "test" && s.sim;
  return cls === "customer" && Boolean(s.tx && /^0x[0-9a-f]{64}$/i.test(s.tx));
}

export function buildFeed(i: FeedInput, limit = 50): Feed {
  const shown = i.all.filter((c) => i.listed(c) && !c.house);
  const items: FeedItem[] = [];
  let sales = 0, salesUnits = 0n, gumroadCents = 0, earners = 0;
  for (const c of shown) {
    const company = { id: c.id, slug: c.slug, name: c.name };
    const page = `/c/${c.slug}`;
    let took = false;
    items.push({ at: c.createdAt, kind: "founded", company, text: one(`was founded: ${c.mission}`, 220), href: page });
    for (const t of c.tasks) {
      if (t.status !== "done") continue;
      if (t.kind === "reprice") {
        const p = c.products.find((x) => x.id === t.productId);
        const to = /→ \$([\d.]+)/.exec(t.result?.note ?? "")?.[1];
        if (p && to) items.push({ at: t.updatedAt, kind: "price", company, text: one(`changed the price of "${p.name}": ${t.result!.note}`, 220), amountUsd: Number(to), href: `${page}#${p.id}` });
      } else if (SHIFT_KINDS.has(t.kind)) {
        items.push({ at: t.updatedAt, kind: "shift", company, text: one(`shift ${t.cycle}: ${t.title}`, 220), href: `${page}?shift=${t.id}` });
      }
    }
    for (const p of c.products) {
      gumroadCents += p.gumroad && !p.gumroad.sim ? p.gumroad.revenueCents : 0;
      if (i.mode === "live" && p.gumroad && !p.gumroad.sim && p.gumroad.revenueCents > 0) took = true;
      if (p.status !== "live") continue;
      const made = c.tasks.find((t) => t.id === p.taskId && t.status === "done");
      items.push({ at: made?.updatedAt ?? p.createdAt, kind: "product", company, text: one(`put "${p.name}" on sale`, 200), amountUsd: fromUsdc(p.priceUsdc), href: `${page}#${p.id}` });
    }
    for (const s of i.metrics(c.id).sales) {
      const cls = payerClass(s.payer, c, i.all, s.sim || (s.network !== undefined && s.network !== "eip155:8453" && i.mode === "live"));
      if (!counted(cls, s, i.mode)) continue;
      const usd = Number(BigInt(s.usdc)) / 1e6;
      sales += 1;
      took = true;
      salesUnits += BigInt(s.usdc);
      const name = c.products.find((p) => p.id === s.productId)?.name;
      items.push({ at: s.at, kind: "sale", company, text: one(`${i.mode === "sim" ? "[sim] " : ""}sold ${name ? `"${name}"` : "a product"} for ${money(usd)}`, 200), amountUsd: usd, ...(s.tx ? { tx: s.tx, chainId: i.chainId } : {}), href: name ? `${page}#${s.productId}` : page });
    }
    if (took) earners += 1;
    // posts that went out: on the owner's own channels they chose to show, and approved drafts on the project account
    for (const p of c.connections?.posts ?? []) {
      const ch = c.connections!.channels[p.channel];
      if (p.status !== "posted" || p.sim || !ch?.listed || !(CHANNELS as string[]).includes(p.channel)) continue;
      items.push({ at: p.sentAt ?? p.at, kind: "post", company, text: one(`posted on ${CHANNEL_NAME[p.channel] ?? p.channel}: ${p.about}`, 200), ...(p.url && /^https:\/\//.test(p.url) ? { href: p.url } : { href: page }) });
    }
    for (const m of c.marketing) {
      if (m.status !== "posted") continue;
      items.push({ at: m.at, kind: "post", company, text: one(`posted: ${m.text}`, 200), ...(m.url && /^https:\/\//.test(m.url) ? { href: m.url } : { href: page }) });
    }
  }
  const now = i.now ?? Date.now();
  items.sort((a, b) => b.at - a.at);
  const salesUsd = round(Number(salesUnits) / 1e6);
  return {
    items: items.filter((x) => x.at <= now + 60_000).slice(0, Math.min(200, Math.max(1, Math.floor(limit) || 50))),
    stats: { companies: shown.length, earned: round(salesUsd + (i.mode === "live" ? gumroadCents / 100 : 0)), earners, salesUsd, sales },
  };
}

/** The feed, built at most once every `ttlMs`: the front page of every visitor reads the same answer. */
export function cachedFeed(build: (limit: number) => Feed, ttlMs = 15_000, clock: () => number = Date.now) {
  let at = 0, full: Feed | null = null;
  return (limit: number): Feed => {
    if (!full || clock() - at > ttlMs) { full = build(200); at = clock(); }
    return { items: full.items.slice(0, Math.min(200, Math.max(1, Math.floor(limit) || 50))), stats: full.stats };
  };
}
