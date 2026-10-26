import { afterEach, describe, expect, it, vi } from "vitest";
import { handleUpdate, setTelegramTransport, type BotHandlers } from "./social.js";

afterEach(() => { setTelegramTransport(null); vi.unstubAllGlobals(); });

describe("private admin notifications command", () => {
  it("routes /notify with its level only for a private admin", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: true })));
    vi.stubGlobal("fetch", fetch);
    setTelegramTransport(fetch);
    const h: BotHandlers = { open: vi.fn(async () => null), admin: vi.fn(async () => ({ text: "Notifications updated" })) };
    const update = (id: number, type = "private", text = "/notify money") => ({ update_id: 1, message: { message_id: 1, from: { id }, chat: { id: type === "private" ? id : -100, type }, text } });
    await handleUpdate("TEST", ["1"], h, update(1));
    expect(h.admin).toHaveBeenCalledWith("notify", ["money"], expect.objectContaining({ chat: "1", group: false }));
    await handleUpdate("TEST", ["1"], h, update(2));
    await handleUpdate("TEST", ["1"], h, update(1, "supergroup"));
    expect(h.admin).toHaveBeenCalledTimes(1);
    for (const command of ["/announce off", "/reserve dry"]) {
      await handleUpdate("TEST", ["1"], h, update(1, "private", command));
      await handleUpdate("TEST", ["1"], h, update(1, "supergroup", command));
      await handleUpdate("TEST", ["1"], h, update(2, "private", command));
    }
    expect(h.admin).toHaveBeenCalledTimes(3);
    expect(h.admin).toHaveBeenCalledWith("announce", ["off"], expect.objectContaining({ group: false }));
    expect(h.admin).toHaveBeenCalledWith("reserve", ["dry"], expect.objectContaining({ group: false }));
    expect(fetch).toHaveBeenCalled();
  });
});

describe("ACP private owner commands", () => {
  it("routes every ACP verb only in the owner's own private chat before public or game handlers", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: true })));
    vi.stubGlobal("fetch", fetch);
    setTelegramTransport(fetch);
    const h: BotHandlers = { open: vi.fn(async () => null), games: vi.fn(async () => null), admin: vi.fn(async () => ({ text: "ACP private" })) };
    const update = (from: number, chat: number, type: string | undefined, verb: string) => ({ update_id: 1, message: { message_id: 1, from: { id: from }, chat: { id: chat, type: type as string }, text: `/acp${verb ? ` ${verb}` : ""}` } });
    const verbs = ["", "status", "setup", "setup done", "agent", "signer", "signer done", "visible", "hide", "on", "off"];
    for (const verb of verbs) {
      await handleUpdate("TEST", ["1"], h, update(1, 1, "private", verb));
      expect(h.admin).toHaveBeenLastCalledWith("acp", verb ? verb.split(" ") : [], { chat: "1", from: "1", private: true, group: false });
      for (const [from, chat, type] of [[2, 2, "private"], [1, -100, "supergroup"], [1, -100, "group"], [1, -100, "channel"], [1, 2, "private"], [1, 1, undefined]] as const) await handleUpdate("TEST", ["1"], h, update(from, chat, type, verb));
    }
    expect(h.admin).toHaveBeenCalledTimes(verbs.length); expect(h.open).not.toHaveBeenCalled(); expect(h.games).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(verbs.length);
    for (const [, init] of fetch.mock.calls as unknown as [string, RequestInit][]) expect(JSON.parse(init.body as string)).toMatchObject({ chat_id: "1", text: "ACP private" });
  });

  it("refuses group callbacks and never echoes raw ACP handler errors", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: true })));
    vi.stubGlobal("fetch", fetch);
    setTelegramTransport(fetch);
    const h: BotHandlers = { open: vi.fn(async () => null), admin: vi.fn(async () => { throw new Error("accessToken=private-sensitive"); }) };
    await handleUpdate("TEST", ["1"], h, { update_id: 1, callback_query: { id: "callback", from: { id: 1 }, data: "/acp setup", message: { message_id: 1, chat: { id: -100, type: "supergroup" } } } });
    expect(h.admin).not.toHaveBeenCalled();
    await handleUpdate("TEST", ["1"], h, { update_id: 2, message: { message_id: 2, from: { id: 1 }, chat: { id: 1, type: "private" }, text: "/acp setup" } });
    for (const [, init] of fetch.mock.calls as unknown as [string, RequestInit][]) expect(init.body).not.toContain("private-sensitive");
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("sendMessage"), expect.objectContaining({ body: expect.stringContaining("ACP command failed. Try /acp status.") }));
  });
});
