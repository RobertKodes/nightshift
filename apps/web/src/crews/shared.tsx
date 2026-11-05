import { serviceLabel } from "../labels";
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type CrewEvent, type CrewMetrics, type CrewProfile, type CrewsIndex, type ServicesIndex, ago, api } from "../api";
import { ROOMS, type RoomId } from "../nx/map";
import { Link } from "../router";
import AnimatedList from "../rb/AnimatedList";
import DotGrid from "../rb/DotGrid";
import { PxHero, PxStat, PxStats } from "../saas/kit";
import "../station/station.css";
import "../station/services.css";
import "./crews.css";
import "../saas/pages/tools.css";

/**
 * The pieces every crews page shares: loading with honest states, the hero, a copyable request,
 * the operator label, prices with the holder price, how to buy (HTTP route, MCP tool, curl) and
 * the live feed. Every number shown comes from the engine's answer; nothing is typed in here.
 */

/** $SHIFT on Ethereum (IMD launch #2124) and the NightshiftHook: the public examples the samples start on. */
export const SHIFT = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";
export const HOOK = "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc";
export const PUBLIC_MCP = "https://getnightshift.tech/mcp/public";
/** This server's own public MCP, for the commands people copy. */
export const mcpHere = () => `${location.origin}/mcp/public`;
export const RESEARCH_SAMPLE = "What has the IMD swarm published about Uniswap v4 hooks?";
export const EXAMPLES = "https://github.com/RobertKodes/nightshift/tree/main/examples";
/** What the engine says when a holder price applies; shown until /api/v1/services answers with its own words. */
export const HOLDER_FALLBACK = "Holders pay half on house checks and reports: a paying wallet with 500,000+ $SHIFT (wallet plus staked), a NIGHT FROG or a Night Watcher. Swarm Desk orders cost the full quote.";

export const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());
export const shortAddr = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
/** A dollar amount with as many decimals as it needs: $0.01, $0.005, $1.00. */
export const price = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n !== 0 && Math.abs(n) < 0.01 ? 6 : 4 })}`);
/** A share (0 to 1) as a percentage. */
export const pct = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : `${Math.round(x * 1000) / 10}%`);
export const count = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US"));
export const dur = (ms: number | null | undefined) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
/** A time as milliseconds, from ms, seconds or an ISO string. */
export const toMs = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  if (typeof v === "string") { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return v > 1e12 ? v : v * 1000;
};
export const when = (v: number | string | null | undefined) => { const t = toMs(v); return t ? ago(t) : "—"; };
export const day = (v: number | string | null | undefined) => { const t = toMs(v); return t ? new Date(t).toISOString().slice(0, 10) : "—"; };
/** A Base (or Base Sepolia) transaction link. */
export const txUrl = (network: string | undefined, tx: string) => `${network === "eip155:84532" ? "https://sepolia.basescan.org" : "https://basescan.org"}/tx/${tx}`;
export const blockUrl = (n: number) => `https://etherscan.io/block/${n}`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export type Loaded<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void; at: number | null };
/** Loads once (and every `pollMs` while the tab is visible); a failed poll keeps the last good data and says so. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number): Loaded<T> {
  const [s, setS] = useState<{ data: T | null; error: string | null; loading: boolean; at: number | null }>({ data: null, error: null, loading: true, at: null });
  const live = useRef(true);
  const f = useRef(fn);
  f.current = fn;
  const load = useCallback(() => {
    f.current().then((data) => { if (live.current) setS({ data, error: null, loading: false, at: Date.now() }); })
      .catch((e: Error) => { if (live.current) setS((o) => ({ ...o, error: e.message || "No answer", loading: false })); });
  }, []);
  useEffect(() => {
    live.current = true;
    setS((o) => ({ ...o, loading: true }));
    load();
    let t: ReturnType<typeof setInterval> | null = null;
    if (pollMs) t = setInterval(() => { if (document.visibilityState === "visible") load(); }, pollMs);
    return () => { live.current = false; if (t) clearInterval(t); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...s, reload: () => { setS((o) => ({ ...o, loading: true })); load(); } };
}

/** True when the engine answered that this route does not exist (yet). */
export const notLive = (e: string | null) => !!e && /^(not found\.?|http 404)$/i.test(e.trim());

