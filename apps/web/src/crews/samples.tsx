import { useEffect, useState } from "react";
import { type BuildCheckReport, type MindAnswer, type WatchChange, type WatchReport, api } from "../api";
import { Copy, HOOK, PUBLIC_MCP, RESEARCH_SAMPLE, SHIFT, blockUrl, day, isAddr, plural } from "./shared";

/**
 * The free samples, run from the page: a Watchtower check of an Ethereum token or v4 hook, a quick
 * Build & Check of a public agent service, and a SWARM MIND answer (the Research Desk's source).
 * Each shows what the engine answered, including the checks that could not run.
 */
type Err = Error & { status?: number };
const why = (e: Err, what: string) => (e.status === 429 || /slow down|per hour|per 10 minutes/i.test(e.message) ? `${e.message} (rate limit: try again later)` : e.message === "Failed to fetch" ? `${what} did not answer. Check your connection and try again.` : e.message);

// ------------------------------------------------------------------ Watchtower

const show = (v: unknown): string => {
  if (v === null || v === undefined) return "not present";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.totalUsd === "number") return `$${o.totalUsd.toLocaleString("en-US")}${typeof o.pairs === "number" ? ` (${o.pairs} pair${o.pairs === 1 ? "" : "s"})` : ""}`;
    const s = JSON.stringify(v);
    return s.length > 400 ? `${s.slice(0, 400)}…` : s;
  }
  return String(v);
};
const link = (e: string) => /^https?:\/\//.test(e);
const evidenceLabel = (e: string) => {
  try {
    const u = new URL(e);
    if (u.hostname.endsWith("etherscan.io")) return u.pathname.startsWith("/block/") ? `block ${Number(u.pathname.split("/")[2]).toLocaleString("en-US")}` : u.pathname.startsWith("/tx/") ? "transaction" : "contract on Etherscan";
    if (u.hostname.includes("dexscreener")) return "pair on DexScreener";
    return u.hostname.replace(/^www\./, "");
  } catch { return e; }
};
const Block = ({ n }: { n: number | null | undefined }) => (n == null ? <span className="dim">unknown block</span> : <a href={blockUrl(n)} target="_blank" rel="noreferrer">block {n.toLocaleString("en-US")}</a>);

function ChangeItem({ c }: { c: WatchChange }) {
  const sev = String(c.severity ?? "info").toLowerCase();
  return (
    <li>
      <div className="cr-ch-h">
        <span className={`cr-sev ${sev}`}>{sev}</span>
        <b>{c.label ?? c.field}</b>
        {c.kind === "coverage" && <span className="cr-tag warn">coverage</span>}
      </div>
      {c.note && <span className="dim">{c.note}</span>}
      <div className="cr-ba">
        <div><small>Before · <Block n={c.beforeBlock} /></small><code>{show(c.before)}</code></div>
        <i aria-hidden="true">→</i>
        <div><small>After · <Block n={c.afterBlock} /></small><code>{show(c.after)}</code></div>
      </div>
      {c.evidence?.length > 0 && <div className="cr-ev">{c.evidence.map((e) => link(e) ? <a key={e} href={e} target="_blank" rel="noreferrer">{evidenceLabel(e)} ↗</a> : <span key={e}>{e}</span>)}</div>}
    </li>
  );
}

