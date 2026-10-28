import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Address, type Hex, createPublicClient, fallback, getAddress, http, parseAbi } from "viem";
import { verifyJoinSignature } from "./agent-join.js";
import { writeAtomic } from "./atomic.js";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { toCommunity } from "./community.js";
import { type Button, telegram } from "./social.js";

/**
 * Partners: a project applies to join the NIGHTSHIFT ecosystem with its token. The form is free; the project
 * signs with a wallet (the token's owner or deployer counts as proof it is theirs) and posts that it applied.
 * The operators accept or decline from Telegram; an accepted partner is announced in the community and listed.
 */
export class PartnerError extends Error { constructor(readonly status: number, message: string, readonly code = "bad_request") { super(message); } }

type Evm = { name: string; kind: "evm"; id: number; dex: string; rpcs: string[] };
type Chain = Evm | { name: string; kind: "solana" | "other"; dex?: string };
export const PARTNER_CHAINS = {
  ethereum: { name: "Ethereum", kind: "evm", id: 1, dex: "ethereum", rpcs: [] },
  base: { name: "Base", kind: "evm", id: 8453, dex: "base", rpcs: ["https://mainnet.base.org", "https://base.drpc.org"] },
  arbitrum: { name: "Arbitrum", kind: "evm", id: 42161, dex: "arbitrum", rpcs: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.drpc.org"] },
  bnb: { name: "BNB Chain", kind: "evm", id: 56, dex: "bsc", rpcs: ["https://bsc-dataseed.bnbchain.org", "https://bsc.drpc.org"] },
  polygon: { name: "Polygon", kind: "evm", id: 137, dex: "polygon", rpcs: ["https://polygon-rpc.com", "https://polygon.drpc.org"] },
  optimism: { name: "Optimism", kind: "evm", id: 10, dex: "optimism", rpcs: ["https://mainnet.optimism.io", "https://optimism.drpc.org"] },
  avalanche: { name: "Avalanche", kind: "evm", id: 43114, dex: "avalanche", rpcs: ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche.drpc.org"] },
  robinhood: { name: "Robinhood Chain", kind: "evm", id: 4663, dex: "robinhood", rpcs: ["https://rpc.mainnet.chain.robinhood.com"] },
  solana: { name: "Solana", kind: "solana", dex: "solana" },
  other: { name: "Another chain", kind: "other" },
} satisfies Record<string, Chain>;
export type PartnerChain = keyof typeof PARTNER_CHAINS;

/** What a project can ask for. */
export const WANTS = {
  badge: "Partner badge across NIGHTSHIFT",
  deals: "Token Deals listings, when they open",
  swap: "Their token in our swap",
  watchtower: "Watchtower monitoring for holders",
  agents: "Their token in our AI agent tools",
  games: "Prizes and events in the games",
  companies: "Work with our AI companies",
} as const;
export type Want = keyof typeof WANTS;

/** How the signing wallet relates to the token: its owner, its deployer, its mint authority, or not shown to be either. */
export type Proof = "owner" | "deployer" | "mint" | "unmatched" | "unknown" | "unsigned";
export type Market = { name?: string; symbol?: string; image?: string; priceUsd?: number; liquidityUsd?: number; volume24hUsd?: number; fdvUsd?: number; pairCreatedAt?: number; pairUrl?: string };
export type Application = {
  id: string; at: number; status: "pending" | "accepted" | "declined"; decidedAt?: number; note?: string;
  project: { name: string; website: string; x: string; telegram: string; docs: string; about: string };
  contact: string; wants: Want[];
  token: { chain: PartnerChain; chainName: string; address: string };
  signer: string | null; proof: Proof; post: string; market: Market | null; ipHash: string;
};
type Store = { applications: Application[] };

export const PARTNER_TEMPLATE = "Partner with NIGHTSHIFT\nproject: <name>\ntoken: <chain>:<address>\nwallet: <wallet>\nissued: <ISO-8601 UTC time>";
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ISSUED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DAY = 86_400_000;

const text = (v: unknown, max: number) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max + 1) : "";
function https(v: unknown, field: string, required: boolean): string {
  const s = text(v, 300);
  if (!s) { if (required) throw new PartnerError(400, `${field}: required.`, `bad_${field}`); return ""; }
  let u: URL;
  try { u = new URL(s); } catch { throw new PartnerError(400, `${field}: a full https:// link.`, `bad_${field}`); }
  if (u.protocol !== "https:" || u.username || u.password || s.length > 300) throw new PartnerError(400, `${field}: a full https:// link.`, `bad_${field}`);
  return u.toString();
}
/** An X account as a link: a handle or a profile URL. */
function xAccount(v: unknown): string {
  const s = text(v, 120).replace(/^@/, "");
  const m = /^(?:(?:https:\/\/)?(?:www\.)?(?:x|twitter)\.com\/)?([A-Za-z0-9_]{1,15})\/?$/.exec(s);
  if (!m) throw new PartnerError(400, "x: the project's X handle or profile link.", "bad_x");
  return `https://x.com/${m[1]}`;
}
function telegramLink(v: unknown): string {
  const s = text(v, 120).replace(/^@/, "");
  const m = /^(?:(?:https:\/\/)?(?:www\.)?t\.me\/)?(\+?[A-Za-z0-9_-]{4,64})\/?$/.exec(s);
  if (!m) throw new PartnerError(400, "telegram: the project's Telegram group or channel (t.me link or @name).", "bad_telegram");
  return `https://t.me/${m[1]}`;
}
/** The post about the application: one X post or one Telegram message. */
export function postLink(v: unknown): string {
  const s = text(v, 300);
  const x = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/(\d{5,25})(?:[/?#].*)?$/.exec(s);
  if (x) return `https://x.com/i/status/${x[1]}`;
  const t = /^https:\/\/(?:www\.)?t\.me\/(?:s\/)?([A-Za-z0-9_]{4,64}\/\d{1,12})(?:[/?#].*)?$/.exec(s);
  if (t) return `https://t.me/${t[1]}`;
  throw new PartnerError(400, "post: the link to your public post about applying, on X (x.com/…/status/…) or a public Telegram channel (t.me/…/123).", "bad_post");
}

function tokenOf(chain: unknown, address: unknown, chainName: unknown): Application["token"] {
  if (typeof chain !== "string" || !(chain in PARTNER_CHAINS)) throw new PartnerError(400, `chain: one of ${Object.keys(PARTNER_CHAINS).join(", ")}.`, "bad_chain");
  const key = chain as PartnerChain, c: Chain = PARTNER_CHAINS[key], a = text(address, 100);
  if (c.kind === "evm") { if (!EVM_ADDRESS.test(a)) throw new PartnerError(400, "token: the token's 0x contract address.", "bad_token"); return { chain: key, chainName: c.name, address: a.toLowerCase() }; }
  if (c.kind === "solana") { if (!SOL_ADDRESS.test(a)) throw new PartnerError(400, "token: the token's Solana mint address.", "bad_token"); return { chain: key, chainName: c.name, address: a }; }
  const name = text(chainName, 40);
  if (!/^[A-Za-z0-9 .-]{2,40}$/.test(name)) throw new PartnerError(400, "chainName: the name of the chain (2-40 letters or digits).", "bad_chain_name");
  if (!/^[A-Za-z0-9:._-]{4,100}$/.test(a)) throw new PartnerError(400, "token: the token's address or identifier on that chain.", "bad_token");
  return { chain: key, chainName: name, address: a };
}

function projectName(v: unknown): string {
  const name = text(v, 60);
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .&'_-]{1,59}$/u.test(name)) throw new PartnerError(400, "project: 2 to 60 letters, digits, spaces or . & ' _ -", "bad_project");
  return name;
}

/** The exact text the wallet signs. EVM wallets sign their lowercase address; Solana keeps its case. */
export function partnerMessage(project: unknown, token: Application["token"], wallet: unknown, issued = new Date().toISOString()) {
  const name = projectName(project), w = text(wallet, 60), solana = PARTNER_CHAINS[token.chain].kind === "solana";
  if (!(solana ? SOL_ADDRESS.test(w) : EVM_ADDRESS.test(w))) throw new PartnerError(400, solana ? "wallet: the Solana wallet that signs." : "wallet: the 0x wallet that signs.", "bad_wallet");
  const wallet2 = solana ? w : w.toLowerCase();
  return { project: name, wallet: wallet2, issued, message: `Partner with NIGHTSHIFT\nproject: ${name}\ntoken: ${token.chain}:${token.address}\nwallet: ${wallet2}\nissued: ${issued}` };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: Uint8Array): string {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let out = ""; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = `1${out}`; }
  return out;
}
export function unbase58(s: string): Uint8Array | null {
  let n = 0n;
  for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) return null; n = n * 58n + BigInt(i); }
  const out: number[] = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of s) { if (ch !== "1") break; out.unshift(0); }
  return Uint8Array.from(out);
}
/** A Solana wallet's ed25519 signature over the message (base64 or base58). */
export function verifySolanaSignature(address: string, message: string, signature: string): boolean {
  // 64 bytes in base64 always end in "=="; base58 never has "="
  const key = unbase58(address), sig = /^[A-Za-z0-9+/]{86}==$/.test(signature) ? Buffer.from(signature, "base64") : unbase58(signature);
  if (!key || key.length !== 32 || !sig || sig.length !== 64) return false;
  try { return verifySignature(null, Buffer.from(message, "utf8"), createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(key).toString("base64url") }, format: "jwk" }), sig); }
  catch { return false; }
}

