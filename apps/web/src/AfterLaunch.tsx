import { useEffect, useState } from "react";
import { SHIFT } from "./shift";
import { type Address, createPublicClient, createWalletClient, custom, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";

const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
/** Owner calls, as fixed in the launch spec: name the keeper, post a frog epoch's root. */
const SPLITTER = parseAbi(["function setKeeper(address keeper)"]);
const REWARDS = parseAbi(["function postRoot(uint256 epoch, bytes32 root, address token, uint256 total)"]);

type Call = (token: string, path: string, body?: unknown) => Promise<any>;
type Epoch = { epoch: number; at: number; wallets: number; tokens: { token: string; symbol: string; total: string; root: string; posted?: string }[] };
const errText = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "").split("\n")[0]!.slice(0, 160);

/** After launch, from /setup: the keeper (gas, owner switch, run now) and the weekly NIGHT FROGS roots. */
export function AfterLaunch({ call, token }: { call: Call; token: string }) {
  const [k, setK] = useState<{ address: string; eth: string; last: { at: number; did: string[]; skipped: string[]; error?: string } | null } | null>(null);
  const [eps, setEps] = useState<Epoch[]>([]);
  const [contracts, setContracts] = useState<Record<string, string> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    void call(token, "keeper").then(setK).catch(() => {});
    void call(token, "frogpot").then((d) => setEps(d.epochs)).catch(() => {});
    void fetch("/api/token").then((r) => r.json()).then((d) => setContracts(d.launch?.contracts ?? null)).catch(() => {});
  };
  useEffect(load, [token]);

  const dev = async () => {
    const w = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet()) as never) });
    const [a] = await w.requestAddresses();
    if (a?.toLowerCase() !== DEV) throw new Error(`Connect the dev wallet ${DEV.slice(0, 6)}…${DEV.slice(-4)}: only the owner can do this.`);
    await w.switchChain({ id: 1 });
    return { w, a: a as Address };
  };
  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg(r || "Done."); load(); } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };

  if (!contracts?.splitter) return <div className="card-b dim" style={{ fontSize: 13 }}>Opens when $SHIFT is deployed: the keeper and the NIGHT FROGS weekly roots are run from here.</div>;
  const gas = k ? Number(k.eth) / 1e18 : 0;
  return (
    <div className="card-b" style={{ display: "grid", gap: 14 }}>
      <div>
        <b>Keeper</b> <span className="mono faint" style={{ fontSize: 12 }}>{k?.address}</span>
        <p className="dim" style={{ fontSize: 13, margin: "4px 0" }}>Every day at 03:00 UTC it splits what the fee splitter received and burns the ETH reserve as IMD. It only pays gas: {gas.toFixed(4)} ETH now{gas < 0.002 ? ", send it ~0.01 ETH" : ""}.</p>
        <div className="setup-tools">
          <button className="btn" disabled={busy || !k} onClick={() => void act(async () => {
            const { w, a } = await dev();
            const h = await w.writeContract({ account: a, chain: mainnet, address: SHIFT.splitter, abi: SPLITTER, functionName: "setKeeper", args: [k!.address as Address] });
            await rpc.waitForTransactionReceipt({ hash: h });
            return `The server is the keeper now. tx ${h}`;
          })}>Make the server the keeper (dev wallet)</button>
          <button className="btn" disabled={busy} onClick={() => void act(async () => { const r = await call(token, "keeper/run", {}); return r.error ?? `Ran: ${r.did.length} done, ${r.skipped.length} skipped.`; })}>Run it now</button>
        </div>
        {k?.last && <p className="faint" style={{ fontSize: 12, margin: "4px 0" }}>Last run {new Date(k.last.at).toUTCString().slice(5, 22)}: {k.last.error ?? `${k.last.did.length} done`}</p>}
      </div>
      <div>
        <b>NIGHT FROGS weekly rewards</b>
        <p className="dim" style={{ fontSize: 13, margin: "4px 0" }}>Built every Monday from the shift hours each wallet earned that week. Post each root from the dev wallet; holders then claim on /frogs.</p>
        <button className="btn" disabled={busy} onClick={() => void act(async () => { const r = await call(token, "frogpot/build", {}); return r.epoch ? `Epoch ${r.epoch.epoch} built.` : "Nothing to share since the last epoch."; })}>Build this week's list now</button>
        {eps.slice().reverse().map((e) => (
          <div key={e.epoch} style={{ marginTop: 8, fontSize: 13 }}>
            <b>Epoch {e.epoch}</b> · {e.wallets} wallets · {new Date(e.at).toUTCString().slice(5, 16)}
            {e.tokens.map((t) => (
              <div key={t.token} className="setup-tools" style={{ marginTop: 4 }}>
                <span className="mono">{(Number(t.total) / 1e18).toFixed(5)} {t.symbol}</span>
                {t.posted ? <a href={`https://etherscan.io/tx/${t.posted}`} target="_blank" rel="noreferrer">posted ↗</a>
                  : <button className="btn primary" disabled={busy} onClick={() => void act(async () => {
                    const { w, a } = await dev();
                    const h = await w.writeContract({ account: a, chain: mainnet, address: SHIFT.rewards, abi: REWARDS, functionName: "postRoot", args: [BigInt(e.epoch), t.root as `0x${string}`, t.token as Address, BigInt(t.total)] });
                    await rpc.waitForTransactionReceipt({ hash: h });
                    await call(token, "frogpot/posted", { epoch: e.epoch, token: t.token, tx: h });
                    return `Epoch ${e.epoch} ${t.symbol} root posted.`;
                  })}>Post root (dev wallet)</button>}
              </div>
            ))}
          </div>
        ))}
      </div>
      {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
    </div>
  );
}
