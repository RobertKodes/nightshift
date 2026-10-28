import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { StakeHistory } from "./stake-history.js";

vi.mock("./token.js", () => ({ launchState: () => ({ open: true, scanFrom: 1_000, contracts: { rewards: "0x44ef9ba2dac00b709a7a69a966a7cbc9c5f930b5" } }) }));

const ME = "0x89ea000000000000000000000000000000000001";
type Log = { args: Record<string, unknown>; transactionHash: string; blockNumber: bigint };
/** A chain with one stake, one withdrawal and one ETH payment for ME, whose log reads can be made to fail. */
function chain(head: bigint) {
  let failFrom: bigint | null = null, calls = 0;
  const logs: Record<string, Log[]> = {
    Staked: [{ args: { account: ME, amount: 500n, unlockAt: 2_000_000_000n }, transactionHash: "0xs", blockNumber: 2_000n }],
    Withdrawn: [{ args: { account: ME, amount: 100n }, transactionHash: "0xw", blockNumber: 15_000n }],
    RewardPaid: [{ args: { account: ME, token: "0x0000000000000000000000000000000000000000", amount: 7n }, transactionHash: "0xp", blockNumber: 16_000n }],
  };
  return {
    fail(from: bigint | null) { failFrom = from; },
    get calls() { return calls; },
    getBlockNumber: async () => head,
    getLogs: async (q: { event: { name: string }; fromBlock: bigint; toBlock: bigint }) => {
      calls++;
      if (failFrom !== null && q.fromBlock >= failFrom) throw new Error("rate limited");
      return (logs[q.event.name] ?? []).filter((l) => l.blockNumber >= q.fromBlock && l.blockNumber <= q.toBlock);
    },
  };
}

describe("stake history", () => {
  it("never answers from a history that stops short, and finishes on a later read", async () => {
    const c = chain(20_000n), h = new StakeHistory(mkdtempSync(join(tmpdir(), "stake-")), c as never);
    c.fail(10_000n);
    await expect(h.of(ME)).rejects.toThrow();
    await expect(h.of(ME)).rejects.toThrow();
    c.fail(null);
    const r = await h.of(ME);
    expect(r).toEqual({ stakes: [{ amount: "500", unlockAt: 2_000_000_000, tx: "0xs" }], out: "100", paidEth: "7", asOfBlock: 20_000 });
  });

  it("keeps what it read: a second read in the same block asks the chain nothing", async () => {
    const c = chain(20_000n), h = new StakeHistory(mkdtempSync(join(tmpdir(), "stake-")), c as never);
    await h.of(ME);
    const before = c.calls;
    expect((await h.of("0x0000000000000000000000000000000000000002"))?.stakes).toEqual([]);
    expect(c.calls).toBe(before);
  });
});
