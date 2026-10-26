import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { type BuildCheckReport, type WatchReport } from "./api";
import { BuildCheckView, WatchReportView } from "./crews/samples";
import { type PaidReply, type ServiceIndex, type ServiceOffer, type ServiceTerms, type SignedRequest, loadServiceIndex, paidInput, paidRequest, serviceTerms, serviceUrl, signService, walletAccount, walletError } from "./paidServices";
import { safeHref } from "./safe";
import { type Verdict, VerdictCard } from "./station/VerdictCard";
import { type Eip1193, chooseWallet, knownWallet } from "./wallet";
import "./station/services.css";

const dollars = (usd: number) => `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;

function PaidResult({ offer, result }: { offer: ServiceOffer; result: PaidReply }) {
  const tx = result.payment?.tx;
  return (
    <div className="svc-paid-result">
      {tx && /^0x[0-9a-fA-F]{64}$/.test(tx) && <p className="st-note">Settled on Base: <a className="mono" href={`https://basescan.org/tx/${tx}`} target="_blank" rel="noreferrer">{tx.slice(0, 10)}…{tx.slice(-8)} ↗</a></p>}
      {result.payment?.sim && <p className="st-note">Simulation result. No money moved and no Bazaar listing was created.</p>}
      {offer.id.startsWith("token-verdict-") ? <><VerdictCard v={result as unknown as Verdict} />{typeof result.explanation === "string" && <p className="st-note">{result.explanation}</p>}</>
        : offer.id.startsWith("watchtower-") ? <WatchReportView r={result as unknown as WatchReport} />
        : offer.id === "buildcheck-report" ? <BuildCheckView r={result as unknown as BuildCheckReport} title="Your integration report" />
        : <section className="st-panel">
          {typeof result.summary === "string" && <p>{result.summary}</p>}
          {typeof result.answer === "string" && <p className="svc-paid-answer">{result.answer}</p>}
          {typeof result.coverage === "string" && <p className="st-note">{result.coverage}</p>}
          <details className="svc-evidence" open={offer.id === "imd-feed"}><summary>The full result (JSON)</summary><pre className="st-pre">{JSON.stringify(result, null, 2)}</pre></details>
        </section>}
      {offer.id === "watchtower-watch" && <section className="st-panel">
        <h4>Keep your watch details</h4>
        <p className="st-note">Save these before leaving. The manage token is shown once; it lets you read or stop the watch.</p>
        {typeof result.telegram === "string" && safeHref(result.telegram) && <a href={safeHref(result.telegram)} target="_blank" rel="noreferrer">Turn on Telegram alerts ↗</a>}
        <pre className="st-pre">{JSON.stringify({ watch: result.watch, manageToken: result.manageToken, stop: result.stop }, null, 2)}</pre>
      </section>}
    </div>
  );
}

