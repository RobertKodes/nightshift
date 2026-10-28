import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { FlightInput } from "../station3d/stops";
import { StationMap } from "./StationMap";

export type StationHandle = { invalidate: () => void };
type Props = { input: FlightInput; active: number; overview?: boolean; onDock: (index: number) => void; onDemand?: boolean; reduced: boolean };

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)"), update = () => setReduced(query.matches);
    query.addEventListener("change", update); return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** The only three.js entry point; hub headers repaint only when explicitly invalidated. */
export const StationView = forwardRef<StationHandle, Props>(function StationView({ input, active, overview = false, onDock, onDemand = false, reduced }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null), jump = useRef(onDock);
  const scene = useRef<{ invalidate: () => void; dispose: () => void } | null>(null);
  const [ready, setReady] = useState(false), [unavailable, setUnavailable] = useState(false);
  jump.current = onDock;
  useImperativeHandle(ref, () => ({ invalidate: () => scene.current?.invalidate() }), []);
  useEffect(() => {
    let cancelled = false;
    setReady(false); setUnavailable(false);
    void import("../station3d/scene").then(({ createStationScene }) => {
      if (cancelled || !canvas.current) return;
      try {
        scene.current = createStationScene(canvas.current, { input, onDemand, reduced,
          onReady: () => { if (!cancelled) setReady(true); },
          onUnavailable: () => { if (!cancelled) { setReady(false); setUnavailable(true); scene.current?.dispose(); scene.current = null; } },
          onDock: (index) => jump.current(index),
        });
      } catch { if (!cancelled) setUnavailable(true); }
    }).catch(() => { if (!cancelled) setUnavailable(true); });
    return () => { cancelled = true; scene.current?.dispose(); scene.current = null; };
  }, [input, onDemand, reduced]);
  useEffect(() => { scene.current?.invalidate(); }, [active, overview]);
  return <div className="pv-station" data-ready={ready} data-unavailable={unavailable}>
    <StationMap active={active} overview={overview} onDock={onDock} inactive={ready} />
    <canvas ref={canvas} aria-hidden="true" />
  </div>;
});
