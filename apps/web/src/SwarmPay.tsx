import { usePublicRead } from "./publicRead";
import { isSwarmStats } from "./swarmStats";
import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { BeforeSign } from "./nx/brief";
import { paidRequest, signService, swarmQuote, swarmTerms, walletAccount, walletError, type PaidReply, type SignedRequest, type SwarmQuote } from "./paidServices";
import { chooseWallet, type Eip1193 } from "./wallet";

const kinds = ["website", "research", "audit", "contract", "tests", "review", "frontend", "image", "logo"];
/** A free checked quote, one exact wallet payment, then private status. */
export function SwarmPay() {
  const lock = useRef(false);
  const [kind, setKind] = useState("research"), [brief, setBrief] = useState("Research decentralized storage options with cited primary sources.");
  const [repo, setRepo] = useState(""), [commit, setCommit] = useState(""), [chain, setChain] = useState("ethereum"), [address, setAddress] = useState(""), [name, setName] = useState(""), [style, setStyle] = useState("");
  const [quote, setQuote] = useState<SwarmQuote | null>(null), [signed, setSigned] = useState<SignedRequest | null>(null), [result, setResult] = useState<PaidReply | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const read = usePublicRead("/api/v1/swarm/stats", isSwarmStats);
  const stats = read.state === "ready" ? read.data : null;
  const price = stats?.desk.kinds.find((k) => k.kind === kind)?.priceUsd;
  useEffect(() => { if (!signed) { setQuote(null); setError(""); } }, [kind, brief, repo, commit, chain, address, name, style]);
  async function getQuote() {
    if (lock.current || signed) return; lock.current = true; setBusy(true); setError(""); setResult(null);
    try { const q = await swarmQuote({ kind, brief, ...(["audit", "tests", "review"].includes(kind) ? { repo, ...(commit ? { commit } : {}) } : {}), ...(kind === "frontend" ? { chain, address } : {}), ...(kind === "logo" ? { name, style } : {}) }); setQuote(q); setMessage("Quote checked by IMD. Review the exact USDC price before paying."); }
    catch (e) { setError(walletError(e)); } finally { lock.current = false; setBusy(false); }
  }
  async function pay() {
    if (lock.current || !quote) return; lock.current = true; setBusy(true); setError("");
    try {
      let request = signed;
      if (!request) {
        const eth: Eip1193 = await chooseWallet(), account = await walletAccount(eth);
        if (!account.from) throw new Error("Connect your wallet to pay with USDC on Base.");
        const terms = await swarmTerms(quote, account.from as Address);
        request = await signService(eth, account.from, terms, setMessage); setSigned(request);
      }
      const reply = await paidRequest(request, setMessage);
      if (reply.pending) { setMessage("Settlement pending. Retry the same signed payment; no new authorization is needed."); return; }
      setResult(reply.body); setSigned(null); setMessage(reply.body.refundOwed ? "The job failed. The desk records a refund owed." : "Order accepted. Keep the order token for private status and results.");
    } catch (e) { setError(walletError(e)); } finally { lock.current = false; setBusy(false); }
  }
  const locked = busy || Boolean(signed), status = typeof result?.orderId === "string" && typeof result?.orderToken === "string" ? `/api/v1/swarm/jobs/${encodeURIComponent(result.orderId)}?token=${encodeURIComponent(result.orderToken)}` : null;
  return <section id="swarm-desk" className="st-panel svc-paid">
    <h2>Hire the swarm</h2>
    <p className="st-note"><b>Swarm Desk</b> commissions new work from IMD AI agents. Nine job kinds: website, research, audit, contract, tests, review, frontend, image and logo.</p>
    <p className="st-note">Build a website, write a sourced research report, audit Solidity with four specialists and a judge, or get contracts, tests, reviews, frontends, images and logos. One USDC payment on Base; no IMD token needed. If a job fails, the desk records a refund owed.</p>
    <p className="clarity-status" role="status">{read.state === "loading" ? "Loading desk availability and current price…" : read.state === "unavailable" ? "Desk availability and price unavailable." : !stats?.desk.enabled ? "The desk is currently off; paid ordering is unavailable." : price == null ? "Current price unavailable; a checked quote is required." : `Current ${kind} price: $${price.toFixed(2)} USDC. The checked quote confirms the exact price before payment.`}</p>
    <form className="svc-form" onSubmit={(e) => { e.preventDefault(); void getQuote(); }}>
      <label className="svc-paid-input">Work kind<select aria-label="Swarm work kind" disabled={locked} value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k}>{k}</option>)}</select></label>
      <label className="svc-paid-input">{kind === "image" ? "Image prompt" : "Brief"}<textarea aria-label="Swarm work brief" value={brief} disabled={locked} maxLength={1500} minLength={kind === "logo" ? 0 : 20} required={kind !== "logo"} onChange={(e) => setBrief(e.target.value)} /></label>
      {["audit", "tests", "review"].includes(kind) && <><label className="svc-paid-input">Public GitHub repository<input aria-label="Public GitHub repository" value={repo} onChange={(e) => setRepo(e.target.value)} disabled={locked} required /></label><label className="svc-paid-input">Full commit hash {kind === "tests" ? "(required)" : "(optional)"}<input aria-label="Full Git commit" value={commit} onChange={(e) => setCommit(e.target.value)} disabled={locked} required={kind === "tests"} pattern="[0-9a-fA-F]{40}" /></label></>}
      {kind === "frontend" && <><label className="svc-paid-input">Contract chain<select aria-label="Contract chain" value={chain} disabled={locked} onChange={(e) => setChain(e.target.value)}><option>ethereum</option><option>base</option></select></label><label className="svc-paid-input">Verified contract address<input aria-label="Verified contract address" value={address} onChange={(e) => setAddress(e.target.value)} disabled={locked} required pattern="0x[0-9a-fA-F]{40}" /></label></>}
      {kind === "logo" && <><label className="svc-paid-input">Logo name<input aria-label="Logo name" value={name} onChange={(e) => setName(e.target.value)} disabled={locked} minLength={1} maxLength={80} required /></label><label className="svc-paid-input">Style<input aria-label="Logo style" value={style} onChange={(e) => setStyle(e.target.value)} disabled={locked} minLength={3} maxLength={300} required /></label></>}
      <button className="st-cta ghost" disabled={locked || !stats?.desk.enabled} type="submit">{busy ? "Please wait…" : "Get a free checked quote"}</button>
    </form>
    {quote && <div><p>Exact quote: <b>${quote.priceUsd.toFixed(2)} USDC</b> · expires {new Date(quote.expiresAt).toLocaleTimeString()} · no holder discount.</p><p className="st-note">{quote.whatYouGet} {quote.eta}</p><BeforeSign kind="usdc" /><button className="st-cta" disabled={busy || Boolean(result)} onClick={() => void pay()}>{signed ? "Retry same payment" : `Pay $${quote.priceUsd.toFixed(2)} USDC with your wallet`}</button></div>}
    <div role="status" aria-live="polite">{message && <p>{message}</p>}{error && <p className="svc-err">{error} {signed ? "Retry uses the same signed payment." : "Nothing was paid. Fix the note above and ask for a new quote."}</p>}</div>
    {result && <div><p>Order ID: <code>{String(result.orderId ?? "unavailable")}</code></p>{typeof result.orderToken === "string" && <p>Keep this private order token: <code>{result.orderToken}</code></p>}{status && <a className="st-cta ghost" href={status} target="_blank" rel="noreferrer">Open private status and results</a>}{result.refundOwed === true && <p>The desk records a refund owed for this order.</p>}</div>}
  </section>;
}
