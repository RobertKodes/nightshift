import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, getAddress } from "viem";
import { chooseSolana, chooseWallet } from "../wallet";
import { NxIcon } from "../nx/icons";
import { Stat } from "../station/Station";
import { SectionIcon } from "./SectionIcon";
import "../forge.css";
import "./partners.css";

type Chain = "ethereum" | "base" | "arbitrum" | "bnb" | "polygon" | "optimism" | "avalanche" | "robinhood" | "solana" | "other";
const CHAINS: [Chain, string, number | null][] = [["ethereum", "Ethereum", 1], ["base", "Base", 8453], ["arbitrum", "Arbitrum", 42161], ["bnb", "BNB Chain", 56], ["polygon", "Polygon", 137], ["optimism", "Optimism", 10], ["avalanche", "Avalanche", 43114], ["robinhood", "Robinhood Chain", 4663], ["solana", "Solana", null], ["other", "Another chain", null]];
type Partner = { id: string; name: string; about: string; website: string; x: string; telegram: string; docs: string | null; token: { chain: Chain; chainName: string; address: string }; symbol: string | null; image: string | null; chart: string | null; since: number };
type Status = { id: string; status: "pending" | "accepted" | "declined"; project: string; at: number; decidedAt: number | null; note: string | null };
const KEY = "ns-partner-application";
const DRAFT = "ns-partner-draft";
const BLANK = { chain: "ethereum" as Chain, token: "", chainName: "", project: "", website: "", x: "", telegram: "", docs: "", about: "", contact: "", post: "" };
/** The form as it was typed: a phone that reloads the page on the way back from "Post on X" brings it all back. */
function draft(): { f: Partial<typeof BLANK>; picked: string[] } | null {
  try { const d = JSON.parse(localStorage.getItem(DRAFT) ?? "null") as { f?: Partial<typeof BLANK>; picked?: unknown } | null; return d?.f ? { f: d.f, picked: Array.isArray(d.picked) ? d.picked.map(String) : ["badge"] } : null; } catch { return null; }
}
/** The same choices the server accepts (partners.ts WANTS). */
const WANTS: [string, string][] = [["badge", "Partner badge across NIGHTSHIFT"], ["deals", "Token Deals listings, when they open"], ["swap", "Their token in our swap"], ["watchtower", "Watchtower monitoring for holders"], ["agents", "Their token in our AI agent tools"], ["games", "Prizes and events in the games"], ["companies", "Work with our AI companies"]];
/** The hero card: what a partner gets, for the chain the visitor picks. */
const PASS = [
  { name: "Ethereum", short: "ETH", line: "Ethereum", tone: "#8fb7c8" },
  { name: "Base", short: "BASE", line: "Base", tone: "#7fa8ff" },
  { name: "Solana", short: "SOL", line: "Solana", tone: "#b48cf2" },
  { name: "Robinhood Chain", short: "RH", line: "Robinhood", tone: "#7fd6a6" },
  { name: "Any other chain", short: "ANY", line: "other chains", tone: "#d9ad66" },
];
const PASS_PERKS = ["Partner badge on deals and in search", "Announced on Telegram and X", "Featured on Token Deals", "Token Verdict and Watchtower checks", "In our swap and AI agent tools"];
const PERKS: [Parameters<typeof NxIcon>[0]["name"], string, string][] = [
  ["crew", "Partner badge", "Your token carries the NIGHTSHIFT partner badge on our pages, in search and on every deal it has on Token Deals."],
  ["pulse", "Announced to our community", "We announce every new partner in our Telegram group and draft the post for X, so our holders meet your project."],
  ["market", "Featured on Token Deals", "Your token's deals carry the badge on the desk, and copycats of your ticker get flagged on their cards."],
  ["security", "Safety your holders can see", "Token Verdict and Watchtower monitoring for your token, shown to buyers before they buy."],
  ["agent", "In our tools", "Your token in our swap, our AI agent tools and game prizes, where it fits."],
  ["key", "Proof it is really you", "You sign with the wallet that deployed or owns the token, so nobody can apply in your name."],
];
const short = (a: string) => a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
const read = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(url, init), body = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? "The server did not answer. Try again.");
  return body;
};

