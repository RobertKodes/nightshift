import { type ReactNode, useEffect, useState } from "react";
import { PxButton, PxHero, PxNum, PxPanel, PxStat, PxStats, PxTag } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { HeroDots, Prompt, ShStar } from "./saas/pages/shift-kit";
import { useSession } from "./session";
import "./saas/pages/leaderboard.css";

/** What /api/leaderboards/* answers (engine leaderboards.ts). Amounts are decimal strings in their own unit. */
type Unit = "ETH" | "SHIFT" | "IMD" | "USD" | "HOURS";
type Amount = { unit: Unit; amount: string; usd: number | null };
type Part = { amounts: Amount[]; usd: number | null; stats: Record<string, number> };
type SourceState = { state: "live" | "syncing" | "off" | "error"; asOfBlock?: number };
type Prices = { ETH: number | null; SHIFT: number | null; IMD: number | null };
type StakerRow = {
  rank: number; wallet: string;
  shift: { amount: string; usd: number | null; stakes: number; lockedUntil: number | null } | null;
  frogs: { frogs: number; watchers: number; perHour: number; hours: number; imdSeat: boolean } | null;
};
type EarnerRow = { rank: number; wallet: string; usd: number | null; partial: boolean; parts: Partial<Record<EarnerSource, Part>> };
type View<R> = { at: number; source: string; prices: Prices; sources: Record<string, SourceState>; excluded: number; count: number; rows: R[]; me: R | null };
type Totals = { shift: { amount: string; usd: number | null; wallets: number }; frogs: { frogs: number; watchers: number; wallets: number } };
type Summary = { at: number; stakers: View<StakerRow> & { totals: Totals }; earners: View<EarnerRow> };

type Board = "stakers" | "earners";
type StakerSource = "all" | "shift" | "frogs";
type EarnerSource = "staking" | "frogpot" | "games" | "bets" | "watch" | "hours";

/** Each list, its chip and the one line that says what it counts. */
const STAKER_TABS: { id: StakerSource; label: string; line: string }[] = [
  { id: "all", label: "All", line: "Every staking wallet: by $SHIFT staked, then by NIGHT FROGS. Two different assets, shown side by side, never added together." },
  { id: "shift", label: "$SHIFT", line: "$SHIFT staked in ShiftRewards right now: everything staked less everything withdrawn, read from the contract's own events." },
  { id: "frogs", label: "NIGHT FROGS", line: "NIGHT FROGS and Night Watchers held in soft staking (nothing locked), ranked by the shift hours they earn an hour." },
];
const EARNER_TABS: { id: "all" | EarnerSource; label: string; line: string }[] = [
  { id: "all", label: "All", line: "Every source below. Dollars at today's prices, added up only as dollars; shift hours are points, not money." },
  { id: "staking", label: "Staking", line: "$SHIFT staking rewards paid out, in ETH and $SHIFT, from the contract's RewardPaid events." },
  { id: "frogpot", label: "Frog pot", line: "Weekly frog pot shares claimed by NIGHT FROGS holders, from the contract's FrogsClaimed events." },
  { id: "games", label: "Games", line: "Staked duels in IMD or $SHIFT (pinball, chess, pool, poker), net: winnings less stakes lost. A draw refunds both." },
  { id: "bets", label: "Bets", line: "Live bets, net: what was claimed less what was bet. A win or refund still waiting counts once it is claimed." },
  { id: "watch", label: "Night Watch", line: "The liquidation bonus each Night Watch seat kept, less its cut, in dollars at the time." },
  { id: "hours", label: "Shift hours", line: "Points from holding frogs, missions and weekly prizes. Not money: they set each wallet's share of the frog pot." },
];
const PART_NAME: Record<EarnerSource, string> = { staking: "Staking", frogpot: "Frog pot", games: "Games", bets: "Bets", watch: "Night Watch", hours: "Hours" };
const NET: EarnerSource[] = ["games", "bets"];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const DIGITS: Record<Unit, number> = { ETH: 4, SHIFT: 0, IMD: 2, USD: 2, HOURS: 0 };
/** An amount in its unit: big ones compact (1.3M), tiny ones with enough digits to not read as zero. */
function qty(amount: string, unit: Unit, signed = false): string {
  const n = Number(amount), a = Math.abs(n);
  if (!Number.isFinite(n)) return "—";
  const d = a > 0 && a < 10 ** -DIGITS[unit] ? Math.min(8, Math.ceil(-Math.log10(a)) + 1) : DIGITS[unit];
  const body = a >= 1e6 ? a.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 }) : a.toLocaleString("en-US", { maximumFractionDigits: d });
  return `${n < 0 ? "−" : signed && n > 0 ? "+" : ""}${body}`;
}
const money = (usd: number | null | undefined) => {
  if (usd == null || !Number.isFinite(usd)) return "—";
  const a = Math.abs(usd);
  return `${usd < 0 ? "−" : ""}$${a > 0 && a < 0.01 ? "<0.01" : a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const unitLabel = (u: Unit) => (u === "HOURS" ? "h" : u);
const day = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

/** Amounts of one source, each in its own unit (IMD in IMD blue, a loss in red). */
function Amounts({ part, signed }: { part: Part; signed: boolean }) {
  return (
    <span className="lb-amts">
      {part.amounts.map((a) => (
        <span key={a.unit} className={`lb-amt${Number(a.amount) < 0 ? " neg" : ""}${a.unit === "IMD" ? " imd" : ""}`}>
          {a.unit === "USD" ? money(Number(a.amount)) : <>{qty(a.amount, a.unit, signed)} <i>{unitLabel(a.unit)}</i></>}
        </span>
      ))}
    </span>
  );
}

/** What a source's count means, in words. */
function detail(s: EarnerSource, st: Record<string, number>): string | null {
  const n = (k: string) => st[k] ?? 0, pl = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
  if (s === "games") return [n("won") && `${n("won")} won`, n("lost") && `${n("lost")} lost`, n("draws") && pl(n("draws"), "draw")].filter(Boolean).join(" · ") || null;
  if (s === "bets") return pl(n("markets"), "market");
  if (s === "staking") return pl(n("payments"), "payment");
  if (s === "frogpot") return pl(n("claims"), "claim");
  if (s === "watch") return [st.seat === undefined ? null : st.seat === 0 ? "Captain's seat" : `Night Watcher #${st.seat}`, pl(n("liquidations"), "liquidation")].filter(Boolean).join(" · ");
  return null;
}

