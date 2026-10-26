import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { confirmReserveDelivery } from "./economy-live.js";
import { RESERVE_SHIFT, RESERVE_USDC, RESERVE_WALLET, type ReserveBuy } from "./agent-reserve.js";
import { checkSetup, ANNOUNCED } from "./admin.js";

const HOUSE = `0x${"44".repeat(20)}` as Hex, ROUTER = `0x${"55".repeat(20)}` as Hex;
const SOURCE = `0x${"ab".repeat(32)}` as Hex, DEST = `0x${"cd".repeat(32)}` as Hex;
const log = (token: string, from: Hex, to: Hex, value: bigint) => ({ address: token, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }) as Hex[], data: encodeAbiParameters([{ type: "uint256" }], [value]) });
const fixture = () => {
  const b = { amount: "25000000", recipient: RESERVE_WALLET, route: { provider: "lifi", track: { tool: "across" }, toAmountMin: "97000000000000000000" }, legs: [{ signed: { hash: SOURCE } }] } as unknown as ReserveBuy;
  const input = { status: "success", transactionHash: SOURCE, logs: [log(RESERVE_USDC, HOUSE, ROUTER, 25_000_000n)] };
  const output = { status: "success", transactionHash: DEST, logs: [log(RESERVE_SHIFT, ROUTER, RESERVE_WALLET, 99n * 10n ** 18n)] };
  const status = vi.fn(async () => ({ body: { state: "done", outHash: DEST } }));
  const base = vi.fn(async () => input), ethereum = vi.fn(async () => output);
  return { b, input, output, d: { status, base, ethereum } };
};

describe("reserve chain adapter", () => {
  it("validates and announces settings that enable or redirect the reserve", () => {
    expect(checkSetup({ AGENT_RESERVE: "2" })).toContain("AGENT_RESERVE");
    expect(checkSetup({ AGENT_RESERVE_DRY: "true" })).toContain("AGENT_RESERVE_DRY");
    expect(checkSetup({ RESERVE_WALLET: "not-a-wallet" })).toContain("RESERVE_WALLET");
    expect(checkSetup({ AGENT_RESERVE: "1", AGENT_RESERVE_DRY: "1", RESERVE_WALLET })).toBeNull();
    expect(ANNOUNCED).toEqual(expect.arrayContaining(["AGENT_RESERVE", "AGENT_RESERVE_DRY", "RESERVE_WALLET"]));
  });
  it("proves the Base USDC input and actual Ethereum SHIFT delivery to the team wallet", async () => {
    const x = fixture(), r = await confirmReserveDelivery(x.b, HOUSE, x.d);
    expect(r).toEqual({ state: "done", tx: DEST, shift: "99000000000000000000" });
    expect(x.d.base).toHaveBeenCalledWith(SOURCE); expect(x.d.ethereum).toHaveBeenCalledWith(DEST);
  });
  it.each(["recipient", "token", "amount", "reverted"])("does not accept the provider's success with a wrong %s", async (kind) => {
    const x = fixture();
    if (kind === "recipient") x.output.logs = [log(RESERVE_SHIFT, ROUTER, HOUSE, 99n * 10n ** 18n)];
    if (kind === "token") x.output.logs = [log(RESERVE_USDC, ROUTER, RESERVE_WALLET, 99n * 10n ** 18n)];
    if (kind === "amount") x.output.logs = [log(RESERVE_SHIFT, ROUTER, RESERVE_WALLET, 96n * 10n ** 18n)];
    if (kind === "reverted") x.output.status = "reverted";
    expect(await confirmReserveDelivery(x.b, HOUSE, x.d)).toEqual({ state: "pending" });
  });
  it("rejects a source receipt that does not spend the exact reserve amount", async () => {
    const x = fixture(); x.input.logs = [log(RESERVE_USDC, HOUSE, ROUTER, 24_000_000n)];
    await expect(confirmReserveDelivery(x.b, HOUSE, x.d)).rejects.toThrow("Source USDC transfer");
  });
  it("requires an onchain refund before allowing another buy", async () => {
    const x = fixture(); x.d.status.mockResolvedValue({ body: { state: "refunded", outHash: DEST } });
    expect(await confirmReserveDelivery(x.b, HOUSE, x.d)).toMatchObject({ state: "pending", warning: expect.stringContaining("refund is not proven") });
    x.d.base.mockImplementation(async (hash?: Hex) => hash === SOURCE ? x.input : ({ status: "success", transactionHash: DEST, logs: [log(RESERVE_USDC, ROUTER, HOUSE, 25_000_000n)] }));
    expect(await confirmReserveDelivery(x.b, HOUSE, x.d)).toEqual({ state: "refunded" });
  });
});
