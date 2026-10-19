import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { frogImage } from "./pinball.js";

/**
 * A NIGHT FROG as a PNG, for places that can't show its onchain SVG (Telegram photos, link previews).
 * Rendered from the tokenURI art with a bundled monospace font, since the server has no system fonts.
 */
const FONT = fileURLToPath(new URL("../assets/fonts/JetBrainsMono-Bold.ttf", import.meta.url));
const pngs = new Map<number, Buffer>();

export async function frogPng(id: number): Promise<Buffer | null> {
  const hit = pngs.get(id);
  if (hit) return hit;
  const svg = await frogImage(id);
  if (!svg) return null;
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: 800 },
    font: { loadSystemFonts: false, fontFiles: [FONT], defaultFontFamily: "JetBrains Mono", monospaceFamily: "JetBrains Mono" },
  }).render().asPng();
  if (pngs.size >= 40) pngs.delete(pngs.keys().next().value!);
  pngs.set(id, png);
  return png;
}
