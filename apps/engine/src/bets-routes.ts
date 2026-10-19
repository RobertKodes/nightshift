import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { type Arena, liveArena } from "./arena.js";
import { type ArenaParties, type ArenaSeat, type Board, BETS_ABI, Bets, type BetsReader, type CreateCall, type Lookup, type SettleCall, fromChess, fromPinball } from "./bets.js";
import { eth } from "./chain.js";
import { type ChessGames, chess } from "./chess.js";
import { config } from "./config.js";
import { GameError, gameSignerAccount } from "./escrow.js";
import { live as lobby } from "./games-routes.js";
import { keeperAccount, keeperWrite } from "./keeper.js";
import { betState } from "./pinball.js";
import type { Vault } from "./vault.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  owner: string | null; url: URL; vault: Vault;
  /** Tests pass their own pool; the server uses the live one. */
  bets?: Bets;
};

const chessOn = (board: Board, id: string, games: ChessGames, arena: ArenaParties | null) => { try { return fromChess(board, id, games.watchView(id), games.betInfo(id), arena, Date.now()); } catch { return null; } };

/** Each agent's standing for betting (arena.ts standing(), over every stored game), read at most once a minute. */
const standing = new Map<string, { at: number; v: ArenaSeat | null }>();
function seatOf(arena: Arena, agentId: string): ArenaSeat | null {
  const hit = standing.get(agentId);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  let v: ArenaSeat | null = null;
  try { v = arena.standing(agentId); } catch { /* no such agent */ }
  if (standing.size > 2_000) standing.clear();
  standing.set(agentId, { at: Date.now(), v });
  return v;
}
/** arena.ts betParties(), with the agent behind each colour. */
function partiesOf(arena: Arena, id: string): ArenaParties | null {
  const base = arena.betParties(id);
  if (!base) return null;
  let players: { color: string; agent: string | null }[] = [];
  try { const w = arena.watch(id); if ("players" in w) players = w.players ?? []; } catch { /* closed */ }
  const at = (c: "w" | "b") => { const p = players.find((x) => x.color === c && x.agent); return p ? seatOf(arena, p.agent!) : null; };
  return { ...base, seats: { w: at("w"), b: at("b") } };
}
/**
 * Where each match is: the site's NIGHT CHESS, Space Pinball, or an arena table. An arena table
 * played on the site's board (an agent in the public queue, or a staked seat) is the same game as
 * /games/chess?watch=<id>, so it is one market, under "chess". Either way the arena says who owns
 * the agents at the table (for eligibility, and the wallets that may not bet).
 */
export function liveLookup(vault: Vault): Lookup {
  return (game, id) => {
    if (game === "pinball") { const s = betState(id); return s ? fromPinball(id, s, Date.now()) : null; }
    const arena = liveArena(() => lobby(vault));
    if (game === "arena") {
      const b = arena.boardOf(id);
      return b ? chessOn(b.where === "arena" ? "arena" : "chess", id, b.games, partiesOf(arena, id)) : null;
    }
    return chessOn("chess", id, chess, partiesOf(arena, id));
  };
}

let current: Bets | null = null;
/** The live pool, made on first use: the vault's game signer (as the escrow's), the keeper paying gas for its relays. */
export function liveBets(vault: Vault): Bets {
  if (!current) {
    const pool = config.betPool.address.toLowerCase() as Address;
    const send = async (f: (account: ReturnType<typeof keeperAccount>) => Promise<Hex>) => {
      const account = keeperAccount(vault);
      const gas = await eth.getBalance({ address: account.address });
      if (gas < 10n ** 15n) throw new Error(`the keeper ${account.address} has no ETH for gas`);
      return f(account);
    };
    // settle() goes privately (Flashbots Protect, as the keeper's burn): seen in the public mempool,
    // it would tell anyone still holding a ticket the result, with time to get a bet in ahead of it
    const relaySettle = (r: SettleCall) => send(async (account) => {
      const { request } = await eth.simulateContract({ account, address: pool, abi: BETS_ABI, functionName: "settle", args: [r.marketId, r.outcome, r.deadline, r.signature] });
      return keeperWrite(account, request, true);
    });
    const relayCreate = (r: CreateCall) => send(async (account) => {
      const { request } = await eth.simulateContract({ account, address: pool, abi: BETS_ABI, functionName: "createMarket", args: [r.marketId, r.token, r.closesAt, r.game, r.signature] });
      return keeperWrite(account, request);
    });
    const receipt = async (hash: Hex) => (await eth.waitForTransactionReceipt({ hash, timeout: 600_000 })).status;
    // every change of a chess game (its end included) reaches its markets at once; staked pinball ends through the lobby
    const watch = (board: Board, id: string, f: () => void) => {
      if (board === "pinball") return null;
      const games = board === "arena" ? liveArena(() => lobby(vault)).boardOf(id)?.games : chess;
      return games ? games.watch(id, f) : null;
    };
    const bets = new Bets({ address: config.betPool.address, fromBlock: BigInt(config.betPool.block), file: join(config.dataDir, "bets.json"), client: eth as unknown as BetsReader,
      signer: gameSignerAccount(vault), lookup: liveLookup(vault), watch, relaySettle, relayCreate, receipt });
    current = bets;
    if (bets.address) lobby(vault).onEnded((game, id) => void bets.ended(game, id).catch((e) => console.error("bets ended", (e as Error).message)));
    bets.start();
  }
  return current;
}

/** /api/bets/*: whether betting is live, a match's market, tickets, and signed outcomes. */
export async function betsRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/bets/")) return false;
  const { json, body, limited, owner, url } = ctx;
  const reply = (status: number, value: unknown) => { json(res, status, value); return true; };
  try {
    const bets = ctx.bets ?? liveBets(ctx.vault);
    if (limited(req, "bets", 240, 60_000)) return reply(429, { error: "Slow down" });
    if (p === "/api/bets/status" && req.method === "GET") return reply(200, await bets.status());
    if (p === "/api/bets/market" && req.method === "GET") {
      bets.poke();
      return reply(200, await bets.view(url.searchParams.get("game") ?? "", (url.searchParams.get("id") ?? "").toLowerCase(), owner));
    }
    if (p === "/api/bets/ticket" && req.method === "POST") {
      if (limited(req, "bets-ticket", 30, 60_000)) return reply(429, { error: "Too many tickets. Wait a few seconds." });
      return reply(200, await bets.ticket(owner, await body(req, 2_000)));
    }
    if (p === "/api/bets/settlement" && req.method === "GET") return reply(200, await bets.settlement(url.searchParams.get("marketId") ?? ""));
    return reply(404, { error: "No such bets route" });
  } catch (err) {
    if (err instanceof GameError) return reply(err.status, { error: err.message });
    return reply(400, { error: (err as Error).message.split("\n")[0] });
  }
}
