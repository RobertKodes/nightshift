import { Link } from "./router";
import { PxHero, PxPanel } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { LxBg, useRich } from "./saas/pages/learn-kit";
import "./saas/pages/learn.css";
import { isSwapFee } from "./BenefitsCard";
import { finite, record, usePublicRead, type ReadState } from "./publicRead";
import { isSwarmStats } from "./swarmStats";

type Proof = { generatedAt: string; payments: { customer: { houseServices: number } }; agentReserve: { buys: unknown[] } };
const isProof = (v: unknown): v is Proof => record(v) && typeof v.generatedAt === "string" && record(v.payments) && record(v.payments.customer) && finite(v.payments.customer.houseServices) && record(v.agentReserve) && Array.isArray(v.agentReserve.buys);
type Overview = { staked: number | null };
const isOverview = (v: unknown): v is Overview => record(v) && (v.staked === null || finite(v.staked));
type Token = { mode: string; on: boolean; launch: { pool?: { fee?: number } } | null };
const isToken = (v: unknown): v is Token => record(v) && typeof v.mode === "string" && typeof v.on === "boolean" && (v.launch === null || record(v.launch));
type Services = { mode: string; network: string };
const isServices = (v: unknown): v is Services => record(v) && typeof v.mode === "string" && typeof v.network === "string";
const count = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function Reading({ read, value, empty, suffix = "" }: { read: ReadState<unknown>; value: unknown; empty: string; suffix?: string }) {
  if (read.state === "loading") return <span className="clarity-loading">Loading…</span>;
  if (read.state === "unavailable" || !finite(value)) return <span className="clarity-unavailable">Unavailable</span>;
  if (value === 0) return <span className="clarity-empty">{empty}</span>;
  return <b>{count(value)}{suffix}</b>;
}

