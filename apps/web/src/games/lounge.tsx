import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "../Icon";
import { go, Link, useRoute } from "../router";
import { useSession } from "../session";
import { type ChallengeView, tokenLabel } from "../stakes";
import { type LiveGame, LiveRow } from "./live";
import "./lounge.css";

/**
 * The Game Room lounge: every open game waiting for a rival (Join), how many wait per time control,
 * open staked challenges (Accept) and live games (Watch), from one feed (GET /api/games/lounge and its
 * stream). Your own waiting game follows you across the site in a small banner (WaitingBanner), kept
 * in sessionStorage, whose stream keeps your seat; when someone joins you hear it, see it and (if you
 * allowed it) get a notification, one tap from the board.
 */
export type Game = "chess" | "pinball";
export type TimeControl = "3+2" | "5+0" | "10+0";
export const TCS: TimeControl[] = ["3+2", "5+0", "10+0"];
export type OpenGame = {
  game: Game; id: string; tc: TimeControl | null; any: boolean;
  host: { name: string; rating: number | null; avatar?: string | null; agent?: boolean };
  since: number; away: boolean; awayUntil: number | null;
};
export type LoungeFeed = {
  now: number; open: OpenGame[]; waiting: { chess: Record<TimeControl | "any", number>; pinball: number };
  challenges: ChallengeView[]; live: LiveGame[]; mine: { game: Game; id: string }[];
};
export const GAME_NAME: Record<Game, string> = { chess: "NIGHT CHESS", pinball: "SPACE PINBALL" };

// ---- your waiting game, across pages (this tab only)
export type Waiting = { game: Game; id: string; player: string; tc: string | null; since: number };
const WAITING = "ns-waiting";
/** Where each game page finds its seat after a navigation or a reload. */
export const SEAT_KEY: Record<Game, string> = { chess: "nc-match", pinball: "pb-match" };
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
const savedName = (game: Game) => { try { return localStorage.getItem(game === "chess" ? "nc-name" : "pb-name") ?? ""; } catch { return ""; } };
/** A seat taken from the lounge: the board if the game is on, else this tab waits (banner) wherever it goes. */
function seated(game: Game, r: Seated, stay: boolean): void {
  keepSeat(game, { id: r.match.id, player: r.player });
  const started = game === "chess" ? r.match.status !== "waiting" : r.match.startedAt !== null;
  if (started) { keepWaiting(null); go(`/games/${game}`); return; }
  keepWaiting({ game, id: r.match.id, player: r.player, tc: r.match.tc ?? null, since: r.match.waitingSince ?? Date.now() });
  if (!stay) go(`/games/${game}`);
}
export async function createGame(game: Game, tc: TimeControl, stay = true): Promise<void> {
  primeAlerts();
  const name = savedName(game) || "Night crew";
  const r = game === "chess" ? await post<Seated>("/api/chess/queue", { name, tc }) : await post<Seated>("/api/pinball/queue", { name, currency: "FREE", stake: 0, avatar: "/games/pinball/frog-0.webp" });
  seated(game, r, stay);
}
export async function joinGame(g: OpenGame): Promise<void> {
  primeAlerts();
  const mine = readWaiting();
  // leaving your own open game for someone else's (a guest's own is closed here; a wallet's on the server)
  if (mine && mine.id !== g.id) { await cancelGame(mine.game, mine.id).catch(() => {}); }
  const r = await post<Seated>("/api/games/lounge/join", { game: g.game, id: g.id, name: savedName(g.game) || "Night crew", avatar: "/games/pinball/frog-0.webp" });
  seated(g.game, r, false);
}
export async function playAnyone(game: Game, stay = true): Promise<void> {
  primeAlerts();
  const r = await post<Seated>("/api/games/lounge/any", { game, name: savedName(game) || "Night crew", avatar: "/games/pinball/frog-0.webp" });
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
    <span className={`lv-game ${g.game}`} aria-hidden="true"><Icon name={g.game === "chess" ? "chess-knight" : "orbit"} size={20} /></span>
    <div className="lg-who">
      <span className="lv-kind">{g.game === "chess" ? `NIGHT CHESS · ${g.any ? "ANY CLOCK" : g.tc}` : "SPACE PINBALL · DUEL"}</span>
      <b><span className="lv-name">{g.host.name}{g.host.agent && <i className="lv-agent">AGENT</i>}</span>{g.host.rating !== null && <small>{g.host.rating} ELO</small>}</b>
      <span className="lg-since">{mine ? "Your game · " : ""}waiting {waitText(waited)}{g.away && ` · host away, closes in ${waitText(away)}`}</span>
    </div>
    <span className="lv-stake free">FREE</span>
    {mine ? <span className="lg-mine"><em>YOURS</em><button type="button" className="lg-btn ghost" disabled={busy} onClick={onCancel}>CANCEL</button></span>
      : <button type="button" className="lg-btn" disabled={busy || g.away} onClick={onJoin} aria-label={`Join ${g.host.name}'s ${g.game === "chess" ? "chess game" : "pinball duel"}`}>{g.away ? "AWAY" : <><Icon name="swords" size={15} /><span>JOIN</span></>}</button>}
  </li>;
}

