import type { IncomingMessage, ServerResponse } from "node:http";
import { formatUnits } from "viem";
import { isAdmin } from "./admin.js";
import { chess, STAKED_SHOW_MS, type TimeControl } from "./chess.js";
import { createStaked as pinballStaked } from "./pinball.js";
import { pool } from "./pool.js";
import { poker } from "./poker.js";
import { type Challenge, ESCROW, Escrow, GameError, liveEscrow } from "./escrow.js";
import { keeperAccount } from "./keeper.js";
import { eth } from "./chain.js";
import { loungeRoutes } from "./lounge.js";
import type { Vault } from "./vault.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  owner: string | null; url: URL; vault: Vault;
};
type Result = { draw: boolean; winner: string | null };
type Seat = { wallet: string; name: string };
/** What the lobby needs from each game: a duel for exactly two wallets, whose verdict comes back by wallet. */
export type StakedGames = {
  pinball: (o: { escrow: string; currency: "IMD" | "SHIFT"; stake: number; a: Seat; b: Seat; onResult: (r: Result) => void }) => { id: string; seats: Record<string, string> };
  chess: (o: { escrow: string; tc: TimeControl; currency: "IMD" | "SHIFT"; stake: string; a: Seat; b: Seat; onResult: (r: Result) => void }) => { id: string; seats: Record<string, string> };
  pool: (o: { escrow: string; currency: "IMD" | "SHIFT"; stake: string; a: Seat; b: Seat; onResult: (r: Result) => void }) => { id: string; seats: Record<string, string> };
  /** NIGHT POKER heads-up (optional: a lobby made without it deals no poker). */
  poker?: (o: { escrow: string; currency: "IMD" | "SHIFT"; stake: string; a: Seat; b: Seat; onResult: (r: Result) => void }) => { id: string; seats: Record<string, string> };
};
export type StakedGame = keyof StakedGames;

/**
 * The challenge lobby shared by Space Pinball, NIGHT CHESS, NIGHT POOL and NIGHT POKER. When the escrow sees a Joined event
 * that matches a challenge exactly, the game is made for those two wallets; each player then takes
 * their seat (a private player token) with their signed-in session, and the game's verdict goes back
 * to the escrow to be checked against the chain, signed and relayed.
 */
