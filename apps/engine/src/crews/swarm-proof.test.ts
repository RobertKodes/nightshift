import { encodeAbiParameters, encodeEventTopics, parseAbiItem, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { confirmSwarmRefill } from "./swarm-live.js";
import { REFILL_IMD, REFILL_USDC, type SwarmRefillOrder } from "./swarm-refill.js";

const HOUSE = "0x4444444444444444444444444444444444444444", OTHER = "0x1111111111111111111111111111111111111111";
const SOURCE = `0x${"a".repeat(64)}` as Hex, DEST = `0x${"b".repeat(64)}` as Hex;
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const log = (token: string, from: `0x${string}`, to: `0x${string}`, amount: bigint) => ({ address: token, topics: encodeEventTopics({ abi: [transfer], eventName: "Transfer", args: { from, to } }).filter((t): t is Hex => typeof t === "string"), data: encodeAbiParameters([{ type: "uint256" }], [amount]) });
const order = { kind: "imd", amount: "3000000", route: { provider: "lifi", toAmountMin: "3000000000000000000", track: { tool: "across" } }, legs: [{ signed: { hash: SOURCE } }] } as SwarmRefillOrder;
function proof() {
  return { status: vi.fn(async () => ({ body: { state: "done", outHash: DEST } })),
    base: vi.fn(async (_hash: Hex) => ({ status: "success", transactionHash: SOURCE, logs: [log(REFILL_USDC, HOUSE, OTHER, 3_000_000n)] })),
    ethereum: vi.fn(async () => ({ status: "success", transactionHash: DEST, logs: [log(REFILL_IMD, OTHER, HOUSE, 3_000_000_000_000_000_000n)] })),
    native: vi.fn(async (): Promise<bigint | null> => null) };
}
describe("on-chain Swarm refill proof", () => {
  it("requires both exact Base spend and Ethereum delivery to the house", async () => {
    const d = proof(); expect(await confirmSwarmRefill(order, HOUSE, d)).toMatchObject({ state: "done", tx: DEST, amount: order.route.toAmountMin });
    d.ethereum.mockResolvedValue({ status: "success", transactionHash: DEST, logs: [log(REFILL_IMD, OTHER, OTHER, 3_000_000_000_000_000_000n)] });
    expect(await confirmSwarmRefill(order, HOUSE, d)).toEqual({ state: "pending" });
    d.base.mockResolvedValue({ status: "success", transactionHash: SOURCE, logs: [log(REFILL_USDC, HOUSE, OTHER, 1n)] });
    await expect(confirmSwarmRefill(order, HOUSE, d)).rejects.toThrow("Source receipt");
  });
  it("does not guess native ETH delivery when the RPC cannot prove it", async () => {
    const gas = { ...order, kind: "gas" as const, route: { ...order.route, toAmountMin: "2000000000000000" } }, d = proof();
    expect(await confirmSwarmRefill(gas, HOUSE, d)).toEqual({ state: "pending" }); d.native.mockResolvedValue(2_000_000_000_000_000n);
    expect(await confirmSwarmRefill(gas, HOUSE, d)).toMatchObject({ state: "done", amount: "2000000000000000" });
  });
  it("requires a full on-chain USDC refund before releasing the budget", async () => {
    const d = proof(); d.status.mockResolvedValue({ body: { state: "failed", outHash: DEST } });
    expect(await confirmSwarmRefill(order, HOUSE, d)).toEqual({ state: "pending" });
    const source = await d.base(SOURCE); d.base.mockImplementation(async (hash) => hash === SOURCE ? source : { status: "success", transactionHash: DEST, logs: [log(REFILL_USDC, OTHER, HOUSE, 3_000_000n)] });
    expect(await confirmSwarmRefill(order, HOUSE, d)).toEqual({ state: "refunded", tx: DEST });
  });
});
