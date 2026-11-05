/**
 * Stand-in for @hugeicons: the React Bits components here draw the protocol's own pixel glyphs instead,
 * so every icon on the site comes from one blocky 16-grid set. Same names, same `icon` prop.
 */
import type { CSSProperties } from "react";

type Cell = [x: number, y: number, w?: number, h?: number];
export type IconSvgElement = Cell[];

export const ArrowLeft01Icon: Cell[] = [[9, 3, 2, 2], [7, 5, 2, 2], [5, 7, 2, 2], [7, 9, 2, 2], [9, 11, 2, 2]];
export const ArrowRight01Icon: Cell[] = [[5, 3, 2, 2], [7, 5, 2, 2], [9, 7, 2, 2], [7, 9, 2, 2], [5, 11, 2, 2]];
export const ArrowRight02Icon: Cell[] = [[2, 7, 10, 2], [9, 4, 2, 2], [11, 6, 2, 4], [9, 10, 2, 2]];
export const ArrowDown01Icon: Cell[] = [[3, 5, 2, 2], [5, 7, 2, 2], [7, 9, 2, 2], [9, 7, 2, 2], [11, 5, 2, 2]];
export const Tick02Icon: Cell[] = [[2, 8, 2, 2], [4, 10, 2, 2], [6, 12, 2, 1], [8, 8, 2, 4], [10, 6, 2, 2], [12, 4, 2, 2]];
export const Cancel01Icon: Cell[] = [[3, 3, 2, 2], [11, 3, 2, 2], [5, 5, 2, 2], [9, 5, 2, 2], [7, 7, 2, 2], [5, 9, 2, 2], [9, 9, 2, 2], [3, 11, 2, 2], [11, 11, 2, 2]];
export const PlusSignIcon: Cell[] = [[7, 2, 2, 12], [2, 7, 12, 2]];
export const SparklesIcon: Cell[] = [[7, 1, 2, 4], [7, 11, 2, 4], [1, 7, 4, 2], [11, 7, 4, 2], [6, 6, 4, 4], [12, 2, 2, 2], [2, 12, 2, 2]];
export const File02Icon: Cell[] = [[4, 2, 6, 2], [4, 2, 2, 12], [4, 12, 8, 2], [10, 4, 2, 10], [7, 7, 3, 1], [7, 9, 3, 1]];
export const GitBranchIcon: Cell[] = [[3, 2, 2, 12], [11, 2, 2, 5], [9, 7, 2, 2], [5, 9, 4, 2]];
export const HelpCircleIcon: Cell[] = [[5, 2, 6, 2], [11, 4, 2, 3], [8, 7, 3, 2], [7, 9, 2, 2], [7, 12, 2, 2]];
export const Mic01Icon: Cell[] = [[6, 2, 4, 7], [4, 7, 1, 2], [11, 7, 1, 2], [5, 9, 6, 2], [7, 11, 2, 2], [5, 13, 6, 1]];
export const VolumeHighIcon: Cell[] = [[2, 6, 3, 4], [5, 4, 2, 8], [9, 5, 1, 6], [11, 3, 1, 10], [13, 1, 1, 14]];
export const VolumeLowIcon: Cell[] = [[3, 6, 3, 4], [6, 4, 2, 8], [10, 6, 1, 4]];

// the components' own demo content: a plain glyph each (our pages pass their own content)
const DOC: Cell[] = [[4, 2, 6, 2], [4, 2, 2, 12], [4, 12, 8, 2], [10, 4, 2, 10]];
const BOX: Cell[] = [[2, 3, 12, 2], [2, 3, 2, 10], [12, 3, 2, 10], [2, 11, 12, 2]];
const DOT: Cell[] = [[5, 5, 6, 6]];
export const Attachment01Icon: Cell[] = [[6, 2, 4, 2], [5, 4, 2, 8], [9, 4, 2, 6], [6, 12, 4, 2]];
export const Calendar03Icon: Cell[] = [...BOX, [5, 1, 2, 3], [9, 1, 2, 3], [5, 7, 2, 2], [9, 7, 2, 2]];
export const ChartLineData01Icon: Cell[] = [[2, 12, 12, 2], [3, 9, 2, 2], [5, 7, 2, 2], [8, 8, 2, 2], [11, 4, 2, 2]];
export const CodeIcon: Cell[] = [[5, 4, 2, 2], [3, 6, 2, 4], [5, 10, 2, 2], [9, 4, 2, 2], [11, 6, 2, 4], [9, 10, 2, 2]];
export const FingerPrintIcon: Cell[] = [[5, 2, 6, 2], [3, 4, 2, 8], [11, 4, 2, 6], [7, 6, 2, 8], [5, 7, 1, 5], [10, 9, 1, 5]];
export const Key01Icon: Cell[] = [[2, 5, 6, 6], [8, 7, 6, 2], [11, 9, 2, 2]];
export const Mail01Icon: Cell[] = [...BOX, [4, 5, 2, 2], [6, 7, 4, 2], [10, 5, 2, 2]];
export const Globe02Icon: Cell[] = [[5, 2, 6, 2], [3, 4, 2, 8], [11, 4, 2, 8], [5, 12, 6, 2], [7, 4, 2, 8], [3, 7, 10, 2]];
export const Folder01Icon: Cell[] = [[2, 3, 5, 2], [2, 5, 12, 8]];
export const Image01Icon: Cell[] = [...BOX, [4, 9, 3, 2], [7, 7, 3, 4], [10, 5, 2, 2]];
export const Table01Icon: Cell[] = [...BOX, [2, 7, 12, 1], [7, 3, 1, 10]];
export const Video01Icon: Cell[] = [[2, 4, 9, 8], [11, 6, 3, 4]];
export const Note01Icon = DOC, File01Icon = DOC, FileZipIcon = DOC, Pdf01Icon = DOC, Presentation01Icon = BOX;
export const MusicNote01Icon: Cell[] = [[9, 2, 2, 9], [11, 2, 3, 2], [5, 10, 5, 4]];
export const FigmaIcon = DOT, GithubIcon = DOT, NotionIcon = DOT, SlackIcon = DOT;

export function HugeiconsIcon({ icon, size = 16, color = "currentColor", strokeWidth: _s, className, style }: { icon: Cell[]; size?: number; color?: string; strokeWidth?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      {icon.map(([x, y, w = 1, h = 1], i) => <rect key={i} x={x} y={y} width={w} height={h} fill={color} />)}
    </svg>
  );
}
