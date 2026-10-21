import { test } from "node:test";
import assert from "node:assert/strict";
import { authMessage } from "../lib/coordinator.mjs";
import { biteAmount, cutPayment, decide } from "../lib/plan.mjs";

const E = 10n ** 18n;
const bite = { kind: "bite", owner: "0xa", repay: (100n * E).toString(), opensAt: 1_000, closesAt: 4_600 };

test("marks what it is handed", () => {
  assert.deepEqual(decide({ kind: "bark", owner: "0xa" }, { now: 0, inventory: 0n }), { act: "bark" });
});

test("bites its share once the window is open, never more than it holds", () => {
  assert.deepEqual(decide(bite, { now: 1_000, inventory: 500n * E }), { act: "bite", amount: 100n * E });
  assert.deepEqual(decide(bite, { now: 2_000, inventory: 40n * E }), { act: "bite", amount: 40n * E });
  assert.equal(biteAmount(bite, 0n), 0n);
});

test("waits for a window about to open and skips one far off, closed or unaffordable", () => {
  assert.deepEqual(decide(bite, { now: 950, inventory: 500n * E }), { act: "wait", seconds: 50, amount: 100n * E });
  assert.equal(decide(bite, { now: 0, inventory: 500n * E }).act, "skip");
  assert.equal(decide(bite, { now: 5_000, inventory: 500n * E }).act, "skip");
  assert.equal(decide(bite, { now: 1_000, inventory: 0n }).act, "skip");
  assert.equal(decide(bite, { now: 1_000, inventory: 5n * E }).act, "skip");
});

test("pays the cut from staked IMD first, then IMD, and never twice in a row", () => {
  assert.deepEqual(cutPayment({ dueImd: "0", simdCovers: true, imdBalance: 0n, lastPaidAgoSeconds: null }), { pay: false });
  assert.deepEqual(cutPayment({ dueImd: String(E), simdCovers: true, imdBalance: 0n, lastPaidAgoSeconds: null }), { pay: true, from: "simd", amount: E });
  assert.deepEqual(cutPayment({ dueImd: String(E), simdCovers: false, imdBalance: 2n * E, lastPaidAgoSeconds: 9_999 }), { pay: true, from: "imd", amount: E });
  assert.equal(cutPayment({ dueImd: String(E), simdCovers: true, imdBalance: 0n, lastPaidAgoSeconds: 60 }).pay, false);
  assert.equal(cutPayment({ dueImd: String(E), simdCovers: false, imdBalance: 0n, lastPaidAgoSeconds: null }).pay, false);
});

test("signs the same request message the coordinator checks", () => {
  assert.equal(authMessage("0xABCdef0000000000000000000000000000000001", 5), "NIGHT WATCH 0xabcdef0000000000000000000000000000000001 5");
});
