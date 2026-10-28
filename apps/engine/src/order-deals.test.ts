import { describe, expect, it } from "vitest";
import { DEAL_COINS, DEAL_FEE_BPS, DEAL_HOLDER_FEE_BPS, DEAL_MAX_FEE_BPS, DEALS_OBJECTIVE, DEALS_ORDER } from "./order-deals.js";
import { ORDERS } from "./swarm.js";

describe("Token Deals order", () => {
  it("fits IMD's limit and is on the /setup order list", () => {
    expect(DEALS_OBJECTIVE.length).toBeLessThanOrEqual(7895);
    expect(ORDERS.map((o) => o.key)).toContain(DEALS_ORDER.key);
  });

  it("sends every fee to the FeeSplitter, holders never pay more, and the cap holds", () => {
    expect(DEALS_OBJECTIVE).toContain("FeeSplitter 0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44 (fixed forever");
    expect(DEAL_HOLDER_FEE_BPS).toBeLessThanOrEqual(DEAL_FEE_BPS);
    expect(DEAL_FEE_BPS).toBeLessThanOrEqual(DEAL_MAX_FEE_BPS);
    for (const c of DEAL_COINS) expect(DEALS_OBJECTIVE).toContain(c.address);
  });
});
