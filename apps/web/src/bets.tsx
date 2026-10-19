import { useCallback, useEffect, useRef, useState } from "react";
import { type Address, type Hex, erc20Abi, formatUnits, parseAbi, parseUnits, stringToHex } from "viem";
import { mainnet } from "viem/chains";
import { Icon } from "./Icon";
import { api } from "./api";
import { useSession } from "./session";
import { STAKE_TOKENS, type StakeToken, mainnetOnly, rpc, tokenLabel, wallet } from "./stakes";
import "./stakes.css";
import "./bets.css";

/**
 * LIVE BETS for spectators: a compact panel under every watch view (NIGHT CHESS, Space Pinball and
 * the Agent Arena). Bets go to BetPool on Ethereum, pinned here with the tokens and game labels:
 * every ticket and market the server sends is checked against them before anything is signed, so
 * a compromised server cannot redirect a bet. Approvals are for the exact bet only.
 *
 * Each bet counts with the weight the server gives it at that moment ("bets now count 0.62x"):
 * early bets and bets on the side behind count more; winners share the losing side (minus 5%) in
 * proportion to amount × weight. While BETPOOL is empty the panel only says betting opens soon.
 */
export const BETPOOL = "" as Address | "";
export type BetGame = "chess" | "pinball" | "arena";
const LABELS: Record<BetGame, Hex> = { chess: stringToHex("chess", { size: 32 }), pinball: stringToHex("pinball", { size: 32 }), arena: stringToHex("arena", { size: 32 }) };
const ABI = parseAbi([
  "function createMarket(bytes32 marketId, address token, uint64 closesAt, bytes32 game, bytes signature)",
  "function bet(bytes32 marketId, uint8 side, uint256 amount, uint16 weightBps, uint64 expiry, bytes32 nonce, bytes signature)",
  "function settle(bytes32 marketId, uint8 outcome, uint256 deadline, bytes signature)",
  "function claim(bytes32 marketId)",
  "function claimMany(bytes32[] marketIds)",
  "function markets(bytes32 marketId) view returns (address token, uint64 closesAt, bytes32 game, uint256 totalA, uint256 totalB, uint256 sharesA, uint256 sharesB, bool settled, uint8 outcome, bool refundable)",
]);
/** One-tap amounts, per token. */
const QUICK: Record<StakeToken, string[]> = { IMD: ["1", "5", "25"], SHIFT: ["50000", "250000", "1000000"] };
const AMOUNT = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "?");
const fmt = (wei: string | bigint) => { const n = Number(formatUnits(BigInt(wei), 18)); return n >= 1e6 ? `${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}M` : n >= 1e4 ? `${(n / 1e3).toLocaleString(undefined, { maximumFractionDigits: 1 })}k` : n.toLocaleString(undefined, { maximumFractionDigits: 3 }); };
const times = (bps: number) => `${(bps / 10_000).toFixed(2)}x`;
const errText = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "").split("\n")[0]!.slice(0, 200);
const etherscan = (h: string) => `https://etherscan.io/tx/${h}`;

type MarketView = {
  marketId: Hex; token: string; symbol: StakeToken; closesAt: number; game: Hex; created: boolean; signature: Hex | null; keeper: { state: string; tx: string | null } | null;
  totals: { a: string; b: string; sharesA: string; sharesB: string; bets: number }; outcome: number | null; closed: { kind: string; tx: string; outcome?: number } | null;
  settlement: { outcome: number; deadline: string; signature: Hex } | null; relay: { state: string; tx: string | null } | null;
};
type Mine = { amountA: string; amountB: string; sharesA: string; sharesB: string; claimed: boolean; claimable: string } | null;
type View = {
  configured: boolean; live: boolean; betPool: string | null; game: BetGame; id: string; names: [string, string];
  /** False for a free game (or agents of one owner): no market, ever. */
  eligible: boolean;
  weights: { A: number; B: number; progress: number; leader: 0 | 1 | null } | null; locked: string | null; outcome: number | null;
  limits: Record<StakeToken, { min: string; max: string }> | null; markets: Record<StakeToken, MarketView | null>;
  feed: { key: string; bettor: string; side: 0 | 1; amount: string; weightBps: number; tx: string; at: number; token: StakeToken }[];
  you: Record<StakeToken, Mine> | null; ticketTtl: number;
};
type Ticket = {
  betPool: string; signature: Hex; weightBps: number; expiresIn: number;
  ticket: { marketId: Hex; bettor: string; side: number; amount: string; weightBps: number; expiry: number; nonce: Hex };
  market: { marketId: Hex; token: string; closesAt: number; game: Hex; created: boolean; signature: Hex | null; keeper: { state: string; tx: string | null } | null };
};
type Ask = { title: string; lines: [string, string][]; resolve: (ok: boolean) => void };

