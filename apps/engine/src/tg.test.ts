import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "./auth.js";
import { ChessGames } from "./chess.js";
import { type BotHandlers, type Update, handleUpdate, kb, setTelegramOffline, setTelegramTransport, tgResult } from "./social.js";
import { INIT_MAX_AGE, Profiles, appUrl, displayName, parseStartParam, publicView, selfView, signInitData, startLink, validateInitData } from "./tg.js";
import { GameBot } from "./tg-bot.js";
import { type Note, type PlaySources, TgPlay } from "./tg-play.js";
import { tgRoutes } from "./tg-routes.js";

// a made-up token: these tests sign their own initData and never reach Telegram
const TOKEN = "123456:TEST-not-a-real-bot-token";
const NOW = 1_800_000_000_000;
const user = (id: number, first_name: string, extra: Record<string, unknown> = {}) => ({ id, first_name, ...extra });
const init = (u: object, o: { at?: number; token?: string; extra?: Record<string, string> } = {}) =>
  signInitData({ auth_date: Math.floor((o.at ?? NOW) / 1000), query_id: "AAH-test", user: u, ...(o.extra ?? {}) }, o.token ?? TOKEN);

afterEach(() => { setTelegramTransport(null); setTelegramOffline(false); vi.restoreAllMocks(); });

