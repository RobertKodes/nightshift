import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Quote } from "@nightshift/swap";
import { SWARM_KINDS, SWARM_PITCH, SWARM_SKILLS, publicRepo, swarmBody } from "./swarm-kinds.js";
import { ImdQueue } from "./swarm-rate.js";
import { BASE_GAS_FLOOR, REFILL_ETH, REFILL_IMD, REFILL_USDC, SwarmRefill, checkRefillRoute, type RefillKind, type SwarmRefillDeps } from "./swarm-refill.js";

const HOUSE = "0x4444444444444444444444444444444444444444";
const ROUTER = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";
const TX = `0x${"a".repeat(64)}` as const;
const UNIT = 10n ** 18n;
const brief = "Deliver the requested work with concrete examples and checks.";
const repo = "https://github.com/example/contracts";
const commit = "a".repeat(40);
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/swarm-quotes.json", import.meta.url), "utf8")) as { imdUsd: number; quotes: { input: { kind: string; brief?: string; repo?: string; commit?: string; chain?: string; address?: string; name?: string; style?: string }; answer: { quoteId: string; kind: string; priceUsd: number; pay: string } }[] };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) { if (!resolve(dir).startsWith(resolve(join(tmpdir(), "swarm-scale-")))) throw new Error("Unexpected directory"); rmSync(dir, { recursive: true, force: true }); } });

describe("Swarm job bodies", () => {
  it("validates all documented fixture quotes and the common price formula", async () => {
    const { swarmPrice } = await import("./swarm.js");
    for (const { input, answer } of fixtures.quotes) {
      const { kind, brief, repo, ...extra } = input;
      expect(swarmBody(kind, brief ?? null, repo ?? null, answer.quoteId, extra).kind).toBe(answer.kind);
      expect(swarmPrice(fixtures.imdUsd)).toBe(answer.priceUsd);
      expect(answer.pay).toBe(`https://getnightshift.tech/api/v1/swarm/order?quoteId=${answer.quoteId}`);
    }
  });
  it.each(SWARM_KINDS)("builds a checked %s body without replacing the requested skill", (kind) => {
    const extra = kind === "tests" ? { commit } : kind === "frontend" ? { chain: "base", address: HOUSE } : kind === "logo" ? { name: "NIGHTSHIFT", style: "minimal moon emblem" } : {};
    const b = swarmBody(kind, brief, ["tests", "review", "audit"].includes(kind) ? repo : null, "example-id", extra).body;
    expect(b.objective).toContain(kind === "tests" ? commit : kind === "logo" ? "NIGHTSHIFT" : brief);
    if (kind === "audit") expect(b.template).toBe("audit");
    else if (kind === "contract") expect(b.steps).toEqual([{ skill: "build-contract-project" }, { skill: "adversarial-review" }]);
    else expect(b.skill).toBe(SWARM_SKILLS[kind]);
    if (kind === "tests") expect(b).toMatchObject({ repoUrl: repo, baseCommit: commit, github: true });
    if (kind === "frontend") expect(b).toMatchObject({ chainId: 8453, contractAddress: HOUSE });
    if (["image", "logo"].includes(kind)) expect(b.outputs).toEqual([{ name: kind, path: `artifacts/${kind}.png`, mediaType: "image/png" }]);
  });
  it("requires a pinned full commit for tests and rejects irrelevant or unsafe inputs", () => {
    expect(() => swarmBody("tests", brief, repo, "id")).toThrow("commit");
    expect(() => swarmBody("tests", brief, repo, "id", { commit: "main" })).toThrow("commit");
    expect(() => swarmBody("image", brief, repo, "id")).toThrow("repo");
    expect(() => swarmBody("review", brief, repo, "id", { chain: "base" })).toThrow("chain");
    expect(() => swarmBody("frontend", brief, null, "id", { chain: "solana", address: HOUSE })).toThrow("frontend");
    expect(() => swarmBody("logo", null, null, "id", { name: "x", style: "\nhi" })).toThrow("logo");
    expect(() => swarmBody("image", "x".repeat(1501), null, "id")).toThrow("brief");
    for (const r of ["https://github.com/a/b/tree/main", "https://127.0.0.1/a/b", "https://github.com/a/b?token=x", "https://u:p@github.com/a/b"]) expect(() => publicRepo(r)).toThrow("repo");
    expect(swarmBody("logo", null, null, "id", { name: "NIGHTSHIFT", style: "flat moon" }).body.skill).toBe("token-logo");
    expect(SWARM_PITCH.length).toBeLessThan(480);
    expect(SWARM_PITCH).toMatch(/^Use when an agent needs/);
  });
});

