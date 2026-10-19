import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Address, type Hex, concat, encodeAbiParameters, hashTypedData, keccak256, parseSignature, recoverAddress, recoverTypedDataAddress, stringToHex, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import type * as EscrowModule from "./escrow.js";
import type { fakeChain as FakeChain } from "./escrow.fake.js";
import type { ChessGames as ChessGamesT } from "./chess.js";
import type { Lobby as LobbyT } from "./games-routes.js";

let E: typeof EscrowModule, fakeChain: typeof FakeChain, ChessGames: typeof ChessGamesT, Lobby: typeof LobbyT;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "escrow-test-"));
  E = await import("./escrow.js");
  ({ fakeChain } = await import("./escrow.fake.js"));
  ({ ChessGames } = await import("./chess.js"));
  ({ Lobby } = await import("./games-routes.js"));
});

const A = "0x1111111111111111111111111111111111111111" as Address, B = "0x2222222222222222222222222222222222222222" as Address, C = "0x3333333333333333333333333333333333333333" as Address;
const IMD = 10n ** 18n;

function setup(o: { live?: boolean; now?: number } = {}) {
  let now = o.now ?? Date.UTC(2026, 9, 19, 12);
  const signer = privateKeyToAccount(generatePrivateKey());
  const f = fakeChain({ signer: o.live === false ? "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5" : signer.address });
  const escrow = new E.Escrow({ file: join(mkdtempSync(join(tmpdir(), "escrow-")), "escrow.json"), client: f.client, signer, relay: f.relay, now: () => now });
  return { f, escrow, signer, sec: () => Math.floor(now / 1000), advance: (ms: number) => { now += ms; }, now: () => now };
}

describe("game result signatures", () => {
  it("signs exactly the contract's hashResult digest (EIP-712, NightshiftGames v2, chain 1)", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const matchId = keccak256(toHex("a match")), joinedAt = 1_800_000_000, now = joinedAt + 100;
    const { deadline, signature } = await E.signResult(account, matchId, B, false, joinedAt, now);
    expect(deadline).toBe(BigInt(now + 12 * 3600));
    const viaViem = hashTypedData({ domain: E.DOMAIN, types: E.RESULT_TYPES, primaryType: "Result", message: { matchId, winner: B, draw: false, deadline } });
    // by hand, as GameEscrow.hashResult computes it
    const typehash = keccak256(toHex("Result(bytes32 matchId,address winner,bool draw,uint256 deadline)"));
    const domain = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")), keccak256(toHex("NightshiftGames")), keccak256(toHex("2")), 1n, "0xf460fd9ad76f18414f54a2431870e8a116193489"]));
    const struct = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bool" }, { type: "uint256" }], [typehash, matchId, B, false, deadline]));
    const digest = keccak256(concat(["0x1901", domain, struct]));
    expect(viaViem).toBe(digest);
    expect(await recoverAddress({ hash: digest, signature })).toBe(account.address);
    expect(await recoverTypedDataAddress({ domain: E.DOMAIN, types: E.RESULT_TYPES, primaryType: "Result", message: { matchId, winner: B, draw: false, deadline }, signature })).toBe(account.address);
    // what ECDSA.recover accepts: 65 bytes, v 27 or 28, low s
    expect((signature.length - 2) / 2).toBe(65);
    const sig = parseSignature(signature);
    expect([27n, 28n]).toContain(sig.v);
    expect(BigInt(sig.s)).toBeLessThanOrEqual(0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n);
    // a draw signs a different digest
    expect(hashTypedData({ domain: E.DOMAIN, types: E.RESULT_TYPES, primaryType: "Result", message: { matchId, winner: B, draw: true, deadline } })).not.toBe(digest);
  });
  it("never sets a deadline at or past joinedAt + 24 h, and refuses to sign once the window is nearly shut", async () => {
    const account = privateKeyToAccount(generatePrivateKey()), id = keccak256(toHex("late"));
    const joinedAt = 1_800_000_000;
    expect((await E.signResult(account, id, A, false, joinedAt, joinedAt + 20 * 3600)).deadline).toBe(BigInt(joinedAt + 86_399));
    await expect(E.signResult(account, id, A, false, joinedAt, joinedAt + 86_000)).rejects.toThrow(/window has closed/);
  });
  it("labels games as right-padded bytes32", () => {
    expect(E.GAMES.pinball).toBe(stringToHex("pinball", { size: 32 }));
    expect(E.GAMES.chess).toBe(`0x${Buffer.from("chess").toString("hex").padEnd(64, "0")}`);
  });
});

