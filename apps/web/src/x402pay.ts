import { type Address, type Hex, createWalletClient, custom } from "viem";
import { base, baseSepolia } from "viem/chains";
import { type Eip1193, chooseWallet } from "./wallet";

export interface Requirement { network: string; asset: `0x${string}`; amount: string; payTo: `0x${string}`; maxTimeoutSeconds: number; extra: { name: string; version: string } }

/** Signs one EIP-3009 transfer and keeps the accepted terms intact. */
export async function signPayment(eth: Eip1193, from: Address, req: Requirement) {
  const wallet = createWalletClient({ transport: custom(eth as never) });
  const chainId = Number(req.network.split(":")[1]);
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from, to: req.payTo, value: req.amount, validAfter: String(now - 5), validBefore: String(now + req.maxTimeoutSeconds),
    nonce: `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex,
  };
  const signature = await wallet.signTypedData({
    account: from,
    domain: { name: req.extra.name, version: req.extra.version, chainId, verifyingContract: req.asset },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] },
    primaryType: "TransferWithAuthorization",
    message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
  });
  return { x402Version: 2, accepted: req, payload: { signature, authorization } };
}

/** Pays an x402 link from the visitor's own wallet: sign a USDC authorization, send it, get the product. */
export async function buyWithWallet(buyUrl: string): Promise<{ deliverable: string | null; tx: string }> {
  const eth = await chooseWallet();
  const challenge = await fetch(buyUrl);
  if (challenge.status !== 402) throw new Error(((await challenge.json().catch(() => ({}))) as { error?: string }).error ?? `unexpected ${challenge.status}`);
  const ch = (await challenge.json()) as { accepts: Requirement[] };
  const req = ch.accepts[0]!;
  // Sign only a USDC payment on Base (or Base Sepolia in the demo), whatever the server asks for.
  const USDC_BY_NETWORK: Record<string, string> = { "eip155:8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "eip155:84532": "0x036cbd53842c5426634e7929541ec2318f3dcf7e" };
  if (USDC_BY_NETWORK[req.network] !== String(req.asset).toLowerCase()) throw new Error("This payment is not USDC on Base. Refusing to sign it.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(req.payTo) || BigInt(req.amount) <= 0n || BigInt(req.amount) > 500_000_000n) throw new Error("This payment request looks wrong. Refusing to sign it.");
  const chainId = Number(req.network.split(":")[1]);
  const wallet = createWalletClient({ transport: custom(eth as never) });
  const [from] = await wallet.requestAddresses();
  if (!from) throw new Error("No account");
  // A wallet that has never seen Base is offered the chain first.
  await wallet.switchChain({ id: chainId }).catch(async () => {
    await wallet.addChain({ chain: chainId === 8453 ? base : baseSepolia });
    await wallet.switchChain({ id: chainId });
  }).catch(() => { throw new Error(`Switch your wallet to ${chainId === 8453 ? "Base" : `chain ${chainId}`}.`); });
  const payment = await signPayment(eth, from, req);
  // Still waiting for Base (202): the same signed header again, never a new signature, so it is paid once.
  for (let i = 0; ; i++) {
    const res = await fetch(buyUrl, { headers: { "PAYMENT-SIGNATURE": btoa(JSON.stringify(payment)) } });
    const j = await res.json();
    if (res.status === 202 && i < 8) { await new Promise((r) => setTimeout(r, 15_000)); continue; }
    if (!res.ok || res.status === 202) throw new Error(j.error ?? "payment refused");
    return j;
  }
}

