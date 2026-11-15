import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  BURN_NOW_MIN, BURNS, claimProblem, COMPUTE_BUDGET, DEAD, type Extra, type FeePort, type FeeSettings, IMD_BURN_EXECUTOR, MAX_BURN, MIN_EXTRA, partnerMigrationFee,
  RELAY_DEPOSITORY, type RelayQuote, relayProblem, RESERVE, SolFees, splitLamports,
} from "./sol-fees.js";

const SOL = 1_000_000_000n;
const ADAM = Keypair.generate().publicKey.toBase58();
const DEV = Keypair.generate().publicKey.toBase58();

/** A chain in memory: pools with partner fees, a fee wallet balance, Relay quotes and statuses. */
function fakeChain() {
  const c = {
    balance: 0n,
    pools: new Map<string, bigint>([["poolA", 10n * SOL], ["poolB", 4n * SOL]]),
    creation: new Map<string, bigint>([["poolA", 50_000_000n]]),
    paid: [] as { address: string; lamports: bigint }[],
    deposits: [] as { burn: string; lamports: bigint }[],
    statuses: new Map<string, "pending" | "done" | "refunded">(),
    quoteEdit: null as null | ((q: RelayQuote) => RelayQuote),
    seq: 0,
    /** after graduation: LP positions, surplus, migration fee; `bring` is what a claim really lands (default: what it said) */
    extras: [] as (Extra & { bring?: bigint; fail?: boolean })[],
    extrasDown: false,
    extraClaims: [] as string[],
  };
  const port: FeePort = {
    balance: async () => c.balance,
    claimable: async (pools) => pools.map((p) => ({ pool: p, lamports: c.pools.get(p) ?? 0n, creation: c.creation.get(p) ?? 0n })),
    claim: async (_kp, pool, creation) => {
      c.balance += (c.pools.get(pool) ?? 0n) - 10_000n;
      c.pools.set(pool, 0n);
      const cr = creation && (c.creation.get(pool) ?? 0n) > 0n;
      if (cr) { c.balance += c.creation.get(pool)!; c.creation.set(pool, 0n); }
      return { sig: `claim-${pool}`, creationClaimed: cr };
    },
    extras: async (_pools, owner) => {
      if (c.extrasDown) throw new Error("rpc down");
      expect(owner).toBeTruthy();
      return c.extras.filter((e) => e.lamports > 0n || e.tokens > 0n).map(({ bring: _b, fail: _f, ...e }) => e);
    },
    claimExtra: async (_kp, e) => {
      const x = c.extras.find((y) => y.kind === e.kind && y.ref === e.ref)!;
      if (x.fail) throw new Error("would fail: simulated");
      c.balance += (x.bring ?? x.lamports) - 10_000n;
      c.extraClaims.push(`${e.kind}:${e.ref}`);
      const tokens = x.tokens;
      x.lamports = 0n; x.tokens = 0n;
      return { sig: `extra-${e.kind}-${e.ref}`, tokens };
    },
    pay: async (_kp, to) => { for (const t of to) { c.balance -= t.lamports; c.paid.push(t); } c.balance -= 5_000n; return `pay-${++c.seq}`; },
    quote: async ({ wallet, burn, lamports }) => {
      const q: RelayQuote = {
        requestId: `req-${++c.seq}`, lookupTables: [],
        instructions: [{ programId: RELAY_DEPOSITORY, data: "00", keys: [{ pubkey: wallet, isSigner: true, isWritable: true }] }],
        sender: wallet, recipient: BURNS[burn].to, outToken: BURNS[burn].token, outAmount: "1000", minOut: "990",
        inUsd: Number(lamports) / 1e9 * 80, outUsd: (Number(lamports) / 1e9) * 80 * 0.98,
      };
      return c.quoteEdit ? c.quoteEdit(q) : q;
    },
    deposit: async (_kp, q, lamports) => { c.balance -= lamports + 5_000n; c.deposits.push({ burn: q.outToken === BURNS.imd.token ? "imd" : "shift", lamports }); c.statuses.set(q.requestId, "pending"); return `dep-${q.requestId}`; },
    status: async (id) => ({ state: c.statuses.get(id) ?? "pending", ethTx: c.statuses.get(id) === "done" ? `0xeth${id}` : null, out: c.statuses.get(id) === "done" ? "5000000000000000000" : null }),
  };
  return { c, port };
}

