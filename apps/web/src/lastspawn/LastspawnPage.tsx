import { useEffect, useMemo, useRef, useState } from "react";
import { ABILITIES, BASE_LOOK, CLASSES, type ClassId, type Look, type LookKey, PATTERNS } from "@nightshift/lastspawn";
import { Game, type Hud } from "./game";
import { Bag } from "./Bag";
import { AbilityIcon } from "./icons";
import { pickQuality } from "./stage";
import "./lastspawn.css";

/** Curated skins: each one a whole frog that works, not a free colour wheel. Values are HSV bytes. */
const SKINS: { name: string; l: Partial<Look> }[] = [
  { name: "Moss", l: { skinH: 72, skinS: 140, skinV: 120, bellyH: 46, bellyS: 60, bellyV: 205, lipH: 6, lipS: 150, lipV: 105, padH: 72, padS: 130, padV: 90 } },
  { name: "Reed", l: { skinH: 58, skinS: 120, skinV: 150, bellyH: 40, bellyS: 70, bellyV: 220, lipH: 10, lipS: 140, lipV: 120, padH: 50, padS: 110, padV: 110 } },
  { name: "Fen", l: { skinH: 96, skinS: 110, skinV: 95, bellyH: 60, bellyS: 40, bellyV: 190, lipH: 250, lipS: 90, lipV: 90, padH: 96, padS: 100, padV: 70 } },
  { name: "Slate", l: { skinH: 150, skinS: 50, skinV: 110, bellyH: 140, bellyS: 25, bellyV: 200, lipH: 0, lipS: 110, lipV: 100, padH: 150, padS: 40, padV: 80 } },
  { name: "Ash", l: { skinH: 40, skinS: 35, skinV: 120, bellyH: 32, bellyS: 30, bellyV: 210, lipH: 5, lipS: 90, lipV: 95, padH: 40, padS: 30, padV: 90 } },
  { name: "Amber dart", l: { skinH: 24, skinS: 220, skinV: 210, bellyH: 20, bellyS: 160, bellyV: 230, lipH: 2, lipS: 200, lipV: 90, padH: 0, padS: 0, padV: 25, pattern: 3, patH: 0, patMix: 230 } },
  { name: "Cobalt dart", l: { skinH: 160, skinS: 200, skinV: 190, bellyH: 150, bellyS: 120, bellyV: 210, lipH: 170, lipS: 150, lipV: 70, padH: 0, padS: 0, padV: 25, pattern: 1, patH: 0, patMix: 220, patScale: 150 } },
  { name: "Ember", l: { skinH: 2, skinS: 190, skinV: 160, bellyH: 18, bellyS: 120, bellyV: 220, lipH: 250, lipS: 120, lipV: 60, padH: 0, padS: 0, padV: 30, pattern: 2, patH: 0, patMix: 170 } },
];
const IRIS = [24, 12, 40, 150, 0, 200];
type Slider = { k: LookKey; label: string };
const SHAPE: Slider[] = [
  { k: "height", label: "Height" }, { k: "build", label: "Build" }, { k: "headWide", label: "Head width" }, { k: "headFlat", label: "Flat head" },
  { k: "snout", label: "Snout" }, { k: "cheeks", label: "Cheeks" }, { k: "throat", label: "Throat" }, { k: "belly", label: "Belly" }, { k: "slim", label: "Lean" },
];
const FACE: Slider[] = [
  { k: "eyeSize", label: "Eye size" }, { k: "lidDroop", label: "Heavy lids" }, { k: "lidAngry", label: "Hard stare" },
  { k: "lipsFull", label: "Full lips" }, { k: "smug", label: "Smug" }, { k: "frown", label: "Frown" },
];
const TABS = ["Shape", "Face", "Skin", "Class"] as const;

