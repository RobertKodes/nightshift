import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Emote } from "../pool/cosmetics";
import { type Action, type HandView, type Legal, type PlayerView, chips } from "./api";
import { PlayingCard } from "./Card";

/**
 * The NIGHT POKER table, for a heads-up match and for a free table of up to six: a padded rail
 * round a lit cloth, the board and the pot, a seat for each player (face, name, chips, the clock as
 * a ring, their cards, the bet in front of them in chips, the dealer button), and your own two cards
 * large at the bottom. Who sits where comes from the server; your seat is always at the bottom.
 */
export type Clock = { seat: number; turnAt: number; actionMs: number; deadline: number } | null;
type Props = {
  hand: HandView | null; players: (PlayerView | null)[]; seats: number; you: number | null; clock: Clock; skew: number;
  emotes: { seat: number; id: string; at: number }[];
  /** A message across the felt (the countdown, "dealing"). */
  center?: ReactNode;
  /** Free tables: an empty seat to sit down in. */
  onSit?: (seat: number) => void;
  /** The viewer must act now: the felt's mark holds still. */
  turn?: boolean;
};

/** Which place round the table a seat takes: yours (or seat 0 for a spectator) at the bottom, then clockwise. */
export function slotOf(seat: number, you: number | null, seats: number): number {
  if (seats === 2) return seat === (you ?? 0) ? 0 : 3;
  return (seat - (you ?? 0) + seats) % seats;
}
const frog = (p: PlayerView) => p.avatar ?? "/games/pinball/frog-0.webp";
export const timeText = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}`; };

export function useNow(ms = 200) { const [now, setNow] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]); return now; }

let marks = 0;
export function PokerTable(props: Props) {
  const { hand, players, seats, you, clock, skew, emotes } = props;
  const now = useNow() + skew;
  const result = hand?.result ?? null;
  const winners = new Set(result ? result.pots.flatMap((p) => p.winners ?? []) : []);
  const board = hand?.board ?? [];
  // the five cards that won, once they are shown
  const best = new Set(result?.showdown ? Object.entries(result.hands).filter(([s]) => winners.has(Number(s))).flatMap(([, h]) => h.best) : []);
  const root = useRef<HTMLDivElement>(null), mark = useRef<SVGSVGElement>(null);
  const markId = useMemo(() => `pk-mark-${++marks}`, []);
  // the mark goes in the clear felt between the pot and the bottom seat's cards, sized to the gap, and out of the way when there is none
  useLayoutEffect(() => placeMark(root.current, mark.current));
  useEffect(() => { const el = root.current; if (!el || typeof ResizeObserver === "undefined") return; const ro = new ResizeObserver(() => placeMark(el, mark.current)); ro.observe(el); return () => ro.disconnect(); }, []);
  // the bets of a round slide into the pot when the next card comes (or the hand ends)
  const last = useRef<{ key: string; bets: { seat: number; bet: number }[] }>({ key: "", bets: [] });
  const [collect, setCollect] = useState<{ seat: number; bet: number }[]>([]);
  const round = hand ? `${hand.n}:${hand.board.length}:${hand.street === "done"}` : "";
  useEffect(() => {
    const prev = last.current, bets = hand?.seats.filter((s) => s.bet > 0).map((s) => ({ seat: s.seat, bet: s.bet })) ?? [];
    if (prev.key && prev.key !== round && prev.key.split(":")[0] === round.split(":")[0] && prev.bets.length) {
      setCollect(prev.bets);
      const t = setTimeout(() => setCollect([]), 300);
      last.current = { key: round, bets };
      return () => clearTimeout(t);
    }
    last.current = { key: round, bets };
  }, [round, hand?.seats.map((s) => s.bet).join()]);
  return <div ref={root} className={`pk-table seats-${seats} ${props.turn ? "your-turn" : ""}`}>
    <div className="pk-rail" aria-hidden="true" />
    <div className="pk-felt">
      <div className="pk-mid">
        <div className="pk-board" aria-label={board.length ? `Board: ${board.length} cards` : "No board yet"}>
          {[0, 1, 2, 3, 4].map((i) => board[i] !== undefined
            ? <span key={`${hand?.n}-${i}`} className="pk-deal"><PlayingCard card={board[i]!} size={58} className="pk-board-card" glow={best.has(board[i]!)} /></span>
            : <span key={i} className="pk-slot-card" />)}
        </div>
        <div className="pk-pot" role="status">
          {hand && !result && hand.pot > 0 && <><Chips n={hand.pot} /><b>Pot {chips(hand.pot)}</b>{hand.pots.length > 1 && <small>{hand.pots.map((p, i) => `${i ? `side ${i}` : "main"} ${chips(p.amount)}`).join(" · ")}</small>}</>}
          {result && <ResultLine hand={hand!} players={players} />}
        </div>
        {props.center && <div className="pk-center-note">{props.center}</div>}
      </div>
    </div>
    <FeltMark markRef={mark} id={markId} />
    {Array.from({ length: seats }, (_, seat) => {
      const p = players[seat] ?? null, s = hand?.seats.find((x) => x.seat === seat) ?? null, k = slotOf(seat, you, seats);
      // an empty seat: a quiet chip to sit down in, from the rail only
      if (!p) return props.onSit && you === null ? <button type="button" key={seat} className={`pk-seat pk-sit pk-slot-${k}`} onClick={() => props.onSit!(seat)}>Sit here</button> : null;
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
            <b>{p.name}{p.bot && <i className="pk-tag house">House</i>}{p.agent && <i className="pk-tag">Agent</i>}{mine && <i className="pk-tag you">You</i>}</b>
            <span className="pk-stack">{chips(s?.stack ?? (p as PlayerView & { stack?: number }).stack ?? 0)}{p.rating ? <small>{p.rating} Elo</small> : null}</span>
            {!p.connected && p.awayUntil ? <span className="pk-away">reconnecting {timeText(Math.max(0, p.awayUntil - now))}</span> : !p.connected ? <span className="pk-away">reconnecting</span> : p.sittingOut ? <span className="pk-away">sitting out</span> : null}
            {acting && inAction <= 0 && <span className="pk-bank">time bank {timeText(left)}</span>}
          </div>
        </div>
        {!mine && inHand && <div className={`pk-hole ${cards ? "shown" : ""}`}>{(cards ?? [null, null]).map((c, i) => <PlayingCard key={`${c ?? "b"}-${i}`} card={c} size={cards ? 46 : 34} />)}</div>}
        {s && s.allIn && !result && <span className="pk-flag allin">All-in</span>}
        {s?.folded && <span className="pk-flag">Fold</span>}
        {won > 0 && <span className="pk-flag win">+{chips(won)}</span>}
        {hand && hand.button === seat && <span className={`pk-dealer pk-dealer-${k}`} aria-label="Dealer button">D</span>}
        {emote && <span className="pk-bubble"><Emote id={emote.id} /></span>}
      </div>;
    })}
    {hand?.seats.filter((s) => s.bet > 0).map((s) => <span key={`bet-${s.seat}-${s.bet}`} className={`pk-bet pk-bet-${slotOf(s.seat, you, seats)}`}><Chips n={s.bet} /><b>{chips(s.bet)}</b></span>)}
    {collect.map((s) => <span key={`in-${s.seat}`} className={`pk-bet pk-bet-${slotOf(s.seat, you, seats)} collect`} aria-hidden="true"><Chips n={s.bet} /></span>)}
    {you !== null && hand && (() => {
      const s = hand.seats.find((x) => x.seat === you);
      if (!s?.cards) return null;
      const top = result?.hands[String(you)]?.best ?? [];
      return <div className={`pk-mine ${s.folded ? "folded" : ""}`} aria-label="Your cards">{s.cards.map((c, i) => <span key={`${hand.n}-${i}`} className="pk-deal"><PlayingCard card={c} size={84} glow={top.includes(c) && winners.has(you)} dim={s.folded} /></span>)}</div>;
    })()}
  </div>;
}

/**
 * The table's mark, as on the NIGHT POOL cloth: "$SHIFT × IMD" in a thin double ring, printed faint
 * on clear felt. Every nine seconds a narrow band of light runs across it, masked to the letters and
 * the ring, like a printed logo catching the lamp; it holds still while it is your turn and for
 * reduced motion (one CSS transform, no script per frame).
 */
function FeltMark({ markRef, id }: { markRef: React.Ref<SVGSVGElement>; id: string }) {
  const art = (paint: string) => <g fill={paint} stroke={paint}>
    <ellipse rx="62" ry="34" fill="none" strokeWidth=".7" /><ellipse rx="58" ry="30" fill="none" strokeWidth=".7" />
    <text y="1.5" stroke="none" textAnchor="middle" fontFamily="'Space Grotesk', Inter, system-ui, sans-serif" fontWeight="700" fontSize="15">$SHIFT × IMD</text>
    <text y="13" stroke="none" textAnchor="middle" fontFamily="'Space Grotesk', Inter, system-ui, sans-serif" fontWeight="600" fontSize="4.4" letterSpacing="1.5">NIGHT POKER · BUILT ON IMD</text>
  </g>;
  return <svg ref={markRef} className="pk-felt-brand" viewBox="-64 -36 128 72" aria-hidden="true" focusable="false">
    <defs>
      <mask id={`${id}-m`} maskUnits="userSpaceOnUse" x="-64" y="-36" width="128" height="72">{art("#fff")}</mask>
      <linearGradient id={`${id}-g`} x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity="1" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
    </defs>
    <g className="pk-mark-print">{art("currentColor")}</g>
    <g mask={`url(#${id}-m)`}><g transform="skewX(-18)"><rect className="pk-mark-sweep" x="-92" y="-40" width="26" height="80" fill={`url(#${id}-g)`} /></g></g>
  </svg>;
}