function setup(over: Partial<FeeSettings> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "solfees-"));
  const { c, port } = fakeChain();
  let s: FeeSettings = { on: true, adam: ADAM, dev: DEV, partner: null, network: "mainnet", ...over };
  const fees = new SolFees(dir, () => port, () => s, () => [...c.pools.keys()]);
  if (!("partner" in over)) s = { ...s, partner: fees.address };
  const set = (o: Partial<FeeSettings>) => { s = { ...s, ...o }; };
  return { dir, c, fees, set };
}

describe("the split", () => {
  it("is 60 dev / 20 IMD / 20 $SHIFT and every lamport goes somewhere", () => {
    const p = splitLamports(1_000_000_000n);
    expect(p).toEqual({ adam: 0n, dev: 600_000_000n, imd: 200_000_000n, shift: 200_000_000n });
    const q = splitLamports(1_000_000_007n);
    expect(q.adam + q.dev + q.imd + q.shift).toBe(1_000_000_007n);
  });
});

describe("the fee wallet", () => {
  it("is made on the server, kept readable by the engine only, and the same after a restart", () => {
    const { dir, fees } = setup();
    const again = new SolFees(dir, () => fakeChain().port, () => ({ on: false, adam: null, dev: null, partner: null, network: "mainnet" }), () => []);
    expect(again.address).toBe(fees.address);
    const raw = readFileSync(join(dir, "sol-fee-wallet.json"), "utf8");
    expect(JSON.stringify(fees.info())).not.toContain(JSON.parse(raw).secret);
    if (process.platform !== "win32") expect(statSync(join(dir, "sol-fee-wallet.json")).mode & 0o077).toBe(0);
  });

  it("does nothing until it is the partner, on mainnet, turned on, with the dev wallet set", async () => {
    const cases: [Partial<FeeSettings>, RegExp][] = [
      [{ partner: "someoneElse111111111111111111111111111111111" }, /not the launch partner/],
      [{ on: false }, /Turned off/],
      [{ network: "devnet" }, /devnet/],
      [{ dev: null }, /dev wallet/],
    ];
    for (const [over, why] of cases) {
      const { fees, c, set } = setup();
      set(over);
      const r = await fees.run();
      expect(r.ran).toBe(false);
      expect(r.why).toMatch(why);
      expect(c.balance).toBe(0n);
    }
  });
});

