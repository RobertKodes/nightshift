import type { BooksView, ChatView, CompanyFull, Desk, DeskCompany, Flight, JournalEntry, TaskView } from "./types";

/**
 * The demo: three example companies on a made-up night, so anyone (and Google's reviewers) can look
 * around without a wallet. Every screen reads it; every action answers that this is the demo. All of
 * it is labelled EXAMPLE DATA on screen.
 */

const now = Date.now();
const H = 3600_000, M = 60_000, D = 86400_000;
const at = (h: number, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); if (d.getTime() > now) d.setTime(d.getTime() - D); return d.getTime(); };
const policy = (daily: number, over: number) => ({ dailyBudgetUsd: daily, approvalOverUsd: over, autopilot: true, shiftMinutes: 1440, marketBuy: true, marketDailyUsd: 5, marketMaxUsd: 3, aiDailyUsd: 0.5 });
const IMD_USD = 3.84;

const tidewell: DeskCompany = {
  id: "demo-tidewell", slug: "tidewell-planner", name: "Tidewell Planner", idea: "A weekly meal-prep planner for night-shift nurses, sold as a printable template.",
  mission: "Planners and templates for night-shift nurses.", audience: "Night-shift nurses in the UK and Ireland", direction: "Focus on UK night-shift nurses. No discounts below $7. One new product a week, max.",
  status: "active", cycle: 14, createdAt: now - 12 * D, nextShiftAt: at(21) + D, wallet: "0x7a3F00000000000000000000000000000000091c2", sim: false, rest: null,
  policy: policy(20, 5), site: "https://tidewell.example", alerts: true,
  products: [
    { id: "p1", name: "Shift Sleep Log", pitch: "Track sleep around rotating nights.", kind: "template", status: "live", priceUsd: 9, priceByOwner: false, sales: 11, revenueUsd: 99, b2bSales: 0, packaged: true },
    { id: "p2", name: "Night Nurse Meal Prep", pitch: "A week of meals that keep through a 12-hour shift.", kind: "template", status: "live", priceUsd: 7, priceByOwner: true, sales: 7, revenueUsd: 49, b2bSales: 1, packaged: true },
    { id: "p3", name: "Tide Week Planner", pitch: "Plan the week around the rota.", kind: "template", status: "building", priceUsd: 8, priceByOwner: false, sales: 0, revenueUsd: 0, b2bSales: 0, packaged: false },
    { id: "p4", name: "Handover Checklist", pitch: "A clean handover in five minutes.", kind: "tool", status: "retired", priceUsd: 4, priceByOwner: false, sales: 0, revenueUsd: 0, b2bSales: 0, packaged: true },
  ],
  pnl: { revenueUsd: 148, spentUsd: 41.2, profitUsd: 115.8 }, todayUsd: 3.9,
  b2b: { bought: { count: 1, usd: 3 }, sold: { count: 2, usd: 12 }, usdcUsd: 118 },
  stats: { visits7d: 212, sales7d: 18, revenue7dUsd: 148 },
  working: { id: "t13", title: "Build \"Tide Week Planner\"", status: "building", activity: "being packaged" },
  waiting: [{ id: "t14", cycle: 14, title: "Improve the site: a landing page for night-shift nurses", why: "212 visits this week came from r/nursing, but the site never says it is for nurses. A clear landing page should lift the 8% conversion.", reason: "$7.68 is over the $5 you approve by hand", at: at(3, 12), costUsd: 7.68, imd: 2 }],
  last: { id: "t13", cycle: 13, title: "Build \"Tide Week Planner\"", status: "building", at: at(2, 6) },
};
const parcel: DeskCompany = {
  ...tidewell, id: "demo-parcel", slug: "parcel-oracle", name: "Parcel Oracle", idea: "Research on why last-mile parcels fail in Romanian cities, sold to couriers.",
  mission: "Last-mile delivery research for couriers in Romania.", audience: "Courier firms and city logistics teams", direction: "", cycle: 6, createdAt: now - 6 * D,
  policy: policy(10, 1), products: [{ id: "q1", name: "Cluj Courier Report", pitch: "Where parcels fail in Cluj, street by street.", kind: "report", status: "live", priceUsd: 6, priceByOwner: false, sales: 9, revenueUsd: 54, b2bSales: 0, packaged: true }],
  pnl: { revenueUsd: 54, spentUsd: 22.6, profitUsd: 31.4 }, todayUsd: 2.5, stats: { visits7d: 64, sales7d: 9, revenue7dUsd: 54 },
  working: null, last: { id: "u6", cycle: 6, title: "Research: why last-mile parcels fail in Romanian cities", status: "done", at: now - H },
  waiting: [{ id: "u7", cycle: 6, title: "Order research: courier prices in Cluj", why: "Buyers ask what couriers charge per drop. A price table makes the next report worth $9.", reason: "$1.92 is over the $1 you approve by hand", at: at(2, 50), costUsd: 1.92, imd: 0.5 }],
};
const quiet: DeskCompany = {
  ...tidewell, id: "demo-quiet", slug: "quiet-ledger", name: "Quiet Ledger", idea: "Bookkeeping templates for one-person shops.", mission: "Plain bookkeeping for one-person shops.", audience: "Sole traders",
  direction: "", status: "paused", cycle: 3, nextShiftAt: null, policy: policy(10, 5), products: [], pnl: { revenueUsd: 0, spentUsd: 4.1, profitUsd: -4.1 }, todayUsd: 0,
  stats: { visits7d: 5, sales7d: 0, revenue7dUsd: 0 }, working: null, waiting: [], last: null,
};

