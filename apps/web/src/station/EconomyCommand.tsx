import { useCallback, useEffect, useState } from "react";
import DotGrid from "../rb/DotGrid";
import SpotlightCard from "../rb/SpotlightCard";
import StarBorder from "../rb/StarBorder";
import { Link } from "../router";
import { PxHero, PxNum, PxPanel, PxSection, PxStat, PxStats, PxTag } from "../saas/kit";
import { PxIcon } from "../saas/PxIcon";
import "../saas/pages/command3.css";
import { useSession } from "../session";
import { RuleBar } from "../TokenomicsPage";
import { RoomHero, Stat, Tiles, rememberRoom } from "./Station";

const get = <T,>(u: string): Promise<T | null> => fetch(u, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const big = (n: number | undefined | null) => n == null ? "…" : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString("en-US");

// ------------------------------------------------------------------ HR & Economy
type Crew = {
  at: number; checkedAt: number; ok: boolean; error: string | null; orders: number; paidImd: number; seats: number; acceptedSteps: number; source: string;
  jobs: { id: string; action: string; title: string; state: string; by: string; imd: number; workers: number; seats: number[]; accepted: number; explorer: string }[];
  crew: { seat: number; agentId: string; roles: string[]; models: string[]; runtimes: string[]; accepted: number; attempts: number; jobs: number; hours: number }[];
  models: { model: string; steps: number }[];
};
type Pulse = { at?: number; ok?: boolean; agentsOnline?: number; seatsEnrolled?: number; acceptedLastDay?: number; jobsDoneLastDay?: number; jobs?: number; launchesLive?: number; inferenceTokens?: number };
/** A read that gives up after 10 s: the page then says what failed instead of waiting forever. null: NIGHTSHIFT's server did not answer. */
const read = <T,>(u: string): Promise<T | null> => fetch(u, { credentials: "same-origin", signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json().then((v) => v ?? {}) : null)).catch(() => null);
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const seatList = (s: number[]) => (s.length ? ` · ${s.slice(0, 6).map((x) => `#${x}`).join(", ")}${s.length > 6 ? ` +${s.length - 6}` : ""}` : "");
export function EconomyPage() {
  // undefined: still asking; null: NIGHTSHIFT's server did not answer
  const [crew, setCrew] = useState<Crew | null | undefined>(undefined);
  const [pulse, setPulse] = useState<Pulse | null | undefined>(undefined);
  const [all, setAll] = useState(false);
  const [allJobs, setAllJobs] = useState(false);
  useEffect(() => {
    const go = () => { void read<Crew>("/api/crew").then((c) => setCrew(c && Array.isArray(c.jobs) ? c : null)); void read<Pulse>("/api/swarm/pulse").then(setPulse); };
    go();
    const t = setInterval(go, 60_000);
    return () => clearInterval(t);
  }, []);
  const rows = crew?.crew ?? [];
  const jobs = crew?.jobs ?? [];
  const known = crew != null && crew.at > 0;
  // pulse null: our server did not answer; an empty answer or ok: false: IMD did not
  const swarmDown = pulse != null && (pulse.ok === false || pulse.agentsOnline == null);
  const swarm = (n: number | undefined) => (pulse === undefined ? "…" : n == null ? "—" : big(n));
  return (
    <div className="st-room">
      <RoomHero id="economy">
        <div className="st-stats">
          <Stat label="IMD agents online" value={swarm(pulse?.agentsOnline)} note={pulse === null ? "not read right now" : swarmDown ? "IMD's API is not answering" : "the whole swarm, live"} />
          <Stat label="Agents who worked for us" value={crew === undefined ? "…" : known ? crew!.seats : "—"} note={known ? `${crew!.acceptedSteps} steps accepted` : crew === undefined ? "from IMD's records" : crew === null ? "not read right now" : "not read yet"} />
          <Stat label="Orders we paid" value={crew === undefined ? "…" : known ? crew!.orders : "—"} note={known ? `${crew!.paidImd} IMD paid to the swarm` : crew === undefined ? undefined : crew === null ? "not read right now" : "not read yet"} />
        </div>
      </RoomHero>
      <div className="st-body">
        <h2>HR · the crew</h2>
        <p className="st-note">Every IMD swarm agent that worked on an order NIGHTSHIFT paid for, from IMD's public submissions: the seat, what it did, which model and runtime it ran, and how much of its work was accepted. {known && <>Read {ago(crew!.at)} from {crew!.source}.</>}</p>
        {crew === undefined ? <p className="st-empty">Reading IMD's records…</p>
          : crew === null ? <p className="st-warn">NIGHTSHIFT's server did not answer just now, so the crew list cannot be shown. The page asks again every minute; nothing here is ever estimated.</p>
          : !known ? <p className="st-warn">IMD's API is not answering, and NIGHTSHIFT has no earlier copy of its records yet, so the crew list is empty for now. It fills in by itself once IMD answers (last asked {ago(crew.checkedAt)}). Every order is also on <a href="https://explorer.imd.fun" target="_blank" rel="noreferrer">explorer.imd.fun</a>.</p>
          : (
          <>
            {!crew.ok && <p className="st-warn">IMD's API is not answering; last known: {crew.orders} orders paid, {crew.paidImd} IMD, {crew.seats} agents, read {ago(crew.at)}. NIGHTSHIFT asks again every few minutes.</p>}
            <div className="st-table-wrap">
              <table className="st-table">
                <thead><tr><th>Seat</th><th>Roles</th><th>Model</th><th>Runtime</th><th>Accepted</th><th>Jobs</th><th>Hours</th></tr></thead>
                <tbody>{(all ? rows : rows.slice(0, 12)).map((m) => (
                  <tr key={m.seat}><td><a href={`https://explorer.imd.fun/agents/${m.agentId}`} target="_blank" rel="noreferrer">#{m.seat}</a></td><td>{m.roles.join(", ")}</td><td className="mono">{m.models.join(", ") || "—"}</td><td>{m.runtimes.join(", ") || "—"}</td><td>{m.accepted}/{m.attempts}</td><td>{m.jobs}</td><td>{m.hours}</td></tr>
                ))}</tbody>
              </table>
            </div>
            {rows.length > 12 && <button className="st-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>}
            <h2>Work orders</h2>
            <p className="st-note">{crew.orders} orders paid, {crew.paidImd} IMD in all (0.5 IMD each), each linked to its job on IMD's explorer with the seats that worked on it.</p>
            <div className="st-orders">{(allJobs ? jobs : jobs.slice(0, 12)).map((o) => (
              <a key={o.id} href={o.explorer} target="_blank" rel="noreferrer"><span className={`st-state ${o.state.replace(/\s+/g, "-")}`}>{o.state}</span><b>{o.title}</b><small>{o.by === "NIGHTSHIFT" ? "" : `${o.by} · `}{o.action} · {o.imd} IMD · {o.workers} agent{o.workers === 1 ? "" : "s"}{seatList(o.seats)} · {o.accepted} steps accepted</small></a>
            ))}</div>
            {jobs.length > 12 && <button className="st-more" onClick={() => setAllJobs(!allJobs)}>{allJobs ? "Show fewer" : `Show all ${jobs.length}`}</button>}
          </>
        )}

        <h2>Economy · where the money goes</h2>
        <p className="st-note">Every NIGHTSHIFT fee follows one rule, in code (FeeSplitter on Ethereum):</p>
        <RuleBar />
        {pulse === null ? <p className="st-warn">NIGHTSHIFT's server did not answer just now, so the swarm totals are not shown. The page asks again every minute.</p> : swarmDown && <p className="st-warn">IMD's API is not answering{pulse?.at ? `; these swarm totals are the last known, read ${ago(pulse.at)}` : ", so the swarm totals cannot be shown right now"}.</p>}
        <div className="st-stats wide">
          <Stat label="Swarm jobs, all time" value={swarm(pulse?.jobs)} note="api.imd.fun/swarm" />
          <Stat label="Steps accepted, 24h" value={swarm(pulse?.acceptedLastDay)} />
          <Stat label="Live IMD launches" value={swarm(pulse?.launchesLive)} />
          <Stat label="Inference tokens" value={swarm(pulse?.inferenceTokens)} note="AI work done by the swarm" />
        </div>
        <Tiles items={[
          { to: "/impact", title: "IMD impact", note: "What NIGHTSHIFT has paid the IMD network and burned, line by line.", icon: "flame" },
          { to: "/tokenomics", title: "Tokenomics", note: "Fees, wallets and powers, with the risks.", icon: "chart" },
          { to: "/companies", title: "Company P&L", note: "Each AI company's revenue, spend and withdrawals.", icon: "briefcase" },
          { to: "/stake", title: "Staking rewards", note: "What stakers have earned from the fees.", icon: "coins" },
        ]} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Command Room
type Mission = { id: string; title: string; brief: string; station: string; link: string; hours: number; frog: number | null; bonus: number | null; state: "open" | "underway" | "ready" | "done"; progress: string; earned: number };
type Board = { week: { startedAt: number; endsAt: number }; hoursEarned: number; frogs: { id: number; multiplier: number; on: string | null; crew?: boolean }[]; missions: Mission[]; frogsOn: boolean };
/** NIGHT FROGS keep their number; a Night Watcher is kept as 1000 + its number (The Captain, token 0, as 1000). */
const crewName = (id: number) => (id === 1000 ? "The Captain" : id > 1000 ? `Night Watcher #${id - 1000}` : `Frog #${id}`);
type Staking = { board: { wallet: string; hours: number; frogs: number }[]; me: { hours: number; rank: number | null; perHour: number; imdSeat: boolean } | null };
const MISSION_PREVIEW = [
  ["Desk duty", "Your agent makes 3 trades in this week's Night League.", 24],
  ["Beat the holder", "Your best agent is ahead of the IMD Holder benchmark.", 48],
  ["Board watch", "One of your agents plays a rated NIGHT CHESS game.", 24],
] as const;
/** NIGHT FROG art on this site, by token number: a crewed frog shows its own face, the rest a decorative one. */
const FROG_ART = [77, 187, 224, 131, 112, 83, 500, 2, 1, 78, 79, 80, 81, 82, 84, 113];
const frogArt = (i: number, frog?: number | null) => `/frogs/frog-${String(frog != null && FROG_ART.includes(frog) ? frog : FROG_ART[i % FROG_ART.length]).padStart(3, "0")}.webp`;
const STATE_TAG: Record<Mission["state"], ["lime" | "gold" | "dim" | undefined, string]> = { open: [undefined, "OPEN"], underway: ["gold", "UNDERWAY"], ready: ["lime", "READY TO REPORT"], done: ["dim", "DONE"] };
const LINKS = [
  { to: "/frogs", title: "Frogs", note: "Mint in IMD, see the crew and the perks.", icon: "grid" },
  { to: "/forge", title: "Upgrade Frogs", note: "Burn 10 frogs, forge 1 Night Watcher.", icon: "bolt" },
  { to: "/league", title: "Night League", note: "Missions: Desk duty, Beat the holder.", icon: "pulse" },
  { to: "/arena", title: "Agent Arena", note: "Mission: Board watch.", icon: "play" },
];
/** Heavy effects are decoration: wide screens only, never with reduced motion or the lite mode. */
function useRich(): boolean {
  const [rich, setRich] = useState(false);
  useEffect(() => {
    const wide = matchMedia("(min-width: 900px)");
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setRich(wide.matches && !still.matches && !document.documentElement.hasAttribute("data-lite"));
    sync();
    wide.addEventListener("change", sync);
    still.addEventListener("change", sync);
    return () => { wide.removeEventListener("change", sync); still.removeEventListener("change", sync); };
  }, []);
  return rich;
}
/** One mission as a card: the frog on it, what it asks, where it stands, and its one control. */
function MissionCard({ i, frog, title, brief, line, state, children }: { i: number; frog?: number | null; title: string; brief: string; line: string; state?: Mission["state"]; children?: React.ReactNode }) {
  const tag = state ? STATE_TAG[state] : null;
  return (
    <SpotlightCard className={`cm3-mission${state ? ` ${state}` : ""}`} spotlightColor="rgba(184, 255, 61, 0.16)" spotlightSize={260} borderGlow={0.4} theme="dark">
      <div className="cm3-mission-h">
        <img className="cm3-frog" src={frogArt(i, frog)} alt="" aria-hidden="true" width={44} height={44} loading="lazy" />
        <span className="cm3-mission-n">MISSION 0{i + 1}</span>
        {tag ? <PxTag tone={tag[0]}>{tag[1]}</PxTag> : <PxTag tone="dim">PREVIEW</PxTag>}
      </div>
      <b>{title}</b>
      <p>{brief}</p>
      <span className="cm3-line">{line}</span>
      {children}
    </SpotlightCard>
  );
}
export function CommandPage() {
  const { address, signIn, busy } = useSession();
  const [b, setB] = useState<Board | null>(null);
  const [st, setSt] = useState<Staking | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, number>>({});
  const rich = useRich();
  useEffect(() => rememberRoom("command"), []);
  const load = useCallback(() => {
    void get<Staking>(`/api/frogs/staking${address ? `?wallet=${address}` : ""}`).then(setSt);
    if (address) void get<Board>("/api/missions").then(setB); else setB(null);
  }, [address]);
  useEffect(load, [load]);
  const act = async (path: string, body: object) => {
    setMsg(null);
    const r = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(d.error ?? "That did not work."); return; }
    if (d.hours) setMsg(`Mission complete: +${d.hours} shift hours.`);
    setB(d as Board); load();
  };
  // a Night Watcher crews every mission at once
  const free = b?.frogs.filter((f) => !f.on || f.crew) ?? [];
  const signInButton = (
    <StarBorder className="cm3-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)" onClick={() => void signIn()} disabled={busy}>
      <PxIcon name="wallet" size={14} />{busy ? "CHECK YOUR WALLET…" : "SIGN IN TO CREW MISSIONS"}
    </StarBorder>
  );
  return (
    <div className="cm3">
      <PxHero
        kicker="DECK 05 · MISSIONS"
        title="Frog"
        accent="missions."
        lead={<>Send your <b>NIGHT FROGS</b> on missions. Real work done on the station earns them bonus shift hours.</>}
        bg={rich ? <DotGrid dotSize={3} gap={20} baseColor="#14241a" activeColor="#b8ff3d" proximity={110} shockRadius={160} shockStrength={3} shape="square" glow={0.3} intro={false} /> : undefined}
        actions={<>
          {!address && signInButton}
          <Link to="/frogs" className="px-btn"><PxIcon name="grid" size={14} />THE FROGS</Link>
          <Link to="/forge" className="px-btn ghost"><PxIcon name="bolt" size={14} />UPGRADE FROGS</Link>
        </>}
        aside={
          <aside className="px-term cm3-term" aria-label="How missions pay">
            <div className="px-term-h">
              <span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span>
              <b>MISSION RULES</b>
              <span className="px-term-state"><i />WEEKLY</span>
            </div>
            <div className="cm3-rules">
              <img className="cm3-rules-frog" src="/brand/pepe-operator.svg" alt="" aria-hidden="true" width={44} height={44} />
              <div><span>FROG #1</span><b>50×</b></div>
              <div><span>FROGS #2–25</span><b>3×</b></div>
              <div><span>GENESIS</span><b>2×</b></div>
              <div><span>THE REST</span><b>1×</b></div>
              <div><span>NIGHT WATCHER</span><b>10–40×</b><small>crews all three at once</small></div>
              <div><span>RESET</span><b>MON 00:00</b><small>UTC, every week</small></div>
            </div>
            <div className="px-term-f"><span>root@nightshift:~$</span><span>missions --crew</span><span className="px-term-cursor" aria-hidden="true" /></div>
          </aside>
        }
      />

      <div className="cm3-stats">
        <PxStats cols={3}>
          <PxStat label="Your shift hours" tone="lime" value={st?.me ? <PxNum value={st.me.hours} decimals={Number.isInteger(st.me.hours) ? 0 : 2} /> : address ? "0" : "—"} sub={st?.me ? `${st.me.perHour}/h from frogs${st.me.imdSeat ? " · IMD seat 2×" : ""}` : "sign in to see yours"} />
          <PxStat label="Mission hours this week" value={b ? <PxNum value={b.hoursEarned} decimals={Number.isInteger(b.hoursEarned) ? 0 : 2} /> : "—"} />
          <PxStat label="Your rank" tone="gold" value={st?.me?.rank ? `#${st.me.rank}` : "—"} />
        </PxStats>
      </div>

      <PxSection kicker="THIS WEEK" title="This week's missions" id="cm3-missions">
        <p className="cm3-note">Each frog crews one mission a week. A mission is real work on the station that the server checks for itself; bring it home and the frog earns its base hours times its multiplier (50× for #1, 3× for #2–25, 2× Genesis, 1× the rest). A Night Watcher from <Link to="/forge">Upgrade Frogs</Link> crews all three at once, at 10× to 40×. Earned hours are reward weights from holding Frogs: your total is cumulative and never resets, missions reset every Monday at 00:00 UTC, and a funded Frog reward epoch uses hours added since the last paid epoch. Claims open only after the team posts the root.</p>
        {msg && <p className="cm3-msg" role="status">{msg}</p>}
        {!address ? (
          <>
            <div className="cm3-missions">{MISSION_PREVIEW.map(([t, d, h], i) => <MissionCard key={t} i={i} title={t} brief={d} line={`${h} h × frog`} />)}</div>
            <div className="cm3-signin"><span>root@nightshift:~$ missions --crew</span><button type="button" className="px-btn primary" onClick={() => void signIn()} disabled={busy}><PxIcon name="wallet" size={14} />{busy ? "Check your wallet…" : "Sign in to crew missions"}</button></div>
          </>
        ) : !b ? <p className="cm3-empty">Reading your frogs…</p> : b.frogs.length === 0 ? (
          <>
            <p className="cm3-empty">No Frogs in this wallet yet (holdings are read every hour). <Link to="/frogs">Frogs</Link> to send it out.</p>
            <div className="cm3-missions">{b.missions.map((m, i) => <MissionCard key={m.id} i={i} title={m.title} brief={m.brief} line={`${m.hours} h × frog · ${m.progress}`} state={m.state} />)}</div>
          </>
        ) : (
          <div className="cm3-missions">{b.missions.map((m, i) => (
            <MissionCard key={m.id} i={i} frog={m.frog} title={m.title} brief={m.brief} state={m.state}
              line={m.state === "done" ? `Done: +${m.earned} h` : m.frog ? `${crewName(m.frog)} · ${m.progress} · pays ${m.bonus} h` : `${m.hours} h × frog`}>
              {m.state === "open" && (free.length ? (
                <div className="cm3-go">
                  <select className="field" aria-label={`Frog for ${m.title}`} value={pick[m.id] ?? free[0]!.id} onChange={(e) => setPick({ ...pick, [m.id]: Number(e.target.value) })}>{free.map((f) => <option key={f.id} value={f.id}>{crewName(f.id)} · {f.multiplier}×</option>)}</select>
                  <button type="button" className="px-btn primary" onClick={() => void act("/api/missions/start", { mission: m.id, frog: pick[m.id] ?? free[0]!.id })}>Send</button>
                </div>
              ) : <small className="cm3-small">Every frog is out this week.</small>)}
              {m.state === "underway" && <Link to={m.link} className="px-btn ghost cm3-goto">Go do it →</Link>}
              {m.state === "ready" && <button type="button" className="px-btn primary" onClick={() => void act("/api/missions/report", { mission: m.id })}>Report back</button>}
            </MissionCard>
          ))}</div>
        )}
      </PxSection>

      <PxSection kicker="LEADERBOARD" title="The crew board" id="cm3-board">
        <PxPanel title="Shift hours · top 10" state={st?.board.length ? "live" : "idle"} className="cm3-board">
          {st?.board.length ? (
            <ol className="cm3-rank">{st.board.slice(0, 10).map((w, i) => (
              <li key={w.wallet}><span className="cm3-rank-n">{String(i + 1).padStart(2, "0")}</span><b className="mono">{w.wallet.slice(0, 6)}…{w.wallet.slice(-4)}</b><span>{w.frogs} frog{w.frogs === 1 ? "" : "s"}</span><i>{w.hours.toLocaleString("en-US")} h</i></li>
            ))}</ol>
          ) : <p className="cm3-empty">No shift hours yet.</p>}
        </PxPanel>
      </PxSection>

      <section className="px-sec cm3-links-sec" aria-label="Where missions happen">
        <div className="cm3-links">
          {LINKS.map((t) => <Link key={t.to} to={t.to}><PxIcon name={t.icon} size={15} /><b>{t.title}</b><span>{t.note}</span><i aria-hidden="true">→</i></Link>)}
        </div>
      </section>
    </div>
  );
}
