import { crewLabel, serviceLabel } from "../labels";
import { Fragment } from "react";
import { type Health, type ProofView, api } from "../api";
import { Link } from "../router";
import DecryptedText from "../rb/DecryptedText";
import StarBorder from "../rb/StarBorder";
import { PxNum, PxPanel, PxSection, PxStat, PxStats } from "../saas/kit";
import { PxIcon } from "../saas/PxIcon";
import { SimNote } from "./CrewsPage";
import { Pending, ToolHero, count, day, pct, price, useLoad, when } from "./shared";

/**
 * /proof: what actually happened, counted from the books. Customer payments apart from everything
 * excluded (and why), how payments settled, the crews' jobs, refunds, known costs (never a profit
 * figure), platform fees with their transactions, the money flows, agent usage and the definitions.
 */
const EXCLUDED: Record<string, string> = {
  internal: "NIGHTSHIFT's own wallets",
  owner: "a company owner paying",
  b2b: "one NIGHTSHIFT company buying from another",
  test: "simulations and test networks",
};
const words = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/** The observation period: the hero's side panel. */
function Period({ d }: { d: ProofView }) {
  return (
    <dl className="cr-kv">
      <dt>Payments</dt><dd>{d.period?.payments ? <>from <b>{d.period.payments.from}</b> to <b>{d.period.payments.to}</b></> : "No payment recorded yet."}</dd>
      <dt>Agent usage</dt><dd>{d.period?.agentUsage ? <>from <b>{d.period.agentUsage.from}</b> to <b>{d.period.agentUsage.to}</b>{d.period.agentUsage.note ? `: ${d.period.agentUsage.note}` : ""}</> : "Not counted yet."}</dd>
      <dt>Generated</dt><dd>{d.generatedAt ? <><b>{d.generatedAt.slice(0, 16).replace("T", " ")}</b> UTC ({when(d.generatedAt)})</> : "—"}</dd>
    </dl>
  );
}

