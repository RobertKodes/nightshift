import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type Health, api } from "./api";
import { CompanyPage } from "./CompanyPage";
import { Home } from "./Home";
import { SiteFooter, SiteHeader } from "./landing/chrome";
import { Landing } from "./landing/Landing";
import { McpPage } from "./McpPage";
import { PublicPage } from "./PublicPage";
import { useRoute } from "./router";
import { SessionProvider } from "./session";
import { SetupPage } from "./SetupPage";
import { TermsPage } from "./TermsPage";
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
  const active = seg[0] === "co" ? "company" : seg[0] === "mcp" ? "mcp" : seg[0] === "terms" ? "terms" : "companies";
  return (
    <div className="ns ns-app">
      <SiteHeader active={active} />
      <main>{page}</main>
      <SiteFooter />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><SessionProvider><App /></SessionProvider></StrictMode>);
