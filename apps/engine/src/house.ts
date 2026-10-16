import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { type LinkCard, blueskyPost } from "./social.js";

/**
 * The project's own Bluesky account (BLUESKY_HANDLE + BLUESKY_APP_PASSWORD). It posts a promo a
 * day, the platform's real news (new companies, products and sales in live mode, the token going
 * live, milestones) and, in live mode, the drafts of companies that have no account of their own.
 * Every post goes through one paced queue, so the account never floods. New posts on it are
 * picked up by the community bot and announced on Telegram.
 */
type Item = { text: string; topic: string; at: number };
type State = { queue: Item[]; sent: { at: number; topic: string; url: string }[]; promo: number; promoDay?: string };

const file = () => join(config.dataDir, "house.json");
const load = (): State => { try { return existsSync(file()) ? { queue: [], sent: [], promo: 0, ...JSON.parse(readFileSync(file(), "utf8")) } : { queue: [], sent: [], promo: 0 }; } catch { return { queue: [], sent: [], promo: 0 }; } };
const save = (s: State) => writeFileSync(file(), JSON.stringify(s, null, 2));
const st = load();

/** The site's link card, when the post links to it. */
function cardFor(text: string): LinkCard | undefined {
  const uri = text.match(/https?:\/\/\S+/)?.[0];
  if (!uri || !uri.startsWith(config.publicUrl)) return undefined;
  return { uri, title: "NIGHTSHIFT · Ideas don't sleep", description: "One sentence becomes an AI company, built by the IMD swarm while you sleep.", thumb: `${config.publicUrl}/og.jpg` };
}

export const houseOn = () => Boolean(config.blueskyHandle && config.blueskyAppPassword);

/** Queues a post; duplicates of a topic already queued or sent are dropped. */
export function housePost(text: string, topic: string): void {
  if (!houseOn()) return;
  if (st.queue.some((q) => q.topic === topic) || st.sent.some((s) => s.topic === topic)) return;
  st.queue.push({ text, topic, at: Date.now() });
  save(st);
}

const SITE = () => config.publicUrl;
const PROMOS = (): string[] => {
  const s = config.token.symbol;
  const ca = config.token.address;
  return [
    `Ideas don't sleep. Neither do we. 🌙\n\nNIGHTSHIFT turns one sentence into an AI company that builds with the IMD swarm and sells to people and AI agents.\n\n${SITE()}`,
    `You sleep. Your company ships.\n\nAI companies that buy their work from the IMD swarm and sell while you're offline. Start one tonight: ${SITE()}/launch`,
    `Your AI CEO can't overspend: a hard daily budget, your yes for anything big, IMD's free check before every order. Autonomy with brakes. ${SITE()}/guide`,
    `Every product a NIGHTSHIFT company sells is an x402 link. A person with a wallet can buy it. So can an AI agent. Same door, same price. ${SITE()}/market`,
    `Agents hiring agents: AI agents find and buy NIGHTSHIFT products over MCP (nightshift_market) and x402. The machine economy needs shops. ${SITE()}/mcp`,
    `How it works:\n→ describe a business in one sentence\n→ set a daily budget\n→ an AI CEO picks one move per shift\n→ the IMD swarm builds it\n→ buyers pay in USDC\n${SITE()}`,
    ca
      ? `$${s} is the NIGHTSHIFT token, paired with IMD on Ethereum. Holders pay no platform fee and get featured in the market. Fees buy it back, onchain.\n\n${SITE()}/token`
      : `Something is working the night shift. $${s}, launching through IMD. 1B fixed supply, 0% team, 0% tax. 🌙\n\n${SITE()}/token`,
    `Built on IMD, built for IMD: every NIGHTSHIFT company pays the swarm in IMD, and every $${s} trade goes through IMD. ${SITE()}`,
  ];
};

/** One step: a promo once a day, then at most one queued post per gap. */
export async function houseTick(): Promise<void> {
  if (!houseOn()) return;
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  if (config.blueskyPromo && st.promoDay !== day && new Date(now).getUTCHours() >= 15) {
    const list = PROMOS();
    housePost(list[st.promo % list.length]!, `promo-${day}`);
    st.promo += 1;
    st.promoDay = day;
  }
  const last = st.sent[0]?.at ?? 0;
  const today = st.sent.filter((s) => now - s.at < 24 * 3600_000).length;
  if (!st.queue.length || now - last < config.blueskyGapMinutes * 60_000 || today >= config.blueskyDailyMax) { save(st); return; }
  const item = st.queue.shift()!;
  try {
    const url = await blueskyPost(config.blueskyHandle, config.blueskyAppPassword, item.text, cardFor(item.text));
    st.sent.unshift({ at: now, topic: item.topic, url });
    st.sent = st.sent.slice(0, 300);
  } catch (e) {
    console.error("bluesky house post", (e as Error).message);
    if (now - item.at < 6 * 3600_000) st.queue.unshift(item);
  }
  save(st);
}

/** Posts right away, outside the queue (the operator's /post). */
export async function houseNow(text: string): Promise<string> {
  if (!houseOn()) throw new Error("Set BLUESKY_HANDLE and BLUESKY_APP_PASSWORD first.");
  const url = await blueskyPost(config.blueskyHandle, config.blueskyAppPassword, text, cardFor(text));
  st.sent.unshift({ at: Date.now(), topic: `manual-${Date.now()}`, url });
  save(st);
  return url;
}

export const houseStatus = () => ({ on: houseOn(), handle: config.blueskyHandle, queued: st.queue.length, today: st.sent.filter((s) => Date.now() - s.at < 24 * 3600_000).length, last: st.sent[0] ?? null });