/** Fits the mark between the bottom of the board and pot and the top of the bottom seat's cards (or its plate), centred; hidden when the gap is too small to read it. */
function placeMark(el: HTMLDivElement | null, m: SVGSVGElement | null): void {
  if (!el || !m) return;
  const box = el.getBoundingClientRect(), mid = el.querySelector(".pk-mid")?.getBoundingClientRect();
  if (!mid || !box.height) return;
  // the first thing below the pot in the middle of the table: your cards, the bottom seat's cards or plate, its bet
  const below = [...el.querySelectorAll(".pk-mine, .pk-slot-0 .pk-hole, .pk-slot-0, .pk-bet-0:not(.collect)")].map((e) => e.getBoundingClientRect().top).filter((y) => y > mid.bottom);
  if (!below.length) return;
  const top = mid.bottom - box.top + 6, bottom = Math.min(...below) - box.top - 6, gap = bottom - top;
  const h = Math.min(gap, box.height * 0.17, 96), cy = box.top + top + gap / 2, cx = box.left + box.width / 2;
  let w = Math.min((h * 128) / 72, box.width * 0.36);
  // narrower than any bet or seat beside it at that height
  for (const e of el.querySelectorAll(".pk-bet:not(.collect), .pk-seat:not(.pk-slot-0):not(.pk-slot-3)")) {
    const r = e.getBoundingClientRect();
    if (r.bottom < cy - h / 2 || r.top > cy + h / 2) continue;
    if (r.right < cx) w = Math.min(w, 2 * (cx - r.right) - 8); else if (r.left > cx) w = Math.min(w, 2 * (r.left - cx) - 8);
  }
  if (w < 64) { m.style.visibility = "hidden"; return; }
  m.style.visibility = ""; m.style.width = `${Math.round(w)}px`; m.style.top = `${Math.round(top + gap / 2)}px`;
}

