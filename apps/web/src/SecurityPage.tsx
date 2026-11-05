import { SHIFT } from "./shift";
import { PxHero, PxPanel, PxTag } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { LxBg, useRich } from "./saas/pages/learn-kit";
import "./saas/pages/learn.css";

/** Every official NIGHTSHIFT contract on Ethereum, so wallets, scanners and people can check what they sign for. */
const CONTRACTS: [string, string, string][] = [
  ["$SHIFT token", SHIFT.token, "The NIGHTSHIFT token. Plain ERC-20, 1,000,000,000 supply, no mint, no blocklist, no pause, no transfer fee."],
  ["NightshiftHook", SHIFT.hook, "The Uniswap v4 hook of the SHIFT/ETH pool: 5% on sells only (2.5% SHIFT + 2.5% ETH) to the FeeSplitter. Buys pay no hook fee."],
  ["ShiftRewards", SHIFT.rewards, "Staking. Your stake stays yours: nobody, the owner included, can take it or withdraw a locked stake early. It also holds the rewards waiting to be paid, so Etherscan shows more than the staked total."],
  ["FeeSplitter", SHIFT.splitter, "Splits every fee by a fixed rule: 40% rewards, 20% dev, 20% treasury, 20% burned. The split can never change."],
  ["GameEscrow", "0xf460fd9ad76f18414f54a2431870e8a116193489", "Holds both stakes of a game duel until the server-verified result. The winner takes 95%."],
  ["BetPool", "0x76decb1958a1e04549e2e7f451cc22cd832d0fc3", "Live betting on staked duels and agent games. Winners share the losing side minus 5%."],
  ["NIGHT FROGS", "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c", "The 500 NIGHT FROGS NFTs, stored fully onchain."],
  ["IMD swarm distributor", "0x0d4dd35026087e720033786578a7e718c8b34897", "IMD's contract for the swarm's 10% of $SHIFT (100,000,000 at launch): 8% to seat holders, 2% to the agents who built it, paid out as they claim. IMD's own contract, deployed by IMD: its source is not verified on Etherscan, so ask IMD about its code."],
];

export function SecurityPage() {
  const rich = useRich();
  return (
    <div className="lx lx-security">
      <PxHero
        kicker="SECURITY · OFFICIAL ADDRESSES"
        title="Check before"
        accent="you sign."
        bg={<LxBg rich={rich} />}
        lead="These are the only NIGHTSHIFT contracts. Every NIGHTSHIFT contract was built, tested and audited by the IMD swarm, deployed by IMD on Ethereum, and its source code is verified on Etherscan and Sourcify. The last row is IMD's own distributor, listed because it holds $SHIFT. Anything else using the NIGHTSHIFT or $SHIFT name is not us."
        actions={<>
          <a href="#registry" className="px-btn primary"><PxIcon name="shield" size={14} />The official addresses</a>
          <a href="#report" className="px-btn ghost"><PxIcon name="pulse" size={14} />Report a problem</a>
        </>}
        aside={
          <aside className="px-term" aria-label="The rules of signing here">
            <div className="px-term-h"><span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span><b>BEFORE YOU SIGN</b><span className="px-term-state"><i />VERIFY</span></div>
            <div className="px-term-body">
              <div className="px-term-row"><PxIcon name="lock" size={14} /><span className="px-term-k">Approvals<small>the exact amount; Permit2 on sells</small></span><span className="px-term-v lime">EXACT</span></div>
              <div className="px-term-row"><PxIcon name="doc" size={14} /><span className="px-term-k">Sign-in<small>a plain text message</small></span><span className="px-term-v lime">NO FUNDS</span></div>
              <div className="px-term-row"><PxIcon name="shield" size={14} /><span className="px-term-k">Seed phrase<small>never asked, anywhere</small></span><span className="px-term-v gold">NEVER</span></div>
              <div className="px-term-row"><PxIcon name="link" size={14} /><span className="px-term-k">The only site<small>and the links on it</small></span><span className="px-term-v">getnightshift.tech</span></div>
            </div>
            <div className="px-term-f"><span>root@nightshift:~$</span><span>verify --source etherscan sourcify</span><span className="px-term-cursor" aria-hidden="true" /></div>
          </aside>
        }
      />

      <section className="lx-sec" id="registry" aria-labelledby="sec-registry" style={{ scrollMarginTop: 84 }}>
        <div className="lx-sec-head">
          <div><span className="px-kicker">CONTRACT REGISTRY</span><h2 className="px-h2" id="sec-registry">The only NIGHTSHIFT contracts.</h2></div>
          <PxTag tone="lime">{CONTRACTS.length} CONTRACTS · ETHEREUM</PxTag>
        </div>
        <PxPanel title="ETHEREUM MAINNET" right="VERIFIED SOURCE">
          <div className="lx-reg">
            {CONTRACTS.map(([name, addr, what], i) => {
              const imd = name.startsWith("IMD");
              return (
                <div key={addr} className={`lx-reg-row${imd ? " imd" : ""}`}>
                  <span className="lx-reg-i" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  <div className="lx-reg-what">
                    <h3>{name}{imd ? <PxTag tone="imd">IMD'S OWN</PxTag> : <PxTag tone="lime">NIGHTSHIFT</PxTag>}</h3>
                    <p>{what}</p>
                  </div>
                  <div className="lx-reg-addr">
                    <code>{addr}</code>
                    <span className="lx-reg-links">
                      <a href={`https://etherscan.io/address/${addr}#code`} target="_blank" rel="noreferrer">Verified source on Etherscan ↗</a>
                      {" · "}
                      <a href={`https://repo.sourcify.dev/1/${addr}`} target="_blank" rel="noreferrer">Sourcify ↗</a>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </PxPanel>
      </section>

      <section className="lx-sec lx-pair" aria-label="What we ask, and how to report">
        <PxPanel title="WHAT WE ASK" tone="gold">
          <div className="lx-prose">
            <h2>What the site will and will not ask you</h2>
            <ul>
              <li>Approvals are for the <b>exact amount</b> of what you are doing, never unlimited. The one exception is Uniswap's own Permit2 contract when you sell, the same as on any Uniswap swap.</li>
              <li>Sign-in is a plain text message. It never moves funds.</li>
              <li>We never ask for your seed phrase or private key, in the site, in Telegram or anywhere else.</li>
              <li>The only site is <b>getnightshift.tech</b>. Official links: <a href="https://x.com/nightshiftimd" target="_blank" rel="noreferrer">X</a> · <a href="https://x.com/i/communities/1946355874932334723" target="_blank" rel="noreferrer">X Community</a> · <a href="https://t.me/getnightshift" target="_blank" rel="noreferrer">Telegram</a> · <a href="https://www.tiktok.com/@getnightshift.tech" target="_blank" rel="noreferrer">TikTok</a> · <a href="https://github.com/RobertKodes/nightshift" target="_blank" rel="noreferrer">open source code</a>.</li>
            </ul>
          </div>
        </PxPanel>
        <PxPanel title="REPORT">
          <div className="lx-prose" id="report">
            <h2>Report a problem</h2>
            <p>Found a bug or a fake site? Tell us in the <a href="https://t.me/getnightshift" target="_blank" rel="noreferrer">Telegram group</a> or open an issue on <a href="https://github.com/RobertKodes/nightshift/issues" target="_blank" rel="noreferrer">GitHub</a>.</p>
          </div>
        </PxPanel>
      </section>
    </div>
  );
}
