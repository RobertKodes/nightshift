import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { FORGE_ABI, forgeOn } from "./forge.js";
import { type Reply, tgCall } from "./social.js";

/**
 * The Watch Room: the private Telegram group only Night Watcher holders can enter. A signed-in holder
 * gets a one-time code on /forge; sending it to the bot (/start nw_<code>) checks the wallet still
 * holds a Night Watcher and answers with an invite link for one person that expires in 10 minutes.
 * Every hour the room is swept: a member whose wallet no longer holds one is removed, and can come
 * back by forging or buying one. The bot must be an admin of the group (invite and ban rights).
 */
type Room = { codes: Record<string, { wallet: string; until: number }>; members: Record<string, { wallet: string; at: number }> };
const CODE_MS = 15 * 60_000;
const LINK_S = 600;
const file = () => join(config.dataDir, "watch-room.json");
const load = (): Room => { try { return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : { codes: {}, members: {} }; } catch { return { codes: {}, members: {} }; } };
const save = (r: Room) => writeAtomic(file(), JSON.stringify(r));

export const roomOn = () => Boolean(config.telegramToken && config.forge.room && forgeOn());

/** How many Night Watchers a wallet holds right now (null: the chain did not answer). */
export async function watcherBalance(wallet: string): Promise<number | null> {
  if (!forgeOn()) return 0;
  return eth.readContract({ address: config.forge.address as `0x${string}`, abi: FORGE_ABI, functionName: "balanceOf", args: [wallet as `0x${string}`] }).then(Number).catch(() => null);
}

/** A one-time code for a holder's wallet, as the bot link that redeems it; how many members the room has. */
export async function roomCode(wallet: string): Promise<{ url: string; until: number } | { error: string }> {
  if (!roomOn()) return { error: "The Watch Room opens with the Night Watchers." };
  const n = await watcherBalance(wallet);
  if (n === null) return { error: "The chain did not answer; try again in a minute." };
  if (n < 1) return { error: "The Watch Room is for Night Watcher holders: forge one first." };
  const r = load();
  const now = Date.now();
  for (const [c, v] of Object.entries(r.codes)) if (v.until < now || v.wallet === wallet) delete r.codes[c];
  const code = randomBytes(8).toString("hex");
  r.codes[code] = { wallet, until: now + CODE_MS };
  save(r);
  return { url: `https://t.me/${config.telegramBotName}?start=ot_${code}`, until: now + CODE_MS };
}

export const roomMembers = () => Object.keys(load().members).length;

/** The bot's answer to /start nw_<code> in a private chat (whose id is the person's Telegram id); null for any other code. */
export async function roomLink(chat: string, code: string): Promise<Reply | null> {
  if (!code.startsWith("nw_")) return null;
  const r = load();
  const entry = r.codes[code.slice(3)];
  const expired = { text: "🌙 This Watch Room code has expired. Get a new one at the Forge.", buttons: [[{ text: "Open the Forge", url: `${config.publicUrl}/forge#room` }]] };
  if (!entry || entry.until < Date.now() || !roomOn()) return expired;
  delete r.codes[code.slice(3)];
  save(r);
  if (((await watcherBalance(entry.wallet)) ?? 0) < 1) return { text: "🌙 That wallet holds no Night Watcher any more, so the room stays closed to it." };
  const link = await tgCall<{ invite_link: string }>(config.telegramToken, "createChatInviteLink", {
    chat_id: config.forge.room, member_limit: 1, expire_date: Math.floor(Date.now() / 1000) + LINK_S, name: `OT ${entry.wallet.slice(0, 10)}`,
  });
  if (!link?.invite_link) return { text: "🌙 The room could not make an invite just now. Try again in a minute." };
  const fresh = load();
  fresh.members[chat] = { wallet: entry.wallet, at: Date.now() };
  save(fresh);
  return {
    text: "🌙 <b>Welcome to the Watch Room.</b>\nThis link lets one person in and expires in 10 minutes. The room is for Night Watcher holders only: if the wallet stops holding one, the bot takes you out.",
    buttons: [[{ text: "Enter the Watch Room", url: link.invite_link }]],
  };
}

/** Removes every member whose wallet no longer holds a Night Watcher (ban then unban: removed, free to come back). */
export async function sweepRoom(): Promise<number> {
  if (!roomOn()) return 0;
  const r = load();
  let out = 0;
  for (const [user, m] of Object.entries(r.members)) {
    const n = await watcherBalance(m.wallet);
    if (n === null || n > 0) continue;
    const banned = await tgCall(config.telegramToken, "banChatMember", { chat_id: config.forge.room, user_id: Number(user), until_date: Math.floor(Date.now() / 1000) + 60 });
    if (banned === null) continue;
    await tgCall(config.telegramToken, "unbanChatMember", { chat_id: config.forge.room, user_id: Number(user), only_if_banned: true });
    await tgCall(config.telegramToken, "sendMessage", { chat_id: user, text: "Your wallet no longer holds a Night Watcher, so you have left the Watch Room. Forge or buy one to come back." });
    delete r.members[user];
    out++;
  }
  if (out) save(r);
  return out;
}
