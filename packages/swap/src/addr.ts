import { sha256 } from "viem";
import { CHAINS, type ChainKey } from "./chains.js";

const BTC58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const XRP58 = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

/** Base58 bytes, null when a character is not in the alphabet. */
export function base58Decode(s: string, alphabet = BTC58): Uint8Array | null {
  let n = 0n;
  for (const ch of s) {
    const i = alphabet.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of s) { if (ch !== alphabet[0]) break; out.unshift(0); }
  return Uint8Array.from(out);
}

export function base58Encode(bytes: Uint8Array, alphabet = BTC58): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let s = "";
  while (n > 0n) { s = alphabet[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = alphabet[0] + s; }
  return s;
}

const hex = (b: Uint8Array) => `0x${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
const bytesOf = (h: string) => Uint8Array.from(h.slice(2).match(/../g)!.map((x) => parseInt(x, 16)));

export const isEvmAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
/** A Solana public key: base58 of exactly 32 bytes. */
export const isSolanaAddress = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) && base58Decode(a)?.length === 32;
/** A classic XRP Ledger address (r…): XRPL base58, version byte 0, 20-byte account id, double-SHA-256 checksum. */
export function isXrplAddress(a: string): boolean {
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a)) return false;
  const b = base58Decode(a, XRP58);
  if (!b || b.length !== 25 || b[0] !== 0) return false;
  const check = bytesOf(sha256(sha256(hex(b.slice(0, 21)))));
  return check.slice(0, 4).every((x, i) => x === b[21 + i]);
}
/** Whether `a` is an address on that chain. */
export function validAddress(c: ChainKey, a: string): boolean {
  const k = CHAINS[c].kind;
  return k === "evm" ? isEvmAddress(a) : k === "svm" ? isSolanaAddress(a) : isXrplAddress(a);
}
