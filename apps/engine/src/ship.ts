import { CAPTAIN_CREW, CAPTAIN_TIER, DEAD, FORGED_ID, FORGE_TIERS, type Forged, RARITIES, TABLE, forgedRate, frogOf, plan, shiftRate, tierInfo, watcherRate } from "./forge.js";
import { hourlyRate } from "./frogs.js";
import { MISSIONS } from "./missions.js";
import type { Book } from "./nightwatch.js";

/**
 * THE SHIP: the NIGHTSHIFT ship as one isometric scene (web/src/ship), every NIGHT FROG and Night Watcher at
 * the station its traits fit, working. This module decides where each one works and gathers the live numbers
 * the scene shows: who holds it, what it earns an hour (the same arithmetic accrueStaking credits), which
 * frogs are out on missions this week, which were forged (they sit at 0x…dEaD and earn nothing), the Night
 * Watch's seats and the imdUSD loans its radar draws. Nothing here is estimated: a number that is not known
 * is left out, and the page says so.
 */
export const STATIONS = {
  bridge: { name: "Bridge", deck: "Night Watch deck", about: "The Night Watch keeps imdUSD safe: its seats mark and liquidate unsafe loans. The radar draws every open loan from the vault." },
  quarters: { name: "Captain's quarters", deck: "Wardroom", about: "The officers: every Legendary frog, the Gold Crowns and the Moonlight Halos, and the Night Bosses." },
  offices: { name: "Company offices", deck: "Deck 2", about: "Where the AI companies are run. Holding a frog adds company slots; a Night Watcher adds more." },
  breakroom: { name: "Breakroom", deck: "Deck 2", about: "Coffee and energy drinks for the 3 AM shift. Shift hours count here too: a frog earns by holding, wherever it stands." },
  missions: { name: "Mission bay", deck: "Hangar", about: "Mission control and the launch pods: frogs out on this week's Command Room missions ride the pods." },
  engine: { name: "Engine room", deck: "Shift floor", about: "The shift floor around the reactor: the crew that keeps the ship moving all night." },
  forge: { name: "The Forge", deck: "Aft", about: "10 NIGHT FROGS in, 1 Night Watcher out. The frogs it burned stay on its memorial wall." },
} as const;
export type Station = keyof typeof STATIONS;
export const STATION_KEYS = Object.keys(STATIONS) as Station[];

/**
 * Where a frog works, by the first rule its traits meet. The order is the point: rank before gear, the rarest
 * gear before the common, and the frogs without gear for any station work the shift floor.
 */
export const RULES: { station: Station; layer: number | null; values: number[]; why: string }[] = [
  { station: "bridge", layer: null, values: [], why: "#1, the Zero-Sleep Captain, holds the Captain's chair" },
  { station: "quarters", layer: null, values: [], why: "Legendary: an officer of the wardroom" },
  { station: "quarters", layer: 5, values: [3, 6], why: "officers' headwear" },
  { station: "bridge", layer: 5, values: [5], why: "a lookout on the bridge" },
  { station: "bridge", layer: 4, values: [3], why: "reads the radar" },
  { station: "missions", layer: 5, values: [2], why: "dispatches the missions" },
  { station: "engine", layer: 5, values: [0], why: "works the reactor" },
  { station: "forge", layer: 1, values: [2], why: "safety gear for the forge" },
  { station: "offices", layer: 6, values: [4, 1], why: "runs the companies with the IMD swarm" },
  { station: "breakroom", layer: 6, values: [2, 3], why: "on a coffee break" },
  { station: "engine", layer: null, values: [], why: "the shift floor" },
];

/** The rule a frog meets (an index into RULES). */
export function ruleOf(id: number): number {
  const f = frogOf(id)!;
  if (id === 1) return 0;
  if (f.tier === "Legendary") return 1;
  const i = RULES.findIndex((r, k) => k >= 2 && r.layer !== null && r.values.includes(f.traits[r.layer]!));
  return i >= 0 ? i : RULES.length - 1;
}
export const stationOf = (id: number): Station => RULES[ruleOf(id)]!.station;
/** The rule in words: "Headwear: Headlamp Hard Hat, works the reactor". */
export function whyOf(id: number): string {
  const r = RULES[ruleOf(id)]!;
  return r.layer === null ? r.why : `${TABLE.layers[r.layer]}: ${TABLE.names[r.layer]![frogOf(id)!.traits[r.layer]!]}, ${r.why}`;
}

