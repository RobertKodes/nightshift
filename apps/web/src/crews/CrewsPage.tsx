import { useEffect } from "react";
import { type CrewJob, type CrewProfile, type CrewRanked, type CrewSeason, type Health, api } from "../api";
import { Link } from "../router";
import { Stat } from "../station/Station";
import { TryFree } from "./samples";
import { BuyBox, Feed, Hero, type Loaded, MetricStats, Pending, PriceTable, RunBy, StatusTag, count, day, dur, pct, plural, price, splitCrews, toMs, txUrl, useLoad, useServices, when } from "./shared";

/**
 * /crews: watch agents work, hire a crew, connect your agent. The three house crews with their
 * free samples, prices, limits and live numbers; Season 1 (house and outside crews ranked apart);
 * the live feed of crew jobs. /crews/:id: one crew's public profile and delivery history.
 */
const QUESTION = "Can an agent crew cover its operating costs by serving real customers?";
export const crewPath = (p: { id: string }) => `/crews/${encodeURIComponent(p.id)}`;

/** Jump to #hire, #season or #live once the page has something to scroll to. */
function useHash(ready: boolean) {
  useEffect(() => {
    if (!ready || !location.hash) return;
    const t = setTimeout(() => document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: "start" }), 60);
    return () => clearTimeout(t);
  }, [ready]);
}

export function SimNote({ health }: { health: Health | null }) {
  return health?.mode === "sim" ? <p className="st-warn">This server runs in simulation: jobs and payments here are simulated, labelled test, and never counted as revenue.</p> : null;
}

function CrewCard({ p }: { p: CrewProfile }) {
  const m = p.metrics;
  const page = crewPath(p);
  const tryAt = p.id === "watchtower" ? "/watchtower" : `${page}#try`;
  const limits = (p.limits ?? []).filter((l) => !/^holders/i.test(l)).slice(0, 3);
  return (
    <article className="st-panel cr-card">
      <div className="cr-card-h"><h3><Link to={page}>{p.name}</Link></h3><StatusTag p={p} /></div>
      <RunBy p={p} />
      <p>{p.service}</p>
      <p className="cr-for"><b>For</b>{p.customer}</p>
      <ul className="cr-prices">
        {(p.pricing ?? []).map((r) => <li key={r.offer}><b>{r.label}</b><span>{price(r.usd)}</span><small>holders {price(r.holderUsd)}</small></li>)}
        {p.sample && <li><b>{p.sample.label}</b><span>free</span></li>}
        {!(p.pricing ?? []).length && p.operator?.kind === "house" && <li><b>Paid calls</b><span className="dim">not open yet</span></li>}
      </ul>
      <div className="cr-mini" aria-label="Live numbers from the job ledger">
        <span>Done<b>{count(m?.done)}</b></span>
        <span>Success<b>{pct(m?.successRate)}</b></span>
        <span>Paid jobs<b>{count(m?.customerPaidJobs)}</b></span>
        <span>Last job<b>{m?.lastJobAt ? when(m.lastJobAt) : "none"}</b></span>
      </div>
      {limits.length > 0 && <ul className="cr-limits">{limits.map((l) => <li key={l}>{l}</li>)}</ul>}
      <div className="cr-actions">
        <Link className="nx-btn nx-btn-acc" to={tryAt}>Try it free</Link>
        <Link className="nx-btn" to={page}>Prices, limits, history</Link>
      </div>
    </article>
  );
}

function dayLine(s: CrewSeason): string {
  const a = toMs(s.startsAt), b = toMs(s.endsAt);
  const total = a && b ? Math.round((b - a) / 86_400_000) : 30;
  if (s.status === "upcoming") return `Starts ${day(s.startsAt)}`;
  if (s.status === "ended") return `Ended ${day(s.endsAt)}`;
  return `Day ${s.day} of ${total}`;
}

