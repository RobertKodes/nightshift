import { useEffect, useRef, useState } from "react";
import { Link, go } from "../router";
import { UtilityLinks } from "../HowThisConnects";
import { useSwarm } from "../landing/chrome";
import { ImdVisitor } from "../landing/visitor";
import { NxIcon } from "./icons";
import { ROOMS, ROOM_ORDER, type RoomId } from "./map";
import { Footer, NxTabs, StationBar, rememberRoom } from "./Shell";
import { StationMap, useDock } from "./StationMap";
import "./nx.css";
import "./gate.css";

type Overview = { market: { priceUsd: number; mcap: number; liquidity?: number } | null; staked: number | null; stakedPct: number | null; burnedShift: number; burnedImd: number | null;
  burnReserveEth?: number | null; burnAtEth?: number | null; lastBurn?: { at: number; tx: string; imd: number | null } | null };

/** The three doors in plain words: what you can do there, and whether it costs anything. */
const DOORS: Partial<Record<RoomId, { art: string; tag: string; line: string }>> = {
  geek: { art: "/art/v2/door-tools-768.webp", tag: "Free previews", line: "Paste any token and an AI checks it for warning signs before you buy. Research and paid work when you need more." },
  breakroom: { art: "/art/v2/door-play-768.webp", tag: "Free to play", line: "Pinball, chess, pool and poker against people or our frogs. Practice is free; no wallet needed." },
  info: { art: "/art/v2/door-shift-768.webp", tag: "Own a piece", line: "The station's token. Hold it for perks, stake it for a share of every sell, and watch the burns." },
};

/** What is new on the station right now: kept short, and taken down when it is no longer new. */
const NEW_NOW = [
  { to: "/deals", tag: "OPENING SOON", title: "Token Deals", line: "Holders sell tokens at a fixed price through an escrow contract, instead of dumping on the chart.", acc: "#c9c2ff" },
  { to: "/partners", tag: "OPEN TO PROJECTS", title: "Partner program", line: "Projects from any chain can apply for free and join the station's crew.", acc: "#4ad8ff" },
  { to: "/watch", tag: "WITH imdUSD", title: "The Night Watch", line: "Forge a Night Watcher and run a keeper seat that keeps imdUSD loans safe for a bonus.", acc: "#b8ff4a" },
];

/** The way back from the third step to the first, under the cards (in a 1000-wide box). */
const LOOP_BACK = "M840 0 V18 Q840 34 824 34 H176 Q160 34 160 18 V0";

/** A price below $0.001 with its zeros counted, the way DexScreener writes it: 0.0000644 is $0.0₄644. */
const tiny = (n: number) => {
  const zeros = -Math.floor(Math.log10(n)) - 1;
  const digits = Math.min(999, Math.round(n * 10 ** (zeros + 3)));
  return `$0.0${[...String(zeros)].map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("")}${digits}`;
};
const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : n > 0 && n < 1e-3 ? tiny(n) : `$${n.toPrecision(3)}`);
const amount = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n >= 100 ? n.toFixed(0) : n.toFixed(2));
const get = <T,>(u: string) => fetch(u).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);

/** A slow starfield with a little parallax, drawn once per frame; still when the visitor prefers less motion. */
function useStars(ref: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, px = 0, py = 0;
    const stars = Array.from({ length: 220 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() ** 2, t: Math.random() * 6.28 }));
    const size = () => { const d = Math.min(devicePixelRatio || 1, 2); w = c.clientWidth; h = c.clientHeight; c.width = w * d; c.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.x -= (0.00002 + s.z * 0.00009) * (still ? 0 : 1);
        if (s.x < 0) s.x += 1;
        const x = (s.x * w + px * s.z * 18 + w) % w, y = s.y * h + py * s.z * 12;
        const a = 0.25 + s.z * 0.75 * (0.7 + 0.3 * Math.sin(t / 900 + s.t));
        ctx.fillStyle = s.z > 0.82 ? `rgba(201,194,255,${a})` : `rgba(242,239,255,${a * 0.8})`;
        ctx.fillRect(x, y, 0.6 + s.z * 1.4, 0.6 + s.z * 1.4);
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    const move = (e: PointerEvent) => { px = e.clientX / innerWidth - 0.5; py = e.clientY / innerHeight - 0.5; };
    size(); draw(0);
    addEventListener("resize", size); addEventListener("pointermove", move);
    const vis = () => { cancelAnimationFrame(raf); if (!document.hidden && !still) raf = requestAnimationFrame(draw); };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", size); removeEventListener("pointermove", move); document.removeEventListener("visibilitychange", vis); };
  }, [ref]);
}

