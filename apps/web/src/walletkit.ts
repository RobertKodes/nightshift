/**
 * The website's wallet layer, loaded on first use only (sign in, stake, swap, buy…): Reown AppKit
 * with its wagmi adapter. Browser extensions (EIP-6963), wallet apps on a phone (WalletConnect deep
 * links, a QR code and a copyable link as fallbacks), a wallet app's own browser, Coinbase's smart
 * wallet and email or social sign-in (Reown's embedded wallet, for an in-app browser with no wallet)
 * all end in one EIP-1193 provider that every page signs and sends with through viem. Never inside a
 * Telegram Mini App webview, where Telegram allows TON Connect only (wallet.ts refuses before this loads).
 * Loaded on /swap, it also carries AppKit's Solana adapter (Phantom, Solflare, Backpack, WalletConnect),
 * fetched as its own chunk, and Robinhood Chain (4663) among the EVM networks.
 */
import { createAppKit } from "@reown/appkit";
import { type AppKitNetwork, base, baseSepolia, mainnet, robinhood, solana } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { coinbaseWallet } from "@wagmi/connectors";
import { type CreateConnectorFn, getAccount, watchAccount } from "@wagmi/core";
import { fallback, http, numberToHex } from "viem";
import { type Eip1193, inAppBrowser, inTelegramApp, remember } from "./wallet";
import "./walletkit.css";

/** Wallet ids in Reown's catalogue (api.web3modal.org/getWallets), shown first in this order. */
const FEATURED = {
  metamask: "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
  trust: "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0",
  // the id AppKit gives Coinbase's SDK connector (the lazy one below), on phones too
  coinbase: "d0ca99ff52b99abc48743dad0f7fc891e041be73574f7fac4afe5d4bb83845c8",
  rainbow: "1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369",
  okx: "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709",
};

