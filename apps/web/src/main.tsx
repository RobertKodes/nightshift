import { Component, type ReactNode, StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type Health, api } from "./api";
import { CompanyPage } from "./CompanyPage";
import { Home } from "./Home";
import { type Active } from "./landing/chrome";
import { Gate } from "./nx/Gate";
import { RoomShell } from "./nx/Shell";
import { roomOf } from "./nx/map";
import "./landing/app.css";
import { Landing } from "./landing/Landing";
import { McpPage } from "./McpPage";
import { PublicPage } from "./PublicPage";
import { useRoute } from "./router";
import { SessionProvider } from "./session";
import { SetupPage } from "./SetupPage";
import { MarketPage } from "./MarketPage";
import { TokenPage } from "./TokenPage";
import { FrogsPage } from "./FrogsPage";
import { SwapPage } from "./SwapPage";
import { StakePage } from "./StakePage";
import { ImpactPage } from "./ImpactPage";
import { GuidePage } from "./GuidePage";
import { TermsPage } from "./TermsPage";
import { SecurityPage } from "./SecurityPage";
import { TokenomicsPage } from "./TokenomicsPage";
import { GameRoomPage } from "./GameRoomPage";
import { PinballPage } from "./PinballPage";
import { LaunchpadPage } from "./LaunchpadPage";
import { WaitingBanner } from "./games/lounge";
import "./styles.css";
import "./lite"; // marks <html data-lite> before the first paint
import "./landing/landing.css";

const ArenaPage = lazy(() => import("./ArenaPage").then((x) => ({ default: x.ArenaPage })));
const ChessPage = lazy(() => import("./ChessPage").then((x) => ({ default: x.ChessPage })));
const LeaguePage = lazy(() => import("./station/LeaguePage").then((x) => ({ default: x.LeaguePage })));
const BreakroomPage = lazy(() => import("./station/Rooms").then((x) => ({ default: x.BreakroomPage })));
const GeekPage = lazy(() => import("./station/Rooms").then((x) => ({ default: x.GeekPage })));
const InfoPage = lazy(() => import("./station/Rooms").then((x) => ({ default: x.InfoPage })));
const EconomyPage = lazy(() => import("./station/EconomyCommand").then((x) => ({ default: x.EconomyPage })));
const CommandPage = lazy(() => import("./station/EconomyCommand").then((x) => ({ default: x.CommandPage })));
const LivePage = lazy(() => import("./LivePage").then((x) => ({ default: x.LivePage })));