describe("a run", () => {
  it("claims every pool, pays the dev wallet 60%, and burns 20% as IMD and 20% as $SHIFT", async () => {
    const { fees, c } = setup();
    c.balance = RESERVE;
    const r = await fees.run();
    expect(r).toEqual({ ran: true });
    const got = 14n * SOL + 50_000_000n - 20_000n; // two pools, the launch fee once, net of the claim fees
    const p = splitLamports(got);
    expect(c.paid).toMatchObject([{ address: DEV, lamports: p.dev }]);
    expect(c.paid).toHaveLength(1);
    // both shares are under the per-burn cap: burned in full this run
    expect(p.shift).toBeLessThan(MAX_BURN);
    // the $SHIFT burn is its share less the network fees already paid (payout + IMD burn), which it carries
    expect(c.deposits).toEqual([{ burn: "imd", lamports: p.imd }, { burn: "shift", lamports: p.shift - 10_000n }]);
    const a = await fees.adminInfo();
    // the network fees of the payout and the two burns come out of the $SHIFT share, never below zero
    expect(a.owedSol.shift).toBe(0);
    expect(a.owedSol.adam).toBe(0);
    expect(a.totals.claimedSol).toBeCloseTo(Number(got) / 1e9, 9);
  });

  it("moves what was kept for ADAM to the dev wallet when it loads (ADAM's share ended 2026-11-16)", async () => {
    const d = mkdtempSync(join(tmpdir(), "solfees-"));
    writeFileSync(join(d, "sol-fees.json"), JSON.stringify({ owed: { adam: "11311464", dev: "5", imd: "0", shift: "0" } }));
    const again = new SolFees(d, () => fakeChain().port, () => ({ on: false, adam: null, dev: null, partner: null, network: "mainnet" }), () => []);
    const o = (await again.adminInfo()).owedSol;
    expect(o.adam).toBe(0);
    expect(o.dev).toBeCloseTo(11_311_469 / 1e9, 9);
  });

  it("claims a pool's launch fee only once", async () => {
    const { fees, c } = setup();
    c.balance = RESERVE;
    await fees.run();
    c.pools.set("poolA", SOL);
    c.creation.set("poolA", 50_000_000n); // even if a pool still reported one
    const before = (await fees.adminInfo()).totals.claimedSol;
    await fees.run();
    expect((await fees.adminInfo()).totals.claimedSol - before).toBeCloseTo((Number(SOL) - 10_000) / 1e9, 9);
  });

  it("counts a burn when Relay delivers it, with the Ethereum transaction, and owes it again when Relay refunds", async () => {
    const { fees, c } = setup();
    c.balance = RESERVE;
    await fees.run();
    const [imdReq, shiftReq] = [...c.statuses.keys()];
    c.statuses.set(imdReq!, "done");
    c.statuses.set(shiftReq!, "refunded");
    const firstShift = c.deposits.find((d) => d.burn === "shift")!.lamports;
    c.balance += firstShift; // the refund lands back in the fee wallet
    c.pools.clear();
    await fees.run();
    const info = fees.info();
    const imd = info.burns.find((b) => b.token === "IMD" && b.state === "done");
    expect(imd?.ethTx).toBe(`0xeth${imdReq}`);
    expect(imd?.to).toBe(IMD_BURN_EXECUTOR);
    expect(info.totals.imdBurned).toBe(5);
    expect(info.burns.find((b) => b.token === "SHIFT" && b.state === "refunded")).toBeTruthy();
    // refunded, then burned again in the same run (it is over the minimum)
    const shifts = c.deposits.filter((d) => d.burn === "shift");
    expect(shifts).toHaveLength(2);
    expect(shifts[1]!.lamports).toBeLessThanOrEqual(firstShift);
    expect(shifts[1]!.lamports).toBeGreaterThan(firstShift - 100_000n);
  });

  it("never spends the reserve: a burn larger than what the wallet can spend waits", async () => {
    const { fees, c } = setup();
    c.balance = RESERVE;
    await fees.run(); // leaves part of the $SHIFT burn owed (over the per-burn cap)
    c.pools.clear();
    c.balance = RESERVE + 100_000_000n; // the wallet holds less than the burn still owed
    const deposits = c.deposits.length;
    const r = await fees.run();
    expect(r).toEqual({ ran: true });
    expect(c.deposits).toHaveLength(deposits);
    expect(c.balance).toBeGreaterThanOrEqual(RESERVE);
  });

  it("refuses a Relay deposit that goes elsewhere, and keeps the burn owed", async () => {
    const { fees, c } = setup();
    c.balance = RESERVE;
    c.quoteEdit = (q) => ({ ...q, recipient: "0x1111111111111111111111111111111111111111" });
    const r = await fees.run();
    expect(r.why).toMatch(/burn address/);
    expect(c.deposits).toEqual([]);
    expect((await fees.adminInfo()).owedSol.imd).toBeGreaterThan(0.9);
  });
});

