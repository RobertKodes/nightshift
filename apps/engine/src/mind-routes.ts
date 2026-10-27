import type { IncomingMessage, ServerResponse } from "node:http";
import type { LlmClient } from "@nightshift/llm";
import { type BriefKind, KINDS, diagnose } from "./brief-doctor.js";
import type { Mind } from "./swarm-mind.js";
import type { WeatherDesk } from "./swarm-weather.js";

/**
 * SWARM MIND's API, open to anyone: GET /api/mind (what it holds), GET /api/mind/search?q=, and
 * POST /api/mind/ask {q} (an answer from the swarm's own work, with its sources). Asking is
 * rate-limited per caller, since every answer is a model call.
 */
type Ctx = {
  json: (res: ServerResponse, code: number, body: unknown) => void;
  body: (req: IncomingMessage, max?: number) => Promise<Record<string, unknown>>;
  limited: (req: IncomingMessage, key: string, n: number, ms: number) => boolean;
  url: URL; mind: Mind; weather: WeatherDesk | null; llm: Pick<LlmClient, "chat"> | null; model: string;
};

export async function mindRoutes(req: IncomingMessage, res: ServerResponse, p: string, x: Ctx): Promise<boolean> {
  if (p === "/api/mind" && req.method === "GET") { x.json(res, 200, x.mind.stats()); return true; }
  // SWARM WEATHER: today's forecast, and its card
  if (p === "/api/mind/weather" && req.method === "GET" && x.weather) {
    try { x.json(res, 200, await x.weather.today()); } catch { x.json(res, 503, { error: "The swarm's numbers did not come in. Try again in a minute." }); }
    return true;
  }
  if (p === "/api/mind/weather.gif" && req.method === "GET" && x.weather) {
    if (x.limited(req, "mind-weather-gif", 30, 60_000)) { x.json(res, 429, { error: "Slow down." }); return true; }
    try { const g = await x.weather.gif(); res.writeHead(200, { "content-type": "image/gif", "content-length": g.length, "cache-control": "public, max-age=900" }); res.end(g); } catch { x.json(res, 503, { error: "The card is not ready. Try again in a minute." }); }
    return true;
  }
  if (p === "/api/mind/search" && req.method === "GET") {
    if (x.limited(req, "mind-search", 60, 60_000)) { x.json(res, 429, { error: "Slow down." }); return true; }
    const q = (x.url.searchParams.get("q") ?? "").slice(0, 300);
    x.json(res, 200, { q, results: q.trim() ? x.mind.search(q, 20) : [] });
    return true;
  }
  // BRIEF DOCTOR: IMD's free check, the swarm's earlier work on it, and a better request, before anyone pays
  if (p === "/api/mind/brief" && req.method === "POST") {
    if (x.limited(req, "mind-brief", 6, 10 * 60_000)) { x.json(res, 429, { error: "Six checks per 10 minutes: try again in a moment." }); return true; }
    const b = await x.body(req, 8_000);
    const objective = String(b.objective ?? "").trim().slice(0, 4000);
    const kind = (Object.keys(KINDS) as BriefKind[]).find((k) => k === b.kind) ?? null;
    if (objective.length < 15) { x.json(res, 400, { error: "Paste the request you want to send to the swarm (15 characters or more)." }); return true; }
    try {
      const check = async (body: object) => { const r = await fetch("https://api.imd.fun/requests/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }); return (await r.json()) as Record<string, unknown>; };
      x.json(res, 200, await diagnose(objective, kind, { check, mind: x.mind, llm: x.llm, model: x.model }));
    } catch { x.json(res, 503, { error: "IMD's check did not answer. Try again in a minute." }); }
    return true;
  }
  if (p === "/api/mind/ask" && req.method === "POST") {
    if (x.limited(req, "mind-ask", 10, 10 * 60_000)) { x.json(res, 429, { error: "Ten questions per 10 minutes: ask again in a moment." }); return true; }
    const q = String((await x.body(req, 4_000)).q ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (q.length < 3) { x.json(res, 400, { error: "Ask a question." }); return true; }
    try { x.json(res, 200, { q, ...(await x.mind.ask(q, x.llm, x.model)) }); } catch { x.json(res, 503, { error: "SWARM MIND is busy right now. Try again in a minute." }); }
    return true;
  }
  return false;
}
