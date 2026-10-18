import { useEffect, useState } from "react";
import { SHIFT } from "./shift";
import { type Address, createPublicClient, createWalletClient, custom, erc20Abi, formatEther, http, parseAbi, parseAbiItem, parseEther } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";
import { StakedSupply } from "./StakedCounter";

const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
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

/** Your stakes are read from the contract's own events, so the page needs no extra view function. */
async function history(rewards: Address, who: Address, from: bigint) {
  const head = await rpc.getBlockNumber();
  const stakes: Stake[] = [];
  let out = 0n;
  let paid = 0n;
  for (let a = from; a <= head; a += 9_000n) {
    const range = { address: rewards, args: { account: who }, fromBlock: a, toBlock: a + 8_999n > head ? head : a + 8_999n };
    const [s, w, p] = await Promise.all([rpc.getLogs({ ...range, event: STAKED }), rpc.getLogs({ ...range, event: WITHDRAWN }), rpc.getLogs({ ...range, event: PAID })]);
    for (const l of s) stakes.push({ amount: l.args.amount!, unlockAt: Number(l.args.unlockAt!), tx: l.transactionHash! });
    for (const l of w) out += l.args.amount!;
    for (const l of p) paid += l.args.token === "0x0000000000000000000000000000000000000000" ? l.args.amount! : 0n;
  }
  return { stakes, out, paidEth: paid };
}

