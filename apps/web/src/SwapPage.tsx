import { useEffect, useRef, useState } from "react";
import { SHIFT, SHIFT_POOL } from "./shift";
import { type Address, createPublicClient, createWalletClient, custom, erc20Abi, formatEther, http, maxUint256, parseEther } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";
import { type PoolKey, V4, permit2Abi, quoteArgs, quoterAbi, routerAbi, swapCall } from "./v4";

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
export function SwapBox({ launch }: { launch?: Launch } = {}) {
  const [fetchedLaunch, setFetchedLaunch] = useState<Launch>(null);
  const l = launch === undefined ? fetchedLaunch : launch;
  const [me, setMe] = useState<Address | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
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
    void fetch("/api/token").then((r) => r.json()).then((d) => setFetchedLaunch(d.launch ?? null)).catch(() => {});
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
      if (side === "sell") {
        // Selling goes through Permit2: one approval for the token (once), then for the router exactly
        // this amount for 30 minutes, so no standing permission to pull SHIFT is left behind.
        const toPermit2 = await rpc.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [a, V4.permit2] });
        if (toPermit2 < amt) {
          setStep(`Approve ${sym} for Uniswap's Permit2 (once)…`);
          const h = await w.writeContract({ account: a, chain: mainnet, address: token, abi: erc20Abi, functionName: "approve", args: [V4.permit2, maxUint256] });
          await rpc.waitForTransactionReceipt({ hash: h });
        }
        const [p2, until] = await rpc.readContract({ address: V4.permit2, abi: permit2Abi, functionName: "allowance", args: [a, token, V4.router] });
        const nowSec = Math.floor(Date.now() / 1000);
        if (p2 < amt || until <= nowSec + 60) {
          setStep("Let the Uniswap router use this amount…");
          const h = await w.writeContract({ account: a, chain: mainnet, address: V4.permit2, abi: permit2Abi, functionName: "approve", args: [token, V4.router, amt, nowSec + 30 * 60] });
          await rpc.waitForTransactionReceipt({ hash: h });
        }
      }
      const minOut = (quote * BigInt(100 * (100 - slip))) / 10_000n;
      const c = swapCall(pool, side === "buy", amt, minOut, BigInt(Math.floor(Date.now() / 1000) + 900));
      setStep(`Confirm the ${side} in your wallet…`);
      const hash = await w.writeContract({ account: a, chain: mainnet, address: V4.router, abi: routerAbi, functionName: "execute", args: [c.commands, c.inputs, c.deadline], value: side === "buy" ? amt : 0n });
      setStep("Waiting for Ethereum…");
      const r = await rpc.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("The swap reverted. Nothing was spent but gas.");
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

export function SwapPage() {
  const [l, setL] = useState<Launch>(null);
  useEffect(() => { void fetch("/api/token").then((r) => r.json()).then((d) => setL(d.launch ?? null)).catch(() => {}); }, []);
  const pool = l?.pool ?? null;
  const sym = l?.symbol ?? "SHIFT";
  return (
    <div className="docs token-page swap-page">
      <span className="eyebrow">{pool ? (l?.open ? "LIVE · ETHEREUM" : "DEPLOYED · OPENS WITH THE FIRST BUY") : "OPENS AT LAUNCH"}</span>
      <h1>NIGHTSHIFT Swap. <em>${sym} for ETH, straight from its pool.</em></h1>
      <p className="lead">Buy and sell ${sym} from your own wallet, through its Uniswap v4 pool and hook. No extra fee from us, nothing held by us: Uniswap's quoter prices it, Uniswap's router swaps it, your wallet signs it.</p>

      <SwapBox launch={l} />

      <h2>How it works</h2>
      <ul className="frogs-util">
        <li><b>Straight to the pool</b>: one call to Uniswap's Universal Router <code>{V4.router.slice(0, 6)}…{V4.router.slice(-4)}</code> on the ${sym}/ETH v4 pool with the NIGHTSHIFT hook. You can check every address on Etherscan.</li>
        <li><b>Priced by Uniswap</b>: the quote comes from Uniswap's V4 Quoter, and your minimum is that quote less your slippage. Below it, the swap reverts and you keep your funds.</li>
        <li><b>Fees, plainly</b>: every trade pays the pool's 1.25% (1% to the launch payer, 0.25% to IMD). Sells also pay 5%, split by the one rule: stakers and NIGHT FROGS holders, the dev wallet, the treasury, and SHIFT and IMD burns.</li>
        <li><b>Selling, once</b>: the first sell asks for two approvals (Permit2, then the router), as on Uniswap. After that, one signature.</li>
      </ul>
    </div>
  );
}
