import { useEffect, useState, type CSSProperties } from "react";
import { short } from "../api";
import { BLUESKY_URL, DEV_X_URL, OPENSEA_URL, TELEGRAM_URL, X_COMMUNITY_URL, X_URL, useSwarm } from "../landing/chrome";
import { ROOMS, type RoomId } from "../nx/map";
import { Link, go } from "../router";
import { useSession } from "../session";
import { SECTIONS, sectionPath } from "../site/sitemap";
import { NAV } from "./nav";
import { PxIcon } from "./PxIcon";
import "./saas.css";

const isOn = (path: string, to: string) => path === to || (to !== "/" && path.startsWith(`${to}/`));

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

/** The protocol bar: the frog mark, five doors in plain words, two calls to action, the wallet. */
export function SxHeader({ path = "/", title }: { path?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const swarm = useSwarm();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);
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
            {NAV.map((group) => (
              <details key={group.id}>
                <summary>{group.label}<span aria-hidden="true">▾</span></summary>
                <div className="px-menu">
                  {group.links.map((link) => (
                    <Link key={link.to} to={link.to}><b>{link.label}</b>{link.line && <span>{link.line}</span>}</Link>
                  ))}
                  <div className="px-menu-foot"><span>{group.line}</span><Link to={group.to}>OPEN →</Link></div>
                </div>
              </details>
            ))}
          </nav>
          <div className="px-actions">
            <span className="px-readout" title="IMD agents online, from api.imd.fun"><i />{swarm?.n ? `${swarm.n.toLocaleString("en-US")} AGENTS` : "AGENTS —"}</span>
            <Link to="/stake" className="px-btn ghost small px-ghost"><PxIcon name="stake" size={13} />STAKE</Link>
            <Link to="/launch" className="px-btn primary small px-cta">START A COMPANY</Link>
            <Wallet />
            <button className="px-burger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              <PxIcon name={open ? "close" : "menu"} size={16} />
            </button>
          </div>
        </div>
        {title && <span className="px-sr" aria-live="polite">{title}</span>}
      </header>
      <div className={open ? "px-drawer on" : "px-drawer"} aria-hidden={!open}>
        <div className="px-drawer-cta">
          <Link to="/launch" className="px-btn primary">START A COMPANY</Link>
          <Link to="/stake" className="px-btn">STAKE $SHIFT</Link>
        </div>
        {NAV.map((group) => (
          <div key={group.id}>
            <h4>{group.label}</h4>
            {group.links.map((link) => <Link key={link.to} to={link.to}>{link.label}{link.line && <span>{link.line}</span>}</Link>)}
          </div>
        ))}
        <h4>Every section</h4>
        {SECTIONS.map((section) => <Link key={section.id} to={sectionPath(section)}>{section.name}<span>{section.line}</span></Link>)}
        <h4>Protocol</h4>
        <Link to="/partners">Partners</Link>
        <Link to="/changelog">Changelog</Link>
        <Link to="/terms">Terms &amp; risks</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/delete-account">Delete account</Link>
      </div>
    </>
  );
}

/** The old station icon names, folded onto the pixel set. */
const PIXEL_ICON: Record<string, string> = {
  build: "blocks", security: "shield", agent: "bot", play: "play", live: "pulse", arena: "bolt", league: "pulse",
  money: "coin", command: "bot", info: "doc", token: "coin", swap: "swap", stake: "stake", frogs: "bot",
  market: "market", crew: "blocks", sniper: "pulse", mcp: "link", companies: "blocks", key: "lock",
  founder: "blocks", guide: "doc", missions: "pulse", forge: "bolt", story: "doc", tokenomics: "coin",
  way: "grid", pulse: "pulse", wallet: "wallet",
};
const pixel = (name: string) => PIXEL_ICON[name] ?? "blocks";

/** The page tabs of one door. */
export function SxSectionBar({ room, path }: { room: RoomId; path: string }) {
  const r = ROOMS[room];
  return (
    <nav className="px-strip" aria-label={`${r.name} pages`} style={{ "--acc": r.accent } as CSSProperties}>
      <div className="px-strip-in">
        {r.nav.map((n) => (
          <Link key={n.to} to={n.to} className={isOn(path, n.to) ? "on" : ""}>
            <PxIcon name={pixel(n.icon)} size={12} /><span>{n.label}</span>
          </Link>
        ))}
        <Link to="/new" className="px-strip-all">ALL SECTIONS</Link>
      </div>
    </nav>
  );
}

/** Phones: five places worth a thumb. */
export function SxTabs({ room }: { room: RoomId | null }) {
  const tab = (to: string, label: string, icon: string, on: boolean) => (
    <a href={to} className={on ? "on" : ""} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(to); }}>
      <PxIcon name={icon} size={17} /><span>{label}</span>
    </a>
  );
  return (
    <nav className="px-tabs" aria-label="NIGHTSHIFT">
      {tab("/", "HOME", "grid", room === null)}
      {tab("/companies", "BUILD", "blocks", room === "geek")}
      {tab("/token", "$SHIFT", "coin", room === "info")}
      {tab("/games", "PLAY", "play", room === "breakroom")}
      {tab("/my", "DESK", "wallet", false)}
    </nav>
  );
}

/** The footer: the whole protocol, four columns, one honest line. */
export function SxFooter() {
  const cols: { name: string; links: { to: string; label: string }[] }[] = [
    { name: "BUILD", links: [{ to: "/launch", label: "Start a company" }, { to: "/companies", label: "Browse companies" }, { to: "/my", label: "Owner desk" }, { to: "/market", label: "Marketplace" }, { to: "/crews", label: "Crews" }] },
    { name: "MONEY", links: [{ to: "/token", label: "About $SHIFT" }, { to: "/stake", label: "Stake" }, { to: "/leaderboard", label: "Leaderboard" }, { to: "/swap", label: "Swap" }, { to: "/deals", label: "Token Deals" }, { to: "/tokenomics", label: "Tokenomics" }, { to: "/frogs", label: "NIGHT FROGS" }] },
    { name: "TOOLS / PLAY", links: [{ to: "/services", label: "AI tools" }, { to: "/watchtower", label: "Token monitor" }, { to: "/mind", label: "Research" }, { to: "/mcp", label: "Connect an agent" }, { to: "/games", label: "Games" }, { to: "/arena", label: "Agent Arena" }] },
    { name: "TRUST", links: [{ to: "/proof", label: "Proof & receipts" }, { to: "/security", label: "Safety" }, { to: "/how-it-works", label: "How it works" }, { to: "/whitepaper", label: "Whitepaper" }, { to: "/changelog", label: "Changelog" }, { to: "/terms", label: "Terms & risks" }] },
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
        </nav>
        <span className="px-foot-legal">NOT FINANCIAL ADVICE · CONTRACTS ARE PUBLIC · BUILT BY <a href={DEV_X_URL} target="_blank" rel="noreferrer">@probert_mihai</a></span>
      </div>
    </footer>
  );
}
