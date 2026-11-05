import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import DotGrid from "../rb/DotGrid";
import StarBorder from "../rb/StarBorder";
import { Link, go } from "../router";
import { PxHero, PxNum, PxPanel, PxSection, PxStat, PxStats, PxTag } from "../saas/kit";
import { PxIcon } from "../saas/PxIcon";
import "../station/station.css";
import "./launchpad.css";
import "../saas/pages/launchpad3.css";
import { type Board, type BoardRow, CHAIN_NAME, age, lpApi, myLaunches, pct, price, short, swapLink, usd } from "./api";
import { NewLaunch } from "./NewLaunch";
import { TokenView } from "./TokenView";

// the Solana launchpad brings Meteora's SDK and Solana's libraries: its own chunk, loaded only there
const SolPages = lazy(() => import("./sol/SolPages").then((x) => ({ default: x.SolPages })));

/** /launchpad (the board), /launchpad/new (launch a coin on IMD), /launchpad/t/:ref (one launch, followed to its pool). */
export function LaunchpadPage({ seg }: { seg: string[] }) {
  if (seg[1] === "sol") return <Suspense fallback={<p className="sl3-dim">Loading the Solana launchpad…</p>}><SolPages seg={seg} /></Suspense>;
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

/** Heavy effects are decoration: wide screens only, never with reduced motion or the lite mode. */
export function useRich(): boolean {
  const [rich, setRich] = useState(false);
  useEffect(() => {
    const wide = matchMedia("(min-width: 900px)");
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setRich(wide.matches && !still.matches && !document.documentElement.hasAttribute("data-lite"));
    sync();
    wide.addEventListener("change", sync);
    still.addEventListener("change", sync);
    return () => { wide.removeEventListener("change", sync); still.removeEventListener("change", sync); };
  }, []);
  return rich;
}

function BoardPage() {
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("trending");
  const [chain, setChain] = useState<"all" | "eth" | "rh">("all");
  const [q, setQ] = useState("");
  const [n, setN] = useState(30);
  const mine = useMemo(myLaunches, []);
  const rich = useRich();
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
    <div className="lp lp3">
      <nav className="lp3-crumb" aria-label="Where you are"><Link to="/geek">GEEK ROOM</Link><i aria-hidden="true">/</i><span>LAUNCHPAD</span><i aria-hidden="true">/</i><span className="imd">BUILT ON IMD</span></nav>
      <PxHero
        kicker="LAUNCHPAD · BUILT ON IMD"
        title="Launch a"
        accent="token."
        lead={<>Launch a coin with the <b>IMD swarm</b>: it is built, tested, audited and deployed with its Uniswap v4 pool, from your own wallet. Then anyone buys it from Ethereum, Base, Robinhood Chain or Solana, into that one pool.</>}
        bg={rich ? <DotGrid dotSize={3} gap={20} baseColor="#10254a" activeColor="#2f7bff" proximity={120} shockRadius={180} shockStrength={3} shape="square" glow={0.35} intro={false} /> : undefined}
        actions={<>
          <StarBorder as="a" href="/launchpad/new" onClick={(e: React.MouseEvent) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go("/launchpad/new"); }} className="lp3-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)">
            <PxIcon name="token" size={14} />LAUNCH A COIN ON IMD
          </StarBorder>
          <Link to="/launchpad/sol" className="px-btn"><PxIcon name="bolt" size={14} />NEW: LAUNCH ON SOLANA</Link>
          <a className="px-btn ghost" href="#how"><PxIcon name="doc" size={14} />HOW IT WORKS</a>
        </>}
        aside={
          <aside className="px-term lp3-term" aria-label="What a launch costs">
            <div className="px-term-h">
              <span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span>
              <b>LAUNCH TERMS</b>
              <span className="px-term-state lp3-imd"><i />IMD</span>
            </div>
            <div className="lp3-terms">
              <div><span>YOU PAY</span><b className="imd">0.5 IMD</b><small>plus gas, from your own wallet</small></div>
              <div><span>IMD'S CHECK</span><b>FREE</b><small>a refused request costs nothing</small></div>
              <div><span>YOU EARN</span><b className="lime">1%</b><small>of every trade on its pool, for good</small></div>
              <div><span>NIGHTSHIFT FEE</span><b>NONE</b><small>it never holds your funds</small></div>
            </div>
            <div className="px-term-f"><span>root@nightshift:~$</span><span>launchpad --new</span><span className="px-term-cursor" aria-hidden="true" /></div>
          </aside>
        }
      />

      <div className="lp3-stats">
        <PxStats cols={3}>
          <PxStat label="Live IMD coins" tone="imd" value={b ? <PxNum value={b.totals.live} /> : "…"} sub={b ? `${b.totals.eth} Ethereum · ${b.totals.rh} Robinhood` : undefined} />
          <PxStat label="With a price" tone="lime" value={b ? <PxNum value={b.totals.priced} /> : "…"} sub="indexed by DexScreener" />
          <PxStat label="Being built" tone="imd" value={b ? <PxNum value={b.totals.building} /> : "…"} sub="by the swarm, now" />
        </PxStats>
      </div>

      <div className="lp3-body">
        {mine.length > 0 && (
          <PxPanel title="Your launches" right="from this browser" className="lp3-mine">
            <div className="lp-chips">{mine.map((m) => <Link key={m.ref} to={`/launchpad/t/${m.ref}`} className="lp-chip">{m.symbol} <small>{age(new Date(m.at).toISOString())} ago</small></Link>)}</div>
          </PxPanel>
        )}

        {b && b.building.length > 0 && (
          <PxPanel title="Being built now" state="live" tone="imd" className="lp-building">
            <div className="lp-chips">
              {b.building.map((x) => (
                <Link key={x.id} to={`/launchpad/t/${x.launchNumber}`} className="lp-chip">
                  {x.symbol ? `$${x.symbol}` : `#${x.launchNumber}`}{x.name && <span>{x.name}</span>}<small>{x.chainId === 1 ? "Ethereum" : "Robinhood"} · {age(x.createdAt)}</small>{x.ours && <em>HERE</em>}
                </Link>
              ))}
            </div>
          </PxPanel>
        )}

        <div className="lp-tools">
          <div className="lp-tabs" role="tablist" aria-label="Sort">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => { setTab(k); setN(30); }}>{l}</button>)}</div>
          <div className="lp-tabs" role="group" aria-label="Chain">{(["all", "eth", "rh"] as const).map((c) => <button key={c} type="button" className={chain === c ? "on" : ""} onClick={() => setChain(c)}>{c === "all" ? "All chains" : CHAIN_NAME[c]}</button>)}</div>
          <label className="lp3-find"><span aria-hidden="true">FIND&gt;</span><input className="lp-search" placeholder="Name, symbol, address or launch #" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} autoComplete="off" aria-label="Search" /></label>
        </div>

        {err && !b && <p className="lp3-warn">The board did not load: {err}</p>}
        {!b && !err && <p className="lp3-empty">Reading IMD's launches and their prices…</p>}
        {b && rows.length === 0 && <p className="lp3-empty">{tab === "here" ? "No coin launched here is live yet. Be the first:" : "Nothing matches."} <Link to="/launchpad/new">launch one</Link>.</p>}
        {rows.length > 0 && (
          <PxPanel title="The board" state="live" right={`${Math.min(n, rows.length)} of ${rows.length}`} className="lp3-board">
            <div className="lp-list" role="list">
              <div className="lp-row lp-head" aria-hidden="true"><span /><span>Coin</span><span>Price</span><span>24h</span><span>Market cap</span><span>Liquidity</span><span>Volume 24h</span><span>Age</span><span /></div>
              {rows.slice(0, n).map((r) => <Row key={r.id} r={r} />)}
            </div>
          </PxPanel>
        )}
        {rows.length > n && <button type="button" className="px-btn lp3-more" onClick={() => setN(n + 30)}>Show {Math.min(30, rows.length - n)} more</button>}
        {b && <p className="lp3-note lp-fine">{b.totals.shown} of {b.totals.live} live IMD coins shown: every one DexScreener prices, and the {b.totals.shown - b.totals.priced} newest it does not price yet. Launches from api.imd.fun, prices from DexScreener, read {age(new Date(b.at).toISOString())} ago. For deeper charts, holders and a sell simulator on every swarm launch, see <a href="https://www.imdradar.site" target="_blank" rel="noreferrer">IMD Radar</a>.</p>}
      </div>

      <PxSection kicker="HOW IT WORKS" title="How a launch works here" id="how">
        <ol className="lp-how">
          <li><b>Describe your coin</b><span>Name, symbol, supply, what it is, its links, and how much of the supply goes in the pool. The form builds IMD's own coin request from it; you can read every byte before you pay.</span></li>
          <li><b>IMD checks it for free</b><span>IMD's check reads the request and says what it would refuse. A refused request costs nothing; only an accepted one can be paid.</span></li>
          <li><b>You pay 0.5 IMD from your wallet</b><span>One payment to IMD's Intake contract, on Ethereum or Robinhood Chain, plus gas. You are the launch's requester: IMD sends you 1% of every trade on its pool, for good. NIGHTSHIFT takes no launch fee and never holds your funds.</span></li>
          <li><b>The swarm builds, tests, audits and deploys it</b><span>IMD's agents write and test the token, four auditors and a judge check it, and IMD's factory deploys it and seeds a Uniswap v4 pool, all of it public on IMD's explorer. 10% of the supply goes to the swarm, by IMD's rules.</span></li>
          <li><b>One pool, bought from any chain</b><span>The pool is single-sided from your opening market cap, so the price rises as people buy, like a bonding curve, with no graduation step; the liquidity is held by IMD's launch factory, not by the creator. NIGHTSHIFT's swap routes ETH, USDC or SOL from Ethereum, Base, Robinhood Chain or Solana into that same pool through Relay and LI.FI.</span></li>
        </ol>
        <p className="lp3-note">What this is not yet: the coin itself lives on one chain. A buyer on Base or Solana pays there and receives the coin on its home chain. A bridgeable version of the same coin on other chains is designed but needs contracts IMD has not built yet. Read <a href="https://github.com/RobertKodes/nightshift/blob/main/docs/launchpad/DESIGN.md" target="_blank" rel="noreferrer">the design</a> and <a href="https://github.com/RobertKodes/nightshift/blob/main/docs/launchpad/RESEARCH.md" target="_blank" rel="noreferrer">the research</a>.</p>
        <div className="lp3-risk" role="note"><PxTag tone="red">RISK</PxTag><p>Coins launched on IMD are new, thin and risky; most go to zero. NIGHTSHIFT lists what IMD launches and does not review, endorse or sell any of them. Check the contract and the pool before you buy.</p></div>
      </PxSection>
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
        <span><i className={`lp-chain ${r.chain}`}>{r.chain === "eth" ? "Ethereum" : "Robinhood"}</i> · <em className="lp3-n">#{r.launchNumber}</em> · {r.name}</span>
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
