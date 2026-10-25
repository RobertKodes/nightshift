import { describe, expect, it } from "vitest";
import type { Company } from "@nightshift/core";
import { payerClass, proof } from "./proof.js";
import type { Metrics } from "./store.js";

const co = (id: string, owner: string, wallet: string, products: { id: string; name: string }[] = []) =>
  ({ id, name: id, owner, wallet, products: products.map((p) => ({ ...p, kind: "report", pitch: "", priceUsdc: 1_000_000n, status: "live", sales: 0, revenueUsdc: 0n, createdAt: 0 })) }) as unknown as Company;
const sale = (payer: string, usdc: number, at: number, sim = false, productId = "p1") => ({ at, productId, usdc: String(usdc * 1e6), payer, tx: `0x${String(at).padStart(64, "0")}`, sim });

const OWNER = "0x1111111111111111111111111111111111111111";
const OTHER_OWNER = "0x2222222222222222222222222222222222222222";
const CUST = "0x3333333333333333333333333333333333333333";
const CUST2 = "0x4444444444444444444444444444444444444444";
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const usage = { days: [{ day: "2026-10-25", mcpSessions: 5, mcpCalls: 2, mcpCallers: 3, views: 10, visitors: 4 }], mcp: { sessions: 5, calls: 2, callerDays: 3, clients: [{ name: "rokmcp-collector", count: 3 }, { name: "claude-code", count: 2 }], tools: [] }, web: { views: 10, visitorDays: 4, pages: [], from: [] } };

describe("proof", () => {
  it("counts only outside wallets as customers and keeps owners, NIGHTSHIFT wallets, other companies and simulations out", () => {
    const a = co("alpha", OWNER, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", [{ id: "p1", name: "Guide" }]);
    const b = co("beta", OTHER_OWNER, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", [{ id: "p1", name: "Tool" }]);
    const metrics: Record<string, Metrics> = {
      alpha: { visits: [], sales: [sale(CUST, 9, 1), sale(CUST, 9, 2), sale(OWNER, 9, 3), sale(DEV, 1, 4), sale(OTHER_OWNER, 2, 5), sale("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", 3, 6), sale(CUST2, 4, 7, true)] },
      beta: { visits: [], sales: [sale(CUST2, 5, 8)] },
    };
    const r = proof({ companies: [a, b], metrics: (id) => metrics[id]!, ledger: [], usage, burns: { shift: 0, imd: 0 }, imdUsd: 4, splitter: null, houseId: "house", now: Date.parse("2026-10-25T12:00:00Z") });
    expect(r.payments.customer).toMatchObject({ wallets: 2, payments: 3, revenueUsd: 23, repeatWallets: 1 });
    expect(r.payments.excluded).toEqual({ internal: 1, owner: 2, b2b: 1, test: 1 });
    expect(r.payments.latest[0]!.wallet).toBe("0x4444…4444");
    expect(r.agents).toMatchObject({ mcpSessions: 5, toolCalls: 2, probeSessions: 3 });
    expect(JSON.stringify(r)).not.toMatch(/"[a-zA-Z]*profit[a-zA-Z]*":/i);
  });

  it("sums known costs and platform fees from the ledger, with transaction links", () => {
    const fee = "0x" + "ab".repeat(32);
    const ledger = [
      { id: "imd:1", at: new Date(), kind: "imd_order", postings: [{ account: "co:a:imd", asset: "IMD", amount: -500000000000000000n }, { account: "ext:imd-swarm", asset: "IMD", amount: 500000000000000000n }] },
      { id: `withdraw-fee:${fee}`, at: new Date(), kind: "withdrawal", postings: [{ account: "co:a:usdc", asset: "USDC", amount: -150000n }, { account: "ext:platform:fee", asset: "USDC", amount: 150000n }] },
      { id: "sale:0x1", at: new Date(), kind: "sale", meta: { settledBy: "cdp" }, postings: [] },
    ];
    const r = proof({ companies: [], metrics: () => ({ visits: [], sales: [] }), ledger: ledger as never, usage, burns: { shift: 1, imd: 2 }, imdUsd: 4, splitter: "0x1234567890123456789012345678901234567890", houseId: "house" });
    expect(r.knownCosts).toMatchObject({ swarmImd: 0.5, swarmUsdAtTodaysPrice: 2 });
    expect(r.fees.platformUsd).toBe(0.15);
    expect(r.fees.platformFees[0]!.tx).toBe(`https://basescan.org/tx/${fee}`);
    expect(r.payments.settledBy).toEqual({ cdp: 1 });
  });

  it("classes a payer the same way everywhere", () => {
    const a = co("alpha", OWNER, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(payerClass(CUST, a, [a], false)).toBe("customer");
    expect(payerClass(CUST, a, [a], true)).toBe("test");
    expect(payerClass(OWNER.toUpperCase().replace("0X", "0x"), a, [a], false)).toBe("owner");
  });
});
