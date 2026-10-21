import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BetPanel } from "./bets";
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { go } from "./router";
import { Icon } from "./Icon";
import { useSession } from "./session";
import { NxTabs as AppTabsNx } from "./nx/Shell";
const AppTabs = (_: { active: string }) => <AppTabsNx room="breakroom" />;
import { Board } from "./chess/Board";
import { ChessSound } from "./chess/sound";
import { Practice } from "./chess/practice";
import { api, clockText, CONTROLS, type Leaderboard, type MatchView, type PlayerView, type TimeControl } from "./chess/types";
import "./chess/chess.css";
import "./games/live.css";
import { type Seat, StakeLobby, StakeResult, tokenLabel, useEscrow } from "./stakes";
import { alertJoined, doneWaiting, keepWaiting, Lounge, primeAlerts, useLounge, waitingOn, waitText } from "./games/lounge";
import { useStakedSeat } from "./games/staked";
import { handleFor, nameOr, typedName } from "./games/handle";

const OPENING = new Chess().fen();
const DEMO = "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 4 7";
const VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECES: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const REASONS: Record<string, string> = { checkmate: "Checkmate. The king has nowhere left to go.", timeout: "Time is up. The clock decided this one.", resignation: "The game ended by resignation.", stalemate: "Stalemate. No legal moves, no check.", repetition: "The same position appeared three times.", agreement: "A draw by mutual agreement.", abandonment: "A player was away from the table too long on their turn.", "insufficient material": "Neither side has enough material to mate.", "50-move rule": "Fifty moves without a pawn move or capture.", paused: "The house exhibition stepped aside: the tables are busy, and real games come first.", void: "Void: a player never came to the table or never made a move, so nobody loses. Both stakes go back." };

/** A house bot's frog ("Frog #13" plays as NIGHT FROG #13), else null. */
const houseFrog = (name: string) => /^Frog #(\d{1,3})(?: \(bot\))?$/.exec(name)?.[1] ?? null;
function FrogPortrait({ frog = "007", className = "" }: { frog?: string; className?: string }) {
  // the real onchain NIGHT FROG (its SVG, read from the contract), cropped to the face
  return <span className={`nc-frog-portrait ${className}`}><img src={`/api/pinball/frog/${Number(frog)}`} alt={`NIGHT FROG #${Number(frog)}`} width="300" height="300" decoding="async" loading="lazy"/></span>;
}
function Wordmark() {
  return <span className="nc-wordmark"><Icon name="frog" size={32}/><span><b>NIGHT <em>CHESS</em></b><small>· by <strong>NIGHTSHIFT</strong></small></span></span>;
}
function ImdSignature() {
  return <span className="nc-imd">BUILT ON IMD <Icon name="imd-mark" size={13}/></span>;
}
function PlayerCard({ player, ms, active, captured, advantage, label, away }: { player: PlayerView; ms: number; active: boolean; captured: PieceSymbol[]; advantage: number; label?: string; away?: number | null }) {
  return <div className={`nc-player ${active ? "running" : ""} ${ms < 20_000 ? "low" : ""}`}>
    <FrogPortrait frog={houseFrog(player.name) ?? (player.color === "w" ? "001" : "002")} className={`nc-avatar ${player.color}`}/>
    <div className="nc-player-info"><b>{player.name}<small>{label ?? (player.you ? "YOU" : "RIVAL")}</small></b><span>{player.rating} ELO{!player.connected && (away != null ? <> · <em className="nc-away">reconnecting {clockText(away)}</em></> : " · reconnecting")}</span>
      <div className="nc-captured" aria-label={`Captured ${captured.map((p)=>PIECES[p]).join(", ") || "none"}${advantage > 0 ? `, up ${advantage}` : ""}`}>{captured.map((p,i)=><Icon name={`chess-${PIECES[p]}`} size={15} key={i}/>)}{advantage>0 && <strong>+{advantage}</strong>}</div>
    </div><div className="nc-clock" aria-label={`${player.name}: ${clockText(ms)}`}><span className="nc-clock-dot"/>{clockText(ms)}</div>
  </div>;
}

