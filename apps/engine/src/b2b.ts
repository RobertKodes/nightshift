import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type B2bLine, type Company, type MarketDeps, type MarketOffer, type MarketPick, type MarketReceipt, type Product, type Task, fromUsdc } from "@nightshift/core";
import type { Ledger, LedgerTx } from "@nightshift/ledger";
import { type PaymentPayload, requirement, signPayment, verifyPayment } from "@nightshift/x402";
import type { LocalAccount } from "viem";
import { previewOf, search } from "./agentmarket.js";
import { writeAtomic } from "./atomic.js";
import type { SettledBy } from "./checkout.js";

/**
 * Companies buying from each other (B2B), on the engine's side: the market search with free previews,
 * the USDC a company may spend, the payment over x402 (signed by the buyer's own wallet, verified and
 * settled like an outside buyer's), and the books. Every purchase is one ledger transaction tagged
 * b2b that both companies see (the buyer's expense, the seller's sale), and it is counted apart from
 * sales to people and outside agents everywhere a number is shown.
 */
export interface B2bHost {
  mode: "sim" | "live";
  chainId: number;
  ledger: Ledger;
  companies: () => Iterable<Company>;
  files: { has(c: Company, p: Product): boolean; read(c: Company, p: Product): string | null; link(c: Company, p: Product, ref: string, days?: number): string };
  /** The company's own wallet, which signs its payment. */
  account(companyId: string): LocalAccount;
  /** Live: the company's USDC on the sales chain. */
  chainUsdc?(c: Company): Promise<bigint>;
  /**
   * Live: settles the signed payment exactly as an outside buyer's is settled (the seller's checkout),
   * tagged B2B. Throws an error with `pending` (the settlement key) while it waits for Base.
   */
  settle?(seller: Company, productId: string, p: PaymentPayload, tag: { buyerId: string; taskId: string }): Promise<`0x${string}`>;
  /** The seller made a B2B sale: its journal, its owner's alerts, the live events. */
  sold(seller: Company, line: B2bLine): void;
  /** Where each buyer keeps its own copy of what it bought (its research source). */
  sourcesDir: string;
}

const clean = (x: string) => x.replace(/[^a-zA-Z0-9-]/g, "");
export const b2bLedgerId = (taskId: string) => `b2b:${taskId}`;
export const isB2b = (x: LedgerTx) => x.kind === "b2b" || x.kind === "b2b_sim";

export class MarketDesk implements MarketDeps {
  constructor(private readonly h: B2bHost) {
    mkdirSync(h.sourcesDir, { recursive: true });
  }

