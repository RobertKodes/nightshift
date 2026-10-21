import { inputHash } from "imd-mcp/lib";
import { terms } from "./market.js";
import type { Decision } from "./planner.js";
import type { Company, Task, TaskKind } from "./types.js";
import { fromUsdc } from "./types.js";

/**
 * The company's memory: what it already did, made and sold, in a few lines for the CEO each shift,
 * and the hard rules every move is held to, the model's and the playbook's alike. A company never
 * orders a product, research or site it already has, never the same IMD order twice (by what it is
 * about, not only by its exact body), and never tries work a third time that failed twice.
 */

/** Two pieces of work are the same when this share of their key terms match... */
const SAME = 0.6;
/** ...or when nearly all of the shorter one is inside the other. */
const HOLDS = 0.85;
/** Work that failed this many times is not tried that way again. */
export const MAX_FAILS = 2;
const DAY = 24 * 60 * 60 * 1000;
const PAID = new Set<TaskKind>(["research", "build_product", "build_site", "improve_site"]);
const LABEL: Record<TaskKind, string> = {
  research: "research", build_product: "product", build_site: "site", improve_site: "site change", marketing: "post", reprice: "price change", retire_product: "retirement", post: "post",
};

// the words every order of a kind carries (catalog.ts), so only what the work is about is compared
const BOILER = terms("Write it is a paid digital product so it must be actionable and worth its price. Build a small self-contained web tool. "
  + "Static, runs in the browser, no wallet, no backend. Clean, fast, works on a phone. Context: sells to. The owner's direction. "
  + "Build the website. Improve the website. Products and their buy links. The buy links take payment themselves; link to them, do not add a wallet. Static site.");

/** What a move is about, in plain words, kept on its task: the product, the brief and the owner's direction then. */
export function aboutOf(c: Company, d: Decision): string {
  return [d.product ? `${d.product.name}: ${d.product.pitch}` : "", d.brief || d.title, c.direction ? `Direction: ${c.direction}` : ""].filter(Boolean).join(" ");
}

/** Older tasks have no `about`: their IMD order says what they were, or else the title. */
function taskAbout(t: Task): string {
  if (t.about) return t.about;
  const o = (t.imd?.input as { objective?: unknown } | undefined)?.objective;
  return typeof o === "string" && o ? o : t.title;
}

/** The key terms of a piece of work: all of them, and those left without the company's own context (`own`). */
export interface Topic { all: Set<string>; own: Set<string> }

export function topicOf(c: Company, text: string): Topic {
  const context = terms(`${c.name} ${c.audience} ${c.mission} ${c.idea}`);
  // the owner's direction is compared on its own (sameDirection): its words would make every brief under it look alike
  const all = new Set([...terms(text.replace(DIRECTION, ""))].filter((w) => !BOILER.has(w)));
  return { all, own: new Set([...all].filter((w) => !context.has(w))) };
}

const overlap = (a: Set<string>, b: Set<string>) => {
  const shared = [...a].filter((w) => b.has(w)).length;
  return { shared, jaccard: shared / Math.max(1, a.size + b.size - shared) };
};

/**
 * Two briefs ask for the same work when what they add to the company's context matches, or, when one adds
 * nothing (a brief that only restates the idea), when nearly all their words match.
 */
export function sameTopic(a: Topic, b: Topic): boolean {
  if (!a.own.size && !b.own.size) return true;
  if (a.own.size && b.own.size) {
    const o = overlap(a.own, b.own);
    const small = Math.min(a.own.size, b.own.size);
    if (o.jaccard >= SAME || (small >= 4 && o.shared / small >= HOLDS)) return true;
  }
  return overlap(a.all, b.all).jaccard >= 0.75;
}

