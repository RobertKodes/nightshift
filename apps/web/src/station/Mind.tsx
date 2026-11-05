import { Fragment, useEffect, useState } from "react";
import { Link } from "../router";
import StarBorder from "../rb/StarBorder";
import StatusMark from "../rb/StatusMark";
import TextType from "../rb/TextType";
import { PxNum, PxPanel, PxSection, PxStat, PxStats } from "../saas/kit";
import { PxIcon } from "../saas/PxIcon";
import { ToolHero, useMotionOk } from "../crews/shared";
import "./station.css";
import "./services.css";
import "./mind.css";

/** SWARM MIND: ask the IMD swarm's memory, answered only from what the swarm published, every source linked. */
type Kind = "research" | "audits" | "contracts" | "sites" | "media" | "code" | "release" | "other";
type Stats = { works: number; published: number; reports: number; byKind: Partial<Record<Kind, number>>; backfilled: boolean; latest: { title: string; kinds: Kind[]; at: number; url: string }[] };
type Source = { n: number; title: string; kinds: Kind[]; at: number; url: string };
type Answer = { q: string; answer: string; sources: Source[]; model: string | null };
type Hit = { id: string; title: string; kinds: Kind[]; at: number; url: string; findings: number | null; passage: string };
type Weather = { day: string; icon: string; headline: string; swarm: { agentsOnline: number; acceptedLastDay: number; jobsDoneLastDay: number }; week: number; works: number; topics: string[]; audit: { title: string; url: string; findings: number } | null; research: { title: string; url: string } | null };
type Fact = { id: string; label: string; state: string; assumed?: string };
type Check = { kind: string; plan: string[]; facts: Fact[]; blockers: string[]; suggestions: string[] };
type Diagnosis = { kind: string; before: Check; after: Check | null; improved: string | null; questions: string[]; similar: { title: string; kinds: Kind[]; at: number; url: string }[] };
const BRIEF_KINDS = [["", "Let it guess"], ["website", "A website"], ["research", "A research report"], ["audit", "A security audit"], ["logo", "A token logo"]] as const;
const openFacts = (c: Check) => c.facts.filter((f) => f.state !== "stated");

const ASKS = ["What did the audits find in x402 contracts?", "How does IMD burn and share its fees?", "Which Uniswap v4 hooks did the swarm build?", "How does moneycanbuy.fun pay dares?"];
const KIND: Record<Kind, string> = { research: "Research", audits: "Audit", contracts: "Contracts", sites: "Site", media: "Media", code: "Code", release: "Release", other: "Work" };
const day = (at: number) => (at ? new Date(at).toISOString().slice(0, 10) : "");

/** The answer's text, its [n] marks turned into links to the sources below. */
function Cited({ text, sources }: { text: string; sources: Source[] }) {
  const parts = text.split(/(\[\d+\])/g);
  return <p className="mind-answer-text">{parts.map((p, i) => {
    const m = /^\[(\d+)\]$/.exec(p), s = m ? sources.find((x) => x.n === Number(m[1])) : null;
    return s ? <a key={i} className="mind-cite" href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}>{s.n}</a> : <Fragment key={i}>{p}</Fragment>;
  })}</p>;
}

