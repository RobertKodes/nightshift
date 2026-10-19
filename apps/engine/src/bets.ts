import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { type AbiEvent, type Address, type Hex, type LocalAccount, decodeEventLog, encodeAbiParameters, erc20Abi, formatUnits, getAddress, keccak256, parseAbi, parseAbiItem, parseUnits, stringToHex, toEventSelector } from "viem";
import { writeAtomic } from "./atomic.js";
import { type Weights, MAX_WEIGHT, MIN_WEIGHT, SwingGuard, TRAILER_MAX_WEIGHT, chessWeights, pinballWeights } from "./bet-weights.js";
import { CONTROLS, type ChessGames } from "./chess.js";
import { GameError, TOKENS, type Token } from "./escrow.js";

/**
 * LIVE IN-PLAY BETTING for spectators, against BetPool on Ethereum (the swarm's "arena-bets"
 * order in swarm.ts): a pari-mutuel pool per match and token, where each bet carries a weight the
 * server sets from the game at that moment (bet-weights.ts) and signs into a short ticket.
 *
 * - Markets: one per live match worth betting on, per token, made lazily when the first spectator
 *   asks for a ticket. A free anonymous game could be played by one person on both seats, and so
 *   could two wallets (sybils) throw a game for a friend's bets, so only:
 *     - staked GameEscrow duels of at least MIN_MARKET_STAKE, whose pool is capped at
 *       POOL_PER_STAKE × the stake, in the stake's token: fixing it would cost more than it pays;
 *     - arena games between two agents of different owners that are both IMD seats (distinct seats,
 *       which cost money) or both established (ESTABLISHED: old enough, with enough rated games
 *       against enough other owners).
 *   Nobody tied to the match (a player, an agent's owner) may bet on it. Its id
 *   is derived from the board and the match id, so it is the same on every request; the server signs
 *   the Market and anyone may submit createMarket (the keeper does at once, the bettor's page does if
 *   the keeper has not).
 * - Tickets: a signed Ticket for exactly one wallet, side, amount and weight, good for TICKET_TTL
 *   seconds, refused while the game is locked (bet-weights.ts, and a few seconds after a big swing),
 *   outside the contract's limits, past one wallet's total cap on a market (the contract's per-bet
 *   maximum), past a staked duel's pool cap, or too often; never once the game is over.
 * - Settlement: the same verified result the game already produced (chess moves and clocks played
 *   here, the pinball replay, the arena's games) becomes a signed Outcome once: 0 = A won, 1 = B
 *   won, 2 = void (a draw, or a game that ended without a result). It is decided the moment the game
 *   ends (the game's own change stream, the lobby's verdict, any look at it; the 2 s tick as a
 *   backstop), and the keeper relays settle() once, privately (Flashbots Protect), so a ticket still
 *   in someone's hand cannot be raced in ahead of it from the public mempool. The signature stays
 *   available for anyone to submit.
 * Nothing here can move a bet: the most a server signature can do is open a market for a real match,
 * admit a bet the bettor pays for, and name the side that won.
 */
export const BOARDS = { chess: stringToHex("chess", { size: 32 }), pinball: stringToHex("pinball", { size: 32 }), arena: stringToHex("arena", { size: 32 }) } as const;
export type Board = keyof typeof BOARDS;
/**
 * A ticket is good for this long (the contract allows at most 120 s): a weight is only true for a
 * moment, and a ticket issued just before the game ends can still be mined after it, until settle()
 * lands. Server-side this window is kept small (short tickets, none once the game is done or about
 * to be, settle relayed at once and privately); the full fix needs the contract: an issuedAt in the
 * Ticket and a cutoff in the Outcome (bets issued after the cutoff refunded), which BetPool v1 lacks.
 */
export const TICKET_TTL = 8;
/** Shown for a match that gets no market (a free game, or agents of one owner). */
export const NOT_ELIGIBLE = "Betting is for staked duels and agent games.";
/** Shown for an agent game whose agents are neither both IMD seats nor both established. */
export const NOT_ESTABLISHED = "Betting opens on agent games once both agents are IMD seats, or established (a week old, 10 rated games against 3 other owners).";
/** A staked duel gets a market only with at least this stake. */
export const MIN_MARKET_STAKE: Record<Token, bigint> = { IMD: 10n * 10n ** 18n, SHIFT: 400_000n * 10n ** 18n };
/** A staked duel's pool (both sides, all wallets) is at most this many times its stake. */
export const POOL_PER_STAKE = 4n;
/** An arena agent is established when it is this old, with this many rated games against agents of this many other owners. */
export const ESTABLISHED = { ageMs: 7 * 86_400_000, rated: 10, opponents: 3 } as const;
/** A market's hard latest time for bets (the server stops issuing tickets long before). */
export const MARKET_WINDOW = 6 * 3_600;
/** A signed outcome is good for this long; asked for later, the same outcome is signed again. */
export const OUTCOME_TTL = 12 * 3_600;
/** Tickets one wallet may ask for in a minute. */
export const TICKETS_PER_MINUTE = 12;
/** Markets the keeper creates on chain in an hour, at most (past that the bettor's page creates them). */
export const KEEPER_CREATES_PER_HOUR = 30;
/** A bet this big gets a community card. */
export const BIG_BET: Record<Token, bigint> = { IMD: 25n * 10n ** 18n, SHIFT: 1_000_000n * 10n ** 18n };
export const OUTCOMES = { A: 0, B: 1, VOID: 2 } as const;
export type Outcome = 0 | 1 | 2;

export const BETS_ABI = parseAbi([
  "function createMarket(bytes32 marketId, address token, uint64 closesAt, bytes32 game, bytes signature)",
  "function bet(bytes32 marketId, uint8 side, uint256 amount, uint16 weightBps, uint64 expiry, bytes32 nonce, bytes signature)",
  "function settle(bytes32 marketId, uint8 outcome, uint256 deadline, bytes signature)",
  "function claim(bytes32 marketId)",
  "function claimMany(bytes32[] marketIds)",
  "function expire(bytes32 marketId)",
  "function markets(bytes32 marketId) view returns (address token, uint64 closesAt, bytes32 game, uint256 totalA, uint256 totalB, uint256 sharesA, uint256 sharesB, bool settled, uint8 outcome, bool refundable)",
  "function betsOf(bytes32 marketId, address wallet) view returns (uint256 amountA, uint256 amountB, uint256 sharesA, uint256 sharesB, bool claimed)",
  "function claimable(bytes32 marketId, address wallet) view returns (uint256)",
  "function limits(address token) view returns (uint256 min, uint256 max)",
  "function usedNonce(bytes32 nonce) view returns (bool)",
  "function signer() view returns (address)",
  "function paused() view returns (bool)",
  "function setSigner(address newSigner)",
  "event MarketCreated(bytes32 indexed marketId, address indexed token, uint64 closesAt, bytes32 game)",
  "event BetPlaced(bytes32 indexed marketId, address indexed bettor, uint8 side, uint256 amount, uint16 weightBps, uint256 shares)",
  "event Settled(bytes32 indexed marketId, uint8 outcome, uint256 fee)",
  "event Claimed(bytes32 indexed marketId, address indexed bettor, uint256 amount)",
  "event Expired(bytes32 indexed marketId)",
]);

