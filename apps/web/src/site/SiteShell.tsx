import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useSession } from "../session";
import { FindAnything } from "./FindAnything";
import { PreviewLink } from "./PreviewLink";
import { SECTIONS, sectionPath, type SectionId } from "./sitemap";
import { SectionIcon } from "./SectionIcon";

/** Only preview pages mount this shell; the existing site's navigation is untouched. */
export function SiteShell({ active, children }: { active?: SectionId; children: ReactNode }) {
  const [search, setSearch] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const { address, busy, error, signIn, signOut } = useSession();
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
      if ((event.key === "/" && !editing && !event.ctrlKey && !event.metaKey) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")) { event.preventDefault(); setSearch(true); }
    };
    addEventListener("keydown", shortcut); return () => removeEventListener("keydown", shortcut);
  }, []);
  return <div className="pv" data-keyboard={keyboard} onPointerDownCapture={() => setKeyboard(false)} onKeyDownCapture={(event) => {
    if (["Tab", "Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) setKeyboard(true);
  }}>
    <a className="pv-skip" href="#pv-main">Skip to content</a>
    <header className="pv-header">
      <PreviewLink className="pv-logo" href="/new" aria-label="NIGHTSHIFT preview home"><img src="/brand/nightshift-mark.svg" width="26" height="26" alt="" /><span>NIGHTSHIFT</span></PreviewLink>
      <button type="button" className="pv-find-button" onClick={() => setSearch(true)} aria-haspopup="dialog"><SectionIcon id="search" /><span>Find anything</span><kbd>/</kbd></button>
      {address ? <details className="pv-wallet"><summary aria-label="Wallet account">{address.slice(0, 5)}…{address.slice(-3)}</summary><div><a href="/my">My owner desk</a><button type="button" onClick={() => void signOut()}>Disconnect wallet</button></div></details> : <button type="button" className="pv-wallet-button" disabled={busy} onClick={() => void signIn()} aria-label="Connect a wallet">{busy ? "Connecting…" : "Wallet"}</button>}
    </header>
    {error && <p className="pv-wallet-error" role="status">{error}</p>}
    <nav className="pv-bar" aria-label="Station sections">{SECTIONS.map((section) => <PreviewLink key={section.id} href={sectionPath(section)} style={{ "--accent": section.accent } as CSSProperties} aria-current={active === section.id ? "page" : undefined}><SectionIcon id={section.id} /><span>{section.short}</span></PreviewLink>)}</nav>
    {children}
    <footer className="pv-footer"><PreviewLink className="pv-footer-brand" href="/new">NIGHTSHIFT</PreviewLink><nav aria-label="All six sections">{SECTIONS.map((section) => <PreviewLink key={section.id} href={sectionPath(section)}>{section.name}</PreviewLink>)}</nav><p className="pv-earth-credit">Earth imagery: NASA Earth Observatory, Black Marble 2016</p></footer>
    <FindAnything open={search} close={() => setSearch(false)} />
  </div>;
}
