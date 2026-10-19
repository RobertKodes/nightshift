import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Chess, type Move } from "chess.js";
import { parseAbi } from "viem";
import { writeAtomic } from "./atomic.js";
import { eth } from "./chain.js";
import { CONTROLS, ChessGames, type TimeControl, chess as publicChess } from "./chess.js";
import { config } from "./config.js";
import type { Lobby } from "./games-routes.js";

/**
 * The AGENT ARENA: AI agents register, play NIGHT CHESS and play staked duels for their owners.
 * - An agent registers with a wallet signature (Sign-In with Ethereum, the site's own) and gets an
 *   API key; only its SHA-256 is kept. "imd" agents are IMD seats (an NFT bound to an ERC-8004 agent
 *   id): the signing wallet must own the seat. "open" agents are any other agent, owned by a wallet.
 * - Every move goes through the same ChessGames code as the site's games: legality, turns and clocks
 *   are the server's, never the agent's. Free agent-vs-agent games run on their own board instance;
 *   agents meet people in the public NIGHT CHESS queue; staked games are the lobby's (GameEscrow):
 *   the owner opens or accepts from their wallet and assigns the seat, the agent never holds keys.
 * - An agent counts as at the table while it calls the API; one silent for a minute is treated like
 *   a closed browser, so the game's own abandonment rule applies.
 */

export const IMD_SEATS = "0x0000ec93127baa929e58e97dd0095a2bfb38ec1d";
export const IMD_ADAPTER = "0xde152afb7db5373f34876e1499fbd893a82dd336";
export const IMD_IDENTITY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const MAX_SEAT = 2000;
/** An agent with no call for this long stops counting as connected (the game's 45 s abandonment rule then runs). */
export const PRESENCE_MS = 60_000;
const CHALLENGE_MS = 10 * 60_000;
const MAX_AGENTS_PER_OWNER = 25;
const MAX_TABLES_PER_AGENT = 3;
const RESERVED = /^(nightshift|admin|imd|nightowl|owl|system|moderator|anthropic|claude|openai)$/i;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{2,17}$/;
const LABEL = /^[\w .:/+@()-]{0,40}$/;

export class ArenaError extends Error { constructor(readonly status: number, message: string, readonly code = "bad_request") { super(message); } }

export type SeatInfo = { tokenId: number; agentId: string | null; owner: string | null; online: boolean; attempts: number; accepted: number; rejected: number; runtimes: string[] };
/** How a seat is read: its owner (on chain), its ERC-8004 agent id and its IMD record (api.imd.fun). */
export type SeatReader = (tokenId: number) => Promise<SeatInfo | null>;

type Imd = { online: boolean; attempts: number; accepted: number; rejected: number; runtimes: string[]; at: number };
export type Agent = {
  id: string; kind: "imd" | "open"; name: string; owner: string; model: string; runtime: string; homepage: string;
  seat: { tokenId: number; agentId: string } | null; imd: Imd | null;
  keyHash: string; keyId: string; createdAt: number; lastSeenAt: number | null; revokedAt: number | null;
  elo: number; games: number; wins: number; losses: number; draws: number;
};
type Side = { name: string; agent: string | null; elo: number };
export type GameRecord = {
  id: string; game: "chess"; where: Where; tc: TimeControl; currency: string; stake: string | null; escrow: string | null;
  startedAt: number | null; endedAt: number; white: Side; black: Side; result: "1-0" | "0-1" | "1/2-1/2"; reason: string; plies: number;
  rated: boolean; elo: Record<string, { before: number; after: number }>;
};
type Where = "arena" | "public" | "staked";
type Seat = { player: string; off: (() => void) | null; seenAt: number };
type Table = { id: string; where: Where; games: ChessGames; seats: Map<string, Seat>; createdAt: number; recorded: boolean; endedAt: number | null; waiters: Set<() => void> };
export type Challenge = { id: string; game: "chess"; tc: TimeControl; from: string; to: string | null; createdAt: number; state: "open" | "accepted" | "cancelled"; gameId: string | null };
type Stake = { matchId: string; agent: string; wallet: string; at: number };
type State = { agents: Agent[]; games: GameRecord[]; stakes: Stake[] };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const lc = (s: unknown) => String(s ?? "").toLowerCase();
const uci = (m: Pick<Move, "from" | "to" | "promotion">) => `${m.from}${m.to}${m.promotion ?? ""}`;
const noop = () => {};

/** The live reader: ownerOf on the seat collection (authoritative), the agent id and record from api.imd.fun. */
export async function imdSeat(tokenId: number): Promise<SeatInfo | null> {
  const [api, onChain] = await Promise.all([
    fetch(`https://api.imd.fun/seats/${tokenId}?work=0&reviews=0`, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } })
      .then(async (r) => r.status === 404 ? null : r.ok ? await r.json() as Record<string, unknown> : undefined).catch(() => undefined),
    eth.readContract({ address: IMD_SEATS, abi: parseAbi(["function ownerOf(uint256) view returns (address)"]), functionName: "ownerOf", args: [BigInt(tokenId)] })
      .then((a) => lc(a)).catch(() => undefined),
  ]);
  if (api === undefined && onChain === undefined) throw new ArenaError(503, "IMD seats cannot be read right now. Try again shortly.", "imd_unavailable");
  if (api === null && !onChain) return null;
  const n = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const runtimes = Array.isArray(api?.runtimes) ? (api!.runtimes as { id?: unknown; version?: unknown }[]).map((r) => String(r.id ?? r.version ?? "")).filter(Boolean).slice(0, 4) : [];
  return {
    tokenId, agentId: api?.agentId != null ? String(api.agentId) : null,
    owner: onChain ?? (api?.owner ? lc(api.owner) : null),
    online: api?.online === true, attempts: n(api?.attempts), accepted: n(api?.accepted), rejected: n(api?.rejected), runtimes,
  };
}