describe("the challenge lobby", () => {
  it("validates the wallet, game, token, amount, time control and the live limits", async () => {
    const { escrow } = setup();
    await expect(escrow.create(null, { game: "pinball", token: "IMD", amount: "1" })).rejects.toMatchObject({ status: 401 });
    await expect(escrow.create(A, { game: "poker", token: "IMD", amount: "1" })).rejects.toThrow(/Unknown game/);
    await expect(escrow.create(A, { game: "pinball", token: "ETH", amount: "1" })).rejects.toThrow(/IMD or SHIFT/);
    for (const bad of ["", "1e3", "-1", "0x10", "1.0000000000000000001", "01", " 1 2"]) await expect(escrow.create(A, { game: "pinball", token: "IMD", amount: bad })).rejects.toThrow(/number/);
    await expect(escrow.create(A, { game: "chess", token: "IMD", amount: "1", tc: "1+0" })).rejects.toThrow(/3\+2/);
    await expect(escrow.create(A, { game: "pinball", token: "IMD", amount: "0.49" })).rejects.toThrow(/between 0.5 and 1000 IMD/);
    await expect(escrow.create(A, { game: "pinball", token: "IMD", amount: "1000.000000000000000001" })).rejects.toThrow(/between/);
    await expect(escrow.create(A, { game: "pinball", token: "SHIFT", amount: "9999" })).rejects.toThrow(/between 10000 and 50000000 SHIFT/);
    const r = await escrow.create(A, { game: "chess", token: "SHIFT", amount: "10000.5", tc: "5+0", name: "Pearl" });
    expect(r).toMatchObject({ game: stringToHex("chess", { size: 32 }), token: E.TOKENS.SHIFT, stake: (100_005n * 10n ** 17n).toString(), escrow: E.ESCROW });
    expect(r.matchId).toMatch(/^0x[0-9a-f]{64}$/);
    expect((await escrow.create(A, { game: "pinball", token: "IMD", amount: "0.5" })).matchId).not.toBe(r.matchId);
    expect(escrow.challenges.get(r.matchId)).toMatchObject({ creator: A.toLowerCase(), tc: "5+0" });
  });
  it("opens no challenge while the contract does not trust this server's signer, or is paused", async () => {
    const off = setup({ live: false });
    expect(await off.escrow.stakesLive()).toBe(false);
    await expect(off.escrow.create(A, { game: "pinball", token: "IMD", amount: "1" })).rejects.toMatchObject({ status: 409, message: /result signer is activated/ });
    const paused = setup(); paused.f.s.paused = true;
    expect(await paused.escrow.stakesLive()).toBe(false);
    expect(await setup().escrow.stakesLive()).toBe(true);
  });
  it("lists a challenge only after an Opened event from its creator with exactly its token, stake and game", async () => {
    const { f, escrow, sec, advance } = setup();
    const r = await escrow.create(A, { game: "pinball", token: "IMD", amount: "2", name: "Pearl" });
    const id = r.matchId as Hex;
    // someone else opens the id first, or the creator with other terms: all ignored
    f.open(id, E.TOKENS.IMD, 2n * IMD, E.GAMES.pinball, C, sec());
    await escrow.sync();
    expect(escrow.open()).toHaveLength(0);
    for (const [token, stake, game] of [[E.TOKENS.SHIFT, 2n * IMD, E.GAMES.pinball], [E.TOKENS.IMD, 3n * IMD, E.GAMES.pinball], [E.TOKENS.IMD, 2n * IMD, E.GAMES.chess]] as const) {
      f.s.logs.length = 0; f.open(id, token, stake, game, A, sec()); await escrow.sync();
      expect(escrow.open()).toHaveLength(0);
    }
    // an event that says the right thing while the match on chain says otherwise: ignored
    f.s.logs.length = 0; f.open(id, E.TOKENS.IMD, 2n * IMD, E.GAMES.pinball, A, sec());
    f.s.matches.set(id, [E.TOKENS.IMD, 1n, E.GAMES.pinball, A, "0x0000000000000000000000000000000000000000", BigInt(sec()), 0n, false]);
    await escrow.sync();
    expect(escrow.open()).toHaveLength(0);
    f.s.logs.length = 0; f.open(id, E.TOKENS.IMD, 2n * IMD, E.GAMES.pinball, A, sec()); await escrow.sync();
    const [listed] = escrow.open("pinball");
    expect(listed).toMatchObject({ matchId: id, amount: "2", token: "IMD", name: "Pearl", status: "open", remaining: 3600 });
    expect(escrow.open("chess")).toHaveLength(0);
    advance(3_600_000);
    expect(escrow.open()).toHaveLength(0);
  });
  it("ignores an Opened event after the challenge lapsed, and events for ids it never dealt", async () => {
    const { f, escrow, sec, advance } = setup();
    const r = await escrow.create(A, { game: "pinball", token: "IMD", amount: "1" });
    advance(20 * 60_000);
    f.open(r.matchId as Hex, E.TOKENS.IMD, IMD, E.GAMES.pinball, A, sec());
    f.open(keccak256(toHex("stranger")), E.TOKENS.IMD, IMD, E.GAMES.pinball, A, sec());
    await escrow.sync();
    expect(escrow.open()).toHaveLength(0);
    expect(escrow.challenges.size).toBe(1);
  });
  it("trusts a Joined event only for an opened challenge whose match on chain names the joiner", async () => {
    const { f, escrow, sec } = setup();
    const joined: string[] = [];
    escrow.onJoined((c) => joined.push(c.matchId));
    const r = await escrow.create(A, { game: "pinball", token: "IMD", amount: "1" }), id = r.matchId as Hex;
    // a join before any open is ignored
    f.log("Joined", { matchId: id, playerB: B }); await escrow.sync();
    expect(joined).toHaveLength(0);
    f.open(id, E.TOKENS.IMD, IMD, E.GAMES.pinball, A, sec());
    // the event names B but the chain does not
    f.log("Joined", { matchId: id, playerB: B }); await escrow.sync();
    expect(joined).toHaveLength(0);
    f.join(id, B, sec()); await escrow.sync();
    expect([...new Set(joined)]).toEqual([id]); // (also told again on each sync until decided: the lobby deals once)
    expect(escrow.challenges.get(id)).toMatchObject({ playerB: B.toLowerCase(), joinedAt: sec() });
    expect(escrow.open()).toHaveLength(0);
  });
});

