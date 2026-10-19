import type { LlmClient } from "@nightshift/llm";

/**
 * The community assistant: answers real questions about NIGHTSHIFT in the group, from live facts
 * only. Three gates keep it quiet: a cheap text gate (a question, or about the project, or asked
 * to the bot), then the model itself (it answers SKIP when the message is not about the project),
 * then rate limits. It never invents numbers: anything not in the facts is "not known yet".
 */
/**
 * How much a message is about the project: every word is weighed against the project's vocabulary,
 * typos included (one letter off on longer words). Names of the project weigh most, then its
 * features, then generic crypto words that only count next to the others.
 */
const VOCAB: [string, number][] = [
  ["nightshift", 3], ["shift", 3], ["frog", 3], ["frogs", 3], ["imd", 3], ["keeper", 3], ["tokenomics", 3], ["getnightshift", 3],
  ["stake", 2], ["staking", 2], ["staked", 2], ["unstake", 2], ["lock", 2], ["locked", 2], ["rewards", 2], ["reward", 2], ["claim", 2], ["burn", 2], ["burned", 2], ["burns", 2],
  ["company", 2], ["companies", 2], ["swarm", 2], ["launch", 2], ["launched", 2], ["launching", 2], ["launches", 2], ["network", 2], ["chain", 2], ["listing", 2], ["listed", 2], ["treasury", 2], ["hook", 2], ["swap", 2], ["airdrop", 2], ["presale", 2], ["seat", 2], ["genesis", 2],
  ["contract", 1], ["address", 1], ["ca", 3], ["token", 1], ["tokens", 1], ["tax", 1], ["fee", 1], ["fees", 1], ["buy", 1], ["sell", 1], ["selling", 1], ["buying", 1],
  ["chart", 1], ["liquidity", 1], ["lp", 1], ["price", 1], ["mcap", 1], ["supply", 1], ["audit", 1], ["audited", 1], ["wallet", 1], ["dev", 1], ["team", 1],
  ["eth", 1], ["ethereum", 1], ["base", 1], ["buyers", 1], ["holder", 1], ["project", 1], ["roadmap", 1], ["website", 1], ["site", 1], ["bot", 1], ["uniswap", 1], ["etherscan", 1], ["dexscreener", 1], ["legit", 1], ["safe", 1], ["mint", 1], ["minted", 1], ["holders", 1],
];
const VOCAB_MAP = new Map(VOCAB);
const QUESTION = /\?|^(what|how|when|where|why|who|which|is|are|can|could|do|does|did|will|should|any|anyone|pls|please|explain|tell|wen)\b/i;
const NEEDS_HELP = /\b(can'?t|cannot|not working|doesn'?t work|does not work|error|stuck|failed|fails|help|confused|lost|missing|wrong|broken|how to)\b/i;

/** One letter off (insert, delete or change), for words of 5+ letters. */
const near = (a: string, b: string) => {
  if (Math.abs(a.length - b.length) > 1 || b.length < 5) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
};

export function relevance(text: string): { score: number; hits: string[] } {
  const words = text.toLowerCase().replace(/\$/g, " ").match(/[a-z0-9]+/g) ?? [];
  const hits: string[] = [];
  let score = 0;
  for (const w of new Set(words)) {
    const exact = VOCAB_MAP.get(w);
    const fuzzy = exact === undefined && w.length >= 5 ? VOCAB.find(([v]) => near(w, v)) : undefined;
    const weight = exact ?? fuzzy?.[1] ?? 0;
    if (weight) { score += weight; hits.push(fuzzy ? `${w}≈${fuzzy[0]}` : w); }
  }
  return { score, hits };
}

/**
 * Worth an answer? In the project's own group almost every question is about the project, so:
 * asked to the bot, or any question (short ones even without a project word: "where to buy?"),
 * or someone stuck with a project word, or plain chat that is clearly about the project (5+).
 * The model has the last word: it answers SKIP to anything off-topic.
 */
export function worthAsking(text: string, toBot: boolean): boolean {
  const t = text.trim();
  if (t.length < 5 || t.length > 600 || t.startsWith("/")) return false;
  if (toBot) return true;
  const { score } = relevance(t);
  const words = t.split(/\s+/).length;
  if (QUESTION.test(t) || /^(where|how|what|when|wen)\b/i.test(t)) return score >= 1 || words <= 8;
  if (NEEDS_HELP.test(t)) return score >= 2;
  return score >= 5;
}

const SYSTEM = `You are a friendly, sharp community mod in the NIGHTSHIFT Telegram group, answering in chat.
Answer ONLY questions about NIGHTSHIFT, $SHIFT, NIGHT FROGS, staking, the fees and burns, the companies platform, or how NIGHTSHIFT relates to IMD.
If the message is not such a question (greetings, jokes, price predictions, other projects, general chat, insults), reply with exactly: SKIP
Rules:
- Use ONLY the FACTS below. If the answer is not in them, say it is not known yet and point to the most relevant link. Never invent numbers, dates, partnerships or listings.
- Never give financial advice, price predictions or "wen moon" promises. Never ask anyone to DM or to connect a wallet anywhere but getnightshift.tech.
- Sound like a real person in a crypto Telegram chat: casual, warm, direct, with contractions. One or two short sentences, three at most. No corporate tone, no lists, no "Great question", don't repeat the question, vary your wording.
- Add a link only when it really helps (buying → the swap page, staking → the stake page, fees → tokenomics), as a bare URL at the end. At most one emoji.
- If someone asks for the contract address: give it only if the FACTS list it as live; otherwise say it is not launched yet and anything posted earlier is fake.`;

