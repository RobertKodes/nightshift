import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "../Icon";
import { authHeaders } from "../api";
import { go, useRoute } from "../router";
import { useSession } from "../session";
import { type ChallengeView, type Seat, type StakeGame, tokenLabel } from "../stakes";
import "./staked.css";

/**
 * Your staked games, on every page. The server knows them by your signed-in wallet
 * (GET /api/games/mine): the challenge you opened, the one you just joined (a batched approve and
 * join included), and, once both stakes are in, your own seat at the game. So the game is found
 * whatever happened to the page that paid for it: a reload, another tab, a phone that went to the
 * wallet app and came back, a creator who left to browse. When a seat is ready you hear it, get a
 * notification if the page is hidden, and the banner takes you to the table; the game's own page
 * takes the seat by itself.
 */
export type MyStake = ChallengeView & { joining: boolean; seat: { game: StakeGame; id: string; player: string } | null; startBy: number | null };
const NAME: Record<StakeGame, string> = { chess: "NIGHT CHESS", pinball: "SPACE PINBALL", pool: "NIGHT POOL" };

const st = { list: [] as MyStake[], skew: 0, subs: new Set<() => void>(), timer: null as ReturnType<typeof setTimeout> | null, users: 0, alerted: new Set<string>() };
const publish = () => { for (const f of st.subs) f(); };
let audio: AudioContext | null = null;
/** Sound needs a tap first on phones: the first one anywhere unlocks it. */
const unlock = () => { try { audio ??= new AudioContext(); void audio.resume().catch(() => {}); } catch { /* sound is optional */ } };
if (typeof window !== "undefined") { addEventListener("pointerdown", unlock, { once: true, passive: true }); addEventListener("keydown", unlock, { once: true }); }

/** A seat is ready: three rising notes, a notification while the page is hidden, the tab title. */
function alertReady(s: MyStake): void {
  if (st.alerted.has(s.matchId)) return;
  st.alerted.add(s.matchId);
  try {
    if (audio && audio.state === "running") {
      const t = audio.currentTime;
      [523, 659, 988].forEach((f, i) => {
        const o = audio!.createOscillator(), g = audio!.createGain(), at = t + i * .13;
        o.frequency.setValueAtTime(f, at); g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(.14, at + .01); g.gain.exponentialRampToValueAtTime(.0001, at + .34);
        o.connect(g); g.connect(audio!.destination); o.start(at); o.stop(at + .36);
      });
    }
  } catch { /* sound is optional */ }
  try {
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      const n = new Notification(`${NAME[s.game]}: your staked game is ready`, { body: "Both stakes are in. Tap to take your seat.", tag: `ns-stake-${s.matchId}`, icon: "/app/icon-192.png", requireInteraction: true });
      n.onclick = () => { window.focus(); go(seatPath(s)); n.close(); };
    }
  } catch { /* notifications are optional */ }
}
export const seatPath = (s: Pick<MyStake, "game" | "matchId">) => `/games/${s.game}?seat=${s.matchId}`;

async function load(): Promise<void> {
  try {
    const r = await fetch("/api/games/mine", { headers: authHeaders() });
    if (!r.ok) return;
    const j = await r.json() as { matches: MyStake[]; now: number };
    st.skew = j.now - Date.now();
    st.list = j.matches;
    for (const s of st.list) if (s.seat && !seated.has(s.matchId)) alertReady(s);
    publish();
  } catch { /* the next poll */ }
}
/** Every 4 s in view, every 15 s hidden, and at once when the page comes back. */
function schedule(): void {
  if (st.timer) clearTimeout(st.timer);
  st.timer = st.users ? setTimeout(() => { void load().finally(schedule); }, document.hidden ? 15_000 : 4_000) : null;
}
const wake = () => { if (st.users && !document.hidden) { void load(); schedule(); } };
/** The signed-in wallet's staked games, kept fresh while any page part uses them. */
export function useMyStakes(): MyStake[] {
  const { address } = useSession();
  useEffect(() => {
    if (!address) { st.list = []; publish(); return; }
    if (!st.users++) { document.addEventListener("visibilitychange", wake); addEventListener("focus", wake); addEventListener("pageshow", wake); }
    void load(); schedule();
    return () => { if (!--st.users) { document.removeEventListener("visibilitychange", wake); removeEventListener("focus", wake); removeEventListener("pageshow", wake); schedule(); } };
  }, [address]);
  return useSyncExternalStore((f) => { st.subs.add(f); return () => { st.subs.delete(f); }; }, () => st.list, () => st.list);
}

/** The matches a page is sitting at right now: no banner for those. */
const seated = new Set<string>();
const seatSubs = new Set<() => void>();
let seatedVersion = 0;
export function markSeated(matchId: string, on: boolean): void {
  if (on ? seated.has(matchId) : !seated.has(matchId)) return;
  if (on) seated.add(matchId); else seated.delete(matchId);
  seatedVersion++;
  for (const f of seatSubs) f();
}
const useSeatedVersion = () => useSyncExternalStore((f) => { seatSubs.add(f); return () => { seatSubs.delete(f); }; }, () => seatedVersion, () => 0);

