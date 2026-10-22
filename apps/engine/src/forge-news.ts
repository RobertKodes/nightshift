import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { chats } from "./community.js";
import { config } from "./config.js";
import { type Forged, forgeOn, forgedAll, tierInfo } from "./forge.js";
import { type Button, telegramMedia } from "./social.js";

/** The three NIGHT WATCHERS contracts IMD deployed (launches #2437, #2445, #2436): the only ones the Forge is switched on with. */
export const FORGE_LIVE = { forge: "0xbdff33cffc3f617f808a6de012a2574dbf69d819", renderer: "0x053471879f65f6b4f644635fbdd798b9d7c5e1f5", skin: "0x8509cddf80cfc8cec4aaa3644b125de919da112e" } as const;

/** Night Watchers that can ever be forged (The Captain, token 0, comes on top with frog #1). */
export const WATCHERS = 50;

/** The community card for one new Night Watcher: what came out of the forge, from which frogs, and how many are left. */
export function evolveText(f: Forged, forged: number): string {
  const T = tierInfo(f.tier), left = Math.max(0, WATCHERS - forged);
  return [
    f.n === 0 ? "👑🌙 <b>THE CAPTAIN HAS BEEN FORGED</b>" : "🐸➡️🌙 <b>NIGHT FROGS JUST EVOLVED</b>",
    "",
    f.n === 0
      ? "NIGHT FROG #1 went into the forge, and the one and only <b>Captain</b> came out: a 1 of 1, forever."
      : `10 NIGHT FROGS went into the forge and <b>Night Watcher #${f.n}</b> came out: <b>Tier ${T.roman} · ${T.name}</b>, ${T.x}x shift hours.`,
    `Forged from ${f.inputs.map((i) => `#${i}`).join(" ")} · 1 $IMD burned`,
    "",
    f.n === 0 ? "" : left ? `${forged} of ${WATCHERS} forged · <b>${left} left</b>` : `All ${WATCHERS} Night Watchers are forged.`,
  ].filter((l, i, a) => l || a[i - 1]).join("\n").trim();
}

const file = () => join(config.dataDir, "forge-posted.json");
const buttons = (f: Forged): Button[][] => [
  [{ text: "🐸 The Forge", url: `${config.publicUrl}/forge` }],
  [{ text: `🔎 Night Watcher #${f.n} on Etherscan`, url: `https://etherscan.io/nft/${config.forge.address}/${f.n}` }],
];

/**
 * Every 2 minutes once the forge is set: each new Night Watcher is announced in the community chats once, with its
 * picture. A data folder that starts with several already forged marks them as told instead of posting them all.
 */
export function followForges(): void {
  const tick = async () => {
    if (!forgeOn() || !config.telegramToken) return;
    const all = await forgedAll(true);
    let seen: Set<number>;
    if (existsSync(file())) seen = new Set(JSON.parse(readFileSync(file(), "utf8")) as number[]);
    else { seen = new Set(all.length > 3 ? all.map((f) => f.n) : []); writeAtomic(file(), JSON.stringify([...seen])); }
    const fresh = all.filter((f) => !seen.has(f.n)).sort((a, b) => a.forgedAt - b.forgedAt || b.n - a.n);
    const count = all.filter((f) => f.n !== 0).length;
    for (const f of fresh.slice(0, 5)) {
      seen.add(f.n);
      writeAtomic(file(), JSON.stringify([...seen]));
      await Promise.all(chats().map((c) => telegramMedia(config.telegramToken, c, `${config.publicUrl}/api/forge/frog/${f.n}.png`, evolveText(f, count), buttons(f))));
    }
  };
  setInterval(() => void tick().catch((e) => console.error("forge news", e)), 2 * 60_000);
  void tick().catch(() => {});
}
