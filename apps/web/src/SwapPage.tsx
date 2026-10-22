import { Suspense, lazy, useEffect, useRef, useState } from "react";
import "./mswap/page.css";
import { LIVE_LAUNCH, SHIFT, SHIFT_POOL, fetchLaunch } from "./shift";
import { type Address, createPublicClient, createWalletClient, custom, erc20Abi, formatEther, http, maxUint256, parseEther } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";
import { type Step, canBatch, sendSteps } from "./batch";
import { type PoolKey, V4, permit2Abi, quoteArgs, quoterAbi, routerAbi, swapCall } from "./v4";

// the multichain swap and its provider code load with /swap only, not with every page
const MultiSwap = lazy(() => import("./mswap/MultiSwap").then((m) => ({ default: m.MultiSwap })));

const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
type Launch = { token?: string; symbol: string; open?: boolean; pool?: PoolKey } | null;
const SLIPPAGE = [1, 3, 5, 10];
const fmt = (v: bigint, d = 6) => { const n = Number(formatEther(v)); return n === 0 ? "0" : n < 1e-6 ? n.toExponential(2) : n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : d }); };
const errText = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "").split("\n")[0]!.slice(0, 160);

/**
 * NIGHTSHIFT Swap: buy and sell $SHIFT with ETH straight through its Uniswap v4 pool and hook,
 * from your own wallet. The site adds no fee and holds nothing: one Universal Router call, quoted
 * first by Uniswap's own V4 Quoter, signed in your wallet.
 */
