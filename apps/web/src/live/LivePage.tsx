import { useEffect, useRef, useState } from "react";
import { Link } from "../router";
import { useSession } from "../session";
import { LiveAudio } from "./audio";
import { LiveScene } from "./scene";
import { caption, EMPTY, type LiveEvent, type LiveState, validEvent, validState } from "./types";
import "./live.css";

const number = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("en-US");
const price = (n: number | null) => n == null ? "—" : `$${n.toLocaleString("en-US", { maximumSignificantDigits: 5 })}`;
const time = (t: number) => new Date(t).toISOString().slice(11, 19);
const cached = (): LiveState => {
  try { const s: unknown = JSON.parse(localStorage.getItem("nightshift-live-state") ?? "null"); if (validState(s)) return s; } catch { /* storage is optional */ }
  return EMPTY;
};

export function LivePage() {
  const stream = new URLSearchParams(location.search).get("stream") === "1";
  const [state, setState] = useState<LiveState>(cached);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(false);
  const [narration, setNarration] = useState(false);
  const [toast, setToast] = useState<LiveEvent | null>(null);
  const [canvasOk, setCanvasOk] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<LiveScene | null>(null);
  const audio = useRef<LiveAudio | null>(null);
  const soundOn = useRef(false);
  const snapshot = useRef(state);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    document.title = "NIGHTSHIFT LIVE · The night never stops";
    document.documentElement.classList.add("nl-live-root");
    document.documentElement.classList.toggle("nl-stream-root", stream);
    const t = setInterval(() => setNow(Date.now()), 1000);
    audio.current = new LiveAudio();
    try { if (canvas.current) scene.current = new LiveScene(canvas.current); } catch { setCanvasOk(false); }
    scene.current?.setState(snapshot.current);
    return () => { clearInterval(t); scene.current?.dispose(); scene.current = null; audio.current?.dispose(); audio.current = null; document.documentElement.classList.remove("nl-stream-root", "nl-live-root"); };
  }, [stream]);
  useEffect(() => {
    snapshot.current = state; scene.current?.setState(state);
    try { localStorage.setItem("nightshift-live-state", JSON.stringify(state)); } catch { /* a browser source may disable storage */ }
  }, [state]);
  useEffect(() => {
    let on = true, source: EventSource | null = null, retry: ReturnType<typeof setTimeout> | undefined;
    let backoff = 2000;
    let lastId = snapshot.current.events.at(-1)?.id ?? "";
    const remember = (s: LiveState) => {
      if (!on) return;
      if (!lastId) lastId = s.events.at(-1)?.id ?? "";
      for (const e of s.events) seen.current.add(e.id);
      setState((old) => ({ ...s, stats: { ...EMPTY.stats, ...s.stats }, events: [...new Map([...s.events, ...old.events.filter((e) => e.at > s.at)].map((e) => [e.id, e])).values()].sort((a, b) => a.at - b.at).slice(-50) }));
    };
    const load = async () => {
      try { const r = await fetch("/api/live/state", { cache: "no-store", signal: AbortSignal.timeout(10_000) }); if (r.ok) { const s: unknown = await r.json(); if (validState(s)) remember(s); } } catch { /* the last frame remains */ }
    };
    const connect = () => {
      if (!on) return;
      source = new EventSource(`/api/live/stream${lastId ? `?since=${encodeURIComponent(lastId)}` : ""}`);
      source.addEventListener("ready", (m) => {
        try { const s: unknown = JSON.parse((m as MessageEvent).data); if (validState(s)) { remember(s); setConnected(true); backoff = 2000; } } catch { /* ignore an incomplete frame */ }
      });
      source.addEventListener("live", (m) => {
        if (!on) return;
        try {
          const e: unknown = JSON.parse((m as MessageEvent).data);
          if (!validEvent(e)) return;
          lastId = e.id;
          const fresh = !seen.current.has(e.id); seen.current.add(e.id);
          if (seen.current.size > 500) seen.current.delete(seen.current.values().next().value!);
          setState((old) => {
            const stats = { ...old.stats };
            if (e.type === "imd.pulse") { stats.agentsOnline = e.data.agentsOnline as number | null; stats.jobsLastDay = e.data.jobsLastDay as number | null; stats.pulseAt = Number(e.data.at); stats.pulseOk = e.data.ok === true; }
            if (e.type === "shift.stake") stats.stakedShare = Number(e.data.share);
            if (e.type === "imd.job" && fresh) stats.jobsToday++;
            return { ...old, stats, events: [...old.events.filter((x) => x.id !== e.id), e].slice(-50) };
          });
          if (fresh) { scene.current?.event(e); if (soundOn.current) audio.current?.cue(e); }
          if ((fresh || e.data.update) && e.type !== "imd.pulse") setToast(e);
        } catch { /* malformed frames never interrupt a broadcast */ }
      });
      source.onerror = () => {
        if (!on) return;
        setConnected(false); source?.close();
        retry = setTimeout(() => { void load(); connect(); }, backoff + Math.random() * 1000);
        backoff = Math.min(30_000, backoff * 1.8);
      };
    };
    void load(); connect();
    const poll = setInterval(() => void load(), 30_000);
    const online = () => { void load(); };
    window.addEventListener("online", online);
    return () => { on = false; clearInterval(poll); if (retry) clearTimeout(retry); source?.close(); window.removeEventListener("online", online); };
  }, []);
  const toggleSound = async () => {
    if (sound) { audio.current?.mute(); soundOn.current = false; setSound(false); }
    else try { await audio.current?.start(); soundOn.current = true; setSound(true); } catch { setSound(false); }
  };
  const s = state.stats;
  const stale = !s.pulseOk || !s.pulseAt || now - s.pulseAt > 12 * 60_000;
  const recent = state.events.filter((e) => e.type !== "imd.pulse").slice(-7).reverse();
  const active = toast && now - toast.at < 20_000 ? toast : null;
  const detail = active ? caption(active) : null;
  const spotlight = state.spotlight?.current;
  return <div className={`nl-page${stream ? " nl-stream" : ""}`}>
    {!stream && <nav className="nl-nav" aria-label="Site"><Link to="/">← Station</Link><span>NIGHTSHIFT / TRANSMISSION 01</span><a href="#spotlight">Enter the Spotlight ↗</a></nav>}
    <main className="nl-broadcast" aria-label="NIGHTSHIFT live broadcast">
      <header className="nl-hud">
        <div className="nl-brand"><img src="/brand/nightshift-wordmark-mono.svg" alt="NIGHTSHIFT" /><span><i /> LIVE <b>24/7</b></span></div>
        <div className="nl-stat"><small>IMD AGENTS ONLINE</small><strong>{number(s.agentsOnline)}<i className={stale ? "stale" : ""} /></strong></div>
        <div className="nl-stat" title={`IMD pulse: ${number(s.jobsLastDay)} jobs in the last 24 hours`}><small>JOBS TODAY UTC / OBSERVED</small><strong>{state.at ? number(s.jobsToday) : "—"}</strong></div>
        <div className="nl-stat"><small>IMD LAUNCHES / TODAY UTC</small><strong>{state.at ? number(s.launchesToday) : "—"}</strong></div>
        <div className="nl-stat nl-price"><small>$SHIFT / USD</small><strong>{price(s.priceUsd)}</strong></div>
        <div className="nl-clock"><span>{time(now)} UTC</span><small>{state.simulated ? "MOCK PREVIEW" : connected ? "SIGNAL CONNECTED" : state.at ? "LAST SIGNAL · RECONNECTING" : "AWAITING FIRST SIGNAL"}</small></div>
      </header>
      <section className="nl-world" aria-label="The station and IMD hive">
        <canvas ref={canvas} aria-label="IMD hive windows reflect online agents. Real completed jobs dispatch drones; buys power the station." />
        {!canvasOk && <div className="nl-scene-fallback" />}
        <div className="nl-world-shade" />
        <div className="nl-heading"><span className="nl-eyebrow">A LIVING STATION. A REAL SWARM.</span><h1>The night<br />never <em>stops.</em></h1><p>Agents build. The city responds.<br />You’re part of the next signal.</p><div className="nl-source"><i className={stale ? "stale" : ""} /> {stale ? "Waiting for fresh swarm telemetry" : "Real activity from IMD + Ethereum"}</div></div>
        <div className="nl-coordinate">NIGHTSHIFT STATION <span>01 / ETHEREUM</span></div>
        <div className="nl-hive-label"><span>THE IMD HIVE</span><small>{number(s.agentsOnline)} agents · {number(s.jobsToday)} completions observed today UTC</small></div>
        <div className="nl-shield"><span>◇ SHIELD</span><b>{s.stakedShare == null ? "—" : `${(s.stakedShare * 100).toFixed(1)}%`}</b><small>of SHIFT staked</small></div>
        {detail && active && <div key={`${active.id}-${active.data.update}`} className={`nl-announcement ${detail.tone}`}><span>{active.data.test ? "LABELLED TEST EVENT" : "INCOMING SIGNAL"}</span><strong>{detail.title}</strong><p>{detail.text}</p></div>}
        <div className="nl-world-foot"><span>LIGHTS = AGENTS · FLIGHTS = FINISHED WORK</span><button onClick={() => setShowLegend(!showLegend)} aria-expanded={showLegend}>HOW THE WORLD WORKS {showLegend ? "−" : "+"}</button></div>
        {showLegend && <div className="nl-legend"><b>Every signal has a source.</b><p>Job → drone. Audit → scan. Launch → rocket. Buy → surge; $2,500+ → ship docks. Burn → reactor flame. Staked share → shield radius. SHIFT price → sky glow. Crew delivery → character. New MCP client name → shuttle.</p><p>Ambient movement is illustration. A cached pulse keeps its original timestamp. Today’s jobs are observed completions; the 24h total is IMD’s pulse. No price forecast or safety guarantee.</p></div>}
      </section>
      <aside className="nl-sidebar" aria-label="Live event feed">
        <div className="nl-feed-title"><span><i /> THE SIGNAL</span><small>DETECTED / UTC</small></div>
        <div className="nl-feed" role="log" aria-live={stream ? "off" : "polite"} aria-relevant="additions">
          {recent.length ? recent.map((e) => { const c = caption(e); return <article className={`nl-event ${c.tone}`} key={e.id}><span className="nl-event-icon">{c.icon}</span><div><header><b>{c.title}</b><time dateTime={new Date(e.at).toISOString()}>{time(e.at).slice(0, 5)}</time></header><p>{e.data.test && <b>TEST · </b>}{c.text}</p></div></article>; }) : <div className="nl-quiet"><span>◌</span><b>Listening to the night.</b><p>The next real delivery, launch or power surge appears here.</p></div>}
        </div>
        <div className="nl-spotlight-card"><div className="nl-eyebrow">◎ HOLDER SPOTLIGHT <span>{state.spotlight?.queued ?? 0} IN QUEUE</span></div><h2>{spotlight ? spotlight.target : "Your work. In orbit."}</h2><p>{spotlight ? spotlight.summary : "A token. An agent. A real crew check, broadcast to everyone."}</p><span className="nl-spotlight-note">{spotlight ? "REAL RESULT · WATCHTOWER / BUILD & CHECK" : "ONE HOLDER · ONE SLOT · EVERY 3 MIN"}</span>{!stream && <a href="#spotlight">Put yours in the Spotlight ↗</a>}</div>
        <div className="nl-audio"><button onClick={() => void toggleSound()} aria-pressed={sound}>{sound ? "◖)) SOUND ON" : "◖)) ENABLE SOUND"}</button><button disabled={!sound} aria-pressed={narration} onClick={() => { setNarration(!narration); if (audio.current) audio.current.narration = !narration; }}>VOICE {narration ? "ON" : "OFF"}</button></div>
        <small className="nl-freshness">{s.pulseAt ? `Swarm read ${Math.max(0, Math.floor((now - s.pulseAt) / 60_000))}m ago` : "Swarm awaiting first read"}{s.marketAt ? ` · Price read ${Math.max(0, Math.floor((now - s.marketAt) / 60_000))}m ago` : " · Price unavailable"}</small>
      </aside>
      <footer className="nl-ticker"><div className="nl-ticker-mark">YOUR MOVE<span>↗</span></div><div><p>Join <a href="https://t.me/getnightshift">t.me/getnightshift</a> and type <b>/ask</b>, <b>/watchtower</b> or <b>/buildcheck</b>: your request appears here live</p><p>Hold <b>500k $SHIFT</b>, a <b>NIGHT FROG</b> or a <b>Night Watcher</b>: put your token or agent in the Spotlight at <b>getnightshift.tech/live</b></p></div></footer>
      {state.simulated && <div className="nl-mock">MOCK DATA · VISUAL PREVIEW</div>}
    </main>
    {!stream && <SpotlightForm queued={state.spotlight?.queued ?? 0} />}
  </div>;
}

