import { existsSync, readFileSync } from "node:fs";
import { writeAtomic } from "./atomic.js";
import { join } from "node:path";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { type Address, parseAbiItem } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { stakingBoard } from "./frogs.js";

/**
 * The NIGHT FROGS half of the rewards, paid by weekly epochs. Each week: what the splitter sent to
 * rewards (half of it is the frog pot) is shared by the shift hours each wallet earned that week.
 * The list becomes an OpenZeppelin StandardMerkleTree with leaves (epoch, account, token, amount),
 * exactly the leaf ShiftRewards checks; the dev wallet posts its root, holders claim with a proof.
 */
const DISTRIBUTED = parseAbiItem("event Distributed(address indexed token, uint256 rewards, uint256 dev, uint256 treasury, uint256 burned)");
const ETH: Address = "0x0000000000000000000000000000000000000000";
const TYPES = ["uint256", "address", "address", "uint256"];

type TokenEpoch = { token: string; symbol: string; total: string; root: string; tree: unknown; posted?: string };
export type Epoch = { epoch: number; at: number; fromBlock: number; toBlock: number; wallets: number; tokens: TokenEpoch[] };
/** `carry`: pot already read from the chain but not paid out yet (no hours that week, or rounding), per token. */
type State = { epochs: Epoch[]; hours: Record<string, number>; block?: number; carry?: Record<string, string> };

const file = () => join(config.dataDir, "frogpot.json");
const load = (): State => { try { return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : { epochs: [], hours: {} }; } catch { return { epochs: [], hours: {} }; } };
const save = (s: State) => writeAtomic(file(), JSON.stringify(s));

export const epochs = (): Omit<Epoch, "tokens">[] & { tokens: Omit<TokenEpoch, "tree">[] }[] =>
  load().epochs.map((e) => ({ ...e, tokens: e.tokens.map(({ tree: _t, ...t }) => t) })) as never;

/** The frog pot that came in since the last epoch, per token: half of every `rewards` the splitter paid. */
async function potSince(splitter: Address, from: bigint, to: bigint): Promise<Map<string, bigint>> {
  const pot = new Map<string, bigint>();
  for (let a = from; a <= to; a += 9_000n) {
    const logs = await eth.getLogs({ address: splitter, event: DISTRIBUTED, fromBlock: a, toBlock: a + 8_999n > to ? to : a + 8_999n });
    for (const l of logs) pot.set(l.args.token!.toLowerCase(), (pot.get(l.args.token!.toLowerCase()) ?? 0n) + l.args.rewards! / 2n);
  }
  return pot;
}

/** Builds the next epoch. Nothing is sent: the dev wallet posts each root from /setup. */
export async function buildEpoch(c: { splitter?: string; token?: string }, startBlock: number): Promise<Epoch | null> {
  if (!c.splitter || !c.token) throw new Error("no splitter yet");
  const s = load();
  const head = Number(await eth.getBlockNumber());
  const from = (s.block ?? startBlock) + 1;
  const now = Object.fromEntries(stakingBoard(100_000).map((x) => [x.wallet.toLowerCase(), x.hours]));
  const earned = Object.entries(now).map(([w, h]) => [w, Math.max(0, h - (s.hours[w] ?? 0))] as const).filter(([, h]) => h > 0);
  const sum = earned.reduce((a, [, h]) => a + h, 0);
  const pot = await potSince(c.splitter as Address, BigInt(from), BigInt(head));
  const epoch = (s.epochs.at(-1)?.epoch ?? 0) + 1;
  const tokens: TokenEpoch[] = [];
  // The logs up to head are read once: whatever this epoch does not pay out is carried, never dropped.
  const carry: Record<string, string> = { ...(s.carry ?? {}) };
  for (const [token, symbol] of [[ETH, "ETH"], [c.token.toLowerCase(), "SHIFT"]] as const) {
    const total = (pot.get(token) ?? 0n) + BigInt(carry[token] ?? "0");
    if (total > 0n) carry[token] = total.toString();
    if (total <= 0n || sum <= 0) continue;
    const values = earned.map(([w, h]) => [String(epoch), w, token, ((total * BigInt(Math.floor(h * 1e6))) / (BigInt(Math.floor(sum * 1e6)))).toString()] as [string, string, string, string])
      .filter((v) => v[3] !== "0");
    if (!values.length) continue;
    const tree = StandardMerkleTree.of(values, TYPES);
    const posted = values.reduce((a, v) => a + BigInt(v[3]), 0n);
    tokens.push({ token, symbol, total: posted.toString(), root: tree.root, tree: tree.dump() });
    if (total - posted > 0n) carry[token] = (total - posted).toString(); else delete carry[token];
  }
  s.block = head;
  s.carry = carry;
  // Hours are used up only by an epoch that pays them; in a week without a pot they keep counting.
  if (!tokens.length) { save(s); return null; }
  s.hours = now;
  const e: Epoch = { epoch, at: Date.now(), fromBlock: from, toBlock: head, wallets: earned.length, tokens };
  s.epochs.push(e);
  save(s);
  return e;
}

export function markPosted(epoch: number, token: string, tx: string) {
  const s = load();
  const t = s.epochs.find((e) => e.epoch === epoch)?.tokens.find((x) => x.token === token.toLowerCase());
  if (!t) throw new Error("no such epoch or token");
  t.posted = tx;
  save(s);
}

/** What a wallet can claim: one entry per posted epoch and token, with its Merkle proof. */
export function claimsOf(wallet: string): { epoch: number; token: string; symbol: string; amount: string; proof: string[] }[] {
  const w = wallet.toLowerCase();
  const out: { epoch: number; token: string; symbol: string; amount: string; proof: string[] }[] = [];
  for (const e of load().epochs) for (const t of e.tokens) {
    if (!t.posted) continue;
    const tree = StandardMerkleTree.load(t.tree as never);
    for (const [i, v] of tree.entries()) if (String(v[1]).toLowerCase() === w) out.push({ epoch: e.epoch, token: t.token, symbol: t.symbol, amount: String(v[3]), proof: tree.getProof(i) });
  }
  return out;
}
