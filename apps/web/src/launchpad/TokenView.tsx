import { Fragment, Suspense, lazy, useEffect, useState } from "react";
import { Link } from "../router";
import { safeHref } from "../safe";
import { Logo } from "./LaunchpadPage";
import { type Candle, CHAIN_NAME, type LaunchView, age, fromFor, lpApi, pct, price, short, usd } from "./api";
import "../mswap/page.css";

const MultiSwap = lazy(() => import("../mswap/MultiSwap").then((m) => ({ default: m.MultiSwap })));
const EXPLORER: Record<number, string> = { 1: "https://etherscan.io", 4663: "https://robin.etherscan.io" };
const STAGE: Record<LaunchView["stage"], string> = { paid: "PAID", refused: "REFUSED", building: "BUILDING", needs_input: "NEEDS INPUT", failed: "STOPPED", deploying: "DEPLOYING", live: "LIVE", parked: "PARKED" };

/** One launch, followed through IMD from the payment to its live pool, then its market and the buy from any chain. */
export function TokenView({ ref_ }: { ref_: string }) {
  const [v, setV] = useState<LaunchView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let on = true, t: ReturnType<typeof setTimeout>;
    const load = async () => {
      let next = 15_000;
      try { const x = await lpApi.launch(ref_); if (!on) return; setV(x); setErr(null); if (x.stage === "live" || x.stage === "parked" || x.stage === "failed" || x.stage === "refused") next = 60_000; }
      catch (e) { if (on) setErr((e as Error).message); next = 30_000; }
      if (on) t = setTimeout(load, next);
    };
    void load();
    return () => { on = false; clearTimeout(t); };
  }, [ref_]);
  const sym = v?.coin?.symbol ?? v?.market?.symbol ?? null, name = v?.coin?.name ?? v?.market?.name ?? (v?.launch ? `Launch #${v.launch.launchNumber}` : "A launch");
  useEffect(() => { document.title = `${sym ? `$${sym}` : name} · Launchpad · NIGHTSHIFT`; }, [sym, name]);

  if (!v) return (
    <div className="st-room lp"><div className="st-body lp-new">
      <span className="st-deck lp-deck"><Link to="/launchpad">LAUNCHPAD</Link></span>
      {err ? <p className="st-warn">{err} <Link to="/launchpad">Back to the board</Link></p> : <p className="st-empty">Reading the launch at IMD…</p>}
    </div></div>
  );

  const l = v.launch, m = v.market, live = v.stage === "live" && l?.token && l.chain;
  return (
    <div className="st-room lp">
      <div className="st-body lp-new">
        <span className="st-deck lp-deck"><Link to="/launchpad">LAUNCHPAD</Link>{l && <> · IMD LAUNCH #{l.launchNumber}</>}</span>
        <header className="lp-coin">
          <Logo src={l?.logo ?? m?.image ?? null} symbol={sym} size={72} />
          <div>
            <h1 className="lp-h1">{sym ? `$${sym}` : name}</h1>
            <p className="lp-small">{name}{l?.chain && <> · <i className={`lp-chain ${l.chain}`}>{CHAIN_NAME[l.chain]}</i></>}{l && <> · {l.kind} · {age(l.createdAt)} old</>}{l?.ours && <em className="lp-here">LAUNCHED HERE</em>}</p>
          </div>
          <span className={`lp-stage ${v.stage}`}>{STAGE[v.stage]}</span>
        </header>
        <p className="st-note">{v.stageText}</p>
        {v.coin?.about && <p className="lp-about">{v.coin.about}</p>}
        {v.coin && Object.keys(v.coin.links).length > 0 && (
          <div className="st-row lp-links">{(["website", "x", "telegram"] as const).map((k) => v.coin!.links[k] && <a key={k} href={safeHref(v.coin!.links[k])} target="_blank" rel="noreferrer nofollow">{k === "x" ? "X" : k === "website" ? "Website" : "Telegram"} ↗</a>)}</div>
        )}

        {live && m && (
          <div className="st-stats wide">
            <div className="st-stat"><span>Price</span><b>{price(m.priceUsd)}</b><small className={m.change24h >= 0 ? "up" : "down"}>{pct(m.change24h)} in 24h</small></div>
            <div className="st-stat"><span>Market cap</span><b>{usd(m.mcapUsd)}</b><small>DexScreener</small></div>
            <div className="st-stat"><span>Liquidity</span><b>{usd(m.liquidityUsd)}</b><small>paired with {m.quote}</small></div>
            <div className="st-stat"><span>Volume 24h</span><b>{usd(m.volume24)}</b><small>{m.buys24} buys · {m.sells24} sells</small></div>
          </div>
        )}
        {live && !m && <p className="st-warn">Live, but no price source indexes its pool yet (DexScreener lists a pool after its first trades). The swap can still route into it.</p>}

        <div className={live ? "lp-two" : ""}>
          <div className="lp-col">
            {live && l?.pool && <Chart chainId={l.chainId} pool={l.pool.poolId} />}
            {!live && <Progress v={v} />}
            {l && <Facts v={v} />}
          </div>
          {live && l?.token && l.chain && (
            <section className="lp-buybox" aria-label={`Buy ${sym ?? "this coin"} from any chain`}>
              <h3>Buy {sym ? `$${sym}` : "it"} from any chain</h3>
              <p className="lp-small">Pay with ETH, USDC or SOL on Ethereum, Base, Robinhood Chain or Solana. The route ends in this coin's pool on {CHAIN_NAME[l.chain]}, and the coin arrives in your wallet there.</p>
              <Suspense fallback={<p className="ms-fine">Loading the swap…</p>}>
                <MultiSwap key={l.token} onPool={() => {}} preset={{ to: { chain: l.chain, address: l.token }, from: fromFor(l.chain) }} />
              </Suspense>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Progress({ v }: { v: LaunchView }) {
  const done = (s: string) => s === "accepted";
  const steps = v.job?.steps ?? [];
  return (
    <section className="st-panel">
      <h3>Following it at IMD</h3>
      <ol className="lp-steps">
        <li className={v.payment || v.job ? "ok" : "go"}>Paid with 0.5 IMD {v.payment && <a href={`${EXPLORER[v.payment.chainId] ?? EXPLORER[1]}/tx/${v.payment.tx}`} target="_blank" rel="noreferrer">{short(v.payment.tx)} ↗</a>}</li>
        <li className={v.job ? "ok" : v.stage === "refused" ? "bad" : "go"}>{v.stage === "refused" ? `Refused by IMD: ${v.payment?.reason ?? "no reason given"}` : v.job ? <>Admitted by IMD as a job <a href={`https://explorer.imd.fun/jobs/${v.job.id}`} target="_blank" rel="noreferrer">on its explorer ↗</a></> : "Waiting for IMD to admit it"}</li>
        {steps.map((s) => <li key={s.key} className={done(s.state) ? "ok" : s.state === "working" ? "go" : s.state === "failed" ? "bad" : ""}>{s.label} <small>{s.state}</small></li>)}
        <li className={v.stage === "live" ? "ok" : v.stage === "deploying" ? "go" : ""}>Deployed by IMD with its Uniswap v4 pool</li>
      </ol>
      {v.stage === "needs_input" && v.job?.blockedReason && <div className="lp-refused"><b>The swarm asks:</b><p>{v.job.blockedReason}</p><p className="lp-small">The payer answers it on IMD with a follow-up job (job.continue, 0.5 IMD, from the same wallet), or leaves it. A coin request from this form is IMD's standard one and rarely stops here.</p></div>}
    </section>
  );
}

function Facts({ v }: { v: LaunchView }) {
  const l = v.launch!, e = l.economics, ex = EXPLORER[l.chainId] ?? EXPLORER[1];
  return (
    <section className="st-panel lp-facts">
      <h3>The launch</h3>
      {e && (
        <>
          <div className="lp-split" aria-label="How the supply is split">
            {e.poolPct != null && <span className="pool" style={{ width: `${e.poolPct}%` }}>{e.poolPct}% pool</span>}
            {e.creatorPct ? <span className="you" style={{ width: `${e.creatorPct}%` }}>{e.creatorPct >= 6 ? `${e.creatorPct}%` : ""}</span> : null}
            <span className="swarm" style={{ width: "10%" }}>10%</span>
          </div>
          <p className="lp-small">{e.poolPct}% in the pool · {e.creatorPct}% to the creator · 10% to IMD's swarm{e.cap ? ` · opened at a ${(Number(BigInt(e.cap) / 10n ** 12n) / 1e6).toLocaleString("en-US")} ${e.pairedWith} market cap` : ""}.</p>
        </>
      )}
      <dl className="lp-dl">
        {l.token && <><dt>Token</dt><dd><a href={`${ex}/token/${l.token}`} target="_blank" rel="noreferrer">{short(l.token)} ↗</a> · <a href={`${ex}/token/${l.token}#balances`} target="_blank" rel="noreferrer">holders ↗</a></dd></>}
        {l.pool && <><dt>Pool</dt><dd>Uniswap v4 · fee {(l.pool.fee / 10_000).toFixed(2)}% · <code title={l.pool.poolId}>{short(l.pool.poolId)}</code>{v.links.dexscreener && <> · <a href={safeHref(v.links.dexscreener)} target="_blank" rel="noreferrer">DexScreener ↗</a></>}</dd></>}
        {l.requester && <><dt>Requester</dt><dd><a href={`${ex}/address/${l.requester}`} target="_blank" rel="noreferrer">{short(l.requester)}</a> gets 1% of every trade</dd></>}
        {l.contracts.filter((c) => c.role !== "token").map((c) => <Fragment key={c.address}><dt>{c.role}</dt><dd>{c.name} <a href={`${ex}/address/${c.address}`} target="_blank" rel="noreferrer">{short(c.address)} ↗</a></dd></Fragment>)}
        <dt>At IMD</dt><dd>{v.links.explorer && <><a href={v.links.explorer} target="_blank" rel="noreferrer">explorer ↗</a> · </>}{v.links.job && <><a href={v.links.job} target="_blank" rel="noreferrer">the job ↗</a> · </>}{l.repo && <a href={safeHref(l.repo)} target="_blank" rel="noreferrer">source ↗</a>}</dd>
      </dl>
      {l.checks.length > 0 && <ul className="lp-checks">{l.checks.map((c) => <li key={c.name} className={c.status === "passed" ? "ok" : "bad"} title={c.detail}>{c.status === "passed" ? "✓" : "✗"} {c.name.replace(/_/g, " ")}</li>)}</ul>}
    </section>
  );
}

const span = (ms: number) => { const h = Math.round(ms / 3_600_000), d = Math.round(ms / 86_400_000); return h < 36 ? `last ${Math.max(1, h)} hours` : `last ${d} days`; };
/** Hourly closes for the last 7 days (GeckoTerminal), with volume under them. Drawn in SVG, no chart library. */
function Chart({ chainId, pool }: { chainId: number; pool: string }) {
  const [c, setC] = useState<{ candles: Candle[]; error?: string } | null>(null);
  useEffect(() => { lpApi.chart(chainId, pool).then(setC, (e: Error) => setC({ candles: [], error: e.message })); }, [chainId, pool]);
  if (!c) return <section className="st-panel lp-chart"><p className="st-empty">Loading the chart…</p></section>;
  const k = c.candles;
  if (k.length < 2) return <section className="st-panel lp-chart"><p className="st-empty">{c.error ?? "Not enough trades for a chart yet."}</p></section>;
  const W = 640, H = 220, V = 44, t0 = k[0]!.t, t1 = k.at(-1)!.t, lo = Math.min(...k.map((x) => x.l)), hi = Math.max(...k.map((x) => x.h)), vmax = Math.max(...k.map((x) => x.v));
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W, y = (p: number) => H - 8 - ((p - lo) / Math.max(1e-30, hi - lo)) * (H - 24);
  const line = k.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.c).toFixed(1)}`).join("");
  const up = k.at(-1)!.c >= k[0]!.o;
  return (
    <section className="st-panel lp-chart">
      <h3>Price, {span(t1 - t0)} <small>{price(k.at(-1)!.c)} · high {price(hi)} · low {price(lo)}</small></h3>
      <svg viewBox={`0 0 ${W} ${H + V}`} role="img" aria-label="Price chart" preserveAspectRatio="none">
        <defs><linearGradient id="lpg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={up ? "#5fd38a" : "#ff6b7d"} stopOpacity=".28" /><stop offset="1" stopColor={up ? "#5fd38a" : "#ff6b7d"} stopOpacity="0" /></linearGradient></defs>
        <path d={`${line}L${W},${H}L0,${H}Z`} fill="url(#lpg)" />
        <path d={line} fill="none" stroke={up ? "#5fd38a" : "#ff6b7d"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {k.map((p) => <rect key={p.t} x={x(p.t) - 1.5} y={H + V - (p.v / Math.max(1, vmax)) * (V - 6)} width="3" height={(p.v / Math.max(1, vmax)) * (V - 6)} fill="rgba(164,139,255,.45)" />)}
      </svg>
      <p className="lp-small dim">Hourly, from GeckoTerminal; hours without a trade are skipped.</p>
    </section>
  );
}
