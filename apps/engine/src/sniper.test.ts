import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import type { HookReport } from "./services/hook.js";
import type { LaunchDetail, LaunchRow } from "./services/imd.js";
import type { Slot0 } from "./services/v4pool.js";
import type { VerdictReport } from "./services/verdict.js";
import { type Call, type NftRead, type SniperDeps, callCard, createSniper, launchVerdict, launcherShare, newHit, priceOf, recapText, sniperStats } from "./sniper.js";

const TOKEN = "0x00000000000000000000000000000000000000aa" as Address;
const HOOK = "0x00000000000000000000000000000000000000cc";
const NATIVE = "0x0000000000000000000000000000000000000000";
const sqrtOf = (price: number): bigint => BigInt(Math.floor(Math.sqrt(price) * 2 ** 96));
/** slot0 for a pool whose currency1 is worth `ratio` per currency0. */
const slot = (ratio: number): Slot0 => ({ sqrtPriceX96: sqrtOf(ratio), tick: 0, protocolFee: 0, lpFee: 12500, liquidity: 1n });

function launch(n: number, at: number, extra: Partial<LaunchRow> = {}): LaunchRow {
  return {
    id: `id-${n}`, launchNumber: n, kind: "custom_token", status: "live", chainId: 1, sourceRepoUrl: `https://github.com/identity-md-launches/launch-${n}`,
    artifacts: [{ role: "token", name: "Frog Coin", address: TOKEN }],
    seeded: { pools: [{ fee: 12500, hooks: HOOK, currency0: NATIVE, currency1: TOKEN, tickSpacing: 60 }] },
    createdAt: new Date(at).toISOString(), ...extra,
  };
}

function verdict(v: "safe" | "caution" | "avoid"): VerdictReport {
  return {
    verdict: v, summary: v === "avoid" ? "The owner can mint without limit." : "No problem found.",
    reasons: [
      { id: "r1", impact: v === "avoid" ? "avoid" : v === "caution" ? "caution" : "good", text: v === "avoid" ? "The owner can mint without limit" : "Owner powers checked", evidence: [] },
      { id: "liquidity", impact: "caution", text: "The pool holds no ETH right now: nobody has bought yet, or every buyer has sold.", evidence: [] },
      { id: "unverified", impact: "caution", text: "Source not verified (sourcify)", evidence: [] },
      { id: "r2", impact: "note", text: "a note", evidence: [] },
    ],
    imd: { isLaunch: true, repo: "https://github.com/identity-md-launches/launch-1" },
    asset: { name: "Frog Coin", symbol: "FROG", decimals: 18, totalSupply: (10n ** 27n).toString() }, pool: null,
  } as unknown as VerdictReport;
}

const LAUNCHER = "0x00000000000000000000000000000000000000dd";
const hookReport = (powers: { text: string; level: "high" | "medium" | "low" | "info" }[]) => ({
  address: HOOK, summary: "Takes a 1% fee on swaps.", risk: powers.some((p) => p.level === "high") ? "high" : "low", template: { name: "LaunchHook" }, powers, fees: { swapFee: "1.25%", hookFee: "none" },
}) as unknown as HookReport;

