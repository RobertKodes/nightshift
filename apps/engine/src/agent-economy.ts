import { existsSync, readFileSync } from "node:fs";
import { writeAtomic } from "./atomic.js";
import { customerPayments, paymentSummary, type ProofPayment } from "./proof.js";
import { ownerText } from "./owner-stats.js";
import type { Button } from "./social.js";

type Post = { key: string; text: string; kind: "sale" | "milestone" | "buy" | "recap" };
type State = { enabled: boolean; seen: string[]; wallets: string[]; milestones: string[]; queue: Post[]; overflow: ProofPayment[]; sentAt: number[]; recap: string | null; rotation: number };
const HOUR = 3_600_000;
const amount = (v: number) => v.toFixed(6).replace(/(\.\d{2,}?)0+$/, "$1");
export function bucharest(now: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now).map((p) => [p.type, p.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
}
const totalsLine = (pays: ProofPayment[]) => {
  const t = paymentSummary(pays);
  return `So far: <b>${t.payments} paid calls</b> · ${t.wallets} paying wallets · ${t.repeatWallets} returning wallets · <b>$${amount(t.revenueUsd)}</b> revenue.`;
};
const HOLDERS = [
  "500k $SHIFT, a NIGHT FROG or a Night Watcher pays half on eligible house services.",
  "Holder perk: 500k $SHIFT, a NIGHT FROG or a Night Watcher pays half on eligible house services.",
  "Bring a holder wallet: 500k $SHIFT, a NIGHT FROG or a Night Watcher pays half on eligible house services.",
];

/** Honest customer sales, paced through one durable public queue. */
export class AgentEconomy {
  #st: State;
  #running: Promise<void> | null = null;
  constructor(private readonly o: { file: string | null; payments(): ProofPayment[]; post(text: string, buttons: Button[][], kind: "sale" | "milestone"): Promise<boolean>; url: string; now?: () => number }) {
    const history = customerPayments(o.payments());
    this.#st = { enabled: true, seen: history.map((p) => p.key), wallets: [...new Set(history.map((p) => p.payer))], milestones: [], queue: [], overflow: [], sentAt: [], recap: null, rotation: 0 };
    if (o.file && existsSync(o.file)) this.#st = { ...this.#st, ...JSON.parse(readFileSync(o.file, "utf8")) };
    this.#save();
  }
  #now() { return (this.o.now ?? Date.now)(); }
  #save() { if (this.o.file) writeAtomic(this.o.file, JSON.stringify(this.#st), { mode: 0o600 }); }
  get enabled() { return this.#st.enabled; }
  command(args: string[]): string {
    const v = args[0];
    if (args.length === 1 && (v === "on" || v === "off")) {
      this.#st.enabled = v === "on";
      if (v === "off") { this.#st.overflow = []; this.#st.queue = this.#st.queue.filter((p) => p.kind === "buy"); }
      this.#save();
    }
    return `📣 Public announcements: <b>${this.enabled ? "on" : "off"}</b>. Use /announce on | off.`;
  }
  #milestones(pays: ProofPayment[]): void {
    const t = paymentSummary(pays), fresh: string[] = [];
    const revenue = pays.reduce((n, p) => n + BigInt(p.units), 0n);
    const mark = (key: string, reached: boolean, text: string) => {
      if (!reached || this.#st.milestones.includes(key)) return;
      this.#st.milestones.push(key); fresh.push(text);
    };
    mark("returning", t.repeatWallets > 0, "Our first returning wallet paid again!");
    for (const n of [10, 25, 50, 100, 250, 500, 1000]) mark(`calls-${n}`, t.payments >= n, `${n.toLocaleString("en-US")} real paid calls!`);
    for (const n of [5, 10, 25, 50, 100]) mark(`wallets-${n}`, t.wallets >= n, `${n} paying wallets!`);
    for (const n of [1, 5, 10, 25, 50, 100]) mark(`revenue-${n}`, revenue >= BigInt(n) * 1_000_000n, `$${n} in settled customer revenue!`);
    for (const [id, label] of [["watchtower-watch", "Watchtower watch"], ["swarm-order", "Swarm Desk job"], ["research-report", "Research Desk report"], ["buildcheck-report", "Build & Check report"]]) {
      mark(`first-${id}`, pays.some((p) => p.service === id), `The first paid ${label}!`);
    }
    if (fresh.length && this.enabled) this.#st.queue.push({ key: `milestone-${this.#st.milestones.length}`, kind: "milestone", text: `🎉🌙 <b>The NIGHTSHIFT agent economy is growing</b>\n\n${fresh.map(ownerText).join("\n")}\n\n${totalsLine(pays)}\nReal wallets. Settled payments. The proof is public.` });
  }
  notePayment(p: ProofPayment): void {
    if (!customerPayments([p]).length || this.#st.seen.includes(p.key)) return;
    const pays = customerPayments(this.o.payments());
    if (!pays.some((x) => x.key === p.key)) return;
    const repeat = this.#st.wallets.includes(p.payer);
    this.#st.seen.push(p.key);
    if (!repeat) this.#st.wallets.push(p.payer);
    if (this.enabled) {
      const title = repeat ? "🔁 <b>A returning customer paid again</b>" : "💸 <b>An agent just paid NIGHTSHIFT</b>";
      const holder = HOLDERS[this.#st.rotation++ % HOLDERS.length]!;
      const text = `${title}\n\n${ownerText(p.product)} · <b>$${amount(p.usd)}</b>\n${ownerText(p.payer)} · <a href="https://basescan.org/tx/${p.tx}">settled over x402 on Base</a>\n\n${totalsLine(pays)}\n\n${holder}`;
      this.#st.sentAt = this.#st.sentAt.filter((t) => this.#now() - t < HOUR);
      if (this.#st.sentAt.length + this.#st.queue.length < 6 && !this.#st.overflow.length) this.#st.queue.push({ key: p.key, text, kind: "sale" });
      else this.#st.overflow.push(p);
    }
    this.#milestones(pays); this.#save(); void this.tick();
  }
  /** Buy posts share the cap and stay queued even while announcements are off. */
  noteBuy(key: string, text: string): void {
    if (this.#st.seen.includes(`buy:${key}`)) return;
    this.#st.seen.push(`buy:${key}`); this.#st.queue.push({ key: `buy:${key}`, text, kind: "buy" });
    this.#save(); void this.tick();
  }
  tick(): Promise<void> {
    if (this.#running) return this.#running;
    this.#running = this.#tick().finally(() => { this.#running = null; });
    return this.#running;
  }
  async #tick(): Promise<void> {
    if (!this.enabled) return;
    const now = this.#now(), local = bucharest(now), pays = customerPayments(this.o.payments());
    this.#st.sentAt = this.#st.sentAt.filter((t) => now - t < HOUR);
    if (local.hour === 20 && local.minute < 10 && this.#st.recap !== local.day) {
      const today = pays.filter((p) => bucharest(p.at).day === local.day);
      if (today.length) {
        const date = new Date(`${local.day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
        const monday = date.toISOString().slice(0, 10), week = pays.filter((p) => bucharest(p.at).day >= monday && p.at <= now);
        const by = new Map<string, number>(); for (const p of today) by.set(p.product, (by.get(p.product) ?? 0) + 1);
        const top = [...by].sort((a, b) => b[1] - a[1])[0]!;
        const d = paymentSummary(today), w = paymentSummary(week);
        this.#st.recap = local.day;
        this.#st.queue.push({ key: `recap-${local.day}`, kind: "recap", text: `🌙 <b>Agent economy · ${local.day}</b>\n\n${d.payments} paid calls · ${d.wallets} paying wallets · $${amount(d.revenueUsd)} settled.\nTop service: ${ownerText(top[0])} (${top[1]} calls).\nThis week so far: ${w.payments} paid calls · ${w.wallets} wallets · $${amount(w.revenueUsd)}.\n\nEvery number comes from the same books as /proof.` });
      }
    }
    this.#save();
    while (this.enabled && this.#st.sentAt.length < 6 && (this.#st.queue.length || this.#st.overflow.length)) {
      let p = this.#st.queue[0], bundled = 0;
      if (!p && this.#st.overflow.length) {
        bundled = this.#st.overflow.length;
        const oldest = this.#st.overflow[0]!.at, span = oldest >= now - HOUR ? "in the last hour" : `since ${new Date(oldest).toISOString().slice(0, 16).replace("T", " ")} UTC`;
        p = { key: `bundle-${now}`, kind: "sale", text: `💸 <b>${bundled} more paid calls</b> ${span}.\n$${amount(this.#st.overflow.reduce((n, p) => n + p.usd, 0))} settled over x402 on Base.\n\n${totalsLine(pays)}` };
      }
      const buttons: Button[][] = [[{ text: "🤖 Start an agent", url: `${this.o.url}/agents/start` }, { text: "📊 The proof", url: `${this.o.url}/proof` }]];
      if (!(await this.o.post(p!.text, buttons, p!.kind === "sale" ? "sale" : "milestone").catch(() => false))) break;
      if (bundled) this.#st.overflow.splice(0, bundled); else this.#st.queue.shift();
      this.#st.sentAt.push(now); this.#save();
    }
  }
}

let current: AgentEconomy | null = null;
export const liveAgentEconomy = () => current;
export const setAgentEconomy = (v: AgentEconomy | null) => { current = v; };
