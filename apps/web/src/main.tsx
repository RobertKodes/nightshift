import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type Health, api, short } from "./api";
import { CompanyPage } from "./CompanyPage";
import { Home } from "./Home";
import { Landing } from "./landing/Landing";
import { McpPage } from "./McpPage";
import { PublicPage } from "./PublicPage";
import { Link, useRoute } from "./router";
import { SessionProvider, useSession } from "./session";
import { TermsPage } from "./TermsPage";
import "./styles.css";

function Account() {
  const { address, signIn, signOut, busy, error } = useSession();
  if (address) {
    return (
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className="mono dim" style={{ fontSize: 12 }}>{short(address)}</span>
        <button className="btn ghost" style={{ height: 32 }} onClick={signOut}>Sign out</button>
      </span>
    );
  }
  return (
    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {error && <span className="bad" style={{ fontSize: 12, maxWidth: 220 }}>{error}</span>}
      <button className="btn" style={{ height: 32 }} disabled={busy} onClick={signIn}>{busy ? "Check your wallet…" : "Sign in with wallet"}</button>
    </span>
  );
}

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
  return (
    <>
      <header className="top">
        <Link to="/" className="brand"><span className="brand-moon" />NIGHTSHIFT</Link>
        <nav>
          <Link to="/companies" className={seg[0] === "companies" || seg[0] === "launch" ? "on" : ""}>Companies</Link>
          <Link to="/mcp" className={seg[0] === "mcp" ? "on" : ""}>MCP</Link>
          <Link to="/terms" className={seg[0] === "terms" ? "on" : ""}>Terms & risks</Link>
        </nav>
        {health && (
          <span className="mode" title={health.mode === "sim" ? "Simulated swarm and buyers. No IMD or USDC moves." : "Live: real IMD orders, real USDC sales."}>
            <span className={`dot ${health.mode === "sim" ? "sim" : ""}`} />
            {health.mode === "sim" ? "SIMULATION" : "LIVE"} · {health.llm ? health.model.split("/").pop() : "playbook CEO"}
          </span>
        )}
        <Account />
      </header>
      <main>{page}</main>
      <footer className="foot">
        <span>NIGHTSHIFT · autonomous companies on the <a href="https://imd.fun" target="_blank" rel="noreferrer">IMD</a> swarm</span>
        <span><Link to="/mcp">MCP</Link> · <Link to="/terms">Terms & risks</Link> · <a href="https://github.com/RobertKodes/nightshift" target="_blank" rel="noreferrer">GitHub</a></span>
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><SessionProvider><App /></SessionProvider></StrictMode>);
