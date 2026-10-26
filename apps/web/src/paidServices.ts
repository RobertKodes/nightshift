import { type Address, createPublicClient, createWalletClient, custom, erc20Abi, formatUnits } from "viem";
import { base } from "viem/chains";
import type { Eip1193 } from "./wallet";
import { type Requirement, signPayment } from "./x402pay";

export type ServiceOffer = { id: string; name: string; pitch: string; priceUsd: number; holderPriceUsd?: number; route: string; example: string; description: string; priceIsMinimum?: boolean };
export type ServiceIndex = { offers: ServiceOffer[]; network: string; payTo: string | null; mode: string; holders?: string; mcp: string; openapi: string };
export type ServiceTerms = { requirement: Requirement; holderPrice: boolean; url: string };
export type PaidReply = Record<string, unknown> & { payment?: { tx?: string; sim?: boolean }; error?: string };
export type SignedRequest = { url: string; header: string };
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const address = /^0x[0-9a-fA-F]{40}$/;
const ownFetch = (url: string, init: RequestInit = {}) => {
  if (new URL(url, location.origin).origin !== location.origin) throw new Error("Only this site's payment routes are allowed.");
  return fetch(url, { ...init, mode: "same-origin", redirect: "error", cache: "no-store" });
};
const json = (r: Response): Promise<PaidReply> => r.json().catch(() => ({}));

export function responseError(status: number, body: PaidReply): Error {
  const message = typeof body.error === "string" ? body.error : `The service returned ${status}.`;
  return new Error((status === 429 || status === 503) && !/nothing was charged/i.test(message) ? `${message} Nothing was charged.` : status === 402 ? `Payment refused: ${message}` : message);
}

export async function loadServiceIndex(): Promise<ServiceIndex> {
  const r = await ownFetch("/api/v1/services");
  const d = await json(r);
  if (!r.ok) throw responseError(r.status, d);
  if (!Array.isArray(d.offers)) throw new Error("The service prices could not be read.");
  return d as ServiceIndex;
}

export type PaidField = { key: string; label: string; example: string; optional?: boolean; options?: string[] };
export const fastServiceIds = ["x402-seller-check", "payment-verify", "token-price", "wallet-check", "tx-explain", "gas-now", "name-resolve"];
const chainField: PaidField = { key: "chain", label: "Data chain", example: "base", options: ["base", "ethereum"] };
const txField: PaidField = { key: "tx", label: "Transaction hash", example: "" };
export const paidInput: Record<string, { label: string; example: string; fields?: PaidField[] }> = {
  "x402-seller-check": { label: "Seller", example: "", fields: [{ key: "target", label: "HTTPS endpoint, host or payTo address", example: "getnightshift.tech" }] },
  "payment-verify": { label: "Payment", example: "", fields: [chainField, txField, { key: "recipient", label: "Expected recipient address", example: "" }, { key: "token", label: "Token (USDC or contract address)", example: "USDC", optional: true }, { key: "minAmount", label: "Minimum token amount", example: "0.01", optional: true }] },
  "token-price": { label: "Token", example: "", fields: [chainField, { key: "token", label: "ERC-20 token address", example: BASE_USDC }] },
  "wallet-check": { label: "Wallet", example: "", fields: [chainField, { key: "address", label: "Wallet or contract address", example: "" }] },
  "tx-explain": { label: "Transaction", example: "", fields: [chainField, txField] },
  "gas-now": { label: "Gas on Ethereum and Base", example: "", fields: [] },
  "name-resolve": { label: "Name", example: "", fields: [chainField, { key: "input", label: "ENS name, Basename or reverse address", example: "jesse.base.eth" }] },
  "token-verdict-quick": { label: "Token address on Ethereum", example: "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac" },
  "token-verdict-deep": { label: "Token address on Ethereum", example: "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac" },
  "hook-inspector": { label: "Hook address on Ethereum", example: "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc" },
  "hook-inspector-explained": { label: "Hook address on Ethereum", example: "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc" },
  "watchtower-check": { label: "Token or v4 hook address on Ethereum", example: "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac" },
  "watchtower-watch": { label: "Token or v4 hook address on Ethereum", example: "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac" },
  "research-report": { label: "Question (3 to 500 characters)", example: "What has the IMD swarm published about Uniswap v4 hooks?" },
  "buildcheck-report": { label: "Public service URL", example: "https://getnightshift.tech/mcp/public" },
  "imd-feed": { label: "Feed: launches, tokens or swarm", example: "launches" },
};

