import { useEffect, useRef, useState } from "react";
import { BAYS, type Bay, type DeckExtra, type Entry } from "./data";
import type { DeckInput } from "./scene";

type Controller = { invalidate: () => void; dispose: () => void };
const COARSE = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/** The operations deck as an RTS map: drag or keys to pan, wheel or pinch to zoom, the minimap to jump. */
export function DeckView({ bay, entries, extra, selected, paused, reduced, onPick, onBay, onUnavailable }: { bay: Bay; entries: Entry[]; extra: DeckExtra; selected: string | null; paused: boolean; reduced: boolean; onPick: (key: string) => void; onBay?: (bay: Bay) => void; onUnavailable: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), scene = useRef<Controller | null>(null), pick = useRef(onPick), unavailable = useRef(onUnavailable), follow = useRef(onBay);
  const input = useRef<DeckInput>({ bay, entries, selected, paused, extra }), [ready, setReady] = useState(false);
  pick.current = onPick; unavailable.current = onUnavailable; follow.current = onBay;
  input.current.bay = bay; input.current.entries = entries; input.current.selected = selected; input.current.paused = paused; input.current.extra = extra;
  useEffect(() => {
    const abort = new AbortController(); let failed = false; setReady(false);
    const fail = () => { if (abort.signal.aborted || failed) return; failed = true; setReady(false); scene.current?.dispose(); scene.current = null; unavailable.current(); };
    void import("./scene").then(({ createDeckScene }) => {
      if (!canvas.current || abort.signal.aborted) return null;
      return createDeckScene(canvas.current, { input: input.current, reduced, signal: abort.signal, onPick: (key) => pick.current(key), onBay: (next) => follow.current?.(next), onUnavailable: fail });
    }).then((created) => {
      if (!created) return;
      if (abort.signal.aborted || failed) { created.dispose(); return; }
      scene.current = created; setReady(true);
    }).catch(() => { if (!abort.signal.aborted) fail(); });
    return () => { abort.abort(); scene.current?.dispose(); scene.current = null; };
  }, [reduced]);
  useEffect(() => { scene.current?.invalidate(); }, [bay, entries, extra, selected, paused]);
  const crew = entries.filter((e) => e.bay === bay).length;
  return <div className="pv-deck-viewport" data-ready={ready} tabIndex={ready ? 0 : -1} role="region" aria-label="Operations deck map. Arrow keys or W A S D pan, plus and minus zoom. The live list below has the same crew."><canvas ref={canvas} aria-hidden="true" />
    {ready && <div className="pv-deck-hud" aria-hidden="true"><span>BAY 0{bay + 1} / LIVE</span><b>{BAYS[bay].name}</b><small>{crew ? `${crew.toLocaleString("en-US")} on record` : "Reading crew"}</small></div>}
    {ready && <p className="pv-deck-hint" aria-hidden="true">{COARSE ? "Drag / pinch / tap a frog" : "Drag or WASD to pan / scroll to zoom / click a frog"}</p>}
    {!ready && <p className="pv-deck-loading" role="status">Loading operations deck. The live list is available below.</p>}</div>;
}