/** Projects apply to join the ecosystem with their token: a form, a signature, a public post, then our review. */
export function PartnersPage() {
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [f, setF] = useState(() => ({ ...BLANK, ...draft()?.f }));
  const [picked, setPicked] = useState<string[]>(() => draft()?.picked ?? ["badge"]), [busy, setBusy] = useState(""), [applying, setApplying] = useState(() => !!draft()), [passChain, setPassChain] = useState(0), [error, setError] = useState(""), [status, setStatus] = useState<Status | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));
  useEffect(() => {
    document.title = "Partner with NIGHTSHIFT";
    void read<{ partners: Partner[] }>("/api/partners").then((d) => setPartners(d.partners)).catch(() => setPartners([]));
    let saved: string | null = null; try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
    if (saved && /^[a-f0-9]{12}$/.test(saved)) void read<Status>(`/api/partners/status/${saved}`).then(setStatus).catch(() => {});
    // back from posting with the form half done: straight back to it
    if (draft()) window.setTimeout(() => document.getElementById("pv-pt-apply-form")?.scrollIntoView({ block: "start" }), 300);
  }, []);
  useEffect(() => { if (applying) try { localStorage.setItem(DRAFT, JSON.stringify({ f, picked })); } catch { /* private mode */ } }, [f, picked, applying]);
  const chain = CHAINS.find(([k]) => k === f.chain)!;
  const postText = useMemo(() => `We applied to become an official partner of @nightshiftimd, the AI company station built on the IMD swarm 🌙\n\n${f.project || "Our project"} on ${f.chain === "other" ? f.chainName || "our chain" : chain[1]}\n\ngetnightshift.tech/partners`, [f.project, f.chain, f.chainName, chain]);

  async function apply() {
    setError(""); setBusy("Preparing…");
    try {
      const base = { chain: f.chain, token: f.token.trim(), chainName: f.chainName, project: f.project, website: f.website, x: f.x, telegram: f.telegram, docs: f.docs, about: f.about, contact: f.contact, post: f.post, wants: picked };
      let signed: Record<string, string> = {};
      if (f.chain === "solana") {
        setBusy("Connect your Solana wallet…");
        const sol = await chooseSolana();
        if (!sol) throw new Error("Connect a Solana wallet to sign.");
        const m = await read<{ message: string; issued: string; wallet: string }>(`/api/partners/message?${new URLSearchParams({ project: f.project, chain: f.chain, token: base.token, wallet: sol.address })}`);
        const signer = sol.wallet as unknown as { signMessage?: (m: Uint8Array) => Promise<Uint8Array | { signature: Uint8Array }> };
        if (!signer.signMessage) throw new Error("This Solana wallet cannot sign messages. Try Phantom or Solflare.");
        setBusy("Sign the message in your wallet…");
        const out = await signer.signMessage(new TextEncoder().encode(m.message)), bytes = out instanceof Uint8Array ? out : out.signature;
        signed = { wallet: m.wallet, issued: m.issued, message: m.message, signature: btoa(String.fromCharCode(...bytes)) };
      } else if (f.chain !== "other") {
        setBusy("Connect your wallet…");
        const wallet = createWalletClient({ transport: custom(await chooseWallet({ chain: chain[2] ?? 1 }) as never) });
        const [acct] = await wallet.requestAddresses();
        if (!acct) throw new Error("No wallet account was selected.");
        const m = await read<{ message: string; issued: string; wallet: string }>(`/api/partners/message?${new URLSearchParams({ project: f.project, chain: f.chain, token: base.token, wallet: acct })}`);
        setBusy("Sign the message in your wallet…");
        signed = { wallet: m.wallet, issued: m.issued, message: m.message, signature: await wallet.signMessage({ account: getAddress(acct), message: m.message }) };
      }
      setBusy("Sending your application…");
      const r = await read<{ id: string }>("/api/partners/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, ...signed }) });
      try { localStorage.setItem(KEY, r.id); localStorage.removeItem(DRAFT); } catch { /* private mode */ }
      setStatus({ id: r.id, status: "pending", project: f.project, at: Date.now(), decidedAt: null, note: null });
      scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message.split("\n")[0] ?? "That did not work. Try again.");
    } finally { setBusy(""); }
  }

  const openForm = () => { setApplying(true); window.setTimeout(() => document.getElementById("pv-pt-apply-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); };
  const pass = PASS[passChain]!;

  return <div className="st-room fg pt">
    <header className="fg-hero" style={{ "--tc": pass.tone } as CSSProperties}>
      <div className="fg-hero-in">
        <span className="fg-eyebrow"><NxIcon name="crew" size={16} /> $SHIFT · ECOSYSTEM · PARTNER PROGRAM</span>
        <h1>Partner with NIGHTSHIFT. <em>Bring your token aboard.</em></h1>
        <p className="fg-lead">Projects from any chain can join the NIGHTSHIFT ecosystem. Partners carry a badge across our pages and on Token Deals, get announced to our community and get a place in our tools. Applying is free: a short form, a signature from your project's wallet and one post saying you applied.</p>
        <div className="fg-cta">
          <button type="button" className="nx-btn nx-btn-acc" onClick={openForm}><NxIcon name="crew" size={18} /> Apply now</button>
          <a className="nx-btn" href="#get">What partners get</a>
          <a className="nx-btn" href="/deals">Token Deals</a>
        </div>
        <div className="st-stats">
          <Stat label="Partners" value={partners === null ? "—" : String(partners.length)} note={partners?.length ? "accepted and announced" : "the first places are open"} />
          <Stat label="Cost" value="FREE" note="no fee to apply or to stay" />
          <Stat label="Chains" value="ANY" note="EVM and Solana sign; others by hand" />
          <Stat label="Review" value="BY HAND" note="every application, then announced" />
        </div>
      </div>
      <div className="fg-show">
        <div className="pt-pass" aria-label="Partner pass example">
          <div className="pt-pass-in">
            <header><span>NIGHTSHIFT / PARTNER PASS</span><span>No. {String((partners?.length ?? 0) + 1).padStart(3, "0")}</span></header>
            <div className="pt-pass-name"><i>?</i><div><b>Your token</b><span>{pass.name}</span></div><em>PARTNER</em></div>
            <ul>{PASS_PERKS.map((p) => <li key={p}>{p}</li>)}</ul>
            <footer><span>OPEN FOR APPLICATIONS</span><span>FREE</span></footer>
          </div>
        </div>
        <div className="fg-pills pt-pills" role="group" aria-label="Your chain">{PASS.map((c, i) => <button key={c.name} type="button" className={i === passChain ? "on" : ""} aria-pressed={i === passChain} onClick={() => setPassChain(i)}><b>{c.short}</b><span>{c.line}</span></button>)}</div>
      </div>
    </header>

    <div className="st-body">
      {status && <section className="pv-pt-status fg-sec" data-state={status.status} aria-live="polite">
        <b>{status.status === "pending" ? "Application received" : status.status === "accepted" ? "You are a NIGHTSHIFT partner" : "Application declined"}</b>
        <p>{status.status === "pending" ? `${status.project} is in our review list (reference ${status.id}). We check every application by hand and announce new partners in our community.` : status.status === "accepted" ? `${status.project} was accepted. Welcome aboard.` : `${status.project} was not accepted this time${status.note ? `: ${status.note}` : ""}. You can apply again after 7 days.`}</p>
      </section>}

      <section className="fg-sec">
        <div className="fg-head"><span className="fg-kicker">The crew</span><h2>Our partners</h2></div>
        {partners?.length ? <div className="pv-pt-partners">{partners.map((p) => <article key={p.id} className="pv-pt-partner">
          <div className="pv-pt-partner-head">{p.image ? <img src={p.image} alt="" width="40" height="40" loading="lazy" referrerPolicy="no-referrer" /> : <i aria-hidden="true">{p.name.slice(0, 1)}</i>}<div><b>{p.name}</b><span>{p.symbol ? `$${p.symbol} · ` : ""}{p.token.chainName}</span></div><em>PARTNER</em></div>
          <p>{p.about}</p>
          <code title={p.token.address}>{short(p.token.address)}</code>
          <nav><a href={p.website} target="_blank" rel="noreferrer">Website</a><a href={p.x} target="_blank" rel="noreferrer">X</a><a href={p.telegram} target="_blank" rel="noreferrer">Telegram</a>{p.chart && <a href={p.chart} target="_blank" rel="noreferrer">Chart</a>}</nav>
        </article>)}</div>
          : <div className="pv-pt-partners">{[1, 2, 3].map((n) => <button key={n} type="button" className="pv-pt-slot" onClick={openForm}><i aria-hidden="true">+</i><b>Your project here</b><span>Be one of the first NIGHTSHIFT partners.</span></button>)}</div>}
      </section>

      <section className="fg-sec" id="get">
        <div className="fg-head"><span className="fg-kicker">What partners get</span><h2>A place in the ecosystem</h2></div>
        <div className="fg-perks">{PERKS.map(([icon, title, text]) => <article key={title} className="fg-perk"><NxIcon name={icon} size={22} /><b>{title}</b><p>{text}</p></article>)}</div>
      </section>

      <section className="fg-sec">
        <div className="fg-head"><span className="fg-kicker">How to join</span><h2>Four steps, about five minutes</h2></div>
        <ol className="fg-steps pt-steps">
          <li><b>Fill in the form</b><span>Your token, your links and what you would like from the partnership.</span></li>
          <li><b>Sign with your wallet</b><span>The wallet that deployed or owns the token proves it is yours. A message only: no transaction, no fee.</span></li>
          <li><b>Post that you applied</b><span>One public post on X or your Telegram channel, then paste its link in the form.</span></li>
          <li><b>We review and announce</b><span>We check the token and the project by hand. When we accept, we announce you as an official partner.</span></li>
        </ol>
      </section>

      <section className="fg-sec">
        <div className="pt-panel">
          <div className="fg-head"><span className="fg-kicker">For holders</span><h2>More partners, more deals, more burn</h2><p className="fg-dim">Every partner token brings new deals to Token Deals, and every deal pays a fee to the FeeSplitter: 40% to $SHIFT stakers and NIGHT FROGS holders, 20% burned.</p></div>
          <a className="nx-btn" href="/deals">See Token Deals</a>
        </div>
      </section>

      {!applying ? <section className="fg-sec"><div className="pt-panel"><div className="fg-head"><span className="fg-kicker">Apply</span><h2>Ready to come aboard?</h2><p className="fg-dim">The form takes about five minutes. Have your token address, your links and your project wallet at hand.</p></div><button type="button" className="nx-btn nx-btn-acc" onClick={openForm}><NxIcon name="crew" size={18} /> Apply now</button></div></section>
      : <section className="pv-pt-form fg-sec" id="pv-pt-apply-form" aria-labelledby="pv-pt-apply">
      <h2 id="pv-pt-apply">Apply</h2>
      <fieldset><legend>Your token</legend>
        <label>Chain<select value={f.chain} onChange={set("chain")}>{CHAINS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        {f.chain === "other" && <label>Chain name<input value={f.chainName} onChange={set("chainName")} placeholder="Sui, TON, Tron…" /></label>}
        <label className="pv-pt-wide">Token address<input value={f.token} onChange={set("token")} placeholder={f.chain === "solana" ? "Mint address" : f.chain === "other" ? "Address or identifier" : "0x…"} spellCheck={false} autoComplete="off" /></label>
      </fieldset>
      <fieldset><legend>Your project</legend>
        <label>Project name<input value={f.project} onChange={set("project")} maxLength={60} /></label>
        <label>Website<input value={f.website} onChange={set("website")} placeholder="https://" inputMode="url" /></label>
        <label>X account<input value={f.x} onChange={set("x")} placeholder="@yourproject" /></label>
        <label>Telegram<input value={f.telegram} onChange={set("telegram")} placeholder="t.me/yourgroup" /></label>
        <label>Docs or audit (optional)<input value={f.docs} onChange={set("docs")} placeholder="https://" inputMode="url" /></label>
        <label>Team contact<input value={f.contact} onChange={set("contact")} placeholder="Email or @telegram" /></label>
        <label className="pv-pt-wide">About the project<textarea value={f.about} onChange={set("about")} rows={4} maxLength={600} placeholder="What it does, who it is for, what is live today." /><small>{f.about.trim().length}/600</small></label>
      </fieldset>
      <fieldset><legend>What you would like</legend><div className="pv-pt-wants">{WANTS.map(([k, label]) => <label key={k} className="pv-pt-check"><input type="checkbox" checked={picked.includes(k)} onChange={(e) => setPicked((v) => e.target.checked ? [...v, k] : v.filter((x) => x !== k))} /><span>{label}</span></label>)}</div></fieldset>
      <fieldset><legend>Post that you applied</legend>
        <p className="pv-pt-note">Post this (or your own words) from your project's account, then paste the link to the post.</p>
        <pre className="pv-pt-post">{postText}</pre>
        <div className="pv-pt-actions"><a className="nx-btn" href={`https://x.com/intent/post?text=${encodeURIComponent(postText)}`} target="_blank" rel="noreferrer">Post on X<SectionIcon id="arrow" /></a><button type="button" className="nx-btn" onClick={() => void navigator.clipboard?.writeText(postText)}>Copy the text</button></div>
        <label className="pv-pt-wide">Link to your post<input value={f.post} onChange={set("post")} placeholder="https://x.com/yourproject/status/… or https://t.me/yourchannel/123" inputMode="url" /></label>
      </fieldset>
      {error && <p className="pv-pt-error" role="alert">{error}</p>}
      <div className="pv-pt-submit">
        <button type="button" className="nx-btn nx-btn-acc" disabled={!!busy || status?.status === "pending"} onClick={() => void apply()}>{busy || (f.chain === "other" ? "Send the application" : "Sign with your wallet and apply")}</button>
        <p>{f.chain === "other" ? "Tokens on other chains are checked by hand." : "The wallet signs a message only. No transaction, no fee."}</p>
      </div>
    </section>}

      <section className="fg-sec">
        <div className="fg-head"><span className="fg-kicker">Questions</span><h2>The fine print</h2></div>
        <div className="fg-faq">
          <details open><summary>Does it cost anything?</summary><p>No. Applying, being accepted and staying a partner are free. The only thing we ask is one public post saying you applied.</p></details>
          <details><summary>Which chains can apply?</summary><p>Any. Tokens on Ethereum, Base, Arbitrum, BNB Chain, Polygon, Optimism, Avalanche, Robinhood Chain and Solana sign with their wallet in the form; tokens on other chains are reviewed by hand.</p></details>
          <details><summary>Why sign with a wallet?</summary><p>So nobody can apply in your name. The wallet that deployed or owns the token signs a short message. It is not a transaction and costs nothing.</p></details>
          <details><summary>What do you check?</summary><p>Who controls the token, its market and liquidity, the links and the project itself. Safety checks run on the spot; a person reviews every application before anything is announced.</p></details>
          <details><summary>When do I hear back?</summary><p>Your status shows on this page in the browser you applied from. When we accept, we announce you in our community and you get the badge.</p></details>
        </div>
      </section>
    </div>
  </div>;
}
