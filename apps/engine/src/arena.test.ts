import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import type * as ArenaModule from "./arena.js";
import type { arenaRoutes as ArenaRoutes } from "./arena-routes.js";
import type { Auth as AuthT } from "./auth.js";
import type { ChessGames as ChessGamesT } from "./chess.js";
import type * as EscrowModule from "./escrow.js";
import type { fakeChain as FakeChain } from "./escrow.fake.js";
import type { Lobby as LobbyT } from "./games-routes.js";
import type { Vault } from "./vault.js";

let A: typeof ArenaModule, arenaRoutes: typeof ArenaRoutes, Auth: typeof AuthT, ChessGames: typeof ChessGamesT, E: typeof EscrowModule, fakeChain: typeof FakeChain, Lobby: typeof LobbyT;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "arena-test-"));
  A = await import("./arena.js");
  ({ arenaRoutes } = await import("./arena-routes.js"));
  ({ Auth } = await import("./auth.js"));
  ({ ChessGames } = await import("./chess.js"));
  E = await import("./escrow.js");
  ({ fakeChain } = await import("./escrow.fake.js"));
  ({ Lobby } = await import("./games-routes.js"));
});

class Res extends EventEmitter {
  statusCode = 0; chunks: string[] = [];
  writeHead(status: number) { this.statusCode = status; return this; }
  write(c: string) { this.chunks.push(c); return true; }
  end(c?: string) { if (c) this.chunks.push(c); return this; }
}

const SCHOLAR = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];

/** An arena with its own boards and clock, reached through the real routes. */
function world(o: { seats?: ArenaModule.SeatReader; lobby?: () => LobbyT; staked?: ChessGamesT; now?: () => number } = {}) {
  let clock = 1_800_000_000_000;
  const now = o.now ?? (() => clock);
  const arenaChess = new ChessGames(null, now), publicChess = new ChessGames(null, now);
  const seats: ArenaModule.SeatReader = o.seats ?? (async () => null);
  const arena = new A.Arena({ file: join(mkdtempSync(join(tmpdir(), "arena-")), "arena.json"), seats, arenaChess, publicChess, ...(o.staked ? { stakedChess: o.staked } : {}), ...(o.lobby ? { lobby: o.lobby } : {}), now });
  const auth = new Auth("arena-secret", [], () => {});
  const call = async (method: string, path: string, input: Record<string, unknown> = {}, token = "", ip = "arena-tests") => {
    const url = new URL(path, "http://arena.test"), res = new Res();
    const req = { method, headers: token ? { authorization: `Bearer ${token}` } : {}, socket: { remoteAddress: ip } } as unknown as IncomingMessage;
    const handled = await arenaRoutes(req, res as unknown as ServerResponse, url.pathname, {
      owner: token.startsWith("s.") ? auth.owner(req) : null, url, limited: () => false, body: async () => input, auth, vault: {} as Vault, arena,
      json: (r, status, body) => { r.writeHead(status); r.end(JSON.stringify(body)); },
    });
    return { handled, status: res.statusCode, body: JSON.parse(res.chunks.join("") || "{}") };
  };
  /** Signs the nonce message with a fresh (or given) wallet and registers, from a place of its own unless `ip` is given. */
  let place = 0;
  const register = async (input: Record<string, unknown>, wallet = privateKeyToAccount(generatePrivateKey()), signer = wallet, ip = `10.9.0.${++place}`) => {
    const n = auth.nonce();
    const signature = await signer.signMessage({ message: n.message(wallet.address) });
    const r = await call("POST", "/api/arena/register", { address: wallet.address, nonce: n.nonce, signature, ...input }, "", ip);
    return { ...r, wallet };
  };
  const advance = (ms: number) => { clock += ms; arenaChess.tick(); publicChess.tick(); o.staked?.tick(); arena.tick(); };
  return { arena, auth, call, register, advance, arenaChess, publicChess };
}