function route(kind: RefillKind, amount: bigint): Quote {
  const out = amount * (kind === "imd" ? 10n ** 12n : 10n ** 9n);
  return { id: "quote", provider: "lifi", providerName: "LI.FI", tool: "across", fromChain: "base", toChain: "eth", sender: HOUSE, recipient: HOUSE,
    fromToken: { chain: "base", address: REFILL_USDC, decimals: 6, symbol: "USDC", name: "USDC", verified: true, priceUsd: 1 },
    toToken: { chain: "eth", address: kind === "imd" ? REFILL_IMD : REFILL_ETH, decimals: 18, symbol: kind === "imd" ? "IMD" : "ETH", name: kind, verified: true, priceUsd: null },
    fromAmount: amount.toString(), toAmount: out.toString(), toAmountMin: out.toString(), fromUsd: Number(amount) / 1e6, toUsd: null,
    steps: [], fees: [], gasUsd: null, nightshift: { bps: 0, usd: 0, amount: "0", waived: true, note: "internal" }, etaSeconds: 60, slippage: 0.03,
    approval: { token: REFILL_USDC, spender: ROUTER, amount: amount.toString() }, txs: [{ kind: "evm", chainId: 8453, to: ROUTER, data: "0x1234", value: "0", gas: "200000" }], contracts: [], track: { provider: "lifi", tool: "across" }, problems: [] };
}
function refill(file: string | null = null) {
  const h = { now: 10_000, imd: 3n * UNIT, reserved: UNIT, eth: UNIT / 100n, baseEth: BASE_GAS_FLOOR + UNIT / 100n, usdc: 100_000_000n, float: 5n * UNIT, revenue: 20_000_000n, refundOwed: false, enabled: true };
  const deps: SwarmRefillDeps = { file, now: () => h.now, enabled: () => h.enabled, float: () => h.float, reserved: () => h.reserved, house: () => HOUSE,
    credits: () => [{ orderId: "order", at: h.now, units: h.revenue.toString(), reserveUnits: (h.revenue / 2n).toString(), refundOwed: h.refundOwed }],
    funds: vi.fn(async () => ({ imd: h.imd, eth: h.eth, baseEth: h.baseEth, usdc: h.usdc })),
    quote: vi.fn(async (kind, amount) => route(kind, amount)), cost: vi.fn(async () => 10_000n),
    sign: vi.fn(async () => ({ hash: TX, raw: "0x1234" as const, nonce: 1 })), broadcast: vi.fn(async () => {}), state: vi.fn(async () => "success" as const),
    delivery: vi.fn(async (o) => ({ state: "done" as const, tx: TX, amount: o.route.toAmountMin })), alert: vi.fn(async () => true), spent: vi.fn(async () => {}) };
  return { h, deps, desk: new SwarmRefill(deps) };
}

