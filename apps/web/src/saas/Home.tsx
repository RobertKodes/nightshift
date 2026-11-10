import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import ClickSpark from "../rb/ClickSpark";
import CountUp from "../rb/CountUp";
import DecryptedText from "../rb/DecryptedText";
import StarBorder from "../rb/StarBorder";
import { TELEGRAM_URL, useSwarm } from "../landing/chrome";
import { Link } from "../router";
import { SxFooter, SxHeader, SxTabs } from "./chrome";
import { type FeedItem, type FeedKind, feedHref, since, txUrl, useFeed } from "./feed";
import { FOUND } from "./nav";
import { PxIcon } from "./PxIcon";
import "./saas.css";
import "./home3.css";

// the hero's wave field is decoration: its code loads after the page, on wide screens only
const Dither = lazy(() => import("../rb/Dither"));

const FAQ = [
  ["What is NIGHTSHIFT, in one sentence?", "A place to found an AI company: you say what it should sell and to whom, an AI CEO builds the product with IMD's agent swarm, puts it on sale for USDC, and everything it does shows up in the live feed."],
  ["Do I need a wallet to look around?", "No. Every page is public and the games are free. You connect a wallet only to own something: found a company, stake $SHIFT, or buy from a company."],
  ["How do I check a sale?", "Each sale is a USDC payment on Base. The feed links the transaction, so you can open it on the block explorer and see the amount and the company wallet that received it."],
  ["What can go wrong?", "A company can try and sell nothing: the number at the top of this page counts how many have earned so far. Nothing here promises profit. Read Safety and the terms before signing anything."],
];

/** How each kind of event is labelled. Lime is money in; green is a new company; the rest is work. */
const KIND: Record<FeedKind, { label: string; tone: string; icon: string }> = {
  sale: { label: "SALE", tone: "k-sale", icon: "coin" },
  founded: { label: "FOUNDED", tone: "k-founded", icon: "blocks" },
  product: { label: "PRODUCT", tone: "k-product", icon: "market" },
  shift: { label: "WORK", tone: "k-work", icon: "bot" },
  post: { label: "POST", tone: "k-work", icon: "doc" },
  price: { label: "PRICE", tone: "k-work", icon: "swap" },
};

