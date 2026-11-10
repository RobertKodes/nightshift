import { useEffect, useState } from "react";
import { short } from "../api";
import { BLUESKY_URL, DEV_X_URL, OPENSEA_URL, TELEGRAM_URL, X_COMMUNITY_URL, X_URL, useSwarm } from "../landing/chrome";
import { Link, go } from "../router";
import { useSession } from "../session";
import { FEED, FOUND, NAV, READING, SYSTEMS, groupOf, isOn, tabsOf, type NavId } from "./nav";
import { PxIcon } from "./PxIcon";
import "./saas.css";

function Wallet() {
  const { address, signIn, signOut, busy, error } = useSession();
  const swarm = useSwarm();
  if (address) {
    return (
      <details className="px-walletwrap">
        <summary className="px-wallet"><PxIcon name="wallet" size={13} />{short(address)}</summary>
        <div className="px-menu" style={{ left: "auto", right: 0, width: 220 }}>
          <Link to="/my"><b>Owner desk</b><span>Companies and approvals</span></Link>
          <Link to="/frogs"><b>Your frogs</b><span>Missions and upgrades</span></Link>
          <a href="#" onClick={(e) => { e.preventDefault(); void signOut(); }}><b>Sign out</b><span>Disconnect wallet</span></a>
        </div>
      </details>
    );
  }
  return (
    <button className="px-wallet" onClick={() => void signIn()} disabled={busy} title={error ?? "Sign in with your wallet"}>
      <PxIcon name="lock" size={12} />{busy ? "CONNECTING" : swarm?.mode === "sim" ? "DEMO" : "CONNECT"}
    </button>
  );
}

/** The protocol bar: the frog mark, the short menu, one call to action, the wallet. */
export function SxHeader({ path = "/", title }: { path?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const swarm = useSwarm();
  const here = groupOf(path);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);
  // an open menu closes when the pointer goes elsewhere, or when one of its links is followed
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      for (const d of document.querySelectorAll<HTMLDetailsElement>(".px-head details[open]")) {
        if (!d.contains(target) || target.closest(".px-menu a")) d.removeAttribute("open");
      }
    };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, []);
  return (
    <>
      <header className="px-head">
        <div className="px-head-in">
          <Link to="/" className="px-logo" aria-label="NIGHTSHIFT home">
            <img src="/brand/pepe-pixel.svg" alt="" width={26} height={26} />
            <b>NIGHTSHIFT</b>
            <em>PROTOCOL</em>
          </Link>
          <nav className="px-nav" aria-label="Main">
            {NAV.map((group) => group.links.length === 1 ? (
              <Link key={group.id} to={group.to} className={here === group.id ? "px-nav-a on" : "px-nav-a"} title={group.line}>
                {group.id === "live" && <i className="px-nav-live" aria-hidden="true" />}{group.label}
              </Link>
            ) : (
              <details key={group.id} className={here === group.id ? "on" : undefined}>
                <summary>{group.label}<span aria-hidden="true">▾</span></summary>
                <div className="px-menu">
                  {group.links.map((link) => (
                    <Link key={link.to} to={link.to}><b>{link.label}</b>{link.line && <span>{link.line}</span>}</Link>
                  ))}
                  <div className="px-menu-foot"><span>{group.line}</span></div>
                </div>
              </details>
            ))}
          </nav>
          <div className="px-actions">
            <span className="px-readout" title="IMD agents online, from api.imd.fun"><i />{swarm?.n ? `${swarm.n.toLocaleString("en-US")} AGENTS` : "AGENTS —"}</span>
            <Link to={FOUND} className="px-btn primary small px-cta">FOUND A COMPANY</Link>
            <Wallet />
            <button className="px-burger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              <PxIcon name={open ? "close" : "menu"} size={16} />
            </button>
          </div>
        </div>
        {title && <span className="px-sr" aria-live="polite">{title}</span>}
      </header>
      <div className={open ? "px-drawer on" : "px-drawer"} aria-hidden={!open} onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}>
        <div className="px-drawer-cta">
          <Link to={FOUND} className="px-btn primary">FOUND A COMPANY</Link>
          <Link to={FEED} className="px-btn">WATCH LIVE</Link>
        </div>
        {NAV.map((group) => (
          <div key={group.id} className={group.links.length === 1 ? "px-drawer-solo" : undefined}>
            {group.links.length > 1 && <h4>{group.label}</h4>}
            {group.links.map((link) => <Link key={link.to} to={link.to}>{link.label}{link.line && <span>{link.line}</span>}</Link>)}
          </div>
        ))}
        <h4>More</h4>
        {READING.map((link) => <Link key={link.to} to={link.to}>{link.label}{link.line && <span>{link.line}</span>}</Link>)}
        <Link to="/new">Every page<span>The whole site, one list</span></Link>
      </div>
    </>
  );
}

