import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Address, type Hex, erc20Abi, parseAbi, parseAbiItem, toEventSelector, verifyMessage, verifyTypedData } from "viem";
import { writeAtomic } from "./atomic.js";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { FORGE_ABI, forgeOn, forgedAll, forgedOf, tierInfo } from "./forge.js";
import { prices } from "./prices.js";

/**
 * THE NIGHT WATCH: the keeper network of the Night Watchers (NIGHT FROGS Gen 2). Each Night Watcher is a
 * seat, and NIGHT FROG #1 holds the Captain's seat (seat 0) without being forged. A seat's owner runs the
 * nightwatch bot (repo folder nightwatch/, after fa11up's MIT imdusd-keeper) on their own machine, with
 * their own wallet, imdUSD and ETH, and pairs it with one signature, the way an IMD seat pairs to its
 * worker. This coordinator watches the imdUSD vault and hands the seats their jobs so they work as one
 * crew instead of racing each other:
 *   - a loan under `mat` is marked (bark) by one seat at a time, in turn, so the 2% marker's share rotates;
 *   - a marked loan whose grace has run out is split between the online seats by imdUSD inventory times
 *     the seat's weight, each share at most what the seat holds;
 *   - the cut, a share of the liquidation bonus a seat keeps (10% for a Shift Lead down to 6% for a Night
 *     Boss and 5% for the Captain), is paid by the bot in IMD to the NIGHTSHIFT FeeSplitter, which shares it
 *     out like every fee: $SHIFT stakers and frog holders (40%), the dev wallet and the treasury (20% each)
 *     and an IMD burn (20%). A seat that has not paid within arrearsMs gets no more jobs until it does.
 * The rarer the seat, the larger its weight (more of each liquidation, more turns to mark) and the smaller
 * its cut; the Captain's seat has the most of both (TERMS).
 * Nothing here holds or moves money: the coordinator only reads the chain and answers the bots. Everything
 * a liquidation pays lands in the seat owner's own keeper wallet.
 */
export const WATCH = {
  vault: "0x0b69F8DA8D8cE521d74Ea69a7A3475B77302EF82",
  imdusd: "0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25",
  simd: "0x9Efa934D9fAd4AE28c998a40195646b965a97247",
  imd: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
  splitter: "0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44",
  /** The imdUSD/USDC peg pool (Uniswap v4, PegFeeHook) and the v4 StateView that reads it. */
  pegPool: "0x3cb8cc9c22f7da5c3169d4059131ddba9e61f68230977797c03a2f1214992035",
  stateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
  /** The vault's deployment block: where the history of positions starts. */
  vaultBlock: 26166417n,
  frogs: "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c",
  /** A loan owing less than this is never marked or bitten: the gas costs more than its bonus (as in imdusd-keeper). */
  minDebt: 15n * 10n ** 18n,
  /** A bite share under this is not handed out; a seat below it in imdUSD gets marks only. */
  minSlice: 15n * 10n ** 18n,
  onlineMs: 3 * 60_000,
  arrearsMs: 2 * 3_600_000,
  markHoldMs: 10 * 60_000,
} as const;

/** Seat 0 is the Captain's seat, held by whoever holds NIGHT FROG #1 (The Captain, forge token 0, once #1 is forged); seats 1-50 are the Night Watchers. */
export const CAPTAIN = 0;
/** Each seat's weight (its share of every liquidation it can cover, and how often its turn to mark comes) and its cut. */
export const TERMS: Record<string, { weight: number; cutBps: number }> = {
  captain: { weight: 4, cutBps: 500 },
  1: { weight: 1, cutBps: 1000 }, 2: { weight: 1.25, cutBps: 900 }, 3: { weight: 1.5, cutBps: 800 }, 4: { weight: 2, cutBps: 700 }, 5: { weight: 3, cutBps: 600 },
};
export const termsOf = (watcher: number) => (watcher === CAPTAIN ? TERMS.captain! : TERMS[String(forgedOf(watcher)?.tier ?? 1)]!);
export const seatName = (watcher: number) => (watcher === CAPTAIN ? "the Captain's seat (NIGHT FROG #1 / The Captain)" : `Night Watcher #${watcher}`);

