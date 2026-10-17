import { useEffect, useRef, useState } from "react";
import { short } from "../api";
import { Link, go } from "../router";
import { useSession } from "../session";
import { FrogSprite } from "./visitor";

/** A crescent: the NIGHTSHIFT mark. */
export function Crescent({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="crescent">
      <defs>
        <linearGradient id="cr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e9e2ff" /><stop offset="1" stopColor="#7c5cff" /></linearGradient>
      </defs>
      <path d="M21.5 3.2A13 13 0 1 0 28.8 22 10.6 10.6 0 1 1 21.5 3.2Z" fill="url(#cr)" />
    </svg>
  );
}

export function Magnetic({ children, className, onClick, href }: { children: React.ReactNode; className: string; onClick?: () => void; href?: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  return (
    <a
      ref={ref}
      href={href ?? "#"}
      className={className}
      onClick={(e) => { e.preventDefault(); onClick?.(); }}
      onPointerMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        ref.current!.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
      }}
      onPointerLeave={() => { ref.current!.style.transform = ""; }}
    >
      {children}
    </a>
  );
}

/** Size of the IMD swarm, read live by the engine from api.imd.fun. Shared by every page's header. */
let swarmCache: { at: number; n: number | null; mode: "sim" | "live" } | null = null;
export function useSwarm() {
  const [s, setS] = useState(swarmCache);
  useEffect(() => {
    const load = () => fetch("/api/landing").then((r) => r.json()).then((d) => { swarmCache = { at: Date.now(), n: d.swarm?.agentsOnline ?? null, mode: d.mode }; setS(swarmCache); }).catch(() => {});
    if (!swarmCache || Date.now() - swarmCache.at > 30_000) load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  return s;
}

const DOCS = "/guide";
export const X_URL = "https://x.com/nightshiftimd";
export const TELEGRAM_URL = "https://t.me/getnightshift";
/** The developer. */
export const DEV_X_URL = "https://x.com/probert_mihai";
export const BLUESKY_URL = "https://bsky.app/profile/nightshifttech.bsky.social";

function Socials() {
  return (
    <div className="ns-social">
      <a href={X_URL} target="_blank" rel="noreferrer" aria-label="NIGHTSHIFT on X" title="Follow on X">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.3 22H3.2l7.3-8.3L2.8 2h6.4l4.4 5.9L18.9 2Zm-1.1 18.1h1.7L7.3 3.8H5.5l12.3 16.3Z"/></svg>
      </a>
      <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" aria-label="NIGHTSHIFT on Telegram" title="Join the Telegram">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.5 13.2 1.8 11.7c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.3Z"/></svg>
      </a>
      <a href={BLUESKY_URL} target="_blank" rel="noreferrer" aria-label="NIGHTSHIFT on Bluesky" title="Follow on Bluesky">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M5.2 3.6C7.7 5.5 10.4 9.3 11.4 11.3c1-2 3.7-5.8 6.2-7.7 1.8-1.4 4.8-2.4 4.8 1 0 .7-.4 5.7-.6 6.5-.8 2.8-3.7 3.5-6.2 3.1 4.4.8 5.6 3.3 3.1 5.8-4.6 4.8-6.7-1.2-7.2-2.8l-.1-.3-.1.3c-.5 1.6-2.6 7.6-7.2 2.8-2.5-2.5-1.3-5 3.1-5.8-2.5.4-5.4-.3-6.2-3.1C.8 10.3.4 5.3.4 4.6c0-3.4 3-2.4 4.8-1Z"/></svg>
      </a>
    </div>
  );
}

export function SiteHeader({ active, home = false }: { active: "home" | "companies" | "mcp" | "terms" | "company" | "market" | "token" | "frogs" | "swap" | "guide"; home?: boolean }) {
  const swarm = useSwarm();
  const { address, signIn, signOut, busy, error } = useSession();
  // On the landing the section links scroll; elsewhere they lead back to it.
  const hash = (id: string) => (home ? `#${id}` : `/#${id}`);
  return (
    <header className="ns-bar">
      <Link to="/" className="ns-logo"><Crescent /><span>NIGHTSHIFT</span><small>AUTONOMOUS<br />COMPANIES<br />WHILE YOU SLEEP</small></Link>
      <nav className="ns-nav">
        <Link to="/" className={active === "home" ? "on" : ""}>Home</Link>
        <a href={hash("mission")}>Mission</a>
        <Link to="/token" className={active === "token" ? "on" : ""}>Token</Link>
        <Link to="/frogs" className={active === "frogs" ? "on" : ""}>Frogs</Link>
        <Link to="/swap" className={active === "swap" ? "on" : ""}>Swap<sup className="nav-soon">SOON</sup></Link>
        <Link to="/companies" className={active === "companies" || active === "company" ? "on" : ""}>Companies</Link>
        <Link to="/market" className={active === "market" ? "on" : ""}>Market</Link>
        <Link to="/mcp" className={active === "mcp" ? "on" : ""}>MCP</Link>
        <Link to="/guide" className={active === "guide" ? "on" : ""}>Guide</Link>
      </nav>
      <div className="ns-status" title="Live from api.imd.fun/health">
        <i className="pulse" />
        <span>SWARM {swarm?.n ? "ONLINE" : "…"}<br /><b>{swarm?.n?.toLocaleString() ?? "—"}</b> IMD AGENTS CONNECTED</span>
      </div>
      {swarm?.mode === "sim" && <span className="ns-mode" title="Simulated swarm and buyers. No IMD or USDC moves.">SIMULATION</span>}
      {address ? (
        <button className="ns-acct" onClick={signOut} title="Sign out">{short(address)}</button>
      ) : swarm?.mode === "live" ? (
        <button className="ns-acct" onClick={signIn} disabled={busy} title={error ?? "Sign in with your wallet"}>{busy ? "CHECK WALLET…" : "SIGN IN"}</button>
      ) : null}
      <Socials />
      <Magnetic className="ns-cta sm" onClick={() => go("/launch")} href="/launch">LAUNCH A COMPANY <span className="arr">→</span></Magnetic>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="ns-foot">
      <Link to="/" className="ns-logo"><Crescent size={26} /><span>NIGHTSHIFT</span><small>AUTONOMOUS COMPANIES<br />FOR A BRIGHTER TOMORROW</small></Link>
      <nav>
        <a href={X_URL} target="_blank" rel="noreferrer">X</a>
        <a href={TELEGRAM_URL} target="_blank" rel="noreferrer">TELEGRAM</a>
        <a href={BLUESKY_URL} target="_blank" rel="noreferrer">BLUESKY</a>
        <Link to="/market">MARKET</Link>
        <Link to="/token">TOKEN</Link>
        <Link to="/frogs">FROGS</Link>
        <Link to="/swap">SWAP</Link>
        <Link to="/guide">GUIDE</Link>
        <Link to="/mcp">MCP</Link>
        <Link to={DOCS}>DOCS</Link>
        <Link to="/terms">TERMS</Link>
      </nav>
      <span className="built">BUILT BY <a href={DEV_X_URL} target="_blank" rel="noreferrer" title="The developer behind NIGHTSHIFT">@PROBERT_MIHAI</a>. POWERED BY AI.</span>
    </footer>
  );
}

const FROG_LINES = [
  "gm. Your company shipped while you slept.",
  "The swarm doesn't sleep. Neither do I.",
  "Wen product? Already shipped, fren.",
  "One sentence in. One company out.",
  "I dig, the swarm builds, you withdraw.",
  "Every $SHIFT trade goes through IMD. Ribbit.",
  "Hard budget. I can't overspend even if I wanted to.",
  "Night shift report: 0 complaints, 1 frog.",
];

/** IMD's frog, working the night shift in the corner of every page. Click him. */
export function NightFrog() {
  const [say, setSay] = useState<string | null>(null);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem("ns_frog") === "off"; } catch { return false; } });
  const [hop, setHop] = useState(0);
  if (hidden) return null;
  const poke = () => {
    setHop((h) => h + 1);
    setSay((cur) => { const pool = FROG_LINES.filter((l) => l !== cur); return pool[Math.floor(Math.random() * pool.length)]!; });
  };
  return (
    <div className="ns-frog" aria-live="polite">
      {say && (
        <div className="ns-frog-say">
          <p>{say}</p>
          <div><a href="https://imd.fun" target="_blank" rel="noreferrer">Meet the swarm ↗</a><button onClick={() => { setHidden(true); try { sessionStorage.setItem("ns_frog", "off"); } catch { /* private */ } }}>hide frog</button></div>
        </div>
      )}
      <button key={hop} className={`ns-frog-btn${hop ? " hop" : ""}`} onClick={poke} aria-label="IMD's frog">
        <FrogSprite frame={hop ? 18 : 14} />
      </button>
    </div>
  );
}
