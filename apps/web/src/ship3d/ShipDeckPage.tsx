import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "../session";
import { PreviewLink } from "../site/PreviewLink";
import { SectionIcon } from "../site/SectionIcon";
import { useReducedMotion } from "../site/StationView";
import { BAYS, useDeckData, type Bay } from "./data";
import { DeckView } from "./DeckView";
import { DeckDetails } from "./Details";
import "./deck.css";

/** Hidden preview only. Every scene interaction has an equivalent live-list button. */
export function ShipDeckPage() {
  const { address, signIn, busy } = useSession(), reduced = useReducedMotion();
  const [bay, setBay] = useState<Bay>(0), [selected, setSelected] = useState<string | null>(null), [paused, setPaused] = useState(false);
  const [list, setList] = useState(false), [unavailable, setUnavailable] = useState(false), [query, setQuery] = useState(""), [mine, setMine] = useState(false), [limit, setLimit] = useState(48);
  const data = useDeckData(address?.toLowerCase() ?? null);
  const entries = data.entries, picked = entries.find((e) => e.key === selected);
  const sceneEntries = useMemo(() => mine ? entries.filter((e) => e.mine) : entries, [entries, mine]);
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return entries.filter((e) => (!mine || e.mine) && (term ? `${e.title} ${e.activity} ${e.key} ${BAYS[e.bay].name}`.toLowerCase().includes(term) : e.bay === bay)).sort((a, b) => Number(b.mine) - Number(a.mine) || a.title.localeCompare(b.title, undefined, { numeric: true }));
  }, [entries, bay, query, mine]);
  const open = useCallback((key: string) => { const entry = entries.find((e) => e.key === key); if (entry) { setBay(entry.bay); setSelected(key); } }, [entries]);
  const changeBay = (next: number) => { setBay(Math.max(0, Math.min(3, next)) as Bay); setSelected(null); setQuery(""); };
  useEffect(() => { document.title = "Operations deck | NIGHTSHIFT Preview"; document.querySelector<HTMLElement>(".pv-deck h1")?.focus({ preventScroll: true }); }, []);
  useEffect(() => { setLimit(48); }, [bay, query, mine]);
  useEffect(() => { if (!address) setMine(false); }, [address]);
  const failures = [data.ship.state === "unavailable" && "Crew", data.art.state === "unavailable" && "Art records", data.companies.state === "unavailable" && "Companies", data.games.state === "unavailable" && "Games", address && data.crew.state === "unavailable" && "Wallet crew"].filter(Boolean);
  const available = [data.ship, data.companies, data.games].some((source) => source.state === "ready");
  return <main id="pv-main" className="pv-deck">
    <header className="pv-deck-heading"><p className="pv-kicker"><PreviewLink href="/new/frogs">FROGS</PreviewLink> / OPERATIONS DECK</p><h1 tabIndex={-1}>The crew at work.</h1><p>Missions, company tasks, live games and the Night Watch.</p></header>
    <div className="pv-deck-tools"><div className="pv-deck-mode" role="group" aria-label="Deck view"><button type="button" className="pv-button" aria-pressed={!list} disabled={unavailable} onClick={() => setList(false)}>3D deck</button><button type="button" className="pv-button" aria-pressed={list || unavailable} onClick={() => setList(true)}>Live list</button></div>
      {address ? <button type="button" className="pv-button" aria-pressed={mine} onClick={() => setMine((value) => !value)}>My crew only</button> : <button type="button" className="pv-button" disabled={busy} onClick={() => void signIn()}>Connect wallet</button>}
      {!list && !unavailable && !reduced && <button type="button" className="pv-button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? "Resume motion" : "Pause motion"}</button>}
    </div>
    <nav className="pv-chips pv-deck-chips" aria-label="Choose a bay">{BAYS.map((item, index) => <button key={item.id} type="button" aria-current={bay === index ? "step" : undefined} onClick={() => changeBay(index)}>{item.name}</button>)}</nav>
    {!list && !unavailable && <DeckView bay={bay} entries={sceneEntries} selected={selected} paused={paused} reduced={reduced} onPick={open} onUnavailable={() => setUnavailable(true)} />}
    {unavailable && <p className="pv-deck-note" role="status">3D is unavailable on this device. The live list shows the same crew and activity.</p>}
    <div className="pv-deck-tour"><button type="button" className="pv-button" disabled={bay === 0} onClick={() => changeBay(bay - 1)}>Back</button><p aria-live="polite">{bay + 1} of {BAYS.length}<span>{BAYS[bay].name}</span></p><button type="button" className="pv-button" disabled={bay === 3} onClick={() => changeBay(bay + 1)}>Next<SectionIcon id="arrow" /></button></div>
    <div className="pv-deck-status" role="status">{data.ship.state === "ready" && <span>Snapshot {new Date(data.ship.data.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}{failures.length > 0 && <span>{failures.join(", ")} unavailable; retrying.</span>}{!available && !failures.length && <span>Reading live station data...</span>}</div>
    <section className="pv-deck-directory" aria-labelledby="pv-deck-list-title"><div className="pv-deck-list-head"><h2 id="pv-deck-list-title">{query ? "Search results" : BAYS[bay].name}</h2><label><span className="pv-sr">Search all bays, crew and activity</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a Frog, watcher, company or game" /></label></div>
      <p className="pv-deck-note">{BAYS[bay].line} {available && `${rows.length.toLocaleString()} records.`} {address && "Your crew are marked in violet."}</p>
      <div className="pv-deck-list">{rows.slice(0, limit).map((entry) => <button type="button" key={entry.key} className="pv-deck-row" data-mine={entry.mine} onClick={() => open(entry.key)}>
        <span className="pv-deck-row-kind">{entry.kind === "frog" ? `NF ${entry.frog!.id}` : entry.kind === "watcher" ? `NW ${entry.watcher!.n}` : entry.kind === "company" ? "TASK" : "GAME"}</span><span><b>{entry.title}</b><small>{entry.activity}</small></span>{entry.mine && <span className="pv-deck-owned">Yours</span>}<SectionIcon id="arrow" />
      </button>)}</div>
      {available && !rows.length && <p className="pv-deck-note">{mine ? "No matching crew or company records for this wallet." : query ? "No matches in the loaded data." : "No records in the loaded data for this bay."}</p>}
      {rows.length > limit && <button type="button" className="pv-button" onClick={() => setLimit((n) => n + 48)}>Show more records ({rows.length - limit} remaining)</button>}
    </section>
    {picked && <DeckDetails key={picked.key} entry={picked} close={() => setSelected(null)} />}
  </main>;
}

