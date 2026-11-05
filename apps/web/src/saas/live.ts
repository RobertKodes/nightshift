import { useEffect, useState } from "react";

/** The public numbers the new front page reads, refreshed once a minute while it is open. */
export interface Overview {
  market: { priceUsd: number; mcap: number; liquidity?: number } | null;
  staked: number | null;
  stakedPct: number | null;
  burnedShift: number;
  burnedImd: number | null;
  burnReserveEth?: number | null;
  burnAtEth?: number | null;
  lastBurn?: { at: number; tx: string; imd: number | null } | null;
}

const get = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);

function usePoll<T>(url: string, pick: (json: unknown) => T | null, every = 60_000): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => {
      if (document.hidden) return;
      void get<unknown>(url).then((json) => { if (alive && json) setValue((old) => pick(json) ?? old); });
    };
    read();
    const timer = setInterval(read, every);
    const onVisible = () => { if (!document.hidden) read(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [url, every, pick]);
  return value;
}

export const useOverview = () => usePoll<Overview>("/api/token/overview", (json) => json as Overview);
export const useLiveGames = () => usePoll<{ n: number }>("/api/games/live", (json) => {
  const games = (json as { games?: unknown[] }).games;
  return Array.isArray(games) ? { n: games.length } : null;
});

/** 0.0000644 as $0.0₄644, the way a chart writes it; millions and thousands short. */
export const money = (n: number): string => {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  if (n > 0 && n < 1e-3) {
    const zeros = -Math.floor(Math.log10(n)) - 1;
    const digits = Math.min(999, Math.round(n * 10 ** (zeros + 3)));
    return `$0.0${[...String(zeros)].map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("")}${digits}`;
  }
  return `$${n.toPrecision(3)}`;
};

export const amount = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n >= 100 ? n.toFixed(0) : n.toFixed(2);
