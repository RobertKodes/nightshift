import { ethTransport } from "./ethRpc";
import { useEffect, useState } from "react";
import { SHIFT } from "./shift";
import { type Address, createPublicClient, createWalletClient, custom, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";

const rpc = createPublicClient({ chain: mainnet, transport: ethTransport() });
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
/** Owner calls, as fixed in the launch spec: name the keeper, post a frog epoch's root. */
const SPLITTER = parseAbi(["function setKeeper(address keeper)"]);
const REWARDS = parseAbi(["function postRoot(uint256 epoch, bytes32 root, address token, uint256 total)"]);

type Call = (token: string, path: string, body?: unknown) => Promise<any>;
type Epoch = { epoch: number; at: number; wallets: number; tokens: { token: string; symbol: string; total: string; root: string; posted?: string }[] };
const errText = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "").split("\n")[0]!.slice(0, 160);

/** After launch, from /setup: the keeper (gas, owner switch, run now) and the weekly NIGHT FROGS roots. */
export function AfterLaunch({ call, token }: { call: Call; token: string }) {
  const [k, setK] = useState<{ address: string; eth: string; perDay: string | null; daysLeft: number | null; low: string; reserve: string; last: { at: number; did: string[]; skipped: string[]; error?: string; line?: string; spentWei?: string } | null } | null>(null);
  const [eps, setEps] = useState<Epoch[]>([]);
  const [contracts, setContracts] = useState<Record<string, string> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    void call(token, "keeper").then(setK).catch(() => {});
    void call(token, "frogpot").then((d) => setEps(d.epochs)).catch(() => {});
    void fetch("/api/token").then((r) => r.json()).then((d) => setContracts(d.launch?.contracts ?? null)).catch(() => {});
  };
  useEffect(load, [token]);

  const dev = async () => {
    const w = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet()) as never) });
    const [a] = await w.requestAddresses();
    if (a?.toLowerCase() !== DEV) throw new Error(`Connect the dev wallet ${DEV.slice(0, 6)}…${DEV.slice(-4)}: only the owner can do this.`);
    await w.switchChain({ id: 1 });
    return { w, a: a as Address };
  };
  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg(r || "Done."); load(); } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };

  const gas = k ? Number(k.eth) / 1e18 : 0;
  const low = k ? gas < Number(k.low) / 1e18 : false, perDay = k?.perDay ? Number(k.perDay) / 1e18 : null;
  // the keeper's gas, before the rest: it also relays the staked-game payouts
  const fuel = k && <p className={low ? "bad" : "dim"} style={{ fontSize: 13, margin: "4px 0" }}>
    Gas: <b className="mono">{gas.toFixed(4)} ETH</b>{perDay !== null ? <> · spends about <span className="mono">{perDay.toFixed(5)}</span> ETH a day{k.daysLeft !== null ? <> · lasts about <b>{Math.floor(k.daysLeft)} days</b></> : null}</> : " · daily spend still being measured"}.
    {low ? ` Under ${(Number(k.low) / 1e18).toFixed(3)} ETH: send ${k.address.slice(0, 6)}…${k.address.slice(-4)} about ${Math.max(0.01, Math.ceil(((perDay ?? 0) * 90) / 0.005) * 0.005).toFixed(3)} ETH (90 days at this rate).` : ""}
    {" "}Under {(Number(k.reserve) / 1e18).toFixed(3)} ETH it sends nothing of its own and keeps the rest for staked-game payouts.</p>;
  if (!contracts?.splitter) return <div className="card-b dim" style={{ fontSize: 13 }}>{k && <><b>Keeper</b> <span className="mono faint" style={{ fontSize: 12 }}>{k.address}</span>{fuel}</>}Opens when $SHIFT is deployed: the keeper and the NIGHT FROGS weekly roots are run from here.</div>;
  return (
    <div className="card-b" style={{ display: "grid", gap: 14 }}>
      <div>
        <b>Keeper</b> <span className="mono faint" style={{ fontSize: 12 }}>{k?.address}</span>
        <p className="dim" style={{ fontSize: 13, margin: "4px 0" }}>Every two hours (odd UTC hours) it looks; it only sends what is worth its gas. Each token is split at most every 6 hours, when it is worth 50x the gas; the ETH burn reserve is burned as IMD from 0.002 ETH and 30x the gas; the launch fee is collected once a day, when worth 50x the gas. Nothing refills it: the splitter's split is fixed.</p>
        {fuel}
        <div className="setup-tools">
          <button className="btn" disabled={busy || !k} onClick={() => void act(async () => {
            const { w, a } = await dev();
            const h = await w.writeContract({ account: a, chain: mainnet, address: SHIFT.splitter, abi: SPLITTER, functionName: "setKeeper", args: [k!.address as Address] });
            await rpc.waitForTransactionReceipt({ hash: h });
            return `The server is the keeper now. tx ${h}`;
          })}>Make the server the keeper (dev wallet)</button>
          <button className="btn" disabled={busy} onClick={() => void act(async () => { const r = await call(token, "keeper/run", {}); return r.error ?? `Ran: ${r.did.length} done, ${r.skipped.length} skipped.`; })}>Run it now</button>
        </div>
        {k?.last && <p className="faint mono" style={{ fontSize: 11.5, margin: "4px 0", overflowWrap: "anywhere" }}>{k.last.error ? `Last run ${new Date(k.last.at).toUTCString().slice(5, 22)}: ${k.last.error}` : k.last.line ?? `Last run ${new Date(k.last.at).toUTCString().slice(5, 22)}: ${k.last.did.length} done`}</p>}
      </div>
      <div>
        <b>NIGHT FROGS weekly rewards</b>
        <p className="dim" style={{ fontSize: 13, margin: "4px 0" }}>Built every Monday from the shift hours each wallet earned that week. Post each root from the dev wallet; holders then claim on /frogs.</p>
        <button className="btn" disabled={busy} onClick={() => void act(async () => { const r = await call(token, "frogpot/build", {}); return r.epoch ? `Epoch ${r.epoch.epoch} built.` : "Nothing to share since the last epoch."; })}>Build this week's list now</button>
        {eps.slice().reverse().map((e) => (
          <div key={e.epoch} style={{ marginTop: 8, fontSize: 13 }}>
            <b>Epoch {e.epoch}</b> · {e.wallets} wallets · {new Date(e.at).toUTCString().slice(5, 16)}
            {e.tokens.map((t) => (
              <div key={t.token} className="setup-tools" style={{ marginTop: 4 }}>
                <span className="mono">{(Number(t.total) / 1e18).toFixed(5)} {t.symbol}</span>
                {t.posted ? <a href={`https://etherscan.io/tx/${t.posted}`} target="_blank" rel="noreferrer">posted ↗</a>
                  : <button className="btn primary" disabled={busy} onClick={() => void act(async () => {
                    const { w, a } = await dev();
                    const h = await w.writeContract({ account: a, chain: mainnet, address: SHIFT.rewards, abi: REWARDS, functionName: "postRoot", args: [BigInt(e.epoch), t.root as `0x${string}`, t.token as Address, BigInt(t.total)] });
                    await rpc.waitForTransactionReceipt({ hash: h });
                    await call(token, "frogpot/posted", { epoch: e.epoch, token: t.token, tx: h });
                    return `Epoch ${e.epoch} ${t.symbol} root posted.`;
                  })}>Post root (dev wallet)</button>}
              </div>
            ))}
          </div>
        ))}
      </div>
      {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
    </div>
  );
}
