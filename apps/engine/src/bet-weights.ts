import { Chess } from "chess.js";

/**
 * Live betting weights ("fast betting with logic"). Every bet carries a weight in basis points,
 * 500..10000, that the server signs into its ticket; at the end winners share the losing side in
 * proportion to amount × weight. The weight comes from the game at the moment of the bet:
 *
 *   progress   p ∈ [0, 1]   how far the game is. Chess: plies against a typical 80-ply game, or the
 *                           share of both clocks used up, whichever is further. Pinball: the
 *                           duel's clock against its longest game.
 *   confidence c ∈ [0, 1)   how clear the leader is. Chess: c = tanh(|e| / 5) for an evaluation e
 *                           in pawns (material, check, a mate threat, the clock edge). Pinball:
 *                           c = |a − b| / max(a + b, 40 000) on the live scores.
 *
 *   base    = 1 − 0.65·p                  early bets count fully, the last ones about a third
 *   leader  = base · (1 − 0.8·c)          backing the side that is ahead counts less…
 *   trailer = min(1, base · (1 + 0.5·c))  …and backing the side behind a little more
 *   weightBps = clamp(round(10 000 · w), 500, 10 000)
 *
 * With nobody ahead both sides get `base`. Betting LOCKS (no ticket at all) when the result is
 * near certain or the game is about to end, and while a player is away:
 *   chess    the game is over or not started; mate in one is on the board; the first 10 s after
 *            a queen or rook was taken or a check given; one side is a queen (9 points) up with the
 *            game half played or more; either clock under 20 s; a player reconnecting.
 *   pinball  the duel is over or not started; the last 20% of its clock; a table has drained its
 *            last ball; a table stopped counting; a player reconnecting.
 */
export const MIN_WEIGHT = 500;
export const MAX_WEIGHT = 10_000;
export type Weights = {
  /** Weight in bps for a bet on side A (chess: white; pinball: player 1) and on side B. */
  a: number; b: number;
  /** Why no ticket is given now, or null. */
  locked: string | null;
  progress: number; confidence: number;
  /** The side ahead: 0 = A, 1 = B, null = level. */
  leader: 0 | 1 | null;
};

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
export const bps = (w: number) => Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, Math.round(w * 10_000)));

/** The formula above, from progress, confidence and who leads. */
export function shape(progress: number, confidence: number, leader: 0 | 1 | null, locked: string | null = null): Weights {
  const p = clamp01(progress), c = leader === null ? 0 : clamp01(confidence);
  const base = 1 - 0.65 * p;
  const ahead = bps(base * (1 - 0.8 * c)), behind = bps(Math.min(1, base * (1 + 0.5 * c)));
  return { a: leader === 1 ? behind : ahead, b: leader === 0 ? behind : ahead, locked, progress: p, confidence: c, leader };
}

// ---- NIGHT CHESS

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/** What a position says on its own (cached per FEN: spectators poll, positions repeat). */
export type ChessEval = { white: number; black: number; turn: "w" | "b"; check: boolean; mateInOne: boolean; threat: -1 | 0 | 1 };
const evals = new Map<string, ChessEval>();

function mates(g: Chess): boolean {
  for (const m of g.moves({ verbose: true })) {
    g.move({ from: m.from, to: m.to, promotion: m.promotion });
    const mate = g.isCheckmate();
    g.undo();
    if (mate) return true;
  }
  return false;
}

/** Material for each side, check, a mate in one for the side to move, and a mate threat by the other side (if it could move again). */
export function evaluate(fen: string): ChessEval {
  const hit = evals.get(fen);
  if (hit) return hit;
  const g = new Chess(fen);
  let white = 0, black = 0;
  for (const row of g.board()) for (const sq of row) if (sq) { if (sq.color === "w") white += VALUE[sq.type] ?? 0; else black += VALUE[sq.type] ?? 0; }
  const turn = g.turn(), check = g.isCheck(), mateInOne = !g.isGameOver() && mates(g);
  let threat: ChessEval["threat"] = 0;
  if (!check && !g.isGameOver()) {
    // the same position with the other side to move: a mate it threatens next move
    const f = fen.split(" ");
    f[1] = turn === "w" ? "b" : "w"; f[3] = "-";
    try { if (mates(new Chess(f.join(" ")))) threat = turn === "w" ? -1 : 1; } catch { /* not a legal position to pass in */ }
  }
  const e: ChessEval = { white, black, turn, check, mateInOne, threat };
  if (evals.size >= 4_000) evals.clear();
  evals.set(fen, e);
  return e;
}

