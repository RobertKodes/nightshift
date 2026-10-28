import { SECTIONS } from "../site/sitemap";

/** Scene positions derive from the same six sections as search and navigation. */
export const DOCKS = SECTIONS.map((section, index) => ({
  id: section.id, name: section.name, color: section.accent, landmark: section.dock,
  angle: .35 + index * Math.PI * 2 / SECTIONS.length,
}));

export const CONNECTIONS = [
  "Tool sales (USDC) \u2192 Agent Reserve buys $SHIFT for the team wallet",
  "Staked games pay a 5% fee \u2192 stakers and the Frog pot",
  "Frogs earn hours \u2192 share of the Frog pot",
  "Holders of 500k $SHIFT or a Frog pay half on house tools",
] as const;

/** Sources match the four verified lines above, including their order. */
export const CONNECTION_ROUTES = [
  { from: "tools", to: "shift" }, { from: "play", to: "frogs" },
  { from: "frogs", to: "shift" }, { from: "shift", to: "tools" },
] as const;

export type FlightInput = {
  progress: number; pointerX: number; pointerY: number; heroBottom?: number;
  panelTop?: number; flowVisibility?: number[]; still?: boolean; header?: boolean;
};
export type DockProjection = { x: number; y: number; visible: boolean };