/** Build only known paid routes, with the engine's input rules. */
export function serviceUrl(id: string, input: string): string {
  const value = input.trim();
  if (!paidInput[id]) throw new Error("This offer needs a quote before payment.");
  if (fastServiceIds.includes(id)) {
    const q = new URLSearchParams(value);
    const allowed = paidInput[id]!.fields!;
    for (const [key, v] of q) if (!allowed.some((f) => f.key === key) || q.getAll(key).length > 1 || v.length > 2_000) throw new Error("Invalid service inputs.");
    for (const f of allowed) if (!f.optional && !q.get(f.key)?.trim()) throw new Error(`Enter ${f.label.toLowerCase()}.`);
    if (id !== "x402-seller-check" && id !== "gas-now" && !["ethereum", "base"].includes(q.get("chain") ?? "")) throw new Error("Choose Ethereum or Base.");
    for (const key of ["recipient", "address", ...(id === "token-price" ? ["token"] : [])]) if (q.has(key) && !address.test(q.get(key)!)) throw new Error(`${key}: 0x and 40 hex characters.`);
    if (["tx-explain", "payment-verify"].includes(id) && !/^0x[0-9a-fA-F]{64}$/.test(q.get("tx") ?? "")) throw new Error("Transaction hash: 0x and 64 hex characters.");
    if (id === "payment-verify") {
      if (q.get("token") && q.get("token")!.toUpperCase() !== "USDC" && !address.test(q.get("token")!)) throw new Error("Token: USDC or an ERC-20 address.");
      if (q.get("minAmount") && !/^\d{1,60}(\.\d{1,36})?$/.test(q.get("minAmount")!)) throw new Error("Minimum amount must be a non-negative decimal.");
    }
    if (id === "x402-seller-check") {
      const target = q.get("target")!;
      if (!address.test(target)) { let u: URL; try { u = new URL(target.includes("://") ? target : `https://${target}`); } catch { throw new Error("Enter an HTTPS endpoint, host or payTo address."); }
        if (u.protocol !== "https:" || u.username || u.password || u.hash || (u.port && u.port !== "443") || (!target.includes("://") && (u.pathname !== "/" || u.search))) throw new Error("Use an HTTPS endpoint or host on the standard port, without credentials or a fragment.");
      }
    }
    if (id === "name-resolve") { const name = q.get("input")!; if (!address.test(name) && !name.toLowerCase().endsWith(q.get("chain") === "base" ? ".base.eth" : ".eth")) throw new Error("Use an .eth name on Ethereum or a .base.eth name on Base, or an address."); }
    return `/api/v1/${id}${q.size ? `?${q}` : ""}`;
  }
  if (id === "research-report") {
    const q = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 10_000);
    if (q.length < 3 || q.length > 500) throw new Error("Ask a question of 3 to 500 characters.");
    return `/api/v1/research?${new URLSearchParams({ q })}`;
  }
  if (id === "buildcheck-report") {
    if (!value || value.length > 2_000) throw new Error("url: a full https URL (up to 2,000 characters).");
    let u: URL;
    try { u = new URL(value); } catch { throw new Error("url is not a valid URL."); }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("url must be an https URL.");
    if (u.username || u.password) throw new Error("url must not carry a user name or password.");
    if (u.port && u.port !== "443" && u.port !== "80") throw new Error("url must use the standard port.");
    u.hash = "";
    return `/api/v1/buildcheck?${new URLSearchParams({ url: u.toString() })}`;
  }
  if (id === "imd-feed") {
    if (!["launches", "tokens", "swarm"].includes(value)) throw new Error("Choose launches, tokens or swarm.");
    return `/api/v1/imd/${value}?chain=ethereum&limit=20`;
  }
  if (!address.test(value)) throw new Error("Paste an Ethereum address: 0x and 40 hex characters.");
  if (id.startsWith("token-verdict-")) return `/api/v1/verdict/ethereum/${value}?depth=${id === "token-verdict-deep" ? "deep" : "quick"}`;
  if (id.startsWith("hook-inspector")) return `/api/v1/hook/${value}${id.endsWith("explained") ? "?explain=1" : ""}`;
  return `/api/v1/watchtower/${id === "watchtower-watch" ? "watch" : "check"}/ethereum/${value}${id === "watchtower-watch" ? "?days=7" : ""}`;
}

