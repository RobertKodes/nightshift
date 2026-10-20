import { type Address, type Hex, decodeAbiParameters, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, pad, parseAbi, toFunctionSelector, toHex } from "viem";
import { type PoolKey, V4, quoterAbi, routerAbi } from "../v4.js";
import { findBalanceSlot, lc } from "./evm.js";
import { MAX_LOG_RANGE, type Rpc } from "./net.js";

/**
 * Uniswap v4 pools as the services read them: the pool key and id, the price and fee straight
 * from the PoolManager's storage, quotes from the V4 Quoter (which runs the pool's hook), and a
 * sell through the Universal Router simulated with eth_call. Nothing is ever signed or sent.
 */
export const NATIVE: Address = "0x0000000000000000000000000000000000000000";
export const DYNAMIC_FEE = 0x800000;
const INITIALIZE_TOPIC = keccak256(new TextEncoder().encode("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)")) as Hex;
const POOLS_SLOT = 6n;

export const poolIdOf = (k: PoolKey): Hex => keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
  [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));

export type Slot0 = { sqrtPriceX96: bigint; tick: number; protocolFee: number; lpFee: number; liquidity: bigint };
/** slot0 and liquidity of a pool, from the PoolManager's storage (StateLibrary's layout). */
export async function slot0(rpc: Rpc, poolId: Hex): Promise<Slot0 | null> {
  const base = BigInt(keccak256(encodePacked(["bytes32", "bytes32"], [poolId, pad(toHex(POOLS_SLOT), { size: 32 })])));
  const [w, l] = await Promise.all([rpc.storage(V4.poolManager, toHex(base, { size: 32 })), rpc.storage(V4.poolManager, toHex(base + 3n, { size: 32 }))]);
  const v = BigInt(w === "0x" ? 0 : w);
  if (v === 0n) return null;
  const sqrtPriceX96 = v & ((1n << 160n) - 1n);
  const tickRaw = Number((v >> 160n) & 0xffffffn);
  return {
    sqrtPriceX96, tick: tickRaw >= 0x800000 ? tickRaw - 0x1000000 : tickRaw, protocolFee: Number((v >> 184n) & 0xffffffn), lpFee: Number((v >> 208n) & 0xffffffn),
    liquidity: BigInt(l === "0x" ? 0 : l) & ((1n << 128n) - 1n),
  };
}

/** The pool's key from the PoolManager's Initialize event for this id, looked for around a block (e.g. from the pair's creation time). */
export async function keyFromInitialize(rpc: Rpc, poolId: Hex, nearBlock: bigint, head: bigint): Promise<{ key: PoolKey; block: number } | null> {
  const starts: bigint[] = [];
  for (const off of [0n, -1n, 1n, -2n, 2n, -3n, 3n]) { const from = nearBlock - MAX_LOG_RANGE / 2n + off * MAX_LOG_RANGE; if (from < head) starts.push(from < 0n ? 0n : from); }
  for (const from of starts) {
    const to = from + MAX_LOG_RANGE - 1n > head ? head : from + MAX_LOG_RANGE - 1n;
    const logs = await rpc.logs({ address: V4.poolManager, topics: [INITIALIZE_TOPIC, poolId], fromBlock: from, toBlock: to }).catch(() => []);
    const l = logs[0];
    if (!l) continue;
    const [fee, tickSpacing, hooks] = decodeAbiParameters([{ type: "uint24" }, { type: "int24" }, { type: "address" }, { type: "uint160" }, { type: "int24" }], l.data) as unknown as [number, number, Address];
    return { key: { currency0: lc(`0x${l.topics[2]!.slice(26)}`), currency1: lc(`0x${l.topics[3]!.slice(26)}`), fee: Number(fee), tickSpacing: Number(tickSpacing), hooks: lc(hooks) }, block: l.blockNumber };
  }
  return null;
}

/** Pools initialised with this hook, from its deploy block onwards (a hook's pools are usually created right after it). */
export async function poolsOfHook(rpc: Rpc, hook: Address, fromBlock: bigint, head: bigint, chunks = 4): Promise<{ key: PoolKey; id: Hex; block: number }[]> {
  const out: { key: PoolKey; id: Hex; block: number }[] = [];
  for (let i = 0n; i < BigInt(chunks); i++) {
    const from = fromBlock + i * MAX_LOG_RANGE;
    if (from > head) break;
    const to = from + MAX_LOG_RANGE - 1n > head ? head : from + MAX_LOG_RANGE - 1n;
    const logs = await rpc.logs({ address: V4.poolManager, topics: [INITIALIZE_TOPIC], fromBlock: from, toBlock: to }).catch(() => []);
    for (const l of logs) {
      const [fee, tickSpacing, hooks] = decodeAbiParameters([{ type: "uint24" }, { type: "int24" }, { type: "address" }, { type: "uint160" }, { type: "int24" }], l.data) as unknown as [number, number, Address];
      if (hooks.toLowerCase() !== hook.toLowerCase()) continue;
      out.push({ key: { currency0: lc(`0x${l.topics[2]!.slice(26)}`), currency1: lc(`0x${l.topics[3]!.slice(26)}`), fee: Number(fee), tickSpacing: Number(tickSpacing), hooks: lc(hooks) }, id: l.topics[1]! as Hex, block: l.blockNumber });
    }
  }
  return out;
}