export class Arena {
  private db: State = { agents: [], games: [], stakes: [] };
  private byKey = new Map<string, Agent>();
  private tables = new Map<string, Table>();
  private challenges = new Map<string, Challenge>();
  private dirty = false;
  private refreshing = false;
  private readonly now: () => number;

  constructor(private o: {
    file: string | null; seats: SeatReader;
    /** Free agent-vs-agent games: their own instance, so a pairing never meets the public queue. */
    arenaChess: ChessGames;
    /** The site's NIGHT CHESS: agents meet people in its queue. */
    publicChess: ChessGames;
    /** Where the lobby deals staked games (the site's NIGHT CHESS). */
    stakedChess?: ChessGames;
    lobby?: () => Lobby;
    now?: () => number;
  }) {
    this.now = o.now ?? (() => Date.now());
    try {
      if (o.file && existsSync(o.file)) {
        const d = JSON.parse(readFileSync(o.file, "utf8")) as Partial<State>;
        this.db = { agents: Array.isArray(d.agents) ? d.agents : [], games: Array.isArray(d.games) ? d.games : [], stakes: Array.isArray(d.stakes) ? d.stakes : [] };
      }
    } catch (e) { console.error("arena state", (e as Error).message); }
    for (const a of this.db.agents) if (a.keyHash) this.byKey.set(a.keyHash, a);
  }

  private save(): void {
    this.dirty = false;
    if (!this.o.file) return;
    try { mkdirSync(dirname(this.o.file), { recursive: true }); writeAtomic(this.o.file, JSON.stringify(this.db)); } catch (e) { console.error("arena save", (e as Error).message); }
  }

  // ---- agents and keys

  private agent(id: string): Agent {
    const a = this.db.agents.find((x) => x.id === id);
    if (!a) throw new ArenaError(404, "No such agent.", "unknown_agent");
    return a;
  }
  private owned(owner: string, id: string): Agent {
    const a = this.agent(id);
    if (a.owner !== lc(owner)) throw new ArenaError(403, "This agent belongs to another wallet.", "not_owner");
    return a;
  }
  private checkName(name: string, self?: Agent): string {
    const n = name.replace(/\s+/g, " ").trim();
    if (!NAME.test(n)) throw new ArenaError(400, "Name: 3 to 18 letters, digits, spaces, dots, dashes or underscores, starting with a letter or digit.", "bad_name");
    if (RESERVED.test(n.replace(/[ ._-]/g, ""))) throw new ArenaError(400, "That name is reserved.", "bad_name");
    if (this.db.agents.some((a) => a !== self && a.name.toLowerCase() === n.toLowerCase())) throw new ArenaError(409, "That name is taken.", "name_taken");
    return n;
  }
  private issue(a: Agent): string {
    if (a.keyHash) this.byKey.delete(a.keyHash);
    const key = `nsa_${randomBytes(24).toString("base64url")}`;
    a.keyHash = sha(key); a.keyId = a.keyHash.slice(0, 12); a.revokedAt = null;
    this.byKey.set(a.keyHash, a);
    return key;
  }

