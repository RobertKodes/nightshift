import { type Company, DEFAULT_POLICY, type Product } from "@nightshift/core";
import { type PaymentPayload, USDC, decodeHeader, requirement, verifyPayment } from "@nightshift/x402";
import { erc20Abi } from "viem";
import { eth, sales } from "../chain.js";
import { NoGasError, PendingError } from "../checkout.js";
import { config } from "../config.js";
import type { Engine } from "../engine.js";
import { readHoldings } from "../swap.js";
import { buildCheck } from "../crews/buildcheck.js";
import { liveWatchtower, recordPaid, recordWatchJob, setLiveWatchtower, watchAlert } from "../crews/live.js";
import { Watchtower } from "../watchtower/index.js";
import { telegram } from "../social.js";
import { join } from "node:path";
import { researchReport } from "../crews/research.js";
import { HOLDER_SHIFT, OFFERS, type Offer, holderPriceOf } from "./catalog.js";
import { context } from "./context.js";
import { liveNet, liveRpc } from "./net.js";
import { type Payer, type SettleTerms, services } from "./routes.js";
import { IMD_MAINNET } from "@nightshift/imd";
import { SwarmDesk, setSwarmDesk } from "../crews/swarm.js";
import { attachSwarmRefill, swarmJson, swarmVerified, swarmImportRepo } from "../crews/swarm-live.js";
import { saleKey } from "../checkout.js";
import { payerClass } from "../proof.js";
import { notePaymentAttempt } from "../owner-stats.js";

/**
 * NIGHTSHIFT Services, the house company: the platform's own seller for the house services.
 * There was no platform-owned seller before (platform money was only the withdrawal fee), so the
 * services get a company of their own in the store, flagged `house`: its wallet settles the x402
 * payments on Base and receives them, its owner is the treasury wallet (which withdraws the revenue
 * like any owner), it never runs CEO shifts, and it is left off the company boards.
 */
export const HOUSE_ID = "nightshift-services";

export function ensureHouse(engine: Engine): Company {
  const now = Date.now();
  let c = engine.store.companies.get(HOUSE_ID);
  if (!c) {
    let wallet: `0x${string}`;
    try { wallet = engine.vault.account(HOUSE_ID).address; } catch { wallet = engine.vault.create(HOUSE_ID); }
    c = {
      id: HOUSE_ID, slug: HOUSE_ID, name: "NIGHTSHIFT Services",
      idea: "House services run by NIGHTSHIFT: Token Verdict, Hook Inspector, IMD Data Feed and Swarm Desk, sold per call over x402 and MCP.",
      mission: "Answer the questions agents and traders ask about the IMD ecosystem before they buy, with evidence.",
      audience: "AI agents, trading bots and IMD launch teams",
      createdAt: now, owner: config.platformTreasury ? config.platformTreasury.toLowerCase() : null, wallet,
      policy: { ...DEFAULT_POLICY, autopilot: false, marketBuy: false, dailyBudgetUsd: 0, marketDailyUsd: 0 }, status: "paused",
      cycle: 0, nextShiftAt: null, site: null, products: [], tasks: [], journal: [], marketing: [], house: true,
    };
    engine.store.companies.set(HOUSE_ID, c);
  }
  // the offers are the products: names and prices follow the catalogue, sales stay
  for (const o of OFFERS) {
    const p = c.products.find((x) => x.id === o.id);
    if (p) Object.assign(p, { name: o.name, kind: o.kind, pitch: o.pitch, priceUsdc: o.priceUsdc, status: "live" });
    else c.products.push({ id: o.id, name: o.name, kind: o.kind, pitch: o.pitch, priceUsdc: o.priceUsdc, priceByOwner: true, status: "live", deliverableUrl: null, taskId: "house", sales: 0, revenueUsdc: 0n, createdAt: now } satisfies Product);
  }
  c.house = true;
  c.status = "paused";
  c.policy.autopilot = false;
  c.nextShiftAt = null;
  engine.store.markDirty();
  return c;
}

