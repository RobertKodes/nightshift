/**
 * The Telegram side of the Mini App: Telegram's WebApp object (telegram-web-app.js, served from
 * our own origin at /tg/telegram-web-app.js, see public/tg/NOTICE.txt), typed to what we use, and
 * the native pieces around the page: theme, header and bottom bar colours, safe areas, the back
 * button, haptics, fullscreen, links. Every call is guarded by the version Telegram reports, so an
 * older app degrades quietly instead of throwing; outside Telegram all of it is a no-op.
 */
type Inset = { top: number; bottom: number; left: number; right: number };
type Back = { isVisible: boolean; show(): void; hide(): void; onClick(f: () => void): void; offClick(f: () => void): void };
type Haptic = { impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void; notificationOccurred(type: "error" | "success" | "warning"): void; selectionChanged(): void };
export type WebApp = {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string; last_name?: string; photo_url?: string }; start_param?: string };
  version: string; platform: string; colorScheme: "light" | "dark";
  themeParams: Partial<Record<"bg_color" | "text_color" | "hint_color" | "link_color" | "button_color" | "button_text_color" | "secondary_bg_color" | "header_bg_color" | "bottom_bar_bg_color" | "accent_text_color" | "section_bg_color" | "destructive_text_color", string>>;
  isExpanded: boolean; viewportHeight: number; viewportStableHeight: number; isFullscreen?: boolean;
  safeAreaInset?: Inset; contentSafeAreaInset?: Inset;
  BackButton: Back; HapticFeedback: Haptic;
  isVersionAtLeast(v: string): boolean;
  ready(): void; expand(): void; close(): void;
  requestFullscreen?(): void; exitFullscreen?(): void;
  setHeaderColor(c: string): void; setBackgroundColor(c: string): void; setBottomBarColor?(c: string): void;
  enableClosingConfirmation(): void; disableClosingConfirmation(): void;
  enableVerticalSwipes?(): void; disableVerticalSwipes?(): void;
  onEvent(event: string, f: (...a: unknown[]) => void): void; offEvent(event: string, f: (...a: unknown[]) => void): void;
  openLink(url: string): void; openTelegramLink(url: string): void;
  switchInlineQuery?(query: string, chooseChatTypes?: string[]): void;
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
};

export const webApp = (): WebApp | null => (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp ?? null;
/** Opened by Telegram: the WebApp object carries signed initData (a plain browser that loaded the script has none). */
export const inTelegram = () => !!webApp()?.initData;
const at = (v: string) => { try { return !!webApp()?.isVersionAtLeast(v); } catch { return false; } };

/** The script is in the page's head when the server served /tg; the dev server and old caches get it here. */
export function loadTelegram(): Promise<WebApp | null> {
  if (webApp()) return Promise.resolve(webApp());
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "/tg/telegram-web-app.js";
    s.onload = () => resolve(webApp());
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

/** Our palette, by Telegram's colour scheme: the night look in dark, the moonlight look in light. */
export const PALETTE = { dark: { bg: "#03020a", bar: "#07061a" }, light: { bg: "#f5f3ff", bar: "#ebe7ff" } } as const;

/** Telegram's theme, colours and insets on <html> (data-tg-scheme, --tgs-*), kept current as they change. */
export function syncTheme(): () => void {
  const w = webApp(), root = document.documentElement;
  if (!w) return () => {};
  const apply = () => {
    const scheme = w.colorScheme === "light" ? "light" : "dark", p = PALETTE[scheme];
    root.dataset.tgScheme = scheme;
    const tp = w.themeParams ?? {};
    if (tp.destructive_text_color) root.style.setProperty("--tgs-danger", tp.destructive_text_color);
    if (tp.hint_color) root.style.setProperty("--tgs-hint", tp.hint_color);
    try { if (at("6.1")) { w.setHeaderColor(p.bg); w.setBackgroundColor(p.bg); } if (at("7.10")) w.setBottomBarColor?.(p.bar); } catch { /* colours are cosmetic */ }
  };
  const insets = () => {
    const sa = w.safeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 }, ca = w.contentSafeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 };
    // in fullscreen Telegram's own buttons float over the top of the page: content starts below both
    root.style.setProperty("--tgs-top", `${(sa.top ?? 0) + (ca.top ?? 0)}px`);
    root.style.setProperty("--tgs-bottom", `${(sa.bottom ?? 0) + (ca.bottom ?? 0)}px`);
    root.style.setProperty("--tgs-left", `${Math.max(sa.left ?? 0, ca.left ?? 0)}px`);
    root.style.setProperty("--tgs-right", `${Math.max(sa.right ?? 0, ca.right ?? 0)}px`);
    root.style.setProperty("--tgs-vh", `${w.viewportStableHeight || window.innerHeight}px`);
    root.dataset.tgFullscreen = w.isFullscreen ? "1" : "0";
  };
  apply(); insets();
  const events = ["safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged", "viewportChanged"];
  w.onEvent("themeChanged", apply);
  for (const e of events) w.onEvent(e, insets);
  return () => { w.offEvent("themeChanged", apply); for (const e of events) w.offEvent(e, insets); };
}

