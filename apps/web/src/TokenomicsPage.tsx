import { LiveHoldings } from "./LiveHoldings";
import { DEV_WALLET, IMD_BURN, NIGHT_FROGS, RULE, TOKENOMICS, TREASURY_WALLET, TokenomicsBars, symbolOf, useToken } from "./landing/content";
import DecryptedText from "./rb/DecryptedText";
import { PxButton, PxHero, PxNum, PxPanel, PxSection, PxStat, PxStats } from "./saas/kit";
import { Flap, HeroDots, ShStar } from "./saas/pages/shift-kit";
import "./saas/pages/tokenomics.css";

const ether = (a: string) => `https://etherscan.io/address/${a}`;
/** An address decrypts in as it scrolls into view: every wallet on this page is a link to Etherscan. */
const Addr = ({ a }: { a: string }) => <a className="mono tkm-addr" href={ether(a)} target="_blank" rel="noreferrer" aria-label={a}><DecryptedText text={a} animateOn="view" sequential revealDirection="start" speed={14} characters="0123456789abcdef" aria-hidden="true" /></a>;

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
const TOC: [string, string][] = [["supply", "Supply"], ["rule", "The one rule"], ["sell", "What a sell pays"], ["where", "Where the rule applies"], ["launch", "Launch day"], ["rewards", "Staking and frogs"], ["powers", "Who can change what"], ["wallets", "Wallets and contracts"], ["risks", "Risks"]];