/** The engine's side of a paid call: the same checks, settlement and booking as every product sold on NIGHTSHIFT. */
export function enginePayer(engine: Engine): Payer {
  const house = () => engine.store.companies.get(HOUSE_ID) ?? ensureHouse(engine);
  const hits = new Map<string, { n: number; reset: number }>();
  const limited = (k: string, n: number, ms: number) => { const now = Date.now(); const h = hits.get(k); if (!h || h.reset < now) { hits.set(k, { n: 1, reset: now + ms }); return false; } h.n++; return h.n > n; };
  // the holder price, read on Ethereum and kept 10 minutes a wallet
  const holders = new Map<string, { at: number; v: boolean }>();
  const holder = async (wallet: string): Promise<boolean> => {
    const k = wallet.toLowerCase(), hit = holders.get(k);
    if (hit && Date.now() - hit.at < 600_000) return hit.v;
    const v = await readHoldings(k, BigInt(HOLDER_SHIFT) * 10n ** 18n).catch(() => hit?.v ?? false);
    if (holders.size > 20_000) holders.clear();
    holders.set(k, { at: Date.now(), v });
    return v;
  };
  return {
    mode: config.mode,
    chainId: config.salesChainId,
    payTo: () => house().wallet,
    holder,
    async check(o: Offer, header: string, ip: string) {
      const c = house();
      let payment: PaymentPayload;
      try { payment = decodeHeader<PaymentPayload>(header); } catch { return { ok: false, status: 402, reason: "invalid_payload", challenge: true }; }
      const auth = payment?.payload?.authorization;
      // the holder price is the paying wallet's: whoever signs pays half only if that wallet holds
      const half = Boolean(!o.quoted && auth?.from && /^0x[0-9a-fA-F]{40}$/.test(auth.from) && auth.value && BigInt(auth.value) < o.priceUsdc && (await holder(auth.from)));
      const req = requirement(config.salesChainId, c.wallet, half ? holderPriceOf(o) : o.priceUsdc);
      // a retry of a payment already settled is checked as of its first try, at the price paid then
      const prior = auth?.from && auth.nonce ? engine.checkout.recordOf(auth.from, auth.nonce) : undefined;
      const v = await verifyPayment(payment, prior ? requirement(config.salesChainId, c.wallet, prior.value) : req, prior ? Math.floor(prior.at / 1000) : undefined);
      const refused = (reason: string) => notePaymentAttempt({ service: o.name, payer: auth.from, nonce: auth.nonce, reason });
      if (!v.ok) {
        const reason = v.reason === "insufficient_amount" && !half && auth?.value && BigInt(auth.value) >= holderPriceOf(o) ? `the holder price is for a paying wallet with ${HOLDER_SHIFT.toLocaleString("en-US")}+ $SHIFT (wallet plus staked), a NIGHT FROG or a Night Watcher` : v.reason;
        // The amount check precedes signature verification: verify it before notifying the owner.
        if (v.reason === "insufficient_amount" && (await verifyPayment(payment, { ...req, amount: "0" }).catch(() => ({ ok: false }))).ok) refused(reason);
        return { ok: false, status: 402, reason, challenge: true };
      }
      if (prior && prior.productId !== o.id) {
        const reason = "This payment was made for another service.";
        refused(reason); return { ok: false, status: 409, reason };
      }
      if (config.mode === "sim") return { ok: true, payment, payer: v.payer };
      // settling costs the house gas on Base: per caller and per payer (the feed is cheap and polled, so it gets more room)
      const feed = o.id === "imd-feed";
      if (limited(`ip:${ip}`, config.x402Facilitator === "cdp" ? 240 : feed ? 120 : 20, 60_000) || limited(`payer:${v.payer.toLowerCase()}`, config.x402Facilitator === "cdp" ? 120 : feed ? 60 : 10, 60_000)) {
        const reason = "Too many payments at once; try again in a minute.";
        refused(reason); return { ok: false, status: 429, reason };
      }
      if (await engine.checkout.fresh(auth.from, auth.nonce)) {
        const bal = await sales.readContract({ address: USDC[config.salesChainId]!.address, abi: erc20Abi, functionName: "balanceOf", args: [v.payer] }).catch(() => 0n);
        if (bal < BigInt(auth.value)) {
          const reason = "insufficient USDC balance";
          refused(reason); return { ok: false, status: 402, reason, challenge: true };
        }
        // only settling itself costs the house gas: the CDP facilitator pays its own, so with it the wallet needs no ETH
        if (config.x402Facilitator === "self" && (await sales.getBalance({ address: c.wallet }).catch(() => 0n)) < 20_000_000_000_000n) {
          void engine.alert("NIGHTSHIFT Services cannot take payments: its wallet has no ETH on Base for the settlement gas.", "nogas-house");
          const reason = "The service cannot take payments right now. Nothing was charged; try again later.";
          refused(reason); return { ok: false, status: 503, reason };
        }
      }
      return { ok: true, payment, payer: v.payer };
    },
    settle(o: Offer, payment: PaymentPayload, terms?: SettleTerms) {
      const c = house();
      // with the terms, the CDP facilitator settles it (and lists the service in the Bazaar); without, the house settles itself
      return engine.settleInTurn(c.id, () => engine.checkout.settle(c.id, c.wallet, o.id, payment, undefined, terms)).catch((e) => {
        // the facilitator was down and the house has no gas to settle itself: nothing moved
        if (e instanceof NoGasError) void engine.alert("NIGHTSHIFT Services could not take a payment: the CDP facilitator was down and its wallet has no ETH on Base to settle itself.", "nogas-house");
        throw e;
      });
    },
    async sim(o: Offer) { await engine.recordSale(house(), o.id, o.priceUsdc, "0xdemo000000000000000000000000000000buyer", null, true); },
    isPending: (e) => e instanceof PendingError,
  };
}