/**
 * The events, by their parameters. Which of them the deployed contract indexes is not in the spec,
 * so a log is decoded by its topic count: the first n parameters indexed (the usual Solidity
 * layout: marketId, then the bettor or token). The selector does not depend on indexing.
 */
export const EVENT_PARAMS: Record<string, string[]> = {
  MarketCreated: ["bytes32 marketId", "address token", "uint64 closesAt", "bytes32 game"],
  BetPlaced: ["bytes32 marketId", "address bettor", "uint8 side", "uint256 amount", "uint16 weightBps", "uint256 shares"],
  Settled: ["bytes32 marketId", "uint8 outcome", "uint256 fee"],
  Claimed: ["bytes32 marketId", "address bettor", "uint256 amount"],
  Expired: ["bytes32 marketId"],
};
const SELECTORS = new Map(Object.entries(EVENT_PARAMS).map(([name, ps]) => [toEventSelector(`${name}(${ps.map((p) => p.split(" ")[0]).join(",")})`), name]));
const ITEMS = new Map<string, AbiEvent>();
/** The event with its first `indexed` parameters indexed. */
export function eventItem(name: string, indexed: number): AbiEvent {
  const key = `${name}/${indexed}`;
  let item = ITEMS.get(key);
  if (!item) {
    item = parseAbiItem(`event ${name}(${EVENT_PARAMS[name]!.map((p, i) => (i < indexed ? p.replace(" ", " indexed ") : p)).join(", ")})` as string) as AbiEvent;
    ITEMS.set(key, item);
  }
  return item;
}
export type RawLog = { topics: readonly Hex[]; data: Hex; blockNumber: bigint | null; transactionHash: Hex | null; logIndex: number | null };
/** One BetPool log, whatever the deployed contract indexes; null for anything else. */
export function decodeBetLog(l: RawLog): { eventName: string; args: Record<string, unknown> } | null {
  const name = l.topics[0] ? SELECTORS.get(l.topics[0].toLowerCase() as Hex) : undefined;
  if (!name) return null;
  const indexed = l.topics.length - 1;
  if (indexed > Math.min(3, EVENT_PARAMS[name]!.length)) return null;
  try {
    const d = decodeEventLog({ abi: [eventItem(name, indexed)], data: l.data, topics: l.topics as [Hex, ...Hex[]] });
    return { eventName: name, args: d.args as unknown as Record<string, unknown> };
  } catch { return null; }
}

export const betsDomain = (verifyingContract: Address) => ({ name: "NightshiftBets", version: "1", chainId: 1, verifyingContract }) as const;
export const MARKET_TYPES = { Market: [{ name: "marketId", type: "bytes32" }, { name: "token", type: "address" }, { name: "closesAt", type: "uint64" }, { name: "game", type: "bytes32" }] } as const;
export const TICKET_TYPES = { Ticket: [{ name: "marketId", type: "bytes32" }, { name: "bettor", type: "address" }, { name: "side", type: "uint8" }, { name: "amount", type: "uint256" }, { name: "weightBps", type: "uint16" }, { name: "expiry", type: "uint64" }, { name: "nonce", type: "bytes32" }] } as const;
export const OUTCOME_TYPES = { Outcome: [{ name: "marketId", type: "bytes32" }, { name: "outcome", type: "uint8" }, { name: "deadline", type: "uint256" }] } as const;
export type MarketMsg = { marketId: Hex; token: Address; closesAt: bigint; game: Hex };
export type TicketMsg = { marketId: Hex; bettor: Address; side: number; amount: bigint; weightBps: number; expiry: bigint; nonce: Hex };
export type OutcomeMsg = { marketId: Hex; outcome: number; deadline: bigint };
export const signMarket = (a: LocalAccount, pool: Address, message: MarketMsg) => a.signTypedData({ domain: betsDomain(pool), types: MARKET_TYPES, primaryType: "Market", message });
export const signTicket = (a: LocalAccount, pool: Address, message: TicketMsg) => a.signTypedData({ domain: betsDomain(pool), types: TICKET_TYPES, primaryType: "Ticket", message });
export const signOutcome = (a: LocalAccount, pool: Address, message: OutcomeMsg) => a.signTypedData({ domain: betsDomain(pool), types: OUTCOME_TYPES, primaryType: "Outcome", message });

/** The market for one match and token: the same id every time it is asked for. */
export function marketIdOf(board: Board, id: string, token: Token): Hex {
  return keccak256(encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "string" }, { type: "address" }], ["NightshiftBets", board, id, TOKENS[token]]));
}

/** A live match as betting sees it: who plays, the weights now, and the verified result once there is one. */
export type MatchState = {
  /** Where the match is played (an arena table on the site's NIGHT CHESS board is "chess"). */
  board: Board; id: string;
  names: [string, string];
  stake: { currency: string; amount: string };
  weights: Weights;
  /** Why this match gets no market at all, or null when it may have one. */
  eligible: string | null;
  /** Wallets that may not bet on it (lowercase): the players, the agents' owners. */
  tied: string[];
  /** A staked duel's escrow stake (one player's), or null: its market is in this token, its pool capped by it. */
  staked?: { token: Token; amount: bigint } | null;
  /** 0 = A won, 1 = B won, 2 = void; null while it is played. */
  result: Outcome | null; reason: string | null;
};
export type Lookup = (game: Board, id: string) => MatchState | null;

