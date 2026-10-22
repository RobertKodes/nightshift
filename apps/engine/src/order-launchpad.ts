/**
 * The IMD orders behind the next stages of the NIGHTSHIFT Launchpad (docs/launchpad/DESIGN.md), written
 * like order-forge.ts and checked with IMD's free POST /requests/check (results in docs/launchpad/checks/).
 * None is paid by this code: a creator pays a coin order from their own wallet, the dev wallet pays the
 * $SHIFT bridge orders from /setup.
 *
 * 1. LAUNCH_HOOK_ORDER(coin): a coin with the NIGHTSHIFT Launch Hook (anti-sniper fee for the first minute,
 *    a 0.25% NIGHTSHIFT fee to the fee splitter), launch.open univ4_hook with customToken, one per coin.
 * 2. SHIFT_OFT_ADAPTER_ORDER: the home end of a LayerZero V2 bridge for $SHIFT on Ethereum (a lockbox).
 * 3. shiftOftSpokeOrder(adapter): its Robinhood Chain end, an OFT that mints only on its peer's message.
 *    IMD cannot deploy on Base or Solana yet, so those ends wait (DESIGN.md, "What IMD cannot do").
 */
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
/** NIGHTSHIFT's FeeSplitter (launch #2124): 40% ShiftRewards ($SHIFT stakers and NIGHT FROGS), 20% dev, 20% treasury, 20% burned (IMD at IMD's BurnExecutor). */
export const FEE_SPLITTER = "0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44";
export const SHIFT = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";
/** LayerZero V2 EndpointV2 and endpoint ids (metadata.layerzero-api.com, read 2026-10-22; the same pair IMD launches #778 and #782 used). */
export const LZ = {
  1: { eid: 30101, endpoint: "0x1a44076050125825900e736c501f859c50fE728c", name: "Ethereum" },
  4663: { eid: 30416, endpoint: "0x6F475642a6e85809B1c36Fa62763669b1b48DD5B", name: "Robinhood Chain" },
} as const;

export type Coin = { name: string; symbol: string; supply: string; chainId: 1 | 4663; creator: string };

export const launchHookObjective = (c: Coin) => `Launch ${c.name} (${c.symbol}) on ${c.chainId === 1 ? "Ethereum" : "Robinhood Chain"} with its own token and the NightshiftLaunchHook on its ${c.symbol}/ETH Uniswap v4 pool.

TOKEN (customToken): a plain ERC-20 named ${c.name}, symbol ${c.symbol}, total supply ${c.supply} with 18 decimals, minted once and whole in the constructor. No owner, no mint after launch, no burn by anyone but a holder of their own tokens, no transfer fee, no blocklist, no pause, no permit needed.

HOOK: NightshiftLaunchHook, immutable, no owner and no admin functions, no backend signer, no oracle, no upgrade. It holds no funds between swaps. Its only parameters, fixed in the constructor: the PoolManager, FEE_TO = ${FEE_SPLITTER} (the NIGHTSHIFT FeeSplitter, which accepts ETH), SNIPER_WINDOW = 60 seconds, SNIPER_START_BPS = 5000, FEE_BPS = 25.
1. launchedAt = block.timestamp in afterInitialize; the hook serves exactly one pool, the launch's ${c.symbol}/ETH pool, and reverts for any other pool.
2. Anti-sniper fee: a buy (ETH in, ${c.symbol} out) made at elapsed = block.timestamp - launchedAt < 60 seconds pays an extra sniper fee of SNIPER_START_BPS x (60 - elapsed) / 60 basis points of its ETH input (50% in the launch second, falling linearly to 0 at 60 seconds). Sells pay no sniper fee. Exact-input and exact-output buys are both charged on their ETH amount.
3. NIGHTSHIFT fee: every swap after the window, buy or sell, pays FEE_BPS = 0.25% of its ETH amount (input for buys, output for sells).
4. Both fees are taken in ETH through beforeSwap/afterSwap return deltas and sent to FEE_TO in the same swap with PoolManager take; emit FeeTaken(address indexed sender, bool buy, uint256 sniperFee, uint256 fee). Nothing is kept in the hook. The pool's own LP fee is the launch factory's and is not changed.
5. Swaps must work through the Uniswap v4 Universal Router (V4_SWAP, SWAP_EXACT_IN_SINGLE and SWAP_EXACT_OUT_SINGLE) with empty hookData and be quotable by the V4 Quoter, so routers and cross-chain intent solvers (Relay, LI.FI) can buy from any chain.
6. Views: launchedAt(), sniperBps() (the fee a buy would pay now, 0 after the window), FEE_TO(), FEE_BPS().

Trading opens to everyone at launch: no allowlist and no first-buyer gate. Foundry tests on a real v4-core PoolManager: the sniper fee at 0, 1, 30, 59 and 60 seconds; the 0.25% fee on buys and sells after the window; exact-input and exact-output; fees arrive at FEE_TO; no ETH or token stays in the hook; any other pool reverts; fuzz on amounts and times. The owner of the launch is ${c.creator}; the hook has no owner functions.`;

