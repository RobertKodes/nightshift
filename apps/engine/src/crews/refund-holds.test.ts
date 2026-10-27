import { describe, expect, it } from "vitest";
import { SwarmRefill, type SwarmRefillDeps } from "./swarm-refill.js";
describe("Swarm refill liabilities", () => {
  it("holds full pending and unpaid refund receipts and never calls them earned revenue", () => {
    const rows = [
      { orderId: "pending", at: 0, units: "5000000", reserveUnits: "0", refundOwed: false, status: "running" },
      { orderId: "owed", at: 0, units: "3000000", reserveUnits: "0", refundOwed: true, status: "failed" },
      { orderId: "paid", at: 0, units: "2000000", reserveUnits: "0", refundOwed: true, status: "failed", refundPaid: { tx: "confirmed", at: 0 } },
    ];
    const refill = new SwarmRefill({ file: null, credits: () => rows, float: () => 0n, reserved: () => 0n } as SwarmRefillDeps);
    expect(refill.heldUsdc()).toBe(8_000_000n);
    expect(refill.status()).toMatchObject({ revenueUsd: 0, refundsOwedUsd: 3, unspentUsd: 0 });
  });
});
