import type { Company } from "@nightshift/core";
import type { LedgerTx } from "@nightshift/ledger";
import type { CrewMetrics } from "./crews/contracts.js";
import { INTERNAL_WALLETS } from "./crews/contracts.js";
import type { Metrics } from "./store.js";
import { isProbeClient, type Usage } from "./usage.js";
import type { ReserveProof } from "./agent-reserve.js";

/**
 * The public proof page: what actually happened, measured from the books, never typed in. Every number
 * says what it counts, from when, and what it leaves out. Payments are split by who paid (an outside
 * wallet, a NIGHTSHIFT wallet, a company's own owner, another NIGHTSHIFT company, or a simulation), so a
 * test or an internal purchase is never shown as demand. Costs are "known costs": there is no profit
 * figure while costs (hosting, free RPCs, people's time) are not all measured.
 */
export type PayerClass = "customer" | "internal" | "owner" | "b2b" | "test";

export type SwarmReceipt = { key: string; units: string; status: string; costUnits: string; refundOwed: boolean; refundPaid?: { tx: string; at: number } };

export type ProofInput = {
  companies: Company[];
  metrics(id: string): Metrics;
  ledger: LedgerTx[];
  usage: ReturnType<Usage["report"]>;
  crews?: { id: string; name: string; house: boolean; metrics: CrewMetrics }[];
  operators?: { registered: number; active: number };
  burns: { shift: number; imd: number };
  imdUsd: number | null;
  splitter: string | null;
  houseId: string;
  now?: number;
  agentReserve?: ReserveProof;
  swarm?: SwarmReceipt[];
};

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const usd = (units: bigint | string) => Number(BigInt(units)) / 1e6;

export function payerClass(payer: string, seller: Company, all: Company[], sim: boolean): PayerClass {
  const p = payer.toLowerCase();
  if (sim) return "test";
  if (INTERNAL_WALLETS.has(p)) return "internal";
  if (seller.owner && p === seller.owner.toLowerCase()) return "owner";
  if (all.some((c) => c.wallet.toLowerCase() === p)) return "b2b";
  if (all.some((c) => c.owner && c.owner.toLowerCase() === p)) return "owner";
  return "customer";
}

export type ProofPayment = { earnedUnits?: string; key: string; at: number; units: string; usd: number; payer: string; cls: PayerClass; house: boolean; service: string; product: string; tx: string | null; company: string };
/** The same settled sales for announcements, the reserve and /proof. */
export function proofPayments(i: Pick<ProofInput, "companies" | "metrics" | "houseId" | "swarm">): ProofPayment[] {
  const earned = new Map((i.swarm ?? []).map((o) => [o.key, o.status === "done" && !o.refundOwed && !o.refundPaid ? (BigInt(o.units) > BigInt(o.costUnits) ? BigInt(o.units) - BigInt(o.costUnits) : 0n).toString() : "0"]));
  return i.companies.flatMap((c) => i.metrics(c.id).sales.map((s) => ({
    key: `${s.payer.toLowerCase()}:${(s.nonce ?? s.tx ?? `legacy-${c.id}-${s.at}`).toLowerCase()}`,
    at: s.at, units: s.usdc, usd: usd(s.usdc), payer: s.payer.toLowerCase(),
    cls: payerClass(s.payer, c, i.companies, s.sim || (s.network !== undefined && s.network !== "eip155:8453")),
    house: c.id === i.houseId, service: s.productId,
    ...(s.productId === "swarm-order" ? { earnedUnits: earned.get(`${s.payer.toLowerCase()}:${(s.nonce ?? "").toLowerCase()}`) ?? "0" } : {}),
    product: c.products.find((p) => p.id === s.productId)?.name ?? "a product since removed", tx: s.tx, company: c.name,
  }))).sort((a, b) => a.at - b.at);
}
/** Only customer sales with a settlement transaction count as demand. */
export function customerPayments(pays: ProofPayment[]) { return pays.filter((p) => p.cls === "customer" && p.tx && /^0x[0-9a-f]{64}$/i.test(p.tx)); }
export function paymentSummary(pays: ProofPayment[]) {
  const customer = customerPayments(pays), wallets = new Map<string, number>();
  for (const p of customer) wallets.set(p.payer, (wallets.get(p.payer) ?? 0) + 1);
  return { payments: customer.length, wallets: wallets.size, repeatWallets: [...wallets.values()].filter((n) => n > 1).length, revenueUsd: round(Number(customer.reduce((n, p) => n + BigInt(p.units), 0n)) / 1e6) };
}

