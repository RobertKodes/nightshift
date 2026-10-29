import { ethTransport } from "./ethRpc";
import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { chooseWallet } from "./wallet";

/** TokenDeals as IMD deployed it (launch #2655) and we checked on chain: pinned here, never taken from the server. */
const DEALS = "0x8c99dfec3011732bbcb33c79d1b36cf0b50d9e72";
const DEALS_BLOCK = "26295065";
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const ABI = parseAbi(["function passSigner() view returns (address)", "function owner() view returns (address)", "function setPassSigner(address signer)"]);
const rpc = createPublicClient({ chain: mainnet, transport: ethTransport() });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const mb = (n: number) => `${Math.round(n / 1e6)} MB`;

type Call = (token: string, path: string, body?: unknown) => Promise<any>;
type App = { id: string; at: number; status: "pending" | "accepted" | "declined"; note?: string; project: { name: string; website: string; x: string; telegram: string }; contact: string; token: { chain: string; chainName: string; address: string }; proof: string; post: string; market: { symbol?: string; liquidityUsd?: number; pairUrl?: string } | null };
const PROOF: Record<string, string> = { owner: "signed by the token's owner", deployer: "signed by the deployer", mint: "signed by the mint authority", unmatched: "signed, but not by the owner or deployer", unknown: "signed; ownership not confirmed", unsigned: "not signed" };
const CHAINS: [string, string][] = [["ethereum", "Ethereum"], ["base", "Base"], ["arbitrum", "Arbitrum"], ["bnb", "BNB Chain"], ["polygon", "Polygon"], ["optimism", "Optimism"], ["avalanche", "Avalanche"], ["robinhood", "Robinhood Chain"], ["solana", "Solana"], ["other", "Another chain"]];

