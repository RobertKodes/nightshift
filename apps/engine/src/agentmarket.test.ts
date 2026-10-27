import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Company, Product } from "@nightshift/core";
import { beforeAll, describe, expect, it } from "vitest";
import type * as AM from "./agentmarket.js";

let M: typeof AM;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "agentmarket-test-"));
  M = await import("./agentmarket.js");
});

const TEXT = ["# Cold email kit for designers", "", "Twelve templates that get replies.", "", "## Template 1: the portfolio opener", "Hi {name}, I noticed your studio ships fast…", "## Template 2: the follow-up", "A short nudge that works.", ...Array.from({ length: 200 }, (_, i) => `Line ${i} of the body with real advice about outreach and timing.`)].join("\n");
const co = (slug: string, extra: Partial<Company> = {}) => ({ id: slug, slug, name: slug.toUpperCase(), mission: "Help freelancers", audience: "freelance designers", wallet: "0x1111111111111111111111111111111111111111", products: [], ...extra }) as unknown as Company;
const prod = (id: string, usd: number, kind = "guide", sales = 0, createdAt = 1) => ({ id, name: `P ${id}`, kind, pitch: "Useful.", priceUsdc: BigInt(Math.round(usd * 1e6)), status: "live", sales, createdAt }) as unknown as Product;

describe("agent market", () => {
  it("exposes the company and tool backup links beside their sites", () => {
    const cid = "bafybeifmibbcoyqpiq7t6u2su7jr7vwegpakyw4ezcjr723mrmmrcbdfve";
    const url = "https://ns-nightwatch-981.identitymd.eth.limo", backup = `https://imd-ipfs.xyz/ipfs/${cid}/`;
    const c = co("nightwatch", { site: { url, jobId: "j", cid } });
    const p = { ...prod("checker", 9, "tool"), deliverableUrl: url, site: { url, cid } };
    expect(M.card({ c, p, text: TEXT })).toMatchObject({ site: url, siteBackup: backup, company: { site: url, siteBackup: backup } });
    expect(M.detail({ c, p, text: TEXT }).siteBackup).toBe(backup);
    expect(M.catalog([{ c, p, text: TEXT }]).items[0]?.metadata.siteBackup).toBe(backup);
  });

  it("previews the outline and opening, never more than 10% of the text or 700 characters", () => {
    const pv = M.previewOf(TEXT);
    expect(pv.title).toBe("Cold email kit for designers");
    expect(pv.outline).toEqual(["Template 1: the portfolio opener", "Template 2: the follow-up"]);
    expect(pv.opening.length).toBeLessThanOrEqual(701);
    expect(pv.opening.length).toBeLessThanOrEqual(Math.floor(TEXT.length * 0.1) + 1);
    expect(pv.words).toBeGreaterThan(1000);
    expect(M.previewOf("# Tiny\n\nshort text here").opening.length).toBeLessThanOrEqual(3);
  });

  it("searches by words, kind and maximum price, and sorts", () => {
    const a = co("alpha"), b = co("beta", { mission: "Grants for founders", audience: "founders" } as Partial<Company>);
    const live = [
      { c: a, p: prod("cheap", 2, "templates", 1, 5), text: TEXT },
      { c: a, p: prod("pricey", 19, "guide", 9, 1), text: TEXT },
      { c: b, p: prod("grants", 7, "report", 3, 9), text: TEXT },
    ];
    expect(M.search(live, { q: "founders" }).map((r) => r.p.id)).toEqual(["grants"]);
    expect(M.search(live, { kind: "templates" }).map((r) => r.p.id)).toEqual(["cheap"]);
    expect(M.search(live, { maxUsd: 7 }).map((r) => r.p.id)).toEqual(["grants", "cheap"]);
    expect(M.search(live, { sort: "price" }).map((r) => r.p.id)).toEqual(["cheap", "grants", "pricey"]);
    expect(M.search(live, { sort: "new" }).map((r) => r.p.id)).toEqual(["grants", "cheap", "pricey"]);
  });

  it("publishes a discovery catalog with exact x402 terms and the bazaar metadata", () => {
    const a = co("alpha");
    const cat = M.catalog([{ c: a, p: prod("cheap", 2.5), text: TEXT }]);
    expect(cat.x402Version).toBe(2);
    const it0 = cat.items[0]!;
    expect(it0.resource).toMatch(/\/buy\/alpha\/cheap$/);
    expect(it0.accepts[0]!.amount ?? (it0.accepts[0] as unknown as { maxAmountRequired: string }).maxAmountRequired).toBe("2500000");
    expect(it0.description.length).toBeLessThanOrEqual(480);
    expect(it0.description).toContain("Free preview");
    const bz = (it0.extensions as { bazaar: { info: { output: { example: { ok: boolean } } }; schema: { properties: { output: { properties: { example: { required: string[] } } } } } } }).bazaar;
    expect(bz.info.output.example.ok).toBe(true);
    expect(bz.schema.properties.output.properties.example.required).toContain("deliverable");
    const d = M.detail({ c: a, p: prod("cheap", 2.5), text: TEXT });
    expect(d.preview?.outline.length).toBe(2);
    expect(d.howToBuy.steps.length).toBe(4);
  });
});
