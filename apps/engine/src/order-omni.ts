import { FEE_SPLITTER, LZ } from "./order-launchpad.js";

/**
 * The IMD orders for the EVM side of an "omni" coin (docs/launchpad/OMNI.md): a pump.fun coin on Solana whose
 * one supply is also on Ethereum or Robinhood Chain through Wormhole NTT (Solana hub in locking mode, EVM spokes
 * burn and mint), with a Uniswap v4 pool on the EVM side that stays near PumpSwap's price. Written like
 * order-launchpad.ts and checked with IMD's free POST /requests/check (answers in docs/launchpad/checks/omni-*.json).
 * Nothing here pays: the creator pays each order from their own wallet (or the dev wallet from /setup).
 *
 * Why the NTT manager and transceiver are NOT ordered: Wormhole's own audited EVM contracts are deployed with the
 * NTT CLI by the owner (OMNI.md, 2.3), so the swarm builds only what is ours: the spoke token, the pool hook and its
 * seeder, the graduation gate, the sync vault and the off-chain keeper. IMD's hook launch always creates its own
 * token and refuses minting after launch, so a bridged coin cannot use it: the pool is made from the hook order.
 */
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
/** Wormhole chain ids (Robinhood Chain 72 from RESEARCH.md 5.1). */
export const WORMHOLE_CHAIN_ID = { solana: 1, ethereum: 2, robinhood: 72 } as const;
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMPSWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

export type OmniCoin = {
  name: string; symbol: string;
  /** The pump.fun mint on Solana (Token-2022, 6 decimals, 1,000,000,000 supply, mint and freeze authority null). */
  solMint: string;
  /** The coin's pump.fun bonding curve account (PDA ["bonding-curve", mint] of the pump program). */
  curve: string;
  creator: string; chainId: 1 | 4663;
};
const chainName = (c: OmniCoin) => (c.chainId === 1 ? "Ethereum" : "Robinhood Chain");
const tag = (c: OmniCoin) => `${c.symbol.toLowerCase()}-${c.chainId === 1 ? "eth" : "rh"}`;
/** 1,000,000,000 coins at 6 decimals: what pump.fun mints (a mayhem-mode coin has 2,000,000,000: do not use mayhem mode). */
const SUPPLY_CAP_RAW = "1000000000000000";

export const omniSpokeObjective = (c: OmniCoin) => `The ${chainName(c)} end of one coin that also lives on Solana: ${c.name} (${c.symbol}), a pump.fun coin whose Solana mint is ${c.solMint}. Contract OmniSpokeToken, an ERC-20 for Wormhole Native Token Transfers in burning mode: the Solana side locks the coin, this side mints exactly what is locked and burns it when it goes back.

Token facts: name ${c.name}, symbol ${c.symbol}, 6 decimals (the same as the Solana mint, so no rounding on the bridge), plain ERC-20 transfers with no fee, tax, limit, blocklist, pause or permit. Total supply: 0 at deployment, then only what the minter mints; a hard cap in the constructor, immutable CAP = ${SUPPLY_CAP_RAW} base units (1,000,000,000 ${c.symbol}, what exists on Solana), and mint reverts above it. Minting after launch is the point of this token and is allowed to exactly one address, the minter.

Roles. The owner and creator is ${c.creator} (set in the constructor as owner). The minter starts as the zero address. The owner may call setMinter(address) while the token is not sealed, then seal() once, which permanently freezes the minter and removes every owner function (the owner can never change the minter again, and nothing else is owner-only). Wormhole's NttManager is set as the minter by the owner, then the token is sealed, in one sitting after the NTT CLI deploys the manager. Events: MinterSet(address), Sealed().
Interface required by Wormhole NTT in burning mode: mint(address to, uint256 amount) callable only by the minter; burn(uint256 amount) burns the caller's own tokens; plus the standard ERC-20 views. No other function can create or destroy tokens, and burn can only burn the caller's own balance.

Foundry tests: only the minter mints; mint above CAP reverts (test the exact boundary and a fuzz over many mints); setMinter and seal are owner-only; after seal the owner cannot change the minter and has no callable function; burn burns only the caller's balance; ERC-20 behaviour; no ETH is accepted. The contract holds no funds and has no dependencies on any outside address.`;

export const omniSpokeOrder = (c: OmniCoin) => ({
  key: `omni-spoke-${tag(c)}`,
  title: `${c.symbol} on ${chainName(c)}: the bridged token (Wormhole NTT spoke)`,
  what: `Builds, tests, audits and deploys the ${chainName(c)} token of a pump.fun coin: 6 decimals, a hard cap equal to the Solana supply, mintable only by the Wormhole NTT manager and then sealed. The creator owns it until sealing.`,
  action: "launch.open" as const,
  intake: "launch.open@launch-1",
  body: { objective: omniSpokeObjective(c), onchain: "evm_contracts", chainId: c.chainId, owner: c.creator.toLowerCase() },
});