const evmClients = new Map<number, ReturnType<typeof createPublicClient>>();
function evmClient(c: Evm) {
  if (c.id === 1) return eth;
  let client = evmClients.get(c.id);
  if (!client) { client = createPublicClient({ transport: fallback(c.rpcs.map((u) => http(u, { timeout: 12_000 })), { retryCount: 1 }) }); evmClients.set(c.id, client); }
  return client;
}
const OWNER = parseAbi(["function owner() view returns (address)", "function getOwner() view returns (address)"]);
/** Whether the signer controls the token: its owner() or getOwner(), its deployer (Etherscan), or its Solana mint authority. */
export async function liveControl(token: Application["token"], signer: string, read: typeof fetch = fetch): Promise<Proof> {
  const c: Chain = PARTNER_CHAINS[token.chain];
  if (c.kind === "solana") {
    const r = await read("https://api.mainnet-beta.solana.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [token.address, { encoding: "jsonParsed" }] }), signal: AbortSignal.timeout(12_000) }).then((x) => x.json() as Promise<{ result?: { value?: { data?: { parsed?: { info?: { mintAuthority?: string | null } } } } } }>).catch(() => null);
    const mint = r?.result?.value?.data?.parsed?.info?.mintAuthority;
    return mint === undefined ? "unknown" : mint === signer ? "mint" : "unmatched";
  }
  if (c.kind !== "evm") return "unknown";
  const client = evmClient(c), address = token.address as Address;
  for (const functionName of ["owner", "getOwner"] as const) {
    const owner = await client.readContract({ address, abi: OWNER, functionName }).catch(() => null);
    if (owner && owner.toLowerCase() === signer.toLowerCase()) return "owner";
  }
  if (!config.etherscanKey) return "unknown";
  const q = new URLSearchParams({ chainid: String(c.id), module: "contract", action: "getcontractcreation", contractaddresses: token.address, apikey: config.etherscanKey });
  const r = await read(`https://api.etherscan.io/v2/api?${q}`, { signal: AbortSignal.timeout(12_000) }).then((x) => x.json() as Promise<{ status?: string; result?: { contractCreator?: string }[] }>).catch(() => null);
  const creator = r?.status === "1" ? r.result?.[0]?.contractCreator : undefined;
  return creator ? creator.toLowerCase() === signer.toLowerCase() ? "deployer" : "unmatched" : "unknown";
}

/** The token's deepest DexScreener pair on its chain. */
export async function liveMarket(token: Application["token"], read: typeof fetch = fetch): Promise<Market | null> {
  const dex = (PARTNER_CHAINS[token.chain] as Chain).dex;
  if (!dex) return null;
  type Pair = { chainId?: string; url?: string; priceUsd?: string; liquidity?: { usd?: number }; volume?: { h24?: number }; fdv?: number; pairCreatedAt?: number; baseToken?: { address?: string; name?: string; symbol?: string }; info?: { imageUrl?: string } };
  const r = await read(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(token.address)}`, { signal: AbortSignal.timeout(12_000) }).then((x) => x.json() as Promise<{ pairs?: Pair[] | null }>).catch(() => null);
  const pairs = (r?.pairs ?? []).filter((p) => p.chainId === dex && p.baseToken?.address?.toLowerCase() === token.address.toLowerCase());
  const p = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  if (!p) return null;
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
  return { name: p.baseToken?.name, symbol: p.baseToken?.symbol, image: p.info?.imageUrl?.startsWith("https://") ? p.info.imageUrl : undefined, priceUsd: num(p.priceUsd), liquidityUsd: num(p.liquidity?.usd), volume24hUsd: num(p.volume?.h24), fdvUsd: num(p.fdv), pairCreatedAt: num(p.pairCreatedAt), pairUrl: p.url?.startsWith("https://") ? p.url : undefined };
}

export type PartnerDeps = {
  dir: string; now?: () => number;
  verifyEvm?: (input: { address: Address; message: string; signature: Hex }) => Promise<boolean>;
  control?: (token: Application["token"], signer: string) => Promise<Proof>;
  market?: (token: Application["token"]) => Promise<Market | null>;
  /** Tells the operators about a new application, with accept and decline buttons. */
  notify?: (text: string, buttons: Button[][]) => Promise<unknown>;
  /** Posts an accepted partner's announcement to the community. */
  announce?: (html: string, buttons: Button[][]) => Promise<boolean>;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const money = (n?: number) => n === undefined ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(n < 1 ? 6 : 0)}`;
const PROOF: Record<Proof, string> = { owner: "✅ signed by the token's owner wallet", deployer: "✅ signed by the token's deployer", mint: "✅ signed by the mint authority", unmatched: "⚠️ signer is not the owner or deployer: check by hand", unknown: "⚠️ owner and deployer could not be read: check by hand", unsigned: "⚠️ no signature (other chain): check by hand" };

export class Partners {
  readonly #file: string; readonly #now: () => number; readonly #deps: PartnerDeps;
  #store: Store;
  constructor(deps: PartnerDeps) {
    this.#deps = deps; this.#now = deps.now ?? Date.now; this.#file = join(deps.dir, "partners.json");
    try { this.#store = existsSync(this.#file) ? JSON.parse(readFileSync(this.#file, "utf8")) as Store : { applications: [] }; } catch { this.#store = { applications: [] }; }
  }
  #save() { writeAtomic(this.#file, JSON.stringify(this.#store), { backup: true }); }

  message(q: { project?: unknown; chain?: unknown; token?: unknown; chainName?: unknown; wallet?: unknown }) {
    return partnerMessage(q.project, tokenOf(q.chain, q.token, q.chainName), q.wallet, new Date(this.#now()).toISOString());
  }

  async apply(b: Record<string, unknown>, ip: string): Promise<{ id: string; status: Application["status"] }> {
    const now = this.#now(), ipHash = createHash("sha256").update(`nightshift-partners:${ip}`).digest("hex").slice(0, 24);
    if (this.#store.applications.filter((a) => a.ipHash === ipHash && now - a.at < DAY).length >= 5) throw new PartnerError(429, "Too many applications from here today. Try again tomorrow.", "rate_limited");
    if (this.#store.applications.filter((a) => a.status === "pending").length >= 500) throw new PartnerError(503, "The review list is full. Try again in a few days.", "busy");
    const token = tokenOf(b.chain, b.token, b.chainName), kind = PARTNER_CHAINS[token.chain].kind;
    const same = this.#store.applications.filter((a) => a.token.chain === token.chain && a.token.address.toLowerCase() === token.address.toLowerCase());
    if (same.some((a) => a.status === "accepted")) throw new PartnerError(409, "This token is already a NIGHTSHIFT partner.", "already_partner");
    if (same.some((a) => a.status === "pending")) throw new PartnerError(409, "This token already has an application under review.", "pending");
    if (same.some((a) => a.status === "declined" && now - (a.decidedAt ?? a.at) < 7 * DAY)) throw new PartnerError(409, "This token was declined recently. Apply again after 7 days.", "declined_recently");
    const about = text(b.about, 600);
    if (about.length < 20 || about.length > 600) throw new PartnerError(400, "about: what the project does, 20 to 600 characters.", "bad_about");
    const contact = text(b.contact, 100);
    if (!/^(?:[^\s@]{1,64}@[^\s@]{1,100}\.[A-Za-z]{2,}|@[A-Za-z0-9_]{4,32})$/.test(contact)) throw new PartnerError(400, "contact: an email address or a Telegram @username for the team.", "bad_contact");
    const raw = Array.isArray(b.wants) ? b.wants : typeof b.wants === "string" ? b.wants.split(",") : [];
    const wants = [...new Set(raw.map((w) => String(w).trim()))].filter((w): w is Want => w in WANTS);
    if (!wants.length) throw new PartnerError(400, `wants: at least one of ${Object.keys(WANTS).join(", ")}.`, "bad_wants");
    const project = { name: "", website: https(b.website, "website", true), x: xAccount(b.x), telegram: telegramLink(b.telegram), docs: https(b.docs, "docs", false), about };
    const post = postLink(b.post);
    if (this.#store.applications.some((a) => a.post === post)) throw new PartnerError(409, "post: that post was already used for an application.", "post_used");

    let signer: string | null = null, proof: Proof = "unsigned";
    if (kind !== "other") {
      const issued = text(b.issued, 30);
      if (!ISSUED.test(issued) || Math.abs(now - Date.parse(issued)) > 10 * 60_000 || Date.parse(issued) - now > 60_000) throw new PartnerError(400, "issued: sign again; the message is older than ten minutes.", "stale");
      const m = partnerMessage(b.project, token, b.wallet, issued);
      if (b.message !== m.message) throw new PartnerError(400, "message: it must be exactly the text from /api/partners/message.", "bad_message");
      const signature = text(b.signature, 200);
      const ok = kind === "solana" ? verifySolanaSignature(m.wallet, m.message, signature)
        : /^0x[0-9a-fA-F]{130,}$/.test(signature) && await (this.#deps.verifyEvm ?? verifyJoinSignature)({ address: getAddress(m.wallet), message: m.message, signature: signature as Hex });
      if (!ok) throw new PartnerError(401, "signature: it does not match the wallet.", "bad_signature");
      project.name = m.project; signer = m.wallet; proof = "unknown";
    } else {
      project.name = projectName(b.project);
    }
    const app: Application = { id: randomBytes(6).toString("hex"), at: now, status: "pending", project, contact, wants, token, signer, proof, post, market: null, ipHash };
    this.#store.applications.push(app); this.#save();
    void this.#check(app.id);
    return { id: app.id, status: app.status };
  }

  /** The checks that read other services: who the signer is to the token, and the token's market. Then the operators hear. */
  async #check(id: string) {
    const app = this.#store.applications.find((a) => a.id === id); if (!app) return;
    const [proof, market] = await Promise.all([
      app.signer ? (this.#deps.control ?? liveControl)(app.token, app.signer).catch((): Proof => "unknown") : Promise.resolve(app.proof),
      (this.#deps.market ?? liveMarket)(app.token).catch(() => null),
    ]);
    Object.assign(app, { proof, market }); this.#save();
    await this.#deps.notify?.(this.#review(app), [[{ text: "✅ Accept", data: `/partner accept ${app.id}` }, { text: "❌ Decline", data: `/partner decline ${app.id}` }], [{ text: "👀 Their post", url: app.post }, { text: "🌐 Website", url: app.project.website }]]).catch(() => {});
  }

  #review(a: Application): string {
    const m = a.market, verdict = a.token.chain === "ethereum" ? `\nVerdict preview: ${config.publicUrl}/api/v1/verdict/ethereum/${a.token.address}/preview` : "";
    return [`🤝 <b>Partner application</b> · ${a.id}`, "",
      `<b>${esc(a.project.name)}</b>${m?.symbol ? ` ($${esc(m.symbol)})` : ""} on ${esc(a.token.chainName)}`,
      `<code>${esc(a.token.address)}</code>`, esc(a.project.about), "",
      `Wants: ${a.wants.map((w) => WANTS[w]).join("; ")}`,
      `Wallet: ${PROOF[a.proof]}`,
      m ? `Market: price ${money(m.priceUsd)} · liquidity ${money(m.liquidityUsd)} · 24h volume ${money(m.volume24hUsd)} · FDV ${money(m.fdvUsd)}${m.pairCreatedAt ? ` · pair ${Math.max(0, Math.round((this.#now() - m.pairCreatedAt) / DAY))} days old` : ""}` : "Market: no DEX pair found",
      `Links: ${a.project.website} · ${a.project.x} · ${a.project.telegram}${a.project.docs ? ` · ${a.project.docs}` : ""}`,
      `Contact: ${esc(a.contact)}`, `Post: ${a.post}${verdict}`].join("\n");
  }

  status(id: string) {
    const a = this.#store.applications.find((x) => x.id === id);
    if (!a) throw new PartnerError(404, "No application with that id.", "not_found");
    return { id: a.id, status: a.status, project: a.project.name, token: a.token, at: a.at, decidedAt: a.decidedAt ?? null, note: a.status === "declined" ? a.note ?? null : null };
  }

  /** The public partner list: what each partner shows, nothing about contacts or reviews. */
  list() {
    return this.#store.applications.filter((a) => a.status === "accepted").sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0)).map((a) => ({
      id: a.id, name: a.project.name, about: a.project.about, website: a.project.website, x: a.project.x, telegram: a.project.telegram, docs: a.project.docs || null,
      token: a.token, symbol: a.market?.symbol ?? null, image: a.market?.image ?? null, chart: a.market?.pairUrl ?? null, since: a.decidedAt ?? a.at,
    }));
  }

  applications() { return [...this.#store.applications].sort((a, b) => b.at - a.at); }

  async decide(id: string, decision: "accept" | "decline", note = ""): Promise<{ app: Application; announced: boolean; xDraft: string | null }> {
    const a = this.#store.applications.find((x) => x.id === id);
    if (!a) throw new PartnerError(404, "No application with that id.", "not_found");
    if (a.status !== "pending") throw new PartnerError(409, `That application is already ${a.status}.`, "decided");
    Object.assign(a, { status: decision === "accept" ? "accepted" : "declined", decidedAt: this.#now(), note: text(note, 200) || undefined }); this.#save();
    if (decision === "decline") return { app: a, announced: false, xDraft: null };
    const sym = a.market?.symbol ? ` ($${esc(a.market.symbol)})` : "";
    const html = [`🤝 <b>NEW NIGHTSHIFT PARTNER</b> 🌙`, "", `<b>${esc(a.project.name)}</b>${sym} on ${esc(a.token.chainName)} is now an official partner of the NIGHTSHIFT ecosystem.`, "", esc(a.project.about), "", "Welcome aboard, crew 🐸"].join("\n");
    const buttons: Button[][] = [[{ text: "🌐 Website", url: a.project.website }, { text: "𝕏 Their X", url: a.project.x }], [{ text: "💬 Their Telegram", url: a.project.telegram }, { text: "🤝 All partners", url: `${config.publicUrl}/partners` }]];
    const announced = await this.#deps.announce?.(html, buttons).catch(() => false) ?? false;
    const handle = a.project.x.split("/").pop();
    const xDraft = `🤝 Welcome @${handle} to the NIGHTSHIFT ecosystem.\n\n${a.project.name}${a.market?.symbol ? ` ($${a.market.symbol})` : ""} on ${a.token.chainName} is now an official NIGHTSHIFT partner.\n\n${config.publicUrl}/partners`;
    return { app: a, announced, xDraft };
  }

  /** The operators' /partner command: the review list, or a decision. */
  async command(args: string[]): Promise<{ text: string; buttons?: Button[][] }> {
    const [verb, id, ...rest] = args;
    if (verb === "accept" || verb === "decline") {
      if (!id) return { text: `Usage: /partner ${verb} <id>${verb === "decline" ? " [reason]" : ""}` };
      try {
        const r = await this.decide(id, verb, rest.join(" "));
        if (verb === "decline") return { text: `❌ Declined ${esc(r.app.project.name)}. They can apply again after 7 days.` };
        return { text: [`✅ <b>${esc(r.app.project.name)}</b> is a partner now${r.announced ? " and was announced in the community" : " (the community announcement did not go out: post it by hand)"}.`, "", "Post this on X:", `<code>${esc(r.xDraft ?? "")}</code>`].join("\n"), buttons: [[{ text: "𝕏 Post it", url: `https://x.com/intent/post?text=${encodeURIComponent(r.xDraft ?? "")}` }]] };
      } catch (e) { return { text: e instanceof PartnerError ? e.message : "That did not work. Try again." }; }
    }
    const pending = this.applications().filter((a) => a.status === "pending");
    if (!pending.length) return { text: `🤝 No partner applications waiting. Partners so far: ${this.list().length}.` };
    return { text: [`🤝 <b>${pending.length} partner application${pending.length === 1 ? "" : "s"} waiting</b>`, ...pending.slice(0, 8).map((a) => `• <b>${esc(a.project.name)}</b> on ${esc(a.token.chainName)} · ${a.id} · ${PROOF[a.proof]}`)].join("\n"),
      buttons: pending.slice(0, 4).map((a) => [{ text: `✅ ${a.project.name.slice(0, 18)}`, data: `/partner accept ${a.id}` }, { text: "❌ Decline", data: `/partner decline ${a.id}` }]) };
  }
}

let live: Partners | null = null;
/** The server's partners: applications reach the operators' Telegram, accepted partners the community. */
export function livePartners(): Partners {
  live ??= new Partners({
    dir: config.dataDir,
    notify: (body, buttons) => Promise.all(config.telegramAdmins.filter((id) => Number(id) > 0).map((id) => telegram(config.telegramToken, id, body, buttons))),
    announce: (html, buttons) => config.telegramToken ? toCommunity(html, buttons, "milestone") : Promise.resolve(false),
  });
  return live;
}
