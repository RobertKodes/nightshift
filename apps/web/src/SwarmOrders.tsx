import { useEffect, useState } from "react";
import { type Hex, createPublicClient, createWalletClient, custom, erc20Abi, http, parseAbi, stringToHex } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";

const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const INTAKE = "0xa43e6f75ee006411f79ac1c84120606c2330de82";
const PRICE = 500000000000000000n; // 0.5 IMD
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const intakeAbi = parseAbi(["function request(bytes32 action, bytes body, (address target, bytes4 selector) callback, address asset, uint256 amount) returns (bytes32)"]);
const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Check = { blockers?: { code?: string; detail?: string; message?: string }[]; plan?: { title: string }[]; error?: string };
type Order = { key: string; title: string; what: string; intake: string; placed: { tx: string; at: number } | null; state: { status?: string; stage?: string; jobId?: string; launchId?: string; error?: string } | null };

/** Orders for the IMD swarm, one card each: free check, pay 0.5 IMD from the dev wallet, then follow it. */
export function SwarmOrders({ call, token }: { call: (token: string, path: string, body?: unknown) => Promise<any>; token: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [checks, setChecks] = useState<Record<string, { check: Check; body: unknown } | { error: string }>>({});
  const [busy, setBusy] = useState<Record<string, string | null>>({});
  const [err, setErr] = useState<Record<string, string | null>>({});

  const refresh = () => call(token, "swarm").then((d) => setOrders(d.orders ?? [])).catch(() => {});
  useEffect(() => { void refresh(); const t = setInterval(refresh, 20_000); return () => clearInterval(t); }, [token]);

  const check = async (key: string) => {
    setBusy((b) => ({ ...b, [key]: "IMD is checking the order for free…" })); setErr((e) => ({ ...e, [key]: null }));
    try { const r = await call(token, "swarm/check", { key }); setChecks((c) => ({ ...c, [key]: r })); }
    catch (e) { setChecks((c) => ({ ...c, [key]: { error: (e as Error).message } })); }
    finally { setBusy((b) => ({ ...b, [key]: null })); }
  };

  const pay = async (o: Order) => {
    const c = checks[o.key];
    if (!c || "error" in c) return;
    const step = (s: string | null) => setBusy((b) => ({ ...b, [o.key]: s }));
    setErr((e) => ({ ...e, [o.key]: null }));
    try {
      const wallet = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet({ ask: true })) as never) });
      step("Connect your dev wallet…");
      const [me] = await wallet.requestAddresses();
      if (!me) throw new Error("No account.");
      if (me.toLowerCase() !== DEV) throw new Error(`This is ${short(me)}. Switch to your dev wallet ${short(DEV)}: it owns what the swarm deploys.`);
      await wallet.switchChain({ id: 1 }).catch(() => { throw new Error("Switch your wallet to Ethereum."); });
      const bal = await rpc.readContract({ address: IMD, abi: erc20Abi, functionName: "balanceOf", args: [me] });
      if (bal < PRICE) throw new Error(`Your dev wallet has ${(Number(bal) / 1e18).toFixed(3)} IMD. It needs 0.5 IMD, plus a little ETH for gas.`);
      const allowance = await rpc.readContract({ address: IMD, abi: erc20Abi, functionName: "allowance", args: [me, INTAKE] });
      if (allowance < PRICE) {
        step("Signature 1 of 2: allow IMD to take exactly 0.5 IMD…");
        const a = await wallet.writeContract({ account: me, address: IMD, abi: erc20Abi, functionName: "approve", args: [INTAKE, PRICE] });
        step("Waiting for signature 1 to confirm…");
        await rpc.waitForTransactionReceipt({ hash: a });
      }
      step("Signature 2 of 2: pay 0.5 IMD and send the order…");
      const tx = await wallet.writeContract({
        account: me, address: INTAKE, abi: intakeAbi, functionName: "request",
        args: [stringToHex(o.intake, { size: 32 }), stringToHex(JSON.stringify(c.body)), { target: "0x0000000000000000000000000000000000000000", selector: "0x00000000" }, IMD, PRICE],
      });
      step("Waiting for signature 2 to confirm…");
      const r = await rpc.waitForTransactionReceipt({ hash: tx as Hex });
      if (r.status !== "success") throw new Error(`The transaction reverted: ${tx}`);
      const d = await call(token, "swarm/placed", { key: o.key, tx });
      setOrders(d.orders ?? []);
      step(null);
    } catch (e) { step(null); setErr((x) => ({ ...x, [o.key]: (e as Error).message.split("\n")[0] ?? "failed" })); }
  };

  return (
    <div className="swarm-orders">
      {orders.map((o) => {
        const c = checks[o.key];
        const blockers = c && !("error" in c) ? c.check?.blockers ?? [] : [];
        const ok = Boolean(c && !("error" in c) && c.check && !c.check.error && blockers.length === 0);
        return (
          <div key={o.key} className="card-b swarm-order">
            <div className="swarm-head"><b>{o.title}</b><span className={`pill ${o.placed ? "ok" : ""}`}>{o.placed ? (o.state?.stage ?? o.state?.status ?? "ordered") : "not ordered"}</span></div>
            <p className="dim">{o.what}</p>
            {o.placed ? (
              <p className="swarm-placed">
                Ordered {new Date(o.placed.at).toLocaleString()} · <a href={`https://etherscan.io/tx/${o.placed.tx}`} target="_blank" rel="noreferrer">payment</a>
                {o.state?.jobId && <> · <a href={`https://explorer.imd.fun/jobs/${o.state.jobId}`} target="_blank" rel="noreferrer">job on IMD</a></>}
                {o.state?.launchId && <> · <a href={`https://explorer.imd.fun/launches/${o.state.launchId}`} target="_blank" rel="noreferrer">launch on IMD</a></>}
                {o.state?.error && <span className="bad"> · {o.state.error}</span>}
              </p>
            ) : (
              <>
                {c && "error" in c && <p className="bad">{c.error}</p>}
                {c && !("error" in c) && c.check && (blockers.length
                  ? <ul className="bad">{blockers.map((b, i) => <li key={i}>{b.message ?? b.detail ?? b.code}</li>)}</ul>
                  : <ol className="swarm-plan">{(c.check.plan ?? []).map((p, i) => <li key={i}>{p.title}</li>)}</ol>)}
                <div className="swarm-actions">
                  <button className="btn" disabled={Boolean(busy[o.key])} onClick={() => void check(o.key)}>{c ? "Check again" : "Check for free"}</button>
                  <button className="btn primary" disabled={!ok || Boolean(busy[o.key])} onClick={() => void pay(o)}>Pay 0.5 IMD and start</button>
                </div>
              </>
            )}
            {busy[o.key] && <p className="dim">{busy[o.key]}</p>}
            {err[o.key] && <p className="bad">{err[o.key]}</p>}
          </div>
        );
      })}
    </div>
  );
}