/** A chess challenge from A, accepted by B, both on chain; the lobby deals the game. */
async function chessDuel(o: { relay?: boolean } = {}) {
  const t = setup();
  let clock = t.now();
  const games = new ChessGames(null, () => clock);
  const lobby = new Lobby(t.escrow, { pinball: () => { throw new Error("no pinball here"); }, chess: (x) => games.createStaked(x) });
  const r = await t.escrow.create(A, { game: "chess", token: "IMD", amount: "5", tc: "3+2", name: "Pearl" }), id = r.matchId as Hex;
  t.f.open(id, E.TOKENS.IMD, 5n * IMD, E.GAMES.chess, A, t.sec());
  await t.escrow.sync();
  t.escrow.intend(id, B, "Obsidian");
  t.f.join(id, B, t.sec());
  await t.escrow.sync();
  const step = (ms: number) => { clock += ms; t.advance(ms); games.tick(); };
  return { ...t, games, lobby, id, step };
}

describe("staked NIGHT CHESS", () => {
  it("deals a game for exactly the two wallets and signs the winner, relayed once", async () => {
    const d = await chessDuel();
    expect(() => d.lobby.seat(d.id, C)).toThrow(/No such match/);
    expect(() => d.lobby.seat(d.id, null)).toThrow(/Sign in/);
    const sa = d.lobby.seat(d.id, A) as { game: string; id: string; player: string }, sb = d.lobby.seat(d.id, B) as typeof sa;
    expect(sa.game).toBe("chess"); expect(sb.id).toBe(sa.id); expect(sa.player).not.toBe(sb.player);
    // not started until both are at the table
    const offA = d.games.listen(sa.id, sa.player, () => {});
    expect(d.games.get(sa.id, sa.player).startedAt).toBeNull();
    expect(() => d.games.leave(sa.id, sa.player)).toThrow(/staked/);
    const offB = d.games.listen(sb.id, sb.player, () => {});
    const v = d.games.get(sa.id, sa.player);
    expect(v).toMatchObject({ currency: "IMD", stake: "5", escrow: d.id });
    expect(v.players.map((p) => p.name).sort()).toEqual(["Obsidian", "Pearl"]);
    d.step(5_000);
    const white = v.you === "w" ? sa.player : sb.player, black = white === sa.player ? sb.player : sa.player, whiteWallet = white === sa.player ? A : B;
    for (const [i, [from, to]] of [["e2", "e4"], ["e7", "e5"], ["f1", "c4"], ["b8", "c6"], ["d1", "h5"], ["g8", "f6"], ["h5", "f7"]].entries()) d.games.move(sa.id, i % 2 ? black : white, from!, to!);
    expect(d.games.get(sa.id, white)).toMatchObject({ done: true, reason: "checkmate", winnerIsYou: true });
    await new Promise((r) => setTimeout(r, 10));
    const c = d.escrow.challenges.get(d.id)!;
    expect(c.outcome).toMatchObject({ draw: false, winner: whiteWallet.toLowerCase() });
    expect(c.result?.winner).toBe(whiteWallet.toLowerCase());
    const sig = await d.escrow.signature(d.id, A);
    expect(await recoverTypedDataAddress({ domain: E.DOMAIN, types: E.RESULT_TYPES, primaryType: "Result", message: { matchId: d.id, winner: whiteWallet, draw: false, deadline: BigInt(sig.deadline) }, signature: sig.signature })).toBe(d.signer.address);
    expect(d.f.s.relayed).toHaveLength(1);
    expect(d.f.s.relayed[0]).toMatchObject({ matchId: d.id, winner: whiteWallet, draw: false, signature: c.result!.signature });
    expect(c.relay).toMatchObject({ state: "sent", tx: `0x${"ab".repeat(32)}` });
    // no second verdict, no second relay, however often it is asked
    await d.escrow.finish(d.id, { draw: false, winner: whiteWallet === A ? B : A });
    await d.escrow.sync(); await d.escrow.sync();
    expect(d.escrow.challenges.get(d.id)!.result!.winner).toBe(whiteWallet.toLowerCase());
    expect(d.f.s.relayed).toHaveLength(1);
    expect(() => d.games.rematch(sa.id, sa.player)).toThrow(/no rematch/);
    await expect(d.escrow.signature(d.id, C)).rejects.toThrow(/No such match/);
    // the Settled event closes it
    d.f.log("Settled", { matchId: d.id, winner: whiteWallet, draw: false, payout: 95n * IMD / 10n, fee: IMD / 2n }); await d.escrow.sync();
    expect(d.escrow.view(d.escrow.challenges.get(d.id)!).status).toBe("settled");
    await expect(d.escrow.signature(d.id, A)).rejects.toThrow(/already settled/);
    offA(); offB();
  });
  it("a player who never shows loses by abandonment; nobody showing is a draw", async () => {
    const d = await chessDuel();
    const sa = d.lobby.seat(d.id, A) as { id: string; player: string };
    const off = d.games.listen(sa.id, sa.player, () => {});
    d.step(5 * 60_000); // the show-up deadline: A alone at the table
    d.step(5_000);
    const mine = d.games.get(sa.id, sa.player);
    if (mine.you === "w") d.games.move(sa.id, sa.player, "e2", "e4");
    d.step(46_000);
    expect(d.games.get(sa.id, sa.player)).toMatchObject({ done: true, reason: "abandonment", winnerIsYou: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(d.escrow.challenges.get(d.id)!.result).toMatchObject({ winner: A.toLowerCase(), draw: false });
    off();
    const e = await chessDuel();
    e.step(5 * 60_000 + 1);
    await new Promise((r) => setTimeout(r, 10));
    // a draw names player A in the ignored winner field
    expect(e.escrow.challenges.get(e.id)!.result).toMatchObject({ winner: A.toLowerCase(), draw: true });
    expect(e.f.s.relayed[0]).toMatchObject({ draw: true, winner: A });
  });
  it("signs nothing when the match on chain does not match what the game recorded", async () => {
    for (const change of ["stake", "playerB", "settled", "token", "game"] as const) {
      const d = await chessDuel();
      const m = d.f.s.matches.get(d.id)!;
      d.f.s.matches.set(d.id, [change === "token" ? E.TOKENS.SHIFT : m[0], change === "stake" ? 1n : m[1], change === "game" ? E.GAMES.pinball : m[2], m[3], change === "playerB" ? C : m[4], m[5], m[6], change === "settled"]);
      await d.escrow.finish(d.id, { draw: false, winner: B });
      const c = d.escrow.challenges.get(d.id)!;
      expect(c.result).toBeUndefined();
      expect(c.refused).toMatch(/does not match/);
      expect(d.f.s.relayed).toHaveLength(0);
      await expect(d.escrow.signature(d.id, B)).rejects.toThrow(/does not match/);
    }
  });
  it("never signs a winner who is not one of the two players", async () => {
    const d = await chessDuel();
    await d.escrow.finish(d.id, { draw: false, winner: C });
    expect(d.escrow.challenges.get(d.id)!.result).toBeUndefined();
    expect(d.f.s.relayed).toHaveLength(0);
  });
  it("keeps the signature for the players when the relay fails, and does not relay again", async () => {
    const t = setup();
    const failing = new E.Escrow({ file: null, client: t.f.client, signer: t.signer, now: t.now, relay: async () => { t.f.s.relayed.push({} as never); throw new Error("the keeper has no ETH for gas"); } });
    const r = await failing.create(A, { game: "pinball", token: "IMD", amount: "1" }), id = r.matchId as Hex;
    t.f.open(id, E.TOKENS.IMD, IMD, E.GAMES.pinball, A, t.sec()); t.f.join(id, B, t.sec());
    await failing.sync();
    await failing.finish(id, { draw: false, winner: B });
    expect(failing.challenges.get(id)!.relay).toMatchObject({ state: "failed", error: /no ETH/ });
    const s = await failing.signature(id, B);
    expect(s).toMatchObject({ winner: B, draw: false, escrow: E.ESCROW });
    await failing.sync();
    expect(t.f.s.relayed).toHaveLength(1);
  });
  it("re-signs the same result with a fresh deadline once the first has passed", async () => {
    const d = await chessDuel();
    await d.escrow.finish(d.id, { draw: false, winner: B });
    const first = await d.escrow.signature(d.id, B);
    d.advance(13 * 3_600_000);
    const again = await d.escrow.signature(d.id, A);
    expect(again.winner).toBe(first.winner); expect(again.draw).toBe(false);
    expect(BigInt(again.deadline)).toBe(BigInt(d.escrow.challenges.get(d.id)!.joinedAt! + 86_399));
    d.advance(11 * 3_600_000);
    await expect(d.escrow.signature(d.id, A)).rejects.toThrow(/window has closed/);
  });
  it("persists challenges and the cursor, and deals a joined game again after a restart", async () => {
    const t = setup();
    const file = join(mkdtempSync(join(tmpdir(), "escrow-restart-")), "escrow.json");
    const one = new E.Escrow({ file, client: t.f.client, signer: t.signer, now: t.now });
    const r = await one.create(A, { game: "pinball", token: "SHIFT", amount: "20000" }), id = r.matchId as Hex;
    t.f.open(id, E.TOKENS.SHIFT, 20_000n * IMD, E.GAMES.pinball, A, t.sec()); t.f.join(id, B, t.sec());
    await one.sync();
    const two = new E.Escrow({ file, client: t.f.client, signer: t.signer, now: t.now });
    expect(two.cursor).toBe(one.cursor);
    const dealt: string[] = [];
    two.onJoined((c) => dealt.push(c.matchId));
    await two.sync();
    expect(dealt).toEqual([id]);
    // once decided, never dealt again
    await two.finish(id, { draw: true, winner: null });
    dealt.length = 0; await two.sync();
    expect(dealt).toHaveLength(0);
  });
  it("never deals a game again after a restart: a game dealt before it ends as a draw, both stakes refunded", async () => {
    const t = setup();
    const file = join(mkdtempSync(join(tmpdir(), "escrow-redeal-")), "escrow.json");
    const games = new ChessGames(null, t.now);
    const one = new E.Escrow({ file, client: t.f.client, signer: t.signer, now: t.now });
    const lobbyOne = new Lobby(one, { pinball: () => { throw new Error("no pinball here"); }, chess: (x) => games.createStaked(x) });
    const r = await one.create(A, { game: "chess", token: "IMD", amount: "5", tc: "3+2" }), id = r.matchId as Hex;
    t.f.open(id, E.TOKENS.IMD, 5n * IMD, E.GAMES.chess, A, t.sec()); t.f.join(id, B, t.sec());
    await one.sync();
    expect(lobbyOne.tables.has(id)).toBe(true);
    expect(one.challenges.get(id)!.dealtAt).toBeTruthy();
    // the same process keeps its game: nothing changes on the next sync
    await one.sync();
    expect(one.challenges.get(id)!.outcome).toBeUndefined();
    // restart mid-game (say the loser's position was hopeless): no fresh game, a draw that refunds both
    const two = new E.Escrow({ file, client: t.f.client, signer: t.signer, relay: t.f.relay, now: t.now });
    const made: unknown[] = [];
    const lobbyTwo = new Lobby(two, { pinball: () => { throw new Error("no pinball here"); }, chess: (x) => { made.push(x); return games.createStaked(x); } });
    await two.sync();
    expect(made).toHaveLength(0);
    expect(lobbyTwo.tables.size).toBe(0);
    const c = two.challenges.get(id)!;
    expect(c.outcome).toMatchObject({ draw: true, winner: null, reason: expect.stringMatching(/restarted/) });
    expect(c.result).toMatchObject({ draw: true });
    expect(t.f.s.relayed).toEqual([expect.objectContaining({ matchId: id, draw: true })]);
    expect(() => lobbyTwo.seat(id, A)).toThrow(/over/);
    // a match that was joined but never dealt still gets its game after a restart
    const s = await two.create(A, { game: "chess", token: "IMD", amount: "5", tc: "3+2" }), id2 = s.matchId as Hex;
    t.f.open(id2, E.TOKENS.IMD, 5n * IMD, E.GAMES.chess, A, t.sec()); t.f.join(id2, C, t.sec());
    const three = new E.Escrow({ file, client: t.f.client, signer: t.signer, now: t.now });
    const lobbyThree = new Lobby(three, { pinball: () => { throw new Error("no pinball here"); }, chess: (x) => games.createStaked(x) });
    await three.sync();
    expect(lobbyThree.tables.has(id2)).toBe(true);
    expect(three.challenges.get(id2)!.outcome).toBeUndefined();
  });
});
