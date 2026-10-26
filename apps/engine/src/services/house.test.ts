import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeHeader, requirement, signPayment, type PaymentPayload } from "@nightshift/x402";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sales, eth } from "../chain.js";
import { config } from "../config.js";
import type { Engine } from "../engine.js";
import { OwnerStats, setOwnerStats } from "../owner-stats.js";
import { Usage } from "../usage.js";
import { payerClass } from "../proof.js";
import { recordPaid } from "../crews/live.js";
import { offer } from "./catalog.js";
import { enginePayer, HOUSE_ID } from "./house.js";

const buyer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const wallet = `0x${"44".repeat(20)}` as const;
const o = offer("token-verdict-quick")!;
const saved = { mode: config.mode, salesChainId: config.salesChainId, x402Facilitator: config.x402Facilitator, dataDir: config.dataDir };
let stats: OwnerStats, sent: string[], engine: Engine;
const signed = async (value = o.priceUsdc) => signPayment(buyer, requirement(8453, wallet, value));

beforeEach(() => {
  Object.assign(config, { mode: "live", salesChainId: 8453, x402Facilitator: "self", dataDir: mkdtempSync(join(tmpdir(), "house-notify-")) });
  vi.spyOn(sales, "readContract").mockResolvedValue(1_000_000n);
  vi.spyOn(sales, "getBalance").mockResolvedValue(1_000_000_000_000_000n);
  vi.spyOn(eth, "readContract").mockResolvedValue(0n);
  const house = { id: HOUSE_ID, wallet, owner: `0x${"22".repeat(20)}` };
  engine = { store: { companies: new Map([[HOUSE_ID, house]]) }, checkout: { recordOf: vi.fn(), fresh: vi.fn(async () => true) }, alert: vi.fn(async () => true) } as unknown as Engine;
  sent = [];
  stats = new OwnerStats({ file: null, sources: {
    usage: new Usage(null), payerClass: (p, sim) => payerClass(p, engine.store.companies.get(HOUSE_ID)!, [...engine.store.companies.values()], sim),
    live: () => ({ visitors5m: 0, visitors1m: 0 }), jobs: () => [], operators: () => [], sales: () => [], recruiter: () => null,
  }, send: async (text) => { sent.push(text); return true; } });
  setOwnerStats(stats);
});
afterEach(() => { setOwnerStats(null); stats.dispose(); vi.restoreAllMocks(); Object.assign(config, saved); });

describe("house payment notification hooks", () => {
  it("reports verified insufficient-balance refusals and dedupes retries", async () => {
    vi.mocked(sales.readContract).mockResolvedValue(0n);
    const p = enginePayer(engine), header = encodeHeader(await signed());
    expect(await p.check(o, header, "192.0.2.1")).toMatchObject({ ok: false, status: 402 });
    await p.check(o, header, "192.0.2.1"); await stats.tick();
    expect(sent).toHaveLength(1); expect(sent[0]).toContain("insufficient USDC balance"); expect(sent[0]).toContain("Nothing was charged");
  });

  it("reports every verified refusal at the gas and rate limits", async () => {
    vi.mocked(sales.getBalance).mockResolvedValue(0n);
    const p = enginePayer(engine);
    expect(await p.check(o, encodeHeader(await signed()), "192.0.2.1")).toMatchObject({ ok: false, status: 503 });
    vi.mocked(sales.getBalance).mockResolvedValue(1_000_000_000_000_000n);
    for (let i = 0; i < 9; i++) expect(await p.check(o, encodeHeader(await signed()), "192.0.2.1")).toMatchObject({ ok: true });
    expect(await p.check(o, encodeHeader(await signed()), "192.0.2.1")).toMatchObject({ ok: false, status: 429 });
    await stats.tick(); expect(sent.filter((s) => s.includes("Payment refused"))).toHaveLength(2);
    expect(sent[0]).toContain("cannot take payments right now"); expect(sent[1]).toContain("Too many payments at once");
  });

  it("allows CDP loops up to 120 per payer and 240 per IP", async () => {
    Object.assign(config, { x402Facilitator: "cdp" });
    vi.mocked(sales.getBalance).mockResolvedValue(0n);
    const p = enginePayer(engine), header = encodeHeader(await signed());
    for (let i = 0; i < 120; i++) expect(await p.check(o, header, "192.0.2.1")).toMatchObject({ ok: true });
    expect(await p.check(o, header, "192.0.2.2")).toMatchObject({ status: 429 });
    const second = privateKeyToAccount(`0x${"22".repeat(32)}`), h2 = encodeHeader(await signPayment(second, requirement(8453, wallet, o.priceUsdc)));
    for (let i = 0; i < 120; i++) expect(await p.check(o, h2, "192.0.2.1")).toMatchObject({ ok: true });
    const third = privateKeyToAccount(`0x${"33".repeat(32)}`), h3 = encodeHeader(await signPayment(third, requirement(8453, wallet, o.priceUsdc)));
    expect(await p.check(o, h3, "192.0.2.1")).toMatchObject({ status: 429 });
    expect(sales.getBalance).not.toHaveBeenCalled();
  });

  it("verifies underpayment signatures before notifying and ignores invalid payloads", async () => {
    const p = enginePayer(engine), valid = await signed(1n);
    expect(await p.check(o, encodeHeader(valid), "192.0.2.1")).toMatchObject({ ok: false, status: 402 });
    const forged: PaymentPayload = { ...valid, payload: { ...valid.payload, authorization: { ...valid.payload.authorization, nonce: `0x${"ff".repeat(32)}` } } };
    await p.check(o, encodeHeader(forged), "192.0.2.1"); await p.check(o, "not-json", "192.0.2.1"); await stats.tick();
    expect(sent).toHaveLength(1); expect(sent[0]).toContain("insufficient_amount");
  });

  it("reports a verified refusal for another service", async () => {
    vi.mocked(engine.checkout.recordOf).mockReturnValue({ productId: "another", value: o.priceUsdc, at: Date.now() } as never);
    expect(await enginePayer(engine).check(o, encodeHeader(await signed()), "192.0.2.1")).toMatchObject({ status: 409 });
    await stats.tick(); expect(sent[0]).toContain("This payment was made for another service");
  });

  it("reports settled pending work immediately through recordPaid, before delivery", async () => {
    const r = { payer: buyer.address, nonce: `0x${"ee".repeat(32)}`, usd: Number(o.priceUsdc) / 2e6, tx: `0x${"ab".repeat(32)}`, network: "eip155:8453", ok: true, pending: true };
    recordPaid(o, r); recordPaid(o, r); await stats.tick();
    expect(sent.filter((s) => s.includes("Payment settled"))).toHaveLength(1); expect(sent[0]).toContain("holder price: yes");
  });
});
