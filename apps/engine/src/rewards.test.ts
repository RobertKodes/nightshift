import { describe, expect, it, vi } from "vitest";
import type { Challenge } from "./escrow.js";

vi.hoisted(() => { process.env.DATA_DIR = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "ns-rewards-")); });
const { gamesOf } = await import("./rewards.js");

const ME = "0x00000000000000000000000000000000000000aa", RIVAL = "0x00000000000000000000000000000000000000bb";
const E18 = 10n ** 18n;
const now = 1_800_000_000;
const duel = (o: Partial<Challenge>): Challenge => ({ matchId: `0x${"1".repeat(63)}${Math.floor(Math.random() * 10)}` as never, game: "chess", token: "IMD", stake: (10n * E18).toString(), creator: ME, name: "", tc: null, createdAt: (now - 3_600) * 1000, openedAt: now - 3_600, playerB: RIVAL, joinedAt: now - 3_000, ...o });
const signed = (winner: string, draw = false) => ({ winner, draw, deadline: String(now + 3_600), signature: "0x" as never, at: (now - 100) * 1000 });

describe("a wallet's staked games on the rewards card", () => {
  it("offers a win the relay did not pay, at the 95% payout, and a draw at the stake", () => {
    const g = gamesOf([
      duel({ result: signed(ME), outcome: { draw: false, winner: ME, at: 1 }, relay: { state: "failed", at: 1 } }),
      duel({ result: signed(ME, true), outcome: { draw: true, winner: null, at: 2 } }),
    ], ME, now);
    expect(g.claimable.map((c) => [c.kind, c.amount])).toEqual([["settle", (19n * E18).toString()], ["settle", (10n * E18).toString()]]);
  });

  it("never offers a loss, a payout already on its way, or a settled match; shows them as history", () => {
    const g = gamesOf([
      duel({ result: signed(RIVAL), outcome: { draw: false, winner: RIVAL, at: 3 } }),
      duel({ result: signed(ME), outcome: { draw: false, winner: ME, at: 4 }, relay: { state: "sent", tx: "0xabc", at: (now - 30) * 1000 } }),
      duel({ closed: { kind: "settled", tx: "0xdef", winner: ME, draw: false, payout: (19n * E18).toString() }, outcome: { draw: false, winner: ME, at: 5 } }),
      duel({ creator: RIVAL, playerB: "0x00000000000000000000000000000000000000cc" }),
    ], ME, now);
    expect(g.claimable).toEqual([]);
    expect(g.recent.map((r) => r.result)).toEqual(["won", "paying"]);
  });

  it("offers the claim when the relay was sent but has not landed in 2 minutes (a keeper low on gas, a stuck transaction)", () => {
    const g = gamesOf([duel({ result: signed(ME), outcome: { draw: false, winner: ME, at: 6 }, relay: { state: "sent", tx: "0xabc", at: (now - 121) * 1000 } })], ME, now);
    expect(g.claimable.map((c) => c.kind)).toEqual(["settle"]);
  });

  it("offers a refund once the contract allows it: an unjoined match after the hour, a joined one after a day", () => {
    const g = gamesOf([
      duel({ playerB: undefined, joinedAt: undefined, openedAt: now - 3_601 }),
      duel({ playerB: undefined, joinedAt: undefined, openedAt: now - 60 }),
      duel({ joinedAt: now - 86_401, outcome: undefined }),
    ], ME, now);
    expect(g.claimable.map((c) => c.kind)).toEqual(["refund", "refund"]);
  });
});
