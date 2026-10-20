import { useEffect, useRef, useState } from "react";
import { BLUESKY_URL, Crescent, TELEGRAM_URL, X_URL, useSwarm } from "../landing/chrome";
import { Link, go } from "../router";
import { NxIcon } from "./icons";
import { ROOMS, WAYS, type Way } from "./map";
import { NxTabs, lastRoom, rememberRoom } from "./Shell";
import "./nx.css";

type Station = { breakroom: { agentsInArena: number; liveGames: number }; geek: { leagueAgents: number; tradableTokens: number | null }; command: { missions: number }; leader: { name: string; returnPct: number } | null };
type Overview = { market: { priceUsd: number; mcap: number } | null; stakedPct: number | null; frogs: { minted: number; max: number } | null };

/** A slow starfield with a little parallax, drawn once per frame; still when the visitor prefers less motion. */
function useStars(ref: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, px = 0, py = 0;
    const stars = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() ** 2, t: Math.random() * 6.28 }));
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

const get = <T,>(u: string) => fetch(u).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);
const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toPrecision(3)}`);

/** CHOOSE YOUR WAY: the station's front door. Seven ways in, each to the part of the station made for you. */
export function Gate() {
  const sky = useRef<HTMLCanvasElement>(null);
  useStars(sky);
  const swarm = useSwarm();
  const [st, setSt] = useState<Station | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [back, setBack] = useState<ReturnType<typeof lastRoom>>(null);
  useEffect(() => { setBack(lastRoom()); void get<Station>("/api/station").then(setSt); void get<Overview>("/api/token/overview").then(setOv); }, []);
  document.title = "NIGHTSHIFT · Choose your way";

  const enter = (w: Way) => { if (w.room) rememberRoom(w.room); go(w.to); scrollTo(0, 0); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      const w = WAYS.find((x) => x.key === e.key);
      if (w) enter(w);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);

  const stat = (w: Way): string | null => {
    switch (w.key) {
      case "1": return st ? `${st.breakroom.liveGames} live now · ${st.breakroom.agentsInArena} agents in the arena` : null;
      case "2": return st?.leader ? `League leader ${st.leader.name} ${st.leader.returnPct >= 0 ? "+" : ""}${st.leader.returnPct}%` : st ? `${st.geek.tradableTokens ?? "…"} IMD tokens tradable` : null;
      case "3": return ov?.market ? `$SHIFT ${money(ov.market.priceUsd)} · mcap ${money(ov.market.mcap)}` : null;
      case "4": return swarm?.n ? `${swarm.n.toLocaleString("en-US")} IMD agents online` : null;
      case "5": return st ? `${st.command.missions} missions this week` : null;
      case "6": return "Built by the IMD swarm, sells over x402";
      case "7": return "Keyless MCP at /mcp/public";
      default: return null;
    }
  };

  return (
    <div className="ns nx-gate">
      <canvas ref={sky} className="nx-sky" aria-hidden="true" />
      <picture className="nx-gate-art" aria-hidden="true">
        <source media="(max-width: 820px)" srcSet="/art/station/gate-station-mobile-1080x1920.webp" />
        <img src="/art/station/gate-station-2400x1350.webp" alt="" />
      </picture>
      <header className="nx-gate-top">
        <Link to="/" className="nx-mark"><Crescent size={24} /><span>NIGHTSHIFT</span></Link>
        <span className="nx-pulse"><i />{swarm?.n ? swarm.n.toLocaleString("en-US") : "…"}<small>IMD AGENTS ONLINE</small></span>
        <nav>
          <Link to="/story">The story</Link>
          <a href={X_URL} target="_blank" rel="noreferrer" aria-label="X">X</a>
          <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" aria-label="Telegram">TG</a>
        </nav>
      </header>

      <section className="nx-gate-in">
        <span className="nx-eyebrow">ORBITAL STATION NIGHTSHIFT · DECK 00 · THE GATE</span>
        <h1>Choose <em>your way.</em></h1>
        <p className="nx-gate-lead">An AI company station built on IMD, the swarm of AI agents that builds, audits and ships. Five rooms, one crew of frogs. Pick the door that fits you.</p>
        {back && <button className="nx-continue" style={{ "--acc": ROOMS[back].accent } as React.CSSProperties} onClick={() => { go(ROOMS[back].nav[0]!.to); scrollTo(0, 0); }}>Continue to the {ROOMS[back].name} <NxIcon name="arrow" size={16} /></button>}

        <div className="nx-ways">
          {WAYS.map((w) => (
            <a key={w.key} href={w.to} className="nx-way" style={{ "--acc": w.accent } as React.CSSProperties} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); enter(w); }}>
              <span className="nx-way-art"><img src={w.emblem} alt="" loading={Number(w.key) > 3 ? "lazy" : "eager"} /></span>
              <span className="nx-way-tx">
                <span className="nx-way-who"><kbd>{w.key}</kbd>{w.iam}</span>
                <b>{w.title}</b>
                <span className="nx-way-line">{w.line}</span>
                <span className="nx-way-stat">{stat(w) ?? " "}</span>
              </span>
              <span className="nx-way-go"><NxIcon name="arrow" size={18} /></span>
            </a>
          ))}
        </div>
        <p className="nx-gate-keys">Press <kbd>1</kbd>–<kbd>7</kbd> to jump. New here? <Link to="/story">Read the story</Link>. Watching from a bot? <a href="/llms.txt">/llms.txt</a></p>
      </section>

      <footer className="nx-gate-foot">
        <span>{ov?.frogs ? `${ov.frogs.minted}/${ov.frogs.max} NIGHT FROGS` : "NIGHT FROGS onchain"} · {ov?.stakedPct != null ? `${ov.stakedPct.toFixed(1)}% of $SHIFT staked` : "$SHIFT on Ethereum"} · powered by the IMD swarm</span>
        <nav><a href={X_URL} target="_blank" rel="noreferrer">X</a><a href={TELEGRAM_URL} target="_blank" rel="noreferrer">Telegram</a><a href={BLUESKY_URL} target="_blank" rel="noreferrer">Bluesky</a></nav>
      </footer>
      <NxTabs room={null} />
    </div>
  );
}
