import { describe, expect, it } from "vitest";
import { changed, owedBy } from "./guard.js";

const E = 10n ** 18n;
describe("the Guard", () => {
  it("counts what the escrow owes: the creator's stake while open, both once joined, nothing once closed or unopened", () => {
    const owed = owedBy([
      { stake: String(100n * E), token: "SHIFT", openedAt: 1 },
      { stake: String(5n * E), token: "IMD", openedAt: 1, joinedAt: 2, playerB: "0xb" },
      { stake: String(7n * E), token: "IMD", openedAt: 1, joinedAt: 2, playerB: "0xb", closed: { kind: "settled" } },
      { stake: String(9n * E), token: "SHIFT" },
    ]);
    expect(owed).toEqual({ SHIFT: 100n * E, IMD: 10n * E });
  });
  it("reports only settings that moved, never the first look", () => {
    expect(changed({}, { "FeeSplitter.owner": "0xa" })).toEqual([]);
    expect(changed({ "FeeSplitter.owner": "0xa", "GameEscrow.signer": "0xs" }, { "FeeSplitter.owner": "0xa", "GameEscrow.signer": "0xt" })).toEqual(["GameEscrow.signer: 0xs → 0xt"]);
  });
});
