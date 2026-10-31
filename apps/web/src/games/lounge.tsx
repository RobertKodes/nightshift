import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "../Icon";
import { go, Link, useRoute } from "../router";
import { useSession } from "../session";
import { type ChallengeView, StakeResult, tokenLabel } from "../stakes";
import { type LiveGame, LiveRow } from "./live";
import { isClosedHere, seatPath, useMyStakes } from "./staked";
import { keepName, localName, nameOr } from "./handle";
import "./lounge.css";

/**
 * The Game Room lounge: every open game waiting for a rival (Join), how many wait per time control,
 * open staked challenges (Accept) and live games (Watch), from one feed (GET /api/games/lounge and its
 * stream). Your own waiting game follows you across the site in a small banner (WaitingBanner), kept
 * in sessionStorage, whose stream keeps your seat; when someone joins you hear it, see it and (if you
 * allowed it) get a notification, one tap from the board.
 */
export type Game = "chess" | "pinball" | "pool" | "poker";
export type TimeControl = "3+2" | "5+0" | "10+0";
export const TCS: TimeControl[] = ["3+2", "5+0", "10+0"];
export type OpenGame = {
  game: Game; id: string; tc: TimeControl | null; any: boolean; rules?: string;
  host: { name: string; rating: number | null; avatar?: string | null; agent?: boolean; level?: number };
  since: number; away: boolean; awayUntil: number | null;
};
export type LoungeFeed = {
  now: number; open: OpenGame[]; waiting: { chess: Record<TimeControl | "any", number>; pinball: number; pool?: number; poker?: number };
  challenges: ChallengeView[]; live: LiveGame[]; mine: { game: Game; id: string }[];
};
export const GAME_NAME: Record<Game, string> = { chess: "NIGHT CHESS", pinball: "SPACE PINBALL", pool: "NIGHT POOL", poker: "NIGHT POKER" };
/** Each game's line icon. */
export const GAME_ICON: Record<Game, string> = { chess: "chess-knight", pinball: "orbit", pool: "pool", poker: "cards" };

// ---- your waiting game, across pages (this tab only)
export type Waiting = { game: Game; id: string; player: string; tc: string | null; since: number };
const WAITING = "ns-waiting";
/** Where each game page finds its seat after a navigation or a reload. */
export const SEAT_KEY: Record<Game, string> = { chess: "nc-match", pinball: "pb-match", pool: "np-match", poker: "nk-match" };
const store = { value: undefined as Waiting | null | undefined, subs: new Set<() => void>() };
const readWaiting = (): Waiting | null => {
  if (store.value !== undefined) return store.value;
  try { store.value = JSON.parse(sessionStorage.getItem(WAITING) ?? "null"); } catch { store.value = null; }
  return store.value ?? null;
};
/** Remember (or forget, null) the open game this tab is waiting in. */
export function keepWaiting(w: Waiting | null): void {
  const old = readWaiting();
  if (JSON.stringify(old) === JSON.stringify(w)) return;
  store.value = w;
  try { if (w) sessionStorage.setItem(WAITING, JSON.stringify(w)); else sessionStorage.removeItem(WAITING); } catch { /* private window */ }
  for (const f of store.subs) f();
}
/** Forget the waiting game only if it is this one (a page that saw it start or close). */
export const doneWaiting = (game: Game, id: string) => { const w = readWaiting(); if (w && w.game === game && w.id === id) keepWaiting(null); };
export function useWaiting(): Waiting | null {
  return useSyncExternalStore((f) => { store.subs.add(f); return () => { store.subs.delete(f); }; }, readWaiting, () => null);
}
/** The seat a game page restores: its match and the private player token. */
export function keepSeat(game: Game, seat: { id: string; player: string } | null): void {
  try { if (seat) sessionStorage.setItem(SEAT_KEY[game], JSON.stringify(seat)); else sessionStorage.removeItem(SEAT_KEY[game]); } catch { /* private window */ }
}

