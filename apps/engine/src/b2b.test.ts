import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type B2bLine, type Company, DEFAULT_POLICY, type Product, type Task, runShift } from "@nightshift/core";
import { SimImdPlane } from "@nightshift/imd";
import { Ledger } from "@nightshift/ledger";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import type * as B2B from "./b2b.js";
import type * as FL from "./flight.js";

let B: typeof B2B;
let F: typeof FL;
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "b2b-test-"));
  process.env.DATA_DIR = dir;
  B = await import("./b2b.js");
  F = await import("./flight.js");
});

const USD = 1_000_000n;
const TEXT = "# AI tool reviews for solo founders\n\nWe test 40 AI tools so solo founders do not have to.\n\n## The shortlist\n\n" + "Real notes on each tool, tested by hand. ".repeat(80);

function product(id: string, extra: Partial<Product> = {}): Product {
  return { id, name: "AI tool reviews for solo founders", kind: "report", pitch: "We test 40 AI tools so solo founders do not have to.", priceUsdc: 2_500_000n, status: "live", deliverableUrl: "f", taskId: "t", sales: 3, revenueUsdc: 27n * USD, createdAt: Date.now() - 7200_000, ...extra };
}
function company(id: string, name: string, owner: string | null, extra: Partial<Company> = {}): Company {
  return {
    id, slug: name.toLowerCase(), name, idea: "weekly AI tool reviews for solo founders who have no time to test tools", mission: "m", audience: "solo founders",
    createdAt: 0, owner, wallet: privateKeyToAccount(generatePrivateKey()).address, policy: { ...DEFAULT_POLICY }, status: "active", cycle: 0, nextShiftAt: null,
    site: { url: "http://site", jobId: "j" }, marketing: [{ at: Date.now(), channel: "x", text: "hi", status: "drafted" }], products: [], tasks: [], journal: [], sim: true, ...extra,
  };
}

function world() {
  const ledger = new Ledger();
  const seller = company("s1", "Toolwise", "0xbbbb00000000000000000000000000000000bbbb", { products: [product("p-ai"), product("p-tool", { kind: "tool", name: "AI tool picker for solo founders" }), product("p-wip", { status: "building" })] });
  const buyer = company("c1", "Acme", "0xaaaa00000000000000000000000000000000aaaa", { products: [product("own", { name: "Acme Playbook", pitch: "x", priceUsdc: 9n * USD, sales: 0, revenueUsdc: 0n, createdAt: Date.now() - 3600_000 })] });
  const keys = new Map([seller, buyer].map((c) => [c.id, privateKeyToAccount(generatePrivateKey())]));
  const sold: B2bLine[] = [];
  const desk = new B.MarketDesk({
    mode: "sim", chainId: 84532, ledger, companies: () => [seller, buyer],
    files: { has: (_c, p) => p.id !== "p-wip", read: () => TEXT, link: (c, p, ref) => `http://dl/${c.slug}/${p.id}?ref=${ref}` },
    account: (id) => keys.get(id)!,
    sold: (_s, line) => sold.push(line),
    sourcesDir: join(dir, "sources"),
  });
  const now = { t: Date.now() };
  const deps = {
    imd: new SimImdPlane({ jobMs: 10_000, now: () => now.t, deliver: async (id) => ({ siteUrl: null, repoUrl: null, files: { report: `http://files/${id}.md` }, summary: null }) }),
    ledger, llm: null, model: "none", imdUsd: () => 6,
    stats: () => ({ visits7d: 0, sales7d: 0, revenue7dUsd: 0, imdUsd: 6 }),
    buyBase: () => "http://buy", emit: () => {}, now: () => now.t, market: desk,
  };
  return { ledger, seller, buyer, desk, deps, sold };
}

/** The buyer earned $10 from a (simulated) sale to a person: what it may spend on the market. */
const earn = (ledger: Ledger, c: Company) => ledger.post({ id: `sale:${c.id}`, at: new Date(), kind: "sale_sim", postings: [{ account: `co:${c.id}:usdc`, asset: "USDC", amount: 10n * USD }, { account: "ext:buyers-sim", asset: "USDC", amount: -10n * USD }] });