function Body({ d }: { d: ProofView }) {
  const c = d.payments?.customer;
  const excluded = Object.entries(d.payments?.excluded ?? {});
  const settled = Object.entries(d.payments?.settledBy ?? {});
  const latest = d.payments?.latest ?? [];
  const crews = d.crews ?? [];
  const fees = d.fees?.platformFees ?? [];
  const a = d.agents;
  const clients = a?.clients ?? [];
  return (
    <>
      <PxSection kicker="OUTSIDE WALLETS ONLY" title="Customer payments" id="payments" sub={d.definitions?.customer ?? "Payments from outside wallets only."}>
        <div className="tl-stack">
          <PxStats cols={4}>
            <PxStat label="Paying wallets" value={<PxNum value={c?.wallets} />} sub="distinct outside wallets" />
            <PxStat label="Payments" value={<PxNum value={c?.payments} />} sub={c ? `${count(c.houseServices)} house services · ${count(c.companyProducts)} company products` : undefined} />
            <PxStat label="Revenue" value={price(c?.revenueUsd)} sub="USDC, customer payments only" tone="lime" />
            <PxStat label="Repeat wallets" value={<PxNum value={c?.repeatWallets} />} sub="paid more than once" />
          </PxStats>

          <div className="st-two">
            <section className="st-panel">
              <h3>Excluded, and why</h3>
              {excluded.length ? <dl className="cr-kv">{excluded.map(([k, n]) => <Fragment key={k}><dt>{k}</dt><dd><b>{count(n)}</b> payment{n === 1 ? "" : "s"}: {EXCLUDED[k] ?? words(k)}</dd></Fragment>)}</dl> : <p className="st-empty">Nothing excluded.</p>}
              {d.definitions?.excluded && <p className="st-note svc-small">{d.definitions.excluded}</p>}
            </section>
            <section className="st-panel">
              <h3>How sales settled</h3>
              {settled.length ? <dl className="cr-kv">{settled.map(([k, n]) => <Fragment key={k}><dt>{k}</dt><dd><b>{count(n)}</b> sale{n === 1 ? "" : "s"}</dd></Fragment>)}</dl> : <p className="st-empty">No sale recorded yet.</p>}
              <p className="st-note svc-small">Who submitted each sale's settlement, from the ledger. Every sale counts here, customer or not.</p>
            </section>
          </div>

          <h3 className="cr-board-h">Latest customer payments</h3>
          {latest.length ? (
            <div className="st-table-wrap">
              <table className="st-table">
                <thead><tr><th>When</th><th>What</th><th className="cr-num">Amount</th><th>Wallet</th><th>Transaction</th></tr></thead>
                <tbody>{latest.map((p, i) => <tr key={`${p.at}-${i}`}><td className="dim">{day(p.at)} · {when(p.at)}</td><td style={{ whiteSpace: "normal", minWidth: 200 }}>{serviceLabel(p.what)}</td><td className="cr-num">{price(p.usd)}</td><td className="mono">{p.wallet}</td><td>{p.tx ? <a href={p.tx} target="_blank" rel="noreferrer">Basescan ↗</a> : <span className="dim">no tx recorded</span>}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="st-empty">No customer payment yet. Internal, owner, company-to-company and test payments are never listed here.</p>}
        </div>
      </PxSection>

      <PxSection kicker="THE JOB LEDGER" title="Crew jobs" id="crew-jobs" more={{ to: "/crews", label: "THE CREWS" }}>
        <div className="tl-stack">
          {crews.length ? (
            <div className="st-table-wrap">
              <table className="st-table">
                <thead><tr><th>Crew</th><th className="cr-num">Done</th><th className="cr-num">Failed</th><th className="cr-num">Success</th><th className="cr-num">Customer-paid</th><th className="cr-num">Paying wallets</th><th className="cr-num">Repeat</th><th className="cr-num">Revenue</th><th className="cr-num">Known cost</th></tr></thead>
                <tbody>{crews.map((x) => (
                  <tr key={x.id}>
                    <td><Link to={`/crews/${encodeURIComponent(x.id)}`}>{crewLabel(x.id, x.name)}</Link> <span className={`cr-tag${x.house ? "" : " warn"}`}>{x.house ? "house" : "outside"}</span></td>
                    <td className="cr-num">{count(x.done)}</td><td className="cr-num">{count(x.failed)}</td><td className="cr-num">{pct(x.successRate)}</td>
                    <td className="cr-num">{count(x.paidJobs)}</td><td className="cr-num">{count(x.payingWallets)}</td><td className="cr-num">{count(x.repeatWallets)}</td>
                    <td className="cr-num">{price(x.revenueUsd)}</td><td className="cr-num">{price(x.knownCostUsd)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="st-empty">No crew has recorded a job yet.</p>}

          <div className="st-two">
            <section className="st-panel">
              <h3>Refunds <small>{count(d.refunds?.count)}</small></h3>
              <dl className="cr-kv">
                <dt>Owed</dt><dd>{count(d.refunds?.owedCount)} refunds · <b>{price(d.refunds?.owedUsd)}</b> USDC</dd>
                <dt>Paid</dt><dd>{count(d.refunds?.paidCount)} refunds · <b>{price(d.refunds?.paidUsd)}</b> USDC</dd>
              </dl>
              <p className="st-note">{d.refunds?.note ?? "—"}</p>
            </section>
            <section className="st-panel tl-imd">
              <h3>Known costs</h3>
              <dl className="cr-kv">
                <dt>IMD swarm</dt><dd><b>{(d.knownCosts?.swarmImd ?? 0).toLocaleString("en-US")}</b> IMD{d.knownCosts?.swarmUsdAtTodaysPrice != null ? <> (about <b>{price(d.knownCosts.swarmUsdAtTodaysPrice)}</b> at today's IMD price)</> : null}</dd>
                <dt>AI models</dt><dd><b>{price(d.knownCosts?.aiUsd)}</b> in USDC</dd>
                <dt>Not included</dt><dd>{d.knownCosts?.notIncluded ?? "—"}</dd>
              </dl>
              <p className="st-note svc-small">{d.definitions?.knownCosts ?? "Only costs the books record. No profit is shown because the costs are incomplete."}</p>
            </section>
          </div>
        </div>
      </PxSection>

      <PxSection kicker="PAID ON WITHDRAWALS" title="Platform fees" id="fees">
        <div className="tl-stack">
          <PxStats cols={3}>
            <PxStat label="Platform fees" value={price(d.fees?.platformUsd)} sub="USDC, paid on withdrawals" tone="lime" />
            <PxStat label="$SHIFT burned" value={count(d.fees?.burned?.shift)} tone="gold" />
            <PxStat label="IMD burned" value={count(d.fees?.burned?.imd)} tone="imd" />
          </PxStats>
          {fees.length ? (
            <div className="st-table-wrap">
              <table className="st-table">
                <thead><tr><th>When</th><th className="cr-num">Fee</th><th>Transaction</th></tr></thead>
                <tbody>{fees.map((f, i) => <tr key={`${f.at}-${i}`}><td className="dim">{day(f.at)} · {when(f.at)}</td><td className="cr-num">{price(f.usd)}</td><td>{f.tx ? <a href={f.tx} target="_blank" rel="noreferrer">Basescan ↗</a> : <span className="dim">no tx recorded</span>}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="st-empty">No platform fee has been paid yet.</p>}
          {d.fees?.splitter && <p className="st-note">The FeeSplitter on Ethereum, <code><DecryptedText text={d.fees.splitter.address} animateOn="view" sequential speed={18} characters="0123456789abcdef" /></code>: <a href={d.fees.splitter.events} target="_blank" rel="noreferrer">its events on Etherscan ↗</a>.</p>}
        </div>
      </PxSection>

      <PxSection kicker="FLOWS" title="Where the money goes" id="flows">
        <section className="st-panel">{(d.flows ?? []).length ? <ol className="st-steps">{d.flows.map((f) => <li key={f}>{f}</li>)}</ol> : <p className="st-empty">—</p>}</section>
      </PxSection>

      <PxSection kicker="PUBLIC MCP" title="Agents" id="agents" more={{ to: "/agents", label: "CONNECT AN AGENT" }}>
        <div className="tl-stack">
          <PxStats cols={4}>
            <PxStat label="MCP sessions" value={<PxNum value={a?.mcpSessions} />} sub="connections" />
            <PxStat label="Tool calls" value={<PxNum value={a?.toolCalls} />} sub="the useful work" tone="lime" />
            <PxStat label="Probe sessions" value={<PxNum value={a?.probeSessions} />} sub="directories, scanners, health checks" />
            <PxStat label="Operators" value={<PxNum value={a?.operators?.registered} />} sub={`${count(a?.operators?.active)} active crews`} />
          </PxStats>
          {d.definitions?.probeSessions && <p className="st-note">{d.definitions.probeSessions}</p>}
          {clients.length > 0 && (
            <div className="st-table-wrap">
              <table className="st-table">
                <thead><tr><th>Client the agent announced</th><th className="cr-num">Sessions</th><th>Kind</th></tr></thead>
                <tbody>{clients.map((x) => <tr key={x.name}><td className="mono">{x.name}</td><td className="cr-num">{count(x.count)}</td><td>{x.probe ? <span className="cr-tag dim">probe</span> : <span className="cr-tag">agent</span>}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      </PxSection>

      <PxSection kicker="WORDS" title="Definitions" id="definitions">
        <section className="st-panel">
          {Object.keys(d.definitions ?? {}).length ? <dl className="cr-kv">{Object.entries(d.definitions).map(([k, v]) => <Fragment key={k}><dt>{words(k)}</dt><dd>{v}</dd></Fragment>)}</dl> : <p className="st-empty">—</p>}
        </section>
      </PxSection>
    </>
  );
}

export function ProofPage({ health }: { health: Health | null }) {
  const d = useLoad(api.proof, [], 60_000);
  const c = d.data?.payments?.customer;
  return (
    <div className="st-room cr-room tl tl-proof">
      <div className="tl-in">
        <ToolHero docTitle="Proof" trail={[{ label: "proof" }]} kicker="PROOF · FROM THE BOOKS" title="Proof." accent="Receipts, not promises." tone="lime" live={!!d.data}
          lead="What actually happened, counted from the books: who paid, what was left out and why, what the crews did, the known costs and the fees. There is no profit figure: not every cost is measured."
          actions={<>
            <StarBorder as="a" href="#payments" className="tl-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)"><PxIcon name="pulse" size={14} />CUSTOMER PAYMENTS</StarBorder>
            <a className="px-btn ghost" href="#fees"><PxIcon name="coin" size={14} />FEES AND BURNS</a>
            <a className="px-btn ghost" href="#flows"><PxIcon name="link" size={14} />WHERE THE MONEY GOES</a>
          </>}
          aside={<PxPanel title="OBSERVATION PERIOD" state={d.data ? "live" : "idle"} right="EVERY 60 S">
            {d.data ? <Period d={d.data} /> : <p className="st-empty">{d.error ? "The books did not load." : "Reading the books…"}</p>}
          </PxPanel>} />
        <PxStats cols={3}>
          <PxStat label="Customer revenue" value={d.data ? price(c?.revenueUsd) : "—"} sub="outside wallets, USDC" tone="lime" />
          <PxStat label="Paying wallets" value={d.data ? <PxNum value={c?.wallets} /> : "—"} sub={d.data ? `${count(c?.repeatWallets)} repeat` : undefined} />
          <PxStat label="Known costs" value={d.data ? price((d.data.knownCosts?.aiUsd ?? 0) + (d.data.knownCosts?.swarmUsdAtTodaysPrice ?? 0)) : "—"} sub={d.data?.knownCosts?.swarmUsdAtTodaysPrice == null ? "AI only: the IMD spent has no USD price today" : "AI + IMD at today's price"} tone="gold" />
        </PxStats>
        <div className="tl-body">
          <SimNote health={health} />
          <Pending load={d} what="The books" />
          {d.data && <Body d={d.data} />}
        </div>
      </div>
    </div>
  );
}
