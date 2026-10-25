import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InstallButton } from "../landing/app";
import { Link, go } from "../router";
import { useSession } from "../session";
import { inStoreApp } from "../store";
import "./sniper.css";

/**
 * NIGHT SNIPER as an app: every new IMD launch on Ethereum with its verdict at launch, its hook,
 * its launcher's record, and how it moved since the call; NFT launches as they mint out. Laid out
 * the way iOS lays out an app (Human Interface Guidelines): a large title that folds into the
 * navigation bar, a segmented control, inset grouped lists, a sheet for each call, a tab bar, system
 * type and colours in light and dark. Holders (a NIGHT FROG, or $SHIFT above the holder line) see a
 * call the moment it is made; everyone else when the community chat does.
 */
type Verdict = "safe" | "caution" | "avoid" | "unchecked";
type Impact = "avoid" | "caution" | "note" | "good";
type History = { launch: number; kind: string; token: string | null; at: string; called: { verdict: Verdict; peak: number | null; dumped: boolean } | null }[];
type Call = {
  type: "token" | "nft"; launch: number; token: string; symbol: string | null; name: string | null; kind: string; at: number;
  verdict: Verdict; summary: string; reasons: { impact: Impact; text: string }[];
  quote: string | null; multiple: number | null; peak: number | null; mcapAtCall: number | null; mcapNow: number | null; dumped: boolean;
  hook: { address: string; template: string | null; risk: "low" | "medium" | "high"; summary: string; powers: { text: string; level: string }[]; swapFee: string; hookFee: string } | null;
  nft: { standard: string; maxSupply: number | null; minted: number | null; price: { amount: number; unit: string } | null; owner: string | null } | null;
  launcher: { address: string; keepsPct: number | null; history: History } | null;
  links: { uniswap: string | null; chart: string | null; opensea: string | null; etherscan: string; repo: string | null };
};
type LauncherRow = { address: string; launches: number; called: number; best: number | null; dumped: number; avoid: number; last: number };
type Feed = {
  live: boolean; holder: boolean; delayMinutes: number; hidden: number; calls: Call[]; launchers: LauncherRow[]; indexed: number;
  stats: { calls: number; nfts: number; safe: number; caution: number; avoid: number; best: { symbol: string | null; launch: number; peak: number; verdict: Verdict } | null; avoidDumped: number };
};
type DexRow = {
  launch: number; token: string; symbol: string | null; name: string | null; kind: string; at: string; quote: string | null;
  mcapNow: number | null; mcap0: number | null; sinceLaunch: number | null; change24: number | null; liquidityUsd: number | null; onDexScreener: boolean;
  verdict: { verdict: Verdict; summary: string; reasons: { impact: Impact; text: string }[]; at: number } | null; launcher: string | null; keepsPct: number | null;
  links: { uniswap: string | null; chart: string; dexscreener: string | null; repo: string | null };
};
type DexNft = { launch: number; contract: string; name: string | null; symbol: string | null; standard: string; minted: number | null; maxSupply: number | null; price: { amount: number; unit: string } | null; owner: string | null; launcher: string | null; at: string; repo: string | null };
type DexFeed = { live: boolean; count: number; tokens: DexRow[]; nfts: DexNft[]; verdicts: number };
type DexSort = "mcap" | "new" | "move" | "safe";
type Tab = "calls" | "dex" | "nfts" | "launchers" | "alerts";

