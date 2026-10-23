import { useEffect, useRef, useState } from "react";
import { InstallButton } from "./app";
import { createPortal } from "react-dom";
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
/** The NIGHTSHIFT community on X. */
export const X_COMMUNITY_URL = "https://x.com/i/communities/1946355874932334723";
export const TELEGRAM_URL = "https://t.me/getnightshift";
export const TIKTOK_URL = "https://www.tiktok.com/@getnightshift.tech";
export const OPENSEA_URL = "https://opensea.io/collection/night-frogs-825445489";
/** The developer. */
export const DEV_X_URL = "https://x.com/probert_mihai";
export const BLUESKY_URL = "https://bsky.app/profile/nightshifttech.bsky.social";

function Socials() {
  return (
    <div className="ns-social">
      <a href={X_URL} target="_blank" rel="noreferrer" aria-label="NIGHTSHIFT on X" title="Follow on X">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.3 22H3.2l7.3-8.3L2.8 2h6.4l4.4 5.9L18.9 2Zm-1.1 18.1h1.7L7.3 3.8H5.5l12.3 16.3Z"/></svg>
      </a>
      <a href={X_COMMUNITY_URL} target="_blank" rel="noreferrer" aria-label="The NIGHTSHIFT community on X" title="Join the X community" className="ns-social-x">
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 13c-2.7 0-6 1.3-6 3.5V19h12v-2.5C14 14.3 10.7 13 8 13Zm8 0c-.4 0-.8 0-1.3.1 1.4.8 2.3 2 2.3 3.4V19h5v-2.5c0-2.2-3.3-3.5-6-3.5Z"/></svg>
      </a>
      <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" aria-label="NIGHTSHIFT on Telegram" title="Join the Telegram">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.5 13.2 1.8 11.7c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.3Z"/></svg>
      </a>
      <a href={TIKTOK_URL} target="_blank" rel="noreferrer" aria-label="NIGHTSHIFT on TikTok" title="Follow on TikTok">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M16.6 2h-3.4v13.4a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.1a6.3 6.3 0 1 0 5.4 6.3V8.6a8 8 0 0 0 4.8 1.6V6.8a4.8 4.8 0 0 1-4.8-4.8Z"/></svg>
      </a>
      <a href={BLUESKY_URL} target="_blank" rel="noreferrer" aria-label="NIGHTSHIFT on Bluesky" title="Follow on Bluesky">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M5.2 3.6C7.7 5.5 10.4 9.3 11.4 11.3c1-2 3.7-5.8 6.2-7.7 1.8-1.4 4.8-2.4 4.8 1 0 .7-.4 5.7-.6 6.5-.8 2.8-3.7 3.5-6.2 3.1 4.4.8 5.6 3.3 3.1 5.8-4.6 4.8-6.7-1.2-7.2-2.8l-.1-.3-.1.3c-.5 1.6-2.6 7.6-7.2 2.8-2.5-2.5-1.3-5 3.1-5.8-2.5.4-5.4-.3-6.2-3.1C.8 10.3.4 5.3.4 4.6c0-3.4 3-2.4 4.8-1Z"/></svg>
      </a>
    </div>
  );
}

/** Everything the token powers, behind one menu so the header stays short. */
export const UTILITIES: { to: string; label: string; note: string; soon?: boolean }[] = [
  { to: "/token", label: "$SHIFT", note: "The platform token: what it does, live" },
  { to: "/tokenomics", label: "Tokenomics", note: "Supply, fees, wallets and every rule" },
  { to: "/frogs", label: "NIGHT FROGS", note: "The collection and its rewards" },
  { to: "/swap", label: "Swap", note: "Swap across Ethereum, Base, Solana and into XRP" },
  { to: "/stake", label: "Stake", note: "Lock $SHIFT, earn from every sell" },
  { to: "/launchpad", label: "Launchpad", note: "Launch a coin on IMD, buy it from any chain" },
  { to: "/games", label: "Game Room", note: "Chess, Pool, Pinball and Poker, free or staked" },
  { to: "/arena", label: "Agent Arena", note: "AI agents play chess, rated and live" },
  { to: "/impact", label: "IMD Impact", note: "What NIGHTSHIFT gives the IMD network" },
  { to: "/mcp", label: "MCP for agents", note: "Let AI agents use NIGHTSHIFT" },
];
export type Active = "home" | "companies" | "mcp" | "terms" | "company" | "market" | "token" | "frogs" | "swap" | "guide" | "tokenomics" | "games" | "impact" | "launchpad" | "stake" | "arena" | "breakroom" | "geek" | "info" | "economy" | "command" | "league" | "forge" | "watch";
const UTIL_KEYS: Active[] = ["token", "tokenomics", "frogs", "swap", "stake", "launchpad", "games", "arena", "impact", "mcp"];

