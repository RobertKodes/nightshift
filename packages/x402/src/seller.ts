import {
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type WalletClient,
  encodeFunctionData,
  parseSignature,
  verifyTypedData,
} from "viem";

/**
 * x402 "exact" scheme over EIP-3009 (USDC transferWithAuthorization). The seller can settle it itself:
 * the company verifies the buyer's signed authorization and submits it from its own wallet. A
 * facilitator (facilitator.ts) can submit it instead; either way the authorization names the
 * company's wallet, so the money only ever moves from the buyer to the company.
 */

export const USDC: Record<number, { address: Address; name: string; version: string }> = {
  8453: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2" },
  84532: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", name: "USDC", version: "2" },
};

export interface Requirement {
  scheme: "exact";
  network: string;
  asset: Address;
  /** USDC base units (6 decimals). */
  amount: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
}

/** What is being sold. serviceName, tags and iconUrl are what the CDP Bazaar shows next to a listing. */
export interface Resource {
  url: string;
  description: string;
  mimeType: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
}

export interface Challenge {
  x402Version: 2;
  error?: string;
  resource: Resource;
  accepts: Requirement[];
  /** x402 v2 extensions, such as "bazaar" (the discovery metadata the CDP facilitator indexes). */
  extensions?: Record<string, unknown>;
}

/** One sellable resource as its 402 challenge advertises it: the terms, what it is, and its extensions. */
export interface Offer {
  requirement: Requirement;
  resource: Resource;
  extensions?: Record<string, unknown>;
}

export interface Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface PaymentPayload {
  x402Version: 2;
  accepted: Requirement;
  payload: { signature: Hex; authorization: Authorization };
  /** Echoed from the challenge by x402 v2 clients; the seller sets its own before a facilitator sees it. */
  resource?: Resource;
  extensions?: Record<string, unknown>;
}

export function requirement(chainId: number, payTo: Address, amountUsdc: bigint, maxTimeoutSeconds = 300): Requirement {
  const usdc = USDC[chainId];
  if (!usdc) throw new Error(`no USDC configured for chain ${chainId}`);
  // a zero or negative price would be met by an authorization for nothing
  if (amountUsdc <= 0n) throw new Error("price must be more than zero");
  return {
    scheme: "exact",
    network: `eip155:${chainId}`,
    asset: usdc.address,
    amount: amountUsdc.toString(),
    payTo,
    maxTimeoutSeconds,
    extra: { name: usdc.name, version: usdc.version },
  };
}

export function challenge(req: Requirement, resource: Resource, error?: string, extensions?: Record<string, unknown>): Challenge {
  return { x402Version: 2, ...(error ? { error } : {}), resource, accepts: [req], ...(extensions ? { extensions } : {}) };
}

export const encodeHeader = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64");
export function decodeHeader<T>(h: string): T {
  return JSON.parse(Buffer.from(h, "base64").toString("utf8")) as T;
}

const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type VerifyResult = { ok: true; payer: Address; value: bigint } | { ok: false; reason: string };

/** An authorization valid for longer than this ahead is refused. */
export const MAX_VALID_SECONDS = 3_600;

/** Checks the buyer's signed authorization against what this resource asks for. Pure, no chain call. */
export async function verifyPayment(p: PaymentPayload, req: Requirement, nowSec = Math.floor(Date.now() / 1000)): Promise<VerifyResult> {
  if (p?.x402Version !== 2 || !p.payload?.authorization || !p.payload.signature) return { ok: false, reason: "invalid_payload" };
  const a = p.payload.authorization;
  if (p.accepted?.network !== req.network || p.accepted?.asset?.toLowerCase() !== req.asset.toLowerCase()) return { ok: false, reason: "wrong_network_or_asset" };
  if (a.to.toLowerCase() !== req.payTo.toLowerCase()) return { ok: false, reason: "wrong_recipient" };
  if (BigInt(a.value) < BigInt(req.amount)) return { ok: false, reason: "insufficient_amount" };
  if (BigInt(a.validAfter) > BigInt(nowSec)) return { ok: false, reason: "not_yet_valid" };
  if (BigInt(a.validBefore) < BigInt(nowSec + 6)) return { ok: false, reason: "expired" };
  // a long-lived authorization is a standing claim on the payer's USDC for whoever holds it
  if (BigInt(a.validBefore) > BigInt(nowSec + MAX_VALID_SECONDS)) return { ok: false, reason: "valid_too_long" };
  const chainId = Number(req.network.split(":")[1]);
  const valid = await verifyTypedData({
    address: a.from,
    domain: { name: req.extra.name, version: req.extra.version, chainId, verifyingContract: req.asset },
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
    signature: p.payload.signature,
  });
  return valid ? { ok: true, payer: a.from, value: BigInt(a.value) } : { ok: false, reason: "invalid_signature" };
}

export const USDC_ABI = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [{ name: "authorizer", type: "address" }, { name: "nonce", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "AuthorizationUsed",
    inputs: [{ name: "authorizer", type: "address", indexed: true }, { name: "nonce", type: "bytes32", indexed: true }],
  },
] as const;

/** The calldata that settles a payment: transferWithAuthorization with the buyer's signature. */
export function settlementData(p: PaymentPayload): Hex {
  const a = p.payload.authorization;
  const { v, r, s, yParity } = parseSignature(p.payload.signature);
  return encodeFunctionData({
    abi: USDC_ABI,
    functionName: "transferWithAuthorization",
    args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, Number(v ?? BigInt(yParity + 27)), r, s],
  });
}

/** Submits the authorization from the seller's own wallet and waits for it to land. */
export async function settlePayment(p: PaymentPayload, wallet: WalletClient, publicClient: PublicClient, account: LocalAccount): Promise<Hex> {
  const a = p.payload.authorization;
  const { v, r, s, yParity } = parseSignature(p.payload.signature);
  const hash = await wallet.writeContract({
    account,
    chain: wallet.chain ?? null,
    address: p.accepted.asset,
    abi: USDC_ABI,
    functionName: "transferWithAuthorization",
    args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, Number(v ?? BigInt(yParity + 27)), r, s],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`settlement reverted: ${hash}`);
  return hash;
}

/** Signs a payment for a requirement: what a buying agent (or a test) does. */
export async function signPayment(buyer: LocalAccount, req: Requirement, nowSec = Math.floor(Date.now() / 1000), nonce?: Hex): Promise<PaymentPayload> {
  const chainId = Number(req.network.split(":")[1]);
  const authorization: Authorization = {
    from: buyer.address,
    to: req.payTo,
    value: req.amount,
    validAfter: String(nowSec - 5),
    validBefore: String(nowSec + req.maxTimeoutSeconds),
    nonce: nonce ?? (`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as Hex),
  };
  const signature = await buyer.signTypedData({
    domain: { name: req.extra.name, version: req.extra.version, chainId, verifyingContract: req.asset },
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
  });
  return { x402Version: 2, accepted: req, payload: { signature, authorization } };
}