describe("arena registration", () => {
  it("registers with a valid wallet signature and returns a key, stored only as a hash", async () => {
    const w = world();
    const r = await w.register({ kind: "open", name: "Night Rook", model: "claude-opus", runtime: "claude-code", homepage: "https://example.com" });
    expect(r.status).toBe(201);
    expect(r.body.key).toMatch(/^nsa_[\w-]{32}$/);
    expect(r.body.session).toMatch(/^s\./);
    expect(r.body.agent).toMatchObject({ kind: "open", name: "Night Rook", owner: r.wallet.address.toLowerCase(), elo: 1200, seat: null });
    expect(JSON.stringify(w.arena.agents())).not.toContain(r.body.key);
    expect(JSON.stringify((w.arena as unknown as { db: unknown }).db)).not.toContain(r.body.key);
  });
  it("refuses a signature from another wallet, a reused nonce and bad input", async () => {
    const w = world();
    const victim = privateKeyToAccount(generatePrivateKey()), thief = privateKeyToAccount(generatePrivateKey());
    const bad = await w.register({ kind: "open", name: "Impostor" }, victim, thief);
    expect(bad.status).toBe(401); expect(bad.body.code).toBe("bad_signature");
    const n = w.auth.nonce(), signature = await victim.signMessage({ message: n.message(victim.address) });
    expect((await w.call("POST", "/api/arena/register", { address: victim.address, nonce: n.nonce, signature, kind: "open", name: "Real One" })).status).toBe(201);
    expect((await w.call("POST", "/api/arena/register", { address: victim.address, nonce: n.nonce, signature, kind: "open", name: "Real Two" })).status).toBe(401);
    expect((await w.call("POST", "/api/arena/register", { kind: "open", name: "No Signature" })).status).toBe(401);
    for (const input of [{ name: "x" }, { name: "admin" }, { name: "IMD Official" }, { name: "imd team" }, { name: "Admin Support" }, { name: "NIGHTSHIFT Team" }, { name: "nightshiftt" }, { name: "Nlghtshift" }, { name: "<script>" }, { name: "Okay Name", homepage: "javascript:alert(1)" }, { name: "Okay Name", homepage: "http://plain.example" }, { name: "Okay Name", kind: "robot" }]) {
      const r = await w.register({ kind: "open", ...input });
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    expect((await w.register({ kind: "open", name: "real one" })).body.code).toBe("name_taken");
  });
  it("registers an IMD seat only for the wallet that owns it, with its agent id and reputation", async () => {
    const owner = privateKeyToAccount(generatePrivateKey()), other = privateKeyToAccount(generatePrivateKey());
    const seats: ArenaModule.SeatReader = async (tokenId) => tokenId === 42 ? { tokenId, agentId: "100", owner: owner.address.toLowerCase(), online: true, attempts: 50, accepted: 45, rejected: 2, runtimes: ["claude-code"] } : null;
    const w = world({ seats });
    const refused = await w.register({ kind: "imd", tokenId: 42 }, other);
    expect(refused.status).toBe(403); expect(refused.body.code).toBe("seat_not_owned");
    expect((await w.register({ kind: "imd", tokenId: 42, agentId: "999" }, owner)).body.code).toBe("agent_mismatch");
    expect((await w.register({ kind: "imd", tokenId: 7 }, owner)).status).toBe(404);
    expect((await w.register({ kind: "imd", tokenId: 9999 }, owner)).status).toBe(400);
    const ok = await w.register({ kind: "imd", tokenId: 42, agentId: "100" }, owner);
    expect(ok.status).toBe(201);
    expect(ok.body.agent).toMatchObject({ kind: "imd", name: "Seat 42", seat: { tokenId: 42, agentId: "100" }, imd: { online: true, attempts: 50, accepted: 45, acceptance: 0.9 } });
    expect((await w.register({ kind: "imd", tokenId: 42 }, owner)).body.code).toBe("already_registered");
  });
  it("authenticates by key; owners rename, rotate and revoke; keys never manage", async () => {
    const w = world();
    const r = await w.register({ kind: "open", name: "Keyed" });
    const key = r.body.key as string, session = r.body.session as string, id = r.body.agent.id as string;
    expect((await w.call("GET", "/api/arena/me", {}, key)).body.agent.name).toBe("Keyed");
    expect((await w.call("GET", "/api/arena/me", {}, "nsa_wrongwrongwrongwrongwrongwrongwrong")).status).toBe(401);
    expect((await w.call("GET", "/api/arena/me")).status).toBe(401);
    expect((await w.call("POST", `/api/arena/agents/${id}/rotate`, {}, key)).status).toBe(401);
    expect((await w.call("POST", `/api/arena/agents/${id}/rename`, { name: "Renamed" }, session)).body.agent.name).toBe("Renamed");
    const other = await w.register({ kind: "open", name: "Stranger" });
    expect((await w.call("POST", `/api/arena/agents/${id}/revoke`, {}, other.body.session)).status).toBe(403);
    const rotated = await w.call("POST", `/api/arena/agents/${id}/rotate`, {}, session);
    expect(rotated.body.key).not.toBe(key);
    expect((await w.call("GET", "/api/arena/me", {}, key)).status).toBe(401);
    expect((await w.call("GET", "/api/arena/me", {}, rotated.body.key)).status).toBe(200);
    await w.call("POST", `/api/arena/agents/${id}/revoke`, {}, session);
    expect((await w.call("GET", "/api/arena/me", {}, rotated.body.key)).status).toBe(401);
    expect((await w.call("GET", "/api/arena/mine", {}, session)).body.agents[0]).toMatchObject({ id, revoked: true });
  });
});

describe("arena chess", () => {
  async function pair(w: ReturnType<typeof world>, sameOwner = false, o: { ip?: string; agents?: [Awaited<ReturnType<ReturnType<typeof world>["register"]>>, Awaited<ReturnType<ReturnType<typeof world>["register"]>>] } = {}) {
    const a = o.agents?.[0] ?? await w.register({ kind: "open", name: "Pearl Bot" }, undefined, undefined, o.ip);
    const b = o.agents?.[1] ?? (sameOwner ? await w.register({ kind: "open", name: "Obsidian Bot" }, a.wallet) : await w.register({ kind: "open", name: "Obsidian Bot" }, undefined, undefined, o.ip));
    const ch = await w.call("POST", "/api/arena/challenges", { game: "chess", tc: "3+2" }, a.body.key);
    expect(ch.status).toBe(201);
    expect((await w.call("GET", "/api/arena/challenges", {}, b.body.key)).body.challenges.map((c: { id: string }) => c.id)).toContain(ch.body.id);
    expect((await w.call("POST", `/api/arena/challenges/${ch.body.id}/accept`, {}, a.body.key)).body.code).toBe("own_challenge");
    const acc = await w.call("POST", `/api/arena/challenges/${ch.body.id}/accept`, {}, b.body.key);
    expect(acc.status).toBe(200);
    const game = acc.body.game.id as string;
    expect(acc.body.game.status).toBe("countdown");
    const me = await w.call("GET", "/api/arena/me", {}, a.body.key);
    expect(me.body.games.map((g: { id: string }) => g.id)).toEqual([game]);
    w.advance(5_000);
    const sa = await w.call("GET", `/api/arena/games/${game}`, {}, a.body.key);
    const [white, black] = sa.body.you === "w" ? [a, b] : [b, a];
    return { a, b, game, white, black };
  }

  it("plays agent against agent to checkmate through the API, refuses illegal and out-of-turn moves, and rates both", async () => {
    const w = world();
    const { game, white, black } = await pair(w);
    const s0 = await w.call("GET", `/api/arena/games/${game}`, {}, white.body.key);
    expect(s0.body).toMatchObject({ status: "playing", yourTurn: true, ply: 0, done: false });
    expect(s0.body.legalMoves).toHaveLength(20);
    expect(s0.body.legalMoves).toContain("e2e4");
    expect((await w.call("GET", `/api/arena/games/${game}`, {}, black.body.key)).body).toMatchObject({ yourTurn: false, legalMoves: [] });
    const out = await w.call("POST", `/api/arena/games/${game}/move`, { move: "e7e5" }, black.body.key);
    expect(out.status).toBe(409); expect(out.body.code).toBe("not_your_turn");
    const illegal = await w.call("POST", `/api/arena/games/${game}/move`, { move: "e2e5" }, white.body.key);
    expect(illegal.status).toBe(400); expect(illegal.body.code).toBe("illegal_move");
    expect((await w.call("POST", `/api/arena/games/${game}/move`, { move: "Nf3" }, white.body.key)).body.code).toBe("bad_move");
    const stranger = await w.register({ kind: "open", name: "Kibitzer" });
    expect((await w.call("POST", `/api/arena/games/${game}/move`, { move: "e2e4" }, stranger.body.key)).status).toBe(404);
    expect((await w.call("GET", `/api/arena/games/${game}`, {}, white.body.key)).body.ply).toBe(0);
    // the wait returns at once when it is your move
    expect((await w.call("GET", `/api/arena/games/${game}/wait?timeout=1`, {}, white.body.key)).body.yourTurn).toBe(true);
    let last: { body: Record<string, unknown> } | null = null;
    for (const [i, move] of SCHOLAR.entries()) {
      w.advance(1_000);
      last = await w.call("POST", `/api/arena/games/${game}/move`, { move }, (i % 2 ? black : white).body.key);
      expect(last.body.lastMove).toBe(move);
    }
    expect(last!.body).toMatchObject({ done: true, reason: "checkmate", result: "1-0", winner: "you", rated: true });
    expect((await w.call("GET", `/api/arena/games/${game}`, {}, black.body.key)).body).toMatchObject({ done: true, winner: "rival" });
    expect((await w.call("POST", `/api/arena/games/${game}/move`, { move: "a7a6" }, black.body.key)).body.code).toBe("game_over");
    const board = (await w.call("GET", "/api/arena/leaderboard")).body.leaderboard;
    expect(board.map((r: { name: string }) => r.name)).toEqual([white.body.agent.name, black.body.agent.name]);
    expect(board[0]).toMatchObject({ elo: 1216, wins: 1, games: 1 });
    expect(board[1]).toMatchObject({ elo: 1184, losses: 1, games: 1 });
    const prof = (await w.call("GET", `/api/arena/agents/${white.body.agent.id}`)).body;
    expect(prof.record).toMatchObject({ games: 1, wins: 1, elo: 1216 });
    expect(prof.recent[0]).toMatchObject({ id: game, result: "1-0", reason: "checkmate", rated: true });
    expect((await w.call("GET", `/api/arena/watch/${game}`)).body.done).toBe(true);
  });
  it("never rates two agents of the same owner against each other", async () => {
    const w = world();
    const { game, white, black } = await pair(w, true);
    for (const [i, move] of SCHOLAR.entries()) await w.call("POST", `/api/arena/games/${game}/move`, { move }, (i % 2 ? black : white).body.key);
    expect((await w.call("GET", `/api/arena/games/${game}`, {}, white.body.key)).body).toMatchObject({ done: true, rated: false });
    expect(w.arena.leaderboard()).toEqual([]);
  });
  it("does not rate two owners who registered from the same place (match-fixing with two wallets)", async () => {
    const w = world();
    const { game, white, black } = await pair(w, false, { ip: "203.0.113.7" });
    expect(white.wallet.address).not.toBe(black.wallet.address);
    for (const [i, move] of SCHOLAR.entries()) await w.call("POST", `/api/arena/games/${game}/move`, { move }, (i % 2 ? black : white).body.key);
    expect((await w.call("GET", `/api/arena/games/${game}`, {}, white.body.key)).body).toMatchObject({ done: true, rated: false });
    expect(w.arena.leaderboard()).toEqual([]);
    expect(JSON.stringify(w.arena.mine(white.wallet.address))).not.toContain("203.0.113.7");
  });
  it("rates the same two owners at most three times a day", async () => {
    const w = world();
    const first = await pair(w);
    const agents = [first.a, first.b] as [typeof first.a, typeof first.b];
    const rated: boolean[] = [];
    for (let n = 0; n < 5; n++) {
      const { game, white, black } = n === 0 ? first : await pair(w, false, { agents });
      for (const [i, move] of SCHOLAR.entries()) await w.call("POST", `/api/arena/games/${game}/move`, { move }, (i % 2 ? black : white).body.key);
      rated.push((await w.call("GET", `/api/arena/games/${game}`, {}, white.body.key)).body.rated);
    }
    expect(rated).toEqual([true, true, true, false, false]);
    // a day later they count again
    w.advance(86_400_000);
    const { game, white, black } = await pair(w, false, { agents });
    for (const [i, move] of SCHOLAR.entries()) await w.call("POST", `/api/arena/games/${game}/move`, { move }, (i % 2 ? black : white).body.key);
    expect((await w.call("GET", `/api/arena/games/${game}`, {}, white.body.key)).body.rated).toBe(true);
  });
  it("records a game both agents walked away from, and keeps it readable after its table is let go (finding 4)", async () => {
    const w = world();
    const { game, white, black } = await pair(w);
    for (const move of ["e2e4", "e7e5", "g1f3", "b8c6"]) await w.call("POST", `/api/arena/games/${game}/move`, { move }, (move === "e2e4" || move === "g1f3" ? white : black).body.key);
    // both go silent: a minute and they count as gone, then 45 s on white's turn
    w.advance(61_000); w.advance(46_000);
    const rec = (await w.call("GET", `/api/arena/agents/${white.body.agent.id}`)).body.recent[0];
    expect(rec).toMatchObject({ id: game, reason: "abandonment", result: "0-1", plies: 4 });
    // half an hour later the table is let go: the game is still there, finished, from the record
    w.advance(31 * 60_000);
    const s = await w.call("GET", `/api/arena/games/${game}`, {}, black.body.key);
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ id: game, status: "finished", done: true, result: "0-1", reason: "abandonment", winner: "you", closed: true, you: "b" });
    expect((await w.call("GET", `/api/arena/games/${game}/wait?timeout=1`, {}, white.body.key)).body).toMatchObject({ done: true, winner: "rival" });
    // acting on it is 410 game_closed, as documented; a stranger still gets 404
    const late = await w.call("POST", `/api/arena/games/${game}/move`, { move: "a2a3" }, white.body.key);
    expect(late.status).toBe(410); expect(late.body.code).toBe("game_closed");
    const stranger = await w.register({ kind: "open", name: "Kibitzer" });
    expect((await w.call("GET", `/api/arena/games/${game}`, {}, stranger.body.key)).status).toBe(404);
  });
  it("lists live arena games for spectators and treats a silent agent as gone", async () => {
    const w = world();
    const { game, white } = await pair(w);
    const live = (await w.call("GET", "/api/arena/live")).body.games;
    expect(live[0]).toMatchObject({ game: "chess", id: game, watch: `/arena?watch=${game}` });
    expect(live[0].players.every((p: { agent?: string }) => p.agent)).toBe(true);
    // white never comes back: a minute counts as gone, then 45 s more on its turn loses by abandonment
    w.advance(61_000); w.advance(46_000);
    expect((await w.call("GET", `/api/arena/games/${game}`, {}, white.body.key)).body).toMatchObject({ done: true, reason: "abandonment", winner: "rival" });
  });
  it("lets an agent wait in the public queue and meet a person", async () => {
    const w = world();
    const a = await w.register({ kind: "open", name: "Queue Bot" });
    const q = await w.call("POST", "/api/arena/queue", { tc: "5+0" }, a.body.key);
    expect(q.body).toMatchObject({ status: "waiting", where: "public" });
    const human = w.publicChess.queue("Alice", null, "5+0");
    expect(human.match.id).toBe(q.body.id);
    w.advance(5_000);
    const s = await w.call("GET", `/api/arena/games/${q.body.id}`, {}, a.body.key);
    expect(s.body.players.map((p: { kind: string }) => p.kind).sort()).toEqual(["human", "open"]);
  });
});

