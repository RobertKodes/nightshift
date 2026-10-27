import { useEffect, useState } from "react";
import { Link } from "./router";
import { knownWallet, type Eip1193 } from "./wallet";
import { walletAccount } from "./paidServices";
import { useSession } from "./session";
import { finite, record, usePublicRead } from "./publicRead";

type SwapFee = { bps: number; waived: boolean; holds: boolean; signedIn: string | null; collect: { lifi: boolean; relay: boolean } };
export const isSwapFee = (v: unknown): v is SwapFee => record(v) && finite(v.bps) && typeof v.waived === "boolean" && typeof v.holds === "boolean" && (v.signedIn === null || typeof v.signedIn === "string") && record(v.collect) && typeof v.collect.lifi === "boolean" && typeof v.collect.relay === "boolean";
type Rewards = { staking: { staked: string } | null };
const isRewards = (v: unknown): v is Rewards => record(v) && (v.staking === null || (record(v.staking) && typeof v.staking.staked === "string" && /^\d+$/.test(v.staking.staked)));
type Token = { holderMin: number; platformFeeBps: number; mode: string };
const isToken = (v: unknown): v is Token => record(v) && finite(v.holderMin) && finite(v.platformFeeBps) && typeof v.mode === "string";

/** Eligibility comes from the existing price and swap readers. */
export function BenefitsCard() {
  const { address: signedIn } = useSession();
  const [provider, setProvider] = useState<Eip1193 | null>(null);
  const [connected, setConnected] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => { void knownWallet().then((wallet) => { if (active) setProvider(wallet); }).catch(() => {}); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("ns-paid-wallet", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); window.removeEventListener("ns-paid-wallet", refresh); };
  }, [signedIn]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!provider) { setConnected(null); return; }
      void walletAccount(provider).then((wallet) => { if (active) setConnected(wallet.from); }).catch(() => { if (active) setConnected(null); });
    };
    refresh();
    provider?.on("accountsChanged", refresh);
    provider?.on("disconnect", refresh);
    return () => { active = false; provider?.removeListener("accountsChanged", refresh); provider?.removeListener("disconnect", refresh); };
  }, [provider]);
  const address = connected ?? signedIn;
  const fee = usePublicRead(address ? `/api/swap/fee?wallet=${encodeURIComponent(address)}` : null, isSwapFee);
  const rewards = usePublicRead(address ? `/api/rewards/${encodeURIComponent(address)}` : null, isRewards);
  const token = usePublicRead("/api/token", isToken);
  const [eligibility, setEligibility] = useState<{ wallet: string; state: "ready"; half: boolean } | { wallet: string; state: "unavailable" } | null>(null);
  useEffect(() => {
    if (!address) return;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    // No payment signature: this only asks for the paying wallet's terms.
    void fetch(`/api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=quick&holder=${encodeURIComponent(address)}`, { signal: controller.signal }).then(async (r) => {
      const body: unknown = await r.json();
      if (r.status !== 402 || !record(body) || typeof body.holderPrice !== "boolean") throw new Error("Unavailable");
      if (active) setEligibility({ wallet: address, state: "ready", half: body.holderPrice });
    }).catch(() => { if (active) setEligibility({ wallet: address, state: "unavailable" }); }).finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [address]);
  const e = eligibility?.wallet === address ? eligibility : null;
  const staked = rewards.state === "ready" && rewards.data.staking ? BigInt(rewards.data.staking.staked) : null;
  return <section className="clarity-box benefits" id="benefits" aria-labelledby="benefits-title">
    <h2 id="benefits-title">What holding $SHIFT gets you</h2>
    <p>Browse without a wallet. Token tiers count SHIFT in your wallet plus SHIFT staked in ShiftRewards on Ethereum. A Frog or Night Watcher is an alternative for the service and swap perks.</p>
    {address ? <div className="clarity-status" role="status">
      <b>Your {connected ? "connected" : "signed-in"} wallet</b>
      <p>{!e ? "Checking house-tool eligibility…" : e.state === "unavailable" ? "House-tool eligibility unavailable." : e.half ? "Meets the house-tool tier: 500k SHIFT or a Frog / Night Watcher. Pay from this wallet for the holder price." : "The house-tool reader reports standard pricing for this wallet."}</p>
      <p>{fee.state === "loading" ? "Checking the swap tier…" : fee.state === "unavailable" ? "Swap eligibility unavailable." : fee.data.holds ? "Meets the swap tier: 5M SHIFT or a Frog / Night Watcher." : "The swap reader reports that this wallet does not meet the waiver tier."} {fee.state === "ready" && fee.data.holds && (fee.data.waived && fee.data.signedIn?.toLowerCase() === address.toLowerCase() ? "The NIGHTSHIFT fee is waived for this wallet session." : "Sign in with this wallet to apply its waiver.")}</p>
      <p>{rewards.state === "loading" ? "Reading staked SHIFT…" : staked === null ? "Staked balance unavailable." : staked === 0n ? "No SHIFT stake reported." : `Staking tier active: ${(Number(staked) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 4 })} SHIFT staked.`}</p>
    </div> : <p className="clarity-status">Wallet optional. If a wallet is connected, this card checks your service price, swap tier and staked balance. <Link to="/mcp">Connect an AI agent</Link> to use the same tools.</p>}
    {token.state === "ready" && token.data.mode !== "live" && <p className="clarity-status">This server reports simulation mode. No live payments are confirmed here.</p>}
    <dl className="benefits-ladder">
      <div><dt>Any visitor</dt><dd>Free SWARM MIND ask/search of published IMD work, token/hook previews, API sample checks and free games.</dd></div>
      <div><dt>500k SHIFT · wallet + staked</dt><dd>Half price on house checks and reports. Fast lookups have a $0.001 minimum; Swarm Desk jobs keep the full quoted price. Also eligible to queue a holder Spotlight check on the live dashboard.</dd></div>
      <div><dt>5M SHIFT · wallet + staked</dt><dd>The house-tool perks, plus a NIGHTSHIFT swap-fee waiver after wallet sign-in. Provider, bridge, pool and gas costs still apply.</dd></div>
      <div><dt>Stake SHIFT</dt><dd>Stake a positive amount accepted by the contract. Claim earned, funded ETH/SHIFT rewards; withdraw principal once its lock ends. Choose a lock of 0–730 days. <Link to="/stake">See locks and rewards →</Link></dd></div>
      <div><dt>Frog or Night Watcher</dt><dd>Alternative service and swap perks, earned hours toward the Frog reward pot, missions and extra business slots. Eligible Night Watchers also unlock the private group and keeper seats. <Link to="/frogs">Frogs →</Link></dd></div>
    </dl>
    <details className="clarity-more"><summary>More · business-owner rules</summary><p>Business perks use a separate wallet-only SHIFT reader and NFT check. Staked SHIFT does not count in that reader. Eligible owners can feature products; a withdrawal waiver needs seven days of observed eligibility and a fresh check.</p><p>{token.state === "loading" ? "Reading configured business threshold and fee…" : token.state === "unavailable" || token.data.mode !== "live" ? "Current business threshold and fee unavailable." : `Configured token threshold: ${token.data.holderMin.toLocaleString("en-US")} SHIFT${token.data.holderMin === 0 ? " (token qualification disabled)" : ""}. Standard withdrawal fee: ${token.data.platformFeeBps / 100}%. If the fee is zero, a waiver saves nothing.`}</p><Link to="/my">My companies →</Link></details>
  </section>;
}
