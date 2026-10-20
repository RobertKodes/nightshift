import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Agent } from "./arena.js";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";
import { seasonStartOf } from "./league.js";

/**
 * HASH LAB: find two different messages whose SHA-256 digests start with the same bits. The more
 * leading bits match, the higher the score. Adapted from Projects/solver's HashSmash work
 * (reduced-round SHA-256, verified there against node:crypto at 64 rounds). Two tracks: 24 rounds
 * (a warm-up anyone's browser can climb) and the full 64 rounds (real SHA-256). A birthday search
 * over N digests finds about 2·log2(N) matching bits while every digest fits in memory; with a fixed
 * table each extra bit roughly doubles the work.
 *
 * Each message starts with "NS|<player>|", the player's wallet or agent id, so a pair found by one
 * player can never be claimed by another. The server re-hashes every submission; nothing is trusted.
 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 with only compression rounds 0..r-1 (IV, padding, schedule and feed-forward standard). From Projects/solver. */
export function sha256Rounds(msg: Uint8Array, rounds: number): Uint8Array {
  if (rounds < 1 || rounds > 64) throw new RangeError("rounds must be 1..64");
  const bitLen = BigInt(msg.length) * 8n;
  const total = Math.ceil((msg.length + 9) / 64) * 64;
  const p = new Uint8Array(total);
  p.set(msg); p[msg.length] = 0x80;
  new DataView(p.buffer).setBigUint64(total - 8, bitLen);
  const H = IV.slice(), W = new Uint32Array(64), dv = new DataView(p.buffer);
  for (let off = 0; off < p.length; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = dv.getUint32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const w15 = W[t - 15]!, w2 = W[t - 2]!;
      W[t] = (W[t - 16]! + (rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)) + W[t - 7]! + (rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H as [number, number, number, number, number, number, number, number];
    for (let t = 0; t < rounds; t++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t]! + W[t]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const v = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) H[i] = (H[i]! + v[i]!) >>> 0;
  }
  const out = new Uint8Array(32), o = new DataView(out.buffer);
  H.forEach((x, i) => o.setUint32(i * 4, x));
  return out;
}

/** How many leading bits two digests share. */
export function commonBits(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]! ^ b[i]!;
    if (x === 0) { n += 8; continue; }
    return n + Math.clz32(x) - 24;
  }
  return n;
}

export const TRACKS = { r24: 24, r64: 64 } as const;
export type Track = keyof typeof TRACKS;
export class LabError extends Error { constructor(public status: number, message: string, public code: string) { super(message); } }

const hex = (s: string) => {
  const h = s.replace(/^0x/, "");
  if (!/^(?:[0-9a-f]{2}){8,128}$/i.test(h)) throw new LabError(400, "Messages are hex, 8 to 128 bytes.", "bad_input");
  return Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
};
export const prefixOf = (player: string) => `NS|${player.toLowerCase()}|`;

type LabRecord = { player: string; name: string; kind: "wallet" | "agent"; bits: number; at: number; m1: string; m2: string };
type State = { seasonStart: number; best: { [track: string]: { [player: string]: LabRecord } }; history: { track: Track; season: number; at: number; player: string; name: string; bits: number }[]; season: number; archive: { season: number; endedAt: number; top: { track: Track; player: string; name: string; bits: number }[] }[] };

export class HashLab {
  private s: State;
  constructor(private file: string | null, private now: () => number = Date.now) {
    const fresh: State = { seasonStart: seasonStartOf(now()), best: { r24: {}, r64: {} }, history: [], season: 1, archive: [] };
    let s = fresh;
    try { if (file && existsSync(file)) s = { ...fresh, ...JSON.parse(readFileSync(file, "utf8")) }; } catch { s = fresh; }
    this.s = s;
  }
  private save() { if (this.file) writeAtomic(this.file, JSON.stringify(this.s)); }
  get season() { return { n: this.s.season, startedAt: this.s.seasonStart, endsAt: this.s.seasonStart + 7 * 86_400_000 }; }

  roll(): void {
    const start = seasonStartOf(this.now());
    if (start <= this.s.seasonStart) return;
    const top = (Object.keys(TRACKS) as Track[]).flatMap((t) => this.board(t).slice(0, 5).map((r) => ({ track: t, player: r.player, name: r.name, bits: r.bits })));
    this.s.archive.unshift({ season: this.s.season, endedAt: start, top });
    this.s.archive = this.s.archive.slice(0, 52);
    this.s.best = { r24: {}, r64: {} };
    this.s.season++; this.s.seasonStart = start;
    this.save();
  }

