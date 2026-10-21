import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";
import { publicName } from "./names.js";
import type { Look, PoolEvent } from "./pool.js";
import { ASSETS, type Asset, BADGES, type BadgeId, CATALOG, ITEMS, type Item, KINDS, type Kind, MAX_EMOTES, STARTER, editionText, levelOf, priceOf, supplyOf, xpFor } from "./pool/catalog.js";

/**
 * The gaming profile and the locker, one per player across the Game Room, kept by the signed-in
 * wallet (a Telegram player's NIGHT CHESS and Space Pinball games count too, under its play key:
 * the linked wallet, else tg:<pid>). Levels and XP from games, badges,
 * stats per game, an avatar, and the cosmetics (pool/catalog.ts): what the player owns, each copy of
 * a numbered edition with its serial, and what they wear. Kept in DATA_DIR/locker.json.
 *
 * Copies are handed out in order (#1, #2, …) and never twice: an edition's serials are counted on
 * the item, and a copy belongs to one profile. Standard issue is everyone's, unnumbered. Items come
 * from levels and badges now; the vault shop (purchase()) opens later.
 */
export type Game = "pool" | "chess" | "pinball" | "poker";
export type GameStats = { played: number; wins: number; losses: number; draws: number; streak: number; best: number };
export type Owned = { id: string; serial: number | null; at: number; via: "reward" | "purchase" | "grant" };
export type Profile = {
  key: string; name: string; joinedAt: number; seenAt: number;
  /** A crew frog (0–4), shown on the profile and at the table. */
  avatar: number;
  xp: number; badges: { id: BadgeId; at: number }[];
  stats: Record<Game, GameStats>; potted: number;
  items: Owned[];
  equip: Record<Exclude<Kind, "emote">, string> & { emote: string[] };
};
const fresh = (): GameStats => ({ played: 0, wins: 0, losses: 0, draws: 0, streak: 0, best: 0 });
/** XP for a finished game: more for a win, a little for every ball of yours you dropped. */
export const XP = { pool: { win: 100, loss: 40, ball: 5 }, chess: { win: 80, loss: 30, draw: 50 }, pinball: { win: 60, loss: 25, draw: 40 }, poker: { win: 90, loss: 35, draw: 45 } } as const;
const KEY = /^(0x[0-9a-f]{40}|tg:[0-9a-f]{16})$/;
export const isKey = (k: unknown): k is string => typeof k === "string" && KEY.test(k);
const MAX_PROFILES = 300_000;

