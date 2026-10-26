import { afterEach, describe, expect, it, vi } from "vitest";
import { handleUpdate, type BotHandlers } from "./social.js";

afterEach(() => vi.unstubAllGlobals());

describe("private admin notifications command", () => {
  it("routes /notify with its level only for a private admin", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: true })));
    vi.stubGlobal("fetch", fetch);
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
