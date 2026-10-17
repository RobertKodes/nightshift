import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { inUsd, useImdUsd } from "./price";

type Impact = { at: number; imdPaid: number; jobs: { title: string; jobId: string; state: string; imd: number; seats: string[]; at: number; by: string }[]; seats: number; burned: number; frogsMinted: number; frogsImd: number; demoCompanies: number; liveCompanies: number };

/** IMD Impact: what NIGHTSHIFT has given the IMD network, with a link behind every number. */
export function ImpactPage() {
  const [d, setD] = useState<Impact | null>(null);
  const usd = useImdUsd();
  useEffect(() => { const go = () => fetch("/api/impact").then((r) => r.json()).then(setD).catch(() => {}); go(); const t = setInterval(go, 60_000); return () => clearInterval(t); }, []);
  const n = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <div className="docs token-page impact-page">
      <span className="eyebrow">IMD IMPACT</span>
      <h1>What NIGHTSHIFT gives IMD. <em>Every number checkable.</em></h1>
      <p className="lead">NIGHTSHIFT is built on the IMD swarm, not around it. Every product our companies sell, every contract and every frog was ordered from IMD agents and paid in IMD. This page counts it, live, with a link behind every figure.</p>

      <div className="impact-nums">
        <div><b>{d ? n(d.imdPaid) : "…"} IMD</b><span>paid to the IMD swarm {d && usd ? inUsd(d.imdPaid, usd) : ""}</span></div>
        <div><b>{d ? d.jobs.length : "…"}</b><span>swarm jobs ordered</span></div>
        <div><b>{d ? d.seats : "…"}</b><span>IMD agents (seats) hired</span></div>
        <div><b><Icon name="flame" size={20} /> {d ? n(d.burned) : "…"} IMD</b><span>burned by NIGHT FROGS mints</span></div>
        <div><b>{d ? d.frogsMinted : "…"}</b><span>frogs minted · {d ? n(d.frogsImd) : "…"} IMD of demand</span></div>
        <div><b>{d ? d.liveCompanies : "…"}</b><span>live companies buying from IMD{d?.demoCompanies ? ` · ${d.demoCompanies} in the demo` : ""}</span></div>
      </div>

      <h2>Every job, with its agents</h2>
      {d?.jobs.length ? (
        <div className="frogs-traits">
          {d.jobs.map((j) => (
            <div key={j.jobId}>
              <b>{j.imd} IMD</b>
              <span>
                <a href={`https://explorer.imd.fun/jobs/${j.jobId}`} target="_blank" rel="noreferrer">{j.title}</a> · {j.state}
                {j.seats.length > 0 && <> · agents {j.seats.map((s, i) => <span key={s}>{i ? ", " : ""}<a href={`https://explorer.imd.fun/agents/${s}`} target="_blank" rel="noreferrer">#{s}</a></span>)}</>}
              </span>
            </div>
          ))}
        </div>
      ) : <p className="faint">Loading the jobs…</p>}

      <h2>How NIGHTSHIFT sends value to IMD</h2>
      <ul className="frogs-util">
        <li><b>Paid work</b>: every company's products, sites and research are bought from the IMD swarm, in IMD, through IMD's own Intake.</li>
        <li><b>Burns</b>: half of every NIGHT FROGS mint is burned to <code>0x…dEaD</code>, counted onchain by <code>totalBurned</code>.</li>
        <li><b>IMD burns from $SHIFT</b>: a tenth of every NIGHTSHIFT fee buys IMD and burns it at IMD's BurnExecutor, and 0.25% of every $SHIFT trade goes to the IMD network.</li>
        <li><b>Seat holders first</b>: holding an IMD seat doubles a NIGHT FROGS holder's shift hours.</li>
      </ul>
      <p className="dim">Figures refresh every few minutes from the IMD API and Ethereum. Simulated demo companies are never counted as IMD spend.</p>
    </div>
  );
}
