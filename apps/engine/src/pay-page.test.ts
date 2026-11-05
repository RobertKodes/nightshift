import { describe, expect, it } from "vitest";
import { OFFERS, usdOf } from "./services/catalog.js";
import { x402JsonManifest } from "./services/discovery.js";
import { HIDDEN_PAGES, PAGES, robotsTxt } from "./station-routes.js";
import { PAY_OFFER_IDS, PAY_PAGE_PATH, listedPayments } from "../../web/src/payOnce.js";

const base = "https://getnightshift.tech";

describe("hidden x402 payer", () => {
  it("is kept out of the sitemap and disallowed for every crawler", () => {
    expect(PAY_PAGE_PATH).toBe("/pay-x7k2");
    expect(HIDDEN_PAGES).toEqual([PAY_PAGE_PATH]);
    expect(PAGES.some((p) => p.path === PAY_PAGE_PATH)).toBe(false);
    const robots = robotsTxt(base);
    const blocks = robots.split("\n\n").filter((b) => b.startsWith("User-agent:"));
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) expect(block).toContain(`Disallow: ${PAY_PAGE_PATH}`);
    expect(robots).not.toContain(`${base}${PAY_PAGE_PATH}`);
  });

  it("uses the catalog example and the x402.json price, which agree", () => {
    const doc = x402JsonManifest(base);
    const index = {
      network: "eip155:8453",
      payTo: "0x1111111111111111111111111111111111111111",
      offers: OFFERS.map((o) => ({
        id: o.id, name: o.name, priceUsd: usdOf(o), example: `${base}${o.example}`, route: `${base}${o.route}`,
        ...(o.quoted ? { priceIsMinimum: true } : {}),
      })),
    };
    const targets = listedPayments(index, doc, base);
    expect(targets.map((t) => t.id)).toEqual([...PAY_OFFER_IDS]);
    expect(targets.find((t) => t.id === "imd-feed")).toMatchObject({ path: "/api/v1/imd/launches?chain=ethereum&limit=20", price: "0.001", amount: "1000" });
    expect(targets.find((t) => t.id === "gas-now")!.path).toBe("/api/v1/gas-now");
    expect(targets.find((t) => t.id === "watchtower-check")!.path).toMatch(/^\/api\/v1\/watchtower\/check\/ethereum\/0x[0-9a-f]{40}$/);
    for (const t of targets) {
      const offer = OFFERS.find((o) => o.id === t.id)!;
      expect(t.amount).toBe(offer.priceUsdc.toString());
      expect(t.price).toBe(usdOf(offer).toString());
      expect(doc.resources).toContain(`${base}${offer.example}`);
    }
  });
});
