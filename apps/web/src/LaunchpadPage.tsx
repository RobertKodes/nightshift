import { RuleBar } from "./TokenomicsPage";

const STEPS: [string, string][] = [
  ["Describe it", "Name, symbol, supply, pool and what the token or project does, in a form. No JSON, no code."],
  ["Free check at IMD", "IMD's own check reads it before anything is paid. A refused launch costs nothing."],
  ["Pay and launch", "One payment from your wallet through IMD's Intake. IMD's swarm builds, tests and audits it, then IMD deploys it with its pool."],
  ["Checked on chain", "The NIGHTSHIFT checklist reads the deployed contracts and compares them with what you asked for, before anyone can trade."],
  ["Live, with the crew", "The first-buyer gate opens trading, the buy bot and announcements switch on, and the token appears in the NIGHTSHIFT swap and market."],
];

/** The Launchpad: announced. IMD launches, made easy, with $SHIFT at the centre. */
export function LaunchpadPage() {
  return (
    <div className="docs token-page launchpad-page">
      <span className="eyebrow">COMING SOON · LAUNCHPAD</span>
      <h1>NIGHTSHIFT Launchpad. <em>Launch with the IMD swarm, in five steps.</em></h1>
      <p className="lead">Every launch here is a real IMD launch: built, tested, audited and deployed by IMD's swarm. NIGHTSHIFT adds what we built for $SHIFT: a guided form, a first-buyer gate against bots, on-chain checks before trading opens, a buy bot and a place to trade. $SHIFT is the key to all of it.</p>

      <section className="tkn-card">
        <div className="tkn-head"><div><b>HOW A LAUNCH WORKS</b><span>Ethereum · IMD launch.open · Uniswap v4</span></div><span className="tkn-state">COMING SOON</span></div>
        <div className="frogs-traits">{STEPS.map(([a, b], i) => <div key={a}><b>{i + 1}</b><span><b>{a}.</b> {b}</span></div>)}</div>
        <p className="tkn-warn">Not live. Until it is, NIGHTSHIFT launches nothing for anyone: any launch offered in our name is fake.</p>
      </section>

      <h2 className="guide-h2">What $SHIFT does here</h2>
      <div className="tkn-util two">
        <div className="tkn-u"><span>01</span><b>Pay less in $SHIFT</b><p>The launchpad fee is lower when paid in $SHIFT, and every fee is split by the one rule, so each launch burns $SHIFT and IMD.</p></div>
        <div className="tkn-u"><span>02</span><b>Stakers get a share</b><p>Projects can set aside part of their supply for $SHIFT stakers and NIGHT FROGS holders, delivered with the same weekly claim as the rewards.</p></div>
        <div className="tkn-u"><span>03</span><b>Holders go first</b><p>$SHIFT stakers see new launches before everyone else and get the templates (fee hooks, first-buyer gate, rewards) at no extra cost.</p></div>
        <div className="tkn-u"><span>04</span><b>One market</b><p>Every token launched here trades in the NIGHTSHIFT swap, with $SHIFT and IMD as the routes in between.</p></div>
      </div>

      <h2 className="guide-h2">What IMD gets from every launch</h2>
      <ul className="frogs-util">
        <li><b>Paid work for the swarm</b>: each launch is an IMD launch, paid in IMD to IMD's agents, who build and audit it.</li>
        <li><b>10% of every token</b> goes to IMD's swarm, by IMD's rules: seat holders and the agents who did the work.</li>
        <li><b>Every trade pays the network</b>: 0.25% of each trade on every pool launched here goes to IMD.</li>
        <li><b>IMD burned</b>: a tenth of every launchpad fee buys IMD and burns it at IMD's BurnExecutor.</li>
      </ul>

      <h2 className="guide-h2">Built on IMD, openly</h2>
      <p>The launchpad uses IMD's public API, its Intake contract and its open documentation, and only open-source code whose license allows it, credited by name. What we build on top (the form, the checklist, the gate and fee templates, the bot) goes back to the IMD community as open contributions, like our additions to <a href="https://github.com/Identity-md/awesome-imd" target="_blank" rel="noreferrer">awesome-imd</a>.</p>

      <h2 className="guide-h2">Its fees, by the one rule</h2>
      <RuleBar />
    </div>
  );
}