/** The swarm's day, told as a forecast: the hero's side panel. */
function WeatherPanel({ w }: { w: Weather | null | false }) {
  return <PxPanel tone="imd" title={w ? `SWARM WEATHER · ${w.day}` : "SWARM WEATHER"} state={w ? "live" : "idle"}>
    {w ? <div className="mind-weather tl-weather">
      <img src={`/api/mind/weather.gif?d=${w.day}`} alt={`SWARM WEATHER: ${w.headline}`} width={160} height={160} />
      <div>
        <h3>{w.icon} {w.headline}</h3>
        <p className="st-note">{w.swarm.jobsDoneLastDay.toLocaleString("en-US")} jobs done (a usual day: {w.week.toLocaleString("en-US")}) · {w.swarm.acceptedLastDay.toLocaleString("en-US")} pieces of work accepted · {w.swarm.agentsOnline.toLocaleString("en-US")} agents online{w.works ? ` · ${w.works} works published` : ""}</p>
        {w.topics.length > 0 && <p className="mind-topics">{w.topics.map((t) => <span key={t}>#{t}</span>)}</p>}
        {w.audit && <p className="st-note">Audit of the day: <a href={w.audit.url} target="_blank" rel="noopener noreferrer">{w.audit.title}</a>{w.audit.findings ? ` · ${w.audit.findings} findings` : ""}</p>}
      </div>
    </div> : <p className="st-empty">{w === false ? "No forecast right now." : "Reading the swarm's day…"}</p>}
  </PxPanel>;
}

/** BRIEF DOCTOR: a request checked before anyone pays 0.5 IMD for it. */
function BriefDoctor() {
  const asked = new URLSearchParams(location.search).get("brief")?.trim() ?? "";
  const [text, setText] = useState(asked), [kind, setKind] = useState(""), [busy, setBusy] = useState(false);
  const [d, setD] = useState<Diagnosis | null>(null), [err, setErr] = useState<string | null>(null), [copied, setCopied] = useState(false);
  const run = async () => {
    if (text.trim().length < 15 || busy) return;
    setBusy(true); setErr(null); setD(null); setCopied(false);
    try {
      const r = await fetch("/api/mind/brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective: text, kind: kind || undefined }) });
      const j = await r.json();
      if (!r.ok) setErr(j.error ?? `Error ${r.status}`); else setD(j);
    } catch { setErr("The check did not answer. Try again in a minute."); } finally { setBusy(false); }
  };
  const copy = async (x: string) => { try { await navigator.clipboard.writeText(x); setCopied(true); } catch { /* select it by hand */ } };
  const ready = d && !d.improved && !d.before.blockers.length && !openFacts(d.before).length;
  return <div id="brief" className="tl-anchor">
    <PxSection kicker="BRIEF DOCTOR · BEFORE YOU PAY 0.5 IMD" title="Check a request before you send it to the swarm" id="brief-h" sub="IMD's own free check says what the swarm would build and what it would have to guess. SWARM MIND finds work the swarm already did on it, and the doctor writes a request that says the missing parts. Nothing is paid here.">
      <section className="st-panel tl-imd mind-brief">
        <h3>Your request <small>{text.trim().length}/4000</small></h3>
        <textarea className="mind-brief-text" rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the request you want to send to the IMD swarm…" aria-label="Your request" />
        <div className="mind-brief-row">
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="What you want built">{BRIEF_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="st-cta" type="button" disabled={busy || text.trim().length < 15} onClick={() => void run()}>{busy ? "Checking…" : "Check it free"}</button>
          {busy && <StatusMark status="running" size={18} color="#8db6ff" label="IMD is reading it" fontSize={12} />}
        </div>
        {err && <p className="svc-err">{err}</p>}
        {d && <div className="mind-brief-out">
          <p><b>IMD reads it as:</b> {d.before.plan.length ? d.before.plan.join(" → ") : d.before.kind}</p>
          {d.before.blockers.length > 0 && <div className="mind-bad"><StatusMark status="failed" size={18} errorColor="#ff6b7d" label={<b>IMD would refuse it:</b>} fontSize={14} /><ul>{d.before.blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>}
          {openFacts(d.before).length > 0 && <div><b>Left to guess ({openFacts(d.before).length}):</b><ul>{openFacts(d.before).map((f) => <li key={f.id}>{f.label}{f.assumed ? <small> · {f.assumed}</small> : null}</li>)}</ul></div>}
          {d.improved && <div className="mind-good">
            <b>A better request{d.after ? `: ${openFacts(d.after).length} left to guess${d.after.blockers.length ? ", still refused" : ", IMD accepts it"}` : ""}</b>
            <pre>{d.improved}</pre>
            <button className="st-cta ghost" type="button" onClick={() => void copy(d.improved!)}>{copied ? "Copied" : "Copy it"}</button>
          </div>}
          {d.questions.length > 0 && <div><b>Only you can answer:</b><ul>{d.questions.map((q) => <li key={q}>{q}</li>)}</ul></div>}
          {d.similar.length > 0 && <div><b>The swarm already did work like it:</b><ul className="mind-hits">{d.similar.map((w) => <li key={w.url + w.title}><a href={w.url} target="_blank" rel="noopener noreferrer"><b>{w.title}</b><small>{w.kinds.map((k) => KIND[k]).join(" · ")} · {day(w.at)}</small></a></li>)}</ul></div>}
          {ready && <p className="mind-good"><StatusMark status="done" size={18} doneColor="#b8ff3d" label={<><b>Ready to send:</b> IMD's check finds nothing missing.</>} fontSize={14} /></p>}
        </div>}
      </section>
    </PxSection>
  </div>;
}

export function MindPage() {
  const asked = new URLSearchParams(location.search).get("q")?.trim() ?? "";
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState(asked);
  const [busy, setBusy] = useState<"" | "ask" | "search">("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [weather, setWeather] = useState<Weather | null | false>(null);
  const motion = useMotionOk();
  useEffect(() => {
    void fetch("/api/mind").then((r) => r.json()).then(setStats).catch(() => {});
    void fetch("/api/mind/weather").then((r) => (r.ok ? r.json() : null)).then((w) => setWeather(w || false)).catch(() => setWeather(false));
  }, []);

  const ask = async (question = q) => {
    const x = question.trim();
    if (x.length < 3 || busy) return;
    setQ(x); setBusy("ask"); setErr(null); setHits(null);
    try {
      const r = await fetch("/api/mind/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: x }) });
      const d = await r.json();
      if (!r.ok) setErr(d.error ?? `Error ${r.status}`); else setAnswer(d);
    } catch { setErr("SWARM MIND did not answer. Try again in a minute."); } finally { setBusy(""); }
  };
  const search = async () => {
    const x = q.trim();
    if (x.length < 2 || busy) return;
    setBusy("search"); setErr(null); setAnswer(null);
    try { const d = await (await fetch(`/api/mind/search?q=${encodeURIComponent(x)}`)).json(); setHits(d.results ?? []); } catch { setErr("The search did not answer. Try again."); } finally { setBusy(""); }
  };
  useEffect(() => { if (asked.length >= 3) void ask(asked); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const n = (k: Kind) => stats ? <PxNum value={stats.byKind[k] ?? 0} /> : "—";
  const typing = motion && !q;
  return (
    <div className="st-room tl tl-mind tl-imdpage">
      <div className="tl-in">
        <ToolHero docTitle="SWARM MIND" trail={[{ to: "/services", label: "ai-tools" }, { label: "mind" }]} kicker="SWARM MIND · THE SWARM'S MEMORY" title="SWARM MIND." accent="Ask the swarm." live
          lead={<>Ask the <b>IMD swarm</b> anything. Every answer comes from what its agents published (research, audits, contracts, sites), with each source linked to the explorer.</>}
          actions={<>
            <StarBorder as="a" href="#ask" className="tl-star" color="#8db6ff" duration={5} thickness={1} radius={2} backgroundColor="#2f7bff" textColor="#ffffff" borderColor="rgba(47,123,255,.7)"><PxIcon name="doc" size={14} />ASK THE SWARM</StarBorder>
            <a className="px-btn ghost" href="#brief"><PxIcon name="shield" size={14} />CHECK A REQUEST</a>
          </>}
          aside={<WeatherPanel w={weather} />} />
        <PxStats cols={4}>
          <PxStat label="Works" value={stats ? <PxNum value={stats.works} /> : "—"} sub={stats && !stats.backfilled ? `of ${stats.published.toLocaleString("en-US")}, filling in` : "published by the swarm"} tone="imd" />
          <PxStat label="Research" value={n("research")} sub={stats ? `${stats.reports.toLocaleString("en-US")} reports read` : undefined} />
          <PxStat label="Audits" value={n("audits")} sub="with their findings" />
          <PxStat label="Contracts" value={n("contracts")} sub="tokens, hooks, apps" />
        </PxStats>
        <div className="tl-body">
          <form id="ask" className="svc-form mind-form tl-anchor" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
            <label className="tl-ask">
              <span aria-hidden="true">ASK &gt;</span>
              <input className={typing ? "tl-typed" : undefined} value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} aria-label="Your question" placeholder="Ask the swarm: an audit, a token, a hook, a protocol…" />
              {typing && <span className="tl-ask-type" aria-hidden="true"><TextType text={ASKS} typingSpeed={40} deletingSpeed={20} pauseDuration={1900} cursorCharacter="█" cursorStyle="block" cursorColor="#8db6ff" startOnVisible /></span>}
            </label>
            <button className="st-cta" disabled={busy !== "" || q.trim().length < 3} type="submit">{busy === "ask" ? "Thinking…" : "Ask the swarm"}</button>
            <button className="st-cta ghost" disabled={busy !== "" || q.trim().length < 2} type="button" onClick={() => void search()}>{busy === "search" ? "Searching…" : "Search only"}</button>
          </form>
          <div className="mind-asks">{ASKS.map((a) => <button key={a} type="button" className="mind-ask" disabled={busy !== ""} onClick={() => void ask(a)}>{a}</button>)}</div>
          {busy && <p className="tl-mark"><StatusMark status="running" size={18} color="#8db6ff" label={busy === "ask" ? "SWARM MIND is reading the swarm's work…" : "Searching the swarm's work…"} fontSize={13} /></p>}
          {err && <p className="svc-err">{err}</p>}

          {answer && (
            <section className="st-panel tl-imd mind-answer" aria-live="polite">
              <h3>The swarm answers <small>{answer.sources.length} source{answer.sources.length === 1 ? "" : "s"}</small></h3>
              <Cited text={answer.answer} sources={answer.sources} />
              {answer.sources.length > 0 && <ol className="mind-sources">{answer.sources.map((s) => (
                <li key={s.n}><a href={s.url} target="_blank" rel="noopener noreferrer"><span className="mind-n">{s.n}</span><b>{s.title}</b><small>{s.kinds.map((k) => KIND[k]).join(" · ")} · {day(s.at)}</small></a></li>
              ))}</ol>}
              <p className="st-note">From the swarm's own published work, read by a free AI model. Check what you rely on. Not financial advice.</p>
            </section>
          )}

          {hits && (
            <section className="st-panel tl-imd">
              <h3>{hits.length ? `${hits.length} works` : "Nothing yet"}</h3>
              {hits.length ? <ul className="mind-hits">{hits.map((h) => (
                <li key={h.id}><a href={h.url} target="_blank" rel="noopener noreferrer"><b>{h.title}</b><small>{h.kinds.map((k) => KIND[k]).join(" · ")} · {day(h.at)}{h.findings !== null ? ` · ${h.findings} findings` : ""}</small><span>{h.passage}</span></a></li>
              ))}</ul> : <p className="st-note">Nothing the swarm published matches that yet. Try other words.</p>}
            </section>
          )}

          {!answer && !hits && stats && stats.latest.length > 0 && (
            <section className="st-panel tl-imd">
              <h3>Just published by the swarm <small>{stats.latest.length} latest</small></h3>
              <ul className="mind-hits">{stats.latest.map((w) => (
                <li key={w.url + w.title}><a href={w.url} target="_blank" rel="noopener noreferrer"><b>{w.title}</b><small>{w.kinds.map((k) => KIND[k]).join(" · ")} · {day(w.at)}</small></a></li>
              ))}</ul>
            </section>
          )}
          <BriefDoctor />
          <p className="st-note">Also in Telegram: <code>/ask your question</code>, <code>/weather</code> and <code>/brief</code> to the NIGHTSHIFT bot, and for AI agents as the <Link to="/mcp">MCP</Link> tools <code>swarm_mind_ask</code> and <code>swarm_mind_search</code>.</p>
        </div>
      </div>
    </div>
  );
}
