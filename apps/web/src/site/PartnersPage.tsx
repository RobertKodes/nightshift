import { useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, getAddress } from "viem";
import { chooseSolana, chooseWallet } from "../wallet";
import { SectionIcon } from "./SectionIcon";
import "./partners.css";

type Chain = "ethereum" | "base" | "arbitrum" | "bnb" | "polygon" | "optimism" | "avalanche" | "robinhood" | "solana" | "other";
const CHAINS: [Chain, string, number | null][] = [["ethereum", "Ethereum", 1], ["base", "Base", 8453], ["arbitrum", "Arbitrum", 42161], ["bnb", "BNB Chain", 56], ["polygon", "Polygon", 137], ["optimism", "Optimism", 10], ["avalanche", "Avalanche", 43114], ["robinhood", "Robinhood Chain", 4663], ["solana", "Solana", null], ["other", "Another chain", null]];
type Partner = { id: string; name: string; about: string; website: string; x: string; telegram: string; docs: string | null; token: { chain: Chain; chainName: string; address: string }; symbol: string | null; image: string | null; chart: string | null; since: number };
type Status = { id: string; status: "pending" | "accepted" | "declined"; project: string; at: number; decidedAt: number | null; note: string | null };
const KEY = "ns-partner-application";
/** The same choices the server accepts (partners.ts WANTS). */
const WANTS: [string, string][] = [["badge", "Partner badge across NIGHTSHIFT"], ["deals", "Token Deals listings, when they open"], ["swap", "Their token in our swap"], ["watchtower", "Watchtower monitoring for holders"], ["agents", "Their token in our AI agent tools"], ["games", "Prizes and events in the games"], ["companies", "Work with our AI companies"]];
const BENEFITS = [
  { title: "Partner badge", line: "Your token carries the NIGHTSHIFT partner badge on our pages and in search." },
  { title: "Announced to our community", line: "We announce every new partner in our Telegram and on X." },
  { title: "Safety for your holders", line: "Watchtower monitoring and safety checks for your token, shown to buyers." },
  { title: "In our tools", line: "Your token in our swap, our AI agent tools, game prizes and, when they open, Token Deals." },
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
  const [f, setF] = useState({ chain: "ethereum" as Chain, token: "", chainName: "", project: "", website: "", x: "", telegram: "", docs: "", about: "", contact: "", post: "" });
  const [picked, setPicked] = useState<string[]>(["badge"]), [busy, setBusy] = useState(""), [applying, setApplying] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState<Status | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));
  useEffect(() => {
    document.title = "Partner with NIGHTSHIFT";
    void read<{ partners: Partner[] }>("/api/partners").then((d) => setPartners(d.partners)).catch(() => setPartners([]));
    let saved: string | null = null; try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
    if (saved && /^[a-f0-9]{12}$/.test(saved)) void read<Status>(`/api/partners/status/${saved}`).then(setStatus).catch(() => {});
  }, []);
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
      try { localStorage.setItem(KEY, r.id); } catch { /* private mode */ }
      setStatus({ id: r.id, status: "pending", project: f.project, at: Date.now(), decidedAt: null, note: null });
      scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message.split("\n")[0] ?? "That did not work. Try again.");
    } finally { setBusy(""); }
  }

  const openForm = () => { setApplying(true); window.setTimeout(() => document.getElementById("pv-pt-apply-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); };

  return <div className="pv-partners">
    <section className="pv-pt-hero">
      <div className="pv-pt-hero-copy">
        <p className="pv-kicker">$SHIFT<span>ECOSYSTEM</span><span>PARTNERS</span></p>
        <h1>Bring your token <span className="pv-hl">to the night shift.</span></h1>
        <p>Partners get in front of NIGHTSHIFT holders, carry a partner badge on Token Deals and in our tools, and get announced to the whole community. Joining is free.</p>
        <div className="pv-pt-cta">
          <button type="button" className="pv-button pv-primary" onClick={openForm}>Apply now<SectionIcon id="arrow" /></button>
          <a className="pv-button" href="#pv-pt-get">What partners get</a>
        </div>
        <ul className="pv-pt-proof"><li>Free to join</li><li>Any chain</li><li>Reviewed by hand</li></ul>
      </div>
      <div className="pv-pt-hero-art" aria-hidden="true">
        <img src="/art/frog3d/partners-frog.webp" alt="" width="600" height="893" />
        <div className="pv-pt-float" data-slot="0"><b>New partner 🤝</b><span>Announced to the NIGHTSHIFT community on Telegram and X</span></div>
        <div className="pv-pt-float" data-slot="1"><em>PARTNER</em><b>Your token</b><span>Badge on every deal and in search</span></div>
      </div>
    </section>

    {status && <section className="pv-pt-status" data-state={status.status} aria-live="polite">
      <b>{status.status === "pending" ? "Application received" : status.status === "accepted" ? "You are a NIGHTSHIFT partner" : "Application declined"}</b>
      <p>{status.status === "pending" ? `${status.project} is in our review list (reference ${status.id}). We check every application by hand and announce new partners in our community.` : status.status === "accepted" ? `${status.project} was accepted. Welcome aboard.` : `${status.project} was not accepted this time${status.note ? `: ${status.note}` : ""}. You can apply again after 7 days.`}</p>
    </section>}

    <section aria-labelledby="pv-pt-list"><h2 id="pv-pt-list">Our partners</h2>
      {partners?.length ? <div className="pv-pt-partners">{partners.map((p) => <article key={p.id} className="pv-pt-partner">
        <div className="pv-pt-partner-head">{p.image ? <img src={p.image} alt="" width="40" height="40" loading="lazy" referrerPolicy="no-referrer" /> : <i aria-hidden="true">{p.name.slice(0, 1)}</i>}<div><b>{p.name}</b><span>{p.symbol ? `$${p.symbol} · ` : ""}{p.token.chainName}</span></div><em>PARTNER</em></div>
        <p>{p.about}</p>
        <code title={p.token.address}>{short(p.token.address)}</code>
        <nav><a href={p.website} target="_blank" rel="noreferrer">Website</a><a href={p.x} target="_blank" rel="noreferrer">X</a><a href={p.telegram} target="_blank" rel="noreferrer">Telegram</a>{p.chart && <a href={p.chart} target="_blank" rel="noreferrer">Chart</a>}</nav>
      </article>)}</div>
        : <div className="pv-pt-partners">{[1, 2, 3].map((n) => <button key={n} type="button" className="pv-pt-slot" onClick={openForm}><i aria-hidden="true">+</i><b>Your project here</b><span>Be one of the first NIGHTSHIFT partners.</span></button>)}</div>}
    </section>

    <section aria-labelledby="pv-pt-get"><h2 id="pv-pt-get">What partners get</h2>
      <div className="pv-pt-grid">{BENEFITS.map((b) => <div key={b.title} className="pv-pt-card"><b>{b.title}</b><p>{b.line}</p></div>)}</div>
    </section>

    <section className="pv-pt-holders">
      <div><p className="pv-kicker">FOR HOLDERS</p><h2>More partners, more deals, more burn.</h2><p>Every partner token brings new deals to Token Deals. Every deal pays a fee to the FeeSplitter: 40% to $SHIFT stakers and NIGHT FROGS holders, 20% burned.</p></div>
      <a className="pv-button" href="/deals">See Token Deals<SectionIcon id="arrow" /></a>
    </section>

    <section className="pv-pt-steps" aria-labelledby="pv-pt-how"><h2 id="pv-pt-how">How to join</h2><ol>
      <li><b>Fill in the form</b><span>Your token, your links and what you would like from the partnership.</span></li>
      <li><b>Sign with your wallet</b><span>The wallet that deployed or owns the token proves it is yours. It signs a message only: no transaction, no fee.</span></li>
      <li><b>Post that you applied</b><span>One public post on X or your Telegram channel, then paste its link here.</span></li>
      <li><b>We review and announce</b><span>We check the token and the project. When we accept, we announce you as an official partner.</span></li>
    </ol></section>

    {!applying ? <section className="pv-pt-open"><b>Ready?</b><p>The form takes about five minutes. Have your token address, your links and your project wallet at hand.</p><button type="button" className="pv-button pv-primary" onClick={openForm}>Apply now<SectionIcon id="arrow" /></button></section>
      : <section className="pv-pt-form" id="pv-pt-apply-form" aria-labelledby="pv-pt-apply">
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
        <div className="pv-pt-actions"><a className="pv-button" href={`https://x.com/intent/post?text=${encodeURIComponent(postText)}`} target="_blank" rel="noreferrer">Post on X<SectionIcon id="arrow" /></a><button type="button" className="pv-button" onClick={() => void navigator.clipboard?.writeText(postText)}>Copy the text</button></div>
        <label className="pv-pt-wide">Link to your post<input value={f.post} onChange={set("post")} placeholder="https://x.com/yourproject/status/… or https://t.me/yourchannel/123" inputMode="url" /></label>
      </fieldset>
      {error && <p className="pv-pt-error" role="alert">{error}</p>}
      <div className="pv-pt-submit">
        <button type="button" className="pv-button pv-primary" disabled={!!busy || status?.status === "pending"} onClick={() => void apply()}>{busy || (f.chain === "other" ? "Send the application" : "Sign with your wallet and apply")}</button>
        <p>{f.chain === "other" ? "Tokens on other chains are checked by hand." : "The wallet signs a message only. No transaction, no fee."}</p>
      </div>
    </section>}
  </div>;
}