const VAULT_ABI = parseAbi([
  "function positions(address) view returns (uint256 collateral, uint256 debt)",
  "function collateralRatio(address) view returns (uint256)",
  "function liquidationMarks(address) view returns (uint256 markedAt, uint256 grace, bool marked, address marker)",
  "function mat() view returns (uint256)",
  "function lull() view returns (uint256)",
  "function tail() view returns (uint256)",
  "function chip() view returns (uint256)",
  "function cut() view returns (uint256)",
  "function CHOP_PERCENT() view returns (uint256)",
  "function totalDebt() view returns (uint256)",
  "function backingPerUnit() view returns (uint256)",
  "function priceFeed() view returns (address)",
  "function nhiFeed() view returns (address)",
  "function collateralPriceFeed() view returns (address)",
]);
const FEED_ABI = parseAbi(["function latestValue() view returns (uint256, uint64)", "function isStale() view returns (bool)"]);
const STATE_VIEW = parseAbi(["function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"]);
const OWNER_EVENTS = parseAbi(["event Lock(address indexed account, uint256 amount)", "event Draw(address indexed account, uint256 amount)", "event Earn(address indexed account, uint256 amount)"]);
const BITE = parseAbiItem("event Bite(address indexed owner, address indexed liquidator, uint256 debtRepaid, uint256 collateralSeized)");
const WITHDRAW = parseAbiItem("event Withdraw(address indexed by, address indexed to, address indexed owner, uint256 assets, uint256 shares)");
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export type MarkState = "safe" | "unmarked" | "grace" | "actionable" | "expired";
export type Position = {
  owner: string; collateral: bigint; debt: bigint; cr: bigint; state: MarkState;
  marker: string | null; opensAt: number | null; closesAt: number | null; maxRepay: bigint;
};
export type Book = {
  at: number; now: number; block: number; mat: bigint; lull: bigint; tail: bigint; chip: bigint; cut: bigint; chop: bigint;
  price: bigint; stale: string[]; totalDebt: bigint; supply: bigint; backing: bigint; peg: number | null;
  owners: number; positions: Position[];
};
export type Seat = { watcher: number; keeper: string; owner: string; pairedAt: number; pairedBlock?: number };
export type SeatLive = Seat & { valid: boolean; online: boolean; inventory: bigint; ethWei: bigint; due: bigint; arrears: boolean; weight: number; cutBps: number };
export type Job =
  | { kind: "bark"; owner: string }
  | { kind: "bite"; owner: string; repay: string; opensAt: number; closesAt: number };
/** One liquidation by a seat: `bonusUsd` is the bonus it kept, `owedImd` the seat's cut of it (`cutBps`) in IMD wei. */
type BiteRow = { tx: string; block: number; owner: string; keeper: string; debtRepaid: string; marker: boolean; bonusUsd: number; cutBps: number; owedImd: string; at: number };
type State = {
  seats: Record<string, Seat>; seen: Record<string, number>; marks: Record<string, number>;
  assigned: Record<string, { keeper: string; at: number }>; markers: Record<string, string>;
  owners: string[]; ownersBlock: number; bites: BiteRow[]; paid: Record<string, string>; cutBlock: number;
};

const file = () => join(config.dataDir, "nightwatch.json");
const empty = (): State => ({ seats: {}, seen: {}, marks: {}, assigned: {}, markers: {}, owners: [], ownersBlock: 0, bites: [], paid: {}, cutBlock: 0 });
let state: State | null = null;
const load = (): State => {
  if (state) return state;
  try { state = existsSync(file()) ? { ...empty(), ...JSON.parse(readFileSync(file(), "utf8")) } : empty(); } catch { state = empty(); }
  return state!;
};
const save = () => { if (state) writeAtomic(file(), JSON.stringify(state)); };
const lc = (a: string) => a.toLowerCase();

// ---- the liquidation arithmetic, transcribed from imdusd-keeper's lib/vault.mjs (itself a transcription of bite)
const WAD = 10n ** 18n;
const payoutScale = (chop: bigint) => (100n + chop) * 10n ** 16n;
/** The largest debtToRepay bite accepts: bounded by the debt and by the collateral at the vault's price. */
export function maxRepayable(collateral: bigint, debt: bigint, price: bigint, chop: bigint): bigint {
  if (price === 0n || collateral === 0n) return 0n;
  const byCollateral = (collateral * price) / payoutScale(chop);
  if (byCollateral === 0n) return debt === 0n ? 0n : 1n;
  return byCollateral < debt ? byCollateral : debt;
}
/** Where a mark stands at `now` (seconds): in its grace, inside its tail (biteable) or expired. */
export function markWindow(mark: { markedAt: bigint; grace: bigint; marked: boolean }, tail: bigint, now: number) {
  if (!mark.marked) return { state: "unmarked" as const, opensAt: null, closesAt: null };
  const opensAt = Number(mark.markedAt + mark.grace), closesAt = opensAt + Number(tail);
  return { state: now < opensAt ? ("grace" as const) : now > closesAt ? ("expired" as const) : ("actionable" as const), opensAt, closesAt };
}
/** The bonus a liquidator keeps on one bite, in imdUSD wei: the whole bonus less the protocol's share, and less the marker's unless it marked. */
export function keptBonus(debtRepaid: bigint, b: Pick<Book, "chop" | "chip" | "cut">, marker: boolean): bigint {
  return (debtRepaid * b.chop * (10_000n - b.cut - (marker ? 0n : b.chip))) / (100n * 10_000n);
}
/** The Night Watch's cut on that bonus, at the seat's rate. */
export const cutOf = (bonus: bigint, bps: number) => (bonus * BigInt(bps)) / 10_000n;

