/**
 * Every website page's way to a wallet. The wallet layer itself (Reown AppKit, walletkit.ts) is a
 * separate download, fetched the first time someone signs in, stakes, swaps or buys: a visit that
 * never touches a wallet never loads it. Inside a Telegram Mini App webview it is never loaded at all.
 */
export type Eip1193 = {
  request(a: { method: string; params?: unknown }): Promise<unknown>;
  on(event: string, f: (...a: never[]) => void): void;
  removeListener(event: string, f: (...a: never[]) => void): void;
};

/**
 * A Telegram Mini App webview (/tg, where the old Mini App was, or a page Telegram opened as one: it
 * carries signed initData): Telegram's rules for Mini Apps allow wallets through TON Connect only, so
 * no EVM wallet is offered there. The games are on the website and its app; Telegram's in-app
 * browser, where the bot's plain links open, is not a Mini App (no initData): the wallet modal works
 * there like in any phone browser.
 */
export function inTelegramApp(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { Telegram?: { WebApp?: { initData?: string } } };
  return /^\/tg(\/|$)/.test(location.pathname) || /tgWebApp(Data|Version)=/.test(location.hash) || Boolean(w.Telegram?.WebApp?.initData);
}
const notInTelegram = () => { if (inTelegramApp()) throw new Error("Wallets are not available inside Telegram's Mini App."); };

/**
 * An app's own browser with no wallet in it (Telegram, Instagram, Facebook, X, TikTok, Line…): wallet
 * apps do not always open from there, so the modal shows the other ways in.
 */
export function inAppBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  return "TelegramWebviewProxy" in window || /Telegram|FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|musical_ly|Snapchat|; wv\)/i.test(ua);
}

/**
 * Back from an email or social sign-in that left the page (inside Telegram, Reown's login returns by
 * redirect with ?result_uri=): the wallet layer loads at once so it can finish that sign-in.
 */
export function returningFromWalletLogin(): boolean {
  try { return new URLSearchParams(location.search).has("result_uri") && Boolean(localStorage.getItem("@appkit/social_provider")); } catch { return false; }
}

const KEY = "ns-wallet";
/** A wallet was connected on this device: the next visit may bring it back without asking. */
export function remember(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* private window */ }
}
const remembered = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const kit = () => import("./walletkit");

/**
 * The connected wallet's provider, after the wallet modal when none is connected: extensions, wallet
 * apps (WalletConnect), a wallet app's own browser, Coinbase's smart wallet. `chain` switches it
 * first (1 Ethereum, 8453 Base). Throws when the person closes the modal without one.
 */
export async function chooseWallet(o: { chain?: number } = {}): Promise<Eip1193> {
  notInTelegram();
  return (await kit()).connect(o);
}

/** The wallet connected on an earlier visit, without asking: null when there is none (the layer is not even loaded then). */
export async function knownWallet(): Promise<Eip1193 | null> {
  if (!remembered() || inTelegramApp()) return null;
  return (await kit()).reconnect().catch(() => null);
}

/** Disconnects the wallet on this device, so the next action asks again (sign-out). */
export async function forgetWallet(): Promise<void> {
  const was = remembered();
  remember(false);
  if (was && !inTelegramApp()) await (await kit()).disconnect().catch(() => {});
}
