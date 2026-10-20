import { useEffect, useState } from "react";
import { safeHref } from "./safe";
import { chooseWallet } from "./wallet";
import { type Step, canBatch, sendSteps } from "./batch";
import { type Hex, createPublicClient, createWalletClient, custom, erc20Abi, http, parseAbi, stringToHex } from "viem";
import { mainnet } from "viem/chains";

const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const INTAKE = "0xa43e6f75ee006411f79ac1c84120606c2330de82";
const PRICE = 500000000000000000n; // 0.5 IMD
const intakeAbi = parseAbi(["function request(bytes32 action, bytes body, (address target, bytes4 selector) callback, address asset, uint256 amount) returns (bytes32)"]);
const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const TREASURY = "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69";
/** The IMD intake actions an order may use. */
const ACTIONS = new Set(["launch.open@launch-1", "job.open@job-1"]);

/**
 * The body comes from our server and is signed as is: before it is, this page checks it is ours.
 * The action is one we use, a launch is owned by the dev wallet on Ethereum mainnet, its remainder
 * goes to the dev wallet, and any other recipient field names the dev or the treasury wallet.
 */
function refuseBody(action: string, body: unknown): string | null {
  if (!ACTIONS.has(action)) return `Refused: unexpected IMD action ${action}.`;
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Refused: the order body is not an object.";
  const b = body as Record<string, unknown>, lc = (x: unknown) => String(x ?? "").toLowerCase();
  if ((action.startsWith("launch.") || "owner" in b) && lc(b.owner) !== DEV) return `Refused: the order names ${String(b.owner)} as owner, not the dev wallet.`;
  if ((action.startsWith("launch.") || "chainId" in b) && b.chainId !== 1) return "Refused: the order is not for Ethereum mainnet.";
  const e = b.economics as Record<string, unknown> | undefined;
  if (e && typeof e === "object" && "remainderTo" in e && lc(e.remainderTo) !== DEV) return `Refused: the remainder goes to ${String(e.remainderTo)}, not the dev wallet.`;
  const bad: string[] = [];
  const walk = (v: unknown, key: string) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
    else if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) && /owner|recipient|remainder|treasury|payto|beneficiary|receiver|admin|wallet|^to$|feeto/i.test(key) && lc(v) !== DEV && lc(v) !== TREASURY) bad.push(`${key} ${v}`);
  };
  walk(b, "");
  return bad.length ? `Refused: the order sends to an unknown address (${bad.join(", ")}).` : null;
}

type Item = { id: string; title: string; summary: string; action: string; actionId: string };
type Order = { id: string; title: string; tx: string; at: number; stage: string; done?: boolean; error?: string; jobId?: string; repoUrl?: string; addresses?: { role: string; name?: string; address: string }[] };
type Check = { blockers?: { code?: string; detail?: string; message?: string }[]; plan?: { title: string }[]; error?: string };

/**
 * Buys ready-made work from the IMD swarm with the operator's own wallet: IMD's free check, then
 * approve 0.5 IMD and one Intake request on Ethereum. The server follows it and Telegram tells
 * every stage. No key ever touches the server.
 */