/**
 * Splits `amount` between seats in proportion to inventory x weight, never above what a seat holds; what a
 * full seat cannot take is shared by the others the same way, and rounding dust goes to the first with room.
 */
export function split(amount: bigint, seats: { inventory: bigint; weight: number }[]): bigint[] {
  const out = seats.map(() => 0n);
  const w = (i: number) => seats[i]!.inventory * BigInt(Math.round(seats[i]!.weight * 100));
  let left = amount, open = seats.map((_, i) => i).filter((i) => seats[i]!.inventory > 0n);
  while (left > 0n && open.length) {
    const total = open.reduce((t, i) => t + w(i), 0n);
    let given = 0n;
    for (const i of open) {
      const room = seats[i]!.inventory - out[i]!, want = (left * w(i)) / total;
      const take = want > room ? room : want;
      out[i] = out[i]! + take; given += take;
    }
    open = open.filter((i) => out[i]! < seats[i]!.inventory);
    left -= given;
    if (given === 0n && open.length) {
      const i = open[0]!, take = left > seats[i]!.inventory - out[i]! ? seats[i]!.inventory - out[i]! : left;
      out[i] = out[i]! + take; left -= take;
    }
  }
  return out;
}

/**
 * The jobs, from the book and the seats (it records which seat holds each mark job). Marks go one at a time to
 * the online seat with the fewest marks for its weight (held for markHoldMs, then offered to the next); a
 * biteable loan, or one whose grace is about to end, is split by `split`, and a share too small to be worth a
 * transaction goes to the heaviest seat that still has room.
 */
export function assign(book: Pick<Book, "positions" | "stale">, seats: SeatLive[], s: Pick<State, "marks" | "assigned">, now = Date.now()): Map<string, Job[]> {
  const jobs = new Map<string, Job[]>();
  const live = seats.filter((x) => x.valid && x.online && !x.arrears);
  for (const x of live) jobs.set(lc(x.keeper), []);
  if (!live.length || book.stale.length) return jobs;
  const push = (k: string, j: Job) => jobs.get(lc(k))!.push(j);
  for (const p of book.positions) {
    if (p.debt < WATCH.minDebt) continue;
    if (p.state === "unmarked" || p.state === "expired") {
      const held = s.assigned[lc(p.owner)];
      const holder = held && now - held.at < WATCH.markHoldMs && live.find((x) => lc(x.keeper) === held.keeper);
      const turns = (x: SeatLive) => (s.marks[lc(x.keeper)] ?? 0) / x.weight;
      const pick = holder || [...live].sort((a, b) => turns(a) - turns(b) || b.weight - a.weight || a.watcher - b.watcher)[0]!;
      if (!holder) s.assigned[lc(p.owner)] = { keeper: lc(pick.keeper), at: now };
      push(pick.keeper, { kind: "bark", owner: p.owner });
      continue;
    }
    if ((p.state === "grace" || p.state === "actionable") && p.maxRepay > 0n) {
      const able = live.filter((x) => x.inventory >= WATCH.minSlice).sort((a, b) => b.weight - a.weight || a.watcher - b.watcher);
      if (!able.length) continue;
      const shares = split(p.maxRepay, able);
      let rest = 0n;
      shares.forEach((v, i) => { if (v > 0n && v < WATCH.minSlice) { rest += v; shares[i] = 0n; } });
      for (let i = 0; rest > 0n && i < able.length; i++) {
        const room = able[i]!.inventory - shares[i]!, take = rest > room ? room : rest;
        shares[i] = shares[i]! + take; rest -= take;
      }
      able.forEach((x, i) => {
        if (shares[i]! > 0n) push(x.keeper, { kind: "bite", owner: p.owner, repay: shares[i]!.toString(), opensAt: p.opensAt!, closesAt: p.closesAt! });
      });
    }
  }
  return jobs;
}

