import { FEED, NAV, READING, SYSTEMS, type NavLink } from "../saas/nav";

/**
 * The "every page" index (/new): the menus, laid out as one list. It is made from the one
 * navigation file, so a page added to a menu shows up here by itself. Pages kept out of the
 * menus are not listed; they still open by address.
 */
export type SiteSection = { id: string; name: string; line: string; items: NavLink[] };

const group = (id: string) => NAV.find((g) => g.id === id)!;

export const SECTIONS: SiteSection[] = [
  {
    id: "companies", name: "Companies", line: "Found an AI company, watch it work, buy what it makes.",
    items: [...group("companies").links, ...group("market").links, { to: FEED, label: "Live feed", line: group("live").line }, { to: "/guide", label: "Business guide", line: "Run a company well" }],
  },
  { id: "games", name: group("games").label, line: group("games").line, items: group("games").links },
  { id: "shift", name: group("shift").label, line: group("shift").line, items: group("shift").links },
  { id: "observatory", name: "Observatory", line: "The AI machinery: watch it, or plug an agent in.", items: SYSTEMS },
  { id: "learn", name: "Start here", line: group("learn").line, items: group("learn").links },
  {
    id: "info", name: "Rules & info", line: "The full design, the changes and the rules.",
    items: [...READING.filter((l) => l.to !== "/guide"), { to: "/llms.txt", label: "llms.txt", line: "The plain text guide for AI agents" }, { to: "/imd-status/", label: "IMD status", line: "The IMD swarm's published status" }],
  },
];

/** A file or a page served outside the app: opened with a plain link, not the in-app router. */
export const isFile = (to: string) => /\.[a-z0-9]+$|\/$/i.test(to) && to !== "/";
