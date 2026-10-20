import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Flight, type FlightSpan, short, usd } from "./api";
import { NxIcon } from "./nx/icons";

/** How long something took, in the shortest honest words. */
export function took(ms: number): string {
  if (ms < 1000) return `${Math.max(0, ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(s / 3600);
  return h < 48 ? `${h}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Who chose the move: the owner by hand, the CEO's model (and what thinking cost), or the playbook (and why). */
function By({ m }: { m: NonNullable<Flight["mind"]> }) {
  if (m.by === "owner") return <>Ordered by the owner, not the CEO</>;
  if (m.by === "playbook") return <>Decided by the playbook{m.fallback ? `, because ${m.fallback}` : ""}</>;
  return <>Decided by the CEO's model{m.model ? <> (<code>{m.model}</code>)</> : null}{m.costUsd > 0 ? `, ${usd(m.costUsd, 4)} to think` : ""}</>;
}

type Row = FlightSpan & { depth: number };
const flat = (nodes: FlightSpan[], depth = 0, out: Row[] = []): Row[] => {
  for (const n of nodes) { out.push({ ...n, depth }); flat(n.children, depth + 1, out); }
  return out;
};

/**
 * The flight recorder: one shift replayed. What the CEO saw, why it moved, each phase and swarm step
 * on a timeline you can scrub or play, the money that moved and whether it paid back.
 */
export function FlightDrawer({ load, onClose, accent = "#4ad8ff", share }: { load: () => Promise<Flight>; onClose: () => void; accent?: string; share?: string }) {
  const [f, setF] = useState<Flight | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pos, setPos] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const raf = useRef(0);

  // loaded when opened (the parent keys the drawer by shift), then kept fresh while the shift runs
  useEffect(() => { load().then(setF).catch((e: Error) => setErr(e.message)); }, []);
  const running = f !== null && f.endedAt === null;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { load().then(setF).catch(() => {}); }, 4000);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const rows = useMemo(() => (f ? flat(f.trace) : []), [f]);
  const t0 = f?.createdAt ?? 0;
  const t1 = f ? Math.max(f.endedAt ?? Date.now(), ...rows.map((r) => r.endedAt ?? 0)) : 1;
  const span = Math.max(1, t1 - t0);
  const at = t0 + span * pos;
  // everything that happened, in order: each phase starting and each line the swarm reported
  const events = useMemo(() => rows.filter((r) => r.depth > 0).flatMap((r) => [{ at: r.startedAt, text: r.name }, ...(r.attrs.log ?? []).filter((l) => l.at > r.startedAt).map((l) => ({ at: l.at, text: `${r.name} · ${l.text}` }))]).sort((a, b) => a.at - b.at), [rows]);
  const now = [...events].reverse().find((e) => e.at <= at) ?? events[0];

  const play = () => {
    if (playing) { cancelAnimationFrame(raf.current); setPlaying(false); return; }
    setPlaying(true);
    const from = pos >= 0.999 ? 0 : pos;
    const start = performance.now();
    const step = (ts: number) => {
      const p = Math.min(1, from + (ts - start) / 7000);
      setPos(p);
      if (p < 1) raf.current = requestAnimationFrame(step); else setPlaying(false);
    };
    raf.current = requestAnimationFrame(step);
  };

  const picked = rows.find((r) => r.id === sel) ?? null;
  const pb = f?.payback;
  return createPortal(
    <div className="nx-shell mk-drawer fr" data-room="geek" style={{ "--acc": accent } as React.CSSProperties} role="dialog" aria-modal="true" aria-label="Flight recorder" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mk-panel fr-panel">
        <button className="mk-x" onClick={onClose} aria-label="Close"><NxIcon name="close" size={18} /></button>
        {err ? <p className="warn">{err}</p> : !f ? <p className="dim">Loading the record…</p> : (
          <>
            <span className="eyebrow">Flight recorder · {f.company.name} · shift {f.cycle}</span>
            <h2>{f.title}</h2>
            <div className="mk-facts">
              <span className={`fr-st ${f.status}`}>{f.status.replace(/_/g, " ")}</span>
              <span>{f.kind.replace(/_/g, " ")}</span>
              <span><b>{took(f.durationMs)}</b>{f.endedAt ? "" : " so far"}</span>
              <span><b>{f.money.costUsd > 0 ? usd(f.money.costUsd) : "free"}</b>{f.money.costImd > 0 ? ` · ${f.money.costImd} IMD` : ""}</span>
              {pb?.kind === "product" && pb.ratio !== null && pb.status === "live" && <span className={pb.ratio >= 1 ? "fr-good" : ""}><b>{pb.ratio.toFixed(1)}×</b> paid back</span>}
            </div>
            {!f.recorded && <p className="fr-note">This shift ran before the flight recorder: only its start and its end were kept.</p>}

            <h4>What the CEO saw</h4>
            {f.mind ? (
              <>
                <div className="fr-saw">
                  <span><b>{f.mind.saw.visits7d}</b>visits, 7 days</span>
                  <span><b>{f.mind.saw.sales7d}</b>sales, 7 days</span>
                  <span><b>{usd(f.mind.saw.revenue7dUsd)}</b>revenue, 7 days</span>
                  <span><b>{f.mind.saw.liveProducts}</b>on sale</span>
                  <span><b>{usd(f.mind.saw.imdUsd)}</b>per IMD</span>
                </div>
                <p className="fr-by">
                  <By m={f.mind} />
                  {f.mind.saw.direction ? " · following the owner's direction" : ""}
                </p>
              </>
            ) : <p className="fr-by">Recorded before the CEO's view was kept.</p>}
            <blockquote>{f.why}</blockquote>

            <h4>Replay</h4>
            <div className="fr-replay">
              <button className="nx-btn fr-play" onClick={play} aria-label={playing ? "Pause" : "Play"}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">{playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /> : <path d="M7 4l13 8-13 8z" fill="currentColor" />}</svg>{playing ? "Pause" : "Play"}</button>
              <input type="range" min={0} max={1000} value={Math.round(pos * 1000)} onChange={(e) => { cancelAnimationFrame(raf.current); setPlaying(false); setPos(Number(e.target.value) / 1000); }} aria-label="Scrub through the shift" />
              <span className="fr-clock">{took(at - t0)} / {took(span)}</span>
            </div>
            <div className="fr-now"><span className="nx-dot" />{now?.text ?? "Waiting"}</div>
            <ol className="fr-gantt">
              {rows.map((r) => {
                const left = ((r.startedAt - t0) / span) * 100;
                const end = r.endedAt ?? t1;
                const width = Math.max(1.2, ((end - r.startedAt) / span) * 100);
                const shown = r.startedAt <= at;
                return (
                  <li key={r.id} className={`${shown ? "" : "fr-later"} ${sel === r.id ? "fr-sel" : ""}`} style={{ "--d": r.depth } as React.CSSProperties}>
                    <button onClick={() => { setSel(sel === r.id ? null : r.id); setPos(Math.min(1, (r.startedAt - t0) / span + 0.0001)); }}>
                      <span className="fr-name">{r.depth === 0 ? "Whole shift" : r.name}</span>
                      <span className="fr-track"><i className={`fr-bar ${r.status}`} style={{ left: `${Math.min(left, 98.8)}%`, width: `${Math.min(width, 100 - Math.min(left, 98.8))}%` }} /></span>
                      <span className="fr-dur">{r.endedAt === null ? "running" : took(r.endedAt - r.startedAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {picked && (
              <div className="fr-detail">
                <b>{picked.depth === 0 ? "Whole shift" : picked.name}</b>
                <span className="dim">{picked.endedAt === null ? "still running" : took(picked.endedAt - picked.startedAt)}{picked.totalCostUsd > 0 ? ` · ${usd(picked.totalCostUsd, picked.totalCostUsd < 0.1 ? 4 : 2)}` : ""}</span>
                {picked.attrs.error && <p className="warn">{picked.attrs.error}</p>}
                {(picked.attrs.log ?? []).length > 0 && <ul>{picked.attrs.log!.map((l, i) => <li key={i}><span className="mono faint">+{took(l.at - t0)}</span> {l.text}</li>)}</ul>}
              </div>
            )}

            <h4>Money</h4>
            {f.money.ledger.length === 0 ? <p className="fr-by">{f.money.costUsd > 0 ? "Reserved against the budget; not booked yet." : "Done in-house: nothing was paid."}</p> : f.money.ledger.map((x) => (
              <div key={x.id} className="fr-ledger">
                <span className="mono faint">{x.kind.replace(/_/g, " ")}</span>
                {x.legs.map((l, i) => <span key={i} className={l.amount < 0 ? "fr-out" : "fr-in"}>{l.account} <b>{l.amount > 0 ? "+" : "−"}{Math.abs(l.amount)} {l.asset}</b></span>)}
              </div>
            ))}
            {pb?.kind === "product" && (
              <div className="fr-payback">
                <div><span>{pb.name}</span><b>{usd(pb.revenueUsd)}</b><span className="dim"> earned from {pb.sales} sale{pb.sales === 1 ? "" : "s"} · cost {usd(pb.costUsd)}</span></div>
                <div className="fr-meter"><i style={{ width: `${Math.min(100, pb.costUsd > 0 ? (pb.revenueUsd / pb.costUsd) * 100 : 100)}%` }} /></div>
                <span className="faint">{pb.costUsd > 0 && pb.revenueUsd >= pb.costUsd ? "Paid for itself." : pb.costUsd > 0 ? `${usd(pb.costUsd - pb.revenueUsd)} to break even.` : ""}</span>
              </div>
            )}
            {pb?.kind === "site" && <p className="fr-by"><b>{pb.visits}</b> visits since it went live.</p>}

            <h4>Receipts</h4>
            <div className="fr-receipts">
              {f.receipts.orderId && <span>order <code>{f.receipts.orderId.slice(0, 8)}</code></span>}
              {f.receipts.jobId && (f.receipts.jobUrl ? <a href={f.receipts.jobUrl} target="_blank" rel="noreferrer">IMD job {f.receipts.jobId.slice(0, 8)} <NxIcon name="external" size={13} /></a> : <span>job <code>{f.receipts.jobId.slice(0, 8)}</code></span>)}
              {f.receipts.txHash && (f.receipts.txUrl ? <a href={f.receipts.txUrl} target="_blank" rel="noreferrer">payment {short(f.receipts.txHash)} <NxIcon name="external" size={13} /></a> : <span>payment <code>{short(f.receipts.txHash)}</code></span>)}
              {f.receipts.siteUrl && <a href={f.receipts.siteUrl} target="_blank" rel="noreferrer">the site <NxIcon name="external" size={13} /></a>}
              {Object.entries(f.receipts.files ?? {}).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer">{k} <NxIcon name="external" size={13} /></a>)}
              {!f.receipts.orderId && !f.receipts.siteUrl && <span className="faint">No order: this move cost nothing.</span>}
            </div>
            {f.brief && <details className="fr-brief"><summary>What the swarm was asked for</summary><p>{f.brief}</p></details>}
            {f.error && <p className="warn">{f.error}</p>}
            {share && (
              <div className="mk-buy">
                <button className="nx-btn" onClick={() => { void navigator.clipboard?.writeText(share).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); }}><NxIcon name="external" size={15} />{copied ? "Link copied" : "Copy link to this shift"}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
