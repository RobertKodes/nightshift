import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeAtomic } from "../atomic.js";
import type { InternalInput, SwarmDesk } from "./swarm.js";
import { swarmBody, type SwarmKind } from "./swarm-kinds.js";

export const ACP_AGENT = "01a17749-ac75-7e8f-962f-2b33d027fb2e";
export const ACP_WALLET = "0xaddf82c34e2c425bb91bb07a71edab8510ec08c5";
export const ACP_OFFERINGS: Record<string, SwarmKind> = {
  "IMD Swarm: Research report": "research", "IMD Swarm: Website": "website", "IMD Swarm: Solidity audit": "audit",
  "IMD Swarm: Contract with tests": "contract", "IMD Swarm: Foundry tests": "tests", "IMD Swarm: Adversarial code review": "review",
  "IMD Swarm: Frontend for a contract": "frontend", "IMD Swarm: Image": "image", "IMD Swarm: Token logo": "logo",
};
export const acpKind = (name: string): SwarmKind | null => Object.hasOwn(ACP_OFFERINGS, name) ? ACP_OFFERINGS[name]! : null;
type Entry = { kind: string; from?: string; contentType?: string; content?: string; packageId?: number; event?: { type: string; client?: string; provider?: string; amount?: number; reason?: string; deliverable?: string } };
export type AcpEvent = { jobId: string; chainId: number; status: string; roles: string[]; legacy?: boolean; entry: Entry };
type Listing = { onChainJobId: string; chainId: number; providerAddress: string; clientAddress: string; evaluatorAddress?: string; description?: string; expiredAt?: string; legacy?: boolean; clientSubscription?: unknown };
type Offering = { id: string; name: string; priceType: string; priceValue: number; isHidden: boolean; requiredFunds: boolean };
type Phase = "seen" | "budgeting" | "budgeted" | "opening" | "running" | "submitting" | "submitted" | "completed" | "rejected" | "refused";
type BridgeJob = { id: string; chainId: number; at: number; phase: Phase; client?: string; evaluator?: string; subscription?: boolean; offering?: string; kind?: SwarmKind; input?: InternalInput;
  requirement?: string; requirementFrom?: string; status?: string; orderId?: string; imdOrderId?: string; delivery?: string; failure?: string; notified?: string[]; refusalSent?: boolean; expiredAt?: string };
export type AcpRunner = { run(args: string[]): Promise<unknown>; listen(file: string, failed: () => void): { stop(): void }; info?(): { found: boolean; version: string | null } };
type Deps = { file: string | null; eventsFile: string; enabled(): boolean; runner: AcpRunner; desk: Pick<SwarmDesk, "internalOrder" | "internalJob" | "internalOutcome">;
  alert(text: string, topic: string): Promise<unknown>; now?: () => number };
const terminal = (j: BridgeJob) => ["completed", "rejected"].includes(j.phase);
const ref = (j: BridgeJob) => `${j.chainId}:${j.id}`;
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const reason = (e: unknown) => {
  const x = e as { message?: string; blockers?: { message: string }[] };
  return [x.message ?? "Swarm Desk checks are unavailable.", ...(x.blockers ?? []).map((b) => b.message)].join(" ").slice(0, 1200);
};

export function acpCliScript(dataDir: string, exists: (file: string) => boolean = existsSync): string {
  const tail = ["node_modules", "@virtuals-protocol", "acp-cli", "dist", "bin", "acp.js"];
  const baked = join("/opt/acp-cli", ...tail);
  return exists(baked) ? baked : join(dataDir, "acp-cli", ...tail);
}

