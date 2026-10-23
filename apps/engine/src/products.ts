import { createHmac, timingSafeEqual } from "node:crypto";
import { safeFetch } from "./net.js";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeAtomic } from "./atomic.js";
import { join } from "node:path";
import type { Company, Product } from "@nightshift/core";
import type { LlmClient } from "@nightshift/llm";

/**
 * What a buyer actually receives. The IMD swarm publishes its work openly (research lands in a
 * public GitHub repo), so a company cannot sell that link. Instead each product is packaged into a
 * private file kept here, with every cited link checked, and handed out through download links
 * that are signed per sale and expire.
 */
export class ProductFiles {
  readonly #dir: string;
  readonly #key: string;
  readonly #inflight = new Set<string>();

  constructor(dataDir: string, secretMaterial: string, private readonly llm: LlmClient | null, private readonly model: string, private readonly publicUrl: string) {
    this.#dir = join(dataDir, "products");
    mkdirSync(this.#dir, { recursive: true });
    this.#key = createHmac("sha256", secretMaterial).update("nightshift-downloads-v1").digest("hex");
  }

  /**
   * File and signature belong to the company and the product together, so two products never share
   * either. Products from before (8-character ids, made before ids became full UUIDs) keep their file.
   */
  #file(c: Company, p: Product) {
    const clean = (x: string) => x.replace(/[^a-zA-Z0-9-]/g, "");
    return join(this.#dir, legacy(p.id) ? `${clean(p.id)}.md` : `${clean(c.id)}-${clean(p.id)}.md`);
  }
  /** A studio product's download (a ZIP of its PDFs) and its listing images sit next to the text files. */
  #bin(c: Company, p: Product) { return join(this.#dir, `${c.id.replace(/[^a-zA-Z0-9-]/g, "")}-${p.id.replace(/[^a-zA-Z0-9-]/g, "")}.zip`); }
  #img(c: Company, p: Product, name: string) { return join(this.#dir, `${c.id.replace(/[^a-zA-Z0-9-]/g, "")}-${p.id.replace(/[^a-zA-Z0-9-]/g, "")}-${name.replace(/[^a-z0-9-]/g, "")}.png`); }
  has(c: Company, p: Product): boolean { return existsSync(this.#file(c, p)) || existsSync(this.#bin(c, p)); }
  /** The text of a Markdown product (research, guides, tool links); null for a studio download. */
  read(c: Company, p: Product): string | null { return existsSync(this.#file(c, p)) ? readFileSync(this.#file(c, p), "utf8") : null; }
  /** A studio product's download, as the buyer gets it. */
  bytes(c: Company, p: Product): { data: Buffer; name: string; type: string } | null {
    const f = this.#bin(c, p);
    if (!existsSync(f)) return null;
    const base = p.name.replace(/[^\w .()-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 70) || "product";
    return { data: readFileSync(f), name: `${base}.zip`, type: "application/zip" };
  }
  putBundle(c: Company, p: Product, zip: Uint8Array): void { writeAtomic(this.#bin(c, p), Buffer.from(zip), { mode: 0o600 }); }
  putImage(c: Company, p: Product, name: string, png: Buffer): void { writeAtomic(this.#img(c, p, name), png, { mode: 0o644 }); }
  image(c: Company, p: Product, name: string): Buffer | null { const f = this.#img(c, p, name); return existsSync(f) ? readFileSync(f) : null; }

  /** A link that opens this product for 7 days. `ref` ties it to one sale (a tx hash or a buyer). */
  link(c: Company, p: Product, ref: string, days = 7): string {
    const exp = Math.floor(Date.now() / 1000) + days * 86400;
    return `${this.publicUrl}/download/${c.slug}/${p.id}/${exp}/${this.#sig(`${c.id}/${p.id}`, exp, ref)}?ref=${encodeURIComponent(ref)}`;
  }
  check(c: Company, productId: string, exp: string, sig: string, ref: string): boolean {
    const e = Number(exp);
    if (!Number.isFinite(e) || e < Date.now() / 1000) return false;
    const got = Buffer.from(sig);
    const ok = (signed: string) => { const want = Buffer.from(this.#sig(signed, e, ref)); return want.length === got.length && timingSafeEqual(want, got); };
    // links sold before links named the company still open, for the old 8-character products only
    return ok(`${c.id}/${productId}`) || (legacy(productId) && ok(productId));
  }
  #sig(id: string, exp: number, ref: string) { return createHmac("sha256", this.#key).update(`${id}|${exp}|${ref}`).digest("base64url").slice(0, 32); }

  /** Builds the private copy once the swarm has delivered. Safe to call every tick. */
  async ensure(c: Company, p: Product, source: () => Promise<string | null>): Promise<void> {
    const f = this.#file(c, p);
    if (p.status !== "live" || this.has(c, p) || this.#inflight.has(f)) return;
    this.#inflight.add(f);
    try {
      const raw = await source();
      if (!raw) return;
      const body = await this.#package(c, p, raw);
      const checked = await checkLinks(body);
      writeAtomic(f, `${body.trim()}\n\n---\n\n${checked}\n`, { mode: 0o600 });
    } catch (e) {
      console.error("package", c.slug, p.id, (e as Error).message);
    } finally {
      this.#inflight.delete(f);
    }
  }

  async #package(c: Company, p: Product, raw: string): Promise<string> {
    const head = `# ${p.name}\n\n_${p.pitch}_\n\n> Made by ${c.name}, an autonomous company on NIGHTSHIFT. Researched by the IMD agent swarm and packaged by AI. Check anything you rely on: every link cited below was tested when this file was made.\n\n`;
    // a web tool is not notes to rewrite: the buyer gets its address as it is
    if (p.kind === "tool") return `# ${p.name}\n\n_${p.pitch}_\n\n> Made by ${c.name}, an autonomous company on NIGHTSHIFT. Built by the IMD agent swarm and hosted on IPFS.\n\n${raw}`;
    if (!this.llm) return head + raw;
    try {
      const r = await this.llm.chat({
        model: this.model,
        maxTokens: 3000,
        temperature: 0.2,
        messages: [
          { role: "system", content: "You turn research notes into a clear, practical paid guide in Markdown. Use ONLY facts, numbers, names and links present in the notes. Never invent a statistic, tool, price, quote or URL. If the notes do not support a section, leave it out. Keep every source link next to the claim it supports. End with a checklist." },
          { role: "user", content: `Product: ${p.name}\nPromise: ${p.pitch}\nAudience: ${c.audience}\n\nNOTES:\n${raw.slice(0, 60_000)}` },
        ],
      });
      // A guide cut off by the model's length limit is worse than the full notes: sell those instead.
      if (r.finishReason === "length") return head + raw;
      return head + (r.message.content?.trim() || raw);
    } catch {
      return head + raw;
    }
  }
}

/** Ids from before products got full UUIDs (randomUUID().slice(0, 8)). */
const legacy = (id: string) => id.length <= 8;

/** Tests every http(s) link in the text and reports which answered. */
async function checkLinks(text: string): Promise<string> {
  const urls = [...new Set((text.match(/https?:\/\/[^\s)\]>"'`]+/g) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))].slice(0, 60);
  const day = new Date().toISOString().slice(0, 10);
  if (!urls.length) return `_Sources: this file cites no links (checked ${day})._`;
  const res = await Promise.all(urls.map(async (u) => {
    try {
      const r = await safeFetch(u, { method: "GET", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "NIGHTSHIFT link check" } });
      return [u, Boolean(r && r.status < 400)] as const;
    } catch { return [u, false] as const; }
  }));
  const ok = res.filter(([, v]) => v).length;
  return `## Sources checked on ${day}\n\n${ok} of ${res.length} cited links answered.\n\n${res.map(([u, v]) => `- ${v ? "✓" : "✗ did not answer:"} ${u}`).join("\n")}`;
}

/**
 * The Markdown behind a swarm delivery: a delivered file, or the files IMD published for the job.
 * IMD's repo README is an index that links the real artifacts in ../files/, so those are followed.
 */
export async function fetchDelivery(files: Record<string, string> | undefined, repoUrl: string | null | undefined): Promise<string | null> {
  const get = async (u: string) => { const r = await safeFetch(u, { signal: AbortSignal.timeout(15000) }); return r?.ok ? r.text() : null; };
  const first = Object.values(files ?? {})[0];
  if (first) return get(first);
  if (!repoUrl) return null;
  const readme = repoUrl.replace("https://github.com/", "https://raw.githubusercontent.com/").replace("/blob/", "/");
  const index = await get(readme);
  if (!index) return null;
  const links = [...index.matchAll(/\]\((\.\.\/files\/[^)\s]+)\)/g)].map((m) => new URL(m[1]!, readme).toString()).slice(0, 5);
  if (!links.length) return index.length > 200 ? index : null;
  const parts = (await Promise.all(links.map(get))).filter((x): x is string => Boolean(x));
  return parts.length ? parts.join("\n\n---\n\n") : null;
}

/** What the buyer of a web tool receives: its address and how to use it. */
export function toolAccess(c: Company, p: Product, url: string): string {
  return `## Open ${p.name}\n\n${url}\n\nIt runs in your browser: nothing to install and no account. Bookmark the address to come back to it.\n\nMade for ${c.audience}.`;
}
