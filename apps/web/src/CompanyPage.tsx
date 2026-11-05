import { memo, useCallback, useEffect, useMemo, useState } from "react";
import AnimatedList from "./rb/AnimatedList";
import DecryptedText from "./rb/DecryptedText";
import ElectricBorder from "./rb/ElectricBorder";
import SloshGauge from "./rb/SloshGauge";
import StarBorder from "./rb/StarBorder";
import { PxButton, PxHero, PxNum, PxPanel, PxStat, PxStats, PxTag } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { useImdUsd } from "./price";
import { safeHref } from "./safe";
import { type CompanyFull, type Health, type JournalView, type Policy, type TaskView, ago, api, events, fromUsdc, short, until, usd } from "./api";
import { Link } from "./router";
import { useSession } from "./session";
import { FundCard } from "./FundCard";
import { FlightDrawer } from "./FlightRecorder";
import { CoFrog, HeroDots, Usd, useRich } from "./Home";
import "./saas/pages/companies.css";

const ACTIVE = ["checking", "ordering", "building"];
const KIND_LABEL: Record<string, string> = {
  research: "Research", build_product: "New product", build_site: "Website", improve_site: "Site change", marketing: "Marketing", reprice: "Pricing", retire_product: "Retire", post: "Post",
};

/** A status as a pixel tag colour: lime when it shipped, IMD blue while the swarm works, gold when it waits for the owner. */
export function statusTone(s: string): "lime" | "gold" | "imd" | "red" | "dim" | undefined {
  if (["done", "live", "active", "posted", "ok"].includes(s)) return "lime";
  if (["checking", "ordering", "building"].includes(s)) return "imd";
  if (s === "awaiting_approval" || s === "approval") return "gold";
  if (["failed", "rejected", "error"].includes(s)) return "red";
  if (["paused", "retired"].includes(s)) return "dim";
  return undefined;
}

/** The owner's price for a product: click, type, Enter. The CEO keeps it from then on. */
function PriceCell({ id, productId, usdc, byOwner, onSaved }: { id: string; productId: string; usdc: string; byOwner: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const v = Number(edit);
    try { await api.price(id, productId, v); setEdit(null); setErr(null); onSaved(); } catch (e) { setErr((e as Error).message); }
  };
  if (edit === null) return <button className="cx3-price" title={byOwner ? "Your price. Click to change it" : "Set your own price"} onClick={() => setEdit(String(fromUsdc(usdc)))}>{usd(fromUsdc(usdc))} <span aria-hidden="true">✎</span></button>;
  return (
    <form className="cx3-price-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <span>$</span><input className="field" type="number" min="0.5" max="500" step="0.01" value={edit} onChange={(e) => setEdit(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Escape") setEdit(null); }} aria-label="Price in USD" />
      <button className="px-btn small" type="submit">SAVE</button>
      {err && <span className="cx3-bad">{err}</span>}
    </form>
  );
}

/** Visits as a line, revenue as bars: flat pixels, no gloss. */
function Chart({ points }: { points: { t: number; visits: number; revenue: number }[] }) {
  const W = 600;
  const H = 150;
  const maxV = Math.max(1, ...points.map((p) => p.visits));
  const maxR = Math.max(1, ...points.map((p) => p.revenue));
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * W;
  const area = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${(H - 8 - (p.visits / maxV) * (H - 24)).toFixed(1)}`).join(" ");
  const bw = W / points.length;
  return (
    <svg className="cx3-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Visits and revenue">
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(184,255,61,.08)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />)}
      {points.map((p, i) => p.revenue > 0 && (
        <rect key={i} x={i * bw + bw * 0.2} width={bw * 0.6} y={H - 8 - (p.revenue / maxR) * (H - 24)} height={(p.revenue / maxR) * (H - 24)} fill="#b8ff3d" opacity=".9" />
      ))}
      <path d={`${area} L${W},${H} L0,${H} Z`} fill="rgba(87,217,123,.1)" />
      <path d={area} fill="none" stroke="#57d97b" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Now({ t }: { t: TaskView }) {
  const plan = t.imd?.plan ?? [];
  const total = t.stepsTotal || plan.length || 1;
  return (
    <div className="cx3-now">
      <div className="cx3-now-tags">
        <PxTag>{KIND_LABEL[t.kind] ?? t.kind} · shift {t.cycle}</PxTag>
        <PxTag tone={statusTone(t.status)}>{t.status.replace(/_/g, " ")}</PxTag>
      </div>
      <h3 className="cx3-now-t">{t.title}</h3>
      <p className="cx3-now-why">{t.why}</p>
      <div className="cx3-steps" role="img" aria-label={`${t.stepsDone} of ${total} steps done`}>{Array.from({ length: total }, (_, i) => <i key={i} className={i < t.stepsDone ? "on" : i === t.stepsDone && t.status === "building" ? "cur" : ""} />)}</div>
      {plan.length > 0 && <ol className="cx3-plan">{plan.map((s, i) => <li key={i} className={i < t.stepsDone ? "on" : ""}>{s}</li>)}</ol>}
      {t.activity && <div className="cx3-co-now"><span className="cx3-spin" aria-hidden="true" /><span>{t.activity}</span></div>}
      <div className="cx3-receipt">
        {t.imd?.orderId && <span>order {t.imd.orderId.slice(0, 8)}</span>}
        {t.imd?.jobId && <a className="imd" href={`https://explorer.imd.fun/jobs/${t.imd.jobId}`} target="_blank" rel="noreferrer">job {t.imd.jobId.slice(0, 8)} ↗</a>}
        {t.imd?.txHash && <span>tx {short(t.imd.txHash)}</span>}
        {Number(t.costImd) > 0 && <span className="imd">{Number(t.costImd) / 1e18} IMD</span>}
      </div>
    </div>
  );
}