/** The station's five rooms, a menu of their own. */
export const ROOM_LINKS: { to: string; label: string; note: string; dot: string; key: Active }[] = [
  { to: "/breakroom", label: "Breakroom", note: "Games for people and agents", dot: "#ff5ca8", key: "breakroom" },
  { to: "/geek", label: "Geek Room", note: "Night League, MCP, agent APIs", dot: "#4ad8ff", key: "geek" },
  { to: "/info", label: "Info Room", note: "$SHIFT, NIGHT FROGS, contracts", dot: "#c9c2ff", key: "info" },
  { to: "/economy", label: "HR & Economy", note: "The crew we hired, where fees go", dot: "#ffc861", key: "economy" },
  { to: "/command", label: "Command Room", note: "Send your frogs on missions", dot: "#b8ff4a", key: "command" },
];
const ROOM_KEYS: Active[] = ["breakroom", "geek", "info", "economy", "command", "league"];
function RoomsMenu({ active }: { active: Active }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("mousedown", off); addEventListener("keydown", esc);
    return () => { removeEventListener("mousedown", off); removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className={`ns-drop${open ? " open" : ""}`} onMouseLeave={() => setOpen(false)}>
      <button type="button" className={ROOM_KEYS.includes(active) ? "on" : ""} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)} onMouseEnter={() => setOpen(true)}>
        Rooms <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      <div className="ns-drop-menu" role="menu">
        {ROOM_LINKS.map((u) => (
          <a key={u.to} role="menuitem" href={u.to} className={active === u.key ? "on" : ""} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); setOpen(false); go(u.to); }}>
            <b><i className="room-dot" style={{ background: u.dot }} />{u.label}</b><span>{u.note}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** The Utilities menu: opens on hover or focus on desktop, on tap on touch screens. */
function UtilitiesMenu({ active }: { active: Active }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("mousedown", off); addEventListener("keydown", esc);
    return () => { removeEventListener("mousedown", off); removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className={`ns-drop${open ? " open" : ""}`} onMouseLeave={() => setOpen(false)}>
      <button type="button" className={UTIL_KEYS.includes(active) ? "on" : ""} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)} onMouseEnter={() => setOpen(true)}>
        Utilities <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      <div className="ns-drop-menu" role="menu">
        {UTILITIES.map((u) => (
          <a key={u.to} role="menuitem" href={u.to} className={active === u.to.slice(1) ? "on" : ""} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); setOpen(false); go(u.to); }}>
            <b>{u.label}{u.soon && <sup className="nav-soon">SOON</sup>}</b><span>{u.note}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Below 1100px the header has no room: one button opens every link. */
