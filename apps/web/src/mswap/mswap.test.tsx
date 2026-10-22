import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IMD_RH, NATIVE_EVM, type QuoteRequest, SHIFT_TOKEN, fromLifi, fromRelay, nativeToken } from "@nightshift/swap";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isPoolPair } from "./MultiSwap";
import { RouteCard } from "./RouteCard";
import { recheck } from "./run";

/** LI.FI's and Relay's answers recorded on 2026-10-22 (packages/swap/fixtures). */
const fx = (n: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "packages", "swap", "fixtures", `${n}.json`), "utf8"));
const ME = "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69";
const req: QuoteRequest = { fromChain: "eth", toChain: "rh", fromToken: NATIVE_EVM, toToken: IMD_RH, amount: "100000000000000000", from: ME, to: ME, slippage: 0.01 };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the route card", () => {
  const q = fromLifi(fx("lifi-quote-eth-rh-imd"), req, { bps: 25, waived: false, note: "" });
  it("shows the hops, the minimum, both kinds of fees apart, gas, time and the contracts", () => {
    const t = text(renderToStaticMarkup(<RouteCard q={q} others={[]} pick={() => {}} preview={false} problems={[]} />));
    expect(t).toContain("ETH on Ethereum AcrossV4 WETH on Robinhood Chain SushiSwap Aggregator IMD on Robinhood Chain");
    expect(t).toContain("You get at least 41.87 IMD");
    expect(t).toContain("LI.FI fees LIFI Fixed Fee $0.62, Relayer fee $0.02, Relayer gas fee $0.38");
    expect(t).toContain("NIGHTSHIFT fee 0.25%, $0.62");
    expect(t).toContain("Network gas $0.11");
    expect(t).toContain("Time about 2 s");
    expect(t).toContain("LI.FI Diamond 0x1231…4EaE ↗ Called by the swap");
    expect(t).not.toContain("Refused");
  });
  it("says so when a holder pays no NIGHTSHIFT fee", () => {
    const w = fromLifi(fx("lifi-quote-eth-rh-imd"), req, { bps: 0, waived: true, note: "" });
    const html = renderToStaticMarkup(<RouteCard q={w} others={[]} pick={() => {}} preview={false} problems={[]} />);
    expect(text(html)).toContain("NIGHTSHIFT fee None: you are a holder");
    expect(html).toContain('class="good"');
  });
  it("lists the other provider's route and a preview note", () => {
    const r = fromRelay(fx("relay-quote-eth-rh-imd-fee"), { ...req, amount: "50000000000000000", slippage: 0.02 }, { bps: 25, waived: false, note: "" });
    const t = text(renderToStaticMarkup(<RouteCard q={q} others={[r]} pick={() => {}} preview problems={[]} />));
    expect(t).toContain("LI.FI, best of 2");
    expect(t).toContain("Relay 21.0959 IMD");
    expect(t).toMatch(/IMD less after gas/);
    expect(t).toContain("Priced for a sample address");
  });
  it("flags an unknown contract and shows why nothing will be signed", () => {
    const bad = { ...q, contracts: [{ chain: "eth" as const, address: "0x000000000000000000000000000000000000dEaD", role: "Called by the swap", label: null }] };
    const t = text(renderToStaticMarkup(<RouteCard q={bad} others={[]} pick={() => {}} preview={false} problems={["The route sends a transaction to an unknown contract: 0x…dEaD."]} />));
    expect(t).toContain("Unknown contract 0x0000…dEaD");
    expect(t).toContain("Refused, nothing will be signed: The route sends a transaction to an unknown contract");
  });
});

describe("the page's own checks", () => {
  it("refuses a tampered route even when the server reported no problem", () => {
    const q = fromLifi(fx("lifi-quote-eth-rh-imd"), req, { bps: 0, waived: false, note: "" });
    expect(recheck(q, req)).toEqual([]);
    const tampered = { ...q, problems: [], txs: [{ kind: "evm" as const, chainId: 1, to: "0x000000000000000000000000000000000000dEaD", data: "0x", value: "100000000000000000" }] };
    expect(recheck(tampered, req)).toContain("The route sends a transaction to an unknown contract: 0x000000000000000000000000000000000000dEaD.");
    const greedy = { ...q, problems: [], approval: { token: NATIVE_EVM, spender: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", amount: (10n ** 30n).toString() } };
    expect(recheck(greedy, req)).toContain("The route asks for a different allowance than this swap needs.");
  });
  it("sends ETH and $SHIFT on Ethereum to the pool swap", () => {
    const eth = { chain: "eth" as const, token: nativeToken("eth") };
    const shift = { chain: "eth" as const, token: { ...nativeToken("eth"), address: SHIFT_TOKEN, symbol: "SHIFT" } };
    expect(isPoolPair(eth, shift)).toBe(true);
    expect(isPoolPair(shift, eth)).toBe(true);
    expect(isPoolPair({ chain: "base", token: nativeToken("base") }, shift)).toBe(false);
  });
});
