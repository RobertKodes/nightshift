import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { concat, encodeAbiParameters, keccak256 } from "viem";
import { describe, expect, it } from "vitest";

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
