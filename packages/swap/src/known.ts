import type { ChainKey } from "./chains.js";

/**
 * The only contracts a swap may call or be allowed to spend, per chain, pinned in the code (read from LI.FI's
 * `/v1/chains` and Relay's `/chains` on 2026-10-22, see docs/swap/RESEARCH.md). A route whose transaction goes
 * anywhere else is refused, whatever the provider or our server says.
 */
const LIFI_DIAMOND = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";
const LIFI_PERMIT2_PROXY = "0x89c6340b1a1f4b25d36cd8b063d49045caf3f818";
const RELAY: Record<string, string> = {
  "0x4cd00e387622c35bddb9b4c962c136462338bc31": "Relay depository",
  "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f": "Relay ERC-20 router",
  "0xccc88a9d1b4ed6b0eaba998850414b24f1c315be": "Relay approval proxy",
  "0x0729e2a4716d9f7dd17858d5d504426d228697f7": "Relay ERC-20 router v3.2",
  "0x5567954cd026cebfe486062cb75848e0f1c12e58": "Relay approval proxy v3.2",
};
const RELAY_L1: Record<string, string> = { ...RELAY, "0xa5f565650890fba1824ee0f21ebbbf660a179934": "Relay receiver", "0x0000000000002bdbf1bf3279983603ec279cc6df": "Relay multicaller" };

export const KNOWN_EVM: Record<"eth" | "base" | "rh", Record<string, string>> = {
  eth: { [LIFI_DIAMOND]: "LI.FI Diamond", [LIFI_PERMIT2_PROXY]: "LI.FI Permit2 proxy", ...RELAY_L1 },
  base: { [LIFI_DIAMOND]: "LI.FI Diamond", [LIFI_PERMIT2_PROXY]: "LI.FI Permit2 proxy", ...RELAY_L1 },
  rh: { "0xb477751b76cf82d00a686a1232f5fcd772414af3": "LI.FI Diamond", "0x8eabb4e117fb70b346592e013855f6d825f50af1": "LI.FI Permit2 proxy", ...RELAY },
};

/**
 * Solana programs a swap transaction may invoke. The labels of the last four come from the route LI.FI named
 * when they appeared (2026-10-22): plausible, not confirmed by their teams.
 */
export const KNOWN_SVM: Record<string, string> = {
  "11111111111111111111111111111111": "System program",
  ComputeBudget111111111111111111111111111111: "Compute budget",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated token accounts",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo",
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter v6",
  "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2": "Relay depository",
  "3i5JeuZuUxeKtVysUnwQNGerJP2bSMX9fTFfS4Nxe3Br": "LI.FI fee step",
  D8C8iW6zmoKg5TRr8nQ7h14TMWqQX8FiBdj2ju5MF3wa: "Mayan FastMCTP",
  proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u: "OKX DEX router",
};

/** The label of a contract or program we know on that chain, null for any other. */
export function knownContract(chain: ChainKey, address: string): string | null {
  if (chain === "sol") return KNOWN_SVM[address] ?? null;
  if (chain === "xrpl") return null;
  return KNOWN_EVM[chain][address.toLowerCase()] ?? null;
}
