import { useEffect, useState } from "react";

export type Staked = { staked: number | null; supply: number; pct: number | null };

/** The $SHIFT staked in ShiftRewards, read on chain by the engine; refreshed every minute. */
export function useStaked(): Staked | null {
  const [s, setS] = useState<Staked | null>(null);
  useEffect(() => {
    const load = () => void fetch("/api/staked").then((r) => r.json()).then(setS).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  return s;
}

export const short = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));

/** The staked supply as a card: amount, share of the supply and a bar. */
export function StakedSupply({ sym = "SHIFT" }: { sym?: string }) {
  const s = useStaked();
  const pct = s?.pct ?? 0;
  return (
    <section className="tkn-card staked-card" aria-label="Staked supply">
      <div className="tkn-head"><div><b>STAKED SUPPLY</b><span>Live from ShiftRewards · updates every minute</span></div><span className="tkn-state on">LIVE</span></div>
      <div className="staked-row">
        <b>{s?.staked != null ? s.staked.toLocaleString("en-US") : "…"}</b><span>${sym} staked</span>
        <em>{s?.pct != null ? `${pct.toFixed(2)}%` : "…"}</em><span>of the 1,000,000,000 supply</span>
      </div>
      <div className="staked-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
    </section>
  );
}
