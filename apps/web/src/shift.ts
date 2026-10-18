import type { Address } from "viem";

/**
 * The live $SHIFT contracts on Ethereum, pinned in the page itself: every transaction the browser
 * builds goes to these, whatever the server says, so a compromised server cannot redirect funds.
 */
export const SHIFT = {
  token: "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac" as Address,
  hook: "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc" as Address,
  splitter: "0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44" as Address,
  rewards: "0x44ef9ba2dac00b709a7a69a966a7cbc9c5f930b5" as Address,
};

/** The SHIFT/ETH Uniswap v4 pool key (fee 1.25%, tick spacing 60, our hook). */
export const SHIFT_POOL = {
  currency0: "0x0000000000000000000000000000000000000000" as Address,
  currency1: "0xE5e58E53d0Bb204Aa62c995A6c8CC8a48e60C3AC" as Address,
  fee: 12500,
  tickSpacing: 60,
  hooks: "0x42Ebcf86E3AB0445ba0362F911a7E8FAd6aCe0CC" as Address,
};
