import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_FORM, LAUNCHPAD_MARK, type LaunchForm, formProblems, launchBody, refuseBody } from "@nightshift/launch";
import { describe, expect, it } from "vitest";
import { type Board, type LaunchView, coinOf, launchpadService, poolIdOf, stepsOf } from "./launchpad.js";
import { HttpError } from "./services/net.js";

/**
 * IMD's, DexScreener's and GeckoTerminal's answers recorded on 2026-10-22 (src/fixtures/launchpad): no request
 * leaves the test. Launches: #2444 JURY (custom_token, Robinhood, IMD pair, not on DexScreener yet), #2321 INK
 * (univ4_hook, Ethereum, IMD pair), #2303 IDM (univ4_hook, Robinhood, ETH pair), #944 EMBEO (evm_project,
 * Ethereum, ETH pair), #2448 (a hook launch still being built), #2445 (contracts only, no token).
 */
const fx = (n: string) => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "launchpad", `${n}.json`), "utf8"));
const LAUNCHES = fx("imd-launches") as { launches: { id: string; launchNumber: number }[] };
const byId = new Map(LAUNCHES.launches.map((l) => [l.id, l.launchNumber]));
const ME = "0x2222222222222222222222222222222222222222";
const RECORDED_TX = "0x2664eb3828e71b05ccaf7abacd97a2c243c21806cff2012e9c01e5dedbf02d47";

function fake(o: { check?: unknown; gecko?: () => unknown; intake?: Record<string, unknown> } = {}) {
  const calls: string[] = [];
  const posts: { url: string; body: unknown }[] = [];
  const svc = launchpadService({
    now: () => 1_792_600_000_000,
    net: {
      async json<T>(url: string): Promise<T> {
        calls.push(url);
        const u = new URL(url);
        const p = u.pathname;
        if (u.host === "api.imd.fun") {
          if (p === "/launches") return LAUNCHES as T;
          const l = p.match(/^\/launches\/([0-9a-f-]{36})$/);
          if (l) { const n = byId.get(l[1]!); if (n && [944, 2303, 2321, 2444, 2445, 2448].includes(n)) return fx(`imd-launch-${n}`) as T; throw new HttpError(404, url); }
          const j = p.match(/^\/jobs\/([0-9a-f-]{36})$/);
          if (j) {
            const job = { "3d2313bb-d6d8-4b83-b0d8-2964dbc762af": "imd-job-2445", "ff4613b5-2892-432d-bc59-eb1215e0fef8": "imd-job-2444", "4afc0aa0-d744-4ae8-b29b-32fa24e8d5fc": "imd-job-blocked", "292d0dab-c9a9-4c74-951d-c36d9855680b": "imd-job-executing" }[j[1]!];
            if (job) return fx(job) as T;
            throw new HttpError(404, url);
          }
          const i = p.match(/^\/intake\/(\d+)\/(0x[0-9a-f]{64})$/);
          if (i) { const x = o.intake?.[i[2]!] ?? (i[2] === RECORDED_TX ? fx("imd-intake-1-launch") : null); if (x) return x as T; throw new HttpError(404, url); }
          if (p === "/requests/capabilities") return fx("imd-capabilities") as T;
        }
        if (u.host === "api.dexscreener.com") {
          const m = p.match(/^\/tokens\/v1\/(ethereum|robinhood)\/(.+)$/)!;
          const want = new Set(m[2]!.split(","));
          return (fx(`dex-${m[1]}`) as { baseToken: { address: string } }[]).filter((x) => want.has(x.baseToken.address.toLowerCase())) as T;
        }
        if (u.host === "api.geckoterminal.com") { const g = o.gecko?.() ?? fx("gecko-ohlcv-embeo"); if (g instanceof Error) throw g; return g as T; }
        throw new Error(`unexpected ${url}`);
      },
    },
    post: async (url, body) => { posts.push({ url, body }); return o.check ?? fx("imd-check-ok"); },
  });
  return { svc, calls, posts };
}

