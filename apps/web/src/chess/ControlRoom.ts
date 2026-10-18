import * as THREE from "three";

/** A distant curved console, deliberately dimmer and softer than the table. */
export class ControlRoom {
  readonly group = new THREE.Group();
  private resources = new Set<{ dispose(): void }>();
  private status: HTMLCanvasElement;
  private statusTexture: THREE.CanvasTexture;
  private lastFrame = -1;
  /** The two live charts: $SHIFT on the left screen, IMD on the right, from /api/prices. */
  private charts: { canvas: HTMLCanvasElement; texture?: THREE.CanvasTexture; token: "shift" | "imd" }[] = [];
  private timer = 0;

  constructor() {
    const screenGeometry = this.keep(new THREE.PlaneGeometry(4.6, 2.3));
    const frameGeometry = this.keep(new THREE.BoxGeometry(4.76, 2.46, .08));
    const frameMaterial = this.keep(new THREE.MeshBasicMaterial({ color: 0x100d1c }));
    const canvases = [this.canvas(), this.canvas()];
    this.charts = [{ canvas: canvases[0]!, token: "shift" }, { canvas: canvases[1]!, token: "imd" }];
    for (const c of this.charts) this.drawChart(c.canvas, c.token, null);
    this.status = this.canvas();
    let statusTexture: THREE.CanvasTexture | undefined;
    canvases.forEach((canvas, index) => {
      const texture = this.keep(new THREE.CanvasTexture(canvas));
      texture.colorSpace = THREE.SRGBColorSpace;
      if (index === 1) statusTexture = texture; // kept for update(); both screens are charts now
      for (const c of this.charts) if (c.canvas === canvas) c.texture = texture;
      const material = this.keep(new THREE.MeshBasicMaterial({
        map: texture, transparent: true, opacity: .62, toneMapped: false,
      }));
      const panel = new THREE.Group();
      const frame = new THREE.Mesh(frameGeometry, frameMaterial);
      const screen = new THREE.Mesh(screenGeometry, material);
      screen.position.z = .045;
      panel.add(frame, screen);
      const angle = index === 0 ? -.42 : .42;
      panel.position.set(Math.sin(angle) * 7.6, .55, -Math.cos(angle) * 7.6);
      panel.lookAt(0, 1.4, 0);
      this.group.add(panel);
    });
    this.statusTexture = statusTexture!;
    this.group.name = "IMD control room";
    void this.refresh();
    this.timer = window.setInterval(() => void this.refresh(), 60_000);
  }

  /** Real hourly prices for both tokens, read through our own server (it caches GeckoTerminal). */
  private async refresh() {
    const d = await fetch("/api/prices").then((r) => (r.ok ? r.json() : null)).catch(() => null) as Record<"shift" | "imd", { t: number; close: number }[]> | null;
    if (!d) return;
    for (const c of this.charts) { this.drawChart(c.canvas, c.token, d[c.token] ?? null); if (c.texture) c.texture.needsUpdate = true; }
  }