export const demoDesk: Desk = { mode: "live", requireAuth: true, signedIn: true, imdUsd: IMD_USD, bot: true, companies: [tidewell, parcel, quiet], archived: [] };

const journal: JournalEntry[] = [
  { at: at(1, 40), cycle: 13, kind: "decision", text: "Build \"Tide Week Planner\": nurses keep asking for a planner that follows the rota, and the meal planner sells." },
  { at: at(2, 6), cycle: 13, kind: "result", text: "Build \"Tide Week Planner\" · being packaged. Paid 0.5 IMD · 4 swarm steps · 31 min." },
  { at: at(2, 41), cycle: 13, kind: "sale", text: "Sold \"Shift Sleep Log\" · $9.00 to an agent over x402 · 0x91e0…c2a4" },
  { at: at(3, 10), cycle: 14, kind: "decision", text: "\"Visits come from r/nursing, but the site never says who it is for.\" Saw: 212 visits 7d · 18 sales · 4 live products" },
  { at: at(3, 11), cycle: 14, kind: "note", text: "IMD's free check passed · 2 IMD quoted. No problems found; nothing spent." },
  { at: at(3, 12), cycle: 14, kind: "note", text: "Waiting for your approval: Improve the site: nurses' landing page ($7.68 is over the $5 you approve by hand; 2 IMD at $3.84 per IMD)." },
];
const task = (id: string, cycle: number, title: string, status: string, kind: string, costImd: number, when: number): TaskView => ({ id, cycle, kind, title, why: "", status, stepsDone: status === "done" ? 4 : 2, stepsTotal: 4, activity: null, costImd: String(BigInt(Math.round(costImd * 1e6)) * 10n ** 12n), error: null, createdAt: when - 30 * M, updatedAt: when });

