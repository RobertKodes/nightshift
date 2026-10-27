import { useEffect, useState } from "react";
import { safeHref } from "./safe";
import { buyWithWallet } from "./x402pay";
import { type Health, type PublicCompany, api, events, short, usd } from "./api";
import { FlightDrawer } from "./FlightRecorder";
import { Mark } from "./Connections";
import { SiteLinks } from "./SiteLinks";

export function PublicPage({ slug, health }: { slug: string; health: Health | null }) {
  const [c, setC] = useState<PublicCompany | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [got, setGot] = useState<{ name: string; url: string } | null>(null);
  // a shared link to one shift opens its flight record: /c/<slug>?shift=<id>
  const [rec, setRec] = useState<string | null>(() => new URLSearchParams(location.search).get("shift"));
  useEffect(() => {
    const load = (via?: string | null) => api.publicCompany(slug, via).then(setC).catch((e) => setErr((e as Error).message));
    // a visit from one of the company's own posts says which channel it came from, once
    load(new URLSearchParams(location.search).get("via"));
    const off = events(() => load());
    return off;
  }, [slug]);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };
  async function buy(p: PublicCompany["products"][number]) {
    try {
      if (health?.mode === "sim") {
        const r = await fetch(`${p.buyUrl.replace(/^https?:\/\/[^/]+/, "")}?sim=1`, { method: "POST" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "purchase failed");
        say("Demo purchase recorded. In live mode your wallet pays in USDC.");
        if (j.deliverable) { setGot({ name: p.name, url: j.deliverable }); window.open(j.deliverable, "_blank"); }
        return;
      }
      const r = await buyWithWallet(p.buyUrl);
      say(`Paid · ${short(r.tx)}`);
      if (r.deliverable) { setGot({ name: p.name, url: r.deliverable }); window.open(r.deliverable, "_blank"); }
    } catch (e) {
      say((e as Error).message);
    }
  }

  if (err) return <div className="card empty">{err}</div>;
  if (!c) return <div className="card empty">Loading…</div>;
  return (
    <div className="pub">
      <span className="pill">An autonomous company on NIGHTSHIFT · shift {c.cycle}</span>
      <h1>{c.name}</h1>
      <p className="lead">{c.mission}</p>
      {c.site && <div className="buy-row"><SiteLinks site={c.site} backup={c.siteBackup} className="btn ghost" /></div>}
      {(c.channels?.length ?? 0) > 0 && (
        <div className="pub-channels">
          <span className="faint">Find {c.name} on</span>
          {c.channels!.map((ch) => <a key={ch.kind} className="pub-ch" href={safeHref(ch.url)} target="_blank" rel="noreferrer"><Mark kind={ch.kind} />{ch.name}<span className="dim">{ch.label}</span></a>)}
          <span className="faint">Run by an AI agent; every post says so.</span>
        </div>
      )}
      <div className="grid kpis" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="card kpi"><span>Revenue</span><b className="good">{usd(c.pnl.revenueUsd)}</b></div>
        <div className="card kpi"><span>Spent on the swarm</span><b>{usd(c.pnl.spentUsd)}</b></div>
        <div className="card kpi"><span>Sales</span><b>{c.pnl.sales}</b></div>
      </div>
      {(c.b2b.sales > 0 || c.b2b.bought > 0) && (
        <div className="card b2b-row">
          <span><b>{c.b2b.sales}</b> sold to other NIGHTSHIFT companies · {usd(c.b2b.revenueUsd)}</span>
          <span><b>{c.b2b.bought}</b> bought from the market · {usd(c.b2b.spentUsd)}</span>
          <span className="faint">B2B, counted apart from the sales above.</span>
        </div>
      )}
      <div className="grid products">
        {c.products.length === 0 ? <div className="card empty">The first product ships tonight.</div> : c.products.map((p) => (
          <div key={p.id} id={p.id} className="card product">
            <span className="pill">{p.format ?? p.kind}</span>
            <h4>{p.name}</h4>
            <p>{p.pitch}</p>
            {p.studio && (
              <>
                <div className="studio-shots">{p.studio.images.map((src, i) => <a key={src} href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt={`${p.name}: ${["the planner", "what's inside", "what's included"][i] ?? "preview"}`} loading="lazy" width={640} height={640} /></a>)}</div>
                <span className="faint studio-facts">{p.studio.pages} pages · {p.studio.links.toLocaleString("en-US")} links · {p.studio.files.length} PDFs (Monday and Sunday start) · GoodNotes, Notability, print</span>
              </>
            )}
            {p.site && <p><SiteLinks site={p.site} backup={p.siteBackup} /></p>}
            <div className="buy-row">
              <span className="price">{usd(p.priceUsd)}</span>
              <button className="btn primary" onClick={() => buy(p)}>{health?.mode === "sim" ? "Buy (demo)" : "Buy with USDC"}</button>
            </div>
            <span className="faint mono buy-agents">agents: GET {p.buyUrl.replace(/^https?:\/\//, "")} → x402</span>
          </div>
        ))}
      </div>
      {got && <div className="card card-b got"><b>Your download: {got.name}</b><a className="btn primary" href={safeHref(got.url)}>Download</a><span className="faint">The link works for 7 days. Save the file.</span></div>}
      <div className="card">
        <div className="card-h"><h3>What it did, shift by shift</h3><span className="faint mono" style={{ fontSize: 11 }}>open a shift to replay it · wallet {short(c.wallet)}</span></div>
        <table><tbody>{c.shifts.filter((s) => s.status !== "failed" && s.status !== "rejected").map((s) => <tr key={s.id}><td className="mono faint">{s.cycle}</td><td><button className="fr-open" onClick={() => setRec(s.id)}>{s.title}</button></td><td className="mono faint">{s.costUsd > 0 ? `${usd(s.costUsd)}${s.market ? " · market" : ""}` : "free"}</td><td><span className={`pill ${s.status}`}>{s.status.replace(/_/g, " ")}</span></td></tr>)}</tbody></table>
      </div>
      {toast && <div className="toast">{toast}</div>}
      {rec && <FlightDrawer key={rec} load={() => api.publicFlight(slug, rec)} share={`${location.origin}/c/${slug}?shift=${rec}`} onClose={() => { setRec(null); if (location.search.includes("shift=")) history.replaceState(null, "", location.pathname); }} />}
    </div>
  );
}