/** The first requirement is the only one the visitor may sign. */
export function validateTerms(body: unknown, index: ServiceIndex, offer: ServiceOffer): Requirement {
  const ch = body as { x402Version?: number; accepts?: (Requirement & { scheme?: string })[] } | null;
  const req = ch?.accepts?.[0];
  if (ch?.x402Version !== 2 || !req || req.scheme !== "exact") throw new Error("Invalid x402 v2 payment terms. Nothing will be signed.");
  if (index.network !== "eip155:8453" || req.network !== "eip155:8453" || String(req.asset).toLowerCase() !== BASE_USDC) throw new Error("This service must charge USDC on Base (8453). Nothing will be signed.");
  if (!index.payTo || !address.test(index.payTo) || !address.test(req.payTo) || req.payTo.toLowerCase() !== index.payTo.toLowerCase()) throw new Error("The payment recipient does not match /api/v1/services. Nothing will be signed.");
  const listed = index.offers.find((o) => o.id === offer.id);
  const cap = Math.floor(Math.min(offer.priceUsd, listed?.priceUsd ?? NaN) * 1e6);
  if (!Number.isSafeInteger(cap) || cap <= 0 || typeof req.amount !== "string" || !/^\d+$/.test(req.amount) || BigInt(req.amount) <= 0n || BigInt(req.amount) > BigInt(cap)) throw new Error("The payment exceeds this offer's listed price or has an invalid amount. Nothing will be signed.");
  if (!Number.isSafeInteger(req.maxTimeoutSeconds) || req.maxTimeoutSeconds < 10 || req.maxTimeoutSeconds > 300 || req.extra?.name !== "USD Coin" || req.extra.version !== "2") throw new Error("Invalid USDC authorization terms. Nothing will be signed.");
  return req;
}

export async function serviceTerms(offer: ServiceOffer, input: string, from: Address): Promise<ServiceTerms> {
  const url = new URL(serviceUrl(offer.id, input), location.origin);
  const index = await loadServiceIndex();
  url.searchParams.set("holder", from);
  const r = await ownFetch(url.href);
  const body = await json(r);
  if (r.status !== 402) throw responseError(r.status, body);
  const requirement = validateTerms(body, index, offer);
  return { requirement, holderPrice: body.holderPrice === true, url: url.href };
}

export function walletError(e: unknown): string {
  let cause = e as { code?: number | string; cause?: unknown; message?: string } | undefined;
  for (let i = 0; cause && i < 8; i++, cause = cause.cause as typeof cause) {
    if (cause.code === 4001 || cause.code === "ACTION_REJECTED" || /user rejected|user denied/i.test(cause.message ?? "")) return "You rejected the wallet request. Nothing was charged.";
  }
  return e instanceof Error ? e.message : "The wallet request failed.";
}

export async function walletAccount(eth: Eip1193): Promise<{ from: Address | null; chain: number }> {
  const accounts = await eth.request({ method: "eth_accounts" }) as string[];
  const chain = Number(await eth.request({ method: "eth_chainId" }));
  return { from: accounts[0] && address.test(accounts[0]) ? accounts[0] as Address : null, chain };
}

