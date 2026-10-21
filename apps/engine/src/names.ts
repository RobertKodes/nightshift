import { judge } from "./moderation.js";

/**
 * Public names: pinball and chess players, arena agents, staked challenges. One rule for all of
 * them, so a name refused in one place is refused everywhere: plain letters, digits, space . - _,
 * nothing the community guard would delete, and nothing that reads as the project or its staff
 * however it is spelled (i.m.d, I-M-D, lMD, Nlghtshift, imdteam, Admin Support…).
 */

/** Zero-width, joiner, bidi, filler and control characters: invisible, or turning text around. */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;
/** Letters a name can pass for: l, 1, | and ! read as i; 0 as o; 3 as e; 5 and $ as s; 4 and @ as a; 7 as t. */
const LOOKS: Record<string, string> = { l: "i", "1": "i", "|": "i", "!": "i", "0": "o", "3": "e", "5": "s", $: "s", "4": "a", "@": "a", "7": "t" };
/** Read anywhere in a name, its letters run together: the project, IMD and staff titles. */
const CONTAINS = ["identitymd", "nightshift", "nightshif", "nighshift", "nightsift", "nitshift", "niteshift", "nightshft", "admin", "support", "moderator", "official", "getnightshift"];
/** IMD read at the edge of a word ("imdteam", "teamimd", "i m d"), not inside one ("Grimdark"). */
const EDGES = ["imd"];
/** Refused as a word of their own (they are too short to look for inside other words). */
const WORDS = ["mod", "mods", "dev", "devs", "team", "staff", "operator", "helpdesk"];

/** Lowercase, lookalikes undone, everything but letters made a space. */
const read = (s: string) => s.toLowerCase().replace(/[l1|!0354$@7]/g, (c) => LOOKS[c]!).replace(/[^a-z]+/g, " ").trim();
/** Runs of one letter made one ("suppport" → "suport"), so doubled letters do not hide a word. */
const single = (s: string) => s.replace(/(.)\1+/g, "$1");

/** Does this name read as one of ours? */
export function reserved(name: string): boolean {
  const words = read(name).split(" ").filter(Boolean), flat = words.join("");
  const forms = [flat, single(flat)];
  if (CONTAINS.some((w) => forms.some((f) => f.includes(w) || f.includes(single(w))))) return true;
  // letters spelled out one by one ("i m d") read as one word
  const joined: string[] = [];
  let run = "";
  for (const w of words) if (w.length === 1) run += w; else { if (run) joined.push(run); run = ""; joined.push(w); }
  if (run) joined.push(run);
  if (EDGES.some((e) => [...words, ...joined].some((w) => [w, single(w)].some((f) => f.startsWith(e) || f.endsWith(e))))) return true;
  return words.some((w) => WORDS.includes(w) || WORDS.includes(single(w)));
}

/**
 * A name fit to show to everyone, or null: NFKC (full-width and styled letters become plain ones),
 * invisible characters removed, only letters, digits, space . - _ kept, spaces collapsed, at most
 * `max` characters; refused when it is empty, reads as the project or its staff (in what is shown
 * or in what was typed), or is something the community guard deletes (slurs, scams, links).
 */
export function publicName(raw: unknown, o: { max: number }): string | null {
  const typed = String(raw ?? "").normalize("NFKC").replace(INVISIBLE, "");
  const n = typed.replace(/[^\w .-]/g, "").replace(/_+/g, "_").replace(/\s+/g, " ").trim().slice(0, o.max).trim();
  if (!n || !/[A-Za-z0-9]/.test(n)) return null;
  if (reserved(n) || reserved(typed)) return null;
  if (judge(n, { ourAddresses: [], ourTelegram: [] }) !== null || judge(typed, { ourAddresses: [], ourTelegram: [] }) !== null) return null;
  return n;
}

/** A player who gave no name plays under a handle from their wallet ("Frog-7F3A"), never a name everyone shares. */
export const walletHandle = (wallet: string | null | undefined): string | null => (wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet) ? `Frog-${wallet.slice(2, 6).toUpperCase()}` : null);
