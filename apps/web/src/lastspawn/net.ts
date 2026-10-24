import { type CharSummary, type ClientMsg, PROTOCOL_VERSION, type ServerMsg } from "@nightshift/lastspawn";

export type NetStatus = "connecting" | "online" | "offline";
const GUEST = "ls-guest";
const guestToken = () => { try { return localStorage.getItem(GUEST) ?? undefined; } catch { return undefined; } };

/**
 * The connection to the world: one WebSocket, the hello with your guest token (or your signed-in
 * session's cookie), and reconnecting by itself with a growing pause, playing the same frog again.
 */
export class Net {
  status: NetStatus = "connecting";
  chars: CharSummary[] = [];
  #ws: WebSocket | null = null;
  #handlers = new Set<(m: ServerMsg) => void>();
  #onStatus: (s: NetStatus) => void;
  #retry = 0;
  #timer = 0;
  #closed = false;
  /** the character being played, to take it up again after a reconnect */
  playing: string | null = null;

  constructor(onStatus: (s: NetStatus) => void) { this.#onStatus = onStatus; this.#open(); }

  on(f: (m: ServerMsg) => void) { this.#handlers.add(f); return () => this.#handlers.delete(f); }

  send(m: ClientMsg) { if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(m)); }

  #set(s: NetStatus) { this.status = s; this.#onStatus(s); }

  #open() {
    if (this.#closed) return;
    this.#set("connecting");
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/lastspawn/ws`);
    this.#ws = ws;
    ws.onopen = () => { this.#retry = 0; ws.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION, guest: guestToken() } satisfies ClientMsg)); };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.t === "welcome") {
        if (m.guest) try { localStorage.setItem(GUEST, m.guest); } catch { /* a private window: a new guest next time */ }
        this.chars = m.chars;
        this.#set("online");
        if (this.playing && m.chars.some((c) => c.id === this.playing)) this.send({ t: "play", charId: this.playing });
      }
      if (m.t === "enter") this.playing = m.char.id;
      for (const f of this.#handlers) f(m);
    };
    ws.onclose = () => {
      if (this.#ws !== ws || this.#closed) return;
      this.#set("offline");
      const wait = Math.min(15000, 1000 * 2 ** this.#retry++);
      this.#timer = window.setTimeout(() => this.#open(), wait);
    };
  }

  close() { this.#closed = true; clearTimeout(this.#timer); this.#ws?.close(); }
}
