import {
  CHAINS, type ChainKey, IMD_RH, PINNED, type Quote, type QuoteRequest, SHIFT_TOKEN, type Token, XRPL_SOURCE_SOON, amountText, etaText, isNative, nativeToken, sameAddress, usdText, validAddress,
} from "@nightshift/swap";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Address, erc20Abi, formatUnits, parseUnits } from "viem";
import { useSession } from "../session";
import { chooseSolana, chooseWallet, knownWallet } from "../wallet";
import { type FeeInfo, swapApi } from "./api";
import { RouteCard } from "./RouteCard";
import { balanceOf, evmRpc, recheck, runEvm, runSvm } from "./run";
import { TokenLogo, TokenSheet, shortAddr } from "./TokenSheet";
import "./mswap.css";

type Side = { chain: ChainKey; token: Token };
type Sent = { provider: Quote["provider"]; fromChain: ChainKey; toChain: ChainKey; hash: string; requestId?: string; tool?: string; at: number; out: string; state: "pending" | "done" | "failed" | "refunded"; text: string; outUrl?: string };

/** Valid placeholder wallets for a price before anyone connects: a preview is never signable. */
const PREVIEW: Record<"evm" | "svm" | "xrpl", string> = { evm: "0x1111111111111111111111111111111111111111", svm: "11111111111111111111111111111112", xrpl: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh" };
const SLIPS = [0.005, 0.01, 0.02, 0.03];
const KEY = "ns-mswap-last";
const kind = (c: ChainKey) => CHAINS[c].kind;
const errText = (e: unknown) => String((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? e).split("\n")[0]!.slice(0, 220);
const rejected = (e: unknown) => /reject|denied|cancel/i.test(errText(e));
const loadSent = (): Sent | null => { try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Sent | null; return s && Date.now() - s.at < 86_400_000 ? s : null; } catch { return null; } };
const saveSent = (s: Sent | null) => { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* private window */ } };
const toUnits = (v: string, d: number) => { try { return v && Number(v) > 0 ? parseUnits(v, d) : 0n; } catch { return 0n; } };

/** A swap opened for one token: `?to=eth:0x…&from=base` on /swap, or the launchpad's token page. */
export type Preset = { to: { chain: ChainKey; address: string }; from?: ChainKey };
export function presetFromUrl(search = location.search): Preset | null {
  const q = new URLSearchParams(search), to = (q.get("to") ?? "").split(":");
  const chain = to[0] as ChainKey, address = to[1] ?? "", from = q.get("from") as ChainKey | null;
  if (!(chain in CHAINS) || kind(chain) !== "evm" || !validAddress(chain, address)) return null;
  return { to: { chain, address: address.toLowerCase() }, from: from && from in CHAINS && from !== "xrpl" ? from : undefined };
}
/**
 * The token a preset names: from the provider's list when it is there, otherwise read on chain (symbol,
 * name, decimals) and marked unverified, as a token found by its address in the token sheet is.
 */
export async function presetToken(p: Preset): Promise<Token | null> {
  const listed = await swapApi.tokens(p.to.chain, p.to.address).then((t) => t.find((x) => sameAddress(x.address, p.to.address)) ?? null).catch(() => null);
  if (listed) return listed;
  const c = p.to.chain as "eth" | "base" | "rh", a = p.to.address as Address;
  try {
    const [symbol, name, decimals] = await Promise.all([
      evmRpc(c).readContract({ address: a, abi: erc20Abi, functionName: "symbol" }),
      evmRpc(c).readContract({ address: a, abi: erc20Abi, functionName: "name" }),
      evmRpc(c).readContract({ address: a, abi: erc20Abi, functionName: "decimals" }),
    ]);
    return { chain: p.to.chain, address: p.to.address, symbol: String(symbol).slice(0, 16), name: String(name).slice(0, 40), decimals: Number(decimals), verified: false };
  } catch { return null; }
}

/** ETH and $SHIFT on Ethereum: the pool's own swap is the default there. */
export const isPoolPair = (a: Side, b: Side) => a.chain === "eth" && b.chain === "eth" && ((isNative("eth", a.token.address) && sameAddress(b.token.address, SHIFT_TOKEN)) || (sameAddress(a.token.address, SHIFT_TOKEN) && isNative("eth", b.token.address)));

