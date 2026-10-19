import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ecosystem } from "./ecosystem.js";
import { readProofhouse } from "./proofhouse.js";
const dirs: string[] = [];
function fixture() { const dir = mkdtempSync(join(tmpdir(), "ns-town-")); dirs.push(dir); const file = join(dir, "town.json"); return { file, town: new Ecosystem(file) }; }
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
const input = { handle: "test-agent", name: "Test agent", frogId: 12 };
describe("town ownership and persistence", () => {
  it("requires auth and separates identical handles across owners", () => {
    const { town } = fixture(); expect(() => town.presence(null, input)).toThrow();
    const a = town.presence("0xAA", input, 1000), b = town.presence("0xBB", input, 1000);
    expect(a.id).not.toBe(b.id); town.remove("0xAA", input.handle);
    expect(town.snapshot().agents.map(a => a.owner)).toEqual(["0xbb"]);
    expect(() => town.report("0xAA", { handle: input.handle, projectId: "imd", text: "hi" })).toThrow();
  });
  it("persists residents and expires presence without fabricating activity", () => {
    const { town, file } = fixture(); town.presence("0xAA", input, 1000);
    expect(new Ecosystem(file).snapshot(120999).agents[0]?.online).toBe(true);
    expect(new Ecosystem(file).snapshot(121000).agents[0]?.online).toBe(false);
    expect(town.snapshot().events).toEqual([]);
  });
  it("rejects unknown projects, privileged fields and unbounded registrations", () => {
    const { town } = fixture();
    expect(() => town.presence("a", { ...input, owner: "b" })).toThrow();
    expect(() => town.presence("a", { ...input, uses: ["fake-project"] })).toThrow();
    for (let i = 0; i < 5; i++) town.presence("a", { ...input, handle: `agent-${i}` });
    expect(() => town.presence("a", { ...input, handle: "agent-six" })).toThrow();
  });
  it("attributes, throttles and removes owned activity", () => {
    const { town } = fixture(); const a = town.presence("a", input, 1000);
    town.report("a", { handle: input.handle, projectId: "proofhouse", text: "Reading" }, 2000);
    expect(town.snapshot().events[0]?.agentId).toBe(a.id);
    expect(() => town.report("a", { handle: input.handle, projectId: "proofhouse", text: "Reading" }, 3000)).toThrow();
    town.remove("a", input.handle); expect(town.snapshot().events).toEqual([]);
  });
});
describe("Proof House read failures", () => {
  it("keeps unavailable eligibility and earnings unknown, with no write interface", async () => {
    const result = await readProofhouse("0x0000000000000000000000000000000000000001", { readContract: async () => { throw new Error("RPC unavailable"); } });
    expect(result.status).toBe("partial"); expect(result.earningsEth).toBeNull(); expect(result.unavailable).toContain("eligibleBroker");
    expect(result.brokerLink).toContain("broker=0x0000000000000000000000000000000000000001");
  });
  it("decodes successful reads and refuses malformed wallets", async () => {
    const result = await readProofhouse(undefined, { readContract: async ({ functionName }) => ({ remaining: 7n, claimsOpen: true, auctionState: [true, false, 1000000000000000000n, 10n, "0x0", 2000000000000000000n], saleOpen: false, price: 10000000000000000n })[functionName as "remaining"] });
    expect(result.status).toBe("live"); expect(result.auction?.highBidEth).toBe("2"); expect(result.editionPriceEth).toBe("0.01");
    await expect(readProofhouse("not-a-wallet")).rejects.toThrow();
  });
});
