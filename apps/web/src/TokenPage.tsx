import { BenefitsCard } from "./BenefitsCard";
import { HowThisConnects } from "./HowThisConnects";
import { RewardsCard } from "./nx/Rewards";
import { LIVE_LAUNCH, SHIFT } from "./shift";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { SwapBox } from "./SwapPage";
import { safeHref } from "./safe";
import { type PoolKey } from "./v4";
import StatusMark from "./rb/StatusMark";
import { PxButton, PxHero, PxNum, PxPanel, PxSection, PxStat, PxStats, PxTag } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { Flap, HeroDots, Prompt, ShStar } from "./saas/pages/shift-kit";
import "./saas/pages/token.css";

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

/** A formatted live figure: "…" while it loads, "—" when the read came back without it. */
function Metric({ value, loading, format = compact }: { value: unknown; loading: boolean; format?: (n: number) => string }) {
  const n = number(value);
  return n === null ? <span className="tk-unavailable" title={loading ? undefined : "not available"}>{loading ? "…" : "—"}</span> : <>{format(n)}</>;
}

/** The same figure, counting up once it scrolls into view. */
function Live({ value, loading, decimals = 0, suffix = "", compact: short = false }: { value: unknown; loading: boolean; decimals?: number; suffix?: string; compact?: boolean }) {
  const n = number(value);
  return n === null ? <span className="tk-unavailable" title={loading ? undefined : "not available"}>{loading ? "…" : "—"}</span> : <PxNum value={n} decimals={decimals} suffix={suffix} compact={short} />;
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
  return <ul id={id} className="tk-checks" hidden={hidden}>{checks.map((check, i) => <li key={`${check.label}-${i}`}>
    <StatusMark status={check.ok === true ? "done" : check.ok === false ? "failed" : "pending"} size={18} strokeWidth={2} color="#5f7364" doneColor="#b8ff3d" errorColor="#f2c14e" className="tk-check-mark" />
    <div><b>{check.label}</b>{check.detail && <span>{check.detail}</span>}</div>
    <span className={`tk-check-result ${check.ok === true ? "pass" : check.ok === false ? "review" : "na"}`}>{check.ok === true ? "PASS" : check.ok === false ? "REVIEW" : "NOT AVAILABLE"}</span>
  </li>)}</ul>;
}