/** Price of currency1 in currency0 units, decimals applied. */
export function price1in0(s: Slot0, dec0: number, dec1: number): number {
  const p = Number(s.sqrtPriceX96) / 2 ** 96;
  return (p * p) * 10 ** (dec0 - dec1);
}

/** What a single position over [tickLower, tickUpper] holds at the current price: the pool's reserves when it is the only one. */
export function positionAmounts(s: Slot0, tickLower: number, tickUpper: number): { amount0: number; amount1: number } {
  const sp = Number(s.sqrtPriceX96) / 2 ** 96;
  const sa = Math.sqrt(1.0001 ** tickLower), sb = Math.sqrt(1.0001 ** tickUpper);
  const L = Number(s.liquidity);
  const c = Math.min(Math.max(sp, sa), sb);
  return { amount0: L * (1 / c - 1 / sb), amount1: L * (c - sa) };
}

const ERRORS: Record<string, string> = Object.fromEntries(([
  ["CurrencyNotSettled()", "CurrencyNotSettled (a token moved less than it said: a transfer fee or a block)"],
  ["HookNotImplemented()", "HookNotImplemented"],
  ["PriceLimitAlreadyExceeded(uint160,uint160)", "PriceLimitAlreadyExceeded"],
  ["PoolNotInitialized()", "PoolNotInitialized"],
  ["ERC20InsufficientBalance(address,uint256,uint256)", "ERC20InsufficientBalance"],
  ["ERC20InsufficientAllowance(address,uint256,uint256)", "ERC20InsufficientAllowance"],
  ["V4TooLittleReceived(uint256,uint256)", "V4TooLittleReceived"],
  ["V4TooMuchRequested(uint256,uint256)", "V4TooMuchRequested"],
  ["DeadlinePassed(uint256)", "DeadlinePassed"],
  ["DeltaNotNegative(address)", "DeltaNotNegative"],
  ["DeltaNotPositive(address)", "DeltaNotPositive"],
  ["NotEnoughLiquidity(bytes32)", "NotEnoughLiquidity (the pool has none of the output token at this price)"],
  ["UnsupportedAction(uint256)", "UnsupportedAction"],
  ["Panic(uint256)", "Panic"],
] as const).map(([sig, name]) => [toFunctionSelector(sig), name]));
/** A readable reason for a revert: the error's name when we know it, the text of Error(string), else the selector. */
export function revertReason(r: { error: string; data?: Hex }): string {
  const sel = r.data?.slice(0, 10);
  if (sel === "0x08c379a0" && r.data) { try { return `Error("${(decodeAbiParameters([{ type: "string" }], `0x${r.data.slice(10)}`)[0] as string).slice(0, 120)}")`; } catch { /* fall through */ } }
  if (sel === UNEXPECTED && r.data && r.data.length > 10) {
    // the V4 Quoter wraps whatever the swap reverted with
    try { return revertReason({ error: "", data: decodeAbiParameters([{ type: "bytes" }], `0x${r.data.slice(10)}`)[0] as Hex }); } catch { /* fall through */ }
  }
  if (sel === WRAPPED && r.data && r.data.length > 10) {
    try {
      const [target, selector, reason] = decodeAbiParameters([{ type: "address" }, { type: "bytes4" }, { type: "bytes" }, { type: "bytes" }], `0x${r.data.slice(10)}`) as unknown as [Address, Hex, Hex];
      return `WrappedError from ${target} in ${selector}: ${revertReason({ error: "no reason", data: reason })}`;
    } catch { /* fall through */ }
  }
  if (sel && ERRORS[sel]) return ERRORS[sel]!;
  if (sel) return `custom error ${sel}`;
  return r.error.slice(0, 160) || "reverted without a reason";
}
const UNEXPECTED = toFunctionSelector("UnexpectedRevertBytes(bytes)");
const WRAPPED = toFunctionSelector("WrappedError(address,bytes4,bytes,bytes)");

/** An exact-input quote from the V4 Quoter: runs the swap and its hook, then reverts, so nothing changes. */
export async function quote(rpc: Rpc, key: PoolKey, zeroForOne: boolean, amountIn: bigint, from: Address): Promise<{ ok: true; out: bigint; gas: bigint } | { ok: false; reason: string }> {
  const r = await rpc.call({ to: V4.quoter, from, data: encodeFunctionData({ abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: "0x" }] }) });
  if (!r.ok) return { ok: false, reason: revertReason(r) };
  const [out, gas] = decodeFunctionResult({ abi: quoterAbi, functionName: "quoteExactInputSingle", data: r.data }) as readonly [bigint, bigint];
  return { ok: true, out, gas };
}

