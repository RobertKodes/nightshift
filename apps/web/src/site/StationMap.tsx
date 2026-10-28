import type { CSSProperties } from "react";
import { SECTIONS } from "./sitemap";

/** Technical station plan remains navigable during loading and without WebGL. */
export function StationMap({ active, overview, onDock, inactive = false }: { active: number; overview: boolean; onDock: (index: number) => void; inactive?: boolean }) {
  return <div className="pv-map" role="group" aria-label="Station map" aria-hidden={inactive || undefined}>
    <div className="pv-map-plan"><svg viewBox="0 0 500 340" fill="none" aria-hidden="true">
      <g stroke="#56616e" strokeWidth="1">
        <path d="M40 158h420M40 176h420M50 158l18 18 18-18 18 18 18-18 18 18 18-18 18 18 18-18 18 18 18-18 18 18 18-18 18 18 18-18 18 18 18-18 18 18 18-18 18 18" />
        {[25, 425].map((x) => <g key={x}><rect x={x} y="62" width="50" height="210" fill="#0d131c" /><path d={`M${x + 25} 62v210`} />{Array.from({ length: 14 }, (_, i) => <path key={i} d={`M${x} ${62 + i * 15}h50`} />)}</g>)}
        <ellipse cx="250" cy="173" rx="128" ry="72" /><ellipse cx="250" cy="173" rx="119" ry="65" />
        <path d="m250 151-19 11v22l19 11 19-11v-22Zm0-22v-28m-17 16h34M250 195v48M231 173H122m147 0h109" />
        <path d="M188 112h20v54h-20Zm104 0h20v54h-20ZM193 112v54m5-54v54m5-54v54m94-54v54m5-54v54m5-54v54" />
      </g>
      {SECTIONS.map((section, index) => {
        const a = -.5 + index / SECTIONS.length * Math.PI * 2, x = 250 + Math.cos(a) * 137, y = 173 + Math.sin(a) * 78;
        return <g key={section.id}>
          <path d={`M250 173  ${x} ${y}`} stroke="#616c7c" strokeWidth=".75" strokeDasharray={overview ? "3 4" : undefined} opacity={overview ? .8 : .3} />
          <path d={`M${x - 16} ${y - 10}h32l5 5v10l-5 5h-32l-5-5v-10Z`} fill="#11161d" stroke="#8a95a2" />
          <path d={`M${x - 11} ${y - 10}h22`} stroke={section.accent} strokeWidth="2" />
        </g>;
      })}
      <g stroke="#697687" strokeWidth=".5"><path d="M100 295h300m-300-5v10m300-10v10M250 283v24" /></g>
      <text x="250" y="325" fill="#929eae" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="9" letterSpacing="2">ORBITAL STATION / SCHEMATIC</text>
    </svg>
    {SECTIONS.map((section, index) => {
      const a = -.5 + index / SECTIONS.length * Math.PI * 2;
      return <button key={section.id} type="button" disabled={inactive} style={{ "--accent": section.accent, left: `${50 + Math.cos(a) * 27.4}%`, top: `${50.9 + Math.sin(a) * 22.94}%` } as CSSProperties} aria-label={`Select ${section.name}`} aria-pressed={active === index} onClick={() => onDock(index)}><span>{String(index + 1).padStart(2, "0")}</span>{active === index && <b>{section.name}</b>}</button>;
    })}</div>
  </div>;
}
