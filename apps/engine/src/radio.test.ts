import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IDM_RADIO, Radio } from "./radio.js";

const SERVER = "rtmps://dc4-1.rtmp.t.me/s/", KEY = "1795361245:tQ3hHxpQxV0kQmSecret";
type Proc = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; killed: string | null; kill(sig?: string): boolean };
/** yt-dlp answers `hls` (or `ytErr`); ffmpeg keeps running, or exits at once with `ffErr`. */
function fake(o: { hls?: string; ytErr?: string; ffErr?: string } = {}) {
  const calls: { cmd: string; args: string[]; p: Proc }[] = [];
  const spawn = ((cmd: string, args: string[]) => {
    const p = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), killed: null as string | null,
      kill(sig = "SIGTERM") { p.killed = sig; setImmediate(() => p.emit("exit", null)); return true; } }) as Proc;
    calls.push({ cmd, args, p });
    setImmediate(() => {
      if (cmd === "yt-dlp") {
        if (o.hls) p.stdout.emit("data", Buffer.from(`${o.hls}\n`)); else p.stderr.emit("data", Buffer.from(o.ytErr ?? "ERROR: no video"));
        p.emit("close", 0);
      } else if (o.ffErr) { p.stderr.emit("data", Buffer.from(o.ffErr)); p.emit("exit", 1); }
    });
    return p;
  }) as never;
  return { spawn, calls };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 5));
const radio = (f: ReturnType<typeof fake>, now = () => 1_000_000) => {
  const told: string[] = [], file = join(mkdtempSync(join(tmpdir(), "radio-")), "radio.json");
  return { r: new Radio({ file, spawn: f.spawn, now, wait: tick, tell: (t) => told.push(t) }), told, file };
};
const owner = { owner: true, private: true };

describe("IDM radio", () => {
  it("takes the stream key only from the owner in private, keeps it out of every answer", async () => {
    const { r, file } = radio(fake());
    expect(await r.command(["key", SERVER, KEY], { owner: true, private: false })).toMatch(/private chat/);
    expect(await r.command(["key", "rtmps://evil.example/s/", KEY], owner)).toMatch(/not a Telegram stream/);
    expect(await r.command(["key", SERVER, KEY], owner)).toMatch(/saved/);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ server: SERVER, key: KEY });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o077).toBe(0);
    expect(await r.command(["status"], owner)).not.toContain(KEY);
  });

  it("passes the broadcast through unchanged to Telegram's stream, and stops", async () => {
    const f = fake({ hls: "https://video.pscp.tv/live/playlist.m3u8" }), { r } = radio(f);
    await r.command(["key", SERVER, KEY], owner);
    expect(await r.command([], owner)).toMatch(/is on/);
    const yt = f.calls.find((c) => c.cmd === "yt-dlp")!, ff = f.calls.find((c) => c.cmd === "ffmpeg")!;
    expect(yt.args.at(-1)).toBe(IDM_RADIO);
    expect(ff.args).toEqual(expect.arrayContaining(["-i", "https://video.pscp.tv/live/playlist.m3u8", "-c", "copy", `${SERVER}${KEY}`]));
    expect(r.playing).toBe(true);
    expect(await r.command(["stop"], owner)).toMatch(/stopped/);
    expect(ff.p.killed).toBe("SIGTERM");
    expect(r.playing).toBe(false);
  });

  it("says what went wrong without the key, when the group's live stream is not on", async () => {
    const f = fake({ hls: "https://video.pscp.tv/live/playlist.m3u8", ffErr: `rtmps://dc4-1.rtmp.t.me/s/${KEY}: Input/output error` }), { r } = radio(f);
    await r.command(["key", SERVER, KEY], owner);
    const a = (await r.command([], owner))!;
    expect(a).toMatch(/could not start/);
    expect(a).toMatch(/Stream with/);
    expect(a).not.toContain(KEY);
    expect(a).toContain("***");
  });

  it("tells when the broadcast has ended", async () => {
    const { r } = radio(fake({ ytErr: "ERROR: [twitter:broadcast] This live broadcast has ended" }));
    await r.command(["key", SERVER, KEY], owner);
    expect(await r.command([], owner)).toMatch(/broadcast has ended/);
  });

  it("lets anyone in the group start IDM radio, not stop it or play another broadcast, one answer per 2 minutes", async () => {
    let now = 1_000_000;
    const f = fake({ hls: "https://video.pscp.tv/live/playlist.m3u8" }), { r } = radio(f, () => now);
    const member = { owner: false, private: false };
    expect(await r.command([], member)).toMatch(/Listen live/);
    await r.command(["key", SERVER, KEY], owner);
    expect(await r.command([], member)).toBeNull();
    now += 120_001;
    expect(await r.command([], member)).toMatch(/is on/);
    now += 120_001;
    expect(await r.command(["stop"], member)).toMatch(/Only the owner/);
    expect(r.playing).toBe(true);
    now += 120_001;
    expect(await r.command(["https://x.com/i/broadcasts/1OtherOne99"], member)).toMatch(/Only the owner/);
    now += 120_001;
    expect(await r.command([], member)).toMatch(/already on/);
    expect(f.calls.filter((c) => c.cmd === "ffmpeg")).toHaveLength(1);
  });

  it("refuses anything but an X broadcast link from the owner", async () => {
    const { r } = radio(fake());
    await r.command(["key", SERVER, KEY], owner);
    expect(await r.command(["https://evil.example/video.m3u8"], owner)).toMatch(/not an X broadcast/);
    expect(await r.command(["file:///etc/passwd"], owner)).toMatch(/not an X broadcast/);
  });
});