/** Ready, full height, and no swipe-to-close while a finger is on the board. */
export function bootTelegram(): void {
  const w = webApp();
  if (!w) return;
  try { w.ready(); w.expand(); } catch { /* an old client */ }
}
export const canFullscreen = () => at("8.0") && typeof webApp()?.requestFullscreen === "function";
export function toggleFullscreen(): void {
  const w = webApp();
  if (!w || !canFullscreen()) return;
  try { if (w.isFullscreen) w.exitFullscreen?.(); else w.requestFullscreen?.(); } catch { /* refused by the client */ }
}
/** During a game a vertical swipe moves pieces, not the Mini App; and closing it asks first. */
export function gameMode(on: boolean): void {
  const w = webApp();
  if (!w) return;
  try {
    if (at("7.7")) { if (on) w.disableVerticalSwipes?.(); else w.enableVerticalSwipes?.(); }
    if (at("6.2")) { if (on) w.enableClosingConfirmation(); else w.disableClosingConfirmation(); }
  } catch { /* optional */ }
}

/** One back handler at a time: shown while set, hidden when cleared. */
let backFn: (() => void) | null = null;
const onBack = () => backFn?.();
export function setBack(f: (() => void) | null): void {
  const w = webApp();
  backFn = f;
  if (!w || !at("6.1")) return;
  try { w.BackButton.offClick(onBack); if (f) { w.BackButton.onClick(onBack); w.BackButton.show(); } else w.BackButton.hide(); } catch { /* optional */ }
}

/** Haptics, named for what happened. */
const hf = () => (at("6.1") ? webApp()?.HapticFeedback ?? null : null);
export const haptic = {
  tap: () => { try { hf()?.impactOccurred("light"); } catch { /* optional */ } },
  select: () => { try { hf()?.selectionChanged(); } catch { /* optional */ } },
  move: (capture = false) => { try { hf()?.impactOccurred(capture ? "medium" : "light"); } catch { /* optional */ } },
  start: () => { try { hf()?.impactOccurred("heavy"); } catch { /* optional */ } },
  check: () => { try { hf()?.notificationOccurred("warning"); } catch { /* optional */ } },
  win: () => { try { hf()?.notificationOccurred("success"); } catch { /* optional */ } },
  lose: () => { try { hf()?.notificationOccurred("error"); } catch { /* optional */ } },
  error: () => { try { hf()?.notificationOccurred("error"); } catch { /* optional */ } },
};

/** The deep link the Mini App was opened with: Telegram's start_param (t.me links), else ?s= (our web_app buttons). */
export function startParam(): string | null {
  const w = webApp();
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, "")).get("tgWebAppStartParam");
  return w?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get("tgWebAppStartParam") || fromHash || new URLSearchParams(location.search).get("s") || null;
}

/** A t.me link inside Telegram; any other link in the browser. Both keep the Mini App open. */
export function openLink(url: string): void {
  const w = webApp();
  try {
    if (w && /^https:\/\/t\.me\//.test(url) && at("6.1")) { w.openTelegramLink(url); return; }
    if (w) { w.openLink(url); return; }
  } catch { /* fall back */ }
  window.open(url, "_blank", "noopener");
}
/** "Send to a chat": Telegram's chat picker with "@bot <query>" typed in; false where the client cannot. */
export function shareInline(query: string): boolean {
  const w = webApp();
  if (!w || !at("6.7") || typeof w.switchInlineQuery !== "function") return false;
  try { w.switchInlineQuery(query, ["users", "groups", "supergroups"]); return true; } catch { return false; }
}
/** A native confirm in Telegram, the browser's elsewhere. */
export function confirmAsk(message: string): Promise<boolean> {
  const w = webApp();
  if (w && at("6.2") && w.showConfirm) return new Promise((r) => { try { w.showConfirm!(message, r); } catch { r(window.confirm(message)); } });
  return Promise.resolve(window.confirm(message));
}
