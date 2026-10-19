import { type Address, type Hex, type LocalAccount, createPublicClient, createWalletClient, erc20Abi, fallback, http, keccak256 } from "viem";
import { base, baseSepolia, mainnet } from "viem/chains";
import { USDC } from "@nightshift/x402";
import { IMD_MAINNET } from "@nightshift/imd";
import { config } from "./config.js";

export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/**
 * Ethereum through several free nodes: the configured one first (unless it is publicnode, which now blocks
 * this server's IP), then MEV Blocker, dRPC and publicnode. A node that refuses or fails hands over to the next.
 */
const ETH_RPCS = [...new Set([...(config.ethRpc.includes("publicnode") ? [] : [config.ethRpc]), "https://rpc.mevblocker.io", "https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"])];
const ethTransport = () => fallback(ETH_RPCS.map((u) => http(u, { timeout: 15_000 })), { retryCount: 1 });
export const eth = createPublicClient({ chain: mainnet, transport: ethTransport() });
const salesChain = config.salesChainId === 8453 ? base : baseSepolia;
export const sales = createPublicClient({ chain: salesChain, transport: http(config.salesRpc) });

export function ethWallet(account: LocalAccount) {
  return createWalletClient({ account, chain: mainnet, transport: ethTransport() });
}

export function salesWallet(account: LocalAccount) {
  return createWalletClient({ account, chain: salesChain, transport: http(config.salesRpc) });
}

export interface Balances {
  eth: bigint;
  imd: bigint;
  usdc: bigint;
  saleGas: bigint;
}

/** What the company wallet really holds: gas and IMD on Ethereum, USDC and gas where it sells. */
export async function balances(addr: Address): Promise<Balances> {
  const usdc = USDC[config.salesChainId]!.address;
  const [e, i, u, g] = await Promise.all([
    eth.getBalance({ address: addr }),
    eth.readContract({ address: IMD_MAINNET, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
    sales.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
    sales.getBalance({ address: addr }),
  ]);
  return { eth: e, imd: i, usdc: u, saleGas: g };
}

/** IMD payments go through Permit2, which needs a one-time allowance (paid in ETH gas). */
export async function ensurePermit2(account: LocalAccount): Promise<`0x${string}` | null> {
  const allowance = await eth.readContract({ address: IMD_MAINNET, abi: erc20Abi, functionName: "allowance", args: [account.address, PERMIT2] });
  // A bounded allowance (20 IMD, refilled below 2): even a bad signature cannot reach the whole wallet.
  if (allowance >= 2n * 10n ** 18n) return null;
  const wallet = createWalletClient({ account, chain: mainnet, transport: ethTransport() });
  const hash = await wallet.writeContract({ address: IMD_MAINNET, abi: erc20Abi, functionName: "approve", args: [PERMIT2, 20n * 10n ** 18n] });
  await eth.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Money that leaves a company wallet on the sales chain is signed first and saved by the caller
 * before it is broadcast, so a crash or a lost answer never leaves a transfer nobody knows about.
 */
export type TxState = "success" | "reverted" | "pending" | "dropped";
export interface SignedTx { hash: Hex; raw: Hex; nonce: number }

export async function signSales(account: LocalAccount, to: Address, data: Hex): Promise<SignedTx> {
  const w = salesWallet(account);
  const req = await w.prepareTransactionRequest({ account, chain: w.chain, to, data });
  const raw = await w.signTransaction(req as never);
  return { hash: keccak256(raw), raw, nonce: Number(req.nonce) };
}

export async function broadcastSales(raw: Hex): Promise<void> {
  await sales.sendRawTransaction({ serializedTransaction: raw });
}

/** The node turned the transaction away, so it is not on its way: safe to forget and sign again. */
export const refusedByNode = (e: unknown) => /insufficient funds|nonce too low|intrinsic gas|underpriced|exceeds block gas limit|invalid sender|gas required exceeds/i.test(String((e as Error)?.message ?? e));

/**
 * Where a signed transaction stands. `dropped`: never mined and its nonce is used by another one,
 * so it can never land. `pending`: not mined yet, and still could be.
 */
export async function salesTxState(from: Address, hash: Hex, nonce: number | undefined, waitMs: number): Promise<TxState> {
  const receipt = () => sales.getTransactionReceipt({ hash }).catch(() => null);
  const r = waitMs > 0 ? await sales.waitForTransactionReceipt({ hash, timeout: waitMs }).catch(() => null) ?? await receipt() : await receipt();
  // viem answers with the replacement's receipt when another transaction took the nonce: that one is not ours
  if (r && r.transactionHash.toLowerCase() !== hash.toLowerCase()) return "dropped";
  if (r) return r.status === "success" ? "success" : "reverted";
  if (nonce === undefined) return "pending";
  const used = await sales.getTransactionCount({ address: from, blockTag: "latest" }).catch(() => -1);
  if (used > nonce) { const again = await receipt(); return again ? (again.status === "success" ? "success" : "reverted") : "dropped"; }
  return "pending";
}
