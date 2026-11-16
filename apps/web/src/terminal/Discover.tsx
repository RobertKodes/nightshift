import { useEffect, useMemo, useState } from "react";
import { Link } from "../router";
import { PxHero } from "../saas/kit";
import { PxIcon } from "../saas/PxIcon";
import { CHAIN, type Filters, SORTS, type TermToken, type TokenList, DEFAULTS, ago, applyFilters, price, readQuery, termApi, ticker, usd, usePoll, writeQuery } from "./api";
import { ChainTag, CoreStrip, Curve, Delta, Logo, Spark } from "./parts";
import "./terminal.css";

const LIQ: [number, string][] = [[0, "Liq: any"], [1_000, "Liq $1K+"], [10_000, "Liq $10K+"], [100_000, "Liq $100K+"]];
const VOL: [number, string][] = [[0, "Vol: any"], [100, "Vol $100+"], [1_000, "Vol $1K+"], [10_000, "Vol $10K+"]];
const PAGE = 50;

/** One row of the table (wide screens) and its card (phones): the same link, the same numbers. */
function Line({ t, i, now }: { t: TermToken; i: number; now: number }) {
  return (
    <tr>
      <td className="tm-n">{i + 1}</td>
      <td className="tm-tok">
        <Link to={t.href}><Logo src={t.image} symbol={t.symbol} name={t.name} size={30} /><span><b>{t.name}</b><small>{ticker(t)}{t.launchNumber != null ? ` · IMD #${t.launchNumber}` : ""}{t.ours ? " · NIGHTSHIFT" : ""}</small></span></Link>
      </td>
      <td><ChainTag chain={t.chain} /></td>
      <td className="tm-num">{price(t.priceUsd)}</td>
      <td className="tm-num">{usd(t.mcapUsd)}</td>
      <td className="tm-num"><Delta v={t.change24h} /></td>
      <td className="tm-num">{usd(t.vol24)}</td>
      <td className="tm-num">{t.status === "pool" ? usd(t.liquidityUsd) : <Curve t={t} />}</td>
      <td className="tm-num tm-dim">{ago(t.createdAt, now)}</td>
      <td className="tm-go"><Link to={t.href} className="px-btn small">TRADE</Link></td>
    </tr>
  );
}

function Card({ t, now }: { t: TermToken; now: number }) {
  return (
    <li>
      <Link to={t.href} className="tm-mrow" aria-label={`${t.name} on ${CHAIN[t.chain].name}: open to trade`}>
        <Logo src={t.image} symbol={t.symbol} name={t.name} size={38} />
        <span className="tm-mrow-id"><b>{t.name}</b><small><ChainTag chain={t.chain} />{ticker(t)} · {ago(t.createdAt, now)}</small></span>
        <span className="tm-mrow-v"><b>{usd(t.mcapUsd)}</b><Delta v={t.change24h} /></span>
        <span className="tm-mrow-s"><span>VOL {usd(t.vol24)}</span>{t.status === "pool" ? <span>LIQ {usd(t.liquidityUsd)}</span> : <Curve t={t} />}<Spark v={t.spark} w={64} h={18} /></span>
      </Link>
    </li>
  );
}

