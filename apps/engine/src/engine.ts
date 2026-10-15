import { randomUUID } from "node:crypto";
import {
  type Company,
  type CompanyStats,
  DEFAULT_POLICY,
  type Policy,
  type ShiftDeps,
  advance,
  approve,
  found,
  fromUsdc,
  note,
  reject,
  runShift,
  validatePolicy,
} from "@nightshift/core";
import { HttpImdPlane, type ImdAction, type ImdPlane, SimImdPlane } from "@nightshift/imd";
import { Ledger } from "@nightshift/ledger";
import { ImdReads } from "imd-mcp/lib";
import { erc20Abi } from "viem";
import { USDC } from "@nightshift/x402";
import { Auth } from "./auth.js";
import { LlmClient } from "@nightshift/llm";
import { ensurePermit2, sales, salesWallet } from "./chain.js";
import { config } from "./config.js";
import { simulateTraffic } from "./market.js";
import { SimDeliveries } from "./simdeliver.js";
import { Store } from "./store.js";
import { Vault } from "./vault.js";

export type EngineEvent = { type: "task" | "journal" | "company" | "sale"; companyId: string; payload: unknown; at: number };
const DAY = 24 * 3600_000;

export class Engine {
  readonly store = new Store(config.dataDir);
  readonly vault = new Vault(config.dataDir, config.secret);
  readonly ledger = new Ledger(this.store.ledgerStore);
  readonly llm = config.openrouterKey ? new LlmClient({ apiKey: config.openrouterKey, appName: "NIGHTSHIFT" }) : null;
  readonly sim: SimDeliveries;
  readonly #simPlane: SimImdPlane;
  readonly #livePlanes = new Map<string, ImdPlane>();
  readonly #inputOwner = new WeakMap<object, string>();
  readonly #listeners = new Set<(e: EngineEvent) => void>();
  readonly #busy = new Set<string>();
  readonly auth: Auth;
  readonly reads = new ImdReads("https://api.imd.fun");

  constructor() {
    this.auth = new Auth(this.vault.material, this.store.apiKeys, () => this.store.markDirty());
    this.sim = new SimDeliveries(config.publicUrl, this.llm, config.model, (input) => {
      const id = typeof input === "object" && input ? this.#inputOwner.get(input) : undefined;
      return id ? this.store.companies.get(id) : undefined;
    }, `${config.dataDir}/sim-files`);
    this.#simPlane = new SimImdPlane({ jobMs: config.simJobSeconds * 1000, deliver: (j, a, i) => this.sim.deliver(j, a, i) });
  }

