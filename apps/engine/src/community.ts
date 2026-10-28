import { forgeReply } from "./forge-bot.js";
import { liveBus } from "./live/bus.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { board as pinballBoard } from "./pinball.js";
import { join } from "node:path";
import { erc20Abi, parseAbiItem } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { housePost } from "./house.js";
import { DEAD, DEV_WALLET, IMD_BURN_EXECUTOR } from "./shift-launch.js";
import { IMD_TOKEN, launchState } from "./token.js";
import { type Button, esc, telegram, telegramMedia, tgCall } from "./social.js";
import { INSTALL } from "./tg-bot.js";

/**
 * The public side of the bot, for the community chat: a buy bot for the platform token, X post
 * raids, new Bluesky posts, market-cap milestones and a welcome for new members. Free: it reads
 * the chain through the public RPC, prices from DexScreener and Bluesky's public API.
 */
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
/** Uniswap v4 keeps every pool's tokens in one contract; a transfer out of it is a buy. */
const V4_POOL_MANAGER = "0x000000000004444c5dc75cb358380d2e3de08a90";
const MILESTONES = [10e3, 25e3, 50e3, 100e3, 250e3, 500e3, 1e6, 2.5e6, 5e6, 10e6, 25e6, 50e6, 100e6];

type Market = { priceUsd: number; ethUsd: number; mcap: number; liquidity: number; pools: string[]; chart: string; at: number };

/** The buyer's wallet tier, by what the wallet holds in USD after the buy. */
const TIERS: [number, string][] = [[100_000, "👑 MEGA WHALE"], [30_000, "🐳 BIG WHALE"], [10_000, "🐋 WHALE"], [5_000, "🦈 SHARK"], [2_000, "🐬 DOLPHIN"], [1_000, "🐟 FISH"]];
export const walletTier = (usd: number) => TIERS.find(([min]) => usd >= min)?.[1] ?? null;
const STABLES: [`0x${string}`, number][] = [["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6], ["0xdAC17F958D2ee523a2206206994597C13D831ec7", 6]];
/** ETH, $SHIFT, IMD and the two big stablecoins on Ethereum, valued at live prices. */
async function walletUsd(who: `0x${string}`, m: Market): Promise<number> {
  const read = (address: `0x${string}`) => eth.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [who] }).catch(() => 0n);
  const [ethBal, shift, imd, ...st] = await Promise.all([eth.getBalance({ address: who }).catch(() => 0n), read(config.token.address as `0x${string}`), read(IMD_TOKEN as `0x${string}`), ...STABLES.map(([a]) => read(a))]);
  return (Number(ethBal) / 1e18) * m.ethUsd + (Number(shift) / 1e18) * m.priceUsd + (Number(imd) / 1e18) * config.imdUsd + st.reduce((s, v, i) => s + Number(v) / 10 ** STABLES[i]![1], 0);
}
type State = { lastBlock?: number; milestone?: number; bskySeen?: string; bskyAt?: string; bskyPosted?: string[]; buys?: number; eventsBlock?: number; burnedShift?: number; burnedImd?: number };

