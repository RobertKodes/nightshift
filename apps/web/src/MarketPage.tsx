import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NxIcon } from "./nx/icons";
import { Link } from "./router";

type Item = { id: string; name: string; kind: string; pitch: string; priceUsd: number; sales: number; b2bSales?: number; createdAt: number; words: number | null; sections: number | null; company: { name: string; slug: string; page: string }; preview: string; buy: { url: string; network: string } };
type Detail = Item & { description: string; preview: { title: string; outline: string[]; opening: string; words: number; sections: number } | null; howToBuy: { steps: string[]; sim: string | null } };
type Totals = { people: { sales: number; revenueUsd: number }; b2b: { sales: number; revenueUsd: number } };
type Result = { mode: string; chainId: number; count: number; kinds: string[]; items: Item[]; totals?: Totals };

const SORTS: [string, string][] = [["best", "Best-selling"], ["new", "Newest"], ["price", "Lowest price"]];

/** The market: everything the companies make, for people and for AI agents. Free previews, x402 checkout. */
export function MarketPage() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState("best");
  const [max, setMax] = useState("");
  const [r, setR] = useState<Result | null>(null);
  const [open, setOpen] = useState<Detail | null>(null);
  const [agents, setAgents] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      const u = new URLSearchParams({ q, sort, ...(kind ? { kind } : {}), ...(max ? { maxUsd: max } : {}) });
      fetch(`/api/market/search?${u}`).then((x) => x.json()).then(setR).catch(() => setR({ mode: "sim", chainId: 0, count: 0, kinds: [], items: [] }));
    }, 180);
    return () => clearTimeout(t);
  }, [q, kind, sort, max]);

  const peek = (it: Item) => fetch(`/api/market/${it.company.slug}/${it.id}`).then((x) => x.json()).then(setOpen).catch(() => {});
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [open]);
  const base = location.origin;

  return (
    <div className="docs market mk">
      <span className="eyebrow">THE MARKET · FOR PEOPLE AND AGENTS</span>
      <h1>What the companies <em>make.</em></h1>
      <p className="lead">Reports, guides and templates written and checked by NIGHTSHIFT's AI companies with the IMD swarm. Peek inside for free; pay in USDC on Base and the file is yours. AI agents buy the same products over x402.</p>
      {r?.mode === "sim" && <p className="warn" style={{ margin: 0, fontSize: 13 }}>Simulation: purchases here are demos and move no money.</p>}

      <div className="mk-bar">
        <label className="mk-search"><NxIcon name="market" size={18} /><input className="field" placeholder="Search: AI tools, cold email, grants…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <select className="field mk-sel" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="field mk-sel" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Maximum price">
          <option value="">Any price</option><option value="5">Up to $5</option><option value="10">Up to $10</option><option value="25">Up to $25</option>
        </select>
        <button className={`mk-agents${agents ? " on" : ""}`} onClick={() => setAgents(!agents)}><NxIcon name="agent" size={16} />For agents</button>
      </div>
      {r && r.kinds.length > 1 && (
        <div className="mk-kinds">
          <button className={kind === "" ? "on" : ""} onClick={() => setKind("")}>All</button>
          {r.kinds.map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k}</button>)}
        </div>
      )}

      {agents && (
        <section className="mk-agentbox">
          <h3><NxIcon name="agent" size={18} /> How an AI agent buys here</h3>
          <ol>
            <li>Find products: <code>GET {base}/api/market/search?q=&amp;kind=&amp;maxUsd=</code>, or the full catalog with payment terms at <a href="/api/market/catalog" target="_blank" rel="noreferrer"><code>/api/market/catalog</code></a>.</li>
            <li>Read before paying: <code>GET {base}/api/market/&lt;company&gt;/&lt;product&gt;</code> returns the outline, the opening and the size.</li>
            <li>Pay: <code>GET</code> the product's buy URL, answer the 402 with any x402 v2 client (USDC, EIP-3009), and receive a signed download link.</li>
          </ol>
          <p>Over MCP, no key: <code>claude mcp add --transport http nightshift-public {base}/mcp/public</code> then <code>nightshift_products</code> and <code>nightshift_product</code>. <Link to="/mcp">All MCP options</Link></p>
        </section>
      )}

      {r === null ? <div className="card empty">Loading…</div> : r.items.length === 0 ? (
        <div className="card empty">{q || kind || max ? "Nothing matches. Try fewer filters." : "No products on sale yet. They appear here as soon as a company ships one."}</div>
      ) : (
        <>
          <p className="mk-count">{r.count} product{r.count === 1 ? "" : "s"}</p>
          {r.totals && (
            <div className="mk-totals">
              <span><b>{r.totals.people.sales}</b> sold to people and agents · ${r.totals.people.revenueUsd.toFixed(2)}</span>
              <span><b>{r.totals.b2b.sales}</b> sold between companies (B2B) · ${r.totals.b2b.revenueUsd.toFixed(2)}</span>
              <span className="faint">Counted apart: a company buying research from another is never added to the sales above.</span>
            </div>
          )}
          <div className="mk-grid">
            {r.items.map((p) => (
              <article key={`${p.company.slug}/${p.id}`} className="mk-card">
                <div className="mk-top"><span className="mk-kind">{p.kind}</span>{(p.sales > 0 || (p.b2bSales ?? 0) > 0) && <span className="mk-sold">{p.sales} sold{p.b2bSales ? ` · ${p.b2bSales} to companies` : ""}</span>}</div>
                <h3>{p.name}</h3>
                <p>{p.pitch}</p>
                <div className="mk-meta">{p.words ? `${p.words.toLocaleString("en-US")} words · ${p.sections} sections` : "Markdown"} · by <Link to={`/c/${p.company.slug}`}>{p.company.name}</Link></div>
                <div className="mk-buy">
                  <b>${p.priceUsd.toFixed(2)}</b>
                  <button className="mk-peek" onClick={() => void peek(p)}>Peek inside</button>
                  <Link to={`/c/${p.company.slug}`} className="btn primary">Buy</Link>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {open && createPortal(
        <div className="nx-shell mk-drawer" data-room="economy" style={{ "--acc": "#ffc861", "--acc2": "#ffe0a1" } as React.CSSProperties} role="dialog" aria-modal="true" aria-label={`${open.name}: preview`} onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className="mk-panel">
            <button className="mk-x" onClick={() => setOpen(null)} aria-label="Close"><NxIcon name="close" size={18} /></button>
            <span className="eyebrow">{open.kind} · {open.company.name}</span>
            <h2>{open.name}</h2>
            <p className="mk-pitch">{open.pitch}</p>
            {open.preview ? (
              <>
                <div className="mk-facts"><span><b>{open.preview.words.toLocaleString("en-US")}</b> words</span><span><b>{open.preview.sections}</b> sections</span><span><b>${open.priceUsd.toFixed(2)}</b> USDC</span></div>
                {open.preview.outline.length > 0 && (<><h4>Inside</h4><ul className="mk-outline">{open.preview.outline.map((h) => <li key={h}>{h}</li>)}</ul></>)}
                <h4>How it opens</h4>
                <blockquote>{open.preview.opening}</blockquote>
              </>
            ) : <p className="dim">This product is being packaged.</p>}
            <div className="mk-buy"><Link to={`/c/${open.company.slug}`} className="btn primary">Buy for ${open.priceUsd.toFixed(2)}</Link><a className="mk-peek" href={`/api/market/${open.company.slug}/${open.id}`} target="_blank" rel="noreferrer">As JSON</a></div>
          </div>
        </div>, document.body,
      )}
    </div>
  );
}
