import { describe, expect, it } from "vitest";
import { ART, DEAD, FORGED_ID, TABLE, frogOf, shiftRate } from "./forge.js";
import { hourlyRate } from "./frogs.js";
import type { Book } from "./nightwatch.js";
import { RULES, STATION_KEYS, boosts, crewOf, ruleOf, shipSnapshot, shipStatic, stationOf, whyOf } from "./ship.js";

const A = "0x00000000000000000000000000000000000000aa", B = "0x00000000000000000000000000000000000000bb", C = "0x00000000000000000000000000000000000000cc";
const base = (): string[] => Array.from({ length: 500 }, (_, i) => (i % 3 === 0 ? A : i % 3 === 1 ? B : C));
const empty = { seat: {}, missions: [], watch: [], book: null, stakingAt: 1, now: 2 };
const watcher = (n: number, tier: number, inputs: number[], owner: string) => ({ n, tier, points: 40, inputs, traits: [0, 0, 0, 0, 0, 0, 0], forgedAt: 0, name: "", owner });

describe("where every frog works", () => {
  it("puts every one of the 500 at one station, the same way every time", () => {
    const counts = Object.fromEntries(STATION_KEYS.map((s) => [s, 0]));
    for (const t of TABLE.tokens) counts[stationOf(t.id)]! += 1;
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(500);
    // the layout of the scene is sized for these: they only change if the table does
    expect(counts).toEqual({ bridge: 68, quarters: 46, offices: 50, breakroom: 84, missions: 79, engine: 131, forge: 42 });
  });
  it("goes by rank first, then gear", () => {
    expect(stationOf(1)).toBe("bridge");
    expect(ruleOf(1)).toBe(0);
    for (const t of TABLE.tokens.filter((x) => x.tier === "Legendary" && x.id !== 1)) expect(stationOf(t.id)).toBe("quarters");
    const hardHat = TABLE.tokens.find((t) => t.tier !== "Legendary" && t.traits[5] === 0)!;
    expect(stationOf(hardHat.id)).toBe("engine");
    expect(whyOf(hardHat.id)).toBe("Headwear: Headlamp Hard Hat, works the reactor");
    // frog #250 wears a hard hat and a coffee: the hat comes first
    expect(frogOf(250)!.traits[5]).toBe(0);
    expect(stationOf(250)).toBe("engine");
    const plain = TABLE.tokens.find((t) => ruleOf(t.id) === RULES.length - 1)!;
    expect(whyOf(plain.id)).toBe("the shift floor");
  });
  it("serves the art records and the table once, with each frog's rule", () => {
    const s = shipStatic(ART);
    expect(s.art).toHaveLength(100);
    expect(s.frogs).toHaveLength(500);
    expect(s.frogs[9]).toEqual([frogOf(10)!.rank, s.rarities.indexOf(frogOf(10)!.tier as never), frogOf(10)!.points, ...frogOf(10)!.traits, ruleOf(10)]);
  });
});

