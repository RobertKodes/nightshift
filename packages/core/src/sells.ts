import type { LedgerTx } from "@nightshift/ledger";
import type { Company } from "./types.js";
import { fromUsdc } from "./types.js";

/**
 * What sells, for the CEO's prompt each shift, learned only from data the company may use: its own
 * sales (x402 in USDC, to other companies, on the owner's Gumroad), its own page visits (and which of
 * its posts brought them), and the NIGHTSHIFT market's own listings. Nothing is scraped from anywhere.
 */
export interface Sells {
  products: { id: string; name: string; kind: string; status: string; priceUsd: number; x402: { n: number; usd: number }; gumroad: { n: number; usd: number }; b2b: { n: number; usd: number } }[];
  visits7d: number;
  /** Visits in 7 days that came from the company's own posts, by channel. */
  via: Record<string, number>;
  market: { products: number; medianUsd: number | null; top: { name: string; company: string; kind: string; priceUsd: number; sales: number }[] };
}

export interface SellsInput {
  /** The company's x402 sales (people and outside agents), as the engine records them. */
  sales: { at: number; productId: string; usdc: string }[];
  /** The company's ledger lines; Gumroad sales are the `gumroad` ones. */
  ledger: LedgerTx[];
  visits: number[];
  via: { at: number; ch: string }[];
  /** Every product on sale on the NIGHTSHIFT market. */
  market: { company: string; slug: string; name: string; kind: string; priceUsd: number; sales: number }[];
}

const DAY = 24 * 60 * 60 * 1000;

export function sellsFrom(c: Company, i: SellsInput, now = Date.now()): Sells {
  const rows = new Map(c.products.map((p) => [p.id, { id: p.id, name: p.name, kind: p.kind, status: p.status, priceUsd: fromUsdc(p.priceUsdc), x402: { n: 0, usd: 0 }, gumroad: { n: 0, usd: 0 }, b2b: { n: 0, usd: 0 } }]));
  for (const s of i.sales) { const r = rows.get(s.productId); if (r) { r.x402.n += 1; r.x402.usd += Number(s.usdc) / 1e6; } }
  for (const l of c.b2b?.sold ?? []) { const r = rows.get(l.productId); if (r) { r.b2b.n += 1; r.b2b.usd += fromUsdc(l.usdc); } }
  for (const tx of i.ledger) {
    if (tx.kind !== "gumroad" && tx.kind !== "gumroad_refund") continue;
    const r = rows.get(String(tx.meta?.productId ?? ""));
    const leg = tx.postings.find((p) => p.account === `co:${c.id}:gumroad`);
    if (!r || !leg) continue;
    r.gumroad.n += tx.kind === "gumroad" ? 1 : -1;
    r.gumroad.usd += Number(leg.amount) / 1e6;
  }
  const since = now - 7 * DAY;
  const via: Record<string, number> = {};
  for (const v of i.via) if (v.at >= since) via[v.ch] = (via[v.ch] ?? 0) + 1;
  const others = i.market.filter((m) => m.slug !== c.slug);
  const prices = i.market.map((m) => m.priceUsd).sort((a, b) => a - b);
  const median = prices.length ? (prices.length % 2 ? prices[(prices.length - 1) / 2]! : (prices[prices.length / 2 - 1]! + prices[prices.length / 2]!) / 2) : null;
  return {
    products: [...rows.values()].filter((r) => r.status === "live" || r.x402.n || r.gumroad.n || r.b2b.n),
    visits7d: i.visits.filter((v) => v >= since).length,
    via,
    market: { products: i.market.length, medianUsd: median, top: [...others].sort((a, b) => b.sales - a.sales).slice(0, 5).filter((m) => m.sales > 0).map((m) => ({ name: m.name, company: m.company, kind: m.kind, priceUsd: m.priceUsd, sales: m.sales })) },
  };
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** The same, in lines for the CEO's prompt. */
export function sellsLines(s: Sells): string[] {
  const out = s.products.map((p) => {
    const parts = [`${p.x402.n} sold over x402 for ${money(p.x402.usd)}`];
    if (p.gumroad.n) parts.push(`${p.gumroad.n} on Gumroad for ${money(p.gumroad.usd)}`);
    if (p.b2b.n) parts.push(`${p.b2b.n} to other companies for ${money(p.b2b.usd)}`);
    return `- "${p.name}" (${p.kind}, ${money(p.priceUsd)} now, ${p.status}): ${parts.join(" · ")}`;
  });
  const via = Object.entries(s.via).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
  out.push(`- Visits in 7 days: ${s.visits7d}${via ? `; from the company's own posts: ${via}` : ""}`);
  if (s.market.products) out.push(`- The NIGHTSHIFT market: ${s.market.products} products on sale${s.market.medianUsd !== null ? `, median price ${money(s.market.medianUsd)}` : ""}.${s.market.top.length ? ` Best sellers of other companies: ${s.market.top.map((m) => `"${m.name}" by ${m.company} (${m.kind}, ${money(m.priceUsd)}, ${m.sales} sold)`).join("; ")}` : ""}`);
  return out;
}
