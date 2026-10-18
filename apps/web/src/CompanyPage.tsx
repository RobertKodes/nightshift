import { useCallback, useEffect, useState } from "react";
import { useImdUsd } from "./price";
import { safeHref } from "./safe";
import { type CompanyFull, type Health, type Policy, type TaskView, ago, api, events, fromUsdc, short, until, usd } from "./api";
import { Link } from "./router";
import { useSession } from "./session";
import { FundCard } from "./FundCard";

const ACTIVE = ["checking", "ordering", "building"];
const KIND_LABEL: Record<string, string> = {
  research: "Research", build_product: "New product", build_site: "Website", improve_site: "Site change", marketing: "Marketing", reprice: "Pricing", retire_product: "Retire",
};

/** The owner's price for a product: click, type, Enter. The CEO keeps it from then on. */
function PriceCell({ id, productId, usdc, byOwner, onSaved }: { id: string; productId: string; usdc: string; byOwner: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const v = Number(edit);
    try { await api.price(id, productId, v); setEdit(null); setErr(null); onSaved(); } catch (e) { setErr((e as Error).message); }
  };
  if (edit === null) return <button className="price-edit" title={byOwner ? "Your price. Click to change it" : "Set your own price"} onClick={() => setEdit(String(fromUsdc(usdc)))}>{usd(fromUsdc(usdc))} <span className="faint">✎</span></button>;
  return (
    <form className="price-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <span>$</span><input className="field" type="number" min="0.5" max="500" step="0.01" value={edit} onChange={(e) => setEdit(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Escape") setEdit(null); }} />
      <button className="btn" type="submit">Save</button>
      {err && <span className="bad" style={{ fontSize: 12 }}>{err}</span>}
    </form>
  );
}

function Chart({ points }: { points: { t: number; visits: number; revenue: number }[] }) {
  const W = 600;
  const H = 150;
  const maxV = Math.max(1, ...points.map((p) => p.visits));
  const maxR = Math.max(1, ...points.map((p) => p.revenue));
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * W;
  const area = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${(H - 8 - (p.visits / maxV) * (H - 24)).toFixed(1)}`).join(" ");
  const bw = W / points.length;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Visits and revenue">
      <defs>
        <linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7aa7ff" stopOpacity=".35" /><stop offset="1" stopColor="#7aa7ff" stopOpacity="0" /></linearGradient>
      </defs>
      {points.map((p, i) => p.revenue > 0 && (
        <rect key={i} x={i * bw + bw * 0.2} width={bw * 0.6} y={H - 8 - (p.revenue / maxR) * (H - 24)} height={(p.revenue / maxR) * (H - 24)} fill="#c9f27c" opacity=".85" rx="2" />
      ))}
      <path d={`${area} L${W},${H} L0,${H} Z`} fill="url(#v)" />
      <path d={area} fill="none" stroke="#7aa7ff" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Now({ t }: { t: TaskView }) {
  const plan = t.imd?.plan ?? [];
  const total = t.stepsTotal || plan.length || 1;
  return (
    <div className="card now">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <span className="pill">{KIND_LABEL[t.kind] ?? t.kind} · shift {t.cycle}</span>
        <span className={`pill ${t.status}`}>{t.status.replace(/_/g, " ")}</span>
      </div>
      <div className="now-title">{t.title}</div>
      <div className="now-why">{t.why}</div>
      <div className="steps">{Array.from({ length: total }, (_, i) => <i key={i} className={i < t.stepsDone ? "on" : i === t.stepsDone && t.status === "building" ? "cur" : ""} />)}</div>
      {plan.length > 0 && <ol className="plan">{plan.map((s, i) => <li key={i} className={i < t.stepsDone ? "on" : ""}>{s}</li>)}</ol>}
      {t.activity && <div className="working"><span className="spin" />{t.activity}</div>}
      <div className="receipt">
        {t.imd?.orderId && <span>order {t.imd.orderId.slice(0, 8)}</span>}
        {t.imd?.jobId && <a href={`https://explorer.imd.fun/jobs/${t.imd.jobId}`} target="_blank" rel="noreferrer">job {t.imd.jobId.slice(0, 8)} ↗</a>}
        {t.imd?.txHash && <span>tx {short(t.imd.txHash)}</span>}
        {Number(t.costImd) > 0 && <span>{Number(t.costImd) / 1e18} IMD</span>}
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
    <div className="policy">
      <div className="two">
        <label>Daily budget ($)<input className="field mono" type="number" min={0} value={p.dailyBudgetUsd} onChange={(e) => setP({ ...p, dailyBudgetUsd: Number(e.target.value) })} /></label>
        <label>Ask me over ($)<input className="field mono" type="number" min={0} value={p.approvalOverUsd} onChange={(e) => setP({ ...p, approvalOverUsd: Number(e.target.value) })} /></label>
        {job ? <span className={p.dailyBudgetUsd < job ? "bad" : "dim"} style={{ fontSize: 12, gridColumn: "1 / -1" }}>One swarm job costs about ${job.toFixed(2)} now (0.5 IMD).{p.dailyBudgetUsd < job ? " This daily budget cannot buy any: raise it." : ""}</span> : null}
      </div>
      <div className="two">
        <label>Minutes between shifts<input className="field mono" type="number" min={1} value={p.shiftMinutes} onChange={(e) => setP({ ...p, shiftMinutes: Number(e.target.value) })} /></label>
        <label className="toggle"><input type="checkbox" checked={p.autopilot} onChange={(e) => setP({ ...p, autopilot: e.target.checked })} /> Autopilot</label>
      </div>
      <button className="btn" onClick={save}>{saved ? "Saved" : "Save limits"}</button>
    </div>
  );
}