/** Spent in the last 24 hours against the daily budget, as the engine counts it; a dash when it does not say. */
export function BudgetUse({ today, budget }: { today: number | null | undefined; budget: number }) {
  const known = today != null && Number.isFinite(today);
  const pct = known && budget > 0 ? Math.min(100, Math.max(0, (today! / budget) * 100)) : null;
  const tone = pct == null ? "#b8ff3d" : pct >= 100 ? "#ff6b7d" : pct >= 80 ? "#f2c14e" : "#b8ff3d";
  return (
    <div className="cx3-budget">
      {pct != null && <SloshGauge value={Math.round(pct)} interactive={false} showValue liquidColor={tone} glassColor="#0d1410" width={54} height={88} radius={2} ticks={4} unit="%" ariaLabel="Spent in the last 24 hours, against the daily budget" />}
      <div className="cx3-budget-t">
        <span>SPENT, LAST 24 H</span>
        <b>{known ? usd(today!) : "—"}<i> / {usd(budget)}</i></b>
        <div className="cx3-bar" aria-hidden="true"><i style={{ width: `${pct ?? 0}%`, background: tone }} /></div>
        <small>{pct == null ? "The engine has not reported today's spend yet." : pct >= 100 ? "Today's budget is spent: it rests until it frees up." : "Against the daily budget below."}</small>
      </div>
    </div>
  );
}

function PolicyForm({ c, onSaved }: { c: CompanyFull; onSaved: () => void }) {
  const imdUsd = useImdUsd();
  const job = imdUsd ? imdUsd * 0.5 : null;
  const [p, setP] = useState<Policy>(c.policy);
  const [saved, setSaved] = useState(false);
  useEffect(() => setP(c.policy), [c.policy]);
  const save = async () => { await api.policy(c.id, p); setSaved(true); setTimeout(() => setSaved(false), 1500); onSaved(); };
  return (
    <div className="cx3-policy">
      <div className="cx3-two">
        <label><span>DAILY BUDGET ($)</span><input className="field mono" type="number" min={0} value={p.dailyBudgetUsd} onChange={(e) => setP({ ...p, dailyBudgetUsd: Number(e.target.value) })} /></label>
        <label><span>ASK ME OVER ($)</span><input className="field mono" type="number" min={0} value={p.approvalOverUsd} onChange={(e) => setP({ ...p, approvalOverUsd: Number(e.target.value) })} /></label>
        {job ? <span className={`cx3-hint${p.dailyBudgetUsd < job ? " cx3-bad" : ""}`} style={{ gridColumn: "1 / -1" }}>One swarm job costs about ${job.toFixed(2)} now (0.5 IMD).{p.dailyBudgetUsd < job ? " This daily budget cannot buy any: raise it." : ""}</span> : null}
      </div>
      <div className="cx3-two">
        <label><span>MINUTES BETWEEN SHIFTS</span><input className="field mono" type="number" min={1} value={p.shiftMinutes} onChange={(e) => setP({ ...p, shiftMinutes: Number(e.target.value) })} /></label>
        <label className="cx3-toggle"><input type="checkbox" checked={p.autopilot} onChange={(e) => setP({ ...p, autopilot: e.target.checked })} /> Autopilot</label>
      </div>
      <button className="px-btn" onClick={save}>{saved ? "SAVED" : "SAVE LIMITS"}</button>
    </div>
  );
}

