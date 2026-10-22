import { useEffect, useState } from "react";
import { createWalletClient, custom } from "viem";
import { mainnet } from "viem/chains";
import { NxIcon } from "./nx/icons";
import { Link } from "./router";
import { Stat, rememberRoom } from "./station/Station";
import { chooseWallet } from "./wallet";
import { WatchGuide } from "./WatchGuide";
import "./forge.css";
import "./watch.css";

/**
 * THE NIGHT WATCH: the keeper crew of imdUSD, one seat per Night Watcher plus the Captain's seat (NIGHT FROG #1).
 * Everything here comes from /api/watch (the coordinator's read of the vault, apps/engine/src/nightwatch.ts).
 * A seat's owner pairs their bot here with one signature: the same typed data the coordinator verifies.
 */
const PAIR_DOMAIN = { name: "NIGHTSHIFT Night Watch", version: "1", chainId: 1 } as const;
const PAIR_TYPES = { Seat: [{ name: "watcher", type: "uint256" }, { name: "keeper", type: "address" }, { name: "issuedAt", type: "uint256" }] } as const;
const REPO = "https://github.com/RobertKodes/nightshift/tree/main/nightwatch";

type Terms = { weight: number; cutBps: number };
type Loan = { owner: string; debt: number; cr: number; state: string; opensAt: number | null; closesAt: number | null; repay: number };
type SeatRow = { watcher: number; tier: string | null; weight: number; cutBps: number; keeper: string; online: boolean; valid: boolean | null; inventory: number | null; bites: number; marks: number; earnedUsd: number; arrears: boolean };
type Status = {
  open: boolean; watchers: number; terms: Record<string, Terms>; splitter: string;
  book: null | { blockTime: number; mat: number; lullHours: number; bonusPct: number; stale: string[]; supply: number; totalDebt: number; backing: number; peg: number | null; owners: number; loans: number; closestCr: number; watchlist: Loan[] };
  seats: SeatRow[]; recent: { tx: string; watcher: number | null; debt: number; usd: number; at: number }[];
};

const TIER_NAMES = ["Shift Lead", "Foreman", "Supervisor", "Chief", "Night Boss"];
const num = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d });
const STATE: Record<string, string> = { safe: "near the line", unmarked: "under the line", grace: "marked · in grace", actionable: "open to liquidate", expired: "mark expired" };
const seatLabel = (w: number) => (w === 0 ? "Captain's seat · NIGHT FROG #1 / The Captain" : `Night Watcher #${w}`);

