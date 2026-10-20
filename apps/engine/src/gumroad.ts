import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import type { Company, Product } from "@nightshift/core";
import { fromUsdc } from "@nightshift/core";
import type { Ledger } from "@nightshift/ledger";
import { ApiError, type Http, clean } from "./channels.js";

/**
 * Selling on the owner's own Gumroad account, through Gumroad's API v2 with OAuth (the owner made the
 * account and connects it; NIGHTSHIFT never sees a password). A company makes each product there as a
 * draft from its own NIGHTSHIFT product, uploads the file, keeps price and text in step, and books
 * every Gumroad sale apart from USDC: Gumroad pays that money to the owner, not to the company wallet.
 */

export const GUMROAD_API = "https://api.gumroad.com/v2";
export const GUMROAD_AUTHORIZE = "https://gumroad.com/oauth/authorize";
export const GUMROAD_TOKEN = "https://api.gumroad.com/oauth/token";
/** Products and their files, sales (and the sale webhook), payouts. Not `account`, emails or refunds. */
export const GUMROAD_SCOPES = "edit_products view_sales view_payouts";

/** Form fields the way Gumroad's API reads them: a list of objects as files[][url]=…. */
export function form(o: Record<string, unknown>): string {
  const out: string[] = [];
  const add = (k: string, v: unknown): void => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x === "object") for (const [kk, vv] of Object.entries(x)) add(`${k}[][${kk}]`, vv); else add(`${k}[]`, x);
      return;
    }
    out.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(o)) add(k, v);
  return out.join("&");
}

export const gumroadAuthorizeUrl = (clientId: string, redirect: string, state: string) =>
  `${GUMROAD_AUTHORIZE}?${new URLSearchParams({ client_id: clientId, redirect_uri: redirect, scope: GUMROAD_SCOPES, response_type: "code", state })}`;

export interface GumroadToken { access_token: string; refresh_token?: string; scope?: string; token_type?: string }

/** The authorization code for a token (Gumroad's tokens do not expire; the owner revokes them in Gumroad). */
export async function gumroadExchange(http: Http, app: { id: string; secret: string }, code: string, redirect: string): Promise<GumroadToken> {
  const r = await http(GUMROAD_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form({ grant_type: "authorization_code", code, client_id: app.id, client_secret: app.secret, redirect_uri: redirect }) });
  const j = (await r.json().catch(() => ({}))) as GumroadToken & { error?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new ApiError(`Gumroad: ${clean(j.error_description ?? j.error ?? `HTTP ${r.status}`)}`, r.status);
  return { access_token: j.access_token, ...(j.refresh_token ? { refresh_token: j.refresh_token } : {}), ...(j.scope ? { scope: j.scope } : {}) };
}

export interface GumroadSale { id: string; product_id: string; product_name?: string; price: number; gumroad_fee?: number; refunded?: boolean; created_at?: string }
export interface Presigned { upload_id: string; key: string; parts: { part_number: number; presigned_url: string }[] }

/** Gumroad's API with one account's token. Every answer is checked; errors carry Gumroad's words only. */
export class GumroadApi {
  constructor(private readonly http: Http, private readonly token: string) {}