describe("after graduation", () => {
  const MINT = "Mint1111111111111111111111111111111111111111";
  const pos = (lamports: bigint, tokens = 0n, o: Partial<Extra & { bring: bigint; fail: boolean }> = {}) =>
    ({ kind: "position" as const, pool: "poolA", ref: "positionA", mint: MINT, lamports, tokens, ...o });

  it("claims the fee wallet's locked LP position fees and splits the SOL like any other claim", async () => {
    const { fees, c } = setup();
    c.balance = RESERVE;
    c.pools.clear();
    c.extras = [pos(2n * SOL)];
    await fees.run();
    expect(c.extraClaims).toEqual(["position:positionA"]);
    const got = 2n * SOL - 10_000n;
    const a = await fees.adminInfo();
    expect(a.totals.claimedSol).toBeCloseTo(Number(got) / 1e9, 9);
    expect(c.paid).toMatchObject([{ address: DEV, lamports: splitLamports(got).dev }]);
    expect(a.claims[0]).toMatchObject({ pools: 0, extras: 1, txs: ["extra-position-positionA"] });
  });

  it("keeps the fees paid in the token in the fee wallet: counted as held, never split", async () => {
    const { fees, c } = setup();
    c.balance = RESERVE;
    c.pools.clear();
    c.extras = [pos(SOL, 1_234_567_890n)];
    await fees.run();
    const a = await fees.adminInfo();
    expect(a.tokenFeesHeld).toEqual([{ mint: MINT, raw: "1234567890", amount: 1234.56789, note: "token fees held" }]);
    expect(a.totals.claimedSol).toBeCloseTo((Number(SOL) - 10_000) / 1e9, 9);
  });

  it("counts what arrived, never more than the pools said (SOL landing at the same time is not a fee)", async () => {
    const { fees, c } = setup();
    c.balance = RESERVE;
    c.pools.clear();
    c.extras = [pos(SOL, 0n, { bring: 3n * SOL })]; // 2 SOL more arrives than the position said
    await fees.run();
    expect((await fees.adminInfo()).totals.claimedSol).toBe(1);
  });

  it("claims the curve's fees, the surplus and the LP position in one run, and the migration fee once", async () => {
    const { fees, c } = setup();
    c.balance = RESERVE;
    c.extras = [
      pos(SOL),
      { kind: "surplus", pool: "poolA", ref: "poolA", mint: MINT, lamports: 300_000_000n, tokens: 0n },
      { kind: "migration", pool: "poolA", ref: "poolA", mint: MINT, lamports: 100_000_000n, tokens: 0n },
    ];
    await fees.run();
    const first = 14n * SOL + 50_000_000n - 20_000n + SOL + 400_000_000n - 30_000n;
    expect((await fees.adminInfo()).totals.claimedSol).toBeCloseTo(Number(first) / 1e9, 9);
    expect(c.extraClaims).toEqual(["position:positionA", "surplus:poolA", "migration:poolA"]);
    // a chain that still reports the migration fee is not claimed again
    c.extras = [{ kind: "migration", pool: "poolA", ref: "poolA", mint: MINT, lamports: 100_000_000n, tokens: 0n }];
    await fees.run();
    expect(c.extraClaims).toHaveLength(3);
  });

  it("leaves dust for later, retries a claim that would fail, and still claims the curves when the reads fail", async () => {
    const { fees, c } = setup();
    c.balance = RESERVE;
    c.extras = [pos(MIN_EXTRA - 1n), { ...pos(SOL, 0n, { fail: true }), ref: "positionB" }];
    c.extrasDown = true;
    await fees.run();
    expect(c.extraClaims).toEqual([]);
    expect((await fees.adminInfo()).totals.claimedSol).toBeGreaterThan(14); // the curves were claimed
    c.extrasDown = false;
    c.pools.clear();
    await fees.run();
    expect(c.extraClaims).toEqual([]); // dust waits, the failing one is not counted
    const before = (await fees.adminInfo()).totals.claimedSol;
    c.extras[1]!.fail = false;
    await fees.run();
    expect(c.extraClaims).toEqual(["position:positionB"]);
    expect((await fees.adminInfo()).totals.claimedSol - before).toBeCloseTo((Number(SOL) - 10_000) / 1e9, 9);
  });
});