export function WatchPage() {
  const [st, setSt] = useState<Status | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => rememberRoom("command"), []);
  useEffect(() => {
    const load = () => void fetch("/api/watch").then((r) => r.json()).then(setSt).catch(() => {});
    load();
    const t = setInterval(load, 60_000), c = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => { clearInterval(t); clearInterval(c); };
  }, []);
  const b = st?.book;
  const online = st?.seats.filter((x) => x.online).length ?? 0;
  const t = st?.terms;
  return (
    <div className="st-room fg nw">
      <header className="fg-hero nw-hero" style={{ "--tc": "#3fe6ff" } as React.CSSProperties}>
        <div className="fg-hero-in">
          <span className="fg-eyebrow"><NxIcon name="security" size={16} /> DECK 05 · THE NIGHT WATCH · imdUSD KEEPERS</span>
          <h1>Hold the dollar. <em>Keep the bonus.</em></h1>
          <p className="fg-lead">imdUSD is IMD's dollar, borrowed against staked IMD. When IMD falls and a loan drops under {b?.mat ?? 170}%, someone has to mark it and, {b ? num(b.lullHours) : 6} hours later, repay it: whoever does takes staked IMD worth {b?.bonusPct ?? 20}% more than the debt they repay. The Night Watch is the crew that does it, one seat per Night Watcher and the Captain's seat for NIGHT FROG #1 (The Captain's, once #1 is forged), each running its own bot with its own wallet, working in turn instead of racing.</p>
          <div className="fg-cta">
            <a className="nx-btn nx-btn-acc" href="#run"><NxIcon name="security" size={18} /> Set up my seat</a>
            <Link className="nx-btn" to="/forge">Forge a Night Watcher</Link>
          </div>
          <div className="st-stats">
            <Stat label="imdUSD price" value={b?.peg ? `$${b.peg.toFixed(4)}` : "—"} note="in its USDC peg pool" />
            <Stat label="imdUSD out" value={b ? num(b.supply) : "—"} note={b ? `${b.loans} loans in the vault` : "reading the vault"} />
            <Stat label="Seats online" value={st ? `${online} / ${st.seats.length}` : "—"} note={st?.open ? `${st.watchers} Night Watchers forged` : "Night Watcher seats wait for IMD; the Captain's is open"} />
            <Stat label="Prices" value={b ? (b.stale.length ? "WAITING" : "LIVE") : "—"} note={b?.stale.length ? "liquidations wait for a fresh price" : "marks and liquidations can run"} />
          </div>
        </div>
      </header>

      <div className="st-body">
        <WatchGuide mat={b?.mat ?? 170} lullHours={b?.lullHours ?? 6} />

        <section id="pair" className="fg-sec">
          <div className="fg-head"><span className="fg-kicker">Your seat</span><h2>Pair your seat</h2></div>
          <SeatDesk />
        </section>

        <section className="fg-sec">
          <div className="fg-head"><span className="fg-kicker">The watchlist</span><h2>Loans close to the line</h2></div>
          {!b ? <p className="st-empty">Reading the vault…</p> : b.watchlist.length === 0 ? (
            <p className="st-empty">Every loan in the vault is well above {b.mat}%. The seats watch; nothing to do until IMD falls.</p>
          ) : (
            <div className="nw-table" role="table">
              <div className="nw-row nw-th" role="row"><span>Loan</span><span>Debt</span><span>Ratio</span><span>State</span><span>Next</span></div>
              {b.watchlist.map((l) => (
                <div key={l.owner} className={`nw-row nw-${l.state}`} role="row">
                  <span className="mono">{l.owner}</span><span>{num(l.debt)} imdUSD</span><span>{l.cr}%</span><span>{STATE[l.state] ?? l.state}</span>
                  <span className="mono">{l.state === "grace" && l.opensAt ? `opens in ${Math.max(0, Math.round((l.opensAt - now) / 60))} min` : l.state === "actionable" ? `${num(l.repay)} imdUSD to repay` : l.state === "safe" ? `${l.cr - b.mat} pts above` : "a seat marks it"}</span>
                </div>
              ))}
            </div>
          )}
          {b && <p className="st-note">The vault holds {num(b.totalDebt)} imdUSD of debt across {b.loans} loans; the line is {b.mat}%. A loan falls under it only if IMD drops: the closest one goes under after a fall of about {b.closestCr ? Math.max(0, Math.round((1 - b.mat / b.closestCr) * 100)) : "—"}%.</p>}
        </section>

        <section className="fg-sec">
          <div className="fg-head"><span className="fg-kicker">The crew</span><h2>The seats</h2></div>
          {!st || st.seats.length === 0 ? <p className="st-empty">No seat is paired yet. The Captain's seat is open now; Night Watcher seats open once IMD has deployed the Night Watchers and the first one is forged.</p> : (
            <div className="nw-table" role="table">
              <div className="nw-row nw-th nw-seats" role="row"><span>Seat</span><span>Share · cut</span><span>Bot</span><span>imdUSD</span><span>Marks · bites</span><span>Kept</span></div>
              {st.seats.map((x) => (
                <div key={x.watcher} className={`nw-row nw-seats${x.watcher === 0 ? " nw-captain" : ""}`} role="row">
                  <span><b>{seatLabel(x.watcher)}</b>{x.tier && x.watcher !== 0 ? ` · ${x.tier}` : ""}</span>
                  <span>{x.weight}× · {x.cutBps / 100}%</span>
                  <span className={x.online ? "good" : "fg-dim"}>{x.valid === false ? "holder changed" : x.arrears ? "cut overdue" : x.online ? "online" : "offline"} <i className="mono">{x.keeper}</i></span>
                  <span>{x.inventory === null ? "—" : num(x.inventory)}</span>
                  <span>{x.marks} · {x.bites}</span>
                  <span>${num(x.earnedUsd, 2)}</span>
                </div>
              ))}
            </div>
          )}
          {st && st.recent.length > 0 && <ul className="nw-recent">{st.recent.map((r) => <li key={r.tx}><b>{r.watcher === null ? "A seat" : seatLabel(r.watcher)}</b> repaid {num(r.debt)} imdUSD and kept ${num(r.usd, 2)} · <a href={`https://etherscan.io/tx/${r.tx}`} target="_blank" rel="noreferrer">tx ↗</a></li>)}</ul>}
        </section>

        <section className="fg-sec">
          <div className="fg-head"><span className="fg-kicker">Rarer seats, better terms</span><h2>What each seat gets</h2></div>
          <div className="nw-terms">
            <article className="nw-term nw-captain"><b>Captain</b><span>NIGHT FROG #1 or The Captain</span><strong>{t?.captain?.weight ?? 4}× share</strong><em>{(t?.captain?.cutBps ?? 500) / 100}% cut</em><small>50× as #1, 60× as The Captain · most turns to mark · open now</small></article>
            {TIER_NAMES.map((name, i) => (
              <article key={name} className="nw-term"><b>{name}</b><span>Tier {["I", "II", "III", "IV", "V"][i]}</span><strong>{t?.[String(i + 1)]?.weight ?? "—"}× share</strong><em>{(t?.[String(i + 1)]?.cutBps ?? 0) / 100}% cut</em><small>{[10, 15, 20, 30, 40][i]}× shift hours</small></article>
            ))}
          </div>
          <p className="st-note">Each liquidation the crew can cover is split by the imdUSD each seat brings times its share weight, and never more than a seat holds. Marks rotate the same way, so a heavier seat marks more often (the marker takes 2% of the debt when the loan is liquidated). A seat keeps 16% of the debt it repays as bonus, 18% if it marked the loan too. The cut, a share of that bonus, goes in IMD to the NIGHTSHIFT FeeSplitter, which splits it like every fee: 40% to $SHIFT stakers and NIGHT FROGS holders, 20% to the dev wallet, 20% to the treasury, 20% burned as IMD. On $100 repaid, a Shift Lead keeps $14.40, a Night Boss $15.04 and the Captain $15.20.</p>
        </section>

        <section className="fg-sec">
          <div className="nw-next">
            <span className="fg-kicker">What comes next · not built yet</span>
            <h2>A swarm with a bank account</h2>
            <p>Today every seat is a keeper bot that works with its owner's own wallet. Where this goes: every Night Watcher an AI agent with its own onchain wallet and its own money, and the whole Night Watch acting as one swarm, with a shared treasury it controls through a contract, shared profit-driven values and instructions written onchain that every agent follows, and what it makes shared out by seat. Keeping imdUSD solid is the first job; the same crew could run arbitrage, provide liquidity, hire the IMD swarm for work and vote on what it does next: a fully autonomous fund, run by its agents.</p>
            <p className="fg-dim">This is a plan, not a product: nothing of it is live and nothing here promises returns. Pooled money and shared profits need their own contracts, audits and a legal review before any of it opens. Night Watcher holders hear about it first, in the Watch Room.</p>
          </div>
        </section>

        <section className="fg-sec">
          <div className="fg-head"><span className="fg-kicker">Questions</span><h2>The fine print</h2></div>
          <div className="fg-faq">
            <details open><summary>How much can a seat earn?</summary><p>It depends on IMD's price and the imdUSD the seat brings. In a calm market no loan goes under and there is nothing to do. When IMD falls hard, loans go under at once: the largest loan in the vault today owes over 80,000 imdUSD, and liquidating all of it would pay the seats about $13,000 in bonus. Nothing here is a promise of income.</p></details>
            <details><summary>Does NIGHTSHIFT hold my money?</summary><p>No. The bot runs on your machine with your keeper wallet; every liquidation pays that wallet. The coordinator only reads the chain and tells each seat which loan to mark and how much of each liquidation is its share.</p></details>
            <details><summary>What do I risk?</summary><p>Gas, and the price of what you are paid: the bonus comes as staked IMD, which moves with IMD until you sell it. Every transaction is simulated first, so a liquidation someone else took costs nothing.</p></details>
            <details><summary>What if I sell my Night Watcher?</summary><p>The seat goes with it: the pairing ends, and the new holder pairs their own bot. The same holds for the Captain's seat and NIGHT FROG #1.</p></details>
            <details><summary>Who else keeps imdUSD?</summary><p>Anyone may: liquidations are open to all. The Night Watch is the crew that splits the work instead of racing for it. Its bot follows fa11up's open-source imdusd-keeper, the reference keeper for imdUSD.</p></details>
          </div>
        </section>
      </div>
    </div>
  );
}

