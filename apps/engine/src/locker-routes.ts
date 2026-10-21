import type { IncomingMessage, ServerResponse } from "node:http";
import { onChess } from "./chess.js";
import { type Locker, isKey, locker as live } from "./locker.js";
import { onArcade } from "./pinball.js";
import { onPool, pool } from "./pool.js";
import { onPoker, poker } from "./poker.js";
import { ring } from "./poker/ring.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  owner: string | null; url: URL;
  locker?: Locker;
};

let wired = false;
/**
 * The profiles follow every game: NIGHT POOL (looks at the table, XP and badges at the end), NIGHT
 * POKER (emotes and faces at the table, XP for rated matches), and NIGHT CHESS and Space Pinball duels (XP), each booked by the player's key (a wallet, or a
 * Telegram player's tg:<pid>). Called once at startup.
 */
export function wireGameRoom(l: Locker = live): void {
  if (wired) return;
  wired = true;
  pool.setLooks((key, staked) => l.look(key, staked));
  onPool((e) => l.poolEnded(e));
  poker.setLooks((key, staked) => l.look(key, staked));
  ring.setLooks((key, staked) => l.look(key, staked));
  onPoker((e) => {
    if (!e.rated) return;
    for (const pl of e.players) if (pl.key && isKey(pl.key) && !pl.agent) l.record(pl.key, { game: "poker", result: pl.result, name: pl.name });
  });
  onChess((e) => {
    if (!e.rated) return;
    for (const [key, name, side] of [[e.keys[0], e.white, "w"], [e.keys[1], e.black, "b"]] as const) {
      if (!key || !isKey(key)) continue;
      l.record(key, { game: "chess", result: e.won === null ? "draw" : e.won === side ? "win" : "loss", name });
    }
  });
  onArcade((e) => {
    if (e.kind !== "duel" || !e.keys) return;
    // the verified scores decide it (the higher one wins, as pinball.ts settles it)
    for (const [i, s] of [e.a, e.b].entries()) {
      const key = e.keys[i], o = i === 0 ? e.b : e.a;
      if (!key || !isKey(key)) continue;
      l.record(key, { game: "pinball", result: s.score === o.score ? "draw" : s.score > o.score ? "win" : "loss", name: s.name });
    }
  });
}

/** /api/locker/*: the catalogue, your profile and locker (signed in), equipping, the shop's price list. */
export async function lockerRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/locker/")) return false;
  const { json, body, limited, owner, url } = ctx;
  const l = ctx.locker ?? live;
  const reply = (status: number, value: unknown) => { json(res, status, value); return true; };
  try {
    if (limited(req, "locker", 120, 60_000)) return reply(429, { error: "Slow down" });
    if (p === "/api/locker/catalog" && req.method === "GET") return reply(200, { items: l.catalog() });
    if (p === "/api/locker/profile" && req.method === "GET") {
      const key = (url.searchParams.get("key") ?? "").toLowerCase(), prof = isKey(key) ? l.get(key) : undefined;
      return prof ? reply(200, l.pub(prof)) : reply(404, { error: "No such player" });
    }
    if (!owner) return reply(401, { error: "Sign in with your wallet to open your locker." });
    const key = owner.toLowerCase();
    if (p === "/api/locker/me" && req.method === "GET") return reply(200, l.self(key));
    if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
    if (limited(req, "locker-write", 40, 60_000)) return reply(429, { error: "Slow down" });
    const b = await body(req, 2_000);
    if (p === "/api/locker/equip") { l.equip(key, b.kind, b.value); return reply(200, l.self(key)); }
    if (p === "/api/locker/avatar") { l.setAvatar(key, b.avatar); return reply(200, l.self(key)); }
    if (p === "/api/locker/purchase") return reply(200, l.purchase(b.item, b.asset));
    return reply(404, { error: "No such locker route" });
  } catch (err) {
    return reply(400, { error: (err as Error).message.split("\n")[0] });
  }
}
