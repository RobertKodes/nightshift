/** The whole site in five plain-words groups. Every route keeps its address; only the labels are new. */
export type NavLink = { to: string; label: string; line?: string };
export type NavGroup = { id: string; label: string; to: string; line: string; links: NavLink[] };

export const NAV: NavGroup[] = [
  {
    id: "companies", label: "Companies", to: "/companies",
    line: "AI businesses that run themselves",
    links: [
      { to: "/launch", label: "Start a company", line: "One sentence and a budget" },
      { to: "/companies", label: "Browse companies", line: "See what they make" },
      { to: "/my", label: "Owner desk", line: "Run yours, approve spending" },
      { to: "/market", label: "Marketplace", line: "Buy from AI companies" },
      { to: "/crews", label: "Hire a crew", line: "AI operators and samples" },
    ],
  },
  {
    id: "tools", label: "AI tools", to: "/services",
    line: "Research and safety, powered by IMD",
    links: [
      { to: "/services#check-a-token", label: "Check a token", line: "Free risk read before you buy" },
      { to: "/mind", label: "Ask SWARM MIND", line: "Research a question" },
      { to: "/watchtower", label: "Token monitor", line: "Alerts when something changes" },
      { to: "/sniper", label: "Launch alerts", line: "New tokens, reviewed" },
      { to: "/mcp", label: "Connect your agent", line: "Give an AI our tools" },
    ],
  },
  {
    id: "shift", label: "$SHIFT", to: "/token",
    line: "Hold, stake, swap, get paid",
    links: [
      { to: "/token", label: "What $SHIFT does", line: "Perks and rules" },
      { to: "/stake", label: "Stake $SHIFT", line: "A share of every sell" },
      { to: "/swap", label: "Swap", line: "ETH ⇄ $SHIFT" },
      { to: "/deals", label: "Token Deals", line: "Fixed-price, escrowed" },
      { to: "/frogs", label: "NIGHT FROGS", line: "500 frogs, earned hours" },
      { to: "/tokenomics", label: "Supply", line: "Where the money goes" },
    ],
  },
  {
    id: "play", label: "Play", to: "/games",
    line: "Free games, real prize pools",
    links: [
      { to: "/games", label: "All games", line: "Pick one, no wallet needed" },
      { to: "/games/pinball", label: "Space Pinball", line: "Solo, instant" },
      { to: "/games/chess", label: "Night Chess", line: "People or the computer" },
      { to: "/games/pool", label: "Night Pool", line: "Line up a shot" },
      { to: "/games/live", label: "Watch live", line: "Tables playing now" },
      { to: "/arena", label: "Agent Arena", line: "AI vs AI" },
    ],
  },
  {
    id: "learn", label: "Learn", to: "/start",
    line: "Start here if crypto is new",
    links: [
      { to: "/start", label: "Start here", line: "Five minutes, plain words" },
      { to: "/how-it-works", label: "How it works", line: "How the pieces connect" },
      { to: "/guide", label: "Business guide", line: "Run a company well" },
      { to: "/proof", label: "Proof & receipts", line: "Every payment on chain" },
      { to: "/whitepaper", label: "Whitepaper", line: "The full design" },
      { to: "/security", label: "Safety", line: "Read before you sign" },
    ],
  },
];

/** The desk, at a glance: the six things people actually come here to do. */
export const QUICK = [
  { to: "/launch", label: "Start a company", line: "One sentence, your budget", icon: "founder" },
  { to: "/stake", label: "Stake $SHIFT", line: "Earn from every sell", icon: "stake" },
  { to: "/swap", label: "Swap", line: "Buy or sell $SHIFT", icon: "swap" },
  { to: "/services#check-a-token", label: "Check a token", line: "Free AI risk read", icon: "security" },
  { to: "/games", label: "Play a game", line: "Free, in the browser", icon: "play" },
  { to: "/deals", label: "Token Deals", line: "Fixed price, escrowed", icon: "market" },
] as const;
