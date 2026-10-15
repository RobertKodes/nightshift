import { describe, expect, it } from "vitest";
import { SimImdPlane } from "@nightshift/imd";
import { Ledger } from "@nightshift/ledger";
import { DEFAULT_POLICY } from "./policy.js";
import { advance, approve, runShift } from "./shift.js";
import type { Company } from "./types.js";

function company(policy = {}): Company {
  return {
    id: "c1", slug: "acme", name: "Acme", idea: "weekly AI tool reviews for solo founders who have no time to test tools",
    mission: "Save solo founders ten hours a week on picking AI tools.", audience: "solo founders",
    createdAt: 0, owner: null, wallet: "0x0000000000000000000000000000000000000001",
    policy: { ...DEFAULT_POLICY, ...policy }, status: "active", cycle: 0, nextShiftAt: null,
    site: null, products: [], tasks: [], journal: [], marketing: [],
  };
}

function deps(now: { t: number }, imd = new SimImdPlane({ jobMs: 10_000, now: () => now.t, deliver: async (id) => ({ siteUrl: `http://sites/${id}`, repoUrl: null, files: { report: `http://files/${id}.md` }, summary: null }) })) {
  return {
    imd, ledger: new Ledger(), llm: null, model: "none", imdUsd: () => 6,
    stats: () => ({ visits7d: 0, sales7d: 0, revenue7dUsd: 0, imdUsd: 6 }),
    buyBase: () => "http://buy/acme", emit: () => {}, now: () => now.t,
  };
}

describe("the autonomous company", () => {
  it("ships a product first, then a site, buying each from the swarm and recording the spend", async () => {
    const now = { t: 1_000_000 };
    const d = deps(now);
    const c = company();
    const t1 = await runShift(c, d);
    expect(t1?.kind).toBe("build_product");
    expect(t1?.status).toBe("building");
    expect(c.products[0]?.status).toBe("building");
    expect(await d.ledger.balance("co:c1:imd", "IMD")).toBe(-500000000000000000n);

    // A second shift while work is building starts nothing new.
    expect(await runShift(c, d)).toBeNull();

    now.t += 20_000;
    await advance(c, d); // admission → job id
    await advance(c, d); // completed → delivered
    expect(c.products[0]?.status).toBe("live");
    expect(c.products[0]?.deliverableUrl).toContain("http://");

    const t2 = await runShift(c, d);
    expect(t2?.kind).toBe("build_site");
    now.t += 20_000;
    await advance(c, d);
    await advance(c, d);
    expect(c.site?.url).toContain("http://sites/");
  });

  it("holds a purchase over the owner's limit until approved, and spends nothing before", async () => {
    const now = { t: 1_000_000 };
    const d = deps(now);
    const c = company({ approvalOverUsd: 1 }); // 0.5 IMD × $6 = $3 > $1
    const t = await runShift(c, d);
    expect(t?.status).toBe("awaiting_approval");
    expect(await d.ledger.balance("co:c1:imd", "IMD")).toBe(0n);
    await approve(c, t!.id, d);
    expect(t?.status).toBe("building");
  });

  it("refuses to break the daily budget", async () => {
    const now = { t: 1_000_000 };
    const c = company({ dailyBudgetUsd: 2 });
    const t = await runShift(c, deps(now));
    expect(t?.status).toBe("failed");
    expect(t?.error).toMatch(/budget/);
    expect(c.products).toHaveLength(0);
  });
});

import { found } from "./planner.js";
describe("founding without a model", () => {
  it("finds the audience and a usable name in the idea", async () => {
    const f = await found("Weekly reviews of new AI tools for solo founders who have no time to test them", null, "x");
    expect(f.audience).toBe("solo founders");
    expect(f.name).toBe("ReviewsTools");
    expect(f.mission.endsWith(".")).toBe(true);
  });
});

describe("the saver inside a company", () => {
  it("reuses published research instead of paying, and never buys the same body twice", async () => {
    const now = { t: 1_000_000 };
    const c = company();
    c.products.push({ id: "p", name: "P", kind: "report", pitch: "x", priceUsdc: 1n, status: "live", deliverableUrl: null, taskId: "t", sales: 9, revenueUsdc: 0n, createdAt: Date.now() });
    c.site = { url: "http://s", jobId: "j" };
    c.marketing.push({ at: Date.now(), channel: "x", text: "hi", status: "drafted" });
    c.products[0]!.sales = 0;
    const d = { ...deps(now), findExisting: async () => ({ title: "Existing research", url: "https://explorer.imd.fun/jobs/abc" }) };
    const t = await runShift(c, d);
    expect(t?.kind).toBe("research");
    expect(t?.status).toBe("done");
    expect(t?.costImd).toBe(0n);
    expect(await d.ledger.balance("co:c1:imd", "IMD")).toBe(0n);

    const d2 = deps(now);
    const t2 = await runShift(c, d2);
    expect(t2?.kind).toBe("research");
    expect(t2?.status).toBe("building");
    const t3 = await runShift(c, d2); // same playbook move, same body
    expect(t3).toBeNull(); // still building: no second purchase
  });
});
