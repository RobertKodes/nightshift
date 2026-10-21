import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAbi } from "viem";
import { writeAtomic } from "./atomic.js";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { frogOf } from "./forge.js";
import { OPENSEA_SLUG } from "./frogmarket.js";
import { type Button, esc, tgCall } from "./social.js";

/**
 * The NIGHT FROGS market card: the frog's own picture, its rarity rank, its traits (each one a link to
 * every frog listed with it) and the cheapest listing per trait. Traits are read once from the onchain
 * tokenURIs and kept, since they never change after the reveal.
 */
const FROGS = () => (config.nft.address || "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c") as `0x${string}`;
const ABI = parseAbi(["function tokenURI(uint256) view returns (string)"]);
const SUPPLY = 500;

type Traits = Record<string, string>;
type Book = { traits: Record<number, Traits> };
const file = () => join(config.dataDir, "frog-traits.json");
let book: Book = { traits: {} };
try { if (existsSync(file())) book = JSON.parse(readFileSync(file(), "utf8")); } catch { /* rebuilt below */ }

async function readTraits(id: number): Promise<Traits | null> {
  const uri = await eth.readContract({ address: FROGS(), abi: ABI, functionName: "tokenURI", args: [BigInt(id)] }).catch(() => null);
  if (!uri?.startsWith("data:application/json")) return null;
  try {
    const raw = uri.slice(uri.indexOf(",") + 1);
    const meta = JSON.parse(uri.slice(0, uri.indexOf(",")).endsWith(";base64") ? Buffer.from(raw, "base64").toString("utf8") : decodeURIComponent(raw));
    const out: Traits = {};
    for (const a of meta.attributes ?? []) if (a?.trait_type && a.value != null) out[String(a.trait_type)] = String(a.value);
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

let filling: Promise<void> | null = null;
/** Reads every frog's traits once (a few at a time), so ranks cover the whole collection. */
export function fillTraits(): Promise<void> {
  filling ??= (async () => {
    const todo = Array.from({ length: SUPPLY }, (_, i) => i + 1).filter((id) => !book.traits[id]);
    for (let i = 0; i < todo.length; i += 5) {
      const got = await Promise.all(todo.slice(i, i + 5).map(async (id) => [id, await readTraits(id)] as const));
      for (const [id, t] of got) if (t) book.traits[id] = t;
    }
    if (todo.length) writeAtomic(file(), JSON.stringify(book));
  })().finally(() => { filling = null; });
  return filling;
}

/**
 * Rank by summed trait rarity over the 7 art layers (1 = rarest; #1 is the 1-of-1), the same table the
 * Forge uses. Edition and Signature are not art layers and are left out.
 */
function rank(id: number): { rank: number; of: number; tier: string } | null {
  const f = frogOf(id);
  return f ? { rank: f.rank, of: SUPPLY, tier: f.tier } : null;
}

let floors: { at: number; prices: Map<number, number> } | null = null;
/** The cheapest active OpenSea listing per frog, kept five minutes. */
async function listedPrices(): Promise<Map<number, number>> {
  if (floors && Date.now() - floors.at < 300_000) return floors.prices;
  const prices = new Map<number, number>();
  if (!config.openseaKey) return prices;
  let next = "";
  for (let page = 0; page < 6; page++) {
    const r = await fetch(`https://api.opensea.io/api/v2/listings/collection/${OPENSEA_SLUG}/best?limit=100${next ? `&next=${encodeURIComponent(next)}` : ""}`,
      { headers: { "x-api-key": config.openseaKey, accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) break;
    const d = (await r.json()) as { listings?: { price?: { current?: { value?: string; decimals?: number } }; protocol_data?: { parameters?: { offer?: { identifierOrCriteria?: string }[] } } }[]; next?: string };
    for (const l of d.listings ?? []) {
      const id = Number(l.protocol_data?.parameters?.offer?.[0]?.identifierOrCriteria);
      const v = Number(l.price?.current?.value) / 10 ** (l.price?.current?.decimals ?? 18);
      if (Number.isFinite(id) && v > 0 && (!prices.has(id) || v < prices.get(id)!)) prices.set(id, v);
    }
    if (!d.next) break;
    next = d.next;
  }
  floors = { at: Date.now(), prices };
  return prices;
}

const ICON: Record<string, string> = { Background: "🌌", Body: "👕", Skin: "🐸", Mouth: "👄", Eyes: "👀", Headwear: "🧢", Accessory: "📿", Edition: "⭐", Signature: "✍️" };
const traitUrl = (k: string, v: string) => `https://opensea.io/collection/${OPENSEA_SLUG}?traits=${encodeURIComponent(JSON.stringify([{ traitType: k, values: [v] }]))}`;
const eth4 = (n: number) => (n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n.toFixed(4)).replace(/\.?0+$/, "");
/** What Telegram counts against the 1024-character caption limit: the text without its HTML tags. */
const visible = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot);/g, "x").length;

export type FrogEvent = { kind: "sold" | "listed"; id: number; eth: number; usd?: number; buyer?: string; seller?: string; tx?: string; url?: string };

/** Builds the card's caption: headline, price, rank, a traits quote and the trait floors. */
export async function frogCaption(e: FrogEvent, who: (a: string) => string): Promise<string> {
  if (!book.traits[e.id]) { const t = await readTraits(e.id); if (t) book.traits[e.id] = t; }
  void fillTraits().catch(() => {});
  const t = book.traits[e.id];
  const head = e.kind === "sold" ? `🐸💰 <b>SOLD · NIGHT FROG #${e.id}</b>` : `🐸🏷 <b>LISTED · NIGHT FROG #${e.id}</b>`;
  const price = `💵 <b>${eth4(e.eth)} ETH</b>${e.usd ? ` (≈ $${e.usd.toFixed(0)})` : ""}`;
  const r = rank(e.id);
  const lines = [head, price];
  if (r) lines.push(`🏆 Rarity <b>${r.rank}</b>/${r.of} · ${r.tier}`);
  if (e.kind === "sold") { if (e.buyer) lines.push(`👤 Buyer ${who(e.buyer)}`); if (e.seller) lines.push(`🏷 Seller ${who(e.seller)}`); }
  else if (e.seller) lines.push(`👤 ${who(e.seller)}`);
  let body = lines.join("\n");
  if (t) {
    const shown = Object.entries(t).filter(([k]) => k !== "Signature");
    body += `\n<blockquote>${shown.map(([k, v]) => `${ICON[k] ?? "▫️"} <a href="${traitUrl(k, v)}">${esc(k)}: ${esc(v)}</a>`).join("\n")}</blockquote>`;
    const prices = await listedPrices().catch(() => new Map<number, number>());
    const floorsOf = shown.map(([k, v]) => {
      let best = Infinity;
      for (const [id, p] of prices) if (book.traits[id]?.[k] === v && p < best) best = p;
      return Number.isFinite(best) ? `🔸 ${esc(v)} · ${eth4(best)} ETH` : null;
    }).filter(Boolean);
    if (floorsOf.length) {
      const withFloors = `${body}\n<blockquote expandable>💧 <b>Trait floors</b>\n${floorsOf.join("\n")}</blockquote>`;
      if (visible(withFloors) <= 1000) body = withFloors;
    }
    body += `\n👆 <i>Tap a trait to see every frog listed with it</i>`;
  }
  if (e.tx) body += `\n<a href="https://etherscan.io/tx/${e.tx}">TX</a>`;
  return body;
}

/** Sends the card as a photo with the caption; false if Telegram refused it. */
export async function sendFrogCard(chat: string, id: number, caption: string, buttons: Button[][]): Promise<boolean> {
  const photo = `${config.publicUrl}/api/pinball/frog/${id}.png`;
  const markup = { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, url: b.url }))) };
  return Boolean(await tgCall(config.telegramToken, "sendPhoto", { chat_id: chat, photo, caption, parse_mode: "HTML", reply_markup: markup }));
}
