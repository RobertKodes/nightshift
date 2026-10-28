import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";

/**
 * /idmradio: IDM radio, the live broadcast on X, played into the community group's Telegram live stream.
 * Telegram gives a group admin the stream's server and key (video chat, then "Stream with…"); the owner
 * hands them to the bot once, in a private chat, and they stay in the data folder, never printed. yt-dlp
 * finds the broadcast's live video and ffmpeg passes picture and sound through unchanged (no re-encoding),
 * until /idmradio stop or the broadcast ends. A server restart picks it up again. Anyone in the main group
 * may start IDM radio and ask its status; only the owner stops it, plays another broadcast or sets the key.
 */
export const IDM_RADIO = "https://x.com/i/broadcasts/1pKkOXBAmryKj";
const BROADCAST = /^https:\/\/(?:x|twitter)\.com\/i\/broadcasts\/[A-Za-z0-9]{8,24}$/;
const SERVER = /^rtmps:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.t\.me(?::\d{2,5})?\/s\/?$/;
const KEY = /^\d{3,20}:[A-Za-z0-9_-]{8,128}$/;
/** Restarts allowed in an hour before the radio gives up and tells the owner. */
const RESTARTS = 10;
/** The group gets one answer per this long, so /idmradio cannot flood the chat. */
const PUBLIC_MS = 120_000;

type Saved = { server?: string; key?: string; on?: string | null };
export type RadioDeps = {
  file: string | null;
  spawn?: typeof nodeSpawn;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  /** A note to the owner (the broadcast ended, the stream stopped). */
  tell: (text: string) => void;
  log?: (s: string) => void;
};

export class Radio {
  #s: Saved = {};
  #proc: ChildProcess | null = null;
  #url: string | null = null;
  #since = 0;
  #restarts: number[] = [];
  #lastError = "";
  #starting = false;
  #publicAt = 0;
  readonly #spawn: typeof nodeSpawn;
  readonly #now: () => number;
  readonly #wait: (ms: number) => Promise<void>;

  constructor(private d: RadioDeps) {
    this.#spawn = d.spawn ?? nodeSpawn;
    this.#now = d.now ?? Date.now;
    this.#wait = d.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    try { if (d.file && existsSync(d.file)) this.#s = JSON.parse(readFileSync(d.file, "utf8")) as Saved; } catch { this.#s = {}; }
  }

  #save() { if (this.d.file) writeAtomic(this.d.file, JSON.stringify(this.#s), { mode: 0o600 }); }
  /** Anything ffmpeg or yt-dlp says, without the stream key. */
  #clean(s: string) { const k = this.#s.key; return (k ? s.split(k).join("***") : s).replace(/\s+/g, " ").trim().slice(0, 240); }

