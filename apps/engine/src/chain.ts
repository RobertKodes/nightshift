import { type Address, type LocalAccount, createPublicClient, createWalletClient, erc20Abi, http } from "viem";
import { base, baseSepolia, mainnet } from "viem/chains";
import { USDC } from "@nightshift/x402";
import { IMD_MAINNET } from "@nightshift/imd";
import { config } from "./config.js";

export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export const eth = createPublicClient({ chain: mainnet, transport: http(config.ethRpc) });
const salesChain = config.salesChainId === 8453 ? base : baseSepolia;
export const sales = createPublicClient({ chain: salesChain, transport: http(config.salesRpc) });

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
  const wallet = createWalletClient({ account, chain: mainnet, transport: http(config.ethRpc) });
  const hash = await wallet.writeContract({ address: IMD_MAINNET, abi: erc20Abi, functionName: "approve", args: [PERMIT2, 20n * 10n ** 18n] });
  await eth.waitForTransactionReceipt({ hash });
  return hash;
}