const file = () => join(config.dataDir, "community.json");
const load = (): State => { try { return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {}; } catch { return {}; } };
const save = (s: State) => writeFileSync(file(), JSON.stringify(s, null, 2));

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`);
const num = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(2));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** Running totals of what the fee split burned, as the burn watcher counted them. */
export const burnTotals = () => { const s = load(); return { shift: s.burnedShift ?? 0, imd: s.burnedImd ?? 0 }; };

/**
 * The community chats the bot posts to. A @name in TELEGRAM_COMMUNITY is looked up once and the group's numeric id
 * kept, so the group keeps working when it turns private and its name moves to the Safeguard portal channel.
 */
const named = () => config.telegramCommunity.split(",").map((x) => x.trim()).filter(Boolean);
const idsFile = () => join(config.dataDir, "community-chats.json");
let ids: Record<string, string> | null = null;
const known = (): Record<string, string> => (ids ??= (() => { try { return existsSync(idsFile()) ? JSON.parse(readFileSync(idsFile(), "utf8")) as Record<string, string> : {}; } catch { return {}; } })());
export const chats = () => named().map((c) => (c.startsWith("@") && known()[c.toLowerCase()]) || c);
/** Remembers the group behind each @name while the name still points at a group (a channel, like the portal, is never taken). */
export async function learnCommunityIds(lookup = (name: string) => tgCall<{ id: number; type: string }>(config.telegramToken, "getChat", { chat_id: name })): Promise<void> {
  if (!config.telegramToken) return;
  const k = known();
  let changed = false;
  for (const c of named().filter((x) => x.startsWith("@") && !k[x.toLowerCase()])) {
    const r = await lookup(c);
    if (r && (r.type === "supergroup" || r.type === "group")) { k[c.toLowerCase()] = String(r.id); changed = true; }
  }
  if (changed) writeFileSync(idsFile(), JSON.stringify(k));
}

export type Buy = { usd: number; imd: number; tokens: number; buyer: string; tx: string; newHolder: boolean; position: number; mcap: number; liquidity: number; wallet?: number; test?: boolean };

/** The buy card: size tier, a bar that grows with the buy, and the numbers people look for. */
export function buyCard(b: Buy): { text: string; buttons: Button[][] } {
  const sym = config.token.symbol;
  // The buyer's wallet decides the title; a big buy from a small wallet is still a big buy.
  const wt = b.wallet ? walletTier(b.wallet) : null;
  const tier = wt ? `${wt} BUY` : b.usd >= 2500 ? "🐳 WHALE BUY" : b.usd >= 500 ? "🦈 BIG BUY" : b.usd >= 100 ? "🚀 BUY" : "🐸 BUY";
  const bar = "🌙".repeat(Math.max(1, Math.min(40, Math.round(b.usd / config.buyEmojiUsd))));
  const text = [
    `${b.test ? "🧪 <b>TEST</b> · " : ""}<b>${tier} · $${esc(sym)}</b>`,
    bar, "",
    `💵 <b>${usd(b.usd)}</b>${b.imd ? ` (${b.imd.toFixed(2)} IMD)` : ""}`,
    `🪙 <b>${num(b.tokens)}</b> ${esc(sym)}`,
    `👤 <a href="https://etherscan.io/address/${b.buyer}">${short(b.buyer)}</a> · ${b.newHolder ? "🆕 <b>New holder!</b>" : `position ${b.position > 0 ? `+${b.position.toFixed(0)}%` : "up"}`}`,
    ...(b.wallet && b.wallet >= 1000 ? [`💼 Wallet ≈ <b>${usd(b.wallet)}</b>`] : []),
    `📈 Market cap <b>${usd(b.mcap)}</b>`,
    `💧 Liquidity ${usd(b.liquidity)}`, "",
    `<a href="https://etherscan.io/tx/${b.tx}">TX</a> · <a href="${config.publicUrl}/token">Every ${esc(sym)} trade pays IMD</a>`,
  ].join("\n");
  const buy = config.token.buyUrl || `${config.publicUrl}/token`;
  return { text, buttons: [
    [{ text: `🌙 Buy on NIGHTSHIFT`, url: `${config.publicUrl}/swap` }, { text: "🦄 Uniswap", url: buy }],
    [{ text: "📊 Chart", url: market?.chart || `https://dexscreener.com/ethereum/${config.token.address}` }, { text: "🧾 Etherscan", url: `https://etherscan.io/tx/${b.tx}` }],
    [{ text: "🪙 Tokenomics", url: `${config.publicUrl}/tokenomics` }, { text: "🔒 Stake", url: `${config.publicUrl}/stake` }],
  ] };
}

