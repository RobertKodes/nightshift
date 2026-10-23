import { describe, expect, it } from "vitest";
import { type Company, DEFAULT_POLICY } from "@nightshift/core";
import { Ledger } from "@nightshift/ledger";
import { privateKeyToAccount } from "viem/accounts";
import { companyBrain, pickRequirement } from "./ceo-brain.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0xe9030014F5DAe217d0A152f02A043567b16c1aBf";
const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

const company = (policy: Partial<Company["policy"]> = {}): Company => ({
  id: "c1", slug: "acme", name: "Acme", idea: "x", mission: "x", audience: "x", createdAt: 0, owner: null, wallet: account.address,
  policy: { ...DEFAULT_POLICY, ...policy }, status: "active", cycle: 0, nextShiftAt: null, site: null, products: [], tasks: [], journal: [], marketing: [],
});
const accept = (o: Record<string, unknown> = {}) => ({ scheme: "exact", network: "eip155:8453", amount: "20000", asset: USDC, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" }, ...o });

/** A gateway that asks for `amount` and answers once paid. */
function gateway(amount = "20000") {
  const calls: { headers: Record<string, string> }[] = [];
  const fetch = (async (_url: string, init: { headers: Record<string, string> }) => {
    calls.push({ headers: init.headers });
    if (!init.headers["PAYMENT-SIGNATURE"]) return new Response(JSON.stringify({ x402Version: 2, accepts: [accept({ amount })], resource: { url: "https://blockrun.ai/api/v1/chat/completions" } }), { status: 402 });
    const settled = Buffer.from(JSON.stringify({ success: true, transaction: "0xfeed", network: "eip155:8453" })).toString("base64");
    return new Response(JSON.stringify({ model: "anthropic/claude-sonnet-5.5", choices: [{ message: { role: "assistant", content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 200 } }), { status: 200, headers: { "payment-response": settled } });
  }) as unknown as typeof fetch;
  return { fetch, calls };
}

const deps = (fetch: typeof globalThis.fetch, held = 5_000_000n, ledger = new Ledger()) => ({
  url: "https://blockrun.ai/api/v1/chat/completions", model: "anthropic/claude-sonnet-5.5", chainId: 8453, usdc: USDC as `0x${string}`,
  account: () => account, spendable: async () => held, ledger, live: true, fetch,
});

describe("the CEO's brain, paid by its own company", () => {
  it("signs only exact USDC on Base, to a real address, within the cap", () => {
    expect(pickRequirement({ accepts: [accept()] }, 8453, USDC, 100_000n)?.amount).toBe("20000");
    expect(pickRequirement({ accepts: [accept({ network: "eip155:1" })] }, 8453, USDC, 100_000n)).toBeNull();
    expect(pickRequirement({ accepts: [accept({ asset: "0x0000000000000000000000000000000000000001" })] }, 8453, USDC, 100_000n)).toBeNull();
    expect(pickRequirement({ accepts: [accept({ amount: "200000" })] }, 8453, USDC, 100_000n)).toBeNull();
    expect(pickRequirement({ accepts: [accept({ scheme: "upto" }), accept()] }, 8453, USDC, 100_000n)?.scheme).toBe("exact");
  });

  it("pays for one answer from the company's USDC and books it as the company's expense", async () => {
    const g = gateway();
    const ledger = new Ledger();
    const c = company();
    const brain = await companyBrain(deps(g.fetch, 5_000_000n, ledger))(c);
    const r = await brain!.llm.chat({ model: brain!.model, messages: [{ role: "user", content: "x" }] });
    expect(r.servedModel).toBe("anthropic/claude-sonnet-5.5");
    expect(r.costUsd).toBeCloseTo(0.02);
    expect(brain!.paid()).toEqual({ usdc: 20_000n, tx: "0xfeed", via: "blockrun.ai" });
    expect(await ledger.balance("co:c1:usdc", "USDC")).toBe(-20_000n);
    expect(c.aiSpend).toMatchObject([{ usdc: 20_000n, tx: "0xfeed" }]);
    expect(c.aiSpentUsdc).toBe(20_000n);
    // the signed payment went to the gateway's address, for the asked amount
    const sig = JSON.parse(Buffer.from(g.calls[1]!.headers["PAYMENT-SIGNATURE"]!, "base64").toString());
    expect(sig.payload.authorization).toMatchObject({ from: account.address, to: PAY_TO, value: "20000" });
  });

  it("refuses a call that asks for more than is left of the owner's AI limit", async () => {
    const c = company({ aiDailyUsd: 0.05 });
    c.aiSpend = [{ at: Date.now() - 1000, usdc: 30_000n, tx: null }];
    const brain = await companyBrain(deps(gateway("25000").fetch))(c);
    await expect(brain!.llm.chat({ model: "m", messages: [] })).rejects.toThrow(/more than this company may spend/);
    expect(c.aiSpend).toHaveLength(1);
  });

  it("has no brain without USDC, with the limit at 0, or for a demo company", async () => {
    const g = gateway();
    expect(await companyBrain(deps(g.fetch, 0n))(company())).toBeNull();
    expect(await companyBrain(deps(g.fetch))(company({ aiDailyUsd: 0 }))).toBeNull();
    expect(await companyBrain(deps(g.fetch))({ ...company(), sim: true })).toBeNull();
    expect(await companyBrain({ ...deps(g.fetch), live: false })(company())).toBeNull();
  });
});
