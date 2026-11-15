import { useEffect, useMemo, useRef, useState } from "react";
import DotGrid from "../../rb/DotGrid";
import StarBorder from "../../rb/StarBorder";
import StatusMark from "../../rb/StatusMark";
import { go, Link } from "../../router";
import { PxHero, PxPanel, PxSection, PxStat, PxStats, PxTag } from "../../saas/kit";
import { PxIcon } from "../../saas/PxIcon";
import { chooseSolana } from "../../wallet";
import { Logo, useRich } from "../LaunchpadPage";
import { actText, adminToken, ago, type BurnNow, type Discovered, imageOf, loadChain, logoData, mine, pct, type Pulse, shortKey, sol, solApi, type SolFeesAdmin, type SolFeesInfo, type SolInfo, type SolLaunch, solscan, type SwarmStep, usd, usdOf } from "./net";
import type { LpFees } from "./chain";
import { HoldersList, MarketChart, TokenLinks, TradesList } from "./Market";
import { CLIFF_DAYS, CURVES, DEV_PCTS, FEES, feeSplit, isStandard, LAUNCH, type LaunchOptions, MCAP_LIMITS, minutes, optionProblem, PAY_NAMES, type PayChain, SNIPER, type Sniper, STANDARD, SWARM, SWARM_ORDER, type SwarmPick, swarmTime, VEST_DAYS } from "./options";
import "./sol.css";
import "./sol-board.css";

type Sign = Awaited<ReturnType<typeof wallet>>;
async function wallet() {
  const w = await chooseSolana();
  if (!w) throw new Error("Connect a Solana wallet to continue.");
  return w as unknown as import("./chain").SolSigner;
}
const payImd = (o: { chainId: PayChain; body: string; say: (s: string) => void }) => import("./imdpay").then((m) => m.payImdJob(o));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The swarm's job paid in SOL: NIGHTSHIFT Swap's quote (checked and simulated by the engine), one signature in the
 * creator's Solana wallet, then Relay followed until the job is paid on Robinhood Chain (usually seconds). Returns
 * the launch as it stands; if Relay is still busy after a while, the token page keeps following it.
 */
async function paySol(mint: string, who: Sign, say: (s: string) => void): Promise<SolLaunch> {
  say("NIGHTSHIFT Swap is pricing the job in SOL…");
  const q = await solApi.relayQuote(mint);
  say(`Pay ${sol(Number(q.lamports) / 1e9, 4)} SOL${q.usd ? ` (≈ ${usd(q.usd)})` : ""} for the swarm's 0.5 IMD job: confirm in your wallet…`);
  const c = await loadChain();
  let sig: string;
  try { sig = await c.payInSol(who, q.tx, say); } catch (e) {
    if (/reject|declin|denied|cancel/i.test((e as Error).message)) throw new Error("You declined in the wallet. Nothing was paid; your launch keeps waiting for its payment.");
    throw e;
  }
  say("Paid. NIGHTSHIFT Swap is buying the IMD on Robinhood Chain and sending IMD the job…");
  let v = await solApi.relaySent(mint, sig);
  for (let i = 0; i < 24 && v.swarm?.state === "unpaid"; i++) {
    const r = v.swarm.relay;
    if (r?.state === "refunded" || r?.state === "failed") throw new Error(r.note ?? "NIGHTSHIFT Swap could not finish the payment.");
    say(r?.note ?? "NIGHTSHIFT Swap is buying the IMD…");
    await sleep(5000);
    v = await solApi.relayCheck(mint);
  }
  return v;
}

/** A stored launch's curve, as the page's Meteora settings (for a config made when the creator signs). */
const optionsOf = (l: SolLaunch): LaunchOptions => ({
  feeBps: l.options.feeBps as LaunchOptions["feeBps"], startMcapUsd: l.options.startMcapUsd, graduateMcapUsd: l.options.graduateMcapUsd,
  sniper: l.options.sniper as Sniper, dev: l.dev && l.dev.pct > 0 ? { ...STANDARD.dev, ...l.dev } as LaunchOptions["dev"] : STANDARD.dev,
});

/**
 * Sign the launch now and NIGHTSHIFT sends it at once: a normal transaction on a recent blockhash, signed by the
 * creator's wallet only (no durable nonce). The launch's own Meteora config is made first when it needs one (a
 * custom curve), with NIGHTSHIFT's fee wallet as partner; a standard launch uses the shared config.
 */
async function signAndSend(o: { mint: string; name: string; symbol: string; uri: string; options: LaunchOptions; devBuySol: number; config?: string | null }, who: Sign, info: SolInfo, say: (s: string) => void): Promise<SolLaunch> {
  if (!info.partner || !info.solUsd) throw new Error("The launchpad cannot be read right now. Try again in a moment.");
  const chain = await loadChain();
  const config = o.config || (await chain.prepareChain({ who, partner: info.partner, shared: info.config, standard: isStandard(o.options), options: o.options, solUsd: info.solUsd, nonce: false, say })).config;
  const tx = await chain.signLaunch({ who, config, mint: o.mint, name: o.name, symbol: o.symbol, uri: o.uri, devBuySol: o.devBuySol, nonce: null, say });
  say("NIGHTSHIFT is checking your signed launch and sending it to Solana…");
  return solApi.signed(o.mint, { tx, config, nonce: null });
}

/** The swarm's time for these picks, from IMD's recent jobs, as the page says it. */
function timeText(picks: Iterable<SwarmPick>, info: SolInfo | null): { typical: string; slow: string } | null {
  const eta = info?.imd.eta;
  if (!eta) return null;
  const [a, b] = swarmTime(picks, eta);
  return { typical: minutes(a), slow: minutes(b) };
}
/** IMD reads a payment a few seconds after it confirms: the engine checks it, with a few tries. */
async function reportPaid(mint: string, chainId: PayChain, hash: string, say: (s: string) => void) {
  for (let i = 0; ; i++) {
    try { return await solApi.paid(mint, chainId, hash); } catch (e) {
      if (i >= 6 || !/not confirmed yet/.test((e as Error).message)) throw e;
      say("Waiting for the payment to be readable…");
      await sleep(4000);
    }
  }
}

function useInfo() {
  const [info, setInfo] = useState<SolInfo | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { solApi.info().then(setInfo).catch((e) => setErr((e as Error).message)); }, []);
  return { info, err };
}
function usePulse() {
  const [p, setP] = useState<Pulse>({});
  useEffect(() => { void solApi.pulse().then(setP); }, []);
  return p;
}

/** /launchpad/sol, /launchpad/sol/new, /launchpad/sol/admin, /launchpad/sol/:mint */
export function SolPages({ seg }: { seg: string[] }) {
  const sub = seg[2];
  useEffect(() => { document.title = `${sub === "new" ? "Launch a token on Solana" : sub === "admin" ? "Solana launch setup" : "IMD Launch on Solana"} · NIGHTSHIFT`; }, [sub]);
  return (
    <div className="sl3">
      <nav className="lp3-crumb" aria-label="Where you are"><Link to="/launchpad">LAUNCHPAD</Link><i aria-hidden="true">/</i><Link to="/launchpad/sol">SOLANA</Link><i aria-hidden="true">/</i><span className="imd">BUILT ON IMD</span></nav>
      {!sub ? <SolHome /> : sub === "new" ? <SolNew /> : sub === "admin" ? <SolAdmin /> : <SolToken key={sub} mint={sub} />}
    </div>
  );
}

/** The IMD swarm, live: the agents doing the work behind the launches. */
function ImdPanel({ info }: { info: SolInfo | null }) {
  const p = usePulse();
  return (
    <PxPanel title="THE IMD SWARM" state={p.agentsOnline ? "live" : "idle"} tone="imd" right="api.imd.fun">
      <div className="sl3-imd-n">
        <div><b>{p.agentsOnline?.toLocaleString("en-US") ?? "—"}</b><span>AGENTS ONLINE</span></div>
        <div><b>{p.jobsDoneLastDay ?? "—"}</b><span>JOBS DONE TODAY</span></div>
        <div><b>{info?.counts.waiting ?? "—"}</b><span>LAUNCHES WITH THE SWARM</span></div>
        <div><b>{info?.counts.swarm ?? "—"}</b><span>SOLANA LAUNCHES BUILT BY IMD</span></div>
      </div>
      <ul className="sl3-imd-l">
        <li><PxIcon name="shield" size={13} />Pick what the swarm does before you launch: a review that decides if it goes live, the logo, an X banner, the website.</li>
        <li><PxIcon name="coin" size={13} />One IMD job, {info?.imd.price ?? 0.5} IMD, paid from your own Ethereum or Robinhood Chain wallet straight to IMD.</li>
        <li><PxIcon name="lock" size={13} />You pay the swarm first. When it is done, its work is already in your token: you sign once and it goes live on Solana. Or launch at once, without the swarm.</li>
      </ul>
    </PxPanel>
  );
}

function Spark({ v, w = 96, h = 26 }: { v?: number[]; w?: number; h?: number }) {
  if (!v || v.length < 2) return <svg className="sl3-spark" width={w} height={h} aria-hidden="true" />;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || hi || 1;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((y - lo) / span) * (h - 4)).toFixed(1)}`).join(" ");
  const up = v[v.length - 1]! >= v[0]!;
  return <svg className={`sl3-spark ${up ? "up" : "down"}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={pts} fill="none" strokeWidth="1.6" /></svg>;
}

const stepsDone = (l: SolLaunch) => (l.swarm?.steps ?? []).filter((s) => s.state === "done").length;

// ---------------------------------------------------------------- the board and discovery

