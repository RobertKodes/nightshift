import {
  EMPTY_FORM, INTAKE, LAUNCH_ACTION_ID, LAUNCH_CHAINS, LAUNCH_KINDS, LAUNCH_PRICE, type LaunchBody, type LaunchForm, type Problem,
  formProblems, launchBody, refuseBody, split,
} from "@nightshift/launch";
import { useEffect, useMemo, useState } from "react";
import { type Address, createPublicClient, createWalletClient, custom, erc20Abi, http, parseAbi, stringToHex } from "viem";
import { mainnet, robinhood } from "viem/chains";
import { type Step, canBatch, rejected, sendSteps } from "../batch";
import { Link, go } from "../router";
import { chooseWallet } from "../wallet";
import { type Check, lpApi, rememberLaunch, short, usd } from "./api";

const intakeAbi = parseAbi(["function request(bytes32 action, bytes body, (address target, bytes4 selector) callback, address asset, uint256 amount) returns (bytes32)"]);
const VIEM = { 1: mainnet, 4663: robinhood } as const;
const RPC = { 1: "https://ethereum-rpc.publicnode.com", 4663: "https://rpc.mainnet.chain.robinhood.com" } as const;
const readers = { 1: createPublicClient({ chain: mainnet, transport: http(RPC[1]) }), 4663: createPublicClient({ chain: robinhood, transport: http(RPC[4663]) }) };
const errText = (e: unknown) => String((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? e).split("\n")[0]!.slice(0, 220);

/**
 * Launch a coin on IMD from the creator's own wallet. The page builds IMD's coin request from the form
 * (@nightshift/launch, the same code the engine checks with), IMD's free check reads it, and the
 * creator approves 0.5 IMD and sends one Intake request: the creator is the launch's requester, and
 * nothing passes through NIGHTSHIFT.
 */
export function NewLaunch() {
  const [f, setF] = useState<LaunchForm>(EMPTY_FORM);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [res, setRes] = useState<{ key: string; body: LaunchBody; check: Check } | null>(null);
  const [checking, setChecking] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [usdPrice, setUsdPrice] = useState<{ eth: number | null; imd: number | null }>({ eth: null, imd: null });
  const [showBody, setShowBody] = useState(false);
  useEffect(() => { document.title = "Launch a coin · Launchpad · NIGHTSHIFT"; lpApi.board().then((b) => setUsdPrice(b.usd)).catch(() => {}); }, []);

  const chain = LAUNCH_CHAINS[f.chainId], pair = chain.pairings[f.pairWith];
  const problems = formProblems(f);
  const show = (k: keyof LaunchForm) => (touched.has(k) || touched.has("*") ? problems.find((p) => p.field === k)?.text : undefined);
  const set = <K extends keyof LaunchForm>(k: K, v: LaunchForm[K]) => { setF((x) => ({ ...x, [k]: v })); setTouched((t) => new Set(t).add(k)); };
  const key = JSON.stringify(f);
  const fresh = res && res.key === key ? res : null;
  const blockers = fresh?.check.blockers ?? null;
  const accepted = Boolean(fresh && Array.isArray(blockers) && blockers.length === 0 && !fresh.check.error);
  const s = split(f);
  const capUsd = (() => { const p = f.pairWith === "eth" ? usdPrice.eth : usdPrice.imd, n = Number(f.cap); return p && n > 0 ? n * p : null; })();
  const preview = useMemo(() => { try { return problems.length ? null : launchBody(f); } catch { return null; } }, [key]);

  const connect = async () => {
    setErr(null);
    try {
      const w = createWalletClient({ chain: VIEM[f.chainId], transport: custom((await chooseWallet({ chain: f.chainId })) as never) });
      const [a] = await w.requestAddresses();
      if (a) set("creator", a.toLowerCase());
    } catch (e) { if (!rejected(e)) setErr(errText(e)); }
  };

  const check = async () => {
    setTouched(new Set(["*"]));
    setErr(null);
    if (problems.length) return;
    setChecking(true);
    try { const r = await lpApi.check(f); setRes({ key, ...r }); }
    catch (e) { setErr(errText(e)); }
    finally { setChecking(false); }
  };

  const pay = async () => {
    if (!fresh || !accepted) return;
    setErr(null);
    const id = f.chainId, rpc = readers[id];
    try {
      const w = createWalletClient({ chain: VIEM[id], transport: custom((await chooseWallet({ chain: id })) as never) });
      setStep("Connect the creator's wallet…");
      const [me] = await w.requestAddresses();
      if (!me) throw new Error("No account in the wallet.");
      // signed only if it is exactly the body this page builds from the form, paid by the creator it names (or, on a fair launch, by whoever connects)
      const refused = refuseBody(fresh.body, f.creator ? f : { ...f, creator: me.toLowerCase() }, me);
      if (refused) throw new Error(refused);
      await w.switchChain({ id }).catch(() => { throw new Error(`Switch your wallet to ${chain.name}.`); });
      const imd = chain.imd as Address;
      const bal = await rpc.readContract({ address: imd, abi: erc20Abi, functionName: "balanceOf", args: [me] });
      if (bal < LAUNCH_PRICE) throw new Error(`This wallet has ${(Number(bal) / 1e18).toFixed(3)} IMD on ${chain.name}. A launch costs 0.5 IMD there, plus a little ETH for gas. Buy IMD on ${chain.name} in the swap first.`);
      const allowance = await rpc.readContract({ address: imd, abi: erc20Abi, functionName: "allowance", args: [me, INTAKE] });
      const steps: Step[] = [];
      if (allowance < LAUNCH_PRICE) steps.push({ call: { address: imd, abi: erc20Abi, functionName: "approve", args: [INTAKE, LAUNCH_PRICE] }, sign: "1 of 2: allow IMD's Intake to take exactly 0.5 IMD…", wait: "Waiting for the approval…", fail: "The approval failed. Nothing was paid." });
      const two = steps.length > 0;
      steps.push({
        call: { address: INTAKE, abi: intakeAbi, functionName: "request", args: [stringToHex(LAUNCH_ACTION_ID, { size: 32 }), stringToHex(JSON.stringify(fresh.body)), { target: "0x0000000000000000000000000000000000000000", selector: "0x00000000" }, imd, LAUNCH_PRICE] },
        sign: two ? "2 of 2: pay 0.5 IMD and send the launch…" : "Pay 0.5 IMD and send the launch (confirm in your wallet)…",
        wait: "Waiting for the payment to confirm…",
      });
      const batched = two && (await canBatch(w, me, id));
      const sent = await sendSteps(w, me, steps, { batched, once: "Confirm once: allow exactly 0.5 IMD, pay and send the launch…", wait: "Waiting for the payment to confirm…", say: setStep, on: { chain: VIEM[id], rpc: rpc as never } });
      if (!sent.ok) throw new Error(`The transaction reverted: ${sent.hash}. If IMD did not take the payment, nothing was spent but gas.`);
      const ref = `tx-${id}-${sent.hash}`;
      rememberLaunch({ ref, symbol: f.symbol.trim(), name: f.name.trim(), at: Date.now() });
      go(`/launchpad/t/${ref}`);
    } catch (e) { setStep(null); setErr(rejected(e) ? "You declined in the wallet. Nothing was paid." : errText(e)); }
  };

  return (
    <div className="st-room lp">
      <div className="st-body lp-new">
        <span className="st-deck lp-deck"><Link to="/launchpad">LAUNCHPAD</Link> · LAUNCH A COIN ON IMD</span>
        <h1 className="lp-h1">Launch a coin</h1>
        <p className="st-note">IMD's swarm builds, tests, audits and deploys it with its Uniswap v4 pool. You pay 0.5 IMD from your own wallet; IMD checks the request for free first. Once it is live, anyone can buy it from Ethereum, Base, Robinhood Chain or Solana through NIGHTSHIFT's swap.</p>

        <div className="lp-form">
          <section className="st-panel">
            <h3>1 · Where it lives</h3>
            <div className="lp-seg" role="radiogroup" aria-label="Chain">
              {([1, 4663] as const).map((c) => <button key={c} type="button" role="radio" aria-checked={f.chainId === c} className={f.chainId === c ? "on" : ""} onClick={() => setF((x) => ({ ...x, chainId: c, cap: x.pairWith === "eth" ? x.cap : LAUNCH_CHAINS[c].pairings.imd.suggested }))}>{LAUNCH_CHAINS[c].name}<small>{c === 1 ? "the deepest liquidity, higher gas" : "cents of gas, an Arbitrum chain"}</small></button>)}
              <button type="button" disabled title="IMD's launch check refuses Base (8453) today">Base<small>not open at IMD yet</small></button>
              <button type="button" disabled title="IMD deploys EVM contracts only">Solana<small>IMD builds EVM only</small></button>
            </div>
            <div className="lp-seg two" role="radiogroup" aria-label="Paired with">
              {(["eth", "imd"] as const).map((p) => <button key={p} type="button" role="radio" aria-checked={f.pairWith === p} className={f.pairWith === p ? "on" : ""} onClick={() => setF((x) => ({ ...x, pairWith: p, cap: chain.pairings[p].suggested }))}>Paired with {chain.pairings[p].symbol}<small>{p === "eth" ? "buyers pay in ETH" : "every buy goes through IMD"}</small></button>)}
            </div>
          </section>

          <section className="st-panel">
            <h3>2 · The coin</h3>
            <Field label="Name" hint="Up to 40 characters." err={show("name")}><input value={f.name} maxLength={40} onChange={(e) => set("name", e.target.value)} placeholder="Night Owl" /></Field>
            <Field label="Symbol" hint="2 to 11 capital letters or digits." err={show("symbol")}><input value={f.symbol} maxLength={11} onChange={(e) => set("symbol", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="OWL" /></Field>
            <Field label="Supply" hint="Whole tokens, 18 decimals, all minted once. Nobody can mint more." err={show("supply")}><input inputMode="numeric" value={f.supply} onChange={(e) => set("supply", e.target.value.replace(/[^\d,]/g, ""))} /></Field>
            <Field label="What it is" hint="One line, up to 280 characters. It goes into the request IMD's swarm reads." err={show("about")}><textarea rows={2} maxLength={280} value={f.about} onChange={(e) => set("about", e.target.value.replace(/\s*\n\s*/g, " "))} placeholder="A community coin for people who work at night." /></Field>
            <Field label="Logo" hint="IMD's swarm draws the logo; the request has no image upload. Say what it should show." err={show("logo")}><input maxLength={160} value={f.logo} onChange={(e) => set("logo", e.target.value)} placeholder="a white owl on a dark navy circle, cyan eyes" /></Field>
          </section>

          <section className="st-panel">
            <h3>3 · Links <small>optional</small></h3>
            <Field label="Website" err={show("website")}><input value={f.website} onChange={(e) => set("website", e.target.value.trim())} placeholder="https://…" /></Field>
            <Field label="X" err={show("x")}><input value={f.x} onChange={(e) => set("x", e.target.value.trim())} placeholder="https://x.com/…" /></Field>
            <Field label="Telegram" err={show("telegram")}><input value={f.telegram} onChange={(e) => set("telegram", e.target.value.trim())} placeholder="https://t.me/…" /></Field>
          </section>

          <section className="st-panel">
            <h3>4 · The pool</h3>
            <Field label={`In the pool: ${f.poolPercent}% of the supply`} hint={f.poolPercent === 90 ? "A fair launch: everything that is yours goes in the pool; you hold nothing at the start." : `You keep ${s.creator}% in your wallet. Buyers see that on the coin's page.`} err={show("poolPercent")}>
              <input type="range" min={10} max={90} step={1} value={f.poolPercent} onChange={(e) => set("poolPercent", Number(e.target.value))} />
            </Field>
            <div className="lp-split" aria-label="How the supply is split">
              <span className="pool" style={{ width: `${s.pool}%` }}>{s.pool}% pool</span>
              {s.creator > 0 && <span className="you" style={{ width: `${s.creator}%` }}>{s.creator >= 6 ? `${s.creator}%` : ""}</span>}
              <span className="swarm" style={{ width: `${s.swarm}%` }}>10%</span>
            </div>
            <p className="lp-small">Pool {s.pool}% · you {s.creator}% · IMD's swarm 10% (2% to the agents who did the work, 8% to every connected seat, claimed from the launch's distributor).</p>
            <Field label={`Opening market cap, in ${pair.symbol}`} hint={`From ${Number(pair.min).toLocaleString("en-US")} to ${Number(pair.max).toLocaleString("en-US")} ${pair.symbol}${capUsd ? `, about ${usd(capUsd)} now` : ""}. The pool opens at this price and rises as people buy.`} err={show("cap")}>
              <input inputMode="decimal" value={f.cap} onChange={(e) => set("cap", e.target.value.replace(",", "."))} />
            </Field>
          </section>

          <section className="st-panel">
            <h3>5 · Your wallet</h3>
            {f.creator
              ? <p className="lp-small">Creator <code>{short(f.creator)}</code> · <button type="button" className="lp-link" onClick={() => void connect()}>change</button></p>
              : <><p className="lp-small">{f.poolPercent < 90 ? "Connect it now: the share you keep goes to it." : "The wallet that pays is the creator. It connects when you pay; you can check with IMD first."}</p><button type="button" className="st-cta ghost" onClick={() => void connect()}>Connect the creator's wallet</button></>}
            {show("creator") && <p className="bad lp-small">{show("creator")}</p>}
            <ul className="lp-terms">
              <li>It pays <b>0.5 IMD on {chain.name}</b> plus gas. IMD gives no refunds, so the request is checked first.</li>
              <li>It becomes the launch's requester: <b>1% of every trade</b> on the pool goes to it, 0.25% to IMD's network (the pool fee is 1.25%).</li>
              {s.creator > 0 && <li>The {s.creator}% you keep goes to it.</li>}
              <li>The coin has no owner. Nobody, you or NIGHTSHIFT included, can mint, freeze or tax it.</li>
            </ul>
          </section>

          <section className="st-panel lp-go">
            <h3>6 · Check and launch</h3>
            <div className="st-row">
              <button type="button" className="st-cta ghost" disabled={checking || Boolean(step)} onClick={() => void check()}>{checking ? "IMD is checking…" : fresh ? "Check again" : "Check with IMD, free"}</button>
              <button type="button" className="st-cta" disabled={!accepted || Boolean(step)} onClick={() => void pay()}>{step ?? `Pay 0.5 IMD and launch on ${chain.name}`}</button>
            </div>
            {touched.has("*") && problems.length > 0 && <Problems list={problems} />}
            {res && !fresh && <p className="lp-small dim">The form changed since IMD's check. Check again before paying.</p>}
            {fresh && (fresh.check.error ? <p className="bad">IMD's check failed: {String(fresh.check.error)}</p>
              : blockers && blockers.length ? <div className="lp-refused"><b>IMD would refuse it:</b><ul>{blockers.map((b, i) => <li key={i}>{b.detail ?? b.message ?? b.code}</li>)}</ul></div>
              : <div className="lp-ok"><b>IMD accepts it.</b> What happens after you pay:<ol>{fresh.check.plan.map((p, i) => <li key={i}>{p.title}</li>)}</ol></div>)}
            {err && <p className="bad">{err}</p>}
            {preview && <button type="button" className="lp-link" onClick={() => setShowBody(!showBody)}>{showBody ? "Hide" : "Read"} the exact request your wallet will send</button>}
            {showBody && preview && <pre className="st-pre lp-pre">{JSON.stringify(preview, null, 2)}</pre>}
          </section>
        </div>

        <h2>IMD's launch kinds</h2>
        <div className="lp-kinds">
          {LAUNCH_KINDS.map((k) => <div key={k.kind} className={`st-panel ${k.here ? "on" : ""}`}><b>{k.name}</b><code>{k.kind}</code><p>{k.rules}</p>{k.here ? <span className="lp-here">THIS FORM</span> : <a href="https://explorer.imd.fun/launch" target="_blank" rel="noreferrer">On IMD's explorer</a>}</div>)}
        </div>
        <p className="st-note">The request is the one IMD's own explorer sends for a coin, plus your words, the rules said outright and one line saying it was launched here. Everything about it is public at IMD: the job, every agent's work, the audit and the deployed contracts.</p>
      </div>
    </div>
  );
}

function Field({ label, hint, err, children }: { label: string; hint?: string; err?: string; children: React.ReactNode }) {
  return <label className={`lp-field ${err ? "bad" : ""}`}><span>{label}</span>{children}{err ? <small className="bad">{err}</small> : hint ? <small>{hint}</small> : null}</label>;
}
function Problems({ list }: { list: Problem[] }) {
  return <ul className="bad lp-small">{list.map((p) => <li key={p.field}>{p.text}</li>)}</ul>;
}