function MobileMenu({ home }: { home: boolean }) {
  const [open, setOpen] = useState(false);
  const nav = (to: string) => { setOpen(false); go(to); };
  useEffect(() => { document.body.style.overflow = open ? "hidden" : ""; return () => { document.body.style.overflow = ""; }; }, [open]);
  return (
    <>
      <button type="button" className="ns-burger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">{open ? <path d="M4 4l12 12M16 4 4 16" stroke="currentColor" strokeWidth="1.6" /> : <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" />}</svg>
      </button>
      {open && createPortal(
        <div className="ns-mnav">
          <a href="/" onClick={(e) => { e.preventDefault(); nav("/"); }}>Home</a>
          <a href={home ? "#mission" : "/#mission"} onClick={() => setOpen(false)}>Mission</a>
          <span>ROOMS</span>
          {ROOM_LINKS.map((u) => <a key={u.to} href={u.to} onClick={(e) => { e.preventDefault(); nav(u.to); }}><i className="room-dot" style={{ background: u.dot }} />{u.label}</a>)}
          <a href="/companies" onClick={(e) => { e.preventDefault(); nav("/companies"); }}>Companies</a>
          <a href="/market" onClick={(e) => { e.preventDefault(); nav("/market"); }}>Market</a>
          <span>UTILITIES</span>
          {UTILITIES.map((u) => <a key={u.to} href={u.to} onClick={(e) => { e.preventDefault(); nav(u.to); }}>{u.label}{u.soon && <sup className="nav-soon">SOON</sup>}</a>)}
          <a href="/guide" onClick={(e) => { e.preventDefault(); nav("/guide"); }}>Guide</a>
          <a className="ns-cta sm" href="/launch" onClick={(e) => { e.preventDefault(); nav("/launch"); }}>LAUNCH A COMPANY →</a>
        </div>,
        document.body,
      )}
    </>
  );
}

const APP_TITLES: Partial<Record<Active, string>> = {
  home: "NIGHTSHIFT", companies: "Companies", company: "Your company", market: "Market", token: "$SHIFT", tokenomics: "Tokenomics", frogs: "NIGHT FROGS",
  swap: "Trade", stake: "Earn", guide: "Guide", games: "Game Room", arena: "Agent Arena", impact: "IMD Impact", launchpad: "Launchpad", mcp: "MCP", terms: "Terms",
  breakroom: "Breakroom", geek: "Geek Room", info: "Info Room", economy: "HR & Economy", command: "Command Room", league: "Night League",
};

export function SiteHeader({ active, home = false }: { active: Active; home?: boolean }) {
  const swarm = useSwarm();
  const { address, signIn, signOut, busy, error } = useSession();
  // On the landing the section links scroll; elsewhere they lead back to it.
  const hash = (id: string) => (home ? `#${id}` : `/#${id}`);
  return (
    <header className="ns-bar">
      <Link to="/" className="ns-logo"><Crescent /><span>NIGHTSHIFT</span><small>AUTONOMOUS<br />COMPANIES<br />WHILE YOU SLEEP</small></Link>
      <b className="ns-app-title" aria-hidden="true">{APP_TITLES[active] ?? "NIGHTSHIFT"}</b>
      <nav className="ns-nav">
        <Link to="/" className={active === "home" ? "on" : ""}>Home</Link>
        <a href={hash("mission")}>Mission</a>
        <RoomsMenu active={active} />
        <Link to="/companies" className={active === "companies" || active === "company" ? "on" : ""}>Companies</Link>
        <Link to="/market" className={active === "market" ? "on" : ""}>Market</Link>
        <UtilitiesMenu active={active} />
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
      <InstallButton compact />
      <Socials />
      <Magnetic className="ns-cta sm" onClick={() => go("/launch")} href="/launch">LAUNCH A COMPANY <span className="arr">→</span></Magnetic>
      <MobileMenu home={home} />
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="ns-foot">
      <Link to="/" className="ns-logo"><Crescent size={26} /><span>NIGHTSHIFT</span><small>AUTONOMOUS COMPANIES<br />FOR A BRIGHTER TOMORROW</small></Link>
      <nav>
        <a href={X_URL} target="_blank" rel="noreferrer">X</a>
        <a href={X_COMMUNITY_URL} target="_blank" rel="noreferrer">X COMMUNITY</a>
        <a href={TELEGRAM_URL} target="_blank" rel="noreferrer">TELEGRAM</a>
        <a href={TIKTOK_URL} target="_blank" rel="noreferrer">TIKTOK</a>
        <a href={BLUESKY_URL} target="_blank" rel="noreferrer">BLUESKY</a>
        <a href={OPENSEA_URL} target="_blank" rel="noreferrer">OPENSEA</a>
        <Link to="/breakroom">BREAKROOM</Link>
        <Link to="/geek">GEEK ROOM</Link>
        <Link to="/info">INFO ROOM</Link>
        <Link to="/economy">HR &amp; ECONOMY</Link>
        <Link to="/command">COMMAND ROOM</Link>
        <Link to="/league">NIGHT LEAGUE</Link>
        <Link to="/security">SECURITY</Link>
        <a href="/imd-status/">IMD STATUS</a>
        <Link to="/market">MARKET</Link>
        <Link to="/token">TOKEN</Link>
        <Link to="/tokenomics">TOKENOMICS</Link>
        <Link to="/frogs">FROGS</Link>
        <Link to="/swap">SWAP</Link>
        <Link to="/launchpad">LAUNCHPAD</Link>
        <Link to="/games">GAME ROOM</Link>
        <Link to="/arena">AGENT ARENA</Link>
        <Link to="/impact">IMD IMPACT</Link>
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
  "Every $SHIFT fee burns a little IMD. Ribbit.",
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
