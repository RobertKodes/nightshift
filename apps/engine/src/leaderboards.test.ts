import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type EventRow, type LeaderInput, Leaderboards, PayoutIndex, aggregate, boardView, eventRow } from "./leaderboards.js";
import type { StakeRow } from "./stake-history.js";

const W = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const [A, B, C, D, E] = [W(0xa), W(0xb), W(0xc), W(0xd), W(0xe)];
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const ETH = "0x0000000000000000000000000000000000000000", IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7", SHIFT = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";
const e18 = (n: number) => (BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString();
const NOW = Date.UTC(2026, 10, 5);
const ev = (e: string, a: Record<string, string>, b = 1): EventRow => ({ e, a, b, t: `0x${e}${b}`, i: 0 });
const live = { state: "live" as const };

function input(over: Partial<LeaderInput> = {}): LeaderInput {
  return {
    now: NOW, prices: { ETH: 3000, SHIFT: 0.0001, IMD: 5 },
    tokens: { [ETH]: "ETH", [IMD]: "IMD", [SHIFT]: "SHIFT" }, exclude: new Set([DEV]),
    stakes: [], frogs: [], keepers: [], feeds: {},
    sources: { stakers: { shift: live, frogs: live }, earners: { staking: live, frogpot: live, games: live, bets: live, watch: live, hours: live } },
    ...over,
  };
}
const stake = (kind: StakeRow["kind"], account: string, amount: number, more: Partial<StakeRow> = {}): StakeRow => ({ kind, account, amount: e18(amount), tx: "0x", block: 1, ...more });

describe("stakers", () => {
  it("ranks $SHIFT by what is still staked, keeps NIGHT FROGS apart, and leaves NIGHTSHIFT's wallets out", () => {
    const later = NOW / 1000 + 86_400, past = NOW / 1000 - 86_400;
    const b = aggregate(input({
      stakes: [
        stake("staked", A, 1_000_000, { unlockAt: past }), stake("staked", A, 500_000, { unlockAt: later }), stake("withdrawn", A, 200_000),
        stake("staked", B, 2_000_000, { unlockAt: past }), stake("staked", C, 100, { unlockAt: past }), stake("withdrawn", C, 100),
        stake("staked", DEV, 9_000_000, { unlockAt: later }),
      ],
      frogs: [
        { wallet: C, hours: 900.7, frogs: 3, watchers: 1, perHour: 36, imdSeat: false },
        { wallet: D, hours: 4_000, frogs: 0, watchers: 0, perHour: 0, imdSeat: false },
        { wallet: E, hours: 10, frogs: 2, watchers: 0, perHour: 4, imdSeat: true },
      ],
    }));
    const s = b.stakers.lists;
    expect(s.shift.map((r) => [r.wallet, r.shift!.amount])).toEqual([[B, "2000000"], [A, "1300000"]]);
    expect(s.shift[1]!.shift).toMatchObject({ stakes: 2, lockedUntil: later, usd: 130 });
    expect(s.shift[0]!.shift!.lockedUntil).toBeNull();
    // a wallet that sold its frogs keeps its hours but is no longer staking
    expect(s.frogs.map((r) => [r.wallet, r.frogs!.frogs, r.frogs!.watchers, r.frogs!.hours])).toEqual([[C, 3, 1, 900], [E, 2, 0, 10]]);
    expect(s.all.map((r) => r.wallet)).toEqual([B, A, C, E]);
    expect(b.stakers.totals).toEqual({ shift: { amount: "3300000", usd: 330, wallets: 2 }, frogs: { frogs: 5, watchers: 1, wallets: 2 } });
    expect(JSON.stringify(b)).not.toContain(DEV);
    expect(b.excluded).toBe(1);
  });
});

describe("earners", () => {
  it("counts staked duels and bets net, never adds two tokens as one, and prices only what has a price", () => {
    const M1 = "0x01", M2 = "0x02", M3 = "0x03";
    const games = [
      // A beats B for 100 IMD each (190 paid: +90 for A, -100 for B); C and A draw; B beats A in $SHIFT
      ev("Opened", { matchId: M1, token: IMD, stake: e18(100), playerA: A }), ev("Joined", { matchId: M1, playerB: B }), ev("Settled", { matchId: M1, winner: A, draw: "false", payout: e18(190) }, 2),
      ev("Opened", { matchId: M2, token: IMD, stake: e18(10), playerA: C }), ev("Joined", { matchId: M2, playerB: A }), ev("Settled", { matchId: M2, winner: ETH, draw: "true", payout: "0" }, 2),
      ev("Opened", { matchId: M3, token: SHIFT, stake: e18(1_000_000), playerA: B }), ev("Joined", { matchId: M3, playerB: A }), ev("Settled", { matchId: M3, winner: B, draw: "false", payout: e18(1_900_000) }, 2),
      // open, never settled: nothing
      ev("Opened", { matchId: "0x04", token: IMD, stake: e18(50), playerA: D }),
    ];
    const K1 = "0xk1", K2 = "0xk2";
    const bets = [
      ev("MarketCreated", { marketId: K1, token: IMD }),
      ev("BetPlaced", { marketId: K1, bettor: C, side: "0", amount: e18(10) }), ev("BetPlaced", { marketId: K1, bettor: D, side: "1", amount: e18(30) }),
      ev("BetPlaced", { marketId: K1, bettor: E, side: "0", amount: e18(5) }),
      ev("Settled", { marketId: K1, outcome: "0" }, 2), ev("Claimed", { marketId: K1, bettor: C, amount: e18(28) }, 3),
      // a one-sided market is refunded: unclaimed, it counts nothing
      ev("MarketCreated", { marketId: K2, token: IMD }), ev("BetPlaced", { marketId: K2, bettor: D, side: "0", amount: e18(7) }), ev("Settled", { marketId: K2, outcome: "1" }, 2),
    ];
    const b = aggregate(input({
      prices: { ETH: 3000, SHIFT: null, IMD: 5 },
      stakes: [stake("paid", A, 0.01, { token: ETH }), stake("paid", A, 50_000, { token: SHIFT }), stake("paid", E, 0.002, { token: ETH })],
      feeds: { games, bets, frogpot: [ev("FrogsClaimed", { epoch: "1", account: B, token: IMD, amount: e18(2) })] },
      keepers: [{ keeper: W(0x99), owner: C, watcher: 7, usd: 12.5, bites: 2 }, { keeper: W(0x98), owner: DEV, watcher: 1, usd: 50, bites: 1 }],
      frogs: [{ wallet: D, hours: 120, frogs: 1, watchers: 0, perHour: 1, imdSeat: false }],
    }));
    const by = Object.fromEntries(b.earners.lists.all.map((r) => [r.wallet, r]));
    // A: +90 IMD, -1,000,000 SHIFT in games; 0.01 ETH and 50,000 SHIFT from staking. Each token apart.
    expect(by[A]!.parts.games).toEqual({ amounts: [{ unit: "SHIFT", amount: "-1000000", usd: null }, { unit: "IMD", amount: "90", usd: 450 }], usd: 450, stats: { won: 1, lost: 1, draws: 1 } });
    expect(by[A]!.parts.staking).toEqual({ amounts: [{ unit: "ETH", amount: "0.01", usd: 30 }, { unit: "SHIFT", amount: "50000", usd: null }], usd: 30, stats: { payments: 2 } });
    expect(by[A]).toMatchObject({ usd: 480, partial: true });
    // B: -100 IMD and +900,000 SHIFT in games, 2 IMD from the frog pot
    expect(by[B]!.parts.games!.amounts).toEqual([{ unit: "SHIFT", amount: "900000", usd: null }, { unit: "IMD", amount: "-100", usd: -500 }]);
    expect(by[B]!.parts.frogpot).toEqual({ amounts: [{ unit: "IMD", amount: "2", usd: 10 }], usd: 10, stats: { claims: 1 } });
    // bets: C claimed 28 for 10 (+18); D lost 30 (its one-sided bet waits for its refund); E won and has not claimed yet: nothing until it does
    expect(by[C]!.parts.bets!.amounts).toEqual([{ unit: "IMD", amount: "18", usd: 90 }]);
    expect(by[C]!.parts.watch).toEqual({ amounts: [{ unit: "USD", amount: "12.50", usd: 12.5 }], usd: 12.5, stats: { liquidations: 2, seat: 7 } });
    expect(by[D]!.parts.bets!.amounts).toEqual([{ unit: "IMD", amount: "-30", usd: -150 }]);
    // shift hours are points: listed, never dollars
    expect(by[D]!.parts.hours).toEqual({ amounts: [{ unit: "HOURS", amount: "120", usd: null }], usd: null, stats: {} });
    expect(by[D]!.usd).toBe(-150);
    expect(by[E]!.parts.bets).toBeUndefined();
    expect(by[E]).toMatchObject({ usd: 6, partial: false });
    // each source's list holds only wallets that made something there, best first
    expect(b.earners.lists.games.map((r) => r.wallet)).toEqual([A, B]);
    expect(b.earners.lists.bets.map((r) => r.wallet)).toEqual([C]);
    expect(b.earners.lists.watch.map((r) => r.wallet)).toEqual([C]);
    expect(b.earners.lists.hours.map((r) => r.wallet)).toEqual([D]);
    expect(b.earners.lists.all.map((r) => [r.wallet, r.usd])).toEqual([[A, 480], [C, 102.5], [E, 6], [D, -150], [B, -490]]);
    // the dev wallet's seat earnings are left out
    expect(JSON.stringify(b.earners)).not.toContain(DEV);
  });

  it("shows a wallet's own row wherever it ranks", () => {
    const stakes = Array.from({ length: 30 }, (_, n) => stake("staked", W(0x100 + n), 1000 - n, { unlockAt: 0 }));
    const b = aggregate(input({ stakes }));
    const v = boardView(b, "stakers", "shift", 10, W(0x100 + 25).toUpperCase().replace("0X", "0x"));
    expect(v.rows).toHaveLength(10);
    expect(v.rows[0]).toMatchObject({ rank: 1, wallet: W(0x100) });
    expect(v.count).toBe(30);
    expect(v.me).toMatchObject({ rank: 26, wallet: W(0x100 + 25) });
    expect(boardView(b, "earners", "all", 10, A).me).toBeNull();
  });

  it("keeps event arguments as lowercase strings", () => {
    expect(eventRow("Settled", { matchId: "0xAB", winner: "0xCD", draw: false, payout: 5n }, { blockNumber: 7n, transactionHash: "0xEF", logIndex: 2 }))
      .toEqual({ e: "Settled", a: { matchId: "0xab", winner: "0xcd", draw: "false", payout: "5" }, b: 7, t: "0xef", i: 2 });
  });
});

describe("payout index", () => {
  /** A chain of `head` blocks with one event every 1,000 blocks; reads of more than `max` blocks fail. */
  function chain(head: number, max = Infinity) {
    let calls = 0, down = false;
    const read = async (_c: string, from: bigint, to: bigint) => {
      calls++;
      if (down || Number(to - from) + 1 > max) throw new Error("range too wide");
      const rows: EventRow[] = [];
      for (let n = Math.ceil(Number(from) / 1000) * 1000; n <= Number(to); n += 1000) rows.push(ev("Opened", { matchId: `0x${n}` }, n));
      return rows;
    };
    return { read, get calls() { return calls; }, set down(v: boolean) { down = v; }, head: async () => BigInt(head) };
  }
  const specs = () => [{ key: "games" as const, contract: W(0xe5c), from: 10_000 }];

  it("reads forward in ranges, smaller when a node refuses one, and picks up where it stopped", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "lb-")), "leaderboards.json"), c = chain(50_001, 3_000);
    const x = new PayoutIndex({ file, head: c.head, specs, read: { games: c.read, bets: c.read, frogpot: c.read }, pauseMs: 0 });
    expect(x.view().state).toEqual({ games: { state: "syncing" }, bets: { state: "off" }, frogpot: { state: "off" } });
    await x.sync();
    const v = x.view();
    expect(v.state.games).toEqual({ state: "live", asOfBlock: 50_000 });
    expect(v.feeds.games!.map((r) => r.b)).toEqual(Array.from({ length: 41 }, (_, n) => 10_000 + n * 1000));
    // a restart reads the file and asks the chain only for what is new
    const c2 = chain(52_001), y = new PayoutIndex({ file, head: c2.head, specs, read: { games: c2.read, bets: c2.read, frogpot: c2.read }, pauseMs: 0 });
    await y.sync();
    expect(c2.calls).toBe(1);
    expect(y.view().feeds.games).toHaveLength(43);
  });

  it("says when a read failed, and keeps what it had", async () => {
    const c = chain(20_001);
    const x = new PayoutIndex({ file: null, head: c.head, specs, read: { games: c.read, bets: c.read, frogpot: c.read }, pauseMs: 0, span: 5_000n });
    await x.sync();
    c.down = true;
    const later = chain(40_001);
    const y = new PayoutIndex({ file: null, head: later.head, specs, read: { games: c.read, bets: c.read, frogpot: c.read }, pauseMs: 0 });
    await y.sync();
    expect(y.view().state.games.state).toBe("error");
    expect(x.view().state.games.state).toBe("live");
  });
});

