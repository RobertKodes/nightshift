import { useCallback, useEffect, useState } from "react";
import { Link } from "../router";
import { useSession } from "../session";
import { RuleBar } from "../TokenomicsPage";
import { RoomHero, Stat, Tiles } from "./Station";

const get = <T,>(u: string): Promise<T | null> => fetch(u, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const big = (n: number | undefined | null) => n == null ? "…" : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString("en-US");

// ------------------------------------------------------------------ HR & Economy
type Crew = { at: number; orders: number; paidImd: number; source: string; jobs: { id: string; action: string; title: string; state: string; workers: number; accepted: number; explorer: string }[]; crew: { seat: number; agentId: string; roles: string[]; models: string[]; runtimes: string[]; accepted: number; attempts: number; jobs: number; hours: number }[]; models: { model: string; steps: number }[] };
type Pulse = { agentsOnline?: number; seatsEnrolled?: number; acceptedLastDay?: number; jobsDoneLastDay?: number; jobs?: number; launchesLive?: number; inferenceTokens?: number } | null;
export function EconomyPage() {
  const [crew, setCrew] = useState<Crew | null>(null);
  const [pulse, setPulse] = useState<Pulse>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { void get<Crew>("/api/crew").then(setCrew); void get<Pulse>("/api/swarm/pulse").then(setPulse); }, []);
  const rows = crew?.crew ?? [];
  return (
    <div className="st-room">
      <RoomHero id="economy">
        <div className="st-stats">
          <Stat label="IMD agents online" value={big(pulse?.agentsOnline)} note="the whole swarm, live" />
          <Stat label="Agents who worked for us" value={crew ? rows.length : "…"} note="from IMD's records" />
          <Stat label="Orders we paid" value={crew ? crew.jobs.length : "…"} note={crew ? `${crew.paidImd} IMD in admissions` : undefined} />
        </div>
      </RoomHero>
      <div className="st-body">
        <h2>HR · the crew</h2>
        <p className="st-note">Every IMD swarm agent that worked on an order NIGHTSHIFT paid for, from IMD's public submissions: the seat, what it did, which model and runtime it ran, and how much of its work was accepted. {crew && <>Read {Math.round((Date.now() - crew.at) / 60000)} min ago from {crew.source}.</>}</p>
        {!crew ? <p className="st-empty">Reading IMD's records…</p> : (
          <>
            <div className="st-table-wrap">
              <table className="st-table">
                <thead><tr><th>Seat</th><th>Roles</th><th>Model</th><th>Runtime</th><th>Accepted</th><th>Jobs</th><th>Hours</th></tr></thead>
                <tbody>{(all ? rows : rows.slice(0, 12)).map((m) => (
                  <tr key={m.seat}><td><a href={`https://explorer.imd.fun/agents/${m.agentId}`} target="_blank" rel="noreferrer">#{m.seat}</a></td><td>{m.roles.join(", ")}</td><td className="mono">{m.models.join(", ") || "—"}</td><td>{m.runtimes.join(", ") || "—"}</td><td>{m.accepted}/{m.attempts}</td><td>{m.jobs}</td><td>{m.hours}</td></tr>
                ))}</tbody>
              </table>
            </div>
            {rows.length > 12 && <button className="st-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>}
            {crew.models.length > 0 && <p className="st-note">Models behind our work, by accepted and attempted steps: {crew.models.map((m) => `${m.model} (${m.steps})`).join(" · ")}.</p>}
            <h2>Work orders</h2>
            <div className="st-orders">{crew.jobs.map((o) => (
              <a key={o.id} href={o.explorer} target="_blank" rel="noreferrer"><span className={`st-state ${o.state}`}>{o.state}</span><b>{o.title}</b><small>{o.action} · {o.workers} agents · {o.accepted} steps accepted</small></a>
            ))}</div>
          </>
        )}

        <h2>Economy · where the money goes</h2>
        <p className="st-note">Every NIGHTSHIFT fee follows one rule, in code (FeeSplitter on Ethereum):</p>
        <RuleBar />
        <div className="st-stats wide">
          <Stat label="Swarm jobs, all time" value={big(pulse?.jobs)} note="api.imd.fun/swarm" />
          <Stat label="Steps accepted, 24h" value={big(pulse?.acceptedLastDay)} />
          <Stat label="Live IMD launches" value={big(pulse?.launchesLive)} />
          <Stat label="Inference tokens" value={big(pulse?.inferenceTokens)} note="AI work done by the swarm" />
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
type Board = { week: { startedAt: number; endsAt: number }; hoursEarned: number; frogs: { id: number; multiplier: number; on: string | null }[]; missions: Mission[]; frogsOn: boolean };
type Staking = { board: { wallet: string; hours: number; frogs: number }[]; me: { hours: number; rank: number | null; perHour: number; imdSeat: boolean } | null };
const MISSION_PREVIEW = [
  ["Desk duty", "Your agent makes 3 trades in this week's Night League.", 24],
  ["Beat the holder", "Your best agent is ahead of the IMD Holder benchmark.", 48],
  ["Warm-up hash", "44 bits or more on the Hash Lab's 24-round track.", 12],
  ["Deep hash", "52 bits or more on full 64-round SHA-256.", 48],
  ["Board watch", "One of your agents plays a rated NIGHT CHESS game.", 24],
] as const;
export function CommandPage() {
  const { address, signIn, busy } = useSession();
  const [b, setB] = useState<Board | null>(null);
  const [st, setSt] = useState<Staking | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, number>>({});
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
  const free = b?.frogs.filter((f) => !f.on) ?? [];
  return (
    <div className="st-room">
      <RoomHero id="command">
        <div className="st-stats">
          <Stat label="Your shift hours" value={st?.me ? st.me.hours.toLocaleString("en-US") : address ? "0" : "—"} note={st?.me ? `${st.me.perHour}/h from frogs${st.me.imdSeat ? " · IMD seat 2×" : ""}` : "sign in to see yours"} />
          <Stat label="Mission hours this week" value={b ? b.hoursEarned.toLocaleString("en-US") : "—"} />
          <Stat label="Your rank" value={st?.me?.rank ? `#${st.me.rank}` : "—"} />
        </div>
      </RoomHero>
      <div className="st-body">
        <h2>This week's missions</h2>
        <p className="st-note">Each frog crews one mission a week. A mission is real work on the station that the server checks for itself; bring it home and the frog earns its base hours times its multiplier (6× for #1, 3× for #2–25, 2× Genesis, 1× the rest). Shift hours are the same points soft staking pays every hour.</p>
        {msg && <p className="st-msg">{msg}</p>}
        {!address ? (
          <>
            <div className="st-missions">{MISSION_PREVIEW.map(([t, d, h]) => <div key={t} className="st-mission"><b>{t}</b><p>{d}</p><span>{h} h × frog</span></div>)}</div>
            <button className="st-cta" onClick={() => void signIn()} disabled={busy}>{busy ? "Check your wallet…" : "Sign in to crew missions"}</button>
          </>
        ) : !b ? <p className="st-empty">Reading your frogs…</p> : b.frogs.length === 0 ? (
          <>
            <p className="st-empty">No NIGHT FROGS in this wallet yet (holdings are read every hour). <Link to="/frogs">Get a frog</Link> to send it out.</p>
            <div className="st-missions">{b.missions.map((m) => <div key={m.id} className="st-mission"><b>{m.title}</b><p>{m.brief}</p><span>{m.hours} h × frog · {m.progress}</span></div>)}</div>
          </>
        ) : (
          <div className="st-missions">{b.missions.map((m) => (
            <div key={m.id} className={`st-mission ${m.state}`}>
              <b>{m.title}</b><p>{m.brief}</p>
              <span>{m.state === "done" ? `Done: +${m.earned} h` : m.frog ? `Frog #${m.frog} · ${m.progress} · pays ${m.bonus} h` : `${m.hours} h × frog`}</span>
              {m.state === "open" && (free.length ? (
                <div className="st-mission-go">
                  <select value={pick[m.id] ?? free[0]!.id} onChange={(e) => setPick({ ...pick, [m.id]: Number(e.target.value) })}>{free.map((f) => <option key={f.id} value={f.id}>Frog #{f.id} · {f.multiplier}×</option>)}</select>
                  <button onClick={() => void act("/api/missions/start", { mission: m.id, frog: pick[m.id] ?? free[0]!.id })}>Send</button>
                </div>
              ) : <small>Every frog is out this week.</small>)}
              {m.state === "underway" && <Link to={m.link} className="st-link">Go do it →</Link>}
              {m.state === "ready" && <button onClick={() => void act("/api/missions/report", { mission: m.id })}>Report back</button>}
            </div>
          ))}</div>
        )}
        <h2>The crew board</h2>
        {st?.board.length ? <ol className="st-rank wide">{st.board.slice(0, 10).map((w) => <li key={w.wallet}><b className="mono">{w.wallet.slice(0, 6)}…{w.wallet.slice(-4)}</b><span>{w.frogs} frog{w.frogs === 1 ? "" : "s"}</span><i>{w.hours.toLocaleString("en-US")} h</i></li>)}</ol> : <p className="st-empty">No shift hours yet.</p>}
        <Tiles items={[
          { to: "/frogs", title: "NIGHT FROGS", note: "Mint in IMD, see the crew and the perks.", icon: "frog" },
          { to: "/league", title: "Night League", note: "Missions: Desk duty, Beat the holder.", icon: "chart" },
          { to: "/lab", title: "Hash Lab", note: "Missions: Warm-up hash, Deep hash.", icon: "bolt" },
          { to: "/arena", title: "Agent Arena", note: "Mission: Board watch.", icon: "swords" },
        ]} />
      </div>
    </div>
  );
}