export function SwapBox({ launch, initialSide = "buy" }: { launch?: Launch; initialSide?: "buy" | "sell" } = {}) {
  const [fetchedLaunch, setFetchedLaunch] = useState<Launch>(LIVE_LAUNCH);
  const l = launch === undefined ? fetchedLaunch : launch;
  const [me, setMe] = useState<Address | null>(null);
  const [side, setSide] = useState<"buy" | "sell">(initialSide);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<bigint | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [slip, setSlip] = useState(3);
  const [bal, setBal] = useState<{ eth: bigint; shift: bigint } | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (launch !== undefined) return;
    void fetchLaunch<Launch>(LIVE_LAUNCH).then(setFetchedLaunch);
  }, [launch]);
  // the pool key and token are pinned in the page; the server only says whether trading is live
  const pool = l?.pool ? SHIFT_POOL : null;
  const token = pool ? SHIFT.token : undefined;
  const sym = l?.symbol ?? "SHIFT";

  const loadBal = async (who = me) => {
    if (!who || !token) return;
    const [e, s] = await Promise.all([rpc.getBalance({ address: who }), rpc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] })]).catch(() => [0n, 0n]);
    setBal({ eth: e, shift: s });
  };
  useEffect(() => { void loadBal(); }, [me, token]);

  // Quote as you type, from Uniswap's quoter, as your wallet (the launch gate looks at who signs).
  const amt = (() => { try { return amount && Number(amount) > 0 ? parseEther(amount) : 0n; } catch { return 0n; } })();
  useEffect(() => {
    setQuote(null); setQErr(null);
    if (!pool || !amt) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await rpc.simulateContract({ account: me ?? undefined, address: V4.quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: quoteArgs(pool, side === "buy", amt) as never });
        if (n === seq.current) setQuote((r.result as readonly bigint[])[0]!);
      } catch (e) {
        if (n === seq.current) setQErr(l?.open ? `No quote: ${errText(e)}` : "Trading opens right after the treasury's first buy.");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [amount, side, pool?.hooks, me]);

  const connect = async () => {
    setErr(null);
    try {
      const w = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet()) as never) });
      const [a] = await w.requestAddresses();
      setMe(a ?? null);
    } catch (e) { setErr(errText(e)); }
  };

  const swap = async () => {
    if (!pool || !token || !amt || !quote) return;
    setErr(null); setDone(null);
    try {
      const w = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet()) as never) });
      const [a] = await w.requestAddresses();
      if (!a) throw new Error("No account in the wallet.");
      setMe(a);
      setStep("Switch to Ethereum…");
      await w.switchChain({ id: 1 });
      const steps: Step[] = [];
      if (side === "sell") {
        // Selling goes through Permit2: the token allows Permit2 exactly this amount, and Permit2 the
        // router exactly this amount for 30 minutes, so no standing permission to pull SHIFT is left behind.
        // Permit2 (Uniswap's own contract, used by every Uniswap swap) gets the standard one-time approval; what it may
        // pass to the router is set per sell, exact and for 30 minutes, so a wallet that cannot batch signs twice, not three times.
        const toPermit2 = await rpc.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [a, V4.permit2] });
        if (toPermit2 < amt) steps.push({ call: { address: token, abi: erc20Abi, functionName: "approve", args: [V4.permit2, maxUint256] }, sign: `Once for this wallet: let Uniswap's Permit2 use your ${sym}…`, wait: "Waiting for the approval…", fail: "The approval failed. Nothing was sold." });
        const [p2, until] = await rpc.readContract({ address: V4.permit2, abi: permit2Abi, functionName: "allowance", args: [a, token, V4.router] });
        const nowSec = Math.floor(Date.now() / 1000);
        if (p2 < amt || until <= nowSec + 60) steps.push({ call: { address: V4.permit2, abi: permit2Abi, functionName: "approve", args: [token, V4.router, amt, nowSec + 30 * 60] }, sign: "Let the Uniswap router use this amount…", wait: "Waiting for the approval…", fail: "The router approval failed. Nothing was sold." });
      }
      const minOut = (quote * BigInt(100 * (100 - slip))) / 10_000n;
      const c = swapCall(pool, side === "buy", amt, minOut, BigInt(Math.floor(Date.now() / 1000) + 900));
      steps.push({ call: { address: V4.router, abi: routerAbi, functionName: "execute", args: [c.commands, c.inputs, c.deadline], value: side === "buy" ? amt : 0n }, sign: `Confirm the ${side} in your wallet…`, wait: "Waiting for Ethereum…" });
      const batched = steps.length > 1 && (await canBatch(w, a));
      const r = await sendSteps(w, a, steps, { batched, once: `Confirm once in your wallet (approve + ${side})…`, say: setStep });
      if (!r.ok) throw new Error("The swap reverted. Nothing was spent but gas.");
      const hash = r.hash;
      setDone(hash); setAmount(""); void loadBal(a);
    } catch (e) { setErr(errText(e)); } finally { setStep(null); }
  };

  const have = side === "buy" ? bal?.eth : bal?.shift;
  const short = Boolean(have !== undefined && amt > (have ?? 0n));
  const inSym = side === "buy" ? "ETH" : `$${sym}`;
  const outSym = side === "buy" ? `$${sym}` : "ETH";

  return (
      <section className="tkn-card swap-card" aria-label="Swap">
        <div className="tkn-head">
          <div><b>SWAP</b><span>Ethereum · Uniswap v4 · ${sym}/ETH</span></div>
          <span className="tkn-state">{pool ? (l?.open ? "LIVE" : "WAITING") : "SOON"}</span>
        </div>
        <div className="swap-tabs" role="tablist">
          {(["buy", "sell"] as const).map((s) => <button key={s} role="tab" aria-selected={side === s} className={side === s ? "on" : ""} onClick={() => { setSide(s); setAmount(""); }}>{s === "buy" ? `Buy $${sym}` : `Sell $${sym}`}</button>)}
        </div>
        <div className="swap-box">
          <label className="swap-leg"><span>You pay {have !== undefined && <button type="button" className="swap-max" onClick={() => setAmount(formatEther(side === "buy" ? ((have ?? 0n) * 95n) / 100n : have ?? 0n))}>balance {fmt(have ?? 0n)}</button>}</span>
            <div><input className="swap-in" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} disabled={!pool} /><i>{inSym}</i></div></label>
          <div className="swap-flip" aria-hidden="true">↓</div>
          <div className="swap-leg"><span>You get, about</span><div><b>{quote !== null ? fmt(quote) : "0.0"}</b><i>{outSym}</i></div></div>
          <div className="swap-slip"><span>Slippage</span>{SLIPPAGE.map((s) => <button key={s} className={slip === s ? "on" : ""} onClick={() => setSlip(s)}>{s}%</button>)}</div>
          {qErr && <p className="dim" style={{ fontSize: 13, margin: 0 }}>{qErr}</p>}
          {side === "sell" && <p className="dim" style={{ fontSize: 13, margin: 0 }}>Sells pay 5% (2.5% in ${sym}, 2.5% in ETH), split by <a href="/tokenomics#rule">the one rule</a>; the quote already includes it.</p>}
          {!me ? <button className="ns-cta sm app-cta" onClick={() => void connect()} disabled={!pool}>{pool ? "CONNECT WALLET" : "OPENS AT LAUNCH"}</button>
            : <button className="ns-cta sm app-cta" onClick={() => void swap()} disabled={!pool || !quote || short || Boolean(step)}>{step ?? (short ? `NOT ENOUGH ${inSym}` : side === "buy" ? `BUY $${sym}` : `SELL $${sym}`)}</button>}
          {err && <p className="bad" style={{ fontSize: 13, margin: 0 }}>{err}</p>}
          {done && <p className="good" style={{ fontSize: 13, margin: 0 }}>Done. <a href={`https://etherscan.io/tx/${done}`} target="_blank" rel="noreferrer">See it on Etherscan ↗</a></p>}
        </div>
        {token && <div className="swap-links">
          <a href={`https://app.uniswap.org/swap?chain=mainnet&inputCurrency=NATIVE&outputCurrency=${token}`} target="_blank" rel="noreferrer">Uniswap ↗</a>
          <a href={`https://dexscreener.com/ethereum/${token}`} target="_blank" rel="noreferrer">Chart ↗</a>
          <a href={`https://etherscan.io/token/${token}`} target="_blank" rel="noreferrer">Etherscan ↗</a>
        </div>}
        {!pool && <p className="tkn-warn">Not open yet. This page switches on by itself when $SHIFT is deployed; any other site or link offering $SHIFT before that is fake.</p>}
      </section>
  );
}