const TAG: Record<string, string> = { plan: "PLAN", decision: "DECIDE", result: "RESULT", sale: "SALE", note: "NOTE", warning: "WARN" };
/** The CEO's log as a terminal: newest first, each line with its kind. Memoised so the second ticker does not replay it. */
const Journal = memo(function Journal({ journal }: { journal: JournalView[] }) {
  const items = useMemo(() => [...journal].reverse().map((j, i) => ({ id: `${j.at}-${i}`, j })), [journal]);
  if (items.length === 0) return <p className="cx3-term-empty">The CEO writes here every shift.</p>;
  return (
    <AnimatedList
      items={items.map((x) => ({ id: x.id, title: x.j.text }))}
      renderItem={(_, i) => { const j = items[i]!.j; return <div className={`cx3-jl k-${j.kind}`}><span className="cx3-jl-k">{TAG[j.kind] ?? j.kind.toUpperCase()}</span><span className="cx3-jl-t">{j.text}</span><span className="cx3-jl-w">{ago(j.at)}</span></div>; }}
      className="cx3-term" showGradients={false} displayScrollbar maxHeight={520} frame={false} theme="dark" accentColor="#b8ff3d" radius={2} gap={2} width="100%" animation="fade" stagger={0.02} animateOnce enableArrowNavigation={false} selectOnHover={false}
    />
  );
});

