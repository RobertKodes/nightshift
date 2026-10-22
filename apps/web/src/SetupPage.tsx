import { useEffect, useState } from "react";
import { TokenLaunch } from "./TokenLaunch";
import { SwarmOrders } from "./SwarmOrders";
import { ImdOrders } from "./ImdOrders";
import { FrogsAdmin } from "./FrogsAdmin";
import { AfterLaunch } from "./AfterLaunch";
import { GameStakes } from "./GameStakes";

type Check = { id: string; label: string; state: "ok" | "warn" | "block"; detail: string };
type State = {
  running: Record<string, string>;
  saved: Record<string, string>;
  pending: boolean;
  checks: Check[];
  readyForLive: boolean;
  stats: { companies: number; products: number };
  supervised: boolean;
};

const KEY = "ns_admin";
const read = () => { try { localStorage.removeItem(KEY); return sessionStorage.getItem(KEY) ?? ""; } catch { return ""; } };
const keep = (t: string) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* private window */ } };

async function call(token: string, path: string, body?: unknown) {
  const r = await fetch(`/api/admin/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-admin-token": token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

type Flag = { game: string; escrow: string; player: string; wallet: string | null; moves: number; meanMs: number; sdMs: number; at: number };
/** Staked chess games whose move times look machine-even: nothing happens on its own, the operator looks. */
function FairPlay({ token }: { token: string }) {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  useEffect(() => { void call(token, "fairplay").then((r: { flags: Flag[] }) => setFlags(r.flags)).catch(() => setFlags([])); }, [token]);
  if (!flags) return null;
  return (
    <div className="card-b">
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>Fair play: {flags.length ? `${flags.length} staked game${flags.length > 1 ? "s" : ""} with machine-even move times (look before you void anything)` : "no staked game flagged"}</p>
      {flags.length > 0 && <table><tbody>{flags.slice(0, 20).map((f) => (
        <tr key={f.game + f.player}><td className="mono">{f.wallet ? `${f.wallet.slice(0, 6)}…${f.wallet.slice(-4)}` : f.player}</td><td className="dim">{f.moves} moves · {(f.meanMs / 1000).toFixed(1)} s ± {(f.sdMs / 1000).toFixed(2)} s</td><td className="mono faint">match {f.escrow.slice(0, 10)}…</td><td className="dim">{new Date(f.at).toLocaleString()}</td></tr>
      ))}</tbody></table>}
    </div>
  );
}

type PrizeRow = { wallet: string; name: string; wins?: number; opponents?: number; score?: number };
type PrizeAward = { week: number; game: string; place: number; wallet: string; name: string; hours: number; result: string; payAt: number; paidAt?: number; voided?: { at: number; reason: string } };
type PrizeAdmin = { week: { startedAt: number; endsAt: number }; hours: number[]; boards: Record<string, PrizeRow[]>; awards: PrizeAward[]; voids: { game: string; wallet: string }[] };
/** The weekly prizes: this week's boards and the awards in their 48-hour hold, each with Void (a paid prize stays paid). */
function PrizesAdmin({ token }: { token: string }) {
  const [d, setD] = useState<PrizeAdmin | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { void call(token, "prizes").then(setD).catch((e) => setMsg((e as Error).message)); }, [token]);
  const voidOne = async (game: string, wallet: string, week?: number) => {
    const reason = prompt(`Void ${game} for ${wallet}? Reason (shown to nobody but you):`, "voided by the admin");
    if (reason === null) return;
    try { setD(await call(token, "prizes/void", { game, wallet, week, reason })); setMsg(`Voided ${game} · ${wallet.slice(0, 6)}…${wallet.slice(-4)}`); } catch (e) { setMsg((e as Error).message); }
  };
  if (!d) return msg ? <div className="card-b"><p className="faint" style={{ fontSize: 12, margin: 0 }}>{msg}</p></div> : null;
  const held = d.awards.filter((a) => !a.paidAt && !a.voided);
  const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
  return (
    <div className="card-b">
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>Week of {new Date(d.week.startedAt).toUTCString().slice(0, 16)} · prizes {d.hours.join(" / ")} h · {held.length ? `${held.length} award${held.length > 1 ? "s" : ""} in the 48 h hold` : "nothing in the hold"}{msg ? ` · ${msg}` : ""}</p>
      {held.length > 0 && <table><tbody>{held.map((a) => (
        <tr key={`${a.week}-${a.game}-${a.wallet}`}><td>{a.game} #{a.place}</td><td>{a.name}</td><td className="mono">{short(a.wallet)}</td><td className="dim">+{a.hours} h · {a.result} · lands {new Date(a.payAt).toUTCString().slice(5, 22)}</td><td><button className="btn" onClick={() => void voidOne(a.game, a.wallet, a.week)}>Void</button></td></tr>
      ))}</tbody></table>}
      <table><tbody>{Object.entries(d.boards).flatMap(([game, rows]) => rows.slice(0, 5).map((r, i) => (
        <tr key={`${game}-${r.wallet}`}><td>{game} now #{i + 1}</td><td>{r.name}</td><td className="mono">{short(r.wallet)}</td><td className="dim">{r.score !== undefined ? `${r.score.toLocaleString()} pts` : `${r.wins} wins · ${r.opponents} rivals`}</td><td><button className="btn" onClick={() => void voidOne(game, r.wallet)}>Void</button></td></tr>
      )))}</tbody></table>
    </div>
  );
}

/** Fields of the form, in the order an operator goes live. */
const GROUPS: { title: string; note?: string; fields: { k: string; label: string; hint?: string; options?: [string, string][]; secret?: boolean }[] }[] = [
  { title: "Mode", note: "Simulation is safe: nothing leaves the server. Live places real IMD orders and sells for real USDC.", fields: [
    { k: "NIGHTSHIFT_MODE", label: "Mode", options: [["sim", "Simulation"], ["live", "Live"]] },
    { k: "REQUIRE_AUTH", label: "Owners sign in with a wallet", options: [["", "Default (on in live)"], ["1", "Required"], ["0", "Off"]] },
    { k: "PUBLIC_URL", label: "Public address", hint: "http://63.189.109.237 now; https://your-domain later" },
  ] },
  { title: "Selling", note: "Nothing to set up on chain. Every company gets its own wallet on Base; buyers pay USDC straight to it. Go live switches to Base mainnet for you.", fields: [
    { k: "SALES_CHAIN_ID", label: "Sales chain", options: [["84532", "Base Sepolia (test USDC)"], ["8453", "Base mainnet (real USDC)"]] },
    { k: "SALES_RPC", label: "Sales RPC (optional)", hint: "empty = public Base RPC" },
    { k: "PLATFORM_FEE_BPS", label: "Platform fee on withdrawals (bps, 100 = 1%)", hint: "0" },
    { k: "PLATFORM_TREASURY", label: "Fee: 80% to treasury (default 0x3322…4D69)", hint: "0x…" },
    { k: "PLATFORM_DEV", label: "Fee: 20% to dev wallet (default 0x6C4c…19b5)", hint: "0x…" },
    { k: "MAX_COMPANIES_PER_OWNER", label: "Companies per owner", hint: "5" },
  ] },
  { title: "Coinbase CDP (Bazaar)", note: "Optional. With a CDP secret API key (portal.cdp.coinbase.com, Ed25519), Coinbase's facilitator settles every payment: it pays the gas, and a product's first paid sale lists it in the CDP Bazaar, the catalogue AI agents search. If it is down, companies settle themselves. Free for 1,000 settlements a month, then $0.001 each.", fields: [
    { k: "CDP_API_KEY_ID", label: "API key id (id in the key file)", secret: true },
    { k: "CDP_API_KEY_SECRET", label: "API key secret (privateKey in the key file)", secret: true },
    { k: "X402_FACILITATOR", label: "Who settles payments", options: [["", "Default (CDP once a key is set)"], ["cdp", "CDP facilitator"], ["self", "Each company itself"]] },
  ] },
  { title: "IMD", note: "Leave empty: a free public Ethereum RPC is already used. The IMD price follows the market by itself (DexScreener, every 10 minutes).", fields: [
    { k: "ETH_RPC", label: "Ethereum RPC (optional)", hint: "https://ethereum-rpc.publicnode.com" },
  ] },
  { title: "Wallets", note: "Email and social sign-in in the wallet modal give someone without a wallet app a wallet in a minute. Reown's free plan allows 500 of those users a month, then pauses the whole project, WalletConnect included: switch it off here when that line comes near. It applies at once, no restart.", fields: [
    { k: "WALLET_SOCIAL_LOGIN", label: "Email and social sign-in", options: [["", "Default (on)"], ["1", "On"], ["0", "Off"]] },
  ] },
  { title: "CEO", note: "Optional. Without a key a free playbook decides.", fields: [
    { k: "OPENROUTER_API_KEY", label: "OpenRouter API key", secret: true },
    { k: "NIGHTSHIFT_MODEL", label: "Model (free only, ends in :free)", hint: "nvidia/nemotron-3-super-120b-a12b:free" },
  ] },
  { title: "Alerts", note: "A Telegram bot tells you when something breaks in live mode. Create one with @BotFather; get your chat id from @userinfobot.", fields: [
    { k: "TELEGRAM_BOT_TOKEN", label: "Bot token", secret: true },
    { k: "TELEGRAM_CHAT_ID", label: "Alert chats (comma separated)", hint: "-100…, 123456789" },
    { k: "TELEGRAM_ADMIN_IDS", label: "Admins who may send commands (user ids)", hint: "123456789" },
  ] },
  { title: "Community", note: "Announcements (buys, X raids, launches, milestones) go to the public chat; alerts stay in the alert chats above. Share an X post to the bot, or send /raid <link>, to raid it.", fields: [
    { k: "TELEGRAM_COMMUNITY", label: "Public announcement chat", hint: "-100… or @group" },
    { k: "BUYBOT_MIN_USD", label: "Smallest buy to post (USD)", hint: "0" },
    { k: "BUYBOT_EMOJI_USD", label: "Dollars per 🌙 in a buy", hint: "10" },
    { k: "BUYBOT_MEDIA", label: "Custom buy GIF/MP4 URL (optional)", hint: "https://…/buy.mp4" },
    { k: "DIGEST", label: "Daily company digest (live companies, real records only)", options: [["", "Default (on)"], ["1", "On"], ["0", "Off"]] },
    { k: "DIGEST_HOUR", label: "Digest hour (UTC)", hint: "18" },
    { k: "CHANGELOG_POST", label: "Weekly changelog, posted and pinned Mondays 09:00 UTC", options: [["", "Default (on)"], ["1", "On"], ["0", "Off"]] },
    { k: "X_URL", label: "X profile", hint: "https://x.com/…" },
    { k: "TELEGRAM_URL", label: "Telegram link", hint: "https://t.me/…" },
  ] },
  { title: "Bluesky (project account)", note: "Posts a promo a day, the platform's news and, in live mode, company drafts. Use an app password, never the account password.", fields: [
    { k: "BLUESKY_HANDLE", label: "Handle", hint: "nightshifttech.bsky.social" },
    { k: "BLUESKY_APP_PASSWORD", label: "App password", secret: true },
    { k: "BLUESKY_DAILY_MAX", label: "Most posts a day", hint: "10" },
    { k: "BLUESKY_GAP_MINUTES", label: "Minutes between posts", hint: "45" },
  ] },
  { title: "Gumroad (owners sell on their own accounts)", note: "Optional. Register one OAuth app at gumroad.com → Settings → Advanced → Applications: a name, an icon, the site's address, and the redirect URI <PUBLIC_URL>/api/connect/gumroad/callback exactly. Paste its application id and secret here, then restart. Owners then connect their own Gumroad accounts from the owner desk (scopes: edit_products view_sales view_payouts). Gumroad has no app review.", fields: [
    { k: "GUMROAD_CLIENT_ID", label: "Application ID", hint: "from the Gumroad application page" },
    { k: "GUMROAD_CLIENT_SECRET", label: "Application secret", secret: true },
  ] },
  { title: "Platform token", note: "Optional. Holders pay no platform fee and are featured in the market. Fees buy the token back.", fields: [
    { k: "TOKEN_ADDRESS", label: "Token address (Ethereum)", hint: "0x…" },
    { k: "TOKEN_SYMBOL", label: "Symbol", hint: "OCTO" },
    { k: "TOKEN_HOLDER_MIN", label: "Holder minimum (tokens)", hint: "10000" },
    { k: "TOKEN_BUY_URL", label: "Where to buy it", hint: "https://app.uniswap.org/…" },
    { k: "NFT_ADDRESS", label: "NIGHT FROGS contract (fills itself in)", hint: "0x…" },
    { k: "NFT_EXTRA_SLOTS", label: "Extra company slots per frog holder", hint: "2" },
    { k: "FORGE_ADDRESS", label: "NIGHT WATCHERS forge contract (the swarm's frog-forge order; also pin it in ForgePage.tsx)", hint: "0x…" },
    { k: "WATCH_ROOM_CHAT", label: "Watch Room: chat id of the private Telegram group for Night Watcher holders (add the bot as admin with invite and ban rights)", hint: "-100…" },
  ] },
  { title: "Live betting", note: "BetPool on Ethereum (the swarm's arena-bets order). Empty = off. Once deployed: its address and deploy block here, setSigner(the game signer) from the owner wallet, and the same address pinned in the web app (bets.tsx).", fields: [
    { k: "BETPOOL_ADDRESS", label: "BetPool contract", hint: "0x…" },
    { k: "BETPOOL_BLOCK", label: "Its deploy block", hint: "e.g. 23900000" },
  ] },
  { title: "House services", note: "Token Verdict, Hook Inspector and the IMD Data Feed, sold by the NIGHTSHIFT Services house company. Its wallet settles each x402 payment on Base, so keep a little ETH there (its address is payTo in /api/v1/services). Without an Etherscan key the services read Sourcify only.", fields: [
    { k: "ETHERSCAN_API_KEY", label: "Etherscan API key (v2, free tier)", secret: true },
    { k: "WATCHTOWER_URL", label: "IMD Watchtower status URL", hint: "http://imd-watchtower:8787/status" },
  ] },
  { title: "Multichain swap", note: "The /swap page's routes across Ethereum, Base, Robinhood Chain, Solana and the XRP Ledger, from LI.FI and Relay. NIGHTSHIFT's fee is asked per quote; NIGHT FROGS holders signed in with their wallet pay none. LI.FI collects it only once the integration is registered on portal.li.fi with a fee wallet (EVM and Solana), under the name set here; Relay pays it to the fee wallet as USDC to claim at relay.link/claim-app-fees. Keys stay on this server. Applies at once, no restart.", fields: [
    { k: "SWAP_FEE_BPS", label: "NIGHTSHIFT swap fee (basis points, 25 = 0.25%, at most 100)", hint: "25" },
    { k: "SWAP_FEE_WALLET", label: "Fee wallet for Relay app fees (EVM; empty = the treasury)", hint: "0x…" },
    { k: "LIFI_INTEGRATOR", label: "LI.FI integration name (from portal.li.fi)", hint: "nightshift" },
    { k: "LIFI_API_KEY", label: "LI.FI API key", secret: true },
    { k: "RELAY_API_KEY", label: "Relay API key (dashboard.relay.link)", secret: true },
  ] },
  { title: "Game Room", note: "The house exhibition: one NIGHT CHESS game between house bots, never rated or staked, stepping aside while more than the limit of real games are on. Weekly prizes: shift hours to the top 3 of each game (1st,2nd,3rd), added 48 hours after the week ends. Applies after a restart.", fields: [
    { k: "HOUSE_GAMES", label: "House exhibition", options: [["", "Default (on)"], ["1", "On"], ["0", "Off"]] },
    { k: "HOUSE_GAMES_MAX_REAL", label: "Pause it past this many real games", hint: "12" },
    { k: "WEEKLY_PRIZES", label: "Weekly prizes", options: [["", "Default (on)"], ["1", "On"], ["0", "Off"]] },
    { k: "PRIZE_HOURS", label: "Prize hours, 1st,2nd,3rd", hint: "24,12,6" },
  ] },
  { title: "Simulation pacing", fields: [
    { k: "SIM_SHIFT_MINUTES", label: "Minutes between shifts", hint: "2" },
    { k: "SIM_JOB_SECONDS", label: "Seconds per swarm job", hint: "40" },
  ] },
];

export function SetupPage() {
  const [token, setToken] = useState(read);
  const [draft, setDraft] = useState("");
  const [s, setS] = useState<State | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = (t = token) => call(t, "setup").then((x: State) => { setS(x); setForm(x.saved); setMsg(null); }).catch((e) => { setMsg(e.message); if (/token/.test(e.message)) { keep(""); setToken(""); } });
  useEffect(() => { if (token) void load(); }, [token]);

  if (!token) {
    return (
      <div className="docs">
        <h1>Setup</h1>
        <p className="lead">For the operator of this server. The admin token is printed in the engine log on first start and kept in the data folder as <code>admin-token</code>.</p>
        <form className="card card-b setup-login" onSubmit={(e) => { e.preventDefault(); keep(draft.trim()); setToken(draft.trim()); }}>
          <input className="field" type="password" placeholder="Admin token" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <button className="btn primary" disabled={!draft.trim()}>Open setup</button>
          {msg && <span className="bad">{msg}</span>}
        </form>
      </div>
    );
  }
  if (!s) return <div className="docs"><h1>Setup</h1><div className="card empty">{msg ?? "Loading…"}</div></div>;

  const save = async (patch: Record<string, string>, restart: boolean) => {
    setBusy(true); setMsg(null);
    try {
      const x: State = await call(token, "setup", patch);
      setS(x); setForm(x.saved);
      if (restart) {
        if (!x.supervised) { setMsg("Saved. Restart the engine to apply."); return; }
        await call(token, "restart", {});
        setMsg("Restarting…");
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          try { await load(); setMsg("Applied. The engine restarted with the new settings."); return; } catch { /* still starting */ }
        }
        setMsg("The engine has not come back yet. Check the server.");
      } else setMsg("Saved.");
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const goLive = () => save({ ...form, NIGHTSHIFT_MODE: "live", SALES_CHAIN_ID: "8453", REQUIRE_AUTH: "1" }, true);
  const blocks = s.checks.filter((c) => c.state === "block" && c.id !== "mode");

  return (
    <div className="docs setup">
      <div className="setup-h">
        <div>
          <h1>Setup</h1>
          <p className="lead">Running in <b>{s.running.NIGHTSHIFT_MODE === "live" ? "LIVE" : "simulation"}</b> at {s.running.PUBLIC_URL} · {s.stats.companies} companies · {s.stats.products} products live</p>
        </div>
        <button className="btn ghost" onClick={() => { keep(""); setToken(""); setS(null); }}>Lock</button>
      </div>

      <section className="card">
        <div className="card-h"><h3>Go-live checklist</h3><span className={`pill ${s.readyForLive ? "done" : "failed"}`}>{s.readyForLive ? "ready" : `${blocks.length} to fix`}</span></div>
        <ul className="checks">
          {s.checks.map((c) => (
            <li key={c.id}><i className={`dot ${c.state}`} /><div><b>{c.label}</b><span>{c.detail}</span></div></li>
          ))}
        </ul>
        <div className="card-b setup-live">
          {s.running.NIGHTSHIFT_MODE === "live" ? (
            <><span>Live. To stop real spending, switch back to simulation.</span><button className="btn danger" disabled={busy} onClick={() => save({ ...form, NIGHTSHIFT_MODE: "sim" }, true)}>Back to simulation</button></>
          ) : (
            <><span>Going live sets mode Live, Base mainnet and wallet sign-in, then restarts. Fund each company wallet with IMD (and a little ETH for gas) before its first shift.</span>
              <button className="btn primary" disabled={busy || blocks.length > 0} onClick={goLive}>Go live</button></>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-h"><h3>Orders for the IMD swarm</h3><span className="faint" style={{ fontSize: 12 }}>free check first · 0.5 IMD each from your dev wallet</span></div>
        <SwarmOrders call={call} token={token} />
      </section>

      <section className="card">
        <div className="card-h"><h3>Launch the NIGHTSHIFT token</h3><span className="faint" style={{ fontSize: 12 }}>through IMD · paid from your wallet</span></div>
        <TokenLaunch call={call} token={token} />
      </section>

      <section className="card">
        <div className="card-h"><h3>After launch: keeper and frog rewards</h3><span className="faint" style={{ fontSize: 12 }}>daily split and IMD burn · weekly NIGHT FROGS roots</span></div>
        <AfterLaunch call={call} token={token} />
      </section>

      <section className="card">
        <div className="card-h"><h3>Game stakes</h3><span className="faint" style={{ fontSize: 12 }}>GameEscrow v2 · real IMD and $SHIFT duels</span></div>
        <GameStakes token={token} />
        <FairPlay token={token} />
      </section>

      <section className="card">
        <div className="card-h"><h3>Weekly game prizes</h3><span className="faint" style={{ fontSize: 12 }}>shift hours to the top 3 · 48 h hold · void an entry</span></div>
        <PrizesAdmin token={token} />
      </section>

      <section className="card">
        <div className="card-h"><h3>Order from IMD</h3><span className="faint" style={{ fontSize: 12 }}>ready-made swarm work · paid from your wallet</span></div>
        <ImdOrders call={call} token={token} />
      </section>

      <section className="card">
        <div className="card-h"><h3>NIGHT FROGS</h3><span className="faint" style={{ fontSize: 12 }}>Chainlink VRF and reveal · from the owner wallet</span></div>
        <FrogsAdmin />
      </section>

      {GROUPS.map((g) => (
        <section className="card" key={g.title}>
          <div className="card-h"><h3>{g.title}</h3>{g.note && <span className="faint" style={{ fontSize: 12 }}>{g.note}</span>}</div>
          <div className="card-b setup-grid">
            {g.fields.map((f) => (
              <label key={f.k}>
                <span>{f.label} <small className="mono faint">{f.k}</small></span>
                {f.options ? (
                  <select className="field" value={form[f.k] ?? ""} onChange={(e) => setForm({ ...form, [f.k]: e.target.value })}>
                    {!f.options.some(([v]) => v === "") && <option value="">Default ({s.running[f.k]})</option>}
                    {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ) : (
                  <input className="field" type={f.secret ? "password" : "text"} value={f.secret && form[f.k] === "set" ? "" : form[f.k] ?? ""} placeholder={f.secret ? (form[f.k] === "set" ? "set (type to replace)" : "not set") : `${s.running[f.k] || f.hint || ""}`}
                    onChange={(e) => setForm({ ...form, [f.k]: e.target.value })} />
                )}
              </label>
            ))}
          </div>
        </section>
      ))}

      <section className="card">
        <div className="card-h"><h3>Tools</h3></div>
        <div className="card-b setup-tools">
          <button className="btn" disabled={busy} onClick={async () => { try { const r = await call(token, "test-alert", {}); setMsg(r.ok ? "Test alert sent. Check Telegram." : "Not sent: set the bot token and chat id, Save and restart, then try again."); } catch (e) { setMsg((e as Error).message); } }}>Send a test alert</button>
          <BuybackForm token={token} onDone={setMsg} />
        </div>
      </section>

      <div className="setup-bar">
        {msg && <span>{msg}</span>}
        {s.pending && <span className="warn">Saved settings differ from what is running.</span>}
        <button className="btn" disabled={busy} onClick={() => save(form, false)}>Save</button>
        <button className="btn primary" disabled={busy} onClick={() => save(form, true)}>Save and restart</button>
      </div>
    </div>
  );
}

/** Publishes a buyback on /token: the tx, what it cost and how many tokens it bought. */
function BuybackForm({ token, onDone }: { token: string; onDone: (m: string) => void }) {
  const [f, setF] = useState({ tx: "", usd: "", amount: "", note: "" });
  return (
    <form className="setup-buyback" onSubmit={async (e) => {
      e.preventDefault();
      try { await call(token, "buyback", { tx: f.tx.trim(), usd: Number(f.usd), amount: Number(f.amount), note: f.note }); setF({ tx: "", usd: "", amount: "", note: "" }); onDone("Buyback published on /token."); }
      catch (err) { onDone((err as Error).message); }
    }}>
      <b>Record a buyback</b>
      <input className="field" placeholder="tx hash 0x…" value={f.tx} onChange={(e) => setF({ ...f, tx: e.target.value })} />
      <input className="field" placeholder="USD spent" value={f.usd} onChange={(e) => setF({ ...f, usd: e.target.value })} />
      <input className="field" placeholder="tokens bought" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      <input className="field" placeholder="note (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <button className="btn" disabled={!f.tx}>Publish</button>
    </form>
  );
}
