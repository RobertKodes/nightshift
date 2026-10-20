import { useEffect, useId, useRef } from "react";
import { type BannerDesign, type EffectDesign, type EmoteDesign, type FrameDesign, ITEMS, type TitleDesign } from "./catalog";

/**
 * The 2D cosmetics, in SVG and canvas: profile frames around the crew frog, banners, titles,
 * emotes and win effects, drawn from the catalogue's designs in the NIGHTSHIFT style (night
 * violet, lime, gold; frogs, lily pads, stars, the station).
 */
const des = <T,>(id: string, fallback: string) => (ITEMS.get(id)?.design ?? ITEMS.get(fallback)!.design) as T;

/** The NIGHT FROG crest as an SVG group, centred at (x, y), `s` wide. */
export function FrogMark({ x = 0, y = 0, s = 100, color, eye = "#03020a", mouth = true }: { x?: number; y?: number; s?: number; color: string; eye?: string; mouth?: boolean }) {
  const k = s / 100;
  return <g transform={`translate(${x} ${y}) scale(${k})`}>
    <ellipse cx="0" cy="8" rx="50" ry="32" fill={color} />
    <circle cx="-27" cy="-16" r="18" fill={color} /><circle cx="27" cy="-16" r="18" fill={color} />
    <ellipse cx="-27" cy="-16" rx="7" ry="10" fill={eye} /><ellipse cx="27" cy="-16" rx="7" ry="10" fill={eye} />
    {mouth && <path d="M-25 12 Q0 32 25 12" stroke={eye} strokeWidth="5" fill="none" strokeLinecap="round" />}
  </g>;
}
const Sparkle = ({ x, y, r, color }: { x: number; y: number; r: number; color: string }) => <path d={`M${x} ${y - r}Q${x + r * .12} ${y - r * .12} ${x + r} ${y}Q${x + r * .12} ${y + r * .12} ${x} ${y + r}Q${x - r * .12} ${y + r * .12} ${x - r} ${y}Q${x - r * .12} ${y - r * .12} ${x} ${y - r}Z`} fill={color} />;
const Lily = ({ x, y, r, color, turn = 0 }: { x: number; y: number; r: number; color: string; turn?: number }) => <path transform={`translate(${x} ${y}) rotate(${turn})`} d={`M0 0L${r * Math.cos(.16)} ${r * Math.sin(.16)}A${r} ${r} 0 1 1 ${r * Math.cos(-.16)} ${r * Math.sin(-.16)}Z`} fill={color} />;

