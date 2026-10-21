import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Company } from "@nightshift/core";
import type { LedgerTx } from "@nightshift/ledger";
import { writeAtomic } from "./atomic.js";
import { chats } from "./community.js";
import { config } from "./config.js";
import { type Button, esc, telegram } from "./social.js";

/**
 * The daily company digest for the community chat, at DIGEST_HOUR (18:00 UTC by default): what the
 * live companies did in the last 24 hours, built only from their records and the ledger. Shifts run
 * (the CEO's "Shift N" decisions in the journals), products shipped and sites launched (build tasks
 * done), sales to people and outside agents (sale and Gumroad entries, refunds taken off), sales
 * between NIGHTSHIFT companies apart (b2b), IMD orders paid (imd_order entries never reversed), and
 * the company of the day. Simulated and house companies are never counted. Nothing happened: no
 * post. Once a day at most; in sim mode it only writes to data/digest-dryrun.log.
 */
const DAY = 86_400_000;
type Product = { name: string; kind: string; company: string; link: string };
export type DigestFacts = {
  from: number; to: number;
  shifts: number; companiesWorking: number;
  products: Product[]; sites: { company: string; url: string }[];
  sales: { count: number; usd: number }; b2b: { count: number; usd: number };
  imd: { count: number; imd: number };
  top: { name: string; slug: string; why: string } | null;
};

/** The company a ledger entry belongs to (`co:<id>:<asset>`), among the ones counted. */
const owner = (tx: LedgerTx, ids: Set<string>, side?: (amount: bigint) => boolean) => {
  for (const p of tx.postings) {
    const m = /^co:(.+):(usdc|imd|gumroad)$/.exec(p.account);
    if (m && ids.has(m[1]!) && (!side || side(p.amount))) return m[1]!;
  }
  return null;
};
/** USDC (6 decimals) and the ledger's USD (micro-dollars) are both millionths. */
const millionths = (v: bigint) => Number(v) / 1e6;

