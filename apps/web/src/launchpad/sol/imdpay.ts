import { INTAKE, LAUNCH_CHAINS } from "@nightshift/launch";
import { type Address, createPublicClient, createWalletClient, custom, erc20Abi, http, parseAbi, stringToHex } from "viem";
import { mainnet, robinhood } from "viem/chains";
import { type Step, canBatch, rejected, sendSteps } from "../../batch";
import { chooseWallet } from "../../wallet";
import { PAY_NAMES, type PayChain } from "./options";

/**
 * Pay the IMD swarm's job for a Solana launch from the creator's own Ethereum or Robinhood Chain
 * wallet: approve exactly 0.5 IMD (once) and send one request to IMD's onchain Intake with the exact
 * body NIGHTSHIFT wrote for the launch. The IMD goes to IMD, not to NIGHTSHIFT.
 */

const intakeAbi = parseAbi(["function request(bytes32 action, bytes body, (address target, bytes4 selector) callback, address asset, uint256 amount) returns (bytes32)"]);
const PRICE = 500_000_000_000_000_000n; // 0.5 IMD, 18 decimals
const ACTION = "job.open@job-1";
const VIEM = { 1: mainnet, 4663: robinhood } as const;
const RPC = { 1: "https://ethereum-rpc.publicnode.com", 4663: "https://rpc.mainnet.chain.robinhood.com" } as const;

export async function payImdJob(o: { chainId: PayChain; body: string; say: (s: string) => void }): Promise<string> {
  const id = o.chainId;
  const chain = LAUNCH_CHAINS[id];
  const rpc = createPublicClient({ chain: VIEM[id], transport: http(RPC[id]) });
  try {
    const w = createWalletClient({ chain: VIEM[id], transport: custom((await chooseWallet({ chain: id })) as never) });
    o.say(`Connect the wallet that pays IMD on ${PAY_NAMES[id]}…`);
    const [me] = await w.requestAddresses();
    if (!me) throw new Error("No account in the wallet.");
    await w.switchChain({ id }).catch(() => { throw new Error(`Switch your wallet to ${PAY_NAMES[id]}.`); });
    const imd = chain.imd as Address;
    const bal = await rpc.readContract({ address: imd, abi: erc20Abi, functionName: "balanceOf", args: [me] });
    if (bal < PRICE) throw new Error(`This wallet has ${(Number(bal) / 1e18).toFixed(3)} IMD on ${PAY_NAMES[id]}. The swarm's job costs 0.5 IMD there, plus a little ETH for gas. Buy IMD in the swap first; your signed launch keeps waiting.`);
    const allowance = await rpc.readContract({ address: imd, abi: erc20Abi, functionName: "allowance", args: [me, INTAKE] });
    const steps: Step[] = [];
    if (allowance < PRICE) steps.push({ call: { address: imd, abi: erc20Abi, functionName: "approve", args: [INTAKE, PRICE] }, sign: "1 of 2: allow IMD's Intake to take exactly 0.5 IMD…", wait: "Waiting for the approval…", fail: "The approval failed. Nothing was paid." });
    const two = steps.length > 0;
    steps.push({
      call: { address: INTAKE, abi: intakeAbi, functionName: "request", args: [stringToHex(ACTION, { size: 32 }), stringToHex(o.body), { target: "0x0000000000000000000000000000000000000000", selector: "0x00000000" }, imd, PRICE] },
      sign: two ? "2 of 2: pay 0.5 IMD and send the swarm its job…" : "Pay 0.5 IMD and send the swarm its job (confirm in your wallet)…",
      wait: "Waiting for the payment to confirm…",
    });
    const batched = two && (await canBatch(w, me, id));
    const sent = await sendSteps(w, me, steps, { batched, once: "Confirm once: allow exactly 0.5 IMD, pay and send the job…", wait: "Waiting for the payment to confirm…", say: o.say, on: { chain: VIEM[id], rpc: rpc as never } });
    if (!sent.ok) throw new Error(`The payment reverted: ${sent.hash}. If IMD did not take it, only gas was spent.`);
    return sent.hash;
  } catch (e) {
    if (rejected(e)) throw new Error("You declined in the wallet. Nothing was paid; your signed launch keeps waiting.");
    throw e;
  }
}
