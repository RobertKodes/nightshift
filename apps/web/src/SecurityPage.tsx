import { SHIFT } from "./shift";

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
  return (
    <div className="docs">
      <span className="eyebrow">SECURITY · OFFICIAL ADDRESSES</span>
      <h1>Check before you sign.</h1>
      <p className="lead">These are the only NIGHTSHIFT contracts. Every NIGHTSHIFT contract was built, tested and audited by the IMD swarm, deployed by IMD on Ethereum, and its source code is verified on Etherscan and Sourcify. The last row is IMD's own distributor, listed because it holds $SHIFT. Anything else using the NIGHTSHIFT or $SHIFT name is not us.</p>
      <section className="card"><div className="card-b docs-b">
        {CONTRACTS.map(([name, addr, what]) => (
          <div key={addr} style={{ padding: "12px 0", borderBottom: "1px solid var(--edge)" }}>
            <h4 style={{ margin: 0 }}>{name}</h4>
            <p className="mono" style={{ wordBreak: "break-all", margin: "6px 0" }}>{addr}</p>
            <p className="dim" style={{ margin: "0 0 6px" }}>{what}</p>
            <a href={`https://etherscan.io/address/${addr}#code`} target="_blank" rel="noreferrer">Verified source on Etherscan ↗</a>
            {" · "}
            <a href={`https://repo.sourcify.dev/1/${addr}`} target="_blank" rel="noreferrer">Sourcify ↗</a>
          </div>
        ))}
      </div></section>
      <section className="card"><div className="card-b docs-b">
        <h4>What the site will and will not ask you</h4>
        <ul>
          <li>Approvals are for the <b>exact amount</b> of what you are doing, never unlimited. The one exception is Uniswap's own Permit2 contract when you sell, the same as on any Uniswap swap.</li>
          <li>Sign-in is a plain text message. It never moves funds.</li>
          <li>We never ask for your seed phrase or private key, in the site, in Telegram or anywhere else.</li>
          <li>The only site is <b>getnightshift.tech</b>. Official links: <a href="https://x.com/nightshiftimd" target="_blank" rel="noreferrer">X</a> · <a href="https://t.me/getnightshift" target="_blank" rel="noreferrer">Telegram</a> · <a href="https://github.com/RobertKodes/nightshift" target="_blank" rel="noreferrer">open source code</a>.</li>
        </ul>
        <h4>Report a problem</h4>
        <p>Found a bug or a fake site? Tell us in the <a href="https://t.me/getnightshift" target="_blank" rel="noreferrer">Telegram group</a> or open an issue on <a href="https://github.com/RobertKodes/nightshift/issues" target="_blank" rel="noreferrer">GitHub</a>.</p>
      </div></section>
    </div>
  );
}