/** The page tabs of one menu group: its own pages, the one in view lit. */
export function SxSectionBar({ group, path }: { group: NavId | null; path: string }) {
  const tabs = tabsOf(group);
  if (tabs.length < 2) return null;
  const label = NAV.find((g) => g.id === group)?.label ?? "Section";
  // the longest matching address wins, so /games/chess lights "Night Chess" and not "All games" too
  const lit = tabs.filter((n) => isOn(path, n.to)).sort((a, b) => b.to.length - a.to.length)[0]?.to;
  return (
    <nav className="px-strip" aria-label={`${label} pages`}>
      <div className="px-strip-in">
        {tabs.map((n) => <Link key={n.to} to={n.to} className={n.to === lit ? "on" : ""}><span>{n.label}</span></Link>)}
      </div>
    </nav>
  );
}

/** Phones: five places worth a thumb. */
export function SxTabs({ path }: { path?: string }) {
  const here = groupOf(path ?? location.pathname);
  const tab = (to: string, label: string, icon: string, on: boolean) => (
    <a href={to} className={on ? "on" : ""} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(to); }}>
      <PxIcon name={icon} size={17} /><span>{label}</span>
    </a>
  );
  return (
    <nav className="px-tabs" aria-label="NIGHTSHIFT">
      {tab("/", "LIVE", "pulse", here === "live")}
      {tab("/companies", "COMPANIES", "blocks", here === "companies")}
      {tab("/market", "MARKET", "market", here === "market")}
      {tab("/games", "GAMES", "play", here === "games")}
      {tab("/token", "$SHIFT", "coin", here === "shift")}
    </nav>
  );
}

/** The footer: the same groups as the menu, the AI systems, the reading, one honest line. */
export function SxFooter() {
  const pick = (...ids: NavId[]) => NAV.filter((g) => ids.includes(g.id)).flatMap((g) => g.links);
  const systems = ["/observatory", "/services", "/mind", "/crews", "/mcp", "/agents/start"];
  const cols: { name: string; links: { to: string; label: string }[] }[] = [
    { name: "COMPANIES", links: [...pick("companies", "market"), { to: FEED, label: "Live feed" }, { to: "/games", label: "Games" }] },
    { name: "$SHIFT", links: pick("shift") },
    { name: "OBSERVATORY", links: SYSTEMS.filter((l) => systems.includes(l.to)) },
    { name: "TRUST", links: [...pick("learn"), ...READING.filter((l) => ["/whitepaper", "/changelog", "/terms"].includes(l.to))] },
  ];
  return (
    <footer className="px-foot">
      <div className="px-foot-in">
        <div className="px-foot-brand">
          <Link to="/" className="px-logo" aria-label="NIGHTSHIFT home"><img src="/brand/pepe-pixel.svg" alt="" width={26} height={26} /><b>NIGHTSHIFT</b><em>PROTOCOL</em></Link>
          <p>AI companies that run while you sleep. Work bought from the IMD agent swarm, sold for USDC, recorded on chain.</p>
          <a className="px-foot-note" href="https://imd.fun" target="_blank" rel="noreferrer"><PxIcon name="bot" size={12} />POWERED BY IMD · IMD.FUN</a>
        </div>
        {cols.map((col) => (
          <div className="px-foot-col" key={col.name}>
            <b>{col.name}</b>
            {col.links.map((link) => <Link key={link.to} to={link.to}>{link.label}</Link>)}
          </div>
        ))}
      </div>
      <div className="px-foot-line">
        <span>© {new Date().getFullYear()} NIGHTSHIFT</span>
        <nav>
          <a href={X_URL} target="_blank" rel="noreferrer">X</a>
          <a href={X_COMMUNITY_URL} target="_blank" rel="noreferrer">X Community</a>
          <a href={TELEGRAM_URL} target="_blank" rel="noreferrer">Telegram</a>
          <a href={BLUESKY_URL} target="_blank" rel="noreferrer">Bluesky</a>
          <a href={OPENSEA_URL} target="_blank" rel="noreferrer">OpenSea</a>
          <a href="https://github.com/RobertKodes/nightshift" target="_blank" rel="noreferrer">GitHub</a>
          <a href="/llms.txt">llms.txt</a>
          <Link to="/privacy">Privacy</Link>
          <Link to="/new">Every page</Link>
        </nav>
        <span className="px-foot-legal">NOT FINANCIAL ADVICE · CONTRACTS ARE PUBLIC · BUILT BY <a href={DEV_X_URL} target="_blank" rel="noreferrer">@probert_mihai</a></span>
      </div>
    </footer>
  );
}
