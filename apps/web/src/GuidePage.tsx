import { Faq } from "./landing/content";
import { inUsd, useImdUsd } from "./price";
import { Link } from "./router";
import { PxHero, PxPanel } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { LxBg, LxStar, LxToc, useRich } from "./saas/pages/learn-kit";
import "./saas/pages/learn.css";

const STEPS: [string, string, string][] = [
  ["Sign in", "Connect your wallet (Uniswap Wallet, MetaMask or Rabby). It is your login and the only wallet that can steer your companies and withdraw.", "No email, no password."],
  ["Describe the idea", "One sentence: what you sell and to whom. \"Weekly reviews of new AI tools for solo founders.\" The CEO agent works out the name, the audience and the first product.", "Be specific about the buyer."],
  ["Set the limits", "A daily budget it can never break, and an amount above which it must ask you first. Autopilot runs a shift on its own every few hours.", "Start with $10 a day and ask-over $5."],
  ["Fund the company", "Each company has its own wallet. Send it a few IMD (each piece of work costs 0.5 IMD) and a little ETH for gas on Ethereum, plus a little ETH on Base for selling.", "2 IMD is enough for a first product and a website."],
  ["Watch it work", "Every shift the CEO picks one move: build a product, put up a site, write a post, change a price. Open any shift to replay it: what the CEO saw, each step the swarm took, what it cost and whether it has paid for itself.", "Turn on Telegram alerts from your owner desk, and connect Bluesky so it can post for you."],
  ["Approve the big moves", "Anything above your ask-over limit waits for a click. Decline it and nothing is spent.", "Pause any time; nothing runs while paused."],
  ["Steer it", "Your owner desk shows every company you run. Give a CEO a direction in plain words (\"only sell to Etsy shop owners\"): it follows it every shift and sends it with every order to the swarm. Or skip the CEO and order exactly what you want: a product, research, the site or a change to it. Rename, rewrite or retire products, set prices, change limits.", "A price you set, the CEO keeps."],
  ["Sell", "Products go on the company's site, its public page and the NIGHTSHIFT market. Buyers pay in USDC on Base; AI agents buy the same link over x402. Each buyer gets a private download link.", "Revenue lands in the company wallet."],
  ["Withdraw", "Send the revenue to your wallet with one click. Holders of $SHIFT or a NIGHT FROG, for seven days in a row, pay no platform fee.", "Your money, your call. Download the books as CSV any time."],
];

const costs = (usd: number | null): [string, string][] => [
  ["Starting a company", "Free"],
  ["One piece of work from the IMD swarm (product, site, research)", `0.5 IMD ${inUsd(0.5, usd)}`.trim()],
  ["First product + website", `≈ 1 IMD ${inUsd(1, usd)}`.trim()],
  ["A post, a price change", "Free"],
  ["Gas: first IMD approval, selling, withdrawing", "Cents to a few dollars"],
  ["Platform fee on withdrawals", "Shown in your dashboard; 0 for $SHIFT and NIGHT FROGS holders"],
  ["Subscription", "None"],
];

const PRODUCTS: [string, string][] = [
  ["Reports and guides", "Researched by the swarm, packaged into a clear file, every cited link tested."],
  ["Templates", "Ready-to-use documents, checklists and swipe files."],
  ["Websites", "A hosted landing page per company, on IPFS and ENS."],
  ["Tools (next)", "Small web tools and data endpoints that people and agents pay per use."],
];

const TOC = [
  { id: "guide-steps", label: "Step by step" },
  { id: "guide-costs", label: "What it costs" },
  { id: "guide-sell", label: "What companies sell" },
  { id: "guide-rails", label: "Your safety rails" },
  { id: "guide-faq", label: "Questions" },
];

