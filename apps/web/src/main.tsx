// the shared stylesheets, in their fixed order, before any module brings its own
import "./styles-order";
import { Component, type ComponentType, type ReactNode, StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type Health, api, noteFirstTouch } from "./api";
import { PageShell } from "./nx/Shell";
import { TerminalHome } from "./terminal/TerminalHome";
import { useRoute } from "./router";
import { webOnly } from "./store";
import { SessionProvider } from "./session";
import "./lite"; // marks <html data-lite> before the first paint

// where this visitor first came from, kept for the company they may start
noteFirstTouch();

/**
 * Every page but the front door is its own chunk: the front page (IMD TERMINAL) loads its token rows and nothing else.
 * `page` turns a module's named export into a lazy component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const page = <M, K extends keyof M>(load: () => Promise<M>, name: K) => lazy(() => load().then((m) => ({ default: m[name] as ComponentType<any> })));

const Home = page(() => import("./Home"), "Home");
// the company live feed: the front page before IMD TERMINAL, now at /feed
const FeedHome = page(() => import("./saas/Home"), "SxHome");
const DiscoverPage = page(() => import("./terminal/Discover"), "DiscoverPage");
const CompanyPage = page(() => import("./CompanyPage"), "CompanyPage");
const PublicPage = page(() => import("./PublicPage"), "PublicPage");
const MarketPage = page(() => import("./MarketPage"), "MarketPage");
const OwnerDesk = page(() => import("./OwnerDesk"), "OwnerDesk");
const SetupPage = page(() => import("./SetupPage"), "SetupPage");
const McpPage = page(() => import("./McpPage"), "McpPage");
const TokenPage = page(() => import("./TokenPage"), "TokenPage");
const FrogsPage = page(() => import("./FrogsPage"), "FrogsPage");
const ForgePage = page(() => import("./ForgePage"), "ForgePage");
const WatchPage = page(() => import("./WatchPage"), "WatchPage");
const SwapPage = page(() => import("./SwapPage"), "SwapPage");
const StakePage = page(() => import("./StakePage"), "StakePage");
const ImpactPage = page(() => import("./ImpactPage"), "ImpactPage");
const GuidePage = page(() => import("./GuidePage"), "GuidePage");
const TermsPage = page(() => import("./TermsPage"), "TermsPage");
const PrivacyPage = page(() => import("./PrivacyPage"), "PrivacyPage");
const DeleteAccountPage = page(() => import("./DeleteAccountPage"), "DeleteAccountPage");
const SecurityPage = page(() => import("./SecurityPage"), "SecurityPage");
const TokenomicsPage = page(() => import("./TokenomicsPage"), "TokenomicsPage");
const HowItWorksPage = page(() => import("./HowItWorksPage"), "HowItWorksPage");
const WebOnlyPage = page(() => import("./StoreNote"), "WebOnlyPage");
const StartPage = page(() => import("./StartPage"), "StartPage");
const ObservatoryPage = page(() => import("./saas/Observatory"), "ObservatoryPage");
const SxIndex = page(() => import("./saas/SectionPage"), "SxIndex");
const WhitepaperPage = page(() => import("./WhitepaperPage"), "WhitepaperPage");
const ChangelogPage = page(() => import("./ChangelogPage"), "ChangelogPage");
const LeaderboardPage = page(() => import("./LeaderboardPage"), "LeaderboardPage");
// the games
const GameRoomPage = page(() => import("./GameRoomPage"), "GameRoomPage");
const PinballPage = page(() => import("./PinballPage"), "PinballPage");
const ChessPage = page(() => import("./ChessPage"), "ChessPage");
const PoolPage = page(() => import("./pool/PoolPage"), "PoolPage");
const PokerPage = page(() => import("./poker/PokerPage"), "PokerPage");
const LivePage = page(() => import("./LivePage"), "LivePage");
const WaitingBanner = page(() => import("./games/lounge"), "WaitingBanner");
const StakedBanner = page(() => import("./games/staked"), "StakedBanner");
// the AI and agent pages: off the menu, shown and linked from the Observatory
const ServicesPage = page(() => import("./station/Services"), "ServicesPage");
const VerdictPage = page(() => import("./station/Services"), "VerdictPage");
const HookPage = page(() => import("./station/Services"), "HookPage");
const FeedPage = page(() => import("./station/Services"), "FeedPage");
const MindPage = page(() => import("./station/Mind"), "MindPage");
const SniperPage = page(() => import("./station/Sniper"), "SniperPage");
const LeaguePage = page(() => import("./station/LeaguePage"), "LeaguePage");
const ArenaPage = page(() => import("./ArenaPage"), "ArenaPage");
const CrewsPage = page(() => import("./crews/CrewsPage"), "CrewsPage");
const CrewPage = page(() => import("./crews/CrewsPage"), "CrewPage");
const WatchtowerPage = page(() => import("./crews/WatchtowerPage"), "WatchtowerPage");
const ConnectAgentPage = page(() => import("./crews/ConnectAgentPage"), "ConnectAgentPage");
const ProofPage = page(() => import("./crews/ProofPage"), "ProofPage");
// parked: out of the menus and off the front page, still open by address
const ShipDeckPage = page(() => import("./ship3d/ShipDeckPage"), "ShipDeckPage");
const LaunchpadPage = page(() => import("./launchpad/LaunchpadPage"), "LaunchpadPage");
const CommandPage = page(() => import("./station/EconomyCommand"), "CommandPage");
const NightshiftLivePage = page(() => import("./live/LivePage"), "LivePage");
const LastspawnPage = page(() => import("./lastspawn/LastspawnPage"), "LastspawnPage");
const PartnersPage = page(() => import("./site/PartnersPage"), "PartnersPage");
const DealsPage = page(() => import("./site/DealsPage"), "DealsPage");

/** Retired addresses land on the page that replaced them. */
function Redirect({ to }: { to: string }) {
  // a full replace: a child effect runs before the router starts listening, so a popstate here would be missed
  useEffect(() => { location.replace(to); }, [to]);
  return null;
}

