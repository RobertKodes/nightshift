import { Link } from "../router";

export type Brief = {
  title: string;
  what: string;
  why: string;
  cost: string;
  action: { to: string; label: string };
};

/** Plain-language headers. Prices are the ones published in the house services and contracts. */
const BRIEFS: { test: (path: string) => boolean; brief: Brief }[] = [
  { test: (p) => p.startsWith("/services/verdict"), brief: {
    title: "Token Verdict",
    what: "A before-you-buy check of an Ethereum token: what looks risky, with the evidence.",
    why: "Use it when you are about to buy and want the warnings in one place.",
    cost: "The preview is free. One full quick verdict a day is free. After that, quick is $0.01 and deep is $0.25 in USDC on Base. Hold 500,000 $SHIFT (wallet plus staked), a Night Frog, or a Night Watcher and house checks are half price.",
    action: { to: "#try", label: "Run a free check" },
  } },
  { test: (p) => p.startsWith("/services/hook"), brief: {
    title: "Hook Inspector",
    what: "Reads a Uniswap v4 hook: what it is allowed to do.",
    why: "Use it before you trade a pool whose hook you have not read.",
    cost: "Decoding the permission bits is free. An inspection is $0.05. The explained report is $0.50. Half price if you hold 500,000 $SHIFT, a Night Frog, or a Night Watcher.",
    action: { to: "#try", label: "Decode a hook free" },
  } },
  { test: (p) => p.startsWith("/services/imd-feed"), brief: {
    title: "IMD data feed",
    what: "IMD launches, tokens, and swarm health as JSON.",
    why: "Use it when an agent or a script needs the swarm's published data.",
    cost: "A 3-item sample is free. Each paid call is $0.001 in USDC on Base, over x402. No API key.",
    action: { to: "/mcp", label: "Connect an agent" },
  } },
  { test: (p) => p.startsWith("/services"), brief: {
    title: "Check a token, or hire the swarm",
    what: "House tools that check tokens, hooks, and APIs, plus Swarm Desk, which hires IMD agents for a job.",
    why: "Start here if you want a warning before you buy, or a quote before you pay someone to build.",
    cost: "Previews and SWARM MIND are free. Quick verdict $0.01, deep $0.25, hook inspection $0.05, fast lookups from $0.001. Swarm Desk shows a checked quote first and charges that exact USDC amount. Half price on house checks with 500,000 $SHIFT, a Night Frog, or a Night Watcher. Desk jobs stay at the full quote.",
    action: { to: "/services/verdict", label: "Check a token free" },
  } },
  { test: (p) => p.startsWith("/mind"), brief: {
    title: "SWARM MIND",
    what: "Asks the IMD swarm's already published work, and shows the sources.",
    why: "Use it to see what the swarm has already written before you pay for a new report.",
    cost: "Free. Nothing is charged on this page.",
    action: { to: "#ask", label: "Ask a question" },
  } },
  { test: (p) => p.startsWith("/watchtower"), brief: {
    title: "Token monitor",
    what: "Watches an Ethereum token or hook and reports what changed.",
    why: "Use it after a verdict, when you want to know if the contract moved.",
    cost: "A sample check is free. A seven-day watch is a prepaid USDC price shown on the crew page before you pay.",
    action: { to: "/crews/watchtower", label: "See a free sample" },
  } },
  { test: (p) => p.startsWith("/crews"), brief: {
    title: "Crews",
    what: "The AI crews that do the work: Watchtower, Research Desk, Build & Check, and Swarm Desk, plus outside operators.",
    why: "Use it to read a free sample before you pay, and to see what a crew has already delivered.",
    cost: "Samples are free. Paid calls are USDC on Base over x402, at the price on the crew card. Swarm Desk quotes first and does not discount that quote.",
    action: { to: "/agents/start", label: "Connect an agent" },
  } },
  { test: (p) => p.startsWith("/agents"), brief: {
    title: "Connect an agent",
    what: "A path from a free result to one paid call, then to running your own crew.",
    why: "Use it if you are building an agent that should use Nightshift or sell through it.",
    cost: "Discovery and the two sample calls are free. A paid call is the USDC price that call shows, signed in your wallet only when you choose it.",
    action: { to: "/mcp", label: "Read the MCP setup" },
  } },
  { test: (p) => p.startsWith("/mcp"), brief: {
    title: "For AI agents",
    what: "The public MCP endpoint and x402 payment terms, so an agent can call the same tools a person can.",
    why: "Use it to point Cursor, Claude, or your own agent at Nightshift.",
    cost: "Reading this page is free. Paid tools settle in USDC on Base. The agent sees the price before it signs.",
    action: { to: "/services", label: "See the tool prices" },
  } },
  { test: (p) => p.startsWith("/sniper"), brief: {
    title: "Night Sniper",
    what: "New IMD token and NFT launches, with a verdict when one has been run.",
    why: "Use it to see a launch before you buy it.",
    cost: "Free to read. Holders of a Night Frog, or of $SHIFT above the holder line, see a call when it is made. Everyone else sees it when the community chat does.",
    action: { to: "/services/verdict", label: "Check one token yourself" },
  } },
  { test: (p) => p.startsWith("/games"), brief: {
    title: "Play",
    what: "Pinball, chess, pool, and poker against people or the station's frogs.",
    why: "Use it to try the station with no wallet and no account.",
    cost: "Practice is free. A staked match is optional and uses the stake you set. Watching a table is free.",
    action: { to: "/games/pinball", label: "Play pinball" },
  } },
  { test: (p) => p.startsWith("/arena"), brief: {
    title: "Agent arena",
    what: "AI agents play the same games and their results are compared.",
    why: "Use it to see how an agent does, not to bet.",
    cost: "Free to watch.",
    action: { to: "/games", label: "Play a game yourself" },
  } },
  { test: (p) => p.startsWith("/league"), brief: {
    title: "Paper trading league",
    what: "A trading contest that does not spend real money.",
    why: "Use it to follow a result without buying the token.",
    cost: "Free to follow.",
    action: { to: "/league", label: "Open the board" },
  } },
  { test: (p) => p.startsWith("/token"), brief: {
    title: "$SHIFT",
    what: "The station's token. Holding it changes what you pay. Staking it shares in sells.",
    why: "Read this before you swap, so you know the holder line and what staking does.",
    cost: "Reading is free. A swap or a stake spends what you confirm in your wallet, plus an Ethereum network fee. Hold 500,000 $SHIFT in your wallet plus what you have staked, or hold a Night Frog or a Night Watcher, and house checks are half price.",
    action: { to: "/how-it-works", label: "See how rewards connect" },
  } },
  { test: (p) => p.startsWith("/swap"), brief: {
    title: "Swap",
    what: "Exchange ETH and $SHIFT from your own wallet.",
    why: "Use it when you already know the token address and want to trade.",
    cost: "You pay the pool price plus the route's fee, and an Ethereum network fee. The quote is shown before your wallet asks you to sign. Signing a swap moves the tokens you confirm.",
    action: { to: "/token", label: "Read $SHIFT first" },
  } },
  { test: (p) => p.startsWith("/stake") || p.startsWith("/staking"), brief: {
    title: "Stake $SHIFT",
    what: "Deposit $SHIFT into the rewards contract. You choose no lock, or a lock up to 24 months.",
    why: "Use it to take a share of sell fees instead of only holding.",
    cost: "You stake your own tokens. Your wallet asks you to approve the contract, then to deposit. Both steps are shown before you sign. Unstaking follows the lock you picked.",
    action: { to: "/token", label: "See holder benefits first" },
  } },
  { test: (p) => p.startsWith("/deals"), brief: {
    title: "Token Deals",
    what: "Buy or sell a token at a fixed price. The tokens sit in an escrow contract until the trade settles.",
    why: "Use it when you want a set price instead of a market swap.",
    cost: "The buyer pays a fee on top of the price. The live rate is on this page. Holders of 500,000 $SHIFT, a Night Frog, or a Night Watcher pay the lower holder rate. Your wallet signs the trade only after the total is shown.",
    action: { to: "/services/verdict", label: "Check the token first" },
  } },
  { test: (p) => p.startsWith("/frogs"), brief: {
    title: "Night Frogs",
    what: "The crew collectible. Holding one is a holder pass, the same as 500,000 $SHIFT.",
    why: "Use it to see what a frog is before you send one on a mission or into the forge.",
    cost: "Reading is free. Buying one is a purchase on OpenSea or from a holder, in your own wallet.",
    action: { to: "/command", label: "See frog missions" },
  } },
  { test: (p) => p.startsWith("/command"), brief: {
    title: "Frog missions",
    what: "Send a Night Frog you own on a mission and track the hours it earns.",
    why: "Use it when you already hold a frog and want it working.",
    cost: "You need a frog in the signed-in wallet. Starting a mission asks your wallet to sign that action. It does not sell the frog.",
    action: { to: "/frogs", label: "Meet the frogs first" },
  } },
  { test: (p) => p.startsWith("/forge"), brief: {
    title: "The Forge",
    what: "Burns exactly 10 Night Frogs and mints one Night Watcher. The rare frogs in the ten set the tier.",
    why: "Use it only when you mean to give up those ten frogs. They are sent to a burn address.",
    cost: "The forge fee is 2 IMD, on top of the ten frogs. Your wallet shows the approval and the forge transaction before you sign. If the forge is closed, this page says so and nothing can be sent.",
    action: { to: "/watch", label: "See what a Watcher does" },
  } },
  { test: (p) => p.startsWith("/watch"), brief: {
    title: "Night Watch",
    what: "Keeper seats for imdUSD loans. A Night Watcher, or the Captain's seat, can run a keeper that marks loans for a bonus.",
    why: "Use it if you run a keeper and want the seat that earns the watch bonus.",
    cost: "Reading the vault is free. Pairing a seat asks your wallet to sign a login-style message for that seat. It does not move tokens. Forging the Watcher itself happens on the Forge.",
    action: { to: "/forge", label: "See the forge cost" },
  } },
  { test: (p) => p.startsWith("/ship"), brief: {
    title: "The Ship",
    what: "The crew at work: frogs, company tasks, live games, and the Night Watch, on one deck.",
    why: "Use it to see the station moving before you join any of it.",
    cost: "Free to look around. Sign in only if you want the deck to highlight frogs in your wallet. That sign-in does not spend tokens.",
    action: { to: "/games/live", label: "Watch a live game" },
  } },
  { test: (p) => p.startsWith("/proof"), brief: {
    title: "Receipts",
    what: "Public payments, crew jobs, and the wallets behind them.",
    why: "Use it to check that a paid call settled, without trusting a screenshot.",
    cost: "Free to read. Customer payments in USDC show up after they settle. Test and internal payments are left out on purpose.",
    action: { to: "/services", label: "See what people pay for" },
  } },
  { test: (p) => p.startsWith("/launchpad"), brief: {
    title: "Token launch board",
    what: "IMD token launches and their details. Creating one is a separate step.",
    why: "Use it to read a launch before you trade it.",
    cost: "Browsing is free. Creating a token asks your wallet to sign the launch, and you pay the network fee.",
    action: { to: "/sniper", label: "See launch alerts" },
  } },
  { test: (p) => p.startsWith("/launch"), brief: {
    title: "Start a company",
    what: "Describe an idea and set a budget. The company runs on the IMD swarm.",
    why: "Use it when you want an AI company, not a one-off check.",
    cost: "You need a wallet. The budget you set is the spending cap. You confirm it before anything is spent.",
    action: { to: "/guide", label: "Read the business guide" },
  } },
  { test: (p) => p.startsWith("/companies") || p.startsWith("/market") || p.startsWith("/my") || p.startsWith("/co/") || p.startsWith("/c/"), brief: {
    title: "Companies",
    what: "AI companies on the station, their products, and the owner's desk.",
    why: "Use it to buy from a company or to run one you started.",
    cost: "Looking is free. Paying for a product is USDC, at the price on that product, and your wallet asks before it moves.",
    action: { to: "/launch", label: "Start a company" },
  } },
  { test: (p) => p.startsWith("/how-it-works"), brief: {
    title: "How it connects",
    what: "How games, checks, $SHIFT, and the burns pay each other.",
    why: "Read this once if the rooms feel like separate sites.",
    cost: "Free to read.",
    action: { to: "/start", label: "Start here" },
  } },
  { test: (p) => p.startsWith("/impact"), brief: {
    title: "IMD impact",
    what: "The published record of IMD activity the station reports.",
    why: "Use it to see what the swarm has done, not a promise of what it will do.",
    cost: "Free to read.",
    action: { to: "/proof", label: "Open the receipts" },
  } },
  { test: (p) => p.startsWith("/partners"), brief: {
    title: "Partners",
    what: "A free application for a project that wants its token in the station.",
    why: "Use it if you run a token and want the partner badge and checks.",
    cost: "Applying is free. There is no listing fee on this form.",
    action: { to: "/deals", label: "See partner deals" },
  } },
  { test: (p) => p.startsWith("/guide"), brief: {
    title: "Business guide",
    what: "How to start and run an AI company on the station.",
    why: "Read it before you set a budget.",
    cost: "Free to read.",
    action: { to: "/launch", label: "Start a company" },
  } },
  { test: (p) => p.startsWith("/tokenomics") || p.startsWith("/whitepaper"), brief: {
    title: "The rules",
    what: "How $SHIFT is allocated, and the written design of the station.",
    why: "Read it before you treat a number on the site as a promise.",
    cost: "Free to read.",
    action: { to: "/token", label: "Back to $SHIFT" },
  } },
  { test: (p) => p.startsWith("/security") || p.startsWith("/terms") || p.startsWith("/privacy"), brief: {
    title: "Rules and safety",
    what: "What can go wrong, what the site stores, and the terms of use.",
    why: "Read it before you connect a wallet or pay.",
    cost: "Free to read.",
    action: { to: "/start", label: "Start here" },
  } },
];

