import { useEffect, useState } from "react";

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
const read = () => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } };
const keep = (t: string) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* private window */ } };

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

/** Fields of the form, in the order an operator goes live. */
const GROUPS: { title: string; note?: string; fields: { k: string; label: string; hint?: string; options?: [string, string][]; secret?: boolean }[] }[] = [
  { title: "Mode", note: "Simulation is safe: nothing leaves the server. Live places real IMD orders and sells for real USDC.", fields: [
    { k: "NIGHTSHIFT_MODE", label: "Mode", options: [["sim", "Simulation"], ["live", "Live"]] },
    { k: "REQUIRE_AUTH", label: "Owners sign in with a wallet", options: [["", "Default (on in live)"], ["1", "Required"], ["0", "Off"]] },
    { k: "PUBLIC_URL", label: "Public address", hint: "http://63.189.109.237 now; https://your-domain later" },
  ] },
  { title: "Selling", fields: [
    { k: "SALES_CHAIN_ID", label: "Sales chain", options: [["84532", "Base Sepolia (test USDC)"], ["8453", "Base mainnet (real USDC)"]] },
    { k: "SALES_RPC", label: "Sales RPC", hint: "empty = public Base RPC" },
    { k: "PLATFORM_FEE_BPS", label: "Platform fee (bps, 100 = 1%)", hint: "0" },
    { k: "PLATFORM_TREASURY", label: "Fee goes to (address)", hint: "0x…" },
    { k: "MAX_COMPANIES_PER_OWNER", label: "Companies per owner", hint: "5" },
  ] },
  { title: "IMD", fields: [
    { k: "ETH_RPC", label: "Ethereum RPC", hint: "https://ethereum-rpc.publicnode.com" },
    { k: "IMD_USD", label: "IMD price in USD (for budgets)", hint: "6.87" },
  ] },
  { title: "CEO", note: "Optional. Without a key a free playbook decides.", fields: [
    { k: "OPENROUTER_API_KEY", label: "OpenRouter API key", secret: true },
    { k: "NIGHTSHIFT_MODEL", label: "Model", hint: "anthropic/claude-sonnet-5.5" },
  ] },
  { title: "Alerts", note: "A Telegram bot tells you when something breaks in live mode. Create one with @BotFather; get your chat id from @userinfobot.", fields: [
    { k: "TELEGRAM_BOT_TOKEN", label: "Bot token", secret: true },
    { k: "TELEGRAM_CHAT_ID", label: "Alert chats (comma separated)", hint: "-100…, 123456789" },
    { k: "TELEGRAM_ADMIN_IDS", label: "Admins who may send commands (user ids)", hint: "123456789" },
  ] },
  { title: "Platform token", note: "Optional. Holders pay no platform fee and are featured in the market. Fees buy the token back.", fields: [
    { k: "TOKEN_ADDRESS", label: "Token address (Ethereum)", hint: "0x…" },
    { k: "TOKEN_SYMBOL", label: "Symbol", hint: "OCTO" },
    { k: "TOKEN_HOLDER_MIN", label: "Holder minimum (tokens)", hint: "10000" },
    { k: "TOKEN_BUY_URL", label: "Where to buy it", hint: "https://app.uniswap.org/…" },
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
