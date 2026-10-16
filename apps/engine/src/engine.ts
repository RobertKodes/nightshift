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
import { ProductFiles, fetchDelivery } from "./products.js";
import { buyCard, raid, publicCommand, sendCard, startCommunity, toCommunity, welcome } from "./community.js";
import { type Button, type Reply, blueskyPost, blueskySession, esc, telegram, telegramCommands } from "./social.js";
import { followLaunch, holderStatus, holdsCached, launchState } from "./token.js";
import { writeSettings } from "./settings.js";

export type EngineEvent = { type: "task" | "journal" | "company" | "sale"; companyId: string; payload: unknown; at: number };
const DAY = 24 * 3600_000;

export class Engine {
  readonly store = new Store(config.dataDir);
  readonly vault = new Vault(config.dataDir, config.secret);
  readonly ledger = new Ledger(this.store.ledgerStore);
  readonly llm = config.openrouterKey ? new LlmClient({ apiKey: config.openrouterKey, appName: "NIGHTSHIFT" }) : null;
  readonly sim: SimDeliveries;
  /** Private, packaged copies of what each company sells. */
  readonly files: ProductFiles;
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
    this.files = new ProductFiles(config.dataDir, this.vault.material, this.llm, config.model, config.publicUrl);
    this.#simPlane = new SimImdPlane({ jobMs: config.simJobSeconds * 1000, deliver: (j, a, i) => this.sim.deliver(j, a, i) });
  }

  async start(): Promise<void> {
    await this.store.load();
    setInterval(() => void this.#tick().catch((e) => console.error("tick", e)), 4000);
    setInterval(() => void this.store.flush(), 3000);
    void this.alert(`Engine started in ${config.mode.toUpperCase()} mode · ${config.publicUrl}`, "start");
    if (config.telegramToken) {
      telegramCommands(config.telegramToken, config.telegramAdmins, {
        admin: (cmd, args) => this.#command(cmd, args),
        open: (cmd) => publicCommand(cmd),
        // Share an X post to the bot and it raids it in the community chat.
        adminText: async (text) => {
          const url = text.match(/https?:\/\/(?:x|twitter)\.com\/\S+\/status\/\d+\S*/)?.[0];
          if (!url) return null;
          const note = text.replace(url, "").trim();
          return { text: (await raid(url.split("?")[0]!, note)) ? "🚨 Raid posted in the community." : "⚠️ Could not post. Is the bot in the community chat?" };
        },
        joined: (chat, names) => { const w = welcome(names); void sendCard(chat, "welcome", w.text, w.buttons); },
      });
      startCommunity();
    }
    setInterval(() => void this.#followTokenLaunch(), 60_000);
    // The daily report, at 08:00 UTC.
    let reported = "";
    setInterval(() => {
      const d = new Date();
      const day = d.toISOString().slice(0, 10);
      if (d.getUTCHours() !== 8 || reported === day || !config.telegramToken) return;
      reported = day;
      void this.#report().then((t) => Promise.all(config.telegramChat.split(",").map((id) => id.trim()).filter(Boolean).map((id) => sendCard(id, "report", t))));
    }, 60_000);
    if (!config.imdUsdPinned) {
      void this.#refreshImdPrice();
      setInterval(() => void this.#refreshImdPrice(), 10 * 60_000);
    }
  }

  /** What the operator can do from Telegram: cards with buttons. */
  async #command(cmd: string, args: string[]): Promise<Reply> {
    const all = [...this.store.companies.values()];
    const find = (s?: string) => all.find((c) => c.slug === s || c.id === s);
    const menu: Button[][] = [
      [{ text: "📊 Status", data: "/status" }, { text: "🏢 Companies", data: "/companies" }],
      [{ text: "🛒 Market", data: "/market" }, { text: "🪙 Token", data: "/token" }],
      [{ text: "📰 Report", data: "/report" }, { text: "🌐 Open site", url: config.publicUrl }],
      [{ text: "🛑 Emergency stop", data: "/stop" }],
    ];
    const back: Button[][] = [[{ text: "← Menu", data: "/menu" }, { text: "🔄 Refresh", data: `/${cmd}` }]];
    const money = (n: number) => `$${n.toFixed(2)}`;
    if (cmd === "start" || cmd === "menu" || cmd === "help") {
      return { text: `🌙 <b>NIGHTSHIFT control room</b>\n<i>Autonomous AI companies that build with the IMD swarm.</i>\n\nMode: <b>${config.mode === "live" ? "🟢 LIVE" : "🧪 SIMULATION"}</b>\n\n/status · /companies · /market · /token · /report\n/pause &lt;slug&gt; · /resume &lt;slug&gt; · /stop`, buttons: menu };
    }
    if (cmd === "status") {
      const h = await this.reads.health().catch(() => null);
      const live = all.reduce((a, c) => a + c.products.filter((p) => p.status === "live").length, 0);
      const waiting = all.reduce((a, c) => a + c.tasks.filter((t) => t.status === "awaiting_approval").length, 0);
      const working = all.filter((c) => c.tasks.some((t) => ["checking", "ordering", "building"].includes(t.status))).length;
      const lines = [
        "📊 <b>Status</b>", "",
        `<b>Mode</b> · ${config.mode === "live" ? "🟢 LIVE" : "🧪 simulation"}`,
        `<b>Companies</b> · ${all.length} (${all.filter((c) => c.status === "active").length} active, ${working} working now)`,
        `<b>Products</b> · ${live} on sale`,
        `<b>Waiting for you</b> · ${waiting} purchase${waiting === 1 ? "" : "s"}`,
        `<b>Swarm</b> · ${h?.connectedDaemons?.toLocaleString() ?? "?"} IMD agents online`,
        `<b>IMD</b> · $${config.imdUsd.toFixed(2)}`,
        ...(config.token.address ? [`<b>Token</b> · $${esc(config.token.symbol)} live`] : []),
        "", `<a href="${config.publicUrl}">${esc(config.publicUrl.replace(/^https?:\/\//, ""))}</a>`,
      ];
      return { text: lines.join("\n"), buttons: back };
    }
    if (cmd === "companies") {
      if (!all.length) return { text: "🏢 <b>Companies</b>\n\nNone yet.", buttons: back };
      const rows = await Promise.all(all.slice(0, 20).map(async (c) => {
        const w = fromUsdc(await this.withdrawable(c));
        const busy = c.tasks.find((t) => ["checking", "ordering", "building"].includes(t.status));
        return `${c.status === "active" ? "🟢" : "⏸"} <b>${esc(c.name)}</b> <code>${esc(c.slug)}</code>\n   shift ${c.cycle} · ${money(w)} · ${c.products.filter((p) => p.status === "live").length} products${busy ? `\n   ⚙️ ${esc(busy.title)}` : ""}`;
      }));
      const btns: Button[][] = all.slice(0, 6).map((c) => [{ text: `${c.status === "active" ? "⏸ Pause" : "▶️ Resume"} ${c.name}`, data: `/${c.status === "active" ? "pause" : "resume"} ${c.slug}` }]);
      return { text: `🏢 <b>Companies</b> (${all.length})\n\n${rows.join("\n\n")}`, buttons: [...btns, ...back] };
    }
    if (cmd === "market") {
      const items = this.market().slice(0, 10);
      const body = items.length ? items.map((p) => `• <b>${esc(p.name)}</b> · ${money(p.priceUsd)} · ${p.sales} sold${p.featured ? " ⭐" : ""}\n   by ${esc(p.company)}`).join("\n") : "Nothing on sale yet.";
      return { text: `🛒 <b>Market</b>\n\n${body}`, buttons: [[{ text: "Open the market", url: `${config.publicUrl}/market` }], ...back] };
    }
    if (cmd === "token") {
      const l = launchState();
      const t = config.token;
      const body = t.address
        ? `<b>$${esc(t.symbol)}</b> is live\n<code>${t.address}</code>\nHolders of ${t.holderMin.toLocaleString()}+ pay no platform fee and are featured.`
        : l && !l.error ? `Launching <b>$${esc(l.symbol)}</b>…\n${esc(l.stage)}` : "Not launched yet. Launch it from /setup.";
      const btns: Button[][] = t.address
        ? [[{ text: "Etherscan", url: `https://etherscan.io/token/${t.address}` }, ...(t.buyUrl ? [{ text: "Buy", url: t.buyUrl }] : [])]]
        : [[{ text: "Open /setup", url: `${config.publicUrl}/setup` }]];
      return { text: `🪙 <b>Token</b>\n\n${body}`, buttons: [...btns, ...back] };
    }
    if (cmd === "report") return { text: await this.#report(), buttons: back };
    if (cmd === "raid") {
      const url = args.find((a) => /(?:x|twitter)\.com\/.+\/status\/\d+/.test(a));
      if (!url) return { text: "Usage: /raid &lt;x.com post link&gt; [note]\nOr just share the X post to me.", buttons: back };
      const ok = await raid(url.split("?")[0]!, args.filter((a) => a !== url).join(" "));
      return { text: ok ? "🚨 Raid posted in the community." : `⚠️ Could not post to ${esc(config.telegramCommunity)}. Add the bot to the group (as admin in a channel).`, buttons: back };
    }
    if (cmd === "testall") return { text: await this.testAll(), buttons: back };
    if (cmd === "testbuy") {
      const usdv = Number(args[0]) > 0 ? Number(args[0]) : 420;
      const card = buyCard({ test: true, usd: usdv, imd: usdv / config.imdUsd, tokens: usdv / 0.0000025, buyer: "0x8f3a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c", tx: "0x" + "0".repeat(64), newHolder: true, position: 0, mcap: 2500 * config.imdUsd, liquidity: 2500 * config.imdUsd * 0.9 });
      const ok = await toCommunity(card.text, card.buttons, usdv >= 2500 ? "whale" : "buy");
      return { text: ok ? `🧪 Sample $${usdv} buy card sent to ${esc(config.telegramCommunity)}.` : `⚠️ Could not post to ${esc(config.telegramCommunity)}. Add the bot to the group first.`, buttons: back };
    }
    if (cmd === "pause" || cmd === "resume") {
      const c = find(args[0]);
      if (!c) return { text: `Usage: /${cmd} &lt;slug&gt;`, buttons: back };
      this.setStatus(c, cmd === "pause" ? "paused" : "active");
      return this.#command("companies", []);
    }
    if (cmd === "stop") return { text: "🛑 <b>Pause every company?</b>\nNothing will spend until you resume them.", buttons: [[{ text: "Yes, stop everything", data: "/stopnow" }, { text: "Cancel", data: "/menu" }]] };
    if (cmd === "stopnow") {
      for (const c of all) if (c.status === "active") this.setStatus(c, "paused");
      return { text: `🛑 <b>Stopped.</b> ${all.length} companies paused.`, buttons: [[{ text: "▶️ Resume all", data: "/resumeall" }], ...back] };
    }
    if (cmd === "resumeall") {
      for (const c of all) if (c.status === "paused") this.setStatus(c, "active");
      return { text: `▶️ <b>Resumed</b> ${all.length} companies.`, buttons: back };
    }
    return this.#command("menu", []);
  }

  /** The last 24 hours, for the daily message and /report. */
  async #report(): Promise<string> {
    const since = Date.now() - 24 * 3600_000;
    const all = [...this.store.companies.values()];
    let revenue = 0;
    let sales = 0;
    for (const c of all) for (const s of this.store.metricsOf(c.id).sales) if (s.at >= since) { revenue += Number(s.usdc) / 1e6; sales++; }
    const shipped = all.flatMap((c) => c.journal.filter((j) => j.at >= since && j.kind === "result").map((j) => `• ${esc(c.name)}: ${esc(j.text.replace(/^\[sim\] /, "").slice(0, 120))}`)).slice(0, 8);
    const warnings = all.reduce((a, c) => a + c.journal.filter((j) => j.at >= since && j.kind === "warning").length, 0);
    return [
      `📰 <b>Last 24 hours</b>${config.mode === "sim" ? " <i>(simulation)</i>" : ""}`, "",
      `💰 ${sales} sale${sales === 1 ? "" : "s"} · $${revenue.toFixed(2)}`,
      `🏢 ${all.length} companies`,
      `⚠️ ${warnings} warning${warnings === 1 ? "" : "s"}`, "",
      shipped.length ? `<b>Shipped</b>\n${shipped.join("\n")}` : "Nothing shipped.",
    ].join("\n");
  }

  /** While the platform token is being launched through IMD, follow it and switch it on when live. */
  async #followTokenLaunch(): Promise<void> {
    const before = launchState();
    if (!before || before.done) return;
    const l = await followLaunch();
    if (l && l.stage !== before.stage) void this.alert(`🪙 ${l.symbol} launch: ${l.stage}`, `launch-${l.stage}`);
    if (l?.token && !config.token.address) {
      const buyUrl = `https://app.uniswap.org/swap?chain=mainnet&inputCurrency=0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7&outputCurrency=${l.token}`;
      writeSettings({ TOKEN_ADDRESS: l.token, TOKEN_SYMBOL: l.symbol, TOKEN_BUY_URL: buyUrl });
      Object.assign(config.token, { address: l.token as `0x${string}`, symbol: l.symbol, buyUrl });
      void toCommunity(`🚀🌙 <b>$${esc(l.symbol)} IS LIVE</b>

<code>${l.token}</code>

Paired with IMD on Ethereum. Every trade pays the IMD swarm.`, [[{ text: `🟢 Buy $${l.symbol}`, url: buyUrl }], [{ text: "🪙 Token page", url: `${config.publicUrl}/token` }]], "launch");
      void this.alert(`🚀 $${l.symbol} is live: ${l.token}
${config.publicUrl}/token`, "launch-live");
    }
  }

  /** The IMD price from its deepest Ethereum pool on DexScreener; keeps the last good value on failure. */
  async #refreshImdPrice(): Promise<void> {
    try {
      const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7", { signal: AbortSignal.timeout(8000) });
      const d = (await r.json()) as { pairs?: { chainId: string; baseToken: { address: string }; priceUsd?: string; liquidity?: { usd?: number } }[] };
      const best = (d.pairs ?? [])
        .filter((p) => p.chainId === "ethereum" && p.baseToken.address.toLowerCase() === "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7")
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      const price = Number(best?.priceUsd);
      if (price > 0.01 && price < 10_000) { config.imdUsd = price; config.imdUsdAt = Date.now(); }
    } catch { /* keep the last price */ }
  }

  on(fn: (e: EngineEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit(companyId: string, type: EngineEvent["type"], payload: unknown): void {
    this.store.markDirty();
    if (type === "journal" && config.mode === "live" && (payload as { kind?: string }).kind === "warning") {
      const c = this.store.companies.get(companyId);
      void this.alert(`${c?.name ?? companyId}: ${(payload as { text: string }).text}`, companyId);
    }
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

  /** `byOwner`: the owner pressed "run a shift", which also ends a budget rest. */
  async shiftNow(c: Company, byOwner = false): Promise<void> {
    if (this.#busy.has(c.id)) throw new Error("a shift is already running");
    if (byOwner) delete c.restUntil;
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
    delete c.restUntil; // new limits: worth trying again
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
    if (!sim) void toCommunity(`💰 <b>A NIGHTSHIFT company just made a sale</b>

${esc(c.name)} sold <b>${esc(p.name)}</b> for $${fromUsdc(amount).toFixed(2)}.
Built by the IMD swarm, sold while its owner slept 🌙`, [[{ text: "🛒 See the market", url: `${config.publicUrl}/market` }]], "sale");
    if (!sim) void this.alert(`💰 ${c.name} sold ${p.name} for $${fromUsdc(amount).toFixed(2)}${tx ? ` · tx ${tx}` : ""}`, `sale-${tx ?? Date.now()}`);
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
    const holder = (await holderStatus(c.owner)).holds;
    const fee = config.platformTreasury && !holder ? (total * BigInt(config.platformFeeBps)) / 10_000n : 0n;
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

  readonly #lastAlert = new Map<string, number>();
  /** Tells the operator on Telegram, at most once a minute per topic. */
  async alert(text: string, topic = "engine"): Promise<boolean> {
    if (!config.telegramToken || !config.telegramChat) return false;
    const last = this.#lastAlert.get(topic) ?? 0;
    if (Date.now() - last < 60_000) return false;
    this.#lastAlert.set(topic, Date.now());
    const kind = topic.startsWith("sale") ? "sale" : topic.startsWith("launch") ? "launch" : "alert";
    const sent = await Promise.all(config.telegramChat.split(",").map((id) => id.trim()).filter(Boolean).map((id) => sendCard(id, kind, `🌙 <b>NIGHTSHIFT</b>\n${esc(text)}`)));
    return sent.some(Boolean);
  }

  /** Every card the bot can send, marked TEST, to the chats they belong in. */
  async testAll(): Promise<string> {
    const T = "🧪 <b>TEST</b> · ";
    const sym = config.token.symbol;
    const shown: string[] = [];
    const say = async (what: string, p: Promise<boolean>) => { shown.push(`${(await p) ? "✅" : "❌"} ${what}`); };
    const buy = (usdv: number) => buyCard({ test: true, usd: usdv, imd: usdv / config.imdUsd, tokens: usdv / 0.0000068, buyer: "0x8f3a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c", tx: `0x${"0".repeat(64)}`, newHolder: usdv < 1000, position: 35, mcap: 2500 * config.imdUsd, liquidity: 2250 * config.imdUsd });
    const b1 = buy(180); await say("Buy", toCommunity(b1.text, b1.buttons, "buy"));
    const b2 = buy(3200); await say("Whale buy", toCommunity(b2.text, b2.buttons, "whale"));
    await say("X raid", raid(`${config.xUrl}/status/1846000000000000000`, "TEST: this is how a raid looks"));
    await say("Token launch", toCommunity(`${T}🚀🌙 <b>$${esc(sym)} IS LIVE</b>\n\n<code>0x0000…TEST</code>\n\nPaired with IMD on Ethereum. Every trade pays the IMD swarm.`, [[{ text: `🟢 Buy $${sym}`, url: `${config.publicUrl}/token` }]], "launch"));
    await say("Company sale", toCommunity(`${T}💰 <b>A NIGHTSHIFT company just made a sale</b>\n\nLetsBuild sold <b>Market report</b> for $9.00.\nBuilt by the IMD swarm, sold while its owner slept 🌙`, [[{ text: "🛒 See the market", url: `${config.publicUrl}/market` }]], "sale"));
    await say("Milestone", toCommunity(`${T}🏆 <b>$${esc(sym)} just crossed $25.0K market cap!</b>\n\nThe night shift keeps building 🌙🐸`, [[{ text: "📊 Chart", url: `${config.publicUrl}/token` }]], "milestone"));
    const w = welcome(["Test Frog"]); await say("Welcome", toCommunity(`${T}${w.text}`, w.buttons, "welcome"));
    await say("New Bluesky post", toCommunity(`${T}🦋 <b>New on Bluesky</b>\n\nOne sentence becomes a company. Built by the IMD swarm while you sleep.\n\nLike and repost it 🌙`, [[{ text: "🦋 Open on Bluesky", url: `https://bsky.app/profile/${config.blueskyHandle}` }]], "post"));
    const admin = config.telegramChat.split(",").map((x) => x.trim()).filter(Boolean);
    await say("Operator alert", Promise.all(admin.map((id) => sendCard(id, "alert", `${T}🌙 <b>NIGHTSHIFT</b>\nLetsBuild: the swarm job failed, retrying in 5 minutes.`))).then((r) => r.some(Boolean)));
    await say("Sale alert", Promise.all(admin.map((id) => sendCard(id, "sale", `${T}🌙 <b>NIGHTSHIFT</b>\n💰 LetsBuild sold Market report for $9.00`))).then((r) => r.some(Boolean)));
    await say("Daily report", Promise.all(admin.map(async (id) => sendCard(id, "report", `${T}${await this.#report()}`))).then((r) => r.some(Boolean)));
    return `🧪 <b>Test run</b>\nCommunity: ${esc(config.telegramCommunity)}\n\n${shown.join("\n")}`;
  }

  /** Checks the app password with Bluesky before keeping it. */
  async connectBluesky(c: Company, handle: string, appPassword: string, auto: boolean): Promise<string> {
    const s = await blueskySession(handle, appPassword);
    this.vault.putSecret(`bsky:${c.id}`, appPassword);
    c.social = { ...c.social, bluesky: { handle: s.handle, auto } };
    note(c, this.#deps(c), "note", `Connected Bluesky @${s.handle}${auto ? "; posts go out on their own in live mode" : "; posts wait for you"}.`);
    this.#emit(c.id, "company", null);
    return s.handle;
  }
  disconnectBluesky(c: Company): void {
    this.vault.putSecret(`bsky:${c.id}`, null);
    if (c.social) delete c.social.bluesky;
    this.#emit(c.id, "company", null);
  }
  async publishPost(c: Company, index: number): Promise<string> {
    const m = c.marketing[index];
    const b = c.social?.bluesky;
    const pw = this.vault.getSecret(`bsky:${c.id}`);
    if (!m) throw new Error("no such post");
    if (m.status === "posted") return m.url ?? "";
    if (!b || !pw) throw new Error("Connect a Bluesky account first.");
    try {
      const url = await blueskyPost(b.handle, pw, m.text);
      Object.assign(m, { status: "posted", url, channel: "bluesky", error: undefined });
      note(c, this.#deps(c), "result", `Posted on Bluesky: ${url}`);
      return url;
    } catch (e) {
      Object.assign(m, { status: "failed", error: (e as Error).message });
      note(c, this.#deps(c), "warning", `Bluesky post failed: ${(e as Error).message}`);
      throw e;
    } finally {
      this.#emit(c.id, "company", null);
    }
  }

  /** Every product on sale across all companies: the public catalog for people and agents. */
  market(q = ""): { company: string; slug: string; id: string; name: string; kind: string; pitch: string; priceUsd: number; sales: number; featured: boolean; buyUrl: string; page: string }[] {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return [...this.store.companies.values()]
      .flatMap((c) => c.products.filter((p) => p.status === "live" && this.files.has(p)).map((p) => ({
        company: c.name, slug: c.slug, id: p.id, name: p.name, kind: p.kind, pitch: p.pitch,
        priceUsd: Number(p.priceUsdc) / 1e6, sales: p.sales, featured: holdsCached(c.owner),
        buyUrl: `${config.publicUrl}/buy/${c.slug}/${p.id}`, page: `${config.publicUrl}/c/${c.slug}#${p.id}`,
        text: `${c.name} ${c.mission} ${c.audience} ${p.name} ${p.pitch}`.toLowerCase(),
      })))
      .filter((x) => words.every((w) => x.text.includes(w)))
      .sort((a, b) => Number(b.featured) - Number(a.featured) || b.sales - a.sales)
      .map(({ text: _t, ...x }) => x);
  }

  async #tick(): Promise<void> {
    const now = Date.now();
    for (const c of this.store.companies.values()) {
      if (c.tasks.some((t) => t.status === "building")) await advance(c, this.#deps(c)).catch((e) => console.error("advance", c.slug, e));
      if (c.status === "active" && c.policy.autopilot && c.nextShiftAt && now >= c.nextShiftAt && !this.#busy.has(c.id)) {
        await this.shiftNow(c).catch((e) => console.error("shift", c.slug, e));
      }
      if (config.mode === "live" && c.social?.bluesky?.auto) {
        const i = c.marketing.findIndex((m) => m.status === "drafted");
        if (i >= 0) await this.publishPost(c, i).catch(() => {});
      }
      if (c.owner) void holderStatus(c.owner);
      for (const p of c.products) {
        if (p.status !== "live" || this.files.has(p)) continue;
        const t = c.tasks.find((x) => x.id === p.taskId);
        void this.files.ensure(c, p, async () => {
          if (!t?.result) return null;
          if (config.mode === "sim" && t.imd?.jobId) {
            const name = Object.keys(t.result.files ?? {})[0];
            return name ? this.sim.file(t.imd.jobId, name) : null;
          }
          return fetchDelivery(t.result.files, t.result.repoUrl);
        });
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
