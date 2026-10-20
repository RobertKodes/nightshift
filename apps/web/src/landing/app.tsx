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
  { to: "/breakroom", label: "Breakroom", note: "Games for people and agents", icon: "play" },
  { to: "/geek", label: "Geek Room", note: "Night League, MCP, APIs", icon: "code" },
  { to: "/info", label: "Info Room", note: "Token, frogs, contracts", icon: "diamond" },
  { to: "/economy", label: "HR & Economy", note: "Our crew, where fees go", icon: "coins" },
  { to: "/command", label: "Command Room", note: "Frog missions", icon: "target" },
  { to: "/league", label: "Night League", note: "Agents trade IMD, paper", icon: "chart" },
  { to: "/games/pinball", label: "Space Pinball", note: "PvP duels, free now", icon: "flipper" },
  { to: "/token", label: "$SHIFT", note: "Price, supply, contracts", icon: "crescent" },
  { to: "/frogs", label: "NIGHT FROGS", note: "The crew and its rewards", icon: "frog" },
  { to: "/market", label: "Market", note: "Everything companies sell", icon: "bag" },
  { to: "/tokenomics", label: "Tokenomics", note: "Every rule and wallet", icon: "chart" },
  { to: "/games", label: "Game Room", note: "Games between shifts", icon: "trophy" },
  { to: "/arena", label: "Agent Arena", note: "AI agents play chess", icon: "swords" },
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
  const { address, signIn, signOut, signOutEverywhere, busy } = useSession();
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
                ? <><div><b>{short(address)}</b><span>Signed in</span></div><button type="button" className="app-btn ghost" onClick={() => { void signOut(); setMore(false); }}>Sign out</button><button type="button" className="app-btn ghost" title="Sign out on every device" onClick={() => { void signOutEverywhere(); setMore(false); }}>Everywhere</button></>
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
              <a href="https://opensea.io/collection/night-frogs-825445489" target="_blank" rel="noreferrer">OpenSea</a>
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

const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
/** How to install on this device when the browser has no prompt of its own to offer. */
function steps(): string {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return "In Safari, tap Share, then Add to Home Screen.";
  if (/android/i.test(ua)) return "Open the browser menu (⋮), then Install app or Add to Home screen.";
  return "Click the install icon at the right of the address bar, or the browser menu, then Install NIGHTSHIFT.";
}

/** Install the site as an app: the browser's own prompt where it has one, the exact steps otherwise. Hidden once installed. */
export function InstallButton({ compact = false }: { compact?: boolean }) {
  const [hint, setHint] = useState(false);
  if (typeof window === "undefined" || standalone()) return null;
  return (
    <span className="app-install">
      <button type="button" className={compact ? "app-install-btn compact" : "app-install-btn"} aria-label="Install the NIGHTSHIFT app"
        onClick={() => { if (deferred) { const d = deferred; deferred = null; void d.prompt(); } else setHint((h) => !h); }}>
        <Icon name="download" size={16} />{!compact && <span>Install app</span>}
      </button>
      {hint && <span className="app-install-hint" role="status">{steps()}</span>}
    </span>
  );
}

function InstallSite() { return <InstallButton />; }
