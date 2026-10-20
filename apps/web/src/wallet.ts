/**
 * Every website page's way to a wallet. The wallet layer itself (Reown AppKit, walletkit.ts) is a
 * separate download, fetched the first time someone signs in, stakes, swaps or buys: a visit that
 * never touches a wallet never loads it. Inside Telegram's Mini App it is never loaded at all.
 */
export type Eip1193 = {
  request(a: { method: string; params?: unknown }): Promise<unknown>;
  on(event: string, f: (...a: never[]) => void): void;
  removeListener(event: string, f: (...a: never[]) => void): void;
};

/**
 * The Telegram Mini App (/tg, or a page Telegram opened as one): Telegram's rules for Mini Apps allow
 * wallets through TON Connect only, so no EVM wallet is offered, connected or linked there.
 */
export function inTelegramApp(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { Telegram?: { WebApp?: { initData?: string } }; TelegramWebviewProxy?: unknown };
  return /^\/tg(\/|$)/.test(location.pathname) || /tgWebApp(Data|Version)=/.test(location.hash) || Boolean(w.Telegram?.WebApp?.initData) || w.TelegramWebviewProxy !== undefined;
}
const notInTelegram = () => { if (inTelegramApp()) throw new Error("Wallets are not available inside Telegram."); };

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
