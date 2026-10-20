import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { go, useRoute } from "../router";
import { keepSeat } from "../games/lounge";
import { type Me, type Resolved, type Seated, TgError, tg } from "./api";
import { TgChess } from "./TgChess";
import { PlayTab } from "./PlayTab";
import { LiveTab } from "./LiveTab";
import { MeTab } from "./MeTab";
import { bootTelegram, canFullscreen, confirmAsk, haptic, inTelegram, loadTelegram, openLink, setBack, startParam, syncTheme, toggleFullscreen } from "./telegram";
import "./tg.css";

const PinballPage = lazy(() => import("../PinballPage").then((x) => ({ default: x.PinballPage })));
const PinballWatch = lazy(() => import("../pinball/Watch").then((x) => ({ default: x.PinballWatch })));

/**
 * The NIGHTSHIFT Game Room as a Telegram Mini App (/tg). Telegram-native: its theme picks our night
 * or moonlight palette, the header and bottom bar take our colours, the back button and haptics are
 * Telegram's, content stays inside the safe areas. Three tabs: Play, Live, Me. Games run on the
 * same servers as the website; a seat taken here is booked on the player's Telegram profile.
 */
type Ctx = {
  me: Me | null; setMe: (m: Me) => void; reload: () => Promise<void>;
  toast: (text: string) => void;
  /** Takes a seat the server gave and opens its game. */
  seated: (s: { game: Seated["game"]; id: string; player: string }) => void;
  /** A Mini App link to a target (t.me/<bot>/<app>?startapp=… or the Main Mini App's). */
  link: (param: string) => string;
  /** Telegram's share sheet for a link. */
  share: (url: string, text: string) => void;
};
const TgCtx = createContext<Ctx>(null as unknown as Ctx);
export const useTg = () => useContext(TgCtx);

const SEATS = "tg-seats";
/** The seats this tab holds (game:id → player token), so a reload picks the game up again. */
export function seatOf(game: string, id: string): string | null { try { return (JSON.parse(sessionStorage.getItem(SEATS) ?? "{}") as Record<string, string>)[`${game}:${id}`] ?? null; } catch { return null; } }
function keepTgSeat(game: string, id: string, player: string) { try { const all = JSON.parse(sessionStorage.getItem(SEATS) ?? "{}") as Record<string, string>; all[`${game}:${id}`] = player; sessionStorage.setItem(SEATS, JSON.stringify(all)); } catch { /* private window */ } }

/** A chess game of yours is running on screen: the back button asks before leaving it. */
const running = { current: false };

const TABS = [{ path: "/tg", label: "Play", icon: "swords" }, { path: "/tg/live", label: "Live", icon: "radar" }, { path: "/tg/me", label: "Me", icon: "user" }] as const;

