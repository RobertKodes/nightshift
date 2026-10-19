import { describe, expect, it } from "vitest";
import { Ledger } from "@nightshift/ledger";
import type { TxState } from "./chain.js";
import { type Leg, type PayoutChain, Payouts } from "./payout.js";

const OWNER = "0x00000000000000000000000000000000000000aa";
const DEST = { dev: "0x00000000000000000000000000000000000000d1", treasury: "0x00000000000000000000000000000000000000d2" } as const;
const USD = (n: number) => BigInt(Math.round(n * 1e6));

/** A chain where each transfer lands unless told otherwise; it remembers what was broadcast. */
function fakeChain() {
  let n = 0;
  const sent: { to: string; amount: bigint; hash: `0x${string}` }[] = [];
  const signed = new Map<string, { to: string; amount: bigint }>();
  const states = new Map<string, TxState>();
  const log: string[] = [];
  const c = {
    sent, states, log,
    /** next broadcasts to `to` are refused by the node */
    refuseTo: new Set<string>(),
    /** next transfers to `to` stay unconfirmed */
    holdTo: new Set<string>(),
    chain: {
      sign: async (_id, to, amount) => { const hash = `0x${(++n).toString(16).padStart(64, "0")}` as `0x${string}`; signed.set(hash, { to, amount }); return { hash, raw: hash, nonce: n }; },
      broadcast: async (raw) => {
        const s = signed.get(raw)!;
        log.push(`broadcast ${s.to}`);
        if (c.refuseTo.has(s.to)) throw new Error("insufficient funds for gas * price + value");
        if (!sent.some((x) => x.hash === raw)) sent.push({ ...s, hash: raw });
        if (!states.has(raw)) states.set(raw, c.holdTo.has(s.to) ? "pending" : "success");
      },
      state: async (_id, hash) => states.get(hash) ?? "pending",
      refused: (e) => /insufficient funds/.test(String(e)),
    } satisfies PayoutChain,
  };
  return c;
}

async function setup(revenue: number) {
  const ledger = new Ledger();
  await ledger.post({ id: "sale:1", at: new Date(), kind: "sale", postings: [{ account: "co:X:usdc", asset: "USDC", amount: USD(revenue) }, { account: "ext:buyers", asset: "USDC", amount: -USD(revenue) }] });
  const pending = new Map<string, Leg>();
  const f = fakeChain();
  const saves: number[] = [];
  const p = new Payouts(ledger, pending, async () => { saves.push(pending.size); f.log.push(`save ${pending.size}`); }, f.chain, 0);
  const bal = (a: string) => ledger.balance(a, "USDC");
  const platform = async () => (await bal("ext:platform:dev")) + (await bal("ext:platform:treasury"));
  return { ledger, pending, f, p, bal, platform, saves };
}