function rig(o: { verdict?: "safe" | "caution" | "avoid"; delayMs?: number; poolBps?: number; hook?: HookReport | null; nft?: NftRead | null } = {}) {
  let now = Date.parse("2026-10-23T12:00:00Z");
  let rows: LaunchRow[] = [launch(100, now - 3_600_000)];
  let price = 1e-9;
  let nft: NftRead | null = o.nft ?? null;
  const posts: { text: string; buttons: { text: string; url?: string }[][]; replyTo?: { chat: string; id: number }[] }[] = [];
  const pushes: string[] = [];
  let id = 0;
  const d: SniperDeps = {
    now: () => now,
    launches: async () => rows,
    detail: async (id: string) => ({ id, requester: LAUNCHER, kind: "custom_token", economics: { poolBps: o.poolBps ?? 8800 } }) as unknown as LaunchDetail,
    verdict: async () => verdict(o.verdict ?? "safe"),
    hook: async () => o.hook ?? null,
    nft: async () => (nft ? { ...nft } : null),
    // the token is currency1 against ETH: the pool counts tokens per ETH
    slot0: async (_: Hex) => slot(1 / price),
    decimals: async () => 18,
    usdOf: async () => 4000,
    post: async (text, buttons, replyTo) => { posts.push({ text, buttons, replyTo }); return [{ chat: "@c", id: ++id }]; },
    push: async (c: Call, who) => { pushes.push(`${who}:${c.launch}`); },
    delayMs: o.delayMs ?? 180_000,
    file: null,
  };
  const s = createSniper(d);
  return {
    s, posts, pushes,
    at: (ms: number) => { now += ms; },
    add: (n: number, extra: Partial<LaunchRow> = {}) => { rows = [launch(n, now, extra), ...rows]; },
    price: (p: number) => { price = p; },
    minted: (n: number) => { if (nft) nft = { ...nft, minted: n }; },
  };
}

describe("NIGHT SNIPER", () => {
  it("starts quietly: launches made before the first run are not called", async () => {
    const r = rig();
    await r.s.tick();
    expect(r.s.calls(true)).toEqual([]);
    expect(r.posts).toEqual([]);
  });

  it("calls a new launch to holders at once and to the community after the delay", async () => {
    const r = rig();
    await r.s.tick();
    r.add(101);
    await r.s.tick();
    expect(r.pushes).toEqual(["holders:101"]);
    expect(r.posts).toEqual([]);
    expect(r.s.calls(true).map((c) => c.launch)).toEqual([101]);
    expect(r.s.calls(false)).toEqual([]);
    r.at(180_000);
    await r.s.tick();
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]!.text).toContain("IMD launch #101");
    expect(r.posts[0]!.text).toContain("✅ SAFE");
    expect(r.posts[0]!.buttons[0]![0]!.url).toContain(`outputCurrency=${TOKEN}`);
    expect(r.pushes).toEqual(["holders:101", "everyone:101"]);
    expect(r.s.calls(false).map((c) => c.launch)).toEqual([101]);
  });

  it("replies under the call at each new milestone, once, and when it dumps", async () => {
    const r = rig({ delayMs: 0 });
    await r.s.tick();
    r.add(101);
    await r.s.tick();
    await r.s.tick();
    expect(r.posts).toHaveLength(1);
    r.price(2.4e-9); r.at(5 * 60_000); await r.s.tick();
    expect(r.posts.at(-1)!.text).toContain("$FROG 2x");
    expect(r.posts.at(-1)!.replyTo).toEqual([{ chat: "@c", id: 1 }]);
    r.at(5 * 60_000); await r.s.tick();
    expect(r.posts).toHaveLength(2);
    r.price(5.5e-9); r.at(5 * 60_000); await r.s.tick();
    expect(r.posts.at(-1)!.text).toContain("$FROG 5x");
    r.price(3.1e-9); r.at(5 * 60_000); await r.s.tick();
    expect(r.posts).toHaveLength(3);
    r.price(0.1e-9); r.at(5 * 60_000); await r.s.tick();
    expect(r.posts.at(-1)!.text).toContain("down 80%");
    r.at(5 * 60_000); await r.s.tick();
    expect(r.posts).toHaveLength(4);
  });

  it("gives an avoid call no buy button", async () => {
    const r = rig({ verdict: "avoid", delayMs: 0 });
    await r.s.tick();
    r.add(102);
    await r.s.tick();
    await r.s.tick();
    const card = r.posts[0]!;
    expect(card.text).toContain("⛔ AVOID");
    expect(card.buttons.flat().map((b) => b.text)).not.toContain("🦄 Buy on Uniswap");
  });

  it("skips launches on other chains, launches without a token, and old ones", async () => {
    const r = rig({ delayMs: 0 });
    await r.s.tick();
    r.add(103);
    r.add(104, { chainId: 4663 });
    r.add(105, { artifacts: [] });
    r.add(106, { createdAt: "2026-10-22T00:00:00Z" });
    r.add(107, { status: "parked" });
    await r.s.tick();
    expect(r.s.calls(true).map((c) => c.launch)).toEqual([103]);
  });
});

