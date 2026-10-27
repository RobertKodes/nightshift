import { describe, expect, it } from "vitest";
import { CAPTAIN_CREW, CAPTAIN_TIER, FORGED_ID, FORGE_TIERS, OT_PARTS, SHOWCASE, SKIN_PARTS, TABLE, checkIds, forgedSvg, frogOf, inherit, plan, preview, rendererSvg, shiftRate, skinSvg, tierFor, watcherRate } from "./forge.js";
import { crewBoosts, multiplier } from "./frogs.js";
import { Missions } from "./missions.js";

const of = (tier: string) => TABLE.tokens.filter((t) => t.tier === tier && t.id > 77).map((t) => t.id);
const L = of("Legendary"), E = of("Epic"), R = of("Rare"), U = of("Uncommon"), C = of("Common");

describe("forge table", () => {
  it("has every frog once, 25/50/75/125/225 by rarity, and packs the same points the contract reads", () => {
    expect(TABLE.tokens.map((t) => t.id)).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));
    const n = (t: string) => TABLE.tokens.filter((x) => x.tier === t).length;
    expect([n("Legendary"), n("Epic"), n("Rare"), n("Uncommon"), n("Common")]).toEqual([25, 50, 75, 125, 225]);
    for (const t of TABLE.tokens) {
      const code = Number((BigInt(TABLE.packed[Math.floor((t.id - 1) / 85)]!) >> BigInt(((t.id - 1) % 85) * 3)) & 7n);
      expect(TABLE.codes[code]).toBe(t.points);
    }
  });
  it("counts a Genesis frog at least as a Rare, and #2-25 at least as an Epic", () => {
    expect(frogOf(1)!.points).toBe(16);
    for (let id = 2; id <= 25; id++) expect(frogOf(id)!.points).toBeGreaterThanOrEqual(8);
    for (let id = 26; id <= 77; id++) expect(frogOf(id)!.points).toBeGreaterThanOrEqual(4);
  });
});