/** Switch only to Base, then check the funds before the signature prompt. */
export async function signService(eth: Eip1193, from: Address, terms: ServiceTerms, progress: (message: string) => void): Promise<SignedRequest> {
  const wallet = createWalletClient({ transport: custom(eth as never) });
  if ((await walletAccount(eth)).chain !== 8453) {
    progress("Wrong chain. Switch to Base (8453) in your wallet.");
    try { await wallet.switchChain({ id: 8453 }); } catch (e) {
      let cause = e as { code?: number; cause?: unknown };
      while (cause.cause) cause = cause.cause as typeof cause;
      if (cause.code !== 4902) throw new Error(walletError(e).includes("rejected") ? walletError(e) : "Switch your wallet to Base (8453) and try again.");
      await wallet.addChain({ chain: base });
      await wallet.switchChain({ id: 8453 });
    }
  }
  const checkWallet = async () => {
    const active = await walletAccount(eth);
    if (active.chain !== 8453) throw new Error("Switch your wallet to Base (8453) and try again.");
    if (active.from?.toLowerCase() !== from.toLowerCase()) throw new Error("The connected wallet changed. Review the price and try again.");
  };
  await checkWallet();
  progress("Checking your USDC balance on Base…");
  const rpc = createPublicClient({ chain: base, transport: custom(eth as never) });
  const balance = await rpc.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [from] });
  if (balance < BigInt(terms.requirement.amount)) throw new Error(`Not enough USDC on Base: you have ${formatUnits(balance, 6)} USDC and need ${formatUnits(BigInt(terms.requirement.amount), 6)} USDC. Nothing was charged.`);
  await checkWallet();
  progress("Sign the USDC payment in your wallet.");
  const payment = await signPayment(eth, from, terms.requirement);
  return { url: terms.url, header: btoa(JSON.stringify(payment)) };
}

/** Pending retries reuse the same URL and signature, including after a connection failure. */
export async function paidRequest(request: SignedRequest, pending: (message: string) => void, delay = 15_000): Promise<{ body: PaidReply; pending: boolean }> {
  for (let i = 0; i < 5; i++) {
    const r = await ownFetch(request.url, { headers: { "PAYMENT-SIGNATURE": request.header } });
    const body = await json(r);
    if (r.status === 202) {
      pending(typeof body.error === "string" ? body.error : "Waiting for settlement on Base…");
      if (i < 4) { await new Promise((resolve) => setTimeout(resolve, delay)); continue; }
      return { body, pending: true };
    }
    if (r.status === 502 && body.refundOwed === true && body.payment?.tx && typeof body.orderId === "string") return { body, pending: false };
    if (!r.ok) throw responseError(r.status, body);
    if (!body.payment?.tx && !body.payment?.sim) throw new Error("The service has not returned a settlement receipt. Check the same payment again.");
    return { body, pending: false };
  }
  throw new Error("The service did not answer.");
}

export type SwarmQuote = { quoteId: string; kind: string; priceUsd: number; expiresAt: string; whatYouGet: string; eta: string; pay: string };
export async function swarmQuote(input: Record<string, string>): Promise<SwarmQuote> {
  const q = new URLSearchParams(Object.entries(input).filter(([, v]) => v.trim()));
  const r = await ownFetch(`/api/v1/swarm/quote?${q}`), body = await json(r);
  if (!r.ok) throw responseError(r.status, body);
  const quote = body as unknown as SwarmQuote;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(quote.quoteId) || !Number.isFinite(quote.priceUsd) || quote.priceUsd < 3 || !Number.isSafeInteger(Math.round(quote.priceUsd * 1e6)) || !Number.isFinite(Date.parse(quote.expiresAt))) throw new Error("Invalid checked quote. Nothing will be signed.");
  return quote;
}

export async function swarmTerms(quote: SwarmQuote, from: Address): Promise<ServiceTerms> {
  if (Date.parse(quote.expiresAt) <= Date.now()) throw new Error("Quote expired. Get a new free checked quote.");
  const index = await loadServiceIndex(), listed = index.offers.find((o) => o.id === "swarm-order");
  if (!listed) throw new Error("Swarm Desk is unavailable.");
  const url = new URL(`/api/v1/swarm/order?${new URLSearchParams({ quoteId: quote.quoteId })}`, location.origin);
  const r = await ownFetch(url.href), body = await json(r);
  if (r.status !== 402) throw responseError(r.status, body);
  const exact = { ...listed, priceUsd: quote.priceUsd }, requirement = validateTerms(body, { ...index, offers: index.offers.map((o) => o.id === "swarm-order" ? exact : o) }, exact);
  if (BigInt(requirement.amount) !== BigInt(Math.round(quote.priceUsd * 1e6)) || (body.resource as { url?: string } | undefined)?.url !== new URL("/api/v1/swarm/order", location.origin).href) throw new Error("Terms do not match the exact checked quote and stable Swarm Desk resource. Nothing will be signed.");
  if (!address.test(from)) throw new Error("Connect a valid paying wallet.");
  return { requirement, holderPrice: false, url: url.href };
}
