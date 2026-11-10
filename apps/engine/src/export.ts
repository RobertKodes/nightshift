import { strToU8, zipSync } from "fflate";
import type { Company, Product } from "@nightshift/core";
import type { LedgerTx } from "@nightshift/ledger";
import type { Metrics } from "./store.js";

/**
 * No lock-in: everything a company is, made and earned, as one ZIP for its owner. The profile and
 * limits, every product with the file its buyers get and its listing images, every shift, the CEO's
 * log and chat, the posts, the connected accounts as the owner sees them, the books (CSV and the
 * ledger lines) and the sales. Not in it: any key or password (the wallet's key stays in the vault,
 * the money leaves through "withdraw"), and the files written for individual buyers, which are theirs.
 */
export interface ExportDeps {
  /** A product's text (Markdown), its download (ZIP) and its listing images. */
  text: (c: Company, p: Product) => string | null;
  bytes: (c: Company, p: Product) => { data: Buffer; name: string } | null;
  image: (c: Company, p: Product, name: string) => Buffer | null;
  ledger: (c: Company) => Promise<LedgerTx[]>;
  booksCsv: (c: Company) => Promise<string>;
  metrics: (c: Company) => Metrics;
  /** The site as HTML, when the engine itself serves it (the simulator). */
  siteHtml?: (c: Company) => string | null;
  publicUrl: string;
  mode: "sim" | "live";
  now?: () => number;
}

const safe = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w .()-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "product";
const json = (v: unknown) => strToU8(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2));
/** Above this the archive is refused rather than built in memory. */
export const EXPORT_MAX_BYTES = 400e6;

export async function exportCompany(c: Company, d: ExportDeps): Promise<{ zip: Uint8Array; name: string; files: string[] }> {
  const at = new Date((d.now ?? Date.now)()).toISOString();
  const out: Record<string, Uint8Array> = {};
  let size = 0;
  const add = (path: string, data: Uint8Array) => { size += data.length; if (size > EXPORT_MAX_BYTES) throw new Error("This company's files are too large to export in one archive. Download the products one by one from the Products table."); out[path] = data; };
  const m = d.metrics(c);
  const { chat, tasks, journal, marketing, connections, products, asks, ...profile } = c;
  add("company.json", json({ exportedAt: at, mode: d.mode, shop: `${d.publicUrl}/c/${c.slug}`, ...profile }));
  add("products.json", json(products));
  add("shifts.json", json(tasks));
  add("log.json", json(journal));
  add("chat.json", json(chat ?? []));
  add("posts.json", json({ drafts: marketing, posts: connections?.posts ?? [] }));
  add("connections.json", json({ gumroad: connections?.gumroad ?? null, channels: connections?.channels ?? {}, quiet: connections?.quiet ?? null, log: connections?.log ?? [] }));
  add("questions.json", json(asks ?? []));
  add("sales.json", json({ sales: m.sales, visits: m.visits.length, firstVisit: m.visits[0] ?? null, lastVisit: m.visits.at(-1) ?? null }));
  add("books.csv", strToU8(await d.booksCsv(c)));
  add("ledger.json", json(await d.ledger(c)));
  for (const [i, p] of products.entries()) {
    // numbered, so two products of one name never share a folder
    const dir = `products/${String(i + 1).padStart(2, "0")} ${safe(p.name)}`;
    add(`${dir}/product.json`, json(p));
    const text = d.text(c, p);
    if (text !== null) add(`${dir}/${p.format === "custom" ? "listing" : "product"}.md`, strToU8(text));
    const bin = d.bytes(c, p);
    if (bin) add(`${dir}/${safe(bin.name.replace(/\.zip$/i, ""))}.zip`, new Uint8Array(bin.data));
    for (const n of ["hero", "inside", "included"]) { const png = d.image(c, p, n); if (png) add(`${dir}/${n}.png`, new Uint8Array(png)); }
  }
  const html = d.siteHtml?.(c) ?? null;
  if (html) add("site/index.html", strToU8(html));
  add("site/where.txt", strToU8(c.site
    ? `Site: ${c.site.url}\n${c.site.cid ? `IPFS CID: ${c.site.cid}\nAny IPFS gateway serves it, for example https://ipfs.io/ipfs/${c.site.cid}/\nPin this CID with a pinning service to keep the site online yourself.\n` : "Its IPFS address was not recorded.\n"}IMD job: ${c.site.jobId}\n`
    : `This company has no site of its own. Its shop page is ${d.publicUrl}/c/${c.slug}\n`));
  const files = Object.keys(out);
  add("README.txt", strToU8(`${c.name}: everything this company is, made and earned
Exported ${at} from ${d.publicUrl} (${d.mode === "sim" ? "simulation: no real money" : "live"})

company.json      who it is, its limits, its wallet address, its settings
products.json     every product, with prices, sales and revenue
products/         one folder per product: the file its buyers get, its listing text, its listing images
shifts.json       every shift: what the CEO decided, why, what it cost, how it went
log.json          the CEO's log
chat.json         your chat with the CEO
posts.json        drafted posts and posts sent on your connected accounts
connections.json  your connected accounts as shown on the owner desk (no password or token is ever stored here)
questions.json    what the CEO asked you
sales.json        every sale and the number of visits
books.csv         the books, one line per ledger entry (opens in any spreadsheet)
ledger.json       the same entries in full
site/             where the site lives${html ? ", and its page" : ""}

Not in this archive: the wallet's private key (take the money out with "Withdraw" or "Stop and withdraw everything"),
any password or token of a connected account, and files written for individual buyers, which are theirs.
You may use all of it anywhere: the products are yours to sell on any other shop.
`));
  // PDFs, PNGs and ZIPs are already compressed: stored as they are, text deflated
  const zip = zipSync(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [v, { level: /\.(zip|png|pdf)$/i.test(k) ? 0 : 6 }]])) as never);
  return { zip, name: `${c.slug}-export-${at.slice(0, 10)}.zip`, files: [...files, "README.txt"] };
}
