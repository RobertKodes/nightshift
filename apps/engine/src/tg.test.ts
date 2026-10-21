import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { type BotHandlers, type Update, handleUpdate, kb, setTelegramOffline, setTelegramTransport, telegramCommands, tgResult } from "./social.js";
import type { LiveGame } from "./spectate.js";
import { Profiles, displayName } from "./tg.js";
import { GameBot, INSTALL } from "./tg-bot.js";

// a made-up token: nothing here ever reaches Telegram (every Bot API call goes to the mock transport)
const TOKEN = "123456:TEST-not-a-real-bot-token";
const NOW = 1_800_000_000_000;
const site = (path: string) => `${config.publicUrl}${path}`;

afterEach(() => { setTelegramTransport(null); setTelegramOffline(false); vi.restoreAllMocks(); });

/** A telegram.json as the old Mini App wrote it: one player with a record, one without games. */
function fixture() {
  const file = join(mkdtempSync(join(tmpdir(), "tg-")), "telegram.json");
  const games = (elo: number, played: number) => ({ elo, played, wins: played ? 3 : 0, losses: played ? 1 : 0, draws: 0, streak: 1, best: 2 });
  const profiles = [
    { pid: "0123456789abcdef", tg: "777000111", name: "Pearl Moon", named: true, photo: null, joinedAt: NOW - 30 * 86_400_000, seenAt: NOW, wallet: null, dm: true, games: { chess: games(1236, 4), pinball: games(1200, 0) }, streak: 1, bestStreak: 2, recent: [{ game: "chess", id: "abc", result: "win", vs: "Onyx", elo: 1236, change: 12, at: NOW }], solo: { best: 120_000, bestAt: NOW, runs: 3, last: 9_000, lastAt: NOW } },
    { pid: "fedcba9876543210", tg: "500", name: "Jade", photo: null, joinedAt: NOW, seenAt: NOW, wallet: "0x00000000000000000000000000000000000000aa", walletAt: NOW, dm: false, games: { chess: games(1200, 0), pinball: games(1200, 0) }, streak: 0, bestStreak: 0, recent: [] },
  ];
  const raw = JSON.stringify({ profiles });
  writeFileSync(file, raw, { mode: 0o600 });
  return { file, raw };
}

describe("the Telegram players of the old Mini App", () => {
  it("still loads an existing telegram.json, and never rewrites it", () => {
    const { file, raw } = fixture();
    const ps = new Profiles(file);
    expect(ps.size).toBe(2);
    expect(ps.byTg(777000111)?.games.chess).toMatchObject({ elo: 1236, played: 4 });
    expect(ps.byTg("500")?.name).toBe("Jade");
    expect(ps.byPid("0123456789abcdef")?.tg).toBe("777000111");
    expect(readFileSync(file, "utf8")).toBe(raw);
  });
  it("starts empty on a missing or unreadable file", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "tg-"));
    expect(new Profiles(join(dir, "none.json")).size).toBe(0);
    writeFileSync(join(dir, "bad.json"), "{not json");
    expect(new Profiles(join(dir, "bad.json")).size).toBe(0);
    expect(err).toHaveBeenCalled();
    expect(new Profiles(null).size).toBe(0);
  });
  it("names a player by the public-name rule, or not at all", () => {
    expect(displayName({ first_name: "Pearl", last_name: "Moon" })).toBe("Pearl Moon");
    expect(displayName({ first_name: "IMD", last_name: "Team" })).toBeNull();
  });
});