describe("initData validation", () => {
  it("accepts initData signed with the bot token, and reads the user and the start parameter", () => {
    const r = validateInitData(init(user(42, "Pearl"), { extra: { start_param: "chess_0123456789abcdef0123" } }), TOKEN, { now: NOW });
    expect(r).toMatchObject({ ok: true, data: { user: { id: 42, first_name: "Pearl" }, startParam: "chess_0123456789abcdef0123", queryId: "AAH-test" } });
  });
  it("refuses a bad hash: another token, a changed field, a swapped user", () => {
    expect(validateInitData(init(user(42, "Pearl"), { token: "999:another-bot" }), TOKEN, { now: NOW })).toEqual({ ok: false, reason: "hash" });
    const good = init(user(42, "Pearl"));
    const changed = good.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(changed).not.toBe(good);
    expect(validateInitData(changed, TOKEN, { now: NOW })).toEqual({ ok: false, reason: "hash" });
    const p = new URLSearchParams(good); p.set("hash", "0".repeat(64));
    expect(validateInitData(p.toString(), TOKEN, { now: NOW })).toEqual({ ok: false, reason: "hash" });
    // a second hash, or one that is not hex, is malformed
    expect(validateInitData(`${good}&hash=${"a".repeat(64)}`, TOKEN, { now: NOW })).toEqual({ ok: false, reason: "malformed" });
    p.set("hash", "zz"); expect(validateInitData(p.toString(), TOKEN, { now: NOW })).toEqual({ ok: false, reason: "malformed" });
  });
  it("refuses expired initData (auth_date older than the max age) and initData from the future", () => {
    const old = init(user(42, "Pearl"), { at: NOW - (INIT_MAX_AGE + 1) * 1000 });
    expect(validateInitData(old, TOKEN, { now: NOW })).toEqual({ ok: false, reason: "expired" });
    expect(validateInitData(init(user(42, "Pearl"), { at: NOW - 3_600_000 }), TOKEN, { now: NOW, maxAge: 600 })).toEqual({ ok: false, reason: "expired" });
    expect(validateInitData(init(user(42, "Pearl"), { at: NOW + 5 * 60_000 }), TOKEN, { now: NOW })).toEqual({ ok: false, reason: "future" });
    expect(validateInitData(init(user(42, "Pearl"), { at: NOW - 60_000 }), TOKEN, { now: NOW }).ok).toBe(true);
  });
  it("refuses missing initData, a missing token and initData without a user", () => {
    for (const raw of ["", undefined, null, 42]) expect(validateInitData(raw, TOKEN, { now: NOW })).toEqual({ ok: false, reason: "missing" });
    expect(validateInitData(init(user(42, "Pearl")), "", { now: NOW })).toEqual({ ok: false, reason: "missing" });
    const noUser = signInitData({ auth_date: Math.floor(NOW / 1000), query_id: "x" }, TOKEN);
    expect(validateInitData(noUser, TOKEN, { now: NOW })).toEqual({ ok: false, reason: "no-user" });
    expect(validateInitData("not=a&real=thing", TOKEN, { now: NOW })).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("profiles", () => {
  it("creates a profile on first sight, loads it after a restart, and never shows the Telegram id", () => {
    const file = join(mkdtempSync(join(tmpdir(), "tg-")), "telegram.json");
    const a = new Profiles(file, () => NOW);
    const p = a.upsert({ id: 777000111, first_name: "Pearl", last_name: "Moon", photo_url: "https://t.me/i/userpic/320/pearl.jpg" });
    expect(p).toMatchObject({ name: "Pearl Moon", photo: "https://t.me/i/userpic/320/pearl.jpg", joinedAt: NOW, wallet: null, dm: false, games: { chess: { elo: 1200, played: 0 } } });
    expect(p.pid).toMatch(/^[0-9a-f]{16}$/);
    expect(a.upsert({ id: 777000111, first_name: "Pearl" }).pid).toBe(p.pid);
    a.rename(p, "Night Pearl");
    a.upsert({ id: 777000111, first_name: "Changed" });
    expect(p.name).toBe("Night Pearl");
    expect(() => a.rename(p, "NIGHTSHIFT Admin")).toThrow(/reads as ours/);
    a.flush();
    expect(JSON.parse(readFileSync(file, "utf8")).profiles[0].tg).toBe("777000111");
    const b = new Profiles(file);
    expect(b.byTg(777000111)?.pid).toBe(p.pid);
    expect(b.byPid(p.pid)?.name).toBe("Night Pearl");
    const self = JSON.stringify(selfView(p)), pub = JSON.stringify(publicView(p));
    for (const v of [self, pub]) { expect(v).not.toContain("777000111"); expect(v).not.toContain('"tg"'); }
    expect(pub).not.toContain("userpic");
  });
  it("names a player by the public-name rule, and never takes a photo URL from another host", () => {
    expect(displayName({ first_name: "Иван" }, "abcd1234")).toBe("Crew ABCD");
    expect(displayName({ first_name: "IMD", last_name: "Team" }, "ffff0000")).toBe("Crew FFFF");
    const p = new Profiles(null).upsert({ id: 5, first_name: "Jade", photo_url: "https://evil.example/x.jpg" });
    expect(p.photo).toBeNull();
  });
  it("books results: Elo, wins, losses, draws, streaks and the recent list", () => {
    const ps = new Profiles(null, () => NOW), p = ps.upsert({ id: 9, first_name: "Onyx" });
    ps.record(p, { game: "pinball", id: "a1", result: "win", vs: "Jade", rival: 1200 });
    ps.record(p, { game: "pinball", id: "a2", result: "win", vs: "Jade", rival: 1200 });
    expect(p.games.pinball).toMatchObject({ elo: 1224, played: 2, wins: 2, streak: 2, best: 2 });
    expect(p.streak).toBe(2);
    ps.record(p, { game: "chess", id: "c1", result: "loss", vs: "Pearl", rival: 1300, elo: 1191 });
    expect(p.games.chess).toMatchObject({ elo: 1191, losses: 1, streak: 0 });
    expect(p.streak).toBe(0); expect(p.bestStreak).toBe(2);
    expect(p.recent[0]).toMatchObject({ game: "chess", result: "loss", vs: "Pearl", elo: 1191, change: -9 });
  });
});

describe("deep links", () => {
  it("parses the start parameters the Mini App understands, and nothing else", () => {
    expect(parseStartParam("chess_0123456789abcdef0123")).toEqual({ kind: "chess", id: "0123456789abcdef0123" });
    expect(parseStartParam("chess_0123456789abcdef")).toEqual({ kind: "chess", id: "0123456789abcdef" });
    expect(parseStartParam("pinball_abcdef0123")).toEqual({ kind: "pinball", id: "abcdef0123" });
    expect(parseStartParam("watch_abcdef0123")).toEqual({ kind: "watch", game: null, id: "abcdef0123" });
    expect(parseStartParam("watch_chess_0123456789abcdef0123")).toEqual({ kind: "watch", game: "chess", id: "0123456789abcdef0123" });
    expect(parseStartParam("watch_pinball_abcdef0123")).toEqual({ kind: "watch", game: "pinball", id: "abcdef0123" });
    expect(parseStartParam("lounge")).toEqual({ kind: "lounge" });
    expect(parseStartParam("live")).toEqual({ kind: "live" });
    expect(parseStartParam("me")).toEqual({ kind: "me" });
    for (const bad of ["", "chess_", "chess_XYZ", "chess_12", "chess_0123456789abcdef0123/../x", "watch_tetris_abcdef0123", `chess_${"a".repeat(600)}`, "lounge;drop", null, 7]) expect(parseStartParam(bad)).toBeNull();
  });
  it("builds t.me links to the named Mini App or the Main Mini App, and web_app URLs", () => {
    expect(startLink("chess_ab12", { bot: "nightshiftimdbot", app: "play" })).toBe("https://t.me/nightshiftimdbot/play?startapp=chess_ab12");
    expect(startLink("lounge", { bot: "nightshiftimdbot", app: "" })).toBe("https://t.me/nightshiftimdbot?startapp=lounge");
    expect(appUrl("watch_chess_ab", "https://getnightshift.tech")).toBe("https://getnightshift.tech/tg?s=watch_chess_ab");
    expect(appUrl(undefined, "https://getnightshift.tech")).toBe("https://getnightshift.tech/tg");
  });
});

/** Two Telegram players, a chess room with its own clock, and the play coordinator over them. */
function table() {
  let now = NOW;
  const games = new ChessGames(null, () => now);
  const pinball = { queue: async () => { throw new Error("no"); }, joinOpen: async () => { throw new Error("no"); }, cancel: () => {}, get: () => null, lounge: () => ({ open: [], waiting: 0, mine: [] }), getWatch: () => null } as unknown as PlaySources["pinball"];
  const profiles = new Profiles(null, () => now);
  const play = new TgPlay(profiles, { chess: games, pinball }, () => now);
  const notes: [string, Note][] = [];
  play.onNote((p, n) => notes.push([p.name, n]));
  const a = profiles.upsert(user(1001, "Pearl")), b = profiles.upsert(user(1002, "Onyx"));
  return { games, play, profiles, notes, a, b, advance: (ms: number) => { now += ms; games.tick(); } };
}

describe("games played from the Mini App are booked on the profile", () => {
  it("attributes a rated chess game to both players: the join DM for the host, the result for each, Elo from the game", async () => {
    const t = table();
    const host = await t.play.play(t.a, { game: "chess", action: "queue", tc: "3+2" });
    if (host.game !== "chess") throw new Error("chess");
    t.games.listen(host.match.id, host.player, () => {});
    const guest = await t.play.play(t.b, { game: "chess", action: "join", id: host.match.id });
    if (guest.game !== "chess") throw new Error("chess");
    t.games.listen(guest.match.id, guest.player, () => {});
    t.play.tick();
    expect(t.notes).toEqual([["Pearl", { kind: "joined", game: "chess", id: host.match.id, rival: "Onyx" }]]);
    expect(t.play.active(t.a)).toMatchObject([{ game: "chess", id: host.match.id, rival: "Onyx" }]);
    t.advance(5_000);
    // fool's mate: white plays f3 and g4, black mates with Qh4
    const white = guest.match.you === "w" ? guest.player : host.player, black = white === guest.player ? host.player : guest.player;
    t.games.move(host.match.id, white, "f2", "f3"); t.games.move(host.match.id, black, "e7", "e5");
    t.games.move(host.match.id, white, "g2", "g4"); t.games.move(host.match.id, black, "d8", "h4");
    t.play.tick();
    const winner = black === host.player ? t.a : t.b, loser = winner === t.a ? t.b : t.a;
    expect(winner.games.chess).toMatchObject({ played: 1, wins: 1, streak: 1, elo: 1212 });
    expect(loser.games.chess).toMatchObject({ played: 1, losses: 1, elo: 1188 });
    expect(winner.recent[0]).toMatchObject({ game: "chess", id: host.match.id, result: "win", vs: loser.name, tc: "3+2", reason: "checkmate", change: 12 });
    expect(t.notes.filter(([, n]) => n.kind === "result").map(([who, n]) => [who, n.kind === "result" && n.result])).toEqual(expect.arrayContaining([[winner.name, "win"], [loser.name, "loss"]]));
    // booked once: the seats are gone after the result
    t.play.tick();
    expect(winner.games.chess.played).toBe(1);
    expect(t.play.seats).toHaveLength(0);
  });
  it("does not book a game too short to rate, and keeps a profile out of its own game", async () => {
    const t = table();
    const host = await t.play.play(t.a, { game: "chess", action: "queue", tc: "5+0" });
    if (host.game !== "chess") throw new Error("chess");
    t.games.listen(host.match.id, host.player, () => {});
    await expect(t.play.play(t.a, { game: "chess", action: "join", id: host.match.id })).rejects.toThrow(/your own game/);
    const guest = await t.play.play(t.b, { game: "chess", action: "join", id: host.match.id });
    if (guest.game !== "chess") throw new Error("chess");
    t.advance(5_000);
    t.games.resign(host.match.id, guest.player);
    t.play.tick();
    expect(t.a.games.chess.played).toBe(0); expect(t.b.games.chess.played).toBe(0);
    expect(t.notes.some(([, n]) => n.kind === "result")).toBe(false);
  });
  it("turns a Telegram challenge into one game for exactly its two players, and tells the host", async () => {
    const t = table();
    const inv = t.play.invite(t.a, "10+0");
    expect(t.play.invite(t.a, "10+0").id).toBe(inv.id); // one per clock: a shared card never multiplies
    expect(t.play.resolve(t.b, { kind: "chess", id: inv.id })).toMatchObject({ kind: "invite", own: false, invite: { id: inv.id, tc: "10+0", host: { name: "Pearl" } } });
    expect(() => t.play.accept(t.a, inv.id)).toThrow(/your own challenge/);
    const g = t.play.accept(t.b, inv.id);
    expect(g.match).toMatchObject({ tc: "10+0", status: "waiting", players: [{ name: "Pearl" }, { name: "Onyx" }] });
    expect(t.notes).toEqual([["Pearl", { kind: "accepted", game: "chess", id: g.match.id, rival: "Onyx", tc: "10+0" }]]);
    const c = t.profiles.upsert(user(1003, "Late"));
    expect(() => t.play.accept(c, inv.id)).toThrow(/Someone else accepted/);
    // the host's link now resumes their own seat; the clock starts once both are connected
    const own = t.play.resolve(t.a, { kind: "chess", id: inv.id });
    expect(own).toMatchObject({ kind: "seat", game: "chess", id: g.match.id });
    t.games.listen(g.match.id, g.player, () => {});
    expect(t.games.get(g.match.id, g.player).status).toBe("waiting");
    t.games.listen(g.match.id, (own as { player: string }).player, () => {});
    expect(t.games.get(g.match.id, g.player).status).toBe("countdown");
  });
  it("resolves a deep link to your own seat, an open table to join, a game to watch, or nothing", async () => {
    const t = table();
    const host = await t.play.play(t.a, { game: "chess", action: "queue", tc: "3+2" });
    if (host.game !== "chess") throw new Error("chess");
    t.games.listen(host.match.id, host.player, () => {});
    expect(t.play.resolve(t.a, { kind: "chess", id: host.match.id })).toEqual({ kind: "seat", game: "chess", id: host.match.id, player: host.player });
    expect(t.play.resolve(t.b, { kind: "chess", id: host.match.id })).toEqual({ kind: "join", game: "chess", id: host.match.id, host: "Pearl", tc: "3+2" });
    // nobody's seat token ever reaches another player through a link
    expect(JSON.stringify(t.play.resolve(t.b, { kind: "chess", id: host.match.id }))).not.toContain(host.player);
    await t.play.play(t.b, { game: "chess", action: "join", id: host.match.id });
    const c = t.profiles.upsert(user(1003, "Jade"));
    expect(t.play.resolve(c, { kind: "chess", id: host.match.id })).toEqual({ kind: "watch", game: "chess", id: host.match.id });
    expect(t.play.resolve(c, { kind: "watch", game: null, id: host.match.id })).toEqual({ kind: "watch", game: "chess", id: host.match.id });
    expect(t.play.resolve(c, { kind: "chess", id: "ffffffffffffffffffff" })).toEqual({ kind: "gone", game: "chess" });
    expect(t.play.resolve(c, { kind: "chess", id: "0123456789abcdef" })).toEqual({ kind: "gone", game: "chess" });
    expect(t.play.resolve(c, null)).toEqual({ kind: "lounge" });
    expect(t.play.resolve(c, { kind: "live" })).toEqual({ kind: "live" });
  });
  it("closes an accepted challenge unplayed when the host never sits down", () => {
    const t = table();
    const inv = t.play.invite(t.a, "3+2"), g = t.play.accept(t.b, inv.id);
    t.games.listen(g.match.id, g.player, () => {});
    t.advance(5 * 60_000 + 1);
    expect(t.games.get(g.match.id, g.player)).toMatchObject({ done: true, startedAt: null, expired: "away" });
    t.play.tick();
    expect(t.play.seats).toHaveLength(0);
    expect(t.b.games.chess.played).toBe(0);
  });
  it("books a verified pinball duel on both profiles, with Elo from each other's", () => {
    const profiles = new Profiles(null, () => NOW), a = profiles.upsert(user(1, "Pearl")), b = profiles.upsert(user(2, "Onyx"));
    b.games.pinball.elo = 1400;
    const view = (me: "a" | "b") => ({ id: "aaaaabbbbb", startedAt: NOW, done: true, draw: false, void: null, winnerIsYou: me === "a", movedTo: null,
      players: [{ name: "Pearl", you: me === "a", finished: true, score: 52_000 }, { name: "Onyx", you: me === "b", finished: true, score: 31_000 }] });
    const pinball = { get: (_id: string, p: string) => view(p === "seat-a" ? "a" : "b") } as unknown as PlaySources["pinball"];
    const play = new TgPlay(profiles, { chess: new ChessGames(null), pinball }, () => NOW);
    play.attach(a, "pinball", "aaaaabbbbb", "seat-a"); play.attach(b, "pinball", "aaaaabbbbb", "seat-b");
    play.tick();
    expect(a.games.pinball).toMatchObject({ played: 1, wins: 1, elo: 1200 + 18 });
    expect(b.games.pinball).toMatchObject({ played: 1, losses: 1, elo: 1400 - 18 });
    expect(a.recent[0]).toMatchObject({ result: "win", vs: "Onyx", reason: "52,000 to 31,000" });
  });
});

/** Every Bot API call the code makes, answered ok: no request ever leaves the test. */
function mockTelegram(answer: (method: string, body: Record<string, unknown>) => unknown = () => ({ ok: true, result: { message_id: 1 } })) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const net = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("a test tried to reach the network"); });
  setTelegramTransport(async (url, init) => {
    const method = url.split("/").pop()!.split("?")[0]!, body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
    calls.push({ method, body });
    const j = answer(method, body);
    return { ok: true, status: 200, json: async () => j };
  });
  return { calls, net, sent: () => calls.filter((c) => c.method === "sendMessage") };
}
const msg = (text: string, o: { chat?: number; from?: number; type?: string } = {}): Update => ({ update_id: 1, message: { message_id: 10, chat: { id: o.chat ?? o.from ?? 500, type: o.type ?? "private" }, from: { id: o.from ?? 500, first_name: "Jade" }, text } });

describe("the bot", () => {
  const handlers = (o: Partial<BotHandlers> = {}) => {
    const profiles = new Profiles(null, () => NOW), play = new TgPlay(profiles, undefined, () => NOW);
    const bot = new GameBot({ profiles, play, live: () => [], token: () => TOKEN });
    const seen = { link: [] as string[], admin: [] as string[], open: [] as string[], started: [] as number[] };
    const h: BotHandlers = {
      admin: async (cmd) => { seen.admin.push(cmd); return { text: `admin ${cmd}` }; },
      open: async (cmd) => { seen.open.push(cmd); return cmd === "price" ? { text: "price card" } : null; },
      link: async (_chat, code) => { seen.link.push(code); return code === "company-code-16ch" ? { text: "🌙 Alerts on for Acme." } : null; },
      started: (u) => { seen.started.push(u.id); bot.started(u); },
      games: (cmd, args, ctx) => bot.command(cmd, args, ctx),
      inline: (q) => bot.inline(q),
      ...o,
    };
    return { h, seen, bot, profiles, play };
  };
  it("keeps /start <code> linking a company's alerts, before any game reply", async () => {
    const tg = mockTelegram(), { h, seen, profiles } = handlers();
    await handleUpdate(TOKEN, [], h, msg("/start company-code-16ch"));
    expect(seen.link).toEqual(["company-code-16ch"]);
    expect(tg.sent()).toHaveLength(1);
    expect(tg.sent()[0]!.body).toMatchObject({ chat_id: "500", text: "🌙 Alerts on for Acme." });
    expect(seen.open).toEqual([]);
    // pressing Start also allows game DMs
    expect(profiles.byTg(500)?.dm).toBe(true);
    expect(tg.net).not.toHaveBeenCalled();
  });
  it("answers a plain /start, or a code that is not one, with the Game Room and a web_app button", async () => {
    const tg = mockTelegram(), { h, seen } = handlers();
    await handleUpdate(TOKEN, [], h, msg("/start"));
    await handleUpdate(TOKEN, [], h, msg("/start lounge", { from: 501 }));
    expect(seen.link).toEqual(["lounge"]);
    const [a, b] = tg.sent();
    expect(String(a!.body.text)).toContain("Welcome to the night shift, Jade");
    expect(JSON.stringify(a!.body.reply_markup)).toContain('"web_app":{"url":"');
    expect(String(b!.body.text)).toContain("NIGHTSHIFT GAME ROOM");
  });
  it("routes /play, /live and /profile, keeps an operator's /live and the public commands", async () => {
    const tg = mockTelegram(), { h, seen } = handlers();
    await handleUpdate(TOKEN, ["900"], h, msg("/live", { from: 900 }));
    expect(seen.admin).toEqual(["live"]);
    await handleUpdate(TOKEN, ["900"], h, msg("/live", { from: 501, chat: -100123, type: "supergroup" }));
    await handleUpdate(TOKEN, [], h, msg("/price"));
    await handleUpdate(TOKEN, [], h, msg("/play@nightshiftimdbot", { from: 502, chat: -100123, type: "supergroup" }));
    await handleUpdate(TOKEN, [], h, msg("/profile", { from: 503 }));
    const texts = tg.sent().map((c) => String(c.body.text));
    expect(texts[0]).toBe("admin live");
    expect(texts[1]).toContain("NO LIVE GAMES RIGHT NOW");
    expect(texts[2]).toBe("price card");
    expect(texts[3]).toContain("NIGHTSHIFT GAME ROOM");
    // in a group a web_app button is not allowed: a t.me link opens the Mini App instead
    expect(JSON.stringify(tg.sent()[3]!.body.reply_markup)).toContain("https://t.me/nightshiftimdbot");
    expect(JSON.stringify(tg.sent()[3]!.body.reply_markup)).not.toContain("web_app");
    expect(texts[4]).toContain("NIGHT CHESS · <b>1200</b> Elo");
  });
  it("posts a challenge card whose button opens the Mini App on that challenge, and rate limits", async () => {
    const tg = mockTelegram(), { h, play } = handlers();
    await handleUpdate(TOKEN, [], h, msg("/challenge 5+0", { from: 600, chat: -100777, type: "group" }));
    const card = tg.sent()[0]!.body;
    expect(String(card.text)).toContain("NIGHT CHESS CHALLENGE");
    expect(String(card.text)).toContain("5+0 blitz");
    const url = (card.reply_markup as { inline_keyboard: { url: string }[][] }).inline_keyboard[0]![0]!.url;
    expect(url).toMatch(/^https:\/\/t\.me\/nightshiftimdbot\?startapp=chess_[0-9a-f]{16}$/);
    expect(play.invites.size).toBe(1);
    for (let i = 0; i < 8; i++) await handleUpdate(TOKEN, [], h, msg("/challenge", { from: 600, chat: -100777, type: "group" }));
    expect(tg.sent().length).toBeLessThanOrEqual(4);
  });
  it("hands inline queries to inline mode, with a personal answer", async () => {
    const tg = mockTelegram(), { h } = handlers();
    await handleUpdate(TOKEN, [], h, { update_id: 2, inline_query: { id: "iq1", from: { id: 700, first_name: "Pearl" }, query: "chess" } });
    const call = tg.calls.find((c) => c.method === "answerInlineQuery")!;
    expect(call.body).toMatchObject({ inline_query_id: "iq1", is_personal: true, cache_time: 5 });
    expect((call.body.results as unknown[]).length).toBe(3);
  });
  it("shapes inline results as Telegram's InlineQueryResultArticle: one challenge per clock, or the one asked for", () => {
    mockTelegram();
    const { bot } = handlers();
    const results = bot.inlineResults({ id: 701, first_name: "Pearl" }, "chess") as { type: string; id: string; title: string; description: string; input_message_content: { message_text: string; parse_mode: string }; reply_markup: { inline_keyboard: { text: string; url: string }[][] } }[];
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.type).toBe("article");
      expect(Buffer.byteLength(r.id)).toBeLessThanOrEqual(64);
      expect(r.title).toMatch(/^♟ Challenge to NIGHT CHESS · (3\+2|5\+0|10\+0)/);
      expect(r.input_message_content.parse_mode).toBe("HTML");
      expect(r.input_message_content.message_text).toContain("<b>Pearl</b> (1200 Elo) challenges you");
      expect(r.reply_markup.inline_keyboard[0]![0]!.url).toMatch(/^https:\/\/t\.me\/nightshiftimdbot\?startapp=chess_[0-9a-f]{16}$/);
    }
    expect(new Set(results.map((r) => r.id)).size).toBe(3);
    expect(bot.inlineResults({ id: 701, first_name: "Pearl" }, "chess 10+0")).toHaveLength(1);
    const all = bot.inlineResults({ id: 701, first_name: "Pearl" }, "") as { id: string }[];
    expect(all.map((r) => r.id)).toEqual(expect.arrayContaining(["pinball", "live"]));
    expect(all.length).toBeLessThanOrEqual(50);
    expect(bot.inlineResults({ id: 1, first_name: "Bot", is_bot: true }, "chess")).toEqual([]);
  });
  it("DMs only players who pressed Start, and stops after they block the bot", async () => {
    const tg = mockTelegram((method) => (method === "sendMessage" ? { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } : { ok: true })), { bot, profiles } = handlers();
    const p = profiles.upsert(user(800, "Pearl"));
    expect(await bot.note(p, { kind: "joined", game: "chess", id: "ab", rival: "Onyx" })).toBe(false);
    expect(tg.sent()).toHaveLength(0);
    profiles.setDm(p, true);
    await bot.note(p, { kind: "result", game: "chess", id: "ab", rival: "Onyx", result: "win", elo: 1212, change: 12, reason: "checkmate" });
    expect(tg.sent()).toHaveLength(1);
    expect(String(tg.sent()[0]!.body.text)).toContain("Victory");
    expect(p.dm).toBe(false);
  });
  it("sends nothing at all while offline", async () => {
    setTelegramOffline(true);
    const net = vi.spyOn(globalThis, "fetch");
    expect(await tgResult(TOKEN, "sendMessage", { chat_id: 1, text: "x" })).toEqual({ ok: false, description: "offline" });
    expect(net).not.toHaveBeenCalled();
  });
  it("turns web_app and share buttons into Telegram's keyboard", () => {
    expect(kb([[{ text: "Open", web_app: "https://x.test/tg" }, { text: "Share", switch_inline: "chess" }, { text: "Go", url: "https://t.me/x" }, { text: "Refresh", data: "/watch" }]])).toEqual({ inline_keyboard: [[{ text: "Open", web_app: { url: "https://x.test/tg" } }, { text: "Share", switch_inline_query: "chess" }, { text: "Go", url: "https://t.me/x" }, { text: "Refresh", callback_data: "/watch" }]] });
  });
});

