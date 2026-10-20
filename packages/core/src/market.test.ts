import { describe, expect, it } from "vitest";
import { SimImdPlane } from "@nightshift/imd";
import { Ledger } from "@nightshift/ledger";
import type { LlmClient } from "@nightshift/llm";
import { type MarketDeps, type MarketOffer, RELEVANT, keywordScore, relevantByKeywords } from "./market.js";
import { DEFAULT_POLICY, validatePolicy } from "./policy.js";
import { approve, commission, finishMarketBuy, reject, runShift } from "./shift.js";
import type { Company, MarketPick, Task } from "./types.js";

const OWNER = "0xaaaa00000000000000000000000000000000aaaa";
const OTHER = "0xbbbb00000000000000000000000000000000bbbb";

/** A company whose playbook CEO picks research next: a product on sale, a site, a fresh post, few visits. */
function company(policy: Partial<Company["policy"]> = {}, extra: Partial<Company> = {}): Company {
  return {
    id: "c1", slug: "acme", name: "Acme", idea: "weekly AI tool reviews for solo founders who have no time to test tools",
    mission: "Save solo founders ten hours a week on picking AI tools.", audience: "solo founders",
    createdAt: 0, owner: OWNER, wallet: "0x0000000000000000000000000000000000000001",
    policy: { ...DEFAULT_POLICY, ...policy }, status: "active", cycle: 0, nextShiftAt: null,
    site: { url: "http://site", jobId: "j" }, marketing: [{ at: Date.now(), channel: "x", text: "hi", status: "drafted" }],
    products: [{ id: "own", name: "Acme Playbook", kind: "report", pitch: "x", priceUsdc: 9_000_000n, status: "live", deliverableUrl: "f", taskId: "t0", sales: 0, revenueUsdc: 0n, createdAt: Date.now() - 3600_000 }],
    tasks: [], journal: [], ...extra,
  };
}

const offer = (id: string, name: string, pitch: string, usd: number, seller: Partial<MarketOffer["seller"]> = {}, outline: string[] = []): MarketOffer => ({
  seller: { id: "s1", name: "Toolwise", slug: "toolwise", owner: OTHER, sim: false, ...seller },
  product: { id, name, kind: "report", pitch, priceUsdc: BigInt(Math.round(usd * 1e6)) },
  preview: { title: name, outline, opening: "" },
});
const RELEVANT_OFFER = offer("p-ai", "AI tool reviews for solo founders", "We test 40 AI tools so solo founders do not have to.", 2.5, {}, ["The shortlist", "How each tool was tested", "Reviews by job"]);
const IRRELEVANT = offer("p-nurse", "Time management for night nurses", "Shift planning that works.", 1);

function market(offers: MarketOffer[], usdcHeld = 10_000_000n, pay?: (pick: MarketPick, t: Task) => Promise<{ url: string; ledgerId: string; tx: string | null; sim: boolean }>) {
  const calls: { pick: MarketPick; t: Task }[] = [];
  const m: MarketDeps & { calls: typeof calls } = {
    calls,
    offers: async () => offers,
    usdc: async () => usdcHeld,
    pay: async (_b, pick, t) => {
      calls.push({ pick, t });
      return pay ? pay(pick, t) : { url: `http://download/${pick.productId}`, ledgerId: `b2b:${t.id}`, tx: null, sim: true };
    },
  };
  return m;
}

function deps(m: MarketDeps, extra: Record<string, unknown> = {}) {
  const now = { t: Date.now() };
  // 0.5 IMD at $6: the swarm order costs $3.00
  const imd = new SimImdPlane({ jobMs: 10_000, now: () => now.t, deliver: async (id) => ({ siteUrl: null, repoUrl: null, files: { report: `http://files/${id}.md` }, summary: null }) });
  return {
    imd, ledger: new Ledger(), llm: null, model: "none", imdUsd: () => 6,
    stats: () => ({ visits7d: 0, sales7d: 0, revenue7dUsd: 0, imdUsd: 6 }),
    buyBase: () => "http://buy/acme", emit: () => {}, now: () => now.t, market: m, ...extra,
  };
}

