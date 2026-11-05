import { ethTransport } from "./ethRpc";
import { useEffect, useRef, useState } from "react";
import { LIVE_LAUNCH, SHIFT, fetchLaunch } from "./shift";
import { type Address, createPublicClient, createWalletClient, custom, erc20Abi, fallback, formatEther, http, parseAbi, parseAbiItem, parseEther } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet, knownWallet } from "./wallet";
import { useSession } from "./session";
import { type Step, canBatch, sendSteps } from "./batch";
import { useStaked } from "./StakedCounter";
import SloshGauge from "./rb/SloshGauge";
import { PxButton, PxHero, PxNum, PxPanel, PxSection } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { Flap, HeroDots, ShStar } from "./saas/pages/shift-kit";
import "./saas/pages/stake.css";

const rpc = createPublicClient({ chain: mainnet, transport: ethTransport() });
// publicnode refuses logs older than its recent window, so the stake history is read from nodes that serve them
const logs = createPublicClient({ chain: mainnet, transport: fallback([http("https://rpc.mevblocker.io"), http("https://eth.drpc.org"), http("https://ethereum-rpc.publicnode.com")]) });
/** ShiftRewards, as fixed in the launch spec IMD checked: stake with a lock, withdraw unlocked, claim. */
const REWARDS = parseAbi([
  "function stake(uint256 amount, uint256 lockDays)",
  "function withdraw(uint256 amount)",
  "function getReward()",
  "function balanceOf(address account) view returns (uint256)",
  "function earned(address account, address token) view returns (uint256)",
]);
const STAKED = parseAbiItem("event Staked(address indexed account, uint256 amount, uint256 unlockAt)");
const WITHDRAWN = parseAbiItem("event Withdrawn(address indexed account, uint256 amount)");
const PAID = parseAbiItem("event RewardPaid(address indexed account, address indexed token, uint256 amount)");
const LOCKS: [number, string][] = [[0, "No lock"], [30, "1 month"], [90, "3 months"], [180, "6 months"], [365, "12 months"], [730, "24 months"]];

type Launch = { token?: string; symbol: string; scanFrom?: number; contracts?: Record<string, string> } | null;
type Stake = { amount: bigint; unlockAt: number; tx: string };
const fmt = (v: bigint) => Number(formatEther(v)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const errText = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "").split("\n")[0]!.slice(0, 160);

/**
 * Stops before the wallet opens when this wallet cannot pay Ethereum's fee for about `gas` units (with room for a
 * rise): otherwise the wallet's own check fails and the page can only show an empty "reverted".
 */
async function feeCheck(a: Address, gas: bigint) {
  const [balance, price] = await Promise.all([rpc.getBalance({ address: a }), rpc.getGasPrice()]).catch(() => [null, null] as const);
  if (balance === null || price === null) return; // the wallet still checks for itself
  const need = (gas * price * 3n) / 2n, eth = (v: bigint) => Number(formatEther(v)).toPrecision(2);
  if (balance < need) throw new Error(`This wallet has ${eth(balance)} ETH, not enough for the Ethereum network fee (about ${eth(need)} ETH). Add a little ETH on Ethereum to this wallet, then try again.`);
}

