import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type Health, api } from "./api";
import { CompanyPage } from "./CompanyPage";
import { Home } from "./Home";
import { type Active, NightFrog, SiteFooter, SiteHeader } from "./landing/chrome";
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
import { TokenomicsPage } from "./TokenomicsPage";
import { GameRoomPage } from "./GameRoomPage";
import { LaunchpadPage } from "./LaunchpadPage";
import "./styles.css";
import "./landing/landing.css";

function App() {
  const path = useRoute();
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth(null)); }, []);
  const seg = path.split("/").filter(Boolean);
  // The landing is a full-bleed experience with its own header; every other route uses the app shell.
  if (seg.length === 0) return <Landing />;
  let page: React.ReactNode = <Home health={health} />;
  if (seg[0] === "co" && seg[1]) page = <CompanyPage id={seg[1]} health={health} />;
  if (seg[0] === "c" && seg[1]) page = <PublicPage slug={seg[1]} health={health} />;
  if (seg[0] === "mcp") page = <McpPage health={health} />;
  if (seg[0] === "terms") page = <TermsPage health={health} />;
  if (seg[0] === "setup") page = <SetupPage />;
  if (seg[0] === "market") page = <MarketPage />;
  if (seg[0] === "token") page = <TokenPage />;
  if (seg[0] === "frogs") page = <FrogsPage />;
  if (seg[0] === "swap") page = <SwapPage />;
  if (seg[0] === "stake") page = <StakePage />;
  if (seg[0] === "impact") page = <ImpactPage />;
  if (seg[0] === "guide") page = <GuidePage />;
  if (seg[0] === "tokenomics") page = <TokenomicsPage />;
  if (seg[0] === "games") page = <GameRoomPage />;
  if (seg[0] === "launchpad") page = <LaunchpadPage />;
  const named: Active[] = ["mcp", "terms", "market", "token", "frogs", "swap", "stake", "guide", "tokenomics", "games", "impact", "launchpad"];
  const active: Active = seg[0] === "co" ? "company" : named.includes(seg[0] as Active) ? (seg[0] as Active) : "companies";
  return (
    <div className="ns ns-app">
      <SiteHeader active={active} />
      <main>{page}</main>
      <SiteFooter />
      <NightFrog />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><SessionProvider><App /></SessionProvider></StrictMode>);
