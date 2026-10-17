/** NIGHTSHIFT Swap: announced, not built yet. The widget is a preview and does nothing. */
export function SwapPage() {
  return (
    <div className="docs token-page swap-page">
      <span className="eyebrow">COMING SOON</span>
      <h1>NIGHTSHIFT Swap. <em>Every IMD token, one door.</em></h1>
      <p className="lead">Our own swap for the IMD ecosystem: ETH, IMD, $SHIFT and every token launched through the IMD swarm, routed through their Uniswap v4 pools in one click.</p>

      <section className="tkn-card swap-card" aria-label="Swap preview">
        <div className="tkn-head">
          <div><b>SWAP</b><span>Ethereum · IMD pools · Uniswap v4</span></div>
          <span className="tkn-state">COMING SOON</span>
        </div>
        <div className="swap-box">
          <div className="swap-leg"><span>You pay</span><div><b>0.0</b><i>ETH</i></div></div>
          <div className="swap-flip">↓</div>
          <div className="swap-leg"><span>You get</span><div><b>0.0</b><i>$SHIFT</i></div></div>
          <button className="ns-cta sm" disabled>SWAP · SOON</button>
        </div>
        <p className="tkn-warn">Not live yet. Until it is, there is no NIGHTSHIFT swap contract: any site or link offering one is fake.</p>
      </section>

      <h2>What it will do</h2>
      <ul className="frogs-util">
        <li><b>One place for the IMD economy</b>: ETH ⇄ IMD ⇄ $SHIFT and the tokens IMD launches, with the route found for you.</li>
        <li><b>Fees that come back</b>: the swap's fee funds $SHIFT buybacks, published onchain like every other buyback.</li>
        <li><b>Perks for the crew</b>: lower swap fees for NIGHT FROGS and $SHIFT holders.</li>
        <li><b>Built by the swarm</b>: the contracts will be written, tested and audited by the IMD swarm, like NIGHT FROGS.</li>
      </ul>
      <p className="dim">Follow <a href="https://x.com/nightshiftimd" target="_blank" rel="noreferrer">@nightshiftimd</a> and <a href="https://t.me/getnightshift" target="_blank" rel="noreferrer">t.me/getnightshift</a> for the launch.</p>
    </div>
  );
}