/** The last 24 hours of the live companies, from their records only. */
export function digestFacts(all: Iterable<Company>, txs: LedgerTx[], now: number, base = config.publicUrl): DigestFacts {
  const from = now - DAY, inDay = (t: number) => t > from && t <= now;
  const live = [...all].filter((c) => !c.sim && !c.house);
  const ids = new Set(live.map((c) => c.id)), byId = new Map(live.map((c) => [c.id, c]));
  const per = new Map<string, { shifts: number; built: number; usd: number; sales: number }>();
  const row = (id: string) => { let r = per.get(id); if (!r) per.set(id, r = { shifts: 0, built: 0, usd: 0, sales: 0 }); return r; };
  const f: DigestFacts = { from, to: now, shifts: 0, companiesWorking: 0, products: [], sites: [], sales: { count: 0, usd: 0 }, b2b: { count: 0, usd: 0 }, imd: { count: 0, imd: 0 }, top: null };
  for (const c of live) {
    // a shift is in the journal ("Shift N: …") and leaves its task, whoever decided it: each cycle counted once
    const cycles = new Set<number>([...c.journal.filter((j) => j.kind === "decision" && inDay(j.at) && /^Shift \d+/.test(j.text)).map((j) => j.cycle), ...c.tasks.filter((t) => inDay(t.createdAt)).map((t) => t.cycle)]);
    const shifts = cycles.size;
    if (shifts) { row(c.id).shifts += shifts; f.shifts += shifts; f.companiesWorking++; }
    for (const t of c.tasks) {
      if (t.status !== "done" || !inDay(t.updatedAt)) continue;
      if (t.kind === "build_product") {
        const p = c.products.find((x) => x.id === t.productId);
        if (!p || p.status === "building" || f.products.some((x) => x.name === p.name && x.company === c.name)) continue;
        f.products.push({ name: p.name, kind: p.kind, company: c.name, link: `${base}/c/${c.slug}` });
        row(c.id).built++;
      } else if (t.kind === "build_site") {
        const url = t.result?.siteUrl ?? c.site?.url;
        // a site is launched once: builds that ended at the same address are one site
        if (!url || f.sites.some((x) => x.url === url)) continue;
        f.sites.push({ company: c.name, url });
        row(c.id).built++;
      }
    }
  }
  const reversed = new Set(txs.filter((t) => t.kind === "imd_reversal").map((t) => t.id.replace(/^imd-reversal:/, "imd:")));
  for (const tx of txs) {
    if (!inDay(tx.at.getTime())) continue;
    if (tx.kind === "sale" || tx.kind === "gumroad" || tx.kind === "gumroad_refund") {
      const id = owner(tx, ids, (a) => (tx.kind === "gumroad_refund" ? a < 0n : a > 0n));
      if (!id) continue;
      // what the buyer paid: the outside side of the entry (a refund takes it back)
      const paid = tx.postings.filter((p) => p.account.startsWith("ext:") && !p.account.includes("fees")).reduce((a, p) => a - p.amount, 0n);
      const usd = millionths(paid), n = tx.kind === "gumroad_refund" ? -1 : 1;
      f.sales.count += n; f.sales.usd += usd;
      row(id).sales += n; row(id).usd += usd;
    } else if (tx.kind === "b2b") {
      // counted once, on the selling side
      const seller = owner(tx, ids, (a) => a > 0n);
      if (!seller) continue;
      f.b2b.count++;
      f.b2b.usd += millionths(tx.postings.find((p) => p.amount > 0n)!.amount);
    } else if (tx.kind === "imd_order" && !reversed.has(tx.id)) {
      if (!owner(tx, ids)) continue;
      f.imd.count++;
      f.imd.imd += Number(tx.postings.filter((p) => p.amount > 0n).reduce((a, p) => a + p.amount, 0n)) / 1e18;
    }
  }
  f.sales.usd = Math.round(f.sales.usd * 100) / 100;
  f.b2b.usd = Math.round(f.b2b.usd * 100) / 100;
  // the company of the day: sales first, then what it shipped, then how hard it worked
  const best = [...per].filter(([, r]) => r.usd > 0 || r.built > 0 || r.shifts > 0)
    .sort(([, a], [, b]) => b.usd - a.usd || b.sales - a.sales || b.built - a.built || b.shifts - a.shifts)[0];
  if (best) {
    const [id, r] = best, c = byId.get(id)!;
    const why = r.usd > 0 ? `$${r.usd.toFixed(2)} in ${r.sales} sale${r.sales === 1 ? "" : "s"}` : r.built > 0 ? `${r.built} thing${r.built === 1 ? "" : "s"} shipped` : `${r.shifts} shift${r.shifts === 1 ? "" : "s"} run`;
    f.top = { name: c.name, slug: c.slug, why };
  }
  return f;
}

/** Nothing worth a post: no shift, nothing shipped, no sale of either kind, no IMD order. */
export const quietDay = (f: DigestFacts) => !f.shifts && !f.products.length && !f.sites.length && !f.sales.count && !f.b2b.count && !f.imd.count;

/** The message: every number from digestFacts, nothing else. Null on a quiet day. */
export function digestCard(f: DigestFacts, base = config.publicUrl): { text: string; buttons: Button[][] } | null {
  if (quietDay(f)) return null;
  const s = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
  const lines = [
    "🌙 <b>NIGHTSHIFT DAILY · what the companies did</b>",
    "<i>The last 24 hours, read from the ledger and the companies' own records.</i>", "",
    `⚙️ <b>${s(f.shifts, "shift")}</b> run${f.companiesWorking ? ` by ${s(f.companiesWorking, "company", "companies")}` : ""}`,
  ];
  if (f.products.length) {
    lines.push(`📦 <b>${s(f.products.length, "product")}</b> shipped`);
    for (const p of f.products.slice(0, 8)) lines.push(`  • <a href="${esc(p.link)}">${esc(p.name)}</a> · ${esc(p.kind)} · ${esc(p.company)}`);
    if (f.products.length > 8) lines.push(`  …and ${f.products.length - 8} more`);
  }
  if (f.sites.length) lines.push(`🌐 <b>${s(f.sites.length, "site")}</b> launched: ${f.sites.slice(0, 5).map((x) => `<a href="${esc(x.url)}">${esc(x.company)}</a>`).join(", ")}${f.sites.length > 5 ? `, +${f.sites.length - 5}` : ""}`);
  lines.push(`💰 <b>${s(f.sales.count, "sale")}</b> · <b>$${f.sales.usd.toFixed(2)}</b> to people and outside agents`);
  if (f.b2b.count) lines.push(`🤝 ${s(f.b2b.count, "sale")} between NIGHTSHIFT companies · $${f.b2b.usd.toFixed(2)} (counted apart)`);
  lines.push(`🧠 <b>${s(f.imd.count, "IMD order")}</b> paid · <b>${f.imd.imd.toLocaleString("en-US", { maximumFractionDigits: 2 })} IMD</b> to the swarm`);
  if (f.top) lines.push("", `🏆 Company of the day: <a href="${base}/c/${esc(f.top.slug)}"><b>${esc(f.top.name)}</b></a> · ${esc(f.top.why)}`);
  return { text: lines.join("\n"), buttons: [[{ text: "🏢 The companies", url: `${base}/companies` }, { text: "🛒 The market", url: `${base}/market` }]] };
}

