import { StrictMode, useEffect, useState } from "react";
import { Link, useRoute } from "./router";
import { createRoot } from "react-dom/client";
import { type Health, api } from "./api";
import { CompanyPage } from "./CompanyPage";
import { Home } from "./Home";
import { PublicPage } from "./PublicPage";
import "./styles.css";

function App() {
  const path = useRoute();
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth(null)); }, []);
  const seg = path.split("/").filter(Boolean);
  let page: React.ReactNode = <Home health={health} />;
  if (seg[0] === "co" && seg[1]) page = <CompanyPage id={seg[1]} health={health} />;
  if (seg[0] === "c" && seg[1]) page = <PublicPage slug={seg[1]} health={health} />;
  return (
    <>
      <header className="top">
        <Link to="/" className="brand"><span className="brand-moon" />NIGHTSHIFT</Link>
        <nav>
          <Link to="/" className={seg.length === 0 ? "on" : ""}>Companies</Link>
        </nav>
        {health && (
          <span className="mode" title={health.mode === "sim" ? "Simulated swarm and buyers. No IMD or USDC moves." : "Live: real IMD orders, real USDC sales."}>
            <span className={`dot ${health.mode === "sim" ? "sim" : ""}`} />
            {health.mode === "sim" ? "SIMULATION" : "LIVE"} · {health.llm ? health.model.split("/").pop() : "playbook CEO"}
          </span>
        )}
      </header>
      <main>{page}</main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
