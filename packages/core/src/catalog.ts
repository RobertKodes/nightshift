import { createHash } from "node:crypto";
import type { ImdAction } from "@nightshift/imd";
import type { Decision } from "./planner.js";
import type { Company } from "./types.js";

/** IMD site labels: lowercase, digits and hyphens, 1–32 characters. */
export function siteLabel(c: Company): string {
  return `ns-${c.slug}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 32).replace(/-$/, "");
}

/**
 * A web tool's own IMD site label: the company's, a word of the tool's name and a short hash of it, so
 * two tools of one company (whose names both start with the company name) never share an address.
 */
export function toolLabel(c: Company, name: string): string {
  const word = name.toLowerCase().replace(c.name.toLowerCase(), "").replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 8).replace(/-+$/, "");
  const h = createHash("sha256").update(name).digest("hex").slice(0, 4);
  return [siteLabel(c).slice(0, 18).replace(/-+$/, ""), word, h].filter(Boolean).join("-");
}

/**
 * Turns a decision into the exact body IMD will check and sell. Only decisions that buy work get a
 * body; marketing, repricing and retiring are done in-house for free.
 */
export function imdOrder(c: Company, d: Decision, buyBase: string): { action: ImdAction; input: Record<string, unknown> } | null {
  const o = order(c, d, buyBase);
  // the owner's standing direction travels with every order, so the swarm builds what the owner wants
  if (o && c.direction) o.input.objective = `${String(o.input.objective)} The owner's direction: ${c.direction}`;
  return o;
}

function order(c: Company, d: Decision, buyBase: string): { action: ImdAction; input: Record<string, unknown> } | null {
  switch (d.kind) {
    case "research":
      return {
        action: "job.open",
        input: {
          objective: `${d.brief} Context: ${c.name} sells to ${c.audience}. Mission: ${c.mission}.`,
          skill: "research-report",
          outputs: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }],
          minCitations: 5,
          github: false,
        },
      };
    case "build_product": {
      const p = d.product!;
      if (p.kind === "tool") {
        return {
          action: "job.open",
          input: {
            objective: `Build "${p.name}", a small self-contained web tool: ${p.pitch}. ${d.brief} Static, runs in the browser, no wallet, no backend. Clean, fast, works on a phone.`,
            skill: "build-website",
            ipfs: toolLabel(c, p.name),
            github: false,
          },
        };
      }
      return {
        action: "job.open",
        input: {
          objective: `Write "${p.name}": ${p.pitch}. ${d.brief} It is a paid digital product for ${c.audience}, so it must be specific, actionable and worth its price.`,
          skill: "research-report",
          outputs: [{ name: p.kind, path: `artifacts/${p.kind}.md`, mediaType: "text/markdown" }],
          minCitations: 5,
          github: false,
        },
      };
    }
    case "build_site": {
      const list = c.products.filter((p) => p.status !== "retired").map((p) => `"${p.name}" ($${(Number(p.priceUsdc) / 1e6).toFixed(2)}, buy link ${buyBase}/${p.id})`).join("; ");
      return {
        action: "job.open",
        input: {
          objective: `Build the website for ${c.name}. ${d.brief} Products and their buy links: ${list}. The buy links take payment themselves; link to them, do not add a wallet. Static site, fast, works on a phone.`,
          skill: "build-website",
          ipfs: siteLabel(c),
          github: false,
        },
      };
    }
    case "improve_site": {
      if (!c.site) return null;
      return { action: "job.continue", input: { parentJobId: c.site.jobId, objective: `Improve the ${c.name} website: ${d.brief}` } };
    }
    default:
      return null;
  }
}