/** What shows while a page's own chunk arrives: the page's height, so the footer does not jump up. */
const Wait = ({ className = "st-room" }: { className?: string }) => <div className={className} style={{ minHeight: "70vh" }} />;
const Screen = ({ bg }: { bg: string }) => <div style={{ position: "fixed", inset: 0, background: bg }} />;

function App() {
  const path = useRoute();
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth(null)); }, []);
  const seg = path.split("/").filter(Boolean);
  const oldDoors: Record<string, string> = { breakroom: "games", geek: "services", info: "token", economy: "proof", hr: "proof" };
  if (seg[0] && oldDoors[seg[0]]) seg[0] = oldDoors[seg[0]]!;
  // The front door: IMD TERMINAL (discover, launch, trade). The company feed that was here is at /feed.
  if (seg.length === 0) return <TerminalHome />;
  if (seg[0] === "feed") return <Suspense fallback={<Screen bg="#050706" />}><FeedHome /></Suspense>;
  // The old story landing and the page where the Telegram Mini App was: both are the front page now.
  if (seg[0] === "story" || seg[0] === "tg") return <Redirect to="/" />;
  // The index: every page in the menus, on one page. The old section hubs open the page that replaced them.
  if (seg[0] === "new" && seg[1]) return <Redirect to={NEW_ROUTES[seg[1]] ?? "/new"} />;
  // Full-screen pages with their own bars.
  if (seg[0] === "live") return <Suspense fallback={<Screen bg="#040611" />}><NightshiftLivePage /></Suspense>;
  if (seg[0] === "games" && seg[1] === "pinball") return <Suspense fallback={<div className="arc-boot" />}><PinballPage /></Suspense>;
  // NIGHT CHESS and NIGHT POOL bring three.js: their own chunks, loaded only on their pages.
  if (seg[0] === "games" && seg[1] === "chess") return <Suspense fallback={<div className="arc-boot" />}><ChessPage /></Suspense>;
  if (seg[0] === "games" && seg[1] === "pool") return <Suspense fallback={<div className="arc-boot" />}><PoolPage /></Suspense>;
  if (seg[0] === "games" && seg[1] === "poker") return <Suspense fallback={<div className="arc-boot" />}><PokerPage /></Suspense>;
  // NIGHT SNIPER: an app screen of its own (iOS layout: its own bars, its own tabs)
  if (seg[0] === "sniper") return <Suspense fallback={<div className="arc-boot" />}><SniperPage /></Suspense>;
  // LASTSPAWN: the MMORPG, full screen with its own three.js world (its own chunk)
  if (seg[0] === "play") return <Suspense fallback={<Screen bg="#05070c" />}><LastspawnPage /></Suspense>;

  let body: ReactNode = <Home health={health} />;
  let wait = "st-room";
  const docs = (node: ReactNode) => { wait = "docs"; return node; };
  if (seg[0] === "co" && seg[1]) body = <CompanyPage id={seg[1]} health={health} />;
  if (seg[0] === "c" && seg[1]) body = <PublicPage slug={seg[1]} health={health} />;
  if (seg[0] === "observatory") body = <ObservatoryPage />;
  if (seg[0] === "discover") body = <DiscoverPage />;
  if (seg[0] === "start") body = <StartPage />;
  if (seg[0] === "new") body = <SxIndex />;
  if (seg[0] === "how-it-works") body = <HowItWorksPage />;
  if (seg[0] === "mcp") body = <McpPage health={health} />;
  if (seg[0] === "terms") body = <TermsPage health={health} />;
  if (seg[0] === "privacy") body = <PrivacyPage />;
  if (seg[0] === "delete-account") body = <DeleteAccountPage />;
  if (seg[0] === "security") body = <SecurityPage />;
  if (seg[0] === "setup") body = <SetupPage />;
  if (seg[0] === "market") body = <MarketPage />;
  if (seg[0] === "my") body = <OwnerDesk health={health} />;
  if (seg[0] === "whitepaper") body = docs(<WhitepaperPage />);
  if (seg[0] === "changelog") body = docs(<ChangelogPage />);
  if (seg[0] === "token") body = <TokenPage />;
  if (seg[0] === "frogs") body = <FrogsPage />;
  if (seg[0] === "forge") body = <ForgePage />;
  if (seg[0] === "watch") body = <WatchPage />;
  if (seg[0] === "swap") body = <SwapPage />;
  if (seg[0] === "stake" || seg[0] === "staking") body = <StakePage />;
  if (seg[0] === "impact") body = <ImpactPage />;
  if (seg[0] === "leaderboard") body = <LeaderboardPage />;
  if (seg[0] === "guide") body = <GuidePage />;
  if (seg[0] === "tokenomics") body = <TokenomicsPage />;
  if (seg[0] === "games") body = seg[1] === "live" ? <LivePage /> : <GameRoomPage />;
  if (seg[0] === "launchpad") body = <LaunchpadPage seg={seg} />;
  if (seg[0] === "command") body = <CommandPage />;
  if (seg[0] === "league") body = <LeaguePage id={seg[1]} />;
  if (seg[0] === "mind") body = <MindPage />;
  if (seg[0] === "services") body = seg[1] === "verdict" ? <VerdictPage /> : seg[1] === "hook" ? <HookPage /> : seg[1] === "imd-feed" ? <FeedPage /> : <ServicesPage />;
  // NIGHTSHIFT Crews: the crews, one crew, Watchtower, connecting an agent, and the proof page
  if (seg[0] === "crews") body = seg[1] ? <CrewPage id={seg[1]} health={health} /> : <CrewsPage health={health} />;
  if (seg[0] === "watchtower") body = <WatchtowerPage health={health} />;
  if (seg[0] === "agents" && (!seg[1] || seg[1] === "start")) body = <ConnectAgentPage />;
  if (seg[0] === "partners") body = <PartnersPage />;
  if (seg[0] === "deals") body = <DealsPage />;
  if (seg[0] === "proof") body = <ProofPage health={health} />;
  if (seg[0] === "arena") body = docs(<ArenaPage />);
  // THE SHIP: the crew at work on the 3D operations deck
  if (seg[0] === "ship") body = <div className="pv pv-inroom"><ShipDeckPage /></div>;
  // the Play Store app leaves what moves money to the website
  if (webOnly(path)) body = <WebOnlyPage path={path} />;
  const key = seg[0] === "staking" ? "stake" : seg[0];
  // Each page names itself in the tab; pages that know more (a company, a product) set their own.
  document.title = `${seg[0] === "games" && seg[1] === "live" ? "Watch games" : TITLES[key ?? ""] ?? "Companies"} · NIGHTSHIFT`;
  return <PageShell path={path} lean={seg[0] === "games"} title={seg[0] === "start" ? "Start here" : undefined}><Suspense fallback={<Wait className={wait} />}>{body}</Suspense></PageShell>;
}