export type Facts = Record<string, unknown>;

export async function answer(llm: LlmClient, model: string, question: string, facts: Facts, asker = ""): Promise<string | null> {
  const r = await llm.chat({
    model, temperature: 0.5, maxTokens: 500,
    messages: [{ role: "system", content: `${SYSTEM}\n\nFACTS (live, ${new Date().toISOString()}):\n${JSON.stringify(facts)}` }, { role: "user", content: `${asker ? `${asker} asks: ` : ""}${question.slice(0, 600)}` }],
  });
  const text = (r.message.content ?? "").trim().replace(/^["']|["']$/g, "");
  if (!text || /^skip\b/i.test(text) || text.length < 8) return null;
  return safeReply(text.slice(0, 900), facts);
}

/**
 * Where the bot may link: the project's own site and accounts, IMD, the explorers, the DEX and the
 * marketplace. An entry with a path allows only that path (and below it) on that host; one without
 * allows the host and its subdomains.
 */
export const ALLOWED_HOSTS = [
  "getnightshift.tech", "x.com/nightshiftidm", "twitter.com/nightshiftidm", "t.me/getnightshift", "bsky.app", "imd.fun", "dexscreener.com",
  "opensea.io", "uniswap.org", "etherscan.io", "basescan.org", "github.com/robertkodes",
];
/** What a reply may not claim, unless the sentence denies it ("there is no airdrop", "never share your seed phrase"). */
const CLAIMS = /\b(migrat\w*|airdrops?|new (ca|contract|token|address)|v2 (token|contract)|relaunch\w*|token swap|swap your (old )?tokens|claim (your|now|free|here)|free (tokens?|shift|imd|eth)|giveaway|double your|send (your )?(eth|imd|shift|usdc|tokens?) to|dm (me|us)|message me|whatsapp|seed phrase|private key|recovery phrase|(validate|sync|verify|rectify) (your )?wallet)\b/i;
const DENIED = /\b(no|not|never|nobody|none|isn'?t|aren'?t|won'?t|fake|scams?|beware|ignore)\b/i;
const INVISIBLE = /[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const LINK = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s)\]}>"']*)?/gi;
const bare = (u: string) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[.,;:!?]+$/, "");

/**
 * The assistant's reply as it may go out under the bot's name, or null. The question is the
 * asker's text, so a prompt injection can make the model say anything: a reply is refused when it
 * carries an address the facts do not (a fake CA), a link to a host off ALLOWED_HOSTS or the facts'
 * own links, or claims a migration, an airdrop, a new contract or the other classic scams.
 */
export function safeReply(raw: string, facts: Facts, known: string[] = []): string | null {
  const text = raw.normalize("NFKC").replace(INVISIBLE, "");
  const said = JSON.stringify(facts).toLowerCase();
  const ours = new Set([...(said.match(/0x[0-9a-f]{40}/g) ?? []), ...known.map((a) => a.toLowerCase())]);
  // an address is ours only exactly: a longer hex string (a "transaction", a padded address) is not
  for (const a of text.match(/0x[0-9a-fA-F]{6,}/g) ?? []) if (!ours.has(a.toLowerCase())) return null;
  if (/0x[0-9a-f]{0,4}\s*(\.\.\.|…)/i.test(text) && !/0x\.\.\.dead/i.test(text)) return null; // an abbreviated address cannot be checked
  const allowed = [...ALLOWED_HOSTS, ...(said.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"\\]*)?/g) ?? []).filter((u) => /\//.test(bare(u))).map(bare)];
  if (/\b\d{1,3}(\.\d{1,3}){3}\b/.test(text)) return null; // a bare IP is never one of our links
  for (const l of text.match(LINK) ?? []) {
    const u = bare(l), host = u.split(/[/:]/)[0]!;
    const ok = allowed.some((e) => {
      const [eh, ...ep] = e.split("/"), path = ep.join("/");
      if (!path) return host === eh || host.endsWith(`.${eh}`);
      return u === e || u.startsWith(`${e}/`) || u.startsWith(`${e}?`);
    });
    if (!ok) return null;
  }
  for (const sentence of text.split(/(?<=[.!?\n])\s+/)) if (CLAIMS.test(sentence) && !DENIED.test(sentence)) return null;
  // a handle posing as staff ("@NightshiftSupport") is the next step of the same scam
  if ((text.match(/@[a-z0-9_]{3,}/gi) ?? []).some((h) => /support|admin|help|official|team|mod|desk/i.test(h) && !said.includes(h.toLowerCase()))) return null;
  return text;
}

/** Per person, per hour and per day, so the bot answers questions without filling the chat. */
const asked = new Map<string, number>();
const hour: number[] = [];
let day = { key: "", n: 0 };

export function allowed(user: string, now = Date.now()): boolean {
  if (now - (asked.get(user) ?? 0) < 45_000) return false;
  while (hour.length && now - hour[0]! > 3_600_000) hour.shift();
  const k = new Date(now).toISOString().slice(0, 10);
  if (day.key !== k) day = { key: k, n: 0 };
  // OpenRouter free: 1,000 requests a day for the whole platform; the assistant takes at most 200 of them.
  return hour.length < 30 && day.n < 200;
}
export function spend(user: string, now = Date.now()): void { asked.set(user, now); hour.push(now); day.n += 1; }

