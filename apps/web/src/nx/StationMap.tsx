import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ROOMS, ROOM_ORDER, type RoomId } from "./map";

/**
 * Where each room's docking bay sits in the gate art, as a share of the image (measured on the
 * second-edition Codex paintings: the wide one for desktops, the tall one for phones). Only the three
 * doors have a bay; the old rooms keep a spot so their pages still have one.
 */
const BAYS: Record<"wide" | "tall", Record<RoomId, [number, number]>> = {
  wide: { geek: [0.494, 0.488], breakroom: [0.689, 0.525], info: [0.882, 0.519], economy: [0.689, 0.62], command: [0.494, 0.62] },
  tall: { geek: [0.202, 0.442], breakroom: [0.499, 0.451], info: [0.795, 0.442], economy: [0.499, 0.52], command: [0.202, 0.52] },
};

/**
 * The gate's art with its five bays alive: the bay of the door under the pointer lights up with its
 * deck; with nothing chosen, the bays light one after another, like a station breathing.
 */
export function StationMap({ focus }: { focus: RoomId | null }) {
  const img = useRef<HTMLImageElement>(null);
  const [spots, setSpots] = useState<Record<RoomId, { x: number; y: number }> | null>(null);
  const [idle, setIdle] = useState(0);

  useLayoutEffect(() => {
    const el = img.current;
    if (!el) return;
    const place = () => {
      if (!el.naturalWidth) return;
      const nw = el.naturalWidth, nh = el.naturalHeight, cw = el.clientWidth, ch = el.clientHeight;
      const s = Math.max(cw / nw, ch / nh), rw = nw * s, rh = nh * s;
      const [px, py] = getComputedStyle(el).objectPosition.split(" ").map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : 0.5));
      const ox = (cw - rw) * (px ?? 0.5), oy = (ch - rh) * (py ?? 0.5);
      const set = BAYS[el.currentSrc.includes("mobile") ? "tall" : "wide"];
      setSpots(Object.fromEntries(ROOM_ORDER.map((id) => [id, { x: ox + set[id][0] * rw, y: oy + set[id][1] * rh }])) as Record<RoomId, { x: number; y: number }>);
    };
    el.addEventListener("load", place);
    const ro = new ResizeObserver(place);
    ro.observe(el);
    place();
    return () => { el.removeEventListener("load", place); ro.disconnect(); };
  }, []);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setIdle((i) => (i + 1) % ROOM_ORDER.length), 1800);
    return () => clearInterval(t);
  }, []);
  const lit = focus ?? ROOM_ORDER[idle]!;

  return (
    <div className="nx-gate-art" aria-hidden="true">
      <div className="nx-art-move">
        <picture>
          <source media="(max-width: 820px)" srcSet="/art/v2/home-station-mobile-1080x1920.webp" />
          <img ref={img} src="/art/v2/home-station-2400x1350.webp" alt="" />
        </picture>
      </div>
      {/* the lights ride above the art's shade, moving with it */}
      <div className="nx-art-move nx-bays">
        {spots && ROOM_ORDER.map((id) => (
          <span key={id} className={`nx-bay${lit === id ? " lit" : ""}${focus === id ? " chosen" : ""}`} style={{ left: spots[id].x, top: spots[id].y, "--acc": ROOMS[id].accent } as React.CSSProperties}>
            <i /><i /><b>{ROOMS[id].deck} · {ROOMS[id].name}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Docking: a short scan in the room's colour with its deck name, then the room opens behind it. */
export function useDock() {
  const [dock, setDock] = useState<{ room: RoomId; at: number } | null>(null);
  const start = (room: RoomId | null, go: () => void) => {
    if (!room || matchMedia("(prefers-reduced-motion: reduce)").matches) { go(); return; }
    setDock({ room, at: Date.now() });
    window.setTimeout(go, 520);
  };
  const overlay = dock ? createPortal(
    <div key={dock.at} className="nx-dock" style={{ "--acc": ROOMS[dock.room].accent } as React.CSSProperties} aria-hidden="true">
      <span className="nx-dock-scan" />
      <span className="nx-dock-tx"><small>DOCKING · {ROOMS[dock.room].deck}</small><b>{ROOMS[dock.room].name}</b></span>
    </div>, document.body) : null;
  return { start, overlay };
}
