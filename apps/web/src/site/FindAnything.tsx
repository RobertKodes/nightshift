import { useEffect, useRef, useState, type CSSProperties } from "react";
import { go } from "../router";
import { itemPath, SEARCH_ITEMS, SECTIONS } from "./sitemap";
import { SectionIcon } from "./SectionIcon";

/** Native modal focus containment, with a searchable keyboard list of the whole site. */
export function FindAnything({ open, close }: { open: boolean; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(""), [selected, setSelected] = useState(0);
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const results = SEARCH_ITEMS.filter((entry) => words.every((word) => entry.search.includes(word)));
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    setQuery(""); setSelected(0); dialog.current?.showModal(); input.current?.focus();
    return () => { dialog.current?.close(); document.documentElement.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`pv-result-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [selected, open]);
  const navigate = (path: string) => { close(); if (path.startsWith("/new")) go(path); else location.assign(path); };
  return <dialog ref={dialog} className="pv-find" aria-labelledby="pv-find-title" onCancel={(event) => { event.preventDefault(); close(); }} onClose={close}>
    <div className="pv-find-top"><h2 id="pv-find-title">Find anything</h2><button className="pv-icon-button" type="button" onClick={close} aria-label="Close search"><SectionIcon id="close" /></button></div>
    <div className="pv-find-input"><SectionIcon id="search" /><input ref={input} type="search" placeholder="Company, game, tool, or question" value={query} role="combobox" aria-label="Search the whole site" aria-autocomplete="list" aria-expanded="true" aria-controls="pv-results" aria-activedescendant={results.length ? `pv-result-${selected}` : undefined} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={(event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelected((n) => results.length ? (n + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length : 0); }
      if (event.key === "Enter" && results[selected]) { event.preventDefault(); navigate(itemPath(results[selected]!.item)); }
    }} /></div>
    <p className="pv-find-count" role="status">{results.length ? `${results.length} places` : "No matches. Try a game, company, or tool name."}</p>
    <div id="pv-results" role="listbox" aria-label="Pages" className="pv-results">
      {SECTIONS.map((section) => {
        const entries = results.filter((entry) => entry.section.id === section.id);
        if (!entries.length) return null;
        return <div key={section.id} role="group" aria-labelledby={`pv-group-${section.id}`}>
          <h3 id={`pv-group-${section.id}`} style={{ "--accent": section.accent } as CSSProperties}><SectionIcon id={section.id} />{section.name}</h3>
          {entries.map(({ item }) => {
            const index = results.findIndex((entry) => entry.item === item);
            return <a key={item.path} id={`pv-result-${index}`} href={itemPath(item)} role="option" aria-selected={selected === index} tabIndex={-1} onMouseMove={() => setSelected(index)} onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(itemPath(item)); } }}>
              <span><b>{item.title}</b><span>{item.line}</span></span><span className="pv-result-wallet">{item.wallet === "required" ? "Wallet needed" : item.wallet === "none" ? "No wallet needed" : "Wallet optional"}</span><SectionIcon id="arrow" />
            </a>;
          })}
        </div>;
      })}
    </div>
    <p className="pv-find-help">Type to filter. Arrow keys to choose. Enter to open. Esc to close.</p>
  </dialog>;
}
