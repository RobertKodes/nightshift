import type { CSSProperties } from "react";
import { SECTIONS } from "./sitemap";

/** A drawn, fully navigable station remains visible while WebGL loads or is unavailable. */
export function StationMap({ active, overview, onDock, inactive = false }: { active: number; overview: boolean; onDock: (index: number) => void; inactive?: boolean }) {
  return <div className="pv-map" role="group" aria-label="Station map" aria-hidden={inactive || undefined}>
    <svg viewBox="0 0 500 340" fill="none" aria-hidden="true">
      <ellipse cx="250" cy="173" rx="181" ry="112" fill="#171321" stroke="#74658c" strokeWidth="20" />
      <ellipse cx="250" cy="173" rx="181" ry="112" stroke="#ae88e9" strokeWidth="1.5" />
      <path d="m110 80 280 186M110 266 390 80" stroke="#342c43" strokeWidth="23" />
      <path d="m110 80 280 186M110 266 390 80" stroke="#bd9fe5" strokeWidth="1" />
      <ellipse cx="250" cy="173" rx="48" ry="34" fill="#453351" stroke="#bda2df" strokeWidth="2" />
      <path d="M209 169c2-60 80-60 82 0" fill="#251e35" stroke="#8f74b2" strokeWidth="2" />
      {SECTIONS.map((section, index) => {
        const a = -.5 + index / SECTIONS.length * Math.PI * 2, x = 250 + Math.cos(a) * 181, y = 173 + Math.sin(a) * 112;
        return <g key={section.id}><path d={`M250 173Q250 ${70 + index * 15} ${x} ${y}`} stroke={section.accent} strokeWidth={overview ? 3 : 1} opacity={overview ? .85 : .18} /><rect x={x - 14} y={y - 9} width="28" height="18" rx="4" fill={section.accent} opacity={active === index ? 1 : .5} /></g>;
      })}
    </svg>
    {SECTIONS.map((section, index) => {
      const a = -.5 + index / SECTIONS.length * Math.PI * 2;
      return <button key={section.id} type="button" disabled={inactive} style={{ "--accent": section.accent, left: `${50 + Math.cos(a) * 34}%`, top: `${51 + Math.sin(a) * 34}%` } as CSSProperties} aria-pressed={active === index} onClick={() => onDock(index)}>{section.short}</button>;
    })}
  </div>;
}
