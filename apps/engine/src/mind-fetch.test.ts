import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { request, dns } = vi.hoisted(() => ({ request: vi.fn(), dns: vi.fn() }));
vi.mock("node:https", async (load) => ({ ...await load<typeof import("node:https")>(), request }));
vi.mock("node:dns/promises", async (load) => ({ ...await load<typeof import("node:dns/promises")>(), lookup: dns }));
import { deliveredMarkdown } from "./mind-live.js";
import { safeFetch } from "./net.js";

type Reply = { status?: number; headers?: Record<string, string>; chunks?: Buffer[]; hang?: boolean };
let replies: Reply[], pinned: string[];
beforeEach(() => {
  replies = []; pinned = []; request.mockReset(); dns.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live fetch forbidden"); }));
  dns.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  request.mockImplementation((_url, options, cb) => {
    const req = new EventEmitter() as EventEmitter & { end(): void };
    options.signal?.addEventListener("abort", () => req.emit("error", options.signal.reason), { once: true });
    req.end = () => queueMicrotask(() => {
      options.lookup("files.example", {}, (_error: unknown, ip: string) => pinned.push(ip));
      const reply = replies.shift()!;
      if (reply.hang) return;
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; destroy(e: Error): void };
      res.statusCode = reply.status ?? 200; res.headers = reply.headers ?? { "content-type": "text/markdown; charset=utf-8" };
      let destroyed = false;
      res.destroy = (e) => { destroyed = true; res.emit("error", e); };
      cb(res);
      for (const chunk of reply.chunks ?? [Buffer.from("# Delivered report")]) { if (destroyed) break; res.emit("data", chunk); }
      if (!destroyed) res.emit("end");
    });
    return req;
  });
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
describe("delivered Markdown safe fetch", () => {
  it("pins a public address and reads Markdown", async () => {
    replies.push({}); expect(await deliveredMarkdown("https://files.example/report.md")).toBe("# Delivered report");
    expect(pinned).toEqual(["93.184.216.34"]);
  });
  it("refuses a redirect to a private IP before making a second connection", async () => {
    replies.push({ status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } });
    expect(await deliveredMarkdown("https://files.example/report.md")).toBeNull(); expect(request).toHaveBeenCalledTimes(1);
  });
  it("checks DNS again on redirects and refuses rebinding", async () => {
    dns.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    replies.push({ status: 302, headers: { location: "/other.md" } });
    expect(await deliveredMarkdown("https://files.example/report.md")).toBeNull(); expect(request).toHaveBeenCalledTimes(1); expect(dns).toHaveBeenCalledTimes(2);
  });
  it("caps bytes while reading and rejects non-text content types", async () => {
    replies.push({ chunks: [Buffer.alloc(40_000), Buffer.alloc(40_001)] });
    await expect(deliveredMarkdown("https://files.example/report.md")).rejects.toThrow("too large");
    replies.push({ headers: { "content-type": "application/octet-stream" } });
    await expect(deliveredMarkdown("https://files.example/report.md")).rejects.toThrow("content type");
  });
  it("uses one total deadline for DNS and all redirect hops", async () => {
    dns.mockImplementation(() => new Promise(() => {}));
    await expect(safeFetch("https://files.example/report.md", {}, { deadlineMs: 10 })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
