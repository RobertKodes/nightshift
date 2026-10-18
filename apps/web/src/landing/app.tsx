import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import { go } from "../router";
import { useSession } from "../session";
import type { Active } from "./chrome";

const X_URL = "https://x.com/nightshiftimd";
const TELEGRAM_URL = "https://t.me/getnightshift";

/** The four tabs people use most; everything else lives under More. */
const TABS: { to: string; label: string; icon: string; on: Active[] }[] = [
  { to: "/", label: "Home", icon: "home", on: ["home"] },
  { to: "/companies", label: "Companies", icon: "briefcase", on: ["companies", "company", "market"] },
  { to: "/swap", label: "Trade", icon: "swap", on: ["swap", "token", "tokenomics"] },
  { to: "/stake", label: "Earn", icon: "layers", on: ["stake", "frogs"] },
];

/** Everything else, as app tiles. */
const MORE: { to: string; label: string; note: string; icon: string }[] = [
  { to: "/games/pinball", label: "Space Pinball", note: "PvP duels, free now", icon: "flipper" },
  { to: "/token", label: "$SHIFT", note: "Price, supply, contracts", icon: "crescent" },
  { to: "/frogs", label: "NIGHT FROGS", note: "The crew and its rewards", icon: "frog" },
  { to: "/market", label: "Market", note: "Everything companies sell", icon: "bag" },
  { to: "/tokenomics", label: "Tokenomics", note: "Every rule and wallet", icon: "chart" },
  { to: "/games", label: "Game Room", note: "Games between shifts", icon: "trophy" },
  { to: "/launchpad", label: "Launchpad", note: "Launch with the IMD swarm", icon: "rocket" },
  { to: "/impact", label: "IMD Impact", note: "What we give IMD", icon: "flame" },
  { to: "/guide", label: "Guide", note: "Your first company", icon: "book" },
  { to: "/mcp", label: "MCP", note: "For AI agents", icon: "code" },
  { to: "/terms", label: "Terms", note: "Risks, in plain words", icon: "file" },
];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The phone app: a tab bar at the bottom and a More sheet. Hidden on wide screens by CSS. */
export function AppTabs({ active }: { active: Active }) {
  const [more, setMore] = useState(false);
  const { address, signIn, signOut, busy } = useSession();
  useEffect(() => { document.body.classList.toggle("app-sheet-open", more); return () => document.body.classList.remove("app-sheet-open"); }, [more]);
  useEffect(() => { if (!more) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setMore(false); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [more]);
  const open = (to: string) => { setMore(false); go(to); scrollTo(0, 0); };
  const inMore = !TABS.some((t) => t.on.includes(active));
  return (
    <>
      <nav className="app-tabs" aria-label="App">
        {TABS.map((t) => {
          const on = !more && t.on.includes(active);
          return (
            <a key={t.to} href={t.to} className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={(e) => { e.preventDefault(); open(t.to); }}>
              <Icon name={t.icon} size={22} /><span>{t.label}</span>
            </a>
          );
        })}
        <button type="button" className={more || inMore ? "on" : ""} aria-expanded={more} onClick={() => setMore(!more)}>
          <Icon name="grid" size={22} /><span>More</span>
        </button>
      </nav>
      {more && createPortal(
        <div className="app-sheet" role="dialog" aria-modal="true" aria-label="More" onClick={() => setMore(false)}>
          <div className="app-sheet-body" onClick={(e) => e.stopPropagation()}>
            <i className="app-grip" aria-hidden="true" />
            <div className="app-acct">
              <Icon name="wallet" size={20} />
              {address
                ? <><div><b>{short(address)}</b><span>Signed in</span></div><button type="button" className="app-btn ghost" onClick={() => { void signOut(); setMore(false); }}>Sign out</button></>
                : <><div><b>Your wallet</b><span>Sign in to run companies and stake</span></div><button type="button" className="app-btn" disabled={busy} onClick={() => { setMore(false); void signIn(); }}>{busy ? "Check wallet…" : "Sign in"}</button></>}
            </div>
            <a className="app-launch" href="/launch" onClick={(e) => { e.preventDefault(); open("/launch"); }}>
              <Icon name="rocket" size={20} /><div><b>Launch a company</b><span>One sentence, a budget, and it starts working</span></div><Icon name="arrow" size={18} />
            </a>
            <div className="app-grid">
              {MORE.map((m) => (
                <a key={m.to} href={m.to} className={m.to === `/${active}` ? "on" : ""} onClick={(e) => { e.preventDefault(); if (m.to === "/games/pinball") { location.href = m.to; return; } open(m.to); }}>
                  <Icon name={m.icon} size={22} /><b>{m.label}</b><span>{m.note}</span>
                </a>
              ))}
            </div>
            <div className="app-social">
              <a href={X_URL} target="_blank" rel="noreferrer">X</a>
              <a href={TELEGRAM_URL} target="_blank" rel="noreferrer">Telegram</a>
              <InstallSite />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: Prompt | null = null;
if (typeof window !== "undefined") addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as Prompt; });

/** Install the site as an app: the browser's prompt, or the iPhone steps. */
function InstallSite() {
  const [hint, setHint] = useState(false);
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!deferred && !ios) return null;
  return hint
    ? <span className="app-hint">In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>.</span>
    : <button type="button" onClick={() => { if (deferred) { void deferred.prompt(); deferred = null; } else setHint(true); }}><Icon name="download" size={16} /> Install app</button>;
}
