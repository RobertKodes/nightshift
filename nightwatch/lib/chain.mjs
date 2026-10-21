// The chain side: one read client that fails over between nodes, a send client on a private mempool, the
// keeper's account, and one `send` every transaction goes through, so the guard rails live in one place:
//   - a kill switch: the file state/STOP stops every send without stopping the bot;
//   - a gas ceiling: nothing is sent while gas is above MAX_GAS_GWEI;
//   - an ETH floor: nothing is sent below MIN_ETH, so the last gas is never spent on a mark that cannot be
//     followed by its liquidation;
//   - simulate first: a transaction that would revert costs nothing and logs its reason instead;
//   - a gas margin over the node's estimate (the vault's cost moves a little with the block time).
// The design follows fa11up's imdusd-keeper (MIT), which learned these on mainnet first.
import { existsSync } from "node:fs";
import { createPublicClient, createWalletClient, fallback, formatEther, formatGwei, http, parseEther, parseGwei } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

export const STOP = new URL("../state/STOP", import.meta.url);

const list = (v, d) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : d);
export const READ_RPCS = list(process.env.READ_RPC_URLS, ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://rpc.mevblocker.io"]);
// MEV Blocker: a private mempool, so a liquidation is not copied and sent ahead of ours.
export const SEND_RPC = process.env.SEND_RPC_URL || "https://rpc.mevblocker.io";

export const reader = createPublicClient({ chain: mainnet, transport: fallback(READ_RPCS.map((u) => http(u, { timeout: 15_000 })), { retryCount: 1 }) });

export function keeperAccount() {
  if (process.env.KEEPER_PRIVATE_KEY) return privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY);
  if (process.env.KEEPER_MNEMONIC) return mnemonicToAccount(process.env.KEEPER_MNEMONIC);
  throw new Error("no keeper key: put KEEPER_MNEMONIC (or KEEPER_PRIVATE_KEY) in .env, for a fresh wallet that holds only the bot's funds");
}

export function sender(account) {
  return createWalletClient({ account, chain: mainnet, transport: http(SEND_RPC, { timeout: 20_000 }) });
}

const num = (v, d) => (v === undefined || v === "" ? d : Number(v));
export const guards = () => ({
  maxGasGwei: num(process.env.MAX_GAS_GWEI, 30),
  minEth: num(process.env.MIN_ETH, 0.003),
  tipGwei: num(process.env.TIP_GWEI, 0.5),
  marginBps: num(process.env.GAS_MARGIN_BPS, 2500),
});

/**
 * Simulates `call` ({ address, abi, functionName, args }) as the keeper, then sends it with the guard rails.
 * Returns { hash, block } when mined, { refused } when the simulation reverted, { skipped } when a guard said no.
 */
export async function send(account, label, call) {
  if (existsSync(STOP)) return { skipped: `kill switch: state/STOP exists, ${label} not sent` };
  const g = guards();
  const [block, balance] = await Promise.all([reader.getBlock(), reader.getBalance({ address: account.address })]);
  const base = block.baseFeePerGas ?? 0n;
  if (base > parseGwei(String(g.maxGasGwei))) return { skipped: `gas ${formatGwei(base)} gwei is above MAX_GAS_GWEI ${g.maxGasGwei}` };
  if (balance < parseEther(String(g.minEth))) return { skipped: `the keeper holds ${formatEther(balance)} ETH, below MIN_ETH ${g.minEth}: top it up` };
  let request;
  try {
    ({ request } = await reader.simulateContract({ ...call, account }));
  } catch (e) {
    return { refused: e.cause?.data?.errorName ?? e.shortMessage ?? String(e.message).slice(0, 160) };
  }
  const gas = await reader.estimateContractGas({ ...call, account });
  const tip = parseGwei(String(g.tipGwei));
  const hash = await sender(account).writeContract({
    ...request, gas: (gas * BigInt(10_000 + g.marginBps)) / 10_000n, maxPriorityFeePerGas: tip, maxFeePerGas: base * 2n + tip,
  });
  const rc = await reader.waitForTransactionReceipt({ hash, timeout: 15 * 60_000 });
  if (rc.status !== "success") throw new Error(`${label} ${hash} reverted`);
  return { hash, block: Number(rc.blockNumber) };
}

export const describe = (r) => (r.skipped ? `skipped: ${r.skipped}` : r.refused ? `refused: ${r.refused}` : `sent ${r.hash} (block ${r.block})`);
