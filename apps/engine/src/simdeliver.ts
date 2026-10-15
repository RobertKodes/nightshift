import type { Company } from "@nightshift/core";
import type { ImdAction, JobResult } from "@nightshift/imd";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmClient } from "@nightshift/llm";

/**
 * In sim mode the swarm's deliveries are made here, so a demo company has a real page to visit and
 * a real file to sell. With an LLM key the content is written by the model; without one it is a
 * clearly labelled sample.
 */
export class SimDeliveries {
  /** jobId → company id; the page is rendered from the company's current state on each visit. */
  readonly sites = new Map<string, string>();
  readonly files = new Map<string, string>();

  constructor(
    private readonly publicUrl: string,
    private readonly llm: LlmClient | null,
    private readonly model: string,
    private readonly companyFor: (input: unknown) => Company | undefined,
    private readonly dir: string,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  /** A delivered file, from memory or from disk after a restart. */
  file(jobId: string, name: string): string | null {
    const key = `${jobId}/${name}`;
    if (this.files.has(key)) return this.files.get(key)!;
    const f = join(this.dir, `${jobId}-${name}.md`.replace(/[^a-zA-Z0-9.-]/g, "_"));
    return existsSync(f) ? readFileSync(f, "utf8") : null;
  }

  async deliver(jobId: string, action: ImdAction, input: unknown): Promise<Omit<JobResult, "jobId">> {
    const i = input as { skill?: string; objective?: string; outputs?: { name: string }[]; parentJobId?: string };
    const c = this.companyFor(input);
    if (i.skill === "build-website" || action === "job.continue") {
      if (c) this.sites.set(jobId, c.id);
      return { siteUrl: `${this.publicUrl}/sites/${jobId}`, repoUrl: null, files: {}, summary: "Static site, hosted." };
    }
    const name = i.outputs?.[0]?.name ?? "report";
    const text = await this.write(i.objective ?? "", c);
    this.files.set(`${jobId}/${name}`, text);
    writeFileSync(join(this.dir, `${jobId}-${name}.md`.replace(/[^a-zA-Z0-9.-]/g, "_")), text);
    return { siteUrl: null, repoUrl: null, files: { [name]: `${this.publicUrl}/files/${jobId}/${name}` }, summary: "Report written." };
  }

  async write(objective: string, c: Company | undefined): Promise<string> {
    if (this.llm) {
      try {
        const r = await this.llm.chat({
          model: this.model,
          maxTokens: 1800,
          temperature: 0.5,
          messages: [
            { role: "system", content: "You write paid digital products: specific, practical, structured Markdown with headings, steps, examples and a checklist. No filler." },
            { role: "user", content: objective },
          ],
        });
        if (r.message.content) return r.message.content;
      } catch { /* fall back to the sample */ }
    }
    return `# ${c?.name ?? "Report"}\n\n> Sample delivery from the simulated swarm. In live mode the IMD swarm writes this file and it is accepted by an independent review.\n\n## Brief\n\n${objective}\n\n## Contents\n\n1. The problem, in numbers\n2. What works today, with examples\n3. A step-by-step plan for this week\n4. Tools and templates\n5. Checklist\n`;
  }

  site(c: Company): string {
    const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
    const products = c.products.filter((p) => p.status === "live")
      .map((p) => `<article><h3>${esc(p.name)}</h3><p>${esc(p.pitch)}</p><a class="buy" href="${this.publicUrl}/c/${c.slug}#${p.id}">Buy · $${(Number(p.priceUsdc) / 1e6).toFixed(2)}</a></article>`)
      .join("") || "<p>First product coming tonight.</p>";
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.name)}</title>
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#0b0d12;color:#e8ecf3}main{max-width:820px;margin:0 auto;padding:64px 20px}h1{font-size:clamp(36px,6vw,64px);line-height:1.05;margin:0 0 16px}.lead{color:#9aa4b5;font-size:20px;max-width:620px}section{margin-top:48px;display:grid;gap:16px}article{border:1px solid #232a36;border-radius:12px;padding:20px;background:#11151d}article h3{margin:0 0 6px}.buy{display:inline-block;margin-top:10px;padding:10px 16px;border-radius:8px;background:#7cf2c2;color:#05110c;font-weight:600;text-decoration:none}footer{margin-top:64px;color:#5d6778;font-size:13px}</style></head>
<body><main><h1>${esc(c.name)}</h1><p class="lead">${esc(c.mission)}</p><p>For ${esc(c.audience)}.</p><section>${products}</section>
<footer>Built and run by an autonomous company on NIGHTSHIFT. Sample site from the simulated swarm.</footer></main></body></html>`;
  }
}
