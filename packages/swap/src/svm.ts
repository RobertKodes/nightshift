import { base58Encode } from "./addr.js";

/**
 * Reads a serialized Solana transaction (legacy or v0, base64, as LI.FI returns it) far enough to see who pays
 * and signs and which programs it invokes. Invoked programs are always static account keys (a lookup table
 * cannot supply one), so this list is complete.
 */
export type SvmSummary = { version: "legacy" | 0; payer: string; signers: string[]; programs: string[]; lookupTables: string[]; instructions: number };

export function readSvmTransaction(base64: string): SvmSummary {
  const b = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  let i = 0;
  const need = (n: number) => { if (i + n > b.length) throw new Error("The Solana transaction is cut short."); };
  const u8 = () => { need(1); return b[i++]!; };
  const cu16 = () => { let v = 0, s = 0; for (;;) { const x = u8(); v |= (x & 0x7f) << s; if (!(x & 0x80)) return v; s += 7; if (s > 14) throw new Error("Bad length in the Solana transaction."); } };
  const take = (n: number) => { need(n); const s = b.subarray(i, i + n); i += n; return s; };
  const sigs = cu16();
  take(sigs * 64);
  const first = u8();
  const versioned = (first & 0x80) !== 0;
  if (versioned && (first & 0x7f) !== 0) throw new Error(`Solana transaction version ${first & 0x7f} is not supported.`);
  const required = versioned ? u8() : first;
  u8(); u8(); // read-only signed and unsigned counts
  const keys = Array.from({ length: cu16() }, () => base58Encode(take(32)));
  take(32); // recent blockhash
  const programs = new Set<string>();
  const ixs = cu16();
  for (let n = 0; n < ixs; n++) {
    const p = u8();
    if (p >= keys.length) throw new Error("A Solana instruction calls a program that is not a static key.");
    programs.add(keys[p]!);
    take(cu16()); // account indexes
    take(cu16()); // data
  }
  const lookupTables: string[] = [];
  if (versioned) {
    const n = cu16();
    for (let t = 0; t < n; t++) { lookupTables.push(base58Encode(take(32))); take(cu16()); take(cu16()); }
  }
  if (!keys[0]) throw new Error("The Solana transaction has no fee payer.");
  return { version: versioned ? 0 : "legacy", payer: keys[0], signers: keys.slice(0, required), programs: [...programs], lookupTables, instructions: ixs };
}
