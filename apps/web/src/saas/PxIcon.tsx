/**
 * The protocol's own pixel icons: blocky 16-grid glyphs, one accent cell each.
 * Drawn by hand so the interface reads as a terminal, not a generic icon set.
 */
type Cell = [x: number, y: number, w?: number, h?: number];

const GLYPHS: Record<string, Cell[]> = {
  blocks: [[2, 2, 5, 5], [9, 2, 5, 5], [2, 9, 5, 5], [9, 9, 5, 5]],
  coin: [[3, 3, 10, 10], [6, 6, 4, 4]],
  stake: [[7, 2, 2, 12], [2, 7, 12, 2], [4, 4, 8, 8]],
  swap: [[2, 5, 9, 2], [2, 7, 9, 2], [4, 9, 9, 2], [4, 11, 9, 2]],
  shield: [[3, 2, 10, 3], [4, 5, 8, 4], [5, 9, 6, 3], [7, 12, 2, 2]],
  play: [[4, 3, 3, 3], [7, 6, 3, 4], [4, 10, 3, 3]],
  market: [[3, 6, 10, 8], [6, 2, 4, 4]],
  wallet: [[2, 4, 12, 9], [11, 7, 3, 3]],
  arrow: [[3, 7, 9, 2], [9, 4, 2, 8], [11, 6, 2, 4]],
  menu: [[2, 4, 12, 2], [2, 7, 12, 2], [2, 10, 12, 2]],
  close: [[3, 3, 2, 2], [11, 3, 2, 2], [5, 5, 2, 2], [9, 5, 2, 2], [7, 7, 2, 2], [5, 9, 2, 2], [9, 9, 2, 2], [3, 11, 2, 2], [11, 11, 2, 2]],
  bot: [[4, 3, 8, 2], [3, 5, 10, 7], [1, 7, 2, 3], [13, 7, 2, 3], [5, 7, 2, 2], [9, 7, 2, 2], [6, 11, 4, 1], [7, 12, 2, 2]],
  token: [[6, 2, 4, 2], [4, 4, 8, 8], [6, 12, 4, 2], [7, 7, 2, 2]],
  doc: [[4, 2, 8, 12], [6, 5, 4, 1], [6, 8, 4, 1], [6, 11, 3, 1]],
  link: [[3, 3, 4, 4], [9, 3, 4, 4], [3, 9, 4, 4], [9, 9, 4, 4], [7, 7, 2, 2]],
  pulse: [[2, 7, 3, 2], [5, 4, 2, 8], [7, 2, 2, 6], [9, 8, 2, 6], [11, 7, 3, 2]],
  grid: [[2, 2, 12, 1], [2, 2, 1, 12], [13, 2, 1, 12], [2, 13, 12, 1], [7, 7, 2, 2]],
  lock: [[4, 6, 8, 7], [6, 3, 4, 3], [7, 8, 2, 3]],
  bolt: [[7, 2, 3, 4], [5, 6, 3, 4], [8, 9, 3, 5]],
};

export type PxIconName = keyof typeof GLYPHS;

export function PxIcon({ name, size = 18, className = "" }: { name: string; size?: number; className?: string }) {
  const cells = ((GLYPHS as Record<string, number[][] | undefined>)[name] ?? GLYPHS.blocks) as number[][];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
      {cells.map(([x, y, w = 1, h = 1], index) => <rect key={index} x={x} y={y} width={w} height={h} />)}
    </svg>
  );
}
