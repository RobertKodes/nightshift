import { useRef, type CSSProperties } from "react";
import { go } from "../router";
import type { FlightInput } from "../station3d/stops";
import { itemPath, SECTIONS, sectionPath, type SiteItem, type SiteSection } from "./sitemap";
import { StationView, useReducedMotion } from "./StationView";
import { SectionIcon } from "./SectionIcon";

function ItemCard({ item }: { item: SiteItem }) {
  return <a className="pv-item" href={itemPath(item)}>
    <div className="pv-item-heading"><h3>{item.title}</h3><SectionIcon id="arrow" /></div>
    <p>{item.line}</p>
    <span className="pv-item-wallet">{item.wallet === "none" ? "No wallet needed" : item.wallet === "required" ? "Wallet needed" : "Wallet optional"}</span>
  </a>;
}

/** A still dock portrait and a complete directory, using the same scene and route data. */
export function SectionHub({ section }: { section: SiteSection }) {
  const active = SECTIONS.indexOf(section), reduced = useReducedMotion();
  const input = useRef<FlightInput>({ progress: active + 1, pointerX: 0, pointerY: 0, panelTop: .9, header: true });
  const groups = section.items.length > 6 ? [...new Set(section.items.map((item) => item.group ?? "More"))] : [];
  return <main id="pv-main" className="pv-hub" style={{ "--accent": section.accent } as CSSProperties}>
    <header className="pv-hub-heading"><p className="pv-kicker">NIGHTSHIFT / <span>{section.name}</span></p><h1 tabIndex={-1}>{section.id === "frogs" && <img className="pv-frog-thumb" src="/frogs/frog-001.webp" alt="NIGHT FROG #1" width="52" height="52" />}{section.name}</h1><p>{section.line}</p></header>
    <div className="pv-hub-scene"><StationView input={input.current} active={active} reduced={reduced} onDemand onDock={(index) => go(sectionPath(SECTIONS[index]!))} /></div>
    <section className="pv-directory" aria-label={`Everything in ${section.name}`}>
      {groups.length ? groups.map((group, index) => <section className="pv-item-group" key={group} aria-labelledby={`pv-hub-group-${index}`}>
        <h2 id={`pv-hub-group-${index}`}>{group}</h2>
        <div className="pv-item-grid">{section.items.filter((item) => (item.group ?? "More") === group).map((item) => <ItemCard item={item} key={item.path} />)}</div>
      </section>) : <><h2 className="pv-sr">Everything in {section.name}</h2><div className="pv-item-grid">{section.items.map((item) => <ItemCard item={item} key={item.path} />)}</div></>}
    </section>
  </main>;
}
