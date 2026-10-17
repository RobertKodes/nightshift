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
import { balances, ensurePermit2, eth, ethWallet, sales, salesWallet } from "./chain.js";
import { findPool } from "./v4.js";
import { IMD_MAINNET } from "@nightshift/imd";
import { config } from "./config.js";
import { simulateTraffic } from "./market.js";
import { SimDeliveries } from "./simdeliver.js";
import { Store } from "./store.js";
import { Vault } from "./vault.js";
import { ProductFiles, fetchDelivery } from "./products.js";
import { accrueStaking, frogCached, frogCount, frogStats, frogsOn, markRevealAnnounced, milestoneSeen, newMints, revealAnnounced, setMilestone, stakingBoard } from "./frogs.js";
import { followOrders } from "./orders.js";
import { houseNow, houseOn, housePost, houseStatus, houseTick } from "./house.js";
import { type Anim, buyCard, raid, publicCommand, sendCard, startCommunity, toCommunity, welcome } from "./community.js";
import { type Button, type Reply, blueskyPost, blueskySession, esc, telegram, telegramCommands } from "./social.js";
import { followLaunch, followOpen, holderStatus, holdsCached, launchState, patchLaunch, saveVerification } from "./token.js";
import { verifyShift } from "./shift-verify.js";
import { writeSettings } from "./settings.js";

export type EngineEvent = { type: "task" | "journal" | "company" | "sale"; companyId: string; payload: unknown; at: number };
const DAY = 24 * 3600_000;

