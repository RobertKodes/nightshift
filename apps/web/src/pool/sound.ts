/**
 * NIGHT POOL's sounds, synthesised with Web Audio (no sound files): the tip on the cue ball, the
 * click of two balls (louder and brighter the harder they meet), the thud of a cushion, a ball
 * dropping into a pocket and rattling in its liner, and a soft tick for the last seconds of the
 * shot clock. One context per page, unlocked by the first tap.
 */
export class PoolSound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  private gate = new Map<string, number>();
  unlock(): void {
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume().catch(() => {});
      if (!this.noise) {
        const n = this.ctx.sampleRate * 0.5, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
        let s = 7; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
        this.noise = b;
      }
    } catch { /* sound is optional */ }
  }
  /** At most one sound of a kind every few milliseconds: a break makes dozens at once. */
  private allow(kind: string, ms: number): boolean {
    const now = performance.now(), last = this.gate.get(kind) ?? 0;
    if (now - last < ms) return false;
    this.gate.set(kind, now);
    return true;
  }
  private burst(o: { freq: number; q: number; gain: number; decay: number; type?: BiquadFilterType; tone?: number; toneDecay?: number }): void {
    const c = this.ctx;
    if (!this.enabled || !c || c.state !== "running" || !this.noise) return;
    const t = c.currentTime, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise; f.type = o.type ?? "bandpass"; f.frequency.value = o.freq; f.Q.value = o.q;
    g.gain.setValueAtTime(Math.min(1, o.gain), t); g.gain.exponentialRampToValueAtTime(0.0001, t + o.decay);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t, Math.random() * 0.3); src.stop(t + o.decay + 0.02);
    if (o.tone) {
      const osc = c.createOscillator(), og = c.createGain();
      osc.frequency.setValueAtTime(o.tone, t); og.gain.setValueAtTime(Math.min(0.5, o.gain * 0.6), t); og.gain.exponentialRampToValueAtTime(0.0001, t + (o.toneDecay ?? o.decay));
      osc.connect(og); og.connect(c.destination); osc.start(t); osc.stop(t + (o.toneDecay ?? o.decay) + 0.02);
    }
  }
  cue(power: number): void { this.burst({ freq: 2400, q: 1.2, gain: 0.15 + power * 0.5, decay: 0.05, tone: 900, toneDecay: 0.03 }); }
  ball(speed: number): void {
    if (speed < 0.03 || !this.allow("ball", 18)) return;
    const k = Math.min(1, speed / 4);
    this.burst({ freq: 3200 + k * 1800, q: 6, gain: 0.08 + k * 0.6, decay: 0.035 + k * 0.03, tone: 2400 + k * 900, toneDecay: 0.025 });
  }
  rail(speed: number): void {
    if (speed < 0.05 || !this.allow("rail", 30)) return;
    const k = Math.min(1, speed / 4);
    this.burst({ freq: 260, q: 0.9, gain: 0.12 + k * 0.5, decay: 0.12, type: "lowpass", tone: 120, toneDecay: 0.08 });
  }
  pocket(): void {
    if (!this.allow("pocket", 60)) return;
    this.burst({ freq: 180, q: 1.4, gain: 0.55, decay: 0.2, type: "lowpass", tone: 90, toneDecay: 0.16 });
    setTimeout(() => this.burst({ freq: 1400, q: 4, gain: 0.14, decay: 0.08 }), 110);
    setTimeout(() => this.burst({ freq: 1100, q: 4, gain: 0.09, decay: 0.07 }), 190);
  }
  tick(): void { this.burst({ freq: 1800, q: 8, gain: 0.08, decay: 0.03, tone: 1320, toneDecay: 0.04 }); }
  win(): void {
    const c = this.ctx;
    if (!this.enabled || !c || c.state !== "running") return;
    const t = c.currentTime;
    [392, 523, 659, 784].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(), s = t + i * 0.09; o.type = "triangle"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.1, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5); o.connect(g); g.connect(c.destination); o.start(s); o.stop(s + 0.55); });
  }
  close(): void { void this.ctx?.close().catch(() => {}); this.ctx = null; }
}
