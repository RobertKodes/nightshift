import { existsSync, readFileSync } from "node:fs";
import { writeAtomic } from "./atomic.js";
import { join } from "node:path";
import { parseAbi, parseAbiItem } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { CAPTAIN_CREW, DEAD, FORGED_ID, FORGE_ABI, FORGE_BONUS_HOURS, FORGE_TIERS, forgeOn, forgedAll, forgedMissions, forgedOf, forgedRate, shiftRate, tierInfo } from "./forge.js";

/**
 * NIGHT FROGS, the onchain NFT collection the IMD swarm built for NIGHTSHIFT (ERC-721 on
 * Ethereum, minted only in IMD at 2 IMD, 50% burned to 0x…dEaD, 50% to the treasury).
 * Holding one is a NIGHTSHIFT perk: no platform fee, featured products, more company slots.
 * Off while NFT_ADDRESS is empty; the order follower fills it in when IMD deploys the contract.
 * A Night Watcher (forge.ts: 10 frogs forged into 1) counts as a frog for every one of these perks.
 */
export const FROGS_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function price() view returns (uint256)",
  "function revealed() view returns (bool)",
  "function revealRequested() view returns (bool)",
  "function mintedBy(address) view returns (uint256)",
  "function treasury() view returns (address)",
  "function owner() view returns (address)",
]);
const MINTED = parseAbiItem("event Minted(address indexed payer, uint256 firstTokenId, uint256 quantity, uint256 paid)");
export const frogsOn = () => /^0x[0-9a-fA-F]{40}$/.test(config.nft.address);
const addr = () => config.nft.address as `0x${string}`;

const cache = new Map<string, { at: number; count: number }>();
export async function frogCount(owner: string | null, fresh = false): Promise<number> {
  if (!frogsOn() || !owner) return 0;
  const k = owner.toLowerCase();
  const hit = cache.get(k);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60_000) return hit.count;
  try {
    const [n1, n2] = await Promise.all([
      eth.readContract({ address: addr(), abi: FROGS_ABI, functionName: "balanceOf", args: [owner as `0x${string}`] }),
      forgeOn() ? eth.readContract({ address: config.forge.address as `0x${string}`, abi: FORGE_ABI, functionName: "balanceOf", args: [owner as `0x${string}`] }) : 0n,
    ]);
    const n = Number(n1) + Number(n2);
    cache.set(k, { at: Date.now(), count: n });
    return n;
  } catch { return fresh ? 0 : hit?.count ?? 0; }
}
export const frogCached = (owner: string | null) => (owner ? (cache.get(owner.toLowerCase())?.count ?? 0) > 0 : false);

let stats: { at: number; minted: number; burned: number; price: number; revealed: boolean; revealRequested: boolean } | null = null;
export async function frogStats() {
  if (!frogsOn()) return null;
  if (stats && Date.now() - stats.at < 30_000) return stats;
  try {
    const r = (fn: "totalSupply" | "totalBurned" | "price" | "revealed" | "revealRequested") => eth.readContract({ address: addr(), abi: FROGS_ABI, functionName: fn });
    const [minted, burned, price, revealed, revealRequested] = await Promise.all([r("totalSupply"), r("totalBurned"), r("price"), r("revealed"), r("revealRequested")]);
    stats = { at: Date.now(), minted: Number(minted), burned: Number(burned as bigint) / 1e18, price: Number(price as bigint) / 1e18, revealed: Boolean(revealed), revealRequested: Boolean(revealRequested) };
  } catch { /* keep the last one */ }
  return stats;
}

/** New mints since the last look, for the community chat. */
type State = { lastBlock?: number; milestone?: number; revealAnnounced?: boolean };
const file = () => join(config.dataDir, "frogs.json");
const load = (): State => { try { return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {}; } catch { return {}; } };
const st = load();
const saveSt = () => writeAtomic(file(), JSON.stringify(st));
/** The countdown milestone last announced (every 50 frogs) and whether the reveal was announced. */
export const milestoneSeen = () => st.milestone ?? 0;
export const setMilestone = (n: number) => { st.milestone = n; saveSt(); };
export const revealAnnounced = () => Boolean(st.revealAnnounced);
export const markRevealAnnounced = () => { st.revealAnnounced = true; saveSt(); };
export async function newMints(): Promise<{ payer: string; first: number; quantity: number; paid: number; tx: string }[]> {
  if (!frogsOn()) return [];
  const head = Number(await eth.getBlockNumber());
  if (!st.lastBlock) { st.lastBlock = head; writeAtomic(file(), JSON.stringify(st)); return []; }
  const from = Math.max(st.lastBlock + 1, head - 300);
  if (from > head) return [];
  const logs = await eth.getLogs({ address: addr(), event: MINTED, fromBlock: BigInt(from), toBlock: BigInt(head) });
  st.lastBlock = head;
  writeAtomic(file(), JSON.stringify(st));
  return logs.map((l) => ({ payer: l.args.payer!, first: Number(l.args.firstTokenId), quantity: Number(l.args.quantity), paid: Number(l.args.paid!) / 1e18, tx: l.transactionHash! }));
}

