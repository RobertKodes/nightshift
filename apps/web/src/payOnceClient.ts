import { type Address } from "viem";
import type { Eip1193 } from "./wallet";
import { signPayment } from "./x402pay";
import { responseError, walletError } from "./paidServices";
import {
  BASE_USDC,
  type PayTarget,
  type ServiceCatalog,
  type X402Document,
  acceptChallenge,
  formatUsdc,
  listedPayments,
  txFromSettlement,
} from "./payOnce";

export { walletError };

const pending = new Map<string, { url: string; header: string }>();
const paidThisVisit = new Set<string>();

export function resetPayState(): void {
  pending.clear();
  paidThisVisit.clear();
}

const ownFetch = (url: string, init: RequestInit = {}) => {
  const resolved = new URL(url, location.origin);
  if (resolved.origin !== location.origin) throw new Error("Only this site's payment routes are allowed.");
  return fetch(resolved.href, { ...init, mode: "same-origin", redirect: "error", cache: "no-store" });
};

const json = async (r: Response): Promise<Record<string, unknown>> => r.json().catch(() => ({}));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function account(eth: Eip1193): Promise<{ from: string; chain: number }> {
  const accounts = await eth.request({ method: "eth_accounts" }) as string[];
  const chain = Number(await eth.request({ method: "eth_chainId" }));
  return { from: accounts[0] ?? "", chain };
}

/** Switch the injected wallet to Base, and refuse if the paying account changed. */
export async function onBase(eth: Eip1193, from: Address, progress: (message: string) => void): Promise<void> {
  let active = await account(eth);
  if (active.chain !== 8453) {
    progress("Switch to Base (8453) in your wallet.");
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
    } catch (e) {
      const code = (e as { code?: number; cause?: { code?: number } }).code ?? (e as { cause?: { code?: number } }).cause?.code;
      if (code !== 4902) throw new Error(walletError(e).includes("rejected") ? walletError(e) : "Switch your wallet to Base (8453) and try again.");
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x2105",
          chainName: "Base",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"],
        }],
      });
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
    }
    active = await account(eth);
  }
  if (active.chain !== 8453) throw new Error("Switch your wallet to Base (8453) and try again.");
  if (active.from.toLowerCase() !== from.toLowerCase()) throw new Error("The connected wallet changed. Review the price and try again.");
}

export async function connectWallet(eth: Eip1193): Promise<Address> {
  const accounts = await eth.request({ method: "eth_requestAccounts" }) as string[];
  const from = accounts[0];
  if (!from || !/^0x[0-9a-fA-F]{40}$/.test(from)) throw new Error("The wallet did not return an account.");
  return from as Address;
}

async function usdcBalance(eth: Eip1193, from: Address): Promise<bigint> {
  const data = `0x70a08231${from.slice(2).toLowerCase().padStart(64, "0")}`;
  const raw = await eth.request({ method: "eth_call", params: [{ to: BASE_USDC, data }, "latest"] }) as string;
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]*$/.test(raw)) throw new Error("Could not read your USDC balance. Nothing was charged.");
  return BigInt(raw);
}

/** Prices and example URLs from /api/v1/services and /.well-known/x402.json. No price is typed in here. */
export async function loadPayTargets(origin = location.origin): Promise<PayTarget[]> {
  const [servicesRes, docRes] = await Promise.all([ownFetch("/api/v1/services"), ownFetch("/.well-known/x402.json")]);
  const services = await json(servicesRes);
  const doc = await json(docRes);
  if (!servicesRes.ok) throw responseError(servicesRes.status, services);
  if (!docRes.ok) throw responseError(docRes.status, doc);
  return listedPayments(services as unknown as ServiceCatalog, doc as unknown as X402Document, origin);
}

