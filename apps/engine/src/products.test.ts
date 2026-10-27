import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Company, Product } from "@nightshift/core";
import { ProductFiles, toolAccess } from "./products.js";
import { eth } from "./chain.js";
import { safeFetch } from "./net.js";

vi.mock("./chain.js", () => ({ eth: { getEnsResolver: vi.fn(), readContract: vi.fn() } }));
vi.mock("./net.js", () => ({ safeFetch: vi.fn() }));

const CID = "bafybeifmibbcoyqpiq7t6u2su7jr7vwegpakyw4ezcjr723mrmmrcbdfve";
const SITE = "https://ns-nightwatch-981.identitymd.eth.limo";
const BACKUP = `https://imd-ipfs.xyz/ipfs/${CID}/`;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(eth.getEnsResolver).mockResolvedValue("0x1111111111111111111111111111111111111111");
  vi.mocked(eth.readContract).mockResolvedValue("0xe30101701220ac404227620f443f3f5352a7d31fd6c433c0ac5b84c8931feb6c8b19110465a9");
  vi.mocked(safeFetch).mockImplementation(async () => new Response("ok"));
});

const co = (id: string) => ({ id, slug: id, name: id, audience: "x" }) as Company;
const product = (id: string) => ({ id, name: "Guide", pitch: "p", status: "live" }) as Product;

describe("packaged products", () => {
  it("delivers the browser tool's backup under its main link", async () => {
    const files = new ProductFiles(mkdtempSync(join(tmpdir(), "ns-products-")), "s3cret", null, "m", "http://host");
    const p = { ...product("new-tool"), kind: "tool", deliverableUrl: SITE } as Product;
    const c = { ...co("nightwatch"), site: null, products: [p] };
    await files.ensure(c, p, async () => toolAccess(c, p, SITE));
    expect(files.read(c, p)).toContain(`${SITE}\n\nBackup link (if the site does not open): ${BACKUP}`);
    expect(p.site).toEqual({ url: SITE, cid: CID });
    expect(await files.delivery(c, p)).toBe(files.read(c, p));
  });

  it("adds the backup to an already sold file on download, once, preserving its contents and CRLF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ns-products-"));
    const files = new ProductFiles(dir, "s3cret", null, "m", "http://host");
    const p = { ...product("soldtool"), kind: "tool", deliverableUrl: SITE, sales: 1 } as Product;
    const c = { ...co("nightwatch"), site: null, products: [p] };
    const old = `# Paid NIGHTWATCH Checker\r\n\r\n${SITE}\r\n\r\nKeep this buyer's instructions.\r\n`;
    const path = join(dir, "products", "soldtool.md");
    writeFileSync(path, old);
    const first = await files.delivery(c, p);
    expect(first).toBe(old.replace(SITE, `${SITE}\r\n\r\nBackup link (if the site does not open): ${BACKUP}`));
    expect(readFileSync(path, "utf8")).toBe(first);
    expect(await files.delivery(c, p)).toBe(first);
    expect(files.read(c, p)?.match(/Backup link/g)).toHaveLength(1);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("keeps two companies' products apart even with the same id, files and links alike", async () => {
    const files = new ProductFiles(mkdtempSync(join(tmpdir(), "ns-products-")), "s3cret", null, "m", "http://host");
    const id = "6b1f8a3e-0000-4000-8000-000000000001";
    const [a, b] = [co("A"), co("B")];
    await files.ensure(a, product(id), async () => "A's paid notes");
    expect(files.has(a, product(id))).toBe(true);
    expect(files.has(b, product(id))).toBe(false);
    await files.ensure(b, product(id), async () => "B's own notes");
    expect(files.read(b, product(id))).toContain("B's own notes");
    expect(files.read(a, product(id))).toContain("A's paid notes");
    const parts = new URL(files.link(a, product(id), "0xtx")).pathname.split("/"); // /download/slug/id/exp/sig
    expect(files.check(a, id, parts[4]!, parts[5]!, "0xtx")).toBe(true);
    expect(files.check(b, id, parts[4]!, parts[5]!, "0xtx")).toBe(false);
  });
});