/**
 * Soft staking: a frog never leaves its holder's wallet. Every hour the engine reads who holds
 * each minted frog and credits that wallet "shift hours" per hour: 50 for #1, 3 for #2–25,
 * 2 for #26–77 (Genesis), 1 for the rest. The hours belong to the wallet; selling a frog stops
 * its accrual. A frog forged into a Night Watcher sits at 0x…dEaD and earns nothing; the Night Watcher
 * earns its own rate (its tier's 10x to 40x, never less than its 10 frogs) as FORGED_ID + its number.
 */
type Staking = { at: number; wallets: Record<string, number>; holders: Record<string, string>; seat?: Record<string, boolean> };
const sFile = () => join(config.dataDir, "staking.json");
const loadStaking = (): Staking => { try { return existsSync(sFile()) ? JSON.parse(readFileSync(sFile(), "utf8")) : { at: 0, wallets: {}, holders: {} }; } catch { return { at: 0, wallets: {}, holders: {} }; } };
const staking = loadStaking();
export const multiplier = shiftRate;
const OWNER_OF = parseAbi(["function ownerOf(uint256) view returns (address)"]);
/** IMD's own seats (the identity.md NFT): holding one as well doubles a wallet's shift hours. */
export const IMD_SEATS = "0x0000ec93127baa929e58e97dd0095a2bfb38ec1d";
export const SEAT_BOOST = 2;

export async function accrueStaking(): Promise<void> {
  if (!frogsOn()) return;
  const now = Date.now();
  const minted = Number(await eth.readContract({ address: addr(), abi: FROGS_ABI, functionName: "totalSupply" }));
  if (!minted) { staking.at = now; return; }
  const res = await eth.multicall({ contracts: Array.from({ length: minted }, (_, i) => ({ address: addr(), abi: OWNER_OF, functionName: "ownerOf" as const, args: [BigInt(i + 1)] })), allowFailure: true });
  const forged = await forgedAll(true);
  const fres = forged.length ? await eth.multicall({ contracts: forged.map((f) => ({ address: config.forge.address as `0x${string}`, abi: OWNER_OF, functionName: "ownerOf" as const, args: [BigInt(f.n)] })), allowFailure: true }) : [];
  // credit the time since the last look (at most a day, so an outage never mints a windfall)
  const hours = staking.at ? Math.min(24, (now - staking.at) / 3_600_000) : 0;
  const owners = [...new Set([...res, ...fres].filter((r) => r.status === "success").map((r) => String(r.result).toLowerCase()).filter((o) => o !== DEAD))];
  const seats = await eth.multicall({ contracts: owners.map((o) => ({ address: IMD_SEATS as `0x${string}`, abi: FROGS_ABI, functionName: "balanceOf" as const, args: [o as `0x${string}`] })), allowFailure: true });
  staking.seat = Object.fromEntries(owners.map((o, i) => [o, seats[i]?.status === "success" && Number(seats[i]!.result) > 0]));
  const crew = crewBoosts(res, fres, forged);
  res.forEach((r, i) => {
    if (r.status !== "success") return;
    const id = i + 1;
    const owner = String(r.result).toLowerCase();
    if (owner === DEAD) { delete staking.holders[id]; return; }
    if (staking.holders[id] === owner && hours > 0) staking.wallets[owner] = (staking.wallets[owner] ?? 0) + hours * hourlyRate(id, multiplier(id), crew.get(owner) ?? 0, Boolean(staking.seat?.[owner]));
    staking.holders[id] = owner;
  });
  fres.forEach((r, i) => {
    if (r.status !== "success") return;
    const f = forged[i]!, id = FORGED_ID + f.n;
    const owner = String(r.result).toLowerCase();
    // the forge bonus: a week of its hours, once, the first hour a new Night Watcher is seen
    if (staking.holders[id] === undefined) staking.wallets[owner] = (staking.wallets[owner] ?? 0) + FORGE_BONUS_HOURS * forgedRate(f);
    if (staking.holders[id] === owner && hours > 0) staking.wallets[owner] = (staking.wallets[owner] ?? 0) + hours * hourlyRate(id, forgedRate(f), 0, Boolean(staking.seat?.[owner]));
    staking.holders[id] = owner;
  });
  staking.at = now;
  writeAtomic(sFile(), JSON.stringify(staking));
}