  /** A new agent for a wallet that has proved itself (signature or session). The key is returned once. */
  async register(owner: string, input: Record<string, unknown>): Promise<{ agent: ReturnType<Arena["view"]>; key: string }> {
    const me = lc(owner);
    if (!/^0x[0-9a-f]{40}$/.test(me)) throw new ArenaError(401, "Sign with your wallet to register an agent.", "unauthorized");
    const kind = String(input.kind ?? "open");
    if (kind !== "imd" && kind !== "open") throw new ArenaError(400, "kind is \"imd\" (an IMD seat you own) or \"open\".", "bad_kind");
    const model = String(input.model ?? "").trim(), runtime = String(input.runtime ?? "").trim(), homepage = String(input.homepage ?? "").trim();
    if (!LABEL.test(model) || !LABEL.test(runtime)) throw new ArenaError(400, "model and runtime: up to 40 plain characters.", "bad_input");
    if (homepage) {
      let u: URL | null = null; try { u = new URL(homepage); } catch { /* checked below */ }
      if (!u || u.protocol !== "https:" || homepage.length > 200) throw new ArenaError(400, "homepage must be an https:// link (up to 200 characters).", "bad_input");
    }
    if (this.db.agents.filter((a) => a.owner === me).length >= MAX_AGENTS_PER_OWNER) throw new ArenaError(429, `One wallet can register ${MAX_AGENTS_PER_OWNER} agents.`, "too_many");
    let seat: Agent["seat"] = null, imd: Imd | null = null;
    let prior: Agent | undefined;
    if (kind === "imd") {
      const tokenId = Number(input.tokenId);
      if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > MAX_SEAT) throw new ArenaError(400, `tokenId is your IMD seat number, 1 to ${MAX_SEAT}.`, "bad_seat");
      const s = await this.o.seats(tokenId);
      if (!s || !s.owner) throw new ArenaError(404, `IMD seat #${tokenId} was not found.`, "unknown_seat");
      if (s.owner !== me) throw new ArenaError(403, `This wallet does not own IMD seat #${tokenId}.`, "seat_not_owned");
      if (!s.agentId) throw new ArenaError(409, `IMD seat #${tokenId} is not bound to an ERC-8004 agent yet. Pair it on imd.fun first.`, "seat_unbound");
      if (input.agentId !== undefined && input.agentId !== null && String(input.agentId) !== s.agentId) throw new ArenaError(409, `Seat #${tokenId} is bound to agent ${s.agentId}, not ${String(input.agentId)}.`, "agent_mismatch");
      seat = { tokenId, agentId: s.agentId };
      imd = { online: s.online, attempts: s.attempts, accepted: s.accepted, rejected: s.rejected, runtimes: s.runtimes, at: this.now() };
      prior = this.db.agents.find((a) => a.seat?.tokenId === tokenId);
      if (prior && prior.owner === me) throw new ArenaError(409, `Seat #${tokenId} is already registered by you. Rotate its key instead.`, "already_registered");
    }
    // A seat that changed hands: its arena record follows the seat, the old owner's key stops working.
    if (prior) {
      prior.owner = me; prior.seat = seat; prior.imd = imd; prior.model = model || prior.model; prior.runtime = runtime || prior.runtime; prior.homepage = homepage || prior.homepage;
      if (input.name) prior.name = this.checkName(String(input.name), prior);
      const key = this.issue(prior); this.save();
      return { agent: this.view(prior), key };
    }
    const name = this.checkName(String(input.name ?? (seat ? `IMD seat ${seat.tokenId}` : "")));
    const a: Agent = { id: randomBytes(6).toString("hex"), kind, name, owner: me, model, runtime: runtime || (imd?.runtimes[0] ?? ""), homepage, seat, imd,
      keyHash: "", keyId: "", createdAt: this.now(), lastSeenAt: null, revokedAt: null, elo: 1200, games: 0, wins: 0, losses: 0, draws: 0 };
    const key = this.issue(a);
    this.db.agents.push(a); this.save();
    return { agent: this.view(a), key };
  }

  /** The agent behind an nsa_ key, or null. */
  authenticate(token: string | null | undefined): Agent | null {
    if (!token || !token.startsWith("nsa_") || token.length > 80) return null;
    const a = this.byKey.get(sha(token));
    if (!a || a.revokedAt) return null;
    a.lastSeenAt = this.now(); this.dirty = true;
    return a;
  }
  /** One of the owner's agents, for the owner's own NIGHTSHIFT key (MCP). */
  authenticateOwned(owner: string, id: string): Agent {
    const a = this.owned(owner, id);
    if (a.revokedAt) throw new ArenaError(409, "This agent's key is revoked. Rotate it first.", "revoked");
    a.lastSeenAt = this.now(); this.dirty = true;
    return a;
  }
  rename(owner: string, id: string, name: string) { const a = this.owned(owner, id); a.name = this.checkName(name, a); this.save(); return this.view(a); }
  rotate(owner: string, id: string) { const a = this.owned(owner, id); const key = this.issue(a); this.save(); return { agent: this.view(a), key }; }
  revoke(owner: string, id: string) {
    const a = this.owned(owner, id);
    if (a.keyHash) this.byKey.delete(a.keyHash);
    a.keyHash = ""; a.revokedAt = this.now(); this.save();
    return this.view(a);
  }
  mine(owner: string) { return this.db.agents.filter((a) => a.owner === lc(owner)).map((a) => ({ ...this.view(a), keyId: a.keyId || null, revoked: !!a.revokedAt })); }

  /** What anyone may see of an agent. Never its key or key hash. */
  view(a: Agent) {
    const live = [...this.tables.values()].filter((t) => t.seats.has(a.id) && !t.endedAt).length;
    return {
      id: a.id, kind: a.kind, name: a.name, owner: a.owner, model: a.model || null, runtime: a.runtime || null, homepage: a.homepage || null,
      seat: a.seat, imd: a.imd ? { online: a.imd.online, attempts: a.imd.attempts, accepted: a.imd.accepted, rejected: a.imd.rejected, acceptance: a.imd.attempts ? Math.round((a.imd.accepted / a.imd.attempts) * 1000) / 1000 : null, runtimes: a.imd.runtimes, checkedAt: a.imd.at } : null,
      elo: a.elo, games: a.games, wins: a.wins, losses: a.losses, draws: a.draws,
      createdAt: a.createdAt, lastSeenAt: a.lastSeenAt, active: !a.revokedAt, playing: live,
      online: a.lastSeenAt !== null && this.now() - a.lastSeenAt < 5 * 60_000,
    };
  }
  agents() { return this.db.agents.filter((a) => !a.revokedAt || a.games > 0).sort((x, y) => y.elo - x.elo || y.wins - x.wins).map((a) => this.view(a)); }
  leaderboard() {
    return this.db.agents.filter((a) => a.games > 0).sort((x, y) => y.elo - x.elo || y.wins - x.wins || x.games - y.games).slice(0, 100)
      .map((a, i) => ({ rank: i + 1, id: a.id, name: a.name, kind: a.kind, seat: a.seat, elo: a.elo, games: a.games, wins: a.wins, losses: a.losses, draws: a.draws }));
  }
  profile(id: string) {
    const a = this.agent(id);
    const recent = this.db.games.filter((g) => g.white.agent === id || g.black.agent === id).slice(-20).reverse();
    return { agent: this.view(a), record: { games: a.games, wins: a.wins, losses: a.losses, draws: a.draws, elo: a.elo }, recent, live: this.live().games.filter((g) => g.players.some((p) => p.agent === id)) };
  }

  /** IMD reputation, and whether the seat still belongs to the agent's owner (one seat per call, at most every 5 minutes each). */
  async refresh(force = false): Promise<void> {
    if (this.refreshing) return;
    const due = this.db.agents.filter((a) => a.seat && !a.revokedAt && (force || !a.imd || this.now() - a.imd.at > 5 * 60_000)).sort((x, y) => (x.imd?.at ?? 0) - (y.imd?.at ?? 0))[0];
    if (!due?.seat) return;
    this.refreshing = true;
    try {
      const s = await this.o.seats(due.seat.tokenId).catch(() => undefined);
      if (s === undefined) { if (due.imd) due.imd.at = this.now(); return; }
      due.imd = { online: !!s?.online, attempts: s?.attempts ?? 0, accepted: s?.accepted ?? 0, rejected: s?.rejected ?? 0, runtimes: s?.runtimes ?? [], at: this.now() };
      // sold or moved: the old owner's key stops; the new owner registers the seat again to play it
      if (!s || (s.owner && s.owner !== due.owner)) { if (due.keyHash) this.byKey.delete(due.keyHash); due.keyHash = ""; due.revokedAt = this.now(); }
      this.save();
    } finally { this.refreshing = false; }
  }

  // ---- challenges and tables

  private activeTables(agentId: string) { return [...this.tables.values()].filter((t) => t.seats.has(agentId) && !t.endedAt); }
  private room(agentId: string) { if (this.activeTables(agentId).length >= MAX_TABLES_PER_AGENT) throw new ArenaError(429, `An agent plays at most ${MAX_TABLES_PER_AGENT} games at once. Finish one first.`, "too_many_games"); }
  private tc(v: unknown): TimeControl {
    const tc = String(v ?? "3+2");
    if (!Object.hasOwn(CONTROLS, tc)) throw new ArenaError(400, "tc is 3+2, 5+0 or 10+0.", "bad_tc");
    return tc as TimeControl;
  }
  private sweepChallenges() {
    for (const [k, c] of this.challenges) if (c.state !== "open" ? this.now() - c.createdAt > CHALLENGE_MS * 3 : this.now() - c.createdAt > CHALLENGE_MS) this.challenges.delete(k);
  }
  private challengeView(c: Challenge) {
    const from = this.db.agents.find((a) => a.id === c.from);
    return { id: c.id, game: c.game, tc: c.tc, state: c.state, from: from ? { id: from.id, name: from.name, elo: from.elo, kind: from.kind, seat: from.seat } : null, to: c.to, createdAt: c.createdAt, expiresAt: c.createdAt + CHALLENGE_MS, gameId: c.gameId };
  }

  /** A free chess challenge: open to any agent, or only to the agent named in `to`. */
  challenge(me: Agent, input: Record<string, unknown>) {
    this.sweepChallenges();
    if (String(input.game ?? "chess") !== "chess") throw new ArenaError(400, "Agents play chess for now; Space Pinball is phase 2.", "bad_game");
    const tc = this.tc(input.tc);
    const to = input.to ? String(input.to) : null;
    if (to) { const t = this.agent(to); if (t.id === me.id) throw new ArenaError(400, "An agent cannot challenge itself.", "bad_input"); }
    if ([...this.challenges.values()].filter((c) => c.from === me.id && c.state === "open").length >= 3) throw new ArenaError(429, "Three open challenges at a time. Cancel one or wait for an answer.", "too_many");
    if (this.challenges.size >= 5_000) throw new ArenaError(503, "The arena is full. Try again shortly.", "full");
    this.room(me.id);
    const c: Challenge = { id: randomBytes(8).toString("hex"), game: "chess", tc, from: me.id, to, createdAt: this.now(), state: "open", gameId: null };
    this.challenges.set(c.id, c);
    return this.challengeView(c);
  }
  openChallenges(me?: Agent | null) {
    this.sweepChallenges();
    const visible = (c: Challenge) => c.state === "open" ? !c.to || (!!me && (c.to === me.id || c.from === me.id)) : !!me && c.from === me.id && c.state === "accepted";
    return [...this.challenges.values()].filter(visible)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map((c) => this.challengeView(c));
  }
  cancel(me: Agent, id: string) {
    const c = this.challenges.get(id);
    if (!c || c.from !== me.id) throw new ArenaError(404, "No such challenge of yours.", "unknown_challenge");
    if (c.state === "open") c.state = "cancelled";
    return this.challengeView(c);
  }
  /** Accepting pairs both agents at once on the arena's own board: the game starts after a 5 s countdown. */
  accept(me: Agent, id: string) {
    this.sweepChallenges();
    const c = this.challenges.get(id);
    if (!c || c.state !== "open") throw new ArenaError(404, "That challenge is no longer open.", "unknown_challenge");
    if (c.from === me.id) throw new ArenaError(400, "That is your own challenge.", "own_challenge");
    if (c.to && c.to !== me.id) throw new ArenaError(403, "That challenge is for another agent.", "not_for_you");
    const rival = this.agent(c.from);
    if (rival.revokedAt) { c.state = "cancelled"; throw new ArenaError(410, "The challenger was revoked.", "unknown_challenge"); }
    this.room(me.id); this.room(rival.id);
    const g = this.o.arenaChess;
    const first = g.queue(rival.name, null, c.tc, true);
    const t = this.table(first.match.id, "arena", g);
    this.seat(t, rival.id, first.player);
    const second = g.queue(me.name, null, c.tc, true);
    if (second.match.id !== first.match.id) {
      // never happens with one synchronous pairing at a time; refuse rather than seat anyone wrongly
      try { g.leave(second.match.id, second.player); } catch { /* already gone */ }
      this.drop(t); try { g.leave(first.match.id, first.player); } catch { /* already gone */ }
      throw new ArenaError(503, "Could not pair the game. Try again.", "pairing_failed");
    }
    this.seat(t, me.id, second.player);
    c.state = "accepted"; c.gameId = t.id;
    return { challenge: this.challengeView(c), game: this.state_(t, me.id) };
  }
  /** The site's public NIGHT CHESS queue: the agent waits for (or meets) a person, or another queued agent. */
  queue(me: Agent, input: Record<string, unknown>) {
    const tc = this.tc(input.tc);
    this.room(me.id);
    const waiting = this.activeTables(me.id).find((t) => t.where === "public" && this.view_(t, me.id).status === "waiting");
    if (waiting) return this.state_(waiting, me.id);
    const r = this.o.publicChess.queue(me.name, me.owner, tc, true);
    const t = this.table(r.match.id, "public", this.o.publicChess);
    this.seat(t, me.id, r.player);
    return this.state_(t, me.id);
  }

  private table(id: string, where: Where, games: ChessGames): Table {
    const t = this.tables.get(id) ?? { id, where, games, seats: new Map(), createdAt: this.now(), recorded: false, endedAt: null, waiters: new Set() };
    this.tables.set(id, t);
    return t;
  }
  private seat(t: Table, agentId: string, player: string) {
    if (!t.seats.has(agentId)) t.seats.set(agentId, { player, off: null, seenAt: this.now() });
    this.present(t, agentId);
  }
  /** The agent is here: its seat counts as connected (like an open board in a browser). */
  private present(t: Table, agentId: string) {
    const s = t.seats.get(agentId)!;
    s.seenAt = this.now();
    if (s.off || t.endedAt) return;
    const off = t.games.listen(t.id, s.player, () => this.changed(t));
    // attaching can itself finish the game (a clock that ran out): then there is nothing to listen to
    if (t.endedAt) off(); else s.off = off;
  }
  private drop(t: Table) { for (const s of t.seats.values()) { s.off?.(); s.off = null; } this.tables.delete(t.id); }
  private changed(t: Table) {
    for (const w of [...t.waiters]) w();
    if (t.recorded) return;
    const any = [...t.seats.values()][0];
    if (!any) return;
    let v: ReturnType<ChessGames["get"]>;
    try { v = t.games.get(t.id, any.player); } catch { return; }
    if (v.done) this.record(t);
  }

  private view_(t: Table, agentId: string) {
    const s = t.seats.get(agentId);
    if (!s) throw new ArenaError(404, "No such game for this agent.", "unknown_game");
    try { return t.games.get(t.id, s.player); } catch { throw new ArenaError(410, "This game is over and closed. See GET /api/arena/agents/:id for the record.", "game_closed"); }
  }
  private sides(t: Table, v: ReturnType<ChessGames["get"]>) {
    const byColor = new Map<string, string>();
    for (const [agentId, s] of t.seats) { try { const c = t.games.get(t.id, s.player).you; if (c) byColor.set(c, agentId); } catch { /* closed */ } }
    return (["w", "b"] as const).map((color) => {
      const agentId = byColor.get(color) ?? null, a = agentId ? this.db.agents.find((x) => x.id === agentId) : undefined, p = v.players.find((x) => x.color === color);
      return { color, name: a?.name ?? p?.name ?? "Waiting…", agent: agentId, elo: a?.elo ?? p?.rating ?? 1200, kind: a ? a.kind : p ? "human" as const : null, seat: a?.seat ?? null, connected: p?.connected ?? false };
    });
  }
  /** Everything an agent needs to decide: the position, whose turn, the clocks, and the legal moves in UCI. */
  private state_(t: Table, agentId: string) {
    this.present(t, agentId);
    const v = this.view_(t, agentId);
    if (v.done && !t.recorded) this.record(t);
    const yourTurn = v.status === "playing" && !v.done && v.turn === v.you;
    const legal = yourTurn ? new Chess(v.fen).moves({ verbose: true }).map(uci) : [];
    const moves = (v.moves ?? []).map(uci);
    const rec = t.recorded ? this.db.games.find((g) => g.id === t.id) : undefined;
    const white = v.clocks.w, black = v.clocks.b;
    return {
      id: t.id, game: "chess" as const, where: t.where, tc: v.tc, increment: CONTROLS[v.tc].increment, currency: v.currency, stake: v.stake, escrow: v.escrow,
      status: v.status, startsInMs: v.startedAt && v.status === "countdown" ? Math.max(0, v.startedAt - v.now) : null,
      you: v.you, turn: v.turn, yourTurn, fen: v.fen, check: v.check, ply: v.ply, lastMove: v.lastMove ? uci(v.lastMove) : null, lastSan: v.lastMove?.san ?? null, moves,
      clocks: { white, black }, yourTimeMs: v.you === "w" ? white : black, rivalTimeMs: v.you === "w" ? black : white,
      legalMoves: legal, drawOffer: v.drawOffer,
      done: v.done, reason: v.reason, result: v.done ? (!v.winner ? "1/2-1/2" : v.winner === "w" ? "1-0" : "0-1") : null,
      winner: v.done ? (!v.winner ? "draw" : v.winnerIsYou ? "you" : "rival") : null,
      rated: rec?.rated ?? null, eloChange: rec?.elo[agentId] ?? null,
      players: this.sides(t, v),
      next: v.done ? "The game is over. Find another: GET /api/arena/challenges or POST /api/arena/queue."
        : v.status === "waiting" ? "Waiting for a rival. GET .../wait returns when the game starts."
        : v.status === "countdown" ? "Starting. GET .../wait returns when it is your move."
        : yourTurn ? `Your move: POST /api/arena/games/${t.id}/move {"move":"<one of legalMoves>"}. Your clock is running.`
        : "Rival to move. GET .../wait returns when it is your move.",
    };
  }

  private mine_(me: Agent, id: string): Table {
    this.resolveStakes(me);
    const t = this.tables.get(id);
    if (!t || !t.seats.has(me.id)) throw new ArenaError(404, "No such game for this agent.", "unknown_game");
    return t;
  }
  state(me: Agent, id: string) { return this.state_(this.mine_(me, id), me.id); }
  /** Long poll: returns once it is the agent's move, the game ends, a draw is offered to it, or after `ms`. */
  async wait(me: Agent, id: string, ms: number): Promise<ReturnType<Arena["state"]>> {
    const t = this.mine_(me, id);
    const ready = () => { const s = this.state_(t, me.id); return s.yourTurn || s.done || s.drawOffer === "rival" ? s : null; };
    const now = ready();
    if (now) return now;
    if (t.waiters.size >= 8) throw new ArenaError(429, "Too many waits on this game.", "slow_down");
    return await new Promise((resolve, reject) => {
      const finish = (f: () => void) => { t.waiters.delete(check); clearTimeout(timer); f(); };
      const check = () => { try { const s = ready(); if (s) finish(() => resolve(s)); } catch (e) { finish(() => reject(e)); } };
      const timer = setTimeout(() => { try { const s = this.state_(t, me.id); finish(() => resolve(s)); } catch (e) { finish(() => reject(e)); } }, Math.max(100, Math.min(30_000, ms)));
      t.waiters.add(check);
    });
  }
  /** A move in UCI (e2e4, e7e8q), checked by the game exactly like a move from the board. */
  move(me: Agent, id: string, input: Record<string, unknown>) {
    const t = this.mine_(me, id), s = t.seats.get(me.id)!;
    this.present(t, me.id);
    let from = String(input.from ?? ""), to = String(input.to ?? ""), promotion = input.promotion === undefined || input.promotion === null || input.promotion === "" ? undefined : String(input.promotion);
    if (input.move !== undefined) {
      const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(String(input.move).trim().toLowerCase());
      if (!m) throw new ArenaError(400, "move is UCI: from square, to square and an optional promotion piece, e.g. e2e4 or e7e8q.", "bad_move");
      from = m[1]!; to = m[2]!; promotion = m[3];
    }
    try { t.games.move(t.id, s.player, from, to, promotion); } catch (e) { throw chessError(e); }
    return this.state_(t, me.id);
  }
  resign(me: Agent, id: string) { const t = this.mine_(me, id); try { t.games.resign(t.id, t.seats.get(me.id)!.player); } catch (e) { throw chessError(e); } return this.state_(t, me.id); }
  draw(me: Agent, id: string, action: string) {
    if (!["offer", "accept", "decline"].includes(action)) throw new ArenaError(400, "action is offer, accept or decline.", "bad_input");
    const t = this.mine_(me, id); try { t.games.draw(t.id, t.seats.get(me.id)!.player, action); } catch (e) { throw chessError(e); } return this.state_(t, me.id);
  }
  leave(me: Agent, id: string) {
    const t = this.mine_(me, id), s = t.seats.get(me.id)!;
    try { t.games.leave(t.id, s.player); } catch (e) { throw chessError(e); }
    this.drop(t);
    return { ok: true };
  }
  /** The agent's own page: profile, live games (staked seats included once dealt) and challenges. */
  me(me: Agent) {
    this.resolveStakes(me);
    const games = this.activeTables(me.id).map((t) => { try { return this.state_(t, me.id); } catch { return null; } }).filter((x) => x !== null);
    const stakes = this.db.stakes.filter((s) => s.agent === me.id).map((s) => ({ matchId: s.matchId, assignedAt: s.at }));
    return { agent: this.view(me), games, challenges: this.openChallenges(me), stakes };
  }

  // ---- staked seats: the owner's stake, the agent's moves

  /** The owner gives their seat in a staked NIGHT CHESS match (GameEscrow, opened or joined from their wallet) to one of their agents. */
  assignStake(owner: string, matchId: string, agentId: string) {
    const me = lc(owner), id = lc(matchId);
    if (!/^0x[0-9a-f]{64}$/.test(id)) throw new ArenaError(400, "matchId is the escrow match id (0x and 64 hex characters).", "bad_input");
    if (!this.o.lobby) throw new ArenaError(503, "Staked games are not available here.", "unavailable");
    const lobby = this.o.lobby(), c = lobby.escrow.challenges.get(id);
    if (!c || (me !== c.creator && me !== c.playerB)) throw new ArenaError(404, "No such staked match for this wallet. Open or accept it from your wallet first.", "unknown_match");
    if (c.game !== "chess") throw new ArenaError(400, "Agents play staked chess; Space Pinball for agents is phase 2.", "bad_game");
    const status = lobby.escrow.status(c);
    if (!["pending", "open", "joined"].includes(status)) throw new ArenaError(409, `This match is ${status}.`, "match_over");
    const a = this.owned(me, agentId);
    if (a.revokedAt) throw new ArenaError(409, "This agent's key is revoked. Rotate it first.", "revoked");
    this.db.stakes = this.db.stakes.filter((s) => !(s.matchId === id && s.wallet === me));
    this.db.stakes.push({ matchId: id, agent: a.id, wallet: me, at: this.now() });
    this.save();
    return { matchId: id, agent: this.view(a), status, note: "Your agent takes the seat once both stakes are in. It plays; the stake and the payout stay with your wallet." };
  }
  unassignStake(owner: string, matchId: string) {
    const me = lc(owner), id = lc(matchId), n = this.db.stakes.length;
    this.db.stakes = this.db.stakes.filter((s) => !(s.matchId === id && s.wallet === me));
    // an agent already seated stops playing it; the owner can take the seat back from the site
    for (const t of this.tables.values()) {
      if (t.where !== "staked" || t.endedAt || this.stakeOf(t) !== id) continue;
      for (const [agentId, s] of t.seats) if (this.db.agents.find((a) => a.id === agentId)?.owner === me) { s.off?.(); t.seats.delete(agentId); }
      if (!t.seats.size) this.tables.delete(t.id);
    }
    if (n !== this.db.stakes.length) this.save();
    return { ok: true };
  }
  private stakeOf(t: Table): string | null { try { const s = [...t.seats.values()][0]; return s ? t.games.get(t.id, s.player).escrow : null; } catch { return null; } }
  /** Seats the agent at each staked game dealt for a match its owner assigned to it. */
  private resolveStakes(me: Agent) {
    const mine = this.db.stakes.filter((s) => s.agent === me.id);
    if (!mine.length || !this.o.lobby) return;
    const lobby = this.o.lobby();
    lobby.escrow.poke();
    for (const s of mine) {
      if (me.owner !== s.wallet) { this.db.stakes = this.db.stakes.filter((x) => x !== s); this.dirty = true; continue; }
      let seat: ReturnType<Lobby["seat"]>;
      try { seat = lobby.seat(s.matchId, s.wallet); } catch { this.db.stakes = this.db.stakes.filter((x) => x !== s); this.dirty = true; continue; }
      if ("waiting" in seat || seat.game !== "chess") continue;
      const t = this.table(seat.id, "staked", this.o.stakedChess ?? this.o.publicChess);
      if (!t.seats.has(me.id) && !t.recorded) this.seat(t, me.id, seat.player);
    }
  }

  // ---- results and ratings

  private record(t: Table) {
    if (t.recorded) return;
    const any = [...t.seats.values()][0]!;
    const v = t.games.get(t.id, any.player);
    if (!v.done) return;
    t.recorded = true; t.endedAt = this.now();
    for (const s of t.seats.values()) { s.off?.(); s.off = null; }
    for (const w of [...t.waiters]) w();
    const [w, b] = this.sides(t, v) as [ReturnType<Arena["sides"]>[number], ReturnType<Arena["sides"]>[number]];
    if (!w.agent && !b.agent) return;
    const score = !v.winner ? 0.5 : v.winner === "w" ? 1 : 0;
    const aw = w.agent ? this.db.agents.find((a) => a.id === w.agent) : undefined, ab = b.agent ? this.db.agents.find((a) => a.id === b.agent) : undefined;
    // Each played at least two moves, and two agents of one owner never rate each other (no farming).
    const rated = v.ply >= 4 && !(aw && ab && aw.owner === ab.owner);
    const elo: GameRecord["elo"] = {};
    const apply = (a: Agent | undefined, mine: number, rival: number, s: number) => {
      if (!a) return;
      const before = a.elo, k = a.games < 20 ? 32 : 20;
      if (rated) {
        a.elo = Math.max(100, Math.round(a.elo + k * (s - 1 / (1 + 10 ** ((rival - mine) / 400)))));
        a.games++; if (s === 1) a.wins++; else if (s === 0) a.losses++; else a.draws++;
      }
      elo[a.id] = { before, after: a.elo };
    };
    apply(aw, w.elo, b.elo, score); apply(ab, b.elo, w.elo, 1 - score);
    this.db.games.push({ id: t.id, game: "chess", where: t.where, tc: v.tc, currency: v.currency, stake: v.stake, escrow: v.escrow, startedAt: v.startedAt, endedAt: this.now(),
      white: { name: w.name, agent: w.agent, elo: w.elo }, black: { name: b.name, agent: b.agent, elo: b.elo },
      result: score === 1 ? "1-0" : score === 0 ? "0-1" : "1/2-1/2", reason: v.reason ?? "", plies: v.ply, rated, elo });
    if (this.db.games.length > 5_000) this.db.games.splice(0, this.db.games.length - 5_000);
    if (t.where === "staked") this.db.stakes = this.db.stakes.filter((s) => s.matchId !== v.escrow);
    this.save();
  }

  /** Arena games being played now, in the shape of GET /api/games/live. */
  live() {
    const games = [...this.tables.values()].filter((t) => !t.endedAt).flatMap((t) => {
      const any = [...t.seats.values()][0];
      if (!any) return [];
      let v: ReturnType<ChessGames["get"]>;
      try { v = t.games.get(t.id, any.player, true); } catch { return []; }
      if (v.status === "waiting" || v.done) return [];
      return [{ game: "chess" as const, id: t.id, where: t.where, players: this.sides(t, v).map((p) => ({ name: p.name, ...(p.agent ? { agent: p.agent } : {}), color: p.color, elo: p.elo })),
        stake: v.stake ? { amount: v.stake, currency: v.currency } : null, startedAt: v.startedAt, watch: `/arena?watch=${t.id}`, viewers: 0, tc: v.tc, ply: v.ply, turn: v.turn, clocks: { white: v.clocks.w, black: v.clocks.b } }];
    });
    return { games };
  }
  /** The board a table is played on, for live betting: the arena's own, or the site's NIGHT CHESS (its public and staked tables). */
  boardOf(id: string): { where: Where; games: ChessGames } | null {
    const t = this.tables.get(id);
    return t ? { where: t.where, games: t.games } : null;
  }
  /**
   * Who is behind each seat of a table, for live betting: the agents' owner wallets by colour (null
   * for a person), plus the owner of any agent assigned to a staked seat of that game.
   */
  betParties(id: string): { where: Where; owners: { w: string | null; b: string | null }; agents: number; assigned: string[] } | null {
    const t = this.tables.get(id);
    if (!t) return null;
    const owners: { w: string | null; b: string | null } = { w: null, b: null };
    let agents = 0;
    for (const [agentId, s] of t.seats) {
      const a = this.db.agents.find((x) => x.id === agentId);
      let color: string | null = null;
      try { color = t.games.get(t.id, s.player).you; } catch { /* closed */ }
      if (a && (color === "w" || color === "b")) { owners[color] = a.owner; agents++; }
    }
    const escrow = this.stakeOf(t);
    const assigned = escrow ? this.db.stakes.filter((x) => x.matchId === escrow).map((x) => x.wallet) : [];
    return { where: t.where, owners, agents, assigned };
  }
  /** What a spectator may see of an arena game: the board, never a player token. */
  watch(id: string) {
    const t = this.tables.get(id), any = t ? [...t.seats.values()][0] : undefined;
    if (!t || !any) {
      const g = this.db.games.find((x) => x.id === id);
      if (!g) throw new ArenaError(404, "No such arena game.", "unknown_game");
      return { id, done: true, record: g };
    }
    let v: ReturnType<ChessGames["get"]>;
    try { v = t.games.get(t.id, any.player); } catch { throw new ArenaError(410, "This game is closed.", "game_closed"); }
    return { id, done: v.done, status: v.status, tc: v.tc, fen: v.fen, turn: v.turn, check: v.check, ply: v.ply, moves: (v.moves ?? []).map((m) => m.san), lastMove: v.lastMove ? uci(v.lastMove) : null,
      clocks: { white: v.clocks.w, black: v.clocks.b }, reason: v.reason, result: v.done ? (!v.winner ? "1/2-1/2" : v.winner === "w" ? "1-0" : "0-1") : null,
      stake: v.stake ? { amount: v.stake, currency: v.currency } : null, players: this.sides(t, v).map(({ color, name, agent, elo, kind, seat }) => ({ color, name, agent, elo, kind, seat })) };
  }

  /** Presence: an agent silent for PRESENCE_MS stops counting as at the table. Finished tables are let go. */
  tick() {
    const now = this.now();
    for (const t of this.tables.values()) {
      if (!t.recorded) this.changed(t);
      for (const s of t.seats.values()) if (s.off && now - s.seenAt > PRESENCE_MS) { s.off(); s.off = null; }
      if ((t.endedAt && now - t.endedAt > 30 * 60_000) || (!t.endedAt && now - t.createdAt > 6 * 3_600_000)) this.drop(t);
    }
    // a closed waiting match (the queue's 10 minutes) is let go too
    for (const t of this.tables.values()) if (!t.endedAt) { const s = [...t.seats.values()][0]; if (!s) { this.tables.delete(t.id); continue; } try { t.games.get(t.id, s.player); } catch { this.drop(t); } }
    this.sweepChallenges();
    if (this.dirty) this.save();
  }
}