// ---- alerts: a sound, a notification while the page is hidden
let audio: AudioContext | null = null;
/** Called on a tap (create, join): unlocks sound on phones, asks once for notifications. */
export function primeAlerts(): void {
  try { audio ??= new AudioContext(); void audio.resume().catch(() => {}); } catch { /* sound is optional */ }
  try { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission().catch(() => {}); } catch { /* not offered here */ }
}
/** Someone sat down at your table: two rising notes, and a notification if the page is hidden. */
export function alertJoined(game: Game, board: string): void {
  try {
    if (audio && audio.state === "running") {
      const t = audio.currentTime;
      [523, 784].forEach((f, i) => {
        const o = audio!.createOscillator(), g = audio!.createGain(), s = t + i * .12;
        o.frequency.setValueAtTime(f, s); g.gain.setValueAtTime(.0001, s); g.gain.exponentialRampToValueAtTime(.12, s + .01); g.gain.exponentialRampToValueAtTime(.0001, s + .3);
        o.connect(g); g.connect(audio!.destination); o.start(s); o.stop(s + .32);
      });
    }
  } catch { /* sound is optional */ }
  try {
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      const n = new Notification(`${GAME_NAME[game]}: your rival is here`, { body: "Tap to take your seat. The game starts in a few seconds.", tag: "ns-joined", icon: "/icon-192.png" });
      n.onclick = () => { window.focus(); go(board); n.close(); };
    }
  } catch { /* notifications are optional */ }
}

// ---- the feed: one stream per page, shared by every lounge view on it
const feed = { value: null as LoungeFeed | null, subs: new Set<() => void>(), es: null as EventSource | null, poll: null as ReturnType<typeof setInterval> | null };
/** The server's clock minus ours, from the latest frame: waits are counted on the server's clock. */
let skewMs = 0;
const publish = (v: LoungeFeed) => { skewMs = v.now - Date.now(); feed.value = v; for (const f of feed.subs) f(); };
const load = () => void fetch("/api/games/lounge").then((r) => r.ok ? r.json() : null).then((v) => { if (v) publish(v); }).catch(() => {});
function connect() {
  if (feed.es || feed.poll || document.hidden) return;
  try {
    const es = new EventSource("/api/games/lounge/events");
    feed.es = es;
    es.onmessage = (e) => { try { publish(JSON.parse(e.data)); } catch { /* the next frame has everything */ } };
    // refused (too many streams) or gone: read it every few seconds instead
    es.onerror = () => { if (es.readyState === EventSource.CLOSED && feed.es === es) { feed.es = null; load(); feed.poll = setInterval(() => { if (!document.hidden) load(); }, 6_000); } };
  } catch { load(); feed.poll = setInterval(load, 6_000); }
}
function disconnect() { feed.es?.close(); feed.es = null; if (feed.poll) clearInterval(feed.poll); feed.poll = null; }
const onVisibility = () => { if (document.hidden) disconnect(); else connect(); };
export function useLounge(): LoungeFeed | null {
  useEffect(() => {
    if (!feed.subs.size) { connect(); document.addEventListener("visibilitychange", onVisibility); }
    const f = () => {};
    feed.subs.add(f);
    return () => { feed.subs.delete(f); if (!feed.subs.size) { disconnect(); document.removeEventListener("visibilitychange", onVisibility); } };
  }, []);
  return useSyncExternalStore((f) => { feed.subs.add(f); return () => { feed.subs.delete(f); }; }, () => feed.value, () => null);
}