  async start(): Promise<void> {
    await this.store.load();
    setInterval(() => void this.#tick().catch((e) => console.error("tick", e)), 4000);
    setInterval(() => void this.store.flush(), 3000);
  }

  on(fn: (e: EngineEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit(companyId: string, type: EngineEvent["type"], payload: unknown): void {
    this.store.markDirty();
    const e = { type, companyId, payload, at: Date.now() };
    for (const l of this.#listeners) l(e);
  }

  /** The plane a company buys from: its own wallet against api.imd.fun, or the shared simulator. */
  plane(c: Company): ImdPlane {
    if (config.mode === "sim") {
      const owner = this.#inputOwner;
      const sim = this.#simPlane;
      return {
        mode: "sim",
        capabilities: () => sim.capabilities(),
        check: (a, i) => sim.check(a, i),
        open: (a: ImdAction, i: unknown) => { if (i && typeof i === "object") owner.set(i, c.id); return sim.open(a, i); },
        order: (o) => sim.order(o),
        job: (j) => sim.job(j),
        result: (j) => sim.result(j),
      };
    }
    let p = this.#livePlanes.get(c.id);
    if (!p) {
      const account = this.vault.account(c.id);
      let token = this.store.requestTokens.get(c.id);
      const http = new HttpImdPlane({ account, requestToken: token });
      if (!token) { token = http.requestToken; this.store.requestTokens.set(c.id, token); this.store.markDirty(); }
      let permitted = false;
      p = {
        mode: "live",
        capabilities: () => http.capabilities(),
        check: (a, i) => http.check(a, i),
        open: async (a, i) => {
          if (!permitted) { const tx = await ensurePermit2(account); if (tx) note(c, this.#deps(c), "note", `Approved Permit2 for IMD once: ${tx}`); permitted = true; }
          return http.open(a, i);
        },
        order: (o) => http.order(o),
        job: (j) => http.job(j),
        result: (j) => http.result(j),
      };
      this.#livePlanes.set(c.id, p);
    }
    return p;
  }

  stats(c: Company): CompanyStats {
    const m = this.store.metricsOf(c.id);
    const since = Date.now() - 7 * DAY;
    const sales = m.sales.filter((s) => s.at >= since);
    return {
      visits7d: m.visits.filter((v) => v >= since).length,
      sales7d: sales.length,
      revenue7dUsd: sales.reduce((a, s) => a + Number(s.usdc) / 1e6, 0),
      imdUsd: config.imdUsd,
    };
  }

  #deps(c: Company): ShiftDeps {
    return {
      imd: this.plane(c),
      ledger: this.ledger,
      llm: this.llm,
      model: config.model,
      imdUsd: () => config.imdUsd,
      stats: (x) => this.stats(x),
      buyBase: (x) => `${config.publicUrl}/buy/${x.slug}`,
      emit: (x, type, payload) => this.#emit(x.id, type, payload),
      findExisting: async (q) => {
        if (!q.trim()) return null;
        const r = await this.reads.publications(q, "research", 3);
        const hit = r.items[0];
        return hit ? { title: hit.title, url: hit.repo ?? hit.explorer } : null;
      },
    };
  }

  async create(idea: string, policy: Partial<Policy> = {}, owner: string | null = null): Promise<Company> {
    if (owner) {
      const mine = [...this.store.companies.values()].filter((x) => x.owner === owner.toLowerCase()).length;
      if (mine >= config.maxCompaniesPerOwner) throw new Error(`One wallet can run ${config.maxCompaniesPerOwner} companies at once.`);
    }
    const clean = idea.trim();
    if (clean.length < 12) throw new Error("Describe the idea in a sentence: what it sells and to whom.");
    if (clean.length > 1000) throw new Error("Keep the idea under 1000 characters.");
    const f = await found(clean, this.llm, config.model);
    const id = randomUUID();
    let slug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "co";
    while ([...this.store.companies.values()].some((x) => x.slug === slug)) slug = `${slug}-${Math.floor(Math.random() * 900 + 100)}`;
    const p = validatePolicy({ ...DEFAULT_POLICY, ...(config.mode === "sim" ? { shiftMinutes: config.simShiftMinutes } : {}), ...policy });
    const c: Company = {
      id, slug, name: f.name, idea: clean, mission: f.mission, audience: f.audience,
      createdAt: Date.now(), owner: owner?.toLowerCase() ?? null, wallet: this.vault.create(id), policy: p, status: "active",
      cycle: 0, nextShiftAt: p.autopilot ? Date.now() + 3000 : null,
      site: null, products: [], tasks: [], journal: [], marketing: [],
    };
    this.store.companies.set(id, c);
    if (config.mode === "sim") {
      // A demo company starts with 20 simulated IMD so it can buy work.
      await this.ledger.post({ id: `fund:${id}`, at: new Date(), kind: "funding", memo: "Simulated starting balance", postings: [
        { account: `co:${id}:imd`, asset: "IMD", amount: 20n * 10n ** 18n },
        { account: "ext:owner-sim", asset: "IMD", amount: -(20n * 10n ** 18n) },
      ] });
    }
    note(c, this.#deps(c), "plan", `Founded ${c.name}. Mission: ${c.mission} Audience: ${c.audience}.`);
    this.#emit(id, "company", null);
    return c;
  }

  get(idOrSlug: string): Company | undefined {
    return this.store.companies.get(idOrSlug) ?? [...this.store.companies.values()].find((c) => c.slug === idOrSlug);
  }

  async shiftNow(c: Company): Promise<void> {
    if (this.#busy.has(c.id)) throw new Error("a shift is already running");
    this.#busy.add(c.id);
    try {
      await runShift(c, this.#deps(c));
      if (c.policy.autopilot) c.nextShiftAt = Date.now() + c.policy.shiftMinutes * 60_000;
    } finally {
      this.#busy.delete(c.id);
      this.#emit(c.id, "company", null);
    }
  }

  async approve(c: Company, taskId: string): Promise<void> { await approve(c, taskId, this.#deps(c)); }
  reject(c: Company, taskId: string): void { reject(c, taskId, this.#deps(c)); }

  setPolicy(c: Company, p: Partial<Policy>): void {
    c.policy = validatePolicy({ ...c.policy, ...p });
    c.nextShiftAt = c.policy.autopilot ? Date.now() + c.policy.shiftMinutes * 60_000 : null;
    this.#emit(c.id, "company", null);
  }

  setStatus(c: Company, status: Company["status"]): void {
    c.status = status;
    note(c, this.#deps(c), "note", status === "paused" ? "Paused by the owner. No shifts, no spending." : "Resumed by the owner.");
    this.#emit(c.id, "company", null);
  }

  /** A sale, real (settled on chain) or simulated. Revenue lands in the company's own wallet. */
  async recordSale(c: Company, productId: string, amount: bigint, payer: string, tx: string | null, sim: boolean): Promise<void> {
    const p = c.products.find((x) => x.id === productId);
    if (!p) return;
    p.sales += 1;
    p.revenueUsdc += amount;
    const m = this.store.metricsOf(c.id);
    m.sales.push({ at: Date.now(), productId, usdc: amount.toString(), payer, tx, sim });
    if (m.sales.length > 5000) m.sales.splice(0, m.sales.length - 5000);
    await this.ledger.post({ id: `sale:${tx ?? randomUUID()}`, at: new Date(), kind: sim ? "sale_sim" : "sale", memo: p.name, ref: tx ? { chainTx: tx } : undefined, postings: [
      { account: `co:${c.id}:usdc`, asset: "USDC", amount },
      { account: sim ? "ext:buyers-sim" : "ext:buyers", asset: "USDC", amount: -amount },
    ] });
    note(c, this.#deps(c), "sale", `${sim ? "[sim] " : ""}Sold ${p.name} for $${fromUsdc(amount).toFixed(2)} to ${payer.slice(0, 6)}…${payer.slice(-4)}.`);
    this.#emit(c.id, "sale", { productId, amount: amount.toString(), sim });
  }

  /** Revenue the owner can take out now: what the company earned, minus what was already withdrawn. */
  async withdrawable(c: Company): Promise<bigint> {
    return this.ledger.balance(`co:${c.id}:usdc`, "USDC");
  }

  /**
   * Sends the company's USDC to its owner. The platform fee, when one is set, goes to the platform
   * treasury in the same withdrawal. In sim mode only the books move.
   */
  async withdraw(c: Company, to: `0x${string}`, amount?: bigint): Promise<{ sent: bigint; fee: bigint; txs: string[] }> {
    const available = await this.withdrawable(c);
    const total = amount ?? available;
    if (total <= 0n || total > available) throw new Error(`Nothing to withdraw, or more than the $${fromUsdc(available).toFixed(2)} available.`);
    const fee = config.platformTreasury ? (total * BigInt(config.platformFeeBps)) / 10_000n : 0n;
    const sent = total - fee;
    const txs: string[] = [];
    if (config.mode === "live") {
      const account = this.vault.account(c.id);
      const wallet = salesWallet(account);
      const usdcAddr = USDC[config.salesChainId]!.address;
      const send = async (dest: `0x${string}`, v: bigint) => {
        const hash = await wallet.writeContract({ address: usdcAddr, abi: erc20Abi, functionName: "transfer", args: [dest, v] });
        const r = await sales.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error(`transfer reverted: ${hash}`);
        txs.push(hash);
      };
      await send(to, sent);
      if (fee > 0n) await send(config.platformTreasury as `0x${string}`, fee);
    }
    const id = txs[0] ?? randomUUID();
    await this.ledger.post({ id: `withdraw:${id}`, at: new Date(), kind: "withdrawal", memo: `to ${to}`, ref: txs[0] ? { chainTx: txs[0] } : undefined, postings: [
      { account: `co:${c.id}:usdc`, asset: "USDC", amount: -total },
      { account: `ext:owner:${to.toLowerCase()}`, asset: "USDC", amount: sent },
      ...(fee > 0n ? [{ account: "ext:platform", asset: "USDC", amount: fee }] : []),
    ] });
    note(c, this.#deps(c), "note", `Withdrew $${fromUsdc(sent).toFixed(2)} to ${to.slice(0, 6)}…${to.slice(-4)}${fee > 0n ? ` (platform fee $${fromUsdc(fee).toFixed(2)})` : ""}${config.mode === "sim" ? " [sim]" : ""}.`);
    this.#emit(c.id, "company", null);
    return { sent, fee, txs };
  }

  async #tick(): Promise<void> {
    const now = Date.now();
    for (const c of this.store.companies.values()) {
      if (c.tasks.some((t) => t.status === "building")) await advance(c, this.#deps(c)).catch((e) => console.error("advance", c.slug, e));
      if (c.status === "active" && c.policy.autopilot && c.nextShiftAt && now >= c.nextShiftAt && !this.#busy.has(c.id)) {
        await this.shiftNow(c).catch((e) => console.error("shift", c.slug, e));
      }
      if (config.mode === "sim") {
        const m = this.store.metricsOf(c.id);
        const r = simulateTraffic(c, m, 4000, now);
        for (let i = 0; i < r.visits; i++) m.visits.push(now);
        if (m.visits.length > 20000) m.visits.splice(0, m.visits.length - 20000);
        for (const s of r.sales) await this.recordSale(c, s.productId, s.usdc, `0x${randomUUID().replace(/-/g, "")}sim0000`, null, true);
        if (r.visits) this.store.markDirty();
      }
    }
  }
}
