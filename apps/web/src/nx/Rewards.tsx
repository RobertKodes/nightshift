import { ethTransport } from "../ethRpc";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Address, type Hex, createPublicClient, formatEther, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { api, authHeaders } from "../api";
import { type Call, canBatch, rejected, sendSteps } from "../batch";
import { Link } from "../router";
import { useSession } from "../session";
import { SHIFT } from "../shift";
import { ESCROW, mainnetOnly, wallet } from "../stakes";
import { NxIcon } from "./icons";
import { PrizeLines } from "../games/prizes";

/**
 * YOUR REWARDS, on the front page: everything the signed-in wallet can claim or withdraw right now,
 * read in one go from /api/rewards/<wallet>, each with one button, and one button for all of it.
 * Every transaction is built here, to the contracts pinned in the page (ShiftRewards, GameEscrow),
 * dry-run first, and asks for no approval: a claim only ever pays out.
 */
const rpc = createPublicClient({ chain: mainnet, transport: ethTransport() });
const REWARDS = parseAbi(["function getReward()", "function claimFrogs(uint256 epoch, address token, uint256 amount, bytes32[] proof)"]);
const ESCROW_ABI = parseAbi(["function settle(bytes32 matchId, address winner, bool draw, uint256 deadline, bytes signature)", "function refund(bytes32 matchId)"]);
const ETH: Address = "0x0000000000000000000000000000000000000000";

type Prices = { ETH: number | null; SHIFT: number | null; IMD: number | null };
type Data = {
  wallet: string; at: number; prices: Prices; totalUsd: number | null;
  staking: { staked: string; eth: string; shift: string } | null;
  frogs: { epoch: number; token: string; symbol: string; amount: string; proof: string[]; postedAt: number | null }[]; frogsClaimed: number;
  games: {
    claimable: { matchId: Hex; game: string; token: string; tokenAddress: string; kind: "settle" | "refund"; amount: string; draw: boolean; at: number }[];
    recent: { matchId: Hex; game: string; token: string; result: string; amount: string; tx: string | null; at: number }[];
  };
  companies: { id: string; slug: string; name: string; usd: number; feeBps: number }[] | null;
};
/** One line of the list: on-chain (a call, built fresh right before it is sent) or a company withdrawal (the server sends it). */
type Row = { key: string; icon: string; acc: string; title: string; sub: string; amount: string; usd: number | null; button: string; call?: () => Promise<Call>; company?: string };
type Outcome = { ok: boolean; text: string; tx?: string };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const errText = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "").split("\n")[0]!.slice(0, 160);
const tok = (wei: string | bigint, sym: string) => {
  const n = Number(formatEther(BigInt(wei)));
  const v = n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toFixed(sym === "ETH" ? 6 : 4);
  return `${v} ${sym === "SHIFT" ? "$SHIFT" : sym}`;
};
const usdText = (n: number | null) => (n === null ? "" : n < 0.01 ? "< $0.01" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const valued = (wei: string, sym: string, p: Prices) => { const x = p[sym as keyof Prices]; return x == null ? null : Number(formatEther(BigInt(wei))) * x; };
const GAME: Record<string, [string, string, string]> = { chess: ["NIGHT CHESS", "chess", "/games/chess"], pool: ["NIGHT POOL", "pool", "/games/pool"], poker: ["NIGHT POKER", "poker", "/games/poker"], pinball: ["Space Pinball", "pinball", "/games/pinball"] };
const tx = (h: string) => `https://etherscan.io/tx/${h}`;

/** The signed result of a staked game, checked against this match and this escrow before it is ever signed by the wallet. */
async function settleCall(matchId: Hex, me: string): Promise<Call> {
  const r = await fetch(`/api/games/challenge/${matchId}/signature`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: "{}" });
  const s = await r.json().catch(() => ({})) as { error?: string; escrow?: string; matchId?: Hex; winner?: Address; draw?: boolean; deadline?: string; signature?: Hex };
  if (!r.ok) throw new Error(s.error ?? `HTTP ${r.status}`);
  if (s.escrow?.toLowerCase() !== ESCROW || s.matchId !== matchId) throw new Error("The signed result is not for this match. Nothing was sent.");
  if (!s.draw && s.winner?.toLowerCase() !== me.toLowerCase()) throw new Error("The signed result does not pay this wallet. Nothing was sent.");
  return { address: ESCROW, abi: ESCROW_ABI, functionName: "settle", args: [s.matchId, s.winner, s.draw, BigInt(s.deadline!), s.signature] };
}