function SolHome() {
  const { info, err } = useInfo();
  const rich = useRich();
  const [tab, setTab] = useState<"board" | "discover">("board");
  const [rows, setRows] = useState<SolLaunch[] | null>(null);
  const [waiting, setWaiting] = useState<SolLaunch[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () => solApi.list("new").then((r) => { if (alive) { setRows(r.launches); setWaiting(r.waiting); } }).catch(() => alive && setRows([]));
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const solUsd = info?.solUsd ?? null;
  const shown = useMemo(() => (rows ?? []).filter((r) => !q || `${r.name} ${r.symbol} ${r.mint}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const live = shown.filter((r) => r.status === "live");
  const king = [...live].sort((a, b) => b.progress - a.progress)[0];
  const cols: [string, string, SolLaunch[]][] = [
    ["NEW", "just launched", live.filter((r) => r.progress < 0.6)],
    ["ABOUT TO GRADUATE", "60% or more of the curve sold", live.filter((r) => r.progress >= 0.6).sort((a, b) => b.progress - a.progress)],
    ["GRADUATED", "liquidity locked on Meteora", shown.filter((r) => r.status === "graduated")],
  ];
  return (
    <>
      <PxHero
        kicker="IMD LAUNCH · SOLANA" live={!!info?.open} title="IMD launches on Solana." accent="Through NIGHTSHIFT."
        lead={<>The <b>IMD swarm</b> launches tokens on Ethereum and Robinhood Chain. Through NIGHTSHIFT it launches them on <b>Solana</b>: the swarm reviews your token, draws its logo and banner and builds its website, and when it is done you sign once and the token goes live on a Meteora bonding curve, its work already in it. Curves priced in dollars, liquidity locked forever at graduation, your own allocation locked on chain. Your wallets sign everything.</>}
        bg={rich ? <DotGrid dotSize={3} gap={18} baseColor="#10254a" activeColor="#2f7bff" proximity={120} shockRadius={180} shockStrength={3} shape="square" /> : undefined}
        actions={<>
          {info?.open
            ? <StarBorder as="a" href="/launchpad/sol/new" onClick={(e: React.MouseEvent) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go("/launchpad/sol/new"); }} className="sl3-star" color="#b8ff3d" duration={5} thickness={1} radius={2} backgroundColor="#b8ff3d" textColor="#031007" borderColor="rgba(184,255,61,.6)"><PxIcon name="bolt" size={14} />LAUNCH A TOKEN</StarBorder>
            : <span className="px-btn" aria-disabled="true"><PxIcon name="pulse" size={14} />OPENING SOON</span>}
          <Link to="/launchpad" className="px-btn imd"><PxIcon name="blocks" size={14} />IMD LAUNCHES ON ETHEREUM</Link>
        </>}
        aside={<ImdPanel info={info} />}
      />
      {err && <p className="sl3-err" role="alert">{err}</p>}

      <PxStats cols={4}>
        <PxStat label="ON THE CURVE" value={info ? String(info.counts.live) : "—"} sub="trading now" tone="lime" />
        <PxStat label="GRADUATED" value={info ? String(info.counts.graduated) : "—"} sub="locked on Meteora DAMM v2" />
        <PxStat label="WITH THE SWARM" value={info ? String(info.counts.waiting) : "—"} sub="paid, launching when it is done" tone="imd" />
        <PxStat label="SOL" value={solUsd ? `$${solUsd.toFixed(2)}` : "—"} sub={info?.network === "devnet" ? "devnet" : "mainnet"} />
      </PxStats>

      <div className="sl3-tabs big" role="tablist">
        <button role="tab" aria-selected={tab === "board"} className={tab === "board" ? "on" : ""} onClick={() => setTab("board")}>LAUNCHED HERE</button>
        <button role="tab" aria-selected={tab === "discover"} className={tab === "discover" ? "on" : ""} onClick={() => setTab("discover")}>DISCOVER SOLANA</button>
      </div>

      {tab === "board" ? (
        <>
          {waiting.length > 0 && (
            <section className="sl3-wait" aria-label="Launches with the IMD swarm">
              <header><b>WITH THE IMD SWARM</b><span>paid for, going live when the swarm is done and the creator signs</span></header>
              <div className="sl3-wait-r">{waiting.map((l) => (
                <Link key={l.mint} to={`/launchpad/sol/${l.mint}`} className="sl3-wait-c">
                  <Logo src={imageOf(l) || null} symbol={l.symbol} size={36} />
                  <span><b>{l.name}</b><small>${l.symbol} · {l.status === "ready" ? "ready: the creator signs" : `${stepsDone(l)} of ${l.swarm?.steps.length ?? 0} done`}</small></span>
                  <StatusMark status="running" size={16} color="#8db6ff" doneColor="#2f7bff" errorColor="#ff6b7d" />
                </Link>
              ))}</div>
            </section>
          )}
          {king && <King l={king} solUsd={solUsd} />}
          <div className="sl3-search"><PxIcon name="arrow" size={13} /><input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name, ticker or address" /></div>
          {rows === null ? <p className="sl3-dim">Reading Solana…</p>
            : !rows.length ? <PxPanel title="NO LAUNCHES YET"><p className="sl3-dim">{info?.open ? "Be the first: pick the swarm's work, sign, and it goes live when the swarm finishes." : "The Solana launchpad opens as soon as NIGHTSHIFT's partner wallet is set."}</p></PxPanel>
              : <div className="sl3-cols">{cols.map(([k, sub, list]) => (
                <section key={k} className="sl3-col">
                  <header><b>{k}</b><span>{sub}</span><i>{list.length}</i></header>
                  {list.length ? list.slice(0, 30).map((r) => <Row key={r.mint} l={r} solUsd={solUsd} />) : <p className="sl3-dim">Nothing here yet.</p>}
                </section>
              ))}</div>}
        </>
      ) : <Discover />}


      <PxSection kicker="HOW AN IMD LAUNCH WORKS" title={<>The swarm does the work. <em>The chain keeps the promises.</em></>}>
        <ol className="sl3-how">
          <li><b>01 · Describe it</b><span>Name, ticker, links, and Meteora's settings: the market caps it starts and graduates at, in dollars; the fee; the anti-sniper fee; your own locked allocation.</span></li>
          <li className="imd"><b>02 · Pick the swarm's work</b><span>A review that decides if it launches, the logo, an X banner, the website. One IMD job, 0.5 IMD, checked by IMD for free first, paid in SOL from your Solana wallet (NIGHTSHIFT Swap converts it) or in IMD. Or skip it and launch now.</span></li>
          <li className="imd"><b>03 · The swarm works, then you sign</b><span>Follow the swarm on your token's page, with the time it usually takes. When it is done, its logo, banner and site are already in your token: you sign once and it goes live.</span></li>
          <li><b>04 · Graduation</b><span>At the target the curve becomes a Meteora DAMM v2 pool with 100% of its liquidity locked forever. Your allocation then unlocks on the schedule you set.</span></li>
        </ol>
      </PxSection>
    </>
  );
}

function King({ l, solUsd }: { l: SolLaunch; solUsd: number | null }) {
  return (
    <Link to={`/launchpad/sol/${l.mint}`} className="sl3-king pk-panel">
      <span className="sl3-crown" aria-hidden="true">KING OF THE HILL</span>
      <Logo src={imageOf(l) || null} symbol={l.symbol} size={64} />
      <div className="sl3-king-t"><b>{l.name}</b><span>${l.symbol} · {ago(l.launchedAt ?? l.createdAt)}</span><p>{l.description || "Closest to graduating on the curve right now."}</p></div>
      <div className="sl3-king-n"><span>MARKET CAP</span><b>{usdOf(l.mcapSol, solUsd)}</b><div className="sl3-bar"><i style={{ width: `${Math.max(2, l.progress * 100)}%` }} /></div><small>{Math.round(l.progress * 100)}% to graduation</small></div>
    </Link>
  );
}

function Row({ l, solUsd }: { l: SolLaunch; solUsd: number | null }) {
  const bad = l.checks.filter((c) => c.ok === false).length;
  return (
    <Link to={`/launchpad/sol/${l.mint}`} className="sl3-row-c">
      <Logo src={imageOf(l) || null} symbol={l.symbol} size={44} />
      <div className="sl3-row-t">
        <b>{l.name} <span>${l.symbol}</span></b>
        <small>{usdOf(l.mcapSol, solUsd)} mcap · {ago(l.launchedAt ?? l.createdAt)}</small>
        <div className="sl3-row-tags">
          {l.swarm?.verdict?.launch && <PxTag tone="imd">IMD REVIEWED</PxTag>}
          {l.swarm?.state === "done" && !l.swarm.verdict && <PxTag tone="imd">BUILT BY IMD</PxTag>}
          {l.dev && <PxTag tone="gold">{l.dev.pct}% LOCKED</PxTag>}
          {bad > 0 && <PxTag tone="red">{bad} FLAG{bad > 1 ? "S" : ""}</PxTag>}
        </div>
      </div>
      <div className="sl3-row-n">
        <Spark v={l.spark} />
        <span className={(l.change1h ?? 0) >= 0 ? "up" : "down"}>{pct(l.change1h)}</span>
        {l.status === "live" && <div className="sl3-bar thin"><i style={{ width: `${Math.max(2, l.progress * 100)}%` }} /></div>}
      </div>
    </Link>
  );
}

function Discover() {
  const [d, setD] = useState<{ at: number; items: Discovered[] } | null>(null);
  const [err, setErr] = useState("");
  const [pad, setPad] = useState("all");
  const [sort, setSort] = useState<"trending" | "new" | "mcap" | "h1">("trending");
  useEffect(() => { solApi.discover().then(setD).catch((e) => setErr((e as Error).message)); }, []);
  const items = useMemo(() => {
    const all = (d?.items ?? []).filter((x) => pad === "all" || (pad === "other" ? !x.launchpad : x.launchpad === pad));
    const by = { trending: (a: Discovered, b: Discovered) => Number(b.boosted) - Number(a.boosted) || (b.vol24 ?? 0) - (a.vol24 ?? 0), new: (a: Discovered, b: Discovered) => (b.createdAt ?? 0) - (a.createdAt ?? 0), mcap: (a: Discovered, b: Discovered) => (b.mcapUsd ?? 0) - (a.mcapUsd ?? 0), h1: (a: Discovered, b: Discovered) => (b.change1h ?? -1e9) - (a.change1h ?? -1e9) }[sort];
    return all.sort(by);
  }, [d, pad, sort]);
  return (
    <section className="sl3-disc">
      <div className="sl3-disc-h">
        <div className="sl3-tabs">{["all", "pump.fun", "Meteora DBC", "Bags", "LetsBonk", "other"].map((k) => <button key={k} className={pad === k ? "on" : ""} onClick={() => setPad(k)}>{k.toUpperCase()}</button>)}</div>
        <div className="sl3-tabs">{([["trending", "TRENDING"], ["new", "NEW"], ["mcap", "MARKET CAP"], ["h1", "1H"]] as const).map(([k, l]) => <button key={k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{l}</button>)}</div>
      </div>
      <p className="sl3-dim">What is moving on Solana's launchpads right now, from DexScreener. These were not launched here and NIGHTSHIFT has not checked them; tokens like these are high risk.</p>
      {err && <p className="sl3-err">{err}</p>}
      {!d ? <p className="sl3-dim">Reading Solana's launchpads…</p> : !items.length ? <p className="sl3-dim">Nothing to show for this filter.</p> : (
        <div className="sl3-disc-t" role="table">
          <div className="sl3-disc-r head" role="row"><span>TOKEN</span><span>LAUNCHPAD</span><span>MARKET CAP</span><span>VOL 24H</span><span>1H</span><span>24H</span><span>TXNS 24H</span><span>AGE</span><span /></div>
          {items.slice(0, 60).map((x) => (
            <div key={x.mint} className="sl3-disc-r" role="row">
              <span className="tok"><Logo src={x.image} symbol={x.symbol} size={30} /><b>{x.name}</b><small>${x.symbol}{x.boosted ? " · boosted" : ""}</small></span>
              <span>{x.launchpad ? <PxTag tone={x.launchpad === "Meteora DBC" || x.launchpad.startsWith("IMD") ? "imd" : "dim"}>{x.launchpad}</PxTag> : <small>{x.dex}</small>}</span>
              <span className="num">{usd(x.mcapUsd)}</span>
              <span className="num">{usd(x.vol24)}</span>
              <span className={`num ${(x.change1h ?? 0) >= 0 ? "up" : "down"}`}>{pct(x.change1h)}</span>
              <span className={`num ${(x.change24h ?? 0) >= 0 ? "up" : "down"}`}>{pct(x.change24h)}</span>
              <span className="num">{x.buys24 + x.sells24}</span>
              <span className="num">{ago(x.createdAt)}</span>
              <span className="go"><a href={x.url} target="_blank" rel="noreferrer nofollow">CHART ↗</a><a href={`https://jup.ag/swap/SOL-${x.mint}`} target="_blank" rel="noreferrer nofollow">TRADE ↗</a></span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- launch a token

type Step = { label: string; status: "pending" | "running" | "done" | "failed" };
const Seg = <T extends string | number>({ v, set, opts }: { v: T; set: (x: T) => void; opts: readonly (readonly [T, string])[] }) => (
  <div className="sl3-seg" role="radiogroup">{opts.map(([k, l]) => <button key={String(k)} type="button" role="radio" aria-checked={v === k} className={v === k ? "on" : ""} onClick={() => set(k)}>{l}</button>)}</div>
);
const dollars = (s: string) => Math.round(Number(s.replace(/[^0-9.]/g, "")) || 0);

function SolNew() {
  const { info } = useInfo();
  const [f, setF] = useState({ name: "", symbol: "", description: "", website: "", twitter: "", telegram: "", imageUrl: "" });
  const [logo, setLogo] = useState("");
  const [logoIdea, setLogoIdea] = useState("");
  const [mode, setMode] = useState<"standard" | "custom">("standard");
  const [o, setO] = useState<LaunchOptions>(STANDARD);
  const [caps, setCaps] = useState({ start: String(STANDARD.startMcapUsd), graduate: String(STANDARD.graduateMcapUsd) });
  const [picks, setPicks] = useState<Set<SwarmPick>>(new Set(["review", "website"]));
  const [payChain, setPayChain] = useState<PayChain>(1);
  const [payMode, setPayMode] = useState<"sol" | "evm">("sol");
  const [solPrice, setSolPrice] = useState<{ lamports: string; usd: number | null } | null>(null);
  const [devBuy, setDevBuy] = useState("0");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState("");
  const [err, setErr] = useState("");
  const [left, setLeft] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [raise, setRaise] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const opts: LaunchOptions = mode === "standard" ? { ...STANDARD, dev: o.dev } : o;
  const solUsd = info?.solUsd ?? 0;
  const swarm = picks.size > 0 && !!info?.imd.on;
  const buy = Math.max(0, Math.min(LAUNCH.devBuyMaxSol, Number(devBuy) || 0));
  const own = !(info?.config && isStandard(opts));
  const problem = optionProblem(opts);
  const split = feeSplit(opts.feeBps, 100);
  const hasLogo = !!(logo || f.imageUrl.trim());
  // an uploaded logo stays the token's image: the swarm's logo step comes off (and is not paid for)
  useEffect(() => { if (hasLogo && picks.has("logo")) setPicks((s) => { const n = new Set(s); n.delete("logo"); return n; }); }, [hasLogo, picks]);
  const logoOk = hasLogo || picks.has("logo");
  // the swarm paid in SOL from the same wallet (NIGHTSHIFT Swap), unless the creator picks the EVM route
  const inSol = swarm && payMode === "sol" && !!info?.imd.solPay;
  const solOff = inSol && info?.network !== "mainnet";
  // wallets hide tokens with a web address in the name as spam (the name is frozen at launch)
  const linkInName = /https?:|www\.|[a-z0-9-]\.[a-z]{2,}\b/i.test(f.name);
  const ready = info?.open && !!info.partner && f.name.trim().length >= 2 && !linkInName && /^[A-Za-z0-9]{2,10}$/.test(f.symbol.trim()) && logoOk && agree && !busy && !problem && solUsd > 0 && !solOff;
  const swarmSol = inSol && solPrice ? Number(solPrice.lamports) / 1e9 : 0;
  const totalSol = LAUNCH.createFeeSol + (own ? LAUNCH.configRentSol : 0) + buy + 0.02 + swarmSol;
  const imdUsd = info ? info.imd.price * info.imd.imdUsd : null;
  const eta = timeText(picks, info);
  useEffect(() => { if (!info) return; if (info.imd.solPay) void solApi.swarmPrice().then((p) => setSolPrice(p)); else setPayMode("evm"); }, [info]);

  // what the curve raises at today's SOL price, from Meteora's own math (the SDK loads on this page)
  useEffect(() => {
    if (!solUsd || problem) { setRaise(null); return; }
    const t = setTimeout(() => { loadChain().then((c) => setRaise(c.curvePreview(opts, solUsd)?.raiseSol ?? null)).catch(() => setRaise(null)); }, 250);
    return () => clearTimeout(t);
  }, [solUsd, problem, opts.feeBps, opts.startMcapUsd, opts.graduateMcapUsd, opts.sniper, opts.dev.pct]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files?.[0];
    if (!fl) return;
    try { setLogo(await logoData(fl)); setErr(""); } catch (x) { setErr((x as Error).message); }
  }
  const toggle = (p: SwarmPick) => { const n = new Set(picks); if (n.has(p)) n.delete(p); else n.add(p); setPicks(n); };
  const setCurve = (start: number, graduate: number) => { setMode("custom"); setCaps({ start: String(start), graduate: String(graduate) }); setO({ ...opts, startMcapUsd: start, graduateMcapUsd: graduate }); };

  async function run() {
    if (!info?.partner) return;
    setBusy(true); setErr(""); setLeft(null);
    // with the swarm: pay now, sign the launch when the swarm is done (on the token's page). Without: sign now.
    const labels = (swarm
      ? ["Connect your Solana wallet", "IMD checks the swarm's job (free)", inSol ? "Pay the swarm in SOL: NIGHTSHIFT Swap buys the IMD" : `Pay ${info.imd.price} IMD on ${PAY_NAMES[payChain]}`, "The swarm works: you sign the launch when it is done"]
      : ["Connect your Solana wallet", "Save the token's details", own ? "Your launch's Meteora settings" : null, "Sign the launch", "Live on Solana"]).filter(Boolean) as string[];
    const st: Step[] = labels.map((label, i) => ({ label, status: i ? "pending" : "running" }));
    const mark = (s: Step["status"]) => { const i = st.findIndex((x) => x.status === "running"); if (i < 0) return; st[i]!.status = s; if (s === "done" && st[i + 1]) st[i + 1]!.status = "running"; setSteps([...st]); };
    setSteps([...st]);
    let mint = "";
    try {
      const who = await wallet(); mark("done");
      const symbol = f.symbol.trim().toUpperCase();
      const prep = await solApi.prepare({
        name: f.name.trim(), symbol, description: f.description.trim(), website: f.website.trim(), twitter: f.twitter.trim(), telegram: f.telegram.trim(),
        ...(logo ? { image: logo } : f.imageUrl.trim() ? { imageUrl: f.imageUrl.trim() } : {}), logoIdea: logoIdea.trim(),
        options: { feeBps: opts.feeBps, startMcapUsd: opts.startMcapUsd, graduateMcapUsd: opts.graduateMcapUsd, sniper: opts.sniper }, dev: opts.dev, devBuySol: buy,
        swarm: swarm ? SWARM_ORDER.filter((p) => picks.has(p)) : [], chainId: payChain, creator: who.address,
      });
      if (prep.swarm?.blockers.length) throw new Error(`IMD's check would refuse the swarm's job: ${prep.swarm.blockers.join(" ")} Change the details, or launch without the swarm.`);
      mint = prep.mint;
      mine.add(mint);
      mark("done");
      if (swarm && prep.swarm) {
        // pay the swarm now; the launch is signed on its page when the swarm is done (nothing to sign before)
        setLeft(mint);
        if (inSol) await paySol(mint, who, setSay);
        else {
          const hash = await payImd({ chainId: payChain, body: prep.swarm.body, say: setSay });
          setSay("Checking the payment…");
          await reportPaid(mint, payChain, hash, setSay);
        }
        mark("done");
      } else {
        const chain = await loadChain();
        const pc = await chain.prepareChain({ who, partner: info.partner, shared: info.config, standard: isStandard(opts), options: opts, solUsd, nonce: false, say: setSay });
        if (own) mark("done");
        const tx = await chain.signLaunch({ who, config: pc.config, mint, name: f.name.trim(), symbol, uri: prep.uri, devBuySol: buy, nonce: null, say: setSay });
        setSay("Sending it to Solana…");
        await solApi.signed(mint, { tx, config: pc.config, nonce: null });
        mark("done");
        mark("done");
      }
      go(`/launchpad/sol/${mint}`);
    } catch (e) {
      mark("failed");
      setErr((e as Error).message);
    } finally { setBusy(false); setSay(""); }
  }

  if (info && !info.open) return <PxPanel title="OPENING SOON"><p className="sl3-dim">IMD Launch on Solana opens as soon as NIGHTSHIFT's partner wallet is set. <Link to="/launchpad/sol">Back to the launchpad</Link></p></PxPanel>;
  const setDev = (d: Partial<LaunchOptions["dev"]>) => setO({ ...opts, dev: { ...opts.dev, ...d } });
  return (
    <>
      <PxHero kicker="IMD LAUNCH · SOLANA · NEW" title="Launch on Solana" accent="with the IMD swarm." lead="Describe your token, set its bonding curve and pick what the IMD swarm does for it. With the swarm, you pay it now and sign the launch when it is done: its work is added to the token before it goes live. Without it, you sign now and it goes live now." />
      <div className="sl3-new">
        <div className="sl3-side">
          <PxPanel title="1 · THE TOKEN" className="sl3-form">
            <label>Name<input className="field" value={f.name} onChange={set("name")} maxLength={32} placeholder="Night Frog" />{linkInName && <small className="sl3-err">No web addresses in the name (like imd.fun or a link): Phantom hides those tokens as spam. Put the link in Website.</small>}</label>
            <label>Ticker<input className="field" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} maxLength={10} placeholder="NFROG" /></label>
            <label>What it is <small>optional, the IMD swarm reads it too</small><textarea className="field" value={f.description} onChange={set("description")} maxLength={500} rows={3} placeholder="One or two lines people read before they buy." /></label>
            <div className="sl3-logo">
              {logo ? <img src={logo} alt="" width={72} height={72} /> : <span className="sl3-logo-empty" aria-hidden="true"><PxIcon name="grid" size={22} /></span>}
              <div>
                <button className="px-btn" type="button" onClick={() => file.current?.click()}><PxIcon name="arrow" size={14} />{logo ? "CHANGE LOGO" : "UPLOAD LOGO"}</button>
                <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pickLogo} />
                {!logo && <input className="field" value={f.imageUrl} onChange={set("imageUrl")} placeholder="or an https:// link to the image" />}
                {!hasLogo && <small className="sl3-dim">{picks.has("logo") ? "The IMD swarm draws it (step 4)." : "Or tick LOGO in step 4 and the swarm draws it."}</small>}
              </div>
            </div>
            <div className="sl3-links">
              <label>Website<input className="field" value={f.website} onChange={set("website")} placeholder="https://" /></label>
              <label>X<input className="field" value={f.twitter} onChange={set("twitter")} placeholder="https://x.com/…" /></label>
              <label>Telegram<input className="field" value={f.telegram} onChange={set("telegram")} placeholder="https://t.me/…" /></label>
            </div>
          </PxPanel>

          <PxPanel title="2 · THE BONDING CURVE" right={mode === "standard" ? "STANDARD" : "CUSTOM"} className="sl3-form">
            <Seg v={mode} set={(m) => { setMode(m); if (m === "custom") { setO({ ...STANDARD, dev: opts.dev }); setCaps({ start: String(STANDARD.startMcapUsd), graduate: String(STANDARD.graduateMcapUsd) }); } }} opts={[["standard", "STANDARD"], ["custom", "CUSTOM"]] as const} />
            <p className="sl3-dim">{mode === "standard" ? `1% fee, $5K → $75K market cap, the standard anti-sniper fee.${info?.config ? " Uses NIGHTSHIFT's shared Meteora config." : ""}` : "Your launch gets its own Meteora config with NIGHTSHIFT as its partner: about 0.009 SOL of rent, one more signature."}</p>
            {mode === "custom" && <>
              <label>Quick picks<div className="sl3-seg">{CURVES.map((c) => <button key={c.label} type="button" className={o.startMcapUsd === c.start && o.graduateMcapUsd === c.graduate ? "on" : ""} onClick={() => setCurve(c.start, c.graduate)} title={c.says}>{c.label}</button>)}</div></label>
              <div className="sl3-caps">
                <label>Starts at <small>market cap, $</small><input className="field" inputMode="numeric" value={caps.start} onChange={(e) => { setCaps({ ...caps, start: e.target.value }); setO({ ...o, startMcapUsd: dollars(e.target.value) }); }} /></label>
                <label>Graduates at <small>market cap, $</small><input className="field" inputMode="numeric" value={caps.graduate} onChange={(e) => { setCaps({ ...caps, graduate: e.target.value }); setO({ ...o, graduateMcapUsd: dollars(e.target.value) }); }} /></label>
              </div>
              <p className="sl3-dim">From {usd(MCAP_LIMITS.start[0])} to {usd(MCAP_LIMITS.start[1])} to start, up to {usd(MCAP_LIMITS.graduate[1])} to graduate, graduation at least twice the start.</p>
              <label>Trading fee <small>creator {split.creator.toFixed(3)}% · NIGHTSHIFT {split.nightshift.toFixed(3)}% · Meteora {split.meteora.toFixed(3)}%</small><Seg v={o.feeBps} set={(v) => setO({ ...o, feeBps: v })} opts={FEES.map((b) => [b, `${b / 100}%`] as const)} /></label>
              <label>Anti-sniper fee <small>{SNIPER[o.sniper].says}</small><Seg v={o.sniper} set={(v: Sniper) => setO({ ...o, sniper: v })} opts={(Object.keys(SNIPER) as Sniper[]).map((k) => [k, SNIPER[k].label] as const)} /></label>
            </>}
            <dl className="sl3-terms">
              <div><dt>Opens at</dt><dd>{usd(opts.startMcapUsd)} <small>market cap</small></dd></div>
              <div><dt>Graduates at</dt><dd>{usd(opts.graduateMcapUsd)} <small>market cap</small></dd></div>
              <div><dt>Raises to graduate</dt><dd>{raise ? <>{sol(raise, 1)} SOL <small>≈ {usd(raise * solUsd)} today</small></> : "—"}</dd></div>
              <div><dt>Then</dt><dd>Meteora DAMM v2 <small>· 100% of the liquidity locked forever, {opts.feeBps / 100}% fee</small></dd></div>
            </dl>
          </PxPanel>

          <PxPanel title="3 · YOUR ALLOCATION" right="locked on chain" className="sl3-form" tone="gold">
            <label>Share of the supply you keep<Seg v={opts.dev.pct} set={(v) => { if (mode === "standard" && v > 0) setMode("custom"); setDev({ pct: v, ...(v > 0 && opts.dev.pct === 0 ? { cliffDays: 90, vestDays: 365 } : {}) }); }} opts={DEV_PCTS.map((p) => [p, p ? `${p}%` : "NONE"] as const)} /></label>
            {opts.dev.pct > 0 && <>
              <label>Locked after graduation for<Seg v={opts.dev.cliffDays} set={(v) => setDev({ cliffDays: v })} opts={CLIFF_DAYS.map((d) => [d, d ? `${d} DAYS` : "NO WAIT"] as const)} /></label>
              <label>Then released daily over<Seg v={opts.dev.vestDays} set={(v) => setDev({ vestDays: v })} opts={VEST_DAYS.map((d) => [d, `${d} DAYS`] as const)} /></label>
              <p className="sl3-lock">{((LAUNCH.supply * opts.dev.pct) / 100).toLocaleString("en-US")} tokens are yours, held by Meteora's program: none move before the token graduates; then {opts.dev.cliffDays ? `${opts.dev.cliffDays} days later ` : ""}they unlock a little each day for {opts.dev.vestDays} days. Every buyer sees this on the token page.</p>
            </>}
            {opts.dev.pct === 0 && <p className="sl3-dim">All 1,000,000,000 tokens go on the curve: you buy like everyone else.</p>}
          </PxPanel>
        </div>

        <div className="sl3-side">
          <PxPanel title="4 · THE IMD SWARM" tone="imd" state={info?.imd.on ? "live" : "idle"} right={!picks.size ? "OFF" : inSol && solPrice ? `≈ ${sol(Number(solPrice.lamports) / 1e9, 4)} SOL` : `${info?.imd.price ?? 0.5} IMD${imdUsd ? ` ≈ ${usd(imdUsd)}` : ""}`}>
            <p className="sl3-dim">Tick what the swarm does before your token goes live. Everything you tick is one IMD job, {info?.imd.price ?? 0.5} IMD. You pay it now; when the swarm is done, you sign the launch.</p>
            <div className="sl3-picks">
              {SWARM_ORDER.map((p) => {
                // the creator's own logo stays: with one uploaded, the swarm does not draw another
                const own = p === "logo" && hasLogo;
                return (
                  <button key={p} type="button" role="checkbox" aria-checked={picks.has(p) && !own} disabled={own} className={`sl3-pick${picks.has(p) && !own ? " on" : ""}`} onClick={() => toggle(p)}>
                    <i aria-hidden="true">{picks.has(p) && !own ? "■" : "□"}</i><b>{SWARM[p].label}</b><span>{own ? "You uploaded a logo: it stays the token's image, so the swarm does not draw one." : SWARM[p].says}</span><small>{SWARM[p].skill}</small>
                  </button>
                );
              })}
            </div>
            {picks.has("logo") && !hasLogo && <label>What the logo shows <small>the swarm reads it</small><input className="field" value={logoIdea} onChange={(e) => setLogoIdea(e.target.value)} maxLength={200} placeholder="a green frog in a black hoodie, pixel art, lime eyes" /></label>}
            {picks.size > 0
              ? <>
                <label>Pay the swarm<Seg v={payMode} set={setPayMode} opts={(info?.imd.solPay ? [["sol", "IN SOL · YOUR SOLANA WALLET"], ["evm", "IN IMD · AN EVM WALLET"]] : [["evm", "IN IMD · AN EVM WALLET"]]) as readonly (readonly ["sol" | "evm", string])[]} /></label>
                <dl className="sl3-terms">
                  <div><dt>The job</dt><dd>{info?.imd.price ?? 0.5} IMD <small>one job, whatever you tick</small></dd></div>
                  {payMode === "sol" && info?.imd.solPay
                    ? <div><dt>You pay</dt><dd>{solPrice ? <><b>≈ {sol(Number(solPrice.lamports) / 1e9, 4)} SOL</b> <small>{solPrice.usd ? `≈ ${usd(solPrice.usd)} · ` : ""}the exact price before you sign</small></> : <small>priced when you pay</small>}</dd></div>
                    : <div><dt>You pay</dt><dd><b>{info?.imd.price ?? 0.5} IMD</b> <small>on {PAY_NAMES[payChain]}{imdUsd ? ` ≈ ${usd(imdUsd)}` : ""}, plus gas</small></dd></div>}
                  {eta && <div><dt>Time, approx.</dt><dd><b>about {eta.typical}</b> <small>up to {eta.slow} when IMD is busy</small></dd></div>}
                </dl>
                {!(payMode === "sol" && info?.imd.solPay) && <label>Pay IMD on<Seg v={payChain} set={setPayChain} opts={[[1, "ETHEREUM"], [4663, "ROBINHOOD CHAIN"]] as const} /><small>From your own EVM wallet, straight to IMD's Intake. {payChain === 4663 ? "Cents of gas." : "Where most IMD is held."}</small></label>}
                <ol className="sl3-pay">
                  {payMode === "sol" && info?.imd.solPay
                    ? <>
                      <li><b>You pay the swarm now, in SOL</b><span>From your Solana wallet (Phantom or another): one signature, after IMD checks the job for free. Nothing else to buy or hold.</span></li>
                      <li><b>NIGHTSHIFT Swap converts it</b><span>Our swap's Relay route buys exactly {info.imd.price} IMD on Robinhood Chain and pays IMD's Intake for the job, usually in under a minute. If Relay cannot fill it, it refunds your SOL to your wallet.</span></li>
                    </>
                    : <li><b>You pay the swarm now, in IMD</b><span>{info?.imd.price ?? 0.5} IMD from your EVM wallet on {PAY_NAMES[payChain]}, straight to IMD's Intake, after IMD checks the job for free.</span></li>}
                  <li><b>The IMD swarm runs the job</b><span>{SWARM_ORDER.filter((p) => picks.has(p)).map((p) => ({ review: "the review", logo: "the logo", banner: "the X banner", website: "the website" })[p]).join(", ")}, one step after another{eta ? `, about ${eta.typical} (up to ${eta.slow})` : ""}. Follow it live on your token's page.</span></li>
                  <li><b>Added to your token automatically</b><span>{[picks.has("logo") && "the logo becomes its image", picks.has("banner") && "the banner goes on its page and in its metadata", picks.has("website") && `the site becomes its website (or sits next to yours)${picks.has("review") || picks.has("banner") ? `, with ${[picks.has("review") && "the review", picks.has("banner") && "the banner"].filter(Boolean).join(" and ")} on it` : ""}`, picks.has("review") && "the review decides if it launches"].filter(Boolean).join("; ")}. All before it goes live.</span></li>
                  <li><b>You sign, it goes live</b><span>When the swarm is done, your token's page shows SIGN TO LAUNCH. One signature in your Solana wallet and NIGHTSHIFT sends it to Solana at once, with your first buy if you set one. Nothing is on Solana before.</span></li>
                </ol>
                {eta && <p className="sl3-dim sl3-eta">{info?.imd.eta?.basis}</p>}
                {solOff && <p className="sl3-err">This launchpad is on devnet: paying in SOL works on Solana mainnet only. Use IN IMD to test.</p>}
              </>
              : <p className="sl3-say">No swarm: your token goes live as soon as you sign.</p>}
            {picks.size > 0 && <button type="button" className="px-btn" onClick={() => setPicks(new Set())}>LAUNCH WITHOUT THE SWARM</button>}
            {!info?.imd.on && picks.size > 0 && <p className="sl3-err">IMD is not reachable from NIGHTSHIFT right now: launch without the swarm, or try again later.</p>}
          </PxPanel>
          <PxPanel title="5 · YOUR FIRST BUY" right="optional">
            <label>SOL to buy at launch<input className="field" inputMode="decimal" value={devBuy} onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
            <p className="sl3-dim">In the launch transaction itself, so nobody buys before you; it pays the normal fee. Up to {LAUNCH.devBuyMaxSol} SOL{solUsd && buy ? ` (about ${usd(buy * solUsd)})` : ""}, shown publicly.{swarm ? " With the swarm, it is bought when you sign the launch, after the swarm is done." : ""}</p>
          </PxPanel>
          <PxPanel title="LAUNCH">
            <dl className="sl3-terms">
              <div><dt>Launch fee</dt><dd>{LAUNCH.createFeeSol} SOL</dd></div>
              {own && <div><dt>Your Meteora config</dt><dd>~{LAUNCH.configRentSol} SOL <small>· rent</small></dd></div>}
              <div><dt>First buy</dt><dd>{buy} SOL</dd></div>
              <div><dt>Network fees</dt><dd>~0.02 SOL</dd></div>
              {inSol && <div><dt>The IMD swarm, now</dt><dd>{solPrice ? `≈ ${sol(swarmSol, 4)} SOL` : "priced when you pay"} <small>· {info?.imd.price} IMD through NIGHTSHIFT Swap</small></dd></div>}
              <div><dt>On Solana</dt><dd><b>{sol(totalSol, 3)} SOL</b> <small>{solUsd ? `≈ ${usd(totalSol * solUsd)}` : ""}{inSol ? " · the swarm now, the rest when you sign" : swarm ? " · when you sign" : ""}</small></dd></div>
              {swarm && !inSol && <div><dt>The IMD swarm, now</dt><dd><b>{info?.imd.price} IMD</b> <small>on {PAY_NAMES[payChain]}{imdUsd ? ` ≈ ${usd(imdUsd)}` : ""}</small></dd></div>}
              {swarm && eta && <div><dt>You sign in</dt><dd>about {eta.typical} <small>· up to {eta.slow}, approx.: then it goes live</small></dd></div>}
            </dl>
            <label className="sl3-agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> <span>I understand the token is frozen once launched (name, ticker, supply, settings), {swarm ? "that with the swarm I sign the launch when the swarm is done, that it never launches if the review says no, " : ""}and that tokens like this can lose all their value.</span></label>
            {problem && <p className="sl3-err">{problem}</p>}
            {!logoOk && <p className="sl3-dim">Add a logo, or tick LOGO for the swarm.</p>}
            <button className="px-btn primary sl3-go" disabled={!ready} onClick={() => void run()}><PxIcon name="bolt" size={14} />{busy ? "WORKING…" : swarm ? "PAY THE SWARM AND START" : "LAUNCH ON SOLANA NOW"}</button>
            {say && <p className="sl3-say" aria-live="polite">{say}</p>}
            {steps.length > 0 && <ol className="sl3-steps">{steps.map((s) => <li key={s.label}><StatusMark status={s.status} size={18} color="#b8ff3d" doneColor="#b8ff3d" errorColor="#ff6b7d" /><span>{s.label}</span></li>)}</ol>}
            {err && <p className="sl3-err" role="alert">{err}</p>}
            {left && err && <p className="sl3-dim">Your launch is saved and waits for its payment. <Link to={`/launchpad/sol/${left}`}>Pay and follow it on its page</Link>.</p>}
          </PxPanel>
          {Date.now() < Date.UTC(2026, 11, 31) && <PxPanel title="OLD NONCE RENT" right="before 16 november"><NonceRent /></PxPanel>}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- one token

const STEP_MARK: Record<SwarmStep["state"], "pending" | "running" | "done" | "failed"> = { waiting: "pending", working: "running", done: "done", failed: "failed" };

/** The swarm's work on a launch: each picked step, its files, the job on IMD's explorer. */
/**
 * About how long is left, from IMD's recent job times (info.imd.eta): the steps not done yet, less the time the
 * current one has already run. Approximate; past the slow estimate it says so instead of counting below zero.
 */
function swarmLeft(w: NonNullable<SolLaunch["swarm"]>, eta: NonNullable<SolInfo["imd"]["eta"]>, now: number): string | null {
  if (!w.paidAt || w.state === "done" || w.state === "failed" || w.state === "refused") return null;
  const left = w.steps.filter((s) => s.state !== "done" && s.state !== "failed");
  if (!left.length) return "Finishing: the work is being added to the token.";
  const since = Math.max(w.paidAt, ...Object.values(w.doneAt ?? {}).map(Number)) || w.paidAt;
  const ran = (now - since) / 60_000;
  const typ = left.reduce((a, s) => a + eta.steps[s.pick][0], 0) - ran, slow = left.reduce((a, s) => a + eta.steps[s.pick][1], 0) - ran;
  if (slow <= 0) return `Taking longer than IMD's usual (${minutes((now - w.paidAt) / 60_000)} so far): the swarm is still on it.`;
  return typ > 1 ? `About ${minutes(typ)} left, up to ${minutes(slow)} (approximate, from IMD's recent jobs).` : `Any minute now, up to ${minutes(slow)} (approximate).`;
}

const RH_TX = "https://explorer.mainnet.chain.robinhood.com/tx/";
/** What a done step became on the token. */
const APPLIED: Record<SwarmPick, (l: SolLaunch) => string> = {
  review: () => "Done.",
  logo: () => "Done: the token's image.",
  banner: () => "Done: on this page and in the token's metadata.",
  website: (l) => (l.website ? "Done: linked from the token next to the creator's site." : "Done: the token's website."),
};

function SwarmFlow({ l, net, info }: { l: SolLaunch; net: string; info: SolInfo | null }) {
  const w = l.swarm!;
  const paid = w.state !== "unpaid";
  const launched = l.status === "live" || l.status === "graduated";
  const stopped = l.status === "refused" || l.status === "cancelled";
  const links: Partial<Record<SwarmPick, string | null>> = { review: w.report, logo: w.logoHosted || w.logo, banner: w.bannerHosted || w.banner, website: w.site };
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const r = w.relay;
  const inSol = r?.state === "done";
  const left = info?.imd.eta && l.status === "waiting" ? swarmLeft(w, info.imd.eta, now) : null;
  return (
    <ol className="sl3-flow">
      {l.nonce && <li><StatusMark status="done" size={18} color="#8db6ff" doneColor="#2f7bff" errorColor="#ff6b7d" /><span><b>SIGNED EARLY</b>Signed before the swarm on a nonce account (launches before 16 November); NIGHTSHIFT sends it when the swarm finishes.</span></li>}
      <li><StatusMark status={paid ? "done" : r?.state === "sent" ? "running" : "pending"} size={18} color="#8db6ff" doneColor="#2f7bff" errorColor="#ff6b7d" />
        <span><b>{paid ? (inSol ? "PAID IN SOL · NIGHTSHIFT SWAP" : "PAID TO IMD") : r?.state === "sent" ? "PAYING: NIGHTSHIFT SWAP IS CONVERTING" : "WAITING FOR THE PAYMENT"}</b>
          {paid
            ? <>{inSol && r ? <>{sol(Number(r.lamports) / 1e9, 4)} SOL from the creator's wallet{r.solTx && <> (<a href={solscan("tx", r.solTx, net)} target="_blank" rel="noreferrer">Solana ↗</a>)</>}, converted by NIGHTSHIFT Swap into </> : null}0.5 IMD on {PAY_NAMES[w.chainId]}{w.payTx && <> · <a href={`${w.chainId === 1 ? "https://etherscan.io/tx/" : RH_TX}${w.payTx}`} target="_blank" rel="noreferrer">IMD's job paid ↗</a></>}</>
            : r?.state === "sent" ? (r.note ?? "Relay is buying the IMD on Robinhood Chain and paying IMD's Intake.")
            : "0.5 IMD for the whole job: in SOL from the creator's Solana wallet (NIGHTSHIFT Swap converts it), or in IMD from an EVM wallet."}</span></li>
      {w.steps.map((s) => (
        <li key={s.pick} className={s.state}><StatusMark status={STEP_MARK[s.state]} size={18} color="#8db6ff" doneColor="#2f7bff" errorColor="#ff6b7d" />
          <span><b>{SWARM[s.pick].label}</b>{s.pick === "review" && w.verdict ? (w.verdict.launch ? `Launch: ${w.verdict.reason || "looks normal."}` : `No: ${w.verdict.reason}`) : stopped && s.state !== "done" ? "Not done: the launch stopped." : s.state === "done" ? APPLIED[s.pick](l) : { waiting: "Waiting its turn.", working: "The swarm is on it.", failed: "This step failed." }[s.state]}
            {s.state !== "done" && s.state !== "failed" && !stopped && info?.imd.eta && <small> · usually ~{minutes(info.imd.eta.steps[s.pick][0])}</small>}
            {links[s.pick] && s.state === "done" && <> <a href={links[s.pick]!} target="_blank" rel="noreferrer">{s.pick === "review" ? "Read the report ↗" : s.pick === "website" ? "Open the site ↗" : "Open the image ↗"}</a></>}</span></li>
      ))}
      {left && <li className="eta"><PxIcon name="pulse" size={14} /><span>{left}</span></li>}
      <li><StatusMark status={launched ? "done" : stopped ? "failed" : l.status === "launching" || l.status === "ready" ? "running" : "pending"} size={18} color="#b8ff3d" doneColor="#b8ff3d" errorColor="#ff6b7d" />
        <span><b>{launched ? "LIVE ON SOLANA" : stopped ? "NOT LAUNCHED" : l.status === "ready" ? "READY: THE CREATOR SIGNS" : "THE CREATOR SIGNS, IT GOES LIVE"}</b>{launched ? <>Signed by the creator when the swarm was done, sent by NIGHTSHIFT at once{l.signature && <> · <a href={solscan("tx", l.signature, net)} target="_blank" rel="noreferrer">the transaction ↗</a></>}</> : l.status === "refused" ? "The review said no, so this token never launches." : l.status === "cancelled" ? "Cancelled before it launched." : l.status === "launching" ? "Sending it to Solana now…" : l.status === "ready" ? "The swarm is done and its work is in the token. It goes live the moment the creator signs." : l.status === "failed" ? "Solana did not take the launch: the creator signs again." : "When the swarm is done, the creator signs once and it goes live at once, its work already in it."}</span></li>
      {w.job && <li className="link"><a href={`https://explorer.imd.fun/jobs/${w.job}`} target="_blank" rel="noreferrer">The job on IMD's explorer ↗</a></li>}
    </ol>
  );
}

/**
 * The launch is ready: the swarm is done (and its review says launch), its work is in the token's metadata. The
 * creator signs now, a normal transaction on a recent blockhash, and NIGHTSHIFT sends it at once. Nothing pops up
 * in the wallet before the creator clicks.
 */
function ReadyPanel({ l, info, reload }: { l: SolLaunch; info: SolInfo | null; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState("");
  const [err, setErr] = useState("");
  const w = l.swarm;
  const opts = optionsOf(l);
  const own = !(info?.config && isStandard(opts)) && !l.config;
  const cost = LAUNCH.createFeeSol + (own ? LAUNCH.configRentSol : 0) + l.devBuySol + 0.02;
  const added = [
    w?.picks.includes("logo") && (w.logoHosted || w.logo) && "the swarm's logo is its image",
    w?.picks.includes("banner") && (w.bannerHosted || w.banner) && "the banner is on its page and in its metadata",
    w?.site && (l.website ? "the swarm's site is linked next to yours" : "the swarm's site is its website"),
    w?.verdict?.launch && "the review said launch",
  ].filter(Boolean) as string[];
  async function sign() {
    if (!info) return;
    setBusy(true); setErr("");
    try {
      const who = await wallet();
      if (who.address !== l.creator) throw new Error(`Connect the creator's wallet (${shortKey(l.creator)}): only it can sign this launch.`);
      const v = await signAndSend({ mint: l.mint, name: l.name, symbol: l.symbol, uri: l.uri ?? `${location.origin}/api/sol/meta/${l.mint}.json`, options: opts, devBuySol: l.devBuySol, config: l.config || null }, who, info, setSay);
      if (v.status === "failed") throw new Error(v.note ?? "Solana did not take the launch. Sign again.");
      reload();
    } catch (e) { setErr((e as Error).message); reload(); } finally { setBusy(false); setSay(""); }
  }
  return (
    <PxPanel title="YOUR TOKEN IS READY · SIGN TO LAUNCH" tone="imd" state="live" className="sl3-ready">
      <p className="sl3-ready-h"><b>{l.swarm?.state === "done" ? "The swarm is done." : "Ready to launch."}</b> {l.note ?? (added.length ? `Its work is already in your token: ${added.join("; ")}.` : "")}</p>
      <p className="sl3-dim">Sign once with the creator's wallet ({shortKey(l.creator)}) and NIGHTSHIFT sends it to Solana at once{l.devBuySol ? `, with your first buy of ${l.devBuySol} SOL` : ""}. About {sol(cost, 3)} SOL from your wallet{info?.solUsd ? ` (≈ ${usd(cost * info.solUsd)})` : ""}: the launch fee{own ? ", your Meteora config's rent" : ""}{l.devBuySol ? ", the first buy" : ""} and network fees.</p>
      <button className="px-btn primary sl3-go" disabled={busy || !info} onClick={() => void sign()}><PxIcon name="bolt" size={14} />{busy ? "SIGNING…" : "SIGN TO LAUNCH"}</button>
      {say && <p className="sl3-say" aria-live="polite">{say}</p>}
      {err && <p className="sl3-err" role="alert">{err}</p>}
    </PxPanel>
  );
}

/**
 * Durable nonce accounts a wallet made for launches before v0.377 (they held a signed launch): found from the
 * wallet's own recent transactions, each closed by the wallet so its rent comes back. Nothing is closed without a click.
 */
const NONCE_CUTOFF = Date.UTC(2026, 10, 16);
function NonceRent({ creator }: { creator?: string }) {
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState("");
  const [err, setErr] = useState("");
  const [list, setList] = useState<{ account: string; lamports: number }[] | null>(null);
  const [who, setWho] = useState<Sign | null>(null);
  const find = async () => {
    setBusy(true); setErr("");
    try {
      const w = await wallet();
      if (creator && w.address !== creator) throw new Error(`Connect the creator's wallet (${shortKey(creator)}).`);
      setWho(w);
      setList(await solApi.nonces(w.address));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const close = async (account: string) => {
    if (!who) return;
    setBusy(true); setErr("");
    try { const c = await loadChain(); await c.closeNonce(who, account, setSay); setList(await solApi.nonces(who.address)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); setSay(""); }
  };
  return (
    <div className="sl3-nonce">
      {list === null
        ? <><p className="sl3-dim">Started a swarm launch before 16 November? Its nonce account may still hold ~{LAUNCH.nonceRentSol} SOL of your rent.</p><button className="px-btn" disabled={busy} onClick={() => void find()}><PxIcon name="coin" size={14} />{busy ? "LOOKING…" : "FIND MY NONCE RENT"}</button></>
        : !list.length ? <p className="sl3-dim">No open nonce accounts for {who ? shortKey(who.address) : "this wallet"} in its recent transactions: nothing to take back.</p>
        : <ul>{list.map((n) => <li key={n.account}><span>{shortKey(n.account)} · {sol(n.lamports / 1e9, 5)} SOL</span><button className="px-btn" disabled={busy} onClick={() => void close(n.account)}>CLOSE, GET IT BACK</button></li>)}</ul>}
      {say && <p className="sl3-say" aria-live="polite">{say}</p>}
      {err && <p className="sl3-err" role="alert">{err}</p>}
    </div>
  );
}

/** What the creator can do on a launch that is not live: pay, launch without the swarm, sign again, cancel, take old nonce rent back. */
function CreatorBox({ l, reload, info }: { l: SolLaunch; reload: () => void; info: SolInfo | null }) {
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState("");
  const [err, setErr] = useState("");
  const [chain, setChain] = useState<PayChain>(l.swarm?.chainId ?? 1);
  const w = l.swarm;
  const act = (f: (who: Sign) => Promise<unknown>) => async () => {
    setBusy(true); setErr("");
    try {
      const who = await wallet();
      if (who.address !== l.creator) throw new Error(`Connect the creator's wallet (${shortKey(l.creator)}).`);
      await f(who);
      reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); setSay(""); }
  };
  const decide = (action: "release" | "cancel") => act(async (who) => { const c = await loadChain(); await solApi.act(l.mint, action, await c.signText(who, actText(action, l.mint))); });
  const signAgain = act(async (who) => {
    if (!info) return;
    const v = await signAndSend({ mint: l.mint, name: l.name, symbol: l.symbol, uri: l.uri ?? `${location.origin}/api/sol/meta/${l.mint}.json`, options: optionsOf(l), devBuySol: l.devBuySol, config: l.config || null }, who, info, setSay);
    if (v.status === "failed") throw new Error(v.note ?? "Solana did not take the launch. Sign again.");
  });
  const pay = act(async () => { const hash = await payImd({ chainId: chain, body: w!.body, say: setSay }); await reportPaid(l.mint, chain, hash, setSay); });
  const payInSol = act(async (who) => { await paySol(l.mint, who, setSay); });
  const [evm, setEvm] = useState(false);
  const check = async () => { setBusy(true); setErr(""); try { await solApi.relayCheck(l.mint); reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const relay = w?.relay;
  const onItsWay = relay?.state === "sent";
  const waiting = l.status === "waiting" || l.status === "ready";
  // the creator's share of the trading fees on the curve, read from the pool and claimed by the creator's wallet
  const [fees, setFees] = useState<number | null>(null);
  const graduated = !!l.pool && l.status === "graduated";
  const onCurve = !!l.pool && (l.status === "live" || graduated);
  useEffect(() => { if (onCurve) void loadChain().then((c) => c.creatorFees(l.pool!)).then(setFees).catch(() => setFees(null)); }, [onCurve, l.pool]);
  const claim = act(async (who) => { const c = await loadChain(); await c.claimCreatorFees(who, l.pool!, setSay); setFees(await c.creatorFees(l.pool!).catch(() => 0)); });
  // after graduation: the creator's half of the DAMM v2 pool's liquidity, locked forever, keeps earning trading fees
  const [lp, setLp] = useState<LpFees | null>(null);
  useEffect(() => { if (graduated) void loadChain().then((c) => c.creatorLpFees(l.mint, l.creator)).then(setLp).catch(() => setLp(null)); }, [graduated, l.mint, l.creator]);
  const claimLp = act(async (who) => { const c = await loadChain(); await c.claimCreatorLpFees(who, l.mint, setSay); setLp(await c.creatorLpFees(l.mint, l.creator).catch(() => null)); });
  const shown = mine.all().includes(l.mint) || waiting || l.status === "failed" || (fees ?? 0) > 0 || (lp?.sol ?? 0) > 0;
  if (!shown) return null;
  return (
    <PxPanel title="FOR THE CREATOR" right={shortKey(l.creator)} className="sl3-creator">
      {graduated && lp !== null && lp.positions > 0 && <>
        <p className="sl3-dim">Since graduation your half of the Meteora pool's liquidity, locked forever, earns trading fees: <b>{sol(lp.sol, 4)} SOL</b>{info?.solUsd ? ` (≈ ${usd(lp.sol * info.solUsd)})` : ""}{lp.tokens > 0 ? ` and ${lp.tokens.toLocaleString("en-US")} $${l.symbol}` : ""} waiting. Only the wallet holding the position can claim it; it goes straight to that wallet.</p>
        <button className="px-btn primary sl3-go" disabled={busy || (lp.sol <= 0 && lp.tokens <= 0)} onClick={() => void claimLp()}><PxIcon name="coin" size={14} />CLAIM MY LP FEES</button>
      </>}
      {onCurve && fees !== null && (!graduated || fees > 0) && <>
        <p className="sl3-dim">{graduated ? "Left for you on the bonding curve (its trading fees and your share of its surplus)" : "Your share of the trading fees, waiting in the pool"}: <b>{sol(fees, 4)} SOL</b>{info?.solUsd ? ` (≈ ${usd(fees * info.solUsd)})` : ""}. Only the creator's wallet can claim it; it goes straight to that wallet.</p>
        <button className="px-btn primary sl3-go" disabled={busy || fees <= 0} onClick={() => void claim()}><PxIcon name="coin" size={14} />{graduated ? "CLAIM WHAT IS LEFT ON THE CURVE" : "CLAIM MY FEES"}</button>
      </>}
      {l.status === "waiting" && w?.state === "unpaid" && onItsWay && <>
        <p className="sl3-dim">Your SOL payment is on its way: {relay?.note ?? "NIGHTSHIFT Swap is buying the IMD on Robinhood Chain."} This page follows it.</p>
        <button className="px-btn" disabled={busy} onClick={() => void check()}><PxIcon name="pulse" size={14} />CHECK THE PAYMENT NOW</button>
      </>}
      {l.status === "waiting" && w?.state === "unpaid" && !onItsWay && <>
        {relay && (relay.state === "refunded" || relay.state === "failed") && relay.note && <p className="sl3-err">{relay.note}</p>}
        <p className="sl3-dim">Pay the swarm's job to start it: in SOL from your Solana wallet (NIGHTSHIFT Swap converts it to {info?.imd.price ?? 0.5} IMD), or in IMD from an EVM wallet. You sign the launch when the swarm is done.</p>
        {info?.imd.solPay && info.network === "mainnet" && !evm && <button className="px-btn primary sl3-go" disabled={busy} onClick={() => void payInSol()}><PxIcon name="coin" size={14} />PAY IN SOL WITH YOUR SOLANA WALLET</button>}
        {info?.imd.solPay && info.network === "mainnet" && !evm
          ? <button className="px-btn" disabled={busy} onClick={() => setEvm(true)}>OR PAY IN IMD FROM AN EVM WALLET</button>
          : <>
            <Seg v={chain} set={setChain} opts={[[1, "ETHEREUM"], [4663, "ROBINHOOD CHAIN"]] as const} />
            <button className="px-btn primary sl3-go" disabled={busy} onClick={() => void pay()}><PxIcon name="coin" size={14} />PAY 0.5 IMD ON {PAY_NAMES[chain].toUpperCase()}</button>
          </>}
      </>}
      {l.status === "waiting" && w && w.state !== "unpaid" && w.state !== "failed" && <p className="sl3-dim">The swarm is working. When it is done this page shows SIGN TO LAUNCH: keep it open, or come back.</p>}
      {l.status === "waiting" && w?.state === "failed" && <>
        <p className="sl3-dim">{w.note ?? "The swarm's job did not finish."} You can launch without the swarm's work (no IMD badge): confirm here, then sign the launch. Or cancel.</p>
        <button className="px-btn primary sl3-go" disabled={busy} onClick={() => void decide("release")()}><PxIcon name="bolt" size={14} />LAUNCH WITHOUT THE SWARM'S WORK</button>
      </>}
      {l.status === "failed" && <>
        <p className="sl3-dim">{l.note}</p>
        <button className="px-btn primary sl3-go" disabled={busy} onClick={() => void signAgain()}><PxIcon name="bolt" size={14} />SIGN THE LAUNCH AGAIN</button>
      </>}
      {waiting && <button className="px-btn" disabled={busy} onClick={() => void decide("cancel")()}>CANCEL THIS LAUNCH</button>}
      {say && <p className="sl3-say" aria-live="polite">{say}</p>}
      {err && <p className="sl3-err" role="alert">{err}</p>}
      {(l.nonce || l.createdAt < NONCE_CUTOFF) && <NonceRent creator={l.creator} />}
    </PxPanel>
  );
}

function SolToken({ mint }: { mint: string }) {
  const { info } = useInfo();
  const [l, setL] = useState<SolLaunch | null>(null);
  const [missing, setMissing] = useState(false);
  const [tick, setTick] = useState(0);
  // a ready launch says so in the tab too: the creator may be waiting in another one
  useEffect(() => { if (l?.status === "ready") document.title = `READY TO SIGN · ${l.name} · NIGHTSHIFT`; }, [l?.status, l?.name]);
  useEffect(() => {
    let alive = true;
    const load = () => solApi.one(mint).then((x) => alive && setL(x)).catch(() => alive && setMissing(true));
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [mint, tick]);
  if (missing && !l) return <PxPanel title="NOT FOUND"><p className="sl3-dim">No launch with that address here. <Link to="/launchpad/sol">Back to the launchpad</Link></p></PxPanel>;
  if (!l) return <p className="sl3-dim">Reading Solana…</p>;
  const net = info?.network ?? "mainnet";
  const solUsd = info?.solUsd ?? null;
  const graduated = l.status === "graduated";
  const launched = l.status === "live" || graduated;
  const kicker = { prepared: "", waiting: "WITH THE IMD SWARM", ready: "READY · THE CREATOR SIGNS", launching: "LAUNCHING", live: "LIVE", graduated: "GRADUATED", refused: "NOT LAUNCHED · THE SWARM SAID NO", failed: "NOT LAUNCHED YET", cancelled: "CANCELLED" }[l.status];
  return (
    <>
      <div className="sl3-tok-h">
        <Logo src={imageOf(l) || null} symbol={l.symbol} size={72} />
        <div>
          <span className="px-kicker imd">IMD LAUNCH · SOLANA · {kicker}</span>
          <h1 className="pk-h1">{l.name} <em>${l.symbol}</em></h1>
          <div className="sl3-tok-links">
            <button className="pk-tag" onClick={() => void navigator.clipboard?.writeText(l.mint)} title="Copy the token address"><PxIcon name="doc" size={11} />{shortKey(l.mint)}</button>
            {l.swarm?.verdict?.launch && <PxTag tone="imd">IMD REVIEWED</PxTag>}
            {l.dev && <PxTag tone="gold">{l.dev.pct}% CREATOR LOCKED</PxTag>}
          </div>
          {l.description && <p className="pk-lead">{l.description}</p>}
          {l.note && !launched && <p className={l.status === "refused" || l.status === "failed" ? "sl3-err" : "sl3-dim"}>{l.note}</p>}
        </div>
      </div>
      <TokenLinks l={l} net={net} />

      {launched ? <>
        <PxStats cols={4}>
          <PxStat label="MARKET CAP" value={usdOf(l.mcapSol, solUsd)} sub={`${sol(l.mcapSol, 0)} SOL`} tone="lime" />
          <PxStat label="PRICE" value={usdOf(l.priceSol, solUsd)} sub={`${pct(l.change1h)} 1h · ${pct(l.change24h)} 24h`} />
          <PxStat label="BONDING CURVE" value={graduated ? "GRADUATED" : `${Math.round(l.progress * 100)}%`} sub={graduated ? "liquidity locked on Meteora DAMM v2" : l.graduateSol ? `${usdOf(Number(l.quoteReserve) / 1e9, solUsd)} of ${usdOf(l.graduateSol, solUsd)} raised` : ""} tone={graduated ? "lime" : undefined} />
          <PxStat label="LAUNCHED" value={ago(l.launchedAt ?? l.createdAt)} sub={`${l.options.feeBps / 100}% fee · anti-sniper ${l.options.sniper}`} />
        </PxStats>
        <div className="sl3-bar big" aria-hidden="true"><i style={{ width: `${Math.max(2, l.progress * 100)}%` }} /></div>
      </> : (
        <PxStats cols={4}>
          <PxStat label="OPENS AT" value={usd(l.options.startMcapUsd)} sub="market cap" />
          <PxStat label="GRADUATES AT" value={usd(l.options.graduateMcapUsd)} sub={l.graduateSol ? `${sol(l.graduateSol, 1)} SOL raised` : "market cap"} />
          <PxStat label="THE SWARM" value={l.swarm ? `${stepsDone(l)} / ${l.swarm.steps.length}` : "—"} sub={l.swarm ? "steps done" : "not used"} tone="imd" />
          <PxStat label="CREATOR" value={shortKey(l.creator)} sub={l.dev ? `${l.dev.pct}% locked` : "no allocation"} />
        </PxStats>
      )}

      <div className={`sl3-tok${launched ? " mkt" : ""}`}>
        <div className="sl3-side">
          {launched && <MarketChart l={l} solUsd={solUsd} />}
          {launched && <TradesList l={l} net={net} />}
          <PxPanel className="sl3-swarm" title="THE IMD SWARM" tone="imd" state={l.status === "waiting" ? "live" : "idle"} right={l.swarm ? `${l.swarm.picks.length} STEP${l.swarm.picks.length > 1 ? "S" : ""}` : undefined}>
            {l.swarm ? <SwarmFlow l={l} net={net} info={info} /> : <p className="sl3-dim">Launched without the swarm: the creator chose to go live at once.</p>}
            {(l.swarm?.bannerHosted || l.swarm?.banner) && <img className="sl3-banner" src={(l.swarm.bannerHosted || l.swarm.banner)!} alt={`${l.name} X banner by the IMD swarm`} loading="lazy" />}
          </PxPanel>
        </div>
        <div className="sl3-side">
          {l.status === "ready" && <ReadyPanel l={l} info={info} reload={() => setTick((t) => t + 1)} />}
          <CreatorBox l={l} info={info} reload={() => setTick((t) => t + 1)} />
          {launched && (graduated
            ? <PxPanel title="TRADE" state="live" className="sl3-trade-g"><p className="sl3-dim">It graduated: its liquidity is locked in a Meteora DAMM v2 pool for good. Trade it anywhere Solana tokens trade.</p><a className="px-btn primary" href={`https://jup.ag/swap/SOL-${l.mint}`} target="_blank" rel="noreferrer"><PxIcon name="swap" size={14} />TRADE ON JUPITER ↗</a></PxPanel>
            : l.pool ? <TradeBox pool={l.pool} mint={l.mint} symbol={l.symbol} net={net} solUsd={solUsd} /> : <PxPanel title="TRADE"><p className="sl3-dim">The pool is being read from Solana…</p></PxPanel>)}
          {l.dev && (
            <PxPanel title="CREATOR ALLOCATION" tone="gold" right="locked by Meteora" className="sl3-alloc">
              <p className="sl3-lock"><b>{l.dev.pct}%</b> of the supply is the creator's, held by Meteora's program, not by the creator. None of it moves before the token graduates; then {l.dev.cliffDays ? `${l.dev.cliffDays} days later ` : ""}it unlocks a little each day for {l.dev.vestDays} days.</p>
            </PxPanel>
          )}
          {launched && <HoldersList l={l} net={net} />}
          {launched && (
            <PxPanel title="SAFETY CHECKS" right="free, from the chain" className="sl3-checks">
              <ul>{l.checks.length ? l.checks.map((c) => <li key={c.key} className={c.ok === false ? "bad" : c.ok ? "ok" : ""}><StatusMark status={c.ok === false ? "failed" : c.ok ? "done" : "pending"} size={16} color="#738878" doneColor="#b8ff3d" errorColor="#ff6b7d" /><span>{c.says}</span></li>) : <li>Checks are being read…</li>}</ul>
              <p className="sl3-dim">Every launch here: the token is frozen and the liquidity is locked forever at graduation. Checks are not advice; tokens like this are high risk.</p>
              <p className="sl3-dim">Creator <a href={solscan("account", l.creator, net)} target="_blank" rel="noreferrer">{shortKey(l.creator)} ↗</a></p>
            </PxPanel>
          )}
        </div>
      </div>
    </>
  );
}

function TradeBox({ pool, mint, symbol, net, solUsd }: { pool: string; mint: string; symbol: string; net: string; solUsd: number | null }) {
  const [buy, setBuy] = useState(true);
  const [amount, setAmount] = useState("0.1");
  const [slip, setSlip] = useState(300);
  const [q, setQ] = useState<{ out: bigint; min: bigint; feePct: number } | null>(null);
  const [qErr, setQErr] = useState("");
  const [bal, setBal] = useState<{ sol: number; token: number } | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState("");
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");
  const atoms = useMemo(() => { const n = Number(amount); return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * (buy ? 1e9 : 1e6))) : 0n; }, [amount, buy]);

  useEffect(() => {
    setQ(null); setQErr("");
    if (!atoms) return;
    const t = setTimeout(() => { loadChain().then((c) => c.quote(pool, buy, atoms, slip)).then(setQ).catch((e) => setQErr((e as Error).message)); }, 350);
    return () => clearTimeout(t);
  }, [pool, buy, atoms, slip]);

  const refreshBal = async (owner: string) => { const c = await loadChain(); setBal(await c.balances(owner, mint).catch(() => null)); };
  async function connect() { try { const w = await wallet(); setWho(w.address); await refreshBal(w.address); } catch (e) { setErr((e as Error).message); } }
  async function trade() {
    setBusy(true); setErr(""); setDone("");
    try {
      const w = await wallet(); setWho(w.address);
      const c = await loadChain();
      setDone(await c.trade({ who: w, pool, buy, amountIn: atoms, slippageBps: slip, say: setSay }));
      await refreshBal(w.address);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); setSay(""); }
  }
  const inUsd = buy && solUsd ? usd(Number(amount) * solUsd) : "";
  return (
    <PxPanel title="TRADE ON THE CURVE" state="live" className="sl3-trade">
      <div className="sl3-side-tabs"><button className={buy ? "on" : ""} onClick={() => setBuy(true)}>BUY</button><button className={!buy ? "on sell" : ""} onClick={() => setBuy(false)}>SELL</button></div>
      <label>{buy ? "SOL to spend" : `${symbol} to sell`} {inUsd && <small>≈ {inUsd}</small>}<input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
      {bal && <div className="sl3-quick">{(buy ? [0.1, 0.5, 1] : [25, 50, 100]).map((v) => <button key={v} onClick={() => setAmount(buy ? String(v) : String(Math.floor((bal.token * v) / 100)))}>{buy ? `${v} SOL` : `${v}%`}</button>)}</div>}
      <div className="sl3-quote">
        {q ? <><span>You get about <b>{buy ? (Number(q.out) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 }) + ` ${symbol}` : `${(Number(q.out) / 1e9).toFixed(4)} SOL${solUsd ? ` (${usd((Number(q.out) / 1e9) * solUsd)})` : ""}`}</b></span><span>at least {buy ? (Number(q.min) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 }) : (Number(q.min) / 1e9).toFixed(4)} · fee {q.feePct.toFixed(2)}%{q.feePct > 2.5 ? " (anti-sniper window)" : ""}</span></> : qErr ? <span className="sl3-err">{qErr}</span> : <span className="sl3-dim">{atoms ? "Quoting…" : "Enter an amount."}</span>}
      </div>
      <div className="sl3-slip"><span>Max slippage</span>{[100, 300, 500].map((s) => <button key={s} className={slip === s ? "on" : ""} onClick={() => setSlip(s)}>{s / 100}%</button>)}</div>
      {who ? <button className={`px-btn primary sl3-go${buy ? "" : " sell"}`} disabled={!q || busy} onClick={() => void trade()}>{busy ? "WORKING…" : buy ? `BUY ${symbol}` : `SELL ${symbol}`}</button>
        : <button className="px-btn primary sl3-go" onClick={() => void connect()}><PxIcon name="wallet" size={14} />CONNECT A SOLANA WALLET</button>}
      {bal && <p className="sl3-dim">Wallet {shortKey(who ?? "")}: {bal.sol.toFixed(4)} SOL · {bal.token.toLocaleString("en-US", { maximumFractionDigits: 0 })} {symbol}</p>}
      {say && <p className="sl3-say" aria-live="polite">{say}</p>}
      {done && <p className="sl3-ok">Done. <a href={solscan("tx", done, net)} target="_blank" rel="noreferrer">See it on Solscan ↗</a></p>}
      {err && <p className="sl3-err" role="alert">{err}</p>}
    </PxPanel>
  );
}

// ---------------------------------------------------------------- the admin


/** The admin: the engine's fee wallet as the launch partner, the dev wallet, on or off, a run now. */
function FeesAdmin({ token, partner, reload }: { token: string; partner: string | null; reload: () => Promise<void> }) {
  const [f, setF] = useState<SolFeesAdmin | null>(null);
  const [dev, setDev] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { solApi.adminFees(token).then(setF).catch((e) => setMsg((e as Error).message)); }, [token]);
  const act = async (fn: () => Promise<SolFeesAdmin | { ran: boolean; why?: string; info: SolFeesAdmin }>) => {
    setBusy(true); setMsg("");
    try {
      const r = await fn();
      if ("ran" in r) { setF(r.info); setMsg(r.why ?? "Ran: claimed, paid and burned what was due."); } else { setF(r); setDev(""); }
      await reload();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  // BURN NOW: the buckets under the usual minimum, burned at a loss the owner accepts (a preview first, nothing signed)
  const [pv, setPv] = useState<BurnNow | null>(null);
  const [accept, setAccept] = useState("");
  const capPct = f?.limits.burnNowMaxLossPct ?? 40;
  const preview = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await solApi.adminFeesBurn(token, {});
      setPv(r); setF(r.info);
      const worst = Math.max(0, ...r.burns.map((b) => b.lossPct ?? 0));
      setAccept(String(Math.min(capPct, Math.ceil(worst + 1))));
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const burnAnyway = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await solApi.adminFeesBurn(token, { confirm: true, maxLossPct: Number(accept) });
      setPv(null); setF(r.info);
      setMsg(r.burns.map((b) => `${b.token}: ${b.sent ? `${sol(b.sol, 4)} SOL sent to Relay (${b.sent.solTx.slice(0, 10)}…), the burn follows` : b.error ?? b.problem ?? "nothing to burn"}`).join(" · "));
      await reload();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  if (!f) return <PxPanel title="3 · NIGHTSHIFT'S FEES">{msg ? <p className="sl3-err">{msg}</p> : <p className="sl3-dim">Reading…</p>}</PxPanel>;
  const isPartner = partner === f.wallet;
  const off = !f.settings.on;
  const saved = (a: string | null) => a ? <em>now {shortKey(a)}</em> : <em className="no">not set</em>;
  return (
    <PxPanel title="3 · NIGHTSHIFT'S FEES · AUTOMATIC" state={f.running ? "live" : "idle"} right={f.balanceSol != null ? `${sol(f.balanceSol, 4)} SOL in the fee wallet` : undefined}>
      <p className="sl3-dim">Fee wallet <a href={solscan("account", f.wallet, "mainnet")} target="_blank" rel="noreferrer">{f.wallet}</a>. Its key was made on the server and never leaves it. Every 6 hours it claims every pool, pays the dev wallet 60% (dev + marketing), and burns 20% as IMD and 20% as $SHIFT through Relay. Send it about 0.02 SOL once for network fees ({f.limits.reserveSol} SOL always stays in it).</p>
      <ul className="sl3-adm">
        <li><span><b>{isPartner ? "It is the launch partner" : "Not the launch partner yet"}</b><small>{isPartner ? "every launch pays NIGHTSHIFT's fees here" : partner ? `launches pay ${shortKey(partner)} now` : "launches stay closed until a partner is set"}</small></span>
          {!isPartner && <button className="px-btn primary" disabled={busy} onClick={() => void act(() => solApi.adminFeesSet(token, { partner: true }))}>MAKE IT THE PARTNER</button>}</li>
      </ul>
      <label className="sl3-lbl">Dev wallet · 60% (dev + marketing) {saved(f.settings.dev)}<div className="sl3-row"><input className="field" value={dev} onChange={(e) => setDev(e.target.value.trim())} placeholder="your Solana dev wallet" /><button className="px-btn" disabled={busy || !dev} onClick={() => void act(() => solApi.adminFeesSet(token, { dev }))}>SAVE</button></div></label>
      <div className="sl3-row">
        <button className={`px-btn${off ? "" : " primary"}`} disabled={busy} onClick={() => void act(() => solApi.adminFeesSet(token, { on: off }))}>{off ? "OFF · TURN ON" : "ON · TURN OFF"}</button>
        <button className="px-btn" disabled={busy || !f.running} onClick={() => void act(() => solApi.adminFeesRun(token))}>RUN NOW</button>
        <button className="px-btn" disabled={busy} onClick={() => void preview()}><PxIcon name="bolt" size={14} />BURN NOW</button>
      </div>
      {pv && <div className="sl3-burnnow">
        <p className="sl3-dim">Burn the IMD and $SHIFT buckets now, below the usual {f.limits.minBurnSol} SOL minimum. Relay's quotes right now (nothing is signed yet; the burn takes a fresh quote and refuses it if it costs more than the loss you accept):</p>
        <ul className="sl3-adm">{pv.burns.map((b) => (
          <li key={b.token}><span><b>{b.token === "SHIFT" ? "$SHIFT" : "IMD"}</b>
            <small>{sol(b.sol, 4)} SOL{b.inUsd != null ? ` (${usd(b.inUsd)})` : ""}{b.out != null ? ` → ${b.out.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${b.token} burned` : ""}{b.outUsd != null ? ` (${usd(b.outUsd)})` : ""}</small></span>
            {b.lossPct != null && <b className="sl3-err">loss {b.lossPct.toFixed(1)}%</b>}
            {(b.problem || b.error) && <small className="sl3-err">{b.error ?? b.problem}</small>}
          </li>
        ))}</ul>
        <div className="sl3-row">
          <label className="sl3-lbl">Loss I accept, % (at most {capPct})<input className="field" inputMode="decimal" value={accept} onChange={(e) => setAccept(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
          <button className="px-btn danger" disabled={busy || !(Number(accept) > 0 && Number(accept) <= capPct) || !pv.burns.some((b) => b.lossPct != null)} onClick={() => void burnAnyway()}>BURN ANYWAY</button>
          <button className="px-btn" disabled={busy} onClick={() => setPv(null)}>CANCEL</button>
        </div>
      </div>}
      <p className={f.blocked ? "sl3-err" : "sl3-ok"}>{f.blocked ?? `Running. Last run ${f.lastRun ? ago(f.lastRun) : "not yet"}.`}</p>
      {f.lastError && <p className="sl3-err">Last problem: {f.lastError}</p>}
      <PxStats cols={4}>
        <PxStat label="CLAIMED" value={sol(f.totals.claimedSol, 3)} sub="SOL, all time" />
        <PxStat label="DEV WALLET" value={sol(f.totals.adamSol + f.totals.devSol, 3)} sub={`SOL paid · owed ${sol(f.owedSol.dev ?? 0, 3)}`} />
        <PxStat label="IMD BURN" value={sol(f.totals.imdBurnSol, 3)} sub={`SOL · waiting ${sol(f.owedSol.imd ?? 0, 3)}`} tone="imd" />
        <PxStat label="$SHIFT BURN" value={sol(f.totals.shiftBurnSol, 3)} sub={`SOL · waiting ${sol(f.owedSol.shift ?? 0, 3)}`} tone="lime" />
      </PxStats>
      {!!f.tokenFeesHeld?.length && <p className="sl3-dim">Token fees held in the fee wallet (not split, not sold): {f.tokenFeesHeld.map((t) => `${t.amount.toLocaleString("en-US")} of ${shortKey(t.mint)}`).join(" · ")}.</p>}
      {busy && <p className="sl3-say" aria-live="polite">Working…</p>}
      {msg && <p className="sl3-dim" role="status">{msg}</p>}
    </PxPanel>
  );
}

function SolAdmin() {
  const [token, setToken] = useState(adminToken());
  const [state, setState] = useState<Awaited<ReturnType<typeof solApi.adminState>> | null>(null);
  const [partner, setPartner] = useState("");
  const [err, setErr] = useState("");
  const [say, setSay] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => solApi.adminState(token).then((s) => { setState(s); setPartner(s.partner ?? ""); setErr(""); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { if (token) void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (f: () => Promise<unknown>) => { setBusy(true); setErr(""); try { await f(); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); setSay(""); } };

  return (
    <>
      <PxHero kicker="IMD LAUNCH · SOLANA · SETUP" title="Open IMD Launch on Solana." accent="One wallet." lead="NIGHTSHIFT's fee wallet, made on the server, is the partner on every launch: it claims NIGHTSHIFT's share of the fees, pays the dev wallet, and burns IMD and $SHIFT, on its own. Make it the partner in step 3 and launches open. Creators pay the IMD swarm themselves, in SOL through NIGHTSHIFT Swap or in IMD; the IMD goes straight to IMD. A shared config key is optional: standard launches then skip creating their own config." />
      <PxPanel title="ADMIN TOKEN"><div className="sl3-row"><input className="field" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="the admin token from /setup" /><button className="px-btn" onClick={() => void load()}>READ</button></div></PxPanel>
      {state && <>
        <PxPanel title="1 · PARTNER WALLET (BY HAND)" state={state.partner ? "live" : "idle"} right={state.network.toUpperCase()}>
          <div className="sl3-row"><input className="field" value={partner} onChange={(e) => setPartner(e.target.value.trim())} placeholder="NIGHTSHIFT's Solana wallet address" />
            <button className="px-btn" disabled={busy} onClick={() => void act(async () => { const w = await wallet(); setPartner(w.address); })}>USE MY WALLET</button>
            <button className="px-btn primary" disabled={busy || !partner} onClick={() => void act(() => solApi.adminPartner(token, partner))}>SAVE</button></div>
          <p className="sl3-dim">{state.partner ? `Open: fees go to ${state.partner}.` : "Not set: launches are closed."} Launch addresses ending in "imd" ready: {state.mintsReady}.</p>
        </PxPanel>
        <PxPanel title="2 · LAUNCHES NOT ON THE BOARD" tone="imd" right={`${state.pending.length}`}>
          {!state.pending.length ? <p className="sl3-dim">None: every launch is live, or none has been signed yet.</p> : (
            <ul className="sl3-adm">{state.pending.map((l) => (
              <li key={l.mint}>
                <span><Link to={`/launchpad/sol/${l.mint}`}><b>{l.name}</b> ${l.symbol}</Link><small>{l.status}{l.swarm ? ` · swarm ${l.swarm.state}` : ""} · {ago(l.createdAt)}{l.note ? ` · ${l.note}` : ""}</small></span>
                {(l.status === "waiting" || l.status === "refused") && <button className="px-btn" disabled={busy} onClick={() => void act(() => solApi.adminLaunch(token, l.mint, "release"))}>{l.status === "refused" ? "OVERRULE: LAUNCH" : "LAUNCH NOW"}</button>}
                {(l.status === "waiting" || l.status === "refused") && <button className="px-btn" disabled={busy} onClick={() => void act(() => solApi.adminLaunch(token, l.mint, "cancel"))}>CANCEL</button>}
              </li>
            ))}</ul>
          )}
        </PxPanel>
        <FeesAdmin token={token} partner={state.partner} reload={load} />
        <PxPanel title="4 · SHARED CONFIG KEY" right="optional" state={state.config ? "live" : "idle"}>
          {state.config
            ? <p>Standard launches use <a href={solscan("account", state.config, state.network)} target="_blank" rel="noreferrer">{state.config}</a>.</p>
            : <>
              <p className="sl3-dim">Creates the standard launch config ($5K → $75K at today's SOL price, 1% fee, standard anti-sniper). Its fees and leftover go to the partner; the wallet you connect only pays its rent, about 0.01 SOL.</p>
              <button className="px-btn" disabled={busy || !state.partner} onClick={() => void act(async () => {
                const who = await wallet();
                const c = await loadChain();
                const r = await c.createConfig(who, state.partner!, state.info.solUsd ?? 0, setSay);
                setSay("Checking it on chain…");
                await solApi.adminConfig(token, r.config, state.partner!);
              })}><PxIcon name="lock" size={14} />CREATE THE SHARED CONFIG</button>
            </>}
          {say && <p className="sl3-say" aria-live="polite">{say}</p>}
        </PxPanel>
        <PxPanel title="NETWORK">
          <div className="sl3-row"><button className={`px-btn${state.network === "mainnet" ? " primary" : ""}`} disabled={busy} onClick={() => void act(() => solApi.adminNetwork(token, "mainnet"))}>MAINNET</button><button className={`px-btn${state.network === "devnet" ? " primary" : ""}`} disabled={busy} onClick={() => void act(() => solApi.adminNetwork(token, "devnet"))}>DEVNET (REHEARSAL)</button></div>
        </PxPanel>
      </>}
      {err && <p className="sl3-err" role="alert">{err}</p>}
    </>
  );
}
