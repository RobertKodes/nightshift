import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { Emote } from "../pool/cosmetics";
import { type Action, type HandView, type Legal, type PlayerView, chips } from "./api";
import { PlayingCard } from "./Card";

/**
 * The NIGHT POKER table, for a heads-up match and for a free table of up to six: the felt with the
 * board and the pot, a seat for each player (face, name, chips, the clock as a ring, their cards,
 * the bet in front of them, the dealer button), and your own two cards large at the bottom. Who sits
 * where comes from the server; your seat is always at the bottom, the others round the table.
 */
export type Clock = { seat: number; turnAt: number; actionMs: number; deadline: number } | null;
type Props = {
  hand: HandView | null; players: (PlayerView | null)[]; seats: number; you: number | null; clock: Clock; skew: number;
  emotes: { seat: number; id: string; at: number }[];
  /** A message across the felt (the countdown, "dealing", a result). */
  center?: ReactNode;
  /** Free tables: an empty seat to sit down in. */
  onSit?: (seat: number) => void;
  sitLabel?: string;
};

/** Which place round the table a seat takes: yours (or seat 0 for a spectator) at the bottom, then clockwise. */
export function slotOf(seat: number, you: number | null, seats: number): number {
  if (seats === 2) return seat === (you ?? 0) ? 0 : 3;
  return (seat - (you ?? 0) + seats) % seats;
}
const frog = (p: PlayerView) => p.avatar ?? "/games/pinball/frog-0.webp";
export const timeText = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}`; };

export function useNow(ms = 200) { const [now, setNow] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]); return now; }

export function PokerTable(props: Props) {
  const { hand, players, seats, you, clock, skew, emotes } = props;
  const now = useNow() + skew;
  const result = hand?.result ?? null;
  const winners = new Set(result ? result.pots.flatMap((p) => p.winners ?? []) : []);
  const board = hand?.board ?? [];
  // the cards of the winning hands glow once they are shown
  const best = new Set(result?.showdown ? Object.entries(result.hands).filter(([s]) => winners.has(Number(s))).flatMap(([, h]) => h.best) : []);
  return <div className={`pk-table seats-${seats}`}>
    <div className="pk-felt" aria-hidden="false">
      <div className="pk-felt-mark" aria-hidden="true"><Icon name="frog" size={30} /></div>
      <div className="pk-mid">
        <div className="pk-board" aria-label={board.length ? `Board: ${board.length} cards` : "No board yet"}>
          {[0, 1, 2, 3, 4].map((i) => board[i] !== undefined
            ? <span key={`${hand?.n}-${i}`} className="pk-deal"><PlayingCard card={board[i]!} size={58} className="pk-board-card" glow={best.has(board[i]!)} /></span>
            : <span key={i} className="pk-slot-card" />)}
        </div>
        <div className="pk-pot" role="status">
          {hand && !result && hand.pot > 0 && <><Chips n={hand.pot} /><b>POT {chips(hand.pot)}</b>{hand.pots.length > 1 && <small>{hand.pots.map((p, i) => `${i ? "side" : "main"} ${chips(p.amount)}`).join(" · ")}</small>}</>}
          {result && <ResultLine hand={hand!} players={players} />}
        </div>
        {props.center && <div className="pk-center-note">{props.center}</div>}
      </div>
    </div>
    {Array.from({ length: seats }, (_, seat) => {
      const p = players[seat] ?? null, s = hand?.seats.find((x) => x.seat === seat) ?? null, k = slotOf(seat, you, seats);
      if (!p) return props.onSit && you === null
        ? <button type="button" key={seat} className={`pk-seat empty pk-slot-${k}`} onClick={() => props.onSit!(seat)}><span className="pk-avatar empty"><Icon name="user" size={20} /></span><b>{props.sitLabel ?? "SIT HERE"}</b></button>
        : <div key={seat} className={`pk-seat empty pk-slot-${k}`} aria-hidden="true"><span className="pk-avatar empty" /></div>;
      const acting = clock?.seat === seat && !!hand && hand.street !== "done";
      const left = acting ? clock!.deadline - now : 0, inAction = acting ? Math.max(0, clock!.turnAt + clock!.actionMs - now) : 0;
      const progress = acting ? Math.max(0, Math.min(1, inAction > 0 ? inAction / clock!.actionMs : left / Math.max(1, clock!.deadline - clock!.turnAt - clock!.actionMs))) : 0;
      const emote = emotes.filter((e) => e.seat === seat).at(-1);
      const mine = seat === you, cards = s?.cards ?? null, inHand = !!s && !s.folded;
      const won = result ? (result.won[seat] ?? 0) : 0;
      return <div key={seat} className={`pk-seat pk-slot-${k} ${mine ? "mine" : ""} ${acting ? "acting" : ""} ${s?.folded ? "folded" : ""} ${won ? "won" : ""} ${!p.connected ? "away" : ""}`}>
        <div className="pk-who">
          <span className={`pk-avatar ${acting && inAction <= 0 ? "bank" : ""}`} style={{ ["--p" as string]: progress }}>
            <img src={frog(p)} alt="" width="64" height="64" decoding="async" loading="lazy" />
            {acting && <i className="pk-timer">{timeText(inAction > 0 ? inAction : left)}</i>}
          </span>
          <div className="pk-id">
            <b>{p.name}{p.bot && <i className="pk-tag house">HOUSE</i>}{p.agent && <i className="pk-tag">AGENT</i>}{mine && <i className="pk-tag you">YOU</i>}</b>
            <span className="pk-stack"><Icon name="coins" size={12} />{chips(s?.stack ?? 0)}{p.rating ? <small>{p.rating} ELO</small> : null}</span>
            {!p.connected && p.awayUntil ? <span className="pk-away">reconnecting {timeText(Math.max(0, p.awayUntil - now))}</span> : !p.connected ? <span className="pk-away">reconnecting</span> : p.sittingOut ? <span className="pk-away">sitting out</span> : null}
            {acting && inAction <= 0 && <span className="pk-bank">TIME BANK {timeText(left)}</span>}
          </div>
        </div>
        {!mine && inHand && <div className={`pk-hole ${cards ? "shown" : ""}`}>{(cards ?? [null, null]).map((c, i) => <PlayingCard key={i} card={c} size={cards ? 46 : 34} />)}</div>}
        {s && s.allIn && !result && <span className="pk-flag allin">ALL-IN</span>}
        {s?.folded && <span className="pk-flag">FOLD</span>}
        {won > 0 && <span className="pk-flag win">+{chips(won)}</span>}
        {hand && hand.button === seat && <span className={`pk-dealer pk-dealer-${k}`} aria-label="Dealer button">D</span>}
        {emote && <span className="pk-bubble"><Emote id={emote.id} /></span>}
      </div>;
    })}
    {hand?.seats.filter((s) => s.bet > 0).map((s) => <span key={`bet-${s.seat}`} className={`pk-bet pk-bet-${slotOf(s.seat, you, seats)}`}><Chips n={s.bet} /><b>{chips(s.bet)}</b></span>)}
    {you !== null && hand && (() => {
      const s = hand.seats.find((x) => x.seat === you);
      if (!s?.cards) return null;
      const top = result?.hands[String(you)]?.best ?? [];
      return <div className={`pk-mine ${s.folded ? "folded" : ""}`} aria-label="Your cards">{s.cards.map((c, i) => <span key={`${hand.n}-${i}`} className="pk-deal"><PlayingCard card={c} size={84} glow={top.includes(c) && winners.has(you)} dim={s.folded} /></span>)}</div>;
    })()}
  </div>;
}

/** A small stack of chips: one to four discs, by size of the amount. */
export function Chips({ n }: { n: number }) {
  const k = n >= 1_000 ? 4 : n >= 200 ? 3 : n >= 50 ? 2 : 1;
  return <span className="pk-chips" aria-hidden="true">{Array.from({ length: k }, (_, i) => <i key={i} style={{ ["--i" as string]: i }} />)}</span>;
}

/** Who won the hand, with what. */
function ResultLine({ hand, players }: { hand: HandView; players: (PlayerView | null)[] }) {
  const r = hand.result!;
  const name = (s: number) => players[s]?.name ?? `Seat ${s + 1}`;
  const lines = r.pots.map((p, i) => {
    const w = p.winners ?? [], what = p.hand ?? r.hands[String(w[0])]?.name ?? null;
    return <span key={i}>{r.pots.length > 1 && <em>{i ? `Side pot ${i}` : "Main pot"}</em>}<b>{w.map(name).join(" & ")}</b> {w.length > 1 ? "split" : "wins"} {chips(p.amount)}{what && r.showdown ? <> with <strong>{what.toLowerCase()}</strong></> : ""}</span>;
  });
  return <div className="pk-result">{lines}</div>;
}

/** Raise-to sizes: half the pot, the pot (after calling), all-in. */
export function sizes(hand: HandView, legal: Legal, myBet: number) {
  const r = legal.raise;
  if (!r) return [];
  const owe = legal.call, after = hand.pot + owe;
  const at = (f: number) => Math.min(r.max, Math.max(r.min, Math.round(myBet + owe + f * after)));
  return [{ label: "½ POT", to: at(0.5) }, { label: "POT", to: at(1) }, { label: "ALL-IN", to: r.max }];
}

/**
 * Fold, check or call, and raise: a slider and a field for the amount, half pot, pot and all-in, and
 * the keys on a computer (F fold, C check or call, R raise, A all-in, ← → one big blind, ↑ ↓ the sizes).
 */
export function ActionBar({ hand, legal, you, busy, waitingOn, onAct }: { hand: HandView | null; legal: Legal | null; you: number | null; busy: boolean; waitingOn: string | null; onAct: (a: Action) => void }) {
  const me = hand?.seats.find((s) => s.seat === you) ?? null, myBet = me?.bet ?? 0;
  const raise = legal?.raise ?? null, bb = hand?.bb ?? 20;
  const [to, setTo] = useState(raise?.min ?? 0);
  const key = `${hand?.n}:${hand?.log.length}`;
  useEffect(() => { if (raise) setTo(raise.min); }, [key, raise?.min]);
  const clamp = (v: number) => (raise ? Math.min(raise.max, Math.max(raise.min, Math.round(v))) : 0);
  const quick = useMemo(() => (hand && legal ? sizes(hand, legal, myBet) : []), [hand, legal, myBet]);
  const act = (a: Action) => { if (!busy && legal) onAct(a); };
  const ref = useRef({ to, act, raise, quick, legal, clamp, bb });
  ref.current = { to, act, raise, quick, legal, clamp, bb };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range" || t.tagName === "TEXTAREA" || t.isContentEditable) || e.metaKey || e.ctrlKey || e.altKey) return;
      const c = ref.current;
      if (!c.legal) return;
      const k = e.key.toLowerCase();
      if (k === "f") { e.preventDefault(); c.act({ kind: "fold" }); }
      else if (k === "c" || k === "k") { e.preventDefault(); c.act(c.legal.check ? { kind: "check" } : { kind: "call" }); }
      else if ((k === "r" || k === "enter") && c.raise) { e.preventDefault(); c.act({ kind: "raise", to: c.to }); }
      else if (k === "a" && c.raise) { e.preventDefault(); setTo(c.raise.max); }
      else if ((k === "arrowright" || k === "arrowleft") && c.raise) { e.preventDefault(); setTo((v) => c.clamp(v + (k === "arrowright" ? c.bb : -c.bb))); }
      else if ((k === "arrowup" || k === "arrowdown") && c.raise) {
        e.preventDefault();
        const steps = [c.raise.min, ...c.quick.map((q) => q.to)].filter((v, i, a) => a.indexOf(v) === i).sort((x, y) => x - y);
        setTo((v) => k === "arrowup" ? steps.find((s) => s > v) ?? c.raise!.max : [...steps].reverse().find((s) => s < v) ?? c.raise!.min);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  if (!legal || !hand) return <div className="pk-actions idle" role="status"><span className="pk-wait">{waitingOn ?? ""}</span></div>;
  const allIn = raise && to >= raise.max;
  const bet = hand.currentBet === 0;
  return <div className="pk-actions your-turn" role="group" aria-label="Your action">
    <div className="pk-act-buttons">
      <button type="button" className="pk-act fold" disabled={busy} onClick={() => act({ kind: "fold" })}><b>FOLD</b><kbd>F</kbd></button>
      <button type="button" className="pk-act call" disabled={busy} onClick={() => act(legal.check ? { kind: "check" } : { kind: "call" })}>
        <b>{legal.check ? "CHECK" : legal.call >= (me?.stack ?? 0) ? `CALL ${chips(legal.call)} · ALL-IN` : `CALL ${chips(legal.call)}`}</b><kbd>C</kbd>
      </button>
      {raise && <button type="button" className={`pk-act raise ${allIn ? "allin" : ""}`} disabled={busy} onClick={() => act({ kind: "raise", to })}>
        <b>{allIn ? `ALL-IN ${chips(to)}` : `${bet ? "BET" : "RAISE TO"} ${chips(to)}`}</b><kbd>R</kbd>
      </button>}
    </div>
    {raise && raise.max > raise.min && <div className="pk-sizer">
      <div className="pk-quick">{quick.map((q) => <button type="button" key={q.label} className={to === q.to ? "on" : ""} disabled={busy} onClick={() => setTo(q.to)}>{q.label}{q.label === "ALL-IN" && <kbd>A</kbd>}</button>)}</div>
      <input type="range" className="pk-slider" min={raise.min} max={raise.max} step={1} value={to} aria-label={bet ? "Bet amount" : "Raise to"} onChange={(e) => setTo(clamp(Number(e.target.value)))} />
      <input type="number" className="pk-amount" min={raise.min} max={raise.max} value={to} aria-label="Amount in chips" onChange={(e) => setTo(Number(e.target.value))} onBlur={() => setTo(clamp(to))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); act({ kind: "raise", to: clamp(to) }); } }} />
    </div>}
    <p className="pk-keys" aria-hidden="true"><kbd>F</kbd> fold · <kbd>C</kbd> {legal.check ? "check" : "call"}{raise && <> · <kbd>R</kbd> {bet ? "bet" : "raise"} · <kbd>A</kbd> all-in · <kbd>←</kbd><kbd>→</kbd> one big blind · <kbd>↑</kbd><kbd>↓</kbd> sizes</>}</p>
  </div>;
}
