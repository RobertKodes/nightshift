import type { LiveEvent, LiveState } from "./types";

type Flight = { event: LiveEvent; born: number; seed: number };
const W = 1440, H = 900;
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** The station and its hive. Only incoming events create flights and reactor effects. */
export class LiveScene {
  #ctx: CanvasRenderingContext2D;
  #raf = 0;
  #last = 0;
  #observer: ResizeObserver;
  #city = document.createElement("canvas");
  #art = new Image();
  #frogs = [new Image(), new Image(), new Image(), new Image()];
  #state: LiveState | null = null;
  #key = "";
  #flights: Flight[] = [];
  #seen = new Set<string>();
  #reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    this.#ctx = ctx;
    this.#city.width = W; this.#city.height = H;
    this.#art.src = "/art/station/gate-station-2400x1350.webp";
    this.#frogs.forEach((f, i) => { f.src = `/frogs/frog-${["001", "002", "084", "113"][i]}.webp`; });
    this.#observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 1.5);
      canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    });
    this.#observer.observe(canvas);
    this.#raf = requestAnimationFrame(this.#draw);
  }
  setState(state: LiveState) {
    this.#state = state;
    const key = `${state.stats.agentsOnline}:${state.stats.jobsLastDay}`;
    if (key !== this.#key) { this.#key = key; this.#drawCity(); }
  }
  event(e: LiveEvent) {
    if (this.#seen.has(e.id) || e.type === "imd.pulse" || e.data.update) return;
    this.#seen.add(e.id);
    if (this.#seen.size > 400) this.#seen.delete(this.#seen.values().next().value!);
    this.#flights.push({ event: e, born: performance.now(), seed: hash(e.at + this.#seen.size) });
    this.#flights = this.#flights.slice(-80);
  }
  dispose() { cancelAnimationFrame(this.#raf); this.#observer.disconnect(); }
  #poly(c: CanvasRenderingContext2D, pts: number[][], fill: string | CanvasGradient, stroke?: string) {
    c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x!, y!) : c.moveTo(x!, y!)); c.closePath(); c.fillStyle = fill; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
  }
  #glow(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, color); g.addColorStop(1, "transparent");
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  #ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, line = 1) {
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.strokeStyle = color; c.lineWidth = line; c.stroke();
  }
  #drawCity() {
    const c = this.#city.getContext("2d")!; c.clearRect(0, 0, W, H);
    const x = 745, y = 687;
    const p = (a: number, b: number) => [x + (a - b) * 38, y + (a + b) * 16];
    this.#glow(c, x, y + 40, 460, "#163a5466");
    this.#poly(c, [[220, 695], [745, 470], [1270, 695], [745, 925]], "#050e1e", "#21435b");
    this.#poly(c, [[220, 677], [745, 452], [1270, 677], [745, 907]], "#080d22", "#4b6c7d");
    this.#poly(c, [[220, 677], [745, 907], [745, 925], [220, 695]], "#0e172d", "#224c6a");
    this.#poly(c, [[745, 907], [1270, 677], [1270, 695], [745, 925]], "#071221", "#204a60");
    for (let i = -6; i <= 6; i++) {
      const a = p(i, -6), b = p(i, 6), d = p(-6, i), e = p(6, i);
      c.strokeStyle = i % 3 === 0 ? "#28566b" : "#15283b"; c.lineWidth = i % 3 === 0 ? 2 : 1;
      c.beginPath(); c.moveTo(a[0]!, a[1]!); c.lineTo(b[0]!, b[1]!); c.moveTo(d[0]!, d[1]!); c.lineTo(e[0]!, e[1]!); c.stroke();
    }
    const agents = this.#state?.stats.agentsOnline ?? 0;
    // One lit window per online agent, up to the scene's 5,808 windows.
    let windowIndex = 0;
    const capacity = 121 * 48;
    const colors = ["#67dfff", "#b294ff", "#b9fa6d", "#ff91bd"];
    for (let sum = -10; sum <= 10; sum++) for (let a = -5; a <= 5; a++) {
      const b = sum - a; if (b < -5 || b > 5) continue;
      const [bx, by] = p(a, b) as [number, number], seed = (a + 6) * 13 + b + 6;
      const height = 24 + Math.floor(hash(seed) * 76) + (Math.abs(a) < 2 && Math.abs(b) < 2 ? 40 : 0), bw = 21, depth = 10;
      const color = colors[(a < 0 ? 0 : 1) + (b < 0 ? 0 : 2)]!;
      this.#poly(c, [[bx - bw, by - height], [bx, by - height + depth], [bx, by + depth], [bx - bw, by]], "#111a32", "#273347");
      this.#poly(c, [[bx, by - height + depth], [bx + bw, by - height], [bx + bw, by], [bx, by + depth]], "#0b122a", "#1c2c43");
      this.#poly(c, [[bx - bw, by - height], [bx, by - height - depth], [bx + bw, by - height], [bx, by - height + depth]], "#222c48", "#4b5772");
      c.globalAlpha = .65; c.strokeStyle = color; c.beginPath(); c.moveTo(bx - bw, by - height); c.lineTo(bx, by - height - depth); c.lineTo(bx + bw, by - height); c.stroke(); c.globalAlpha = 1;
      for (let side = 0; side < 2; side++) for (let row = 0; row < 8; row++) for (let col = 0; col < 3; col++) {
        const lit = ((windowIndex++ * 1999) % capacity) < Math.min(capacity, agents);
        c.fillStyle = lit ? color : "#1a253b";
        if (lit) c.globalAlpha = .5 + .5 * hash(windowIndex);
        const wx = bx + (side ? 3 + col * 6 : -18 + col * 6), wy = by - height + 8 + row * (height - 14) / 8 + (side ? (2 - col) * 2 : col * 2);
        c.fillRect(wx, wy, 3, 3); c.globalAlpha = 1;
      }
      if (seed % 7 === 0) {
        c.strokeStyle = "#52637a"; c.beginPath(); c.moveTo(bx, by - height - depth); c.lineTo(bx, by - height - depth - 18); c.stroke();
        this.#glow(c, bx, by - height - depth - 18, 9, `${color}aa`); c.fillStyle = color; c.fillRect(bx - 1, by - height - depth - 19, 2, 2);
      }
    }
    // The hive dispatch pad is a landmark, not a count of agents.
    this.#ellipse(c, 745, 776, 72, 28, "#9ff37199", 2);
    this.#ellipse(c, 745, 776, 62, 23, "#9ff37144");
    this.#glow(c, 745, 763, 90, "#8ef67622");
    c.fillStyle = "#c0f69c"; c.font = "600 12px 'JetBrains Mono', monospace"; c.textAlign = "center"; c.fillText("IMD / HIVE", 745, 782);
  }
  #frog(c: CanvasRenderingContext2D, x: number, y: number, index: number, alpha = 1) {
    c.save(); c.globalAlpha = alpha;
    this.#ellipse(c, x, y + 12, 29, 10, "#85e5c377", 2);
    c.fillStyle = "#566d83"; c.fillRect(x - 16, y - 30, 10, 36); c.fillRect(x + 6, y - 30, 10, 36);
    c.fillStyle = "#182a40"; c.beginPath(); c.roundRect(x - 24, y - 65, 48, 48, 12); c.fill();
    c.strokeStyle = "#8fa6bb"; c.lineWidth = 5; c.beginPath(); c.moveTo(x - 24, y - 55); c.lineTo(x - 32, y - 29); c.moveTo(x + 24, y - 55); c.lineTo(x + 32, y - 34); c.stroke();
    c.fillStyle = "#c1ff77"; c.fillRect(x - 9, y - 49, 18, 3);
    c.save(); c.beginPath(); c.arc(x, y - 82, 29, 0, Math.PI * 2); c.clip();
    const f = this.#frogs[index % 4]!;
    if (f.complete && f.naturalWidth) c.drawImage(f, x - 29, y - 111, 58, 58);
    c.restore(); this.#ellipse(c, x, y - 82, 30, 30, "#adc6de", 3); c.restore();
  }
  #draw = (now: number) => {
    this.#raf = requestAnimationFrame(this.#draw);
    if (now - this.#last < (this.#reduced ? 100 : 32)) return;
    this.#last = now;
    const c = this.#ctx, cw = this.canvas.width, ch = this.canvas.height;
    if (!cw || !ch) return;
    c.setTransform(cw / W, 0, 0, ch / H, 0, 0);
    c.clearRect(0, 0, W, H); c.fillStyle = "#040611"; c.fillRect(0, 0, W, H);
    const t = this.#reduced ? 0 : now / 1000;
    const energy = this.#state?.stats.priceUsd ? Math.min(1, Math.log10(1 + this.#state.stats.priceUsd * 1e7) / 5) : 0;
    this.#glow(c, 880, 240, 630, `rgba(78,43,153,${.17 + energy * .2})`);
    this.#glow(c, 440, 480, 360, "#0d5d6e21");
    for (let i = 0; i < 240; i++) {
      const x = hash(i + 1) * W, y = hash(i + 700) * H;
      c.globalAlpha = .2 + hash(i + 23) * .5 + Math.sin(t * .2 + i) * .1;
      c.fillStyle = i % 5 ? "#c6d3ff" : "#94b4e3"; const r = i % 19 === 0 ? 1.6 : .7; c.fillRect(x, y, r, r);
    }
    c.globalAlpha = 1;
    c.save(); c.translate(800, 340); c.rotate(-.16); c.setLineDash([3, 13]); this.#ellipse(c, 0, 0, 620, 215, "#8f9eb025"); c.restore();
    if (this.#art.complete && this.#art.naturalWidth) {
      c.save(); c.globalCompositeOperation = "screen"; c.globalAlpha = .95;
      c.drawImage(this.#art, 690, 0, 1710, 950, 325, 10 + Math.sin(t * .22) * 5, 1025, 570); c.restore();
    }
    const share = this.#state?.stats.stakedShare;
    if (share != null && share > 0) {
      const radius = 290 + share * 250;
      c.save(); c.setLineDash([4, 8]); this.#ellipse(c, 862, 295, radius, radius * .46, "#83e5fa35"); c.setLineDash([]); this.#ellipse(c, 862, 295, radius + 7, radius * .46 + 7, "#83e5fa16"); c.restore();
    }
    const activity = this.#state?.stats.jobsLastDay ?? 0;
    this.#glow(c, 750, 730, 380, `rgba(41,131,164,${Math.min(.2, activity / 700)})`);
    c.drawImage(this.#city, 0, -20);
    // Supply conduits breathe without claiming new activity.
    c.save(); c.setLineDash([3, 10]); c.lineDashOffset = -t * 8; c.strokeStyle = "#86d5ef30";
    c.beginPath(); c.moveTo(848, 440); c.bezierCurveTo(950, 490, 550, 550, 745, 730); c.stroke(); c.restore();
    this.#frog(c, 500, 812, 0); this.#frog(c, 552, 838, 1);
    this.#flights = this.#flights.filter((f) => now - f.born < 14_000);
    for (const f of this.#flights) {
      const age = (now - f.born) / 1000, e = f.event, progress = Math.min(1, age / 8), fade = Math.min(1, age, 14 - age);
      c.save(); c.globalAlpha = Math.max(0, fade);
      if (e.type === "imd.job" || e.type === "watchtower.change") {
        const audit = e.type === "watchtower.change" || /audit/i.test(String(e.data.kind));
        const x = 745 + (f.seed - .5) * 600 * progress, y = 744 - Math.sin(progress * Math.PI) * 150 - progress * 100;
        if (audit) {
          const beam = c.createLinearGradient(x, y, x, y + 140); beam.addColorStop(0, "#6de5ff44"); beam.addColorStop(1, "#6de5ff00");
          this.#poly(c, [[x - 5, y], [x + 5, y], [x + 65, y + 140], [x - 65, y + 140]], beam);
        }
        this.#glow(c, x, y, 36, "#70efff77"); c.strokeStyle = "#a6f7ff"; c.lineWidth = 3; c.beginPath(); c.moveTo(x - 15, y); c.lineTo(x + 15, y); c.moveTo(x, y - 6); c.lineTo(x, y + 6); c.stroke();
        for (const dx of [-16, 16]) this.#ellipse(c, x + dx, y - 2, 8, 3, "#adf8ff");
        if (e.type === "imd.job") this.#frog(c, 865, 845, 3);
      } else if (e.type === "imd.launch") {
        const x = 1080 + age * 12, y = 560 - age * 56;
        this.#glow(c, x, y + 30, 70, "#c485ff66"); this.#poly(c, [[x - 9, y + 18], [x, y - 30], [x + 9, y + 18]], "#e4eaff", "#9bc2ff");
        this.#poly(c, [[x - 5, y + 18], [x, y + 100 + Math.sin(t * 9) * 15], [x + 5, y + 18]], "#ae79ffa0");
      } else if (e.type === "shift.buy" || e.type === "shift.burn") {
        const burn = e.type === "shift.burn", color = burn ? "#ff956b" : "#baff73";
        c.save(); c.globalAlpha *= Math.max(0, 1 - age / 14);
        this.#ellipse(c, 858, 300, 160 + age * 55, 60 + age * 22, `${color}80`, 3); this.#glow(c, 858, 330, 220, `${color}44`); c.restore();
        if (burn) for (let i = 0; i < 12; i++) this.#glow(c, 860 + Math.sin(i * 3) * 65, 360 + ((age * 100 + i * 19) % 150), 28, "#ff884a80");
        if (!burn && Number(e.data.usd) >= 2500) this.#shuttle(c, 1320 - progress * 320, 180 + progress * 130, 1.7);
      } else if (e.type === "agent.docked") {
        this.#shuttle(c, 1290 - progress * 380, 70 + progress * 260, 1);
      } else if (e.type === "crew.job") {
        const names = ["watchtower", "research", "buildcheck", "swarm"], i = Math.max(0, names.indexOf(String(e.data.crew)));
        this.#frog(c, 640 + i * 75, 845, i);
        c.font = "11px 'JetBrains Mono', monospace"; c.fillStyle = "#c3dbe8"; c.textAlign = "center"; c.fillText(String(e.data.crew).toUpperCase(), 640 + i * 75, 873);
      } else if (e.type.startsWith("spotlight.")) {
        this.#glow(c, 745, 744, 180, "#b7ff6b33"); this.#ellipse(c, 745, 744, 95 + Math.sin(t) * 4, 38, "#c6ff90aa", 2);
      }
      c.restore();
    }
    c.textAlign = "left"; c.font = "11px 'JetBrains Mono', monospace"; c.fillStyle = "#7693a4";
    c.fillText("NIGHT FROGS / STATION CREW", 420, 885);
  };
  #shuttle(c: CanvasRenderingContext2D, x: number, y: number, size: number) {
    c.save(); c.translate(x, y); c.scale(size, size);
    this.#glow(c, 24, 4, 48, "#b387ff80");
    this.#poly(c, [[-26, 4], [-3, -12], [20, -7], [32, 6], [-3, 13]], "#8a9ab4", "#c4d5ee");
    this.#poly(c, [[-12, 0], [0, -7], [13, -4], [9, 2]], "#83f0e5"); c.restore();
  }
}
