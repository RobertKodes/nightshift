import { useEffect, useRef, useState } from "react";
import { FORGE, NIGHT_FROGS } from "../ship/types";
import { SectionIcon } from "../site/SectionIcon";
import type { Entry } from "./data";

const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
/** The close event of a remount (development double effects) arrives after the dialog reopened; only a dialog that stayed closed closes the record. */
export function DeckDetails({ entry, close }: { entry: Entry; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), [artFailed, setArtFailed] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.documentElement.style.overflow; document.documentElement.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => { dialog.current?.close(); document.documentElement.style.overflow = overflow; if (previous?.isConnected) previous.focus({ preventScroll: true }); else document.querySelector<HTMLElement>(".pv-deck h1")?.focus({ preventScroll: true }); };
  }, []);
  const f = entry.frog, w = entry.watcher, contract = f ? NIGHT_FROGS : FORGE, id = f?.id ?? w?.n;
  return <dialog ref={dialog} className="pv-deck-detail" aria-labelledby="pv-deck-detail-title" onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => { if (!dialog.current?.open) close(); }}>
    <button className="pv-icon-button pv-deck-close" type="button" onClick={close} aria-label="Close details" autoFocus><SectionIcon id="close" /></button>
    <div className="pv-deck-detail-heading">{entry.art && !artFailed && <img src={entry.art} alt={`${entry.title}, onchain art`} width="112" height="112" onError={() => setArtFailed(true)} />}
      <div><p className="pv-kicker">{entry.kind === "frog" ? "NIGHT FROGS / GEN 1" : entry.kind === "watcher" ? "NIGHT WATCHERS / GEN 2" : entry.kind === "company" ? "COMPANY / LIVE TASK" : "GAMES / LIVE TABLE"}</p><h2 id="pv-deck-detail-title">{entry.title}</h2>{entry.mine && <p className="pv-deck-owned">{entry.kind === "company" ? "Your company" : "Your crew"}</p>}</div>
    </div>
    {artFailed && <p className="pv-deck-note">Onchain art is currently unavailable.</p>}
    <p className="pv-deck-activity">{entry.activity}</p>
    {f && <dl className="pv-deck-facts"><div><dt>Hours / hour</dt><dd>{number(f.rate)}</dd></div><div><dt>Base multiplier</dt><dd>{number(f.base)}x</dd></div><div><dt>Crew boost</dt><dd>{f.boost}%</dd></div>{entry.rarity && <div><dt>Rarity / rank</dt><dd>{entry.rarity} / {entry.rank}</dd></div>}{entry.points !== undefined && <div><dt>Forge points</dt><dd>{number(entry.points)}</dd></div>}<div><dt>Mission</dt><dd>{f.mission ? `${f.mission.title} / ${f.mission.done ? "complete" : "in progress"}` : "None this week"}</dd></div></dl>}
    {f?.mission && <p className="pv-deck-note">Started {new Date(f.mission.since).toLocaleString()}. <a href="/command">Mission control</a></p>}
    {w && <><dl className="pv-deck-facts"><div><dt>Tier</dt><dd>{w.tierName}</dd></div><div><dt>Hours / hour</dt><dd>{number(w.rate)}</dd></div><div><dt>Multiplier</dt><dd>{number(w.base)}x</dd></div><div><dt>Crew boost</dt><dd>{w.crew}%</dd></div><div><dt>Company slots</dt><dd>{w.slots}</dd></div><div><dt>Forge points</dt><dd>{number(w.points)}</dd></div></dl>
      {w.name && <p className="pv-deck-note">Name: {w.name}</p>}{w.missions.length > 0 && <p className="pv-deck-note">Missions: {w.missions.map((m) => `${m.title}${m.done ? " (complete)" : ""}`).join(", ")}</p>}
      <p className="pv-deck-note">Forged from {w.inputs.map((n) => `#${n}`).join(", ")}.</p><a className="pv-everything" href="/watch">Night Watch details<SectionIcon id="arrow" /></a></>}
    {entry.rule && <p className="pv-deck-note">Station assignment: {entry.rule}.</p>}
    {!!entry.traits?.length && <dl className="pv-deck-traits">{entry.traits.map((trait) => <div key={trait.name}><dt>{trait.name}</dt><dd>{trait.value}{trait.count !== undefined && <small>{trait.count} of 500</small>}</dd></div>)}</dl>}
    {entry.owner && <p className="pv-deck-note">Holder: <a href={`https://etherscan.io/address/${encodeURIComponent(entry.owner)}`} target="_blank" rel="noreferrer">{entry.owner.slice(0, 8)}...{entry.owner.slice(-6)}</a></p>}
    {id !== undefined && <div className="pv-deck-links"><a className="pv-button" href="/forge">Upgrade Frogs</a><a className="pv-button" href={`https://etherscan.io/nft/${contract}/${id}`} target="_blank" rel="noreferrer">Onchain record<SectionIcon id="arrow" /></a></div>}
    {entry.company && <><p className="pv-deck-note">Task status: {entry.company.working?.status ?? "Working"}. Console operators represent company activity; this feed does not assign tasks to individual NFTs.</p><a className="pv-button" href={`/c/${encodeURIComponent(entry.company.slug)}`}>Company page<SectionIcon id="arrow" /></a></>}
    {entry.game && <><p className="pv-deck-note">{entry.game.house ? "House exhibition." : "Live game."} {typeof entry.game.viewers === "number" && `${number(entry.game.viewers)} watching.`}</p><a className="pv-button" href={entry.game.watch}>Watch this game<SectionIcon id="arrow" /></a></>}
  </dialog>;
}

