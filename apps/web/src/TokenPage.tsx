import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { SwapBox } from "./SwapPage";
import { safeHref } from "./safe";
import { type PoolKey } from "./v4";
import "./token.css";

type NullableNumber = number | null;
type Overview = {
  symbol?: string | null;
  address?: string | null;
  supply?: NullableNumber;
  market?: { priceUsd?: NullableNumber; mcap?: NullableNumber; liquidity?: NullableNumber; chart?: string | null } | null;
  staked?: NullableNumber;
  stakedPct?: NullableNumber;
  burnedShift?: NullableNumber;
  burnedImd?: NullableNumber;
  circulating?: NullableNumber;
  frogs?: { minted?: NullableNumber; max?: NullableNumber } | null;
};
type Token = {
  on?: boolean | null;
  symbol?: string | null;
  address?: string | null;
  buyUrl?: string | null;
  launch?: {
    at?: number | string | null;
    publicAt?: NullableNumber;
    launchNumber?: NullableNumber;
    tx?: string | null;
    openTx?: string | null;
    open?: boolean;
    token?: string;
    symbol?: string;
    contracts?: { token?: string; hook?: string; splitter?: string; rewards?: string } | null;
    pool?: PoolKey | null;
  } | null;
  verification?: { checks?: { label: string; ok: boolean | null; detail?: string | null }[] | null } | null;
};
type Frogs = { stats?: { minted?: NullableNumber } | null };

const FROGS = "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c";
const REFRESH_MS = 60_000;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const address = (value: unknown): string | null => typeof value === "string" && /^0x[\da-f]{40}$/i.test(value) ? value : null;
const etherscan = (value: string) => `https://etherscan.io/address/${value}`;
const compact = (value: number) => value > 0 && value < 0.1 ? value.toPrecision(3) : value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
const whole = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
const usd = (value: number) => `$${compact(value)}`;
const price = (value: number) => `$${value > 0 && value < 0.000001 ? value.toPrecision(3) : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: value < 1 ? 8 : 4 })}`;

/** Undefined means loading; null means a completed, unavailable read. */
function useLiveData<T>(url: string) {
  const [data, setData] = useState<T | null | undefined>(undefined);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    let pending: AbortController | null = null;
    const load = async () => {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Unavailable");
        const result: T | null = await response.json();
        if (active) { setData(result); setUpdatedAt(Date.now()); }
      } catch {
        if (active) { setData(null); setUpdatedAt(null); }
      } finally { window.clearTimeout(timeout); }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => { active = false; pending?.abort(); window.clearInterval(timer); };
  }, [url]);
  return { data, loading: data === undefined, updatedAt };
}

function Metric({ value, loading, format = compact }: { value: unknown; loading: boolean; format?: (n: number) => string }) {
  const n = number(value);
  return n === null ? <span className="tk-unavailable">{loading ? "…" : "not available"}</span> : <>{format(n)}</>;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<"COPY" | "COPIED" | "RETRY">("COPY");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setStatus("COPIED"); }
    catch { setStatus("RETRY"); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("COPY"), 2500);
  };
  return <button type="button" className="tk-copy" onClick={() => void copy()} aria-label={`${status === "COPIED" ? "Copied" : "Copy"} ${label} address`} title={status === "RETRY" ? "Copy unavailable. Select the address to copy it manually, or retry." : `Copy ${label} address`}><span aria-live="polite">{status}</span></button>;
}

function TxLink({ tx, label = "Transaction" }: { tx?: string | null; label?: string }) {
  return tx && /^0x[\da-f]{64}$/i.test(tx) ? <a className="tk-proof" href={`https://etherscan.io/tx/${tx}`} target="_blank" rel="noreferrer">{label}<Icon name="external" size={12} /></a> : null;
}

