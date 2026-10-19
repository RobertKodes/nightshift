import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { concat, encodeAbiParameters, keccak256 } from "viem";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { type Epoch, buildEpoch } from "./frogpot.js";

// The leaf ShiftRewards checks, from the launch spec: keccak256(bytes.concat(keccak256(abi.encode(epoch, account, token, amount)))).
const leaf = (epoch: bigint, account: `0x${string}`, token: `0x${string}`, amount: bigint) =>
  keccak256(concat([keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint256" }], [epoch, account, token, amount]))]));
// OpenZeppelin MerkleProof.verify: sorted pairs, keccak256.
const verify = (proof: `0x${string}`[], root: string, l: `0x${string}`) =>
  proof.reduce((h, p) => keccak256(concat(h.toLowerCase() < p.toLowerCase() ? [h, p] : [p, h])), l) === root;

describe("frog pot", () => {
  it("builds the exact leaf and proof the rewards contract checks", () => {
    const token = "0x0000000000000000000000000000000000000000";
    const values: [string, string, string, string][] = [
      ["1", "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5", token, "1000"],
      ["1", "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69", token, "2500"],
      ["1", "0x1111111111111111111111111111111111111111", token, "7"],
    ];
    const tree = StandardMerkleTree.of(values, ["uint256", "address", "address", "uint256"]);
    for (const [i, v] of tree.entries()) {
      const l = leaf(BigInt(v[0]), v[1] as `0x${string}`, v[2] as `0x${string}`, BigInt(v[3]));
      expect(verify(tree.getProof(i) as `0x${string}`[], tree.root, l)).toBe(true);
    }
  });
});

const chain = vi.hoisted(() => ({ head: 100n, logs: [] as { block: bigint; token: string; rewards: bigint }[] }));
const board = vi.hoisted(() => ({ rows: [] as { wallet: string; hours: number }[] }));
vi.mock("./chain.js", () => ({
  eth: {
    getBlockNumber: async () => chain.head,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
      chain.logs.filter((l) => l.block >= fromBlock && l.block <= toBlock).map((l) => ({ args: { token: l.token, rewards: l.rewards } })),
  },
}));
vi.mock("./frogs.js", () => ({ stakingBoard: () => board.rows }));

describe("frog epochs", () => {
  const ETH = "0x0000000000000000000000000000000000000000";
  const W = "0x00000000000000000000000000000000000000a1";
  const V = "0x00000000000000000000000000000000000000b2";
  const C = { splitter: "0x00000000000000000000000000000000000000cc", token: "0x00000000000000000000000000000000000000dd" };
  const total = (e: Epoch | null) => BigInt(e?.tokens.find((t) => t.token === ETH)?.total ?? "0");

  beforeEach(() => {
    config.dataDir = mkdtempSync(join(tmpdir(), "ns-frogpot-"));
    chain.head = 100n; chain.logs = []; board.rows = [];
  });

  it("carries a pot that arrives before anyone has hours into the next epoch", async () => {
    chain.logs.push({ block: 50n, token: ETH, rewards: 10n ** 18n });
    expect(await buildEpoch(C, 0)).toBeNull();
    chain.head = 200n;
    board.rows = [{ wallet: W, hours: 10 }];
    const e = await buildEpoch(C, 0);
    expect(total(e)).toBe(5n * 10n ** 17n); // the frog half of the first Distributed
  });

  it("keeps the hours of a week without a pot for the next pot", async () => {
    board.rows = [{ wallet: W, hours: 168 }];
    expect(await buildEpoch(C, 0)).toBeNull();
    chain.head = 200n;
    chain.logs.push({ block: 150n, token: ETH, rewards: 2n * 10n ** 18n });
    board.rows = [{ wallet: W, hours: 336 }, { wallet: V, hours: 168 }];
    const e = await buildEpoch(C, 0);
    const amounts: Record<string, bigint> = Object.fromEntries([...StandardMerkleTree.load(e!.tokens[0]!.tree as never).entries()].map(([, v]) => [String(v[1]), BigInt(String(v[3]))]));
    expect(amounts[W]).toBe(2n * amounts[V]!); // W's first 168 hours still count
  });

  it("pressing Build twice loses nothing", async () => {
    board.rows = [{ wallet: W, hours: 5 }];
    chain.logs.push({ block: 90n, token: ETH, rewards: 4n * 10n ** 18n });
    expect(total(await buildEpoch(C, 0))).toBe(2n * 10n ** 18n);
    chain.head = 110n;
    chain.logs.push({ block: 105n, token: ETH, rewards: 2n * 10n ** 18n });
    expect(await buildEpoch(C, 0)).toBeNull(); // no new hours yet
    chain.head = 300n;
    board.rows = [{ wallet: W, hours: 9 }];
    expect(total(await buildEpoch(C, 0))).toBe(10n ** 18n);
  });
});