/** The stake history the server keeps; null when it cannot answer. */
async function serverHistory(who: Address) {
  try {
    const r = await fetch(`/api/stake/history/${who}`, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const d = await r.json() as { stakes: { amount: string; unlockAt: number; tx: string }[]; out: string; paidEth: string };
    return { stakes: d.stakes.map((s) => ({ amount: BigInt(s.amount), unlockAt: s.unlockAt, tx: s.tx })), out: BigInt(d.out), paidEth: BigInt(d.paidEth) };
  } catch { return null; }
}

/** Reads the stake history: from the server first, else from Ethereum directly, retrying (free nodes drop requests). */
async function historyRetry(rewards: Address, who: Address, from: bigint) {
  const kept = await serverHistory(who);
  if (kept) return kept;
  for (let i = 0; ; i++) {
    try { return await history(rewards, who, from); } catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
}

/** Your stakes are read from the contract's own events, so the page needs no extra view function. */
async function history(rewards: Address, who: Address, from: bigint) {
  const head = await logs.getBlockNumber();
  const stakes: Stake[] = [];
  let out = 0n;
  let paid = 0n;
  for (let a = from; a <= head; a += 9_000n) {
    const range = { address: rewards, args: { account: who }, fromBlock: a, toBlock: a + 8_999n > head ? head : a + 8_999n };
    const [s, w, p] = await Promise.all([logs.getLogs({ ...range, event: STAKED }), logs.getLogs({ ...range, event: WITHDRAWN }), logs.getLogs({ ...range, event: PAID })]);
    for (const l of s) stakes.push({ amount: l.args.amount!, unlockAt: Number(l.args.unlockAt!), tx: l.transactionHash! });
    for (const l of w) out += l.args.amount!;
    for (const l of p) paid += l.args.token === "0x0000000000000000000000000000000000000000" ? l.args.amount! : 0n;
  }
  return { stakes, out, paidEth: paid };
}

/** Stake $SHIFT in ShiftRewards: the longer the lock and the bigger the stake, the bigger the share. */
export function StakePage() {
  const [l, setL] = useState<Launch>(LIVE_LAUNCH);
  const [me, setMe] = useState<Address | null>(null);
  // the account the wallet is on now, when it differs from the one this page reads
  const [walletOn, setWalletOn] = useState<Address | null>(null);
  const session = useSession();
  const signedIn = (session.address ?? null) as Address | null;
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  // signed in: read that wallet's stake straight away, whatever account a wallet extension happens to be on
  useEffect(() => { if (signedIn && !me) setMe(signedIn); }, [signedIn]);
  const [amount, setAmount] = useState("");
  const [out, setOut] = useState("");
  // one card, two sides: stake, or take part of it out (/stake?unstake opens on that side)
  const [mode, setMode] = useState<"stake" | "unstake">(() => (new URLSearchParams(location.search).has("unstake") ? "unstake" : "stake"));
  const [lock, setLock] = useState(365);
  const [bal, setBal] = useState<bigint | null>(null);
  const [h, setH] = useState<Awaited<ReturnType<typeof history>> | null>(null);
  const [hErr, setHErr] = useState(false);
  const [onChain, setOnChain] = useState<{ staked: bigint | null; eth: bigint | null; shift: bigint | null }>({ staked: null, eth: null, shift: null });
  const [step, setStep] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);

  useEffect(() => { void fetchLaunch<Launch>(LIVE_LAUNCH).then(setL); }, []);
  // the server only says whether $SHIFT is live; the addresses are pinned in the page
  const rewards = l?.contracts?.rewards ? SHIFT.rewards : undefined;
  const token = l?.contracts?.token || l?.token ? SHIFT.token : undefined;
  const sym = l?.symbol ?? "SHIFT";
  const ready = Boolean(rewards && token);

  // only the latest read may update the page, so a slow old read never overwrites a newer one
  const seq = useRef(0);
  const meRef = useRef<Address | null>(null);
  meRef.current = me;
  const load = async (who = meRef.current) => {
    if (!who || !rewards || !token) return null;
    const n = ++seq.current;
    const read = (functionName: "balanceOf" | "earned", args: readonly unknown[]) => rpc.readContract({ address: rewards, abi: REWARDS, functionName, args } as never).then((x) => x as bigint, () => null);
    const [b, hist, st, eth, sh] = await Promise.all([
      rpc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] }).catch(() => null),
      historyRetry(rewards, who, BigInt(Math.max(0, (l?.scanFrom ?? 0) - 100))).catch(() => null),
      read("balanceOf", [who]), read("earned", [who, "0x0000000000000000000000000000000000000000"]), read("earned", [who, token]),
    ]);
    if (n !== seq.current || who.toLowerCase() !== meRef.current?.toLowerCase()) return hist;
    if (b !== null) setBal(b);
    if (hist) { setH(hist); setHErr(false); } else if (!h) setHErr(true);
    setOnChain({ staked: st, eth, shift: sh });
    return hist;
  };
  useEffect(() => { void load(); }, [me, rewards]);
  // while the page is open: refresh every 20 s (when visible) and when you come back to it
  useEffect(() => {
    if (!me || !rewards) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 20_000);
    const back = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, [me, rewards]);
  // the wallet this person chose reconnects silently (never just window.ethereum, which may be another
  // extension or account), and a switched account is followed
  useEffect(() => {
    let prov: { request: (a: { method: string }) => Promise<unknown>; on?: (e: string, f: (a: string[]) => void) => void; removeListener?: (e: string, f: (a: string[]) => void) => void } | null = null;
    const changed = (a: string[]) => {
      const x = (a?.[0] ?? null) as Address | null;
      if (signedIn && x && x.toLowerCase() !== signedIn.toLowerCase()) { setWalletOn(x); return; }
      setWalletOn(null);
      if (x && x.toLowerCase() !== meRef.current?.toLowerCase()) { setH(null); setOnChain({ staked: null, eth: null, shift: null }); setMe(x); }
    };
    void knownWallet().then((p) => {
      prov = p as typeof prov;
      if (!prov) return;
      void prov.request({ method: "eth_accounts" }).then((a) => { const x = (a as string[])?.[0]; if (x) { if (!meRef.current) setMe(x as Address); changed([x]); } }).catch(() => {});
      prov.on?.("accountsChanged", changed);
    }).catch(() => {});
    return () => prov?.removeListener?.("accountsChanged", changed);
  }, [signedIn]);

  const wallet = async () => {
    const w = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet()) as never) });
    const [a] = await w.requestAddresses();
    if (!a) throw new Error("No account in the wallet.");
    if (signedIn && a.toLowerCase() !== signedIn.toLowerCase()) { setWalletOn(a); throw new Error(`Your wallet is on ${short(a)}, but you are signed in as ${short(signedIn)}. Switch the account in your wallet to ${short(signedIn)}, then try again.`); }
    setWalletOn(null);
    setMe(a);
    await w.switchChain({ id: 1 });
    return { w, a };
  };
  const run = async (label: string, fn: (w: Awaited<ReturnType<typeof wallet>>) => Promise<`0x${string}`>) => {
    setMsg(null);
    try {
      const x = await wallet();
      setStep(label);
      const tx = await fn(x);
      setStep("Waiting for Ethereum…");
      const r = await rpc.waitForTransactionReceipt({ hash: tx });
      setMsg(r.status === "success" ? { ok: true, text: "Done.", tx } : { ok: false, text: "It reverted. Nothing moved but gas.", tx });
      if (r.status === "success") window.dispatchEvent(new Event("ns-staked")); // the staked total refreshes now, not in a minute
      // nodes can be a block or two behind the receipt: read now and again shortly after
      void load(x.a); for (const ms of [4_000, 12_000, 30_000]) setTimeout(() => void load(x.a), ms);
    } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setStep(null); }
  };

  const amt = (() => { try { return amount && Number(amount) > 0 ? parseEther(amount) : 0n; } catch { return 0n; } })();
  const stake = () => run("Confirm in your wallet…", async ({ w, a }) => {
    const allowed = await rpc.readContract({ address: token!, abi: erc20Abi, functionName: "allowance", args: [a, rewards!] });
    const lockText = LOCKS.find(([d]) => d === lock)![1].toLowerCase();
    const steps: Step[] = [];
    // exactly the amount staked, never more
    if (allowed < amt) steps.push({ call: { address: token!, abi: erc20Abi, functionName: "approve", args: [rewards!, amt] }, sign: `Approve ${fmt(amt)} $${sym} for staking…`, wait: "Waiting for the approval…", fail: "The approval failed. Nothing was staked." });
    steps.push({ call: { address: rewards!, abi: REWARDS, functionName: "stake", args: [amt, BigInt(lock)] }, sign: `Stake ${fmt(amt)} $${sym} for ${lockText}…` });
    await feeCheck(a, (allowed < amt ? 60_000n : 0n) + 180_000n);
    const batched = steps.length > 1 && (await canBatch(w, a));
    return (await sendSteps(w, a, steps, { batched, once: `Confirm once in your wallet (approve + stake ${fmt(amt)} $${sym} for ${lockText})…`, say: setStep })).hash;
  });

  const now = Date.now() / 1000;
  const staked = onChain.staked ?? (h ? h.stakes.reduce((s, x) => s + x.amount, 0n) - h.out : 0n);
  const unlocked = h ? h.stakes.filter((x) => x.unlockAt <= now).reduce((s, x) => s + x.amount, 0n) - h.out : 0n;
  // only what the stake history shows as unlocked: never the whole stake blind
  const withdrawable = h && unlocked > 0n ? (unlocked > staked ? staked : unlocked) : 0n;
  // what is left of each stake: withdrawals come out of the unlocked stakes, oldest unlock first
  const rows = (() => {
    if (!h) return [];
    let used = h.out;
    const left = new Map<string, bigint>();
    for (const x of [...h.stakes].filter((x) => x.unlockAt <= now).sort((a, b) => a.unlockAt - b.unlockAt)) { const take = used > x.amount ? x.amount : used; used -= take; left.set(x.tx, x.amount - take); }
    return h.stakes.map((x) => ({ ...x, left: left.get(x.tx) ?? x.amount }));
  })();
  const outAmt = (() => { try { return out && Number(out) > 0 ? parseEther(out) : 0n; } catch { return 0n; } })();
  const lockedNow = staked > withdrawable ? staked - withdrawable : 0n;
  const nextUnlock = rows.filter((x) => x.unlockAt > now && x.left > 0n).sort((a, b) => a.unlockAt - b.unlockAt)[0] ?? null;
  // a share of what can come out now, rounded down to whole tokens below the max
  const part = (pct: number) => setOut(formatEther(pct === 100 ? withdrawable : ((withdrawable * BigInt(pct)) / 100n / 10n ** 18n) * 10n ** 18n));
  const withdraw = (v: bigint) => run(`Confirm the withdrawal of ${fmt(v)} $${sym}…`, async ({ w, a }) => {
    // re-read the locks right before sending, so what was unlocked a minute ago is still true
    const fresh = await load(a);
    if (fresh) {
      const t = Date.now() / 1000, free = fresh.stakes.filter((x) => x.unlockAt <= t).reduce((s, x) => s + x.amount, 0n) - fresh.out;
      if (free <= 0n) throw new Error("Nothing is unlocked right now.");
      if (v > free) v = free;
    }
    // a dry run first: a locked stake is refused here with a clear message, before any gas is spent
    await rpc.simulateContract({ account: a, address: rewards!, abi: REWARDS, functionName: "withdraw", args: [v] }).catch(() => { throw new Error("The contract refused the withdrawal: part of this stake may still be locked."); });
    await feeCheck(a, 120_000n);
    return w.writeContract({ account: a, chain: mainnet, address: rewards!, abi: REWARDS, functionName: "withdraw", args: [v] });
  });

  const lockText = LOCKS.find(([d]) => d === lock)?.[1] ?? "";
  const openSide = (m: "stake" | "unstake") => { setMode(m); setMsg(null); document.getElementById("stake")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const msgLine = msg ? <p className={`sh-msg ${msg.ok ? "good" : "bad"}`}>{msg.text} {msg.tx && <a href={`https://etherscan.io/tx/${msg.tx}`} target="_blank" rel="noreferrer">Etherscan ↗</a>}</p> : null;

  return (
    <div className="sh sh-stake">
      <PxHero
        kicker={ready ? "STAKING · LIVE" : "STAKING · OPENS AT LAUNCH"}
        live={ready}
        title={<>Stake ${sym}.</>}
        accent="Lock it, earn from every sell."
        lead={<>Half of every NIGHTSHIFT reward streams to ${sym} stakers over 7 days, in ETH and ${sym}. The more you stake and the longer you lock, the bigger your share. <b>Your stake stays yours: nobody, us included, can touch it.</b></>}
        actions={<>
          <ShStar href="#stake" icon="stake">STAKE ${sym}</ShStar>
          <button type="button" className="px-btn" onClick={() => openSide("unstake")}><PxIcon name="lock" size={14} />UNSTAKE</button>
          <PxButton to="/swap" kind="ghost" icon="swap">GET ${sym}</PxButton>
        </>}
        aside={<StakedBoard sym={sym} />}
        bg={<HeroDots />}
      />

      <div className="stk-desk" id="stake">
        <PxPanel className="stk-form" title={<>{mode === "stake" ? "STAKE" : "UNSTAKE"} · ETHEREUM · SHIFTREWARDS{rewards ? ` · ${rewards.slice(0, 6)}…${rewards.slice(-4)}` : ""}</>} state={ready ? "live" : "idle"} right={ready ? undefined : "SOON"}>
          <div className="stake-sides" role="tablist" aria-label="Stake or unstake">
            {(["stake", "unstake"] as const).map((m) => <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => { setMode(m); setMsg(null); }}>{m === "stake" ? `Stake $${sym}` : `Unstake $${sym}`}</button>)}
          </div>
          {mode === "unstake" && <div className="swap-box">
            {!me ? <>
              <p className="sh-line">Connect the wallet you staked from to see how much you can take out. You choose the amount; the rest stays staked and keeps earning.</p>
              <button className="ns-cta sm" disabled={Boolean(step) || !ready} onClick={() => void wallet().catch((e) => setMsg({ ok: false, text: errText(e) }))}>CONNECT WALLET</button>
            </> : !h ? <p className="sh-line">{hErr ? "Could not read your stakes from Ethereum right now." : "Reading your stakes and their locks from Ethereum…"}</p> : staked <= 0n ? <p className="sh-line">This wallet has nothing staked.</p> : <>
              <div className="stake-split">
                <div><span>Staked</span><b>{fmt(staked)}</b></div>
                <div><span>Can come out now</span><b className="good">{fmt(withdrawable)}</b></div>
                <div><span>Still locked</span><b>{fmt(lockedNow)}</b></div>
              </div>
              {withdrawable > 0n ? <>
                <label className="swap-leg"><span>How much to unstake</span>
                  <div><input className="swap-in" inputMode="decimal" placeholder="0" value={out} onChange={(e) => setOut(e.target.value.replace(",", "."))} /><i>${sym}</i></div></label>
                <div className="swap-slip"><span>Quick</span>{[25, 50, 75, 100].map((pct) => <button key={pct} type="button" onClick={() => part(pct)}>{pct === 100 ? "Max" : `${pct}%`}</button>)}</div>
                <p className="sh-line">{outAmt > withdrawable ? `Only ${fmt(withdrawable)} $${sym} is unlocked right now.` : outAmt > 0n ? `After this: ${fmt(staked - outAmt)} $${sym} stays staked and keeps earning${lockedNow > 0n ? ` (${fmt(lockedNow)} of it still locked)` : ""}.` : "Pick an amount, or tap a quick share. Rewards already earned stay claimable."}</p>
                <button className="ns-cta sm" disabled={Boolean(step) || !outAmt || outAmt > withdrawable} onClick={() => void withdraw(outAmt)}>{step ?? (outAmt > withdrawable ? `ONLY ${fmt(withdrawable)} UNLOCKED` : `UNSTAKE ${outAmt ? fmt(outAmt) : ""} $${sym}`)}</button>
              </> : <p className="sh-line">All of your stake is locked right now.{nextUnlock ? ` The next ${fmt(nextUnlock.left)} $${sym} unlocks on ${new Date(nextUnlock.unlockAt * 1000).toLocaleDateString("en-GB")}.` : ""}</p>}
            </>}
            {msgLine}
          </div>}
          {mode === "stake" && <div className="stk-stake">
            <div className="swap-box">
              <label className="swap-leg"><span>Amount {bal !== null && <button type="button" className="swap-max" onClick={() => setAmount(formatEther(bal))}>balance {fmt(bal)}</button>}</span>
                <div><input className="swap-in" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} disabled={!ready} /><i>${sym}</i></div></label>
              <div className="swap-slip"><span>Lock</span>{LOCKS.map(([d, t]) => <button key={d} className={lock === d ? "on" : ""} onClick={() => setLock(d)}>{t}</button>)}</div>
              <p className="sh-line">{lock === 0 ? "No lock: withdraw any time." : `Locked until ${new Date(Date.now() + lock * 86_400_000).toLocaleDateString("en-GB")}. It cannot be withdrawn early, by anyone.`} Every stake is announced in the community with its lock.</p>
              <button className="ns-cta sm" disabled={!ready || !amt || Boolean(step) || (bal !== null && amt > bal)} onClick={() => void stake()}>{step ?? (!ready ? "OPENS AT LAUNCH" : bal !== null && amt > bal ? `NOT ENOUGH $${sym}` : `STAKE $${sym}`)}</button>
              {msgLine}
            </div>
            <div className="stk-gauge" aria-hidden="true">
              <SloshGauge value={(lock / 730) * 100} width={64} height={150} radius={2} ticks={4} liquidColor="#b8ff3d" glassColor="#0d1410" showValue={false} viscosity={0.2} tilt={0.35} splash={0.3} ariaLabel="Lock length" />
              <b>{lockText}</b>
              <span>of 24 months</span>
            </div>
          </div>}
        </PxPanel>

        {ready && !me && (
          <PxPanel className="stk-mine" title="YOUR STAKE" right="WITHDRAW · CLAIM · LOCKS">
            <p className="sh-line">Withdraw, claim and see your locks. The page reads them straight from Ethereum.</p>
            <button className="px-btn primary stk-connect" disabled={Boolean(step)} onClick={() => void wallet().catch((e) => setMsg({ ok: false, text: errText(e) }))}><PxIcon name="wallet" size={14} />Connect wallet to see your stake</button>
            {msg && !msg.ok && <p className="sh-msg bad">{msg.text}</p>}
            <img className="stk-frog" src="/brand/pepe-operator.svg" alt="" width={56} height={56} loading="lazy" />
          </PxPanel>
        )}

        {me && ready && (
          <PxPanel className="stk-mine" title={<>YOUR STAKE · {me.slice(0, 6)}…{me.slice(-4)}</>} state={h ? "live" : "idle"}>
            {walletOn && me && walletOn.toLowerCase() !== me.toLowerCase() && <p className="sh-msg bad">Your wallet is on <b>{short(walletOn)}</b>, but this is the stake of <b>{short(me)}</b>, the wallet you signed in with. To withdraw or claim, switch the account in your wallet to {short(me)}.</p>}
            {!h && (hErr
              ? <p className="sh-msg bad">Could not read your locks from Ethereum right now. <button type="button" className="swap-max" onClick={() => void load()}>Try again</button></p>
              : <p className="sh-line">Reading your stakes and their locks from Ethereum…</p>)}
            <div className="token-specs stk-specs">
              <div><span>Staked</span><b>{fmt(staked)} ${sym}</b></div>
              <div><span>Unlocked now</span><b>{fmt(unlocked > 0n ? unlocked : 0n)} ${sym}</b></div>
              <div><span>Claimable now</span><b className="good">{onChain.eth !== null ? `${Number(formatEther(onChain.eth)).toFixed(6)} ETH` : "…"}{onChain.shift !== null ? ` + ${fmt(onChain.shift)} $${sym}` : ""}</b></div>
              <div><span>ETH rewards claimed</span><b>{h ? fmt(h.paidEth) : "…"} ETH</b></div>
            </div>
            {rows.length > 0 && <div className="sh-table stk-rows"><table className="plain stake-rows"><thead><tr><th>Your stakes</th><th></th></tr></thead><tbody>
              {rows.map((s) => <tr key={s.tx}>
                <td><b>{fmt(s.amount)} ${sym}</b> <a href={`https://etherscan.io/tx/${s.tx}`} target="_blank" rel="noreferrer">↗</a>
                  <span className="dim">{s.unlockAt <= now ? "unlocked" : `locked until ${new Date(s.unlockAt * 1000).toLocaleDateString("en-GB")}`}{s.left === 0n ? " · withdrawn" : s.left < s.amount ? ` · ${fmt(s.left)} left` : ""}</span></td>
                <td>{s.unlockAt <= now && s.left > 0n && <button type="button" className="px-btn small" disabled={Boolean(step)} onClick={() => void withdraw(s.left > withdrawable ? withdrawable : s.left)}>Withdraw</button>}</td></tr>)}
            </tbody></table></div>}
            {withdrawable > 0n && <p className="sh-line">Want only part of it out? <button type="button" className="swap-max" onClick={() => { setMode("unstake"); scrollTo({ top: 0, behavior: "smooth" }); }}>Unstake an amount</button></p>}
            <div className="stk-tools">
              <button className="px-btn primary" disabled={Boolean(step)} onClick={() => void run("Confirm the claim…", async ({ w, a }) => (await feeCheck(a, 160_000n), w.writeContract({ account: a, chain: mainnet, address: rewards!, abi: REWARDS, functionName: "getReward" })))}><PxIcon name="coin" size={14} />Claim rewards</button>
              <button className="px-btn" disabled={Boolean(step) || withdrawable <= 0n} onClick={() => void withdraw(withdrawable)}>Withdraw all unlocked ({fmt(withdrawable)})</button>
            </div>
          </PxPanel>
        )}
      </div>

      <PxSection kicker="THE RULES" title={<>How staking <em>pays.</em></>} id="stk-how" more={{ to: "/tokenomics", label: "Tokenomics" }}>
        <ul className="sh-grid">
          <li><b>From every fee</b>40% of every NIGHTSHIFT fee goes to rewards. Half of that streams to stakers over 7 days, half to NIGHT FROGS holders.</li>
          <li><b>Bigger and longer earns more</b>your share grows with the amount staked and the time it stays staked.</li>
          <li><b>Locks are real</b>a locked stake cannot be withdrawn before its date, not even by the owner of the contract. The dev wallet's own stake is announced with its lock.</li>
          <li><b>Claim any time</b>rewards you earned are yours to claim whenever you like, in ETH and ${sym}.</li>
        </ul>
      </PxSection>
    </div>
  );
}