class Res extends EventEmitter { statusCode = 0; headers: Record<string, string> = {}; body = ""; writeHead(s: number, h?: Record<string, string>) { this.statusCode = s; Object.assign(this.headers, h ?? {}); return this; } end(b?: string) { this.body = b ?? ""; } }
describe("the Mini App API", () => {
  const call = async (path: string, auth: string | undefined, method = "GET", input: Record<string, unknown> = {}) => {
    const profiles = callCtx.profiles, res = new Res();
    const req = { method, headers: auth === undefined ? {} : { authorization: auth }, socket: { remoteAddress: "tg-tests" } } as unknown as IncomingMessage;
    const url = new URL(`http://x${path}`);
    await tgRoutes(req, res as unknown as ServerResponse, url.pathname, { json: (r, s, b, h) => { (r as unknown as Res).writeHead(s, h); r.end(JSON.stringify(b)); }, body: async () => input, limited: () => false, url, auth: callCtx.auth, profiles, play: callCtx.play, token: TOKEN, now: NOW });
    return { status: res.statusCode, json: JSON.parse(res.body || "null"), raw: res.body, headers: res.headers };
  };
  const profiles = new Profiles(null, () => NOW);
  const callCtx = { profiles, play: new TgPlay(profiles, undefined, () => NOW), auth: { verify: async () => "s.0xabc.1.mac" } as unknown as Auth };
  it("checks initData on every request: missing, forged and expired are refused", async () => {
    expect((await call("/api/tg/me", undefined)).status).toBe(401);
    expect((await call("/api/tg/me", `tma ${init(user(42, "Pearl"), { token: "1:forged" })}`)).json).toMatchObject({ reason: "hash" });
    expect((await call("/api/tg/me", `tma ${init(user(42, "Pearl"), { at: NOW - 2 * 86_400_000 })}`)).json).toMatchObject({ reason: "expired" });
    expect((await call("/api/tg/me", `Bearer ${init(user(42, "Pearl"))}`)).status).toBe(401);
  });
  it("creates the profile from checked initData and never sends the Telegram id", async () => {
    const r = await call("/api/tg/me", `tma ${init(user(424242, "Pearl"))}`);
    expect(r.status).toBe(200);
    expect(r.json.profile).toMatchObject({ name: "Pearl", games: { chess: { elo: 1200 } } });
    expect(r.raw).not.toContain("424242");
    const renamed = await call("/api/tg/me", `tma ${init(user(424242, "Pearl"))}`, "POST", { name: "Pearl Night" });
    expect(renamed.json.profile.name).toBe("Pearl Night");
    expect((await call("/api/tg/start?p=lounge", `tma ${init(user(424242, "Pearl"))}`)).json).toEqual({ kind: "lounge" });
  });
  it("links a wallet with the site's signed sign-in message, and returns a session for framed pages", async () => {
    const r = await call("/api/tg/wallet", `tma ${init(user(4343, "Jade"))}`, "POST", { address: "0x00000000000000000000000000000000000000aa", nonce: "n", signature: "0x" });
    expect(r.status).toBe(200);
    expect(r.json.profile.wallet).toBe("0x00000000000000000000000000000000000000aa");
    expect(r.json.session).toBe("s.0xabc.1.mac");
    expect(r.headers["Set-Cookie"]).toMatch(/^ns_session=.*HttpOnly; SameSite=Lax/);
    expect((await call("/api/tg/wallet", `tma ${init(user(4343, "Jade"))}`, "POST", { address: "nope" })).status).toBe(400);
  });
});
