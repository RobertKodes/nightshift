import { useState } from "react";
import { Icon } from "../Icon";
import { Link } from "../router";
import { type HandRecord, type LogLine, type PlayerView, chips } from "./api";
import { PlayingCard } from "./Card";

const STREET: Record<LogLine["street"], string> = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" };
/** One action in words: "Pearl raises to 120", "You call 80 · all-in". */
export function actionText(l: LogLine, name: (seat: number) => string, you: number | null = null): string {
  const who = name(l.seat), all = l.allIn ? " · all-in" : "", v = (s: string) => (l.seat === you ? s : `${s}s`);
  if (l.kind === "sb") return `${who} ${v("post")} the small blind ${chips(l.amount)}${all}`;
  if (l.kind === "bb") return `${who} ${v("post")} the big blind ${chips(l.amount)}${all}`;
  if (l.kind === "fold") return `${who} ${v("fold")}`;
  if (l.kind === "check") return `${who} ${v("check")}`;
  if (l.kind === "call") return `${who} ${v("call")} ${chips(l.amount)}${all}`;
  if (l.kind === "bet") return `${who} ${v("bet")} ${chips(l.to)}${all}`;
  return `${who} ${v("raise")} to ${chips(l.to)}${all}`;
}
/** The verify page with this hand's seeds filled in. */
export const verifyLink = (h: HandRecord, players: number) => `/games/poker/verify?serverSeed=${h.serverSeed ?? ""}&seeds=${encodeURIComponent(h.clientSeeds.join(","))}&hand=${h.n}&players=${players}&commit=${h.commit}`;

/** The hands of this match (or this table), newest first: who won what, the action street by street, and each deck's seeds. */
export function HandHistory({ history, players, you, seats, sealed }: { history: HandRecord[]; players: (PlayerView | null)[]; you: number | null; seats: number; sealed: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!history.length) return <p className="pk-empty">No hand played yet. Each hand's deck is committed before the deal.</p>;
  return <ol className="pk-history">
    {history.map((h) => {
      const name = (s: number) => h.names?.[s] ?? players[s]?.name ?? `Seat ${s + 1}`;
      const won = Object.entries(h.won).filter(([, n]) => n > 0).map(([s, n]) => [Number(s), n] as const);
      const mine = you !== null ? h.won[String(you)] ?? 0 : 0;
      const main = won.sort((a, b) => b[1] - a[1])[0];
      const lines = (["preflop", "flop", "turn", "river"] as const).map((st) => [st, h.log.filter((l) => l.street === st)] as const).filter(([, l]) => l.length);
      const isOpen = open === h.n;
      const dealt = h.stacks.filter((s) => s > 0).length || seats;
      return <li key={h.n} className={`${isOpen ? "open" : ""} ${mine > 0 ? "won" : ""}`}>
        <button type="button" className="pk-h-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : h.n)}>
          <span className="pk-h-n">#{h.n}</span>
          <span className="pk-h-what">{h.cut ? "Cut off: the match ended" : main ? <><b>{main[0] === you ? "You" : name(main[0])}</b> {won.length > 1 ? "split" : "won"} {chips(won.reduce((n, [, x]) => n + x, 0))}{h.showdown && h.hands[String(main[0])] ? ` · ${h.hands[String(main[0])]!.name.toLowerCase()}` : ""}</> : "No pot"}</span>
          <span className="pk-h-blinds">{chips(h.blinds[0])}/{chips(h.blinds[1])}</span>
          <Icon name="arrow" size={13} />
        </button>
        {isOpen && <div className="pk-h-body">
          <div className="pk-h-cards">
            {h.board.length ? <span className="pk-h-board">{h.board.map((c) => <PlayingCard key={c} card={c} size={30} />)}</span> : <span className="pk-muted">no flop</span>}
            {h.hole.map((c, s) => c ? <span key={s} className="pk-h-hole"><small>{s === you ? "you" : name(s)}</small>{c.map((x) => <PlayingCard key={x} card={x} size={26} />)}</span> : null)}
          </div>
          {lines.map(([st, l]) => <p key={st} className="pk-h-street"><em>{STREET[st]}</em>{l.map((x) => actionText(x, (s) => (s === you ? "You" : name(s)), you)).join(", ")}</p>)}
          {h.uncalled && <p className="pk-h-street"><em>Back</em>{chips(h.uncalled.amount)} uncalled to {h.uncalled.seat === you ? "you" : name(h.uncalled.seat)}</p>}
          <div className="pk-h-fair">
            <span><b>Commitment</b><code>{h.commit}</code></span>
            <span><b>Server seed</b>{h.serverSeed ? <code>{h.serverSeed}</code> : <em>{sealed}</em>}</span>
            <span><b>Client seeds</b><code>{h.clientSeeds.map((s) => s || "none").join(" · ")}</code></span>
            {h.serverSeed && <Link to={verifyLink(h, dealt)} className="pk-h-verify"><Icon name="shield" size={14} />Verify this deck</Link>}
          </div>
        </div>}
      </li>;
    })}
  </ol>;
}
