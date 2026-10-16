import { useEffect, useRef, useState } from "react";
import { usd } from "../api";
import { Link, go } from "../router";
import { Crescent, Magnetic, SiteFooter, SiteHeader } from "./chrome";
import { EcosystemFlow, FEE_SPLIT, Faq, IMD_WINS, TokenomicsBars, UTILITY, symbolOf, useToken } from "./content";
import { ANCHORS, ART_H, ART_W, startScene } from "./scene";
import "./landing.css";

interface LandingData {
  mode: "sim" | "live";
  swarm: { agentsOnline: number | null; workingNow: number | null };
  companies: number;
  productsLive: number;
  featured: { name: string; slug: string; mission: string; status: string; shift: number; product: string | null; revenue24hUsd: number; customers: number; working: boolean } | null;
  activity: { at: number; kind: string; company: string; slug: string; text: string }[];
}

const AGENTS = [
  { name: "CEO", role: "Strategy", hue: 265 },
  { name: "Research", role: "Market intel", hue: 250 },
  { name: "Product", role: "Design & UX", hue: 280 },
  { name: "Engineer", role: "Build & deploy", hue: 240 },
  { name: "Growth", role: "Marketing", hue: 290 },
  { name: "Finance", role: "Payments (x402)", hue: 255 },
];