async function finish(target: PayTarget, signed: { url: string; header: string }, progress: (message: string) => void, delay: number): Promise<{ tx: string; body: unknown }> {
  for (let i = 0; i < 5; i++) {
    let r: Response;
    try {
      r = await ownFetch(signed.url, { headers: { "PAYMENT-SIGNATURE": signed.header } });
    } catch {
      if (i < 4) { progress("The site did not answer. Retrying the same signature…"); await wait(delay); continue; }
      throw new Error("The payment was signed but the site did not answer. Tap again to send the same signature. Nothing new will be signed.");
    }
    const body = await json(r);
    if (r.status === 202) {
      progress(typeof body.error === "string" ? body.error : "Waiting for settlement on Base…");
      if (i < 4) { await wait(delay); continue; }
      throw new Error("Still settling on Base. Tap again to check the same signature. Nothing new will be signed.");
    }
    if (!r.ok) {
      if (r.status === 402) pending.delete(target.path);
      throw responseError(r.status, body);
    }
    let decoded: unknown = null;
    const header = r.headers.get("PAYMENT-RESPONSE");
    if (header) { try { decoded = JSON.parse(atob(header)); } catch { decoded = null; } }
    const tx = txFromSettlement(body, decoded);
    if (!tx) throw new Error("The service has not returned a settlement receipt. Tap again to check the same signature.");
    pending.delete(target.path);
    paidThisVisit.add(target.path);
    return { tx, body };
  }
  throw new Error("The service did not answer.");
}

/**
 * Pay one advertised call. A signature that was already made is sent again, not replaced,
 * until the server refuses it or the settlement receipt arrives.
 */
export async function payOne(eth: Eip1193, from: Address, target: PayTarget, progress: (message: string) => void, delay = 15_000): Promise<{ tx: string; body: unknown }> {
  if (paidThisVisit.has(target.path)) throw new Error("Already paid this visit. Reload the page to pay it again.");
  const existing = pending.get(target.path);
  if (existing) {
    progress("Sending the signature you already made…");
    return finish(target, existing, progress, delay);
  }
  await onBase(eth, from, progress);
  progress(`Reading ${target.name}…`);
  const challenge = await ownFetch(target.path);
  const body = await json(challenge);
  if (challenge.status !== 402) throw responseError(challenge.status, body);
  const requirement = acceptChallenge(body, target, location.origin);
  await onBase(eth, from, progress);
  progress("Checking your USDC balance on Base…");
  const balance = await usdcBalance(eth, from);
  if (balance < BigInt(requirement.amount)) {
    throw new Error(`Not enough USDC on Base: you have ${formatUsdc(balance)} and this costs ${formatUsdc(BigInt(requirement.amount))}. Nothing was charged.`);
  }
  await onBase(eth, from, progress);
  progress("Sign the USDC payment in your wallet. The key stays in the wallet.");
  const payment = await signPayment(eth, from, requirement);
  const signed = { url: new URL(target.path, location.origin).href, header: btoa(JSON.stringify(payment)) };
  pending.set(target.path, signed);
  return finish(target, signed, progress, delay);
}

export type PayOutcome = { id: string; ok: true; tx: string; body: unknown } | { id: string; ok: false; error: string };

/** Pay the list from top to bottom. A rejected signature or an empty balance stops the rest. */
export async function payAll(eth: Eip1193, from: Address, targets: PayTarget[], onEach: (row: PayOutcome) => void, progress: (message: string) => void, delay = 15_000): Promise<PayOutcome[]> {
  const rows: PayOutcome[] = [];
  for (const target of targets) {
    try {
      const paid = await payOne(eth, from, target, progress, delay);
      const row: PayOutcome = { id: target.id, ok: true, tx: paid.tx, body: paid.body };
      rows.push(row);
      onEach(row);
    } catch (e) {
      const error = walletError(e);
      const row: PayOutcome = { id: target.id, ok: false, error };
      rows.push(row);
      onEach(row);
      if (/rejected the wallet request|Not enough USDC/i.test(error)) break;
    }
  }
  return rows;
}