let market: Market | null = null;
async function refreshMarket(): Promise<Market | null> {
  if (market && Date.now() - market.at < 60_000) return market;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${config.token.address}`, { signal: AbortSignal.timeout(8000) });
    const d = (await r.json()) as { pairs?: { chainId: string; pairAddress: string; url: string; priceUsd?: string; priceNative?: string; fdv?: number; marketCap?: number; liquidity?: { usd?: number }; baseToken: { address: string } }[] };
    const pairs = (d.pairs ?? []).filter((p) => p.chainId === "ethereum" && p.baseToken.address.toLowerCase() === config.token.address.toLowerCase())
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    if (!pairs.length) return market;
    const top = pairs[0]!;
    market = {
      priceUsd: Number(top.priceUsd ?? 0), ethUsd: Number(top.priceNative) > 0 ? Number(top.priceUsd ?? 0) / Number(top.priceNative) : 0, mcap: top.marketCap ?? top.fdv ?? 0, liquidity: pairs.reduce((a, p) => a + (p.liquidity?.usd ?? 0), 0),
      // v2/v3 pools are addresses; a v4 pool id is 32 bytes and its tokens sit in the pool manager
      pools: [...new Set(pairs.map((p) => (p.pairAddress.length === 42 ? p.pairAddress.toLowerCase() : V4_POOL_MANAGER)))],
      chart: top.url, at: Date.now(),
    };
  } catch { /* keep the last one */ }
  return market;
}

export async function marketSnapshot(): Promise<Market | null> { return config.token.address ? refreshMarket() : null; }

let decimals = 18;
async function scanBuys(st: State): Promise<Buy[]> {
  const m = await refreshMarket();
  if (!m?.pools.length) return [];
  const head = Number(await eth.getBlockNumber());
  if (!st.lastBlock) { st.lastBlock = head; return []; }
  const from = Math.max(st.lastBlock + 1, head - 300);
  if (from > head) return [];
  decimals = Number(await eth.readContract({ address: config.token.address as `0x${string}`, abi: erc20Abi, functionName: "decimals" }).catch(() => 18));
  const logs = await eth.getLogs({ address: config.token.address as `0x${string}`, event: TRANSFER, args: { from: m.pools as `0x${string}`[] }, fromBlock: BigInt(from), toBlock: BigInt(head) });
  st.lastBlock = head;
  const byTx = new Map<string, { value: bigint; block: bigint }>();
  const ours = new Set(Object.values(launchState()?.contracts ?? {}).map((a) => a.toLowerCase()));
  for (const l of logs) {
    if (ours.has(String(l.args.to).toLowerCase())) continue; // the hook's fee, not a buy
    const k = l.transactionHash!;
    const cur = byTx.get(k) ?? { value: 0n, block: l.blockNumber! };
    cur.value += l.args.value ?? 0n;
    byTx.set(k, cur);
  }
  const buys: Buy[] = [];
  for (const [tx, { value, block }] of byTx) {
    const t = await eth.getTransactionReceipt({ hash: tx as `0x${string}` }).catch(() => null);
    if (!t) continue;
    const buyer = t.from;
    const tokens = Number(value / 10n ** BigInt(Math.max(0, decimals - 6))) / 10 ** Math.min(6, decimals);
    const bal = async (b?: bigint) => Number((await eth.readContract({ address: config.token.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [buyer], blockNumber: b }).catch(() => 0n)) / 10n ** BigInt(Math.max(0, decimals - 6))) / 10 ** Math.min(6, decimals);
    const before = await bal(block - 1n);
    const value$ = tokens * m.priceUsd;
    if (value$ < config.buyMinUsd) continue;
    const wallet = await walletUsd(buyer as `0x${string}`, m).catch(() => 0);
    buys.push({ usd: value$, imd: config.imdUsd ? value$ / config.imdUsd : 0, tokens, buyer, tx, newHolder: before === 0, position: before > 0 ? (tokens / before) * 100 : 0, mcap: m.mcap, liquidity: m.liquidity, wallet });
  }
  return buys;
}

const STAKED = parseAbiItem("event Staked(address indexed account, uint256 amount, uint256 unlockAt)");
const tok = (v: bigint) => Number(v / 10n ** 12n) / 1e6;

/**
 * Stakes and burns, from the chain: the dev's stake is announced as the dev's, with its lock;
 * burns are SHIFT sent to 0x…dEaD and IMD sent to IMD's BurnExecutor by our fee splitter.
 */
async function scanShiftEvents(st: State): Promise<void> {
  const l = launchState();
  const c = l?.contracts;
  if (!l?.open || !c?.token) return;
  const head = Number(await eth.getBlockNumber());
  if (!st.eventsBlock) { st.eventsBlock = head; return; }
  const from = Math.max(st.eventsBlock + 1, head - 300);
  if (from > head) return;
  const range = { fromBlock: BigInt(from), toBlock: BigInt(head) };
  const sym = esc(config.token.symbol);
  if (c.rewards) {
    for (const s of await eth.getLogs({ address: c.rewards as `0x${string}`, event: STAKED, ...range }).catch(() => [])) {
      const who = String(s.args.account).toLowerCase();
      const amount = tok(s.args.amount ?? 0n);
      const block = await eth.getBlock({ blockNumber: s.blockNumber! }).catch(() => null);
      const months = block && s.args.unlockAt ? Math.round((Number(s.args.unlockAt) - Number(block.timestamp)) / (30.44 * 86400)) : 0;
      const lock = months >= 1 ? ` for <b>${months} month${months === 1 ? "" : "s"}</b>` : "";
      const tx = `<a href="https://etherscan.io/tx/${s.transactionHash}">TX</a>`;
      if (who === DEV_WALLET) {
        await toCommunity(`👨‍💻 <b>Developer just staked ${num(amount)} $${sym}</b>${lock}

Locked in the staking contract, earning from the same 5% sell fee as everyone.

${tx}`, [[{ text: "🔒 Stake too", url: `${config.publicUrl}/token` }]], "milestone");
        housePost(`👨‍💻 Developer just staked ${num(amount)} $${config.token.symbol}${months >= 1 ? ` for ${months} months` : ""}. ${config.publicUrl}/token`, `dev-stake-${s.transactionHash}`);
      } else if (amount * (market?.priceUsd ?? 0) >= config.buyMinUsd) {
        await toCommunity(`🔒 <b>New stake: ${num(amount)} $${sym}</b>${lock}
👤 <a href="https://etherscan.io/address/${who}">${short(who)}</a>

${tx}`, [[{ text: "🔒 Stake", url: `${config.publicUrl}/token` }]], "milestone");
      }
    }
  }
  if (c.splitter) {
    const burns: [string, string, string, "burnedShift" | "burnedImd"][] = [[c.token, DEAD, `$${sym}`, "burnedShift"], [IMD_TOKEN, IMD_BURN_EXECUTOR, "IMD", "burnedImd"]];
    for (const [address, to, label, key] of burns) {
      // IMD bought for the burn may reach the BurnExecutor straight from the swap: count a transfer
      // when our splitter took part in the same transaction.
      for (const b of await eth.getLogs({ address: address as `0x${string}`, event: TRANSFER, args: { to: to as `0x${string}` }, ...range }).catch(() => [])) {
        const r = await eth.getTransactionReceipt({ hash: b.transactionHash! }).catch(() => null);
        if (!r?.logs.some((x) => x.address.toLowerCase() === c.splitter!.toLowerCase()) && String(b.args.from).toLowerCase() !== c.splitter!.toLowerCase()) continue;
        const amount = tok(b.args.value ?? 0n);
        st[key] = (st[key] ?? 0) + amount;
        if (key === "burnedShift") liveBus.emit("shift.burn", { amount });
        await toCommunity(`🔥 <b>${num(amount)} ${label} burned</b>

${label === "IMD"
  ? "The NIGHTSHIFT keeper bought it with the sell-fee burn reserve and sent it straight to IMD's BurnExecutor."
  : `Sent to 0x…dEaD from the sell fee.`} 20% of every NIGHTSHIFT fee is burned.
Burned so far: <b>${num(st.burnedShift ?? 0)} $${sym}</b> · <b>${num(st.burnedImd ?? 0)} IMD</b>

<a href="https://etherscan.io/tx/${b.transactionHash}">TX</a>`, [[{ text: "🪙 Token page", url: `${config.publicUrl}/token` }]], "milestone");
      }
    }
  }
  st.eventsBlock = head;
}

/** The branded loop for a kind of message (served from the site's /bot folder). */
export type Anim = "buy" | "whale" | "raid" | "launch" | "sale" | "milestone" | "welcome" | "post" | "alert" | "report" | "frog";
export const anim = (k: Anim): string => (!config.botAnimations ? "" : k === "frog" ? `${config.publicUrl}/bot/frog-mint.mp4` : (k === "buy" || k === "whale") && config.buyMedia ? config.buyMedia : `${config.publicUrl}/bot/${k}.mp4`);

/** Sends a card with its animation on top; long texts go as a plain message. */
export async function sendCard(chat: string, kind: Anim, text: string, buttons?: Button[][]): Promise<boolean> {
  const media = text.length <= 1024 ? anim(kind) : "";
  return media ? telegramMedia(config.telegramToken, chat, media, text, buttons) : telegram(config.telegramToken, chat, text, buttons);
}

/** Posts a card to every community chat. */
export async function toCommunity(text: string, buttons: Button[][] | undefined, kind: Anim): Promise<boolean> {
  if (!config.telegramToken) return false;
  const r = await Promise.all(chats().map((c) => sendCard(c, kind, text, buttons)));
  return r.some(Boolean);
}

/** A raid: a new X post, with one-tap like, repost and reply buttons. */
export async function raid(url: string, note = ""): Promise<boolean> {
  const id = url.match(/status(?:es)?\/(\d+)/)?.[1];
  if (!id) return false;
  const text = [
    "🚨 <b>NEW POST ON X · RAID TIME</b> 🌙", "",
    ...(note ? [esc(note), ""] : []),
    "Give it some love, crew:",
    "❤️ Like  ·  🔁 Repost  ·  💬 Reply with something smart", "",
    "The algorithm rewards the first hour. Go go go 🐸", "",
    url,
  ].join("\n");
  const buttons: Button[][] = [
    [{ text: "❤️ Like", url: `https://x.com/intent/like?tweet_id=${id}` }, { text: "🔁 Repost", url: `https://x.com/intent/retweet?tweet_id=${id}` }],
    [{ text: "💬 Reply", url: `https://x.com/intent/tweet?in_reply_to=${id}` }, { text: "👀 Open post", url }],
  ];
  if (!config.telegramToken) return false;
  const markup = { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, url: b.url }))) };
  const sent = await Promise.all(chats().map(async (c) => {
    const media = anim("raid");
    const r = (media ? await tgCall<{ message_id: number }>(config.telegramToken, "sendAnimation", { chat_id: c, animation: media, caption: text.slice(0, 1024), parse_mode: "HTML", reply_markup: markup }) : null)
      ?? await tgCall<{ message_id: number }>(config.telegramToken, "sendMessage", { chat_id: c, text, parse_mode: "HTML", link_preview_options: { url, prefer_large_media: true }, reply_markup: markup });
    if (r && config.raidPin) void tgCall(config.telegramToken, "pinChatMessage", { chat_id: c, message_id: r.message_id, disable_notification: false });
    return Boolean(r);
  }));
  return sent.some(Boolean);
}

