/**
 * NIGHT POKER's sounds, synthesised with Web Audio (no sound files): a card sliding off the deck,
 * chips on the felt, a knock for a check, a soft chime when it is your turn, a tick for the last
 * seconds of your clock and a short run of notes for a pot won. One context, unlocked by a tap.
 */
export class PokerSound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  unlock(): void {
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume().catch(() => {});
      if (!this.noise) {
        const n = this.ctx.sampleRate * 0.4, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
        let s = 11; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
        this.noise = b;
      }
    } catch { /* sound is optional */ }
  }
  private ready() { return this.enabled && this.ctx && this.ctx.state === "running" ? this.ctx : null; }
  private burst(freq: number, q: number, gain: number, decay: number, type: BiquadFilterType = "bandpass", at = 0): void {
    const c = this.ready();
    if (!c || !this.noise) return;
    const t = c.currentTime + at, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f); f.connect(g); g.connect(c.destination); src.start(t, Math.random() * 0.2); src.stop(t + decay + 0.02);
  }
  private tone(freq: number, gain: number, at: number, decay: number, type: OscillatorType = "triangle"): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + decay + 0.02);
  }
  deal(): void { this.burst(3800, 0.8, 0.12, 0.09, "highpass"); }
  chips(n = 3): void { for (let i = 0; i < Math.min(5, n); i++) { this.burst(5200 - i * 300, 9, 0.16, 0.04, "bandpass", i * 0.045); this.tone(3100 + i * 120, 0.05, i * 0.045, 0.05, "sine"); } }
  check(): void { this.burst(240, 1.2, 0.5, 0.08, "lowpass"); this.burst(240, 1.2, 0.35, 0.08, "lowpass", 0.11); }
  fold(): void { this.burst(1800, 0.7, 0.1, 0.16, "lowpass"); }
  turn(): void { this.tone(659, 0.09, 0, 0.35); this.tone(988, 0.08, 0.11, 0.45); }
  tick(): void { this.tone(1320, 0.05, 0, 0.05, "square"); }
  win(): void { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.08, i * 0.08, 0.45)); }
  close(): void { void this.ctx?.close().catch(() => {}); this.ctx = null; }
}
