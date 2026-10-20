import { memo, useMemo } from "react";
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { Icon } from "../Icon";

/**
 * NIGHT CHESS on a phone inside Telegram: a flat board that renders in a frame, with the game's
 * own piece glyphs on Moonlight (white) and Ultraviolet (black) tokens. 64 buttons, no WebGL, so it
 * stays fast on any device. Tap a piece, then a marked square; every square has a label.
 */
const NAMES: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
type Props = {
  fen: string; orientation: Color; selectable: Color | null; selected: Square | null;
  targets: { square: Square; capture: boolean }[]; lastMove: { from: string; to: string } | null; check: boolean;
  onSquare?: (s: Square) => void;
};

function BoardImpl({ fen, orientation, selectable, selected, targets, lastMove, check, onSquare }: Props) {
  const game = useMemo(() => new Chess(fen), [fen]);
  const turn = game.turn();
  const files = orientation === "w" ? "abcdefgh" : "hgfedcba", ranks = orientation === "w" ? "87654321" : "12345678";
  const target = new Map(targets.map((t) => [t.square, t]));
  const cells = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const sq = `${files[f]}${ranks[r]}` as Square, p = game.get(sq);
    // a1 is a dark square, h1 a light one
    const light = (sq.charCodeAt(0) - 97 + Number(sq[1])) % 2 === 0;
    const t = target.get(sq), last = lastMove && (lastMove.from === sq || lastMove.to === sq);
    const king = check && p?.type === "k" && p.color === turn;
    const mine = !!p && p.color === selectable;
    const label = `${sq}${p ? `, ${p.color === "w" ? "white" : "black"} ${NAMES[p.type]}` : ""}${t ? (t.capture ? ", capture" : ", move here") : ""}${selected === sq ? ", selected" : ""}`;
    cells.push(
      <button type="button" key={sq} className={`tb-sq ${light ? "l" : "d"}${last ? " last" : ""}${selected === sq ? " sel" : ""}${king ? " check" : ""}${mine ? " mine" : ""}`}
        aria-label={label} disabled={!onSquare || selectable === null} onClick={() => onSquare?.(sq)}>
        {p && <span className={`tb-pc ${p.color}${lastMove?.to === sq ? " moved" : ""}`}><Icon name={`chess-${NAMES[p.type]}`} size={26} /></span>}
        {t && <i className={t.capture ? "tb-cap" : "tb-dot"} aria-hidden="true" />}
        {f === 0 && <small className="tb-rank" aria-hidden="true">{ranks[r]}</small>}
        {r === 7 && <small className="tb-file" aria-hidden="true">{files[f]}</small>}
      </button>,
    );
  }
  return <div className="tb-board" role="group" aria-label={`Chess board, ${orientation === "w" ? "white" : "black"} at the bottom`}>{cells}</div>;
}
export const Board2D = memo(BoardImpl);
