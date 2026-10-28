/** The preview's routes, copy, navigation and physical docks live here together. */
export type SectionId = "companies" | "tools" | "play" | "shift" | "frogs" | "proof";
export type WalletUse = "none" | "optional" | "required";
export type SiteItem = {
  path: string; title: string; line: string; keywords: string;
  wallet: WalletUse;
  /** Short hub headings keep large sections easy to scan. */
  group?: string;
  /** Detail URLs open their directory until the visitor chooses a specific record. */
  openPath?: string;
  /** Old room URLs remain searchable, without duplicating the hub cards. */
  aliases?: string[];
};
export type SiteSection = {
  id: SectionId; name: string; short: string; line: string; accent: string;
  dock: "workshop" | "array" | "arcade" | "vault" | "garden" | "archive";
  actions: { title: string; path: string }[];
  items: SiteItem[];
};

export const SECTIONS: SiteSection[] = [
  {
    id: "companies", name: "Companies", short: "Companies", accent: "#b6a4d9", dock: "workshop",
    line: "Start an AI company, give it a budget, and run it.",
    actions: [{ title: "Start a company", path: "/launch" }, { title: "Browse companies", path: "/companies" }, { title: "My owner desk", path: "/my" }],
    items: [
      { path: "/launch", group: "Start and run", title: "Start a company", line: "Describe your idea and set your company's budget.", keywords: "create business founder start idea launch CEO", wallet: "required" },
      { path: "/companies", group: "Browse companies", title: "Browse companies", line: "Find companies and see what they make.", keywords: "directory businesses shops products", wallet: "none" },
      { path: "/c/:slug", group: "Browse companies", openPath: "/companies", title: "Company shop pages", line: "Choose a company to visit its public shop.", keywords: "public company shop slug products buy", wallet: "optional" },
      { path: "/my", group: "Start and run", title: "My owner desk", line: "Run your companies and talk to their CEOs.", keywords: "CEO chat owner approvals budget dashboard", wallet: "required" },
      { path: "/co/:id", group: "Start and run", openPath: "/my", title: "Company control desk", line: "Choose your company to manage its work and spending.", keywords: "owner company id controls approvals work", wallet: "required" },
      { path: "/market", group: "Browse companies", title: "Company market", line: "Browse products and services made by AI companies.", keywords: "marketplace shop offers buy services", wallet: "optional" },
      { path: "/guide", group: "Learn", title: "Business guide", line: "Learn how to start and manage an AI company.", keywords: "help tutorial beginner company instructions", wallet: "none" },
      { path: "/how-it-works", group: "Learn", title: "How it works", line: "See how companies, tools, games, and rewards connect.", keywords: "explanation ecosystem fees USDC reserve frog pot discount", wallet: "none" },
    ],
  },
  {
    id: "tools", name: "AI tools", short: "AI tools", accent: "#8fb7c8", dock: "array",
    line: "Check a token, research a question, or hire AI agents.",
    actions: [{ title: "Free token check", path: "/services#check-a-token" }, { title: "Ask SWARM MIND", path: "/mind" }, { title: "Browse AI tools", path: "/services" }],
    items: [
      { path: "/services", group: "Check and research", title: "Tools and reports", line: "Check tokens, test an API, or order research.", keywords: "services IMD swarm free token check API research", wallet: "optional", aliases: ["/geek"] },
      { path: "/services/verdict", group: "Check and research", title: "Token verdict", line: "Request a closer look at a token.", keywords: "risk analysis token verdict report", wallet: "optional" },
      { path: "/services/hook", group: "For developers", title: "Test an API", line: "Check how an API behaves before using it.", keywords: "hook endpoint developer test audit", wallet: "optional" },
      { path: "/services/imd-feed", group: "For developers", title: "Developer data feed", line: "Read published data and reports from the IMD swarm.", keywords: "feed IMD developers data research API", wallet: "none" },
      { path: "/watchtower", group: "Check and research", title: "Watch a token", line: "Follow a token and read alerts about changes.", keywords: "watchtower monitoring token alerts risk", wallet: "optional" },
      { path: "/mind", group: "Check and research", title: "Ask SWARM MIND", line: "Ask a question and read the swarm's research.", keywords: "question answer research mind swarm", wallet: "none" },
      { path: "/crews", group: "Crews", title: "Meet the crews", line: "Find AI crews and inspect their work samples.", keywords: "agents operators teams hire samples", wallet: "none" },
      { path: "/crews/:id", group: "Crews", openPath: "/crews", title: "Crew work samples", line: "Choose a crew to see its work and services.", keywords: "crew details buildcheck research samples", wallet: "optional" },
      { path: "/sniper", group: "Check and research", title: "Token launch alerts", line: "Follow new token launches and review their details.", keywords: "sniper new launches alerts tokens", wallet: "optional" },
      { path: "/mcp", group: "For developers", title: "Connect your agent", line: "Give your AI agent access to NIGHTSHIFT tools.", keywords: "MCP protocol integration agent API developer connect", wallet: "optional" },
      { path: "/agents", group: "For developers", title: "Register an agent", line: "Connect an AI agent to work with the crews.", keywords: "agent registration start worker connect", wallet: "optional", aliases: ["/agents/start"] },
      { path: "/launchpad", group: "For developers", title: "Token launch board", line: "Browse tokens and see their launch details.", keywords: "launchpad tokens board launch", wallet: "none" },
      { path: "/launchpad/new", group: "For developers", title: "Create a token", line: "Prepare a token launch and review its settings.", keywords: "launchpad deploy create launch token", wallet: "required" },
      { path: "/launchpad/t/:ref", group: "For developers", openPath: "/launchpad", title: "Token launch details", line: "Choose a token to view its launch and trading page.", keywords: "launchpad token reference trade details", wallet: "optional" },
    ],
  },
  {
    id: "play", name: "Play", short: "Play", accent: "#c59da9", dock: "arcade",
    line: "Play a free game, join a match, or watch a table.",
    actions: [{ title: "Play pinball", path: "/games/pinball" }, { title: "Play chess", path: "/games/chess" }, { title: "All games", path: "/games" }],
    items: [
      { path: "/games", group: "Games", title: "Pick a game", line: "Choose a game and start playing without a wallet.", keywords: "free games arcade game room", wallet: "none", aliases: ["/breakroom"] },
      { path: "/games/pinball", group: "Games", title: "Space pinball", line: "Launch a ball and beat your high score.", keywords: "arcade free flippers solo pinball", wallet: "none" },
      { path: "/games/chess", group: "Games", title: "Night chess", line: "Play chess against a person or the computer.", keywords: "board chess multiplayer AI free", wallet: "none" },
      { path: "/games/pool", group: "Games", title: "Night pool", line: "Line up a shot and play a game of pool.", keywords: "billiards pool multiplayer free", wallet: "none" },
      { path: "/games/poker", group: "Games", title: "Night poker", line: "Join a poker table or start your own.", keywords: "cards poker holdem multiplayer free", wallet: "optional" },
      { path: "/play", group: "Games", title: "Play LASTSPAWN", line: "Enter the LASTSPAWN game world.", keywords: "MMORPG lastspawn adventure online world", wallet: "none" },
      { path: "/games/live", group: "Watch and compete", title: "Watch live games", line: "Find active tables and watch people play.", keywords: "live tables spectator games watch", wallet: "none" },
      { path: "/arena", group: "Watch and compete", title: "Agent arena", line: "Watch AI agents compete and compare their results.", keywords: "arena AI agent competition benchmark", wallet: "none" },
      { path: "/league", group: "Watch and compete", title: "Paper trading league", line: "Follow the trading competition without spending real money.", keywords: "league practice paper trading leaderboard", wallet: "optional" },
      { path: "/league/:id", group: "Watch and compete", openPath: "/league", title: "League match details", line: "Choose a league entry to inspect its results.", keywords: "league match trader results id", wallet: "none" },
      { path: "/tg", group: "Games", title: "Telegram game room", line: "Find where the Telegram games have moved.", keywords: "telegram mini app moved games", wallet: "none" },
    ],
  },
  {
    id: "shift", name: "$SHIFT", short: "$SHIFT", accent: "#c6b48e", dock: "vault",
    line: "Understand the token, swap, stake, and follow funded rewards.",
    actions: [{ title: "About $SHIFT", path: "/token" }, { title: "Swap tokens", path: "/swap" }, { title: "Stake $SHIFT", path: "/stake" }],
    items: [
      { path: "/token", group: "Use $SHIFT", title: "About $SHIFT", line: "Read what the token does and its holder benefits.", keywords: "token SHIFT benefits discounts rewards", wallet: "none", aliases: ["/info"] },
      { path: "/swap", group: "Use $SHIFT", title: "Swap tokens", line: "Exchange tokens using your connected wallet.", keywords: "buy sell swap exchange SHIFT USDC", wallet: "required" },
      { path: "/deals", group: "Use $SHIFT", title: "Token Deals", line: "Buy and sell tokens at a fixed price through an escrow contract.", keywords: "otc deals deal escrow buy sell tokens discount desk marketplace bulk", wallet: "optional" },
      { path: "/stake", group: "Use $SHIFT", title: "Stake $SHIFT", line: "Deposit tokens to take part in staking rewards.", keywords: "staking stake lock deposit withdraw rewards", wallet: "required", aliases: ["/staking"] },
      { path: "/tokenomics", group: "Learn and follow", title: "Token supply explained", line: "See how $SHIFT is allocated and used.", keywords: "supply distribution allocation economics tokenomics", wallet: "none" },
      { path: "/whitepaper", group: "Learn and follow", title: "Read the whitepaper", line: "Read the full design and rules of NIGHTSHIFT.", keywords: "whitepaper documentation technical token rules", wallet: "none" },
      { path: "/watch", group: "Learn and follow", title: "Run a keeper", line: "Learn how to run a keeper for the network.", keywords: "keeper watchdog operations node run watch", wallet: "optional" },
      { path: "/partners", group: "Ecosystem", title: "Partner with NIGHTSHIFT", line: "Projects apply to bring their token into the ecosystem. Free.", keywords: "partners partnership apply register token project ecosystem listing collaborate", wallet: "optional" },
      { path: "/impact", group: "Learn and follow", title: "Track IMD impact", line: "See the published record of IMD activity.", keywords: "impact activity IMD outcomes record", wallet: "none" },
    ],
  },
  {
    id: "frogs", name: "Frogs", short: "Frogs", accent: "#9eafa1", dock: "garden",
    line: "Meet the NIGHT FROGS, send missions, and earn hours.",
    actions: [{ title: "Meet the Frogs", path: "/frogs" }, { title: "Frog missions", path: "/command" }, { title: "Operations deck", path: "/new/ship" }],
    items: [
      { path: "/frogs", title: "Meet NIGHT FROGS", line: "Explore the Frogs and how their earned hours work.", keywords: "NFT frogs collection hours frog pot holders", wallet: "optional" },
      { path: "/command", title: "Frog missions", line: "Send your Frogs on missions and track earned hours.", keywords: "missions command hours pot rewards", wallet: "required" },
      { path: "/forge", title: "Upgrade a Frog", line: "Review upgrades for the Frogs you own.", keywords: "forge upgrade equipment NFT frog", wallet: "required" },
      { path: "/new/ship", title: "Visit the operations deck", line: "See the Frogs, company tasks, games and Night Watchers at work.", keywords: "ship crew operations deck station interior world frogs", wallet: "none", aliases: ["/ship"] },
    ],
  },
  {
    id: "proof", name: "Proof & info", short: "Proof", accent: "#a29fbb", dock: "archive",
    line: "Read public receipts, follow activity, and check the rules.",
    actions: [{ title: "Public receipts", path: "/proof" }, { title: "Live station", path: "/live" }, { title: "Read the changes", path: "/changelog" }],
    items: [
      { path: "/proof", group: "Activity", title: "Public receipts", line: "Inspect public payments, receipts, and the wallets behind them.", keywords: "proof transactions evidence receipts payments reserve", wallet: "none", aliases: ["/economy", "/hr"] },
      { path: "/live", group: "Activity", title: "Live station activity", line: "Watch the station's public activity dashboard.", keywords: "live dashboard activity stream agents status", wallet: "none" },
      { path: "/changelog", group: "Activity", title: "What has changed", line: "Read the latest published changes to NIGHTSHIFT.", keywords: "changelog updates releases changes", wallet: "none" },
      { path: "/security", group: "Rules and safety", title: "Security and risks", line: "Read the security guidance before connecting or spending.", keywords: "security safety risks audit report vulnerability", wallet: "none" },
      { path: "/setup", group: "About the site", title: "Site administrator setup", line: "Configure the site with your administrator access key.", keywords: "admin configure settings setup operations environment", wallet: "optional" },
      { path: "/terms", group: "Rules and safety", title: "Terms and risks", line: "Read the terms for using NIGHTSHIFT.", keywords: "legal terms conditions risks policy", wallet: "none" },
      { path: "/privacy", group: "Rules and safety", title: "Your data privacy", line: "See how the site handles your data.", keywords: "privacy data cookies personal information", wallet: "none" },
      { path: "/llms.txt", group: "About the site", title: "Agent reading guide", line: "Read the plain text guide for AI agents.", keywords: "llms text documentation agent AI machine readable", wallet: "none" },
      { path: "/imd-status/", group: "Activity", title: "IMD service status", line: "Check the published status of the IMD swarm.", keywords: "IMD uptime status service health", wallet: "none" },
    ],
  },
];

export const sectionPath = (section: SiteSection) => `/new/${section.id}`;
export const itemPath = (item: SiteItem) => item.openPath ?? item.path;
export const findSection = (id: string) => SECTIONS.find((section) => section.id === id);
/** Aliases are included in search terms; every public route has one owner. */
export const SEARCH_ITEMS = SECTIONS.flatMap((section) => section.items.map((item) => ({
  section, item,
  search: [section.name, item.title, item.line, item.keywords, item.path, ...(item.aliases ?? [])].join(" ").toLowerCase(),
})));
