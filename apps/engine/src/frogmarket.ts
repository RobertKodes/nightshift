import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther, parseAbiItem } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";

/**
 * NIGHT FROGS on the secondary market, for the community chat. Sales are read from Seaport's own
 * OrderFulfilled events on Ethereum, so they need no API key. New listings live off chain at
 * OpenSea and are read from its events API only when an OPENSEA_API_KEY is set.
 */
const SEAPORT = "0x0000000000000068F116a894984e2DB1123eB395";
const FULFILLED = parseAbiItem("event OrderFulfilled(bytes32 orderHash, address indexed offerer, address indexed zone, address recipient, (uint8 itemType, address token, uint256 identifier, uint256 amount)[] offer, (uint8 itemType, address token, uint256 identifier, uint256 amount, address recipient)[] consideration)");
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
export const OPENSEA_SLUG = "night-frogs-825445489";

export type FrogSale = { id: number; eth: number; buyer: string; seller: string; tx: string };
export type FrogListing = { id: number; eth: number; seller: string; url: string };

/** Frogs whose listing was announced, with its price and when: re-listings inside a day are not announced again. */
type Posted = Record<string, { eth: number; at: number }>;
type State = { block?: number; listedAt?: number; seen?: string[]; posted?: Posted };
/** Sellers' tools re-list a frog every few minutes, each time as a new order: one alert per frog a day... */
export const RELIST_QUIET_MS = 24 * 3_600_000;
/** ...unless the new price is at least 5% lower. */
const PRICE_CUT = 0.95;
const file = () => join(config.dataDir, "frogmarket.json");
const load = (): State => { try { return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {}; } catch { return {}; } };
/** Writes only these fields: the sales and listings reads share the file and run at the same moment. */
const patch = (p: State) => writeFileSync(file(), JSON.stringify({ ...load(), ...p }));

let reading = false;
/** Frog sales since the last call (the first call only marks where to start). */
export async function newFrogSales(): Promise<FrogSale[]> {
  if (reading) return []; // the last read is still going and covers these blocks
  reading = true;
  try { return await readSales(); } finally { reading = false; }
}

async function readSales(): Promise<FrogSale[]> {
  const nft = (config.nft.address || "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c").toLowerCase();
  const st = load();
  const head = Number(await eth.getBlockNumber());
  if (!st.block) { patch({ block: head }); return []; }
  const from = Math.max(st.block + 1, head - 600);
  if (from > head) return [];
  const logs = await eth.getLogs({ address: SEAPORT, event: FULFILLED, fromBlock: BigInt(from), toBlock: BigInt(head) });
  patch({ block: head });
  const sales = new Map<string, FrogSale>();
  const who = (a: string) => (/^0x0{40}$/i.test(a) ? "" : a);
  for (const l of logs) {
    const { offerer, recipient, offer = [], consideration = [] } = l.args;
    if (!offerer || !recipient) continue;
    // A listing filled: the seller offers the frog and the fulfiller pays. An offer accepted: the buyer offers WETH
    // and the fulfiller (the event's recipient) sends the frog. OpenSea matches an accepted offer with a mirror
    // order, so one sale can log twice: both are merged into one sale per transaction and frog.
    const listed = offer.find((i) => i.token.toLowerCase() === nft && (i.itemType === 2 || i.itemType === 4));
    const bid = consideration.find((i) => i.token.toLowerCase() === nft && (i.itemType === 2 || i.itemType === 4));
    if (!listed && !bid) continue;
    const pay = listed ? consideration.filter((i) => i.itemType === 0 || i.token.toLowerCase() === WETH) : offer.filter((i) => i.itemType === 0 || i.token.toLowerCase() === WETH);
    const total = Number(formatEther(pay.reduce((s, i) => s + i.amount, 0n)));
    const id = Number((listed ?? bid)!.identifier);
    const key = `${l.transactionHash}:${id}`;
    const s = sales.get(key) ?? { id, eth: 0, buyer: "", seller: "", tx: l.transactionHash! };
    if (listed) { s.seller ||= offerer; s.buyer ||= who(recipient); }
    else { s.buyer ||= offerer; s.seller ||= who(recipient); }
    s.eth = Math.max(s.eth, total);
    sales.set(key, s);
  }
  return [...sales.values()].filter((s) => !s.buyer || s.buyer.toLowerCase() !== s.seller.toLowerCase());
}

/** New OpenSea listings since the last call; nothing without an API key. */
export async function newFrogListings(): Promise<FrogListing[]> {
  if (!config.openseaKey) return [];
  const st = load();
  const after = st.listedAt ?? Math.floor(Date.now() / 1000);
  const r = await fetch(`https://api.opensea.io/api/v2/events/collection/${OPENSEA_SLUG}?event_type=listing&after=${after}&limit=20`, {
    headers: { "x-api-key": config.openseaKey, accept: "application/json" }, signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`opensea ${r.status}`);
  const d = (await r.json()) as { asset_events?: { event_timestamp: number; maker?: string; order_hash?: string; asset?: { identifier?: string; opensea_url?: string }; payment?: { quantity?: string; decimals?: number; symbol?: string } }[] };
  const seen = new Set(st.seen ?? []);
  const posted: Posted = { ...(st.posted ?? {}) };
  const now = Date.now();
  const out: FrogListing[] = [];
  let latest = after;
  // oldest first: a frog listed several times in one read is judged in the order it happened
  for (const e of [...(d.asset_events ?? [])].sort((a, b) => a.event_timestamp - b.event_timestamp)) {
    latest = Math.max(latest, e.event_timestamp);
    const key = e.order_hash ?? `${e.asset?.identifier}-${e.event_timestamp}`;
    if (seen.has(key) || !e.asset?.identifier || !e.payment?.quantity) continue;
    seen.add(key);
    const id = e.asset.identifier, eth = Number(e.payment.quantity) / 10 ** (e.payment.decimals ?? 18);
    const prev = posted[id];
    if (prev && now - prev.at < RELIST_QUIET_MS && eth > prev.eth * PRICE_CUT) continue;
    posted[id] = { eth, at: now };
    out.push({ id: Number(id), eth, seller: e.maker ?? "", url: e.asset.opensea_url ?? `https://opensea.io/collection/${OPENSEA_SLUG}` });
  }
  for (const [id, p] of Object.entries(posted)) if (now - p.at >= RELIST_QUIET_MS) delete posted[id];
  patch({ listedAt: latest, seen: [...seen].slice(-500), posted });
  return out;
}
