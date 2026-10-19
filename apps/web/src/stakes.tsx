import { useCallback, useEffect, useRef, useState } from "react";
import { type Address, type Hex, createPublicClient, createWalletClient, custom, erc20Abi, formatUnits, getAddress, http, parseAbi, parseUnits, stringToHex } from "viem";
import { mainnet } from "viem/chains";
import { Icon } from "./Icon";
import { api as session } from "./api";
import { chooseWallet } from "./wallet";
import "./stakes.css";

/**
 * Real-money duels in IMD or $SHIFT through GameEscrow v2, shared by Space Pinball and NIGHT CHESS.
 * The contract, the tokens and the game labels are pinned here in the page: every transaction the
 * browser builds goes to these and checks what the server says against them, so a compromised
 * server cannot redirect a stake. Approvals are for the exact stake only.
 */
export const ESCROW: Address = "0xf460fd9ad76f18414f54a2431870e8a116193489";
export const STAKE_TOKENS = { IMD: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7", SHIFT: "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac" } as const satisfies Record<string, Address>;
export type StakeToken = keyof typeof STAKE_TOKENS;
export type StakeGame = "pinball" | "chess";
const LABELS: Record<StakeGame, Hex> = { pinball: stringToHex("pinball", { size: 32 }), chess: stringToHex("chess", { size: 32 }) };
const ABI = parseAbi([
  "function open(bytes32 matchId, address token, uint256 stake, bytes32 game)",
  "function join(bytes32 matchId)",
  "function settle(bytes32 matchId, address winner, bool draw, uint256 deadline, bytes signature)",
  "function refund(bytes32 matchId)",
  "function cancel(bytes32 matchId)",
  "function limits(address token) view returns (uint256 min, uint256 max)",
  "function matches(bytes32 matchId) view returns (address token, uint256 stake, bytes32 game, address playerA, address playerB, uint256 openedAt, uint256 joinedAt, bool settled)",
]);
const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
const ZERO = "0x0000000000000000000000000000000000000000";
export const tokenLabel = (t: string) => (t === "SHIFT" ? "$SHIFT" : "IMD");
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "?");
const fmt = (wei: bigint) => Number(formatUnits(wei, 18)).toLocaleString(undefined, { maximumFractionDigits: 6 });
const errText = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "").split("\n")[0]!.slice(0, 200);
const tx = (h: string) => `https://etherscan.io/tx/${h}`;
/** The winner's payout from a pot of two stakes: 5% fee, rounded down; the dust goes to the winner. */
export const payoutOf = (stake: bigint) => 2n * stake - (2n * stake * 500n) / 10_000n;

type Escrow = { address: string; live: boolean; signer: string | null; serverSigner: string; paused: boolean | null; limits: Record<StakeToken, { min: string; max: string } | null> };
export type ChallengeView = {
  matchId: Hex; game: StakeGame; token: StakeToken; tokenAddress: string; stake: string; amount: string; tc: string | null; creator: string; name: string;
  playerB: string | null; nameB: string | null; status: string; openedAt: number | null; joinBy: number | null; joinedAt: number | null; refundAt: number | null;
  outcome: { draw: boolean; winner: string | null } | null; signed: boolean; refused: string | null; relay: { state: string; tx: string | null } | null;
  closed: { kind: string; tx: string; winner?: string; draw?: boolean } | null; you: "A" | "B" | null; remaining?: number;
};
export type Seat = { game: StakeGame; id: string; player: string; matchId: Hex };