export class Locker {
  #profiles = new Map<string, Profile>();
  /** Copies handed out per item: the next copy is minted + 1. */
  #minted = new Map<string, number>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #unlocked: ((key: string, item: Item, serial: number | null) => void)[] = [];
  constructor(private file: string | null = join(config.dataDir, "locker.json"), private now = () => Date.now()) {
    try {
      if (file && existsSync(file)) {
        const d = JSON.parse(readFileSync(file, "utf8")) as { profiles?: Profile[]; minted?: Record<string, number> };
        for (const p of d.profiles ?? []) if (isKey(p?.key)) this.#profiles.set(p.key, this.#heal(p));
        for (const [k, v] of Object.entries(d.minted ?? {})) if (Number.isInteger(v)) this.#minted.set(k, v);
      }
    } catch (e) { console.error("locker not read:", (e as Error).message); }
  }
  /** A profile from an older file: every game's stats present, equipped items that still exist. */
  #heal(p: Profile): Profile {
    p.stats = Object.assign({ pool: fresh(), chess: fresh(), pinball: fresh(), poker: fresh() }, p.stats ?? {});
    p.items = (p.items ?? []).filter((o) => ITEMS.has(o.id));
    p.equip = { ...STARTER, ...(p.equip ?? {}) };
    for (const k of KINDS) if (k !== "emote" && !this.#owns(p, (p.equip as Record<string, string>)[k]!)) (p.equip as Record<string, string>)[k] = (STARTER as Record<string, string>)[k]!;
    p.equip.emote = (Array.isArray(p.equip.emote) ? p.equip.emote : STARTER.emote).filter((id) => this.#owns(p, id)).slice(0, MAX_EMOTES);
    p.badges ??= []; p.xp ??= 0; p.potted ??= 0; p.avatar = Number.isInteger(p.avatar) ? Math.max(0, Math.min(4, p.avatar)) : 0;
    return p;
  }
  onUnlock(f: (key: string, item: Item, serial: number | null) => void): void { this.#unlocked.push(f); }
  save(): void {
    if (!this.file || this.#timer) return;
    this.#timer = setTimeout(() => { this.#timer = null; this.flush(); }, 500);
    this.#timer.unref?.();
  }
  flush(): void {
    if (!this.file) return;
    try { mkdirSync(dirname(this.file), { recursive: true }); writeAtomic(this.file, JSON.stringify({ profiles: [...this.#profiles.values()], minted: Object.fromEntries(this.#minted) })); } catch (e) { console.error("locker.json not saved:", (e as Error).message); }
  }
  get size() { return this.#profiles.size; }
  get(key: string): Profile | undefined { return this.#profiles.get(key.toLowerCase()); }
  /** The profile for this key, made on first sight (a crew frog picked from the key, the standard issue on). */
  profile(key: string, name?: string): Profile {
    const k = key.toLowerCase();
    if (!isKey(k)) throw new Error("No such player");
    let p = this.#profiles.get(k);
    if (!p) {
      if (this.#profiles.size >= MAX_PROFILES) throw new Error("Too many players right now. Try again later.");
      p = { key: k, name: publicName(name ?? "", { max: 18 }) ?? "Night crew", joinedAt: this.now(), seenAt: this.now(), avatar: parseInt(k.slice(-2), 16) % 5,
        xp: 0, badges: [], stats: { pool: fresh(), chess: fresh(), pinball: fresh(), poker: fresh() }, potted: 0, items: [], equip: { ...STARTER, emote: [...STARTER.emote] } };
      this.#profiles.set(k, p);
      this.save();
    } else if (name) { const n = publicName(name, { max: 18 }); if (n && n !== p.name) { p.name = n; this.save(); } }
    return p;
  }
  #owns(p: Profile, id: string): boolean { const i = ITEMS.get(id); return !!i && (i.rarity === "standard" || p.items.some((o) => o.id === id)); }
  owns(key: string, id: string): boolean { const p = this.get(key); return p ? this.#owns(p, id) : ITEMS.get(id)?.rarity === "standard"; }
  /** Copies of an item still to be had. */
  left(id: string): number | null { const i = ITEMS.get(id); const s = i ? supplyOf(i) : null; return s === null ? null : Math.max(0, s - (this.#minted.get(id) ?? 0)); }
  /**
   * Hands this profile the next copy of an item (once per item): its serial is the next number of
   * the edition, never reused. None if the edition is gone. Standard issue needs no copy.
   */
  grant(p: Profile, id: string, via: Owned["via"] = "grant"): Owned | null {
    const i = ITEMS.get(id);
    if (!i || i.rarity === "standard") return null;
    const had = p.items.find((o) => o.id === id);
    if (had) return had;
    const supply = supplyOf(i), n = (this.#minted.get(id) ?? 0) + 1;
    if (supply !== null && n > supply) return null;
    this.#minted.set(id, n);
    const o: Owned = { id, serial: supply === null ? null : n, at: this.now(), via };
    p.items.push(o);
    this.save();
    for (const f of this.#unlocked) try { f(p.key, i, o.serial); } catch (e) { console.error("locker unlock", e); }
    return o;
  }
  /** Rewards earned by level or badge and not yet handed out: handed out now, while copies last. */
  #rewards(p: Profile): Owned[] {
    const level = levelOf(p.xp), got: Owned[] = [];
    for (const i of CATALOG) {
      const u = i.unlock;
      if ((u.by === "level" && level >= u.level) || (u.by === "badge" && p.badges.some((b) => b.id === u.badge))) {
        if (p.items.some((o) => o.id === i.id)) continue;
        const o = this.grant(p, i.id, "reward");
        if (o) got.push(o);
      }
    }
    return got;
  }
  #badge(p: Profile, id: BadgeId): boolean {
    if (p.badges.some((b) => b.id === id)) return false;
    p.badges.push({ id, at: this.now() });
    return true;
  }
  /** One finished game for this profile: stats, XP, badges, and whatever they unlock. */
  record(key: string, g: { game: Game; result: "win" | "loss" | "draw"; name?: string; potted?: number; badges?: BadgeId[] }): { xp: number; level: number; unlocked: Owned[]; badges: BadgeId[] } {
    const p = this.profile(key, g.name);
    const s = p.stats[g.game];
    s.played++;
    if (g.result === "win") { s.wins++; s.streak++; s.best = Math.max(s.best, s.streak); } else { if (g.result === "loss") s.losses++; else s.draws++; s.streak = 0; }
    const t = XP[g.game] as Record<string, number>;
    const gained = (t[g.result] ?? 0) + (g.game === "pool" ? (g.potted ?? 0) * XP.pool.ball : 0);
    p.xp += gained; p.potted += g.potted ?? 0; p.seenAt = this.now();
    const badges: BadgeId[] = [];
    const earn = (id: BadgeId) => { if (this.#badge(p, id)) badges.push(id); };
    for (const b of g.badges ?? []) earn(b);
    if (g.game === "pool") { earn("first-break"); if (g.result === "win") earn("first-win"); if (s.wins >= 10) earn("night-shark"); }
    if (g.game === "chess" && g.result === "win") earn("chess-win");
    if (g.game === "pinball" && g.result === "win") earn("pinball-win");
    if (levelOf(p.xp) >= 10) earn("level-10");
    const unlocked = this.#rewards(p);
    this.save();
    return { xp: gained, level: levelOf(p.xp), unlocked, badges };
  }
  /** Wear an item (one per kind; for emotes, the whole set): only what the profile owns. */
  equip(key: string, kind: unknown, value: unknown): Profile {
    const p = this.profile(key);
    if (!KINDS.includes(kind as Kind)) throw new Error("No such slot.");
    if (kind === "emote") {
      const ids = Array.isArray(value) ? [...new Set(value.map(String))] : [];
      if (!ids.length || ids.length > MAX_EMOTES) throw new Error(`Choose 1 to ${MAX_EMOTES} emotes.`);
      for (const id of ids) if (ITEMS.get(id)?.kind !== "emote" || !this.#owns(p, id)) throw new Error("That emote is not in your locker.");
      p.equip.emote = ids;
    } else {
      const id = String(value ?? ""), i = ITEMS.get(id);
      if (!i || i.kind !== kind) throw new Error("That item does not go in this slot.");
      if (!this.#owns(p, id)) throw new Error("That item is not in your locker.");
      (p.equip as Record<string, string>)[kind as string] = id;
    }
    this.save();
    return p;
  }
  setAvatar(key: string, n: unknown): Profile {
    const p = this.profile(key);
    if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > 4) throw new Error("Pick one of the five crew frogs.");
    p.avatar = n as number; this.save();
    return p;
  }
  /**
   * Buying an item: the vault shop takes IMD, ETH, $SHIFT and USDC when it opens. Until then this
   * answers what the item would cost and that it is coming soon; nothing is charged or handed out.
   * When the shop is wired, a paid copy is handed out with grant(profile, id, "purchase").
   */
  purchase(itemId: unknown, asset: unknown): { ok: false; status: "coming-soon"; item: string; asset: Asset; price: string; left: number | null; message: string } {
    const i = ITEMS.get(String(itemId ?? ""));
    if (!i) throw new Error("No such item.");
    const price = priceOf(i);
    if (!price) throw new Error(i.unlock.by === "starter" ? "Standard issue is already yours." : "This item is earned, not sold.");
    if (!ASSETS.includes(asset as Asset)) throw new Error("Pay in IMD, ETH, SHIFT or USDC.");
    return { ok: false, status: "coming-soon", item: i.id, asset: asset as Asset, price: price[asset as Asset], left: this.left(i.id), message: "The vault shop opens soon. Your locker keeps everything you earn until then." };
  }
  /** What a player brings to a pool table: their equipped items and serials, their level, the guide their cue gives (none when staked). */
  look(key: string | null, staked: boolean): Look {
    const p = key ? this.get(key) : undefined;
    const e = p?.equip ?? STARTER;
    const serials: Record<string, number> = {};
    for (const o of p?.items ?? []) if (o.serial !== null && (Object.values(e).flat() as string[]).includes(o.id)) serials[o.id] = o.serial;
    const cue = ITEMS.get(e.cue);
    return { cue: e.cue, cloth: e.cloth, table: e.table, balls: e.balls, frame: e.frame, banner: e.banner, title: e.title, effect: e.effect, emotes: [...e.emote], serials,
      level: p ? levelOf(p.xp) : 1, avatar: p ? `/games/pinball/frog-${p.avatar}.webp` : null, guide: staked ? 1 : 1 + Math.min(12, cue?.guide ?? 0) / 100 };
  }
  /** The player's own view: everything, with level progress and what each item is. */
  self(key: string) {
    const p = this.profile(key), level = levelOf(p.xp);
    return { ...this.pub(p), xp: p.xp, next: xpFor(level + 1), floor: xpFor(level), items: p.items.map((o) => ({ ...o, edition: editionText(ITEMS.get(o.id)!, o.serial) })), equip: p.equip,
      rewards: CATALOG.filter((i) => i.unlock.by === "level" || i.unlock.by === "badge").map((i) => ({ id: i.id, unlock: i.unlock, owned: p.items.some((o) => o.id === i.id), left: this.left(i.id) })) };
  }
  /** What anyone may see of a profile: no key beyond what the caller already used, no wallet. */
  pub(p: Profile) {
    const level = levelOf(p.xp);
    return { name: p.name, level, avatar: p.avatar, joinedAt: p.joinedAt, title: p.equip.title, frame: p.equip.frame, banner: p.equip.banner, cue: p.equip.cue,
      badges: p.badges.map((b) => ({ ...b, ...BADGES[b.id] })), stats: p.stats, potted: p.potted, editions: p.items.filter((o) => o.serial !== null).length };
  }
  /** The catalogue with what is left of each edition and its price. */
  catalog() { return CATALOG.map((i) => ({ ...i, supply: supplyOf(i), left: this.left(i.id), price: priceOf(i) })); }
  /** A pool game's end: each player with a profile key books it (the badges the game itself saw included). */
  poolEnded(e: PoolEvent): void {
    for (const pl of e.players) {
      if (!pl.key || !isKey(pl.key)) continue;
      const badges: BadgeId[] = [];
      if (pl.ranOut) badges.push("break-and-run");
      if (pl.eightOnBreak) badges.push("eight-on-break");
      if (pl.cleanSheet) badges.push("clean-sheet");
      if (e.staked) badges.push("staked");
      // an abandoned or unrated game books no XP for the one who left
      if (!e.rated && pl.result === "loss") continue;
      this.record(pl.key, { game: "pool", result: pl.result, name: pl.name, potted: pl.potted, badges });
    }
  }
}
export const locker = new Locker();
process.once("exit", () => locker.flush());
