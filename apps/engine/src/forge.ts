import { readFileSync } from "node:fs";
import { parseAbi } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";

/**
 * NIGHT WATCHERS, the NIGHT FROGS Gen 2. A holder forges exactly 10 NIGHT FROGS into 1 Night Watcher
 * (so at most 50 can exist); the 10 go to 0x…dEaD for good (the NIGHT FROGS contract has no burn). Each
 * frog brings forge points by its rarity (Common 1, Uncommon 2, Rare 4, Epic 8, Legendary 16; Genesis at
 * least 4, #2-25 at least 8), and the sum sets the tier: the larger the share of rare frogs in the 10, the
 * higher the frog that comes out. Nothing is random, so the result and the art are known before anyone
 * signs. The Night Watcher wears the rarest trait of each layer among the 10 and earns its tier's multiplier
 * in shift hours every hour, 10x to 40x, and never less than its 10 frogs earned together. Rarity earns
 * nothing on an ordinary frog (shift rates go by number), so the forge is where a rare frog pays. #1, the
 * Zero-Sleep Captain, earns 50x and holds the Night Watch's Captain's seat. Forged with 9 others, it makes
 * two: The Captain (token 0, the one tier-6 Night Watcher, the best in the collection: 60x, #1's own look in
 * platinum, the Captain's seat) and the Night Watcher those 10 make by the usual rule. A Night Watcher is a
 * seat in the Night Watch, the imdUSD keeper network (nightwatch.ts). assets/forge/table.json
 * comes from the chain (scripts/forge-table.mjs) and is the same table the forge contract hardcodes.
 */
type Table = {
  source: { frogs: string; renderer: string; word: string };
  layers: string[]; names: string[][]; counts: number[][]; codes: number[]; packed: string[];
  tokens: { id: number; rank: number; tier: string; points: number; traits: number[] }[];
};
const asset = (f: string) => readFileSync(new URL(`../assets/forge/${f}`, import.meta.url), "utf8");
export const TABLE: Table = JSON.parse(asset("table.json"));
/** The collection's onchain art records, as its two ArtStore contracts return them: 0 defs, 1 overlay, then name/SVG pairs. */
const ART: string[] = JSON.parse(asset("art.json"));
const OFFSETS = [4, 16, 28, 44, 56, 72, 88];

export type ForgeTier = { tier: number; roman: string; name: string; min: number; color: string; x: number; slots: number; crew: number };
/**
 * Forge points needed for each tier, the art colour, its multiplier (shift hours per hour and on every
 * mission; the Night Boss's 40x stays under #1's 50x), the company slots it adds, and its crew boost: how
 * much more every other NIGHT FROG in the same wallet earns while it is there (percent).
 */
export const FORGE_TIERS: ForgeTier[] = [
  { tier: 1, roman: "I", name: "Shift Lead", min: 10, color: "#3FE6FF", x: 10, slots: 3, crew: 20 },
  { tier: 2, roman: "II", name: "Foreman", min: 20, color: "#B8FF4A", x: 15, slots: 4, crew: 30 },
  { tier: 3, roman: "III", name: "Supervisor", min: 40, color: "#A98BFF", x: 20, slots: 5, crew: 50 },
  { tier: 4, roman: "IV", name: "Chief", min: 80, color: "#FF4FD8", x: 30, slots: 6, crew: 75 },
  { tier: 5, roman: "V", name: "Night Boss", min: 128, color: "#FFC46B", x: 40, slots: 8, crew: 100 },
];
/** #1's crew boost: the holder of the Zero-Sleep Captain (or of The Captain) lifts every other frog in the wallet the most. */
export const CAPTAIN_CREW = 150;
/** The Captain: token 0, the one Night Watcher forged from #1. Above every tier, a 1 of 1. */
export const CAPTAIN_TIER: ForgeTier = { tier: 6, roman: "C", name: "Captain", min: Infinity, color: "#E9E4FF", x: 60, slots: 10, crew: CAPTAIN_CREW };
/** The forge bonus: a new Night Watcher's first week of shift hours, credited to whoever forged it the hour it appears. */
export const FORGE_BONUS_HOURS = 168;
/** Frogs burned per forge. */
export const FORGE_SIZE = 10;
/** One real 10-frog combo per tier, shown on the forge page (forge.test.ts checks each lands on its tier). */
export const SHOWCASE = [
  [184, 185, 186, 189, 190, 78, 80, 81, 82, 86], [35, 37, 42, 43, 57, 88, 90, 83, 91, 79], [26, 30, 50, 2, 5, 96, 97, 93, 94, 87],
  [115, 156, 163, 14, 15, 98, 100, 7, 8, 105], [10, 45, 103, 12, 19, 22, 69, 188, 204, 267],
];
export const RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary"] as const;
/** In the staking book a forged token n is FORGED_ID + n (The Captain, token 0, is FORGED_ID), so it never collides with NIGHT FROGS #1–500. */
export const FORGED_ID = 1000;
export const DEAD = "0x000000000000000000000000000000000000dead";

