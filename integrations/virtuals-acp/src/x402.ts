import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import type { Signer } from "./client.ts";

/** The operator funds this Base USDC wallet separately from the ACP escrow. */
export function x402Signer(key: string): Signer {
  if (!/^0x[\da-f]{64}$/i.test(key)) throw new Error("NIGHTSHIFT_X402_PRIVATE_KEY must be a funded wallet key.");
  const account = privateKeyToAccount(key as `0x${string}`);
  return async (req, ctx) => {
    if (req.scheme !== "exact" || req.network !== "eip155:8453" || req.asset.toLowerCase() !== "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" || req.extra?.name !== "USD Coin" || req.extra.version !== "2" || !/^0x[\da-f]{40}$/i.test(req.payTo) || !/^[1-9]\d*$/.test(req.amount)) throw new Error("Refused non-USDC or invalid x402 terms.");
    const now = Math.floor(Date.now() / 1000), authorization = { from: account.address, to: req.payTo, value: req.amount, validAfter: String(Math.max(0, now - 5)), validBefore: String(now + Math.min(300, req.maxTimeoutSeconds ?? 60)), nonce: `0x${randomBytes(32).toString("hex")}` };
    const signature = await account.signTypedData({ domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: req.asset as `0x${string}` }, primaryType: "TransferWithAuthorization", types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] }, message: { from: account.address, to: req.payTo as `0x${string}`, value: BigInt(req.amount), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce: authorization.nonce as `0x${string}` } });
    return Buffer.from(JSON.stringify({ x402Version: 2, resource: ctx.resource, accepted: req, payload: { signature, authorization } })).toString("base64");
  };
}
