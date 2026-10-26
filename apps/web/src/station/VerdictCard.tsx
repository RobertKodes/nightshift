import { Stat } from "./Station";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const money = (n: number | null | undefined) => n == null ? "—" : n === 0 ? "$0" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(n < 1 ? 4 : 0)}`;

type Reason = { id: string; impact: "avoid" | "caution" | "note" | "good"; text: string; evidence: string[] };
export type Verdict = {
  verdict: "no_issues_found" | "safe" | "caution" | "avoid"; summary: string; token: string; depth: string;
  confidence: { level: string; score: number; unknowns: string[] }; reasons: Reason[];
  asset: { name: string | null; symbol: string | null };
  imd: { isLaunch: boolean; launchNumber?: number; kind?: string };
  market: { liquidityUsd: number | null; exitLiquidityUsd: number | null; volume24hUsd: number | null; pair: { url: string } | null };
  hook: { address: string; flags: string; template: string | null } | null;
  holders: { count?: number; largestWallet?: { pct: number; label: string | null } | null; error?: string };
  simulation: { simulated: boolean; why?: string; buy?: { taxPct?: number | null }; sell?: { taxPct?: number | null; ok?: boolean }; router?: { ok: boolean } };
  copycat: { signal: string; text: string };
  evidence: { id: string; what: string; source: string; url?: string }[];
  demo?: { left: number; nextFreeAt: string }; cached?: boolean; dataAgeSeconds?: number;
};
export function VerdictCard({ v }: { v: Verdict }) {
  const sym = v.asset.symbol ? `$${v.asset.symbol}` : short(v.token);
  const groups: Reason["impact"][] = ["avoid", "caution", "note", "good"];
  return (
    <section className={`svc-verdict ${v.verdict}`}>
      <div className="svc-vhead">
        <span className={`svc-pill ${v.verdict === "no_issues_found" ? "safe" : v.verdict}`}>{v.verdict === "no_issues_found" || v.verdict === "safe" ? "NO ISSUES FOUND" : v.verdict.toUpperCase()}</span>
        <div><b>{sym}{v.imd.isLaunch ? <small> · IMD launch #{v.imd.launchNumber} ({v.imd.kind})</small> : <small> · not an IMD launch</small>}</b><span className="mono">{v.token}</span></div>
        <span className="svc-conf" title={v.confidence.unknowns.join("; ") || "every check ran"}>{v.confidence.level} confidence · {Math.round(v.confidence.score * 100)}%</span>
      </div>
      <p className="svc-summary">{v.summary}</p>
      <div className="st-stats wide">
        <Stat label="Exit liquidity" value={money(v.market.exitLiquidityUsd)} note={v.market.liquidityUsd != null ? `${money(v.market.liquidityUsd)} in the pool` : undefined} />
        <Stat label="Sell cost" value={v.simulation.simulated && v.simulation.sell?.taxPct != null ? `${v.simulation.sell.taxPct}%` : "—"} note={v.simulation.simulated ? "beyond the pool fee, simulated" : v.simulation.why} />
        <Stat label="Holders" value={v.holders.count != null ? v.holders.count.toLocaleString("en-US") : "—"} note={v.holders.largestWallet ? `largest ${v.holders.largestWallet.pct.toFixed(2)}%` : v.holders.error} />
        <Stat label="Copycat" value={v.copycat.signal} note={v.hook ? `hook ${v.hook.template ?? short(v.hook.address)} · ${v.hook.flags}` : "no v4 hook"} />
      </div>
      <ul className="svc-reasons">
        {groups.flatMap((g) => v.reasons.filter((r) => r.impact === g).map((r) => (
          <li key={r.id + r.text} className={r.impact}><i>{r.impact}</i><span>{r.text}</span><small>{r.evidence.join(" ")}</small></li>
        )))}
      </ul>
      {v.confidence.unknowns.length > 0 && <p className="st-note">Not checked: {v.confidence.unknowns.join("; ")}.</p>}
      <details className="svc-evidence">
        <summary>Evidence ({v.evidence.length})</summary>
        <ol>{v.evidence.map((e) => <li key={e.id}><b>{e.id}</b> <span>{e.what}</span> <small>{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.source} ↗</a> : e.source}</small></li>)}</ol>
      </details>
      <p className="st-note svc-small">{v.cached ? `From the cache, ${v.dataAgeSeconds}s old. ` : ""}Automated checks run by NIGHTSHIFT, not financial advice and not an audit.</p>
    </section>
  );
}

