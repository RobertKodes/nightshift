import { type Address, type Hex, parseAbi } from "viem";
import { eth } from "./chain.js";
import { marketSnapshot } from "./community.js";
import { config } from "./config.js";
import { type Challenge, JOIN_TIMEOUT, RELAY_SLOW_MS, SETTLE_TIMEOUT, TOKENS } from "./escrow.js";
import { claimsOf, epochs } from "./frogpot.js";
import { launchState } from "./token.js";

/**
 * Everything one wallet can claim or withdraw right now, in one read for the front page: $SHIFT
 * staking rewards (ShiftRewards' earned view), NIGHT FROGS epochs (each proof checked against the
 * contract with a dry run), staked games whose payout waits for the player, and, for the signed-in
 * owner only, company revenue to withdraw. Read only: the page builds every transaction itself,
 * to the contracts pinned in its own code. The chain part is kept 60 s per wallet.
 */
const REWARDS = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function earned(address account, address token) view returns (uint256)",
  "function frogsClaimed(uint256 epoch, address token, address account) view returns (bool)",
  "function claimFrogs(uint256 epoch, address token, uint256 amount, bytes32[] proof)",
]);
const ETH: Address = "0x0000000000000000000000000000000000000000";
const CACHE_MS = 60_000;
/** The winner's payout from a pot of two stakes: 5% fee, rounded down (as GameEscrow pays it). */
const payoutOf = (stake: bigint) => 2n * stake - (2n * stake * 500n) / 10_000n;

export type FrogClaim = { epoch: number; token: string; symbol: string; amount: string; proof: string[]; postedAt: number | null };
export type GameClaim = { matchId: Hex; game: string; token: string; tokenAddress: string; kind: "settle" | "refund"; amount: string; draw: boolean; at: number };
export type GamePast = { matchId: Hex; game: string; token: string; result: "won" | "lost" | "draw" | "refunded" | "cancelled" | "paying"; amount: string; tx: string | null; at: number };
export type CompanyClaim = { id: string; slug: string; name: string; usd: number; feeBps: number };
type ChainPart = {
  staking: { staked: string; eth: string; shift: string } | null;
  frogs: FrogClaim[]; frogsClaimed: number;
  prices: { ETH: number | null; SHIFT: number | null; IMD: number | null };
};
export type Rewards = ChainPart & { wallet: string; at: number; games: { claimable: GameClaim[]; recent: GamePast[] }; companies: CompanyClaim[] | null; totalUsd: number | null };

const lc = (s?: string | null) => (s ?? "").toLowerCase();

/** A wallet's staked games: what waits for it (a signed result the relay did not send, a refund now open) and the last two weeks. */
export function gamesOf(list: Iterable<Challenge>, wallet: string, nowSec = Math.floor(Date.now() / 1000)): { claimable: GameClaim[]; recent: GamePast[] } {
  const me = lc(wallet), claimable: GameClaim[] = [], recent: GamePast[] = [];
  for (const c of list) {
    if (me !== c.creator && me !== lc(c.playerB)) continue;
    const stake = BigInt(c.stake), at = c.outcome?.at ?? (c.joinedAt ? c.joinedAt * 1000 : c.createdAt);
    const base = { matchId: c.matchId, game: c.game, token: c.token };
    if (c.closed) {
      const won = c.closed.kind === "settled" && !c.closed.draw && lc(c.closed.winner) === me;
      const result = c.closed.kind !== "settled" ? c.closed.kind : c.closed.draw ? "draw" : won ? "won" : "lost";
      recent.push({ ...base, result, amount: (won ? (c.closed.payout && /^\d+$/.test(c.closed.payout) ? BigInt(c.closed.payout) : payoutOf(stake)) : stake).toString(), tx: c.closed.tx || null, at });
      continue;
    }
    const mine = c.result && (c.result.draw || lc(c.result.winner) === me);
    // the relay is on its way, unless it failed or has not landed after RELAY_SLOW_MS: then the player may send the result
    const relaying = c.relay && c.relay.state !== "failed" && (c.relay.state === "mined" || nowSec * 1000 - c.relay.at <= RELAY_SLOW_MS);
    // the signed result, while the contract still takes it (the server signs again up to 10 minutes before the cutoff)
    if (c.result && mine && !relaying && c.joinedAt && nowSec < c.joinedAt + SETTLE_TIMEOUT - 600) {
      claimable.push({ ...base, tokenAddress: TOKENS[c.token], kind: "settle", amount: (c.result.draw ? stake : payoutOf(stake)).toString(), draw: c.result.draw, at });
      continue;
    }
    if (relaying && c.outcome) { recent.push({ ...base, result: "paying", amount: (c.outcome.draw ? stake : lc(c.outcome.winner) === me ? payoutOf(stake) : stake).toString(), tx: c.relay?.tx ?? null, at }); continue; }
    const refundAt = c.joinedAt ? c.joinedAt + SETTLE_TIMEOUT : c.openedAt ? c.openedAt + JOIN_TIMEOUT : null;
    if (refundAt !== null && c.openedAt && nowSec >= refundAt) claimable.push({ ...base, tokenAddress: TOKENS[c.token], kind: "refund", amount: stake.toString(), draw: false, at });
  }
  recent.sort((a, b) => b.at - a.at);
  return { claimable, recent: recent.slice(0, 12) };
}