/** Current public records, with no estimate in place of a missing read. */
export function HowItWorksPage() {
  const proof = usePublicRead("/api/proof", isProof);
  const swarm = usePublicRead("/api/v1/swarm/stats", isSwarmStats);
  const overview = usePublicRead("/api/token/overview", isOverview);
  const token = usePublicRead("/api/token", isToken);
  const services = usePublicRead("/api/v1/services", isServices);
  const fee = usePublicRead("/api/swap/fee", isSwapFee);
  const live = token.state === "ready" && token.data.mode === "live";
  const liveState: ReadState<unknown> = token.state === "loading" ? token : live ? { state: "ready", data: null } : { state: "unavailable" };
  const poolFee = live && token.state === "ready" && token.data.on ? token.data.launch?.pool?.fee : null;
  const rich = useRich();
  return <article className="lx lx-how">
    <PxHero kicker="NIGHTSHIFT · THE CONNECTIONS" title="How it" accent="works" live bg={<LxBg rich={rich} />} lead="Use the AI tools, play a game, or explore $SHIFT. A wallet is optional until you choose a paid or onchain action."
      aside={
        <aside className="px-term" aria-label="The three doors and where their money goes">
          <div className="px-term-h"><span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span><b>THREE DOORS</b><span className="px-term-state"><i />PUBLIC</span></div>
          <div className="px-term-body">
            <Link to="/services" className="px-term-row"><PxIcon name="bot" size={14} /><span className="px-term-k">AI tools<small>free previews, paid work</small></span><span className="px-term-v lime">USDC · BASE<i>&gt;</i></span></Link>
            <Link to="/games" className="px-term-row"><PxIcon name="play" size={14} /><span className="px-term-k">Play<small>free, stakes optional</small></span><span className="px-term-v">5% OF A STAKED POT<i>&gt;</i></span></Link>
            <Link to="/token" className="px-term-row"><PxIcon name="coin" size={14} /><span className="px-term-k">$SHIFT &amp; Frogs<small>perks, staking, NFT rewards</small></span><span className="px-term-v gold">FUNDED REWARDS<i>&gt;</i></span></Link>
          </div>
          <div className="px-term-f"><span>root@nightshift:~$</span><span>trace --payments</span><span className="px-term-cursor" aria-hidden="true" /></div>
        </aside>
      }
    />
    <section className="lx-sec" aria-labelledby="how-map">
    <div className="lx-sec-head"><div><span className="px-kicker">THE MAP</span><h2 className="px-h2" id="how-map">Three doors, three money paths.</h2><p className="px-sub">Where each payment goes, from the first click to the wallet that receives it.</p></div></div>
    <figure className="lx-flow" aria-label="AI tool payments fund work and an earned-revenue reserve; Ethereum game fees reach FeeSplitter; Frogs and stakers have separate funded rewards.">
      <div><Link to="/services"><b>AI tools</b><span>Free previews · paid work in USDC on Base</span></Link><span aria-hidden="true">↓</span><div><b>House sales</b><span>Swarm Desk credits wait for completion and exclude recorded job costs and refund obligations.</span></div><span aria-hidden="true">↓</span><div><b>Agent Reserve → team wallet</b><span>50% of net earned house customer revenue. At $25 or more, an enabled, funded reserve buys SHIFT through our swap.</span></div></div>
      <div><Link to="/games"><b>Play</b><span>Start free · choose token stakes later</span></Link><span aria-hidden="true">↓</span><div><b>Staked two-player games</b><span>95% of the pot to the winner · 5% to FeeSplitter. A draw refunds both stakes.</span></div><span aria-hidden="true">↓</span><div><b>FeeSplitter · Ethereum</b><span>Distributes received assets to rewards, dev, treasury and burn/reserve.</span></div></div>
      <div><Link to="/token"><b>$SHIFT & Frogs</b><span>Holder perks · optional staking and NFT rewards</span></Link><span aria-hidden="true">↓</span><div><b>Two reward paths</b><span>SHIFT stakers claim earned contract rewards. Frogs earn hours toward the Frog pot.</span></div><span aria-hidden="true">↓</span><div><b>Funded rewards</b><span>Frog claims need a funded pot, a posted epoch and a valid proof. Hours are weights, with no fixed token value.</span></div></div>
      <figcaption>Received FeeSplitter rewards → SHIFT stakers and the Frog pot. Base USDC sales do not automatically reach Ethereum's FeeSplitter. Agent Reserve purchases go to the team wallet; they are not holder payouts.</figcaption>
    </figure>
    </section>
    <section className="lx-sec" aria-labelledby="how-records"><PxPanel title="PUBLIC RECORDS" state={token.state === "loading" ? undefined : live ? "live" : "idle"} right="ENGINE + CHAIN READS"><h2 className="px-h2" id="how-records" style={{ marginTop: 0 }}>What the public records say</h2><p className="px-sub">These reads refresh every minute. Counts have different scopes: house customer payments exclude internal, owner, business-to-business and simulated sales; Swarm Desk delivery counts include all recorded desk jobs.</p>
      <dl className="lx-metrics" aria-live="polite">
        <div><dt>House customer payments · all recorded time</dt><dd><Reading read={live ? proof : liveState} value={proof.state === "ready" ? proof.data.payments.customer.houseServices : null} empty="No house customer payments recorded" /></dd></div>
        <div><dt>IMD agents online · upstream network</dt><dd><Reading read={live ? swarm : liveState} value={swarm.state === "ready" ? swarm.data.swarm.agentsOnline : null} empty="0 agents reported online" /></dd></div>
        <div><dt>Swarm Desk jobs delivered · all recorded time</dt><dd><Reading read={live ? swarm : liveState} value={swarm.state === "ready" ? swarm.data.desk.delivered : null} empty="No deliveries recorded" /></dd></div>
        <div><dt>SHIFT staked · latest available contract read</dt><dd><Reading read={live ? overview : liveState} value={overview.state === "ready" ? overview.data.staked : null} empty="No SHIFT staked" suffix=" SHIFT" /></dd></div>
        <div><dt>Completed Agent Reserve buys</dt><dd><Reading read={live ? proof : liveState} value={proof.state === "ready" ? proof.data.agentReserve.buys.length : null} empty="No completed buys recorded" /></dd></div>
      </dl>
      {proof.state === "ready" && live && <p className="clarity-source">Proof generated: {proof.data.generatedAt}. <Link to="/proof" className="lx-link">Open payments and purchase receipts →</Link></p>}
    </PxPanel></section>
    <section className="lx-sec lx-boxes" aria-label="Prices, fees and rewards">
    <PxPanel title="AI TOOLS"><div className="lx-prose"><h2>AI tools and holder prices</h2><p>House AI tools are paid in USDC on Base. The paying wallet gets half price on house checks and reports if it holds 500,000 SHIFT across wallet + staked, a NIGHT FROG, or a Night Watcher. Fast lookups have a $0.001 minimum. Swarm Desk jobs cost the full checked quote.</p><p className="clarity-status">{services.state === "loading" ? "Loading payment-network status…" : services.state === "unavailable" ? "Payment-network status unavailable." : services.data.mode !== "live" ? "This server reports simulation mode; paid service availability is not confirmed." : services.data.network === "eip155:8453" ? "Public service terms report live USDC payments on Base." : "The current payment network differs from Base. Review the service's terms before paying."}</p><p>SWARM MIND searches and answers from existing IMD publications for free. Research Desk adds a Markdown evidence report with checked source links, citation flags, coverage and gaps from the same published work. Swarm Desk commissions new work from IMD agents. <Link to="/services">Choose an AI tool →</Link></p></div></PxPanel>
    <PxPanel title="SWAP FEES"><div className="lx-prose"><h2>Swap fees and SHIFT trades</h2><p>{fee.state === "loading" ? "Loading the current NIGHTSHIFT swap fee…" : fee.state === "unavailable" || !live ? "Current NIGHTSHIFT swap fee unavailable." : fee.data.waived ? "The NIGHTSHIFT swap fee is waived for your signed-in holder session. The standard rate is not returned for this session." : fee.data.collect.lifi || fee.data.collect.relay ? `The current standard NIGHTSHIFT swap fee is ${fee.data.bps / 100}%, on routes where the provider collects it. The final route quote states the fee actually collected.` : "The swap reader reports no NIGHTSHIFT fee collection configured for either provider."} A signed-in wallet with 5M SHIFT across wallet + staked, a Frog or a Night Watcher qualifies for the NIGHTSHIFT fee waiver. Provider, bridge, gas and pool costs remain.</p><p>The SHIFT/ETH pool charges a pool fee{finite(poolFee) ? ` of ${poolFee / 10_000}% according to the current launch record` : " (current rate unavailable)"}. Hook fees can add to pool costs. Current hook tax rates are unavailable on this page. Review the swap's actual output quote before signing. A headline tax is not an all-in trading cost.</p><p><Link to="/swap">Review a swap quote →</Link></p></div></PxPanel>
    <PxPanel title="REWARDS" tone="gold"><div className="lx-prose"><h2>Rewards depend on received funds</h2><p>FeeSplitter's rewards branch is separate from house USDC sales. The Frog epoch builder accounts for half of the rewards emitted in its distribution events; the staking contract handles staker earnings. The current percentage breakdown is unavailable here; check distribution receipts for the received amounts. Unfunded rewards cannot be claimed.</p><p>Frogs stay in your wallet while the server records earned hours. Missions can add hours. Rewards depend on the pot's assets, the epoch posted by the team and your claim proof; there is no guaranteed payout or yield.</p><p><Link to="/stake">Stake SHIFT →</Link> <Link to="/frogs">Frog missions, upgrades & rewards →</Link> <Link to="/security">Contracts & security →</Link></p></div></PxPanel>
    </section>
    <section className="lx-sec"><nav className="lx-doornav" aria-label="Choose a door"><Link to="/services"><span><PxIcon name="bot" size={15} /> AI tools</span>→</Link><Link to="/games"><span><PxIcon name="play" size={15} /> Play</span>→</Link><Link to="/token"><span><PxIcon name="coin" size={15} /> $SHIFT</span>→</Link></nav></section>
  </article>;
}
