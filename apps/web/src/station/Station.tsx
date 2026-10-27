import { WAYS } from "../nx/map";
import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { Link } from "../router";
import { ROOMS, type RoomId, type StationData, roomOf } from "./roomdata";
import "./station.css";

/** The room this visitor last walked into, so the door remembers their side of the station. */
const KEY = "ns_room";
export function rememberRoom(id: RoomId) { try { localStorage.setItem(KEY, id); } catch { /* private mode */ } }

let stationCache: { at: number; d: StationData } | null = null;
export function useStation(): StationData | null {
  const [d, setD] = useState<StationData | null>(stationCache?.d ?? null);
  useEffect(() => {
    if (stationCache && Date.now() - stationCache.at < 30_000) return;
    fetch("/api/station").then((r) => (r.ok ? r.json() : null)).then((x: StationData | null) => { if (x) { stationCache = { at: Date.now(), d: x }; setD(x); } }).catch(() => {});
  }, []);
  return d;
}

/** The same three doors on the story page. */
export function StationDoors() {
  return <section id="station" className="st-doors" aria-label="Three doors">
    <picture className="st-doors-bg" aria-hidden="true"><img src="/art/station/station-hero-1920x1080.webp" alt="" loading="lazy" /></picture>
    <div className="st-doors-in"><span className="eyebrow">NIGHTSHIFT</span><h2>Three doors. <em>One night shift.</em></h2><p className="ns-intro">Choose what you want to do. <Link to="/how-it-works">See how it works →</Link></p>
      <div className="st-door-grid">{WAYS.map((way) => <Link key={way.key} to={way.to} className="st-door" style={{ "--acc": way.accent } as React.CSSProperties}><span className="st-door-art"><img src={way.emblem} alt="" loading="lazy" /></span><b>{way.title}</b><p>{way.line}</p><span className="st-door-go">OPEN →</span></Link>)}</div>
    </div>
  </section>;
}

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
      <nav className="st-switch" aria-label="Three doors">
        {ROOMS.filter((o) => ["geek", "breakroom", "info"].includes(o.id)).map((o) => <Link key={o.id} to={o.path} className={o.id === id ? "on" : ""}><i style={{ background: o.accent }} />{o.name}</Link>)}
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
