import { useEffect, useMemo, useState } from "react";
import { Link } from "../router";
import { Stat } from "../station/Station";
import "../station/station.css";
import "./launchpad.css";
import { type Board, type BoardRow, CHAIN_NAME, age, lpApi, myLaunches, pct, price, short, swapLink, usd } from "./api";
import { NewLaunch } from "./NewLaunch";
import { TokenView } from "./TokenView";

/** /launchpad (the board), /launchpad/new (launch a coin on IMD), /launchpad/t/:ref (one launch, followed to its pool). */
export function LaunchpadPage({ seg }: { seg: string[] }) {
  if (seg[1] === "new") return <NewLaunch />;
  if (seg[1] === "t" && seg[2]) return <TokenView key={seg[2]} ref_={decodeURIComponent(seg[2])} />;
  return <BoardPage />;
}

type Tab = "trending" | "new" | "biggest" | "here";
const TABS: [Tab, string][] = [["trending", "Trending"], ["new", "New"], ["biggest", "Biggest"], ["here", "Launched here"]];

export function Logo({ src, symbol, size = 40 }: { src: string | null; symbol: string | null; size?: number }) {
  const [bad, setBad] = useState(false);
  return src && !bad
    ? <img className="lp-logo" src={src} alt="" width={size} height={size} loading="lazy" onError={() => setBad(true)} />
    : <span className="lp-logo lp-letter" style={{ width: size, height: size }} aria-hidden="true">{(symbol ?? "?").slice(0, 1)}</span>;
}

