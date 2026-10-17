import { useEffect, useState } from "react";
import { inUsd, useImdUsd } from "./price";
import { chooseWallet } from "./wallet";
import { type Hex, createPublicClient, createWalletClient, custom, erc20Abi, http, parseAbi, stringToHex } from "viem";
import { mainnet } from "viem/chains";

const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const INTAKE = "0xa43e6f75ee006411f79ac1c84120606c2330de82";
const PRICE = 500000000000000000n; // 0.5 IMD
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const FIRST = "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69";
const intakeAbi = parseAbi(["function request(bytes32 action, bytes body, (address target, bytes4 selector) callback, address asset, uint256 amount) returns (bytes32)"]);
const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Check = { blockers?: { code?: string; detail?: string; message?: string }[]; plan?: { title: string }[]; error?: string };
type Launch = { tx: string; stage: string; token?: string; done?: boolean; open?: boolean; error?: string; symbol: string; contracts?: Record<string, string> } | null;
type Verify = { label: string; ok: boolean; detail: string }[];

/** One step of the launch: done, current or still to come. */
function Step({ n, state, title, children }: { n: number; state: "done" | "now" | "next"; title: string; children?: React.ReactNode }) {
  return (
    <li className={`ls-step ${state}`}>
      <span className="ls-n">{state === "done" ? "✓" : n}</span>
      <div><b>{title}</b>{state !== "next" && children}</div>
    </li>
  );
}

/**
 * Launches $SHIFT exactly as agreed (the body is fixed on the server): IMD's free check runs by
 * itself, the dev wallet pays 0.5 IMD, then the page follows the swarm, checks the deployed
 * contracts against the spec, and waits for the first buyer. Nothing to type.
 */