type ChessView = ReturnType<ChessGames["watchView"]>;
/** chess.ts betInfo(); `drawOffer` (a draw offer open) when it reports one. */
type ChessInfo = ReturnType<ChessGames["betInfo"]>;
/** An agent at an arena table, as betting checks it: what arena.ts profile() says of it. */
export type ArenaSeat = {
  kind: "imd" | "open"; owner: string; seat: number | null; createdAt: number;
  /** Its rated games against agents of other owners, and how many distinct owners those were. */
  rated: number; opponents: number;
};
/** What arena.ts betParties() gives for a table: the agents' owners by colour, and owners assigned to its staked seats; plus the agents themselves. */
export type ArenaParties = { owners: { w: string | null; b: string | null }; agents: number; assigned: string[]; seats?: { w: ArenaSeat | null; b: ArenaSeat | null } };
/** Old enough, with enough rated games against enough other owners (ESTABLISHED). */
export const established = (a: ArenaSeat, now: number) => now - a.createdAt >= ESTABLISHED.ageMs && a.rated >= ESTABLISHED.rated && a.opponents >= ESTABLISHED.opponents;
/**
 * Who may bet on a chess game. A market only for a staked duel, or for two registered agents of
 * different owners that are both IMD seats (two distinct seats) or both established; never a bet
 * from a player's wallet, an agent's owner, or an owner who assigned an agent to one of its staked seats.
 */
export function chessParties(info: Pick<ChessInfo, "escrow" | "wallets">, arena: ArenaParties | null, now = Date.now()): { eligible: string | null; tied: string[] } {
  const tied = [...new Set([info.wallets.w, info.wallets.b, arena?.owners.w, arena?.owners.b, ...(arena?.assigned ?? [])].filter((x): x is string => !!x).map(lc))];
  if (info.escrow) return { eligible: null, tied };
  const w = arena?.seats?.w ?? null, b = arena?.seats?.b ?? null;
  const agents = !!arena && arena.agents === 2 && !!arena.owners.w && !!arena.owners.b && lc(arena.owners.w) !== lc(arena.owners.b);
  if (!agents) return { eligible: NOT_ELIGIBLE, tied };
  const known = !!w && !!b && lc(w.owner) === lc(arena!.owners.w) && lc(b.owner) === lc(arena!.owners.b);
  const seats = known && w!.kind === "imd" && b!.kind === "imd" && w!.seat !== null && b!.seat !== null && w!.seat !== b!.seat;
  return { eligible: seats || (known && established(w!, now) && established(b!, now)) ? null : NOT_ESTABLISHED, tied };
}
/** A staked duel's stake as betting uses it, or null; and why it is too small for a market. */
function stakeOf(escrow: string | null, currency: string, amount: string): { staked: { token: Token; amount: bigint } | null; small: string | null } {
  if (!escrow) return { staked: null, small: null };
  let wei = 0n;
  try { wei = parseUnits(amount, 18); } catch { /* not a decimal: no market */ }
  if (!Object.hasOwn(TOKENS, currency) || wei < MIN_MARKET_STAKE[currency as Token]) {
    const min = Object.hasOwn(TOKENS, currency) ? `${formatUnits(MIN_MARKET_STAKE[currency as Token], 18)} ${currency}` : "the minimum";
    return { staked: null, small: `Betting opens on staked duels of at least ${min}.` };
  }
  return { staked: { token: currency as Token, amount: wei }, small: null };
}
/** A NIGHT CHESS game (the site's or the arena's board): side A is white, side B black. */
export function fromChess(board: Board, id: string, v: ChessView, info: ChessInfo, arena: ArenaParties | null, now: number): MatchState {
  const w = v.players.find((p) => p.color === "w"), b = v.players.find((p) => p.color === "b");
  const weights = chessWeights({ fen: v.fen, ply: v.ply, clocks: v.clocks, initialMs: CONTROLS[v.tc].time, status: v.status, connected: [!!w?.connected, !!b?.connected], sinceSharpMs: info.sharpAt === null ? null : now - info.sharpAt, drawOffered: info.drawOffer === true });
  const parties = chessParties(info, arena, now), stake = stakeOf(info.escrow, v.currency, v.stake ?? "0");
  return {
    board, id, names: [w?.name ?? "White", b?.name ?? "Black"], stake: { currency: v.currency, amount: v.stake ?? "0" }, weights, tied: parties.tied, eligible: parties.eligible ?? stake.small, staked: stake.staked,
    result: !v.done ? null : v.winner === "w" ? 0 : v.winner === "b" ? 1 : 2, reason: v.reason ?? null,
  };
}
/** What pinball.ts betState() gives. */
export type PinballState = {
  startedAt: number | null; go: boolean; durationMs: number; done: boolean; draw: boolean; void: string | null; winner: number; currency: string; stake: number; escrow: string | null;
  players: { name: string; agent: boolean; wallet: string | null; score: number; over: boolean; connected: boolean; broken: boolean }[];
};
/** A Space Pinball duel: side A is player 1, side B player 2. Only a staked duel gets a market; its players may not bet on it. */
export function fromPinball(id: string, s: PinballState, now: number): MatchState {
  const [a, b] = s.players as [PinballState["players"][number], PinballState["players"][number]];
  const weights = pinballWeights({ startedAt: s.startedAt, now, durationMs: s.durationMs, scores: [a.score, b.score], over: [a.over, b.over], connected: [a.connected, b.connected], broken: [a.broken, b.broken], done: s.done || !!s.void });
  const result: Outcome | null = s.void ? 2 : !s.done ? null : s.draw || s.winner < 0 ? 2 : s.winner === 0 ? 0 : 1;
  const tied = [a.wallet, b.wallet].filter((x): x is string => !!x).map(lc);
  const stake = stakeOf(s.escrow, s.currency, Number.isFinite(s.stake) ? s.stake.toFixed(18).replace(/\.?0+$/, "") : "0");
  return { board: "pinball", id, names: [a.name, b.name], stake: { currency: s.currency, amount: String(s.stake) }, weights, eligible: s.escrow ? stake.small : NOT_ELIGIBLE, staked: stake.staked, tied, result, reason: s.void ?? (s.done ? (s.draw ? "draw" : "verified by replay") : null) };
}