export const frogOf = (id: number) => TABLE.tokens[id - 1];
/** A NIGHT FROG's shift hours per hour (and its mission multiplier): #1 50x, #2-25 3x, Genesis #26-77 2x, the rest 1x. */
export const shiftRate = (id: number) => (id === 1 ? 50 : id <= 25 ? 3 : id <= 77 ? 2 : 1);
/**
 * A Night Watcher earns its tier's multiplier, or what its 10 frogs earned together if that was more. #1's 50x
 * is not counted twice: forged, it lives on in The Captain (60x), so the other Night Watcher counts the other 9.
 */
export const watcherRate = (tier: number, inputs: number[]) => (tier === 6 ? CAPTAIN_TIER.x : Math.max(tierInfo(tier).x, inputs.filter((id) => id !== 1).reduce((s, id) => s + shiftRate(id), 0)));
export const tierFor = (points: number): ForgeTier => [...FORGE_TIERS].reverse().find((t) => points >= t.min) ?? FORGE_TIERS[0]!;
export const tierInfo = (tier: number): ForgeTier => (tier === 6 ? CAPTAIN_TIER : FORGE_TIERS[Math.min(5, Math.max(1, tier)) - 1]!);

/** Per layer, the trait the fewest frogs have among the 10 (ties go to the lower trait index). */
export function inherit(ids: number[]): number[] {
  return TABLE.layers.map((_, l) => ids.map((id) => frogOf(id)!.traits[l]!).reduce((best, v) => {
    const a = TABLE.counts[l]![v]!, b = TABLE.counts[l]![best]!;
    return a < b || (a === b && v < best) ? v : best;
  }));
}

export class ForgeError extends Error {}
export function checkIds(raw: unknown[]): number[] {
  const ids = raw.map(Number);
  if (ids.length !== FORGE_SIZE || new Set(ids).size !== FORGE_SIZE || ids.some((id) => !Number.isInteger(id) || id < 1 || id > 500)) throw new ForgeError(`Pick exactly ${FORGE_SIZE} different NIGHT FROGS (#1–500).`);
  return ids;
}

/** What forging these 10 gives, exactly as the contract will compute it. */
export function preview(raw: unknown[]) {
  const ids = checkIds(raw);
  const points = ids.reduce((s, id) => s + frogOf(id)!.points, 0);
  const t = tierFor(points);
  const traits = inherit(ids);
  const mix = Object.fromEntries(RARITIES.map((r) => [r, ids.filter((id) => frogOf(id)!.tier === r).length]));
  return {
    ids, points, tier: t.tier, name: t.name, rate: watcherRate(t.tier, ids), mix,
    // #1 among the 10: The Captain comes out as well
    captain: ids.includes(1),
    toNext: t.tier < 5 ? FORGE_TIERS[t.tier]!.min - points : 0,
    traits: traits.map((v, l) => ({ layer: TABLE.layers[l]!, value: TABLE.names[l]![v]!, index: v })),
  };
}

/**
 * The cheapest 10 (fewest wasted points) that reach each tier, and the strongest 10, from a wallet's
 * frogs. A small knapsack over (frogs picked, points): the weakest frogs are tried first, so every
 * total is reached with the least valuable frogs and the rare ones stay in the wallet.
 */
