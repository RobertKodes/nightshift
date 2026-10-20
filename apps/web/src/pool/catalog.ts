/**
 * NIGHT POOL cosmetics: every item in the locker, with its design (the parameters the browser's
 * procedural art draws it from: three.js materials for cues, cloths, tables and balls; SVG for
 * frames, banners, effects and emotes). Items are numbered editions: a fixed supply, each copy with
 * its own serial ("NIGHT FROG Cue #7, 1 of 50"). Standard issue is everyone's and unnumbered.
 *
 * Cosmetic only. The one stat any item has is the aim guide's length on a cue, at most +12%, and
 * it never applies in a staked game (fair play: the same guide for both players). No item changes
 * power, spin, accuracy or anything the server simulates.
 *
 * Prices are listed in four assets (IMD, ETH, $SHIFT, USDC); the vault shop sells them later
 * (locker.ts: purchase()).
 * Keep apps/engine/src/pool/catalog.ts byte-identical to apps/web/src/pool/catalog.ts (a test checks it).
 */
export type Kind = "cue" | "cloth" | "table" | "balls" | "frame" | "banner" | "title" | "effect" | "emote";
export const KINDS: readonly Kind[] = ["cue", "cloth", "table", "balls", "frame", "banner", "title", "effect", "emote"];
export type Rarity = "standard" | "rare" | "epic" | "legendary" | "mythic";
export type Asset = "IMD" | "ETH" | "SHIFT" | "USDC";
export const ASSETS: readonly Asset[] = ["IMD", "ETH", "SHIFT", "USDC"];
export type Price = Record<Asset, string>;
/** Numbered copies per rarity: standard issue is unlimited and unnumbered. */
export const SUPPLY: Record<Rarity, number | null> = { standard: null, rare: 1000, epic: 250, legendary: 50, mythic: 7 };
/** The listed price of each rarity (the vault shop sets the final ones). */
export const PRICES: Record<Exclude<Rarity, "standard">, Price> = {
  rare: { USDC: "4", ETH: "0.0012", IMD: "0.6", SHIFT: "24000" },
  epic: { USDC: "12", ETH: "0.0035", IMD: "1.8", SHIFT: "72000" },
  legendary: { USDC: "39", ETH: "0.011", IMD: "5.7", SHIFT: "230000" },
  mythic: { USDC: "149", ETH: "0.042", IMD: "21.7", SHIFT: "880000" },
};
/** How an item is had: everyone's, earned (a level or a badge), or bought in the vault shop. */
export type Unlock = { by: "starter" } | { by: "level"; level: number } | { by: "badge"; badge: string } | { by: "shop" };
export type CueDesign = {
  /** The butt's wood or finish, its wrap, the shaft, the rings and joint metal, the inlay motif and colour, an optional glow. */
  butt: string; wrap: string; shaft: string; metal: string; inlay: "stars" | "lily" | "circuit" | "rings" | "frog" | "crown" | "rivets" | "diamonds"; inlayColor: string;
  glow?: string; gloss: number; tip: string;
};
export type ClothDesign = { color: string; sheen: string; pattern: "none" | "lily" | "grid" | "stars" | "frog" | "weave"; patternColor: string };
export type TableDesign = { wood: string; rail: string; metal: string; diamonds: string; glow?: string; gloss: number; claws?: boolean };
export type BallsDesign = { style: "classic" | "neon" | "pastel" | "chrome" | "frog"; colors: readonly string[]; number: string; cue: string };
export type FrameDesign = { motif: "ring" | "lily" | "circuit" | "crown" | "stars" | "genesis"; colors: readonly string[] };
export type BannerDesign = { motif: "station" | "pond" | "grid" | "chorus" | "stars" | "break"; colors: readonly string[] };
export type TitleDesign = { text: string; color: string };
export type EffectDesign = { motif: "sparks" | "fireflies" | "lily" | "rings" | "frogs"; colors: readonly string[] };
export type EmoteDesign = { text: string; glyph: "gg" | "thumb" | "frog" | "oops" | "think" | "flame" | "eyes" | "hands"; color: string };
export type Design = CueDesign | ClothDesign | TableDesign | BallsDesign | FrameDesign | BannerDesign | TitleDesign | EffectDesign | EmoteDesign;
export type Item = {
  id: string; kind: Kind; name: string; line: string; rarity: Rarity; unlock: Unlock;
  /** A cue's aim guide: extra length in percent (0–12), free games only. */
  guide?: number;
  design: Design;
};