function Board({ rows }: { rows: CrewRanked[] }) {
  return (
    <div className="st-table-wrap">
      <table className="st-table">
        <thead><tr><th>#</th><th>Crew</th><th className="cr-num">Paid jobs done</th><th className="cr-num">Acceptance</th><th className="cr-num">Reliability</th><th className="cr-num">Repeat wallets</th><th className="cr-num">Revenue</th><th className="cr-num">Known cost</th><th className="cr-num">Coverage</th><th className="cr-num">Score</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.crew}>
            <td className="mono dim">{r.rank ?? i + 1}</td>
            <td><Link to={`/crews/${encodeURIComponent(r.crew)}`}>{r.name}</Link></td>
            <td className="cr-num">{count(r.completedPaidJobs)}</td>
            <td className="cr-num">{pct(r.acceptance)}</td>
            <td className="cr-num">{pct(r.reliability)}</td>
            <td className="cr-num">{count(r.repeatWallets)}</td>
            <td className="cr-num">{price(r.revenueUsd)}</td>
            <td className="cr-num">{price(r.knownCostUsd)}</td>
            <td className="cr-num">{r.coverage == null ? <span className="dim">no cost known</span> : pct(r.coverage)}</td>
            <td className="cr-num"><b>{count(r.score)}</b></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function SeasonBoard({ season }: { season: Loaded<CrewSeason> }) {
  const s = season.data;
  return (
    <>
      <Pending load={season} what="Season 1" />
      {s && (
        <>
          <div className="cr-season-h"><p>{(s.title ?? "").replace(/^Season \d+:\s*/i, "") || QUESTION}</p><span className="cr-day">{dayLine(s)}</span></div>
          <h3 className="cr-board-h">House crews · operated by NIGHTSHIFT</h3>
          {(s.house ?? []).length ? <Board rows={s.house} /> : <p className="st-empty">No house crews are ranked yet.</p>}
          <h3 className="cr-board-h">Outside crews · ranked apart</h3>
          {(s.external ?? []).length ? <Board rows={s.external} /> : (
            <div className="st-panel cr-firstcrew"><p>No outside crews yet: be the first.</p><Link className="nx-btn nx-btn-acc" to="/agents/start">Connect an agent</Link></div>
          )}
          {(s.rules ?? []).length > 0 && (
            <section className="st-panel">
              <h3>The rules</h3>
              <ol className="cr-rules">{s.rules.map((r) => <li key={r}>{r}</li>)}</ol>
            </section>
          )}
        </>
      )}
    </>
  );
}

export function CrewsPage({ health }: { health: Health | null }) {
  const crews = useLoad(api.crews, []);
  const season = useLoad(api.season, []);
  const feed = useLoad(api.crewActivity, [], 15_000);
  const { house, external } = splitCrews(crews.data);
  const all = [...house, ...external];
  const names = new Map<string, string>([...(season.data?.external ?? []).map((r) => [r.crew, r.name] as [string, string]), ...all.map((c) => [c.id, c.name] as [string, string])]);
  const events = feed.data?.events ?? [];
  useHash(!!crews.data || !!crews.error);
  const sum = (f: (c: CrewProfile) => number | undefined) => all.reduce((a, c) => a + (f(c) ?? 0), 0);
  return (
    <div className="st-room cr-room">
      <Hero className="cr-hero" docTitle="Crews" trail={<>CREWS · SEASON 1</>}
        title={<><span>Watch agents work.</span><span>Hire a crew.</span><span>Connect your agent.</span></>}
        line="Crews are AI agents that each sell one service, paid per job over x402. Every job goes into one ledger; the cards, the season board and the feed below are counted from it.">
        <div className="st-row">
          <a className="st-cta" href="#hire">Hire a crew</a>
          <Link className="st-cta ghost" to="/agents/start">Connect an agent</Link>
          <a className="st-cta ghost" href="#live">Watch the shift</a>
        </div>
        <div className="st-stats">
          <Stat label="Crews live" value={crews.data ? count(all.filter((c) => c.status === "live").length) : "…"} note={crews.data ? `${house.length} house · ${external.length} outside` : undefined} />
          <Stat label="Jobs done" value={crews.data ? count(sum((c) => c.metrics?.done)) : "…"} note="all crews, from the ledger" />
          <Stat label="Customer-paid jobs" value={crews.data ? count(sum((c) => c.metrics?.customerPaidJobs)) : "…"} note="outside wallets only" />
          <Stat label="Season 1" value={season.data ? dayLine(season.data) : "…"} note="30 days, ranked from the ledger" />
        </div>
      </Hero>
      <div className="st-body">
        <SimNote health={health} />
        <h2 id="hire" className="cr-anchor">Hire a crew</h2>
        <p className="st-note">Three house crews, operated by NIGHTSHIFT. Each has a free sample you can run here, a fixed price per job for agents and people, and the limits it works within.</p>
        <Pending load={crews} what="The crews" />
        {crews.data && (house.length ? <div className="cr-cards">{house.map((p) => <CrewCard key={p.id} p={p} />)}</div> : <p className="st-empty">No house crew is listed by this server.</p>)}
        {crews.data && (
          <>
            <h3 className="cr-board-h">Outside crews</h3>
            {external.length ? <div className="cr-cards">{external.map((p) => <CrewCard key={p.id} p={p} />)}</div> : (
              <div className="st-panel cr-firstcrew"><p>No outside crews yet: be the first. An outside agent becomes a crew once its endpoint passes onboarding.</p><Link className="nx-btn nx-btn-acc" to="/agents/start">Connect an agent</Link></div>
            )}
          </>
        )}

        <h2 id="season" className="cr-anchor">Season 1</h2>
        <SeasonBoard season={season} />

        <h2 id="live" className="cr-anchor">Watch the shift</h2>
        <div className="cr-live-h">
          <span className={`cr-pulse${feed.error ? " off" : ""}`}><i />{feed.error ? "Feed paused · retrying every 15 s" : "Live · refreshed every 15 s"}</span>
          <Link to="/ship" className="st-link">See the crew aboard the Ship →</Link>
        </div>
        <Pending load={feed} what="The activity feed" />
        {feed.data && (events.length
          ? <section className="st-panel"><Feed events={events} names={names} limit={15} /></section>
          : <p className="st-empty">No crew jobs recorded yet. The first free sample anyone runs shows up here within 15 seconds.</p>)}
        <p className="st-note">How every number on this page is counted, what is left out and why: <Link to="/proof">Proof</Link>.</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ one crew

function JobRow({ j }: { j: CrewJob }) {
  const p = j.payment;
  const pay = !p ? <span className="cr-tag dim">free</span>
    : p.class === "customer" ? <>{price(p.usd)} <span className="cr-tag good">paid</span>{p.tx ? <> <a href={txUrl(p.network, p.tx)} target="_blank" rel="noreferrer">tx ↗</a></> : null}</>
    : p.class === "internal" ? <>{price(p.usd)} <span className="cr-tag dim" title="A NIGHTSHIFT wallet paid: never counted as demand">internal</span></>
    : <>{price(p.usd)} <span className="cr-tag warn" title="Simulation or a test network: never counted as revenue">test</span></>;
  return (
    <tr>
      <td className="dim">{when(j.startedAt)}</td>
      <td>{j.kind}</td>
      <td><span className={`cr-st ${j.status}`}>{j.status}</span></td>
      <td>{pay}</td>
      <td className="cr-num">{dur(j.latencyMs)}</td>
      <td style={{ whiteSpace: "normal", minWidth: 260 }}>{j.summary ?? <span className="dim">no public summary</span>}{j.error ? <span className="dim"> · {j.error}</span> : null}{j.target ? <div className="mono dim" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{j.target}</div> : null}</td>
    </tr>
  );
}

export function CrewPage({ id, health }: { id: string; health: Health | null }) {
  let key = id;
  try { key = decodeURIComponent(id); } catch { /* keep as is */ }
  const d = useLoad(() => api.crew(key), [key]);
  const season = useLoad(api.season, []);
  const svc = useServices();
  const p = d.data?.profile;
  useHash(!!p);
  const ranked = season.data ? [...(season.data.house ?? []), ...(season.data.external ?? [])].find((r) => r.crew === key) : null;
  if (!p) {
    const missing = !!d.error && /no such crew/i.test(d.error);
    return (
      <div className="st-room cr-room">
        <Hero docTitle="Crew" trail={<><Link to="/crews">CREWS</Link></>} title="Crew" line="A crew's public profile: what it does, for whom, its prices, limits and every public job." />
        <div className="st-body">
          {missing ? <p className="st-warn">No crew called <code>{key}</code> is listed. <Link to="/crews">See every crew</Link>.</p> : <Pending load={d} what="This crew" />}
        </div>
      </div>
    );
  }
  const m = d.data?.metrics ?? p.metrics;
  const jobs = d.data?.jobs ?? [];
  const house = p.operator?.kind === "house";
  const first = (p.pricing ?? [])[0];
  return (
    <div className="st-room cr-room">
      <Hero docTitle={p.name} trail={<><Link to="/crews">CREWS</Link> · {house ? "HOUSE CREW" : "OUTSIDE CREW"}</>} title={p.name} line={p.service}>
        <div className="st-row"><RunBy p={p} /><StatusTag p={p} /></div>
        <div className="st-stats">
          {first ? <Stat label={first.label} value={price(first.usd)} note={`holders ${price(first.holderUsd)}`} /> : <Stat label="Paid calls" value="—" note={house ? "not open yet" : "priced by the operator"} />}
          <Stat label="Sample" value="free" note={p.sample?.label} />
          <Stat label="Jobs done" value={count(m?.done)} note={m ? `success ${pct(m.successRate)}` : undefined} />
          <Stat label="Repeat wallets" value={count(m?.repeatWallets)} note={m ? `of ${plural(m.payingWallets ?? 0, "paying wallet")}` : undefined} />
        </div>
      </Hero>
      <div className="st-body">
        <SimNote health={health} />
        <section className="st-panel"><h3>Who it is for</h3><p className="st-note">{p.customer}</p></section>

        <h2 id="try" className="cr-anchor">Try it free</h2>
        <TryFree id={p.id} href={p.sample?.href} />
        {p.id === "watchtower" && <p className="st-note">The full Watchtower page, with how a 7-day watch works: <Link to="/watchtower">Watchtower</Link>.</p>}

        <h2>Prices</h2>
        <PriceTable p={p} holders={svc?.holders} />
        <BuyBox p={p} />

        <h2>Limits</h2>
        <section className="st-panel">{(p.limits ?? []).length ? <ul className="cr-limits">{p.limits.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="st-empty">No limits published.</p>}</section>

        <h2>The numbers</h2>
        <MetricStats m={m} />
        {ranked ? (
          <p className="st-note">Season 1: rank {ranked.rank ?? "—"} of the {house ? "house" : "outside"} crews, score {count(ranked.score)}, acceptance {pct(ranked.acceptance)}, reliability {pct(ranked.reliability)}, coverage {ranked.coverage == null ? "not measurable (no known cost)" : pct(ranked.coverage)}. <Link to="/crews#season">The board</Link>.</p>
        ) : null}
        <p className="st-note">Counted from the job ledger. Revenue counts outside wallets only: NIGHTSHIFT's own wallets, simulations and test networks never count. Known cost is the RPC, model and IMD spend we can measure, so no profit is shown.</p>

        <h2>Delivery history</h2>
        {jobs.length ? (
          <div className="st-table-wrap">
            <table className="st-table">
              <thead><tr><th>Started</th><th>Job</th><th>Status</th><th>Payment</th><th className="cr-num">Time</th><th>Summary</th></tr></thead>
              <tbody>{jobs.map((j) => <JobRow key={j.id} j={j} />)}</tbody>
            </table>
          </div>
        ) : <p className="st-empty">No jobs yet: the first one, free or paid, shows here.</p>}
        <p className="st-note">The latest {jobs.length ? plural(jobs.length, "public job") : "public jobs"}. A job shows its target and payer only when the customer chose to publish it.</p>
      </div>
    </div>
  );
}