// ---- actions
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}
type Seated = { match: { id: string; startedAt: number | null; waitingSince?: number; tc?: string | null; status?: string }; player: string };
/** The player's one name, the same in every game. */
const savedName = (_game: Game) => nameOr(localName());
/** NIGHT POOL's rules for new tables: WPA (every shot called) unless the player picked quick. */
const poolRules = () => { try { return localStorage.getItem("np-rules") === "quick" ? "quick" : "wpa"; } catch { return "wpa"; } };
/** A seat taken from the lounge: the board if the game is on, else this tab waits (banner) wherever it goes. */
function seated(game: Game, r: Seated, stay: boolean): void {
  keepSeat(game, { id: r.match.id, player: r.player });
  const started = game === "pinball" ? r.match.startedAt !== null : r.match.status !== "waiting";
  if (started) { keepWaiting(null); go(`/games/${game}`); return; }
  keepWaiting({ game, id: r.match.id, player: r.player, tc: r.match.tc ?? null, since: r.match.waitingSince ?? Date.now() });
  if (!stay) go(`/games/${game}`);
}
export async function createGame(game: Game, tc: TimeControl, stay = true): Promise<void> {
  primeAlerts();
  const name = savedName(game);
  const r = game === "chess" ? await post<Seated>("/api/chess/queue", { name, tc })
    : game === "pool" ? await post<Seated>("/api/pool/queue", { name, rules: poolRules() })
    : game === "poker" ? await post<Seated>("/api/poker/queue", { name })
    : await post<Seated>("/api/pinball/queue", { name, currency: "FREE", stake: 0, avatar: "/games/pinball/frog-0.webp" });
  seated(game, r, stay);
}
export async function joinGame(g: OpenGame): Promise<void> {
  primeAlerts();
  const mine = readWaiting();
  // leaving your own open game for someone else's (a guest's own is closed here; a wallet's on the server)
  if (mine && mine.id !== g.id) { await cancelGame(mine.game, mine.id).catch(() => {}); }
  const r = await post<Seated>("/api/games/lounge/join", { game: g.game, id: g.id, name: savedName(g.game), avatar: "/games/pinball/frog-0.webp" });
  seated(g.game, r, false);
}
export async function playAnyone(game: Game, stay = true): Promise<void> {
  primeAlerts();
  const r = await post<Seated>("/api/games/lounge/any", { game, name: savedName(game), avatar: "/games/pinball/frog-0.webp", rules: poolRules() });
  seated(game, r, stay);
}
export async function cancelGame(game: Game, id: string): Promise<void> {
  const w = readWaiting();
  const player = w && w.id === id ? w.player : undefined;
  await post("/api/games/lounge/cancel", { game, id, player });
  if (w && w.id === id) { keepWaiting(null); keepSeat(game, null); }
}

// ---- the view
export const waitText = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function useNow(ms = 1_000) { const [now, setNow] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]); return now; }
/** "2 waiting" for a time-control button; nothing when nobody waits. */
export function waitingOn(l: LoungeFeed | null, tc: TimeControl): number { return l ? l.waiting.chess[tc] + l.waiting.chess.any : 0; }

function OpenRow({ g, now, skew, mine, busy, onJoin, onCancel }: { g: OpenGame; now: number; skew: number; mine: boolean; busy: boolean; onJoin: () => void; onCancel: () => void }) {
  const waited = now + skew - g.since;
  const away = g.away && g.awayUntil ? Math.max(0, g.awayUntil - now - skew) : 0;
  return <li className={`lg-row ${mine ? "mine" : ""} ${g.away ? "away" : ""}`}>
    <span className={`lv-game ${g.game}`} aria-hidden="true"><Icon name={GAME_ICON[g.game]} size={20} /></span>
    <div className="lg-who">
      <span className="lv-kind">{g.game === "chess" ? `NIGHT CHESS · ${g.any ? "ANY CLOCK" : g.tc}` : g.game === "pool" ? `NIGHT POOL · ${g.rules === "quick" ? "QUICK RULES" : "WPA RULES"}` : g.game === "poker" ? "NIGHT POKER · HEADS-UP" : "SPACE PINBALL · DUEL"}</span>
      <b><span className="lv-name">{g.host.name}{g.host.agent && <i className="lv-agent">AGENT</i>}</span>{g.host.rating !== null && <small>{g.host.rating} ELO</small>}</b>
      <span className="lg-since">{mine ? "Your game · " : ""}waiting {waitText(waited)}{g.away && ` · host away, closes in ${waitText(away)}`}</span>
    </div>
    <span className="lv-stake free">FREE</span>
    {mine ? <span className="lg-mine"><em>YOURS</em><button type="button" className="lg-btn ghost" disabled={busy} onClick={onCancel}>CANCEL</button></span>
      : <button type="button" className="lg-btn" disabled={busy || g.away} onClick={onJoin} aria-label={`Join ${g.host.name}'s ${g.game === "chess" ? "chess game" : g.game === "pool" ? "pool table" : g.game === "poker" ? "poker match" : "pinball duel"}`}>{g.away ? "AWAY" : <><Icon name="swords" size={15} /><span>JOIN</span></>}</button>}
  </li>;
}

