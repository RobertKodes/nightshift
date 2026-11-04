import * as SecureStore from "expo-secure-store";
import { demoBooks, demoChat, demoCompany, demoDesk, demoFlight } from "./demo";
import type { ApiKeyView, BooksView, ChatLine, ChatView, CompanyFull, Desk, DeviceView, Flight, JournalEntry, Policy, WalletConfig } from "./types";

/** The engine: the live site, or a local one while developing (EXPO_PUBLIC_API_URL=http://10.0.2.2:8787). */
export const BASE = (process.env.EXPO_PUBLIC_API_URL ?? "https://getnightshift.tech").replace(/\/+$/, "");

const TOKEN_KEY = "ns.session";
let token: string | null = null;
let onSignedOut: (() => void) | null = null;

/** The session, from the phone's Keystore-backed storage: never plain storage, never a cookie. */
export async function loadToken(): Promise<string | null> {
  token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  return token;
}
export async function setToken(t: string | null): Promise<void> {
  token = t;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
}
export const currentToken = () => token;
/** Called when the engine says the session is gone (signed out elsewhere, expired): the app goes back to sign-in. */
export const whenSignedOut = (f: () => void) => { onSignedOut = f; };

/** An engine answer that was not OK, with the engine's own words: the app shows them as they are. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) { super(message); }
  /** The engine asks for the wallet's confirmation first (a money-out action from the app). */
  get stepUp(): string | null { return this.status === 428 ? String(this.body.stepUp ?? "") : null; }
  get offline(): boolean { return this.status === 0; }
}

type Headers = Record<string, string>;

/** The demo: example companies, no wallet, nothing sent. Public reads still come from the engine. */
let demo = false;
export const setDemo = (v: boolean) => { demo = v; };
export const isDemo = () => demo;
export const DEMO_REFUSAL = "This is the demo with example data. Sign in with your wallet to run your own companies.";
function demoAnswer(method: string, path: string): unknown {
  const p = path.split("?")[0]!;
  const q = new URLSearchParams(path.split("?")[1] ?? "");
  const seg = p.split("/").filter(Boolean).map(decodeURIComponent);
  if (method !== "GET") throw new ApiError(DEMO_REFUSAL, 403, {});
  if (p === "/api/my/companies") return demoDesk;
  if (p === "/api/auth/me") return { address: "demo", requireAuth: true };
  if (p === "/api/devices") return [{ id: "demo", name: "This phone", platform: "android", push: true, prefs: { approval: true, sale: true, result: true, warning: false }, at: Date.now(), lastSeenAt: Date.now() }];
  if (p === "/api/keys") return [];
  if (seg[0] === "api" && seg[1] === "companies" && seg[2]) {
    if (!seg[3]) return demoCompany(seg[2]);
    if (seg[3] === "chat") return demoChat;
    if (seg[3] === "books") { const d = q.get("days"); return demoBooks(d === "all" ? "all" : Number(d) || 7); }
    if (seg[3] === "shifts" && seg[4]) return demoFlight(seg[4]);
    if (seg[3] === "journal") return { entries: [], more: false };
  }
  return undefined;
}