/** Every Bot API call the code makes, answered ok: no request ever leaves the test. */
function mockTelegram(answer: (method: string, body: Record<string, unknown>) => unknown = () => ({ ok: true, result: { message_id: 1 } })) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const net = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("a test tried to reach the network"); });
  setTelegramTransport(async (url, init) => {
    const method = url.split("/").pop()!.split("?")[0]!;
    // the long poll never answers: the loop stops there
    if (method === "getUpdates") return new Promise(() => {});
    const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
    calls.push({ method, body });
    const j = answer(method, body);
    return { ok: true, status: 200, json: async () => j };
  });
  return { calls, net, sent: () => calls.filter((c) => c.method === "sendMessage") };
}
const msg = (text: string, o: { chat?: number; from?: number; type?: string } = {}): Update => ({ update_id: 1, message: { message_id: 10, chat: { id: o.chat ?? o.from ?? 500, type: o.type ?? "private" }, from: { id: o.from ?? 500, first_name: "Jade" }, text } });
type Keyboard = { inline_keyboard: { text: string; url?: string; callback_data?: string; switch_inline_query?: string }[][] };
const urls = (markup: unknown) => (markup as Keyboard | undefined)?.inline_keyboard.flat().map((b) => b.url).filter((u): u is string => !!u) ?? [];
/** Nothing the bot sends opens a Mini App: no web_app button, no startapp link, no /tg page. */
const noMiniApp = (x: unknown) => { const s = JSON.stringify(x); expect(s).not.toContain("web_app"); expect(s).not.toContain("startapp"); expect(s).not.toMatch(/\/tg[?/"]/); };

describe("the bot", () => {
  const live: LiveGame[] = [
    { game: "chess", id: "c0ffee0123456789abcd", tc: "5+0", players: [{ name: "Pearl" }, { name: "Onyx" }], stake: { currency: "SHIFT", amount: 100_000 }, startedAt: NOW, watch: "/games/chess?watch=c0ffee0123456789abcd", viewers: 3 },
    { game: "pool", id: "b0b0b0b0b0", players: [{ name: "Jade" }, { name: "Opal" }], stake: { currency: "FREE", amount: 0 }, startedAt: NOW, watch: "/games/pool?watch=b0b0b0b0b0", viewers: 0 },
  ];
  const handlers = (o: { games?: LiveGame[] } = {}) => {
    const bot = new GameBot({ profiles: new Profiles(fixture().file), live: () => o.games ?? [], token: () => TOKEN });
    const seen = { link: [] as string[], admin: [] as string[], open: [] as string[] };
    const h: BotHandlers = {
      admin: async (cmd) => { seen.admin.push(cmd); return { text: `admin ${cmd}` }; },
      open: async (cmd) => { seen.open.push(cmd); return cmd === "price" ? { text: "price card" } : null; },
      link: async (_chat, code) => { seen.link.push(code); return code === "company-code-16ch" ? { text: "🌙 Alerts on for Acme." } : null; },
      games: (cmd, args, ctx) => bot.command(cmd, args, ctx),
      inline: (q) => bot.inline(q),
    };
    return { h, seen, bot };
  };
  it("takes the Mini App's Play button down: the menu button is the command list, and the commands are registered", () => {
    const tg = mockTelegram();
    vi.spyOn(console, "log").mockImplementation(() => {});
    telegramCommands(TOKEN, ["900", "-100123"], handlers().h);
    const menus = tg.calls.filter((c) => c.method === "setChatMenuButton");
    expect(menus).toHaveLength(1);
    expect(menus[0]!.body).toEqual({ menu_button: { type: "commands" } });
    const sets = tg.calls.filter((c) => c.method === "setMyCommands");
    const all = sets.find((c) => !c.body.scope)!.body.commands as { command: string; description: string }[];
    expect(all.map((c) => c.command)).toEqual(expect.arrayContaining(["price", "ca", "links", "games", "pinball", "chess", "pool", "play", "live", "challenge", "profile"]));
    expect(all.find((c) => c.command === "play")!.description).toBe("The Game Room on the website");
    expect(sets.some((c) => (c.body.scope as { type?: string } | undefined)?.type === "all_group_chats")).toBe(true);
    // the operator keeps the admin list in a private chat
    expect(sets.some((c) => (c.body.scope as { chat_id?: number } | undefined)?.chat_id === 900)).toBe(true);
    for (const c of tg.calls) noMiniApp(c.body);
    expect(tg.net).not.toHaveBeenCalled();
  });
  it("keeps /start <code> linking a company's alerts, before any game reply", async () => {
    const tg = mockTelegram(), { h, seen } = handlers();
    await handleUpdate(TOKEN, [], h, msg("/start company-code-16ch"));
    expect(seen.link).toEqual(["company-code-16ch"]);
    expect(tg.sent()).toHaveLength(1);
    expect(tg.sent()[0]!.body).toMatchObject({ chat_id: "500", text: "🌙 Alerts on for Acme." });
    expect(seen.open).toEqual([]);
    expect(tg.net).not.toHaveBeenCalled();
  });
  it("answers a plain /start and /play with the Game Room as links to the website, and the install line", async () => {
    const tg = mockTelegram(), { h, seen } = handlers();
    await handleUpdate(TOKEN, [], h, msg("/start"));
    await handleUpdate(TOKEN, [], h, msg("/start lounge", { from: 501 }));
    await handleUpdate(TOKEN, [], h, msg("/play@nightshiftimdbot", { from: 502, chat: -100123, type: "supergroup" }));
    expect(seen.link).toEqual(["lounge"]);
    const [a, b, c] = tg.sent();
    expect(String(a!.body.text)).toContain("Welcome to the night shift, Jade");
    expect(String(b!.body.text)).toContain("NIGHTSHIFT GAME ROOM");
    for (const m of [a!, b!, c!]) {
      expect(String(m.body.text)).toContain(INSTALL);
      expect(urls(m.body.reply_markup)).toEqual(expect.arrayContaining([site("/games"), site("/games/chess"), site("/games/pinball"), site("/games/pool"), site("/games/live")]));
      noMiniApp(m.body);
    }
    // the share button stays in the private chat; a group gets links only
    expect(JSON.stringify(a!.body.reply_markup)).toContain('"switch_inline_query":"chess"');
    expect(JSON.stringify(c!.body.reply_markup)).not.toContain("switch_inline_query");
  });
  it("lists live games with a watch link to each on the website, keeps an operator's /live and the public commands", async () => {
    const tg = mockTelegram(), { h, seen } = handlers({ games: live });
    await handleUpdate(TOKEN, ["900"], h, msg("/live", { from: 900 }));
    expect(seen.admin).toEqual(["live"]);
    await handleUpdate(TOKEN, ["900"], h, msg("/live", { from: 501, chat: -100123, type: "supergroup" }));
    await handleUpdate(TOKEN, [], h, msg("/price"));
    const texts = tg.sent().map((c) => String(c.body.text));
    expect(texts[0]).toBe("admin live");
    expect(texts[1]).toContain("LIVE NOW");
    expect(texts[1]).toContain("💎 100,000 $SHIFT");
    expect(urls(tg.sent()[1]!.body.reply_markup)).toEqual([site("/games/chess?watch=c0ffee0123456789abcd"), site("/games/pool?watch=b0b0b0b0b0"), site("/games/live")]);
    expect(texts[2]).toBe("price card");
    const empty = mockTelegram(), e = handlers();
    await handleUpdate(TOKEN, [], e.h, msg("/watch", { from: 504 }));
    expect(String(empty.sent()[0]!.body.text)).toContain("NO LIVE GAMES RIGHT NOW");
    for (const m of [...tg.sent(), ...empty.sent()]) noMiniApp(m.body);
  });
  it("shows a Telegram player the record they kept from the Mini App, and everyone where to play now", async () => {
    const tg = mockTelegram(), { h } = handlers();
    await handleUpdate(TOKEN, [], h, msg("/profile", { from: 777000111 }));
    await handleUpdate(TOKEN, [], h, msg("/me", { from: 4242 }));
    const [known, unknown] = tg.sent();
    expect(String(known!.body.text)).toContain("<b>Pearl Moon</b>");
    expect(String(known!.body.text)).toContain("NIGHT CHESS · <b>1236</b> Elo · 4 games · 3 W 1 L 0 D");
    expect(String(unknown!.body.text)).toContain("YOUR GAMES ARE ON THE WEBSITE");
    for (const m of [known!, unknown!]) { expect(urls(m.body.reply_markup)).toContain(site("/games")); noMiniApp(m.body); }
    // never the Telegram id or the wallet
    expect(JSON.stringify([known!.body.text, known!.body.reply_markup])).not.toContain("777000111");
    expect(JSON.stringify(known!.body)).not.toContain("0x0000");
  });
  it("posts a challenge card that links to NIGHT CHESS on the website, and rate limits", async () => {
    const tg = mockTelegram(), { h } = handlers();
    await handleUpdate(TOKEN, [], h, msg("/challenge 5+0", { from: 600, chat: -100777, type: "group" }));
    const card = tg.sent()[0]!.body;
    expect(String(card.text)).toContain("NIGHT CHESS CHALLENGE");
    expect(String(card.text)).toContain("5+0 blitz");
    expect(urls(card.reply_markup)).toEqual([site("/games/chess")]);
    noMiniApp(card);
    for (let i = 0; i < 8; i++) await handleUpdate(TOKEN, [], h, msg("/challenge", { from: 600, chat: -100777, type: "group" }));
    expect(tg.sent().length).toBeLessThanOrEqual(4);
  });
  it("rate limits each player's commands, and each group's", async () => {
    const tg = mockTelegram(), { bot } = handlers();
    const ctx = (from: number, group = false) => ({ chat: group ? "-100555" : String(from), private: !group, group, admin: false, from: { id: from, first_name: "Jade" }, callback: false });
    const mine = await Promise.all(Array.from({ length: 10 }, () => bot.command("live", [], ctx(610))));
    expect(mine.filter(Boolean)).toHaveLength(6);
    const group = await Promise.all(Array.from({ length: 10 }, (_, i) => bot.command("live", [], ctx(700 + i, true))));
    expect(group.filter(Boolean)).toHaveLength(4);
    expect(tg.net).not.toHaveBeenCalled();
  });
  it("answers /quiet in a private chat: no game DMs are sent at all", async () => {
    const tg = mockTelegram(), { h } = handlers();
    await handleUpdate(TOKEN, [], h, msg("/quiet", { from: 620 }));
    expect(String(tg.sent()[0]!.body.text)).toContain("no game DMs");
  });
  it("hands inline queries to inline mode, with a personal answer of links only", async () => {
    const tg = mockTelegram(), { h } = handlers();
    await handleUpdate(TOKEN, [], h, { update_id: 2, inline_query: { id: "iq1", from: { id: 700, first_name: "Pearl" }, query: "chess" } });
    const call = tg.calls.find((c) => c.method === "answerInlineQuery")!;
    expect(call.body).toMatchObject({ inline_query_id: "iq1", is_personal: true, cache_time: 5 });
    expect(call.body.button).toBeUndefined();
    expect((call.body.results as unknown[]).length).toBe(3);
    noMiniApp(call.body);
  });
  it("shapes inline results as Telegram's InlineQueryResultArticle, each linking to its game on the website", () => {
    mockTelegram();
    const { bot } = handlers();
    const results = bot.inlineResults({ id: 701, first_name: "Pearl" }, "chess") as { type: string; id: string; title: string; input_message_content: { message_text: string; parse_mode: string }; reply_markup: Keyboard }[];
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.type).toBe("article");
      expect(Buffer.byteLength(r.id)).toBeLessThanOrEqual(64);
      expect(r.title).toMatch(/^♟ Challenge to NIGHT CHESS · (3\+2|5\+0|10\+0)/);
      expect(r.input_message_content.parse_mode).toBe("HTML");
      expect(r.input_message_content.message_text).toContain("<b>Pearl</b> challenges this chat");
      expect(urls(r.reply_markup)).toEqual([site("/games/chess")]);
    }
    expect(new Set(results.map((r) => r.id)).size).toBe(3);
    expect(bot.inlineResults({ id: 701, first_name: "Pearl" }, "chess 10+0")).toHaveLength(1);
    const all = bot.inlineResults({ id: 701, first_name: "Pearl" }, "") as { id: string; reply_markup: Keyboard }[];
    expect(all.map((r) => r.id)).toEqual(expect.arrayContaining(["pinball", "pool", "live"]));
    expect(all.find((r) => r.id === "pool")!.reply_markup.inline_keyboard[0]![0]!.url).toBe(site("/games/pool"));
    expect(all.length).toBeLessThanOrEqual(50);
    noMiniApp(all);
    expect(bot.inlineResults({ id: 1, first_name: "Bot", is_bot: true }, "chess")).toEqual([]);
  });
  it("rate limits inline queries", async () => {
    const tg = mockTelegram(), { bot } = handlers();
    for (let i = 0; i < 35; i++) await bot.inline({ id: `q${i}`, from: { id: 702, first_name: "Pearl" }, query: "pool" });
    expect(tg.calls.filter((c) => c.method === "answerInlineQuery")).toHaveLength(30);
  });
  it("sends nothing at all while offline", async () => {
    setTelegramOffline(true);
    const net = vi.spyOn(globalThis, "fetch");
    expect(await tgResult(TOKEN, "sendMessage", { chat_id: 1, text: "x" })).toEqual({ ok: false, description: "offline" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    telegramCommands(TOKEN, [], handlers().h);
    expect(net).not.toHaveBeenCalled();
  });
  it("turns link, share and callback buttons into Telegram's keyboard", () => {
    expect(kb([[{ text: "Share", switch_inline: "chess" }, { text: "Go", url: "https://getnightshift.tech/games" }, { text: "Refresh", data: "/watch" }]])).toEqual({ inline_keyboard: [[{ text: "Share", switch_inline_query: "chess" }, { text: "Go", url: "https://getnightshift.tech/games" }, { text: "Refresh", callback_data: "/watch" }]] });
  });
});
