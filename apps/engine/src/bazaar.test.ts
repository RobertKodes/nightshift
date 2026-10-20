import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Company, Product } from "@nightshift/core";
import { facilitatorPayload, requirement, signPayment } from "@nightshift/x402";
import { extractDiscoveryInfo, validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import type * as AM from "./agentmarket.js";

/**
 * A resource as the CDP Bazaar lists it: copied from the live discovery API
 * (GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources, 2026-10-20), a GET endpoint
 * declared with the x402 project's declareDiscoveryExtension.
 */
const LISTED = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "bazaar-listed-get.json"), "utf8"));

let M: typeof AM;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bazaar-test-"));
  M = await import("./agentmarket.js");
});

const TEXT = ["# Cold email kit for designers", "", "Twelve templates that get replies.", "## Template 1", "Hi {name}…", ...Array.from({ length: 120 }, (_, i) => `Line ${i} of real advice about outreach.`)].join("\n");
const co = { id: "c1", slug: "leadnest", name: "LEADNEST", mission: "Help freelancers", wallet: privateKeyToAccount(generatePrivateKey()).address, products: [] } as unknown as Company;
const prod = (id: string, pitch = "Twelve cold email templates for freelance designers.") => ({ id, name: "Cold email kit", kind: "templates", pitch, priceUsdc: 9_000_000n, status: "live", sales: 0, createdAt: 1 }) as unknown as Product;
const UUID = "64efeb32-ff92-4f26-9ab9-101dea01a110";

/** The structure of a value: its keys all the way down, and the type of each leaf. */
const shape = (v: unknown): unknown => Array.isArray(v) ? [v.length ? shape(v[0]) : null] : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, shape(x)])) : typeof v;

describe("CDP Bazaar discovery", () => {
  it("carries the bazaar extension in the shape of a live listing", () => {
    const ours = M.bazaar(co, prod(UUID)).bazaar as typeof LISTED.extensions.bazaar;
    const theirs = LISTED.extensions.bazaar;
    // the input: a GET with no parameters, schema for schema
    expect(ours.info.input).toEqual(theirs.info.input);
    expect(ours.schema.properties.input).toEqual(theirs.schema.properties.input);
    expect(ours.schema.$schema).toBe(theirs.schema.$schema);
    expect(ours.schema.required).toEqual(theirs.schema.required);
    // the output: { type: "json", example } with the example's schema inside
    expect(ours.info.output.type).toBe(theirs.info.output.type);
    expect(Object.keys(ours.schema.properties.output).sort()).toEqual(Object.keys(theirs.schema.properties.output).sort());
    expect(ours.schema.properties.output.required).toEqual(theirs.schema.properties.output.required);
    expect(shape(ours.schema.properties.output.properties.type)).toEqual(shape(theirs.schema.properties.output.properties.type));
    expect(ours.schema.properties.output.properties.example.required).toEqual(["ok", "tx", "deliverable"]);
    // a realistic answer: a full transaction hash and a download link in the real format
    expect(ours.info.output.example.tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(ours.info.output.example.deliverable).toMatch(new RegExp(`/download/leadnest/${UUID}/\\d{10}/[\\w-]{32}\\?ref=0x[0-9a-f]{64}$`));
  });

  it("passes the facilitator's own validation: info against schema", () => {
    expect(validateDiscoveryExtension(LISTED.extensions.bazaar)).toEqual({ valid: true });
    expect(validateDiscoveryExtension(M.bazaar(co, prod(UUID)).bazaar as never)).toEqual({ valid: true });
    // and the old hand-written shape would not have (its output schema described the example, not info.output)
    const old = { info: { input: { type: "http", method: "GET" }, output: { type: "json", example: { ok: true } } }, schema: { type: "object", properties: { output: { type: "object", required: ["ok", "deliverable"] } } } };
    expect(validateDiscoveryExtension(old as never).valid).toBe(false);
  });

  it("is listed one entry per product, under its own URL, with its description, service name and tags", async () => {
    const p = prod(UUID);
    const o = M.offerFor(co, p, TEXT);
    // a bare UUID segment would fold every product into one Bazaar entry
    expect(o.resource.url).toMatch(new RegExp(`/buy/leadnest/p-${UUID}$`));
    expect(M.productIdOf(`p-${UUID}`)).toBe(UUID);
    expect(M.productIdOf("3ff53a4b")).toBe("3ff53a4b");
    expect(M.buyUrl(co, prod("3ff53a4b"))).toMatch(/\/buy\/leadnest\/3ff53a4b$/);
    // what the facilitator extracts from the settle request (x402's own extractor)
    const signed = await signPayment(privateKeyToAccount(generatePrivateKey()), o.requirement);
    const found = extractDiscoveryInfo(facilitatorPayload(signed, o) as never, o.requirement as never);
    expect(found).toMatchObject({
      resourceUrl: o.resource.url, method: "GET", x402Version: 2,
      description: o.resource.description, mimeType: "application/json", serviceName: "NIGHTSHIFT", tags: o.resource.tags,
      discoveryInfo: (o.extensions!.bazaar as { info: unknown }).info,
    });
    // with the buyer's payload alone (no echoed extensions) there would be nothing to list
    expect(extractDiscoveryInfo(signed as never, o.requirement as never)).toBeNull();
    expect(o.requirement).toEqual(requirement(84532, co.wallet, 9_000_000n));
  });

  it("keeps the description under the facilitator's 500 characters, whatever the pitch", () => {
    const o = M.offerFor(co, prod(UUID, "A very long pitch. ".repeat(60)), TEXT);
    expect(o.resource.description.length).toBeLessThan(500);
    expect(o.resource.description.startsWith("Cold email kit: ")).toBe(true);
    expect(o.resource.tags!.length).toBeLessThanOrEqual(5);
    for (const t of o.resource.tags!) expect(t).toMatch(/^[\x20-\x7e]{1,32}$/);
  });

  it("publishes the catalog in the listing's own shape", () => {
    const cat = M.catalog([{ c: co, p: prod(UUID), text: TEXT }]);
    const item = cat.items[0]!;
    // every field a live listing has, except the ones the Bazaar adds itself (quality, lastUpdated from its last call, iconUrl on https)
    for (const k of Object.keys(LISTED).filter((k) => !["quality", "iconUrl", "curated", "bundleSlugs"].includes(k))) expect(item).toHaveProperty(k);
    expect(shape(item.accepts)).toEqual(shape(LISTED.accepts));
    expect(Object.keys(item.extensions!)).toEqual(["bazaar"]);
  });
});