/** Text that decodes into place, letter by letter, once; plain text for anyone who prefers less motion. */
function Decode({ text, delay = 0 }: { text: string; delay?: number }) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const glyphs = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789<>/#";
    const start = performance.now() + delay, dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const done = Math.max(0, Math.min(1, (t - start) / dur));
      const fixed = Math.floor(done * text.length);
      setOut(text.split("").map((ch, i) => (ch === " " || i < fixed ? ch : glyphs[Math.floor(Math.random() * glyphs.length)]!)).join(""));
      if (done < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, delay]);
  return <span aria-hidden="true">{out}</span>;
}

/** The keeper runs at every odd UTC hour (its burn lands within about an hour of it). */
const nextRun = () => { const d = new Date(); d.setUTCMinutes(0, 0, 0); d.setUTCHours(d.getUTCHours() + (d.getUTCHours() % 2 === 1 ? 2 : 1)); return `${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`; };
const eth = (n: number) => n.toFixed(n < 0.01 ? 4 : 3);

/** The next IMD burn: the fee splitter's ETH reserve against what the keeper waits for, and the last burn. */
function BurnBar({ ov }: { ov: Overview | null }) {
  const r = ov?.burnReserveEth, at = ov?.burnAtEth, last = ov?.lastBurn;
  if (r == null && !last) return null;
  const ready = r != null && at != null && r >= at;
  const pct = r != null && at ? Math.min(100, (r / at) * 100) : 0;
  return (
    <div className="nx-burn" aria-label="Next IMD burn">
      <span className="nx-burn-k">Next IMD burn</span>
      {r != null && at != null && <>
        <span className="nx-burn-bar" role="progressbar" aria-label="Burn reserve" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><i style={{ width: `${pct}%` }} /></span>
        <span className="nx-burn-v">{ready ? <><b>{eth(r)} ETH</b> · burns at the next keeper run, about {nextRun()}</> : <><b>{eth(r)}</b> / {eth(at)} ETH saved up</>}</span>
      </>}
      {last && <a className="nx-burn-last" href={`https://etherscan.io/tx/${last.tx}`} target="_blank" rel="noreferrer">Last burn {new Date(last.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</a>}
    </div>
  );
}

/** The front door: what NIGHTSHIFT is, the three things to do here, and how the station pays its holders. */
export function Gate() {
  const sky = useRef<HTMLCanvasElement>(null);
  useStars(sky);
  const [focus, setFocus] = useState<RoomId | null>(null);
  const swarm = useSwarm();
  const [ov, setOv] = useState<Overview | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const dock = useDock();
  const enter = (id: RoomId) => { rememberRoom(id); dock.start(id, () => { go(ROOMS[id].nav[0]!.to); scrollTo(0, 0); }); };
  useEffect(() => { document.title = "NIGHTSHIFT · AI tools, games and $SHIFT"; }, []);
  useEffect(() => {
    // the numbers move: read again every minute while the page is open
    const read = () => {
      if (document.hidden) return;
      void get<Overview>("/api/token/overview").then((o) => { if (o) setOv(o); });
      void get<{ games?: unknown[] }>("/api/games/live").then((d) => { if (d && Array.isArray(d.games)) setLive(d.games.length); });
    };
    read();
    const t = setInterval(read, 60_000);
    return () => clearInterval(t);
  }, []);
  // 1, 2, 3 open the doors, in the order they are drawn
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      const id = ROOM_ORDER[Number(e.key) - 1];
      if (id) enter(id);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);
  const stat: Partial<Record<RoomId, string>> = {
    geek: swarm?.n ? `${swarm.n.toLocaleString("en-US")} AI agents online` : "",
    breakroom: live ? `${live} ${live === 1 ? "game" : "games"} on right now` : "",
    info: ov?.stakedPct ? `${ov.stakedPct.toFixed(1)}% of all $SHIFT is staked` : "",
  };
  const cells: { k: string; v: string | null; sub: string; acc: string; to: string }[] = [
    { k: "Price", v: ov?.market ? money(ov.market.priceUsd) : null, sub: "per $SHIFT", acc: "#ffc861", to: "/token" },
    { k: "Market cap", v: ov?.market ? money(ov.market.mcap) : null, sub: "all $SHIFT at today's price", acc: "#ff9f5a", to: "/token" },
    { k: "Staked", v: ov?.staked != null ? amount(ov.staked) : null, sub: ov?.stakedPct != null ? `${ov.stakedPct.toFixed(1)}% of supply, locked to earn` : "locked to earn", acc: "#b8ff4a", to: "/stake" },
    { k: "$SHIFT burned", v: ov ? amount(ov.burnedShift) : null, sub: "gone for good", acc: "#ff5ca8", to: "/tokenomics" },
    { k: "IMD burned", v: ov?.burnedImd != null ? amount(ov.burnedImd) : null, sub: "from the fee split", acc: "#4ad8ff", to: "/impact" },
    { k: "Liquidity", v: ov?.market?.liquidity != null ? money(ov.market.liquidity) : null, sub: "in the trading pool", acc: "#c9c2ff", to: "/token" },
  ];

  return <div className="ns nx-gate gx">
    <div className="gx-hero clarity-home">
      <StationMap focus={focus} />
      <canvas ref={sky} className="gx-stars" aria-hidden="true" />
      <div className="gx-sky" aria-hidden="true"><i className="gx-shuttle"><img src="/art/v2/shuttle-1024x512.webp" alt="" width={1024} height={512} onError={(e) => { e.currentTarget.parentElement!.hidden = true; }} /></i></div>
      {dock.overlay}
      {/* IMD's frog comes over from imd.fun through his portal, as on the story page */}
      <div className="nx-visit gx-visit"><ImdVisitor /></div>
      <header className="nx-head"><StationBar room={null} /><UtilityLinks /></header>
      <section className="nx-gate-in gx-in">
        <span className="nx-eyebrow"><i />NIGHTSHIFT · BUILT WITH IMD</span>
        <h1 className="nx-title" aria-label="What brings you to the night shift?"><Decode text="What brings you" /><br /><Decode text="to the night shift?" delay={260} /></h1>
        <p className="nx-gate-lead">NIGHTSHIFT is a space station run by AI agents and a crew of frogs. Play games, let an AI check a token for you, or own a piece of the station with $SHIFT. Looking around is free: no account, no wallet.</p>
        <div className="nx-ways gx-ways">{ROOM_ORDER.map((id, i) => {
          const r = ROOMS[id], d = DOORS[id]!;
          return <a key={id} href={r.nav[0]!.to} className="nx-way" style={{ "--acc": r.accent } as React.CSSProperties}
            onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); enter(id); }}
            onPointerEnter={() => setFocus(id)} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus(id)} onBlur={() => setFocus(null)}>
            <span className="nx-way-art"><img src={d.art} alt="" width={768} height={768} /></span>
            <span className="nx-way-tx">
              <span className="nx-way-who"><kbd>{i + 1}</kbd>{d.tag}</span>
              <b>{r.name}</b>
              <span className="nx-way-line">{d.line}</span>
              <span className="nx-way-stat" aria-live="polite">{stat[id] || " "}</span>
            </span>
            <NxIcon name="arrow" size={20} className="nx-way-go" />
          </a>;
        })}</div>
        <div className="gx-new">
          <Link to="/start" className="nx-btn nx-btn-acc"><NxIcon name="guide" size={18} />New to crypto? Start here</Link>
          <span>Five minutes, plain words, no wallet needed to read.</span>
        </div>
      </section>
    </div>

    <main className="gx-body">
      <section className="gx-sec" aria-labelledby="gx-try">
        <h2 id="gx-try">Try something in under a minute</h2>
        <div className="gx-try">
          <Link to="/games/pinball" style={{ "--acc": ROOMS.breakroom.accent } as React.CSSProperties}><NxIcon name="pinball" size={26} /><b>Play Space Pinball</b><span>Opens right in your browser. No sign-up, no wallet.</span></Link>
          <Link to="/services/verdict" style={{ "--acc": ROOMS.geek.accent } as React.CSSProperties}><NxIcon name="security" size={26} /><b>Check a token for free</b><span>Paste a token address and see what looks risky before you buy.</span></Link>
          <Link to="/games/live" style={{ "--acc": ROOMS.info.accent } as React.CSSProperties}><NxIcon name="live" size={26} /><b>Watch a game live</b><span>{live ? `${live} ${live === 1 ? "table is" : "tables are"} playing right now.` : "See the frogs and players at the tables."}</span></Link>
        </div>
      </section>

      <section className="gx-sec" aria-labelledby="gx-news">
        <h2 id="gx-news">New on the station</h2>
        <div className="nx-new">{NEW_NOW.map((n) => (
          <Link key={n.to} to={n.to} className="nx-new-card" style={{ "--acc": n.acc } as React.CSSProperties}>
            <span className="nx-new-tag">{n.tag}</span>
            <b>{n.title}</b>
            <span className="nx-new-line">{n.line}</span>
            <span className="nx-new-go" aria-hidden="true"><NxIcon name="arrow" size={18} /></span>
          </Link>
        ))}</div>
      </section>

      <section className="gx-sec" aria-labelledby="gx-how">
        <h2 id="gx-how">How the station works</h2>
        <p className="gx-sub">One loop keeps the lights on. Every step is on Ethereum, where anyone can check it.</p>
        <ol className="gx-loop">
          <li style={{ "--acc": ROOMS.geek.accent } as React.CSSProperties}><NxIcon name="agent" size={24} /><b>AI agents do the work</b><span>IMD's network of AI agents builds, checks and runs the station's tools.</span><em>{swarm?.n ? `${swarm.n.toLocaleString("en-US")} online now` : "Online around the clock"}</em></li>
          <li style={{ "--acc": ROOMS.breakroom.accent } as React.CSSProperties}><NxIcon name="play" size={24} /><b>People and agents use it</b><span>Games, AI checks and research. Some of it is free; paid work is priced up front.</span><em>{live ? `${live} games live` : "Open to everyone"}</em></li>
          <li style={{ "--acc": ROOMS.info.accent } as React.CSSProperties}><NxIcon name="stake" size={24} /><b>Value comes back</b><span>Fees from $SHIFT sells and staked games go to stakers and frog holders, and a fifth is burned for good.</span><em>{ov ? `${amount(ov.burnedShift)} $SHIFT burned so far` : "Burned for good"}</em></li>
        </ol>
        <svg className="gx-flow" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true"><path d={LOOP_BACK} /><path className="gx-flow-run" d={LOOP_BACK} /></svg>
      </section>

      <section className="gx-sec" aria-labelledby="gx-shift">
        <h2 id="gx-shift">$SHIFT at a glance</h2>
        <p className="gx-sub">Read live from Ethereum. Swap in one tap, or stake to earn a share of every sell.</p>
        <div className="nx-deck">
          <div className="nx-deck-go">
            <Link to="/swap" className="nx-deck-btn swap"><NxIcon name="swap" size={20} /><span><b>Swap $SHIFT</b><small>ETH to $SHIFT and back</small></span></Link>
            <Link to="/stake" className="nx-deck-btn stake"><NxIcon name="stake" size={20} /><span><b>Stake $SHIFT</b><small>No lock, or lock up to 24 months</small></span></Link>
          </div>
          <dl className="nx-deck-stats">{cells.map((c) => (
            <Link key={c.k} to={c.to} className="nx-deck-cell" style={{ "--acc": c.acc } as React.CSSProperties}>
              <dt>{c.k}</dt><dd>{c.v ?? "…"}</dd><span>{c.sub}</span>
            </Link>
          ))}</dl>
          <BurnBar ov={ov} />
        </div>
      </section>

      <section className="gx-sec gx-guide" aria-labelledby="gx-guide">
        <img src="/art/v2/guide-frog-1024.webp" alt="" width={1024} height={1024} loading="lazy" onError={(e) => { e.currentTarget.hidden = true; }} />
        <div>
          <h2 id="gx-guide">Never used crypto? That's fine.</h2>
          <p>The guide explains wallets, tokens and staking in plain words, then walks you through getting $SHIFT one step at a time, with the safety rules that matter.</p>
          <div className="gx-guide-cta"><Link to="/start" className="nx-btn nx-btn-acc"><NxIcon name="guide" size={18} />Read the guide</Link><Link to="/how-it-works" className="nx-btn">How it all connects</Link></div>
        </div>
      </section>
    </main>
    <Footer room={null} /><NxTabs room={null} />
  </div>;
}