export const omniHookObjective = (c: OmniCoin) => `The pool of ${c.name} (${c.symbol}) on ${chainName(c)}: two contracts, OmniPoolHook and OmniPoolSeeder, for a Uniswap v4 pool ${c.symbol}/ETH. ${c.symbol} here is OmniSpokeToken, a 6-decimals ERC-20 minted only by a Wormhole NTT manager when the same coin is locked on Solana (the pump.fun mint ${c.solMint}); its address is a constructor argument. This pool is the EVM twin of the PumpSwap pool on Solana (program ${PUMPSWAP_PROGRAM}); the two pools are kept at one price by arbitrage keepers, never by a bridge inside a swap.

The owner is ${c.creator}, set from $owner.

OmniPoolHook (one pool, immutable, the owner has no power over swaps or funds):
1. Constructor arguments: PoolManager, TOKEN (the spoke token), FEE_TO = ${FEE_SPLITTER} (the NIGHTSHIFT FeeSplitter, accepts ETH), GATE (an address that may call open(); the owner sets it once with setGate, only while the pool is closed), OPENS_BY (a timestamp, the earliest the owner may open the pool without proof), REF (optional price-reference contract, may be zero).
2. Closed until open(): while closed, swaps revert and only the seeder may add liquidity. open() can be called by GATE or, after OPENS_BY, by the owner; it emits Opened(by) and cannot be undone. GATE is the contract that checks that the coin has graduated on pump.fun (ordered separately); the hook knows only its address.
3. Fees, taken in ETH through the hook's return deltas and sent to FEE_TO in the same swap: a base hook fee FEE_BPS = 25 (0.25%) on every swap's ETH amount, plus a gap fee. The gap fee reads GAP() on REF: it returns the signed price gap in basis points between this pool and the Solana pool, with a timestamp. If REF is zero or its answer is older than 60 seconds or the call reverts, the gap fee is 0 and trading is unaffected. A swap that moves this pool's price toward the reference (that closes the gap) pays an extra gapFee = min(|gap| x 50%, 500) basis points of its ETH amount; a swap that widens the gap pays nothing extra. Nobody can make the hook revert a swap through REF.
4. Events: FeeTaken(address indexed sender, bool buy, uint256 baseFee, uint256 gapFee, int256 gapBps).
5. Swaps work through the Uniswap v4 Universal Router with empty hookData and are quotable by the V4 Quoter, so intent routers can buy from other chains.
6. No oracle is needed for safety: with REF zero the hook is a plain 0.25% hook. Immutable, no upgrade, no pause, no admin function except setGate once and open-by-owner after OPENS_BY. It holds no funds between swaps.

OmniPoolSeeder (one-shot helper): the owner calls seed(tokenAmount, startSqrtPriceX96, tickLower, tickUpper) with ETH attached after sending ${c.symbol} to it; it initialises the pool with the hook, a fixed LP fee of 1.00% (fee 10000, tick spacing 200), adds one liquidity position with all of its ETH and tokens, and sends the position to the owner. It can run once. The LP position belongs to the owner; nothing locks it unless the owner chooses a lock later.

The hook's address needs the Uniswap v4 permission bits it uses (beforeAddLiquidity, beforeSwap and afterSwap with return deltas); the deploy script mines a CREATE2 salt for them with a known deployer and the tests prove the address bits. Foundry tests on a real v4-core PoolManager: closed pool reverts swaps and allows seeding; open() by GATE, by the owner only after OPENS_BY, by nobody else; base fee 0.25% on buys and sells, exact-input and exact-output; gap fee zero without REF, with a stale REF and with a reverting REF; gap fee only on swaps that close the gap, capped at 500 bps; fees arrive at FEE_TO; nothing stays in the hook; a second pool reverts; seeder runs once and hands over the position; fuzz on amounts and gaps.`;

export const omniHookOrder = (c: OmniCoin) => ({
  key: `omni-hook-${tag(c)}`,
  title: `${c.symbol} pool on ${chainName(c)}: gated v4 hook with a gap fee`,
  what: "A Uniswap v4 hook and one-shot seeder for the EVM twin of a pump.fun coin's pool: closed until the coin has graduated, 0.25% to the NIGHTSHIFT fee splitter, an optional fee on trades that close the gap to the Solana price (never blocks trading), the LP position handed to the creator.",
  action: "launch.open" as const,
  intake: "launch.open@launch-1",
  body: { objective: omniHookObjective(c), onchain: "evm_contracts", chainId: c.chainId, owner: c.creator.toLowerCase() },
});