  async #call<T>(method: string, path: string, fields?: Record<string, unknown>): Promise<T> {
    const query = method === "GET" || method === "DELETE";
    const url = `${GUMROAD_API}${path}${query && fields ? `?${form(fields)}` : ""}`;
    const r = await this.http(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json", ...(query ? {} : { "Content-Type": "application/x-www-form-urlencoded" }) },
      ...(query ? {} : { body: form(fields ?? {}) }),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; message?: string } & T;
    if (!r.ok || j.success === false) throw new ApiError(`Gumroad: ${clean(j.message ?? `HTTP ${r.status}`)}`, r.status, null, Number(r.headers.get("retry-after")) || null);
    return j;
  }

  user() { return this.#call<{ user: { user_id: string; name?: string; url?: string } }>("GET", "/user").then((x) => x.user); }
  create(fields: Record<string, unknown>) { return this.#call<{ product: { id: string; short_url?: string; published?: boolean }; warning?: string }>("POST", "/products", fields); }
  update(id: string, fields: Record<string, unknown>) { return this.#call<{ product: { id: string } }>("PUT", `/products/${encodeURIComponent(id)}`, fields); }
  enable(id: string) { return this.#call<{ product: { id: string; published?: boolean; short_url?: string }; warning?: string }>("PUT", `/products/${encodeURIComponent(id)}/enable`); }
  disable(id: string) { return this.#call<{ product: { id: string } }>("PUT", `/products/${encodeURIComponent(id)}/disable`); }
  cover(id: string, url: string) { return this.#call<unknown>("POST", `/products/${encodeURIComponent(id)}/covers`, { url }); }
  presign(filename: string, size: number, contentType: string) { return this.#call<Presigned>("POST", "/files/presign", { filename, file_size: size, content_type: contentType }); }
  complete(uploadId: string, key: string, parts: { part_number: number; etag: string }[]) { return this.#call<{ file_url: string }>("POST", "/files/complete", { upload_id: uploadId, key, parts }); }
  abort(uploadId: string, key: string) { return this.#call<unknown>("POST", "/files/abort", { upload_id: uploadId, key }); }
  sales(after: string, pageKey?: string) { return this.#call<{ sales: GumroadSale[]; next_page_key?: string }>("GET", "/sales", { after, ...(pageKey ? { page_key: pageKey } : {}) }); }
  sale(id: string) { return this.#call<{ sale: GumroadSale }>("GET", `/sales/${encodeURIComponent(id)}`).then((x) => x.sale); }
  subscribe(resource: string, postUrl: string) { return this.#call<{ resource_subscription: { id: string } }>("PUT", "/resource_subscriptions", { resource_name: resource, post_url: postUrl }).then((x) => x.resource_subscription.id); }
  unsubscribe(id: string) { return this.#call<unknown>("DELETE", `/resource_subscriptions/${encodeURIComponent(id)}`); }
}

/** One part per 100 MB, as Gumroad presigns them. */
export const PART_BYTES = 100 * 1024 * 1024;

/**
 * The file goes up the way Gumroad takes it: presign, PUT each part to its presigned URL, complete.
 * The file URL that comes back is what a product's files[][url] points at. A failed upload is aborted.
 */
export async function uploadFile(api: GumroadApi, put: Http, filename: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const p = await api.presign(filename, bytes.length, contentType);
  try {
    const parts: { part_number: number; etag: string }[] = [];
    for (const part of [...p.parts].sort((a, b) => a.part_number - b.part_number)) {
      const from = (part.part_number - 1) * PART_BYTES;
      const chunk = bytes.subarray(from, Math.min(bytes.length, from + PART_BYTES));
      const r = await put(part.presigned_url, { method: "PUT", headers: { "Content-Type": contentType, "Content-Length": String(chunk.length) }, body: chunk });
      if (!r.ok) throw new ApiError(`Gumroad upload: part ${part.part_number} was refused (HTTP ${r.status})`, r.status);
      parts.push({ part_number: part.part_number, etag: r.headers.get("etag") ?? "" });
    }
    const done = await api.complete(p.upload_id, p.key, parts);
    if (!done.file_url) throw new Error("Gumroad did not return the file's URL.");
    return done.file_url;
  } catch (e) {
    await api.abort(p.upload_id, p.key).catch(() => {});
    throw e;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export const gumroadCents = (p: Product) => Math.round(fromUsdc(p.priceUsdc) * 100);

/**
 * The product's Gumroad description: its pitch, what the buyer gets, that an AI agent made it for the
 * company, and that the research behind it is published openly (what the paid file adds).
 */
export function gumroadDescription(c: Company, p: Product): string {
  return [
    `<p>${esc(p.pitch)}</p>`,
    `<p>What you get: a ${esc(p.kind)} in Markdown, packaged by ${esc(c.name)} for ${esc(c.audience)}. Every link it cites was tested when the file was made.</p>`,
    `<p><strong>Produced by an AI agent for ${esc(c.name)} (NIGHTSHIFT).</strong> Researched by the IMD agent swarm and packaged by AI. Check anything you rely on.</p>`,
    `<p>The swarm publishes its research openly, so a free public version of the underlying notes may exist. This paid version adds the checked links, the packaging and the format.</p>`,
  ].join("\n");
}

/** A new Gumroad product, always a draft: nothing is published until the owner says yes. */
export function draftFields(c: Company, p: Product): Record<string, unknown> {
  return { name: p.name, price: gumroadCents(p), price_currency_type: "usd", description: gumroadDescription(c, p), draft: true, published: false };
}

/** What Gumroad should have now, as one string: a change in any of it is sent once. */
export function syncKey(c: Company, p: Product): string {
  return JSON.stringify({ n: p.name, $: gumroadCents(p), d: createHash("sha256").update(gumroadDescription(c, p)).digest("hex").slice(0, 16) });
}

/**
 * Gumroad's prohibited products (gumroad.com/prohibited) that a NIGHTSHIFT company could make: these
 * are never listed, never published, and taken down if they turn into one. Checked on the name, the
 * pitch and the file's headings, so a passing mention inside a guide does not block it.
 */
export const PROHIBITED: { id: string; label: string; why: string; re: RegExp }[] = [
  { id: "crypto", label: "Crypto or NFT product", why: "Gumroad does not allow crypto products, NFTs included", re: /\b(crypto|cryptocurrenc(?:y|ies)|nfts?|memecoins?|meme coins?|airdrops?|bitcoin|ethereum|solana|defi|web3|altcoins?|stablecoins?|blockchain|token (?:launch|presale|sale)s?)\b/i },
  { id: "plr", label: "Private label rights (PLR) resale", why: "Gumroad does not allow reselling private label rights products", re: /\b(plr|private[- ]label rights?|resell(?:ing)? rights|master resell(?:ing)?|resale rights|white[- ]label rights)\b/i },
  { id: "consulting", label: "Consulting", why: "Gumroad does not allow consulting services", re: /\b(consulting|consultancy|consultations?|coaching (?:calls?|sessions?)|1[:-]on[:-]1|one[- ]on[- ]one (?:calls?|sessions?|coaching)|strategy calls?|advisory services?)\b/i },
  { id: "ai_service", label: "AI service fulfilled outside Gumroad", why: "Gumroad does not allow selling access to AI tools, chatbots or generation services fulfilled outside Gumroad; only finished files", re: /\b(chat ?bots?|api (?:access|keys?)|subscriptions? to|access to (?:an? |the |our )?(?:ai|agent|bot|tool|app|service|api|model)s?|ai[- ]powered (?:service|tool|app)s?|(?:image|content|text|video|voice) generation (?:service|credits|access)|done[- ]for[- ]you)\b/i },
  { id: "get_rich", label: "Get-rich-quick scheme", why: "Gumroad does not allow get-rich-quick schemes or business opportunities", re: /\b(get rich|make money fast|guaranteed (?:income|profits?|returns))\b/i },
  { id: "gambling", label: "Gambling picks", why: "Gumroad does not allow gambling picks", re: /\b(betting tips|gambling picks|sure bets?|parlays?)\b/i },
  { id: "lists", label: "Mailing lists or bulk marketing", why: "Gumroad does not allow mailing lists or bulk marketing tools", re: /\b(mailing lists?|email lists? for sale|bulk (?:email|sms|marketing)|lead lists?)\b/i },
];

export interface Prohibited { id: string; label: string; why: string; matched: string }

/** The first prohibited category the product falls in, with the words that put it there, or null. */
export function prohibited(p: Pick<Product, "name" | "pitch" | "kind">, text?: string | null): Prohibited | null {
  // a NIGHTSHIFT "tool" is a hosted web tool: access to it is fulfilled outside Gumroad
  if (p.kind === "tool") return { id: "ai_service", label: PROHIBITED[3]!.label, why: `${PROHIBITED[3]!.why} (a hosted tool is used outside Gumroad)`, matched: "tool" };
  const headings = (text ?? "").split("\n").filter((l) => /^#{1,3}\s/.test(l)).slice(0, 40).join("\n");
  const hay = `${p.name}\n${p.pitch}\n${headings}`;
  for (const r of PROHIBITED) {
    const m = r.re.exec(hay);
    if (m) return { id: r.id, label: r.label, why: r.why, matched: m[0] };
  }
  return null;
}

/** Gumroad's sale pings are not signed: the URL carries a per-company signature, and every ping is checked with Gumroad before anything is booked. */
export const pingSig = (material: string, companyId: string) => createHmac("sha256", material).update(`gumroad-ping:${companyId}`).digest("base64url").slice(0, 32);
export function pingOk(material: string, companyId: string, sig: string): boolean {
  const want = Buffer.from(pingSig(material, companyId)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** USD in the ledger is in micro-dollars, like USDC: one cent is 10,000. */
const CENT = 10_000n;

/**
 * A Gumroad sale, booked once (by its sale id, however it arrives: the webhook or the poll) as
 * off-chain revenue in USD on the company's Gumroad account in the books, with Gumroad's fee beside
 * it. It is never USDC in the company wallet: Gumroad pays it out to the owner. Returns true when it
 * was new. A refund is booked once too, reversing it.
 */
export async function bookGumroadSale(ledger: Ledger, c: Company, p: Product, s: GumroadSale): Promise<{ sale: boolean; refund: boolean; cents: number }> {
  const cents = Math.round(Number(s.price));
  const fee = Math.max(0, Math.min(cents, Math.round(Number(s.gumroad_fee ?? 0))));
  if (!(cents > 0)) return { sale: false, refund: false, cents: 0 };
  const acct = `co:${c.id}:gumroad`;
  const postings = [
    { account: acct, asset: "USD", amount: BigInt(cents) * CENT },
    { account: "ext:gumroad-buyers", asset: "USD", amount: -BigInt(cents) * CENT },
    ...(fee > 0 ? [{ account: acct, asset: "USD", amount: -BigInt(fee) * CENT }, { account: "ext:gumroad-fees", asset: "USD", amount: BigInt(fee) * CENT }] : []),
  ];
  const meta = { productId: p.id, gumroadProductId: s.product_id, currency: "USD", offChain: true, paidTo: "the owner's Gumroad account" };
  const at = s.created_at && !Number.isNaN(Date.parse(s.created_at)) ? new Date(s.created_at) : new Date();
  // booked by its id once, whatever a later answer about the same sale says
  const sale = !(await ledger.store.get(`gumroad:${s.id}`)) && await ledger.post({ id: `gumroad:${s.id}`, at, kind: "gumroad", memo: p.name, ref: { invoiceLine: `gumroad-sale:${s.id}` }, meta, postings });
  const booked = await ledger.store.get(`gumroad:${s.id}`);
  const refund = Boolean(s.refunded && booked && !(await ledger.store.get(`gumroad-refund:${s.id}`))) && await ledger.post({ id: `gumroad-refund:${s.id}`, at: new Date(), kind: "gumroad_refund", memo: `${p.name} (refunded on Gumroad)`, ref: { invoiceLine: `gumroad-sale:${s.id}` }, meta, postings: booked!.postings.map((x) => ({ ...x, amount: -x.amount })) });
  return { sale, refund, cents };
}

// ---------------------------------------------------------------- the cover, from the product's own art

const FONT = fileURLToPath(new URL("../assets/fonts/JetBrainsMono-Bold.ttf", import.meta.url));
const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));

/** Words in lines of at most `width` characters (the font is monospaced), at most `max` lines. */
function lines(text: string, width: number, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((cur ? `${cur} ${w}` : w).length > width && cur) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    if (out.length === max) break;
  }
  if (cur && out.length < max) out.push(cur);
  if (out.length === max && text.length > out.join(" ").length) out[max - 1] = `${out[max - 1]!.slice(0, width - 1)}…`;
  return out.map((l) => (l.length > width ? `${l.slice(0, width - 1)}…` : l));
}

/** The product's card in NIGHTSHIFT's look: the night sky, its name, its kind, and who made it. */
export function coverSvg(c: Company, p: Product): string {
  const name = lines(p.name, 26, 3);
  const pitch = /\d/.test(p.pitch) ? [] : lines(p.pitch, 52, 2);
  const stars = Array.from({ length: 40 }, (_, i) => { const h = createHash("sha256").update(`${p.id}:${i}`).digest(); return `<circle cx="${(h[0]! * 256 + h[1]!) % 1280}" cy="${(h[2]! * 256 + h[3]!) % 720}" r="${1 + (h[4]! % 3) / 2}" fill="#f3f1ff" opacity="${0.15 + (h[5]! % 50) / 100}"/>`; }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#07061a"/><stop offset="1" stop-color="#03020a"/></linearGradient>
<radialGradient id="m" cx="0.86" cy="0.2" r="0.5"><stop offset="0" stop-color="#4ad8ff" stop-opacity=".28"/><stop offset="1" stop-color="#4ad8ff" stop-opacity="0"/></radialGradient></defs>
<rect width="1280" height="720" fill="url(#g)"/><rect width="1280" height="720" fill="url(#m)"/>${stars}
<circle cx="1100" cy="150" r="54" fill="#f3f1ff" opacity=".9"/><circle cx="1124" cy="134" r="54" fill="#07061a"/>
<rect x="80" y="86" width="6" height="40" fill="#4ad8ff"/>
<text x="104" y="118" font-family="JetBrains Mono" font-size="26" fill="#4ad8ff" letter-spacing="6">NIGHTSHIFT · ${xml(p.kind.toUpperCase())}</text>
${name.map((l, i) => `<text x="80" y="${250 + i * 82}" font-family="JetBrains Mono" font-size="68" fill="#f3f1ff">${xml(l)}</text>`).join("\n")}
${pitch.map((l, i) => `<text x="80" y="${270 + name.length * 82 + i * 40}" font-family="JetBrains Mono" font-size="28" fill="#a7a2c3">${xml(l)}</text>`).join("\n")}
<rect x="80" y="604" width="1120" height="1" fill="#f3f1ff" opacity=".16"/>
<text x="80" y="652" font-family="JetBrains Mono" font-size="26" fill="#f3f1ff">${xml(c.name.slice(0, 40))}</text>
<text x="1200" y="652" text-anchor="end" font-family="JetBrains Mono" font-size="22" fill="#6f6a8c">Made by an AI agent</text>
</svg>`;
}

const covers = new Map<string, Buffer>();
export function coverPng(c: Company, p: Product): Buffer {
  const k = `${c.id}:${p.id}:${p.name}:${p.pitch}`;
  const hit = covers.get(k);
  if (hit) return hit;
  const png = new Resvg(coverSvg(c, p), { fitTo: { mode: "width", value: 1280 }, font: { loadSystemFonts: false, fontFiles: [FONT], defaultFontFamily: "JetBrains Mono", monospaceFamily: "JetBrains Mono" } }).render().asPng();
  if (covers.size >= 40) covers.delete(covers.keys().next().value!);
  covers.set(k, png);
  return png;
}
