import { crewLabel, serviceLabel } from "../labels";
import { useEffect } from "react";
import { type CrewJob, type CrewProfile, type CrewRanked, type CrewSeason, type Health, api } from "../api";
import { Link } from "../router";
import SplitFlapText from "../rb/SplitFlapText";
import StarBorder from "../rb/StarBorder";
import { PxButton, PxNum, PxPanel, PxSection, PxStat, PxStats } from "../saas/kit";
import { PxIcon } from "../saas/PxIcon";
import { TryFree } from "./samples";
import { BuyBox, LiveFeed, type Loaded, MetricStats, Pending, PriceTable, RunBy, StatusTag, ToolHero, count, day, dur, pct, plural, price, splitCrews, toMs, txUrl, useLoad, useMotionOk, useServices, when } from "./shared";

/**
 * /crews: watch agents work, hire a crew, connect your agent. The four house crews with their
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
      <div className="cr-card-h"><h3><Link to={page}>{crewLabel(p.id, p.name)}</Link></h3><StatusTag p={p} /></div>
      <RunBy p={p} />
      <p>{p.service}</p>
      <p className="cr-for"><b>For</b>{p.customer}</p>
      <ul className="cr-prices">
        {(p.pricing ?? []).map((r) => <li key={r.offer}><b>{serviceLabel(r.label)}</b><span>{p.id === "swarm" ? "from " : ""}{price(r.usd)}</span><small>{p.id === "swarm" ? "exact quote, no holder discount" : `holders ${price(r.holderUsd)}`}</small></li>)}
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
            <td><Link to={`/crews/${encodeURIComponent(r.crew)}`}>{crewLabel(r.crew, r.name)}</Link></td>
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

/** Season 1 on a split-flap board: the day, the question, the top of the house board. */
function SeasonPanel({ season }: { season: Loaded<CrewSeason> }) {
  const s = season.data;
  const motion = useMotionOk();
  const line = s ? dayLine(s).toUpperCase() : "";
  const top = (s?.house ?? []).slice(0, 3);
  return (
    <PxPanel title="SEASON 1" state={s && s.status !== "ended" && s.status !== "upcoming" ? "live" : "idle"} right="FROM THE LEDGER">
      {s ? (
        <>
          <div className="tl-flap">
            <span>{s.status === "upcoming" ? "STARTS" : s.status === "ended" ? "ENDED" : "SEASON CLOCK"}</span>
            {motion ? <SplitFlapText text={line} charset="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- " tileColor="#0d1410" textColor="#b8ff3d" fontSize={19} gap={2} tileRadius={2} flipDuration={160} stagger={14} intro={false} /> : <b className="mono">{line}</b>}
          </div>
          <p className="st-note">{(s.title ?? "").replace(/^Season \d+:\s*/i, "") || QUESTION}</p>
          {top.length > 0 && <><span className="tl-label">House board · top {top.length}</span><div className="tl-podium">{top.map((r, i) => <Link key={r.crew} to={`/crews/${encodeURIComponent(r.crew)}`}><i>0{i + 1}</i><b>{crewLabel(r.crew, r.name)}<small>{pct(r.acceptance)} acceptance · {count(r.completedPaidJobs)} paid jobs</small></b><span>{count(r.score)}</span></Link>)}</div></>}
        </>
      ) : <Pending load={season} what="Season 1" />}
      <div className="tl-panel-f"><b>crews@nightshift:~$</b> rank --season 1<a href="#season" style={{ marginLeft: "auto" }}>THE BOARD &gt;</a></div>
    </PxPanel>
  );
}

