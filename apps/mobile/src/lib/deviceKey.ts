import * as Crypto from "expo-crypto";
import { DeviceKey, DeviceKeyError } from "../../modules/device-key";

/**
 * This phone's approval key: an EC P-256 key made inside the Android Keystore (StrongBox when the phone
 * has one), usable only right after a strong fingerprint or face check. The engine keeps its public
 * half; an approval is this key's signature over the company, the task, the price and the moment.
 */

const ALIAS = "nightshift.approvals.v1";

/** The key's id as the engine computes it: the first 16 hex of SHA-256 over the public key's DER bytes. */
export async function fingerprint(pubKey: string): Promise<string> {
  const bin = atob(pubKey.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const digest = new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The phone's key, made the first time. */
export async function ensureKey(): Promise<{ pubKey: string; id: string }> {
  let pub = (await DeviceKey.hasKey(ALIAS)) ? await DeviceKey.getPublicKey(ALIAS) : null;
  if (!pub) pub = (await DeviceKey.createKey(ALIAS)).publicKey;
  const pubKey = pub.replace(/\s+/g, "");
  return { pubKey, id: await fingerprint(pubKey) };
}

/** A new key, when the old one stopped working (a fingerprint was added or removed on the phone). */
export async function replaceKey(): Promise<{ pubKey: string; id: string }> {
  await DeviceKey.deleteKey(ALIAS).catch(() => false);
  return ensureKey();
}

export const forgetKey = () => DeviceKey.deleteKey(ALIAS).catch(() => false);

/** Can this phone sign approvals at all: a strong fingerprint or face enrolled. */
export const readiness = () => DeviceKey.canSign().catch(() => "UNAVAILABLE" as const);

/** What the approval signs: exactly what the engine checks (apps/engine/src/devices.ts). */
export const approvalPayload = (companyId: string, taskId: string, costUsd: number, ts: number) => `nightshift-approve|${companyId}|${taskId}|${costUsd.toFixed(2)}|${ts}`;

/**
 * Asks for the fingerprint and signs the approval. Throws DeviceKeyError: CANCELLED when the owner
 * backed out, KEY_INVALIDATED when the phone's fingerprints changed (a new key must be registered).
 */
export async function signApproval(a: { companyId: string; taskId: string; costUsd: number; company: string }): Promise<{ deviceId: string; signature: string; ts: number; costUsd: number }> {
  const { id } = await ensureKey();
  const ts = Date.now();
  const cost = Math.round(a.costUsd * 100) / 100;
  const r = await DeviceKey.sign(ALIAS, approvalPayload(a.companyId, a.taskId, cost, ts), `Approve $${cost.toFixed(2)}`, `for ${a.company}`);
  return { deviceId: id, signature: r.signature.replace(/\s+/g, ""), ts, costUsd: cost };
}

/** The owner's words for what went wrong with the fingerprint, or null when they simply cancelled. */
export function keyProblem(e: unknown): string | null {
  if (!(e instanceof DeviceKeyError)) return (e as Error)?.message ?? "Something went wrong.";
  switch (e.code) {
    case "CANCELLED": return null;
    case "LOCKOUT": return "Too many tries. Unlock the phone with its PIN, then try again.";
    case "NO_BIOMETRICS": return "Set up a fingerprint or face unlock in the phone's settings to approve spending.";
    case "KEY_INVALIDATED": return "The phone's fingerprints changed, so its approval key was switched off. Register this phone again in Settings.";
    case "NO_KEY": return "This phone has no approval key yet. Sign in again to make one.";
    default: return e.message;
  }
}

export { DeviceKeyError };