export function proof(i: ProofInput) {
  const now = i.now ?? Date.now();
  // ---- payments, from each company's sales record
  const pays = proofPayments(i), customer = customerPayments(pays), totals = paymentSummary(pays);
  const count = (cls: PayerClass) => pays.filter((p) => p.cls === cls).length;
  const settledBy: Record<string, number> = {};
  for (const e of i.ledger) if (e.kind === "sale") { const by = String((e.meta as { settledBy?: string } | undefined)?.settledBy ?? "not recorded"); settledBy[by] = (settledBy[by] ?? 0) + 1; }

  // ---- known costs and fees, from the ledger
  let imdToSwarm = 0n, aiUsdc = 0n, platformFees = 0n;
  const fees: { at: string; usd: number; tx: string }[] = [];
  for (const e of i.ledger) {
    for (const p of e.postings) {
      if (p.account === "ext:imd-swarm" && p.asset === "IMD") imdToSwarm += BigInt(p.amount);
      if (e.kind === "ai" && p.asset === "USDC" && BigInt(p.amount) > 0n && p.account.startsWith("ext:")) aiUsdc += BigInt(p.amount);
      if (p.account.startsWith("ext:platform:") && p.asset === "USDC") {
        platformFees += BigInt(p.amount);
        const hash = e.id.split(":")[1] ?? "";
        fees.push({ at: new Date(e.at).toISOString(), usd: usd(p.amount), tx: /^0x[0-9a-f]{64}$/i.test(hash) ? `https://basescan.org/tx/${hash}` : "" });
      }
    }
  }
  const imd = Number(imdToSwarm) / 1e18;

  // ---- agents on the MCP servers
  const clients = i.usage.mcp.clients.map((c) => ({ ...c, probe: isProbeClient(c.name) }));
  const firstUsage = i.usage.days[0]?.day ?? null;

  const refunds = (i.swarm ?? []).filter((o) => o.refundOwed);
  const owed = refunds.filter((o) => !o.refundPaid), paid = refunds.filter((o) => o.refundPaid);
  const firstPay = pays[0]?.at ?? null;
  return {
    generatedAt: new Date(now).toISOString(),
    period: { payments: firstPay ? { from: day(firstPay), to: day(now) } : null, agentUsage: firstUsage ? { from: firstUsage, to: day(now), note: "agent and page counting started with v0.303 (2026-10-25)" } : null },
    payments: {
      customer: {
        ...totals,
        houseServices: customer.filter((p) => p.house).length,
        companyProducts: customer.filter((p) => !p.house).length,
      },
      excluded: { internal: count("internal"), owner: count("owner"), b2b: count("b2b"), test: count("test") },
      settledBy,
      latest: customer.slice(-10).reverse().map((p) => ({ at: new Date(p.at).toISOString(), what: p.house ? p.product : `${p.product} (${p.company})`, usd: p.usd, wallet: short(p.payer), tx: p.tx ? `https://basescan.org/tx/${p.tx}` : null })),
    },
    agentReserve: i.agentReserve ?? { balanceUsd: 0, totalInUsd: 0, totalBoughtShift: "0", buys: [] },
    crews: (i.crews ?? []).map((c) => ({ id: c.id, name: c.name, house: c.house, done: c.metrics.done, failed: c.metrics.failed, paidJobs: c.metrics.customerPaidJobs, payingWallets: c.metrics.payingWallets, repeatWallets: c.metrics.repeatWallets, revenueUsd: round(c.metrics.revenueUsd), knownCostUsd: round(c.metrics.knownCostUsd), successRate: c.metrics.successRate })),
    refunds: { count: refunds.length, owedCount: owed.length, paidCount: paid.length, owedUsd: usd(owed.reduce((n, o) => n + BigInt(o.units), 0n)), paidUsd: usd(paid.reduce((n, o) => n + BigInt(o.units), 0n)), note: "Swarm Desk settles before ordering work. Failed delivery can leave a full USDC refund owed; paid totals require a recorded confirmed payout receipt. Other paid tools compute before settlement." },
    knownCosts: {
      swarmImd: round(imd, 4),
      swarmUsdAtTodaysPrice: i.imdUsd ? round(imd * i.imdUsd) : null,
      aiUsd: round(usd(aiUsdc)),
      notIncluded: "hosting, free public RPC nodes, Coinbase settlement after the free tier, and people's time",
    },
    fees: {
      platformUsd: round(usd(platformFees)),
      platformFees: fees.slice(-20).reverse(),
      burned: i.burns,
      splitter: i.splitter ? { address: i.splitter, events: `https://etherscan.io/address/${i.splitter}#events` } : null,
    },
    agents: {
      mcpSessions: i.usage.mcp.sessions,
      toolCalls: i.usage.mcp.calls,
      clients: clients.slice(0, 12),
      probeSessions: clients.filter((c) => c.probe).reduce((a, c) => a + c.count, 0),
      operators: i.operators ?? { registered: 0, active: 0 },
    },
    flows: [
      "A company's sale pays USDC on Base straight into that company's own wallet; the owner withdraws it.",
      "A withdrawal pays the platform fee (1.5%, or 0% for $SHIFT and NIGHT FROGS holders) to the NIGHTSHIFT treasury. That fee is the only part of company revenue NIGHTSHIFT receives.",
      "The house crews' services pay USDC on Base to the NIGHTSHIFT Services wallet, owned by the treasury.",
      "The FeeSplitter on Ethereum is a separate flow: it receives the $SHIFT pool's sell fees and splits them 40% rewards, 20% dev, 20% treasury, 20% burned. USDC revenue on Base does not reach it automatically.",
    ],
    definitions: {
      customer: "An outside wallet: not a NIGHTSHIFT wallet, not the seller's owner or any company owner, not a NIGHTSHIFT company, not a simulation. A wallet is not a person: one person can hold many.",
      excluded: "internal = NIGHTSHIFT's own wallets; owner = a company owner paying (their own or another company); b2b = one NIGHTSHIFT company buying from another; test = simulation.",
      probeSessions: "MCP sessions whose client name says it is a directory, scanner or health check. Sessions are connections; tool calls are the useful work.",
      knownCosts: "Only costs the books record. No profit is shown because the costs are incomplete.",
    },
  };
}
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
export type Proof = ReturnType<typeof proof>;