/** Chip colours by denomination, the way a card room racks them: gold 1,000, violet 500, black 100, green 25, red 5, white 1. */
const DENOMS: [number, string, string][] = [[1_000, "#c99a3e", "#fff3d6"], [500, "#6b4fe0", "#e9e2ff"], [100, "#1b1830", "#e9e2ff"], [25, "#2c8a68", "#eafff5"], [5, "#c32b45", "#ffe6ea"], [1, "#e7e2f3", "#4a4366"]];
function stackOf(n: number): [string, string][] {
  const out: [string, string][] = [];
  let r = Math.max(1, Math.round(n));
  for (const [v, face, edge] of DENOMS) while (r >= v && out.length < 6) { out.push([face, edge]); r -= v; }
  return out;
}
/** A short stack of real chips (edge stripes, an inner ring), the biggest at the bottom: what the amount is made of, six chips at most. */
export function Chips({ n }: { n: number }) {
  const stack = stackOf(n), step = 3, h = 9 + step * (stack.length - 1);
  return <svg className="pk-chips" width="22" height={h} viewBox={`0 0 22 ${h}`} aria-hidden="true">
    {stack.map(([face, edge], i) => {
      const y = h - 5 - i * step;
      return <g key={i}>
        <path d={`M1 ${y}v2.4a10 4 0 0 0 20 0V${y}`} fill={face} />
        <path d={`M1 ${y}v2.4a10 4 0 0 0 20 0V${y}`} fill="none" stroke="#000" strokeOpacity=".35" strokeWidth=".5" />
        {[3.2, 8.6, 13.4, 18.8].map((x) => <rect key={x} x={x - .8} y={y + 1.4} width="1.6" height="2.6" fill={edge} opacity=".9" />)}
        <ellipse cx="11" cy={y} rx="10" ry="4" fill={face} />
        <ellipse cx="11" cy={y} rx="8.4" ry="3.3" fill="none" stroke={edge} strokeWidth="1.4" strokeDasharray="2.3 3.2" />
        <ellipse cx="11" cy={y} rx="5.4" ry="2.1" fill="none" stroke={edge} strokeOpacity=".7" strokeWidth=".5" />
      </g>;
    })}
  </svg>;
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
  return [{ label: "½ pot", to: at(0.5) }, { label: "Pot", to: at(1) }, { label: "All-in", to: r.max }];
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
      <button type="button" className="pk-act fold" disabled={busy} onClick={() => act({ kind: "fold" })}><b>Fold</b><kbd>F</kbd></button>
      <button type="button" className="pk-act call" disabled={busy} onClick={() => act(legal.check ? { kind: "check" } : { kind: "call" })}>
        <b>{legal.check ? "Check" : legal.call >= (me?.stack ?? 0) ? `Call ${chips(legal.call)} · all-in` : `Call ${chips(legal.call)}`}</b><kbd>C</kbd>
      </button>
      {raise && <button type="button" className={`pk-act raise ${allIn ? "allin" : ""}`} disabled={busy} onClick={() => act({ kind: "raise", to })}>
        <b>{allIn ? `All-in ${chips(to)}` : `${bet ? "Bet" : "Raise to"} ${chips(to)}`}</b><kbd>R</kbd>
      </button>}
    </div>
    {raise && raise.max > raise.min && <div className="pk-sizer">
      <div className="pk-quick">{quick.map((q) => <button type="button" key={q.label} className={to === q.to ? "on" : ""} disabled={busy} onClick={() => setTo(q.to)}>{q.label}{q.label === "All-in" && <kbd>A</kbd>}</button>)}</div>
      <input type="range" className="pk-slider" min={raise.min} max={raise.max} step={1} value={to} aria-label={bet ? "Bet amount" : "Raise to"} onChange={(e) => setTo(clamp(Number(e.target.value)))} />
      <input type="number" className="pk-amount" min={raise.min} max={raise.max} value={to} aria-label="Amount in chips" onChange={(e) => setTo(Number(e.target.value))} onBlur={() => setTo(clamp(to))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); act({ kind: "raise", to: clamp(to) }); } }} />
    </div>}
    <p className="pk-keys" aria-hidden="true"><kbd>F</kbd> fold · <kbd>C</kbd> {legal.check ? "check" : "call"}{raise && <> · <kbd>R</kbd> {bet ? "bet" : "raise"} · <kbd>A</kbd> all-in · <kbd>←</kbd><kbd>→</kbd> one big blind · <kbd>↑</kbd><kbd>↓</kbd> sizes</>}</p>
  </div>;
}