  get playing() { return Boolean(this.#proc); }

  /**
   * /idmradio from the owner (anywhere it reaches the bot) or from anyone in the main group. The key is
   * only taken from the owner in a private chat. null: say nothing (the group asked again too soon).
   */
  async command(args: string[], who: { owner: boolean; private: boolean }): Promise<string | null> {
    const [a = "", ...rest] = args;
    if (!who.owner) {
      const now = this.#now();
      if (now - this.#publicAt < PUBLIC_MS) return null;
      this.#publicAt = now;
      if (a === "status") return this.status();
      if (a) return "📻 Send /idmradio to start IDM radio. Only the owner can stop it or play another broadcast.";
      if (!this.#s.server || !this.#s.key) return "📻 IDM radio is not set up yet.";
      return this.#proc ? "📻 IDM radio is already on: open the live stream at the top of the chat." : this.start(IDM_RADIO);
    }
    if (a === "key") {
      if (!who.private) return "Send the stream key only in your private chat with me, never in a group.";
      return this.setKey(rest[0] ?? "", rest[1] ?? "");
    }
    if (a === "stop") return this.stop();
    if (a === "status") return this.status();
    if (a && !BROADCAST.test(a)) return "That is not an X broadcast link. It looks like https://x.com/i/broadcasts/…";
    return this.start(a || IDM_RADIO);
  }

  setKey(server: string, key: string): string {
    if (!SERVER.test(server) || !KEY.test(key)) return "That is not a Telegram stream server and key. In the group: video chat, then Stream with…, and copy the Server URL and the Stream key: /idmradio key <server URL> <stream key>";
    this.#s.server = server.endsWith("/") ? server : `${server}/`;
    this.#s.key = key;
    this.#save();
    return "📻 Stream key saved. I deleted your message. Start the live stream in the group (video chat, then Stream with…, Start streaming), then send /idmradio.";
  }

  status(): string {
    if (!this.#s.server || !this.#s.key) return "📻 IDM radio is not set up. In the group: video chat, then Stream with…, then send me /idmradio key <server URL> <stream key> here.";
    if (!this.#proc) return `📻 IDM radio is off.${this.#lastError ? ` Last problem: ${this.#lastError}` : ""} Send /idmradio to start it.`;
    const min = Math.round((this.#now() - this.#since) / 60_000);
    return `📻 IDM radio is on, for ${min} min${this.#restarts.length ? `, ${this.#restarts.length} reconnect(s) this hour` : ""}. /idmradio stop to end it.`;
  }

  stop(): string {
    const was = Boolean(this.#proc);
    this.#url = null;
    this.#s.on = null; this.#save();
    this.#proc?.kill("SIGTERM");
    this.#proc = null;
    return was ? "📻 IDM radio stopped. End the live stream in the group when you like." : "📻 IDM radio was not on.";
  }

  /** Starts the broadcast and answers once it has run for a few seconds, or with what went wrong. */
  async start(url: string = IDM_RADIO): Promise<string> {
    if (!this.#s.server || !this.#s.key) return this.status();
    if (this.#proc || this.#starting) return "📻 IDM radio is already on. /idmradio stop first to play another broadcast.";
    this.#starting = true;
    try {
      this.#url = url; this.#restarts = []; this.#lastError = "";
      const ok = await this.#play();
      if (!ok) { this.#url = null; return `📻 IDM radio could not start: ${this.#lastError || "no answer"}. The group's live stream must be on first: an admin opens the video chat, then Stream with…, then Start streaming.`; }
      this.#s.on = url; this.#save();
      return "📻 IDM radio is on: open the live stream at the top of the chat.";
    } finally { this.#starting = false; }
  }

  /** After a server restart: plays again what was on. */
  async resume(): Promise<void> {
    if (!this.#s.on || this.#proc) return;
    const r = await this.start(this.#s.on);
    if (!this.#proc) this.d.tell(`${r} (after the server restarted)`);
  }

  /** The broadcast's live video address, or null with the reason kept. */
  async #resolve(url: string): Promise<string | null> {
    const out = await this.#run("yt-dlp", ["--no-warnings", "-g", "-f", "live-2750/best[height<=720]/best", url], 60_000);
    const hls = out.stdout.split("\n").map((l) => l.trim()).find((l) => /^https:\/\//.test(l));
    if (!hls) this.#lastError = /ended|not.*live|no longer|offline/i.test(out.stderr) ? "the broadcast has ended" : this.#clean(out.stderr) || "the broadcast could not be read";
    return hls ?? null;
  }

  async #play(): Promise<boolean> {
    const url = this.#url;
    if (!url) return false;
    const hls = await this.#resolve(url);
    if (!hls || this.#url !== url) return false;
    const p = this.#spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-rw_timeout", "15000000", "-i", hls, "-c", "copy", "-bsf:a", "aac_adtstoasc", "-f", "flv", `${this.#s.server}${this.#s.key}`], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr?.on("data", (c: Buffer) => { err = (err + c.toString()).slice(-2000); });
    this.#proc = p; this.#since = this.#since && this.#restarts.length ? this.#since : this.#now();
    const exited = new Promise<number>((r) => p.once("exit", (code) => r(code ?? -1)));
    p.once("error", (e) => { err += e.message; });
    void exited.then(async (code) => {
      if (this.#proc !== p) return;
      this.#proc = null;
      this.#lastError = this.#clean(err) || `ffmpeg stopped (${code})`;
      this.d.log?.(`radio: ${this.#lastError}`);
      if (this.#url !== url) return;
      const now = this.#now();
      this.#restarts = this.#restarts.filter((t) => now - t < 3_600_000);
      if (this.#restarts.length >= RESTARTS) { this.#url = null; this.#s.on = null; this.#save(); this.d.tell(`📻 IDM radio stopped after ${RESTARTS} reconnects in an hour: ${this.#lastError}`); return; }
      this.#restarts.push(now);
      await this.#wait(5_000);
      if (this.#url === url && !(await this.#play())) {
        this.#url = null; this.#s.on = null; this.#save();
        this.d.tell(`📻 IDM radio stopped: ${this.#lastError}.`);
      }
    });
    // it counts as playing once ffmpeg has kept the stream up for a few seconds
    const early = await Promise.race([exited.then(() => true), this.#wait(8_000).then(() => false)]);
    return !early && this.#proc === p;
  }

  #run(cmd: string, args: string[], ms: number): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let stdout = "", stderr = "";
      const p = this.#spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      const t = setTimeout(() => p.kill("SIGKILL"), ms);
      p.stdout?.on("data", (c: Buffer) => { stdout += c.toString(); });
      p.stderr?.on("data", (c: Buffer) => { stderr = (stderr + c.toString()).slice(-2000); });
      p.once("error", (e) => { stderr += e.message; });
      p.once("close", () => { clearTimeout(t); resolve({ stdout, stderr }); });
    });
  }
}

let radio: Radio | null = null;
export const liveRadio = (tell: (text: string) => void) => (radio ??= new Radio({ file: join(config.dataDir, "radio.json"), tell, log: (s) => console.error(s) }));
