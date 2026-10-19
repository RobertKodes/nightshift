import { createPublicClient, getAddress, http, parseAbi, formatEther } from "viem";
import { mainnet } from "viem/chains";
import { config } from "./config.js";

const house = "0x73b1e5825280df29ea7124e927f3ebd9710b5a99" as const;
const pass = "0xa6958cbc41325e97ecb3bb9d837fbd0938cb2b4f" as const;
const source = "0xe57e3f2ce296252b461911b34787371d6d806ab2" as const;
const factory = "0x62527f742de81a59e2bcd4d2633f796426553200" as const;
const zero = "0x0000000000000000000000000000000000000000" as const;
const abi = parseAbi([
  "function isEligibleBroker(address) view returns (bool)", "function balances(address,address) view returns (uint256)",
  "function remaining() view returns (uint256)", "function claimsOpen() view returns (bool)",
  "function auctionState() view returns (bool open,bool settled,uint256 reserve,uint64 endTime,address highBidder,uint256 highBid)",
  "function saleOpen() view returns (bool)", "function price() view returns (uint256)",
]);
type Reader = { readContract: (args: any) => Promise<any> };
const client = createPublicClient({ chain: mainnet, transport: http(config.ethRpc, { timeout: 8000, retryCount: 0 }) });
const cache = new Map<string, { until: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();

/** Fixed contracts only; reads cannot move money. Partial failures stay unknown, never zero. */
export async function readProofhouse(wallet?: string, reader: Reader = client) {
  const address = wallet ? getAddress(wallet) : undefined;
  const reads = [
    ["passesRemaining", pass, "remaining", []], ["claimsOpen", pass, "claimsOpen", []],
    ["auction", source, "auctionState", []], ["editionsOpen", factory, "saleOpen", []], ["editionPriceWei", factory, "price", []],
    ...(address ? [["eligibleBroker", house, "isEligibleBroker", [address]], ["earningsWei", house, "balances", [address, zero]]] : []),
  ] as const;
  const results = await Promise.allSettled(reads.map(([, contract, functionName, args]) => reader.readContract({ address: contract, abi, functionName, args })));
  const values: Record<string, unknown> = {};
  const unavailable: string[] = [];
  results.forEach((r, i) => { const key = reads[i]![0] as string; if (r.status === "fulfilled") values[key] = r.value; else { values[key] = null; unavailable.push(key); } });
  const auction = values.auction as [boolean, boolean, bigint, bigint, string, bigint] | null;
  return { projectId: "proofhouse", chainId: 1, readAt: Date.now(), status: unavailable.length ? "partial" : "live", unavailable,
    ...values, auction: auction ? { open: auction[0], settled: auction[1], reserveEth: formatEther(auction[2]), endTime: Number(auction[3]), highBidEth: formatEther(auction[5]) } : null,
    wallet: address ?? null, brokerLink: address ? `https://proofhouse.fun/drops/artifacts.html?broker=${address}` : null,
    earningsEth: typeof values.earningsWei === "bigint" ? formatEther(values.earningsWei) : null,
    editionPriceEth: typeof values.editionPriceWei === "bigint" ? formatEther(values.editionPriceWei) : null,
    officialApplication: "https://proofhouse.fun/agents#apply", source: "https://proofhouse.fun/drops.json",
    notice: "Read-only integration. A referral link earns only if the wallet is an eligible broker and a qualifying sale completes. No partnership implied." };
}
export async function proofhouse(wallet?: string) {
  const key = wallet ? getAddress(wallet).toLowerCase() : "public";
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const existing = pending.get(key); if (existing) return existing;
  if (pending.size >= 20) throw new Error("Proof House reads are busy; retry shortly");
  const run = readProofhouse(wallet).then((value) => { if (cache.size >= 200) cache.delete(cache.keys().next().value!); cache.set(key, { until: Date.now() + 30_000, value }); return value; }).finally(() => pending.delete(key));
  pending.set(key, run); return run;
}
