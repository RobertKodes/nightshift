import { useEffect, useState, type ReactNode } from "react";
import DotGrid from "../../rb/DotGrid";
import StarBorder from "../../rb/StarBorder";
import { go } from "../../router";
import { PxIcon } from "../PxIcon";
import "./learn.css";

/**
 * The learn, trust and docs pages' few shared parts (see learn.css): when decoration may run, a
 * contents rail that follows the reader, the hero's dot grid and the one starred call to action. Pages: start, guide, how it works,
 * whitepaper, changelog, security, terms, privacy, delete account, the index, setup.
 */

/** Decoration that moves runs on wide screens only, never with reduced motion or the lite mode. */
export function useRich(): boolean {
  const [rich, setRich] = useState(false);
  useEffect(() => {
    const wide = matchMedia("(min-width: 900px)");
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setRich(wide.matches && !still.matches && !document.documentElement.hasAttribute("data-lite"));
    sync();
    wide.addEventListener("change", sync);
    still.addEventListener("change", sync);
    return () => { wide.removeEventListener("change", sync); still.removeEventListener("change", sync); };
  }, []);
  return rich;
}

/** The section in view, by id: the one crossing the upper part of the screen. */
export function useSpy(ids: string[]): string {
  const [on, setOn] = useState(ids[0] ?? "");
  const key = ids.join("|");
  useEffect(() => {
    const seen = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) setOn(e.target.id); }, { rootMargin: "-20% 0px -70% 0px" });
    for (const id of ids) { const el = document.getElementById(id); if (el) seen.observe(el); }
    return () => seen.disconnect();
    // the ids are read through their joined key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return on;
}

/** A sticky contents rail: numbered pixel labels, the section in view lit. */
export function LxToc({ items, title = "ON THIS PAGE", className = "", numbered = true }: { items: { id: string; label: string }[]; title?: string; className?: string; numbered?: boolean }) {
  const on = useSpy(items.map((i) => i.id));
  return (
    <nav className={`lx-toc ${className}`.trim()} aria-label="Contents">
      <b><span>{title}</span><span>{String(items.length).padStart(2, "0")}</span></b>
      {items.map((t, i) => (
        <a key={t.id} href={`#${t.id}`} className={on === t.id ? "on" : ""} aria-current={on === t.id ? "location" : undefined}>
          {numbered && <i aria-hidden="true">{String(i + 1).padStart(2, "0")}</i>}<span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

/** The hero's background: a lime dot grid that leans toward the pointer (one WebGL canvas). Wide screens only. */
export function LxBg({ rich, tone = "lime" }: { rich: boolean; tone?: "lime" | "imd" }) {
  if (!rich) return null;
  return tone === "imd"
    ? <DotGrid dotSize={3} gap={18} baseColor="#14305e" activeColor="#2f7bff" proximity={120} shockRadius={180} shockStrength={4} shape="square" glow={0.35} clickShock />
    : <DotGrid dotSize={3} gap={20} baseColor="#15241a" activeColor="#b8ff3d" proximity={120} shockRadius={180} shockStrength={4} shape="square" glow={0.3} clickShock />;
}

/** The page's one starred call to action: a real link (so the star can measure it) routed in-app. */
export function LxStar({ to, icon, children }: { to: string; icon?: string; children: ReactNode }) {
  return (
    <StarBorder as="a" href={to} onClick={(e: React.MouseEvent<HTMLAnchorElement>) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(to); }}
      className="lx-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)">
      {icon && <PxIcon name={icon} size={14} />}{children}
    </StarBorder>
  );
}