/** Problems first, then what passed, then plain notes. */
const ORDER: Impact[] = ["avoid", "caution", "good", "note"];
const LABEL: Record<Verdict, string> = { safe: "No flags", caution: "Caution", avoid: "Avoid", unchecked: "Unchecked" };
const money = (n: number | null) => n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`;
const times = (m: number | null) => m == null ? "—" : `${m >= 10 ? Math.round(m) : m.toFixed(2)}×`;
const ago = (t: number) => { const m = Math.max(0, Math.round((Date.now() - t) / 60_000)); return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const tick = () => { try { navigator.vibrate?.(8); } catch { /* no haptics here */ } };
const initials = (c: Call) => (c.symbol ?? c.name ?? "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
/** A wallet's own colours, from its address: the same wallet always looks the same. */
const hue = (a: string) => parseInt(a.slice(2, 8), 16) % 360;

function useFeed(): [Feed | null, () => void] {
  const [d, setD] = useState<Feed | null>(null);
  const load = useCallback(() => { fetch("/api/sniper", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((x) => x && setD(x)).catch(() => {}); }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    const v = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [load]);
  return [d, load];
}

function useDex(sort: DexSort, q: string): DexFeed | null {
  const [d, setD] = useState<DexFeed | null>(null);
  useEffect(() => {
    let off = false;
    const load = () => fetch(`/api/sniper/dex?sort=${sort}&q=${encodeURIComponent(q)}`, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((x) => { if (x && !off) setD(x); }).catch(() => {});
    const t = setTimeout(load, q ? 250 : 0), i = setInterval(load, 60_000);
    return () => { off = true; clearTimeout(t); clearInterval(i); };
  }, [sort, q]);
  return d;
}

/** A dex row or a collection, in the shape the sheet shows a call in. */
const dexCall = (r: DexRow): Call => ({
  type: "token", launch: r.launch, token: r.token, symbol: r.symbol, name: r.name, kind: r.kind, at: Date.parse(r.at),
  verdict: r.verdict?.verdict ?? "unchecked", summary: r.verdict?.summary ?? "Not checked yet: the checks run on every IMD token, a few each minute.", reasons: r.verdict?.reasons ?? [],
  quote: r.quote, multiple: r.sinceLaunch, peak: r.change24, mcapAtCall: r.mcap0, mcapNow: r.mcapNow, dumped: false, hook: null, nft: null,
  launcher: r.launcher ? { address: r.launcher, keepsPct: r.keepsPct, history: [] } : null,
  links: { uniswap: r.links.uniswap, chart: r.links.chart, opensea: null, etherscan: `https://etherscan.io/token/${r.token}`, repo: r.links.repo },
});
const nftCall = (n: DexNft): Call => ({
  type: "nft", launch: n.launch, token: n.contract, symbol: n.symbol, name: n.name, kind: "evm_contracts", at: Date.parse(n.at), verdict: "unchecked", summary: "", reasons: [],
  quote: null, multiple: null, peak: null, mcapAtCall: null, mcapNow: null, dumped: false, hook: null,
  nft: { standard: n.standard, maxSupply: n.maxSupply, minted: n.minted, price: n.price, owner: n.owner },
  launcher: n.launcher ? { address: n.launcher, keepsPct: null, history: [] } : null,
  links: { uniswap: null, chart: null, opensea: `https://opensea.io/assets/ethereum/${n.contract}`, etherscan: `https://etherscan.io/address/${n.contract}`, repo: n.repo },
});
const pct = (x: number | null) => (x == null ? "" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(x > -0.1 && x < 0.1 ? 1 : 0)}%`);

// ---- notifications (web push from the installed site)
type PushState = "unsupported" | "ios-install" | "off" | "on" | "denied" | "busy";
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
function b64(key: string): Uint8Array {
  const s = atob((key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}
const post = (path: string, body: unknown) => fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
function usePush(): [PushState, (on: boolean) => Promise<void>] {
  const [s, setS] = useState<PushState>("busy");
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setS(isIos() && !standalone() ? "ios-install" : "unsupported"); return; }
    if (Notification.permission === "denied") { setS("denied"); return; }
    void registration().then((r) => r.pushManager.getSubscription()).then(async (sub) => {
      if (!sub) return setS("off");
      const r = await post("/api/push/status", { subscription: sub.toJSON() }).then((x) => x.json()).catch(() => null);
      setS(r?.subscribed ? "on" : "off");
    }).catch(() => setS("off"));
  }, []);
  const set = async (on: boolean) => {
    setS("busy");
    try {
      if (on) {
        if (await Notification.requestPermission() !== "granted") { setS("denied"); return; }
        const reg = await registration();
        const { key } = await fetch("/api/push/key").then((r) => r.json());
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) as BufferSource }));
        setS((await post("/api/push/subscribe", { subscription: sub.toJSON(), topics: ["sniper"] })).ok ? "on" : "off");
      } else {
        const sub = await (await registration()).pushManager.getSubscription().catch(() => null);
        if (sub) { await post("/api/push/unsubscribe", { subscription: sub.toJSON() }).catch(() => {}); await sub.unsubscribe().catch(() => false); }
        setS("off");
      }
    } catch { setS("off"); }
  };
  return [s, set];
}

// ---- iOS parts
function Glyph({ name }: { name: "scope" | "photo" | "people" | "bell" | "chevron" | "back" | "copy" | "ext" | "search" | "dex" }) {
  const p: Record<string, React.ReactNode> = {
    scope: <><circle cx="12" cy="12" r="7.5" /><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
    photo: <><rect x="3.5" y="5" width="17" height="14" rx="3" /><circle cx="9" cy="10" r="1.8" /><path d="m4.5 17 4.8-4.6 3.4 3.2 2.6-2.4 4.2 3.8" /></>,
    people: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.6-3.3 2.7-5 5.5-5s4.9 1.7 5.5 5" /><circle cx="16.8" cy="9.5" r="2.5" /><path d="M16 14.2c2.4.1 4 1.6 4.5 4.3" /></>,
    bell: <><path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.8H5z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
    chevron: <path d="m9.5 6 6 6-6 6" />,
    search: <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></>,
    dex: <><rect x="4" y="4" width="7" height="7" rx="1.8" /><rect x="13" y="4" width="7" height="7" rx="1.8" /><rect x="4" y="13" width="7" height="7" rx="1.8" /><rect x="13" y="13" width="7" height="7" rx="1.8" /></>,
    back: <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
    copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>,
    ext: <><path d="M14 4.5h5.5V10M19.5 4.5 11 13" /><path d="M17.5 14v3.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2H10" /></>,
  };
  return <svg className="ios-g" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p[name]}</svg>;
}

function Pill({ v }: { v: Verdict }) { return <span className={`ios-pill v-${v}`}>{LABEL[v]}</span>; }

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const i = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div className="ios-seg" role="tablist" aria-label={label} style={{ "--n": options.length, "--i": i } as React.CSSProperties}>
      <span className="ios-seg-thumb" aria-hidden="true" />
      {options.map((o) => <button key={o.id} role="tab" type="button" aria-selected={o.id === value} onClick={() => { tick(); onChange(o.id); }}>{o.label}</button>)}
    </div>
  );
}

function Switch({ on, busy, onChange, label }: { on: boolean; busy?: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} className={`ios-switch${on ? " on" : ""}`} onClick={() => { tick(); onChange(!on); }}><i /></button>;
}

function Avatar({ c }: { c: Call }) {
  return <span className={`ios-av v-${c.type === "nft" ? "nft" : c.verdict}`} aria-hidden="true">{c.type === "nft" ? <Glyph name="photo" /> : initials(c)}</span>;
}
function WalletAvatar({ a }: { a: string }) {
  const h = hue(a);
  return <span className="ios-av w" aria-hidden="true" style={{ background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 70) % 360} 70% 45%))` }}>{a.slice(2, 4).toUpperCase()}</span>;
}

