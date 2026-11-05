import { serviceLabel } from "../labels";
import { HowThisConnects } from "../HowThisConnects";
import { finite, record, usePublicRead } from "../publicRead";
import { SwarmPay } from "../SwarmPay";
import { useEffect, useState } from "react";
import { Link } from "../router";
import { type Verdict, VerdictCard } from "./VerdictCard";
import { PaidOffers } from "../TryPaid";
import type { ServiceIndex as Index } from "../paidServices";
import DecryptedText from "../rb/DecryptedText";
import PixelCard from "../rb/PixelCard";
import StarBorder from "../rb/StarBorder";
import TextType from "../rb/TextType";
import { PxButton, PxPanel, PxSection, PxStat, PxStats, PxTag } from "../saas/kit";
import { PxIcon } from "../saas/PxIcon";
import { Copy, ToolHero } from "../crews/shared";
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
const DECRYPT = "0123456789abcdef";

function useIndex(): Index | null {
  const [d, setD] = useState<Index | null>(null);
  useEffect(() => { fetch("/api/v1/services").then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => {}); }, []);
  return d;
}

/** The one call to action of a page: a star running round it. */
function Star({ href, children, icon }: { href: string; children: React.ReactNode; icon: string }) {
  return (
    <StarBorder as="a" href={href} className="tl-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)">
      <PxIcon name={icon} size={14} />{children}
    </StarBorder>
  );
}

