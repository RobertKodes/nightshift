/**
 * The community guard: reads every message in the public group and acts on three levels.
 * - scam:  wallet drainers, seed-phrase fishing, fake support, fake contract addresses → delete, mute 24h
 * - spam:  other projects' shills, invite links, unknown links, floods, slurs → delete, mute 1h (24h on repeat)
 * - fud:   rug / scam / honeypot talk → delete with a reply pointing to the proof; mute 1h on the 2nd, 24h on the 3rd
 * Admins of the group and the operator are never touched. Honest questions ("is this audited?",
 * "is the liquidity locked?") are not in any list.
 */
export type Verdict = { level: "scam" | "spam" | "fud"; reason: string } | null;

/** Lowercased, accents removed, leetspeak undone, letters collapsed: "fr33 a1rdr0p!!" → "free airdrop". */
export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[0@4]/g, (c) => ({ "0": "o", "@": "a", "4": "a" })[c]!).replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/[5$]/g, "s").replace(/7/g, "t")
    .replace(/[^a-z\s/.:-]/g, " ").replace(/(.)\1{2,}/g, "$1$1").replace(/\s+/g, " ").trim();
}

// ── Scams: the ones that empty wallets. One hit is enough.
export const SCAM = [
  "seed phrase", "secret phrase", "recovery phrase", "mnemonic", "private key", "12 words", "24 words", "backup phrase",
  "wallet connect", "walletconnect", "connect your wallet", "validate your wallet", "validate wallet", "sync your wallet",
  "rectify", "dapp rectification", "wallet rectification", "unlock your wallet", "restore your wallet", "migrate your tokens", "migration is live",
  "claim your airdrop", "claim airdrop", "free airdrop", "airdrop is live", "airdrop claim", "claim your tokens", "claim your reward", "claim now",
  "giveaway", "double your", "send eth and", "send and receive", "send to receive", "first 100 people", "whitelist spot",
  "dm me", "dm for", "inbox me", "pm me", "message me privately", "text me", "write me in private", "contact me on whatsapp", "whatsapp",
  "admin will dm", "support will dm", "support ticket", "open a ticket", "investment opportunity", "guaranteed profit", "guaranteed returns",
  "drainer", "recover your funds", "recover lost", "funds recovery", "hacked wallet recovery", "crypto recovery",
];

// ── Spam: other projects, promotion, hate.
export const SPAM = [
  "new gem", "next gem", "hidden gem", "low cap gem", "next 100x", "next 1000x", "100x gem", "stealth launch", "presale live", "presale is live",
  "fair launch now", "just launched", "launching now", "join my group", "join our group", "join my channel", "check my bio", "link in bio",
  "promote your project", "promotion service", "marketing service", "listing service", "call channel", "kol service", "trending service",
  "technical support", "customer support", "help desk", "live support", "account manager", "daily profit", "passive income",
  "trading signals", "signals group", "vip group", "pump group", "mev bot", "arbitrage bot", "sniper bot", "front run bot",
  "buy followers", "boost your", "earn money from home", "make money online", "onlyfans", "porn", "nudes", "escort", "casino bonus", "betting tips",
  "kys", "kill yourself", "kill urself", "nigger", "nigga", "faggot", "retard", "tranny", "kike", "chink", "spic",
];

// ── FUD: said to scare holders out. Warned first, with the proof.
export const FUD = [
  "scam", "rug", "rugged", "rugpull", "rug pull", "soft rug", "honeypot", "honey pot", "ponzi", "exit scam", "its a scam", "this is a scam", "total scam", "scam project", "scam coin", "scam token", "scammers", "scam dev",
  "dev sold", "dev dumped", "dev is dumping", "dev rugged", "devs dumping", "team dumping", "insiders dumping", "dev wallet sold",
  "dead project", "dead coin", "dead token", "project is dead", "its dead", "its over", "going to zero", "going to 0", "will go to zero",
  "sell now", "sell everything", "dump it", "dump this", "get out now", "run away", "dont buy", "do not buy", "stay away", "avoid this",
  "jeet", "jeets", "paper hands", "worthless", "shitcoin", "shit coin", "garbage coin", "trash coin", "cash grab", "pump and dump",
];

