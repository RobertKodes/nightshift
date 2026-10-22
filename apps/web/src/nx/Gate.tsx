import { useEffect, useRef, useState } from "react";
import { BLUESKY_URL, Crescent, TELEGRAM_URL, TIKTOK_URL, X_URL, useSwarm } from "../landing/chrome";
import { Link, go } from "../router";
import { NxIcon } from "./icons";
import { ROOMS, WAYS, type Way } from "./map";
import { InstallButton } from "../landing/app";
import { ImdVisitor } from "../landing/visitor";
import { NxTabs, lastRoom, rememberRoom } from "./Shell";
import { StationMap, useDock } from "./StationMap";
import { RewardsCard } from "./Rewards";
import type { RoomId } from "./map";
import "./nx.css";

type Station = { breakroom: { agentsInArena: number; liveGames: number }; geek: { leagueAgents: number; tradableTokens: number | null }; command: { missions: number }; leader: { name: string; returnPct: number } | null };
type Overview = { market: { priceUsd: number; mcap: number; liquidity?: number } | null; staked?: number | null; stakedPct: number | null; burnedShift?: number | null; burnedImd?: number | null; frogs: { minted: number; max: number } | null;
  burnReserveEth?: number | null; burnAtEth?: number | null; lastBurn?: { at: number; tx: string; imd: number | null } | null };

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

/** Text that decodes into place, letter by letter, once; plain text for anyone who prefers less motion. */
function Decode({ text }: { text: string }) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const glyphs = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789<>/#";
    const start = performance.now(), dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const done = Math.min(1, (t - start) / dur);
      const fixed = Math.floor(done * text.length);
      setOut(text.split("").map((ch, i) => (ch === " " || i < fixed ? ch : glyphs[Math.floor(Math.random() * glyphs.length)]!)).join(""));
      if (done < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return <span aria-hidden="true">{out}</span>;
}

const get = <T,>(u: string) => fetch(u).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);
/** A price below $0.001 with its zeros counted, the way DexScreener writes it: 0.0000644 is $0.0₄644. */
export const tiny = (n: number) => {
  const zeros = -Math.floor(Math.log10(n)) - 1;
  const digits = Math.min(999, Math.round(n * 10 ** (zeros + 3)));
  return `$0.0${[...String(zeros)].map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("")}${digits}`;
};
const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : n > 0 && n < 1e-3 ? tiny(n) : `$${n.toPrecision(3)}`);
const amount = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n >= 100 ? n.toFixed(0) : n.toFixed(2));

/** The keeper runs at every odd UTC hour (its burn lands within about an hour of it). */
const nextRun = () => { const d = new Date(); d.setUTCMinutes(0, 0, 0); d.setUTCHours(d.getUTCHours() + (d.getUTCHours() % 2 === 1 ? 2 : 1)); return `${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`; };
const eth = (n: number) => n.toFixed(n < 0.01 ? 4 : 3);

/** The next IMD burn: the fee splitter's ETH reserve against what the keeper waits for at today's gas price, and the last burn. */
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
        <span className="nx-burn-v">{ready ? <><b>{eth(r)} ETH</b> · burns at the next keeper run, about {nextRun()}</> : <><b>{eth(r)}</b> / {eth(at)} ETH</>}</span>
      </>}
      {last && <a className="nx-burn-last" href={`https://etherscan.io/tx/${last.tx}`} target="_blank" rel="noreferrer">Last burn {new Date(last.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC{last.imd ? ` · ${amount(last.imd)} IMD` : ""} ↗</a>}
      {ov?.burnedImd != null && <Link className="nx-burn-sum" to="/impact">{amount(ov.burnedImd)} IMD burned in all</Link>}
    </div>
  );
}

/** What is new on the station right now, one tap each: kept short, and taken down when it is no longer new. */
const NEW_NOW = [
  { to: "/forge", tag: "GEN 2 · FORGE OPEN", title: "Night Watchers", line: "10 NIGHT FROGS + 2 IMD forge 1 Night Watcher: more shift hours and a Night Watch seat.", acc: "#b8ff4a" },
  { to: "/watch", tag: "WITH imdUSD", title: "The Night Watch", line: "Run a bot that keeps imdUSD safe and earns the liquidation bonus. A step-by-step guide, report-only first.", acc: "#4ad8ff" },
  { to: "/games/poker", tag: "GAME ROOM", title: "NIGHT POKER", line: "Heads-up Hold'em, free or staked in $SHIFT and IMD, and free tables up to six.", acc: "#ff5ca8" },
];
function NewNow() {
  return (
    <section className="nx-new" aria-label="New on NIGHTSHIFT">
      {NEW_NOW.map((n) => (
        <Link key={n.to} to={n.to} className="nx-new-card" style={{ "--acc": n.acc } as React.CSSProperties}>
          <span className="nx-new-tag">{n.tag}</span>
          <b>{n.title}</b>
          <span className="nx-new-line">{n.line}</span>
          <span className="nx-new-go" aria-hidden="true"><NxIcon name="arrow" size={18} /></span>
        </Link>
      ))}
    </section>
  );
}

