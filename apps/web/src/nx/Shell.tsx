import { useEffect, useState } from "react";
import { short } from "../api";
import { InstallButton } from "../landing/app";
import { BLUESKY_URL, Crescent, DEV_X_URL, NightFrog, OPENSEA_URL, TELEGRAM_URL, X_URL, useSwarm } from "../landing/chrome";
import { Link, go } from "../router";
import { useSession } from "../session";
import { NxIcon } from "./icons";
import { ROOMS, ROOM_ORDER, type RoomId } from "./map";
import "./nx.css";

const KEY = "nx_way";
export function rememberRoom(id: RoomId) { try { localStorage.setItem(KEY, id); } catch { /* private mode */ } }
export function lastRoom(): RoomId | null { try { const v = localStorage.getItem(KEY); return v && v in ROOMS ? (v as RoomId) : null; } catch { return null; } }

const isOn = (path: string, to: string) => path === to || (to !== "/" && path.startsWith(`${to}/`));

/** The station bar: the mark, the five rooms, the swarm's pulse and the wallet. Same on every room. */
export function StationBar({ room, title }: { room: RoomId | null; title?: string }) {
  const swarm = useSwarm();
  const { address, signIn, signOut, busy, error } = useSession();
  return (
    <div className="nx-station">
      <Link to="/" className="nx-mark" aria-label="NIGHTSHIFT: choose your way"><Crescent size={22} /><span>NIGHTSHIFT</span></Link>
      <b className="nx-apptitle" aria-hidden="true">{title ?? "NIGHTSHIFT"}</b>
      <nav className="nx-rooms" aria-label="Rooms">
        <Link to="/" className={room === null ? "on" : ""} style={{ "--acc": "#a48bff" } as React.CSSProperties}><NxIcon name="way" size={15} /><span>Gate</span></Link>
        {ROOM_ORDER.map((id) => (
          <Link key={id} to={ROOMS[id].nav[0]!.to} className={room === id ? "on" : ""} style={{ "--acc": ROOMS[id].accent } as React.CSSProperties}>
            <i className="nx-dot" /><span>{ROOMS[id].name}</span>
          </Link>
        ))}
      </nav>
      <span className="nx-pulse" title="IMD agents online, live from api.imd.fun"><i />{swarm?.n ? swarm.n.toLocaleString("en-US") : "…"}<small>AGENTS ONLINE</small></span>
      {swarm?.mode === "sim" && <span className="nx-sim" title="Simulated swarm and buyers. No IMD or USDC moves.">SIM</span>}
      <InstallButton compact />
      {address ? (
        <span className="nx-acctwrap">
          <Link to="/my" className="nx-acct" aria-label="Your companies"><NxIcon name="wallet" size={15} />{short(address)}</Link>
          <button className="nx-acct nx-acct-out" onClick={() => void signOut()} title="Sign out" aria-label="Sign out"><NxIcon name="close" size={12} /></button>
        </span>
      ) : swarm?.mode === "live" ? (
        <button className="nx-acct" onClick={() => void signIn()} disabled={busy} title={error ?? "Sign in with your wallet"}><NxIcon name="key" size={15} />{busy ? "Check wallet…" : "Sign in"}</button>
      ) : null}
    </div>
  );
}

/** The room's own header: its emblem, its pages and its main action. */
function RoomBar({ room, path }: { room: RoomId; path: string }) {
  const r = ROOMS[room];
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="nx-roombar">
      <Link to={r.nav[0]!.to} className="nx-roomid">
        <img src={r.emblem} alt="" width={40} height={40} />
        <span><small>{r.deck}</small><b>{r.name}</b></span>
      </Link>
      <nav className={`nx-roomnav${open ? " open" : ""}`} aria-label={`${r.name} pages`}>
        {r.nav.map((n) => (
          <Link key={n.to} to={n.to} className={isOn(path, n.to) ? "on" : ""} style={n.room ? ({ "--acc": ROOMS[n.room].accent } as React.CSSProperties) : undefined}>
            <NxIcon name={n.icon} size={16} /><span>{n.label}</span>
          </Link>
        ))}
      </nav>
      {r.cta && <Link to={r.cta.to} className="nx-btn nx-btn-acc nx-roomcta"><NxIcon name={r.cta.icon} size={16} />{r.cta.label}</Link>}
    </div>
  );
}