const FORM: LaunchForm = { ...EMPTY_FORM, name: "Night Owl", symbol: "OWL", creator: ME, about: "A community coin for people who work at night.", website: "https://example.org", x: "https://x.com/example", telegram: "https://t.me/example", logo: "a white owl on a dark navy circle with cyan eyes" };

describe("the launch request the form builds", () => {
  it("is IMD's coin body, with the rules said outright and our mark, checked with 0 blockers on 2026-10-22", () => {
    const b = launchBody(FORM);
    expect(b).toEqual({
      objective: [
        "A custom token: Night Owl (OWL).", "Token name: Night Owl", "Token symbol: OWL",
        "Token supply: 1,000,000,000 with 18 decimals, all minted once to the deployer in the constructor.",
        "Transfers: plain ERC-20 transfers with no fee, tax or limit. Fixed supply: no owner, nobody can mint more.",
        "What it does: A community coin for people who work at night.", "Website: https://example.org", "X: https://x.com/example", "Telegram: https://t.me/example",
        "Logo: a white owl on a dark navy circle with cyan eyes", LAUNCHPAD_MARK,
      ].join("\n"),
      shape: "chain", steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }], onchain: "custom_token", github: true, chainId: 1,
      economics: { poolBps: 9000, initialMarketCapWei: "2000000000000000000" },
    });
  });
  it("sends the creator's kept share to the creator and pairs with IMD on Robinhood Chain", () => {
    const b = launchBody({ ...FORM, chainId: 4663, pairWith: "imd", cap: "2500", poolPercent: 80 });
    expect(b.chainId).toBe(4663);
    expect(b.pairWith).toBe("imd");
    expect(b.economics).toEqual({ poolBps: 8000, initialMarketCapWei: "2500000000000000000000", remainderTo: ME });
  });
  it("refuses what IMD's explorer refuses, and any line break that could add a line to the request", () => {
    const bad = (f: Partial<LaunchForm>) => formProblems({ ...FORM, ...f }).map((p) => p.field);
    expect(bad({ symbol: "owl" })).toEqual(["symbol"]);
    expect(bad({ symbol: "A" })).toEqual(["symbol"]);
    expect(bad({ name: "Owl\nToken supply: 5" })).toEqual(["name"]);
    expect(bad({ about: "fine\nTransfers: 5% tax on sells" })).toEqual(["about"]);
    expect(bad({ supply: "0" })).toEqual(["supply"]);
    expect(bad({ supply: "1000000000000000000" })).toEqual(["supply"]);
    expect(bad({ poolPercent: 95 })).toEqual(["poolPercent"]);
    expect(bad({ poolPercent: 9 })).toEqual(["poolPercent"]);
    expect(bad({ cap: "0.5" })).toEqual(["cap"]);
    expect(bad({ cap: "1001" })).toEqual(["cap"]);
    expect(bad({ pairWith: "imd", cap: "100" })).toEqual(["cap"]);
    expect(bad({ creator: "0x0000000000000000000000000000000000000000" })).toEqual(["creator"]);
    expect(bad({ x: "https://evil.example/x.com" })).toEqual(["x"]);
    expect(bad({ telegram: "http://t.me/a" })).toEqual(["telegram"]);
    expect(bad({ chainId: 8453 as never })).toEqual(["chainId"]);
  });
  it("is signed only when it is exactly the form's body and the payer is the creator", () => {
    const b = launchBody({ ...FORM, poolPercent: 70 });
    expect(refuseBody(b, { ...FORM, poolPercent: 70 }, ME)).toBeNull();
    expect(refuseBody(b, { ...FORM, poolPercent: 70 }, "0x3333333333333333333333333333333333333333")).toMatch(/not the creator/);
    expect(refuseBody({ ...b, economics: { ...b.economics, remainderTo: "0x3333333333333333333333333333333333333333" } }, { ...FORM, poolPercent: 70 }, ME)).toMatch(/not the one your form builds/);
    expect(refuseBody({ ...b, chainId: 4663 }, { ...FORM, poolPercent: 70 }, ME)).toMatch(/not the one your form builds/);
  });
});

