import { useEffect, useState } from "react";
import { Icon } from "./Icon";

/**
 * /tg, where the Telegram Mini App was. The games moved to the website and its installable app
 * (Telegram's Bot Developer Terms allow only TON inside a Mini App, and the games use other tokens):
 * the bot links there. Outside Telegram this page sends the visitor to the same place on the site.
 * Inside a Mini App webview (Telegram hands it signed initData) it only says the Game Room moved,
 * with no links out, and a button that closes it.
 */
type WebApp = { initData: string; ready(): void; close(): void };
const webApp = () => (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp ?? null;

/** The script is in the page's head when the server serves /tg; the dev server and old caches get it here. */
function loadTelegram(): Promise<WebApp | null> {
  if (webApp()) return Promise.resolve(webApp());
  return new Promise((resolve) => {
    const s = document.createElement("script");
    const done = () => resolve(webApp());
    s.src = "/tg/telegram-web-app.js";
    s.onload = done; s.onerror = done;
    setTimeout(done, 3_000);
    document.head.appendChild(s);
  });
}

const GAMES = ["chess", "pinball", "pool"];
const ID = /^[a-f0-9]{6,40}$/;
/** The site's page for an old /tg link: a watched game, the live list, one game, else the Game Room. */
export function siteFor(path: string, search: string): string {
  const seg = path.split("/").filter(Boolean).slice(1), s = new URLSearchParams(search).get("s") ?? "";
  if (seg[0] === "watch" && GAMES.includes(seg[1] ?? "") && ID.test(seg[2] ?? "")) return `/games/${seg[1]}?watch=${seg[2]}`;
  if (seg[0] === "live" || seg[0] === "watch") return "/games/live";
  if (GAMES.includes(seg[0] ?? "")) return `/games/${seg[0]}`;
  // ?s=<start parameter>, from the old Mini App buttons
  const w = /^watch_(chess|pinball|pool)_([a-f0-9]{6,40})$/.exec(s);
  if (w) return `/games/${w[1]}?watch=${w[2]}`;
  if (s === "live" || s.startsWith("watch_")) return "/games/live";
  const g = /^(chess|pinball|pool)(?:_|$)/.exec(s);
  return g ? `/games/${g[1]}` : "/games";
}

export function TgMoved() {
  const [inside, setInside] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadTelegram().then((w) => {
      if (!alive) return;
      if (w?.initData) { try { w.ready(); } catch { /* an old Telegram app */ } setInside(true); }
      else location.replace(siteFor(location.pathname, location.search));
    });
    return () => { alive = false; };
  }, []);
  if (!inside) return <div style={{ minHeight: "100dvh", background: "#03020a" }} />;
  return <main style={{ minHeight: "100dvh", background: "#03020a", color: "#ece9ff", display: "grid", placeItems: "center", padding: "32px 20px", boxSizing: "border-box", textAlign: "center" }}>
    <div style={{ maxWidth: 420, display: "grid", gap: 18, justifyItems: "center" }}>
      <span style={{ color: "#b9a7ff" }}><Icon name="frog" size={44} /></span>
      <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.25, fontWeight: 700 }}>The NIGHTSHIFT Game Room has moved to the website and app.</h1>
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#b8b3d6" }}>Open it from the bot's Play button.</p>
      <button type="button" onClick={() => { try { webApp()?.close(); } catch { /* not inside Telegram any more */ } }} style={{ marginTop: 6, minWidth: 180, padding: "14px 28px", borderRadius: 12, border: "1px solid #6d5cff", background: "#6d5cff", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>Close</button>
    </div>
  </main>;
}
