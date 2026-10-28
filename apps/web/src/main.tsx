import { Component, type ReactNode, StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type Health, api, noteFirstTouch } from "./api";
import { CompanyPage } from "./CompanyPage";
import { Home } from "./Home";
import { type Active } from "./landing/chrome";
import { RoomShell } from "./nx/Shell";
import { roomOf } from "./nx/map";
import "./landing/app.css";
import { Landing } from "./landing/Landing";
import { McpPage } from "./McpPage";
import { PublicPage } from "./PublicPage";
import { useRoute } from "./router";
import { webOnly } from "./store";
import { WebOnlyPage } from "./StoreNote";
import { SessionProvider } from "./session";
import { SetupPage } from "./SetupPage";
import { MarketPage } from "./MarketPage";
import { OwnerDesk } from "./OwnerDesk";
import { TokenPage } from "./TokenPage";
import { FrogsPage } from "./FrogsPage";
import { ForgePage } from "./ForgePage";
import { WatchPage } from "./WatchPage";
import { SwapPage } from "./SwapPage";
import { StakePage } from "./StakePage";
import { ImpactPage } from "./ImpactPage";
import { GuidePage } from "./GuidePage";
import { TermsPage } from "./TermsPage";
import { PrivacyPage } from "./PrivacyPage";
import { SecurityPage } from "./SecurityPage";
import { TokenomicsPage } from "./TokenomicsPage";
import { GameRoomPage } from "./GameRoomPage";
import { PinballPage } from "./PinballPage";
import { WaitingBanner } from "./games/lounge";
import { StakedBanner } from "./games/staked";
import "./styles.css";
import "./lite"; // marks <html data-lite> before the first paint
import "./landing/landing.css";
import "./clarity.css";
import { HowItWorksPage } from "./HowItWorksPage";
import { UtilityLinks } from "./HowThisConnects";

// where this visitor first came from, kept for the company they may start
noteFirstTouch();

const NewHome = lazy(() => import("./station3d/NewHome").then((x) => ({ default: x.NewHome })));
const Welcome = lazy(() => import("./site/Welcome").then((x) => ({ default: x.Welcome })));
const LaunchpadPage = lazy(() => import("./launchpad/LaunchpadPage").then((x) => ({ default: x.LaunchpadPage })));
const ArenaPage = lazy(() => import("./ArenaPage").then((x) => ({ default: x.ArenaPage })));
const ChessPage = lazy(() => import("./ChessPage").then((x) => ({ default: x.ChessPage })));
const PoolPage = lazy(() => import("./pool/PoolPage").then((x) => ({ default: x.PoolPage })));
const PokerPage = lazy(() => import("./poker/PokerPage").then((x) => ({ default: x.PokerPage })));
const LeaguePage = lazy(() => import("./station/LeaguePage").then((x) => ({ default: x.LeaguePage })));
const WhitepaperPage = lazy(() => import("./WhitepaperPage").then((x) => ({ default: x.WhitepaperPage })));
const ChangelogPage = lazy(() => import("./ChangelogPage").then((x) => ({ default: x.ChangelogPage })));
const CommandPage = lazy(() => import("./station/EconomyCommand").then((x) => ({ default: x.CommandPage })));
const LivePage = lazy(() => import("./LivePage").then((x) => ({ default: x.LivePage })));
const NightshiftLivePage = lazy(() => import("./live/LivePage").then((x) => ({ default: x.LivePage })));
const TgMoved = lazy(() => import("./TgMoved").then((x) => ({ default: x.TgMoved })));
const ServicesPage = lazy(() => import("./station/Services").then((x) => ({ default: x.ServicesPage })));
const MindPage = lazy(() => import("./station/Mind").then((x) => ({ default: x.MindPage })));
const LastspawnPage = lazy(() => import("./lastspawn/LastspawnPage").then((x) => ({ default: x.LastspawnPage })));
const VerdictPage = lazy(() => import("./station/Services").then((x) => ({ default: x.VerdictPage })));
const HookPage = lazy(() => import("./station/Services").then((x) => ({ default: x.HookPage })));
const ShipPage = lazy(() => import("./ship/ShipPage").then((x) => ({ default: x.ShipPage })));
const FeedPage = lazy(() => import("./station/Services").then((x) => ({ default: x.FeedPage })));
const SniperPage = lazy(() => import("./station/Sniper").then((x) => ({ default: x.SniperPage })));
const CrewsPage = lazy(() => import("./crews/CrewsPage").then((x) => ({ default: x.CrewsPage })));
const CrewPage = lazy(() => import("./crews/CrewsPage").then((x) => ({ default: x.CrewPage })));
const WatchtowerPage = lazy(() => import("./crews/WatchtowerPage").then((x) => ({ default: x.WatchtowerPage })));
const ConnectAgentPage = lazy(() => import("./crews/ConnectAgentPage").then((x) => ({ default: x.ConnectAgentPage })));
const ProofPage = lazy(() => import("./crews/ProofPage").then((x) => ({ default: x.ProofPage })));

