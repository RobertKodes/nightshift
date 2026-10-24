import { startLeague } from "./league-routes.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  type Brain,
  type ChatLine,
  type Company,
  type CompanyStats,
  type Decision,
  type JournalEntry,
  DEFAULT_POLICY,
  type Policy,
  type ShiftDeps,
  type Task,
  CHANNELS,
  advance,
  aiSpentToday,
  approve,
  budgetPrice,
  commission,
  dropMarketBuy,
  finishMarketBuy,
  finishStudio,
  found,
  fromImd,
  fromUsdc,
  keywordScore,
  mark,
  marketReserved,
  missingAddress,
  note,
  ownerBuy,
  recoverAddresses,
  reject,
  runShift,
  validatePolicy,
} from "@nightshift/core";
import { HttpImdPlane, type ImdAction, type ImdPlane, SimImdPlane } from "@nightshift/imd";
import { Ledger } from "@nightshift/ledger";
import { ImdReads } from "imd-mcp/lib";
import { encodeFunctionData, erc20Abi, parseAbiItem } from "viem";
import { CdpFacilitator, type PaymentPayload, USDC, USDC_ABI, settlementData } from "@nightshift/x402";
import { Auth } from "./auth.js";
import { LlmClient } from "@nightshift/llm";
import { balances, broadcastSales, ensurePermit2, eth, ethWallet, refusedByNode, sales, salesTxState, salesWallet, signSales } from "./chain.js";
import { FEE_PARTS, Payouts } from "./payout.js";
import { Checkout, NoGasError, PendingError, type SettledBy, type Settlement, saleKey } from "./checkout.js";
import { offerFor } from "./agentmarket.js";
import { MarketDesk } from "./b2b.js";
import { companyBrain } from "./ceo-brain.js";
import { liveMind, liveWeather } from "./mind-live.js";
import { weatherText } from "./swarm-weather.js";
import { Studio } from "./studio/index.js";
import { type ChatFacts, answerOwner, asksToday, remember } from "./ceo-chat.js";
import { V4, findPool } from "./v4.js";
import { DEV_WALLET, FIRST_BUYER, IMD_BURN_EXECUTOR } from "./shift-launch.js";
import { forgive, judge, muteMinutes, strike, track } from "./moderation.js";
import { liveStats } from "./live.js";
import { type Facts, allowed, answer, spend, worthAsking } from "./assistant.js";
import { type KeeperRun, keeperAccount, keeperGasAlert, markGasAlert, runKeeper, sampleKeeper } from "./keeper.js";
import { buildEpoch } from "./frogpot.js";
import { IMD_MAINNET } from "@nightshift/imd";
import { config } from "./config.js";
import { simulateTraffic } from "./market.js";
import { SimDeliveries } from "./simdeliver.js";
import { Store } from "./store.js";
import { Vault } from "./vault.js";
import { ProductFiles, fetchDelivery, toolAccess } from "./products.js";
import { newFrogListings, newFrogSales, OPENSEA_SLUG } from "./frogmarket.js";
import { fillTraits, frogCaption, sendFrogCard } from "./frogcard.js";
import { type ArcadeEvent, onArcade } from "./pinball.js";
import { followSwarm } from "./swarm.js";
import { live as gameLobby } from "./games-routes.js";
import { betCard, duelCard, freeDuelCard } from "./duelcards.js";
import { liveBets } from "./bets-routes.js";
import { liveGames } from "./spectate.js";
import { startDigest } from "./digest.js";
import { startChangelog } from "./changelog.js";
import { type ChessEvent, onChess } from "./chess.js";
import { accrueStaking, frogCached, frogCount, frogSlots, frogStats, frogsOn, markRevealAnnounced, milestoneSeen, newMints, revealAnnounced, setMilestone, stakingBoard } from "./frogs.js";
import { roomLink, sweepRoom } from "./watch-room.js";
import { forgeOn, forgedAll } from "./forge.js";
import { followForges } from "./forge-news.js";
import { startGuard } from "./guard.js";
import { HACKATHON, followHackathon, followJudging, hackathonStatus } from "./hackathon.js";
import { startNightWatch } from "./nightwatch.js";
import { followOrders } from "./orders.js";
import { houseNow, houseOn, housePost, houseStatus, houseTick } from "./house.js";
import { type Anim, burnTotals, buyCard, chats, marketSnapshot, publicCommand, sendCard, startCommunity, toCommunity, welcome } from "./community.js";
import { liveDex, liveSniper } from "./sniper-live.js";
import { type Button, type CommandContext, type GroupMessage, type Reply, esc, telegram, telegramCommands, tgCall } from "./social.js";
import { Connect } from "./connect.js";
import type { Http } from "./channels.js";
import { safeFetch } from "./net.js";
import { IMD_TOKEN, completeContracts, followLaunch, followOpen, holderStatus, holdsCached, launchState, patchLaunch, saveVerification } from "./token.js";
import { verifyShift } from "./shift-verify.js";
import { writeSettings } from "./settings.js";
import { Profiles } from "./tg.js";
import { GameBot } from "./tg-bot.js";

/** A NIGHT FROG market card with the frog's own picture on top; the plain card if the photo can't be sent. */
async function frogPost(id: number, caption: string, buttons: Button[][], kind: Anim): Promise<boolean> {
  if (!config.telegramToken) return false;
  const sent = await Promise.all(chats().map((c) => sendFrogCard(c, id, caption, buttons)));
  return sent.some(Boolean) || toCommunity(caption, buttons, kind);
}

export type EngineEvent = { type: "task" | "journal" | "company" | "sale"; companyId: string; payload: unknown; at: number };
const DAY = 24 * 3600_000;

/** Owner text as plain words: no markup (it reaches the page head, the shop and Telegram), one line. */
const plain = (v: unknown) => String(v).replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

export class Engine {
  readonly store = new Store(config.dataDir);
  readonly vault = new Vault(config.dataDir, config.secret);
  readonly ledger = new Ledger(this.store.ledgerStore);
  readonly llm = config.openrouterKey ? new LlmClient({ apiKey: config.openrouterKey, appName: "NIGHTSHIFT", fallbackModels: config.fallbackModels, freeOnly: !config.llmAllowPaid }) : null;
  readonly sim: SimDeliveries;
  /** Private, packaged copies of what each company sells. */
  readonly files: ProductFiles;
  /** Companies buying from each other on the NIGHTSHIFT market (B2B), booked on both sides. */
  readonly b2b: MarketDesk;
  /** Real digital products made in-house: hyperlinked planners, with their listing images. */
  readonly studio: Studio;
  /** The accounts owners connected (Gumroad to sell; Bluesky, Telegram, Mastodon, Discord to post) and what the CEOs do with them. */
  readonly connect: Connect;
  readonly #simPlane: SimImdPlane;
  readonly #livePlanes = new Map<string, ImdPlane>();
  readonly #inputOwner = new WeakMap<object, string>();
  readonly #listeners = new Set<(e: EngineEvent) => void>();
  readonly #busy = new Set<string>();
  /** The strong model each company pays for itself, over x402 from its own USDC (live on Base, with a CEO model set). */
  #brain: ((c: Company) => Promise<Brain | null>) | null = null;
  readonly auth: Auth;
  readonly reads = new ImdReads("https://api.imd.fun");
  /** Withdrawals, leg by leg, and x402 settlements: both saved before broadcast and booked once they land. */
  readonly payouts: Payouts;
  readonly checkout: Checkout;
  /** Coinbase's CDP facilitator, when x402 payments settle through it (a CDP key is set); null otherwise. */
  readonly facilitator: CdpFacilitator | null = config.x402Facilitator === "cdp" ? new CdpFacilitator({ id: config.cdpApiKeyId, secret: config.cdpApiKeySecret }) : null;
  /** The bot's game commands: links to the games on the website, and the records Telegram players kept from the old Mini App (read only). */
  readonly gameBot = new GameBot({ profiles: new Profiles() });
  /** NIGHT SNIPER: every new IMD launch checked and called (off in sim unless SNIPER=1). */
  readonly sniper = config.sniper ? liveSniper() : null;
  /** The NIGHT SNIPER dex: every IMD token and NFT collection, filled in a few at a time. */
  readonly dex = config.sniper ? liveDex() : null;
  /** SWARM MIND: everything the IMD swarm published, searchable and askable (live only: it reads IMD's public API). */
  readonly mind = config.mode === "live" || process.env.SWARM_MIND === "1" ? liveMind() : null;
  /** SWARM WEATHER: the swarm's day as a forecast, with its card; posted once a day at 18:00 UTC unless SWARM_WEATHER=0. */
  readonly weather = this.mind ? liveWeather(this.mind) : null;