/** A wallet payment for one house offer, using only this site's terms. */
export function TryPaid({ offer }: { offer: ServiceOffer }) {
  const input = paidInput[offer.id];
  const [legacyValue, setValue] = useState(input?.example ?? "");
  const [fields, setFields] = useState<Record<string, string>>(() => Object.fromEntries((input?.fields ?? []).map((f) => [f.key, f.example])));
  const value = input?.fields ? new URLSearchParams(Object.entries(fields).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])).toString() : legacyValue;
  const [provider, setProvider] = useState<Eip1193 | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chain, setChain] = useState<number | null>(null);
  const [terms, setTerms] = useState<ServiceTerms | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<PaidReply | null>(null);
  const [signed, setSigned] = useState<SignedRequest | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    let alive = true;
    const refresh = () => { void knownWallet().then((eth) => { if (alive) setProvider(eth); }).catch(() => {}); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("ns-paid-wallet", refresh);
    return () => { alive = false; window.removeEventListener("focus", refresh); window.removeEventListener("ns-paid-wallet", refresh); };
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (!provider) { setAccount(null); setChain(null); return; }
      void walletAccount(provider).then((a) => { if (alive) { setAccount(a.from); setChain(a.chain); } }).catch(() => { if (alive) { setAccount(null); setChain(null); } });
    };
    refresh();
    provider?.on("accountsChanged", refresh);
    provider?.on("chainChanged", refresh);
    provider?.on("disconnect", refresh);
    return () => { alive = false; provider?.removeListener("accountsChanged", refresh); provider?.removeListener("chainChanged", refresh); provider?.removeListener("disconnect", refresh); };
  }, [provider]);

  useEffect(() => {
    let alive = true;
    setTerms(null); setQuoteError("");
    if (!account) return;
    try { serviceUrl(offer.id, value); } catch { return; }
    const timer = setTimeout(() => {
      void serviceTerms(offer, value, account).then((t) => { if (alive) setTerms(t); }).catch((e) => { if (alive) setQuoteError(walletError(e)); });
    }, 600);
    return () => { alive = false; clearTimeout(timer); };
  }, [offer, value, account]);

  async function connect() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const eth = await chooseWallet();
      setProvider(eth);
      window.dispatchEvent(new Event("ns-paid-wallet"));
    } catch (e) { setError(walletError(e)); } finally { lock.current = false; setBusy(false); }
  }

  async function run() {
    if (lock.current || !provider || !account) return;
    lock.current = true; setBusy(true); setError("");
    let request = signed;
    try {
      if (!request) {
        setResult(null); setMessage("Reading this site's payment terms…");
        const current = await serviceTerms(offer, value, account);
        setTerms(current); setQuoteError("");
        if (terms && current.requirement.amount !== terms.requirement.amount) throw new Error("The price changed. Review the new price and press Pay again.");
        request = await signService(provider, account, current, setMessage);
        setSigned(request);
      }
      setMessage("Running the service and waiting for settlement…");
      const reply = await paidRequest(request, (m) => setMessage(`${m} Checking the same payment again; no new signature.`));
      if (reply.pending) { setMessage("Still pending on Base. Keep this page open and check the same payment again. No new signature is needed."); return; }
      setResult(reply.body); setSigned(null); setMessage("Your result is ready.");
    } catch (e) {
      setMessage("");
      setError(`${walletError(e)}${request ? " Retry the same payment below; it uses the same signature." : ""}`);
    } finally {
      void walletAccount(provider).then((a) => { setAccount(a.from); setChain(a.chain); }).catch(() => {});
      lock.current = false; setBusy(false);
    }
  }

  if (!input) return null;
  const price = terms ? Number(terms.requirement.amount) / 1e6 : offer.priceUsd;
  return (
    <details className="st-panel svc-paid" open={offer.id === "token-verdict-quick" || offer.id === "watchtower-check"}>
      <summary className="svc-paid-head"><b>{offer.name}</b><span className="mono">{dollars(offer.priceUsd)}{terms?.holderPrice && <> · your holder price {dollars(price)}</>}</span></summary>
      <div className="svc-paid-body">
        <p className="st-note">You pay {dollars(price)} in USDC on Base from your wallet. No account.</p>
        <p className="st-note svc-small">{offer.pitch}</p>
        <form className="svc-form" onSubmit={(e) => { e.preventDefault(); if (account) void run(); else void connect(); }}>
          {input.fields ? input.fields.map((field) => <label className="svc-paid-input" key={field.key}><span>{field.label}{field.optional ? " (optional)" : ""}</span>
            {field.options ? <select aria-label={field.label} value={fields[field.key] ?? ""} disabled={busy || Boolean(signed)} onChange={(e) => { setFields((prev) => ({ ...prev, [field.key]: e.target.value })); setError(""); }}>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
              : <input aria-label={field.label} value={fields[field.key] ?? ""} onChange={(e) => { setFields((prev) => ({ ...prev, [field.key]: e.target.value })); setError(""); }} disabled={busy || Boolean(signed)} required={!field.optional} autoComplete="off" spellCheck={false} />}
          </label>) : <label className="svc-paid-input"><span>{input.label}</span><input value={value} onChange={(e) => { setValue(e.target.value); setError(""); }} disabled={busy || Boolean(signed)} required autoComplete="off" spellCheck={false} /></label>}
          {input.fields?.length === 0 && <p className="st-note">Returns gas estimates for Ethereum and Base.</p>}
          {!account ? <button className="st-cta ghost" type="submit" disabled={busy}>{busy ? "Connecting…" : "Connect wallet"}</button>
            : <button className="st-cta" type="submit" disabled={busy}>{busy ? "Please wait…" : signed ? "Retry same payment" : `Pay ${dollars(price)} and run`}</button>}
        </form>
        {account && <p className="st-note svc-small mono">Wallet {account.slice(0, 6)}…{account.slice(-4)}{chain !== 8453 ? " · wrong chain: payment will ask you to switch to Base (8453)." : " · Base (8453)"}</p>}
        <div aria-live="polite" role="status">{message && <p className="st-note">{message}</p>}{(error || quoteError) && <p className="svc-err">{error || quoteError}</p>}</div>
        {result && <PaidResult offer={offer} result={result} />}
      </div>
    </details>
  );
}

/** Fixed-price offers; quoted Swarm Desk work keeps its own flow. */
export function PaidOffers({ index, ids }: { index?: ServiceIndex | null; ids?: string[] }) {
  const [loaded, setLoaded] = useState<ServiceIndex | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (index) return;
    let alive = true;
    void loadServiceIndex().then((d) => { if (alive) setLoaded(d); }).catch((e) => { if (alive) setError(walletError(e)); });
    return () => { alive = false; };
  }, [index]);
  const offers = (index ?? loaded)?.offers.filter((o) => paidInput[o.id] && !o.priceIsMinimum && (!ids || ids.includes(o.id)));
  return <div className="svc-paid-list">{offers ? offers.map((o) => <TryPaid key={o.id} offer={o} />) : <p className={error ? "svc-err" : "st-note"}>{error || "Reading the prices…"}</p>}</div>;
}