// the classic ball colours, 1–7 (9–15 repeat them on a stripe)
const CLASSIC = ["#f4c20d", "#1d4fd8", "#d62828", "#5b2a86", "#f2711c", "#1a7f3c", "#7a1f1f"];
export const CATALOG: readonly Item[] = [
  // ---- cues
  { id: "cue-crew", kind: "cue", name: "Night Crew Cue", line: "Standard issue for every shift. Maple shaft, ebony butt, violet wrap.", rarity: "standard", unlock: { by: "starter" },
    design: { butt: "#17112e", wrap: "#5a3fd6", shaft: "#e8d9b8", metal: "#c9c6d8", inlay: "stars", inlayColor: "#e9e2ff", gloss: 0.55, tip: "#3a5fd6" } },
  { id: "cue-lily", kind: "cue", name: "Lily Pad Cue", line: "Green-stained maple with lily pads inlaid round the butt.", rarity: "rare", unlock: { by: "level", level: 3 }, guide: 3,
    design: { butt: "#1f4d2c", wrap: "#0d1f14", shaft: "#efe2c2", metal: "#d8e8c8", inlay: "lily", inlayColor: "#b8ff4a", gloss: 0.6, tip: "#2f7a3a" } },
  { id: "cue-circuit", kind: "cue", name: "Lime Circuit Cue", line: "Carbon black, traced with lime circuitry that lights up at the strike.", rarity: "rare", unlock: { by: "shop" }, guide: 4,
    design: { butt: "#0b0b10", wrap: "#16161f", shaft: "#d9d4c8", metal: "#8e93a3", inlay: "circuit", inlayColor: "#b8ff4a", glow: "#b8ff4a", gloss: 0.8, tip: "#1d1d26" } },
  { id: "cue-starlit", kind: "cue", name: "Starlit Maple", line: "Birdseye maple, a field of mother-of-pearl stars, a lilac joint.", rarity: "epic", unlock: { by: "shop" }, guide: 5,
    design: { butt: "#caa978", wrap: "#2b1d55", shaft: "#f1e6cc", metal: "#e9e2ff", inlay: "stars", inlayColor: "#ffffff", gloss: 0.7, tip: "#5a3fd6" } },
  { id: "cue-ultra", kind: "cue", name: "Ultraviolet Cue", line: "Purpleheart with UV rings that glow on the night shift.", rarity: "epic", unlock: { by: "shop" }, guide: 6,
    design: { butt: "#4b1f7a", wrap: "#1a0d33", shaft: "#e6d8bd", metal: "#a48bff", inlay: "rings", inlayColor: "#a48bff", glow: "#7c5cff", gloss: 0.85, tip: "#7c5cff" } },
  { id: "cue-swamp", kind: "cue", name: "Swamp King Cue", line: "Bog oak and gold. Earned, never bought: level 12.", rarity: "epic", unlock: { by: "level", level: 12 }, guide: 6,
    design: { butt: "#1c2b14", wrap: "#0c1209", shaft: "#e9dcbc", metal: "#ffc46b", inlay: "crown", inlayColor: "#ffc46b", gloss: 0.65, tip: "#2f4a1c" } },
  { id: "cue-station", kind: "cue", name: "Station Nine Cue", line: "Chrome and violet from the station's machine shop, riveted, monogrammed NS.", rarity: "legendary", unlock: { by: "shop" }, guide: 8,
    design: { butt: "#2a2840", wrap: "#7c5cff", shaft: "#dcd6cc", metal: "#e6e8f0", inlay: "rivets", inlayColor: "#e6e8f0", glow: "#a48bff", gloss: 0.95, tip: "#2a2840" } },
  { id: "cue-frog", kind: "cue", name: "NIGHT FROG Cue", line: "Black lacquer, lime NIGHT FROGS inlaid, a gold joint, eyes that glow at the butt.", rarity: "legendary", unlock: { by: "shop" }, guide: 8,
    design: { butt: "#07060c", wrap: "#121018", shaft: "#ece0c4", metal: "#ffc46b", inlay: "frog", inlayColor: "#b8ff4a", glow: "#b8ff4a", gloss: 0.95, tip: "#b8ff4a" } },
  { id: "cue-genesis", kind: "cue", name: "Genesis Frog Cue", line: "Obsidian, gold and seven diamonds. Seven exist.", rarity: "mythic", unlock: { by: "shop" }, guide: 10,
    design: { butt: "#05040a", wrap: "#ffc46b", shaft: "#f3e8cf", metal: "#ffd98a", inlay: "diamonds", inlayColor: "#ffffff", glow: "#ffc46b", gloss: 1, tip: "#ffc46b" } },
  // ---- cloths
  { id: "cloth-night", kind: "cloth", name: "Night Felt", line: "Deep violet worsted, the house cloth.", rarity: "standard", unlock: { by: "starter" },
    design: { color: "#2b1d63", sheen: "#7c5cff", pattern: "weave", patternColor: "#3a2a7a" } },
  { id: "cloth-pond", kind: "cloth", name: "Lily Pond", line: "Teal-green, with lily pads under the nap.", rarity: "rare", unlock: { by: "level", level: 5 },
    design: { color: "#0f4a3c", sheen: "#59d68f", pattern: "lily", patternColor: "#16624f" } },
  { id: "cloth-ember", kind: "cloth", name: "Night Ember", line: "Burgundy for the late games.", rarity: "rare", unlock: { by: "shop" },
    design: { color: "#4a1030", sheen: "#ff6b7d", pattern: "weave", patternColor: "#5a1a3c" } },
  { id: "cloth-grid", kind: "cloth", name: "UV Grid", line: "Ultraviolet with a faint lime grid: the station's training table.", rarity: "epic", unlock: { by: "shop" },
    design: { color: "#24125e", sheen: "#a48bff", pattern: "grid", patternColor: "#b8ff4a" } },
  { id: "cloth-stars", kind: "cloth", name: "Starfield", line: "Near-black blue with a scatter of stars.", rarity: "epic", unlock: { by: "shop" },
    design: { color: "#0b0f2a", sheen: "#8fb0ff", pattern: "stars", patternColor: "#e9e2ff" } },
  { id: "cloth-frog", kind: "cloth", name: "Frog Chorus Felt", line: "Royal purple with the NIGHT FROG crest at the centre spot.", rarity: "legendary", unlock: { by: "shop" },
    design: { color: "#3a1680", sheen: "#c9b8ff", pattern: "frog", patternColor: "#b8ff4a" } },
  // ---- tables
  { id: "table-shift", kind: "table", name: "Shift Oak Table", line: "Walnut rails, violet diamonds, brushed steel pockets.", rarity: "standard", unlock: { by: "starter" },
    design: { wood: "#4a2e1f", rail: "#3a2418", metal: "#b9b6c6", diamonds: "#a48bff", gloss: 0.55 } },
  { id: "table-ebony", kind: "table", name: "Ebony Night Table", line: "Black lacquer and silver.", rarity: "rare", unlock: { by: "shop" },
    design: { wood: "#0d0b12", rail: "#16131e", metal: "#e6e8f0", diamonds: "#e9e2ff", gloss: 0.9 } },
  { id: "table-uv", kind: "table", name: "UV Lounge Table", line: "Violet lacquer, chrome corners, a glow under the rails.", rarity: "epic", unlock: { by: "shop" },
    design: { wood: "#2d1466", rail: "#3a1a80", metal: "#e6e8f0", diamonds: "#b8ff4a", glow: "#7c5cff", gloss: 0.9 } },
  { id: "table-station", kind: "table", name: "Station Deck Table", line: "Gunmetal plate from the station, a lime strip under the cushions.", rarity: "epic", unlock: { by: "shop" },
    design: { wood: "#2a2c36", rail: "#3a3d4a", metal: "#9aa0b4", diamonds: "#b8ff4a", glow: "#b8ff4a", gloss: 0.7 } },
  { id: "table-throne", kind: "table", name: "Swamp Throne Table", line: "Bog oak, gold claws at every corner.", rarity: "legendary", unlock: { by: "shop" },
    design: { wood: "#1e2a15", rail: "#26361a", metal: "#ffc46b", diamonds: "#ffc46b", gloss: 0.75, claws: true } },
  // ---- balls
  { id: "balls-classic", kind: "balls", name: "Classic Set", line: "The colours every player reads at a glance.", rarity: "standard", unlock: { by: "starter" },
    design: { style: "classic", colors: CLASSIC, number: "#111111", cue: "#f7f4ea" } },
  { id: "balls-pastel", kind: "balls", name: "Lilac Dawn Set", line: "Soft pastels, the same order as the classic set.", rarity: "rare", unlock: { by: "shop" },
    design: { style: "pastel", colors: ["#ffe27a", "#7aa7ff", "#ff8a8a", "#b78cff", "#ffb27a", "#7fe0a8", "#c98a8a"], number: "#2b1d55", cue: "#fbf8ff" } },
  { id: "balls-neon", kind: "balls", name: "Neon Night Set", line: "Saturated neon with glowing numbers.", rarity: "rare", unlock: { by: "badge", badge: "night-shark" },
    design: { style: "neon", colors: ["#ffe600", "#2f7bff", "#ff2d55", "#a24bff", "#ff8a00", "#1fe07a", "#ff4d8d"], number: "#0b0b10", cue: "#f2f2ff" } },
  { id: "balls-frog", kind: "balls", name: "Frog Spawn Set", line: "Classic colours with speckled frog skin on the stripes.", rarity: "epic", unlock: { by: "shop" },
    design: { style: "frog", colors: CLASSIC, number: "#111111", cue: "#eef5e0" } },
  { id: "balls-chrome", kind: "balls", name: "Chrome Shift Set", line: "Polished metal over the classic colours.", rarity: "legendary", unlock: { by: "shop" },
    design: { style: "chrome", colors: CLASSIC, number: "#111111", cue: "#f4f6fb" } },
  // ---- profile frames
  { id: "frame-none", kind: "frame", name: "Crew Ring", line: "A thin violet ring.", rarity: "standard", unlock: { by: "starter" }, design: { motif: "ring", colors: ["#7c5cff", "#a48bff"] } },
  { id: "frame-lily", kind: "frame", name: "Lily Frame", line: "Lily pads and buds around your face.", rarity: "rare", unlock: { by: "level", level: 5 }, design: { motif: "lily", colors: ["#59d68f", "#b8ff4a", "#ff9ad5"] } },
  { id: "frame-circuit", kind: "frame", name: "Circuit Frame", line: "Lime traces from the station's boards.", rarity: "rare", unlock: { by: "shop" }, design: { motif: "circuit", colors: ["#b8ff4a", "#1d2a10"] } },
  { id: "frame-stars", kind: "frame", name: "Ultraviolet Frame", line: "A double UV ring with stars.", rarity: "epic", unlock: { by: "shop" }, design: { motif: "stars", colors: ["#7c5cff", "#e9e2ff"] } },
  { id: "frame-crown", kind: "frame", name: "Frog Crown Frame", line: "A gold frog crown sits on top.", rarity: "epic", unlock: { by: "badge", badge: "break-and-run" }, design: { motif: "crown", colors: ["#ffc46b", "#b8ff4a"] } },
  { id: "frame-genesis", kind: "frame", name: "Genesis Frame", line: "Gold, seven diamonds and two glowing eyes.", rarity: "legendary", unlock: { by: "shop" }, design: { motif: "genesis", colors: ["#ffd98a", "#ffffff", "#b8ff4a"] } },
  // ---- banners
  { id: "banner-shift", kind: "banner", name: "Night Shift", line: "The station's skyline in violet.", rarity: "standard", unlock: { by: "starter" }, design: { motif: "station", colors: ["#140b33", "#3b2a8f", "#a48bff"] } },
  { id: "banner-break", kind: "banner", name: "The Break", line: "A rack exploding in lime and violet.", rarity: "rare", unlock: { by: "badge", badge: "eight-on-break" }, design: { motif: "break", colors: ["#0b0820", "#7c5cff", "#b8ff4a"] } },
  { id: "banner-pond", kind: "banner", name: "Lily Pond", line: "A still pond, the lily pads in bloom.", rarity: "rare", unlock: { by: "level", level: 8 }, design: { motif: "pond", colors: ["#062a26", "#0f5a48", "#ff9ad5"] } },
  { id: "banner-grid", kind: "banner", name: "Neon Horizon", line: "A UV grid to the horizon.", rarity: "epic", unlock: { by: "shop" }, design: { motif: "grid", colors: ["#05030f", "#7c5cff", "#b8ff4a"] } },
  { id: "banner-chorus", kind: "banner", name: "Frog Chorus", line: "The NIGHT FROGS, singing in a row.", rarity: "epic", unlock: { by: "shop" }, design: { motif: "chorus", colors: ["#120a2e", "#b8ff4a", "#e9e2ff"] } },
  { id: "banner-stars", kind: "banner", name: "Deep Field", line: "A starfield behind the 8-ball.", rarity: "legendary", unlock: { by: "shop" }, design: { motif: "stars", colors: ["#02010a", "#2b1d63", "#ffc46b"] } },
  // ---- titles
  { id: "title-rookie", kind: "title", name: "Rookie", line: "Everyone starts somewhere.", rarity: "standard", unlock: { by: "starter" }, design: { text: "Rookie", color: "#b3abc9" } },
  { id: "title-crew", kind: "title", name: "Night Crew", line: "One of the shift.", rarity: "standard", unlock: { by: "starter" }, design: { text: "Night Crew", color: "#a48bff" } },
  { id: "title-ultra", kind: "title", name: "Ultraviolet", line: "Seen best in the dark.", rarity: "rare", unlock: { by: "shop" }, design: { text: "Ultraviolet", color: "#a48bff" } },
  { id: "title-shark", kind: "title", name: "Night Shark", line: "Ten racks won.", rarity: "rare", unlock: { by: "badge", badge: "night-shark" }, design: { text: "Night Shark", color: "#8fb0ff" } },
  { id: "title-eight", kind: "title", name: "Eight on the Break", line: "Dropped the 8 on a break.", rarity: "rare", unlock: { by: "badge", badge: "eight-on-break" }, design: { text: "Eight on the Break", color: "#ffc46b" } },
  { id: "title-runner", kind: "title", name: "Table Runner", line: "Broke and ran a rack.", rarity: "epic", unlock: { by: "badge", badge: "break-and-run" }, design: { text: "Table Runner", color: "#b8ff4a" } },
  { id: "title-hustler", kind: "title", name: "Lily Pad Hustler", line: "Never trust a frog with a cue.", rarity: "epic", unlock: { by: "shop" }, design: { text: "Lily Pad Hustler", color: "#59d68f" } },
  { id: "title-frogfather", kind: "title", name: "The Frogfather", line: "An offer the table cannot refuse.", rarity: "legendary", unlock: { by: "shop" }, design: { text: "The Frogfather", color: "#ffd98a" } },
  // ---- win effects
  { id: "effect-sparks", kind: "effect", name: "Sparks", line: "A shower of violet sparks.", rarity: "standard", unlock: { by: "starter" }, design: { motif: "sparks", colors: ["#a48bff", "#e9e2ff"] } },
  { id: "effect-fireflies", kind: "effect", name: "Fireflies", line: "Lime fireflies rise from the pockets.", rarity: "rare", unlock: { by: "level", level: 10 }, design: { motif: "fireflies", colors: ["#b8ff4a", "#fff7a8"] } },
  { id: "effect-rings", kind: "effect", name: "Neon Rings", line: "UV rings burst from the last pocket.", rarity: "epic", unlock: { by: "shop" }, design: { motif: "rings", colors: ["#7c5cff", "#b8ff4a"] } },
  { id: "effect-lily", kind: "effect", name: "Lily Bloom", line: "Lily pads bloom across the cloth.", rarity: "epic", unlock: { by: "shop" }, design: { motif: "lily", colors: ["#59d68f", "#ff9ad5"] } },
  { id: "effect-frogs", kind: "effect", name: "Frog Parade", line: "NIGHT FROGS hop across the table.", rarity: "legendary", unlock: { by: "shop" }, design: { motif: "frogs", colors: ["#b8ff4a", "#ffc46b", "#e9e2ff"] } },
  // ---- emotes
  { id: "emote-gg", kind: "emote", name: "GG", line: "Good game.", rarity: "standard", unlock: { by: "starter" }, design: { text: "GG", glyph: "gg", color: "#e9e2ff" } },
  { id: "emote-nice", kind: "emote", name: "Nice shot", line: "Credit where it is due.", rarity: "standard", unlock: { by: "starter" }, design: { text: "Nice shot!", glyph: "thumb", color: "#b8ff4a" } },
  { id: "emote-oops", kind: "emote", name: "Oops", line: "It happens.", rarity: "standard", unlock: { by: "starter" }, design: { text: "Oops", glyph: "oops", color: "#ffc46b" } },
  { id: "emote-ribbit", kind: "emote", name: "Ribbit!", line: "The frog in you.", rarity: "rare", unlock: { by: "level", level: 2 }, design: { text: "Ribbit!", glyph: "frog", color: "#b8ff4a" } },
  { id: "emote-think", kind: "emote", name: "Thinking", line: "Let me see this one.", rarity: "rare", unlock: { by: "shop" }, design: { text: "Thinking…", glyph: "think", color: "#a48bff" } },
  { id: "emote-wp", kind: "emote", name: "Well played", line: "A tip of the cue.", rarity: "rare", unlock: { by: "shop" }, design: { text: "Well played", glyph: "hands", color: "#8fb0ff" } },
  { id: "emote-fire", kind: "emote", name: "On fire", line: "Three in a row.", rarity: "epic", unlock: { by: "shop" }, design: { text: "On fire", glyph: "flame", color: "#ff8a3d" } },
  { id: "emote-eyes", kind: "emote", name: "Frog stare", line: "Two glowing eyes, saying nothing.", rarity: "epic", unlock: { by: "shop" }, design: { text: "…", glyph: "eyes", color: "#b8ff4a" } },
];
export const ITEMS = new Map(CATALOG.map((i) => [i.id, i]));
/** What a new player wears: the standard issue of every kind. */
export const STARTER: Record<Exclude<Kind, "emote">, string> & { emote: string[] } = {
  cue: "cue-crew", cloth: "cloth-night", table: "table-shift", balls: "balls-classic", frame: "frame-none", banner: "banner-shift", title: "title-rookie", effect: "effect-sparks",
  emote: ["emote-gg", "emote-nice", "emote-oops"],
};
/** At most this many emotes in a player's set. */
export const MAX_EMOTES = 6;
export const supplyOf = (i: Item) => SUPPLY[i.rarity];
export const priceOf = (i: Item): Price | null => (i.unlock.by === "shop" && i.rarity !== "standard" ? PRICES[i.rarity] : null);
/** "NIGHT FROG Cue #7, 1 of 50", or the item's name for standard issue. */
export const editionText = (i: Item, serial?: number | null) => (supplyOf(i) && serial ? `${i.name} #${serial}, 1 of ${supplyOf(i)}` : i.name);

