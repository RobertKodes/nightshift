/** What /api/ship/art, /api/ship and /api/ship/crew answer (engine ship.ts). */
export type Station = "bridge" | "quarters" | "offices" | "breakroom" | "missions" | "engine" | "forge";
export type Tier = { tier: number; roman: string; name: string; min: number | null; color: string; x: number; slots: number; crew: number };
export type ShipStatic = {
  art: string[]; layers: string[]; names: string[][]; counts: number[][]; rarities: string[];
  /** [rank, rarity index, forge points, ...7 traits, rule] per frog, #1 first. */
  frogs: number[][];
  rules: { station: Station; layer: number | null; why: string }[];
  stations: Record<Station, { name: string; deck: string; about: string }>;
  tiers: Tier[]; captain: Tier;
  missions: { id: string; title: string; hours: number; brief: string }[];
};
export type Mission = { id: string; title: string; since: number; done: boolean };
export type SnapFrog = { id: number; o: number; dead: boolean; into: number | null; base: number; boost: number; seat: boolean; rate: number; mission: Mission | null };
export type SnapWatcher = {
  n: number; tier: number; tierName: string; color: string; name: string; points: number; inputs: number[]; traits: number[]; forgedAt: number;
  o: number; x: number; base: number; rate: number; seat: boolean; crew: number; slots: number;
  watch: { paired: boolean; online: boolean }; missions: Mission[];
};
export type Loan = { cr: number; debt: number; state: "safe" | "unmarked" | "grace" | "actionable" | "expired"; a: number };
export type Snapshot = {
  at: number; stakingAt: number; wallets: string[]; crew: number[]; imdSeat: boolean[];
  frogs: SnapFrog[]; watchers: SnapWatcher[];
  captain: { forged: boolean; holder: number; watch: { paired: boolean; online: boolean } };
  radar: { at: number; mat: number; bonusPct: number; lullHours: number; stale: string[]; supply: number; totalDebt: number; peg: number | null; loans: Loan[] } | null;
  totals: { held: number; burned: number; watchers: number; holders: number; perHour: number; onMissions: number };
};
export type Crew = {
  wallet: string; frogs: number[]; watchers: number[]; perHour: number; hours: number; rank: number | null; stakingAt: number;
  boost: number; seat: boolean; missions: (Mission & { frog: number })[]; companies: number; slots: number;
  forge: { tier: number; name: string; ids: number[]; points: number; rate: number; before: number } | null;
};

/** Something on the ship a pointer can land on. */
export type Pick = { kind: "frog"; id: number } | { kind: "watcher"; n: number } | { kind: "seat"; seat: number } | { kind: "room"; station: Station | "drive" };

export const NIGHT_FROGS = "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c";
export const FORGE = "0xbdff33cffc3f617f808a6de012a2574dbf69d819";
export const FORGED_ID = 1000;
export const RARITY_TONE: Record<string, string> = { Common: "#8e89a8", Uncommon: "#3fe6ff", Rare: "#a98bff", Epic: "#ff4fd8", Legendary: "#ffc46b" };
