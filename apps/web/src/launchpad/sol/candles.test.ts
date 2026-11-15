import { describe, expect, it } from "vitest";
import { ageShort, candleChange, compactNum, compactUsd, pointsToCandles, priceUsd, solAmount, SUPPLY, tfSecs } from "./candles";

describe("the token page's market numbers", () => {
  it("writes tiny prices the pump.fun way", () => {
    expect(priceUsd(0.000009098216)).toBe("$0.0₅9098");
    expect(priceUsd(0.00001)).toBe("$0.0₄1");
    expect(priceUsd(0.0000999999)).toBe("$0.0₃1");
    expect(priceUsd(0.0123456)).toBe("$0.01235");
    expect(priceUsd(1.5)).toBe("$1.50");
    expect(priceUsd(0)).toBe("$0");
    expect(priceUsd(null)).toBe("—");
  });

  it("market cap is price times the billion supply, written compact", () => {
    expect(SUPPLY).toBe(1_000_000_000);
    expect(compactUsd(0.000009098216 * SUPPLY)).toBe("$9.10K");
    expect(compactUsd(1_250_000)).toBe("$1.25M");
    expect(compactUsd(386.37)).toBe("$386.37");
    expect(compactNum(13130089.41)).toBe("13.13M");
    expect(compactNum(80.91)).toBe("80.91");
    expect(solAmount(1.609395472)).toBe("1.609");
    expect(solAmount(0.00001021)).toBe("<0.001");
    expect(compactNum(366689.88)).toBe("366.7K");
  });

  it("buckets NIGHTSHIFT's minute reads into candles in USD while GeckoTerminal has nothing", () => {
    const t0 = 1_794_782_400_000;
    const pts: [number, number][] = [[t0 + 60_000, 2e-7], [t0, 1e-7], [t0 + 120_000, 1.5e-7], [t0 + 300_000, 3e-7]];
    const c = pointsToCandles(pts, "5m", 100);
    expect(c).toHaveLength(2);
    expect(c[0]![0]).toBe(t0 / 1000);
    expect(c[0]!.slice(1, 5).map((v) => +v.toPrecision(3))).toEqual([1e-5, 2e-5, 1e-5, 1.5e-5]);
    // the next candle opens where the last one closed
    expect(+c[1]![1].toPrecision(3)).toBe(1.5e-5);
    expect(+c[1]![4].toPrecision(3)).toBe(3e-5);
    expect(pointsToCandles(pts, "5m", null)).toEqual([]);
    expect(tfSecs("4h")).toBe(14_400);
  });

  it("change and age", () => {
    expect(candleChange([0, 1, 2, 0.5, 1.5, 0])).toBe(50);
    expect(ageShort(0, 45_000)).toBe("45s");
    expect(ageShort(0, 3 * 3600_000 + 5)).toBe("3h");
  });
});
