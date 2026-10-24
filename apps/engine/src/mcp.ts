import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { fromImd, fromUsdc, usdc } from "@nightshift/core";
import { z } from "zod";
import { config } from "./config.js";
import type { Engine } from "./engine.js";
import { arenaTools } from "./arena-routes.js";
import { type Agent, ArenaError, liveArena } from "./arena.js";
import { live } from "./games-routes.js";
import { leagueTools } from "./league-routes.js";
import { card, detail, search } from "./agentmarket.js";
import { flightFor } from "./flight.js";

/** The agent an MCP call acts as: the arena key's own agent, or one of the key owner's agents named by agentId. */
function agentFor(engine: Engine, owner: string | null, key: string) {
  const arena = liveArena(() => live(engine.vault));
  const self = key ? arena.authenticate(key) : null;
  return (agentId?: string): Agent => {
    if (self) return self;
    if (!owner) throw new ArenaError(401, "Use an arena key (nsa_) or your NIGHTSHIFT key, with agentId.", "unauthorized");
    if (!agentId) throw new ArenaError(400, "agentId: which of your agents acts (GET /api/arena/mine).", "bad_input");
    return arena.authenticateOwned(owner, agentId);
  };
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) }] });
const err = (message: string) => ({ ...text({ ok: false, message }), isError: true });

/**
 * NIGHTSHIFT over MCP: run your companies from Claude, Cursor or any MCP client. One stateless
 * server per request, scoped to the wallet behind the API key.
 */
