import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type * as LabModule from "./hashlab.js";
import type * as LeagueModule from "./league.js";
import type * as MissionsModule from "./missions.js";
import type { Market, Quote } from "./imdmarket.js";

let L: typeof LeagueModule, H: typeof LabModule, M: typeof MissionsModule;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "station-test-"));
  L = await import("./league.js");
  H = await import("./hashlab.js");
  M = await import("./missions.js");
});

const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const q = (o: Partial<Quote> & { address: string; symbol: string }): Quote => ({ name: o.symbol, launch: 1, priceUsd: 1, liquidityUsd: 100_000, volume24: 5_000, change1h: 0, change24h: 0, feeBps: 125, quote: "IMD", pair: "0xpair", url: "https://dexscreener.com", ...o });
const market = (at: number, tokens: Quote[]): Market => ({ at, source: "dexscreener", launches: 800, ethLaunchTokens: 300, indexed: 21, tokens });

describe("night league", () => {
  it("charges the fee and the price impact, and marks a holding at what it would really sell for", () => {
    const t = q({ address: "0xa", symbol: "THIN", liquidityUsd: 10_000 });
    const buy = L.buyFill(t, 100);
    expect(buy.feeUsd).toBeCloseTo(1.25);
    expect(buy.qty).toBeLessThan(100);
    expect(buy.impactBps).toBeGreaterThan(150);
    const back = L.sellFill(t, buy.qty);
    expect(back.usd).toBeLessThan(98); // a round trip loses fees and impact both ways
    expect(L.buyFill(t, L.maxBuyUsd(t, 300)).impactBps).toBe(300);
  });

  it("refuses trades over the impact, size and concentration rules, with the size that fits", () => {
    let now = Date.UTC(2026, 9, 20, 12);
    const lg = new L.League(null, () => now);
    lg.join({ id: "aaaaaaaaaaaa", name: "Bot", owner: "0xowner", model: "test-model" });
    const thin = q({ address: "0xa", symbol: "THIN", liquidityUsd: 10_000 });
    const deep = q({ address: "0xb", symbol: "DEEP", liquidityUsd: 10_000_000 });
    const m = market(now, [q({ address: IMD, symbol: "IMD", liquidityUsd: 2_000_000, feeBps: 100 }), deep, thin]);
    expect(() => lg.trade("aaaaaaaaaaaa", m, { token: "THIN", side: "buy", usd: 1_000 })).toThrow(/limit is 3%/);
    expect(() => lg.trade("aaaaaaaaaaaa", m, { token: "DEEP", side: "buy", usd: 3_000 })).toThrow(/25%/);
    lg.trade("aaaaaaaaaaaa", m, { token: "DEEP", side: "buy", usd: 2_400, reason: "test" });
    now += 31_000;
    expect(() => lg.trade("aaaaaaaaaaaa", { ...m, at: now }, { token: "DEEP", side: "buy", usd: 2_000 })).toThrow(/40%/);
    expect(() => lg.trade("aaaaaaaaaaaa", { ...m, at: now }, { token: "NOPE", side: "buy", usd: 50 })).toThrow(/not tradable/);
    now += 31_000;
    const sell = lg.trade("aaaaaaaaaaaa", { ...m, at: now }, { token: "DEEP", side: "sell", fraction: 1 });
    expect(sell.side).toBe("sell");
    expect(lg.view(lg.entry("aaaaaaaaaaaa")!, m).positions).toHaveLength(0);
  });

  it("pauses on stale prices and enforces the cooldown", () => {
    let now = Date.UTC(2026, 9, 20, 12);
    const lg = new L.League(null, () => now);
    lg.join({ id: "bbbbbbbbbbbb", name: "Bot", owner: "0xowner", model: "m" });
    const m = market(now - 20 * 60_000, [q({ address: "0xb", symbol: "DEEP", liquidityUsd: 10_000_000 })]);
    expect(() => lg.trade("bbbbbbbbbbbb", m, { token: "DEEP", side: "buy", usd: 100 })).toThrow(/stale/);
    const fresh = { ...m, at: now };
    lg.trade("bbbbbbbbbbbb", fresh, { token: "DEEP", side: "buy", usd: 100 });
    now += 5_000;
    expect(() => lg.trade("bbbbbbbbbbbb", fresh, { token: "DEEP", side: "buy", usd: 100 })).toThrow(/One trade every/);
  });

  it("runs the house agents within the rules and starts a new season on Monday", () => {
    let now = Date.UTC(2026, 9, 20, 12); // a Tuesday
    const lg = new L.League(null, () => now);
    const tokens = [q({ address: IMD, symbol: "IMD", liquidityUsd: 2_000_000, feeBps: 100 }), ...["a", "b", "c", "d", "e"].map((x, i) => q({ address: `0x${x}`, symbol: x.toUpperCase(), liquidityUsd: 200_000 - i * 10_000, change1h: i === 2 ? 5 : 0, change24h: i === 4 ? -30 : 0 }))];
    lg.runHouse(market(now, tokens));
    const st = lg.standings(market(now, tokens));
    expect(st.find((s) => s.id === "house-imd")!.positions).toBe(1);
    expect(st.find((s) => s.id === "house-index")!.positions).toBe(5);
    expect(st.find((s) => s.id === "house-momentum")!.positions).toBe(1);
    expect(st.find((s) => s.id === "house-contrarian")!.positions).toBe(1);
    for (const s of st) expect(s.equity).toBeLessThan(L.START_USD); // fees and impact cost something
    expect(lg.season.n).toBe(1);
    now = Date.UTC(2026, 9, 26, 0, 1); // Monday
    expect(lg.rollSeason(market(now, tokens))).toBe(true);
    expect(lg.season.n).toBe(2);
    expect(lg.archive()[0]!.top.length).toBeGreaterThan(0);
    expect(lg.standings(market(now, tokens)).every((s) => s.equity === L.START_USD)).toBe(true);
  });

  it("never churns: fees already paid do not trigger the stop, and an exited token rests six hours", () => {
    let now = Date.UTC(2026, 9, 20, 12);
    const lg = new L.League(null, () => now);
    const hot = q({ address: "0xh", symbol: "HOT", liquidityUsd: 90_000, change1h: 3, volume24: 5_000 });
    const m = () => market(now, [q({ address: IMD, symbol: "IMD", liquidityUsd: 2_000_000, feeBps: 100 }), hot]);
    lg.runHouse(m());
    for (let i = 0; i < 6; i++) { now += 5 * 60_000; lg.runHouse(m()); }
    const mo = lg.view(lg.entry("house-momentum")!, m());
    expect(mo.trades).toHaveLength(1); // bought once, held: price unchanged, so no stop and no re-buy
    // the price falls 8%: stop loss, then no re-entry for six hours even though the hour looks hot again
    hot.priceUsd = 0.92;
    now += 5 * 60_000; lg.runHouse(m());
    hot.priceUsd = 1;
    for (let i = 0; i < 5; i++) { now += 30 * 60_000; lg.runHouse(m()); }
    const after = lg.view(lg.entry("house-momentum")!, m());
    expect(after.trades.map((t) => t.side)).toEqual(["sell", "buy"]); // newest first: one buy, one stop
    now += 4 * 3_600_000; lg.runHouse(m());
    expect(lg.view(lg.entry("house-momentum")!, m()).trades).toHaveLength(3);
  });

  it("starts seasons on Monday 00:00 UTC", () => {
    expect(new Date(L.seasonStartOf(Date.UTC(2026, 9, 25, 23))).toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(new Date(L.seasonStartOf(Date.UTC(2026, 9, 26, 0))).toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });
});

describe("hash lab", () => {
  it("matches real SHA-256 at 64 rounds", () => {
    const m = new TextEncoder().encode("NS|0xabc|hello night shift");
    expect(Buffer.from(H.sha256Rounds(m, 64)).toString("hex")).toBe(createHash("sha256").update(m).digest("hex"));
  });

  it("counts shared leading bits", () => {
    expect(H.commonBits(new Uint8Array([0xff, 0x00]), new Uint8Array([0xff, 0x80]))).toBe(8);
    expect(H.commonBits(new Uint8Array([0x0f]), new Uint8Array([0x0e]))).toBe(7);
    expect(H.commonBits(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(16);
  });

  it("scores a real pair, binds it to the player and keeps the best", () => {
    const lab = new H.HashLab(null, () => Date.UTC(2026, 9, 20));
    const who = { player: "0xab12", name: "me", kind: "wallet" as const };
    const enc = (s: string) => Buffer.from(s).toString("hex");
    // find a 12-bit pair quickly by brute force
    const seen = new Map<number, string>();
    let pair: [string, string] | null = null;
    for (let i = 0; !pair; i++) {
      const m = enc(`NS|0xab12|${i.toString().padStart(8, "0")}`);
      const d = H.sha256Rounds(Buffer.from(m, "hex"), 24);
      const k = (d[0]! << 4) | (d[1]! >> 4);
      const prev = seen.get(k);
      if (prev) pair = [prev, m]; else seen.set(k, m);
    }
    const r = lab.submit("r24", who, pair[0], pair[1]);
    expect(r.bits).toBeGreaterThanOrEqual(12);
    expect(r.record && r.labRecord).toBe(true);
    expect(lab.best("r24", "0xab12")).toBe(r.bits);
    expect(() => lab.submit("r24", { ...who, player: "0xother" }, pair![0], pair![1])).toThrow(/must start/);
    expect(() => lab.submit("r24", who, pair![0], pair![0])).toThrow(/differ/);
    expect(lab.submit("r24", who, pair[0], pair[1]).record).toBe(false);
  });
});

describe("command room missions", () => {
  const facts = (o: Partial<MissionsModule.Facts> = {}): MissionsModule.Facts => ({ leagueTrades: 0, leagueBestPct: null, benchmarkPct: null, labR24: 0, labR64: 0, arenaGames: 0, ...o });
  it("crews a mission with one frog, checks it against real facts and pays hours times the frog's multiplier", () => {
    const now = Date.UTC(2026, 9, 20);
    const ms = new M.Missions(null, () => now);
    const frogs = [{ id: 7, multiplier: 3 }, { id: 300, multiplier: 1 }];
    ms.start("0xW", frogs, "desk-duty", 7, facts());
    expect(() => ms.start("0xW", frogs, "warm-up-hash", 7, facts())).toThrow(/already out/);
    expect(() => ms.start("0xW", frogs, "desk-duty", 300, facts())).toThrow(/already crewed/);
    expect(() => ms.start("0xW", frogs, "warm-up-hash", 99, facts())).toThrow(/not in your wallet/);
    expect(() => ms.report("0xW", frogs, "desk-duty", facts({ leagueTrades: 2 }))).toThrow(/Not done/);
    expect(ms.report("0xW", frogs, "desk-duty", facts({ leagueTrades: 3 }))).toBe(24 * 3);
    expect(() => ms.report("0xW", frogs, "desk-duty", facts({ leagueTrades: 3 }))).toThrow(/Already/);
    ms.start("0xW", frogs, "board-watch", 300, facts({ arenaGames: 10 }));
    expect(() => ms.report("0xW", frogs, "board-watch", facts({ arenaGames: 10 }))).toThrow(/Not done/);
    expect(ms.report("0xW", frogs, "board-watch", facts({ arenaGames: 11 }))).toBe(24);
    expect(() => ms.report("0xW", [], "warm-up-hash", facts())).toThrow(/No frog/);
  });
});