export function ImdOrders({ call, token }: { call: (token: string, path: string, body?: unknown) => Promise<any>; token: string }) {
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [list, setList] = useState<Order[]>([]);
  const [res, setRes] = useState<Record<string, { body: unknown; actionId: string; check: Check }>>({});
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => call(token, "orders").then((d) => { setCatalog(d.catalog); setList(d.orders); }).catch(() => {});
  useEffect(() => { void refresh(); const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, [token]);

  const check = async (id: string) => {
    setErr(null); setStep("Asking IMD (free)… this can take a minute");
    try { const r = await call(token, "orders/check", { id }); setRes((x) => ({ ...x, [id]: r })); } catch (e) { setErr((e as Error).message); } finally { setStep(null); }
  };

  const pay = async (id: string) => {
    const r = res[id];
    if (!r) return;
    setErr(null);
    try {
      const refused = refuseBody(r.actionId, r.body);
      if (refused) throw new Error(refused);
      const eth = await chooseWallet({ chain: 1 });
      const wallet = createWalletClient({ chain: mainnet, transport: custom(eth as never) });
      setStep("Connect your wallet…");
      const [me] = await wallet.requestAddresses();
      if (!me) throw new Error("No account.");
      await wallet.switchChain({ id: 1 }).catch(() => { throw new Error("Switch your wallet to Ethereum mainnet."); });
      const bal = await rpc.readContract({ address: IMD, abi: erc20Abi, functionName: "balanceOf", args: [me] });
      if (bal < PRICE) throw new Error(`This wallet has ${(Number(bal) / 1e18).toFixed(3)} IMD; the order costs 0.5 IMD plus a little ETH for gas.`);
      const allowance = await rpc.readContract({ address: IMD, abi: erc20Abi, functionName: "allowance", args: [me, INTAKE] });
      const steps: Step[] = [];
      if (allowance < PRICE) steps.push({ call: { address: IMD, abi: erc20Abi, functionName: "approve", args: [INTAKE, PRICE] }, sign: "1/2 · Approve 0.5 IMD for IMD's Intake (confirm in your wallet)…", wait: "1/2 · Waiting for the approval to confirm…", fail: "The approval failed. Nothing was paid." });
      const two = steps.length > 0;
      steps.push({
        call: { address: INTAKE, abi: intakeAbi, functionName: "request", args: [stringToHex(r.actionId, { size: 32 }), stringToHex(JSON.stringify(r.body)), { target: "0x0000000000000000000000000000000000000000", selector: "0x00000000" }, IMD, PRICE] },
        sign: two ? "2/2 · Pay 0.5 IMD and send the order (confirm in your wallet)…" : "Pay 0.5 IMD and send the order (confirm in your wallet)…",
        wait: two ? "2/2 · Waiting for the transaction to confirm…" : "Waiting for the transaction to confirm…",
      });
      const batched = two && (await canBatch(wallet, me));
      const sent = await sendSteps(wallet, me, steps, { batched, once: "Confirm once in your wallet (approve 0.5 IMD + pay and send the order)…", wait: batched ? "Waiting for the transaction to confirm…" : undefined, say: setStep });
      const tx = sent.hash;
      if (!sent.ok) throw new Error(`The transaction reverted: ${tx}`);
      const d = await call(token, "orders/paid", { id, tx });
      setList(d.orders);
      setStep(null);
    } catch (e) { setStep(null); setErr((e as Error).message.split("\n")[0] ?? "failed"); }
  };

  return (
    <div className="card-b token-launch">
      {list.map((o) => (
        <div key={o.tx} className="launch-live" style={{ marginBottom: 14 }}>
          <div className="launch-stage">{!o.done && <i className="pulse" />}<b>{o.title}</b><span className={o.error ? "bad" : o.done ? "good" : ""}>{o.stage}</span></div>
          <a className="mono faint" href={`https://etherscan.io/tx/${o.tx}`} target="_blank" rel="noreferrer">payment tx {o.tx.slice(0, 12)}…</a>
          {o.jobId && <a className="mono faint" href={`https://explorer.imd.fun/jobs/${o.jobId}`} target="_blank" rel="noreferrer"> · job {o.jobId.slice(0, 8)}…</a>}
          {o.repoUrl && <a className="mono faint" href={safeHref(o.repoUrl)} target="_blank" rel="noreferrer"> · code</a>}
          {o.addresses?.map((a) => <div key={a.address} className="mono" style={{ fontSize: 12 }}>{a.name ?? a.role}: <a href={`https://etherscan.io/address/${a.address}`} target="_blank" rel="noreferrer">{a.address}</a></div>)}
        </div>
      ))}
      {catalog.filter((c) => !list.some((o) => o.id === c.id && !o.error)).map((c) => {
        const r = res[c.id];
        const blockers = r?.check?.blockers ?? [];
        const ok = r && !r.check.error && blockers.length === 0;
        return (
          <div key={c.id}>
            <b>{c.title}</b>
            <p className="dim" style={{ fontSize: 13, margin: "6px 0 10px" }}>{c.summary}</p>
            <ul className="token-facts"><li>Costs 0.5 IMD plus a little ETH for gas, from your wallet. IMD gives no refunds, so it is checked first.</li><li>The contract's owner is the wallet written in the order; the swarm deploys it and pays the deployment gas.</li></ul>
            <div className="token-actions">
              <button className="btn" disabled={Boolean(step)} onClick={() => check(c.id)}>Check with IMD (free)</button>
              <button className="btn primary" disabled={!ok || Boolean(step)} onClick={() => pay(c.id)}>Pay &amp; order · 0.5 IMD</button>
            </div>
            {r && (
              <div className="token-check">
                {r.check.error ? <span className="bad">{r.check.error}</span> : blockers.length ? (
                  <><b className="bad">IMD would refuse this:</b><ul>{blockers.map((b, i) => <li key={i}>{b.detail ?? b.message ?? b.code}</li>)}</ul></>
                ) : (
                  <><b className="good">IMD accepts it. What happens after you pay:</b><ol>{(r.check.plan ?? []).map((p, i) => <li key={i}>{p.title}</li>)}</ol></>
                )}
              </div>
            )}
          </div>
        );
      })}
      {step && <div className="launch-stage"><i className="pulse" /><span>{step}</span></div>}
      {err && <div className="bad">{err}</div>}
    </div>
  );
}