/** Never forward CLI output wholesale; also scrub credentials embedded in otherwise public text. */
export function acpRedact(text: string, source?: unknown): string {
  const secrets = new Set<string>();
  const collect = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    for (const [key, value] of Object.entries(v)) {
      if (/token|secret|password|private.?key|api.?key|authorization/i.test(key) && typeof value === "string" && value) secrets.add(value);
      else collect(value);
    }
  };
  collect(source);
  for (const [key, value] of Object.entries(process.env)) if (/token|secret|password|private.?key|api.?key/i.test(key) && value) secrets.add(value);
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join("[redacted]");
  return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[redacted]")
    .replace(/\bBearer\s+[^\s&<>"']+/gi, "Bearer [redacted]")
    .replace(/((?:access[_-]?token|refresh[_-]?token|token|secret|password|private[_-]?key|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s&,<>"']+/gi, "$1[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/\b(?:0x)?[a-fA-F0-9]{64}\b/g, "[redacted]");
}

/** CLI 1.0.40 runs without a shell; credentials and signer keys stay in the server's CLI store. */
export function acpCli(dataDir: string): AcpRunner {
  const script = acpCliScript(dataDir);
  const env = { ...process.env, ACP_CONFIG_DIR: process.env.ACP_CONFIG_DIR ?? join(dataDir, "acp"),
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? join(dataDir, "acp-xdg"),
    KEYRING_PROPERTY_FILE_PATH: process.env.KEYRING_PROPERTY_FILE_PATH ?? join(dataDir, "acp", "keyring.json") };
  const info = () => {
    const found = existsSync(script);
    try {
      const pkg = JSON.parse(readFileSync(join(dirname(script), "..", "..", "package.json"), "utf8")) as { version: unknown };
      return { found, version: typeof pkg.version === "string" && /^\d+\.\d+\.\d+$/.test(pkg.version) ? pkg.version : null };
    } catch { return { found, version: null }; }
  };
  const check = () => {
    const cli = info();
    if (!cli.found || cli.version !== "1.0.40") throw new Error("ACP bridge requires installed CLI 1.0.40.");
  };
  return {
    info,
    run: (args) => {
      check();
      return new Promise((resolve, reject) => {
        execFile(process.execPath, [script, ...args, ...(args.includes("--json") ? [] : ["--json"])], { env, timeout: 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
          let result: unknown;
          try { result = JSON.parse(stdout); } catch { /* Never expose CLI stacks or credentials. */ }
          if (error || !result || obj(result).error || obj(result).success === false || (["provider", "message"].includes(args[0]!) && obj(result).success !== true)) reject(new Error("ACP command failed; check server authentication, signer and CLI configuration."));
          else resolve(result);
        });
      });
    },
    listen: (file, failed) => {
      check();
      mkdirSync(dirname(file), { recursive: true });
      const child = spawn(process.execPath, [script, "events", "listen", "--output", file, "--json"], { env, windowsHide: true, stdio: "ignore" });
      let stopped = false;
      const cleanup = () => { child.kill("SIGTERM"); };
      process.once("exit", cleanup);
      const ended = () => { process.off("exit", cleanup); if (!stopped) { stopped = true; failed(); } };
      child.once("error", ended); child.once("exit", ended);
      return { stop: () => { stopped = true; process.off("exit", cleanup); cleanup(); } };
    },
  };
}

/** Persisted ACP phases share Swarm Desk's checked reservations and IMD follower. */
export class AcpBridge {
  readonly #jobs = new Map<string, BridgeJob>();
  readonly #now: () => number;
  #turn?: Promise<void>;
  #timer?: ReturnType<typeof setInterval>;
  #listener?: { stop(): void };
  #probeAt = 0;
  #auth: boolean | null = null;
  #signer: boolean | null = null;
  #offerings: Offering[] = [];

  constructor(private readonly d: Deps) {
    this.#now = d.now ?? Date.now;
    if (d.file && existsSync(d.file)) {
      const data = JSON.parse(readFileSync(d.file, "utf8")) as { v: number; jobs: BridgeJob[] };
      if (data.v !== 1 || !Array.isArray(data.jobs) || data.jobs.some((j) => typeof j.id !== "string" || !j.id || !Number.isSafeInteger(j.chainId) || j.chainId < 1 || !Number.isFinite(j.at) || !["seen", "budgeting", "budgeted", "opening", "running", "submitting", "submitted", "completed", "rejected", "refused"].includes(j.phase)) || new Set(data.jobs.map(ref)).size !== data.jobs.length) throw new Error("ACP bridge state is unreadable; restore it before accepting jobs.");
      for (const j of data.jobs) this.#jobs.set(ref(j), j);
    } else if (d.file && existsSync(`${d.file}.bak`)) throw new Error("ACP bridge state is missing; restore its backup.");
  }

  #save(): void {
    if (!this.d.file) return;
    mkdirSync(dirname(this.d.file), { recursive: true });
    writeAtomic(this.d.file, JSON.stringify({ v: 1, jobs: [...this.#jobs.values()] }), { mode: 0o600, backup: true });
  }

  #job(id: string, chainId: number): BridgeJob {
    const key = `${chainId}:${id}`;
    let j = this.#jobs.get(key);
    if (!j) { j = { id, chainId, at: this.#now(), phase: "seen" }; this.#jobs.set(key, j); }
    return j;
  }

  #args(j: BridgeJob): string[] { return ["--job-id", j.id, "--chain-id", String(j.chainId)]; }

  async #notify(j: BridgeJob, event: string, message: string): Promise<void> {
    if (j.notified?.includes(event)) return;
    try {
      if (await this.d.alert(acpRedact(`ACP job ${ref(j)} ${event}: ${message}`), `acp-${event}-${ref(j)}`) === false) return;
      (j.notified ??= []).push(event); this.#save();
    } catch { /* Retry owner DMs on the next tick. */ }
  }

  async probe(): Promise<void> {
    if (!this.d.enabled()) return;
    this.#auth = false; this.#signer = false;
    const who = obj(await this.d.runner.run(["agent", "whoami"]));
    if (who.id !== ACP_AGENT || String(who.walletAddress).toLowerCase() !== ACP_WALLET) throw new Error("ACP active agent is not NIGHTSHIFT Swarm Desk.");
    this.#auth = true;
    // job list authenticates using the local signer, unlike whoami and signer-policy.
    await this.d.runner.run(["job", "list"]);
    this.#signer = true;
    const offerings = await this.d.runner.run(["offering", "list"]);
    if (!Array.isArray(offerings)) throw new Error("ACP offering list was not an array.");
    this.#offerings = offerings as Offering[];
    this.#probeAt = this.#now();
  }

  #entry(j: BridgeJob, entry: Entry): void {
    if (terminal(j)) return;
    if (entry.kind === "message" && entry.contentType === "requirement" && j.requirement === undefined) {
      j.requirement = entry.content ?? ""; j.requirementFrom = entry.from;
      if (entry.packageId) j.subscription = true;
    }
    const type = entry.event?.type;
    if (type === "job.created") { j.client ??= entry.event?.client; }
    if (type === "budget.set") j.status = "budget_set";
    if (type === "job.funded") {
      j.status = "funded";
      if (Number(entry.event?.amount) !== 4) j.failure = "ACP funding does not match the $4.00 offering. Reject this submission to recover escrow.";
    }
    if (type === "job.submitted") j.status = "submitted";
    if (type === "job.completed") j.status = "completed";
    if (type === "job.rejected" || type === "job.expired") { j.status = "rejected"; j.failure ??= entry.event?.reason ?? "ACP job expired or was rejected."; }
  }

  async #refuse(j: BridgeJob, message: string): Promise<void> {
    j.failure = message; j.phase = "refused"; this.#save();
    await this.d.desk.internalOutcome(ref(j), "rejected", message);
  }

  async #advance(j: BridgeJob): Promise<void> {
    if (!this.d.enabled()) return;
    if (j.status === "completed" || j.status === "rejected") {
      j.phase = j.status; this.#save();
      await this.d.desk.internalOutcome(ref(j), j.phase, j.failure);
      if (j.delivery && !j.failure) await this.#notify(j, "delivered", j.delivery);
      await this.#notify(j, j.phase === "rejected" ? "rejected" : "completed", j.failure ?? "Escrow released after client acceptance.");
      return;
    }
    if (j.phase === "seen" && j.status !== "funded" && j.status !== "submitted") {
      if (!j.offering || j.requirement === undefined || !j.client) {
        if (this.#now() - j.at < 120_000) return;
        await this.#refuse(j, "Offering context or the client's first requirement did not arrive. Create a new offering-based job with its requirements.");
      }
    }
    if (j.phase === "seen" && j.status !== "funded" && j.status !== "submitted") {
      try {
        const kind = acpKind(j.offering!);
        if (!kind) throw new Error("Unknown Swarm Desk offering.");
        const offerings = this.#offerings.filter((o) => o.name === j.offering);
        if (offerings.length !== 1 || offerings[0]!.priceType !== "fixed" || Number(offerings[0]!.priceValue) !== 4 || offerings[0]!.requiredFunds) throw new Error("Offering must be fixed at $4.00 without a fund transfer.");
        if (j.subscription) throw new Error("Subscription jobs are not supported; create a standalone $4.00 offering job.");
        if (j.evaluator?.toLowerCase() !== j.client!.toLowerCase()) throw new Error("The client must be the evaluator so a failed delivery can be rejected and escrow returned.");
        if (j.requirementFrom?.toLowerCase() !== j.client!.toLowerCase()) throw new Error("The first requirement must come from the ACP client.");
        const input = JSON.parse(j.requirement!) as unknown;
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.entries(input).some(([k, v]) => !["brief", "repo", "commit", "chain", "address", "name", "style"].includes(k) || typeof v !== "string")) throw new Error("Requirements must be an object containing Swarm Desk string fields.");
        swarmBody(kind, obj(input).brief as string ?? null, obj(input).repo as string ?? null, ref(j), input as InternalInput);
        j.kind = kind; j.input = input as InternalInput;
        const order = await this.d.desk.internalOrder({ kind, input: j.input, payer: j.client!, source: "acp", ref: ref(j) });
        j.orderId = order.orderId; j.phase = "budgeting"; this.#save();
      } catch (e) { await this.#refuse(j, reason(e)); }
    }
    if (j.phase === "refused" && j.status !== "funded") {
      await this.d.desk.internalOutcome(ref(j), "rejected", j.failure);
      if (!j.refusalSent) {
        await this.d.runner.run(["message", "send", ...this.#args(j), "--content", `NIGHTSHIFT cannot accept this job: ${j.failure} No budget was set; no payment is requested.`, "--content-type", "text"]);
        j.refusalSent = true; this.#save();
      }
      await this.#notify(j, "rejected", j.failure!);
      return;
    }
    if (j.phase === "budgeting") {
      if (j.status !== "budget_set" && j.status !== "funded" && j.status !== "submitted") {
        if (!this.d.enabled()) return;
        try { await this.d.desk.internalOrder({ kind: j.kind!, input: j.input!, payer: j.client!, source: "acp", ref: ref(j) }); }
        catch (e) { await this.#refuse(j, reason(e)); return; }
        await this.d.runner.run(["provider", "set-budget", ...this.#args(j), "--amount", "4.00"]);
      }
      j.phase = "budgeted"; this.#save();
    }
    if (["budgeted", "opening", "running", "submitting", "submitted"].includes(j.phase)) await this.#notify(j, "accepted", `${j.offering}, $4.00; awaiting or processing ACP escrow.`);
    if (j.status === "funded" && !["running", "submitting", "submitted"].includes(j.phase)) {
      if (!this.d.enabled()) return;
      const checked = Boolean(j.orderId && j.kind && j.input && j.client && j.phase !== "refused");
      j.phase = "opening"; this.#save();
      try {
        if (!checked || j.failure) throw new Error(j.failure ?? "No checked ACP reservation exists. Reject this submission to recover escrow.");
        const order = await this.d.desk.internalOrder({ kind: j.kind!, input: j.input!, payer: j.client!, source: "acp", ref: ref(j), funded: true });
        j.orderId = order.orderId; j.imdOrderId = order.imdOrderId ?? undefined; j.phase = "running"; this.#save();
      } catch (e) { j.failure = reason(e); j.phase = "submitting"; this.#save(); }
    }
    if (j.phase === "running") {
      const order = await this.d.desk.internalJob(ref(j));
      if (!order) { j.failure = "Saved IMD reservation is missing; no second IMD job will be opened."; j.phase = "submitting"; }
      else {
        j.imdOrderId = order.imdOrderId ?? undefined;
        if (order.status === "failed" || order.refundOwed) { j.failure = order.error ?? "IMD failed or blocked the job."; j.phase = "submitting"; }
        else if (order.status === "done" && order.result) {
          const result = order.result;
          j.delivery = [`NIGHTSHIFT Swarm Desk: ${j.offering}`, `IMD job: ${result.jobId}`, `IMD order: ${order.imdOrderId}`,
            `Receipt: ${order.imd?.txHash ? `https://etherscan.io/tx/${order.imd.txHash}` : "IMD admission " + order.imd?.state}`,
            ...(result.siteUrl ? [`Site (IPFS): ${result.siteUrl}`] : []), ...(result.repoUrl ? [`Source: ${result.repoUrl}`] : []),
            ...Object.entries(result.files).map(([name, url]) => `${name}: ${url}`)].join("\n");
          j.phase = "submitting";
        }
      }
      this.#save();
    }
    if (j.phase === "submitting") {
      if (j.failure) {
        j.delivery = `FAILURE: NIGHTSHIFT did not deliver this work. ${j.failure}\nIMD order: ${j.imdOrderId ?? "not opened"}. Reject this submission to return the ACP escrow to you. No payment is earned for undelivered work.`;
        this.#save();
        await this.#notify(j, "failure", j.delivery);
      }
      if (j.status !== "submitted") await this.d.runner.run(["provider", "submit", ...this.#args(j), "--deliverable", j.delivery!]);
      j.phase = "submitted"; this.#save();
    }
    if (j.phase === "submitted") await this.#notify(j, j.failure ? "failure" : "delivered", j.delivery!);
  }

  /** Reconcile history after every drain, including commands whose answers were lost. */
  tick(): Promise<void> {
    if (this.#turn) return this.#turn;
    this.#turn = this.#tick().finally(() => { this.#turn = undefined; });
    return this.#turn;
  }

  async #tick(): Promise<void> {
    if (!this.d.enabled()) { this.#listener?.stop(); this.#listener = undefined; return; }
    if (!this.#auth || !this.#signer || this.#now() - this.#probeAt >= 60_000) await this.probe();
    if (!this.#listener) this.#listener = this.d.runner.listen(this.d.eventsFile, () => { this.#listener = undefined; this.#signer = false; });
    const listing = obj(await this.d.runner.run(["job", "list"]));
    for (const row of (listing.jobs ?? []) as Listing[]) {
      if (row.legacy || row.providerAddress?.toLowerCase() !== ACP_WALLET || !Number.isSafeInteger(row.chainId) || !row.onChainJobId) continue;
      const j = this.#job(String(row.onChainJobId), row.chainId);
      j.client ??= row.clientAddress; j.evaluator ??= row.evaluatorAddress; j.offering ??= row.description; j.expiredAt ??= row.expiredAt;
      if (row.clientSubscription) j.subscription = true;
    }
    const drain = obj(await this.d.runner.run(["events", "drain", "--file", this.d.eventsFile]));
    for (const event of (drain.events ?? []) as AcpEvent[]) {
      if (event.legacy || !event.roles?.includes("provider") || !Number.isSafeInteger(event.chainId) || !event.jobId || !event.entry) continue;
      if (event.entry.event?.provider && event.entry.event.provider.toLowerCase() !== ACP_WALLET) continue;
      const j = this.#job(event.jobId, event.chainId);
      this.#entry(j, event.entry);
    }
    this.#save();
    for (const j of this.#jobs.values()) {
      try {
        if (!terminal(j)) {
          const history = obj(await this.d.runner.run(["job", "history", ...this.#args(j)]));
          if (j.phase === "seen") { j.requirement = undefined; j.requirementFrom = undefined; }
          // Replay in order so funded/submitted cannot regress to an older event.
          for (const entry of (history.entries ?? []) as Entry[]) this.#entry(j, entry);
          if (typeof history.status === "string") j.status = history.status === "expired" ? "rejected" : history.status;
          this.#save();
        }
        await this.#advance(j);
      } catch { /* Keep the saved phase and retry this job without blocking the others. */ }
    }
  }

  status() {
    const rows = [...this.#jobs.values()], today = new Date(this.#now()).toISOString().slice(0, 10);
    return { enabled: this.d.enabled(), auth: this.#auth, signer: this.#signer, offerings: this.#offerings.map((o) => ({ name: o.name, hidden: o.isHidden })),
      jobsToday: rows.filter((j) => new Date(j.at).toISOString().slice(0, 10) === today).length,
      running: rows.filter((j) => ["opening", "running", "submitting"].includes(j.phase)).length,
      delivered: rows.filter((j) => ["submitted", "completed"].includes(j.phase) && !j.failure).length,
      rejected: rows.filter((j) => ["rejected", "refused"].includes(j.phase)).length };
  }

  start(): void {
    if (this.#timer) return;
    const tick = () => void this.tick().catch(() => {});
    tick(); this.#timer = setInterval(tick, 5_000); this.#timer.unref();
  }
  stop(): void { clearInterval(this.#timer); this.#timer = undefined; this.#listener?.stop(); this.#listener = undefined; }
}

let current: AcpBridge | null = null;
export const liveAcpBridge = () => current;
export const setAcpBridge = (bridge: AcpBridge | null) => { current?.stop(); current = bridge; };
