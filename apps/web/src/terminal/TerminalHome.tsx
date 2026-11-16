import { type ReactNode, Suspense, lazy, useEffect, useState } from "react";
import ClickSpark from "../rb/ClickSpark";
import StarBorder from "../rb/StarBorder";
import { Link } from "../router";
import { SxFooter, SxHeader, SxTabs } from "../saas/chrome";
import { FOUND } from "../saas/nav";
import { PxIcon } from "../saas/PxIcon";
import { type Activity, CHAIN, type Home, type SectionId, type Source, type TermToken, ago, termApi, ticker, usd, usePoll } from "./api";
import { ChainTag, CoreStrip, Logo, TokenCard } from "./parts";
import "../saas/saas.css";
import "../saas/home3.css";
import "./terminal.css";

// the hero's dot field is decoration: its code loads after the page, on wide screens only
const DotGrid = lazy(() => import("../rb/DotGrid"));

/** Wide screens, no reduced motion, not the lite mode. */
function useRich(): boolean {
  const [rich, setRich] = useState(false);
  useEffect(() => {
    const wide = matchMedia("(min-width: 900px)"), still = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setRich(wide.matches && !still.matches && !document.documentElement.hasAttribute("data-lite"));
    sync();
    wide.addEventListener("change", sync); still.addEventListener("change", sync);
    return () => { wide.removeEventListener("change", sync); still.removeEventListener("change", sync); };
  }, []);
  return rich;
}

const ROWS: { id: SectionId; kicker: string; title: string; sub: string; more: { to: string; label: string }; empty: ReactNode }[] = [
  { id: "trending", kicker: "TRENDING", title: "Most traded right now.", sub: "Most trades in the last 24 hours, then the most volume.", more: { to: "/discover", label: "ALL TOKENS" }, empty: "No trades recorded in the last 24 hours yet." },
  { id: "fresh", kicker: "NEW LAUNCHES", title: "Just launched.", sub: "Solana launches through NIGHTSHIFT and IMD launches, newest first.", more: { to: "/discover?sort=newest", label: "NEWEST" }, empty: "No launches listed yet." },
  { id: "graduating", kicker: "ABOUT TO GRADUATE", title: "Close to graduation.", sub: "Solana bonding curves 70% sold or more. At 100% the liquidity is locked in a Meteora pool for good.", more: { to: "/launchpad", label: "SOLANA BOARD" }, empty: <>No Solana curve is 70% sold yet. <Link to="/launchpad">See every Solana launch →</Link></> },
  { id: "gainers", kicker: "BIGGEST GAINERS · 24H", title: "Up the most.", sub: "Pools under $1,000 of liquidity are left out: they move on almost nothing.", more: { to: "/discover?sort=change", label: "BY 24H CHANGE" }, empty: "No token with a 24-hour change up yet." },
  { id: "losers", kicker: "BIGGEST LOSERS · 24H", title: "Down the most.", sub: "Same rule: real liquidity only.", more: { to: "/discover?sort=change", label: "BY 24H CHANGE" }, empty: "No token with a 24-hour change down." },
  { id: "volume", kicker: "BIGGEST VOLUME · 24H", title: "Where the money moves.", sub: "Dollar volume traded in the last 24 hours.", more: { to: "/discover?sort=volume", label: "BY VOLUME" }, empty: "No 24-hour volume recorded yet." },
];

function Skeleton() {
  return <div className="tm-row" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i} className="tm-card tm-skel" />)}</div>;
}

function Section({ row, list, loading }: { row: (typeof ROWS)[number]; list: TermToken[] | undefined; loading: boolean }) {
  return (
    <section className="px-sec tm-sec" aria-labelledby={`tm-${row.id}`}>
      <div className="px-sec-head">
        <div>
          <span className="px-kicker">{row.kicker}</span>
          <h2 className="px-h2" id={`tm-${row.id}`}>{row.title}</h2>
          <p className="px-sub">{row.sub}</p>
        </div>
        <Link to={row.more.to} className="px-more">{row.more.label} →</Link>
      </div>
      {loading ? <Skeleton /> : list && list.length ? <div className="tm-row">{list.map((t) => <TokenCard key={t.id} t={t} />)}</div> : <p className="tm-empty">{row.empty}</p>}
    </section>
  );
}

const solscanTx = (tx: string) => `https://solscan.io/tx/${tx}`;

function ActivityRow({ a, now }: { a: Activity; now: number }) {
  return (
    <li className={`tm-act ${a.kind}`}>
      <span className="tm-act-kind">{a.kind === "launch" ? "LAUNCH" : a.kind.toUpperCase()}</span>
      <Link to={a.token.href} className="tm-act-tok">
        <Logo src={a.token.image} symbol={a.token.symbol} name={a.token.name} size={22} />
        <b>{a.token.symbol ? ticker(a.token) : a.token.name}</b>
        <ChainTag chain={a.token.chain} />
      </Link>
      <span className="tm-act-usd">{a.usd != null ? usd(a.usd) : a.kind === "launch" ? <small>{CHAIN[a.token.chain].name}</small> : "—"}</span>
      <span className="tm-act-at">
        <time dateTime={new Date(a.at).toISOString()} title={new Date(a.at).toLocaleString()}>{ago(a.at, now)}</time>
        {a.tx && a.token.chain === "sol" && <a href={solscanTx(a.tx)} target="_blank" rel="noreferrer" aria-label="Open the transaction on Solscan">TX ↗</a>}
      </span>
    </li>
  );
}

