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
    const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
    const live = c.products.filter((p) => p.status === "live");
    const price = (u: bigint) => `$${(Number(u) / 1e6).toFixed(2)}`;
    const buy = (id: string) => `${this.publicUrl}/c/${c.slug}#${id}`;
    const products = live
      .map((p) => `<article><span class="tag">${esc(p.kind)}</span><h3>${esc(p.name)}</h3><p>${esc(p.pitch)}</p><div class="row"><b>${price(p.priceUsdc)}</b><a class="buy" href="${buy(p.id)}">Buy now</a></div></article>`)
      .join("") || "<p class=\"lead\">The first product ships tonight.</p>";
    const first = live[0];
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.name)}</title>
<style>*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:#0a0c11;color:#e8ecf3}
body:before{content:"";position:fixed;inset:0;background:radial-gradient(900px 500px at 80% -10%,rgba(124,242,194,.12),transparent 60%),radial-gradient(700px 420px at -10% 30%,rgba(122,167,255,.10),transparent 60%);pointer-events:none}
.wrap{position:relative;max-width:980px;margin:0 auto;padding:0 20px}nav{display:flex;align-items:center;justify-content:space-between;padding:22px 0}
.logo{font-weight:700;letter-spacing:-.01em;font-size:18px}.logo i{display:inline-block;width:10px;height:10px;border-radius:50%;background:#7cf2c2;margin-right:9px;box-shadow:0 0 14px #7cf2c2}
nav a{color:#9aa4b5;text-decoration:none;font-size:14px;margin-left:22px}nav a:hover{color:#fff}
.hero{padding:72px 0 40px}.eyebrow{display:inline-block;font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;color:#7cf2c2;border:1px solid rgba(124,242,194,.35);border-radius:999px;padding:4px 12px}
h1{font-size:clamp(40px,7vw,76px);line-height:1.02;letter-spacing:-.03em;margin:18px 0 18px;max-width:820px}.lead{color:#9aa4b5;font-size:clamp(17px,2.2vw,21px);max-width:640px;margin:0}
.cta{display:inline-block;margin-top:30px;padding:13px 22px;border-radius:10px;background:#7cf2c2;color:#05110c;font-weight:650;text-decoration:none;box-shadow:0 10px 30px -10px rgba(124,242,194,.6)}
h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#6d7789;margin:56px 0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
article{border:1px solid #1e2531;border-radius:14px;padding:22px;background:linear-gradient(180deg,#121722,#0e121a)}
.tag{font-size:11.5px;color:#9aa4b5;border:1px solid #2a3240;border-radius:999px;padding:2px 9px;text-transform:uppercase;letter-spacing:.06em}
article h3{margin:14px 0 6px;font-size:20px;letter-spacing:-.01em}article p{margin:0;color:#9aa4b5}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px}.row b{font-size:22px}
.buy{padding:10px 16px;border-radius:9px;background:#7cf2c2;color:#05110c;font-weight:650;text-decoration:none}
dl{display:grid;gap:12px;margin:0}dl div{border-top:1px solid #1e2531;padding-top:12px}dt{font-weight:600}dd{margin:4px 0 0;color:#9aa4b5}
footer{margin:72px 0 0;padding:24px 0 40px;border-top:1px solid #1e2531;color:#5d6778;font-size:13px}</style></head>
<body><div class="wrap"><nav><span class="logo"><i></i>${esc(c.name)}</span><span><a href="#products">Products</a><a href="#faq">FAQ</a></span></nav>
<header class="hero"><span class="eyebrow">For ${esc(c.audience)}</span><h1>${esc(c.mission)}</h1>${first ? `<p class="lead">${esc(first.pitch)}</p><a class="cta" href="${buy(first.id)}">Get ${esc(first.name)} · ${price(first.priceUsdc)}</a>` : ""}</header>
<h2 id="products">Products</h2><section class="grid">${products}</section>
<h2 id="faq">FAQ</h2><dl><div><dt>What do I get?</dt><dd>A downloadable file, delivered right after payment.</dd></div><div><dt>How do I pay?</dt><dd>In USDC through x402. AI agents can buy the same link directly.</dd></div><div><dt>Who makes this?</dt><dd>An autonomous company on NIGHTSHIFT: an AI CEO commissions the work from the IMD swarm.</dd></div></dl>
<footer>Built and run by an autonomous company on NIGHTSHIFT. Sample site from the simulated swarm.</footer></div></body></html>`;
  }
}
