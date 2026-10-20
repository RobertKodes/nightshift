import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Locker, XP } from "./locker.js";
import { ASSETS, CATALOG, ITEMS, KINDS, PRICES, STARTER, SUPPLY, editionText, levelOf, priceOf, xpFor } from "./pool/catalog.js";

const W1 = "0x1111111111111111111111111111111111111111", W2 = "0x2222222222222222222222222222222222222222", TG = "tg:0123456789abcdef";
const key = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

describe("the cosmetics catalogue", () => {
  it("has unique ids, every kind, a standard issue of each, and designs for the art", () => {
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
    for (const k of KINDS) {
      expect(CATALOG.some((i) => i.kind === k && i.rarity === "standard"), k).toBe(true);
      expect(CATALOG.filter((i) => i.kind === k).length, k).toBeGreaterThanOrEqual(k === "title" || k === "emote" ? 4 : 5);
    }
    for (const [k, v] of Object.entries(STARTER)) for (const id of [v].flat()) expect(ITEMS.get(id)?.kind, `${k} ${id}`).toBe(k);
    for (const i of CATALOG) expect(i.design, i.id).toBeTruthy();
  });
  it("stays cosmetic: the only stat is a cue's aim guide, at most +12%", () => {
    for (const i of CATALOG) {
      expect(Object.keys(i).filter((k) => !["id", "kind", "name", "line", "rarity", "unlock", "design", "guide"].includes(k)), i.id).toEqual([]);
      if (i.guide !== undefined) { expect(i.kind).toBe("cue"); expect(i.guide).toBeGreaterThanOrEqual(0); expect(i.guide).toBeLessThanOrEqual(12); }
    }
  });
  it("numbers its editions and lists shop prices in IMD, ETH, SHIFT and USDC", () => {
    expect(SUPPLY).toEqual({ standard: null, rare: 1000, epic: 250, legendary: 50, mythic: 7 });
    const frog = ITEMS.get("cue-frog")!;
    expect(editionText(frog, 7)).toBe("NIGHT FROG Cue #7, 1 of 50");
    expect(editionText(ITEMS.get("cue-crew")!)).toBe("Night Crew Cue");
    for (const i of CATALOG) {
      const p = priceOf(i);
      if (i.unlock.by === "shop") expect(Object.keys(p!).sort()).toEqual([...ASSETS].sort());
      else expect(p).toBeNull();
    }
    for (const p of Object.values(PRICES)) for (const v of Object.values(p)) expect(Number(v)).toBeGreaterThan(0);
  });
  it("levels: 100 XP to level 2, then a little more each level", () => {
    expect([xpFor(1), xpFor(2), xpFor(3), xpFor(5)]).toEqual([0, 100, 300, 1000]);
    expect([levelOf(0), levelOf(99), levelOf(100), levelOf(299), levelOf(300), levelOf(4500)]).toEqual([1, 1, 2, 2, 3, 10]);
  });
});