export const LAUNCH_HOOK_ORDER = (c: Coin) => ({
  key: `launch-hook-${c.symbol.toLowerCase()}`,
  title: `${c.symbol} with the NIGHTSHIFT Launch Hook`,
  what: "A coin with its own token and the NIGHTSHIFT Launch Hook on its Uniswap v4 pool: a sniper fee that falls from 50% to 0 over the first minute, then 0.25% of every swap to the NIGHTSHIFT fee splitter ($SHIFT stakers, NIGHT FROGS, burns of SHIFT and IMD). Built, tested, audited and deployed by IMD; paid by the creator.",
  action: "launch.open" as const,
  intake: "launch.open@launch-1",
  body: {
    objective: launchHookObjective(c),
    shape: "chain",
    references: ["uniswap-v4-hooks", "uniswap-v4-security"],
    steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }],
    onchain: "univ4_hook",
    customToken: true,
    chainId: c.chainId,
    pairWith: "eth",
    owner: c.creator.toLowerCase(),
    economics: { poolBps: 9000 },
  },
});

const ADAPTER_OBJECTIVE = `The home-chain end of a LayerZero V2 bridge for the existing ERC-20 NIGHTSHIFT ($SHIFT) at ${SHIFT} on Ethereum (18 decimals, plain transfers, no fee): ShiftOFTAdapter, an OFT adapter that locks SHIFT on send and releases it on receive. LayerZero EndpointV2 on this chain: ${LZ[1].endpoint} (endpoint id ${LZ[1].eid}). It will be paired with exactly one OFT on Robinhood Chain (endpoint id ${LZ[4663].eid}), ordered separately. This is the only adapter (lockbox) for SHIFT, ever.

The owner and LayerZero delegate is ${DEV}, set in the constructor. Only the owner can: setPeer (once per endpoint id), set the send and receive library config (DVNs and confirmations) through the endpoint as delegate, set enforced options, and lower the outbound rate limit. Use LayerZero V2 OApp/OFT semantics with 6 shared decimals and LayerZero's RateLimiter: at most 10,000,000 SHIFT may leave per destination per rolling hour; the owner can lower that limit, never raise it above 10,000,000 per hour. No fees, so nobody receives fees or payouts; no pause, no upgrade path, no rescue or sweep function: locked SHIFT can only leave as a release for a verified message.

Put the LayerZero code the contract needs under src/ and add nothing under lib/. The constructor must not revert when the endpoint and token addresses hold no code, because the launch verifier's protected-invariant harness deploys the contract in a fresh EVM. Nothing is called after deployment by the deployer: the owner wires it afterwards (setPeer to the Robinhood OFT, and a ULN config with 2 required DVNs, LayerZero Labs and one independent DVN, and 15 block confirmations, because LayerZero's default on Robinhood Chain is its dead DVN).

Foundry tests with LayerZero's test helpers: send locks exactly the sent amount minus dust, a verified receive releases it, only the peer is accepted, the rate limit blocks the 10,000,001st SHIFT in an hour and refills, only the owner can set peers, config and lower the limit, the limit can never be raised above the cap, and no function moves SHIFT out but a verified receive. Verify on Etherscan and Sourcify.`;

