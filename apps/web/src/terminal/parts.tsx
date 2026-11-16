import { useState } from "react";
import { Link } from "../router";
import { CHAIN, type Chain, type TermToken, pct, price, ticker, tone, usd } from "./api";

/** A token's logo, or its first letter on a tile when it has none (or it fails to load). */
export function Logo({ src, symbol, name, size = 36 }: { src: string | null; symbol: string; name: string; size?: number }) {
  const [bad, setBad] = useState(false);
  return src && !bad
    ? <img className="tm-logo" src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />
    : <span className="tm-logo tm-letter" style={{ width: size, height: size }} aria-hidden="true">{(symbol || name || "?").slice(0, 1).toUpperCase()}</span>;
}

export function ChainTag({ chain }: { chain: Chain }) {
  return <span className={`tm-chain ${chain}`} title={CHAIN[chain].name}>{CHAIN[chain].short}</span>;
}

export function Delta({ v, className = "" }: { v: number | null | undefined; className?: string }) {
  return <b className={`tm-delta ${tone(v)} ${className}`}>{pct(v)}</b>;
}

/** The engine's own price line for a Solana launch (one point a minute); nothing when there is no line yet. */
export function Spark({ v, w = 84, h = 24 }: { v: number[] | null; w?: number; h?: number }) {
  if (!v || v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((y - lo) / span) * (h - 4)).toFixed(1)}`).join(" ");
  return <svg className={`tm-spark ${v[v.length - 1]! >= v[0]! ? "up" : "down"}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={pts} fill="none" strokeWidth="1.5" /></svg>;
}

/** The curve's progress, or the pool's state. */
export function Curve({ t }: { t: TermToken }) {
  if (t.status === "graduated") return <span className="tm-grad">GRADUATED</span>;
  if (t.status !== "curve" || t.progress == null) return null;
  const p = Math.round(t.progress * 100);
  return (
    <span className="tm-curve" title={`${p}% of the bonding curve sold`}>
      <span className="tm-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, p)}%` }} /></span>
      <small>{p}% CURVE</small>
    </span>
  );
}

/**
 * The ecosystem's core tokens, pinned above everything: IMD and $SHIFT, from their own Uniswap v4 pools on Ethereum.
 * Pinned because they are the ecosystem's own, not paid placement; TRADE opens NIGHTSHIFT Swap.
 */
export function CoreStrip({ core }: { core: TermToken[] | undefined }) {
  if (!core?.length) return null;
  return (
    <section className="tm-core" aria-labelledby="tm-core">
      <header><b id="tm-core">CORE TOKENS</b><span>The ecosystem's own tokens, pinned here, not paid placement: IMD pays for the swarm's work, $SHIFT is NIGHTSHIFT's token. Numbers from their Uniswap v4 pools on Ethereum.</span></header>
      <div className="tm-core-r">
        {core.map((t) => (
          <Link key={t.id} to={t.href} className="tm-core-c" aria-label={`${t.name} ${ticker(t)}: trade on NIGHTSHIFT Swap`}>
            <span className="tm-core-id">
              <Logo src={t.image} symbol={t.symbol} name={t.name} size={40} />
              <span><b>{ticker(t)}</b><small>{t.name} · CORE</small></span>
              <ChainTag chain={t.chain} />
            </span>
            <span className="tm-core-n">
              <span><small>PRICE</small><b>{price(t.priceUsd)}</b></span>
              <span><small>24H</small><Delta v={t.change24h} /></span>
              <span><small>{t.capIsFdv ? "FDV" : "MCAP"}</small><b>{usd(t.mcapUsd)}</b></span>
              <span><small>VOL 24H</small><b>{usd(t.vol24)}</b></span>
              <span><small>POOL LIQUIDITY</small><b>{usd(t.liquidityUsd)}</b></span>
            </span>
            <span className="tm-trade">TRADE ON SWAP →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** One token: who it is, what it is worth, how it moved, and the way to its page. */
export function TokenCard({ t }: { t: TermToken }) {
  return (
    <Link to={t.href} className={`tm-card ${t.chain}`} aria-label={`${t.name} ${ticker(t)} on ${CHAIN[t.chain].name}: open to trade`}>
      <span className="tm-card-top">
        <Logo src={t.image} symbol={t.symbol} name={t.name} />
        <span className="tm-id"><b>{t.name}</b><small>{ticker(t) || (t.launchNumber != null ? `IMD #${t.launchNumber}` : "")}</small></span>
        <ChainTag chain={t.chain} />
      </span>
      <span className="tm-card-mid">
        <span className="tm-cap"><small>{t.capIsFdv ? "FDV" : "MCAP"}</small><b>{usd(t.mcapUsd)}</b></span>
        <Delta v={t.change24h} />
      </span>
      <Spark v={t.spark} w={200} h={26} />
      <span className="tm-card-stats">
        <span><small>VOL 24H</small><b>{usd(t.vol24)}</b></span>
        {t.status === "pool" ? <span><small>LIQUIDITY</small><b>{usd(t.liquidityUsd)}</b></span> : <Curve t={t} />}
      </span>
      <span className="tm-card-foot">
        <span className="tm-tags">{t.swarm && <i className="imd">SWARM</i>}{t.ours && <i>NIGHTSHIFT</i>}</span>
        <span className="tm-trade">TRADE →</span>
      </span>
    </Link>
  );
}