/** The old /new/:section hubs, and where each one's pages live now. */
const NEW_ROUTES: Record<string, string> = { companies: "/companies", tools: "/observatory", play: "/games", shift: "/token", frogs: "/frogs", proof: "/proof", ship: "/ship" };

const TITLES: Record<string, string> = {
  companies: "Companies", launch: "Found a company", co: "Your company", my: "Owner desk", whitepaper: "Whitepaper", changelog: "Changelog", c: "Shop", mcp: "MCP", terms: "Terms & risks", setup: "Setup",
  market: "Market", token: "$SHIFT", frogs: "Frogs", swap: "Swap", stake: "Staking", impact: "IMD impact", guide: "Guide", observatory: "Observatory", start: "Start here", new: "Every page",
  tokenomics: "Tokenomics", leaderboard: "Leaderboard", games: "Games", launchpad: "Launch a token", arena: "Agent Arena", privacy: "Privacy", security: "Safety", "delete-account": "Delete account",
  "how-it-works": "How it works", discover: "Discover", deals: "Token Deals", partners: "Partners", services: "AI tools", crews: "Crews", watchtower: "Token monitor", agents: "Connect an agent", proof: "Proof", mind: "SWARM MIND", command: "Frog missions", league: "The Night League", forge: "Upgrade Frogs", watch: "Run a keeper", ship: "The Ship",
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

/** The banners that follow you across the site (a waiting table, a staked game): never on the front page or the live screen. */
function Banners() {
  const path = useRoute();
  const off = path === "/" || path === "/feed" || path === "/new" || path.startsWith("/new/") || path === "/live" || path.startsWith("/live/") || path === "/observatory";
  return off ? null : <Suspense fallback={null}><WaitingBanner /><StakedBanner /></Suspense>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Crash><SessionProvider><App /><Banners /></SessionProvider></Crash></StrictMode>);
