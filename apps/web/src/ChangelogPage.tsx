import { useMemo } from "react";
import source from "../../../docs/CHANGELOG.md?raw";
import SplitFlapText from "./rb/SplitFlapText";
import { PxHero, PxNum, PxPanel, PxStat, PxStats } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { LxBg, useRich } from "./saas/pages/learn-kit";
import "./saas/pages/learn.css";
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

/** "04 NOV 2026": the day on a split-flap board. */
const flapText = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase();

export function ChangelogPage() {
  const rich = useRich();
  const days = useMemo(() => {
    const by = new Map<string, Entry[]>();
    for (const e of parse(source)) by.set(e.date, [...(by.get(e.date) ?? []), e]);
    return [...by];
  }, []);
  const count = days.reduce((n, [, l]) => n + l.length, 0);
  const last = days[0]?.[0];
  return (
    <div className="lx lx-cl cl">
      <PxHero
        kicker="CHANGELOG · ALWAYS SHIPPING"
        title="What"
        accent="shipped."
        bg={<LxBg rich={rich} />}
        lead={<>Every update to NIGHTSHIFT, newest first, in plain words. {count} updates since {days.length ? dayText(days.at(-1)![0]) : "the start"}. Every Monday the Telegram bot posts the past week's in the community chat and pins it.</>}
        actions={<>
          <a className="px-btn" href="/changelog.md" target="_blank" rel="noreferrer"><PxIcon name="bot" size={14} />Markdown, for agents</a>
          <a className="px-btn ghost" href="https://t.me/getnightshift" target="_blank" rel="noreferrer"><PxIcon name="link" size={14} />The community chat</a>
        </>}
        aside={
          <PxPanel title="SHIP LOG" state={last ? "live" : "idle"} right="docs/CHANGELOG.md">
            <div className="lx-board">
              <span>LAST SHIPPED</span>
              <SplitFlapText text={last ? flapText(last) : "-- --- ----"} padTo={11} charset="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -" tileColor="#0d1410" textColor="#b8ff3d" fontSize={20} gap={3} tileRadius={2} flipDuration={0.18} stagger={0.018} intro={false} />
            </div>
            <PxStats cols={2}>
              <PxStat label="Updates" value={<PxNum value={count} />} sub="in this log" tone="lime" />
              <PxStat label="Days" value={<PxNum value={days.length} />} sub="with a ship" />
            </PxStats>
          </PxPanel>
        }
      />
      <div className="lx-cl-days">
        {days.map(([date, entries]) => (
          <section key={date} className="lx-cl-day cl-day" aria-labelledby={`cl-${date}`}>
            <h2 id={`cl-${date}`}><time dateTime={date}>{dayText(date)}</time><span>{entries.length} update{entries.length === 1 ? "" : "s"}</span></h2>
            <ol className="lx-cl-list">
              {entries.map((e) => <li key={e.title} className="lx-cl-entry"><b>{e.title}</b>{e.lines.length > 0 && <ul>{e.lines.map((l) => <li key={l}>{l}</li>)}</ul>}</li>)}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