// ---- reading the vault
let book: Book | null = null;
export const currentBook = () => book;

/** Every account that ever opened a position: Lock/Draw/Earn logs, read forward from the last block seen. */
async function refreshOwners(s: State, head: bigint) {
  const set = new Set(s.owners);
  let from = s.ownersBlock ? BigInt(s.ownersBlock) + 1n : WATCH.vaultBlock;
  while (from <= head) {
    const to = from + 4_999n > head ? head : from + 4_999n;
    const logs = await eth.getLogs({ address: WATCH.vault as Address, events: OWNER_EVENTS, fromBlock: from, toBlock: to });
    for (const l of logs) set.add(lc((l.args as { account: string }).account));
    s.ownersBlock = Number(to);
    from = to + 1n;
  }
  s.owners = [...set];
}

/** A public node can answer an empty array for a range it would not search; Blockscout's index fills any gap. */
async function crossCheckOwners(s: State) {
  try {
    const set = new Set(s.owners);
    let params: Record<string, string> | null = null;
    for (let page = 0; page < 20; page++) {
      const u = new URL(`https://eth.blockscout.com/api/v2/addresses/${WATCH.vault}/logs`);
      if (params) for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
      const r = await fetch(u, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 NIGHTSHIFT" }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return;
      const d = (await r.json()) as { items?: { topics?: string[] }[]; next_page_params?: Record<string, string> | null };
      for (const it of d.items ?? []) {
        const [t0, t1] = it.topics ?? [];
        if (t0 && t1 && OWNER_TOPICS.has(lc(t0))) set.add(lc(`0x${t1.slice(-40)}`));
      }
      params = d.next_page_params ?? null;
      if (!params) break;
    }
    s.owners = [...set];
  } catch { /* the RPC scan stands alone */ }
}
const OWNER_TOPICS = new Set(OWNER_EVENTS.map((e) => lc(toEventSelector(e))));

export async function readBook(s = load()): Promise<Book> {
  const block = await eth.getBlock();
  await refreshOwners(s, block.number);
  const V = { address: WATCH.vault as Address, abi: VAULT_ABI } as const;
  const [mat, lull, tail, chip, cut, chop, totalDebt, backing, priceFeed, nhiFeed, collFeed, supply] = await Promise.all([
    eth.readContract({ ...V, functionName: "mat" }), eth.readContract({ ...V, functionName: "lull" }), eth.readContract({ ...V, functionName: "tail" }),
    eth.readContract({ ...V, functionName: "chip" }), eth.readContract({ ...V, functionName: "cut" }), eth.readContract({ ...V, functionName: "CHOP_PERCENT" }),
    eth.readContract({ ...V, functionName: "totalDebt" }), eth.readContract({ ...V, functionName: "backingPerUnit" }).catch(() => 0n),
    eth.readContract({ ...V, functionName: "priceFeed" }), eth.readContract({ ...V, functionName: "nhiFeed" }), eth.readContract({ ...V, functionName: "collateralPriceFeed" }),
    eth.readContract({ address: WATCH.imdusd as Address, abi: erc20Abi, functionName: "totalSupply" }),
  ]);
  const [[price], collStale, priceStale, nhiStale] = await Promise.all([
    eth.readContract({ address: collFeed, abi: FEED_ABI, functionName: "latestValue" }),
    eth.readContract({ address: collFeed, abi: FEED_ABI, functionName: "isStale" }),
    eth.readContract({ address: priceFeed, abi: FEED_ABI, functionName: "isStale" }),
    eth.readContract({ address: nhiFeed, abi: FEED_ABI, functionName: "isStale" }),
  ]);
  const stale = [priceStale && "price feed", nhiStale && "network health feed", collStale && "collateral price", price === 0n && "no price yet"].filter(Boolean) as string[];
  const peg = await eth.readContract({ address: WATCH.stateView as Address, abi: STATE_VIEW, functionName: "getSlot0", args: [WATCH.pegPool as Hex] })
    .then(([sp]) => { const r = Number(sp) / 2 ** 96; return r * r * 1e12; }).catch(() => null);
  const now = Number(block.timestamp);
  const rows = s.owners.length ? await eth.multicall({ allowFailure: true, contracts: s.owners.flatMap((o) => [
    { ...V, functionName: "positions" as const, args: [o as Address] },
    { ...V, functionName: "collateralRatio" as const, args: [o as Address] },
    { ...V, functionName: "liquidationMarks" as const, args: [o as Address] },
  ]) }) : [];
  const positions: Position[] = [];
  s.owners.forEach((owner, i) => {
    const [pos, cr, mk] = [rows[i * 3], rows[i * 3 + 1], rows[i * 3 + 2]];
    if (pos?.status !== "success" || mk?.status !== "success") return;
    const [collateral, debt] = pos.result as readonly [bigint, bigint];
    if (debt === 0n) return;
    const [markedAt, grace, marked, marker] = mk.result as readonly [bigint, bigint, boolean, string];
    const ratio = cr?.status === "success" ? (cr.result as bigint) : 0n;
    const w = markWindow({ markedAt, grace, marked }, tail, now);
    // healthy with a mark left on it is still safe: bite re-checks, and the borrower's next lock or wipe clears it
    const unsafe = ratio < mat;
    // a seat's mark counts once, when it first shows up: that is how the turn passes to the next seat
    if (marked && s.markers[owner] !== lc(marker)) {
      s.markers[owner] = lc(marker);
      if (Object.values(s.seats).some((x) => x.keeper === lc(marker))) s.marks[lc(marker)] = (s.marks[lc(marker)] ?? 0) + 1;
    }
    positions.push({
      owner, collateral, debt, cr: ratio, state: unsafe ? w.state : "safe", marker: marked ? lc(marker) : null,
      opensAt: w.opensAt, closesAt: w.closesAt, maxRepay: unsafe ? maxRepayable(collateral, debt, price, chop) : 0n,
    });
  });
  positions.sort((a, b) => (a.cr < b.cr ? -1 : a.cr > b.cr ? 1 : 0));
  book = { at: Date.now(), now, block: Number(block.number), mat, lull, tail, chip, cut, chop, price, stale, totalDebt, supply, backing, peg, owners: s.owners.length, positions };
  return book;
}

/** The seats' bites and their cut payments since each was paired, read forward from the last block seen. */
async function readCut(s: State, b: Book) {
  const keepers = new Set(Object.values(s.seats).map((x) => lc(x.keeper)));
  const head = await eth.getBlockNumber();
  const first = Math.min(...Object.values(s.seats).map((x) => x.pairedBlock ?? Number(head)));
  let from = BigInt(s.cutBlock ? s.cutBlock + 1 : Number.isFinite(first) ? first : Number(head));
  if (!keepers.size) { s.cutBlock = Number(head); return; }
  const imdUsd = (await prices())?.imd.at(-1)?.close ?? 0;
  while (from <= head) {
    const to = from + 4_999n > head ? head : from + 4_999n;
    const [bites, wd, tr] = await Promise.all([
      eth.getLogs({ address: WATCH.vault as Address, event: BITE, fromBlock: from, toBlock: to }),
      eth.getLogs({ address: WATCH.simd as Address, event: WITHDRAW, args: { to: WATCH.splitter as Address }, fromBlock: from, toBlock: to }),
      eth.getLogs({ address: WATCH.imd as Address, event: TRANSFER, args: { to: WATCH.splitter as Address }, fromBlock: from, toBlock: to }),
    ]);
    for (const l of bites) {
      const k = lc(l.args.liquidator!);
      if (!keepers.has(k) || s.bites.some((x) => x.tx === l.transactionHash && x.owner === lc(l.args.owner!))) continue;
      if (!imdUsd) return; // no IMD price: read this range again next time rather than owe nothing
      const marker = s.markers[lc(l.args.owner!)] === k;
      const bonus = keptBonus(l.args.debtRepaid!, b, marker);
      const { cutBps } = termsOf(Object.values(s.seats).find((x) => x.keeper === k)!.watcher);
      s.bites.push({
        tx: l.transactionHash, block: Number(l.blockNumber), owner: lc(l.args.owner!), keeper: k, debtRepaid: l.args.debtRepaid!.toString(), marker,
        bonusUsd: Number(bonus) / 1e18, cutBps, owedImd: (BigInt(Math.ceil((Number(cutOf(bonus, cutBps)) / 1e18 / imdUsd) * 1e6)) * 10n ** 12n).toString(), at: Date.now(),
      });
    }
    for (const l of wd) { const k = lc(l.args.owner!); if (keepers.has(k)) s.paid[k] = (BigInt(s.paid[k] ?? "0") + l.args.assets!).toString(); }
    for (const l of tr) { const k = lc(l.args.from!); if (keepers.has(k)) s.paid[k] = (BigInt(s.paid[k] ?? "0") + l.args.value!).toString(); }
    s.cutBlock = Number(to);
    from = to + 1n;
  }
}

/** What a keeper still owes, in IMD wei, and whether it is overdue. */
export function dueOf(s: Pick<State, "bites" | "paid">, keeper: string, now = Date.now()) {
  const k = lc(keeper);
  const mine = s.bites.filter((x) => x.keeper === k);
  const owed = mine.reduce((t, x) => t + BigInt(x.owedImd), 0n);
  const due = owed - BigInt(s.paid[k] ?? "0");
  if (due <= 0n) return { owed, due: 0n, arrears: false };
  // the oldest bite the payments have not covered yet
  let covered = BigInt(s.paid[k] ?? "0"), oldest = now;
  for (const x of mine) { if (covered >= BigInt(x.owedImd)) { covered -= BigInt(x.owedImd); continue; } oldest = x.at; break; }
  return { owed, due, arrears: now - oldest > WATCH.arrearsMs };
}

let liveSeats: SeatLive[] = [];
async function readSeats(s: State): Promise<SeatLive[]> {
  const seats = Object.values(s.seats);
  if (!seats.length) return (liveSeats = []);
  // the Captain's seat follows NIGHT FROG #1 (then The Captain); a Night Watcher's seat follows the forge's token
  const owners = await Promise.all(seats.map((x) => chainOwnerOf(x.watcher)));
  const inv = await eth.multicall({ allowFailure: true, contracts: seats.map((x) => ({ address: WATCH.imdusd as Address, abi: erc20Abi, functionName: "balanceOf" as const, args: [x.keeper as Address] })) });
  const gas = await Promise.all(seats.map((x) => eth.getBalance({ address: x.keeper as Address }).catch(() => 0n)));
  return (liveSeats = seats.map((x, i) => {
    const d = dueOf(s, x.keeper);
    return {
      ...x, valid: owners[i] === lc(x.owner),
      online: Date.now() - (s.seen[lc(x.keeper)] ?? 0) < WATCH.onlineMs,
      inventory: inv[i]?.status === "success" ? (inv[i]!.result as bigint) : 0n, ethWei: gas[i]!, due: d.due, arrears: d.arrears, ...termsOf(x.watcher),
    };
  }));
}

let lastJobs = new Map<string, Job[]>();
let checkedAt = 0;
/** One pass: the book, the seats, the cut, the jobs. Runs every minute once started; safe to call by hand. */
export async function tick(onBite?: (row: BiteRow, seat: Seat | undefined) => void) {
  const s = load();
  if (Date.now() - checkedAt > 30 * 60_000) { checkedAt = Date.now(); await crossCheckOwners(s); }
  const b = await readBook(s);
  const before = s.bites.length;
  await readCut(s, b).catch((e) => console.error("nightwatch cut", (e as Error).message));
  for (const row of s.bites.slice(before)) onBite?.(row, Object.values(s.seats).find((x) => lc(x.keeper) === row.keeper));
  const seats = await readSeats(s);
  lastJobs = assign(b, seats, s);
  save();
}

export function startNightWatch(onBite?: Parameters<typeof tick>[0]) {
  const run = () => void tick(onBite).catch((e) => console.error("nightwatch", (e as Error).message));
  run();
  setInterval(run, 60_000);
}

// ---- the bots' side: pairing and jobs

export const PAIR_DOMAIN = { name: "NIGHTSHIFT Night Watch", version: "1", chainId: 1 } as const;
export const PAIR_TYPES = { Seat: [{ name: "watcher", type: "uint256" }, { name: "keeper", type: "address" }, { name: "issuedAt", type: "uint256" }] } as const;
export class WatchError extends Error { constructor(msg: string, readonly status = 400) { super(msg); } }

/** The message a bot signs with its keeper key on every request: who it is and when (two minutes of slack). */
export const authMessage = (keeper: string, ts: number) => `NIGHT WATCH ${lc(keeper)} ${ts}`;
export async function authKeeper(keeper: string | undefined, ts: string | undefined, sig: string | undefined): Promise<string> {
  if (!keeper || !/^0x[0-9a-fA-F]{40}$/.test(keeper) || !ts || !sig) throw new WatchError("Sign the request with the keeper key (x-keeper, x-ts, x-sig).", 401);
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 120) throw new WatchError("The request's clock is off by more than two minutes.", 401);
  const ok = await verifyMessage({ address: keeper as Address, message: authMessage(keeper, Number(ts)), signature: sig as Hex }).catch(() => false);
  if (!ok) throw new WatchError("That signature is not the keeper's.", 401);
  return lc(keeper);
}

