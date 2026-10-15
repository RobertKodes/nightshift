import { sha256, stringToBytes } from "viem";

/**
 * IMD's canonical JSON: sorted keys, no whitespace, integers only, no undefined. The quote approval
 * signs the SHA-256 of the exact payment payload in this form, so one differing byte fails it.
 */
export function canon(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(",")}}`;
  }
  if (typeof v === "number" && !Number.isInteger(v)) throw new Error(`canonical JSON allows integers only, got ${v}`);
  if (typeof v === "bigint") throw new Error("canonical JSON has no bigint; pass a decimal string");
  return JSON.stringify(v);
}

export function paymentHash(payment: unknown): `0x${string}` {
  return sha256(stringToBytes(canon(payment)));
}
