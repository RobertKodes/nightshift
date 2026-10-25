import { useEffect, useState } from "react";
import { Link } from "../router";
import { Stat, Tiles } from "./Station";
import "./station.css";
import "./services.css";

/**
 * NIGHTSHIFT's house services in the Geek Room: Token Verdict, Hook Inspector and the IMD Data
 * Feed. Each page has a live free demo, the prices, a copyable curl and the MCP config. The
 * services themselves live in the engine (apps/engine/src/services) and are sold over x402.
 */
const SHIFT = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";
const COPYCAT = "0x6d6e7616c60bde669200522908426af1847ce60c";
const HOOK = "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc";
const GUARD = "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000";
const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const money = (n: number | null | undefined) => n == null ? "—" : n === 0 ? "$0" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(n < 1 ? 4 : 0)}`;

type Offer = { id: string; name: string; pitch: string; priceUsd: number; route: string; example: string; description: string };
type Index = { offers: Offer[]; network: string; payTo: string | null; mode: string; mcp: string; openapi: string };
function useIndex(): Index | null {
  const [d, setD] = useState<Index | null>(null);
  useEffect(() => { fetch("/api/v1/services").then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => {}); }, []);
  return d;
}

function Copy({ code, label }: { code: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="svc-copy">
      {label && <span>{label}</span>}
      <pre className="st-pre">{code}</pre>
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(code).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }); }}>{done ? "Copied" : "Copy"}</button>
    </div>
  );
}

function Hero({ title, line, deck, children }: { title: string; line: string; deck: string; children?: React.ReactNode }) {
  useEffect(() => { document.title = `${title} · NIGHTSHIFT`; }, [title]);
  return (
    <header className="st-hero slim" style={{ "--acc": "#4ad8ff" } as React.CSSProperties}>
      <img className="st-hero-art" src="/art/station/room-geek-1600x900.webp" alt="" />
      <div className="st-hero-in">
        <span className="st-deck"><Link to="/geek">GEEK ROOM</Link> · <Link to="/services">HOUSE SERVICES</Link> · {deck}</span>
        <h1>{title}</h1>
        <p>{line}</p>
        <span className="svc-runby"><i />Run by NIGHTSHIFT</span>
        {children}
      </div>
    </header>
  );
}

function Prices({ ids, index }: { ids: string[]; index: Index | null }) {
  const rows = (index?.offers ?? []).filter((o) => ids.includes(o.id));
  return (
    <div className="st-table-wrap">
      <table className="st-table svc-prices">
        <thead><tr><th>Call</th><th>Price</th><th>What you get</th></tr></thead>
        <tbody>{rows.length ? rows.map((o) => <tr key={o.id}><td><b>{o.name}</b></td><td className="mono">${o.priceUsd < 0.01 ? o.priceUsd.toFixed(3) : o.priceUsd.toFixed(2)}</td><td className="svc-wrap">{o.pitch}</td></tr>) : <tr><td colSpan={3} className="dim">Reading the prices…</td></tr>}</tbody>
      </table>
      <p className="st-note svc-pad">Paid in USDC on Base ({index?.network ?? "eip155:8453"}) with x402: no account, no API key. Each payment settles to NIGHTSHIFT Services, the platform's house company{index?.payTo ? <> (<span className="mono">{short(index.payTo)}</span>)</> : null}.{index?.mode === "sim" ? " This server runs in simulation: add sim=1 for a demo answer, no money moves." : ""}</p>
    </div>
  );
}

function HowTo({ example, tools }: { example: string; tools: string }) {
  const base = location.origin;
  return (
    <div className="st-two">
      <section className="st-panel">
        <h3>Call it over HTTP (x402)</h3>
        <ol className="st-steps">
          <li>Call the route: the answer is <code>402</code> with the exact terms (also base64 in the <code>PAYMENT-REQUIRED</code> header).</li>
          <li>Sign an EIP-3009 USDC authorization for <code>accepts[0]</code> with any x402 v2 client.</li>
          <li>Repeat the call with <code>PAYMENT-SIGNATURE: &lt;base64 payload&gt;</code>. The answer is the JSON plus <code>payment.tx</code>; a failed check is never charged.</li>
        </ol>
        <Copy label="1 · see the terms" code={`curl -i "${base}${example}"`} />
        <Copy label="2 · pay and get the answer" code={`curl -H "PAYMENT-SIGNATURE: $PAYMENT" "${base}${example}"`} />
      </section>
      <section className="st-panel">
        <h3>Or as MCP tools</h3>
        <p className="st-note">On the public MCP server, no key: {tools}. Paid tools take the same x402 payload as a <code>payment</code> argument; without it they return the terms.</p>
        <Copy label="Claude Code" code={`claude mcp add --transport http nightshift-public ${base}/mcp/public`} />
        <Copy label="Cursor (~/.cursor/mcp.json)" code={JSON.stringify({ mcpServers: { "nightshift-public": { url: `${base}/mcp/public` } } }, null, 2)} />
        <p className="st-note">OpenAPI: <a href="/openapi.json" target="_blank" rel="noreferrer">/openapi.json</a> · prices and terms: <a href="/api/v1/services" target="_blank" rel="noreferrer">/api/v1/services</a> · <a href="/llms.txt" target="_blank" rel="noreferrer">llms.txt</a></p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ the index

export function ServicesPage() {
  const index = useIndex();
  return (
    <div className="st-room">
      <Hero title="House services" deck="RUN BY NIGHTSHIFT" line="Three services NIGHTSHIFT runs itself, sold per call to AI agents, bots and traders over x402 and MCP: the answers we already read from IMD and the chain, packaged and cited.">
        <div className="st-stats">
          <Stat label="Token Verdict" value="$0.01" note="deep $0.25 · 1 free a day" />
          <Stat label="Hook Inspector" value="$0.05" note="explained $0.50" />
          <Stat label="IMD Data Feed" value="$0.001" note="per call · samples free" />
        </div>
      </Hero>
      <div className="st-body">
        <h2>The services</h2>
        <Tiles items={[
          { to: "/services/verdict", title: "Token Verdict", note: "Before you buy an Ethereum token: no issues found, caution or avoid, with every reason and its evidence. Made for IMD launches and v4 hook tokens.", icon: "shield", tag: "FREE DEMO" },
          { to: "/services/hook", title: "Hook Inspector", note: "What a Uniswap v4 hook can do: permission bits, callbacks, fees, owner powers, upgrades, known templates.", icon: "code" },
          { to: "/services/imd-feed", title: "IMD Data Feed", note: "IMD launches, tokens, swarm health and seat work history as JSON, with since= polling.", icon: "chart" },
        ]} />
        <h2>Prices</h2>
        <Prices ids={["token-verdict-quick", "token-verdict-deep", "hook-inspector", "hook-inspector-explained", "imd-feed"]} index={index} />
        <p className="st-note">Why these: the most-bought paid endpoint for agents today is a token verdict before a buy, and nobody serves IMD data or inspects v4 hooks. These are automated checks from public data, not financial advice and not an audit; every answer says what it could not check.</p>
        <HowTo example={`/api/v1/verdict/ethereum/${SHIFT}?depth=quick`} tools="verdict_preview, verdict_demo, token_verdict, hook_flags, hook_inspect, imd_feed_sample, imd_feed, services_pricing" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Token Verdict

type Reason = { id: string; impact: "avoid" | "caution" | "note" | "good"; text: string; evidence: string[] };
type Verdict = {
  verdict: "no_issues_found" | "safe" | "caution" | "avoid"; summary: string; token: string; depth: string;
  confidence: { level: string; score: number; unknowns: string[] }; reasons: Reason[];
  asset: { name: string | null; symbol: string | null };
  imd: { isLaunch: boolean; launchNumber?: number; kind?: string };
  market: { liquidityUsd: number | null; exitLiquidityUsd: number | null; volume24hUsd: number | null; pair: { url: string } | null };
  hook: { address: string; flags: string; template: string | null } | null;
  holders: { count?: number; largestWallet?: { pct: number; label: string | null } | null; error?: string };
  simulation: { simulated: boolean; why?: string; buy?: { taxPct?: number | null }; sell?: { taxPct?: number | null; ok?: boolean }; router?: { ok: boolean } };
  copycat: { signal: string; text: string };
  evidence: { id: string; what: string; source: string; url?: string }[];
  demo?: { left: number; nextFreeAt: string }; cached?: boolean; dataAgeSeconds?: number;
};
type Preview = { imd: { isLaunch: boolean; launchNumber?: number; kind?: string; status?: string }; market: { symbol: string | null; liquidityUsd: number | null; volume24hUsd: number | null; dex: string } | null; sameSymbolLaunches: number[]; hook: { address: string; flags: string; template: string | null } | null; note: string };

function VerdictCard({ v }: { v: Verdict }) {
  const sym = v.asset.symbol ? `$${v.asset.symbol}` : short(v.token);
  const groups: Reason["impact"][] = ["avoid", "caution", "note", "good"];
  return (
    <section className={`svc-verdict ${v.verdict}`}>
      <div className="svc-vhead">
        <span className={`svc-pill ${v.verdict === "no_issues_found" ? "safe" : v.verdict}`}>{v.verdict === "no_issues_found" || v.verdict === "safe" ? "NO ISSUES FOUND" : v.verdict.toUpperCase()}</span>
        <div><b>{sym}{v.imd.isLaunch ? <small> · IMD launch #{v.imd.launchNumber} ({v.imd.kind})</small> : <small> · not an IMD launch</small>}</b><span className="mono">{v.token}</span></div>
        <span className="svc-conf" title={v.confidence.unknowns.join("; ") || "every check ran"}>{v.confidence.level} confidence · {Math.round(v.confidence.score * 100)}%</span>
      </div>
      <p className="svc-summary">{v.summary}</p>
      <div className="st-stats wide">
        <Stat label="Exit liquidity" value={money(v.market.exitLiquidityUsd)} note={v.market.liquidityUsd != null ? `${money(v.market.liquidityUsd)} in the pool` : undefined} />
        <Stat label="Sell cost" value={v.simulation.simulated && v.simulation.sell?.taxPct != null ? `${v.simulation.sell.taxPct}%` : "—"} note={v.simulation.simulated ? "beyond the pool fee, simulated" : v.simulation.why} />
        <Stat label="Holders" value={v.holders.count != null ? v.holders.count.toLocaleString("en-US") : "—"} note={v.holders.largestWallet ? `largest ${v.holders.largestWallet.pct.toFixed(2)}%` : v.holders.error} />
        <Stat label="Copycat" value={v.copycat.signal} note={v.hook ? `hook ${v.hook.template ?? short(v.hook.address)} · ${v.hook.flags}` : "no v4 hook"} />
      </div>
      <ul className="svc-reasons">
        {groups.flatMap((g) => v.reasons.filter((r) => r.impact === g).map((r) => (
          <li key={r.id + r.text} className={r.impact}><i>{r.impact}</i><span>{r.text}</span><small>{r.evidence.join(" ")}</small></li>
        )))}
      </ul>
      {v.confidence.unknowns.length > 0 && <p className="st-note">Not checked: {v.confidence.unknowns.join("; ")}.</p>}
      <details className="svc-evidence">
        <summary>Evidence ({v.evidence.length})</summary>
        <ol>{v.evidence.map((e) => <li key={e.id}><b>{e.id}</b> <span>{e.what}</span> <small>{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.source} ↗</a> : e.source}</small></li>)}</ol>
      </details>
      <p className="st-note svc-small">{v.cached ? `From the cache, ${v.dataAgeSeconds}s old. ` : ""}Automated checks run by NIGHTSHIFT, not financial advice and not an audit.</p>
    </section>
  );
}

export function VerdictPage() {
  const index = useIndex();
  // /services/verdict?token=0x… (from a NIGHT SNIPER call) opens on that token's free preview
  const asked = new URLSearchParams(location.search).get("token")?.trim() ?? "";
  const [token, setToken] = useState(isAddr(asked) ? asked : SHIFT);
  const [busy, setBusy] = useState<"" | "demo" | "preview">("");
  const [v, setV] = useState<Verdict | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (kind: "demo" | "preview", t = token) => {
    if (!isAddr(t)) { setErr("Paste an Ethereum token address (0x and 40 hex characters)."); return; }
    setBusy(kind); setErr(null);
    try {
      const url = kind === "demo" ? `/api/v1/verdict/ethereum/${t.trim()}?depth=quick&demo=1` : `/api/v1/verdict/ethereum/${t.trim()}/preview`;
      const r = await fetch(url);
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? `Error ${r.status}`); return; }
      if (kind === "demo") { setV(d); setPv(null); } else { setPv(d); setV(null); }
    } catch { setErr("The service did not answer. Try again in a minute."); } finally { setBusy(""); }
  };
  useEffect(() => { if (isAddr(asked)) void run("preview", asked); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="st-room">
      <Hero title="Token Verdict" deck="BEFORE YOU BUY" line="No issues found, caution or avoid for an Ethereum token, with every reason tied to its evidence. Made for IMD launches and Uniswap v4 hook tokens, where nobody else looks.">
        <div className="st-stats"><Stat label="Quick" value="$0.01" note="the verdict" /><Stat label="Deep" value="$0.25" note="+ hook inspection, IMD checks, memo" /><Stat label="Free" value="1 a day" note="per IP, below" /></div>
      </Hero>
      <div className="st-body">
        <h2>Try it free</h2>
        <form className="svc-form" onSubmit={(e) => { e.preventDefault(); void run("demo"); }}>
          <input value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} aria-label="Token address" placeholder="0x… token on Ethereum" />
          <button className="st-cta" disabled={busy !== ""} type="submit">{busy === "demo" ? "Checking…" : "Run my free verdict"}</button>
          <button className="st-cta ghost" disabled={busy !== ""} type="button" onClick={() => void run("preview")}>{busy === "preview" ? "Reading…" : "Free preview"}</button>
        </form>
        <p className="st-note">One full quick verdict per IP per day is free; the preview (IMD match, market, copycats, hook bits, no verdict) is always free. Try <button className="svc-link" type="button" onClick={() => { setToken(SHIFT); void run("preview", SHIFT); }}>$SHIFT (IMD #2124)</button> or <button className="svc-link" type="button" onClick={() => { setToken(COPYCAT); void run("preview", COPYCAT); }}>a later SHIFT copy (#2129)</button>.</p>
        {err && <p className="svc-err">{err}</p>}
        {v && <VerdictCard v={v} />}
        {pv && (
          <section className="st-panel">
            <h3>Free preview <small>no verdict</small></h3>
            <div className="st-stats wide">
              <Stat label="IMD launch" value={pv.imd.isLaunch ? `#${pv.imd.launchNumber}` : "no"} note={pv.imd.kind} />
              <Stat label="Liquidity" value={money(pv.market?.liquidityUsd)} note={pv.market?.dex ?? "not on DexScreener"} />
              <Stat label="Same symbol" value={pv.sameSymbolLaunches.length ? `${pv.sameSymbolLaunches.length} launch${pv.sameSymbolLaunches.length > 1 ? "es" : ""}` : "none"} note={pv.sameSymbolLaunches.length ? pv.sameSymbolLaunches.map((n) => `#${n}`).join(" ") : "other IMD launches"} />
              <Stat label="v4 hook" value={pv.hook ? pv.hook.flags : "—"} note={pv.hook ? pv.hook.template ?? short(pv.hook.address) : "no hook"} />
            </div>
            <p className="st-note">{pv.note}</p>
          </section>
        )}
        <h2>What it checks</h2>
        <div className="svc-checks">
          {[
            ["IMD launch", "Matched against every launch on api.imd.fun and its artifacts; deep adds IMD's admission checks and assurances."],
            ["Source and powers", "Verified source (Etherscan or Sourcify) or the bytecode: mint, pause, blacklist, fee setters, limits, proxies, who controls them."],
            ["Pool and liquidity", "DexScreener and the v4 PoolManager's own storage: the pool key, the hook, the fee, what sellers can take out."],
            ["Holders", "Every Transfer since deployment, with the pool, burns and IMD's launch contracts set apart."],
            ["Buy and sell", "A ~$10 buy and its sell through the V4 Quoter and the Universal Router with eth_call: the hook and the token's transfer code run, nothing is sent."],
            ["Copycats", "The symbol against every IMD launch on Ethereum (read on chain): who came first, who has the liquidity."],
          ].map(([t, d]) => <div key={t} className="st-panel"><h3>{t}</h3><p className="st-note">{d}</p></div>)}
        </div>
        <h2>Prices</h2>
        <Prices ids={["token-verdict-quick", "token-verdict-deep"]} index={index} />
        <HowTo example={`/api/v1/verdict/ethereum/${SHIFT}?depth=quick`} tools="verdict_preview and verdict_demo (free), token_verdict (paid)" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Hook Inspector