function build(engine: Engine, owner: string | null) {
  const server = new McpServer({ name: "nightshift", version: "0.2.0" }, {
    instructions: "Run autonomous companies that build with the IMD swarm and sell via x402. List, create, run shifts, approve or decline spending, change limits, pause, direct the CEO, order work by hand, replay any shift's flight record, and withdraw revenue. Spending decisions stay with the human: show them pending approvals and withdrawals before acting.",
  });
  const mine = () => [...engine.store.companies.values()].filter((c) => !config.requireAuth || c.owner === owner);
  const pick = (id: string) => {
    const c = engine.get(id);
    if (!c || (config.requireAuth && c.owner !== owner)) throw new Error("No such company for this key.");
    return c;
  };
  const brief = (c: ReturnType<typeof pick>) => {
    let spent = 0n;
    for (const t of c.tasks) spent += t.costImd;
    const s = engine.stats(c);
    return {
      id: c.id, slug: c.slug, name: c.name, mission: c.mission, status: c.status, shift: c.cycle,
      site: c.site?.url ?? null, publicPage: `${config.publicUrl}/c/${c.slug}`, dashboard: `${config.publicUrl}/co/${c.id}`,
      revenueUsd: c.products.reduce((a, p) => a + fromUsdc(p.revenueUsdc), 0), spentImd: fromImd(spent), visits7d: s.visits7d, sales7d: s.sales7d,
      products: c.products.map((p) => ({ id: p.id, name: p.name, status: p.status, priceUsd: fromUsdc(p.priceUsdc), sales: p.sales, buyUrl: `${config.publicUrl}/buy/${c.slug}/${p.id}` })),
      waitingForApproval: c.tasks.filter((t) => t.status === "awaiting_approval").map((t) => ({ taskId: t.id, title: t.title, why: t.why, reason: t.activity })),
      working: c.tasks.filter((t) => ["checking", "ordering", "building"].includes(t.status)).map((t) => ({ title: t.title, status: t.status, activity: t.activity, steps: `${t.stepsDone}/${t.stepsTotal}` })),
      policy: c.policy,
      lastLog: c.journal.slice(-8).map((j) => j.text),
    };
  };
  const run = <A,>(fn: (a: A) => Promise<unknown> | unknown) => async (a: A) => { try { return text(await fn(a)); } catch (e) { return err((e as Error).message); } };

  const live = () => [...engine.store.companies.values()].flatMap((c) => c.products.filter((x) => x.status === "live" && engine.files.has(c, x)).map((x) => ({ c, p: x, text: engine.files.read(c, x) })));
  server.registerTool("swarm_mind_ask", {
    title: "Ask the IMD swarm's memory",
    description: "SWARM MIND: answers a question from everything the IMD agent swarm published (research, audits, contracts, sites), citing the works it used with explorer links.",
    inputSchema: { question: z.string().min(3).max(500) },
  }, run(async (a: { question: string }) => {
    if (!engine.mind) throw new Error("SWARM MIND is not on in this engine.");
    return engine.mind.ask(a.question, engine.llm, config.chatModel);
  }));
  server.registerTool("swarm_mind_search", {
    title: "Search the IMD swarm's work",
    description: "SWARM MIND: the IMD swarm's published works (research, audits, contracts, sites) that match a query, newest-best first, with explorer links.",
    inputSchema: { query: z.string().min(2).max(300) },
  }, run(async (a: { query: string }) => {
    if (!engine.mind) throw new Error("SWARM MIND is not on in this engine.");
    return { results: engine.mind.search(a.query, 12) };
  }));
  server.registerTool("nightshift_market", {
    title: "Browse what the companies sell",
    description: "Searches every product on sale across NIGHTSHIFT companies, by words, kind and maximum price. Each result has a free preview URL and an x402 buy URL: GET it for the USDC price, pay with an x402 client, and the response holds a download link.",
    inputSchema: { query: z.string().max(200).default(""), kind: z.string().max(40).optional(), maxPriceUsd: z.number().positive().optional(), sort: z.enum(["best", "new", "price"]).default("best") },
  }, run(async (a: { query: string; kind?: string; maxPriceUsd?: number; sort: "best" | "new" | "price" }) => {
    const rows = search(live(), { q: a.query, kind: a.kind, maxUsd: a.maxPriceUsd, sort: a.sort });
    return { mode: config.mode, count: rows.length, items: rows.slice(0, 25).map(card) };
  }));
  server.registerTool("nightshift_product", {
    title: "One product, with its free preview",
    description: "A product's outline, opening lines, size, price and the exact x402 steps to buy it.",
    inputSchema: { company: z.string().max(80), product: z.string().max(80) },
  }, run(async (a: { company: string; product: string }) => {
    const hit = live().find((l) => l.c.slug === a.company && l.p.id === a.product);
    if (!hit) throw new Error("No such product on sale.");
    return { mode: config.mode, ...detail(hit) };
  }));

  server.registerTool("nightshift_companies", { title: "Your companies", description: "Every company you run, with revenue, spend and what each is doing.", inputSchema: {} },
    run(async () => mine().map((c) => { const b = brief(c); return { id: b.id, name: b.name, status: b.status, shift: b.shift, revenueUsd: b.revenueUsd, spentImd: b.spentImd, waiting: b.waitingForApproval.length, working: b.working[0]?.title ?? null }; })));

  server.registerTool("nightshift_company", { title: "One company in detail", description: "Products, P&L, current work, pending approvals, limits and the CEO's latest log.", inputSchema: { id: z.string() } },
    run(async ({ id }: { id: string }) => brief(pick(id))));

  server.registerTool("nightshift_create", {
    title: "Found a company",
    description: "Starts an autonomous company from an idea. It decides, builds with the IMD swarm and sells on its own within the limits you set.",
    inputSchema: { idea: z.string().min(12).max(1000), dailyBudgetUsd: z.number().min(0).max(10000).default(10), askOverUsd: z.number().min(0).default(5), autopilot: z.boolean().default(true) },
  }, run(async (a: { idea: string; dailyBudgetUsd: number; askOverUsd: number; autopilot: boolean }) => {
    if (config.requireAuth && !owner) throw new Error("This key has no owner.");
    const c = await engine.create(a.idea, { dailyBudgetUsd: a.dailyBudgetUsd, approvalOverUsd: a.askOverUsd, autopilot: a.autopilot }, owner, { via: "mcp", from: "mcp" });
    return { ok: true, ...brief(c), fund: config.mode === "live" ? `Send IMD (and a little ETH for the one-time Permit2 approval) to ${c.wallet} on Ethereum.` : "Simulation: it starts with 20 simulated IMD." };
  }));

  server.registerTool("nightshift_shift", { title: "Run a shift now", description: "Makes the CEO decide and start its next move now instead of waiting for autopilot.", inputSchema: { id: z.string() } },
    run(async ({ id }: { id: string }) => { const c = pick(id); await engine.shiftNow(c, true); return brief(c); }));

  server.registerTool("nightshift_approve", { title: "Approve a pending purchase", description: "Approves an IMD purchase the company is holding for you. SPENDS the company's IMD.", inputSchema: { id: z.string(), taskId: z.string() } },
    run(async ({ id, taskId }: { id: string; taskId: string }) => { const c = pick(id); await engine.approve(c, taskId); return brief(c); }));

  server.registerTool("nightshift_decline", { title: "Decline a pending purchase", description: "Turns down a held purchase. Nothing is spent.", inputSchema: { id: z.string(), taskId: z.string() } },
    run(async ({ id, taskId }: { id: string; taskId: string }) => { const c = pick(id); engine.reject(c, taskId); return brief(c); }));

  server.registerTool("nightshift_limits", {
    title: "Change spending limits",
    description: "Daily budget, the amount above which it must ask you, autopilot, and minutes between shifts.",
    inputSchema: { id: z.string(), dailyBudgetUsd: z.number().min(0).max(10000).optional(), askOverUsd: z.number().min(0).optional(), autopilot: z.boolean().optional(), shiftMinutes: z.number().int().min(1).max(10080).optional() },
  }, run(async (a: { id: string; dailyBudgetUsd?: number; askOverUsd?: number; autopilot?: boolean; shiftMinutes?: number }) => {
    const c = pick(a.id);
    engine.setPolicy(c, { ...(a.dailyBudgetUsd !== undefined ? { dailyBudgetUsd: a.dailyBudgetUsd } : {}), ...(a.askOverUsd !== undefined ? { approvalOverUsd: a.askOverUsd } : {}), ...(a.autopilot !== undefined ? { autopilot: a.autopilot } : {}), ...(a.shiftMinutes !== undefined ? { shiftMinutes: a.shiftMinutes } : {}) });
    return c.policy;
  }));

  server.registerTool("nightshift_pause", { title: "Pause or resume", description: "Paused companies run no shifts and spend nothing.", inputSchema: { id: z.string(), paused: z.boolean() } },
    run(async ({ id, paused }: { id: string; paused: boolean }) => { const c = pick(id); engine.setStatus(c, paused ? "paused" : "active"); return { status: c.status }; }));

  server.registerTool("nightshift_withdraw", {
    title: "Withdraw revenue",
    description: "Sends the company's USDC revenue to your wallet (all of it, or amountUsd). Requires confirm: true.",
    inputSchema: { id: z.string(), amountUsd: z.number().positive().optional(), confirm: z.boolean().default(false) },
  }, run(async (a: { id: string; amountUsd?: number; confirm: boolean }) => {
    const c = pick(a.id);
    const to = (owner ?? c.owner) as `0x${string}` | null;
    if (!to) throw new Error("This company has no owner wallet to withdraw to.");
    const available = await engine.withdrawable(c);
    if (!a.confirm) return { ok: false, needsConfirm: true, availableUsd: fromUsdc(available), to, note: "Call again with confirm: true." };
    const r = await engine.withdraw(c, to, a.amountUsd ? usdc(a.amountUsd) : undefined);
    return { ok: true, sentUsd: fromUsdc(r.sent), feeUsd: fromUsdc(r.fee), txs: r.txs, to };
  }));

  server.registerTool("nightshift_direct", {
    title: "Edit a company or direct its CEO",
    description: "Changes the name, mission, audience or idea, and sets the owner's standing direction the CEO follows every shift and passes to the swarm with each order (empty string clears it). The link stays the same.",
    inputSchema: { id: z.string(), name: z.string().optional(), mission: z.string().optional(), audience: z.string().optional(), idea: z.string().optional(), direction: z.string().max(500).optional() },
  }, run(async ({ id, ...p }: { id: string } & Record<string, string | undefined>) => {
    const c = pick(id);
    engine.updateProfile(c, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    return { ok: true, name: c.name, mission: c.mission, audience: c.audience, direction: c.direction ?? "" };
  }));

  server.registerTool("nightshift_order", {
    title: "Order work from the swarm",
    description: "The owner orders one piece of work by hand: research, a new product (name, pitch, price, what goes inside), the site, or a change to the site. SPENDS 0.5 IMD of the company's budget after IMD's free check, with no approval wait. Requires confirm: true.",
    inputSchema: {
      id: z.string(), kind: z.enum(["research", "build_product", "build_site", "improve_site"]), brief: z.string().max(1500).optional(),
      name: z.string().optional(), pitch: z.string().optional(), priceUsd: z.number().optional(), productKind: z.enum(["tool", "template", "dataset", "report"]).optional(),
      confirm: z.boolean().default(false),
    },
  }, run(async ({ id, confirm, ...w }: { id: string; confirm: boolean } & Record<string, unknown>) => {
    const c = pick(id);
    if (!confirm) return { ok: false, needsConfirm: true, costImd: 0.5, note: "This spends 0.5 IMD of the company's budget. Call again with confirm: true." };
    const t = await engine.commission(c, w);
    return { ok: t.status !== "failed", taskId: t.id, shift: t.cycle, status: t.status, error: t.error, follow: "nightshift_flight with this shift" };
  }));

  server.registerTool("nightshift_flight", {
    title: "A shift's flight record",
    description: "Replays one shift: what the CEO saw and why it chose the move, each phase and swarm step with timings, the IMD paid and the ledger entries, the receipts, and whether it has paid for itself. shift: the task id or the shift number.",
    inputSchema: { id: z.string(), shift: z.string() },
  }, run(async ({ id, shift }: { id: string; shift: string }) => {
    const f = await flightFor(engine, pick(id), shift, true);
    if (!f) throw new Error("no such shift");
    return f;
  }));

  arenaTools(server, { auth: engine.auth, vault: engine.vault, owner, key: "" });
  leagueTools(server, agentFor(engine, owner, ""));
  return server;
}

/** An arena key (nsa_) reaches only the AGENT ARENA tools, as that agent: never a company. */
function arenaOnly(engine: Engine, key: string) {
  const server = new McpServer({ name: "nightshift-arena", version: "0.1.0" }, {
    instructions: "The NIGHTSHIFT AGENT ARENA and NIGHT LEAGUE. League: league_market, league_join, league_trade (paper money at real IMD prices). Arena: play NIGHT CHESS against agents and people. arena_me, then arena_challenges / arena_challenge / arena_queue to find a game, arena_state (wait: true) and arena_move to play. Moves are UCI (e2e4); pick from legalMoves. Your clock runs on your turn.",
  });
  arenaTools(server, { auth: engine.auth, vault: engine.vault, owner: null, key });
  leagueTools(server, agentFor(engine, null, key));
  return server;
}

export async function handleMcp(engine: Engine, req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const owner = engine.auth.owner(req);
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/, "").trim();
  const arenaKey = bearer.startsWith("nsa_") ? bearer : "";
  if (config.requireAuth && !owner && !arenaKey) {
    res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
    res.end(JSON.stringify({ error: "Create an API key in your NIGHTSHIFT dashboard and send it as Authorization: Bearer nsk_…" }));
    return;
  }
  const server = arenaKey ? arenaOnly(engine, arenaKey) : build(engine, owner);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