/** What never changes: the art records, the table and each frog's home station. Served once, cached for a day. */
export function shipStatic(art: string[]) {
  return {
    art, layers: TABLE.layers, names: TABLE.names, counts: TABLE.counts, rarities: RARITIES,
    // [rank, rarity index, forge points, ...7 traits, rule]
    frogs: TABLE.tokens.map((t) => [t.rank, RARITIES.indexOf(t.tier as (typeof RARITIES)[number]), t.points, ...t.traits, ruleOf(t.id)]),
    rules: RULES.map((r) => ({ station: r.station, layer: r.layer, why: r.why })),
    stations: STATIONS, tiers: FORGE_TIERS, captain: { ...CAPTAIN_TIER, min: null },
    missions: MISSIONS.map((m) => ({ id: m.id, title: m.title, hours: m.hours, brief: m.brief })),
  };
}

export type ShipInput = {
  /** The holder of each NIGHT FROG #1-500, lowercase ("" when the read failed). */
  owners: string[];
  /** Every forged Night Watcher (The Captain is n 0) and its holder. */
  forged: (Forged & { owner: string })[];
  /** Holders who also hold an IMD seat (shift hours doubled). */
  seat: Record<string, boolean>;
  /** This week's mission runs, any wallet (Missions.out). */
  missions: { wallet: string; frog: number; mission: string; startedAt: number; done: boolean }[];
  /** The Night Watch seats paired by their holders, and whether each seat's bot is online. */
  watch: { watcher: number; online: boolean }[];
  book: Book | null;
  stakingAt: number;
  now?: number;
};

const minDebt = 15n * 10n ** 18n;
/** A stable bearing for a loan on the radar, from its owner's address (the address itself is not sent). */
const bearing = (owner: string) => (parseInt(owner.slice(2, 10), 16) % 3600) / 10;

/** The crew boost of each wallet (percent): its best Night Watcher's, or #1's 150%, the largest one. Same rule as crewBoosts. */
export function boosts(owners: string[], forged: { tier: number; owner: string }[]): Map<string, number> {
  const best = new Map<string, number>();
  const lift = (o: string, pct: number) => { if (o && o !== DEAD) best.set(o, Math.max(best.get(o) ?? 0, pct)); };
  for (const f of forged) lift(f.owner, tierInfo(f.tier).crew);
  if (owners[0]) lift(owners[0], CAPTAIN_CREW);
  return best;
}