/** The house crews and the outside crews, from /api/crews (one list or two). */
export function splitCrews(d: CrewsIndex | null): { house: CrewProfile[]; external: CrewProfile[] } {
  const all = [...(d?.crews ?? []), ...(d?.external ?? [])];
  const seen = new Set<string>();
  const uniq = all.filter((c) => c && typeof c.id === "string" && !seen.has(c.id) && (seen.add(c.id), true));
  return { house: uniq.filter((c) => c.operator?.kind === "house"), external: uniq.filter((c) => c.operator?.kind !== "house") };
}

/** The station's services index (holder rule, network, mode), read once per page view. */
let svcCache: Promise<ServicesIndex | null> | null = null;
export function useServices(): ServicesIndex | null {
  const [d, setD] = useState<ServicesIndex | null>(null);
  useEffect(() => {
    svcCache ??= api.servicesIndex().catch(() => null);
    let on = true;
    void svcCache.then((x) => { if (on) setD(x); });
    return () => { on = false; };
  }, []);
  return d;
}

/** A line that is a shell command gets the terminal's prompt in front of it (never copied). */
const isCommand = (line: string) => /^(curl|claude|npx|npm|pnpm|git|KEY=|export |cd |node )/.test(line.trim());

/** A command or config to copy, as a terminal block: the label in its header, a prompt on each command line. */
export function Copy({ code, label, tone }: { code: string; label?: string; tone?: "imd" }) {
  const [done, setDone] = useState(false);
  const lines = code.split("\n");
  return (
    <div className={`svc-copy tl-term${tone ? ` ${tone}` : ""}`}>
      <div className="tl-term-h">
        <span className="pk-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="tl-term-k">{label ?? (lines.some(isCommand) ? "shell" : "config")}</span>
        <button type="button" onClick={() => { void navigator.clipboard?.writeText(code).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }); }}>{done ? "Copied" : "Copy"}</button>
      </div>
      <pre className="st-pre">{lines.map((line, i) => <Fragment key={i}>{i > 0 && "\n"}{isCommand(line) && <i className="tl-ps1" aria-hidden="true">$ </i>}{line}</Fragment>)}</pre>
    </div>
  );
}

/** Heavy effects are decoration: wide screens only, never with reduced motion or the lite mode. */
export function useRich(): boolean {
  const [rich, setRich] = useState(false);
  useEffect(() => {
    const wide = matchMedia("(min-width: 900px)");
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setRich(wide.matches && !still.matches && !document.documentElement.hasAttribute("data-lite"));
    sync();
    wide.addEventListener("change", sync);
    still.addEventListener("change", sync);
    return () => { wide.removeEventListener("change", sync); still.removeEventListener("change", sync); };
  }, []);
  return rich;
}

/** Light motion (typing, split-flap) runs on phones too, but never with reduced motion. */
export function useMotionOk(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setOk(!still.matches);
    sync();
    still.addEventListener("change", sync);
    return () => still.removeEventListener("change", sync);
  }, []);
  return ok;
}

/** The grid behind a hero: IMD blue for IMD's own tools, lime for the protocol's. A cheap canvas, desktop only. */
export function HeroGrid({ tone = "imd" }: { tone?: "imd" | "lime" }) {
  const rich = useRich();
  if (!rich) return null;
  return tone === "imd"
    ? <DotGrid dotSize={2} gap={20} baseColor="#1c3d78" activeColor="#2f7bff" proximity={120} shockRadius={170} shockStrength={3} shape="square" glow={0.35} clickShock />
    : <DotGrid dotSize={2} gap={20} baseColor="#1f4226" activeColor="#b8ff3d" proximity={120} shockRadius={170} shockStrength={3} shape="square" glow={0.3} clickShock />;
}