/** The wallet: short, linked to Etherscan, copyable; "YOU" when it is the signed-in wallet. */
function Who({ wallet, you }: { wallet: string; you: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(wallet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {}); };
  return (
    <span className="lb-who">
      <a className="mono" href={`https://etherscan.io/address/${wallet}`} target="_blank" rel="noreferrer" title={wallet}>{short(wallet)}</a>
      <button type="button" className="lb-copy" onClick={copy} aria-label={`Copy ${wallet}`}>{copied ? "COPIED" : "COPY"}</button>
      {you && <PxTag tone="lime">YOU</PxTag>}
    </span>
  );
}

function StakerCells({ r, source }: { r: StakerRow; source: StakerSource }) {
  const shift = r.shift ? (
    <span className="lb-stack">
      <span className="lb-amt gold">{qty(r.shift.amount, "SHIFT")} <i>SHIFT</i></span>
      <small>{money(r.shift.usd)}{r.shift.lockedUntil ? ` · locked to ${day(r.shift.lockedUntil)}` : " · unlocked"}{source === "shift" ? ` · ${r.shift.stakes} stake${r.shift.stakes === 1 ? "" : "s"}` : ""}</small>
    </span>
  ) : <span className="faint">—</span>;
  const frogs = r.frogs ? (
    <span className="lb-stack">
      <span className="lb-amt">{r.frogs.frogs} frog{r.frogs.frogs === 1 ? "" : "s"}{r.frogs.watchers ? ` · ${r.frogs.watchers} Night Watcher${r.frogs.watchers === 1 ? "" : "s"}` : ""}</span>
      <small>{r.frogs.perHour.toLocaleString("en-US")} h an hour · {r.frogs.hours.toLocaleString("en-US")} h earned{r.frogs.imdSeat ? " · " : ""}{r.frogs.imdSeat && <PxTag tone="imd">IMD SEAT 2×</PxTag>}</small>
    </span>
  ) : <span className="faint">—</span>;
  if (source === "shift") return <td data-label="$SHIFT staked">{shift}</td>;
  if (source === "frogs") return <td data-label="NIGHT FROGS">{frogs}</td>;
  return <><td data-label="$SHIFT staked">{shift}</td><td data-label="NIGHT FROGS">{frogs}</td></>;
}