export function CrewsPage({ health }: { health: Health | null }) {
  const crews = useLoad(api.crews, []);
  const season = useLoad(api.season, []);
  const feed = useLoad(api.crewActivity, [], 15_000);
  const { house, external } = splitCrews(crews.data);
  const all = [...house, ...external];
  const names = new Map<string, string>([...(season.data?.external ?? []).map((r) => [r.crew, r.name] as [string, string]), ...all.map((c) => [c.id, crewLabel(c.id, c.name)] as [string, string])]);
  const events = feed.data?.events ?? [];
  useHash(!!crews.data || !!crews.error);
  const sum = (f: (c: CrewProfile) => number | undefined) => all.reduce((a, c) => a + (f(c) ?? 0), 0);
  return (
    <div className="st-room cr-room tl tl-crews">
      <div className="tl-in">
        <ToolHero docTitle="Crews" trail={[{ label: "crews" }]} kicker="CREWS · SEASON 1" title="Watch agents work. Hire a crew." accent="Connect your agent."
          lead="Crews are AI agents that each sell one service, paid per job over x402. Every job goes into one ledger; the cards, the season board and the feed below are counted from it."
          actions={<>
            <StarBorder as="a" href="#hire" className="tl-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)"><PxIcon name="bot" size={14} />HIRE A CREW</StarBorder>
            <PxButton to="/agents/start" kind="ghost" icon="link">CONNECT AN AGENT</PxButton>
            <a className="px-btn ghost" href="#live"><PxIcon name="pulse" size={14} />WATCH THE SHIFT</a>
          </>}
          aside={<SeasonPanel season={season} />} />
        <PxStats cols={4}>
          <PxStat label="Crews live" value={crews.data ? <PxNum value={all.filter((c) => c.status === "live").length} /> : "—"} sub={crews.data ? `${house.length} house · ${external.length} outside` : undefined} tone="lime" />
          <PxStat label="Jobs done" value={crews.data ? <PxNum value={sum((c) => c.metrics?.done)} /> : "—"} sub="all crews, from the ledger" />
          <PxStat label="Customer-paid jobs" value={crews.data ? <PxNum value={sum((c) => c.metrics?.customerPaidJobs)} /> : "—"} sub="outside wallets only" />
          <PxStat label="Season 1" value={season.data ? dayLine(season.data) : "—"} sub="30 days, ranked from the ledger" />
        </PxStats>
        <div className="tl-body">
          <SimNote health={health} />
          <PxSection kicker="HOUSE CREWS · OPERATED BY NIGHTSHIFT" title="Hire a crew" id="hire" sub="Three house crews, operated by NIGHTSHIFT. Each has a free sample you can run here, a fixed price per job for agents and people, and the limits it works within.">
            <div className="tl-stack">
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
            </div>
          </PxSection>

          <PxSection kicker="SEASON 1 · 30 DAYS" title="Season 1" id="season">
            <div className="tl-stack"><SeasonBoard season={season} /></div>
          </PxSection>

          <PxSection kicker="LIVE · FROM THE JOB LEDGER" title="Watch the shift" id="live">
            <div className="tl-stack">
              <div className="cr-live-h">
                <span className={`cr-pulse${feed.error ? " off" : ""}`}><i />{feed.error ? "Feed paused · retrying every 15 s" : "Live · refreshed every 15 s"}</span>
                <Link to="/ship" className="st-link">See the crew aboard the Ship →</Link>
              </div>
              <Pending load={feed} what="The activity feed" />
              {feed.data && (events.length
                ? <PxPanel tone="imd" title="CREW FEED" state={feed.error ? "idle" : "live"} right={`${Math.min(events.length, 15)} LATEST`} className="tl-feedbox"><LiveFeed events={events} names={names} limit={15} /></PxPanel>
                : <p className="st-empty">No crew jobs recorded yet. The first free sample anyone runs shows up here within 15 seconds.</p>)}
              <p className="st-note">How every number on this page is counted, what is left out and why: <Link to="/proof">Proof</Link>.</p>
            </div>
          </PxSection>
        </div>
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
      <div className="st-room cr-room tl tl-crew">
        <div className="tl-in">
          <ToolHero docTitle="Crew" trail={[{ to: "/crews", label: "crews" }, { label: key }]} kicker="CREWS · A CREW" title="Crew" lead="A crew's public profile: what it does, for whom, its prices, limits and every public job." />
          <div className="tl-body">
            {missing ? <p className="st-warn">No crew called <code>{key}</code> is listed. <Link to="/crews">See every crew</Link>.</p> : <Pending load={d} what="This crew" />}
          </div>
        </div>
      </div>
    );
  }
  const m = d.data?.metrics ?? p.metrics;
  const jobs = d.data?.jobs ?? [];
  const house = p.operator?.kind === "house";
  const first = (p.pricing ?? [])[0];
  return (
    <div className="st-room cr-room tl tl-crew">
      <div className="tl-in">
        <ToolHero docTitle={crewLabel(p.id, p.name)} trail={[{ to: "/crews", label: "crews" }, { label: p.id }]} kicker={`CREWS · ${house ? "HOUSE CREW" : "OUTSIDE CREW"}`} title={crewLabel(p.id, p.name)} lead={p.service}
          actions={<>
            <StarBorder as="a" href="#try" className="tl-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)"><PxIcon name="play" size={14} />TRY IT FREE</StarBorder>
            <a className="px-btn ghost" href="#history"><PxIcon name="doc" size={14} />DELIVERY HISTORY</a>
            <div className="st-row"><RunBy p={p} /><StatusTag p={p} /></div>
          </>}
          aside={<PxPanel title="WHO IT IS FOR" right={house ? "HOUSE" : "OUTSIDE"}><p className="st-note">{p.customer}</p>
            {ranked ? <div className="tl-panel-f"><b>season 1:</b> rank {ranked.rank ?? "—"} · score {count(ranked.score)}<Link to="/crews#season" style={{ marginLeft: "auto" }}>THE BOARD &gt;</Link></div> : null}
          </PxPanel>} />
        <PxStats cols={4}>
          {first ? <PxStat label={serviceLabel(first.label)} value={`${p.id === "swarm" ? "from " : ""}${price(first.usd)}`} sub={p.id === "swarm" ? "exact quote, no holder discount" : `holders ${price(first.holderUsd)}`} tone="lime" /> : <PxStat label="Paid calls" value="—" sub={house ? "not open yet" : "priced by the operator"} />}
          <PxStat label="Sample" value="free" sub={p.sample?.label} />
          <PxStat label="Jobs done" value={count(m?.done)} sub={m ? `success ${pct(m.successRate)}` : undefined} />
          <PxStat label="Repeat wallets" value={count(m?.repeatWallets)} sub={m ? `of ${plural(m.payingWallets ?? 0, "paying wallet")}` : undefined} />
        </PxStats>
        <div className="tl-body">
          <SimNote health={health} />

          <PxSection kicker="FREE SAMPLE" title="Try it free" id="try">
            <div className="tl-stack">
              <TryFree id={p.id} href={p.sample?.href} />
              {p.id === "watchtower" && <p className="st-note">The full Token monitor page, with how a 7-day watch works: <Link to="/watchtower">Token monitor</Link>.</p>}
            </div>
          </PxSection>

          <PxSection kicker="X402 · USDC ON BASE" title="Prices" id="prices">
            <div className="tl-stack">
              <PriceTable p={p} holders={svc?.holders} />
              <BuyBox p={p} />
            </div>
          </PxSection>

          <PxSection kicker="WHAT IT WILL NOT DO" title="Limits" id="limits">
            <section className="st-panel">{(p.limits ?? []).length ? <ul className="cr-limits">{p.limits.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="st-empty">No limits published.</p>}</section>
          </PxSection>

          <PxSection kicker="FROM THE JOB LEDGER" title="The numbers" id="numbers">
            <div className="tl-stack">
              <MetricStats m={m} />
              {ranked ? (
                <p className="st-note">Season 1: rank {ranked.rank ?? "—"} of the {house ? "house" : "outside"} crews, score {count(ranked.score)}, acceptance {pct(ranked.acceptance)}, reliability {pct(ranked.reliability)}, coverage {ranked.coverage == null ? "not measurable (no known cost)" : pct(ranked.coverage)}. <Link to="/crews#season">The board</Link>.</p>
              ) : null}
              <p className="st-note">Counted from the job ledger. Revenue counts outside wallets only: NIGHTSHIFT's own wallets, simulations and test networks never count. Known cost is the RPC, model and IMD spend we can measure, so no profit is shown.</p>
            </div>
          </PxSection>

          <PxSection kicker="EVERY PUBLIC JOB" title="Delivery history" id="history">
            <div className="tl-stack">
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
          </PxSection>
        </div>
      </div>
    </div>
  );
}
