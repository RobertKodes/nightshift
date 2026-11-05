import { serviceLabel } from "../labels";
import { type Health, type WatchtowerInfo, api } from "../api";
import { Link } from "../router";
import { PaidOffers } from "../TryPaid";
import StarBorder from "../rb/StarBorder";
import { PxPanel, PxSection, PxStat, PxStats, PxTag } from "../saas/kit";
import { PxIcon } from "../saas/PxIcon";
import { SimNote } from "./CrewsPage";
import { WatchtowerTry } from "./samples";
import { BuyBox, MetricStats, Pending, PriceTable, ToolHero, itemsOf, price, useLoad, useServices } from "./shared";

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
    <div className="st-room cr-room tl tl-watch">
      <div className="tl-in">
        <ToolHero docTitle="Token monitor" trail={[{ to: "/crews", label: "crews" }, { label: "watchtower" }]} kicker="TOKEN MONITOR · ETHEREUM · UNISWAP V4" title="Token monitor." accent="Every change, with evidence."
          lead={p?.service ?? "Watches Ethereum tokens and Uniswap v4 hooks for changes to their rules, and shows the evidence for each change."}
          actions={<>
            <StarBorder as="a" href="#check" className="tl-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)"><PxIcon name="shield" size={14} />CHECK AN ADDRESS, FREE</StarBorder>
            <a className="px-btn ghost" href="#watch"><PxIcon name="pulse" size={14} />WATCH IT FOR 7 DAYS</a>
            <span className="svc-runby"><i />Operated by NIGHTSHIFT</span>
          </>}
          aside={<PxPanel title="EVERY REPORT NAMES" right="NEVER COUNTED AS FINE">
            <div className="tl-doors">
              <a href="#check"><PxTag tone="gold">CHANGE</PxTag><span><small>the value before and after, both blocks, the evidence</small></span></a>
              <a href="#check"><PxTag tone="red">COULD NOT RUN</PxTag><span><small>named in the report, never counted as fine</small></span></a>
              <a href="#covers"><PxTag tone="dim">NOT SUPPORTED</PxTag><span><small>listed apart, with what Token monitor covers</small></span></a>
            </div>
            <div className="tl-panel-f"><b>watch@nightshift:~$</b> check --chain ethereum<span className="tl-cursor" aria-hidden="true" /></div>
          </PxPanel>} />
        <PxStats cols={pricing.length ? Math.min(pricing.length, 2) + 1 : 2}>
          {pricing.slice(0, 2).map((r) => <PxStat key={r.offer} label={serviceLabel(r.label)} value={price(r.usd)} sub={`holders ${price(r.holderUsd)}`} tone="lime" />)}
          {!pricing.length && <PxStat label="Paid calls" value="—" sub={crew.data ? "not open yet" : undefined} />}
          <PxStat label="Sample" value="free" sub="one check, below" />
        </PxStats>
        <div className="tl-body">
          <SimNote health={health} />
          <PxSection kicker="FREE · ONE CHECK" title="Check an address, free" id="check" sub="Paste an ERC-20 token or a Uniswap v4 hook on Ethereum. The report lists every change with the value before and after, both blocks and the evidence; the checks that could not run and the ones Token monitor does not support are named, never counted as fine.">
            <WatchtowerTry />
          </PxSection>

          <PxSection kicker="WALLET · USDC ON BASE" title="Try it with your wallet" id="wallet">
            <PaidOffers ids={["watchtower-check", "watchtower-watch"]} />
          </PxSection>

          <PxSection kicker="SCOPE" title="What it covers" id="covers">
            <div className="tl-stack">
              <Pending load={info} what="What Token monitor supports" />
              {info.data && <Scope info={info.data} />}
            </div>
          </PxSection>

          <PxSection kicker="PREPAID · NO RENEWAL" title="Watch it for 7 days" id="watch">
            <div className="tl-stack">
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
            </div>
          </PxSection>

          <PxSection kicker="HTTP · MCP" title="Buy it as an agent" id="agent">
            {p ? <BuyBox p={p} /> : <Pending load={crew} what="The routes" />}
          </PxSection>

          <PxSection kicker="FROM THE JOB LEDGER" title="The numbers" id="numbers">
            <div className="tl-stack">
              {p ? <MetricStats m={crew.data?.metrics ?? p.metrics} /> : <Pending load={crew} what="Watchtower's numbers" />}
              <p className="st-note">Every job, free and paid, with its result: <Link to="/crews/watchtower">Token monitor delivery history</Link>. How the numbers are counted: <Link to="/proof">Proof</Link>.</p>
            </div>
          </PxSection>
        </div>
      </div>
    </div>
  );
}