describe("the boards", () => {
  it("are kept a few minutes, and say when the stake history is still being read", async () => {
    const clock = { now: NOW };
    let reads = 0, ready = false;
    const boards = new Leaderboards({
      stakes: async () => { reads++; if (!ready) throw new Error("The stake history is still being read."); return { rows: [stake("staked", A, 5, { unlockAt: 0 })], asOfBlock: 9 }; },
      frogs: () => null, keepers: () => [], index: { poke: () => {}, view: () => ({ feeds: {}, state: { games: { state: "off" }, bets: { state: "off" }, frogpot: { state: "off" } } }) },
      prices: async () => ({ ETH: null, SHIFT: null, IMD: null }), tokens: () => ({}), exclude: () => new Set(), now: () => clock.now, waitMs: 50,
    });
    const first = await boards.boards();
    expect(first.stakers.sources.shift.state).toBe("syncing");
    expect(first.stakers.sources.frogs.state).toBe("off");
    ready = true;
    expect(await boards.boards()).toBe(first);
    // while a source is being read the copy lasts 30 s; the next look still answers at once, then has the new one
    clock.now += 31_000;
    expect(await boards.boards()).toBe(first);
    await new Promise((r) => setTimeout(r, 0));
    const second = await boards.boards();
    expect(second.stakers.sources.shift).toEqual({ state: "live", asOfBlock: 9 });
    expect(second.stakers.lists.shift.map((r) => r.wallet)).toEqual([A]);
    clock.now += 4 * 60_000;
    expect(await boards.boards()).toBe(second);
    expect(reads).toBe(2);
  });
});
