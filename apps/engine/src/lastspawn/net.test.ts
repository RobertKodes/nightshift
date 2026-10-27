import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientMsg, ServerMsg } from "@nightshift/lastspawn";
import { MAX_MSGS_PER_SEC, SLOTS, encodeLook } from "@nightshift/lastspawn";
import { clientIp, parseNets } from "../auth.js";
import { attachLastspawn, parseClientMsg } from "./net.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function server() {
  const dir = mkdtempSync(join(tmpdir(), "lastspawn-net-"));
  mkdirSync(join(dir, "lastspawn"));
  const http = createServer(), logs: string[] = [];
  const attached = attachLastspawn(http, {
    dataDir: dir, wallet: (req) => typeof req.headers["x-wallet"] === "string" ? req.headers["x-wallet"] : null,
    ip: (req) => clientIp(req, parseNets("127.0.0.1/32")), savedName: () => null, log: (s) => logs.push(s),
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const host = `127.0.0.1:${(http.address() as AddressInfo).port}`, url = `ws://${host}/api/lastspawn/ws`;
  const sockets = new Set<WebSocket>();
  const open = async (headers: Record<string, string> = {}, address = url) => {
    const ws = new WebSocket(address, { headers }); sockets.add(ws);
    const messages: ServerMsg[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as ServerMsg));
    const next = <T extends ServerMsg["t"]>(type: T): Promise<Extract<ServerMsg, { t: T }>> => {
      const found = messages.find((m) => m.t === type);
      if (found) return Promise.resolve(found as Extract<ServerMsg, { t: T }>);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ws.off("message", onMessage); reject(new Error(`No ${type} message`)); }, 2000);
        const onMessage = (raw: Buffer) => {
          const msg = JSON.parse(raw.toString()) as ServerMsg;
          if (msg.t !== type) return;
          clearTimeout(timer); ws.off("message", onMessage); resolve(msg as Extract<ServerMsg, { t: T }>);
        };
        ws.on("message", onMessage);
      });
    };
    await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    return { ws, messages, next, send: (msg: ClientMsg) => ws.send(JSON.stringify(msg)) };
  };
  cleanups.push(async () => {
    attached.close();
    for (const ws of sockets) ws.terminate();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  return { ...attached, http, logs, host, url, open };
}

describe("LASTSPAWN WebSocket transport", () => {
  it.each(["{", "null", "[]", '{"t":"unknown"}', '{"t":"move","seq":1}',
    '{"t":"move","seq":1,"x":0,"y":0,"z":0,"ry":0,"anim":"fly"}',
    '{"t":"hello","version":1,"agent":"yes"}', '{"t":"create","name":"Frog","cls":"constructor","look":"abc"}',
    '{"t":"equip"}', '{"t":"equip","item":{}}', '{"t":"use","item":3}', '{"t":"use","item":null}',
    '{"t":"unequip"}', '{"t":"unequip","slot":"constructor"}', '{"t":"unequip","slot":"bag"}', '{"t":"unequip","slot":[]}'])
  ("ignores malformed and unknown messages: %s", (raw) => { expect(parseClientMsg(raw)).toBeNull(); });

  it("parses equip and use item ids and all valid equipment slots", () => {
    for (const t of ["equip", "use"] as const) {
      const msg = { t, item: t === "equip" ? "leech_hide_wraps" : "glow_moss" };
      expect(parseClientMsg(JSON.stringify({ ...msg, ignored: "extra" }))).toEqual(msg);
      expect(parseClientMsg(JSON.stringify({ t, item: "x".repeat(129) }))).toBeNull();
    }
    for (const slot of SLOTS) expect(parseClientMsg(JSON.stringify({ t: "unequip", slot }))).toEqual({ t: "unequip", slot });
  });

  it("welcomes guests, creates a character and snapshots it, tolerating bad JSON", async () => {
    const s = await server(), c = await s.open();
    c.ws.send("{invalid"); c.ws.send('{"t":"target","id":{}}');
    c.send({ t: "hello", version: 1 }); expect((await c.next("welcome")).guest).toMatch(/^[A-Za-z0-9_-]{32}$/);
    c.send({ t: "create", name: "Net Frog", cls: "reedguard", look: encodeLook({}) });
    const enter = await c.next("enter"), snap = await c.next("snap");
    expect(enter).toMatchObject({ equip: { main: "reed_glaive", off: "shell_shield", chest: "shell_vest", hands: "reed_bracers" },
      bag: [], stats: { armor: 25, power: 4 } });
    expect(snap.ents.find((e) => e.id === enter.you)?.gear).toBe("glaive,shield,shell_vest,reed_bracers");
    c.send({ t: "unequip", slot: "hands" });
    expect(await c.next("bag")).toMatchObject({ bag: [{ id: "reed_bracers", n: 1 }], equip: { main: "reed_glaive" } });
    expect((await c.next("stats")).stats).toMatchObject({ armor: 22, power: 4 });
    expect(snap.ents.some((e) => e.id === enter.you)).toBe(true); expect(s.world.stats().players).toBe(1);
    expect(s.logs).toEqual([]);
    s.close(); expect(s.world.stats().connections).toBe(0); s.close();
  });

  it("allows matching origins and wallets for agents, and refuses other origins", async () => {
    const s = await server();
    await expect(s.open({ origin: "https://other.example" })).rejects.toThrow(/403/);
    const c = await s.open({ origin: `http://${s.host}`, "x-wallet": "0xABCD" });
    c.send({ t: "hello", version: 1, agent: true }); expect((await c.next("welcome")).guest).toBeUndefined();
    const guest = await s.open(); guest.send({ t: "hello", version: 1, agent: true });
    expect((await guest.next("error")).msg).toMatch(/wallet/);
    await new Promise<void>((resolve) => guest.ws.once("close", () => resolve()));
  });

  it("limits each caller to four sockets, by the address the proxy saw", async () => {
    const s = await server();
    for (let i = 0; i < 4; i++) await s.open({ "x-forwarded-for": `198.51.100.${i}, 192.0.2.1` });
    await expect(s.open({ "x-forwarded-for": "198.51.100.5, 192.0.2.1" })).rejects.toThrow(/429/);
    await s.open({ "x-forwarded-for": "192.0.2.2" });
    expect(s.world.stats().connections).toBe(5);
  });

  it("drops excess messages and closes after three violations", async () => {
    const s = await server(), c = await s.open();
    const closed = new Promise<void>((resolve) => c.ws.once("close", () => resolve()));
    for (let i = 0; i < MAX_MSGS_PER_SEC + 3; i++) c.send({ t: "hello", version: 1 });
    await closed;
    expect(c.messages.filter((m) => m.t === "welcome")).toHaveLength(1);
    expect(s.world.stats().connections).toBe(0);
  });

  it("caps the server at 500 sockets across different IPs", async () => {
    const s = await server();
    for (let i = 0; i < 500; i++) await s.open({ "x-forwarded-for": `192.0.2.${i}` });
    await expect(s.open({ "x-forwarded-for": "198.51.100.1" })).rejects.toThrow(/429/);
    expect(s.world.stats().connections).toBe(500);
  }, 15000);

  it("leaves unrelated upgrades available to another WebSocket handler", async () => {
    const s = await server(), other = new WebSocketServer({ noServer: true });
    s.http.on("upgrade", (req, socket, head) => {
      if (req.url === "/other") other.handleUpgrade(req, socket, head, (ws) => ws.send(JSON.stringify({ t: "pong", at: 7, now: 8 })));
    });
    const c = await s.open({}, `ws://${s.host}/other`);
    expect(await c.next("pong")).toMatchObject({ at: 7, now: 8 });
    expect(s.world.stats().connections).toBe(0);
    other.close();
  });

  it("enforces the 4096 byte payload limit", async () => {
    const s = await server(), c = await s.open();
    const closed = new Promise<number>((resolve) => c.ws.once("close", (code) => resolve(code)));
    c.ws.send("x".repeat(4097)); expect(await closed).toBe(1009);
  });
});