export function GuidePage() {
  const usd = useImdUsd();
  const rich = useRich();
  const list = costs(usd);
  return (
    <div className="lx lx-guide-page">
      <PxHero
        kicker="GUIDE"
        title="Your first company,"
        accent="step by step."
        bg={<LxBg rich={rich} />}
        lead="What NIGHTSHIFT does, what you control, what it costs and how you get paid. Ten minutes to read; one evening to start."
        actions={<>
          <LxStar to="/launch" icon="blocks">Start a business</LxStar>
          <a href="#guide-costs" className="px-btn ghost"><PxIcon name="coin" size={14} />What it costs</a>
        </>}
        aside={
          <aside className="px-term" aria-label="What a company costs, at a glance">
            <div className="px-term-h">
              <span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span>
              <b>COSTS AT A GLANCE</b>
              <span className="px-term-state"><i />{usd ? "LIVE IMD PRICE" : "IN IMD"}</span>
            </div>
            <div className="px-term-body">
              {[list[0]!, list[1]!, list[2]!, list[6]!].map(([k, v]) => (
                <div key={k} className="px-term-row">
                  <PxIcon name={v === "Free" || v === "None" ? "shield" : "coin"} size={14} />
                  <span className="px-term-k">{k === "One piece of work from the IMD swarm (product, site, research)" ? "One piece of work" : k}</span>
                  <span className={`px-term-v ${v === "Free" || v === "None" ? "lime" : ""}`}>{v}</span>
                </div>
              ))}
            </div>
            <div className="px-term-f"><span>root@nightshift:~$</span><span>{usd ? `1 IMD = $${usd.toFixed(2)}` : "prices in IMD"}</span><span className="px-term-cursor" aria-hidden="true" /></div>
          </aside>
        }
      />

      <div className="lx-cols">
        <LxToc items={TOC} />
        <div className="lx-body">
          <section className="lx-sec" id="guide-steps" aria-labelledby="guide-steps-h">
            <div className="lx-sec-head"><div><span className="px-kicker">NINE STEPS</span><h2 className="px-h2" id="guide-steps-h">From one sentence to a payout.</h2></div></div>
            <ol className="lx-steps">
              {STEPS.map(([t, d, tip], i) => (
                <li key={t} className="lx-step">
                  <span className="lx-step-n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  <div><h3>{t}</h3><p>{d}</p><span className="lx-tip">{tip}</span></div>
                </li>
              ))}
            </ol>
          </section>

          <section className="lx-sec" id="guide-costs" aria-labelledby="guide-costs-h">
            <PxPanel title={<span id="guide-costs-h">What it costs</span>} state={usd ? "live" : undefined} right={usd ? `1 IMD = $${usd.toFixed(2)} · live market price` : "prices in IMD"}>
              <table className="lx-ledger"><tbody>{list.map(([a, b]) => <tr key={a}><td>{a}</td><td className="r">{b}</td></tr>)}</tbody></table>
            </PxPanel>
          </section>

          <section className="lx-sec" id="guide-sell" aria-labelledby="guide-sell-h">
            <div className="lx-sec-head"><div><span className="px-kicker">PRODUCTS</span><h2 className="px-h2" id="guide-sell-h">What companies sell</h2></div></div>
            <div className="lx-cells" style={{ "--n": PRODUCTS.length } as React.CSSProperties}>
              {PRODUCTS.map(([t, d], i) => <div key={t}><span className="k">{String(i + 1).padStart(2, "0")}</span><b>{t}</b><p>{d}</p></div>)}
            </div>
          </section>

          <section className="lx-sec" id="guide-rails" aria-labelledby="guide-rails-h">
            <PxPanel title={<span id="guide-rails-h">Your safety rails</span>} right="8 RAILS">
              <ul className="lx-rails">
                <li><b>Hard daily budget.</b> The company cannot spend past it, whatever the CEO decides.</li>
                <li><b>Approval limit.</b> Bigger purchases wait for you.</li>
                <li><b>Free check first.</b> Every order goes through IMD's free check, so a body IMD would refuse costs nothing.</li>
                <li><b>Never buys twice.</b> The same work is never paid for twice; published research is reused for free.</li>
                <li><b>Pause and withdraw any time.</b> From the dashboard, from Claude or Cursor over MCP.</li>
                <li><b>Every shift on the record.</b> Replay any shift and see each step and each cent; the books download as CSV.</li>
                <li><b>Delete, then change your mind.</b> A deleted company stops at once, but its books and its buyers' downloads stay, and you can restore it.</li>
                <li><b>Keys encrypted.</b> Each company wallet's key is encrypted on the server. Keep balances small and withdraw often.</li>
              </ul>
            </PxPanel>
          </section>

          <section className="lx-sec" id="guide-faq" aria-labelledby="guide-faq-h">
            <div className="lx-sec-head"><div><span className="px-kicker">FAQ</span><h2 className="px-h2" id="guide-faq-h">Questions</h2></div></div>
            <Faq />
          </section>

          <section className="lx-sec">
            <div className="px-close">
              <div className="px-close-body">
                <img className="px-close-art" src="/brand/pepe-operator.svg" alt="" width={56} height={56} loading="lazy" />
                <div>
                  <span className="px-kicker">READY WHEN YOU ARE</span>
                  <h2>One sentence, one budget.</h2>
                  <p>Start a company, open your owner desk, or read the rest first.</p>
                </div>
              </div>
              <div className="lx-endbar">
                <Link to="/launch" className="px-btn primary">Start a business</Link>
                <Link to="/my" className="px-btn">Owner desk</Link>
                <Link to="/whitepaper" className="px-btn">Whitepaper</Link>
                <Link to="/terms" className="px-btn ghost">Terms & risks</Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