export class Engine {
  readonly store = new Store(config.dataDir);
  readonly vault = new Vault(config.dataDir, config.secret);
  readonly ledger = new Ledger(this.store.ledgerStore);
  readonly llm = config.openrouterKey ? new LlmClient({ apiKey: config.openrouterKey, appName: "NIGHTSHIFT", fallbackModels: config.fallbackModels, freeOnly: !config.llmAllowPaid }) : null;
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
    this.#recover();
    if (config.mode === "live") await this.#retireSim();
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
    setInterval(() => void houseTick().catch((e) => console.error("house", e)), 60_000);
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
    let boardWeek = "";
    setInterval(() => {
      const d = new Date();
      const week = `${d.getUTCFullYear()}-${Math.floor(d.getTime() / 604_800_000)}`;
      if (!frogsOn() || d.getUTCDay() !== 0 || d.getUTCHours() !== 18 || boardWeek === week) return;
      boardWeek = week;
      const top = stakingBoard(5);
      if (!top.length) return;
      const medal = ["🥇", "🥈", "🥉", "4.", "5."];
      void toCommunity(`🐸⏱ <b>NIGHT SHIFT HOURS · top of the crew</b>\n\n${top.map((t, i) => `${medal[i]} <a href="https://etherscan.io/address/${t.wallet}">${t.wallet.slice(0, 6)}…${t.wallet.slice(-4)}</a> · ${t.hours.toLocaleString("en-US")} h · ${t.frogs} frog${t.frogs === 1 ? "" : "s"}`).join("\n")}\n\nHold a frog, earn hours. Genesis 2×, #1 5×. No locking, no gas.`, [[{ text: "⏱ My shift hours", url: `${config.publicUrl}/frogs#staking` }]], "frog");
    }, 60_000);
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
    if (!before || before.announced || before.error) return;
    const buyUrl = (t: string) => `https://app.uniswap.org/swap?chain=mainnet&inputCurrency=NATIVE&outputCurrency=${t}`;
    if (!before.done) {
      const l = await followLaunch();
      if (l && l.stage !== before.stage) void this.alert(`🪙 ${l.symbol} launch: ${l.stage}`, `launch-${l.stage}`);
      // Deployed: check it against what we asked for, privately, before anyone can buy.
      if (l?.done && l.contracts) {
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

  /** The contract address, privately, to the launch chats (LAUNCH_NOTIFY). */
  async launchDm(html: string, buttons: Button[][]): Promise<boolean> {
    if (!config.telegramToken) return false;
    const sent = await Promise.all(config.launchNotify.split(",").map((id) => id.trim()).filter(Boolean).map((id) => sendCard(id, "launch", `🌙 <b>NIGHTSHIFT · launch</b>\n${html}`, buttons)));
    return sent.some(Boolean);
  }

  /** The IMD price from its deepest Ethereum pool on DexScreener, else GeckoTerminal; keeps the last good value on failure. */
  async #refreshImdPrice(): Promise<void> {
    const keep = (price: number) => { if (price > 0.01 && price < 10_000) { config.imdUsd = price; config.imdUsdAt = Date.now(); return true; } return false; };
    try {
      const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7", { signal: AbortSignal.timeout(8000) });
      const d = (await r.json()) as { pairs?: { chainId: string; baseToken: { address: string }; priceUsd?: string; liquidity?: { usd?: number } }[] };
      const best = (d.pairs ?? [])
        .filter((p) => p.chainId === "ethereum" && p.baseToken.address.toLowerCase() === "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7")
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      if (keep(Number(best?.priceUsd))) return;
    } catch { /* try the next source */ }
    try {
      const r = await fetch("https://api.geckoterminal.com/api/v2/simple/networks/eth/token_price/0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7", { signal: AbortSignal.timeout(8000) });
      const d = (await r.json()) as { data?: { attributes?: { token_prices?: Record<string, string> } } };
      keep(Number(d.data?.attributes?.token_prices?.["0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7"]));
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
      // NIGHT FROGS holders may run a few more companies.
      const cap = config.maxCompaniesPerOwner + ((await frogCount(owner)) > 0 ? config.nft.extraSlots : 0);
      if (mine >= cap) throw new Error(`One wallet can run ${cap} companies at once.${frogsOn() && cap === config.maxCompaniesPerOwner ? ` Holding a NIGHT FROG adds ${config.nft.extraSlots}.` : ""}`);
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
      ...(config.mode === "sim" ? { sim: true } : {}),
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

  /** After a restart: work cut off mid-step is closed honestly, and old logs lose the model's name. */
  #recover(): void {
    for (const c of this.store.companies.values()) {
      for (const j of c.journal) if (j.kind === "decision") j.text = j.text.replace(/ \([\w.-]+\/[\w.:-]+\)$/, "");
      for (const t of c.tasks) {
        const paid = t.status === "ordering" && !t.imd?.orderId;
        if (t.status !== "checking" && !paid) continue;
        Object.assign(t, { status: "failed", activity: null, error: paid ? "interrupted while paying; it may have been paid, check the wallet on Etherscan" : "interrupted before payment; nothing was paid" });
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

  /** A sale, real (settled on chain) or simulated. Revenue lands in the company's own wallet. */
  async recordSale(c: Company, productId: string, amount: bigint, payer: string, tx: string | null, sim: boolean): Promise<void> {
    const p = c.products.find((x) => x.id === productId);
    if (!p) return;
    const pub = !sim && payer.toLowerCase() !== c.owner && fromUsdc(amount) >= Math.max(1, config.buyMinUsd);
    if (pub) void toCommunity(`💰 <b>A NIGHTSHIFT company just made a sale</b>

${esc(c.name)} sold <b>${esc(p.name)}</b> for $${fromUsdc(amount).toFixed(2)}.
Built by the IMD swarm, sold while its owner slept 🌙`, [[{ text: "🛒 See the market", url: `${config.publicUrl}/market` }]], "sale");
    if (pub) housePost(`💰 ${c.name} just made a sale: ${p.name}, $${fromUsdc(amount).toFixed(2)}. Built by the IMD swarm, sold while its owner slept. ${config.publicUrl}/market`, `sale-${tx ?? Date.now()}`);
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
    const leftUsdc = await sales.readContract({ address: USDC[config.salesChainId]!.address, abi: erc20Abi, functionName: "balanceOf", args: [c.wallet] });
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
  /** One withdrawal at a time per company; the fee leaves first; perks are read fresh from the chain. */
  async withdraw(c: Company, to: `0x${string}`, amount?: bigint): Promise<{ sent: bigint; fee: bigint; txs: string[] }> {
    if (this.#withdrawing.has(c.id)) throw new Error("A withdrawal for this company is already running.");
    this.#withdrawing.add(c.id);
    try { return await this.#withdraw(c, to, amount); } finally { this.#withdrawing.delete(c.id); }
  }
  async #withdraw(c: Company, to: `0x${string}`, amount?: bigint): Promise<{ sent: bigint; fee: bigint; txs: string[] }> {
    if (c.sim && config.mode === "live") throw new Error("A simulated company has no real revenue to withdraw.");
    const available = await this.withdrawable(c);
    const total = amount ?? available;
    if (total <= 0n || total > available) throw new Error(`Nothing to withdraw, or more than the $${fromUsdc(available).toFixed(2)} available.`);
    const holder = (await holderStatus(c.owner, true)).holds || (await frogCount(c.owner, true)) > 0;
    const fee = config.platformTreasury && !holder ? (total * BigInt(config.platformFeeBps)) / 10_000n : 0n;
    const sent = total - fee;
    const devFee = (fee * 2000n) / 10_000n;
    const parts = ([[config.platformDev, devFee, "ext:platform:dev"], [config.platformTreasury as `0x${string}`, fee - devFee, "ext:platform:treasury"]] as const).filter(([, v]) => v > 0n);
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
      try {
        for (const [dest, v] of parts) await send(dest, v);
        await send(to, sent);
      } catch (e) {
        // fee parts that already left: book them so the ledger matches the wallet, then report the failure
        const left = parts.slice(0, txs.length);
        if (left.length) await this.ledger.post({ id: `withdraw-fee:${txs[0]}`, at: new Date(), kind: "withdrawal", memo: "platform fee (owner transfer failed)", ref: { chainTx: txs[0]! }, postings: [
          { account: `co:${c.id}:usdc`, asset: "USDC", amount: -left.reduce((a, [, v]) => a + v, 0n) }, ...left.map(([, v, acc]) => ({ account: acc, asset: "USDC" as const, amount: v }))] });
        throw e;
      }
    }
    const id = txs[txs.length - 1] ?? randomUUID();
    await this.ledger.post({ id: `withdraw:${id}`, at: new Date(), kind: "withdrawal", memo: `to ${to}`, ref: txs[0] ? { chainTx: txs[0] } : undefined, postings: [
      { account: `co:${c.id}:usdc`, asset: "USDC", amount: -total },
      { account: `ext:owner:${to.toLowerCase()}`, asset: "USDC", amount: sent },
      ...parts.map(([, v, acc]) => ({ account: acc, asset: "USDC" as const, amount: v })),
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
    const buy = (usdv: number) => buyCard({ test: true, usd: usdv, imd: usdv / config.imdUsd, tokens: usdv / 0.0000068, buyer: "0x8f3a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c", tx: `0x${"0".repeat(64)}`, newHolder: usdv < 1000, position: 35, mcap: 2500 * config.imdUsd, liquidity: 2250 * config.imdUsd });
    const ready = this.launchReadyCard({ symbol: sym, token: "0x000000000000000000000000000000000000dEaD", launchId: "test", contracts: { hook: "0x000000000000000000000000000000000000dEaD" } }, [{ label: "Token is NIGHTSHIFT / SHIFT", ok: true, detail: "" }, { label: "Trading is still closed (only the first buyer can buy)", ok: true, detail: "" }, { label: "Splitter burns IMD at IMD's BurnExecutor 0xe293…c750", ok: true, detail: "" }]);
    await say("Launch ready (admin only)", this.adminCard(`${T}${ready.html}`, ready.buttons, "test-launch-ready"));
    await say("Launch DM (CA, before the treasury buy)", this.launchDm(`${T}🚀 <b>$${esc(sym)} is deployed and checked.</b> Waiting for the treasury buy.

CA: <code>0x0000…TEST</code>

Trading is closed to everyone except the treasury <b>0x3322…4D69</b>.`, [[{ text: "🟢 First buy on Uniswap (treasury wallet)", url: "https://app.uniswap.org/swap?chain=mainnet" }]]));
    const b1 = buy(180); await say("Buy", toCommunity(b1.text, b1.buttons, "buy"));
    const b2 = buy(3200); await say("Whale buy", toCommunity(b2.text, b2.buttons, "whale"));
    await say("X raid", raid(`${config.xUrl}/status/1846000000000000000`, "TEST: this is how a raid looks"));
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
      if (c.status === "active" && c.policy.autopilot && c.nextShiftAt && now >= c.nextShiftAt && !this.#busy.has(c.id)) {
        await this.shiftNow(c).catch((e) => console.error("shift", c.slug, e));
      }
      if (config.mode === "live" && c.social?.bluesky?.auto) {
        const i = c.marketing.findIndex((m) => m.status === "drafted");
        if (i >= 0) await this.publishPost(c, i).catch(() => {});
      } else if (config.mode === "live" && config.blueskyCompanyPosts && houseOn() && !c.social?.bluesky && c.status === "active") {
        // No account of its own: the draft goes out on the project account, paced with the rest.
        const m = c.marketing.find((x) => x.status === "drafted");
        if (m) { housePost(`${m.text}\n\n— ${c.name}, a NIGHTSHIFT company`, `mkt-${c.id}-${m.at}`); Object.assign(m, { status: "posted", channel: "bluesky:project" }); this.#emit(c.id, "company", null); }
      }
      if (c.owner) { void holderStatus(c.owner); void frogCount(c.owner); }
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
