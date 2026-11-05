/**
 * NIGHTSHIFT // PROTOCOL INTERFACE, the same as the website: flat ink, lime hairlines, pixel labels.
 * Lime is money in and go; IMD blue is the swarm and what the company pays it; coral waits on the
 * owner; gold warns. (The old names stay so every screen follows: `violet` is now IMD blue.)
 */
export const C = {
  bg: "#050706",
  bgDeep: "#030504",
  glow: "#0f2a14",
  panel: "#0a0f0b",
  panelHi: "#0d1410",
  inset: "#0c130e",
  line: "rgba(184,255,61,0.15)",
  lineHi: "rgba(184,255,61,0.34)",
  rule: "rgba(255,255,255,0.08)",
  ink: "#e9f4ea",
  dim: "#b2c4b5",
  faint: "#738878",
  ghost: "#4a5b4e",
  lime: "#b8ff3d",
  limeInk: "#031007",
  limeDim: "#3d5a14",
  pepe: "#57d97b",
  violet: "#2f7bff",
  violetHi: "#79aaff",
  violetDeep: "#1d55c9",
  imd: "#2f7bff",
  coral: "#ff6b7d",
  coralDeep: "#24090f",
  amber: "#f2c14e",
  blue: "#8db6ff",
  scrim: "rgba(2,4,3,0.76)",
} as const;

/** Space Grotesk for titles, Inter to read, JetBrains Mono for numbers, Silkscreen for the small pixel labels. No serif. */
export const F = {
  ui: "SpaceGrotesk_500Medium",
  uiBold: "SpaceGrotesk_700Bold",
  uiSemi: "SpaceGrotesk_600SemiBold",
  uiReg: "Inter_400Regular",
  text: "Inter_400Regular",
  textMed: "Inter_500Medium",
  /** was the italic serif accent; the protocol says it in the title face, in lime */
  serif: "SpaceGrotesk_700Bold",
  mono: "JetBrainsMono_400Regular",
  monoMed: "JetBrainsMono_500Medium",
  monoBold: "JetBrainsMono_600SemiBold",
  pixel: "Silkscreen_400Regular",
} as const;

export const S = { gutter: 18, gap: 12, radius: 3, chamfer: 12 } as const;

/** Money as the desk shows it: two decimals, a sign only when asked. */
export const usd = (v: number | null | undefined, sign = false) => {
  const n = Number(v ?? 0);
  const s = `$${Math.abs(n).toFixed(2)}`;
  return n < 0 ? `-${s}` : sign && n > 0 ? `+${s}` : s;
};
export const imd = (v: number | null | undefined) => `${Number(v ?? 0).toFixed(Number(v ?? 0) >= 100 ? 0 : 2)} IMD`;
export const clock = (at: number) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
/** "03:12" today, "Thu" this week, "12 Oct" before. */
export const when = (at: number, now = Date.now()) => {
  const d = new Date(at), n = new Date(now);
  if (d.toDateString() === n.toDateString()) return clock(at);
  if (now - at < 6 * 86400_000) return d.toLocaleDateString("en-GB", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
export const ago = (at: number, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};
/** "tonight", "this morning" or "today", for the headline. */
export const partOfDay = (h = new Date().getHours()) => (h >= 5 && h < 12 ? "this morning" : h >= 12 && h < 18 ? "today" : "tonight");
export const short = (a: string | null | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
