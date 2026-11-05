import { useEffect, useMemo, useRef, useState } from "react";
import DotGrid from "../../rb/DotGrid";
import StarBorder from "../../rb/StarBorder";
import StatusMark from "../../rb/StatusMark";
import { go, Link } from "../../router";
import { PxHero, PxPanel, PxSection, PxStat, PxStats, PxTag } from "../../saas/kit";
import { PxIcon } from "../../saas/PxIcon";
import { chooseSolana } from "../../wallet";
import { Logo, useRich } from "../LaunchpadPage";
import { actText, adminToken, ago, type Discovered, imageOf, loadChain, logoData, mine, pct, type Pulse, shortKey, sol, solApi, type SolInfo, type SolLaunch, solscan, type SwarmStep, usd, usdOf } from "./net";
import { CLIFF_DAYS, CURVES, DEV_PCTS, FEES, feeSplit, isStandard, LAUNCH, type LaunchOptions, MCAP_LIMITS, optionProblem, PAY_NAMES, type PayChain, SNIPER, type Sniper, STANDARD, SWARM, SWARM_ORDER, type SwarmPick, VEST_DAYS } from "./options";
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
        <li><PxIcon name="lock" size={13} />You sign the launch first; it waits, and goes live on Solana the moment the swarm finishes. Or launch at once, without the swarm.</li>
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
        lead={<>The <b>IMD swarm</b> launches tokens on Ethereum and Robinhood Chain. Through NIGHTSHIFT it launches them on <b>Solana</b>: the swarm reviews your token, draws its logo and banner and builds its website, and your launch goes live on a Meteora bonding curve the moment it finishes. Curves priced in dollars, liquidity locked forever at graduation, your own allocation locked on chain. Your wallets sign everything.</>}
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
        <PxStat label="WITH THE SWARM" value={info ? String(info.counts.waiting) : "—"} sub="signed, launching when it finishes" tone="imd" />
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
              <header><b>WITH THE IMD SWARM</b><span>signed, going live when the swarm finishes</span></header>
              <div className="sl3-wait-r">{waiting.map((l) => (
                <Link key={l.mint} to={`/launchpad/sol/${l.mint}`} className="sl3-wait-c">
                  <Logo src={imageOf(l) || null} symbol={l.symbol} size={36} />
                  <span><b>{l.name}</b><small>${l.symbol} · {stepsDone(l)} of {l.swarm?.steps.length ?? 0} done</small></span>
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
          <li className="imd"><b>02 · Pick the swarm's work</b><span>A review that decides if it launches, the logo, an X banner, the website. One IMD job, 0.5 IMD, checked by IMD for free first. Or skip it and launch now.</span></li>
          <li className="imd"><b>03 · Sign, and the swarm launches it</b><span>Your wallet signs the launch now; it waits. When the swarm finishes, NIGHTSHIFT sends it: the token goes live with the swarm's logo and site.</span></li>
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
  const logoOk = hasLogo || picks.has("logo");
  const ready = info?.open && !!info.partner && f.name.trim().length >= 2 && /^[A-Za-z0-9]{2,10}$/.test(f.symbol.trim()) && logoOk && agree && !busy && !problem && solUsd > 0;
  const totalSol = LAUNCH.createFeeSol + (own ? LAUNCH.configRentSol : 0) + (swarm ? LAUNCH.nonceRentSol : 0) + buy + 0.02;
  const imdUsd = info ? info.imd.price * info.imd.imdUsd : null;

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
    const labels = ["Connect your Solana wallet", swarm ? "IMD checks the swarm's job (free)" : "Save the token's details", own || swarm ? `Your launch's Meteora settings${swarm ? " and nonce" : ""}` : null, swarm ? "Sign the launch: it waits for the swarm" : "Sign the launch", swarm ? `Pay ${info.imd.price} IMD on ${PAY_NAMES[payChain]}` : "Live on Solana"].filter(Boolean) as string[];
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
      const chain = await loadChain();
      const pc = await chain.prepareChain({ who, partner: info.partner, shared: info.config, standard: isStandard(opts), options: opts, solUsd, nonce: swarm, say: setSay });
      if (own || swarm) mark("done");
      const tx = await chain.signLaunch({ who, config: pc.config, mint, name: f.name.trim(), symbol, uri: prep.uri, devBuySol: buy, nonce: pc.nonce, say: setSay });
      setSay(swarm ? "NIGHTSHIFT is checking your signed launch…" : "Sending it to Solana…");
      await solApi.signed(mint, { tx, config: pc.config, nonce: pc.nonce });
      mark("done");
      if (swarm && prep.swarm) {
        setLeft(mint);
        const hash = await payImd({ chainId: payChain, body: prep.swarm.body, say: setSay });
        setSay("Checking the payment…");
        await reportPaid(mint, payChain, hash, setSay);
      }
      mark("done");
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
      <PxHero kicker="IMD LAUNCH · SOLANA · NEW" title="Launch on Solana" accent="with the IMD swarm." lead="Describe your token, set its bonding curve, pick what the IMD swarm does for it, and sign. With the swarm, your launch waits and goes live the moment the swarm finishes. Without it, it goes live now." />
      <div className="sl3-new">
        <div className="sl3-side">
          <PxPanel title="1 · THE TOKEN" className="sl3-form">
            <label>Name<input className="field" value={f.name} onChange={set("name")} maxLength={32} placeholder="Night Frog" /></label>
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
          <PxPanel title="4 · THE IMD SWARM" tone="imd" state={info?.imd.on ? "live" : "idle"} right={picks.size ? `${info?.imd.price ?? 0.5} IMD${imdUsd ? ` ≈ ${usd(imdUsd)}` : ""}` : "OFF"}>
            <p className="sl3-dim">Tick what the swarm does before your token goes live. Everything you tick is one IMD job, {info?.imd.price ?? 0.5} IMD, and your launch waits until the swarm finishes.</p>
            <div className="sl3-picks">
              {SWARM_ORDER.map((p) => (
                <button key={p} type="button" role="checkbox" aria-checked={picks.has(p)} className={`sl3-pick${picks.has(p) ? " on" : ""}`} onClick={() => toggle(p)}>
                  <i aria-hidden="true">{picks.has(p) ? "■" : "□"}</i><b>{SWARM[p].label}</b><span>{SWARM[p].says}</span><small>{SWARM[p].skill}</small>
                </button>
              ))}
            </div>
            {picks.has("logo") && !hasLogo && <label>What the logo shows <small>the swarm reads it</small><input className="field" value={logoIdea} onChange={(e) => setLogoIdea(e.target.value)} maxLength={200} placeholder="a green frog in a black hoodie, pixel art, lime eyes" /></label>}
            {picks.size > 0
              ? <label>Pay IMD on<Seg v={payChain} set={setPayChain} opts={[[1, "ETHEREUM"], [4663, "ROBINHOOD CHAIN"]] as const} /><small>From your own EVM wallet, straight to IMD's Intake. {payChain === 4663 ? "Cents of gas." : "Where most IMD is held."} IMD checks the job for free first.</small></label>
              : <p className="sl3-say">No swarm: your token goes live as soon as you sign.</p>}
            {picks.size > 0 && <button type="button" className="px-btn" onClick={() => setPicks(new Set())}>LAUNCH WITHOUT THE SWARM</button>}
            {!info?.imd.on && picks.size > 0 && <p className="sl3-err">IMD is not reachable from NIGHTSHIFT right now: launch without the swarm, or try again later.</p>}
          </PxPanel>
          <PxPanel title="5 · YOUR FIRST BUY" right="optional">
            <label>SOL to buy at launch<input className="field" inputMode="decimal" value={devBuy} onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
            <p className="sl3-dim">In the launch transaction itself, so nobody buys before you; it pays the normal fee. Up to {LAUNCH.devBuyMaxSol} SOL{solUsd && buy ? ` (about ${usd(buy * solUsd)})` : ""}, shown publicly.{swarm ? " Keep it in your wallet until the swarm finishes." : ""}</p>
          </PxPanel>
          <PxPanel title="LAUNCH">
            <dl className="sl3-terms">
              <div><dt>Launch fee</dt><dd>{LAUNCH.createFeeSol} SOL</dd></div>
              {own && <div><dt>Your Meteora config</dt><dd>~{LAUNCH.configRentSol} SOL <small>· rent</small></dd></div>}
              {swarm && <div><dt>Nonce account</dt><dd>~{LAUNCH.nonceRentSol} SOL <small>· you get it back</small></dd></div>}
              <div><dt>First buy</dt><dd>{buy} SOL</dd></div>
              <div><dt>Network fees</dt><dd>~0.02 SOL</dd></div>
              <div><dt>On Solana</dt><dd><b>{sol(totalSol, 3)} SOL</b> <small>{solUsd ? `≈ ${usd(totalSol * solUsd)}` : ""}</small></dd></div>
              {swarm && <div><dt>The IMD swarm</dt><dd><b>{info?.imd.price} IMD</b> <small>on {PAY_NAMES[payChain]}{imdUsd ? ` ≈ ${usd(imdUsd)}` : ""}</small></dd></div>}
            </dl>
            <label className="sl3-agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> <span>I understand the token is frozen once launched (name, ticker, supply, settings), {swarm ? "that it launches only when the swarm finishes and never if its review says no, " : ""}and that tokens like this can lose all their value.</span></label>
            {problem && <p className="sl3-err">{problem}</p>}
            {!logoOk && <p className="sl3-dim">Add a logo, or tick LOGO for the swarm.</p>}
            <button className="px-btn primary sl3-go" disabled={!ready} onClick={() => void run()}><PxIcon name="bolt" size={14} />{busy ? "WORKING…" : swarm ? "SIGN, AND SEND IT TO THE SWARM" : "LAUNCH ON SOLANA NOW"}</button>
            {say && <p className="sl3-say" aria-live="polite">{say}</p>}
            {steps.length > 0 && <ol className="sl3-steps">{steps.map((s) => <li key={s.label}><StatusMark status={s.status} size={18} color="#b8ff3d" doneColor="#b8ff3d" errorColor="#ff6b7d" /><span>{s.label}</span></li>)}</ol>}
            {err && <p className="sl3-err" role="alert">{err}</p>}
            {left && err && <p className="sl3-dim">Your signed launch is saved and waiting. <Link to={`/launchpad/sol/${left}`}>Finish paying on its page</Link>.</p>}
          </PxPanel>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- one token

function Chart({ mint, solUsd }: { mint: string; solUsd: number | null }) {
  const [pts, setPts] = useState<[number, number][] | null>(null);
  useEffect(() => { let alive = true; const load = () => solApi.chart(mint).then((p) => alive && setPts(p)).catch(() => alive && setPts([])); load(); const t = setInterval(load, 30_000); return () => { alive = false; clearInterval(t); }; }, [mint]);
  const W = 640, H = 200;
  if (!pts || pts.length < 2) return <div className="sl3-chart empty"><p className="sl3-dim">{pts ? "The chart fills in as the token trades (a point a minute)." : "Reading the chart…"}</p></div>;
  const ys = pts.map((p) => p[1] * (solUsd ?? 1)), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || hi || 1;
  const t0 = pts[0]![0], t1 = pts[pts.length - 1]![0] || t0 + 1;
  const xy = pts.map((p, i) => [((p[0] - t0) / (t1 - t0 || 1)) * W, H - 8 - ((ys[i]! - lo) / span) * (H - 24)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = ys[ys.length - 1]! >= ys[0]!;
  return (
    <div className="sl3-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Price over the last day">
        <defs><linearGradient id="slg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={up ? "#b8ff3d" : "#ff6b7d"} stopOpacity=".35" /><stop offset="1" stopColor={up ? "#b8ff3d" : "#ff6b7d"} stopOpacity="0" /></linearGradient></defs>
        <polygon points={`0,${H} ${line} ${W},${H}`} fill="url(#slg)" />
        <polyline points={line} fill="none" stroke={up ? "#b8ff3d" : "#ff6b7d"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="sl3-chart-k"><span>{solUsd ? usd(hi) : sol(hi, 8)} high</span><span>{solUsd ? usd(lo) : sol(lo, 8)} low</span><span>{Math.round((t1 - t0) / 60000)} min</span></div>
    </div>
  );
}

const STEP_MARK: Record<SwarmStep["state"], "pending" | "running" | "done" | "failed"> = { waiting: "pending", working: "running", done: "done", failed: "failed" };

/** The swarm's work on a launch: each picked step, its files, the job on IMD's explorer. */
function SwarmFlow({ l, net }: { l: SolLaunch; net: string }) {
  const w = l.swarm!;
  const paid = w.state !== "unpaid";
  const launched = l.status === "live" || l.status === "graduated";
  const stopped = l.status === "refused" || l.status === "cancelled";
  const links: Partial<Record<SwarmPick, string | null>> = { review: w.report, logo: w.logo, banner: w.banner, website: w.site };
  return (
    <ol className="sl3-flow">
      <li><StatusMark status="done" size={18} color="#8db6ff" doneColor="#2f7bff" errorColor="#ff6b7d" /><span><b>SIGNED</b>The creator's launch, held by NIGHTSHIFT until the swarm finishes. Nothing is on Solana before.</span></li>
      <li><StatusMark status={paid ? "done" : "running"} size={18} color="#8db6ff" doneColor="#2f7bff" errorColor="#ff6b7d" /><span><b>{paid ? "PAID TO IMD" : "WAITING FOR THE IMD PAYMENT"}</b>{paid ? <>0.5 IMD on {PAY_NAMES[w.chainId]}{w.payTx && <> · <a href={`${w.chainId === 1 ? "https://etherscan.io" : "https://explorer.mainnet.chain.robinhood.com"}/tx/${w.payTx}`} target="_blank" rel="noreferrer">the payment ↗</a></>}</> : "0.5 IMD for the whole job, from the creator's EVM wallet."}</span></li>
      {w.steps.map((s) => (
        <li key={s.pick} className={s.state}><StatusMark status={STEP_MARK[s.state]} size={18} color="#8db6ff" doneColor="#2f7bff" errorColor="#ff6b7d" />
          <span><b>{SWARM[s.pick].label}</b>{s.pick === "review" && w.verdict ? (w.verdict.launch ? `Launch: ${w.verdict.reason || "looks normal."}` : `No: ${w.verdict.reason}`) : stopped && s.state !== "done" ? "Not done: the launch stopped." : { waiting: "Waiting its turn.", working: "The swarm is on it.", done: "Done.", failed: "This step failed." }[s.state]}
            {links[s.pick] && s.state === "done" && <> <a href={links[s.pick]!} target="_blank" rel="noreferrer">{s.pick === "review" ? "Read the report ↗" : s.pick === "website" ? "Open the site ↗" : "Open the image ↗"}</a></>}</span></li>
      ))}
      <li><StatusMark status={launched ? "done" : l.status === "refused" || l.status === "cancelled" ? "failed" : l.status === "launching" ? "running" : "pending"} size={18} color="#b8ff3d" doneColor="#b8ff3d" errorColor="#ff6b7d" />
        <span><b>{launched ? "LIVE ON SOLANA" : stopped ? "NOT LAUNCHED" : "LAUNCH ON SOLANA"}</b>{launched ? <>Sent by NIGHTSHIFT when the swarm finished{l.signature && <> · <a href={solscan("tx", l.signature, net)} target="_blank" rel="noreferrer">the transaction ↗</a></>}</> : l.status === "refused" ? "The review said no, so the signed launch was never sent." : l.status === "cancelled" ? "Cancelled before it was sent." : l.status === "launching" ? "Sending it to Solana now…" : "Goes live the moment the swarm finishes."}</span></li>
      {w.job && <li className="link"><a href={`https://explorer.imd.fun/jobs/${w.job}`} target="_blank" rel="noreferrer">The job on IMD's explorer ↗</a></li>}
    </ol>
  );
}

/** What the creator can do on a launch that is not live: pay, launch without the swarm, sign again, cancel, take the nonce rent back. */
function CreatorBox({ l, reload }: { l: SolLaunch; reload: () => void }) {
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
    const c = await loadChain();
    const tx = await c.signLaunch({ who, config: l.config, mint: l.mint, name: l.name, symbol: l.symbol, uri: `${location.origin}/api/sol/meta/${l.mint}.json`, devBuySol: l.devBuySol, nonce: l.nonce, say: setSay });
    await solApi.signed(l.mint, { tx, config: l.config, nonce: l.nonce });
  });
  const pay = act(async () => { const hash = await payImd({ chainId: chain, body: w!.body, say: setSay }); await reportPaid(l.mint, chain, hash, setSay); });
  const closeNonce = act(async (who) => { const c = await loadChain(); await c.closeNonce(who, l.nonce!, setSay); });
  const waiting = l.status === "waiting";
  const over = l.status === "refused" || l.status === "cancelled" || l.status === "live" || l.status === "graduated";
  const shown = mine.all().includes(l.mint) || waiting || l.status === "failed";
  if (!shown) return null;
  return (
    <PxPanel title="FOR THE CREATOR" right={shortKey(l.creator)}>
      {waiting && w?.state === "unpaid" && <>
        <p className="sl3-dim">Your launch is signed and waiting. Pay the swarm's job to start it.</p>
        <Seg v={chain} set={setChain} opts={[[1, "ETHEREUM"], [4663, "ROBINHOOD CHAIN"]] as const} />
        <button className="px-btn primary sl3-go" disabled={busy} onClick={() => void pay()}><PxIcon name="coin" size={14} />PAY 0.5 IMD ON {PAY_NAMES[chain].toUpperCase()}</button>
      </>}
      {waiting && w?.state === "failed" && <>
        <p className="sl3-dim">{w.note ?? "The swarm's job did not finish."} You can launch now without the swarm's work (no IMD badge), or cancel.</p>
        <button className="px-btn primary sl3-go" disabled={busy} onClick={() => void decide("release")()}><PxIcon name="bolt" size={14} />LAUNCH WITHOUT THE SWARM'S WORK</button>
      </>}
      {l.status === "failed" && <>
        <p className="sl3-dim">{l.note}</p>
        <button className="px-btn primary sl3-go" disabled={busy} onClick={() => void signAgain()}><PxIcon name="bolt" size={14} />SIGN THE LAUNCH AGAIN</button>
      </>}
      {waiting && <button className="px-btn" disabled={busy} onClick={() => void decide("cancel")()}>CANCEL THIS LAUNCH</button>}
      {over && l.nonce && <><p className="sl3-dim">The nonce account that held your signed launch keeps ~{LAUNCH.nonceRentSol} SOL of rent. Take it back:</p><button className="px-btn" disabled={busy} onClick={() => void closeNonce()}><PxIcon name="coin" size={14} />GET THE NONCE RENT BACK</button></>}
      {say && <p className="sl3-say" aria-live="polite">{say}</p>}
      {err && <p className="sl3-err" role="alert">{err}</p>}
    </PxPanel>
  );
}

function SolToken({ mint }: { mint: string }) {
  const { info } = useInfo();
  const [l, setL] = useState<SolLaunch | null>(null);
  const [missing, setMissing] = useState(false);
  const [tick, setTick] = useState(0);
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
  const kicker = { prepared: "", waiting: "WITH THE IMD SWARM", launching: "LAUNCHING", live: "LIVE", graduated: "GRADUATED", refused: "NOT LAUNCHED · THE SWARM SAID NO", failed: "NOT LAUNCHED YET", cancelled: "CANCELLED" }[l.status];
  return (
    <>
      <div className="sl3-tok-h">
        <Logo src={imageOf(l) || null} symbol={l.symbol} size={72} />
        <div>
          <span className="px-kicker imd">IMD LAUNCH · SOLANA · {kicker}</span>
          <h1 className="pk-h1">{l.name} <em>${l.symbol}</em></h1>
          <div className="sl3-tok-links">
            <button className="pk-tag" onClick={() => void navigator.clipboard?.writeText(l.mint)} title="Copy the token address"><PxIcon name="doc" size={11} />{shortKey(l.mint)}</button>
            {launched && <a className="pk-tag" href={solscan("token", l.mint, net)} target="_blank" rel="noreferrer">SOLSCAN ↗</a>}
            {l.website && <a className="pk-tag" href={l.website} target="_blank" rel="noreferrer nofollow">SITE ↗</a>}
            {l.swarm?.site && <a className="pk-tag" href={l.swarm.site} target="_blank" rel="noreferrer">IMD SITE ↗</a>}
            {l.twitter && <a className="pk-tag" href={l.twitter} target="_blank" rel="noreferrer nofollow">X ↗</a>}
            {l.telegram && <a className="pk-tag" href={l.telegram} target="_blank" rel="noreferrer nofollow">TELEGRAM ↗</a>}
            {l.swarm?.verdict?.launch && <PxTag tone="imd">IMD REVIEWED</PxTag>}
            {l.dev && <PxTag tone="gold">{l.dev.pct}% CREATOR LOCKED</PxTag>}
          </div>
          {l.description && <p className="pk-lead">{l.description}</p>}
          {l.note && !launched && <p className={l.status === "refused" || l.status === "failed" ? "sl3-err" : "sl3-dim"}>{l.note}</p>}
        </div>
      </div>

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

      <div className="sl3-tok">
        <div className="sl3-side">
          {launched && <PxPanel title="PRICE · LAST 24H" right="USD"><Chart mint={l.mint} solUsd={solUsd} /></PxPanel>}
          <PxPanel title="THE IMD SWARM" tone="imd" state={l.status === "waiting" ? "live" : "idle"} right={l.swarm ? `${l.swarm.picks.length} STEP${l.swarm.picks.length > 1 ? "S" : ""}` : undefined}>
            {l.swarm ? <SwarmFlow l={l} net={net} /> : <p className="sl3-dim">Launched without the swarm: the creator chose to go live at once.</p>}
            {l.swarm?.banner && <img className="sl3-banner" src={l.swarm.banner} alt={`${l.name} X banner by the IMD swarm`} loading="lazy" />}
          </PxPanel>
        </div>
        <div className="sl3-side">
          <CreatorBox l={l} reload={() => setTick((t) => t + 1)} />
          {launched && (graduated
            ? <PxPanel title="TRADE" state="live"><p className="sl3-dim">It graduated: its liquidity is locked in a Meteora DAMM v2 pool for good. Trade it anywhere Solana tokens trade.</p><a className="px-btn primary" href={`https://jup.ag/swap/SOL-${l.mint}`} target="_blank" rel="noreferrer"><PxIcon name="swap" size={14} />TRADE ON JUPITER ↗</a></PxPanel>
            : l.pool ? <TradeBox pool={l.pool} mint={l.mint} symbol={l.symbol} net={net} solUsd={solUsd} /> : <PxPanel title="TRADE"><p className="sl3-dim">The pool is being read from Solana…</p></PxPanel>)}
          {l.dev && (
            <PxPanel title="CREATOR ALLOCATION" tone="gold" right="locked by Meteora">
              <p className="sl3-lock"><b>{l.dev.pct}%</b> of the supply is the creator's, held by Meteora's program, not by the creator. None of it moves before the token graduates; then {l.dev.cliffDays ? `${l.dev.cliffDays} days later ` : ""}it unlocks a little each day for {l.dev.vestDays} days.</p>
            </PxPanel>
          )}
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

/** NIGHTSHIFT's share of every launch's trading fees, waiting in each pool until the partner wallet claims it. */
function PartnerFees({ partner, solUsd }: { partner: string | null; solUsd: number | null }) {
  const [rows, setRows] = useState<{ pool: string; sol: number; tokens: number; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState("");
  const [msg, setMsg] = useState("");
  const read = async () => {
    const { launches } = await solApi.list("new");
    const live = launches.filter((l) => l.pool && l.status === "live");
    const c = await loadChain();
    const fees = await c.partnerFees(live.map((l) => l.pool!));
    setRows(fees.map((f) => ({ ...f, name: live.find((l) => l.pool === f.pool)?.name ?? f.pool })));
  };
  useEffect(() => { void read().catch(() => setRows([])); }, []);
  const total = (rows ?? []).reduce((a, r) => a + r.sol, 0);
  const claim = async () => {
    setBusy(true); setMsg("");
    try {
      const who = await wallet();
      if (who.address !== partner) throw new Error("Connect the partner wallet: only it can claim NIGHTSHIFT's fees.");
      const c = await loadChain();
      const n = await c.claimPartnerFees(who, (rows ?? []).map((r) => r.pool), setSay);
      setMsg(n ? `Claimed from ${n} pool${n > 1 ? "s" : ""} into the partner wallet.` : "Nothing to claim yet.");
      await read();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); setSay(""); }
  };
  return (
    <PxPanel title="3 · NIGHTSHIFT'S FEES" right={rows ? `${sol(total, 4)} SOL${solUsd ? ` ≈ ${usd(total * solUsd)}` : ""}` : "…"} state={total > 0 ? "live" : "idle"}>
      <p className="sl3-dim">The partner's share of every trade on the curves (40% of the fee at 1%), and each launch's fee, wait in their pools until the partner wallet claims them. Graduated pools pay through Meteora's DAMM v2 position instead.</p>
      {rows === null ? <p className="sl3-dim">Reading the pools…</p> : !rows.length ? <p className="sl3-dim">No live launches yet.</p> : (
        <ul className="sl3-adm">{rows.map((r) => <li key={r.pool}><span><b>{r.name}</b><small>{sol(r.sol, 6)} SOL waiting{r.tokens > 0 ? ` · ${r.tokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} tokens` : ""}</small></span></li>)}</ul>
      )}
      <button className="px-btn primary" disabled={busy || !partner || !rows?.length} onClick={() => void claim()}><PxIcon name="coin" size={14} />CLAIM INTO THE PARTNER WALLET</button>
      {say && <p className="sl3-say" aria-live="polite">{say}</p>}
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
      <PxHero kicker="IMD LAUNCH · SOLANA · SETUP" title="Open IMD Launch on Solana." accent="One wallet." lead="NIGHTSHIFT's Solana partner wallet receives the partner share of every launch's fees and the curve's leftover. Set it, and launches open. Creators pay the IMD swarm themselves, in IMD, straight to IMD. A shared config key is optional: standard launches then skip creating their own config." />
      <PxPanel title="ADMIN TOKEN"><div className="sl3-row"><input className="field" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="the admin token from /setup" /><button className="px-btn" onClick={() => void load()}>READ</button></div></PxPanel>
      {state && <>
        <PxPanel title="1 · PARTNER WALLET" state={state.partner ? "live" : "idle"} right={state.network.toUpperCase()}>
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
        <PartnerFees partner={state.partner} solUsd={state.info.solUsd} />
        <PxPanel title="4 · SHARED CONFIG KEY" right="optional" state={state.config ? "live" : "idle"}>
          {state.config
            ? <p>Standard launches use <a href={solscan("account", state.config, state.network)} target="_blank" rel="noreferrer">{state.config}</a>.</p>
            : <>
              <p className="sl3-dim">Creates the standard launch config ($5K → $75K at today's SOL price, 1% fee, standard anti-sniper), owned by the wallet you connect, which must be the partner wallet. About 0.01 SOL.</p>
              <button className="px-btn" disabled={busy || !state.partner} onClick={() => void act(async () => {
                const who = await wallet();
                if (who.address !== state.partner) throw new Error("Connect the partner wallet to create the shared config.");
                const c = await loadChain();
                const r = await c.createConfig(who, state.info.solUsd ?? 0, setSay);
                setSay("Checking it on chain…");
                await solApi.adminConfig(token, r.config, who.address);
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
