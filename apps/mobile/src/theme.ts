/**
 * The NIGHTSHIFT night palette, as the owner app's mockups draw it: near-black navy, acid lime for
 * money and go, violet for the crew's own marks, coral for what waits on the owner.
 */
export const C = {
  bg: "#05040e",
  bgDeep: "#030209",
  glow: "#1b1342",
  panel: "#0d0b20",
  panelHi: "#131029",
  inset: "#15122e",
  line: "#221e45",
  lineHi: "#37315f",
  ink: "#f2efff",
  dim: "#b5b0d6",
  faint: "#7d78a3",
  ghost: "#4d4872",
  lime: "#b8ff4a",
  limeInk: "#0b0d05",
  limeDim: "#3f5a17",
  violet: "#7b61ff",
  violetHi: "#9a86ff",
  violetDeep: "#5a3df0",
  coral: "#ff5c70",
  coralDeep: "#2a0f1b",
  amber: "#ffb547",
  blue: "#8ea6ff",
  scrim: "rgba(3,2,9,0.72)",
} as const;

/** The four faces: Space Grotesk to read, Instrument Serif for the one word that sings, JetBrains Mono for numbers and labels. */
export const F = {
  ui: "SpaceGrotesk_500Medium",
  uiBold: "SpaceGrotesk_700Bold",
  uiSemi: "SpaceGrotesk_600SemiBold",
  uiReg: "SpaceGrotesk_400Regular",
  serif: "InstrumentSerif_400Regular_Italic",
  mono: "JetBrainsMono_400Regular",
  monoMed: "JetBrainsMono_500Medium",
  monoBold: "JetBrainsMono_600SemiBold",
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