export const omniGateObjective = (c: OmniCoin) => `GraduationGate: a contract on ${chainName(c)} that opens an OmniPoolHook only after proof that the pump.fun coin ${c.solMint} has graduated, proven with a Wormhole Queries (CCQ) response that Wormhole's guardians signed. No trusted signer of ours.

What is proven. A Wormhole Queries response with one sol_account result: the Solana mainnet account of the coin's pump.fun bonding curve ${c.curve}, owned by the pump program ${PUMP_PROGRAM}. The account layout is 166 bytes: an 8-byte discriminator 17b7f83760d8ac60, then five little-endian u64 (virtual token reserves, virtual SOL reserves, real token reserves, real SOL reserves, token total supply), then a bool "complete" at byte offset 48, then the creator's 32-byte public key. A graduated curve has complete == 1 and real token reserves 0 (read from a real graduated account on 2026-10-22).

Behaviour. open(bytes response, GuardianSignature[] sigs): anyone may call it. It verifies the response with Wormhole's QueryResponse library against the current guardian set of the Wormhole core contract on this chain (the core address is a constructor argument; vendor the Wormhole Solidity SDK under src/ and add nothing under lib/), then requires: the query is for Solana mainnet (Wormhole chain id 1), the account address equals CURVE (constructor), the account owner equals the pump program, the data length is 166 and starts with the discriminator, complete == 1 and real token reserves == 0, and the result's block time is within the last 24 hours. If all hold it calls open() on the HOOK (constructor) once and emits Graduated(slot, blockTime). A second call reverts. It never holds funds and has no owner functions: HOOK, CURVE, the program and the core address are immutable. Replays are harmless because opening happens once.

The pool hook it opens is ordered separately; it only needs an open() function that accepts this contract as GATE. Foundry tests with a recorded real response for a graduated curve (the harness may build guardian-signed responses with a test guardian set), a not-yet-graduated curve (reverts), a wrong account, wrong owner program, wrong length, wrong chain id, a stale block time, a forged signature, and a second call. The contract has no owner role.`;

export const omniGateOrder = (c: OmniCoin) => ({
  key: `omni-gate-${tag(c)}`,
  title: `${c.symbol} graduation gate (Wormhole Queries proof of the pump.fun curve)`,
  what: "Opens the EVM pool only when anyone can show a guardian-signed read of the coin's pump.fun bonding curve with complete == 1. No signer of ours.",
  action: "launch.open" as const,
  intake: "launch.open@launch-1",
  body: { objective: omniGateObjective(c), onchain: "evm_contracts", chainId: c.chainId, owner: c.creator.toLowerCase() },
});

export const omniVaultObjective = (c: OmniCoin) => `OmniSyncVault on ${chainName(c)}: a bounded inventory vault for LP-sync keepers of ${c.symbol} (the bridged twin of pump.fun coin ${c.solMint}). Keepers trade the one ${c.symbol}/ETH Uniswap v4 pool against the Solana pool and move inventory over Wormhole NTT; the vault lets depositors fund them without handing over keys. Constructor arguments: PoolManager and the pool key (token ${c.symbol}, ETH, fee 10000, tick spacing 200, the OmniPoolHook), TOKEN, NTT_MANAGER (the Wormhole NttManager), SOLANA_RECIPIENT (a 32-byte Solana address that receives every bridge transfer), KEEPER_CAP = 5.

No token is created: shares are internal accounting in the vault, not an ERC-20, not transferable, with no name, symbol or supply. Depositors. deposit() payable and depositToken(amount) credit shares: ETH shares and ${c.symbol} shares are two separate claims, each over its own balance, so the vault never values the token in ETH through a price feed. withdraw(ethShares, tokenShares) pays out pro rata at any time, never more than the vault holds right now; funds that are away on the Solana side are claimed when they return. No fee on deposits or withdrawals.

Keepers. The owner ${c.creator} adds up to KEEPER_CAP keeper addresses (addKeeper, removeKeeper; removal is immediate). A keeper can only: (1) swap exactly through the one pool with the vault's own funds, each swap at most MAX_SWAP = 2 ETH (or the same value in ${c.symbol}, measured by the swap itself), at most 10 ETH of volume per rolling 24 hours, with a minimum output the keeper passes; the vault requires its total value in ETH terms (ETH balance plus ${c.symbol} balance priced at the pool's price after the swap) not to fall by more than 0.5% of the vault's value per swap and 3% per 24 hours, otherwise the swap reverts; (2) send ${c.symbol} to SOLANA_RECIPIENT through NTT_MANAGER.transfer (at most 500,000 ${c.symbol} per transfer and 2,000,000 per 24 hours), never to any other address or chain; (3) trigger receipt of what NTT delivers to the vault. A keeper cannot withdraw, approve, or send anything to an address that is not the pool, the NTT manager or SOLANA_RECIPIENT. Keepers earn KEEPER_BPS = 2000 (20%) of the vault's realised profit in ETH terms, measured against a high-water mark, paid on harvest(); losses are shared by depositors.

Safety. The owner can pause keepers (pauseKeepers), never deposits or withdrawals, and cannot change SOLANA_RECIPIENT, the pool, NTT_MANAGER, caps or KEEPER_BPS: they are immutable. No upgrade, no sweep or rescue function. Events for every deposit, withdrawal, swap, bridge send, receipt and harvest. Foundry tests on a real v4-core PoolManager and a mock NttManager: every cap at its exact boundary, a keeper trying to send to another address, a swap that loses more than 0.5%, share maths with fuzz, withdrawal while funds are away, pause, harvest with the high-water mark, reentrancy.`;

