import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Quote } from "@nightshift/swap";
import { AgentReserve, checkReserveRoute, RESERVE_GAS, RESERVE_SHIFT, RESERVE_USDC, RESERVE_WALLET, reserveBuyMessage, type ReserveDeps, type ReserveSettings } from "./agent-reserve.js";
import type { ProofPayment } from "./proof.js";
import type { SignedTx, TxState } from "./chain.js";

const HOUSE = `0x${"44".repeat(20)}`, ROUTER = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";
const TX = `0x${"ab".repeat(32)}`, OUT = `0x${"cd".repeat(32)}`;
const T0 = Date.parse("2026-10-26T10:00:00Z");
const pay = (n = 1, units = "50000000", cls: ProofPayment["cls"] = "customer"): ProofPayment => ({ key: `0x${"66".repeat(20)}:${n}`, at: T0, payer: `0x${"66".repeat(20)}`, units, usd: Number(units) / 1e6, cls, house: true, product: "Service", service: "research-report", tx: TX, company: "House" });
const route = (amount = 25_000_000n): Quote => ({
  sender: HOUSE, recipient: RESERVE_WALLET, provider: "lifi", providerName: "LI.FI", tool: "across", id: "quote", fromChain: "base", toChain: "eth",
  fromToken: { chain: "base", address: RESERVE_USDC, decimals: 6, symbol: "USDC", name: "USDC", verified: true, priceUsd: 1 },
  toToken: { chain: "eth", address: RESERVE_SHIFT, decimals: 18, symbol: "SHIFT", name: "SHIFT", verified: true, priceUsd: null },
  fromAmount: String(amount), toAmount: "100000000000000000000", toAmountMin: "97000000000000000000", fromUsd: Number(amount) / 1e6, toUsd: null,
  steps: [], fees: [], gasUsd: null, nightshift: { bps: 0, usd: 0, amount: "0", waived: true, note: "Internal buy" }, etaSeconds: 60, slippage: 0.03,
  approval: { token: RESERVE_USDC, spender: ROUTER, amount: String(amount) },
  txs: [{ kind: "evm", chainId: 8453, to: ROUTER, data: "0x1234", value: "0", gas: "200000" }], contracts: [], track: { provider: "lifi", tool: "across" }, problems: [],
});
const setup = (file: string | null = null) => {
  let t = T0, chain: TxState = "success";
  const settings: ReserveSettings = { enabled: true, dry: false, wallet: RESERVE_WALLET };
  const d: ReserveDeps = {
    file, now: () => t, settings: () => settings, configure: (mode) => { settings.enabled = mode !== "off"; settings.dry = mode === "dry"; }, house: () => HOUSE,
    quote: vi.fn(async (amount) => route(amount)), funds: vi.fn(async () => ({ usdc: 1_000_000_000n, eth: RESERVE_GAS + 1_000_000_000_000_000n })), cost: vi.fn(async () => 10_000n),
    sign: vi.fn(async (): Promise<SignedTx> => ({ hash: TX as `0x${string}`, raw: "0x1234", nonce: 1 })), broadcast: vi.fn(async () => {}), state: vi.fn(async () => chain),
    delivery: vi.fn(async () => ({ state: "done" as const, tx: OUT, shift: "99000000000000000000" })), alert: vi.fn(async () => {}), log: vi.fn(), bought: vi.fn(async () => {}),
  };
  const make = () => new AgentReserve(d), reserve = make();
  return { reserve, make, d, settings, add: (ms: number) => { t += ms; }, state: (value: TxState) => { chain = value; } };
};

