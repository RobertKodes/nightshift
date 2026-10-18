import { Chess, type Color, type Move } from "chess.js";
import { CONTROLS, cleanName, type MatchView, type TimeControl } from "./types";

const value: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/** A browser-only sparring partner. It prefers material and checks, but leaves room to learn. */
export class Practice {
  game = new Chess();
  state: MatchView;
  private turnAt: number;
  constructor(name: string, tc: TimeControl) {
    const now = Date.now(), start = now + 1_500;
    this.turnAt = start;
    this.state = { id: `practice-${now}`, tc, currency: "FREE", version: 0, now, startedAt: start, status: "countdown", fen: this.game.fen(), turn: "w", check: false,
      clocks: { w: CONTROLS[tc].time, b: CONTROLS[tc].time }, lastMove: null, moves: [], ply: 0, done: false, reason: null, winner: null, you: "w", winnerIsYou: false,
      drawOffer: null, rematchRequested: false, rivalWantsRematch: false, rematchId: null,
      players: [{ name: cleanName(name), color: "w", rating: 1200, you: true, connected: true }, { name: "Frog #7 (bot)", color: "b", rating: 1200, you: false, connected: true }] };
  }
  flag() {
    if (this.state.done || Date.now() < this.turnAt) return false;
    const turn = this.game.turn();
    if (this.state.clocks[turn] - (Date.now() - this.turnAt) <= 0) { this.finish(turn === "w" ? "b" : "w", "timeout"); return true; }
    return false;
  }
  private finish(winner: Color | null, reason: string) {
    const turn = this.game.turn(), now = Date.now();
    this.state = { ...this.state, clocks: { ...this.state.clocks, [turn]: Math.max(0, this.state.clocks[turn] - Math.max(0, now - this.turnAt)) }, now, version: this.state.version + 1, done: true, status: "finished", winner, winnerIsYou: winner === "w", reason };
  }
  resign() { this.finish("b", "resignation"); return this.state; }
  draw() { this.finish(null, "agreement"); return this.state; }
  move(from: string, to: string, promotion?: string) {
    if (this.flag() || this.state.done || Date.now() < this.state.startedAt!) return this.state;
    const color = this.game.turn(), move = this.game.move({ from, to, promotion }), now = Date.now();
    this.state = { ...this.state, version: this.state.version + 1, clocks: { ...this.state.clocks, [color]: Math.max(0, this.state.clocks[color] - (now - this.turnAt)) + CONTROLS[this.state.tc].increment }, now,
      fen: this.game.fen(), turn: this.game.turn(), check: this.game.isCheck(), moves: [...this.state.moves, move], lastMove: move, ply: this.state.ply + 1, status: "playing" };
    this.turnAt = now;
    if (this.game.isCheckmate()) this.finish(color, "checkmate");
    else if (this.game.isStalemate()) this.finish(null, "stalemate");
    else if (this.game.isThreefoldRepetition()) this.finish(null, "repetition");
    else if (this.game.isInsufficientMaterial()) this.finish(null, "insufficient material");
    else if (this.game.isDraw()) this.finish(null, "50-move rule");
    return this.state;
  }
  bot() {
    if (this.state.done || this.game.turn() !== "b") return this.state;
    const scored = this.game.moves({ verbose: true }).map((m) => ({ m, score: this.score(m) + Math.random() * 3 }));
    scored.sort((a,b) => b.score - a.score);
    const m = scored[0]?.m;
    return m ? this.move(m.from, m.to, m.promotion) : this.state;
  }
  private score(m: Move) { return (m.captured ? (value[m.captured] ?? 0) * 2 : 0) + (m.san.includes("#") ? 1000 : m.san.includes("+") ? 2 : 0) + (m.promotion ? 10 : 0); }
}
