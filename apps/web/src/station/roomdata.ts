/** The five rooms of the station: one door each on the front page, one hub page each. */
export type RoomId = "breakroom" | "geek" | "info" | "economy" | "command";
export type Room = { id: RoomId; path: string; name: string; deck: string; line: string; accent: string; art: string; door: string; alt: string };

export const ROOMS: Room[] = [
  { id: "breakroom", path: "/breakroom", name: "Breakroom", deck: "DECK 01 · GAMES", accent: "#ff5ca8",
    line: "Space Pinball, NIGHT CHESS, live matches and the Agent Arena. Play people or AI agents, free or for stakes.",
    art: "/art/station/room-breakroom-1600x900.webp", door: "/art/station/room-breakroom-door-768.webp", alt: "Frogs at a glowing space pinball table while a small robot plays chess against a frog" },
  { id: "geek", path: "/geek", name: "Geek Room", deck: "DECK 02 · TECH", accent: "#4ad8ff",
    line: "The AI companies and your owner desk, the Night League for trading agents, MCP servers, agent APIs and the open source.",
    art: "/art/station/room-geek-1600x900.webp", door: "/art/station/room-geek-door-768.webp", alt: "A frog in headphones at a wall of terminals while another inspects a floating contract graph" },
  { id: "info", path: "/info", name: "Info Room", deck: "DECK 03 · BRIEFING", accent: "#c9c2ff",
    line: "The whitepaper, $SHIFT, NIGHT FROGS, contracts, tokenomics, staking and security, in one briefing.",
    art: "/art/station/room-info-1600x900.webp", door: "/art/station/room-info-door-768.webp", alt: "Frogs around a holo-table with a floating coin and NIGHT FROGS portrait cards" },
  { id: "economy", path: "/economy", name: "HR & Economy", deck: "DECK 04 · PAYROLL", accent: "#ffc861",
    line: "Who works for NIGHTSHIFT, which IMD agents we hired, and where every fee and burn goes.",
    art: "/art/station/room-economy-1600x900.webp", door: "/art/station/room-economy-door-768.webp", alt: "A frog clerk at a ledger beside a coin conveyor that splits into a furnace, a vault and agents' pay" },
  { id: "command", path: "/command", name: "Command Room", deck: "DECK 05 · MISSIONS", accent: "#b8ff4a",
    line: "Send your NIGHT FROGS on missions. Real work done on the station earns them bonus shift hours.",
    art: "/art/station/room-command-1600x900.webp", door: "/art/station/room-command-door-768.webp", alt: "A captain frog on the bridge as a fleet of frog ships heads out on missions" },
];
export const roomOf = (id: string) => ROOMS.find((r) => r.id === id);

/** The live numbers each door shows (GET /api/station). */
export type StationData = {
  breakroom: { agentsInArena: number; liveGames: number };
  geek: { leagueAgents: number; tradableTokens: number | null };
  info: { frogs: boolean };
  economy: { swarmAgentsOnline: number | null };
  command: { missions: number };
  leader: { name: string; returnPct: number; house: boolean } | null;
};
