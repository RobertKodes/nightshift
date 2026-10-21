import type { IncomingMessage, ServerResponse } from "node:http";
import { clientIp } from "./auth.js";
import { type PokerGames, poker } from "./poker.js";
import { cardText } from "./poker/cards.js";
import { cleanSeed, commitOf, dealPlan, deckOrder } from "./poker/deck.js";
import { BUY_IN, DAILY_CHIPS, RING_BLINDS, type RingTables, ring } from "./poker/ring.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  owner: string | null; url: URL;
  /** Tests pass their own tables; the server uses the live ones. */
  games?: PokerGames; tables?: RingTables;
};
const streams = new Map<string, number>();
let total = 0;

/** A live stream of one table for one seat: its own cards, never another's. One pending snapshot survives a slow reader. */
function stream(req: IncomingMessage, res: ServerResponse, ctx: Context, frame: () => unknown, subscribe: (f: () => void) => () => void): boolean {
  const first = frame();
  const ip = clientIp(req);
  if ((streams.get(ip) ?? 0) >= 4 || total >= 2_000) { ctx.json(res, 429, { error: "Too many live connections" }); return true; }
  streams.set(ip, (streams.get(ip) ?? 0) + 1); total++;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  let closed = false, blocked = false, pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let off = () => {};
  const close = () => {
    if (closed) return; closed = true; clearTimeout(timer); clearInterval(ping); off();
    res.off("drain", drain); res.off("close", close); res.off("error", close);
    const n = (streams.get(ip) ?? 1) - 1; if (n) streams.set(ip, n); else streams.delete(ip); total--;
    res.end();
  };
  const write = (data: string) => {
    if (closed) return;
    if (res.writableLength > 256 * 1024 || res.destroyed) { close(); return; }
    try { blocked = !res.write(data); } catch { close(); }
  };
  const flush = () => {
    timer = undefined;
    if (closed || !pending) return;
    if (blocked) { if (res.writableLength > 256 * 1024) close(); return; }
    pending = false;
    try { write(`data: ${JSON.stringify(frame())}\n\n`); } catch { close(); }
  };
  const schedule = () => { pending = true; if (!timer && !closed) timer = setTimeout(flush, 30); };
  const drain = () => { blocked = false; flush(); };
  const ping = setInterval(() => { if (blocked) close(); else write(": ping\n\n"); }, 20_000);
  res.on("drain", drain); res.on("close", close); res.on("error", close);
  write(`data: ${JSON.stringify(first)}\n\n`);
  if (!closed) off = subscribe(schedule);
  return true;
}

/**
 * Rebuilds a finished hand's deck from its seeds: what the verify page does in the browser, for
 * anyone's own script. Nothing secret goes in (the server seed is public once its match is over).
 */
export function verify(serverSeed: string, seeds: string[], hand: number, players: number, commit?: string) {
  if (!/^[0-9a-f]{64}$/.test(serverSeed)) throw Object.assign(new Error("The server seed is 64 hex characters."), { status: 400 });
  if (!Number.isInteger(hand) || hand < 1 || hand > 10_000_000) throw Object.assign(new Error("The hand number is a whole number from 1."), { status: 400 });
  if (seeds.length > 10 || !Number.isInteger(players) || players < 2 || players > 10) throw Object.assign(new Error("Two to ten seats."), { status: 400 });
  const deck = deckOrder(serverSeed, seeds, hand), plan = dealPlan(players), c = commitOf(serverSeed);
  return { commit: c, matches: commit === undefined ? null : commit.toLowerCase() === c, deck: deck.map(cardText),
    hole: plan.hole.map(([a, b]) => [cardText(deck[a]!), cardText(deck[b]!)]), board: [...plan.flop, plan.turn, plan.river].map((i) => cardText(deck[i]!)), seeds: seeds.map(cleanSeed) };
}