describe("buy from the market first", () => {
  it("buys a relevant product that costs less than the swarm, and uses it as the shift's research", async () => {
    const m = market([IRRELEVANT, RELEVANT_OFFER]);
    const d = deps(m);
    const c = company();
    const t = await runShift(c, d);
    expect(t?.kind).toBe("research");
    expect(t?.status).toBe("done");
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.pick.productId).toBe("p-ai");
    expect(t?.costImd).toBe(0n);
    expect(t?.costUsdc).toBe(2_500_000n);
    expect(await d.ledger.balance("co:c1:imd", "IMD")).toBe(0n); // no swarm order
    expect(t?.result?.files?.research).toBe("http://download/p-ai");
    expect(t?.market?.swarmUsd).toBeCloseTo(3);
    expect(t?.market?.by).toBe("keywords");
    expect(t?.market?.candidates.map((x) => [x.productId, x.verdict])).toEqual([["p-ai", "picked"], ["p-nurse", "irrelevant"]]);
    expect(t?.market?.decision).toMatch(/Buy "AI tool reviews for solo founders" from Toolwise for \$2\.50/);
    expect(c.b2b?.bought).toMatchObject([{ productId: "p-ai", usdc: 2_500_000n, with: { id: "s1", name: "Toolwise" }, taskId: t!.id }]);
    expect(c.journal.some((j) => j.kind === "result" && /Market first: bought "AI tool reviews/.test(j.text))).toBe(true);
    // the bought research feeds the next product exactly like research the swarm delivered
    const next = await runShift(c, d);
    expect(next?.kind).toBe("build_product");
    expect(next?.imd?.input).toMatchObject({ objective: expect.stringContaining("http://download/p-ai") });
  });

  it("skips products that are not relevant enough or not cheaper than the swarm, and orders from the swarm", async () => {
    const pricier = offer("p-dear", "AI tool reviews for solo founders, deluxe", "Every AI tool tested for solo founders.", 3.2, { id: "s2", name: "Dearco", slug: "dearco" });
    const m = market([IRRELEVANT, pricier]);
    const d = deps(m);
    const t = await runShift(company({ marketMaxUsd: 10 }), d);
    expect(m.calls).toHaveLength(0);
    expect(t?.status).toBe("building");
    expect(t?.costImd).toBe(500_000_000_000_000_000n);
    expect(t?.costUsdc ?? 0n).toBe(0n);
    expect(Object.fromEntries(t!.market!.candidates.map((x) => [x.productId, x.verdict]))).toEqual({ "p-dear": "pricier", "p-nurse": "irrelevant" });
    expect(t?.market?.decision).toMatch(/none this company may buy .*not cheaper than the swarm \(\$3\.00\)/);
  });

  it("never buys from a company with the same owner, its own product, an unowned company or one it already owns", async () => {
    const offers = [
      { ...RELEVANT_OFFER, seller: { ...RELEVANT_OFFER.seller, id: "s-mine", owner: OWNER.toUpperCase().replace("0X", "0x") } },
      { ...RELEVANT_OFFER, product: { ...RELEVANT_OFFER.product, id: "own" }, seller: { ...RELEVANT_OFFER.seller, id: "c1", owner: OWNER } },
      { ...RELEVANT_OFFER, product: { ...RELEVANT_OFFER.product, id: "p-anon" }, seller: { ...RELEVANT_OFFER.seller, id: "s-anon", owner: null } },
      { ...RELEVANT_OFFER, product: { ...RELEVANT_OFFER.product, id: "p-had" } },
    ];
    const c = company({}, { b2b: { bought: [{ at: 1, ledgerId: "b2b:x", taskId: "x", productId: "p-had", product: "AI", kind: "report", usdc: 1n, with: { id: "s1", name: "Toolwise", slug: "toolwise" }, tx: null, sim: true }], sold: [] } });
    const m = market(offers);
    const t = await runShift(c, deps(m));
    expect(m.calls).toHaveLength(0);
    expect(t?.status).toBe("building");
    const v = Object.fromEntries(t!.market!.candidates.map((x) => [`${x.sellerId}/${x.productId}`, x.verdict]));
    expect(v).toEqual({ "s-mine/p-ai": "same_owner", "c1/own": "own", "s-anon/p-anon": "same_owner", "s1/p-had": "owned" });
    // a company with no owner on record never buys either
    const anon = company({}, { owner: null });
    const m2 = market([RELEVANT_OFFER]);
    await runShift(anon, deps(m2));
    expect(m2.calls).toHaveLength(0);
  });

  it("keeps to the owner's market limits: per buy, per day, the USDC it holds, and off", async () => {
    const run = async (c: Company, held = 10_000_000n) => { const m = market([RELEVANT_OFFER], held); const t = await runShift(c, deps(m)); return { m, t: t! }; };
    let r = await run(company({ marketMaxUsd: 2 }));
    expect([r.m.calls.length, r.t.market?.candidates[0]?.verdict]).toEqual([0, "over_max"]);
    const spent = company({ marketDailyUsd: 5 });
    spent.tasks.push({ id: "old", cycle: 0, kind: "research", title: "r", why: "", status: "done", stepsDone: 0, stepsTotal: 0, activity: null, costImd: 0n, costUsdc: 3_000_000n, result: null, error: null, createdAt: Date.now() - 7200_000, updatedAt: Date.now() - 7200_000 });
    r = await run(spent);
    expect([r.m.calls.length, r.t.market?.candidates[0]?.verdict]).toEqual([0, "cap"]);
    r = await run(company(), 1_000_000n);
    expect([r.m.calls.length, r.t.market?.candidates[0]?.verdict]).toEqual([0, "funds"]);
    r = await run(company(), 0n); // no USDC: market buying is off in effect
    expect(r.m.calls.length).toBe(0);
    expect(r.t.market?.decision).toMatch(/holds \$0\.00 USDC/);
    r = await run(company({ marketBuy: false }));
    expect(r.m.calls.length).toBe(0);
    expect(r.t.market?.decision).toMatch(/off for this company/);
    expect(r.t.status).toBe("building");
    // and the limits are validated like the rest of the policy
    expect(validatePolicy({ marketDailyUsd: 5, marketMaxUsd: 3 })).toMatchObject({ marketBuy: true, marketDailyUsd: 5, marketMaxUsd: 3 });
    expect(() => validatePolicy({ marketMaxUsd: -1 })).toThrow(/marketMaxUsd/);
  });

  it("waits for the owner above the approval limit, buys once on approval, and spends nothing on a no", async () => {
    const m = market([RELEVANT_OFFER]);
    const d = deps(m);
    const c = company({ approvalOverUsd: 2 });
    const t = (await runShift(c, d))!;
    expect(t.status).toBe("awaiting_approval");
    expect(t.activity).toMatch(/\$2\.50 on the market is over the \$2 you approve by hand/);
    expect(m.calls).toHaveLength(0);
    expect(c.journal.at(-1)?.text).toMatch(/^Waiting for your approval: buy "AI tool reviews/);
    // two approvals at once (a double click, the desk and Telegram): one purchase
    const both = await Promise.allSettled([approve(c, t.id, d), approve(c, t.id, d)]);
    expect(both.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(m.calls).toHaveLength(1);
    expect(t.status).toBe("done");
    expect(c.b2b?.bought).toHaveLength(1);

    const c2 = company({ approvalOverUsd: 2 });
    const m2 = market([RELEVANT_OFFER]);
    const t2 = (await runShift(c2, deps(m2)))!;
    reject(c2, t2.id, deps(m2));
    expect([t2.status, t2.costUsdc ?? 0n, m2.calls.length]).toEqual(["rejected", 0n, 0]);
  });

  it("buys without the wait when the owner orders the research, and never buys the same research twice", async () => {
    const m = market([RELEVANT_OFFER]);
    const d = deps(m);
    const c = company({ approvalOverUsd: 0 });
    const t = await commission(c, d, { kind: "research", title: "Research: AI tools", why: "Ordered by the owner.", brief: "Which AI tools do solo founders pay for, with reviews and tests?" });
    expect(t.status).toBe("done");
    expect(m.calls).toHaveLength(1);
    // the same order again: the saver refuses it, nothing is paid twice
    await expect(commission(c, d, { kind: "research", title: "Research: AI tools", why: "Ordered by the owner.", brief: "Which AI tools do solo founders pay for, with reviews and tests?" })).rejects.toThrow(/already bought/);
    expect(m.calls).toHaveLength(1);
  });

  it("orders from the swarm when the purchase does not go through, with nothing paid", async () => {
    const m = market([RELEVANT_OFFER], 10_000_000n, async () => { throw new Error("the product is no longer on sale"); });
    const d = deps(m);
    const c = company();
    const t = (await runShift(c, d))!;
    expect(m.calls).toHaveLength(1);
    expect(t.status).toBe("building");
    expect(t.costUsdc).toBe(0n);
    expect(t.costImd).toBe(500_000_000_000_000_000n);
    expect(t.market?.pick).toBeUndefined();
    expect(t.market?.decision).toMatch(/did not go through \(the product is no longer on sale\)/);
    expect(c.journal.some((j) => j.kind === "warning" && /Nothing was paid/.test(j.text))).toBe(true);
  });

  it("follows a payment sent on chain instead of paying again, and finishes it once it lands", async () => {
    const m = market([RELEVANT_OFFER], 10_000_000n, async () => { throw Object.assign(new Error("waiting for Base"), { pending: "0xbuyer:0xnonce" }); });
    const d = deps(m);
    const c = company();
    const t = (await runShift(c, d))!;
    expect([t.status, t.market?.pending, t.costUsdc]).toEqual(["building", "0xbuyer:0xnonce", 2_500_000n]);
    // nothing else starts while it is in flight
    expect(await runShift(c, d)).toBeNull();
    finishMarketBuy(c, t, { url: "http://download/p-ai", ledgerId: `b2b:${t.id}`, tx: "0xtx", sim: false }, d);
    finishMarketBuy(c, t, { url: "http://other", ledgerId: `b2b:${t.id}`, tx: "0xtx", sim: false }, d);
    expect([t.status, t.market?.pending, t.market?.paid?.tx, t.result?.files?.research]).toEqual(["done", undefined, "0xtx", "http://download/p-ai"]);
    expect(c.b2b?.bought).toHaveLength(1);
  });

  it("lets the CEO's model score relevance when a key is set, and falls back to the keyword score", async () => {
    const llm = (content: string) => ({ chat: async () => ({ message: { role: "assistant", content }, costUsd: 0.0004, servedModel: "m" }) }) as unknown as LlmClient;
    // the CEO's own move comes from the playbook (its answer is not a move); the scores come from the model
    const close = offer("p-close", "Solo founder tool stack", "The tools solo founders run on.", 2, { id: "s3", name: "Stackco", slug: "stackco" });
    let m = market([RELEVANT_OFFER, close]);
    let t = (await runShift(company(), deps(m, { llm: llm('{"scores":[{"i":0,"score":0.4,"why":"same topic, other question"},{"i":1,"score":0.9,"why":"answers the brief"}]}') })))!;
    expect(t.market?.by).toBe("model");
    expect(t.market?.threshold).toBe(RELEVANT.model);
    expect(t.market?.costUsd).toBeCloseTo(0.0004);
    expect(m.calls[0]?.pick.productId).toBe("p-close");
    expect(t.market?.candidates.find((x) => x.productId === "p-close")).toMatchObject({ verdict: "picked", score: 0.9, why: "answers the brief" });
    m = market([RELEVANT_OFFER]);
    t = (await runShift(company(), deps(m, { llm: llm("not json") })))!;
    expect(t.market?.by).toBe("keywords");
    expect(t.market?.fallback).toMatch(/keyword score decided/);
    expect(m.calls[0]?.pick.productId).toBe("p-ai");
  });

  it("scores relevance from the free preview with a clear threshold", () => {
    const brief = 'What do solo founders pay for today around "weekly AI tool reviews for solo founders who have no time to test tools"? List five products with evidence of demand, price points and who sells them.';
    const hit = keywordScore(brief, RELEVANT_OFFER);
    expect(hit.shared.sort()).toEqual(["founder", "review", "solo", "test", "tool"]);
    expect(relevantByKeywords(hit)).toBe(true);
    const miss = keywordScore(brief, IRRELEVANT);
    expect(miss.shared).toEqual(["time"]);
    expect(relevantByKeywords(miss)).toBe(false);
    // two shared terms of a short brief are not enough on their own
    expect(relevantByKeywords({ score: 0.5, shared: ["a", "b"], of: 4 })).toBe(false);
    expect(relevantByKeywords({ score: 1, shared: ["a", "b"], of: 2 })).toBe(true);
  });
});