function rowsOf(d: Data, me: string): Row[] {
  const p = d.prices, rows: Row[] = [];
  const s = d.staking;
  if (s && (BigInt(s.eth) > 0n || BigInt(s.shift) > 0n)) {
    const parts = [...(BigInt(s.eth) > 0n ? [tok(s.eth, "ETH")] : []), ...(BigInt(s.shift) > 0n ? [tok(s.shift, "SHIFT")] : [])];
    const usd = (valued(s.eth, "ETH", p) ?? 0) + (valued(s.shift, "SHIFT", p) ?? 0);
    rows.push({ key: "staking", icon: "stake", acc: "#a48bff", title: "Staking rewards", sub: `ShiftRewards · on ${tok(s.staked, "SHIFT")} staked`, amount: parts.join(" + "), usd: p.ETH === null && p.SHIFT === null ? null : usd, button: "Claim",
      call: async () => ({ address: SHIFT.rewards, abi: REWARDS, functionName: "getReward" }) });
  }
  for (const f of d.frogs) {
    // only the two reward tokens the contract pays, whatever the server says
    const token = f.token.toLowerCase();
    if (token !== ETH && token !== SHIFT.token.toLowerCase()) continue;
    const left = f.postedAt ? Math.max(0, Math.ceil((f.postedAt + 30 * 86_400_000 - Date.now()) / 86_400_000)) : null;
    rows.push({ key: `frog-${f.epoch}-${token}`, icon: "frogs", acc: "#b8ff4a", title: `Frogs · epoch ${f.epoch}`, sub: left !== null ? `holder rewards · about ${left} day${left === 1 ? "" : "s"} left to claim` : "holder rewards · 30 days to claim", amount: tok(f.amount, f.symbol), usd: valued(f.amount, f.symbol, p), button: "Claim",
      call: async () => ({ address: SHIFT.rewards, abi: REWARDS, functionName: "claimFrogs", args: [BigInt(f.epoch), token as Address, BigInt(f.amount), f.proof as Hex[]] }) });
  }
  for (const g of d.games.claimable) {
    const [name, icon] = GAME[g.game] ?? [g.game, "play"];
    rows.push({ key: `game-${g.matchId}`, icon, acc: "#4ad8ff", title: g.kind === "refund" ? `${name} · stake refund` : g.draw ? `${name} · draw, your stake back` : `${name} · winnings`, sub: g.kind === "refund" ? "the match timed out: the escrow returns your stake" : "signed result · GameEscrow pays 95% of the pot", amount: tok(g.amount, g.token), usd: valued(g.amount, g.token, p), button: g.kind === "refund" ? "Refund" : "Claim",
      call: g.kind === "refund" ? async () => ({ address: ESCROW, abi: ESCROW_ABI, functionName: "refund", args: [g.matchId] }) : () => settleCall(g.matchId, me) });
  }
  for (const c of d.companies ?? []) {
    rows.push({ key: `co-${c.id}`, icon: "companies", acc: "#ffc861", title: `${c.name} · sales`, sub: `company revenue in USDC on Base${c.feeBps ? ` · ${(c.feeBps / 100).toFixed(2)}% platform fee for this withdrawal` : ""}`, amount: `${c.usd.toFixed(2)} USDC`, usd: c.usd, button: "Withdraw", company: c.id });
  }
  return rows;
}