type BskyPost = { post: { uri: string; record: { createdAt?: string } } };
/**
 * The account's posts to bring to the chat, oldest first: each one once, only newer than the newest one
 * already brought, under a day old, two at a time. A feed that answers in another order or without its
 * newest post can never bring old posts back. The first look only remembers what is there.
 */
export function bskyFresh<T extends BskyPost>(st: State, posts: T[], now: number): T[] {
  const at = (f: BskyPost) => Date.parse(f.post.record.createdAt ?? "") || 0;
  const done = new Set(st.bskyPosted ?? []), since = Date.parse(st.bskyAt ?? "") || 0;
  const newest = posts.reduce((m, f) => Math.max(m, at(f)), 0);
  if (!st.bskyAt) {
    st.bskyAt = new Date(newest || now).toISOString();
    st.bskyPosted = [...done, ...posts.map((f) => f.post.uri)].slice(-200);
    return [];
  }
  const fresh = posts.filter((f) => !done.has(f.post.uri) && at(f) > since && now - at(f) < 86_400_000).sort((a, b) => at(a) - at(b)).slice(0, 2);
  for (const f of fresh) done.add(f.post.uri);
  st.bskyPosted = [...done].slice(-200);
  if (fresh.length) st.bskyAt = new Date(Math.max(since, ...fresh.map(at))).toISOString();
  return fresh;
}

