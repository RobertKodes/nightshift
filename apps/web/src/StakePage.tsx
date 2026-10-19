import { useEffect, useRef, useState } from "react";
import { LIVE_LAUNCH, SHIFT, fetchLaunch } from "./shift";
import { type Address, createPublicClient, createWalletClient, custom, erc20Abi, fallback, formatEther, http, parseAbi, parseAbiItem, parseEther } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet, knownWallet } from "./wallet";
import { useSession } from "./session";
import { type Step, canBatch, sendSteps } from "./batch";
import { StakedSupply } from "./StakedCounter";

const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
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

/** Reads the stake history, retrying: free nodes drop a request now and then. */
async function historyRetry(rewards: Address, who: Address, from: bigint) {
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
    return w.writeContract({ account: a, chain: mainnet, address: rewards!, abi: REWARDS, functionName: "withdraw", args: [v] });
  });

  return (
    <div className="docs token-page stake-page">
      <span className="eyebrow">{ready ? "STAKING · LIVE" : "STAKING · OPENS AT LAUNCH"}</span>
      <h1>Stake ${sym}. <em>Lock it, earn from every sell.</em></h1>
      <p className="lead">Half of every NIGHTSHIFT reward streams to ${sym} stakers over 7 days, in ETH and ${sym}. The more you stake and the longer you lock, the bigger your share. Your stake stays yours: nobody, us included, can touch it.</p>

      <StakedSupply sym={sym} />

      <section className="tkn-card">
        <div className="tkn-head"><div><b>STAKE</b><span>Ethereum · ShiftRewards{rewards ? ` · ${rewards.slice(0, 6)}…${rewards.slice(-4)}` : ""}</span></div><span className="tkn-state">{ready ? "LIVE" : "SOON"}</span></div>
        <div className="swap-box">
          <label className="swap-leg"><span>Amount {bal !== null && <button type="button" className="swap-max" onClick={() => setAmount(formatEther(bal))}>balance {fmt(bal)}</button>}</span>
            <div><input className="swap-in" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} disabled={!ready} /><i>${sym}</i></div></label>
          <div className="swap-slip"><span>Lock</span>{LOCKS.map(([d, t]) => <button key={d} className={lock === d ? "on" : ""} onClick={() => setLock(d)}>{t}</button>)}</div>
          <p className="dim" style={{ fontSize: 13, margin: 0 }}>{lock === 0 ? "No lock: withdraw any time." : `Locked until ${new Date(Date.now() + lock * 86_400_000).toLocaleDateString("en-GB")}. It cannot be withdrawn early, by anyone.`} Every stake is announced in the community with its lock.</p>
          <button className="ns-cta sm" disabled={!ready || !amt || Boolean(step) || (bal !== null && amt > bal)} onClick={() => void stake()}>{step ?? (!ready ? "OPENS AT LAUNCH" : bal !== null && amt > bal ? `NOT ENOUGH $${sym}` : `STAKE $${sym}`)}</button>
          {msg && <p className={msg.ok ? "good" : "bad"} style={{ fontSize: 13, margin: 0 }}>{msg.text} {msg.tx && <a href={`https://etherscan.io/tx/${msg.tx}`} target="_blank" rel="noreferrer">Etherscan ↗</a>}</p>}
        </div>
      </section>

      {ready && !me && (
        <section className="tkn-card">
          <div className="tkn-head"><div><b>YOUR STAKE</b><span>Withdraw, claim and see your locks</span></div></div>
          <button className="btn primary" disabled={Boolean(step)} onClick={() => void wallet().catch((e) => setMsg({ ok: false, text: errText(e) }))}>Connect wallet to see your stake</button>
          {msg && !msg.ok && <p className="bad" style={{ fontSize: 13 }}>{msg.text}</p>}
        </section>
      )}

      {me && ready && (
        <section className="tkn-card">
          {walletOn && me && walletOn.toLowerCase() !== me.toLowerCase() && <p className="bad" style={{ fontSize: 13 }}>Your wallet is on <b>{short(walletOn)}</b>, but this is the stake of <b>{short(me)}</b>, the wallet you signed in with. To withdraw or claim, switch the account in your wallet to {short(me)}.</p>}
          {!h && (hErr
            ? <p className="bad" style={{ fontSize: 13 }}>Could not read your locks from Ethereum right now. <button type="button" className="swap-max" onClick={() => void load()}>Try again</button></p>
            : <p className="dim" style={{ fontSize: 13 }}>Reading your stakes and their locks from Ethereum…</p>)}
          <div className="tkn-head"><div><b>YOUR STAKE</b><span>{me.slice(0, 6)}…{me.slice(-4)}</span></div></div>
          <div className="token-specs">
            <div><span>Staked</span><b>{fmt(staked)} ${sym}</b></div>
            <div><span>Unlocked now</span><b>{fmt(unlocked > 0n ? unlocked : 0n)} ${sym}</b></div>
            <div><span>Claimable now</span><b>{onChain.eth !== null ? `${Number(formatEther(onChain.eth)).toFixed(6)} ETH` : "…"}{onChain.shift !== null ? ` + ${fmt(onChain.shift)} $${sym}` : ""}</b></div>
            <div><span>ETH rewards claimed</span><b>{h ? fmt(h.paidEth) : "…"} ETH</b></div>
          </div>
          {rows.length > 0 && <table className="plain stake-rows"><thead><tr><th>Your stakes</th><th></th></tr></thead><tbody>
            {rows.map((s) => <tr key={s.tx}>
              <td><b>{fmt(s.amount)} ${sym}</b> <a href={`https://etherscan.io/tx/${s.tx}`} target="_blank" rel="noreferrer">↗</a>
                <span className="dim">{s.unlockAt <= now ? "unlocked" : `🔒 until ${new Date(s.unlockAt * 1000).toLocaleDateString("en-GB")}`}{s.left === 0n ? " · withdrawn" : s.left < s.amount ? ` · ${fmt(s.left)} left` : ""}</span></td>
              <td>{s.unlockAt <= now && s.left > 0n && <button type="button" className="btn" disabled={Boolean(step)} onClick={() => void withdraw(s.left > withdrawable ? withdrawable : s.left)}>Withdraw</button>}</td></tr>)}
          </tbody></table>}
          {withdrawable > 0n && <div className="swap-box" style={{ marginTop: 10 }}>
            <label className="swap-leg"><span>Withdraw an amount <button type="button" className="swap-max" onClick={() => setOut(formatEther(withdrawable))}>max {fmt(withdrawable)}</button></span>
              <div><input className="swap-in" inputMode="decimal" placeholder="0" value={out} onChange={(e) => setOut(e.target.value.replace(",", "."))} /><i>${sym}</i></div></label>
            <button className="btn" disabled={Boolean(step) || !outAmt || outAmt > withdrawable} onClick={() => void withdraw(outAmt)}>{outAmt > withdrawable ? `Only ${fmt(withdrawable)} is unlocked` : `Withdraw ${outAmt ? fmt(outAmt) : ""} $${sym}`}</button>
          </div>}
          <div className="setup-tools" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={Boolean(step)} onClick={() => void run("Confirm the claim…", ({ w, a }) => w.writeContract({ account: a, chain: mainnet, address: rewards!, abi: REWARDS, functionName: "getReward" }))}>Claim rewards</button>
            <button className="btn" disabled={Boolean(step) || withdrawable <= 0n} onClick={() => void withdraw(withdrawable)}>Withdraw all unlocked ({fmt(withdrawable)})</button>
          </div>
        </section>
      )}

      <h2>How staking pays</h2>
      <ul className="frogs-util">
        <li><b>From every fee</b>40% of every NIGHTSHIFT fee goes to rewards. Half of that streams to stakers over 7 days, half to NIGHT FROGS holders.</li>
        <li><b>Bigger and longer earns more</b>your share grows with the amount staked and the time it stays staked.</li>
        <li><b>Locks are real</b>a locked stake cannot be withdrawn before its date, not even by the owner of the contract. The dev wallet's own stake is announced with its lock.</li>
        <li><b>Claim any time</b>rewards you earned are yours to claim whenever you like, in ETH and ${sym}.</li>
      </ul>
    </div>
  );
}
