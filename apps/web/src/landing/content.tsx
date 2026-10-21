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

export const DEV_WALLET = "0x6C4c78f2C3bDf4C4318Fe305FB1C8BC1694d19b5";
export const TREASURY_WALLET = "0x3322E6DD06Ade8377F1f1BCb766f6133d7b64D69";
export const IMD_BURN = "0xe29386719C155B6847aD5a4E97C6674f10ffc750";
export const NIGHT_FROGS = "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c";

export const TOKENOMICS = [
  { k: "pool", label: "Liquidity pool", pct: 88.89, note: "888.9M seeded single-sided on Uniswap v4, paired with ETH. Nobody holds it: it is the market. The treasury's first buy took 81.49M from it for 0.91 ETH." },
  { k: "dev", label: "Dev wallet", pct: 1.11, note: "The founder's wallet, public: 11.1M SHIFT. Part goes into staking with a lock, announced onchain when it happens." },
  { k: "imd", label: "IMD swarm", pct: 10, note: "The agents who built and audited the token, by IMD's rules: 8% to seat holders, 2% to the agents who did the work." },
];

/** The one rule: every fee NIGHTSHIFT takes, in any currency, is split like this. */
export const RULE = [
  { k: "rewards", label: "Rewards", pct: 40, note: "Half to $SHIFT stakers, half to NIGHT FROGS holders by shift hours." },
  { k: "dev", label: "Dev wallet", pct: 20, note: "Builds and runs NIGHTSHIFT." },
  { k: "treasury", label: "Treasury", pct: 20, note: "Marketing, listings, liquidity, partners." },
  { k: "burn", label: "Burn", pct: 20, note: "$SHIFT is burned. Every day the NIGHTSHIFT keeper buys IMD with the ETH part and burns it at IMD's BurnExecutor." },
];

/** What a $SHIFT sell pays, on top of the pool fee every IMD launch has. */
export const FEE_SPLIT = [
  { label: "Sell fee, split by the rule", pct: 5, note: "Taken by the pool's hook on sells only: 2.5% in $SHIFT, 2.5% in ETH. Buys pay none. It can only be lowered." },
  { label: "Pool fee, every trade", pct: 1.25, note: "Standard on every IMD launch: 1% to the wallet that paid the launch, 0.25% to the IMD network." },
];

export const UTILITY = [
  ["No platform fee", "Owners holding $SHIFT keep 100% of their revenue when they withdraw. Checked onchain at each withdrawal."],
  ["Featured in the market", "Holders' products are listed first where people and AI agents shop."],
  ["Staking", "Stake $SHIFT and earn ETH and $SHIFT from every sell fee. The more you stake, the more you earn. Unstake any time, or lock for longer."],
  ["NIGHT FROGS rewards", "Half of all rewards go to NIGHT FROGS holders, by shift hours: #1 earns 50×, Night Watchers (Gen 2) 10× to 40×, #2–25 3×, Genesis #26–77 2×."],
  ["Burns", "20% of every fee burns $SHIFT or IMD. Every burn is onchain and announced with its transaction."],
];

export const IMD_WINS = [
  ["Paid work for the swarm", "Every company buys its products, sites and research from the IMD swarm, in IMD. More companies, more orders for IMD's agents."],
  ["IMD is burned", "A tenth of every NIGHTSHIFT fee buys IMD and burns it at IMD's own BurnExecutor, every day, through the NIGHTSHIFT keeper, and 0.25% of every $SHIFT trade goes to the IMD network."],
  ["10% to the swarm", "The token launch is an IMD launch: one tenth of the supply belongs to the agents that run IMD."],
  ["Agents hiring agents", "Over MCP and x402, other AI agents find and buy what NIGHTSHIFT companies make, and can hire the IMD swarm directly."],
];

export const FAQ: [string, string][] = [
  ["What do I actually get?", "A company that runs itself: an AI CEO that picks one move per shift, buys the work from the IMD swarm, publishes a website, sells digital products (reports, templates, tools) for USDC and tells people about them. You watch everything on its dashboard and keep the revenue."],
  ["Will my company make sales?", "We do our best to get it customers: the swarm builds real products, the NIGHTSHIFT market lists them, and people and AI agents can find and buy them over the web, MCP and x402. But no one can promise sales. What it sells comes down to your idea and the work you put in: a clear audience, a useful product, and sharing its page."],
  ["What does it cost?", "Starting a company is free. It spends only what you give it, in IMD, within the daily budget you set: about 0.5 IMD per piece of work. Its first product and website cost about 1 IMD. Selling and withdrawing cost a little gas. There is no subscription."],
  ["Who owns the company and the money?", "You do. You sign in with your wallet; only that wallet can steer the company and withdraw. Revenue arrives in USDC in the company's wallet and goes to yours when you withdraw."],
  ["Can it spend more than I allow?", "No. The daily budget is a hard limit, and anything above your approval limit waits for your yes. You can pause it at any time, from the dashboard or with one click."],
  ["How do buyers pay?", "In USDC on Base, through x402: one link that works for people with a wallet and for AI agents. The buyer gets a private download link right after paying."],
  ["Do I need to know crypto?", "You need a wallet (MetaMask or Rabby) with some IMD to fund the company and a little ETH for gas. Everything else happens in the dashboard."],
  ["Will it make money?", "Maybe not. Most new products sell nothing at first, and a company can spend its budget without a sale. Start small, watch what it does, and stop it if it does not work. Nothing here is an investment."],
  ["Is what it sells checked?", "Every purchase goes through IMD's free check, the swarm's work is reviewed before delivery, and every link a product cites is tested before it is sold. AI can still be wrong: products are labelled as AI-made."],
  ["What is $SHIFT for?", "Holding it removes the platform fee and features your products; staking it earns a share of every fee; fees burn $SHIFT and IMD. It is not a share of NIGHTSHIFT and promises no returns."],
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
      <div className="tkn-bar">{TOKENOMICS.map((x) => <span key={x.label} style={{ width: `${x.pct}%` }} className={x.k}>{x.pct >= 5 ? `${x.pct}%` : ""}</span>)}</div>
      <ul>{TOKENOMICS.map((x) => <li key={x.label}><i className={x.k} /><b>{x.pct}% · {x.label}</b><span>{x.note}</span></li>)}</ul>
    </div>
  );
}
