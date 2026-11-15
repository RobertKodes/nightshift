/**
 * The token page's market, like pump.fun's: a candlestick chart with volume (TradingView Lightweight Charts,
 * loaded on demand in its own chunk), the latest trades and the top holders. The numbers come from the engine,
 * which reads GeckoTerminal and the Solana RPC with a cache; the browser never calls them directly.
 */

import { useEffect, useRef, useState } from "react";
import type { CandlestickData, HistogramData, IChartApi, ISeriesApi, MouseEventParams, Time, UTCTimestamp } from "lightweight-charts";
import { PxPanel, PxTag } from "../../saas/kit";
import { PxIcon } from "../../saas/PxIcon";
import { ageShort, candleChange, compactNum, compactUsd, pointsToCandles, priceUsd, solAmount, SUPPLY, TFS } from "./candles";
import { type Candle, type HolderRow, type MarketTrade, type SolLaunch, shortKey, solApi, solscan, type Timeframe } from "./net";

type Mode = "mcap" | "price";
const LIME = "#b8ff3d", RED = "#ff6b7d";
const remember = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

/** Run `load` now and every `ms` while the tab is visible (and once more when it comes back). */
function usePoll(load: () => void, ms: number, deps: unknown[]) {
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, ms);
    const back = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Unix seconds to the chart's time, shifted so its axis reads in the visitor's own time zone. */
const local = (t: number) => (t - new Date(t * 1000).getTimezoneOffset() * 60) as UTCTimestamp;

// ---------------------------------------------------------------- the chart