/** /discover: every token the terminal lists, searchable, filterable, sortable. */
export function DiscoverPage() {
  const { data, error } = usePoll<TokenList>(termApi.tokens, 60_000);
  const [f, setF] = useState<Filters>(() => readQuery(location.search));
  const [shown, setShown] = useState(PAGE);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  useEffect(() => { document.title = "Discover · IMD TERMINAL · NIGHTSHIFT"; }, []);
  // the filters live in the address: shareable, and the back button keeps them
  useEffect(() => { const q = writeQuery(f); if (q !== location.search) history.replaceState(null, "", `/discover${q}`); setShown(PAGE); }, [f]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const rows = useMemo(() => (data ? applyFilters(data.tokens, f, now) : []), [data, f, now]);
  const changed = writeQuery({ ...f, sort: "trending" }) !== "";

  return (
    <div className="px tm tm-dir">
      <PxHero
        kicker="IMD TERMINAL · DISCOVER" live={!!data}
        title="Every token on the terminal." accent="One list."
        lead={<>NIGHTSHIFT's Solana launches and IMD's launches on Ethereum and Robinhood Chain. Search a name, a ticker, an address or an IMD launch number.</>}
        actions={<>
          <Link to="/launchpad/sol/new" className="px-btn primary"><PxIcon name="bolt" size={14} />LAUNCH ON SOLANA</Link>
          <Link to="/" className="px-btn ghost">BACK TO THE TERMINAL</Link>
        </>}
      />

      <CoreStrip core={data?.core} />

      <div className="tm-controls" role="search">
        <label className="tm-search"><PxIcon name="arrow" size={13} /><input className="field" type="search" value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Name, $ticker, address or launch #" aria-label="Search tokens" /></label>
        <div className="tm-chips" role="group" aria-label="Chain">
          {(["all", "sol", "eth", "rh"] as const).map((c) => <button key={c} type="button" className={f.chain === c ? "on" : ""} aria-pressed={f.chain === c} onClick={() => set("chain", c)}>{c === "all" ? "ALL CHAINS" : CHAIN[c].short}</button>)}
        </div>
        <div className="tm-chips" role="group" aria-label="Status">
          {([["all", "ANY STATUS"], ["curve", "ON THE CURVE"], ["graduated", "GRADUATED"], ["pool", "IN A POOL"]] as const).map(([s, label]) => <button key={s} type="button" className={f.status === s ? "on" : ""} aria-pressed={f.status === s} onClick={() => set("status", s)}>{label}</button>)}
          <button type="button" className={f.fresh ? "on" : ""} aria-pressed={f.fresh} onClick={() => set("fresh", !f.fresh)}>NEW · 7 DAYS</button>
        </div>
        <div className="tm-selects">
          <select className="field" value={f.minLiq} onChange={(e) => set("minLiq", Number(e.target.value))} aria-label="Minimum liquidity">{LIQ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="field" value={f.minVol} onChange={(e) => set("minVol", Number(e.target.value))} aria-label="Minimum 24h volume">{VOL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="field" value={f.sort} onChange={(e) => set("sort", e.target.value as Filters["sort"])} aria-label="Sort by">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {changed && <button type="button" className="px-btn small ghost" onClick={() => setF({ ...DEFAULTS, sort: f.sort })}>CLEAR</button>}
        </div>
      </div>

      <p className="tm-count" aria-live="polite">
        {data ? <><b>{rows.length}</b> of {data.tokens.length} tokens · updated {ago(data.at, now) === "now" ? "just now" : `${ago(data.at, now)} ago`}</> : error ? "The token list is not answering right now. This page keeps trying." : "Reading the token list…"}
      </p>

      {data && rows.length === 0 && <p className="tm-empty">Nothing matches. {changed && <button type="button" className="tm-link" onClick={() => setF({ ...DEFAULTS, sort: f.sort })}>Clear the filters</button>}</p>}
      {data && rows.length > 0 && (
        <>
          <div className="tm-table-wrap">
            <table className="tm-table">
              <thead><tr><th>#</th><th>TOKEN</th><th>CHAIN</th><th className="tm-num">PRICE</th><th className="tm-num">MCAP</th><th className="tm-num">24H</th><th className="tm-num">VOL 24H</th><th className="tm-num">LIQ / CURVE</th><th className="tm-num">AGE</th><th /></tr></thead>
              <tbody>{rows.slice(0, shown).map((t, i) => <Line key={t.id} t={t} i={i} now={now} />)}</tbody>
            </table>
          </div>
          <ul className="tm-mlist">{rows.slice(0, shown).map((t) => <Card key={t.id} t={t} now={now} />)}</ul>
          {rows.length > shown && <button type="button" className="tm-more-btn" onClick={() => setShown((n) => n + PAGE)}>SHOW {Math.min(PAGE, rows.length - shown)} MORE</button>}
        </>
      )}

      {data && (
        <div className="tm-sources">
          <p><b>DATA</b> Missing numbers show as “—”: nothing is estimated. Liquidity of a Solana curve shows once GeckoTerminal indexes it.</p>
          <ul>{data.sources.map((s) => <li key={s.id} className={s.ok ? "" : "warn"}><i aria-hidden="true" />{s.label}{s.at ? ` · ${ago(s.at, now) === "now" ? "just now" : `${ago(s.at, now)} ago`}` : ""}{s.note ? ` · ${s.note}` : ""}</li>)}</ul>
          <p className="tm-dim">Looking for the IMD launch form on Ethereum? <Link to="/launchpad/eth">The IMD launchpad on Ethereum →</Link></p>
        </div>
      )}
    </div>
  );
}
