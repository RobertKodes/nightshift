import { existsSync, readFileSync } from "node:fs";
import { writeAtomic } from "./atomic.js";
import { join } from "node:path";
import { parseAbi, parseAbiItem } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";

/**
 * NIGHT FROGS, the onchain NFT collection the IMD swarm built for NIGHTSHIFT (ERC-721 on
 * Ethereum, minted only in IMD at 2 IMD, 50% burned to 0x…dEaD, 50% to the treasury).
 * Holding one is a NIGHTSHIFT perk: no platform fee, featured products, more company slots.
 * Off while NFT_ADDRESS is empty; the order follower fills it in when IMD deploys the contract.
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
    const n = Number(await eth.readContract({ address: addr(), abi: FROGS_ABI, functionName: "balanceOf", args: [owner as `0x${string}`] }));
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
 * each minted frog and credits that wallet "shift hours" per hour: 6 for #1, 3 for #2–25,
 * 2 for #26–77 (Genesis), 1 for the rest. The hours belong to the wallet; selling a frog stops
 * its accrual.
 */
type Staking = { at: number; wallets: Record<string, number>; holders: Record<string, string>; seat?: Record<string, boolean> };
const sFile = () => join(config.dataDir, "staking.json");
const loadStaking = (): Staking => { try { return existsSync(sFile()) ? JSON.parse(readFileSync(sFile(), "utf8")) : { at: 0, wallets: {}, holders: {} }; } catch { return { at: 0, wallets: {}, holders: {} }; } };
const staking = loadStaking();
export const multiplier = (id: number) => (id === 1 ? 6 : id <= 25 ? 3 : id <= 77 ? 2 : 1);
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
  // credit the time since the last look (at most a day, so an outage never mints a windfall)
  const hours = staking.at ? Math.min(24, (now - staking.at) / 3_600_000) : 0;
  const owners = [...new Set(res.filter((r) => r.status === "success").map((r) => String(r.result).toLowerCase()))];
  const seats = await eth.multicall({ contracts: owners.map((o) => ({ address: IMD_SEATS as `0x${string}`, abi: FROGS_ABI, functionName: "balanceOf" as const, args: [o as `0x${string}`] })), allowFailure: true });
  staking.seat = Object.fromEntries(owners.map((o, i) => [o, seats[i]?.status === "success" && Number(seats[i]!.result) > 0]));
  res.forEach((r, i) => {
    if (r.status !== "success") return;
    const id = i + 1;
    const owner = String(r.result).toLowerCase();
    if (staking.holders[id] === owner && hours > 0) staking.wallets[owner] = (staking.wallets[owner] ?? 0) + hours * multiplier(id) * (staking.seat?.[owner] ? SEAT_BOOST : 1);
    staking.holders[id] = owner;
  });
  staking.at = now;
  writeAtomic(sFile(), JSON.stringify(staking));
}

export function stakingBoard(limit = 20): { wallet: string; hours: number; frogs: number }[] {
  const frogs: Record<string, number> = {};
  for (const o of Object.values(staking.holders)) frogs[o] = (frogs[o] ?? 0) + 1;
  return Object.entries(staking.wallets).map(([wallet, hours]) => ({ wallet, hours: Math.floor(hours), frogs: frogs[wallet] ?? 0 }))
    .sort((a, b) => b.hours - a.hours).slice(0, limit);
}

export function stakingOf(wallet: string): { hours: number; rank: number | null; frogs: { id: number; multiplier: number }[]; perHour: number; imdSeat: boolean } {
  const w = wallet.toLowerCase();
  const all = Object.entries(staking.wallets).sort((a, b) => b[1] - a[1]);
  const idx = all.findIndex(([k]) => k === w);
  const frogs = Object.entries(staking.holders).filter(([, o]) => o === w).map(([id]) => ({ id: Number(id), multiplier: multiplier(Number(id)) }));
  const seat = Boolean(staking.seat?.[w]);
  return { hours: Math.floor(staking.wallets[w] ?? 0), rank: idx >= 0 ? idx + 1 : null, frogs, perHour: frogs.reduce((a, f) => a + f.multiplier, 0) * (seat ? SEAT_BOOST : 1), imdSeat: seat };
}