export function Footer({ room }: { room: RoomId | null }) {
  return (
    <footer className="nx-foot">
      <div className="nx-foot-map">
        {ROOM_ORDER.map((id) => (
          <div key={id} className={room === id ? "here" : ""} style={{ "--acc": ROOMS[id].accent } as React.CSSProperties}>
            <b><i className="nx-dot" />{ROOMS[id].name}</b>
            {ROOMS[id].nav.filter((n) => !n.room).map((n) => <Link key={n.to} to={n.to}>{n.label}</Link>)}
          </div>
        ))}
        <div style={{ "--acc": "#a48bff" } as React.CSSProperties}>
          <b><i className="nx-dot" />Station</b>
          <Link to="/">Choose your way</Link>
          <Link to="/story">The story</Link>
          <Link to="/launch">Launch a company</Link>
          <a href="/llms.txt">llms.txt</a>
          <a href="/imd-status/">IMD status</a>
        </div>
      </div>
      <div className="nx-foot-line">
        <span className="nx-mark"><Crescent size={18} /><span>NIGHTSHIFT</span></span>
        <nav>
          <a href={X_URL} target="_blank" rel="noreferrer">X</a>
          <a href={TELEGRAM_URL} target="_blank" rel="noreferrer">Telegram</a>
          <a href={BLUESKY_URL} target="_blank" rel="noreferrer">Bluesky</a>
          <a href={OPENSEA_URL} target="_blank" rel="noreferrer">OpenSea</a>
          <a href="https://github.com/RobertKodes/nightshift" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <span className="nx-built">Built by <a href={DEV_X_URL} target="_blank" rel="noreferrer">@probert_mihai</a> with the IMD swarm</span>
      </div>
    </footer>
  );
}

/** Phones: the gate and the five rooms, always one tap away. */
export function NxTabs({ room }: { room: RoomId | null }) {
  return (
    <nav className="nx-tabs" aria-label="Station">
      <a href="/" className={room === null ? "on" : ""} style={{ "--acc": "#a48bff" } as React.CSSProperties} onClick={(e) => { e.preventDefault(); go("/"); scrollTo(0, 0); }}><NxIcon name="way" size={21} /><span>Gate</span></a>
      {ROOM_ORDER.map((id) => {
        const r = ROOMS[id];
        return (
          <a key={id} href={r.nav[0]!.to} className={room === id ? "on" : ""} style={{ "--acc": r.accent } as React.CSSProperties} onClick={(e) => { e.preventDefault(); go(r.nav[0]!.to); scrollTo(0, 0); }}>
            <NxIcon name={id === "breakroom" ? "play" : id === "geek" ? "build" : id === "info" ? "info" : id === "economy" ? "money" : "command"} size={21} /><span>{r.short}</span>
          </a>
        );
      })}
    </nav>
  );
}

/** A room of the station: its own header, colours and footer around any page. */
export function RoomShell({ room, path, children }: { room: RoomId; path: string; children: React.ReactNode }) {
  const r = ROOMS[room];
  useEffect(() => rememberRoom(room), [room]);
  // the phone bar names the page, like an app: the menu entry it belongs to, else the room
  const here = [...r.nav].sort((a, b) => b.to.length - a.to.length).find((n) => isOn(path, n.to));
  return (
    <div className="ns ns-app nx-shell" data-room={room} style={{ "--acc": r.accent, "--acc2": r.accent2 } as React.CSSProperties}>
      <div className="nx-backdrop" aria-hidden="true" />
      <header className="nx-head">
        <StationBar room={room} title={here?.label === r.nav[0]!.label ? r.name : here?.label ?? r.name} />
        <RoomBar room={room} path={path} />
      </header>
      <main>{children}</main>
      <Footer room={room} />
      <NightFrog />
      <NxTabs room={room} />
    </div>
  );
}
