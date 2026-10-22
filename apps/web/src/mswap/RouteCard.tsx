import { CHAINS, type Quote, amountText, routeDiff, routePath, routeRows } from "@nightshift/swap";
import { shortAddr } from "./TokenSheet";

/**
 * One route, as a person checks it before signing: the hops, what arrives at least, the provider's fees and
 * NIGHTSHIFT's apart, gas, time, slippage, and every contract the wallet will touch, labelled or flagged.
 */
export function RouteCard({ q, others, pick, preview, problems }: { q: Quote; others: Quote[]; pick: (q: Quote) => void; preview: boolean; problems: string[] }) {
  const path = routePath(q);
  return (
    <div className="ms-route" aria-live="polite">
      <div className="ms-route-h">
        <b>Route</b>
        <span>{q.providerName}{others.length > 0 ? `, best of ${others.length + 1}` : ""}</span>
      </div>
      <ol className="ms-path">{path.map((p, i) => <li key={i} className={i % 2 ? "via" : ""}>{p}</li>)}</ol>
      <dl className="ms-rows">
        {routeRows(q).map((r) => <div key={r.k} className={r.k === "NIGHTSHIFT fee" && q.nightshift.waived ? "good" : ""}><dt>{r.k}</dt><dd>{r.v}</dd></div>)}
      </dl>
      <div className="ms-contracts">
        <b>Contracts your wallet touches</b>
        <ul>
          {q.contracts.map((c) => (
            <li key={`${c.address}:${c.role}`} className={c.label ? "" : "bad"}>
              <span>{c.label ?? "Unknown contract"}</span>
              <a href={`${CHAINS[c.chain].addr}${c.address}`} target="_blank" rel="noreferrer"><code>{shortAddr(c.address)}</code> ↗</a>
              <i>{c.role}</i>
            </li>
          ))}
        </ul>
      </div>
      {problems.length > 0 && <div className="ms-refused" role="alert"><b>Refused, nothing will be signed:</b><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      {preview && problems.length === 0 && <p className="ms-fine">Priced for a sample address. Connect your wallet for a route you can sign.</p>}
      {others.length > 0 && (
        <div className="ms-others">
          {others.map((o) => (
            <button key={o.provider} type="button" onClick={() => pick(o)}>
              <span>{o.providerName}</span>
              <b>{amountText(o.toAmount, o.toToken.decimals)} {o.toToken.symbol}</b>
              <i>{o.problems.length ? "refused" : routeDiff(o, q)}</i>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