/** A cell of an inset grouped list: a button (opens something), a link out, or a plain row. */
function Cell({ lead, title, sub, trail, onClick, href }: { lead?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; trail?: React.ReactNode; onClick?: () => void; href?: string }) {
  const body = <>{lead}<span className="ios-cell-mid"><span className="ios-cell-t">{title}</span>{sub && <span className="ios-cell-s">{sub}</span>}</span>{trail !== undefined && <span className="ios-cell-r">{trail}</span>}{(onClick || href) && <Glyph name={href ? "ext" : "chevron"} />}</>;
  if (href) return <a className="ios-cell tap" href={href} target="_blank" rel="noreferrer">{body}</a>;
  return onClick ? <button type="button" className="ios-cell tap" onClick={onClick}>{body}</button> : <div className="ios-cell">{body}</div>;
}
function Group({ head, foot, children }: { head?: string; foot?: React.ReactNode; children: React.ReactNode }) {
  return <section className="ios-group">{head && <h3 className="ios-head">{head}</h3>}<div className="ios-list">{children}</div>{foot && <p className="ios-foot">{foot}</p>}</section>;
}

// ---- the sheet: one call in full
function Sheet({ c, onClose, dex }: { c: Call; onClose: () => void; dex?: { onDexScreener: boolean; dexscreener: string | null } }) {
  const [copied, setCopied] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k);
    document.documentElement.classList.add("ios-locked");
    return () => { removeEventListener("keydown", k); document.documentElement.classList.remove("ios-locked"); };
  }, [onClose]);
  const copy = () => { void navigator.clipboard?.writeText(c.token).then(() => { tick(); setCopied(true); setTimeout(() => setCopied(false), 1400); }); };
  const hist = c.launcher?.history ?? [];
  const n = c.nft;
  return (
    <div className="ios-sheet-wrap" role="dialog" aria-modal="true" aria-label={`${c.symbol ?? c.name ?? "Launch"} details`} onClick={onClose}>
      <div className="ios-sheet" style={{ transform: drag ? `translateY(${drag}px)` : undefined }} onClick={(e) => e.stopPropagation()}>
        {/* drag the grabber down to close, as on iOS */}
        <div className="ios-grab-zone" onTouchStart={(e) => { start.current = e.touches[0]!.clientY; }} onTouchMove={(e) => { if (start.current !== null) setDrag(Math.max(0, e.touches[0]!.clientY - start.current)); }} onTouchEnd={() => { if (drag > 110) onClose(); setDrag(0); start.current = null; }}>
          <span className="ios-grab" />
        </div>
        <header className="ios-sheet-head">
          <Avatar c={c} />
          <div><h2>{c.type === "nft" ? c.name ?? "NFT collection" : c.symbol ? `$${c.symbol}` : c.name ?? "New token"}</h2><p>IMD launch #{c.launch} · {c.kind.replace(/_/g, " ")}{c.quote ? ` · ${c.quote} pair` : ""}</p></div>
          <button type="button" className="ios-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="ios-sheet-body">
          {c.type === "token" && <div className="ios-verdict"><Pill v={c.verdict} /><p>{c.summary}</p></div>}
          {c.type === "token" && !dex && (
            <div className="ios-tiles">
              <div><span>At the call</span><b>{money(c.mcapAtCall)}</b></div>
              <div><span>Now</span><b>{c.dumped ? "Dumped" : money(c.mcapNow)}</b><small>{c.multiple ? times(c.multiple) : "not traded"}</small></div>
              <div><span>High since</span><b>{times(c.peak)}</b></div>
            </div>
          )}
          {c.type === "token" && dex && (
            <div className="ios-tiles">
              <div><span>At launch</span><b>{money(c.mcapAtCall)}</b></div>
              <div><span>Now</span><b>{money(c.mcapNow)}</b><small>{c.multiple ? `${times(c.multiple)} since launch` : "market cap"}</small></div>
              <div><span>24 hours</span><b className={c.peak == null ? "" : c.peak >= 0 ? "t-safe" : "t-avoid"}>{c.peak == null ? "—" : pct(c.peak)}</b></div>
            </div>
          )}
          {dex && !dex.onDexScreener && <p className="ios-foot ios-note">Not on DexScreener yet: it lists only some Uniswap v4 pools. The price here is read on chain, from the token's own pool, and the chart is on GeckoTerminal.</p>}
          {n && (
            <Group head="Collection">
              <Cell title="Standard" trail={n.standard} />
              <Cell title="Minted" trail={n.maxSupply ? `${n.minted ?? 0} of ${n.maxSupply.toLocaleString()}` : n.minted ?? "—"} />
              {n.maxSupply && n.minted !== null && <div className="ios-cell"><span className="ios-bar"><i style={{ width: `${Math.min(100, (n.minted / n.maxSupply) * 100)}%` }} /></span></div>}
              <Cell title="Mint price" trail={n.price ? `${n.price.amount} ${n.price.unit}` : "not readable"} />
              {n.owner && <Cell title="Owner" trail={short(n.owner)} href={`https://etherscan.io/address/${n.owner}`} />}
            </Group>
          )}
          {c.reasons.length > 0 && (
            <Group head="What the checks found">
              {[...c.reasons].sort((a, b) => ORDER.indexOf(a.impact) - ORDER.indexOf(b.impact)).map((r, i) => <div key={i} className="ios-cell reason"><span className={`ios-dot i-${r.impact}`} /><span className="ios-cell-mid"><span className="ios-cell-t wrap">{r.text}</span></span></div>)}
            </Group>
          )}
          {c.hook && (
            <Group head="Hook" foot={c.hook.summary}>
              <Cell title={c.hook.template ?? short(c.hook.address)} sub={short(c.hook.address)} trail={<span className={`ios-risk r-${c.hook.risk}`}>{c.hook.risk} risk</span>} href={`https://etherscan.io/address/${c.hook.address}`} />
              <Cell title="Swap fee" sub={c.hook.swapFee} />
              <Cell title="Hook fee" sub={c.hook.hookFee} />
              {c.hook.powers.map((p, i) => <div key={i} className="ios-cell reason"><span className={`ios-dot i-${p.level === "high" ? "caution" : p.level === "medium" ? "note" : "good"}`} /><span className="ios-cell-mid"><span className="ios-cell-t wrap">{p.text}</span></span></div>)}
            </Group>
          )}
          {c.launcher && (
            <Group head="Launcher" foot={dex ? "The wallet that asked IMD for this launch, and the share of the supply it kept." : hist.length ? "Every other IMD launch this wallet asked for, newest first. A result shows where NIGHT SNIPER called it." : "This wallet's first IMD launch."}>
              <Cell lead={<WalletAvatar a={c.launcher.address} />} title={short(c.launcher.address)} sub={c.launcher.keepsPct !== null ? `Keeps ${c.launcher.keepsPct}% of the supply` : `${hist.length + 1} launch${hist.length ? "es" : ""}`} href={`https://etherscan.io/address/${c.launcher.address}`} />
              {hist.slice(0, 8).map((h) => <Cell key={h.launch} title={`#${h.launch}`} sub={`${h.kind.replace(/_/g, " ")} · ${ago(Date.parse(h.at))} ago`} trail={h.called ? (h.called.dumped ? <span className="ios-risk r-high">dumped</span> : h.called.peak ? times(h.called.peak) : <Pill v={h.called.verdict} />) : undefined} />)}
            </Group>
          )}
          <Group head="Contract">
            <button type="button" className="ios-cell tap" onClick={copy}><span className="ios-cell-mid"><span className="ios-cell-t mono">{c.token}</span></span><span className="ios-cell-r">{copied ? "Copied" : <Glyph name="copy" />}</span></button>
          </Group>
          <div className="ios-actions">
            {c.links.uniswap && !inStoreApp && <a className="ios-btn fill" href={c.links.uniswap} target="_blank" rel="noreferrer">Buy on Uniswap</a>}
            {c.links.opensea && !inStoreApp && <a className="ios-btn fill" href={c.links.opensea} target="_blank" rel="noreferrer">View on OpenSea</a>}
            {c.links.chart && <a className="ios-btn" href={c.links.chart} target="_blank" rel="noreferrer">Chart</a>}
            {dex?.dexscreener && <a className="ios-btn" href={dex.dexscreener} target="_blank" rel="noreferrer">DexScreener</a>}
            {c.type === "token" && <button type="button" className="ios-btn" onClick={() => go(`/services/verdict?token=${c.token}`)}>Full verdict</button>}
            {c.links.repo && <a className="ios-btn" href={c.links.repo} target="_blank" rel="noreferrer">Source</a>}
            <a className="ios-btn" href={c.links.etherscan} target="_blank" rel="noreferrer">Etherscan</a>
          </div>
          <p className="ios-foot center">Automated on-chain checks by NIGHTSHIFT. Not financial advice and not an audit.</p>
        </div>
      </div>
    </div>
  );
}