/** New posts on the project's Bluesky account, from Bluesky's free public API. */
async function scanBluesky(st: State): Promise<void> {
  if (!config.blueskyHandle) return;
  const r = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(config.blueskyHandle)}&filter=posts_no_replies&limit=5`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) return;
  const d = (await r.json()) as { feed?: { post: { uri: string; author: { handle: string }; record: { text?: string; createdAt?: string } }; reason?: unknown }[] };
  const posts = (d.feed ?? []).filter((f) => !f.reason && f.post.author.handle === config.blueskyHandle.replace(/^@/, ""));
  for (const f of bskyFresh(st, posts, Date.now())) {
    const url = `https://bsky.app/profile/${f.post.author.handle}/post/${f.post.uri.split("/").pop()}`;
    await toCommunity(`🦋 <b>New on Bluesky</b>\n\n${esc((f.post.record.text ?? "").slice(0, 600))}\n\nLike and repost it 🌙`, [[{ text: "🦋 Open on Bluesky", url }]], "post");
  }
}

/** The welcome for people who join the community chat. */
export function welcome(names: string[]): { text: string; buttons: Button[][] } {
  const sym = config.token.symbol;
  return {
    text: [
      `🌙 gm ${names.map(esc).join(", ")}, welcome to the night crew.`, "",
      "NIGHTSHIFT turns one sentence into an AI company, built by the IMD swarm while you sleep.", "",
      config.token.address ? `🪙 $${esc(sym)}: <code>${config.token.address}</code>` : `🪙 $${esc(sym)}: coming soon. The contract is only ever posted by the team, here and on the site.`,
      "⚠️ Admins never DM first. Nobody here will ask for your seed phrase.",
      "", "/ca · /price · /links · /community · /games · /frogs · /memes",
    ].join("\n"),
    buttons: [[{ text: "🌐 Website", url: config.publicUrl }, { text: "𝕏 Follow", url: config.xUrl }], [{ text: "👥 Join the X community", url: config.xCommunityUrl }], [{ text: "🚀 Launch a company", url: `${config.publicUrl}/launch` }]],
  };
}

