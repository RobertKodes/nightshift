import { useMemo } from "react";
import source from "../../../docs/CHANGELOG.md?raw";
import { NxIcon } from "./nx/icons";
import "./changelog.css";

/**
 * The changelog: the same file as docs/CHANGELOG.md and /changelog.md, newest first, grouped by day.
 * Every Monday the Telegram bot posts the past week's entries in the community chat and pins them.
 */
type Entry = { date: string; title: string; lines: string[] };
function parse(md: string): Entry[] {
  const out: Entry[] = [];
  let cur: Entry | null = null;
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const h = /^##\s+(\d{4}-\d{2}-\d{2})\s*[·:-]\s*(.+)$/.exec(line);
    if (h) { cur = { date: h[1]!, title: h[2]!.trim(), lines: [] }; out.push(cur); continue; }
    if (/^#/.test(line)) { cur = null; continue; }
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item && cur && cur.lines.length < 3) cur.lines.push(item[1]!.trim());
  }
  return out;
}
const dayText = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function ChangelogPage() {
  const days = useMemo(() => {
    const by = new Map<string, Entry[]>();
    for (const e of parse(source)) by.set(e.date, [...(by.get(e.date) ?? []), e]);
    return [...by];
  }, []);
  const count = days.reduce((n, [, l]) => n + l.length, 0);
  return (
    <div className="docs cl">
      <header className="cl-head">
        <span className="eyebrow">Changelog</span>
        <h1>What <em>shipped.</em></h1>
        <p className="lead">Every update to NIGHTSHIFT, newest first, in plain words. {count} updates since {days.length ? dayText(days.at(-1)![0]) : "the start"}. Every Monday the Telegram bot posts the past week's in the community chat and pins it.</p>
        <div className="cl-actions">
          <a className="nx-btn" href="/changelog.md" target="_blank" rel="noreferrer"><NxIcon name="agent" size={15} />Markdown, for agents</a>
          <a className="nx-btn" href="https://t.me/getnightshift" target="_blank" rel="noreferrer"><NxIcon name="external" size={15} />The community chat</a>
        </div>
      </header>
      {days.map(([date, entries]) => (
        <section key={date} className="cl-day" aria-labelledby={`cl-${date}`}>
          <h2 id={`cl-${date}`}><time dateTime={date}>{dayText(date)}</time><span>{entries.length} update{entries.length === 1 ? "" : "s"}</span></h2>
          <ol className="cl-list">
            {entries.map((e) => <li key={e.title} className="cl-entry"><b>{e.title}</b>{e.lines.length > 0 && <ul>{e.lines.map((l) => <li key={l}>{l}</li>)}</ul>}</li>)}
          </ol>
        </section>
      ))}
    </div>
  );
}