export type FeedBet = { key: string; bettor: string; side: 0 | 1; amount: string; weightBps: number; shares: string; tx: string; at: number };
export type Market = {
  marketId: Hex; board: Board; id: string; token: Token; closesAt: number; createdAt: number; names: [string, string];
  /** The server's Market signature, for whoever submits createMarket. */
  signature: Hex;
  onChain?: { tx: string };
  /** The keeper's createMarket, sent once at most. */
  create?: { state: "sending" | "sent" | "mined" | "failed"; tx?: string; error?: string; at: number };
  totals: { a: string; b: string; sharesA: string; sharesB: string; bets: number };
  feed: FeedBet[];
  /** What the game decided; recorded once, before anything is signed. */
  outcome?: { outcome: Outcome; reason: string; at: number };
  result?: { outcome: Outcome; deadline: string; signature: Hex; at: number };
  relay?: { state: "sending" | "sent" | "mined" | "failed"; tx?: string; error?: string; at: number };
  closed?: { kind: "settled" | "expired"; tx: string; outcome?: number; fee?: string };
};
export type BetEvent = { kind: "big"; market: Market; bet: FeedBet } | { kind: "settled"; market: Market };
/** The reads the follower needs (the mainnet client, or a fake in tests). */
export type BetsReader = {
  getBlockNumber(): Promise<bigint>;
  getLogs(a: { address: Address; fromBlock: bigint; toBlock: bigint }): Promise<RawLog[]>;
  readContract(a: { address: Address; abi: typeof BETS_ABI | typeof erc20Abi; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
};
export type SettleCall = { marketId: Hex; outcome: number; deadline: bigint; signature: Hex };
export type CreateCall = MarketMsg & { signature: Hex };
export type BetChain = { at: number; signer: string; paused: boolean; live: boolean; limits: Record<Token, { min: bigint; max: bigint }> };

const lc = (a: unknown) => String(a ?? "").toLowerCase();
const AMOUNT = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
const MATCH = /^[a-f0-9]{1,40}$/;
const MARKET_ID = /^0x[0-9a-f]{64}$/;
const sum = (a: string, b: bigint) => (BigInt(a) + b).toString();

export class Bets {
  readonly markets = new Map<string, Market>();
  readonly address: Address | "";
  readonly serverSigner: string;
  cursor: bigint;
  #chain: BetChain | null = null;
  #syncing: Promise<void> | null = null;
  #lastSync = 0;
  #events: ((e: BetEvent) => void)[] = [];
  #tickets = new Map<string, number[]>();
  /** Tickets given and not yet expired, per market and wallet: they count toward the wallet's cap. */
  #pending = new Map<string, { amount: bigint; expiry: number }[]>();
  /** The same, per market (all wallets): they count toward a staked duel's pool cap. */
  #open = new Map<string, { amount: bigint; expiry: number }[]>();
  #making = new Map<string, Promise<Market>>();
  #signing = new Set<string>();
  #creates: number[] = [];
  #you = new Map<string, { at: number; v: unknown }>();
  #swing = new SwingGuard();
  /** Each open market's subscription to its game's changes. */
  #unwatch = new Map<string, () => void>();
  readonly #now: () => number;

  constructor(private o: {
    /** The BetPool contract; empty = betting is off. */
    address: string; file: string | null; client: BetsReader; signer: LocalAccount; lookup: Lookup;
    /** Tells of every change to a match (a move, a resignation, the end), so its market is decided the moment the game ends. */
    watch?: (board: Board, id: string, onChange: () => void) => (() => void) | null;
    /** The contract's deploy block: where the follower starts. */
    fromBlock?: bigint;
    /** Sends settle() / createMarket() from a wallet with gas; resolves with the hash once broadcast. */
    relaySettle?: (r: SettleCall) => Promise<Hex>;
    relayCreate?: (r: CreateCall) => Promise<Hex>;
    receipt?: (tx: Hex) => Promise<"success" | "reverted">;
    now?: () => number; confirmations?: bigint; chunk?: bigint;
  }) {
    this.address = /^0x[0-9a-fA-F]{40}$/.test(o.address) ? (lc(o.address) as Address) : "";
    this.serverSigner = lc(o.signer.address);
    this.#now = o.now ?? (() => Date.now());
    this.cursor = (o.fromBlock ?? 0n) - 1n;
    try {
      if (o.file && existsSync(o.file)) {
        const d = JSON.parse(readFileSync(o.file, "utf8")) as { pool?: string; cursor?: string; markets?: Market[] };
        // a file kept for another BetPool (a new deploy) starts over
        if (d.pool === this.address) {
          if (d.cursor && /^-?\d+$/.test(d.cursor) && BigInt(d.cursor) > this.cursor) this.cursor = BigInt(d.cursor);
          for (const m of d.markets ?? []) this.markets.set(m.marketId, m);
        }
      }
    } catch (e) { console.error("bets state", e); }
  }

  #save(): void {
    const now = this.#now();
    for (const [k, m] of this.markets) {
      // long closed, or decided with nothing on chain: nothing more can happen to it
      if ((m.closed && now - m.createdAt > 7 * 86_400_000) || (!m.onChain && m.outcome && now - m.outcome.at > 86_400_000) || now / 1000 > m.closesAt + 30 * 86_400) this.markets.delete(k);
    }
    if (!this.o.file) return;
    writeAtomic(this.o.file, JSON.stringify({ pool: this.address, cursor: this.cursor.toString(), markets: [...this.markets.values()] }));
  }

  /** Big bets and settled markets: for the community cards. */
  onEvent(f: (e: BetEvent) => void): void { this.#events.push(f); }
  #tell(e: BetEvent) { for (const f of this.#events) try { f(e); } catch (err) { console.error("bets event", err); } }

  #read(functionName: string, args?: readonly unknown[]) {
    return this.o.client.readContract({ address: this.address as Address, abi: BETS_ABI, functionName, ...(args ? { args } : {}) });
  }
  /** The signer, the pause and the limits as the contract has them now (cached a minute). */
  async chainState(force = false): Promise<BetChain> {
    if (!this.address) throw new GameError(409, "Live betting opens soon.");
    if (!force && this.#chain && this.#now() - this.#chain.at < 60_000) return this.#chain;
    const [signer, paused, imd, shift] = await Promise.all([this.#read("signer"), this.#read("paused").catch(() => false), this.#read("limits", [TOKENS.IMD]), this.#read("limits", [TOKENS.SHIFT])]);
    const lim = (v: unknown) => { const [min, max] = v as readonly [bigint, bigint]; return { min, max }; };
    const s = lc(signer);
    this.#chain = { at: this.#now(), signer: s, paused: paused === true, live: s === this.serverSigner && paused !== true, limits: { IMD: lim(imd), SHIFT: lim(shift) } };
    return this.#chain;
  }

  /** Whether betting is live: the contract is configured, trusts this server's signer and is not paused. */
  async status() {
    const base = { configured: !!this.address, betPool: this.address || null, serverSigner: this.serverSigner, tokens: TOKENS, ticketTtl: TICKET_TTL, weights: { min: MIN_WEIGHT, max: MAX_WEIGHT, trailerMax: TRAILER_MAX_WEIGHT }, fee: "5% of the losing side" };
    if (!this.address) return { ...base, live: false, signer: null, paused: null, limits: null };
    const chain = await this.chainState().catch(() => null);
    const lim = (t: Token) => chain ? { min: formatUnits(chain.limits[t].min, 18), max: formatUnits(chain.limits[t].max, 18) } : null;
    return { ...base, live: chain?.live ?? false, signer: chain?.signer ?? null, paused: chain?.paused ?? null, limits: chain ? { IMD: lim("IMD"), SHIFT: lim("SHIFT") } : null, cursor: this.cursor.toString() };
  }

  #lookup(game: string, id: string): MatchState | null {
    if (!Object.hasOwn(BOARDS, game) || !MATCH.test(id)) return null;
    let s: MatchState | null;
    try { s = this.o.lookup(game as Board, id); } catch { return null; }
    if (!s || s.result !== null) return s;
    // every look feeds the swing guard: a big swing since the last look locks betting for a few seconds
    const weights = this.#swing.check(`${s.board}:${s.id}`, s.weights, this.#now());
    return weights === s.weights ? s : { ...s, weights };
  }

  /** Follows a market's game, so it is decided the moment the game ends (not on the next tick). */
  #follow(m: Market): void {
    if (!this.o.watch || m.outcome || m.closed || this.#unwatch.has(m.marketId)) return;
    try {
      const off = this.o.watch(m.board, m.id, () => void this.ended(m.board, m.id).catch((e) => console.error("bets ended", (e as Error).message)));
      if (off) this.#unwatch.set(m.marketId, off);
    } catch { /* the game is gone: the tick voids it */ }
  }
  /**
   * A match's game has ended (or may have): its markets are decided now, signed and relayed at once.
   * Called by the game's change stream, by the lobby when a staked game has its verdict, and on any
   * look at a game that is over.
   */
  async ended(board: Board, id: string): Promise<void> {
    const s = this.#lookup(board, id);
    if (!s || s.result === null) return;
    for (const t of Object.keys(TOKENS) as Token[]) {
      const m = this.markets.get(marketIdOf(s.board, s.id, t));
      if (m && !m.outcome && !m.closed) await this.decide(m.marketId, s.result, s.reason ?? "");
    }
  }

  /** The market for this match and token, made (and its Market signed) the first time it is asked for. */
  #market(s: MatchState, token: Token): Promise<Market> {
    const marketId = marketIdOf(s.board, s.id, token);
    const hit = this.markets.get(marketId);
    if (hit) return Promise.resolve(hit);
    let p = this.#making.get(marketId);
    if (!p) {
      p = (async () => {
        const closesAt = Math.floor(this.#now() / 1000) + MARKET_WINDOW;
        const signature = await signMarket(this.o.signer, this.address as Address, { marketId, token: TOKENS[token], closesAt: BigInt(closesAt), game: BOARDS[s.board] });
        const m: Market = { marketId, board: s.board, id: s.id, token, closesAt, createdAt: this.#now(), names: s.names, signature, totals: { a: "0", b: "0", sharesA: "0", sharesB: "0", bets: 0 }, feed: [] };
        this.markets.set(marketId, m);
        this.#save();
        this.#follow(m);
        return m;
      })().finally(() => this.#making.delete(marketId));
      this.#making.set(marketId, p);
    }
    return p;
  }
  /** What a bettor's page needs to create the market itself, if the keeper has not. */
  #payload(m: Market) {
    return { marketId: m.marketId, token: TOKENS[m.token], symbol: m.token, closesAt: m.closesAt, game: BOARDS[m.board], created: !!m.onChain, signature: m.onChain ? null : m.signature, keeper: m.create ? { state: m.create.state, tx: m.create.tx ?? null } : null };
  }

  /**
   * A ticket for one bet by a signed-in wallet: the side's weight now, signed for exactly this
   * wallet, side and amount, good for TICKET_TTL seconds. Refused while betting is off or locked,
   * outside the limits, for a game that is over, and past TICKETS_PER_MINUTE.
   */
  async ticket(wallet: string | null, input: Record<string, unknown>) {
    if (!this.address) throw new GameError(409, "Live betting opens soon.");
    if (!wallet || !/^0x[0-9a-f]{40}$/.test(lc(wallet))) throw new GameError(401, "Sign in with your wallet to bet.");
    const game = String(input.game ?? ""), id = String(input.matchId ?? input.id ?? ""), token = String(input.token ?? ""), amount = String(input.amount ?? "").trim();
    const side = input.side === "A" || input.side === 0 ? 0 : input.side === "B" || input.side === 1 ? 1 : -1;
    if (!Object.hasOwn(BOARDS, game)) throw new GameError(400, "Unknown game.");
    if (!MATCH.test(id)) throw new GameError(400, "Unknown match.");
    if (side < 0) throw new GameError(400, "Bet on side A or side B.");
    if (!Object.hasOwn(TOKENS, token)) throw new GameError(400, "Bets are in IMD or SHIFT.");
    if (!AMOUNT.test(amount)) throw new GameError(400, "Type the amount as a number, e.g. 5.");
    const value = parseUnits(amount, 18), me = lc(wallet), now = this.#now();
    const recent = (this.#tickets.get(me) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= TICKETS_PER_MINUTE) throw new GameError(429, "Too many tickets. Wait a few seconds.");
    const chain = await this.chainState().catch((e) => { if (e instanceof GameError) throw e; return null; });
    if (!chain) throw new GameError(503, "The betting pool cannot be read right now. Try again shortly.");
    if (!chain.live) throw new GameError(409, chain.paused ? "Betting is paused." : "Live betting opens once the result signer is activated.");
    const s = this.#lookup(game, id);
    if (!s) throw new GameError(404, "This game is not live.");
    if (s.eligible) throw new GameError(409, s.eligible);
    if (s.tied.includes(me)) throw new GameError(403, "Your wallet is tied to this match (a player, or an agent's owner): you cannot bet on it.");
    if (s.result !== null) { void this.ended(s.board, s.id).catch(() => {}); throw new GameError(409, "This game is over: betting is closed."); }
    if (s.weights.locked) throw new GameError(409, `Betting is locked: ${s.weights.locked}`);
    if (s.staked && s.staked.token !== token) throw new GameError(409, `Bets on this duel are in ${s.staked.token}, the token of its stake.`);
    const { min, max } = chain.limits[token as Token];
    if (value < min || value > max) throw new GameError(400, `A bet must be between ${formatUnits(min, 18)} and ${formatUnits(max, 18)} ${token}.`);
    if (this.#tickets.size > 20_000) this.#tickets.clear();
    this.#tickets.set(me, [...recent, now]);
    const m = await this.#market(s, token as Token);
    const sec = Math.floor(now / 1000);
    if (m.outcome || m.closed) throw new GameError(409, "This game is over: betting is closed.");
    if (sec + TICKET_TTL + 60 > m.closesAt) throw new GameError(409, "This market is closing.");
    // what is already in, from the contract: this wallet's bets, and the whole pool of a staked duel
    let placed = 0n, pooled = BigInt(m.totals.a) + BigInt(m.totals.b);
    if (m.onChain) {
      const [b, pool] = await Promise.all([
        this.#read("betsOf", [m.marketId, me]).catch(() => null) as Promise<readonly [bigint, bigint, bigint, bigint, boolean] | null>,
        s.staked ? (this.#read("markets", [m.marketId]).catch(() => null) as Promise<readonly unknown[] | null>) : Promise.resolve([]),
      ]);
      if (!b || !pool) throw new GameError(503, "The betting pool cannot be read right now. Try again shortly.");
      placed = b[0] + b[1];
      if (s.staked) { const live = (pool[3] as bigint) + (pool[4] as bigint); if (live > pooled) pooled = live; }
    }
    // the game again, after the reads: it may have ended or locked meanwhile, and the weight is the one of now
    const fresh = this.#lookup(game, id);
    if (!fresh || fresh.result !== null) { void this.ended(s.board, s.id).catch(() => {}); throw new GameError(409, "This game is over: betting is closed."); }
    if (fresh.weights.locked) throw new GameError(409, `Betting is locked: ${fresh.weights.locked}`);
    // from here to the signature nothing waits, so two requests at once cannot both pass the caps
    // one wallet's total on this market, mined and still to come, stays within one maximum bet
    const key = `${m.marketId}:${me}`;
    const pending = (this.#pending.get(key) ?? []).filter((t) => t.expiry >= sec);
    const held = placed + pending.reduce((n, t) => n + t.amount, 0n);
    if (held + value > max) throw new GameError(400, `One wallet bets at most ${formatUnits(max, 18)} ${token} in all on a game; you have ${formatUnits(held, 18)} in or on open tickets.`);
    // a staked duel's whole pool, mined and on open tickets, stays within POOL_PER_STAKE × its stake
    const open = (this.#open.get(m.marketId) ?? []).filter((t) => t.expiry >= sec);
    if (s.staked) {
      const cap = s.staked.amount * POOL_PER_STAKE, inPool = pooled + open.reduce((n, t) => n + t.amount, 0n);
      if (inPool + value > cap) throw new GameError(409, `This duel's pool is full: at most ${formatUnits(cap, 18)} ${token} in all (${POOL_PER_STAKE}× its stake), ${formatUnits(inPool, 18)} in or on open tickets.`);
    }
    if (this.#pending.size > 20_000) for (const [k, l] of this.#pending) if (l.every((t) => t.expiry < sec)) this.#pending.delete(k);
    if (this.#open.size > 5_000) for (const [k, l] of this.#open) if (l.every((t) => t.expiry < sec)) this.#open.delete(k);
    this.#pending.set(key, [...pending, { amount: value, expiry: sec + TICKET_TTL }]);
    this.#open.set(m.marketId, [...open, { amount: value, expiry: sec + TICKET_TTL }]);
    const weightBps = side === 0 ? fresh.weights.a : fresh.weights.b, expiry = sec + TICKET_TTL;
    const nonce = `0x${randomBytes(32).toString("hex")}` as Hex, bettor = getAddress(me);
    const signature = await signTicket(this.o.signer, this.address, { marketId: m.marketId, bettor, side, amount: value, weightBps, expiry: BigInt(expiry), nonce });
    void this.#createOnChain(m, me, value);
    return {
      betPool: this.address, ticket: { marketId: m.marketId, bettor, side, amount: value.toString(), weightBps, expiry, nonce }, signature,
      weightBps, multiplier: weightBps / 10_000, expiresIn: TICKET_TTL, market: this.#payload(m),
    };
  }

  /**
   * The keeper submits createMarket once, so the bettor normally finds the market open. Only for a
   * wallet holding the amount it asked to bet, and at most KEEPER_CREATES_PER_HOUR an hour: tickets
   * nobody uses cannot drain the keeper's gas. Otherwise the bettor's page submits it.
   */
  async #createOnChain(m: Market, wallet: string, amount: bigint): Promise<void> {
    if (m.onChain || m.create || m.outcome || !this.o.relayCreate) return;
    const now = this.#now();
    this.#creates = this.#creates.filter((t) => now - t < 3_600_000);
    if (this.#creates.length >= KEEPER_CREATES_PER_HOUR) return;
    const bal = await this.o.client.readContract({ address: TOKENS[m.token], abi: erc20Abi, functionName: "balanceOf", args: [wallet] }).catch(() => 0n) as bigint;
    if (bal < amount || m.onChain || m.create) return;
    this.#creates.push(now);
    m.create = { state: "sending", at: now };
    this.#save();
    try {
      const tx = await this.o.relayCreate({ marketId: m.marketId, token: TOKENS[m.token], closesAt: BigInt(m.closesAt), game: BOARDS[m.board], signature: m.signature });
      m.create = { state: "sent", tx, at: this.#now() };
      this.#save();
      const r = await this.o.receipt?.(tx).catch(() => null);
      if (r && m.create.state === "sent") { m.create.state = r === "success" ? "mined" : "failed"; this.#save(); }
    } catch (e) {
      m.create = { state: "failed", error: (e as Error).message.split("\n")[0]!.slice(0, 160), at: this.#now() };
      this.#save();
    }
  }

  /** One market's public view. Never a ticket. */
  #marketView(m: Market | undefined) {
    if (!m) return null;
    return {
      ...this.#payload(m), totals: m.totals, outcome: m.outcome?.outcome ?? null, closed: m.closed ?? null,
      settlement: m.result && !m.closed ? { outcome: m.result.outcome, deadline: m.result.deadline, signature: m.result.signature } : null,
      relay: m.relay ? { state: m.relay.state, tx: m.relay.tx ?? null } : null,
    };
  }
  /** A wallet's bets and what it may claim, from the contract (cached a few seconds). */
  async #yours(m: Market, wallet: string) {
    const key = `${m.marketId}:${wallet}`, hit = this.#you.get(key);
    if (hit && this.#now() - hit.at < 5_000) return hit.v;
    const [b, c] = await Promise.all([this.#read("betsOf", [m.marketId, wallet]), this.#read("claimable", [m.marketId, wallet])]);
    const [amountA, amountB, sharesA, sharesB, claimed] = b as readonly [bigint, bigint, bigint, bigint, boolean];
    const v = { amountA: amountA.toString(), amountB: amountB.toString(), sharesA: sharesA.toString(), sharesB: sharesB.toString(), claimed, claimable: (c as bigint).toString() };
    if (this.#you.size > 5_000) this.#you.clear();
    this.#you.set(key, { at: this.#now(), v });
    return v;
  }

  /** GET /api/bets/market: the pools, the weights now, the lock, the latest bets, and the wallet's own. */
  async view(game: string, id: string, wallet: string | null) {
    if (!Object.hasOwn(BOARDS, game) || !MATCH.test(id)) throw new GameError(400, "Unknown game.");
    const s = this.#lookup(game, id);
    const board = s?.board ?? (game as Board), mid = s?.id ?? id;
    const byToken = { IMD: this.markets.get(marketIdOf(board, mid, "IMD")), SHIFT: this.markets.get(marketIdOf(board, mid, "SHIFT")) };
    const any = byToken.IMD ?? byToken.SHIFT;
    if (!s && !any) throw new GameError(404, "This game is not live.");
    if (s && s.result !== null && any && !any.outcome) void this.ended(s.board, s.id).catch(() => {});
    const chain = this.address ? await this.chainState().catch(() => null) : null;
    const decided = any?.outcome?.outcome ?? s?.result ?? null;
    const me = wallet && /^0x[0-9a-f]{40}$/.test(lc(wallet)) ? lc(wallet) : null;
    const you = me ? Object.fromEntries(await Promise.all((["IMD", "SHIFT"] as const).map(async (t) => {
      const m = byToken[t];
      return [t, m?.onChain ? await this.#yours(m, me).catch(() => null) : null] as const;
    }))) : null;
    const feed = [byToken.IMD, byToken.SHIFT].flatMap((m) => (m ? m.feed.map((f) => ({ ...f, token: m.token })) : [])).sort((a, b) => b.at - a.at).slice(0, 20);
    return {
      configured: !!this.address, live: !!chain?.live, betPool: this.address || null, game: board, id: mid,
      names: s?.names ?? any!.names, stake: s?.stake ?? null,
      eligible: !s || !s.eligible,
      weights: s && s.result === null && !s.eligible ? { A: s.weights.a, B: s.weights.b, progress: s.weights.progress, leader: s.weights.leader } : null,
      locked: !s ? "This game is not live." : s.eligible ?? (s.result !== null ? "The game is over." : s.weights.locked),
      outcome: decided, limits: chain ? { IMD: { min: formatUnits(chain.limits.IMD.min, 18), max: formatUnits(chain.limits.IMD.max, 18) }, SHIFT: { min: formatUnits(chain.limits.SHIFT.min, 18), max: formatUnits(chain.limits.SHIFT.max, 18) } } : null,
      markets: { IMD: this.#marketView(byToken.IMD), SHIFT: this.#marketView(byToken.SHIFT) }, feed, you, ticketTtl: TICKET_TTL, now: this.#now(),
    };
  }

  /** The signed outcome of a market, for anyone to submit; past its deadline the same outcome is signed again. */
  async settlement(marketId: string) {
    const m = this.markets.get(lc(marketId));
    if (!MARKET_ID.test(lc(marketId)) || !m) throw new GameError(404, "No such market.");
    if (m.closed) throw new GameError(409, `This market is already ${m.closed.kind}.`);
    if (!m.result) throw new GameError(409, "No result yet.");
    const sec = Math.floor(this.#now() / 1000);
    if (BigInt(sec + 300) > BigInt(m.result.deadline)) {
      const deadline = BigInt(sec + OUTCOME_TTL);
      const signature = await signOutcome(this.o.signer, this.address as Address, { marketId: m.marketId, outcome: m.result.outcome, deadline });
      m.result = { ...m.result, deadline: deadline.toString(), signature, at: this.#now() };
      this.#save();
    }
    return { betPool: this.address, marketId: m.marketId, outcome: m.result.outcome, deadline: m.result.deadline, signature: m.result.signature };
  }

  /**
   * Every open market against its game: once the game has a verified result (or is gone without
   * one, which is void), the outcome is recorded, signed and relayed. Runs every 2 s: the backstop
   * for ended(), which decides a market the moment its game ends.
   */
  async tick(): Promise<void> {
    for (const m of this.markets.values()) {
      if (m.outcome || m.closed) continue;
      const s = this.#lookup(m.board, m.id);
      const outcome = s ? s.result : 2;
      if (outcome === null) continue;
      await this.decide(m.marketId, outcome, s ? s.reason ?? "" : "the game closed without a result");
    }
  }
  /** Records a market's outcome once (a second, different one is ignored), signs it and relays it. */
  async decide(marketId: string, outcome: Outcome, reason: string): Promise<void> {
    const m = this.markets.get(marketId);
    if (!m || m.closed || m.outcome || ![0, 1, 2].includes(outcome)) return;
    m.outcome = { outcome, reason: reason.slice(0, 80), at: this.#now() };
    this.#save();
    this.#unwatch.get(m.marketId)?.();
    this.#unwatch.delete(m.marketId);
    await this.#sign(m).catch((e) => console.error("bets sign", (e as Error).message));
  }
  async #sign(m: Market): Promise<void> {
    if (!m.outcome || m.result || m.closed || this.#signing.has(m.marketId)) return;
    this.#signing.add(m.marketId);
    try {
      const deadline = BigInt(Math.floor(this.#now() / 1000) + OUTCOME_TTL);
      const signature = await signOutcome(this.o.signer, this.address as Address, { marketId: m.marketId, outcome: m.outcome.outcome, deadline });
      m.result = { outcome: m.outcome.outcome, deadline: deadline.toString(), signature, at: this.#now() };
      this.#save();
    } finally { this.#signing.delete(m.marketId); }
    await this.#relay(m);
  }
  /** One automatic settle() per market, ever, once it exists on chain. If it fails, the signature stays for anyone to submit. */
  async #relay(m: Market): Promise<void> {
    if (!m.result || m.relay || m.closed || !m.onChain || !this.o.relaySettle) return;
    m.relay = { state: "sending", at: this.#now() };
    this.#save();
    try {
      const fresh = await this.settlement(m.marketId);
      const tx = await this.o.relaySettle({ marketId: m.marketId, outcome: fresh.outcome, deadline: BigInt(fresh.deadline), signature: fresh.signature });
      m.relay = { state: "sent", tx, at: this.#now() };
      this.#save();
      const r = await this.o.receipt?.(tx).catch(() => null);
      if (r && m.relay.state === "sent") { m.relay.state = r === "success" ? "mined" : "failed"; if (r !== "success") m.relay.error = "reverted"; this.#save(); }
    } catch (e) {
      m.relay = { state: "failed", error: (e as Error).message.split("\n")[0]!.slice(0, 160), at: this.#now() };
      this.#save();
    }
  }

  /** Follows the contract's events from the last block read; one run at a time. */
  sync(): Promise<void> {
    if (!this.address) return Promise.resolve();
    this.#syncing ??= this.#sync().finally(() => { this.#syncing = null; this.#lastSync = this.#now(); });
    return this.#syncing;
  }
  /** A sync if the last is a few seconds old (page polls), without waiting for it. */
  poke(): void { if (this.address && this.#now() - this.#lastSync > 4_000) void this.sync().catch((e) => console.error("bets sync", (e as Error).message)); }

  async #sync(): Promise<void> {
    const head = (await this.o.client.getBlockNumber()) - (this.o.confirmations ?? 1n);
    // no deploy block configured: from now on
    if (this.cursor < 0n) { this.cursor = head - 1n; this.#save(); }
    let chunk = this.o.chunk ?? 2_000n;
    while (this.cursor < head) {
      const from = this.cursor + 1n, to = from + chunk - 1n < head ? from + chunk - 1n : head;
      let logs: RawLog[];
      try { logs = await this.o.client.getLogs({ address: this.address as Address, fromBlock: from, toBlock: to }); } catch (e) {
        if (chunk > 50n) { chunk /= 4n; continue; }
        throw e;
      }
      logs = [...logs].sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)) || (a.logIndex ?? 0) - (b.logIndex ?? 0));
      // a read that fails part-way leaves the cursor before this range: every handler can run again safely
      for (const l of logs) this.#apply(l);
      this.cursor = to;
      this.#save();
    }
    // after a restart: decided markets get signed, signed ones on chain get relayed
    for (const m of this.markets.values()) if (m.outcome && !m.closed) { if (!m.result) await this.#sign(m).catch(() => {}); else if (!m.relay) await this.#relay(m); }
  }

  #apply(l: RawLog): void {
    const d = decodeBetLog(l);
    if (!d) return;
    const m = this.markets.get(lc(d.args.marketId)), tx = l.transactionHash ?? "";
    if (!m) return; // not a market this server signed: ignored
    if (d.eventName === "MarketCreated") {
      // only with exactly the token, game and close this server signed (the contract checks the signature too)
      if (m.onChain || lc(d.args.token) !== TOKENS[m.token] || lc(d.args.game) !== BOARDS[m.board] || BigInt(d.args.closesAt as bigint) !== BigInt(m.closesAt)) return;
      m.onChain = { tx };
      if (m.create && m.create.tx && lc(m.create.tx) === lc(tx)) m.create.state = "mined";
      if (m.result && !m.relay) void this.#relay(m);
    } else if (d.eventName === "BetPlaced") {
      const key = `${tx}:${l.logIndex ?? 0}`;
      if (m.feed.some((f) => f.key === key)) return;
      const side = Number(d.args.side) === 1 ? 1 : 0, amount = BigInt(d.args.amount as bigint), shares = BigInt(d.args.shares as bigint);
      const bet: FeedBet = { key, bettor: lc(d.args.bettor), side, amount: amount.toString(), weightBps: Number(d.args.weightBps), shares: shares.toString(), tx, at: this.#now() };
      m.feed = [bet, ...m.feed].slice(0, 200);
      m.totals = side === 0 ? { ...m.totals, a: sum(m.totals.a, amount), sharesA: sum(m.totals.sharesA, shares), bets: m.totals.bets + 1 } : { ...m.totals, b: sum(m.totals.b, amount), sharesB: sum(m.totals.sharesB, shares), bets: m.totals.bets + 1 };
      for (const k of this.#you.keys()) if (k.startsWith(m.marketId)) this.#you.delete(k);
      if (amount >= BIG_BET[m.token]) this.#tell({ kind: "big", market: m, bet });
    } else if (d.eventName === "Settled") {
      if (m.closed) return;
      m.closed = { kind: "settled", tx, outcome: Number(d.args.outcome), fee: String(d.args.fee ?? "0") };
      if (m.relay && m.relay.tx && lc(m.relay.tx) === lc(tx)) m.relay.state = "mined";
      for (const k of this.#you.keys()) if (k.startsWith(m.marketId)) this.#you.delete(k);
      this.#tell({ kind: "settled", market: m });
    } else if (d.eventName === "Expired") {
      if (!m.closed) m.closed = { kind: "expired", tx };
    }
  }

  /** Polls the chain every 10 s and the games every 2 s. Nothing runs while betting is off. */
  start(): void {
    if (!this.address) return;
    const run = () => void this.sync().catch((e) => console.error("bets sync", (e as Error).message));
    run();
    setInterval(run, 10_000).unref();
    setInterval(() => void this.tick().catch((e) => console.error("bets tick", (e as Error).message)), 2_000).unref();
  }
}

/** What winners get back from a two-sided market: their stakes plus 95% of the losing side (the fee rounds down). */
export function payoutOf(m: Pick<Market, "totals">, outcome: number): { pool: bigint; fee: bigint; winners: bigint; refundable: boolean } {
  const a = BigInt(m.totals.a), b = BigInt(m.totals.b), pool = a + b;
  if (outcome === 2 || a === 0n || b === 0n) return { pool, fee: 0n, winners: pool, refundable: true };
  const losing = outcome === 0 ? b : a, fee = (losing * 500n) / 10_000n;
  return { pool, fee, winners: pool - fee, refundable: false };
}
