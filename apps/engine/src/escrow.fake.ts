import type { Address, Hex } from "viem";
import { ESCROW, type EscrowLog, type OnChainMatch, type Reader, type RelayCall, TOKENS } from "./escrow.js";

/** Test support: GameEscrow as the follower reads it, with matches, logs and blocks set by the test. */
export function fakeChain(o: { signer: string; paused?: boolean }) {
  const s = {
    signer: o.signer, paused: o.paused ?? false, block: 26_222_900n,
    limits: { [TOKENS.IMD]: [5n * 10n ** 17n, 1_000n * 10n ** 18n], [TOKENS.SHIFT]: [10_000n * 10n ** 18n, 50_000_000n * 10n ** 18n] } as Record<string, readonly [bigint, bigint]>,
    matches: new Map<string, OnChainMatch>(),
    logs: [] as EscrowLog[],
    relayed: [] as RelayCall[],
  };
  const zero = "0x0000000000000000000000000000000000000000" as Address;
  const client: Reader = {
    getBlockNumber: async () => s.block,
    getLogs: async (a) => { if (a.address !== ESCROW) throw new Error("wrong address"); return s.logs.filter((l) => l.blockNumber! >= a.fromBlock && l.blockNumber! <= a.toBlock); },
    readContract: async (a) => {
      if (a.address !== ESCROW) throw new Error("wrong address");
      if (a.functionName === "signer") return s.signer;
      if (a.functionName === "paused") return s.paused;
      if (a.functionName === "limits") return s.limits[String(a.args![0]).toLowerCase()] ?? [0n, 0n];
      if (a.functionName === "matches") return s.matches.get(String(a.args![0]).toLowerCase()) ?? [zero, 0n, `0x${"0".repeat(64)}`, zero, zero, 0n, 0n, false];
      throw new Error(`unexpected read ${a.functionName}`);
    },
  };
  let n = 0;
  const log = (eventName: string, args: Record<string, unknown>): void => {
    s.block += 3n;
    s.logs.push({ eventName, args, blockNumber: s.block, transactionHash: `0x${(++n).toString(16).padStart(64, "0")}` as Hex, logIndex: 0 });
    s.block += 3n;
  };
  /** What open() does on chain: the match stored, and its event. */
  const open = (matchId: Hex, token: Address, stake: bigint, game: Hex, playerA: Address, at: number) => {
    s.matches.set(matchId.toLowerCase(), [token, stake, game, playerA, zero, BigInt(at), 0n, false]);
    log("Opened", { matchId, token, stake, game, playerA });
  };
  const join = (matchId: Hex, playerB: Address, at: number) => {
    const m = s.matches.get(matchId.toLowerCase())!;
    s.matches.set(matchId.toLowerCase(), [m[0], m[1], m[2], m[3], playerB, m[5], BigInt(at), false]);
    log("Joined", { matchId, playerB });
  };
  const relay = async (r: RelayCall): Promise<Hex> => { s.relayed.push(r); return `0x${"ab".repeat(32)}`; };
  return { s, client, log, open, join, relay };
}
