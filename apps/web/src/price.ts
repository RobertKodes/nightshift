import { useEffect, useState } from "react";

/**
 * The live IMD price in USD, as the engine reads it from DexScreener every 10 minutes. Null until
 * it is known, so the site never shows a stale hard-coded dollar figure.
 */
let cached: { at: number; usd: number } | null = null;
let pending: Promise<number | null> | null = null;
async function fetchPrice(): Promise<number | null> {
  if (cached && Date.now() - cached.at < 60_000) return cached.usd;
  pending ??= fetch("/api/health").then((r) => r.json()).then((h: { imdUsd?: number }) => {
    pending = null;
    if (typeof h.imdUsd === "number" && h.imdUsd > 0) { cached = { at: Date.now(), usd: h.imdUsd }; return h.imdUsd; }
    return null;
  }).catch(() => { pending = null; return null; });
  return pending;
}

export function useImdUsd(): number | null {
  const [usd, setUsd] = useState<number | null>(cached?.usd ?? null);
  useEffect(() => {
    let alive = true;
    const go = () => void fetchPrice().then((v) => { if (alive && v) setUsd(v); });
    go();
    const t = setInterval(go, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return usd;
}

/** "≈ $3.41" for an amount of IMD, or "" while the price is unknown. */
export const inUsd = (imd: number, usd: number | null) => (usd ? `≈ $${(imd * usd).toFixed(imd * usd < 100 ? 2 : 0)}` : "");
