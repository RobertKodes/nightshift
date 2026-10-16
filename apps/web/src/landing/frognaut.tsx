import { useState } from "react";

const LINES = [
  "Houston, the swarm shipped again.",
  "gm from orbit. Your company is still working.",
  "Floating. Building. Never sleeping.",
  "One small hop for a frog, one big shift for IMD.",
  "I checked the budget from up here. Still safe.",
  "Every $SHIFT trade goes through IMD. Ribbit.",
];

/**
 * The frog in a NIGHTSHIFT space suit, drifting by the megastructure: IMD's mascot, our night-shift
 * astronaut. Click him and he radios in.
 */
export function Frognaut() {
  const [say, setSay] = useState<string | null>(null);
  const [spin, setSpin] = useState(0);
  return (
    <div className="frognaut-wrap">
      {say && <div className="frognaut-say">{say}</div>}
      <button
        className={`frognaut${spin ? " spin" : ""}`}
        key={spin}
        aria-label="The NIGHTSHIFT frog astronaut"
        onClick={() => { setSpin((s) => s + 1); setSay((c) => { const p = LINES.filter((l) => l !== c); return p[Math.floor(Math.random() * p.length)]!; }); }}
      >
        <svg viewBox="0 0 300 380" aria-hidden="true">
          <defs>
            <linearGradient id="fn-suit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f6f3ff" /><stop offset=".6" stopColor="#cfc6ee" /><stop offset="1" stopColor="#8a7fbf" /></linearGradient>
            <linearGradient id="fn-dark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4a3f86" /><stop offset="1" stopColor="#1b1540" /></linearGradient>
            <radialGradient id="fn-glass" cx="35%" cy="28%" r="80%"><stop offset="0" stopColor="#ffffff" stopOpacity=".42" /><stop offset=".35" stopColor="#c4b4ff" stopOpacity=".12" /><stop offset="1" stopColor="#1a1040" stopOpacity=".55" /></radialGradient>
            <radialGradient id="fn-flame" cx="50%" cy="10%" r="90%"><stop offset="0" stopColor="#fff" /><stop offset=".3" stopColor="#c8ff6a" /><stop offset="1" stopColor="#7c5cff" stopOpacity="0" /></radialGradient>
            <clipPath id="fn-visor"><circle cx="150" cy="118" r="78" /></clipPath>
          </defs>
          {/* thruster */}
          <ellipse className="fn-flame" cx="96" cy="330" rx="16" ry="44" fill="url(#fn-flame)" transform="rotate(28 96 300)" />
          {/* backpack */}
          <rect x="70" y="172" width="70" height="120" rx="18" fill="url(#fn-dark)" stroke="#a48bff" strokeOpacity=".6" strokeWidth="2" transform="rotate(14 105 232)" />
          <rect x="84" y="280" width="26" height="22" rx="5" fill="#2a2160" stroke="#a48bff" strokeOpacity=".5" transform="rotate(14 97 291)" />
          {/* legs, floating bent */}
          <path d="M128 286 C120 318 108 334 92 350" stroke="url(#fn-suit)" strokeWidth="36" strokeLinecap="round" fill="none" />
          <path d="M176 286 C196 306 212 312 232 306" stroke="url(#fn-suit)" strokeWidth="36" strokeLinecap="round" fill="none" />
          <ellipse cx="86" cy="356" rx="22" ry="14" fill="#2a2160" transform="rotate(-30 86 356)" />
          <ellipse cx="240" cy="304" rx="22" ry="14" fill="#2a2160" transform="rotate(-10 240 304)" />
          {/* arms */}
          <path d="M112 216 C84 232 70 262 66 290" stroke="url(#fn-suit)" strokeWidth="32" strokeLinecap="round" fill="none" />
          <path d="M190 212 C226 204 246 182 254 156" stroke="url(#fn-suit)" strokeWidth="32" strokeLinecap="round" fill="none" />
          <circle cx="64" cy="296" r="17" fill="#3f9b4a" />
          <circle cx="256" cy="150" r="17" fill="#3f9b4a" />
          {/* torso */}
          <path d="M104 196 Q150 176 198 196 L206 284 Q150 304 98 284 Z" fill="url(#fn-suit)" stroke="#8a7fbf" strokeWidth="2" />
          <path d="M100 250 Q150 266 204 250" stroke="#7c5cff" strokeWidth="6" fill="none" opacity=".85" />
          <rect x="132" y="210" width="40" height="28" rx="6" fill="#120c2e" stroke="#a48bff" strokeOpacity=".7" />
          <path d="M156 214a10 10 0 1 0 6 13a8 8 0 1 1 -6 -13Z" fill="#c4b4ff" />
          <circle cx="166" cy="218" r="2" fill="#b8ff4a" />
          {/* helmet */}
          <circle cx="150" cy="118" r="92" fill="url(#fn-suit)" stroke="#8a7fbf" strokeWidth="2" />
          <circle cx="150" cy="118" r="80" fill="#0d0a24" />
          <g clipPath="url(#fn-visor)">
            <image href="/art/frog/frog-face.webp" x="54" y="30" width="196" height="196" preserveAspectRatio="xMidYMid slice" />
            <rect x="60" y="30" width="190" height="180" fill="#1a1040" opacity=".18" />
          </g>
          <circle cx="150" cy="118" r="80" fill="url(#fn-glass)" />
          <path d="M96 76 Q120 52 156 48" stroke="#fff" strokeOpacity=".7" strokeWidth="7" strokeLinecap="round" fill="none" />
          <circle cx="198" cy="66" r="5" fill="#fff" opacity=".6" />
          <circle cx="150" cy="118" r="80" fill="none" stroke="#a48bff" strokeWidth="3" />
          {/* antenna */}
          <path d="M214 46 L236 14" stroke="#cfc6ee" strokeWidth="4" strokeLinecap="round" />
          <circle className="fn-blink" cx="238" cy="11" r="6" fill="#b8ff4a" />
        </svg>
      </button>
    </div>
  );
}