export class Lobby {
  /** Escrow match id → the game made for it and each wallet's seat (memory only). */
  readonly tables = new Map<string, { game: StakedGame; id: string; seats: Record<string, string> }>();
  #ended: ((game: StakedGame, id: string) => void)[] = [];
  constructor(readonly escrow: Escrow, private games: StakedGames) {
    escrow.onJoined((c) => this.#deal(c));
  }
  /** Called the moment a staked game has its verdict (live betting closes its markets at once). */
  onEnded(f: (game: StakedGame, id: string) => void): void { this.#ended.push(f); }
  #deal(c: Challenge): void {
    // a game is dealt once per match, ever: one dealt before a restart ends as a draw (escrow.ts), never again
    if (this.tables.has(c.matchId) || !c.playerB || c.outcome || c.closed || c.dealtAt) return;
    const a = { wallet: c.creator, name: c.name }, b = { wallet: c.playerB, name: c.nameB ?? "" };
    const onResult = (r: Result) => {
      void this.escrow.finish(c.matchId, r);
      const t = this.tables.get(c.matchId);
      if (t) for (const f of this.#ended) try { f(t.game, t.id); } catch (e) { console.error("lobby ended", e); }
    };
    const t = c.game === "pinball"
      ? this.games.pinball({ escrow: c.matchId, currency: c.token, stake: Number(formatUnits(BigInt(c.stake), 18)), a, b, onResult })
      : c.game === "pool"
        ? this.games.pool({ escrow: c.matchId, currency: c.token, stake: formatUnits(BigInt(c.stake), 18), a, b, onResult })
        : c.game === "poker"
        ? this.#poker()({ escrow: c.matchId, currency: c.token, stake: formatUnits(BigInt(c.stake), 18), a, b, onResult })
        : this.games.chess({ escrow: c.matchId, tc: (c.tc ?? "3+2") as TimeControl, currency: c.token, stake: formatUnits(BigInt(c.stake), 18), a, b, onResult });
    this.tables.set(c.matchId, { game: c.game, ...t });
    this.escrow.dealt(c.matchId);
  }
  #poker() { if (!this.games.poker) throw new Error("this lobby deals no poker"); return this.games.poker; }
  /** A player's seat at their staked game: only for the wallet that deposited as player A or B. */
  seat(matchId: string, wallet: string | null): { game: StakedGame; id: string; player: string } | { waiting: true } {
    if (!wallet) throw new GameError(401, "Sign in with your wallet to take your seat.");
    const c = this.escrow.challenges.get(matchId), me = wallet.toLowerCase();
    if (!c || (me !== c.creator && me !== c.playerB)) throw new GameError(404, "No such match for this wallet.");
    const t = this.tables.get(matchId);
    if (!t) { if (c.outcome || c.closed) throw new GameError(409, "This game is over."); return { waiting: true }; }
    return { game: t.game, id: t.id, player: t.seats[me]! };
  }
  /**
   * Every staked match of this wallet still to be played, for any page it is on (a reload, another
   * tab, the creator who left, the joiner whose wallet batched approve and join): its open or pending
   * challenges, the ones it just joined (the chain has not confirmed it yet), and the joined ones
   * with its own seat once the game is dealt, and when the game is void if both are not there.
   */
  mine(wallet: string | null) {
    if (!wallet) return [];
    const me = wallet.toLowerCase(), joining = new Set(this.escrow.joining(me));
    return [...this.escrow.challenges.values()].flatMap((c) => {
      const status = this.escrow.status(c);
      const ours = c.creator === me || c.playerB === me || (status === "open" && joining.has(c.matchId));
      // and a decided one whose payout the player may have to send themselves (the relay failed or is slow)
      const claim = status === "finished" && this.escrow.claimable(c) && (c.outcome?.draw || c.outcome?.winner === me);
      if (!ours || (!claim && !["pending", "open", "joined"].includes(status))) return [];
      const t = status === "joined" ? this.tables.get(c.matchId) : undefined;
      return [{ ...this.escrow.view(c, me), joining: status === "open" && c.creator !== me, seat: t?.seats[me] ? { game: t.game, id: t.id, player: t.seats[me]! } : null, startBy: c.dealtAt ? c.dealtAt + STAKED_SHOW_MS : null }];
    }).sort((a, b) => (b.joinedAt ?? b.openedAt ?? 0) - (a.joinedAt ?? a.openedAt ?? 0)).slice(0, 10);
  }
}

let lobby: Lobby | null = null;
/** The live lobby, made on the first request (the vault holds the signer). */
export function live(vault: Vault): Lobby {
  if (!lobby) {
    lobby = new Lobby(liveEscrow(vault), { pinball: pinballStaked, chess: (o) => chess.createStaked(o), pool: (o) => pool.createStaked(o), poker: (o) => poker.createStaked(o) });
    lobby.escrow.start();
  }
  return lobby;
}
/** Tests and local runs: another lobby (an escrow on a fake chain, escrow.fake.ts) in place of the live one. */
export function setLobby(l: Lobby | null): void { lobby = l; }
const MATCH_ID = /^0x[0-9a-f]{64}$/;

/** /api/games/*: the escrow, the challenge lobby, seats and signatures. Call before the API fallback. */
export async function gamesRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/games/")) return false;
  const { json, body, limited, owner, url } = ctx;
  const reply = (status: number, value: unknown) => { json(res, status, value); return true; };
  try {
    const l = live(ctx.vault), escrow = l.escrow;
    if (p === "/api/games/admin" && req.method === "GET") {
      if (limited(req, "admin", 60, 60_000)) return reply(429, { error: "slow down" });
      if (!isAdmin(req)) return reply(401, { error: "wrong admin token" });
      const chain = await escrow.chainState(true).catch(() => null), keeper = keeperAccount(ctx.vault).address;
      return reply(200, { escrow: ESCROW, serverSigner: escrow.serverSigner, signer: chain?.signer ?? null, paused: chain?.paused ?? null, live: chain?.live ?? false,
        keeper, keeperEth: (await eth.getBalance({ address: keeper }).catch(() => 0n)).toString(), cursor: escrow.cursor.toString() });
    }
    // the lounge: every open game, waiting counts, open challenges and live games, with its own limits
    if (await loungeRoutes(req, res, p, { json, body, limited, owner, challenges: () => escrow.open(undefined, null) })) return true;
    if (limited(req, "games", 240, 60_000)) return reply(429, { error: "Slow down" });
    if (p === "/api/games/escrow" && req.method === "GET") {
      const chain = await escrow.chainState().catch(() => null);
      const lim = (t: "IMD" | "SHIFT") => chain ? { min: formatUnits(chain.limits[t].min, 18), max: formatUnits(chain.limits[t].max, 18) } : null;
      return reply(200, { address: ESCROW, live: chain?.live ?? false, signer: chain?.signer ?? null, serverSigner: escrow.serverSigner, paused: chain?.paused ?? null, limits: { IMD: lim("IMD"), SHIFT: lim("SHIFT") }, fee: "5%" });
    }
    if (p === "/api/games/challenges" && req.method === "GET") {
      escrow.poke();
      const game = url.searchParams.get("game") ?? undefined;
      return reply(200, { challenges: escrow.open(game, owner) });
    }
    // the signed-in wallet's staked matches still to be played, with its seat once dealt: every page polls this
    if (p === "/api/games/mine" && req.method === "GET") {
      if (owner) escrow.poke();
      return reply(200, { matches: l.mine(owner), now: Date.now() });
    }
    if (p === "/api/games/challenge" && req.method === "POST") {
      if (limited(req, "games-challenge", 20, 600_000)) return reply(429, { error: "Too many challenges. Try again shortly." });
      return reply(200, await escrow.create(owner, await body(req, 2_000)));
    }
    // the signed result, for one of the two players to submit with settle() from their own wallet
    const result = /^\/api\/games\/escrow\/(0x[0-9a-fA-F]{64})\/result$/.exec(p);
    if (result && req.method === "GET") {
      if (limited(req, "games-action", 60, 60_000)) return reply(429, { error: "Slow down" });
      return reply(200, await escrow.signature(result[1]!.toLowerCase(), owner));
    }
    const route = /^\/api\/games\/challenge\/(0x[0-9a-fA-F]{64})(?:\/(accept|seat|signature))?$/.exec(p);
    if (!route) return reply(404, { error: "No such games route" });
    const matchId = route[1]!.toLowerCase(), action = route[2];
    if (!MATCH_ID.test(matchId)) return reply(404, { error: "No such match" });
    if (!action && req.method === "GET") {
      escrow.poke();
      const c = escrow.challenges.get(matchId);
      return c ? reply(200, escrow.view(c, owner)) : reply(404, { error: "No such match" });
    }
    if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
    if (limited(req, "games-action", 60, 60_000)) return reply(429, { error: "Slow down" });
    if (action === "accept") {
      const b = await body(req, 2_000);
      return reply(200, escrow.view(escrow.intend(matchId, owner, String(b.name ?? "")), owner));
    }
    if (action === "seat") { escrow.poke(); return reply(200, l.seat(matchId, owner)); }
    if (action === "signature") return reply(200, await escrow.signature(matchId, owner));
    return reply(404, { error: "No such games route" });
  } catch (err) {
    if (err instanceof GameError) return reply(err.status, { error: err.message });
    return reply(400, { error: (err as Error).message.split("\n")[0] });
  }
}
