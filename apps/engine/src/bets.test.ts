import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Address, type Hex, concat, encodeAbiParameters, hashTypedData, keccak256, recoverAddress, recoverTypedDataAddress, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import type * as BetsModule from "./bets.js";
import type * as WeightsModule from "./bet-weights.js";
import type { fakeBetChain as FakeBetChain } from "./bets.fake.js";
import type { ChessGames as ChessGamesT } from "./chess.js";

let B: typeof BetsModule, W: typeof WeightsModule, fakeBetChain: typeof FakeBetChain, ChessGames: typeof ChessGamesT;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bets-test-"));
  B = await import("./bets.js");
  W = await import("./bet-weights.js");
  ({ fakeBetChain } = await import("./bets.fake.js"));
  ({ ChessGames } = await import("./chess.js"));
});

const POOL = "0x00000000000000000000000000000000b37b0011" as Address;
const A = "0x1111111111111111111111111111111111111111" as Address, C = "0x3333333333333333333333333333333333333333" as Address;
/** The two players' wallets in staked duels. */
const P1 = "0x4444444444444444444444444444444444444444" as Address, P2 = "0x5555555555555555555555555555555555555555" as Address;
const E18 = 10n ** 18n;
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const chessIn = (o: Partial<WeightsModule.ChessInput> = {}): WeightsModule.ChessInput => ({ fen: START, ply: 0, clocks: { w: 180_000, b: 180_000 }, initialMs: 180_000, status: "playing", connected: [true, true], ...o });
const pinIn = (o: Partial<WeightsModule.PinballInput> = {}): WeightsModule.PinballInput => ({ startedAt: 0, now: 0, durationMs: 150_000, scores: [0, 0], over: [false, false], connected: [true, true], broken: [false, false], done: false, ...o });

