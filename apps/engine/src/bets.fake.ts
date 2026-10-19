import { type Address, type Hex, encodeAbiParameters, toEventSelector } from "viem";
import { type BetsReader, type CreateCall, EVENT_PARAMS, type RawLog, type SettleCall } from "./bets.js";
import { TOKENS } from "./escrow.js";

/** Test support: BetPool as the follower reads it, with markets, bets, logs and blocks set by the test. */
export function fakeBetChain(o: { pool: Address; signer: string; paused?: boolean }) {
  const E = 10n ** 18n;
  const s = {
    signer: o.signer, paused: o.paused ?? false, block: 30_000_000n,
    limits: { [TOKENS.IMD]: [E / 10n, 500n * E], [TOKENS.SHIFT]: [1_000n * E, 25_000_000n * E] } as Record<string, readonly [bigint, bigint]>,
    balances: new Map<string, bigint>(),
    bets: new Map<string, readonly [bigint, bigint, bigint, bigint, boolean]>(),
    claimable: new Map<string, bigint>(),
    logs: [] as RawLog[],
    settled: [] as SettleCall[],
    created: [] as CreateCall[],
  };
  const client: BetsReader = {
    getBlockNumber: async () => s.block,
    getLogs: async (a) => { if (a.address !== o.pool.toLowerCase()) throw new Error("wrong address"); return s.logs.filter((l) => l.blockNumber! >= a.fromBlock && l.blockNumber! <= a.toBlock); },
    readContract: async (a) => {
      const key = (a.args ?? []).map((x) => String(x).toLowerCase()).join(":");
      if (a.functionName === "balanceOf") return s.balances.get(String(a.args![0]).toLowerCase()) ?? 0n;
      if (a.address !== o.pool.toLowerCase()) throw new Error("wrong address");
      if (a.functionName === "signer") return s.signer;
      if (a.functionName === "paused") return s.paused;
      if (a.functionName === "limits") return s.limits[String(a.args![0]).toLowerCase()] ?? [0n, 0n];
      if (a.functionName === "betsOf") return s.bets.get(key) ?? [0n, 0n, 0n, 0n, false];
      if (a.functionName === "claimable") return s.claimable.get(key) ?? 0n;
      throw new Error(`unexpected read ${a.functionName}`);
    },
  };
  let n = 0;
  /** One event as the contract would log it, with its first `indexed` parameters as topics. */
  const log = (name: string, args: unknown[], indexed: number): void => {
    const params = EVENT_PARAMS[name]!.map((p) => ({ type: p.split(" ")[0]!, name: p.split(" ")[1]! }));
    const selector = toEventSelector(`${name}(${params.map((p) => p.type).join(",")})`);
    const topics = [selector, ...params.slice(0, indexed).map((p, i) => encodeAbiParameters([p], [args[i]]))] as Hex[];
    const data = encodeAbiParameters(params.slice(indexed), args.slice(indexed));
    s.block += 2n;
    s.logs.push({ topics, data, blockNumber: s.block, transactionHash: `0x${(++n).toString(16).padStart(64, "0")}` as Hex, logIndex: 0 });
    s.block += 2n;
  };
  const created = (c: { marketId: Hex; token: Address; closesAt: number | bigint; game: Hex }, indexed = 2) => log("MarketCreated", [c.marketId, c.token, BigInt(c.closesAt), c.game], indexed);
  const bet = (marketId: Hex, bettor: Address, side: number, amount: bigint, weightBps: number, indexed = 2) => log("BetPlaced", [marketId, bettor, side, amount, weightBps, (amount * BigInt(weightBps)) / 10_000n], indexed);
  const settledLog = (marketId: Hex, outcome: number, fee: bigint, indexed = 1) => log("Settled", [marketId, outcome, fee], indexed);
  const relaySettle = async (r: SettleCall): Promise<Hex> => { s.settled.push(r); return `0x${"cd".repeat(32)}`; };
  const relayCreate = async (r: CreateCall): Promise<Hex> => { s.created.push(r); return `0x${"ef".repeat(32)}`; };
  return { s, client, log, created, bet, settled: settledLog, relaySettle, relayCreate };
}