function SpotlightForm({ queued }: { queued: number }) {
  const { address, signIn, busy: signing, error } = useSession();
  const [kind, setKind] = useState("token"), [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/live/spotlight", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ kind, target }), signal: AbortSignal.timeout(30_000) });
      const result = await r.json() as { error?: string; position?: number };
      if (!r.ok) { setMessage(result.error ?? "The entry could not be queued. Try again shortly."); return; }
      setMessage(`You're queued at position ${result.position}. Your real crew result will appear on stream.`); setTarget("");
    } catch { setMessage("The connection was interrupted. Check the queue before trying again."); }
    finally { setBusy(false); }
  };
  return <section id="spotlight" className="nl-entry"><div><span className="nl-eyebrow">◎ THE SPOTLIGHT / {queued} OF 20 SLOTS QUEUED</span><h2>Give the station<br /><em>something to look at.</em></h2><p>Hold 500,000+ $SHIFT in your wallet and staking combined, a NIGHT FROG or a Night Watcher. Queue one token or agent every 24 hours. The crew runs a real check, free, and shows its result live.</p><small>Watchtower reports changes and unavailable checks. Build & Check tests reachability, MCP and payment terms. Results are observations, not endorsements.</small></div><form onSubmit={(e) => void submit(e)}><label>WHAT ARE WE CHECKING?<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="token">Token · Watchtower check</option><option value="agent">Agent · Build & Check quick</option></select></label><label>{kind === "token" ? "ETHEREUM TOKEN ADDRESS" : "PUBLIC HTTPS AGENT ENDPOINT"}<input required maxLength={500} value={target} onChange={(e) => setTarget(e.target.value)} placeholder={kind === "token" ? "0x…" : "https://your-agent.example/mcp"} autoComplete="off" spellCheck={false} /></label><p className="nl-entry-note">By entering, you publish the target’s short address or host and the crew’s result on this stream. URLs cannot contain credentials, a query string or a fragment.</p>{address ? <button type="submit" disabled={busy || queued >= 20}>{busy ? "Checking holdings…" : queued >= 20 ? "Queue full · come back shortly" : "Queue my Spotlight ↗"}</button> : <button type="button" disabled={signing} onClick={() => void signIn()}>{signing ? "Signing in…" : "Sign in with wallet ↗"}</button>}<p role="status" className="nl-form-message">{message || error || (address ? `Signed in as ${address.slice(0, 6)}…${address.slice(-4)}` : "Sign a sign-in message. No transaction is required.")}</p></form></section>;
}