/**
 * Shift hours one NFT credits its holder per hour, as accrueStaking credits them: its base rate (`base`:
 * multiplier(id) for a NIGHT FROG, forgedRate for a Night Watcher), lifted by the wallet's crew boost
 * (percent; never for #1 or a Night Watcher itself) and doubled when the wallet also holds an IMD seat.
 */
export function hourlyRate(id: number, base: number, crewPct: number, seat: boolean): number {
  const boost = id === 1 || id >= FORGED_ID ? 1 : 1 + crewPct / 100;
  return base * boost * (seat ? SEAT_BOOST : 1);
}

/** When the staking book was last credited, and which holders also hold an IMD seat (the Ship's live rates). */
export const stakingSeats = (): { at: number; seat: Record<string, boolean> } => ({ at: staking.at, seat: { ...(staking.seat ?? {}) } });

/**
 * The crew boost per wallet, in percent: the best Night Watcher it holds lifts its other NIGHT FROGS by that
 * tier's `crew` (20% to 100%), and holding #1 lifts them by CAPTAIN_CREW (150%). The largest one counts.
 */
export function crewBoosts(frogOwners: { status: string; result?: unknown }[], watcherOwners: { status: string; result?: unknown }[], forged: { tier: number }[]): Map<string, number> {
  const best = new Map<string, number>();
  const lift = (o: string, pct: number) => best.set(o, Math.max(best.get(o) ?? 0, pct));
  watcherOwners.forEach((r, i) => { if (r.status === "success") lift(String(r.result).toLowerCase(), tierInfo(forged[i]!.tier).crew); });
  if (frogOwners[0]?.status === "success") lift(String(frogOwners[0].result).toLowerCase(), CAPTAIN_CREW);
  return best;
}

/** Bonus shift hours from a finished Command Room mission, on top of the hourly accrual. */
export function creditHours(wallet: string, hours: number): void {
  if (!(hours > 0)) return;
  const w = wallet.toLowerCase();
  staking.wallets[w] = (staking.wallets[w] ?? 0) + hours;
  writeAtomic(sFile(), JSON.stringify(staking));
}

export function stakingBoard(limit = 20): { wallet: string; hours: number; frogs: number }[] {
  const frogs: Record<string, number> = {};
  for (const o of Object.values(staking.holders)) frogs[o] = (frogs[o] ?? 0) + 1;
  return Object.entries(staking.wallets).map(([wallet, hours]) => ({ wallet, hours: Math.floor(hours), frogs: frogs[wallet] ?? 0 }))
    .sort((a, b) => b.hours - a.hours).slice(0, limit);
}

export type StakedFrog = { id: number; multiplier: number; rate: number; crew?: boolean; forged?: { n: number; tier: number; name: string } };
/** A frog in the staking book: its mission multiplier and hourly rate. A Night Watcher crews every mission. */
export function stakedFrog(id: number): StakedFrog {
  if (id < FORGED_ID) return { id, multiplier: multiplier(id), rate: multiplier(id) };
  const f = forgedOf(id - FORGED_ID);
  // read before the first look after a restart: tier I until the forge is read
  if (!f) return { id, multiplier: FORGE_TIERS[0]!.x, rate: 0, crew: true, forged: { n: id - FORGED_ID, tier: 1, name: "" } };
  return { id, multiplier: forgedMissions(f), rate: forgedRate(f), crew: true, forged: { n: f.n, tier: f.tier, name: f.name } };
}
if (forgeOn()) void forgedAll();

/** Extra company slots: +NFT_EXTRA_SLOTS for any frog, more for the wallet's best Night Watcher (its tier's slots). */
export async function frogSlots(owner: string): Promise<number> {
  if ((await frogCount(owner)) <= 0) return 0;
  const best = Math.max(0, ...stakingOf(owner).frogs.map((f) => f.forged?.tier ?? 0));
  // tierInfo, not FORGE_TIERS: The Captain is tier 6, above the five forge tiers
  return Math.max(config.nft.extraSlots, best ? tierInfo(best).slots : 0);
}

export function stakingOf(wallet: string): { hours: number; rank: number | null; frogs: StakedFrog[]; perHour: number; imdSeat: boolean } {
  const w = wallet.toLowerCase();
  const all = Object.entries(staking.wallets).sort((a, b) => b[1] - a[1]);
  const idx = all.findIndex(([k]) => k === w);
  const frogs = Object.entries(staking.holders).filter(([, o]) => o === w).map(([id]) => stakedFrog(Number(id)));
  const seat = Boolean(staking.seat?.[w]);
  return { hours: Math.floor(staking.wallets[w] ?? 0), rank: idx >= 0 ? idx + 1 : null, frogs, perHour: frogs.reduce((a, f) => a + f.rate, 0) * (seat ? SEAT_BOOST : 1), imdSeat: seat };
}
