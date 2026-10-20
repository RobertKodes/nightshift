import type { Address, Hex } from "viem";
import { V4 } from "../v4.js";
import { DEAD, ZERO, balancesOf, lc } from "./evm.js";
import { IMD_FACTORIES } from "./imd.js";
import { MAX_LOG_RANGE, type Rpc } from "./net.js";

/**
 * Who holds a token, from its Transfer events (eth_getLogs, 9,000 blocks at a time). From the
 * deploy block the balances are exact; for an older token only the most recent window is read,
 * the balances of the addresses seen there are read on chain, and the answer says it is partial.
 * Etherscan's holder lists need a paid plan, so the services do not use them.
 */
const TRANSFER: Hex = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type Holder = { address: Address; pct: number; label: string | null; kind: "pool" | "burn" | "launch" | "contract" | "wallet" | "unknown" };
export type Holders = {
  complete: boolean; fromBlock: number; toBlock: number; transfers: number;
  /** Addresses holding more than zero (exact when complete; a lower bound when not). */
  count: number;
  top: Holder[];
  /** Shares of the supply: the ten largest, and the same leaving out pools, burns and IMD's launch contracts. */
  top10Pct: number; top10PctExInfra: number;
  largestWallet: Holder | null;
};

export async function holdersOf(rpc: Rpc, o: {
  token: Address; supply: bigint; deployBlock: number | null; head: bigint; maxChunks: number;
  /** Known addresses of this launch (its distributor, hook…), labelled as such. */
  labels: Record<string, string>;
}): Promise<Holders> {
  const span = BigInt(o.maxChunks) * MAX_LOG_RANGE;
  const start = o.deployBlock !== null && o.head - BigInt(o.deployBlock) < span ? BigInt(o.deployBlock) : o.head - span + 1n;
  const complete = o.deployBlock !== null && start === BigInt(o.deployBlock);
  const bal = new Map<string, bigint>();
  let transfers = 0;
  const ranges: [bigint, bigint][] = [];
  for (let from = start; from <= o.head; from += MAX_LOG_RANGE) ranges.push([from, from + MAX_LOG_RANGE - 1n > o.head ? o.head : from + MAX_LOG_RANGE - 1n]);
  // two ranges at a time: quick enough, and gentle on the free nodes
  for (let i = 0; i < ranges.length; i += 2) {
    const got = await Promise.all(ranges.slice(i, i + 2).map(([f, t]) => rpc.logs({ address: o.token, topics: [TRANSFER], fromBlock: f, toBlock: t })));
    for (const logs of got) for (const l of logs) {
      if (l.topics.length !== 3) continue; // ERC-721 Transfers carry a fourth topic
      const from = `0x${l.topics[1]!.slice(26)}`, to = `0x${l.topics[2]!.slice(26)}`;
      const v = l.data && l.data !== "0x" ? BigInt(l.data.slice(0, 66)) : 0n;
      transfers++;
      if (from !== ZERO) bal.set(from, (bal.get(from) ?? 0n) - v);
      bal.set(to, (bal.get(to) ?? 0n) + v);
    }
  }
  let rows = [...bal.entries()].filter(([a]) => a !== ZERO);
  if (!complete) {
    // only movements were seen: read the real balances of everyone who moved (largest movers first)
    const abs = (v: bigint) => (v < 0n ? -v : v);
    const who = [...rows].sort((a, b) => (abs(b[1]) > abs(a[1]) ? 1 : -1)).map(([a]) => a as Address).slice(0, 600);
    const real = await balancesOf(rpc, o.token, who);
    rows = who.map((a, i) => [a, real[i] ?? 0n] as [string, bigint]);
  }
  rows = rows.filter(([, v]) => v > 0n).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
  const supply = o.supply > 0n ? o.supply : rows.reduce((a, [, v]) => a + v, 0n);
  const pct = (v: bigint) => supply > 0n ? Number((v * 1_000_000n) / supply) / 10_000 : 0;
  const labelOf = (a: string): Pick<Holder, "label" | "kind"> => {
    const x = a.toLowerCase();
    if (x === V4.poolManager.toLowerCase()) return { label: "Uniswap v4 PoolManager (pool liquidity)", kind: "pool" };
    if (x === DEAD.toLowerCase()) return { label: "burned (0x…dEaD)", kind: "burn" };
    if (IMD_FACTORIES[x]) return { label: IMD_FACTORIES[x]!, kind: "launch" };
    if (o.labels[x]) return { label: o.labels[x]!, kind: /distributor|hook|factory|imd/i.test(o.labels[x]!) ? "launch" : "contract" };
    return { label: null, kind: "unknown" };
  };
  const top: Holder[] = rows.slice(0, 15).map(([a, v]) => ({ address: lc(a), pct: pct(v), ...labelOf(a) }));
  // wallets or contracts: one getCode each for the top ones not labelled already
  await Promise.all(top.filter((h) => h.kind === "unknown").map(async (h) => { const code = await rpc.code(h.address).catch(() => null); h.kind = code === null ? "unknown" : code === "0x" || code.startsWith("0xef0100") ? "wallet" : "contract"; }));
  const infra = (h: Holder) => h.kind === "pool" || h.kind === "burn" || h.kind === "launch";
  const top10 = top.slice(0, 10);
  const exInfra = top.filter((h) => !infra(h)).slice(0, 10);
  return {
    complete, fromBlock: Number(start), toBlock: Number(o.head), transfers, count: rows.length,
    top: top10, top10Pct: round(top10.reduce((a, h) => a + h.pct, 0)), top10PctExInfra: round(exInfra.reduce((a, h) => a + h.pct, 0)),
    largestWallet: top.find((h) => !infra(h)) ?? null,
  };
}
const round = (n: number) => Math.round(n * 100) / 100;
