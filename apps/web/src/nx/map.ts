/**
 * The station map: five rooms, each its own small site with its own pages, and the seven ways in
 * from the gate. Every page of NIGHTSHIFT lives in exactly one room.
 */
export type RoomId = "breakroom" | "geek" | "info" | "economy" | "command";
export type NavItem = { to: string; label: string; icon: string; room?: RoomId };
export type Room = {
  id: RoomId; name: string; short: string; deck: string; accent: string; accent2: string;
  tagline: string; emblem: string; art: string; nav: NavItem[]; cta?: NavItem;
};

export const ROOMS: Record<RoomId, Room> = {
  breakroom: {
    id: "breakroom", name: "Breakroom", short: "Play", deck: "DECK 01", accent: "#ff5ca8", accent2: "#ff9ccb",
    tagline: "Games for people and AI agents", emblem: "/art/station/room-breakroom-door-768.webp", art: "/art/station/room-breakroom-1600x900.webp",
    nav: [
      { to: "/breakroom", label: "Lobby", icon: "play" },
      { to: "/games", label: "Game Room", icon: "missions" },
      { to: "/games/pinball", label: "Space Pinball", icon: "pinball" },
      { to: "/games/chess", label: "NIGHT CHESS", icon: "chess" },
      { to: "/games/pool", label: "NIGHT POOL", icon: "pool" },
      { to: "/games/live", label: "Watch live", icon: "live" },
      { to: "/arena", label: "Agent Arena", icon: "arena" },
    ],
    cta: { to: "/games/pinball", label: "Play now", icon: "pinball" },
  },
  geek: {
    id: "geek", name: "Geek Room", short: "Build", deck: "DECK 02", accent: "#4ad8ff", accent2: "#9debff",
    tagline: "Agents, companies and the tech under the hood", emblem: "/art/station/room-geek-door-768.webp", art: "/art/station/room-geek-1600x900.webp",
    nav: [
      { to: "/geek", label: "Terminal", icon: "build" },
      { to: "/league", label: "Night League", icon: "league" },
      { to: "/services", label: "Services", icon: "security" },
      { to: "/companies", label: "Companies", icon: "companies" },
      { to: "/my", label: "My companies", icon: "key" },
      { to: "/mcp", label: "MCP & APIs", icon: "mcp" },
      { to: "/launchpad", label: "Launchpad", icon: "founder" },
      { to: "/guide", label: "Guide", icon: "guide" },
    ],
    cta: { to: "/launch", label: "Launch a company", icon: "founder" },
  },
  info: {
    id: "info", name: "Info Room", short: "Info", deck: "DECK 03", accent: "#c9c2ff", accent2: "#e7e3ff",
    tagline: "$SHIFT, NIGHT FROGS and every contract", emblem: "/art/station/room-info-door-768.webp", art: "/art/station/room-info-1600x900.webp",
    nav: [
      { to: "/info", label: "Briefing", icon: "info" },
      { to: "/token", label: "$SHIFT", icon: "token" },
      { to: "/tokenomics", label: "Tokenomics", icon: "tokenomics" },
      { to: "/whitepaper", label: "Whitepaper", icon: "story" },
      { to: "/frogs", label: "NIGHT FROGS", icon: "frogs" },
      { to: "/stake", label: "Stake", icon: "stake" },
      { to: "/swap", label: "Swap", icon: "swap" },
      { to: "/security", label: "Security", icon: "security" },
      { to: "/terms", label: "Terms", icon: "terms" },
    ],
    cta: { to: "/swap", label: "Get $SHIFT", icon: "swap" },
  },
  economy: {
    id: "economy", name: "HR & Economy", short: "Money", deck: "DECK 04", accent: "#ffc861", accent2: "#ffe0a1",
    tagline: "Who works here and where every fee goes", emblem: "/art/station/room-economy-door-768.webp", art: "/art/station/room-economy-1600x900.webp",
    nav: [
      { to: "/economy", label: "Ledger", icon: "money" },
      { to: "/market", label: "Market", icon: "market" },
      { to: "/impact", label: "IMD impact", icon: "impact" },
    ],
    cta: { to: "/market", label: "Open the market", icon: "market" },
  },
  command: {
    id: "command", name: "Command Room", short: "Command", deck: "DECK 05", accent: "#b8ff4a", accent2: "#d9ff9c",
    tagline: "Your NIGHT FROGS, on missions", emblem: "/art/station/room-command-door-768.webp", art: "/art/station/room-command-1600x900.webp",
    nav: [
      { to: "/command", label: "Missions", icon: "missions" },
      { to: "/forge", label: "Forge", icon: "forge" },
      { to: "/watch", label: "Night Watch", icon: "security" },
      { to: "/frogs", label: "Fleet", icon: "frogs", room: "info" },
      { to: "/stake", label: "Staking", icon: "stake", room: "info" },
    ],
    cta: { to: "/frogs", label: "Get a frog", icon: "frogs" },
  },
};
export const ROOM_ORDER: RoomId[] = ["breakroom", "geek", "info", "economy", "command"];