  constructor() {
    this.auth = new Auth(this.vault.material, this.store.apiKeys, () => this.store.markDirty());
    const usdcAddr = () => USDC[config.salesChainId]!.address;
    const from = (id: string) => this.vault.account(id).address;
    this.payouts = new Payouts(this.ledger, this.store.payouts, () => this.store.save(), config.mode === "live" ? {
      sign: (id, to, amount) => signSales(this.vault.account(id), usdcAddr(), encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] })),
      broadcast: broadcastSales,
      state: (id, hash, nonce, ms) => salesTxState(from(id), hash, nonce, ms),
      refused: refusedByNode,
    } : null);
    this.checkout = new Checkout(this.store.settlements, () => this.store.save(), {
      used: (a, n) => sales.readContract({ address: usdcAddr(), abi: USDC_ABI, functionName: "authorizationState", args: [a, n] }),
      find: (a, n, to, value) => findSettlement(a, n, to, value),
      sign: (id, p: PaymentPayload) => signSales(this.vault.account(id), p.accepted.asset, settlementData(p)),
      broadcast: broadcastSales,
      state: (id, hash, nonce, ms) => salesTxState(from(id), hash, nonce, ms),
      refused: refusedByNode,
      // settling itself costs the company gas on Base: without it, nothing is sent
      gas: async (id) => (await sales.getBalance({ address: from(id) }).catch(() => 0n)) >= 20_000_000_000_000n,
    }, (x) => this.#bookSale(x), undefined, undefined, this.facilitator && {
      facilitator: this.facilitator,
      onFallback: (op, e) => {
        console.error(`x402: ${e.message}; the company settles itself`);
        void this.alert(`⚠️ The CDP facilitator did not answer a ${op} (${e.status ? `HTTP ${e.status}` : "no answer"}): companies are settling payments themselves, which costs them gas and lists nothing in the Bazaar.`, "cdp-fallback");
      },
      onBazaar: (status, reason, productId) => {
        if (status !== "rejected") return;
        console.error(`x402: the CDP Bazaar rejected product ${productId}${reason ? ` (${reason})` : ""}`);
        void this.alert(`⚠️ The CDP Bazaar did not list product ${productId}${reason ? `: ${reason}` : ""}. The sale itself went through.`, `bazaar-${productId}`);
      },
    });
    this.sim = new SimDeliveries(config.publicUrl, this.llm, config.model, (input) => {
      const id = typeof input === "object" && input ? this.#inputOwner.get(input) : undefined;
      return id ? this.store.companies.get(id) : undefined;
    }, `${config.dataDir}/sim-files`);
    this.files = new ProductFiles(config.dataDir, this.vault.material, this.llm, config.model, config.publicUrl);
    this.studio = new Studio({
      files: this.files,
      // the company's own paid brain designs it when it has one; the free model otherwise
      mind: async (c) => (this.#brain ? await this.#brain(c).catch(() => null) : null) ?? (this.llm ? { llm: this.llm, model: config.model } : null),
      finish: (c, t, r) => { finishStudio(c, t, this.#deps(c), r); this.store.markDirty(); },
    });
    if (config.mode === "live" && config.ceoModel && config.salesChainId === 8453) {
      this.#brain = companyBrain({
        url: config.aiGateway, model: config.ceoModel, chainId: config.salesChainId, usdc: usdcAddr(), ledger: this.ledger, live: true,
        account: (x) => this.vault.account(x.id),
        spendable: async (x) => (await this.b2b.usdc(x)) - marketReserved(x),
      });
    }
    this.b2b = new MarketDesk({
      mode: config.mode,
      chainId: config.salesChainId,
      ledger: this.ledger,
      companies: () => this.store.companies.values(),
      files: this.files,
      account: (id) => this.vault.account(id),
      chainUsdc: (c) => sales.readContract({ address: usdcAddr(), abi: erc20Abi, functionName: "balanceOf", args: [c.wallet] }),
      settle: async (seller, productId, payment, tag) => {
        const a = payment.payload.authorization;
        const product = seller.products.find((x) => x.id === productId);
        // the same terms, resource and discovery metadata as the product's own 402 challenge
        const offer = product ? offerFor(seller, product, this.files.read(seller, product)) : undefined;
        try {
          return await this.settleInTurn(seller.id, () => this.checkout.settle(seller.id, seller.wallet, productId, payment, tag, offer));
        } catch (e) {
          // the seller would pay the settlement gas on Base, as for any buyer: without it nothing is sent
          if (e instanceof NoGasError) throw new Error(`${seller.name} cannot take payments right now (no ETH on Base for the settlement gas); nothing was charged`);
          // sent, or maybe sent: follow it instead of paying again
          if (e instanceof PendingError || this.checkout.recordOf(a.from, a.nonce)) throw Object.assign(new Error((e as Error).message), { pending: saleKey(a.from, a.nonce) });
          throw e;
        }
      },
      sold: (seller, line) => {
        note(seller, this.#deps(seller), "sale", `${line.sim ? "[sim] " : ""}B2B: sold ${line.product} for $${fromUsdc(line.usdc).toFixed(2)} to ${line.with.name}, another NIGHTSHIFT company. Counted apart from sales to people and agents.`);
        if (!line.sim) void this.alert(`🤝 B2B: ${seller.name} sold ${line.product} for $${fromUsdc(line.usdc).toFixed(2)} to ${line.with.name}${line.tx ? ` · tx ${line.tx}` : ""}`, `b2b-${line.ledgerId}`);
        this.#emit(seller.id, "sale", { productId: line.productId, amount: line.usdc.toString(), sim: line.sim, b2b: true });
      },
      sourcesDir: join(config.dataDir, "sources"),
    });
    this.#simPlane = new SimImdPlane({ jobMs: config.simJobSeconds * 1000, deliver: (j, a, i) => this.sim.deliver(j, a, i) });
    // the platforms' own hosts are fetched as they are; hosts an owner or an API names go through safeFetch (public addresses only)
    const http: Http = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) } as RequestInit);
    const open: Http = async (url, init) => {
      const r = await safeFetch(url, { ...init, signal: AbortSignal.timeout(60_000) } as RequestInit);
      if (!r) throw new Error("That address cannot be reached from here (only public https servers).");
      return r;
    };
    this.connect = new Connect({
      vault: this.vault, ledger: this.ledger, http, open,
      sim: () => config.mode === "sim",
      publicUrl: () => config.publicUrl,
      gumroadApp: () => (config.gumroad.clientId && config.gumroad.clientSecret ? { id: config.gumroad.clientId, secret: config.gumroad.clientSecret } : null),
      telegram: () => (config.telegramToken ? { token: config.telegramToken, bot: config.telegramBotName } : null),
      platformChats: () => [config.telegramCommunity, ...config.telegramChat.split(","), ...config.launchNotify.split(","), config.telegramUrl.replace(/^https?:\/\/t\.me\//, "@")],
      files: this.files,
      metrics: (c) => this.store.metricsOf(c.id),
      market: () => this.market(),
      note: (c, kind, text) => note(c, this.#deps(c), kind, text),
      changed: (c) => this.#emit(c.id, "company", null),
    });
  }

  async start(): Promise<void> {
    await this.store.load();
    this.#recover();
    if (config.mode === "live") await this.#retireSim();
    setInterval(() => void this.#tick().catch((e) => console.error("tick", e)), 4000);
    setInterval(() => void this.store.flush().catch(() => {}), 3000);
    // Transfers and settlements whose answer never came: booked when they land, after a restart too.
    if (config.mode === "live") {
      const follow = async () => {
        await this.checkout.resolve().catch((e) => console.error("settlements", e));
        for (const id of new Set([...this.store.payouts.values()].map((l) => l.companyId))) await this.payouts.resolve(id).catch((e) => console.error("payouts", e));
        // a platform fee left owed by a failed fee transfer is paid without waiting for the next withdrawal
        for (const c of this.store.companies.values()) {
          if (c.sim || this.#withdrawing.has(c.id) || !(await this.payouts.feesOwed(c.id)) || this.payouts.pendingOf(c.id).length) continue;
          this.#withdrawing.add(c.id);
          const r = await this.payouts.payFees(c.id, { dev: config.platformDev, treasury: config.platformTreasury }).catch((e: Error) => ({ txs: [], error: e.message })).finally(() => this.#withdrawing.delete(c.id));
          if (r.error) console.error("fees", c.id, r.error);
        }
      };
      void follow();
      setInterval(() => void follow(), 60_000);
    }
    void this.alert(`Engine started in ${config.mode.toUpperCase()} mode · ${config.publicUrl}`, "start");
    if (config.telegramToken && config.moderation) void this.#guardRights();
    if (config.telegramToken) {
      telegramCommands(config.telegramToken, config.telegramAdmins, {
        admin: (cmd, args, ctx) => this.#command(cmd, args, ctx),
        open: (cmd, args) => (cmd === "ask" || cmd === "mind" ? this.#askSwarm(args) : cmd === "weather" ? this.#weatherReply() : cmd === "brief" ? this.#briefReply(args) : publicCommand(cmd, args)),
        guard: async (m) => { const removed = await this.#guard(m); if (!removed) void this.#ask(m).catch(() => {}); return removed; },
        ask: (m) => this.#ask(m),
        // Raids are off: a shared X post is not reposted to the community.
        adminText: async () => null,
        joined: (chat, names) => { const w = welcome(names); void sendCard(chat, "welcome", w.text, w.buttons); },
        // /start nw_<code>: a Night Watcher holder entering the Watch Room; any other code links company alerts
        link: (chat, code) => (code.startsWith("nw_") ? roomLink(chat, code) : this.#linkAlerts(chat, code)),
        // the games: /play /live /profile /challenge and "@bot chess", each a link to the website
        games: (cmd, args, ctx) => this.gameBot.command(cmd, args, ctx),
        inline: (q) => this.gameBot.inline(q),
      });
      startCommunity();
      setInterval(() => void sweepRoom().catch((e) => console.error("watch room", e)), 3_600_000);
    }
    if (this.sniper) {
      const sniper = this.sniper;
      setTimeout(() => void sniper.tick().catch((e) => console.error("sniper", e)), 20_000);
      setInterval(() => void sniper.tick().catch((e) => console.error("sniper", e)), 60_000);
    }
    if (this.mind) {
      const mind = this.mind;
      setTimeout(() => void mind.tick().catch((e) => console.error("swarm mind", e)), 35_000);
      setInterval(() => void mind.tick().catch((e) => console.error("swarm mind", e)), 60_000);
    }
    if (this.weather && config.telegramToken && config.mode === "live" && process.env.SWARM_WEATHER !== "0") {
      setInterval(() => void this.#postWeather().catch((e) => console.error("swarm weather", e)), 10 * 60_000);
    }
    if (this.dex) {
      const dex = this.dex;
      setTimeout(() => void dex.tick().catch((e) => console.error("dex", e)), 50_000);
      setInterval(() => void dex.tick().catch((e) => console.error("dex", e)), 60_000);
    }
    // The daily digest of what the live companies did, from their records and the ledger (sim mode: a dry-run log only).
    startDigest(() => this.store.companies.values(), () => this.ledger.store.list(""));
    // Mondays 09:00 UTC: last week's changelog entries to the community chat, pinned (sim mode: a dry-run log only).
    startChangelog();
    setInterval(() => void this.#followTokenLaunch(), 60_000);
    // After launch: the keeper splits fees and burns IMD every 2 hours (01:00, 03:00 … UTC); the frog list is built on Mondays.
    let kept = "", built = "";
    setInterval(() => {
      const l = launchState();
      if (!l?.open || !l.contracts?.splitter) return;
      const d = new Date(), day = d.toISOString().slice(0, 10);
      const slot = `${day}-${d.getUTCHours()}`;
      if (d.getUTCHours() % 2 === 1 && kept !== slot) { kept = slot; void this.keeperRun(); }
      if (d.getUTCDay() === 1 && d.getUTCHours() === 0 && built !== day) { built = day; void this.frogEpoch(); }
    }, 60_000);
    // The keeper also relays staked-game payouts: its balance is read every hour, and the admins told once a day when it runs low.
    if (config.mode === "live") { const gas = () => void this.#keeperGas().catch((e) => console.error("keeper gas", e)); setTimeout(gas, 90_000); setInterval(gas, 3_600_000); }
    setInterval(() => void houseTick().catch((e) => console.error("house", e)), 60_000);
    // The Night League: market reads, Monday seasons and the house agents, every five minutes.
    startLeague();
    // Work bought from IMD with the operator's wallet (e.g. the NFT collection): every stage to Telegram.
    setInterval(() => void followOrders().then((changed) => {
      for (const o of changed) {
        const lines = [`🛠 ${o.title}: ${o.stage}`, ...(o.addresses ?? []).map((a) => `${a.name ?? a.role}: ${a.address}`), ...(o.repoUrl ? [o.repoUrl] : [])];
        void this.alert(lines.join("\n"), `order-${o.tx}-${o.stage}`);
        // The NFT collection is live: switch its page, perks and mint alerts on.
        const frogs = o.id === "night-frogs" && o.done && !o.error ? o.addresses?.find((a) => /nightfrogs/i.test(`${a.name ?? ""}`)) ?? o.addresses?.find((a) => a.role === "token") : undefined;
        if (frogs && !config.nft.address) {
          writeSettings({ NFT_ADDRESS: frogs.address });
          config.nft.address = frogs.address as `0x${string}`;
          void toCommunity(`🐸🌙 <b>NIGHT FROGS ARE LIVE</b>\n\n500 fully onchain frogs, built by the IMD swarm.\nMint only in IMD: 2 IMD each, <b>half of it burned forever</b>.\n\n<code>${frogs.address}</code>`, [[{ text: "🐸 Mint a frog", url: `${config.publicUrl}/frogs` }]], "frog");
          housePost(`🐸 NIGHT FROGS are live: 500 fully onchain frogs built by the IMD swarm. Mint only in IMD, 2 IMD each, half burned forever. ${config.publicUrl}/frogs`, "frogs-live");
        }
      }
    }).catch((e) => console.error("orders", e)), 60_000);
    // Soft staking: credit shift hours every hour; the week's top holders on Sunday 18:00 UTC.
    setInterval(() => void accrueStaking().catch((e) => console.error("staking", e)), 3_600_000);
    void accrueStaking().catch(() => {});
    // The Night Watch: the imdUSD book every minute, the seats' jobs, and each seat's liquidation to the community.
    startNightWatch((row, seat) => {
      if (!seat) return;
      const debt = Number(row.debtRepaid) / 1e18;
      void toCommunity(`🌙🛡 <b>NIGHT WATCH · liquidation</b>

Night Watcher #${seat.watcher} repaid ${debt.toLocaleString("en-US", { maximumFractionDigits: 0 })} imdUSD of an unsafe loan and kept a $${row.bonusUsd.toFixed(2)} bonus. A tenth of it goes to $SHIFT stakers, frog holders and the IMD burn.`, [[{ text: "🛡 The Night Watch", url: `${config.publicUrl}/watch` }], [{ text: "Transaction", url: `https://etherscan.io/tx/${row.tx}` }]], "milestone");
    });
    let boardWeek = "";
    setInterval(() => {
      const d = new Date();
      const week = `${d.getUTCFullYear()}-${Math.floor(d.getTime() / 604_800_000)}`;
      if (!frogsOn() || d.getUTCDay() !== 0 || d.getUTCHours() !== 18 || boardWeek === week) return;
      boardWeek = week;
      const top = stakingBoard(5);
      if (!top.length) return;
      const medal = ["🥇", "🥈", "🥉", "4.", "5."];
      void toCommunity(`🐸⏱ <b>NIGHT SHIFT HOURS · top of the crew</b>\n\n${top.map((t, i) => `${medal[i]} <a href="https://etherscan.io/address/${t.wallet}">${t.wallet.slice(0, 6)}…${t.wallet.slice(-4)}</a> · ${t.hours.toLocaleString("en-US")} h · ${t.frogs} frog${t.frogs === 1 ? "" : "s"}`).join("\n")}\n\nHold a frog, earn hours. Genesis 2×, Night Watchers 10× to 40×, #1 50×. No locking, no gas.`, [[{ text: "⏱ My shift hours", url: `${config.publicUrl}/frogs#staking` }]], "frog");
    }, 60_000);
    // Duels to the community: every staked challenge (listed, on, won), and free PvP or agent games now and then.
    gameLobby(this.vault).escrow.onEvent((kind, c) => void duelCard(kind, c).then((card) => card && toCommunity(card.text, card.buttons, kind === "settled" ? "milestone" : "launch")).catch((e) => console.error("duel card", e)));
    // Live betting: big bets and settled pools (nothing runs while BETPOOL_ADDRESS is empty).
    liveBets(this.vault).onEvent((e) => void betCard(e).then((card) => card && toCommunity(card.text, card.buttons, e.kind === "settled" ? "milestone" : "launch")).catch((err) => console.error("bet card", err)));
    const seenDuels = new Set<string>();
    let primed = false, lastFree = 0, lastAgent = 0;
    setInterval(() => {
      // the house exhibition is the server playing itself: never a duel card
      const games = liveGames().filter((g) => g.players.length === 2 && g.stake.currency === "FREE" && !g.house);
      for (const g of games) {
        if (seenDuels.has(g.id)) continue;
        seenDuels.add(g.id);
        if (!primed) continue;
        const agent = g.players.some((p) => p.agent), now = Date.now();
        if (now - (agent ? lastAgent : lastFree) < 20 * 60_000) continue;
        if (agent) lastAgent = now; else lastFree = now;
        const card = freeDuelCard(g);
        void toCommunity(card.text, card.buttons, "launch").catch((e) => console.error("free duel card", e));
      }
      primed = true;
      if (seenDuels.size > 2000) seenDuels.clear();
    }, 30_000);
    // The moment real-money duels open (the escrow's signer becomes our game signer), tell the community once.
    setInterval(() => void (async () => {
      const flag = join(config.dataDir, "stakes-announced");
      if (existsSync(flag)) return;
      const chain = await gameLobby(this.vault).escrow.chainState(true).catch(() => null);
      if (!chain?.live) return;
      writeFileSync(flag, new Date().toISOString());
      const E = "0xf460fd9ad76f18414f54a2431870e8a116193489";
      await toCommunity([
        "💎🎮 <b>REAL-MONEY DUELS ARE OPEN</b>", "",
        "Space Pinball and NIGHT CHESS can now be played for <b>IMD</b> or <b>$SHIFT</b>, and you choose the amount:",
        "• IMD from 0.5 to 1,000 · $SHIFT from 10,000 to 50,000,000",
        "• Create a challenge with your stake; anyone can accept the exact same amount",
        "• Both stakes sit in the GameEscrow contract, built, tested and audited by the IMD swarm. Nobody can take them, NIGHTSHIFT included",
        "• The winner gets 95% of the pot automatically; 5% follows the fee rule: stakers and NIGHT FROGS holders, dev, treasury and burns",
        "• Every score and every chess move is verified by the server; a draw refunds both; a match that never settles refunds after 24 h", "",
        `📜 Contract: <code>${E}</code>`, "",
        "Skill games for adults (18+), only where playing for stakes is legal. Never stake what you can't afford to lose.",
      ].join("\n"), [[{ text: "🎱 Space Pinball", url: `${config.publicUrl}/games/pinball` }, { text: "♟ NIGHT CHESS", url: `${config.publicUrl}/games/chess` }], [{ text: "🔎 GameEscrow on Etherscan", url: `https://etherscan.io/address/${E}` }]], "launch");
      void this.adminCard("💎 <b>Real-money duels are live</b>: the escrow's signer is now the server's game signer. Announced to the community.", [], "stakes-live", "launch");
    })().catch((e) => console.error("stakes announce", e)), 120_000);
    // Swarm orders from /setup: announced to the community when the swarm finishes them.
    followForges();
    startGuard((text, topic) => this.alert(text, topic));
    followHackathon((text, topic) => this.alert(text, topic));
    followJudging((html) => toCommunity(html, [[{ text: "🏆 The hackathon", url: "https://www.imdradar.site/hackathon" }]], "milestone"), (text, topic) => this.alert(text, topic));
    followSwarm((text, buttons) => toCommunity(text, buttons, "milestone"), (text) => Promise.all(config.telegramChat.split(",").map((id) => id.trim()).filter(Boolean).map((id) => sendCard(id, "alert", text))));
    // Space Pinball in the community chat: records and crushing wins at once, the rest in a half-hourly report.
    const play = `${config.publicUrl}/games/pinball`;
    const pick = <T,>(l: T[]) => l[Math.floor(Math.random() * l.length)]!;
    const n = (x: number) => x.toLocaleString("en-US");
    let posts: number[] = [];
    const room = () => { posts = posts.filter((t) => Date.now() - t < 3_600_000); return posts.length < 6; };
    const arcadePost = (text: string, kind: Anim = "post") => { if (!room()) return; posts.push(Date.now()); void toCommunity(text, [[{ text: "🎱 Play Space Pinball", url: play }]], kind); };
    const half = { games: 0, duels: 0, solos: 0, best: null as { name: string; score: number } | null, duel: null as { w: string; l: string; ws: number; ls: number } | null };
    onArcade((e: ArcadeEvent) => {
      half.games++;
      if (e.kind === "duel") {
        half.duels++;
        const [w, l] = e.a.score >= e.b.score ? [e.a, e.b] : [e.b, e.a];
        if (!half.best || w.score > half.best.score) half.best = { name: w.name, score: w.score };
        if (!e.draw && (!half.duel || w.score - l.score > half.duel.ws - half.duel.ls)) half.duel = { w: w.name, l: l.name, ws: w.score, ls: l.score };
        if (e.record) arcadePost(`🏆🎱 <b>NEW ALL-TIME DUEL RECORD</b>\n\n<b>${esc(w.name)}</b> just put up <b>${n(w.score)}</b> against ${esc(l.name)} (${n(l.score)}).\n${pick(["The table is still smoking.", "Somebody check the flippers for steroids.", "The black hole asked for a day off."])}\n\nVerified by replay. Think you can beat it?`, "milestone");
        else if (e.tonightTop) arcadePost(`🌙🎱 <b>NEW #1 TONIGHT</b>\n\n<b>${esc(w.name)}</b> takes the top of tonight's duel board with <b>${n(w.score)}</b>, beating ${esc(l.name)}.\n${pick(["The night shift has a new boss.", "Clock in and take it back.", "Who's next?"])}`);
        else if (!e.draw && l.score > 0 && w.score >= l.score * 3 && w.score >= 30_000) arcadePost(`💥🎱 <b>FLAWLESS NIGHT</b>\n\n<b>${esc(w.name)}</b> ${pick(["sent", "launched", "dropped"])} ${esc(l.name)} into the black hole: <b>${n(w.score)}</b> to ${n(l.score)}.\n${pick(["Meteors were involved.", "That was not a duel, that was a lesson.", "Gravity surge, then silence."])}`);
        else if (e.draw) arcadePost(`⚖️🎱 <b>A PERFECT DRAW</b>\n\n${esc(e.a.name)} and ${esc(e.b.name)} both finished on <b>${n(e.a.score)}</b>. Same table, same seed, same score. Rematch?`);
      } else {
        half.solos++;
        if (!half.best || e.run.score > half.best.score) half.best = { name: e.run.name, score: e.run.score };
        if (e.record) arcadePost(`🏆🌙 <b>NEW ALL-TIME SOLO RECORD</b>\n\n<b>${esc(e.run.name)}</b> scored <b>${n(e.run.score)}</b> alone at 3 AM.\n${pick(["No rival needed.", "The frogs are taking notes.", "Verified by replay, every flip."])}`, "milestone");
        else if (e.tonightTop) arcadePost(`🌙 <b>NEW #1 ON TONIGHT'S SOLO BOARD</b>\n\n<b>${esc(e.run.name)}</b> with <b>${n(e.run.score)}</b>. ${pick(["Beat it before sunrise.", "The board is open.", "Your move, night crew."])}`);
      }
    });
    // NIGHT CHESS: a checkmate in a real game (20+ half-moves) is worth telling the night crew about.
    onChess((e: ChessEvent) => {
      if (e.reason !== "checkmate" || e.moves < 20 || !e.winner || !room()) return;
      const loser = e.winner === e.white ? e.black : e.white;
      posts.push(Date.now());
      void toCommunity(`♟🌙 <b>CHECKMATE</b>

<b>${esc(e.winner)}</b> mated ${esc(loser)} in ${Math.ceil(e.moves / 2)} moves (${e.tc}).
${pick(["The night shift has a new grandmaster.", "Clean. Quiet. Final.", "Somebody check the clocks."])}`, [[{ text: "♟ Play NIGHT CHESS", url: `${config.publicUrl}/games/chess` }]], "post");
    });
    setInterval(() => {
      if (!half.games) return;
      const lines = [`🎱 <b>ARCADE REPORT · the last 30 minutes</b>`, "", `🕹 ${half.games} game${half.games > 1 ? "s" : ""} verified · ${half.duels} duel${half.duels === 1 ? "" : "s"} · ${half.solos} solo`];
      if (half.best) lines.push(`🥇 Best score: <b>${esc(half.best.name)}</b> · ${n(half.best.score)}`);
      if (half.duel) lines.push(`⚔️ Duel of the half hour: <b>${esc(half.duel.w)}</b> beat ${esc(half.duel.l)} ${n(half.duel.ws)} to ${n(half.duel.ls)}`);
      lines.push("", pick(["Same table, same seed. Bring a friend.", "Free to play. The board resets every night.", "Practice counts too: the solo board is live."]));
      arcadePost(lines.join("\n"));
      Object.assign(half, { games: 0, duels: 0, solos: 0, best: null, duel: null });
    }, 30 * 60_000);
    // Frogs sold on OpenSea (read from Seaport on chain) and, with an OpenSea key, new listings.
    const who = (a: string) => `<a href="https://etherscan.io/address/${a}">${a.slice(0, 6)}…${a.slice(-4)}</a>`;
    const frogUrl = (id: number) => `https://opensea.io/assets/ethereum/${config.nft.address || "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c"}/${id}`;
    setInterval(() => void newFrogSales().then(async (sales) => {
      for (const s of sales) {
        const usd = s.eth * ((await marketSnapshot().catch(() => null))?.ethUsd ?? 0);
        const caption = await frogCaption({ kind: "sold", id: s.id, eth: s.eth, usd, buyer: s.buyer, seller: s.seller, tx: s.tx }, who);
        await frogPost(s.id, caption, [[{ text: `🌊 #${s.id} on OpenSea`, url: frogUrl(s.id) }, { text: "🐸 Collection", url: `https://opensea.io/collection/${OPENSEA_SLUG}` }]], "frog");
      }
    }).catch((e) => console.error("frog sales", e)), 60_000);
    setInterval(() => void newFrogListings().then(async (list) => {
      for (const x of list) {
        const caption = await frogCaption({ kind: "listed", id: x.id, eth: x.eth, seller: x.seller }, who);
        await frogPost(x.id, caption, [[{ text: `🌊 Buy #${x.id} on OpenSea`, url: x.url }, { text: "🐸 Collection", url: `https://opensea.io/collection/${OPENSEA_SLUG}` }]], "frog");
      }
    }).catch((e) => console.error("frog listings", e)), 120_000);
    // every frog's traits, once, so sale cards can show a rarity rank
    void fillTraits().catch((e) => console.error("frog traits", e));
    // Every frog minted, to the community chat.
    setInterval(() => void newMints().then(async (mints) => {
      for (const m of mints) {
        const last = m.first + m.quantity - 1;
        const left = Math.max(0, 500 - last);
        const ids = m.quantity > 1 ? `#${m.first}–#${last}` : `#${m.first}`;
        const genesis = m.first <= 77 ? " · <b>GENESIS</b>" : "";
        await toCommunity(`🐸 <b>NIGHT FROG${m.quantity > 1 ? "S" : ""} MINTED</b> ${ids}${genesis}\n\n👤 <a href="https://etherscan.io/address/${m.payer}">${m.payer.slice(0, 6)}…${m.payer.slice(-4)}</a>\n💵 ${m.paid.toFixed(2)} IMD · 🔥 ${(m.paid / 2).toFixed(2)} IMD burned\n🌙 <b>${last}/500</b> · ${left ? `${left} until the reveal` : "SOLD OUT"}\n\n<a href="https://etherscan.io/tx/${m.tx}">TX</a>`, [[{ text: "🐸 Mint yours", url: `${config.publicUrl}/frogs` }]], "frog");
        // the countdown: every 50 frogs, and the sellout
        const step = Math.floor(last / 50) * 50;
        if (step > 0 && step > milestoneSeen()) {
          setMilestone(step);
          await toCommunity(step >= 500
            ? `🌙🐸 <b>SOLD OUT · ALL 500 NIGHT FROGS ARE MINTED</b>\n\nThe night shift is complete. The reveal is next: one Chainlink VRF draw gives every frog its traits at once. Nobody can pick or reroll them.\n\nStay close, the crew wakes up soon.`
            : `🌙 <b>${step}/500 NIGHT FROGS MINTED</b>\n\n<b>${500 - step} frogs until the reveal.</b>\nWhen the 500th frog is minted, one Chainlink VRF draw wakes the whole crew at once: every frog gets its traits, nobody can pick or reroll them.\n\n🔥 ${step} IMD burned so far.`, [[{ text: "🐸 Mint before the reveal", url: `${config.publicUrl}/frogs` }]], "frog");
        }
      }
    }).catch((e) => console.error("frogs", e)), 30_000);
    // The reveal itself: announce once, when the contract reads revealed.
    setInterval(() => void frogStats().then(async (s) => {
      if (!s?.revealed || revealAnnounced()) return;
      markRevealAnnounced();
      await toCommunity(`🌅🐸 <b>THE NIGHT SHIFT HAS WOKEN UP</b>\n\nAll 500 NIGHT FROGS are revealed. Chainlink drew the randomness, every frog now has its traits, fully onchain.\n\nCheck yours in your wallet or on OpenSea. Who got the crown? 👑`, [[{ text: "🐸 See the crew", url: `${config.publicUrl}/frogs` }]], "frog");
      housePost(`🌅 All 500 NIGHT FROGS are revealed: one Chainlink VRF draw gave every frog its traits, fully onchain. ${config.publicUrl}/frogs`, "frogs-revealed");
    }).catch(() => {}), 60_000);
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
  async #command(cmd: string, args: string[], ctx?: CommandContext): Promise<Reply> {
    if (cmd === "unmute" || cmd === "mute") return this.#muteCommand(cmd, args, ctx);
    // sent by an operator inside the private holders' group: that group becomes the Watch Room
    if (cmd === "watchroom") {
      if (!ctx?.group) return { text: "Send /watchroom inside the private Night Watchers group, after adding me there as an admin." };
      const community = config.telegramCommunity;
      if (ctx.chat === community || (community.startsWith("@") && ctx.chat === String(await tgCall<{ id: number }>(config.telegramToken, "getChat", { chat_id: community }).then((c) => c?.id ?? "").catch(() => "")))) return { text: "⚠️ This is the public community chat, not a private group." };
      const me = await tgCall<{ status: string; can_invite_users?: boolean; can_restrict_members?: boolean }>(config.telegramToken, "getChatMember", { chat_id: ctx.chat, user_id: Number(config.telegramToken.split(":")[0]) }).catch(() => null);
      if (me?.status !== "administrator" || !me.can_invite_users || !me.can_restrict_members) return { text: "⚠️ Make me an admin of this group with the rights <b>Invite users via link</b> and <b>Ban users</b>, then send /watchroom again." };
      writeSettings({ WATCH_ROOM_CHAT: ctx.chat });
      config.forge.room = ctx.chat;
      return { text: "✅ <b>This group is now the Watch Room.</b>\nNight Watcher holders get a one-time invite from the Forge page, and wallets that stop holding one are removed." };
    }
    if (cmd === "live") {
      const s = liveStats();
      return { text: `👀 <b>On getnightshift.tech now</b>\n${s.visitors1m} in the last minute · ${s.visitors5m} in the last 5 minutes\n${s.openPages} pages open live\n\n<i>Counted since the last restart; nothing about visitors is stored.</i>` };
    }
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
    if (cmd === "raid") return { text: "Raids are turned off.", buttons: back };
    if (cmd === "post") {
      const text = args.join(" ").trim();
      if (!text) return { text: "Usage: /post &lt;text&gt;\nPosts on the project's Bluesky now; the community chat hears about it by itself.", buttons: back };
      return { text: `🦋 Posted: ${esc(await houseNow(text))}`, buttons: back };
    }
    if (cmd === "bluesky") {
      const h = houseStatus();
      return { text: `🦋 <b>Bluesky</b> @${esc(h.handle)}\n${h.on ? "🟢 connected" : "⚪ no app password"} · ${h.today} posts today · ${h.queued} queued${h.last ? `\nLast: ${esc(h.last.url)}` : ""}`, buttons: back };
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
    // between companies, counted apart: never added to the sales above
    const b2b = all.flatMap((c) => (c.b2b?.sold ?? []).filter((l) => l.at >= since));
    const b2bUsd = b2b.reduce((a, l) => a + fromUsdc(l.usdc), 0);
    const shipped = all.flatMap((c) => c.journal.filter((j) => j.at >= since && j.kind === "result").map((j) => `• ${esc(c.name)}: ${esc(j.text.replace(/^\[sim\] /, "").slice(0, 120))}`)).slice(0, 8);
    const warnings = all.reduce((a, c) => a + c.journal.filter((j) => j.at >= since && j.kind === "warning").length, 0);
    return [
      `📰 <b>Last 24 hours</b>${config.mode === "sim" ? " <i>(simulation)</i>" : ""}`, "",
      `💰 ${sales} sale${sales === 1 ? "" : "s"} · $${revenue.toFixed(2)}`,
      ...(b2b.length ? [`🤝 ${b2b.length} B2B sale${b2b.length === 1 ? "" : "s"} between companies · $${b2bUsd.toFixed(2)} (counted apart)`] : []),
      `🏢 ${all.length} companies`,
      `⚠️ ${warnings} warning${warnings === 1 ? "" : "s"}`, "",
      shipped.length ? `<b>Shipped</b>\n${shipped.join("\n")}` : "Nothing shipped.",
    ].join("\n");
  }

  /** While the platform token is being launched through IMD, follow it and switch it on when live. */
  async #followTokenLaunch(): Promise<void> {
    const before = launchState();
    if (!before || before.announced || before.error) return;
    const buyUrl = (t: string) => `https://app.uniswap.org/swap?chain=mainnet&inputCurrency=NATIVE&outputCurrency=${t}`;
    if (!before.done) {
      const l = await followLaunch();
      if (l && l.stage !== before.stage) void this.alert(`🪙 ${l.symbol} launch: ${l.stage}`, `launch-${l.stage}`);
      // Deployed: check it against what we asked for, privately, before anyone can buy.
      if (l?.done && l.contracts) {
        Object.assign(l, (await completeContracts()) ?? {});
        const pool = l.contracts.hook ? await findPool(eth, l.contracts.token as `0x${string}`, l.contracts.hook as `0x${string}`).catch(() => null) : null;
        if (pool) patchLaunch({ pool });
        const checks = await verifyShift(l.contracts).catch((e) => [{ label: "Verification could not run", ok: false, detail: (e as Error).message }]);
        saveVerification(checks);
        const ok = checks.every((c) => c.ok);
        const card = this.launchReadyCard(l, checks);
        void this.adminCard(card.html, card.buttons, "launch-verified", ok ? "launch" : "alert");
        const t = l.token ?? "";
        void this.launchDm(ok
          ? `🚀 <b>$${esc(l.symbol)} is deployed and checked.</b> Waiting for the treasury buy.\n\nCA: <code>${esc(t)}</code>\n\nTrading is closed to everyone except the treasury <b>0x3322…4D69</b>. Buy from that wallet, any amount: the moment it lands, trading opens.`
          : `❌ <b>$${esc(l.symbol)} is deployed, but a check failed. Do NOT buy.</b>\n\nCA: <code>${esc(t)}</code>\n\nThe admins were told what is wrong.`,
          ok ? [[{ text: "🌙 First buy on NIGHTSHIFT (treasury wallet)", url: `${config.publicUrl}/swap` }], [{ text: "🦄 Uniswap", url: buyUrl(t) }, { text: "📊 Etherscan", url: `https://etherscan.io/token/${t}` }]] : [[{ text: "📊 Etherscan", url: `https://etherscan.io/token/${t}` }]]);
      }
      return;
    }
    // Deployed and checked: wait for the treasury's first buy.
    if (before.contracts?.hook && (!before.contracts.splitter || !before.contracts.rewards)) await completeContracts();
    if (!before.open) {
      const l = await followOpen();
      if (!l?.open || !l.token) return;
      // 1. At once: the site and bot switch to the token, the first buyer gets the CA, the other networks are told.
      writeSettings({ TOKEN_ADDRESS: l.token, TOKEN_SYMBOL: l.symbol, TOKEN_BUY_URL: buyUrl(l.token) });
      Object.assign(config.token, { address: l.token as `0x${string}`, symbol: l.symbol, buyUrl: buyUrl(l.token) });
      const publicAt = Date.now() + 5 * 60_000;
      patchLaunch({ publicAt });
      void this.launchDm(`✅ <b>The treasury buy landed. $${esc(l.symbol)} is open to everyone.</b>\n\nCA: <code>${l.token}</code>\n\nThe main group is told in 5 minutes.`,
        [[{ text: `🌙 Buy on NIGHTSHIFT`, url: `${config.publicUrl}/swap` }, { text: "🦄 Uniswap", url: buyUrl(l.token) }], [{ text: "🧾 First buy", url: `https://etherscan.io/tx/${l.openTx}` }, { text: "📊 Etherscan", url: `https://etherscan.io/token/${l.token}` }]]);
      housePost(`🚀 $${l.symbol} is live on Ethereum.\n\n${l.token}\n\nEvery sell feeds stakers, NIGHT FROGS holders and burns SHIFT and IMD. ${config.publicUrl}/token`, "token-live");
      void this.adminCard(`✅ <b>The first buy landed.</b> Site, bot and token page now use <code>${l.token}</code>; Bluesky was told. The main group is told at ${new Date(publicAt).toISOString().slice(11, 16)} UTC.`,
        [[{ text: "🧾 First buy", url: `https://etherscan.io/tx/${l.openTx}` }, { text: "🪙 Token page", url: `${config.publicUrl}/token` }]], "launch-open");
      return;
    }
    // 2. Five minutes after the first buy: the main group.
    if (before.announced || !before.token || Date.now() < (before.publicAt ?? 0)) return;
    patchLaunch({ announced: true });
    void toCommunity(`🚀🌙 <b>$${esc(before.symbol)} IS LIVE</b>

<code>${before.token}</code>

Trading is open to everyone on Ethereum, paired with ETH.
Every sell pays 5%: 40% to stakers and NIGHT FROGS holders, 20% burned (SHIFT and IMD).`, [[{ text: `🌙 Buy on NIGHTSHIFT`, url: `${config.publicUrl}/swap` }, { text: "🦄 Uniswap", url: buyUrl(before.token) }], [{ text: "📊 Chart", url: `https://dexscreener.com/ethereum/${before.token}` }, { text: "🪙 Token page", url: `${config.publicUrl}/token` }]], "launch");
    void this.adminCard(`🚀 <b>$${esc(before.symbol)} is public.</b> The main group was told.`, [[{ text: "🪙 Token page", url: `${config.publicUrl}/token` }]], "launch-live");
  }

  /** After a re-check before the first buy: the admins and the launch chat get the fresh result. */
  async relaunchCard(l: { symbol: string; token?: string; launchId?: string; contracts?: Record<string, string> }, checks: { label: string; ok: boolean; detail: string }[]): Promise<void> {
    const ok = checks.length > 0 && checks.every((c) => c.ok);
    const card = this.launchReadyCard(l, checks);
    this.#lastAlert.delete("launch-verified");
    await this.adminCard(`🔁 <b>Re-checked.</b>\n${card.html}`, card.buttons, "launch-verified", ok ? "launch" : "alert");
    const t = l.token ?? "";
    await this.launchDm(ok
      ? `🔁 <b>Re-checked: everything matches.</b> $${esc(l.symbol)} is deployed and safe to open. Waiting for the treasury buy.\n\nCA: <code>${esc(t)}</code>\n\nTrading is closed to everyone except the treasury <b>0x3322…4D69</b>.`
      : `🔁 <b>Re-checked: still not matching. Do NOT buy.</b>\n\nCA: <code>${esc(t)}</code>`,
      ok ? [[{ text: "🌙 First buy on NIGHTSHIFT (treasury wallet)", url: `${config.publicUrl}/swap` }], [{ text: "📊 Etherscan", url: `https://etherscan.io/token/${t}` }]] : [[{ text: "📊 Etherscan", url: `https://etherscan.io/token/${t}` }]]);
  }

  lastKeeper: KeeperRun | null = null;
  /** One keeper run, told to the admins (an operator's run burns at once; the scheduled one at a random moment). */
  async keeperRun(o: { burnDelayMs?: number } = {}): Promise<KeeperRun> {
    const l = launchState();
    let n = l?.launchNumber;
    if (!n && l?.launchId) {
      n = await fetch(`https://api.imd.fun/launches/${l.launchId}`, { signal: AbortSignal.timeout(15000) }).then((x) => x.json() as Promise<{ launchNumber?: number }>).then((d) => d.launchNumber).catch(() => undefined);
      if (n) patchLaunch({ launchNumber: n });
    }
    // $SHIFT and IMD in ETH, so the keeper weighs what a split or a fee moves against its gas
    const m = await marketSnapshot().catch(() => null);
    const prices = m?.ethUsd ? { shift: m.priceUsd / m.ethUsd, imd: config.imdUsd / m.ethUsd } : undefined;
    const r = await runKeeper(this.vault, l?.contracts ?? {}, { launchNumber: n, payer: DEV_WALLET }, { prices, ...o }).catch((e) => ({ at: Date.now(), did: [], skipped: [], error: (e as Error).message }));
    this.lastKeeper = r;
    if (r.error || r.did.length) void this.adminCard(`🧹 <b>Keeper run</b>\n${r.error ? `⚠️ ${esc(r.error)}` : ""}${r.did.map((x) => `✅ ${esc(x)}`).join("\n")}${r.skipped.length ? `\n${r.skipped.map((x) => `· ${esc(x)}`).join("\n")}` : ""}`, [[{ text: "⚙️ Setup", url: `${config.publicUrl}/setup` }]], `keeper-${r.at}`, r.error ? "alert" : "report");
    return r;
  }

  /** The keeper's balance, once an hour; under 0.004 ETH the admins hear it once a day, with how long it lasts. */
  async #keeperGas() {
    const a = keeperAccount(this.vault).address;
    const wei = await eth.getBalance({ address: a });
    sampleKeeper(wei);
    const note = keeperGasAlert(a, wei);
    if (!note) return;
    if (await this.adminCard(`⛽ <b>Keeper gas is low</b>
${esc(note)}`, [[{ text: "📊 Etherscan", url: `https://etherscan.io/address/${a}` }, { text: "⚙️ Setup", url: `${config.publicUrl}/setup` }]], "keeper-gas", "alert")) markGasAlert();
  }

  /** This week's NIGHT FROGS list; the dev wallet posts its root from /setup. */
  async frogEpoch() {
    const l = launchState();
    const e = await buildEpoch(l?.contracts ?? {}, l?.scanFrom ?? 0).catch((err) => { void this.alert(`Frog epoch failed: ${(err as Error).message}`, "frog-epoch"); return null; });
    if (e) void this.adminCard(`🐸 <b>NIGHT FROGS epoch ${e.epoch} is ready</b>\n${e.wallets} wallets · ${e.tokens.map((t) => `${(Number(t.total) / 1e18).toFixed(4)} ${t.symbol}`).join(" + ")}\n\nPost its root from the dev wallet so holders can claim.`, [[{ text: "⚙️ Post it in Setup", url: `${config.publicUrl}/setup` }]], `epoch-${e.epoch}`, "report");
    return e;
  }

  /** The guard needs the bot to be a group admin that may delete messages and restrict members. */
  async #guardRights(): Promise<void> {
    const token = config.telegramToken!;
    const me = await tgCall<{ id: number }>(token, "getMe", {});
    if (!me) return;
    for (const c of chats()) {
      const r = await tgCall<{ status: string; can_delete_messages?: boolean; can_restrict_members?: boolean }>(token, "getChatMember", { chat_id: c, user_id: me.id });
      const ok = r?.status === "creator" || (r?.status === "administrator" && r.can_delete_messages && r.can_restrict_members);
      if (!ok) void this.alert(`🛡 The guard cannot act in ${c}: make the bot an admin there with "Delete messages" and "Ban users" (now: ${r?.status ?? "unknown"}).`, `guard-rights-${c}`);
    }
  }

  #botName: string | null = null;
  /** A real question about the project, answered from live facts; anything else is left alone. */
  async #ask(m: GroupMessage): Promise<void> {
    if (!this.llm || !config.telegramToken || !config.assistant) return;
    const token = config.telegramToken;
    const ours = chats().map((c) => c.toLowerCase());
    if (!m.private && !ours.includes(m.chat) && !(m.chatUsername && ours.includes(`@${m.chatUsername.toLowerCase()}`))) return;
    if (this.#botName === null) this.#botName = (await tgCall<{ username: string }>(token, "getMe", {}))?.username?.toLowerCase() ?? "";
    const toBot = Boolean(m.private || m.replyToBot || (this.#botName && m.text.toLowerCase().includes(`@${this.#botName}`)));
    if (!worthAsking(m.text, toBot)) return;
    if (!allowed(m.user)) return;
    spend(m.user);
    const text = await answer(this.llm, config.model, m.text.replace(new RegExp(`@${this.#botName}`, "ig"), "").trim(), await this.#facts(), m.name.replace(/^@/, "")).catch(() => null);
    if (!text) return;
    await tgCall(token, "sendMessage", { chat_id: m.chat, text, reply_parameters: { message_id: m.messageId, allow_sending_without_reply: true }, disable_web_page_preview: true });
  }

  /** Everything the assistant may say, read live: token, market, burns, staking, rules, links. */
  async #facts(): Promise<Facts> {
    const l = launchState();
    const live = Boolean(config.token.address && l?.announced);
    const m = live ? await marketSnapshot().catch(() => null) : null;
    const burns = burnTotals();
    const companies = [...this.store.companies.values()].filter((c) => !c.sim);
    const frogs = await frogStats().catch(() => null);
    const watchers = await forgedAll().catch(() => []);
    const u = config.publicUrl;
    return {
      project: "NIGHTSHIFT: an autonomous AI company platform. You give a company an idea and a budget; an AI CEO picks the next move every shift, buys the work (products, sites, research) from the IMD swarm (imd.fun), paid in IMD, sells what ships for USDC on Base, and the owner withdraws the revenue.",
      token: live
        ? { symbol: "$SHIFT", status: "LIVE on Ethereum", contractAddress: config.token.address, buy: `${u}/swap (or Uniswap, paired with ETH)`, chart: `https://dexscreener.com/ethereum/${config.token.address}`, priceUsd: m?.priceUsd ?? null, marketCapUsd: m?.mcap ?? null, liquidityUsd: m?.liquidity ?? null }
        : { symbol: "$SHIFT", status: l ? "being launched through IMD right now, not trading yet" : "not launched yet, launch is coming soon (no date announced here)", network: "Ethereum mainnet, paired with ETH on Uniswap v4", howToBuyAfterLaunch: `with ETH on Ethereum, at ${u}/swap or on Uniswap, once the official CA is posted`, contractAddress: "not published yet: the only CA will be posted on getnightshift.tech, this Telegram and X after launch; anything earlier is fake" },
      supply: "1,000,000,000 fixed, 18 decimals. No mint, no pause, no blacklist. 88.89% (888.9M) seeded in the Uniswap v4 pool, 1.11% (11.1M) dev wallet (public), 10% (100M) to the IMD swarm. No presale, no private round, no unlock schedule.",
      launch: "Launched through IMD's swarm: built, tested twice and audited by 4 specialist agents and a judge, deployed by IMD on Ethereum. Not audited by an outside firm. The pool opened at a 10 ETH market cap. Launch was gated: only the treasury could make the first buy, against sniper bots. The treasury's first buy was 0.91 ETH for 81.49M SHIFT, paid into the pool like any buyer.",
      fees: "Buys pay only the 1.25% pool fee (1% to the launch payer, the dev wallet; 0.25% to the IMD network). Sells also pay 5% (2.5% in SHIFT, 2.5% in ETH), which can only go down, never up.",
      oneRule: "Every NIGHTSHIFT fee is split the same way, hard-coded: 40% rewards (half to SHIFT stakers, half to NIGHT FROGS holders), 20% dev wallet, 20% treasury, 20% burned. SHIFT is burned to 0x...dEaD; every day at 03:00 UTC the NIGHTSHIFT keeper buys IMD with the ETH part and burns it at IMD's BurnExecutor 0xe29386719c155b6847ad5a4e97c6674f10ffc750. The keeper only pays gas and cannot move funds anywhere else.",
      burnedSoFar: { shift: burns.shift, imd: burns.imd },
      staking: `At ${u}/stake: stake SHIFT with a lock from 0 to 730 days (24 months). Stakers share 20% of every NIGHTSHIFT fee (half of the 40% rewards part; the other half goes to NIGHT FROGS holders), streamed over 7 days in ETH and SHIFT. More stake and a longer lock earn a bigger share. Locked stake cannot be withdrawn early by anyone, the owner included. Rewards can be claimed any time; unlocked stake can be withdrawn any time.`,
      nightFrogs: { about: "500 fully onchain NIGHT FROGS on Ethereum, minted only in IMD (2 IMD each, half burned). Holders get the frog half of rewards weekly by shift hours: #1 50x, Night Watchers (Gen 2, forged from 10 at /forge, never #1) 10x-40x by rarity and never less than their 10 frogs, #2-25 3x, #26-77 2x, the rest 1x; holding an IMD seat doubles it. Claim at /frogs.", minted: frogs?.minted ?? null, contract: config.nft.address || null },
      companies: { live: companies.length, costPerSwarmJob: "0.5 IMD", platformFee: `${config.platformFeeBps / 100}% of withdrawals; 0% for SHIFT and NIGHT FROGS holders`, start: `${u} (sign in with a wallet, press Launch a company)` },
      imdPriceUsd: config.imdUsd,
      links: { website: u, tokenomics: `${u}/tokenomics`, stake: `${u}/stake`, swap: `${u}/swap`, frogs: `${u}/frogs`, guide: `${u}/guide`, telegram: config.telegramUrl || "t.me/getnightshift", x: config.xUrl || null, xCommunity: config.xCommunityUrl },
      forge: {
        status: forgeOn() ? "OPEN" : "not open yet",
        what: "Burn 10 NIGHT FROGS + 2 IMD (1 IMD burned, 1 to the treasury) to forge 1 Night Watcher (NIGHT FROGS Gen 2). You see the exact Night Watcher before you sign. The planner on the page picks your best 10.",
        tiers: "Points of the 10 frogs set the tier: I Shift Lead (10+ pts) 10x shift hours, II Foreman (20+) 15x, III Supervisor (40+) 20x, IV Chief (80+) 30x, V Night Boss (128+) 40x, only 4. A forge that includes NIGHT FROG #1 also makes The Captain, a 1 of 1.",
        perks: "A Night Watcher earns 10x to 40x shift hours (never less than its 10 frogs did), boosts every other frog in the same wallet by 20% to 100%, adds company slots, gets a full week of shift hours at the forge, holds a Night Watch seat and opens the private Watch Room.",
        maxSupply: "50 Night Watchers ever, plus The Captain", forgedSoFar: watchers.length, contract: config.forge.address || null, url: `${u}/forge`,
      },
      nightWatch: { what: "A bot crew that keeps imdUSD (the dollar you borrow against staked IMD, imdusd.com) safe: each Night Watcher is a seat; when a loan drops under 170% the seats mark it and, after the grace period, liquidate it together, sharing the vault's liquidation penalty.", setup: "One command on an always-on computer, or a rented server for about $6/month where one pasted script installs it. The bot's key is made on that machine and never leaves it; it starts in report-only mode; then send it about 0.03 ETH for gas and pair it with your Night Watcher by a link.", url: `${u}/watch` },
      watchRoom: `A private Telegram group for Night Watcher holders only: a signed-in holder gets a one-time invite at ${u}/forge#room; wallets that stop holding one are removed.`,
      gameRoom: { games: "NIGHT CHESS, NIGHT POOL (8-ball), Space Pinball (solo, verified scores) and NIGHT POKER (heads-up No-Limit Hold'em, plus free tables for up to six with house frogs)", stakes: "Play free, or stake SHIFT or IMD through the GameEscrow contract on Ethereum: the winner gets 95%; a no-show or a game never played refunds both stakes.", fair: "Every poker deck is provably fair: committed before the deal, mixed with your browser's seed, checkable after.", prizes: "Each week the top 3 in chess, pool and pinball win +24, +12 and +6 shift hours.", url: `${u}/games` },
      swap: { what: "Multichain swap: Ethereum, Base, Robinhood Chain and Solana both ways, and into XRP, through the better of LI.FI and Relay, every fee shown, exact approvals. The SHIFT/ETH pool swap is on the same page.", fee: "NIGHTSHIFT fee 0.25%; none for a signed-in wallet holding a NIGHT FROG, a Night Watcher or 5M+ SHIFT (wallet plus staked).", url: `${u}/swap` },
      ship: { what: "The Ship: every NIGHT FROG and Night Watcher live on one ship, at the station its traits fit, with what each earns, missions and the Night Watch radar of real imdUSD loans. Sign in and it shows your crew.", url: `${u}/ship` },
      forAgents: { what: "AI agents can pay per call in USDC (x402 services, listed in Coinbase's x402 Bazaar), drive NIGHTSHIFT over MCP, and read llms.txt.", mcp: `${u}/mcp` },
      rewards: "The front page shows everything a wallet can claim (staking, NIGHT FROGS rewards, staked-game winnings, company balances) with one Claim all.",
      changelog: `${u}/changelog`,
      hackathon: { about: HACKATHON.facts, status: hackathonStatus(), page: HACKATHON.url },
      safety: "Admins never DM first. Never share a seed phrase. The only official links are the ones above.",
    };
  }

  /** @username → Telegram id, learned from group messages, so /unmute @user works. */
  readonly #people = new Map<string, string>(((): [string, string][] => { try { return Object.entries(JSON.parse(readFileSync(join(config.dataDir, "people.json"), "utf8"))); } catch { return []; } })());
  #learn(name: string, id: string): void {
    if (!name.startsWith("@") || this.#people.get(name.toLowerCase()) === id) return;
    this.#people.set(name.toLowerCase(), id);
    try { writeFileSync(join(config.dataDir, "people.json"), JSON.stringify(Object.fromEntries(this.#people))); } catch { /* best effort */ }
  }

  /** /unmute and /mute: by reply, by @username (anyone who wrote in the group) or by numeric id. */
  async #muteCommand(cmd: "unmute" | "mute", args: string[], ctx?: CommandContext): Promise<Reply> {
    const token = config.telegramToken;
    if (!token) return { text: "No bot token." };
    const arg = args[0] ?? "";
    const id = ctx?.replyTo?.id ?? (/^\d+$/.test(arg) ? arg : this.#people.get(arg.toLowerCase().replace(/^@?/, "@")));
    const who = ctx?.replyTo?.name ?? arg;
    if (!id) return { text: `Who? Reply to their message with /${cmd}, or /${cmd} @username (they must have written in the group since the bot started), or /${cmd} <user id>.` };
    const groups = ctx?.group ? [ctx.chat] : chats();
    const results: string[] = [];
    for (const chat of groups) {
      let ok: unknown;
      if (cmd === "unmute") {
        // Back to the group's own default rights.
        const g = await tgCall<{ permissions?: Record<string, boolean> }>(token, "getChat", { chat_id: chat });
        const permissions = g?.permissions ?? { can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true, can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true };
        ok = await tgCall(token, "restrictChatMember", { chat_id: chat, user_id: Number(id), permissions, use_independent_chat_permissions: true });
      } else {
        const minutes = Math.max(1, Math.min(60 * 24 * 30, Number(ctx?.replyTo ? args[0] : args[1]) || 60));
        ok = await tgCall(token, "restrictChatMember", { chat_id: chat, user_id: Number(id), until_date: Math.floor(Date.now() / 1000) + minutes * 60,
          permissions: { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false } });
        if (ok) results.push(`for ${minutes >= 1440 ? `${Math.round(minutes / 1440)}d` : minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes} min`}`);
      }
      if (!ok) return { text: `⚠️ Telegram refused. Is the bot an admin with "Ban users" in ${chat}?` };
    }
    if (cmd === "unmute") forgive(id);
    return { text: cmd === "unmute" ? `🔊 ${esc(who)} can talk again. Their strikes are cleared.` : `🔇 ${esc(who)} muted ${results[0] ?? ""}.` };
  }

  readonly #groupAdmins = new Map<string, { at: number; ids: Set<string> }>();
  /** Scams, spam and FUD in the public group: removed, the sender warned or muted, the admins told. */
  async #guard(m: GroupMessage): Promise<boolean> {
    this.#learn(m.name, m.user);
    if (!config.moderation || !config.telegramToken) return false;
    const ours = chats().map((c) => c.toLowerCase());
    if (!ours.includes(m.chat) && !(m.chatUsername && ours.includes(`@${m.chatUsername.toLowerCase()}`))) return false;
    // Group admins are never touched (the list is read from Telegram every 10 minutes).
    let a = this.#groupAdmins.get(m.chat);
    if (!a || Date.now() - a.at > 600_000) {
      const r = await tgCall<{ user: { id: number } }[]>(config.telegramToken, "getChatAdministrators", { chat_id: m.chat });
      a = { at: Date.now(), ids: new Set((r ?? []).map((x) => String(x.user.id))) };
      this.#groupAdmins.set(m.chat, a);
    }
    if (a.ids.has(m.user)) return false;
    const l = launchState();
    const known = [config.token.address, ...Object.values(l?.contracts ?? {}), DEV_WALLET, FIRST_BUYER, IMD_TOKEN, IMD_BURN_EXECUTOR, config.nft.address, V4.router, V4.poolManager]
      .filter(Boolean).map((x) => String(x).toLowerCase());
    const tgs = ["t.me/getnightshift", ...[config.telegramUrl, ...chats()].filter(Boolean).map((x) => x.toLowerCase().replace(/^https?:\/\//, "").replace(/^@/, "t.me/"))];
    const t = track(m.user, m.text);
    const v = judge(m.text, { ourAddresses: known, ourTelegram: tgs });
    const level = v?.level ?? (t.flood ? "flood" : t.repeat ? "spam" : null);
    if (!level) return false;
    const reason = v?.reason ?? (t.flood ? "flooding the chat" : "the same message again and again");
    const token = config.telegramToken;
    await tgCall(token, "deleteMessage", { chat_id: m.chat, message_id: m.messageId });
    const strikes = strike(m.user);
    const minutes = muteMinutes(level, strikes);
    if (minutes > 0) {
      await tgCall(token, "restrictChatMember", { chat_id: m.chat, user_id: Number(m.user), until_date: Math.floor(Date.now() / 1000) + minutes * 60,
        permissions: { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false } });
    }
    const span = minutes >= 1440 ? "24h" : minutes >= 60 ? "1h" : `${minutes} min`;
    const notice = level === "scam"
      ? `🚫 Removed a scam message from ${esc(m.name)} (muted ${span}).\n\nAdmins never DM first. Never share your seed phrase or connect your wallet to a link from chat. The only contract address is on <a href="${config.publicUrl}/token">getnightshift.tech</a>.`
      : level === "fud"
        ? `⚠️ ${esc(m.name)}, that message was removed${minutes ? ` and you are muted ${span}` : ""}. Want proof instead of rumours? Every contract, wallet and fee is on <a href="${config.publicUrl}/tokenomics">getnightshift.tech/tokenomics</a>, checked on chain.`
        : `🔇 ${esc(m.name)} ${minutes ? `muted ${span}` : "warned"}: ${esc(reason)}.`;
    const sent = await tgCall<{ message_id: number }>(token, "sendMessage", { chat_id: m.chat, text: notice, parse_mode: "HTML", disable_web_page_preview: true });
    if (sent?.message_id) setTimeout(() => void tgCall(token, "deleteMessage", { chat_id: m.chat, message_id: sent.message_id }), 60_000);
    void this.alert(`🛡 Guard: ${level} from ${m.name} (${m.user}), strike ${strikes}, ${minutes ? `muted ${span}` : "warned"}: ${reason}\n“${m.text.slice(0, 160)}”`, `guard-${m.user}-${strikes}`);
    return true;
  }

  /** The contract address, privately, to the launch chats (LAUNCH_NOTIFY). */
  async launchDm(html: string, buttons: Button[][]): Promise<boolean> {
    if (!config.telegramToken) return false;
    const sent = await Promise.all(config.launchNotify.split(",").map((id) => id.trim()).filter(Boolean).map((id) => sendCard(id, "launch", `🌙 <b>NIGHTSHIFT · launch</b>\n${html}`, buttons)));
    return sent.some(Boolean);
  }

  /** The IMD price from its deepest Ethereum pool on DexScreener and from GeckoTerminal, checked against each other (budgetPrice). */
  async #refreshImdPrice(): Promise<void> {
    const dex = async () => {
      const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7", { signal: AbortSignal.timeout(8000) });
      const d = (await r.json()) as { pairs?: { chainId: string; baseToken: { address: string }; priceUsd?: string; liquidity?: { usd?: number } }[] };
      const best = (d.pairs ?? [])
        .filter((p) => p.chainId === "ethereum" && p.baseToken.address.toLowerCase() === "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7")
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      return Number(best?.priceUsd);
    };
    const gecko = async () => {
      const r = await fetch("https://api.geckoterminal.com/api/v2/simple/networks/eth/token_price/0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7", { signal: AbortSignal.timeout(8000) });
      const d = (await r.json()) as { data?: { attributes?: { token_prices?: Record<string, string> } } };
      return Number(d.data?.attributes?.token_prices?.["0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7"]);
    };
    const readings = await Promise.all([dex().catch(() => NaN), gecko().catch(() => NaN)]);
    const price = budgetPrice(readings, config.imdUsdAt ? config.imdUsd : null);
    if (price === null) { if (readings.some((x) => x > 0)) console.warn("IMD price kept: the sources disagree or jumped", readings); return; }
    config.imdUsd = price;
    config.imdUsdAt = Date.now();
  }

  on(fn: (e: EngineEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit(companyId: string, type: EngineEvent["type"], payload: unknown): void {
    this.store.markDirty();
    if (type === "journal") this.#ownerAlert(companyId, payload as JournalEntry);
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
      persist: () => this.store.save(),
      market: this.b2b,
      ...(this.#brain ? { brain: this.#brain } : {}),
      studio: { build: (x, t, p, decision) => this.studio.build(x, t, p, decision) },
      // each shift: what sells, the owner's channels and the real events to post about; a post move hands its event to them
      context: (x) => this.connect.context(x),
      posts: { queue: (x, t, fact, angle) => this.connect.queue(x, t, fact, angle) },
      findExisting: async (q) => {
        if (!q.trim()) return null;
        const r = await this.reads.publications(q, "research", 3);
        const hit = r.items[0];
        return hit ? { title: hit.title, url: hit.repo ?? hit.explorer } : null;
      },
    };
  }

  async create(idea: string, policy: Partial<Policy> = {}, owner: string | null = null, origin?: Company["origin"]): Promise<Company> {
    if (owner) {
      const mine = [...this.store.companies.values()].filter((x) => x.owner === owner.toLowerCase()).length;
      // NIGHT FROGS holders may run a few more companies.
      const cap = config.maxCompaniesPerOwner + (await frogSlots(owner));
      if (mine >= cap) throw new Error(`One wallet can run ${cap} companies at once.${frogsOn() && cap === config.maxCompaniesPerOwner ? ` Holding a NIGHT FROG adds ${config.nft.extraSlots}.` : ""}`);
    }
    const clean = idea.trim();
    if (clean.length < 12) throw new Error("Describe the idea in a sentence: what it sells and to whom.");
    if (clean.length > 1000) throw new Error("Keep the idea under 1000 characters.");
    const f = await found(clean, this.llm, config.model);
    const id = randomUUID();
    let slug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "co";
    // deleted companies keep their slug: their buyers' download links still use it
    while ([...this.store.companies.values(), ...this.store.archived.values()].some((x) => x.slug === slug)) slug = `${slug}-${Math.floor(Math.random() * 900 + 100)}`;
    const p = validatePolicy({ ...DEFAULT_POLICY, ...(config.mode === "sim" ? { shiftMinutes: config.simShiftMinutes } : {}), ...policy });
    const c: Company = {
      id, slug, name: f.name, idea: clean, mission: f.mission, audience: f.audience,
      createdAt: Date.now(), owner: owner?.toLowerCase() ?? null, wallet: this.vault.create(id), policy: p, status: "active",
      cycle: 0, nextShiftAt: p.autopilot ? Date.now() + 3000 : null,
      site: null, products: [], tasks: [], journal: [], marketing: [],
      ...(config.mode === "sim" ? { sim: true } : {}),
      ...(origin ? { origin } : {}),
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
      if (config.mode === "live") {
        const b = await balances(c.wallet).catch(() => null);
        if (c.sim) return;
        if (!b || b.imd < 5n * 10n ** 17n || b.eth < 3n * 10n ** 14n) {
          const msg = "Waiting for funds: send IMD and a little ETH to the company wallet (the Fund button on this page). The first shift starts as soon as they land.";
          if (c.journal[c.journal.length - 1]?.text !== msg) note(c, this.#deps(c), "note", msg);
          if (c.policy.autopilot) c.nextShiftAt = Date.now() + 5 * 60_000;
          return;
        }
      }
      // Announced once it is funded, so an unfunded or spam company never reaches the project's account.
      if (config.mode === "live" && c.cycle === 0) housePost(`🌙 A new company just started on NIGHTSHIFT: ${c.name}.

${c.mission}

The IMD swarm starts building tonight. ${config.publicUrl}/c/${c.slug}`, `company-${c.id}`);
      await runShift(c, this.#deps(c));
      if (c.policy.autopilot) c.nextShiftAt = Date.now() + c.policy.shiftMinutes * 60_000;
    } finally {
      this.#busy.delete(c.id);
      this.#emit(c.id, "company", null);
    }
  }

  async approve(c: Company, taskId: string): Promise<void> { await approve(c, taskId, this.#deps(c)); }
  reject(c: Company, taskId: string): void { reject(c, taskId, this.#deps(c)); }

  /** The owner's price for a product, in USD; the CEO will not change it afterwards. */
  setPrice(c: Company, productId: string, priceUsd: number): void {
    const p = c.products.find((x) => x.id === productId);
    if (!p) throw new Error("no such product");
    if (!(priceUsd >= 0.5 && priceUsd <= 500)) throw new Error("Price is between $0.50 and $500.");
    const before = Number(p.priceUsdc) / 1e6;
    p.priceUsdc = BigInt(Math.round(priceUsd * 100)) * 10_000n;
    p.priceByOwner = true;
    note(c, this.#deps(c), "note", `${p.name}: price set by the owner, $${before.toFixed(2)} → $${(Number(p.priceUsdc) / 1e6).toFixed(2)}.`);
    this.#emit(c.id, "company", null);
  }

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

  /** The owner edits who the company is and gives the CEO a standing direction. The slug stays, so links keep working. */
  updateProfile(c: Company, p: Record<string, unknown>): void {
    const changed: string[] = [];
    const field = (k: "name" | "mission" | "audience" | "idea", label: string, min: number, max: number): void => {
      if (p[k] === undefined) return;
      const v = plain(p[k]);
      if (v.length < min || v.length > max) throw new Error(`${label}: between ${min} and ${max} characters.`);
      if (k === "name" && !/^[\p{L}\p{N} .,'&!?+-]+$/u.test(v)) throw new Error("Name: letters, numbers, spaces and . , ' & ! ? + - only.");
      if (c[k] !== v) { c[k] = v; changed.push(label.toLowerCase()); }
    };
    field("name", "Name", 2, 40);
    field("mission", "Mission", 12, 300);
    field("audience", "Audience", 3, 120);
    field("idea", "Idea", 12, 1000);
    if (p.direction !== undefined) {
      const v = plain(p.direction);
      if (v.length > 500) throw new Error("Direction: at most 500 characters.");
      if ((c.direction ?? "") !== v) {
        if (v) c.direction = v; else delete c.direction;
        changed.push("direction");
        delete c.restUntil; // a new direction is worth a fresh shift
      }
    }
    if (!changed.length) return;
    const list = changed.length === 1 ? changed[0] : `${changed.slice(0, -1).join(", ")} and ${changed.at(-1)}`;
    note(c, this.#deps(c), "note", `The owner updated the ${list}.${changed.includes("direction") ? (c.direction ? ` The CEO now follows: "${c.direction}"` : " The CEO decides on its own again.") : ""}`);
    this.store.markDirty();
    this.#emit(c.id, "company", null);
  }

  /** The owner renames, rewrites, takes off sale or puts back on sale one product. */
  editProduct(c: Company, productId: string, p: Record<string, unknown>): void {
    const x = c.products.find((y) => y.id === productId);
    if (!x) throw new Error("no such product");
    const done: string[] = [];
    if (p.name !== undefined) {
      const v = plain(p.name);
      if (v.length < 3 || v.length > 80) throw new Error("Product name: between 3 and 80 characters.");
      if (v !== x.name) { done.push(`renamed "${x.name}" to "${v}"`); x.name = v; }
    }
    if (p.pitch !== undefined) {
      const v = plain(p.pitch);
      if (v.length < 8 || v.length > 240) throw new Error("Pitch: between 8 and 240 characters.");
      if (v !== x.pitch) { x.pitch = v; done.push(`rewrote the pitch of "${x.name}"`); }
    }
    if (p.status === "retired" && x.status === "live") { x.status = "retired"; done.push(`took "${x.name}" off sale`); }
    if (p.status === "live" && x.status === "retired") {
      if (!x.deliverableUrl || !this.files.has(c, x)) throw new Error("This product has no packaged file, so it cannot go back on sale.");
      x.status = "live";
      done.push(`put "${x.name}" back on sale`);
    }
    if (!done.length) return;
    note(c, this.#deps(c), "note", `The owner ${done.join("; ")}.`);
    this.store.markDirty();
    this.#emit(c.id, "company", null);
  }

  /**
   * Work the owner orders by hand (research, a product, the site or a change to it), checked like the
   * CEO's own moves and paid inside the daily budget. Returns the task, to follow in the flight recorder.
   */
  async commission(c: Company, w: Record<string, unknown>): Promise<Task> {
    if (this.#busy.has(c.id)) throw new Error("A shift is running. Try again in a minute.");
    const brief = plain(w.brief ?? "");
    let decision: Decision;
    if (w.kind === "research") {
      if (brief.length < 20 || brief.length > 1500) throw new Error("Say what to research in 20 to 1500 characters.");
      decision = { kind: "research", title: `Research: ${brief.slice(0, 70)}${brief.length > 70 ? "…" : ""}`, why: "Ordered by the owner.", brief };
    } else if (w.kind === "build_product") {
      const name = plain(w.name ?? ""), pitch = plain(w.pitch ?? ""), price = Number(w.priceUsd);
      const planner = w.productKind === "planner";
      const kind = planner ? "template" : (["tool", "template", "dataset", "report"] as const).find((k) => k === w.productKind) ?? "tool";
      if (name.length < 3 || name.length > 80) throw new Error("Product name: between 3 and 80 characters.");
      if (pitch.length < 8 || pitch.length > 240) throw new Error("Pitch: between 8 and 240 characters.");
      if (!(price >= 1 && price <= 499)) throw new Error("Price: between $1 and $499.");
      if (brief.length < 20 || brief.length > 1500) throw new Error("Say what goes inside in 20 to 1500 characters.");
      decision = { kind: "build_product", title: `${planner ? "Make" : "Build"} "${name}"`, why: "Ordered by the owner.", brief, product: { name, kind, pitch, priceUsd: Math.round(price * 100) / 100, ...(planner ? { format: "planner" as const } : {}) } };
    } else if (w.kind === "build_site") {
      if (c.site) throw new Error("The company already has a site: order a change to it instead.");
      if (!c.products.some((p) => p.status === "live")) throw new Error("A site needs something to sell first.");
      decision = { kind: "build_site", title: "Put the company on the web", why: "Ordered by the owner.", brief: brief || `A one-page site for ${c.name}: the promise (${c.mission}), who it is for (${c.audience}), the products with prices and a buy button each, and a short FAQ.` };
    } else if (w.kind === "improve_site") {
      if (!c.site) throw new Error("There is no site yet: order the site first.");
      if (brief.length < 20 || brief.length > 1500) throw new Error("Say what to change in 20 to 1500 characters.");
      decision = { kind: "improve_site", title: `Change the site: ${brief.slice(0, 60)}${brief.length > 60 ? "…" : ""}`, why: "Ordered by the owner.", brief };
    } else throw new Error("Order research, a product, the site or a change to the site.");
    this.#busy.add(c.id);
    try {
      return await commission(c, this.#deps(c), decision);
    } finally {
      this.#busy.delete(c.id);
      this.store.markDirty();
      this.#emit(c.id, "company", null);
    }
  }

  /** What the CEO answers the owner from: its company only, its money and accounts, and what other companies sell. */
  async #chatFacts(c: Company): Promise<ChatFacts> {
    const context = await this.connect.context(c).catch(() => ({}));
    const like = `${c.idea} ${c.audience} ${c.direction ?? ""} ${c.products.map((p) => p.name).join(" ")}`;
    const offers = (await this.b2b.offers(c).catch(() => []))
      .filter((o) => o.seller.id !== c.id && Boolean(c.owner) && Boolean(o.seller.owner) && o.seller.owner!.toLowerCase() !== c.owner!.toLowerCase() && Boolean(o.seller.sim) === Boolean(c.sim))
      .map((o) => ({ o, score: keywordScore(like, o).score })).sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.o);
    const usdcHeld = await this.b2b.usdc(c).catch(() => 0n);
    let swarmUsd = 0.5 * config.imdUsd;
    try { swarmUsd = fromImd((await this.plane(c).capabilities()).price) * config.imdUsd; } catch { /* the usual price */ }
    const daily = c.policy.aiDailyUsd ?? DEFAULT_POLICY.aiDailyUsd ?? 0;
    const left = daily - fromUsdc(aiSpentToday(c));
    const connected = [...CHANNELS.filter((k) => c.connections?.channels[k] && !c.connections.channels[k]!.paused), ...(c.connections?.gumroad ? ["gumroad"] : [])];
    return {
      stats: { ...this.stats(c), ...context }, offers, usdcUsd: fromUsdc(usdcHeld), swarmUsd, pageUrl: `${config.publicUrl}/c/${c.slug}`, connected,
      brainLeftUsd: this.#brain && daily > 0 && left >= 0.01 && fromUsdc(usdcHeld) >= 0.01 ? left : null,
    };
  }

  /** /weather in Telegram: the swarm's day as a forecast, with its moving card. */
  async #weatherReply(): Promise<{ text: string; buttons?: { text: string; url: string }[][]; animation?: string }> {
    const page = `${config.publicUrl}/mind`;
    if (!this.weather) return { text: "🌦 SWARM WEATHER is not on in this engine." };
    const w = await this.weather.today().catch(() => null);
    if (!w) return { text: "🌦 The swarm's numbers did not come in. Try again in a minute.", buttons: [[{ text: "🧠 SWARM MIND", url: page }]] };
    return { text: weatherText(w, page), animation: `${config.publicUrl}/api/mind/weather.gif?d=${w.day}`, buttons: [[{ text: "🧠 Ask the swarm", url: page }]] };
  }

  /** /brief in Telegram: where BRIEF DOCTOR lives (the request is checked on the page, where it fits). */
  async #briefReply(args: string[]): Promise<{ text: string; buttons?: { text: string; url: string }[][] }> {
    const q = args.join(" ").trim();
    const url = `${config.publicUrl}/mind?brief=${encodeURIComponent(q.slice(0, 600))}#brief`;
    return { text: "🩺 <b>BRIEF DOCTOR</b>\nCheck a request before you pay 0.5 IMD for it: IMD's own free check, the work the swarm already did on it, and a better request that says what the swarm would have to guess.", buttons: [[{ text: "🩺 Check my request", url }]] };
  }

  /** Once a day, after 18:00 UTC: the forecast and its card in the community chats. */
  async #postWeather(): Promise<void> {
    const day = new Date().toISOString().slice(0, 10), mark = join(config.dataDir, "swarm-weather-posted.txt");
    if (new Date().getUTCHours() < 18 || (existsSync(mark) && readFileSync(mark, "utf8").trim() === day) || !this.weather || !this.mind || this.mind.size() < 500) return;
    const w = await this.weather.today();
    writeFileSync(mark, day);
    const r = await this.#weatherReply();
    const markup = { inline_keyboard: (r.buttons ?? []).map((row) => row.map((b) => ({ text: b.text, url: b.url }))) };
    for (const chat of chats()) await tgCall(config.telegramToken, "sendAnimation", { chat_id: chat, animation: `${config.publicUrl}/api/mind/weather.gif?d=${w.day}`, caption: weatherText(w, `${config.publicUrl}/mind`).slice(0, 1024), parse_mode: "HTML", reply_markup: markup });
  }

  /** /ask in Telegram: a question to SWARM MIND, answered from the swarm's own work, its sources as buttons. */
  async #askSwarm(args: string[]): Promise<{ text: string; buttons?: { text: string; url: string }[][] }> {
    const q = args.join(" ").trim();
    const page = `${config.publicUrl}/mind`;
    if (!this.mind) return { text: "🧠 SWARM MIND is not on in this engine.", buttons: [[{ text: "🧠 SWARM MIND", url: page }]] };
    if (q.length < 3) return { text: `🧠 <b>SWARM MIND</b>\nAsk the IMD swarm's memory: ${this.mind.stats().works.toLocaleString("en-US")} works it published (research, audits, contracts, sites).\n\nTry: <code>/ask what audits found reentrancy</code>`, buttons: [[{ text: "🧠 Open SWARM MIND", url: page }]] };
    const r = await this.mind.ask(q, this.llm, config.chatModel).catch(() => null);
    if (!r) return { text: "🧠 SWARM MIND could not answer right now. Try again in a minute.", buttons: [[{ text: "🧠 SWARM MIND", url: page }]] };
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
    return {
      text: `🧠 <b>SWARM MIND</b> · ${esc(q.slice(0, 120))}\n\n${esc(r.answer).slice(0, 2600)}\n\n<i>From the swarm's own work. Not financial advice.</i>`,
      buttons: [...r.sources.slice(0, 3).map((s) => [{ text: `[${s.n}] ${s.title.slice(0, 48)}`, url: s.url }]), [{ text: "🧠 Ask more", url: `${page}?q=${encodeURIComponent(q.slice(0, 200))}` }]],
    };
  }

  /** The owner's chat: the lines, and which brain the CEO thinks with. */
  async chatView(c: Company) {
    const f = await this.#chatFacts(c);
    return {
      lines: (c.chat ?? []).slice(-60),
      brain: { strong: f.brainLeftUsd !== null, model: this.#brain ? config.ceoModel : null, leftUsd: f.brainLeftUsd, dailyUsd: c.policy.aiDailyUsd ?? DEFAULT_POLICY.aiDailyUsd ?? 0, spentTodayUsd: fromUsdc(aiSpentToday(c)), spentTotalUsd: fromUsdc(c.aiSpentUsdc ?? 0n), usdcUsd: f.usdcUsd },
    };
  }

  /** The owner writes to the CEO; the CEO answers on the free model, with buttons. Nothing is spent or done until a button is pressed. */
  async chat(c: Company, text: unknown): Promise<ChatLine[]> {
    if (!this.llm) throw new Error("The CEO chat needs the AI key on this engine.");
    const msg = String(text ?? "").replace(/[<>]/g, "").replace(/[ \t]+/g, " ").trim();
    if (msg.length < 2 || msg.length > 1500) throw new Error("Write between 2 and 1500 characters.");
    if (asksToday(c) >= 80) throw new Error("That is 80 messages today. The CEO answers again tomorrow.");
    const facts = await this.#chatFacts(c);
    const asked: ChatLine = { id: randomUUID(), at: Date.now(), from: "owner", text: msg };
    let reply: ChatLine;
    try {
      reply = await answerOwner(this.llm, config.chatModel, c, msg, facts);
    } catch (e) {
      throw new Error(/nothing useful/.test((e as Error).message) ? (e as Error).message : "The CEO could not answer right now: the free models are busy. Try again in a minute.");
    }
    remember(c, asked, reply);
    this.store.markDirty();
    return [asked, reply];
  }

  /** The owner pressed a button under a CEO answer: it is done with the fields stored with it, by the same rules as work ordered by hand. */
  async chatAct(c: Company, lineId: string, actionId: string): Promise<{ ok: true; note: string; taskId?: string; state?: string }> {
    const a = c.chat?.find((l) => l.id === lineId && l.from === "ceo")?.actions?.find((x) => x.id === actionId);
    if (!a) throw new Error("That button is gone.");
    const done = (note: string, taskId?: string) => {
      a.state = "done";
      a.note = note;
      this.store.markDirty();
      this.#emit(c.id, "company", null);
      return { ok: true as const, note, state: "done", ...(taskId ? { taskId } : {}) };
    };
    if (a.type === "todo") {
      if (a.state === "done") { delete a.state; delete a.note; this.store.markDirty(); return { ok: true, note: "Back on the list." }; }
      return done("Done.");
    }
    if (a.state === "done") throw new Error(a.note ?? "Already done.");
    if (a.type === "post") return done("Marked as posted.");
    if (a.type === "connect") return { ok: true, note: "Open Connections to link the account." };
    if (a.type === "order") {
      const t = await this.commission(c, { kind: a.kind, brief: a.brief, name: a.name, pitch: a.pitch, priceUsd: a.priceUsd, productKind: a.productKind });
      if (t.status === "failed") throw new Error(t.error ?? "The order did not go through.");
      return done(t.status === "awaiting_approval" ? `Waiting for your approval: ${t.title}.` : `Ordered: ${t.title}.`, t.id);
    }
    if (this.#busy.has(c.id)) throw new Error("A shift is running. Try again in a minute.");
    this.#busy.add(c.id);
    try {
      const t = await ownerBuy(c, this.#deps(c), a.sellerId, a.productId);
      if (t.status === "failed") throw new Error(t.error ?? "The purchase did not go through.");
      return done(t.status === "done" ? `Bought "${a.name}" from ${a.seller}. It is in this company's research now.` : `Paying ${a.seller} for "${a.name}": waiting for Base to confirm.`, t.id);
    } finally {
      this.#busy.delete(c.id);
      this.store.markDirty();
      this.#emit(c.id, "company", null);
    }
  }

  /**
   * Deletes a company for its owner: it stops working and selling at once. It is archived, not erased:
   * the books stay whole, buyers' download links keep working, and the owner can restore it. In live
   * mode the wallet must be emptied first ("Stop and take the funds back"), so nothing is left behind.
   */
  async archive(c: Company): Promise<void> {
    if (this.#busy.has(c.id) || c.tasks.some((t) => t.status === "checking" || t.status === "ordering")) throw new Error("A payment is in progress. Try again in a minute.");
    if ([...this.store.settlements.values()].some((s) => s.companyId === c.id)) throw new Error("A sale is still settling on chain. Try again in a few minutes.");
    if (config.mode === "live" && !c.sim) {
      if (this.payouts.pendingOf(c.id).length) throw new Error("A withdrawal is still settling. Try again in a few minutes.");
      if ((await this.withdrawable(c)) > 0n) throw new Error('The company still has revenue to take out. Use "Stop and take the funds back" first, then delete it.');
      const b = await balances(c.wallet);
      if (b.imd > 0n || b.usdc >= 10_000n) throw new Error('The company wallet still holds IMD or USDC. Use "Stop and take the funds back" first, then delete it.');
    }
    c.status = "paused";
    c.nextShiftAt = null;
    // what it published on the owner's Gumroad comes down too
    await this.connect.closeDown(c).catch((e) => console.error("gumroad close", c.slug, (e as Error).message));
    const building = c.tasks.filter((t) => t.status === "building").length;
    note(c, this.#deps(c), "note", `Deleted by the owner. It no longer runs or sells; buyers' download links keep working.${building ? ` ${building} paid order${building === 1 ? " was" : "s were"} still with the swarm and will not be applied.` : ""}`);
    this.store.companies.delete(c.id);
    this.store.archived.set(c.id, Object.assign(c, { archivedAt: Date.now() }));
    this.store.markDirty();
    this.#emit(c.id, "company", null);
  }

  /** Brings a deleted company back, paused, for its owner. */
  async restore(id: string, owner: string | null): Promise<Company> {
    const c = this.store.archived.get(id);
    if (!c) throw new Error("no such deleted company");
    if (config.requireAuth && (!owner || c.owner !== owner)) throw new Error("Only its owner can restore it.");
    if (c.owner) {
      const mine = [...this.store.companies.values()].filter((x) => x.owner === c.owner).length;
      const cap = config.maxCompaniesPerOwner + (await frogSlots(c.owner));
      if (mine >= cap) throw new Error(`One wallet can run ${cap} companies at once. Delete another one first.`);
    }
    this.store.archived.delete(id);
    delete (c as Partial<typeof c>).archivedAt;
    this.store.companies.set(id, c);
    note(c, this.#deps(c), "note", "Restored by the owner. It is paused: resume it when you are ready.");
    this.store.markDirty();
    this.#emit(c.id, "company", null);
    return c;
  }

  // ---- owner alerts on Telegram: a one-time code links a chat, then the company reports what needs its owner
  readonly #alertCodes = new Map<string, { companyId: string; until: number }>();
  readonly #alertsSent = new Map<string, number[]>();

  /** A one-time link (10 minutes) that opens the bot and turns this company's alerts on in that chat. */
  async alertLink(c: Company): Promise<{ url: string; code: string }> {
    if (!config.telegramToken) throw new Error("Alerts need the NIGHTSHIFT bot, which is not set up on this engine.");
    if (this.#botName === null) this.#botName = (await tgCall<{ username: string }>(config.telegramToken, "getMe", {}))?.username?.toLowerCase() ?? "";
    if (!this.#botName) throw new Error("The bot did not answer. Try again in a minute.");
    for (const [k, v] of this.#alertCodes) if (v.until < Date.now()) this.#alertCodes.delete(k);
    const code = randomBytes(12).toString("base64url");
    this.#alertCodes.set(code, { companyId: c.id, until: Date.now() + 10 * 60_000 });
    return { url: `https://t.me/${this.#botName}?start=${code}`, code };
  }

  alertsOff(c: Company): void {
    if (!c.notify) return;
    delete c.notify;
    note(c, this.#deps(c), "note", "Telegram alerts turned off by the owner.");
    this.store.markDirty();
    this.#emit(c.id, "company", null);
  }

  async #linkAlerts(chat: string, code: string): Promise<Reply | null> {
    const entry = this.#alertCodes.get(code);
    if (!entry) return /^[\w-]{16}$/.test(code) ? { text: "🌙 This alert link has expired. Make a new one from your owner desk." } : null;
    this.#alertCodes.delete(code);
    const c = this.store.companies.get(entry.companyId);
    if (!c || entry.until < Date.now()) return { text: "🌙 This alert link has expired. Make a new one from your owner desk." };
    c.notify = { telegram: chat, at: Date.now() };
    note(c, this.#deps(c), "note", "Telegram alerts are on.");
    this.store.markDirty();
    this.#emit(c.id, "company", null);
    return {
      text: `🌙 <b>Alerts on for ${esc(c.name)}.</b>\nYou will hear here when a purchase waits for your approval, when something sells, when the swarm delivers, and when something goes wrong. Turn them off from your owner desk.`,
      buttons: [[{ text: "Open the owner desk", url: `${config.publicUrl}/my` }]],
    };
  }

  /** What the owner should hear about, from the company's log: approvals always, the rest at most 20 an hour. */
  #ownerAlert(companyId: string, e: JournalEntry): void {
    const c = this.store.companies.get(companyId);
    const chat = c?.notify?.telegram;
    if (!c || !chat || !config.telegramToken) return;
    const text = e.text.replace(/^\[sim\] /, "");
    const approval = e.kind === "note" && text.startsWith("Waiting for your approval");
    const icon = approval ? "✋" : e.kind === "sale" ? "💰" : e.kind === "result" ? "✅" : e.kind === "warning" ? "⚠️" : null;
    if (!icon) return;
    if (!approval) {
      const hour = Date.now() - 3600_000;
      const sent = (this.#alertsSent.get(c.id) ?? []).filter((t) => t > hour);
      if (sent.length >= 20) return;
      sent.push(Date.now());
      this.#alertsSent.set(c.id, sent);
    }
    const sim = e.text.startsWith("[sim] ") || c.sim ? " · simulation" : "";
    const where = approval ? `${config.publicUrl}/my` : `${config.publicUrl}/co/${c.id}`;
    void telegram(config.telegramToken, chat, `${icon} <b>${esc(c.name)}</b>${sim}\n${esc(text)}`, [[{ text: approval ? "Approve or decline" : "Open the company", url: where }]]);
  }

  /** A deleted company, by id or slug: for its buyers' downloads and its owner's list. */
  archived(idOrSlug: string): Company | undefined {
    return this.store.archived.get(idOrSlug) ?? [...this.store.archived.values()].find((c) => c.slug === idOrSlug);
  }

  /** After a restart: work cut off mid-step is closed honestly, and old logs lose the model's name. */
  #recover(): void {
    for (const c of [...this.store.companies.values(), ...this.store.archived.values()]) { c.policy = { ...DEFAULT_POLICY, ...c.policy }; this.connect.migrate(c); }
    for (const c of this.store.companies.values()) {
      for (const j of c.journal) if (j.kind === "decision") j.text = j.text.replace(/ \([\w.-]+\/[\w.:-]+\)$/, "");
      for (const t of c.tasks) {
        // A market purchase cut off while paying: booked already (finish it), sent on chain (follow it), or never paid.
        if (t.status === "ordering" && t.market?.pick && !t.market.paid) {
          const sent = config.mode === "live" ? [...this.store.settlements.values()].find((x) => x.b2b?.taskId === t.id && x.hash) : undefined;
          const deps = this.#deps(c);
          void this.b2b.receiptFor(t).then((r) => {
            if (r) return finishMarketBuy(c, t, r, deps);
            if (sent) {
              t.market!.pending = sent.key;
              Object.assign(t, { status: "building", activity: "paid · confirming with Base after a restart" });
              mark(t, Date.now());
              return;
            }
            Object.assign(t, { status: "failed", activity: null, costUsdc: 0n, error: "interrupted before payment; nothing was paid" });
            mark(t, Date.now());
            note(c, deps, "note", `"${t.title}" was cut off before paying for it on the market. Nothing was paid; the next shift starts fresh.`);
          }).finally(() => this.store.markDirty());
          continue;
        }
        if (t.status === "failed" && /rejected by spendControls/.test(t.error ?? "") && t.costImd) { t.costImd = 0n; note(c, this.#deps(c), "note", `"${t.title}" was never paid (the payment library refused IMD before signing). Its budget is back.`); }
        // Cut off mid-payment with an order id: follow that order with IMD (paid → it builds; never paid → the budget comes back).
        if (t.status === "ordering" && t.imd?.orderId) {
          Object.assign(t, { status: "building", activity: "confirming with IMD after a restart" });
          mark(t, Date.now());
          note(c, this.#deps(c), "note", `"${t.title}" was being paid when the engine restarted. Following its order with IMD instead of buying it again.`);
          continue;
        }
        // No order id yet means IMD had not even quoted it: nothing can have been paid.
        const paid = false;
        if (t.status !== "checking" && t.status !== "ordering") continue;
        Object.assign(t, { status: "failed", activity: null, error: paid ? "interrupted while paying; it may have been paid, check the wallet on Etherscan" : "interrupted before payment; nothing was paid" });
        mark(t, Date.now());
        if (!paid) t.costImd = 0n;
        const i = c.products.findIndex((p) => p.id === t.productId && p.status === "building");
        if (i >= 0) c.products.splice(i, 1);
        note(c, this.#deps(c), "note", paid ? `"${t.title}" was cut off while paying. If IMD left the wallet, it still counts against the budget.` : `"${t.title}" was cut off before payment. Nothing was paid; the next shift starts fresh.`);
      }
    }
    this.store.markDirty();
  }

  /** Live mode: companies made in simulation stop for good: no sales, no orders, no withdrawals. */
  async #retireSim(): Promise<void> {
    for (const c of this.store.companies.values()) {
      if (!c.sim && !(await this.ledger.store.get(`fund:${c.id}`))) continue;
      c.sim = true;
      c.status = "paused";
      c.nextShiftAt = null;
      for (const p of c.products) if (p.status !== "retired") p.status = "retired";
      for (const t of c.tasks) if (["building", "ordering", "checking", "awaiting_approval"].includes(t.status)) Object.assign(t, { status: "failed", error: "simulation", activity: null });
    }
    this.store.markDirty();
  }

  /** A sale, real (settled on chain) or simulated. Revenue lands in the company's own wallet. `via`: who settled it (in the ledger). */
  async recordSale(c: Company, productId: string, amount: bigint, payer: string, tx: string | null, sim: boolean, via?: SettledBy): Promise<void> {
    const meta = via ? { settledBy: via } : undefined;
    // once per settlement: a retry or the background follow-up of the same payment books nothing new
    if (tx && (await this.ledger.store.get(`sale:${tx}`))) return;
    const p = c.products.find((x) => x.id === productId);
    // money that arrived is booked even for a product removed since
    if (!p) {
      await this.ledger.post({ id: `sale:${tx ?? randomUUID()}`, at: new Date(), kind: sim ? "sale_sim" : "sale", memo: productId, ref: tx ? { chainTx: tx } : undefined, meta, postings: [
        { account: `co:${c.id}:usdc`, asset: "USDC", amount },
        { account: sim ? "ext:buyers-sim" : "ext:buyers", asset: "USDC", amount: -amount },
      ] });
      if (!sim) await this.store.save();
      return;
    }
    const pub = !sim && payer.toLowerCase() !== c.owner && fromUsdc(amount) >= Math.max(1, config.buyMinUsd);
    if (pub) void toCommunity(`💰 <b>A NIGHTSHIFT company just made a sale</b>

${esc(c.name)} sold <b>${esc(p.name)}</b> for $${fromUsdc(amount).toFixed(2)}.
Built by the IMD swarm, sold while its owner slept 🌙`, [[{ text: "🛒 See the market", url: `${config.publicUrl}/market` }]], "sale");
    if (pub) housePost(`💰 ${c.name} just made a sale: ${p.name}, $${fromUsdc(amount).toFixed(2)}. Built by the IMD swarm, sold while its owner slept. ${config.publicUrl}/market`, `sale-${tx ?? Date.now()}`);
    // the house services sell cents at a time: only a dollar or more is worth an operator alert
    if (!sim && !(c.house && fromUsdc(amount) < 1)) void this.alert(`💰 ${c.name} sold ${p.name} for $${fromUsdc(amount).toFixed(2)}${tx ? ` · tx ${tx}` : ""}`, `sale-${tx ?? Date.now()}`);
    p.sales += 1;
    p.revenueUsdc += amount;
    const m = this.store.metricsOf(c.id);
    m.sales.push({ at: Date.now(), productId, usdc: amount.toString(), payer, tx, sim });
    if (m.sales.length > 5000) m.sales.splice(0, m.sales.length - 5000);
    await this.ledger.post({ id: `sale:${tx ?? randomUUID()}`, at: new Date(), kind: sim ? "sale_sim" : "sale", memo: p.name, ref: tx ? { chainTx: tx } : undefined, meta, postings: [
      { account: `co:${c.id}:usdc`, asset: "USDC", amount },
      { account: sim ? "ext:buyers-sim" : "ext:buyers", asset: "USDC", amount: -amount },
    ] });
    // on disk before the buyer gets the link: a crash now cannot lose a settled sale
    if (!sim) await this.store.save();
    note(c, this.#deps(c), "sale", `${sim ? "[sim] " : ""}Sold ${p.name} for $${fromUsdc(amount).toFixed(2)} to ${payer.slice(0, 6)}…${payer.slice(-4)}.`);
    this.#emit(c.id, "sale", { productId, amount: amount.toString(), sim });
  }

  /**
   * Stop everything and give it all back: the company pauses, its revenue is withdrawn (fee rules
   * apply), then every IMD, USDC and ETH left in its wallet goes to the owner. Gas for each
   * transfer comes out of the ETH being returned.
   */
  async closeOut(c: Company, to: `0x${string}`): Promise<{ txs: string[]; returned: string[] }> {
    if (config.mode !== "live") throw new Error("Only in live mode: a simulated company holds no real funds.");
    if (this.#busy.has(c.id) || c.tasks.some((t) => t.status === "ordering" || t.status === "checking")) throw new Error("A payment is in progress. Try again in a minute.");
    this.setStatus(c, "paused");
    const txs: string[] = [];
    const returned: string[] = [];
    if (!c.sim && (await this.withdrawable(c)) > 0n) {
      const r = await this.withdraw(c, to);
      txs.push(...r.txs);
      returned.push(`$${fromUsdc(r.sent).toFixed(2)} revenue`);
    }
    const account = this.vault.account(c.id);
    const b = await balances(c.wallet);
    const sweepEth = async (client: typeof eth | typeof sales, wallet: ReturnType<typeof ethWallet> | ReturnType<typeof salesWallet>, balance: bigint, extra: bigint, label: string) => {
      const fees = await client.estimateFeesPerGas();
      const reserve = (21_000n * fees.maxFeePerGas * 13n) / 10n + extra;
      if (balance <= reserve) return;
      const hash = await (wallet.sendTransaction as (a: unknown) => Promise<`0x${string}`>)({ to, value: balance - reserve, gas: 21_000n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      await client.waitForTransactionReceipt({ hash });
      txs.push(hash);
      returned.push(`${Number(balance - reserve) / 1e18} ETH on ${label}`);
    };
    // Base: USDC that is not revenue (sent by hand), then the gas ETH (an L1 data fee rides on top there).
    const sw = salesWallet(account);
    // the platform fee still owed from a withdrawal stays in the wallet for its own transfer
    const inWallet = await sales.readContract({ address: USDC[config.salesChainId]!.address, abi: erc20Abi, functionName: "balanceOf", args: [c.wallet] });
    const owed = await this.payouts.feesOwed(c.id);
    const leftUsdc = inWallet > owed ? inWallet - owed : 0n;
    if (leftUsdc > 0n) {
      const hash = await sw.writeContract({ address: USDC[config.salesChainId]!.address, abi: erc20Abi, functionName: "transfer", args: [to, leftUsdc] });
      await sales.waitForTransactionReceipt({ hash });
      txs.push(hash); returned.push(`${fromUsdc(leftUsdc).toFixed(2)} USDC`);
    }
    await sweepEth(sales, sw, await sales.getBalance({ address: c.wallet }), 20_000_000_000_000n, "Base");
    // Ethereum: IMD, then ETH.
    const ew = ethWallet(account);
    if (b.imd > 0n) {
      const hash = await ew.writeContract({ address: IMD_MAINNET, abi: erc20Abi, functionName: "transfer", args: [to, b.imd] });
      await eth.waitForTransactionReceipt({ hash });
      txs.push(hash); returned.push(`${Number(b.imd) / 1e18} IMD`);
    }
    await sweepEth(eth, ew, await eth.getBalance({ address: c.wallet }), 0n, "Ethereum");
    note(c, this.#deps(c), "note", `Stopped by the owner. Returned to ${to.slice(0, 6)}…${to.slice(-4)}: ${returned.join(", ") || "nothing left to return"}.`);
    this.#emit(c.id, "company", null);
    return { txs, returned };
  }

  /** Revenue the owner can take out now: what the company earned, minus what was already withdrawn. */
  async withdrawable(c: Company): Promise<bigint> {
    return this.ledger.balance(`co:${c.id}:usdc`, "USDC");
  }

  /**
   * Sends the company's USDC to its owner. The platform fee, when one is set, is split by the one
   * rule in the same withdrawal: 20% to the dev wallet, 80% to the treasury, which holds the
   * rewards and burn parts (60%) until those contracts take USDC. In sim mode only the books move.
   */
  readonly #withdrawing = new Set<string>();
  /**
   * Since when each wallet has been seen holding SHIFT or a NIGHT FROG, without a gap: the fee is
   * waived only after FEE_EXEMPT_AFTER_MS of that, so tokens borrowed (or flash-bought) for the one
   * withdrawal do not waive it. Kept in fee-exempt.json; a wallet seen without them starts over.
   */
  readonly #eligibleSince = new Map<string, number>(((): [string, number][] => { try { return Object.entries(JSON.parse(readFileSync(join(config.dataDir, "fee-exempt.json"), "utf8")) as Record<string, number>).filter(([, t]) => Number.isFinite(t)); } catch { return []; } })());
  #feeExempt(wallet: string | null, holdsNow: boolean, now = Date.now()): boolean {
    if (!wallet) return false;
    const r = feeExemptAfter(this.#eligibleSince, wallet, holdsNow, now);
    if (r.changed) { try { writeFileSync(join(config.dataDir, "fee-exempt.json"), JSON.stringify(Object.fromEntries(this.#eligibleSince))); } catch { /* best effort: lost, the fee is charged until seen again */ } }
    return r.exempt;
  }
  /** One withdrawal at a time per company; the owner's share leaves first; perks are read fresh from the chain. */
  async withdraw(c: Company, to: `0x${string}`, amount?: bigint): Promise<{ sent: bigint; fee: bigint; txs: string[] }> {
    if (this.#withdrawing.has(c.id)) throw new Error("A withdrawal for this company is already running.");
    this.#withdrawing.add(c.id);
    try { return await this.#withdraw(c, to, amount); } finally { this.#withdrawing.delete(c.id); }
  }
  async #withdraw(c: Company, to: `0x${string}`, amount?: bigint): Promise<{ sent: bigint; fee: bigint; txs: string[] }> {
    if (c.sim && config.mode === "live") throw new Error("A simulated company has no real revenue to withdraw.");
    const dest = { dev: config.platformDev, treasury: config.platformTreasury };
    if (config.mode === "live" && (await this.payouts.resolve(c.id))) throw new Error("An earlier transfer from this wallet is still waiting for Base. Try again in a few minutes.");
    const available = await this.withdrawable(c);
    const total = amount ?? available;
    if (total <= 0n || total > available) throw new Error(`Nothing to withdraw, or more than the $${fromUsdc(available).toFixed(2)} available.`);
    const holder = this.#feeExempt(c.owner, (await holderStatus(c.owner, true)).holds || (await frogCount(c.owner, true)) > 0);
    const feeBps = config.platformTreasury && !holder ? config.platformFeeBps : 0;
    if (config.mode === "live") {
      // gas for every transfer of this withdrawal (owner, dev, treasury) before the first one leaves
      const legs = 1 + (feeBps > 0 || (await this.payouts.feesOwed(c.id)) > 0n ? FEE_PARTS.length : 0);
      const gas = await sales.getBalance({ address: c.wallet });
      if (gas < BigInt(legs) * 20_000_000_000_000n) throw new Error(`The company wallet needs a little ETH on Base for ${legs} transfers (has ${Number(gas) / 1e18}). Nothing was sent.`);
    }
    // The owner's share first; a fee left owed by this or an earlier withdrawal is paid after it, never charged twice.
    const r = await this.payouts.withdraw(c.id, to, total, feeBps, dest);
    if (r.feeError) void this.alert(`${c.name}: a platform fee transfer failed and stays owed (retried on the next withdrawal): ${r.feeError}`, `fee-${c.id}`);
    note(c, this.#deps(c), "note", `Withdrew $${fromUsdc(r.sent).toFixed(2)} to ${to.slice(0, 6)}…${to.slice(-4)}${r.fee > 0n ? ` (platform fee $${fromUsdc(r.fee).toFixed(2)})` : ""}${config.mode === "sim" ? " [sim]" : ""}.`);
    this.#emit(c.id, "company", null);
    return { sent: r.sent, fee: r.fee, txs: config.mode === "live" ? [r.tx, ...r.feeTxs] : [] };
  }

  /** A settled x402 payment, booked once. One another company paid is booked as B2B, never as a sale to a person. */
  async #bookSale(s: Settlement & { hash: `0x${string}` }): Promise<void> {
    const c = this.store.companies.get(s.companyId);
    if (!c) throw new Error(`no company ${s.companyId} for sale ${s.hash}`);
    // a record from before the facilitator: signed by the company (it has a nonce), or found on chain
    const via: SettledBy = s.via ?? (s.nonce !== undefined ? "self" : "other");
    if (s.b2b) {
      const r = await this.b2b.book({ sellerId: c.id, productId: s.productId, buyerId: s.b2b.buyerId, taskId: s.b2b.taskId, value: s.value, tx: s.hash, sim: false, via });
      const buyer = this.store.companies.get(s.b2b.buyerId);
      const t = buyer?.tasks.find((x) => x.id === s.b2b!.taskId);
      // a payment that landed after its shift was cut off still delivers the file it paid for
      if (r && buyer && t?.market?.pick) finishMarketBuy(buyer, t, r, this.#deps(buyer));
      await this.store.save();
      return;
    }
    await this.recordSale(c, s.productId, s.value, s.payer, s.hash, false, via);
  }

  readonly #settling = new Map<string, Promise<unknown>>();
  /** Payments to one company settle one at a time (its wallet signs each settlement), whoever pays: a person, an agent or another company. */
  settleInTurn<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#settling.get(companyId) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    this.#settling.set(companyId, run.catch(() => {}));
    return run;
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

  /** A card for the admin chat only: our own HTML (not escaped) with buttons. */
  async adminCard(html: string, buttons: Button[][], topic: string, kind: Anim = "launch"): Promise<boolean> {
    if (!config.telegramToken || !config.telegramChat) return false;
    const last = this.#lastAlert.get(topic) ?? 0;
    if (Date.now() - last < 60_000) return false;
    this.#lastAlert.set(topic, Date.now());
    const sent = await Promise.all(config.telegramChat.split(",").map((id) => id.trim()).filter(Boolean).map((id) => sendCard(id, kind, `🌙 <b>NIGHTSHIFT · admin</b>\n${html}`, buttons)));
    return sent.some(Boolean);
  }

  /** The private card when $SHIFT is deployed: what was checked, and one tap to make the first buy. */
  launchReadyCard(l: { symbol: string; token?: string; launchId?: string; contracts?: Record<string, string> }, checks: { label: string; ok: boolean; detail: string }[]): { html: string; buttons: Button[][] } {
    const ok = checks.length > 0 && checks.every((c) => c.ok);
    const token = l.token ?? "";
    const html = `${ok ? "✅" : "❌"} <b>$${esc(l.symbol)} is deployed. Checked against our spec:</b>\n\n${checks.map((c) => `${c.ok ? "✅" : "❌"} ${esc(c.label)}${c.ok ? "" : ` (${esc(c.detail)})`}`).join("\n")}\n\n<code>${esc(token)}</code>\n\n${ok
      ? "<b>Everything matches.</b> Trading is closed to everyone except <b>0x3322…4D69</b>. Buy from that wallet, any amount: the moment it lands, the token goes public and the community is told."
      : "<b>Do NOT buy from 0x3322…4D69.</b> Trading stays closed, so nobody can lose money. Open /setup and tell Claude."}`;
    const ether = (a?: string) => `https://etherscan.io/address/${a}`;
    const buttons: Button[][] = ok
      ? [[{ text: "🟢 First buy on Uniswap (0x3322…4D69)", url: `https://app.uniswap.org/swap?chain=mainnet&inputCurrency=NATIVE&outputCurrency=${token}` }],
         [{ text: "📄 Token", url: ether(token) }, ...(l.contracts?.hook ? [{ text: "🪝 Hook", url: ether(l.contracts.hook) }] : [])],
         [...(l.launchId ? [{ text: "🧾 IMD launch", url: `https://api.imd.fun/launches/${l.launchId}` }] : []), { text: "⚙️ Setup", url: `${config.publicUrl}/setup` }]]
      : [[{ text: "⚙️ Open setup", url: `${config.publicUrl}/setup` }], [{ text: "📄 Token", url: ether(token) }]];
    return { html, buttons };
  }

  /** Every card the bot can send, marked TEST, to the chats they belong in. */
  async testAll(): Promise<string> {
    const T = "🧪 <b>TEST</b> · ";
    const sym = config.token.symbol;
    const shown: string[] = [];
    const say = async (what: string, p: Promise<boolean>) => { shown.push(`${(await p) ? "✅" : "❌"} ${what}`); };
    const buy = (usdv: number, wallet = 0) => buyCard({ test: true, usd: usdv, wallet, imd: usdv / config.imdUsd, tokens: usdv / 0.0000068, buyer: "0x8f3a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c", tx: `0x${"0".repeat(64)}`, newHolder: usdv < 1000, position: 35, mcap: 2500 * config.imdUsd, liquidity: 2250 * config.imdUsd });
    const ready = this.launchReadyCard({ symbol: sym, token: "0x000000000000000000000000000000000000dEaD", launchId: "test", contracts: { hook: "0x000000000000000000000000000000000000dEaD" } }, [{ label: "Token is NIGHTSHIFT / SHIFT", ok: true, detail: "" }, { label: "Trading is still closed (only the first buyer can buy)", ok: true, detail: "" }, { label: "Splitter burns IMD at IMD's BurnExecutor 0xe293…c750", ok: true, detail: "" }]);
    await say("Launch ready (admin only)", this.adminCard(`${T}${ready.html}`, ready.buttons, "test-launch-ready"));
    await say("Launch DM (CA, before the treasury buy)", this.launchDm(`${T}🚀 <b>$${esc(sym)} is deployed and checked.</b> Waiting for the treasury buy.

CA: <code>0x0000…TEST</code>

Trading is closed to everyone except the treasury <b>0x3322…4D69</b>.`, [[{ text: "🟢 First buy on Uniswap (treasury wallet)", url: "https://app.uniswap.org/swap?chain=mainnet" }]]));
    const b1 = buy(180, 2_400); await say("Buy (dolphin wallet)", toCommunity(b1.text, b1.buttons, "buy"));
    const b2 = buy(3200, 125_000); await say("Mega whale buy", toCommunity(b2.text, b2.buttons, "whale"));
    await say("Token launch", toCommunity(`${T}🚀🌙 <b>$${esc(sym)} IS LIVE</b>\n\n<code>0x0000…TEST</code>\n\nTrading is open to everyone on Ethereum, paired with ETH.
Every sell pays 5%: 40% to stakers and NIGHT FROGS holders, 20% burned (SHIFT and IMD).`, [[{ text: `🟢 Buy $${sym}`, url: `${config.publicUrl}/token` }]], "launch"));
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

  /**
   * The Bluesky form from before Connections: the same connection (app password in the vault, the
   * account's bot label set), with "post on its own" off meaning every post waits for the owner.
   */
  async connectBluesky(c: Company, handle: string, appPassword: string, auto: boolean): Promise<string> {
    const ch = await this.connect.connectBluesky(c, handle, appPassword);
    this.connect.channelSettings(c, "bluesky", { approveEach: !auto });
    return ch.label.replace(/^@/, "");
  }
  async disconnectBluesky(c: Company): Promise<void> { await this.connect.disconnect(c, "bluesky"); }

  /** Every product on sale across all companies: the public catalog for people and agents. */
  market(q = ""): { company: string; slug: string; id: string; name: string; kind: string; pitch: string; priceUsd: number; sales: number; featured: boolean; buyUrl: string; page: string }[] {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return [...this.store.companies.values()]
      .flatMap((c) => c.products.filter((p) => p.status === "live" && this.files.has(c, p)).map((p) => ({
        company: c.name, slug: c.slug, id: p.id, name: p.name, kind: p.kind, pitch: p.pitch,
        priceUsd: Number(p.priceUsdc) / 1e6, sales: p.sales, featured: holdsCached(c.owner) || frogCached(c.owner),
        buyUrl: `${config.publicUrl}/buy/${c.slug}/${p.id}`, page: `${config.publicUrl}/c/${c.slug}#${p.id}`,
        text: `${c.name} ${c.mission} ${c.audience} ${p.name} ${p.pitch}`.toLowerCase(),
      })))
      .filter((x) => words.every((w) => x.text.includes(w)))
      .sort((a, b) => Number(b.featured) - Number(a.featured) || b.sales - a.sales)
      .map(({ text: _t, ...x }) => x);
  }

  #ticking = false;
  async #tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try { await this.#tickOnce(); } finally { this.#ticking = false; }
  }
  async #tickOnce(): Promise<void> {
    const now = Date.now();
    for (const c of this.store.companies.values()) {
      if (c.tasks.some((t) => t.status === "building")) await advance(c, this.#deps(c)).catch((e) => console.error("advance", c.slug, e));
      // a studio build cut off by a restart is started again
      for (const t of c.tasks) {
        const p = t.studio && t.status === "building" ? c.products.find((x) => x.id === t.productId) : undefined;
        if (!p || this.studio.building(t.id) || now - t.updatedAt < 120_000) continue;
        this.studio.build(c, t, p, { kind: "build_product", title: t.title, why: t.why, brief: t.studio!.brief ?? "", product: { name: p.name, kind: "template", pitch: p.pitch, priceUsd: fromUsdc(p.priceUsdc), format: "planner" } });
      }
      // a site or web tool delivered before IMD published its address: collected, never bought again
      if (missingAddress(c).length) await recoverAddresses(c, this.#deps(c)).catch((e) => console.error("address", c.slug, e));
      // a market payment sent on chain is followed until it lands (booked by the checkout) or is dropped
      for (const t of c.tasks) {
        if (t.status !== "building" || !t.market?.pending || t.market.paid) continue;
        if (this.store.settlements.has(t.market.pending)) continue;
        const r = await this.b2b.receiptFor(t);
        if (r) finishMarketBuy(c, t, r, this.#deps(c));
        else dropMarketBuy(c, t, this.#deps(c), "the payment never landed on Base, so nothing was charged. Its market limit is back.");
      }
      if (c.status === "active" && c.policy.autopilot && c.nextShiftAt && now >= c.nextShiftAt && !this.#busy.has(c.id)) {
        await this.shiftNow(c).catch((e) => console.error("shift", c.slug, e));
      }
      // the owner's own accounts: posts out by their rules, Gumroad in step, Gumroad sales read (also while paused)
      if (!(config.mode === "live" && c.sim)) await this.connect.tick(c, c.status === "active").catch((e) => console.error("connect", c.slug, (e as Error).message));
      if (config.mode === "live" && config.blueskyCompanyPosts && houseOn() && !c.connections?.channels.bluesky && c.status === "active") {
        // No account of its own: the draft goes out on the project account, paced with the rest.
        const m = c.marketing.find((x) => x.status === "drafted");
        if (m) { housePost(`${m.text}\n\n— ${c.name}, a NIGHTSHIFT company`, `mkt-${c.id}-${m.at}`); Object.assign(m, { status: "posted", channel: "bluesky:project" }); this.#emit(c.id, "company", null); }
      }
      // the holder perks, refreshed in the background; a holder seen here starts its fee-waiver clock (only a
      // withdrawal's fresh read resets it: a failed read here also answers "not a holder")
      if (c.owner) { const w = c.owner; void Promise.all([holderStatus(w), frogCount(w)]).then(([h, f]) => { if (h.holds || f > 0) this.#feeExempt(w, true); }).catch(() => {}); }
      for (const p of c.products) {
        if (p.status !== "live" || this.files.has(c, p)) continue;
        const t = c.tasks.find((x) => x.id === p.taskId);
        void this.files.ensure(c, p, async () => {
          if (!t?.result) return null;
          // a web tool is hosted by IMD: the buyer gets its address and how to use it
          if (p.kind === "tool") return p.deliverableUrl ? toolAccess(c, p, p.deliverableUrl) : null;
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

const AUTH_USED = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
/** The settlement of an authorization used without our record of it: the last day of blocks, checked for the transfer itself. */
async function findSettlement(from: `0x${string}`, nonce: `0x${string}`, to: `0x${string}`, value: bigint): Promise<`0x${string}` | null> {
  const usdc = USDC[config.salesChainId]!.address;
  const head = await sales.getBlockNumber();
  for (let hi = head, n = 0; n < 9 && hi > 0n; n++, hi -= 5_000n) {
    const lo = hi > 4_999n ? hi - 4_999n : 0n;
    const logs = await sales.getLogs({ address: usdc, event: AUTH_USED, args: { authorizer: from, nonce }, fromBlock: lo, toBlock: hi });
    for (const l of logs) {
      const r = await sales.getTransactionReceipt({ hash: l.transactionHash! });
      if (r.status !== "success") continue;
      const paid = (await sales.getLogs({ address: usdc, event: TRANSFER, args: { from, to }, blockHash: r.blockHash })).some((t) => t.transactionHash === r.transactionHash && t.args.value === value);
      if (paid) return r.transactionHash;
    }
  }
  return null;
}

/** A wallet must have been seen eligible for the fee waiver (holding SHIFT or a NIGHT FROG) this long without a gap. */
export const FEE_EXEMPT_AFTER_MS = 7 * DAY;
/**
 * The waiver rule: records when a wallet was first seen eligible (`since`, by lowercase wallet),
 * forgets it the first time the wallet is seen without, and waives only after FEE_EXEMPT_AFTER_MS.
 */
export function feeExemptAfter(since: Map<string, number>, wallet: string, holdsNow: boolean, now: number): { exempt: boolean; changed: boolean } {
  const w = wallet.toLowerCase(), first = since.get(w);
  if (!holdsNow) return { exempt: false, changed: since.delete(w) };
  if (first === undefined) { since.set(w, now); return { exempt: false, changed: true }; }
  return { exempt: now - first >= FEE_EXEMPT_AFTER_MS, changed: false };
}
