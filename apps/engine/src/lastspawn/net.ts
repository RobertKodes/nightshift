import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { CLASSES, MAX_MSGS_PER_SEC, TICK_HZ } from "@nightshift/lastspawn";
import type { Anim, ClientMsg } from "@nightshift/lastspawn";
import type { Connection } from "./world.js";
import { World } from "./world.js";
import { own } from "./state.js";

const animations = new Set<Anim>(["idle", "walk", "run", "swim", "jump", "cast", "attack", "hit", "dead", "sit", "interact"]);
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const string = (x: unknown, max = 128): x is string => typeof x === "string" && x.length <= max;

export function parseClientMsg(raw: string): ClientMsg | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const m = value as Record<string, unknown>;
  switch (m.t) {
    case "hello":
      if (finite(m.version) && (m.guest === undefined || string(m.guest, 512)) && (m.agent === undefined || typeof m.agent === "boolean"))
        return { t: "hello", version: m.version, guest: m.guest, agent: m.agent };
      break;
    case "create":
      if (string(m.name, 64) && string(m.look, 64) && string(m.cls) && own(CLASSES, m.cls))
        return { t: "create", name: m.name, look: m.look, cls: m.cls };
      break;
    case "play": if (string(m.charId)) return { t: "play", charId: m.charId }; break;
    case "move":
      if (finite(m.seq) && Number.isSafeInteger(m.seq) && m.seq >= 0 && finite(m.x) && finite(m.y) && finite(m.z) && finite(m.ry)
        && typeof m.anim === "string" && animations.has(m.anim as Anim))
        return { t: "move", seq: m.seq, x: m.x, y: m.y, z: m.z, ry: m.ry, anim: m.anim as Anim };
      break;
    case "leap": if (finite(m.ry)) return { t: "leap", ry: m.ry }; break;
    case "target": if (m.id === null || string(m.id)) return { t: "target", id: m.id }; break;
    case "cast":
      if (string(m.ability) && (m.target === undefined || m.target === null || string(m.target)))
        return { t: "cast", ability: m.ability, target: m.target };
      break;
    case "say": if (string(m.text, 1000)) return { t: "say", text: m.text }; break;
    case "interact": if (string(m.id)) return { t: "interact", id: m.id }; break;
    case "choose": if (string(m.npc) && string(m.option)) return { t: "choose", npc: m.npc, option: m.option }; break;
    case "quest":
      if (string(m.id) && (m.action === "accept" || m.action === "turnin" || m.action === "abandon"))
        return { t: "quest", action: m.action, id: m.id };
      break;
    case "loot": if (string(m.id)) return { t: "loot", id: m.id }; break;
    case "ping": if (finite(m.at)) return { t: "ping", at: m.at }; break;
  }
  return null;
}

export interface LastspawnDeps {
  dataDir: string;
  wallet(req: IncomingMessage): string | null;
  savedName(wallet: string): string | null;
  log?(s: string): void;
}

export function attachLastspawn(server: Server, deps: LastspawnDeps): { world: World; close(): void } {
  const world = new World({ dataDir: deps.dataDir, savedName: deps.savedName });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const ips = new Map<string, number>(), connections = new Map<WebSocket, Connection>();
  let total = 0, closed = false;
  const log = (error: unknown) => deps.log?.(`LASTSPAWN: ${error instanceof Error ? error.message : String(error)}`);
  const safely = (fn: () => void) => { try { fn(); } catch (error) { log(error); } };
  const reject = (socket: Duplex, status: string) => {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let pathname: string;
    try { pathname = new URL(req.url ?? "", "http://lastspawn.local").pathname; } catch { return; }
    if (pathname !== "/api/lastspawn/ws") return;
    if (closed) { reject(socket, "503 Service Unavailable"); return; }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      try {
        const url = new URL(origin);
        if (!/^https?:$/.test(url.protocol) || url.host.toLowerCase() !== req.headers.host?.trim().toLowerCase()) {
          reject(socket, "403 Forbidden"); return;
        }
      } catch { reject(socket, "403 Forbidden"); return; }
    }
    const forwarded = req.headers["x-forwarded-for"];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    if (total >= 500 || (ips.get(ip) ?? 0) >= 4) { reject(socket, "429 Too Many Requests"); return; }
    let wallet: string | null;
    try { wallet = deps.wallet(req); } catch (error) { log(error); reject(socket, "401 Unauthorized"); return; }
    total++; ips.set(ip, (ips.get(ip) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true; total--;
      const n = (ips.get(ip) ?? 1) - 1;
      if (n) ips.set(ip, n); else ips.delete(ip);
    };
    socket.once("close", release);
    try {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const conn: Connection = {
          id: randomUUID(), account: wallet ? `w:${wallet.toLowerCase()}` : "", agent: false,
          send: (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
          close: () => { safely(() => world.disconnect(conn)); ws.close(); },
        };
        connections.set(ws, conn); world.connect(conn);
        let messages: number[] = [], violations: number[] = [];
        ws.on("message", (data, binary) => {
          if (closed || ws.readyState !== WebSocket.OPEN) return;
          const now = Date.now();
          messages = messages.filter((at) => now - at < 1000);
          if (messages.length >= MAX_MSGS_PER_SEC) {
            violations = violations.filter((at) => now - at < 10000); violations.push(now);
            if (violations.length >= 3) conn.close();
            return;
          }
          messages.push(now);
          if (binary) return;
          const msg = parseClientMsg(data.toString());
          if (msg) safely(() => world.handle(conn, msg));
        });
        ws.on("close", () => { release(); connections.delete(ws); safely(() => world.disconnect(conn)); });
        ws.on("error", log);
      });
    } catch (error) { release(); log(error); socket.destroy(); }
  };

  server.on("upgrade", upgrade);
  wss.on("error", log);
  const ticks = setInterval(() => safely(() => world.tick()), 1000 / TICK_HZ);
  const saves = setInterval(() => safely(() => world.save()), 15000);
  ticks.unref(); saves.unref();
  return {
    world,
    close() {
      if (closed) return;
      closed = true; clearInterval(ticks); clearInterval(saves); server.off("upgrade", upgrade);
      for (const [ws, conn] of connections) { safely(() => world.disconnect(conn)); ws.terminate(); }
      connections.clear(); wss.close(); world.save();
    },
  };
}
