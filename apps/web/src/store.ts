/**
 * The Play Store app: the site in a Trusted Web Activity, opened at /?app=android. Google Play's
 * rules for blockchain apps leave out what moves money from inside an app: staked games and bets
 * (real-money gaming), swaps and buy buttons (crypto trading), paid products and launches (digital
 * goods outside Play billing). In the app those parts say where they are on the website instead;
 * everything else (NIGHT SNIPER, free games, the ship, the league, the rooms) is the same.
 */
export const ANDROID_PACKAGE = "tech.getnightshift.app";
const KEY = "ns-store";

function detect(): boolean {
  if (typeof window === "undefined") return false;
  const fromApp = document.referrer.startsWith(`android-app://${ANDROID_PACKAGE}`);
  try {
    if (new URLSearchParams(location.search).get("app") === "android" || fromApp) sessionStorage.setItem(KEY, "play");
    return sessionStorage.getItem(KEY) === "play";
  } catch { return fromApp; }
}
/** Running inside the Play Store app (for this visit). */
export const inStoreApp = detect();

/** First path segments that open on the website instead of inside the app. */
const WEB_ONLY = new Set(["swap", "stake", "staking", "launchpad", "launch", "forge", "watch", "my", "setup", "market", "c", "co", "companies"]);
export const webOnly = (path: string) => inStoreApp && WEB_ONLY.has(path.split("/").filter(Boolean)[0] ?? "");

/** The same page in Chrome, outside the app (an intent link on Android; a plain link elsewhere). */
export function onTheWeb(path: string): string {
  const url = `https://getnightshift.tech${path.startsWith("/") ? path : `/${path}`}`;
  // in Chrome by name: a plain https link to this site would open the app again (its verified links)
  return /android/i.test(navigator.userAgent) ? `intent://${url.slice(8)}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end` : url;
}
