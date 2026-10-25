import { useEffect, useState } from "react";
import { type CrewEvent, api } from "../api";
import { Link } from "../router";
import "./crews.css";

/**
 * The Ship's crew strip: the last few real jobs of the house crews, from /api/crews/activity.
 * Hidden while there is nothing (or the feed does not answer): the Ship never shows an empty box.
 */
const NAME: Record<string, string> = { watchtower: "Watchtower", research: "Research Desk", buildcheck: "Build & Check", swarm: "Swarm Desk" };
const ago = (t: number, now: number) => { const m = Math.max(0, Math.round((now - t) / 60_000)); return m < 1 ? "now" : m < 60 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

export function CrewStrip() {
  const [events, setEvents] = useState<CrewEvent[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let on = true;
    const load = () => api.crewActivity().then((d) => { if (on) { setEvents((d.events ?? []).filter((e) => e.house && e.status !== "running")); setNow(Date.now()); } }).catch(() => { /* hidden when it does not answer */ });
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => { on = false; clearInterval(t); };
  }, []);
  const rows = events.slice(0, 3);
  if (!rows.length) return null;
  return (
    <div className="cr-shiplog">
      <Link to="/crews#live">House crews at work →</Link>
      <ol className="sh-log" aria-label="House crews, latest jobs">
        {rows.map((e, i) => {
          const at = e.at > 1e12 ? e.at : e.at * 1000;
          return <li key={`${e.at}-${i}`}><time>{ago(at, now)}</time>{NAME[e.crew] ?? e.crew} · {e.status === "failed" ? "failed: " : ""}{e.summary ?? e.kind}{e.paid ? " · paid" : ""}</li>;
        })}
      </ol>
    </div>
  );
}
