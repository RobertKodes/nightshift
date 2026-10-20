import { useEffect, useState } from "react";
import { type Hex, createPublicClient, createWalletClient, custom, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";

const ABI = parseAbi([
  "function configureVRF(uint256 subscriptionId, bytes32 keyHash)",
  "function reveal() returns (uint256)",
  "function subscriptionId() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function revealRequested() view returns (bool)",
  "function revealed() view returns (bool)",
]);
const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
/** Chainlink VRF v2.5 on Ethereum, the 200 gwei lane (docs.chain.link, checked 2026-10-17). */
const LANE_200 = "0x8077df514608a09f83e4e8d300645594e5d7234665448ba83f51a50f842bd3d9";

/** The owner's NIGHT FROGS controls: set the Chainlink VRF subscription, then reveal after sellout. */
export function FrogsAdmin() {
  const [addr, setAddr] = useState<string | null>(null);
  const [st, setSt] = useState<{ sub: string; minted: number; requested: boolean; revealed: boolean } | null>(null);
  const [sub, setSub] = useState("");
  const [lane, setLane] = useState(LANE_200);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const d = await fetch("/api/frogs").then((r) => r.json()).catch(() => null);
    if (!d?.address) return;
    setAddr(d.address);
    if (d.vrfSub) setSub((s) => s || String(d.vrfSub));
    const a = d.address as `0x${string}`;
    const [s, m, rq, rv] = await Promise.all([
      rpc.readContract({ address: a, abi: ABI, functionName: "subscriptionId" }),
      rpc.readContract({ address: a, abi: ABI, functionName: "totalSupply" }),
      rpc.readContract({ address: a, abi: ABI, functionName: "revealRequested" }),
      rpc.readContract({ address: a, abi: ABI, functionName: "revealed" }),
    ]).catch(() => [0n, 0n, false, false] as const);
    setSt({ sub: String(s), minted: Number(m), requested: Boolean(rq), revealed: Boolean(rv) });
  };
  useEffect(() => { void load(); }, []);

  const send = async (label: string, fn: "configureVRF" | "reveal") => {
    if (!addr) return;
    setErr(null);
    try {
      const eth = await chooseWallet({ chain: 1 });
      const wallet = createWalletClient({ chain: mainnet, transport: custom(eth as never) });
      const [me] = await wallet.requestAddresses();
      if (!me) throw new Error("No account.");
      await wallet.switchChain({ id: 1 }).catch(() => { throw new Error("Switch your wallet to Ethereum mainnet."); });
      setStep(`${label} (confirm in your wallet; only the owner wallet can do this)…`);
      const tx = fn === "configureVRF"
        ? await wallet.writeContract({ account: me, address: addr as `0x${string}`, abi: ABI, functionName: "configureVRF", args: [BigInt(sub), lane as Hex] })
        : await wallet.writeContract({ account: me, address: addr as `0x${string}`, abi: ABI, functionName: "reveal" });
      await rpc.waitForTransactionReceipt({ hash: tx });
      setStep(null);
      void load();
    } catch (e) { setStep(null); setErr((e as Error).message.split("\n")[0] ?? "failed"); }
  };

  if (!addr) return <div className="card-b dim" style={{ fontSize: 13 }}>Appears here once IMD has deployed NIGHT FROGS (the order above follows it).</div>;
  return (
    <div className="card-b token-launch">
      <div className="mono" style={{ fontSize: 12 }}>Contract <a href={`https://etherscan.io/address/${addr}`} target="_blank" rel="noreferrer">{addr}</a> · {st?.minted ?? "…"}/500 minted · VRF subscription {st?.sub && st.sub !== "0" ? st.sub : "not set"} · {st?.revealed ? "revealed" : st?.requested ? "reveal requested" : "not revealed"}</div>
      <ol className="token-facts">
        <li>On vrf.chain.link (Ethereum) create a subscription, fund it with LINK, and add the contract above as a consumer.</li>
        <li>Paste the subscription id here and configure. It can be corrected until the reveal is requested.</li>
        <li>After all 500 are minted, reveal once. Keep the subscription funded until it is fulfilled.</li>
      </ol>
      <div className="setup-grid">
        <label><span>VRF subscription id</span><input className="field" value={sub} onChange={(e) => setSub(e.target.value.replace(/\D/g, ""))} placeholder="1234…" /></label>
        <label><span>Key hash (gas lane)</span><input className="field mono" value={lane} onChange={(e) => setLane(e.target.value.trim())} /></label>
      </div>
      <div className="token-actions">
        <button className="btn" disabled={!sub || Boolean(step) || st?.requested} onClick={() => send("Configure Chainlink VRF", "configureVRF")}>Configure VRF</button>
        <button className="btn primary" disabled={Boolean(step) || (st?.minted ?? 0) < 500 || st?.requested || !st?.sub || st.sub === "0"} onClick={() => send("Request the reveal", "reveal")}>Reveal (after sellout)</button>
      </div>
      {step && <div className="launch-stage"><i className="pulse" /><span>{step}</span></div>}
      {err && <div className="bad">{err}</div>}
    </div>
  );
}
