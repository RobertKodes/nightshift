import { BAY_W, FRONT_Z, HALF_D, ROOMS } from "./layout";
import { ROOM_GLOW } from "./toon";

/** A frog on the minimap: deck position, and whether it is yours or the picked one. */
export type Blip = { x: number; z: number; mine: boolean; picked: boolean };
type Point = { x: number; z: number };

const X0 = -BAY_W / 2 - 1.5, X1 = 3 * BAY_W + BAY_W / 2 + 1.5, Z0 = -HALF_D - 1, Z1 = FRONT_Z + HALF_D + 1.5;
const LONG = X1 - X0, SHORT = Z1 - Z0;

/**
 * The RTS minimap in the corner of the deck: the eight rooms in their room colours, every frog on duty as
 * a dot (yours violet, the picked one green) and the camera's view as a frame. Clicking or dragging on it
 * moves the camera there. When the camera is turned for a phone held upright, the map stands upright too.
 */
export function createMinimap(host: HTMLElement, onJump: (x: number, z: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.className = "pv-deck-minimap"; canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);
  const c = canvas.getContext("2d");
  let w = 0, h = 0, dpr = 1, down = false, upright = false;
  function size() {
    const rect = canvas.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1);
    w = rect.width; h = rect.height; canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
  }
  function orient(next: boolean) {
    if (next === upright && canvas.dataset.upright) return;
    upright = next; canvas.dataset.upright = String(next);
    canvas.style.aspectRatio = upright ? `${SHORT} / ${LONG}` : `${LONG} / ${SHORT}`;
    size();
  }
  // deck (x along, z across) to canvas pixels: across the top for a wide view, top to bottom when upright
  const at = (x: number, z: number): [number, number] => upright
    ? [(Z1 - z) / SHORT * w, (x - X0) / LONG * h]
    : [(x - X0) / LONG * w, (z - Z0) / SHORT * h];

  function draw(blips: Blip[], view: Point[], vertical: boolean) {
    if (!c) return;
    orient(vertical);
    if (!w || !h) size();
    if (!w || !h) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    c.fillStyle = "rgba(3, 2, 10, .88)"; c.fillRect(0, 0, w, h);
    ROOMS.forEach((room, bay) => {
      const [ax, ay] = at(room.x - BAY_W / 2 + .2, room.z - HALF_D + .1), [bx, by] = at(room.x + BAY_W / 2 - .2, room.z + HALF_D - .1);
      const x = Math.min(ax, bx), y = Math.min(ay, by), rw = Math.abs(bx - ax), rh = Math.abs(by - ay);
      c.fillStyle = "#14102a"; c.fillRect(x, y, rw, rh);
      c.strokeStyle = `${ROOM_GLOW[bay]}c0`; c.lineWidth = 1; c.strokeRect(x + .5, y + .5, rw - 1, rh - 1);
    });
    for (const blip of blips) {
      const [x, y] = at(blip.x, blip.z);
      c.fillStyle = blip.picked ? "#5dffa8" : blip.mine ? "#a48bff" : "#dde4f2";
      c.beginPath(); c.arc(x, y, blip.picked ? 2.8 : 1.7, 0, Math.PI * 2); c.fill();
    }
    if (view.length === 4) {
      c.save(); c.beginPath(); c.rect(0, 0, w, h); c.clip();
      c.strokeStyle = "rgba(255, 255, 255, .85)"; c.lineWidth = 1.2; c.beginPath();
      view.forEach((p, i) => { const [x, y] = at(p.x, p.z); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.closePath(); c.stroke(); c.restore();
    }
  }

  const jump = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect(), u = (event.clientX - rect.left) / rect.width, v = (event.clientY - rect.top) / rect.height;
    if (upright) onJump(X0 + v * LONG, Z1 - u * SHORT); else onJump(X0 + u * LONG, Z0 + v * SHORT);
  };
  const press = (event: PointerEvent) => { event.stopPropagation(); event.preventDefault(); down = true; canvas.setPointerCapture(event.pointerId); jump(event); };
  const drag = (event: PointerEvent) => { if (down) jump(event); };
  const release = (event: PointerEvent) => { down = false; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); };
  canvas.addEventListener("pointerdown", press); canvas.addEventListener("pointermove", drag);
  canvas.addEventListener("pointerup", release); canvas.addEventListener("pointercancel", release);
  const observer = new ResizeObserver(size); observer.observe(canvas);

  return {
    draw,
    dispose() {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", press); canvas.removeEventListener("pointermove", drag);
      canvas.removeEventListener("pointerup", release); canvas.removeEventListener("pointercancel", release);
      canvas.remove();
    },
  };
}
