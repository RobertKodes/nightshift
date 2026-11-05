import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { inUsd, useImdUsd } from "./price";
import GlitchText from "./rb/GlitchText";
import { PxHero, PxNum, PxPanel, PxSection, PxStat, PxStats, PxTag } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { Flap, HeroDots, Prompt, ShStar } from "./saas/pages/shift-kit";
import "./saas/pages/impact.css";

type Impact = {
  at: number; ok: boolean; error: string | null; imdAt: number; imdPaid: number; jobs: { title: string; jobId: string; state: string; imd: number; seats: string[]; at: number; by: string }[]; seats: number;
  burned: number | null; frogsMinted: number | null; frogsImd: number | null; demoCompanies: number; liveCompanies: number;
};
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

/** IMD Impact: what NIGHTSHIFT has given the IMD network, with a link behind every number. */
export function ImpactPage() {
  // undefined: still asking; null: NIGHTSHIFT's server did not answer
  const [d, setD] = useState<Impact | null | undefined>(undefined);
  const usd = useImdUsd();
  useEffect(() => { const go = () => fetch("/api/impact", { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null)).then((x: Impact | null) => setD(x && Array.isArray(x.jobs) ? x : null)).catch(() => setD((v) => v ?? null)); go(); const t = setInterval(go, 60_000); return () => clearInterval(t); }, []);
  const n = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  // the IMD figures are known once the crew ledger has read IMD at least once
  const imd = d && d.imdAt > 0 ? d : null;
  /** A figure that counts up: "…" while the page asks, "—" when it is not known. */
  const v = (x: number | null | undefined, decimals = 0) => (d === undefined ? "…" : x == null ? "—" : <PxNum value={x} decimals={decimals} />);
  const board = (
    <PxPanel className="sh-board imp-board" tone="imd" title="PAID TO THE IMD SWARM" state={d === undefined ? "idle" : imd ? "live" : "warn"} right={imd ? `READ ${ago(imd.imdAt).toUpperCase()}` : undefined}>
      <span className="sh-board-k">IMD · ORDERED THROUGH IMD'S OWN INTAKE</span>
      <div className="sh-flap-wrap"><Flap text={d === undefined ? "…" : imd ? `${n(imd.imdPaid)} IMD` : "—"} size={26} tone="imd" charset="0123456789.,IMD— " /></div>
      <div className="sh-board-row">
        <div><span>In dollars</span><b className="imd">{imd && usd ? inUsd(imd.imdPaid, usd) : "—"}</b></div>
        <div><span>Swarm jobs</span><b className="imd">{v(imd?.jobs.length)}</b></div>
      </div>
      <img className="imp-frog" src="/brand/pepe-operator.svg" alt="" width={44} height={44} loading="lazy" />
      <Prompt cmd="imd ledger --live --checkable" />
    </PxPanel>
  );
  return (
    <div className="sh sh-impact">
      <PxHero
        kicker="IMD IMPACT"
        live
        title="What NIGHTSHIFT gives IMD."
        accent="Every number checkable."
        lead={<>NIGHTSHIFT is built on the <b>IMD swarm</b>, not around it. Every product our companies sell, every contract and every frog was ordered from IMD agents and paid in IMD. This page counts it, live, with a link behind every figure.</>}
        actions={<>
          <ShStar href="#jobs" icon="pulse">SEE EVERY JOB</ShStar>
          <a className="px-btn imd" href="/imd-status/"><PxIcon name="shield" size={14} />LIVE IMD STATUS</a>
          <a className="px-btn ghost" href="#builds"><PxIcon name="doc" size={14} />OPEN SOURCE</a>
        </>}
        aside={board}
        bg={<HeroDots tone="imd" />}
      />

      <div className="imp-stats">
        <PxStats cols={5}>
          <PxStat label="Swarm jobs ordered" tone="imd" value={v(imd?.jobs.length)} sub="every one on explorer.imd.fun" />
          <PxStat label="IMD agents (seats) hired" tone="imd" value={v(imd?.seats)} sub="named on every job below" />
          <PxStat label="IMD burned" tone="gold" value={<><Icon name="flame" size={18} /> {v(d?.burned, d?.burned != null && d.burned % 1 ? 2 : 0)}</>} sub="by NIGHT FROGS mints" />
          <PxStat label="Frogs minted" value={v(d?.frogsMinted)} sub={<>{d === undefined ? "…" : d?.frogsImd == null ? "—" : n(d.frogsImd)} IMD of demand</>} to="/frogs" />
          <PxStat label="Live companies" value={v(d?.liveCompanies)} sub={<>buying from IMD{d?.demoCompanies ? ` · ${d.demoCompanies} in the demo` : ""}</>} to="/companies" />
        </PxStats>
      </div>
      {d === null && <p className="sh-warn">NIGHTSHIFT's server did not answer just now, so these figures cannot be shown. The page asks again every minute; nothing here is ever estimated.</p>}
      {d && !d.ok && <p className="sh-warn">{d.error}{imd ? ` Last known IMD figures, read ${ago(imd.imdAt)}.` : " No earlier copy yet, so the IMD figures stay blank until it answers."}</p>}

      <PxSection kicker="THE LEDGER" title={<>Every job, <em>with its agents.</em></>} id="jobs">
        <PxPanel tone="imd" title="SWARM JOBS · PAID IN IMD" state={imd?.jobs.length ? "live" : "idle"} right={imd ? `${imd.jobs.length} JOBS` : undefined}>
          {imd?.jobs.length ? (
            <div className="frogs-traits imp-jobs">
              {imd.jobs.map((j) => (
                <div key={j.jobId}>
                  <b>{j.imd} IMD</b>
                  <span>
                    <a href={`https://explorer.imd.fun/jobs/${j.jobId}`} target="_blank" rel="noreferrer">{j.title}</a> · {j.state}
                    {j.seats.length > 0 && <> · agents {j.seats.map((s, i) => <span key={s}>{i ? ", " : ""}<a href={`https://explorer.imd.fun/agents/${s}`} target="_blank" rel="noreferrer">#{s}</a></span>)}</>}
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="sh-line">{d === undefined ? "Reading the jobs from IMD…" : imd ? "No paid jobs yet." : "The job list fills in once IMD's API answers. Every order is also on explorer.imd.fun."}</p>}
        </PxPanel>
      </PxSection>

      <PxSection kicker="THE FLOW" title={<>How NIGHTSHIFT sends <em>value to IMD.</em></>} id="imp-flow">
        <ul className="sh-grid imp-grid">
          <li><b>Paid work</b>every company's products, sites and research are bought from the IMD swarm, in IMD, through IMD's own Intake.</li>
          <li><b>Burns</b>half of every NIGHT FROGS mint (1 of the 2 IMD) is burned. The frog contract was deployed before the BurnExecutor rule, so its burn address is fixed at <code>0x…dEaD</code> and counted onchain by <code>totalBurned</code>; every NIGHTSHIFT contract after it burns IMD at IMD's BurnExecutor.</li>
          <li><b>IMD burns from $SHIFT</b>a tenth of every NIGHTSHIFT fee buys IMD and burns it at IMD's BurnExecutor, every day at 03:00 UTC through the NIGHTSHIFT keeper, and 0.25% of every $SHIFT trade goes to the IMD network.</li>
          <li><b>Seat holders first</b>holding an IMD seat doubles a NIGHT FROGS holder's shift hours.</li>
        </ul>
        <p className="sh-note">Figures refresh every few minutes from the IMD API and Ethereum. Simulated demo companies are never counted as IMD spend.</p>
      </PxSection>

      <section className="px-sec pk-sec" aria-labelledby="builds" id="imp-builds">
        <div className="px-sec-head">
          <div>
            <span className="px-kicker imd">BUILT FOR THE WHOLE NETWORK</span>
            <h2 className="px-h2" id="builds"><GlitchText speed={0.9} enableShadows shadowColors={["#2f7bff", "#b8ff3d"]} trigger="hover" fontSize="inherit" fontWeight="inherit" color="inherit">Open source NIGHTSHIFT builds for IMD</GlitchText></h2>
            <p className="px-sub">Tools and fixes for the whole IMD network, made by the NIGHTSHIFT team and free for everyone.</p>
          </div>
        </div>
        <div className="imp-builds">
          <PxPanel tone="imd" title="IMD WATCHTOWER" state="live" right="BY NIGHTSHIFT">
            <p className="sh-line">An independent monitor for IMD: paid Intake orders the network has not admitted, a stalled intake, launch deploys that fail or hang, and jobs stuck too long, with alerts and a public status page. It replays the 2026-10-19 Intake stall, which NIGHTSHIFT found and reported, as its test: it would have raised the alarm 10 minutes in.</p>
            <div className="imp-act"><a className="px-btn imd" href="/imd-status/"><PxIcon name="pulse" size={14} />Open the live IMD status</a> <a className="px-btn ghost" href="https://github.com/RobertKodes/imd-watchtower" target="_blank" rel="noreferrer">Source on GitHub ↗</a></div>
          </PxPanel>
          <PxPanel tone="imd" title="IMD WORKER FIXES" right="BY NIGHTSHIFT · 6 ISSUES">
            <p className="sh-line">Root causes, patches and tests for every open issue of the IMD worker that seat holders run: the RPC relay that did not split too-wide log queries (#5), a dependency lost behind a review node (#6), Codex on Windows (#1), promises as launch assurances (#4), launch logos (#3) and a pluggable agent runtime (#2).</p>
            <div className="imp-act"><a className="px-btn" href="https://github.com/RobertKodes/imd-worker-fixes" target="_blank" rel="noreferrer">Patches and tests ↗</a> <a className="px-btn ghost" href="https://github.com/Identity-md/worker/issues" target="_blank" rel="noreferrer">The issues on IMD's GitHub ↗</a></div>
          </PxPanel>
          <PxPanel tone="imd" title={<>IMD KIT <PxTag tone="imd">NEW</PxTag></>} right="BY NIGHTSHIFT · MIT">
            <p className="sh-line">Hire the IMD swarm in a few lines: a TypeScript SDK, a CLI and an MCP server for every IMD action. The free check, payment with x402 and Permit2 or onchain through IMD's Intake, an order followed through to its job and launch, results with hash-checked downloads, and the swarm's health. Orders are dry runs by default; paying needs an explicit confirm, a spend cap and a key you keep.</p>
            <p className="imp-cmd"><span aria-hidden="true">$</span><code>npx -y github:RobertKodes/imd-kit check job.open job.json</code></p>
            <div className="imp-act"><a className="px-btn imd" href="https://github.com/RobertKodes/imd-kit" target="_blank" rel="noreferrer">IMD Kit on GitHub ↗</a></div>
          </PxPanel>
        </div>
        <ul className="sh-grid imp-grid one">
          <li><b>Incidents found and reported</b>IMD's Intake indexer stopped admitting paid orders for almost 8 hours, and its mainnet RPC ran out of capacity and blocked deployments. NIGHTSHIFT traced both on 2026-10-19 and IMD fixed both the same day.</li>
        </ul>
      </section>
    </div>
  );
}
