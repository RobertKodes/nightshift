import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import webpush from "web-push";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";

/**
 * App notifications: web push to the installed site (Android app, desktop, iPhone home-screen app).
 * The server's VAPID keys are made once and kept in the data folder, never printed. A subscription
 * may carry the wallet that was signed in when it was made, so holders can be told first.
 */

export type Topic = "sniper";
export const TOPICS: Topic[] = ["sniper"];
export type Sub = { endpoint: string; keys: { p256dh: string; auth: string }; wallet: string | null; topics: Topic[]; at: number };
export type Note = { title: string; body: string; url: string; tag?: string };

const keysFile = () => join(config.dataDir, "push-keys.json");
const subsFile = () => join(config.dataDir, "push.json");

let keys: { publicKey: string; privateKey: string } | null = null;
function vapid(): { publicKey: string; privateKey: string } {
  if (keys) return keys;
  try { if (existsSync(keysFile())) keys = JSON.parse(readFileSync(keysFile(), "utf8")); } catch { keys = null; }
  if (!keys?.publicKey || !keys.privateKey) {
    keys = webpush.generateVAPIDKeys();
    writeAtomic(keysFile(), JSON.stringify(keys), { mode: 0o600 });
  }
  webpush.setVapidDetails(config.publicUrl.startsWith("https://") ? config.publicUrl : "https://getnightshift.tech", keys.publicKey, keys.privateKey);
  return keys;
}
export const publicKey = () => vapid().publicKey;

let subs: Sub[] | null = null;
const all = (): Sub[] => {
  if (subs) return subs;
  try { subs = existsSync(subsFile()) ? (JSON.parse(readFileSync(subsFile(), "utf8")) as Sub[]) : []; } catch { subs = []; }
  return subs;
};
const persist = () => writeAtomic(subsFile(), JSON.stringify(all()));

/** A subscription as the browser hands it over, or null when it is not one. */
export function parseSub(v: unknown): Pick<Sub, "endpoint" | "keys"> | null {
  const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = typeof s?.endpoint === "string" ? s.endpoint : "";
  const p256dh = typeof s?.keys?.p256dh === "string" ? s.keys.p256dh : "", auth = typeof s?.keys?.auth === "string" ? s.keys.auth : "";
  if (!/^https:\/\/[^\s]{8,900}$/.test(endpoint) || !/^[A-Za-z0-9_-]{40,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,64}$/.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export function subscribe(s: Pick<Sub, "endpoint" | "keys">, wallet: string | null, topics: Topic[], now = Date.now()): void {
  const list = all();
  const old = list.find((x) => x.endpoint === s.endpoint);
  // a device that signed in once stays tied to that wallet until it signs in with another
  const entry: Sub = { ...s, wallet: wallet?.toLowerCase() ?? old?.wallet ?? null, topics, at: now };
  if (old) Object.assign(old, entry); else list.push(entry);
  if (list.length > 50_000) list.splice(0, list.length - 50_000);
  persist();
}
export function unsubscribe(endpoint: string): boolean {
  const list = all(), i = list.findIndex((x) => x.endpoint === endpoint);
  if (i < 0) return false;
  list.splice(i, 1);
  persist();
  return true;
}
export const subscribed = (endpoint: string) => all().find((x) => x.endpoint === endpoint) ?? null;

/** Who gets a note: everyone on the topic, or only devices whose wallet holds. */
export async function audience(list: Sub[], topic: Topic, only: "holders" | "everyone" | "others", holds: (wallet: string) => Promise<boolean>): Promise<Sub[]> {
  const on = list.filter((s) => s.topics.includes(topic));
  if (only === "everyone") return on;
  const out: Sub[] = [];
  for (const s of on) { const h = s.wallet ? await holds(s.wallet).catch(() => false) : false; if ((only === "holders") === h) out.push(s); }
  return out;
}

/** Sends a note; subscriptions the push service says are gone are dropped. */
export async function send(topic: Topic, note: Note, only: "holders" | "everyone" | "others", holds: (wallet: string) => Promise<boolean>): Promise<number> {
  vapid();
  const to = await audience(all(), topic, only, holds);
  let sent = 0;
  const gone: string[] = [];
  for (let i = 0; i < to.length; i += 50) {
    await Promise.all(to.slice(i, i + 50).map(async (s) => {
      try { await webpush.sendNotification(s, JSON.stringify(note), { TTL: 6 * 3600, urgency: "high", topic: note.tag?.slice(0, 32) }); sent++; }
      catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) gone.push(s.endpoint); }
    }));
  }
  if (gone.length) { subs = all().filter((s) => !gone.includes(s.endpoint)); persist(); }
  return sent;
}