/** The errors chess.ts throws, as statuses and codes an agent can act on. */
function chessError(e: unknown): ArenaError {
  const m = (e as Error).message ?? "";
  if (/rival's turn/.test(m)) return new ArenaError(409, "It is your rival's turn. GET .../wait returns when it is yours.", "not_your_turn");
  if (/Illegal move/.test(m)) return new ArenaError(400, "Illegal move. Choose one of legalMoves from GET /api/arena/games/:id.", "illegal_move");
  if (/not started|No rival|No active game/.test(m)) return new ArenaError(409, m, "not_started");
  if (/ended/.test(m)) return new ArenaError(409, "The game has ended.", "game_over");
  if (/No such match|No such player/.test(m)) return new ArenaError(410, "This game is closed.", "game_closed");
  return new ArenaError(400, m.split("\n")[0] ?? "Refused.", "refused");
}

let current: Arena | null = null;
/** The live arena, made on first use; staked seats come from the lobby (made only when a seat is assigned). */
export function liveArena(lobby: () => Lobby): Arena {
  if (!current) {
    const arenaChess = new ChessGames(null);
    current = new Arena({ file: join(config.dataDir, "arena.json"), seats: imdSeat, arenaChess, publicChess, stakedChess: publicChess, lobby });
    const a = current;
    setInterval(() => arenaChess.tick(), 250).unref();
    setInterval(() => { a.tick(); void a.refresh().catch(() => {}); }, 2_000).unref();
  }
  return current;
}
