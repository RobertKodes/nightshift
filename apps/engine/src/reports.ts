import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";

/**
 * Owners' reports of a CEO chat answer (offensive, harmful, wrong): kept for review, newest last.
 * The CEO chat is generative AI, and the app lets the owner flag any of its lines.
 */
export interface AiReport { id: string; at: number; owner: string; companyId: string; lineId: string; text: string; reason: string }

const MAX = 5000;

export class AiReports {
  readonly #file: string;
  #list: AiReport[] | null = null;
  constructor(dataDir: string) { this.#file = join(dataDir, "ai-reports.json"); }

  #all(): AiReport[] {
    if (this.#list) return this.#list;
    try { this.#list = existsSync(this.#file) ? (JSON.parse(readFileSync(this.#file, "utf8")) as AiReport[]) : []; } catch { this.#list = []; }
    return this.#list;
  }

  /** Records a report once per owner and line; a second report of the same line only updates its reason. */
  add(r: Omit<AiReport, "id" | "at">, now = Date.now()): AiReport {
    const all = this.#all();
    const reason = r.reason.replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 300);
    const old = all.find((x) => x.owner === r.owner && x.companyId === r.companyId && x.lineId === r.lineId);
    if (old) { old.reason = reason || old.reason; old.at = now; this.#save(); return old; }
    const rec: AiReport = { id: randomBytes(6).toString("hex"), at: now, owner: r.owner, companyId: r.companyId, lineId: r.lineId, text: r.text.slice(0, 2000), reason };
    all.push(rec);
    if (all.length > MAX) all.splice(0, all.length - MAX);
    this.#save();
    return rec;
  }

  recent(n = 50): AiReport[] { return this.#all().slice(-n).reverse(); }
  #save(): void { writeAtomic(this.#file, JSON.stringify(this.#all()), { mode: 0o600 }); }
}