  /** Checks a pair and keeps it if it beats the player's best. */
  submit(track: Track, who: { player: string; name: string; kind: "wallet" | "agent" }, m1hex: string, m2hex: string): { bits: number; best: number; record: boolean; labRecord: boolean } {
    if (!(track in TRACKS)) throw new LabError(400, "track: r24 or r64.", "bad_input");
    this.roll();
    const a = hex(m1hex), b = hex(m2hex);
    const pre = new TextEncoder().encode(prefixOf(who.player));
    const starts = (m: Uint8Array) => pre.every((x, i) => m[i] === x);
    if (!starts(a) || !starts(b)) throw new LabError(400, `Both messages must start with "${prefixOf(who.player)}" (as bytes).`, "wrong_prefix");
    if (a.length === b.length && a.every((x, i) => x === b[i])) throw new LabError(400, "The two messages must differ.", "same_message");
    const r = TRACKS[track];
    const bits = commonBits(sha256Rounds(a, r), sha256Rounds(b, r));
    const board = this.s.best[track] ??= {};
    const prev = board[who.player]?.bits ?? 0;
    const labBest = Math.max(0, ...Object.values(board).map((x) => x.bits));
    const record = bits > prev;
    if (record) {
      board[who.player] = { player: who.player, name: who.name, kind: who.kind, bits, at: this.now(), m1: m1hex.replace(/^0x/, "").toLowerCase(), m2: m2hex.replace(/^0x/, "").toLowerCase() };
      if (bits > labBest) { this.s.history.unshift({ track, season: this.s.season, at: this.now(), player: who.player, name: who.name, bits }); this.s.history = this.s.history.slice(0, 200); }
      this.save();
    }
    return { bits, best: Math.max(prev, bits), record, labRecord: record && bits > labBest };
  }

  board(track: Track): LabRecord[] {
    return Object.values(this.s.best[track] ?? {}).sort((a, b) => b.bits - a.bits || a.at - b.at);
  }
  best(track: Track, player: string): number { return this.s.best[track]?.[player.toLowerCase()]?.bits ?? 0; }
  summary() {
    const show = (r: LabRecord) => ({ player: r.kind === "wallet" ? `${r.player.slice(0, 6)}…${r.player.slice(-4)}` : r.player, name: r.name, kind: r.kind, bits: r.bits, at: r.at, m1: r.m1, m2: r.m2 });
    return {
      season: this.season, tracks: Object.fromEntries((Object.keys(TRACKS) as Track[]).map((t) => [t, { rounds: TRACKS[t], board: this.board(t).slice(0, 25).map(show) }])),
      records: this.s.history.slice(0, 20), archive: this.s.archive.slice(0, 6),
      rules: { prefix: "NS|<your wallet in lowercase, or your agent id>|", messageBytes: "8 to 128", score: "leading bits shared by the two digests" },
    };
  }
}

let lab: HashLab | null = null;
export const liveLab = () => (lab ??= new HashLab(join(config.dataDir, "hashlab.json")));

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  owner: string | null; agentOf: (key: string) => Agent | null; lab?: HashLab;
};

/** /api/lab/*: the board, and submissions from a signed-in wallet or an arena agent (Bearer nsa_). */
export async function labRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/lab")) return false;
  const reply = (status: number, v: unknown) => { ctx.json(res, status, v); return true; };
  try {
    const l = ctx.lab ?? liveLab();
    if (p === "/api/lab" && req.method === "GET") {
      if (ctx.limited(req, "lab-read", 240, 60_000)) return reply(429, { error: "Slow down", code: "slow_down" });
      l.roll();
      return reply(200, l.summary());
    }
    if (p === "/api/lab/submit" && req.method === "POST") {
      const h = req.headers.authorization ?? "";
      const key = h.startsWith("Bearer nsa_") ? h.slice(7).trim() : "";
      const agent = key ? ctx.agentOf(key) : null;
      const who = agent ? { player: agent.id, name: agent.name, kind: "agent" as const } : ctx.owner ? { player: ctx.owner.toLowerCase(), name: `${ctx.owner.slice(0, 6)}…${ctx.owner.slice(-4)}`, kind: "wallet" as const } : null;
      if (!who) throw new LabError(401, "Sign in with your wallet, or send an arena key as Authorization: Bearer nsa_….", "unauthorized");
      if (ctx.limited(req, `lab-submit:${who.player}`, 30, 60_000)) return reply(429, { error: "30 submissions a minute at most.", code: "slow_down" });
      const b = await ctx.body(req, 2_000);
      return reply(200, l.submit(String(b.track) as Track, who, String(b.m1 ?? ""), String(b.m2 ?? "")));
    }
    return reply(404, { error: "Not found", code: "not_found" });
  } catch (e) {
    if (e instanceof LabError) return reply(e.status, { error: e.message, code: e.code });
    console.error("lab route", e);
    return reply(500, { error: "Lab error", code: "internal" });
  }
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
export function labTools(server: McpServer, who: (agentId?: string) => Agent) {
  const run = <A,>(fn: (a: A) => unknown) => async (a: A) => { try { return text(fn(a)); } catch (e) { return { ...text({ ok: false, error: (e as Error).message }), isError: true }; } };
  server.registerTool("lab_board", { title: "Hash Lab: board", description: "This week's Hash Lab boards (r24 and the full 64-round SHA-256): the most leading bits two messages' digests share, per player, and the record history.", inputSchema: {} },
    run(() => { liveLab().roll(); return liveLab().summary(); }));
  server.registerTool("lab_submit", {
    title: "Hash Lab: submit a pair",
    description: "Submits two different hex messages that both start with the bytes of \"NS|<your agent id>|\". The server hashes both (24 or 64 SHA-256 rounds) and scores the leading bits they share.",
    inputSchema: { agentId: z.string().regex(/^[a-f0-9]{12}$/).optional(), track: z.enum(["r24", "r64"]), m1: z.string().max(260), m2: z.string().max(260) },
  }, run((a: { agentId?: string; track: Track; m1: string; m2: string }) => { const me = who(a.agentId); return liveLab().submit(a.track, { player: me.id, name: me.name, kind: "agent" }, a.m1, a.m2); }));
}
