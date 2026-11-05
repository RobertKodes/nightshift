import { useEffect, useState } from "react";
import { go } from "./router";
import { solApi } from "./launchpad/sol/net";
import { chooseSolana } from "./wallet";

type AdminState = Awaited<ReturnType<typeof solApi.adminState>>;
type Order = { key: string; placed: { tx: string; at: number } | null; state: { status?: string; stage?: string; jobId?: string } | null };
type Step = { id: string; state: "ok" | "warn" | "block"; title: string; body: React.ReactNode; act?: React.ReactNode };

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const link = (to: string, label: string, primary = false) => <button className={`btn${primary ? " primary" : ""}`} onClick={() => go(to)}>{label}</button>;

/**
 * The owner's setup for IMD Launch on Solana, on /setup: every step in order, its live state, and
 * exactly what to do. The launchpad's own admin page (/launchpad/sol/admin) does the rest.
 */
export function SolSetup({ call, token }: { call: (token: string, path: string, body?: unknown) => Promise<any>; token: string }) {
  const [s, setS] = useState<AdminState | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [partner, setPartner] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => {
    solApi.adminState(token).then((x) => { setS(x); setPartner(x.partner ?? ""); }).catch((e) => setMsg((e as Error).message));
    call(token, "swarm").then((d) => setOrders(d.orders ?? [])).catch(() => {});
  };
  useEffect(load, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePartner = async (address: string) => {
    setBusy(true); setMsg("");
    try {
      if (!BASE58.test(address)) throw new Error("That is not a Solana address.");
      await solApi.adminPartner(token, address);
      setMsg("Saved: launches are open, and NIGHTSHIFT's share goes to that wallet.");
      load();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const useWallet = async () => {
    try { const w = await chooseSolana(); if (w) setPartner(w.address); } catch (e) { setMsg((e as Error).message); }
  };

  if (!s) return <div className="card-b"><p className="faint">{msg || "Reading the Solana launchpad…"}</p></div>;
  const placed = (key: string) => orders.find((o) => o.key === key)?.placed ?? null;
  const audit = placed("sol-launchpad-audit"), research = placed("sol-launchpad-research");
  const waiting = s.pending.filter((l) => l.status === "waiting" || l.status === "refused").length;
  const live = s.info.counts.live + s.info.counts.graduated;

  const steps: Step[] = [
    {
      id: "partner", state: s.partner ? "ok" : "block", title: "1 · NIGHTSHIFT's Solana wallet (required: launches are closed without it)",
      body: <>Make a Solana wallet used only for NIGHTSHIFT: in Phantom, Solflare or Backpack, add a new account and name it <b>NIGHTSHIFT partner</b>. Write its recovery phrase on paper and never paste it anywhere, here included. Put about <b>0.05 SOL</b> in it for the fees of signing claims. It receives NIGHTSHIFT's share of every launch: <b>40% of each trade's fee</b> on the curve at a 1% fee (Meteora keeps 20%, the creator gets 40%), most of each <b>0.04 SOL launch fee</b>, the curve's leftover, and after graduation half of the locked liquidity's fees. {s.partner ? <>Set to <code>{s.partner}</code>.</> : "Paste its address below, or connect it and press USE MY SOLANA WALLET, then SAVE."}</>,
      act: <div className="setup-row"><input className="field" value={partner} onChange={(e) => setPartner(e.target.value.trim())} placeholder="NIGHTSHIFT partner wallet (Solana address)" /><button className="btn" disabled={busy} onClick={() => void useWallet()}>USE MY SOLANA WALLET</button><button className="btn primary" disabled={busy || !partner || partner === s.partner} onClick={() => void savePartner(partner)}>SAVE</button></div>,
    },
    {
      id: "network", state: s.network === "mainnet" ? "ok" : "warn", title: `2 · Network: ${s.network === "mainnet" ? "Solana mainnet" : "devnet (a rehearsal)"}`,
      body: s.network === "mainnet" ? "Real launches. Nothing to do." : "Launches go to devnet, with test SOL only. Switch to MAINNET on the launchpad admin page when you are ready.",
      act: s.network === "mainnet" ? undefined : link("/launchpad/sol/admin", "OPEN THE LAUNCHPAD ADMIN"),
    },
    {
      id: "imd", state: s.info.imd.on ? "ok" : "block", title: "3 · The IMD swarm",
      body: s.info.imd.on ? <>NIGHTSHIFT reaches IMD for the free check of each launch's job and follows the work. Creators pay their own job (<b>{s.info.imd.price} IMD</b>, about ${(s.info.imd.price * s.info.imd.imdUsd).toFixed(2)} now) straight to IMD from their EVM wallet: nothing comes out of yours. Nothing to do.</> : "IMD is not reachable from the server right now: launches that use the swarm wait until it is. Launches without the swarm still work.",
    },
    {
      id: "mints", state: s.mintsReady > 0 ? "ok" : "warn", title: `4 · Token addresses ending in "imd": ${s.mintsReady} ready`,
      body: s.mintsReady > 0 ? "The server finds them ahead of time and keeps 4 ready. Nothing to do." : "The server is finding the first ones (about 10 seconds each). Until one is ready, a launch gets a plain address. Nothing to do.",
    },
    {
      id: "config", state: s.config ? "ok" : "warn", title: "5 · The shared standard config (optional)",
      body: s.config ? <>Standard launches use <code>{s.config}</code>: one signature less for creators.</> : <>Optional: it lets standard launches ($5K → $75K, 1% fee) skip creating their own Meteora config, saving creators about 0.009 SOL and one signature. To make it: open the launchpad admin, connect the <b>partner wallet</b>, press <b>CREATE THE SHARED CONFIG</b> (about 0.01 SOL).</>,
      act: s.config ? undefined : link("/launchpad/sol/admin", "OPEN THE LAUNCHPAD ADMIN"),
    },
    {
      id: "orders", state: audit && research ? "ok" : "warn", title: "6 · The swarm's own work on the launchpad",
      body: <>Two orders in <b>Orders for the IMD swarm</b> below, 0.5 IMD each from your dev wallet: <b>Solana launchpad security audit</b> (4 specialist agents and a judge review the launchpad's code on GitHub: {audit ? "paid" : "not paid yet"}) and <b>Solana launchpad: the open questions</b> (a sourced research report: {research ? "paid" : "not paid yet"}). Press <b>Check with IMD</b> first (free), then <b>Pay 0.5 IMD</b>.</>,
    },
    {
      id: "first", state: live ? "ok" : s.partner ? "warn" : "block", title: "7 · Your first launch, with 70% of the supply locked",
      body: <>
        You need: a Solana wallet with about <b>0.1 SOL</b> plus whatever you want to buy at launch, and, for the swarm, an EVM wallet with <b>0.5 IMD</b> and a little ETH on Ethereum (or cents of ETH on Robinhood Chain).
        <ol className="setup-ol">
          <li>Open the launch form. Fill <b>1 · THE TOKEN</b>: name, ticker, what it is, links. Upload a logo, or tick LOGO in step 4.</li>
          <li><b>2 · THE BONDING CURVE</b>: pick CUSTOM to set where it starts and graduates in dollars, the fee and the anti-sniper fee (or keep STANDARD).</li>
          <li><b>3 · YOUR ALLOCATION</b>: press <b>70%</b>, then how long it stays locked after graduation (for example 180 days) and how long it is released over (for example 365 days). Two years at most in all.</li>
          <li><b>4 · THE IMD SWARM</b>: tick REVIEW and WEBSITE (and LOGO, X BANNER if you want them), and where you pay IMD.</li>
          <li><b>5 · YOUR FIRST BUY</b> (optional, up to 5 SOL), tick the box, press <b>SIGN, AND SEND IT TO THE SWARM</b>.</li>
          <li>Your Solana wallet asks twice: the settings, then the launch itself (it is held, not sent). Then your EVM wallet: allow 0.5 IMD, then pay it.</li>
          <li>The token's page shows the swarm working. It goes live on Solana the moment the swarm finishes. Keep the SOL for your first buy in the wallet until then.</li>
        </ol>
      </>,
      act: s.partner ? link("/launchpad/sol/new", "OPEN THE LAUNCH FORM", true) : undefined,
    },
    {
      id: "run", state: waiting ? "warn" : "ok", title: `8 · Running it: ${live} live · ${s.info.counts.waiting} with the swarm${waiting ? ` · ${waiting} for you to look at` : ""}`,
      body: <>On the launchpad admin page: <b>NIGHTSHIFT'S FEES</b> shows what each pool holds for you; connect the partner wallet and press <b>CLAIM INTO THE PARTNER WALLET</b> now and then. <b>LAUNCHES NOT ON THE BOARD</b> lists the ones waiting or refused: you can overrule a refusal (LAUNCH NOW) or cancel a launch. Everything else runs by itself.</>,
      act: link("/launchpad/sol/admin", "OPEN THE LAUNCHPAD ADMIN"),
    },
  ];

  const todo = steps.filter((x) => x.state === "block").length;
  return (
    <>
      <ul className="checks">
        {steps.map((x) => (
          <li key={x.id}><i className={`dot ${x.state}`} /><div><b>{x.title}</b><span>{x.body}</span>{x.act && <div className="setup-act">{x.act}</div>}</div></li>
        ))}
      </ul>
      <div className="card-b setup-live">
        <span>{todo ? `${todo} step${todo > 1 ? "s" : ""} to do before launches open.` : s.partner ? "Open: anyone can launch on Solana through NIGHTSHIFT." : ""}</span>
        <button className="btn" onClick={() => go("/launchpad/sol")}>OPEN THE SOLANA LAUNCHPAD</button>
      </div>
      {msg && <p className="faint" role="status">{msg}</p>}
    </>
  );
}