/** Tokenomics: every number, wallet, rule and power, in one place, with the risks said plainly. */
export function TokenomicsPage() {
  const t = useToken();
  const sym = symbolOf(t);
  const c = (t as unknown as { launch?: { contracts?: Record<string, string> } } | null)?.launch?.contracts;
  const pool = TOKENOMICS.find((x) => x.k === "pool")?.pct, swarm = TOKENOMICS.find((x) => x.k === "imd")?.pct, dev = TOKENOMICS.find((x) => x.k === "dev")?.pct;
  const board = (
    <PxPanel className="sh-board tkm-board" title="THE ONE RULE · HARD-CODED" state={t?.on ? "live" : "idle"}>
      <span className="sh-board-k">EVERY FEE, ANY CURRENCY, SPLIT</span>
      <div className="sh-flap-wrap"><Flap text={RULE.map((r) => r.pct).join("/")} size={26} /></div>
      <div className="tkm-rule-rows">{RULE.map((r) => <a key={r.k} href="#rule" className={r.k}><i /><b>{r.pct}%</b><span>{r.label}</span></a>)}</div>
      <p className="sh-line">The fee splitter has the four destinations written into its code: nobody can change them, us included.</p>
    </PxPanel>
  );
  return (
    <div className="sh sh-tokenomics">
      <PxHero
        kicker="TOKENOMICS"
        live={Boolean(t?.on)}
        title={<>${sym}, in full.</>}
        accent="Every number, every wallet, every rule."
        lead={<>What ${sym} is made of, where every fee goes and what each wallet can and cannot do. <b>The rules below are written into the contracts: nobody can change them, us included.</b></>}
        actions={<>
          <ShStar href="#rule" icon="pulse">THE ONE RULE</ShStar>
          <PxButton to="/token" icon="coin">${sym} HUB</PxButton>
          <a href="#risks" className="px-btn ghost">RISKS, PLAINLY</a>
        </>}
        aside={board}
        bg={<HeroDots />}
      />

      <PxStats cols={4}>
        <PxStat label="Total supply · fixed" value={<PxNum value={1_000_000_000} compact />} sub="minted once · no mint, pause or blacklist" />
        <PxStat label="Seeded in the pool" tone="lime" value={<PxNum value={pool} decimals={2} suffix="%" />} sub="Uniswap v4, paired with ETH" />
        <PxStat label="IMD swarm" tone="imd" value={<PxNum value={swarm} suffix="%" />} sub={`dev wallet ${dev ?? "—"}% · no presale, no team unlock`} />
        <PxStat label="Sell fee" tone="gold" value={<PxNum value={5} suffix="%" />} sub="sells only · can only go down" />
      </PxStats>

      <nav className="sh-chips" aria-label="On this page">{TOC.map(([id, l], i) => <a key={id} href={`#${id}`}><b>0{i + 1}</b>{l}</a>)}</nav>

      <PxSection kicker="01 · SUPPLY" title={<>One billion, <em>fixed.</em></>} id="supply">
        <PxPanel title={`$${sym} · ERC-20 · ETHEREUM MAINNET`} state={t?.on ? "live" : "idle"}>
          <div className="token-specs">
            {[["Total supply", "1,000,000,000 · fixed"], ["Decimals", "18"], ["Chain", "Ethereum mainnet"], ["Pool", `Uniswap v4 · $${sym} / ETH`], ["Mint / pause / blacklist", "None, ever"], ["Built by", "IMD swarm · tested twice · 4 auditors + judge"]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
          </div>
          <TokenomicsBars />
        </PxPanel>
        {t?.on && t.address && <PxPanel title="WHERE EVERY $SHIFT IS RIGHT NOW" state="live" right="READ EVERY MINUTE">
          <p className="sh-line">Read live from Ethereum, every minute. Click a row to check it on Etherscan.</p>
          <div className="sh-table tkm-holdings"><LiveHoldings token={t.address} contracts={c} /></div>
        </PxPanel>}
        <p className="sh-note">No presale, no private round, no team unlock schedule. At launch IMD seeded 88.89% of the supply in the pool, gave 10% to its swarm and 1.11% (11.1M) to the dev wallet. The treasury then made the first buy like anyone else: 0.91 ETH for 81.49M $SHIFT, paid into the pool. Both wallets are public; when part of them is staked with a lock, the bot announces it with the transaction.</p>
      </PxSection>

      <PxSection kicker="02 · THE ONE RULE" title={<>Every fee, <em>split the same way.</em></>} id="rule" sub={<>Every fee NIGHTSHIFT takes, from any product and in any currency (ETH, ${sym}, IMD or USDC), is split the same way. The contract that splits it has the four destinations hard-coded.</>}>
        <PxPanel title="40 · 20 · 20 · 20" tone="gold">
          <RuleBar />
        </PxPanel>
        <PxPanel title="HOW THE BURN RUNS · THE NIGHTSHIFT KEEPER" right="DAILY · 03:00 UTC">
          <p className="sh-line">Every day at 03:00 UTC the NIGHTSHIFT keeper calls the fee splitter. First it splits what came in by the rule above. Then it takes the ETH burn reserve, buys IMD with it on Uniswap and sends that IMD straight to IMD's BurnExecutor, in the same transaction, with a minimum price so it cannot be sold short. $SHIFT is burned to 0x…dEaD directly. The keeper only pays gas: it cannot take or redirect a cent, because every destination is fixed in the splitter's code. Each burn is announced in the community with its transaction.</p>
        </PxPanel>
      </PxSection>

      <PxSection kicker="03 · WHAT A SELL PAYS" title={<>A $1,000 sell, <em>itemised.</em></>} id="sell" sub={<>Buying ${sym} pays only the pool fee. Selling pays the pool fee and a 5% sell fee, taken half in ${sym} and half in ETH. Worked example, selling $1,000 of ${sym}:</>}>
        <div className="tkm-receipt" aria-label={`Worked example: selling $1,000 of $${sym}`}>
          <header><span>RECEIPT · WORKED EXAMPLE</span><b>SELL $1,000.00 OF ${sym}</b></header>
          <div className="frogs-traits">
            <div><b>$20.00</b><span>rewards: $10 to stakers, $10 to NIGHT FROGS holders</span></div>
            <div><b>$10.00</b><span>dev wallet</span></div>
            <div><b>$10.00</b><span>treasury</span></div>
            <div><b>$10.00</b><span>burned: $5 of ${sym} destroyed, $5 of ETH buys IMD that is burned</span></div>
            <div><b>$12.50</b><span>pool fee on every IMD launch: $10 to the wallet that paid the launch (the dev wallet), $2.50 to the IMD network</span></div>
          </div>
          <footer><span>root@nightshift:~$ verify --onchain</span><span>RECEIPTS, NOT PROMISES</span></footer>
        </div>
        <p className="sh-note">So, said plainly: on every sell the dev wallet receives 2% (1% of the sell fee's split plus the 1% pool fee), and on every buy 1% (the pool fee). Everything else goes to holders, the treasury and burns.</p>
      </PxSection>

      <PxSection kicker="04 · WHERE THE RULE APPLIES" title={<>Every utility, <em>one rule.</em></>} id="where">
        <div className="sh-table"><table className="plain"><thead><tr><th>Utility</th><th>Fee</th><th>Status</th></tr></thead>
          <tbody>{where(t?.platformFeeBps ?? 150).map(([a, b, s]) => <tr key={a}><td><b>{a}</b></td><td>{b}</td><td><span className={`tkm-status${s.startsWith("Coming") ? " soon" : s === "Live" || s.startsWith("From") ? " live" : ""}`}>{s}</span></td></tr>)}</tbody></table></div>
      </PxSection>

      <PxSection kicker="05 · LAUNCH DAY" title={<>Opened with <em>one buy.</em></>} id="launch">
        <ul className="sh-grid">
          <li><b>IMD deploys</b> the token, the pool's hook, the fee splitter and the rewards contract, after its swarm built, tested and audited them. IMD's wallet only deploys: it gets no role and no tokens beyond the swarm's 10%.</li>
          <li><b>The first buy.</b> On launch night the treasury bought 81.49M $SHIFT for 0.91 ETH (<a href="https://etherscan.io/tx/0xf5a5ac372ea3fa89cc2f05372263b201e722da06c17f4ed07dc2c46bd5dcddfa" target="_blank" rel="noreferrer">the transaction</a>), which opened trading to everyone.</li>
          <li><b>Trading opens with one buy.</b> Until the treasury wallet {TREASURY_WALLET.slice(0, 6)}…{TREASURY_WALLET.slice(-4)} makes the first buy, the hook refuses every other swap. This stops bots from buying the first block. The moment that buy lands, trading opens to everyone, for good: nobody can close it again.</li>
          <li><b>Checked before it opens.</b> Between deploy and that first buy, NIGHTSHIFT checks the contracts on chain against this page. If anything is wrong, the first buy never happens and nobody can trade.</li>
          <li><b>The contract address</b> is published here, on Telegram and on X. Check any other address against this page.</li>
        </ul>
      </PxSection>

      <PxSection kicker="06 · STAKING AND NIGHT FROGS" title={<>Half to stakers, <em>half to frogs.</em></>} id="rewards" more={{ to: "/stake", label: "Stake" }}>
        <ul className="sh-grid">
          <li><b>01 · Stake ${sym}</b>Half of all rewards stream to stakers over 7 days, in ETH and ${sym}, split by how much you stake and for how long. Unstake any time, or lock up to two years. Locked stake cannot be withdrawn early.</li>
          <li><b>02 · Hold NIGHT FROGS</b>The other half goes to frog holders each week, by shift hours: a wallet's total is cumulative and never resets, and each epoch (Mondays, 00:00 UTC) pays by the hours added since the last paid epoch. NIGHTSHIFT publishes the list, the dev wallet posts its proof on chain, and each holder claims their part. Unclaimed amounts return to the pot after 30 days.</li>
        </ul>
        <div className="sh-table tkm-tiers"><table className="plain"><thead><tr><th>NIGHT FROGS</th><th>Shift hours per hour</th></tr></thead>
          <tbody>{FROG_TIERS.map(([a, b]) => <tr key={a}><td>{a}</td><td><b>{b}</b></td></tr>)}</tbody></table></div>
      </PxSection>

      <PxSection kicker="07 · WHO CAN CHANGE WHAT" title={<>Powers, <em>in writing.</em></>} id="powers">
        <div className="tkm-powers">
          <PxPanel title="CAN · THE OWNER (DEV WALLET)" tone="gold">
            <p className="sh-line">Lower the sell fee (never raise it above 5%). Post the weekly NIGHT FROGS list. Add ${sym} rewards for stakers. Change the keeper wallet that runs the daily split and IMD burn.</p>
          </PxPanel>
          <PxPanel title="CANNOT · NOBODY, EVER">
            <p className="sh-line">Mint ${sym}, pause or block transfers, raise the fee, change the 40/20/20/20 split or its wallets, close trading once open, or touch staked ${sym} and rewards already earned.</p>
          </PxPanel>
        </div>
      </PxSection>

      <PxSection kicker="08 · WALLETS AND CONTRACTS" title={<>Every wallet, <em>public.</em></>} id="wallets">
        <div className="sh-table tkm-wallets"><table className="plain addr"><tbody>
          <tr><td>Dev wallet</td><td><Addr a={DEV_WALLET} /></td></tr>
          <tr><td>Treasury (first buyer)</td><td><Addr a={TREASURY_WALLET} /></td></tr>
          <tr><td>IMD burn (IMD's BurnExecutor)</td><td><Addr a={IMD_BURN} /></td></tr>
          <tr><td>${sym} burn</td><td><Addr a="0x000000000000000000000000000000000000dEaD" /></td></tr>
          <tr><td>NIGHT FROGS</td><td><Addr a={NIGHT_FROGS} /></td></tr>
          {t?.on && c ? Object.entries(c).map(([k, a]) => <tr key={k}><td>{({ token: `$${sym} token`, hook: "Pool hook", splitter: "Fee splitter", rewards: "Staking and rewards" } as Record<string, string>)[k] ?? k}</td><td><Addr a={a} /></td></tr>)
            : <tr><td>${sym} contracts</td><td className="faint">Published here when trading opens</td></tr>}
        </tbody></table></div>
      </PxSection>

      <PxSection kicker="09 · RISKS, PLAINLY" title={<>What can <em>go wrong.</em></>} id="risks">
        <ul className="sh-grid tkm-risks">
          <li><b>It can go to zero.</b> ${sym} is a utility token, not an investment, not a share of NIGHTSHIFT and not a claim on revenue.</li>
          <li><b>Sell fee.</b> Scanners will label ${sym} a "token with tax". The fee is 5% on sells only, can only go down, and every cent of it is accounted for above.</li>
          <li><b>Audit.</b> The contracts are audited by IMD's swarm (four specialist agents and a judge), not by an outside audit firm.</li>
          <li><b>Frog rewards rely on a published list.</b> The weekly list is computed by NIGHTSHIFT and posted by the dev wallet; anyone can check it against the shift hours shown on /frogs.</li>
          <li><b>Your rules.</b> Check what the law where you live says before you buy, stake or play.</li>
        </ul>
      </PxSection>
    </div>
  );
}
