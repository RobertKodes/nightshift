import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { type ChatAction, type ChatLine, type ChatView, type DeskCompany, api, ago, usd } from "./api";
import { NxIcon } from "./nx/icons";
import "./ceo-chat.css";

/** What to ask when the chat is new, or stuck. */
const ASKS = [
  "What should I do today to get a sale?",
  "Write this week's posts for me.",
  "What should we sell next, and at what price?",
  "Where do our buyers hang out?",
  "What should we buy from other companies?",
];

const PLACE: Record<string, string> = {
  x: "X", bluesky: "Bluesky", telegram: "Telegram", reddit: "Reddit", pinterest: "Pinterest", tiktok: "TikTok", instagram: "Instagram",
  linkedin: "LinkedIn", facebook: "Facebook", threads: "Threads", mastodon: "Mastodon", discord: "Discord", youtube: "YouTube",
};
const ACCOUNT: Record<string, string> = { gumroad: "Gumroad", bluesky: "Bluesky", telegram: "Telegram", mastodon: "Mastodon", discord: "Discord" };

/** Where a ready post opens: the network's own compose page with the text in it, or the site to paste it on. */
function composeUrl(where: string, text: string, page: string): string {
  const t = encodeURIComponent(text);
  switch (where) {
    case "x": return `https://x.com/intent/post?text=${t}`;
    case "bluesky": return `https://bsky.app/intent/compose?text=${t}`;
    case "threads": return `https://www.threads.net/intent/post?text=${t}`;
    case "telegram": return `https://t.me/share/url?url=${encodeURIComponent(page)}&text=${t}`;
    case "reddit": return `https://www.reddit.com/submit?title=${encodeURIComponent(text.slice(0, 300))}`;
    case "linkedin": return `https://www.linkedin.com/feed/?shareActive=true&text=${t}`;
    case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(page)}`;
    case "pinterest": return "https://www.pinterest.com/pin-builder/";
    case "tiktok": return "https://www.tiktok.com/upload";
    case "youtube": return "https://studio.youtube.com/";
    case "instagram": return "https://www.instagram.com/";
    case "discord": return "https://discord.com/app";
    default: return "https://joinmastodon.org/";
  }
}

/** The CEO writes plain text with a little markdown: lists and **bold** only, never HTML. */
function Words({ text }: { text: string }) {
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p.replace(/^#+\s*/, "")}</Fragment>);
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const item = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    const last = blocks.at(-1);
    if (item) { if (last?.list) last.lines.push(item[1]!); else blocks.push({ list: true, lines: [item[1]!] }); }
    else if (line.trim()) { if (last && !last.list) last.lines.push(line); else blocks.push({ list: false, lines: [line] }); }
    else blocks.push({ list: false, lines: [] });
  }
  return <>{blocks.filter((b) => b.lines.length).map((b, i) => b.list ? <ul key={i}>{b.lines.map((l, j) => <li key={j}>{bold(l)}</li>)}</ul> : <p key={i}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{bold(l)}</Fragment>)}</p>)}</>;
}

/**
 * The owner's chat with the CEO of one company. The CEO knows that company only and coaches the
 * owner to sales; under each answer it offers buttons (a swarm job, a buy from another company, a
 * post ready to paste, a to-do, an account to connect). Nothing is spent until the owner presses one.
 */
export function CeoChat({ c, swarmUsd, onTab, onSaved, onReplay, say }: { c: DeskCompany; swarmUsd: number; onTab: (tab: "connections" | "limits") => void; onSaved: () => Promise<void> | void; onReplay: (task: string) => void; say: (m: string) => void }) {
  const [view, setView] = useState<ChatView | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pressing, setPressing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const page = `${location.origin}/c/${c.slug}`;

  const load = useCallback(async () => {
    try { setView(await api.chat(c.id)); } catch (e) { setError((e as Error).message); }
  }, [c.id]);
  useEffect(() => { void load(); }, [load]);
  // only the chat scrolls to the newest line, never the drawer around it
  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [view?.lines.length, sending]);

  const send = async (msg: string) => {
    const m = msg.trim();
    if (!m || sending) return;
    setSending(true); setError(null); setText("");
    // the owner's line shows at once; the CEO's answer follows
    setView((v) => v && { ...v, lines: [...v.lines, { id: "pending", at: Date.now(), from: "owner", text: m }] });
    try {
      const r = await api.say(c.id, m);
      setView((v) => v && { ...v, lines: [...v.lines.filter((l) => l.id !== "pending"), ...r.lines] });
    } catch (e) {
      setError((e as Error).message);
      setText(m);
      setView((v) => v && { ...v, lines: v.lines.filter((l) => l.id !== "pending") });
    } finally { setSending(false); }
  };

  const press = async (line: ChatLine, a: ChatAction) => {
    if (a.type === "connect") { onTab("connections"); return; }
    setPressing(a.id); setError(null);
    try {
      const r = await api.chatAct(c.id, line.id, a.id);
      say(r.note);
      await load();
      if (a.type === "order" || a.type === "buy") await onSaved();
      if (r.taskId && (a.type === "order" || a.type === "buy")) onReplay(r.taskId);
    } catch (e) { setError((e as Error).message); } finally { setPressing(null); }
  };

  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); say("Copied."); } catch { say("Select the text and copy it."); } };

  const todos = (view?.lines ?? []).flatMap((l) => (l.actions ?? []).filter((a) => a.type === "todo").map((a) => ({ line: l, a: a as Extract<ChatAction, { type: "todo" }> })));
  const open = todos.filter((x) => x.a.state !== "done");
  const b = view?.brain;

  return (
    <section className="cc" aria-label={`Chat with the CEO of ${c.name}`}>
      <header className="cc-head">
        <p className="dk-hint">Your CEO knows {c.name}: its products, sales, money and accounts, and what other companies sell. Ask it anything about getting sales. Nothing is spent until you press a button.</p>
        {b && (
          <button type="button" className={`cc-brain ${b.strong ? "on" : ""}`} onClick={() => onTab("limits")} title="Change the AI limit">
            <NxIcon name="agent" size={14} />
            {b.strong
              ? <>Brain: strong model ({(b.model ?? "").split("/").pop()}), paid by {c.name} · {usd(b.leftUsd ?? 0)} left today</>
              : b.model
                ? <>Brain: free model · the strong one starts once {c.name} holds USDC{b.dailyUsd <= 0 ? " and its AI limit is above $0" : ""}</>
                : <>Brain: free model</>}
          </button>
        )}
      </header>

      {open.length > 0 && (
        <div className="cc-todo">
          <b>For you to do</b>
          {open.map(({ line, a }) => (
            <label key={a.id} className="cc-check"><input type="checkbox" disabled={pressing !== null} onChange={() => void press(line, a)} /> {a.text}</label>
          ))}
        </div>
      )}

      <div className="cc-log" role="log" aria-live="polite" ref={log}>
        {view && view.lines.length === 0 && (
          <div className="cc-line ceo"><div className="cc-bubble"><p>I run {c.name}. Tell me what you want, or pick a question below: I will tell you what to post, where, what to sell next, and what to order from the swarm.</p></div></div>
        )}
        {!view && !error && <p className="dim">Loading the chat…</p>}
        {view?.lines.map((l) => (
          <div key={l.id} className={`cc-line ${l.from}`}>
            <div className="cc-bubble">
              <Words text={l.text} />
              {l.actions?.map((a) => <Card key={a.id} a={a} c={c} page={page} swarmUsd={swarmUsd} busy={pressing !== null} pressing={pressing === a.id} onPress={() => void press(l, a)} onCopy={(s) => void copy(s)} />)}
              <span className="cc-at faint">{l.id === "pending" ? "sending…" : ago(l.at)}</span>
            </div>
          </div>
        ))}
        {sending && <div className="cc-line ceo"><div className="cc-bubble cc-typing"><span /><span /><span /></div></div>}
      </div>

      {error && <p className="warn" style={{ margin: 0 }}>{error}</p>}
      <div className="cc-asks">
        {ASKS.map((q) => <button key={q} type="button" className="cc-ask" disabled={sending} onClick={() => void send(q)}>{q}</button>)}
      </div>
      <form className="cc-input" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea className="field" rows={2} maxLength={1500} placeholder={`Message the CEO of ${c.name}`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
        <button className="nx-btn nx-btn-acc" disabled={sending || text.trim().length < 2}>{sending ? "…" : "Send"}</button>
      </form>
    </section>
  );
}

function Card({ a, c, page, swarmUsd, busy, pressing, onPress, onCopy }: { a: ChatAction; c: DeskCompany; page: string; swarmUsd: number; busy: boolean; pressing: boolean; onPress: () => void; onCopy: (s: string) => void }) {
  const done = a.state === "done";
  const foot = done ? <p className="cc-done">✓ {a.note ?? "Done."}</p> : null;
  if (a.type === "order") {
    return (
      <div className="cc-card">
        <span className="cc-tag">Swarm job{swarmUsd > 0 ? ` · about ${usd(swarmUsd)} in IMD` : ""}</span>
        <b>{a.kind === "build_product" ? `${a.name} · ${usd(a.priceUsd ?? 0)}` : a.title}</b>
        {a.kind === "build_product" && a.pitch && <p className="dim">{a.pitch}</p>}
        {a.brief && <p className="cc-brief">{a.brief}</p>}
        {foot ?? <button type="button" className="nx-btn nx-btn-acc" disabled={busy || c.status !== "active" || Boolean(c.working)} onClick={onPress}>{pressing ? "Ordering…" : c.working ? "Work in progress" : "Get this swarm job"}</button>}
      </div>
    );
  }
  if (a.type === "buy") {
    return (
      <div className="cc-card">
        <span className="cc-tag">Buy from {a.seller}</span>
        <b>{a.name} · {usd(a.priceUsd)}</b>
        {a.why && <p className="dim">{a.why}</p>}
        {foot ?? <button type="button" className="nx-btn nx-btn-acc" disabled={busy || c.b2b.usdcUsd < a.priceUsd} onClick={onPress}>{pressing ? "Paying…" : c.b2b.usdcUsd < a.priceUsd ? `Needs ${usd(a.priceUsd)} USDC` : `Buy for ${usd(a.priceUsd)}`}</button>}
      </div>
    );
  }
  if (a.type === "post") {
    const name = PLACE[a.where] ?? a.where;
    return (
      <div className="cc-card">
        <span className="cc-tag">Post this on {name}{a.where === "x" ? ` · ${a.text.length}/280` : ""}</span>
        <p className="cc-post">{a.text}</p>
        <div className="cc-row">
          <button type="button" className="nx-btn" onClick={() => onCopy(a.text)}>Copy</button>
          <a className="nx-btn" href={composeUrl(a.where, a.text, page)} target="_blank" rel="noopener noreferrer" onClick={() => onCopy(a.text)}>Open {name} <NxIcon name="external" size={13} /></a>
          {done ? <span className="cc-done">✓ Posted</span> : <button type="button" className="nx-btn" disabled={busy} onClick={onPress}>Mark posted</button>}
        </div>
      </div>
    );
  }
  if (a.type === "connect") {
    return (
      <div className="cc-card">
        <span className="cc-tag">Connect {ACCOUNT[a.to] ?? a.to}</span>
        {a.why && <p className="dim">{a.why}</p>}
        <button type="button" className="nx-btn" onClick={onPress}>Open Connections</button>
      </div>
    );
  }
  return (
    <div className={`cc-card cc-you ${done ? "is-done" : ""}`}>
      <span className="cc-tag">For you to do</span>
      <label className="cc-check"><input type="checkbox" checked={done} disabled={busy} onChange={onPress} /> {a.text}</label>
    </div>
  );
}
