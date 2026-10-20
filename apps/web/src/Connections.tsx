import { useState } from "react";
import { type ChannelKind, type ConnEntry, type DeskChannel, type DeskCompany, type DeskPost, type PostPreview, ago, api, usd } from "./api";
import { NxIcon } from "./nx/icons";
import { safeHref } from "./safe";

/** Each platform's mark: a small square in its own colour, its initial on it. */
const MARK: Record<string, string> = { bluesky: "B", telegram: "T", mastodon: "M", discord: "D", gumroad: "G" };
export function Mark({ kind }: { kind: string }) {
  return <span className={`cx-mark ${kind}`} aria-hidden="true">{MARK[kind] ?? "·"}</span>;
}
export const CHANNEL: Record<string, string> = { bluesky: "Bluesky", telegram: "Telegram", mastodon: "Mastodon", discord: "Discord", gumroad: "Gumroad" };
export const RESULT: Record<ConnEntry["result"], string> = { ok: "done", failed: "failed", waiting: "waiting", blocked: "blocked", sim: "simulated" };

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

type Act = (key: string, fn: () => Promise<unknown>, done?: string) => Promise<void>;

/**
 * The Connections tab: accounts the owner made (Gumroad to sell; Bluesky, a Telegram channel,
 * Mastodon and a Discord webhook to post), what waits for the owner, each channel's rules, the
 * quiet hours and everything done through them. The CEO never makes an account, follows, likes,
 * replies, sends direct messages or scrapes; every post says an AI agent wrote it.
 */