  private keep<T extends { dispose(): void }>(resource: T): T { this.resources.add(resource); return resource; }
  private canvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024; canvas.height = 512;
    return canvas;
  }
  private surface(canvas: HTMLCanvasElement, heading: string, subtitle: string) {
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(2, 0, 0, 2, 0, 0); // draw in a 512x256 space at twice the resolution
    ctx.clearRect(0, 0, 512, 256);
    ctx.fillStyle = "#050509"; ctx.fillRect(0, 0, 512, 256);
    ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.filter = "none";
    ctx.font = "700 30px monospace"; ctx.fillStyle = "#f2efff";
    ctx.fillText(heading, 26, 36);
    ctx.font = "11px monospace"; ctx.fillStyle = "#9a93ad";
    ctx.fillText(subtitle, 28, 70);
    ctx.strokeStyle = "#bcb7ce22"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(28, 86); ctx.lineTo(484, 86); ctx.stroke();
    return ctx;
  }
  private drawChart(canvas: HTMLCanvasElement, token: "shift" | "imd", series: { t: number; close: number }[] | null) {
    const shift = token === "shift";
    const ctx = this.surface(canvas, shift ? "$SHIFT" : "IMD", shift ? "NIGHTSHIFT TOKEN · PRICE IN USD · LAST 72 HOURS" : "IMD TOKEN · PRICE IN USD · LAST 72 HOURS");
    const colour = shift ? "#a48bff" : "#e6e6ee";
    const pts = (series ?? []).filter((p) => p.close > 0);
    if (pts.length < 2) { ctx.font = "11px monospace"; ctx.fillStyle = "#7d778b"; ctx.fillText("LIVE PRICE LOADING", 28, 150); return; }
    const last = pts.at(-1)!.close, dayAgo = pts.find((p) => p.t >= pts.at(-1)!.t - 86_400_000)?.close ?? pts[0]!.close;
    const change = ((last - dayAgo) / dayAgo) * 100;
    // the price and the day's change, big enough to read from across the room
    ctx.font = "700 26px monospace"; ctx.fillStyle = colour; ctx.textAlign = "right";
    ctx.fillText(`$${last < 0.01 ? last.toPrecision(3) : last.toFixed(2)}`, 486, 34);
    ctx.font = "700 13px monospace"; ctx.fillStyle = change >= 0 ? "#b8ff4a" : "#ff6b8a";
    ctx.fillText(`${change >= 0 ? "▲ +" : "▼ "}${change.toFixed(1)}% · 24H`, 486, 66); ctx.textAlign = "left";
    const lo = Math.min(...pts.map((p) => p.close)), hi = Math.max(...pts.map((p) => p.close)), t0 = pts[0]!.t, t1 = pts.at(-1)!.t;
    const x = (t: number) => 28 + ((t - t0) / Math.max(1, t1 - t0)) * 456, y = (v: number) => 214 - ((v - lo) / Math.max(1e-18, hi - lo)) * 110;
    ctx.strokeStyle = "#b8a8ed18"; ctx.lineWidth = 1;
    for (let gy = 104; gy <= 214; gy += 36.6) { ctx.beginPath(); ctx.moveTo(28, gy); ctx.lineTo(484, gy); ctx.stroke(); }
    const line = new Path2D(); pts.forEach((p, i) => (i ? line.lineTo(x(p.t), y(p.close)) : line.moveTo(x(p.t), y(p.close))));
    const area = new Path2D(line); area.lineTo(x(t1), 214); area.lineTo(x(t0), 214); area.closePath();
    const g = ctx.createLinearGradient(0, 104, 0, 214); g.addColorStop(0, shift ? "#7c5cff55" : "#ffffff33"); g.addColorStop(1, "#00000000");
    ctx.fillStyle = g; ctx.fill(area);
    ctx.filter = "blur(.5px)"; ctx.strokeStyle = colour; ctx.lineWidth = 2.2; ctx.stroke(line); ctx.filter = "none";
    ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(x(t1), y(last), 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8e829d"; ctx.font = "9px monospace"; ctx.fillText(shift ? "SHIFT / ETH · UNISWAP V4 · LIVE" : "IMD / ETH · UNISWAP · LIVE", 28, 238);
  }
  private drawStatus(time: number) {
    const ctx = this.surface(this.status, "IMD SWARM · ONLINE", "DISTRIBUTED INTELLIGENCE / ALWAYS ON");
    ctx.strokeStyle = "#dddde5"; ctx.lineWidth = 1.5;
    ctx.save(); ctx.translate(50, 126); ctx.rotate(Math.PI / 4); ctx.strokeRect(-10, -10, 20, 20); ctx.restore();
    ctx.fillStyle = "#c4c4ce"; ctx.font = "12px monospace"; ctx.fillText("ALL SYSTEMS NOMINAL", 80, 127);
    ctx.font = "10px monospace"; ctx.fillStyle = "#777781"; ctx.fillText("AGENTS CONNECTED / SHIFT IN PROGRESS", 28, 226);
    for (let i = 0; i < 26; i++) {
      const phase = time * .0005 + i * 1.7;
      const x = 33 + i * 17.4 + Math.sin(phase) * 2;
      const y = 174 + Math.cos(phase * .7) * 7;
      ctx.globalAlpha = .3 + (Math.sin(phase) + 1) * .3;
      ctx.fillStyle = "#dedee7"; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  update(now: number, azimuth: number, reduced: boolean) {
    // The console follows an orbit with a small angular offset, creating calm parallax.
    this.group.rotation.y = azimuth + Math.sin(azimuth) * .08;
    void now; void reduced; // the charts redraw when new prices arrive, not every frame
  }
  dispose() { window.clearInterval(this.timer); for (const resource of this.resources) resource.dispose(); }
}
