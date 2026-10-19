import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Vault } from "./vault.js";

const calls = vi.hoisted(() => ({ simulated: [] as string[], reserve: "fail" as "fail" | bigint }));
vi.mock("./chain.js", () => ({
  eth: {
    getBalance: async ({ address }: { address: string }) => (address.toLowerCase() === "0x00000000000000000000000000000000000000cc" ? 4n * 10n ** 15n : 10n ** 18n),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "reserve") { if (calls.reserve === "fail") throw new Error("HTTP request failed: 429"); return calls.reserve; }
      if (functionName === "keeper") return "0x0000000000000000000000000000000000000001";
      if (functionName === "balanceOf") return 0n;
      return 0n;
    },
    simulateContract: async ({ functionName }: { functionName: string }) => { calls.simulated.push(functionName); return { request: {}, result: [10n ** 21n, 0n] }; },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  },
  ethWallet: () => ({ writeContract: async () => "0xhash" }),
}));

const { runKeeper } = await import("./keeper.js");
const C = { splitter: "0x00000000000000000000000000000000000000cc", token: "0x00000000000000000000000000000000000000dd" };

describe("the keeper's burn", () => {
  it("burns nothing when the reserve view does not answer: never the splitter's whole balance", async () => {
    calls.simulated = []; calls.reserve = "fail";
    const run = await runKeeper(new Vault(mkdtempSync(join(tmpdir(), "ns-keeper-")), "s"), C);
    expect(calls.simulated).not.toContain("burnReserve");
    expect(calls.simulated).not.toContain("quoteExactInputSingle");
    expect(run.skipped.join("\n")).toMatch(/reserve unknown/);
  });

  it("burns the reserve the view reports", async () => {
    calls.simulated = []; calls.reserve = 2n * 10n ** 16n;
    await runKeeper(new Vault(mkdtempSync(join(tmpdir(), "ns-keeper-")), "s"), C);
    expect(calls.simulated).toContain("burnReserve");
  });
});
