import { type Address, type Hex, encodeAbiParameters, encodePacked, parseAbi } from "viem";

/**
 * Uniswap v4 on Ethereum mainnet: swaps on one pool (ours, with its hook) through the Universal
 * Router, quotes through the V4 Quoter. The same encoding is used by the engine's launch checks
 * (apps/engine/src/v4.ts, a copy of apps/web/src/v4.ts), so what is checked is what the site sends.
 */
export const V4 = {
  poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  router: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
  quoter: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const satisfies Record<string, Address>;

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

const POOL_KEY = { type: "tuple", components: [
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
] } as const;

export const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
export const routerAbi = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
export const permit2Abi = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);

const V4_SWAP = "0x10";
const SWAP_EXACT_IN_SINGLE = 0x06, SETTLE_ALL = 0x0c, TAKE_ALL = 0x0f;

/** The Universal Router call for one exact-input swap on `key`. ETH in means msg.value = amountIn. */
export function swapCall(key: PoolKey, zeroForOne: boolean, amountIn: bigint, minOut: bigint, deadline: bigint): { commands: Hex; inputs: Hex[]; deadline: bigint } {
  const [inC, outC] = zeroForOne ? [key.currency0, key.currency1] : [key.currency1, key.currency0];
  const actions = encodePacked(["uint8", "uint8", "uint8"], [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]);
  const swap = encodeAbiParameters([{ type: "tuple", components: [
    { ...POOL_KEY, name: "poolKey" }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" },
  ] }], [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: minOut, hookData: "0x" }]);
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [inC, amountIn]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [outC, minOut]);
  const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, [swap, settle, take]]);
  return { commands: V4_SWAP, inputs: [input], deadline };
}

export const quoteArgs = (key: PoolKey, zeroForOne: boolean, amount: bigint) => [{ poolKey: key, zeroForOne, exactAmount: amount, hookData: "0x" as Hex }] as const;
