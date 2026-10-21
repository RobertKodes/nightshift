import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { CAPTAIN, PAIR_DOMAIN, PAIR_TYPES, type Position, type SeatLive, TERMS, WATCH, assign, authKeeper, authMessage, cutOf, dueOf, keptBonus, markWindow, maxRepayable, pair, split } from "./nightwatch.js";

const E = 10n ** 18n;
const k = (n: number) => `0x${String(n).padStart(40, "0")}`;
const seat = (watcher: number, inventory: bigint, extra: Partial<SeatLive> = {}): SeatLive => ({
  watcher, keeper: k(watcher), owner: k(100 + watcher), pairedAt: 0, valid: true, online: true, inventory, ethWei: E, due: 0n, arrears: false, weight: 1, cutBps: 1000, ...extra,
});
const pos = (owner: string, state: Position["state"], maxRepay: bigint, debt = 1_000n * E): Position => ({
  owner, collateral: 0n, debt, cr: 150n, state, marker: null, opensAt: 1_000, closesAt: 4_600, maxRepay,
});

describe("the liquidation arithmetic", () => {
  it("bounds a bite by the debt and by the collateral at the bonus price", () => {
    // 120 of collateral value per 100 of debt repaid: 1,200 collateral at $1 covers 1,000
    expect(maxRepayable(1_200n * E, 5_000n * E, E, 20n)).toBe(1_000n * E);
    expect(maxRepayable(1_200n * E, 500n * E, E, 20n)).toBe(500n * E);
    expect(maxRepayable(0n, 500n * E, E, 20n)).toBe(0n);
  });
  it("opens the window when the grace ends and closes it a tail later", () => {
    const m = { markedAt: 100n, grace: 21_600n, marked: true };
    expect(markWindow(m, 3_600n, 200).state).toBe("grace");
    expect(markWindow(m, 3_600n, 21_700).state).toBe("actionable");
    expect(markWindow(m, 3_600n, 25_301).state).toBe("expired");
    expect(markWindow({ ...m, marked: false }, 3_600n, 0).state).toBe("unmarked");
  });
  it("keeps 16% of the debt as bonus, 18% for a seat that also marked, and takes a tenth of that as the cut", () => {
    const b = { chop: 20n, chip: 1_000n, cut: 1_000n };
    expect(keptBonus(100n * E, b, false)).toBe(16n * E);
    expect(keptBonus(100n * E, b, true)).toBe(18n * E);
    expect(cutOf(16n * E, 1000)).toBe((16n * E) / 10n);
    expect(cutOf(16n * E, TERMS.captain!.cutBps)).toBe((16n * E) / 20n);
  });
  it("gives rarer seats a larger weight and a smaller cut, and the Captain the most of both", () => {
    const tiers = [1, 2, 3, 4, 5].map((t) => TERMS[String(t)]!);
    for (let i = 1; i < tiers.length; i++) { expect(tiers[i]!.weight).toBeGreaterThan(tiers[i - 1]!.weight); expect(tiers[i]!.cutBps).toBeLessThan(tiers[i - 1]!.cutBps); }
    expect(TERMS.captain!.weight).toBeGreaterThan(tiers[4]!.weight);
    expect(TERMS.captain!.cutBps).toBeLessThan(tiers[4]!.cutBps);
  });
});