async function games<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/games/${path}`, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

export function useEscrow(): Escrow | null {
  const [e, setE] = useState<Escrow | null>(null);
  useEffect(() => { void games<Escrow>("escrow").then(setE).catch(() => {}); }, []);
  return e;
}

/** The signed-in wallet's provider, on Ethereum mainnet, the same account as the session. */
async function wallet(address: string) {
  const w = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet()) as never) });
  const [a] = await w.requestAddresses();
  if (!a || a.toLowerCase() !== address.toLowerCase()) throw new Error(`Your wallet is on ${short(a)} but you are signed in as ${short(address)}. Switch the account, or sign in again.`);
  return { w, a: getAddress(a) };
}
/** Checked before every transaction: chain id 1, or the wallet is asked to switch. */
async function mainnetOnly(w: ReturnType<typeof createWalletClient>) {
  if ((await w.getChainId()) === 1) return;
  await w.switchChain({ id: 1 }).catch(() => {});
  if ((await w.getChainId()) !== 1) throw new Error("Switch your wallet to Ethereum mainnet first.");
}

type Ask = { title: string; lines: [string, string][]; resolve: (ok: boolean) => void };
const SAVED = "ns-stake";
const saved = (game: StakeGame): Hex | null => { try { const s = JSON.parse(sessionStorage.getItem(SAVED) ?? "null"); return s?.game === game ? s.matchId : null; } catch { return null; } };
const keep = (game: StakeGame, matchId: Hex | null) => { try { if (matchId) sessionStorage.setItem(SAVED, JSON.stringify({ game, matchId })); else sessionStorage.removeItem(SAVED); } catch { /* private window */ } };

/**
 * The staked lobby for one game: type a stake, create a challenge (approve exactly the stake, then
 * open it), wait for a rival (cancel before a join, refund after the hour), or accept an open one
 * (approve exactly, join). Once both stakes are in, the game hands over the seat.
 */
export function StakeLobby({ game, token, name, tc, address, signIn, onSeat, theme }: {
  game: StakeGame; token: StakeToken; name: string; tc?: string; address: string | null; signIn: () => Promise<void>; onSeat: (s: Seat) => void; theme: "arc" | "nc";
}) {
  const escrow = useEscrow();
  const [amount, setAmount] = useState("");
  const [list, setList] = useState<ChallengeView[]>([]);
  const [mine, setMine] = useState<ChallengeView | null>(null);
  const [mineId, setMineId] = useState<Hex | null>(() => saved(game));
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const seated = useRef(false), seat = useRef(onSeat);
  seat.current = onSeat;
  const lim = escrow?.limits[token] ?? null;
  const live = !!escrow?.live;

  const confirm = (title: string, lines: [string, string][]) => new Promise<boolean>((resolve) => setAsk({ title, lines, resolve }));
  const signedIn = async (): Promise<string> => {
    if (address) return address;
    await signIn();
    const me = (await session.me().catch(() => null))?.address;
    if (!me) throw new Error("Sign in with your wallet to play for a stake.");
    return me;
  };
  const track = (id: Hex | null) => { setMineId(id); keep(game, id); if (!id) setMine(null); seated.current = false; };

  // the open challenges, and the one this player is in, every few seconds
  useEffect(() => {
    let alive = true;
    const load = async () => {
      setNow(Date.now() / 1000);
      const r = await games<{ challenges: ChallengeView[] }>(`challenges?game=${game}`).catch(() => null);
      if (alive && r) setList(r.challenges);
      if (!mineId) return;
      const c = await games<ChallengeView>(`challenge/${mineId}`).catch(() => null);
      if (!alive || !c) return;
      // a game already played, or a challenge closed: nothing left to wait for here
      if (c.outcome || c.closed) { track(null); return; }
      setMine(c);
      if (c.playerB && !seated.current) {
        const s = await games<{ game: StakeGame; id: string; player: string } | { waiting: true }>(`challenge/${mineId}/seat`, {}).catch(() => null);
        if (alive && s && "id" in s) { seated.current = true; seat.current({ ...s, matchId: mineId }); }
      }
    };
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 3_000);
    return () => { alive = false; clearInterval(t); };
  }, [game, mineId]);

  const run = async (label: string, f: () => Promise<void>) => {
    setErr(null); setStep(label);
    try { await f(); } catch (e) { setErr(errText(e)); } finally { setStep(null); }
  };
  /** Approves exactly `stake` to the escrow, only if the allowance is short. */
  const approve = async (w: ReturnType<typeof createWalletClient>, a: Address, tokenAddress: Address, stake: bigint, label: string) => {
    const [bal, allowance] = await Promise.all([
      rpc.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
      rpc.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "allowance", args: [a, ESCROW] }),
    ]);
    if (bal < stake) throw new Error(`This wallet holds ${fmt(bal)} ${label}; the stake is ${fmt(stake)}.`);
    if (allowance >= stake) return;
    if (!(await confirm("Approve the stake", [["Token", `${label} ${short(tokenAddress)}`], ["Spender", `GameEscrow ${ESCROW}`], ["Amount", `exactly ${formatUnits(stake, 18)} ${label}`]]))) throw new Error("Cancelled.");
    await mainnetOnly(w);
    setStep("Approving in your wallet…");
    const h = await w.writeContract({ account: a, chain: mainnet, address: tokenAddress, abi: erc20Abi, functionName: "approve", args: [ESCROW, stake] });
    setStep("Waiting for the approval to confirm…");
    if ((await rpc.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("The approval failed.");
  };

  const create = () => run("Preparing your challenge…", async () => {
    if (!live) throw new Error("Real-money duels open once the result signer is activated.");
    const typed = amount.trim();
    if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/.test(typed)) throw new Error("Type the stake as a number, e.g. 2.5.");
    const stake = parseUnits(typed, 18), tokenAddress = STAKE_TOKENS[token];
    const me = await signedIn();
    const [min, max] = await rpc.readContract({ address: ESCROW, abi: ABI, functionName: "limits", args: [tokenAddress] });
    if (stake < min || stake > max) throw new Error(`The stake must be between ${formatUnits(min, 18)} and ${formatUnits(max, 18)} ${tokenLabel(token)}.`);
    const { w, a } = await wallet(me);
    const r = await games<{ matchId: Hex; game: Hex; token: string; stake: string; escrow: string }>("challenge", { game, token, amount: typed, tc, name });
    // the server's answer must be exactly what was asked, on the pinned contract
    if (r.escrow.toLowerCase() !== ESCROW || r.token.toLowerCase() !== tokenAddress || r.game !== LABELS[game] || BigInt(r.stake) !== stake || !/^0x[0-9a-f]{64}$/.test(r.matchId)) throw new Error("The server's challenge does not match what you asked for. Nothing was sent.");
    await approve(w, a, tokenAddress, stake, tokenLabel(token));
    if (!(await confirm("Open the challenge", [["Contract", `GameEscrow ${ESCROW}`], ["Your stake", `${formatUnits(stake, 18)} ${tokenLabel(token)}`], ["Winner receives", `${formatUnits(payoutOf(stake), 18)} ${tokenLabel(token)} (95% of the pot)`], ["Game", game === "chess" ? `NIGHT CHESS ${tc ?? ""}` : "Space Pinball"], ["Match", short(r.matchId)]]))) throw new Error("Cancelled.");
    await mainnetOnly(w);
    setStep("Opening in your wallet…");
    const h = await w.writeContract({ account: a, chain: mainnet, address: ESCROW, abi: ABI, functionName: "open", args: [r.matchId, tokenAddress, stake, LABELS[game]] });
    track(r.matchId);
    setStep("Waiting for the stake to confirm…");
    if ((await rpc.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("Opening the challenge failed.");
  });

  const accept = (c: ChallengeView) => run("Checking the challenge…", async () => {
    if (!live) throw new Error("Real-money duels open once the result signer is activated.");
    const me = await signedIn();
    if (me.toLowerCase() === c.creator) throw new Error("That is your own challenge.");
    await games(`challenge/${c.matchId}/accept`, { name });
    // what the chain holds, checked against the pinned token and label, before anything is signed
    const m = await rpc.readContract({ address: ESCROW, abi: ABI, functionName: "matches", args: [c.matchId] });
    const tokenAddress = STAKE_TOKENS[c.token], stake = BigInt(c.stake);
    if (!tokenAddress || m[0].toLowerCase() !== tokenAddress || m[1] !== stake || m[2] !== LABELS[game] || m[3].toLowerCase() !== c.creator || m[4] !== ZERO || m[7]) throw new Error("This challenge on chain is not the one listed, or it was taken. Nothing was sent.");
    if (Number(m[5]) + 3_600 < Date.now() / 1000 + 90) throw new Error("This challenge's join window is about to close.");
    const { w, a } = await wallet(me);
    await approve(w, a, tokenAddress, stake, tokenLabel(c.token));
    if (!(await confirm("Accept the challenge", [["Contract", `GameEscrow ${ESCROW}`], ["Your stake", `${formatUnits(stake, 18)} ${tokenLabel(c.token)}`], ["Winner receives", `${formatUnits(payoutOf(stake), 18)} ${tokenLabel(c.token)} (95% of the pot)`], ["Rival", `${c.name} · ${short(c.creator)}`], ["Match", short(c.matchId)]]))) throw new Error("Cancelled.");
    await mainnetOnly(w);
    setStep("Joining in your wallet…");
    const h = await w.writeContract({ account: a, chain: mainnet, address: ESCROW, abi: ABI, functionName: "join", args: [c.matchId] });
    track(c.matchId);
    setStep("Waiting for your stake to confirm…");
    if ((await rpc.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("Joining failed: someone may have joined first.");
  });

  const close = (kind: "cancel" | "refund") => run(kind === "cancel" ? "Cancelling…" : "Refunding…", async () => {
    if (!mineId || !mine) return;
    const me = await signedIn();
    const { w, a } = await wallet(me);
    if (!(await confirm(kind === "cancel" ? "Cancel the challenge" : "Refund the stake", [["Contract", `GameEscrow ${ESCROW}`], ["Call", `${kind}(${short(mineId)})`], ["Back to you", `${mine.amount} ${tokenLabel(mine.token)}`]]))) return;
    await mainnetOnly(w);
    const h = await w.writeContract({ account: a, chain: mainnet, address: ESCROW, abi: ABI, functionName: kind, args: [mineId] });
    if ((await rpc.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error(`The ${kind} failed.`);
    track(null);
  });

  const waiting = mineId && mine && !mine.playerB && !["cancelled", "refunded", "settled"].includes(mine.status);
  const joinLeft = mine?.joinBy ? Math.max(0, Math.floor(mine.joinBy - now)) : null;
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return <div className={`sk sk-${theme}`}>
    <div className="sk-row">
      <span className="sk-kicker">STAKE / {tokenLabel(token)}</span>
      <span className="sk-limits">{lim ? `min ${Number(lim.min).toLocaleString()} · max ${Number(lim.max).toLocaleString()}` : "limits loading…"}</span>
    </div>
    {!live && <p className="sk-note" role="status"><Icon name="lock" size={13} /> Real-money duels open once the result signer is activated.</p>}
    <label className="sk-amount">
      <input inputMode="decimal" placeholder={lim ? `e.g. ${lim.min}` : "amount"} value={amount} disabled={!live || !!step || !!waiting} onChange={(e) => setAmount(e.target.value.replace(",", "."))} aria-label={`Stake in ${tokenLabel(token)}`} />
      <b>{tokenLabel(token)}</b>
    </label>
    {(() => {
      const ok = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/.test(amount.trim()) && lim;
      if (!ok) return <p className="sk-note">Both players stake the same amount. The winner receives 95% of the pot; a draw refunds both.</p>;
      const v = parseUnits(amount.trim(), 18), lo = parseUnits(lim.min, 18), hi = parseUnits(lim.max, 18);
      if (v < lo || v > hi) return <p className="sk-note sk-bad">Choose between {lim.min} and {lim.max} {tokenLabel(token)}.</p>;
      return <p className="sk-note">Each player stakes {fmt(v)} {tokenLabel(token)}. Winner receives <b>{fmt(payoutOf(v))}</b>. The 5% fee supports stakers, NIGHT FROGS holders and SHIFT + IMD burns.</p>;
    })()}
    <button type="button" className="sk-btn primary" disabled={!live || !!step || !!waiting} onClick={() => void create()}><Icon name={live ? "swords" : "lock"} size={18} /><span>{step ?? (live ? "CREATE CHALLENGE" : "OPENS WITH THE SIGNER")}</span></button>
    {err && <p className="sk-err" role="alert">{err}</p>}

    <div className="sk-row"><span className="sk-kicker">OPEN CHALLENGES</span><span className="sk-limits">{list.length || "none yet"}</span></div>
    {list.length ? <ul className="sk-list">{list.map((c) => <li key={c.matchId}>
      <span><b>{c.name}</b><small>{short(c.creator)}{c.tc ? ` · ${c.tc}` : ""} · {clock(Math.max(0, Math.floor((c.joinBy ?? 0) - now)))} left</small></span>
      <strong>{Number(c.amount).toLocaleString()} {tokenLabel(c.token)}</strong>
      {c.you === "A" ? <em>YOURS</em> : <button type="button" className="sk-btn small" disabled={!live || !!step || !!waiting} onClick={() => void accept(c)}>ACCEPT</button>}
    </li>)}</ul> : <p className="sk-note">No open {game === "chess" ? "chess" : "pinball"} challenges. Create one; it stays open for an hour.</p>}
    <p className="sk-note sk-fine">Contract <a href={`https://etherscan.io/address/${ESCROW}`} target="_blank" rel="noreferrer">{short(ESCROW)} ↗</a> · results signed by the server, paid by the contract.</p>

    {waiting && <div className={`sk-overlay ${theme}-overlay`} role="dialog" aria-modal="true" aria-labelledby="sk-wait">
      <div className="sk-dialog">
        <div className="sk-radar"><Icon name="radar" size={30} /></div>
        <span className="sk-kicker">{mine.status === "pending" ? "CONFIRMING ON CHAIN" : "CHALLENGE OPEN"} · {mine.amount} {tokenLabel(mine.token)}</span>
        <h2 id="sk-wait">Waiting for<br />a rival</h2>
        <p>{mine.status === "expired" && !mine.openedAt ? "This challenge was never opened on chain, so no stake is held." : mine.status === "pending" ? "Your stake is on its way to the escrow. The challenge is listed once the chain confirms it." : mine.status === "expired" ? "Nobody joined within the hour. Take your stake back." : `Anyone can accept it for the next ${clock(joinLeft ?? 0)}. The game starts for both of you when they join.`}</p>
        {mine.status !== "expired" && <button type="button" className="sk-btn" disabled={!!step || mine.status === "pending"} onClick={() => void close("cancel")}>{step ?? "CANCEL AND TAKE THE STAKE BACK"}</button>}
        {mine.openedAt && (mine.status === "expired" || joinLeft === 0) && <button type="button" className="sk-btn primary" disabled={!!step} onClick={() => void close("refund")}>{step ?? "REFUND MY STAKE"}</button>}
        {!mine.openedAt && mine.status === "expired" && <button type="button" className="sk-btn ghost" onClick={() => track(null)}>NOT OPENED ON CHAIN · DISMISS</button>}
        {err && <p className="sk-err" role="alert">{err}</p>}
      </div>
    </div>}
    {ask && <div className={`sk-overlay ${theme}-overlay`} role="dialog" aria-modal="true" aria-labelledby="sk-ask">
      <div className="sk-dialog">
        <span className="sk-kicker">CHECK BEFORE YOU SIGN</span>
        <h2 id="sk-ask">{ask.title}</h2>
        <dl className="sk-facts">{ask.lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <button type="button" className="sk-btn primary" autoFocus onClick={() => { ask.resolve(true); setAsk(null); }}>CONTINUE IN WALLET</button>
        <button type="button" className="sk-btn ghost" onClick={() => { ask.resolve(false); setAsk(null); }}>CANCEL</button>
      </div>
    </div>}
  </div>;
}