/** Where every number came from, and how old it is. */
function Sources({ sources, at, now }: { sources: Source[]; at: number; now: number }) {
  return (
    <div className="tm-sources">
      <p><b>DATA</b> Updated {ago(at, now) === "now" ? "just now" : `${ago(at, now)} ago`}. Missing numbers show as “—”: nothing is estimated.</p>
      <ul>{sources.map((s) => <li key={s.id} className={s.ok ? "" : "warn"}><i aria-hidden="true" />{s.label}{s.at ? ` · ${ago(s.at, now) === "now" ? "just now" : `${ago(s.at, now)} ago`}` : ""}{s.note ? ` · ${s.note}` : ""}</li>)}</ul>
    </div>
  );
}

const MORE: { to: string; icon: string; label: string; line: string; external?: boolean }[] = [
  { to: "/companies", icon: "blocks", label: "COMPANIES", line: "AI companies, founded in two minutes" },
  { to: "/games", icon: "play", label: "GAMES", line: "Pinball, chess, pool, poker" },
  { to: "/swap", icon: "swap", label: "SWAP", line: "Any token, from any chain" },
  { to: "/stake", icon: "coin", label: "$SHIFT · STAKE", line: "The token, staking, the frogs" },
  { to: "https://gods.getnightshift.tech", icon: "token", label: "GODS OF IMD", line: "The 3D village on Ethereum", external: true },
  { to: "/observatory", icon: "bot", label: "OBSERVATORY", line: "The AI machinery, live" },
];