type OwnerOf = (watcher: number) => Promise<string | null>;
const ownerFrom = (address: string, id: bigint) => eth.readContract({ address: address as Address, abi: FORGE_ABI, functionName: "ownerOf", args: [id] }).then((o) => lc(String(o))).catch(() => null);
/** Who holds the Captain's seat: The Captain (forge token 0) once #1 is forged, NIGHT FROG #1 until then. */
async function captainHolder(): Promise<string | null> {
  const forged = forgeOn() && (await eth.readContract({ address: config.forge.address as Address, abi: FORGE_ABI, functionName: "captainForged" }).catch(() => false));
  return forged ? ownerFrom(config.forge.address, 0n) : ownerFrom(config.nft.address || WATCH.frogs, 1n);
}
const chainOwnerOf: OwnerOf = async (n) => (n === CAPTAIN ? captainHolder() : forgeOn() ? ownerFrom(config.forge.address, BigInt(n)) : null);

/** The seat owner's one signature that pairs a seat (the Captain's, or a Night Watcher's) to a keeper wallet. A new pairing replaces the old. */
export async function pair(body: { watcher?: unknown; keeper?: unknown; issuedAt?: unknown; signature?: unknown }, ownerOf: OwnerOf = chainOwnerOf) {
  const watcher = Number(body.watcher), keeper = String(body.keeper ?? ""), issuedAt = Number(body.issuedAt);
  if (!Number.isInteger(watcher) || watcher < CAPTAIN || watcher > 50) throw new WatchError("Pick your seat: the Captain's (NIGHT FROG #1) or a Night Watcher (#1–50).");
  if (!/^0x[0-9a-fA-F]{40}$/.test(keeper)) throw new WatchError("The keeper address is missing: run `node bot.mjs pair` and open its link.");
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() / 1000 - issuedAt) > 600) throw new WatchError("This pairing expired: sign it again.");
  const owner = await ownerOf(watcher);
  if (!owner) throw new WatchError(watcher === CAPTAIN ? "NIGHT FROG #1 could not be read; try again in a minute." : forgeOn() ? `Night Watcher #${watcher} does not exist yet.` : "Night Watcher seats open when the Night Watchers are minted. The Captain's seat (NIGHT FROG #1) is open now.", 409);
  const ok = await verifyTypedData({ address: owner as Address, domain: PAIR_DOMAIN, types: PAIR_TYPES, primaryType: "Seat", message: { watcher: BigInt(watcher), keeper: keeper as Address, issuedAt: BigInt(issuedAt) }, signature: String(body.signature ?? "") as Hex }).catch(() => false);
  if (!ok) throw new WatchError(`Sign with the wallet that holds ${watcher === CAPTAIN ? "NIGHT FROG #1" : `Night Watcher #${watcher}`}.`, 403);
  const s = load();
  const other = Object.values(s.seats).find((x) => lc(x.keeper) === lc(keeper) && x.watcher !== watcher);
  if (other) throw new WatchError(`That keeper already serves ${seatName(other.watcher)}: one keeper wallet per seat.`, 409);
  // the cut is counted from the block the seat was paired at (the last book's, or the next scan's head)
  const seat: Seat = { watcher, keeper: lc(keeper), owner, pairedAt: Date.now(), pairedBlock: book?.block };
  s.seats[String(watcher)] = seat;
  save();
  return seat;
}

