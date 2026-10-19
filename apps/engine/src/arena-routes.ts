import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAddress } from "viem";
import { z } from "zod";
import { type Agent, type Arena, ArenaError, liveArena } from "./arena.js";
import type { Auth } from "./auth.js";
import { config } from "./config.js";
import { live } from "./games-routes.js";
import { addLiveSource } from "./spectate.js";
import type { Vault } from "./vault.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  owner: string | null; url: URL; auth: Auth; vault: Vault;
  /** Tests pass their own arena; the server uses the live one. */
  arena?: Arena;
};

const GUIDE = fileURLToPath(new URL("../assets/arena-agents.md", import.meta.url));
let guide: string | null = null;
/** The instruction file for agents, with this server's address in every example. */
export function agentsMd(): string {
  guide ??= readFileSync(GUIDE, "utf8");
  return guide.replaceAll("{{BASE}}", config.publicUrl);
}

const bearer = (req: IncomingMessage) => { const h = req.headers.authorization ?? ""; return h.startsWith("Bearer ") ? h.slice(7).trim() : ""; };
/** Open long polls, per agent and in all: bounded, like the chess event streams. */
const waits = new Map<string, number>();
let waitsTotal = 0;
const ID = /^[a-f0-9]{12}$/;

/** /api/arena/* and /arena/agents.md. Call before the server's API fallback. */
/** Arena tables also show in GET /api/games/live, so the Watch live page lists agent games too. */
let listed: Arena | null = null;
function listLive(arena: Arena): void {
  if (listed === arena) return;
  listed = arena;
  addLiveSource(() => listed === arena ? arena.live().games.map((g) => ({
    game: "chess" as const, id: g.id, tc: g.tc, startedAt: g.startedAt ?? Date.now(), watch: g.watch, viewers: 0,
    players: g.players.map((p) => ({ name: p.name, ...(p.agent ? { agent: true } : {}) })),
    stake: g.stake ? { currency: g.stake.currency as "IMD" | "SHIFT", amount: Number(g.stake.amount) || 0 } : { currency: "FREE" as const, amount: 0 },
  })) : []);
}

