import { createSign } from "node:crypto";
import { readSettings } from "./settings.js";

/**
 * Notes to the owner's phones over Firebase Cloud Messaging (HTTP v1). The server signs in as a
 * Google service account (its JSON pasted in /setup, never printed) and sends data messages in the
 * shape the app's notification library presents by itself, so a note shows even when the app is
 * closed. A note carries ids and a line of text: opening it only opens the app, it never approves.
 */

export interface ServiceAccount { project_id: string; client_email: string; private_key: string; token_uri?: string }
export interface FcmNote {
  /** approval: high priority, with Review / Decline; the rest arrive normally */
  kind: "approval" | "sale" | "result" | "warning";
  title: string;
  body: string;
  /** where a tap goes, inside the app: nightshift://approve/<company>/<task> and the like */
  url: string;
  companyId: string;
  taskId?: string;
  /** one note per subject on the phone: a newer one replaces it */
  tag?: string;
}
export type Transport = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; json: () => Promise<unknown> }>;

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** The service account from FCM_SERVICE_ACCOUNT (the environment, else /setup), or null when push is not set up. */
export function serviceAccount(raw = process.env.FCM_SERVICE_ACCOUNT || String(readSettings().FCM_SERVICE_ACCOUNT ?? "")): ServiceAccount | null {
  if (!raw.trim()) return null;
  try {
    const a = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!a.project_id || !a.client_email || !a.private_key?.includes("PRIVATE KEY")) return null;
    return { project_id: a.project_id, client_email: a.client_email, private_key: a.private_key, ...(a.token_uri ? { token_uri: a.token_uri } : {}) };
  } catch { return null; }
}

export class Fcm {
  #token: { value: string; exp: number } | null = null;
  readonly #send: Transport;
  readonly #account: () => ServiceAccount | null;
  /** Called with a token FCM says no longer exists, so it is never sent to again. */
  onGone: (token: string) => void = () => {};

  constructor(opts: { account?: () => ServiceAccount | null; transport?: Transport } = {}) {
    this.#account = opts.account ?? (() => cached());
    this.#send = opts.transport ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }));
  }

  get ready(): boolean { return this.#account() !== null; }

  /** A short-lived OAuth token for FCM, from a JWT the service account signs (RS256). Kept until a minute before it ends. */
  async #accessToken(a: ServiceAccount, now = Date.now()): Promise<string> {
    if (this.#token && this.#token.exp - 60_000 > now) return this.#token.value;
    const iat = Math.floor(now / 1000);
    const aud = a.token_uri ?? "https://oauth2.googleapis.com/token";
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: a.client_email, scope: SCOPE, aud, iat, exp: iat + 3600 }))}`;
    const sig = createSign("RSA-SHA256").update(unsigned).sign(a.private_key).toString("base64url");
    const r = await this.#send(aud, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${unsigned}.${sig}` });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (r.status !== 200 || !j.access_token) throw new Error(`Google sign-in for push failed (${r.status})`);
    this.#token = { value: j.access_token, exp: now + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  /** Sends one note to each token. Returns how many FCM accepted; tokens it says are gone go to onGone. */
  async send(tokens: string[], note: FcmNote): Promise<number> {
    const a = this.#account();
    if (!a || !tokens.length) return 0;
    const access = await this.#accessToken(a);
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(a.project_id)}/messages:send`;
    let sent = 0;
    await Promise.all(tokens.map(async (token) => {
      try {
        const r = await this.#send(url, { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ message: message(token, note) }) });
        if (r.status === 200) { sent++; return; }
        const e = (await r.json().catch(() => ({}))) as { error?: { status?: string; details?: { errorCode?: string }[] } };
        const code = e.error?.details?.find((d) => d.errorCode)?.errorCode ?? e.error?.status;
        if (r.status === 404 || code === "UNREGISTERED" || (r.status === 400 && code === "INVALID_ARGUMENT")) this.onGone(token);
        else if (r.status === 401) this.#token = null;
      } catch { /* a phone that cannot be reached now gets the next note */ }
    }));
    return sent;
  }
}

/**
 * The FCM message. Data only: the app's notification service builds the note from title, message,
 * body (the data, as JSON), channelId and categoryId, so approvals get their own loud channel and
 * their Review / Decline buttons even when the app is not running.
 */
export function message(token: string, n: FcmNote) {
  const data = { url: n.url, kind: n.kind, companyId: n.companyId, ...(n.taskId ? { taskId: n.taskId } : {}) };
  return {
    token,
    data: {
      title: n.title.slice(0, 120),
      message: n.body.slice(0, 300),
      body: JSON.stringify(data),
      channelId: n.kind === "approval" ? "approvals" : "activity",
      ...(n.kind === "approval" ? { categoryId: "approval" } : {}),
      ...(n.tag ? { tag: n.tag.slice(0, 64) } : {}),
    },
    android: { priority: n.kind === "approval" ? "HIGH" : "NORMAL", ttl: n.kind === "approval" ? "3600s" : "21600s", ...(n.tag ? { collapse_key: n.tag.slice(0, 64) } : {}) },
  };
}

let acct: { at: number; v: ServiceAccount | null } | null = null;
/** The account, read again at most once a minute: pasting it in /setup turns push on without a restart. */
function cached(): ServiceAccount | null {
  if (!acct || Date.now() - acct.at > 60_000) acct = { at: Date.now(), v: serviceAccount() };
  return acct.v;
}