describe("Swarm revenue refills", () => {
  it("buys the float deficit after job reservations, spends only its revenue and coalesces ticks", async () => {
    const x = refill(); await Promise.all([x.desk.tick(), x.desk.tick()]);
    expect(x.deps.quote).toHaveBeenLastCalledWith("imd", 3_000_000n);
    expect(x.desk.status()).toMatchObject({ revenueUsd: 10, unspentUsd: 7, active: null, refills: [{ kind: "imd", usd: 3, phase: "done", delivered: (3n * UNIT).toString() }] });
    expect(x.deps.sign).toHaveBeenCalledTimes(2);
    expect(x.deps.alert).toHaveBeenCalledWith(expect.stringContaining("completed"));
  });
  it("partially restores IMD when only the desk's post-reserve share can pay", async () => {
    const x = refill(); x.h.revenue = 2_000_000n; await x.desk.tick();
    expect(x.desk.status()).toMatchObject({ unspentUsd: 0, refills: [{ usd: 1, delivered: UNIT.toString() }] });
    expect(x.deps.quote).toHaveBeenCalledExactlyOnceWith("imd", 1_000_000n);
  });
  it("holds refund revenue and refuses to use other house money", async () => {
    const x = refill(); x.h.refundOwed = true; await x.desk.tick();
    expect(x.deps.sign).not.toHaveBeenCalled(); expect(x.deps.quote).not.toHaveBeenCalled(); expect(x.desk.heldUsdc()).toBe(20_000_000n);
    expect(x.deps.alert).toHaveBeenCalledWith(expect.stringContaining("No unspent"));
  });
  it("refills exactly 0.002 ETH below 0.001 and preserves the Base gas floor", async () => {
    const x = refill(); x.h.eth = 999_999_999_999_999n; await x.desk.tick();
    expect(x.deps.quote).toHaveBeenLastCalledWith("gas", 2_000_000n);
    expect(x.desk.status().refills[0]).toMatchObject({ kind: "gas", delivered: "2000000000000000" });
    const y = refill(); y.h.baseEth = BASE_GAS_FLOOR; await y.desk.tick();
    expect(y.deps.sign).not.toHaveBeenCalled(); expect(y.desk.status().error).toContain("gas floor");
    const z = refill(); z.h.eth = 0n; z.h.revenue = 1_000_000n; await z.desk.tick(); expect(z.deps.sign).not.toHaveBeenCalled();
  });
  it("checks saved transactions on chain before rebroadcasting the identical bytes after a lost answer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "swarm-scale-")); dirs.push(dir); const file = join(dir, "refill.json"), x = refill(file);
    vi.mocked(x.deps.broadcast).mockImplementation(async () => { expect(JSON.parse(readFileSync(file, "utf8")).fills[0].legs[0]).toMatchObject({ submitted: true, signed: { raw: "0x1234" } }); throw new Error("lost answer"); });
    await x.desk.tick(); expect(x.deps.sign).toHaveBeenCalledTimes(1);
    const reloaded = new SwarmRefill(x.deps); vi.mocked(x.deps.state).mockResolvedValue("pending");
    x.h.now += 60_000; await reloaded.tick(); expect(x.deps.broadcast).toHaveBeenCalledTimes(1);
    x.h.now += 3_600_000; await reloaded.tick(); expect(x.deps.broadcast).toHaveBeenCalledTimes(2); expect(x.deps.sign).toHaveBeenCalledTimes(1);
    expect(x.deps.state).toHaveBeenCalled(); expect(x.deps.quote).toHaveBeenCalledTimes(2);
  });
  it("keeps one bridge in flight and never releases spent funds on accounting failure", async () => {
    const x = refill(); vi.mocked(x.deps.delivery).mockResolvedValue({ state: "pending" }); await x.desk.tick(); x.h.now += 3_600_000; await x.desk.tick();
    expect(x.deps.quote).toHaveBeenCalledTimes(2); expect(x.desk.status().refills).toHaveLength(1); expect(x.desk.status().active).toBeTruthy();
    const y = refill(); vi.mocked(y.deps.spent).mockRejectedValue(new Error("disk unavailable")); await y.desk.tick(); y.h.now += 3_600_000; await y.desk.tick();
    expect(y.deps.quote).toHaveBeenCalledTimes(2); expect(y.desk.status().unspentUsd).toBe(7); expect(y.desk.status().active).toBeTruthy();
  });
  it("retries failures hourly and obeys the persisted off switch", async () => {
    const x = refill(); vi.mocked(x.deps.quote).mockRejectedValue(new Error("no route")); await x.desk.tick(); await x.desk.tick(); expect(x.deps.quote).toHaveBeenCalledTimes(1);
    x.h.now += 3_600_000; await x.desk.tick(); expect(x.deps.quote).toHaveBeenCalledTimes(2);
    x.h.enabled = false; x.h.now += 3_600_000; await x.desk.tick(); expect(x.deps.quote).toHaveBeenCalledTimes(2);
  });
  it.each(["recipient", "chain", "token", "slippage", "spender", "router"])("refuses an unsafe %s", (bad) => {
    const q = route("imd", 1_000_000n);
    if (bad === "recipient") q.recipient = REFILL_USDC;
    if (bad === "chain") q.toChain = "base";
    if (bad === "token") q.toToken.address = REFILL_USDC;
    if (bad === "slippage") q.slippage = 0.031;
    if (bad === "spender") q.approval!.spender = HOUSE;
    if (bad === "router") (q.txs[0] as { to: string }).to = HOUSE;
    expect(() => checkRefillRoute(q, "imd", 1_000_000n, HOUSE)).toThrow();
  });
});

describe("IMD admission queue", () => {
  it("queues excess quotes and all requests without failing them", async () => {
    let now = 0; const waits: number[] = [], q = new ImdQueue(() => now, async (ms) => { waits.push(ms); now += ms; }, 3, 2), seen: number[] = [];
    await Promise.all(Array.from({ length: 5 }, (_, n) => q.run(true, async () => { seen.push(n); return n; })));
    expect(seen).toEqual([0, 1, 2, 3, 4]); expect(now).toBeGreaterThanOrEqual(120_000); expect(waits.length).toBeGreaterThan(0);
    now = 0; const all = new ImdQueue(() => now, async (ms) => { now += ms; }, 2, 2);
    await Promise.all([all.run(false, async () => 1), all.run(false, async () => 2), all.run(false, async () => 3)]); expect(now).toBeGreaterThanOrEqual(60_000);
  });
});
