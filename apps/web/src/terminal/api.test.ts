import { describe, expect, it } from "vitest";
import { type TermToken, DEFAULTS, applyFilters, matches, pct, price, readQuery, tone, usd, writeQuery } from "./api";

const NOW = 100 * 86_400_000;
const tok = (o: Partial<TermToken> & { id: string }): TermToken => ({
  chain: "eth", address: `0x${o.id.padStart(40, "0")}`, name: o.id, symbol: o.id.toUpperCase(), image: null, href: "/", ours: false, swarm: true, status: "pool", progress: null, launchNumber: null,
  createdAt: NOW - 86_400_000, priceUsd: null, mcapUsd: null, liquidityUsd: null, vol24: null, change1h: null, change24h: null, buys24: null, sells24: null, spark: null, market: { from: [], at: null }, ...o,
});

const LIST = [
  tok({ id: "imdsol", chain: "sol", address: "CUFS4ggDUYH4NCGVu3ezDubwPm5vM6rFfxLXtcnr8imd", status: "curve", progress: 0.05, mcapUsd: 5200, vol24: 4100, liquidityUsd: 5100, buys24: 35, sells24: 18, change24h: -11, createdAt: NOW - 3_600_000 }),
  tok({ id: "pump", launchNumber: 3200, mcapUsd: 20_000, vol24: 900, liquidityUsd: 5000, buys24: 7, sells24: 3, change24h: 12, createdAt: NOW - 10 * 86_400_000 }),
  tok({ id: "quiet", chain: "rh", createdAt: NOW - 2 * 86_400_000 }),
];

describe("the directory's search", () => {
  it("finds a name, a $ticker, a whole or long-prefix address, and a launch number", () => {
    expect(matches(LIST[0]!, "$imdsol")).toBe(true);
    expect(matches(LIST[0]!, "CUFS4ggD")).toBe(true);
    expect(matches(LIST[0]!, "cufs")).toBe(false); // too short to be an address
    expect(matches(LIST[1]!, "#3200")).toBe(true);
    expect(matches(LIST[1]!, "nope")).toBe(false);
  });
});

describe("the directory's filters and sort", () => {
  const ids = (xs: TermToken[]) => xs.map((x) => x.id);
  it("sorts trending by trades, then volume", () => {
    expect(ids(applyFilters(LIST, DEFAULTS, NOW))).toEqual(["imdsol", "pump", "quiet"]);
  });
  it("filters by chain, status, age, liquidity and volume", () => {
    expect(ids(applyFilters(LIST, { ...DEFAULTS, chain: "rh" }, NOW))).toEqual(["quiet"]);
    expect(ids(applyFilters(LIST, { ...DEFAULTS, status: "curve" }, NOW))).toEqual(["imdsol"]);
    expect(ids(applyFilters(LIST, { ...DEFAULTS, fresh: true }, NOW))).toEqual(["imdsol", "quiet"]);
    expect(ids(applyFilters(LIST, { ...DEFAULTS, minLiq: 5_050 }, NOW))).toEqual(["imdsol"]);
    expect(ids(applyFilters(LIST, { ...DEFAULTS, minVol: 1_000 }, NOW))).toEqual(["imdsol"]);
  });
  it("puts tokens without the number last", () => {
    expect(ids(applyFilters(LIST, { ...DEFAULTS, sort: "mcap" }, NOW))).toEqual(["pump", "imdsol", "quiet"]);
    expect(ids(applyFilters(LIST, { ...DEFAULTS, sort: "change" }, NOW))).toEqual(["pump", "imdsol", "quiet"]);
    expect(ids(applyFilters(LIST, { ...DEFAULTS, sort: "newest" }, NOW))).toEqual(["imdsol", "quiet", "pump"]);
  });
  it("keeps its state in the address, and reads back only what it knows", () => {
    const f = { ...DEFAULTS, q: "imd", chain: "sol" as const, fresh: true, minLiq: 1000, sort: "volume" as const };
    expect(writeQuery(f)).toBe("?q=imd&chain=sol&new=1&liq=1000&sort=volume");
    expect(readQuery(writeQuery(f))).toEqual(f);
    expect(writeQuery(DEFAULTS)).toBe("");
    expect(readQuery("?chain=base&sort=hype&liq=-5")).toEqual(DEFAULTS);
  });
});

describe("numbers", () => {
  it("never shows a number nobody published", () => {
    expect(usd(null)).toBe("—");
    expect(price(0)).toBe("—");
    expect(pct(undefined)).toBe("—");
    expect(tone(null)).toBe("flat");
  });
  it("reads at a glance: green up, red down", () => {
    expect(usd(20_465)).toBe("$20.5K");
    expect(usd(1_250_000)).toBe("$1.25M");
    expect(price(0.000005208)).toBe("$0.00000521");
    expect(pct(12.34)).toBe("+12.3%");
    expect(tone(-0.1)).toBe("down");
    expect(tone(3)).toBe("up");
  });
});