/**
 * A game page takes its staked seat by itself: the one in ?seat=<match>, else any ready one for this
 * game, unless the page is in the middle of another game (`busy`: the banner offers it then).
 * `open` hears of an open challenge of yours for this game (the page shows its stake lobby).
 */
export function useStakedSeat(game: StakeGame, onSeat: (s: Seat) => void, o: { busy: boolean; following: string | null; open?: (s: MyStake) => void }): MyStake[] {
  const mine = useMyStakes();
  const taken = useRef(new Set<string>()), cb = useRef(onSeat), openCb = useRef(o.open), opened = useRef(false);
  cb.current = onSeat; openCb.current = o.open;
  useEffect(() => {
    const want = new URLSearchParams(location.search).get("seat");
    const ready = mine.filter((m) => m.seat && m.seat.game === game);
    for (const m of ready) if (m.seat!.id === o.following) { taken.current.add(m.matchId); markSeated(m.matchId, true); }
    const s = ready.find((m) => m.matchId === want) ?? ready.find((m) => !taken.current.has(m.matchId));
    if (s && !o.busy && s.seat!.id !== o.following && !taken.current.has(s.matchId)) {
      taken.current.add(s.matchId); markSeated(s.matchId, true);
      if (want) history.replaceState(null, "", location.pathname);
      cb.current({ ...s.seat!, matchId: s.matchId });
    }
    const waiting = mine.find((m) => m.game === game && !m.seat && (m.status === "open" || m.status === "pending"));
    if (waiting && !opened.current) { opened.current = true; openCb.current?.(waiting); }
  }, [mine, o.busy, o.following, game]);
  useEffect(() => () => { for (const id of taken.current) markSeated(id, false); }, []);
  return mine;
}

const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** On every page: your staked game is ready (take your seat), being dealt, or your stake is on its way. */
export function StakedBanner() {
  const path = useRoute(), mine = useMyStakes();
  useSeatedVersion();
  const [now, setNow] = useState(Date.now());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => { if (!mine.length) return; const t = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(t); }, [mine.length]);
  const onPage = (g: StakeGame) => path === `/games/${g}` && !location.search.includes("watch=");
  // a ready seat first; a game being dealt or a join on its way only away from that game's own page
  const s = mine.find((m) => m.seat && !seated.has(m.matchId) && !hidden.has(m.matchId))
    ?? mine.find((m) => !m.seat && (m.status === "joined" || m.joining) && !onPage(m.game) && !hidden.has(m.matchId))
    ?? mine.find((m) => m.status === "finished" && m.claimable && path !== "/games" && !hidden.has(m.matchId))
    ?? mine.find((m) => !m.seat && m.status === "open" && m.you === "A" && !onPage(m.game) && !hidden.has(m.matchId));
  if (!s) return null;
  const stake = `${Number(s.amount).toLocaleString()} ${tokenLabel(s.token)} each`;
  const left = s.startBy ? s.startBy - (now + st.skew) : null;
  const ready = !!s.seat;
  const text = ready ? <>Your staked game is ready · {stake}. The clock starts once you are both at the table{left !== null ? <>; void in <span className="lg-clock">{clock(left)}</span> if not</> : ""}.</>
    : s.status === "finished" ? <>{s.outcome?.draw ? "Your stake is waiting to come back" : "Your winnings are waiting"} · {stake}. The server's payout did not go through: send it from your own wallet, one confirmation.</>
    : s.status === "joined" ? <>Both stakes are in · {stake}. Your table is being set up…</>
    : s.joining ? <>Your stake is on its way · {stake}. The game opens as soon as Ethereum confirms your join.</>
    : <>Your challenge is open · {stake}. Waiting for a rival; you hear it here when someone joins.</>;
  return <div className={`lg-banner sk-banner ${ready ? "joined" : ""}`} role={ready ? "alert" : "status"}>
    {ready ? <Icon name="swords" size={18} /> : <span className="lg-pulse" aria-hidden="true" />}
    <p><b>{NAME[s.game]}{s.tc ? ` · ${s.tc}` : ""} · STAKED</b>{text}</p>
    {ready ? <button type="button" className="lg-btn" autoFocus onClick={() => { unlock(); go(seatPath(s)); }}>TAKE YOUR SEAT</button>
      : s.status === "finished" ? <button type="button" className="lg-btn" onClick={() => go("/games")}>CLAIM</button>
      : <button type="button" className="lg-btn ghost" onClick={() => go(`/games/${s.game}?token=${s.token}`)}>OPEN</button>}
    {!ready && <button type="button" className="lg-x" aria-label="Hide" onClick={() => setHidden(new Set([...hidden, s.matchId]))}><Icon name="close" size={16} /></button>}
  </div>;
}
