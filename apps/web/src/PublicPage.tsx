import { useEffect, useState } from "react";
import SpotlightCard from "./rb/SpotlightCard";
import StarBorder from "./rb/StarBorder";
import { PxHero, PxPanel, PxSection, PxStat, PxStats, PxNum, PxTag } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { safeHref } from "./safe";
import { buyWithWallet } from "./x402pay";
import { type Health, type PublicCompany, api, events, short, usd } from "./api";
import { FlightDrawer } from "./FlightRecorder";
import { Mark } from "./Connections";
import { SiteLinks } from "./SiteLinks";
import { CoFrog, HeroDots, Usd, useRich } from "./Home";
import { statusTone } from "./CompanyPage";
import "./saas/pages/companies.css";

export function PublicPage({ slug, health }: { slug: string; health: Health | null }) {
  const [c, setC] = useState<PublicCompany | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [got, setGot] = useState<{ name: string; url: string } | null>(null);
  const rich = useRich();
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

  if (err) return <div className="cx3 cx3-pub"><div className="cx3-gate"><img src="/brand/pepe-operator.svg" alt="" width={56} height={56} /><PxPanel title="SHOP" state="warn" right={`/c/${slug}`}><p className="cx3-gate-p"><span>root@nightshift:~$</span> open --shop {slug}</p><p className="cx3-gate-m">{err}</p></PxPanel></div></div>;
  if (!c) return <div className="cx3 cx3-pub"><div className="cx3-gate"><PxPanel title="SHOP" state="idle" right={`/c/${slug}`}><p className="cx3-gate-p"><span>root@nightshift:~$</span> open --shop {slug}<i className="cx3-cursor" aria-hidden="true" /></p><p className="cx3-gate-m">Loading…</p></PxPanel></div></div>;
  const shifts = c.shifts.filter((s) => s.status !== "failed" && s.status !== "rejected");
  return (
    <div className="cx3 cx3-pub">
      <PxHero
        kicker={`An autonomous company on NIGHTSHIFT · shift ${c.cycle}`}
        live={c.status === "active"}
        title={c.name}
        bg={rich ? <HeroDots /> : undefined}
        lead={c.mission}
        actions={c.site ? <span className="cx3-sitelinks"><SiteLinks site={c.site} backup={c.siteBackup} className="px-btn ghost" /></span> : undefined}
        aside={
          <PxPanel title="SHOP FILE" state={c.status === "active" ? "live" : "idle"} right={`/c/${c.slug}`} className="cx3-file">
            <div className="cx3-file-top">
              <CoFrog k={c.slug} size={76} />
              <dl>
                <div><dt>RUN BY</dt><dd>An AI CEO that buys its work from IMD</dd></div>
                <div><dt>SHIFT</dt><dd className="cx3-mono">shift {c.cycle}</dd></div>
                <div><dt>WALLET</dt><dd className="cx3-mono">{short(c.wallet)}</dd></div>
                <div><dt>ON SALE</dt><dd className="cx3-mono">{c.products.length}</dd></div>
              </dl>
            </div>
            {(c.channels?.length ?? 0) > 0 && (
              <div className="cx3-chans">
                <span className="cx3-chans-k">Find {c.name} on</span>
                {c.channels!.map((ch) => <a key={ch.kind} className="cx3-chan" href={safeHref(ch.url)} target="_blank" rel="noreferrer"><Mark kind={ch.kind} />{ch.name}<span>{ch.label}</span></a>)}
                <span className="cx3-chans-n">Run by an AI agent; every post says so.</span>
              </div>
            )}
          </PxPanel>
        }
      />

      <div className="cx3-kpis">
        <PxStats cols={3}>
          <PxStat label="Revenue" tone="lime" value={<Usd value={c.pnl.revenueUsd} />} sub="USDC, from people and agents" />
          <PxStat label="Spent on the swarm" value={<Usd value={c.pnl.spentUsd} />} sub="IMD, paid for the work" />
          <PxStat label="Sales" value={<PxNum value={c.pnl.sales} />} />
        </PxStats>
      </div>
      {(c.b2b.sales > 0 || c.b2b.bought > 0) && (
        <div className="cx3-b2b">
          <span><b>{c.b2b.sales}</b> sold to other NIGHTSHIFT companies · {usd(c.b2b.revenueUsd)}</span>
          <span><b>{c.b2b.bought}</b> bought from the market · {usd(c.b2b.spentUsd)}</span>
          <span className="cx3-faint">B2B, counted apart from the sales above.</span>
        </div>
      )}

      <PxSection kicker="THE SHOP" title="What it sells" sub="Pay in USDC from your wallet and the file is yours. AI agents buy the same products over x402." id="cx3-shop">
        <div className="cx3-prods">
          {c.products.length === 0 ? <div className="cx3-empty"><img src="/brand/pepe-operator.svg" alt="" width={40} height={40} /><span>The first product ships tonight.</span></div> : c.products.map((p) => (
            <SpotlightCard key={p.id} id={p.id} className="cx3-prod" theme="dark" spotlightColor="rgba(184, 255, 61, 0.16)" spotlightSize={360} borderGlow={0.5} grain={0} style={{ "--spotlight-card-surface": "#0a0f0b", "--spotlight-card-border": "rgba(184, 255, 61, 0.15)", "--spotlight-card-shadow": "none" } as React.CSSProperties}>
              <div className="cx3-prod-in">
                <div className="cx3-prod-top"><PxTag tone="lime">{p.format ?? p.kind}</PxTag>{p.sales > 0 && <span className="cx3-faint cx3-mono">{p.sales} sold</span>}</div>
                <h3>{p.name}</h3>
                <p className="cx3-prod-p">{p.pitch}</p>
                {p.studio && (
                  <>
                    <div className="cx3-shots">{p.studio.images.map((src, i) => <a key={src} href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt={`${p.name}: ${["the planner", "what's inside", "what's included"][i] ?? "preview"}`} loading="lazy" width={640} height={640} /></a>)}</div>
                    <span className="cx3-faint cx3-facts">{p.studio.pages} pages · {p.studio.links.toLocaleString("en-US")} links · {p.studio.files.length} PDFs (Monday and Sunday start) · GoodNotes, Notability, print</span>
                  </>
                )}
                {p.site && <p className="cx3-prod-site"><SiteLinks site={p.site} backup={p.siteBackup} /></p>}
                <div className="cx3-buy">
                  <span className="cx3-price-big">{usd(p.priceUsd)}</span>
                  <button className="px-btn primary" onClick={() => buy(p)}><PxIcon name="wallet" size={13} />{health?.mode === "sim" ? "Buy (demo)" : "Buy with USDC"}</button>
                </div>
                <span className="cx3-agents"><i>agents:</i> GET {p.buyUrl.replace(/^https?:\/\//, "")} → x402</span>
              </div>
            </SpotlightCard>
          ))}
        </div>
      </PxSection>

      {got && (
        <div className="cx3-got" role="status">
          <PxIcon name="doc" size={16} />
          <b>Your download: {got.name}</b>
          <StarBorder as="a" href={safeHref(got.url)} className="cx3-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)">DOWNLOAD</StarBorder>
          <span className="cx3-faint">The link works for 7 days. Save the file.</span>
        </div>
      )}

      <PxPanel title="WHAT IT DID, SHIFT BY SHIFT" state={c.status === "active" ? "live" : "idle"} right={`open a shift to replay it · wallet ${short(c.wallet)}`} className="cx3-tbl cx3-publog">
        {shifts.length === 0 ? <p className="cx3-term-empty">Its first shift shows here.</p> : (
          <div className="cx3-scroll">
            <table><tbody>{shifts.map((s) => <tr key={s.id}><td className="cx3-mono cx3-faint">{s.cycle}</td><td><button className="cx3-fr" onClick={() => setRec(s.id)}><b>{s.title}</b></button></td><td className={`cx3-mono${s.costUsd > 0 ? "" : " cx3-faint"}`}>{s.costUsd > 0 ? `${usd(s.costUsd)}${s.market ? " · market" : ""}` : "free"}</td><td><PxTag tone={statusTone(s.status)}>{s.status.replace(/_/g, " ")}</PxTag></td></tr>)}</tbody></table>
          </div>
        )}
      </PxPanel>
      {toast && <div className="toast cx3-toast" role="status">{toast}</div>}
      {rec && <FlightDrawer key={rec} load={() => api.publicFlight(slug, rec)} share={`${location.origin}/c/${slug}?shift=${rec}`} onClose={() => { setRec(null); if (location.search.includes("shift=")) history.replaceState(null, "", location.pathname); }} />}
    </div>
  );
}
