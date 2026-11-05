import { useEffect, useMemo, useRef, useState } from "react";
import DotGrid from "../../rb/DotGrid";
import StarBorder from "../../rb/StarBorder";
import StatusMark from "../../rb/StatusMark";
import { go, Link } from "../../router";
import { PxHero, PxPanel, PxSection, PxStat, PxStats, PxTag } from "../../saas/kit";
import { PxIcon } from "../../saas/PxIcon";
import { chooseSolana } from "../../wallet";
import { Logo, useRich } from "../LaunchpadPage";
import { adminToken, ago, type Discovered, loadChain, logoData, pct, type Pulse, shortKey, sol, solApi, type SolInfo, type SolLaunch, solscan, type SwarmWork, usd, usdOf } from "./net";
import { CLIFF_DAYS, DEV_PCTS, feeSplit, isStandard, LAUNCH, type LaunchOptions, MCAP_STEPS, optionProblem, SNIPER, type Sniper, STANDARD, VEST_DAYS } from "./options";
import "./sol.css";
import "./sol-board.css";

type Sign = { address: string; wallet: { signTransaction<T>(tx: T): Promise<T> } };
async function wallet(): Promise<Sign> {
  const w = await chooseSolana();
  if (!w) throw new Error("Connect a Solana wallet to continue.");
  return w as unknown as Sign;
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

/** The IMD swarm, live: the agents doing the work behind every launch. */
function ImdPanel({ info, compact }: { info: SolInfo | null; compact?: boolean }) {
  const p = usePulse();
  return (
    <PxPanel title="THE IMD SWARM" state={p.agentsOnline ? "live" : "idle"} tone="imd" right="api.imd.fun">
      <div className="sl3-imd-n">
        <div><b>{p.agentsOnline?.toLocaleString("en-US") ?? "—"}</b><span>AGENTS ONLINE</span></div>
        <div><b>{p.jobsDoneLastDay ?? "—"}</b><span>JOBS DONE TODAY</span></div>
        <div><b>{p.launchesLive ?? "—"}</b><span>IMD LAUNCHES LIVE</span></div>
        <div><b>{info?.counts.reviewed ?? "—"}</b><span>SOLANA LAUNCHES REVIEWED</span></div>
      </div>
      {!compact && (
        <ul className="sl3-imd-l">
          <li><PxIcon name="shield" size={13} />{info?.imd.review ? "Every launch here is reviewed by the IMD swarm: a sourced report on the creator, the links and the art, on the token page." : "The IMD swarm's review of each launch switches on when NIGHTSHIFT's Swarm Desk is running."}</li>
          <li><PxIcon name="grid" size={13} />{info?.imd.kit ? `The swarm can build your token's website on IPFS: $${info.imd.kitUsd}, paid in SOL in the launch.` : "Swarm-built token websites open with the Swarm Desk."}</li>
          <li><PxIcon name="bolt" size={13} />IMD launches on Ethereum and Robinhood Chain. Through NIGHTSHIFT it launches on Solana, on Meteora's audited bonding curve.</li>
        </ul>
      )}
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

// ---------------------------------------------------------------- the board and discovery

function SolHome() {
  const { info, err } = useInfo();
  const rich = useRich();
  const [tab, setTab] = useState<"board" | "discover">("board");
  const [rows, setRows] = useState<SolLaunch[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () => solApi.list("new").then((r) => alive && setRows(r)).catch(() => alive && setRows([]));
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
        lead={<>The <b>IMD swarm</b> launches tokens on Ethereum and Robinhood Chain. Through NIGHTSHIFT it now launches them on <b>Solana</b>: a Meteora bonding curve priced in dollars, every launch reviewed by the swarm, liquidity locked forever at graduation, and your own allocation locked on chain if you want one. Your wallet signs everything.</>}
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
        <PxStat label="REVIEWED BY IMD" value={info ? String(info.counts.reviewed) : "—"} sub="swarm reports" tone="imd" />
        <PxStat label="SOL" value={solUsd ? `$${solUsd.toFixed(2)}` : "—"} sub={info?.network === "devnet" ? "devnet" : "mainnet"} />
      </PxStats>

      <div className="sl3-tabs big" role="tablist">
        <button role="tab" aria-selected={tab === "board"} className={tab === "board" ? "on" : ""} onClick={() => setTab("board")}>LAUNCHED HERE</button>
        <button role="tab" aria-selected={tab === "discover"} className={tab === "discover" ? "on" : ""} onClick={() => setTab("discover")}>DISCOVER SOLANA</button>
      </div>

      {tab === "board" ? (
        <>
          {king && <King l={king} solUsd={solUsd} />}
          <div className="sl3-search"><PxIcon name="arrow" size={13} /><input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name, ticker or address" /></div>
          {rows === null ? <p className="sl3-dim">Reading Solana…</p>
            : !rows.length ? <PxPanel title="NO LAUNCHES YET"><p className="sl3-dim">{info?.open ? "Be the first: one minute, one or two signatures." : "The Solana launchpad opens as soon as NIGHTSHIFT's partner wallet is set."}</p></PxPanel>
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
          <li><b>01 · Describe it</b><span>Name, ticker, logo, links. Pick Meteora's settings: the fee, the market caps it starts and graduates at in dollars, the anti-sniper fee, and your own locked allocation.</span></li>
          <li className="imd"><b>02 · The IMD swarm</b><span>Every launch gets a sourced review by the swarm on its page. Ask the swarm for the token's website too, built and hosted on IPFS.</span></li>
          <li><b>03 · Live on Solana</b><span>The token trades on Meteora's bonding curve from the first block, with the anti-sniper fee you chose. The token is frozen: no minting, no freezing, no metadata changes.</span></li>
          <li><b>04 · Graduation</b><span>At the target the curve becomes a Meteora DAMM v2 pool with 100% of its liquidity locked forever. Your allocation then unlocks on the schedule you set, day by day.</span></li>
        </ol>
      </PxSection>
    </>
  );
}

function King({ l, solUsd }: { l: SolLaunch; solUsd: number | null }) {
  return (
    <Link to={`/launchpad/sol/${l.mint}`} className="sl3-king pk-panel">
      <span className="sl3-crown" aria-hidden="true">KING OF THE HILL</span>
      <Logo src={l.image || null} symbol={l.symbol} size={64} />
      <div className="sl3-king-t"><b>{l.name}</b><span>${l.symbol} · {ago(l.createdAt)}</span><p>{l.description || "Closest to graduating on the curve right now."}</p></div>
      <div className="sl3-king-n"><span>MARKET CAP</span><b>{usdOf(l.mcapSol, solUsd)}</b><div className="sl3-bar"><i style={{ width: `${Math.max(2, l.progress * 100)}%` }} /></div><small>{Math.round(l.progress * 100)}% to graduation</small></div>
    </Link>
  );
}

function Row({ l, solUsd }: { l: SolLaunch; solUsd: number | null }) {
  const bad = l.checks.filter((c) => c.ok === false).length;
  return (
    <Link to={`/launchpad/sol/${l.mint}`} className="sl3-row-c">
      <Logo src={l.image || null} symbol={l.symbol} size={44} />
      <div className="sl3-row-t">
        <b>{l.name} <span>${l.symbol}</span></b>
        <small>{usdOf(l.mcapSol, solUsd)} mcap · {ago(l.createdAt)}</small>
        <div className="sl3-row-tags">
          {l.review?.state === "done" && <PxTag tone="imd">IMD REVIEWED</PxTag>}
          {l.review && l.review.state !== "done" && l.review.state !== "failed" && <PxTag tone="imd">IMD REVIEWING</PxTag>}
          {l.dev && <PxTag tone="gold">{l.dev.pct}% LOCKED</PxTag>}
          {bad > 0 && <PxTag tone="red">{bad} FLAG{bad > 1 ? "S" : ""}</PxTag>}
          {l.source === "elsewhere" && <PxTag tone="dim">ELSEWHERE</PxTag>}
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
              <span>{x.launchpad ? <PxTag tone={x.launchpad === "Meteora DBC" ? "imd" : "dim"}>{x.launchpad}</PxTag> : <small>{x.dex}</small>}</span>
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

function SolNew() {
  const { info } = useInfo();
  const [f, setF] = useState({ name: "", symbol: "", description: "", website: "", twitter: "", telegram: "", imageUrl: "" });
  const [logo, setLogo] = useState("");
  const [mode, setMode] = useState<"standard" | "custom">("standard");
  const [o, setO] = useState<LaunchOptions>(STANDARD);
  const [devBuy, setDevBuy] = useState("0");
  const [kit, setKit] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState("");
  const [err, setErr] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const opts = mode === "standard" ? STANDARD : o;
  const solUsd = info?.solUsd ?? 0;
  const buy = Math.max(0, Math.min(LAUNCH.devBuyMaxSol, Number(devBuy) || 0));
  const own = !(info?.config && isStandard(opts));
  const kitSol = info?.imd.kit && kit && info.imd.kitLamports ? Number(info.imd.kitLamports) / 1e9 : 0;
  const problem = optionProblem(opts);
  const split = feeSplit(opts.feeBps, 100);
  const ready = info?.open && !!info.partner && f.name.trim().length >= 2 && /^[A-Za-z0-9]{2,10}$/.test(f.symbol.trim()) && (logo || f.imageUrl) && agree && !busy && !problem && solUsd > 0;
  const total = LAUNCH.createFeeSol + (own ? LAUNCH.configRentSol : 0) + buy + kitSol + 0.02;

  async function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files?.[0];
    if (!fl) return;
    try { setLogo(await logoData(fl)); setErr(""); } catch (x) { setErr((x as Error).message); }
  }

  async function run() {
    if (!info?.partner) return;
    setBusy(true); setErr("");
    const st: Step[] = [{ label: "Connect your Solana wallet", status: "running" }, { label: "Save the token's details and logo", status: "pending" }, { label: own ? "Sign the launch (two signatures)" : "Sign the launch", status: "pending" }, { label: "Listed, and the IMD swarm's work ordered", status: "pending" }];
    const mark = (i: number, s: Step["status"]) => { st[i]!.status = s; if (s === "done" && st[i + 1]) st[i + 1]!.status = "running"; setSteps([...st]); };
    setSteps([...st]);
    let i = 0;
    try {
      const who = await wallet(); mark(i++, "done");
      const chain = await loadChain();
      const mint = chain.newMint();
      const symbol = f.symbol.trim().toUpperCase();
      const { uri } = await solApi.saveMeta({ mint: mint.publicKey.toBase58(), name: f.name.trim(), symbol, description: f.description.trim(), website: f.website.trim(), twitter: f.twitter.trim(), telegram: f.telegram.trim(), ...(logo ? { image: logo } : { imageUrl: f.imageUrl.trim() }), options: { feeBps: opts.feeBps, startMcapUsd: opts.startMcapUsd, graduateMcapUsd: opts.graduateMcapUsd, sniper: opts.sniper }, kit: kitSol > 0 });
      mark(i++, "done");
      const r = await chain.launch({ who, partner: info.partner, shared: info.config, options: opts, solUsd, mint, name: f.name.trim(), symbol, uri, devBuySol: buy, kitLamports: kitSol > 0 ? BigInt(info.imd.kitLamports!) : null, say: setSay });
      mark(i++, "done");
      setSay("Listing it and ordering the IMD swarm's work…");
      await solApi.launched(mint.publicKey.toBase58(), r.signature, r.config);
      mark(i++, "done");
      go(`/launchpad/sol/${mint.publicKey.toBase58()}`);
    } catch (e) {
      mark(i, "failed");
      setErr((e as Error).message);
    } finally { setBusy(false); setSay(""); }
  }

  if (info && !info.open) return <PxPanel title="OPENING SOON"><p className="sl3-dim">IMD Launch on Solana opens as soon as NIGHTSHIFT's partner wallet is set. <Link to="/launchpad/sol">Back to the launchpad</Link></p></PxPanel>;
  const setDev = (d: Partial<LaunchOptions["dev"]>) => { setMode("custom"); setO({ ...opts, dev: { ...opts.dev, ...d } }); };
  return (
    <>
      <PxHero kicker="IMD LAUNCH · SOLANA · NEW" title="Launch on Solana" accent="with the IMD swarm." lead="Describe your token, pick Meteora's settings, lock your own allocation if you keep one, and sign. The IMD swarm reviews the launch on its page; ask it for the token's website too." />
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
              </div>
            </div>
            <div className="sl3-links">
              <label>Website<input className="field" value={f.website} onChange={set("website")} placeholder="https://" /></label>
              <label>X<input className="field" value={f.twitter} onChange={set("twitter")} placeholder="https://x.com/…" /></label>
              <label>Telegram<input className="field" value={f.telegram} onChange={set("telegram")} placeholder="https://t.me/…" /></label>
            </div>
          </PxPanel>

          <PxPanel title="2 · METEORA SETTINGS" right={mode === "standard" ? "STANDARD" : "CUSTOM"} className="sl3-form">
            <Seg v={mode} set={(m) => { setMode(m); if (m === "custom") setO({ ...STANDARD, dev: opts.dev }); }} opts={[["standard", "STANDARD"], ["custom", "CUSTOM"]] as const} />
            <p className="sl3-dim">{mode === "standard" ? `1% fee, $5K → $75K market cap, the standard anti-sniper fee.${info?.config ? " One signature." : ""}` : "Your launch gets its own Meteora config with NIGHTSHIFT as its partner: two signatures, and about 0.009 SOL of rent."}</p>
            {mode === "custom" && <>
              <label>Trading fee <small>creator {split.creator.toFixed(2)}% · NIGHTSHIFT {split.nightshift.toFixed(2)}% · Meteora {split.meteora.toFixed(2)}%</small><Seg v={o.feeBps} set={(v) => setO({ ...o, feeBps: v })} opts={[[100, "1%"], [200, "2%"]] as const} /></label>
              <label>Market cap: start → graduation<Seg v={`${o.startMcapUsd}`} set={(v) => { const m = MCAP_STEPS.find((s) => `${s.start}` === v)!; setO({ ...o, startMcapUsd: m.start, graduateMcapUsd: m.graduate }); }} opts={MCAP_STEPS.map((s) => [`${s.start}`, s.label] as const)} /></label>
              <label>Anti-sniper fee <small>{SNIPER[o.sniper].says}</small><Seg v={o.sniper} set={(v: Sniper) => setO({ ...o, sniper: v })} opts={(Object.keys(SNIPER) as Sniper[]).map((k) => [k, SNIPER[k].label] as const)} /></label>
            </>}
          </PxPanel>

          <PxPanel title="3 · YOUR ALLOCATION" right="locked on chain" className="sl3-form" tone="gold">
            <label>Share of the supply you keep<Seg v={opts.dev.pct} set={(v) => setDev({ pct: v, ...(v > 0 && opts.dev.pct === 0 ? { cliffDays: 90, vestDays: 365 } : {}) })} opts={DEV_PCTS.map((p) => [p, p ? `${p}%` : "NONE"] as const)} /></label>
            {opts.dev.pct > 0 && <>
              <label>Locked after graduation for<Seg v={opts.dev.cliffDays} set={(v) => setDev({ cliffDays: v })} opts={CLIFF_DAYS.map((d) => [d, d ? `${d} DAYS` : "NO WAIT"] as const)} /></label>
              <label>Then released daily over<Seg v={opts.dev.vestDays} set={(v) => setDev({ vestDays: v })} opts={VEST_DAYS.map((d) => [d, `${d} DAYS`] as const)} /></label>
              <p className="sl3-lock">{((LAUNCH.supply * opts.dev.pct) / 100).toLocaleString("en-US")} tokens are yours, held by Meteora's program: none move before the token graduates; then {opts.dev.cliffDays ? `${opts.dev.cliffDays} days later ` : ""}they unlock a little each day for {opts.dev.vestDays} days. Every buyer sees this on the token page.</p>
            </>}
            {opts.dev.pct === 0 && <p className="sl3-dim">All 1,000,000,000 tokens go on the curve: you buy like everyone else.</p>}
          </PxPanel>
        </div>

        <div className="sl3-side">
          <PxPanel title="4 · THE IMD SWARM" tone="imd" state={info?.imd.review ? "live" : "idle"}>
            <ul className="sl3-imd-l">
              <li><PxIcon name="shield" size={13} />{info?.imd.review ? <><b>Included:</b> the swarm reviews your launch (creator wallet, links, art) and posts a sourced verdict on its page.</> : "The swarm's review switches on when NIGHTSHIFT's Swarm Desk is running."}</li>
            </ul>
            {info?.imd.kit
              ? <label className="sl3-agree"><input type="checkbox" checked={kit} onChange={(e) => setKit(e.target.checked)} /> <span><b>Website by the IMD swarm</b>, built and hosted on IPFS, linked from the token page: ${info.imd.kitUsd} ({sol(Number(info.imd.kitLamports) / 1e9, 3)} SOL), paid in the launch.</span></label>
              : <p className="sl3-dim">Swarm-built token websites open with the Swarm Desk.</p>}
          </PxPanel>
          <PxPanel title="5 · YOUR FIRST BUY" right="optional">
            <label>SOL to buy at launch<input className="field" inputMode="decimal" value={devBuy} onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
            <p className="sl3-dim">In the launch transaction itself, so nobody buys before you; it pays the normal fee. Up to {LAUNCH.devBuyMaxSol} SOL{solUsd && buy ? ` (about ${usd(buy * solUsd)})` : ""}, shown publicly.</p>
          </PxPanel>
          <PxPanel title="LAUNCH">
            <dl className="sl3-terms">
              <div><dt>Launch fee</dt><dd>{LAUNCH.createFeeSol} SOL <small>· pays the IMD review</small></dd></div>
              {own && <div><dt>Your Meteora config</dt><dd>~{LAUNCH.configRentSol} SOL <small>· rent</small></dd></div>}
              {kitSol > 0 && <div><dt>Swarm website</dt><dd>{sol(kitSol, 3)} SOL</dd></div>}
              <div><dt>First buy</dt><dd>{buy} SOL</dd></div>
              <div><dt>Network fees</dt><dd>~0.02 SOL</dd></div>
              <div><dt>About</dt><dd><b>{sol(total, 3)} SOL</b> <small>{solUsd ? `≈ ${usd(total * solUsd)}` : ""}</small></dd></div>
            </dl>
            <label className="sl3-agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> <span>I understand the token is frozen once launched (name, ticker, supply, settings), and that tokens like this can lose all their value.</span></label>
            {problem && <p className="sl3-err">{problem}</p>}
            <button className="px-btn primary sl3-go" disabled={!ready} onClick={() => void run()}><PxIcon name="bolt" size={14} />{busy ? "LAUNCHING…" : "LAUNCH ON SOLANA"}</button>
            {say && <p className="sl3-say" aria-live="polite">{say}</p>}
            {steps.length > 0 && <ol className="sl3-steps">{steps.map((s) => <li key={s.label}><StatusMark status={s.status} size={18} color="#b8ff3d" doneColor="#b8ff3d" errorColor="#ff6b7d" /><span>{s.label}</span></li>)}</ol>}
            {err && <p className="sl3-err" role="alert">{err}</p>}
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

function Work({ w, kind }: { w: SwarmWork | null; kind: "review" | "kit" }) {
  if (!w) return null;
  const title = kind === "review" ? "Review by the IMD swarm" : "Website by the IMD swarm";
  const says = { queued: "Ordered: the swarm picks it up in a moment.", running: "The swarm is working on it.", done: kind === "review" ? "Done: the swarm's sourced report." : "Done: the site is live.", failed: w.note ?? "The swarm job did not complete.", off: "Off." }[w.state];
  return (
    <li className={w.state}>
      <StatusMark status={w.state === "done" ? "done" : w.state === "failed" ? "failed" : w.state === "running" ? "running" : "pending"} size={18} color="#8db6ff" doneColor="#2f7bff" errorColor="#ff6b7d" />
      <span><b>{title}</b>{says}{w.url && <> <a href={w.url} target="_blank" rel="noreferrer">{kind === "kit" && w.state === "done" ? "Open the site ↗" : "On IMD's explorer ↗"}</a></>}</span>
    </li>
  );
}

function SolToken({ mint }: { mint: string }) {
  const { info } = useInfo();
  const [l, setL] = useState<SolLaunch | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => solApi.one(mint).then((x) => alive && setL(x)).catch(() => alive && setMissing(true));
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [mint]);
  if (missing && !l) return <PxPanel title="NOT FOUND"><p className="sl3-dim">No launch with that address here. <Link to="/launchpad/sol">Back to the launchpad</Link></p></PxPanel>;
  if (!l) return <p className="sl3-dim">Reading Solana…</p>;
  const net = info?.network ?? "mainnet";
  const solUsd = info?.solUsd ?? null;
  const graduated = l.status === "graduated";
  return (
    <>
      <div className="sl3-tok-h">
        <Logo src={l.image || null} symbol={l.symbol} size={72} />
        <div>
          <span className="px-kicker imd">IMD LAUNCH · SOLANA {l.source === "elsewhere" ? "· LAUNCHED ELSEWHERE ON THE NIGHTSHIFT CONFIG" : ""}</span>
          <h1 className="pk-h1">{l.name} <em>${l.symbol}</em></h1>
          <div className="sl3-tok-links">
            <button className="pk-tag" onClick={() => void navigator.clipboard?.writeText(l.mint)} title="Copy the token address"><PxIcon name="doc" size={11} />{shortKey(l.mint)}</button>
            <a className="pk-tag" href={solscan("token", l.mint, net)} target="_blank" rel="noreferrer">SOLSCAN ↗</a>
            {l.website && <a className="pk-tag" href={l.website} target="_blank" rel="noreferrer nofollow">SITE ↗</a>}
            {l.twitter && <a className="pk-tag" href={l.twitter} target="_blank" rel="noreferrer nofollow">X ↗</a>}
            {l.telegram && <a className="pk-tag" href={l.telegram} target="_blank" rel="noreferrer nofollow">TELEGRAM ↗</a>}
            {l.review?.state === "done" && <PxTag tone="imd">IMD REVIEWED</PxTag>}
            {l.dev && <PxTag tone="gold">{l.dev.pct}% CREATOR LOCKED</PxTag>}
          </div>
          {l.description && <p className="pk-lead">{l.description}</p>}
        </div>
      </div>
      <PxStats cols={4}>
        <PxStat label="MARKET CAP" value={usdOf(l.mcapSol, solUsd)} sub={`${sol(l.mcapSol, 0)} SOL`} tone="lime" />
        <PxStat label="PRICE" value={usdOf(l.priceSol, solUsd)} sub={`${pct(l.change1h)} 1h · ${pct(l.change24h)} 24h`} />
        <PxStat label="BONDING CURVE" value={graduated ? "GRADUATED" : `${Math.round(l.progress * 100)}%`} sub={graduated ? "liquidity locked on Meteora DAMM v2" : l.graduateSol ? `${usdOf(Number(l.quoteReserve) / 1e9, solUsd)} of ${usdOf(l.graduateSol, solUsd)} raised` : ""} tone={graduated ? "lime" : undefined} />
        <PxStat label="LAUNCHED" value={ago(l.createdAt)} sub={l.options ? `${l.options.feeBps / 100}% fee · anti-sniper ${l.options.sniper}` : "on Meteora DBC"} />
      </PxStats>
      <div className="sl3-bar big" aria-hidden="true"><i style={{ width: `${Math.max(2, l.progress * 100)}%` }} /></div>
      <div className="sl3-tok">
        <div className="sl3-side">
          <PxPanel title="PRICE · LAST 24H" right="USD"><Chart mint={l.mint} solUsd={solUsd} /></PxPanel>
          <PxPanel title="THE IMD SWARM" tone="imd" state={l.review?.state === "running" || l.kit?.state === "running" ? "live" : "idle"}>
            {l.review || l.kit ? <ul className="sl3-work"><Work w={l.review} kind="review" /><Work w={l.kit} kind="kit" /></ul>
              : <p className="sl3-dim">{l.source === "elsewhere" ? "Launched elsewhere on the NIGHTSHIFT config: no swarm work was ordered for it." : "No swarm work was ordered for this launch (the Swarm Desk was off when it launched)."}</p>}
          </PxPanel>
        </div>
        <div className="sl3-side">
          {graduated
            ? <PxPanel title="TRADE" state="live"><p className="sl3-dim">It graduated: its liquidity is locked in a Meteora DAMM v2 pool for good. Trade it anywhere Solana tokens trade.</p><a className="px-btn primary" href={`https://jup.ag/swap/SOL-${l.mint}`} target="_blank" rel="noreferrer"><PxIcon name="swap" size={14} />TRADE ON JUPITER ↗</a></PxPanel>
            : l.pool ? <TradeBox pool={l.pool} mint={l.mint} symbol={l.symbol} net={net} solUsd={solUsd} /> : <PxPanel title="TRADE"><p className="sl3-dim">The pool is being read from Solana…</p></PxPanel>}
          {l.dev && (
            <PxPanel title="CREATOR ALLOCATION" tone="gold" right="locked by Meteora">
              <p className="sl3-lock"><b>{l.dev.pct}%</b> of the supply is the creator's, held by Meteora's program, not by the creator. None of it moves before the token graduates; then {l.dev.cliffDays ? `${l.dev.cliffDays} days later ` : ""}it unlocks a little each day for {l.dev.vestDays} days.</p>
            </PxPanel>
          )}
          <PxPanel title="SAFETY CHECKS" right="free, from the chain" className="sl3-checks">
            <ul>{l.checks.length ? l.checks.map((c) => <li key={c.key} className={c.ok === false ? "bad" : c.ok ? "ok" : ""}><StatusMark status={c.ok === false ? "failed" : c.ok ? "done" : "pending"} size={16} color="#738878" doneColor="#b8ff3d" errorColor="#ff6b7d" /><span>{c.says}</span></li>) : <li>Checks are being read…</li>}</ul>
            <p className="sl3-dim">Every launch here: the token is frozen and the liquidity is locked forever at graduation. Checks are not advice; tokens like this are high risk.</p>
            {l.creator && <p className="sl3-dim">Creator <a href={solscan("account", l.creator, net)} target="_blank" rel="noreferrer">{shortKey(l.creator)} ↗</a></p>}
          </PxPanel>
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
      <PxHero kicker="IMD LAUNCH · SOLANA · SETUP" title="Open IMD Launch on Solana." accent="One wallet." lead="NIGHTSHIFT's Solana partner wallet receives the partner share of every launch's fees (it pays the IMD swarm's work from it) and the curve's leftover. Set it, and launches open. A shared config key is optional: it gives standard launches one signature instead of two." />
      <PxPanel title="ADMIN TOKEN"><div className="sl3-row"><input className="field" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="the admin token from /setup" /><button className="px-btn" onClick={() => void load()}>READ</button></div></PxPanel>
      {state && <>
        <PxPanel title="1 · PARTNER WALLET" state={state.partner ? "live" : "idle"} right={state.network.toUpperCase()}>
          <div className="sl3-row"><input className="field" value={partner} onChange={(e) => setPartner(e.target.value.trim())} placeholder="NIGHTSHIFT's Solana wallet address" />
            <button className="px-btn" disabled={busy} onClick={() => void act(async () => { const w = await wallet(); setPartner(w.address); })}>USE MY WALLET</button>
            <button className="px-btn primary" disabled={busy || !partner} onClick={() => void act(() => solApi.adminPartner(token, partner))}>SAVE</button></div>
          <p className="sl3-dim">{state.partner ? `Open: fees go to ${state.partner}.` : "Not set: launches are closed."}</p>
        </PxPanel>
        <PxPanel title="2 · THE IMD SWARM" tone="imd" state={state.desk ? "live" : "idle"}>
          <p className="sl3-dim">{state.desk ? "The Swarm Desk is running: house orders cost 0.5 IMD each, paid from its IMD." : "The Swarm Desk is not running (SWARM_DESK in /setup): the switches below wait for it."}</p>
          <div className="sl3-row">
            <button className={`px-btn${state.review ? " primary" : ""}`} disabled={busy} onClick={() => void act(() => solApi.adminSwarm(token, { review: !state.review }))}>REVIEW EVERY LAUNCH: {state.review ? "ON" : "OFF"}</button>
            <button className={`px-btn${state.kit ? " primary" : ""}`} disabled={busy} onClick={() => void act(() => solApi.adminSwarm(token, { kit: !state.kit }))}>SWARM WEBSITES: {state.kit ? "ON" : "OFF"}</button>
          </div>
        </PxPanel>
        <PxPanel title="3 · SHARED CONFIG KEY" right="optional" state={state.config ? "live" : "idle"}>
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
