import * as THREE from "three";

export interface Joy { active: boolean; ox: number; oy: number; x: number; y: number }

/**
 * Input for desktop and phones: keys and a mouse-dragged camera, or on a touch screen a joystick under
 * the left thumb, a camera drag under the right one, pinch to zoom, and taps to pick a target.
 */
export class Controls {
  /** x right, y forward, length 0..1 */
  readonly move = new THREE.Vector2();
  walk = false;
  yaw = Math.PI;
  pitch = 0.36;
  dist = 7.5;
  readonly joy: Joy = { active: false, ox: 0, oy: 0, x: 0, y: 0 };
  onLeap: () => void = () => {};
  onInteract: () => void = () => {};
  onAbility: (i: number) => void = () => {};
  onCycle: () => void = () => {};
  onPick: (ndc: THREE.Vector2) => void = () => {};
  onChat: () => void = () => {};
  onBag: () => void = () => {};
  enabled = true;
  #keys = new Set<string>();
  #joyId: number | null = null;
  #look: { id: number; x: number; y: number; sx: number; sy: number; t: number } | null = null;
  #pinch = new Map<number, { x: number; y: number }>();
  #pinchD = 0;
  #el: HTMLElement;
  #off: (() => void)[] = [];

  constructor(el: HTMLElement) {
    this.#el = el;
    const on = <K extends keyof WindowEventMap>(t: EventTarget, k: K, f: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions) => {
      t.addEventListener(k, f as EventListener, o); this.#off.push(() => t.removeEventListener(k, f as EventListener));
    };
    const typing = () => { const a = document.activeElement; return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement; };
    on(window, "keydown", (e) => {
      if (!this.enabled || typing()) return;
      const k = e.key.toLowerCase();
      if (k === "tab") { e.preventDefault(); this.onCycle(); return; }
      if (k === "enter") { this.onChat(); return; }
      if (k === "i" || k === "b") { if (!e.repeat) this.onBag(); return; }
      if (k === " ") { e.preventDefault(); if (!e.repeat) this.onLeap(); return; }
      if (k === "e" || k === "f") { if (!e.repeat) this.onInteract(); return; }
      if (/^[1-7]$/.test(k)) { if (!e.repeat) this.onAbility(Number(k) - 1); return; }
      if (k === "shift") this.walk = true;
      this.#keys.add(k);
    });
    on(window, "keyup", (e) => { const k = e.key.toLowerCase(); this.#keys.delete(k); if (k === "shift") this.walk = false; });
    on(window, "blur", () => { this.#keys.clear(); this.walk = false; });
    on(el, "contextmenu", (e) => e.preventDefault());
    on(el, "wheel", (e) => { e.preventDefault(); this.dist = THREE.MathUtils.clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.09), 3.2, 14); }, { passive: false });
    on(el, "pointerdown", (e) => {
      if (!this.enabled) return;
      el.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect(), x = e.clientX - r.left;
      if (e.pointerType === "touch") {
        this.#pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.#pinch.size === 2) { const [a, b] = [...this.#pinch.values()]; this.#pinchD = Math.hypot(a!.x - b!.x, a!.y - b!.y); this.#look = null; return; }
        if (x < r.width * 0.45 && this.#joyId === null) {
          this.#joyId = e.pointerId; Object.assign(this.joy, { active: true, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
          return;
        }
      }
      this.#look = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() };
    });
    on(el, "pointermove", (e) => {
      if (this.#pinch.has(e.pointerId)) this.#pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.#pinch.size === 2) {
        const [a, b] = [...this.#pinch.values()]; const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (this.#pinchD) this.dist = THREE.MathUtils.clamp(this.dist * (this.#pinchD / d), 3.2, 14);
        this.#pinchD = d; return;
      }
      if (e.pointerId === this.#joyId) {
        const max = 56, dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy, l = Math.hypot(dx, dy), k = l > max ? max / l : 1;
        this.joy.x = (dx * k) / max; this.joy.y = (dy * k) / max;
        return;
      }
      const lk = this.#look;
      if (lk && lk.id === e.pointerId) {
        const s = e.pointerType === "touch" ? 0.0065 : 0.0052;
        this.yaw -= (e.clientX - lk.x) * s;
        this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - lk.y) * s * 0.8, -0.12, 1.15);
        lk.x = e.clientX; lk.y = e.clientY;
      }
    });
    const up = (e: PointerEvent) => {
      this.#pinch.delete(e.pointerId); if (this.#pinch.size < 2) this.#pinchD = 0;
      if (e.pointerId === this.#joyId) { this.#joyId = null; Object.assign(this.joy, { active: false, x: 0, y: 0 }); }
      const lk = this.#look;
      if (lk && lk.id === e.pointerId) {
        // a short press that barely moved is a tap: pick what is under it
        if (Math.hypot(e.clientX - lk.sx, e.clientY - lk.sy) < 9 && performance.now() - lk.t < 350) {
          const r = el.getBoundingClientRect();
          this.onPick(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1));
        }
        this.#look = null;
      }
    };
    on(el, "pointerup", up); on(el, "pointercancel", up);
  }

  /** Read the keys and the joystick into `move`. */
  poll() {
    const k = this.#keys;
    let x = 0, y = 0;
    if (k.has("w") || k.has("arrowup")) y += 1;
    if (k.has("s") || k.has("arrowdown")) y -= 1;
    if (k.has("a") || k.has("arrowleft")) x -= 1;
    if (k.has("d") || k.has("arrowright")) x += 1;
    if (this.joy.active) { x += this.joy.x; y -= this.joy.y; }
    this.move.set(x, y);
    if (this.move.lengthSq() > 1) this.move.normalize();
    if (!this.enabled) this.move.set(0, 0);
  }

  dispose() { for (const f of this.#off) f(); this.#off = []; }
}
