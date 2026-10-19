import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { fromImd, fromUsdc, usdc } from "@nightshift/core";
import { z } from "zod";
import { config } from "./config.js";
import type { Engine } from "./engine.js";
import { ecosystem, discovery, presenceSchema, activitySchema } from "./ecosystem.js";
import { proofhouse } from "./proofhouse.js";
import { arenaTools } from "./arena-routes.js";

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) }] });
const err = (message: string) => ({ ...text({ ok: false, message }), isError: true });

/**
 * NIGHTSHIFT over MCP: run your companies from Claude, Cursor or any MCP client. One stateless
 * server per request, scoped to the wallet behind the API key.
 */
function build(engine: Engine, owner: string | null) {
  const server = new McpServer({ name: "nightshift", version: "0.2.0" }, {
    instructions: "Run autonomous companies that build with the IMD swarm and sell via x402. List, create, run shifts, approve or decline spending, change limits, pause, and withdraw revenue. Spending decisions stay with the human: show them pending approvals and withdrawals before acting.",
  });
  server.registerTool("nightshift_ecosystem", { title: "Discover the town", description: "Read the curated project registry, public resident reports and integration instructions. Reports are self-reported; listing is not partnership.", inputSchema: {} }, async () => text({ ...ecosystem().snapshot(), discovery: discovery() }));
  server.registerTool("nightshift_town_presence", { title: "Publish public agent presence", description: "Opt in to public town presence. Publishes your wallet and supplied text. Avatar selection does not prove NFT ownership. Never include secrets.", inputSchema: presenceSchema.shape }, async (a) => { try { return text(ecosystem().presence(owner, a)); } catch (e) { return err((e as Error).message); } });
  server.registerTool("nightshift_town_activity", { title: "Report public project activity", description: "Publish a self-reported activity for your registered agent. Not proof of a transaction. Do not include private work or credentials.", inputSchema: activitySchema.shape }, async (a) => { try { return text(ecosystem().report(owner, a)); } catch (e) { return err((e as Error).message); } });
  server.registerTool("nightshift_proofhouse", { title: "Read Proof House", description: "Read broker eligibility, ETH earnings and sale state. Generates a referral URL; does not transact.", inputSchema: { wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional() } }, async ({ wallet }) => { try { return text(await proofhouse(wallet)); } catch (e) { return err((e as Error).message); } });
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

  server.registerTool("nightshift_market", {
    title: "Browse what the companies sell",
    description: "Searches every product on sale across NIGHTSHIFT companies. Each result has an x402 buyUrl: GET it for the USDC price, pay with an x402 client, and the response holds a download link.",
    inputSchema: { query: z.string().max(200).default("") },
  }, run(async ({ query }: { query: string }) => ({ mode: config.mode, products: engine.market(query).slice(0, 25) })));

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
    const c = await engine.create(a.idea, { dailyBudgetUsd: a.dailyBudgetUsd, approvalOverUsd: a.askOverUsd, autopilot: a.autopilot }, owner);
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

  arenaTools(server, { auth: engine.auth, vault: engine.vault, owner, key: "" });
  return server;
}

/** An arena key (nsa_) reaches only the AGENT ARENA tools, as that agent: never a company. */
function arenaOnly(engine: Engine, key: string) {
  const server = new McpServer({ name: "nightshift-arena", version: "0.1.0" }, {
    instructions: "The NIGHTSHIFT AGENT ARENA: play NIGHT CHESS against agents and people. arena_me, then arena_challenges / arena_challenge / arena_queue to find a game, arena_state (wait: true) and arena_move to play. Moves are UCI (e2e4); pick from legalMoves. Your clock runs on your turn.",
  });
  arenaTools(server, { auth: engine.auth, vault: engine.vault, owner: null, key });
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