type State = { lastDay?: string; lastAt?: number };
export type DigestOptions = {
  companies: () => Iterable<Company>; ledger: () => Promise<LedgerTx[]>;
  now?: () => number; file?: string | null; dryRun?: string | null;
  mode?: () => "live" | "sim"; on?: () => boolean; hour?: () => number;
  token?: () => string; chats?: () => string[];
};

/** Once a minute: at the digest hour, once a UTC day (and never twice within 20 hours), the digest goes out. */
export class Digest {
  private s: State;
  constructor(private o: DigestOptions) {
    let s: State = {};
    try { if (o.file && existsSync(o.file)) s = JSON.parse(readFileSync(o.file, "utf8")); } catch { s = {}; }
    this.s = s;
  }
  private now() { return (this.o.now ?? Date.now)(); }
  private save() { if (this.o.file) writeAtomic(this.o.file, JSON.stringify(this.s)); }
  /** Returns what it did: not yet, skipped (a quiet day), dry-run (sim mode), sent, or failed. */
  async tick(): Promise<"wait" | "off" | "quiet" | "dry-run" | "sent" | "failed"> {
    if (!(this.o.on ?? (() => config.digest))()) return "off";
    const now = this.now(), d = new Date(now), day = d.toISOString().slice(0, 10);
    if (d.getUTCHours() !== (this.o.hour ?? (() => config.digestHour))() || this.s.lastDay === day) return "wait";
    if (this.s.lastAt && now - this.s.lastAt < 20 * 3_600_000) return "wait";
    // the day is taken before anything is sent: a crash or a retry never posts it twice
    this.s.lastDay = day; this.save();
    const card = digestCard(digestFacts(this.o.companies(), await this.o.ledger(), now));
    if (!card) { console.log(`daily digest ${day}: a quiet day, nothing posted`); return "quiet"; }
    if ((this.o.mode ?? (() => config.mode))() !== "live") {
      if (this.o.dryRun) appendFileSync(this.o.dryRun, `--- ${new Date(now).toISOString()} (sim mode: not posted)\n${card.text}\n\n`);
      return "dry-run";
    }
    const token = (this.o.token ?? (() => config.telegramToken))(), to = (this.o.chats ?? chats)();
    if (!token || !to.length) return "failed";
    const sent = await Promise.all(to.map((c) => telegram(token, c, card.text, card.buttons)));
    if (!sent.some(Boolean)) return "failed";
    this.s.lastAt = now; this.save();
    return "sent";
  }
}

/** The live digest, checked every minute (off with DIGEST=0). */
export function startDigest(companies: () => Iterable<Company>, ledger: () => Promise<LedgerTx[]>): Digest {
  const d = new Digest({ companies, ledger, file: join(config.dataDir, "digest.json"), dryRun: join(config.dataDir, "digest-dryrun.log") });
  setInterval(() => void d.tick().catch((e) => console.error("digest", (e as Error).message)), 60_000).unref();
  return d;
}
