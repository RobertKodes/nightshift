/**
 * The IMD order behind Token Deals (launch.open, evm_contracts on Ethereum): an escrow where anyone sells
 * any ERC-20 at a fixed price, part or all of it. The buyer pays the fee on top, so the seller gets the full
 * price; the fee goes to the FeeSplitter, which shares it like every other NIGHTSHIFT fee (40% rewards,
 * 20% burned, 20% dev, 20% treasury). Holders pay the lower fee with a short-lived pass the server signs.
 */
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const SPLITTER = "0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44";
export const DEAL_COINS = [
  { symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6, cap: "2500" },
  { symbol: "USDT", address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6, cap: "2500" },
  { symbol: "IMD", address: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7", decimals: 18, cap: "500" },
  { symbol: "SHIFT", address: "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac", decimals: 18, cap: "40000000" },
];
export const DEAL_FEE_BPS = 100, DEAL_HOLDER_FEE_BPS = 50, DEAL_MAX_FEE_BPS = 200;
const coins = DEAL_COINS.map((c) => `${c.symbol} ${c.address} (${c.decimals} decimals, cap ${c.cap})`).join(", ");

export const DEALS_OBJECTIVE = `Build and deploy TokenDeals on Ethereum: an escrow desk where anyone sells any ERC-20 token to anyone at a fixed price, all or part of it. The seller deposits the tokens into the contract and opens a deal; each buy settles in one transaction: tokens to the buyer, the full price to the seller, and a fee the buyer pays on top of the price to the NIGHTSHIFT FeeSplitter ${SPLITTER} (fixed forever, accepts ETH and any ERC-20). Nobody, the owner included, can ever move escrowed tokens or payments.

Payment coins: ETH (address(0)) and an allowlist set at deploy: ${coins}. Every payment coin is a plain ERC-20 without transfer fees; use SafeERC20 (USDT returns no bool). Per-buy cap on the total paid, in whole coins: ETH 1 and the caps above; setMaxPay(coin, max) changes a cap (0 = no cap); setPayCoin(coin, allowed) adds or removes a coin; removing only stops new deals in it.

Price: each deal has price = payment-coin base units per 1e18 base units of the sold token. cost(amount) = Math.mulDiv(amount, price, 1e18, Rounding.Ceil). fee = cost * bps / 10000 rounded down, where bps is feeBps (${DEAL_FEE_BPS} at deploy) or holderFeeBps (${DEAL_HOLDER_FEE_BPS}) for holders. MAX_FEE_BPS = ${DEAL_MAX_FEE_BPS} is a constant; setFees(feeBps, holderFeeBps) requires holderFeeBps <= feeBps <= MAX_FEE_BPS.

Holder pass: EIP-712, domain name "TokenDeals", version "1", chainId, this contract; struct HolderPass(address recipient, uint64 expiry), signed by passSigner (set by the owner with setPassSigner). An empty pass means the normal fee. A non-empty pass must be signed by passSigner for this recipient, not expired, and expire at most 24 hours after block.timestamp, or the buy reverts.

Functions:
1. open(address token, uint256 amount, address payCoin, uint256 price, uint256 minBuy, uint64 expiry, address buyer) returns (uint256 dealId): token has code and is not payCoin; payCoin is allowed; amount > 0, price > 0; expiry after block.timestamp and at most 365 days ahead; buyer = address(0) for a public deal, or the only address that may receive this deal. transferFrom the seller; the deal holds what actually arrived (balance after minus before), so tokens with a transfer tax work; reverts if nothing arrived. minBuy <= that amount. Deal ids count up from 1. Emits DealOpened.
2. buy(uint256 dealId, uint256 amount, address recipient, uint256 maxTotal, uint64 passExpiry, bytes pass) payable: deal open and not expired; recipient != address(0) and equal to the deal's buyer if one is set; 0 < amount <= left and amount >= minBuy unless amount == left (the rest may always be bought); total = cost + fee <= maxTotal and within the coin's cap. msg.sender may differ from recipient, so cross-chain services (Relay, LI.FI) can buy for a user. ETH deals: msg.value must equal total. Coin deals: msg.value must be 0 and total is pulled from msg.sender. Then left -= amount (closed at 0), amount of the token goes to recipient, cost to the seller, fee to the FeeSplitter. If an ETH transfer to the seller or the FeeSplitter fails, the amount is credited to owed[that address] and the buy still succeeds. Emits Bought (holder = a valid pass was used).
3. update(uint256 dealId, uint256 price, uint256 minBuy, uint64 expiry): seller only, open deal, same rules as open; buyers are protected by maxTotal. Emits DealUpdated.
4. cancel(uint256 dealId): seller only, any time, also when expired or paused: sends left back to the seller and closes the deal. Emits DealCancelled(dealId, returned).
5. claimOwed(): sends the caller's owed ETH. Emits OwedClaimed.
6. Views: deals(dealId) returning (address seller, address token, address payCoin, uint256 held, uint256 left, uint256 price, uint256 minBuy, uint64 expiry, address buyer, bool open), held being what arrived at open; dealCount(); quote(dealId, amount, bool holder) returning cost, fee, total; payCoin(address); maxPay(address); feeBps(); holderFeeBps(); passSigner(); owed(address); FEE_TO().

Events, exactly these signatures: DealOpened(uint256 indexed dealId, address indexed seller, address indexed token, address payCoin, uint256 held, uint256 price, uint256 minBuy, uint64 expiry, address buyer); Bought(uint256 indexed dealId, address indexed payer, address indexed recipient, uint256 amount, uint256 cost, uint256 fee, bool holder); DealUpdated(uint256 indexed dealId, uint256 price, uint256 minBuy, uint64 expiry); DealCancelled(uint256 indexed dealId, uint256 returned); OwedClaimed(address indexed account, uint256 amount); FeesSet(uint256 feeBps, uint256 holderFeeBps); PassSignerSet(address signer); PayCoinSet(address indexed coin, bool allowed); MaxPaySet(address indexed coin, uint256 max).

Owner: ${DEV}. The owner can only call setFees within the cap, setPassSigner, setPayCoin, setMaxPay, and pause/unpause, which stops open, update and buy only (cancel and claimOwed always work). The owner can never move, take or redirect escrowed tokens or payments, change FEE_TO, or close someone's deal. No upgradeability, no delegatecall, no selfdestruct, no token sweeping; tokens sent outside open stay in the contract. Rebasing tokens are not supported. Reentrancy-safe (checks-effects-interactions plus a guard on every state-changing function), SafeERC20, Solidity 0.8.x, NatSpec on every external function, events for every state change.

Tests (Foundry): full flows paying in ETH, a 6-decimal coin, a no-bool-return coin like USDT and an 18-decimal coin; partial buys, buying the rest below minBuy, private deals, buys for another recipient; exact cost and fee maths with rounding at odd prices and amounts, 1% and 0.5% with a pass; maxTotal, caps, wrong msg.value, ETH sent to a coin deal; expired, cancelled, closed and unknown deals; a sold token with a 2% transfer tax; update and cancel by non-sellers refused; cancel while paused; a seller contract that rejects ETH (owed, then claimOwed); reentrancy from a malicious token, a malicious seller and a malicious recipient; passes with a wrong signer, recipient, chain or contract, expired or too far ahead; fee changes above the cap refused; owner unable to move funds; fuzz and invariant tests that for every token the contract holds at least the sum of left over its open deals, the seller gets exactly cost and the FeeSplitter exactly fee on every buy.`;

export const DEALS_ORDER = {
  key: "token-deals",
  title: "Token Deals escrow (OTC desk)",
  what: `Builds, tests, audits (4 auditors + judge) and deploys on Ethereum the Token Deals escrow: sellers lock any token at a fixed price, buyers take all or part of it, and each buy pays the seller in full in one transaction. The buyer pays ${DEAL_FEE_BPS / 100}% on top (holders ${DEAL_HOLDER_FEE_BPS / 100}%, never above ${DEAL_MAX_FEE_BPS / 100}%) to the FeeSplitter. Sellers can always cancel and take their tokens back; nobody, us included, can take a deal's tokens or payments.`,
  action: "launch.open" as const,
  intake: "launch.open@launch-1",
  body: { objective: DEALS_OBJECTIVE, onchain: "evm_contracts", chainId: 1, owner: DEV },
};
