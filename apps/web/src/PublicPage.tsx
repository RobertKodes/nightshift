import { useEffect, useRef, useState } from "react";
import SpotlightCard from "./rb/SpotlightCard";
import StarBorder from "./rb/StarBorder";
import { PxHero, PxPanel, PxSection, PxStat, PxStats, PxNum, PxTag } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { safeHref } from "./safe";
import { buyWithWallet } from "./x402pay";
import { type Health, api, events, short, usd } from "./api";
import { type MadeOrderView, type ShopCompany, type ShopProduct, formatLabel, v2 } from "./CompanyPage.api";
import { FlightDrawer } from "./FlightRecorder";
import { Mark } from "./Connections";
import { SiteLinks } from "./SiteLinks";
import { CoFrog, HeroDots, Usd, useRich } from "./Home";
import { statusTone } from "./CompanyPage";
import "./saas/pages/companies.css";
import "./CompanyPage.v2.css";

type Got = { name: string; url: string };
const local = (url: string) => url.replace(/^https?:\/\/[^/]+/, "");

/** Pays for one product: a demo purchase in the simulator, the visitor's own wallet (USDC on Base) otherwise. */
async function pay(buyUrl: string, sim: boolean): Promise<{ deliverable: string | null; note: string }> {
  if (sim) {
    const r = await fetch(`${local(buyUrl)}${buyUrl.includes("?") ? "&" : "?"}sim=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = (await r.json()) as { error?: string; deliverable?: string };
    if (!r.ok) throw new Error(j.error ?? "purchase failed");
    return { deliverable: j.deliverable ?? null, note: "Demo purchase recorded. In live mode your wallet pays in USDC." };
  }
  const r = await buyWithWallet(buyUrl);
  return { deliverable: r.deliverable, note: `Paid · ${short(r.tx)}` };
}

/** Sales as the ledger has them: settled payments from outside buyers. Nothing typed in, no reviews. */
function Verified({ p, sim }: { p: ShopProduct; sim: boolean }) {
  if (p.sales <= 0) return <span className="cv2-verified none">no sales yet</span>;
  return <span className="cv2-verified" title="Counted from payments settled to the company's wallet. Purchases between NIGHTSHIFT companies and by the owner are not counted."><PxIcon name="shield" size={11} />{p.sales} {sim ? "demo" : "verified"} sale{p.sales === 1 ? "" : "s"}</span>;
}

/**
 * A made-for-you product: the short form, the file written and checked while the buyer waits, its
 * sections and first lines shown before any money moves, then one button to pay and download it.
 */
function OrderForm({ slug, p, sim, onGot, say }: { slug: string; p: ShopProduct; sim: boolean; onGot: (g: Got) => void; say: (m: string) => void }) {
  const c = p.custom!;
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [order, setOrder] = useState<MadeOrderView | null>(null);
  const [buy, setBuy] = useState("");
  const [busy, setBusy] = useState<"" | "writing" | "paying">("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const missing = c.fields.filter((f) => f.required && (values[f.key] ?? "").trim().length < Math.max(1, f.min));

  async function write() {
    setErrors([]); setOrder(null); setBusy("writing");
    try {
      let a = await v2.order(slug, p.id, values);
      setBuy(a.buy);
      // the file takes about a minute: the engine answers when it is written, or we ask again
      while (alive.current && a.order.status === "writing") { setOrder(a.order); a = await v2.orderState(a.order.id); }
      if (alive.current) setOrder(a.order);
    } catch (e) {
      const x = e as Error & { errors?: string[] };
      setErrors(x.errors?.length ? x.errors : [x.message]);
    } finally { if (alive.current) setBusy(""); }
  }
  async function checkout() {
    if (!order) return;
    setBusy("paying");
    try {
      const r = await pay(buy, sim);
      say(r.note);
      if (r.deliverable) { onGot({ name: p.name, url: r.deliverable }); window.open(r.deliverable, "_blank"); }
      setOrder({ ...order, status: "paid", paid: true });
    } catch (e) { say((e as Error).message); } finally { if (alive.current) setBusy(""); }
  }

  if (order?.status === "ready" || order?.status === "paid") {
    return (
      <div className="cv2-order ready">
        <b className="cv2-order-k"><PxIcon name="doc" size={13} />{order.status === "paid" ? "PAID · YOUR FILE" : "YOUR FILE IS READY"}</b>
        {order.preview && (
          <>
            <p className="cv2-order-facts">{order.preview.words.toLocaleString("en-US")} words · {order.preview.outline.length} sections · written for you and checked</p>
            <ul className="cv2-outline">{order.preview.outline.slice(0, 8).map((h, i) => <li key={i}>{h}</li>)}</ul>
            <blockquote>{order.preview.opening}</blockquote>
          </>
        )}
        {order.status === "ready" ? (
          <div className="cx3-buy">
            <span className="cx3-price-big">{usd(p.priceUsd)}</span>
            <button className="px-btn primary" disabled={busy !== ""} onClick={() => void checkout()}><PxIcon name="wallet" size={13} />{busy === "paying" ? "Paying…" : sim ? "Pay (demo) and download" : "Pay with USDC and download"}</button>
            <button className="px-btn ghost small" disabled={busy !== ""} onClick={() => setOrder(null)}>Change my answers</button>
          </div>
        ) : <p className="cx3-hint lime">Your download opened in a new tab; the link is below and works for 7 days.</p>}
        {order.status === "ready" && <p className="cx3-hint">You pay only now, for a file that exists. If you leave, nothing is charged and the draft is deleted within a day.</p>}
      </div>
    );
  }
  if (busy === "writing") {
    return (
      <div className="cv2-order writing" role="status">
        <span className="cx3-spin" aria-hidden="true" />
        <div><b>Writing your file…</b><p>About a minute: it is written from your answers, then checked. Nothing is charged yet.{order?.inLine ? ` ${order.inLine} order${order.inLine === 1 ? "" : "s"} ahead of yours.` : ""}</p></div>
      </div>
    );
  }
  return (
    <form className="cv2-form" onSubmit={(e) => { e.preventDefault(); void write(); }}>
      {c.fields.map((f) => {
        const v = values[f.key] ?? "";
        const set = (x: string) => setValues({ ...values, [f.key]: x });
        const id = `f-${p.id}-${f.key}`;
        return (
          <label key={f.key} htmlFor={id} className="cv2-field">
            <span>{f.label}{f.required || /optional/i.test(f.label) ? "" : " · optional"}</span>
            {f.type === "select" ? (
              <select id={id} className="field" value={v} onChange={(e) => set(e.target.value)}><option value="">{f.required ? "Choose…" : "No preference"}</option>{f.options!.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            ) : f.type === "textarea" ? (
              <textarea id={id} className="field" value={v} maxLength={f.max} rows={f.max > 2000 ? 7 : 3} onChange={(e) => set(e.target.value)} />
            ) : (
              <input id={id} className="field" value={v} maxLength={f.max} onChange={(e) => set(e.target.value)} />
            )}
            {f.help && <small>{f.help}</small>}
            {f.type === "textarea" && f.required && v.length > 0 && v.length < f.min && <small className="cx3-bad">{f.min - v.length} more characters</small>}
          </label>
        );
      })}
      {(order?.status === "failed" || errors.length > 0) && <div className="cx3-err" role="alert">{(order?.status === "failed" ? order.problems ?? [] : errors).map((e, i) => <div key={i}>{e}</div>)}</div>}
      <div className="cx3-buy">
        <span className="cx3-price-big">{usd(p.priceUsd)}</span>
        <button className="px-btn primary" type="submit" disabled={missing.length > 0}><PxIcon name="bolt" size={13} />Write my file · free to try</button>
      </div>
      <p className="cx3-hint">You pay only after the file is written and you have seen its outline. Your answers are sent to an AI model to write it and are not kept; leave out addresses, phone numbers and ID numbers.</p>
    </form>
  );
}

function ProductCard({ slug, p, sim, open, onOpen, onGot, say }: { slug: string; p: ShopProduct; sim: boolean; open: boolean; onOpen: () => void; onGot: (g: Got) => void; say: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState(false);
  const buy = async () => {
    setBusy(true);
    try {
      const r = await pay(p.buyUrl, sim);
      say(r.note);
      if (r.deliverable) { onGot({ name: p.name, url: r.deliverable }); window.open(r.deliverable, "_blank"); }
    } catch (e) { say((e as Error).message); } finally { setBusy(false); }
  };
  const images = p.studio?.images ?? p.download?.images ?? [];
  const ready = p.packaged !== false;
  return (
    <SpotlightCard id={p.id} className={`cx3-prod cv2-card${open ? " is-open" : ""}`} theme="dark" spotlightColor="rgba(184, 255, 61, 0.16)" spotlightSize={360} borderGlow={0.5} grain={0} style={{ "--spotlight-card-surface": "#0a0f0b", "--spotlight-card-border": "rgba(184, 255, 61, 0.15)", "--spotlight-card-shadow": "none" } as React.CSSProperties}>
      <div className="cx3-prod-in">
        <div className="cx3-prod-top"><PxTag tone="lime">{formatLabel(p)}</PxTag><Verified p={p} sim={sim} /></div>
        <h3>{p.name}</h3>
        <p className="cx3-prod-p">{p.pitch}</p>

        {images.length > 0 && <div className="cx3-shots">{images.map((src, i) => <a key={src} href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt={`${p.name}: ${["the cover", "a page inside", "what's included"][i] ?? "preview"}`} loading="lazy" width={640} height={640} /></a>)}</div>}
        {p.studio && <span className="cx3-faint cx3-facts">{p.studio.pages} pages · {p.studio.links.toLocaleString("en-US")} links · {p.studio.files.length} PDFs (Monday and Sunday start) · GoodNotes, Notability, print</span>}
        {p.download && (
          <>
            <span className="cx3-faint cx3-facts">{p.download.pages} pages · {p.download.sheets} sheets · {p.download.lines} lines to tick, follow or fill in · PDF and an editable copy</span>
            {p.download.outline.length > 0 && <ul className="cv2-outline">{p.download.outline.map((h, i) => <li key={i}>{h}</li>)}</ul>}
          </>
        )}
        {p.custom && (
          <div className="cv2-what">
            {/* said once: a pitch that already is the promise is not repeated under itself */}
            {!p.custom.delivers.startsWith(p.pitch.replace(/…$/, "").slice(0, 60)) && <p><b>What you get.</b> {p.custom.delivers}</p>}
            <p className="cx3-faint"><b>What it does not do.</b> {p.custom.limits}</p>
            {p.custom.sample && (
              <>
                <button type="button" className="cx3-link" aria-expanded={sample} onClick={() => setSample(!sample)}>{sample ? "Hide the sample" : "See a sample"}</button>
                {sample && <pre className="cv2-sample" tabIndex={0}><i>Made from a made-up example, not from a customer.</i>{"\n\n"}{p.custom.sample}</pre>}
              </>
            )}
          </div>
        )}
        {p.site && <p className="cx3-prod-site"><SiteLinks site={p.site} backup={p.siteBackup} /></p>}

        {!ready ? (
          <div className="cx3-co-now"><span className="cx3-spin" aria-hidden="true" /><span>Being packaged: on sale in a few minutes.</span></div>
        ) : p.custom ? (
          open ? <OrderForm slug={slug} p={p} sim={sim} onGot={onGot} say={say} /> : (
            <div className="cx3-buy">
              <span className="cx3-price-big">{usd(p.priceUsd)}</span>
              <button className="px-btn primary" onClick={onOpen}><PxIcon name="bolt" size={13} />Start: answer {p.custom.fields.filter((f) => f.required).length} questions</button>
            </div>
          )
        ) : (
          <div className="cx3-buy">
            <span className="cx3-price-big">{usd(p.priceUsd)}</span>
            <button className="px-btn primary" disabled={busy} onClick={() => void buy()}><PxIcon name="wallet" size={13} />{busy ? "Paying…" : sim ? "Buy (demo)" : "Buy with USDC"}</button>
            {p.gumroadUrl && <a className="px-btn" href={safeHref(p.gumroadUrl)} target="_blank" rel="noopener noreferrer">Pay by card on Gumroad ↗</a>}
          </div>
        )}
        <span className="cx3-agents"><i>agents:</i> {p.custom ? "POST" : "GET"} {p.buyUrl.replace(/^https?:\/\//, "")} → x402</span>
      </div>
    </SpotlightCard>
  );
}

export function PublicPage({ slug, health }: { slug: string; health: Health | null }) {
  const [c, setC] = useState<ShopCompany | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [got, setGot] = useState<Got | null>(null);
  // a link to one product (/c/<slug>#<product>) opens it, with its order form
  const [open, setOpen] = useState<string | null>(() => location.hash.slice(1) || null);
  const rich = useRich();
  // a shared link to one shift opens its flight record: /c/<slug>?shift=<id>
  const [rec, setRec] = useState<string | null>(() => new URLSearchParams(location.search).get("shift"));
  const scrolled = useRef(false);
  useEffect(() => {
    const load = (via?: string | null) => v2.shop(slug, via).then(setC).catch((e) => setErr((e as Error).message));
    // a visit from one of the company's own posts says which channel it came from, once
    load(new URLSearchParams(location.search).get("via"));
    const off = events(() => load());
    return off;
  }, [slug]);
  useEffect(() => {
    if (!c || scrolled.current || !open) return;
    scrolled.current = true;
    document.getElementById(open)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [c, open]);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };
  const sim = (c?.mode ?? health?.mode) === "sim";

  if (err) return <div className="cx3 cx3-pub"><div className="cx3-gate"><img src="/brand/pepe-operator.svg" alt="" width={56} height={56} /><PxPanel title="SHOP" state="warn" right={`/c/${slug}`}><p className="cx3-gate-p"><span>root@nightshift:~$</span> open --shop {slug}</p><p className="cx3-gate-m">{err === "no such company" ? "There is no shop at this address." : err}</p></PxPanel></div></div>;
  if (!c) return <div className="cx3 cx3-pub"><div className="cx3-gate"><PxPanel title="SHOP" state="idle" right={`/c/${slug}`}><p className="cx3-gate-p"><span>root@nightshift:~$</span> open --shop {slug}<i className="cx3-cursor" aria-hidden="true" /></p><p className="cx3-gate-m">Loading…</p></PxPanel></div></div>;
  const shifts = c.shifts.filter((s) => s.status !== "failed" && s.status !== "rejected");
  const sold = c.products.reduce((a, p) => a + p.sales, 0);
  return (
    <div className="cx3 cx3-pub">
      <PxHero
        kicker={`An AI-run company on NIGHTSHIFT · shift ${c.cycle}`}
        live={c.status === "active"}
        title={c.name}
        bg={rich ? <HeroDots /> : undefined}
        lead={c.mission}
        actions={<><a className="px-btn primary" href="#cx3-shop"><PxIcon name="market" size={13} />See what it sells</a>{c.site ? <span className="cx3-sitelinks"><SiteLinks site={c.site} backup={c.siteBackup} className="px-btn ghost" /></span> : null}</>}
        aside={
          <PxPanel title="SHOP FILE" state={c.status === "active" ? "live" : "idle"} right={`/c/${c.slug}`} className="cx3-file">
            <div className="cx3-file-top">
              <CoFrog k={c.slug} size={76} />
              <dl>
                <div><dt>RUN BY</dt><dd>An AI CEO: it makes its products in-house{c.plan === "funded" ? " and hires the IMD swarm" : ""}</dd></div>
                <div><dt>FOR</dt><dd>{c.audience}</dd></div>
                <div><dt>ON SALE</dt><dd className="cx3-mono">{c.products.length} product{c.products.length === 1 ? "" : "s"}{c.products.length ? ` · from ${usd(Math.min(...c.products.map((p) => p.priceUsd)))}` : ""}</dd></div>
                <div><dt>WALLET</dt><dd className="cx3-mono">{short(c.wallet)}</dd></div>
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

      <PxSection kicker="THE SHOP" title="What it sells" sub={sim ? "Simulation: purchases here are demos and move no money." : "Pay in USDC on Base from your own wallet and the file is yours. AI agents buy the same products over x402."} id="cx3-shop">
        <div className="cx3-prods">
          {c.products.length === 0 ? <div className="cx3-empty"><img src="/brand/pepe-operator.svg" alt="" width={40} height={40} /><span>Its first product is being made right now. Come back in a few minutes.</span></div> : c.products.map((p) => (
            <ProductCard key={p.id} slug={c.slug} p={p} sim={sim} open={open === p.id} onOpen={() => setOpen(p.id)} onGot={setGot} say={say} />
          ))}
        </div>
        <p className="cv2-trust"><PxIcon name="shield" size={12} />Sales counts come from payments settled to the company's wallet. There are no reviews here, because none are collected or invented. Made by AI: read what you buy before you rely on it.</p>
      </PxSection>

      {got && (
        <div className="cx3-got" role="status">
          <PxIcon name="doc" size={16} />
          <b>Your download: {got.name}</b>
          <StarBorder as="a" href={safeHref(got.url)} className="cx3-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)">DOWNLOAD</StarBorder>
          <span className="cx3-faint">The link works for 7 days. Save the file.</span>
        </div>
      )}

      <div className="cx3-kpis">
        <PxStats cols={3}>
          <PxStat label={sim ? "Demo sales" : "Verified sales"} value={<PxNum value={sold} />} sub="settled payments, from the ledger" />
          <PxStat label="Revenue" tone="lime" value={<Usd value={c.pnl.revenueUsd} />} sub="USDC, from people and agents" />
          <PxStat label="Spent on the swarm" value={<Usd value={c.pnl.spentUsd} />} sub={c.pnl.spentUsd > 0 ? "IMD, paid for the work" : "made in-house so far"} />
        </PxStats>
      </div>
      {(c.b2b.sales > 0 || c.b2b.bought > 0) && (
        <div className="cx3-b2b">
          <span><b>{c.b2b.sales}</b> sold to other NIGHTSHIFT companies · {usd(c.b2b.revenueUsd)}</span>
          <span><b>{c.b2b.bought}</b> bought from the market · {usd(c.b2b.spentUsd)}</span>
          <span className="cx3-faint">B2B, counted apart from the sales above.</span>
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