export const MEMES_URL = "https://t.me/+GGNTd12GmRIyMDVh";
export const OPENSEA_URL = "https://opensea.io/collection/night-frogs-825445489";

/** Commands anyone in the community may use. Null when the command is not a public one. */
export async function publicCommand(cmd: string, args: string[] = []): Promise<{ text: string; buttons?: Button[][]; animation?: string; photo?: string } | null> {
  const sym = esc(config.token.symbol);
  const links: Button[][] = [[{ text: "🌐 Website", url: config.publicUrl }, { text: "𝕏 X", url: config.xUrl }], [{ text: "👥 X community", url: config.xCommunityUrl }], [{ text: "💬 Telegram", url: config.telegramUrl }, { text: "🦋 Bluesky", url: `https://bsky.app/profile/${config.blueskyHandle}` }], [{ text: "🌊 NIGHT FROGS on OpenSea", url: OPENSEA_URL }], [{ text: "👨‍💻 Developer · @probert_mihai", url: "https://x.com/probert_mihai" }]];
  if (cmd === "forge" || cmd === "forges" || cmd === "watchers") return forgeReply(args);
  if (cmd === "memes" || cmd === "meme" || cmd === "art") return { text: "🎨 <b>NIGHTSHIFT memes &amp; art</b>\nAll the memes and art from the night crew are posted here. Join and share yours 🐸", buttons: [[{ text: "🎨 Open memes & art", url: MEMES_URL }]] };
  if (cmd === "pinball") {
    const b = (() => { try { return pinballBoard() as { board?: { name: string; score: number }[]; best?: { name: string; score: number }[] }; } catch { return {}; } })();
    const rows = (b.best ?? []).slice(0, 5).map((s, i) => `${["🥇", "🥈", "🥉", "4.", "5."][i]} ${esc(s.name)} · ${s.score.toLocaleString("en-US")}`);
    return { text: ["🎱 <b>SPACE PINBALL</b>", "PvP duels on the same table and seed: black holes throw meteors at your rival, the frog crew sends heavy gravity. Every score is replayed and verified by the server.", "", rows.length ? "<b>All-time best</b>" : "The board is open: be the first.", ...rows, "", INSTALL].join("\n"), buttons: [[{ text: "🎱 Play Space Pinball", url: `${config.publicUrl}/games/pinball` }]] };
  }
  if (cmd === "chess") {
    return { text: ["♟ <b>NIGHT CHESS</b>", "3D real-time chess on a NIGHTSHIFT board: blitz 3+2 and 5+0, rapid 10+0, rated, clocks kept by the server. No rival online? Play Frog #7, the bot.", "", "Live on the website: free and rated, or staked in IMD and $SHIFT through the GameEscrow contract.", "", INSTALL].join("\n"), buttons: [[{ text: "♟ Play NIGHT CHESS", url: `${config.publicUrl}/games/chess` }]] };
  }
  if (cmd === "pool" || cmd === "8ball" || cmd === "billiards") {
    return { text: ["🎱 <b>NIGHT POOL</b>", "3D 8-ball on WPA rules: called shots, the open table, ball in hand after a foul, the 8 in the called pocket. Every shot is simulated by the server, the same for both players and every spectator.", "", "Live on the website: free and rated, or staked in IMD and $SHIFT. Collect numbered cues, cloths and tables in your locker.", "", INSTALL].join("\n"), buttons: [[{ text: "🎱 Play NIGHT POOL", url: `${config.publicUrl}/games/pool` }]] };
  }
  // /play belongs to the group's music bot
  if (cmd === "games" || cmd === "game" || cmd === "arcade") {
    // the Game Room: what is live, tonight's best, where to play
    const top = (() => { try { const b = pinballBoard() as { board?: { name: string; score: number }[] }; return b.board?.[0]; } catch { return undefined; } })();
    return { text: [
      "🎮 <b>NIGHTSHIFT GAME ROOM</b> · on the website", "",
      "🎱 <b>Space Pinball</b> · live, free", "PvP duels on the same table and seed, every score verified by replay. Solo board too.",
      top ? `🥇 Tonight's best: <b>${esc(top.name)}</b> · ${top.score.toLocaleString("en-US")}` : "🥇 Tonight's board is open: be the first.", "",
      "♟ <b>NIGHT CHESS</b> · live, free", "3D real-time chess: blitz and rapid, rated, or practise against the bot.", "",
      "🎱 <b>NIGHT POOL</b> · live, free", "3D 8-ball on WPA rules, every shot simulated by the server, rated.", "",
      "<b>Planned</b>",
      "🪙 Frog Flip · two players, one coin, randomness from Chainlink VRF",
      "✊ Rock, Paper, Frog · secret picks, then reveal",
      "🎲 Night Dice · highest roll takes the pot",
      "🏁 Moon Race · a short race of reflexes", "",
      "💎 Staked duels in IMD and $SHIFT are live on the website: both stakes sit in the GameEscrow contract, the winner takes 95% and a draw refunds both.", "",
      INSTALL,
    ].join("\n"), buttons: [[{ text: "🎱 Space Pinball", url: `${config.publicUrl}/games/pinball` }, { text: "♟ NIGHT CHESS", url: `${config.publicUrl}/games/chess` }], [{ text: "🎱 NIGHT POOL", url: `${config.publicUrl}/games/pool` }, { text: "🎮 The Game Room", url: `${config.publicUrl}/games` }]] };
  }
  if (cmd === "frogs" || cmd === "opensea" || cmd === "nft" || cmd === "nfts") return { text: "🐸 <b>NIGHT FROGS</b>\n500 onchain frogs, the crew of the 3 AM shift. Holders share half of every NIGHTSHIFT reward, by shift hours.\n\nOnly trust this collection link.", buttons: [[{ text: "🌊 NIGHT FROGS on OpenSea", url: OPENSEA_URL }], [{ text: "🐸 Rewards and the crew", url: `${config.publicUrl}/frogs` }]] };
  if (cmd === "links" || cmd === "site") return { text: "🌙 <b>NIGHTSHIFT links</b>\nOnly trust these.", buttons: links };
  if (cmd === "community" || cmd === "x") return { text: "👥 <b>The NIGHTSHIFT community on X</b>\nThe night crew on X: updates first, the builders, the companies and the frogs. Join, post your company, your frog, your wins.", buttons: [[{ text: "👥 Join the X community", url: config.xCommunityUrl }], [{ text: "𝕏 Follow @nightshiftimd", url: config.xUrl }]] };
  if (cmd === "ca" || cmd === "contract") {
    return config.token.address
      ? { text: `🪙 <b>$${sym}</b> on Ethereum\n<code>${config.token.address}</code>\n\nTap to copy. Paired with ETH on Uniswap v4. The only official contract: always check it on getnightshift.tech.`, buttons: [[{ text: "🌙 Buy on NIGHTSHIFT", url: `${config.publicUrl}/swap` }, ...(config.token.buyUrl ? [{ text: "🦄 Uniswap", url: config.token.buyUrl }] : [])], [{ text: "🧾 Etherscan", url: `https://etherscan.io/token/${config.token.address}` }, { text: "📊 Chart", url: `https://dexscreener.com/ethereum/${config.token.address}` }]] }
      : { text: `🪙 <b>$${sym}</b> is not launched yet.\nThe contract will be posted here, on X and on the site. Anything else is a scam.`, buttons: [[{ text: "Token page", url: `${config.publicUrl}/token` }]] };
  }
  if (cmd === "price" || cmd === "chart" || cmd === "mc") {
    const m = await marketSnapshot();
    if (!m) return publicCommand("ca");
    return { text: `📈 <b>$${sym}</b>\nPrice $${m.priceUsd < 0.01 ? m.priceUsd.toPrecision(3) : m.priceUsd.toFixed(4)}\nMarket cap <b>${usd(m.mcap)}</b>\nLiquidity ${usd(m.liquidity)}\nIMD $${config.imdUsd.toFixed(2)}`, buttons: [[{ text: "📊 Chart", url: m.chart }, ...(config.token.buyUrl ? [{ text: "🟢 Buy", url: config.token.buyUrl }] : [])]] };
  }
  return null;
}

