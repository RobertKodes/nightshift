import type { LiveEvent } from "./types";

const VOICE: Record<string, string> = { "imd.launch": "launch", "imd.job": "delivery", "shift.buy": "surge", "shift.burn": "burn", "shift.stake": "shield", "crew.job": "crew", "agent.docked": "agent", "watchtower.change": "watchtower", "tg.request": "community", "spotlight.started": "spotlight", "spotlight.result": "result", "game.live": "game" };

/** A quiet synth bed and short cues; audio starts on the owner's gesture. */
export class LiveAudio {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #voice: HTMLAudioElement | null = null;
  #buffers = new Map<string, string | null>();
  #lastVoice = 0;
  narration = false;
  async start() {
    this.#ctx ??= new AudioContext();
    const c = this.#ctx;
    await c.resume();
    if (this.#master) { this.#master.gain.setTargetAtTime(.16, c.currentTime, .2); return; }
    const master = this.#master = c.createGain(); master.gain.value = .16; master.connect(c.destination);
    for (const [i, hz] of [55, 82.41, 110.12].entries()) {
      const osc = c.createOscillator(), gain = c.createGain();
      osc.type = "sine"; osc.frequency.value = hz; gain.gain.value = .08 / (i + 1);
      osc.connect(gain).connect(master); osc.start();
      const lfo = c.createOscillator(), depth = c.createGain();
      lfo.frequency.value = .06 + i * .023; depth.gain.value = .02 / (i + 1);
      lfo.connect(depth).connect(gain.gain); lfo.start();
    }
  }
  mute() { if (this.#ctx && this.#master) this.#master.gain.setTargetAtTime(0, this.#ctx.currentTime, .1); this.#voice?.pause(); }
  cue(e: LiveEvent) {
    const c = this.#ctx, master = this.#master;
    if (!c || !master || e.type === "imd.pulse" || e.data.update) return;
    const osc = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    osc.type = "sine"; osc.frequency.setValueAtTime(e.type === "shift.buy" ? 220 : 440, t); osc.frequency.exponentialRampToValueAtTime(e.type === "shift.burn" ? 80 : 880, t + .35);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.18, t + .03); g.gain.exponentialRampToValueAtTime(.001, t + .7);
    osc.connect(g).connect(master); osc.start(t); osc.stop(t + .75); osc.onended = () => { osc.disconnect(); g.disconnect(); };
    if (this.narration && Date.now() - this.#lastVoice > 12_000 && VOICE[e.type]) { this.#lastVoice = Date.now(); void this.#speak(VOICE[e.type]!); }
  }
  async #speak(id: string) {
    if (!this.#buffers.has(id)) {
      try {
        const r = await fetch(`/live/voice/${id}.mp3`, { signal: AbortSignal.timeout(4000) });
        const type = r.headers.get("content-type") ?? "";
        this.#buffers.set(id, r.ok && /audio|octet-stream/.test(type) ? URL.createObjectURL(await r.blob()) : null);
      } catch { this.#buffers.set(id, null); }
    }
    const src = this.#buffers.get(id);
    if (!src || !this.narration || !this.#master?.gain.value) return;
    this.#voice?.pause(); this.#voice = new Audio(src); this.#voice.volume = .7; void this.#voice.play().catch(() => {});
  }
  dispose() { this.#voice?.pause(); void this.#ctx?.close(); for (const url of this.#buffers.values()) if (url) URL.revokeObjectURL(url); this.#ctx = null; this.#master = null; }
}
