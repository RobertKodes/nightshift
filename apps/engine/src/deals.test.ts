import { type Address, verifyTypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { type DealsDeps, Deals, PASS_TTL, PASS_TYPES, type Quote, perToken, statusOf } from "./deals.js";

const DESK = "0x00000000000000000000000000000000000d3a15";
const TOKEN = "0x1111111111111111111111111111111111111111", OTHER = "0x2222222222222222222222222222222222222222";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", ETH = "0x0000000000000000000000000000000000000000";
const SELLER = "0x5e11e55e11e55e11e55e11e55e11e55e11e55e11", NOBODY = "0x0000000000000000000000000000000000000000";
const NOW = 1_800_000_000_000;

// deal 1: open, 1000 tokens left of 2000 at $0.05 a token in USDC; 2: open but expired, in ETH; 3: cancelled
const rows = [
  [SELLER, TOKEN, USDC, 2000n * 10n ** 18n, 1000n * 10n ** 18n, 50_000n, 10n ** 18n, BigInt(NOW / 1000 + 3600), NOBODY, true],
  [SELLER, OTHER, ETH, 10n ** 18n, 10n ** 18n, 10n ** 15n, 0n, BigInt(NOW / 1000 - 60), NOBODY, true],
  [SELLER, TOKEN, USDC, 10n ** 18n, 0n, 1n, 0n, BigInt(NOW / 1000 + 3600), NOBODY, false],
];
function desk(over: Partial<DealsDeps> = {}) {
  const signer = privateKeyToAccount(generatePrivateKey());
  const chain = {
    readContract: async ({ functionName }: { functionName: string }) => functionName === "dealCount" ? 3n : functionName === "feeBps" ? 100n : 50n,
    multicall: async ({ contracts }: { contracts: { functionName: string; args?: readonly bigint[]; address: string }[] }) => contracts.map((c) =>
      c.functionName === "deals" ? rows[Number(c.args![0]) - 1] : { status: "success", result: c.functionName === "decimals" ? 18 : c.address === TOKEN ? (c.functionName === "symbol" ? "TKN" : "Token") : (c.functionName === "symbol" ? "OTH" : "Other") }),
    getBlockNumber: async () => 100n,
    getLogs: async ({ event }: { event: { name: string } }) => event.name === "Bought"
      ? [{ args: { dealId: 1n, payer: OTHER, recipient: OTHER, amount: 10n ** 18n, cost: 50_000n, fee: 500n, holder: false }, transactionHash: "0xab", blockNumber: 90n }]
      : [{ args: { dealId: 3n, returned: 10n ** 18n } }],
  };
  const quotes = new Map<string, Quote>([[TOKEN, { priceUsd: 0.0625, liquidityUsd: 40_000, volume24hUsd: 900, image: null, chart: "https://dexscreener.com/x" }], ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", { priceUsd: 2400, liquidityUsd: null, volume24hUsd: null, image: null, chart: null }]]);
  const d: DealsDeps = {
    address: () => DESK, block: () => 1, chain: chain as never, now: () => NOW,
    market: async () => quotes, verdict: async () => ({ verdict: "caution", summary: "checked" }),
    holds: async (w) => w === OTHER, signer: () => signer, partners: () => [{ address: OTHER, symbol: "OTH" }], ...over,
  };
  return { deals: new Deals(d), signer };
}

describe("Token Deals", () => {
  it("prices a whole token from the contract's price and the two decimals", () => {
    expect(perToken(50_000n, 18, 6)).toBeCloseTo(0.05);
    expect(perToken(10n ** 15n, 18, 18)).toBeCloseTo(0.001);
    expect(perToken(5n * 10n ** 17n, 6, 18)).toBeCloseTo(5e-13);
  });

  it("reads the cards: status, dollars, the market, the seller's trades and the partner and copycat flags", async () => {
    const { deals } = desk();
    const [three, two, one] = await deals.list();
    expect(one).toMatchObject({ id: 1, status: "open", each: 0.05, usdEach: 0.05, marketUsd: 0.0625, vsMarketPct: -20, liquidityUsd: 40_000, sellerTrades: 1, partner: false, copycat: false });
    expect(one!.token).toMatchObject({ symbol: "TKN", decimals: 18 });
    expect(two).toMatchObject({ status: "expired", partner: true, usdEach: 2.4, coin: { symbol: "ETH" } });
    expect(three!.status).toBe("cancelled");
    expect(statusOf({ open: false, expiry: 0, left: 0n }, false, 1)).toBe("sold");
  });

  it("flags a token that copies a partner's ticker from another address", async () => {
    const { deals } = desk({ partners: () => [{ address: OTHER, symbol: "TKN" }] });
    expect((await deals.list()).find((d) => d.id === 1)).toMatchObject({ partner: false, copycat: true });
  });

  it("signs a 30-minute holder pass the contract can check, and only for holders", async () => {
    const { deals, signer } = desk();
    const pass = await deals.pass(OTHER);
    if (!pass.holder) throw new Error("expected a pass");
    expect(pass.expiry).toBe(NOW / 1000 + PASS_TTL);
    const ok = await verifyTypedData({ address: signer.address, domain: { name: "TokenDeals", version: "1", chainId: 1, verifyingContract: DESK as Address }, types: PASS_TYPES, primaryType: "HolderPass", message: { recipient: OTHER as Address, expiry: BigInt(pass.expiry) }, signature: pass.signature });
    expect(ok).toBe(true);
    expect(await deals.pass(SELLER)).toEqual({ holder: false });
    await expect(deals.pass("not-an-address")).rejects.toMatchObject({ status: 400 });
  });

  it("stays closed, with no cards and no passes, until the contract address is set", async () => {
    const { deals } = desk({ address: () => "" });
    expect(await deals.list()).toEqual([]);
    expect(await deals.config()).toMatchObject({ open: false, feeBps: 100, holderFeeBps: 50, maxFeeBps: 200 });
    await expect(deals.pass(OTHER)).rejects.toMatchObject({ status: 503 });
  });
});
