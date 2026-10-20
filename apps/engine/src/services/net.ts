import { type Address, type Hex, encodeFunctionData, decodeFunctionResult, parseAbi, toHex } from "viem";

/**
 * Everything the house services read from outside goes through these two doors: HTTP JSON (IMD,
 * DexScreener, Sourcify, Etherscan, the watchtower) and Ethereum JSON-RPC. The live doors use
 * chain.ts (several free nodes with fallback); tests replay doors recorded from mainnet, so the
 * verdict logic runs on real data with no network.
 */
export interface Net {
  /** GET a JSON document. Throws HttpError on a non-2xx answer. */
  json<T>(url: string, timeoutMs?: number): Promise<T>;
}
export class HttpError extends Error {
  constructor(readonly status: number, url: string) { super(`${new URL(url).host} answered ${status}`); }
}

export type StateOverride = { address: Address; balance?: bigint; stateDiff?: { slot: Hex; value: Hex }[] }[];
export type CallResult = { ok: true; data: Hex } | { ok: false; error: string; data?: Hex };
export type RawLog = { topics: Hex[]; data: Hex; blockNumber: number; tx: Hex };

export interface Rpc {
  head(): Promise<bigint>;
  code(address: Address): Promise<Hex>;
  storage(address: Address, slot: Hex): Promise<Hex>;
  call(tx: { to: Address; data: Hex; from?: Address; value?: bigint; override?: StateOverride }): Promise<CallResult>;
  /** eth_getLogs over at most 9,000 blocks (the free nodes refuse more). */
  logs(q: { address: Address; topics: (Hex | null)[]; fromBlock: bigint; toBlock: bigint }): Promise<RawLog[]>;
}

export type Deps = {
  net: Net; rpc: Rpc; now: () => number;
  /** Etherscan v2 key: empty means Sourcify only. */
  etherscanKey: string;
  /** The IMD Watchtower's /status. */
  watchtowerUrl: string;
};

export const MAX_LOG_RANGE = 9_000n;

/** The live HTTP door: a timeout on every read, JSON only. */
export const liveNet: Net = {
  async json<T>(url: string, timeoutMs = 12_000): Promise<T> {
    const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "NIGHTSHIFT-services/1 (+https://getnightshift.tech)" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new HttpError(r.status, url);
    return (await r.json()) as T;
  },
};

type ViemLike = {
  getBlockNumber(): Promise<bigint>;
  getCode(a: { address: Address }): Promise<Hex | undefined>;
  getStorageAt(a: { address: Address; slot: Hex }): Promise<Hex | undefined>;
  call(a: { to: Address; data: Hex; account?: Address; value?: bigint; stateOverride?: StateOverride }): Promise<{ data?: Hex }>;
  request(a: { method: string; params: unknown[] }): Promise<unknown>;
};

/** Revert data out of a viem error, when the node sent any. */
function revertData(e: unknown): Hex | undefined {
  let x = e as { data?: unknown; cause?: unknown } | undefined;
  for (let i = 0; i < 8 && x; i++) {
    if (typeof x.data === "string" && x.data.startsWith("0x")) return x.data as Hex;
    if (x.data && typeof (x.data as { data?: unknown }).data === "string") return (x.data as { data: Hex }).data;
    x = x.cause as typeof x;
  }
  return undefined;
}

/** The live RPC door, on chain.ts's Ethereum client (MEV Blocker, dRPC, publicnode with fallback). */
export function liveRpc(client: ViemLike): Rpc {
  return {
    head: () => client.getBlockNumber(),
    code: async (address) => (await client.getCode({ address })) ?? "0x",
    storage: async (address, slot) => (await client.getStorageAt({ address, slot })) ?? "0x",
    async call(tx) {
      try {
        const r = await client.call({ to: tx.to, data: tx.data, account: tx.from, value: tx.value, stateOverride: tx.override });
        return { ok: true, data: r.data ?? "0x" };
      } catch (e) {
        const msg = String((e as Error).message ?? e).split("\n")[0]!.slice(0, 200);
        return { ok: false, error: msg, data: revertData(e) };
      }
    },
    async logs(q) {
      if (q.toBlock - q.fromBlock + 1n > MAX_LOG_RANGE) throw new Error("log range over 9,000 blocks");
      const get = async (from: bigint, to: bigint, depth: number): Promise<RawLog[]> => {
        try {
          const rows = (await client.request({ method: "eth_getLogs", params: [{ address: q.address, topics: q.topics, fromBlock: toHex(from), toBlock: toHex(to) }] })) as { topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hex }[];
          return rows.map((l) => ({ topics: l.topics, data: l.data, blockNumber: Number(BigInt(l.blockNumber)), tx: l.transactionHash }));
        } catch (e) {
          // a node that refuses the range ("invalid params", too many results) is not handed over by the fallback: ask again in halves
          if (depth >= 3 || to <= from) throw e;
          const mid = from + (to - from) / 2n;
          return [...(await get(from, mid, depth + 1)), ...(await get(mid + 1n, to, depth + 1))];
        }
      };
      return get(q.fromBlock, q.toBlock, 0);
    },
  };
}