export type ChessInput = {
  fen: string; ply: number; clocks: { w: number; b: number }; initialMs: number;
  status: "waiting" | "countdown" | "playing" | "finished";
  /** White's and black's player connected (a browser, or an agent calling the API). */
  connected: [boolean, boolean];
  /** Time since the last sharp move (a queen or rook taken, or a check), if there was one. */
  sinceSharpMs?: number | null;
};
/** Betting pauses this long after a sharp move: the position is in flux and the next move may decide it. */
export const SHARP_PAUSE_MS = 10_000;
/** A typical game, in plies, for progress. */
const TYPICAL_PLIES = 80;

/** Weights for NIGHT CHESS: side A is white, side B is black. */
export function chessWeights(s: ChessInput): Weights {
  const ev = evaluate(s.fen);
  const initial = Math.max(1, s.initialMs);
  const used = 1 - (s.clocks.w + s.clocks.b) / (2 * initial);
  const p = clamp01(Math.max(s.ply / TYPICAL_PLIES, used));
  const material = ev.white - ev.black;
  // e: pawns from white's side. Check costs the side to move half a pawn, a mate threat 2.5, a clock edge up to 1.5.
  let e = material;
  if (ev.check) e += ev.turn === "w" ? -0.5 : 0.5;
  e += 2.5 * ev.threat;
  e += 1.5 * Math.max(-1, Math.min(1, (s.clocks.w - s.clocks.b) / initial));
  const leader = Math.abs(e) < 0.25 ? null : e > 0 ? 0 : 1;
  const locked = s.status === "finished" ? "The game is over."
    : s.status === "waiting" ? "Waiting for both players."
    : ev.mateInOne ? "Mate is on the board."
    : s.sinceSharpMs !== undefined && s.sinceSharpMs !== null && s.sinceSharpMs < SHARP_PAUSE_MS ? "A capture or a check just happened. Betting reopens in a few seconds."
    : Math.abs(material) >= 9 && p >= 0.5 ? "One side is a queen up late in the game."
    : s.status === "playing" && Math.min(s.clocks.w, s.clocks.b) < 20_000 ? "A clock is under 20 seconds."
    : s.status === "playing" && !(s.connected[0] && s.connected[1]) ? "A player is reconnecting."
    : null;
  return shape(p, Math.tanh(Math.abs(e) / 5), leader, locked);
}

// ---- Space Pinball

export type PinballInput = {
  /** When the duel's clock starts (ms), or null before the countdown. */
  startedAt: number | null; now: number; durationMs: number;
  /** The live scores of table A (player 1) and B, as the server plays them. */
  scores: [number, number];
  /** A table that has drained its last ball (or whose game is in). */
  over: [boolean, boolean];
  connected: [boolean, boolean];
  /** A table whose stream stopped counting (it will score what it had). */
  broken: [boolean, boolean];
  done: boolean;
};

/** Weights for Space Pinball: side A is player 1, side B player 2. */
export function pinballWeights(s: PinballInput): Weights {
  const p = s.startedAt === null ? 0 : clamp01((s.now - s.startedAt) / Math.max(1, s.durationMs));
  const [a, b] = s.scores;
  const leader = a === b ? null : a > b ? 0 : 1;
  const playing = s.startedAt !== null && s.now >= s.startedAt;
  const locked = s.done ? "The duel is over."
    : s.startedAt === null ? "Waiting for both players."
    : p >= 0.8 ? "The last 20% of the duel."
    : s.over[0] || s.over[1] ? "A table has drained its last ball."
    : s.broken[0] || s.broken[1] ? "A table stopped counting."
    : playing && !(s.connected[0] && s.connected[1]) ? "A player is reconnecting."
    : null;
  return shape(p, Math.abs(a - b) / Math.max(a + b, 40_000), leader, locked);
}
