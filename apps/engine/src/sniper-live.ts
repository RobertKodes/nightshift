import { type Address, erc20Abi, formatUnits, parseAbi } from "viem";
import { eth } from "./chain.js";
import { anim, chats, marketSnapshot } from "./community.js";
import { config } from "./config.js";
import { frogCount } from "./frogs.js";
import { dexQuotes } from "./imdmarket.js";
import { send as pushSend } from "./push.js";
import { context } from "./services/context.js";
import { inspectHook } from "./services/hook.js";
import type { LaunchDetail, LaunchRow } from "./services/imd.js";
import { liveNet, liveRpc } from "./services/net.js";
import { NATIVE, slot0 } from "./services/v4pool.js";
import { tokenVerdict } from "./services/verdict.js";
import { type Call, type MintPrice, type NftRead, type SniperDeps, createSniper, sniperFile, verdictLabel } from "./sniper.js";
import { kb, tgCall } from "./social.js";
import { holderStatus } from "./token.js";

/** NIGHT SNIPER on the live network: IMD's API, Ethereum, the community chat and app notifications. */

const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";

/** A holder, for the sniper: $SHIFT above the holder line, or a NIGHT FROG. */
export const holds = async (wallet: string) => (await holderStatus(wallet)).holds || (await frogCount(wallet)) > 0;

const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
let eth$: { at: number; usd: number } | null = null;
/** ETH in dollars: the $SHIFT market's own figure, else WETH's deepest stablecoin pair on DexScreener (kept 10 minutes). */
async function ethUsd(): Promise<number> {
  const m = (await marketSnapshot().catch(() => null))?.ethUsd;
  if (m) return m;
  if (eth$ && Date.now() - eth$.at < 600_000) return eth$.usd;
  const pairs = await dexQuotes([WETH]).catch(() => new Map());
  const p = pairs.get(WETH);
  const usd = p && /^(USDC|USDT|DAI)$/.test(p.quoteToken.symbol) ? Number(p.priceUsd ?? 0) : 0;
  if (usd > 0) eth$ = { at: Date.now(), usd };
  return eth$?.usd ?? 0;
}

export async function quoteUsd(quote: Address): Promise<number> {
  if (quote === NATIVE) return ethUsd();
  return quote.toLowerCase() === IMD ? config.imdUsd : 0;
}

const IMD_API = "https://api.imd.fun";
const getJson = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return (await r.json()) as T;
};

/** Every IMD launch, newest first, paging back by launch number. */
async function allLaunches(): Promise<LaunchRow[]> {
  const out: LaunchRow[] = [];
  let before = "";
  for (let page = 0; page < 12; page++) {
    const rows = (await getJson<{ launches?: LaunchRow[] }>(`${IMD_API}/launches?limit=500${before ? `&before=${before}` : ""}`)).launches ?? [];
    out.push(...rows);
    if (rows.length < 500) break;
    before = String(rows.at(-1)!.launchNumber);
  }
  return out;
}

/** Where collections keep their cap and their price: the names IMD's builds and common templates use. */
const SUPPLY_FNS = ["maxSupply", "MAX_SUPPLY", "cap", "maxTokens", "MAX_TOKENS", "collectionSize"];
const PRICE_FNS = ["mintPrice", "MINT_PRICE", "price", "PRICE", "cost", "publicPrice"];
const TOKEN_FNS = ["IMD", "paymentToken", "PAYMENT_TOKEN", "payToken", "currency", "imd", "token"];
const call = async <T,>(address: Address, fn: string, out: "uint256" | "uint8" | "address" | "string" | "bool", args: unknown[] = [], inputs = ""): Promise<T | null> => {
  try { return (await eth.readContract({ address, abi: parseAbi([`function ${fn}(${inputs}) view returns (${out})`]), functionName: fn, args } as never)) as T; } catch { return null; }
};
const firstOf = async <T,>(address: Address, fns: string[], out: "uint256" | "address"): Promise<T | null> => {
  for (const fn of fns) { const v = await call<T>(address, fn, out); if (v !== null) return v; }
  return null;
};