export function shipSnapshot(x: ShipInput) {
  const now = x.now ?? Date.now();
  const wallets: string[] = [];
  const index = new Map<string, number>();
  const w = (a: string) => {
    if (!a) return -1;
    let i = index.get(a);
    if (i === undefined) { i = wallets.push(a) - 1; index.set(a, i); }
    return i;
  };
  const crew = boosts(x.owners, x.forged);
  // what forged each frog: the Night Watcher whose 10 it was in (The Captain also takes #1)
  const into = new Map<number, number>();
  for (const f of x.forged) if (f.n !== 0) for (const id of f.inputs) into.set(id, f.n);
  if (x.forged.some((f) => f.n === 0)) into.set(1, 0);
  // a run counts while the frog is still in the wallet that sent it
  const holderOf = (id: number) => (id >= FORGED_ID ? x.forged.find((f) => f.n === id - FORGED_ID)?.owner ?? "" : x.owners[id - 1] ?? "");
  const runs = x.missions.filter((r) => holderOf(r.frog) === r.wallet.toLowerCase());
  const title = (m: string) => MISSIONS.find((d) => d.id === m)?.title ?? m;

  const frogs = TABLE.tokens.map((t) => {
    const owner = x.owners[t.id - 1] ?? "";
    const dead = owner === DEAD;
    const seat = Boolean(owner && x.seat[owner]);
    const boost = dead || t.id === 1 ? 0 : crew.get(owner) ?? 0;
    const run = runs.find((r) => r.frog === t.id);
    return {
      id: t.id, o: dead ? -1 : w(owner), dead, into: dead ? into.get(t.id) ?? null : null,
      base: shiftRate(t.id), boost, seat,
      // what the wallet is credited for it every hour; a forged frog earns nothing
      rate: dead || !owner ? 0 : round(hourlyRate(t.id, shiftRate(t.id), boost, seat)),
      mission: run ? { id: run.mission, title: title(run.mission), since: run.startedAt, done: run.done } : null,
    };
  });

  const online = new Map(x.watch.map((s) => [s.watcher, s.online]));
  const watchers = [...x.forged].sort((a, b) => a.n - b.n).map((f) => {
    const T = tierInfo(f.tier), seat = Boolean(x.seat[f.owner]);
    const ms = runs.filter((r) => r.frog === FORGED_ID + f.n);
    return {
      n: f.n, tier: f.tier, tierName: T.name, color: T.color, name: f.name, points: f.points, inputs: f.inputs, traits: f.traits, forgedAt: f.forgedAt,
      o: w(f.owner), x: T.x, base: forgedRate(f), rate: round(hourlyRate(FORGED_ID + f.n, forgedRate(f), 0, seat)), seat,
      crew: T.crew, slots: T.slots,
      // the Captain's seat is seat 0 of the Night Watch: The Captain takes it over from #1
      watch: { paired: online.has(f.n), online: online.get(f.n) ?? false },
      missions: ms.map((r) => ({ id: r.mission, title: title(r.mission), since: r.startedAt, done: r.done })),
    };
  });

  const b = x.book;
  const loans = b ? b.positions.filter((p) => p.debt >= minDebt) : [];
  const live = frogs.filter((f) => !f.dead);
  // the Captain's seat: #1's holder, or The Captain's once #1 is forged
  const theCaptain = x.forged.find((f) => f.n === 0);
  const captainHolder = theCaptain ? w(theCaptain.owner) : x.owners[0] && x.owners[0] !== DEAD ? w(x.owners[0]) : -1;
  return {
    at: now, stakingAt: x.stakingAt, wallets,
    // per wallet (same order): its crew boost in percent and whether it holds an IMD seat
    crew: wallets.map((a) => crew.get(a) ?? 0), imdSeat: wallets.map((a) => Boolean(x.seat[a])),
    frogs, watchers,
    captain: { forged: Boolean(theCaptain), holder: captainHolder, watch: { paired: online.has(0), online: online.get(0) ?? false } },
    radar: b ? {
      at: b.at, mat: Number(b.mat), bonusPct: Number(b.chop), lullHours: Number(b.lull) / 3600, stale: b.stale,
      supply: Number(b.supply) / 1e18, totalDebt: Number(b.totalDebt) / 1e18, peg: b.peg,
      loans: loans.map((p) => ({ cr: Number(p.cr), debt: Math.round(Number(p.debt) / 1e16) / 100, state: p.state, a: bearing(p.owner) })),
    } : null,
    totals: {
      held: live.filter((f) => f.o >= 0).length, burned: frogs.filter((f) => f.dead).length, watchers: watchers.length,
      holders: new Set([...live.map((f) => f.o), ...watchers.map((v) => v.o)].filter((o) => o >= 0)).size,
      perHour: round(live.reduce((s, f) => s + f.rate, 0) + watchers.reduce((s, v) => s + v.rate, 0)),
      onMissions: runs.filter((r) => !r.done).length,
    },
  };
}
export type ShipSnapshot = ReturnType<typeof shipSnapshot>;

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * One wallet's crew: its frogs and Night Watchers in the snapshot, what they earn an hour, the hours it has,
 * its company slots, and the forge planner's best suggestion (the highest tier it can reach with the least
 * valuable 10 frogs).
 */
export function crewOf(s: ShipSnapshot, wallet: string, o: { hours: number; rank: number | null; companies: number; baseSlots: number; frogSlots: number }) {
  const a = wallet.toLowerCase(), i = s.wallets.indexOf(a);
  const frogs = i < 0 ? [] : s.frogs.filter((f) => f.o === i);
  const watchers = i < 0 ? [] : s.watchers.filter((v) => v.o === i);
  const best = Math.max(0, ...watchers.map((v) => v.tier));
  const p = plan(frogs.map((f) => f.id));
  const top = p.cheapest.at(-1) ?? null;
  const has = frogs.length + watchers.length > 0;
  return {
    wallet: a, frogs: frogs.map((f) => f.id), watchers: watchers.map((v) => v.n),
    perHour: round(frogs.reduce((t, f) => t + f.rate, 0) + watchers.reduce((t, v) => t + v.rate, 0)),
    hours: o.hours, rank: o.rank, stakingAt: s.stakingAt,
    boost: i < 0 ? 0 : s.crew[i] ?? 0, seat: i < 0 ? false : s.imdSeat[i] ?? false,
    missions: [...frogs.filter((f) => f.mission).map((f) => ({ frog: f.id, ...f.mission! })), ...watchers.flatMap((v) => v.missions.map((m) => ({ frog: FORGED_ID + v.n, ...m })))],
    companies: o.companies,
    slots: o.baseSlots + (has ? Math.max(o.frogSlots, best ? tierInfo(best).slots : 0) : 0),
    forge: top ? { tier: top.tier, name: tierInfo(top.tier).name, ids: top.ids, points: top.points, rate: watcherRate(top.tier, top.ids), before: top.ids.reduce((t, id) => t + shiftRate(id), 0) } : null,
  };
}
