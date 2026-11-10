import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { type Company, DEFAULT_POLICY, type Product } from "@nightshift/core";
import { exportCompany } from "./export.js";

const product = (id: string, name: string, extra: Partial<Product> = {}): Product => ({ id, name, kind: "template", pitch: "x", priceUsdc: 3_000_000n, status: "live", deliverableUrl: null, taskId: "t", sales: 2, revenueUsdc: 6_000_000n, createdAt: 1, ...extra });

const company = (): Company => ({
  id: "c1", slug: "wardcv", name: "WardCV", idea: "Résumé rewrites for ward nurses", mission: "A résumé that gets ward nurses a clinic interview.", audience: "ward nurses", createdAt: 1, owner: "0xowner",
  wallet: "0x0000000000000000000000000000000000000001", policy: { ...DEFAULT_POLICY }, status: "active", cycle: 3, nextShiftAt: null,
  site: { url: "https://ns-wardcv.imd.site", jobId: "job-1", cid: "bafyexample" },
  products: [product("p1", "Ward CV résumé", { format: "custom", custom: { recipe: "resume", delivered: 2 } }), product("p2", "Ward pack: sheets/2026", { format: "download" }), product("p3", "Ward pack: sheets/2026", { status: "retired" })],
  tasks: [{ id: "t", cycle: 1, kind: "build_product", title: "Make Ward CV", why: "y", status: "done", stepsDone: 0, stepsTotal: 0, activity: null, costImd: 500000000000000000n, result: null, error: null, createdAt: 1, updatedAt: 2 }],
  journal: [{ at: 1, cycle: 1, kind: "plan", text: "Founded WardCV." }],
  marketing: [{ at: 5, channel: "x", text: "Ward CV is open.", status: "drafted" }],
  chat: [{ id: "l1", at: 3, from: "owner", text: "What sells?" }],
  asks: [{ id: "a1", at: 4, topic: "share_link", text: "Share the link once.", status: "open" }],
});

describe("no lock-in: the company as one archive", () => {
  it("holds everything the company is, made and earned, and no key", async () => {
    const c = company();
    const x = await exportCompany(c, {
      text: (_c, p) => (p.id === "p3" ? null : `# ${p.name}\n\nThe text of ${p.id}.`),
      bytes: (_c, p) => (p.id === "p2" ? { data: Buffer.from("PK-fake-zip"), name: "Ward pack.zip" } : null),
      image: (_c, p, n) => (p.id === "p2" && n === "hero" ? Buffer.from("PNG") : null),
      ledger: async () => [{ id: "sale:0x1", at: new Date(10), kind: "sale", postings: [{ account: "co:c1:usdc", asset: "USDC", amount: 3_000_000n }, { account: "ext:buyers", asset: "USDC", amount: -3_000_000n }] }],
      booksCsv: async () => '"date","kind"\r\n"2026","sale"\r\n',
      metrics: () => ({ visits: [1, 2, 3], sales: [{ at: 10, productId: "p1", usdc: "3000000", payer: "0xbuyer", tx: "0x1", sim: false }] }),
      siteHtml: () => "<h1>WardCV</h1>", publicUrl: "https://getnightshift.tech", mode: "live", now: () => Date.parse("2026-11-10T08:00:00Z"),
    });
    expect(x.name).toBe("wardcv-export-2026-11-10.zip");
    const z = unzipSync(x.zip);
    const read = (f: string) => strFromU8(z[f]!);
    expect(Object.keys(z).sort()).toEqual([
      "README.txt", "books.csv", "chat.json", "company.json", "connections.json", "ledger.json", "log.json", "posts.json", "products.json",
      "products/01 Ward CV resume/listing.md", "products/01 Ward CV resume/product.json",
      "products/02 Ward pack sheets2026/Ward pack.zip", "products/02 Ward pack sheets2026/hero.png", "products/02 Ward pack sheets2026/product.json", "products/02 Ward pack sheets2026/product.md",
      "products/03 Ward pack sheets2026/product.json",
      "questions.json", "sales.json", "shifts.json", "site/index.html", "site/where.txt",
    ]);
    expect(JSON.parse(read("company.json"))).toMatchObject({ name: "WardCV", slug: "wardcv", shop: "https://getnightshift.tech/c/wardcv", wallet: "0x0000000000000000000000000000000000000001", policy: { dailyBudgetUsd: 10 }, mode: "live" });
    expect(JSON.parse(read("products.json"))).toHaveLength(3);
    // money as it is in the books: whole units, readable anywhere
    expect(JSON.parse(read("products.json"))[0]).toMatchObject({ priceUsdc: "3000000", revenueUsdc: "6000000" });
    expect(JSON.parse(read("shifts.json"))[0]).toMatchObject({ title: "Make Ward CV", costImd: "500000000000000000" });
    expect(JSON.parse(read("sales.json"))).toMatchObject({ visits: 3, sales: [{ tx: "0x1" }] });
    expect(JSON.parse(read("posts.json")).drafts[0].text).toBe("Ward CV is open.");
    expect(JSON.parse(read("questions.json"))[0].topic).toBe("share_link");
    expect(JSON.parse(read("chat.json"))[0].text).toBe("What sells?");
    expect(read("books.csv")).toContain('"2026","sale"');
    expect(read("products/01 Ward CV resume/listing.md")).toContain("The text of p1.");
    expect(read("products/02 Ward pack sheets2026/Ward pack.zip")).toBe("PK-fake-zip");
    expect(read("site/where.txt")).toContain("IPFS CID: bafyexample");
    expect(read("README.txt")).toMatch(/Not in this archive: the wallet's private key/);
    expect(read("README.txt")).toMatch(/the products are yours to sell on any other shop/);
    // nothing that unlocks anything
    const all = Object.values(z).map((b) => strFromU8(b)).join("\n");
    expect(all).not.toMatch(/privateKey|private_key|appPassword|access_token|"secret"/i);
  });

  it("says where the shop is when there is no site, and refuses an archive too large to build", async () => {
    const c = { ...company(), site: null };
    const base = { text: () => null, image: () => null, ledger: async () => [], booksCsv: async () => "", metrics: () => ({ visits: [], sales: [] }), publicUrl: "http://x", mode: "sim" as const };
    const x = await exportCompany(c, { ...base, bytes: () => null });
    expect(strFromU8(unzipSync(x.zip)["site/where.txt"]!)).toContain("Its shop page is http://x/c/wardcv");
    expect(Object.keys(unzipSync(x.zip))).not.toContain("site/index.html");
    const big = Buffer.alloc(150e6);
    await expect(exportCompany(c, { ...base, bytes: () => ({ data: big, name: "big.zip" }) })).rejects.toThrow(/too large to export in one archive/);
  }, 60_000);
});