export function MarketChart({ l, solUsd }: { l: SolLaunch; solUsd: number | null }) {
  const [tf, setTf] = useState<Timeframe>(() => (TFS.some((t) => t.tf === remember.get("ns_sol_tf")) ? remember.get("ns_sol_tf") as Timeframe : "5m"));
  const [mode, setMode] = useState<Mode>(() => (remember.get("ns_sol_mode") === "price" ? "price" : "mcap"));
  const [data, setData] = useState<{ candles: Candle[]; source: "gt" | "own"; tf: Timeframe; note?: string } | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<{ api: IChartApi; candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram"> } | null>(null);
  const byTime = useRef(new Map<number, Candle>());
  const fitted = useRef("");
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => { remember.set("ns_sol_tf", tf); }, [tf]);
  useEffect(() => { remember.set("ns_sol_mode", mode); }, [mode]);

  // the candles: GeckoTerminal through the engine, or NIGHTSHIFT's own minute reads while it has nothing yet
  const ask = useRef(0);
  usePoll(() => {
    const n = ++ask.current; // only the latest request draws (a slow answer for the last timeframe is dropped)
    void (async () => {
      const r = await solApi.candles(l.mint, tf).catch(() => null);
      if (r && r.candles.length) { if (n === ask.current) setData({ candles: r.candles, source: "gt", tf }); return; }
      const own = pointsToCandles(await solApi.chart(l.mint).catch(() => []), tf, solUsd);
      if (n === ask.current) setData({ candles: own, source: "own", tf, note: r?.note });
    })();
  }, 15_000, [l.mint, tf, solUsd]);

  // the chart itself, made once: Lightweight Charts arrives in its own chunk
  useEffect(() => {
    let gone = false, cleanup = () => {};
    void import("lightweight-charts").then((lw) => {
      if (gone || !box.current) return;
      const fmt = (v: number) => (modeRef.current === "mcap" ? compactUsd(v) : priceUsd(v));
      const api = lw.createChart(box.current, {
        autoSize: true,
        layout: { background: { type: lw.ColorType.Solid, color: "#060907" }, textColor: "#93a89a", fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace", fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: "rgba(184, 255, 61, .05)" }, horzLines: { color: "rgba(184, 255, 61, .06)" } },
        rightPriceScale: { borderColor: "rgba(184, 255, 61, .18)", scaleMargins: { top: 0.12, bottom: 0.26 } },
        timeScale: { borderColor: "rgba(184, 255, 61, .18)", timeVisible: true, secondsVisible: false, rightOffset: 3, minBarSpacing: 2 },
        crosshair: {
          mode: lw.CrosshairMode.Normal,
          vertLine: { color: "rgba(184, 255, 61, .45)", style: lw.LineStyle.Dashed, labelBackgroundColor: "#24361a" },
          horzLine: { color: "rgba(184, 255, 61, .45)", style: lw.LineStyle.Dashed, labelBackgroundColor: "#24361a" },
        },
        localization: { priceFormatter: fmt },
        handleScale: { axisPressedMouseMove: { time: true, price: false } },
      });
      const candles = api.addSeries(lw.CandlestickSeries, {
        upColor: LIME, downColor: RED, borderUpColor: LIME, borderDownColor: RED, wickUpColor: LIME, wickDownColor: RED,
        priceFormat: { type: "custom", formatter: fmt, minMove: 1e-12 }, priceLineColor: "rgba(184, 255, 61, .6)",
      });
      const volume = api.addSeries(lw.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      api.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      const move = (p: MouseEventParams<Time>) => setHover(p.time != null ? byTime.current.get(p.time as number) ?? null : null);
      api.subscribeCrosshairMove(move);
      chart.current = { api, candles, volume };
      setData((d) => (d ? { ...d } : d)); // draw what arrived while the library loaded
      cleanup = () => { api.unsubscribeCrosshairMove(move); api.remove(); chart.current = null; };
    }).catch(() => setFailed(true));
    return () => { gone = true; cleanup(); };
  }, []);

  // the data on the chart, in market cap or price
  useEffect(() => {
    const c = chart.current;
    if (!c || !data) return;
    const k = mode === "mcap" ? SUPPLY : 1;
    const map = new Map<number, Candle>();
    const cs: CandlestickData<Time>[] = [], vs: HistogramData<Time>[] = [];
    for (const x of data.candles) {
      const t = local(x[0]);
      map.set(t, x);
      cs.push({ time: t, open: x[1] * k, high: x[2] * k, low: x[3] * k, close: x[4] * k });
      vs.push({ time: t, value: x[5], color: x[4] >= x[1] ? "rgba(184, 255, 61, .32)" : "rgba(255, 107, 125, .32)" });
    }
    byTime.current = map;
    c.candles.applyOptions({ priceFormat: { type: "custom", formatter: mode === "mcap" ? compactUsd : priceUsd, minMove: mode === "mcap" ? 0.01 : 1e-12 } });
    c.candles.setData(cs);
    c.volume.setData(vs);
    // framed again when the timeframe or the view changes, not on every refresh (the visitor may have scrolled)
    const key = `${data.tf}:${mode}:${data.source}`;
    if (fitted.current !== key && cs.length) {
      fitted.current = key;
      // bars between ~5 and ~12 px wide: a young token's few bars keep a normal width instead of filling the chart
      const w = box.current?.clientWidth || 600;
      const bars = Math.min(Math.max(cs.length, Math.round(w / 12)), Math.round(w / 5));
      c.api.timeScale().setVisibleLogicalRange({ from: cs.length - bars, to: cs.length + 2 });
      c.api.priceScale("right").applyOptions({ autoScale: true });
    }
  }, [data, mode]);

  const k = mode === "mcap" ? SUPPLY : 1;
  const show = hover ?? data?.candles[data.candles.length - 1] ?? null;
  const f = (v: number) => (mode === "mcap" ? compactUsd(v * k) : priceUsd(v));
  const loading = !data || data.tf !== tf;
  const empty = !!data && !data.candles.length;
  const ch = show ? candleChange(show) : 0;
  return (
    <PxPanel title={mode === "mcap" ? "MARKET CAP" : "PRICE"} right={data?.source === "own" ? "NIGHTSHIFT · USD" : "GECKOTERMINAL · USD"} className="sl3-mkt">
      <div className="sl3-mkt-bar">
        <div className="sl3-mkt-tf" role="group" aria-label="Timeframe">
          {TFS.map((t) => <button key={t.tf} className={tf === t.tf ? "on" : ""} aria-pressed={tf === t.tf} onClick={() => setTf(t.tf)}>{t.label}</button>)}
        </div>
        <div className="sl3-mkt-mode" role="group" aria-label="Show">
          <button className={mode === "mcap" ? "on" : ""} aria-pressed={mode === "mcap"} onClick={() => setMode("mcap")}>MCAP</button>
          <button className={mode === "price" ? "on" : ""} aria-pressed={mode === "price"} onClick={() => setMode("price")}>PRICE</button>
        </div>
      </div>
      <div className="sl3-mkt-k" aria-live="off">
        {show ? <>
          <span><i>O</i>{f(show[1])}</span><span><i>H</i>{f(show[2])}</span><span><i>L</i>{f(show[3])}</span><span><i>C</i>{f(show[4])}</span>
          <b className={ch >= 0 ? "up" : "down"}>{ch >= 0 ? "+" : ""}{ch.toFixed(2)}%</b>
          {data?.source === "gt" && <span><i>VOL</i>{compactUsd(show[5])}</span>}
          {hover && <small>{new Date(hover[0] * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>}
        </> : <span className="sl3-dim">{loading ? "Reading the market…" : ""}</span>}
      </div>
      <div className="sl3-mkt-chart">
        <div ref={box} className="sl3-mkt-canvas" />
        {(failed || empty || (loading && !data)) && (
          <div className="sl3-mkt-empty"><p className="sl3-dim">{failed ? "The chart could not load. Refresh the page." : empty ? "No trades indexed yet: the chart fills in as the token trades." : "Reading the market…"}</p></div>
        )}
      </div>
      {data?.source === "own" && !empty && <p className="sl3-mkt-note">From NIGHTSHIFT's own price reads (one a minute, no volume) until GeckoTerminal indexes the pool.</p>}
    </PxPanel>
  );
}

// ---------------------------------------------------------------- the trades

export function TradesList({ l, net }: { l: SolLaunch; net: string }) {
  const [r, setR] = useState<{ trades: MarketTrade[]; note?: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  usePoll(() => { solApi.trades(l.mint).then((x) => { setR(x); setNow(Date.now()); }).catch(() => setR((p) => p ?? { trades: [], note: "The trades could not be read right now." })); }, 15_000, [l.mint]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5_000); return () => clearInterval(t); }, []);
  return (
    <PxPanel title="TRADES" state={r?.trades.length ? "live" : "idle"} right={r?.trades.length ? `LAST ${r.trades.length}` : undefined} className="sl3-trades">
      {!r ? <p className="sl3-dim">Reading the trades…</p>
        : !r.trades.length ? <p className="sl3-dim">{r.note ?? "No trades yet."} New trades show up here within a minute or so.</p>
        : <div className="sl3-tr" role="table" aria-label="Latest trades">
          <div className="sl3-tr-r head" role="row"><span role="columnheader">ACCOUNT</span><span role="columnheader">TYPE</span><span role="columnheader">SOL</span><span role="columnheader">{l.symbol.slice(0, 10)}</span><span role="columnheader" className="usd">USD</span><span role="columnheader">AGE</span><span role="columnheader" className="tx">TX</span></div>
          {r.trades.map((t) => (
            <div key={t.tx + t.kind + t.tokens} className={`sl3-tr-r ${t.kind}`} role="row">
              <a role="cell" href={solscan("account", t.account, net)} target="_blank" rel="noopener noreferrer" title={t.account}>{t.account === l.creator && <b className="dev">DEV</b>}{t.account.slice(0, 6)}</a>
              <span role="cell"><b className={t.kind}>{t.kind === "buy" ? "BUY" : "SELL"}</b></span>
              <span role="cell">{solAmount(t.sol)}</span>
              <span role="cell">{compactNum(t.tokens)}</span>
              <span role="cell" className="usd">{compactUsd(t.usd)}</span>
              <span role="cell" className="age" title={new Date(t.at).toLocaleString()}>{ageShort(t.at, now)}</span>
              <a role="cell" className="tx" href={solscan("tx", t.tx, net)} target="_blank" rel="noopener noreferrer" aria-label="The transaction on Solscan">{t.tx.slice(0, 4)}↗</a>
            </div>
          ))}
        </div>}
    </PxPanel>
  );
}

// ---------------------------------------------------------------- the holders

const LABEL: Record<NonNullable<HolderRow["label"]>, { text: string; tone: "lime" | "imd" | "gold" }> = { "bonding curve": { text: "BONDING CURVE", tone: "lime" }, pool: { text: "LIQUIDITY POOL", tone: "imd" }, dev: { text: "DEV", tone: "gold" } };

export function HoldersList({ l, net }: { l: SolLaunch; net: string }) {
  const [r, setR] = useState<{ holders: HolderRow[] | null } | null>(null);
  usePoll(() => { solApi.holders(l.mint).then(setR).catch(() => setR((p) => p ?? { holders: null })); }, 60_000, [l.mint]);
  const top = r?.holders?.slice(0, 20) ?? [];
  return (
    <PxPanel title="TOP HOLDERS" right={top.length ? `TOP ${top.length}` : undefined} className="sl3-holders">
      {!r ? <p className="sl3-dim">Reading the holders…</p>
        : !r.holders ? <p className="sl3-dim">The holders cannot be read right now.</p>
        : !top.length ? <p className="sl3-dim">No holders yet.</p>
        : <ol className="sl3-hold">
          {top.map((h, i) => (
            <li key={h.account}>
              <span className="n">{i + 1}</span>
              <a href={solscan("account", h.owner, net)} target="_blank" rel="noopener noreferrer" title={h.owner}>{shortKey(h.owner)}</a>
              {h.label && <PxTag tone={LABEL[h.label].tone}>{LABEL[h.label].text}</PxTag>}
              <b>{h.pct < 0.01 ? "<0.01" : h.pct.toFixed(2)}%</b>
              <i aria-hidden="true" style={{ width: `${Math.min(100, h.pct)}%` }} />
            </li>
          ))}
        </ol>}
    </PxPanel>
  );
}

// ---------------------------------------------------------------- the links

/** The token's links, pump.fun style: its sites, the IMD job that built them, its socials, where it trades and is tracked. */
export function TokenLinks({ l, net }: { l: SolLaunch; net: string }) {
  const launched = l.status === "live" || l.status === "graduated";
  const ext = { target: "_blank", rel: "noopener noreferrer" } as const;
  const w = l.swarm;
  const imdSite = w?.site && w.site !== l.website ? w.site : null;
  const links: { key: string; href: string; label: string; icon?: string; tone?: "imd" | "site" }[] = [
    l.website ? { key: "site", href: l.website, label: "WEBSITE", icon: "link", tone: "site" as const } : null,
    imdSite ? { key: "imdsite", href: imdSite, label: l.website ? "IMD SITE" : "WEBSITE", icon: "link", tone: l.website ? "imd" as const : "site" as const } : null,
    w?.job ? { key: "imd", href: `https://explorer.imd.fun/jobs/${w.job}`, label: "BUILT BY IMD", icon: "bolt", tone: "imd" as const } : null,
    l.twitter ? { key: "x", href: l.twitter, label: "X" } : null,
    l.telegram ? { key: "tg", href: l.telegram, label: "TELEGRAM" } : null,
    launched ? { key: "solscan", href: solscan("token", l.mint, net), label: "SOLSCAN" } : null,
    launched && net !== "devnet" ? { key: "jup", href: `https://jup.ag/swap/SOL-${l.mint}`, label: "JUPITER" } : null,
    launched && net !== "devnet" ? { key: "dex", href: `https://dexscreener.com/solana/${l.mint}`, label: "DEXSCREENER" } : null,
    launched && l.pool && net !== "devnet" ? { key: "gt", href: `https://www.geckoterminal.com/solana/pools/${l.pool}`, label: "GECKOTERMINAL" } : null,
  ].filter((x): x is NonNullable<typeof x> => !!x);
  if (!links.length) return null;
  return (
    <nav className="sl3-links" aria-label="The token's links">
      {links.map((x) => (
        <a key={x.key} className={`sl3-link${x.tone ? ` ${x.tone}` : ""}`} href={x.href} {...ext}>
          {x.icon && <PxIcon name={x.icon} size={12} />}{x.label}<span aria-hidden="true">↗</span>
        </a>
      ))}
    </nav>
  );
}
