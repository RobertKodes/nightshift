import type { Address, Hex } from "viem";
import { TtlCache } from "./cache.js";
import { lc } from "./evm.js";
import { type ImdReader, imdReader } from "./imd.js";
import { type MarketReader, marketReader } from "./market.js";
import type { Deps } from "./net.js";
import { type Source, verifiedSource } from "./source.js";

/** The readers every house service shares, with their caches. One per server (and one per test). */
export type Ctx = {
  d: Deps; imd: ImdReader; market: MarketReader;
  source(chainId: number, a: Address): Promise<Source>;
  code(a: Address): Promise<Hex>;
  head(): Promise<bigint>;
};

export function context(d: Deps): Ctx {
  const sources = new TtlCache<Source>(60 * 60_000, 500, d.now);
  const codes = new TtlCache<Hex>(60 * 60_000, 3_000, d.now);
  const heads = new TtlCache<bigint>(12_000, 2, d.now);
  return {
    d, imd: imdReader(d), market: marketReader(d),
    source: async (chainId, a) => (await sources.get(`${chainId}:${lc(a)}`, () => verifiedSource(d, chainId, lc(a)))).v,
    code: async (a) => (await codes.get(lc(a), () => d.rpc.code(lc(a)))).v,
    head: async () => (await heads.get("head", () => d.rpc.head())).v,
  };
}

/** What a report rests on: each claim points to one of these, so anyone can check it. */
export type Evidence = { id: string; what: string; source: string; url?: string; block?: number };
export class Proof {
  readonly list: Evidence[] = [];
  add(what: string, source: string, extra: { url?: string; block?: number } = {}): string {
    const id = `e${this.list.length + 1}`;
    this.list.push({ id, what, source, ...extra });
    return id;
  }
}

/** How sure a report is: the share of its checks that ran, and what could not be checked. */
export type Confidence = { level: "high" | "medium" | "low"; score: number; checked: string[]; unknowns: string[] };
export function confidence(checks: { name: string; weight: number; done: boolean; why?: string }[]): Confidence {
  const all = checks.reduce((a, c) => a + c.weight, 0);
  const done = checks.filter((c) => c.done).reduce((a, c) => a + c.weight, 0);
  const score = all ? Math.round((done / all) * 100) / 100 : 0;
  return {
    level: score >= 0.85 ? "high" : score >= 0.6 ? "medium" : "low", score,
    checked: checks.filter((c) => c.done).map((c) => c.name),
    unknowns: checks.filter((c) => !c.done).map((c) => (c.why ? `${c.name}: ${c.why}` : c.name)),
  };
}

export const RUN_BY = "NIGHTSHIFT";
export const DISCLAIMER = "Automated on-chain and public-data checks run by NIGHTSHIFT, not financial advice and not an audit. 'No issues found' means none of the checks that ran found a problem; checks that could not run are listed, and no check covers every risk. Check coverage is not a probability that a token is safe or profitable.";
export const pct = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