/** A live token hub. The shared app shell owns the header and footer. */
/** IMD's distributor of the swarm's 10% of $SHIFT (100,000,000 at launch #2124), claimed by seat holders and agents. */
const IMD_DISTRIBUTOR = "0x0d4dd35026087e720033786578a7e718c8b34897";
/** The largest $SHIFT balances, which are all contracts: shown so nobody mistakes them for a wallet that could dump. */
const BIG_HOLDERS: [string, string, string][] = [
  ["Uniswap v4 PoolManager", "0x000000000004444c5dc75cB358380D2e3dE08A90", "The SHIFT/ETH pool's liquidity. It is the market itself: nobody owns it."],
  ["ShiftRewards (staking)", SHIFT.rewards, "Every staker's $SHIFT plus the rewards waiting to be paid. Staked tokens stay their stakers': nobody, the owner included, can take them or unlock them early. Etherscan counts both, so it shows more than the staked counter."],
  ["IMD swarm distributor", IMD_DISTRIBUTOR, "The 10% of the supply that IMD's rules give to the swarm: 8% to seat holders, 2% to the agents who built and audited $SHIFT. It received 100,000,000 at launch and pays out as seat holders claim, so it shrinks over time."],
];

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
    ["Frogs", FROGS],
    ["IMD swarm distributor", live ? IMD_DISTRIBUTOR : null],
  ];
  const swapLaunch = live && l ? { ...l, token: ca ?? l.token, symbol: t?.symbol ?? l.symbol ?? "SHIFT", pool: l.pool ?? undefined } : null;
  const uniswap = ca ? safeHref(t?.buyUrl) ?? `https://app.uniswap.org/swap?chain=mainnet&inputCurrency=NATIVE&outputCurrency=${ca}` : null;
  const chart = ca ? safeHref(o?.market?.chart) ?? `https://dexscreener.com/ethereum/${ca}` : null;
  const status = token.loading ? "CONNECTING" : prelaunch ? "PRE-LAUNCH" : live ? "LIVE ON ETHEREUM" : "STATUS NOT AVAILABLE";
  const refresh = overview.loading ? "READING LIVE DATA…" : overview.updatedAt ? "DATA REFRESHES EVERY 60S" : "LIVE DATA NOT AVAILABLE";
  const priceNow = number(o?.market?.priceUsd);

  useEffect(() => { document.title = "$SHIFT · NIGHTSHIFT"; }, []);

  const board = (
    <PxPanel className="sh-board tk-board" title="$SHIFT / ETH · PRICE" state={live ? "live" : prelaunch || token.loading ? "idle" : "warn"}>
      <span className="sh-board-k">PER $SHIFT · UNISWAP V4 POOL</span>
      <div className="sh-flap-wrap" title={overview.updatedAt ? `Last read ${new Date(overview.updatedAt).toLocaleTimeString()}` : undefined}>
        <Flap text={priceNow !== null ? price(priceNow) : overview.loading ? "…" : "—"} size={26} />
      </div>
      <div className="sh-board-row">
        <div><span>Market cap</span><b><Metric value={o?.market?.mcap} loading={overview.loading} format={usd} /></b></div>
        <div><span>Liquidity</span><b><Metric value={o?.market?.liquidity} loading={overview.loading} format={usd} /></b></div>
      </div>
      <div className="tk-market-links" aria-label="Markets">
        {uniswap && <a href={uniswap} target="_blank" rel="noreferrer" aria-label="Buy $SHIFT on Uniswap" title="Uniswap"><Icon name="swap" size={14} />UNISWAP</a>}
        {chart && <a href={chart} target="_blank" rel="noreferrer" aria-label="$SHIFT on DexScreener" title="DexScreener"><Icon name="radar" size={14} />CHART</a>}
        {ca && <a href={`https://etherscan.io/token/${ca}`} target="_blank" rel="noreferrer" aria-label="$SHIFT on Etherscan" title="Etherscan"><Icon name="external" size={14} />ETHERSCAN</a>}
        {!ca && <span>{token.loading ? "…" : prelaunch ? "MARKETS OPEN AT LAUNCH" : "MARKET LINKS NOT AVAILABLE"}</span>}
      </div>
      <div className="tk-board-foot"><span className={`tk-status${live ? " is-live" : ""}`}><i />{status}</span><span className="tk-refresh">{refresh}</span></div>
      <Prompt cmd="quote --pair SHIFT/ETH" />
    </PxPanel>
  );

  return (
    <div className="sh sh-token">
      <PxHero
        kicker="$SHIFT / ETHEREUM"
        live={live}
        title="The fuel of the"
        accent="night shift."
        lead={<>See your benefits. Swap, stake and check funded rewards. <b>One supply, minted once, only going down.</b></>}
        actions={<>
          <ShStar href="#tk-swap" icon="swap">SWAP $SHIFT</ShStar>
          <PxButton to="/stake" icon="stake">STAKE</PxButton>
          <PxButton to="/frogs" kind="ghost" icon="blocks">FROGS</PxButton>
        </>}
        aside={board}
        bg={<HeroDots />}
      />

      <PxStats cols={4}>
        <PxStat to="/stake" label="Staked · of supply" tone="lime" value={<Live value={o?.stakedPct} loading={overview.loading} decimals={2} suffix="%" />} sub={<><Metric value={o?.staked} loading={overview.loading} format={(n) => `${whole(n)} SHIFT staked`} /> · EARN YOUR SHARE</>} />
        <PxStat to="/frogs" label="Frogs minted" value={<><Live value={minted} loading={overview.loading || frogs.loading} /><small className="tk-of"> / {whole(frogMax)}</small></>} sub="Earned hours weight a share of the funded Frog reward pot." />
        <PxStat to="/tokenomics" label="Circulating" value={<Live value={o?.circulating} loading={overview.loading} compact />} sub="$SHIFT out in the world" />
        <PxStat to="/tokenomics" label="Burned forever" tone="gold" value={<Live value={o?.burnedShift} loading={overview.loading} compact />} sub="$SHIFT sent to 0x…dEaD" />
      </PxStats>

      <nav className="sh-chips" aria-label="$SHIFT"><a href="#benefits">Benefits</a><a href="#tk-swap">Swap</a><a href="/stake">Stake SHIFT</a><a href="#rewards">Rewards</a><a href="/frogs">Frogs</a></nav>

      {prelaunch && <p className="sh-warn"><Icon name="alert" size={18} /><span><b>$SHIFT has not launched.</b> The contract is announced at launch, here and on our official channels. Any other $SHIFT token or contract is fake.</span></p>}

      <div className="tk-clarity"><BenefitsCard /></div>

      <div className="tk-workspace">
        <section id="tk-swap" className="tk-swap" aria-label="$SHIFT contract and swap" tabIndex={-1}>
          <PxPanel title={<>$SHIFT · CONTRACT</>} right="ETHEREUM" className="tk-contract">
            <div className="tk-token-name"><img src="/brand/shift-icon.svg" alt="" width={30} height={30} /><b>$SHIFT</b><PxTag tone={live ? "lime" : "dim"}>{status}</PxTag></div>
            <div className="tk-address"><span>CONTRACT</span><div>{ca ? <><a href={etherscan(ca)} target="_blank" rel="noreferrer">{ca}</a><CopyButton value={ca} label="$SHIFT" /></> : <span className="tk-address-empty">{token.loading ? "…" : prelaunch ? "announced at launch" : "not available"}</span>}</div></div>
          </PxPanel>
          <SwapBox launch={prelaunch || swapLaunch?.pool ? swapLaunch : LIVE_LAUNCH} />
        </section>
        <PxPanel title="BUILT IN THE OPEN · THE STORY SO FAR" className="tk-timeline">
          <h2 className="sh-sr" id="tk-timeline-title">The story so far</h2>
          <ol aria-labelledby="tk-timeline-title">
            <li><span className="tk-timeline-dot" /><div><span className="tk-label">{launchMonth(l?.at, token.loading)}</span><p>{live ? "Launched" : "Launch"} through IMD{launchNumber !== null ? <>, launch #{launchNumber}</> : <span className="tk-timeline-missing"> · launch number {token.loading ? "…" : "not available"}</span>}</p><TxLink tx={live ? l?.tx : null} label="Launch transaction" /></div></li>
            <li><span className="tk-timeline-dot" /><div><span className="tk-label">THE FIRST BUY</span><p>{live ? "Treasury made the first buy; trading opened to everyone." : "Treasury makes the first buy; trading opens to everyone."}</p><TxLink tx={live ? l?.openTx : null} label="The first buy" /></div></li>
            <li><span className="tk-timeline-dot" /><div><span className="tk-label">THE ONE RULE</span><p>Fee splitter, rewards and the burn keeper {live ? "went" : "go"} live.</p>{live && address(contracts?.splitter) && <a className="tk-proof" href={etherscan(contracts!.splitter!)} target="_blank" rel="noreferrer">Fee splitter<Icon name="external" size={12} /></a>}</div></li>
            <li><span className="tk-timeline-dot" /><div><span className="tk-label">PUT IT TO WORK</span><p>Staking {live ? "opened" : "opens"}.</p><a className="tk-proof" href="/stake">Stake $SHIFT<Icon name="arrow" size={12} /></a></div></li>
            <li><span className="tk-timeline-dot" /><div><span className="tk-label">THE NIGHT CREW</span><p>Frog rewards use earned hours toward the funded pot.</p><a className="tk-proof" href="/frogs">Meet the crew<Icon name="arrow" size={12} /></a></div></li>
            <li className="tk-next"><span className="tk-timeline-dot" /><div><span className="tk-label tk-next-label">NEXT</span><p>Space Pinball duels in $SHIFT and IMD.</p></div></li>
          </ol>
        </PxPanel>
      </div>

      <section id="rewards" className="tk-rewards"><RewardsCard /></section>
      <div className="tk-clarity"><HowThisConnects current="token" /></div>
      <details className="clarity-more tk-more"><summary>More</summary><nav><a href="/tokenomics">Tokenomics</a><a href="/whitepaper">Whitepaper</a><a href="/watch">Run a keeper</a></nav></details>

      <PxSection kicker="ONE SUPPLY. ONLY GOING DOWN." title={<>Where the <em>billion</em> is.</>} id="tk-supply-title">
        <PxPanel title="SUPPLY · LIVE" state={hasSupply ? "live" : "idle"} className="tk-supply">
          <p className="tk-supply-line"><span><b><Live value={o?.circulating} loading={overview.loading} compact /></b> circulating.</span> <span><b className="lime"><Live value={o?.staked} loading={overview.loading} compact /></b> staked.</span> <span><b className="gold"><Live value={o?.burnedShift} loading={overview.loading} compact /></b> burned forever.</span></p>
          <div className={`tk-supply-bar${hasSupply ? "" : " is-unavailable"}`} role="img" aria-label={hasSupply ? `${whole(segments[0]!)} circulating, ${whole(segments[1]!)} staked, ${whole(segments[2]!)} burned SHIFT` : overview.loading ? "Loading supply breakdown" : "Supply breakdown not available"}>{hasSupply && segments.map((value, i) => <span key={i} className={["tk-circulating", "tk-staked", "tk-burned"][i]} style={{ width: `${(value! / segmentTotal) * 100}%` }} />)}</div>
          <div className="tk-supply-legend">{[["Circulating", "tk-circulating", o?.circulating], ["Staked", "tk-staked", o?.staked], ["Burned forever", "tk-burned", o?.burnedShift]].map(([label, color, value]) => <div key={String(label)}><i className={String(color)} /><span>{label}</span><b><Metric value={value} loading={overview.loading} /></b></div>)}</div>
          <p className="sh-note">1,000,000,000 minted once. No mint function. Pool and hook costs affect trading output. Review the actual quote before signing.</p>
        </PxPanel>
      </PxSection>

      <PxSection kicker="FEESPLITTER · ETHEREUM" title={<>Follow the <em>received fees.</em></>} id="tk-fees-title">
        <PxPanel title="WHERE THE FEES GO" tone="gold">
          <p className="sh-line">FeeSplitter handles the Ethereum assets it receives. House USDC sales on Base do not automatically reach it. Staking rewards and the Frog pot depend on funding; Agent Reserve buys go to the team wallet.</p>
          <a className="tk-text-link" href="/how-it-works">How payments, fees and rewards connect →</a>
        </PxPanel>
      </PxSection>

      <PxSection kicker="TRUST THE CONTRACTS" title={<>Checked <em>on chain.</em></>} id="tk-checks-title">
        <PxPanel title="ON-CHAIN CHECKS" state={checks.length ? "live" : "idle"} right={checks.length > 0 ? `${checks.filter((check) => check.ok === true).length} / ${checks.length} PASSED` : undefined}>
          {checks.length ? <><CheckList checks={checks.slice(0, 5)} />{checks.length > 5 && <><button type="button" className="tk-expand" aria-expanded={showAllChecks} aria-controls="tk-more-checks" onClick={() => setShowAllChecks((value) => !value)}>{showAllChecks ? "SHOW FEWER CHECKS" : `VIEW ${checks.length - 5} MORE CHECKS`}<PxIcon name="arrow" size={13} /></button><CheckList id="tk-more-checks" checks={checks.slice(5)} hidden={!showAllChecks} /></>}</> : <p className="tk-empty">{token.loading ? "…" : prelaunch ? "On-chain checks will appear at launch." : "Verification checks not available."}</p>}
        </PxPanel>
      </PxSection>

      <PxSection kicker="EVERY ADDRESS, IN THE OPEN" title={<>The <em>contracts.</em></>} id="tk-contracts-title" more={{ to: "/tokenomics", label: "Full tokenomics" }}>
        <div className="sh-table tk-contracts"><table><caption className="sh-sr">NIGHTSHIFT contracts on Ethereum</caption><thead><tr><th scope="col">Contract</th><th scope="col">Ethereum address</th></tr></thead><tbody>{contractRows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td><div className="tk-addr-cell">{value ? <><a className="tk-contract-link" href={etherscan(value)} target="_blank" rel="noreferrer"><span>{value}</span><Icon name="external" size={13} /></a><CopyButton value={value} label={label} /></> : <span className="tk-address-empty">{token.loading ? "…" : prelaunch ? "announced at launch" : "not available"}</span>}</div></td></tr>)}</tbody></table></div>
      </PxSection>

      <PxSection kicker="THE BIG HOLDERS, EXPLAINED" title={<>Nobody's <em>whale bag.</em></>} id="tk-holders-title" sub="The largest $SHIFT balances on Etherscan are contracts, not people. Each one is listed here so you can check it.">
        <div className="sh-table tk-contracts"><table><caption className="sh-sr">The largest $SHIFT holders</caption><thead><tr><th scope="col">Holder</th><th scope="col">What it is</th></tr></thead><tbody>
          {BIG_HOLDERS.map(([name, addr, what]) => <tr key={addr}><th scope="row"><a href={`https://etherscan.io/token/${SHIFT.token}?a=${addr}`} target="_blank" rel="noreferrer">{name}</a><br /><code>{addr.slice(0, 6)}…{addr.slice(-4)}</code></th><td>{what}</td></tr>)}
        </tbody></table></div>
      </PxSection>
      <p className="sh-legal">$SHIFT is a utility token, not an investment. Its price can go to zero.</p>
    </div>
  );
}