describe("hooks, launchers and NFT launches", () => {
  it("names the launcher, the share it keeps and its other launches", async () => {
    const r = rig({ delayMs: 0 });
    await r.s.tick();
    r.add(101); await r.s.tick(); await r.s.tick();
    r.add(102); await r.s.tick(); await r.s.tick();
    const c = r.s.calls(true)[0]!;
    expect(c.launcher).toEqual({ address: LAUNCHER, keepsPct: 2 });
    expect(r.s.historyOf(c).map((h) => h.launch)).toEqual([101]);
    expect(r.posts.at(-1)!.text).toContain("keeps 2% of supply");
    expect(r.posts.at(-1)!.text).toContain("1 earlier launch");
    expect(r.s.launchers(true)[0]).toMatchObject({ address: LAUNCHER, called: 2 });
  });

  it("calls a launcher keeping a fifth of the supply or more avoid", async () => {
    const r = rig({ delayMs: 0, poolBps: 6000 });
    await r.s.tick(); r.add(101); await r.s.tick();
    const c = r.s.calls(true)[0]!;
    expect(c.verdict).toBe("avoid");
    expect(c.reasons[0]!.text).toContain("keeps 30% of the supply");
  });

  it("reads the hook and counts its high powers", async () => {
    const r = rig({ delayMs: 0, hook: hookReport([{ text: "the owner can set the swap fee to anything", level: "high" }]) });
    await r.s.tick(); r.add(101); await r.s.tick(); await r.s.tick();
    const c = r.s.calls(true)[0]!;
    expect(c.verdict).toBe("caution");
    expect(c.hook).toMatchObject({ template: "LaunchHook", risk: "high" });
    expect(r.posts[0]!.text).toContain("🪝 Hook LaunchHook: high risk");
  });

  it("calls an NFT launch and replies as it mints out", async () => {
    const r = rig({ delayMs: 0, nft: { standard: "ERC-721", name: "Night Watchers", symbol: "NW", maxSupply: 50, minted: 0, price: { amount: 2, unit: "IMD" }, owner: LAUNCHER } });
    await r.s.tick();
    r.add(110, { kind: "evm_contracts", artifacts: [{ role: "other", name: "NightWatchers", address: "0x00000000000000000000000000000000000000ee" }] });
    await r.s.tick(); await r.s.tick();
    expect(r.posts[0]!.text).toContain("NEW NFT LAUNCH");
    expect(r.posts[0]!.text).toContain("0 of 50 minted");
    expect(r.posts[0]!.text).toContain("Mint price: 2 IMD");
    r.minted(26); r.at(5 * 60_000); await r.s.tick();
    expect(r.posts.at(-1)!.text).toContain("is 50% minted");
    r.minted(50); r.at(5 * 60_000); await r.s.tick();
    expect(r.posts.at(-1)!.text).toContain("sold out");
    r.at(5 * 60_000); await r.s.tick();
    expect(r.posts).toHaveLength(3);
  });

  it("works out the launcher's share from IMD's economics", () => {
    expect(launcherShare({ kind: "custom_token", economics: { poolBps: 9000 } } as never)).toBe(0);
    expect(launcherShare({ kind: "custom_token", economics: { poolBps: 8800 } } as never)).toBe(2);
    expect(launcherShare({ kind: "univ4_hook", economics: {} } as never)).toBeNull();
  });
});