export const SHIFT_OFT_ADAPTER_ORDER = {
  key: "shift-oft-adapter",
  title: "$SHIFT bridge, Ethereum end (LayerZero OFT adapter)",
  what: "Builds, tests, audits and deploys on Ethereum the lockbox that lets $SHIFT move to Robinhood Chain as the same token: it locks SHIFT on send and releases it only for a verified LayerZero message from its one peer, at most 10M SHIFT an hour. The dev wallet owns it and wires it with two required verifiers.",
  action: "launch.open" as const,
  intake: "launch.open@launch-1",
  body: { objective: ADAPTER_OBJECTIVE, onchain: "evm_contracts", chainId: 1, owner: DEV },
};

const spokeObjective = (adapter: string) => `The Robinhood Chain end of a LayerZero V2 bridge for NIGHTSHIFT ($SHIFT): ShiftOFT, an OFT named NIGHTSHIFT, symbol SHIFT, 18 decimals, with no supply at deployment. Total supply: 0 at deployment, then exactly the SHIFT locked in the Ethereum adapter and not yet sent back, so never more than the 1,000,000,000 SHIFT that exist on Ethereum. It mints only on a verified message from its one peer and burns on send. Its peer is fixed in the constructor: endpoint id ${LZ[1].eid} (Ethereum), the OFT adapter at ${adapter}. LayerZero EndpointV2 on this chain: ${LZ[4663].endpoint} (endpoint id ${LZ[4663].eid}).

The owner and LayerZero delegate is ${DEV}, set in the constructor. Only the owner can set the send and receive library config (DVNs and confirmations) through the endpoint as delegate, set enforced options, and lower the outbound rate limit; it cannot change the peer, mint, burn anyone's tokens, pause or upgrade. Use LayerZero V2 OApp/OFT semantics with 6 shared decimals and LayerZero's RateLimiter: at most 10,000,000 SHIFT may leave per rolling hour, which the owner can lower and never raise above 10,000,000. No fees, so nobody receives fees or payouts; no blocklist, no pause, no upgrade path, no rescue function. Plain ERC-20 transfers.

Put the LayerZero code the contract needs under src/ and add nothing under lib/. The constructor must not revert when the endpoint address holds no code, because the launch verifier's protected-invariant harness deploys the contract in a fresh EVM. Nothing is called after deployment by the deployer: the owner sets the ULN config with 2 required DVNs (LayerZero Labs and one independent DVN) and 15 block confirmations, because LayerZero's default on Robinhood Chain is its dead DVN.

Foundry tests with LayerZero's test helpers: a verified message from the peer mints exactly the amount, any other sender or endpoint id is refused, send burns, the rate limit blocks the 10,000,001st SHIFT in an hour and refills, only the owner can set config and lower the limit, nobody can mint otherwise. Verify on the Robinhood Chain explorer and Sourcify.`;

export const shiftOftSpokeOrder = (adapter: string) => ({
  key: "shift-oft-robinhood",
  title: "$SHIFT bridge, Robinhood Chain end (LayerZero OFT)",
  what: "Builds, tests, audits and deploys on Robinhood Chain the OFT side of the $SHIFT bridge: SHIFT there is minted only for SHIFT locked in the Ethereum adapter, and burned when it goes back. Ordered after the adapter, whose address it is fixed to.",
  action: "launch.open" as const,
  intake: "launch.open@launch-1",
  body: { objective: spokeObjective(adapter), onchain: "evm_contracts", chainId: 4663, owner: DEV },
});