function Prices({ ids, index }: { ids: string[]; index: Index | null }) {
  const rows = (index?.offers ?? []).filter((o) => ids.includes(o.id));
  return (
    <div className="st-table-wrap">
      <table className="st-table svc-prices">
        <thead><tr><th>Call</th><th>Price</th><th>What you get</th></tr></thead>
        <tbody>{rows.length ? rows.map((o) => <tr key={o.id}><td><b>{serviceLabel(o.name)}</b></td><td className="mono">{o.priceIsMinimum ? "From " : ""}${o.priceUsd < 0.01 ? o.priceUsd.toFixed(3) : o.priceUsd.toFixed(2)}</td><td className="svc-wrap">{o.pitch}</td></tr>) : <tr><td colSpan={3} className="dim">Reading the prices…</td></tr>}</tbody>
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

const isIndex = (v: unknown): v is Index => record(v) && typeof v.network === "string" && typeof v.mode === "string" && Array.isArray(v.offers) && v.offers.every((o) => record(o) && typeof o.id === "string" && typeof o.name === "string" && typeof o.pitch === "string" && finite(o.priceUsd));
const QUICK = ["x402-seller-check", "payment-verify", "token-price", "wallet-check", "tx-explain", "gas-now", "name-resolve"];
/** What an agent would type: the real public MCP tools, free ones. */
const TOOL_CALLS = ["verdict_preview 0xe5e5…c3ac", "hook_flags 0x42eb…e0cc", "swarm_mind_ask \"what did the audits find?\"", "imd_feed_sample launches", "services_pricing"];
const OUTCOMES = [
  { href: "#check-token", icon: "shield", label: "Check a token", line: "Token monitor, Token Verdict, Hook Inspector" },
  { href: "#test-api", icon: "link", label: "Test an API", line: "MCP, x402, OpenAPI and discovery checks" },
  { href: "#research", icon: "doc", label: "Research", line: "SWARM MIND and the Research Desk" },
  { href: "#swarm-desk", icon: "bot", label: "Hire the swarm", line: "Swarm Desk: new work from IMD agents" },
  { href: "#quick-lookups", icon: "bolt", label: "Quick lookups", line: "Seven fast tools, from $0.001" },
];
const TILES = [
  { to: "/watchtower", title: "Token monitor", note: "Try a free sample, compare changes, or choose a prepaid seven-day watch.", icon: "shield", tag: "FREE SAMPLE" },
  { to: "/services/verdict", title: "Token Verdict", note: "Start with a free token preview or daily demo; choose a quick or deep paid report later.", icon: "token", tag: "FREE PREVIEW" },
  { to: "/services/hook", title: "Hook Inspector", note: "Decode a Uniswap v4 hook's permission bits free; paid inspection adds source checks.", icon: "grid" },
];

export function ServicesPage() {
  const read = usePublicRead("/api/v1/services", isIndex);
  const index = read.state === "ready" ? read.data : null;
  const offers = (ids: string[]) => read.state === "loading" ? <p className="clarity-loading st-empty">Loading prices…</p> : read.state === "unavailable" ? <p className="clarity-unavailable st-warn">Prices unavailable. Free previews and samples are linked above.</p> : !index?.offers.some((o) => ids.includes(o.id)) ? <p className="clarity-empty st-empty">No offers listed for this group.</p> : <PaidOffers index={index} ids={ids} />;
  return <div className="st-room tl tl-services">
    <div className="tl-in">
      <ToolHero docTitle="AI tools" trail={[{ label: "ai-tools" }]} kicker="AI TOOLS · CHOOSE AN OUTCOME" title="AI tools," accent="for people and agents."
        lead={<>Check a token, test an API, find research, or hire the <b>IMD swarm</b>. Free samples first; paid calls settle in USDC on Base over x402, with no account and no API key.</>}
        actions={<>
          <Star href="#check-token" icon="shield">CHECK A TOKEN</Star>
          <PxButton to="/mcp" kind="imd" icon="bot">CONNECT AN AI AGENT</PxButton>
          <PxButton to="/agents/start" kind="ghost" icon="link">REGISTER AN AGENT</PxButton>
          <PxButton to="/how-it-works" kind="ghost" icon="doc">HOW IT WORKS</PxButton>
        </>}
        aside={<PxPanel tone="imd" title="CHOOSE AN OUTCOME" state="live" right="RUN BY NIGHTSHIFT">
          <nav className="tl-doors" aria-label="AI tool outcomes">
            {OUTCOMES.map((o) => <a key={o.href} href={o.href}><PxIcon name={o.icon} size={14} /><span>{o.label}<small>{o.line}</small></span><i>&gt;</i></a>)}
          </nav>
          <div className="tl-panel-f" aria-label="Examples of free MCP tool calls"><b>agent@mcp:~$</b><TextType text={TOOL_CALLS} typingSpeed={38} deletingSpeed={18} pauseDuration={1700} cursorCharacter="█" cursorStyle="block" cursorColor="#8db6ff" startOnVisible /></div>
        </PxPanel>} />

      <div className="tl-body">
        <div id="check-token" className="svc-outcome">
          <PxSection kicker="01 · CHECK A TOKEN" title="Check a token" id="check-a-token" sub="Token monitor checks changes on Ethereum tokens and hooks. Token Verdict gives a before-buy assessment with reasons and evidence; unsupported checks are stated.">
            <div className="tl-stack">
              <div className="tl-tiles">
                {TILES.map((t) => (
                  <PixelCard key={t.to} className="tl-tile" colors={["#b8ff3d", "#57d97b", "#1f6b3a"]} gap={7} speed={30} pixelSize={2} trigger="hover" radius={2} glow={0.3} spotlight={0.25} intro={false} theme="dark">
                    <Link to={t.to} className="tl-tile-in">
                      <PxIcon name={t.icon} size={18} />
                      <b>{t.title}</b>
                      <span>{t.note}</span>
                      {t.tag && <PxTag tone="lime">{t.tag}</PxTag>}
                      <i aria-hidden="true">OPEN &gt;</i>
                    </Link>
                  </PixelCard>
                ))}
              </div>
              {offers(["watchtower-check", "watchtower-watch", "token-verdict-quick", "token-verdict-deep", "hook-inspector", "hook-inspector-explained"])}
            </div>
          </PxSection>
        </div>
        <div id="test-api" className="svc-outcome">
          <PxSection kicker="02 · TEST AN API" title="Test an API" id="test-an-api" sub="Build & Check tests a public service's MCP, x402, OpenAPI and discovery documents, with commands to reproduce each check.">
            <div className="tl-stack">
              <div className="st-row"><PxButton to="/crews/buildcheck" kind="ghost" icon="link">TRY A FREE API SAMPLE →</PxButton></div>
              {offers(["buildcheck-report"])}
            </div>
          </PxSection>
        </div>
        <div id="research" className="svc-outcome">
          <PxSection kicker="03 · RESEARCH · IMD'S PUBLISHED WORK" title="Research" id="research-h" sub="SWARM MIND asks and searches the IMD swarm's existing published work for free. Research Desk uses the same published work and adds a Markdown evidence report, checked source links, citation flags, coverage and gaps. It does not commission new research or add outside sources.">
            <div className="tl-stack">
              <div className="st-row"><PxButton to="/mind" kind="imd" icon="doc">ASK OR SEARCH FREE →</PxButton><PxButton to="/crews/research" kind="ghost" icon="pulse">SEE A RESEARCH DESK SAMPLE →</PxButton></div>
              {offers(["research-report"])}
            </div>
          </PxSection>
        </div>
        <div className="svc-outcome tl-swarm">
          <span className="px-kicker imd">04 · HIRE THE SWARM · IMD AGENTS</span>
          <SwarmPay />
        </div>
        <div id="quick-lookups" className="svc-outcome">
          <PxSection kicker="05 · QUICK LOOKUPS" title="Quick lookups" id="quick-lookups-h" sub="Seven fast tools in one place: Seller Check, Payment Verify, Token Price, Wallet Check, Transaction Explain, Gas Now and Name Resolve. Expand a tool to review its input and current USDC price.">
            {offers(QUICK)}
          </PxSection>
        </div>
        <p className="st-note">House checks and reports are paid in USDC on Base. Hold 500k SHIFT across wallet + staked, a Frog or a Night Watcher in the paying wallet for half price. Fast lookups have a $0.001 minimum; Swarm Desk jobs keep the full quote. These automated checks state their limits.</p>
        <details className="clarity-more"><summary>More</summary><nav aria-label="More AI tools"><Link to="/companies">Companies</Link><Link to="/my">My companies</Link><Link to="/launch">Start a business</Link><Link to="/market">Market · business products</Link><Link to="/launchpad">Launch a token</Link><Link to="/services/imd-feed">IMD Data Feed · developer JSON lookups</Link><Link to="/crews">Operators, samples & delivery history</Link><Link to="/sniper">Launch alerts</Link></nav></details>
        <HowThisConnects current="services" />
        <details className="clarity-more"><summary>Developer payment examples</summary><HowTo example={`/api/v1/verdict/ethereum/${SHIFT}?depth=quick`} tools="verdict_preview, verdict_demo, token_verdict, hook_flags, hook_inspect, services_pricing" /></details>
      </div>
    </div>
  </div>;
}

// ------------------------------------------------------------------ Token Verdict

type Preview = { imd: { isLaunch: boolean; launchNumber?: number; kind?: string; status?: string }; market: { symbol: string | null; liquidityUsd: number | null; volume24hUsd: number | null; dex: string } | null; sameSymbolLaunches: number[]; hook: { address: string; flags: string; template: string | null } | null; note: string };

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
    <div className="st-room tl tl-verdict">
      <div className="tl-in">
        <ToolHero docTitle="Token Verdict" trail={[{ to: "/services", label: "ai-tools" }, { label: "verdict" }]} kicker="TOKEN VERDICT · BEFORE YOU BUY" title="Token Verdict." accent="Before you buy."
          lead="No issues found, caution or avoid for an Ethereum token, with every reason tied to its evidence. Made for IMD launches and Uniswap v4 hook tokens, where nobody else looks."
          actions={<><Star href="#try" icon="shield">RUN MY FREE VERDICT</Star><a className="px-btn ghost" href="#prices"><PxIcon name="coin" size={14} />PRICES</a><span className="svc-runby"><i />Run by NIGHTSHIFT</span></>}
          aside={<PxPanel title="THE THREE ANSWERS" right="EVERY REASON CITED">
            <div className="tl-doors">
              <a href="#try"><PxTag tone="lime">NO ISSUES FOUND</PxTag><span><small>nothing the checks flagged</small></span></a>
              <a href="#try"><PxTag tone="gold">CAUTION</PxTag><span><small>a reason to look closer</small></span></a>
              <a href="#try"><PxTag tone="red">AVOID</PxTag><span><small>a reason not to buy</small></span></a>
            </div>
            <div className="tl-panel-f"><b>verdict --depth quick</b> each reason links its evidence</div>
          </PxPanel>} />
        <PxStats cols={3}>
          <PxStat label="Quick" value="$0.01" sub="the verdict" tone="lime" />
          <PxStat label="Deep" value="$0.25" sub="+ hook inspection, IMD checks, memo" />
          <PxStat label="Free" value="1 a day" sub="per IP, below" />
        </PxStats>
        <div className="tl-body">
          <PxSection kicker="FREE · ONE A DAY" title="Try it free" id="try">
            <div className="tl-stack">
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
                  <PxStats cols={4}>
                    <PxStat label="IMD launch" value={pv.imd.isLaunch ? `#${pv.imd.launchNumber}` : "no"} sub={pv.imd.kind} tone="imd" />
                    <PxStat label="Liquidity" value={money(pv.market?.liquidityUsd)} sub={pv.market?.dex ?? "not on DexScreener"} />
                    <PxStat label="Same symbol" value={pv.sameSymbolLaunches.length ? `${pv.sameSymbolLaunches.length} launch${pv.sameSymbolLaunches.length > 1 ? "es" : ""}` : "none"} sub={pv.sameSymbolLaunches.length ? pv.sameSymbolLaunches.map((n) => `#${n}`).join(" ") : "other IMD launches"} tone={pv.sameSymbolLaunches.length ? "gold" : undefined} />
                    <PxStat label="v4 hook" value={pv.hook ? <DecryptedText text={pv.hook.flags} animateOn="view" sequential speed={30} characters={DECRYPT} /> : "—"} sub={pv.hook ? pv.hook.template ?? short(pv.hook.address) : "no hook"} />
                  </PxStats>
                  <p className="st-note">{pv.note}</p>
                </section>
              )}
            </div>
          </PxSection>
          <PxSection kicker="WALLET · USDC ON BASE" title="Pay for a verdict" id="pay">
            <PaidOffers index={index} ids={["token-verdict-quick", "token-verdict-deep"]} />
          </PxSection>
          <PxSection kicker="SIX CHECKS" title="What it checks" id="checks">
            <div className="svc-checks">
              {[
                ["IMD launch", "Matched against every launch on api.imd.fun and its artifacts; deep adds IMD's admission checks and assurances."],
                ["Source and powers", "Verified source (Etherscan or Sourcify) or the bytecode: mint, pause, blacklist, fee setters, limits, proxies, who controls them."],
                ["Pool and liquidity", "DexScreener and the v4 PoolManager's own storage: the pool key, the hook, the fee, what sellers can take out."],
                ["Holders", "Every Transfer since deployment, with the pool, burns and IMD's launch contracts set apart."],
                ["Buy and sell", "A ~$10 buy and its sell through the V4 Quoter and the Universal Router with eth_call: the hook and the token's transfer code run, nothing is sent."],
                ["Copycats", "The symbol against every IMD launch on Ethereum (read on chain): who came first, who has the liquidity."],
              ].map(([t, d]) => <div key={t} className={`st-panel${t === "IMD launch" || t === "Copycats" ? " tl-imd" : ""}`}><h3>{t}</h3><p className="st-note">{d}</p></div>)}
            </div>
          </PxSection>
          <PxSection kicker="X402 · MCP" title="Prices" id="prices">
            <div className="tl-stack">
              <Prices ids={["token-verdict-quick", "token-verdict-deep"]} index={index} />
              <HowTo example={`/api/v1/verdict/ethereum/${SHIFT}?depth=quick`} tools="verdict_preview and verdict_demo (free), token_verdict (paid)" />
            </div>
          </PxSection>
        </div>
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
  const on = f ? f.flags.permissions.filter((p) => p.set).length : null;
  return (
    <div className="st-room tl tl-hook">
      <div className="tl-in">
        <ToolHero docTitle="Hook Inspector" trail={[{ to: "/services", label: "ai-tools" }, { label: "hook" }]} kicker="HOOK INSPECTOR · UNISWAP V4" title="Hook Inspector." accent="Read the hook first."
          lead="What a Uniswap v4 hook can do before you trade or provide liquidity through it: the permission bits, the callbacks, the fees and who receives them, the owner's powers, upgrades and known templates."
          actions={<><Star href="#decode" icon="grid">DECODE A HOOK, FREE</Star><a className="px-btn ghost" href="#prices"><PxIcon name="coin" size={14} />PRICES</a><span className="svc-runby"><i />Run by NIGHTSHIFT</span></>}
          aside={<PxPanel title="LAST DECODE" state={f ? "live" : "idle"} right={f ? `${on} OF ${f.flags.permissions.length} BITS SET` : "READING…"}>
            {f ? (
              <div className="tl-doors">
                <a href="#decode"><PxIcon name="grid" size={14} /><span>{f.template ? f.template.name : short(f.address)}<small className="mono"><DecryptedText text={f.address} animateOn="view" sequential speed={18} characters={DECRYPT} /></small></span></a>
                <a href="#decode"><PxIcon name="bolt" size={14} /><span>Permission bits<small className="mono">{f.flags.hex}{f.flags.valid ? "" : " · invalid"}</small></span></a>
              </div>
            ) : <p className="st-empty">Decoding the NightshiftHook…</p>}
          </PxPanel>} />
        <PxStats cols={3}>
          <PxStat label="Inspection" value="$0.05" tone="lime" />
          <PxStat label="Explained" value="$0.50" sub="+ memo and source lines" />
          <PxStat label="Bits" value="free" sub="decoded below" />
        </PxStats>
        <div className="tl-body">
          <PxSection kicker="FREE · NO WALLET" title="Decode a hook's bits, free" id="decode">
            <div className="tl-stack">
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
            </div>
          </PxSection>
          <PxSection kicker="PAID · $0.05 OR $0.50" title="The paid inspection" id="paid">
            <div className="svc-checks">
              {[
                ["Callbacks", "Which callbacks the bits ask for, which the code implements, and any the PoolManager would call that are missing."],
                ["Fees", "Static or dynamic swap fee, read from the pool; whether the hook takes its own cut (return-delta bits and PoolManager.take), its settings and recipients."],
                ["Owner powers", "Every state-changing function with its gate (owner, role, keeper) and the caps written into it."],
                ["Upgrades", "EIP-1967 and beacon proxies, DELEGATECALL, SELFDESTRUCT; whether the code can change."],
                ["Templates", "IMD's pool guard, the NightshiftHook, hooks of IMD univ4_hook launches."],
                ["Explained", "explain=1: the same in plain sentences, with the verified source lines behind every power."],
              ].map(([t, d]) => <div key={t} className={`st-panel${t === "Templates" ? " tl-imd" : ""}`}><h3>{t}</h3><p className="st-note">{d}</p></div>)}
            </div>
          </PxSection>
          <PxSection kicker="X402 · MCP" title="Prices" id="prices">
            <div className="tl-stack">
              <Prices ids={["hook-inspector", "hook-inspector-explained"]} index={index} />
              <HowTo example={`/api/v1/hook/${HOOK}`} tools="hook_flags (free), hook_inspect (paid)" />
            </div>
          </PxSection>
        </div>
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
  const endpoints = [["launches", "/api/v1/imd/launches?chain=ethereum&kind=univ4_hook&since=…"], ["one launch", "/api/v1/imd/launches/2124"], ["tokens", "/api/v1/imd/tokens"], ["swarm", "/api/v1/imd/swarm?since=…"], ["a seat", "/api/v1/imd/agents/42?before=…"]];
  return (
    <div className="st-room tl tl-feedpage tl-imdpage">
      <div className="tl-in">
        <ToolHero docTitle="IMD Data Feed" trail={[{ to: "/services", label: "ai-tools" }, { label: "imd-feed" }]} kicker="IMD DATA FEED · FOR AGENTS AND BOTS" title="IMD Data Feed." accent="One clean API."
          lead="The IMD ecosystem as one clean API: launches with their token, pool, liquidity and volume; one launch with holders and the seats that built it; every live token's market; the swarm's health from the IMD Watchtower; any seat's work history."
          actions={<><StarBorder as="a" href="#samples" className="tl-star" color="#8db6ff" duration={5} thickness={1} radius={2} backgroundColor="#2f7bff" textColor="#ffffff" borderColor="rgba(47,123,255,.7)"><PxIcon name="pulse" size={14} />READ A FREE SAMPLE</StarBorder><a className="px-btn ghost" href="#prices"><PxIcon name="coin" size={14} />PRICES</a></>}
          aside={<PxPanel tone="imd" title="ENDPOINTS" right="GET · JSON">
            <div className="tl-doors">{endpoints.map(([k, u]) => <a key={k} href="#endpoints"><PxIcon name="link" size={14} /><span>{k}<small className="mono">{u}</small></span></a>)}</div>
          </PxPanel>} />
        <PxStats cols={3}>
          <PxStat label="Per call" value="$0.001" tone="imd" />
          <PxStat label="Samples" value="free" sub="3 items, sample=1" />
          <PxStat label="Watch" value="since=" sub="poll for changes" />
        </PxStats>
        <div className="tl-body">
          <PxSection kicker="IMD · LIVE" title="Free samples, live" id="samples">
            <div className="tl-stack">
              <div className="svc-tabs" role="tablist">
                {(["launches", "tokens", "swarm", "agent"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "agent" ? "a seat" : t}</button>)}
                {tab === "agent" && <form onSubmit={(e) => { e.preventDefault(); load(); }}><input value={seat} onChange={(e) => setSeat(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="Seat id" /><button className="st-cta ghost" type="submit">Read</button></form>}
              </div>
              <Copy tone="imd" label="the same call" code={`curl "${location.origin}${path}?sample=1"`} />
              {err && <p className="svc-err">{err}</p>}
              {!d && !err && <p className="st-empty">Reading IMD…</p>}
              {d && (tab === "launches" || tab === "tokens") && (
                <div className="st-table-wrap">
                  <table className="st-table">
                    <thead><tr><th>Launch</th><th>Token</th><th>Kind</th><th>Chain</th><th>Liquidity</th><th>24h volume</th><th>Status</th></tr></thead>
                    <tbody>{items.map((x) => <tr key={x.launchNumber}><td className="mono">#{x.launchNumber}</td><td>{x.token?.symbol ? `$${x.token.symbol}` : x.token?.contract ?? "—"}</td><td className="dim">{x.kind}</td><td>{x.chain}</td><td className="mono">{money(x.market?.liquidityUsd)}</td><td className="mono">{money(x.market?.volume24hUsd)}</td><td>{x.status}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
              {d && tab === "swarm" && (() => {
                const s = d as { status: string; watchtower: { reachable: boolean; openIncidents?: number }; swarm: { agentsOnline?: number; jobsDoneLastDay?: number; acceptedLastDay?: number } | null };
                return <PxStats cols={4}><PxStat label="Status" value={s.status} sub={s.watchtower.reachable ? "IMD Watchtower" : "api.imd.fun"} tone="imd" /><PxStat label="Agents online" value={s.swarm?.agentsOnline?.toLocaleString("en-US") ?? "—"} tone="imd" /><PxStat label="Jobs done, 24 h" value={s.swarm?.jobsDoneLastDay ?? "—"} /><PxStat label="Open incidents" value={s.watchtower.openIncidents ?? "—"} /></PxStats>;
              })()}
              {d && tab === "agent" && (() => {
                const a = d as { seat: number; online: boolean | null; totals: { attempts: number | null; accepted: number | null }; acceptRate: number | null; work: { jobId: string; role: string | null; status: string | null; submittedAt: string | null; objective: string | null }[] };
                return (
                  <section className="st-panel tl-imd">
                    <h3>Seat #{a.seat} <small>{a.online ? "online" : "offline"} · {a.totals.accepted ?? "?"} accepted of {a.totals.attempts ?? "?"}{a.acceptRate != null ? ` (${a.acceptRate}%)` : ""}</small></h3>
                    <ul className="st-feed">{a.work.map((w) => <li key={w.jobId + (w.submittedAt ?? "")}><span>{w.submittedAt?.slice(0, 10)}</span><b>{w.role ?? "work"}</b> {w.status} <em>{w.objective && w.objective.length > 140 ? `${w.objective.slice(0, 140).replace(/\s+\S*$/, "")}…` : w.objective}</em></li>)}</ul>
                  </section>
                );
              })()}
              {d?.sample ? <p className="st-note">{(d.sample as { note: string }).note}</p> : null}
            </div>
          </PxSection>
          <PxSection kicker="REST · JSON" title="Endpoints" id="endpoints">
            <div className="tl-stack">
              <div className="st-code">
                {endpoints.map(([k, u]) => <div key={k}><span>{k}</span><code>{u}</code></div>)}
              </div>
              <p className="st-note">Watching: every list takes <code>since</code> (an ISO time) and answers with <code>next.since</code> to send on the next poll. Webhook watch plans ($5–20 a month) are designed, not live: see <code>x-nightshift-planned</code> in <a href="/openapi.json" target="_blank" rel="noreferrer">/openapi.json</a>. For people, the community's <a href="https://www.imdradar.site" target="_blank" rel="noreferrer">IMD Radar</a> has charts and swaps; this feed is the API for agents.</p>
            </div>
          </PxSection>
          <PxSection kicker="X402 · MCP" title="Prices" id="prices">
            <div className="tl-stack">
              <Prices ids={["imd-feed"]} index={index} />
              <HowTo example="/api/v1/imd/launches?chain=ethereum&limit=20" tools="imd_feed_sample (free), imd_feed (paid)" />
            </div>
          </PxSection>
        </div>
      </div>
    </div>
  );
}