/**
 * The lounge. `game` keeps it to one game (on its page); `create` adds the Create game controls
 * (the Game Room page; the game pages have their own). `onSeat` takes a seat on the page itself
 * instead of navigating to it. `free`: open free tables only, no staked challenges and no live list
 * (the Telegram Mini App, which has its own Live tab).
 */
export function Lounge({ game, create = false, onSeat, free = false }: { game?: Game; create?: boolean; onSeat?: (game: Game, id: string, player: string) => void; free?: boolean }) {
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
    const r = await post<Seated>("/api/games/lounge/join", { game: g.game, id: g.id, name: savedName(g.game) || "Night crew", avatar: "/games/pinball/frog-0.webp" });
    onSeat(g.game, r.match.id, r.player);
  });
  const open = (l?.open ?? []).filter((g) => !game || g.game === game);
  const challenges = free ? [] : (l?.challenges ?? []).filter((c) => !game || c.game === game);
  const live = free ? [] : (l?.live ?? []).filter((g) => !game || g.game === game);
  const waiting = l ? (game === "pinball" ? l.waiting.pinball : game === "chess" ? Object.values(l.waiting.chess).reduce((a, b) => a + b, 0) : open.length) : 0;
  const createFor = create ? pick : game;
  return <section className="lg" aria-labelledby={`lg-title-${game ?? "all"}`}>
    <div className="lg-head"><div><b id={`lg-title-${game ?? "all"}`}>THE LOUNGE</b><span>{l === null ? "Connecting…" : `${waiting} waiting for a rival${free ? "" : ` · ${live.length} live`}`}</span></div><span className={`lg-state ${open.length ? "on" : ""}`}><i />{open.length ? "OPEN TABLES" : "QUIET"}</span></div>

    {create && <div className="lg-create">
      {!game && <div className="lg-tabs" role="group" aria-label="Game">{(["chess", "pinball"] as const).map((k) => <button type="button" key={k} aria-pressed={pick === k} className={pick === k ? "on" : ""} onClick={() => setPick(k)}><Icon name={k === "chess" ? "chess-knight" : "orbit"} size={15} />{k === "chess" ? "Night Chess" : "Space Pinball"}</button>)}</div>}
      {pick === "chess" && <div className="lg-tcs" role="group" aria-label="Time control">{TCS.map((k) => { const n = waitingOn(l, k); return <button type="button" key={k} aria-pressed={tc === k} className={tc === k ? "on" : ""} onClick={() => setTc(k)}><b>{k}</b><small className={n ? "on" : ""}>{n ? `${n} waiting` : "nobody yet"}</small></button>; })}</div>}
      <div className="lg-actions">
        <button type="button" className="lg-btn big" disabled={busy || !!mine} onClick={() => void run(() => createGame(pick, tc))}><Icon name="bolt" size={17} /><span>{mine ? "YOU ARE WAITING" : "CREATE GAME"}</span></button>
        <button type="button" className="lg-btn big ghost" disabled={busy || !!mine} onClick={() => void run(() => playAnyone(pick))}><Icon name="radar" size={17} /><span>PLAY ANYONE</span></button>
      </div>
      <p className="lg-note">{pick === "chess" ? "Create a game and keep browsing: it waits in the lounge and you hear when someone joins. Play anyone takes whoever waits, on their clock." : "Free duels, the same table and the same seed. Create one and keep browsing until a rival joins."}</p>
    </div>}
    {!create && createFor && !mine && open.some((g) => !g.away && !isMine(g)) && <div className="lg-actions"><button type="button" className="lg-btn big ghost" disabled={busy} onClick={() => void run(async () => {
      if (!onSeat) return playAnyone(createFor, false);
      primeAlerts();
      const r = await post<Seated>("/api/games/lounge/any", { game: createFor, name: savedName(createFor) || "Night crew", avatar: "/games/pinball/frog-0.webp" });
      onSeat(createFor, r.match.id, r.player);
    })}><Icon name="radar" size={17} /><span>PLAY ANYONE WAITING</span></button></div>}
    {err && <p className="lg-err" role="alert"><Icon name="alert" size={15} />{err}</p>}

    <div className="lg-label"><span>OPEN GAMES</span><span>{open.length}</span></div>
    {l === null ? <p className="lv-empty" role="status">Looking for open tables…</p> : open.length ? <ul className="lv-list" aria-live="polite">{open.slice(0, 12).map((g) => <OpenRow key={`${g.game}-${g.id}`} g={g} now={now} skew={skew} mine={isMine(g)} busy={busy} onJoin={() => void join(g)} onCancel={() => void run(() => cancelGame(g.game, g.id))} />)}</ul>
      : <p className="lv-empty">Nobody is waiting right now. Open a game and the next player joins you.</p>}

    {challenges.length > 0 && <><div className="lg-label"><span>STAKED CHALLENGES</span><span>{challenges.length}</span></div>
      <ul className="lv-list">{challenges.slice(0, 6).map((c) => <li className="lg-row" key={c.matchId}>
        <span className={`lv-game ${c.game}`} aria-hidden="true"><Icon name={c.game === "chess" ? "chess-knight" : "orbit"} size={20} /></span>
        <div className="lg-who"><span className="lv-kind">{GAME_NAME[c.game]}{c.tc ? ` · ${c.tc}` : ""} · 18+</span><b><span className="lv-name">{c.name}</span></b><span className="lg-since">{c.remaining ? `open for ${waitText(c.remaining * 1000)}` : "open"}</span></div>
        <span className="lv-stake on">{Number(c.amount).toLocaleString()} {tokenLabel(c.token)}</span>
        {address && c.creator === address.toLowerCase() ? <span className="lg-mine"><em>YOURS</em></span> : <Link to={`/games/${c.game}?accept=${c.matchId}&token=${c.token}`} className="lg-btn"><Icon name="diamond" size={15} /><span>ACCEPT</span></Link>}
      </li>)}</ul></>}

    {!free && <>
      <div className="lg-label"><span>LIVE NOW</span><span>{live.length}</span></div>
      {l === null ? null : live.length ? <ul className="lv-list">{live.slice(0, 4).map((g) => <LiveRow key={`${g.game}-${g.id}`} g={g} now={now} />)}</ul> : <p className="lv-empty">No games being played right now.</p>}
      {live.length > 4 && <Link to="/games/live" className="lv-all">All live games<Icon name="arrow" size={15} /></Link>}
    </>}
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
  // the Telegram Mini App shows its own seats and banners
  return path === "/tg" || path.startsWith("/tg/") ? null : <SiteWaitingBanner path={path} />;
}
function SiteWaitingBanner({ path }: { path: string }) {
  const w = useWaiting(), now = useNow();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const onBoard = !!w && path === `/games/${w.game}` && !location.search.includes("watch=");
  useEffect(() => {
    if (!w || onBoard) return;
    const board = `/games/${w.game}`;
    const url = w.game === "chess" ? `/api/chess/match/${w.id}/events?player=${encodeURIComponent(w.player)}` : `/api/pinball/match/${w.id}/events?player=${encodeURIComponent(w.player)}`;
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
      const started = w.game === "chess" ? v.status === "countdown" || v.status === "playing" : !!v.startedAt;
      if (started) {
        over = true; es.close(); keepWaiting(null);
        alertJoined(w.game, board);
        setNotice({ kind: "joined", game: w.game, text: w.game === "pinball" ? "Your rival is here. The duel starts in a few seconds." : "Your rival is here. Your clock starts in a few seconds." });
        // a pinball duel starts on its own clock: straight to the table when the page is in view
        if (w.game === "pinball" && !document.hidden) go(board);
      }
    };
    es.onerror = () => {
      if (over) return;
      // a restart or a closed table: the seat is gone, say so instead of reconnecting forever
      void fetch(w.game === "chess" ? `/api/chess/match/${w.id}?player=${encodeURIComponent(w.player)}` : `/api/pinball/match/${w.id}?player=${encodeURIComponent(w.player)}`).then((r) => {
        if (!over && (r.status === 400 || r.status === 404)) closed("Your game is gone: the table closed. Open a new one from the lounge.");
      }).catch(() => {});
    };
    return () => { over = true; es.close(); };
  }, [w?.id, w?.game, w?.player, onBoard]);
  useEffect(() => { if (notice?.kind !== "joined") return; const t = setTimeout(() => setNotice(null), 60_000); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { if (notice && onBoard) setNotice(null); }, [onBoard]);
  if (notice) return <div className={`lg-banner ${notice.kind}`} role={notice.kind === "joined" ? "alert" : "status"}>
    <Icon name={notice.kind === "joined" ? "swords" : "alert"} size={18} />
    <p><b>{GAME_NAME[notice.game]}</b>{notice.text}</p>
    {notice.kind === "joined" && <button type="button" className="lg-btn" autoFocus onClick={() => { setNotice(null); go(`/games/${notice.game}`); }}>GO TO BOARD</button>}
    <button type="button" className="lg-x" aria-label="Dismiss" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button>
  </div>;
  if (!w || onBoard) return null;
  return <div className="lg-banner" role="status">
    <span className="lg-pulse" aria-hidden="true" />
    <p><b>{GAME_NAME[w.game]}</b>Your {w.game === "chess" ? "game" : "duel"}{w.tc ? ` (${w.tc})` : ""} is waiting · <span className="lg-clock">{waitText(now - w.since)}</span></p>
    <Link to={`/games/${w.game}`} className="lg-btn ghost">OPEN</Link>
    <button type="button" className="lg-btn ghost" disabled={busy} onClick={() => { setBusy(true); void cancelGame(w.game, w.id).catch(() => { keepWaiting(null); keepSeat(w.game, null); }).finally(() => { setBusy(false); setNotice({ kind: "closed", game: w.game, text: "You left the lounge: your game is cancelled." }); }); }}>CANCEL</button>
  </div>;
}