// ---------------------------------------------------------------- recorded doors (fixtures)

/** A recording: every outside read and its answer (or its error), keyed by what was asked. */
export type Tape = { recordedAt: string; head?: string; net: Record<string, { ok: true; v: unknown } | { ok: false; status?: number; error: string }>; rpc: Record<string, unknown> };

const key = (method: string, args: unknown) => `${method} ${JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? `${v}n` : v))}`;
const enc = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x)));
const dec = (v: unknown) => JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === "string" && /^-?\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x));

/** Wraps live doors and writes down every answer, so a test can replay the same run. */
export function recorder(net: Net, rpc: Rpc, trim: (url: string, v: unknown) => unknown = (_u, v) => v) {
  const tape: Tape = { recordedAt: new Date().toISOString(), net: {}, rpc: {} };
  const rec = async <T,>(m: string, args: unknown, run: () => Promise<T>): Promise<T> => { const v = await run(); tape.rpc[key(m, args)] = enc(v); return v; };
  return {
    tape,
    net: {
      async json<T>(url: string, timeoutMs?: number): Promise<T> {
        // the trimmed answer is what the recorded run itself sees, so a replay asks exactly the same questions
        try { const v = trim(url, await net.json<T>(url, timeoutMs)) as T; tape.net[url] = { ok: true, v: enc(v) }; return v; } catch (e) {
          tape.net[url] = { ok: false, status: e instanceof HttpError ? e.status : undefined, error: (e as Error).message };
          throw e;
        }
      },
    } satisfies Net,
    rpc: {
      head: () => rec("head", [], () => rpc.head()),
      code: (a) => rec("code", [a.toLowerCase()], () => rpc.code(a)),
      storage: (a, s) => rec("storage", [a.toLowerCase(), s], () => rpc.storage(a, s)),
      call: (tx) => rec("call", [{ ...tx, to: tx.to.toLowerCase() }], () => rpc.call(tx)),
      logs: (q) => rec("logs", [q], () => rpc.logs(q)),
    } satisfies Rpc,
  };
}

/** Plays a tape back. Anything not on it fails loudly, so a test never reaches the network. */
export function replay(tape: Tape): { net: Net; rpc: Rpc } {
  const get = (m: string, args: unknown) => {
    const k = key(m, args);
    if (!(k in tape.rpc)) throw new Error(`not on the tape: ${k.slice(0, 200)}`);
    return dec(tape.rpc[k]);
  };
  return {
    net: {
      async json<T>(url: string): Promise<T> {
        const r = tape.net[url];
        if (!r) throw new Error(`not on the tape: GET ${url}`);
        if (!r.ok) throw r.status ? new HttpError(r.status, url) : new Error(r.error);
        return dec(r.v) as T;
      },
    },
    rpc: {
      head: async () => get("head", []),
      code: async (a) => get("code", [a.toLowerCase()]),
      storage: async (a, s) => get("storage", [a.toLowerCase(), s]),
      call: async (tx) => get("call", [{ ...tx, to: tx.to.toLowerCase() }]),
      logs: async (q) => get("logs", [q]),
    },
  };
}

// ---------------------------------------------------------------- batched reads

const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
const mc = parseAbi(["function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)"]);

/** Many read calls in one eth_call (Multicall3), each allowed to fail on its own. */
export async function multicall(rpc: Rpc, calls: { to: Address; data: Hex }[]): Promise<(Hex | null)[]> {
  const out: (Hex | null)[] = [];
  for (let i = 0; i < calls.length; i += 150) {
    const part = calls.slice(i, i + 150);
    const r = await rpc.call({ to: MULTICALL3, data: encodeFunctionData({ abi: mc, functionName: "aggregate3", args: [part.map((c) => ({ target: c.to, allowFailure: true, callData: c.data }))] }) });
    if (!r.ok) { out.push(...part.map(() => null)); continue; }
    const rows = decodeFunctionResult({ abi: mc, functionName: "aggregate3", data: r.data }) as readonly { success: boolean; returnData: Hex }[];
    out.push(...rows.map((x) => (x.success && x.returnData !== "0x" ? x.returnData : null)));
  }
  return out;
}
