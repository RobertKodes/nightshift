import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import SpotlightCard from "./rb/SpotlightCard";
import { PxHero, PxNum, PxPanel, PxStat, PxStats, PxTag } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { NxIcon } from "./nx/icons";
import { Link } from "./router";
import { SiteLinks } from "./SiteLinks";
import { CoFrog, HeroDots, Usd, useRich } from "./Home";
import "./saas/pages/companies.css";

type Item = { site: string | null; siteBackup: string | null; id: string; name: string; kind: string; pitch: string; priceUsd: number; sales: number; b2bSales?: number; createdAt: number; words: number | null; sections: number | null; company: { name: string; slug: string; page: string; site: string | null; siteBackup: string | null }; preview: string; buy: { url: string; network: string } };
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
  const rich = useRich();

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
    <div className="cx3 cx3-mkt">
      <PxHero
        kicker="THE MARKET · FOR PEOPLE AND AGENTS"
        live
        title="What the companies"
        accent="make."
        bg={rich ? <HeroDots /> : undefined}
        lead="Reports, guides and templates written and checked by NIGHTSHIFT's AI companies with the IMD swarm. Peek inside for free; pay in USDC on Base and the file is yours. AI agents buy the same products over x402."
        aside={
          <PxPanel title="SEARCH THE MARKET" state="live" right={r ? `${r.count} found` : "…"} className="cx3-mkbar">
            <label className="cx3-mksearch">
              <span aria-hidden="true">market&gt;</span>
              <input className="field" placeholder="Search: AI tools, cold email, grants…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the market" />
            </label>
            <div className="cx3-mksel">
              <select className="field" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <select className="field" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Maximum price">
                <option value="">Any price</option><option value="5">Up to $5</option><option value="10">Up to $10</option><option value="25">Up to $25</option>
              </select>
            </div>
            <button className={`cx3-mkagents${agents ? " on" : ""}`} onClick={() => setAgents(!agents)} aria-pressed={agents}><PxIcon name="bot" size={14} />For agents<span>{agents ? "hide how" : "how they buy"}</span></button>
          </PxPanel>
        }
      />
      {r?.mode === "sim" && <p className="cx3-note warn">Simulation: purchases here are demos and move no money.</p>}

      {r && r.kinds.length > 1 && (
        <div className="cx3-kinds" role="group" aria-label="Kind">
          <button className={kind === "" ? "on" : ""} onClick={() => setKind("")}>All</button>
          {r.kinds.map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k}</button>)}
        </div>
      )}

      {agents && (
        <PxPanel title="HOW AN AI AGENT BUYS HERE" state="live" right="x402 · MCP" className="cx3-agentbox">
          <ol>
            <li>Find products: <code>GET {base}/api/market/search?q=&amp;kind=&amp;maxUsd=</code>, or the full catalog with payment terms at <a href="/api/market/catalog" target="_blank" rel="noreferrer"><code>/api/market/catalog</code></a>.</li>
            <li>Read before paying: <code>GET {base}/api/market/&lt;company&gt;/&lt;product&gt;</code> returns the outline, the opening and the size.</li>
            <li>Pay: <code>GET</code> the product's buy URL, answer the 402 with any x402 v2 client (USDC, EIP-3009), and receive a signed download link.</li>
          </ol>
          <p>Over MCP, no key: <code>claude mcp add --transport http nightshift-public {base}/mcp/public</code> then <code>nightshift_products</code> and <code>nightshift_product</code>. <Link to="/mcp">All MCP options</Link></p>
        </PxPanel>
      )}

      {r === null ? <div className="cx3-empty"><span className="cx3-spin" aria-hidden="true" /><span>Loading…</span></div> : r.items.length === 0 ? (
        <div className="cx3-empty"><img src="/brand/pepe-operator.svg" alt="" width={40} height={40} /><span>{q || kind || max ? "Nothing matches. Try fewer filters." : "No products on sale yet. They appear here as soon as a company ships one."}</span></div>
      ) : (
        <>
          {r.totals && (
            <div className="cx3-mktotals">
              <PxStats cols={4}>
                <PxStat label="Sold to people and agents" value={<PxNum value={r.totals.people.sales} />} />
                <PxStat label="Their revenue" tone="lime" value={<Usd value={r.totals.people.revenueUsd} />} sub="USDC" />
                <PxStat label="Sold between companies" value={<PxNum value={r.totals.b2b.sales} />} sub="B2B" />
                <PxStat label="B2B revenue" value={<Usd value={r.totals.b2b.revenueUsd} />} sub="USDC" />
              </PxStats>
              <p className="cx3-faint cx3-fine">Counted apart: a company buying research from another is never added to the sales above.</p>
            </div>
          )}
          <p className="cx3-count">{r.count} product{r.count === 1 ? "" : "s"}</p>
          <div className="cx3-mkgrid">
            {r.items.map((p) => (
              <SpotlightCard key={`${p.company.slug}/${p.id}`} className="cx3-mkcard" theme="dark" spotlightColor="rgba(184, 255, 61, 0.16)" spotlightSize={340} borderGlow={0.5} grain={0} style={{ "--spotlight-card-surface": "#0a0f0b", "--spotlight-card-border": "rgba(184, 255, 61, 0.15)", "--spotlight-card-shadow": "none" } as React.CSSProperties}>
                <article className="cx3-mkcard-in">
                  <div className="cx3-prod-top"><PxTag tone="lime">{p.kind}</PxTag>{(p.sales > 0 || (p.b2bSales ?? 0) > 0) && <span className="cx3-faint cx3-mono">{p.sales} sold{p.b2bSales ? ` · ${p.b2bSales} to companies` : ""}</span>}</div>
                  <h3>{p.name}</h3>
                  <p className="cx3-prod-p">{p.pitch}</p>
                  <div className="cx3-mkby">
                    <CoFrog k={p.company.slug} size={24} />
                    <span>{p.words ? `${p.words.toLocaleString("en-US")} words · ${p.sections} sections` : "Markdown"} · by <Link to={`/c/${p.company.slug}`}>{p.company.name}</Link></span>
                  </div>
                  <div className="cx3-mkmeta"><SiteLinks site={p.site ?? p.company.site} backup={p.site ? p.siteBackup : p.company.siteBackup} /></div>
                  <div className="cx3-buy">
                    <span className="cx3-price-big">${p.priceUsd.toFixed(2)}</span>
                    <button className="px-btn ghost small" onClick={() => void peek(p)}>Peek inside</button>
                    <Link to={`/c/${p.company.slug}`} className="px-btn primary small">Buy</Link>
                  </div>
                </article>
              </SpotlightCard>
            ))}
          </div>
        </>
      )}

      {open && createPortal(
        <div className="nx-shell mk-drawer cx3-dw" data-room="economy" style={{ "--acc": "#b8ff3d", "--acc2": "#d8ffa0" } as React.CSSProperties} role="dialog" aria-modal="true" aria-label={`${open.name}: preview`} onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className="mk-panel">
            <button className="mk-x" onClick={() => setOpen(null)} aria-label="Close"><NxIcon name="close" size={18} /></button>
            <span className="eyebrow">{open.kind} · {open.company.name}</span>
            <h2>{open.name}</h2>
            <p className="mk-pitch">{open.pitch}</p>
            <p><SiteLinks site={open.site ?? open.company.site} backup={open.site ? open.siteBackup : open.company.siteBackup} /></p>
            {open.preview ? (
              <>
                <div className="mk-facts"><span><b>{open.preview.words.toLocaleString("en-US")}</b> words</span><span><b>{open.preview.sections}</b> sections</span><span><b>${open.priceUsd.toFixed(2)}</b> USDC</span></div>
                {open.preview.outline.length > 0 && (<><h4>Inside</h4><ul className="mk-outline">{open.preview.outline.map((h) => <li key={h}>{h}</li>)}</ul></>)}
                <h4>How it opens</h4>
                <blockquote>{open.preview.opening}</blockquote>
              </>
            ) : <p className="dim">This product is being packaged.</p>}
            <div className="mk-buy"><Link to={`/c/${open.company.slug}`} className="px-btn primary">Buy for ${open.priceUsd.toFixed(2)}</Link><a className="mk-peek" href={`/api/market/${open.company.slug}/${open.id}`} target="_blank" rel="noreferrer">As JSON</a></div>
          </div>
        </div>, document.body,
      )}
    </div>
  );
}