function App() {
  const path = useRoute();
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth(null)); }, []);
  const seg = path.split("/").filter(Boolean);
  const oldDoors: Record<string, string> = { breakroom: "games", geek: "services", info: "token", economy: "proof", hr: "proof" };
  if (seg[0] && oldDoors[seg[0]]) seg[0] = oldDoors[seg[0]]!;
  // The front door is the bridge dashboard; its one button enters the station.
  if (seg.length === 0) return <Suspense fallback={<main style={{ minHeight: "100svh", background: "#0d0f12" }} />}><Welcome /></Suspense>;
  // Existing room URLs open the matching door; the story keeps its art.
  if (seg[0] === "story") return <Landing />;
  // Hidden preview routes own their titles, shell and lazy-loaded scene.
  if (seg[0] === "new") {
    return <Suspense fallback={<main style={{ minHeight: "100svh", padding: "96px 24px", background: "#05030d", color: "#f4f0ff" }}><h1>NIGHTSHIFT</h1><p>Companies, AI tools, games, $SHIFT, Frogs, and public proof.</p><p>Loading the station preview...</p></main>}><NewHome /></Suspense>;
  }
  if (seg[0] === "live") return <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#040611" }} />}><NightshiftLivePage /></Suspense>;
  // Where the Telegram Mini App was: the games are on the website and its app now. Outside Telegram
  // this sends the visitor to the same place on the site; inside a Mini App it says the Game Room moved.
  if (seg[0] === "tg") { document.title = "NIGHTSHIFT Game Room"; return <Suspense fallback={<div style={{ minHeight: "100dvh", background: "#03020a" }} />}><TgMoved /></Suspense>; }
  // Space Pinball is a full-screen arcade with its own bar, like the landing.
  if (seg[0] === "games" && seg[1] === "pinball") return <PinballPage />;
  // NIGHT CHESS brings three.js: its own chunk, loaded only on this page.
  if (seg[0] === "games" && seg[1] === "chess") return <Suspense fallback={<div className="arc-boot" />}><ChessPage /></Suspense>;
  // NIGHT POOL brings its own three.js table and its own bar, like NIGHT CHESS
  if (seg[0] === "games" && seg[1] === "pool") return <Suspense fallback={<div className="arc-boot" />}><PoolPage /></Suspense>;
  // NIGHT POKER: its own page and bar, the cards drawn in code (no three.js)
  // THE SHIP: the whole crew live in one isometric scene, full screen under the station bar (its own chunk)
  if (seg[0] === "ship") return <Suspense fallback={<div className="arc-boot" />}><ShipPage /></Suspense>;
  // NIGHT SNIPER: an app screen of its own (iOS layout: its own bars, its own tabs)
  if (seg[0] === "sniper") return <Suspense fallback={<div className="arc-boot" />}><SniperPage /></Suspense>;
  if (seg[0] === "games" && seg[1] === "poker") return <Suspense fallback={<div className="arc-boot" />}><PokerPage /></Suspense>;
  // LASTSPAWN: the MMORPG, full screen with its own three.js world (its own chunk)
  if (seg[0] === "play") return <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#05070c" }} />}><LastspawnPage /></Suspense>;
  let page: React.ReactNode = <Home health={health} />;
  if (seg[0] === "co" && seg[1]) page = <CompanyPage id={seg[1]} health={health} />;
  if (seg[0] === "c" && seg[1]) page = <PublicPage slug={seg[1]} health={health} />;
  if (seg[0] === "how-it-works") page = <HowItWorksPage />;
  if (seg[0] === "mcp") page = <McpPage health={health} />;
  if (seg[0] === "terms") page = <TermsPage health={health} />;
  if (seg[0] === "privacy") page = <PrivacyPage />;
  if (seg[0] === "security") page = <SecurityPage />;
  if (seg[0] === "setup") page = <SetupPage />;
  if (seg[0] === "market") page = <MarketPage />;
  if (seg[0] === "my") page = <OwnerDesk health={health} />;
  if (seg[0] === "whitepaper") page = <Suspense fallback={<div className="docs" />}><WhitepaperPage /></Suspense>;
  if (seg[0] === "changelog") page = <Suspense fallback={<div className="docs" />}><ChangelogPage /></Suspense>;
  if (seg[0] === "token") page = <TokenPage />;
  if (seg[0] === "frogs") page = <FrogsPage />;
  if (seg[0] === "forge") page = <ForgePage />;
  if (seg[0] === "watch") page = <WatchPage />;
  if (seg[0] === "swap") page = <SwapPage />;
  if (seg[0] === "stake" || seg[0] === "staking") page = <StakePage />;
  if (seg[0] === "impact") page = <ImpactPage />;
  if (seg[0] === "guide") page = <GuidePage />;
  if (seg[0] === "tokenomics") page = <TokenomicsPage />;
  if (seg[0] === "games") page = seg[1] === "live" ? <Suspense fallback={null}><LivePage /></Suspense> : <GameRoomPage />;
  if (seg[0] === "launchpad") page = <Suspense fallback={<div className="st-room" />}><LaunchpadPage seg={seg} /></Suspense>;
  if (seg[0] === "command") page = <Suspense fallback={<div className="st-room" />}><CommandPage /></Suspense>;
  if (seg[0] === "league") page = <Suspense fallback={<div className="st-room" />}><LeaguePage id={seg[1]} /></Suspense>;
  if (seg[0] === "mind") page = <Suspense fallback={<div className="st-room" />}><MindPage /></Suspense>;
  if (seg[0] === "services") page = <Suspense fallback={<div className="st-room" />}>{seg[1] === "verdict" ? <VerdictPage /> : seg[1] === "hook" ? <HookPage /> : seg[1] === "imd-feed" ? <FeedPage /> : <ServicesPage />}</Suspense>;
  // NIGHTSHIFT Crews: the crews, one crew, Watchtower, connecting an agent, and the proof page
  if (seg[0] === "crews") page = <Suspense fallback={<div className="st-room" />}>{seg[1] ? <CrewPage id={seg[1]} health={health} /> : <CrewsPage health={health} />}</Suspense>;
  if (seg[0] === "watchtower") page = <Suspense fallback={<div className="st-room" />}><WatchtowerPage health={health} /></Suspense>;
  if (seg[0] === "agents" && (!seg[1] || seg[1] === "start")) page = <Suspense fallback={<div className="st-room" />}><ConnectAgentPage /></Suspense>;
  if (seg[0] === "proof") page = <Suspense fallback={<div className="st-room" />}><ProofPage health={health} /></Suspense>;
  if (seg[0] === "arena") page = <Suspense fallback={<div className="docs"><p className="dim">Loading the arena…</p></div>}><ArenaPage /></Suspense>;
  // the Play Store app leaves what moves money to the website
  if (webOnly(path)) page = <WebOnlyPage path={path} />;
  const named: Active[] = ["mcp", "terms", "market", "token", "frogs", "swap", "stake", "guide", "tokenomics", "games", "impact", "launchpad", "arena", "breakroom", "geek", "info", "economy", "command", "league", "forge", "watch"];
  const key = seg[0] === "staking" ? "stake" : seg[0] === "hr" ? "economy" : seg[0];
  const active: Active = seg[0] === "co" ? "company" : named.includes(key as Active) ? (key as Active) : "companies";
  // Each page names itself in the tab; pages that know more (a company, a product) set their own.
  document.title = `${seg[0] === "games" && seg[1] === "live" ? "Watch games" : TITLES[key ?? ""] ?? "Companies"} · NIGHTSHIFT`;
  void active;
  return <RoomShell room={roomOf(path) ?? "geek"} path={path} lean={seg[0] === "games"}>{page}</RoomShell>;
}