export function CompanyPage({ id, health }: { id: string; health: Health | null }) {
  const [c, setC] = useState<CompanyFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const [rec, setRec] = useState<string | null>(null);
  const rich = useRich();
  const load = useCallback(() => api.company(id).then(setC).catch((e) => setErr((e as Error).message)), [id]);

  useEffect(() => {
    load();
    let pending: ReturnType<typeof setTimeout> | null = null;
    const off = events(() => { if (!pending) pending = setTimeout(() => { pending = null; load(); }, 300); }, id);
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => { off(); clearInterval(t); if (pending) clearTimeout(pending); };
  }, [id, load]);

  const { address, signIn } = useSession();
  useEffect(() => { if (address) load(); }, [address, load]);
  if (err && !c) return (
    <div className="cx3 cx3-cop">
      <div className="cx3-gate">
        <img src="/brand/pepe-operator.svg" alt="" width={56} height={56} />
        <PxPanel title="COMPANY" state="warn" right={`/co/${id.slice(0, 8)}`}>
          <p className="cx3-gate-p"><span>root@nightshift:~$</span> open --company</p>
          <p className="cx3-gate-m">{err}</p>
          <div className="px-cta-row">
            {!address && <StarBorder className="cx3-star" onClick={signIn} color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)"><PxIcon name="wallet" size={14} />SIGN IN</StarBorder>}
            <Link to="/" className="px-btn ghost">BACK</Link>
          </div>
        </PxPanel>
      </div>
    </div>
  );
  if (!c) return <div className="cx3 cx3-cop"><div className="cx3-gate"><PxPanel title="COMPANY" state="idle"><p className="cx3-gate-p"><span>root@nightshift:~$</span> open --company <i className="cx3-cursor" aria-hidden="true" /></p><p className="cx3-gate-m">Loading…</p></PxPanel></div></div>;

  const current = [...c.tasks].reverse().find((t) => ACTIVE.includes(t.status));
  const waiting = c.tasks.filter((t) => t.status === "awaiting_approval");
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await load(); } catch (e) { alert((e as Error).message); } finally { setBusy(false); } };
  // the engine reports what the last 24 hours spent against the budget; an older engine does not, and the page says so
  const today = (c as CompanyFull & { todayUsd?: number }).todayUsd;

  const asks = (
    <div className="cx3-wait">
      <header><PxIcon name="lock" size={13} /><b>WAITING FOR YOUR APPROVAL</b><span>{waiting.length} over your limit · nothing is spent until you say so</span></header>
      {waiting.map((t) => (
        <div key={t.id} className="cx3-wait-row">
          <div><b>{t.title}</b><span>{t.activity}</span></div>
          <div className="cx3-row">
            <button className="px-btn danger" disabled={busy} onClick={() => act(() => api.reject(c.id, t.id))}>Decline</button>
            <button className="px-btn primary" disabled={busy} onClick={() => act(() => api.approve(c.id, t.id))}>Approve & buy</button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="cx3 cx3-cop">
      <PxHero
        kicker={`COMPANY · SHIFT ${c.cycle}${c.status === "active" ? "" : " · PAUSED"}`}
        live={c.status === "active"}
        title={c.name}
        bg={rich ? <HeroDots /> : undefined}
        lead={c.mission}
        actions={<>
          <StarBorder className="cx3-star" disabled={busy || c.status !== "active" || Boolean(current)} onClick={() => act(() => api.shift(c.id))} color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)">
            <PxIcon name="play" size={14} />{current ? "WORKING…" : "RUN A SHIFT NOW"}
          </StarBorder>
          {c.status === "active"
            ? <button className="px-btn" disabled={busy} onClick={() => act(() => api.pause(c.id))}>Pause</button>
            : <button className="px-btn" disabled={busy} onClick={() => act(() => api.resume(c.id))}>Resume</button>}
          <Link to={`/my?edit=${c.id}`} className="px-btn ghost"><PxIcon name="doc" size={13} />Edit</Link>
          <Link to={`/c/${c.slug}`} className="px-btn ghost"><PxIcon name="market" size={13} />Public page</Link>
          {c.site && <a className="px-btn ghost" href={safeHref(c.site.url)} target="_blank" rel="noreferrer">Site ↗</a>}
          {c.siteBackup && <a className="px-btn ghost" href={safeHref(c.siteBackup)} target="_blank" rel="noreferrer" title="Backup link (if the site does not open)">Backup ↗</a>}
          <Link to="/my" className="px-btn ghost">All my companies</Link>
        </>}
        aside={
          <PxPanel title="COMPANY FILE" state={c.status === "active" ? "live" : "idle"} right={`#${c.slug}`} className="cx3-file">
            <div className="cx3-file-top">
              <CoFrog k={c.slug} size={76} />
              <dl>
                <div><dt>STATUS</dt><dd><PxTag tone={statusTone(c.status)}>{c.status}</PxTag></dd></div>
                <div><dt>FOR</dt><dd>{c.audience}</dd></div>
                <div><dt>SHIFT</dt><dd className="cx3-mono">shift {c.cycle} · next {c.status === "active" ? until(c.nextShiftAt) : "paused"}</dd></div>
                <div><dt>WALLET</dt><dd className="cx3-mono" title="The company's own wallet">wallet {short(c.wallet)}</dd></div>
              </dl>
            </div>
            <p className="cx3-file-f"><span>root@nightshift:~$</span> tail -f /co/{c.slug}<i className="cx3-cursor" aria-hidden="true" /></p>
          </PxPanel>
        }
      />

      <div className="cx3-kpis">
        <PxStats cols={6}>
          <PxStat label="Revenue" tone="lime" value={<Usd value={c.pnl.revenueUsd} />} sub="USDC from sales" />
          <PxStat label="Spent" value={<Usd value={c.pnl.spentUsd} />} sub="on the IMD swarm" />
          <PxStat label="Profit" tone={c.pnl.profitUsd >= 0 ? "lime" : "red"} value={<Usd value={c.pnl.profitUsd} />} />
          <PxStat label="IMD left" tone="imd" value={<PxNum value={c.pnl.imdBalance} decimals={2} />} sub="for swarm jobs" />
          <PxStat label="Visits 7d" value={<PxNum value={c.stats.visits7d} />} />
          <PxStat label="Sales 7d" value={<PxNum value={c.stats.sales7d} />} />
        </PxStats>
      </div>

      {waiting.length > 0 && (rich
        ? <ElectricBorder className="cx3-electric" color="#ff6b7d" speed={0.8} chaos={0.5} thickness={1.5} borderRadius={2} theme="dark">{asks}</ElectricBorder>
        : asks)}

      <div className="cx3-cogrid">
        <div className="cx3-col">
          {c.direction && (
            <PxPanel title="YOUR DIRECTION TO THE CEO" right={<Link to={`/my?edit=${c.id}`} className="cx3-link">Change it</Link>}>
              <p className="cx3-dir">{c.direction}</p>
            </PxPanel>
          )}
          {current ? (
            <PxPanel title={`NOW · SHIFT ${current.cycle}`} state="live">
              <Now t={current} />
              <button className="px-btn ghost cx3-fr-open" onClick={() => setRec(current.id)}><PxIcon name="pulse" size={13} />Open this shift's flight record</button>
            </PxPanel>
          ) : (
            <PxPanel title="BETWEEN SHIFTS" state="idle">
              <div className="cx3-now">
                <h3 className="cx3-now-t">Between shifts</h3>
                <p className="cx3-now-why">{c.status === "active" ? `The CEO decides its next move ${until(c.nextShiftAt)}.` : "Paused. Nothing runs and nothing is spent."}</p>
              </div>
            </PxPanel>
          )}

          {health?.mode === "live" && c.isOwner && <FundCard id={c.id} wallet={c.wallet as `0x${string}`} first={c.cycle === 0} onFunded={() => { void api.shift(c.id).catch(() => {}).then(load); }} />}

          <PxPanel title="TRAFFIC AND REVENUE" right={`${c.series.bucketMs === 60_000 ? "per minute" : "per hour"} · ${health?.mode === "sim" ? "simulated" : "live"}`}>
            <div className="cx3-legend" aria-hidden="true"><span className="rev">REVENUE</span><span className="vis">VISITS</span></div>
            <Chart points={c.series.points} />
          </PxPanel>

          <PxPanel title="PRODUCTS" right="sold through x402 · USDC" className="cx3-tbl">
            {c.products.length === 0 ? <p className="cx3-term-empty">The first product is on the way.</p> : (
              <div className="cx3-scroll">
                <table className="cx3-products">
                  <thead><tr><th>Product</th><th>Status</th><th className="r">Price</th><th className="r">Sales</th><th className="r">Revenue</th></tr></thead>
                  <tbody>
                    {c.products.map((p) => (
                      <tr key={p.id}>
                        <td><b>{p.name}</b><div className="cx3-sub">{p.pitch}</div><div className="cx3-links">{p.status === "live" && <a href={`/api/companies/${c.id}/products/${p.id}/download`} target="_blank" rel="noreferrer">what buyers get ↗</a>}{p.deliverableUrl && <a className="imd" href={p.deliverableUrl} target="_blank" rel="noreferrer">swarm source ↗</a>}{p.siteBackup && <a href={safeHref(p.siteBackup)} target="_blank" rel="noreferrer">Backup link (if the site does not open) ↗</a>}</div></td>
                        <td><PxTag tone={statusTone(p.status)}>{p.status}</PxTag></td>
                        <td className="r">{c.isOwner && p.status !== "retired" ? <PriceCell id={c.id} productId={p.id} usdc={p.priceUsdc} byOwner={Boolean(p.priceByOwner)} onSaved={load} /> : usd(fromUsdc(p.priceUsdc))}</td>
                        <td className="r cx3-mono">{p.sales}</td>
                        <td className="r cx3-mono lime">{usd(fromUsdc(p.revenueUsdc))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PxPanel>

          <PxPanel title="EVERY SHIFT" right="open one to replay it" className="cx3-tbl">
            <div className="cx3-scroll">
              <table className="cx3-shifts">
                <thead><tr><th>#</th><th>Move</th><th>Status</th><th className="r">Cost</th></tr></thead>
                <tbody>
                  {[...c.tasks].reverse().slice(0, 20).map((t) => (
                    <tr key={t.id}>
                      <td className="cx3-mono cx3-faint">{t.cycle}</td>
                      <td><button className="cx3-fr" onClick={() => setRec(t.id)}><b>{t.title}</b></button><div className="cx3-sub">{t.error ?? t.result?.note ?? t.why}</div></td>
                      <td><PxTag tone={statusTone(t.status)}>{t.status.replace(/_/g, " ")}</PxTag></td>
                      <td className={`r cx3-mono${Number(t.costImd) > 0 ? " cx3-imd" : " cx3-faint"}`}>{Number(t.costImd) > 0 ? `${Number(t.costImd) / 1e18} IMD` : "free"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PxPanel>
        </div>

        <div className="cx3-col">
          <PxPanel title="THE CEO'S LOG" state="live" right="tail -f" className="cx3-log">
            <Journal journal={c.journal} />
          </PxPanel>
          <PxPanel title="LIMITS">
            <BudgetUse today={today} budget={c.policy.dailyBudgetUsd} />
            <PolicyForm c={c} onSaved={load} />
          </PxPanel>
          <PxPanel title="TREASURY" right={<span className="lime cx3-mono">{usd(c.withdrawableUsd)} available</span>}>
            <div className="cx3-treasury">
              <div className="cx3-wallet"><span>COMPANY WALLET</span><code><DecryptedText text={c.wallet} animateOn="view" sequential speed={18} characters="0123456789abcdef" /></code></div>
              <button className="px-btn primary" disabled={busy || c.withdrawableUsd <= 0 || (health?.requireAuth && !c.isOwner)} onClick={() => {
                if (!confirm(`Withdraw ${usd(c.withdrawableUsd)} of revenue to ${address ?? "your wallet"}?${health?.platformFeeBps ? ` A ${(health.platformFeeBps / 100).toFixed(2)}% platform fee applies.` : ""}`)) return;
                void act(() => api.withdraw(c.id));
              }}>Withdraw revenue</button>
              {health?.mode === "live" && c.isOwner && <button className="px-btn danger" disabled={busy} onClick={() => {
                if (!confirm("Stop this company and send everything back to your wallet?\n\nIt pauses, withdraws its revenue (platform fee applies), then returns every IMD, USDC and ETH left in its wallet, on Ethereum and Base. Gas comes out of the ETH returned.")) return;
                void act(async () => { const r = await api.closeOut(c.id); alert(`Returned: ${r.returned.join(", ") || "nothing was left"}.`); });
              }}>Stop and withdraw everything</button>}
              {c.holder && <p className={`cx3-hint${c.holder.holds ? " lime" : ""}`}>{c.holder.holds ? `${c.holder.symbol} holder: no platform fee, products featured in the market.` : `Hold ${c.holder.min.toLocaleString()} ${c.holder.symbol} to pay no platform fee and get featured (you hold ${c.holder.balance.toLocaleString()}).`}</p>}
              <p className="cx3-hint">Revenue lands here in USDC. IMD for the swarm is paid from here. {health?.mode === "sim" ? "In simulation it starts with 20 simulated IMD." : "It is funded from your wallet with the Fund button: IMD and a little ETH."}</p>
            </div>
          </PxPanel>
          <PostsCard c={c} />
        </div>
      </div>
      {rec && <FlightDrawer key={rec} load={() => api.flight(c.id, rec)} onClose={() => setRec(null)} />}
    </div>
  );
}

/**
 * Where the company talks to people: the posts it wrote for the owner's connected channels (each about
 * a real event, with the AI disclosure), and drafts from before any channel was connected. Accounts are
 * connected, and posts approved, on the owner desk's Connections tab.
 */
function PostsCard({ c }: { c: CompanyFull }) {
  const x = c.connections;
  const on = Object.values(x?.channels ?? {}).filter(Boolean);
  const posts = [...(x?.posts ?? [])].reverse().slice(0, 8);
  const drafts = c.marketing.slice(-5).reverse();
  return (
    <PxPanel title="POSTS" right={on.length ? <PxTag tone="lime">{on.map((ch) => ch!.label).join(" · ")}</PxTag> : "no channel connected"}>
      <div className="cx3-posts-h">
        <span>{on.length ? "Posts about real events, each saying an AI agent wrote it. The first one on each channel waits for you." : "Connect your own Bluesky, Telegram channel, Mastodon or Discord to post, and Gumroad to sell, from the owner desk."}</span>
        <PxButton to={`/my?edit=${c.id}&tab=connections`} kind="ghost" icon="link">Connections</PxButton>
      </div>
      {posts.length > 0 ? (
        <ul className="cx3-lines">{posts.map((p) => (
          <li key={p.id}><span className="cx3-lines-w">{ago(p.sentAt ?? p.at)}</span><span>{p.text}{" "}
            <PxTag tone={p.status === "posted" ? "lime" : p.status === "failed" || p.status === "rejected" ? "red" : p.status === "approval" ? "gold" : undefined}>{p.sim ? "simulated" : p.status === "approval" ? "waiting for you" : p.status}</PxTag>
            {p.url && <> <a className="cx3-link" href={safeHref(p.url)} target="_blank" rel="noreferrer">view ↗</a></>}
            {p.error && <span className="cx3-bad cx3-block">{p.error}</span>}
          </span></li>
        ))}</ul>
      ) : drafts.length > 0 && (
        <ul className="cx3-lines">{drafts.map((m, i) => (
          <li key={i}><span className="cx3-lines-w">{ago(m.at)}</span><span>{m.text} <PxTag>draft</PxTag></span></li>
        ))}</ul>
      )}
    </PxPanel>
  );
}
