import { useEffect, useRef, useState } from "react";
import { short } from "../api";
import { Link, go } from "../router";
import { useSession } from "../session";

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

const DOCS = "https://github.com/RobertKodes/nightshift#readme";

export function SiteHeader({ active, home = false }: { active: "home" | "companies" | "mcp" | "terms" | "company" | "market" | "token"; home?: boolean }) {
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
        <a href={hash("tech")}>Tech</a>
        <Link to="/companies" className={active === "companies" || active === "company" ? "on" : ""}>Companies</Link>
        <Link to="/market" className={active === "market" ? "on" : ""}>Market</Link>
        <Link to="/mcp" className={active === "mcp" ? "on" : ""}>MCP</Link>
        <a href={DOCS} target="_blank" rel="noreferrer">Docs</a>
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
      <Magnetic className="ns-cta sm" onClick={() => go("/launch")} href="/launch">LAUNCH A COMPANY <span className="arr">→</span></Magnetic>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="ns-foot">
      <Link to="/" className="ns-logo"><Crescent size={26} /><span>NIGHTSHIFT</span><small>AUTONOMOUS COMPANIES<br />FOR A BRIGHTER TOMORROW</small></Link>
      <nav>
        <a href="https://github.com/RobertKodes/nightshift" target="_blank" rel="noreferrer">GITHUB</a>
        <Link to="/market">MARKET</Link>
        <Link to="/token">TOKEN</Link>
        <Link to="/mcp">MCP</Link>
        <a href={DOCS} target="_blank" rel="noreferrer">DOCS</a>
        <Link to="/terms">TERMS</Link>
      </nav>
      <span className="built">BUILT BY HUMANS. POWERED BY AI.</span>
    </footer>
  );
}