describe("the launch verdict", () => {
  it("does not hold an empty pool or an IMD repo's source against a launch", () => {
    expect(launchVerdict(verdict("safe")).verdict).toBe("safe");
    expect(launchVerdict(verdict("safe")).summary).toContain("No red flags at launch");
    expect(launchVerdict(verdict("caution")).verdict).toBe("caution");
    expect(launchVerdict(verdict("avoid"))).toMatchObject({ verdict: "avoid", summary: "1 red flag." });
    expect(launchVerdict(verdict("avoid")).reasons[0]).toEqual({ impact: "avoid", text: "The owner can mint without limit" });
    expect(launchVerdict(verdict("caution")).summary).toBe("1 thing to watch.");
  });
  it("still counts unverified source outside IMD", () => {
    const v = { ...verdict("safe"), imd: { isLaunch: false } } as unknown as VerdictReport;
    expect(launchVerdict(v).verdict).toBe("caution");
  });
});

describe("pricing and milestones", () => {
  it("reads the token's price whichever side of the pool it is on", () => {
    const base = { key: { currency0: NATIVE as Address, currency1: TOKEN, fee: 12500, tickSpacing: 60, hooks: HOOK as Address }, id: "0x01" as Hex, quote: NATIVE as Address, tokenDec: 18, quoteDec: 18 };
    // 500M tokens per ETH: one token is 2e-9 ETH
    expect(priceOf({ ...base, tokenIs1: true }, slot(5e8))).toBeCloseTo(2e-9, 15);
    // the token is currency0 and worth 4 of the quote
    expect(priceOf({ ...base, tokenIs1: false }, slot(4))).toBeCloseTo(4, 6);
  });

  it("names only the highest new milestone", () => {
    expect(newHit(1.9, [])).toBeNull();
    expect(newHit(2.1, [])).toBe(2);
    expect(newHit(6, [2])).toBe(5);
    expect(newHit(4, [2, 3, 5])).toBeNull();
  });

  it("recaps the day and keeps a track record", () => {
    const now = Date.parse("2026-10-23T20:00:00Z");
    const c = (n: number, v: Call["verdict"], peak: number, dumped = false): Call => ({
      type: "token", launch: n, id: `${n}`, token: TOKEN, symbol: `T${n}`, name: null, kind: "custom_token", repo: null, at: now - 3_600_000, verdict: v, summary: "", reasons: [],
      pool: null, supply: null, hook: null, launcher: null, nft: null, entry: 1, last: 1, peak, checkedAt: null, hits: [], dumped, posted: true, pushedAll: true, messages: [],
    });
    const calls = [c(1, "safe", 4.2), c(2, "avoid", 1, true), c(3, "caution", 1.5)];
    const text = recapText(calls, now)!;
    expect(text).toContain("3 IMD token launches checked");
    expect(text).toContain("1. $T1 4.2x");
    expect(text).toContain("dump: 1 of 1");
    expect(sniperStats(calls)).toMatchObject({ calls: 3, safe: 1, caution: 1, avoid: 1, avoidDumped: 1, best: { launch: 1 } });
    expect(recapText(calls, now + 2 * 86_400_000)).toBeNull();
  });

  it("writes a card under Telegram's caption limit", () => {
    const call: Call = {
      type: "token", launch: 7, id: "7", token: TOKEN, symbol: "FROG", name: "Frog Coin", kind: "univ4_hook", repo: null, at: 0, verdict: "caution", summary: "x".repeat(200),
      reasons: Array.from({ length: 6 }, () => ({ impact: "caution" as const, text: "y".repeat(150) })), pool: null, supply: null,
      hook: { address: HOOK as Address, template: "LaunchHook", risk: "low", summary: "", powers: [], swapFee: "", hookFee: "" }, launcher: { address: LAUNCHER, keepsPct: 2 }, nft: null,
      entry: null, last: null, peak: null, checkedAt: null, hits: [], dumped: false, posted: false, pushedAll: false, messages: [],
    };
    expect(callCard(call, 12_345).text.length).toBeLessThanOrEqual(1024);
  });
});