describe("Agent Reserve", () => {
  it("credits only settled customer money at exactly 50%, including half-micro-USDC", () => {
    const x = setup();
    for (const cls of ["internal", "owner", "b2b", "test"] as const) expect(x.reserve.credit(pay(1, "50000000", cls))).toBe(false);
    expect(x.reserve.credit({ ...pay(), tx: null })).toBe(false);
    expect(x.reserve.credit(pay())).toBe(true); expect(x.reserve.credit(pay())).toBe(false);
    x.reserve.credit(pay(2, "1"));
    expect(x.reserve.proof()).toMatchObject({ balanceUsd: 25.0000005, totalInUsd: 25.0000005, totalBoughtShift: "0" });
    expect(x.reserve.heldUsdc()).toBe(25_000_001n);
  });
  it("triggers at $25, spends the whole available reserve with exact approval, then records the receipt", async () => {
    const x = setup(); x.reserve.credit(pay(1, "49999998")); await x.reserve.tick(); expect(x.d.quote).not.toHaveBeenCalled();
    x.reserve.credit(pay(2, "2")); await x.reserve.tick();
    expect(x.d.quote).toHaveBeenCalledWith(25_000_000n, RESERVE_WALLET);
    expect(x.d.sign).toHaveBeenCalledTimes(2); expect(x.d.broadcast).toHaveBeenCalledTimes(2);
    const approval = vi.mocked(x.d.sign).mock.calls[0]![0];
    expect(approval.to).toBe(RESERVE_USDC); expect(BigInt(`0x${approval.data.slice(-64)}`)).toBe(25_000_000n);
    expect(x.reserve.proof()).toMatchObject({ balanceUsd: 0, totalInUsd: 25, totalBoughtShift: "99" });
    expect(x.reserve.proof().buys[0]).toMatchObject({ baseTx: `https://basescan.org/tx/${TX}`, ethereumTx: `https://etherscan.io/tx/${OUT}` });
    expect(x.d.bought).toHaveBeenCalledTimes(1);
    const [buy, proof] = vi.mocked(x.d.bought).mock.calls[0]!;
    expect(reserveBuyMessage(buy, proof)).toContain("The $SHIFT goes to the NIGHTSHIFT team wallet");
  });
  it("is off by default configuration and dry mode signs or sends nothing", async () => {
    const x = setup(); x.reserve.credit(pay()); x.settings.enabled = false; await x.reserve.tick(); expect(x.d.quote).not.toHaveBeenCalled();
    x.reserve.command(["dry"]); await x.reserve.tick();
    expect(x.d.quote).toHaveBeenCalled(); expect(x.d.sign).not.toHaveBeenCalled(); expect(x.d.broadcast).not.toHaveBeenCalled();
    expect(x.d.log).toHaveBeenCalled(); expect(x.d.alert).toHaveBeenCalledWith(expect.stringContaining("DRY")); expect(x.reserve.proof().balanceUsd).toBe(25);
  });
  it.each(["slippage", "recipient", "token", "chain", "input", "fee", "minimum", "approval", "contract"])("refuses an unsafe %s before signing", async (kind) => {
    const x = setup(), q = route();
    if (kind === "slippage") q.slippage = 0.031;
    if (kind === "recipient") q.recipient = HOUSE;
    if (kind === "token") q.toToken.address = RESERVE_USDC;
    if (kind === "chain") q.toChain = "base";
    if (kind === "input") q.fromAmount = "25000001";
    if (kind === "fee") q.nightshift.bps = 1;
    if (kind === "minimum") q.toAmountMin = "96000000000000000000";
    if (kind === "approval") q.approval!.amount = (2n ** 256n - 1n).toString();
    if (kind === "contract") q.approval!.spender = HOUSE;
    expect(() => checkReserveRoute(q, 25_000_000n, HOUSE, RESERVE_WALLET)).toThrow();
    vi.mocked(x.d.quote).mockResolvedValue(q); x.reserve.credit(pay()); await x.reserve.tick();
    expect(x.d.sign).not.toHaveBeenCalled(); expect(x.reserve.proof().balanceUsd).toBe(25); expect(x.d.alert).toHaveBeenCalled();
  });
  it("keeps settlement gas and requires real USDC backing", async () => {
    const x = setup(); x.reserve.credit(pay());
    vi.mocked(x.d.funds).mockResolvedValue({ usdc: 25_000_000n, eth: RESERVE_GAS + 9_999n });
    await x.reserve.tick(); expect(x.d.sign).not.toHaveBeenCalled(); expect(x.d.alert).toHaveBeenCalledWith(expect.stringContaining("0.0005 ETH"));
    x.add(3_600_000); vi.mocked(x.d.funds).mockResolvedValue({ usdc: 24_999_999n, eth: 10n ** 18n });
    await x.reserve.tick(); expect(x.d.sign).not.toHaveBeenCalled(); expect(x.reserve.proof().balanceUsd).toBe(25);
  });
  it("does not broadcast a saved signature that fails the final gas check", async () => {
    const x = setup(); x.reserve.credit(pay()); x.d.checkSigned = vi.fn(async () => { throw new Error("Base ETH floor"); });
    await x.reserve.tick(); expect(x.d.sign).toHaveBeenCalledTimes(1); expect(x.d.broadcast).not.toHaveBeenCalled(); expect(x.reserve.proof().balanceUsd).toBe(25);
  });
  it("does not debit failures, waits an hour, and stops after three failed attempts that day", async () => {
    const x = setup(); x.reserve.credit(pay()); vi.mocked(x.d.quote).mockRejectedValue(new Error("No route"));
    await x.reserve.tick(); await x.reserve.tick(); expect(x.d.quote).toHaveBeenCalledTimes(1);
    x.add(3_599_999); await x.reserve.tick(); expect(x.d.quote).toHaveBeenCalledTimes(1);
    x.add(1); await x.reserve.tick(); expect(x.d.quote).toHaveBeenCalledTimes(2);
    x.add(3_600_000); await x.reserve.tick(); expect(x.d.quote).toHaveBeenCalledTimes(3);
    x.add(3_600_000); await x.reserve.tick(); expect(x.d.quote).toHaveBeenCalledTimes(3); expect(x.reserve.proof().balanceUsd).toBe(25);
    x.add(86_400_000); await x.reserve.tick(); expect(x.d.quote).toHaveBeenCalledTimes(4);
  });
  it("checks a lost broadcast answer on chain after restart, and never resends it", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "reserve-lost-")), "agent-reserve.json"), x = setup(file);
    x.reserve.credit(pay()); x.state("pending");
    vi.mocked(x.d.broadcast).mockRejectedValueOnce(new Error("answer lost"));
    await x.reserve.tick(); expect(x.d.broadcast).toHaveBeenCalledTimes(1); expect(x.reserve.proof().balanceUsd).toBe(25);
    expect(readFileSync(file, "utf8")).toContain('"submitted":true');
    const b = x.make(); expect(b.credit(pay())).toBe(false); await b.tick(); expect(x.d.broadcast).toHaveBeenCalledTimes(1);
    x.state("success"); await b.tick();
    expect(x.d.broadcast).toHaveBeenCalledTimes(2); expect(x.d.sign).toHaveBeenCalledTimes(2); expect(b.proof().balanceUsd).toBe(0);
    await b.tick(); expect(x.d.broadcast).toHaveBeenCalledTimes(2);
  });
  it("holds one in-flight buy, then observes the ten-minute cooldown", async () => {
    const x = setup(); x.reserve.credit(pay()); x.state("pending");
    await Promise.all([x.reserve.tick(), x.reserve.tick()]); expect(x.d.quote).toHaveBeenCalledTimes(1);
    x.reserve.credit(pay(2)); await x.reserve.tick(); expect(x.d.quote).toHaveBeenCalledTimes(1);
    x.state("success"); await x.reserve.tick(); expect(x.reserve.proof().balanceUsd).toBe(25);
    await x.reserve.tick(); expect(x.d.quote).toHaveBeenCalledTimes(1);
    x.add(600_000); await x.reserve.tick(); expect(x.d.quote).toHaveBeenCalledTimes(2); expect(x.reserve.proof().balanceUsd).toBe(0);
  });
  it("does not count successful buys against the failed retry limit", async () => {
    const x = setup();
    for (let i = 1; i <= 4; i++) { x.reserve.credit(pay(i)); await x.reserve.tick(); x.add(600_000); }
    expect(x.d.quote).toHaveBeenCalledTimes(4); expect(x.reserve.proof().balanceUsd).toBe(0);
  });
  it("does not resend a route whose broadcast answer was lost", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "reserve-route-lost-")), "reserve.json"), x = setup(file);
    x.reserve.credit(pay());
    vi.mocked(x.d.broadcast).mockResolvedValueOnce().mockRejectedValueOnce(new Error("route answer lost"));
    await x.reserve.tick(); expect(x.d.broadcast).toHaveBeenCalledTimes(2);
    const b = x.make(); x.state("pending"); await b.tick(); expect(x.d.broadcast).toHaveBeenCalledTimes(2);
    x.state("success"); await b.tick(); expect(x.d.broadcast).toHaveBeenCalledTimes(2); expect(b.proof().balanceUsd).toBe(0);
  });
  it("holds a sent bridge until destination proof or a confirmed refund", async () => {
    const x = setup(); x.reserve.credit(pay()); vi.mocked(x.d.delivery).mockResolvedValue({ state: "pending" });
    await x.reserve.tick(); x.add(3_600_000); await x.reserve.tick(); expect(x.d.quote).toHaveBeenCalledTimes(1); expect(x.reserve.proof().inFlightUsd).toBe(25);
    vi.mocked(x.d.delivery).mockResolvedValue({ state: "refunded" }); await x.reserve.tick(); expect(x.reserve.proof().balanceUsd).toBe(25);
    await x.reserve.tick(); expect(x.d.quote).toHaveBeenCalledTimes(1);
  });
  it("reloads owner controls, credits and completed buys", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "reserve-state-")), "agent-reserve.json"), x = setup(file);
    x.reserve.credit(pay()); await x.reserve.tick(); x.reserve.command(["off"]);
    const b = x.make(); expect(b.command([])).toContain("off</b>"); expect(b.proof().totalBoughtShift).toBe("99");
    expect(b.credit(pay())).toBe(false); b.credit(pay(2)); await b.tick(); expect(x.d.quote).toHaveBeenCalledTimes(1);
  });
});