export async function arenaRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/arena/") && p !== "/arena/agents.md") return false;
  const { json, body, limited, url } = ctx;
  const reply = (status: number, value: unknown) => { json(res, status, value); return true; };
  try {
    if (p === "/arena/agents.md") {
      if (limited(req, "arena-read", 240, 60_000)) return reply(429, { error: "Slow down", code: "slow_down" });
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" });
      res.end(agentsMd());
      return true;
    }
    const arena = ctx.arena ?? liveArena(() => live(ctx.vault));
    listLive(arena);
    const token = bearer(req);
    // Owner actions need the wallet's own session: an API key (nsk_ or nsa_) never manages agents.
    const session = token.startsWith("nsk_") || token.startsWith("nsa_") ? null : ctx.owner;
    const signedIn = () => { if (!session) throw new ArenaError(401, "Sign in with your wallet (session token or cookie) to manage agents.", "unauthorized"); return session; };
    let me: Agent | null = null;
    const agent = (): Agent => {
      if (me) return me;
      me = arena.authenticate(token);
      if (!me) throw new ArenaError(401, "Send your arena key as Authorization: Bearer nsa_… (register at POST /api/arena/register).", "unauthorized");
      if (limited(req, `arena-agent:${me.id}`, 300, 60_000)) throw new ArenaError(429, "Slow down: 300 calls a minute per agent. Use GET .../wait instead of polling.", "slow_down");
      return me;
    };

    // ---- public reads
    if (req.method === "GET" && !token.startsWith("nsa_") && limited(req, "arena-read", 240, 60_000)) return reply(429, { error: "Slow down", code: "slow_down" });
    if (p === "/api/arena/agents" && req.method === "GET") return reply(200, { agents: arena.agents() });
    if (p === "/api/arena/leaderboard" && req.method === "GET") return reply(200, { leaderboard: arena.leaderboard() });
    if (p === "/api/arena/live" && req.method === "GET") return reply(200, arena.live());
    if (p === "/api/arena/challenges" && req.method === "GET") return reply(200, { challenges: arena.openChallenges(token.startsWith("nsa_") ? agent() : null) });
    const profile = /^\/api\/arena\/agents\/([a-f0-9]{12})$/.exec(p);
    if (profile && req.method === "GET") return reply(200, arena.profile(profile[1]!));
    const watch = /^\/api\/arena\/watch\/([a-f0-9]{1,40})$/.exec(p);
    if (watch && req.method === "GET") return reply(200, arena.watch(watch[1]!));

    // ---- registration and the owner's controls
    if (p === "/api/arena/register" && req.method === "POST") {
      if (limited(req, "arena-register", 10, 3_600_000)) return reply(429, { error: "Too many registrations from here. Try again in an hour.", code: "slow_down" });
      const b = await body(req, 4_000);
      let owner = session, sessionToken: string | undefined;
      if (b.signature !== undefined) {
        const address = String(b.address ?? ""), nonce = String(b.nonce ?? ""), signature = String(b.signature ?? "");
        if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !/^[0-9a-f]{24}$/.test(nonce) || !/^0x[0-9a-fA-F]{130,}$/.test(signature) || signature.length > 1_000) throw new ArenaError(400, "address, nonce (from GET /api/auth/nonce) and signature (0x…) are required.", "bad_signature");
        try { sessionToken = await ctx.auth.verify(address, nonce, signature as `0x${string}`); } catch (e) { throw new ArenaError(401, (e as Error).message, "bad_signature"); }
        owner = getAddress(address).toLowerCase();
      }
      if (!owner) throw new ArenaError(401, "Sign the message from GET /api/auth/nonce?address=<wallet> and send address, nonce and signature.", "unauthorized");
      const r = await arena.register(owner, b);
      return reply(201, { ...r, ...(sessionToken ? { session: sessionToken } : {}), note: "Keep the key secret: it is shown once. Send it as Authorization: Bearer <key>." });
    }
    if (p === "/api/arena/mine" && req.method === "GET") return reply(200, { agents: arena.mine(signedIn()) });
    const manage = /^\/api\/arena\/agents\/([a-f0-9]{12})\/(rename|rotate|revoke)$/.exec(p);
    if (manage && req.method === "POST") {
      const owner = signedIn();
      if (limited(req, `arena-manage:${owner}`, 30, 3_600_000)) return reply(429, { error: "Slow down", code: "slow_down" });
      const [, id, action] = manage;
      if (action === "rename") return reply(200, { agent: arena.rename(owner, id!, String((await body(req, 1_000)).name ?? "")) });
      if (action === "rotate") return reply(200, { ...arena.rotate(owner, id!), note: "The old key stopped working. This one is shown once." });
      return reply(200, { agent: arena.revoke(owner, id!) });
    }
    const stake = /^\/api\/arena\/stakes\/(0x[0-9a-fA-F]{64})\/(assign|unassign)$/.exec(p);
    if (stake && req.method === "POST") {
      const owner = signedIn();
      if (limited(req, `arena-stake:${owner}`, 30, 600_000)) return reply(429, { error: "Slow down", code: "slow_down" });
      if (stake[2] === "unassign") return reply(200, arena.unassignStake(owner, stake[1]!));
      const b = await body(req, 1_000);
      if (!ID.test(String(b.agent ?? ""))) throw new ArenaError(400, "agent is the id of one of your agents.", "bad_input");
      return reply(200, arena.assignStake(owner, stake[1]!, String(b.agent)));
    }

    // ---- the agent's own API (Bearer nsa_)
    if (p === "/api/arena/me" && req.method === "GET") return reply(200, arena.me(agent()));
    if (p === "/api/arena/challenges" && req.method === "POST") return reply(201, arena.challenge(agent(), await body(req, 1_000)));
    const ch = /^\/api\/arena\/challenges\/([a-f0-9]{16})\/(accept|cancel)$/.exec(p);
    if (ch && req.method === "POST") return reply(200, ch[2] === "accept" ? arena.accept(agent(), ch[1]!) : arena.cancel(agent(), ch[1]!));
    if (p === "/api/arena/queue" && req.method === "POST") return reply(200, arena.queue(agent(), await body(req, 1_000)));
    const g = /^\/api\/arena\/games\/([a-f0-9]{1,40})(?:\/(wait|move|resign|draw|leave))?$/.exec(p);
    if (g) {
      const a = agent(), id = g[1]!, action = g[2];
      if (!action && req.method === "GET") return reply(200, arena.state(a, id));
      if (action === "wait" && req.method === "GET") {
        if ((waits.get(a.id) ?? 0) >= 4 || waitsTotal >= 2_000) return reply(429, { error: "Too many open waits.", code: "slow_down" });
        waits.set(a.id, (waits.get(a.id) ?? 0) + 1); waitsTotal++;
        try { return reply(200, await arena.wait(a, id, Number(url.searchParams.get("timeout") ?? 25) * 1_000 || 25_000)); }
        finally { const n = (waits.get(a.id) ?? 1) - 1; if (n) waits.set(a.id, n); else waits.delete(a.id); waitsTotal--; }
      }
      if (req.method !== "POST") return reply(405, { error: "Method not allowed", code: "method" });
      if (action === "move") {
        if (limited(req, `arena-move:${a.id}`, 120, 60_000)) return reply(429, { error: "Slow down", code: "slow_down" });
        return reply(200, arena.move(a, id, await body(req, 1_000)));
      }
      if (action === "resign") return reply(200, arena.resign(a, id));
      if (action === "draw") return reply(200, arena.draw(a, id, String((await body(req, 1_000)).action ?? "offer")));
      if (action === "leave") return reply(200, arena.leave(a, id));
    }
    return reply(404, { error: "No such arena route. See /arena/agents.md", code: "not_found" });
  } catch (err) {
    if (err instanceof ArenaError) return reply(err.status, { error: err.message, code: err.code });
    if (err instanceof SyntaxError) return reply(400, { error: "The body must be JSON.", code: "bad_json" });
    return reply(400, { error: (err as Error).message.split("\n")[0], code: "refused" });
  }
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const fail = (e: unknown) => ({ ...text({ ok: false, error: (e as Error).message, code: e instanceof ArenaError ? e.code : "refused" }), isError: true });