/** $SHIFT at a glance, read live from Ethereum: the two things holders do (swap, stake), one tap each, and the numbers behind them. */
function TokenDeck({ ov }: { ov: Overview | null }) {
  const cells: { k: string; v: string | null; sub?: string; acc: string; to: string }[] = [
    { k: "Price", v: ov?.market ? money(ov.market.priceUsd) : null, sub: "per $SHIFT", acc: "#ffc861", to: "/token" },
    { k: "Market cap", v: ov?.market ? money(ov.market.mcap) : null, sub: "DexScreener", acc: "#ff9f5a", to: "/token" },
    { k: "Staked", v: ov?.staked != null ? amount(ov.staked) : null, sub: ov?.stakedPct != null ? `${ov.stakedPct.toFixed(1)}% of supply` : undefined, acc: "#b8ff4a", to: "/stake" },
    { k: "$SHIFT burned", v: ov?.burnedShift != null ? amount(ov.burnedShift) : null, sub: "gone for good", acc: "#ff5ca8", to: "/tokenomics" },
    { k: "IMD burned", v: ov?.burnedImd != null ? amount(ov.burnedImd) : null, sub: "at BurnExecutor", acc: "#4ad8ff", to: "/impact" },
    { k: "Liquidity", v: ov?.market?.liquidity != null ? money(ov.market.liquidity) : null, sub: "Uniswap v4 pool", acc: "#c9c2ff", to: "/token" },
  ];
  return (
    <section className="nx-deck" aria-label="$SHIFT">
      <div className="nx-deck-go">
        <Link to="/swap" className="nx-deck-btn swap"><NxIcon name="swap" size={20} /><span><b>Swap $SHIFT</b><small>ETH ⇄ $SHIFT, in one tap</small></span></Link>
        <Link to="/stake" className="nx-deck-btn stake"><NxIcon name="stake" size={20} /><span><b>Stake $SHIFT</b><small>Lock 0 to 730 days · unstake when unlocked</small></span></Link>
      </div>
      <dl className="nx-deck-stats">
        {cells.map((c) => (
          <Link key={c.k} to={c.to} className="nx-deck-cell" style={{ "--acc": c.acc } as React.CSSProperties}>
            <dt>{c.k}</dt>
            <dd>{c.v ?? "…"}</dd>
            <span>{c.sub ?? " "}</span>
          </Link>
        ))}
      </dl>
      <BurnBar ov={ov} />
    </section>
  );
}

/** CHOOSE YOUR WAY: the station's front door. Seven ways in, each to the part of the station made for you. */
export function Gate() {
  const sky = useRef<HTMLCanvasElement>(null);
  useStars(sky);
  const swarm = useSwarm();
  const [st, setSt] = useState<Station | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [back, setBack] = useState<ReturnType<typeof lastRoom>>(null);
  useEffect(() => {
    setBack(lastRoom()); void get<Station>("/api/station").then(setSt);
    // the token numbers move: read again every minute while the page is open
    const read = () => { if (!document.hidden) void get<Overview>("/api/token/overview").then((o) => { if (o) setOv(o); }); };
    read();
    const t = setInterval(read, 60_000);
    return () => clearInterval(t);
  }, []);
  document.title = "NIGHTSHIFT · Choose your way";

  const [focus, setFocus] = useState<RoomId | null>(null);
  const dock = useDock();
  const enter = (w: Way) => { if (w.room) rememberRoom(w.room); dock.start(w.room, () => { go(w.to); scrollTo(0, 0); }); };
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
      <StationMap focus={focus} />
      {dock.overlay}
      {/* IMD's frog comes over from imd.fun through his portal, as on the story page */}
      <div className="nx-visit"><ImdVisitor /></div>
      <header className="nx-gate-top">
        <Link to="/" className="nx-mark"><Crescent size={24} /><span>NIGHTSHIFT</span></Link>
        <span className="nx-pulse"><i />{swarm?.n ? swarm.n.toLocaleString("en-US") : "…"}<small>IMD AGENTS ONLINE</small></span>
        <nav>
          <Link to="/story">The story</Link>
          <a href={X_URL} target="_blank" rel="noreferrer" aria-label="X">X</a>
          <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" aria-label="Telegram">TG</a>
          <a href={TIKTOK_URL} target="_blank" rel="noreferrer" aria-label="TikTok">TIKTOK</a>
        </nav>
        <InstallButton compact />
      </header>

      <section className="nx-gate-in">
        <span className="nx-eyebrow"><i />DECK 00 · THE GATE</span>
        <h1 className="nx-title" aria-label="Choose your way"><Decode text="Choose your way" /></h1>
        <div className="nx-spectrum" aria-hidden="true">{["#ff5ca8", "#4ad8ff", "#c9c2ff", "#ffc861", "#b8ff4a"].map((c) => <i key={c} style={{ background: c, color: c }} />)}</div>
        <p className="nx-gate-lead">An AI company station built on IMD, the swarm of AI agents that builds, audits and ships. Five rooms, one crew of frogs. Pick the door that fits you.</p>
        <TokenDeck ov={ov} />
        <NewNow />
        <RewardsCard />
        {back && <button className="nx-continue" style={{ "--acc": ROOMS[back].accent } as React.CSSProperties} onClick={() => dock.start(back, () => { go(ROOMS[back].nav[0]!.to); scrollTo(0, 0); })}>Continue to the {ROOMS[back].name} <NxIcon name="arrow" size={16} /></button>}

        <div className="nx-ways">
          {WAYS.map((w) => (
            <a key={w.key} href={w.to} className="nx-way" style={{ "--acc": w.accent } as React.CSSProperties}
              onMouseEnter={() => setFocus(w.room)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(w.room)} onBlur={() => setFocus(null)} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); enter(w); }}>
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
        <nav><a href={X_URL} target="_blank" rel="noreferrer">X</a><a href={TELEGRAM_URL} target="_blank" rel="noreferrer">Telegram</a><a href={TIKTOK_URL} target="_blank" rel="noreferrer">TikTok</a><a href={BLUESKY_URL} target="_blank" rel="noreferrer">Bluesky</a></nav>
      </footer>
      <NxTabs room={null} />
    </div>
  );
}