export function LastspawnPage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [look, setLook] = useState<Look>({ ...BASE_LOOK });
  const [tab, setTab] = useState<(typeof TABS)[number]>("Shape");
  const [name, setName] = useState("");
  const [cls, setCls] = useState<ClassId>("reedguard");
  const touch = useMemo(() => matchMedia("(pointer: coarse)").matches, []);

  useEffect(() => {
    document.title = "LASTSPAWN · NIGHTSHIFT";
    let g: Game | null = null, alive = true;
    const el = canvas.current!;
    const fit = () => g?.resize(el.clientWidth, el.clientHeight);
    Game.start(el, pickQuality(), labels.current!).then((x) => {
      if (!alive) { x.dispose(); return; }
      g = x; fit(); setGame(x); x.subscribe(setHud);
      if (import.meta.env.DEV) (window as unknown as { __ls: Game }).__ls = x;
    }).catch((e) => setErr(String(e?.message ?? e)));
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => { alive = false; ro.disconnect(); g?.dispose(); };
  }, []);

  const change = (p: Partial<Look>) => { const n = { ...look, ...p }; setLook(n); game?.setLook(n); };
  const pickClass = (c: ClassId) => { setCls(c); game?.previewClass(c); };
  const phase = hud?.phase ?? "loading";
  const nameOk = /^[A-Za-z][A-Za-z0-9 '-]{2,15}$/.test(name.trim());
  const net = hud?.net ?? "connecting";

  return <div className={`ls-root ls-phase-${phase}${touch ? " ls-touch" : ""}`}>
    <canvas ref={canvas} className="ls-canvas" />
    <div ref={labels} className="ls-labels" aria-hidden="true" />
    {err && <div className="ls-center"><p className="ls-err">The game could not start: {err}</p></div>}
    {phase === "loading" && !err && <div className="ls-center"><div className="ls-mark">LASTSPAWN</div><p className="ls-sub">Waking the water…</p></div>}

    {phase === "title" && <div className="ls-title">
      <div className="ls-chapter">Chapter One · The Keeper's Light</div>
      <h1 className="ls-mark">LASTSPAWN</h1>
      <p className="ls-sub">For forty-one years the moon has not moved, and no egg has hatched.<br />Under a dead lighthouse, an old keeper has got the water running again.</p>
      <div className="ls-title-actions">
        {hud?.chars.map((c) => <button key={c.id} className="ls-btn" type="button" onClick={() => game?.resume(c.id)}>Continue as {c.name}<small>{CLASSES[c.cls].name} · level {c.level}</small></button>)}
        {(hud?.chars.length ?? 0) < 3 && <button className={`ls-btn${hud?.chars.length ? " ghost" : ""}`} type="button" onClick={() => game?.openCreator(look)}>{hud?.chars.length ? "A new frog" : "Hatch"}</button>}
      </div>
      <p className={`ls-fine ls-net ${net}`}>{net === "online" ? "The world is awake" : net === "connecting" ? "Reaching the world…" : "The world is not answering. Trying again…"} · desktop and phone · AI agents play here too</p>
    </div>}

    {phase === "create" && <div className="ls-create">
      <div className="ls-create-head"><span className="ls-chapter">The Turning</span><h2>Who comes up out of the water?</h2></div>
      <div className="ls-tabs" role="tablist">{TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div className="ls-panel">
        {tab === "Shape" && SHAPE.map((s) => <Range key={s.k} s={s} v={look[s.k]} on={(v) => change({ [s.k]: v })} />)}
        {tab === "Face" && <>
          {FACE.map((s) => <Range key={s.k} s={s} v={look[s.k]} on={(v) => change({ [s.k]: v })} />)}
          <div className="ls-row-label">Eyes</div>
          <div className="ls-swatches">{IRIS.map((h) => <button key={h} type="button" aria-label={`Eye colour ${h}`} className={look.irisH === h ? "on" : ""} style={{ background: `hsl(${(h / 255) * 360} 75% 45%)` }} onClick={() => change({ irisH: h })} />)}</div>
        </>}
        {tab === "Skin" && <>
          <div className="ls-skins">{SKINS.map((s) => <button key={s.name} type="button" className={look.skinH === s.l.skinH && look.skinS === s.l.skinS ? "on" : ""} onClick={() => change({ pattern: 0, patMix: 90, patH: 60, patScale: 128, ...s.l })}>
            <i style={{ background: `hsl(${((s.l.skinH ?? 0) / 255) * 360} ${((s.l.skinS ?? 0) / 255) * 70}% ${((s.l.skinV ?? 0) / 255) * 50}%)` }} />{s.name}</button>)}</div>
          <Range s={{ k: "skinV", label: "Skin depth" }} v={look.skinV} on={(v) => change({ skinV: v })} />
          <Range s={{ k: "bellyV", label: "Belly" }} v={look.bellyV} on={(v) => change({ bellyV: v })} />
          <Range s={{ k: "lipV", label: "Lips" }} v={look.lipV} on={(v) => change({ lipV: v })} />
          <div className="ls-row-label">Pattern</div>
          <div className="ls-chips">{PATTERNS.map((p, i) => <button key={p} type="button" className={look.pattern === i ? "on" : ""} onClick={() => change({ pattern: i })}>{p}</button>)}</div>
          {look.pattern > 0 && <><Range s={{ k: "patScale", label: "Pattern size" }} v={look.patScale} on={(v) => change({ patScale: v })} /><Range s={{ k: "patMix", label: "Pattern strength" }} v={look.patMix} on={(v) => change({ patMix: v })} /></>}
        </>}
        {tab === "Class" && <>
          <div className="ls-classes">{(Object.keys(CLASSES) as ClassId[]).map((id) => <button key={id} type="button" className={cls === id ? "on" : ""} onClick={() => pickClass(id)}>
            <b>{CLASSES[id].name}</b><small>{CLASSES[id].role}</small><span>{CLASSES[id].blurb}</span></button>)}</div>
          <label className="ls-name"><span>Name</span><input value={name} maxLength={16} placeholder="What Wend will call you" onChange={(e) => setName(e.target.value)} /></label>
        </>}
      </div>
      {hud?.error && <p className="ls-error">{hud.error}</p>}
      <div className="ls-create-foot">
        <button className="ls-btn ghost" type="button" onClick={() => { const n = { ...BASE_LOOK }; setLook(n); game?.setLook(n); }}>Reset</button>
        <button className="ls-btn" type="button" disabled={!nameOk || net !== "online"} title={nameOk ? "" : "Pick a class and a name (3 to 16 letters)"} onClick={() => game?.begin(name.trim(), cls)}>{net !== "online" ? "Reaching the world…" : nameOk ? "Come up" : tab === "Class" ? "Name your frog" : "Next: Class"}</button>
      </div>
      {!nameOk && tab !== "Class" && <button className="ls-skip" type="button" onClick={() => setTab("Class")}>Choose class and name →</button>}
    </div>}

    {phase === "play" && hud && <PlayHud hud={hud} game={game!} touch={touch} />}
  </div>;
}

function Range({ s, v, on }: { s: Slider; v: number; on: (v: number) => void }) {
  return <label className="ls-range"><span>{s.label}</span><input type="range" min={0} max={255} value={v} onChange={(e) => on(Number(e.target.value))} /></label>;
}

function PlayHud({ hud, game, touch }: { hud: Hud; game: Game; touch: boolean }) {
  const [, tick] = useState(0);
  const [typing, setTyping] = useState(false);
  const [bag, setBag] = useState(false);
  useEffect(() => { game.controls.onBag = () => setBag((b) => !b); }, [game]);
  const [line, setLine] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 100); return () => clearInterval(i); }, []);
  useEffect(() => { game.controls.onChat = () => { setTyping(true); setTimeout(() => input.current?.focus(), 0); }; }, [game]);
  const now = performance.now();
  const bar = game.bar;
  const joy = game.controls.joy;
  const send = () => { game.say(line); setLine(""); setTyping(false); input.current?.blur(); };
  return <>
    <div className="ls-me">
      <div className="ls-me-name">{hud.name}<small>{CLASSES[hud.cls].name} · level {hud.level}</small></div>
      <Bar v={hud.hp} max={hud.hpMax} kind="hp" />
      <div className="ls-xp" title={`${hud.xp} / ${hud.xpNext} experience`}><i style={{ width: `${Math.min(100, (hud.xp / Math.max(1, hud.xpNext)) * 100)}%` }} /></div>
    </div>
    {hud.net !== "online" && <div className="ls-netbar">{hud.net === "connecting" ? "Reconnecting to the world…" : "The world is not answering. Trying again…"}</div>}
    {hud.target && <div className="ls-target"><div className="ls-me-name">{hud.target.name}<small>level {hud.target.level}</small></div><Bar v={hud.target.hp} max={hud.target.hpMax} kind={hud.target.kind === "mob" ? "foe" : "hp"} /></div>}
    {hud.quests.length > 0 && <div className="ls-quest">{hud.quests.map((q) => <div key={q.id} className="ls-q">
      <b>{q.name}</b>
      {q.steps.map((s) => <div key={s.text} className={s.have >= s.need ? "done" : ""}>{s.text} <i>{s.have}/{s.need}</i></div>)}
      {q.ready && <div className="ret">Return to {q.turnIn === "keeper_wend" ? "Keeper Wend" : q.turnIn === "brother_cress" ? "Brother Cress" : "the quest giver"}</div>}
    </div>)}</div>}
    {hud.caption && !hud.dialog && <div className="ls-caption"><b>{hud.caption.who}</b>{hud.caption.text}</div>}
    {hud.prompt && !hud.dialog && <button type="button" className="ls-prompt" onClick={() => game.interact()}>{touch ? "Tap" : "E"} · {hud.prompt}</button>}
    {hud.dialog && <div className="ls-dialog" role="dialog" aria-label={hud.dialog.name}>
      <div className="ls-dialog-name">{hud.dialog.name}</div>
      {hud.dialog.text.split("\n\n").map((p, i) => <p key={i}>{p}</p>)}
      <div className="ls-dialog-opts">{hud.dialog.options.map((o, i) => <button key={o.id} type="button" onClick={() => game.choose(o.id)}><i>{i + 1}</i>{o.text}</button>)}</div>
    </div>}
    {hud.casting && <div className="ls-cast"><span>{ABILITIES[hud.casting.ability]?.name}</span><Bar v={hud.casting.ms - Math.max(0, hud.casting.until - now)} max={hud.casting.ms} kind="cast" /></div>}
    <div className="ls-bar">
      {bar.map((id, i) => {
        const a = ABILITIES[id]!, cd = Math.max(hud.cooldowns[id] ?? 0, a.gcd ? hud.gcdUntil : 0) - now;
        const total = Math.max(a.cooldownMs, a.gcd ? 1000 : 0) || 1;
        return <button key={id} type="button" className="ls-ab" title={`${a.name}: ${a.desc}`} onClick={() => game.cast(id)} style={{ ["--cd" as string]: cd > 0 ? Math.min(1, cd / total) : 0 }}>
          <span className="ls-ab-glyph"><AbilityIcon id={id} /></span>
          {!touch && <i>{i + 1}</i>}
          <small>{a.name}</small>
        </button>;
      })}
    </div>
    <div className={`ls-chat${typing ? " on" : ""}`}>
      {hud.chat.map((c) => <div key={c.id} className={c.ch}><b>{c.name}</b> {c.text}</div>)}
      {typing && <input ref={input} value={line} maxLength={200} placeholder="Say something" onChange={(e) => setLine(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") send(); if (e.key === "Escape") { setTyping(false); input.current?.blur(); } e.stopPropagation(); }} onBlur={() => setTyping(false)} />}
    </div>
    {hud.floats.map((f) => <div key={f.id} className={`ls-float ${f.kind}`} style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%` }}>{f.text}</div>)}
    {hud.dead && <div className="ls-dead">You are down</div>}
    {bag && <Bag hud={hud} game={game} onClose={() => setBag(false)} />}
    <button type="button" className="ls-bag-btn" aria-label="Bag" title="Bag (I)" onClick={() => setBag((b) => !b)}>
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8h12l1 12H5z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>
      {hud.bag.length > 0 && <i>{hud.bag.reduce((n, b) => n + b.n, 0)}</i>}
    </button>
    {touch && <>
      {joy.active && <div className="ls-joy" style={{ left: joy.ox, top: joy.oy }}><i style={{ transform: `translate(${joy.x * 56}px, ${joy.y * 56}px)` }} /></div>}
      {!joy.active && <div className="ls-joy-hint">Move</div>}
      <button type="button" className="ls-leap" onClick={() => game.controls.onLeap()} style={{ ["--cd" as string]: Math.max(0, ((hud.cooldowns.leap ?? 0) - now) / 4000) }}>Leap</button>
      <button type="button" className="ls-cycle" onClick={() => game.controls.onCycle()}>Target</button>
      <button type="button" className="ls-talk-btn" onClick={() => { setTyping(true); setTimeout(() => input.current?.focus(), 0); }}>Say</button>
    </>}
    {!touch && <div className="ls-keys">WASD move · Shift walk · Space leap · Tab target · 1-6 abilities · E talk · I bag · Enter chat · drag to look</div>}
  </>;
}

function Bar({ v, max, kind }: { v: number; max: number; kind: "hp" | "foe" | "cast" }) {
  const p = Math.max(0, Math.min(1, v / Math.max(1, max)));
  return <div className={`ls-hp ${kind}`}><i style={{ width: `${p * 100}%` }} />{kind !== "cast" && <span>{Math.round(v)} / {Math.round(max)}</span>}</div>;
}