function BoardPage() {
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("trending");
  const [chain, setChain] = useState<"all" | "eth" | "rh">("all");
  const [q, setQ] = useState("");
  const [n, setN] = useState(30);
  const mine = useMemo(myLaunches, []);
  useEffect(() => {
    document.title = "Launch a token · NIGHTSHIFT";
    const load = () => lpApi.board().then((x) => { setB(x); setErr(null); }, (e: Error) => setErr(e.message));
    void load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);

  const rows = useMemo(() => {
    if (!b) return [];
    const needle = q.trim().toLowerCase();
    let r = b.rows.filter((x) => (chain === "all" || x.chain === chain) && (!needle || x.name.toLowerCase().includes(needle) || (x.symbol ?? "").toLowerCase().includes(needle) || x.token === needle || String(x.launchNumber) === needle));
    if (tab === "here") r = r.filter((x) => x.ours);
    // a pool with almost no liquidity sorts last, whatever its volume says
    const ok = (x: BoardRow) => Boolean(x.market && x.market.liquidityUsd >= DRAINED_USD);
    const vol = (x: BoardRow) => (ok(x) ? x.market!.volume24 : -1), cap = (x: BoardRow) => (ok(x) ? x.market!.mcapUsd ?? x.market!.liquidityUsd : -1);
    return [...r].sort(tab === "trending" ? (x, y) => vol(y) - vol(x) || cap(y) - cap(x) : tab === "biggest" ? (x, y) => cap(y) - cap(x) : (x, y) => y.launchNumber - x.launchNumber);
  }, [b, tab, chain, q]);

  return (
    <div className="st-room lp">
      <header className="st-hero slim" style={{ "--acc": "#4ad8ff" } as React.CSSProperties}>
        <img className="st-hero-art" src="/art/station/room-geek-1600x900.webp" alt="" />
        <div className="st-hero-in">
          <span className="st-deck"><Link to="/geek">GEEK ROOM</Link> · LAUNCHPAD · BUILT ON IMD</span>
          <h1>Launch a token</h1>
          <p>Launch a coin with the IMD swarm: it is built, tested, audited and deployed with its Uniswap v4 pool, from your own wallet. Then anyone buys it from Ethereum, Base, Robinhood Chain or Solana, into that one pool.</p>
          <div className="st-row">
            <Link to="/launchpad/new" className="st-cta">Launch a coin on IMD</Link>
            <a className="st-cta ghost" href="#how">How it works</a>
          </div>
          <div className="st-stats">
            <Stat label="Live IMD coins" value={b ? b.totals.live : "…"} note={b ? `${b.totals.eth} Ethereum · ${b.totals.rh} Robinhood` : undefined} />
            <Stat label="With a price" value={b ? b.totals.priced : "…"} note="indexed by DexScreener" />
            <Stat label="Being built" value={b ? b.totals.building : "…"} note="by the swarm, now" />
          </div>
        </div>
      </header>

      <div className="st-body">
        {mine.length > 0 && (
          <section className="st-panel lp-mine">
            <h3>Your launches <small>from this browser</small></h3>
            <div className="lp-chips">{mine.map((m) => <Link key={m.ref} to={`/launchpad/t/${m.ref}`} className="lp-chip">{m.symbol} <small>{age(new Date(m.at).toISOString())} ago</small></Link>)}</div>
          </section>
        )}

        {b && b.building.length > 0 && (
          <section className="lp-building" aria-label="Being built now">
            <span className="lp-kicker"><i className="lp-pulse" />BEING BUILT NOW</span>
            <div className="lp-chips">
              {b.building.map((x) => (
                <Link key={x.id} to={`/launchpad/t/${x.launchNumber}`} className="lp-chip">
                  {x.symbol ? `$${x.symbol}` : `#${x.launchNumber}`}{x.name && <span>{x.name}</span>}<small>{x.chainId === 1 ? "Ethereum" : "Robinhood"} · {age(x.createdAt)}</small>{x.ours && <em>HERE</em>}
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="lp-tools">
          <div className="lp-tabs" role="tablist" aria-label="Sort">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => { setTab(k); setN(30); }}>{l}</button>)}</div>
          <div className="lp-tabs" role="group" aria-label="Chain">{(["all", "eth", "rh"] as const).map((c) => <button key={c} type="button" className={chain === c ? "on" : ""} onClick={() => setChain(c)}>{c === "all" ? "All chains" : CHAIN_NAME[c]}</button>)}</div>
          <input className="lp-search" placeholder="Name, symbol, address or launch #" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} autoComplete="off" aria-label="Search" />
        </div>

        {err && !b && <p className="st-warn">The board did not load: {err}</p>}
        {!b && !err && <p className="st-empty">Reading IMD's launches and their prices…</p>}
        {b && rows.length === 0 && <p className="st-empty">{tab === "here" ? "No coin launched here is live yet. Be the first:" : "Nothing matches."} <Link to="/launchpad/new">launch one</Link>.</p>}
        {rows.length > 0 && (
          <div className="lp-list" role="list">
            <div className="lp-row lp-head" aria-hidden="true"><span /><span>Coin</span><span>Price</span><span>24h</span><span>Market cap</span><span>Liquidity</span><span>Volume 24h</span><span>Age</span><span /></div>
            {rows.slice(0, n).map((r) => <Row key={r.id} r={r} />)}
          </div>
        )}
        {rows.length > n && <button type="button" className="st-more" onClick={() => setN(n + 30)}>Show {Math.min(30, rows.length - n)} more</button>}
        {b && <p className="st-note lp-fine">{b.totals.shown} of {b.totals.live} live IMD coins shown: every one DexScreener prices, and the {b.totals.shown - b.totals.priced} newest it does not price yet. Launches from api.imd.fun, prices from DexScreener, read {age(new Date(b.at).toISOString())} ago. For deeper charts, holders and a sell simulator on every swarm launch, see <a href="https://www.imdradar.site" target="_blank" rel="noreferrer">IMD Radar</a>.</p>}

        <h2 id="how">How a launch works here</h2>
        <ol className="lp-how">
          <li><b>Describe your coin</b><span>Name, symbol, supply, what it is, its links, and how much of the supply goes in the pool. The form builds IMD's own coin request from it; you can read every byte before you pay.</span></li>
          <li><b>IMD checks it for free</b><span>IMD's check reads the request and says what it would refuse. A refused request costs nothing; only an accepted one can be paid.</span></li>
          <li><b>You pay 0.5 IMD from your wallet</b><span>One payment to IMD's Intake contract, on Ethereum or Robinhood Chain, plus gas. You are the launch's requester: IMD sends you 1% of every trade on its pool, for good. NIGHTSHIFT takes no launch fee and never holds your funds.</span></li>
          <li><b>The swarm builds, tests, audits and deploys it</b><span>IMD's agents write and test the token, four auditors and a judge check it, and IMD's factory deploys it and seeds a Uniswap v4 pool, all of it public on IMD's explorer. 10% of the supply goes to the swarm, by IMD's rules.</span></li>
          <li><b>One pool, bought from any chain</b><span>The pool is single-sided from your opening market cap, so the price rises as people buy, like a bonding curve, with no graduation step; the liquidity is held by IMD's launch factory, not by the creator. NIGHTSHIFT's swap routes ETH, USDC or SOL from Ethereum, Base, Robinhood Chain or Solana into that same pool through Relay and LI.FI.</span></li>
        </ol>
        <p className="st-note">What this is not yet: the coin itself lives on one chain. A buyer on Base or Solana pays there and receives the coin on its home chain. A bridgeable version of the same coin on other chains is designed but needs contracts IMD has not built yet. Read <a href="https://github.com/RobertKodes/nightshift/blob/main/docs/launchpad/DESIGN.md" target="_blank" rel="noreferrer">the design</a> and <a href="https://github.com/RobertKodes/nightshift/blob/main/docs/launchpad/RESEARCH.md" target="_blank" rel="noreferrer">the research</a>.</p>
        <p className="st-warn">Coins launched on IMD are new, thin and risky; most go to zero. NIGHTSHIFT lists what IMD launches and does not review, endorse or sell any of them. Check the contract and the pool before you buy.</p>
      </div>
    </div>
  );
}

/** A pool DexScreener prices but that holds almost nothing: listed, never offered as a buy. */
const DRAINED_USD = 500;
function Row({ r }: { r: BoardRow }) {
  const m = r.market, drained = Boolean(m && m.liquidityUsd < DRAINED_USD);
  return (
    <div className="lp-row" role="listitem">
      <Logo src={r.logo} symbol={r.symbol} />
      <Link to={`/launchpad/t/${r.launchNumber}`} className="lp-name">
        <b>{r.symbol ? `$${r.symbol}` : r.name}{r.ours && <em className="lp-here">HERE</em>}</b>
        <span><i className={`lp-chain ${r.chain}`}>{r.chain === "eth" ? "Ethereum" : "Robinhood"}</i> · #{r.launchNumber} · {r.name}</span>
      </Link>
      <span className="lp-num lp-price">{m ? price(m.priceUsd) : <i className="dim">not priced yet</i>}</span>
      <span className={`lp-num lp-chg ${m ? (m.change24h >= 0 ? "up" : "down") : ""}`}>{m ? pct(m.change24h) : ""}</span>
      <span className="lp-num lp-cap">{m ? <><i>mcap </i>{usd(m.mcapUsd)}</> : ""}</span>
      <span className="lp-num lp-liq">{m ? usd(m.liquidityUsd) : ""}</span>
      <span className="lp-num lp-vol">{m ? usd(m.volume24) : ""}</span>
      <span className="lp-num lp-age dim">{age(r.createdAt)}</span>
      <span className="lp-act">
        {drained ? <span className="lp-drained" title={`Under $${DRAINED_USD} of liquidity: a buy would get almost nothing back`}>Pool nearly empty</span> : <Link to={swapLink(r)} className="lp-buy">Buy from any chain</Link>}
        <a className="lp-addr" href={`https://explorer.imd.fun/token/${r.token}`} target="_blank" rel="noreferrer" title="On IMD's explorer">{short(r.token)}</a>
      </span>
    </div>
  );
}
