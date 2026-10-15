import type { Company } from "@nightshift/core";
import type { Metrics } from "./store.js";

/**
 * Sim mode only: visitors and buyers, so a demo company has numbers to react to. Traffic grows with
 * marketing and the site; conversion falls with price and rises with the number of products. Every
 * simulated sale is marked `sim` everywhere it shows.
 */
export function simulateTraffic(c: Company, m: Metrics, dtMs: number, now: number): { visits: number; sales: { productId: string; usdc: bigint }[] } {
  if (!c.site) return { visits: 0, sales: [] };
  const live = c.products.filter((p) => p.status === "live");
  const posts = c.marketing.filter((p) => now - p.at < 3 * 24 * 3600_000).length;
  const perMinute = 0.6 + posts * 0.5 + live.length * 0.3;
  const visits = poisson((perMinute * dtMs) / 60_000);
  const sales: { productId: string; usdc: bigint }[] = [];
  for (let i = 0; i < visits; i++) {
    const p = live[Math.floor(Math.random() * live.length)];
    if (!p) break;
    const price = Number(p.priceUsdc) / 1e6;
    const conv = Math.min(0.12, 0.05 * (12 / (price + 3)) * (1 + live.length * 0.1));
    if (Math.random() < conv) sales.push({ productId: p.id, usdc: p.priceUsdc });
  }
  void m;
  return { visits, sales };
}

function poisson(l: number): number {
  let k = 0;
  let p = Math.exp(-l);
  let s = p;
  const u = Math.random();
  while (u > s && k < 1000) { k++; p *= l / k; s += p; }
  return k;
}