/** Where you are, as a terminal path: each folder a link back. */
export function Trail({ items }: { items: { to?: string; label: string }[] }) {
  return (
    <nav className="tl-trail" aria-label="Where you are">
      <span aria-hidden="true">root@nightshift:~</span>
      {items.map((it, i) => <Fragment key={`${it.label}-${i}`}><i aria-hidden="true">/</i>{it.to ? <Link to={it.to}>{it.label}</Link> : <b>{it.label}</b>}</Fragment>)}
      <em aria-hidden="true">$</em>
    </nav>
  );
}

/** The protocol hero for the AI tools pages: a terminal path, the kit hero over the grid, and the tab's name. */
export function ToolHero({ docTitle, trail, kicker, title, accent, lead, actions, aside, live, tone = "imd", bg }: {
  docTitle: string; trail?: { to?: string; label: string }[]; kicker: string; title: ReactNode; accent?: string; lead?: ReactNode; actions?: ReactNode; aside?: ReactNode; live?: boolean; tone?: "imd" | "lime";
  /** a background of the page's own instead of the grid (one WebGL background at most, desktop only) */
  bg?: ReactNode;
}) {
  // every render: the app shell names the tab on its own renders, the page's name must win
  useEffect(() => { document.title = /NIGHTSHIFT/.test(docTitle) ? docTitle : `${docTitle} · NIGHTSHIFT`; });
  return (
    <>
      {trail && <Trail items={trail} />}
      <PxHero kicker={kicker} title={title} accent={accent} lead={lead} actions={actions} aside={aside} live={live} bg={bg ?? <HeroGrid tone={tone} />} />
    </>
  );
}

/** A page's hero, the station way: the room's art, the trail, the title, one line and what follows. */
export function Hero({ room = "geek", trail, title, line, className, docTitle, children }: { room?: RoomId; trail: React.ReactNode; title: React.ReactNode; line: React.ReactNode; className?: string; docTitle: string; children?: React.ReactNode }) {
  const r = ROOMS[room];
  // every render: the app shell names the tab on its own renders, the page's name must win
  useEffect(() => { document.title = `${docTitle} · NIGHTSHIFT`; });
  return (
    <header className={`st-hero slim cr-page${className ? ` ${className}` : ""}`} style={{ "--acc": r.accent } as React.CSSProperties}>
      <img className="st-hero-art" src={r.art} alt="" />
      <div className="st-hero-in">
        <span className="st-deck"><Link to={r.nav[0]!.to}>{r.name.toUpperCase()}</Link> · {trail}</span>
        <h1>{title}</h1>
        <p>{line}</p>
        {children}
      </div>
    </header>
  );
}

/** Loading, error (with a retry) and "not live yet": the three states before there is data. */
export function Pending({ load, what, retry = true }: { load: { error: string | null; loading: boolean; reload: () => void; data: unknown }; what: string; retry?: boolean }) {
  if (load.data) return load.error ? <p className="st-warn">The last refresh failed ({load.error}); showing what was read before.</p> : null;
  if (load.error) {
    if (notLive(load.error)) return <p className="st-warn">{what}: not live on this server yet. Nothing is shown rather than made up.</p>;
    return <p className="svc-err">{what} did not load: {load.error}. {retry && <button className="svc-link" type="button" onClick={load.reload}>Try again</button>}</p>;
  }
  return <p className="st-empty">Reading {what.toLowerCase()}…</p>;
}

/** Who runs a crew. House crews always say so. */
export function RunBy({ p }: { p: CrewProfile }) {
  const o = p.operator;
  return o?.kind === "house"
    ? <span className="svc-runby cr-runby"><i />Operated by NIGHTSHIFT</span>
    : <span className="svc-runby cr-runby"><i />Operated by {o?.name ?? "an outside operator"} · outside operator{o && "wallet" in o && o.wallet ? ` · ${o.wallet}` : ""}</span>;
}

export function StatusTag({ p }: { p: CrewProfile }) {
  return p.status === "live" ? <span className="cr-tag live">Live</span> : <span className="cr-tag warn" title="No price is set yet: the free sample works, paid calls are not open">Preview</span>;
}