export function TokenLaunch({ call, token }: { call: (token: string, path: string, body?: unknown) => Promise<any>; token: string }) {
  const [res, setRes] = useState<{ body: unknown; check: Check } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [launch, setLaunch] = useState<Launch>(null);
  const [checks, setChecks] = useState<Verify | null>(null);
  const usd = useImdUsd();

  const refresh = () => fetch("/api/token").then((r) => r.json()).then((d) => { setLaunch(d.launch); setChecks(d.verification?.checks ?? null); }).catch(() => {});
  useEffect(() => { void refresh(); const t = setInterval(refresh, 15_000); return () => clearInterval(t); }, []);
  useEffect(() => { call(token, "token/check", {}).then(setRes).catch((e) => setErr((e as Error).message)); }, [token]);

  const blockers = res?.check?.blockers ?? [];
  const accepted = Boolean(res && !res.check.error && blockers.length === 0);

  const pay = async () => {
    if (!res) return;
    setErr(null);
    try {
      const eth = await chooseWallet({ ask: true });
      const wallet = createWalletClient({ chain: mainnet, transport: custom(eth as never) });
      setBusy("Connect your dev wallet…");
      const [me] = await wallet.requestAddresses();
      if (!me) throw new Error("No account.");
      if (me.toLowerCase() !== DEV) throw new Error(`This is ${short(me)}. Switch to your dev wallet ${short(DEV)}: it pays, so it gets the 1% trading fee.`);
      await wallet.switchChain({ id: 1 }).catch(() => { throw new Error("Switch your wallet to Ethereum."); });
      const bal = await rpc.readContract({ address: IMD, abi: erc20Abi, functionName: "balanceOf", args: [me] });
      if (bal < PRICE) throw new Error(`Your dev wallet has ${(Number(bal) / 1e18).toFixed(3)} IMD. It needs 0.5 IMD, plus a little ETH for gas.`);
      const allowance = await rpc.readContract({ address: IMD, abi: erc20Abi, functionName: "allowance", args: [me, INTAKE] });
      if (allowance < PRICE) {
        setBusy("Signature 1 of 2: allow IMD to take 0.5 IMD…");
        const a = await wallet.writeContract({ account: me, address: IMD, abi: erc20Abi, functionName: "approve", args: [INTAKE, PRICE] });
        setBusy("Waiting for signature 1 to confirm…");
        await rpc.waitForTransactionReceipt({ hash: a });
      }
      setBusy("Signature 2 of 2: pay 0.5 IMD and send the launch…");
      const tx = await wallet.writeContract({
        account: me, address: INTAKE, abi: intakeAbi, functionName: "request",
        args: [stringToHex("launch.open@launch-1", { size: 32 }), stringToHex(JSON.stringify(res.body)), { target: "0x0000000000000000000000000000000000000000", selector: "0x00000000" }, IMD, PRICE],
      });
      setBusy("Waiting for signature 2 to confirm…");
      const r = await rpc.waitForTransactionReceipt({ hash: tx as Hex });
      if (r.status !== "success") throw new Error(`The transaction reverted: ${tx}`);
      await call(token, "token/launched", { tx, symbol: "SHIFT" });
      setBusy(null);
      void refresh();
    } catch (e) { setBusy(null); setErr((e as Error).message.split("\n")[0] ?? "failed"); }
  };

  const recheck = async () => {
    setBusy("Checking the contracts on Ethereum…");
    try { setChecks((await call(token, "token/verify")).checks); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  const paid = Boolean(launch && !launch.error);
  const deployed = Boolean(paid && launch?.done);
  const allOk = Boolean(checks?.length && checks.every((c) => c.ok));
  const live = Boolean(launch?.open);
  const s = (done: boolean, now: boolean) => (done ? "done" : now ? "now" : "next") as "done" | "now" | "next";

  return (
    <div className="card-b token-launch">
      <div className="ls-what">
        <b>What launches</b>
        <ul>
          <li><b>1,000,000,000 $SHIFT</b> on Ethereum, paired with ETH: 80% in the pool, <b>10% to your dev wallet</b> {short(DEV)}, 10% to the IMD swarm.</li>
          <li><b>Only {short(FIRST)} can buy first.</b> Right after its buy, trading opens to everyone, for good.</li>
          <li><b>Every sell pays 5%</b>: 40% rewards (stakers and NIGHT FROGS), 20% you, 20% treasury {short(FIRST)}, 20% burned (SHIFT, and IMD at IMD's BurnExecutor).</li>
          <li>You own every contract. IMD only deploys it. Costs 0.5 IMD{usd ? ` (${inUsd(0.5, usd)})` : ""} plus gas.</li>
        </ul>
      </div>

      <ol className="ls-steps">
        <Step n={1} state={s(accepted, !res)} title="IMD accepts the launch (free check)">
          {!res ? <span className="dim">Asking IMD…</span> : res.check.error ? <span className="bad">{res.check.error}</span>
            : blockers.length ? <span className="bad">IMD would refuse it: {blockers.map((b) => b.detail ?? b.message ?? b.code).join("; ")}</span>
            : <span className="dim">Accepted. The swarm will: {(res.check.plan ?? []).map((p) => p.title.toLowerCase()).join(", ")}.</span>}
        </Step>
        <Step n={2} state={s(paid, accepted && !paid)} title="Pay from your dev wallet (2 signatures)">
          {!paid && (
            <div className="ls-act">
              <button className="btn primary" disabled={!accepted || Boolean(busy)} onClick={pay}>Launch $SHIFT · 0.5 IMD</button>
              {launch?.error && <span className="bad">The last launch did not go through: {launch.stage}</span>}
            </div>
          )}
          {paid && <a className="mono faint" href={`https://etherscan.io/tx/${launch!.tx}`} target="_blank" rel="noreferrer">paid · {short(launch!.tx)}</a>}
        </Step>
        <Step n={3} state={s(deployed, paid && !deployed)} title="The swarm builds, tests, audits and deploys">
          <span className="dim">{launch?.stage}</span>
        </Step>
        <Step n={4} state={s(deployed && allOk, deployed && !allOk)} title="We check the contracts against what we asked for">
          {checks && <ul className="ls-checks">{checks.map((c, i) => <li key={i} className={c.ok ? "good" : "bad"}>{c.ok ? "✓" : "✗"} {c.label}{!c.ok && c.detail ? ` (${c.detail})` : ""}</li>)}</ul>}
          {deployed && <button className="btn" disabled={Boolean(busy)} onClick={recheck}>Check again</button>}
          {deployed && checks && !allOk && <b className="bad">Do not buy. Trading stays closed, so nobody can lose money. Tell Claude.</b>}
        </Step>
        <Step n={5} state={s(live, deployed && allOk && !live)} title={`The first buy, from ${short(FIRST)}`}>
          {!live && allOk && launch?.token && (
            <span>Everything matches. Buy from {short(FIRST)} on <a href={`https://app.uniswap.org/swap?chain=mainnet&inputCurrency=NATIVE&outputCurrency=${launch.token}`} target="_blank" rel="noreferrer">Uniswap</a>, any amount. The moment it lands, the token goes public.</span>
          )}
        </Step>
        <Step n={6} state={s(live, false)} title="Live: announced on Telegram, Bluesky and the site" />
      </ol>

      {busy && <div className="launch-stage"><i className="pulse" /><span>{busy}</span></div>}
      {err && <div className="bad">{err}</div>}
    </div>
  );
}
