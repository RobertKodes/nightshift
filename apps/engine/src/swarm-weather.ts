import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { animatedGif } from "./forge-gif.js";
import type { Mind, Work } from "./swarm-mind.js";
import { words } from "./swarm-mind.js";

/**
 * SWARM WEATHER: the IMD swarm's day, told as a forecast. How busy it was against its own week
 * (a storm of work, sunny, steady, or a quiet night), what it worked on most, and the day's
 * standout audit and research. A small looping weather card goes with it; posted once a day.
 */
export type Swarm = { agentsOnline: number; acceptedLastDay: number; jobsDoneLastDay: number; oraclesDoneLastDay: number; inferenceTokens: number; launchesLive: number; jobs: number };
export type Sky = "storm" | "sunny" | "steady" | "quiet";
export type Weather = {
  day: string; sky: Sky; icon: string; headline: string;
  swarm: Swarm; works: number; byKind: Record<string, number>;
  topics: string[]; audit: { title: string; url: string; findings: number } | null; research: { title: string; url: string } | null;
  week: number;
};

const SKIES: Record<Sky, { icon: string; say: string }> = {
  storm: { icon: "⛈", say: "A storm of work" },
  sunny: { icon: "☀️", say: "Sunny and busy" },
  steady: { icon: "⛅", say: "Steady" },
  quiet: { icon: "🌙", say: "A quiet night" },
};
/** Words too common in the swarm's titles to say anything about the day. */
const PLAIN = new Set("token custom name symbol build make write draw logo research report audit contract contracts website site page simple deploy launch new identity md imd test hello world mainnet ethereum chain project app job one only top scope folder ignore repository file files use using primary target".split(" "));

/** The day's sky: today's finished jobs against the average of the days before it. */
export function skyOf(jobs: number, week: number[]): Sky {
  const avg = week.length ? week.reduce((a, b) => a + b, 0) / week.length : jobs;
  const r = avg > 0 ? jobs / avg : 1;
  return r >= 1.3 ? "storm" : r >= 1.05 ? "sunny" : r >= 0.8 ? "steady" : "quiet";
}

/**
 * What the swarm worked on most today: words its titles share, weighted by how rare they are across
 * all its work (`share`: 0 to 1), so a topic is what stood out today, not a word every request uses.
 */
export function topicsOf(works: Work[], n = 5, share: (w: string) => number = () => 0): string[] {
  const count = new Map<string, number>();
  for (const w of works) for (const x of new Set(words(w.title))) if (!PLAIN.has(x) && !/^\d+$/.test(x) && x.length > 2) count.set(x, (count.get(x) ?? 0) + 1);
  return [...count].filter(([x, c]) => c >= 2 && share(x) < 0.15).map(([x, c]) => [x, c * Math.log(1 / Math.max(0.002, share(x)))] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([x]) => x);
}