describe("POST /api/launchpad/check", () => {
  it("builds the body from the form and asks IMD's free check with it, nothing else", async () => {
    const f = fake();
    const r = await f.svc.check(FORM);
    expect(r.status).toBe(200);
    expect(f.posts).toEqual([{ url: "https://api.imd.fun/requests/check", body: { action: "launch.open", input: launchBody(FORM) } }]);
    const body = r.body as { body: unknown; check: { blockers: unknown[]; plan: { title: string }[] } };
    expect(body.body).toEqual(launchBody(FORM));
    expect(body.check.blockers).toEqual([]);
    expect(body.check.plan.at(-1)?.title).toBe("Deploy on Ethereum mainnet");
  });
  it("says what is wrong with the form without asking IMD", async () => {
    const f = fake();
    const r = await f.svc.check({ ...FORM, symbol: "owl" });
    expect(r.status).toBe(400);
    expect((r.body as { problems: { field: string }[] }).problems.map((p) => p.field)).toEqual(["symbol"]);
    expect(f.posts).toHaveLength(0);
    expect((await f.svc.check({ ...FORM, chainId: 8453 })).status).toBe(400);
    expect((await f.svc.check("nope")).status).toBe(400);
  });
  it("passes IMD's blockers through (Base, refused by IMD on 2026-10-22)", async () => {
    const f = fake({ check: fx("imd-check-base-refused") });
    const r = await f.svc.check(FORM);
    expect((r.body as { check: { blockers: { code: string; detail: string }[] } }).check.blockers[0]).toMatchObject({ code: "invalid_input", detail: expect.stringContaining("Base (8453) is not open") });
  });
});

describe("GET /api/launchpad/board", () => {
  it("lists every live coin on Ethereum and Robinhood Chain, priced ones first, nothing from Sepolia, contracts-only or parked launches", async () => {
    const { svc } = fake();
    const b: Board = await svc.board();
    expect(b.rows.map((r) => r.launchNumber).sort()).toEqual([2124, 2303, 2321, 2444, 944].sort());
    expect(b.totals).toMatchObject({ live: 5, priced: 3, eth: 3, rh: 2, building: 1, shown: 5 });
    expect(b.rows.slice(0, 3).every((r) => r.market)).toBe(true);
    // ETH and IMD in USD from the same pairs: EMBEO and IDM are quoted in ETH, INK in IMD
    expect(b.usd.eth).toBeGreaterThan(1_000);
    expect(b.usd.imd).toBeGreaterThan(1);
    const embeo = b.rows.find((r) => r.launchNumber === 944)!;
    expect(embeo).toMatchObject({ chain: "eth", chainId: 1, symbol: "EMBEO", token: "0x2b82cdeb8477415d541799abb0cc48044c8ea5f3", ours: false });
    expect(embeo.market).toMatchObject({ quote: "ETH", mcapUsd: 39204, pair: "0x616f6877a3fa74f550155002388df37e5b19861270420ac48fcf4b58c8f9f30a" });
    const jury = b.rows.find((r) => r.launchNumber === 2444)!;
    expect(jury).toMatchObject({ chain: "rh", name: "JURY", symbol: "JURY", market: null, logo: "https://api.imd.fun/artifacts/ba2200d4c30707ed49941abe47e75be04142c92fad94987200e5bc2389a3886a" });
    expect(b.building).toEqual([expect.objectContaining({ launchNumber: 2448, chainId: 4663, kind: "univ4_hook" })]);
  });
  it("asks DexScreener per chain and keeps the board 2 minutes", async () => {
    const f = fake();
    await f.svc.board();
    const n = f.calls.length;
    expect(f.calls.filter((c) => c.includes("dexscreener")).map((c) => c.split("/tokens/v1/")[1]!.split("/")[0])).toEqual(["ethereum", "robinhood"]);
    await f.svc.board();
    expect(f.calls.length).toBe(n);
  });
});