// ---- the gaming profile's levels and badges (shared so the page shows the same thresholds)

/** XP needed to reach a level: 100, 300, 600, 1000, … (level n at 50·n·(n−1)). */
export const xpFor = (level: number) => 50 * level * (level - 1);
export const levelOf = (xp: number) => { let n = 1; while (xpFor(n + 1) <= xp && n < 200) n++; return n; };
export type BadgeId = "first-break" | "first-win" | "night-shark" | "break-and-run" | "eight-on-break" | "clean-sheet" | "staked" | "level-10" | "chess-win" | "pinball-win";
export const BADGES: Record<BadgeId, { name: string; line: string }> = {
  "first-break": { name: "First Break", line: "Played a rack of NIGHT POOL." },
  "first-win": { name: "First Rack", line: "Won a rack of NIGHT POOL." },
  "night-shark": { name: "Night Shark", line: "Won ten racks." },
  "break-and-run": { name: "Break and Run", line: "Broke and ran out a rack: the rival never came to the table." },
  "eight-on-break": { name: "Eight on the Break", line: "Dropped the 8-ball on a break." },
  "clean-sheet": { name: "Clean Sheet", line: "Won with all seven of the rival's group still on the table." },
  staked: { name: "High Stakes", line: "Played a staked duel." },
  "level-10": { name: "Shift Lead", line: "Reached level 10." },
  "chess-win": { name: "Checkmate", line: "Won a game of NIGHT CHESS." },
  "pinball-win": { name: "Flipper", line: "Won a Space Pinball duel." },
};
