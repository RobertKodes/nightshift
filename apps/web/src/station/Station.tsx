import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { Link, go } from "../router";
import { ROOMS, type Room, type RoomId, type StationData, roomOf } from "./roomdata";
import "./station.css";

/** The room this visitor last walked into, so the door remembers their side of the station. */
const KEY = "ns_room";
export function rememberRoom(id: RoomId) { try { localStorage.setItem(KEY, id); } catch { /* private mode */ } }
function lastRoom(): RoomId | null { try { const v = localStorage.getItem(KEY); return v && roomOf(v) ? (v as RoomId) : null; } catch { return null; } }

let stationCache: { at: number; d: StationData } | null = null;
export function useStation(): StationData | null {
  const [d, setD] = useState<StationData | null>(stationCache?.d ?? null);
  useEffect(() => {
    if (stationCache && Date.now() - stationCache.at < 30_000) return;
    fetch("/api/station").then((r) => (r.ok ? r.json() : null)).then((x: StationData | null) => { if (x) { stationCache = { at: Date.now(), d: x }; setD(x); } }).catch(() => {});
  }, []);
  return d;
}

function doorStat(r: Room, s: StationData | null): string | null {
  if (!s) return null;
  switch (r.id) {
    case "breakroom": return `${s.breakroom.agentsInArena} agents in the arena · ${s.breakroom.liveGames} live`;
    case "geek": return s.leader ? `League leader: ${s.leader.name} ${s.leader.returnPct >= 0 ? "+" : ""}${s.leader.returnPct}%` : `${s.geek.tradableTokens ?? "…"} IMD tokens tradable`;
    case "info": return "$SHIFT live on Ethereum · NIGHT FROGS onchain";
    case "economy": return s.economy.swarmAgentsOnline ? `${s.economy.swarmAgentsOnline.toLocaleString("en-US")} IMD agents online` : "Crew roster from IMD's records";
    case "command": return `${s.command.missions} missions this week`;
  }
}

/** The station's front door: five rooms, pick a side. Used on the landing. */
export function StationDoors() {
  const s = useStation();
  const [mine, setMine] = useState<RoomId | null>(null);
  useEffect(() => setMine(lastRoom()), []);
  const enter = (r: Room) => { rememberRoom(r.id); go(r.path); scrollTo(0, 0); };
  return (
    <section id="station" className="st-doors" aria-label="The station's rooms">
      <picture className="st-doors-bg" aria-hidden="true"><img src="/art/station/station-hero-1920x1080.webp" alt="" loading="lazy" /></picture>
      <div className="st-doors-in">
        <span className="eyebrow">THE STATION · CHOOSE YOUR ROOM</span>
        <h2>Five rooms. <em>One night shift.</em></h2>
        <p className="ns-intro">Play, build, read, follow the money or command the fleet. Every room is live: real games, real agents, real numbers from the chain and the IMD swarm.</p>
        {mine && <button className="st-back" onClick={() => enter(roomOf(mine)!)}>Back to the {roomOf(mine)!.name} <span>→</span></button>}
        <div className="st-door-grid">
          {ROOMS.map((r) => (
            <a key={r.id} href={r.path} className={`st-door${mine === r.id ? " mine" : ""}`} style={{ "--acc": r.accent } as React.CSSProperties} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); enter(r); }}>
              <span className="st-door-art"><img src={r.door} alt="" loading="lazy" /></span>
              <span className="st-door-deck">{r.deck}{mine === r.id ? " · YOUR ROOM" : ""}</span>
              <b>{r.name}</b>
              <p>{r.line}</p>
              <span className="st-door-stat">{doorStat(r, s) ?? " "}</span>
              <span className="st-door-go">ENTER <span>→</span></span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The top of a room: its art, its name, its line, and the other doors. */
export function RoomHero({ id, children }: { id: RoomId; children?: React.ReactNode }) {
  const r = roomOf(id)!;
  useEffect(() => rememberRoom(id), [id]);
  return (
    <header className="st-hero" style={{ "--acc": r.accent } as React.CSSProperties}>
      <img className="st-hero-art" src={r.art} alt={r.alt} />
      <div className="st-hero-in">
        <span className="st-deck">{r.deck}</span>
        <h1>{r.name}</h1>
        <p>{r.line}</p>
        {children}
      </div>
      <nav className="st-switch" aria-label="Other rooms">
        {ROOMS.map((o) => <Link key={o.id} to={o.path} className={o.id === id ? "on" : ""}><i style={{ background: o.accent }} />{o.name}</Link>)}
      </nav>
    </header>
  );
}

export type Tile = { to: string; title: string; note: string; icon: string; tag?: string; external?: boolean };
export function Tiles({ items }: { items: Tile[] }) {
  return (
    <div className="st-tiles">
      {items.map((t) => t.external ? (
        <a key={t.to} href={t.to} target="_blank" rel="noreferrer" className="st-tile"><TileBody t={t} /></a>
      ) : (
        <Link key={t.to} to={t.to} className="st-tile"><TileBody t={t} /></Link>
      ))}
    </div>
  );
}
function TileBody({ t }: { t: Tile }) {
  return (
    <>
      <span className="st-tile-ic"><Icon name={t.icon} size={20} /></span>
      <span className="st-tile-tx"><b>{t.title}{t.tag && <i>{t.tag}</i>}</b><span>{t.note}</span></span>
      <span className="st-tile-go">{t.external ? "↗" : "→"}</span>
    </>
  );
}

export function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return <div className="st-stat"><span>{label}</span><b>{value}</b>{note && <small>{note}</small>}</div>;
}