describe("forging 10 into 1", () => {
  it("sets the tier by the share of rare frogs in the 10", () => {
    expect(tierFor(10).name).toBe("Shift Lead");
    expect(tierFor(39).tier).toBe(2);
    expect(tierFor(40).tier).toBe(3);
    expect(tierFor(128).tier).toBe(5);
    expect(preview(C.slice(0, 10)).tier).toBe(1);
    expect(preview(U.slice(0, 10)).tier).toBe(2);
    // half of the 10 better: a higher frog; 1 good one with 9 weak: a lower one
    expect(preview([...E.slice(0, 5), ...C.slice(0, 5)]).tier).toBe(3);
    expect(preview([E[0]!, ...C.slice(0, 9)]).tier).toBe(1);
    expect(preview([...L.slice(0, 5), ...C.slice(0, 5)]).tier).toBe(4);
    expect(preview([L[0]!, ...C.slice(0, 9)]).tier).toBe(2);
    expect(preview([...L.slice(0, 6), ...E.slice(0, 4)]).tier).toBe(5);
    const p = preview([...R.slice(0, 10)]);
    expect(p.points).toBe(40);
    expect(p.rate).toBe(20);
    expect(p.mix.Rare).toBe(10);
    expect(preview(C.slice(0, 10)).toNext).toBe(10);
  });
  it("pays rarity: 10x for ten commons up to 40x for a Night Boss, and #1 stays the top at 50x", () => {
    expect(multiplier(1)).toBe(50);
    const xs = FORGE_TIERS.map((t) => t.x);
    expect(xs).toEqual([10, 15, 20, 30, 40]);
    for (const x of xs) { expect(x).toBeGreaterThan(multiplier(2)); expect(x).toBeLessThan(multiplier(1)); }
    // the best Night Watcher anyone could forge still earns less than #1
    expect(preview(Array.from({ length: 10 }, (_, i) => i + 2)).rate).toBeLessThan(multiplier(1));
  });
  it("never earns less than its 10 frogs did", () => {
    const pool = Array.from({ length: 499 }, (_, i) => i + 2);
    for (let n = 0; n < 300; n++) {
      const ids = [...pool].sort(() => Math.random() - 0.5).slice(0, 10);
      expect(preview(ids).rate).toBeGreaterThanOrEqual(ids.reduce((s, id) => s + shiftRate(id), 0));
    }
    for (const ids of [Array.from({ length: 10 }, (_, i) => i + 2), Array.from({ length: 10 }, (_, i) => i + 26)]) expect(preview(ids).rate).toBeGreaterThanOrEqual(ids.reduce((s, id) => s + shiftRate(id), 0));
  });
  it("shows one real combo for every tier", () => {
    expect(SHOWCASE.map((ids) => preview(ids).tier)).toEqual([1, 2, 3, 4, 5]);
  });
  it("makes The Captain as well when #1 is among the 10, the best in the collection, and counts #1's 50x once", () => {
    const ids = [1, ...SHOWCASE[4]!.slice(1)];
    const p = preview(ids);
    expect(p.captain).toBe(true);
    expect(preview(SHOWCASE[4]!).captain).toBe(false);
    expect(CAPTAIN_TIER.x).toBeGreaterThan(multiplier(1));
    expect(CAPTAIN_TIER.x).toBeGreaterThan(FORGE_TIERS[4]!.x);
    expect(CAPTAIN_TIER.crew).toBe(CAPTAIN_CREW);
    expect(watcherRate(6, ids)).toBe(CAPTAIN_TIER.x);
    // the other Night Watcher's floor counts the other 9, not #1
    expect(p.rate).toBe(Math.max(FORGE_TIERS[p.tier - 1]!.x, ids.slice(1).reduce((t, id) => t + shiftRate(id), 0)));
    // a wallet's plans never put #1 in by themselves
    expect(plan(Array.from({ length: 12 }, (_, i) => i + 1)).strongest).not.toContain(1);
  });
  it("refuses anything but 10 different frogs", () => {
    const nine = [2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(() => checkIds(nine)).toThrow(/exactly 10/);
    expect(() => checkIds([...nine, 9])).toThrow(/exactly 10/);
    expect(() => checkIds([...nine, 501])).toThrow(/exactly 10/);
    expect(checkIds([...nine, 11].map(String))).toEqual([...nine, 11]);
  });
  it("wears the rarest trait of each layer among the 10", () => {
    const ids = [...L.slice(0, 3), ...C.slice(0, 7)];
    inherit(ids).forEach((v, l) => {
      const min = Math.min(...ids.map((id) => TABLE.counts[l]![frogOf(id)!.traits[l]!]!));
      expect(TABLE.counts[l]![v]).toBe(min);
    });
  });
  it("finds the cheapest 10 for each tier a wallet can reach", () => {
    const owned = [...C.slice(0, 12), ...E.slice(0, 3), L[0]!];
    const r = plan(owned);
    expect(r.strongest).toHaveLength(10);
    const tiers = r.cheapest.map((c) => c.tier);
    expect(tiers).toContain(1);
    expect(tiers).toContain(3);
    for (const c of r.cheapest) { expect(c.ids).toHaveLength(10); expect(tierFor(c.points).tier).toBe(c.tier); }
    expect(plan(C.slice(0, 9)).strongest).toBeNull();
  });
  it("draws the frame in the tier colour and escapes a Night Boss name", () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const s = forgedSvg(7, 5, [0, 0, 0, 0, 0, 0, 1], "<b>&", ten, 130);
    expect(s).toContain(`color="${FORGE_TIERS[4]!.color}"`);
    expect(s).toContain("NIGHT WATCHERS #7");
    expect(s).toContain(">NIGHT WATCHER<");
    expect(s).toContain(">NW7<");
    expect(s).not.toContain("<b>");
    expect(s).toContain("FORGED FROM #1 #2 #3 #4 #5 #6 #7 #8 #9 #10");
    expect(s).toContain(`flood-color="${FORGE_TIERS[4]!.color}"`);
    expect(forgedSvg(null, 1, [0, 0, 0, 0, 0, 0, 0])).toContain(">#?<");
  });
});

