import type { IncomingMessage, ServerResponse } from "node:http";
import { formatUnits } from "viem";
import { isAdmin } from "./admin.js";
import { chess, type TimeControl } from "./chess.js";
import { createStaked as pinballStaked } from "./pinball.js";
import { type Challenge, ESCROW, Escrow, GameError, liveEscrow } from "./escrow.js";
import { keeperAccount } from "./keeper.js";
import { eth } from "./chain.js";
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
};

/**
 * The challenge lobby shared by Space Pinball and NIGHT CHESS. When the escrow sees a Joined event
 * that matches a challenge exactly, the game is made for those two wallets; each player then takes
 * their seat (a private player token) with their signed-in session, and the game's verdict goes back
 * to the escrow to be checked against the chain, signed and relayed.
 */
export class Lobby {
  /** Escrow match id → the game made for it and each wallet's seat (memory only). */
  readonly tables = new Map<string, { game: "pinball" | "chess"; id: string; seats: Record<string, string> }>();
  constructor(readonly escrow: Escrow, private games: StakedGames) {
    escrow.onJoined((c) => this.#deal(c));
  }
  #deal(c: Challenge): void {
    if (this.tables.has(c.matchId) || !c.playerB || c.outcome || c.closed) return;
    const a = { wallet: c.creator, name: c.name }, b = { wallet: c.playerB, name: c.nameB ?? "" };
    const onResult = (r: Result) => void this.escrow.finish(c.matchId, r);
    const t = c.game === "pinball"
      ? this.games.pinball({ escrow: c.matchId, currency: c.token, stake: Number(formatUnits(BigInt(c.stake), 18)), a, b, onResult })
      : this.games.chess({ escrow: c.matchId, tc: (c.tc ?? "3+2") as TimeControl, currency: c.token, stake: formatUnits(BigInt(c.stake), 18), a, b, onResult });
    this.tables.set(c.matchId, { game: c.game, ...t });
  }
  /** A player's seat at their staked game: only for the wallet that deposited as player A or B. */
  seat(matchId: string, wallet: string | null): { game: "pinball" | "chess"; id: string; player: string } | { waiting: true } {
    if (!wallet) throw new GameError(401, "Sign in with your wallet to take your seat.");
    const c = this.escrow.challenges.get(matchId), me = wallet.toLowerCase();
    if (!c || (me !== c.creator && me !== c.playerB)) throw new GameError(404, "No such match for this wallet.");
    const t = this.tables.get(matchId);
    if (!t) { if (c.outcome || c.closed) throw new GameError(409, "This game is over."); return { waiting: true }; }
    return { game: t.game, id: t.id, player: t.seats[me]! };
  }
}

let lobby: Lobby | null = null;
/** The live lobby, made on the first request (the vault holds the signer). */
export function live(vault: Vault): Lobby {
  if (!lobby) {
    lobby = new Lobby(liveEscrow(vault), { pinball: pinballStaked, chess: (o) => chess.createStaked(o) });
    lobby.escrow.start();
  }
  return lobby;
}
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
    if (p === "/api/games/challenge" && req.method === "POST") {
      if (limited(req, "games-challenge", 20, 600_000)) return reply(429, { error: "Too many challenges. Try again shortly." });
      return reply(200, await escrow.create(owner, await body(req, 2_000)));
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