describe("bet weights", () => {
  it("counts early bets fully and late ones about a third, both sides alike when level", () => {
    const early = W.chessWeights(chessIn());
    expect(early).toMatchObject({ a: 10_000, b: 10_000, locked: null, leader: null });
    const late = W.chessWeights(chessIn({ ply: 70, clocks: { w: 60_000, b: 60_000 } }));
    expect(late.locked).toBeNull();
    expect(late.a).toBe(late.b);
    expect(late.a).toBeLessThan(5_000);
    expect(late.a).toBeGreaterThanOrEqual(W.MIN_WEIGHT);
    // the clock alone moves progress on: a long think late counts as late
    expect(W.chessWeights(chessIn({ ply: 4, clocks: { w: 50_000, b: 50_000 } })).a).toBeLessThan(early.a);
  });
  it("gives the side behind more weight than the leader (material, check, a mate threat, the clock)", () => {
    // black has no queen, early on: backing white counts little, backing black more, but never at full
    // weight (a queen thrown on purpose, to back that side and win anyway, is worth at most 4000 bps)
    const q = W.chessWeights(chessIn({ fen: "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", ply: 10 }));
    expect(q.leader).toBe(0);
    expect(q.a).toBeLessThan(3_000);
    expect(q.b).toBe(W.TRAILER_MAX_WEIGHT);
    // a rook up for black: the other way round
    const r = W.chessWeights(chessIn({ fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBNR w Kkq - 0 1", ply: 10 }));
    expect(r.leader).toBe(1);
    expect(r.b).toBeLessThan(r.a);
    // a big clock edge alone makes a leader
    const t = W.chessWeights(chessIn({ ply: 20, clocks: { w: 170_000, b: 30_000 } }));
    expect(t.leader).toBe(0);
    expect(t.a).toBeLessThan(t.b);
  });
  it("locks chess when mate is on the board, a queen up late, a clock under 20 s, a player away, or before the start", () => {
    const fools = "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2";
    expect(W.chessWeights(chessIn({ fen: fools, ply: 3 })).locked).toMatch(/Mate is on the board/);
    expect(W.chessWeights(chessIn({ fen: "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", ply: 44 })).locked).toMatch(/queen up/);
    expect(W.chessWeights(chessIn({ fen: "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", ply: 12 })).locked).toBeNull();
    expect(W.chessWeights(chessIn({ ply: 30, clocks: { w: 19_000, b: 90_000 } })).locked).toMatch(/under 20 seconds/);
    expect(W.chessWeights(chessIn({ connected: [true, false] })).locked).toMatch(/reconnecting/);
    expect(W.chessWeights(chessIn({ status: "waiting" })).locked).toMatch(/Waiting/);
    expect(W.chessWeights(chessIn({ status: "finished" })).locked).toMatch(/over/);
    // the countdown is fine: the earliest bets of all
    expect(W.chessWeights(chessIn({ status: "countdown", connected: [false, false] })).locked).toBeNull();
  });
  it("weighs pinball by the duel's clock and the live lead, and locks the last 20%, a drained table or a player away", () => {
    expect(W.pinballWeights(pinIn({ now: 0 }))).toMatchObject({ a: 10_000, b: 10_000, locked: null });
    expect(W.pinballWeights(pinIn({ now: 5_000 })).a).toBeGreaterThan(W.pinballWeights(pinIn({ now: 100_000 })).a);
    const lead = W.pinballWeights(pinIn({ now: 75_000, scores: [30_000, 10_000] }));
    expect(lead.leader).toBe(0);
    expect(lead.a).toBeLessThanOrEqual(lead.b);
    expect(W.pinballWeights(pinIn({ now: 15_000, scores: [12_000, 10_000] })).a).toBeLessThan(W.pinballWeights(pinIn({ now: 15_000, scores: [12_000, 10_000] })).b);
    expect(lead.a).toBeLessThan(W.pinballWeights(pinIn({ now: 75_000, scores: [12_000, 10_000] })).a);
    expect(W.pinballWeights(pinIn({ now: 121_000, scores: [5, 5] })).locked).toMatch(/last 20%/);
    expect(W.pinballWeights(pinIn({ now: 60_000, over: [false, true] })).locked).toMatch(/drained/);
    expect(W.pinballWeights(pinIn({ now: 60_000, connected: [false, true] })).locked).toMatch(/reconnecting/);
    expect(W.pinballWeights(pinIn({ startedAt: null })).locked).toMatch(/Waiting/);
    expect(W.pinballWeights(pinIn({ done: true })).locked).toMatch(/over/);
  });
  it("never goes below 500 or above 10000 bps", () => {
    expect(W.shape(1, 1, 0)).toMatchObject({ a: 700, b: 4_000 });
    expect(W.bps(0.01)).toBe(500);
    expect(W.bps(3)).toBe(10_000);
    expect(W.shape(0, 1, 1)).toMatchObject({ a: 4_000, b: 2_000 });
    for (let p = 0; p <= 1; p += 0.1) for (let c = 0; c <= 1; c += 0.1) for (const l of [0, 1, null] as const) {
      const w = W.shape(p, c, l);
      for (const x of [w.a, w.b]) { expect(x).toBeGreaterThanOrEqual(500); expect(x).toBeLessThanOrEqual(10_000); expect(Number.isInteger(x)).toBe(true); }
      // the side behind: never below the leader; clearly behind, never above max(4000, the leader's weight)
      if (l !== null && c > 0) {
        const [ahead, behind] = l === 0 ? [w.a, w.b] : [w.b, w.a];
        expect(behind).toBeGreaterThanOrEqual(ahead);
        if (c >= 0.5) expect(behind).toBeLessThanOrEqual(Math.max(W.TRAILER_MAX_WEIGHT, ahead));
      }
    }
  });
  it("locks a few seconds after a big swing of the lead, and while a draw offer is open", () => {
    const g = new W.SwingGuard(), level = W.shape(0.2, 0, null), white = W.shape(0.2, 0.6, 0), black = W.shape(0.2, 0.6, 1);
    expect(g.check("m", level, 0).locked).toBeNull();
    expect(g.check("m", W.shape(0.2, 0.2, 0), 1_000).locked).toBeNull();
    expect(g.check("m", white, 2_000).locked).toMatch(/just swung/);
    expect(g.check("m", white, 2_000 + W.SWING_PAUSE_MS - 1).locked).toMatch(/just swung/);
    expect(g.check("m", white, 2_000 + W.SWING_PAUSE_MS).locked).toBeNull();
    // the other way round, at once: a thrown position
    expect(g.check("m", black, 20_000).locked).toMatch(/just swung/);
    // another match is not touched
    expect(g.check("n", black, 20_000).locked).toBeNull();
    expect(W.chessWeights(chessIn({ drawOffered: true })).locked).toMatch(/draw is offered/);
  });
});

describe("BetPool signatures", () => {
  const domainHash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")), keccak256(toHex("NightshiftBets")), keccak256(toHex("1")), 1n, POOL]));
  const digest = (struct: Hex) => keccak256(concat(["0x1901", domainHash, struct]));

  it("signs exactly the Market digest the contract computes (NightshiftBets v1, chain 1)", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const m = { marketId: B.marketIdOf("chess", "abc123", "IMD"), token: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7" as Address, closesAt: 1_800_000_000n, game: B.BOARDS.chess };
    const struct = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "uint64" }, { type: "bytes32" }],
      [keccak256(toHex("Market(bytes32 marketId,address token,uint64 closesAt,bytes32 game)")), m.marketId, m.token, m.closesAt, m.game]));
    expect(hashTypedData({ domain: B.betsDomain(POOL), types: B.MARKET_TYPES, primaryType: "Market", message: m })).toBe(digest(struct));
    expect(await recoverAddress({ hash: digest(struct), signature: await B.signMarket(account, POOL, m) })).toBe(account.address);
  });
  it("signs exactly the Ticket digest", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const t = { marketId: keccak256(toHex("m")), bettor: A, side: 1, amount: 5n * E18, weightBps: 6_200, expiry: 1_800_000_030n, nonce: keccak256(toHex("n")) };
    const struct = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "uint8" }, { type: "uint256" }, { type: "uint16" }, { type: "uint64" }, { type: "bytes32" }],
      [keccak256(toHex("Ticket(bytes32 marketId,address bettor,uint8 side,uint256 amount,uint16 weightBps,uint64 expiry,bytes32 nonce)")), t.marketId, t.bettor, t.side, t.amount, t.weightBps, t.expiry, t.nonce]));
    expect(hashTypedData({ domain: B.betsDomain(POOL), types: B.TICKET_TYPES, primaryType: "Ticket", message: t })).toBe(digest(struct));
    expect(await recoverAddress({ hash: digest(struct), signature: await B.signTicket(account, POOL, t) })).toBe(account.address);
  });
  it("signs exactly the Outcome digest", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const o = { marketId: keccak256(toHex("m")), outcome: 2, deadline: 1_800_043_200n };
    const struct = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }, { type: "uint256" }],
      [keccak256(toHex("Outcome(bytes32 marketId,uint8 outcome,uint256 deadline)")), o.marketId, o.outcome, o.deadline]));
    expect(hashTypedData({ domain: B.betsDomain(POOL), types: B.OUTCOME_TYPES, primaryType: "Outcome", message: o })).toBe(digest(struct));
    expect(await recoverAddress({ hash: digest(struct), signature: await B.signOutcome(account, POOL, o) })).toBe(account.address);
  });
  it("derives one market id per match and token, the same every time", () => {
    expect(B.marketIdOf("chess", "ab", "IMD")).toBe(B.marketIdOf("chess", "ab", "IMD"));
    expect(new Set([B.marketIdOf("chess", "ab", "IMD"), B.marketIdOf("chess", "ab", "SHIFT"), B.marketIdOf("pinball", "ab", "IMD"), B.marketIdOf("arena", "ab", "IMD"), B.marketIdOf("chess", "ac", "IMD")]).size).toBe(5);
  });
});

