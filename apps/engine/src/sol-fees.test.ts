import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  BURNS, COMPUTE_BUDGET, DEAD, type FeePort, type FeeSettings, IMD_BURN_EXECUTOR, MAX_BURN, RELAY_DEPOSITORY, type RelayQuote, relayProblem, RESERVE,
  SolFees, splitLamports,
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
  it("is 10 / 35 / 10 / 45 and every lamport goes somewhere", () => {
    const p = splitLamports(1_000_000_000n);
    expect(p).toEqual({ adam: 100_000_000n, dev: 350_000_000n, imd: 100_000_000n, shift: 450_000_000n });
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

  it("does nothing until it is the partner, on mainnet, turned on, with ADAM and the dev wallet set", async () => {
    const cases: [Partial<FeeSettings>, RegExp][] = [
      [{ partner: "someoneElse111111111111111111111111111111111" }, /not the launch partner/],
      [{ on: false }, /Turned off/],
      [{ network: "devnet" }, /devnet/],
      [{ adam: null }, /ADAM/],
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
  it("claims every pool, pays ADAM 10% and the dev wallet 35%, and burns 10% as IMD and 45% as $SHIFT", async () => {
    const { fees, c } = setup();
    c.balance = RESERVE;
    const r = await fees.run();
    expect(r).toEqual({ ran: true });
    const got = 14n * SOL + 50_000_000n - 20_000n; // two pools, the launch fee once, net of the claim fees
    const p = splitLamports(got);
    expect(c.paid).toMatchObject([{ address: ADAM, lamports: p.adam }, { address: DEV, lamports: p.dev }]);
    expect(c.deposits).toEqual([{ burn: "imd", lamports: p.imd }, { burn: "shift", lamports: MAX_BURN }]);
    // the $SHIFT burn above the per-burn cap waits for the next run
    const a = await fees.adminInfo();
    // less the network fees of the payout and the two burns, which the $SHIFT share pays
    expect(a.owedSol.shift).toBeCloseTo(Number(p.shift - MAX_BURN - 15_000n) / 1e9, 9);
    expect(a.owedSol.adam).toBe(0);
    expect(a.totals.claimedSol).toBeCloseTo(Number(got) / 1e9, 9);
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
    c.balance += MAX_BURN; // the refund lands back in the fee wallet
    const owedBefore = (await fees.adminInfo()).owedSol.shift ?? 0;
    c.pools.clear();
    await fees.run();
    const info = fees.info();
    const imd = info.burns.find((b) => b.token === "IMD" && b.state === "done");
    expect(imd?.ethTx).toBe(`0xeth${imdReq}`);
    expect(imd?.to).toBe(IMD_BURN_EXECUTOR);
    expect(info.totals.imdBurned).toBe(5);
    expect(info.burns.find((b) => b.token === "SHIFT" && b.state === "refunded")).toBeTruthy();
    // refunded, then burned again in the same run (it is over the minimum)
    expect(c.deposits.filter((d) => d.burn === "shift")).toHaveLength(2);
    expect((await fees.adminInfo()).owedSol.shift).toBeCloseTo(owedBefore - 0.000005, 9);
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