/** An ERC-721 or ERC-1155 contract's name, supply, mint price and owner; null when it is neither. */
export async function readNft(address: Address): Promise<NftRead | null> {
  const is = (id: string) => call<boolean>(address, "supportsInterface", "bool", [id], "bytes4");
  const standard = (await is("0x80ac58cd")) ? "ERC-721" : (await is("0xd9b67a26")) ? "ERC-1155" : null;
  if (!standard) return null;
  const [name, symbol, minted, owner, cap, wei, payToken] = await Promise.all([
    call<string>(address, "name", "string"), call<string>(address, "symbol", "string"),
    standard === "ERC-721" ? call<bigint>(address, "totalSupply", "uint256") : Promise.resolve(null),
    call<Address>(address, "owner", "address"), firstOf<bigint>(address, SUPPLY_FNS, "uint256"),
    firstOf<bigint>(address, PRICE_FNS, "uint256"), firstOf<Address>(address, TOKEN_FNS, "address"),
  ]);
  let price: MintPrice | null = null;
  if (wei !== null) {
    // a payment token, when the contract names one, sets the unit; otherwise the price is in ETH
    const token = payToken && !/^0x0{40}$/i.test(payToken) ? payToken : null;
    const [dec, sym] = token ? await Promise.all([call<number>(token, "decimals", "uint8"), call<string>(token, "symbol", "string")]) : [18, "ETH"];
    price = { amount: Number(formatUnits(wei, Number(dec ?? 18))), unit: sym ?? "tokens" };
  }
  return {
    standard, name, symbol, owner: owner?.toLowerCase() ?? null, price,
    minted: minted !== null ? Number(minted) : null, maxSupply: cap !== null && cap > 0n && cap < 10n ** 12n ? Number(cap) : null,
  };
}

const noteOf = (c: Call) => ({
  title: c.type === "nft" ? `🖼 New NFT launch: ${c.name ?? c.symbol ?? `IMD #${c.launch}`}` : `🎯 ${c.symbol ? `$${c.symbol}` : c.name ?? "New IMD launch"} · ${verdictLabel(c.verdict)}`,
  body: `IMD launch #${c.launch}. ${c.summary} ${c.reasons.find((r) => r.impact === (c.verdict === "safe" ? "good" : c.verdict))?.text ?? ""}`.trim().slice(0, 180),
  url: `${config.publicUrl}/sniper?token=${c.token}`,
  tag: `sniper-${c.launch}`,
});

/** The live network, as NIGHT SNIPER's dependencies. */
export function liveDeps(): SniperDeps {
  const rpc = liveRpc(eth as never);
  const ctx = context({ net: liveNet, rpc, now: Date.now, etherscanKey: config.etherscanKey, watchtowerUrl: config.watchtowerUrl });
  return {
    now: Date.now,
    async launches() {
      const r = await fetch("https://api.imd.fun/launches?limit=50", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`api.imd.fun ${r.status}`);
      return ((await r.json()) as { launches?: LaunchRow[] }).launches ?? [];
    },
    allLaunches,
    detail: (id) => getJson<LaunchDetail>(`${IMD_API}/launches/${encodeURIComponent(id)}`),
    verdict: (token) => tokenVerdict(ctx, "ethereum", token, "quick"),
    hook: (address) => inspectHook(ctx, address, false),
    nft: readNft,
    slot0: (id) => slot0(rpc, id),
    decimals: async (token) => Number(await eth.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })),
    usdOf: quoteUsd,
    async post(text, buttons, replyTo) {
      if (!config.telegramToken) return [];
      const out: { chat: string; id: number }[] = [];
      for (const chat of chats()) {
        const reply = replyTo?.find((m) => m.chat === chat);
        const base = { chat_id: chat, parse_mode: "HTML", reply_markup: kb(buttons), ...(reply ? { reply_parameters: { message_id: reply.id, allow_sending_without_reply: true } } : {}) };
        // a new call carries the alert loop; replies are plain text under it
        const media = !reply && text.length <= 1024 ? anim("alert") : "";
        const sent = (media ? await tgCall<{ message_id: number }>(config.telegramToken, "sendAnimation", { ...base, animation: media, caption: text }) : null)
          ?? await tgCall<{ message_id: number }>(config.telegramToken, "sendMessage", { ...base, text, link_preview_options: { is_disabled: true } });
        if (sent?.message_id) out.push({ chat, id: sent.message_id });
      }
      return out;
    },
    async push(c, who) {
      // holders first; at the community's moment, everyone who was not told yet
      await pushSend("sniper", noteOf(c), who === "holders" ? "holders" : "others", holds);
    },
    delayMs: config.sniperDelayMs,
    file: sniperFile(),
  };
}

export const liveSniper = () => createSniper(liveDeps());
