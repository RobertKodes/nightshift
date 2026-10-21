/**
 * The station's own icon set: 24px grid, 1.6 stroke, rounded joins, and one accent mark per icon
 * (a dot, a blip, a window) drawn in the room's colour (--acc). Hand-drawn for NIGHTSHIFT.
 */
const A = { fill: "var(--acc, currentColor)", stroke: "none" } as const;

const ICONS: Record<string, React.ReactNode> = {
  way: <><path d="M6 20V10a6 6 0 0 1 12 0v10" /><path d="M3.5 20h17" /><path d="M9.5 20v-6.5a2.5 2.5 0 0 1 5 0V20" /><circle cx="12" cy="8.2" r="1.3" {...A} /></>,
  play: <><path d="M5 15.5h14a2.5 2.5 0 0 1 0 5H5a2.5 2.5 0 0 1 0-5Z" /><path d="M12 15.5V9.5" /><circle cx="12" cy="6.6" r="2.6" {...A} /><path d="M16.5 18h1" /></>,
  build: <><rect x="6.5" y="6.5" width="11" height="11" rx="2" /><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21" /><rect x="10" y="10" width="4" height="4" rx=".8" {...A} /></>,
  info: <><path d="M12 2.8 20.5 12 12 21.2 3.5 12Z" /><path d="M12 8.6v4.6" /><circle cx="12" cy="16" r="1.2" {...A} /></>,
  money: <><ellipse cx="12" cy="6.5" rx="7" ry="2.6" /><path d="M5 6.5v5c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-5" /><path d="M5 11.5v5c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-5" /><circle cx="12" cy="6.5" r="1.2" {...A} /></>,
  command: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.4" /><path d="M12 12l6-6" /><circle cx="15.6" cy="9.2" r="1.4" {...A} /></>,
  founder: <><path d="M12 2.8c3.2 2.2 4.7 5.8 4.4 10L14 16.2h-4l-2.4-3.4C7.3 8.6 8.8 5 12 2.8Z" /><path d="M9.6 13.4 6 15.2l1.2 3.2 3-1.8M14.4 13.4l3.6 1.8-1.2 3.2-3-1.8" /><circle cx="12" cy="9" r="1.7" {...A} /><path d="m11 18.6 1 2.6 1-2.6" /></>,
  agent: <><rect x="4.5" y="8" width="15" height="11" rx="3.2" /><path d="M12 4.6V8M2.8 12.5v2.5M21.2 12.5v2.5" /><circle cx="12" cy="3.6" r="1.2" {...A} /><circle cx="9.4" cy="13.4" r="1.3" {...A} /><circle cx="14.6" cy="13.4" r="1.3" {...A} /></>,
  pinball: <><path d="M4.2 18.8 13.6 14" strokeWidth="2.6" /><circle cx="4.2" cy="18.8" r="1.4" /><path d="M19.8 18.8 15.5 16.6" strokeWidth="2.6" /><circle cx="15.5" cy="7" r="2.8" {...A} /><path d="M9 6.2 6.5 4" /></>,
  pool: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="11" r="3.3" /><circle cx="12" cy="10" r=".9" {...A} /><circle cx="12" cy="12.2" r="1.1" {...A} /></>,
  poker: <><rect x="4.2" y="4" width="10.6" height="15" rx="1.6" /><path d="M17.2 6.6 19.6 7.3a1.4 1.4 0 0 1 1 1.7l-3.2 12" /><path d="M9.5 8.6c1.7 1.4 3 2.4 3 3.8a1.6 1.6 0 0 1-3 .8 1.6 1.6 0 0 1-3-.8c0-1.4 1.3-2.4 3-3.8Z" {...A} /><path d="M9.5 13.6v1.8" /></>,
  chess: <><path d="M7.5 20.5h10" /><path d="M9 20.5c0-3 .9-4.6 2.4-6.1L8.6 13l1-3.2 3.4-3.5 1.4-2.1.6 2.6c2 1.6 2.6 4.1 2 7.6l-.6 6.1" /><circle cx="12.9" cy="8.9" r="1" {...A} /></>,
  live: <><circle cx="12" cy="12" r="2.2" {...A} /><path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.7 5.7a8.9 8.9 0 0 0 0 12.6M18.3 5.7a8.9 8.9 0 0 1 0 12.6" /></>,
  arena: <><path d="M4.5 4.5 14 14M19.5 4.5 10 14" /><path d="m7 15.5-3 3M17 15.5l3 3M8.2 13.2l2.6 2.6M15.8 13.2l-2.6 2.6" /><circle cx="12" cy="9.6" r="1.3" {...A} /></>,
  league: <><path d="M4 20.2h16.5M4 20.2V3.8" /><path d="m7.2 15.6 4-4.2 3 2.8 5-6.2" /><circle cx="19.2" cy="8" r="1.7" {...A} /></>,
  mcp: <><path d="M9 3v4.8M15 3v4.8" /><path d="M6.8 7.8h10.4v3.4a5.2 5.2 0 0 1-10.4 0Z" /><path d="M12 16.4V21" /><circle cx="12" cy="11.4" r="1.3" {...A} /></>,
  companies: <><path d="M3 20.5h18M5 20.5V8.5l6-3.2v15.2M11 20.5V4h8.5v16.5" /><rect x="13.6" y="7.2" width="1.8" height="1.8" rx=".4" {...A} /><rect x="13.6" y="11.2" width="1.8" height="1.8" rx=".4" {...A} /><path d="M7.6 11.5h1M7.6 15h1" /></>,
  market: <><path d="M5 8.2h14l-1.1 12H6.1Z" /><path d="M9 8.2V6.4a3 3 0 0 1 6 0v1.8" /><circle cx="12" cy="13.6" r="1.6" {...A} /></>,
  guide: <><path d="M4 5.2A2.2 2.2 0 0 1 6.2 3H11v17H6.2A2.2 2.2 0 0 0 4 22.2Z" /><path d="M20 5.2A2.2 2.2 0 0 0 17.8 3H13v17h4.8a2.2 2.2 0 0 1 2.2 2.2Z" /><path d="M15.4 3v5.4l1.3-1 1.3 1V3" {...A} /></>,
  token: <><path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4Z" /><path d="M12 7.2 16 9.6v4.8L12 16.8 8 14.4V9.6Z" /><circle cx="12" cy="12" r="1.6" {...A} /></>,
  tokenomics: <><path d="M11 3.8v8.6h8.6A8.6 8.6 0 1 1 11 3.8Z" /><path d="M13.6 2.6a8.6 8.6 0 0 1 7.8 7.8h-7.8Z" {...A} /></>,
  frogs: <><path d="M3.8 14.3c0-3.6 3.7-6 8.2-6s8.2 2.4 8.2 6-3.7 6.2-8.2 6.2-8.2-2.6-8.2-6.2Z" /><circle cx="7.8" cy="8" r="2.6" /><circle cx="16.2" cy="8" r="2.6" /><circle cx="7.8" cy="8.3" r="1" {...A} /><circle cx="16.2" cy="8.3" r="1" {...A} /><path d="M8.8 15.6c2 1.1 4.4 1.1 6.4 0" /></>,
  forge: <><path d="M3.5 8.5h12.8a4.2 4.2 0 0 1-4.2 4.2h-1.4v2.8h2.6l1.2 4H6.9l1.2-4h2.6v-2.8H7.9a4.4 4.4 0 0 1-4.4-4.2Z" /><path d="M16.3 8.5h2.2" /><circle cx="19.6" cy="4.6" r="1.3" {...A} /><path d="m16.6 3.2.8 1.4M21.6 7.6l-1.4-.6" /></>,
  stake: <><path d="m12 3.6 8.4 4.2-8.4 4.2-8.4-4.2Z" /><path d="m3.6 12.2 8.4 4.2 8.4-4.2M3.6 16.4l8.4 4.2 8.4-4.2" /><circle cx="12" cy="7.8" r="1.3" {...A} /></>,
  swap: <><path d="M6.5 7.5H19l-3.4-3.4M17.5 16.5H5l3.4 3.4" /><circle cx="5" cy="7.5" r="1.3" {...A} /><circle cx="19" cy="16.5" r="1.3" {...A} /></>,
  security: <><path d="M12 2.8 19.2 6v6c0 4.6-3 7.7-7.2 9.2C7.8 19.7 4.8 16.6 4.8 12V6Z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" stroke="var(--acc, currentColor)" /></>,
  terms: <><path d="M6.5 3h7.6l4.4 4.4V21h-12Z" /><path d="M14 3v4.5h4.5" /><path d="M9 12.2h6M9 15.8h6" /><circle cx="9.4" cy="8.4" r="1.1" {...A} /></>,
  impact: <><path d="M12 21.2c-3.6 0-6.2-2.6-6.2-6.2 0-4.2 3.2-6.2 3.2-10.4 2.6 1.6 4.2 3.6 4.2 6.2 1-1 1.6-2.2 1.6-3.2 2.2 1.6 3.4 4.2 3.4 7.4 0 3.6-2.6 6.2-6.2 6.2Z" /><path d="M12 18.6c-1.4 0-2.4-1-2.4-2.4 0-1.6 1.2-2.4 1.2-4 1.2.8 2 1.8 2 3 .4-.4.6-.8.6-1.4.9.7 1.4 1.6 1.4 2.4 0 1.4-1.2 2.4-2.8 2.4Z" {...A} /></>,
  crew: <><circle cx="9" cy="8" r="3.2" /><path d="M3.4 20.2a5.6 5.6 0 0 1 11.2 0" /><circle cx="17" cy="9.2" r="2.4" {...A} /><path d="M15.3 14.3a4.6 4.6 0 0 1 5.9 4.9" /></>,
  missions: <><circle cx="11" cy="13" r="7.8" /><circle cx="11" cy="13" r="3.9" /><circle cx="11" cy="13" r="1.4" {...A} /><path d="m14 10 6.6-6.6M17.6 3.4h3v3" /></>,
  wallet: <><path d="M4 7.2A2.2 2.2 0 0 1 6.2 5H17v3" /><path d="M4 7.2v11a2 2 0 0 0 2 2h14V8.2H6.2A2.2 2.2 0 0 1 4 7.2Z" /><circle cx="16.4" cy="14.2" r="1.4" {...A} /></>,
  key: <><circle cx="8" cy="15.4" r="4.4" /><path d="m11.2 12.2 8.6-8.6M16.4 7l2.2 2.2M14 9.4l1.6 1.6" /><circle cx="8" cy="15.4" r="1.5" {...A} /></>,
  story: <><path d="M5 4h10.5L19 7.5V20H5Z" /><path d="M8 9h6M8 12.5h8M8 16h5" /><circle cx="16.6" cy="16" r="1.2" {...A} /></>,
  pulse: <><path d="M2.8 12.5h4l2.2-5.6 4.2 10.8 2.2-5.2h5.8" /><circle cx="21" cy="12.5" r="1.2" {...A} /></>,
  arrow: <path d="M4.5 12h14.5M13 6l6 6-6 6" />,
  back: <path d="M19.5 12H5M11 6l-6 6 6 6" />,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14.5v4.3a1.2 1.2 0 0 1-1.2 1.2H5.2A1.2 1.2 0 0 1 4 18.8V7.2A1.2 1.2 0 0 1 5.2 6h4.3" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  close: <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />,
  chevron: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  setup: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" /><circle cx="12" cy="12" r="1.2" {...A} /></>,
};

export type NxIconName = keyof typeof ICONS;
export function NxIcon({ name, size = 20, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={`nx-ic ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name] ?? ICONS.way}
    </svg>
  );
}