/** A bot's poll: it counts as online, and gets its jobs and what it owes. */
export function jobsFor(keeper: string) {
  const s = load();
  const seat = Object.values(s.seats).find((x) => lc(x.keeper) === lc(keeper));
  if (!seat) throw new WatchError("This keeper is not paired to a seat yet: run `node bot.mjs pair`.", 404);
  s.seen[lc(keeper)] = Date.now();
  const live = liveSeats.find((x) => x.watcher === seat.watcher);
  const d = dueOf(s, keeper);
  const b = book;
  return {
    watcher: seat.watcher, seat: seatName(seat.watcher), valid: live?.valid ?? null, arrears: d.arrears, weight: termsOf(seat.watcher).weight,
    cut: { token: WATCH.imd, to: WATCH.splitter, simd: WATCH.simd, bps: termsOf(seat.watcher).cutBps, owedImd: d.owed.toString(), dueImd: d.due.toString() },
    stale: b?.stale ?? ["no book yet"], blockTime: b?.now ?? null,
    jobs: lastJobs.get(lc(keeper)) ?? [],
  };
}

/**
 * Which seats a wallet holds right now (the Captain's if it holds NIGHT FROG #1, and its Night Watchers), and
 * how far each is set up: paired by this holder, its keeper, whether the bot is online. The /watch page and
 * the bot's doctor read it.
 */