const quoterPathAbi = parseAbi([
  "function quoteExactInput((address exactCurrency, (address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)[] path, uint128 exactAmount) params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
/**
 * A buy and the sell of what it bought, back to back in one quote (a two-hop path through the same
 * pool): the sell sees the pool as the buy left it, so it works even in a pool nobody has bought from yet.
 */
export async function quoteRoundTrip(rpc: Rpc, key: PoolKey, quoteCurrency: Address, amountIn: bigint, from: Address): Promise<{ ok: true; out: bigint } | { ok: false; reason: string }> {
  const token = key.currency0 === quoteCurrency ? key.currency1 : key.currency0;
  const hop = (c: Address) => ({ intermediateCurrency: c, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks, hookData: "0x" as Hex });
  const r = await rpc.call({ to: V4.quoter, from, data: encodeFunctionData({ abi: quoterPathAbi, functionName: "quoteExactInput", args: [{ exactCurrency: quoteCurrency, path: [hop(token), hop(quoteCurrency)], exactAmount: amountIn }] }) });
  if (!r.ok) return { ok: false, reason: revertReason(r) };
  const [out] = decodeFunctionResult({ abi: quoterPathAbi, functionName: "quoteExactInput", data: r.data }) as readonly [bigint, bigint];
  return { ok: true, out };
}

const SWAP_EXACT_IN_SINGLE = 0x06, SETTLE = 0x0b, TAKE = 0x0e, TAKE_ALL = 0x0f;
const OPEN_DELTA = 0n, CONTRACT_BALANCE = 1n << 255n;
const ADDRESS_THIS: Address = "0x0000000000000000000000000000000000000002";
const KEY_T = { name: "poolKey", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] } as const;
const swapSingle = (key: PoolKey, zeroForOne: boolean, amountIn: bigint) => encodeAbiParameters([{ type: "tuple", components: [
  KEY_T, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" },
] }], [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: 0n, hookData: "0x" }]);
const settleOf = (c: Address, amount: bigint) => encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], [c, amount, false]);

/**
 * A buy and a sell through the Universal Router, with eth_call: the router buys with `amountIn` of
 * the quote currency (given to it by a storage override, or sent as value for ETH), takes the
 * tokens out of the PoolManager into its own balance, then pays all of them back in and sells them
 * (SETTLE of its whole balance), and the wallet takes what the sell paid. The token's own transfer code runs
 * both ways, as in a real buy and sell: a token that blocks or taxes transfers fails here.
 */
export async function routerRoundTrip(rpc: Rpc, key: PoolKey, quoteCurrency: Address, amountIn: bigint, from: Address, nowMs: number): Promise<{ ok: true } | { ok: false; reason: string; stage: "setup" | "swap" }> {
  const buyZ = key.currency0 === quoteCurrency;
  const token = buyZ ? key.currency1 : key.currency0;
  const native = quoteCurrency.toLowerCase() === NATIVE;
  const override: { address: Address; balance?: bigint; stateDiff?: { slot: Hex; value: Hex }[] }[] = [{ address: from, balance: 10n ** 20n }];
  if (!native) {
    const slot = await findBalanceSlot(rpc, quoteCurrency, V4.router);
    if (!slot) return { ok: false, stage: "setup", reason: "could not give the router a test balance of the quote token: not simulated" };
    override.push({ address: quoteCurrency, stateDiff: [{ slot, value: pad(toHex(amountIn), { size: 32 }) }] });
  }
  const actions = encodePacked(["uint8", "uint8", "uint8", "uint8", "uint8", "uint8"], [SWAP_EXACT_IN_SINGLE, SETTLE, TAKE, SETTLE, SWAP_EXACT_IN_SINGLE, TAKE_ALL]);
  const params = [
    swapSingle(key, buyZ, amountIn), // buy
    settleOf(quoteCurrency, amountIn), // pay for it from the router
    encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [token, ADDRESS_THIS, OPEN_DELTA]), // the tokens out to the router: a real transfer
    settleOf(token, CONTRACT_BALANCE), // and all of them back in: a real transfer
    swapSingle(key, !buyZ, OPEN_DELTA), // sell everything that arrived
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [quoteCurrency, 0n]), // what the sell paid, to the wallet
  ];
  const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, params]);
  // a deadline from the caller's clock, rounded to the hour, so a recorded run replays exactly
  const deadline = BigInt(Math.floor(nowMs / 3_600_000) * 3_600 + 7_200);
  const r = await rpc.call({ to: V4.router, from, value: native ? amountIn : 0n, override, data: encodeFunctionData({ abi: routerAbi, functionName: "execute", args: ["0x10", [input], deadline] }) });
  return r.ok ? { ok: true } : { ok: false, stage: "swap", reason: revertReason(r) };
}

export const ERC20_DECIMALS = parseAbi(["function decimals() view returns (uint8)"]);
