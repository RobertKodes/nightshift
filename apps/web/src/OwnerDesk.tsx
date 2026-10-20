import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { type Desk, type DeskCompany, type Health, type Policy, ago, api, events, short, until, usd } from "./api";
import { FlightDrawer } from "./FlightRecorder";
import { NxIcon } from "./nx/icons";
import { Link } from "./router";
import { useSession } from "./session";

const STATUS: Record<string, string> = { checking: "Checking with IMD", ordering: "Paying the swarm", building: "The swarm is building", awaiting_approval: "Waiting for you" };

/**
 * The owner desk: every company you run on one screen. What needs you first (approvals, budgets),
 * then each company with its numbers and controls: run, pause, edit, direct the CEO, products,
 * limits, books, delete. Deleted companies wait at the bottom and can be restored.
 */
export function OwnerDesk({ health }: { health: Health | null }) {
  const { address, signIn, busy: signing } = useSession();
  const [d, setD] = useState<Desk | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(() => new URLSearchParams(location.search).get("edit"));
  const [tab, setTab] = useState<Tab>("profile");
  const open = (id: string, t: Tab = "profile") => { setTab(t); setEditing(id); };
  const [rec, setRec] = useState<{ co: string; task: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(() => api.desk().then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => {
    void load();
    let pending: ReturnType<typeof setTimeout> | null = null;
    const off = events(() => { if (!pending) pending = setTimeout(() => { pending = null; void load(); }, 600); });
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => { off(); clearInterval(t); if (pending) clearTimeout(pending); };
  }, [load, address]);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4200); };
  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await fn(); await load(); if (done) say(done); } catch (e) { say((e as Error).message); } finally { setBusy(null); }
  };

  if (!d) {
    return (
      <div className="docs dk">
        <span className="eyebrow">Owner desk</span>
        <h1>Your <em>companies.</em></h1>
        {err ? (
          <div className="dk-empty">
            <p>{err}</p>
            {!address && <button className="nx-btn nx-btn-acc" disabled={signing} onClick={() => void signIn()}><NxIcon name="wallet" size={16} />{signing ? "Check your wallet…" : "Sign in with your wallet"}</button>}
          </div>
        ) : <p className="dim">Opening the desk…</p>}
      </div>
    );
  }

  const cos = d.companies;
  const sum = (f: (c: DeskCompany) => number) => cos.reduce((a, c) => a + f(c), 0);
  const waiting = cos.flatMap((c) => c.waiting.map((w) => ({ c, w })));
  const resting = cos.filter((c) => c.status === "active" && c.rest);
  const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const edit = cos.find((c) => c.id === editing) ?? null;

  return (
    <div className="docs dk">
      <span className="eyebrow">Owner desk{d.mode === "sim" ? " · simulation" : ""}</span>
      <h1>Your <em>companies.</em></h1>
      <p className="lead">Everything you run, on one screen. Approve spending, direct each CEO, edit what it sells, replay any shift, take the books, or close a company down.</p>
      {!d.requireAuth && !address && <p className="dk-note">This engine runs without sign-in, so every company nobody owns is listed here.</p>}

      <div className="dk-sum">
        <span><b>{cos.length}</b>companies</span>
        <span><b>{usd(sum((c) => c.pnl.revenueUsd))}</b>revenue</span>
        <span><b>{usd(sum((c) => c.pnl.spentUsd))}</b>spent on the swarm</span>
        <span className={sum((c) => c.pnl.profitUsd) >= 0 ? "dk-up" : "dk-down"}><b>{usd(sum((c) => c.pnl.profitUsd))}</b>profit</span>
        <span><b>{sum((c) => c.stats.sales7d)}</b>sales, 7 days</span>
        <span><b>{sum((c) => c.products.filter((p) => p.status === "live").length)}</b>products on sale</span>
      </div>

      {(waiting.length > 0 || resting.length > 0) && (
        <section className="dk-needs">
          <h2><NxIcon name="pulse" size={18} /> Needs you</h2>
          {waiting.map(({ c, w }) => (
            <div key={w.id} className="dk-need">
              <div><b>{c.name}</b> wants to buy: {w.title}<span className="dim"> · {w.costUsd > 0 ? usd(w.costUsd) : "0.5 IMD"} · {w.why}</span></div>
              <div className="dk-row">
                <button className="nx-btn" disabled={busy !== null} onClick={() => void act(`no:${w.id}`, () => api.reject(c.id, w.id), "Declined. Nothing was spent.")}>Decline</button>
                <button className="nx-btn nx-btn-acc" disabled={busy !== null} onClick={() => void act(`yes:${w.id}`, () => api.approve(c.id, w.id), "Approved: the swarm is on it.")}>Approve and buy</button>
              </div>
            </div>
          ))}
          {resting.map((c) => c.rest!.why === "budget" ? (
            <div key={c.id} className="dk-need">
              <div><b>{c.name}</b> spent today's budget and rests until {hhmm(c.rest!.until)}.<span className="dim"> Raise the daily budget to keep it working now.</span></div>
              <div className="dk-row"><button className="nx-btn" onClick={() => open(c.id, "limits")}>Change limits</button></div>
            </div>
          ) : (
            <div key={c.id} className="dk-need">
              <div><b>{c.name}</b> found nothing new worth paying for and rests until {hhmm(c.rest!.until)}.<span className="dim"> Point its CEO somewhere new, or run a shift now.</span></div>
              <div className="dk-row">
                <button className="nx-btn" onClick={() => open(c.id, "direction")}>Give a direction</button>
                <button className="nx-btn" disabled={busy !== null} onClick={() => void act(`run:${c.id}`, () => api.shift(c.id), "Shift started.")}>Run a shift now</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {cos.length === 0 ? (
        <div className="dk-empty">
          <p>{d.requireAuth && !d.signedIn ? "Sign in to see the companies you run." : "You do not run a company yet. One sentence is enough to start one."}</p>
          {d.requireAuth && !d.signedIn
            ? <button className="nx-btn nx-btn-acc" disabled={signing} onClick={() => void signIn()}><NxIcon name="wallet" size={16} />Sign in with your wallet</button>
            : <Link to="/launch" className="nx-btn nx-btn-acc"><NxIcon name="founder" size={16} />Launch a company</Link>}
        </div>
      ) : (
        <div className="dk-grid">
          {cos.map((c) => {
            const live = c.products.filter((p) => p.status === "live").length;
            return (
              <article key={c.id} className={`dk-card ${c.status}`}>
                <header>
                  <span className={`dk-dot ${c.working ? "work" : c.status}`} />
                  <h3><Link to={`/co/${c.id}`}>{c.name}</Link></h3>
                  <span className="dk-tag">{c.sim ? "demo" : "live"} · shift {c.cycle}</span>
                </header>
                <p className="dk-mission">{c.mission}</p>
                {c.direction && <p className="dk-dir"><NxIcon name="arrow" size={13} /> {c.direction}</p>}
                <div className="dk-now">
                  {c.working
                    ? <button className="dk-link" onClick={() => setRec({ co: c.id, task: c.working!.id })}><span className="spin" />{STATUS[c.working.status] ?? c.working.status}: {c.working.title}{c.working.activity ? ` · ${c.working.activity}` : ""}</button>
                    : c.status === "paused" ? <span>Paused. No shifts, no spending.</span>
                    : c.rest ? <span>Resting until {hhmm(c.rest.until)} · {c.rest.why === "budget" ? "budget spent" : "nothing new to buy"}</span>
                    : <span>Next shift {until(c.nextShiftAt)}</span>}
                </div>
                <dl className="dk-kpis">
                  <div><dt>Revenue</dt><dd>{usd(c.pnl.revenueUsd)}</dd></div>
                  <div><dt>Spent</dt><dd>{usd(c.pnl.spentUsd)}</dd></div>
                  <div><dt>Profit</dt><dd className={c.pnl.profitUsd >= 0 ? "dk-up" : "dk-down"}>{usd(c.pnl.profitUsd)}</dd></div>
                  <div><dt>Visits 7d</dt><dd>{c.stats.visits7d}</dd></div>
                  <div><dt>Sales 7d</dt><dd>{c.stats.sales7d}</dd></div>
                  <div><dt>On sale</dt><dd>{live}</dd></div>
                </dl>
                {c.last && <button className="dk-last" onClick={() => setRec({ co: c.id, task: c.last!.id })}>Last: shift {c.last.cycle}, {c.last.title} <span className={`dk-st ${c.last.status}`}>{c.last.status.replace(/_/g, " ")}</span> <span className="faint">{ago(c.last.at)}</span></button>}
                <footer className="dk-row">
                  <Link to={`/co/${c.id}`} className="nx-btn">Open</Link>
                  <button className="nx-btn" disabled={busy !== null || c.status !== "active" || Boolean(c.working)} onClick={() => void act(`run:${c.id}`, () => api.shift(c.id), "Shift started.")}><NxIcon name="play" size={15} />{c.working ? "Working" : "Run a shift"}</button>
                  {c.status === "active"
                    ? <button className="nx-btn" disabled={busy !== null} onClick={() => void act(`pause:${c.id}`, () => api.pause(c.id), `${c.name} paused.`)}>Pause</button>
                    : <button className="nx-btn" disabled={busy !== null} onClick={() => void act(`resume:${c.id}`, () => api.resume(c.id), `${c.name} is back on the night shift.`)}>Resume</button>}
                  <button className="nx-btn nx-btn-acc" onClick={() => open(c.id)}><NxIcon name="setup" size={15} />Edit</button>
                </footer>
              </article>
            );
          })}
          <Link to="/launch" className="dk-card dk-new"><NxIcon name="founder" size={28} /><b>Start another company</b><span className="dim">One sentence: what it sells and to whom.</span></Link>
        </div>
      )}

      {d.archived.length > 0 && (
        <section className="dk-archived">
          <h2>Deleted</h2>
          <p className="dim">They do not run or sell. Their buyers' download links still work. Restore one to bring it back, paused.</p>
          {d.archived.map((a) => (
            <div key={a.id} className="dk-need">
              <div><b>{a.name}</b><span className="dim"> · deleted {ago(a.archivedAt)} · {a.products} product{a.products === 1 ? "" : "s"}, {a.sales} sale{a.sales === 1 ? "" : "s"}</span></div>
              <div className="dk-row"><button className="nx-btn" disabled={busy !== null} onClick={() => void act(`restore:${a.id}`, () => api.restore(a.id), `${a.name} restored. It is paused.`)}>Restore</button></div>
            </div>
          ))}
        </section>
      )}

      {edit && <EditDrawer key={edit.id} c={edit} first={tab} live={d.mode === "live"} imdUsd={d.imdUsd} onClose={() => { setEditing(null); if (location.search.includes("edit=")) history.replaceState(null, "", "/my"); }} onSaved={load} say={say} onDeleted={() => { setEditing(null); history.replaceState(null, "", "/my"); void load(); say("Deleted. It waits under Deleted if you change your mind."); }} onReplay={(task) => setRec({ co: edit.id, task })} />}
      {rec && <FlightDrawer key={`${rec.co}:${rec.task}`} load={() => api.flight(rec.co, rec.task)} onClose={() => setRec(null)} />}
      {toast && <div className="toast">{toast}</div>}
      {health?.mode === "sim" && cos.length > 0 && <p className="dk-note">Simulation: money here is pretend. Live companies are funded from your wallet and pay out to it.</p>}
    </div>
  );
}

const TABS = [["profile", "Profile"], ["direction", "Direction"], ["products", "Products"], ["limits", "Limits"], ["books", "Books"], ["delete", "Delete"]] as const;
type Tab = (typeof TABS)[number][0];

const PRESETS = [
  "Focus on one product and make it the best in its niche before starting another.",
  "Keep every price under $15: volume over margin.",
  "No more research for now. Build and sell.",
  "Write for beginners: plain words, step by step, no jargon.",
];

/** Edits one company: who it is, the CEO's direction, its products, its limits; the books; delete. */
function EditDrawer({ c, first, live, imdUsd, onClose, onSaved, onDeleted, onReplay, say }: { c: DeskCompany; first: Tab; live: boolean; imdUsd: number; onClose: () => void; onSaved: () => Promise<void> | void; onDeleted: () => void; onReplay: (task: string) => void; say: (m: string) => void }) {
  const [tab, setTab] = useState<Tab>(first);
  const [p, setP] = useState({ name: c.name, mission: c.mission, audience: c.audience, idea: c.idea });
  const [dir, setDir] = useState(c.direction);
  const [pol, setPol] = useState<Policy>(c.policy);
  const [confirm, setConfirm] = useState("");
  const [sure, setSure] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);

  const save = async (fn: () => Promise<unknown>, done: string) => {
    setSaving(true); setError(null);
    try { await fn(); await onSaved(); say(done); } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  const job = imdUsd * 0.5;

  return createPortal(
    <div className="nx-shell mk-drawer dk-drawer" data-room="geek" style={{ "--acc": "#4ad8ff" } as React.CSSProperties} role="dialog" aria-modal="true" aria-label={`Edit ${c.name}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mk-panel">
        <button className="mk-x" onClick={onClose} aria-label="Close"><NxIcon name="close" size={18} /></button>
        <span className="eyebrow">Edit · {c.sim ? "demo" : "live"} company · wallet {short(c.wallet)}</span>
        <h2>{c.name}</h2>
        <nav className="dk-tabs" role="tablist">
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`${tab === k ? "on" : ""} ${k === "delete" ? "dk-danger" : ""}`} onClick={() => { setTab(k); setError(null); }}>{l}</button>)}
        </nav>
        {error && <p className="warn" style={{ margin: 0 }}>{error}</p>}

        {tab === "profile" && (
          <form className="dk-form" onSubmit={(e) => { e.preventDefault(); void save(() => api.profile(c.id, p), "Profile saved."); }}>
            <label>Name<input className="field" value={p.name} maxLength={40} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
            <label>Mission<span className="dim">the promise to the buyer, in one sentence</span><textarea className="field" rows={2} value={p.mission} maxLength={300} onChange={(e) => setP({ ...p, mission: e.target.value })} /></label>
            <label>Audience<span className="dim">who pays</span><input className="field" value={p.audience} maxLength={120} onChange={(e) => setP({ ...p, audience: e.target.value })} /></label>
            <label>Idea<textarea className="field" rows={3} value={p.idea} maxLength={1000} onChange={(e) => setP({ ...p, idea: e.target.value })} /></label>
            <p className="dim dk-hint">The link stays <code>/c/{c.slug}</code>, so nothing you shared breaks. The CEO reads the new profile at its next shift.</p>
            <button className="nx-btn nx-btn-acc" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
          </form>
        )}

        {tab === "direction" && (
          <form className="dk-form" onSubmit={(e) => { e.preventDefault(); void save(() => api.profile(c.id, { direction: dir }), dir.trim() ? "Direction set. The CEO follows it from the next shift." : "Direction cleared."); }}>
            <p className="dk-hint">Tell the CEO what you want, in plain words. It reads this every shift, and it goes with every order to the IMD swarm, so what gets built follows it too.</p>
            <textarea className="field" rows={5} value={dir} maxLength={500} placeholder="e.g. Only sell to Etsy shop owners. Make everything practical, with templates they can copy." onChange={(e) => setDir(e.target.value)} />
            <div className="dk-presets">{PRESETS.map((x) => <button type="button" key={x} onClick={() => setDir(x)}>{x}</button>)}</div>
            <div className="dk-row">
              <button className="nx-btn nx-btn-acc" disabled={saving}>{saving ? "Saving…" : "Save direction"}</button>
              {c.direction && <button type="button" className="nx-btn" disabled={saving} onClick={() => { setDir(""); void save(() => api.profile(c.id, { direction: "" }), "Direction cleared. The CEO decides on its own again."); }}>Clear it</button>}
              <span className="faint">{dir.length}/500</span>
            </div>
          </form>
        )}

        {tab === "products" && (
          <div className="dk-form">
            {c.products.length === 0 ? <p className="dim">No products yet: the first one is the CEO's first move.</p> : c.products.map((x) => <ProductEdit key={x.id} co={c.id} x={x} saving={saving} save={save} />)}
          </div>
        )}

        {tab === "limits" && (
          <form className="dk-form" onSubmit={(e) => { e.preventDefault(); void save(() => api.policy(c.id, pol), "Limits saved."); }}>
            <div className="dk-two">
              <label>Daily budget ($)<input className="field mono" type="number" min={0} max={10000} step="0.5" value={pol.dailyBudgetUsd} onChange={(e) => setPol({ ...pol, dailyBudgetUsd: Number(e.target.value) })} /></label>
              <label>Ask me over ($)<input className="field mono" type="number" min={0} step="0.5" value={pol.approvalOverUsd} onChange={(e) => setPol({ ...pol, approvalOverUsd: Number(e.target.value) })} /></label>
              <label>Minutes between shifts<input className="field mono" type="number" min={1} max={10080} value={pol.shiftMinutes} onChange={(e) => setPol({ ...pol, shiftMinutes: Number(e.target.value) })} /></label>
              <label className="dk-toggle"><input type="checkbox" checked={pol.autopilot} onChange={(e) => setPol({ ...pol, autopilot: e.target.checked })} /> Autopilot<span className="dim">runs shifts on its own</span></label>
            </div>
            {job > 0 && <p className={`dk-hint ${pol.dailyBudgetUsd < job ? "bad" : ""}`}>One swarm job costs about {usd(job)} now (0.5 IMD). {pol.dailyBudgetUsd < job ? "This budget cannot buy any: raise it." : `This budget buys up to ${Math.floor(pol.dailyBudgetUsd / job)} a day.`} {pol.approvalOverUsd < job ? "Every purchase will wait for your approval." : ""}</p>}
            <button className="nx-btn nx-btn-acc" disabled={saving}>{saving ? "Saving…" : "Save limits"}</button>
          </form>
        )}

        {tab === "books" && (
          <div className="dk-form">
            <p className="dk-hint">Every ledger line that touched this company: funding, each IMD order, each sale, the platform fee and each withdrawal, with the chain transaction. For your accountant, or a spreadsheet.</p>
            <a className="nx-btn nx-btn-acc" href={`/api/companies/${c.id}/books.csv`} download><NxIcon name="money" size={15} />Download the books (CSV)</a>
            {c.last && <button className="nx-btn" onClick={() => onReplay(c.last!.id)}><NxIcon name="play" size={15} />Replay the last shift</button>}
            <Link to={`/co/${c.id}`} className="nx-btn">Every shift, on the company page</Link>
          </div>
        )}

        {tab === "delete" && (
          <form className="dk-form" onSubmit={(e) => { e.preventDefault(); void (async () => { setSaving(true); setError(null); try { await api.remove(c.id, confirm); onDeleted(); } catch (er) { setError((er as Error).message); } finally { setSaving(false); } })(); }}>
            <p className="dk-hint">Deleting stops it at once: no more shifts, no more sales, and its page goes offline. Its books are kept, its buyers' download links keep working, and you can restore it from the desk.</p>
            {live && !c.sim && (
              <div className="dk-warnbox">
                <b>Live company: empty its wallet first.</b>
                <span>Take back every IMD, USDC and ETH it holds, then delete it. Withdrawal fees apply as usual.</span>
                {!sure
                  ? <button type="button" className="nx-btn" disabled={saving} onClick={() => setSure(true)}>Stop and take the funds back</button>
                  : <button type="button" className="nx-btn nx-btn-acc" disabled={saving} onClick={() => void save(() => api.closeOut(c.id), "Everything was sent back to your wallet. You can delete it now.")}>Confirm: pause it and send everything to my wallet</button>}
              </div>
            )}
            <label>Type <b>{c.name}</b> to confirm<input className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></label>
            <button className="nx-btn dk-del" disabled={saving || confirm.trim().toLowerCase() !== c.name.trim().toLowerCase()}>{saving ? "Deleting…" : `Delete ${c.name}`}</button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ProductEdit({ co, x, saving, save }: { co: string; x: DeskCompany["products"][number]; saving: boolean; save: (fn: () => Promise<unknown>, done: string) => Promise<void> }) {
  const [name, setName] = useState(x.name);
  const [pitch, setPitch] = useState(x.pitch);
  const [price, setPrice] = useState(String(x.priceUsd));
  const changed = name !== x.name || pitch !== x.pitch;
  return (
    <div className={`dk-prod ${x.status}`}>
      <div className="dk-prod-h"><span className="mk-kind">{x.kind}</span><span className={`dk-st ${x.status}`}>{x.status === "live" ? "on sale" : x.status}</span><span className="faint">{x.sales} sold · {usd(x.revenueUsd)}</span></div>
      <input className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Product name" />
      <textarea className="field" rows={2} value={pitch} maxLength={240} onChange={(e) => setPitch(e.target.value)} aria-label="Pitch" />
      <div className="dk-row">
        <button className="nx-btn" disabled={saving || !changed} onClick={() => void save(() => api.product(co, x.id, { name, pitch }), "Product saved.")}>Save text</button>
        <label className="dk-price">$<input className="field mono" type="number" min={0.5} max={500} step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price in USD" /></label>
        <button className="nx-btn" disabled={saving || Number(price) === x.priceUsd} onClick={() => void save(() => api.price(co, x.id, Number(price)), "Price set. The CEO keeps it from now on.")}>Set price</button>
        {x.status === "live" && <button className="nx-btn" disabled={saving} onClick={() => void save(() => api.product(co, x.id, { status: "retired" }), "Taken off sale.")}>Take off sale</button>}
        {x.status === "retired" && <button className="nx-btn" disabled={saving || !x.packaged} title={x.packaged ? undefined : "No packaged file to sell"} onClick={() => void save(() => api.product(co, x.id, { status: "live" }), "Back on sale.")}>Put back on sale</button>}
      </div>
      {x.priceByOwner && <span className="faint dk-hint">Price set by you: the CEO will not change it.</span>}
    </div>
  );
}
