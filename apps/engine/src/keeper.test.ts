import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Vault } from "./vault.js";

const calls = vi.hoisted(() => {
  // the burn's price memory goes to a temporary data dir, never the repo's
  process.env.DATA_DIR = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "ns-keeper-data-"));
  return { simulated: [] as string[], reserve: "fail" as "fail" | bigint, quote: 10n ** 21n, nonces: [] as number[], private: 0, pending: 7,
    gasPrice: 10n ** 9n as bigint | "fail", units: {} as Record<string, bigint>, splitterEth: 4n * 10n ** 15n, keeperEth: 10n ** 18n };
});
vi.mock("viem", async (orig) => ({ ...(await orig<typeof import("viem")>()), createWalletClient: () => ({ writeContract: async ({ nonce }: { nonce: number }) => { calls.private++; calls.nonces.push(nonce); return "0xprot"; } }) }));
vi.mock("./chain.js", () => ({
  eth: {
    getBalance: async ({ address }: { address: string }) => (address.toLowerCase() === "0x00000000000000000000000000000000000000cc" ? calls.splitterEth : calls.keeperEth),
    getGasPrice: async () => { if (calls.gasPrice === "fail") throw new Error("HTTP request failed: 429"); return calls.gasPrice; },
    estimateContractGas: async ({ functionName }: { functionName: string }) => { const u = calls.units[functionName]; if (u === undefined) throw new Error("no estimate"); return u; },
    multicall: async () => { throw new Error("no multicall"); },
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

const { BURN_MAX_DRIFT_PCT, KEEPER_LOW, ONCE_A_DAY_MS, burnAt, keeperAccount, keeperBurnRate, keeperGasAlert, keeperSend, lastBurnPrice, runKeeper } = await import("./keeper.js");
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

const gwei = (n: number) => BigInt(Math.round(n * 1e9));
const milli = (n: number) => BigInt(Math.round(n * 1e15)); // n thousandths of an ETH

describe("the keeper's gas sense", () => {
  const burnOnly = () => { calls.simulated = []; calls.splitterEth = 0n; calls.keeperEth = 10n ** 18n; calls.private = 0; };
  // 50 000 IMD per ETH, like the last burn: inside the price guard
  const quoteFor = (reserve: bigint) => reserve * 50_000n;

  it("burns a small reserve when gas is cheap: 0.003 ETH at 0.065 gwei", async () => {
    rmSync(join(process.env.DATA_DIR!, "keeper-burn.json"), { force: true });
    burnOnly(); calls.reserve = milli(3); calls.quote = quoteFor(milli(3)); calls.gasPrice = gwei(0.065); calls.units = { burnReserve: 250_000n };
    await runKeeper(vault(), C, undefined, now);
    expect(calls.simulated).toContain("burnReserve");
    expect(calls.private).toBe(1);
    expect(lastBurnPrice()?.imd).toBe("150");
  });

  it("waits while the burn's gas is more than a 30th of the reserve", async () => {
    burnOnly(); calls.reserve = milli(3); calls.quote = quoteFor(milli(3)); calls.gasPrice = gwei(1); calls.units = { burnReserve: 250_000n }; // 0.00025 ETH of gas, x30 = 0.0075
    const run = await runKeeper(vault(), C, undefined, now);
    expect(calls.simulated).not.toContain("burnReserve");
    expect(run.skipped.join("\n")).toMatch(/under 30x its gas/);
  });

  it("never burns under 0.002 ETH, however cheap the gas, and does not even ask for a quote", async () => {
    burnOnly(); calls.reserve = milli(1.5); calls.gasPrice = gwei(0.01);
    const run = await runKeeper(vault(), C, undefined, now);
    expect(calls.simulated).not.toContain("quoteExactInputSingle");
    expect(run.skipped.join("\n")).toMatch(/too small/);
  });

  it("without a gas price keeps the old 0.01 ETH floor", async () => {
    burnOnly(); calls.reserve = milli(5); calls.quote = quoteFor(milli(5)); calls.gasPrice = "fail";
    await runKeeper(vault(), C, undefined, now);
    expect(calls.simulated).not.toContain("burnReserve");
    expect(burnAt(null)).toBe(10n ** 16n);
    expect(burnAt(gwei(0.065))).toBe(milli(2)); // the floor: 30x the gas is only 0.0006 ETH
    expect(burnAt(gwei(1))).toBe(30n * 320_000n * gwei(1));
  });

  it("splits a token at most once a day, and only when it is worth 50x the gas", async () => {
    const t0 = Date.now() + 10 * ONCE_A_DAY_MS;
    calls.reserve = milli(2); calls.splitterEth = milli(10); calls.gasPrice = gwei(1); calls.units = { distribute: 150_000n }; calls.quote = quoteFor(milli(2));
    calls.simulated = [];
    await runKeeper(vault(), C, undefined, { ...now, now: t0 }); // 0.008 new, gas 0.00015 x50 = 0.0075: worth it
    expect(calls.simulated.filter((f) => f === "distribute")).toHaveLength(1);
    calls.simulated = [];
    const again = await runKeeper(vault(), C, undefined, { ...now, now: t0 + 2 * 3_600_000 });
    expect(calls.simulated).not.toContain("distribute");
    expect(again.skipped.join("\n")).toMatch(/distribute ETH: split 2 h ago/);
    calls.simulated = []; calls.gasPrice = gwei(2); // gas 0.0003 x50 = 0.015 > 0.008
    const dear = await runKeeper(vault(), C, undefined, { ...now, now: t0 + ONCE_A_DAY_MS + 60_000 });
    expect(calls.simulated).not.toContain("distribute");
    expect(dear.skipped.join("\n")).toMatch(/under 50x its gas/);
    calls.simulated = []; calls.gasPrice = gwei(0.065);
    await runKeeper(vault(), C, undefined, { ...now, now: t0 + ONCE_A_DAY_MS + 120_000 });
    expect(calls.simulated.filter((f) => f === "distribute")).toHaveLength(1);
  });

  it("sends none of its own writes under 0.003 ETH: the rest pays staked-game payouts", async () => {
    calls.simulated = []; calls.keeperEth = milli(2.9); calls.reserve = milli(20); calls.quote = quoteFor(milli(20)); calls.gasPrice = gwei(0.065);
    const run = await runKeeper(vault(), C, undefined, now);
    expect(calls.simulated).toEqual([]);
    expect(run.line).toMatch(/kept for staked-game payouts/);
    expect(run.line).toMatch(/spent 0\.000000 ETH/);
    calls.keeperEth = 10n ** 18n;
  });
});

describe("the keeper's gas alert", () => {
  const h = 3_600_000, t = 1_800_000_000_000;
  // 0.0089 ETH falling 0.0011 a day, read every 6 hours
  const samples = [0, 1, 2, 3, 4].map((i) => ({ at: t + i * 6 * h, wei: (milli(8.9) - (milli(1.1) * BigInt(i)) / 4n).toString() }));

  it("measures the daily spend from the balance drops only", () => {
    expect(keeperBurnRate(milli(8), samples).perDay).toBe(milli(1.1));
    expect(keeperBurnRate(milli(8), samples).daysLeft).toBeCloseTo(7.27, 1);
    // a top-up between two readings is not spending: 0.000275 + 0.000275 over 12 h
    const withTopUp = [samples[0]!, samples[1]!, { at: t + 9 * h, wei: (milli(8.625) + milli(10)).toString() }, { at: t + 12 * h, wei: (milli(8.35) + milli(10)).toString() }];
    expect(keeperBurnRate(milli(18), withTopUp).perDay).toBe(milli(1.1));
    expect(keeperBurnRate(milli(8), samples.slice(0, 1)).perDay).toBeNull();
  });

  it("speaks under 0.004 ETH, once a day, with the days left and what to send", () => {
    const s = { samples };
    expect(keeperGasAlert("0xkeeper", KEEPER_LOW, t + 25 * h, s)).toBeNull();
    const note = keeperGasAlert("0xkeeper", milli(3.5), t + 25 * h, s)!;
    expect(note).toMatch(/0xkeeper has 0\.0035 ETH/);
    expect(note).toMatch(/lasts about 3 days/);
    expect(note).toMatch(/Send it about 0\.1000 ETH/); // 90 days at 0.0011
    expect(keeperGasAlert("0xkeeper", milli(3.5), t + 25 * h, { ...s, alertAt: t + 2 * h })).toBeNull();
    expect(keeperGasAlert("0xkeeper", milli(3.5), t + 27 * h, { ...s, alertAt: t + 2 * h })).not.toBeNull();
  });
});