export const omniVaultOrder = (c: OmniCoin) => ({
  key: `omni-vault-${tag(c)}`,
  title: `${c.symbol} sync vault (bounded inventory for LP-sync keepers)`,
  what: "A vault where depositors fund up to 5 keepers that keep the EVM pool near PumpSwap's price: keepers can only swap in the one pool within loss caps and bridge to one fixed Solana address; withdrawals are never blocked by the owner.",
  action: "launch.open" as const,
  intake: "launch.open@launch-1",
  body: { objective: omniVaultObjective(c), onchain: "evm_contracts", chainId: c.chainId, owner: c.creator.toLowerCase() },
});

export const omniKeeperObjective = (c: OmniCoin) => `Write the off-chain LP-sync keeper library for ${c.name} (${c.symbol}): TypeScript (Node 22, viem, plain fetch, no other runtime dependency), a read-only price-gap monitor first and a trade planner second, with tests.

Read side, all with plain JSON-RPC and no API key beyond the RPC URLs passed in: (1) the Solana price of the coin: the PumpSwap pool of mint ${c.solMint} (program ${PUMPSWAP_PROGRAM}) read from the pool account (8-byte discriminator, bump u8, index u16, then creator, base mint, quote mint, lp mint, base vault, quote vault, each a 32-byte key) and the two vault token balances: price = quote vault balance / base vault balance (quote is wrapped SOL with 9 decimals, base has 6 decimals); before graduation the pump.fun bonding curve ${c.curve} (price = virtual SOL reserves / virtual token reserves, same decimals; 166-byte layout: 8-byte discriminator, five u64 reserves and supply, bool complete at offset 48); (2) the EVM price from the Uniswap v4 pool state by StateView slot0 on ${chainName(c)}, converted with SOL/ETH from a price source passed in as a function (the default medians two public APIs and rejects a stale or missing answer); (3) gap = EVM price / Solana price - 1 in basis points.

Plan side: given the gap, the pool fees (1.00% pool and 0.25% hook on the EVM side; PumpSwap's LP and protocol fees plus the creator fee, passed in as numbers), the bridge fee and the gas, plan_trade returns the direction (buy EVM, bridge, sell Solana; or the reverse), the size that maximises expected profit under constant-product maths on both pools, the expected profit after costs, and returns null when the profit is below MIN_PROFIT_BPS, the size is above MAX_SIZE, either price is older than 30 seconds, or the pump coin has not graduated. It never signs or sends anything: it returns the planned calls as data that a separate executor would run, with the vault's caps respected as inputs.

Tests with recorded real answers (a graduated curve, a PumpSwap pool, a v4 slot0) served by a fake fetch, and property tests: the planner never returns a trade whose modelled profit is negative; the modelled profit matches a brute-force search within 1%; refusal cases. Provide a CLI "gap" that prints the two prices and the gap once. No secrets in code, no network calls in tests.`;

export const omniKeeperOrder = (c: OmniCoin) => ({
  key: `omni-keeper-${c.symbol.toLowerCase()}`,
  title: `${c.symbol} LP-sync keeper: gap monitor and trade planner`,
  what: "A read-only price-gap monitor between PumpSwap and the EVM v4 pool plus a trade planner that returns calls as data and never signs. Code only, delivered to GitHub.",
  action: "job.open" as const,
  intake: "job.open@job-1",
  body: { objective: omniKeeperObjective(c), shape: "chain", steps: [{ skill: "scaffold-project" }, { skill: "adversarial-review" }], github: true },
});
export { DEV, LZ };
