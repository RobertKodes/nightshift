import { LiveHoldings } from "./LiveHoldings";
import { DEV_WALLET, IMD_BURN, NIGHT_FROGS, RULE, TOKENOMICS, TREASURY_WALLET, TokenomicsBars, symbolOf, useToken } from "./landing/content";

const ether = (a: string) => `https://etherscan.io/address/${a}`;
const Addr = ({ a }: { a: string }) => <a className="mono" href={ether(a)} target="_blank" rel="noreferrer">{a}</a>;

/** The rule as one bar: the same four parts for every fee NIGHTSHIFT takes. */
export function RuleBar() {
  return (
    <div className="rule">
      <div className="rule-bar">{RULE.map((r) => <span key={r.k} className={r.k} style={{ width: `${r.pct}%` }}>{r.pct}%</span>)}</div>
      <div className="rule-legend">{RULE.map((r) => <div key={r.k}><i className={r.k} /><b>{r.pct}% · {r.label}</b><span>{r.note}</span></div>)}</div>
    </div>
  );
}

const where = (bps: number): [string, string, string][] => [
  ["Selling $SHIFT", "5% of the sell", "From the first trade"],
  ["Swap on NIGHTSHIFT", "0.25% of the swap, 0% for a NIGHT FROGS holder, a Night Watcher or 5M+ $SHIFT", "Live"],
  ["Company withdrawals (USDC)", `${bps / 100}% of the withdrawal (20% of it to the dev wallet, 80% to the treasury), 0% for $SHIFT and NIGHT FROGS holders`, "When companies go live"],
  ["Launchpad", "No launch fee: the creator pays IMD 0.5 IMD; buys through the swap carry the swap fee", "Live"],
  ["Game Room", "5% of each pot (the winner gets 95%)", "Live"],
  ["IMD bot premium", "Paid in $SHIFT", "Coming soon"],
];

const FROG_TIERS: [string, string][] = [["#1 · Zero-Sleep Captain", "50×"], ["Night Watchers · Gen 2", "10×–40×"], ["#2–25 · early Genesis", "3×"], ["#26–77 · Genesis", "2×"], ["#78–500", "1×"], ["Also holding an IMD seat", "everything 2×"]];

