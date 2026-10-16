import { useEffect, useRef, useState } from "react";

/**
 * IMD's frog, the one standing at the desk on imd.fun, comes over to visit. The sprite is IMD's own
 * 19-frame sheet: 0–4 from behind, 5–6 scratching his head, 7–12 side and walking, 13–16 facing us,
 * 17–18 arms up.
 */
const FRAMES = 19;
export function FrogSprite({ frame, className = "" }: { frame: number; className?: string }) {
  return <span className={`imd-frog ${className}`} style={{ backgroundPosition: `${(frame / (FRAMES - 1)) * 100}% 0` }} aria-hidden="true" />;
}

const SAYS = [
  "Visiting from imd.fun 👋",
  "Nice ship. Is the swarm in there?",
  "I checked: your company is still building.",
  "Back at the desk they said you never sleep.",
  "One sentence, one company. Ribbit.",
  "Every $SHIFT trade comes back through IMD. Love it.",
];

type Step = { frames: number[]; ms: number; x?: number; fps?: number };
// One visit: out of the portal, walk over, say hi, stare at the megastructure, think, cheer.
const VISIT: Step[] = [
  { frames: [7], ms: 700, x: 0 },
  { frames: [8, 9, 10, 9], ms: 2600, x: 170, fps: 7 },
  { frames: [12], ms: 900 },
  { frames: [13, 14], ms: 1600, fps: 1.5 },
  { frames: [0], ms: 2600 },
  { frames: [5, 6], ms: 1400, fps: 3 },
  { frames: [17, 18], ms: 1600, fps: 4 },
  { frames: [14], ms: 3200 },
  { frames: [1, 0], ms: 2400, fps: 1 },
];

export function ImdVisitor() {
  const [frame, setFrame] = useState(7);
  const [x, setX] = useState(0);
  const [say, setSay] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const cheer = useRef(0);

  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { setOpen(true); setX(170); setFrame(14); return; }
    let alive = true;
    const timers: number[] = [];
    const run = async () => {
      setOpen(true);
      await new Promise((r) => timers.push(window.setTimeout(r, 900)));
      while (alive) {
        for (const s of VISIT) {
          if (!alive) return;
          if (s.x !== undefined) setX(s.x);
          const t0 = performance.now();
          let i = 0;
          while (alive && performance.now() - t0 < s.ms) {
            if (Date.now() < cheer.current) setFrame(17 + (Math.floor(Date.now() / 220) % 2));
            else setFrame(s.frames[i % s.frames.length]!);
            i++;
            await new Promise((r) => timers.push(window.setTimeout(r, 1000 / (s.fps ?? 4))));
          }
        }
        // the visit loops: he heads back towards the portal and comes out again
        setX(0); setFrame(11);
        await new Promise((r) => timers.push(window.setTimeout(r, 2600)));
      }
    };
    void run();
    return () => { alive = false; timers.forEach(clearTimeout); };
  }, []);

  const poke = () => {
    cheer.current = Date.now() + 1300;
    setFrame(17);
    setSay((c) => { const p = SAYS.filter((l) => l !== c); return p[Math.floor(Math.random() * p.length)]!; });
  };

  return (
    <div className="visit" aria-label="IMD's frog, visiting">
      <a className={`visit-portal${open ? " open" : ""}`} href="https://imd.fun" target="_blank" rel="noreferrer" title="He came from imd.fun">
        <span className="visit-glow" /><b>IMD.FUN</b><i>&gt; portal open_</i>
      </a>
      <div className="visit-walk" style={{ transform: `translateX(${x}%)` }}>
        {say && <div className="visit-say">{say}</div>}
        <button className="visit-frog" onClick={poke} aria-label="Say hi to IMD's frog"><FrogSprite frame={frame} /></button>
      </div>
      <span className="visit-tag">VISITOR · FROM IMD</span>
    </div>
  );
}
