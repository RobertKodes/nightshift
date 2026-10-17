import { useEffect, useState } from "react";
import { inUsd, useImdUsd } from "./price";
import { chooseWallet } from "./wallet";
import { type Hex, createPublicClient, createWalletClient, custom, erc20Abi, http, parseAbi, stringToHex } from "viem";
import { mainnet } from "viem/chains";

const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const INTAKE = "0xa43e6f75ee006411f79ac1c84120606c2330de82";
const PRICE = 500000000000000000n; // 0.5 IMD
const intakeAbi = parseAbi(["function request(bytes32 action, bytes body, (address target, bytes4 selector) callback, address asset, uint256 amount) returns (bytes32)"]);
const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });

type Check = { blockers?: { code?: string; message?: string }[]; plan?: { title: string }[]; facts?: { id: string; label: string; state: string }[]; error?: string };
type Launch = { tx: string; stage: string; token?: string; done?: boolean; error?: string; symbol: string } | null;

/**
 * Launches the NIGHTSHIFT token through IMD from the operator's own wallet: IMD's free check,
 * then approve 0.5 IMD and one Intake request on Ethereum. No key ever touches the server.
 */
export function TokenLaunch({ call, token }: { call: (token: string, path: string, body?: unknown) => Promise<any>; token: string }) {
  const [f, setF] = useState({ name: "NIGHTSHIFT", symbol: "SHIFT", supply: "1000000000", pool: "90", cap: "2500", remainderTo: "" });
  const [res, setRes] = useState<{ body: unknown; check: Check } | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [launch, setLaunch] = useState<Launch>(null);
  const [tokenOn, setTokenOn] = useState(false);
  const usd = useImdUsd();

  const refresh = () => fetch("/api/token").then((r) => r.json()).then((d) => { setLaunch(d.launch); setTokenOn(d.on); }).catch(() => {});
  useEffect(() => { void refresh(); const t = setInterval(refresh, 20_000); return () => clearInterval(t); }, []);

  const spec = () => ({ name: f.name.trim(), symbol: f.symbol.trim().toUpperCase(), supply: Number(f.supply), poolBps: Math.round(Number(f.pool) * 100), capImd: Number(f.cap), remainderTo: f.remainderTo.trim() || undefined });
  const check = async () => {
    setErr(null); setRes(null); setStep("Asking IMD (free)…");
    try { setRes(await call(token, "token/check", spec())); } catch (e) { setErr((e as Error).message); } finally { setStep(null); }
  };
  const blockers = res?.check?.blockers ?? [];
  const ok = res && !res.check.error && blockers.length === 0;

  const pay = async () => {
    if (!res) return;
    setErr(null);
    try {
      const eth = await chooseWallet({ ask: true });
      const wallet = createWalletClient({ chain: mainnet, transport: custom(eth as never) });
      setStep("Connect your wallet…");
      const [me] = await wallet.requestAddresses();
      if (!me) throw new Error("No account.");
      await wallet.switchChain({ id: 1 }).catch(() => { throw new Error("Switch your wallet to Ethereum mainnet."); });
      const bal = await rpc.readContract({ address: IMD, abi: erc20Abi, functionName: "balanceOf", args: [me] });
      if (bal < PRICE) throw new Error(`This wallet has ${(Number(bal) / 1e18).toFixed(3)} IMD; the launch costs 0.5 IMD plus ETH for gas.`);
      const allowance = await rpc.readContract({ address: IMD, abi: erc20Abi, functionName: "allowance", args: [me, INTAKE] });
      if (allowance < PRICE) {
        setStep("1/2 · Approve 0.5 IMD for IMD's Intake (confirm in your wallet)…");
        const a = await wallet.writeContract({ account: me, address: IMD, abi: erc20Abi, functionName: "approve", args: [INTAKE, PRICE] });
        setStep("1/2 · Waiting for the approval to confirm…");
        await rpc.waitForTransactionReceipt({ hash: a });
      }
      setStep("2/2 · Pay 0.5 IMD and send the launch (confirm in your wallet)…");
      const tx = await wallet.writeContract({
        account: me, address: INTAKE, abi: intakeAbi, functionName: "request",
        args: [stringToHex("launch.open@launch-1", { size: 32 }), stringToHex(JSON.stringify(res.body)), { target: "0x0000000000000000000000000000000000000000", selector: "0x00000000" }, IMD, PRICE],
      });
      setStep("2/2 · Waiting for the transaction to confirm…");
      const r = await rpc.waitForTransactionReceipt({ hash: tx as Hex });
      if (r.status !== "success") throw new Error(`The transaction reverted: ${tx}`);
      await call(token, "token/launched", { tx, symbol: spec().symbol });
      setStep(null);
      void refresh();
    } catch (e) { setStep(null); setErr((e as Error).message.split("\n")[0] ?? "failed"); }
  };

  if (tokenOn) return <div className="card-b good">The token is live and switched on. See <a href="/token">/token</a>.</div>;
  if (launch && !launch.error) {
    return (
      <div className="card-b launch-live">
        <div className="launch-stage"><i className="pulse" /><b>${launch.symbol}</b><span>{launch.stage}</span></div>
        <a className="mono faint" href={`https://etherscan.io/tx/${launch.tx}`} target="_blank" rel="noreferrer">payment tx {launch.tx.slice(0, 12)}…</a>
        <span className="dim" style={{ fontSize: 13 }}>The swarm builds, tests and audits the token, then IMD deploys it with its IMD pool. When it is live, this site switches the token features on by itself and Telegram tells you.</span>
      </div>
    );
  }
  return (
    <div className="card-b token-launch">
      {launch?.error && <div className="bad">The last launch did not go through: {launch.stage}</div>}
      <div className="setup-grid">
        <label><span>Name</span><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label><span>Symbol</span><input className="field" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} /></label>
        <label><span>Total supply</span><input className="field" value={f.supply} onChange={(e) => setF({ ...f, supply: e.target.value.replace(/\D/g, "") })} /></label>
        <label><span>Opening market cap (IMD, 250–250,000)</span><input className="field" value={f.cap} onChange={(e) => setF({ ...f, cap: e.target.value.replace(/[^\d.]/g, "") })} /></label>
        <label><span>Share of supply in the pool (%, 10–90)</span><input className="field" value={f.pool} onChange={(e) => setF({ ...f, pool: e.target.value.replace(/[^\d.]/g, "") })} /></label>
        <label><span>Wallet for the rest {Number(f.pool) < 90 ? "(required)" : "(none at 90%)"}</span><input className="field" placeholder="0x…" disabled={Number(f.pool) >= 90} value={f.remainderTo} onChange={(e) => setF({ ...f, remainderTo: e.target.value })} /></label>
      </div>
      <ul className="token-facts">
        <li>Ethereum mainnet, paired with IMD. 10% of the supply goes to the IMD swarm, always.</li>
        <li>Every trade pays 1.25%: <b>1% to the wallet that pays for the launch</b>, 0.25% to IMD.</li>
        <li>Costs 0.5 IMD{usd ? ` (${inUsd(0.5, usd)})` : ""} plus gas, from your wallet. No refunds once sent, so it is checked first.</li>
      </ul>
      <div className="token-actions">
        <button className="btn" disabled={Boolean(step)} onClick={check}>Check with IMD (free)</button>
        <button className="btn primary" disabled={!ok || Boolean(step)} onClick={pay}>Launch ${spec().symbol} · 0.5 IMD</button>
      </div>
      {step && <div className="launch-stage"><i className="pulse" /><span>{step}</span></div>}
      {err && <div className="bad">{err}</div>}
      {res && (
        <div className="token-check">
          {res.check.error ? <span className="bad">{res.check.error}</span> : blockers.length ? (
            <><b className="bad">IMD would refuse this:</b><ul>{blockers.map((b, i) => <li key={i}>{b.message ?? b.code}</li>)}</ul></>
          ) : (
            <><b className="good">IMD accepts it. What happens after you pay:</b><ol>{(res.check.plan ?? []).map((p, i) => <li key={i}>{p.title}</li>)}</ol></>
          )}
        </div>
      )}
    </div>
  );
}
