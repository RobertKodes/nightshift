import { useEffect, useState } from "react";
import { type Address, createPublicClient, createWalletClient, custom, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";
import { ESCROW } from "./stakes";

const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const ABI = parseAbi(["function setSigner(address newSigner)", "function signer() view returns (address)"]);
type State = { escrow: string; serverSigner: string; signer: string | null; paused: boolean | null; live: boolean; keeper: string; keeperEth: string; cursor: string };
const errText = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "").split("\n")[0]!.slice(0, 160);

/** /setup: GameEscrow's result signer. Real-money duels open once the contract trusts the server's signer. */
export function GameStakes({ token }: { token: string }) {
  const [s, setS] = useState<State | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => {
    void fetch("/api/games/admin", { headers: { "x-admin-token": token } }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setS(j); }).catch((e) => setMsg(errText(e)));
  };
  useEffect(load, [token]);

  const activate = async () => {
    setBusy(true); setMsg(null);
    try {
      if (!s || !/^0x[0-9a-f]{40}$/.test(s.serverSigner)) throw new Error("No server signer address yet.");
      const w = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet()) as never) });
      const [a] = await w.requestAddresses();
      if (a?.toLowerCase() !== DEV) throw new Error(`Connect the dev wallet ${DEV.slice(0, 6)}…${DEV.slice(-4)}: only the owner can do this.`);
      await w.switchChain({ id: 1 });
      if ((await w.getChainId()) !== 1) throw new Error("Switch the wallet to Ethereum mainnet.");
      if (!confirm(`GameEscrow ${ESCROW}\nsetSigner(${s.serverSigner})\n\nFrom then on the server signs game results. Continue?`)) return;
      const h = await w.writeContract({ account: a as Address, chain: mainnet, address: ESCROW, abi: ABI, functionName: "setSigner", args: [s.serverSigner as Address] });
      await rpc.waitForTransactionReceipt({ hash: h });
      const now = await rpc.readContract({ address: ESCROW, abi: ABI, functionName: "signer" });
      setMsg(now.toLowerCase() === s.serverSigner ? `The server is the game result signer now. tx ${h}` : `Sent (${h}), but the signer reads ${now}.`);
      load();
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };

  const same = !!s?.signer && s.signer === s.serverSigner;
  const gas = s ? Number(s.keeperEth) / 1e18 : 0;
  return (
    <div className="card-b" style={{ display: "grid", gap: 10, fontSize: 13 }}>
      <div><b>Escrow</b> <a className="mono" href={`https://etherscan.io/address/${ESCROW}`} target="_blank" rel="noreferrer">{ESCROW}</a></div>
      <div><b>On-chain signer</b> <span className="mono">{s?.signer ?? "…"}</span>{s?.signer === DEV && <span className="faint"> (the dev wallet)</span>}</div>
      <div><b>Server signer</b> <span className="mono">{s?.serverSigner ?? "…"}</span></div>
      <div><span className={`pill ${s?.live ? "done" : "failed"}`}>{s?.live ? "live: duels for IMD and $SHIFT are open" : s?.paused ? "paused" : "not live"}</span></div>
      <p className="dim" style={{ margin: 0 }}>The server signs each staked game's result with its own key; the contract pays only a match both players joined. The keeper {s ? <span className="mono">{s.keeper.slice(0, 8)}…</span> : null} relays the payout and pays the gas: {gas.toFixed(4)} ETH now{gas < 0.002 ? ", send it ~0.01 ETH" : ""}.</p>
      {!same && <div className="setup-tools"><button className="btn primary" disabled={busy || !s} onClick={() => void activate()}>Make the server the game result signer (dev wallet)</button></div>}
      {msg && <span>{msg}</span>}
    </div>
  );
}
