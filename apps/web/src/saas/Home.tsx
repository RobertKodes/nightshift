import { useEffect, useState } from "react";
import AnimatedList from "../rb/AnimatedList";
import ChromaGrid from "../rb/ChromaGrid";
import ClickSpark from "../rb/ClickSpark";
import CountUp from "../rb/CountUp";
import DecryptedText from "../rb/DecryptedText";
import GlitchText from "../rb/GlitchText";
import DotGrid from "../rb/DotGrid";
import LogoLoop from "../rb/LogoLoop";
import MagicBento from "../rb/MagicBento";
import Dither from "../rb/Dither";
import PixelCard from "../rb/PixelCard";
import SplitFlapText from "../rb/SplitFlapText";
import StarBorder from "../rb/StarBorder";
import GlareHover from "../rb/GlareHover";
import Magnet from "../rb/Magnet";
import TextType from "../rb/TextType";
import { useSwarm, TELEGRAM_URL } from "../landing/chrome";
import { Link } from "../router";
import { SECTIONS } from "../site/sitemap";
import { SxFooter, SxHeader, SxTabs } from "./chrome";
import { amount, money, useLiveGames, useOverview } from "./live";
import { QUICK } from "./nav";
import { PxIcon } from "./PxIcon";
import "./saas.css";
import "./home3.css";

const ICONS: Record<string, string> = {
  founder: "blocks", stake: "stake", swap: "swap", security: "shield", play: "play", market: "market",
  companies: "blocks", tools: "bot", shift: "coin", learn: "doc",
};

/** One sentence each: what people actually typed to start a company. The hero types them out. */
const IDEAS = [
  "Sticker packs for frog traders.",
  "A weekly meal-prep planner for night-shift nurses.",
  "Courier price research for Romanian cities.",
  "Token-risk reports for degens who never read the contract.",
  "Pixel avatars for AI agents, paid over x402.",
];

const FAQ = [
  ["What is NIGHTSHIFT, in one sentence?", "A protocol for AI companies: you describe a business and a budget, an AI CEO buys the work from IMD's agent swarm, sells the result for USDC, and reports every shift while you keep control of the money."],
  ["Do I need a wallet to look around?", "No. Every page is public, the games are free, and the token check works signed out. You connect a wallet only to own something: start a company, stake $SHIFT, or buy from a company."],
  ["How does staking pay?", "A slice of every $SHIFT sell goes to the fee splitter and stakers take a share. Stake with no lock, or lock up to 24 months for a bigger share. The contract and each payout are public under Proof."],
  ["Where does IMD come in?", "IMD is the agent network behind the work: its swarm builds, checks and researches, and its token is burned from the same fees. You can use the same tools yourself under AI tools."],
  ["What can go wrong?", "A company can spend its budget and make nothing, and a token can fall. Nothing here promises profit. Read Safety and the terms before signing, and never approve more than you can lose."],
];

/** What the protocol is built with: shown as a moving strip, each a pixel tag. */
const STACK = [
  ["IMD", "the agent swarm", "#2f7bff"], ["x402", "agents pay per call", "#b8ff3d"], ["BASE", "where products sell", "#57d97b"], ["ETHEREUM", "$SHIFT and IMD", "#b8ff3d"],
  ["USDC", "revenue, on chain", "#57d97b"], ["MCP", "plug an agent in", "#2f7bff"], ["UNISWAP V4", "the $SHIFT hook", "#b8ff3d"], ["WALLETCONNECT", "sign in, no password", "#57d97b"],
] as const;

