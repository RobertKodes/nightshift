/** The token page's market, the pure half: timeframes, the fallback candles from NIGHTSHIFT's own reads, the numbers as pump.fun shows them. */

import type { Candle, Timeframe } from "./net";

/** Every launch here has a fixed supply of one billion tokens: market cap = price × this. */
export const SUPPLY = 1_000_000_000;
export const TFS: { tf: Timeframe; label: string; secs: number }[] = [
  { tf: "1m", label: "1M", secs: 60 }, { tf: "5m", label: "5M", secs: 300 }, { tf: "15m", label: "15M", secs: 900 },
  { tf: "1h", label: "1H", secs: 3600 }, { tf: "4h", label: "4H", secs: 14_400 }, { tf: "1d", label: "1D", secs: 86_400 },
];
export const tfSecs = (tf: Timeframe) => TFS.find((t) => t.tf === tf)!.secs;

/**
 * Candles from the engine's own price reads (a point a minute, in SOL) for a token GeckoTerminal has not
 * indexed yet: bucketed by the timeframe, in USD, no volume.
 */
export function pointsToCandles(points: [number, number][], tf: Timeframe, solUsd: number | null): Candle[] {
  if (!solUsd) return [];
  const secs = tfSecs(tf);
  const out: Candle[] = [];
  for (const [ms, priceSol] of [...points].sort((a, b) => a[0] - b[0])) {
    if (!Number.isFinite(ms) || !(priceSol > 0)) continue;
    const t = Math.floor(ms / 1000 / secs) * secs, p = priceSol * solUsd;
    const last = out[out.length - 1];
    if (last && last[0] === t) { last[2] = Math.max(last[2], p); last[3] = Math.min(last[3], p); last[4] = p; }
    else out.push([t, last ? last[4] : p, Math.max(p, last ? last[4] : p), Math.min(p, last ? last[4] : p), p, 0]);
  }
  return out;
}

const SUB = "₀₁₂₃₄₅₆₇₈₉";
/** A tiny dollar price the way pump.fun writes it: $0.0₅9098 for $0.000009098. */
export function priceUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a === 0) return "$0";
  if (a >= 1000) return `${sign}$${a.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (a >= 1) return `${sign}$${a.toFixed(2)}`;
  if (a >= 0.001) return `${sign}$${a.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  // 9.098e-6: exponent -6, so five zeros after the point, then 9098
  let e = Math.floor(Math.log10(a)), m = Math.round((a / 10 ** e) * 1000);
  if (m >= 10_000) { e += 1; m = Math.round(m / 10); }
  const zeros = -e - 1;
  const digits = String(m).replace(/0+$/, "") || "0";
  return `${sign}$0.0${String(zeros).split("").map((d) => SUB[Number(d)]).join("")}${digits}`;
}

/** Dollars, compact with two decimals ($9.10K, $1.25M): the market-cap axis and stats. */
export function compactUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(2)}K` : a >= 1 ? `${s}$${a.toFixed(2)}` : a > 0 ? `${s}$${a.toPrecision(2)}` : "$0";
}

/** A token amount, compact: 13.13M, 80.9, 1.2B. */
export function compactNum(v: number): string {
  const a = Math.abs(v);
  const u = (n: number, s: string) => `${n.toFixed(n >= 100 ? 1 : 2)}${s}`;
  return a >= 1e9 ? u(v / 1e9, "B") : a >= 1e6 ? u(v / 1e6, "M") : a >= 1e3 ? u(v / 1e3, "K") : a >= 1 ? v.toFixed(a >= 100 ? 0 : 2) : v > 0 ? v.toPrecision(2) : "0";
}

/** An amount of SOL as the trades list shows it: 1.609, 0.0102, 0.00001. */
export function solAmount(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v >= 0.001 ? v.toFixed(4) : v > 0 ? "<0.001" : "0";
}

/** How long ago, short: 12s, 4m, 3h, 2d. */
export function ageShort(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86_400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86_400)}d`;
}

/** A candle's change from open to close, in percent. */
export const candleChange = (c: Candle) => (c[1] > 0 ? ((c[4] - c[1]) / c[1]) * 100 : 0);