// ---- the tabs
function CallsTab({ feed, open, nfts }: { feed: Feed | null; open: (c: Call) => void; nfts?: boolean }) {
  const [filter, setFilter] = useState<Verdict | "all">("all");
  const list = (feed?.calls ?? []).filter((c) => (nfts ? c.type === "nft" : c.type !== "nft") && (nfts || filter === "all" || c.verdict === filter));
  const st = feed?.stats;
  return (
    <>
      {!nfts && st && (
        <div className="ios-stats" aria-label="Track record">
          <div><b>{st.calls}</b><span>Calls</span></div>
          <div><b className="t-safe">{st.safe}</b><span>Safe</span></div>
          <div><b className="t-caution">{st.caution}</b><span>Caution</span></div>
          <div><b className="t-avoid">{st.avoid}</b><span>Avoid</span></div>
          <div><b>{st.best ? times(st.best.peak) : "—"}</b><span>Best</span></div>
        </div>
      )}
      {!nfts && <Segmented label="Filter by verdict" value={filter} onChange={setFilter} options={[{ id: "all", label: "All" }, { id: "safe", label: "No flags" }, { id: "caution", label: "Caution" }, { id: "avoid", label: "Avoid" }]} />}
      {feed && feed.hidden > 0 && <button type="button" className="ios-banner" onClick={() => go("/sniper?tab=alerts")}><Glyph name="bell" /><span><b>{feed.hidden} newer call{feed.hidden > 1 ? "s" : ""}</b> holders can already see.</span><Glyph name="chevron" /></button>}
      <Group foot={nfts ? "IMD launches whose contract is an ERC-721 or ERC-1155 collection, with replies as they mint out." : "Every new IMD token launch on Ethereum, checked when it goes live. Tap a call for its reasons, hook and launcher."}>
        {!feed && <div className="ios-cell"><span className="ios-cell-mid"><span className="ios-cell-s">Loading…</span></span></div>}
        {feed && !list.length && <div className="ios-cell"><span className="ios-cell-mid"><span className="ios-cell-s">{nfts ? "No NFT launches called yet." : filter === "all" ? "No calls yet. About a dozen IMD launches go live every day." : `No ${LABEL[filter as Verdict].toLowerCase()} calls yet.`}</span></span></div>}
        {list.map((c) => (
          <Cell key={c.token} onClick={() => open(c)} lead={<Avatar c={c} />}
            title={c.type === "nft" ? c.name ?? "NFT collection" : c.symbol ? `$${c.symbol}` : c.name ?? "New token"}
            sub={c.type === "nft" && c.nft ? `#${c.launch} · ${c.nft.maxSupply ? `${c.nft.minted ?? 0}/${c.nft.maxSupply}` : `${c.nft.minted ?? "?"}`} minted · ${ago(c.at)}` : `#${c.launch} · ${c.quote ?? "?"} · ${ago(c.at)}`}
            trail={c.type === "nft" ? (c.nft?.price ? `${c.nft.price.amount} ${c.nft.price.unit}` : undefined) : <span className="ios-trail"><span className={c.dumped ? "t-avoid" : c.multiple && c.multiple >= 1.5 ? "t-safe" : ""}>{c.dumped ? "Dumped" : c.multiple ? times(c.multiple) : money(c.mcapAtCall)}</span><Pill v={c.verdict} /></span>}
          />
        ))}
      </Group>
    </>
  );
}

