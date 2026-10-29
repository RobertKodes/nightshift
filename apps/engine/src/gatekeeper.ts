import { judge, normalize } from "./moderation.js";

/**
 * The door of the public group. The scammers here are people, not bots, so a captcha stops nobody: what
 * they need is to look like the team and to reach members in private. Join requests wearing the team's
 * names or carrying a scam bio are turned away, the doubtful ones wait for an admin, everyone let in is
 * told in private that admins never DM first, and a new member writes text only for their first day.
 */
export type Person = { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
export type Door = { action: "approve" | "decline" | "review"; reason: string };

/** Words only the team may wear: a joiner whose name or username has one is turned away. */
export const TEAM_WORDS = ["admin", "admins", "administrator", "support", "moderator", "mod", "mods", "helpdesk", "help desk", "customer care", "customer service", "tech support", "dev team", "core team", "imd support", "imd team"];
/** Words a fan may use too ("nightshift fan"): the request waits for an admin instead. */
export const BRAND_WORDS = ["nightshift", "night shift", "nightshiftimd", "official", "founder", "cofounder", "co founder", "ceo"];
/** A new member's first day: text only, no links, media or forwards, until the guard has seen them. */
export const QUIET_HOURS = 24;
export const QUIET = { can_send_messages: true, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false, can_invite_users: false };
/** What every person let in reads in private first. */
export const DOOR_NOTE = "🌙 Welcome to NIGHTSHIFT. One rule before you go in:\n\n⚠️ <b>Admins never DM first.</b> Anyone who messages you privately about support, an airdrop, a refund or connecting your wallet is a scammer, even with an admin's name and photo. Nobody here will ever ask for your seed phrase.\n\nThe only official links are on getnightshift.tech.";

// letters from other alphabets that pass for Latin ones ("Аdmin" with a Cyrillic А)
const LOOKALIKE: Record<string, string> = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "к": "k", "м": "m", "т": "t", "н": "h", "в": "b", "ԁ": "d", "ɡ": "g", "ո": "n", "α": "a", "ο": "o", "ι": "i", "ν": "v", "ρ": "p", "τ": "t" };
const latin = (s: string) => [...s.toLowerCase()].map((c) => LOOKALIKE[c] ?? c).join("");
const clean = (s: string) => normalize(latin(s).replace(/[_.]/g, " "));
const has = (hay: string, words: string[]) => words.find((w) => new RegExp(`(^|[^a-z])${w.replace(/ /g, "\\s*")}($|[^a-z])`).test(hay));

/** One letter added, dropped or swapped: "probert_mihal" for "probert_mihai". */
function close(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
const full = (p: Person) => clean(`${p.first_name ?? ""} ${p.last_name ?? ""}`);
const user = (p: Person) => clean(p.username ?? "");

/** A person as the admins read them in an alert: name, @username and id. */
export const whoIs = (p: Person) => `${[p.first_name, p.last_name].filter(Boolean).join(" ") || "someone"}${p.username ? ` @${p.username}` : ""} (${p.id})`;

/** Whether someone is dressed as the team: a team word, or the exact name or username of one of the admins. */
export function impostor(p: Person, admins: Person[]): string | null {
  const name = full(p), handle = user(p), both = `${name} ${handle}`;
  const word = has(both, TEAM_WORDS);
  if (word) return `"${word}" in the name`;
  for (const a of admins) {
    if (a.id === p.id) continue;
    if (name && name === full(a)) return "the same name as an admin";
    const mine = handle.replace(/\s/g, ""), theirs = user(a).replace(/\s/g, "");
    if (mine && theirs && (mine === theirs || (theirs.length >= 6 && close(mine, theirs)))) return "an admin's username";
  }
  return null;
}

/** The verdict on a join request: in, out, or wait for an admin. */
export function screen(p: Person, bio: string, admins: Person[], ctx: { ourAddresses: string[]; ourTelegram: string[] }): Door {
  if (p.is_bot) return { action: "decline", reason: "a bot account" };
  const fake = impostor(p, admins);
  if (fake) return { action: "decline", reason: `impostor: ${fake}` };
  const v = bio ? judge(bio, ctx) : null;
  if (v && v.level !== "fud") return { action: "decline", reason: `${v.level} in the bio: ${v.reason}` };
  const brand = has(`${full(p)} ${user(p)}`, BRAND_WORDS);
  if (brand) return { action: "review", reason: `"${brand}" in the name` };
  return { action: "approve", reason: "nothing suspicious" };
}