/** A pool on a fake chain, with a real chess board and pinball duels the test sets. */
function setup(o: { live?: boolean; address?: string; watch?: boolean } = {}) {
  let now = Date.UTC(2026, 9, 19, 12);
  const signer = privateKeyToAccount(generatePrivateKey());
  const f = fakeBetChain({ pool: POOL, signer: o.live === false ? "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5" : signer.address });
  const games = new ChessGames(null, () => now);
  const pin = new Map<string, BetsModule.PinballState>();
  /** Arena tables the test sets: who owns the agents at each. */
  const arena = new Map<string, BetsModule.ArenaParties>();
  const lookup: BetsModule.Lookup = (game, id) => game === "chess" ? B.fromChess("chess", id, games.watchView(id), games.betInfo(id), arena.get(id) ?? null, now) : game === "pinball" && pin.has(id) ? B.fromPinball(id, pin.get(id)!, now) : null;
  const watch = (board: BetsModule.Board, id: string, f: () => void) => (board === "chess" ? games.watch(id, f) : null);
  const bets = new B.Bets({ address: o.address ?? POOL, file: join(mkdtempSync(join(tmpdir(), "bets-")), "bets.json"), client: f.client, signer, lookup, watch: o.watch === false ? undefined : watch, relaySettle: f.relaySettle, relayCreate: f.relayCreate, now: () => now, fromBlock: 30_000_000n });
  /** A chess game between two connected players, started (staked in GameEscrow unless `free`, 500 IMD each by default): who is white, and a move function. */
  const game = (free = false, stake: { currency?: "IMD" | "SHIFT"; stake?: string } = {}) => {
    let id: string, pa: string, pb: string;
    if (free) {
      const a = games.queue("Pearl", null, "3+2"); games.listen(a.match.id, a.player, () => {});
      const b = games.queue("Onyx", null, "3+2"); games.listen(b.match.id, b.player, () => {});
      id = a.match.id; pa = a.player; pb = b.player;
    } else {
      const t = games.createStaked({ escrow: keccak256(toHex(`duel ${Math.random()}`)), tc: "3+2", currency: stake.currency ?? "IMD", stake: stake.stake ?? "500", a: { wallet: P1, name: "Pearl" }, b: { wallet: P2, name: "Onyx" }, onResult: () => {} });
      id = t.id; pa = t.seats[P1.toLowerCase()]!; pb = t.seats[P2.toLowerCase()]!;
      games.listen(id, pa, () => {}); games.listen(id, pb, () => {});
    }
    now += free ? 6_000 : 11_000; // past the countdown (a staked game's is 10 s)
    const white = games.get(id, pa).you === "w" ? pa : pb, black = white === pa ? pb : pa;
    const move = (uci: string) => games.move(id, games.get(id, white).turn === "w" ? white : black, uci.slice(0, 2), uci.slice(2, 4));
    return { id, white, black, move };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { f, bets, games, pin, arena, signer, game, flush, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe("tickets", () => {
  it("are refused while betting is off, to a visitor not signed in, and while the contract does not trust this server", async () => {
    const off = setup({ address: "" });
    await expect(off.bets.ticket(A, { game: "chess", matchId: "ab", side: "A", token: "IMD", amount: "1" })).rejects.toMatchObject({ status: 409, message: /opens soon/ });
    expect(await off.bets.status()).toMatchObject({ configured: false, live: false });
    const t = setup();
    await expect(t.bets.ticket(null, { game: "chess", matchId: "ab", side: "A", token: "IMD", amount: "1" })).rejects.toMatchObject({ status: 401 });
    const notOurs = setup({ live: false });
    expect(await notOurs.bets.status()).toMatchObject({ configured: true, live: false });
    await expect(notOurs.bets.ticket(A, { game: "chess", matchId: "ab", side: "A", token: "IMD", amount: "1" })).rejects.toMatchObject({ status: 409, message: /result signer/ });
    const paused = setup(); paused.f.s.paused = true;
    await expect(paused.bets.ticket(A, { game: "chess", matchId: "ab", side: "A", token: "IMD", amount: "1" })).rejects.toMatchObject({ status: 409, message: /paused/ });
  });
  it("checks the input, the game and the contract's limits", async () => {
    const { bets, game } = setup();
    const g = game();
    const ask = (x: Record<string, unknown>) => bets.ticket(A, { game: "chess", matchId: g.id, side: "A", token: "IMD", amount: "1", ...x });
    await expect(ask({ game: "darts" })).rejects.toThrow(/Unknown game/);
    await expect(ask({ side: "C" })).rejects.toThrow(/side A or side B/);
    await expect(ask({ token: "ETH" })).rejects.toThrow(/IMD or SHIFT/);
    for (const bad of ["", "1e3", "-1", "0x10", "01"]) await expect(ask({ amount: bad })).rejects.toThrow(/number/);
    await expect(ask({ matchId: "ffff" })).rejects.toMatchObject({ status: 404 });
    await expect(ask({ amount: "0.09" })).rejects.toThrow(/between 0.1 and 500 IMD/);
    await expect(ask({ amount: "500.000000000000000001" })).rejects.toThrow(/between/);
    // a staked duel's bets are in its stake's token
    await expect(ask({ token: "SHIFT", amount: "1000" })).rejects.toMatchObject({ status: 409, message: /in IMD, the token of its stake/ });
    const s = game(false, { currency: "SHIFT", stake: "10000000" });
    await expect(ask({ matchId: s.id, token: "SHIFT", amount: "999" })).rejects.toThrow(/between 1000 and 25000000 SHIFT/);
    await expect(ask({ matchId: s.id, token: "SHIFT", amount: "25000001" })).rejects.toThrow(/between/);
    await expect(ask({ matchId: s.id, token: "IMD" })).rejects.toThrow(/in SHIFT/);
  });
  it("gives a short ticket for exactly this wallet, side, amount and weight, signed by the game signer", async () => {
    const { bets, game, signer, f, flush } = setup();
    const g = game();
    f.s.balances.set(A.toLowerCase(), 100n * E18);
    const r = await bets.ticket(A, { game: "chess", matchId: g.id, side: "B", token: "IMD", amount: "2.5" });
    expect(r.ticket).toMatchObject({ bettor: A, side: 1, amount: (25n * E18 / 10n).toString() });
    // a second into the game, level: almost the full weight
    expect(r.ticket.weightBps).toBeGreaterThan(9_900);
    expect(r.weightBps).toBe(r.ticket.weightBps);
    expect(r.ticket.expiry - Math.floor(Date.UTC(2026, 9, 19, 12, 0, 11) / 1000)).toBe(B.TICKET_TTL);
    expect(B.TICKET_TTL).toBeLessThanOrEqual(120);
    expect(r.ticket.marketId).toBe(B.marketIdOf("chess", g.id, "IMD"));
    const message = { ...r.ticket, amount: BigInt(r.ticket.amount), expiry: BigInt(r.ticket.expiry) };
    expect(await recoverTypedDataAddress({ domain: B.betsDomain(POOL), types: B.TICKET_TYPES, primaryType: "Ticket", message, signature: r.signature })).toBe(signer.address);
    // the market is signed for anyone to create, and the keeper creates it once
    expect(r.market).toMatchObject({ marketId: r.ticket.marketId, created: false, game: B.BOARDS.chess });
    expect(await recoverTypedDataAddress({ domain: B.betsDomain(POOL), types: B.MARKET_TYPES, primaryType: "Market", message: { marketId: r.market.marketId, token: r.market.token, closesAt: BigInt(r.market.closesAt), game: r.market.game }, signature: r.market.signature! })).toBe(signer.address);
    await flush();
    await bets.ticket(A, { game: "chess", matchId: g.id, side: "A", token: "IMD", amount: "1" });
    await flush();
    expect(f.s.created).toHaveLength(1);
    // nonces never repeat
    const again = await bets.ticket(A, { game: "chess", matchId: g.id, side: "B", token: "IMD", amount: "2.5" });
    expect(again.ticket.nonce).not.toBe(r.ticket.nonce);
  });
  it("lets the keeper create no market for a wallet that does not hold the bet", async () => {
    const { bets, game, f, flush } = setup();
    const g = game();
    await bets.ticket(A, { game: "chess", matchId: g.id, side: "A", token: "IMD", amount: "1" });
    await flush();
    expect(f.s.created).toHaveLength(0);
  });
  it("are refused while the game is locked, and once it is over", async () => {
    const { bets, game } = setup();
    const g = game();
    g.move("f2f3"); g.move("e7e5"); g.move("g2g4");
    // black has mate in one
    await expect(bets.ticket(A, { game: "chess", matchId: g.id, side: "B", token: "IMD", amount: "1" })).rejects.toMatchObject({ status: 409, message: /locked: Mate is on the board/ });
    g.move("d8h4");
    await expect(bets.ticket(A, { game: "chess", matchId: g.id, side: "B", token: "IMD", amount: "1" })).rejects.toMatchObject({ status: 409, message: /over/ });
  });
  it("are rate limited per wallet", async () => {
    const { bets, game } = setup();
    const g = game();
    for (let i = 0; i < B.TICKETS_PER_MINUTE; i++) await bets.ticket(A, { game: "chess", matchId: g.id, side: "A", token: "IMD", amount: "1" });
    await expect(bets.ticket(A, { game: "chess", matchId: g.id, side: "A", token: "IMD", amount: "1" })).rejects.toMatchObject({ status: 429 });
    await expect(bets.ticket(C, { game: "chess", matchId: g.id, side: "A", token: "IMD", amount: "1" })).resolves.toBeTruthy();
  });
});

describe("settlement", () => {
  it("signs the verified result once (black won: outcome 1) and relays settle() once the market is on chain", async () => {
    const { bets, game, f, signer, flush } = setup();
    const g = game();
    const r = await bets.ticket(A, { game: "chess", matchId: g.id, side: "A", token: "IMD", amount: "1" });
    const id = r.ticket.marketId;
    g.move("f2f3"); g.move("e7e5"); g.move("g2g4"); g.move("d8h4");
    await bets.tick();
    for (let i = 0; i < 5; i++) await flush();
    const m = bets.markets.get(id)!;
    expect(m.outcome?.outcome).toBe(1);
    const first = m.result!;
    expect(await recoverTypedDataAddress({ domain: B.betsDomain(POOL), types: B.OUTCOME_TYPES, primaryType: "Outcome", message: { marketId: id, outcome: 1, deadline: BigInt(first.deadline) }, signature: first.signature })).toBe(signer.address);
    // not on chain yet: nothing to relay; anyone may still fetch the signature
    expect(f.s.settled).toHaveLength(0);
    expect(await bets.settlement(id)).toMatchObject({ marketId: id, outcome: 1, signature: first.signature });
    // the market appears on chain (the bettor created it): settled once
    f.created({ marketId: id, token: r.market.token as Address, closesAt: r.market.closesAt, game: r.market.game as Hex });
    await bets.sync(); await flush();
    expect(f.s.settled).toEqual([{ marketId: id, outcome: 1, deadline: BigInt(first.deadline), signature: first.signature }]);
    await bets.tick(); await bets.sync(); await bets.decide(id, 0, "a second verdict"); await flush();
    expect(f.s.settled).toHaveLength(1);
    expect(bets.markets.get(id)!.outcome?.outcome).toBe(1);
    expect(bets.markets.get(id)!.result!.signature).toBe(first.signature);
  });
  it("maps a draw, a void duel and a game that vanished to 2, and pinball's winner to its side", async () => {
    const { bets, game, games, pin, advance } = setup();
    const g = game();
    const r = await bets.ticket(A, { game: "chess", matchId: g.id, side: "A", token: "IMD", amount: "1" });
    games.draw(g.id, g.white, "offer"); games.draw(g.id, g.black, "accept");
    await bets.tick();
    expect(bets.markets.get(r.ticket.marketId)!.outcome).toMatchObject({ outcome: 2, reason: "agreement" });

    const duel = (o: Partial<BetsModule.PinballState> = {}): BetsModule.PinballState => ({ startedAt: Date.UTC(2026, 9, 19, 12), go: true, durationMs: 150_000, done: false, draw: false, void: null, winner: -1, currency: "IMD", stake: 100, escrow: keccak256(toHex("pinball duel")),
      players: [{ name: "Pearl", agent: false, wallet: P1.toLowerCase(), score: 0, over: false, connected: true, broken: false }, { name: "Onyx", agent: true, wallet: P2.toLowerCase(), score: 0, over: false, connected: true, broken: false }], ...o });
    pin.set("aa01", duel()); pin.set("aa02", duel()); pin.set("aa03", duel());
    const ids = await Promise.all(["aa01", "aa02", "aa03"].map(async (x) => (await bets.ticket(A, { game: "pinball", matchId: x, side: "B", token: "IMD", amount: "1" })).ticket.marketId));
    pin.set("aa01", duel({ done: true, winner: 0 }));
    pin.set("aa02", duel({ void: "Your rival never connected.", done: true }));
    pin.delete("aa03");
    advance(2_000);
    await bets.tick();
    expect(ids.map((x) => bets.markets.get(x)!.outcome?.outcome)).toEqual([0, 2, 2]);
  });
});

describe("the chain follower", () => {
  it("follows markets, bets and settlement from the logs, whatever the contract indexes", async () => {
    const { bets, game, f } = setup();
    const told: BetsModule.BetEvent[] = [];
    bets.onEvent((e) => told.push(e));
    const g = game();
    const r = await bets.ticket(A, { game: "chess", matchId: g.id, side: "A", token: "IMD", amount: "30" });
    const id = r.ticket.marketId, mk = { marketId: id, token: r.market.token as Address, closesAt: r.market.closesAt, game: r.market.game as Hex };
    // a market with other terms, and a market this server never signed: ignored
    f.created({ ...mk, closesAt: r.market.closesAt + 1 });
    f.created({ ...mk, marketId: keccak256(toHex("someone else")) });
    f.bet(keccak256(toHex("someone else")), A, 0, 99n * E18, 10_000);
    await bets.sync();
    expect(bets.markets.get(id)!.onChain).toBeUndefined();
    expect(bets.markets.size).toBe(1);
    // only marketId indexed this time: decoded all the same
    f.created(mk, 1);
    f.bet(id, A, 0, 30n * E18, 10_000);
    f.bet(id, C, 1, 2n * E18, 6_200, 1);
    f.bet(id, C, 1, E18, 5_000, 3);
    await bets.sync();
    const m = bets.markets.get(id)!;
    expect(m.onChain).toBeTruthy();
    expect(m.totals).toEqual({ a: (30n * E18).toString(), b: (3n * E18).toString(), sharesA: (30n * E18).toString(), sharesB: ((2n * E18 * 6_200n) / 10_000n + E18 / 2n).toString(), bets: 3 });
    expect(m.feed.map((x) => [x.side, x.weightBps])).toEqual([[1, 5_000], [1, 6_200], [0, 10_000]]);
    // the same range read again (a restart before the cursor was saved) counts nothing twice
    bets.cursor = 30_000_000n;
    await bets.sync();
    expect(bets.markets.get(id)!.totals.bets).toBe(3);
    expect(told.filter((e) => e.kind === "big")).toHaveLength(1);
    // the view: pools, weights, feed, and the wallet's own bets from the contract
    f.s.bets.set(`${id}:${A.toLowerCase()}`, [30n * E18, 0n, 30n * E18, 0n, false]);
    const v = await bets.view("chess", g.id, A.toLowerCase());
    expect(v).toMatchObject({ configured: true, live: true, locked: null });
    expect([...v.names].sort()).toEqual(["Onyx", "Pearl"]);
    expect(v.markets.IMD).toMatchObject({ created: true, signature: null });
    expect(v.feed).toHaveLength(3);
    expect(v.you?.IMD).toMatchObject({ amountA: (30n * E18).toString(), claimed: false });
    // settled on chain: closed, and told once
    f.settled(id, 0, (3n * E18 * 500n) / 10_000n);
    await bets.sync();
    expect(bets.markets.get(id)!.closed).toMatchObject({ kind: "settled", outcome: 0 });
    expect(told.filter((e) => e.kind === "settled")).toHaveLength(1);
    expect(B.payoutOf(bets.markets.get(id)!, 0)).toEqual({ pool: 33n * E18, fee: 15n * E18 / 100n, winners: 33n * E18 - 15n * E18 / 100n, refundable: false });
    expect(B.payoutOf(bets.markets.get(id)!, 2).refundable).toBe(true);
  });
});

describe("the routes", () => {
  it("answer status, refuse a ticket to a visitor, and say betting is off while no pool is set", async () => {
    const { betsRoutes } = await import("./bets-routes.js");
    const call = async (bets: BetsModule.Bets, method: string, path: string, owner: string | null, body: Record<string, unknown> = {}) => {
      let out: { status: number; body: Record<string, unknown> } | null = null;
      const url = new URL(path, "http://localhost");
      await betsRoutes({ method } as never, {} as never, url.pathname, {
        json: (_res, status, b) => { out = { status, body: b as Record<string, unknown> }; }, body: async () => body, limited: () => false, owner, url, vault: {} as never, bets,
      });
      return out!;
    };
    const on = setup(), off = setup({ address: "" });
    expect(await call(on.bets, "GET", "/api/bets/status", null)).toMatchObject({ status: 200, body: { configured: true, live: true, betPool: POOL, serverSigner: on.signer.address.toLowerCase() } });
    expect(await call(off.bets, "GET", "/api/bets/status", null)).toMatchObject({ status: 200, body: { configured: false, live: false } });
    expect(await call(on.bets, "POST", "/api/bets/ticket", null, { game: "chess", matchId: "ab", side: "A", token: "IMD", amount: "1" })).toMatchObject({ status: 401 });
    expect(await call(off.bets, "POST", "/api/bets/ticket", A, { game: "chess", matchId: "ab", side: "A", token: "IMD", amount: "1" })).toMatchObject({ status: 409, body: { error: /opens soon/ } });
    expect(await call(on.bets, "GET", "/api/bets/market?game=chess&id=abcd", null)).toMatchObject({ status: 404 });
    const g = on.game();
    expect(await call(on.bets, "GET", `/api/bets/market?game=chess&id=${g.id}`, null)).toMatchObject({ status: 200, body: { locked: null, markets: { IMD: null, SHIFT: null }, you: null } });
  });
});

describe("anti-rigging", () => {
  const ask = (bets: BetsModule.Bets, who: string, game: string, matchId: string, x: Record<string, unknown> = {}) => bets.ticket(who, { game, matchId, side: "A", token: "IMD", amount: "1", ...x });
  it("gives free anonymous games no market, and says why", async () => {
    const { bets, game } = setup();
    const g = game(true);
    await expect(ask(bets, A, "chess", g.id)).rejects.toMatchObject({ status: 409, message: B.NOT_ELIGIBLE });
    expect(bets.markets.size).toBe(0);
    expect(await bets.view("chess", g.id, null)).toMatchObject({ eligible: false, locked: B.NOT_ELIGIBLE, weights: null });
    // a staked duel is open
    expect((await bets.view("chess", game().id, null)).eligible).toBe(true);
  });
  it("opens arena games only to two agents of different owners that are both IMD seats or both established", () => {
    const free = { escrow: null, wallets: { w: null, b: null } }, now = Date.UTC(2026, 9, 19, 12), week = 7 * 86_400_000;
    const old = (owner: string, o: Partial<BetsModule.ArenaSeat> = {}): BetsModule.ArenaSeat => ({ kind: "open", owner: owner.toLowerCase(), seat: null, createdAt: now - week, rated: 10, opponents: 3, ...o });
    const at = (w: BetsModule.ArenaSeat | null, b: BetsModule.ArenaSeat | null, owners = { w: A, b: C }) => B.chessParties(free, { owners, agents: 2, assigned: [], seats: { w, b } }, now);
    expect(at(old(A), old(C))).toEqual({ eligible: null, tied: [A.toLowerCase(), C.toLowerCase()] });
    // two fresh sybil agents: no market
    expect(at(old(A, { createdAt: now - week + 1 }), old(C)).eligible).toBe(B.NOT_ESTABLISHED);
    expect(at(old(A), old(C, { rated: 9 })).eligible).toBe(B.NOT_ESTABLISHED);
    expect(at(old(A, { opponents: 2 }), old(C)).eligible).toBe(B.NOT_ESTABLISHED);
    // two IMD seats (distinct, each owner's own) need no history
    const seat = (owner: string, n: number) => old(owner, { kind: "imd", seat: n, createdAt: now, rated: 0, opponents: 0 });
    expect(at(seat(A, 1), seat(C, 2)).eligible).toBeNull();
    expect(at(seat(A, 1), seat(C, 1)).eligible).toBe(B.NOT_ESTABLISHED);
    expect(at(seat(A, 1), old(C, { createdAt: now, rated: 0 })).eligible).toBe(B.NOT_ESTABLISHED);
    // the agents must be the owners' at the table; unknown agents get nothing
    expect(at(seat(P1, 1), seat(C, 2)).eligible).toBe(B.NOT_ESTABLISHED);
    expect(at(null, old(C)).eligible).toBe(B.NOT_ESTABLISHED);
    expect(B.chessParties(free, { owners: { w: A, b: C }, agents: 2, assigned: [] }).eligible).toBe(B.NOT_ESTABLISHED);
    expect(B.chessParties(free, { owners: { w: A, b: A.toUpperCase().replace("0X", "0x") }, agents: 2, assigned: [], seats: { w: old(A), b: old(A) } }).eligible).toBe(B.NOT_ELIGIBLE);
    expect(B.chessParties(free, { owners: { w: A, b: null }, agents: 1, assigned: [] }).eligible).toBe(B.NOT_ELIGIBLE);
    expect(B.chessParties(free, null).eligible).toBe(B.NOT_ELIGIBLE);
    // a staked seat played by an agent: the players' wallets and the assigning owner are all tied
    expect(B.chessParties({ escrow: "0x01", wallets: { w: P1, b: P2 } }, { owners: { w: C, b: null }, agents: 1, assigned: [C] })).toEqual({ eligible: null, tied: [P1, P2, C].map((x) => x.toLowerCase()) });
  });
  it("refuses tickets (403) to the players of a staked duel and to the owners of the agents at the table", async () => {
    const { bets, game, arena, pin } = setup();
    const g = game();
    for (const w of [P1, P2]) await expect(ask(bets, w, "chess", g.id)).rejects.toMatchObject({ status: 403, message: /tied to this match/ });
    await expect(ask(bets, A, "chess", g.id)).resolves.toBeTruthy();
    // an agent game on a free board: open to spectators, closed to both owners
    const h = game(true);
    const seat = (owner: string, n: number): BetsModule.ArenaSeat => ({ kind: "imd", owner: owner.toLowerCase(), seat: n, createdAt: 0, rated: 0, opponents: 0 });
    arena.set(h.id, { owners: { w: A, b: C }, agents: 2, assigned: [], seats: { w: seat(A, 1), b: seat(C, 2) } });
    for (const w of [A, C]) await expect(ask(bets, w, "chess", h.id)).rejects.toMatchObject({ status: 403 });
    await expect(ask(bets, P1, "chess", h.id)).resolves.toBeTruthy();
    // pinball: staked only, and not its players
    pin.set("bb01", { startedAt: Date.now(), go: true, durationMs: 150_000, done: false, draw: false, void: null, winner: -1, currency: "IMD", stake: 100, escrow: "0x01",
      players: [{ name: "Pearl", agent: false, wallet: P1.toLowerCase(), score: 0, over: false, connected: true, broken: false }, { name: "Onyx", agent: false, wallet: null, score: 0, over: false, connected: true, broken: false }] });
    pin.set("bb02", { ...pin.get("bb01")!, escrow: null });
    await expect(ask(bets, P1, "pinball", "bb01")).rejects.toMatchObject({ status: 403 });
    await expect(ask(bets, A, "pinball", "bb02")).rejects.toMatchObject({ status: 409, message: B.NOT_ELIGIBLE });
    // a staked duel below the minimum stake gets no market
    pin.set("bb03", { ...pin.get("bb01")!, stake: 9.99 });
    await expect(ask(bets, A, "pinball", "bb03")).rejects.toMatchObject({ status: 409, message: /at least 10 IMD/ });
    await expect(ask(bets, A, "chess", game(false, { stake: "9.5" }).id)).rejects.toMatchObject({ status: 409, message: /at least 10 IMD/ });
  });
  it(`caps a staked duel's whole pool at ${4}× its stake, open tickets included`, async () => {
    const { bets, game, f, advance } = setup();
    expect(B.POOL_PER_STAKE).toBe(4n);
    const g = game(false, { stake: "100" }); // pool at most 400 IMD
    const r = await ask(bets, A, "chess", g.id, { amount: "250" });
    await expect(ask(bets, C, "chess", g.id, { amount: "151" })).rejects.toMatchObject({ status: 409, message: /pool is full: at most 400 IMD/ });
    await expect(ask(bets, C, "chess", g.id, { amount: "150" })).resolves.toBeTruthy();
    await expect(ask(bets, P1.replace("44", "66"), "chess", g.id, { amount: "0.1" })).rejects.toMatchObject({ status: 409 });
    // the tickets lapse unused: room again; once bets are mined, the contract's totals count
    advance((B.TICKET_TTL + 1) * 1000);
    await expect(ask(bets, C, "chess", g.id, { amount: "100" })).resolves.toBeTruthy();
    advance((B.TICKET_TTL + 1) * 1000);
    f.created({ marketId: r.ticket.marketId, token: r.market.token as Address, closesAt: r.market.closesAt, game: r.market.game as Hex });
    await bets.sync();
    f.s.pools.set(r.ticket.marketId.toLowerCase(), [300n * E18, 50n * E18]);
    await expect(ask(bets, C, "chess", g.id, { amount: "51" })).rejects.toMatchObject({ status: 409, message: /pool is full/ });
    await expect(ask(bets, C, "chess", g.id, { amount: "50" })).resolves.toBeTruthy();
  });
  it("caps one wallet's total on a market at the contract's per-bet maximum, open tickets included", async () => {
    const { bets, game, f, advance } = setup();
    const g = game();
    const r = await ask(bets, A, "chess", g.id, { amount: "300" });
    await expect(ask(bets, A, "chess", g.id, { amount: "250" })).rejects.toMatchObject({ status: 400, message: /at most 500 IMD in all/ });
    await expect(ask(bets, A, "chess", g.id, { amount: "200" })).resolves.toBeTruthy();
    // other wallets have their own caps (within the duel's pool cap: 4 × 500 IMD)
    await expect(ask(bets, C, "chess", g.id, { amount: "500" })).resolves.toBeTruthy();
    // tickets expired; the 300 was mined: what is on chain still counts
    advance((B.TICKET_TTL + 1) * 1000);
    f.created({ marketId: r.ticket.marketId, token: r.market.token as Address, closesAt: r.market.closesAt, game: r.market.game as Hex });
    await bets.sync();
    f.s.bets.set(`${r.ticket.marketId}:${A.toLowerCase()}`, [300n * E18, 0n, 300n * E18, 0n, false]);
    await expect(ask(bets, A, "chess", g.id, { amount: "201" })).rejects.toMatchObject({ status: 400 });
    await expect(ask(bets, A, "chess", g.id, { amount: "200", side: "B" })).resolves.toBeTruthy();
  });
  it("gives no ticket once the game is over, and decides its market at once (resignation, draw, mate), without the tick", async () => {
    for (const end of ["resign", "draw", "mate"] as const) {
      const { bets, game, games, f, flush } = setup();
      const g = game();
      const r = await ask(bets, A, "chess", g.id);
      f.created({ marketId: r.ticket.marketId, token: r.market.token as Address, closesAt: r.market.closesAt, game: r.market.game as Hex });
      await bets.sync();
      if (end === "resign") games.resign(g.id, g.black);
      else if (end === "draw") { games.draw(g.id, g.white, "offer"); games.draw(g.id, g.black, "accept"); }
      else { g.move("f2f3"); g.move("e7e5"); g.move("g2g4"); g.move("d8h4"); }
      await expect(ask(bets, C, "chess", g.id)).rejects.toMatchObject({ status: 409, message: /over/ });
      for (let i = 0; i < 5; i++) await flush();
      const m = bets.markets.get(r.ticket.marketId)!;
      expect(m.outcome?.outcome).toBe(end === "resign" ? 0 : end === "draw" ? 2 : 1);
      // signed and relayed already: no 2 s tick ran
      expect(f.s.settled).toHaveLength(1);
      expect(f.s.settled[0]).toMatchObject({ marketId: r.ticket.marketId, outcome: m.outcome!.outcome });
    }
    // without a game stream, any look at the finished game decides it too
    const { bets, game, games, flush } = setup({ watch: false });
    const g = game();
    const r = await ask(bets, A, "chess", g.id);
    games.resign(g.id, g.white);
    await expect(ask(bets, C, "chess", g.id)).rejects.toMatchObject({ status: 409 });
    for (let i = 0; i < 5; i++) await flush();
    expect(bets.markets.get(r.ticket.marketId)!.outcome?.outcome).toBe(1);
  });
  it("lives 8 s, and pauses for 10 s after a check or the capture of a queen or rook", async () => {
    expect(B.TICKET_TTL).toBe(8);
    const { bets, game, advance } = setup();
    const g = game();
    g.move("e2e4"); g.move("f7f5");
    await expect(ask(bets, A, "chess", g.id)).resolves.toBeTruthy();
    g.move("d1h5"); // check
    await expect(ask(bets, A, "chess", g.id)).rejects.toMatchObject({ status: 409, message: /capture or a check just happened/ });
    advance(9_000);
    await expect(ask(bets, A, "chess", g.id)).rejects.toMatchObject({ status: 409 });
    advance(1_500);
    await expect(ask(bets, A, "chess", g.id)).resolves.toBeTruthy();
    // a pawn taken is no pause
    const p = game(); p.move("e2e4"); p.move("d7d5"); p.move("e4d5");
    await expect(ask(bets, A, "chess", p.id)).resolves.toBeTruthy();
    expect(W.chessWeights(chessIn({ sinceSharpMs: 9_999 })).locked).toMatch(/capture or a check/);
    expect(W.chessWeights(chessIn({ sinceSharpMs: 10_000 })).locked).toBeNull();
    const h = setup().games, t = h.createStaked({ escrow: "0x02", tc: "3+2", currency: "IMD", stake: "1", a: { wallet: P1, name: "a" }, b: { wallet: P2, name: "b" }, onResult: () => {} });
    expect(h.betInfo(t.id)).toMatchObject({ escrow: "0x02", wallets: { w: expect.any(String), b: expect.any(String) }, sharpAt: null });
  });
});
