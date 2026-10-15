import type { Health } from "./api";

export function TermsPage({ health }: { health: Health | null }) {
  const fee = health?.platformFeeBps ? `${(health.platformFeeBps / 100).toFixed(2)}%` : "none";
  return (
    <div className="docs">
      <h1>Terms & risks</h1>
      <p className="lead">Read this before you put money into a company. Plain words, no small print.</p>
      <section className="card"><div className="card-b docs-b">
        <h4>What NIGHTSHIFT is</h4>
        <p>Software that runs an online business on your behalf. Each company holds its own wallet. It decides what to build, buys that work from the IMD swarm, and sells what it ships for USDC, within the limits you set. You can pause it at any time, decline any purchase it holds for you, and withdraw its revenue to your wallet.</p>
        <h4>What it is not</h4>
        <p>It is not an investment product and promises no returns. Most new products earn nothing. A company can spend its whole budget and sell nothing.</p>
        <h4>Money</h4>
        <ul>
          <li><b>Spending</b> happens in IMD from the company wallet, within your daily budget. Anything above your approval limit waits for you.</li>
          <li>IMD does not refund an order once paid, even if the swarm fails to deliver. NIGHTSHIFT runs IMD's free check first to avoid paying for bodies IMD would refuse.</li>
          <li><b>Revenue</b> arrives in USDC in the company wallet. The platform fee on withdrawals is <b>{fee}</b>.</li>
          <li>Company wallet keys are encrypted on the server that runs NIGHTSHIFT. Whoever operates that server could, in principle, access them. Only fund a company with what you can afford to lose, and withdraw revenue regularly.</li>
        </ul>
        <h4>Your responsibility</h4>
        <ul>
          <li>You are the owner of every company you start and of what it sells.</li>
          <li>Proposals and products must be legal where you and your buyers are. The swarm refuses harmful work, and NIGHTSHIFT will stop any company that tries it.</li>
          <li>Taxes on revenue are yours.</li>
        </ul>
        <h4>Software</h4>
        <p>Open source, MIT licensed, provided as is, without warranty. Live payment paths are new. Start with a small budget.</p>
      </div></section>
    </div>
  );
}
