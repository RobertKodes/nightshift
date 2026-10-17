import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
export async function frogCount(owner: string | null): Promise<number> {
  if (!frogsOn() || !owner) return 0;
  const k = owner.toLowerCase();
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.count;
  try {
    const n = Number(await eth.readContract({ address: addr(), abi: FROGS_ABI, functionName: "balanceOf", args: [owner as `0x${string}`] }));
    cache.set(k, { at: Date.now(), count: n });
    return n;
  } catch { return hit?.count ?? 0; }
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
type State = { lastBlock?: number };
const file = () => join(config.dataDir, "frogs.json");
const load = (): State => { try { return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {}; } catch { return {}; } };
const st = load();
export async function newMints(): Promise<{ payer: string; first: number; quantity: number; paid: number; tx: string }[]> {
  if (!frogsOn()) return [];
  const head = Number(await eth.getBlockNumber());
  if (!st.lastBlock) { st.lastBlock = head; writeFileSync(file(), JSON.stringify(st)); return []; }
  const from = Math.max(st.lastBlock + 1, head - 300);
  if (from > head) return [];
  const logs = await eth.getLogs({ address: addr(), event: MINTED, fromBlock: BigInt(from), toBlock: BigInt(head) });
  st.lastBlock = head;
  writeFileSync(file(), JSON.stringify(st));
  return logs.map((l) => ({ payer: l.args.payer!, first: Number(l.args.firstTokenId), quantity: Number(l.args.quantity), paid: Number(l.args.paid!) / 1e18, tx: l.transactionHash! }));
}

/**
 * Soft staking: a frog never leaves its holder's wallet. Every hour the engine reads who holds
 * each minted frog and credits that wallet "shift hours": 1 an hour, 2 for a Genesis frog
 * (#1–77), 5 for #1. The hours belong to the wallet; selling a frog stops its accrual.
 */
type Staking = { at: number; wallets: Record<string, number>; holders: Record<string, string> };
const sFile = () => join(config.dataDir, "staking.json");
const loadStaking = (): Staking => { try { return existsSync(sFile()) ? JSON.parse(readFileSync(sFile(), "utf8")) : { at: 0, wallets: {}, holders: {} }; } catch { return { at: 0, wallets: {}, holders: {} }; } };
const staking = loadStaking();
export const multiplier = (id: number) => (id === 1 ? 5 : id <= 77 ? 2 : 1);
const OWNER_OF = parseAbi(["function ownerOf(uint256) view returns (address)"]);

export async function accrueStaking(): Promise<void> {
  if (!frogsOn()) return;
  const now = Date.now();
  const minted = Number(await eth.readContract({ address: addr(), abi: FROGS_ABI, functionName: "totalSupply" }));
  if (!minted) { staking.at = now; return; }
  const res = await eth.multicall({ contracts: Array.from({ length: minted }, (_, i) => ({ address: addr(), abi: OWNER_OF, functionName: "ownerOf" as const, args: [BigInt(i + 1)] })), allowFailure: true });
  // credit the time since the last look (at most a day, so an outage never mints a windfall)
  const hours = staking.at ? Math.min(24, (now - staking.at) / 3_600_000) : 0;
  res.forEach((r, i) => {
    if (r.status !== "success") return;
    const id = i + 1;
    const owner = String(r.result).toLowerCase();
    if (staking.holders[id] === owner && hours > 0) staking.wallets[owner] = (staking.wallets[owner] ?? 0) + hours * multiplier(id);
    staking.holders[id] = owner;
  });
  staking.at = now;
  writeFileSync(sFile(), JSON.stringify(staking));
}

export function stakingBoard(limit = 20): { wallet: string; hours: number; frogs: number }[] {
  const frogs: Record<string, number> = {};
  for (const o of Object.values(staking.holders)) frogs[o] = (frogs[o] ?? 0) + 1;
  return Object.entries(staking.wallets).map(([wallet, hours]) => ({ wallet, hours: Math.floor(hours), frogs: frogs[wallet] ?? 0 }))
    .sort((a, b) => b.hours - a.hours).slice(0, limit);
}

export function stakingOf(wallet: string): { hours: number; rank: number | null; frogs: { id: number; multiplier: number }[]; perHour: number } {
  const w = wallet.toLowerCase();
  const all = Object.entries(staking.wallets).sort((a, b) => b[1] - a[1]);
  const idx = all.findIndex(([k]) => k === w);
  const frogs = Object.entries(staking.holders).filter(([, o]) => o === w).map(([id]) => ({ id: Number(id), multiplier: multiplier(Number(id)) }));
  return { hours: Math.floor(staking.wallets[w] ?? 0), rank: idx >= 0 ? idx + 1 : null, frogs, perHour: frogs.reduce((a, f) => a + f.multiplier, 0) };
}