/** Runs the watchers. Every step is free and safe to retry. */
export function startCommunity(): void {
  if (!config.telegramToken || !chats().length) return;
  void learnCommunityIds().catch(() => {});
  const st = load();
  const tick = async () => {
    try {
      // Launch day: nothing about the token reaches the group before the main "IS LIVE" post.
      const l = launchState();
      const quiet = Boolean(l && !l.announced);
      if (config.token.address && !quiet) {
        for (const b of await scanBuys(st)) {
          const c = buyCard(b);
          await toCommunity(c.text, c.buttons, b.usd >= 2500 || (b.wallet ?? 0) >= 10_000 ? "whale" : "buy");
          const liveTrade = await eth.getTransaction({ hash: b.tx as `0x${string}` }).catch(() => null);
          liveBus.emit("shift.buy", { usd: b.usd, eth: liveTrade ? Number(liveTrade.value) / 1e18 : null, buyer: b.buyer, test: b.test });
          st.buys = (st.buys ?? 0) + 1;
        }
        const m = market;
        const hit = m ? MILESTONES.filter((x) => m.mcap >= x).pop() : undefined;
        if (m && st.milestone === undefined) st.milestone = hit ?? 0;
        else if (m && hit && hit > (st.milestone ?? 0)) {
          await toCommunity(`🏆 <b>$${esc(config.token.symbol)} just crossed ${usd(hit)} market cap!</b>\n\nThe night shift keeps building 🌙🐸`, [[{ text: "📊 Chart", url: m.chart }]], "milestone");
          housePost(`🏆 $${config.token.symbol} just crossed ${usd(hit)} market cap. The night shift keeps building. ${config.publicUrl}/token`, `milestone-${hit}`);
          st.milestone = hit;
        }
      }
      if (!quiet) await scanShiftEvents(st).catch((e) => console.error("shift events", (e as Error).message));
      await scanBluesky(st).catch(() => undefined);
    } catch (e) { console.error("community", (e as Error).message); }
    save(st);
    setTimeout(() => void tick(), 20_000);
  };
  void tick();
}