async function bets<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/bets/${path}`, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status });
  return j as T;
}

/** The "opens soon" state: the sides and the idea, nothing to click. */
function Soon({ names, theme }: { names?: [string, string]; theme: string }) {
  return <section className={`bt bt-${theme} bt-soon`} aria-label="Live betting">
    <div className="bt-head"><span className="sk-kicker">LIVE BETS</span><span className="bt-state"><Icon name="lock" size={12} />OPENS SOON</span></div>
    {names && <div className="bt-sides" aria-hidden="true">{names.map((n, i) => <div key={i} className="bt-side"><small>{i ? "SIDE B" : "SIDE A"}</small><b>{n}</b><span>—</span></div>)}</div>}
    <p className="sk-note">Live betting opens soon: back a player or an agent in IMD or $SHIFT while you watch. Early and underdog bets count more; winners share the losing side.</p>
  </section>;
}

/**
 * The betting panel for one match. `game` is where the page watches it; the server answers with
 * the board it is really played on (an arena table on the site's chess board is "chess").
 */
export function BetPanel({ game, id, theme }: { game: BetGame; id: string; theme: "nc" | "arc" | "ar" }) {
  const { address, signIn } = useSession();
  const [v, setV] = useState<View | null>(null);
  const [gone, setGone] = useState(false);
  const [token, setToken] = useState<StakeToken>("IMD");
  const [side, setSide] = useState<0 | 1 | null>(null);
  const [amount, setAmount] = useState("5");
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (document.hidden) return;
    try { const x = await bets<View>(`market?game=${game}&id=${encodeURIComponent(id)}`); if (alive.current) { setV(x); setGone(false); } }
    catch (e) { if (alive.current && (e as { status?: number }).status === 404) setGone(true); }
  }, [game, id]);
  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => void load(), 3_000);
    return () => { alive.current = false; clearInterval(t); };
  }, [load, address]);

  if (!v) return gone ? null : <section className={`bt bt-${theme}`} aria-label="Live betting"><p className="sk-note" role="status">Loading live bets…</p></section>;
  // a free game: no market at all, whether or not the pool is live
  if (!v.eligible) return <section className={`bt bt-${theme} bt-soon`} aria-label="Live betting">
    <div className="bt-head"><span className="sk-kicker">LIVE BETS</span><span className="bt-state"><Icon name="lock" size={12} />NOT FOR THIS GAME</span></div>
    <p className="sk-note">Betting is for staked duels and agent games.</p>
  </section>;
  // not deployed yet, or the server speaks of another pool than the one pinned here: nothing to click
  if (!BETPOOL || (!v.configured || v.betPool?.toLowerCase() !== BETPOOL.toLowerCase())) return <Soon names={v.names} theme={theme} />;

  const m = v.markets[token], mine = v.you?.[token] ?? null, lim = v.limits?.[token] ?? null;
  const open = v.live && !v.locked && v.outcome === null;
  const confirm = (title: string, lines: [string, string][]) => new Promise<boolean>((resolve) => setAsk({ title, lines, resolve }));
  const signedIn = async (): Promise<string> => {
    if (address) return address;
    await signIn();
    const me = (await api.me().catch(() => null))?.address;
    if (!me) throw new Error("Sign in with your wallet to bet.");
    return me;
  };
  const run = async (label: string, f: () => Promise<void>) => {
    setErr(null); setDone(null); setStep(label);
    try { await f(); void load(); } catch (e) { setErr(errText(e)); } finally { setStep(null); }
  };

  /** A ticket, checked against what was asked and against the pinned pool, token and game label. */
  const ticket = async (me: string, s: 0 | 1, value: bigint): Promise<Ticket> => {
    const t = await bets<Ticket>("ticket", { game, matchId: id, side: s ? "B" : "A", token, amount: formatUnits(value, 18) });
    // the board the server says it is played on: the page's own, or the site's chess board for an arena table
    if (!(v.game === game || (game === "arena" && v.game === "chess"))) throw new Error("The server's market is for another game. Nothing was sent.");
    const label = LABELS[v.game];
    if (t.betPool.toLowerCase() !== BETPOOL.toLowerCase() || t.ticket.bettor.toLowerCase() !== me.toLowerCase() || t.ticket.side !== s || BigInt(t.ticket.amount) !== value
      || t.market.token.toLowerCase() !== STAKE_TOKENS[token] || t.market.game !== label || t.market.marketId !== t.ticket.marketId || !/^0x[0-9a-f]{64}$/.test(t.ticket.marketId)
      || t.ticket.weightBps < 500 || t.ticket.weightBps > 10_000 || t.ticket.expiry > Date.now() / 1000 + 125) throw new Error("The server's ticket does not match what you asked for. Nothing was sent.");
    return t;
  };
  const onChain = async (marketId: Hex) => (await rpc.readContract({ address: BETPOOL as Address, abi: ABI, functionName: "markets", args: [marketId] }))[1] > 0n;

  const place = () => run("Preparing your bet…", async () => {
    if (side === null) throw new Error("Tap the side you back first.");
    const typed = amount.trim();
    if (!AMOUNT.test(typed)) throw new Error("Type the amount as a number, e.g. 5.");
    const value = parseUnits(typed, 18), tokenAddress = STAKE_TOKENS[token], label = tokenLabel(token);
    if (lim && (value < parseUnits(lim.min, 18) || value > parseUnits(lim.max, 18))) throw new Error(`A bet is between ${Number(lim.min).toLocaleString()} and ${Number(lim.max).toLocaleString()} ${label}.`);
    const me = await signedIn();
    // a first ticket: the game is open for this bet now, and the market is known
    let t = await ticket(me, side, value);
    const { w, a } = await wallet(me);
    const [bal, allowance] = await Promise.all([
      rpc.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
      rpc.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "allowance", args: [a, BETPOOL as Address] }),
    ]);
    if (bal < value) throw new Error(`This wallet holds ${fmt(bal)} ${label}; the bet is ${fmt(value)}.`);
    if (allowance < value) {
      if (!(await confirm("Approve the bet", [["Token", `${label} ${short(tokenAddress)}`], ["Spender", `BetPool ${BETPOOL}`], ["Amount", `exactly ${formatUnits(value, 18)} ${label}`]]))) throw new Error("Cancelled.");
      await mainnetOnly(w);
      setStep("Approving in your wallet…");
      const h = await w.writeContract({ account: a, chain: mainnet, address: tokenAddress, abi: erc20Abi, functionName: "approve", args: [BETPOOL as Address, value] });
      setStep("Waiting for the approval…");
      if ((await rpc.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("The approval failed.");
    }
    // the market: usually opened by the keeper meanwhile; otherwise this wallet opens it with the server's signature
    if (!(await onChain(t.ticket.marketId))) {
      t = await ticket(me, side, value);
      if (t.market.keeper?.tx && t.market.keeper.state !== "failed") {
        setStep("Opening the market…");
        await rpc.waitForTransactionReceipt({ hash: t.market.keeper.tx as Hex, timeout: 90_000 }).catch(() => null);
      }
      if (!(await onChain(t.ticket.marketId))) {
        if (!t.market.signature) throw new Error("The market is not open yet. Try again in a moment.");
        if (!(await confirm("Open the market", [["Contract", `BetPool ${BETPOOL}`], ["Market", short(t.market.marketId)], ["Why", "You are the first to bet on this game in " + label]]))) throw new Error("Cancelled.");
        await mainnetOnly(w);
        setStep("Opening the market in your wallet…");
        const h = await w.writeContract({ account: a, chain: mainnet, address: BETPOOL as Address, abi: ABI, functionName: "createMarket", args: [t.market.marketId, t.market.token as Address, BigInt(t.market.closesAt), t.market.game, t.market.signature] });
        if ((await rpc.waitForTransactionReceipt({ hash: h })).status !== "success" && !(await onChain(t.ticket.marketId))) throw new Error("Opening the market failed.");
      }
    }
    // the bet itself, on a fresh ticket: its weight is the game's right now
    const name = v.names[side];
    if (!(await confirm("Place the bet", [["Contract", `BetPool ${BETPOOL}`], ["On", `${name} (side ${side ? "B" : "A"})`], ["Amount", `${formatUnits(value, 18)} ${label}`], ["Counts as", `${times(t.weightBps)} now (it may move a little)`], ["If it wins", "your bet back plus a share of the losing side, minus 5%"]]))) throw new Error("Cancelled.");
    t = await ticket(me, side, value);
    await mainnetOnly(w);
    setStep(`Confirm in your wallet (${times(t.weightBps)}, ${t.expiresIn}s)…`);
    const h = await w.writeContract({ account: a, chain: mainnet, address: BETPOOL as Address, abi: ABI, functionName: "bet", args: [t.ticket.marketId, side, value, t.ticket.weightBps, BigInt(t.ticket.expiry), t.ticket.nonce, t.signature] });
    setStep("Waiting for the bet to confirm…");
    if ((await rpc.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("The bet failed: its ticket may have expired. Try again.");
    setDone(h);
  });

  const claimable = (["IMD", "SHIFT"] as const).filter((t) => v.markets[t]?.closed && BigInt(v.you?.[t]?.claimable ?? "0") > 0n);
  const claim = () => run("Claiming…", async () => {
    const me = await signedIn();
    const ids = claimable.map((t) => v.markets[t]!.marketId);
    if (!ids.length) throw new Error("Nothing to claim.");
    const { w, a } = await wallet(me);
    await mainnetOnly(w);
    const h = ids.length > 1
      ? await w.writeContract({ account: a, chain: mainnet, address: BETPOOL as Address, abi: ABI, functionName: "claimMany", args: [ids] })
      : await w.writeContract({ account: a, chain: mainnet, address: BETPOOL as Address, abi: ABI, functionName: "claim", args: [ids[0]!] });
    if ((await rpc.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("The claim failed.");
    setDone(h);
  });
  // the server's relay did not settle the pool: anyone may submit the signed outcome
  const settleable = m && m.created && !m.closed && m.settlement && (!m.relay || m.relay.state === "failed");
  const settle = () => run("Settling…", async () => {
    if (!m?.settlement) return;
    const me = await signedIn();
    const s = await bets<{ betPool: string; marketId: Hex; outcome: number; deadline: string; signature: Hex }>(`settlement?marketId=${m.marketId}`);
    if (s.betPool.toLowerCase() !== BETPOOL.toLowerCase() || s.marketId !== m.marketId || ![0, 1, 2].includes(s.outcome)) throw new Error("The signed outcome is not for this market. Nothing was sent.");
    const { w, a } = await wallet(me);
    await mainnetOnly(w);
    const h = await w.writeContract({ account: a, chain: mainnet, address: BETPOOL as Address, abi: ABI, functionName: "settle", args: [s.marketId, s.outcome, BigInt(s.deadline), s.signature] });
    if ((await rpc.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("Settling failed.");
  });

  const poolA = BigInt(m?.totals.a ?? "0"), poolB = BigInt(m?.totals.b ?? "0"), pool = poolA + poolB;
  const share = pool > 0n ? Number((poolA * 1000n) / pool) / 10 : 50;
  const w8 = v.weights;
  const result = v.outcome === null ? null : v.outcome === 2 ? "Void: every bet is refunded, no fee." : `${v.names[v.outcome]} won.`;
  const quick = QUICK[token];
  const valid = AMOUNT.test(amount.trim());

  return <section className={`bt bt-${theme}${theme === "nc" ? " sk-nc" : ""}`} aria-label="Live betting">
    <div className="bt-head">
      <span className="sk-kicker">LIVE BETS</span>
      <span className="bt-tokens" role="group" aria-label="Currency">{(["IMD", "SHIFT"] as const).map((t) => <button key={t} type="button" aria-pressed={token === t} className={token === t ? "on" : ""} onClick={() => setToken(t)}>{tokenLabel(t)}</button>)}</span>
      <span className={`bt-state ${open ? "on" : ""}`} role="status">{open ? <><i className="bt-dot" />OPEN</> : <><Icon name="lock" size={12} />{v.outcome !== null ? "CLOSED" : !v.live ? "OPENS SOON" : "LOCKED"}</>}</span>
    </div>
    <div className="bt-sides" role="radiogroup" aria-label="Back a side">
      {v.names.map((n, i) => {
        const s = i as 0 | 1, wt = w8 ? (s ? w8.B : w8.A) : null, mineHere = mine ? BigInt(s ? mine.amountB : mine.amountA) : 0n;
        return <button key={i} type="button" role="radio" aria-checked={side === s} disabled={!open} className={`bt-side ${side === s ? "picked" : ""} ${v.outcome === s ? "won" : ""}`} onClick={() => setSide(s)}>
          <small>{s ? "SIDE B" : "SIDE A"}{w8?.leader === s ? " · AHEAD" : ""}</small>
          <b>{n}</b>
          <span>{fmt(s ? poolB : poolA)} {tokenLabel(token)}</span>
          {wt !== null && <em title="How much a bet placed now counts">bets now count {times(wt)}</em>}
          {mineHere > 0n && <i>you: {fmt(mineHere)}</i>}
        </button>;
      })}
    </div>
    <div className="bt-bar" aria-hidden="true"><span style={{ width: `${share}%` }} /></div>
    {!open && <p className="bt-lock" role="status"><Icon name={v.outcome !== null ? "trophy" : "lock"} size={13} />{result ?? (!v.live ? "Live betting opens once the result signer is activated." : v.locked)}</p>}
    {open && <>
      <div className="bt-amounts" role="group" aria-label="Amount">
        {quick.map((q) => <button key={q} type="button" className={amount === q ? "on" : ""} onClick={() => setAmount(q)}>{fmt(parseUnits(q, 18))}</button>)}
        <label><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} aria-label={`Bet in ${tokenLabel(token)}`} /><b>{tokenLabel(token)}</b></label>
      </div>
      <button type="button" className="sk-btn primary bt-go" disabled={!!step || side === null || !valid} onClick={() => void place()}>
        <Icon name="target" size={16} /><span>{step ?? (side === null ? "TAP A SIDE TO BET" : `BET ${valid ? fmt(parseUnits(amount.trim(), 18)) : ""} ${tokenLabel(token)} ON ${v.names[side].toUpperCase()}`)}</span>
      </button>
      {lim && <p className="sk-note sk-fine">{Number(lim.min).toLocaleString()} to {Number(lim.max).toLocaleString()} {tokenLabel(token)} a bet · early and underdog bets count more · winners share the losing side minus 5%.</p>}
    </>}
    {claimable.length > 0 && <button type="button" className="sk-btn primary" disabled={!!step} onClick={() => void claim()}><Icon name="trophy" size={16} /><span>{step ?? `CLAIM WINNINGS · ${claimable.map((t) => `${fmt(v.you![t]!.claimable)} ${tokenLabel(t)}`).join(" + ")}`}</span></button>}
    {settleable && <button type="button" className="sk-btn" disabled={!!step} onClick={() => void settle()}>{step ?? "SETTLE THE POOL (SIGNED RESULT)"}</button>}
    {err && <p className="sk-err" role="alert">{err}</p>}
    {done && <p className="sk-note">Confirmed: <a href={etherscan(done)} target="_blank" rel="noreferrer">{short(done)} ↗</a></p>}
    {v.feed.length > 0 && <ul className="bt-feed" aria-label="Latest bets">{v.feed.slice(0, 5).map((f) => <li key={f.key}>
      <span>{short(f.bettor)}</span><b>{fmt(f.amount)} {tokenLabel(f.token)}</b><span>on {v.names[f.side]}</span><em>{times(f.weightBps)}</em>
    </li>)}</ul>}
    <p className="sk-note sk-fine">Pool <a href={`https://etherscan.io/address/${BETPOOL}`} target="_blank" rel="noreferrer">{short(BETPOOL)} ↗</a> · paid on the server-verified result · 18+, only where betting is legal.</p>
    {ask && <div className={`sk-overlay ${theme}-overlay`} role="dialog" aria-modal="true" aria-labelledby="bt-ask">
      <div className="sk-dialog">
        <span className="sk-kicker">CHECK BEFORE YOU SIGN</span>
        <h2 id="bt-ask">{ask.title}</h2>
        <dl className="sk-facts">{ask.lines.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>
        <button type="button" className="sk-btn primary" autoFocus onClick={() => { ask.resolve(true); setAsk(null); }}>CONTINUE IN WALLET</button>
        <button type="button" className="sk-btn ghost" onClick={() => { ask.resolve(false); setAsk(null); }}>CANCEL</button>
      </div>
    </div>}
  </section>;
}