  #company(id: string): Company | undefined {
    for (const c of this.h.companies()) if (c.id === id) return c;
    return undefined;
  }

  /** Every product on sale and packaged (the agent market's search), with its free preview. Hosted tools are not files, so not research. */
  async offers(_buyer: Company): Promise<MarketOffer[]> {
    const live = [...this.h.companies()].flatMap((c) => c.products.filter((p) => p.status === "live" && p.kind !== "tool" && this.h.files.has(c, p)).map((p) => ({ c, p, text: this.h.files.read(c, p) })));
    return search(live, {}).map(({ c, p, text }) => {
      const pv = text ? previewOf(text) : null;
      return {
        seller: { id: c.id, name: c.name, slug: c.slug, owner: c.owner, sim: Boolean(c.sim) },
        product: { id: p.id, name: p.name, kind: p.kind, pitch: p.pitch, priceUsdc: p.priceUsdc },
        preview: pv ? { title: pv.title, outline: pv.outline, opening: pv.opening } : null,
      };
    });
  }

  /**
   * What the company may spend: the USDC it earned, in its books. Live, also what its wallet really
   * holds on Base, whichever is less, so a purchase never spends money that is not there.
   */
  async usdc(buyer: Company): Promise<bigint> {
    const books = await this.h.ledger.balance(`co:${buyer.id}:usdc`, "USDC");
    if (this.h.mode === "sim") return books;
    const chain = this.h.chainUsdc ? await this.h.chainUsdc(buyer).catch(() => 0n) : 0n;
    return books < chain ? books : chain;
  }

  /** Pays the seller over x402 from the buyer's wallet. Sim: the payment is signed and verified, and only the books move. */
  async pay(buyer: Company, pick: MarketPick, t: Task): Promise<MarketReceipt> {
    const seller = this.#company(pick.sellerId);
    const product = seller?.products.find((p) => p.id === pick.productId);
    if (!seller || !product || product.status !== "live" || !this.h.files.has(seller, product)) throw new Error("the product is no longer on sale");
    if (product.priceUsdc > pick.priceUsdc) throw new Error(`its price went up to $${fromUsdc(product.priceUsdc).toFixed(2)}`);
    // the search's rules once more, at the door
    if (seller.id === buyer.id || !seller.owner || !buyer.owner || seller.owner.toLowerCase() === buyer.owner.toLowerCase()) throw new Error("the seller has the same owner");
    if (Boolean(seller.sim) !== Boolean(buyer.sim) || (this.h.mode === "live" && (seller.sim || buyer.sim))) throw new Error("a demo company never trades with a live one");
    if ((buyer.b2b?.bought ?? []).some((b) => b.productId === product.id && b.with.id === seller.id)) throw new Error("already bought");
    pick.priceUsdc = product.priceUsdc;
    const req = requirement(this.h.chainId, seller.wallet, product.priceUsdc);
    const payment = await signPayment(this.h.account(buyer.id), req);
    const v = await verifyPayment(payment, req);
    if (!v.ok) throw new Error(`the payment did not verify (${v.reason})`);
    const tag = { buyerId: buyer.id, taskId: t.id };
    if (this.h.mode === "sim") {
      const r = await this.book({ sellerId: seller.id, productId: product.id, ...tag, value: v.value, tx: null, sim: true });
      if (!r) throw new Error("the purchase could not be booked");
      return r;
    }
    if (!this.h.settle) throw new Error("no settlement on this engine");
    // booked by the checkout once it lands (the same door as an outside buyer's payment)
    const hash = await this.h.settle(seller, product.id, payment, tag);
    return { url: this.h.files.link(seller, product, hash), ledgerId: b2bLedgerId(t.id), tx: hash, sim: false };
  }

  /**
   * Books one purchase, once (the ledger id is the buyer's shift): the buyer's expense and the seller's
   * sale in one transaction tagged b2b, the seller's B2B count, and the buyer's own copy of the file.
   */
  async book(x: { sellerId: string; productId: string; buyerId: string; taskId: string; value: bigint; tx: string | null; sim: boolean; via?: SettledBy }): Promise<MarketReceipt | null> {
    const seller = this.#company(x.sellerId);
    const buyer = this.#company(x.buyerId);
    const product = seller?.products.find((p) => p.id === x.productId);
    const id = b2bLedgerId(x.taskId);
    const fresh = await this.h.ledger.post({
      id, at: new Date(), kind: x.sim ? "b2b_sim" : "b2b",
      memo: `${buyer?.name ?? "A company"} bought ${product?.name ?? x.productId} from ${seller?.name ?? "a company"}`,
      ref: x.tx ? { chainTx: x.tx } : undefined,
      meta: { b2b: true, buyer: x.buyerId, seller: x.sellerId, product: x.productId, task: x.taskId, ...(x.via ? { settledBy: x.via } : {}) },
      postings: [
        { account: `co:${x.buyerId}:usdc`, asset: "USDC", amount: -x.value },
        { account: `co:${x.sellerId}:usdc`, asset: "USDC", amount: x.value },
      ],
    });
    if (fresh && seller) {
      if (product) {
        product.b2bSales = (product.b2bSales ?? 0) + 1;
        product.b2bRevenueUsdc = (product.b2bRevenueUsdc ?? 0n) + x.value;
      }
      const line: B2bLine = { at: Date.now(), ledgerId: id, taskId: x.taskId, productId: x.productId, product: product?.name ?? x.productId, kind: product?.kind ?? "report", usdc: x.value, with: { id: x.buyerId, name: buyer?.name ?? "a company", slug: buyer?.slug ?? "" }, tx: x.tx, sim: x.sim };
      const sold = (seller.b2b ??= { bought: [], sold: [] }).sold;
      sold.push(line);
      if (sold.length > 200) sold.splice(0, sold.length - 200);
      this.h.sold(seller, line);
    }
    if (!seller || !product) return null;
    // the buyer keeps its own copy: its research source stays readable if the seller stops selling it
    const text = this.h.files.read(seller, product);
    if (text) { try { writeAtomic(join(this.h.sourcesDir, `${clean(x.buyerId)}-${clean(x.taskId)}.md`), text, { mode: 0o600 }); } catch { /* the signed link still opens it */ } }
    return { url: this.h.files.link(seller, product, x.tx ?? `b2b-${x.taskId}`), ledgerId: id, tx: x.tx, sim: x.sim };
  }

  /** The receipt of a purchase already in the books (after a restart cut its shift off). */
  async receiptFor(t: Task): Promise<MarketReceipt | null> {
    const booked = await this.h.ledger.store.get(b2bLedgerId(t.id));
    const pick = t.market?.pick;
    if (!booked || !pick) return null;
    const seller = this.#company(pick.sellerId);
    const product = seller?.products.find((p) => p.id === pick.productId);
    if (!seller || !product) return null;
    return { url: this.h.files.link(seller, product, booked.ref?.chainTx ?? `b2b-${t.id}`), ledgerId: booked.id, tx: booked.ref?.chainTx ?? null, sim: booked.kind === "b2b_sim" };
  }
}

/** One company's B2B books, from the ledger: what it sold to and bought from other companies. */
export async function b2bBooks(ledger: Ledger, companyId: string): Promise<{ sold: number; soldUsdc: bigint; bought: number; boughtUsdc: bigint }> {
  const account = `co:${companyId}:usdc`;
  const out = { sold: 0, soldUsdc: 0n, bought: 0, boughtUsdc: 0n };
  for (const x of await ledger.store.list(account)) {
    if (!isB2b(x)) continue;
    for (const p of x.postings) {
      if (p.account !== account) continue;
      if (p.amount > 0n) { out.sold += 1; out.soldUsdc += p.amount; } else { out.bought += 1; out.boughtUsdc -= p.amount; }
    }
  }
  return out;
}

/**
 * Sales across the market, two numbers never merged: to people and outside agents, and between
 * NIGHTSHIFT companies (B2B).
 */
export function marketTotals(companies: Iterable<Company>) {
  const t = { people: { sales: 0, revenueUsd: 0 }, b2b: { sales: 0, revenueUsd: 0 } };
  for (const c of companies) for (const p of c.products) {
    t.people.sales += p.sales;
    t.people.revenueUsd += fromUsdc(p.revenueUsdc);
    t.b2b.sales += p.b2bSales ?? 0;
    t.b2b.revenueUsd += fromUsdc(p.b2bRevenueUsdc ?? 0n);
  }
  return t;
}

/** A purchase line as the owner desk shows it. */
export const deskLine = (l: B2bLine) => ({ at: l.at, taskId: l.taskId, product: l.product, kind: l.kind, usd: fromUsdc(l.usdc), with: l.with.name, slug: l.with.slug, tx: l.tx, sim: l.sim });
