/** Small, synthesized table sounds. The first gesture unlocks audio on mobile. */
export class ChessSound {
  private context: AudioContext | null = null;
  enabled = true;
  unlock() {
    try { this.context ??= new AudioContext(); void this.context.resume().catch(() => {}); } catch { /* audio is optional */ }
  }
  play(kind: "move" | "capture" | "check" | "tick") {
    if (!this.enabled || !this.context || this.context.state !== "running") return;
    const c = this.context, t = c.currentTime;
    const notes = kind === "check" ? [440, 660] : kind === "capture" ? [180, 90] : kind === "tick" ? [900] : [360, 240];
    notes.forEach((frequency, i) => {
      const o = c.createOscillator(), g = c.createGain(), start = t + i * .045;
      o.type = kind === "capture" ? "triangle" : "sine"; o.frequency.setValueAtTime(frequency, start); o.frequency.exponentialRampToValueAtTime(frequency * .6, start + .13);
      g.gain.setValueAtTime(.0001, start); g.gain.exponentialRampToValueAtTime(kind === "tick" ? .025 : .09, start + .006); g.gain.exponentialRampToValueAtTime(.0001, start + .18);
      o.connect(g); g.connect(c.destination); o.start(start); o.stop(start + .2);
    });
  }
  close() { void this.context?.close().catch(() => {}); this.context = null; }
}
