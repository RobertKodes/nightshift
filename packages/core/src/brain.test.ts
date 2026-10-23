import { describe, expect, it } from "vitest";
import { SimImdPlane } from "@nightshift/imd";
import { Ledger } from "@nightshift/ledger";
import type { MarketDeps, MarketOffer } from "./market.js";
import { DEFAULT_POLICY } from "./policy.js";
import { type Brain, ownerBuy, runShift } from "./shift.js";
import type { Company } from "./types.js";

const OWNER = "0xaaaa00000000000000000000000000000000aaaa";
const OTHER = "0xbbbb00000000000000000000000000000000bbbb";

function company(policy: Partial<Company["policy"]> = {}): Company {
  return {
    id: "c1", slug: "acme", name: "Acme", idea: "weekly planners for night-shift nurses", mission: "Plan a week of night shifts in ten minutes.", audience: "night-shift nurses",
    createdAt: 0, owner: OWNER, wallet: "0x0000000000000000000000000000000000000001", policy: { ...DEFAULT_POLICY, ...policy }, status: "active", cycle: 0, nextShiftAt: null,
    site: { url: "http://site", jobId: "j" }, marketing: [],
    products: [{ id: "own", name: "Acme Planner", kind: "template", pitch: "x", priceUsdc: 9_000_000n, status: "live", deliverableUrl: "f", taskId: "t0", sales: 0, revenueUsdc: 0n, createdAt: 0 }],
    tasks: [], journal: [],
  };
}

const offer = (usd: number, owner = OTHER): MarketOffer => ({
  seller: { id: "s1", name: "Shiftwise", slug: "shiftwise", owner, sim: false },
  product: { id: "p-rota", name: "Night rota dataset", kind: "dataset", pitch: "Real rota patterns for night nurses.", priceUsdc: BigInt(Math.round(usd * 1e6)) },
  preview: null,
});

function market(offers: MarketOffer[]): MarketDeps & { paid: string[] } {
  const paid: string[] = [];
  return {
    paid,
    offers: async () => offers,
    usdc: async () => 20_000_000n,
    pay: async (_b, pick, t) => { paid.push(pick.productId); return { url: `http://download/${pick.productId}`, ledgerId: `b2b:${t.id}`, tx: null, sim: true }; },
  };
}

const answer = (model: string, move: object) => ({
  chat: async () => ({ message: { role: "assistant" as const, content: JSON.stringify(move) }, finishReason: "stop", requestedModel: model, servedModel: model, provider: null, usage: { prompt: 1, completion: 1 }, costUsd: model === "strong" ? 0.02 : 0, costSource: "provider" as const, latencyMs: 1, attempts: 1, swap: null }),
});
const REPRICE = { kind: "reprice", title: "Raise Acme Planner to $12", why: "It sells at $9 with room above.", brief: "", productId: "own", priceUsd: 12 };

function deps(extra: Record<string, unknown> = {}) {
  const imd = new SimImdPlane({ jobMs: 10_000, deliver: async () => ({ siteUrl: null, repoUrl: null, files: {}, summary: null }) });
  return {
    imd, ledger: new Ledger(), llm: null, model: "free", imdUsd: () => 6,
    stats: () => ({ visits7d: 0, sales7d: 0, revenue7dUsd: 0, imdUsd: 6 }),
    buyBase: () => "http://buy/acme", emit: () => {}, ...extra,
  };
}

describe("the CEO's strong brain, paid by its company", () => {
  it("thinks with the model the company pays for, and keeps what it paid on the shift", async () => {
    let freeAsked = 0;
    const free = { chat: async () => { freeAsked++; return answer("free", REPRICE).chat(); } };
    const brain: Brain = { llm: answer("strong", REPRICE), model: "strong", paid: () => ({ usdc: 20_000n, tx: "0xabc", via: "blockrun.ai" }) };
    const t = await runShift(company(), deps({ llm: free, brain: async () => brain }) as never);
    expect(t?.mind).toMatchObject({ by: "model", model: "strong", paid: { usdc: 20_000n, tx: "0xabc" } });
    expect(freeAsked).toBe(0);
  });

  it("falls back to the free model when the paid answer fails, and says so", async () => {
    const c = company();
    const brain: Brain = { llm: { chat: async () => { throw new Error("the AI gateway answered 500 after payment"); } }, model: "strong", paid: () => null };
    const t = await runShift(c, deps({ llm: answer("free", REPRICE), brain: async () => brain }) as never);
    expect(t?.mind).toMatchObject({ by: "model", model: "free" });
    expect(t?.mind?.paid).toBeUndefined();
    expect(c.journal.some((j) => /strong model could not answer/.test(j.text))).toBe(true);
  });

  it("thinks with the free model when the company cannot pay today", async () => {
    const t = await runShift(company(), deps({ llm: answer("free", REPRICE), brain: async () => null }) as never);
    expect(t?.mind).toMatchObject({ by: "model", model: "free" });
  });
});

describe("the owner's Buy button in the CEO chat", () => {
  it("buys from another company: the press is the approval, so the per-buy limit gives way", async () => {
    const m = market([offer(4)]);
    const c = company({ marketMaxUsd: 3 });
    const t = await ownerBuy(c, deps({ market: m }) as never, "s1", "p-rota");
    expect(t.status).toBe("done");
    expect(m.paid).toEqual(["p-rota"]);
    expect(c.b2b?.bought).toMatchObject([{ productId: "p-rota", usdc: 4_000_000n }]);
  });

  it("never buys from the owner's own companies, nor past the day's market limit", async () => {
    await expect(ownerBuy(company(), deps({ market: market([offer(2, OWNER)]) }) as never, "s1", "p-rota")).rejects.toThrow(/same owner/);
    await expect(ownerBuy(company({ marketDailyUsd: 5 }), deps({ market: market([offer(6)]) }) as never, "s1", "p-rota")).rejects.toThrow(/over the \$5\.00 a day/);
    await expect(ownerBuy(company(), deps({ market: market([]) }) as never, "s1", "p-rota")).rejects.toThrow(/no longer on sale/);
  });
});