type Cfg = { walletConnect?: string | null; site?: string; salesChainId?: number; social?: boolean };
type Req = { method: string; params?: unknown };
type Kit = {
  modal: ReturnType<typeof createAppKit>;
  config: WagmiAdapter["wagmiConfig"];
  networks: AppKitNetwork[];
  provider: Eip1193;
  /** Solana wallets too (the kit was first loaded on /swap). */
  solana: boolean;
};
/** What the swap page needs from a Solana wallet (AppKit's Solana provider). */
export type SolanaWallet = {
  signTransaction<T>(tx: T): Promise<T>;
  signAndSendTransaction?(tx: unknown, options?: { skipPreflight?: boolean; maxRetries?: number }): Promise<string>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const connected = (k: Kit) => getAccount(k.config).status === "connected";

/**
 * metadata.url, which Reown's Verify API compares with this page and with the domains allowlisted
 * on dashboard.reown.com: the site's own origin (https://getnightshift.tech), its www twin when the
 * page is there, this page on a local test.
 */
function metadataUrl(site: string | undefined, here: Pick<Location, "origin" | "hostname"> = location): string {
  if (/^(localhost|127\.0\.0\.1)$/.test(here.hostname)) return here.origin;
  try { const s = new URL(site ?? ""); return here.hostname === `www.${s.hostname}` ? here.origin : s.origin; } catch { return here.origin; }
}

/**
 * Coinbase's SDK (about 70 kB) only for whoever picks Coinbase, or reconnects with it: until then the
 * connector has no provider and is not authorized, so AppKit lists it without loading anything.
 */
function lazy(fn: CreateConnectorFn): CreateConnectorFn {
  return (config) => {
    const c = fn(config);
    let live = (() => { try { return /coinbaseWalletSDK/.test(`${localStorage.getItem("wagmi.recentConnectorId")}${localStorage.getItem("wagmi.store")}`); } catch { return false; } })();
    return {
      ...c,
      async getProvider(...a: Parameters<typeof c.getProvider>) { return live ? c.getProvider.apply(this, a) : undefined; },
      async isAuthorized() { return live ? c.isAuthorized.call(this) : false; },
      async connect(...a: Parameters<typeof c.connect>) { live = true; return c.connect.apply(this, a); },
    } as typeof c;
  };
}

/**
 * AppKit 1.8.24 never passes `enableBaseAccount: false` on to the adapter, which then adds Base's
 * account SDK (90 kB more, and an inline script our CSP refuses) for everyone. Its third-party
 * connectors are Base Account, Coinbase (ours, lazy, above) and Safe's (only inside the Safe app).
 */
const noThirdParty = () => { (WagmiAdapter.prototype as unknown as { addThirdPartyConnectors: () => Promise<void> }).addThirdPartyConnectors = async () => {}; };

/** The kit takes Solana wallets only where they are used: the first load on /swap. */
const wantsSolana = () => /^\/swap(\/|$)/.test(location.pathname);

async function init(): Promise<Kit> {
  if (inTelegramApp()) throw new Error("Wallets are not available inside Telegram.");
  const cfg: Cfg = await fetch("/api/wallet-config").then((r) => r.json() as Promise<Cfg>).catch(() => { throw new Error("NIGHTSHIFT could not be reached to open your wallets. Check the connection and try again."); });
  const projectId = cfg.walletConnect;
  if (!projectId) throw new Error("Wallet connections are not switched on for this site yet.");
  const url = metadataUrl(cfg.site);
  const social = cfg.social !== false;
  const icon = `${url}/brand/shift-icon-512.png`;
  const withSolana = wantsSolana();
  const evm: AppKitNetwork[] = cfg.salesChainId === 84532 ? [mainnet, base, robinhood, baseSepolia] : [mainnet, base, robinhood];
  const networks: [AppKitNetwork, ...AppKitNetwork[]] = [mainnet, ...evm.slice(1), ...(withSolana ? [solana] : [])];
  noThirdParty();
  pinDashboard();
  const adapter = new WagmiAdapter({
    projectId, networks: evm,
    transports: {
      [mainnet.id]: fallback([http("https://ethereum-rpc.publicnode.com"), http("https://eth.drpc.org")]),
      [base.id]: http("https://mainnet.base.org"),
      [robinhood.id]: http("https://rpc.mainnet.chain.robinhood.com"),
      [baseSepolia.id]: http("https://sepolia.base.org"),
    },
    // Coinbase's smart wallet and app; its telemetry would inject an inline script our CSP refuses
    connectors: [lazy(coinbaseWallet({ version: "4", appName: "NIGHTSHIFT", appLogoUrl: icon, preference: { options: "all", telemetry: false } }))],
  });
  const solanaAdapter = withSolana ? new (await import("@reown/appkit-adapter-solana")).SolanaAdapter() : null;
  const modal = createAppKit({
    adapters: solanaAdapter ? [adapter, solanaAdapter] : [adapter], networks, defaultNetwork: mainnet, projectId,
    metadata: { name: "NIGHTSHIFT", description: "AI companies that run themselves, NIGHT CHESS and Space Pinball, on Ethereum and Base.", url, icons: [icon] },
    featuredWalletIds: Object.values(FEATURED),
    allWallets: "SHOW",
    enableCoinbase: false, // the connector above
    enableBaseAccount: false,
    defaultAccountTypes: { eip155: "eoa" },
    termsConditionsUrl: `${url}/terms`,
    // Email and social sign-in (Reown's embedded wallet, a plain key: our engine checks it like any
    // wallet) unless /setup switched it off: the free plan counts them against 500 active users a
    // month, then pauses the project. Inside an app's browser, with no wallet, they come first, without
    // Google, which refuses its sign-in in embedded browsers (disallowed_useragent); AppKit itself drops
    // the rest a platform refuses (X inside Telegram on Android, Facebook on phones).
    features: {
      email: social, socials: social ? (inAppBrowser() ? ["x", "discord", "apple", "github"] : ["google", "x", "discord", "apple", "github"]) : false, emailShowWallets: true,
      connectMethodsOrder: social && inAppBrowser() ? ["email", "social", "wallet"] : ["wallet", "email", "social"],
      swaps: false, onramp: false, send: false, receive: false, history: false, analytics: false, legalCheckbox: false,
    },
    themeMode: "dark",
    themeVariables: {
      "--w3m-font-family": "\"Space Grotesk\", Inter, system-ui, sans-serif",
      "--w3m-accent": "#b8ff4a",
      "--w3m-border-radius-master": "2px",
      "--w3m-z-index": 2147483000,
    },
  });
  const k: Kit = { modal, config: adapter.wagmiConfig, networks, provider: null as unknown as Eip1193, solana: withSolana };
  k.provider = provider(k);
  await modal.ready().catch(() => {});
  // The dashboard's switches win over `features`. Reown Authentication (SIWX) would ask every wallet
  // for a second signature, to Reown, before ours, and count it against the free plan; swaps,
  // on-ramp and activity are not NIGHTSHIFT's; with /setup's switch off, email and socials would show
  // a login with no wallet behind it (the adapter set its connectors from `features` above).
  modal.updateRemoteFeatures({ ...modal.getRemoteFeatures(), reownAuthentication: false, swaps: false, onramp: false, activity: false, payWithExchange: false, payments: false, emailCapture: false, ...(social ? {} : { email: false, socials: false }) });
  modal.updateOptions({ siwx: undefined });
  // and should Reown's sign-in still be set (a config answer we could not read), it is taken off again
  const watch = setInterval(() => { if (modal.getSIWX()) modal.updateOptions({ siwx: undefined }); }, 500);
  setTimeout(() => clearInterval(watch), 60_000);
  if (inAppBrowser()) inAppTip(modal);
  return k;
}

/** The dashboard switches NIGHTSHIFT never uses: Reown's own sign-in (a second signature before ours), swaps, on-ramp, activity, payments. */
const DASHBOARD_OFF = new Set(["reown_authentication", "swap", "swaps", "onramp", "activity", "fund_from_exchange", "pay_with_exchange", "payments", "event_tracking", "email_capture"]);
/**
 * Reown's dashboard switches arrive from its config API (/appkit/v1/config) while AppKit starts and win
 * over our options; on a slow phone they land after the overrides below, and Reown Authentication then
 * asked every wallet to "Sign In" to Reown before our own sign-in. Its answer is read here first, with
 * those switches off, so the order no longer matters.
 */
function pinDashboard(): void {
  const w = window as Window & { __nsDashboardPinned?: boolean };
  if (w.__nsDashboardPinned) return;
  w.__nsDashboardPinned = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await real(input, init);
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!res.ok || !new URL(href, location.href).pathname.endsWith("/appkit/v1/config")) return res;
    try {
      const body = (await res.clone().json()) as { features?: { id?: string; isEnabled?: boolean }[] };
      for (const f of body.features ?? []) if (f.id && DASHBOARD_OFF.has(f.id)) f.isEnabled = false;
      return new Response(JSON.stringify(body), { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch { return res; }
  };
}

/**
 * Inside an app's browser (the bot's links open in Telegram's) a wallet app does not always open: a
 * line above the modal names the other ways in, with the page's link to open it elsewhere.
 */
function inAppTip(modal: Kit["modal"]): void {
  let tip: HTMLElement | null = null;
  const telegram = /Telegram/i.test(navigator.userAgent) || "TelegramWebviewProxy" in window;
  modal.subscribeState((s) => {
    if (!s.open) { tip?.remove(); tip = null; return; }
    if (tip) return;
    tip = document.createElement("div");
    tip.className = "nsw-tip";
    tip.setAttribute("role", "note");
    const text = document.createElement("p");
    // email sign-in only where it is on: the dashboard can switch it off whatever /setup says
    const email = modal.getRemoteFeatures()?.email ? "Sign in with email, scan" : "Scan";
    text.textContent = `Wallet app not opening from ${telegram ? "Telegram" : "this app"}? ${email} the QR code under Search Wallet, or open this page in Safari or Chrome${telegram ? " (⋯ menu, Open in browser)" : ""}.`;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy page link";
    copy.onclick = () => { void navigator.clipboard?.writeText(location.href).then(() => { copy.textContent = "Link copied"; }, () => { copy.textContent = location.host; }); };
    tip.append(text, copy);
    document.body.append(tip);
  });
}

let kit: Promise<Kit> | null = null;
const load = () => (kit ??= init().catch((e) => { kit = null; throw e; }));

/** A wallet that was connected before comes back on its own: wait for that before asking anything. */
async function settled(k: Kit): Promise<void> {
  for (let i = 0; i < 50 && ["reconnecting", "connecting"].includes(getAccount(k.config).status); i++) await sleep(100);
}

/** The modal, until a wallet is connected or the person closes it. */
function choose(k: Kit): Promise<void> {
  return new Promise((resolve, reject) => {
    let opened = false, done = false;
    const finish = (e?: Error) => {
      if (done) return;
      done = true; offAccount(); offModal();
      if (e) reject(e); else resolve();
    };
    const offAccount = watchAccount(k.config, { onChange: (a) => { if (a.status === "connected") finish(); } });
    const offModal = k.modal.subscribeState((s) => {
      if (s.open) opened = true;
      // closed without a wallet: the person changed their mind (a connection in flight gets a moment to land)
      else if (opened) void sleep(500).then(() => { if (!connected(k) && !k.modal.isOpen()) finish(new Error("No wallet chosen.")); });
    });
    void k.modal.open({ view: "Connect", ...(k.solana ? { namespace: "eip155" as const } : {}) }).catch(() => sleep(500).then(() => { if (!connected(k) && !k.modal.isOpen()) finish(new Error("The wallet did not connect. Try again.")); }));
  });
}

/** The connected wallet on this chain: switched by AppKit, which knows how for each kind of wallet. */
async function onChain(k: Kit, id: number): Promise<void> {
  if (getAccount(k.config).chainId === id) return;
  const net = k.networks.find((n) => Number(n.id) === id);
  if (!net) throw Object.assign(new Error(`Chain ${id} is not one NIGHTSHIFT uses.`), { code: 4902 });
  await k.modal.switchNetwork(net, { throwOnFailure: true });
  for (let i = 0; i < 30 && getAccount(k.config).chainId !== id; i++) await sleep(100);
  if (getAccount(k.config).chainId !== id) throw new Error(`Switch your wallet to ${net.name} first.`);
}

/**
 * The EIP-1193 provider pages sign with: the connected wallet's own, whatever it is, with the
 * account, the chain and chain switches answered by the wallet layer (a WalletConnect session
 * switches through AppKit, not wallet_switchEthereumChain). Batches (EIP-5792), signatures and
 * transactions reach the wallet unchanged.
 */
function provider(k: Kit): Eip1193 {
  const subs = new Map<string, Set<(v: unknown) => void>>();
  const emit = (e: string, v: unknown) => subs.get(e)?.forEach((f) => { try { f(v); } catch { /* a listener's own error */ } });
  watchAccount(k.config, {
    onChange: (a, prev) => {
      if (a.address !== prev.address) emit("accountsChanged", a.address ? [a.address] : []);
      if (a.chainId && a.chainId !== prev.chainId) emit("chainChanged", numberToHex(a.chainId));
      if (a.status === "disconnected" && prev.status === "connected") remember(false);
    },
  });
  const chainOf = (params: unknown) => Number((params as [{ chainId?: string }] | undefined)?.[0]?.chainId);
  return {
    async request({ method, params }: Req) {
      if (method === "eth_accounts") { const a = getAccount(k.config).address; return a ? [a] : []; }
      if (method === "eth_requestAccounts") { if (!connected(k)) await choose(k); return [getAccount(k.config).address]; }
      if (method === "eth_chainId") return numberToHex(getAccount(k.config).chainId ?? 1);
      if (method === "wallet_switchEthereumChain") { await onChain(k, chainOf(params)); return null; }
      if (method === "wallet_addEthereumChain" && k.networks.some((n) => Number(n.id) === chainOf(params))) return null;
      const c = getAccount(k.config).connector;
      if (!c) throw Object.assign(new Error("Connect a wallet first."), { code: 4100 });
      const p = (await c.getProvider()) as { request(r: Req): Promise<unknown> };
      return p.request(params === undefined ? { method } : { method, params });
    },
    on(e, f) { if (!subs.has(e)) subs.set(e, new Set()); subs.get(e)!.add(f as (v: unknown) => void); },
    removeListener(e, f) { subs.get(e)?.delete(f as (v: unknown) => void); },
  };
}

/** The connected wallet (the modal first when there is none), on `chain` when one is asked for. */
export async function connect(o: { chain?: number } = {}): Promise<Eip1193> {
  const k = await load();
  await settled(k);
  if (!connected(k)) await choose(k);
  remember(true); // also a wallet that came back on its own: the next visit may bring it back again
  if (o.chain) await onChain(k, o.chain);
  return k.provider;
}

/** The wallet connected on an earlier visit, without asking: null when there is none. */
export async function reconnect(): Promise<Eip1193 | null> {
  const k = await load();
  await settled(k);
  return connected(k) ? k.provider : null;
}

/** Disconnects the wallet: the next action opens the modal again. */
export async function disconnect(): Promise<void> {
  const k = await load();
  await settled(k);
  if (connected(k)) await k.modal.disconnect().catch(() => {});
}

const solAddress = (k: Kit) => { const a = k.modal.getAccount("solana"); return a?.isConnected && a.address ? a.address : null; };

/** The modal for a Solana wallet, until one is connected or the person closes it. */
function chooseSolana(k: Kit): Promise<void> {
  return new Promise((resolve, reject) => {
    let opened = false, done = false;
    const finish = (e?: Error) => { if (done) return; done = true; offAccount(); offModal(); if (e) reject(e); else resolve(); };
    const offAccount = k.modal.subscribeAccount((a) => { if (a.isConnected && a.address) finish(); }, "solana");
    const offModal = k.modal.subscribeState((s) => {
      if (s.open) opened = true;
      else if (opened) void sleep(500).then(() => { if (!solAddress(k) && !k.modal.isOpen()) finish(new Error("No Solana wallet chosen.")); });
    });
    void k.modal.open({ view: "Connect", namespace: "solana" }).catch(() => finish(new Error("The Solana wallet did not connect. Try again.")));
  });
}

/** The connected Solana wallet (the modal first when there is none): its address and the provider that signs. */
export async function connectSolana(o: { ask?: boolean } = {}): Promise<{ address: string; wallet: SolanaWallet } | null> {
  const k = await load();
  if (!k.solana) throw new Error("Solana wallets load with the swap page: reload this page to connect one.");
  await settled(k);
  for (let i = 0; i < 20 && !solAddress(k) && k.modal.getAccount("solana")?.status === "reconnecting"; i++) await sleep(100);
  if (!solAddress(k)) { if (o.ask === false) return null; await chooseSolana(k); }
  const address = solAddress(k), wallet = k.modal.getProvider<SolanaWallet>("solana");
  if (!address || !wallet) throw new Error("The Solana wallet did not connect. Try again.");
  remember(true);
  return { address, wallet };
}