describe("Night Watchers on missions", () => {
  it("lets a Night Watcher crew every mission with its tier's multiplier", () => {
    const facts = { leagueTrades: 3, leagueBestPct: null, benchmarkPct: null, arenaGames: 0 };
    const ms = new Missions(null, () => Date.UTC(2026, 9, 21));
    const frogs = [{ id: FORGED_ID + 1, multiplier: 12, crew: true }, { id: 300, multiplier: 1 }];
    ms.start("0xW", frogs, "desk-duty", FORGED_ID + 1, facts);
    ms.start("0xW", frogs, "board-watch", FORGED_ID + 1, facts);
    expect(ms.report("0xW", frogs, "desk-duty", facts)).toBe(24 * 12);
    expect(() => ms.report("0xW", [], "board-watch", facts)).toThrow(/Night Watcher #1 has left/);
  });
  it("counts the week per frog, so passing a frog to another wallet does not crew it again", () => {
    const facts = { leagueTrades: 3, leagueBestPct: null, benchmarkPct: null, arenaGames: 0 };
    const ms = new Missions(null, () => Date.UTC(2026, 9, 21));
    const frog = [{ id: 1, multiplier: 7 }], watcher = [{ id: FORGED_ID + 1, multiplier: 12, crew: true }];
    ms.start("0xA", frog, "desk-duty", 1, facts);
    expect(ms.report("0xA", frog, "desk-duty", facts)).toBe(24 * 7);
    expect(() => ms.start("0xB", frog, "desk-duty", 1, facts)).toThrow(/Frog #1 is already out/);
    expect(() => ms.start("0xB", frog, "board-watch", 1, facts)).toThrow(/Frog #1 is already out/);
    ms.start("0xA", watcher, "board-watch", FORGED_ID + 1, facts);
    expect(() => ms.start("0xB", watcher, "board-watch", FORGED_ID + 1, facts)).toThrow(/Night Watcher #1 is already out/);
    ms.start("0xB", watcher, "beat-the-holder", FORGED_ID + 1, facts);
  });
});

describe("the identity layer and the perks", () => {
  it("draws the identity layer over the card, just before it closes, with more of it at higher tiers", () => {
    const ids = SHOWCASE[4]!, p = preview(ids), traits = p.traits.map((t) => t.index);
    const card = rendererSvg(50, 5, traits, "KODES", ids, p.points), full = forgedSvg(50, 5, traits, "KODES", ids, p.points);
    expect(full).toBe(card.slice(0, -6) + skinSvg(50, 5, ids) + "</svg>");
    expect(skinSvg(50, 5, ids)).toContain("ID / #0050 / ON WATCH");
    expect(skinSvg(null, 1, ids)).toContain("#????");
    expect(skinSvg(1, 1, ids)).not.toContain("animateMotion");
    expect(skinSvg(1, 5, ids).match(/animateMotion/g)).toHaveLength(2);
    expect(skinSvg(1, 3, ids)).toContain("00a:02d:067");
    expect(skinSvg(1, 4, ids)).toContain("url(#nwE)");
  });
  it("lifts a holder's other frogs by the best Night Watcher's crew boost, and #1's holder the most", () => {
    expect(FORGE_TIERS.map((t) => t.crew)).toEqual([20, 30, 50, 75, 100]);
    const ok = (o: string) => ({ status: "success", result: o });
    const boosts = crewBoosts([ok("0xCAPTAIN"), ok("0xa")], [ok("0xa"), ok("0xA"), ok("0xb")], [{ tier: 2 }, { tier: 5 }, { tier: 1 }]);
    expect(boosts.get("0xa")).toBe(100);
    expect(boosts.get("0xb")).toBe(20);
    expect(boosts.get("0xcaptain")).toBe(CAPTAIN_CREW);
    expect(CAPTAIN_CREW).toBeGreaterThan(FORGE_TIERS[4]!.crew);
  });
});

describe("the forge order", () => {
  it("pins the art test vectors in the renderer and skin orders to rendererSvg and skinSvg", async () => {
    const { keccak256, toBytes } = await import("viem");
    const { FORGE_OBJECTIVE, FORGE_VECTORS, RENDERER_OBJECTIVE, vectorLabel } = await import("./order-forge.js");
    expect(FORGE_VECTORS.map((v) => v.tier)).toEqual([1, 2, 3, 5, 6]);
    expect(FORGE_VECTORS.some((v) => v.traits[6] === 1)).toBe(true); // the crew badge is covered
    for (const v of FORGE_VECTORS) {
      const p = preview(v.ids);
      // The Captain wears #1's own traits; every other vector is exactly what the forge makes of its 10
      if (v.tier === 6) expect([p.captain, p.points, v.traits]).toEqual([true, v.points, frogOf(1)!.traits]);
      else expect([p.tier, p.points, p.traits.map((t) => t.index)]).toEqual([v.tier, v.points, v.traits]);
      expect(keccak256(toBytes(rendererSvg(v.n, v.tier, v.traits, vectorLabel(v), v.ids, v.points)))).toBe(v.keccak);
      expect(RENDERER_OBJECTIVE).toContain(v.keccak);
    }
    const { SKIN_OBJECTIVE, SKIN_VECTORS } = await import("./order-forge.js");
    const skin = SKIN_OBJECTIVE();
    expect(SKIN_VECTORS.map((v) => v.tier)).toEqual([1, 3, 5, 6]);
    for (const v of SKIN_VECTORS) { expect(keccak256(toBytes(skinSvg(v.n, v.tier, v.inputs)))).toBe(v.keccak); expect(skin).toContain(v.keccak); }
    for (const part of Object.values(SKIN_PARTS)) expect(skin).toContain(part);
    expect(skin.length).toBeLessThanOrEqual(7895);
    for (const part of Object.values(OT_PARTS)) expect(RENDERER_OBJECTIVE).toContain(part);
    for (const w of TABLE.packed) expect(FORGE_OBJECTIVE).toContain(w);
    // IMD adds its own wrapper for the test and audit steps: 7,988 was refused, 7,895 passed
    expect(RENDERER_OBJECTIVE.length).toBeLessThanOrEqual(7895);
    expect(FORGE_OBJECTIVE.length).toBeLessThanOrEqual(7895);
  });
});