describe("the live snapshot", () => {
  it("credits each frog what accrueStaking credits: base rate, crew boost (never #1), IMD seat 2x", () => {
    const owners = base();
    const s = shipSnapshot({ ...empty, owners, forged: [watcher(3, 2, [100, 101, 102, 103, 104, 105, 106, 107, 108, 109], B)], seat: { [C]: true } });
    const f = (id: number) => s.frogs[id - 1]!;
    // #1 (A) is exempt from its own 150% and A has no IMD seat
    expect(f(1).rate).toBe(50);
    // A holds #1: every other frog of A earns 150% more
    expect(f(4).boost).toBe(150);
    expect(f(4).rate).toBe(hourlyRate(4, shiftRate(4), 150, false));
    // B holds a Foreman: +30%
    expect(f(2).boost).toBe(30);
    expect(f(2).rate).toBe(3.9);
    // C holds an IMD seat: doubled, no boost
    expect(f(3).rate).toBe(6);
    expect(s.watchers[0]!.rate).toBe(15);
    expect(s.crew[s.wallets.indexOf(B)]).toBe(30);
    expect(s.imdSeat[s.wallets.indexOf(C)]).toBe(true);
  });
  it("sends forged frogs to the forge's wall with the Night Watcher they made, earning nothing", () => {
    const owners = base();
    const ids = [441, 329, 328, 317, 240, 433, 324, 8, 5, 7];
    for (const id of ids) owners[id - 1] = DEAD;
    const s = shipSnapshot({ ...empty, owners, forged: [watcher(1, 3, ids, A)] });
    for (const id of ids) expect(s.frogs[id - 1]).toMatchObject({ dead: true, into: 1, rate: 0, o: -1 });
    expect(s.totals.burned).toBe(10);
    expect(s.totals.held).toBe(490);
    expect(s.totals.watchers).toBe(1);
    expect(s.wallets).not.toContain(DEAD);
  });
  it("counts a mission only while the frog is still in the wallet that sent it", () => {
    const owners = base();
    const s = shipSnapshot({ ...empty, owners, forged: [watcher(2, 1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], C)], missions: [
      { wallet: A, frog: 1, mission: "desk-duty", startedAt: 5, done: false },
      { wallet: A, frog: 2, mission: "board-watch", startedAt: 5, done: false }, // #2 is B's now
      { wallet: C, frog: FORGED_ID + 2, mission: "beat-the-holder", startedAt: 6, done: true },
    ] });
    expect(s.frogs[0]!.mission).toEqual({ id: "desk-duty", title: "Desk duty", since: 5, done: false });
    expect(s.frogs[1]!.mission).toBeNull();
    expect(s.watchers[0]!.missions).toEqual([{ id: "beat-the-holder", title: "Beat the holder", since: 6, done: true }]);
    expect(s.totals.onMissions).toBe(1);
  });
  it("draws only the loans worth a liquidation on the radar, without their owners", () => {
    const pos = (owner: string, debt: bigint, cr: bigint) => ({ owner, collateral: 0n, debt, cr, state: "safe" as const, marker: null, opensAt: null, closesAt: null, maxRepay: 0n });
    const book = { at: 9, now: 9, block: 1, mat: 170n, lull: 21600n, tail: 0n, chip: 0n, cut: 0n, chop: 20n, price: 0n, stale: [], totalDebt: 10n ** 21n, supply: 10n ** 21n, backing: 0n, peg: 1, owners: 2,
      positions: [pos("0x1234567890abcdef1234567890abcdef12345678", 20n * 10n ** 18n, 237n), pos("0xabcdef1234567890abcdef1234567890abcdef12", 10n ** 18n, 180n)] } as Book;
    const s = shipSnapshot({ ...empty, owners: base(), forged: [], book });
    expect(s.radar!.loans).toHaveLength(1);
    expect(s.radar!.loans[0]).toMatchObject({ cr: 237, debt: 20, state: "safe" });
    expect(JSON.stringify(s.radar)).not.toContain("1234567890abcdef");
    expect(s.radar!.mat).toBe(170);
  });
  it("gives the Captain's seat to #1's holder, then to The Captain's", () => {
    const owners = base();
    expect(shipSnapshot({ ...empty, owners, forged: [] }).captain).toMatchObject({ forged: false, holder: 0 });
    owners[0] = DEAD;
    const s = shipSnapshot({ ...empty, owners, forged: [watcher(0, 6, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], C)], watch: [{ watcher: 0, online: true }] });
    expect(s.wallets[s.captain.holder]).toBe(C);
    expect(s.captain).toMatchObject({ forged: true, watch: { paired: true, online: true } });
    expect(s.frogs[0]).toMatchObject({ dead: true, into: 0 });
    expect(boosts(owners, [{ tier: 6, owner: C }]).get(C)).toBe(150);
  });
});

describe("a wallet's crew", () => {
  it("adds up its rates and suggests the best forge from its own frogs", () => {
    const owners = base().map(() => B);
    for (let id = 200; id < 212; id++) owners[id - 1] = A;
    const s = shipSnapshot({ ...empty, owners, forged: [] });
    const c = crewOf(s, A.toUpperCase().replace("0X", "0x"), { hours: 12, rank: 3, companies: 1, baseSlots: 5, frogSlots: 2 });
    expect(c.frogs).toEqual([200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211]);
    expect(c.perHour).toBe(12);
    expect(c.slots).toBe(7);
    expect(c.forge).not.toBeNull();
    expect(c.forge!.ids).toHaveLength(10);
    expect(c.forge!.ids.every((id) => c.frogs.includes(id))).toBe(true);
    expect(c.forge!.rate).toBeGreaterThanOrEqual(c.forge!.before);
    expect(crewOf(s, C, { hours: 0, rank: null, companies: 0, baseSlots: 5, frogSlots: 2 })).toMatchObject({ frogs: [], slots: 5, forge: null });
  });
});