function DexTab({ open }: { open: (r: DexRow) => void }) {
  const [sort, setSort] = useState<DexSort>("mcap");
  const [q, setQ] = useState("");
  const dex = useDex(sort, q);
  return (
    <>
      <label className="ios-search"><Glyph name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="$SYMBOL, #launch or 0x…" aria-label="Search IMD tokens" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
      <Segmented label="Sort the dex" value={sort} onChange={setSort} options={[{ id: "mcap", label: "Top" }, { id: "new", label: "New" }, { id: "move", label: "Movers" }, { id: "safe", label: "No flags" }]} />
      <Group foot={dex ? `${dex.count} IMD token${dex.count === 1 ? "" : "s"} on Ethereum, priced from each one's own Uniswap v4 pool on chain${dex.verdicts < dex.count ? `; ${dex.verdicts} checked so far, the rest a few each minute` : ""}.` : undefined}>
        {!dex && <div className="ios-cell"><span className="ios-cell-mid"><span className="ios-cell-s">Loading…</span></span></div>}
        {dex && !dex.tokens.length && <div className="ios-cell"><span className="ios-cell-mid"><span className="ios-cell-s">{q ? "No IMD token matches." : "The dex is filling: every IMD token is added a few at a time."}</span></span></div>}
        {dex?.tokens.map((r) => (
          <Cell key={r.token} onClick={() => open(r)} lead={<span className={`ios-av v-${r.verdict?.verdict ?? "unchecked"}`} aria-hidden="true">{(r.symbol ?? r.name ?? "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?"}</span>}
            title={r.symbol ? `$${r.symbol}` : r.name ?? "Token"}
            sub={`#${r.launch} · ${r.quote ?? "?"} · ${ago(Date.parse(r.at))}`}
            trail={<span className="ios-trail dex"><span>{money(r.mcapNow)}</span><small className={r.change24 == null ? "" : r.change24 >= 0 ? "t-safe" : "t-avoid"}>{r.change24 == null ? (r.sinceLaunch ? `${times(r.sinceLaunch)} launch` : "") : pct(r.change24)}</small></span>} />
        ))}
      </Group>
    </>
  );
}

/** NFT launches: the ones NIGHT SNIPER called (with mint-out replies) and every IMD collection before them. */
function NftsTab({ feed, open }: { feed: Feed | null; open: (c: Call) => void }) {
  const dex = useDex("new", "");
  const called = (feed?.calls ?? []).filter((c) => c.type === "nft");
  const seen = new Set(called.map((c) => c.token));
  const all = [...called, ...(dex?.nfts ?? []).filter((n) => !seen.has(n.contract)).map(nftCall)].sort((a, b) => b.launch - a.launch);
  return (
    <Group foot="Every IMD launch whose contract is an ERC-721 or ERC-1155 collection. New ones are called as they go live, with replies as they mint out.">
      {!feed && !dex && <div className="ios-cell"><span className="ios-cell-mid"><span className="ios-cell-s">Loading…</span></span></div>}
      {(feed || dex) && !all.length && <div className="ios-cell"><span className="ios-cell-mid"><span className="ios-cell-s">The collections are being read: every IMD launch is checked a few at a time.</span></span></div>}
      {all.map((c) => (
        <Cell key={c.token} onClick={() => open(c)} lead={<Avatar c={c} />} title={c.name ?? c.symbol ?? "NFT collection"}
          sub={`#${c.launch} · ${c.nft?.maxSupply ? `${c.nft.minted ?? 0}/${c.nft.maxSupply}` : c.nft?.minted ?? "?"} minted · ${ago(c.at)}`}
          trail={c.nft?.price ? `${c.nft.price.amount} ${c.nft.price.unit}` : undefined} />
      ))}
    </Group>
  );
}

function LaunchersTab({ feed }: { feed: Feed | null }) {
  const rows = feed?.launchers ?? [];
  return (
    <Group head="Wallets that launch on IMD" foot={`Read from every launch's record on IMD (${feed?.indexed ?? 0} indexed). A serial launcher is worth knowing before you buy.`}>
      {!rows.length && <div className="ios-cell"><span className="ios-cell-mid"><span className="ios-cell-s">{feed ? "No launchers called yet." : "Loading…"}</span></span></div>}
      {rows.map((l) => (
        <Cell key={l.address} lead={<WalletAvatar a={l.address} />} title={short(l.address)} href={`https://etherscan.io/address/${l.address}`}
          sub={`${l.launches} launch${l.launches === 1 ? "" : "es"} · ${l.called} called${l.dumped ? ` · ${l.dumped} dumped` : ""}`}
          trail={l.best ? <span className="t-safe">{times(l.best)}</span> : undefined} />
      ))}
    </Group>
  );
}

function AlertsTab({ feed }: { feed: Feed | null }) {
  const { address, signIn, busy } = useSession();
  const [push, setPush] = usePush();
  const delay = feed?.delayMinutes ?? 3;
  return (
    <>
      <Group head="Notifications" foot={push === "ios-install" ? "On iPhone, alerts come to the home-screen app: in Safari tap Share, then Add to Home Screen, and open NIGHTSHIFT from there." : push === "denied" ? "Notifications are blocked for this site. Allow them in the browser's settings, then come back." : push === "unsupported" ? "This browser cannot show notifications. Use Chrome, Edge, Firefox or the installed app." : `Every new call, as it happens. Holders get it first; everyone else ${delay} minutes later, with the Telegram community.`}>
        <Cell lead={<span className="ios-icon bg-red"><Glyph name="bell" /></span>} title="NIGHT SNIPER alerts" trail={<Switch label="NIGHT SNIPER alerts" on={push === "on"} busy={push === "busy" || push === "unsupported" || push === "ios-install" || push === "denied"} onChange={(v) => void setPush(v)} />} />
      </Group>
      <Group head="Holder" foot="A NIGHT FROG, a Night Watcher or $SHIFT above the holder line, in the wallet you sign in with. Alerts turned on while signed in follow that wallet.">
        {address
          ? <Cell lead={<WalletAvatar a={address} />} title={short(address)} sub={feed?.holder ? "Holder: every call live" : `Not a holder yet: calls come ${delay} min later`} />
          : <Cell lead={<span className="ios-icon bg-blue"><Glyph name="people" /></span>} title={busy ? "Signing in…" : "Sign in with your wallet"} onClick={() => void signIn()} />}
      </Group>
      <Group head="More">
        <Cell lead={<span className="ios-icon bg-tel">✈</span>} title="Telegram community" href="https://t.me/getnightshift" />
        <div className="ios-cell"><span className="ios-cell-mid"><span className="ios-cell-t">Install the app</span><span className="ios-cell-s">Home screen, full screen, notifications</span></span><span className="ios-cell-r"><InstallButton compact /></span></div>
        <Cell lead={<span className="ios-icon bg-gray"><Glyph name="scope" /></span>} title="How the checks work" onClick={() => go("/services/verdict")} />
      </Group>
      <p className="ios-foot center">Automated on-chain checks run by NIGHTSHIFT. A safe verdict means these checks found no problem, not that there is none. New tokens are risky.</p>
    </>
  );
}

const TABS: { id: Tab; label: string; glyph: "scope" | "photo" | "people" | "bell" | "dex"; title: string; line: string }[] = [
  { id: "calls", label: "Calls", glyph: "scope", title: "Sniper", line: "Every IMD launch, checked" },
  { id: "dex", label: "Dex", glyph: "dex", title: "Dex", line: "Every IMD token, priced on chain" },
  { id: "nfts", label: "NFTs", glyph: "photo", title: "NFT Launches", line: "Every collection built on IMD" },
  { id: "launchers", label: "Launchers", glyph: "people", title: "Launchers", line: "Who launches, and how it went" },
  { id: "alerts", label: "Alerts", glyph: "bell", title: "Alerts", line: "Get the calls first" },
];

export function SniperPage() {
  const [feed] = useFeed();
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const [tab, setTab] = useState<Tab>(() => (TABS.some((t) => t.id === q.get("tab")) ? (q.get("tab") as Tab) : "calls"));
  const [sheet, setSheet] = useState<Call | null>(null);
  const [row, setRow] = useState<DexRow | null>(null);
  const [folded, setFolded] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const t = TABS.find((x) => x.id === tab)!;
  useEffect(() => { document.title = `${t.title} · NIGHT SNIPER`; }, [t.title]);
  // a notification opens the app on its call
  useEffect(() => { const token = q.get("token")?.toLowerCase(); const c = token && feed?.calls.find((x) => x.token === token); if (c) { setSheet(c); history.replaceState(null, "", "/sniper"); } }, [feed, q]);
  // the large title folds into the bar once it scrolls under it
  useEffect(() => {
    const el = title.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setFolded(!e!.isIntersecting), { rootMargin: "-52px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [tab]);
  const pick = (id: Tab) => { setTab(id); scrollTo({ top: 0 }); history.replaceState(null, "", id === "calls" ? "/sniper" : `/sniper?tab=${id}`); };
  return (
    <div className="ios">
      <header className={`ios-nav${folded ? " folded" : ""}`}>
        <Link to="/geek" className="ios-nav-back" aria-label="Back to the station"><Glyph name="back" /><span>Station</span></Link>
        <b className="ios-nav-title">{t.title}</b>
        <button type="button" className="ios-nav-btn" aria-label="Alerts" onClick={() => pick("alerts")}><Glyph name="bell" /></button>
      </header>
      <main className="ios-main">
        <div className="ios-hero">
          <h1 ref={title} className="ios-large">{t.title}</h1>
          <p className="ios-sub">{t.line}{feed?.holder ? " · Holder" : ""}</p>
        </div>
        {tab === "calls" && <CallsTab feed={feed} open={setSheet} />}
        {tab === "nfts" && <NftsTab feed={feed} open={setSheet} />}
        {tab === "dex" && <DexTab open={setRow} />}
        {tab === "launchers" && <LaunchersTab feed={feed} />}
        {tab === "alerts" && <AlertsTab feed={feed} />}
      </main>
      <nav className="ios-tabbar" aria-label="NIGHT SNIPER">
        {TABS.map((x) => (
          <button key={x.id} type="button" className={x.id === tab ? "on" : ""} aria-current={x.id === tab ? "page" : undefined} onClick={() => { tick(); pick(x.id); }}>
            <Glyph name={x.glyph} /><span>{x.label}</span>
            {x.id === "nfts" && (feed?.stats.nfts ?? 0) > 0 && <i className="ios-badge">{feed!.stats.nfts}</i>}
          </button>
        ))}
      </nav>
      {sheet && <Sheet c={sheet} onClose={() => setSheet(null)} />}
      {row && <Sheet c={dexCall(row)} dex={{ onDexScreener: row.onDexScreener, dexscreener: row.links.dexscreener }} onClose={() => setRow(null)} />}
    </div>
  );
}