export function briefFor(path: string): Brief | null {
  if (path === "/start" || path.startsWith("/start/")) return null;
  return BRIEFS.find((row) => row.test(path))?.brief ?? null;
}

/** What this page does, why you'd open it, what it costs, and the first click. */
export function RoomBrief({ path }: { path: string }) {
  const brief = briefFor(path);
  if (!brief) return null;
  const action = brief.action.to.startsWith("#")
    ? <a className="nx-btn nx-btn-acc" href={brief.action.to}>{brief.action.label}</a>
    : <Link to={brief.action.to} className="nx-btn nx-btn-acc">{brief.action.label}</Link>;
  return (
    <section className="ux-brief" aria-label={`${brief.title}: how to use this page`}>
      <div>
        <p className="ux-kicker">How to use this</p>
        <h2>{brief.title}</h2>
        <p>{brief.what} {brief.why}</p>
        <p className="ux-cost">{brief.cost}</p>
      </div>
      {action}
    </section>
  );
}

/** Shown before a wallet opens, so the signature is not a surprise. */
export function BeforeSign({ kind }: { kind: "login" | "usdc" }) {
  return kind === "login" ? (
    <p className="ux-sign">Your wallet will ask you to sign a login message for this site. It does not send tokens, approve a contract, or charge a network fee. Rejecting it leaves you signed out.</p>
  ) : (
    <p className="ux-sign">Your wallet will ask you to authorize this exact USDC amount on Base. It is not an unlimited approval. If you reject it, nothing is paid.</p>
  );
}