/**
 * The lounge. `game` keeps it to one game (on its page); `create` adds the Create game controls
 * (the Game Room page; the game pages have their own). `onSeat` takes a seat on the page itself
 * instead of navigating to it.
 */
/** The player's name for every game: typed once, kept here, and on the wallet when signed in. */
function PlayingAs({ signedIn }: { signedIn: boolean }) {
  const [name, setName] = useState(() => localName() ?? ""), [edit, setEdit] = useState(!localName()), [note, setNote] = useState<string | null>(null);
  const keepIt = () => {
    const n = name.trim().slice(0, 18);
    if (!n) return;
    keepName(n, signedIn);
    setEdit(false);
    setNote(signedIn ? "Saved on your wallet: every game seats you under it." : "Saved on this device. Sign in to keep it on your wallet.");
  };
  return <div className="lg-me">
    <span className="lg-me-label">PLAYING AS</span>
    {edit
      ? <form className="lg-me-form" onSubmit={(e) => { e.preventDefault(); keepIt(); }}><input value={name} maxLength={18} autoComplete="nickname" placeholder="Pick your name" aria-label="Your player name" onChange={(e) => setName(e.target.value)} /><button type="submit" className="lg-btn" disabled={!name.trim()}>SAVE</button></form>
      : <button type="button" className="lg-me-name" onClick={() => setEdit(true)} aria-label={`Your player name: ${name}. Change it`}><b>{name}</b><Icon name="edit" size={14} /></button>}
    {note && <small className="lg-me-note">{note}</small>}
  </div>;
}