/** The partner review lives under /api/partners, behind the same admin token as /setup. */
async function partnerApi(token: string, path: string, body?: unknown) {
  const r = await fetch(`/api/partners/${path}`, { method: body === undefined ? "GET" : "POST", headers: { "x-admin-token": token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

/** The partner applications: accept or decline in one tap, and register a project whose form did not save. */
function Partners({ token }: { token: string }) {
  const [apps, setApps] = useState<App[] | null>(null), [msg, setMsg] = useState<string | null>(null), [draft, setDraft] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [add, setAdd] = useState(false), [f, setF] = useState({ project: "", chain: "robinhood", token: "", website: "", x: "", telegram: "", post: "", note: "" });
  const load = () => partnerApi(token, "applications").then((r: { applications: App[] }) => setApps(r.applications)).catch((e) => setMsg((e as Error).message));
  useEffect(() => { void load(); }, [token]);
  const decide = async (a: App, decision: "accept" | "decline") => {
    setBusy(true); setMsg(null); setDraft(null);
    try {
      const r = await partnerApi(token, `${a.id}/decide`, { decision }) as { status: string; announced?: boolean; xDraft?: string };
      setMsg(decision === "accept" ? `${a.project.name} accepted${r.announced ? " and announced in the community" : ""}.` : `${a.project.name} declined.`);
      if (r.xDraft) setDraft(r.xDraft);
      await load();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const register = async () => {
    setBusy(true); setMsg(null);
    try { await partnerApi(token, "add", f); setMsg(`${f.project} registered. It is in the list below and on Telegram.`); setAdd(false); await load(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const pending = apps?.filter((a) => a.status === "pending") ?? [], done = apps?.filter((a) => a.status !== "pending") ?? [];
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));
  return <div className="todo-body">
    {apps === null ? <p className="faint">Loading the applications…</p> : !pending.length ? <p className="faint">No applications waiting.{done.length ? ` ${done.filter((a) => a.status === "accepted").length} accepted, ${done.filter((a) => a.status === "declined").length} declined so far.` : ""}</p> : pending.map((a) => (
      <div key={a.id} className="todo-app">
        <div><b>{a.project.name}</b>{a.market?.symbol ? ` ($${a.market.symbol})` : ""} on {a.token.chainName}
          <span className="faint"> · {PROOF[a.proof] ?? a.proof}{a.market?.liquidityUsd ? ` · liquidity $${Math.round(a.market.liquidityUsd).toLocaleString("en-US")}` : " · no DEX pair found"}</span>
          {a.note && <span className="todo-note">{a.note}</span>}
          <span className="todo-links">{a.market?.pairUrl && <a href={a.market.pairUrl} target="_blank" rel="noreferrer">Chart</a>}{a.post && <a href={a.post} target="_blank" rel="noreferrer">Their post</a>}{a.project.website && <a href={a.project.website} target="_blank" rel="noreferrer">Website</a>}{a.project.x && <a href={a.project.x} target="_blank" rel="noreferrer">X</a>}{a.project.telegram && <a href={a.project.telegram} target="_blank" rel="noreferrer">Telegram</a>}{a.contact && <span>Contact: {a.contact}</span>}</span>
        </div>
        <div className="todo-actions"><button className="btn primary" disabled={busy} onClick={() => void decide(a, "accept")}>Accept and announce</button><button className="btn" disabled={busy} onClick={() => void decide(a, "decline")}>Decline</button></div>
      </div>
    ))}
    {draft && <div className="todo-draft"><p>Their announcement for X is ready:</p><pre>{draft}</pre><div className="todo-actions"><a className="btn primary" href={`https://x.com/intent/post?text=${encodeURIComponent(draft)}`} target="_blank" rel="noreferrer">Post it on X</a><button className="btn" onClick={() => void navigator.clipboard.writeText(draft).catch(() => {})}>Copy</button></div></div>}
    {!add ? <button className="btn ghost" onClick={() => setAdd(true)}>A project applied but is not here? Register it by hand</button> : <div className="todo-form">
      <label>Project<input className="field" value={f.project} onChange={set("project")} placeholder="Sovrn One" /></label>
      <label>Chain<select className="field" value={f.chain} onChange={set("chain")}>{CHAINS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
      <label className="wide">Token address<input className="field" value={f.token} onChange={set("token")} placeholder="0x…" /></label>
      <label>Website<input className="field" value={f.website} onChange={set("website")} placeholder="https://" /></label>
      <label>X<input className="field" value={f.x} onChange={set("x")} placeholder="@handle" /></label>
      <label>Telegram<input className="field" value={f.telegram} onChange={set("telegram")} placeholder="t.me/…" /></label>
      <label>Their post<input className="field" value={f.post} onChange={set("post")} placeholder="https://x.com/…/status/…" /></label>
      <label className="wide">Note<input className="field" value={f.note} onChange={set("note")} placeholder="Why it is added by hand" /></label>
      <div className="todo-actions wide"><button className="btn primary" disabled={busy || !f.project || !f.token} onClick={() => void register()}>Register</button><button className="btn ghost" onClick={() => setAdd(false)}>Cancel</button></div>
    </div>}
    {msg && <p className="todo-msg">{msg}</p>}
  </div>;
}

/**
 * Everything the owner still has to do, at the top of /setup: each one a button, done when its check turns green.
 * Opening Token Deals saves its address and restarts; the holder price is one transaction from the dev wallet.
 */
export function OwnerTodo({ call, token, guardOn, saveSettings, onToken }: { call: Call; token: string; guardOn: boolean; saveSettings: (patch: Record<string, string>) => Promise<void>; onToken: (t: string) => void }) {
  const [desk, setDesk] = useState<{ open: boolean; address: string | null; passSigner: string } | null>(null);
  const [signer, setSigner] = useState<string | null>(null), [players, setPlayers] = useState(0);
  const [backups, setBackups] = useState<{ name: string; bytes: number }[] | null>(null);
  const [step, setStep] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  const [sure, setSure] = useState<"token" | "backups" | null>(null), [fresh, setFresh] = useState<string | null>(null);
  const read = async () => {
    setDesk(await fetch("/api/deals/config").then((r) => r.json()).catch(() => null));
    setSigner(await rpc.readContract({ address: DEALS, abi: ABI, functionName: "passSigner" }).catch(() => null));
    const live = await fetch("/api/games/live").then((r) => r.json()).catch(() => null) as { games?: { house?: boolean }[] } | null;
    setPlayers(live?.games?.filter((g) => !g.house).length ?? 0);
    setBackups(await call(token, "backups").then((r: { files: { name: string; bytes: number }[] }) => r.files).catch(() => null));
  };
  useEffect(() => { void read(); }, [token]);

  const run = async (what: string, f: () => Promise<void>) => { setErr(null); setStep(what); try { await f(); } catch (e) { setErr((e as Error).message.split("\n")[0]!); } setStep(null); };
  const openDeals = () => run("Saving the address and restarting the engine…", async () => { await saveSettings({ DEALS_ADDRESS: DEALS, DEALS_BLOCK }); await read(); });
  const setPass = () => run("Connect your dev wallet…", async () => {
    const want = desk?.passSigner;
    if (!want || !/^0x[0-9a-fA-F]{40}$/.test(want)) throw new Error("The server has no pass signer yet. Try again in a minute.");
    const w = createWalletClient({ chain: mainnet, transport: custom((await chooseWallet({ chain: 1 })) as never) });
    const [me] = await w.requestAddresses();
    if (!me) throw new Error("No account.");
    if (me.toLowerCase() !== DEV) throw new Error(`This is ${short(me)}. Switch to your dev wallet ${short(DEV)}: it owns Token Deals.`);
    await w.switchChain({ id: 1 }).catch(() => { throw new Error("Switch your wallet to Ethereum."); });
    const owner = await rpc.readContract({ address: DEALS, abi: ABI, functionName: "owner" });
    if (owner.toLowerCase() !== DEV) throw new Error(`Token Deals belongs to ${short(owner)}, not your dev wallet.`);
    await rpc.simulateContract({ account: me, address: DEALS, abi: ABI, functionName: "setPassSigner", args: [want as `0x${string}`] });
    setStep("Confirm in your wallet: setPassSigner on Token Deals (a few cents of gas)…");
    const h = await w.writeContract({ account: me, chain: mainnet, address: DEALS, abi: ABI, functionName: "setPassSigner", args: [want as `0x${string}`] });
    setStep("Waiting for Ethereum to confirm…");
    if ((await rpc.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("The transaction reverted.");
    await read();
  });
  const rotate = () => run("Making a new password…", async () => { const r = await call(token, "rotate-token", {}) as { token?: string; error?: string }; if (!r.token) throw new Error(r.error ?? "No new password came back."); setFresh(r.token); onToken(r.token); setSure(null); });
  const clean = () => run("Deleting the old copies…", async () => { await call(token, "backups/delete", {}); setSure(null); await read(); });

  const dealsOpen = !!desk?.open && desk.address?.toLowerCase() === DEALS;
  const passOn = !!signer && !!desk?.passSigner && signer.toLowerCase() === desk.passSigner.toLowerCase();
  const space = backups?.reduce((n, b) => n + b.bytes, 0) ?? 0;
  return (
    <div className="card-b todo">
      <ol className="todo-list">
        <li className="todo-item">
          <div className="todo-h"><b>Partner applications</b><span className="faint">accept to badge and announce them; register anyone whose form did not save</span></div>
          <Partners token={token} />
        </li>
        <li className={`todo-item${dealsOpen ? " ok" : ""}`}>
          <div className="todo-h"><b>{dealsOpen ? "✅ Token Deals is open" : "Open Token Deals"}</b><span className="faint">the contract is live at <a href={`https://etherscan.io/address/${DEALS}`} target="_blank" rel="noreferrer">{short(DEALS)}</a>: owner your dev wallet, fees to the FeeSplitter</span></div>
          {!dealsOpen && <div className="todo-actions"><button className="btn primary" disabled={!!step || players > 0} onClick={() => void openDeals()}>Open Token Deals</button><span className="faint">{players > 0 ? `${players} real-money ${players === 1 ? "game is" : "games are"} on: wait for ${players === 1 ? "it" : "them"} to end, the engine restarts.` : "Saves the address and restarts the engine (about 20 seconds). The Sell form goes live on /deals."}</span></div>}
        </li>
        <li className={`todo-item${passOn ? " ok" : ""}`}>
          <div className="todo-h"><b>{passOn ? "✅ Holders pay 0.5%" : "Turn on the 0.5% holder price"}</b><span className="faint">one transaction from your dev wallet: setPassSigner({desk?.passSigner ? short(desk.passSigner) : "…"}), the server's pass key</span></div>
          {!passOn && <div className="todo-actions"><button className="btn primary" disabled={!!step || !desk?.passSigner} onClick={() => void setPass()}>Connect dev wallet and set it</button><span className="faint">Until then every buyer pays 1%.</span></div>}
        </li>
        <li className="todo-item">
          <div className="todo-h"><b>{fresh ? "✅ New setup password made" : "Make a new setup password"}</b><span className="faint">the current one was shared in a chat; this replaces it right away</span></div>
          {fresh ? <div className="todo-draft"><p>Your new password. Save it in your password manager now: it is shown only once.</p><pre>{fresh}</pre><div className="todo-actions"><button className="btn" onClick={() => void navigator.clipboard.writeText(fresh).catch(() => {})}>Copy</button></div></div>
            : sure === "token" ? <div className="todo-actions"><button className="btn danger" disabled={!!step} onClick={() => void rotate()}>Yes, make a new password</button><button className="btn ghost" onClick={() => setSure(null)}>Cancel</button></div>
              : <div className="todo-actions"><button className="btn" onClick={() => setSure("token")}>Make a new password</button></div>}
        </li>
        <li className={`todo-item${backups && !backups.length ? " ok" : ""}`}>
          <div className="todo-h"><b>{backups && !backups.length ? "✅ No old index copies left" : "Free up server space"}</b><span className="faint">{backups?.length ? `${backups.map((b) => b.name).join(" and ")}: ${mb(space)}, left from the Bazaar index fix` : "the copies left from the Bazaar index fix"}</span></div>
          {!!backups?.length && (sure === "backups" ? <div className="todo-actions"><button className="btn danger" disabled={!!step} onClick={() => void clean()}>Yes, delete {mb(space)}</button><button className="btn ghost" onClick={() => setSure(null)}>Cancel</button></div>
            : <div className="todo-actions"><button className="btn" onClick={() => setSure("backups")}>Delete the old copies</button></div>)}
        </li>
        <li className={`todo-item${guardOn ? " ok" : ""}`}>
          <div className="todo-h"><b>{guardOn ? "✅ The group guard and door are on" : "Turn on the group guard and door"}</b><span className="faint">deletes scam messages, turns impostors away at the door, keeps new members to text only for a day and tells each one in private that admins never DM first</span></div>
          {!guardOn && <div className="todo-actions"><button className="btn primary" disabled={!!step || players > 0} onClick={() => void run("Turning the guard on and restarting…", () => saveSettings({ MODERATION: "1" }))}>Turn on the guard</button><span className="faint">Restarts the engine (about 20 seconds).</span></div>}
          <p className="faint todo-sub">Then, in the Telegram app (bots are not allowed to change these):</p>
          <ul className="swarm-plan">
            <li>Group → Edit → Group type → turn on <b>Approve new members</b>. Every joiner then passes the bot's door first; doubtful ones come to you with Let in / Turn away buttons.</li>
            <li>Group → Edit → Members → turn on <b>Hide members</b>. Scammers then can't copy the member list to DM people.</li>
            <li>Group → Edit → Administrators → turn on <b>Aggressive anti-spam</b>, if Telegram shows it for the group.</li>
            <li>Group → Edit → Administrators → the bot: it needs <b>Delete messages</b>, <b>Ban users</b> and <b>Invite users via link</b> (that one lets it approve join requests).</li>
            <li>Group → Edit → Permissions → turn off <b>Add members</b> for everyone.</li>
          </ul>
        </li>
        <li className="todo-item">
          <div className="todo-h"><b>Only you can do these</b><span className="faint">outside this server</span></div>
          <ul className="swarm-plan">
            <li>New Telegram bot token: in Telegram open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>, send <code>/revoke</code>, pick the bot, then paste the new token in <b>Bot token</b> further down this page and save with restart.</li>
            <li>Two-step login on <a href="https://github.com/settings/security" target="_blank" rel="noreferrer">GitHub</a>, <a href="https://console.aws.amazon.com/iam/home#/security_credentials" target="_blank" rel="noreferrer">AWS</a>, <a href="https://x.com/settings/account/login_verification" target="_blank" rel="noreferrer">X</a> and Telegram (Settings → Privacy and Security → Two-Step Verification).</li>
            <li>Before announcing Token Deals: an independent review of the contract. IMD's own tests passed, but its notes say it is not an outside audit.</li>
          </ul>
        </li>
      </ol>
      {step && <p className="todo-msg">{step}</p>}
      {err && <p className="todo-msg bad">{err}</p>}
    </div>
  );
}
