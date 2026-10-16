import { useEffect, useState } from "react";

type T = {
  on: boolean; symbol: string; address: string | null; buyUrl: string | null; holderMin: number;
  platformFeeBps: number; feesCollectedUsd: number; bought: { usd: number; amount: number };
  buybacks: { at: number; tx: string; usd: number; amount: number; note?: string }[]; mode: string;
};

/** What the platform token does here, with every number checkable. */
export function TokenPage() {
  const [t, setT] = useState<T | null>(null);
  useEffect(() => { fetch("/api/token").then((r) => r.json()).then(setT).catch(() => {}); }, []);
  const sym = t?.on ? t.symbol : "the token";
  return (
    <div className="docs">
      <h1>Token</h1>
      <p className="lead">{t?.on ? `${t.symbol} is the NIGHTSHIFT platform token. It is launched through IMD and trades against IMD.` : "The platform token is not launched yet. This is how it will work; nothing here is live until it is."}</p>

      {t?.on && (
        <div className="grid kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <div className="card kpi"><span>Platform fees collected</span><b>${t.feesCollectedUsd.toFixed(2)}</b></div>
          <div className="card kpi"><span>Spent on buybacks</span><b>${t.bought.usd.toFixed(2)}</b></div>
          <div className="card kpi"><span>{t.symbol} bought back</span><b>{t.bought.amount.toLocaleString()}</b></div>
        </div>
      )}

      <section className="card"><div className="card-b docs-b">
        <h4>What holding it does</h4>
        <ul>
          <li><b>No platform fee.</b> Owners who hold {t?.holderMin ? `${t.holderMin.toLocaleString()} ` : ""}{sym} keep 100% of their revenue when they withdraw. Others pay the platform fee{t?.platformFeeBps ? ` (${(t.platformFeeBps / 100).toFixed(2)}%)` : ""}. Checked onchain at each withdrawal.</li>
          <li><b>Featured in the market.</b> Holders' products are listed first on <a href="/market">/market</a>, where people and AI agents shop.</li>
        </ul>
        <h4>Where the fees go</h4>
        <ul>
          <li>Platform fees are used to buy {sym} back on its IMD pool. Every buyback is listed below with its transaction.</li>
          <li>Because the pool trades against IMD, each buyback first buys IMD: fee revenue becomes demand for IMD, not only for {sym}.</li>
        </ul>
        <h4>How it helps IMD</h4>
        <ul>
          <li>Every company pays the IMD swarm in IMD for each product, site and piece of research it orders.</li>
          <li>The token launch itself is an IMD launch: 10% of the supply goes to the IMD swarm, and trading pays the IMD launch fee.</li>
          <li>Buybacks route through IMD, as above.</li>
        </ul>
        <h4>What it is not</h4>
        <p>Not a share of NIGHTSHIFT, not a claim on revenue and not an investment. It has the uses above and nothing else is promised. Prices can go to zero.</p>
      </div></section>

      {t?.on && (
        <section className="card">
          <div className="card-h"><h3>Contract</h3>{t.buyUrl && <a className="btn primary" href={t.buyUrl} target="_blank" rel="noreferrer">Buy {t.symbol}</a>}</div>
          <div className="card-b"><a className="wallet" href={`https://etherscan.io/token/${t.address}`} target="_blank" rel="noreferrer">{t.address}</a></div>
        </section>
      )}
      {t?.on && (
        <section className="card">
          <div className="card-h"><h3>Buybacks</h3></div>
          {t.buybacks.length === 0 ? <div className="empty">None yet. The first one is published here with its transaction.</div> : (
            <table><thead><tr><th>Date</th><th className="r">USD</th><th className="r">{t.symbol}</th><th>Transaction</th></tr></thead>
              <tbody>{t.buybacks.map((b) => (
                <tr key={b.tx}><td className="mono">{new Date(b.at).toISOString().slice(0, 10)}</td><td className="r">${b.usd.toFixed(2)}</td><td className="r">{b.amount.toLocaleString()}</td>
                  <td><a className="mono" href={`https://etherscan.io/tx/${b.tx}`} target="_blank" rel="noreferrer">{b.tx.slice(0, 10)}…</a>{b.note ? ` · ${b.note}` : ""}</td></tr>
              ))}</tbody></table>
          )}
        </section>
      )}
    </div>
  );
}
