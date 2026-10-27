/** Three task doors; old room IDs keep existing page links working. */
export type RoomId = "breakroom" | "geek" | "info" | "economy" | "command";
export type NavItem = { to: string; label: string; icon: string; room?: RoomId };
export type Room = {
  id: RoomId; name: string; short: string; deck: string; accent: string; accent2: string;
  tagline: string; emblem: string; art: string; nav: NavItem[]; more?: NavItem[]; cta?: NavItem;
};

export const ROOMS: Record<RoomId, Room> = {
  geek: {
    id: "geek", name: "AI tools", short: "AI tools", deck: "DOOR 01", accent: "#4ad8ff", accent2: "#9debff",
    tagline: "Check a token, test an API, find research, or hire the IMD swarm.", emblem: "/art/station/room-geek-door-768.webp", art: "/art/station/room-geek-1600x900.webp",
    nav: [{ to: "/services", label: "AI tools", icon: "build" }, { to: "/watchtower", label: "Token monitor", icon: "security" }, { to: "/mind", label: "Research", icon: "agent" }],
    more: [
      { to: "/companies", label: "Companies", icon: "companies" }, { to: "/my", label: "My companies", icon: "key" },
      { to: "/launch", label: "Start a business", icon: "founder" }, { to: "/market", label: "Market", icon: "market" },
      { to: "/launchpad", label: "Launch a token", icon: "founder" }, { to: "/crews", label: "Operators & samples", icon: "crew" },
      { to: "/sniper", label: "Launch alerts", icon: "sniper" }, { to: "/services/imd-feed", label: "Developer data", icon: "mcp" },
      { to: "/guide", label: "Business guide", icon: "guide" },
    ],
    cta: { to: "/mcp", label: "Connect an AI agent", icon: "agent" },
  },
  breakroom: {
    id: "breakroom", name: "Play", short: "Play", deck: "DOOR 02", accent: "#ff5ca8", accent2: "#ff9ccb",
    tagline: "Pinball, chess, pool and poker. No wallet needed to start.", emblem: "/art/station/room-breakroom-door-768.webp", art: "/art/station/room-breakroom-1600x900.webp",
    nav: [{ to: "/games", label: "Play", icon: "play" }, { to: "/games/live", label: "Watch games", icon: "live" }, { to: "/arena", label: "AI / Arena", icon: "arena" }],
    more: [{ to: "/league", label: "Paper trading league", icon: "league" }],
  },
  info: {
    id: "info", name: "$SHIFT", short: "$SHIFT", deck: "DOOR 03", accent: "#c9c2ff", accent2: "#e7e3ff",
    tagline: "Benefits, swap, staking and funded rewards.", emblem: "/art/station/room-info-door-768.webp", art: "/art/station/room-info-1600x900.webp",
    nav: [{ to: "/token", label: "$SHIFT", icon: "token" }, { to: "/swap", label: "Swap", icon: "swap" }, { to: "/stake", label: "Stake SHIFT", icon: "stake" }, { to: "/frogs", label: "Frogs", icon: "frogs" }],
    more: [{ to: "/tokenomics", label: "Tokenomics", icon: "tokenomics" }, { to: "/whitepaper", label: "Whitepaper", icon: "story" }, { to: "/watch", label: "Run a keeper", icon: "security" }],
  },
  economy: {
    id: "economy", name: "Activity & receipts", short: "Proof", deck: "PROOF", accent: "#ffc861", accent2: "#ffe0a1",
    tagline: "Payments and receipts", emblem: "/art/station/room-economy-door-768.webp", art: "/art/station/room-economy-1600x900.webp",
    nav: [{ to: "/proof", label: "Proof", icon: "pulse" }],
  },
  command: {
    id: "command", name: "Frogs", short: "Frogs", deck: "FROGS", accent: "#b8ff4a", accent2: "#d9ff9c",
    tagline: "Missions, upgrades and earned hours", emblem: "/art/station/room-command-door-768.webp", art: "/art/station/room-command-1600x900.webp",
    nav: [{ to: "/frogs", label: "Frogs", icon: "frogs" }, { to: "/command", label: "Missions", icon: "missions" }, { to: "/forge", label: "Upgrade Frogs", icon: "forge" }],
  },
};
export const ROOM_ORDER: RoomId[] = ["geek", "breakroom", "info"];

/** Old URLs belong to the same three doors. */
export function roomOf(path: string): RoomId | null {
  const a = path.split("/").filter(Boolean)[0] ?? "";
  if (!a || a === "story") return null;
  if (["breakroom", "games", "arena", "league", "play"].includes(a)) return "breakroom";
  if (["info", "whitepaper", "token", "tokenomics", "frogs", "stake", "staking", "swap", "command", "forge", "watch", "ship"].includes(a)) return "info";
  return "geek";
}

export type Way = { key: string; title: string; line: string; to: string; room: RoomId; accent: string; emblem: string; icon: string };
export const WAYS: Way[] = ROOM_ORDER.map((id, i) => ({ key: String(i + 1), title: ROOMS[id].name, line: ROOMS[id].tagline, to: ROOMS[id].nav[0]!.to, room: id, accent: ROOMS[id].accent, emblem: ROOMS[id].emblem, icon: id === "geek" ? "build" : id === "breakroom" ? "play" : "token" }));
