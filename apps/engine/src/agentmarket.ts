import { type Company, type Product, RECIPES, inputSchema, recipeOf } from "@nightshift/core";
import { type Offer, requirement } from "@nightshift/x402";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { config } from "./config.js";
import { backupUrl, productSite } from "./site-backup.js";

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

/**
 * What the buyer actually gets. Nothing a company sells is a callable API: a tool is a small web page on
 * IPFS (the buyer gets a Markdown file with its address, to open in a browser); every other kind is a
 * Markdown document to download.
 */
export function deliveryOf(kind: string, format?: Product["format"]): { type: "browser-tool" | "document" | "made-to-order" | "download"; callable: boolean; what: string } {
  if (format === "custom") return { type: "made-to-order", callable: true, what: "a Markdown file written for you from the answers you send (the input schema is with the product). It is written and checked before your payment settles; if it cannot be made, nothing is charged" };
  if (format === "download") return { type: "download", callable: false, what: "a ZIP you download after payment: a printable PDF pack of checklists and templates, with an editable Markdown copy" };
  if (format === "planner") return { type: "download", callable: false, what: "a ZIP you download after payment: a hyperlinked digital planner as PDFs (Monday and Sunday start)" };
  return kind === "tool"
    ? { type: "browser-tool", callable: false, what: "a small web tool hosted on IPFS: after payment you get a Markdown file with its address and a backup link when available, to open in a browser" }
    : { type: "document", callable: false, what: `a Markdown ${kind} you download after payment` };
}
const CLAIMS_API = /\b(callable|apis?|endpoints?|per[- ]call|one x402 call returns|returns? json)\b/i;
/** The company's pitch as written, with a correction when it promises a callable API it does not deliver. */
export function honestPitch(p: { kind: string; pitch: string; format?: Product["format"] }): string {
  // a made-to-order file is ordered with a request body: saying so is true
  if (p.format === "custom") return p.pitch;
  return CLAIMS_API.test(p.pitch) ? `${p.pitch} [Correction: this is ${p.kind === "tool" ? "a browser tool you open yourself" : "a document"}, not a callable API.]` : p.pitch;
}

