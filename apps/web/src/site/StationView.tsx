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
  const canvas = useRef<HTMLCanvasElement>(null), patchInset = useRef<HTMLCanvasElement>(null), patchArt = useRef<HTMLCanvasElement | null>(null), jump = useRef(onDock);
  const scene = useRef<{ invalidate: () => void; dispose: () => void } | null>(null);
  const [patchReady, setPatchReady] = useState(false);
  const [ready, setReady] = useState(false), [unavailable, setUnavailable] = useState(false);
  jump.current = onDock;
  useImperativeHandle(ref, () => ({ invalidate: () => scene.current?.invalidate() }), []);
  useEffect(() => {
    let cancelled = false;
    setReady(false); setUnavailable(false); setPatchReady(false); patchArt.current = null;
    void import("../station3d/scene").then(({ createStationScene }) => {
      if (cancelled || !canvas.current) return;
      try {
        scene.current = createStationScene(canvas.current, { input, onDemand, reduced,
          onPatch: (art) => { if (!cancelled) { patchArt.current = art; setPatchReady(true); } },
          onReady: () => { if (!cancelled) setReady(true); },
          onUnavailable: () => { if (!cancelled) { setReady(false); setUnavailable(true); scene.current?.dispose(); scene.current = null; } },
          onDock: (index) => jump.current(index),
        });
      } catch { if (!cancelled) setUnavailable(true); }
    }).catch(() => { if (!cancelled) setUnavailable(true); });
    return () => { cancelled = true; scene.current?.dispose(); scene.current = null; };
  }, [input, onDemand, reduced]);
  useEffect(() => { scene.current?.invalidate(); }, [active, overview]);
  useEffect(() => {
    const context = patchInset.current?.getContext("2d");
    if (context && patchArt.current) context.drawImage(patchArt.current, 0, 0, 256, 256);
  }, [patchReady, active, ready]);
  return <div className="pv-station" data-ready={ready} data-unavailable={unavailable}>
    <StationMap active={active} overview={overview} onDock={onDock} inactive={ready} />
    <canvas ref={canvas} aria-hidden="true" />
    {!onDemand && active === 0 && ready && patchReady && <figure className="pv-patch-inset"><canvas ref={patchInset} width="256" height="256" role="img" aria-label="NIGHTSHIFT crew patch with NIGHT FROG number 1" /><figcaption>CREW PATCH / 01</figcaption></figure>}
  </div>;
});