export async function holderSeats(address: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new WatchError("That is not a wallet address.");
  const a = lc(address), s = load();
  const captain = (await captainHolder()) === a;
  let watchers: number[] = [];
  if (forgeOn()) {
    const all = await forgedAll();
    const owners = all.length ? await eth.multicall({ allowFailure: true, contracts: all.map((f) => ({ address: config.forge.address as Address, abi: FORGE_ABI, functionName: "ownerOf" as const, args: [BigInt(f.n)] })) }) : [];
    watchers = all.filter((f, i) => f.n !== 0 && owners[i]?.status === "success" && lc(String(owners[i]!.result)) === a).map((f) => f.n);
  }
  return {
    address: a, open: forgeOn(),
    seats: [...(captain ? [CAPTAIN] : []), ...watchers].map((w) => {
      const seat = s.seats[String(w)], live = liveSeats.find((x) => x.watcher === w), f = forgedOf(w);
      const paired = Boolean(seat && seat.owner === a);
      return {
        watcher: w, name: seatName(w), tier: w === CAPTAIN ? "Captain" : f ? tierInfo(f.tier).name : null, ...termsOf(w),
        paired, keeper: paired ? seat!.keeper : null, online: paired && (live?.online ?? false), arrears: paired && (live?.arrears ?? false),
      };
    }),
  };
}

