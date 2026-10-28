import { ethTransport } from "./ethRpc";
import { useState } from "react";
import { SHIFT } from "./shift";
import { type Address, createPublicClient, createWalletClient, custom, formatEther, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";

const rpc = createPublicClient({ chain: mainnet, transport: ethTransport() });
const REWARDS = parseAbi([
  "function claimFrogs(uint256 epoch, address token, uint256 amount, bytes32[] proof)",
  "function frogsClaimed(uint256 epoch, address token, address account) view returns (bool)",
]);
type Claim = { epoch: number; token: string; symbol: string; amount: string; proof: string[]; claimed?: boolean };
const errText = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "").split("\n")[0]!.slice(0, 160);
const key = (c: Claim) => `${c.epoch}-${c.token}`;

/** The frog half of the rewards: each posted weekly epoch, claimed once with its Merkle proof from your wallet. */
export function FrogClaims() {
  const [me, setMe] = useState<Address | null>(null);
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [rewards, setRewards] = useState<Address | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const wallet = async () => {
    const w = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet()) as never) });
    const [a] = await w.requestAddresses();
    if (!a) throw new Error("No account in the wallet.");
    return { w, a };
  };
  /** Each claim's state is read from the contract itself, so a claimed epoch never shows a button again. */
  const withState = async (list: Claim[], who: Address, at: Address | null) => !at ? list : Promise.all(list.map(async (c) => ({
    ...c, claimed: await rpc.readContract({ address: at, abi: REWARDS, functionName: "frogsClaimed", args: [BigInt(c.epoch), c.token as Address, who] }).catch(() => false),
  })));
  const check = async () => {
    setMsg(null);
    try {
      const { a } = await wallet();
      setMe(a);
      const d = await fetch(`/api/frogs/claims?address=${a}`).then((r) => r.json());
      const at = d.rewards ? SHIFT.rewards : null;
      setRewards(at);
      setClaims(await withState(d.claims ?? [], a, at));
    } catch (e) { setMsg(errText(e)); }
  };
  const claim = async (c: Claim) => {
    setBusy(key(c)); setMsg(null);
    try {
      const { w, a } = await wallet();
      await w.switchChain({ id: 1 });
      const h = await w.writeContract({ account: a, chain: mainnet, address: rewards!, abi: REWARDS, functionName: "claimFrogs", args: [BigInt(c.epoch), c.token as Address, BigInt(c.amount), c.proof as `0x${string}`[]] });
      const r = await rpc.waitForTransactionReceipt({ hash: h });
      if (r.status === "success") {
        setMsg(`Claimed ${formatEther(BigInt(c.amount))} ${c.symbol}.`);
        setClaims((list) => list?.map((x) => (key(x) === key(c) ? { ...x, claimed: true } : x)) ?? list);
      } else setMsg("It reverted: already claimed, or past its 30 days.");
      // and the chain's word, in case it was claimed elsewhere
      if (claims) setClaims(await withState(claims, a, rewards));
    } catch (e) { setMsg(errText(e)); } finally { setBusy(null); }
  };

  const open = claims?.filter((c) => !c.claimed) ?? [];
  return (
    <section className="tkn-card">
      <div className="tkn-head"><div><b>YOUR FROG REWARDS</b><span>weekly epochs · ETH and $SHIFT · claim within 30 days</span></div></div>
      {!me ? <button className="btn primary" onClick={() => void check()}>Connect wallet to see what you can claim</button>
        : !claims?.length ? <p className="dim" style={{ fontSize: 13 }}>Nothing to claim for {me.slice(0, 6)}…{me.slice(-4)} yet. Epochs are posted every Monday after launch.</p>
          : <>
            {open.length === 0 && <p className="good" style={{ fontSize: 13 }}>All claimed. New epochs are posted every Monday.</p>}
            <table className="plain"><thead><tr><th>Epoch</th><th>Amount</th><th></th></tr></thead><tbody>
              {claims.map((c) => <tr key={key(c)}><td>{c.epoch}</td><td>{Number(formatEther(BigInt(c.amount))).toFixed(6)} {c.symbol}</td>
                <td>{c.claimed ? <span className="good">Claimed ✓</span>
                  : <button className="btn" disabled={Boolean(busy) || !rewards} onClick={() => void claim(c)}>{busy === key(c) ? "…" : "Claim"}</button>}</td></tr>)}
            </tbody></table>
          </>}
      {msg && <p style={{ fontSize: 13 }}>{msg}</p>}
    </section>
  );
}