describe("staked arena seats", () => {
  const B = "0x2222222222222222222222222222222222222222" as Address;
  it("only the owner who staked assigns their seat; the agent plays and the verdict goes to the owner's wallet", async () => {
    let now = Date.UTC(2026, 9, 19, 12);
    const signer = privateKeyToAccount(generatePrivateKey());
    const f = fakeChain({ signer: signer.address });
    const escrow = new E.Escrow({ file: null, client: f.client, signer, relay: f.relay, now: () => now });
    const staked = new ChessGames(null, () => now);
    const lobby = new Lobby(escrow, { pinball: () => { throw new Error("no pinball"); }, chess: (x) => staked.createStaked(x) });
    const w = world({ lobby: () => lobby, staked, now: () => now });
    const owner = await w.register({ kind: "open", name: "Stake Bot" });
    const other = await w.register({ kind: "open", name: "Other Bot" });
    const ownerAddr = owner.wallet.address as Address;
    const r = await escrow.create(ownerAddr, { game: "chess", token: "IMD", amount: "5", tc: "3+2", name: "Stake Bot" }), id = r.matchId as Hex;
    f.open(id, E.TOKENS.IMD, 5n * 10n ** 18n, E.GAMES.chess, ownerAddr, Math.floor(now / 1000)); await escrow.sync();
    // nobody else assigns this seat, and nobody assigns someone else's agent
    expect((await w.call("POST", `/api/arena/stakes/${id}/assign`, { agent: owner.body.agent.id }, other.body.session)).status).toBe(404);
    expect((await w.call("POST", `/api/arena/stakes/${id}/assign`, { agent: other.body.agent.id }, owner.body.session)).status).toBe(403);
    expect((await w.call("POST", `/api/arena/stakes/${id}/assign`, { agent: owner.body.agent.id }, owner.body.key)).status).toBe(401);
    const ok = await w.call("POST", `/api/arena/stakes/${id}/assign`, { agent: owner.body.agent.id }, owner.body.session);
    expect(ok.status).toBe(200); expect(ok.body.status).toBe("open");
    expect((await w.call("GET", "/api/arena/me", {}, owner.body.key)).body.games).toEqual([]);
    escrow.intend(id, B, "Bob"); f.join(id, B, Math.floor(now / 1000)); await escrow.sync();
    const me = (await w.call("GET", "/api/arena/me", {}, owner.body.key)).body;
    expect(me.games).toHaveLength(1);
    expect(me.games[0]).toMatchObject({ where: "staked", currency: "IMD", stake: "5", escrow: id, status: "waiting" });
    const game = me.games[0].id as string;
    // the human rival takes their seat from their own session
    const seatB = lobby.seat(id, B) as { id: string; player: string };
    const offB = staked.listen(seatB.id, seatB.player, () => {});
    now += 5_000; staked.tick();
    const s = (await w.call("GET", `/api/arena/games/${game}`, {}, owner.body.key)).body;
    expect(s.status).toBe("playing");
    const agentWhite = s.you === "w";
    for (const [i, move] of SCHOLAR.entries()) {
      const agentTurn = (i % 2 === 0) === agentWhite;
      if (agentTurn) expect((await w.call("POST", `/api/arena/games/${game}/move`, { move }, owner.body.key)).status).toBe(200);
      else staked.move(seatB.id, seatB.player, move.slice(0, 2), move.slice(2, 4));
    }
    await new Promise((res) => setTimeout(res, 10));
    expect(escrow.challenges.get(id)!.outcome).toMatchObject({ draw: false, winner: agentWhite ? ownerAddr.toLowerCase() : B.toLowerCase() });
    expect((await w.call("GET", `/api/arena/games/${game}`, {}, owner.body.key)).body).toMatchObject({ done: true, where: "staked" });
    expect((await w.call("POST", `/api/arena/stakes/${id}/assign`, { agent: owner.body.agent.id }, owner.body.session)).status).toBe(409);
    offB();
  });
});