function EarnerCells({ r, source }: { r: EarnerRow; source: "all" | EarnerSource }) {
  if (source !== "all") {
    const p = r.parts[source]!, d = detail(source, p.stats);
    return (
      <>
        <td data-label={PART_NAME[source]}><span className="lb-stack"><Amounts part={p} signed={NET.includes(source)} />{d && <small>{d}</small>}</span></td>
        {source !== "hours" && <td className="r" data-label="In dollars"><b className={`lb-usd${(p.usd ?? 0) < 0 ? " neg" : ""}`}>{money(p.usd)}</b>{p.usd !== null && p.amounts.some((a) => a.usd === null) && <small className="faint"> + unpriced</small>}</td>}
      </>
    );
  }
  const parts = (Object.keys(r.parts) as EarnerSource[]).sort((a, b) => EARNER_TABS.findIndex((t) => t.id === a) - EARNER_TABS.findIndex((t) => t.id === b));
  return (
    <>
      <td data-label="From">
        <span className="lb-parts">{parts.map((s) => <span key={s} className="lb-part"><b>{PART_NAME[s]}</b><Amounts part={r.parts[s]!} signed={NET.includes(s)} /></span>)}</span>
      </td>
      <td className="r" data-label="In dollars"><b className={`lb-usd${(r.usd ?? 0) < 0 ? " neg" : ""}`}>{money(r.usd)}</b>{r.partial && r.usd !== null && <small className="faint"> + unpriced</small>}</td>
    </>
  );
}

/** Why a list may be short: a source still being read from the chain, one that could not be read, one not open. */
function SourceNotes({ source, sources }: { source: string; sources: Record<string, SourceState> }) {
  const names: Record<string, string> = { shift: "$SHIFT staking", frogs: "NIGHT FROGS staking", staking: "Staking rewards", frogpot: "The frog pot", games: "Staked games", bets: "Bets", watch: "The Night Watch", hours: "Shift hours" };
  const keys = source === "all" ? Object.keys(sources) : [source];
  const notes = keys.flatMap((k) => {
    const s = sources[k];
    if (!s || s.state === "live") return [];
    const at = s.asOfBlock ? ` (read to block ${s.asOfBlock.toLocaleString("en-US")} so far)` : "";
    if (s.state === "syncing") return [`${names[k]}: still being read from Ethereum${at}. Rows may be missing until it finishes.`];
    if (s.state === "error") return [`${names[k]}: could not be read from Ethereum just now${at}. It is tried again in a few minutes.`];
    return source === "all" ? [] : [`${names[k]}: not open yet.`];
  });
  return notes.length ? <div className="sh-warn lb-warn"><PxIcon name="pulse" size={14} /><span>{notes.join(" ")}</span></div> : null;
}

/** The board's top line: #1 staker and #1 earner, read live. */
function TopBoard({ s }: { s: Summary | null | undefined }) {
  const staker = s?.stakers.rows[0], earner = s?.earners.rows[0];
  // the top earner in dollars, else its first amount in its own unit (shift hours, or a token with no price now)
  const first = earner ? Object.values(earner.parts)[0]?.amounts[0] : undefined;
  return (
    <PxPanel className="sh-board lb-top" title="TOP OF THE BOARD" state={s === undefined ? "idle" : s ? "live" : "warn"} right={s ? `UPDATED ${ago(s.at).toUpperCase()}` : undefined}>
      <div className="sh-board-row">
        <div><span>#1 staker</span><b className="gold">{staker ? short(staker.wallet) : "—"}</b><small>{staker?.shift ? `${qty(staker.shift.amount, "SHIFT")} SHIFT` : staker?.frogs ? `${staker.frogs.frogs + staker.frogs.watchers} NFTs` : s === undefined ? "…" : "nobody yet"}</small></div>
        <div><span>#1 earner</span><b className="lime">{earner ? short(earner.wallet) : "—"}</b><small>{earner ? (earner.usd !== null ? money(earner.usd) : first ? `${qty(first.amount, first.unit)} ${unitLabel(first.unit)}` : "—") : s === undefined ? "…" : "nobody yet"}</small></div>
      </div>
      <img className="lb-frog" src="/brand/pepe-operator.svg" alt="" width={40} height={40} loading="lazy" />
      <Prompt cmd="nightshift leaderboard --live" />
    </PxPanel>
  );
}