/** The live services: chain.ts's Ethereum client, the public APIs, the house payer, and the house crews. */
export function liveHouseServices(engine: Engine) {
  const house = ensureHouse(engine);
  const ctx = context({ net: liveNet, rpc: liveRpc(eth as never), now: Date.now, etherscanKey: config.etherscanKey, watchtowerUrl: config.watchtowerUrl });
  const mind = engine.mind;
  // Watchtower reads through the same Ethereum and DexScreener doors as the other house services
  const wt: Watchtower = liveWatchtower() ?? new Watchtower({
    ctx, file: join(config.dataDir, "watchtower.json"),
    notify: async (w, r): Promise<boolean> => (w.telegram.chatId && config.telegramToken ? telegram(config.telegramToken, w.telegram.chatId, watchAlert(w, r, `${config.publicUrl}${wt.unsubscribePath(w)}`)) : false),
    onJob: recordWatchJob,
  });
  setLiveWatchtower(wt);
  const plane = engine.plane(house);
  const swarm = new SwarmDesk({
    file: join(config.dataDir, "swarm-desk.json"),
    plane: { ...plane, open: async (a, body, hooks) => { await engine.store.flush(); return plane.open(a, body, hooks); } },
    enabled: () => config.swarmDesk && config.mode === "live" && config.salesChainId === 8453,
    dailyImd: () => config.swarmDeskDailyImd,
    inFlight: () => config.swarmDeskInFlight,
    reservePayer: (payer) => payerClass(payer, house, [...engine.store.companies.values()], false) === "customer",
    health: () => swarmJson("/swarm"),
    skills: () => swarmJson("/skills"),
    importRepo: swarmImportRepo,
    verifiedContract: (chain, address) => swarmVerified(ctx, chain, address),
    price: () => ({ usd: config.imdUsd, at: config.imdUsdAt, pinned: config.imdUsdPinned }),
    funds: async () => {
      const [imd, gas, fee] = await Promise.all([
        eth.readContract({ address: IMD_MAINNET, abi: erc20Abi, functionName: "balanceOf", args: [house.wallet] }),
        eth.getBalance({ address: house.wallet }), eth.getGasPrice(),
      ]);
      return { imd, eth: gas, gasRequired: fee * 120_000n * 2n };
    },
    settled: (payer, nonce) => { const s = engine.store.settlements.get(saleKey(payer, nonce)); return s?.booked && s.hash ? s.hash : null; },
    pending: (payer, nonce) => engine.store.settlements.has(saleKey(payer, nonce)),
    record: recordPaid, alert: (text, topic) => engine.alert(text, topic),
  });
  attachSwarmRefill(engine, swarm, ctx);
  setSwarmDesk(swarm);
  swarm.start();
  return services(ctx, enginePayer(engine), {
    swarm,
    watchtower: wt,
    telegramLink: (code) => (config.telegramBotName ? `https://t.me/${config.telegramBotName}?start=wt_${code}` : null),
    research: mind ? (q) => researchReport({ ask: (x) => mind.ask(x, engine.llm, config.chatModel), search: (x) => mind.search(x, 12) }, q) : undefined,
    buildCheck: (url) => buildCheck(url, {}, "full"),
    record: (o, r) => recordPaid(o, r),
  });
}