/**
 * The multichain swap: Ethereum, Base, Robinhood Chain and Solana both ways, XRP as a destination. Routes from
 * LI.FI and Relay through the engine, NIGHTSHIFT's fee decided there for the signed-in wallet, every route checked
 * again here before the visitor's own wallet signs it, then followed until it arrives.
 */
export function MultiSwap({ onPool, preset: given }: { onPool: (side: "buy" | "sell") => void; preset?: Preset | null }) {
  const session = useSession();
  // the token this swap was opened for: given by the page, or named in the address (/swap?to=eth:0x…)
  const [preset] = useState<Preset | null>(() => (given === undefined ? presetFromUrl() : given));
  const [from, setFrom] = useState<Side>(() => { const c = preset?.from ?? "eth"; return { chain: c, token: nativeToken(c) }; });
  const [to, setTo] = useState<Side>({ chain: "rh", token: PINNED.find((t) => t.address === IMD_RH)! });
  const [presetNote, setPresetNote] = useState<string | null>(null);
  // a swap opened for one token (a launchpad coin): that token on the "you get" side
  useEffect(() => {
    if (!preset) return;
    let on = true;
    setPresetNote("Loading the token…");
    void presetToken(preset).then((t) => {
      if (!on) return;
      if (!t) { setPresetNote(`No token at ${shortAddr(preset.to.address)} on ${CHAINS[preset.to.chain].name}.`); return; }
      setTo({ chain: t.chain, token: t });
      setPresetNote(t.verified ? null : `${t.symbol} is not on the provider's verified list: check its address ${shortAddr(t.address)} before you swap.`);
    });
    return () => { on = false; };
  }, [preset?.to.chain, preset?.to.address]);
  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState(0.01);
  const [evm, setEvm] = useState<string | null>(null);
  const [sol, setSol] = useState<string | null>(null);
  const [dest, setDest] = useState("");
  const [editDest, setEditDest] = useState(false);
  const [fee, setFee] = useState<FeeInfo | null>(null);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [provErrors, setProvErrors] = useState<{ provider: string; error: string }[]>([]);
  const [qErr, setQErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<Quote["provider"] | null>(null);
  const [quotedAt, setQuotedAt] = useState(0);
  const [sheet, setSheet] = useState<"from" | "to" | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(loadSent);
  const [bal, setBal] = useState<bigint | null>(null);
  const seq = useRef(0);
  const busy = useRef(false);

  // a wallet connected on an earlier visit comes back without asking
  useEffect(() => { void knownWallet().then(async (p) => { if (!p) return; const a = (await p.request({ method: "eth_accounts" })) as string[]; if (a[0]) setEvm(a[0].toLowerCase()); }).catch(() => {}); }, []);
  useEffect(() => { if (session.address && !evm) setEvm(session.address.toLowerCase()); }, [session.address]);
  useEffect(() => { void swapApi.fee(evm).then(setFee).catch(() => setFee(null)); }, [evm, session.address]);

  const pool = isPoolPair(from, to);
  useEffect(() => { if (pool) onPool(isNative("eth", from.token.address) ? "buy" : "sell"); }, [pool]);

  const own = (c: ChainKey) => (kind(c) === "evm" ? evm : kind(c) === "svm" ? sol : null);
  const fromAddr = own(from.chain);
  const typed = dest.trim();
  const toAddr = kind(to.chain) === "xrpl" || editDest ? typed || null : own(to.chain);
  const destOk = toAddr !== null && validAddress(to.chain, toAddr);
  const ready = Boolean(fromAddr && destOk);
  const units = toUnits(amount, from.token.decimals);
  const req: QuoteRequest = {
    fromChain: from.chain, toChain: to.chain, fromToken: from.token.address, toToken: to.token.address, amount: units.toString(), slippage: slip,
    from: fromAddr ?? PREVIEW[kind(from.chain)], to: destOk ? toAddr! : PREVIEW[kind(to.chain)],
  };
  const reqKey = JSON.stringify(req);

  useEffect(() => {
    setBal(null);
    if (fromAddr) void balanceOf(from.chain, from.token.address, fromAddr).then(setBal);
  }, [from.chain, from.token.address, fromAddr, sent?.hash]);

  const ask = useCallback(async (r: QuoteRequest) => {
    const n = ++seq.current;
    setLoading(true); setQErr(null);
    try {
      const a = await swapApi.quote(r);
      if (n !== seq.current) return null;
      setQuotes(a.quotes); setProvErrors(a.errors); setQuotedAt(Date.now());
      if (!a.quotes.length) setQErr(a.errors.length ? `No route right now. ${a.errors.map((e) => `${e.provider === "lifi" ? "LI.FI" : "Relay"}: ${e.error}`).join(" ")}` : "No route for this pair right now.");
      return a.quotes;
    } catch (e) {
      if (n === seq.current) { setQuotes(null); setQErr(errText(e)); }
      return null;
    } finally { if (n === seq.current) setLoading(false); }
  }, []);

  // routes as you type; fresh every 30 seconds once they can be signed (a preview is not re-asked: LI.FI counts every quote)
  useEffect(() => {
    setQuotes(null); setProvErrors([]); setQErr(null); setChosen(null);
    if (pool || units <= 0n || from.chain === "xrpl") { seq.current++; setLoading(false); return; }
    const t = setTimeout(() => void ask(req), 500);
    const every = setInterval(() => { if (ready && !document.hidden && !busy.current) void ask(req); }, 30_000);
    return () => { clearTimeout(t); clearInterval(every); };
  }, [reqKey, pool, session.address]);

  const best = quotes?.find((q) => q.provider === chosen) ?? quotes?.[0] ?? null;
  const problems = best ? [...new Set(recheck(best, req))] : [];

  // following a transfer until it lands
  useEffect(() => {
    if (!sent || sent.state !== "pending") return;
    let on = true;
    const tick = async () => {
      try {
        const t = await swapApi.status(sent.provider === "relay" && sent.requestId ? { provider: "relay", id: sent.requestId, from: sent.fromChain, to: sent.toChain } : { provider: "lifi", tx: sent.hash, from: sent.fromChain, to: sent.toChain, ...(sent.tool ? { tool: sent.tool } : {}) });
        if (!on) return;
        const next = { ...sent, state: t.state, text: t.text, outUrl: t.outUrl ?? sent.outUrl };
        setSent(next); saveSent(next);
      } catch { /* try again on the next tick */ }
    };
    const first = setTimeout(tick, 3_000), every = setInterval(tick, 8_000);
    return () => { on = false; clearTimeout(first); clearInterval(every); };
  }, [sent?.hash, sent?.state]);

  const connect = async (c: ChainKey) => {
    setErr(null);
    try {
      if (kind(c) === "evm") {
        const w = await chooseWallet();
        const [a] = (await w.request({ method: "eth_requestAccounts" })) as string[];
        if (a) setEvm(a.toLowerCase());
      } else if (kind(c) === "svm") {
        const s = await chooseSolana();
        if (s) setSol(s.address);
      }
    } catch (e) { if (!rejected(e)) setErr(errText(e)); }
  };

  const swap = async () => {
    if (!best || !ready) return;
    setErr(null);
    busy.current = true;
    try {
      // the wallet that will sign must be the one quoted for: another one gets its own quote first
      const now = kind(from.chain) === "evm"
        ? (((await (await chooseWallet()).request({ method: "eth_requestAccounts" })) as string[])[0] ?? "").toLowerCase()
        : (await chooseSolana())?.address ?? "";
      if (!sameAddress(now, req.from)) {
        if (kind(from.chain) === "evm") setEvm(now || null); else setSol(now || null);
        throw new Error("Your wallet is not the one this quote was for: a new quote is on its way. Check it and swap again.");
      }
      let q: Quote | null = best;
      // a quote older than 25 s is asked again first: a Solana transaction carries a blockhash that expires
      if (Date.now() - quotedAt > 25_000) {
        setStep("Getting a fresh quote…");
        const fresh = await ask(req);
        q = fresh?.find((x) => x.provider === best.provider) ?? fresh?.[0] ?? null;
        if (!q) throw new Error("The route is gone. Try again.");
      }
      const p = [...new Set(recheck(q, req))];
      if (p.length) throw new Error(`Refused before signing: ${p[0]}`);
      const hash = kind(from.chain) === "evm" ? await runEvm(q, req, setStep) : await runSvm(q, req, setStep);
      const s: Sent = { provider: q.provider, fromChain: q.fromChain, toChain: q.toChain, hash, requestId: q.track.requestId, tool: q.track.tool, at: Date.now(), out: `${amountText(q.toAmount, q.toToken.decimals)} ${q.toToken.symbol}`, state: "pending", text: q.fromChain === q.toChain ? "Sent." : `Sent. Arrives on ${CHAINS[q.toChain].name} in ${etaText(q.etaSeconds)}.` };
      setSent(s); saveSent(s); setAmount("");
    } catch (e) { setErr(rejected(e) ? "You declined in the wallet. Nothing was sent." : errText(e)); } finally { setStep(null); busy.current = false; }
  };

  const flip = () => {
    if (to.chain === "xrpl") { setErr(XRPL_SOURCE_SOON); return; }
    setFrom(to); setTo(from); setAmount(""); setDest(""); setEditDest(false);
  };
  const choose = (side: "from" | "to", t: Token) => {
    const s = { chain: t.chain, token: t };
    if (side === "from") setFrom(s); else { setTo(s); if (s.chain !== to.chain) { setDest(""); setEditDest(false); } }
    setSheet(null);
  };

  const short = bal !== null && units > bal;
  const out = best && !problems.length ? amountText(best.toAmount, best.toToken.decimals) : "0.0";
  const button = (() => {
    if (step) return { text: step, go: null };
    if (!fromAddr) return { text: `Connect ${CHAINS[from.chain].name} wallet`, go: () => void connect(from.chain) };
    if (!destOk) return kind(to.chain) === "xrpl" || editDest ? { text: `Type your ${CHAINS[to.chain].name} address`, go: null } : { text: `Connect ${CHAINS[to.chain].name} wallet`, go: () => void connect(to.chain) };
    if (units <= 0n) return { text: "Type an amount", go: null };
    if (short) return { text: `Not enough ${from.token.symbol}`, go: null };
    if (!best) return { text: loading ? "Finding routes…" : "No route", go: null };
    if (problems.length) return { text: "Route refused", go: null };
    return { text: `Swap through ${best.providerName}`, go: () => void swap() };
  })();

  const feeLine = fee && (fee.waived
    ? <p className="ms-fee good">{fee.note}</p>
    : fee.reason === "sign-in"
      ? <p className="ms-fee">{fee.note} <button type="button" className="ms-link" disabled={session.busy} onClick={() => void session.signIn()}>{session.busy ? "Signing in…" : "Sign in"}</button></p>
      : <p className="ms-fee">{fee.note}</p>);

  return (
    <div className="ms">
      <section className="ms-card" aria-label="Multichain swap">
        <div className="ms-leg">
          <div className="ms-leg-h"><span>You pay</span>{bal !== null && <button type="button" className="ms-link" onClick={() => setAmount(formatUnits(isNative(from.chain, from.token.address) ? (bal * 97n) / 100n : bal, from.token.decimals))}>Balance {amountText(bal, from.token.decimals)}</button>}</div>
          <div className="ms-leg-b">
            <input className="ms-amt" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} aria-label="Amount to pay" />
            <TokenButton s={from} onClick={() => setSheet("from")} />
          </div>
          {best?.fromUsd != null && units > 0n && <div className="ms-leg-f">{usdText(best.fromUsd)}</div>}
        </div>
        <button type="button" className="ms-flip" onClick={flip} aria-label="Swap the two sides">⇅</button>
        <div className="ms-leg">
          <div className="ms-leg-h"><span>You get, about</span>{loading && <i className="ms-dots">finding routes</i>}</div>
          <div className="ms-leg-b">
            <b className={`ms-amt ms-out${best ? "" : " dim"}`}>{out}</b>
            <TokenButton s={to} onClick={() => setSheet("to")} />
          </div>
          {best?.toUsd != null && !problems.length && <div className="ms-leg-f">{usdText(best.toUsd)} · {etaText(best.etaSeconds)}</div>}
        </div>
        <div className="ms-dest">
          {kind(to.chain) === "xrpl" ? (
            <>
              <label><span>Your XRP Ledger address</span><input className="ms-in" placeholder="r…" value={dest} onChange={(e) => setDest(e.target.value.trim())} spellCheck={false} autoComplete="off" /></label>
              {typed && !destOk && <p className="bad">That is not a valid XRP Ledger address.</p>}
              <p className="ms-fine">Your own wallet, not an exchange deposit address: Relay sends no destination tag. A new address needs at least 1 XRP (the ledger's reserve) to open.</p>
            </>
          ) : editDest ? (
            <label><span>Receive on {CHAINS[to.chain].name} at</span><input className="ms-in" placeholder={kind(to.chain) === "evm" ? "0x…" : "Solana address"} value={dest} onChange={(e) => setDest(e.target.value.trim())} spellCheck={false} autoComplete="off" /><button type="button" className="ms-link" onClick={() => { setEditDest(false); setDest(""); }}>Use my wallet</button></label>
          ) : (
            <p className="ms-to">To {toAddr ? <code>{shortAddr(toAddr)}</code> : <i>your {CHAINS[to.chain].name} wallet</i>} <button type="button" className="ms-link" onClick={() => setEditDest(true)}>Another address</button></p>
          )}
        </div>
        <div className="ms-slip" role="group" aria-label="Slippage"><span>Slippage</span>{SLIPS.map((s) => <button key={s} type="button" className={slip === s ? "on" : ""} onClick={() => setSlip(s)}>{s * 100}%</button>)}</div>
        {feeLine}
        <button type="button" className="ns-cta sm app-cta ms-go" disabled={!button.go} onClick={button.go ?? undefined}>{button.text}</button>
        {from.chain === "xrpl" && <p className="ms-fine">{XRPL_SOURCE_SOON}</p>}
        {presetNote && <p className="ms-fine">{presetNote}</p>}
        {qErr && !step && <p className="bad ms-msg">{qErr}</p>}
        {err && <p className="bad ms-msg">{err}</p>}
      </section>

      <aside className="ms-side">
        {sent && <Transfer s={sent} onClear={() => { setSent(null); saveSent(null); }} />}
        {best ? <RouteCard q={best} others={(quotes ?? []).filter((q) => q !== best)} pick={(q) => setChosen(q.provider)} preview={!ready} problems={problems} />
          : !sent && <div className="ms-route ms-empty"><b>Routes appear here</b><p>Pick what you pay and what you get, type an amount. LI.FI and Relay are asked at once; the better route after every fee comes first.</p></div>}
        {provErrors.length > 0 && best && <p className="ms-fine">{provErrors.map((e) => `${e.provider === "lifi" ? "LI.FI" : "Relay"} had no route: ${e.error}`).join(" ")}</p>}
      </aside>

      {sheet && <TokenSheet side={sheet} chain={sheet === "from" ? from.chain : to.chain} onPick={(t) => choose(sheet, t)} onClose={() => setSheet(null)} />}
    </div>
  );
}

function TokenButton({ s, onClick }: { s: Side; onClick: () => void }) {
  return (
    <button type="button" className="ms-tokbtn" onClick={onClick}>
      <TokenLogo t={s.token} />
      <span><b>{s.token.symbol}</b><i>{CHAINS[s.chain].name}</i></span>
      <em aria-hidden="true">▾</em>
    </button>
  );
}

function Transfer({ s, onClear }: { s: Sent; onClear: () => void }) {
  const done = s.state !== "pending";
  return (
    <div className={`ms-route ms-transfer ${s.state}`} aria-live="polite">
      <div className="ms-route-h"><b>{s.state === "done" ? "Arrived" : s.state === "failed" ? "Failed" : s.state === "refunded" ? "Refunded" : "On its way"}</b><span>{s.out}</span></div>
      <ol className="ms-steps">
        <li className="ok">Sent on {CHAINS[s.fromChain].name} <a href={`${CHAINS[s.fromChain].tx}${s.hash}`} target="_blank" rel="noreferrer">{shortAddr(s.hash)} ↗</a></li>
        <li className={done ? (s.state === "done" ? "ok" : "bad") : "now"}>{s.text}{s.outUrl && <> <a href={s.outUrl} target="_blank" rel="noreferrer">on {CHAINS[s.toChain].name} ↗</a></>}</li>
      </ol>
      {done && <button type="button" className="ms-link" onClick={onClear}>Clear</button>}
    </div>
  );
}