describe("BURN NOW (the admin's call)", () => {
  // the live ledger of 2026-11-16: both buckets under MIN_BURN, trading stopped
  function owedSetup() {
    const dir = mkdtempSync(join(tmpdir(), "solfees-"));
    writeFileSync(join(dir, "sol-fees.json"), JSON.stringify({ owed: { adam: "0", dev: "0", imd: "15069317", shift: "54643249" } }));
    const { c, port } = fakeChain();
    c.pools.clear();
    let s: FeeSettings = { on: true, adam: null, dev: DEV, partner: null, network: "mainnet" };
    const fees = new SolFees(dir, () => port, () => s, () => []);
    s = { ...s, partner: fees.address };
    c.balance = RESERVE + 15_069_317n + 54_643_249n;
    // Relay's real quotes that day: IMD loses 36%, $SHIFT 14.5%
    c.quoteEdit = (q) => ({ ...q, outUsd: q.inUsd * (q.outToken === BURNS.imd.token ? 0.64 : 0.855) });
    return { c, fees };
  }

  it("previews each bucket with its loss and sends nothing", async () => {
    const { c, fees } = owedSetup();
    const r = await fees.burnNow({ confirm: false });
    expect(c.deposits).toEqual([]);
    expect(r.burns.map((b) => [b.token, b.sol, b.lossPct, b.problem])).toEqual([["IMD", 0.015069317, 36, null], ["SHIFT", 0.054643249, 14.5, null]]);
    expect((await fees.adminInfo()).owedSol.imd).toBeCloseTo(0.015069317, 9);
  });

  it("burns both through the checked path at the loss the owner accepted, and records them", async () => {
    const { c, fees } = owedSetup();
    const r = await fees.burnNow({ confirm: true, maxLossPct: 40 });
    // the IMD burn's network fee is carried by the $SHIFT share, as in the scheduled run
    expect(c.deposits).toEqual([{ burn: "imd", lamports: 15_069_317n }, { burn: "shift", lamports: 54_643_249n - 5_000n }]);
    expect(r.burns.every((b) => b.sent && !b.error)).toBe(true);
    const a = await fees.adminInfo();
    expect(a.owedSol.imd).toBe(0);
    expect(a.burns.filter((b) => b.state === "sent")).toHaveLength(2);
    expect(c.balance).toBeGreaterThanOrEqual(RESERVE - 10_000n);
  });

  it("refuses a route over the accepted loss (IMD at 36% with 20% accepted) and burns the other", async () => {
    const { c, fees } = owedSetup();
    const r = await fees.burnNow({ confirm: true, maxLossPct: 20 });
    expect(r.burns[0]!.error).toMatch(/costs 36.0% \(the limit is 20%\)/);
    expect(c.deposits).toEqual([{ burn: "shift", lamports: 54_643_249n }]);
    expect((await fees.adminInfo()).owedSol.imd).toBeCloseTo(0.015069317, 9);
  });

  it("never accepts more than a 40% loss, and the scheduled run keeps its own limits", async () => {
    const { c, fees } = owedSetup();
    await expect(fees.burnNow({ confirm: true, maxLossPct: 41 })).rejects.toThrow(/at most 40%/);
    await expect(fees.burnNow({ confirm: true, maxLossPct: 0 })).rejects.toThrow(/above 0%/);
    await fees.run(); // under MIN_BURN: the scheduled run burns nothing
    expect(c.deposits).toEqual([]);
  });

  it("never spends the reserve: a bucket is burned only up to what the wallet can spend", async () => {
    const { c, fees } = owedSetup();
    c.balance = RESERVE + 20_000_000n; // less than the two buckets
    const r = await fees.burnNow({ confirm: true, maxLossPct: 40 });
    expect(c.deposits[0]).toEqual({ burn: "imd", lamports: 15_069_317n });
    // what is left after the IMD burn and its fee is under BURN_NOW_MIN: $SHIFT waits
    expect(c.deposits).toHaveLength(1);
    expect(r.burns[1]!.problem).toMatch(/under/);
    expect(c.balance).toBeGreaterThanOrEqual(RESERVE);
    expect(BURN_NOW_MIN).toBe(5_000_000n);
  });
});