export function CompanyPage({ id, health }: { id: string; health: Health | null }) {
  const [c, setC] = useState<CompanyFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
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
  if (err && !c) return <div className="card empty">{err} {!address && <button className="btn primary" style={{ marginLeft: 8 }} onClick={signIn}>Sign in</button>} · <Link to="/">back</Link></div>;
  if (!c) return <div className="card empty">Loading…</div>;

  const current = [...c.tasks].reverse().find((t) => ACTIVE.includes(t.status));
  const waiting = c.tasks.filter((t) => t.status === "awaiting_approval");
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await load(); } catch (e) { alert((e as Error).message); } finally { setBusy(false); } };

  return (
    <>
      <div className="co-top">
        <div>
          <h1>{c.name}</h1>
          <p className="mission">{c.mission}</p>
          <div className="meta">
            <span className={`pill ${c.status}`}>{c.status}</span>
            <span>for {c.audience}</span>
            <span>shift {c.cycle} · next {c.status === "active" ? until(c.nextShiftAt) : "paused"}</span>
            <span title="The company's own wallet">wallet {short(c.wallet)}</span>
          </div>
        </div>
        <div className="co-actions">
          <Link to={`/c/${c.slug}`} className="btn ghost">Public page</Link>
          {c.site && <a className="btn ghost" href={safeHref(c.site.url)} target="_blank" rel="noreferrer">Site ↗</a>}
          {c.status === "active"
            ? <button className="btn" disabled={busy} onClick={() => act(() => api.pause(c.id))}>Pause</button>
            : <button className="btn" disabled={busy} onClick={() => act(() => api.resume(c.id))}>Resume</button>}
          <button className="btn primary" disabled={busy || c.status !== "active" || Boolean(current)} onClick={() => act(() => api.shift(c.id))}>
            {current ? "Working…" : "Run a shift now"}
          </button>
        </div>
      </div>

      <div className="grid kpis">
        <div className="card kpi"><span>Revenue</span><b className="good">{usd(c.pnl.revenueUsd)}</b></div>
        <div className="card kpi"><span>Spent</span><b>{usd(c.pnl.spentUsd)}</b></div>
        <div className="card kpi"><span>Profit</span><b className={c.pnl.profitUsd >= 0 ? "good" : "bad"}>{usd(c.pnl.profitUsd)}</b></div>
        <div className="card kpi"><span>IMD left</span><b>{c.pnl.imdBalance.toFixed(2)}</b></div>
        <div className="card kpi"><span>Visits 7d</span><b>{c.stats.visits7d}</b></div>
        <div className="card kpi"><span>Sales 7d</span><b>{c.stats.sales7d}</b></div>
      </div>

      {waiting.map((t) => (
        <div key={t.id} className="card approval" style={{ marginBottom: 16 }}>
          <div><b>Waiting for your approval:</b> {t.title}<div className="dim" style={{ fontSize: 13 }}>{t.activity}</div></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn danger" disabled={busy} onClick={() => act(() => api.reject(c.id, t.id))}>Decline</button>
            <button className="btn primary" disabled={busy} onClick={() => act(() => api.approve(c.id, t.id))}>Approve & buy</button>
          </div>
        </div>
      ))}

      <div className="grid layout">
        <div className="grid">
          {current ? <Now t={current} /> : (
            <div className="card now">
              <div className="now-title">Between shifts</div>
              <div className="now-why">{c.status === "active" ? `The CEO decides its next move ${until(c.nextShiftAt)}.` : "Paused. Nothing runs and nothing is spent."}</div>
            </div>
          )}

          {health?.mode === "live" && c.isOwner && <FundCard id={c.id} wallet={c.wallet as `0x${string}`} first={c.cycle === 0} onFunded={() => { void api.shift(c.id).catch(() => {}).then(load); }} />}

          <div className="card">
            <div className="card-h"><h3>Traffic and revenue</h3><span className="faint mono" style={{ fontSize: 11 }}>{c.series.bucketMs === 60_000 ? "per minute" : "per hour"} · {health?.mode === "sim" ? "simulated" : "live"}</span></div>
            <div className="card-b"><Chart points={c.series.points} /></div>
          </div>

          <div className="card">
            <div className="card-h"><h3>Products</h3><span className="faint mono" style={{ fontSize: 11 }}>sold through x402 · USDC</span></div>
            {c.products.length === 0 ? <div className="empty">The first product is on the way.</div> : (
              <table className="t-products">
                <thead><tr><th>Product</th><th>Status</th><th className="r">Price</th><th className="r">Sales</th><th className="r">Revenue</th></tr></thead>
                <tbody>
                  {c.products.map((p) => (
                    <tr key={p.id}>
                      <td><b>{p.name}</b><div className="dim" style={{ fontSize: 12.5 }}>{p.pitch}</div>{p.status === "live" && <a className="faint mono" style={{ fontSize: 11 }} href={`/api/companies/${c.id}/products/${p.id}/download`} target="_blank" rel="noreferrer">what buyers get ↗</a>}{p.deliverableUrl && <a className="faint mono" style={{ fontSize: 11, marginLeft: 12 }} href={p.deliverableUrl} target="_blank" rel="noreferrer">swarm source ↗</a>}</td>
                      <td><span className={`pill ${p.status}`}>{p.status}</span></td>
                      <td className="r">{c.isOwner && p.status !== "retired" ? <PriceCell id={c.id} productId={p.id} usdc={p.priceUsdc} byOwner={Boolean(p.priceByOwner)} onSaved={load} /> : usd(fromUsdc(p.priceUsdc))}</td>
                      <td className="r">{p.sales}</td>
                      <td className="r good">{usd(fromUsdc(p.revenueUsdc))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="card-h"><h3>Every shift</h3></div>
            <table className="t-shifts">
              <thead><tr><th>#</th><th>Move</th><th>Status</th><th className="r">Cost</th></tr></thead>
              <tbody>
                {[...c.tasks].reverse().slice(0, 20).map((t) => (
                  <tr key={t.id}>
                    <td className="mono faint">{t.cycle}</td>
                    <td><b>{t.title}</b><div className="dim" style={{ fontSize: 12.5 }}>{t.error ?? t.result?.note ?? t.why}</div></td>
                    <td><span className={`pill ${t.status}`}>{t.status.replace(/_/g, " ")}</span></td>
                    <td className="r">{Number(t.costImd) > 0 ? `${Number(t.costImd) / 1e18} IMD` : "free"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="card-h"><h3>The CEO's log</h3><span className="pill live">live</span></div>
            <ul className="journal">
              {[...c.journal].reverse().map((j, i) => (
                <li key={i}><span className="when">{ago(j.at)}</span><span className={j.kind}>{j.text}</span></li>
              ))}
            </ul>
          </div>
          <div className="card">
            <div className="card-h"><h3>Limits</h3></div>
            <div className="card-b"><PolicyForm c={c} onSaved={load} /></div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Treasury</h3><span className="good mono">{usd(c.withdrawableUsd)} available</span></div>
            <div className="card-b" style={{ display: "grid", gap: 8 }}>
              <div className="wallet">{c.wallet}</div>
              <button className="btn primary" disabled={busy || c.withdrawableUsd <= 0 || (health?.requireAuth && !c.isOwner)} onClick={() => {
                if (!confirm(`Withdraw ${usd(c.withdrawableUsd)} of revenue to ${address ?? "your wallet"}?${health?.platformFeeBps ? ` A ${(health.platformFeeBps / 100).toFixed(2)}% platform fee applies.` : ""}`)) return;
                void act(() => api.withdraw(c.id));
              }}>Withdraw revenue</button>
              {health?.mode === "live" && c.isOwner && <button className="btn danger" disabled={busy} onClick={() => {
                if (!confirm("Stop this company and send everything back to your wallet?\n\nIt pauses, withdraws its revenue (platform fee applies), then returns every IMD, USDC and ETH left in its wallet, on Ethereum and Base. Gas comes out of the ETH returned.")) return;
                void act(async () => { const r = await api.closeOut(c.id); alert(`Returned: ${r.returned.join(", ") || "nothing was left"}.`); });
              }}>Stop and withdraw everything</button>}
              {c.holder && <div className={c.holder.holds ? "good" : "dim"} style={{ fontSize: 13 }}>{c.holder.holds ? `${c.holder.symbol} holder: no platform fee, products featured in the market.` : `Hold ${c.holder.min.toLocaleString()} ${c.holder.symbol} to pay no platform fee and get featured (you hold ${c.holder.balance.toLocaleString()}).`}</div>}
              <div className="dim" style={{ fontSize: 13 }}>Revenue lands here in USDC. IMD for the swarm is paid from here. {health?.mode === "sim" ? "In simulation it starts with 20 simulated IMD." : "It is funded from your wallet with the Fund button: IMD and a little ETH."}</div>
            </div>
          </div>
          <PostsCard c={c} busy={busy} act={act} />
        </div>
      </div>
    </>
  );
}

/** Where the company talks to people: drafts, and the owner's Bluesky account that posts them. */
function PostsCard({ c, busy, act }: { c: CompanyFull; busy: boolean; act: (f: () => Promise<unknown>) => Promise<void> }) {
  const [handle, setHandle] = useState("");
  const [pw, setPw] = useState("");
  const [auto, setAuto] = useState(true);
  const b = c.social?.bluesky;
  const posts = c.marketing.map((m, i) => ({ m, i })).reverse();
  return (
    <div className="card">
      <div className="card-h"><h3>Posts</h3>{b ? <span className="pill live">@{b.handle}</span> : <span className="faint" style={{ fontSize: 12 }}>not connected</span>}</div>
      {b ? (
        <div className="card-b dim" style={{ fontSize: 13, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <span>{b.auto ? "New posts go out on their own in live mode." : "Each post waits for you to send it."}</span>
          <button className="btn ghost" disabled={busy} onClick={() => void act(() => api.disconnectBluesky(c.id))}>Disconnect</button>
        </div>
      ) : (
        <form className="card-b social-form" onSubmit={(e) => { e.preventDefault(); void act(() => api.connectBluesky(c.id, handle, pw, auto).then(() => { setPw(""); })); }}>
          <span className="dim" style={{ fontSize: 13 }}>Connect a Bluesky account so the company can tell people it exists. Use an <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noreferrer">app password</a>, not your real one.</span>
          <input className="field" placeholder="you.bsky.social" value={handle} onChange={(e) => setHandle(e.target.value)} />
          <input className="field" type="password" placeholder="xxxx-xxxx-xxxx-xxxx" value={pw} onChange={(e) => setPw(e.target.value)} />
          <label className="dim" style={{ fontSize: 13 }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Post on its own (live mode only)</label>
          <button className="btn" disabled={busy || !handle || !pw}>Connect Bluesky</button>
        </form>
      )}
      {posts.length > 0 && (
        <ul className="journal">{posts.map(({ m, i }) => (
          <li key={i}><span className="when">{ago(m.at)}</span><span>{m.text}{" "}
            <span className={`pill ${m.status === "posted" ? "done" : m.status === "failed" ? "failed" : ""}`}>{m.status}</span>
            {m.url && <> <a className="mono faint" style={{ fontSize: 11 }} href={safeHref(m.url)} target="_blank" rel="noreferrer">view ↗</a></>}
            {m.status !== "posted" && b && <> <button className="btn ghost sm-btn" disabled={busy} onClick={() => void act(() => api.publishPost(c.id, i))}>Post now</button></>}
            {m.error && <div className="bad" style={{ fontSize: 12 }}>{m.error}</div>}
          </span></li>
        ))}</ul>
      )}
    </div>
  );
}
