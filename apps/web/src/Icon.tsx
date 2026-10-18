/** A small, consistent line-icon set (24px grid, 1.75 stroke), used instead of emoji. */
const PATHS: Record<string, string> = {
  flame: "M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1.2-3.6 2.4-4.6.3 1.4 1 2.4 2.1 2.9C11 9 11 6 12 3Z",
  alert: "M12 4 2.8 19.5h18.4L12 4Zm0 6v4.5m0 2.8v.2",
  check: "m5 12.5 4.5 4.5L19 7.5",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z",
  sun: "M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m11.4 0 1.4 1.4M4.9 4.9l1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  external: "M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  swap: "M7 7h13m0 0-4-4m4 4-4 4M17 17H4m0 0 4-4m-4 4 4 4",
  "black-hole": "M21 11.5c0 4.4-4 8-9 8s-9-3.6-9-8 4-8 9-8c3.9 0 7 2.7 7 6s-3.1 6-7 6c-2.8 0-5-1.8-5-4s2.2-4 5-4c1.7 0 3 1 3 2.5s-1.3 2.5-3 2.5c-.7 0-1.2-.4-1.2-1M2 16l20-9",
  meteor: "m13 3-5 5m12-4-5 5m6 1-4 4M5 11l5-1 5 4-1 5-5 2-5-4 1-6Zm3 3 2 2m2 1h.1",
  frog: "M5 10a3.5 3.5 0 1 1 7-1 3.5 3.5 0 1 1 7 1c1.3 1 2 2.5 2 4 0 4-4 6.5-9 6.5S3 18 3 14c0-1.5.7-3 2-4Zm3.5-2v1m7-1v1M8 14.5c1.8 2 6.2 2 8 0",
  target: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-4 0a5 5 0 1 1-10 0 5 5 0 0 1 10 0Zm-4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  shield: "M12 3 4.5 6v5.3c0 4.6 3 7.6 7.5 9.7 4.5-2.1 7.5-5.1 7.5-9.7V6L12 3Zm-3.5 9 2.3 2.3 4.7-4.8",
  scales: "M12 3v17m-4 0h8M4 7h16M12 4.5l-2 2.5m4-2.5L12 7M5 7l-3 7h6L5 7Zm14 0-3 7h6l-3-7ZM2 14c0 2.2 6 2.2 6 0m8 0c0 2.2 6 2.2 6 0",
  swords: "m4 3 4 1 10 12-2 2L4 7 4 3Zm16 0-4 1-4 5m8-6v4l-5 5M9 14l-3 4m-3-3 6 6m6-6 6 6m-3-3 3 3M6 18l-3 3",
  play: "m8 4 12 8-12 8V4Z",
  diamond: "m3 9 4-5h10l4 5-9 12L3 9Zm0 0h18M7 4l5 17 5-17M9.5 9l2.5-5L14.5 9",
  crescent: "M16.5 3a9.2 9.2 0 1 0 4.7 14.7A8 8 0 0 1 16.5 3Z",
  trophy: "M7 3h10v7a5 5 0 0 1-10 0V3Zm0 2H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4m-5 3v5m-4 1h8",
  lock: "M7.5 10V7a4.5 4.5 0 0 1 9 0v3M5 10h14v11H5V10Zm7 4v3",
  sound: "m11 4-6 5H2.5v6H5l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  "sound-off": "m11 4-6 5H2.5v6H5l6 5V4Zm5 5 6 6m0-6-6 6",
  music: "M9 17V5l11-2v12M9 8l11-2M9 17c0 1.7-1.5 3-3.5 3S2 19 2 17.5 3.5 15 5.5 15 9 15.5 9 17Zm11-2c0 1.7-1.5 3-3.5 3S13 17 13 15.5s1.5-2.5 3.5-2.5 3.5.5 3.5 2Z",
  radar: "M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5m-5 0 8-8m-7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
  bolt: "m13.5 2-10 12H11l-.5 8 10-12H13l.5-8Z",
  orbit: "M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM9.3 6.6c5.3-3.2 10.4-4.2 11.7-2S19 12 13.3 15.4 2.4 19.6 1.1 17.4 3 10.9 7.4 7.9",
  flipper: "M4.5 13.5 17.8 5a3 3 0 0 1 4 4.4L10.5 20a5 5 0 0 1-6-6.5Zm4.5 3.7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z",
};
export function Icon({ name, size = 18, className = "" }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
