/**
 * The one navigation system. The header, the phone drawer, the page tabs, the footer and the
 * "every page" index all read this file. Every route keeps its address; a page that is not
 * listed here still opens by URL, it is simply not in a menu.
 */
export type NavLink = { to: string; label: string; line?: string };
export type NavGroup = { id: NavId; label: string; to: string; line: string; links: NavLink[] };
export type NavId = "companies" | "market" | "live" | "games" | "shift" | "observatory" | "learn";

/** The founding route: the big button everywhere points here. */
export const FOUND = "/launch";
/** The live feed is the front page; this address scrolls to it. */
export const FEED = "/#feed";

/** The main menu, in the order it is shown. A group with one link is a plain link. */
export const NAV: NavGroup[] = [
  {
    id: "companies", label: "Companies", to: "/companies",
    line: "AI companies, founded in two minutes",
    links: [
      { to: FOUND, label: "Found a company", line: "Two minutes, free" },
      { to: "/companies", label: "Browse companies", line: "See what they make and sell" },
      { to: "/my", label: "Owner desk", line: "Run yours, talk to its CEO" },
    ],
  },
  {
    id: "market", label: "Market", to: "/market",
    line: "Buy what the companies make",
    links: [{ to: "/market", label: "Market", line: "Buy what the companies make" }],
  },
  {
    id: "live", label: "Live", to: FEED,
    line: "What every company did, as it happens",
    links: [{ to: FEED, label: "Live", line: "What every company did, as it happens" }],
  },
  {
    id: "games", label: "Games", to: "/games",
    line: "Free games in the browser",
    links: [
      { to: "/games", label: "All games", line: "Pick one, no wallet needed" },
      { to: "/games/pinball", label: "Space Pinball", line: "Solo, instant" },
      { to: "/games/chess", label: "Night Chess", line: "People or the computer" },
      { to: "/games/pool", label: "Night Pool", line: "Line up a shot" },
      { to: "/games/poker", label: "Night Poker", line: "Join a table" },
      { to: "/games/live", label: "Watch games", line: "Tables playing now" },
    ],
  },
  {
    id: "shift", label: "$SHIFT", to: "/token",
    line: "The token, staking and the frogs",
    links: [
      { to: "/token", label: "What $SHIFT does", line: "Perks and rules" },
      { to: "/stake", label: "Stake $SHIFT", line: "A share of every sell" },
      { to: "/leaderboard", label: "Leaderboard", line: "Top stakers and earners" },
      { to: "/frogs", label: "NIGHT FROGS", line: "500 frogs, earned hours" },
      { to: "/command", label: "Frog missions", line: "Weekly missions for frog holders" },
      { to: "/watch", label: "Night Watch", line: "Run a keeper, earn from imdUSD" },
      { to: "/tokenomics", label: "Supply", line: "Where the money goes" },
    ],
  },
  {
    id: "observatory", label: "Observatory", to: "/observatory",
    line: "The AI machinery, live",
    links: [{ to: "/observatory", label: "Observatory", line: "The AI machinery, live" }],
  },
  {
    id: "learn", label: "Start here", to: "/start",
    line: "New here? Read this first",
    links: [
      { to: "/start", label: "Start here", line: "Five minutes, plain words" },
      { to: "/how-it-works", label: "How it works", line: "How the pieces connect" },
      { to: "/proof", label: "Proof & receipts", line: "Every payment on chain" },
      { to: "/security", label: "Safety", line: "Read before you sign" },
    ],
  },
];

/**
 * Everything AI and agent facing. These pages left the main menu: the Observatory shows each
 * one live and links to it as "details". Agents' links to them keep working.
 */
export const SYSTEMS: NavLink[] = [
  { to: "/observatory", label: "Observatory", line: "Every system on one page" },
  { to: "/services", label: "AI tools", line: "Token Verdict, Hook Inspector, IMD feed" },
  { to: "/mind", label: "SWARM MIND", line: "What the IMD swarm published" },
  { to: "/watchtower", label: "Watchtower", line: "What changed on a token or hook" },
  { to: "/crews", label: "Crews", line: "House crews and outside agents" },
  { to: "/mcp", label: "MCP server", line: "Plug an AI agent in" },
  { to: "/agents/start", label: "Register an agent", line: "Join as an outside operator" },
  { to: "/arena", label: "Agent Arena", line: "AI against AI at chess" },
  { to: "/league", label: "Night League", line: "Paper trading, agents only" },
  { to: "/sniper", label: "Night Sniper", line: "Every IMD launch, checked" },
  { to: "/impact", label: "IMD impact", line: "What NIGHTSHIFT paid the swarm" },
];

/** Reading that sits in the footer and the index, not in the header. */
export const READING: NavLink[] = [
  { to: "/guide", label: "Business guide", line: "Run a company well" },
  { to: "/whitepaper", label: "Whitepaper", line: "The full design" },
  { to: "/changelog", label: "Changelog", line: "What changed, in order" },
  { to: "/terms", label: "Terms & risks", line: "The rules of use" },
  { to: "/privacy", label: "Privacy", line: "What the site keeps" },
  { to: "/delete-account", label: "Delete account", line: "Remove your data" },
];

const first = (path: string) => path.split(/[?#]/)[0]!.split("/").filter(Boolean)[0] ?? "";
const OWNER: Record<string, NavId> = {
  companies: "companies", launch: "companies", my: "companies", co: "companies", c: "companies", guide: "companies",
  market: "market",
  games: "games",
  token: "shift", stake: "shift", staking: "shift", leaderboard: "shift", frogs: "shift", tokenomics: "shift", command: "shift", forge: "shift",
  observatory: "observatory", services: "observatory", mind: "observatory", watchtower: "observatory", crews: "observatory", mcp: "observatory",
  agents: "observatory", arena: "observatory", league: "observatory", sniper: "observatory", impact: "observatory",
  start: "learn", "how-it-works": "learn", proof: "learn", security: "learn",
};

/** Which menu group a page belongs to: null for the front page and for pages kept out of the menus. */
export const groupOf = (path: string): NavId | null => (first(path) ? OWNER[first(path)] ?? null : "live");

/** The tabs under the header on a page of that group. */
export function tabsOf(id: NavId | null): NavLink[] {
  if (!id || id === "live" || id === "market") return [];
  if (id === "observatory") return SYSTEMS;
  return NAV.find((group) => group.id === id)?.links ?? [];
}

/** The older page styles still key off three skins (nx.css `[data-room]`); this picks one for a path. */
export type Skin = "geek" | "breakroom" | "info" | "station";
export function skinOf(path: string): Skin {
  const a = first(path);
  if (["", "start", "new", "observatory"].includes(a)) return "station";
  if (["games", "arena", "league", "play"].includes(a)) return "breakroom";
  if (["whitepaper", "token", "tokenomics", "frogs", "stake", "staking", "swap", "command", "forge", "watch", "ship", "deals", "partners", "leaderboard"].includes(a)) return "info";
  return "geek";
}
export const SKIN_ACCENT: Record<Skin, [string, string]> = { station: ["#b8ff3d", "#d8ffa0"], geek: ["#62d9cf", "#b6f2ec"], breakroom: ["#f0a3b6", "#fbd3dc"], info: ["#f2c14e", "#ffe6a8"] };

/** True when `to` is the page being shown, or a parent of it. */
export const isOn = (path: string, to: string) => {
  const target = to.split(/[?#]/)[0]!;
  return path === target || (target !== "/" && path.startsWith(`${target}/`));
};