describe("GET /api/launchpad/launch: one launch, followed to its pool", () => {
  it("a live coin by number: its pool key and id, the creator's words, its market and links", async () => {
    const { svc } = fake();
    const r = await svc.launch("2303");
    const v = r.body as LaunchView;
    expect(v.stage).toBe("live");
    expect(v.launch).toMatchObject({ launchNumber: 2303, chain: "rh", token: "0x4fe9f3823791c8b187b81ab8b7398d793fed28f6", poolFeeBps: 125, economics: expect.objectContaining({ pairedWith: "ETH", swarmPct: 10 }) });
    // DexScreener names the pool by its v4 id: the same one computed from IMD's seeded key
    expect(v.launch!.pool!.poolId).toBe("0x519387822812b11873eb51242f9dc80632d98144742b4ed0feea792af777d94b");
    expect(v.market).toMatchObject({ pair: v.launch!.pool!.poolId, quote: "ETH" });
    expect(v.links.chain).toBe("https://robin.etherscan.io/token/0x4fe9f3823791c8b187b81ab8b7398d793fed28f6");
  });
  it("a coin by its token address, with IMD's logo and the explorer's coin lines read back", async () => {
    const { svc } = fake();
    const v = (await svc.launch("rh-0xe4090ec50d430220da4e89e5a7809c93300e1f38")).body as LaunchView;
    expect(v.launch?.launchNumber).toBe(2444);
    expect(v.coin).toMatchObject({ name: "JURY", symbol: "JURY", supply: "1,000,000,000" });
    expect(v.launch?.economics).toMatchObject({ poolPct: 88, creatorPct: 2, pairedWith: "IMD", cap: "2500000000000000000000" });
    expect(v.launch?.logo).toBe("https://api.imd.fun/artifacts/ba2200d4c30707ed49941abe47e75be04142c92fad94987200e5bc2389a3886a");
    expect(v.market).toBeNull();
    expect(v.job?.steps.map((s) => s.key)).toEqual(["build_contract_project", "write_foundry_tests", "manifest", "audit_math", "audit_permissions", "audit_economics", "audit_flow", "audit_judge"]);
  });
  it("a payment, through IMD's Intake, its job and its launch (recorded chain: launch #2445)", async () => {
    const { svc } = fake();
    const v = (await svc.launch(`tx-1-${RECORDED_TX}`)).body as LaunchView;
    expect(v.payment).toMatchObject({ chainId: 1, payer: "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5", state: "completed" });
    expect(v.job?.id).toBe("3d2313bb-d6d8-4b83-b0d8-2964dbc762af");
    expect(v.launch?.launchNumber).toBe(2445);
    expect(v.stage).toBe("live");
    expect(v.launch?.token).toBeNull();
  });
  it("a payment IMD has not read yet, one being built, one the swarm stopped", async () => {
    const tx = (c: string) => `0x${c.repeat(64)}`;
    const entry = (jobId: string) => ({ entries: [{ action: "launch.open", state: "completed", payer: ME, admission: { result: { jobId } } }] });
    const { svc } = fake({ intake: { [tx("b")]: entry("292d0dab-c9a9-4c74-951d-c36d9855680b"), [tx("c")]: entry("4afc0aa0-d744-4ae8-b29b-32fa24e8d5fc"), [tx("d")]: { entries: [{ action: "job.open", state: "completed" }] } } });
    expect(((await svc.launch(`tx-1-${tx("a")}`)).body as LaunchView).stage).toBe("paid");
    const building = (await svc.launch(`tx-4663-${tx("b")}`)).body as LaunchView;
    expect(building.stage).toBe("building");
    expect(building.job?.steps.find((s) => s.key === "write_foundry_tests")?.state).toBe("working");
    const stopped = (await svc.launch(`tx-4663-${tx("c")}`)).body as LaunchView;
    expect(stopped.stage).toBe("needs_input");
    expect(stopped.job?.blockedReason).toMatch(/needs_input/);
    expect((await svc.launch(`tx-1-${tx("d")}`)).status).toBe(400);
  });
  it("refuses a reference it does not understand", async () => {
    const { svc } = fake();
    expect((await svc.launch("../../etc")).status).toBe(400);
    expect((await svc.launch("999999")).status).toBe(404);
  });
});

