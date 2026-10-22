/**
 * The five chains of the NIGHTSHIFT multichain swap, with each provider's own id for them (docs/swap/RESEARCH.md,
 * read from LI.FI's and Relay's chain lists on 2026-10-22). Pinned here, in the page and the server alike.
 */
export type ChainKey = "eth" | "base" | "rh" | "sol" | "xrpl";
export type ChainKind = "evm" | "svm" | "xrpl";
export type Chain = {
  key: ChainKey;
  name: string;
  kind: ChainKind;
  /** EVM chain id. */
  evmId?: number;
  /** LI.FI's chain id, where LI.FI covers the chain. */
  lifi?: number;
  /** Relay's chain id. */
  relay?: number;
  native: { symbol: string; name: string; decimals: number; address: string; logo: string };
  /** Explorer links: a transaction, an address. */
  tx: string;
  addr: string;
  /** A public RPC the browser may read (CORS open, checked 2026-10-22). */
  rpc?: string;
};

export const NATIVE_EVM = "0x0000000000000000000000000000000000000000";
export const NATIVE_SOL = "11111111111111111111111111111111";
export const NATIVE_XRP = "xrp";
export const LIFI_SOLANA = 1151111081099710;
export const RELAY_SOLANA = 792703809;
export const RELAY_XRPL = 537724;

const TW = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";
const eth = () => ({ symbol: "ETH", name: "Ether", decimals: 18, address: NATIVE_EVM, logo: `${TW}/ethereum/info/logo.png` });

export const CHAINS: Record<ChainKey, Chain> = {
  eth: { key: "eth", name: "Ethereum", kind: "evm", evmId: 1, lifi: 1, relay: 1, native: eth(), tx: "https://etherscan.io/tx/", addr: "https://etherscan.io/address/", rpc: "https://ethereum-rpc.publicnode.com" },
  base: { key: "base", name: "Base", kind: "evm", evmId: 8453, lifi: 8453, relay: 8453, native: eth(), tx: "https://basescan.org/tx/", addr: "https://basescan.org/address/", rpc: "https://mainnet.base.org" },
  rh: { key: "rh", name: "Robinhood Chain", kind: "evm", evmId: 4663, lifi: 4663, relay: 4663, native: eth(), tx: "https://robin.etherscan.io/tx/", addr: "https://robin.etherscan.io/address/", rpc: "https://rpc.mainnet.chain.robinhood.com" },
  sol: { key: "sol", name: "Solana", kind: "svm", lifi: LIFI_SOLANA, relay: RELAY_SOLANA, native: { symbol: "SOL", name: "Solana", decimals: 9, address: NATIVE_SOL, logo: `${TW}/solana/info/logo.png` }, tx: "https://solscan.io/tx/", addr: "https://solscan.io/account/", rpc: "https://solana-rpc.publicnode.com" },
  xrpl: { key: "xrpl", name: "XRP Ledger", kind: "xrpl", relay: RELAY_XRPL, native: { symbol: "XRP", name: "XRP", decimals: 6, address: NATIVE_XRP, logo: `${TW}/ripple/info/logo.png` }, tx: "https://xrpscan.com/tx/", addr: "https://xrpscan.com/account/" },
};
export const CHAIN_ORDER: ChainKey[] = ["eth", "base", "rh", "sol", "xrpl"];
export const isChain = (k: unknown): k is ChainKey => typeof k === "string" && k in CHAINS;
export const chainByLifi = (id: number | undefined) => CHAIN_ORDER.find((k) => CHAINS[k].lifi === id) ?? null;
export const chainByRelay = (id: number | undefined) => CHAIN_ORDER.find((k) => CHAINS[k].relay === id) ?? null;
export const chainByEvm = (id: number | undefined) => CHAIN_ORDER.find((k) => CHAINS[k].evmId === id) ?? null;

/**
 * Paying out of the XRP Ledger is not offered yet: the site's wallet layer has no XRPL wallet, and the deposit
 * is a memo-tagged payment to an XRPL account the provider controls, not tested here with real XRP.
 */
export const XRPL_SOURCE_SOON = "Swapping out of XRP is coming soon: it needs an XRP Ledger wallet in the page (GemWallet, Crossmark or Xaman) and a payment with a memo to Relay's XRPL account, which NIGHTSHIFT has not yet tested with real XRP. Swapping into XRP works now.";

export type Token = {
  chain: ChainKey;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
  priceUsd?: number | null;
  /** On the provider's verified list, a chain's native coin, or pinned by NIGHTSHIFT. */
  verified: boolean;
  pinned?: boolean;
};

export const SHIFT_TOKEN = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";
export const IMD_ETH = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
export const IMD_RH = "0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127";

export const nativeToken = (c: ChainKey): Token => ({ chain: c, ...CHAINS[c].native, verified: true, pinned: true });
/** NIGHTSHIFT's own tokens, first in every list: $SHIFT on Ethereum, IMD on Ethereum and on Robinhood Chain. */
export const PINNED: Token[] = [
  { chain: "eth", address: SHIFT_TOKEN, symbol: "SHIFT", name: "NIGHTSHIFT", decimals: 18, logo: "/brand/shift-icon-512.png", verified: true, pinned: true },
  { chain: "eth", address: IMD_ETH, symbol: "IMD", name: "Identity.md", decimals: 18, verified: true, pinned: true },
  { chain: "rh", address: IMD_RH, symbol: "IMD", name: "Identity.md", decimals: 18, verified: true, pinned: true },
];
export const pinnedOn = (c: ChainKey): Token[] => [nativeToken(c), ...PINNED.filter((t) => t.chain === c)];
export const sameAddress = (a: string, b: string) => (a.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b);
export const isNative = (c: ChainKey, address: string) => sameAddress(CHAINS[c].native.address, address);