/** The crew's numbers, as the ledger counts them. */
export function MetricStats({ m }: { m: CrewMetrics | null | undefined }) {
  if (!m) return <p className="st-empty">No metrics yet.</p>;
  return (
    <PxStats cols={4}>
      <PxStat label="Jobs done" value={count(m.done)} sub={`${count(m.jobs)} started · ${count(m.failed)} failed`} tone="lime" />
      <PxStat label="Success rate" value={pct(m.successRate)} sub={m.successRate == null ? "no finished jobs yet" : "done ÷ (done + failed)"} />
      <PxStat label="Median time" value={dur(m.medianLatencyMs)} sub="start to answer" />
      <PxStat label="Customer-paid jobs" value={count(m.customerPaidJobs)} sub={`${count(m.paidJobs)} paid in all, any payer`} />
      <PxStat label="Paying wallets" value={count(m.payingWallets)} sub={`${count(m.repeatWallets)} paid more than once`} />
      <PxStat label="Revenue" value={price(m.revenueUsd)} sub="outside wallets only" tone="lime" />
      <PxStat label="Known cost" value={price(m.knownCostUsd)} sub="RPC, model and IMD spend we measure" tone="gold" />
      <PxStat label="Last job" value={m.lastJobAt ? when(m.lastJobAt) : "—"} sub={m.lastJobAt ? day(m.lastJobAt) : "none yet"} />
    </PxStats>
  );
}

/** The price table: each offer, its price and the holder price. */
export function PriceTable({ p, holders }: { p: CrewProfile; holders?: string | null }) {
  const rows = p.pricing ?? [];
  return (
    <div className="st-table-wrap">
      <table className="st-table">
        <thead><tr><th>Offer</th><th className="cr-num">Price</th><th className="cr-num">Holder price</th><th>Call</th></tr></thead>
        <tbody>
          {rows.length ? rows.map((r) => (
            <tr key={r.offer}><td><b>{serviceLabel(r.label)}</b></td><td className="cr-num">{p.id === "swarm" ? "from " : ""}{price(r.usd)}</td><td className="cr-num">{p.id === "swarm" ? "full quote" : price(r.holderUsd)}</td><td className="mono dim">{r.offer}</td></tr>
          )) : <tr><td colSpan={4} className="dim" style={{ whiteSpace: "normal" }}>{p.operator?.kind === "house" ? "No price is set yet: this crew is in preview, only the free sample runs." : "Prices are set by the operator, not by NIGHTSHIFT: see its endpoint."}</td></tr>}
        </tbody>
      </table>
      {rows.length > 0 && <p className="st-note svc-pad">USDC on Base over x402, paid per call: no account, no subscription. {p.id === "swarm" ? "The free quote sets the exact price for 10 minutes. No holder discount." : holders ?? HOLDER_FALLBACK}</p>}
    </div>
  );
}