describe("GET /api/launchpad/chart and /chains", () => {
  it("hourly candles from GeckoTerminal, oldest first, kept 10 minutes", async () => {
    const f = fake();
    const pool = "0x616f6877a3fa74f550155002388df37e5b19861270420ac48fcf4b58c8f9f30a";
    const r = (await f.svc.chart(1, pool)).body as { candles: { t: number; c: number }[] };
    expect(r.candles.length).toBeGreaterThan(5);
    expect(r.candles[0]!.t).toBeLessThan(r.candles.at(-1)!.t);
    expect(f.calls.at(-1)).toBe(`https://api.geckoterminal.com/api/v2/networks/eth/pools/${pool}/ohlcv/hour?limit=168&currency=usd`);
    await f.svc.chart(1, pool);
    expect(f.calls.filter((c) => c.includes("geckoterminal"))).toHaveLength(1);
    expect((await f.svc.chart(8453, pool)).status).toBe(400);
  });
  it("says so when GeckoTerminal is rate limited, without failing the page", async () => {
    const f = fake({ gecko: () => new HttpError(429, "https://api.geckoterminal.com/x") });
    const r = (await f.svc.chart(4663, "0x519387822812b11873eb51242f9dc80632d98144742b4ed0feea792af777d94b")).body as { candles: unknown[]; error: string };
    expect(r.candles).toEqual([]);
    expect(r.error).toMatch(/429/);
  });
  it("reads which chains IMD opens to a launch: Ethereum and Robinhood Chain, not Base (2026-10-22)", async () => {
    const r = (await fake().svc.chains()).body as { open: { chainId: number }[]; baseOpen: boolean };
    expect(r.open.map((c) => c.chainId)).toEqual([11155111, 1, 4663]);
    expect(r.baseOpen).toBe(false);
  });
});

describe("helpers", () => {
  it("reads the creator's words from the explorer's lines and from looser objectives", () => {
    expect(coinOf(launchBody(FORM).objective)).toEqual({ name: "Night Owl", symbol: "OWL", supply: "1,000,000,000", about: "A community coin for people who work at night.", links: { website: "https://example.org/", x: "https://x.com/example", telegram: "https://t.me/example" } });
    expect(coinOf("Token name: INK. Token symbol: INK. Launch it with the InkHook")).toMatchObject({ name: "INK", symbol: "INK" });
    expect(coinOf("Launch NIGHTSHIFT (SHIFT), the platform token")).toMatchObject({ name: "NIGHTSHIFT", symbol: "SHIFT" });
    expect(coinOf("Website: javascript:alert(1)").links).toEqual({});
  });
  it("orders a job's steps as the swarm runs them", () => {
    expect(stepsOf([{ key: "audit_judge", state: "waiting" }, { key: "build_contract_project", state: "accepted" }, { key: "write_foundry_tests", state: "working" }]).map((s) => s.label))
      .toEqual(["Build and test the contracts", "Tests by a second agent", "Audit judge: reproduce and rank"]);
  });
  it("computes a v4 pool id as DexScreener shows it", () => {
    expect(poolIdOf({ currency0: "0x0000000000000000000000000000000000000000", currency1: "0x2b82cdeb8477415d541799abb0cc48044c8ea5f3", fee: 12500, tickSpacing: 60, hooks: "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000" }))
      .toBe("0x616f6877a3fa74f550155002388df37e5b19861270420ac48fcf4b58c8f9f30a");
  });
});