// the owner's direction a piece of work was ordered under, as aboutOf and imdOrder write it
const DIRECTION = /(?:The owner's direction|Direction): ([\s\S]*)$/;
const directionOf = (text: string) => DIRECTION.exec(text)?.[1]?.trim() ?? "";
/** A new direction from the owner makes the same question new work; a reworded one does not. */
function sameDirection(a: string, b: string): boolean {
  if (!a || !b) return !a && !b;
  return overlap(terms(a), terms(b)).jaccard >= SAME;
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function sameName(a: string, b: string): boolean {
  if (plain(a) === plain(b)) return true;
  const x = terms(a), y = terms(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return x.size >= 2 && y.size >= 2 && shared / (x.size + y.size - shared) >= 0.75;
}

/** Skipped for the daily budget: a rest, not a failure. The work was never tried. */
export const budgetSkip = (t: Task) => t.status === "failed" && t.costImd === 0n && /over the \$[\d.]+ budget$/.test(t.error ?? "");
/** Tried and did not go through. */
const failedTry = (t: Task) => t.status === "failed" && !budgetSkip(t);

/** The site the swarm delivered whose address IMD had not published yet. */
export function siteWithoutAddress(c: Company): Task | undefined {
  if (c.site) return undefined;
  return [...c.tasks].reverse().find((t) => t.kind === "build_site" && t.status === "done" && t.imd?.jobId && !t.result?.siteUrl);
}

/**
 * Why a move repeats earlier work, or null when it is new. `order` is the IMD body the move would
 * buy, when it buys one: an identical body is always a repeat.
 */
export function repeatOf(c: Company, d: Decision, order?: { action: string; input: unknown } | null, now = Date.now()): string | null {
  if (d.kind === "build_site") {
    if (c.site) return "the company already has its site";
    const built = siteWithoutAddress(c);
    if (built) return `the site was built in shift ${built.cycle}; its address is being collected from IMD, not bought again`;
  }
  if (d.kind === "improve_site" && !c.site) return "there is no site to change yet";
  if (d.kind === "build_product" && d.product) {
    const had = c.products.find((p) => sameName(p.name, d.product!.name));
    if (had) return `it already has "${had.name}" (${had.kind}, ${had.status})`;
  }
  if (PAID.has(d.kind)) {
    const about = topicOf(c, aboutOf(c, d));
    const hash = order ? inputHash(order.action, order.input) : null;
    const same = (t: Task) => t.kind === d.kind && ((hash !== null && t.imd !== undefined && inputHash(t.imd.action, t.imd.input) === hash)
      || (sameDirection(directionOf(taskAbout(t)), c.direction ?? "") && sameTopic(topicOf(c, taskAbout(t)), about)));
    const fails = c.tasks.filter((t) => failedTry(t) && same(t));
    if (fails.length >= MAX_FAILS) return `the same ${LABEL[d.kind]} failed ${fails.length} times (last: ${(fails.at(-1)!.error ?? "no reason given").slice(0, 120)}), so it is not tried that way again`;
    const no = c.tasks.find((t) => t.status === "rejected" && same(t));
    if (no) return `the owner turned the same ${LABEL[d.kind]} down in shift ${no.cycle}`;
    const twin = c.tasks.find((t) => t.status !== "failed" && t.status !== "rejected" && same(t));
    if (twin) return `the same ${LABEL[d.kind]} was already ordered in shift ${twin.cycle} ("${twin.title.slice(0, 80)}")`;
  }
  if (d.kind === "marketing") {
    const text = (d.post || d.brief || "").slice(0, 280).trim();
    if (text && c.marketing.some((m) => m.text.trim() === text)) return "the same post was already drafted";
  }
  if (d.kind === "reprice" || d.kind === "retire_product") {
    const p = c.products.find((x) => x.id === d.productId);
    if (!p || p.status !== "live") return "that product is not on sale";
    if (d.kind === "reprice") {
      if (p.priceByOwner) return `the owner set the price of "${p.name}"`;
      if (Math.abs(fromUsdc(p.priceUsdc) - Number(d.priceUsd)) < 0.005) return `"${p.name}" already costs $${fromUsdc(p.priceUsdc).toFixed(2)}`;
      const last = [...c.tasks].reverse().find((t) => t.kind === "reprice" && t.status === "done" && t.productId === p.id);
      if (last && now - last.updatedAt < 3 * DAY) return `"${p.name}" was repriced in shift ${last.cycle}; the new price needs a few days to show what it does`;
    }
  }
  return null;
}

/** What the company did, made and sold so far, in a few lines for the CEO's prompt. */
export function memoryLines(c: Company): string[] {
  const out: string[] = [];
  const made = c.products.map((p) => `"${p.name}" (${p.kind}, ${p.status}, ${p.sales + (p.b2bSales ?? 0)} sold, $${fromUsdc(p.revenueUsdc + (p.b2bRevenueUsdc ?? 0n)).toFixed(2)})`);
  out.push(`- Products made: ${made.join("; ") || "none yet"}`);
  const research = c.tasks.filter((t) => t.kind === "research" && !failedTry(t) && t.status !== "rejected" && !budgetSkip(t));
  if (research.length) out.push(`- Research it has (use it, never order it again): ${research.slice(-8).map((t) => `"${t.title.slice(0, 80)}"${t.status === "done" ? "" : ` (${t.status})`}`).join("; ")}`);
  const pending = siteWithoutAddress(c);
  out.push(`- Site: ${c.site ? `live at ${c.site.url}` : pending ? `built in shift ${pending.cycle}, its address is on its way: never build it again` : "none yet"}`);
  const changes = c.tasks.filter((t) => t.kind === "improve_site" && t.status === "done").slice(-4);
  if (changes.length) out.push(`- Site changes made: ${changes.map((t) => `"${t.title.slice(0, 70)}"`).join("; ")}`);
  const kinds = new Map<string, number>();
  for (const t of c.tasks) if (!budgetSkip(t)) kinds.set(t.kind, (kinds.get(t.kind) ?? 0) + 1);
  if (kinds.size) out.push(`- Moves so far: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(", ")}`);
  // the same work failing again is grouped, so the CEO sees it is a pattern, not one bad day
  const failed: { t: Task; n: number }[] = [];
  for (const t of c.tasks.filter(failedTry)) {
    const g = failed.find((x) => x.t.kind === t.kind && sameTopic(topicOf(c, taskAbout(x.t)), topicOf(c, taskAbout(t))));
    if (g) { g.n += 1; g.t = t; } else failed.push({ t, n: 1 });
  }
  if (failed.length) out.push(`- Failed: ${failed.slice(-5).map(({ t, n }) => `${t.kind} "${t.title.slice(0, 60)}" ${n > 1 ? `${n} times` : "once"} (${(t.error ?? "no reason").slice(0, 80)})${n >= MAX_FAILS ? ", do not try it again that way" : ""}`).join("; ")}`);
  if (c.marketing.length) out.push(`- Posts drafted: ${c.marketing.length}, the last: "${c.marketing.at(-1)!.text.slice(0, 90)}"`);
  const sold = c.products.reduce((a, p) => a + p.sales + (p.b2bSales ?? 0), 0);
  const best = [...c.products].sort((a, b) => b.sales - a.sales)[0];
  out.push(`- Sold so far: ${sold ? `${sold} (best: "${best!.name}", ${best!.sales})` : "nothing yet"}`);
  return out;
}