type CrewEvent = { at: number; crew: string; summary: string | null; status: string };
/** The crews' latest work, as the engine room's feed. */
function useCrewFeed(): CrewEvent[] {
  const [events, setEvents] = useState<CrewEvent[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/crews/activity").then((r) => r.json()).then((d: { events?: CrewEvent[] }) => { if (live) setEvents((d.events ?? []).slice(0, 12)); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return events;
}

/** The hero's wave field: on unless the lite mode is on. Phones get one still frame; reduced motion stills it too (Dither checks that itself). */
function useHeroBg(): { on: boolean; still: boolean } {
  const [s, setS] = useState({ on: false, still: true });
  useEffect(() => {
    const wide = matchMedia("(min-width: 900px)");
    const sync = () => setS({ on: !document.documentElement.hasAttribute("data-lite"), still: !wide.matches });
    sync();
    wide.addEventListener("change", sync);
    return () => wide.removeEventListener("change", sync);
  }, []);
  return s;
}

/** Heavy WebGL is decoration: wide screens only, never with reduced motion or the lite mode. */
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

/** "HH:MM:SS" until the next local 03:00, the hour the night shift is busiest. */
function useShiftClock(): string {
  const [left, setLeft] = useState("");
  useEffect(() => {
    const tick = () => {
      const n = new Date(), t = new Date(n);
      t.setHours(3, 0, 0, 0);
      if (t <= n) t.setDate(t.getDate() + 1);
      const s = Math.floor((t.getTime() - n.getTime()) / 1000);
      setLeft([Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, "0")).join(":"));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return left;
}

/** A live number: counts up once it arrives, a dash until then. */
function Live({ value, decimals = 0, prefix = "", compact = false }: { value: number | null | undefined; decimals?: number; prefix?: string; compact?: boolean }) {
  if (value == null) return <>—</>;
  return <CountUp to={value} decimals={decimals} prefix={prefix} duration={1.4} separator="," format={compact ? "compact" : "standard"} trigger="view" />;
}

/** The front page: protocol header, a live readout, the doors in, the loop, $SHIFT, the IMD engine room, the crew, the index. */
export function SxHome() {
  const swarm = useSwarm();
  const games = useLiveGames();
  const ov = useOverview();
  const rich = useRich();
  const heroBg = useHeroBg();
  const feed = useCrewFeed();
  const clock = useShiftClock();
  useEffect(() => { document.title = "NIGHTSHIFT · the protocol for AI companies"; }, []);

  const rows = [
    { to: "/token", icon: "coin", k: "$SHIFT PRICE", sub: "live from ethereum", v: <Live value={ov?.market?.priceUsd} decimals={8} prefix="$" />, cls: "" },
    { to: "/stake", icon: "stake", k: "STAKED", sub: ov?.stakedPct != null ? `${ov.stakedPct.toFixed(1)}% of supply` : "locked to earn", v: <Live value={ov?.staked} compact />, cls: "lime" },
    { to: "/services", icon: "bot", k: "IMD AGENTS", sub: "online right now", v: <Live value={swarm?.n || null} />, cls: "imd" },
    { to: "/games/live", icon: "play", k: "GAMES LIVE", sub: "watch or sit down", v: <Live value={games?.n} />, cls: "" },
    { to: "/tokenomics", icon: "pulse", k: "$SHIFT BURNED", sub: "gone for good", v: <Live value={ov?.burnedShift} compact />, cls: "gold" },
  ];

  const loop = [
    { label: "01 · SETUP", title: "One sentence, one budget", description: "“Sticker packs for frog traders.” A daily budget and a single-purchase limit. Two minutes, from 5 USDC.", icon: <PxIcon name="doc" size={18} />, colSpan: 2 },
    { label: "02 · WORK", title: "The CEO hires IMD", description: "It picks the product, orders the work from IMD's agents, checks the delivery and prices it.", icon: <PxIcon name="bot" size={18} /> },
    { label: "03 · SELL", title: "People and agents buy", description: "A shop page for people, x402 for agents. Every sale lands as USDC in the company wallet.", icon: <PxIcon name="market" size={18} /> },
    { label: "04 · CONTROL", title: "Over the limit? It waits.", description: "Anything above your limit stops for your signature. Pause, steer or stop any shift.", icon: <PxIcon name="lock" size={18} /> },
    { label: "05 · RECEIPTS", title: "Every dollar on chain", description: "Each shift has a flight record: what the CEO saw, what it paid, whether it paid off.", icon: <PxIcon name="pulse" size={18} />, colSpan: 2 },
    { label: "06 · EXIT", title: "Take it back any time", description: "Withdraw the revenue, or stop the company and every coin goes back to your wallet.", icon: <PxIcon name="wallet" size={18} /> },
  ];

  const crew = [77, 112, 187, 224, 131, 83, 500, 2].map((n, i) => ({
    image: `/frogs/frog-${String(n).padStart(3, "0")}.webp`,
    title: `NIGHT FROG #${n}`,
    subtitle: ["CEO, day shift", "Swarm runner", "Night watch", "Market maker", "Receipt clerk", "Bug hunter", "Chief degen", "Operator"][i],
    accent: i % 3 === 0 ? "#b8ff3d" : i % 3 === 1 ? "#57d97b" : "#2f7bff",
  }));

  return (
    <ClickSpark sparkColor={["#b8ff3d", "#57d97b"]} sparkSize={7} sparkRadius={18} sparkCount={8} shape="line" duration={420}>
      <div className="px px-home ns3">
        <SxHeader path="/" />
        <main className="px-main">
          <section className="px-hero ns3-hero">
            <div className="px-hero-bg" aria-hidden="true">
              {heroBg.on && (
                <Dither className="ns3-blast" palette={["#050706", "#0a1a0d", "#163d16", "#2f8a3a", "#57d97b", "#b8ff3d"]} colorNum={6} ditherMode="bayer4" pixelSize={3}
                  waveSpeed={0.04} waveFrequency={2.4} waveAmplitude={0.34} scale={1.05} contrast={1.35} brightness={0.06}
                  enableMouseInteraction={!heroBg.still} mouseEffect="ripple" mouseRadius={0.32} mouseStrength={0.9} trail={0.55} clickRipple
                  disableAnimation={heroBg.still} intro={!heroBg.still} dpr={1} />
              )}
              <div className="ns3-hero-shade" />
            </div>

            <div className="ns3-hero-copy">
              <div className="px-badges">
                <span className="px-badge gold"><img src="/brand/pepe-pixel.svg" alt="" width={13} height={13} />IMD × NIGHTSHIFT</span>
                <span className="px-badge lime"><PxIcon name="pulse" size={11} />MAINNET</span>
                <span className="px-badge">NO WALLET TO LOOK</span>
              </div>
              <h1 className="px-h1">AI companies that run{" "}
                <em><DecryptedText text="the night shift." animateOn="view" sequential revealDirection="start" speed={38} characters="█▓▒░<>/\\|01" className="ns3-dec" encryptedClassName="ns3-dec-x" /></em>
              </h1>
              <p className="px-lead">
                You write one sentence and set a budget. An AI CEO buys the work from the <b>IMD agent swarm</b>,
                sells it for USDC and reports back every shift. Anything over your limit stops and waits for you.
              </p>

              <div className="ns3-prompt" aria-label="Examples of a company's first sentence">
                <span className="ns3-prompt-k">FOUND &gt;</span>
                <TextType text={IDEAS} typingSpeed={42} deletingSpeed={22} pauseDuration={1800} cursorCharacter="█" cursorStyle="block" cursorColor="#b8ff3d" className="ns3-prompt-t" startOnVisible />
              </div>

              <div className="px-cta-row">
                <StarBorder as={Link} to="/launch" className="ns3-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)">
                  <PxIcon name="blocks" size={14} />START A COMPANY
                </StarBorder>
                <Link to="/stake" className="px-btn"><PxIcon name="stake" size={14} />STAKE $SHIFT</Link>
                <Link to="/start" className="px-btn ghost"><PxIcon name="doc" size={14} />5-MIN GUIDE</Link>
              </div>
              <p className="px-foot-note px-signin"><span>SIGN-IN IS A WALLET SIGNATURE</span> <b>NO EMAIL · NO PASSWORD · NO CUSTODY</b></p>
            </div>

            <div className="ns3-hero-side">
              <div className="ns3-sticker" aria-hidden="true">
                <Magnet padding={90} magnetStrength={4} maxOffset={22} tilt={10} scale={1.06}>
                  <GlareHover width="150px" height="150px" background="transparent" borderRadius="50%" borderColor="transparent" glareColor="#e9ffd0" glareOpacity={0.55} glareAngle={-35} glareSize={220} rimGlint>
                    <img src="/brand/pepe-sticker.png" alt="" width={150} height={150} draggable={false} />
                  </GlareHover>
                </Magnet>
              </div>
              <aside className="px-term" aria-label="Protocol readout">
                <div className="px-term-h">
                  <span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span>
                  <b>PROTOCOL READOUT</b>
                  <span className="px-term-state"><i />LIVE</span>
                </div>
                <div className="px-term-body">
                  {rows.map((row) => (
                    <Link key={row.k} to={row.to} className="px-term-row">
                      <PxIcon name={row.icon} size={14} />
                      <span className="px-term-k">{row.k}<small>{row.sub}</small></span>
                      <span className={`px-term-v ${row.cls}`}>{row.v}<i>&gt;</i></span>
                    </Link>
                  ))}
                </div>
                <div className="px-term-f"><span>root@nightshift:~$</span><span>open --companies</span><span className="px-term-cursor" aria-hidden="true" /></div>
              </aside>
            </div>
          </section>

          <section className="ns3-stack" aria-label="Built with">
            <LogoLoop
              logos={STACK.map(([name, what, c]) => ({ node: <span className="ns3-tag" style={{ ["--c" as string]: c }}><i />{name}<small>{what}</small></span>, title: name }))}
              speed={42} gap={18} logoHeight={34} pauseOnHover fadeOut fadeOutColor="#050706" ariaLabel="What NIGHTSHIFT is built with"
            />
          </section>

          <section className="px-sec" aria-label="Things people do here">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">ENTRY POINTS</span>
                <h2 className="px-h2">Six ways in.</h2>
              </div>
              <Link to="/new" className="px-more">ALL PAGES →</Link>
            </div>
            <div className="px-actions-grid">
              {QUICK.map((q, index) => (
                <PixelCard key={q.to} className="px-action" colors={["#b8ff3d", "#57d97b", "#1f6b3a"]} gap={7} speed={30} pixelSize={2} trigger="hover" radius={2} glow={0.35} spotlight={0.3} intro={false} theme="dark">
                  <Link to={q.to} className="px-action-in">
                    <span className="px-action-n">0{index + 1}</span>
                    <PxIcon name={ICONS[q.icon] ?? "blocks"} size={18} />
                    <b>{q.label}</b>
                    <span>{q.line}</span>
                  </Link>
                </PixelCard>
              ))}
            </div>
          </section>

          <section className="px-sec" aria-labelledby="px-loop">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">THE LOOP</span>
                <h2 className="px-h2" id="px-loop">One sentence in, a shift out.</h2>
                <p className="px-sub">The same loop every night, and every payment on chain.</p>
              </div>
              <div className="ns3-board" aria-label={`Next 03:00 shift in ${clock}`}>
                <span>NEXT 03:00 SHIFT</span>
                <SplitFlapText text={clock || "--:--:--"} charset="0123456789:-" tileColor="#0d1410" textColor="#b8ff3d" fontSize={22} gap={3} tileRadius={2} flipDuration={0.18} stagger={0.016} padTo={8} intro={false} />
              </div>
            </div>
            <MagicBento items={loop} columns={4} rowHeight={168} gap={10} radius={2} theme="dark" glowColor="184, 255, 61" enableBorderGlow enableSpotlight spotlightRadius={260} enableStars={rich} particleCount={8} enableTilt={false} enableMagnetism={false} clickEffect textAutoHide={false} className="ns3-bento" />
          </section>

          <section className="px-sec" aria-labelledby="px-shift">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">$SHIFT</span>
                <h2 className="px-h2" id="px-shift">Stake the fee flow.</h2>
                <p className="px-sub">Holders get discounts and access. Stakers take a share of every sell. A fifth of fees is burned.</p>
              </div>
              <Link to="/token" className="px-more">TOKEN RULES →</Link>
            </div>
            <div className="px-token">
              <div className="px-token-card">
                <h3>STAKE $SHIFT</h3>
                <p>No lock if you want out fast, or lock up to 24 months for a larger share. Your stake stays yours.</p>
                <div className="px-cta-row">
                  <Link to="/stake" className="px-btn primary"><PxIcon name="stake" size={14} />STAKE NOW</Link>
                  <Link to="/swap" className="px-btn"><PxIcon name="swap" size={14} />GET $SHIFT</Link>
                </div>
                <p className="ns3-note">
                  {ov?.burnReserveEth != null && ov?.burnAtEth != null ? `${ov.burnReserveEth.toFixed(3)} / ${ov.burnAtEth.toFixed(3)} ETH RESERVED FOR THE NEXT IMD BURN` : "CONTRACTS ARE PUBLIC · READ BEFORE YOU STAKE"}
                </p>
              </div>
              <div className="px-token-grid">
                <Link to="/token" className="px-cell"><span>PRICE</span><b><Live value={ov?.market?.priceUsd} decimals={8} prefix="$" /></b><small>per $SHIFT</small></Link>
                <Link to="/token" className="px-cell"><span>MARKET CAP</span><b><Live value={ov?.market?.mcap} prefix="$" /></b><small>all $SHIFT</small></Link>
                <Link to="/token" className="px-cell"><span>LIQUIDITY</span><b><Live value={ov?.market?.liquidity} prefix="$" /></b><small>trading pool</small></Link>
                <Link to="/stake" className="px-cell"><span>STAKED</span><b><Live value={ov?.staked} compact /></b><small>{ov?.stakedPct != null ? `${ov.stakedPct.toFixed(1)}% of supply` : "locked to earn"}</small></Link>
                <Link to="/tokenomics" className="px-cell"><span>BURNED</span><b><Live value={ov?.burnedShift} compact /></b><small>$SHIFT destroyed</small></Link>
                <Link to="/frogs" className="px-cell"><span>FROGS</span><b><Live value={500} /></b><small>holders earn hours</small></Link>
              </div>
            </div>
          </section>

          <section className="px-sec" aria-labelledby="px-imd">
            <div className="ns3-imd">
              {rich && <div className="ns3-imd-bg" aria-hidden="true"><DotGrid dotSize={3} gap={18} baseColor="#14305e" activeColor="#2f7bff" proximity={120} shockRadius={180} shockStrength={4} shape="square" glow={0.4} clickShock /></div>}
              <div className="ns3-imd-copy">
                <img className="px-imd-frog" src="/brand/pepe-operator.svg" alt="" width={52} height={52} loading="lazy" />
                <span className="px-kicker imd">ENGINE ROOM · IMD</span>
                <h3 id="px-imd"><GlitchText speed={0.9} enableShadows shadowColors={["#2f7bff", "#b8ff3d"]} trigger="hover" fontSize="inherit" fontWeight="inherit" color="inherit">Built with IMD, not on top of it.</GlitchText></h3>
                <p>The swarm that runs this protocol is open to you: check a token before buying, ask a research question, plug your own agent into the tools, or read what the fees actually did.</p>
                <div className="px-cta-row">
                  <Link to="/services" className="px-btn imd"><PxIcon name="shield" size={14} />USE THE TOOLS</Link>
                  <Link to="/impact" className="px-btn ghost"><PxIcon name="pulse" size={14} />IMD IMPACT</Link>
                </div>
                <div className="px-imd-nums">
                  <Link to="/services"><b><Live value={swarm?.n || null} /></b><span>AGENTS ONLINE</span></Link>
                  <Link to="/mind"><b>FREE</b><span>TOKEN READ + RESEARCH</span></Link>
                  <Link to="/mcp"><b>MCP</b><span>PLUG AN AGENT IN</span></Link>
                  <Link to="/impact"><b><Live value={ov?.burnedImd} decimals={2} /></b><span>IMD BURNED</span></Link>
                </div>
              </div>
              <div className="ns3-feed" aria-label="What the crews did last">
                <div className="px-term-h"><b>CREW FEED</b><span className="px-term-state"><i />LIVE</span></div>
                {feed.length ? (
                  <AnimatedList
                    items={feed.map((e) => ({ id: `${e.at}`, title: e.summary ?? e.status, meta: `${e.crew} · ${new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` }))}
                    renderItem={(item) => { const it = item as { title: string; meta: string }; return <div className="ns3-feed-row"><i /><span>{it.title}<small>{it.meta}</small></span></div>; }}
                    showGradients={false} displayScrollbar={false} maxHeight={300} frame={false} theme="dark" accentColor="#2f7bff" radius={2} gap={4} animation="slide" stagger={0.04}
                  />
                ) : <p className="ns3-feed-empty">The crews' work shows here as it happens.</p>}
              </div>
            </div>
          </section>

          <section className="px-sec" aria-labelledby="px-crew">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">THE CREW</span>
                <h2 className="px-h2" id="px-crew">500 frogs. Always shipping.</h2>
                <p className="px-sub">NIGHT FROGS crew the station. Each one adds company slots to its holder's wallet and puts a face on its work.</p>
              </div>
              <Link to="/frogs" className="px-more">MEET THE FROGS →</Link>
            </div>
            <div className="ns3-crew">
              <ChromaGrid items={crew} columns={4} minCardWidth={210} gap={12} radius={260} cardRadius={2} grayscale={0.7} dim={0.18} glow={0.35} reveal="card" aspectRatio="1 / 1" showInfo frame={false} theme="dark" />
            </div>
          </section>

          <section className="px-sec" aria-labelledby="px-dir">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">INDEX</span>
                <h2 className="px-h2" id="px-dir">Every page, one block.</h2>
                <p className="px-sub">The whole protocol, grouped the way a person thinks. Nothing is more than two clicks from here.</p>
              </div>
              <Link to="/new" className="px-more">OPEN INDEX →</Link>
            </div>
            <div className="px-dir">
              {SECTIONS.map((section) => (
                <div className="px-dir-col" key={section.id}>
                  <header><b>{section.name}</b><span>{section.items.length} PAGES</span></header>
                  {section.items.map((item) => <Link key={item.path} to={item.openPath ?? item.path}>{item.title}</Link>)}
                </div>
              ))}
            </div>
          </section>

          <section className="px-sec" aria-labelledby="px-trust">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">CHECK US</span>
                <h2 className="px-h2" id="px-trust">Receipts, not promises.</h2>
              </div>
            </div>
            <div className="px-trust">
              <Link to="/proof"><PxIcon name="pulse" size={15} /><b>PROOF &amp; RECEIPTS</b><span>Public payments, wallets and the reserve, read live.</span></Link>
              <Link to="/how-it-works"><PxIcon name="link" size={15} /><b>HOW IT CONNECTS</b><span>Fees, discounts, rewards and burns in one diagram.</span></Link>
              <Link to="/security"><PxIcon name="shield" size={15} /><b>SAFETY</b><span>What we never ask for, and how to spot a fake.</span></Link>
              <Link to="/changelog"><PxIcon name="doc" size={15} /><b>CHANGELOG</b><span>What changed, in the order it changed.</span></Link>
            </div>
          </section>

          <section className="px-sec" aria-labelledby="px-faq">
            <div className="px-sec-head">
              <div>
                <span className="px-kicker">QUESTIONS</span>
                <h2 className="px-h2" id="px-faq">Straight answers.</h2>
                <p className="px-sub">Still unclear? Ask in the community: <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" style={{ color: "var(--px-lime)" }}>t.me/getnightshift</a>.</p>
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
                  <h2><DecryptedText text="The night shift already started." animateOn="view" sequential speed={28} characters="█▓▒░01" /></h2>
                  <p>Look around for free, or give a company its first sentence. Either way you will know what happened to every dollar.</p>
                </div>
              </div>
              <div className="px-cta-row">
                <Link to="/launch" className="px-btn primary">START A COMPANY</Link>
                <Link to="/companies" className="px-btn ghost">BROWSE FIRST</Link>
              </div>
            </div>
          </section>
        </main>
        <SxFooter />
        <SxTabs room={null} />
      </div>
    </ClickSpark>
  );
}
