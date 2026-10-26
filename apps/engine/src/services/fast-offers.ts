import type { Offer } from "./catalog.js";
import type { FastId } from "./fast-input.js";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TX = `0x${"1".repeat(64)}`;
const q = (description: string, required = true, values?: string[]) => ({ type: "string", description, required, ...(values ? { enum: values } : {}) });
const chain = q("Mainnet chain", true, ["ethereum", "base"]);
const unavailable = { type: "array", items: { type: "string" }, description: "Sources or checks that could not answer; never evidence of safety." };
const make = (id: FastId, name: string, price: bigint, crew: Offer["crew"], description: string, query: Offer["query"], example: string, properties: Record<string, unknown>, outputExample: Record<string, unknown>): Offer => ({
  id, name, kind: "tool", priceUsdc: price, crew, method: "GET", route: `/api/v1/${id}`, example: `/api/v1/${id}${example}`, page: "/services",
  description: `Use when an agent needs ${description}`, pitch: description[0]!.toUpperCase() + description.slice(1), query, path: {},
  output: { required: ["service", "unavailable", ...Object.keys(properties)], properties: { service: { type: "string" }, unavailable, ...properties } },
  outputExample: { service: id, unavailable: [], ...outputExample },
});
const obj = { type: ["object", "null"] }, str = { type: ["string", "null"] }, num = { type: ["number", "null"] };

export const FAST_OFFERS: Offer[] = [
  make("x402-seller-check", "x402 Seller Check", 5_000n, "watchtower", "to check an x402 seller before paying: Bazaar listings and payment terms, one guarded live v2 challenge, seven-day Base USDC inflow from bounded logs, and cited red flags. Returns no_issues_found, caution or avoid and every check that was unavailable.",
    { target: q("HTTPS endpoint URL, host or payTo address") }, "?target=getnightshift.tech",
    { verdict: { type: "string", enum: ["no_issues_found", "caution", "avoid"] }, reasons: { type: "array" }, summary: { type: "string" }, bazaar: obj, probe: obj, inflows: { type: "array" } },
    { verdict: "caution", reasons: [], summary: "Could not check: live challenge.", bazaar: { listedResources: 1 }, probe: null, inflows: [], unavailable: ["live challenge"] }),
  make("payment-verify", "Payment Verify", 2_000n, "watchtower", "to verify an ERC-20 payment on Ethereum or Base before delivering work: receipt status, confirmations and matching transfers to the expected recipient, token and minimum amount. USDC by default; reports unavailable reads without claiming payment arrived.",
    { chain, tx: q("Transaction hash"), recipient: q("Expected recipient address"), token: q("USDC (default) or ERC-20 address", false), minAmount: q("Minimum token amount, decimal string (default 0)", false) }, `?chain=base&tx=${TX}&recipient=${USDC}&minAmount=0.01`,
    { status: { type: "string" }, confirmations: num, from: str, to: str, token: str, amount: str, matchesExpected: { type: ["boolean", "null"] }, reasons: { type: "array" } },
    { status: "pending", confirmations: 0, from: null, to: null, token: USDC, amount: null, matchesExpected: false, reasons: ["No mined receipt yet."] }),
  make("token-price", "Token Price", 2_000n, "research", "a quick ERC-20 price on Ethereum or Base: USD price, liquidity, 24-hour volume and change, FDV, market cap, deepest pool and DEX, pair age, and on-chain symbol and decimals. DexScreener is cached for 30 seconds; missing values stay unavailable.",
    { chain, token: q("ERC-20 address") }, `?chain=base&token=${USDC}`,
    { token: str, priceUsd: num, liquidityUsd: num, volume24hUsd: num, change24hPct: num, fdv: num, marketCap: num, topPool: obj, pairAgeSeconds: num, symbol: str, decimals: num },
    { token: USDC, priceUsd: 1, liquidityUsd: 250000, volume24hUsd: 100000, change24hPct: 0, fdv: null, marketCap: null, topPool: { dex: "uniswap", address: USDC }, pairAgeSeconds: 86400, symbol: "USDC", decimals: 6 }),
  make("wallet-check", "Wallet Check", 3_000n, "watchtower", "to inspect an Ethereum or Base address: EOA, contract or EIP-7702 delegation, verified source name and proxy evidence, ETH and USDC balances, nonce, cheap first-seen evidence and known address labels. Unknown identity or missing source data is explicitly unavailable.",
    { chain, address: q("Wallet or contract address") }, `?chain=base&address=${USDC}`,
    { address: str, kind: str, source: obj, proxy: obj, ethBalance: str, usdcBalance: str, nonce: num, firstSeen: obj, labels: { type: "array" } },
    { address: USDC, kind: "contract", source: { verified: true, name: "FiatTokenProxy" }, proxy: { proxy: true }, ethBalance: "0", usdcBalance: "0", nonce: 1, firstSeen: null, labels: [] }),
  make("tx-explain", "Transaction Explain", 3_000n, "watchtower", "to understand an Ethereum or Base transaction: receipt, confirmations, block and time, sender, recipient, verified ABI method or raw selector, ERC-20 and ERC-721 transfers, ETH and USD gas paid and one plain-English line. Missing metadata and prices are marked unavailable.",
    { chain, tx: q("Transaction hash") }, `?chain=base&tx=${TX}`,
    { status: { type: "string" }, block: num, time: str, from: str, to: str, method: str, transfers: { type: "array" }, gasPaidEth: str, gasPaidUsd: num, summary: { type: "string" } },
    { status: "pending", block: null, time: null, from: null, to: null, method: null, transfers: [], gasPaidEth: null, gasPaidUsd: null, summary: "Transaction has no mined receipt yet." }),
  make("gas-now", "Gas Now", 2_000n, "research", "current Ethereum and Base gas costs: base fee, slow, normal and fast priority fees from fee history, and estimated USD execution costs for an ETH transfer, ERC-20 transfer and Uniswap swap. Cached 12 seconds. Gas units are explicit estimates; Base L1 data fees are separate and unavailable.",
    {}, "", { chains: { type: "array" } }, { chains: [{ chain: "base", baseFeeGwei: "0.01", priorityFeeGwei: { slow: "0.001", normal: "0.002", fast: "0.003" }, costs: null }] }),
  make("name-resolve", "Name Resolve", 2_000n, "research", "forward or reverse ENS resolution on Ethereum or Basenames on Base. Reads the chain registry and resolver, confirms reverse names by resolving them forward, and distinguishes unset records from unavailable reads. Cached 60 seconds; unsupported off-chain resolver reads are unavailable.",
    { chain, input: q("ENS name (.eth), Basename (.base.eth), or address for reverse lookup") }, "?chain=ethereum&input=vitalik.eth",
    { name: str, address: str, direction: { type: "string" }, forwardConfirmed: { type: ["boolean", "null"] } },
    { name: "vitalik.eth", address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045", direction: "forward", forwardConfirmed: true }),
];