const TITLES: Record<string, string> = {
  companies: "Companies", launch: "Start a business", co: "Your company", my: "Owner desk", whitepaper: "Whitepaper", changelog: "Changelog", c: "Shop", mcp: "MCP", terms: "Terms & risks", setup: "Setup",
  market: "Market", token: "$SHIFT", frogs: "Frogs", swap: "Swap", stake: "Staking", impact: "IMD impact", guide: "Guide",
  tokenomics: "Tokenomics", games: "Play", launchpad: "Launch a token", arena: "Agent Arena",
  "how-it-works": "How it works", services: "AI tools", crews: "Crews", watchtower: "Token monitor", agents: "Connect an agent", proof: "Proof", breakroom: "Play", geek: "AI tools", info: "$SHIFT", economy: "Activity & receipts", command: "Frog missions", league: "The Night League", forge: "Upgrade Frogs", watch: "Run a keeper", ship: "The Ship",
};

// The app shell for phones and the installed app; the game keeps its own worker under /games/pinball.
if ("serviceWorker" in navigator && location.protocol === "https:") void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});

/** One page failing (an old browser, a blocked script, no WebGL) shows a way out instead of a blank screen. */
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("page crashed", error); if (location.pathname === "/live") setTimeout(() => location.reload(), 30_000); }
  render() {
    if (!this.state.error) return this.props.children;
    if (location.pathname === "/live") {
      let saved: { stats?: { agentsOnline?: number; jobsToday?: number; launchesToday?: number; priceUsd?: number } } = {};
      try { saved = JSON.parse(localStorage.getItem("nightshift-live-state") ?? "{}"); } catch { /* keep the station visible */ }
      const value = (n: unknown) => typeof n === "number" && Number.isFinite(n) ? n : "—";
      return <div style={{ position: "fixed", inset: 0, overflow: "hidden", color: "#edf1fb", background: "#040611 url('/art/station/gate-station-2400x1350.webp') center/cover", padding: "5vw", fontFamily: "Space Grotesk, sans-serif" }}><img src="/brand/nightshift-wordmark-mono.svg" alt="NIGHTSHIFT LIVE" style={{ width: "20vw" }} /><p style={{ color: "#c1fa79" }}>LIVE · LAST RECEIVED STATE · RECONNECTING</p><h1>The night never stops.</h1><p>IMD agents: {value(saved?.stats?.agentsOnline)} · Jobs observed today: {value(saved?.stats?.jobsToday)} · Launches today: {value(saved?.stats?.launchesToday)} · SHIFT: {value(saved?.stats?.priceUsd)}</p><p style={{ position: "absolute", bottom: "4vw" }}>Join t.me/getnightshift · /ask · /watchtower · /buildcheck</p></div>;
    }
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

/** The banners that follow you across the site (a waiting table, a staked game): never on /tg, where the Mini App was. */
function Banners() {
  const path = useRoute();
  return path === "/" || path === "/new" || path.startsWith("/new/") || path === "/live" || path.startsWith("/live/") || path === "/tg" || path.startsWith("/tg/") ? null : <><WaitingBanner /><StakedBanner /></>;
}

/** Full-screen pages keep a small way to connect and get help. */
function FullscreenUtilities() {
  const path = useRoute();
  if (!/^(\/games\/(pinball|chess|pool|poker)|\/live(?:\/|$)|\/story$|\/ship$|\/sniper$|\/play$|\/tg(?:\/|$))/.test(path)) return null;
  return <aside className="clarity-floating" aria-label="Site links"><UtilityLinks /><details><summary>More</summary><nav className="clarity-start"><a href="/services">AI tools</a><a href="/games">Play</a><a href="/token">$SHIFT</a></nav><nav className="clarity-start"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/whitepaper">Whitepaper</a></nav></details></aside>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Crash><SessionProvider><App /><Banners /><FullscreenUtilities /></SessionProvider></Crash></StrictMode>);
