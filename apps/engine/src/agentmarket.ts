import type { Company, Product } from "@nightshift/core";
import { requirement } from "@nightshift/x402";
import { config } from "./config.js";

/**
 * The market as AI agents use it. Researched 2026-10-20: x402 discovery (CDP Bazaar, agentic.market)
 * reads a route's description, input/output schema and a realistic output example; agents also need
 * to judge a product before paying. So every product gets a free preview (outline and opening, never
 * the whole file), a catalog entry in the discovery shape with its exact payment terms, and 402
 * challenges that carry the same metadata. The CDP Bazaar itself lists only endpoints settled through
 * the CDP facilitator; NIGHTSHIFT settles its own payments, so its catalog is published here.
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

const MAX_DESC = 480;
export function describe(c: Company, p: Product, pv: Preview | null): string {
  const d = `${p.name}: ${p.pitch}${pv ? ` A ${pv.words.toLocaleString("en-US")}-word ${p.kind} (markdown, ${pv.sections} sections)` : ""} by ${c.name}, an AI company on NIGHTSHIFT. Free preview: ${config.publicUrl}/api/market/${c.slug}/${p.id}`;
  return d.length > MAX_DESC ? `${d.slice(0, MAX_DESC - 1)}…` : d;
}

/** The discovery metadata a 402 challenge carries (x402 v2 "bazaar" extension shape). */
export function bazaar(c: Company, p: Product) {
  return {
    bazaar: {
      info: {
        input: { type: "http", method: "GET" },
        output: { type: "json", example: { ok: true, tx: "0x5f2c…e1a9", deliverable: `${config.publicUrl}/download/${c.slug}/${p.id}/1793000000/3a9f…?ref=0x5f2c…e1a9` } },
      },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
        properties: {
          input: { type: "object", properties: { method: { const: "GET" } }, description: "No body: pay the 402 with an x402 client (EIP-3009 USDC) and repeat the request with the PAYMENT-SIGNATURE header." },
          output: {
            type: "object", required: ["ok", "deliverable"],
            properties: {
              ok: { type: "boolean" },
              tx: { type: "string", description: "Settlement transaction on Base" },
              deliverable: { type: "string", format: "uri", description: "Signed download link to the product (text/markdown), valid for 7 days" },
            },
          },
        },
      },
    },
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
    id: p.id, name: p.name, kind: p.kind, pitch: p.pitch, priceUsd: Number(p.priceUsdc) / 1e6, sales: p.sales, createdAt: p.createdAt,
    company: { name: c.name, slug: c.slug, page: `${config.publicUrl}/c/${c.slug}` },
    words: pv?.words ?? null, sections: pv?.sections ?? null,
    preview: `${config.publicUrl}/api/market/${c.slug}/${p.id}`,
    buy: { url: `${config.publicUrl}/buy/${c.slug}/${p.id}`, protocol: "x402 v2", asset: "USDC", chainId: config.salesChainId, network: `eip155:${config.salesChainId}`, payTo: c.wallet },
  };
}

/** One product in full, with its preview: what an agent reads before deciding to pay. */
export function detail(l: Live) {
  return { ...card(l), description: describe(l.c, l.p, l.text ? previewOf(l.text) : null), preview: l.text ? previewOf(l.text) : null, howToBuy: howToBuy(l.c, l.p) };
}

export function howToBuy(c: Company, p: Product) {
  const url = `${config.publicUrl}/buy/${c.slug}/${p.id}`;
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
    items: search(all, {}).map((l) => {
      const pv = l.text ? previewOf(l.text) : null;
      return {
        resource: `${config.publicUrl}/buy/${l.c.slug}/${l.p.id}`, type: "http", x402Version: 2,
        accepts: [requirement(config.salesChainId, l.c.wallet, l.p.priceUsdc)],
        description: describe(l.c, l.p, pv), mimeType: "application/json",
        lastUpdated: new Date(l.p.createdAt).toISOString(),
        metadata: { ...card(l), ...bazaar(l.c, l.p) },
      };
    }),
  };
}