type Held = { watcher: number; name: string; tier: string | null; weight: number; cutBps: number; paired: boolean; keeper: string | null; online: boolean; arrears: boolean };

/**
 * The holder's desk: check the wallet (which seats it holds, read onchain), copy one command onto the machine
 * that will run the bot, sign the link it prints. Each seat shows where it stands.
 */
function SeatDesk() {
  const [me, setMe] = useState<string | null>(null);
  const [held, setHeld] = useState<Held[] | null>(null);
  const [keeper, setKeeper] = useState(() => new URLSearchParams(location.search).get("pair") ?? "");
  const [seat, setSeat] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const wallet = async () => createWalletClient({ chain: mainnet, transport: custom((await chooseWallet()) as never) });
  const check = async (addr?: string) => {
    setMsg(null); setBusy(true);
    try {
      const a = addr ?? (await (await wallet()).requestAddresses())[0];
      if (!a) throw new Error("No account.");
      setMe(a);
      const d = await (await fetch(`/api/watch/holder?address=${a}`)).json() as { seats?: Held[]; error?: string };
      if (d.error) throw new Error(d.error);
      setHeld(d.seats ?? []);
      const first = (d.seats ?? []).find((x) => !x.paired) ?? d.seats?.[0];
      if (first) setSeat(first.watcher);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message.split("\n")[0] ?? "failed" }); }
    setBusy(false);
  };
  const sign = async () => {
    setMsg(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(keeper)) { setMsg({ ok: false, text: "Paste the keeper address the bot printed, or open the link it printed." }); return; }
    if (seat === null) { setMsg({ ok: false, text: "Check your wallet first, so the page knows which seat to pair." }); return; }
    setBusy(true);
    try {
      const w = await wallet();
      const [a] = await w.requestAddresses();
      if (!a) throw new Error("No account.");
      const issuedAt = Math.floor(Date.now() / 1000);
      const signature = await w.signTypedData({ account: a, domain: PAIR_DOMAIN, types: PAIR_TYPES, primaryType: "Seat", message: { watcher: BigInt(seat), keeper: keeper as `0x${string}`, issuedAt: BigInt(issuedAt) } });
      const r = await fetch("/api/watch/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ watcher: seat, keeper, issuedAt, signature }) });
      const d = await r.json() as { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Try again in a minute.");
      setMsg({ ok: true, text: `Paired: the bot now serves ${seatLabel(seat)}. It notices within a few seconds and starts watching.` });
      void check(a);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message.split("\n")[0] ?? "failed" }); }
    setBusy(false);
  };
  const state = (x: Held) => (!x.paired ? "not set up yet" : x.arrears ? "cut overdue: the bot pays it on its next pass" : x.online ? "bot online, on watch" : "paired, bot offline: start it");
  return (
    <div className="nw-desk">
      <ol className="nw-steps">
        <li>
          <b>1 · Check your wallet</b>
          <span>Connect the wallet that holds your Night Watcher, NIGHT FROG #1 or The Captain. The page reads the chain and shows every seat it holds.</span>
          {!held ? <button className="nx-btn nx-btn-acc" onClick={() => void check()} disabled={busy}>{busy ? "Checking…" : "Check my seats"}</button> : (
            held.length === 0 ? <p className="fg-dim">{me?.slice(0, 6)}…{me?.slice(-4)} holds no seat. <Link to="/forge">Forge a Night Watcher</Link>, or hold NIGHT FROG #1 for the Captain's seat.</p> : (
              <ul className="nw-held">{held.map((x) => (
                <li key={x.watcher} className={x.online ? "on" : x.paired ? "half" : ""}>
                  <label><input type="radio" name="seat" checked={seat === x.watcher} onChange={() => setSeat(x.watcher)} /> <b>{seatLabel(x.watcher)}</b>{x.tier && x.watcher !== 0 ? ` · ${x.tier}` : ""} · {x.weight}× share, {x.cutBps / 100}% cut</label>
                  <span>{state(x)}{x.keeper ? <i className="mono"> {x.keeper.slice(0, 6)}…{x.keeper.slice(-4)}</i> : null}</span>
                </li>
              ))}</ul>
            )
          )}
        </li>
        <li>
          <b>2 · Sign the link</b>
          <span>Open the link the bot printed (it fills in the keeper below), pick the seat and sign with the wallet that holds it. Signing sends nothing and costs nothing. The bot sees it within seconds; <code>node bot.mjs doctor</code> checks everything, and it acts once you start it with <code>--execute</code>.</span>
          <label className="nw-field">Keeper wallet from the bot<input className="field mono" placeholder="0x…" value={keeper} onChange={(e) => setKeeper(e.target.value.trim())} /></label>
          <button className="nx-btn nx-btn-acc" onClick={() => void sign()} disabled={busy || !held?.length}>{busy ? "Check your wallet…" : seat === null ? "Check your wallet first" : `Sign and pair ${seatLabel(seat)}`}</button>
        </li>
      </ol>
      {msg && <div className={msg.ok ? "good" : "bad"}>{msg.text}</div>}
    </div>
  );
}