/**
 * The money side of a finished staked game: the payout transaction once it is sent, or a button
 * that submits the signed result from the player's own wallet if the server's relay has not.
 */
export function StakeResult({ matchId, address }: { matchId: string; address: string | null }) {
  const [c, setC] = useState<ChallengeView | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const load = useCallback(() => games<ChallengeView>(`challenge/${matchId}`).then(setC).catch(() => {}), [matchId]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 4_000); return () => clearInterval(t); }, [load]);
  if (!c) return <p className="sk-note">Checking the escrow…</p>;
  const label = tokenLabel(c.token), stake = BigInt(c.stake);
  const youWon = !!address && c.outcome && !c.outcome.draw && c.outcome.winner === address.toLowerCase();
  const now = Date.now() / 1000;
  const claim = async (kind: "settle" | "refund") => {
    setErr(null); setStep(kind === "settle" ? "Preparing…" : "Refunding…");
    try {
      if (!address) throw new Error("Sign in with the wallet you played with.");
      const { w, a } = await wallet(address);
      await mainnetOnly(w);
      let h: Hex;
      if (kind === "settle") {
        const s = await games<{ escrow: string; matchId: Hex; winner: Address; draw: boolean; deadline: string; signature: Hex }>(`challenge/${matchId}/signature`, {});
        if (s.escrow.toLowerCase() !== ESCROW || s.matchId !== matchId) throw new Error("The signed result is not for this match. Nothing was sent.");
        setStep("Confirm in your wallet…");
        h = await w.writeContract({ account: a, chain: mainnet, address: ESCROW, abi: ABI, functionName: "settle", args: [s.matchId, s.winner, s.draw, BigInt(s.deadline), s.signature] });
      } else h = await w.writeContract({ account: a, chain: mainnet, address: ESCROW, abi: ABI, functionName: "refund", args: [matchId as Hex] });
      setSent(h);
      setStep("Waiting for the transaction…");
      if ((await rpc.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("The transaction failed.");
      void load();
    } catch (e) { setErr(errText(e)); } finally { setStep(null); }
  };
  const relayTx = c.relay?.tx;
  return <div className="sk-result" role="status">
    <span className="sk-kicker">STAKE · {c.amount} {label} EACH · ESCROW {short(ESCROW)}</span>
    {c.closed ? <p>{c.closed.kind === "settled" ? c.closed.draw ? `Draw: both stakes went back (${c.amount} ${label} each).` : `Paid out: ${fmt(payoutOf(stake))} ${label} to ${short(c.closed.winner)}${c.closed.winner === address?.toLowerCase() ? " (you)" : ""}.` : `Stakes ${c.closed.kind}.`} <a href={tx(c.closed.tx)} target="_blank" rel="noreferrer">Etherscan ↗</a></p>
      : c.refused ? <p className="sk-bad">No result can be signed for this match ({c.refused}). Both stakes can be refunded from {new Date((c.refundAt ?? 0) * 1000).toLocaleString()}.</p>
      : !c.outcome ? <p>Waiting for the verified result…</p>
      : relayTx && c.relay?.state !== "failed" ? <p>{c.outcome.draw ? "Draw: refunding both stakes." : youWon ? `You won ${fmt(payoutOf(stake))} ${label}.` : "Paying the winner."} Payout sent: <a href={tx(relayTx)} target="_blank" rel="noreferrer">{short(relayTx)} ↗</a></p>
      : <p>{c.outcome.draw ? "Draw: both stakes go back." : youWon ? `You won ${fmt(payoutOf(stake))} ${label}.` : "Your rival won this one."} {c.signed ? c.relay?.state === "failed" || !c.relay ? "The server could not send the payout; you can submit the signed result yourself." : "Sending the payout…" : "Signing the result…"}</p>}
    {!c.closed && c.signed && (c.relay?.state === "failed" || !c.relay) && c.you && (youWon || c.outcome?.draw) && <button type="button" className="sk-btn primary" disabled={!!step} onClick={() => void claim("settle")}>{step ?? (youWon ? "CLAIM WINNINGS" : "REFUND BOTH STAKES")}</button>}
    {!c.closed && c.you && c.refundAt && now >= c.refundAt && <button type="button" className="sk-btn" disabled={!!step} onClick={() => void claim("refund")}>{step ?? "REFUND THE STAKES"}</button>}
    {sent && <p className="sk-note">Your transaction: <a href={tx(sent)} target="_blank" rel="noreferrer">{short(sent)} ↗</a></p>}
    {err && <p className="sk-err" role="alert">{err}</p>}
  </div>;
}
