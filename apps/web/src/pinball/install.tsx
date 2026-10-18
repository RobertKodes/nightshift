import { useEffect, useState } from "react";
import { Icon } from "../Icon";

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Only the game is an app: its manifest, icons and offline worker are added on this page alone. */
export function useGameApp(): void {
  useEffect(() => {
    const add = (tag: string, attrs: Record<string, string>) => {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      el.dataset.pinballApp = "1";
      document.head.append(el);
    };
    add("link", { rel: "manifest", href: "/games/pinball/app/manifest.webmanifest" });
    add("link", { rel: "apple-touch-icon", href: "/games/pinball/app/apple-touch-icon.png" });
    add("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
    add("meta", { name: "mobile-web-app-capable", content: "yes" });
    add("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" });
    add("meta", { name: "apple-mobile-web-app-title", content: "Space Pinball" });
    add("meta", { name: "theme-color", content: "#03020a" });
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/games/pinball-sw.js", { scope: "/games/pinball" }).catch(() => {});
    return () => { for (const el of document.head.querySelectorAll("[data-pinball-app]")) el.remove(); };
  }, []);
}

const standalone = () => typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || (navigator as { standalone?: boolean }).standalone === true);
const ios = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

/** "Install app": the browser's own prompt where there is one, the Add to Home Screen steps on iPhone. */
export function InstallButton() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [hint, setHint] = useState(false);
  const [installed, setInstalled] = useState(standalone);
  useEffect(() => {
    const ready = (e: Event) => { e.preventDefault(); setPrompt(e as Prompt); };
    const done = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("beforeinstallprompt", ready); window.removeEventListener("appinstalled", done); };
  }, []);
  if (installed || (!prompt && !ios())) return null;
  return (
    <>
      <button type="button" className="arc-install" onClick={() => { if (prompt) { void prompt.prompt(); void prompt.userChoice.then(() => setPrompt(null)); } else setHint(true); }}>
        <Icon name="play" size={14} /><span>Install app</span>
      </button>
      {hint && (
        <div className="arc-install-hint" role="dialog" aria-label="Install Space Pinball" onClick={() => setHint(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <b>Install Space Pinball</b>
            <p>Tap <span className="share" aria-hidden="true">⎋</span> <b>Share</b> in Safari, then <b>Add to Home Screen</b>. The game opens full screen, like an app.</p>
            <p className="dim">To sign in from the app, choose <b>WalletConnect · phone wallet</b> and approve in your wallet app.</p>
            <button type="button" className="arc-btn ghost" onClick={() => setHint(false)}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}