/** /api/poker/*: the queue, practice, a match's state and stream, the free tables, every action, the leaderboard and the deck check. Identity is the private seat token. */
export async function pokerRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/poker/")) return false;
  const { json, body, limited, owner, url } = ctx;
  const games = ctx.games ?? poker, tables = ctx.tables ?? ring;
  const reply = (status: number, value: unknown) => { json(res, status, value); return true; };
  try {
    if (p === "/api/poker/board" && req.method === "GET") return reply(200, games.board());
    if (p === "/api/poker/verify" && req.method === "GET") {
      if (limited(req, "poker-verify", 60, 60_000)) return reply(429, { error: "Slow down" });
      const q = url.searchParams, seeds = (q.get("seeds") ?? "").split(",");
      return reply(200, verify((q.get("serverSeed") ?? "").toLowerCase(), seeds, Number(q.get("hand")), Number(q.get("players") ?? seeds.length) || 2, q.get("commit") ?? undefined));
    }
    if ((p === "/api/poker/queue" || p === "/api/poker/practice") && req.method === "POST") {
      if (limited(req, "poker-queue", 20, 600_000)) return reply(429, { error: "Too many searches. Try again shortly." });
      const b = await body(req, 2_000), name = String(b.name ?? "");
      return reply(200, p.endsWith("practice") ? games.practice(name, owner) : games.queue(name, owner));
    }
    // the free tables: the list (and the signed-in wallet's play chips), a seat, its stream and every action at it
    if (p === "/api/poker/tables" && req.method === "GET") return reply(200, { tables: tables.list(), chips: tables.chips(owner), buyIn: BUY_IN, blinds: RING_BLINDS, daily: DAILY_CHIPS });
    const tbl = /^\/api\/poker\/table\/([a-f0-9]{1,40})(?:\/(events|sit|act|seed|emote|leave|sitout|topup))?$/.exec(p);
    if (tbl) {
      const id = tbl[1]!, action = tbl[2];
      if (!action && req.method === "GET") return reply(200, tables.get(id, url.searchParams.get("player") ?? ""));
      if (action === "events") {
        if (req.method !== "GET") return reply(405, { error: "Method not allowed" });
        const player = url.searchParams.get("player") ?? "";
        return stream(req, res, ctx, () => tables.get(id, player), (f) => tables.listen(id, player, f));
      }
      if (req.method !== "POST" || !action) return reply(405, { error: "Method not allowed" });
      const budget = action === "act" ? ["poker-act", 120] : action === "seed" ? ["poker-seed", 120] : action === "sit" ? ["poker-sit", 30] : ["poker-action", 60];
      if (limited(req, budget[0] as string, budget[1] as number, 60_000)) return reply(429, { error: "Slow down" });
      const b = await body(req, 2_000), player = String(b.player ?? "");
      if (action === "sit") return reply(200, tables.sit(id, b.seat, String(b.name ?? ""), owner, b.buyIn));
      if (action === "act") return reply(200, tables.act(id, player, { kind: b.kind, to: b.to }));
      if (action === "seed") return reply(200, tables.seed(id, player, b.hand, b.seed));
      if (action === "emote") { tables.emote(id, player, String(b.emote ?? "")); return reply(200, { ok: true }); }
      if (action === "sitout") return reply(200, tables.sitOut(id, player, b.on));
      if (action === "topup") return reply(200, tables.topUp(id, player));
      return reply(200, tables.leave(id, player));
    }
    const state = /^\/api\/poker\/match\/([a-f0-9]{1,40})$/.exec(p);
    if (state && req.method === "GET") return reply(200, games.get(state[1]!, url.searchParams.get("player") ?? ""));
    const route = /^\/api\/poker\/match\/([a-f0-9]{1,40})\/(events|act|seed|emote|resign|leave|rematch)$/.exec(p);
    if (!route) return reply(404, { error: "No such poker route" });
    const id = route[1]!, action = route[2]!;
    if (action === "events") {
      if (req.method !== "GET") return reply(405, { error: "Method not allowed" });
      const player = url.searchParams.get("player") ?? "";
      return stream(req, res, ctx, () => games.get(id, player), (f) => games.listen(id, player, f));
    }
    if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
    const budget = action === "act" ? ["poker-act", 120] : action === "seed" ? ["poker-seed", 120] : ["poker-action", 60];
    if (limited(req, budget[0] as string, budget[1] as number, 60_000)) return reply(429, { error: "Slow down" });
    const b = await body(req, 2_000), player = String(b.player ?? "");
    if (action === "act") return reply(200, games.act(id, player, { kind: b.kind, to: b.to }));
    if (action === "seed") return reply(200, games.seed(id, player, b.hand, b.seed));
    if (action === "emote") { games.emote(id, player, String(b.emote ?? "")); return reply(200, { ok: true }); }
    if (action === "resign") return reply(200, games.resign(id, player));
    if (action === "rematch") return reply(200, games.rematch(id, player));
    games.leave(id, player); return reply(200, { ok: true });
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    return reply(typeof status === "number" ? status : 400, { error: (err as Error).message.split("\n")[0] });
  }
}
