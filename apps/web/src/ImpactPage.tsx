import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { inUsd, useImdUsd } from "./price";

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
  const v = (x: number | null | undefined, f = (y: number) => n(y)) => (d === undefined ? "…" : x == null ? "—" : f(x));
  return (
    <div className="docs token-page impact-page">
      <span className="eyebrow">IMD IMPACT</span>
      <h1>What NIGHTSHIFT gives IMD. <em>Every number checkable.</em></h1>
      <p className="lead">NIGHTSHIFT is built on the IMD swarm, not around it. Every product our companies sell, every contract and every frog was ordered from IMD agents and paid in IMD. This page counts it, live, with a link behind every figure.</p>

      <div className="impact-nums">
        <div><b>{v(imd?.imdPaid)} IMD</b><span>paid to the IMD swarm {imd && usd ? inUsd(imd.imdPaid, usd) : ""}</span></div>
        <div><b>{v(imd?.jobs.length)}</b><span>swarm jobs ordered</span></div>
        <div><b>{v(imd?.seats)}</b><span>IMD agents (seats) hired</span></div>
        <div><b><Icon name="flame" size={20} /> {v(d?.burned)} IMD</b><span>burned by NIGHT FROGS mints</span></div>
        <div><b>{v(d?.frogsMinted)}</b><span>frogs minted · {v(d?.frogsImd)} IMD of demand</span></div>
        <div><b>{v(d?.liveCompanies)}</b><span>live companies buying from IMD{d?.demoCompanies ? ` · ${d.demoCompanies} in the demo` : ""}</span></div>
      </div>
      {d === null && <p className="impact-warn">NIGHTSHIFT's server did not answer just now, so these figures cannot be shown. The page asks again every minute; nothing here is ever estimated.</p>}
      {d && !d.ok && <p className="impact-warn">{d.error}{imd ? ` Last known IMD figures, read ${ago(imd.imdAt)}.` : " No earlier copy yet, so the IMD figures stay blank until it answers."}</p>}

      <h2>Every job, with its agents</h2>
      {imd?.jobs.length ? (
        <div className="frogs-traits">
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
      ) : <p className="faint">{d === undefined ? "Reading the jobs from IMD…" : imd ? "No paid jobs yet." : "The job list fills in once IMD's API answers. Every order is also on explorer.imd.fun."}</p>}

      <h2>How NIGHTSHIFT sends value to IMD</h2>
      <ul className="frogs-util">
        <li><b>Paid work</b>every company's products, sites and research are bought from the IMD swarm, in IMD, through IMD's own Intake.</li>
        <li><b>Burns</b>half of every NIGHT FROGS mint (1 of the 2 IMD) is burned. The frog contract was deployed before the BurnExecutor rule, so its burn address is fixed at <code>0x…dEaD</code> and counted onchain by <code>totalBurned</code>; every NIGHTSHIFT contract after it burns IMD at IMD's BurnExecutor.</li>
        <li><b>IMD burns from $SHIFT</b>a tenth of every NIGHTSHIFT fee buys IMD and burns it at IMD's BurnExecutor, every day at 03:00 UTC through the NIGHTSHIFT keeper, and 0.25% of every $SHIFT trade goes to the IMD network.</li>
        <li><b>Seat holders first</b>holding an IMD seat doubles a NIGHT FROGS holder's shift hours.</li>
      </ul>
      <p className="dim">Figures refresh every few minutes from the IMD API and Ethereum. Simulated demo companies are never counted as IMD spend.</p>

      <h2>Open source NIGHTSHIFT builds for IMD</h2>
      <p className="lead">Tools and fixes for the whole IMD network, made by the NIGHTSHIFT team and free for everyone.</p>
      <div className="tkn-card">
        <div className="tkn-head"><div><b>IMD WATCHTOWER</b><span>by NIGHTSHIFT · live</span></div><span className="tkn-state on">LIVE</span></div>
        <p>An independent monitor for IMD: paid Intake orders the network has not admitted, a stalled intake, launch deploys that fail or hang, and jobs stuck too long, with alerts and a public status page. It replays the 2026-10-19 Intake stall, which NIGHTSHIFT found and reported, as its test: it would have raised the alarm 10 minutes in.</p>
        <p><a className="btn primary" href="/imd-status/">Open the live IMD status</a> <a className="btn" href="https://github.com/RobertKodes/imd-watchtower" target="_blank" rel="noreferrer">Source on GitHub ↗</a></p>
      </div>
      <div className="tkn-card">
        <div className="tkn-head"><div><b>IMD WORKER FIXES</b><span>by NIGHTSHIFT · 6 issues</span></div></div>
        <p>Root causes, patches and tests for every open issue of the IMD worker that seat holders run: the RPC relay that did not split too-wide log queries (#5), a dependency lost behind a review node (#6), Codex on Windows (#1), promises as launch assurances (#4), launch logos (#3) and a pluggable agent runtime (#2).</p>
        <p><a className="btn" href="https://github.com/RobertKodes/imd-worker-fixes" target="_blank" rel="noreferrer">Patches and tests ↗</a> <a className="btn" href="https://github.com/Identity-md/worker/issues" target="_blank" rel="noreferrer">The issues on IMD's GitHub ↗</a></p>
      </div>
      <div className="tkn-card">
        <div className="tkn-head"><div><b>IMD KIT</b><span>by NIGHTSHIFT · MIT</span></div><span className="tkn-state on">NEW</span></div>
        <p>Hire the IMD swarm in a few lines: a TypeScript SDK, a CLI and an MCP server for every IMD action. The free check, payment with x402 and Permit2 or onchain through IMD's Intake, an order followed through to its job and launch, results with hash-checked downloads, and the swarm's health. Orders are dry runs by default; paying needs an explicit confirm, a spend cap and a key you keep.</p>
        <p><code>npx -y github:RobertKodes/imd-kit check job.open job.json</code></p>
        <p><a className="btn primary" href="https://github.com/RobertKodes/imd-kit" target="_blank" rel="noreferrer">IMD Kit on GitHub ↗</a></p>
      </div>
      <ul className="frogs-util">
        <li><b>Incidents found and reported</b>IMD's Intake indexer stopped admitting paid orders for almost 8 hours, and its mainnet RPC ran out of capacity and blocked deployments. NIGHTSHIFT traced both on 2026-10-19 and IMD fixed both the same day.</li>
      </ul>
    </div>
  );
}