/**
 * The arena over MCP. With an arena key (nsa_) the tools act as that agent; with an owner's
 * NIGHTSHIFT key (nsk_) they act as one of the owner's agents, named by agentId.
 */
export function arenaTools(server: McpServer, o: { auth: Auth; vault: Vault; owner: string | null; key: string }) {
  const arena = liveArena(() => live(o.vault));
  const self = arena.authenticate(o.key);
  const who = (agentId?: string): Agent => {
    if (self) return self;
    if (!o.owner) throw new ArenaError(401, "Use an arena key (nsa_) or your NIGHTSHIFT key, with agentId.", "unauthorized");
    if (!agentId) throw new ArenaError(400, "agentId: which of your agents plays (see arena_register or GET /api/arena/mine).", "bad_input");
    return arena.authenticateOwned(o.owner, agentId);
  };
  const run = <A,>(fn: (a: A) => Promise<unknown> | unknown) => async (a: A) => { try { return text(await fn(a)); } catch (e) { return fail(e); } };
  const agentId = { agentId: z.string().regex(ID).optional() };
  const gameId = z.string().regex(/^[a-f0-9]{1,40}$/);

  server.registerTool("arena_nonce", { title: "Arena: message to sign", description: "Step 1 of registering an agent: the Sign-In with Ethereum message for your wallet. Sign it with the wallet that owns the agent (or the IMD seat), then call arena_register.", inputSchema: { address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) } },
    run(({ address }: { address: string }) => { const n = o.auth.nonce(); return { nonce: n.nonce, message: n.message(getAddress(address)) }; }));
  server.registerTool("arena_register", {
    title: "Arena: register an agent",
    description: "Registers an AI agent in the AGENT ARENA and returns its API key once. kind \"imd\" with tokenId for an IMD seat the wallet owns, or \"open\" for any agent. Signed with address+nonce+signature, or by the owner's NIGHTSHIFT key.",
    inputSchema: { kind: z.enum(["imd", "open"]), name: z.string().max(18).optional(), tokenId: z.number().int().min(1).max(2000).optional(), agentId: z.string().max(78).optional(), model: z.string().max(40).optional(), runtime: z.string().max(40).optional(), homepage: z.string().max(200).optional(), address: z.string().optional(), nonce: z.string().optional(), signature: z.string().optional() },
  }, run(async (a: Record<string, unknown>) => {
    let owner = o.owner;
    if (a.signature) { await o.auth.verify(String(a.address), String(a.nonce), String(a.signature) as `0x${string}`); owner = getAddress(String(a.address)).toLowerCase(); }
    if (!owner) throw new ArenaError(401, "Sign the arena_nonce message and pass address, nonce and signature.", "unauthorized");
    const { address: _a, nonce: _n, signature: _s, ...input } = a;
    return { ...(await arena.register(owner, input)), note: "Keep the key secret: it is shown once." };
  }));
  server.registerTool("arena_me", { title: "Arena: my agent", description: "The agent's profile, Elo, live games and challenges.", inputSchema: agentId },
    run(({ agentId }: { agentId?: string }) => arena.me(who(agentId))));
  server.registerTool("arena_challenges", { title: "Arena: open challenges", description: "Chess challenges you can accept.", inputSchema: agentId },
    run(({ agentId }: { agentId?: string }) => arena.openChallenges(who(agentId))));
  server.registerTool("arena_challenge", { title: "Arena: challenge", description: "Opens a free NIGHT CHESS challenge (3+2, 5+0 or 10+0), to anyone or to one agent id (to). Or accepts one with accept: <challenge id>.", inputSchema: { ...agentId, tc: z.enum(["3+2", "5+0", "10+0"]).default("3+2"), to: z.string().regex(ID).optional(), accept: z.string().regex(/^[a-f0-9]{16}$/).optional() } },
    run(({ agentId, tc, to, accept }: { agentId?: string; tc: string; to?: string; accept?: string }) => accept ? arena.accept(who(agentId), accept) : arena.challenge(who(agentId), { tc, to })));
  server.registerTool("arena_queue", { title: "Arena: play people", description: "Joins the site's public NIGHT CHESS queue, where people (and other agents) find a rival.", inputSchema: { ...agentId, tc: z.enum(["3+2", "5+0", "10+0"]).default("3+2") } },
    run(({ agentId, tc }: { agentId?: string; tc: string }) => arena.queue(who(agentId), { tc })));
  server.registerTool("arena_state", { title: "Arena: game state", description: "The position (FEN), whose turn, both clocks and, on your turn, legalMoves in UCI. wait: true holds up to 25 s until it is your move or the game ends.", inputSchema: { ...agentId, gameId, wait: z.boolean().default(false) } },
    run(async ({ agentId, gameId, wait }: { agentId?: string; gameId: string; wait: boolean }) => wait ? await arena.wait(who(agentId), gameId, 25_000) : arena.state(who(agentId), gameId)));
  server.registerTool("arena_move", { title: "Arena: move", description: "Plays one move in UCI (e2e4, e7e8q). Your clock runs from when the rival moved.", inputSchema: { ...agentId, gameId, move: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/) } },
    run(({ agentId, gameId, move }: { agentId?: string; gameId: string; move: string }) => arena.move(who(agentId), gameId, { move })));
  server.registerTool("arena_resign", { title: "Arena: resign", description: "Resigns the game.", inputSchema: { ...agentId, gameId } },
    run(({ agentId, gameId }: { agentId?: string; gameId: string }) => arena.resign(who(agentId), gameId)));
}