/** The CDP facilitator refuses a description over 500 characters. */
const MAX_DESC = 480;
export function describe(c: Company, p: Product, pv: Preview | null): string {
  const what = p.format === "custom" ? `Made to order: POST your answers as JSON {"input": {...}} (schema in the product), and a Markdown ${RECIPES[recipeOf(p.custom?.recipe)?.id ?? "names"].label.toLowerCase()} is written for you and checked before the payment settles`
    : p.format === "download" ? `A printable PDF pack${p.download ? ` (${p.download.pages} pages, ${p.download.sections} sheets)` : ""} with an editable Markdown copy, as a ZIP`
    : p.format === "planner" ? "A hyperlinked digital planner as PDFs, in a ZIP"
    : p.kind === "tool" ? "A browser tool (you get its address in a Markdown file)" : pv ? `A ${pv.words.toLocaleString("en-US")}-word Markdown ${p.kind} (${pv.sections} sections)` : `A Markdown ${p.kind}`;
  const d = `${p.name}: ${honestPitch(p)} ${what} by ${c.name}, an AI company on NIGHTSHIFT. Free preview: ${config.publicUrl}/api/market/${c.slug}/${p.id}`;
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
  const recipe = p.format === "custom" ? recipeOf(p.custom?.recipe) : null;
  const path = new URL(buyUrl(c, p)).pathname;
  if (recipe) {
    // made to order: the buyer's answers are the request body, with the form as its schema and a made-up example
    const { bazaar: declared } = declareDiscoveryExtension({
      bodyType: "json",
      input: { input: Object.fromEntries(Object.entries(recipe.sample).filter(([, v]) => v)) },
      inputSchema: { properties: { input: inputSchema(recipe) }, required: ["input"] },
      output: {
        example: { ok: true, tx: EXAMPLE_TX, order: "q3VYb8Zr1Lx0Wm5Tn7Pc2H", deliverable: `${config.publicUrl}/download/${c.slug}/${p.id}/1793000000/kQ3vYb8Zr1Lx0Wm5Tn7Pc2Hd9Ja4Fs6E?ref=o-q3VYb8Zr1Lx0Wm5Tn7Pc2H` },
        schema: {
          properties: {
            ok: { type: "boolean", description: "True once the file is written, checked and the payment is settled" },
            tx: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$", description: "The USDC settlement transaction on Base" },
            order: { type: "string", description: "The order's id" },
            deliverable: { type: "string", description: "Signed download link to your file (text/markdown), valid for 7 days" },
          },
          required: ["ok", "tx", "deliverable"],
        },
      },
    });
    return { bazaar: bazaarResourceServerExtension.enrichDeclaration!(declared, { method: "POST", adapter: { getPath: () => path } }) as Record<string, unknown> };
  }
  const { bazaar: declared } = declareDiscoveryExtension({
    output: {
      example: { ok: true, tx: EXAMPLE_TX, deliverable: `${config.publicUrl}/download/${c.slug}/${p.id}/1793000000/kQ3vYb8Zr1Lx0Wm5Tn7Pc2Hd9Ja4Fs6E?ref=${EXAMPLE_TX}` },
      schema: {
        properties: {
          ok: { type: "boolean", description: "True once the payment is settled" },
          tx: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$", description: "The USDC settlement transaction on Base" },
          deliverable: { type: "string", description: `Signed download link to the ${p.kind} (${p.format === "download" || p.format === "planner" ? "application/zip" : "text/markdown"}), valid for 7 days` },
        },
        required: ["ok", "tx", "deliverable"],
      },
    },
  });
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
      serviceName: "NIGHTSHIFT", tags: [...new Set([tag(p.format === "custom" ? `made-to-order` : p.format ?? p.kind), ...(p.custom ? [tag(p.custom.recipe)] : []), p.format === "download" || p.format === "planner" ? "pdf" : "markdown", "ai-company", "nightshift"].filter(Boolean))].slice(0, 5),
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
    id: p.id, name: p.name, kind: p.kind, ...(p.format ? { format: p.format } : {}), pitch: honestPitch(p), delivery: deliveryOf(p.kind, p.format), priceUsd: Number(p.priceUsdc) / 1e6, sales: p.sales, b2bSales: p.b2bSales ?? 0, createdAt: p.createdAt,
    // made to order: what to send, as JSON Schema, with a made-up example
    ...(recipeOf(p.custom?.recipe) && p.format === "custom" ? { input: { schema: inputSchema(recipeOf(p.custom!.recipe)!), example: Object.fromEntries(Object.entries(recipeOf(p.custom!.recipe)!.sample).filter(([, v]) => v)), send: `POST ${buyUrl(c, p)} with JSON {"input": {...}}` } } : {}),
    ...productSite(p),
    company: { name: c.name, slug: c.slug, page: `${config.publicUrl}/c/${c.slug}`, site: c.site?.url ?? null, siteBackup: backupUrl(c.site?.cid) },
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
  if (p.format === "custom") return {
    steps: [
      `POST ${url} with the JSON body {"input": {...}} (the fields are in input.schema; a wrong field is answered with 400 and what to fix, free). The answer is 402 with the payment terms.`,
      "Sign an EIP-3009 transferWithAuthorization for the amount in accepts[0], to payTo, on its network (USDC). Any x402 v2 client does this.",
      `Repeat the same POST with the header PAYMENT-SIGNATURE: <base64 payment payload>. Your file is written and checked first (up to two minutes), then the payment settles: 200 with { ok, tx, order, deliverable }. If it cannot be written the answer is 503 and nothing is charged.`,
      "Or in two steps: POST /api/orders {company, product, input}, poll GET /api/orders/<id> until it is ready (you see its sections and first lines), then pay at the buy URL with ?order=<id>.",
      "Download the deliverable (markdown). The link is signed for you and valid for 7 days.",
    ],
    sim: config.mode === "sim" ? `Simulation: POST ${url}?sim=1 with {"input": {...}} writes the file, records a demo sale and returns a download link; no money moves.` : null,
  };
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

/**
 * The companies' part of /openapi.json: the market's free routes, and one paid operation per product on
 * sale with its x402 price. A made-to-order product is a POST whose body schema is its order form, so a
 * scanner or an agent reads what to send without opening a page.
 */
export function marketOpenapi(all: Live[]): Record<string, unknown> {
  const free = (summary: string, extra: Record<string, unknown> = {}) => ({ summary, tags: ["Company products"], security: [], responses: { 200: { description: "JSON" } }, ...extra });
  const str = (name: string, where: "path" | "query", description: string, required = where === "path") => ({ name, in: where, required, description, schema: { type: "string" } });
  const paths: Record<string, unknown> = {
    "/api/market/search": { get: free("Search every product the AI companies sell (free)", { parameters: [str("q", "query", "words to match"), str("kind", "query", "tool, template, dataset or report"), str("maxUsd", "query", "highest price in USD"), str("sort", "query", "best, new or price")] }) },
    "/api/market/catalog": { get: free("Every product with its x402 payment terms, in the discovery format (free)") },
    "/api/market/{company}/{product}": { get: free("One product with its free preview, its input schema when it is made to order, and how to buy it (free)", { parameters: [str("company", "path", "company slug"), str("product", "path", "product id")] }) },
    "/api/orders": { post: free("Order a made-to-order file: it is written and checked first, and paid for only once it is ready (free to call)", { requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["company", "product", "input"], properties: { company: { type: "string" }, product: { type: "string" }, input: { type: "object", description: "the product's own fields: see its input.schema" } } } } } }, responses: { 201: { description: "The order, to poll" }, 400: { description: "What is wrong in the input, field by field" }, 503: { description: "Cannot be written right now; nothing is charged" } } }) },
    "/api/orders/{id}": { get: free("An order's state: writing, ready (with its sections and first lines), failed, or paid (with the download link)", { parameters: [str("id", "path", "the order id"), str("wait", "query", "1: answer when it is written, or after 25 seconds")] }) },
    "/api/feed": { get: free("What the companies did, newest first: founded, shift, product, sale, post, price (free)", { parameters: [str("limit", "query", "1 to 200, default 50")] }) },
  };
  for (const l of search(all, {}).slice(0, 300)) {
    const { c, p } = l;
    const o = offerFor(c, p, l.text);
    const recipe = p.format === "custom" ? recipeOf(p.custom?.recipe) : null;
    const op = {
      summary: `${p.name} ($${(Number(p.priceUsdc) / 1e6).toFixed(2)}) by ${c.name}`, description: o.resource.description, tags: ["Company products"],
      "x-payment-info": { protocols: ["x402"], price: { mode: "fixed", currency: "USD", amount: (Number(p.priceUsdc) / 1e6).toFixed(2) }, protocol: "x402", version: 2, scheme: "exact", network: o.requirement.network, asset: "USDC", amount: o.requirement.amount, priceUsd: Number(p.priceUsdc) / 1e6, payTo: o.requirement.payTo },
      ...(recipe ? { requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["input"], properties: { input: inputSchema(recipe) } }, example: { input: Object.fromEntries(Object.entries(recipe.sample).filter(([, v]) => v)) } } } } } : {}),
      responses: {
        200: { description: "Paid and delivered (a PAYMENT-RESPONSE header carries the settlement)", content: { "application/json": { schema: { type: "object", required: ["ok", "tx", "deliverable"], properties: { ok: { type: "boolean" }, tx: { type: "string" }, deliverable: { type: "string", description: "signed download link, valid for 7 days" }, ...(recipe ? { order: { type: "string" } } : {}) } } } } },
        ...(recipe ? { 400: { description: "What is wrong in the input, field by field (free)" }, 503: { description: "The file could not be written; nothing was charged" } } : {}),
        402: { description: "Payment required: the x402 v2 challenge (also base64 in the PAYMENT-REQUIRED header), with extensions.bazaar" },
      },
    };
    paths[new URL(o.resource.url).pathname] = recipe ? { post: op } : { get: op };
  }
  return paths;
}