function launchMonth(at: number | string | null | undefined, loading: boolean) {
  if (at === null || at === undefined) return loading ? "…" : "date not available";
  const date = new Date(typeof at === "number" && at < 1e12 ? at * 1000 : at);
  return Number.isNaN(date.getTime()) ? "date not available" : date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function CheckList({ checks, id, hidden = false }: { checks: NonNullable<NonNullable<Token["verification"]>["checks"]>; id?: string; hidden?: boolean }) {
  return <ul id={id} className="tk-checks" hidden={hidden}>{checks.map((check, i) => <li key={`${check.label}-${i}`}><Icon name={check.ok === true ? "check" : "alert"} size={17} className={check.ok === true ? "tk-check-pass" : "tk-check-alert"} /><div><b>{check.label}</b>{check.detail && <span>{check.detail}</span>}</div><span className="tk-check-result">{check.ok === true ? "PASS" : check.ok === false ? "REVIEW" : "NOT AVAILABLE"}</span></li>)}</ul>;
}

/** A live token hub. The shared app shell owns the header and footer. */
export function TokenPage() {
  const overview = useLiveData<Overview>("/api/token/overview");
  const token = useLiveData<Token>("/api/token");
  const frogs = useLiveData<Frogs>("/api/frogs");
  const [showAllChecks, setShowAllChecks] = useState(false);
  const t = token.data;
  const o = overview.data;
  const live = t?.on === true;
  const prelaunch = t?.on === false;
  const l = t?.launch;
  const launchNumber = number(l?.launchNumber);
  const contracts = l?.contracts;
  // The token endpoint is the authority on whether addresses can be published.
  const ca = live ? address(t?.address) ?? address(contracts?.token) ?? address(o?.address) : null;
  const minted = number(o?.frogs?.minted) ?? number(frogs.data?.stats?.minted);
  const frogMax = number(o?.frogs?.max) ?? 500;
  const segments = [number(o?.circulating), number(o?.staked), number(o?.burnedShift)];
  const segmentTotal = segments.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const hasSupply = segments.every((value) => value !== null && value >= 0) && segmentTotal > 0;
  const checks = Array.isArray(t?.verification?.checks) ? t.verification.checks.filter((check) => check && typeof check.label === "string") : [];
  const contractRows: [string, string | null][] = [
    ["$SHIFT token", ca],
    ["Pool hook", live ? address(contracts?.hook) : null],
    ["Fee splitter", live ? address(contracts?.splitter) : null],
    ["Staking & rewards", live ? address(contracts?.rewards) : null],
    ["NIGHT FROGS", FROGS],
  ];
  const swapLaunch = live && l ? { ...l, token: ca ?? l.token, symbol: t?.symbol ?? l.symbol ?? "SHIFT", pool: l.pool ?? undefined } : null;
  const uniswap = ca ? safeHref(t?.buyUrl) ?? `https://app.uniswap.org/swap?chain=mainnet&inputCurrency=NATIVE&outputCurrency=${ca}` : null;
  const chart = ca ? safeHref(o?.market?.chart) ?? `https://dexscreener.com/ethereum/${ca}` : null;

  useEffect(() => { document.title = "$SHIFT · NIGHTSHIFT"; }, []);

  return (
    <div className="tk">
      <header className="tk-intro">
        <div className="tk-topline"><span className="tk-label">$SHIFT / ETHEREUM</span><span className={`tk-status${live ? " is-live" : ""}`}><i />{token.loading ? "CONNECTING" : prelaunch ? "PRE-LAUNCH" : live ? "LIVE ON ETHEREUM" : "STATUS NOT AVAILABLE"}</span></div>
        <h1>The fuel of the <em>night shift.</em></h1>
        <div className="tk-intro-bottom"><p>Get it. Put it to work. Follow every fee.</p><span className="tk-refresh" title={overview.updatedAt ? `Last read ${new Date(overview.updatedAt).toLocaleTimeString()}` : undefined}>{overview.loading ? "READING LIVE DATA…" : overview.updatedAt ? "DATA REFRESHES EVERY 60S" : "LIVE DATA NOT AVAILABLE"}</span></div>
      </header>

      <section className="tk-actions" aria-label="Put $SHIFT to work">
        <article className="tk-action">
          <div className="tk-action-content"><div className="tk-action-heading"><Icon name="swap" size={20} /><span className="tk-label">01 / GET</span></div><h2>Get <em>$SHIFT.</em></h2>
            <div className="tk-big"><Metric value={o?.market?.priceUsd} loading={overview.loading} format={price} /></div>
            <p className="tk-market">MC <b><Metric value={o?.market?.mcap} loading={overview.loading} format={usd} /></b><span>·</span>Liquidity <b><Metric value={o?.market?.liquidity} loading={overview.loading} format={usd} /></b></p>
          </div>
          <footer className="tk-action-footer"><a className="tk-action-link" href="#tk-swap" onClick={() => document.getElementById("tk-swap")?.focus({ preventScroll: true })}>SWAP<Icon name="arrow" size={16} /></a><div className="tk-market-links">
            {uniswap && <a href={uniswap} target="_blank" rel="noreferrer" aria-label="Buy $SHIFT on Uniswap" title="Uniswap"><Icon name="swap" size={16} /></a>}
            {chart && <a href={chart} target="_blank" rel="noreferrer" aria-label="$SHIFT on DexScreener" title="DexScreener"><Icon name="radar" size={16} /></a>}
            {ca && <a href={`https://etherscan.io/token/${ca}`} target="_blank" rel="noreferrer" aria-label="$SHIFT on Etherscan" title="Etherscan"><Icon name="external" size={16} /></a>}
          </div></footer>
        </article>
        <article className="tk-action">
          <div className="tk-action-content"><div className="tk-action-heading"><Icon name="lock" size={20} /><span className="tk-label">02 / STAKE</span></div><h2>Stake <em>$SHIFT.</em></h2>
            <div className="tk-big"><Metric value={o?.stakedPct} loading={overview.loading} format={(n) => `${n.toFixed(2)}%`} /></div><p>of supply staked</p><p className="tk-support"><Metric value={o?.staked} loading={overview.loading} format={(n) => `${whole(n)} SHIFT staked`} /></p>
          </div><footer className="tk-action-footer"><a className="tk-action-link" href="/stake">STAKE<Icon name="arrow" size={16} /></a><span className="tk-footer-note">EARN YOUR SHARE</span></footer>
        </article>
        <article className="tk-action tk-frog-action">
          <div className="tk-action-content"><div className="tk-action-heading"><Icon name="frog" size={20} /><span className="tk-label">03 / HOLD</span></div><h2>Hold a <em>NIGHT FROG.</em></h2>
            <div className="tk-big"><Metric value={minted} loading={overview.loading || frogs.loading} format={whole} /><small>/ {whole(frogMax)}</small></div><p>minted</p><p className="tk-support">Half of every reward goes to frog holders.</p>
          </div><footer className="tk-action-footer"><a className="tk-action-link" href="/frogs">NIGHT FROGS<Icon name="arrow" size={16} /></a><Icon name="frog" size={18} /></footer>
        </article>
      </section>

      {prelaunch && <p className="tk-notice"><Icon name="alert" size={18} /><span><b>$SHIFT has not launched.</b> The contract is announced at launch, here and on our official channels. Any other $SHIFT token or contract is fake.</span></p>}

      <div className="tk-workspace">
        <section id="tk-swap" className="tk-contract-box" aria-label="$SHIFT contract and swap" tabIndex={-1}>
          <div className="tk-contract-header"><div className="tk-token-name"><span className="tk-token-mark"><Icon name="crescent" size={24} /></span><h2>$SHIFT</h2></div><span className="tk-label">ETHEREUM</span></div>
          <div className="tk-address"><span className="tk-label">CONTRACT</span><div>{ca ? <><a href={etherscan(ca)} target="_blank" rel="noreferrer">{ca}</a><CopyButton value={ca} label="$SHIFT" /></> : <span className="tk-address-empty">{token.loading ? "…" : prelaunch ? "announced at launch" : "not available"}</span>}</div></div>
          {prelaunch || swapLaunch?.pool ? <SwapBox launch={swapLaunch} /> : <div className="tk-swap-loading">{token.loading ? "Loading swap…" : "Swap not available. We’ll check again shortly."}</div>}
        </section>
        <section className="tk-timeline" aria-labelledby="tk-timeline-title">
          <div className="tk-section-heading"><span className="tk-label">BUILT IN THE OPEN</span><h2 id="tk-timeline-title">The story <em>so far.</em></h2></div>
          <ol>
            <li><span className="tk-timeline-dot" /><div><span className="tk-label">{launchMonth(l?.at, token.loading)}</span><p>{live ? "Launched" : "Launch"} through IMD{launchNumber !== null ? <>, launch #{launchNumber}</> : <span className="tk-timeline-missing"> · launch number {token.loading ? "…" : "not available"}</span>}</p><TxLink tx={live ? l?.tx : null} label="Launch transaction" /></div></li>
            <li><span className="tk-timeline-dot" /><div><span className="tk-label">THE FIRST BUY</span><p>{live ? "Treasury made the first buy; trading opened to everyone." : "Treasury makes the first buy; trading opens to everyone."}</p><TxLink tx={live ? l?.openTx : null} label="The first buy" /></div></li>
            <li><span className="tk-timeline-dot" /><div><span className="tk-label">THE ONE RULE</span><p>Fee splitter, rewards and the burn keeper {live ? "went" : "go"} live.</p>{live && address(contracts?.splitter) && <a className="tk-proof" href={etherscan(contracts!.splitter!)} target="_blank" rel="noreferrer">Fee splitter<Icon name="external" size={12} /></a>}</div></li>
            <li><span className="tk-timeline-dot" /><div><span className="tk-label">PUT IT TO WORK</span><p>Staking {live ? "opened" : "opens"}.</p><a className="tk-proof" href="/stake">Stake $SHIFT<Icon name="arrow" size={12} /></a></div></li>
            <li><span className="tk-timeline-dot" /><div><span className="tk-label">THE NIGHT CREW</span><p>NIGHT FROGS rewards by shift hours.</p><a className="tk-proof" href="/frogs">Meet the crew<Icon name="arrow" size={12} /></a></div></li>
            <li className="tk-next"><span className="tk-timeline-dot" /><div><span className="tk-label tk-next-label">NEXT</span><p>Space Pinball duels in $SHIFT and IMD.</p></div></li>
          </ol>
        </section>
      </div>

      <section className="tk-supply tk-section" aria-labelledby="tk-supply-title">
        <span className="tk-label">ONE SUPPLY. ONLY GOING DOWN.</span>
        <h2 id="tk-supply-title"><span><b><Metric value={o?.circulating} loading={overview.loading} /></b> <em>circulating.</em></span> <span><b><Metric value={o?.staked} loading={overview.loading} /></b> <em>staked.</em></span> <span><b><Metric value={o?.burnedShift} loading={overview.loading} /></b> <em>burned forever.</em></span></h2>
        <div className={`tk-supply-bar${hasSupply ? "" : " is-unavailable"}`} role="img" aria-label={hasSupply ? `${whole(segments[0]!)} circulating, ${whole(segments[1]!)} staked, ${whole(segments[2]!)} burned SHIFT` : overview.loading ? "Loading supply breakdown" : "Supply breakdown not available"}>{hasSupply && segments.map((value, i) => <span key={i} className={["tk-circulating", "tk-staked", "tk-burned"][i]} style={{ width: `${(value! / segmentTotal) * 100}%` }} />)}</div>
        <div className="tk-supply-legend">{[["Circulating", "tk-circulating", o?.circulating], ["Staked", "tk-staked", o?.staked], ["Burned forever", "tk-burned", o?.burnedShift]].map(([label, color, value]) => <div key={String(label)}><i className={String(color)} /><span>{label}</span><b><Metric value={value} loading={overview.loading} /></b></div>)}</div>
        <p>1,000,000,000 minted once. No mint function. Sells pay 5% (2.5% SHIFT + 2.5% ETH). Buys pay no token fee.</p>
      </section>

      <section className="tk-fees tk-section" aria-labelledby="tk-fees-title">
        <div className="tk-section-heading"><span className="tk-label">40 / 20 / 20 / 20</span><h2 id="tk-fees-title">One rule for <em>every fee.</em></h2></div>
        <div className="tk-fee-grid">
          <article><Icon name="user" size={20} /><b>40<span>%</span></b><h3>Stakers &<br />NIGHT FROGS holders</h3><p>Half to $SHIFT stakers.<br />Half to the frog holders.</p></article>
          <article><Icon name="bolt" size={20} /><b>20<span>%</span></b><h3>Dev wallet</h3><p>Keep building through<br />the night.</p></article>
          <article><Icon name="shield" size={20} /><b>20<span>%</span></b><h3>Treasury</h3><p>Fund what<br />comes next.</p></article>
          <article className="tk-burn-tile"><Icon name="flame" size={20} /><b>20<span>%</span></b><h3>Burned forever</h3><p>$SHIFT to 0xdead. ETH buys IMD and burns it at IMD’s BurnExecutor daily.</p></article>
        </div>
        <div className="tk-burn-totals"><Icon name="flame" size={20} /><div><span><b><Metric value={o?.burnedShift} loading={overview.loading} /></b> $SHIFT burned</span><span><b><Metric value={o?.burnedImd} loading={overview.loading} /></b> IMD burned</span></div><a className="tk-text-link" href="/impact">BURN PROOFS<Icon name="arrow" size={15} /></a></div>
      </section>

      <section className="tk-verification tk-section" aria-labelledby="tk-checks-title">
        <div className="tk-section-heading tk-heading-row"><div><span className="tk-label">TRUST THE CONTRACTS</span><h2 id="tk-checks-title">Checked <em>on chain.</em></h2></div>{checks.length > 0 && <span className="tk-label">{checks.filter((check) => check.ok === true).length} / {checks.length} PASSED</span>}</div>
        {checks.length ? <><CheckList checks={checks.slice(0, 5)} />{checks.length > 5 && <><button type="button" className="tk-expand" aria-expanded={showAllChecks} aria-controls="tk-more-checks" onClick={() => setShowAllChecks((value) => !value)}>{showAllChecks ? "SHOW FEWER CHECKS" : `VIEW ${checks.length - 5} MORE CHECKS`}<Icon name="arrow" size={15} /></button><CheckList id="tk-more-checks" checks={checks.slice(5)} hidden={!showAllChecks} /></>}</> : <p className="tk-empty">{token.loading ? "…" : prelaunch ? "On-chain checks will appear at launch." : "Verification checks not available."}</p>}
      </section>

      <section className="tk-contracts tk-section" aria-labelledby="tk-contracts-title">
        <div className="tk-section-heading tk-heading-row"><div><span className="tk-label">EVERY ADDRESS, IN THE OPEN</span><h2 id="tk-contracts-title">The <em>contracts.</em></h2></div><a className="tk-text-link" href="/tokenomics">Full tokenomics<Icon name="arrow" size={15} /></a></div>
        <table><caption className="tk-sr-only">NIGHTSHIFT contracts on Ethereum</caption><thead><tr><th scope="col">Contract</th><th scope="col">Ethereum address</th></tr></thead><tbody>{contractRows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td><div>{value ? <><a className="tk-contract-link" href={etherscan(value)} target="_blank" rel="noreferrer"><span>{value}</span><Icon name="external" size={13} /></a><CopyButton value={value} label={label} /></> : <span className="tk-address-empty">{token.loading ? "…" : prelaunch ? "announced at launch" : "not available"}</span>}</div></td></tr>)}</tbody></table>
      </section>
      <p className="tk-legal">$SHIFT is a utility token, not an investment. Its price can go to zero.</p>
    </div>
  );
}
