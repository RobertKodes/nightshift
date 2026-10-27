import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Company, Product } from "@nightshift/core";
import { namehash } from "viem";
import { eth } from "./chain.js";
import { safeFetch } from "./net.js";
import { backupUrl, contenthashCid, productSite, SiteBackups } from "./site-backup.js";

vi.mock("./chain.js", () => ({ eth: { getEnsResolver: vi.fn(), readContract: vi.fn() } }));
vi.mock("./net.js", () => ({ safeFetch: vi.fn() }));

const CID = "bafybeifmibbcoyqpiq7t6u2su7jr7vwegpakyw4ezcjr723mrmmrcbdfve";
const HASH = "0xe30101701220ac404227620f443f3f5352a7d31fd6c433c0ac5b84c8931feb6c8b19110465a9";
const URL = "https://ns-nightwatch-981.identitymd.eth.limo";
const BACKUP = `https://imd-ipfs.xyz/ipfs/${CID}/`;
const resolver = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(eth.getEnsResolver).mockResolvedValue(resolver);
  vi.mocked(eth.readContract).mockResolvedValue(HASH);
  vi.mocked(safeFetch).mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

describe("IMD site backups", () => {
  it("decodes NIGHTWATCH's ipfs-ns contenthash to its base32 CIDv1", () => {
    expect(contenthashCid(HASH)).toBe(CID);
    expect(backupUrl(CID)).toBe(BACKUP);
    for (const hash of [null, "0x", "0xe50101701220", HASH.slice(0, -2), `${HASH}00`, "0xe301zz", HASH.replace("e30101", "e30100")]) expect(contenthashCid(hash)).toBeNull();
    for (const cid of ["bafake", `${CID}/../other`, `https://evil.test/${CID}`]) expect(backupUrl(cid)).toBeNull();
  });

  it.each([URL, URL.replace(".identitymd", ".site.identitymd")])("reads the ENS contenthash for %s and saves it", async (url) => {
    const record: { cid?: string } = {}, save = vi.fn();
    expect(await new SiteBackups().get(url, record, save)).toBe(BACKUP);
    const name = new globalThis.URL(url).hostname.replace(/\.limo$/, "");
    expect(eth.getEnsResolver).toHaveBeenCalledWith({ name });
    expect(eth.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: resolver, functionName: "contenthash", args: [namehash(name)] }));
    expect(record.cid).toBe(CID);
    expect(save).toHaveBeenCalledOnce();
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("uses a stored CID before the cache or either network source", async () => {
    expect(await new SiteBackups().get(URL, { cid: CID })).toBe(BACKUP);
    expect(eth.getEnsResolver).not.toHaveBeenCalled();
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it.each([false, true])("falls back to a matching label in the public list (array: %s)", async (array) => {
    vi.mocked(eth.readContract).mockRejectedValue(new Error("RPC unavailable"));
    const sites = [{ label: "wrong", cid: CID, jobId: "same-job" }, { label: "ns-nightwatch-981", url: URL, cid: CID, ensName: "ns-nightwatch-981.identitymd.eth", jobId: "different-job" }];
    vi.mocked(safeFetch).mockResolvedValue(Response.json(array ? sites : { sites }));
    expect(await new SiteBackups().get(URL.replace(".identitymd", ".site.identitymd"))).toBe(BACKUP);
    expect(safeFetch).toHaveBeenCalledWith("https://api.imd.fun/sites", expect.objectContaining({ signal: expect.any(AbortSignal) }), expect.objectContaining({ deadlineMs: 1500 }));
  });

  it("returns null on failures, missing labels, bad CIDs and malformed responses", async () => {
    vi.mocked(eth.getEnsResolver).mockRejectedValue(new Error("offline"));
    for (const response of [null, new Response("unavailable", { status: 503 }), new Response("bad JSON"), Response.json({ sites: null }), Response.json({ sites: [null, { label: "other", cid: CID }, { label: "ns-nightwatch-981", cid: "bad" }] })]) {
      vi.mocked(safeFetch).mockResolvedValue(response);
      expect(await new SiteBackups().get(URL)).toBeNull();
    }
    vi.mocked(safeFetch).mockRejectedValue(new Error("DNS failed"));
    expect(await new SiteBackups().get(URL)).toBeNull();
  });

  it("ignores unrelated URLs and lookalike hosts without a network call", async () => {
    const backups = new SiteBackups();
    for (const url of [null, "bad", "https://example.com", `${URL}.evil.test`, URL.replace("https:", "http:"), URL.replace("https://", "https://user@")]) expect(await backups.get(url, { cid: CID })).toBeNull();
    expect(eth.getEnsResolver).not.toHaveBeenCalled();
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("shares pending reads and bounds the cache", async () => {
    const backups = new SiteBackups(undefined, undefined, 2);
    expect(await Promise.all([backups.get(URL), backups.get(URL)])).toEqual([BACKUP, BACKUP]);
    expect(eth.readContract).toHaveBeenCalledTimes(1);
    await backups.get("https://second.identitymd.eth.limo");
    await backups.get("https://third.identitymd.eth.limo");
    await backups.get(URL);
    expect(eth.readContract).toHaveBeenCalledTimes(4);
  });

  it("briefly caches failures and retries after the delay", async () => {
    vi.useFakeTimers();
    vi.mocked(eth.getEnsResolver).mockRejectedValue(new Error("offline"));
    const backups = new SiteBackups();
    expect(await backups.get(URL)).toBeNull();
    expect(await backups.get(URL)).toBeNull();
    expect(safeFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    vi.mocked(eth.getEnsResolver).mockResolvedValue(resolver);
    expect(await backups.get(URL)).toBe(BACKUP);
  });

  it("falls back quickly when the mainnet client stalls", async () => {
    vi.useFakeTimers();
    vi.mocked(eth.getEnsResolver).mockReturnValue(new Promise(() => {}));
    vi.mocked(safeFetch).mockResolvedValue(Response.json({ sites: [{ label: "ns-nightwatch-981", cid: CID }] }));
    const work = new SiteBackups().get(URL);
    await vi.advanceTimersByTimeAsync(1501);
    expect(await work).toBe(BACKUP);
  });

  it("persists company and product site CIDs, and reuses them without another read", async () => {
    const p = { kind: "tool", deliverableUrl: URL } as Product;
    const c = { site: { url: URL, jobId: "j" }, products: [p] } as Company;
    const save = vi.fn(), backups = new SiteBackups();
    await backups.company(c, save);
    expect(c.site?.cid).toBe(CID);
    expect(p.site).toEqual({ url: URL, cid: CID });
    expect(save).toHaveBeenCalledTimes(2);
    vi.clearAllMocks();
    await new SiteBackups().company(c, save);
    expect(eth.getEnsResolver).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(productSite(p)).toEqual({ site: URL, siteBackup: BACKUP });
    p.deliverableUrl = "https://new.identitymd.eth.limo";
    expect(productSite(p).siteBackup).toBeNull();
  });
});