export function Connections({ c, say, onSaved, onReplay }: { c: DeskCompany; say: (m: string) => void; onSaved: () => Promise<void> | void; onReplay: (task: string) => void }) {
  const x = c.connections;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act: Act = async (key, fn, done) => {
    setBusy(key); setError(null);
    try { await fn(); await onSaved(); if (done) say(done); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  /** OAuth (Gumroad, Mastodon): the owner goes to the platform and comes back to this tab. */
  const go = async (key: string, fn: () => Promise<{ url?: string }>) => {
    setBusy(key); setError(null);
    try { const r = await fn(); if (r.url) location.assign(r.url); } catch (e) { setError((e as Error).message); setBusy(null); }
  };
  const asks = x.approvals.length + x.gumroad.approvals.length;
  return (
    <div className="dk-form cx">
      <p className="dk-hint">Accounts you made yourself, connected here. {c.name}'s CEO uses them only inside the rules below: it never makes an account, follows, likes, replies, sends a direct message or scrapes anything, and every post says an AI agent wrote it. Posts are about real events only (a new product, a sales milestone the books passed, an update, a shift replay), never numbers it made up.</p>
      {x.sim && <p className="dk-note">Simulation: connections are not checked with the platforms, and nothing is posted or listed. In live mode they are real.</p>}
      {error && <p className="warn" style={{ margin: 0 }}>{error}</p>}

      {asks > 0 && (
        <section className="cx-sec">
          <h4 className="dk-sub">Waiting for you · {asks}</h4>
          {x.approvals.map((p) => <PostAsk key={p.id} c={c} p={p} busy={busy} act={act} />)}
          {x.gumroad.approvals.map((g) => (
            <div key={g.productId} className="cx-ask">
              <div className="cx-head"><Mark kind="gumroad" /><b>Publish "{g.product}" on Gumroad?</b></div>
              <p className="dk-hint">It is a draft on your Gumroad account now, at {usd(g.priceUsd)}{g.file ? ", with its file" : ", its file still uploading"}. Publishing puts it on sale there; its sales are paid to your Gumroad account. You approve this once per product.</p>
              <div className="dk-row">
                <button className="nx-btn nx-btn-acc" disabled={busy !== null || !g.file} onClick={() => void act(`gy:${g.productId}`, () => api.gumroadApprove(c.id, g.productId), "Approved: it goes on sale on Gumroad in a moment.")}>Publish it</button>
                <button className="nx-btn" disabled={busy !== null} onClick={() => void act(`gn:${g.productId}`, () => api.gumroadDecline(c.id, g.productId), "It stays a draft on Gumroad.")}>Not now</button>
                {g.url && <a className="dk-link" href={safeHref(g.url)} target="_blank" rel="noreferrer">See the draft <NxIcon name="external" size={13} /></a>}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="cx-sec">
        <h4 className="dk-sub">Sell on Gumroad</h4>
        <Gumroad c={c} busy={busy} act={act} go={go} onReplay={onReplay} />
      </section>

      <section className="cx-sec">
        <h4 className="dk-sub">Post</h4>
        {x.channels.map((ch) => <Channel key={ch.kind} c={c} ch={ch} busy={busy} act={act} go={go} />)}
      </section>

      <section className="cx-sec">
        <h4 className="dk-sub">Quiet hours</h4>
        <Quiet c={c} busy={busy} act={act} />
      </section>

      {(x.queued.length > 0 || x.recent.length > 0) && (
        <section className="cx-sec">
          <h4 className="dk-sub">Posts</h4>
          <ul className="cx-list">
            {[...x.queued, ...x.recent].map((p) => (
              <li key={p.id}>
                <Mark kind={p.channel} />
                <span className="cx-what"><b>{p.about}</b>{p.wait && <small>{p.status === "queued" ? `Waits: ${p.wait}` : p.wait}</small>}{p.error && <small className="bad">{p.error}</small>}</span>
                <span className={`dk-st ${p.sim ? "sim" : p.status}`}>{p.sim ? "simulated" : p.status}</span>
                <span className="faint">{ago(p.sentAt ?? p.at)}</span>
                {p.url && <a className="dk-link" href={safeHref(p.url)} target="_blank" rel="noreferrer">open <NxIcon name="external" size={12} /></a>}
                {p.taskId && <button className="dk-link" onClick={() => onReplay(p.taskId!)}>shift</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cx-sec">
        <h4 className="dk-sub">Log</h4>
        {x.log.length === 0 ? <p className="dim dk-hint">Nothing yet. Every connection, post, Gumroad step and approval is written here, with how it went.</p> : (
          <ul className="cx-list cx-log">
            {x.log.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <Mark kind={e.channel} />
                <span className="cx-what"><b>{e.what}</b>{e.detail && <small>{e.detail}</small>}</span>
                <span className={`dk-st ${e.result}`}>{RESULT[e.result]}</span>
                <span className="faint">{ago(e.at)}</span>
                {e.url && <a className="dk-link" href={safeHref(e.url)} target="_blank" rel="noreferrer">open <NxIcon name="external" size={12} /></a>}
                {e.taskId && <button className="dk-link" onClick={() => onReplay(e.taskId!)}>shift</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One post the owner decides on: the exact words, on which channel, and why it waits. */
export function PostAsk({ c, p, busy, act, compact }: { c: { id: string; name: string }; p: DeskPost; busy: string | null; act: Act; compact?: boolean }) {
  return (
    <div className="cx-ask">
      <div className="cx-head"><Mark kind={p.channel} /><b>{compact ? `${c.name} wants to post on ${CHANNEL[p.channel]}` : `A post for ${CHANNEL[p.channel]}`}</b><span className="faint">{p.about}</span></div>
      <p className="cx-text">{p.text}</p>
      <div className="dk-row">
        <button className="nx-btn nx-btn-acc" disabled={busy !== null} onClick={() => void act(`py:${p.id}`, () => api.approvePost(c.id, p.id), "Approved. It goes out within the daily cap, outside quiet hours.")}>Approve the post</button>
        <button className="nx-btn" disabled={busy !== null} onClick={() => void act(`pn:${p.id}`, () => api.rejectPost(c.id, p.id), "Turned down. It is not posted.")}>Decline</button>
        {p.wait && <span className="faint">Why it waits: {p.wait}.</span>}
      </div>
    </div>
  );
}

function Gumroad({ c, busy, act, go, onReplay }: { c: DeskCompany; busy: string | null; act: Act; go: (k: string, fn: () => Promise<{ url?: string }>) => Promise<void>; onReplay: (t: string) => void }) {
  const g = c.connections.gumroad;
  const a = g.account;
  return (
    <div className={`cx-card ${a ? "on" : ""}`}>
      <div className="cx-head"><Mark kind="gumroad" /><b>Gumroad</b><span className={`dk-st ${a ? (a.sim ? "sim" : "live") : ""}`}>{a ? (a.sim ? "simulated" : "connected") : "not connected"}</span></div>
      {!g.available ? <p className="dk-hint">Gumroad is not set up on this engine yet: its operator registers NIGHTSHIFT's Gumroad app on /setup.</p> : !a ? (
        <>
          <p className="dk-hint">Sell {c.name}'s products to people on Gumroad too, from your own Gumroad account. Each product is made there as a <b>draft</b> (name, price, a description that says an AI agent made it, the file, a cover), kept in step with NIGHTSHIFT, and published only when you say yes. Products Gumroad prohibits (crypto and NFTs, resale rights, consulting, AI services used outside Gumroad) are never listed.</p>
          <ol className="cx-steps">
            <li>Make your Gumroad account yourself, confirm its email and set up payouts (Gumroad needs both to publish).</li>
            <li>Connect it: Gumroad asks you to allow NIGHTSHIFT to edit products and read sales and payouts. Nothing else.</li>
          </ol>
          <div className="dk-row"><button className="nx-btn nx-btn-acc" disabled={busy !== null} onClick={() => void go("gumroad", () => api.gumroadConnect(c.id))}><Mark kind="gumroad" />Connect Gumroad</button></div>
        </>
      ) : (
        <>
          <div className="cx-acct">{a.url ? <a href={safeHref(a.url)} target="_blank" rel="noreferrer">{a.name}</a> : <span>{a.name}</span>}<span>connected {ago(a.connectedAt)}</span><span>{a.webhooks ? "sales by webhook, checked every 10 min" : "sales checked every 10 min"}</span></div>
          <p className="dk-hint">Money from Gumroad is paid to your Gumroad account (to your bank or PayPal, after Gumroad's fees), never to the company wallet. It is booked apart from USDC, in USD.</p>
          {g.listings.length === 0 ? <p className="dim dk-hint">{g.next ? `${g.next} product${g.next === 1 ? "" : "s"} will be made there as drafts in a moment.` : "Nothing yet: each product the company puts on sale is made there as a draft."}</p> : (
            <ul className="cx-list">
              {g.listings.map((l) => (
                <li key={l.productId}>
                  <span className="cx-what"><b>{l.product}</b><small>{l.blocked ?? `${usd(l.priceUsd)} · ${l.file ? "file uploaded" : "file pending"}${l.cover ? " · cover" : ""}${l.sales ? ` · ${l.sales} sold, ${usd(l.revenueUsd)}` : ""}${l.declined ? " · you said not now" : ""}`}</small>{l.error && <small className="bad">{l.error}</small>}</span>
                  <span className={`dk-st ${l.blocked ? "blocked" : l.sim ? "sim" : l.state ?? ""}`}>{l.blocked ? "never listed" : l.state === "published" ? "on sale" : l.state ?? ""}</span>
                  {l.url && !l.blocked && <a className="dk-link" href={safeHref(l.url)} target="_blank" rel="noreferrer">open <NxIcon name="external" size={12} /></a>}
                  {l.declined && l.state === "draft" && <button className="dk-link" disabled={busy !== null} onClick={() => void act(`gy:${l.productId}`, () => api.gumroadApprove(c.id, l.productId), "Approved: it goes on sale on Gumroad in a moment.")}>publish</button>}
                  <button className="dk-link" onClick={() => onReplay(l.taskId)}>shift</button>
                </li>
              ))}
            </ul>
          )}
          <div className="dk-row"><button className="nx-btn" disabled={busy !== null} onClick={() => void act("gumroad-off", () => api.gumroadDisconnect(c.id), "Gumroad disconnected. Revoke NIGHTSHIFT in Gumroad → Settings → Advanced → Applications too.")}>Disconnect</button><span className="faint">The products stay on your Gumroad account.</span></div>
        </>
      )}
    </div>
  );
}

const HOW: Record<ChannelKind, string> = {
  bluesky: "Posts with Bluesky's bot label on the account, as Bluesky asks bots to.",
  telegram: "Posts in your own channel, as the NIGHTSHIFT bot.",
  mastodon: "Posts public, with the account marked as automated (a bot).",
  discord: "Posts in one channel through its webhook, and never pings anyone.",
};

/** One channel: connect it (each the way its platform wants), its rules, a test post, its last action. */
function Channel({ c, ch, busy, act, go }: { c: DeskCompany; ch: DeskChannel; busy: string | null; act: Act; go: (k: string, fn: () => Promise<{ url?: string }>) => Promise<void> }) {
  const a = ch.account;
  const [f, setF] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PostPreview | null>(null);
  const [perr, setPerr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const connect = (body: Record<string, string>) => void act(`connect:${ch.kind}`, async () => { await api.connectChannel(c.id, ch.kind, body); setF({}); }, `${ch.name} connected. Its first post waits for you.`);
  const test = async () => { setPerr(null); try { setPreview(await api.testPost(c.id, ch.kind)); } catch (e) { setPerr((e as Error).message); } };
  const rules = (p: Parameters<typeof api.channelSettings>[2], done: string) => void act(`rules:${ch.kind}`, () => api.channelSettings(c.id, ch.kind, p), done);
  return (
    <div className={`cx-card ${a ? (a.paused ? "paused" : "on") : ""}`}>
      <div className="cx-head"><Mark kind={ch.kind} /><b>{ch.kind === "telegram" ? "Telegram channel" : ch.name}</b><span className={`dk-st ${a ? (a.paused ? "paused" : a.sim ? "sim" : "live") : ""}`}>{a ? (a.paused ? "paused" : a.sim ? "simulated" : "connected") : "not connected"}</span></div>
      {!ch.available ? <p className="dk-hint">Telegram channels need the NIGHTSHIFT bot, which is not set up on this engine.</p> : a ? (
        <>
          <div className="cx-acct">{a.url ? <a href={safeHref(a.url)} target="_blank" rel="noreferrer">{a.label}</a> : <span>{a.label}</span>}<span>{a.today} of {a.dailyMax} today</span>{a.botFlag && <span>bot label on</span>}<span>{a.trusted ? (a.approveEach ? "you approve each post" : "posts go out on their own") : "first post waits for you"}</span></div>
          <p className="dk-hint">{HOW[ch.kind]}</p>
          {a.paused && <div className="dk-warnbox"><b>Paused {ago(a.paused.at)}: the platform pushed back.</b><span>{a.paused.why}</span><button className="nx-btn" disabled={busy !== null} onClick={() => rules({ resume: true }, `${ch.name} resumed.`)}>Resume posting</button></div>}
          <div className="cx-rules">
            <label className="dk-toggle"><input type="checkbox" checked={a.approveEach} disabled={busy !== null} onChange={(e) => rules({ approveEach: e.target.checked }, e.target.checked ? "Every post waits for you now." : "Posts go out on their own after the first one you approve.")} /> Ask me before every post</label>
            <label className="dk-toggle"><input type="checkbox" checked={a.listed} disabled={busy !== null} onChange={(e) => rules({ listed: e.target.checked }, e.target.checked ? "Shown on the company page." : "Not shown on the company page.")} /> Show on the company page</label>
            {ch.max > 1 && <label className="cx-num">Posts a day<select className="field" value={a.dailyMax} disabled={busy !== null} onChange={(e) => rules({ dailyMax: Number(e.target.value) }, "Daily cap saved.")}>{Array.from({ length: ch.max }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
          </div>
          <div className="dk-row">
            <button className="nx-btn" onClick={() => void test()}><NxIcon name="play" size={14} />Test post (dry run)</button>
            <button className="nx-btn" disabled={busy !== null} onClick={() => void act(`off:${ch.kind}`, () => api.disconnectChannel(c.id, ch.kind), `${ch.name} disconnected.`)}>Disconnect</button>
          </div>
          {perr && <p className="dk-hint bad">{perr}</p>}
          {preview && <Preview v={preview} onClose={() => setPreview(null)} />}
          {ch.last && <p className="faint cx-last">Last: {ch.last.what} · {RESULT[ch.last.result]} · {ago(ch.last.at)}</p>}
        </>
      ) : ch.kind === "bluesky" ? (
        <form className="cx-form" onSubmit={(e) => { e.preventDefault(); connect({ handle: f.handle ?? "", appPassword: f.pw ?? "" }); }}>
          <p className="dk-hint">{HOW.bluesky} Use an <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noreferrer">app password</a> (Settings → Privacy and security → App passwords), never your account password.</p>
          <div className="dk-two">
            <input className="field" placeholder="you.bsky.social" value={f.handle ?? ""} onChange={set("handle")} autoComplete="off" aria-label="Bluesky handle" />
            <input className="field mono" type="password" placeholder="xxxx-xxxx-xxxx-xxxx" value={f.pw ?? ""} onChange={set("pw")} autoComplete="off" aria-label="App password" />
          </div>
          <button className="nx-btn nx-btn-acc" disabled={busy !== null || !f.handle || !f.pw}>Connect Bluesky</button>
        </form>
      ) : ch.kind === "telegram" ? (
        <form className="cx-form" onSubmit={(e) => { e.preventDefault(); connect({ chat: f.chat ?? "" }); }}>
          <ol className="cx-steps">
            <li>Make a Telegram channel yourself.</li>
            <li>Add <b>@{ch.bot ?? "nightshiftimdbot"}</b> to its admins, with only "Post messages".</li>
            <li className={c.connections.alertsLinked ? "done" : ""}>{c.connections.alertsLinked ? "Alerts are on in your private chat with the bot: it knows your Telegram account." : "Turn on alerts (the Alerts tab) in a private chat with the bot, so it can check the channel is yours."}</li>
          </ol>
          <input className="field" placeholder="@yourchannel or t.me/yourchannel" value={f.chat ?? ""} onChange={set("chat")} autoComplete="off" aria-label="Telegram channel" />
          <button className="nx-btn nx-btn-acc" disabled={busy !== null || !f.chat}>Check and connect</button>
        </form>
      ) : ch.kind === "mastodon" ? (
        <form className="cx-form" onSubmit={(e) => { e.preventDefault(); void go("connect:mastodon", () => api.connectChannel(c.id, "mastodon", { instance: f.instance ?? "" })); }}>
          <p className="dk-hint">{HOW.mastodon} NIGHTSHIFT registers itself on your server, then your server asks you to allow it: posting, and reading and marking your account. Pick a server whose rules allow bots.</p>
          <input className="field" placeholder="mastodon.social" value={f.instance ?? ""} onChange={set("instance")} autoComplete="off" aria-label="Mastodon server" />
          <button className="nx-btn nx-btn-acc" disabled={busy !== null || !f.instance}>Connect on your server</button>
        </form>
      ) : (
        <form className="cx-form" onSubmit={(e) => { e.preventDefault(); connect({ url: f.url ?? "" }); }}>
          <p className="dk-hint">{HOW.discord} In your server: Server Settings → Integrations → Webhooks → New Webhook, pick the channel, Copy Webhook URL. The URL is kept encrypted.</p>
          <input className="field mono" type="password" placeholder="https://discord.com/api/webhooks/…" value={f.url ?? ""} onChange={set("url")} autoComplete="off" aria-label="Discord webhook URL" />
          <button className="nx-btn nx-btn-acc" disabled={busy !== null || !f.url}>Connect Discord</button>
        </form>
      )}
    </div>
  );
}

/** A dry run: the post as the channel would get it now, its length, the request (secrets left out), and whether it would wait. */
function Preview({ v, onClose }: { v: PostPreview; onClose: () => void }) {
  return (
    <div className="cx-preview">
      <div className="cx-head"><b>Test post · nothing was sent</b><span className="faint">{v.chars}/{v.limit} characters</span><button className="dk-link" onClick={onClose}>close</button></div>
      {v.sample && <p className="dk-hint">No real event to post right now: this sample only shows the format.</p>}
      <p className="cx-text">{v.text}</p>
      <p className="dk-hint">{v.wait ? `It would wait: ${v.wait}.` : "It would go out now."} About: {v.about}.</p>
      <details><summary className="dk-hint">The request</summary><pre className="cx-req">{`${v.request.method} ${v.request.url}\n${JSON.stringify(v.request.body, null, 2)}`}</pre></details>
    </div>
  );
}

function Quiet({ c, busy, act }: { c: DeskCompany; busy: string | null; act: Act }) {
  const q = c.connections.quiet;
  const [from, setFrom] = useState(q.from);
  const [to, setTo] = useState(q.to);
  const tz = browserTz();
  const changed = from !== q.from || to !== q.to || tz !== q.tz;
  return (
    <form className="cx-card" onSubmit={(e) => { e.preventDefault(); void act("quiet", () => api.quiet(c.id, { from, to, tz }), from === to ? "Quiet hours off." : `Quiet from ${hh(from)} to ${hh(to)}.`); }}>
      <p className="dk-hint">No post goes out between these hours, in your time zone. {from === to ? "Same start and end: quiet hours are off." : ""}</p>
      <div className="cx-rules">
        <label className="cx-num">From<select className="field" value={from} onChange={(e) => setFrom(Number(e.target.value))}>{HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select></label>
        <label className="cx-num">To<select className="field" value={to} onChange={(e) => setTo(Number(e.target.value))}>{HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select></label>
        <span className="faint">{tz}{q.tz !== tz ? ` (saved as ${q.tz})` : ""}</span>
        <button className="nx-btn" disabled={busy !== null || !changed}>Save</button>
      </div>
    </form>
  );
}
