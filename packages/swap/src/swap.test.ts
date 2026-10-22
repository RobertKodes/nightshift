import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type QuoteRequest, IMD_RH, NATIVE_EVM, NATIVE_SOL, approvalCalls, bestFirst, checkRequest, decideFee, fromLifi, fromLifiStatus, fromRelay, fromRelayStatus,
  isSolanaAddress, isXrplAddress, knownContract, lifiQuoteQuery, providerFee, readApprove, readSvmTransaction, relayQuoteBody, routePath, routeRows,
} from "./index.js";

/** Answers recorded from LI.FI's and Relay's public endpoints on 2026-10-22 (docs/swap/RESEARCH.md). */
const fx = (n: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", `${n}.json`), "utf8"));
const ME = "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69", SOL_ME = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", XRP_ME = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ns = { bps: 0, waived: false, note: "" };
const req = (o: Partial<QuoteRequest>): QuoteRequest => ({ fromChain: "eth", toChain: "rh", fromToken: NATIVE_EVM, toToken: IMD_RH, amount: "100000000000000000", from: ME, to: ME, slippage: 0.01, ...o });

describe("the fee waiver", () => {
  it("waives the fee for a signed-in NIGHT FROGS holder, on any chain", () => {
    expect(decideFee({ baseBps: 25, session: ME, sessionHolds: true })).toMatchObject({ bps: 0, waived: true, reason: "holder", note: "No NIGHTSHIFT fee: you hold a NIGHT FROG, a Night Watcher or 5M+ $SHIFT." });
    // the holder signed in, quoting a Solana wallet: still waived (the session is who they are)
    expect(decideFee({ baseBps: 25, session: ME, sessionHolds: true, wallet: SOL_ME, walletHolds: false }).waived).toBe(true);
  });
  it("charges a holder's address when the session is someone else, and says how to waive it", () => {
    const d = decideFee({ baseBps: 25, session: null, sessionHolds: false, wallet: ME, walletHolds: true });
    expect(d).toMatchObject({ bps: 25, waived: false, reason: "sign-in", holds: true });
    expect(d.note).toContain("sign in");
    expect(decideFee({ baseBps: 25, session: "0x00000000000000000000000000000000000000aa", sessionHolds: false, wallet: ME, walletHolds: true }).bps).toBe(25);
  });
  it("charges everyone else the set fee, capped at 1%, and nothing when it is 0", () => {
    expect(decideFee({ baseBps: 25, session: ME, sessionHolds: false })).toMatchObject({ bps: 25, reason: "standard", note: "NIGHTSHIFT fee 0.25%. Holders of a NIGHT FROG, a Night Watcher or 5M+ $SHIFT pay none." });
    expect(decideFee({ baseBps: 5000, session: null, sessionHolds: false }).bps).toBe(100);
    expect(decideFee({ baseBps: Number.NaN, session: null, sessionHolds: false })).toMatchObject({ bps: 0, reason: "off" });
  });
  it("asks each provider for the fee only where NIGHTSHIFT can collect it", () => {
    const d = decideFee({ baseBps: 25, session: null, sessionHolds: false });
    expect(providerFee("lifi", d, { lifiIntegrator: "", feeWallet: ME })).toEqual({ bps: 0, off: expect.stringContaining("not registered") });
    expect(providerFee("lifi", d, { lifiIntegrator: "nightshift", feeWallet: "" })).toEqual({ bps: 25 });
    expect(providerFee("relay", d, { lifiIntegrator: "", feeWallet: ME })).toEqual({ bps: 25 });
    expect(providerFee("relay", d, { lifiIntegrator: "", feeWallet: "not-an-address" }).bps).toBe(0);
    expect(providerFee("relay", decideFee({ baseBps: 25, session: ME, sessionHolds: true }), { lifiIntegrator: "x", feeWallet: ME })).toEqual({ bps: 0 });
  });
});

describe("the quote requests", () => {
  it("asks LI.FI with the NIGHTSHIFT fee, and with fee=0 when it is waived", () => {
    const withFee = new URLSearchParams(lifiQuoteQuery(req({}), { integrator: "nightshift", feeBps: 25 }));
    expect(Object.fromEntries(withFee)).toEqual({ fromChain: "1", toChain: "4663", fromToken: NATIVE_EVM, toToken: IMD_RH, fromAmount: "100000000000000000", fromAddress: ME, toAddress: ME, slippage: "0.01", integrator: "nightshift", fee: "0.0025" });
    const waived = new URLSearchParams(lifiQuoteQuery(req({ fromChain: "sol", toChain: "base", fromToken: NATIVE_SOL, toToken: USDC_BASE, from: SOL_ME }), { integrator: "", feeBps: 0 }));
    expect(waived.get("fee")).toBe("0");
    expect(waived.get("fromChain")).toBe("1151111081099710");
    expect(waived.get("integrator")).toBe("nightshift");
  });
  it("asks Relay with an app fee to the fee wallet, and without one when waived", () => {
    const r = req({ fromChain: "base", toChain: "xrpl", fromToken: NATIVE_EVM, toToken: "xrp", to: XRP_ME, slippage: 0.005 });
    expect(relayQuoteBody(r, { feeBps: 25, feeWallet: ME })).toEqual({ user: ME, recipient: XRP_ME, originChainId: 8453, destinationChainId: 537724, originCurrency: NATIVE_EVM, destinationCurrency: "xrp", amount: r.amount, tradeType: "EXACT_INPUT", slippageTolerance: "50", appFees: [{ recipient: ME, fee: "25" }] });
    expect(relayQuoteBody(r, { feeBps: 0, feeWallet: ME })).not.toHaveProperty("appFees");
  });
  it("checks the request before anything is asked", () => {
    expect(checkRequest({ fromChain: "xrpl", toChain: "eth" })).toEqual({ error: expect.stringContaining("coming soon") });
    expect(checkRequest({ ...req({}), amount: "0" })).toEqual({ error: "Type an amount above zero." });
    expect(checkRequest({ ...req({ toChain: "xrpl" }), toToken: "xrp", to: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTX" })).toEqual({ error: "That is not a valid XRP Ledger address to receive at." });
    expect(checkRequest({ ...req({ toChain: "xrpl", toToken: "xrp", to: XRP_ME }) })).toHaveProperty("req");
    expect(checkRequest({ ...req({}), slippage: 0.5 })).toEqual({ error: "Slippage must be between 0.1% and 20%." });
    expect(isXrplAddress(XRP_ME)).toBe(true);
    expect(isXrplAddress("rJBdWA9p5KwBoqSQTyMdg3UHLsJVzGVu5m")).toBe(true);
    expect(isSolanaAddress(SOL_ME)).toBe(true);
    expect(isSolanaAddress("0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69")).toBe(false);
  });
});

describe("LI.FI routes", () => {
  it("reads Ethereum ETH to IMD on Robinhood Chain: route, fees apart, ETA, the Diamond only", () => {
    const q = fromLifi(fx("lifi-quote-eth-rh-imd"), req({}), { bps: 25, waived: false, note: "x" });
    expect(q.problems).toEqual([]);
    expect(q).toMatchObject({ provider: "lifi", fromChain: "eth", toChain: "rh", toAmount: "42292934833849171968", etaSeconds: 2, approval: null });
    expect(q.fees.map((f) => f.name)).toEqual(["LIFI Fixed Fee", "Relayer fee", "Relayer gas fee"]);
    expect(q.nightshift).toMatchObject({ bps: 25, amount: "250000000000000" });
    expect(q.nightshift.usd).toBeCloseTo(0.618, 2);
    expect(q.txs).toEqual([expect.objectContaining({ kind: "evm", chainId: 1, to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", value: "100000000000000000" })]);
    expect(q.contracts).toEqual([{ chain: "eth", address: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", role: "Called by the swap", label: "LI.FI Diamond" }]);
    expect(routePath(q)).toEqual(["ETH on Ethereum", "AcrossV4", "WETH on Robinhood Chain", "SushiSwap Aggregator", "IMD on Robinhood Chain"]);
  });
  it("renders the route lines a person checks", () => {
    const rows = Object.fromEntries(routeRows(fromLifi(fx("lifi-quote-eth-rh-imd"), req({}), { bps: 25, waived: false, note: "" })).map((r) => [r.k, r.v]));
    expect(rows).toEqual({
      Route: "LI.FI: AcrossV4, SushiSwap Aggregator",
      "You get at least": "41.87 IMD",
      Rate: "1 ETH = 422.9293 IMD",
      "LI.FI fees": "LIFI Fixed Fee $0.62, Relayer fee $0.02, Relayer gas fee $0.38",
      "NIGHTSHIFT fee": "0.25%, $0.62",
      "Network gas": "$0.11",
      Time: "about 2 s",
      Slippage: "1%",
    });
    const waived = routeRows(fromLifi(fx("lifi-quote-eth-rh-imd"), req({}), { bps: 0, waived: true, note: "" })).find((r) => r.k === "NIGHTSHIFT fee");
    expect(waived?.v).toBe("None: you are a holder");
  });
  it("asks for exactly the input amount on an ERC-20, and only to the Diamond", () => {
    const r = req({ fromChain: "base", toChain: "rh", fromToken: USDC_BASE, toToken: NATIVE_EVM, amount: "25000000" });
    const q = fromLifi(fx("lifi-quote-base-usdc-rh"), r, ns);
    expect(q.problems).toEqual([]);
    expect(q.approval).toEqual({ token: USDC_BASE, spender: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", amount: "25000000" });
    expect(approvalCalls(q.approval, "base", 0n)).toEqual([{ token: USDC_BASE, spender: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", amount: 25_000_000n }]);
    expect(approvalCalls(q.approval, "base", 24_999_999n)).toEqual([{ token: USDC_BASE, spender: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", amount: 25_000_000n }]);
    expect(approvalCalls(q.approval, "base", 25_000_000n)).toEqual([]);
    expect(approvalCalls(q.approval, "base", 10n ** 30n)).toEqual([]);
  });
  it("reads a Solana transaction: the wallet pays and signs, every program is known", () => {
    const r = req({ fromChain: "sol", toChain: "base", fromToken: NATIVE_SOL, toToken: USDC_BASE, amount: "200000000", from: SOL_ME });
    const j = fx("lifi-quote-sol-base");
    const s = readSvmTransaction(j.transactionRequest.data);
    expect(s).toMatchObject({ version: 0, payer: SOL_ME, signers: [SOL_ME] });
    expect(s.programs).toContain("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    const q = fromLifi(j, r, ns);
    expect(q.problems).toEqual([]);
    expect(q.contracts.every((c) => c.label)).toBe(true);
    // the same transaction for someone else's wallet is refused
    expect(fromLifi(j, { ...r, from: "DNLbQ4t95LLPevvLdcFzN8RHNN83ntQJLt26E8VTnE7p" }, ns).problems).toContain("The Solana transaction is signed or paid by another wallet than yours.");
  });
  it("refuses a route through a contract it does not know, or paying someone else", () => {
    const j = fx("lifi-quote-eth-rh-imd");
    j.transactionRequest.to = "0x000000000000000000000000000000000000dead";
    expect(fromLifi(j, req({}), ns).problems).toContain("The route sends a transaction to an unknown contract: 0x000000000000000000000000000000000000dead.");
    const k = fx("lifi-quote-eth-rh-imd");
    k.action.toAddress = "0x00000000000000000000000000000000000000aa";
    expect(fromLifi(k, req({}), ns).problems).toContain("The route pays out to another address than yours.");
    const m = fx("lifi-quote-eth-rh-imd");
    m.estimate.toAmountMin = "1";
    expect(fromLifi(m, req({}), ns).problems).toContain("The route's minimum does not match your slippage.");
    const v = fx("lifi-quote-eth-rh-imd");
    v.transactionRequest.value = "0x1bc16d674ec80000"; // 2 ETH for a 0.1 ETH swap
    expect(fromLifi(v, req({}), ns).problems).toContain("A transaction sends more native coin than this swap needs.");
  });
  it("throws LI.FI's refusal as it is (unregistered integrator)", () => {
    expect(() => fromLifi(fx("lifi-error-1011"), req({}), ns)).toThrow(/not configured for collecting fees/);
  });
});

describe("Relay routes", () => {
  // recorded with Relay's default slippage (2%); asked at 1% the same answers are refused, see the last test
  const rreq = (o: Partial<QuoteRequest>) => req({ slippage: 0.02, ...o });
  it("reads Base ETH to XRP: one deposit to the Relay depository, XRP to the typed address", () => {
    const r = rreq({ fromChain: "base", toChain: "xrpl", toToken: "xrp", amount: "20000000000000000", to: XRP_ME });
    const q = fromRelay(fx("relay-quote-base-xrp"), r, ns);
    expect(q.problems).toEqual([]);
    expect(q).toMatchObject({ provider: "relay", toChain: "xrpl", toAmount: "36100253", etaSeconds: 2, approval: null, track: { provider: "relay", requestId: "0x1792626413f428dfdf3f68c9798c443d3ea0e7cff3ddbc0172d78dd6686517d8" } });
    expect(q.contracts).toEqual([{ chain: "base", address: "0x4cd00e387622c35bddb9b4c962c136462338bc31", role: "Called by the swap", label: "Relay depository" }]);
    expect(routePath(q)).toEqual(["ETH on Base", "Relay", "XRP on XRP Ledger"]);
  });
  it("shows the app fee as NIGHTSHIFT's, apart from Relay's own", () => {
    const q = fromRelay(fx("relay-quote-eth-rh-imd-fee"), rreq({ amount: "50000000000000000" }), { bps: 25, waived: false, note: "" });
    expect(q.problems).toEqual([]);
    expect(q.nightshift.usd).toBeCloseTo(0.309, 3);
    expect(q.fees.map((f) => f.name)).toEqual(["Relay solver fee", "Destination gas"]);
    expect(routePath(q)).toEqual(["ETH on Ethereum", "Relay", "ETH on Robinhood Chain", "nordstern", "IMD on Robinhood Chain"]);
  });
  it("rebuilds Relay's approval as exactly the input, for the depository", () => {
    const r = rreq({ fromChain: "base", toChain: "xrpl", fromToken: USDC_BASE, toToken: "xrp", amount: "25000000", to: XRP_ME });
    const j = fx("relay-quote-base-usdc-xrp");
    expect(readApprove(j.steps[0].items[0].data.data)).toEqual({ spender: "0x4cd00e387622c35bddb9b4c962c136462338bc31", amount: 25_000_000n });
    const q = fromRelay(j, r, ns);
    expect(q.problems).toEqual([]);
    expect(q.approval).toEqual({ token: USDC_BASE, spender: "0x4cd00e387622c35bddb9b4c962c136462338bc31", amount: "25000000" });
    expect(q.txs).toHaveLength(1);
    // an unlimited approval from the provider still becomes an exact one
    j.steps[0].items[0].data.data = `0x095ea7b3${"0".repeat(24)}4cd00e387622c35bddb9b4c962c136462338bc31${"f".repeat(64)}`;
    const big = fromRelay(j, r, ns);
    expect(approvalCalls(big.approval, "base", 0n)).toEqual([{ token: USDC_BASE, spender: "0x4cd00e387622c35bddb9b4c962c136462338bc31", amount: 25_000_000n }]);
  });
  it("sets Tether's allowance to zero first, then to exactly the amount", () => {
    const usdt = { token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", spender: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", amount: "5000000" };
    expect(approvalCalls(usdt, "eth", 1n)).toEqual([{ ...usdt, amount: 0n }, { ...usdt, amount: 5_000_000n }]);
    expect(approvalCalls(usdt, "eth", 0n)).toEqual([{ ...usdt, amount: 5_000_000n }]);
  });
  it("reads Solana instructions for the Relay program, signed only by the wallet", () => {
    const r = rreq({ fromChain: "sol", toChain: "xrpl", fromToken: NATIVE_SOL, toToken: "xrp", amount: "200000000", from: SOL_ME, to: XRP_ME });
    const q = fromRelay(fx("relay-quote-sol-xrp"), r, ns);
    expect(q.problems).toEqual([]);
    expect(q.txs[0]).toMatchObject({ kind: "svm-ix", lookupTables: ["Hm9fUgcn7qwDaiNTFiGh6pNtVATgnaRcmK6Bbx6EMZfP"] });
    expect(q.contracts.map((c) => c.label)).toEqual(["Relay depository"]);
  });
  it("refuses an XRPL deposit step: paying out of XRP is not signed here", () => {
    const q = fromRelay(fx("relay-quote-xrp-base"), req({ fromChain: "base", toChain: "base", fromToken: "xrp", amount: "50000000" }), ns);
    expect(q.problems.length).toBeGreaterThan(0);
  });
  it("refuses a minimum below what the slippage allows", () => {
    const r = req({ fromChain: "base", toChain: "xrpl", toToken: "xrp", amount: "20000000000000000", to: XRP_ME, slippage: 0.005 });
    expect(fromRelay(fx("relay-quote-base-xrp"), r, ns).problems).toEqual(["The route's minimum does not match your slippage."]);
  });
  it("puts the route that passed its checks and pays more first", () => {
    const a = fromLifi(fx("lifi-quote-eth-rh-imd"), req({}), ns);
    const b = { ...a, provider: "relay" as const, toAmount: (BigInt(a.toAmount) + 10n ** 18n).toString() };
    expect(bestFirst([a, b])[0]?.provider).toBe("relay");
    // the same amount out, but far more gas: the cheaper one first
    expect(bestFirst([{ ...a, provider: "relay" as const, gasUsd: 50 }, a])[0]?.provider).toBe("lifi");
    expect(bestFirst([{ ...b, problems: ["x"] }, a])[0]?.provider).toBe("lifi");
  });
});

describe("status", () => {
  it("reads LI.FI's answers", () => {
    expect(fromLifiStatus(fx("lifi-status-done"), "eth")).toMatchObject({ state: "done", outHash: "0x7920923937a07953aac8e9757b1f6277663b634f502953e86f3df826c3bdba4d" });
    expect(fromLifiStatus(fx("lifi-status-notfound"), "rh").state).toBe("pending");
  });
  it("reads Relay's answers", () => {
    expect(fromRelayStatus(fx("relay-status-success"), "rh")).toEqual({ state: "done", text: "Arrived.", outHash: "0x2043522cf15737c0b479762be837b34be68c6a51d40518c64445c3e029cd370d", outUrl: "https://robin.etherscan.io/tx/0x2043522cf15737c0b479762be837b34be68c6a51d40518c64445c3e029cd370d" });
    expect(fromRelayStatus(fx("relay-status-waiting"), "xrpl").state).toBe("pending");
    expect(fromRelayStatus({ status: "refund" }, "xrpl").state).toBe("refunded");
  });
});

describe("the pinned contract list", () => {
  it("knows LI.FI and Relay on each EVM chain, and nothing else", () => {
    expect(knownContract("rh", "0xB477751B76CF82d00a686A1232f5fCD772414Af3")).toBe("LI.FI Diamond");
    expect(knownContract("rh", "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE")).toBeNull();
    expect(knownContract("base", "0x4cd00e387622c35bddb9b4c962c136462338bc31")).toBe("Relay depository");
    expect(knownContract("eth", "0x0000000000000000000000000000000000000001")).toBeNull();
  });
});
