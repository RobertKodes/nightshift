import { Fragment } from "react";
import { type Health, type ProofView, api } from "../api";
import { Link } from "../router";
import { Stat } from "../station/Station";
import { SimNote } from "./CrewsPage";
import { Hero, Pending, count, day, pct, price, useLoad, when } from "./shared";

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
      <section className="st-panel">
        <h3>Observation period</h3>
        <dl className="cr-kv">
          <dt>Payments</dt><dd>{d.period?.payments ? <>from <b>{d.period.payments.from}</b> to <b>{d.period.payments.to}</b></> : "No payment recorded yet."}</dd>
          <dt>Agent usage</dt><dd>{d.period?.agentUsage ? <>from <b>{d.period.agentUsage.from}</b> to <b>{d.period.agentUsage.to}</b>{d.period.agentUsage.note ? `: ${d.period.agentUsage.note}` : ""}</> : "Not counted yet."}</dd>
          <dt>Generated</dt><dd>{d.generatedAt ? <><b>{d.generatedAt.slice(0, 16).replace("T", " ")}</b> UTC ({when(d.generatedAt)})</> : "—"}</dd>
        </dl>
      </section>

      <h2>Customer payments</h2>
      <p className="st-note">{d.definitions?.customer ?? "Payments from outside wallets only."}</p>
      <div className="st-stats wide">
        <Stat label="Paying wallets" value={count(c?.wallets)} note="distinct outside wallets" />
        <Stat label="Payments" value={count(c?.payments)} note={c ? `${count(c.houseServices)} house services · ${count(c.companyProducts)} company products` : undefined} />
        <Stat label="Revenue" value={price(c?.revenueUsd)} note="USDC, customer payments only" />
        <Stat label="Repeat wallets" value={count(c?.repeatWallets)} note="paid more than once" />
      </div>

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
            <tbody>{latest.map((p, i) => <tr key={`${p.at}-${i}`}><td className="dim">{day(p.at)} · {when(p.at)}</td><td style={{ whiteSpace: "normal", minWidth: 200 }}>{p.what}</td><td className="cr-num">{price(p.usd)}</td><td className="mono">{p.wallet}</td><td>{p.tx ? <a href={p.tx} target="_blank" rel="noreferrer">Basescan ↗</a> : <span className="dim">no tx recorded</span>}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="st-empty">No customer payment yet. Internal, owner, company-to-company and test payments are never listed here.</p>}

      <h2>Crew jobs</h2>
      {crews.length ? (
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th>Crew</th><th className="cr-num">Done</th><th className="cr-num">Failed</th><th className="cr-num">Success</th><th className="cr-num">Customer-paid</th><th className="cr-num">Paying wallets</th><th className="cr-num">Repeat</th><th className="cr-num">Revenue</th><th className="cr-num">Known cost</th></tr></thead>
            <tbody>{crews.map((x) => (
              <tr key={x.id}>
                <td><Link to={`/crews/${encodeURIComponent(x.id)}`}>{x.name}</Link> <span className={`cr-tag${x.house ? "" : " warn"}`}>{x.house ? "house" : "outside"}</span></td>
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
          <p className="st-note">{d.refunds?.note ?? "—"}</p>
        </section>
        <section className="st-panel">
          <h3>Known costs</h3>
          <dl className="cr-kv">
            <dt>IMD swarm</dt><dd><b>{(d.knownCosts?.swarmImd ?? 0).toLocaleString("en-US")}</b> IMD{d.knownCosts?.swarmUsdAtTodaysPrice != null ? <> (about <b>{price(d.knownCosts.swarmUsdAtTodaysPrice)}</b> at today's IMD price)</> : null}</dd>
            <dt>AI models</dt><dd><b>{price(d.knownCosts?.aiUsd)}</b> in USDC</dd>
            <dt>Not included</dt><dd>{d.knownCosts?.notIncluded ?? "—"}</dd>
          </dl>
          <p className="st-note svc-small">{d.definitions?.knownCosts ?? "Only costs the books record. No profit is shown because the costs are incomplete."}</p>
        </section>
      </div>

      <h2>Platform fees</h2>
      <div className="st-stats wide">
        <Stat label="Platform fees" value={price(d.fees?.platformUsd)} note="USDC, paid on withdrawals" />
        <Stat label="$SHIFT burned" value={count(d.fees?.burned?.shift)} />
        <Stat label="IMD burned" value={count(d.fees?.burned?.imd)} />
      </div>
      {fees.length ? (
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th>When</th><th className="cr-num">Fee</th><th>Transaction</th></tr></thead>
            <tbody>{fees.map((f, i) => <tr key={`${f.at}-${i}`}><td className="dim">{day(f.at)} · {when(f.at)}</td><td className="cr-num">{price(f.usd)}</td><td>{f.tx ? <a href={f.tx} target="_blank" rel="noreferrer">Basescan ↗</a> : <span className="dim">no tx recorded</span>}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="st-empty">No platform fee has been paid yet.</p>}
      {d.fees?.splitter && <p className="st-note">The FeeSplitter on Ethereum, <code>{d.fees.splitter.address}</code>: <a href={d.fees.splitter.events} target="_blank" rel="noreferrer">its events on Etherscan ↗</a>.</p>}

      <h2>Where the money goes</h2>
      <section className="st-panel">{(d.flows ?? []).length ? <ol className="cr-flows">{d.flows.map((f) => <li key={f}>{f}</li>)}</ol> : <p className="st-empty">—</p>}</section>

      <h2>Agents</h2>
      <div className="st-stats wide">
        <Stat label="MCP sessions" value={count(a?.mcpSessions)} note="connections" />
        <Stat label="Tool calls" value={count(a?.toolCalls)} note="the useful work" />
        <Stat label="Probe sessions" value={count(a?.probeSessions)} note="directories, scanners, health checks" />
        <Stat label="Operators" value={count(a?.operators?.registered)} note={`${count(a?.operators?.active)} active crews`} />
      </div>
      {d.definitions?.probeSessions && <p className="st-note">{d.definitions.probeSessions}</p>}
      {clients.length > 0 && (
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th>Client the agent announced</th><th className="cr-num">Sessions</th><th>Kind</th></tr></thead>
            <tbody>{clients.map((x) => <tr key={x.name}><td className="mono">{x.name}</td><td className="cr-num">{count(x.count)}</td><td>{x.probe ? <span className="cr-tag dim">probe</span> : <span className="cr-tag">agent</span>}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      <h2>Definitions</h2>
      <section className="st-panel">
        {Object.keys(d.definitions ?? {}).length ? <dl className="cr-kv">{Object.entries(d.definitions).map(([k, v]) => <Fragment key={k}><dt>{words(k)}</dt><dd>{v}</dd></Fragment>)}</dl> : <p className="st-empty">—</p>}
      </section>
    </>
  );
}

export function ProofPage({ health }: { health: Health | null }) {
  const d = useLoad(api.proof, [], 60_000);
  const c = d.data?.payments?.customer;
  return (
    <div className="st-room cr-room">
      <Hero room="economy" docTitle="Proof" trail={<>PROOF · FROM THE BOOKS</>} title="Proof"
        line="What actually happened, counted from the books: who paid, what was left out and why, what the crews did, the known costs and the fees. There is no profit figure: not every cost is measured.">
        <div className="st-stats">
          <Stat label="Customer revenue" value={d.data ? price(c?.revenueUsd) : "…"} note="outside wallets, USDC" />
          <Stat label="Paying wallets" value={d.data ? count(c?.wallets) : "…"} note={d.data ? `${count(c?.repeatWallets)} repeat` : undefined} />
          <Stat label="Known costs" value={d.data ? price((d.data.knownCosts?.aiUsd ?? 0) + (d.data.knownCosts?.swarmUsdAtTodaysPrice ?? 0)) : "…"} note={d.data?.knownCosts?.swarmUsdAtTodaysPrice == null ? "AI only: the IMD spent has no USD price today" : "AI + IMD at today's price"} />
        </div>
      </Hero>
      <div className="st-body">
        <SimNote health={health} />
        <Pending load={d} what="The books" />
        {d.data && <Body d={d.data} />}
      </div>
    </div>
  );
}
