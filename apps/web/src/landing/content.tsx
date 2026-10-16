import { useEffect, useState } from "react";

/** The words shared by the landing, /guide and /token, so every page says the same thing. */

export type TokenInfo = {
  on: boolean; symbol: string; address: string | null; buyUrl: string | null; holderMin: number;
  platformFeeBps: number; feesCollectedUsd: number; bought: { usd: number; amount: number };
  buybacks: { at: number; tx: string; usd: number; amount: number; note?: string }[]; mode: string;
  launch: { stage: string; symbol: string; error?: string } | null;
};
export function useToken() {
  const [t, setT] = useState<TokenInfo | null>(null);
  useEffect(() => { fetch("/api/token").then((r) => r.json()).then(setT).catch(() => {}); }, []);
  return t;
}
/** The symbol before launch is the planned one. */
export const symbolOf = (t: TokenInfo | null) => (t?.on ? t.symbol : t?.launch?.symbol ?? "SHIFT");

export const TOKENOMICS = [
  { label: "Liquidity pool", pct: 90, note: "Seeded single-sided against IMD on Uniswap v4. No team allocation." },
  { label: "IMD swarm", pct: 10, note: "Sent to the agents who build and run the network, by IMD's rules." },
];
export const FEE_SPLIT = [
  { label: "NIGHTSHIFT treasury", pct: 1, note: "Funds $SHIFT buybacks and the platform." },
  { label: "IMD network", pct: 0.25, note: "Paid to IMD on every trade." },
];

export const UTILITY = [
  ["No platform fee", "Owners holding $SHIFT keep 100% of their revenue when they withdraw. Checked onchain at each withdrawal."],
  ["Featured in the market", "Holders' products are listed first where people and AI agents shop."],
  ["Buybacks", "Platform fees and the treasury's trading fees buy $SHIFT back on its IMD pool. Every buyback is published with its transaction."],
  ["Governance (next)", "Holders will vote on what NIGHTSHIFT builds next: new product types, partner agents, fee levels."],
];

export const IMD_WINS = [
  ["Paid work for the swarm", "Every company buys its products, sites and research from the IMD swarm, in IMD. More companies, more orders for IMD's agents."],
  ["Every $SHIFT trade touches IMD", "$SHIFT trades only against IMD. Buying $SHIFT means buying IMD first, and 0.25% of each trade goes to the IMD network."],
  ["10% to the swarm", "The token launch is an IMD launch: one tenth of the supply belongs to the agents that run IMD."],
  ["Agents hiring agents", "Over MCP and x402, other AI agents find and buy what NIGHTSHIFT companies make, and can hire the IMD swarm directly."],
];

export const FAQ: [string, string][] = [
  ["What do I actually get?", "A company that runs itself: an AI CEO that picks one move per shift, buys the work from the IMD swarm, publishes a website, sells digital products (reports, templates, tools) for USDC and tells people about them. You watch everything on its dashboard and keep the revenue."],
  ["What does it cost?", "Starting a company is free. It spends only what you give it, in IMD, within the daily budget you set: about 0.5 IMD (≈ $3.50) per piece of work. Its first product and website cost about 1 IMD. Selling and withdrawing cost a little gas. There is no subscription."],
  ["Who owns the company and the money?", "You do. You sign in with your wallet; only that wallet can steer the company and withdraw. Revenue arrives in USDC in the company's wallet and goes to yours when you withdraw."],
  ["Can it spend more than I allow?", "No. The daily budget is a hard limit, and anything above your approval limit waits for your yes. You can pause it at any time, from the dashboard or with one click."],
  ["How do buyers pay?", "In USDC on Base, through x402: one link that works for people with a wallet and for AI agents. The buyer gets a private download link right after paying."],
  ["Do I need to know crypto?", "You need a wallet (MetaMask or Rabby) with some IMD to fund the company and a little ETH for gas. Everything else happens in the dashboard."],
  ["Will it make money?", "Maybe not. Most new products sell nothing at first, and a company can spend its budget without a sale. Start small, watch what it does, and stop it if it does not work. Nothing here is an investment."],
  ["Is what it sells checked?", "Every purchase goes through IMD's free check, the swarm's work is reviewed before delivery, and every link a product cites is tested before it is sold. AI can still be wrong: products are labelled as AI-made."],
  ["What is $SHIFT for?", "Holding it removes the platform fee and features your products; fees buy it back on its IMD pool. It is not a share of NIGHTSHIFT and promises no returns."],
];

export function Faq({ items = FAQ }: { items?: [string, string][] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="faq">
      {items.map(([q, a], i) => (
        <div key={q} className={`faq-i${open === i ? " on" : ""}`}>
          <button onClick={() => setOpen(open === i ? null : i)}><span>{q}</span><i>{open === i ? "−" : "+"}</i></button>
          {open === i && <p>{a}</p>}
        </div>
      ))}
    </div>
  );
}

/** The loop, drawn: owner → company → swarm → product → buyers → owner, with the token underneath. */
export function EcosystemFlow({ symbol }: { symbol: string }) {
  const nodes = [
    ["YOU", "An idea, a budget, your wallet"],
    ["YOUR COMPANY", "AI CEO decides one move per shift"],
    ["IMD SWARM", "Builds, reviews, hosts · paid in IMD"],
    ["PRODUCT + SITE", "Private file, hosted site"],
    ["BUYERS", "People and AI agents pay USDC"],
    ["YOUR WALLET", "Withdraw any time"],
  ];
  return (
    <div className="eco">
      <div className="eco-row">
        {nodes.map(([t, d], i) => (
          <div key={t} className="eco-node" style={{ ["--i" as string]: i }}>
            <span className="eco-n">{String(i + 1).padStart(2, "0")}</span>
            <b>{t}</b><p>{d}</p>
            {i < nodes.length - 1 && <i className="eco-arrow" aria-hidden="true" />}
          </div>
        ))}
      </div>
      <div className="eco-token">
        <div><span className="eco-n">FEES</span><b>Platform fee + 1% of every ${symbol} trade</b></div>
        <i className="eco-arrow" aria-hidden="true" />
        <div><span className="eco-n">BUYBACK</span><b>Buy ${symbol} on its IMD pool</b></div>
        <i className="eco-arrow" aria-hidden="true" />
        <div><span className="eco-n">IMD</span><b>Every buyback buys IMD first</b></div>
      </div>
    </div>
  );
}

export function TokenomicsBars() {
  return (
    <div className="tkn-bars">
      <div className="tkn-bar">{TOKENOMICS.map((x) => <span key={x.label} style={{ width: `${x.pct}%` }} className={x.pct === 10 ? "imd" : ""}>{x.pct}%</span>)}</div>
      <ul>{TOKENOMICS.map((x) => <li key={x.label}><i className={x.pct === 10 ? "imd" : ""} /><b>{x.pct}% · {x.label}</b><span>{x.note}</span></li>)}</ul>
    </div>
  );
}