export function TgApp() {
  const path = useRoute();
  const [ready, setReady] = useState<"boot" | "ok" | "outside" | "error">("boot");
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Resolved | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((text: string) => { setNote(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setNote(null), 3600); }, []);
  const reload = useCallback(async () => { setMe(await tg<Me>("me")); }, []);
  const link = useCallback((param: string) => me ? (me.bot.app ? `https://t.me/${me.bot.username}/${me.bot.app}?startapp=${encodeURIComponent(param)}` : `https://t.me/${me.bot.username}?startapp=${encodeURIComponent(param)}`) : "", [me]);
  const share = useCallback((url: string, text: string) => openLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`), []);
  const meRef = useRef(me); meRef.current = me;
  const seated = useCallback((s: { game: Seated["game"]; id: string; player: string }) => {
    keepTgSeat(s.game, s.id, s.player);
    if (s.game === "chess") go(`/tg/chess/${s.id}`);
    // the arcade page shows its own name for you: the profile's, as the server seated you
    else { keepSeat("pinball", { id: s.id, player: s.player }); try { if (meRef.current) localStorage.setItem("pb-name", meRef.current.profile.name); } catch { /* private window */ } go("/tg/pinball"); }
  }, []);

  /** A deep link: picked up at once (your own seat, a game to watch), or asked first (a challenge, a table to join). */
  const open = useCallback(async (param: string) => {
    const r = await tg<Resolved>(`start?p=${encodeURIComponent(param)}`).catch(() => null);
    if (!r) return;
    if (r.kind === "seat") seated(r);
    else if (r.kind === "watch") go(`/tg/watch/${r.game}/${r.id}`);
    else if (r.kind === "live") go("/tg/live");
    else if (r.kind === "me") go("/tg/me");
    else if (r.kind === "invite" || r.kind === "join") setSheet(r);
    else if (r.kind === "gone") toast(r.game ? "That game is over. Here is the lounge." : "That link has expired. Here is the lounge.");
  }, [seated, toast]);

  useEffect(() => {
    let off = () => {};
    void loadTelegram().then(async () => {
      if (!inTelegram()) { setReady("outside"); return; }
      bootTelegram();
      off = syncTheme();
      try {
        const m = await tg<Me>("me");
        setMe(m); setReady("ok");
        const p = startParam();
        if (p) void open(p);
      } catch (e) { setBootErr((e as Error).message); setReady(e instanceof TgError && e.status === 401 ? "outside" : "error"); }
    });
    return () => off();
  }, []);
  // a pinball verdict from the arcade page: Telegram's haptic for it
  useEffect(() => {
    const on = (e: Event) => { const r = (e as CustomEvent<{ result: string }>).detail?.result; if (r === "win") haptic.win(); else if (r === "loss") haptic.lose(); else haptic.select(); void reload().catch(() => {}); };
    addEventListener("ns:game-over", on);
    return () => removeEventListener("ns:game-over", on);
  }, [reload]);
  // Telegram's back button: shown below the three tabs, it goes up one level (and asks before leaving a running game)
  const root = TABS.some((t) => t.path === path);
  useEffect(() => {
    if (ready !== "ok" || root) { setBack(null); return; }
    const up = path.startsWith("/tg/watch/") ? "/tg/live" : "/tg";
    setBack(() => {
      if (running.current) void confirmAsk("Leave the board? Your clock keeps running on the server.").then((ok) => { if (ok) go(up); });
      else go(up);
    });
  }, [path, root, ready]);
  useEffect(() => () => setBack(null), []);

  if (ready === "boot") return <div className="tgx tgx-boot" aria-busy="true"><span className="tgx-mark"><Icon name="frog" size={34} /></span></div>;
  if (ready !== "ok") return <div className="tgx"><div className="tgx-center"><div className="tgx-card tgx-note">
    <span className="tgx-mark"><Icon name="frog" size={34} /></span>
    <h2>{ready === "outside" ? "Open the Game Room in Telegram" : "The Game Room could not start"}</h2>
    <p>{ready === "outside" ? "This page is the NIGHTSHIFT Mini App. Open it from the bot, where Telegram tells it who you are." : bootErr ?? "Try again in a moment."}</p>
    {ready === "outside" ? <a className="tgx-btn" href="https://t.me/nightshiftimdbot?startapp=lounge">Open @nightshiftimdbot</a> : <button type="button" className="tgx-btn" onClick={() => location.reload()}>Try again</button>}
    <a className="tgx-btn ghost" href="/games">Play on the website</a>
  </div></div></div>;

  const seg = path.split("/").filter(Boolean);
  let view: React.ReactNode;
  if (seg[1] === "chess" && seg[2]) {
    const id = seg[2], player = seatOf("chess", id) ?? me?.seats.find((s) => s.game === "chess" && s.id === id)?.player ?? null;
    view = <ChessView key={id} id={id} player={player} />;
  } else if (seg[1] === "watch" && seg[2] === "chess" && seg[3]) view = <WatchChess key={seg[3]} id={seg[3]} />;
  else if (seg[1] === "watch" && seg[2] === "pinball" && seg[3]) view = <Suspense fallback={<div className="tgx-center"><span className="tgx-radar"><Icon name="radar" size={30} /></span></div>}><div className="tgx-pin-watch"><PinballWatch id={seg[3]} plain /></div></Suspense>;
  else if (seg[1] === "pinball") view = <Suspense fallback={<div className="arc-boot" />}><div className="tgx-pinball"><PinballPage embedded={{ home: "/tg", onLobby: () => { void reload().catch(() => {}); go("/tg"); } }} /></div></Suspense>;
  else if (seg[1] === "live") view = <LiveTab />;
  else if (seg[1] === "me") view = <MeTab />;
  else view = <PlayTab />;
  const full = seg[1] === "pinball";

  return <TgCtx.Provider value={{ me, setMe, reload, toast, seated, link, share }}>
    <div className={`tgx ${root ? "tgx-tabbed" : ""} ${full ? "tgx-full" : ""}`}>
      {!full && <header className="tgx-top">
        <span className="tgx-brand"><span className="tgx-mark sm"><Icon name="frog" size={20} /></span><b>NIGHTSHIFT</b><small>GAME ROOM</small></span>
        <span className="tgx-tools">
          {canFullscreen() && <button type="button" className="tgx-icon" aria-label="Full screen" onClick={() => { haptic.tap(); toggleFullscreen(); }}><Icon name="expand" size={18} /></button>}
          {me && <button type="button" className="tgx-chip" onClick={() => { haptic.select(); go("/tg/me"); }} aria-label={`Your profile: ${me.profile.games.chess.elo} Elo`}><Icon name="trophy" size={14} />{me.profile.games.chess.elo}</button>}
        </span>
      </header>}
      <main className="tgx-main">{view}</main>
      {root && <nav className="tgx-tabs" aria-label="Game Room">{TABS.map((t) => <button type="button" key={t.path} className={path === t.path ? "on" : ""} aria-current={path === t.path ? "page" : undefined} onClick={() => { if (path !== t.path) { haptic.select(); go(t.path); } }}><Icon name={t.icon} size={21} /><span>{t.label}</span></button>)}</nav>}
      {note && <div className="tgx-toast" role="status">{note}</div>}
      {sheet && <DeepLinkSheet r={sheet} onClose={() => setSheet(null)} />}
    </div>
  </TgCtx.Provider>;
}

function ChessView({ id, player }: { id: string; player: string | null }) {
  const { link, share, reload } = useTg();
  useEffect(() => () => { running.current = false; void reload().catch(() => {}); }, []);
  // the result is booked on the profile within a couple of seconds: the header's Elo follows
  const done = () => { setTimeout(() => void reload().catch(() => {}), 2_500); };
  if (!player) return <WatchChess id={id} />;
  return <TgChess id={id} player={player}
    onMoved={(next) => { keepTgSeat("chess", next, player); go(`/tg/chess/${next}`); }}
    onExit={() => { running.current = false; go("/tg"); }}
    onShare={(mid) => share(link(`chess_${mid}`), "♟ Sit down at my NIGHT CHESS table")}
    onRunning={(on) => { running.current = on; }} onDone={done} />;
}
function WatchChess({ id }: { id: string }) {
  return <TgChess id={id} player={null} onMoved={(next) => go(`/tg/watch/chess/${next}`)} onExit={() => go("/tg/live")} />;
}

/** A challenge or an open table from a link: who, which clock, one tap to sit down. */
function DeepLinkSheet({ r, onClose }: { r: Resolved; onClose: () => void }) {
  const { seated, toast, link, share } = useTg();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (r.kind !== "invite" && r.kind !== "join") return null;
  const accept = async () => {
    setBusy(true); setErr(null); haptic.tap();
    try {
      const s = r.kind === "invite" ? await tg<{ game: "chess"; match: { id: string }; player: string }>(`invite/${r.invite.id}/accept`, {}) : await tg<Seated>("play", { game: r.game, action: "join", id: r.id });
      onClose(); seated({ game: s.game, id: s.match.id, player: s.player });
    } catch (e) { setErr((e as Error).message); haptic.error(); } finally { setBusy(false); }
  };
  const own = r.kind === "invite" && r.own;
  const title = r.kind === "invite" ? (own ? "Your challenge" : `${r.invite.host?.name ?? "A player"} challenges you`) : `Join ${r.host}'s table`;
  const game = r.kind === "invite" ? "NIGHT CHESS" : r.game === "chess" ? "NIGHT CHESS" : "SPACE PINBALL";
  const tc = r.kind === "invite" ? r.invite.tc : r.tc;
  return <div className="tgx-sheet" role="dialog" aria-modal="true" aria-labelledby="tgx-sheet-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="tgx-sheet-card">
      <span className="tgx-kicker">{game}{tc ? ` · ${tc}` : ""} · FREE · RATED</span>
      <h2 id="tgx-sheet-title">{title}</h2>
      {r.kind === "invite" && r.invite.host && !own && <p>{r.invite.host.name} plays at <b>{r.invite.host.elo}</b> Elo. The clock starts once you are both at the table.</p>}
      {own ? <p>Share it in a chat: the first to accept plays you, and you get a DM here to take your seat.</p> : r.kind === "join" && <p>The host is at the table now: the game starts a few seconds after you sit down.</p>}
      {err && <p className="tgx-err" role="alert"><Icon name="alert" size={15} />{err}</p>}
      <div className="tgc-row">
        {own ? <button type="button" className="tgx-btn" onClick={() => { share(link(`chess_${r.invite.id}`), "♟ Accept my NIGHT CHESS challenge"); onClose(); toast("Pick a chat to send your challenge to."); }}><Icon name="external" size={16} />Share the challenge</button>
          : <button type="button" className="tgx-btn" disabled={busy} onClick={() => void accept()}><Icon name="swords" size={16} />{busy ? "Sitting down…" : r.kind === "invite" ? "Accept the challenge" : "Sit down"}</button>}
        <button type="button" className="tgx-btn ghost" onClick={onClose}>Not now</button>
      </div>
    </div>
  </div>;
}
