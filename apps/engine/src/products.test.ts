import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Company, Product } from "@nightshift/core";
import { ProductFiles } from "./products.js";

const co = (id: string) => ({ id, slug: id, name: id, audience: "x" }) as Company;
const product = (id: string) => ({ id, name: "Guide", pitch: "p", status: "live" }) as Product;

describe("packaged products", () => {
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