function readHash(): { board: Board; source: string } {
  const [b, s] = location.hash.replace(/^#/, "").split("/");
  const board: Board = b === "earners" ? "earners" : "stakers";
  const ok = (board === "stakers" ? STAKER_TABS : EARNER_TABS).some((t) => t.id === s);
  return { board, source: ok ? s! : "all" };
}

/** /leaderboard: who stakes and how much, and who NIGHTSHIFT paid the most, from the contracts and the books. */
export function LeaderboardPage() {
  const { address } = useSession();
  const me = address?.toLowerCase() ?? null;
  const [{ board, source }, setPick] = useState(readHash);
  // undefined: still asking; null: the server did not answer
  const [summary, setSummary] = useState<Summary | null | undefined>(undefined);
  const [view, setView] = useState<View<StakerRow | EarnerRow> | null | undefined>(undefined);

  const pick = (b: Board, s: string) => { setPick({ board: b, source: s }); history.replaceState(null, "", `#${b}${s === "all" ? "" : `/${s}`}`); };
  useEffect(() => {
    const go = () => fetch("/api/leaderboards", { signal: AbortSignal.timeout(20_000) }).then((r) => (r.ok ? r.json() : null)).then((x: Summary | null) => setSummary(x?.stakers ? x : null)).catch(() => setSummary((v) => v ?? null));
    go();
    const t = setInterval(go, 120_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let live = true;
    setView(undefined);
    const go = () => fetch(`/api/leaderboards/${board}?source=${source}&limit=100${me ? `&wallet=${me}` : ""}`, { signal: AbortSignal.timeout(20_000) })
      .then((r) => (r.ok ? r.json() : null)).then((x: View<StakerRow | EarnerRow> | null) => { if (live) setView(x && Array.isArray(x.rows) ? x : null); })
      .catch(() => { if (live) setView((v) => v ?? null); });
    go();
    const t = setInterval(go, 120_000);
    return () => { live = false; clearInterval(t); };
  }, [board, source, me]);

  const tabs = board === "stakers" ? STAKER_TABS : EARNER_TABS;
  const tab = tabs.find((t) => t.id === source) ?? tabs[0]!;
  const t = summary?.stakers.totals;
  const head = board === "stakers"
    ? source === "all" ? ["$SHIFT staked", "NIGHT FROGS"] : [source === "shift" ? "$SHIFT staked" : "NIGHT FROGS"]
    : source === "all" ? ["From", "In dollars"] : source === "hours" ? ["Shift hours"] : [PART_NAME[source as EarnerSource], "In dollars"];
  const row = (r: StakerRow | EarnerRow, pinned = false) => (
    <tr key={`${pinned ? "me-" : ""}${r.wallet}`} className={r.wallet === me ? "you" : undefined}>
      <td className="lb-rank" data-label="Rank">#{r.rank}</td>
      <td data-label="Wallet"><Who wallet={r.wallet} you={r.wallet === me} /></td>
      {board === "stakers" ? <StakerCells r={r as StakerRow} source={source as StakerSource} /> : <EarnerCells r={r as EarnerRow} source={source as "all" | EarnerSource} />}
    </tr>
  );
  const mine = view?.me && !view.rows.some((r) => r.wallet === view.me!.wallet) ? view.me : null;
  const p = view?.prices ?? summary?.stakers.prices;

  return (
    <div className="sh lb">
      <PxHero
        kicker="LEADERBOARD"
        live
        title="Who stakes. Who gets paid."
        accent="Receipts, not promises."
        lead={<>Every wallet that stakes on NIGHTSHIFT and how much, and every wallet NIGHTSHIFT has paid: <b>staking rewards, the frog pot, staked games, bets and the Night Watch</b>. Read from the contracts and the books, never typed in. Each token keeps its own unit.</>}
        actions={<>
          <ShStar href="#board" icon="stake">SEE THE BOARD</ShStar>
          <PxButton to="/stake" kind="ghost" icon="lock">Stake $SHIFT</PxButton>
          <PxButton to="/frogs" kind="ghost" icon="token">NIGHT FROGS</PxButton>
        </>}
        aside={<TopBoard s={summary} />}
        bg={<HeroDots />}
      />

      <PxStats cols={4}>
        <PxStat label="$SHIFT staked" tone="gold" value={summary === undefined ? "…" : t ? <PxNum value={Number(t.shift.amount)} compact /> : "—"} sub={t ? <>by {t.shift.wallets} wallet{t.shift.wallets === 1 ? "" : "s"}{t.shift.usd !== null ? ` · ${money(t.shift.usd)}` : ""}</> : "in ShiftRewards"} to="/stake" />
        <PxStat label="Frogs in soft staking" value={summary === undefined ? "…" : t ? <PxNum value={t.frogs.frogs + t.frogs.watchers} /> : "—"} sub={t ? <>{t.frogs.watchers} Night Watcher{t.frogs.watchers === 1 ? "" : "s"} · {t.frogs.wallets} wallet{t.frogs.wallets === 1 ? "" : "s"}</> : "NIGHT FROGS and Night Watchers"} to="/frogs" />
        <PxStat label="Wallets on the board" tone="lime" value={summary === undefined ? "…" : summary ? <PxNum value={summary.earners.count} /> : "—"} sub="with a reward from at least one source" />
        <PxStat label="Prices used" value={<span className="lb-px">{p ? <>SHIFT {p.SHIFT ? `$${p.SHIFT.toPrecision(3)}` : "—"} · IMD {p.IMD ? `$${p.IMD.toFixed(2)}` : "—"} · ETH {p.ETH ? `$${Math.round(p.ETH).toLocaleString("en-US")}` : "—"}</> : "—"}</span>} sub="today's, for the dollar column" />
      </PxStats>
      {summary === null && <p className="sh-warn">NIGHTSHIFT's server did not answer just now, so the board cannot be shown. The page asks again in two minutes; nothing here is ever estimated.</p>}

      <section id="board" className="px-sec pk-sec lb-sec" aria-labelledby="lb-title">
        <div className="px-sec-head">
          <div>
            <span className="px-kicker">THE BOARD</span>
            <h2 className="px-h2" id="lb-title">{board === "stakers" ? <>Top stakers, <em>by what is in.</em></> : <>Top earners, <em>by what was paid.</em></>}</h2>
          </div>
        </div>
        <div className="sh-seg lb-tabs" role="tablist" aria-label="Board">
          <button type="button" role="tab" aria-selected={board === "stakers"} onClick={() => pick("stakers", "all")}>Stakers</button>
          <button type="button" role="tab" aria-selected={board === "earners"} onClick={() => pick("earners", "all")}>Top earners</button>
        </div>
        <div className="sh-chips lb-chips" role="group" aria-label="Source">
          {tabs.map((x) => <button key={x.id} type="button" className={x.id === source ? "on" : undefined} aria-pressed={x.id === source} onClick={() => pick(board, x.id)}>{x.label}</button>)}
        </div>
        <p className="sh-note lb-line">{tab.line}</p>
        {view && <SourceNotes source={source} sources={view.sources} />}

        <PxPanel className="lb-panel" title={`${board === "stakers" ? "STAKERS" : "TOP EARNERS"} · ${tab.label.toUpperCase()}`} state={view === undefined ? "idle" : view && Object.values(source === "all" ? view.sources : { x: view.sources[source] }).every((s) => !s || s.state === "live" || s.state === "off") ? "live" : "warn"} right={view ? `${view.count} WALLET${view.count === 1 ? "" : "S"}` : undefined}>
          {view === undefined ? <p className="sh-line">Reading the board…</p>
            : view === null ? <p className="sh-line">The board could not be read just now. The page tries again in two minutes.</p>
            : view.rows.length === 0 ? <p className="sh-line lb-empty">{board === "stakers" ? "No stakers yet." : "No earners here yet."}</p>
            : (
              <div className="lb-table">
                <table>
                  <thead><tr><th scope="col">Rank</th><th scope="col">Wallet</th>{head.map((h, i) => <th key={h} scope="col" className={i === head.length - 1 && board === "earners" && source !== "hours" ? "r" : undefined}>{h}</th>)}</tr></thead>
                  <tbody>
                    {view.rows.map((r) => row(r))}
                    {mine && <>{<tr className="lb-gap" aria-hidden="true"><td colSpan={2 + head.length}>⋯</td></tr>}{row(mine, true)}</>}
                  </tbody>
                </table>
              </div>
            )}
          {view && view.count > view.rows.length && <p className="sh-line lb-more">Showing the top {view.rows.length} of {view.count}.</p>}
          {!me && view && view.rows.length > 0 && <p className="sh-line lb-more">Sign in with your wallet to see your own place.</p>}
        </PxPanel>
        <p className="sh-note">NIGHTSHIFT's own wallets (dev, treasury, house) are left out. Dollar figures use today's prices and are added up only as dollars, never token to token; an amount with no price right now stays in its own unit. <b>Not financial advice:</b> past payouts say nothing about future ones.</p>
      </section>
    </div>
  );
}