export function plan(owned: number[]) {
  const pts = (id: number) => frogOf(id)!.points;
  const ids = [...new Set(owned)].filter((id) => id >= 2 && id <= 500).sort((a, b) => pts(b) - pts(a) || a - b);
  if (ids.length < FORGE_SIZE) return { strongest: null, cheapest: [] as { tier: number; ids: number[]; points: number }[] };
  const strongest = ids.slice(0, FORGE_SIZE);
  const max = strongest.reduce((s, id) => s + pts(id), 0);
  const best: (number[] | null)[][] = Array.from({ length: FORGE_SIZE + 1 }, () => Array<number[] | null>(max + 1).fill(null));
  best[0]![0] = [];
  for (const id of [...ids].reverse()) {
    const p = pts(id);
    for (let k = FORGE_SIZE - 1; k >= 0; k--) for (let s = max - p; s >= 0; s--) {
      const from = best[k]![s];
      if (from && !best[k + 1]![s + p]) best[k + 1]![s + p] = [...from, id];
    }
  }
  const cheapest = FORGE_TIERS.flatMap((t) => {
    for (let s = t.min; s <= max; s++) { const hit = best[FORGE_SIZE]![s]; if (hit && tierFor(s).tier === t.tier) return [{ tier: t.tier, ids: hit, points: s }]; }
    return [];
  });
  return { strongest, cheapest };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/**
 * The Night Watcher art parts, written once: forgedSvg fills in their {FIELDS}, and the renderer order
 * (order-forge.ts) quotes them as they are, so the site and the contract draw the same bytes. All of
 * it is in the tier colour: a back light; from tier II light rays; a neon glow hugging the frog's
 * silhouette; from III glowing eyes, a ring and rising embers; from IV a holo sheen and a pulsing
 * border; the Night Boss gets spinning rays and rings, a crown and a double border. A still frame (a
 * marketplace thumbnail) shows every effect; the animations only move them. The glows take the colour
 * as a hex ({C}), since some renderers ignore currentColor inside a filter.
 */
export const OT_PARTS = {
  defs: `<defs><radialGradient id="otL"><stop offset="0" stop-color="currentColor" stop-opacity=".6"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient><radialGradient id="otR"><stop offset=".15" stop-color="#FFFFFF"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient><mask id="otM"><rect x="0" y="0" width="1000" height="1000" fill="url(#otR)"/></mask><linearGradient id="otH" x1="0" y1="0" x2="1" y2="1"><stop offset=".4" stop-color="#FFFFFF" stop-opacity="0"/><stop offset=".5" stop-color="#FFFFFF" stop-opacity=".7"/><stop offset=".6" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient><filter id="otA" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="5"/><feGaussianBlur stdDeviation="15" result="b"/><feFlood flood-color="{C}"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="otE" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceAlpha" stdDeviation="9" result="b"/><feFlood flood-color="{C}"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`,
  light: `<circle cx="500" cy="540" r="480" fill="url(#otL)" opacity="{O}"/>`,
  spin: `<animateTransform attributeName="transform" type="rotate" from="0 500 540" to="{TO} 500 540" dur="{D}s" repeatCount="indefinite"/>`,
  rays: `<circle cx="500" cy="540" r="330" fill="none" stroke="currentColor" stroke-width="660" stroke-dasharray="8 44" opacity="{O}" mask="url(#otM)">{SPIN}</circle>`,
  ring: `<circle cx="500" cy="540" r="402" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="2 16" opacity=".7">{SPIN}</circle>`,
  ring2: `<circle cx="500" cy="540" r="432" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="40 14 4 14" opacity=".8">{SPIN}</circle>`,
  ember: `<circle cx="{X}" cy="{Y}" r="{R}" fill="currentColor"><animateTransform attributeName="transform" type="translate" values="0 0;0 -280" dur="{D}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="{D}s" repeatCount="indefinite"/></circle>`,
  holo: `<rect x="-500" y="0" width="2000" height="1000" fill="url(#otH)" opacity=".45" style="mix-blend-mode:overlay"><animateTransform attributeName="transform" type="translate" values="-1000 0;1000 0" dur="6s" repeatCount="indefinite"/></rect>`,
  shade: `<rect x="0" y="0" width="1000" height="1000" fill="url(#vignette)"/><rect x="0" y="0" width="1000" height="1000" fill="#FFFFFF" filter="url(#grain)" opacity=".035"/>`,
  card: `<path d="M60 24H940L976 60V940L940 976H60L24 940V60Z" fill="none" stroke="currentColor" stroke-width="4"/>`,
  inner: `<path d="M72 36H928L964 72V928L928 964H72L36 928V72Z" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".45"/><path d="M500 24V44M24 500H44M956 500H976" stroke="currentColor" stroke-width="4"/>`,
  pulse: `<path d="M60 24H940L976 60V940L940 976H60L24 940V60Z" fill="none" stroke="currentColor" stroke-width="12" filter="url(#glow)"><animate attributeName="opacity" values=".15;.7;.15" dur="4s" repeatCount="indefinite"/></path>`,
  boss: `<path d="M54 10H946L990 54V946L946 990H54L10 946V54Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M436 44L448 8L476 30L500 2L524 30L552 8L564 44Z" fill="currentColor" stroke="#08070D" stroke-width="4" stroke-linejoin="round"/>`,
  title: `<text x="66" y="86" font-size="16" fill="#C4B4FF" letter-spacing="7">NIGHT FROGS / GEN 2</text><text x="62" y="142" font-size="56" fill="#F2EFFF" letter-spacing="5">NIGHT WATCHER</text>`,
  pip: `<rect x="{X}" y="158" width="26" height="8" fill="currentColor" opacity="{O}"/>`,
  hex: `<path d="M884 50L936 80V140L884 170L832 140V80Z" fill="{FILL}" stroke="currentColor" stroke-width="5"/><text x="884" y="126" font-size="{S}" fill="{INK}" text-anchor="middle">{ROMAN}</text>`,
  spine: `<text x="0" y="0" font-size="13" fill="currentColor" letter-spacing="6" text-anchor="middle" opacity=".85" transform="translate(958 520) rotate(90)">NIGHTSHIFT / NIGHT WATCH / TIER {ROMAN}</text>`,
  plate: `<path d="M64 870H904L940 906L904 942H64Z" fill="#08070D" fill-opacity=".88" stroke="currentColor" stroke-width="3"/><text x="86" y="917" font-size="30" fill="#F2EFFF">#{N}</text><text x="{X}" y="916" font-size="22" fill="currentColor">{LABEL}</text><text x="896" y="916" font-size="18" fill="#C4B4FF" text-anchor="end">{P} FP</text><text x="66" y="966" font-size="14" fill="#C4B4FF" letter-spacing="3">FORGED FROM {FROM}</text>`,
  badge: `<text x="500" y="858" font-size="23" fill="#08070D" text-anchor="middle">NW{N}</text>`,
} as const;
const fill = (part: keyof typeof OT_PARTS, v: Record<string, string | number> = {}) => OT_PARTS[part].replace(/\{([A-Z]+)\}/g, (_, k: string) => String(v[k] ?? ""));
const spin = (d: number, to = 360) => fill("spin", { TO: to, D: d });
const LIGHT = [".6", ".7", ".8", ".9", "1", "1"];
/** Behind the frog, after the background: back light, rays (II+), a ring (III+), a second ring (V and the Captain). */
function backdrop(t: number): string {
  let s = fill("light", { O: LIGHT[t - 1]! });
  if (t >= 2) s += fill("rays", { O: t >= 4 ? ".34" : ".22", SPIN: t >= 5 ? spin(80) : "" });
  if (t >= 3) s += fill("ring", { SPIN: t >= 5 ? spin(120) : "" });
  if (t >= 5) s += fill("ring2", { SPIN: spin(90, -360) });
  return s;
}
/** Embers rising at the sides (III+): 6, 10, 14 or (the Captain) 18 of them, glowing like the eyes. */
function embers(t: number): string {
  if (t < 3) return "";
  let s = `<g filter="url(#otE)">`;
  for (let k = 0; k < 4 * t - 6; k++) {
    s += fill("ember", { X: k % 2 ? 890 - ((37 * k) % 150) : 110 + ((37 * k) % 150), Y: 560 + ((83 * k) % 340), R: 4 + 2 * (k % 3), D: 4 + (k % 4) });
  }
  return s + "</g>";
}
/** Over the frog: holo sheen (IV+), vignette and grain, the card frame, title, tier pips and hexagon, the plate. */
function frame(t: number, n: number | null, label: string, inputs: number[], points: number): string {
  const T = tierInfo(t), num = n ?? "?";
  let s = (t >= 4 ? fill("holo") : "") + fill("shade") + fill("card");
  if (t >= 2) s += fill("inner");
  if (t >= 4) s += fill("pulse");
  if (t >= 5) s += fill("boss");
  s += fill("title");
  for (let k = 0; k < 5; k++) s += fill("pip", { X: 66 + 34 * k, O: k < t ? "1" : ".2" });
  s += fill("hex", { FILL: t >= 4 ? "currentColor" : "#08070D", INK: t >= 4 ? "#08070D" : "currentColor", S: t === 3 ? 34 : 40, ROMAN: T.roman });
  s += fill("spine", { ROMAN: T.roman });
  return s + fill("plate", { N: num, X: 130 + 20 * String(num).length, LABEL: esc(label), P: points, FROM: inputs.map((i) => `#${i}`).join(" ") });
}

/**
 * The identity layer, drawn over the whole card (the NightWatchSkin order quotes these as they are): the
 * signal look of identity.md's own seats (scanlines, a signal barcode, orbit rings with a travelling node,
 * an ID line with a blinking cursor, code columns, pixel stars) in the tier colour, every part animated:
 * the scanlines drift, a scan beam sweeps the card (II+), the bars flicker, the node orbits (II+, a second
 * ring the other way for the Night Boss), the code flickers (III+), the stars twinkle and a lime-to-violet
 * signal edge runs round the frame (IV+). A still frame shows them all at rest.
 */
export const SKIN_PARTS = {
  defs: `<defs><pattern id="nwS" width="8" height="6" patternUnits="userSpaceOnUse"><path d="M0 .5H8" stroke="#E2E8F0" stroke-opacity=".08"/></pattern><linearGradient id="nwB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{C}" stop-opacity="0"/><stop offset="1" stop-color="{C}" stop-opacity=".28"/></linearGradient><linearGradient id="nwE" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{C}"/><stop offset=".55" stop-color="#A3E635"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient></defs>`,
  scan: `<rect width="1000" height="1000" fill="url(#nwS)"><animateTransform attributeName="transform" type="translate" values="0 0;0 6" dur="1s" repeatCount="indefinite"/></rect>`,
  beam: `<rect x="24" y="-80" width="952" height="80" fill="url(#nwB)"><animate attributeName="y" values="-80;976" dur="{D}s" repeatCount="indefinite"/></rect>`,
  bar: `<rect x="{X}" y="{Y}" width="6" height="{H}" fill="currentColor" opacity=".55"><animate attributeName="opacity" values=".55;1;.25;.55" dur="{D}s" begin="{B}ms" repeatCount="indefinite"/></rect>`,
  id: `<rect x="66" y="188" width="8" height="12" fill="currentColor"><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></rect><text x="82" y="199" font-size="12" font-family="monospace" fill="#C4B4FF" letter-spacing="3">ID / #{N} / {TAG}</text>`,
  orbit: `<g transform="rotate({R} 500 520)" opacity=".8"><ellipse cx="500" cy="520" rx="430" ry="96" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="4 8"/><circle r="6" fill="#F2EFFF"><animateMotion dur="{D}s" repeatCount="indefinite" keyPoints="{K}" keyTimes="0;1" calcMode="linear" path="M70 520a430 96 0 1 0 860 0a430 96 0 1 0 -860 0"/></circle></g>`,
  code: `<text x="{X}" y="{Y}" font-size="11" font-family="monospace" fill="currentColor" text-anchor="{A}" opacity=".5">{ROW}<animate attributeName="opacity" values=".2;.75;.2" dur="{D}s" repeatCount="indefinite"/></text>`,
  star: `<rect x="{X}" y="{Y}" width="3" height="3" fill="#E2E8F0"><animate attributeName="opacity" values=".1;.8;.1" dur="{D}s" repeatCount="indefinite"/></rect>`,
  edge: `<path d="M60 24H940L976 60V940L940 976H60L24 940V60Z" fill="none" stroke="url(#nwE)" stroke-width="5" stroke-dasharray="60 30"><animate attributeName="stroke-dashoffset" values="0;-900" dur="{D}s" repeatCount="indefinite"/></path>`,
} as const;
const skin = (part: keyof typeof SKIN_PARTS, v: Record<string, string | number> = {}) => SKIN_PARTS[part].replace(/\{([A-Z]+)\}/g, (_, k: string) => String(v[k] ?? ""));
const hex3 = (v: number) => v.toString(16).padStart(3, "0");
/** The identity layer for Night Watcher `n` (null: a preview; 0: The Captain) of tier `t` forged from `inputs` (10 frog ids). */
export function skinSvg(n: number | null, t: number, inputs: number[]): string {
  const T = tierInfo(t), id = (k: number) => inputs[k % 10] ?? 0, m = n ?? 0;
  let s = skin("defs", { C: T.color }) + skin("scan");
  if (t >= 2) s += skin("beam", { D: 9 - t });
  for (let k = 0; k < 16; k++) { const h = 8 + ((id(k) * (k + 7)) % 41); s += skin("bar", { X: 588 + 14 * k, Y: 142 - h, H: h, D: 2 + (k % 4), B: 125 * k }); }
  s += skin("id", { N: n === null ? "????" : String(n).padStart(4, "0"), TAG: t === 6 ? "THE CAPTAIN" : "ON WATCH" });
  if (t >= 2) s += skin("orbit", { R: -12, D: 16 - 2 * t, K: "0;1" });
  if (t >= 5) s += skin("orbit", { R: 14, D: 16 - 2 * t, K: "1;0" });
  if (t === 6) s += skin("orbit", { R: 38, D: 6, K: "0;1" });
  if (t >= 3) for (let k = 0; k < 6; k++) s += skin("code", { X: k < 3 ? 40 : 930, Y: 300 + 18 * (k % 3), A: k < 3 ? "start" : "end", ROW: [0, 1, 2].map((j) => hex3(id(3 * k + j))).join(":"), D: 3 + k });
  for (let k = 0; k < 8; k++) s += skin("star", { X: (k % 2 ? 836 : 40) + ((m * 37 + k * 53) % 120), Y: 230 + ((m * 61 + k * 97) % 560), D: 2 + ((m + k) % 3) });
  if (t >= 4) s += skin("edge", { D: 12 - t });
  return s;
}

/** The Captain forged from these 10 (they include #1): #1's own 1-of-1 look, in the Captain's platinum frame. */
export const captainSvg = (ids: number[], points: number, name = "") => forgedSvg(0, 6, frogOf(1)!.traits, name || CAPTAIN_TIER.name.toUpperCase(), ids, points);

/** The Night Watcher as its holders see it: the renderer's card with the identity layer over it, before the card closes. */
export function forgedSvg(n: number | null, tier: number, traits: number[], name = "", inputs: number[] = [], points = 0): string {
  return rendererSvg(n, tier, traits, name, inputs, points).slice(0, -6) + skinSvg(n, tier, inputs) + "</svg>";
}

/**
 * The renderer's part (NightWatchRenderer): the NIGHT FROGS defs plus its own defs, the background, the
 * backdrop, the frog's layers inside the silhouette glow (eyes glowing from III), the crew badge, the embers,
 * then the frame. `n` is null for a preview. The rim light in the art also uses currentColor, so it glows in
 * the tier colour.
 */
export function rendererSvg(n: number | null, tier: number, traits: number[], name = "", inputs: number[] = [], points = 0): string {
  const T = tierInfo(tier);
  const layer = (l: number) => ART[OFFSETS[l]! + traits[l]! * 2 + 1]!;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000" color="${T.color}"><title>NIGHT WATCHERS${n !== null ? ` #${n}` : ""}</title>${ART[0]}${fill("defs", { C: T.color })}`;
  s += layer(0) + backdrop(T.tier) + `<g filter="url(#otA)">`;
  for (let l = 1; l < 7; l++) s += l === 4 && T.tier >= 3 ? `<g filter="url(#otE)">${layer(l)}</g>` : layer(l);
  s += "</g>";
  if (traits[6] === 1) s += fill("badge", { N: n ?? "" });
  // The Captain carries #1's own 1-of-1 marks, the same onchain record NIGHT FROG #1 draws
  if (T.tier === 6) s += ART[3]!;
  return s + embers(T.tier) + frame(T.tier, n, name || T.name.toUpperCase(), inputs, points) + "</svg>";
}

/** A NIGHT FROG exactly as its renderer's imageSVG draws it, from the same art records (no chain read). */
export function nightFrogSvg(id: number): string {
  const t = frogOf(id)!.traits;
  const accent = ({ 1: "#7C5CFF", 2: "#C4B4FF", 4: "#B8FF4A", 5: "#FFC46B" } as Record<number, string>)[t[0]!] ?? "#3FE6FF";
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000" color="${accent}"><title>NIGHT FROGS #${id}</title>${ART[0]}`;
  for (let l = 0; l < 7; l++) s += ART[OFFSETS[l]! + t[l]! * 2 + 1]!;
  if (t[6] === 1) s += `<text x="500" y="858" font-size="23" fill="#08070D" text-anchor="middle">#${id}</text>`;
  if (id === 1) s += ART[3]!;
  return s + ART[1]! + `<text x="500" y="938" font-size="25" fill="#FFC46B" text-anchor="middle">#${id}</text></svg>`;
}

// ---- the forge contract, once IMD deploys it (FORGE_ADDRESS); everything above works without it
export const FORGE_ABI = parseAbi([
  "function forge(uint256[10] ids, uint8 minTier) returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function nextId() view returns (uint256)",
  "function captainForged() view returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function forgeOf(uint256) view returns (uint8 tier, uint16 points, uint16[10] inputs, uint8[7] traits, uint64 forgedAt)",
  "function nameOf(uint256) view returns (string)",
  "function fee() view returns (uint256)",
]);
export const forgeOn = () => /^0x[0-9a-fA-F]{40}$/.test(config.forge.address);
const faddr = () => config.forge.address as `0x${string}`;

export type Forged = { n: number; tier: number; points: number; inputs: number[]; traits: number[]; forgedAt: number; name: string };
/** Forged frogs never change after the forge (except a Night Boss's one-time name), so each is read once. */
const forged = new Map<number, Forged>();
let readAt = 0;
export async function forgedAll(fresh = false): Promise<Forged[]> {
  if (!forgeOn()) return [];
  if (!fresh && Date.now() - readAt < 60_000) return [...forged.values()];
  try {
    // normal Night Watchers are 1 .. nextId - 1; The Captain is 0 once #1 is forged
    const [next, captain] = await Promise.all([
      eth.readContract({ address: faddr(), abi: FORGE_ABI, functionName: "nextId" }).then(Number),
      eth.readContract({ address: faddr(), abi: FORGE_ABI, functionName: "captainForged" }),
    ]);
    const ids = [...(captain ? [0] : []), ...Array.from({ length: Math.max(0, next - 1) }, (_, i) => i + 1)];
    const todo = ids.filter((n) => !forged.has(n) || (forged.get(n)!.tier >= 5 && !forged.get(n)!.name));
    if (todo.length) {
      const rows = await eth.multicall({ contracts: todo.flatMap((n) => [
        { address: faddr(), abi: FORGE_ABI, functionName: "forgeOf" as const, args: [BigInt(n)] },
        { address: faddr(), abi: FORGE_ABI, functionName: "nameOf" as const, args: [BigInt(n)] },
      ]), allowFailure: true });
      todo.forEach((n, i) => {
        const f = rows[i * 2], nm = rows[i * 2 + 1];
        if (f?.status !== "success") return;
        const [tier, points, inputs, traits, at] = f.result as readonly [number, number, readonly number[], readonly number[], bigint];
        forged.set(n, { n, tier, points, inputs: inputs.map(Number), traits: traits.map(Number), forgedAt: Number(at) * 1000, name: nm?.status === "success" ? String(nm.result) : "" });
      });
    }
    readAt = Date.now();
  } catch { /* keep what we have */ }
  return [...forged.values()].sort((a, b) => a.n - b.n);
}
export const forgedOf = (n: number) => forged.get(n) ?? null;
/** Shift hours a Night Watcher earns per hour, and the multiplier its missions use. */
export const forgedRate = (f: Forged) => watcherRate(f.tier, f.inputs);
export const forgedMissions = forgedRate;