/** The front page: IMD TERMINAL. Discover IMD tokens, launch on Solana, trade. */
export function TerminalHome() {
  const { data: home, error } = usePoll<Home>(termApi.home, 30_000);
  const rich = useRich();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    document.title = "IMD TERMINAL · discover, launch and trade IMD tokens · NIGHTSHIFT";
    // the company feed moved to /feed: old links to /#feed land there
    if (location.hash === "#feed") location.replace("/feed#feed");
  }, []);
  const c = home?.counts;

  return (
    <ClickSpark sparkColor={["#b8ff3d", "#57d97b"]} sparkSize={7} sparkRadius={18} sparkCount={8} shape="line" duration={420}>
      <div className="px px-home ns3 tm">
        <SxHeader path="/" />
        <main className="px-main">
          <section className="px-hero tm-hero">
            <div className="px-hero-bg tm-hero-bg" aria-hidden="true">
              {rich && <Suspense fallback={null}><DotGrid dotSize={3} gap={18} baseColor="#0f2a1c" activeColor="#b8ff3d" proximity={120} shockRadius={180} shockStrength={3} shape="square" /></Suspense>}
            </div>
            <div className="tm-hero-copy">
              <div className="px-badges">
                <span className="px-badge tm-badge-imd"><PxIcon name="bot" size={11} />IMD TERMINAL</span>
                <span className="px-badge lime"><img src="/brand/pepe-pixel.svg" alt="" width={13} height={13} />POWERED BY NIGHTSHIFT</span>
              </div>
              <h1 className="px-h1 tm-h1">IMD <em>TERMINAL</em></h1>
              <p className="tm-verbs" aria-label="Discover, launch, trade. Boost is coming.">
                <b>DISCOVER</b><i aria-hidden="true">·</i><b>LAUNCH</b><i aria-hidden="true">·</i><b>TRADE</b><i aria-hidden="true">·</i><span>BOOST<sup>SOON</sup></span>
              </p>
              <p className="px-lead">IMD tokens on Solana, Ethereum and Robinhood Chain, in one place. Find one, trade it, or <b>launch your own on Solana with the IMD swarm</b>.</p>
              <div className="px-cta-row tm-cta">
                <StarBorder as={Link} to="/launchpad/sol/new" className="ns3-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)">
                  <PxIcon name="bolt" size={16} />LAUNCH ON SOLANA
                </StarBorder>
                <Link to="/discover" className="px-btn"><PxIcon name="grid" size={14} />DISCOVER TOKENS</Link>
              </div>
            </div>

            <aside className="px-term tm-pulse" aria-label="The market right now">
              <div className="px-term-h">
                <span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span>
                <b>MARKET PULSE</b>
                <span className="px-term-state"><i />{home ? "LIVE" : error ? "RETRYING" : "LOADING"}</span>
              </div>
              <div className="px-term-body">
                <Link to="/discover" className="px-term-row"><PxIcon name="grid" size={14} /><span className="px-term-k">TOKENS LISTED<small>{c ? `${c.sol} Solana · ${c.eth} Ethereum · ${c.rh} Robinhood` : "Solana · Ethereum · Robinhood"}</small></span><span className="px-term-v lime">{c ? c.tokens : "—"}</span></Link>
                <Link to="/launchpad" className="px-term-row"><PxIcon name="bolt" size={14} /><span className="px-term-k">ON THE SOLANA CURVE<small>{c ? `${c.graduated} graduated` : "launched through NIGHTSHIFT"}</small></span><span className="px-term-v">{c ? c.curve : "—"}</span></Link>
                <div className="px-term-row"><PxIcon name="coin" size={14} /><span className="px-term-k">SOL<small>in USD</small></span><span className="px-term-v">{home?.prices.solUsd ? `$${home.prices.solUsd.toFixed(2)}` : "—"}</span></div>
                <div className="px-term-row"><PxIcon name="token" size={14} /><span className="px-term-k">IMD<small>in USD, from its pools</small></span><span className="px-term-v tm-imd">{home?.prices.imdUsd ? `$${home.prices.imdUsd.toFixed(2)}` : "—"}</span></div>
              </div>
              <div className="px-term-f"><span>root@imd-terminal:~$</span><span>watch --chains sol,eth,rh</span><span className="px-term-cursor" aria-hidden="true" /></div>
            </aside>
          </section>

          <CoreStrip core={home?.core} />

          {error && !home && <p className="tm-warn" role="status">The token list is not answering right now. This page keeps trying.</p>}

          {ROWS.slice(0, 3).map((row) => <Section key={row.id} row={row} list={home?.sections[row.id]} loading={!home && !error} />)}

          <div className="tm-pair">
            {ROWS.slice(3, 5).map((row) => <Section key={row.id} row={row} list={home?.sections[row.id]} loading={!home && !error} />)}
          </div>
          <Section row={ROWS[5]!} list={home?.sections.volume} loading={!home && !error} />

          <section className="px-sec tm-sec" aria-labelledby="tm-live">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">LIVE ACTIVITY</span>
                <h2 className="px-h2" id="tm-live">As it happens.</h2>
                <p className="px-sub">Launches from the last 7 days, and the latest trades on the Solana launches that moved last.</p>
              </div>
            </div>
            <div className="tm-live">
              <div className="px-term-h">
                <span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span>
                <b>ACTIVITY</b>
                <span className="px-term-state"><i />{home ? "LIVE" : error ? "RETRYING" : "LOADING"}</span>
              </div>
              {!home ? <p className="tm-empty">{error ? "Not answering right now. This page keeps trying." : "Reading…"}</p>
                : home.activity.length ? <ul className="tm-acts">{home.activity.map((a, i) => <ActivityRow key={`${a.kind}-${a.token.id}-${a.at}-${i}`} a={a} now={now} />)}</ul>
                  : <p className="tm-empty">Nothing in the last 7 days yet. <Link to="/launchpad/sol/new">Launch the next one →</Link></p>}
            </div>
            {home && <Sources sources={home.sources} at={home.at} now={now} />}
          </section>

          <section className="px-sec" aria-labelledby="tm-why">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">ONE PLACE</span>
                <h2 className="px-h2" id="tm-why">Find it, launch it, trade it.</h2>
              </div>
            </div>
            <div className="tm-why">
              <Link to="/launchpad/sol/new" className="tm-why-c"><b><PxIcon name="bolt" size={13} />LAUNCH</b><span>On a Solana bonding curve. The IMD swarm can review your token, draw its logo and banner and build its website before it goes live. At graduation its liquidity is locked for good.</span></Link>
              <Link to="/discover" className="tm-why-c"><b><PxIcon name="swap" size={13} />TRADE</b><span>Every card opens the token's page: Solana launches trade on their curve with SOL from your wallet; IMD tokens on Ethereum can be bought from other chains through NIGHTSHIFT Swap.</span></Link>
              <div className="tm-why-c soon"><b><PxIcon name="pulse" size={13} />BOOST <sup>SOON</sup></b><span>Not open yet.</span></div>
            </div>
          </section>

          <section className="px-sec tm-more" aria-labelledby="tm-more">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">MORE FROM NIGHTSHIFT</span>
                <h2 className="px-h2" id="tm-more">The rest of the station.</h2>
              </div>
              <Link to={FOUND} className="px-more">FOUND A COMPANY →</Link>
            </div>
            <nav className="tm-more-r" aria-label="More from NIGHTSHIFT">
              {MORE.map((m) => m.external
                ? <a key={m.to} href={m.to} target="_blank" rel="noopener"><PxIcon name={m.icon} size={14} /><b>{m.label} ↗</b><span>{m.line}</span></a>
                : <Link key={m.to} to={m.to}><PxIcon name={m.icon} size={14} /><b>{m.label}</b><span>{m.line}</span></Link>)}
            </nav>
          </section>
        </main>
        <SxFooter />
        <SxTabs path="/" />
      </div>
    </ClickSpark>
  );
}
