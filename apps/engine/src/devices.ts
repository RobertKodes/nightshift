import { createHash, createPublicKey, verify as verifySig } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";

/**
 * The owner's phones. Each one holds an EC P-256 key in its Android Keystore that only signs after the
 * owner's fingerprint; the engine keeps the public half here, with the phone's push token and what it
 * wants to hear about. An approval from the app carries that key's signature over the exact spend.
 * A device id is the key's own fingerprint: the same phone registering again is the same device.
 */

export type DeviceKind = "approval" | "sale" | "result" | "warning";
export type DevicePrefs = Record<DeviceKind, boolean>;
export interface Device {
  id: string;
  owner: string;
  platform: "android";
  name: string;
  /** base64 DER SubjectPublicKeyInfo of the phone's P-256 key */
  pubKey: string;
  fcmToken: string | null;
  prefs: DevicePrefs;
  at: number;
  lastSeenAt: number;
}

export const MAX_DEVICES_PER_OWNER = 10;
/** How long a signed approval stays good: the owner just touched the sensor. */
export const APPROVAL_WINDOW_MS = 120_000;
export const DEFAULT_PREFS: DevicePrefs = { approval: true, sale: true, result: true, warning: true };

/** A key's id: the first 16 hex of SHA-256 over its DER bytes. */
export const deviceId = (pubKey: string) => createHash("sha256").update(Buffer.from(pubKey, "base64")).digest("hex").slice(0, 16);

/** The P-256 public key in `pubKey`, or null when it is anything else. */
export function p256(pubKey: string): ReturnType<typeof createPublicKey> | null {
  if (!/^[A-Za-z0-9+/=]{80,200}$/.test(pubKey)) return null;
  try {
    const k = createPublicKey({ key: Buffer.from(pubKey, "base64"), format: "der", type: "spki" });
    return k.asymmetricKeyType === "ec" && k.asymmetricKeyDetails?.namedCurve === "prime256v1" ? k : null;
  } catch { return null; }
}

/** An FCM registration token: long, URL-safe, with a colon after the instance id. */
export const fcmToken = (v: unknown): string | null => (typeof v === "string" && /^[\w:-]{100,400}$/.test(v) ? v : null);

/** What an approval signs: the company, the task, the price shown in cents, and the moment. */
export const approvalPayload = (companyId: string, taskId: string, costUsd: number, ts: number) =>
  `nightshift-approve|${companyId}|${taskId}|${costUsd.toFixed(2)}|${ts}`;

export class Devices {
  readonly #file: string;
  #list: Device[] | null = null;

