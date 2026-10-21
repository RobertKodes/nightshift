import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { Emote } from "../pool/cosmetics";
import { type Action, type TableView, type TablesList, chips, newClientSeed, poker } from "./api";
import { HandHistory } from "./History";
import { ActionBar, PokerTable, useNow } from "./Table";
import type { PokerSound } from "./sound";

/** Where this tab keeps its free-table seat, so a reload sits it back down. */
export const TABLE_SEAT = "nk-table";

/**
 * One free table, game first: from the rail (no seat) with every empty seat to sit in, or from your
 * seat with the actions, sit out, top up and stand up. Play chips only: never rated, staked or bet on.
 */
export function FreeTable({ id, name, address, sound, onExit }: { id: string; name: string; address: string | null; sound: PokerSound | null; onExit: () => void }) {
  const [v, setV] = useState<TableView | null>(null);
  const [token, setToken] = useState<string | null>(() => { try { const s = JSON.parse(sessionStorage.getItem(TABLE_SEAT) ?? "null") as { id: string; player: string } | null; return s?.id === id ? s.player : null; } catch { return null; } });
  const [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [skew, setSkew] = useState(0);
  const [buy, setBuy] = useState<{ seat: number; amount: number } | null>(null);
  const [emotes, setEmotes] = useState(false);
  // the signed-in wallet's play chips, for the buy-in (a seat's own view carries them too)
  const [wallet, setWallet] = useState<number | null>(null);
  useEffect(() => { if (!address) { setWallet(null); return; } void poker<TablesList>("tables").then((t) => setWallet(t.chips)).catch(() => {}); }, [address, token]);
  const source = useRef<EventSource | null>(null), last = useRef<TableView | null>(null), seeded = useRef(new Set<number>());
  const receive = useCallback((x: TableView) => {
    const old = last.current;
    if (old && x.version < old.version) return;
    setSkew(x.now - Date.now());
    const s = sound, h = x.hand, o = old?.hand;
    if (s && h) {
      if (!o || o.n !== h.n) s.deal();
      else {
        if (h.log.length > o.log.length) { const k = h.log.at(-1)!.kind; if (k === "check") s.check(); else if (k === "fold") s.fold(); else s.chips(k === "call" ? 2 : 4); }
        if (h.board.length > o.board.length) s.deal();
        if (h.result && !o.result && x.you !== null && (h.result.won[String(x.you)] ?? 0) > 0) s.win();
      }
      if (x.legal && !old?.legal) s.turn();
    }
    last.current = x; setV(x);
  }, [sound]);
  // the seat's stream, or the rail's
  useEffect(() => {
    source.current?.close();
    const es = new EventSource(token ? `/api/poker/table/${id}/events?player=${encodeURIComponent(token)}` : `/api/poker/table/${id}/watch`);
    source.current = es;
    es.onmessage = (e) => { if (source.current === es) try { receive(JSON.parse(e.data) as TableView); } catch { /* the next frame has everything */ } };
    es.onerror = () => {
      if (source.current !== es || !token) return;
      // a seat the server no longer has (stood up, a restart): back to the rail
      void fetch(`/api/poker/table/${id}?player=${encodeURIComponent(token)}`).then((r) => { if (r.status === 404 && source.current === es) { try { sessionStorage.removeItem(TABLE_SEAT); } catch { /* private window */ } setToken(null); } }).catch(() => {});
    };
    return () => { es.close(); if (source.current === es) source.current = null; };
  }, [id, token, receive]);
  // this browser's seed for each hand, sent once its commitment is up
  useEffect(() => {
    const n = v?.next;
    if (!token || !n || n.seedSent || seeded.current.has(n.n)) return;
    seeded.current.add(n.n);
    void poker(`table/${id}/seed`, { player: token, hand: n.n, seed: newClientSeed() }).catch(() => {});
  }, [token, v?.next?.n, v?.next?.seedSent]);
  const now = useNow(500) + skew;
  const post = async <T,>(path: string, body: Record<string, unknown> = {}) => poker<T>(`table/${id}/${path}`, { player: token, ...body });
  const run = async (f: () => Promise<unknown>) => { if (busy) return; setBusy(true); setErr(null); sound?.unlock(); try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const sit = (seat: number, amount: number) => run(async () => {
    const r = await poker<{ table: TableView; player: string }>(`table/${id}/sit`, { seat, name, buyIn: amount });
    try { sessionStorage.setItem(TABLE_SEAT, JSON.stringify({ id, player: r.player })); } catch { /* private window */ }
    setBuy(null); last.current = null; receive(r.table); setToken(r.player);
  });
  const stand = () => run(async () => {
    const r = await post<{ leaving: boolean }>("leave");
    if (!r.leaving) { try { sessionStorage.removeItem(TABLE_SEAT); } catch { /* private window */ } setToken(null); last.current = null; }
  });
  // a seat that stood up (the hand ended after Stand up, or the table stood it up): back to the rail
  useEffect(() => { if (token && v && v.you === null && !v.spectating) { try { sessionStorage.removeItem(TABLE_SEAT); } catch { /* private window */ } setToken(null); } }, [v?.you, token]);
  const me = v && v.you !== null ? v.players[v.you] : null;
  const actor = v?.hand && v.hand.toAct !== null ? v.players[v.hand.toAct] : null;
  const status = !v ? "" : !v.hand ? "Waiting for two players to deal…" : v.hand.street === "done" ? "Next hand…" : v.legal ? "Your turn" : me?.sittingOut ? "You are sitting out: you are dealt in again when you come back." : actor ? `${actor.name} is thinking…` : "";
  const people = v ? v.players.filter((p) => p && !p.house).length : 0;
  if (!v) return <main className="pk-game"><section className="pk-stage"><p className="pk-rail-note">Opening the table…</p></section></main>;
  return <main className="pk-game">
    <section className="pk-stage">
      <div className="pk-hud">
        <span className="pk-kicker"><i className="pk-live" /> {v.name} · FREE TABLE · PLAY CHIPS{token ? "" : ` · ${v.viewers ?? 0} WATCHING`}</span>
        <span className="pk-blinds"><b>BLINDS {v.blinds[0]}/{v.blinds[1]}</b><small>{v.players.filter(Boolean).length}/{v.seatsMax} SEATED</small>{v.hand && <small>HAND #{v.hand.n}</small>}</span>
      </div>
      <PokerTable hand={v.hand} players={v.players} seats={v.seatsMax} you={v.you} clock={v.clock} skew={skew} emotes={v.emotes} turn={!!v.legal}
        onSit={token ? undefined : (seat) => setBuy({ seat, amount: chipsLeft(v, address ? wallet : null) })}
        center={!v.hand ? <span className="pk-kicker">{v.players.filter(Boolean).length < 2 ? "WAITING FOR PLAYERS" : "DEALING"}</span> : null} />
      {token ? <div className="pk-bar">
        <ActionBar hand={v.hand} legal={v.legal} you={v.you} busy={busy} waitingOn={status} onAct={(a: Action) => void run(async () => receive(await post<TableView>("act", a)))} />
        <div className="pk-seat-tools">
          {me && me.emotes.length > 0 && <div className="pk-emote-wrap"><button type="button" className={`pk-icon-btn ${emotes ? "on" : ""}`} aria-label="Emotes" aria-expanded={emotes} onClick={() => setEmotes(!emotes)}><Icon name="frog" size={18} /></button>
            {emotes && <div className="pk-emotes" role="menu">{me.emotes.map((e) => <button type="button" key={e} role="menuitem" onClick={() => { setEmotes(false); void post("emote", { emote: e }).catch((x) => setErr((x as Error).message)); }}><Emote id={e} /></button>)}</div>}</div>}
        </div>
      </div> : <p className="pk-rail-note" role="status">{status}{status ? " " : ""}Pick a free seat to sit down.</p>}
      {err && <p className="pk-error floating" role="alert"><Icon name="alert" size={15} />{err}<button type="button" aria-label="Dismiss" onClick={() => setErr(null)}><Icon name="close" size={14} /></button></p>}
    </section>
    <aside className="pk-side">
      {token && me ? <div className="pk-mine-tools">
        <div className="pk-section"><span>Your seat</span><span>{chips(me.stack)} chips{me.leaving ? " · standing up after this hand" : ""}</span></div>
        <div className="pk-tool-row">
          <button type="button" className="pk-btn ghost small" disabled={busy} onClick={() => void run(async () => receive(await post<TableView>("sitout", { on: !me.sittingOut })))}>{me.sittingOut ? "I'M BACK" : "SIT OUT"}</button>
          <button type="button" className="pk-btn ghost small" disabled={busy || me.stack >= v.buyIn.max || (!!v.hand && v.hand.street !== "done" && v.hand.seats.some((s) => s.seat === v.you))} onClick={() => void run(async () => receive(await post<TableView>("topup")))}>TOP UP</button>
          <button type="button" className="pk-btn ghost small" disabled={busy || me.leaving} onClick={() => void stand()}><Icon name="flag" size={13} />STAND UP</button>
        </div>
        <p className="pk-note">{v.guest ? `As a guest you sit with fresh chips each time. Sign in to keep your play chips: ${chips(10_000)} a day.` : `Play chips in your wallet: ${chips(v.chips ?? 0)} · topped up to ${chips(10_000)} each day at 00:00 UTC.`}</p>
      </div> : <p className="pk-note">{people ? `${people} ${people === 1 ? "person" : "people"} here. ` : ""}House frogs hold the empty seats and stand up for people. Play chips have no value.</p>}
      <div className="pk-section"><span>Hands</span><span>{v.history.length}</span></div>
      <HandHistory history={v.history} players={v.players} you={v.you} seats={v.seatsMax} sealed="shown once every player of this hand has left the table" />
      {(v.next || v.hand?.commit) && <p className="pk-fair"><Icon name="shield" size={14} /><span>{v.next ? <>Hand #{v.next.n} is committed: <code>{v.next.commit.slice(0, 16)}…</code>{token ? (v.next.seedSent ? " · your seed is in" : " · sending your seed") : ""}</> : <>Hand #{v.hand!.n} was committed before the deal: <code>{v.hand!.commit!.slice(0, 16)}…</code></>}</span></p>}
      <button type="button" className="pk-btn ghost small" onClick={() => { if (token && me && !me.leaving) void stand(); onExit(); }}><Icon name="arrow" size={13} />{token ? "LEAVE THE TABLE" : "BACK TO THE LOBBY"}</button>
    </aside>
    {buy && <div className="pk-overlay" role="dialog" aria-modal="true" aria-labelledby="pk-buy" onKeyDown={(e) => { if (e.key === "Escape") setBuy(null); }}><div className="pk-dialog">
      <span className="pk-kicker">{v.name} · seat {buy.seat + 1}</span>
      <h2 id="pk-buy">Buy in</h2>
      <p>{address ? `From your play chips: ${chips(wallet ?? 0)} in your wallet today.` : "As a guest: fresh play chips for this seat. Sign in to keep what you win."}</p>
      <input type="range" className="pk-slider" min={v.buyIn.min} max={v.buyIn.max} step={v.blinds[1]} value={buy.amount} aria-label="Buy-in" onChange={(e) => setBuy({ ...buy, amount: Number(e.target.value) })} />
      <strong className="pk-buy-amount">{chips(buy.amount)} chips · {Math.round(buy.amount / v.blinds[1])} big blinds</strong>
      <button type="button" className="pk-btn" disabled={busy} onClick={() => void sit(buy.seat, buy.amount)}><Icon name="cards" size={16} />SIT DOWN</button>
      <button type="button" className="pk-btn ghost" autoFocus onClick={() => setBuy(null)}>CANCEL</button>
      {err && <p className="pk-error" role="alert"><Icon name="alert" size={15} />{err}</p>}
    </div></div>}
  </main>;
}
/** The most a seat can buy in with now: the full buy-in for a guest, else what the wallet holds (at least the minimum, which the server checks). */
const chipsLeft = (v: TableView, held: number | null) => (held === null ? v.buyIn.max : Math.max(v.buyIn.min, Math.min(v.buyIn.max, held)));