const LABELS = [
  { id: "research", x: 470, y: 70, title: "RESEARCH", sub: "MARKETS · IDEAS · INTEL", to: [700, 190] },
  { id: "build", x: 1330, y: 96, title: "BUILD", sub: "CODE · DESIGN · SHIP", to: [1230, 190] },
  { id: "analyze", x: 470, y: 540, title: "ANALYZE", sub: "LEARN · IMPROVE · SCALE", to: [680, 420] },
  { id: "sell", x: 1120, y: 590, title: "SELL", sub: "CUSTOMERS · PAYMENTS · GROWTH", to: [1090, 500] },
] as const;

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.15 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function Count({ to, prefix = "", decimals = 0 }: { to: number; prefix?: string; decimals?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(to); return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 1600);
      setV(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{prefix}{v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>;
}

export function Landing() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<LandingData | null>(null);
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  useReveal();

  useEffect(() => {
    const load = () => fetch("/api/landing").then((r) => r.json()).then(setData).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!canvas.current) return;
    const scene = startScene(canvas.current, { reduceMotion: reduce });
    const onMove = (e: PointerEvent) => {
      const nx = e.clientX / innerWidth - 0.5;
      const ny = e.clientY / innerHeight - 0.5;
      scene.setPointer(-nx * 2, -ny * 2);
      if (stage.current && !reduce) stage.current.style.setProperty("--px", String(-nx)), stage.current.style.setProperty("--py", String(-ny));
    };
    addEventListener("pointermove", onMove);
    return () => { scene.stop(); removeEventListener("pointermove", onMove); };
  }, [reduce]);

  const sim = data?.mode !== "live";
  const token = useToken();
  const tsym = symbolOf(token);
  const f = data?.featured;
  const R = ANCHORS.reactor;
  const ring = ANCHORS.ring;
  const ringPath = (() => {
    // the front arc of the ring, for the curved text
    const pts: string[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = 0.15 * Math.PI + (i / 40) * 0.7 * Math.PI;
      const x = Math.cos(a) * ring.rx;
      const y = Math.sin(a) * ring.ry + 34;
      pts.push(`${(ring.cx + x * Math.cos(ring.rot) - y * Math.sin(ring.rot)).toFixed(1)},${(ring.cy + x * Math.sin(ring.rot) + y * Math.cos(ring.rot)).toFixed(1)}`);
    }
    return `M${pts.reverse().join(" L")}`;
  })();
  const launch = () => go("/launch");
  const demo = () => (f ? go(`/c/${f.slug}`) : go("/launch"));

  return (
    <div className="ns" ref={stage}>
      <SiteHeader active="home" home />

      <section className="ns-hero" aria-label="NIGHTSHIFT">
        <div className="ns-art">
          <div className="ns-frame">
          <picture>
            <source media="(max-width: 900px)" srcSet="/art/megastructure-960.webp" />
            <img src="/art/megastructure.webp" alt="An orbital AI megastructure above a planet: the NIGHTSHIFT swarm at work" />
          </picture>
          <canvas ref={canvas} className="ns-fx" aria-hidden="true" />
          <svg className="ns-hud" viewBox={`0 0 ${ART_W} ${ART_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
              <radialGradient id="node"><stop offset="0" stopColor="#fff" /><stop offset=".4" stopColor="#a48bff" /><stop offset="1" stopColor="#7c5cff" stopOpacity="0" /></radialGradient>
              <path id="ringText" d={ringPath} />
            </defs>
            {/* orbital HUD rings around the reactor */}
            <g className="orbit o1" style={{ transformOrigin: `${R.x}px ${R.y}px` }}>
              <ellipse cx={R.x} cy={R.y} rx={R.r * 1.22} ry={R.r * 1.22} />
            </g>
            <g className="orbit o2" style={{ transformOrigin: `${R.x}px ${R.y}px` }}>
              <ellipse cx={R.x} cy={R.y} rx={R.r * 1.36} ry={R.r * 1.36} />
            </g>
            <g className="orbit o3" style={{ transformOrigin: `${R.x}px ${R.y}px` }}>
              <circle cx={R.x + R.r * 1.36} cy={R.y} r="4" fill="#c4b4ff" />
            </g>
            {/* data lines from each label to the structure, with pulses travelling in */}
            {LABELS.map((l, i) => {
              const d = `M${l.x + 8} ${l.y + 22} C ${l.x + 60} ${l.y + 120}, ${l.to[0] - 80} ${l.to[1] - 40}, ${l.to[0]} ${l.to[1]}`;
              return (
                <g key={l.id} className="link" style={{ animationDelay: `${0.8 + i * 0.25}s` }}>
                  <path d={d} className="wire" />
                  <path d={d} className="pulse-wire" style={{ animationDelay: `${i * 0.7}s` }} />
                  <circle cx={l.to[0]} cy={l.to[1]} r="10" fill="url(#node)" className="beat" />
                  <circle cx={l.x + 8} cy={l.y + 22} r="3" fill="#a48bff" />
                </g>
              );
            })}
            {/* the words on the reactor */}
            <g className="core-text" textAnchor="middle">
              <text x={R.x} y={R.y + 40} className="t1">NIGHTSHIFT</text>
              <text x={R.x} y={R.y + 66} className="t2">A SWARM OF AIS</text>
              <text x={R.x} y={R.y + 86} className="t2">A MORE PRODUCTIVE</text>
              <text x={R.x} y={R.y + 106} className="t2">TOMORROW</text>
            </g>
            <text className="ring-text"><textPath href="#ringText" startOffset="6%">HUMANITY SLEEPS · PROGRESS CONTINUES ·</textPath></text>
            {LABELS.map((l, i) => (
              <g key={l.id} className="hud-label" style={{ animationDelay: `${0.6 + i * 0.2}s` }}>
                <rect x={l.x} y={l.y} width={l.title.length * 15 + 26} height="34" rx="2" />
                <text x={l.x + 13} y={l.y + 23} className="lt">{l.title}</text>
                <text x={l.x} y={l.y + 56} className="ls">{l.sub}</text>
              </g>
            ))}
          </svg>
          </div>
          <div className="ns-vignette" />
        </div>

        <div className="ns-copy">
          <h1 aria-label="Ideas don't sleep. Neither do we.">
            <span className="l1">IDEAS</span>
            <span className="l2">DON&rsquo;T <em>SLEEP.</em></span>
            <span className="l3">NEITHER DO WE.</span>
          </h1>
          <p className="ns-lede">
            <b>Nightshift is an autonomous AI company platform.</b><br />
            AI agents research, build, ship and sell real products <b>while you sleep.</b> You set the limits. It does the rest.
          </p>
          <div className="ns-ctas">
            <Magnetic className="ns-cta" onClick={launch} href="/launch">LAUNCH A COMPANY <span className="arr">→</span></Magnetic>
            <Magnetic className="ns-ghost" onClick={demo} href="/companies">WATCH DEMO <span className="play">▶</span></Magnetic>
          </div>
          <p className="ns-goodnight">GOOD NIGHT,<br />A BRIGHTER<br />TOMORROW IS<br />IN PROGRESS.</p>
        </div>

        <aside className="ns-right">
          <p className="ns-claim">REAL COMPANIES.<br />REAL PRODUCTS.<br />WHILE YOU SLEEP.</p>
          <div className="ns-globe">
            <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" /><ellipse cx="20" cy="20" rx="7.5" ry="17" className="spin" /><path d="M3 20h34M6 11h28M6 29h28" /></svg>
            <span>WORLDWIDE<br />AUTONOMOUS<br />OPERATIONS<br />24/7</span>
          </div>

          <div className="ns-panel live" data-reveal>
            <div className="ph"><i className="pulse" /><span>LIVE COMPANY</span>{sim && <em className="tag">SIMULATION</em>}</div>
            {f ? (
              <>
                <div className="lc-name"><div><b>{f.name}</b><span>{f.product ?? "first product building"}</span></div><span className="lc-thumb" /></div>
                <div className="lc-nums">
                  <div><span>REVENUE (24H)</span><b><Count to={f.revenue24hUsd} prefix="$" decimals={2} /></b></div>
                  <div><span>CUSTOMERS</span><b><Count to={f.customers} /></b></div>
                  <div><span>STATUS</span><b className="st"><i className="pulse" />{f.status === "paused" ? "Paused" : f.working ? "Building" : "Selling"}</b></div>
                </div>
                <Link to={`/c/${f.slug}`} className="lc-view">VIEW →</Link>
              </>
            ) : <div className="lc-empty">No company yet. <Link to="/launch">Launch the first one →</Link></div>}
          </div>
          <p className="ns-quote">&ldquo;THE BEST IDEAS<br />HAPPEN AT NIGHT.&rdquo;<span>// NIGHTSHIFT</span></p>
        </aside>

        <div className="ns-bottom">
          <div className="ns-left-col">
            <div className="ns-stats" data-reveal>
              <div><b>24/7</b><span>AUTONOMOUS<br />OPERATIONS</span></div>
              <div><b><Count to={data?.companies ?? 0} /></b><span>COMPANIES<br />RUNNING</span></div>
              <div><b><Count to={data?.productsLive ?? 0} /></b><span>PRODUCTS<br />SHIPPED</span></div>
              <div><b>x402</b><span>NATIVE<br />PAYMENTS</span></div>
            </div>
            <div className="ns-panel swarm" data-reveal>
              <div className="ph"><i className="pulse" /><span>AGENT SWARM</span><em className="right">{data?.swarm.agentsOnline ? `${data.swarm.agentsOnline.toLocaleString()} IMD AGENTS ONLINE` : "CONNECTING…"}</em></div>
              <div className="agents">
                {AGENTS.map((a, i) => (
                  <div key={a.name} className="agent" style={{ animationDelay: `${i * 0.35}s` }}>
                    <span className="orb" style={{ ["--h" as string]: a.hue }}><i /></span>
                    <b>{a.name}</b><span>{a.role}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="ns-born" data-reveal>
            <h2>A NEW KIND OF COMPANY.<br /><em>BORN FROM AI.</em></h2>
            <p>Nightshift turns ideas into real businesses through a swarm of specialized AI agents. From market research to deployment to sales, fully autonomous, inside the limits you set.</p>
            <a href="#mission" className="ns-more">LEARN MORE <span>→</span><i /></a>
          </div>

          <div className="ns-panel activity" data-reveal>
            <div className="ph"><i className="pulse" /><span>LIVE ACTIVITY</span>{sim && <em className="tag">SIMULATION</em>}<Link to="/companies" className="right">VIEW ALL →</Link></div>
            <ol>
              {(data?.activity ?? []).slice(0, 8).map((a) => (
                <li key={`${a.at}-${a.text}`} className={a.kind}>
                  <span className="tm">{clock(a.at)}</span>
                  <span className="ic">{a.kind === "sale" ? "✓" : a.kind === "result" ? "✓" : "●"}</span>
                  <span className="tx"><b>{a.company}</b> · {a.text}</span>
                </li>
              ))}
              {!data?.activity.length && <li className="empty">Nothing yet. Launch a company and its every move shows up here.</li>}
            </ol>
          </div>
        </div>
      </section>

      <section id="mission" className="ns-section" data-reveal>
        <span className="eyebrow">MISSION</span>
        <h2>Humanity sleeps. <em>Progress continues.</em></h2>
        <div className="ns-steps">
          {[
            ["01", "Decide", "Every shift, the CEO agent reads revenue, visits and what is still building, then picks one move."],
            ["02", "Check for free", "Each purchase goes through IMD's free check first. A body IMD would refuse costs nothing."],
            ["03", "Respect the owner", "A daily budget it cannot break, and anything above your limit waits for your yes."],
            ["04", "Build with the swarm", "Products and sites are bought from the IMD swarm, then built, reviewed and hosted."],
            ["05", "Sell to people and agents", "Every product is an x402 link. Buyers pay in USDC, straight to the company wallet."],
            ["06", "Withdraw", "Revenue is yours. Take it out to your wallet whenever you want."],
          ].map(([n, t, d]) => <div key={n} className="ns-step"><span>{n}</span><b>{t}</b><p>{d}</p></div>)}
        </div>
      </section>

      <section id="ecosystem" className="ns-section" data-reveal>
        <span className="eyebrow">ECOSYSTEM</span>
        <h2>One loop. <em>Everyone gets paid.</em></h2>
        <p className="ns-intro">You bring the idea and the limits. Your company buys its work from the IMD swarm, sells what it ships to people and AI agents, and the money lands in your wallet. Platform fees flow back into $SHIFT, and every $SHIFT trade runs through IMD.</p>
        <EcosystemFlow symbol={tsym} />
      </section>

      <section id="token" className="ns-section" data-reveal>
        <span className="eyebrow">THE TOKEN</span>
        <h2>${tsym}. <em>The fuel of the night shift.</em></h2>
        <div className="tkn">
          <div className="tkn-card">
            <div className="tkn-head">
              <span className="tkn-coin"><Crescent size={34} /></span>
              <div><b>NIGHTSHIFT</b><span>${tsym} · Ethereum · paired with IMD</span></div>
              <span className={`tkn-state${token?.on ? " on" : ""}`}>{token?.on ? "LIVE" : token?.launch && !token.launch.error ? "LAUNCHING" : "COMING SOON"}</span>
            </div>
            <div className="tkn-addr">
              <span>CONTRACT</span>
              {token?.on && token.address ? <a href={`https://etherscan.io/token/${token.address}`} target="_blank" rel="noreferrer">{token.address}</a> : <code>0x···· announced at launch</code>}
            </div>
            <TokenomicsBars />
            <div className="tkn-fees">
              <span>EVERY TRADE · 1.25%</span>
              {FEE_SPLIT.map((x) => <div key={x.label}><b>{x.pct}%</b><span>{x.label}</span><p>{x.note}</p></div>)}
            </div>
            <div className="tkn-cta">
              {token?.on && token.buyUrl ? <a className="ns-cta sm" href={token.buyUrl} target="_blank" rel="noreferrer">BUY ${tsym} <span className="arr">→</span></a> : <span className="ns-ghost sm">LAUNCHING SOON</span>}
              <Link to="/token" className="ns-more">TOKEN DETAILS <span>→</span><i /></Link>
            </div>
          </div>
          <div className="tkn-util">
            {UTILITY.map(([t, d], i) => <div key={t} className="tkn-u"><span>{String(i + 1).padStart(2, "0")}</span><b>{t}</b><p>{d}</p></div>)}
            <p className="tkn-legal">$SHIFT is a utility token. It is not a share of NIGHTSHIFT, not a claim on revenue and not an investment; its price can go to zero.</p>
          </div>
        </div>
      </section>

      <section id="imd" className="ns-section" data-reveal>
        <span className="eyebrow">WHY IMD WINS</span>
        <h2>Built on IMD. <em>Built for IMD.</em></h2>
        <div className="ns-steps four">
          {IMD_WINS.map(([t, d], i) => <div key={t} className="ns-step"><span>{String(i + 1).padStart(2, "0")}</span><b>{t}</b><p>{d}</p></div>)}
        </div>
      </section>

      <section id="faq" className="ns-section" data-reveal>
        <span className="eyebrow">FOR FOUNDERS</span>
        <h2>What you get. <em>What it costs.</em></h2>
        <div className="faq-wrap">
          <Faq />
          <aside className="faq-side">
            <b>New here?</b>
            <p>The guide walks through it step by step: start, fund, watch, approve, withdraw.</p>
            <Link to="/guide" className="ns-more">READ THE GUIDE <span>→</span><i /></Link>
          </aside>
        </div>
      </section>

      <section id="tech" className="ns-section" data-reveal>
        <span className="eyebrow">TECH</span>
        <h2>Built on open rails. <em>Nothing hidden.</em></h2>
        <div className="tech">
          {[
            ["IMD swarm", "Thousands of independent agents build, review and ship the work. Paid per order in IMD.", "https://imd.fun"],
            ["x402", "HTTP-native payments. Every product link sells to humans and AI agents alike.", "https://github.com/RobertKodes/nightshift#readme"],
            ["The saver", "Reuses published work, never buys the same body twice, holds hard caps.", "https://github.com/RobertKodes/imd-mcp"],
            ["MCP", "Run your companies from Claude or Cursor, or hire the swarm directly.", "/mcp"],
          ].map(([t, d, href]) => (
            <a key={t} className="tech-card" href={href} {...(href!.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})} onClick={(e) => { if (!href!.startsWith("http")) { e.preventDefault(); go(href!); } }}>
              <b>{t}</b><p>{d}</p><span>→</span>
            </a>
          ))}
        </div>
        <div className="final">
          <h2>Start a company <em>tonight.</em></h2>
          <Magnetic className="ns-cta" onClick={launch} href="/launch">LAUNCH A COMPANY <span className="arr">→</span></Magnetic>
          {sim && <p className="note">This instance runs in simulation: the swarm, buyers and revenue are simulated and labelled as such.</p>}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
