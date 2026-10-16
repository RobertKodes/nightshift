import { Crescent } from "./landing/chrome";
import { FEE_SPLIT, IMD_WINS, TokenomicsBars, UTILITY, symbolOf, useToken } from "./landing/content";

/** $SHIFT: what it is, what it does, how it helps IMD, and every number that can be checked. */
export function TokenPage() {
  const t = useToken();
  const sym = symbolOf(t);
  const state = t?.on ? "LIVE" : t?.launch && !t.launch.error ? "LAUNCHING" : "COMING SOON";
  return (
    <div className="docs token-page">
      <span className="eyebrow">THE TOKEN</span>
      <h1>${sym}. <em>The fuel of the night shift.</em></h1>
      <p className="lead">The NIGHTSHIFT platform token, launched through IMD on Ethereum and traded only against IMD. It lowers what owners pay, puts their products in front, and turns platform fees into demand for ${sym} and for IMD.</p>

      <section className="tkn-card">
        <div className="tkn-head">
          <span className="tkn-coin"><Crescent size={34} /></span>
          <div><b>NIGHTSHIFT</b><span>${sym} · ERC-20 · Ethereum mainnet · paired with IMD</span></div>
          <span className={`tkn-state${t?.on ? " on" : ""}`}>{state}</span>
        </div>
        <div className="tkn-addr">
          <span>CONTRACT</span>
          {t?.on && t.address ? <a href={`https://etherscan.io/token/${t.address}`} target="_blank" rel="noreferrer">{t.address}</a> : <code>0x···· published here the moment IMD deploys it</code>}
          {t?.launch && !t.on && !t.launch.error && <span className="good" style={{ letterSpacing: 0 }}>{t.launch.stage}</span>}
        </div>
        <div className="token-specs">
          {[["Supply", "1,000,000,000 · fixed"], ["Decimals", "18"], ["Mint / owner", "None"], ["Transfer tax", "None"], ["Pool", "Uniswap v4 · $" + sym + " / IMD"], ["Launched by", "IMD swarm · audited by 4 agents"]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
        </div>
        <TokenomicsBars />
        <div className="tkn-fees">
          <span>EVERY TRADE · 1.25%</span>
          {FEE_SPLIT.map((x) => <div key={x.label}><b>{x.pct}%</b><span>{x.label}</span><p>{x.note}</p></div>)}
        </div>
        {t?.on && t.buyUrl && <a className="btn primary" href={t.buyUrl} target="_blank" rel="noreferrer">Buy ${sym} on Uniswap</a>}
      </section>

      <h2 className="guide-h2">What holding it does</h2>
      <div className="tkn-util">{UTILITY.map(([a, b], i) => <div key={a} className="tkn-u"><span>{String(i + 1).padStart(2, "0")}</span><b>{a}</b><p>{b}</p></div>)}</div>

      <h2 className="guide-h2">How it helps IMD</h2>
      <div className="tkn-util two">{IMD_WINS.map(([a, b], i) => <div key={a} className="tkn-u"><span>{String(i + 1).padStart(2, "0")}</span><b>{a}</b><p>{b}</p></div>)}</div>

      {t?.on && (
        <>
          <div className="grid kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <div className="card kpi"><span>Platform fees collected</span><b>${t.feesCollectedUsd.toFixed(2)}</b></div>
            <div className="card kpi"><span>Spent on buybacks</span><b>${t.bought.usd.toFixed(2)}</b></div>
            <div className="card kpi"><span>${sym} bought back</span><b>{t.bought.amount.toLocaleString()}</b></div>
          </div>
          <section className="card">
            <div className="card-h"><h3>Buybacks</h3></div>
            {t.buybacks.length === 0 ? <div className="empty">None yet. Each one is published here with its transaction.</div> : (
              <table><thead><tr><th>Date</th><th className="r">USD</th><th className="r">${sym}</th><th>Transaction</th></tr></thead>
                <tbody>{t.buybacks.map((b) => (
                  <tr key={b.tx}><td className="mono">{new Date(b.at).toISOString().slice(0, 10)}</td><td className="r">${b.usd.toFixed(2)}</td><td className="r">{b.amount.toLocaleString()}</td>
                    <td><a className="mono" href={`https://etherscan.io/tx/${b.tx}`} target="_blank" rel="noreferrer">{b.tx.slice(0, 10)}…</a>{b.note ? ` · ${b.note}` : ""}</td></tr>
                ))}</tbody></table>
            )}
          </section>
        </>
      )}

      <section className="card"><div className="card-b docs-b">
        <h4>What it is not</h4>
        <p>${sym} is a utility token. It is not a share of NIGHTSHIFT, not a claim on revenue and not an investment, and nothing beyond the uses above is promised. Crypto prices can go to zero. Check the rules where you live before you buy.</p>
      </div></section>
    </div>
  );
}