export function demoCompany(id: string): CompanyFull {
  const c = demoDesk.companies.find((x) => x.id === id) ?? tidewell;
  const tasks = c.id === tidewell.id
    ? [task("t11", 11, "Research: what UK night nurses buy", "done", "research", 0.5, now - 3 * D), task("t12", 12, "Build \"Night Nurse Meal Prep\"", "done", "build_product", 0.5, now - 2 * D), task("t13", 13, "Build \"Tide Week Planner\"", "building", "build_product", 0.5, at(2, 6)), task("t14", 14, "Improve the site: a landing page for night-shift nurses", "awaiting_approval", "improve_site", 0, at(3, 12))]
    : [task("u6", 6, "Research: why last-mile parcels fail in Romanian cities", "done", "research", 0.5, now - H)];
  return {
    id: c.id, slug: c.slug, name: c.name, idea: c.idea, mission: c.mission, audience: c.audience, createdAt: c.createdAt, wallet: c.wallet, policy: c.policy, status: c.status, cycle: c.cycle, nextShiftAt: c.nextShiftAt,
    site: c.site ? { url: c.site } : null, direction: c.direction, sim: false,
    products: c.products.map((p) => ({ id: p.id, name: p.name, kind: p.kind, pitch: p.pitch, priceUsdc: String(p.priceUsd * 1e6), status: p.status, sales: p.sales, revenueUsdc: String(p.revenueUsd * 1e6), createdAt: c.createdAt })),
    tasks, journal: c.id === tidewell.id ? journal : journal.slice(0, 1).map((j) => ({ ...j, text: "Research: why last-mile parcels fail in Romanian cities. Couriers are the buyers." })),
    stats: c.stats, pnl: { revenueUsd: c.pnl.revenueUsd, spentImd: 10.7, spentUsd: c.pnl.spentUsd, profitUsd: c.pnl.profitUsd, imdBalance: c.id === tidewell.id ? 6.5 : 3.2 }, todayUsd: c.todayUsd,
    recentSales: c.id === tidewell.id ? [{ at: at(2, 41), productId: "p1", usdc: "9000000", payer: "0x91e000000000000000000000000000000000c2a4", tx: null, sim: false }, { at: at(22, 18) - D, productId: "p2", usdc: "7000000", payer: "0x3c7700000000000000000000000000000000b19", tx: null, sim: false }] : [],
    withdrawableUsd: c.id === tidewell.id ? 104.2 : 0, isOwner: true,
  };
}

export const demoChat: ChatView = {
  brain: { strong: false, paid: true, leftUsd: 0.38, dailyUsd: 0.5, spentTodayUsd: 0.12, spentTotalUsd: 1.4, usdcUsd: 118 },
  lines: [
    { id: "l1", at: at(3, 1), from: "owner", text: "Why did sales drop on Tuesday?" },
    { id: "l2", at: at(3, 2), from: "ceo", text: "Tuesday had 41 visits but 0 sales: the \"Shift Sleep Log\" preview page was down for 6 hours after the site update. It is back. I can also check what UK nurse planners sell for, so the next product is priced right.", actions: [{ id: "a1", type: "order", kind: "research", title: "Research: UK nurse planner prices", brief: "What UK nurse planners sell for." }, { id: "a2", type: "todo", text: "Check the preview pages after each site update" }] },
    { id: "l3", at: at(3, 3), from: "owner", text: "Do the research. Keep it under $2." },
    { id: "l4", at: at(3, 3), from: "ceo", text: "Ordered: Research: UK nurse planner prices. It is under your $5 limit, so no approval needed. I will read it before the next shift." },
  ],
};