/**
 * /swap: the multichain swap (Ethereum, Base, Robinhood Chain, Solana, and into XRP) through LI.FI and Relay,
 * and $SHIFT's own pool swap, the default for ETH and $SHIFT on Ethereum.
 */
export function SwapPage() {
  const [l, setL] = useState<Launch>(LIVE_LAUNCH);
  useEffect(() => { void fetchLaunch<Launch>(LIVE_LAUNCH).then(setL); }, []);
  const [mode, setMode] = useState<"any" | "pool">(() => (new URLSearchParams(location.search).get("pool") !== null ? "pool" : "any"));
  const [poolSide, setPoolSide] = useState<"buy" | "sell">("buy");
  const sym = l?.symbol ?? "SHIFT";
  return (
    <div className="docs token-page swap-page">
      <span className="eyebrow">LIVE · ETHEREUM · BASE · ROBINHOOD CHAIN · SOLANA · XRP</span>
      <h1>NIGHTSHIFT Swap. <em>Five chains, your own wallet.</em></h1>
      <p className="lead">Swap between Ethereum, Base, Robinhood Chain and Solana, and into XRP on the XRP Ledger. LI.FI and Relay find the route; your wallet signs every step; NIGHTSHIFT holds nothing. Holders of a NIGHT FROG, a Night Watcher or 5M+ $SHIFT pay no NIGHTSHIFT fee.</p>

      <div className="ms-modes" role="tablist" aria-label="Swap">
        <button type="button" role="tab" aria-selected={mode === "any"} className={mode === "any" ? "on" : ""} onClick={() => setMode("any")}>Any chain</button>
        <button type="button" role="tab" aria-selected={mode === "pool"} className={mode === "pool" ? "on" : ""} onClick={() => setMode("pool")}>${sym} pool</button>
      </div>
      {mode === "any"
        ? <Suspense fallback={<div style={{ minHeight: 420 }}><p className="ms-fine">Loading the swap…</p></div>}><MultiSwap onPool={(side) => { setPoolSide(side); setMode("pool"); }} /></Suspense>
        : <div className="ms-pool">
            <SwapBox launch={l} initialSide={poolSide} key={poolSide} />
            <p className="ms-fine">ETH and ${sym} on Ethereum trade here, straight in the pool: no aggregator and no NIGHTSHIFT fee. ${sym} from another chain or token: <button type="button" className="ms-link" onClick={() => setMode("any")}>Any chain</button>.</p>
          </div>}

      <h2>How it works</h2>
      <ul className="frogs-util">
        <li><b>Two route finders, asked at once</b>LI.FI (bridges and exchanges across Ethereum, Base, Robinhood Chain and Solana) and Relay (the same chains plus native XRP). The route that delivers more after every fee comes first; the other one sits beside it.</li>
        <li><b>Fees, apart</b>the provider's own fees (LI.FI's 0.25% service fee, bridge and relayer fees) and NIGHTSHIFT's fee are shown on separate lines before you sign. Signed in with a wallet that holds a NIGHT FROG, a Night Watcher or 5M+ ${sym}, NIGHTSHIFT's fee is 0 on every chain.</li>
        <li><b>Checked before you sign</b>the page only signs calls to the LI.FI and Relay contracts pinned in its code, shows each one with its address, simulates every transaction first, and allows a token exactly the amount you swap, never unlimited.</li>
        <li><b>Followed to the end</b>after you send, the page follows the transfer with the provider until it lands on the other chain, with both transactions linked.</li>
        <li><b>XRP</b>into XRP works now: you type your XRP Ledger address. Out of XRP is coming: it needs an XRP Ledger wallet in the page and a tested payment to the provider's XRPL account.</li>
        <li><b>${sym} stays in its pool</b>ETH ↔ ${sym} on Ethereum goes through the Uniswap v4 pool and its hook, as before (${sym} pool tab). The pool's 1.25% and the 5% sell fee apply as always.</li>
      </ul>
      <p className="dim">Research and sources: <a href="https://github.com/RobertKodes/nightshift/blob/main/docs/swap/RESEARCH.md" target="_blank" rel="noreferrer">docs/swap/RESEARCH.md</a>. The routes are LI.FI's and Relay's; cross-chain transfers carry their bridges' risks. V4 router for the pool: <code>{V4.router.slice(0, 6)}…{V4.router.slice(-4)}</code>.</p>
    </div>
  );
}