describe("the locker", () => {
  it("everyone has the standard issue on; only owned items can be worn", () => {
    const l = new Locker(null);
    const me = l.self(W1);
    expect(me.equip).toEqual({ ...STARTER, emote: STARTER.emote });
    expect(me.level).toBe(1);
    expect(() => l.equip(W1, "cue", "cue-frog")).toThrow(/not in your locker/);
    expect(() => l.equip(W1, "cue", "cloth-night")).toThrow(/does not go in this slot/);
    expect(() => l.equip(W1, "hat", "cue-crew")).toThrow(/No such slot/);
    l.grant(l.profile(W1), "cue-frog", "grant");
    expect(l.equip(W1, "cue", "cue-frog").equip.cue).toBe("cue-frog");
    expect(l.equip(W1, "emote", ["emote-gg", "emote-oops"]).equip.emote).toEqual(["emote-gg", "emote-oops"]);
    expect(() => l.equip(W1, "emote", ["emote-eyes"])).toThrow(/not in your locker/);
    expect(() => l.equip(W1, "emote", [])).toThrow(/Choose 1 to 6/);
  });
  it("hands out numbered copies in order, never the same serial twice, and no more than the edition", () => {
    const l = new Locker(null);
    const serials: number[] = [];
    for (let n = 1; n <= 52; n++) {
      const o = l.grant(l.profile(key(n)), "cue-frog", "grant");
      if (o) serials.push(o.serial!);
    }
    expect(serials).toEqual([...Array(50)].map((_, i) => i + 1));
    expect(l.left("cue-frog")).toBe(0);
    // a profile holds one copy of an item, the same one when asked again
    const p = l.profile(key(1));
    expect(l.grant(p, "cue-frog")!.serial).toBe(1);
    expect(p.items.filter((o) => o.id === "cue-frog")).toHaveLength(1);
    expect(l.grant(p, "cue-crew")).toBeNull(); // standard issue: no copy needed
  });
  it("purchases: the four assets, coming soon, nothing charged or handed out", () => {
    const l = new Locker(null);
    for (const a of ASSETS) expect(l.purchase("cue-frog", a)).toMatchObject({ ok: false, status: "coming-soon", item: "cue-frog", asset: a, price: PRICES.legendary[a] });
    expect(() => l.purchase("cue-frog", "DOGE")).toThrow(/IMD, ETH, SHIFT or USDC/);
    expect(() => l.purchase("cue-frog", "stars")).toThrow(/IMD, ETH, SHIFT or USDC/);
    expect(() => l.purchase("cue-lily", "USDC")).toThrow(/earned, not sold/);
    expect(() => l.purchase("cue-crew", "USDC")).toThrow(/already yours/);
    expect(l.get(W1)).toBeUndefined();
    expect(l.catalog().find((i) => i.id === "cue-frog")).toMatchObject({ price: PRICES.legendary, left: 50, supply: 50 });
    // when the shop is wired, a paid copy is handed out like any other: the next serial
    expect(l.grant(l.profile(W2), "cue-frog", "purchase")).toMatchObject({ serial: 1, via: "purchase" });
  });
  it("games give XP and levels; levels and badges unlock numbered rewards", () => {
    const l = new Locker(null);
    const r = l.record(W1, { game: "pool", result: "win", name: "Pearl", potted: 4 });
    expect(r.xp).toBe(XP.pool.win + 4 * XP.pool.ball);
    expect(r.badges.sort()).toEqual(["first-break", "first-win"]);
    expect(r.level).toBe(2);
    // level 2 unlocks the Ribbit emote: copy #1
    expect(r.unlocked).toMatchObject([{ id: "emote-ribbit", serial: 1, via: "reward" }]);
    for (let i = 0; i < 9; i++) l.record(W1, { game: "pool", result: "win", potted: 3 });
    const me = l.self(W1);
    expect(me.badges.map((b) => b.id)).toContain("night-shark");
    expect(me.items.map((o) => o.id)).toEqual(expect.arrayContaining(["emote-ribbit", "cue-lily", "cloth-pond", "frame-lily", "title-shark", "balls-neon"]));
    expect(me.items.find((o) => o.id === "title-shark")!.edition).toBe("Night Shark #1, 1 of 1000");
    expect(me.stats.pool).toMatchObject({ played: 10, wins: 10, streak: 10, best: 10 });
    expect(l.record(W2, { game: "chess", result: "draw" }).xp).toBe(XP.chess.draw);
  });
  it("a pool game's end books both players and the badges the table saw", () => {
    const l = new Locker(null);
    l.poolEnded({ id: "x", rules: "wpa", staked: true, reason: "rack", rated: true, players: [
      { key: W1, name: "Pearl", result: "win", potted: 7, shots: 9, rating: 1212, change: 12, broke: true, ranOut: true, eightOnBreak: false, cleanSheet: true },
      { key: TG, name: "Onyx", result: "loss", potted: 0, shots: 0, rating: 1188, change: -12, broke: false, ranOut: false, eightOnBreak: false, cleanSheet: false },
    ] });
    const a = l.self(W1), b = l.self(TG);
    expect(a.badges.map((x) => x.id)).toEqual(expect.arrayContaining(["break-and-run", "clean-sheet", "staked", "first-win"]));
    expect(a.items.map((o) => o.id)).toEqual(expect.arrayContaining(["frame-crown", "title-runner"]));
    expect(b.stats.pool).toMatchObject({ played: 1, losses: 1 });
    // an unrated game the loser left books nothing for them
    l.poolEnded({ id: "y", rules: "wpa", staked: false, reason: "abandonment", rated: false, players: [{ key: W2, name: "Gone", result: "loss", potted: 0, shots: 0, rating: 1200, change: 0, broke: false, ranOut: false, eightOnBreak: false, cleanSheet: false }] });
    expect(l.get(W2)).toBeUndefined();
  });
  it("brings the player's look to the table: the guide of their cue in free games, the standard guide in staked ones", () => {
    const l = new Locker(null);
    l.grant(l.profile(W1), "cue-frog");
    l.equip(W1, "cue", "cue-frog");
    expect(l.look(W1, false)).toMatchObject({ cue: "cue-frog", guide: 1.08, serials: { "cue-frog": 1 }, level: 1 });
    expect(l.look(W1, true).guide).toBe(1);
    expect(l.look(null, false)).toMatchObject({ cue: "cue-crew", guide: 1 });
  });
  it("keeps profiles and serials across a restart", () => {
    const file = join(mkdtempSync(join(tmpdir(), "locker-")), "locker.json");
    const a = new Locker(file);
    a.record(W1, { game: "pool", result: "win", name: "Pearl" });
    a.setAvatar(W1, 3);
    a.flush();
    const b = new Locker(file);
    expect(b.self(W1)).toMatchObject({ name: "Pearl", avatar: 3, level: 2 });
    expect(b.left("emote-ribbit")).toBe(999);
    // the next copy continues the numbering
    expect(b.grant(b.profile(W2), "emote-ribbit")!.serial).toBe(2);
    expect(() => b.setAvatar(W1, 9)).toThrow(/five crew frogs/);
    expect(() => b.profile("someone")).toThrow(/No such player/);
  });
});