function App() {
  const path = useRoute();
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth(null)); }, []);
  const seg = path.split("/").filter(Boolean);
  // The gate: choose your way. The cinematic landing is now the story; every other page lives in a room.
  if (seg.length === 0) return <Gate />;
  if (seg[0] === "story") return <Landing />;
  // Space Pinball is a full-screen arcade with its own bar, like the landing.
  if (seg[0] === "games" && seg[1] === "pinball") return <PinballPage />;
  // NIGHT CHESS brings three.js: its own chunk, loaded only on this page.
  if (seg[0] === "games" && seg[1] === "chess") return <Suspense fallback={<div className="arc-boot" />}><ChessPage /></Suspense>;
  let page: React.ReactNode = <Home health={health} />;
  if (seg[0] === "co" && seg[1]) page = <CompanyPage id={seg[1]} health={health} />;
  if (seg[0] === "c" && seg[1]) page = <PublicPage slug={seg[1]} health={health} />;
  if (seg[0] === "mcp") page = <McpPage health={health} />;
  if (seg[0] === "terms") page = <TermsPage health={health} />;
  if (seg[0] === "security") page = <SecurityPage />;
  if (seg[0] === "setup") page = <SetupPage />;
  if (seg[0] === "market") page = <MarketPage />;
  if (seg[0] === "token") page = <TokenPage />;
  if (seg[0] === "frogs") page = <FrogsPage />;
  if (seg[0] === "swap") page = <SwapPage />;
  if (seg[0] === "stake" || seg[0] === "staking") page = <StakePage />;
  if (seg[0] === "impact") page = <ImpactPage />;
  if (seg[0] === "guide") page = <GuidePage />;
  if (seg[0] === "tokenomics") page = <TokenomicsPage />;
  if (seg[0] === "games") page = seg[1] === "live" ? <Suspense fallback={null}><LivePage /></Suspense> : <GameRoomPage />;
  if (seg[0] === "launchpad") page = <LaunchpadPage />;
  if (seg[0] === "breakroom") page = <Suspense fallback={<div className="st-room" />}><BreakroomPage /></Suspense>;
  if (seg[0] === "geek") page = <Suspense fallback={<div className="st-room" />}><GeekPage /></Suspense>;
  if (seg[0] === "info") page = <Suspense fallback={<div className="st-room" />}><InfoPage /></Suspense>;
  if (seg[0] === "economy" || seg[0] === "hr") page = <Suspense fallback={<div className="st-room" />}><EconomyPage /></Suspense>;
  if (seg[0] === "command") page = <Suspense fallback={<div className="st-room" />}><CommandPage /></Suspense>;
  if (seg[0] === "league") page = <Suspense fallback={<div className="st-room" />}><LeaguePage id={seg[1]} /></Suspense>;
  if (seg[0] === "arena") page = <Suspense fallback={<div className="docs"><p className="dim">Loading the arena…</p></div>}><ArenaPage /></Suspense>;
  const named: Active[] = ["mcp", "terms", "market", "token", "frogs", "swap", "stake", "guide", "tokenomics", "games", "impact", "launchpad", "arena", "breakroom", "geek", "info", "economy", "command", "league"];
  const key = seg[0] === "staking" ? "stake" : seg[0] === "hr" ? "economy" : seg[0];
  const active: Active = seg[0] === "co" ? "company" : named.includes(key as Active) ? (key as Active) : "companies";
  // Each page names itself in the tab; pages that know more (a company, a product) set their own.
  document.title = `${seg[0] === "games" && seg[1] === "live" ? "Watch live" : TITLES[key ?? ""] ?? "Companies"} · NIGHTSHIFT`;
  void active;
  return <RoomShell room={roomOf(path) ?? "geek"} path={path}>{page}</RoomShell>;
}

const TITLES: Record<string, string> = {
  companies: "Companies", launch: "Launch a company", co: "Your company", c: "Shop", mcp: "MCP", terms: "Terms & risks", setup: "Setup",
  market: "Market", token: "$SHIFT", frogs: "NIGHT FROGS", swap: "Swap", stake: "Staking", impact: "IMD impact", guide: "Guide",
  tokenomics: "Tokenomics", games: "Game Room", launchpad: "Launchpad", arena: "Agent Arena",
  breakroom: "Breakroom", geek: "Geek Room", info: "Info Room", economy: "HR & Economy", command: "Command Room", league: "The Night League",
};

// The app shell for phones and the installed app; the game keeps its own worker under /games/pinball.
if ("serviceWorker" in navigator && location.protocol === "https:") void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});

/** One page failing (an old browser, a blocked script, no WebGL) shows a way out instead of a blank screen. */
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("page crashed", error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="docs" style={{ maxWidth: 560, margin: "16vh auto", textAlign: "center" }}>
        <h1>Something went wrong on this page.</h1>
        <p className="lead">Reload to try again. If it keeps happening, update your browser or open the site in a current Chrome, Safari, Firefox, Edge or Brave.</p>
        <p><button className="btn primary" onClick={() => location.reload()}>Reload</button> <a className="btn" href="/">Home</a></p>
        <p className="dim" style={{ fontSize: 12 }}>{String(this.state.error.message).slice(0, 160)}</p>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(<StrictMode><Crash><SessionProvider><App /><WaitingBanner /></SessionProvider></Crash></StrictMode>);