describe("withdrawals", () => {
  it("sends the owner's share first, then the fee legs, and books each leg", async () => {
    const { f, p, bal, platform } = await setup(100);
    const r = await p.withdraw("X", OWNER, USD(100), 500, DEST);
    expect(r.sent).toBe(USD(95));
    expect(f.sent.map((s) => s.to)).toEqual([OWNER, DEST.dev, DEST.treasury]);
    expect(f.sent.map((s) => s.amount)).toEqual([USD(95), USD(1), USD(4)]);
    expect(await bal("co:X:usdc")).toBe(0n);
    expect(await bal(`ext:owner:${OWNER}`)).toBe(USD(95));
    expect(await platform()).toBe(USD(5));
    expect(await p.feesOwed("X")).toBe(0n);
  });

  it("saves every leg before it is broadcast", async () => {
    const { f, p } = await setup(10);
    await p.withdraw("X", OWNER, USD(10), 0, DEST);
    expect(f.log.slice(0, 2)).toEqual(["save 1", `broadcast ${OWNER}`]);
  });

  it("never charges the fee twice when a fee leg fails: it stays owed and is paid once on the retry", async () => {
    const { f, p, bal, platform } = await setup(100);
    f.refuseTo.add(DEST.treasury);
    const r = await p.withdraw("X", OWNER, USD(100), 500, DEST);
    expect(r.feeError).toMatch(/insufficient funds/);
    expect(await bal(`ext:owner:${OWNER}`)).toBe(USD(95));
    expect(await bal("co:X:usdc")).toBe(0n); // nothing more for the owner to take
    expect(await p.feesOwed("X")).toBe(USD(4)); // still in the wallet, owed to the treasury
    f.refuseTo.clear();
    await p.payFees("X", DEST);
    expect(await p.feesOwed("X")).toBe(0n);
    expect(await platform()).toBe(USD(5)); // exactly 5%, not 9.75%
    expect(f.sent.filter((s) => s.to === DEST.treasury).map((s) => s.amount)).toEqual([USD(4)]);
  });

  it("charges nothing when the owner's transfer fails, and the same fee once on the retry", async () => {
    const { f, p, bal, platform, pending } = await setup(100);
    f.refuseTo.add(OWNER);
    await expect(p.withdraw("X", OWNER, USD(100), 500, DEST)).rejects.toThrow(/insufficient funds/);
    expect(f.sent).toEqual([]);
    expect(pending.size).toBe(0);
    expect(await bal("co:X:usdc")).toBe(USD(100));
    f.refuseTo.clear();
    const r = await p.withdraw("X", OWNER, USD(100), 500, DEST);
    expect(r.sent).toBe(USD(95));
    expect(await platform()).toBe(USD(5));
  });

  it("follows an unconfirmed transfer instead of sending it again, and books it once when it lands", async () => {
    const { f, p, bal, pending } = await setup(50);
    f.holdTo.add(OWNER);
    await expect(p.withdraw("X", OWNER, USD(50), 0, DEST)).rejects.toThrow(/waiting for the chain/);
    expect(pending.size).toBe(1); // saved, so a restart still knows it
    await expect(p.withdraw("X", OWNER, USD(50), 0, DEST)).rejects.toThrow(/still waiting/);
    expect(await p.resolve("X")).toBe(1);
    f.states.set(f.sent[0]!.hash, "success");
    expect(await p.resolve("X")).toBe(0);
    expect(await p.resolve("X")).toBe(0);
    expect(await bal("co:X:usdc")).toBe(0n);
    expect(await bal(`ext:owner:${OWNER}`)).toBe(USD(50));
    expect(f.sent.length).toBe(1);
    await expect(p.withdraw("X", OWNER, USD(50), 0, DEST)).rejects.toThrow(/Nothing to withdraw/);
  });

  it("forgets a transfer that can never land, so the money is withdrawable again", async () => {
    const { f, p, bal, pending } = await setup(20);
    f.holdTo.add(OWNER);
    await expect(p.withdraw("X", OWNER, USD(20), 0, DEST)).rejects.toThrow(/waiting/);
    f.states.set(f.sent[0]!.hash, "dropped");
    expect(await p.resolve("X")).toBe(0);
    expect(pending.size).toBe(0);
    expect(await bal("co:X:usdc")).toBe(USD(20));
  });

  it("only moves the books in sim mode", async () => {
    const ledger = new Ledger();
    await ledger.post({ id: "sale:1", at: new Date(), kind: "sale", postings: [{ account: "co:X:usdc", asset: "USDC", amount: USD(10) }, { account: "ext:buyers", asset: "USDC", amount: -USD(10) }] });
    const p = new Payouts(ledger, new Map(), async () => {}, null);
    const r = await p.withdraw("X", OWNER, USD(10), 1000, DEST);
    expect(r.sent).toBe(USD(9));
    expect(await ledger.balance("co:X:usdc", "USDC")).toBe(0n);
    expect(await ledger.balance("ext:platform:treasury", "USDC")).toBe(USD(0.8));
    expect(await p.feesOwed("X")).toBe(0n);
  });
});
