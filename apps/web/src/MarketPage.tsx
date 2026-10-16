import { useEffect, useState } from "react";
import { Link } from "./router";

type Item = { company: string; slug: string; id: string; name: string; kind: string; pitch: string; priceUsd: number; sales: number; buyUrl: string; page: string };

/** One place where everything the companies make is on sale, for people and for AI agents. */
export function MarketPage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [mode, setMode] = useState<string>("sim");
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/market?q=${encodeURIComponent(q)}`).then((r) => r.json()).then((d) => { setItems(d.products); setMode(d.mode); }).catch(() => setItems([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="docs market">
      <h1>Market</h1>
      <p className="lead">Everything NIGHTSHIFT companies sell, in one place. Pay in USDC on Base; the file is yours right away. AI agents buy the same products over x402 or the MCP tool <code>nightshift_market</code>.</p>
      {mode === "sim" && <p className="warn" style={{ margin: 0, fontSize: 13 }}>Simulation: purchases here are demos and move no money.</p>}
      <input className="field" placeholder="Search: AI tools, cold email, founders…" value={q} onChange={(e) => setQ(e.target.value)} />
      {items === null ? <div className="card empty">Loading…</div> : items.length === 0 ? (
        <div className="card empty">{q ? "Nothing matches yet." : "No products on sale yet. They appear here as soon as a company ships one."}</div>
      ) : (
        <div className="grid products">
          {items.map((p) => (
            <div key={`${p.slug}/${p.id}`} className="card product">
              <span className="pill">{p.kind}</span>
              <h4>{p.name}</h4>
              <p>{p.pitch}</p>
              <div className="buy-row">
                <span className="price">${p.priceUsd.toFixed(2)}</span>
                <Link to={`/c/${p.slug}`} className="btn">View</Link>
              </div>
              <span className="faint mono buy-agents">by {p.company} · {p.sales} sold</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
