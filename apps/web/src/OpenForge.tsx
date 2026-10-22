import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";

/** The three NIGHT WATCHERS contracts IMD deployed and we checked: pinned here, never taken from the server. */
const FORGE = "0xbdff33cffc3f617f808a6de012a2574dbf69d819";
const RENDERER = "0x053471879f65f6b4f644635fbdd798b9d7c5e1f5";
const SKIN = "0x8509cddf80cfc8cec4aaa3644b125de919da112e";
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const ABI = parseAbi(["function renderer() view returns (address)", "function skin() view returns (address)", "function owner() view returns (address)", "function setRenderer(address r, address skin_)"]);
const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ZERO = /^0x0{40}$/;

type Call = (token: string, path: string, body?: unknown) => Promise<{ error?: string; on?: boolean }>;

/**
 * Opening the Forge from /setup: the dev wallet connects IMD's art and identity layer to the forge (setRenderer,
 * allowed once, ever), then the server checks the chain and switches the Forge on and announces it.
 */
export function OpenForge({ call, token }: { call: Call; token: string }) {
  const [art, setArt] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const read = async () => {
    const r = await rpc.readContract({ address: FORGE, abi: ABI, functionName: "renderer" }).catch(() => null);
    setArt(r);
    const f = await fetch("/api/forge").then((x) => x.json()).catch(() => null) as { on?: boolean; address?: string | null } | null;
    setOn(Boolean(f?.on && f.address?.toLowerCase() === FORGE));
  };
  useEffect(() => { void read(); }, []);
  const switchOn = async () => {
    setStep("Switching the Forge on…");
    const d = await call(token, "forge/open", {});
    if (d.error) throw new Error(d.error);
    setOn(true);
  };
  const connect = async () => {
    setErr(null);
    try {
      const w = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet({ chain: 1 })) as never) });
      setStep("Connect your dev wallet…");
      const [me] = await w.requestAddresses();
      if (!me) throw new Error("No account.");
      if (me.toLowerCase() !== DEV) throw new Error(`This is ${short(me)}. Switch to your dev wallet ${short(DEV)}: it owns the forge.`);
      await w.switchChain({ id: 1 }).catch(() => { throw new Error("Switch your wallet to Ethereum."); });
      const owner = await rpc.readContract({ address: FORGE, abi: ABI, functionName: "owner" });
      if (owner.toLowerCase() !== DEV) throw new Error(`The forge's owner is ${short(owner)}, not your dev wallet.`);
      // simulated first: a forge that already has its art refuses, and nothing is signed
      await rpc.simulateContract({ account: me, address: FORGE, abi: ABI, functionName: "setRenderer", args: [RENDERER, SKIN] });
      setStep("Confirm in your wallet: setRenderer on the forge (one time, a few cents of gas)…");
      const h = await w.writeContract({ account: me, chain: mainnet, address: FORGE, abi: ABI, functionName: "setRenderer", args: [RENDERER, SKIN] });
      setTx(h);
      setStep("Waiting for Ethereum to confirm…");
      if ((await rpc.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("The transaction reverted.");
      setArt(RENDERER);
      await switchOn();
    } catch (e) { setErr((e as Error).message.split("\n")[0]!); }
    setStep(null);
  };
  const done = art !== null && art.toLowerCase() === RENDERER;
  const other = art !== null && !ZERO.test(art) && !done;
  return (
    <div className="card-b">
      <ol className="swarm-plan">
        <li>{done ? "✅" : "1."} Connect the art and identity layer to the forge from your dev wallet: <b>setRenderer</b> on <a href={`https://etherscan.io/address/${FORGE}#code`} target="_blank" rel="noreferrer">{short(FORGE)}</a> with the art <a href={`https://etherscan.io/address/${RENDERER}#code`} target="_blank" rel="noreferrer">{short(RENDERER)}</a> and the identity layer <a href={`https://etherscan.io/address/${SKIN}#code`} target="_blank" rel="noreferrer">{short(SKIN)}</a>. It can be done once, ever.</li>
        <li>{on ? "✅" : "2."} The server checks the chain, switches the Forge on, and the bot announces it in the community.</li>
      </ol>
      {art === null && <p className="dim">Reading the forge on Ethereum…</p>}
      {other && <p className="bad">The forge points at another renderer ({art}). Do not continue; tell the team.</p>}
      {!done && !other && art !== null && <div className="swarm-actions"><button className="btn primary" disabled={Boolean(step)} onClick={() => void connect()}>{step ?? "Connect the art (dev wallet)"}</button></div>}
      {done && !on && <div className="swarm-actions"><button className="btn primary" disabled={Boolean(step)} onClick={() => { setErr(null); void switchOn().catch((e) => setErr((e as Error).message)).finally(() => setStep(null)); }}>{step ?? "Switch the Forge on"}</button></div>}
      {done && on && <p className="good">The Forge is open. <a href="/forge">Go forge</a>.</p>}
      {step && <p className="dim">{step}</p>}
      {tx && <p className="dim"><a href={`https://etherscan.io/tx/${tx}`} target="_blank" rel="noreferrer">Your transaction on Etherscan</a></p>}
      {err && <p className="bad">{err}</p>}
    </div>
  );
}