describe("handing out the jobs", () => {
  const none = { marks: {}, assigned: {} as Record<string, { keeper: string; at: number }> };
  it("gives each mark to one seat, the one with the fewest marks, and holds it there for a while", () => {
    const s = { marks: { [k(1)]: 3 }, assigned: {} as Record<string, { keeper: string; at: number }> };
    const jobs = assign({ positions: [pos("0xa", "unmarked", 0n)], stale: [] }, [seat(1, 0n), seat(2, 0n)], s, 1_000);
    expect(jobs.get(k(1))).toEqual([]);
    expect(jobs.get(k(2))).toEqual([{ kind: "bark", owner: "0xa" }]);
    s.marks[k(2)] = 9; // seat 2 marked a lot since, but the job stays with it inside the hold
    expect(assign({ positions: [pos("0xa", "unmarked", 0n)], stale: [] }, [seat(1, 0n), seat(2, 0n)], s, 2_000).get(k(2))).toHaveLength(1);
    expect(assign({ positions: [pos("0xa", "unmarked", 0n)], stale: [] }, [seat(1, 0n), seat(2, 0n)], s, 1_000 + WATCH.markHoldMs + 1).get(k(1))).toHaveLength(1);
  });
  it("splits by imdUSD times weight, never above what a seat holds, and passes a full seat's rest on", () => {
    // same imdUSD, the Captain weighs 4 against 1
    expect(split(500n * E, [{ inventory: 1_000n * E, weight: 4 }, { inventory: 1_000n * E, weight: 1 }])).toEqual([400n * E, 100n * E]);
    // the Captain can only cover 100: the rest goes to the other seat
    expect(split(500n * E, [{ inventory: 100n * E, weight: 4 }, { inventory: 1_000n * E, weight: 1 }])).toEqual([100n * E, 400n * E]);
    const parts = split(1_000n * E + 7n, [{ inventory: 900n * E, weight: 3 }, { inventory: 900n * E, weight: 1.25 }, { inventory: 900n * E, weight: 1 }]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(1_000n * E + 7n);
  });
  it("hands the Captain's seat marks more often", () => {
    const s = { marks: { [k(0)]: 3, [k(1)]: 1 }, assigned: {} as Record<string, { keeper: string; at: number }> };
    const seats = [seat(CAPTAIN, 0n, { weight: 4 }), seat(1, 0n)];
    // 3 marks at weight 4 is fewer turns than 1 mark at weight 1
    expect(assign({ positions: [pos("0xf", "unmarked", 0n)], stale: [] }, seats, s, 1_000).get(k(0))).toEqual([{ kind: "bark", owner: "0xf" }]);
  });
  it("splits a bite pro rata to the seats' imdUSD and never asks a seat for more than it holds", () => {
    const seats = [seat(1, 300n * E), seat(2, 100n * E), seat(3, 600n * E)];
    const jobs = assign({ positions: [pos("0xb", "actionable", 500n * E)], stale: [] }, seats, none);
    const repay = (n: number) => BigInt((jobs.get(k(n))![0] as { repay: string }).repay);
    expect(repay(3)).toBe(300n * E);
    expect(repay(1)).toBe(150n * E);
    expect(repay(2)).toBe(50n * E);
    // more debt than all the seats hold: each bites everything it has
    const big = assign({ positions: [pos("0xb", "actionable", 5_000n * E)], stale: [] }, seats, none);
    expect([1, 2, 3].map((n) => BigInt((big.get(k(n))![0] as { repay: string }).repay))).toEqual([300n * E, 100n * E, 600n * E]);
  });
  it("folds a share too small for a transaction into the largest seat", () => {
    const seats = [seat(1, 1_000n * E), seat(2, 20n * E)];
    const jobs = assign({ positions: [pos("0xc", "grace", 100n * E)], stale: [] }, seats, none);
    expect(jobs.get(k(2))).toEqual([]);
    expect((jobs.get(k(1))![0] as { repay: string }).repay).toBe((100n * E).toString());
  });
  it("leaves out offline, unpaired-owner and overdue seats, dust loans, and everything while the prices are stale", () => {
    const seats = [seat(1, 500n * E, { online: false }), seat(2, 500n * E, { valid: false }), seat(3, 500n * E, { arrears: true }), seat(4, 500n * E)];
    const jobs = assign({ positions: [pos("0xd", "actionable", 100n * E), pos("0xe", "unmarked", 0n, 10n * E)], stale: [] }, seats, none);
    expect([...jobs.keys()]).toEqual([k(4)]);
    expect(jobs.get(k(4))).toHaveLength(1);
    expect(assign({ positions: [pos("0xd", "actionable", 100n * E)], stale: ["price feed"] }, seats, none).get(k(4))).toEqual([]);
  });
});

describe("the cut", () => {
  it("is overdue only once the oldest unpaid bite is older than the grace for paying", () => {
    const s = { bites: [{ keeper: k(1), owedImd: (2n * E).toString(), at: 0 }, { keeper: k(1), owedImd: (3n * E).toString(), at: 10_000_000 }] as never, paid: { [k(1)]: (2n * E).toString() } };
    expect(dueOf(s, k(1), 10_000_000 + 1).due).toBe(3n * E);
    expect(dueOf(s, k(1), 10_000_000 + 1).arrears).toBe(false);
    expect(dueOf(s, k(1), 10_000_000 + WATCH.arrearsMs + 1).arrears).toBe(true);
    expect(dueOf({ ...s, paid: { [k(1)]: (5n * E).toString() } }, k(1), 1e12)).toMatchObject({ due: 0n, arrears: false });
  });
});

describe("pairing a seat", () => {
  beforeEach(() => { (config as { dataDir: string }).dataDir = mkdtempSync(join(tmpdir(), "nightwatch-")); vi.useRealTimers(); });
  const holder = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const keeper = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const sign = (watcher: number, by = holder, issuedAt = Math.floor(Date.now() / 1000)) =>
    by.signTypedData({ domain: PAIR_DOMAIN, types: PAIR_TYPES, primaryType: "Seat", message: { watcher: BigInt(watcher), keeper: keeper.address, issuedAt: BigInt(issuedAt) } }).then((signature) => ({ watcher, keeper: keeper.address, issuedAt, signature }));
  const ownerOf = async (n: number) => (n === 7 || n === CAPTAIN ? holder.address.toLowerCase() : null);

  it("pairs a keeper to the Night Watcher its owner signed for", async () => {
    const s = await pair(await sign(7), ownerOf);
    expect(s).toMatchObject({ watcher: 7, keeper: keeper.address.toLowerCase(), owner: holder.address.toLowerCase() });
  });
  it("pairs the Captain's seat to whoever holds NIGHT FROG #1", async () => {
    const own = privateKeyToAccount(`0x${"44".repeat(32)}`), issuedAt = Math.floor(Date.now() / 1000);
    const signature = await holder.signTypedData({ domain: PAIR_DOMAIN, types: PAIR_TYPES, primaryType: "Seat", message: { watcher: BigInt(CAPTAIN), keeper: own.address, issuedAt: BigInt(issuedAt) } });
    expect(await pair({ watcher: CAPTAIN, keeper: own.address, issuedAt, signature }, ownerOf)).toMatchObject({ watcher: CAPTAIN, owner: holder.address.toLowerCase() });
  });
  it("refuses a signature from anyone but the holder, an old one and a seat that does not exist", async () => {
    const stranger = privateKeyToAccount(`0x${"33".repeat(32)}`);
    await expect(pair(await sign(7, stranger), ownerOf)).rejects.toThrow(/holds Night Watcher #7/);
    await expect(pair(await sign(7, holder, Math.floor(Date.now() / 1000) - 3_600), ownerOf)).rejects.toThrow(/expired/);
    await expect(pair(await sign(8), ownerOf)).rejects.toThrow();
  });
  it("checks the bot's request signature and its clock", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = await keeper.signMessage({ message: authMessage(keeper.address, ts) });
    expect(await authKeeper(keeper.address, String(ts), sig)).toBe(keeper.address.toLowerCase());
    await expect(authKeeper(keeper.address, String(ts - 600), sig)).rejects.toThrow(/clock/);
    await expect(authKeeper(holder.address, String(ts), sig)).rejects.toThrow(/not the keeper/);
  });
});
