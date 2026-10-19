import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Vault } from "./vault.js";

const calls = vi.hoisted(() => {
  // the burn's price memory goes to a temporary data dir, never the repo's
  process.env.DATA_DIR = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "ns-keeper-data-"));
  return { simulated: [] as string[], reserve: "fail" as "fail" | bigint, quote: 10n ** 21n, nonces: [] as number[], private: 0, pending: 7 };
});
vi.mock("viem", async (orig) => ({ ...(await orig<typeof import("viem")>()), createWalletClient: () => ({ writeContract: async ({ nonce }: { nonce: number }) => { calls.private++; calls.nonces.push(nonce); return "0xprot"; } }) }));
vi.mock("./chain.js", () => ({
  eth: {
    getBalance: async ({ address }: { address: string }) => (address.toLowerCase() === "0x00000000000000000000000000000000000000cc" ? 4n * 10n ** 15n : 10n ** 18n),
    getTransactionCount: async () => calls.pending,
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "reserve") { if (calls.reserve === "fail") throw new Error("HTTP request failed: 429"); return calls.reserve; }
      if (functionName === "keeper") return "0x0000000000000000000000000000000000000001";
      if (functionName === "balanceOf") return 0n;
      return 0n;
    },
    simulateContract: async ({ functionName }: { functionName: string }) => { calls.simulated.push(functionName); return { request: {}, result: [calls.quote, 0n] }; },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  },
  ethWallet: () => ({ writeContract: async ({ nonce }: { nonce: number }) => { await new Promise((r) => setTimeout(r, 5)); calls.nonces.push(nonce); return "0xhash"; } }),
}));

const { BURN_MAX_DRIFT_PCT, keeperAccount, keeperSend, lastBurnPrice, runKeeper } = await import("./keeper.js");
const C = { splitter: "0x00000000000000000000000000000000000000cc", token: "0x00000000000000000000000000000000000000dd" };
const vault = () => new Vault(mkdtempSync(join(tmpdir(), "ns-keeper-")), "s");
const now = { burnDelayMs: 0 };

describe("the keeper's burn", () => {
  it("burns nothing when the reserve view does not answer: never the splitter's whole balance", async () => {
    calls.simulated = []; calls.reserve = "fail";
    const run = await runKeeper(vault(), C, undefined, now);
    expect(calls.simulated).not.toContain("burnReserve");
    expect(calls.simulated).not.toContain("quoteExactInputSingle");
    expect(run.skipped.join("\n")).toMatch(/reserve unknown/);
  });

  it("burns the reserve the view reports, privately, and remembers the price it got", async () => {
    rmSync(join(process.env.DATA_DIR!, "keeper-burn.json"), { force: true });
    calls.simulated = []; calls.reserve = 2n * 10n ** 16n; calls.quote = 10n ** 21n; calls.private = 0;
    await runKeeper(vault(), C, undefined, now);
    expect(calls.simulated).toContain("burnReserve");
    expect(calls.private).toBe(1);
    // 1000 IMD for 0.02 ETH: 50 000 IMD per ETH
    expect(lastBurnPrice()?.imdPerEth).toBe((50_000n * 10n ** 18n).toString());
  });

  it(`refuses to burn at a quote more than ${BURN_MAX_DRIFT_PCT}% worse than the last burn's price`, async () => {
    calls.simulated = []; calls.reserve = 2n * 10n ** 16n; calls.quote = 8n * 10n ** 20n; // 20% fewer IMD per ETH
    const run = await runKeeper(vault(), C, undefined, now);
    expect(calls.simulated).not.toContain("burnReserve");
    expect(run.skipped.join("\n")).toMatch(/worse than the last burn/);
    calls.simulated = []; calls.quote = 9n * 10n ** 20n; // 10%: still within the bound
    await runKeeper(vault(), C, undefined, now);
    expect(calls.simulated).toContain("burnReserve");
  });
});

describe("the keeper's sends", () => {
  it("go one at a time, each with its own nonce, even when the node does not see the last one yet", async () => {
    calls.nonces = []; calls.pending = 40;
    const account = keeperAccount(vault());
    const { ethWallet } = await import("./chain.js");
    const one = () => keeperSend(account, (nonce) => ethWallet(account).writeContract({ nonce } as never));
    await Promise.all([one(), one(), one()]);
    expect(calls.nonces).toEqual([40, 41, 42]);
    // a failed send uses no nonce
    await expect(keeperSend(account, async () => { throw new Error("refused"); })).rejects.toThrow(/refused/);
    await one();
    expect(calls.nonces.at(-1)).toBe(43);
  });
});
