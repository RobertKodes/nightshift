import { type Health, type WatchtowerInfo, api } from "../api";
import { Link } from "../router";
import { PaidOffers } from "../TryPaid";
import { Stat } from "../station/Station";
import { SimNote } from "./CrewsPage";
import { WatchtowerTry } from "./samples";
import { BuyBox, Hero, MetricStats, Pending, PriceTable, itemsOf, price, useLoad, useServices } from "./shared";

/**
 * /watchtower: run the free check on an Ethereum token or Uniswap v4 hook and read the report
 * (every change with its blocks and evidence, the checks that could not run, the ones that are not
 * supported), what Watchtower covers, and how a paid 7-day watch works.
 */
function Scope({ info }: { info: WatchtowerInfo }) {
  const checks = itemsOf(info.supported ?? info.checks);
  const unsupported = itemsOf(info.unsupported);
  const limits = itemsOf(info.limits);
  const scope = typeof info.scope === "string" ? info.scope : null;
  const chain = typeof info.chain === "string" ? info.chain : Array.isArray(info.chains) ? info.chains.join(", ") : null;
  return (
    <>
      {(scope || chain) && <p className="st-note">{scope ?? `Supported chain: ${chain}.`}</p>}
      <div className="st-two">
        <section className="st-panel">
          <h3>Checks it runs <small>{checks.length}</small></h3>
          {checks.length ? <ul className="cr-limits">{checks.map((c) => <li key={c.id}><b>{c.label}</b>{c.detail ? <span className="dim">: {c.detail}</span> : null}</li>)}</ul> : <p className="st-empty">The server did not list its checks.</p>}
        </section>
        <section className="st-panel">
          <h3>Not supported <small>{unsupported.length}</small></h3>
          {unsupported.length ? <ul className="cr-limits">{unsupported.map((c) => <li key={c.id}><b>{c.label}</b>{c.detail ? <span className="dim">: {c.detail}</span> : null}</li>)}</ul> : <p className="st-empty">The server listed nothing as unsupported.</p>}
          {limits.length > 0 && (
            <>
              <h3>Limits</h3>
              <ul className="cr-limits">{limits.map((c) => <li key={c.id}>{c.detail && c.label !== c.detail ? <><b>{c.label}</b>: {c.detail}</> : c.label}</li>)}</ul>
            </>
          )}
        </section>
      </div>
    </>
  );
}

export function WatchtowerPage({ health }: { health: Health | null }) {
  const info = useLoad(api.watchtowerInfo, []);
  const crew = useLoad(() => api.crew("watchtower"), []);
  const svc = useServices();
  const p = crew.data?.profile ?? null;
  const pricing = p?.pricing ?? [];
  return (
    <div className="st-room cr-room">
      <Hero docTitle="Watchtower" trail={<><Link to="/crews">CREWS</Link> · WATCHTOWER</>} title="Watchtower"
        line={p?.service ?? "Watches Ethereum tokens and Uniswap v4 hooks for changes to their rules, and shows the evidence for each change."}>
        <span className="svc-runby"><i />Operated by NIGHTSHIFT</span>
        <div className="st-stats">
          {pricing.slice(0, 2).map((r) => <Stat key={r.offer} label={r.label} value={price(r.usd)} note={`holders ${price(r.holderUsd)}`} />)}
          {!pricing.length && <Stat label="Paid calls" value={crew.data ? "—" : "…"} note={crew.data ? "not open yet" : undefined} />}
          <Stat label="Sample" value="free" note="one check, below" />
        </div>
      </Hero>
      <div className="st-body">
        <SimNote health={health} />
        <h2>Check an address, free</h2>
        <p className="st-note">Paste an ERC-20 token or a Uniswap v4 hook on Ethereum. The report lists every change with the value before and after, both blocks and the evidence; the checks that could not run and the ones Watchtower does not support are named, never counted as fine.</p>
        <WatchtowerTry />

        <h2>Try it with your wallet</h2>
        <PaidOffers ids={["watchtower-check", "watchtower-watch"]} />

        <h2>What it covers</h2>
        <Pending load={info} what="What Watchtower supports" />
        {info.data && <Scope info={info.data} />}

        <h2>Watch it for 7 days</h2>
        <div className="st-two">
          <section className="st-panel">
            <h3>How a watch works</h3>
            <ol className="st-steps">
              <li><b>One prepaid term.</b> You pay once for the term in the table: no account, no subscription. The first run records the baseline every later run is compared with.</li>
              <li><b>Hourly checks.</b> Each run reads the contract again. A change comes with its severity, the value before and after, both blocks and the evidence; a check that stops answering is reported as lost coverage, never as "no change".</li>
              <li><b>Stop control.</b> You can stop a watch at any time; a stopped watch makes no more checks.</li>
              <li><b>Telegram, opt-in.</b> Alerts go to Telegram only if you link a chat. Otherwise read the reports over HTTP or MCP.</li>
              <li><b>No renewal.</b> When the term ends, the watch ends. Nothing is charged again unless you buy a new term.</li>
            </ol>
          </section>
          <section className="st-panel">
            <h3>Limits</h3>
            {p ? (p.limits ?? []).length ? <ul className="cr-limits">{p.limits.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="st-empty">No limits published.</p> : <Pending load={crew} what="The limits" />}
          </section>
        </div>
        {p ? <PriceTable p={p} holders={svc?.holders} /> : <Pending load={crew} what="The prices" />}

        <h2>Buy it as an agent</h2>
        {p ? <BuyBox p={p} /> : <Pending load={crew} what="The routes" />}

        <h2>The numbers</h2>
        {p ? <MetricStats m={crew.data?.metrics ?? p.metrics} /> : <Pending load={crew} what="Watchtower's numbers" />}
        <p className="st-note">Every job, free and paid, with its result: <Link to="/crews/watchtower">Watchtower's delivery history</Link>. How the numbers are counted: <Link to="/proof">Proof</Link>.</p>
      </div>
    </div>
  );
}