type Flags = { address: string; flags: { hex: string; valid: boolean; problems: string[]; permissions: { name: string; set: boolean; what: string }[] }; template: { name: string; by: string; note: string } | null; note: string };
export function HookPage() {
  const index = useIndex();
  const [hook, setHook] = useState(HOOK);
  const [f, setF] = useState<Flags | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const decode = async (a = hook) => {
    if (!isAddr(a)) { setErr("Paste a hook address (0x and 40 hex characters)."); return; }
    setErr(null);
    const r = await fetch(`/api/v1/hook/${a.trim()}/flags`).catch(() => null);
    const d = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !d) { setErr(d?.error ?? "The service did not answer."); return; }
    setF(d);
  };
  useEffect(() => { void decode(HOOK); }, []);
  return (
    <div className="st-room">
      <Hero title="Hook Inspector" deck="UNISWAP V4" line="What a Uniswap v4 hook can do before you trade or provide liquidity through it: the permission bits, the callbacks, the fees and who receives them, the owner's powers, upgrades and known templates.">
        <div className="st-stats"><Stat label="Inspection" value="$0.05" /><Stat label="Explained" value="$0.50" note="+ memo and source lines" /><Stat label="Bits" value="free" note="decoded below" /></div>
      </Hero>
      <div className="st-body">
        <h2>Decode a hook's bits, free</h2>
        <form className="svc-form" onSubmit={(e) => { e.preventDefault(); void decode(); }}>
          <input value={hook} onChange={(e) => setHook(e.target.value)} spellCheck={false} aria-label="Hook address" placeholder="0x… v4 hook" />
          <button className="st-cta" type="submit">Decode</button>
        </form>
        <p className="st-note">Try the <button className="svc-link" type="button" onClick={() => { setHook(HOOK); void decode(HOOK); }}>NightshiftHook</button> or <button className="svc-link" type="button" onClick={() => { setHook(GUARD); void decode(GUARD); }}>IMD's pool guard</button>.</p>
        {err && <p className="svc-err">{err}</p>}
        {f && (
          <section className="st-panel">
            <h3>{f.template ? f.template.name : short(f.address)} <small>bits {f.flags.hex}{f.flags.valid ? "" : " · invalid"}</small></h3>
            {f.template && <p className="st-note">{f.template.by}. {f.template.note}</p>}
            <div className="svc-bits">{f.flags.permissions.map((p) => <span key={p.name} className={p.set ? "on" : ""} title={p.what}><i />{p.name}</span>)}</div>
            {f.flags.problems.map((p) => <p key={p} className="svc-err">{p}</p>)}
            <p className="st-note">{f.note}</p>
          </section>
        )}
        <h2>The paid inspection</h2>
        <div className="svc-checks">
          {[
            ["Callbacks", "Which callbacks the bits ask for, which the code implements, and any the PoolManager would call that are missing."],
            ["Fees", "Static or dynamic swap fee, read from the pool; whether the hook takes its own cut (return-delta bits and PoolManager.take), its settings and recipients."],
            ["Owner powers", "Every state-changing function with its gate (owner, role, keeper) and the caps written into it."],
            ["Upgrades", "EIP-1967 and beacon proxies, DELEGATECALL, SELFDESTRUCT; whether the code can change."],
            ["Templates", "IMD's pool guard, the NightshiftHook, hooks of IMD univ4_hook launches."],
            ["Explained", "explain=1: the same in plain sentences, with the verified source lines behind every power."],
          ].map(([t, d]) => <div key={t} className="st-panel"><h3>{t}</h3><p className="st-note">{d}</p></div>)}
        </div>
        <h2>Prices</h2>
        <Prices ids={["hook-inspector", "hook-inspector-explained"]} index={index} />
        <HowTo example={`/api/v1/hook/${HOOK}`} tools="hook_flags (free), hook_inspect (paid)" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ IMD Data Feed

type FeedItem = { launchNumber: number; kind: string; status: string; chain: string; createdAt: string; token: { symbol: string | null; contract: string; address: string } | null; market: { liquidityUsd: number | null; volume24hUsd: number | null } | null };
export function FeedPage() {
  const index = useIndex();
  const [tab, setTab] = useState<"launches" | "tokens" | "swarm" | "agent">("launches");
  const [seat, setSeat] = useState("42");
  // the answer is kept with the tab it is for: a tab switch never renders one endpoint's data as another's
  const [res, setRes] = useState<{ tab: string; d: Record<string, unknown> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const path = tab === "agent" ? `/api/v1/imd/agents/${seat}` : `/api/v1/imd/${tab}`;
  const load = () => { const t = tab; setErr(null); setRes(null); fetch(`${path}?sample=1`).then(async (r) => { const x = await r.json(); if (!r.ok) setErr(x.error ?? `Error ${r.status}`); else setRes({ tab: t, d: x }); }).catch(() => setErr("The feed did not answer.")); };
  useEffect(load, [tab]);
  const d = res && res.tab === tab ? res.d : null;
  const items = (d?.items ?? []) as FeedItem[];
  return (
    <div className="st-room">
      <Hero title="IMD Data Feed" deck="FOR AGENTS AND BOTS" line="The IMD ecosystem as one clean API: launches with their token, pool, liquidity and volume; one launch with holders and the seats that built it; every live token's market; the swarm's health from the IMD Watchtower; any seat's work history.">
        <div className="st-stats"><Stat label="Per call" value="$0.001" /><Stat label="Samples" value="free" note="3 items, sample=1" /><Stat label="Watch" value="since=" note="poll for changes" /></div>
      </Hero>
      <div className="st-body">
        <h2>Free samples, live</h2>
        <div className="svc-tabs" role="tablist">
          {(["launches", "tokens", "swarm", "agent"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "agent" ? "a seat" : t}</button>)}
          {tab === "agent" && <form onSubmit={(e) => { e.preventDefault(); load(); }}><input value={seat} onChange={(e) => setSeat(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="Seat id" /><button className="st-cta ghost" type="submit">Read</button></form>}
        </div>
        <Copy code={`curl "${location.origin}${path}?sample=1"`} />
        {err && <p className="svc-err">{err}</p>}
        {!d && !err && <p className="st-empty">Reading IMD…</p>}
        {d && (tab === "launches" || tab === "tokens") && (
          <div className="st-table-wrap">
            <table className="st-table">
              <thead><tr><th>Launch</th><th>Token</th><th>Kind</th><th>Chain</th><th>Liquidity</th><th>24h volume</th><th>Status</th></tr></thead>
              <tbody>{items.map((x) => <tr key={x.launchNumber}><td>#{x.launchNumber}</td><td>{x.token?.symbol ? `$${x.token.symbol}` : x.token?.contract ?? "—"}</td><td className="dim">{x.kind}</td><td>{x.chain}</td><td>{money(x.market?.liquidityUsd)}</td><td>{money(x.market?.volume24hUsd)}</td><td>{x.status}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {d && tab === "swarm" && (() => {
          const s = d as { status: string; watchtower: { reachable: boolean; openIncidents?: number }; swarm: { agentsOnline?: number; jobsDoneLastDay?: number; acceptedLastDay?: number } | null };
          return <div className="st-stats wide"><Stat label="Status" value={s.status} note={s.watchtower.reachable ? "IMD Watchtower" : "api.imd.fun"} /><Stat label="Agents online" value={s.swarm?.agentsOnline?.toLocaleString("en-US") ?? "—"} /><Stat label="Jobs done, 24 h" value={s.swarm?.jobsDoneLastDay ?? "—"} /><Stat label="Open incidents" value={s.watchtower.openIncidents ?? "—"} /></div>;
        })()}
        {d && tab === "agent" && (() => {
          const a = d as { seat: number; online: boolean | null; totals: { attempts: number | null; accepted: number | null }; acceptRate: number | null; work: { jobId: string; role: string | null; status: string | null; submittedAt: string | null; objective: string | null }[] };
          return (
            <section className="st-panel">
              <h3>Seat #{a.seat} <small>{a.online ? "online" : "offline"} · {a.totals.accepted ?? "?"} accepted of {a.totals.attempts ?? "?"}{a.acceptRate != null ? ` (${a.acceptRate}%)` : ""}</small></h3>
              <ul className="st-feed">{a.work.map((w) => <li key={w.jobId + (w.submittedAt ?? "")}><span>{w.submittedAt?.slice(0, 10)}</span><b>{w.role ?? "work"}</b> {w.status} <em>{w.objective && w.objective.length > 140 ? `${w.objective.slice(0, 140).replace(/\s+\S*$/, "")}…` : w.objective}</em></li>)}</ul>
            </section>
          );
        })()}
        {d?.sample ? <p className="st-note">{(d.sample as { note: string }).note}</p> : null}
        <h2>Endpoints</h2>
        <div className="st-code">
          {[["launches", "/api/v1/imd/launches?chain=ethereum&kind=univ4_hook&since=…"], ["one launch", "/api/v1/imd/launches/2124"], ["tokens", "/api/v1/imd/tokens"], ["swarm", "/api/v1/imd/swarm?since=…"], ["a seat", "/api/v1/imd/agents/42?before=…"]].map(([k, u]) => <div key={k}><span>{k}</span><code>{u}</code></div>)}
        </div>
        <p className="st-note">Watching: every list takes <code>since</code> (an ISO time) and answers with <code>next.since</code> to send on the next poll. Webhook watch plans ($5–20 a month) are designed, not live: see <code>x-nightshift-planned</code> in <a href="/openapi.json" target="_blank" rel="noreferrer">/openapi.json</a>. For people, the community's <a href="https://www.imdradar.site" target="_blank" rel="noreferrer">IMD Radar</a> has charts and swaps; this feed is the API for agents.</p>
        <h2>Prices</h2>
        <Prices ids={["imd-feed"]} index={index} />
        <HowTo example="/api/v1/imd/launches?chain=ethereum&limit=20" tools="imd_feed_sample (free), imd_feed (paid)" />
      </div>
    </div>
  );
}
