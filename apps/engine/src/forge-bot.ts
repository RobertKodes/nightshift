import { config } from "./config.js";
import { FORGE_TIERS, type Forged, forgeOn, forgedAll, forgedRate, tierInfo } from "./forge.js";
import { gifIfReady, makeGifs } from "./forge-gif.js";

/**
 * /forge in Telegram: the Night Watchers, each shown moving (its GIF once made, its picture until
 * then), with the forge's numbers. /forge alone: the totals and the newest; /forge 4: one Night
 * Watcher; /forge tier 3 (or /forge boss, /forge iii): every Night Watcher of a tier.
 */
type Button = { text: string; url: string };
export type ForgeReply = { text: string; buttons: Button[][]; animation?: string; photo?: string };

const WATCHERS = 50;
const ago = (at: number, now: number) => { const m = Math.max(1, Math.round((now - at) / 60_000)); return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const label = (f: Forged) => (f.n === 0 ? "The Captain" : `Night Watcher #${f.n}${f.name ? ` “${f.name}”` : ""}`);
const tierLine = (f: Forged) => { const t = tierInfo(f.tier); return `Tier ${t.roman} · ${t.name}`; };
/** Its moving GIF when made, else its picture. */
const media = (f: Forged): Pick<ForgeReply, "animation" | "photo"> => (gifIfReady(f) ? { animation: `${config.publicUrl}/api/forge/frog/${f.n}.gif` } : { photo: `${config.publicUrl}/api/forge/frog/${f.n}.png` });
const buttons = (f?: Forged): Button[][] => [
  [{ text: "🔥 The Forge", url: `${config.publicUrl}/forge` }, { text: "🚀 THE SHIP", url: `${config.publicUrl}/ship` }],
  ...(f ? [[{ text: `🔎 ${f.n === 0 ? "The Captain" : `#${f.n}`} on Etherscan`, url: `https://etherscan.io/nft/${config.forge.address}/${f.n}` }]] : []),
];

/** A tier from what someone typed: 1-5, I-V, or its name ("boss", "chief", "supervisor", "foreman", "lead"). */
export function tierFrom(s: string): number | null {
  const x = s.toLowerCase().replace(/^tier\s*/, "").trim();
  const roman = ["i", "ii", "iii", "iv", "v"].indexOf(x);
  if (roman >= 0) return roman + 1;
  if (/^[1-5]$/.test(x)) return Number(x);
  const t = FORGE_TIERS.find((y) => y.name.toLowerCase().split(" ").some((w) => w === x) || y.name.toLowerCase() === x);
  return t ? t.tier : x === "captain" ? 6 : null;
}

/** One Night Watcher, everything about it. */
export function watcherText(f: Forged, all: Forged[], now = Date.now()): string {
  const t = tierInfo(f.tier), rate = forgedRate(f);
  const rank = [...all].sort((a, b) => forgedRate(b) - forgedRate(a) || a.n - b.n).findIndex((x) => x.n === f.n) + 1;
  return [
    `🌙 <b>${label(f).toUpperCase()}</b>`,
    `<b>${tierLine(f)}</b> · ${f.points} forge points`,
    "",
    `⚡ ${rate}x shift hours every hour · #${rank} of ${all.length} by earning`,
    `👥 +${t.crew}% for every other NIGHT FROG in its wallet · ${t.slots} company slots`,
    `🔥 Forged ${ago(f.forgedAt, now)} from ${f.inputs.map((i) => `#${i}`).join(" ")}`,
    "",
    "<i>/forge for the totals · /forge tier 3 for a tier</i>",
  ].join("\n");
}

/** The totals and the newest Night Watcher. */
export function forgeText(all: Forged[], now = Date.now()): string {
  const watchers = all.filter((f) => f.n !== 0), captain = all.find((f) => f.n === 0);
  const burned = watchers.length * 10 + (captain && !watchers.length ? 10 : 0);
  const tiers = [...FORGE_TIERS].reverse().map((t) => [t, watchers.filter((f) => f.tier === t.tier).length] as const).filter(([, n]) => n > 0);
  const earning = all.reduce((s, f) => s + forgedRate(f), 0);
  const top = [...all].sort((a, b) => forgedRate(b) - forgedRate(a) || a.n - b.n)[0];
  const latest = [...all].sort((a, b) => b.forgedAt - a.forgedAt)[0];
  if (!all.length) return ["🔥 <b>THE FORGE</b>", "", "No Night Watcher forged yet. Burn 10 NIGHT FROGS, forge 1 Night Watcher: the rarer the 10, the higher the tier.", `Up to ${WATCHERS} can ever exist.`].join("\n");
  return [
    "🔥 <b>THE FORGE · NIGHT WATCHERS</b>",
    "",
    `<b>${watchers.length}</b> of ${WATCHERS} forged · <b>${WATCHERS - watchers.length} left</b>${captain ? " · 👑 The Captain is out" : ""}`,
    `🐸 <b>${burned}</b> NIGHT FROGS burned forever`,
    tiers.map(([t, n]) => `${t.roman} ${t.name} ×${n}`).join(" · "),
    `⚡ ${earning}x shift hours an hour between them${top ? ` · top: ${label(top)}, ${forgedRate(top)}x` : ""}`,
    "",
    latest ? `🆕 Newest: <b>${label(latest)}</b>, ${tierLine(latest)}, ${ago(latest.forgedAt, now)}` : "",
    latest ? `Forged from ${latest.inputs.map((i) => `#${i}`).join(" ")}` : "",
    "",
    "<i>/forge 4 for one · /forge tier 3 for a tier</i>",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n").trim();
}

export async function forgeReply(args: string[], now = Date.now()): Promise<ForgeReply> {
  if (!forgeOn()) return { text: "🔥 <b>THE FORGE</b>\nThe forge is not open yet. It turns 10 NIGHT FROGS into 1 Night Watcher.", buttons: buttons() };
  const all = await forgedAll();
  makeGifs(all);
  const q = args.join(" ").trim().replace(/^#/, "");
  // /forge 4 · /forge captain
  if (/^\d{1,2}$/.test(q) || q.toLowerCase() === "captain") {
    const f = all.find((x) => x.n === (q.toLowerCase() === "captain" ? 0 : Number(q)));
    if (!f) return { text: `No Night Watcher #${q} yet: ${all.filter((x) => x.n !== 0).length} are forged so far.`, buttons: buttons() };
    return { text: watcherText(f, all, now), buttons: buttons(f), ...media(f) };
  }
  // /forge tier 3 · /forge boss
  if (q) {
    const tier = tierFrom(q);
    if (tier === null) return { text: "Try /forge, /forge 4, or /forge tier 3 (I to V, or boss, chief, supervisor, foreman, lead).", buttons: buttons() };
    const these = all.filter((f) => f.tier === tier).sort((a, b) => b.forgedAt - a.forgedAt);
    const t = tierInfo(tier);
    if (!these.length) return { text: `🔥 No <b>Tier ${t.roman} · ${t.name}</b> forged yet (${t.min} forge points, ${t.x}x shift hours). The rarer the 10 frogs, the higher the tier.`, buttons: buttons() };
    const text = [`🔥 <b>TIER ${t.roman} · ${t.name.toUpperCase()}</b> · ${these.length} forged`, `${t.x}x shift hours or more · +${t.crew}% crew boost · ${t.slots} company slots`, "", ...these.slice(0, 15).map((f) => `• ${label(f)} · ${forgedRate(f)}x · ${ago(f.forgedAt, now)}`)].join("\n");
    return { text, buttons: buttons(these[0]), ...media(these[0]!) };
  }
  const latest = [...all].sort((a, b) => b.forgedAt - a.forgedAt)[0];
  return { text: forgeText(all, now), buttons: buttons(latest), ...(latest ? media(latest) : {}) };
}