export function RewardsCard() {
  const session = useSession();
  const me = session.address;
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [say, setSay] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, Outcome>>({});
  const [history, setHistory] = useState(false);
  const meRef = useRef(me);
  meRef.current = me;

  const load = useCallback(async (fresh = false) => {
    const who = meRef.current;
    if (!who) return;
    try {
      const r = await fetch(`/api/rewards/${who}${fresh ? "?fresh=1" : ""}`, { headers: authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      if (who === meRef.current) { setD(j as Data); setErr(null); }
    } catch (e) { if (who === meRef.current) setErr(errText(e)); }
  }, []);
  useEffect(() => { setD(null); setDone({}); setErr(null); if (me) void load(); }, [me, load]);
  useEffect(() => {
    if (!me) return;
    const t = setInterval(() => { if (!document.hidden && !busy) void load(); }, 60_000);
    return () => clearInterval(t);
  }, [me, busy, load]);
  // the chain is a block or two behind a receipt: read again now and shortly after
  const reread = () => { void load(true); setTimeout(() => void load(true), 15_000); };

  if (!me) return (
    <section className="nx-rw" aria-label="Your rewards">
      <div className="nx-rw-head">
        <span className="nx-rw-k"><NxIcon name="money" size={16} />YOUR REWARDS</span>
        <p className="nx-rw-line">$SHIFT staking, Frog holder rewards, staked-game winnings and company sales, claimed in one place.</p>
        <button type="button" className="nx-rw-all" disabled={session.busy} onClick={() => void session.signIn()}>{session.busy ? "Check your wallet…" : "Check my rewards"}<NxIcon name="arrow" size={16} /></button>
      </div>
      {session.error && <p className="nx-rw-msg bad" role="alert">{session.error}</p>}
    </section>
  );

  const rows = d ? rowsOf(d, me) : [];
  const open = rows.filter((r) => !done[r.key]?.ok);
  const total = open.reduce<number | null>((a, r) => (r.usd === null ? a : (a ?? 0) + r.usd), null);

  /** One on-chain claim: built fresh, dry-run, then signed. */
  const prepare = async (r: Row, a: Address) => {
    const c = await r.call!();
    // the dry run: a claim the contract would refuse (already claimed, past its window) costs nothing
    await rpc.simulateContract({ account: a, address: c.address, abi: c.abi as never, functionName: c.functionName as never, args: (c.args ?? []) as never }).catch((e) => { throw new Error(`The contract would refuse it right now (${errText(e)}). Nothing was sent.`); });
    return c;
  };
  const withdraw = async (r: Row) => {
    const w = await api.withdraw(r.company!);
    setDone((x) => ({ ...x, [r.key]: { ok: true, text: `Sent ${w.sentUsd.toFixed(2)} USDC${w.feeUsd ? ` (fee ${w.feeUsd.toFixed(2)})` : ""}`, tx: w.txs[0] } }));
  };

  const claimOne = async (r: Row) => {
    setBusy(r.key); setSay(null);
    try {
      if (r.company) { setSay(`Withdrawing ${r.title.replace(/ · sales$/, "")}…`); await withdraw(r); return; }
      const { w, a } = await wallet(me);
      await mainnetOnly(w);
      setSay("Checking the claim…");
      const c = await prepare(r, a);
      setSay("Confirm in your wallet…");
      const h = await w.writeContract({ account: a, chain: mainnet, address: c.address, abi: c.abi as never, functionName: c.functionName as never, args: (c.args ?? []) as never });
      setSay("Waiting for Ethereum…");
      const rc = await rpc.waitForTransactionReceipt({ hash: h });
      setDone((x) => ({ ...x, [r.key]: rc.status === "success" ? { ok: true, text: "Claimed", tx: h } : { ok: false, text: "Reverted: nothing moved but gas", tx: h } }));
    } catch (e) { setDone((x) => ({ ...x, [r.key]: { ok: false, text: rejected(e) ? "You declined in the wallet" : errText(e) } })); }
    finally { setBusy(null); setSay(null); reread(); }
  };

  const claimAll = async () => {
    setBusy("all"); setSay(null);
    const chain = open.filter((r) => r.call), cos = open.filter((r) => r.company);
    try {
      if (chain.length) {
        const { w, a } = await wallet(me);
        await mainnetOnly(w);
        // every claim is built and dry-run first; one the contract would refuse is left out, never sent
        const ready: { r: Row; c: Call }[] = [];
        for (const [i, r] of chain.entries()) {
          setSay(`Checking ${i + 1} of ${chain.length}: ${r.title}…`);
          try { ready.push({ r, c: await prepare(r, a) }); } catch (e) { setDone((x) => ({ ...x, [r.key]: { ok: false, text: errText(e) } })); }
        }
        if (ready.length > 1 && (await canBatch(w, a))) {
          const sent = await sendSteps(w, a, ready.map(({ r, c }) => ({ call: c, sign: `Confirm: ${r.title}…` })), { batched: true, once: `Confirm once in your wallet: ${ready.length} claims in one transaction…`, wait: "Waiting for Ethereum…", say: setSay });
          const res: Outcome = sent.ok ? { ok: true, text: sent.batched ? "Claimed in one batch" : "Claimed", tx: sent.hash } : { ok: false, text: "The batch reverted: nothing moved but gas", tx: sent.hash };
          setDone((x) => ({ ...x, ...Object.fromEntries(ready.map(({ r }) => [r.key, res])) }));
        } else {
          // one by one, each on its own: a refused or reverted claim does not stop the others
          for (const [i, { r, c }] of ready.entries()) {
            setSay(`Claim ${i + 1} of ${ready.length}: ${r.title}. Confirm in your wallet…`);
            try {
              const h = await w.writeContract({ account: a, chain: mainnet, address: c.address, abi: c.abi as never, functionName: c.functionName as never, args: (c.args ?? []) as never });
              setSay(`Claim ${i + 1} of ${ready.length}: waiting for Ethereum…`);
              const rc = await rpc.waitForTransactionReceipt({ hash: h });
              setDone((x) => ({ ...x, [r.key]: rc.status === "success" ? { ok: true, text: "Claimed", tx: h } : { ok: false, text: "Reverted: nothing moved but gas", tx: h } }));
            } catch (e) {
              if (rejected(e)) { setDone((x) => ({ ...x, [r.key]: { ok: false, text: "You declined in the wallet" } })); throw new Error(`Stopped: you declined claim ${i + 1} of ${ready.length}.`); }
              setDone((x) => ({ ...x, [r.key]: { ok: false, text: errText(e) } }));
            }
          }
        }
      }
      for (const [i, r] of cos.entries()) {
        setSay(`Withdrawal ${i + 1} of ${cos.length}: ${r.title.replace(/ · sales$/, "")}…`);
        try { await withdraw(r); } catch (e) { setDone((x) => ({ ...x, [r.key]: { ok: false, text: errText(e) } })); }
      }
    } catch (e) { setErr(rejected(e) ? "You declined in the wallet. Nothing more was sent." : errText(e)); }
    finally { setBusy(null); setSay(null); reread(); }
  };

  const recent = d?.games.recent ?? [];
  return (
    <section className="nx-rw" aria-label="Your rewards">
      <div className="nx-rw-head">
        <span className="nx-rw-k"><NxIcon name="money" size={16} />YOUR REWARDS<small>{short(me)}</small></span>
        <span className="nx-rw-total">{!d ? "Reading…" : open.length ? <><b>{total !== null ? usdText(total) : `${open.length}`}</b> to claim now</> : "Nothing to claim right now"}</span>
        {open.length > 0 && <button type="button" className="nx-rw-all" disabled={Boolean(busy)} onClick={() => void claimAll()}>{busy === "all" ? "Claiming…" : open.length > 1 ? `Claim all (${open.length})` : "Claim it"}<NxIcon name="arrow" size={16} /></button>}
      </div>
      {say && <p className="nx-rw-msg" role="status" aria-live="polite">{say}</p>}
      {err && <p className="nx-rw-msg bad" role="alert">{err} {!d && <button type="button" className="nx-rw-link" onClick={() => void load()}>Try again</button>}</p>}
      {rows.length > 0 && <ul className="nx-rw-list">
        {rows.map((r) => {
          const o = done[r.key];
          return (
            <li key={r.key} className={`nx-rw-row${o?.ok ? " is-done" : ""}`} style={{ "--acc": r.acc } as React.CSSProperties}>
              <span className="nx-rw-ic"><NxIcon name={r.icon} size={18} /></span>
              <span className="nx-rw-what"><b>{r.title}</b><small>{r.sub}</small></span>
              <span className="nx-rw-amt"><b>{r.amount}</b><small>{usdText(r.usd)}</small></span>
              <span className="nx-rw-act">
                {o?.ok ? <span className="nx-rw-ok">{o.text} {o.tx && <a href={tx(o.tx)} target="_blank" rel="noreferrer">Etherscan ↗</a>}</span>
                  : <button type="button" className="nx-rw-btn" disabled={Boolean(busy)} onClick={() => void claimOne(r)}>{busy === r.key ? "…" : r.button}</button>}
                {o && !o.ok && <small className="nx-rw-bad">{o.text}{o.tx && <> · <a href={tx(o.tx)} target="_blank" rel="noreferrer">Etherscan ↗</a></>}</small>}
              </span>
            </li>
          );
        })}
      </ul>}
      <PrizeLines wallet={me} />
      <nav className="nx-rw-foot" aria-label="Rewards pages">
        <Link to="/stake">Staking</Link>
        <Link to="/frogs">Frogs{d?.frogsClaimed ? ` · ${d.frogsClaimed} claimed` : ""}</Link>
        {d?.companies && <Link to="/my">Owner desk</Link>}
        <button type="button" className="nx-rw-link" aria-expanded={history} onClick={() => setHistory((h) => !h)}>Staked games{recent.length ? ` · ${recent.length} recent` : ""} {history ? "▴" : "▾"}</button>
      </nav>
      {history && (recent.length
        ? <ul className="nx-rw-hist">{recent.map((g) => {
            const [name, , to] = GAME[g.game] ?? [g.game, "", "/games"];
            const what = g.result === "won" ? `won ${tok(g.amount, g.token)}` : g.result === "lost" ? `lost ${tok(g.amount, g.token)}` : g.result === "draw" ? `draw · ${tok(g.amount, g.token)} back` : g.result === "paying" ? `payout on its way · ${tok(g.amount, g.token)}` : `${g.result} · ${tok(g.amount, g.token)}`;
            return <li key={g.matchId}><Link to={to}>{name}</Link><span className={g.result === "won" ? "good" : g.result === "lost" ? "dim" : ""}>{what}</span><time>{new Date(g.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</time>{g.tx ? <a href={tx(g.tx)} target="_blank" rel="noreferrer">Etherscan ↗</a> : <span />}</li>;
          })}</ul>
        : <p className="nx-rw-msg">No staked games in the last two weeks. <Link to="/games/chess">NIGHT CHESS</Link> · <Link to="/games/pool">NIGHT POOL</Link> · <Link to="/games/poker">NIGHT POKER</Link> · <Link to="/games/pinball">Space Pinball</Link></p>)}
    </section>
  );
}