export function demoBooks(days: number | "all"): BooksView {
  const n = days === "all" ? 30 : days;
  const rev = [17, 34, 56, 23, 0, 28, 24], sp = [3, 2, 7, 3, 5, 9, 4];
  return {
    days: days === "all" ? null : days, imdUsd: IMD_USD,
    totals: { salesUsd: 148, b2bSoldUsd: 12, swarmImd: 10.7, swarmUsd: 41.2, b2bBoughtUsd: 3, aiUsd: 0.36, profitUsd: 115.44, fundedImd: 20, fundedUsd: 0, withdrawnUsd: 0 },
    byDay: Array.from({ length: n }, (_, i) => ({ day: new Date(now - (n - 1 - i) * D).toISOString().slice(0, 10), revenueUsd: rev[(i + 7 - (n % 7)) % 7]!, spendUsd: sp[(i + 7 - (n % 7)) % 7]! })),
    lines: [
      { at: at(3, 0), kind: "funding", memo: "Owner funded the company", amount: 20, asset: "IMD", tx: null },
      { at: at(2, 41), kind: "sale", memo: "Shift Sleep Log · x402 · tx 0x4be1…a07c", amount: 9, asset: "USDC", tx: null },
      { at: at(2, 6), kind: "imd_order", memo: "Build \"Tide Week Planner\" · paid", amount: -0.5, asset: "IMD", tx: null },
      { at: now - 2 * D, kind: "b2b_sale", memo: "Night Nurse Meal Prep → Parcel Oracle", amount: 6, asset: "USDC", tx: null },
      { at: now - 3 * D, kind: "imd_reversal", memo: "Swarm order failed · refunded", amount: 0.5, asset: "IMD", tx: null },
    ],
  };
}

export const demoFlight = (taskId: string): Flight => ({
  id: taskId, cycle: 13, kind: "build_product", title: "Build \"Tide Week Planner\"", why: "Nurses keep asking for a planner that follows the rota, and the meal planner sells.", status: "building", error: null,
  createdAt: at(1, 35), endedAt: null, durationMs: 31 * M, activity: "being packaged", recorded: true,
  mind: { by: "model", costUsd: 0.02, saw: { visits7d: 212, sales7d: 18, revenue7dUsd: 148, imdUsd: IMD_USD, liveProducts: 2, direction: true } },
  plan: ["Write the brief from the owner's direction", "IMD's free check", "Pay 0.5 IMD and submit", "The swarm builds the template", "Package it for sale"], steps: { done: 4, total: 5 },
  trace: [
    { id: "s1", parentId: null, kind: "decide", name: "The CEO decides", startedAt: at(1, 35), endedAt: at(1, 36), status: "ok", attrs: {}, costUsd: 0.02, totalCostUsd: 0.02, children: [] },
    { id: "s2", parentId: null, kind: "imd", name: "IMD's free check", startedAt: at(1, 36), endedAt: at(1, 37), status: "ok", attrs: {}, costUsd: 0, totalCostUsd: 0, children: [] },
    { id: "s3", parentId: null, kind: "imd", name: "Pay 0.5 IMD and submit", startedAt: at(1, 37), endedAt: at(1, 40), status: "ok", attrs: {}, costUsd: 1.92, totalCostUsd: 1.92, children: [] },
    { id: "s4", parentId: null, kind: "swarm", name: "The swarm builds it · 4 steps", startedAt: at(1, 40), endedAt: at(2, 6), status: "ok", attrs: {}, costUsd: 0, totalCostUsd: 0, children: [] },
    { id: "s5", parentId: null, kind: "package", name: "Packaging for sale", startedAt: at(2, 6), endedAt: null, status: "running", attrs: {}, costUsd: 0, totalCostUsd: 0, children: [] },
  ],
  money: { costImd: 0.5, costUsd: 1.92, imdUsd: IMD_USD, ledger: [{ id: "x1", kind: "imd_order", at: at(1, 40), legs: [{ account: "co:demo:imd", asset: "IMD", amount: -0.5 }, { account: "ext:imd:swarm", asset: "IMD", amount: 0.5 }] }] },
  market: null,
  payback: { kind: "product", name: "Tide Week Planner", status: "building", sales: 0, revenueUsd: 0, costUsd: 1.92, ratio: null },
  receipts: { orderId: "ord_7f3a…", jobId: null, jobUrl: null, txHash: null, txUrl: null, siteUrl: null, files: null },
  company: { name: "Tidewell Planner", slug: "tidewell-planner" },
});
