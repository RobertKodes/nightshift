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

type State = { block?: number; listedAt?: number; seen?: string[] };
const file = () => join(config.dataDir, "frogmarket.json");
const load = (): State => { try { return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {}; } catch { return {}; } };
const save = (s: State) => writeFileSync(file(), JSON.stringify(s));

/** Frog sales since the last call (the first call only marks where to start). */
export async function newFrogSales(): Promise<FrogSale[]> {
  const nft = (config.nft.address || "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c").toLowerCase();
  const st = load();
  const head = Number(await eth.getBlockNumber());
  if (!st.block) { st.block = head; save(st); return []; }
  const from = Math.max(st.block + 1, head - 600);
  if (from > head) return [];
  const logs = await eth.getLogs({ address: SEAPORT, event: FULFILLED, fromBlock: BigInt(from), toBlock: BigInt(head) });
  st.block = head;
  save(st);
  const out: FrogSale[] = [];
  for (const l of logs) {
    const { offerer, recipient, offer = [], consideration = [] } = l.args;
    if (!offerer || !recipient) continue;
    // A listing filled: the seller offers the frog, the buyer pays ETH. An offer accepted: the buyer offers WETH, the frog is in the consideration.
    const listed = offer.find((i) => i.token.toLowerCase() === nft && (i.itemType === 2 || i.itemType === 4));
    const bid = consideration.find((i) => i.token.toLowerCase() === nft && (i.itemType === 2 || i.itemType === 4));
    if (!listed && !bid) continue;
    const pay = listed ? consideration.filter((i) => i.itemType === 0 || i.token.toLowerCase() === WETH) : offer.filter((i) => i.itemType === 0 || i.token.toLowerCase() === WETH);
    const total = pay.reduce((s, i) => s + i.amount, 0n);
    out.push({
      id: Number((listed ?? bid)!.identifier), eth: Number(formatEther(total)),
      buyer: listed ? recipient : offerer, seller: listed ? offerer : (bid as { recipient: string }).recipient, tx: l.transactionHash!,
    });
  }
  return out;
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
  const out: FrogListing[] = [];
  let latest = after;
  for (const e of d.asset_events ?? []) {
    latest = Math.max(latest, e.event_timestamp);
    const key = e.order_hash ?? `${e.asset?.identifier}-${e.event_timestamp}`;
    if (seen.has(key) || !e.asset?.identifier || !e.payment?.quantity) continue;
    seen.add(key);
    out.push({ id: Number(e.asset.identifier), eth: Number(e.payment.quantity) / 10 ** (e.payment.decimals ?? 18), seller: e.maker ?? "", url: e.asset.opensea_url ?? `https://opensea.io/collection/${OPENSEA_SLUG}` });
  }
  st.listedAt = latest;
  st.seen = [...seen].slice(-200);
  save(st);
  return out;
}