export async function call<T>(method: string, path: string, body?: unknown, headers: Headers = {}, timeoutMs = 20_000): Promise<T> {
  if (demo) { const d = demoAnswer(method, path); if (d !== undefined) return d as T; }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let r: Response;
  try {
    r = await fetch(BASE + path, {
      method,
      headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token && !demo ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch {
    throw new ApiError("No connection to NIGHTSHIFT. Check your internet and try again.", 0, {});
  } finally { clearTimeout(timer); }
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (r.status === 401 && token && !path.startsWith("/api/auth/")) { await setToken(null); onSignedOut?.(); }
  if (!r.ok) throw new ApiError(typeof j.error === "string" ? j.error : `Something went wrong (${r.status}).`, r.status, j);
  return j as T;
}

/** A session younger than this many days is left alone; older, the app trades it for a fresh one. */
const REFRESH_AFTER_DAYS = 2;
export async function refreshIfOld(): Promise<void> {
  const exp = Number(token?.split(".")[2] ?? 0);
  if (!exp || exp * 1000 - Date.now() > (7 - REFRESH_AFTER_DAYS) * 86400_000) return;
  const r = await call<{ token: string }>("POST", "/api/auth/refresh").catch(() => null);
  if (r?.token) await setToken(r.token);
}

const enc = encodeURIComponent;
const co = (id: string) => `/api/companies/${enc(id)}`;
/** The wallet's confirmation for one money-out action: "<nonce>.<signature>". */
export type StepProof = { nonce: string; signature: string };
const stepHeader = (s?: StepProof): Headers => (s ? { "X-Step-Up": `${s.nonce}.${s.signature}` } : {});

export const api = {
  walletConfig: () => call<WalletConfig>("GET", "/api/wallet-config"),
  nonce: (address: string, device: string) => call<{ nonce: string; message: string }>("GET", `/api/auth/nonce?address=${enc(address)}&device=${enc(device)}`),
  verify: (b: { address: string; nonce: string; signature: string; device: { pubKey: string; name: string; fcmToken?: string | null } }) =>
    call<{ token: string; address: string; device?: DeviceView }>("POST", "/api/auth/verify", b),
  me: () => call<{ address: string | null; requireAuth: boolean; app?: boolean }>("GET", "/api/auth/me"),
  logout: () => call("POST", "/api/auth/logout"),
  logoutAll: () => call("POST", "/api/auth/logout-all"),
  step: (b: { action: string; companyId?: string; pubKey?: string }) => call<{ nonce: string; message: string; action: string }>("POST", "/api/auth/step", b),

  desk: () => call<Desk>("GET", "/api/my/companies"),
  company: (id: string) => call<CompanyFull>("GET", co(id)),
  flight: (id: string, taskId: string) => call<Flight>("GET", `${co(id)}/shifts/${enc(taskId)}`),
  journal: (id: string, before: number, limit = 50) => call<{ entries: JournalEntry[]; more: boolean }>("GET", `${co(id)}/journal?before=${before}&limit=${limit}`),
  books: (id: string, days: number | "all") => call<BooksView>("GET", `${co(id)}/books?days=${days}`),
  booksCsvUrl: (id: string) => `${BASE}${co(id)}/books.csv`,

  chat: (id: string) => call<ChatView>("GET", `${co(id)}/chat`),
  say: (id: string, text: string) => call<{ lines: ChatLine[] }>("POST", `${co(id)}/chat`, { text }, {}, 60_000),
  act: (id: string, line: string, action: string) => call<{ ok?: boolean; lines?: ChatLine[]; taskId?: string; status?: string; error?: string }>("POST", `${co(id)}/chat/act`, { line, action }, {}, 60_000),
  report: (id: string, lineId: string, reason: string) => call<{ ok: boolean }>("POST", `${co(id)}/chat/${enc(lineId)}/report`, { reason }),

  found: (idea: string, policy: Partial<Policy>) => call<{ id: string; slug: string }>("POST", "/api/companies", { idea, policy, via: "app", from: "android" }, {}, 60_000),
  policy: (id: string, patch: Partial<Policy>, step?: StepProof) => call<Policy>("POST", `${co(id)}/policy`, patch, stepHeader(step)),
  direct: (id: string, direction: string) => call<{ ok: boolean }>("POST", `${co(id)}/profile`, { direction }),
  commission: (id: string, b: { kind: string; brief?: string; name?: string; pitch?: string; priceUsd?: number }) => call<{ ok: boolean; taskId: string; status: string; error?: string }>("POST", `${co(id)}/commission`, b, {}, 60_000),
  shift: (id: string) => call<{ ok: boolean }>("POST", `${co(id)}/shift`, {}, {}, 60_000),
  pause: (id: string) => call<{ ok: boolean }>("POST", `${co(id)}/pause`, {}),
  resume: (id: string) => call<{ ok: boolean }>("POST", `${co(id)}/resume`, {}),
  /** Signed on the phone after the fingerprint: the engine checks the key, the price and the moment. */
  approve: (id: string, taskId: string, sig: { deviceId: string; signature: string; ts: number; costUsd: number }) =>
    call<{ ok: boolean; status: string }>("POST", `${co(id)}/tasks/${enc(taskId)}/approve`, {}, { "X-Device-Id": sig.deviceId, "X-Device-Sig": sig.signature, "X-Device-Ts": String(sig.ts), "X-Device-Cost": sig.costUsd.toFixed(2) }, 120_000),
  reject: (id: string, taskId: string) => call<{ ok: boolean; status: string }>("POST", `${co(id)}/tasks/${enc(taskId)}/reject`, {}),
  price: (id: string, productId: string, priceUsd: number) => call<{ ok: boolean }>("POST", `${co(id)}/products/${enc(productId)}/price`, { priceUsd }),
  product: (id: string, productId: string, patch: { status?: "live" | "retired"; name?: string; pitch?: string }) => call<{ ok: boolean }>("POST", `${co(id)}/products/${enc(productId)}`, patch),
  withdraw: (id: string, step?: StepProof) => call<{ ok: boolean; sentUsd: number; feeUsd: number; txs: string[] }>("POST", `${co(id)}/withdraw`, {}, stepHeader(step), 120_000),
  close: (id: string, step?: StepProof) => call<Record<string, unknown>>("POST", `${co(id)}/close`, {}, stepHeader(step), 180_000),
  remove: (id: string, confirm: string, step?: StepProof) => call<{ ok: boolean }>("POST", `${co(id)}/delete`, { confirm }, stepHeader(step), 60_000),
  restore: (id: string) => call<{ ok: boolean; id: string }>("POST", `/api/my/archived/${enc(id)}/restore`, {}),

  devices: () => call<DeviceView[]>("GET", "/api/devices"),
  addDevice: (b: { pubKey: string; fcmToken?: string | null; name?: string }, step?: StepProof) => call<DeviceView>("POST", "/api/devices", b, stepHeader(step)),
  updateDevice: (id: string, b: { fcmToken?: string | null; prefs?: Partial<DeviceView["prefs"]>; name?: string }) => call<DeviceView>("POST", `/api/devices/${enc(id)}`, b),
  removeDevice: (id: string) => call<{ ok: boolean }>("DELETE", `/api/devices/${enc(id)}`),
  keys: () => call<ApiKeyView[]>("GET", "/api/keys"),
  revokeKey: (id: string) => call<{ ok: boolean }>("DELETE", `/api/keys/${enc(id)}`),
  deleteAccount: (step?: StepProof) => call<{ ok: boolean }>("POST", "/api/my/delete-account", {}, stepHeader(step)),
};