  constructor(dataDir: string) { this.#file = join(dataDir, "devices.json"); }

  #all(): Device[] {
    if (this.#list) return this.#list;
    try { this.#list = existsSync(this.#file) ? (JSON.parse(readFileSync(this.#file, "utf8")) as Device[]) : []; } catch { this.#list = []; }
    return this.#list;
  }
  #save(): void { writeAtomic(this.#file, JSON.stringify(this.#all()), { mode: 0o600 }); }

  list(owner: string): Device[] { return this.#all().filter((d) => d.owner === owner.toLowerCase()); }
  get(owner: string, id: string): Device | null { return this.list(owner).find((d) => d.id === id) ?? null; }
  /** Every device of this owner that can be reached by push and wants this kind of note. */
  reach(owner: string, kind: DeviceKind): Device[] { return this.list(owner).filter((d) => d.fcmToken && d.prefs[kind]); }

  /**
   * Adds a phone, or updates the same phone (same key). A push token moves with its phone: if another
   * wallet had it, that entry loses it, so one phone never gets two wallets' notes.
   */
  register(owner: string, input: { pubKey: string; fcmToken?: unknown; name?: unknown; prefs?: unknown }, now = Date.now()): Device {
    const who = owner.toLowerCase();
    // Android's Base64 wraps lines unless told not to
    input = { ...input, pubKey: String(input.pubKey ?? "").replace(/\s+/g, "") };
    if (!p256(input.pubKey)) throw new Error("Not a P-256 public key.");
    const token = input.fcmToken === undefined || input.fcmToken === null ? null : fcmToken(input.fcmToken);
    if (input.fcmToken && !token) throw new Error("Not a push token.");
    const id = deviceId(input.pubKey);
    const all = this.#all();
    const old = all.find((d) => d.id === id);
    if (old && old.owner !== who) throw new Error("This device key belongs to another wallet; sign out on the phone and sign in again.");
    if (!old && this.list(who).length >= MAX_DEVICES_PER_OWNER) throw new Error(`One wallet can register ${MAX_DEVICES_PER_OWNER} devices; remove one first.`);
    if (token) for (const d of all) if (d.id !== id && d.fcmToken === token) d.fcmToken = null;
    const name = typeof input.name === "string" ? input.name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) : "";
    const d: Device = old ?? { id, owner: who, platform: "android", name: name || "Android phone", pubKey: input.pubKey, fcmToken: null, prefs: { ...DEFAULT_PREFS }, at: now, lastSeenAt: now };
    if (name) d.name = name;
    if (token || input.fcmToken === null) d.fcmToken = token;
    d.prefs = prefsOf(input.prefs, d.prefs);
    d.lastSeenAt = now;
    if (!old) all.push(d);
    this.#save();
    return d;
  }

  /** Changes what a device hears about, or its push token. */
  update(owner: string, id: string, patch: { fcmToken?: unknown; prefs?: unknown; name?: unknown }): Device | null {
    const d = this.get(owner, id);
    if (!d) return null;
    if (patch.fcmToken !== undefined) {
      const t = patch.fcmToken === null ? null : fcmToken(patch.fcmToken);
      if (patch.fcmToken !== null && !t) throw new Error("Not a push token.");
      if (t) for (const x of this.#all()) if (x !== d && x.fcmToken === t) x.fcmToken = null;
      d.fcmToken = t;
    }
    if (patch.prefs !== undefined) d.prefs = prefsOf(patch.prefs, d.prefs);
    if (typeof patch.name === "string" && patch.name.trim()) d.name = patch.name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
    this.#save();
    return d;
  }

  /** Removes a phone: its key no longer approves anything and it gets no more notes. */
  remove(owner: string, id: string): boolean {
    const all = this.#all(), i = all.findIndex((d) => d.owner === owner.toLowerCase() && d.id === id);
    if (i < 0) return false;
    all.splice(i, 1);
    this.#save();
    return true;
  }

  /** Every device of a wallet, when the account is deleted. */
  removeAll(owner: string): number {
    const before = this.#all().length;
    this.#list = this.#all().filter((d) => d.owner !== owner.toLowerCase());
    if (this.#list.length !== before) this.#save();
    return before - this.#list.length;
  }

  /** A token FCM says is gone (app removed, data cleared): no more sends to it. */
  dropToken(token: string): void {
    let changed = false;
    for (const d of this.#all()) if (d.fcmToken === token) { d.fcmToken = null; changed = true; }
    if (changed) this.#save();
  }

  /**
   * Checks an approval signed on a phone: a device of this owner, a fresh timestamp, the price the
   * owner was shown, and a valid ECDSA P-256 / SHA-256 signature (DER, as Android's Keystore makes it).
   */
  checkApproval(owner: string, a: { deviceId: string; sig: string; ts: number; companyId: string; taskId: string; costUsd: number }, now = Date.now()): { ok: true; device: Device } | { ok: false; error: string } {
    const d = this.get(owner, a.deviceId);
    if (!d) return { ok: false, error: "This phone is not registered for this wallet. Sign in again on the phone." };
    if (!Number.isFinite(a.ts) || Math.abs(now - a.ts) > APPROVAL_WINDOW_MS) return { ok: false, error: "The approval expired; touch the sensor again." };
    const key = p256(d.pubKey), sig = String(a.sig ?? "").replace(/\s+/g, "");
    let good = false;
    try { good = Boolean(key) && /^[A-Za-z0-9+/=]{60,200}$/.test(sig) && verifySig("sha256", Buffer.from(approvalPayload(a.companyId, a.taskId, a.costUsd, a.ts)), key!, Buffer.from(sig, "base64")); } catch { good = false; }
    if (!good) return { ok: false, error: "The phone's signature does not match this approval." };
    d.lastSeenAt = now;
    this.#save();
    return { ok: true, device: d };
  }
}

function prefsOf(v: unknown, base: DevicePrefs): DevicePrefs {
  if (!v || typeof v !== "object") return base;
  const out = { ...base };
  for (const k of Object.keys(DEFAULT_PREFS) as DeviceKind[]) { const x = (v as Record<string, unknown>)[k]; if (typeof x === "boolean") out[k] = x; }
  return out;
}

/** The public view of a device: never the push token. */
export const deviceView = (d: Device) => ({ id: d.id, name: d.name, platform: d.platform, push: Boolean(d.fcmToken), prefs: d.prefs, at: d.at, lastSeenAt: d.lastSeenAt });
