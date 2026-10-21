/**
 * How hard the games and the animated backgrounds may push this device. A wallet app's own browser
 * (MetaMask, Trust, Coinbase, OKX, Phantom, Bitget) is a webview with a fraction of a real
 * browser's graphics budget, and a weak phone is no better: both get "lite", which keeps the
 * layout and the art but drops shadows, glow blur, antialiasing and most particles, and renders at
 * 1× pixels. Other phones are capped at 1.5×. A desktop keeps the full look. `?lite=1` / `?lite=0`
 * forces either for testing.
 */
type Nav = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
type Eth = { isMetaMask?: boolean; isTrust?: boolean; isTrustWallet?: boolean; isCoinbaseWallet?: boolean; isCoinbaseBrowser?: boolean; isOkxWallet?: boolean; isOKExWallet?: boolean; isPhantom?: boolean; isBitKeep?: boolean; isBitget?: boolean };

const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
/** A phone or tablet. */
export const PHONE = /android|iphone|ipad|ipod|mobile/i.test(ua) || (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches && matchMedia("(max-width: 1024px)").matches);
/** The page runs inside a wallet app's browser: by its user agent, or, on a phone, by the injected provider's flags. */
export const WALLET_BROWSER = (() => {
  if (/MetaMaskMobile|Trust(Wallet)?\/|CoinbaseWallet|CoinbaseBrowser|OKApp|OKEx|Phantom|BitKeep|Bitget/i.test(ua)) return true;
  const eth = typeof window === "undefined" ? undefined : (window as unknown as { ethereum?: Eth }).ethereum;
  // a computer with the MetaMask extension also has these flags: only a phone counts
  return Boolean(PHONE && eth && (eth.isMetaMask || eth.isTrust || eth.isTrustWallet || eth.isCoinbaseWallet || eth.isCoinbaseBrowser || eth.isOkxWallet || eth.isOKExWallet || eth.isPhantom || eth.isBitKeep || eth.isBitget));
})();
const nav = (typeof navigator === "undefined" ? {} : navigator) as Nav;
/**
 * Inside Telegram's in-app browser (a link the bot sent opens the site there): a phone browser
 * inside a messenger, so the games always run lite there.
 */
export const TELEGRAM = typeof window !== "undefined" && ("TelegramWebviewProxy" in window || /Telegram-Android/i.test(ua));
/** Few cores, little memory or data saver on. */
export const WEAK = (nav.hardwareConcurrency ?? 8) <= (PHONE ? 4 : 2) || (nav.deviceMemory ?? 8) <= (PHONE ? 3 : 2) || Boolean(nav.connection?.saveData);

const forced = (() => { try { const v = new URLSearchParams(location.search).get("lite"); return v === "1" ? true : v === "0" ? false : null; } catch { return null; } })();
export const LITE = forced ?? (WALLET_BROWSER || WEAK || TELEGRAM);

/** The pixel ratio to render at: 1 in lite, at most 1.5 on a phone, at most `desktop` elsewhere. */
export const pixelRatio = (desktop = 2) => {
  const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return LITE ? 1 : Math.min(dpr, PHONE ? 1.5 : desktop);
};

/** A 2D context without glow blur, the most expensive thing a canvas does on a phone (lite only). */
export function flat<T extends CanvasRenderingContext2D>(g: T): T {
  if (LITE && !Object.prototype.hasOwnProperty.call(g, "shadowBlur")) Object.defineProperty(g, "shadowBlur", { configurable: true, get: () => 0, set: () => {} });
  return g;
}

/** Calls `f` with true when the page is hidden and false when it is back. Returns the unsubscribe. */
export function onHidden(f: (hidden: boolean) => void): () => void {
  const h = () => f(document.hidden);
  document.addEventListener("visibilitychange", h);
  return () => document.removeEventListener("visibilitychange", h);
}

if (typeof document !== "undefined" && LITE) document.documentElement.dataset.lite = "1";