/** The hero's readout: the $SHIFT staked in ShiftRewards, live (the same read as the staked counter). */
function StakedBoard({ sym }: { sym: string }) {
  const s = useStaked();
  const pct = s?.pct ?? 0;
  const cells = 40, lit = s?.pct != null ? Math.round((Math.min(100, pct) / 100) * cells) : 0;
  return (
    <PxPanel className="sh-board stk-board" title="STAKED SUPPLY" state={s ? "live" : "idle"} right="UPDATES EVERY MINUTE">
      <span className="sh-board-k">${sym} STAKED · LIVE FROM SHIFTREWARDS</span>
      <div className="sh-flap-wrap"><Flap text={s?.staked != null ? s.staked.toLocaleString("en-US") : "…"} size={24} /></div>
      <div className="stk-meter" role="progressbar" aria-label="Share of the supply staked" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>{Array.from({ length: cells }, (_, i) => <i key={i} className={i < lit || (i === 0 && pct > 0) ? "on" : ""} />)}</div>
      <div className="sh-board-row">
        <div><span>Of the supply</span><b className="lime">{s?.pct != null ? <PxNum value={pct} decimals={2} suffix="%" /> : "…"}</b></div>
        <div><span>Total supply</span><b>1,000,000,000</b></div>
        <div><span>Reward stream</span><b>7 DAYS</b></div>
        <div><span>Longest lock</span><b>24 MONTHS</b></div>
      </div>
    </PxPanel>
  );
}