describe("claim checks", () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const ix = (programId: string, signer = wallet) => ({ programId, keys: [{ pubkey: signer, isSigner: true }] });
  it("passes Meteora's DBC and DAMM v2, the token programs and the system program, signed by the fee wallet only", () => {
    expect(claimProblem([ix(COMPUTE_BUDGET), ix("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), ix("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"), ix("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), ix("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"), ix("11111111111111111111111111111111")], wallet)).toBeNull();
  });
  it("refuses another program, another signer, an empty claim", () => {
    expect(claimProblem([ix(RELAY_DEPOSITORY)], wallet)).toMatch(/unknown program/);
    expect(claimProblem([ix("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", DEV)], wallet)).toMatch(/another signer/);
    expect(claimProblem([], wallet)).toMatch(/empty/);
  });
  it("works out the partner's part of a migration fee like Meteora's program (0% for NIGHTSHIFT's launches)", () => {
    expect(partnerMigrationFee(85n * SOL, 0, 0)).toBe(0n);
    expect(partnerMigrationFee(100n * SOL, 5, 0)).toBe(5n * SOL);
    expect(partnerMigrationFee(100n * SOL, 5, 50)).toBe(2_500_000_000n);
    expect(partnerMigrationFee(1_000n, 3, 0)).toBe(30n);
  });
});

describe("relayProblem", () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const ok: RelayQuote = {
    requestId: "r", lookupTables: [], sender: wallet, recipient: DEAD, outToken: BURNS.shift.token, outAmount: "1", minOut: "1", inUsd: 100, outUsd: 95,
    instructions: [{ programId: COMPUTE_BUDGET, data: "", keys: [] }, { programId: RELAY_DEPOSITORY, data: "", keys: [{ pubkey: wallet, isSigner: true, isWritable: true }] }],
  };
  it("passes a deposit to Relay's program from the fee wallet to the burn address", () => expect(relayProblem(ok, { wallet, burn: "shift" })).toBeNull());
  it("refuses another program, another signer, another token, another sender, a costly route", () => {
    expect(relayProblem({ ...ok, instructions: [{ programId: "11111111111111111111111111111111", data: "", keys: [] }] }, { wallet, burn: "shift" })).toMatch(/unknown program/);
    expect(relayProblem({ ...ok, instructions: [{ programId: RELAY_DEPOSITORY, data: "", keys: [{ pubkey: DEV, isSigner: true, isWritable: false }] }] }, { wallet, burn: "shift" })).toMatch(/another signer/);
    expect(relayProblem({ ...ok, outToken: BURNS.imd.token }, { wallet, burn: "shift" })).toMatch(/not for SHIFT/);
    expect(relayProblem({ ...ok, sender: DEV }, { wallet, burn: "shift" })).toMatch(/not from the fee wallet/);
    expect(relayProblem({ ...ok, outUsd: 80 }, { wallet, burn: "shift" })).toMatch(/costs 20.0%/);
    expect(relayProblem({ ...ok, recipient: IMD_BURN_EXECUTOR }, { wallet, burn: "shift" })).toMatch(/burn address/);
  });
});