export function ChessPage() {
  const { address, signIn, busy: signing } = useSession();
  // the name typed once, else the player's own handle (never a name everyone shares)
  const [name,setName] = useState(()=>{try{const n=localStorage.getItem("nc-name");return typedName(n) ? n! : handleFor();}catch{return handleFor();}});
  useEffect(()=>{try{if(!typedName(localStorage.getItem("nc-name")))setName(handleFor(address));}catch { /* private window */ }},[address]);
  const playName=nameOr(name,address);
  const [tc,setTc] = useState<TimeControl>("3+2");
  // ?accept=<match>&token=IMD (from the lounge): the stake lobby, where that challenge is accepted
  const [money,setMoney] = useState<"FREE" | "IMD" | "SHIFT">(()=>{const t=new URLSearchParams(location.search).get("token");return t==="IMD" || t==="SHIFT" ? t : "FREE";});
  const lounge = useLounge();
  const [closedNote,setClosedNote] = useState<string | null>(null);
  const escrow = useEscrow();
  const [match,setMatch] = useState<MatchView | null>(null);
  const [token,setToken] = useState("");
  const [mode,setMode] = useState<"online" | "practice">("online");
  const [selected,setSelected] = useState<Square | null>(null);
  const [promotion,setPromotion] = useState<{from: Square;to: Square} | null>(null);
  const [confirm,setConfirm] = useState<"resign" | "draw" | "exit" | null>(null);
  const [err,setErr] = useState<string | null>(null);
  const [busy,setBusy] = useState(false);
  const [connected,setConnected] = useState(true);
  const [soundOn,setSoundOn] = useState(()=>{try{return localStorage.getItem("nc-sound") !== "off";}catch{return true;}});
  const [leaderboard,setLeaderboard] = useState<Leaderboard>({board:[],best:[]});
  const [tab,setTab] = useState<"board" | "best">("board");
  const [time,setTime] = useState(Date.now());
  // Spectator mode (/games/chess?watch=<id>): a read-only stream of someone else's game, white at the bottom unless flipped.
  const [watchId,setWatchId] = useState(()=>new URLSearchParams(location.search).get("watch"));
  const [flipped,setFlipped] = useState(false);
  const [viewers,setViewers] = useState(0);
  const watching = useRef(watchId);
  const spectate = !!watchId;
  const source = useRef<EventSource | null>(null), current = useRef<MatchView | null>(null), playerToken = useRef(""), offset = useRef(0);
  const practice = useRef<Practice | null>(null), sound = useRef<ChessSound | null>(null), mounted = useRef(true), history = useRef<HTMLDivElement>(null);
  const shownPly = useRef(0), lastTick = useRef(0), actionPending = useRef(false), refreshStream = useRef<(id: string, player: string)=>void>(()=>{});
  const receive = useCallback((incoming: MatchView) => {
    if (!mounted.current) return;
    const old=current.current;
    if(old?.id===incoming.id && incoming.version<old.version)return;
    if(!incoming.moves) {
      if(old?.id!==incoming.id || incoming.ply>old.ply+1 || incoming.ply<old.ply) { refreshStream.current(incoming.id,playerToken.current);return; }
      incoming={...incoming,moves:incoming.ply===old.ply ? old.moves : [...old.moves,incoming.lastMove!]};
    }
    const sample=incoming.now-Date.now();offset.current=old?.id===incoming.id ? Math.max(offset.current,sample) : sample;
    if(old?.id!==incoming.id) {shownPly.current=incoming.ply;setSelected(null);setPromotion(null);setConfirm(null);}
    else if(incoming.ply>shownPly.current) {shownPly.current=incoming.ply;sound.current?.play(incoming.check ? "check" : incoming.lastMove?.captured ? "capture" : "move");setSelected(null);setPromotion(null);}
    if(incoming.done){setConfirm(null);setPromotion(null);setSelected(null);}
    if(!watching.current && !practice.current) {
      // folded into an older table in the lounge: the same seat, followed there
      if(incoming.movedTo){keepWaiting(null);try{sessionStorage.setItem("nc-match",JSON.stringify({id:incoming.movedTo,player:playerToken.current}));}catch { /* private window */ }refreshStream.current(incoming.movedTo,playerToken.current);return;}
      // an open game that closed unplayed: back to the lobby, and why
      if(incoming.done && !incoming.startedAt){
        doneWaiting("chess",incoming.id);source.current?.close();source.current=null;current.current=null;setMatch(null);setToken("");setConnected(true);
        try{sessionStorage.removeItem("nc-match");}catch { /* private window */ }
        if(incoming.expired)setClosedNote(incoming.expired==="away" ? "Your game closed: you were away for more than 90 seconds. Open a new one, or join someone in the lounge." : "Nobody joined in 30 minutes, so your game closed. Open a new one, or join someone in the lounge.");
        return;
      }
      if(incoming.startedAt){doneWaiting("chess",incoming.id);if(old?.id===incoming.id && !old.startedAt && !incoming.done){sound.current?.play("check");alertJoined("chess","/games/chess");}}
      else if(!incoming.done && !incoming.escrow)keepWaiting({game:"chess",id:incoming.id,player:playerToken.current,tc:incoming.tc,since:incoming.waitingSince ?? Date.now()});
    }
    current.current=incoming;setMatch(incoming);
    if(incoming.rematchId) refreshStream.current(incoming.rematchId,playerToken.current);
  },[]);
  const follow = useCallback((id: string, player: string) => {
    source.current?.close();playerToken.current=player;setToken(player);setConnected(false);
    const watch=!!watching.current;
    const es=new EventSource(watch ? `/api/chess/match/${id}/watch` : `/api/chess/match/${id}/events?player=${encodeURIComponent(player)}`);source.current=es;
    es.onopen=()=>{if(mounted.current)setConnected(true);};
    es.onmessage=(event)=>{if(source.current!==es)return;try {
      const frame=JSON.parse(event.data) as MatchView & {viewers?: number};
      if(watch && typeof frame.viewers==="number")setViewers(frame.viewers);
      receive(frame);
      // a finished game has nothing more to show: free the spectator's place in the stands
      if(watch && frame.done){es.close();source.current=null;}
    }catch {setErr("The live update could not be read. Reconnecting…");es.close();refreshStream.current(id,player);}};
    es.onerror=()=>{
      if(source.current!==es || !mounted.current)return;
      setConnected(false);
      // a spectator's stream reconnects by itself; refused (gone, full) it stops here
      if(watch){if(es.readyState===EventSource.CLOSED){source.current=null;setConnected(true);if(!current.current?.done)setErr(current.current ? "This game has closed." : "This game is not live any more, or the stands are full. Pick another one.");}return;}
      // A restart or expired table must not leave a saved seat reconnecting forever.
      void fetch(`/api/chess/match/${id}?player=${encodeURIComponent(player)}`).then(async r=>{
        if(source.current!==es || !mounted.current)return;
        if(r.status===400 || r.status===404) {
          es.close();source.current=null;current.current=null;setMatch(null);setToken("");setConnected(true);setErr("That table has closed. Find a new rival.");
          try{sessionStorage.removeItem("nc-match");}catch { /* private window */ }
        }else if(r.ok)receive(await r.json() as MatchView);
      }).catch(()=>{});
    };
  },[receive]);
  refreshStream.current=follow;

  useEffect(()=>{
    mounted.current=true;sound.current=new ChessSound();
    const title=document.title;document.title=watching.current ? "Watching live · NIGHT CHESS" : "NIGHT CHESS · NIGHTSHIFT";
    const update=()=>void api<Leaderboard>("board").then((b)=>{if(mounted.current)setLeaderboard(b);}).catch(()=>{});update();
    // Restoring the private token reconnects an ongoing match after a refresh.
    if(watching.current)follow(watching.current,"");
    else try {const saved=JSON.parse(sessionStorage.getItem("nc-match") ?? "null") as {id:string;player:string} | null;if(saved){setMode("online");follow(saved.id,saved.player);}}catch { /* no saved seat */ }
    const timer=setInterval(()=>{if(document.hidden)return;setTime(Date.now());const p=practice.current;if(p?.flag())receive(p.state);},100);
    const boardTimer=setInterval(update,30_000);
    return()=>{mounted.current=false;source.current?.close();clearInterval(timer);clearInterval(boardTimer);sound.current?.close();document.title=title;};
  },[follow,receive]);
  useEffect(()=>{if(sound.current)sound.current.enabled=soundOn;try{localStorage.setItem("nc-sound",soundOn ? "on" : "off");}catch { /* private window */ }},[soundOn]);
  useEffect(()=>{if(mode==="online" && match && token)try{sessionStorage.setItem("nc-match",JSON.stringify({id:match.id,player:token}));}catch { /* private window */ }},[match?.id,mode,token]);
  useEffect(()=>{history.current?.scrollTo({top:history.current.scrollHeight,behavior:"smooth"});},[match?.ply]);
  useEffect(()=>{if(!match?.done)return;void api<Leaderboard>("board").then(setLeaderboard).catch(()=>{});},[match?.done]);
  const game=useMemo(()=>new Chess(match?.fen ?? OPENING),[match?.fen]);
  const targets=useMemo(()=>selected ? game.moves({square:selected,verbose:true}).map(m=>({square:m.to,capture:!!m.captured})) : [],[game,selected]);
  const inGame=!!match?.startedAt;
  const now=time+(mode==="online" ? offset.current : 0);
  const countdown=match?.startedAt ? Math.max(0,Math.ceil((match.startedAt-now)/1000)) : 0;
  const running=!!match && !match.done && !!match.startedAt && now>=match.startedAt;
  const clocks=match ? {...match.clocks} : {w:0,b:0};
  if(match && running)clocks[match.turn]=Math.max(0,clocks[match.turn]-Math.max(0,now-Math.max(match.now,match.startedAt!)));
  const myColor=spectate ? flipped ? "b" : "w" : match?.you ?? "w";
  useEffect(()=>{
    if(mode!=="practice" || !practice.current || !match || match.done || match.turn!=="b")return;
    const id=setTimeout(()=>{const p=practice.current;if(p)receive(p.bot());},650+Math.random()*350);
    return()=>clearTimeout(id);
  },[mode,match?.id,match?.ply,match?.done,match?.turn,receive]);
  useEffect(()=>{
    const seconds=Math.ceil(clocks[myColor]/1000);
    if(!spectate && running && match?.turn===myColor && seconds>0 && seconds<=20 && lastTick.current!==seconds){lastTick.current=seconds;sound.current?.play("tick");}
  },[time,running,match?.turn,myColor]);
  const start = async (practiceMode=false) => {
    if(actionPending.current)return;actionPending.current=true;setBusy(true);setErr(null);setClosedNote(null);sound.current?.unlock();if(!practiceMode)primeAlerts();
    try {if(typedName(name) && name!==handleFor(address))localStorage.setItem("nc-name",name);}catch { /* private window */ }
    try {
      source.current?.close();setSelected(null);setConfirm(null);offset.current=0;shownPly.current=0;current.current=null;
      if(practiceMode){setMode("practice");practice.current=new Practice(playName,tc);receive(practice.current.state);setConnected(true);}
      else {practice.current=null;setMode("online");const r=await api<{match:MatchView;player:string}>("queue",{name:playName,tc});if(!mounted.current)return;playerToken.current=r.player;receive(r.match);follow(r.match.id,r.player);}
    } catch(e){setErr((e as Error).message);}finally {actionPending.current=false;if(mounted.current)setBusy(false);}
  };
  // /games/chess?practice=1 (the Game Room's Practice): straight to a game against Frog #7
  useEffect(()=>{if(new URLSearchParams(location.search).get("practice")){window.history.replaceState(null,"","/games/chess");void start(true);}},[]);
  const move=useCallback(async (from: Square,to: Square,promote?: string)=>{
    const m=current.current;if(!m || m.done || actionPending.current)return;
    actionPending.current=true;setBusy(true);setErr(null);sound.current?.unlock();
    try {if(practice.current)receive(practice.current.move(from,to,promote));else receive(await api<MatchView>(`match/${m.id}/move`,{player:playerToken.current,from,to,promotion:promote}));}
    catch(e){setErr((e as Error).message);}finally {actionPending.current=false;if(mounted.current){setBusy(false);setPromotion(null);setSelected(null);}}
  },[receive]);
  const pick=useCallback((square: Square)=>{
    const m=current.current;sound.current?.unlock();
    if(!m || m.done || m.turn!==m.you || !m.startedAt || Date.now()+(practice.current ? 0 : offset.current)<m.startedAt || actionPending.current)return;
    const chess=new Chess(m.fen);
    if(selected) {
      const moves=chess.moves({square:selected,verbose:true}).filter(x=>x.to===square);
      if(moves.length){if(moves.some(x=>x.promotion))setPromotion({from:selected,to:square});else void move(selected,square);return;}
    }
    setSelected(chess.get(square)?.color===m.you && selected!==square ? square : null);
  },[selected,move]);
  /** Both stakes are in: take the seat the lobby gave this wallet. */
  const seat=(s: Seat)=>{source.current?.close();practice.current=null;current.current=null;offset.current=0;shownPly.current=0;setErr(null);setMode("online");follow(s.id,s.player);};
  // a staked seat found by the wallet (any tab, after a reload, from the banner's ?seat=): taken here unless another game is on
  useStakedSeat("chess",seat,{busy:!!match && !match.done && !match.escrow && (mode==="practice" || !!match.startedAt),following:match?.escrow ? match.id : null,open:(s)=>{if(!new URLSearchParams(location.search).get("token"))setMoney((m)=>m==="FREE" ? s.token : m);}});
  const lobby=()=>{if(watching.current){watching.current=null;setWatchId(null);setViewers(0);window.history.replaceState(null,"","/games/chess");document.title="NIGHT CHESS · NIGHTSHIFT";}if(current.current)doneWaiting("chess",current.current.id);source.current?.close();source.current=null;practice.current=null;current.current=null;setMatch(null);setToken("");setSelected(null);setPromotion(null);setConfirm(null);setErr(null);setConnected(true);try{sessionStorage.removeItem("nc-match");}catch { /* private window */ }};
  /** A seat from the lounge on this page: the same as a seat from the queue. */
  const loungeSeat=(_game: string,id: string,player: string)=>{source.current?.close();practice.current=null;current.current=null;offset.current=0;shownPly.current=0;setErr(null);setClosedNote(null);setMode("online");try{if(typedName(name) && name!==handleFor(address))localStorage.setItem("nc-name",name);}catch { /* private window */ }follow(id,player);};
  const cancelSearch=async()=>{
    if(!match || actionPending.current)return;actionPending.current=true;setBusy(true);
    try {await api(`match/${match.id}/leave`,{player:token});lobby();}
    catch(e){setErr((e as Error).message);}finally {actionPending.current=false;setBusy(false);}
  };
  const action=async(kind:"resign"|"draw"|"rematch",choice?:string)=>{
    if(!match || actionPending.current)return;actionPending.current=true;setBusy(true);setErr(null);sound.current?.unlock();
    try {
      if(mode==="practice") {const p=practice.current;if(p)receive(kind==="resign" ? p.resign() : p.draw());}
      else receive(await api<MatchView>(`match/${match.id}/${kind}`,{player:token,action:choice}));
      if(confirm==="exit"){lobby();go("/games");}else setConfirm(null);
    }catch(e){setErr((e as Error).message);}finally {actionPending.current=false;setBusy(false);}
  };
  const captures:Record<Color,PieceSymbol[]>={w:[],b:[]};
  for(const m of match?.moves ?? [])if(m.captured)captures[m.color].push(m.captured);
  const material:Record<Color,number>={w:0,b:0};
  for(const row of game.board())for(const p of row)if(p)material[p.color]+=VALUES[p.type];
  // a spectator sees the board from white (or black, flipped): that side's card at the bottom
  const mine=spectate ? match?.players.find(p=>p.color===myColor) : match?.players.find(p=>p.you),rival=spectate ? match?.players.find(p=>p.color!==myColor) : match?.players.find(p=>!p.you);
  const awayLeft=(p?:PlayerView)=>p?.awayUntil ? Math.max(0,p.awayUntil-now) : null;
  const playerCard=(p:PlayerView)=> <PlayerCard player={p} ms={clocks[p.color]} active={running && match?.turn===p.color} captured={captures[p.color]} advantage={material[p.color]-material[p.color==="w" ? "b":"w"]} label={spectate ? p.color==="w" ? "WHITE" : "BLACK" : undefined} away={awayLeft(p)}/>;
  const rivalAway=awayLeft(rival);
  const rivalLost=!rival?.connected ? rivalAway!==null ? match?.escrow ? `Your rival is reconnecting: ${clockText(rivalAway)} left of their reconnection time. If it runs out you win; a game they never made a move in is void (both stakes go back).` : `Your rival lost connection: ${clockText(rivalAway)} left. If they stay away on their turn, you win by abandonment.` : match?.escrow ? "Your rival lost connection. Their reconnection time (2 minutes in all) counts on their turn." : "Your rival lost connection. If they stay away 45 seconds on their turn, you win by abandonment." : "";
  const startBy=match?.showBy ? Math.max(0,match.showBy-now) : null;
  const mineWon=spectate ? !!match?.winner && match.winner===mine?.color : !!match?.winnerIsYou;
  const turnName=match?.players.find(p=>p.color===match.turn)?.name ?? "";
  const watchAnother=()=>{source.current?.close();source.current=null;go("/games/live");};
  /** From the house exhibition to a practice game against Frog #7 (not rated). */
  const challenge=()=>{lobby();void start(true);};
  const house=spectate && !!match?.house;
  const error=err && <div className="nc-error" role="alert"><Icon name="alert" size={16}/><span>{err}</span><button type="button" onClick={()=>setErr(null)} aria-label="Dismiss error"><Icon name="close" size={16}/></button></div>;
  useEffect(()=>{
    const dialogs=document.querySelectorAll<HTMLElement>(".nc [role='dialog']"),dialog=dialogs[dialogs.length-1];
    if(!dialog)return;
    const before=document.activeElement as HTMLElement | null;
    const focusable=()=>Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],input,select,[tabindex='0']"));
    focusable()[0]?.focus();
    const trap=(e:KeyboardEvent)=>{if(e.key!=="Tab")return;const nodes=focusable(),first=nodes[0],last=nodes.at(-1);if(e.shiftKey && (document.activeElement===first || !dialog.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey && (document.activeElement===last || !dialog.contains(document.activeElement))){e.preventDefault();first?.focus();}};
    document.addEventListener("keydown",trap);
    return()=>{document.removeEventListener("keydown",trap);if(before?.isConnected)before.focus();};
  },[confirm,!!promotion,match?.status==="waiting"]);

  return <div className={`nc ${inGame ? "nc-playing" : ""}`}>
    <div className="nc-backdrop" aria-hidden="true"/>
    <header className="nc-top">
      <a href="/games" className="nc-back" onClick={(e)=>{e.preventDefault();if(spectate)watchAnother();else if(match && !match.done && inGame)setConfirm("exit");else go("/games");}}><Icon name="arrow" size={17}/><span>{spectate ? "LIVE GAMES" : "GAME ROOM"}</span></a>
      <a href="/games/chess" className="nc-brand" aria-label="Night Chess by NIGHTSHIFT" onClick={(e)=>{e.preventDefault();if(spectate)lobby();else if(match){if(match.done)lobby();else if(inGame)setConfirm("exit");else void cancelSearch();}}}><Wordmark/></a>
      <div className="nc-account">{address ? <span className="nc-wallet"><Icon name="user" size={15}/>{address.slice(0,6)}…{address.slice(-4)}</span> : <button type="button" className="nc-btn ghost small" disabled={signing} onClick={()=>void signIn()}><Icon name="user" size={15}/><span>{signing ? "SIGNING IN" : "SIGN IN"}</span></button>}</div>
    </header>

    {!inGame && <main className="nc-lobby">
      <section className="nc-stage" aria-labelledby="nc-title">
        <div className="nc-stage-head"><h1 id="nc-title">NIGHT <em>CHESS</em></h1><p>Real-time chess against people or Frog #7. Free and rated, or staked in $SHIFT or IMD.</p></div>
        <div className="nc-cabinet"><Board fen={DEMO} demo/></div>
      </section>
      <section className="nc-panel" aria-label="Set up your game">
        <div className="nc-name-row"><label className="nc-name-label" htmlFor="nc-name">Your name</label><div className="nc-name-field"><input id="nc-name" value={name} maxLength={18} placeholder={handleFor(address)} autoComplete="nickname" disabled={!!match || busy} onChange={e=>setName(e.target.value)}/><Icon name="edit" size={16}/></div></div>
        <div className="nc-section-label"><span>Clock</span><span className="nc-muted">{CONTROLS[tc].note}</span></div>
        <div className="nc-controls" role="group" aria-label="Time control">{(Object.keys(CONTROLS) as TimeControl[]).map(k=><button type="button" disabled={!!match || busy} key={k} className={tc===k ? "on" : ""} aria-pressed={tc===k} onClick={()=>setTc(k)}><b>{k}</b><span>{CONTROLS[k].label}</span><small className={`nc-waiting ${waitingOn(lounge,k) ? "on" : ""}`}>{waitingOn(lounge,k) ? `${waitingOn(lounge,k)} waiting` : "nobody waiting"}</small>{tc===k && <Icon name="check" size={13}/>}</button>)}</div>
        <div className="nc-section-label"><span>Play for</span><span className="nc-muted">{money==="FREE" ? "rated, no wallet needed" : "winner gets 95% of the pot"}</span></div>
        <div className="nc-controls" role="group" aria-label="Stake">{(["FREE","IMD","SHIFT"] as const).map(k=><button type="button" disabled={!!match || busy} key={k} className={money===k ? "on" : ""} aria-pressed={money===k} onClick={()=>setMoney(k)}><b>{k==="FREE" ? "Free" : tokenLabel(k)}</b><span>{k==="FREE" ? "no stake" : escrow?.live ? "stake" : "not open yet"}</span>{money===k ? <Icon name="check" size={13}/> : k!=="FREE" && !escrow?.live ? <Icon name="lock" size={13}/> : null}</button>)}</div>
        {money==="FREE" ? <button type="button" className="nc-btn primary" disabled={busy || !!match} onClick={()=>void start()}><Icon name="swords" size={19}/><span>{busy ? "OPENING YOUR TABLE" : "FIND A RIVAL"}</span><Icon name="arrow" size={18}/></button>
          : <StakeLobby game="chess" token={money} name={playName} tc={tc} address={address} signIn={signIn} onSeat={seat} theme="nc"/>}
        <button type="button" className="nc-btn ghost" disabled={busy || !!match} onClick={()=>void start(true)}><FrogPortrait/>Practice vs Frog #7<span className="nc-muted">not rated</span></button>
        {closedNote && <div className="nc-error" role="status"><Icon name="clock" size={16}/><span>{closedNote}</span><button type="button" onClick={()=>setClosedNote(null)} aria-label="Dismiss"><Icon name="close" size={16}/></button></div>}
        {error}
        {money==="FREE" && <Lounge game="chess" onSeat={loungeSeat}/>}
        <div className="nc-section-label"><span>How it plays</span></div>
        <div className="nc-how">{[["swords","A real rival","Find a rival on the same clock, or join a table in the lounge."],["target","Your move","Tap a piece, then a glowing square. Drag to turn the board."],["shield","A fair table","The server checks every move and keeps both clocks."],["trophy","Your rating","Everyone starts at 1200. Two moves each and the game counts."]].map(([icon,title,copy])=><div key={title}><Icon name={icon!} size={22}/><b>{title}</b><p>{copy}</p></div>)}</div>
        <div className="nc-leaderboard"><div className="nc-section-label"><span><Icon name="trophy" size={15}/> Leaderboard</span><span>ELO</span></div>
          <div className="nc-tabs" role="group" aria-label="Leaderboard period">{([['board','Tonight'],['best','All time']] as const).map(([k,label])=><button type="button" key={k} aria-pressed={tab===k} className={tab===k ? "on" : ""} onClick={()=>setTab(k)}>{label}</button>)}</div>
          {leaderboard[tab].length ? <ol>{leaderboard[tab].map((p,i)=><li className={i<3 ? `ns-place-${i+1}` : undefined} key={`${p.name}-${i}`}><span className={`ns-rank ${i<3 ? "ns-medal" : ""}`} aria-label={`Place ${i+1}`}>{i<3 && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="m8 14-2 8 6-3 6 3-2-8"/><circle cx="12" cy="9" r="7"/></svg>}<span aria-hidden="true">{i<3 ? i+1 : String(i+1).padStart(2,"0")}</span></span><div><b>{p.name}</b><small>{p.wins} W / {p.games} G</small></div><strong>{p.rating}</strong></li>)}</ol> : <p className="nc-empty">No rated games{tab==="board" ? " in the last 24 hours" : " yet"}.<br/>The first move is yours.</p>}
        </div>
        <p className="nc-legal"><Icon name="lock" size={14}/><span>Free games need no wallet. Staked games: 18+, only where allowed.</span></p>
      </section>
    </main>}

    {inGame && match && mine && rival && <main className="nc-game">
      <div className="nc-game-heading"><span className="nc-kicker">{mode==="practice" ? "PRACTICE / FROG #7" : house ? <><i className="nc-live"/> HOUSE · EXHIBITION, NOT RATED · {viewers} WATCHING</> : spectate ? <><i className="nc-live"/> SPECTATING · {viewers} WATCHING</> : match.escrow ? <><i className="nc-live"/> STAKED · {Number(match.stake ?? 0).toLocaleString()} {tokenLabel(match.currency)} EACH</> : <><i className="nc-live"/> LIVE DUEL</>}<span className="nc-heading-tc">{match.tc} · {CONTROLS[match.tc].label.toUpperCase()}</span></span><div className="nc-game-tools"><ImdSignature/>{spectate && <button type="button" className="nc-icon-btn" aria-label={flipped ? "View from white" : "View from black"} aria-pressed={flipped} onClick={()=>setFlipped(!flipped)}><Icon name="swap" size={20}/></button>}<button type="button" className="nc-icon-btn" aria-label={soundOn ? "Mute sounds" : "Enable sounds"} aria-pressed={soundOn} onClick={()=>{sound.current?.unlock();setSoundOn(!soundOn);}}><Icon name={soundOn ? "sound":"sound-off"} size={20}/></button></div></div>
      <section className="nc-table" aria-label="Chess table">
        <div className="nc-rival-card">{playerCard(rival)}</div>
        <div className="nc-board-wrap"><Board fen={match.fen} color={myColor} selectableColor={!spectate && running && match.turn===myColor && !busy ? myColor : null} selected={selected} targets={targets} lastMove={match.lastMove} onSquare={spectate ? undefined : pick}/>
          {countdown>0 && !match.done && <div className="nc-overlay nc-vs"><div><span className="nc-kicker">{mode==="practice" ? "YOUR SPARRING PARTNER" : spectate ? "BOTH PLAYERS ARE HERE" : "YOUR RIVAL IS HERE"}</span><div className="nc-versus"><span><FrogPortrait frog={houseFrog(mine.name) ?? (mine.color==="w" ? "001" : "002")}/><b>{mine.name}</b><small>{mine.color==="w" ? "MOONLIGHT / WHITE":"ULTRAVIOLET / BLACK"}</small></span><em>vs</em><span><FrogPortrait frog={mode==="practice" ? "007" : houseFrog(rival.name) ?? (rival.color==="w" ? "001" : "002")}/><b>{rival.name}</b><small>{rival.color==="w" ? "MOONLIGHT / WHITE":"ULTRAVIOLET / BLACK"}</small></span></div><strong className="nc-countdown" key={countdown}>{countdown}</strong><span className="nc-kicker">{spectate ? "YOU ARE WATCHING" : "THE BOARD IS YOURS"}</span></div></div>}
          {promotion && <div className="nc-overlay" role="dialog" aria-modal="true" aria-labelledby="nc-promote"><div className="nc-dialog"><span className="nc-kicker">EIGHTH RANK</span><h2 id="nc-promote">Choose your <em>piece.</em></h2><div className="nc-promotion">{(["q","r","b","n"] as PieceSymbol[]).map(p=><button type="button" disabled={busy} autoFocus={p==="q"} key={p} onClick={()=>void move(promotion.from,promotion.to,p)}><Icon name={`chess-${PIECES[p]}`} size={32}/><span>{PIECES[p]}</span></button>)}</div><button type="button" className="nc-btn ghost" onClick={()=>setPromotion(null)}>CANCEL</button></div></div>}
          {match.done && <div className={`nc-overlay nc-result ${match.winnerIsYou ? "won" : ""}`} role="region" aria-label="Game result"><div className="nc-dialog"><span className="nc-result-icon"><Icon name={match.winnerIsYou || (spectate && match.winner) ? "trophy" : match.winner ? "chess-king":"scales"} size={30}/></span><span className="nc-kicker">{mode==="practice" ? "PRACTICE COMPLETE" : "FINAL RESULT / SERVER VERIFIED"}</span><h2>{!match.winner ? "DRAW" : spectate ? `${match.players.find(p=>p.color===match.winner)?.name ?? ""} WINS` : match.winnerIsYou ? "VICTORY":"DEFEAT"}</h2><p>{REASONS[match.reason ?? ""] ?? match.reason}</p><div className="nc-result-score"><span>{mine.name}<b>{mine.rating}<small>ELO</small></b></span><i>{match.winner ? mineWon ? "1 : 0":"0 : 1" : "½ : ½"}</i><span>{rival.name}<b>{rival.rating}<small>ELO</small></b></span></div>{match.escrow && <StakeResult matchId={match.escrow} address={address}/>}{mode==="online" && !match.escrow && match.rivalWantsRematch && <p className="nc-rematch-note">Your rival wants another game.</p>}{house ? <div className="nc-result-actions"><button type="button" className="nc-btn" onClick={challenge}><Icon name="swords" size={17}/>CHALLENGE THE WINNER</button><button type="button" className="nc-btn ghost" onClick={watchAnother}><Icon name="radar" size={17}/>WATCH ANOTHER</button></div> : spectate ? <div className="nc-result-actions"><button type="button" className="nc-btn" onClick={watchAnother}><Icon name="radar" size={17}/>WATCH ANOTHER</button><button type="button" className="nc-btn ghost" onClick={lobby}>PLAY NIGHT CHESS</button></div> : <div className="nc-result-actions">{!match.escrow && <button type="button" className="nc-btn" disabled={busy || match.rematchRequested} onClick={()=>mode==="practice" ? void start(true):void action("rematch")}><Icon name={match.rematchRequested ? "radar":"swap"} size={17}/>{match.rematchRequested ? "AWAITING RIVAL":"REMATCH"}</button>}<button type="button" className="nc-btn ghost" onClick={lobby}>BACK TO LOBBY</button></div>}{error}</div></div>}
        </div>
        <div className="nc-mine-card">{playerCard(mine)}</div>
        <div className={`nc-turn ${match.check ? "check" : ""}`} role="status">{spectate ? match.done ? "Game complete" : countdown ? "The game starts soon." : !connected ? "Reconnecting… clocks continue on the server." : match.check ? `${turnName} is in check` : `${turnName} to move` : match.done ? "Game complete" : countdown ? "Take a breath. Your game starts soon." : !connected && mode==="online" ? "Reconnecting… clocks continue on the server." : mode==="online" && !rival.connected ? rivalLost : match.check ? `${match.turn===myColor ? "Your king is":"Your rival is"} in check` : match.turn===myColor ? selected ? "Choose a glowing square" : "Your move. Tap a piece." : mode==="practice" ? "Frog #7 is thinking…" : "Your rival is thinking…"}</div>
      </section>
      <aside className="nc-game-side"><div className="nc-scoresheet"><div className="nc-section-label"><span>THE GAME</span><span>{Math.ceil(match.ply/2)} MOVES</span></div><div className="nc-move-head"><span>NO.</span><span>WHITE</span><span>BLACK</span></div><div className="nc-moves" ref={history} aria-label="Moves in standard algebraic notation">{match.moves.length ? Array.from({length:Math.ceil(match.moves.length/2)},(_,i)=><div key={i}><span>{i+1}.</span><b className={match.ply===i*2+1 ? "last":""}>{match.moves[i*2]?.san}</b><b className={match.ply===i*2+2 ? "last":""}>{match.moves[i*2+1]?.san ?? "—"}</b></div>) : <p className="nc-empty">A quiet board.<br/>A thousand possibilities.</p>}</div></div>
        {house ? <><div className="nc-spectate-banner" role="note"><Icon name="frog" size={18}/><p><b>House exhibition</b>Frog #7 and a frog of the crew, played by the server with the practice bot's rules. Never rated, never staked, no bets.</p></div><button type="button" className="nc-btn" onClick={challenge}><Icon name="swords" size={18}/>CHALLENGE THE WINNER<span className="nc-muted">practice vs Frog #7</span></button></> : spectate ? <><div className="nc-spectate-banner" role="note"><Icon name="radar" size={18}/><p><b>Spectating</b>Read-only. The board follows the players' moves live; nobody here can move a piece.</p></div><BetPanel game="chess" id={match.id} theme="nc"/></> : <><div className="nc-game-actions"><button type="button" className="nc-btn ghost" disabled={busy || match.done || countdown>0} onClick={()=>setConfirm("draw")}><Icon name="scales" size={18}/>{match.drawOffer==="you" ? "DRAW OFFERED":"OFFER DRAW"}</button><button type="button" className="nc-btn ghost" disabled={busy || match.done} onClick={()=>setConfirm("resign")}><Icon name="flag" size={18}/>RESIGN</button></div>
        {match.drawOffer==="rival" && !match.done && <div className="nc-draw-offer" role="status"><p>Your rival offers a draw.</p><button type="button" className="nc-btn small" disabled={busy} onClick={()=>void action("draw","accept")}>ACCEPT</button><button type="button" className="nc-btn ghost small" disabled={busy} onClick={()=>void action("draw","decline")}>DECLINE</button></div>}</>}
        <p className="nc-board-help"><Icon name="orbit" size={16}/>Drag to orbit · pinch or scroll to zoom · double-tap to reset.</p>
        {error}
      </aside>
      {!spectate && <div className="nc-accessible-board"><label htmlFor="nc-square">Play by coordinate</label><select id="nc-square" value="" onChange={e=>pick(e.target.value as Square)} disabled={busy || match.done || countdown>0 || match.turn!==myColor}><option value="">Select a square</option>{Array.from({length:64},(_,i)=>{const s=`${"abcdefgh"[i%8]}${Math.floor(i/8)+1}` as Square;const p=game.get(s);return <option key={s} value={s}>{s}{p ? ` · ${p.color==="w" ? "white":"black"} ${PIECES[p.type]}`:""}{targets.some(t=>t.square===s) ? " · legal target":""}</option>;})}</select><span>{selected ? `Selected ${selected}. Choose a legal target.`:"Choose a piece, then its destination."}</span></div>}
    </main>}

    {spectate && !inGame && <div className="nc-overlay nc-search" role="dialog" aria-modal="true" aria-labelledby="nc-watch-title"><div className="nc-dialog"><div className="nc-radar"><Icon name="radar" size={36}/></div><span className="nc-kicker">SPECTATOR MODE</span><h2 id="nc-watch-title">{err ? <>No game<br/>to <em>watch.</em></> : <>Finding<br/>the <em>table.</em></>}</h2><p>{err ?? "Connecting to the live game…"}</p><button type="button" autoFocus className="nc-btn" onClick={watchAnother}>WATCH ANOTHER</button><button type="button" className="nc-btn ghost" onClick={lobby}>PLAY NIGHT CHESS</button></div></div>}
    {!spectate && match && !match.startedAt && <div className="nc-overlay nc-search" role="dialog" aria-modal="true" aria-labelledby="nc-search-title"><div className="nc-dialog"><div className="nc-radar"><Icon name="radar" size={36}/></div><span className="nc-kicker">{match.escrow ? "STAKED DUEL" : "MATCHMAKING"} / {match.tc}</span><h2 id="nc-search-title">{match.escrow ? <>Waiting for<br/>your <em>rival.</em></> : <>Finding<br/>your <em>rival.</em></>}</h2><p>{match.escrow ? <>Both stakes are in. The clock starts only once you are both at the table, after a 10-second countdown. {rival?.connected ? <b>Your rival is here.</b> : <>Your rival has not opened the table yet: they see a "Take your seat" banner on any page of the site.</>}{startBy!==null && <> If you are not both here in <b className="nc-away">{clockText(startBy)}</b>, the game is void and both stakes go back.</>}</> : "Your game is open in the lounge. The next player on your time control (or anyone who plays anyone) joins it. Browse the site meanwhile: you hear it when someone joins."}</p><div className="nc-search-info"><span>{match.escrow ? `${match.players.filter(p=>p.connected).length} / 02 AT THE TABLE` : "01 / 02 PLAYERS"}</span><span>{match.escrow ? `${match.stake} ${tokenLabel(match.currency)} EACH` : `FREE DUEL · WAITING ${waitText(now-(match.waitingSince ?? now))}`}</span></div><span className="nc-connection" role="status">{connected ? "Live connection open":"Connecting to the table…"}</span>{!match.escrow && <><button type="button" autoFocus className="nc-btn" onClick={()=>go("/games")}><Icon name="radar" size={17}/>BROWSE WHILE YOU WAIT</button><button type="button" className="nc-btn ghost" disabled={busy} onClick={()=>void cancelSearch()}>CANCEL SEARCH</button></>}{error}</div></div>}
    {confirm && match && <div className="nc-overlay nc-confirm" role="dialog" aria-modal="true" aria-labelledby="nc-confirm-title" onKeyDown={e=>{if(e.key==="Escape")setConfirm(null);}}><div className="nc-dialog"><Icon name={confirm==="draw" ? "scales":"flag"} size={30}/><h2 id="nc-confirm-title">{confirm==="draw" ? "Call it a draw?":"Leave the table?"}</h2><p>{confirm==="draw" ? mode==="practice" ? "Frog #7 will agree to a friendly draw.":"Your rival can accept or decline. Keep playing while you wait.":"Resigning gives this game to your rival."}</p><button type="button" className="nc-btn" disabled={busy} onClick={()=>void action(confirm==="draw" ? "draw":"resign",confirm==="draw" ? "offer":undefined)}>{confirm==="draw" ? "OFFER A DRAW":"RESIGN GAME"}</button><button type="button" autoFocus className="nc-btn ghost" onClick={()=>setConfirm(null)}>KEEP PLAYING</button>{error}</div></div>}
    {!inGame && <AppTabs active="games"/>}
  </div>;
}