/** Stake $SHIFT in ShiftRewards: the longer the lock and the bigger the stake, the bigger the share. */
export function StakePage() {
  const [l, setL] = useState<Launch>(null);
  const [me, setMe] = useState<Address | null>(null);
  const [amount, setAmount] = useState("");
  const [lock, setLock] = useState(365);
  const [bal, setBal] = useState<bigint | null>(null);
  const [h, setH] = useState<Awaited<ReturnType<typeof history>> | null>(null);
  const [onChain, setOnChain] = useState<{ staked: bigint | null; eth: bigint | null; shift: bigint | null }>({ staked: null, eth: null, shift: null });
  const [step, setStep] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);

  useEffect(() => { void fetch("/api/token").then((r) => r.json()).then((d) => setL(d.launch ?? null)).catch(() => {}); }, []);
  // the server only says whether $SHIFT is live; the addresses are pinned in the page
  const rewards = l?.contracts?.rewards ? SHIFT.rewards : undefined;
  const token = l?.contracts?.token || l?.token ? SHIFT.token : undefined;
  const sym = l?.symbol ?? "SHIFT";
  const ready = Boolean(rewards && token);

  const load = async (who = me) => {
    if (!who || !rewards || !token) return;
    setBal(await rpc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] }).catch(() => null));
    setH(await history(rewards, who, BigInt(Math.max(0, (l?.scanFrom ?? 0) - 20_000))).catch(() => null));
    const read = (functionName: "balanceOf" | "earned", args: readonly unknown[]) => rpc.readContract({ address: rewards, abi: REWARDS, functionName, args } as never).then((x) => x as bigint, () => null);
    setOnChain({ staked: await read("balanceOf", [who]), eth: await read("earned", [who, "0x0000000000000000000000000000000000000000"]), shift: await read("earned", [who, token]) });
  };
  useEffect(() => { void load(); }, [me, rewards]);

  const wallet = async () => {
    const w = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet()) as never) });
    const [a] = await w.requestAddresses();
    if (!a) throw new Error("No account in the wallet.");
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
      void load(x.a);
    } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setStep(null); }
  };

  const amt = (() => { try { return amount && Number(amount) > 0 ? parseEther(amount) : 0n; } catch { return 0n; } })();
  const stake = () => run("Confirm in your wallet…", async ({ w, a }) => {
    const allowed = await rpc.readContract({ address: token!, abi: erc20Abi, functionName: "allowance", args: [a, rewards!] });
    if (allowed < amt) {
      setStep(`Approve ${fmt(amt)} $${sym} for staking…`);
      const ap = await w.writeContract({ account: a, chain: mainnet, address: token!, abi: erc20Abi, functionName: "approve", args: [rewards!, amt] });
      await rpc.waitForTransactionReceipt({ hash: ap });
    }
    setStep(`Stake ${fmt(amt)} $${sym} for ${LOCKS.find(([d]) => d === lock)![1].toLowerCase()}…`);
    return w.writeContract({ account: a, chain: mainnet, address: rewards!, abi: REWARDS, functionName: "stake", args: [amt, BigInt(lock)] });
  });

  const now = Date.now() / 1000;
  const staked = onChain.staked ?? (h ? h.stakes.reduce((s, x) => s + x.amount, 0n) - h.out : 0n);
  const unlocked = h ? h.stakes.filter((x) => x.unlockAt <= now).reduce((s, x) => s + x.amount, 0n) - h.out : 0n;

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
          <button className="ns-cta sm app-cta" disabled={!ready || !amt || Boolean(step) || (bal !== null && amt > bal)} onClick={() => void stake()}>{step ?? (!ready ? "OPENS AT LAUNCH" : bal !== null && amt > bal ? `NOT ENOUGH $${sym}` : `STAKE $${sym}`)}</button>
          {msg && <p className={msg.ok ? "good" : "bad"} style={{ fontSize: 13, margin: 0 }}>{msg.text} {msg.tx && <a href={`https://etherscan.io/tx/${msg.tx}`} target="_blank" rel="noreferrer">Etherscan ↗</a>}</p>}
        </div>
      </section>

      {me && ready && (
        <section className="tkn-card">
          <div className="tkn-head"><div><b>YOUR STAKE</b><span>{me.slice(0, 6)}…{me.slice(-4)}</span></div></div>
          <div className="token-specs">
            <div><span>Staked</span><b>{fmt(staked)} ${sym}</b></div>
            <div><span>Unlocked now</span><b>{fmt(unlocked > 0n ? unlocked : 0n)} ${sym}</b></div>
            <div><span>Claimable now</span><b>{onChain.eth !== null ? `${Number(formatEther(onChain.eth)).toFixed(6)} ETH` : "…"}{onChain.shift !== null ? ` + ${fmt(onChain.shift)} $${sym}` : ""}</b></div>
            <div><span>ETH rewards claimed</span><b>{h ? fmt(h.paidEth) : "…"} ETH</b></div>
          </div>
          {h && h.stakes.length > 0 && <table className="plain"><thead><tr><th>Stake</th><th>Unlocks</th><th></th></tr></thead><tbody>
            {h.stakes.map((s) => <tr key={s.tx}><td>{fmt(s.amount)} ${sym}</td><td>{s.unlockAt <= now ? "unlocked" : new Date(s.unlockAt * 1000).toLocaleDateString("en-GB")}</td><td><a href={`https://etherscan.io/tx/${s.tx}`} target="_blank" rel="noreferrer">tx ↗</a></td></tr>)}
          </tbody></table>}
          <div className="setup-tools" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={Boolean(step)} onClick={() => void run("Confirm the claim…", ({ w, a }) => w.writeContract({ account: a, chain: mainnet, address: rewards!, abi: REWARDS, functionName: "getReward" }))}>Claim rewards</button>
            <button className="btn" disabled={Boolean(step) || unlocked <= 0n} onClick={() => void run("Confirm the withdrawal…", ({ w, a }) => w.writeContract({ account: a, chain: mainnet, address: rewards!, abi: REWARDS, functionName: "withdraw", args: [unlocked] }))}>Withdraw unlocked ({fmt(unlocked > 0n ? unlocked : 0n)})</button>
          </div>
        </section>
      )}
      {!me && ready && <button className="btn" onClick={() => void wallet().catch((e) => setMsg({ ok: false, text: errText(e) }))}>Connect wallet to see your stake</button>}

      <h2>How staking pays</h2>
      <ul className="frogs-util">
        <li><b>From every fee</b>: 40% of every NIGHTSHIFT fee goes to rewards. Half of that streams to stakers over 7 days, half to NIGHT FROGS holders.</li>
        <li><b>Bigger and longer earns more</b>: your share grows with the amount staked and the time it stays staked.</li>
        <li><b>Locks are real</b>: a locked stake cannot be withdrawn before its date, not even by the owner of the contract. The dev wallet's own stake is announced with its lock.</li>
        <li><b>Claim any time</b>: rewards you earned are yours to claim whenever you like, in ETH and ${sym}.</li>
      </ul>
    </div>
  );
}