/** Each posted epoch this wallet is in: open (the contract's dry run accepts the proof), claimed, or past its 30 days. */
async function frogsOf(rewards: Address | null, wallet: Address): Promise<{ open: FrogClaim[]; claimed: number }> {
  const list = claimsOf(wallet).slice(-40);
  if (!rewards || !list.length) return { open: [], claimed: 0 };
  const posted = new Map(epochs().map((e) => [e.epoch, e.at]));
  let claimed = 0;
  const open: FrogClaim[] = [];
  await Promise.all(list.map(async (c) => {
    const done = await eth.readContract({ address: rewards, abi: REWARDS, functionName: "frogsClaimed", args: [BigInt(c.epoch), c.token as Address, wallet] }).catch(() => null);
    if (done === true) { claimed++; return; }
    const ok = await eth.simulateContract({ account: wallet, address: rewards, abi: REWARDS, functionName: "claimFrogs", args: [BigInt(c.epoch), c.token as Address, BigInt(c.amount), c.proof as Hex[]] }).then(() => true, () => false);
    if (ok) open.push({ ...c, postedAt: posted.get(c.epoch) ?? null });
  }));
  open.sort((a, b) => a.epoch - b.epoch || a.symbol.localeCompare(b.symbol));
  return { open, claimed };
}

async function chainPart(wallet: Address): Promise<ChainPart> {
  const l = launchState();
  const rewards = (l?.contracts?.rewards ?? null) as Address | null;
  const token = (l?.contracts?.token ?? config.token.address ?? "") as Address | "";
  const read = (functionName: "balanceOf" | "earned", args: readonly unknown[]) => eth.readContract({ address: rewards!, abi: REWARDS, functionName, args } as never).then((x) => x as bigint, () => null);
  const [staked, e, s, frogs, m] = await Promise.all([
    rewards ? read("balanceOf", [wallet]) : null,
    rewards ? read("earned", [wallet, ETH]) : null,
    rewards && token ? read("earned", [wallet, token]) : null,
    frogsOf(rewards, wallet),
    marketSnapshot().catch(() => null),
  ]);
  return {
    staking: rewards && e !== null && s !== null ? { staked: (staked ?? 0n).toString(), eth: e.toString(), shift: s.toString() } : null,
    frogs: frogs.open, frogsClaimed: frogs.claimed,
    prices: { ETH: m?.ethUsd || null, SHIFT: m?.priceUsd || null, IMD: config.imdUsd || null },
  };
}

const cache = new Map<string, { at: number; v: Promise<ChainPart> }>();
/**
 * What `wallet` can claim now. `fresh` (the owner, right after a claim) reads the chain again if the
 * copy is older than 10 s; `games` is the escrow's challenges; `companies` is null unless the caller is
 * signed in as this wallet.
 */
export async function rewardsOf(wallet: string, o: { fresh?: boolean; games: () => Iterable<Challenge>; companies: () => Promise<CompanyClaim[] | null> }): Promise<Rewards> {
  const w = lc(wallet) as Address;
  const hit = cache.get(w), age = hit ? Date.now() - hit.at : Infinity;
  if (!hit || age > CACHE_MS || (o.fresh && age > 10_000)) {
    if (cache.size > 5_000) for (const [k, x] of cache) if (Date.now() - x.at > CACHE_MS) cache.delete(k);
    const v = chainPart(w);
    cache.set(w, { at: Date.now(), v });
    v.catch(() => cache.delete(w));
  }
  const [chain, companies] = await Promise.all([cache.get(w)!.v, o.companies().catch(() => null)]);
  const games = gamesOf(o.games(), w);
  const p = chain.prices, n = (wei: string) => Number(wei) / 1e18;
  const usd = (amount: string, sym: string) => { const x = p[sym as keyof typeof p]; return x == null ? null : n(amount) * x; };
  const parts = [
    ...(chain.staking ? [usd(chain.staking.eth, "ETH"), usd(chain.staking.shift, "SHIFT")] : []),
    ...chain.frogs.map((f) => usd(f.amount, f.symbol)),
    ...games.claimable.map((g) => usd(g.amount, g.token)),
    ...(companies ?? []).map((c) => c.usd),
  ];
  const totalUsd = parts.some((x) => x === null) && !parts.some((x) => x) ? null : parts.reduce<number>((a, x) => a + (x ?? 0), 0);
  return { wallet: w, at: Date.now(), ...chain, games, companies, totalUsd };
}
