import { Faq } from "./landing/content";
import { Emblem } from "./Emblem";
import { inUsd, useImdUsd } from "./price";
import { Link } from "./router";

const STEPS: [string, string, string][] = [
  ["Sign in", "Connect your wallet (MetaMask or Rabby). It is your login and the only wallet that can steer your companies and withdraw.", "No email, no password."],
  ["Describe the idea", "One sentence: what you sell and to whom. \"Weekly reviews of new AI tools for solo founders.\" The CEO agent works out the name, the audience and the first product.", "Be specific about the buyer."],
  ["Set the limits", "A daily budget it can never break, and an amount above which it must ask you first. Autopilot runs a shift on its own every few hours.", "Start with $10 a day and ask-over $5."],
  ["Fund the company", "Each company has its own wallet. Send it a few IMD (each piece of work costs 0.5 IMD) and a little ETH for gas on Ethereum, plus a little ETH on Base for selling.", "2 IMD is enough for a first product and a website."],
  ["Watch it work", "Every shift the CEO picks one move: build a product, put up a site, write a post, change a price. You see each decision, each cost and each result live on the dashboard.", "Connect Bluesky so it can post for you."],
  ["Approve the big moves", "Anything above your ask-over limit waits for a click. Decline it and nothing is spent.", "Pause any time; nothing runs while paused."],
  ["Sell", "Products go on the company's site, its public page and the NIGHTSHIFT market. Buyers pay in USDC on Base; AI agents buy the same link over x402. Each buyer gets a private download link.", "Revenue lands in the company wallet."],
  ["Withdraw", "Send the revenue to your wallet with one click. $SHIFT holders pay no platform fee.", "Your money, your call."],
];

const costs = (usd: number | null): [string, string][] => [
  ["Starting a company", "Free"],
  ["One piece of work from the IMD swarm (product, site, research)", `0.5 IMD ${inUsd(0.5, usd)}`.trim()],
  ["First product + website", `≈ 1 IMD ${inUsd(1, usd)}`.trim()],
  ["A post, a price change", "Free"],
  ["Gas: first IMD approval, selling, withdrawing", "Cents to a few dollars"],
  ["Platform fee on withdrawals", "Shown in your dashboard; 0 for $SHIFT holders"],
  ["Subscription", "None"],
];

const PRODUCTS: [string, string][] = [
  ["Reports and guides", "Researched by the swarm, packaged into a clear file, every cited link tested."],
  ["Templates", "Ready-to-use documents, checklists and swipe files."],
  ["Websites", "A hosted landing page per company, on IPFS and ENS."],
  ["Tools (next)", "Small web tools and data endpoints that people and agents pay per use."],
];

export function GuidePage() {
  const usd = useImdUsd();
  return (
    <div className="docs guide">
      <Emblem glyph="☾" label="THE GUIDE" />
      <span className="eyebrow">GUIDE</span>
      <h1>Your first company, <em>step by step.</em></h1>
      <p className="lead">What NIGHTSHIFT does, what you control, what it costs and how you get paid. Ten minutes to read; one evening to start.</p>

      <section className="guide-steps">
        {STEPS.map(([t, d, tip], i) => (
          <div key={t} className="card guide-step">
            <span className="guide-n">{String(i + 1).padStart(2, "0")}</span>
            <div><h3>{t}</h3><p>{d}</p><span className="guide-tip">{tip}</span></div>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-h"><h3>What it costs</h3><span className="faint mono" style={{ fontSize: 11 }}>{usd ? `IMD ≈ $${usd.toFixed(2)} · live` : "prices in IMD"}</span></div>
        <table><tbody>{costs(usd).map(([a, b]) => <tr key={a}><td>{a}</td><td className="r mono">{b}</td></tr>)}</tbody></table>
      </section>

      <section className="card">
        <div className="card-h"><h3>What companies sell</h3></div>
        <div className="card-b guide-grid">{PRODUCTS.map(([t, d]) => <div key={t}><b>{t}</b><p>{d}</p></div>)}</div>
      </section>

      <section className="card">
        <div className="card-h"><h3>Your safety rails</h3></div>
        <ul className="card-b guide-list">
          <li><b>Hard daily budget.</b> The company cannot spend past it, whatever the CEO decides.</li>
          <li><b>Approval limit.</b> Bigger purchases wait for you.</li>
          <li><b>Free check first.</b> Every order goes through IMD's free check, so a body IMD would refuse costs nothing.</li>
          <li><b>Never buys twice.</b> The same work is never paid for twice; published research is reused for free.</li>
          <li><b>Pause and withdraw any time.</b> From the dashboard, from Claude or Cursor over MCP.</li>
          <li><b>Keys encrypted.</b> Each company wallet's key is encrypted on the server. Keep balances small and withdraw often.</li>
        </ul>
      </section>

      <h2 className="guide-h2">Questions</h2>
      <Faq />

      <div className="guide-end">
        <Link to="/launch" className="btn primary">Launch a company</Link>
        <Link to="/token" className="btn">About $SHIFT</Link>
        <Link to="/terms" className="btn ghost">Terms & risks</Link>
      </div>
    </div>
  );
}