const has = (n: string, list: string[]) => list.find((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*")}($|[^a-z])`).test(n));

/** Links we leave alone: ours, the chain explorers, the DEXes and IMD. Anything else is spam. */
const ALLOWED_HOSTS = ["getnightshift.tech", "x.com", "twitter.com", "dexscreener.com", "etherscan.io", "basescan.org", "app.uniswap.org", "uniswap.org", "imd.fun", "bsky.app", "coingecko.com", "dextools.io", "github.com"];

const plain = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['’]/g, "").replace(/\s+/g, " ");

export function judge(raw: string, ctx: { ourAddresses: string[]; ourTelegram: string[] }): Verdict {
  if (!raw.trim()) return null;
  const n = `${plain(raw)} | ${normalize(raw)}`;
  const s = has(n, SCAM);
  if (s) return { level: "scam", reason: `scam phrase "${s}"` };
  // A contract address that is not ours is the classic fake-CA scam.
  const addrs = raw.match(/0x[0-9a-fA-F]{40}/g) ?? [];
  const foreign = addrs.find((a) => !ctx.ourAddresses.includes(a.toLowerCase()));
  if (foreign) return { level: "scam", reason: "a contract address that is not $SHIFT's" };
  // Invite links and unknown sites.
  const links = raw.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi) ?? [];
  for (const l of links) {
    const host = l.replace(/^https?:\/\//i, "").split("/")[0]!.toLowerCase().replace(/^www\./, "");
    if (/^(t\.me|telegram\.me|discord\.gg|discord\.com)$/.test(host)) {
      if (!ctx.ourTelegram.some((t) => l.toLowerCase().includes(t))) return { level: "spam", reason: "an invite link to another group" };
      continue;
    }
    if (/^\d+(\.\d+)?$/.test(host) || !host.includes(".")) continue;
    if (!ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return { level: "spam", reason: `a link to ${host}` };
  }
  const p = has(n, SPAM);
  if (p) return { level: "spam", reason: `"${p}"` };
  const f = has(n, FUD);
  if (f) return { level: "fud", reason: `"${f}"` };
  return null;
}

/** Strikes in the last 7 days, and recent messages for flood and repeat detection. */
type Seen = { strikes: number[]; recent: { at: number; text: string }[] };
const seen = new Map<string, Seen>();

export function track(user: string, text: string, now = Date.now()): { flood: boolean; repeat: boolean } {
  const s = seen.get(user) ?? { strikes: [], recent: [] };
  s.recent = [...s.recent.filter((m) => now - m.at < 60_000), { at: now, text: text.trim().toLowerCase() }];
  seen.set(user, s);
  const last10 = s.recent.filter((m) => now - m.at < 10_000).length;
  const same = s.recent.filter((m) => m.text && m.text === text.trim().toLowerCase()).length;
  return { flood: last10 >= 6, repeat: same >= 3 && text.trim().length > 0 };
}

export function strike(user: string, now = Date.now()): number {
  const s = seen.get(user) ?? { strikes: [], recent: [] };
  s.strikes = [...s.strikes.filter((t) => now - t < 7 * 86_400_000), now];
  seen.set(user, s);
  return s.strikes.length;
}

export function forgive(user: string): void { seen.delete(user); }

/** Minutes of mute for this verdict and strike count (0: delete and warn only). */
export function muteMinutes(level: "scam" | "spam" | "fud" | "flood", strikes: number): number {
  if (level === "scam") return 24 * 60;
  if (level === "flood") return 10;
  if (level === "spam") return strikes >= 2 ? 24 * 60 : 60;
  return strikes >= 3 ? 24 * 60 : strikes === 2 ? 60 : 0;
}
