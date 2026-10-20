import type { Company, Product } from "@nightshift/core";
import { type Offer, requirement } from "@nightshift/x402";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { config } from "./config.js";

/**
 * The market as AI agents use it. Researched 2026-10-20: x402 discovery (CDP Bazaar, agentic.market)
 * reads a route's description, input/output schema and a realistic output example; agents also need
 * to judge a product before paying. So every product gets a free preview (outline and opening, never
 * the whole file), a catalog entry in the discovery shape with its exact payment terms, and 402
 * challenges that carry the same metadata. The CDP Bazaar lists only resources settled through the
 * CDP facilitator: with a CDP key, payments settle there (checkout.ts) and the first one lists the
 * product; the catalog here lists everything either way.
 */
export type Preview = { title: string; outline: string[]; opening: string; words: number; sections: number; format: "text/markdown" };

/** What a buyer may see before paying: the headings and the first lines, at most 10% of the text and 700 characters. */
export function previewOf(text: string): Preview {
  const lines = text.split(/\r?\n/);
  const heads = lines.filter((l) => /^#{1,3}\s+\S/.test(l)).map((l) => l.replace(/^#+\s+/, "").replace(/[*_`]/g, "").trim());
  const title = heads[0] ?? (lines.find((l) => l.trim()) ?? "").slice(0, 120);
  const words = text.split(/\s+/).filter(Boolean).length;
  // plain prose: no heading marks, rules, quote marks, list bullets, emphasis or link syntax
  const body = lines.filter((l) => l.trim() && !/^#{1,6}\s/.test(l) && !/^[-*_]{3,}\s*$/.test(l))
    .map((l) => l.replace(/^\s*(?:>\s*)+/, "").replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]+/g, ""))
    .join(" ").replace(/\s+/g, " ").trim();
  const cap = Math.min(700, Math.floor(text.length * 0.1));
  let opening = body.slice(0, cap);
  if (body.length > cap) opening = `${opening.replace(/\s+\S*$/, "")}…`;
  return { title, outline: heads.slice(1, 13), opening, words, sections: heads.length, format: "text/markdown" };
}

/** A path segment that is only a UUID, an address or a hash: the Bazaar folds every such URL into one entry. */
const BARE_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|0x[0-9a-f]{40}|0x[0-9a-f]{64})$/i;
/** The product's buy URL, one Bazaar entry per product: a bare UUID id gets a prefix (/buy/<company>/p-<uuid>). */
export const buyUrl = (c: Company, p: Product) => `${config.publicUrl}/buy/${c.slug}/${BARE_ID.test(p.id) ? `p-${p.id}` : p.id}`;
/** The product id in a buy path, with or without that prefix. */
export const productIdOf = (seg: string) => (seg.startsWith("p-") && BARE_ID.test(seg.slice(2)) ? seg.slice(2) : seg);

/** The CDP facilitator refuses a description over 500 characters. */
const MAX_DESC = 480;
export function describe(c: Company, p: Product, pv: Preview | null): string {
  const d = `${p.name}: ${p.pitch}${pv ? ` A ${pv.words.toLocaleString("en-US")}-word ${p.kind} (markdown, ${pv.sections} sections)` : ""} by ${c.name}, an AI company on NIGHTSHIFT. Free preview: ${config.publicUrl}/api/market/${c.slug}/${p.id}`;
  return d.length > MAX_DESC ? `${d.slice(0, MAX_DESC - 1)}…` : d;
}

const EXAMPLE_TX = "0x5f2c9d41b7e8a3c06f1d2e4b8a9c7d3e5f60718293a4b5c6d7e8f90a1b2ce1a9";
/**
 * The discovery metadata a 402 challenge carries: the x402 "bazaar" extension, built by the x402
 * project's own declareDiscoveryExtension and pinned to GET the way its resource server does per
 * request, so it is the shape the CDP facilitator validates (info against schema) and lists. No
 * input: the product is the URL. The output is what a paid request returns.
 */
export function bazaar(c: Company, p: Product): { bazaar: Record<string, unknown> } {
  const { bazaar: declared } = declareDiscoveryExtension({
    output: {
      example: { ok: true, tx: EXAMPLE_TX, deliverable: `${config.publicUrl}/download/${c.slug}/${p.id}/1793000000/kQ3vYb8Zr1Lx0Wm5Tn7Pc2Hd9Ja4Fs6E?ref=${EXAMPLE_TX}` },
      schema: {
        properties: {
          ok: { type: "boolean", description: "True once the payment is settled" },
          tx: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$", description: "The USDC settlement transaction on Base" },
          deliverable: { type: "string", description: `Signed download link to the ${p.kind} (text/markdown), valid for 7 days` },
        },
        required: ["ok", "tx", "deliverable"],
      },
    },
  });
  const path = new URL(buyUrl(c, p)).pathname;
  return { bazaar: bazaarResourceServerExtension.enrichDeclaration!(declared, { method: "GET", adapter: { getPath: () => path } }) as Record<string, unknown> };
}