export function Lounge({ game, create = false, onSeat }: { game?: Game; create?: boolean; onSeat?: (game: Game, id: string, player: string) => void }) {
  const l = useLounge(), now = useNow(), mine = useWaiting(), { address } = useSession();
  const [pick, setPick] = useState<Game>(game ?? "chess");
  const [tc, setTc] = useState<TimeControl>("3+2");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const skew = skewMs;
  const run = async (f: () => Promise<void>) => { if (busy) return; setBusy(true); setErr(null); try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const isMine = (g: OpenGame) => (mine?.id === g.id && mine.game === g.game) || !!l?.mine.some((m) => m.id === g.id && m.game === g.game);
  const join = (g: OpenGame) => run(async () => {
    if (!onSeat) return joinGame(g);
    primeAlerts();
    const r = await post<Seated>("/api/games/lounge/join", { game: g.game, id: g.id, name: savedName(g.game), avatar: "/games/pinball/frog-0.webp" });
    onSeat(g.game, r.match.id, r.player);
  });
  const open = (l?.open ?? []).filter((g) => !game || g.game === game);
  const challenges = (l?.challenges ?? []).filter((c) => (!game || c.game === game) && !isClosedHere(c.matchId));
  const stakes = useMyStakes().filter((c) => !game || c.game === game);
  const live = (l?.live ?? []).filter((g) => !game || g.game === game);
  const waiting = l ? (game === "pinball" ? l.waiting.pinball : game === "pool" ? l.waiting.pool ?? 0 : game === "poker" ? l.waiting.poker ?? 0 : game === "chess" ? Object.values(l.waiting.chess).reduce((a, b) => a + b, 0) : open.length) : 0;
  const createFor = create ? pick : game;
  return <section className="lg" aria-labelledby={`lg-title-${game ?? "all"}`}>
    <PlayingAs signedIn={!!address} />
    <div className="lg-head"><div><b id={`lg-title-${game ?? "all"}`}>The lounge</b><span>{l === null ? "Connecting to the tables… You can still start a free game above." : `${waiting} waiting for a rival · ${live.length} live`}</span></div><span className={`lg-state ${open.length ? "on" : ""}`}><i />{open.length ? `${open.length} open ${open.length === 1 ? "table" : "tables"}` : "No one waiting. Start a game above."}</span></div>

    {create && <div className="lg-create">
      {!game && <div className="lg-tabs four" role="group" aria-label="Game">{(["chess", "pool", "poker", "pinball"] as const).map((k) => <button type="button" key={k} aria-pressed={pick === k} className={pick === k ? "on" : ""} onClick={() => setPick(k)}><Icon name={GAME_ICON[k]} size={15} />{k === "chess" ? "Night Chess" : k === "pool" ? "Night Pool" : k === "poker" ? "Night Poker" : "Space Pinball"}</button>)}</div>}
      {pick === "chess" && <div className="lg-tcs" role="group" aria-label="Time control">{TCS.map((k) => { const n = waitingOn(l, k); return <button type="button" key={k} aria-pressed={tc === k} className={tc === k ? "on" : ""} onClick={() => setTc(k)}><b>{k}</b><small className={n ? "on" : ""}>{n ? `${n} waiting` : "nobody yet"}</small></button>; })}</div>}
      <div className="lg-actions">
        <button type="button" className="lg-btn big" disabled={busy || !!mine} onClick={() => void run(() => createGame(pick, tc))}><Icon name="bolt" size={17} /><span>{mine ? "YOU ARE WAITING" : "OPEN A TABLE"}</span></button>
        <button type="button" className="lg-btn big ghost" disabled={busy || !!mine} onClick={() => void run(() => playAnyone(pick))}><Icon name="radar" size={17} /><span>JOIN ANYONE WAITING</span></button>
      </div>
      <p className="lg-note">Open a table: it waits in the lounge while you browse, and you hear when someone sits down. Join anyone waiting: you play at once, on their {pick === "chess" ? "clock" : "table"}.</p>
    </div>}
    {!create && createFor && !mine && open.some((g) => !g.away && !isMine(g)) && <div className="lg-actions"><button type="button" className="lg-btn big ghost" disabled={busy} onClick={() => void run(async () => {
      if (!onSeat) return playAnyone(createFor, false);
      primeAlerts();
      const r = await post<Seated>("/api/games/lounge/any", { game: createFor, name: savedName(createFor), avatar: "/games/pinball/frog-0.webp", rules: poolRules() });
      onSeat(createFor, r.match.id, r.player);
    })}><Icon name="radar" size={17} /><span>PLAY ANYONE WAITING</span></button></div>}
    {err && <p className="lg-err" role="alert"><Icon name="alert" size={15} />{err}</p>}

    <div className="lg-label"><span>OPEN GAMES</span><span>{open.length}</span></div>
    {l === null ? <p className="lv-empty" role="status">Looking for open tables…</p> : open.length ? <ul className="lv-list" aria-live="polite">{open.slice(0, 12).map((g) => <OpenRow key={`${g.game}-${g.id}`} g={g} now={now} skew={skew} mine={isMine(g)} busy={busy} onJoin={() => void join(g)} onCancel={() => void run(() => cancelGame(g.game, g.id))} />)}</ul>
      : <p className="lv-empty">Nobody is waiting right now. Open a game and the next player joins you.</p>}

    {stakes.length > 0 && <><div className="lg-label"><span>YOUR STAKED GAMES</span><span>{stakes.length}</span></div>
      <ul className="lv-list">{stakes.map((c) => <li className={`lg-row ${c.seat ? "mine" : ""}`} key={c.matchId}>
        <span className={`lv-game ${c.game}`} aria-hidden="true"><Icon name={GAME_ICON[c.game]} size={20} /></span>
        <div className="lg-who"><span className="lv-kind">{GAME_NAME[c.game]}{c.tc ? ` · ${c.tc}` : ""} · STAKED</span><b><span className="lv-name">{c.you === "A" ? c.nameB ?? "Waiting for a rival" : c.name}</span></b><span className="lg-since">{c.status === "finished" ? "Played: the payout waits for you" : c.seat ? "Ready: both stakes are in" : c.status === "joined" ? "Both stakes are in: setting up the table" : c.joining ? "Your join is confirming on Ethereum" : c.status === "pending" ? "Your stake is confirming on Ethereum" : "Open: waiting for a rival"}</span></div>
        <span className="lv-stake on">{Number(c.amount).toLocaleString()} {tokenLabel(c.token)}</span>
        {c.status === "finished" ? null : c.seat ? <Link to={seatPath(c)} className="lg-btn"><Icon name="swords" size={15} /><span>TAKE YOUR SEAT</span></Link> : <Link to={`/games/${c.game}?token=${c.token}`} className="lg-btn ghost"><span>OPEN</span></Link>}
        {c.status === "finished" && <div className="lg-claim"><StakeResult matchId={c.matchId} address={address} /></div>}
      </li>)}</ul></>}

    {challenges.length > 0 && <><div className="lg-label"><span>STAKED CHALLENGES</span><span>{challenges.length}</span></div>
      <ul className="lv-list">{challenges.slice(0, 6).map((c) => <li className="lg-row" key={c.matchId}>
        <span className={`lv-game ${c.game}`} aria-hidden="true"><Icon name={GAME_ICON[c.game]} size={20} /></span>
        <div className="lg-who"><span className="lv-kind">{GAME_NAME[c.game]}{c.tc ? ` · ${c.tc}` : ""} · 18+</span><b><span className="lv-name">{c.name}</span></b><span className="lg-since">{c.remaining ? `open for ${waitText(c.remaining * 1000)}` : "open"}</span></div>
        <span className="lv-stake on">{Number(c.amount).toLocaleString()} {tokenLabel(c.token)}</span>
        {address && c.creator === address.toLowerCase() ? <span className="lg-mine"><em>YOURS</em></span> : <Link to={`/games/${c.game}?accept=${c.matchId}&token=${c.token}`} className="lg-btn"><Icon name="diamond" size={15} /><span>ACCEPT</span></Link>}
      </li>)}</ul></>}

    <div className="lg-label"><span>LIVE NOW</span><span>{live.length}</span></div>
    {l === null ? null : live.length ? <ul className="lv-list">{live.slice(0, 4).map((g) => <LiveRow key={`${g.game}-${g.id}`} g={g} now={now} />)}</ul> : <p className="lv-empty">No games being played right now.</p>}
    {live.length > 4 && <Link to="/games/live" className="lv-all">All live games<Icon name="arrow" size={15} /></Link>}
  </section>;
}

// ---- the banner on every page while this tab waits, and what happens when someone joins
type Notice = { kind: "joined" | "closed"; game: Game; text: string };
/**
 * While this tab waits in an open game and is not on that game's page, this keeps the seat's stream
 * open (the game stays in the lounge) and shows how long it has waited, with Cancel. Someone joins:
 * a sound, a toast and a notification, one tap to the board. The game closes (cancelled, the grace
 * period over, nobody came): said so, plainly.
 */
export function WaitingBanner() {
  const path = useRoute();
  // /tg only says the Game Room moved: no banner there
  return path === "/tg" || path.startsWith("/tg/") ? null : <SiteWaitingBanner path={path} />;
}
/** The seat's stream once a rival sat down: kept open until the player is at the board, so they are not "away" while they tap through. */
let held: EventSource | null = null;
const release = () => { held?.close(); held = null; };
function SiteWaitingBanner({ path }: { path: string }) {
  const w = useWaiting(), now = useNow();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const onBoard = !!w && path === `/games/${w.game}` && !location.search.includes("watch=");
  useEffect(() => {
    if (!w || onBoard) return;
    const board = `/games/${w.game}`;
    const url = `/api/${w.game}/match/${w.id}/events?player=${encodeURIComponent(w.player)}`;
    const es = new EventSource(url);
    let over = false;
    const closed = (text: string) => { over = true; es.close(); keepWaiting(null); keepSeat(w.game, null); setNotice({ kind: "closed", game: w.game, text }); };
    es.onmessage = (e) => {
      if (over) return;
      let v: { status?: string; startedAt?: number | null; done?: boolean; expired?: string | null; movedTo?: string | null; void?: string | null; waitingSince?: number };
      try { v = JSON.parse(e.data); } catch { return; }
      // folded into an older table in the lounge: the same seat, followed there
      if (v.movedTo) { over = true; es.close(); keepSeat(w.game, { id: v.movedTo, player: w.player }); keepWaiting({ ...w, id: v.movedTo }); return; }
      if (w.game === "pinball" && v.void) return closed(v.void);
      if (v.done && !v.startedAt) {
        return closed(v.expired === "away" ? "Your game closed: you were away for more than 90 seconds. Open a new one from the lounge." : v.expired === "timeout" ? "Nobody joined in 30 minutes, so your game closed." : "Your game was closed.");
      }
      const started = w.game === "pinball" ? !!v.startedAt : v.status === "countdown" || v.status === "playing";
      if (started) {
        over = true; release(); held = es; keepWaiting(null);
        alertJoined(w.game, board);
        setNotice({ kind: "joined", game: w.game, text: w.game === "pinball" ? "Your rival is here. The duel starts in a few seconds." : "Your rival is here. Your clock starts in a few seconds." });
        // a pinball duel starts on its own clock: straight to the table when the page is in view
        if (w.game === "pinball" && !document.hidden) go(board);
      }
    };
    es.onerror = () => {
      if (over) return;
      // a restart or a closed table: the seat is gone, say so instead of reconnecting forever
      void fetch(`/api/${w.game}/match/${w.id}?player=${encodeURIComponent(w.player)}`).then((r) => {
        if (!over && (r.status === 400 || r.status === 404)) closed("Your game is gone: the table closed. Open a new one from the lounge.");
      }).catch(() => {});
    };
    return () => { over = true; if (es !== held) es.close(); };
  }, [w?.id, w?.game, w?.player, onBoard]);
  useEffect(() => { if (notice?.kind !== "joined") { release(); return; } const t = setTimeout(() => setNotice(null), 60_000); return () => clearTimeout(t); }, [notice]);
  // at the board, the game page holds its own stream
  useEffect(() => { if (onBoard) { if (notice) setNotice(null); setTimeout(release, 3_000); } }, [onBoard]);
  if (notice) return <div className={`lg-banner ${notice.kind}`} role={notice.kind === "joined" ? "alert" : "status"}>
    <Icon name={notice.kind === "joined" ? "swords" : "alert"} size={18} />
    <p><b>{GAME_NAME[notice.game]}</b>{notice.text}</p>
    {notice.kind === "joined" && <button type="button" className="lg-btn" autoFocus onClick={() => { setNotice(null); go(`/games/${notice.game}`); }}>GO TO BOARD</button>}
    <button type="button" className="lg-x" aria-label="Dismiss" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button>
  </div>;
  if (!w || onBoard) return null;
  return <div className="lg-banner" role="status">
    <span className="lg-pulse" aria-hidden="true" />
    <p><b>{GAME_NAME[w.game]}</b>Your {w.game === "pinball" ? "duel" : w.game === "pool" || w.game === "poker" ? "table" : "game"}{w.tc ? ` (${w.tc})` : ""} is waiting · <span className="lg-clock">{waitText(now - w.since)}</span></p>
    <Link to={`/games/${w.game}`} className="lg-btn ghost">OPEN</Link>
    <button type="button" className="lg-btn ghost" disabled={busy} onClick={() => { setBusy(true); void cancelGame(w.game, w.id).catch(() => { keepWaiting(null); keepSeat(w.game, null); }).finally(() => { setBusy(false); setNotice({ kind: "closed", game: w.game, text: "You left the lounge: your game is cancelled." }); }); }}>CANCEL</button>
  </div>;
}
