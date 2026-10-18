import { useEffect, useRef, useState } from "react";
import { createWalletClient, custom, erc20Abi, formatEther, formatUnits, parseEther } from "viem";
import { base, mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";

const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
/** What a company needs before its first shift: IMD for the swarm, gas on Ethereum, gas where it sells. */
const NEED = { imd: 1n * 10n ** 18n, eth: parseEther("0.002"), saleGas: parseEther("0.0005") };
type Bal = { imd: bigint; eth: bigint; saleGas: bigint };

const flag = "ns-fund";
/** Set right after a company is created, so its page opens the wallet by itself. */
export const fundNext = (id: string) => { try { sessionStorage.setItem(flag, id); } catch { /* private window */ } };
const takeFlag = (id: string) => { try { const v = sessionStorage.getItem(flag); if (v === id) sessionStorage.removeItem(flag); return v === id; } catch { return false; } };

/**
 * Funds a company wallet from the owner's own wallet: up to three transfers, each confirmed in the
 * wallet (IMD and ETH on Ethereum, ETH on Base). Only what is missing is asked for.
 */
/** `first`: nothing has run yet. Later the card is a top-up: the engine itself keeps working down to 0.5 IMD. */
export function FundCard({ id, wallet, first = true, onFunded }: { id: string; wallet: `0x${string}`; first?: boolean; onFunded: () => void }) {
  const [bal, setBal] = useState<Bal | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);

  const load = () => fetch(`/api/companies/${id}/wallet`, { credentials: "include" }).then((r) => r.json())
    .then((d: Record<string, string>) => { if (d.imd !== undefined) setBal({ imd: BigInt(d.imd), eth: BigInt(d.eth ?? 0), saleGas: BigInt(d.saleGas ?? 0) }); }).catch(() => {});
  useEffect(() => { void load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [id]);

  const missing = bal ? { imd: bal.imd < NEED.imd ? NEED.imd - bal.imd : 0n, eth: bal.eth < NEED.eth ? NEED.eth - bal.eth : 0n, saleGas: bal.saleGas < NEED.saleGas ? NEED.saleGas - bal.saleGas : 0n } : null;
  const funded = Boolean(missing && !missing.imd && !missing.eth && !missing.saleGas);

  const fund = async () => {
    if (!missing) return;
    setErr(null);
    try {
      const provider = await chooseWallet();
      const w = createWalletClient({ chain: mainnet, transport: custom(provider as never) });
      const [me] = await w.requestAddresses();
      if (!me) throw new Error("No account in the wallet.");
      if (missing.imd || missing.eth) {
        setStep("Switch to Ethereum…");
        await w.switchChain({ id: 1 });
        if (missing.imd) {
          setStep(`Confirm ${formatUnits(missing.imd, 18)} IMD in your wallet…`);
          await w.writeContract({ account: me, chain: mainnet, address: IMD, abi: erc20Abi, functionName: "transfer", args: [wallet, missing.imd] });
        }
        if (missing.eth) {
          setStep(`Confirm ${formatEther(missing.eth)} ETH (Ethereum gas) in your wallet…`);
          await w.sendTransaction({ account: me, chain: mainnet, to: wallet, value: missing.eth });
        }
      }
      if (missing.saleGas) {
        setStep("Switch to Base…");
        await w.switchChain({ id: 8453 }).catch(async () => { await w.addChain({ chain: base }); await w.switchChain({ id: 8453 }); });
        setStep(`Confirm ${formatEther(missing.saleGas)} ETH on Base (gas for sales) in your wallet…`);
        await w.sendTransaction({ account: me, chain: base, to: wallet, value: missing.saleGas });
      }
      setStep("Sent. Waiting for the chain…");
      for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 6000)); await load(); }
      setStep(null);
    } catch (e) {
      setErr(((e as Error).message ?? "").split("\n")[0]!.slice(0, 160));
      setStep(null);
    }
  };

  useEffect(() => { if (missing && !funded && !started.current && takeFlag(id)) { started.current = true; void fund(); } }, [missing === null, funded]);
  useEffect(() => { if (funded && step) { setStep(null); onFunded(); } }, [funded]);

  if (!bal) return null;
  if (funded) return null;
  const row = (label: string, have: string, need: string, ok: boolean) => <li><i className={`dot ${ok ? "ok" : "warn"}`} /><div><b>{label}</b><span>{have} of {need}</span></div></li>;
  return (
    <div className="card fund-card">
      <div className="card-h"><h3>Fund the company</h3><span className="pill failed">{first ? "needed before its first shift" : "running low: top it up"}</span></div>
      <ul className="checks">
        {row("IMD for the swarm (Ethereum)", formatUnits(bal.imd, 18), "1 IMD", !missing!.imd)}
        {row("Gas on Ethereum", formatEther(bal.eth), "0.002 ETH", !missing!.eth)}
        {row("Gas on Base, for sales and withdrawals", formatEther(bal.saleGas), "0.0005 ETH", !missing!.saleGas)}
      </ul>
      <div className="card-b" style={{ display: "grid", gap: 8 }}>
        <button className="btn primary" disabled={Boolean(step)} onClick={() => void fund()}>{step ?? "Fund from my wallet"}</button>
        {err && <span className="bad" style={{ fontSize: 13 }}>{err}</span>}
        <details className="fund-manual">
          <summary>Or send it yourself from your wallet</summary>
          <span>Send to the company wallet, on Ethereum: IMD and ETH. On Base: a little ETH.</span>
          <code>{wallet}</code>
          <button className="btn" type="button" onClick={() => void navigator.clipboard?.writeText(wallet)}>Copy address</button>
          <span className="dim">This page sees the funds within a minute either way.</span>
        </details>
        <span className="dim" style={{ fontSize: 13 }}>Only what is missing is asked for, one confirmation each. The money goes to the company's own wallet {wallet.slice(0, 6)}…{wallet.slice(-4)}, which pays the IMD swarm and receives the sales.</span>
      </div>
    </div>
  );
}
