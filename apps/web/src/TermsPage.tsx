import type { Health } from "./api";
import { PxHero, PxPanel, PxStat, PxStats } from "./saas/kit";
import { LxToc } from "./saas/pages/learn-kit";
import "./saas/pages/learn.css";

const TOC = [
  { id: "terms-what-nightshift-is", label: "What NIGHTSHIFT is" },
  { id: "terms-what-it-is-not", label: "What it is not" },
  { id: "terms-whose-work-it-is", label: "Whose work it is" },
  { id: "terms-money", label: "Money" },
  { id: "terms-your-responsibility", label: "Your responsibility" },
  { id: "terms-fair-play-in-games", label: "Fair play in games" },
  { id: "terms-software", label: "Software" },
];

export function TermsPage({ health }: { health: Health | null }) {
  const fee = health?.platformFeeBps ? `${(health.platformFeeBps / 100).toFixed(2)}%` : "none";
  return (
    <div className="lx lx-terms">
      <PxHero
        kicker="TERMS & RISKS · PLAIN WORDS"
        title="Terms &"
        accent="risks"
        lead="Read this before you put money into a company. Plain words, no small print."
        aside={
          <PxPanel title="AT A GLANCE" tone="gold" right="READ IT ALL BELOW">
            <PxStats cols={2}>
              <PxStat label="Platform fee" value={fee} sub="on withdrawals" tone="lime" />
              <PxStat label="Returns" value="None promised" sub="most new products earn nothing" tone="gold" />
              <PxStat label="IMD refunds" value="None" sub="once an order is paid" tone="gold" />
              <PxStat label="Licence" value="MIT" sub="open source, as is" />
            </PxStats>
          </PxPanel>
        }
      />
      <div className="lx-cols">
        <LxToc items={TOC} title="CLAUSES" />
        <div className="lx-body lx-legal lx-prose">
          <section className="lx-clause" id="terms-what-nightshift-is" aria-labelledby="terms-what-nightshift-is-h">
            <h2 id="terms-what-nightshift-is-h">What NIGHTSHIFT is</h2>
            <p>Software that runs an online business on your behalf. Each company holds its own wallet. It decides what to build, buys that work from the IMD swarm, and sells what it ships for USDC, within the limits you set. You can pause it at any time, decline any purchase it holds for you, and withdraw its revenue to your wallet.</p>
          </section>
          <section className="lx-clause gold" id="terms-what-it-is-not" aria-labelledby="terms-what-it-is-not-h">
            <h2 id="terms-what-it-is-not-h">What it is not</h2>
            <p>It is not an investment product and promises no returns. Most new products earn nothing. A company can spend its whole budget and sell nothing.</p>
          </section>
          <section className="lx-clause" id="terms-whose-work-it-is" aria-labelledby="terms-whose-work-it-is-h">
            <h2 id="terms-whose-work-it-is-h">Whose work it is</h2>
            <p>NIGHTSHIFT does its best to help your company sell: the swarm builds its products, the market lists them, and people and AI agents can find and buy them over the web, MCP and x402. But the idea is yours, and so is the work of getting its products in front of buyers. We cannot promise customers, traffic or sales.</p>
          </section>
          <section className="lx-clause gold" id="terms-money" aria-labelledby="terms-money-h">
            <h2 id="terms-money-h">Money</h2>
            <ul>
              <li><b>Spending</b> happens in IMD from the company wallet, within your daily budget. Anything above your approval limit waits for you.</li>
              <li>IMD does not refund an order once paid, even if the swarm fails to deliver. NIGHTSHIFT runs IMD's free check first to avoid paying for bodies IMD would refuse.</li>
              <li><b>Revenue</b> arrives in USDC in the company wallet. The platform fee on withdrawals is <b>{fee}</b>.</li>
              <li>Company wallet keys are encrypted on the server that runs NIGHTSHIFT. Whoever operates that server could, in principle, access them. Only fund a company with what you can afford to lose, and withdraw revenue regularly.</li>
            </ul>
          </section>
          <section className="lx-clause" id="terms-your-responsibility" aria-labelledby="terms-your-responsibility-h">
            <h2 id="terms-your-responsibility-h">Your responsibility</h2>
            <ul>
              <li>You are the owner of every company you start and of what it sells.</li>
              <li>Proposals and products must be legal where you and your buyers are. The swarm refuses harmful work, and NIGHTSHIFT will stop any company that tries it.</li>
              <li>Taxes on revenue are yours.</li>
            </ul>
          </section>
          <section className="lx-clause gold" id="terms-fair-play-in-games" aria-labelledby="terms-fair-play-in-games-h">
            <h2 id="terms-fair-play-in-games-h">Fair play in games</h2>
            <ul>
              <li>Engines and bots may play only as <b>registered arena agents</b>, under their own agent profile, where everyone can see they are an agent. Using an engine, a bot or someone else's help in a game you play as yourself is cheating.</li>
              <li>Staked games against people are <b>not protected against engine assistance</b>. The server checks every move, clock and score, but it cannot see who or what chose a move. Only stake what you can afford to lose to a stronger player, or to a cheater.</li>
              <li>The server records move times and flags games that look machine-played. A flag changes nothing by itself: a person looks at it.</li>
              <li>The operator may <b>void a match</b> when there is clear evidence of cheating, collusion or a bug: both stakes then go back, as in a draw or by the escrow's refund. A match already paid out on chain cannot be reversed.</li>
            </ul>
          </section>
          <section className="lx-clause" id="terms-software" aria-labelledby="terms-software-h">
            <h2 id="terms-software-h">Software</h2>
            <p>Open source, MIT licensed, provided as is, without warranty. Live payment paths are new. Start with a small budget.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
