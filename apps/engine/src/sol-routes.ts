import type { IncomingMessage, ServerResponse } from "node:http";
import { liveSolChain } from "./sol-chain.js";
import { discover } from "./sol-discover.js";
import { liveImd } from "./sol-imd.js";
import { BASE58_KEY, proxyRpc, SolInputError, SolLaunchpad, solSettings } from "./sol-launch.js";
import { writeSettings } from "./settings.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, max: number, windowMs: number): boolean;
  isAdmin(req: IncomingMessage): boolean;
  pad?: SolLaunchpad;
};

// one launchpad per RPC: changing SOL_RPC or SOL_NETWORK in /setup starts a fresh reader
let live: { rpc: string; pad: SolLaunchpad; timer: NodeJS.Timeout } | null = null;
export function solPad(): SolLaunchpad {
  const { rpc } = solSettings();
  if (live?.rpc === rpc) return live.pad;
  if (live) clearInterval(live.timer);
  const pad = new SolLaunchpad(liveSolChain(rpc), solSettings, undefined, undefined, liveImd());
  const timer = setInterval(() => void pad.refresh().catch(() => {}), 60_000);
  timer.unref();
  void pad.refresh().catch(() => {});
  live = { rpc, pad, timer };
  return pad;
}

const OPEN = { "Access-Control-Allow-Origin": "*" };
const KEY = "([1-9A-HJ-NP-Za-km-z]{32,44})";

/** IMD Launch on Solana, through NIGHTSHIFT: the board, a launch's steps, discovery, metadata and logos, the RPC proxy, the admin. */
export async function solRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/sol/")) return false;
  const reply = (code: number, body: unknown, cache = "no-store", extra: Record<string, string> = {}) => { ctx.json(res, code, body, { "Cache-Control": cache, ...extra }); return true; };
  const pad = ctx.pad ?? solPad();
  const m = (re: string) => new RegExp(`^/api/sol/${re}$`).exec(p);
  try {
    if (req.method === "GET" && p === "/api/sol/launchpad") return reply(200, await pad.info(), "public, max-age=30");
    if (req.method === "GET" && p === "/api/sol/launches") {
      const sort = new URL(req.url ?? "", "http://x").searchParams.get("sort");
      const list = pad.list(sort === "mcap" || sort === "progress" || sort === "movers" ? sort : "new").slice(0, 200);
      return reply(200, { launches: list.map((l) => ({ ...l, spark: pad.spark(l.mint) })), waiting: pad.waiting().slice(0, 30) }, "public, max-age=15");
    }
    if (req.method === "GET" && p === "/api/sol/discover") return reply(200, await discover(await pad.solUsd()), "public, max-age=60");
    const chart = m(`launches/${KEY}/chart`);
    if (req.method === "GET" && chart) return reply(200, { points: pad.chart(chart[1]!) }, "public, max-age=30");
    const one = m(`launches/${KEY}`);
    if (req.method === "GET" && one) { const l = pad.one(one[1]!); return l ? reply(200, l, "no-store") : reply(404, { error: "No launch with that address here." }); }
    const meta = m(`meta/${KEY}\\.json`);
    if (req.method === "GET" && meta) { const j = pad.meta(meta[1]!); return j ? reply(200, j, "public, max-age=300", OPEN) : reply(404, { error: "not found" }, "no-store", OPEN); }
    const img = m("img/([A-Za-z0-9]{32,44}\\.(?:webp|png|jpg|gif))");
    if (req.method === "GET" && img) {
      const f = pad.image(img[1]!);
      if (!f) return reply(404, { error: "not found" });
      res.writeHead(200, { "Content-Type": f.type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'", ...OPEN });
      res.end(f.bytes);
      return true;
    }
    // ---- a launch, step by step: prepare, sign, pay IMD, the creator's own decisions
    if (req.method === "POST" && p === "/api/sol/prepare") {
      if (ctx.limited(req, "sol-prepare", 12, 3600_000)) return reply(429, { error: "Too many launches from here. Wait an hour." });
      return reply(200, await pad.prepare(await ctx.body(req, 260_000)));
    }
    const step = m(`launches/${KEY}/(signed|paid|act)`);
    if (req.method === "POST" && step) {
      if (ctx.limited(req, "sol-step", 60, 600_000)) return reply(429, { error: "Too many requests. Wait a few minutes." });
      const b = await ctx.body(req, 8_000);
      const [, mint, what] = step;
      if (what === "signed") return reply(200, await pad.signed(mint!, b));
      if (what === "paid") return reply(200, await pad.paid(mint!, b.chainId, b.tx));
      return reply(200, await pad.act(mint!, b.action, b.signature));
    }
    if (req.method === "POST" && p === "/api/sol/rpc") {
      if (ctx.limited(req, "sol-rpc", 300, 60_000)) return reply(429, { jsonrpc: "2.0", id: null, error: { code: 429, message: "Too many requests. Wait a minute." } });
      return reply(200, await proxyRpc(solSettings().rpc, await ctx.body(req, 64_000)));
    }
    // ---- the admin: the partner wallet, the shared config key, the launches waiting
    if (p.startsWith("/api/sol/admin/")) {
      if (!ctx.isAdmin(req)) return reply(401, { error: "wrong admin token" });
      if (req.method === "GET" && p === "/api/sol/admin/state") { const s = solSettings(); return reply(200, { network: s.network, config: s.config, partner: s.partner, mintsReady: pad.mints.readyCount(), pending: pad.pending(), info: await pad.info() }); }
      if (req.method === "POST" && p === "/api/sol/admin/partner") {
        const b = await ctx.body(req, 1_000);
        const partner = String(b.partner ?? "").trim();
        if (!BASE58_KEY.test(partner)) return reply(400, { error: "That is not a Solana address." });
        writeSettings({ SOL_PARTNER: partner });
        return reply(200, { ok: true, info: await pad.info() });
      }
      if (req.method === "POST" && p === "/api/sol/admin/config") {
        const b = await ctx.body(req, 2_000);
        const v = await pad.verifyConfig(String(b.config ?? ""), String(b.partner ?? ""));
        if (!v.ok) return reply(400, { error: v.why });
        writeSettings({ SOL_DBC_CONFIG: String(b.config), SOL_PARTNER: String(b.partner) });
        return reply(200, { ok: true, info: await pad.info() });
      }
      if (req.method === "POST" && p === "/api/sol/admin/launch") {
        const b = await ctx.body(req, 1_000);
        return reply(200, await pad.adminAct(String(b.mint ?? ""), b.action));
      }
      if (req.method === "POST" && p === "/api/sol/admin/network") {
        const b = await ctx.body(req, 500);
        if (b.network !== "mainnet" && b.network !== "devnet") return reply(400, { error: "network is mainnet or devnet" });
        // a config key exists on one network only: switching clears it
        writeSettings({ SOL_NETWORK: b.network, SOL_DBC_CONFIG: "" });
        return reply(200, { ok: true });
      }
      return reply(404, { error: "not found" });
    }
    return reply(404, { error: "not found" });
  } catch (e) {
    if (e instanceof SolInputError) return reply(e.status, { error: e.message });
    if (e instanceof SyntaxError) return reply(400, { error: "The body must be JSON." });
    if ((e as Error).message === "body too large") return reply(413, { error: "That is too large." });
    return reply(503, { error: "Solana could not be read right now. Try again shortly." });
  }
}