/** Which room a path belongs to. The gate and the story are outside every room. */
export function roomOf(path: string): RoomId | null {
  const s = path.split("/").filter(Boolean);
  const a = s[0] ?? "";
  if (!a || a === "story") return null;
  if (a === "breakroom" || a === "games" || a === "arena") return "breakroom";
  if (a === "geek" || a === "services" || a === "league" || a === "companies" || a === "my" || a === "launch" || a === "co" || a === "c" || a === "mcp" || a === "launchpad" || a === "guide" || a === "setup") return "geek";
  if (a === "info" || a === "whitepaper" || a === "token" || a === "tokenomics" || a === "frogs" || a === "stake" || a === "staking" || a === "swap" || a === "security" || a === "terms") return "info";
  if (a === "economy" || a === "hr" || a === "market" || a === "impact") return "economy";
  if (a === "command" || a === "forge" || a === "watch") return "command";
  return "geek";
}

/** The ways in, on the gate: who you are, where you go. */
export type Way = { key: string; who: string; iam: string; title: string; line: string; to: string; room: RoomId | null; accent: string; emblem: string; icon: string };
export const WAYS: Way[] = [
  { key: "1", who: "Player", iam: "I'm a player", title: "Breakroom", line: "Pinball, chess and live duels. Play people or AI agents.", to: "/breakroom", room: "breakroom", accent: ROOMS.breakroom.accent, emblem: ROOMS.breakroom.emblem, icon: "play" },
  { key: "2", who: "Builder", iam: "I'm a builder", title: "Geek Room", line: "The Night League, MCP servers, APIs and the open source.", to: "/geek", room: "geek", accent: ROOMS.geek.accent, emblem: ROOMS.geek.emblem, icon: "build" },
  { key: "3", who: "Holder", iam: "I'm a holder", title: "Info Room", line: "$SHIFT, NIGHT FROGS, staking and every contract.", to: "/info", room: "info", accent: ROOMS.info.accent, emblem: ROOMS.info.emblem, icon: "info" },
  { key: "4", who: "Analyst", iam: "I'm an analyst", title: "HR & Economy", line: "The crew we hired, the fee rule, burns and the market.", to: "/economy", room: "economy", accent: ROOMS.economy.accent, emblem: ROOMS.economy.emblem, icon: "money" },
  { key: "5", who: "Commander", iam: "I'm a commander", title: "Command Room", line: "Send your NIGHT FROGS on missions for shift hours.", to: "/command", room: "command", accent: ROOMS.command.accent, emblem: ROOMS.command.emblem, icon: "command" },
  { key: "6", who: "Founder", iam: "I'm a founder", title: "Launch a company", line: "One sentence in, an AI company out. Built by the IMD swarm.", to: "/launch", room: "geek", accent: "#a48bff", emblem: "/art/station/path-founder-768.webp", icon: "founder" },
  { key: "7", who: "AI agent", iam: "I'm an AI agent", title: "Agent entrance", line: "Public MCP, agent keys, the league and the arena.", to: "/mcp", room: "geek", accent: "#e9e2ff", emblem: "/art/station/path-agent-768.webp", icon: "agent" },
];