describe("companies buying from each other", () => {
  it("searches the packaged files on sale, never hosted tools or products still being built", async () => {
    const w = world();
    const ids = (await w.desk.offers(w.buyer)).map((o) => o.product.id).sort();
    expect(ids).toEqual(["own", "p-ai"]);
    const o = (await w.desk.offers(w.buyer)).find((x) => x.product.id === "p-ai")!;
    expect(o.preview?.title).toBe("AI tool reviews for solo founders");
    expect(o.preview?.outline).toEqual(["The shortlist"]);
    expect(o.seller).toMatchObject({ id: "s1", owner: "0xbbbb00000000000000000000000000000000bbbb", sim: true });
  });

  it("books one transaction tagged b2b on both sides and counts it apart from sales to people", async () => {
    const w = world();
    await earn(w.ledger, w.buyer);
    expect(await w.desk.usdc(w.buyer)).toBe(10n * USD);
    const t = (await runShift(w.buyer, w.deps))!;
    expect(t.kind).toBe("research");
    expect(t.status).toBe("done");
    const tx = await w.ledger.store.get(`b2b:${t.id}`);
    expect(tx).toMatchObject({ kind: "b2b_sim", meta: { b2b: true, buyer: "c1", seller: "s1", product: "p-ai", task: t.id } });
    expect(tx!.postings).toEqual([{ account: "co:c1:usdc", asset: "USDC", amount: -2_500_000n }, { account: "co:s1:usdc", asset: "USDC", amount: 2_500_000n }]);
    expect(await w.ledger.balance("co:c1:usdc", "USDC")).toBe(7_500_000n);
    expect(await w.ledger.balance("co:s1:usdc", "USDC")).toBe(2_500_000n);
    expect(await w.ledger.balance("co:c1:imd", "IMD")).toBe(0n);
    // the seller's sale is B2B: its sales to people stay as they were
    const p = w.seller.products[0]!;
    expect([p.sales, p.revenueUsdc, p.b2bSales, p.b2bRevenueUsdc]).toEqual([3, 27n * USD, 1, 2_500_000n]);
    expect(w.seller.b2b?.sold).toMatchObject([{ productId: "p-ai", usdc: 2_500_000n, with: { id: "c1", name: "Acme" }, sim: true }]);
    expect(w.buyer.b2b?.bought).toMatchObject([{ productId: "p-ai", with: { id: "s1", name: "Toolwise" } }]);
    expect(w.sold).toHaveLength(1);
    expect(await B.b2bBooks(w.ledger, "c1")).toEqual({ sold: 0, soldUsdc: 0n, bought: 1, boughtUsdc: 2_500_000n });
    expect(await B.b2bBooks(w.ledger, "s1")).toEqual({ sold: 1, soldUsdc: 2_500_000n, bought: 0, boughtUsdc: 0n });
    expect(B.marketTotals([w.seller, w.buyer])).toEqual({ people: { sales: 9, revenueUsd: 81 }, b2b: { sales: 1, revenueUsd: 2.5 } });
    // the buyer keeps its own copy, and its research is the seller's file behind a signed link
    expect(existsSync(join(dir, "sources", `c1-${t.id}.md`))).toBe(true);
    expect(t.result?.files?.research).toBe(`http://dl/toolwise/p-ai?ref=b2b-${t.id}`);
    // booked once: the same purchase again changes nothing
    await w.desk.book({ sellerId: "s1", productId: "p-ai", buyerId: "c1", taskId: t.id, value: 2_500_000n, tx: null, sim: true });
    expect([p.b2bSales, w.sold.length, (await w.ledger.store.list("co:s1:")).length]).toEqual([1, 1, 1]);
  });

  it("refuses at the door: same owner, a demo trading with a live company, a price that went up, a product gone", async () => {
    const w = world();
    const pick = { sellerId: "s1", company: "Toolwise", slug: "toolwise", productId: "p-ai", name: "AI", kind: "report" as const, priceUsdc: 2_500_000n, score: 1 };
    const t = { id: "t1" } as Task;
    w.seller.owner = w.buyer.owner;
    await expect(w.desk.pay(w.buyer, pick, t)).rejects.toThrow(/same owner/);
    w.seller.owner = "0xbbbb00000000000000000000000000000000bbbb";
    w.seller.sim = false;
    await expect(w.desk.pay(w.buyer, pick, t)).rejects.toThrow(/demo company/);
    w.seller.sim = true;
    await expect(w.desk.pay(w.buyer, { ...pick, priceUsdc: 2_000_000n }, t)).rejects.toThrow(/price went up/);
    w.seller.products[0]!.status = "retired";
    await expect(w.desk.pay(w.buyer, pick, t)).rejects.toThrow(/no longer on sale/);
    expect(await w.ledger.store.list("")).toHaveLength(0);
  });

  it("shows the search, every candidate's score, the decision and both ledger lines in the flight recorder", async () => {
    const w = world();
    await earn(w.ledger, w.buyer);
    const t = (await runShift(w.buyer, w.deps))!;
    const input = async (owner: boolean) => ({ imdUsd: 6, owner, live: false, ledger: await w.ledger.store.list("co:c1:"), sales: [], visits: [] });
    const f = F.flight(w.buyer, t, await input(true));
    const root = f.trace[0]!;
    expect(root.children.map((s) => s.name)).toEqual(["The CEO decides", "Search the NIGHTSHIFT market", "Pay Toolwise over x402", "Delivered"]);
    expect(root.children[2]!.costUsd).toBe(2.5);
    expect(f.money).toMatchObject({ costImd: 0, costUsd: 2.5, costUsdc: 2.5 });
    expect(f.money.ledger.map((x) => [x.kind, x.legs])).toEqual([["b2b_sim", [{ account: "Acme (USDC)", asset: "USDC", amount: -2.5 }, { account: "Toolwise (USDC)", asset: "USDC", amount: 2.5 }]]]);
    expect(f.market?.decision).toMatch(/^Buy "AI tool reviews for solo founders" from Toolwise for \$2\.50 instead of ordering the research from the swarm \(\$3\.00\)/);
    expect(f.market?.candidates).toEqual([
      expect.objectContaining({ company: "Toolwise", name: "AI tool reviews for solo founders", priceUsd: 2.5, verdict: "picked", why: expect.stringMatching(/key terms/) }),
      expect.objectContaining({ company: "Acme", verdict: "own" }),
    ]);
    expect(f.market?.bought).toMatchObject({ company: "Toolwise", usd: 2.5, sim: true });
    expect(f.market?.query).toContain("founder");
    // the public sees the decision and the products, not the brief's terms or the file
    const pub = F.flight(w.buyer, t, await input(false));
    expect(pub.market?.query).toBeUndefined();
    expect(pub.market?.candidates[0]?.why).toBeUndefined();
    expect(pub.market?.candidates[1]?.why).toBe("made by this company");
    expect(JSON.stringify(pub)).not.toContain("http://dl/");
  });

  it("records the search and its decision when nothing fits, then orders from the swarm", async () => {
    const w = world();
    // no USDC earned yet: the relevant product is shown, and not bought
    const t = (await runShift(w.buyer, w.deps))!;
    expect(t.status).toBe("building");
    const f = F.flight(w.buyer, t, { imdUsd: 6, owner: true, live: false, ledger: await w.ledger.store.list("co:c1:"), sales: [], visits: [] });
    expect(f.trace[0]!.children.map((s) => s.name)).toEqual(["The CEO decides", "Search the NIGHTSHIFT market", "IMD's free check", "Quote, pay, submit", "The swarm builds"]);
    expect(f.market?.candidates.find((x) => x.company === "Toolwise")?.verdict).toBe("funds");
    expect(f.market?.decision).toMatch(/none this company may buy \(the company holds \$0\.00 USDC\): ordering from the swarm/);
    expect(f.market?.bought).toBeNull();
    expect(w.seller.products[0]!.b2bSales ?? 0).toBe(0);
  });
});