/** "GET https://…/{address} (one check); GET …" into its routes, with the placeholders filled with a real example. */
export function routesOf(http: string): { method: string; url: string; note: string | null; example: string }[] {
  const out: { method: string; url: string; note: string | null; example: string }[] = [];
  const re = /\b(GET|POST|PUT|DELETE)\s+(\S+)(?:\s+\(([^)]*)\))?/g;
  for (let m = re.exec(http); m; m = re.exec(http)) {
    const url = m[2]!.replace(/[;,]$/, "");
    out.push({ method: m[1]!, url, note: m[3] ?? null, example: fill(url) });
  }
  return out;
}
const fill = (u: string) => u.replace(/\{address\}/g, SHIFT).replace(/\{question\}/g, encodeURIComponent(RESEARCH_SAMPLE)).replace(/\{url\}/g, encodeURIComponent(PUBLIC_MCP));
const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** How to buy: the exact HTTP route(s), the MCP tool, and the request to copy. */
export function BuyBox({ p }: { p: CrewProfile }) {
  const routes = routesOf(p.buy?.http ?? "");
  const external = p.operator?.kind !== "house";
  return (
    <div className="st-two">
      <section className="st-panel">
        <h3>Over HTTP (x402)</h3>
        {p.id === "swarm" ? (
          <>
            <ol className="st-steps">
              <li>Call <code>/api/v1/swarm/quote</code> with a kind and a brief (20–1500 characters). Audits also need a public GitHub repo URL. IMD checks the exact job for free.</li>
              <li>Call the returned <code>pay</code> URL to get its x402 terms. Quotes expire after 10 minutes and cost the full quoted price.</li>
              <li>Sign those terms and call the same pay URL with <code>PAYMENT-SIGNATURE</code>. USDC settles before NIGHTSHIFT orders the job. If IMD fails, NIGHTSHIFT records the refund owed and alerts the owner.</li>
              <li>Keep the <code>orderToken</code> returned once. Read status and results free at <code>/api/v1/swarm/jobs/ORDER_ID?token=ORDER_TOKEN</code>. Retry pending payments with the same authorization.</li>
            </ol>
            <Copy label="1 · free example quote" code={`curl ${sh(p.sample.href)}`} />
            <Copy label="2 · pay the quote's pay URL" code={'curl -H "PAYMENT-SIGNATURE: $PAYMENT" "$PAY_URL"'} />
          </>
        ) : routes.length ? (
          <>
            <div className="st-code">{routes.map((r) => <div key={r.url}><span>{r.note ?? r.method}</span><code>{r.method} {r.url}</code></div>)}</div>
            <ol className="st-steps">
              <li>Call the route without payment: the answer is <code>402</code> with the exact terms (also base64 in the <code>PAYMENT-REQUIRED</code> header).</li>
              <li>Sign the USDC authorization for <code>accepts[0]</code> with any x402 v2 client. The amount in the terms is the most you pay.</li>
              <li>Repeat the call with <code>PAYMENT-SIGNATURE: &lt;base64 payload&gt;</code>. A call whose answer fails is not settled, so it is never charged.</li>
            </ol>
            <Copy label="1 · see the terms" code={`curl -i ${sh(routes[0]!.example)}`} />
            <Copy label="2 · pay and get the answer" code={`curl -H "PAYMENT-SIGNATURE: $PAYMENT" ${sh(routes[0]!.example)}`} />
          </>
        ) : p.buy?.http ? (
          <>
            <p className="st-note">{external ? "This crew runs on its operator's own endpoint:" : "Route:"}</p>
            <div className="st-code"><div><span>Endpoint</span><code>{p.buy.http}</code></div></div>
          </>
        ) : <p className="st-empty">No paid route is published yet.</p>}
      </section>
      <section className="st-panel">
        <h3>As an MCP tool</h3>
        {p.buy?.mcpTool ? (
          <>
            <p className="st-note">On the public MCP server, no key: <code>{p.buy.mcpTool}</code>. Paid tools take the x402 payload as a <code>payment</code> argument; without it they return the terms.</p>
            <Copy label="Claude Code" code={`claude mcp add --transport http nightshift-public ${mcpHere()}`} />
          </>
        ) : <p className="st-note">{external ? "Not listed as a NIGHTSHIFT MCP tool: call the operator's endpoint." : "No MCP tool for this crew yet: use the HTTP route."}</p>}
        {p.buy?.docs && <p className="st-note">Machine-readable profile: <a href={p.buy.docs} target="_blank" rel="noreferrer">{p.buy.docs.replace(/^https?:\/\//, "")}</a></p>}
      </section>
    </div>
  );
}

const KIND: Record<string, string> = {
  "watch.check": "check", "watch.observe": "watch run", "watch.start": "watch started", "research.report": "report", "buildcheck.report": "report", onboarding: "onboarding",
};
export const kindText = (k: string) => KIND[k] ?? k.replace(/[._-]+/g, " ");

/** The live feed: what the crews did, newest first. */
export function Feed({ events, names, limit = 12 }: { events: CrewEvent[]; names: Map<string, string>; limit?: number }) {
  return (
    <ul className="cr-feed">
      {events.slice(0, limit).map((e, i) => (
        <li key={`${e.at}-${e.crew}-${i}`}>
          <time dateTime={new Date(toMs(e.at) ?? 0).toISOString()}>{when(e.at)}</time>
          <div className="cr-feed-h">
            <b>{names.get(e.crew) ?? (e.crew.startsWith("op:") ? `Outside crew ${e.crew.slice(3)}` : e.crew)}</b>
            <span className="cr-tag dim">{kindText(e.kind)}</span>
            <span className={`cr-st ${e.status}`}>{e.status}</span>
            {e.paid ? <span className="cr-tag good">paid</span> : <span className="cr-tag dim">free</span>}
            {e.house ? <span className="cr-tag">house</span> : <span className="cr-tag warn">outside</span>}
          </div>
          <em>{e.summary ?? "No public summary for this job."}</em>
        </li>
      ))}
    </ul>
  );
}

function FeedRow({ e, names }: { e: CrewEvent; names: Map<string, string> }) {
  return (
    <div className="cr-feed-row">
      <time dateTime={new Date(toMs(e.at) ?? 0).toISOString()}>{when(e.at)}</time>
      <div className="cr-feed-h">
        <b>{names.get(e.crew) ?? (e.crew.startsWith("op:") ? `Outside crew ${e.crew.slice(3)}` : e.crew)}</b>
        <span className="cr-tag dim">{kindText(e.kind)}</span>
        <span className={`cr-st ${e.status}`}>{e.status}</span>
        {e.paid ? <span className="cr-tag good">paid</span> : <span className="cr-tag dim">free</span>}
        {e.house ? <span className="cr-tag">house</span> : <span className="cr-tag warn">outside</span>}
      </div>
      <em>{e.summary ?? "No public summary for this job."}</em>
    </div>
  );
}

/** The live feed as a moving list (the same rows as Feed): new jobs slide in at the top. */
export function LiveFeed({ events, names, limit = 15 }: { events: CrewEvent[]; names: Map<string, string>; limit?: number }) {
  const list = events.slice(0, limit);
  return (
    <AnimatedList
      className="tl-feed"
      items={list.map((e, i) => ({ id: `${e.at}-${e.crew}-${i}`, title: e.summary ?? kindText(e.kind) }))}
      renderItem={(_, i) => <FeedRow e={list[i]!} names={names} />}
      showGradients={false} displayScrollbar={false} maxHeight={560} width="100%" frame={false} theme="dark" accentColor="#2f7bff" radius={2} gap={4} animation="slide" stagger={0.03}
    />
  );
}

/** A plain-words list from whatever shape an engine field has: strings, {label, reason} objects or a record of them. */
export function itemsOf(x: unknown): { id: string; label: string; detail: string | null }[] {
  const one = (v: unknown, k: string): { id: string; label: string; detail: string | null } | null => {
    if (v == null) return null;
    if (typeof v === "string" || typeof v === "number") return { id: k, label: String(v), detail: null };
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const label = String(o.label ?? o.name ?? o.title ?? o.id ?? k);
      const d = o.reason ?? o.how ?? o.detail ?? o.what ?? o.note ?? o.description ?? null;
      const kinds = Array.isArray(o.kinds) ? ` (${(o.kinds as unknown[]).join(", ")})` : "";
      return { id: String(o.id ?? k), label: label + kinds, detail: d == null ? null : String(d) };
    }
    return null;
  };
  if (Array.isArray(x)) return x.map((v, i) => one(v, String(i))).filter((v): v is NonNullable<typeof v> => !!v);
  if (x && typeof x === "object") {
    const out: { id: string; label: string; detail: string | null }[] = [];
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (Array.isArray(v)) for (const [i, w] of v.entries()) { const it = one(w, `${k}.${i}`); if (it) out.push({ ...it, label: `${it.label}`, detail: it.detail ? `${k}: ${it.detail}` : k }); }
      else { const it = one(v, k); if (it) out.push(typeof v === "string" || typeof v === "number" ? { id: k, label: k, detail: String(v) } : it); }
    }
    return out;
  }
  return [];
}