/** The player's face: a crew frog in the frame they wear. */
export function Avatar({ frame, avatar, size = 64, level }: { frame: string; avatar: number | string | null | undefined; size?: number; level?: number }) {
  const d = des<FrameDesign>(frame, "frame-none"), id = useId().replace(/:/g, "");
  const src = typeof avatar === "string" ? avatar : `/games/pinball/frog-${avatar ?? 0}.webp`;
  const [a, b, c] = [d.colors[0]!, d.colors[1] ?? d.colors[0]!, d.colors[2] ?? d.colors[0]!];
  return <span className={`np-avatar m-${d.motif}`} style={{ width: size, height: size }}>
    <img src={src} alt="" width={size} height={size} />
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs><linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient></defs>
      {d.motif === "ring" && <circle cx="50" cy="50" r="46" fill="none" stroke={`url(#g${id})`} strokeWidth="4" />}
      {d.motif === "lily" && <><circle cx="50" cy="50" r="45" fill="none" stroke={a} strokeWidth="5" />{[[50, 4, 0], [10, 72, 120], [90, 72, 240]].map(([x, y, t], i) => <Lily key={i} x={x!} y={y!} r={11} color={b} turn={t!} />)}{[[24, 14], [80, 18], [50, 96]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4.5" fill={c} />)}</>}
      {d.motif === "circuit" && <><rect x="5" y="5" width="90" height="90" rx="22" fill="none" stroke={a} strokeWidth="3.5" /><path d="M5 30h12l6 6M95 70H83l-6-6M30 95v-12l6-6M70 5v12l-6 6" stroke={a} strokeWidth="2.5" fill="none" />{[[23, 36], [77, 64], [36, 77], [64, 23]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill={a} />)}</>}
      {d.motif === "stars" && <><circle cx="50" cy="50" r="46" fill="none" stroke={a} strokeWidth="3" /><circle cx="50" cy="50" r="41" fill="none" stroke={b} strokeWidth="1" opacity=".7" />{[[50, 3], [93, 40], [80, 88], [20, 88], [7, 40]].map(([x, y], i) => <Sparkle key={i} x={x!} y={y!} r={6} color={b} />)}</>}
      {d.motif === "crown" && <><circle cx="50" cy="52" r="44" fill="none" stroke={a} strokeWidth="4" /><path d="M28 18 32 2l9 9 9-11 9 11 9-9 4 16Z" fill={a} stroke="#7a4b10" strokeWidth="1" /><circle cx="42" cy="9" r="2.4" fill={b} /><circle cx="58" cy="9" r="2.4" fill={b} /></>}
      {d.motif === "genesis" && <><circle cx="50" cy="50" r="46" fill="none" stroke={`url(#g${id})`} strokeWidth="5" />{Array.from({ length: 7 }, (_, i) => { const t = (i / 7) * Math.PI * 2 + Math.PI / 2, x = 50 + 46 * Math.cos(t), y = 50 + 46 * Math.sin(t); return <path key={i} d={`M${x} ${y - 5}l4 5-4 5-4-5Z`} fill={b} />; })}<circle cx="40" cy="6" r="3" fill={c} /><circle cx="60" cy="6" r="3" fill={c} /></>}
    </svg>
    {level !== undefined && <b className="np-level" title={`Level ${level}`}>{level}</b>}
  </span>;
}

/** A profile banner, 600 × 150, drawn from its motif. */
export function Banner({ id, className = "" }: { id: string; className?: string }) {
  const d = des<BannerDesign>(id, "banner-shift"), uid = useId().replace(/:/g, ""), [a, b, c] = [d.colors[0]!, d.colors[1]!, d.colors[2]!];
  let r = 17; const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const stars = Array.from({ length: 60 }, () => [rnd() * 600, rnd() * 110, rnd() * 1.4 + 0.3] as const);
  return <svg className={`np-banner ${className}`} viewBox="0 0 600 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id={`b${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>
      <radialGradient id={`r${uid}`} cx=".5" cy=".95" r=".7"><stop offset="0" stopColor={c} stopOpacity=".35" /><stop offset="1" stopColor={c} stopOpacity="0" /></radialGradient></defs>
    <rect width="600" height="150" fill={`url(#b${uid})`} />
    {d.motif !== "pond" && stars.map(([x, y, s], i) => <circle key={i} cx={x} cy={y} r={s} fill="#e9e2ff" opacity={0.25 + (i % 5) * 0.12} />)}
    {d.motif === "station" && <><rect width="600" height="150" fill={`url(#r${uid})`} />{Array.from({ length: 16 }, (_, i) => { const w = 22 + rnd() * 26, h = 30 + rnd() * 70, x = i * 38 - 4; return <g key={i}><rect x={x} y={150 - h} width={w} height={h} fill="#0a0620" stroke={c} strokeOpacity=".25" />{Array.from({ length: Math.floor(h / 14) }, (_, j) => rnd() > 0.55 ? <rect key={j} x={x + 5 + (j % 2) * 8} y={150 - h + 6 + j * 13} width="4" height="5" fill={j % 4 ? c : "#b8ff4a"} opacity=".75" /> : null)}</g>; })}<rect x="0" y="146" width="600" height="4" fill={c} opacity=".6" /></>}
    {d.motif === "pond" && <><rect width="600" height="150" fill={`url(#r${uid})`} />{[[80, 110, 26, 10], [210, 90, 18, 160], [330, 122, 30, 300], [470, 100, 22, 60], [560, 130, 16, 200], [140, 135, 14, 90]].map(([x, y, s, t], i) => <g key={i}><ellipse cx={x} cy={y} rx={s! * 1.6} ry={s! * 0.5} fill="none" stroke="#9ff2cf" strokeOpacity=".12" /><g transform={`translate(${x} ${y}) scale(1 .45)`}><Lily x={0} y={0} r={s!} color="#1d8a5c" turn={t} /></g>{i % 2 === 0 && <circle cx={x! + 4} cy={y! - 6} r="5" fill={c} />}</g>)}</>}
    {d.motif === "grid" && <><rect x="0" y="82" width="600" height="68" fill="#000" opacity=".25" />{Array.from({ length: 21 }, (_, i) => <line key={i} x1={300} y1={82} x2={-300 + i * 60} y2={150} stroke={b} strokeOpacity=".7" />)}{Array.from({ length: 6 }, (_, i) => <line key={i} x1="0" x2="600" y1={82 + (i * i * 2.4)} y2={82 + (i * i * 2.4)} stroke={b} strokeOpacity=".6" />)}<line x1="0" x2="600" y1="82" y2="82" stroke={c} strokeWidth="2" /><circle cx="300" cy="82" r="34" fill={c} opacity=".18" /></>}
    {d.motif === "chorus" && <>{[60, 160, 260, 360, 460, 560].map((x, i) => <g key={i}><FrogMark x={x} y={118 - (i % 2) * 8} s={70} color={i % 3 === 1 ? c : b} eye={a} mouth={false} /><ellipse cx={x} cy={128 - (i % 2) * 8} rx="10" ry={4 + (i % 3) * 3} fill={a} />{i % 2 === 0 && <path d={`M${x + 26} ${70 - i}v-18l10-3v15`} stroke={c} strokeWidth="2.5" fill="none" />}</g>)}</>}
    {d.motif === "stars" && <><circle cx="470" cy="76" r="46" fill="#05040a" stroke={b} strokeWidth="2" /><circle cx="458" cy="66" r="17" fill="#f4f1e8" /><text x="458" y="73" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="20" fill="#0d0b14">8</text><path d="M436 46a46 46 0 0 1 34-16" stroke="#fff" strokeOpacity=".35" strokeWidth="5" fill="none" strokeLinecap="round" />{[[100, 40], [180, 96], [300, 30], [360, 110]].map(([x, y], i) => <Sparkle key={i} x={x!} y={y!} r={7} color={c} />)}</>}
    {d.motif === "break" && <>{Array.from({ length: 15 }, (_, i) => { const t = (i / 15) * Math.PI * 2, x = 300 + Math.cos(t) * (80 + (i % 4) * 40), y = 80 + Math.sin(t) * (28 + (i % 3) * 12); return <g key={i}><line x1="300" y1="80" x2={x} y2={y} stroke={i % 2 ? b : c} strokeOpacity=".35" strokeWidth="2" /><circle cx={x} cy={y} r={9} fill={i % 3 === 0 ? c : b} /></g>; })}<circle cx="300" cy="80" r="10" fill="#f4f1e8" /></>}
  </svg>;
}

export const Title = ({ id }: { id: string }) => { const d = des<TitleDesign>(id, "title-rookie"); return <span className="np-title" style={{ color: d.color, borderColor: `${d.color}55` }}>{d.text}</span>; };

/** An emote as it pops up at the table: its glyph and words. */
export function Emote({ id, big = false }: { id: string; big?: boolean }) {
  const d = des<EmoteDesign>(id, "emote-gg");
  const glyph = {
    gg: <text x="12" y="16" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="11" fill={d.color}>GG</text>,
    thumb: <path d="M7 11h3l3-6c1.6 0 2.2 1 2 2.6L14.5 10H19a1.6 1.6 0 0 1 1.5 2l-1.6 6A2 2 0 0 1 17 19.5H7Zm-3 0h2v8.5H4Z" fill={d.color} />,
    frog: <g transform="translate(12 13) scale(.17)"><FrogMark color={d.color} /></g>,
    oops: <><circle cx="12" cy="12" r="8" fill="none" stroke={d.color} strokeWidth="2" /><circle cx="9" cy="10" r="1.3" fill={d.color} /><circle cx="15" cy="10" r="1.3" fill={d.color} /><circle cx="12" cy="15.5" r="2" fill="none" stroke={d.color} strokeWidth="1.6" /></>,
    think: <><circle cx="12" cy="11" r="7" fill="none" stroke={d.color} strokeWidth="2" /><path d="M10 9.5a2 2 0 1 1 3 1.7c-.8.5-1 1-1 1.8M12 15.5v.2" stroke={d.color} strokeWidth="1.8" fill="none" strokeLinecap="round" /></>,
    flame: <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1.2-3.6 2.4-4.6.3 1.4 1 2.4 2.1 2.9C11 9 11 6 12 3Z" fill={d.color} />,
    eyes: <><circle cx="8" cy="12" r="4.2" fill={d.color} /><circle cx="16" cy="12" r="4.2" fill={d.color} /><ellipse cx="8" cy="12" rx="1.4" ry="2.4" fill="#03020a" /><ellipse cx="16" cy="12" rx="1.4" ry="2.4" fill="#03020a" /></>,
    hands: <path d="M5 13l4-6 2 1-2 4h3l1-5 2 .5-.5 4.5H18l1 2-3 5H9Z" fill={d.color} />,
  }[d.glyph];
  return <span className={`np-emote ${big ? "big" : ""}`} style={{ borderColor: `${d.color}66` }}><svg viewBox="0 0 24 24" aria-hidden="true">{glyph}</svg><b style={{ color: d.color }}>{d.text}</b></span>;
}

/** A win effect, played over the table for a few seconds (canvas particles in the effect's motif). */
export function WinEffect({ id, play, lite }: { id: string; play: boolean; lite?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !play) return;
    const d = des<EffectDesign>(id, "effect-sparks"), g = c.getContext("2d")!, dpr = Math.min(2, devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight; c.width = W * dpr; c.height = H * dpr; g.scale(dpr, dpr);
    const n = lite ? 60 : 160, t0 = performance.now(), parts = Array.from({ length: n }, (_, i) => {
      const a = Math.random() * Math.PI * 2, v = d.motif === "fireflies" ? 0.3 + Math.random() * 0.6 : 1.5 + Math.random() * 5;
      return { x: W / 2, y: H / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (d.motif === "fireflies" ? 0.8 : 0), c: d.colors[i % d.colors.length]!, s: 2 + Math.random() * 4, phase: Math.random() * 6 };
    });
    if (d.motif === "fireflies" || d.motif === "lily" || d.motif === "frogs") for (const p of parts) { p.x = Math.random() * W; p.y = H * (0.5 + Math.random() * 0.5); }
    let raf = 0;
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      g.clearRect(0, 0, W, H);
      if (t > 3.2) return;
      const fade = Math.min(1, (3.2 - t) / 0.8);
      if (d.motif === "rings") {
        for (let k = 0; k < 4; k++) { const rr = ((t * 260 + k * 90) % 520); g.strokeStyle = d.colors[k % d.colors.length]!; g.globalAlpha = fade * Math.max(0, 1 - rr / 520); g.lineWidth = 6; g.beginPath(); g.arc(W / 2, H / 2, rr, 0, Math.PI * 2); g.stroke(); }
      }
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy;
        if (d.motif === "sparks" || d.motif === "rings") { p.vy += 0.08; p.vx *= 0.99; }
        if (d.motif === "fireflies") { p.x += Math.sin(t * 2 + p.phase) * 0.6; }
        g.globalAlpha = fade * (d.motif === "fireflies" ? 0.5 + 0.5 * Math.sin(t * 6 + p.phase) : 1);
        g.fillStyle = p.c;
        if (d.motif === "lily") { g.save(); g.translate(p.x, p.y); g.scale(1, 0.5); g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, p.s * 3 * Math.min(1, t * 1.5), 0.2, Math.PI * 2 - 0.2); g.fill(); g.restore(); }
        else if (d.motif === "frogs") {
          const hop = Math.abs(Math.sin(t * 5 + p.phase)) * 26;
          g.save(); g.translate(p.x + t * 40 * (p.vx > 0 ? 1 : -1), p.y - hop); g.scale(0.16, 0.16);
          g.beginPath(); g.ellipse(0, 8, 50, 32, 0, 0, Math.PI * 2); g.arc(-27, -16, 18, 0, Math.PI * 2); g.arc(27, -16, 18, 0, Math.PI * 2); g.fill(); g.restore();
        } else { g.beginPath(); g.arc(p.x, p.y, p.s, 0, Math.PI * 2); g.fill(); }
      }
      g.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [id, play, lite]);
  return <canvas ref={ref} className="np-effect" aria-hidden="true" />;
}