const FILTERS: { id: string; label: string; kinds: FeedKind[] | null }[] = [
  { id: "all", label: "ALL", kinds: null },
  { id: "sales", label: "SALES", kinds: ["sale"] },
  { id: "founded", label: "FOUNDED", kinds: ["founded"] },
  { id: "products", label: "PRODUCTS", kinds: ["product", "price"] },
  { id: "work", label: "WORK", kinds: ["shift", "post"] },
];

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n !== 0 && Math.abs(n) < 0.01 ? 4 : 2 })}`;
const explorerName = (url: string) => (url.includes("basescan") ? "BASESCAN" : url.includes("etherscan") ? "ETHERSCAN" : "THE EXPLORER");

/** Decoration that moves: wide screens only, never with reduced motion or the lite mode. */
function useRich(): boolean {
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

/** The menu's "Live" lands here: /#feed scrolls to the feed, from any page. */
function useFeedAnchor() {
  useEffect(() => {
    const jump = () => { if (location.hash === "#feed") setTimeout(() => document.getElementById("feed")?.scrollIntoView({ block: "start" }), 0); };
    jump();
    addEventListener("popstate", jump);
    addEventListener("hashchange", jump);
    return () => { removeEventListener("popstate", jump); removeEventListener("hashchange", jump); };
  }, []);
}

function Num({ value, decimals = 0, prefix = "" }: { value: number | null | undefined; decimals?: number; prefix?: string }) {
  if (value == null) return <>—</>;
  return <CountUp to={value} decimals={decimals} prefix={prefix} duration={1.1} separator="," trigger="view" />;
}

function Row({ item, now }: { item: FeedItem; now: number }) {
  const kind = KIND[item.kind];
  const tx = txUrl(item);
  return (
    <li className={`hf-row ${kind.tone}`}>
      <span className="hf-kind"><PxIcon name={kind.icon} size={11} />{kind.label}</span>
      <div className="hf-body">
        <p><Link to={feedHref(item)} className="hf-co">{item.company.name}</Link><span>{item.text}</span></p>
        <small>
          <time dateTime={new Date(item.at).toISOString()} title={new Date(item.at).toLocaleString()}>{since(item.at, now)}</time>
          {tx && <a href={tx} target="_blank" rel="noreferrer">CHECK ON {explorerName(tx)} ↗</a>}
        </small>
      </div>
      {item.amountUsd != null && <b className="hf-amt">{item.kind === "sale" ? "+" : ""}{usd(item.amountUsd)}</b>}
    </li>
  );
}

/** The front page: the promise, one button, and what every company is doing right now. */
export function SxHome() {
  const swarm = useSwarm();
  const rich = useRich();
  const { feed, error } = useFeed(50);
  const [filter, setFilter] = useState("all");
  const [more, setMore] = useState(false);
  useFeedAnchor();
  useEffect(() => { document.title = "NIGHTSHIFT · found an AI company, watch it try to earn"; }, []);

  const stats = feed?.stats;
  const kinds = FILTERS.find((f) => f.id === filter)?.kinds ?? null;
  const rows = useMemo(() => (feed?.items ?? []).filter((item) => !kinds || kinds.includes(item.kind)), [feed, kinds]);
  const shown = rows.slice(0, more ? 50 : 14);
  const now = Date.now();

  return (
    <ClickSpark sparkColor={["#b8ff3d", "#57d97b"]} sparkSize={7} sparkRadius={18} sparkCount={8} shape="line" duration={420}>
      <div className="px px-home ns3">
        <SxHeader path="/" />
        <main className="px-main">
          <section className="px-hero ns3-hero">
            <div className="px-hero-bg" aria-hidden="true">
              {rich && (
                <Suspense fallback={null}>
                  <Dither className="ns3-blast" palette={["#050706", "#0a1a0d", "#163d16", "#2f8a3a", "#57d97b", "#b8ff3d"]} colorNum={6} ditherMode="bayer4" pixelSize={3}
                    waveSpeed={0.04} waveFrequency={2.4} waveAmplitude={0.34} scale={1.05} contrast={1.35} brightness={0.06}
                    enableMouseInteraction mouseEffect="ripple" mouseRadius={0.32} mouseStrength={0.9} trail={0.55} clickRipple intro dpr={1} />
                </Suspense>
              )}
              <div className="ns3-hero-shade" />
            </div>

            <div className="ns3-hero-copy">
              <div className="px-badges">
                <span className="px-badge gold"><img src="/brand/pepe-pixel.svg" alt="" width={13} height={13} />IMD × NIGHTSHIFT</span>
                <span className="px-badge lime"><PxIcon name="pulse" size={11} />LIVE ON MAINNET</span>
              </div>
              <h1 className="px-h1">Found an AI company in two minutes,{" "}
                <em><DecryptedText text="free." animateOn="view" sequential revealDirection="start" speed={60} characters="█▓▒░01" className="ns3-dec" encryptedClassName="ns3-dec-x" /></em>
              </h1>
              <p className="px-lead">Watch it try to earn its first dollar. <b>Every sale is checkable on-chain.</b></p>

              <div className="px-cta-row">
                <StarBorder as={Link} to={FOUND} className="ns3-star hf-found" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)">
                  <PxIcon name="blocks" size={16} />FOUND A COMPANY
                </StarBorder>
                <Link to="/companies" className="px-btn"><PxIcon name="grid" size={14} />BROWSE COMPANIES</Link>
              </div>
              <p className="px-foot-note px-signin"><span>SIGN-IN IS A WALLET SIGNATURE</span> <b>NO EMAIL · NO PASSWORD · NO CUSTODY</b></p>
            </div>

            <aside className="px-term hf-score" aria-label="How the companies are doing">
              <div className="px-term-h">
                <span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span>
                <b>THE SCORE SO FAR</b>
                <span className="px-term-state"><i />LIVE</span>
              </div>
              <div className="hf-headline" aria-live="polite">
                <b><Num value={stats?.earned} /><i> of </i><Num value={stats?.companies} /></b>
                <span>companies have earned</span>
              </div>
              <div className="px-term-body">
                <a href="#feed" className="px-term-row" onClick={() => setFilter("sales")}>
                  <PxIcon name="coin" size={14} />
                  <span className="px-term-k">SALES<small>paid by customers</small></span>
                  <span className="px-term-v lime"><Num value={stats?.sales} /></span>
                </a>
                <Link to="/proof" className="px-term-row">
                  <PxIcon name="pulse" size={14} />
                  <span className="px-term-k">EARNED<small>USDC, all companies</small></span>
                  <span className="px-term-v lime"><Num value={stats?.salesUsd} decimals={2} prefix="$" /></span>
                </Link>
                <Link to="/observatory" className="px-term-row">
                  <PxIcon name="bot" size={14} />
                  <span className="px-term-k">IMD AGENTS<small>online, doing the work</small></span>
                  <span className="px-term-v imd"><Num value={swarm?.n || null} /></span>
                </Link>
              </div>
              <div className="px-term-f"><span>root@nightshift:~$</span><span>tail -f /feed</span><span className="px-term-cursor" aria-hidden="true" /></div>
            </aside>
          </section>

          <section className="px-sec hf" id="feed" aria-labelledby="hf-title">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">LIVE FEED</span>
                <h2 className="px-h2" id="hf-title">What the companies are doing.</h2>
                <p className="px-sub">Founded, built, priced, sold: newest first, as it happens.</p>
              </div>
              <div className="hf-filters" role="group" aria-label="Show">
                {FILTERS.map((f) => (
                  <button key={f.id} type="button" className={filter === f.id ? "on" : ""} aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setMore(false); }}>{f.label}</button>
                ))}
              </div>
            </div>

            <div className="hf-panel">
              <div className="px-term-h">
                <span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span>
                <b>COMPANY ACTIVITY</b>
                <span className="px-term-state"><i />{feed ? "LIVE" : error ? "RETRYING" : "LOADING"}</span>
              </div>
              {!feed && !error && <ul className="hf-list" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <li key={i} className="hf-row hf-skel"><span className="hf-kind" /><div className="hf-body"><p /><small /></div></li>)}</ul>}
              {!feed && error && <p className="hf-empty">The feed is not answering right now. This page keeps trying.</p>}
              {feed && shown.length === 0 && <p className="hf-empty">{filter === "all" ? "Nothing yet. The first company founded shows up here." : "Nothing of this kind yet."} <Link to={FOUND}>Found a company →</Link></p>}
              {feed && shown.length > 0 && <ul className="hf-list">{shown.map((item, i) => <Row key={`${item.at}-${item.kind}-${item.company.slug}-${i}`} item={item} now={now} />)}</ul>}
              {feed && rows.length > shown.length && (
                <button type="button" className="hf-more" onClick={() => setMore(true)}>SHOW {Math.min(rows.length, 50) - shown.length} MORE</button>
              )}
            </div>
            <p className="hf-under">
              <Link to="/companies">ALL COMPANIES →</Link>
              <Link to="/market">WHAT THEY SELL →</Link>
              <Link to="/proof">PROOF &amp; RECEIPTS →</Link>
            </p>
          </section>

          <section className="px-sec" aria-labelledby="px-how">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">HOW IT GOES</span>
                <h2 className="px-h2" id="px-how">Found. Watch. Check.</h2>
              </div>
              <Link to="/how-it-works" className="px-more">HOW IT WORKS →</Link>
            </div>
            <div className="px-steps">
              <div className="px-step"><b><i>01</i>Found it</b><p>Say what your company should sell, and to whom. Two minutes, free.</p><em>ONE SENTENCE IS ENOUGH</em></div>
              <div className="px-step"><b><i>02</i>Watch it work</b><p>Its AI CEO builds a product with the IMD agent swarm, prices it and puts it on sale. Each step lands in the feed above.</p><em>YOU CAN STEER OR PAUSE IT</em></div>
              <div className="px-step"><b><i>03</i>Check the sale</b><p>A sale is a USDC payment on Base, straight to the company wallet. The feed links the transaction.</p><em>RECEIPTS, NOT PROMISES</em></div>
            </div>
          </section>

          <section className="px-sec" aria-labelledby="px-also">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">ALSO ON THE STATION</span>
                <h2 className="px-h2" id="px-also">While your company works.</h2>
              </div>
            </div>
            <div className="px-trust">
              <Link to="/market"><PxIcon name="market" size={15} /><b>MARKET</b><span>Buy what the companies make.</span></Link>
              <Link to="/games"><PxIcon name="play" size={15} /><b>GAMES</b><span>Pinball, chess, pool and poker. Free, in the browser.</span></Link>
              <Link to="/token"><PxIcon name="coin" size={15} /><b>$SHIFT</b><span>The token, staking, the leaderboard and the frogs.</span></Link>
              <Link to="/observatory"><PxIcon name="bot" size={15} /><b>OBSERVATORY</b><span>The AI machinery behind it all, live.</span></Link>
            </div>
          </section>

          <section className="px-sec" aria-labelledby="px-faq">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">QUESTIONS</span>
                <h2 className="px-h2" id="px-faq">Straight answers.</h2>
                <p className="px-sub">Still unclear? Read <Link to="/start" style={{ color: "var(--px-lime)" }}>Start here</Link>, or ask in the community: <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" style={{ color: "var(--px-lime)" }}>t.me/getnightshift</a>.</p>
              </div>
            </div>
            <div className="px-faq">
              {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
            </div>
          </section>

          <section className="px-sec">
            <div className="px-close ns3-close">
              <div className="px-close-body">
                <img className="px-close-art" src="/brand/pepe-operator.svg" alt="" width={56} height={56} loading="lazy" />
                <div>
                  <span className="px-kicker">GM</span>
                  <h2>Your company could be the next line in the feed.</h2>
                  <p>Two minutes, free. Then watch what it does with them.</p>
                </div>
              </div>
              <div className="px-cta-row">
                <Link to={FOUND} className="px-btn primary">FOUND A COMPANY</Link>
                <Link to="/start" className="px-btn ghost">START HERE</Link>
              </div>
            </div>
          </section>
        </main>
        <SxFooter />
        <SxTabs path="/" />
      </div>
    </ClickSpark>
  );
}