export function WatchReportView({ r }: { r: WatchReport }) {
  const obs = r.observation;
  const real = (r.changes ?? []).filter((c) => c.kind !== "coverage");
  const coverage = (r.changes ?? []).filter((c) => c.kind === "coverage");
  const checks = obs ? Object.entries(obs.checks ?? {}) : [];
  const ran = checks.filter(([, c]) => c.status === "ok");
  const template = r.template ?? obs?.template ?? null;
  // a run that could not read the chain: the observation is the last good one, nothing new was read
  const failed = r.stale && !r.baseline && (r.counts?.completed ?? 0) === 0 && !(r.changes ?? []).length;
  return (
    <section className="st-panel cr-report" aria-live="polite">
      <div className="cr-report-h">
        <b>{r.kind === "hook" ? "Uniswap v4 hook" : r.kind === "token" ? "ERC-20 token" : r.kind}{template ? ` · ${template}` : ""}</b>
        <span className="cr-tag dim">{r.chain === "ethereum" ? "Ethereum mainnet" : r.chain}</span>
        <a className="mono" href={obs?.links?.address ?? `https://etherscan.io/address/${r.address}`} target="_blank" rel="noreferrer">{r.address}</a>
      </div>
      {r.stale && <p className="st-warn"><b>Stale:</b> {r.staleReason ?? "this data is older than the watch's threshold or the latest run could not read the chain"}. Changes since then are unknown.</p>}
      <p className="cr-summary">{r.summary}</p>
      {obs && (failed
        ? <p className="st-note">This run read nothing new. The last good data is from <Block n={obs.block?.number} />{obs.at ? ` (${day(obs.at)})` : ""}.</p>
        : <p className="st-note">Read at <Block n={obs.block?.number} />{r.baseline ? <> and compared with <Block n={r.baseline.block} /> ({day(r.baseline.at)})</> : "; this is a baseline, so there is nothing earlier to compare it with yet"}. {r.counts ? `${plural(r.counts.completed, "check")} completed.` : null}</p>)}

      <h4 className="cr-sec">Changes</h4>
      {real.length ? <ul className="cr-changes">{real.map((c) => <ChangeItem key={(c.id ?? c.field) + String(c.afterBlock)} c={c} />)}</ul>
        : <p className="st-empty">{failed ? "Unknown: this run could not read the chain, so it cannot say whether anything changed." : r.baseline ? "No change found in the checks that ran between the two blocks. Checks that could not run are listed below: they say nothing about what changed there." : "No changes to report: this run recorded the baseline that later runs compare with."}</p>}
      {coverage.length > 0 && <ul className="cr-changes">{coverage.map((c) => <ChangeItem key={`cov-${c.field}`} c={c} />)}</ul>}

      {!failed && <h4 className="cr-sec">Could not run ({(r.unavailable ?? []).length})</h4>}
      {failed ? null : (r.unavailable ?? []).length ? (
        <ul className="cr-lost">{r.unavailable.map((u) => <li key={u.id}><b>{u.label}</b><span>{u.reason}{u.lastBlock != null ? <> · last value <code>{show(u.lastValue)}</code> at <Block n={u.lastBlock} /></> : null}</span></li>)}</ul>
      ) : <p className="st-empty">Every supported check answered.</p>}

      {!failed && <h4 className="cr-sec">Not supported ({(r.unsupported ?? []).length})</h4>}
      {failed ? null : (r.unsupported ?? []).length ? (
        <ul className="cr-lost">{r.unsupported.map((u) => <li key={u.id} className="unsup"><b>{u.label}</b><span>{u.reason}</span></li>)}</ul>
      ) : <p className="st-empty">None for this kind of contract.</p>}

      {ran.length > 0 && (
        <details className="svc-evidence">
          <summary>{failed ? "The last values read" : "What was read"} ({plural(ran.length, "value")})</summary>
          <div className="st-table-wrap" style={{ marginTop: 10 }}>
            <table className="st-table cr-read">
              <thead><tr><th>Check</th><th>Value</th><th>Source</th></tr></thead>
              <tbody>{ran.map(([id, c]) => <tr key={id}><td>{c.label}</td><td className="mono">{c.display ?? show(c.value)}</td><td>{c.source && link(c.source) ? <a href={c.source} target="_blank" rel="noreferrer">{evidenceLabel(c.source)} ↗</a> : <span className="dim">{c.source ?? "—"}</span>}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
      <p className="st-note svc-small">{r.coverageNote}</p>
      {r.human && (
        <details className="cr-md">
          <summary>The report as text (Markdown, as an alert would send it)</summary>
          <Copy code={r.human} />
        </details>
      )}
    </section>
  );
}

export function WatchtowerTry({ initial }: { initial?: string }) {
  const asked = new URLSearchParams(location.search).get("address")?.trim() ?? "";
  const [addr, setAddr] = useState(isAddr(asked) ? asked : initial && isAddr(initial) ? initial : SHIFT);
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<WatchReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (a = addr) => {
    if (!isAddr(a)) { setErr("Paste an Ethereum address: 0x and 40 hex characters (a token contract or a Uniswap v4 hook)."); return; }
    setBusy(true); setErr(null);
    try { setR(await api.watchtowerSample(a.trim())); } catch (e) { setR(null); setErr(why(e as Err, "Watchtower")); } finally { setBusy(false); }
  };
  useEffect(() => { if (isAddr(asked)) void run(asked); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <form className="svc-form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <input value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false} autoComplete="off" aria-label="Token or v4 hook address on Ethereum" placeholder="0x… token or v4 hook on Ethereum" />
        <button className="st-cta" disabled={busy} type="submit">{busy ? "Reading the chain…" : "Run the free check"}</button>
      </form>
      <p className="cr-picks">Try <button className="svc-link" type="button" onClick={() => { setAddr(SHIFT); void run(SHIFT); }}>$SHIFT (token)</button><button className="svc-link" type="button" onClick={() => { setAddr(HOOK); void run(HOOK); }}>NightshiftHook (v4 hook)</button></p>
      {err && <p className="svc-err">{err}</p>}
      {r && <WatchReportView r={r} />}
    </>
  );
}

// ------------------------------------------------------------------ Build & Check

const summaryText = (s: BuildCheckReport["summary"]) => (typeof s === "string" ? s : s?.text ?? "");
export function BuildCheckView({ r, title }: { r: BuildCheckReport; title?: string }) {
  const s = typeof r.summary === "object" ? r.summary : null;
  return (
    <section className="st-panel cr-report" aria-live="polite">
      <div className="cr-report-h">
        <b>{title ?? (r.mode === "full" ? "Full check" : "Quick check")}</b>
        <span className="mono">{r.target}</span>
      </div>
      <p className="cr-summary">{summaryText(r.summary)}</p>
      {s && <p className="cr-picks"><span className="cr-st pass">{s.pass} pass</span><span className="cr-st warn">{s.warn} warn</span><span className="cr-st fail">{s.fail} fail</span><span className="cr-st unavailable">{s.unavailable} could not run</span>{r.requests != null && <span className="dim">{plural(r.requests, "request")} to the target</span>}</p>}
      <ul className="cr-checks">
        {(r.checks ?? []).map((c) => (
          <li key={c.id}>
            <div className="cr-ch-h"><span className={`cr-st ${c.status}`}>{c.status === "unavailable" ? "could not run" : c.status}</span><b>{c.label}</b><code>{c.id}</code>{c.ms != null && <small>{c.ms} ms</small>}</div>
            <p>{c.detail}</p>
            {c.reproduce && <details><summary>Reproduce it</summary><Copy code={c.reproduce} /></details>}
          </li>
        ))}
      </ul>
      {r.full && <p className="st-note svc-small">{r.full}</p>}
    </section>
  );
}

/** The README badge for a checked URL: a live quick check, linked back to the check. */
function Badge({ target }: { target: string }) {
  const enc = encodeURIComponent(target);
  const md = `[![NIGHTSHIFT check](${location.origin}/api/crews/buildcheck/badge?url=${enc})](${location.origin}/crews/buildcheck?url=${enc})`;
  const [copied, setCopied] = useState(false);
  return (
    <section className="st-panel cr-report">
      <div className="cr-report-h"><b>Add the badge to your README</b></div>
      <p className="st-note">A live quick check of this URL, refreshed every 6 hours, so anyone reading your repo sees that agents can reach your service.</p>
      <p><img src={`/api/crews/buildcheck/badge?url=${enc}`} alt="NIGHTSHIFT check badge" height={20} /></p>
      <pre className="cr-code">{md}</pre>
      <button className="st-cta" type="button" onClick={() => { void navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy the markdown"}</button>
    </section>
  );
}

export function BuildCheckTry() {
  // a link from the bot or a badge carries the URL to check (?url= or ?badge=)
  const linked = (() => { try { const q = new URLSearchParams(location.search); return q.get("url") ?? q.get("badge"); } catch { return null; } })();
  const [url, setUrl] = useState(linked && /^https:\/\//.test(linked) ? linked : PUBLIC_MCP);
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<BuildCheckReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (u = url) => {
    const t = u.trim();
    if (!/^https?:\/\/\S+$/i.test(t)) { setErr("Paste the full https URL of an MCP server or an x402 API."); return; }
    setBusy(true); setErr(null);
    try { setR(await api.buildcheckSample(t)); } catch (e) { setR(null); setErr(why(e as Err, "Build & Check")); } finally { setBusy(false); }
  };
  return (
    <>
      <form className="svc-form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} autoComplete="off" inputMode="url" aria-label="Service URL" placeholder="https://… your MCP server or x402 API" />
        <button className="st-cta" disabled={busy} type="submit">{busy ? "Checking…" : "Run the free quick check"}</button>
      </form>
      <p className="st-note">The free quick check runs the first three checks (reachable, MCP, x402) and makes at most 12 requests to that origin. Try <button className="svc-link" type="button" onClick={() => { setUrl(PUBLIC_MCP); void run(PUBLIC_MCP); }}>NIGHTSHIFT's public MCP</button>.</p>
      {err && <p className="svc-err">{err}</p>}
      {r && <BuildCheckView r={r} />}
      {r && <Badge target={r.target} />}
    </>
  );
}

// ------------------------------------------------------------------ Research Desk (SWARM MIND)

export function ResearchTry() {
  const [q, setQ] = useState(RESEARCH_SAMPLE);
  const [busy, setBusy] = useState(false);
  const [a, setA] = useState<MindAnswer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    const x = q.trim();
    if (x.length < 3 || x.length > 500) { setErr("Ask a question of 3 to 500 characters."); return; }
    setBusy(true); setErr(null);
    try { setA(await api.mindAsk(x)); } catch (e) { setA(null); setErr(why(e as Err, "SWARM MIND")); } finally { setBusy(false); }
  };
  const sources = a?.sources ?? [];
  return (
    <>
      <form className="svc-form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} aria-label="Your question" placeholder="Ask what the IMD swarm published about…" />
        <button className="st-cta" disabled={busy} type="submit">{busy ? "Asking SWARM MIND…" : "Ask free"}</button>
      </form>
      <p className="st-note">Free: ten questions per 10 minutes. The answer comes only from what the IMD swarm published, with every source linked; the paid report adds coverage and the gaps.</p>
      {err && <p className="svc-err">{err}</p>}
      {a && (
        <section className="st-panel cr-report" aria-live="polite">
          <div className="cr-report-h"><b>SWARM MIND</b>{a.model ? <span className="cr-tag dim">{a.model}</span> : <span className="cr-tag warn">no model: matching works only</span>}</div>
          <p className="cr-answer">{a.answer}</p>
          <h4 className="cr-sec">Sources ({sources.length})</h4>
          {sources.length ? <ol className="cr-sources">{sources.map((s) => <li key={s.url} value={s.n}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>{s.kinds?.length ? <span> · {s.kinds.join(", ")}</span> : null}{s.at ? <span> · {day(s.at)}</span> : null}</li>)}</ol>
            : <p className="st-empty">No published work matched, so there is nothing to cite.</p>}
        </section>
      )}
    </>
  );
}

/** The right free sample for a crew, or a link to an outside crew's own endpoint. */
export function TryFree({ id, href }: { id: string; href?: string }) {
  if (id === "watchtower") {
    let initial: string | undefined;
    try { initial = href ? new URL(href, location.origin).searchParams.get("address") ?? undefined : undefined; } catch { /* not a URL */ }
    return <WatchtowerTry initial={initial} />;
  }
  if (id === "buildcheck") return <BuildCheckTry />;
  if (id === "research") return <ResearchTry />;
  if (id === "swarm") return <p className="st-note">Ask for a free checked quote with the MCP tool <code>swarm_quote</code>, or <a href={href} target="_blank" rel="noreferrer">try a research quote</a>. Pick website, research, audit or contract and supply your brief. The desk stays in preview until the owner switches it on.</p>;
  return href ? <p className="st-note" style={{ overflowWrap: "anywhere" }}>This crew's sample runs on its operator's endpoint: <a href={href} target="_blank" rel="noreferrer">{href.replace(/^https?:\/\//, "")} ↗</a>. NIGHTSHIFT does not run it.</p> : <p className="st-empty">No free sample is published for this crew.</p>;
}