// ---- the public page

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const wad = (x: bigint) => Number(x) / 1e18;
export async function watchStatus() {
  const s = load(), b = book;
  const forged = forgeOn() ? await forgedAll() : [];
  // what a seat kept: its share of each bonus, less the cut
  const net = (r: BiteRow) => r.bonusUsd * (1 - (r.cutBps ?? 1000) / 10_000);
  const earned = (k: string) => s.bites.filter((x) => x.keeper === lc(k)).reduce((t, x) => t + net(x), 0);
  return {
    open: forgeOn(), watchers: forged.length, terms: TERMS, splitter: WATCH.splitter, contracts: { vault: WATCH.vault, imdusd: WATCH.imdusd, simd: WATCH.simd, pegPool: WATCH.pegPool },
    book: b && {
      at: b.at, blockTime: b.now, mat: Number(b.mat), lullHours: Number(b.lull) / 3600, bonusPct: Number(b.chop), chipBps: Number(b.chip), cutBps: Number(b.cut),
      stale: b.stale, supply: wad(b.supply), totalDebt: wad(b.totalDebt), backing: wad(b.backing), peg: b.peg, owners: b.owners,
      loans: b.positions.filter((p) => p.debt >= WATCH.minDebt).length,
      closestCr: Number(b.positions.find((p) => p.debt >= WATCH.minDebt)?.cr ?? 0),
      watchlist: b.positions.filter((p) => p.debt >= WATCH.minDebt && (p.state !== "safe" || p.cr < (b.mat * 115n) / 100n)).slice(0, 12).map((p) => ({
        owner: short(p.owner), debt: wad(p.debt), cr: Number(p.cr), state: p.state, opensAt: p.opensAt, closesAt: p.closesAt, repay: wad(p.maxRepay),
      })),
    },
    seats: Object.values(s.seats).sort((a, b) => a.watcher - b.watcher).map((x) => {
      const live = liveSeats.find((l) => l.watcher === x.watcher);
      const f = forgedOf(x.watcher);
      return {
        watcher: x.watcher, tier: x.watcher === CAPTAIN ? "Captain" : f ? tierInfo(f.tier).name : null, ...termsOf(x.watcher), keeper: short(x.keeper), online: live?.online ?? false, valid: live?.valid ?? null,
        inventory: live ? wad(live.inventory) : null, bites: s.bites.filter((r) => r.keeper === x.keeper).length, marks: s.marks[x.keeper] ?? 0,
        earnedUsd: Math.round(earned(x.keeper) * 100) / 100, arrears: live?.arrears ?? false,
      };
    }),
    recent: s.bites.slice(-10).reverse().map((r) => ({ tx: r.tx, watcher: Object.values(s.seats).find((x) => x.keeper === r.keeper)?.watcher ?? null, debt: wad(BigInt(r.debtRepaid)), usd: Math.round(net(r) * 100) / 100, at: r.at })),
  };
}