/** Tokenomics: every number, wallet, rule and power, in one place, with the risks said plainly. */
export function TokenomicsPage() {
  const t = useToken();
  const sym = symbolOf(t);
  const c = (t as unknown as { launch?: { contracts?: Record<string, string> } } | null)?.launch?.contracts;
  return (
    <div className="docs token-page tokenomics-page">
      <span className="eyebrow">TOKENOMICS</span>
      <h1>${sym}, in full. <em>Every number, every wallet, every rule.</em></h1>
      <p className="lead">What ${sym} is made of, where every fee goes and what each wallet can and cannot do. The rules below are written into the contracts: nobody can change them, us included.</p>

      <nav className="toc" aria-label="On this page">
        {[["supply", "Supply"], ["rule", "The one rule"], ["sell", "What a sell pays"], ["where", "Where the rule applies"], ["launch", "Launch day"], ["rewards", "Staking and frogs"], ["powers", "Who can change what"], ["wallets", "Wallets and contracts"], ["risks", "Risks"]].map(([id, l]) => <a key={id} href={`#${id}`}>{l}</a>)}
      </nav>

      <h2 id="supply" className="guide-h2">Supply</h2>
      <section className="tkn-card">
        <div className="token-specs">
          {[["Total supply", "1,000,000,000 · fixed"], ["Decimals", "18"], ["Chain", "Ethereum mainnet"], ["Pool", `Uniswap v4 · $${sym} / ETH`], ["Mint / pause / blacklist", "None, ever"], ["Built by", "IMD swarm · tested twice · 4 auditors + judge"]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
        </div>
        <TokenomicsBars />
      </section>
      {t?.on && t.address && <>
        <h3 className="guide-h3">Where every $SHIFT is right now</h3>
        <p className="dim">Read live from Ethereum, every minute. Click a row to check it on Etherscan.</p>
        <LiveHoldings token={t.address} contracts={c} />
      </>}
      <p className="dim">No presale, no private round, no team unlock schedule. At launch IMD seeded 88.89% of the supply in the pool, gave 10% to its swarm and 1.11% (11.1M) to the dev wallet. The treasury then made the first buy like anyone else: 0.91 ETH for 81.49M $SHIFT, paid into the pool. Both wallets are public; when part of them is staked with a lock, the bot announces it with the transaction.</p>

      <h2 id="rule" className="guide-h2">The one rule</h2>
      <p>Every fee NIGHTSHIFT takes, from any product and in any currency (ETH, ${sym}, IMD or USDC), is split the same way. The contract that splits it has the four destinations hard-coded.</p>
      <RuleBar />

      <h3 className="guide-h3">How the burn runs: the NIGHTSHIFT keeper</h3>
      <p>Every day at 03:00 UTC the NIGHTSHIFT keeper calls the fee splitter. First it splits what came in by the rule above. Then it takes the ETH burn reserve, buys IMD with it on Uniswap and sends that IMD straight to IMD's BurnExecutor, in the same transaction, with a minimum price so it cannot be sold short. $SHIFT is burned to 0x…dEaD directly. The keeper only pays gas: it cannot take or redirect a cent, because every destination is fixed in the splitter's code. Each burn is announced in the community with its transaction.</p>

      <h2 id="sell" className="guide-h2">What a sell pays</h2>
      <p>Buying ${sym} pays only the pool fee. Selling pays the pool fee and a 5% sell fee, taken half in ${sym} and half in ETH. Worked example, selling $1,000 of ${sym}:</p>
      <div className="frogs-traits">
        <div><b>$20.00</b><span>rewards: $10 to stakers, $10 to NIGHT FROGS holders</span></div>
        <div><b>$10.00</b><span>dev wallet</span></div>
        <div><b>$10.00</b><span>treasury</span></div>
        <div><b>$10.00</b><span>burned: $5 of ${sym} destroyed, $5 of ETH buys IMD that is burned</span></div>
        <div><b>$12.50</b><span>pool fee on every IMD launch: $10 to the wallet that paid the launch (the dev wallet), $2.50 to the IMD network</span></div>
      </div>
      <p className="dim">So, said plainly: on every sell the dev wallet receives 2% (1% of the sell fee's split plus the 1% pool fee), and on every buy 1% (the pool fee). Everything else goes to holders, the treasury and burns.</p>

      <h2 id="where" className="guide-h2">Where the rule applies</h2>
      <table className="plain"><thead><tr><th>Utility</th><th>Fee</th><th>Status</th></tr></thead>
        <tbody>{where(t?.platformFeeBps ?? 150).map(([a, b, s]) => <tr key={a}><td>{a}</td><td>{b}</td><td className={s.startsWith("Coming") ? "faint" : ""}>{s}</td></tr>)}</tbody></table>

      <h2 id="launch" className="guide-h2">Launch day</h2>
      <ul className="frogs-util">
        <li><b>IMD deploys</b> the token, the pool's hook, the fee splitter and the rewards contract, after its swarm built, tested and audited them. IMD's wallet only deploys: it gets no role and no tokens beyond the swarm's 10%.</li>
        <li><b>The first buy.</b> On launch night the treasury bought 81.49M $SHIFT for 0.91 ETH (<a href="https://etherscan.io/tx/0xf5a5ac372ea3fa89cc2f05372263b201e722da06c17f4ed07dc2c46bd5dcddfa" target="_blank" rel="noreferrer">the transaction</a>), which opened trading to everyone.</li>
        <li><b>Trading opens with one buy.</b> Until the treasury wallet {TREASURY_WALLET.slice(0, 6)}…{TREASURY_WALLET.slice(-4)} makes the first buy, the hook refuses every other swap. This stops bots from buying the first block. The moment that buy lands, trading opens to everyone, for good: nobody can close it again.</li>
        <li><b>Checked before it opens.</b> Between deploy and that first buy, NIGHTSHIFT checks the contracts on chain against this page. If anything is wrong, the first buy never happens and nobody can trade.</li>
        <li><b>The contract address</b> is published here, on Telegram and on X. Check any other address against this page.</li>
      </ul>

      <h2 id="rewards" className="guide-h2">Staking and NIGHT FROGS</h2>
      <div className="tkn-util two">
        <div className="tkn-u"><span>01</span><b>Stake ${sym}</b><p>Half of all rewards stream to stakers over 7 days, in ETH and ${sym}, split by how much you stake and for how long. Unstake any time, or lock up to two years. Locked stake cannot be withdrawn early.</p></div>
        <div className="tkn-u"><span>02</span><b>Hold NIGHT FROGS</b><p>The other half goes to frog holders each week, by shift hours: a wallet's total is cumulative and never resets, and each epoch (Mondays, 00:00 UTC) pays by the hours added since the last paid epoch. NIGHTSHIFT publishes the list, the dev wallet posts its proof on chain, and each holder claims their part. Unclaimed amounts return to the pot after 30 days.</p></div>
      </div>
      <table className="plain"><thead><tr><th>NIGHT FROGS</th><th>Shift hours per hour</th></tr></thead>
        <tbody>{FROG_TIERS.map(([a, b]) => <tr key={a}><td>{a}</td><td><b>{b}</b></td></tr>)}</tbody></table>

      <h2 id="powers" className="guide-h2">Who can change what</h2>
      <div className="tkn-util two">
        <div className="tkn-u"><span>CAN</span><b>The owner (dev wallet)</b><p>Lower the sell fee (never raise it above 5%). Post the weekly NIGHT FROGS list. Add ${sym} rewards for stakers. Change the keeper wallet that runs the daily split and IMD burn.</p></div>
        <div className="tkn-u"><span>CANNOT</span><b>Nobody, ever</b><p>Mint ${sym}, pause or block transfers, raise the fee, change the 40/20/20/20 split or its wallets, close trading once open, or touch staked ${sym} and rewards already earned.</p></div>
      </div>

      <h2 id="wallets" className="guide-h2">Wallets and contracts</h2>
      <table className="plain addr"><tbody>
        <tr><td>Dev wallet</td><td><Addr a={DEV_WALLET} /></td></tr>
        <tr><td>Treasury (first buyer)</td><td><Addr a={TREASURY_WALLET} /></td></tr>
        <tr><td>IMD burn (IMD's BurnExecutor)</td><td><Addr a={IMD_BURN} /></td></tr>
        <tr><td>${sym} burn</td><td><Addr a="0x000000000000000000000000000000000000dEaD" /></td></tr>
        <tr><td>NIGHT FROGS</td><td><Addr a={NIGHT_FROGS} /></td></tr>
        {t?.on && c ? Object.entries(c).map(([k, a]) => <tr key={k}><td>{({ token: `$${sym} token`, hook: "Pool hook", splitter: "Fee splitter", rewards: "Staking and rewards" } as Record<string, string>)[k] ?? k}</td><td><Addr a={a} /></td></tr>)
          : <tr><td>${sym} contracts</td><td className="faint">Published here when trading opens</td></tr>}
      </tbody></table>

      <h2 id="risks" className="guide-h2">Risks, plainly</h2>
      <ul className="frogs-util">
        <li><b>It can go to zero.</b> ${sym} is a utility token, not an investment, not a share of NIGHTSHIFT and not a claim on revenue.</li>
        <li><b>Sell fee.</b> Scanners will label ${sym} a "token with tax". The fee is 5% on sells only, can only go down, and every cent of it is accounted for above.</li>
        <li><b>Audit.</b> The contracts are audited by IMD's swarm (four specialist agents and a judge), not by an outside audit firm.</li>
        <li><b>Frog rewards rely on a published list.</b> The weekly list is computed by NIGHTSHIFT and posted by the dev wallet; anyone can check it against the shift hours shown on /frogs.</li>
        <li><b>Your rules.</b> Check what the law where you live says before you buy, stake or play.</li>
      </ul>
    </div>
  );
}
