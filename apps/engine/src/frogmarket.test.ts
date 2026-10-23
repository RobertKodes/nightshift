import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { newFrogListings, newFrogSales } from "./frogmarket.js";

type Item = { itemType: number; token: string; identifier: bigint; amount: bigint; recipient?: string };
type Log = { args: { offerer: string; recipient: string; offer: Item[]; consideration: Item[] }; transactionHash: string; blockNumber?: bigint };
const chain = vi.hoisted(() => ({ head: 100n, logs: [] as Log[], delay: 0 }));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
vi.mock("./chain.js", () => ({ eth: {
  getBlockNumber: async () => chain.head,
  getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => { await wait(chain.delay); return chain.logs.filter((l) => (l.blockNumber ?? fromBlock) >= fromBlock && (l.blockNumber ?? toBlock) <= toBlock); },
} }));

const NFT = "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const BUYER = "0x00000000000000000000000000000000000000b1", SELLER = "0x00000000000000000000000000000000000000c2";
const ZERO = "0x0000000000000000000000000000000000000000";
const frog = (id: bigint, recipient?: string): Item => ({ itemType: 2, token: NFT, identifier: id, amount: 1n, recipient });
const weth = (wei: bigint, recipient?: string): Item => ({ itemType: 1, token: WETH, identifier: 0n, amount: wei, recipient });

describe("frog sales from Seaport", () => {
  beforeEach(async () => {
    config.dataDir = mkdtempSync(join(tmpdir(), "ns-frogmarket-"));
    chain.head = 100n; chain.logs = []; chain.delay = 0;
    await newFrogSales(); // the first call only marks where to start
    chain.head = 120n;
  });

  it("posts an accepted offer once, with the buyer and the seller the right way round", async () => {
    // OpenSea logs the buyer's offer and the seller's mirror order in the same transaction
    chain.logs = [
      { args: { offerer: BUYER, recipient: ZERO, offer: [weth(10n ** 16n)], consideration: [frog(42n, BUYER), weth(5n * 10n ** 14n, SELLER)] }, transactionHash: "0xt1" },
      { args: { offerer: SELLER, recipient: ZERO, offer: [frog(42n)], consideration: [weth(95n * 10n ** 14n, SELLER)] }, transactionHash: "0xt1" },
    ];
    const sales = await newFrogSales();
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ id: 42, buyer: BUYER, seller: SELLER, eth: 0.01 });
  });

  it("reads a plain listing fill and an offer taken directly", async () => {
    chain.logs = [
      { args: { offerer: SELLER, recipient: BUYER, offer: [frog(7n)], consideration: [{ itemType: 0, token: ZERO, identifier: 0n, amount: 2n * 10n ** 16n, recipient: SELLER }] }, transactionHash: "0xt2" },
      { args: { offerer: BUYER, recipient: SELLER, offer: [weth(3n * 10n ** 16n)], consideration: [frog(8n, BUYER)] }, transactionHash: "0xt3" },
    ];
    const sales = await newFrogSales();
    expect(sales.map((s) => [s.id, s.buyer, s.seller])).toEqual([[7, BUYER, SELLER], [8, BUYER, SELLER]]);
  });

  it("posts a sale and a listing once when both reads run at the same moment", async () => {
    config.openseaKey = "test";
    const listing = { event_timestamp: 1000, order_hash: "0xh1", maker: SELLER, asset: { identifier: "5" }, payment: { quantity: "10000000000000000", decimals: 18 } };
    // either read can finish first: the chain slow, then OpenSea slow
    for (const [chainMs, openseaMs] of [[0, 20], [20, 0]]) {
      config.dataDir = mkdtempSync(join(tmpdir(), "ns-frogmarket-"));
      chain.head = 100n; chain.logs = []; chain.delay = 0;
      await newFrogSales();
      vi.stubGlobal("fetch", async () => { await wait(openseaMs!); return new Response(JSON.stringify({ asset_events: [listing] })); });
      chain.head = 120n; chain.delay = chainMs!;
      chain.logs = [{ args: { offerer: SELLER, recipient: BUYER, offer: [frog(7n)], consideration: [{ itemType: 0, token: ZERO, identifier: 0n, amount: 2n * 10n ** 16n, recipient: SELLER }] }, transactionHash: "0xt4", blockNumber: 110n }];
      const [sales, listed] = await Promise.all([newFrogSales(), newFrogListings()]);
      expect([sales.length, listed.length]).toEqual([1, 1]);
      chain.head = 121n;
      const [again, relisted] = await Promise.all([newFrogSales(), newFrogListings()]);
      expect([again.length, relisted.length]).toEqual([0, 0]);
    }
    vi.unstubAllGlobals();
    config.openseaKey = "";
  });
});