export function forecast(swarm: Swarm, today: Work[], history: { day: string; jobs: number }[], day: string, share?: (w: string) => number): Weather {
  const week = history.filter((h) => h.day !== day).slice(-7).map((h) => h.jobs);
  const sky = skyOf(swarm.jobsDoneLastDay, week);
  const byKind: Record<string, number> = {};
  for (const w of today) for (const k of w.kinds) byKind[k] = (byKind[k] ?? 0) + 1;
  const audit = today.filter((w) => w.kinds.includes("audits")).sort((a, b) => (b.findings ?? 0) - (a.findings ?? 0))[0];
  const research = today.find((w) => w.kinds.includes("research"));
  return {
    day, sky, icon: SKIES[sky].icon, headline: SKIES[sky].say, swarm, works: today.length, byKind, topics: topicsOf(today, 5, share),
    audit: audit ? { title: audit.title, url: audit.url, findings: audit.findings ?? 0 } : null,
    research: research ? { title: research.title, url: research.url } : null,
    week: week.length ? Math.round(week.reduce((a, b) => a + b, 0) / week.length) : swarm.jobsDoneLastDay,
  };
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const n = (x: number) => x.toLocaleString("en-US");

/** The forecast for Telegram (HTML). */
export function weatherText(w: Weather, page: string): string {
  const kinds = [["research", "research"], ["audits", "audits"], ["contracts", "contracts"], ["sites", "sites"]].filter(([k]) => w.byKind[k!]).map(([k, l]) => `${w.byKind[k!]} ${l}`).join(" · ");
  return [
    `${w.icon} <b>SWARM WEATHER · ${w.day}</b>`,
    `<b>${w.headline}</b>: ${n(w.swarm.jobsDoneLastDay)} jobs done (a usual day: ${n(w.week)}), ${n(w.swarm.acceptedLastDay)} pieces of work accepted, ${n(w.swarm.agentsOnline)} agents online.`,
    "",
    w.works ? `📦 Published today: ${n(w.works)} works${kinds ? ` (${kinds})` : ""}` : "",
    w.topics.length ? `🔥 Hot today: ${w.topics.map((t) => `#${esc(t)}`).join(" ")}` : "",
    w.audit ? `🛡 Audit of the day: <a href="${w.audit.url}">${esc(w.audit.title.slice(0, 90))}</a>${w.audit.findings ? ` · ${w.audit.findings} findings` : ""}` : "",
    w.research ? `📚 Research of the day: <a href="${w.research.url}">${esc(w.research.title.slice(0, 90))}</a>` : "",
    "",
    `<i>Ask the swarm anything: /ask · <a href="${page}">SWARM MIND</a></i>`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n").trim();
}

/** The weather card: a sky that moves (rays turning, rain falling, a flash, stars), the day's numbers. */
export function weatherSvg(w: Weather): string {
  const sky = {
    storm: `<g fill="#9fb4ff" opacity=".9">${[60, 120, 180, 240, 300].map((x, i) => `<rect x="${x}" y="-20" width="3" height="18" rx="1.5"><animate attributeName="y" values="-20;160" dur="${0.9 + (i % 3) * 0.15}s" begin="${i * 0.2}s" repeatCount="indefinite"/></rect>`).join("")}</g><polygon points="196,40 176,96 196,96 182,140 222,80 200,80 214,40" fill="#ffe66b"><animate attributeName="opacity" values="0;0;1;0;0;0;1;0" dur="3s" repeatCount="indefinite"/></polygon><ellipse cx="200" cy="44" rx="120" ry="34" fill="#3a3f63"/>`,
    sunny: `<g transform="translate(200 90)"><g><animateTransform attributeName="transform" type="rotate" values="0;45" dur="3s" repeatCount="indefinite"/>${Array.from({ length: 8 }, (_, i) => `<rect x="-4" y="-78" width="8" height="26" rx="4" fill="#ffc46b" transform="rotate(${i * 45})"/>`).join("")}</g><circle r="40" fill="#ffd57a"/></g>`,
    steady: `<circle cx="170" cy="84" r="36" fill="#ffd57a"/><g><animateTransform attributeName="transform" type="translate" values="-10 0;14 0;-10 0" dur="3s" repeatCount="indefinite"/><ellipse cx="220" cy="100" rx="70" ry="26" fill="#cfd6f5"/><ellipse cx="190" cy="88" rx="40" ry="24" fill="#e3e8ff"/></g>`,
    quiet: `<circle cx="200" cy="86" r="38" fill="#e9e4ff"/><circle cx="216" cy="74" r="34" fill="#0b0c1c"/>${[[80, 50], [320, 60], [120, 130], [290, 140], [60, 110], [340, 110]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="2.4" fill="#fff"><animate attributeName="opacity" values="0.2;1;0.2" dur="${1.5 + (i % 3) * 0.5}s" repeatCount="indefinite"/></circle>`).join("")}`,
  }[w.sky];
  const big = (x: number, y: number, v: string, l: string) => `<text x="${x}" y="${y}" fill="#ffffff" font-size="28" font-weight="700" text-anchor="middle">${esc(v)}</text><text x="${x}" y="${y + 20}" fill="#9a98b0" font-size="12" text-anchor="middle">${esc(l)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" font-family="JetBrains Mono">
<rect width="400" height="400" fill="#0b0c1c"/><rect x="10" y="10" width="380" height="380" rx="18" fill="none" stroke="#4ad8ff" stroke-opacity=".35"/>
${sky}
<text x="200" y="196" fill="#4ad8ff" font-size="13" text-anchor="middle" letter-spacing="3">SWARM WEATHER · ${esc(w.day)}</text>
<text x="200" y="226" fill="#ffffff" font-size="22" font-weight="700" text-anchor="middle">${esc(w.headline.toUpperCase())}</text>
${big(80, 290, n(w.swarm.jobsDoneLastDay), "jobs done")}${big(200, 290, n(w.swarm.acceptedLastDay), "accepted")}${big(320, 290, n(w.swarm.agentsOnline), "agents")}
<text x="200" y="352" fill="#b8ff4a" font-size="13" text-anchor="middle">${esc(w.topics.slice(0, 3).map((t) => `#${t}`).join("  ") || "the IMD swarm")}</text>
<text x="200" y="378" fill="#6c6a84" font-size="10" text-anchor="middle">getnightshift.tech/mind · /ask in the bot</text>
</svg>`;
}

/** Today's forecast and its card, kept for the day (and the history of busy days for tomorrow's sky). */
export function createWeather(d: { swarm: () => Promise<Swarm>; mind: Mind; dir: string; now?: () => number }) {
  const now = d.now ?? Date.now;
  const file = join(d.dir, "swarm-weather.json");
  let cached: { at: number; w: Weather; gif: Buffer | null } | null = null;
  const history = (): { day: string; jobs: number }[] => { try { return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { day: string; jobs: number }[]) : []; } catch { return []; } };
  async function today(): Promise<Weather> {
    if (cached && now() - cached.at < 15 * 60_000) return cached.w;
    const s = await d.swarm(), day = new Date(now()).toISOString().slice(0, 10);
    const h = history();
    const w = forecast(s, d.mind.recent(24 * 3_600_000), h, day, d.mind.share);
    writeAtomic(file, JSON.stringify([...h.filter((x) => x.day !== day), { day, jobs: s.jobsDoneLastDay }].slice(-30)));
    cached = { at: now(), w, gif: null };
    return w;
  }
  /** The card as a GIF, drawn once per forecast. */
  async function gif(): Promise<Buffer> {
    await today();
    cached!.gif ??= animatedGif(weatherSvg(cached!.w), { size: 400, fps: 10, loop: 3 });
    return cached!.gif;
  }
  return { today, gif };
}
export type WeatherDesk = ReturnType<typeof createWeather>;
