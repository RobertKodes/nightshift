import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Address, type Hex, type LocalAccount, formatUnits, getAddress, parseAbi, parseUnits, stringToHex } from "viem";
import { writeAtomic } from "./atomic.js";
import { eth } from "./chain.js";
import { CONTROLS } from "./chess.js";
import { config } from "./config.js";
import { keeperAccount, keeperWrite } from "./keeper.js";
import { publicName } from "./names.js";
import type { Vault } from "./vault.js";

/**
 * Real-money duels: GameEscrow v2 on Ethereum holds both players' equal stakes in IMD or $SHIFT.
 * Player A opens a match (its id is a random nonce from here), player B joins it, and the server,
 * which ran the game, signs the result (EIP-712). Anyone may submit it: the keeper relays it, or the
 * winner does from the page. The contract pays 95% to the winner and 5% to the fee splitter; a draw
 * refunds both. Nothing here can move a stake: the most a server signature can do is name one of
 * the two players who deposited as the winner of a match they both joined.
 */
export const ESCROW: Address = "0xf460fd9ad76f18414f54a2431870e8a116193489";
export const DEPLOY_BLOCK = 26_222_893n;
export const TOKENS = { IMD: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7", SHIFT: "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac" } as const satisfies Record<string, Address>;
export type Token = keyof typeof TOKENS;
/** The game label in each match: UTF-8, right-padded to bytes32. */
export const GAMES = { pinball: stringToHex("pinball", { size: 32 }), chess: stringToHex("chess", { size: 32 }) } as const;
export type Game = keyof typeof GAMES;
export const JOIN_TIMEOUT = 3_600;
export const SETTLE_TIMEOUT = 86_400;
/** A challenge the creator has not opened on chain within this long is forgotten. */
export const PENDING_MS = 15 * 60_000;
/** A signed result is good for this long, and never past the settlement cutoff. */
const RESULT_TTL = 12 * 3_600;

export const ESCROW_ABI = parseAbi([
  "function open(bytes32 matchId, address token, uint256 stake, bytes32 game)",
  "function join(bytes32 matchId)",
  "function settle(bytes32 matchId, address winner, bool draw, uint256 deadline, bytes signature)",
  "function refund(bytes32 matchId)",
  "function cancel(bytes32 matchId)",
  "function setSigner(address newSigner)",
  "function signer() view returns (address)",
  "function paused() view returns (bool)",
  "function limits(address token) view returns (uint256 min, uint256 max)",
  "function matches(bytes32 matchId) view returns (address token, uint256 stake, bytes32 game, address playerA, address playerB, uint256 openedAt, uint256 joinedAt, bool settled)",
  "function hashResult(bytes32 matchId, address winner, bool draw, uint256 deadline) view returns (bytes32)",
  "event Opened(bytes32 indexed matchId, address indexed token, uint256 stake, bytes32 game, address indexed playerA)",
  "event Joined(bytes32 indexed matchId, address indexed playerB)",
  "event Settled(bytes32 indexed matchId, address indexed winner, bool draw, uint256 payout, uint256 fee)",
  "event Refunded(bytes32 indexed matchId)",
  "event Cancelled(bytes32 indexed matchId)",
]);
const EVENTS = ESCROW_ABI.filter((x) => x.type === "event");

export const DOMAIN = { name: "NightshiftGames", version: "2", chainId: 1, verifyingContract: ESCROW } as const;
export const RESULT_TYPES = { Result: [{ name: "matchId", type: "bytes32" }, { name: "winner", type: "address" }, { name: "draw", type: "bool" }, { name: "deadline", type: "uint256" }] } as const;

/** The server's game result signer: its own key in the vault, never the keeper's or a company's. */
export function gameSignerAccount(vault: Vault) {
  try { return vault.account("game-signer"); } catch { vault.create("game-signer"); return vault.account("game-signer"); }
}

/**
 * Signs one result. The deadline is 12 hours away, and never at or past the contract's cutoff
 * (joinedAt + 24 h); with less than ten minutes of the window left nothing is signed (refund instead).
 */
export async function signResult(account: LocalAccount, matchId: Hex, winner: Address, draw: boolean, joinedAt: number, now = Math.floor(Date.now() / 1000)) {
  const cutoff = joinedAt + SETTLE_TIMEOUT - 1;
  const deadline = BigInt(Math.min(now + RESULT_TTL, cutoff));
  if (deadline < BigInt(now + 600)) throw new Error("the settlement window has closed: the stakes go back by refund");
  const signature = await account.signTypedData({ domain: DOMAIN, types: RESULT_TYPES, primaryType: "Result", message: { matchId, winner, draw, deadline } });
  return { deadline, signature };
}

type Status = "pending" | "open" | "expired" | "joined" | "finished" | "settled" | "refunded" | "cancelled" | "refused";
export type Challenge = {
  matchId: Hex; game: Game; token: Token; stake: string; creator: string; name: string; tc: string | null; createdAt: number;
  /** From the Opened event and the match on chain (seconds). */
  openedAt?: number; openTx?: string;
  playerB?: string; nameB?: string; joinedAt?: number; joinTx?: string;
  /** What the game decided; recorded before anything is signed, and never decided twice. */
  outcome?: { draw: boolean; winner: string | null; at: number; reason?: string };
  /** When its game was dealt (ms). Kept across restarts: a game is dealt once, never again. */
  dealtAt?: number;
  /** The one authoritative result. Kept so the winner can submit it if the relay does not. */
  result?: { winner: string; draw: boolean; deadline: string; signature: Hex; at: number };
  /** Why no result will ever be signed (the chain does not match what the game recorded). */
  refused?: string;
  relay?: { state: "sending" | "sent" | "mined" | "failed"; tx?: string; error?: string; at: number };
  closed?: { kind: "settled" | "refunded" | "cancelled"; tx: string; winner?: string; draw?: boolean; payout?: string };
};
export type DuelEvent = "listed" | "joined" | "settled" | "refunded";
export type OnChainMatch = readonly [Address, bigint, Hex, Address, Address, bigint, bigint, boolean];
export type EscrowLog = { eventName: string; args: Record<string, unknown>; blockNumber: bigint | null; transactionHash: Hex | null; logIndex: number | null };
/** The reads the follower needs (the mainnet client, or a fake in tests). */
export type Reader = {
  getBlockNumber(): Promise<bigint>;
  getLogs(a: { address: Address; events: typeof EVENTS; fromBlock: bigint; toBlock: bigint }): Promise<EscrowLog[]>;
  readContract(a: { address: Address; abi: typeof ESCROW_ABI; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
};
export type RelayCall = { matchId: Hex; winner: Address; draw: boolean; deadline: bigint; signature: Hex };
export type ChainState = { at: number; signer: string; paused: boolean; live: boolean; limits: Record<Token, { min: bigint; max: bigint }> };
export class GameError extends Error { constructor(readonly status: number, message: string) { super(message); } }

const lc = (a: unknown) => String(a ?? "").toLowerCase();
const AMOUNT = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;

export class Escrow {
  readonly challenges = new Map<string, Challenge>();
  cursor = DEPLOY_BLOCK - 1n;
  readonly serverSigner: string;
  #chain: ChainState | null = null;
  #syncing: Promise<void> | null = null;
  #lastSync = 0;
  #joined: ((c: Challenge) => void)[] = [];
  #events: ((kind: DuelEvent, c: Challenge) => void)[] = [];
  /** Names a joiner gave before sending join(): wallet → name, per match (memory only). */
  #intents = new Map<string, Map<string, string>>();
  #signing = new Set<string>();
  /** Matches whose game this process dealt (and so still has). */
  #dealtHere = new Set<string>();
  readonly #now: () => number;

  constructor(private o: {
    file: string | null; client: Reader; signer: LocalAccount;
    /** Sends settle() from a wallet with gas; resolves with the hash once broadcast. */
    relay?: (r: RelayCall) => Promise<Hex>;
    /** Waits for a sent relay's receipt. */
    receipt?: (tx: Hex) => Promise<"success" | "reverted">;
    now?: () => number; confirmations?: bigint; chunk?: bigint;
  }) {
    this.serverSigner = lc(o.signer.address);
    this.#now = o.now ?? (() => Date.now());
    try {
      if (o.file && existsSync(o.file)) {
        const d = JSON.parse(readFileSync(o.file, "utf8")) as { cursor?: string; challenges?: Challenge[] };
        if (d.cursor && /^\d+$/.test(d.cursor)) this.cursor = BigInt(d.cursor);
        for (const c of d.challenges ?? []) this.challenges.set(c.matchId, c);
      }
    } catch (e) { console.error("escrow state", e); }
  }

  #save(): void {
    const now = this.#now();
    for (const [k, c] of this.challenges) {
      // unopened and past its time, or long closed: nothing more can happen to it
      if ((!c.openedAt && now - c.createdAt > 6 * 3_600_000) || (c.closed && now - c.createdAt > 14 * 86_400_000)) this.challenges.delete(k);
    }
    if (!this.o.file) return;
    writeAtomic(this.o.file, JSON.stringify({ cursor: this.cursor.toString(), challenges: [...this.challenges.values()] }));
  }

  /** Called for a joined match that needs its game (when the Joined event lands, and after a restart). */
  onJoined(f: (c: Challenge) => void): void { this.#joined.push(f); }
  /** Called when a challenge goes live (Opened), is accepted (Joined), and when it settles or is refunded: for the community cards. */
  onEvent(f: (kind: DuelEvent, c: Challenge) => void): void { this.#events.push(f); }
  #tell(kind: DuelEvent, c: Challenge) { for (const f of this.#events) try { f(kind, c); } catch (e) { console.error("escrow event", e); } }
  #tellJoined(c: Challenge) { for (const f of this.#joined) try { f(c); } catch (e) { console.error("escrow joined", e); } }

  /** The signer, the pause and the limits as the contract has them now (cached a minute). */
  async chainState(force = false): Promise<ChainState> {
    if (!force && this.#chain && this.#now() - this.#chain.at < 60_000) return this.#chain;
    const read = (functionName: string, args?: readonly unknown[]) => this.o.client.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName, ...(args ? { args } : {}) });
    const [signer, paused, imd, shift] = await Promise.all([read("signer"), read("paused"), read("limits", [TOKENS.IMD]), read("limits", [TOKENS.SHIFT])]);
    const lim = (v: unknown) => { const [min, max] = v as readonly [bigint, bigint]; return { min, max }; };
    const s = lc(signer);
    this.#chain = { at: this.#now(), signer: s, paused: paused === true, live: s === this.serverSigner && paused === false, limits: { IMD: lim(imd), SHIFT: lim(shift) } };
    return this.#chain;
  }
  /** Real-money duels are open when the contract trusts this server's signer and is not paused. */
  async stakesLive(): Promise<boolean> { return (await this.chainState()).live; }

  /** A new challenge for a signed-in wallet: a fresh random match id, the exact stake, the game label. */
  async create(wallet: string | null, input: { game?: unknown; token?: unknown; amount?: unknown; tc?: unknown; name?: unknown }) {
    if (!wallet || !/^0x[0-9a-f]{40}$/.test(lc(wallet))) throw new GameError(401, "Sign in with your wallet to play for a stake.");
    const game = String(input.game ?? ""), token = String(input.token ?? ""), amount = String(input.amount ?? "").trim();
    if (!Object.hasOwn(GAMES, game)) throw new GameError(400, "Unknown game.");
    if (!Object.hasOwn(TOKENS, token)) throw new GameError(400, "Stakes are in IMD or SHIFT.");
    if (!AMOUNT.test(amount)) throw new GameError(400, "Type the stake as a number, e.g. 2.5.");
    let tc: string | null = null;
    if (game === "chess") { tc = String(input.tc ?? "3+2"); if (!Object.hasOwn(CONTROLS, tc)) throw new GameError(400, "Choose 3+2, 5+0 or 10+0."); }
    const stake = parseUnits(amount, 18);
    const chain = await this.chainState().catch(() => null);
    if (!chain) throw new GameError(503, "The escrow cannot be read right now. Try again shortly.");
    if (!chain.live) throw new GameError(409, "Real-money duels open once the result signer is activated.");
    const { min, max } = chain.limits[token as Token];
    if (stake < min || stake > max) throw new GameError(400, `The stake must be between ${formatUnits(min, 18)} and ${formatUnits(max, 18)} ${token}.`);
    const now = this.#now(), me = lc(wallet);
    const pending = [...this.challenges.values()].filter((c) => !c.openedAt && now - c.createdAt < PENDING_MS);
    if (pending.filter((c) => c.creator === me).length >= 5) throw new GameError(429, "You have 5 challenges waiting to be opened. Open or let them lapse first.");
    if (pending.length >= 5_000) throw new GameError(503, "The lobby is full. Try again shortly.");
    const c: Challenge = { matchId: `0x${randomBytes(32).toString("hex")}`, game: game as Game, token: token as Token, stake: stake.toString(), creator: me, name: publicName(input.name, { max: 40 }) ?? "", tc, createdAt: now };
    this.challenges.set(c.matchId, c);
    this.#save();
    return { matchId: c.matchId, game: GAMES[c.game], token: TOKENS[c.token], stake: c.stake, escrow: ESCROW, expiresAt: now + PENDING_MS };
  }

  /** The name a joiner plays under, given before their join() (only for an open challenge, not its creator). */
  intend(matchId: string, wallet: string | null, name: string): Challenge {
    const c = this.challenges.get(matchId);
    if (!wallet) throw new GameError(401, "Sign in with your wallet to accept a challenge.");
    if (!c || this.status(c) !== "open") throw new GameError(404, "That challenge is no longer open.");
    if (c.creator === lc(wallet)) throw new GameError(400, "That is your own challenge.");
    const m = this.#intents.get(matchId) ?? new Map<string, string>();
    if (m.size < 50) m.set(lc(wallet), publicName(name, { max: 40 }) ?? "");
    if (this.#intents.size > 5_000) this.#intents.clear();
    this.#intents.set(matchId, m);
    return c;
  }

  status(c: Challenge): Status {
    if (c.closed) return c.closed.kind;
    if (c.refused) return "refused";
    if (c.playerB) return c.outcome ? "finished" : "joined";
    if (!c.openedAt) return this.#now() - c.createdAt < PENDING_MS ? "pending" : "expired";
    return this.#now() / 1000 < c.openedAt + JOIN_TIMEOUT ? "open" : "expired";
  }
  /** What anyone may see of a challenge; never the signature itself. */
  view(c: Challenge, viewer: string | null = null) {
    const me = lc(viewer);
    return {
      matchId: c.matchId, game: c.game, token: c.token, tokenAddress: TOKENS[c.token], stake: c.stake, amount: formatUnits(BigInt(c.stake), 18), tc: c.tc,
      creator: c.creator, name: c.name || "Night crew", playerB: c.playerB ?? null, nameB: c.playerB ? c.nameB || "Night crew" : null, status: this.status(c),
      openedAt: c.openedAt ?? null, joinBy: c.openedAt ? c.openedAt + JOIN_TIMEOUT : null, joinedAt: c.joinedAt ?? null, refundAt: c.joinedAt ? c.joinedAt + SETTLE_TIMEOUT : c.openedAt ? c.openedAt + JOIN_TIMEOUT : null,
      outcome: c.outcome ? { draw: c.outcome.draw, winner: c.outcome.winner, reason: c.outcome.reason ?? null } : null, signed: !!c.result, refused: c.refused ?? null,
      relay: c.relay ? { state: c.relay.state, tx: c.relay.tx ?? null } : null, closed: c.closed ?? null,
      you: me && me === c.creator ? "A" as const : me && me === c.playerB ? "B" as const : null,
    };
  }
  /** Challenges anyone may accept: opened by their creator with exactly the recorded terms, unjoined, inside the join window. */
  open(game?: string, viewer: string | null = null) {
    const now = this.#now() / 1000;
    return [...this.challenges.values()].filter((c) => this.status(c) === "open" && (!game || c.game === game))
      .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0)).slice(0, 100)
      .map((c) => ({ ...this.view(c, viewer), remaining: Math.max(0, Math.floor((c.openedAt ?? 0) + JOIN_TIMEOUT - now)) }));
  }

  async #match(matchId: Hex): Promise<OnChainMatch> {
    return await this.o.client.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "matches", args: [matchId] }) as OnChainMatch;
  }

  /** Follows the contract's events from the last block read; one run at a time. */
  sync(): Promise<void> {
    this.#syncing ??= this.#sync().finally(() => { this.#syncing = null; this.#lastSync = this.#now(); });
    return this.#syncing;
  }
  /** A sync if the last is a few seconds old (page polls), without waiting for it. */
  poke(): void { if (this.#now() - this.#lastSync > 4_000) void this.sync().catch((e) => console.error("escrow sync", (e as Error).message)); }

  async #sync(): Promise<void> {
    const head = (await this.o.client.getBlockNumber()) - (this.o.confirmations ?? 2n);
    let chunk = this.o.chunk ?? 2_000n;
    while (this.cursor < head) {
      const from = this.cursor + 1n, to = from + chunk - 1n < head ? from + chunk - 1n : head;
      let logs: EscrowLog[];
      try { logs = await this.o.client.getLogs({ address: ESCROW, events: EVENTS, fromBlock: from, toBlock: to }); } catch (e) {
        if (chunk > 50n) { chunk /= 4n; continue; }
        throw e;
      }
      logs.sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)) || (a.logIndex ?? 0) - (b.logIndex ?? 0));
      // a read that fails part-way leaves the cursor before this range: every handler can run again safely
      for (const l of logs) await this.#apply(l);
      this.cursor = to;
      this.#save();
    }
    // after a restart: joined matches never dealt get their game; a game dealt before the restart is
    // gone with it and is never dealt again (a losing player would get a free do-over): it ends as a
    // draw, which refunds both stakes. Decided ones get signed.
    for (const c of this.challenges.values()) {
      if (c.closed || c.refused || !c.playerB || !c.joinedAt) continue;
      if (!c.outcome) {
        if (c.dealtAt && !this.#dealtHere.has(c.matchId)) await this.finish(c.matchId, { draw: true, winner: null }, "the server restarted during the game: both stakes go back");
        else if (!c.dealtAt && this.#now() / 1000 < c.joinedAt + SETTLE_TIMEOUT - 3_600) this.#tellJoined(c);
      } else if (!c.result) await this.#settle(c).catch((e) => console.error("escrow sign", (e as Error).message));
    }
  }

  /** The lobby made this match's game: recorded (and saved) before anyone plays it. */
  dealt(matchId: string): void {
    const c = this.challenges.get(matchId);
    if (!c || c.dealtAt) return;
    c.dealtAt = this.#now();
    this.#dealtHere.add(c.matchId);
    this.#save();
  }

  async #apply(l: EscrowLog): Promise<void> {
    const id = lc(l.args.matchId) as Hex, c = this.challenges.get(id), tx = l.transactionHash ?? "";
    if (!c) return; // not a match this server dealt: ignored
    if (l.eventName === "Opened") {
      if (c.openedAt) return;
      // only the creator, with exactly the token, stake and game this server recorded
      if (lc(l.args.playerA) !== c.creator || lc(l.args.token) !== TOKENS[c.token] || l.args.stake !== BigInt(c.stake) || lc(l.args.game) !== GAMES[c.game]) return;
      const m = await this.#match(id);
      if (lc(m[3]) !== c.creator || lc(m[0]) !== TOKENS[c.token] || m[1] !== BigInt(c.stake) || lc(m[2]) !== GAMES[c.game]) return;
      const openedAt = Number(m[5]);
      if (openedAt * 1000 > c.createdAt + PENDING_MS + 120_000) return; // opened after the challenge lapsed
      c.openedAt = openedAt; c.openTx = tx;
      this.#tell("listed", c);
    } else if (l.eventName === "Joined") {
      if (!c.openedAt || c.playerB || c.refused) return;
      const b = lc(l.args.playerB);
      if (!/^0x[0-9a-f]{40}$/.test(b) || b === c.creator) return;
      const m = await this.#match(id);
      if (lc(m[3]) !== c.creator || lc(m[4]) !== b || lc(m[0]) !== TOKENS[c.token] || m[1] !== BigInt(c.stake) || lc(m[2]) !== GAMES[c.game] || m[6] === 0n) return;
      c.playerB = b; c.joinedAt = Number(m[6]); c.joinTx = tx; c.nameB = this.#intents.get(id)?.get(b) ?? "";
      this.#intents.delete(id);
      this.#save();
      if (!m[7]) this.#tellJoined(c);
      this.#tell("joined", c);
    } else if (l.eventName === "Settled") {
      c.closed = { kind: "settled", tx, winner: lc(l.args.winner), draw: l.args.draw === true, payout: String(l.args.payout ?? "") };
      if (c.relay && c.relay.tx && lc(c.relay.tx) === lc(tx)) c.relay.state = "mined";
      this.#tell("settled", c);
    } else if (l.eventName === "Refunded") { c.closed = { kind: "refunded", tx }; this.#tell("refunded", c); }
    else if (l.eventName === "Cancelled") c.closed = { kind: "cancelled", tx };
  }

  /**
   * The game's verdict, from its own verified logic. Recorded once; a second, different verdict is
   * ignored. The result is then signed (after checking the chain) and relayed.
   */
  finish(matchId: string, outcome: { draw: boolean; winner: string | null }, reason?: string): Promise<void> {
    const c = this.challenges.get(matchId);
    if (!c || c.closed || !c.playerB || c.outcome) return Promise.resolve();
    const winner = outcome.draw ? null : lc(outcome.winner);
    if (!outcome.draw && winner !== c.creator && winner !== c.playerB) { c.refused = "the game named a winner who is not a player"; this.#save(); return Promise.resolve(); }
    c.outcome = { draw: outcome.draw, winner, at: this.#now(), ...(reason ? { reason } : {}) };
    this.#save();
    return this.#settle(c).catch((e) => console.error("escrow sign", (e as Error).message));
  }

  /**
   * Signs the recorded outcome, only if the match on chain is exactly the one the game was played
   * for: same token, stake, game, both players, joined and not settled. Saved before it is relayed.
   */
  async #settle(c: Challenge): Promise<void> {
    if (!c.outcome || c.result || c.refused || c.closed || this.#signing.has(c.matchId)) return;
    this.#signing.add(c.matchId);
    try {
      const m = await this.#match(c.matchId);
      const bad = lc(m[0]) !== TOKENS[c.token] ? "token" : m[1] !== BigInt(c.stake) ? "stake" : lc(m[2]) !== GAMES[c.game] ? "game"
        : lc(m[3]) !== c.creator ? "player A" : !c.playerB || lc(m[4]) !== c.playerB ? "player B" : m[6] === 0n ? "not joined" : m[7] ? "already settled" : null;
      if (bad) { c.refused = `the match on chain does not match the game (${bad})`; this.#save(); return; }
      const winner = getAddress(c.outcome.draw ? c.creator : c.outcome.winner!);
      if (Math.floor(this.#now() / 1000) + 600 > Number(m[6]) + SETTLE_TIMEOUT) { c.refused = "the settlement window closed: the stakes go back by refund"; this.#save(); return; }
      const { deadline, signature } = await signResult(this.o.signer, c.matchId, winner, c.outcome.draw, Number(m[6]), Math.floor(this.#now() / 1000));
      c.result = { winner: lc(winner), draw: c.outcome.draw, deadline: deadline.toString(), signature, at: this.#now() };
      this.#save();
    } finally { this.#signing.delete(c.matchId); }
    await this.#relay(c);
  }

  /** One automatic relay per match, ever. If it fails, the signature stays for the players to submit. */
  async #relay(c: Challenge): Promise<void> {
    if (!c.result || c.relay || c.closed || !this.o.relay) return;
    c.relay = { state: "sending", at: this.#now() };
    this.#save();
    try {
      const tx = await this.o.relay({ matchId: c.matchId, winner: getAddress(c.result.winner), draw: c.result.draw, deadline: BigInt(c.result.deadline), signature: c.result.signature });
      c.relay = { state: "sent", tx, at: this.#now() };
      this.#save();
      const r = await this.o.receipt?.(tx).catch(() => null);
      if (r && c.relay.state === "sent") { c.relay.state = r === "success" ? "mined" : "failed"; if (r !== "success") c.relay.error = "reverted"; this.#save(); }
    } catch (e) {
      c.relay = { state: "failed", error: (e as Error).message.split("\n")[0]!.slice(0, 160), at: this.#now() };
      this.#save();
    }
  }

  /**
   * The signed result for one of the two players to submit themselves. Past its deadline (and with
   * the settle window still open) the same result is signed again with a new deadline.
   */
  async signature(matchId: string, wallet: string | null) {
    const c = this.challenges.get(matchId), me = lc(wallet);
    if (!wallet) throw new GameError(401, "Sign in with your wallet.");
    if (!c || (me !== c.creator && me !== c.playerB)) throw new GameError(404, "No such match for this wallet.");
    if (c.closed) throw new GameError(409, `This match is already ${c.closed.kind}.`);
    if (!c.result) throw new GameError(409, c.refused ?? "No result yet.");
    if (BigInt(Math.floor(this.#now() / 1000) + 300) > BigInt(c.result.deadline)) {
      const { deadline, signature } = await signResult(this.o.signer, c.matchId, getAddress(c.result.winner), c.result.draw, c.joinedAt!, Math.floor(this.#now() / 1000))
        .catch((e) => { throw new GameError(409, (e as Error).message); });
      c.result = { ...c.result, deadline: deadline.toString(), signature, at: this.#now() };
      this.#save();
    }
    return { escrow: ESCROW, matchId: c.matchId, winner: getAddress(c.result.winner), draw: c.result.draw, deadline: c.result.deadline, signature: c.result.signature };
  }

  /** Polls the chain every 10 s. */
  start(): void {
    const run = () => void this.sync().catch((e) => console.error("escrow sync", (e as Error).message));
    run();
    setInterval(run, 10_000).unref();
  }
}

/** The live escrow: the mainnet client, the vault's game signer, the keeper paying gas for the relay. */
export function liveEscrow(vault: Vault): Escrow {
  const relay = async (r: RelayCall): Promise<Hex> => {
    const account = keeperAccount(vault);
    const gas = await eth.getBalance({ address: account.address });
    if (gas < 10n ** 15n) throw new Error(`the keeper ${account.address} has no ETH for gas`);
    const { request } = await eth.simulateContract({ account, address: ESCROW, abi: ESCROW_ABI, functionName: "settle", args: [r.matchId, r.winner, r.draw, r.deadline, r.signature] });
    return keeperWrite(account, request);
  };
  const receipt = async (hash: Hex) => (await eth.waitForTransactionReceipt({ hash, timeout: 600_000 })).status;
  return new Escrow({ file: join(config.dataDir, "escrow.json"), client: eth as unknown as Reader, signer: gameSignerAccount(vault), relay, receipt });
}
