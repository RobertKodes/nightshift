import { Fragment, useEffect, useMemo, useState } from "react";
import source from "../../../docs/WHITEPAPER.md?raw";
import { NxIcon } from "./nx/icons";

/** A heading's anchor: lowercase words joined by hyphens. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Inline Markdown: `code`, **bold**, [links](url). Text only, never HTML. */
function inline(s: string): React.ReactNode[] {
  return s.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g).filter(Boolean).map((part, i) => {
    if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**")) return <b key={i}>{inline(part.slice(2, -2))}</b>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = /^https?:\/\//.test(link[2]!) || link[2]!.startsWith("/") ? link[2]! : "#";
      return <a key={i} href={href} {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>{link[1]}</a>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Block =
  | { t: "h"; level: 1 | 2 | 3; text: string; id: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "table"; head: string[]; rows: string[][] };

/** The whitepaper's Markdown, as blocks: headings, paragraphs, lists and tables are all it uses. */
function parse(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  for (let i = 0; i < lines.length;) {
    const l = lines[i]!;
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,3}) (.+)$/.exec(l);
    if (h) { out.push({ t: "h", level: h[1]!.length as 1 | 2 | 3, text: h[2]!, id: slug(h[2]!) }); i++; continue; }
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) { if (!/^\|[\s|:]*-[\s|:-]*\|$/.test(lines[i]!.trim())) rows.push(cells(lines[i]!)); i++; }
      const [head = [], ...rest] = rows;
      out.push({ t: "table", head, rows: rest });
      continue;
    }
    const list = /^(- |\d+\. )/.exec(l);
    if (list) {
      const ordered = list[1] !== "- ";
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\. /.test(lines[i]!) : lines[i]!.startsWith("- "))) { items.push(lines[i]!.replace(/^(- |\d+\. )/, "")); i++; }
      out.push(ordered ? { t: "ol", items } : { t: "ul", items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3} |\||- |\d+\. )/.test(lines[i]!)) { para.push(lines[i]!.trim()); i++; }
    out.push({ t: "p", text: para.join(" ") });
  }
  return out;
}

/** The whitepaper: the same file as docs/WHITEPAPER.md and /whitepaper.md, with contents and a print-ready layout. */
export function WhitepaperPage() {
  const blocks = useMemo(() => parse(source), []);
  const title = blocks.find((b): b is Extract<Block, { t: "h" }> => b.t === "h" && b.level === 1);
  const meta = blocks.find((b): b is Extract<Block, { t: "p" }> => b.t === "p");
  const toc = blocks.filter((b): b is Extract<Block, { t: "h" }> => b.t === "h" && b.level === 2);
  const [on, setOn] = useState(toc[0]?.id ?? "");
  // a shared link to a section (/whitepaper#7-shift) lands on it once the page has rendered
  useEffect(() => { if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView(); }, []);
  useEffect(() => {
    const seen = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) setOn(e.target.id); }, { rootMargin: "-20% 0px -70% 0px" });
    for (const t of toc) { const el = document.getElementById(t.id); if (el) seen.observe(el); }
    return () => seen.disconnect();
  }, [toc]);

  return (
    <div className="docs wp">
      <header className="wp-head">
        <span className="eyebrow">Whitepaper</span>
        <h1>NIGHTSHIFT, <em>end to end.</em></h1>
        {meta && <p className="wp-meta">{meta.text}</p>}
        <div className="wp-actions">
          <button className="nx-btn nx-btn-acc" onClick={() => print()}><NxIcon name="story" size={15} />Save as PDF</button>
          <a className="nx-btn" href="/whitepaper.md" target="_blank" rel="noreferrer"><NxIcon name="agent" size={15} />Markdown, for agents</a>
        </div>
      </header>
      <div className="wp-body">
        <nav className="wp-toc" aria-label="Contents">
          <b>Contents</b>
          {toc.map((t) => <a key={t.id} href={`#${t.id}`} className={on === t.id ? "on" : ""}>{t.text}</a>)}
        </nav>
        <article className="wp-text">
          {blocks.map((b, i) => {
            if (b === title || b === meta) return null;
            if (b.t === "h") return b.level === 2 ? <h2 key={i} id={b.id}>{inline(b.text)}</h2> : <h3 key={i} id={b.id}>{inline(b.text)}</h3>;
            if (b.t === "p") return <p key={i}>{inline(b.text)}</p>;
            if (b.t === "ul") return <ul key={i}>{b.items.map((x, k) => <li key={k}>{inline(x)}</li>)}</ul>;
            if (b.t === "ol") return <ol key={i}>{b.items.map((x, k) => <li key={k}>{inline(x)}</li>)}</ol>;
            return (
              <div key={i} className="wp-table">
                <table>
                  {b.head.some(Boolean) && <thead><tr>{b.head.map((c, k) => <th key={k}>{inline(c)}</th>)}</tr></thead>}
                  <tbody>{b.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
                </table>
              </div>
            );
          })}
        </article>
      </div>
    </div>
  );
}