const tag = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
/**
 * What a product's 402 challenge advertises, and so what the facilitator settles against: the exact
 * terms, the resource (with the service name, tags and icon the Bazaar shows) and the bazaar extension.
 */
export function offerFor(c: Company, p: Product, text: string | null): Offer {
  return {
    requirement: requirement(config.salesChainId, c.wallet, p.priceUsdc),
    resource: {
      url: buyUrl(c, p), description: describe(c, p, text ? previewOf(text) : null), mimeType: "application/json",
      serviceName: "NIGHTSHIFT", tags: [...new Set([tag(p.kind), "markdown", "ai-company", "nightshift"].filter(Boolean))],
      ...(config.publicUrl.startsWith("https://") ? { iconUrl: `${config.publicUrl}/app/icon-512.png` } : {}),
    },
    extensions: bazaar(c, p),
  };
}

type Live = { c: Company; p: Product; text: string | null };
export type Filters = { q?: string; kind?: string; maxUsd?: number; sort?: "best" | "new" | "price" };

/** Search the live, packaged products. Words match name, pitch, company and audience; filters narrow it. */
export function search(all: Live[], f: Filters) {
  const words = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const rows = all.filter(({ c, p }) => {
    const hay = `${c.name} ${c.mission} ${c.audience ?? ""} ${p.name} ${p.pitch} ${p.kind}`.toLowerCase();
    return words.every((w) => hay.includes(w)) && (!f.kind || p.kind === f.kind) && (f.maxUsd === undefined || Number(p.priceUsdc) / 1e6 <= f.maxUsd);
  });
  rows.sort((a, b) => f.sort === "price" ? Number(a.p.priceUsdc - b.p.priceUsdc) : f.sort === "new" ? b.p.createdAt - a.p.createdAt : b.p.sales - a.p.sales || b.p.createdAt - a.p.createdAt);
  return rows;
}

export function card({ c, p, text }: Live) {
  const pv = text ? previewOf(text) : null;
  return {
    id: p.id, name: p.name, kind: p.kind, pitch: p.pitch, priceUsd: Number(p.priceUsdc) / 1e6, sales: p.sales, b2bSales: p.b2bSales ?? 0, createdAt: p.createdAt,
    company: { name: c.name, slug: c.slug, page: `${config.publicUrl}/c/${c.slug}` },
    words: pv?.words ?? null, sections: pv?.sections ?? null,
    preview: `${config.publicUrl}/api/market/${c.slug}/${p.id}`,
    buy: { url: buyUrl(c, p), protocol: "x402 v2", asset: "USDC", chainId: config.salesChainId, network: `eip155:${config.salesChainId}`, payTo: c.wallet },
  };
}

/** One product in full, with its preview: what an agent reads before deciding to pay. */
export function detail(l: Live) {
  return { ...card(l), description: describe(l.c, l.p, l.text ? previewOf(l.text) : null), preview: l.text ? previewOf(l.text) : null, howToBuy: howToBuy(l.c, l.p) };
}

export function howToBuy(c: Company, p: Product) {
  const url = buyUrl(c, p);
  return {
    steps: [
      `GET ${url}: the answer is 402 with the payment terms (also base64 in the PAYMENT-REQUIRED header).`,
      "Sign an EIP-3009 transferWithAuthorization for the amount in accepts[0], to payTo, on its network (USDC). Any x402 v2 client does this.",
      `Repeat GET ${url} with the header PAYMENT-SIGNATURE: <base64 payment payload>. The answer is 200 with { ok, tx, deliverable }.`,
      "Download the deliverable (markdown). The link is signed for you and valid for 7 days.",
    ],
    sim: config.mode === "sim" ? `Simulation: POST ${url}?sim=1 records a demo sale and returns a download link; no money moves.` : null,
  };
}

/** The whole catalog in the discovery shape: every live product with its exact x402 payment terms. */
export function catalog(all: Live[]) {
  return {
    x402Version: 2, provider: { name: "NIGHTSHIFT", url: config.publicUrl }, updatedAt: new Date().toISOString(), count: all.length,
    // each item as the CDP Bazaar lists one (resource, accepts, description, extensions, serviceName, tags), plus the product card
    items: search(all, {}).map((l) => {
      const o = offerFor(l.c, l.p, l.text);
      return {
        resource: o.resource.url, type: "http", x402Version: 2,
        accepts: [o.requirement],
        description: o.resource.description, mimeType: o.resource.mimeType,
        serviceName: o.resource.serviceName, tags: o.resource.tags, ...(o.resource.iconUrl ? { iconUrl: o.resource.iconUrl } : {}),
        extensions: o.extensions,
        lastUpdated: new Date(l.p.createdAt).toISOString(),
        metadata: card(l),
      };
    }),
  };
}
