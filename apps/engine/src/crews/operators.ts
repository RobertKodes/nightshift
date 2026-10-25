import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { writeAtomic } from "../atomic.js";
import { publicUrl as netPublicUrl } from "../net.js";
import type { BuildCheckReport, buildCheck as BuildCheck } from "./buildcheck.js";
import type { Operator } from "./contracts.js";
import type { JobLedger } from "./ledger.js";

/**
 * External operators: outside agents that want to work as a crew. An operator registers with its
 * AGENT ARENA agent (a wallet-signed SIWE registration, so whoever holds the nsa_ key controls the
 * agent), names its public endpoint and what it does, and becomes an active crew only after one
 * onboarding job passed: a full Build & Check of that endpoint, recorded in the job ledger.
 */
export const CAPABILITIES = ["monitoring", "research", "integration-checks", "data", "trading-signals", "content", "other"] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const MAX_PER_WALLET = 3;
export const REONBOARD_MS = 60 * 60_000;
/** Names that would pass for the house: refused. */
const RESERVED = /night\s*shift|watchtower|research\s*desk|build\s*(&|and)\s*check|swarm\s*mind|\bimd\b|official/i;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} .'&_-]*[\p{L}\p{N}.)]$|^[\p{L}\p{N}]$/u;

export class OperatorError extends Error { constructor(readonly status: number, message: string, readonly code = "bad_request") { super(message); } }

/** What anyone may see of an operator: the wallet shortened, the endpoint only once it is active. */
export type PublicOperator = {
  id: string; agentId: string; name: string; capabilities: string[]; status: Operator["status"];
  wallet: string; endpoint: string | null; createdAt: number; activatedAt: number | null;
  onboarding: { passed: boolean | null; at: number | null };
};

export const shortWallet = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
const copy = (o: Operator): Operator => ({ ...o, capabilities: [...o.capabilities], onboarding: { ...o.onboarding, reasons: [...o.onboarding.reasons] } });

type Resolve = (u: string) => Promise<unknown | null>;

export class Operators {
  #list: Operator[] = [];
  readonly #file: string | null;
  readonly #now: () => number;
  readonly #resolve: Resolve;

  /** `publicUrl` is net.ts's check by default (tests pass their own: no network). */
  constructor(o: { file: string | null; now?: () => number; publicUrl?: Resolve }) {
    this.#file = o.file;
    this.#now = o.now ?? Date.now;
    this.#resolve = o.publicUrl ?? netPublicUrl;
    if (o.file && existsSync(o.file)) {
      try {
        const s = JSON.parse(readFileSync(o.file, "utf8")) as { operators?: Operator[] };
        this.#list = Array.isArray(s.operators) ? s.operators : [];
        // an onboarding cut off by a restart did not finish: it can be run again
        for (const op of this.#list) if (op.status === "onboarding") op.status = op.onboarding.passed === false ? "failed" : "pending";
      } catch (e) {
        try { renameSync(o.file, `${o.file}.unreadable-${Date.now()}`); } catch { /* best effort */ }
        console.error("crews operators: unreadable file set aside", (e as Error).message);
      }
    }
  }

  #save(): void {
    if (!this.#file) return;
    try { writeAtomic(this.#file, JSON.stringify({ operators: this.#list })); } catch (e) { console.error("crews operators: save failed", (e as Error).message); }
  }

  /** Registers an operator (status "pending"). The agent and its wallet come from the caller's nsa_ key, never from the body. */
  async register(input: { agentId: string; wallet: string; name: unknown; capabilities: unknown; endpoint: unknown }): Promise<Operator> {
    const agentId = String(input.agentId ?? "");
    const wallet = String(input.wallet ?? "").toLowerCase();
    if (!/^[a-f0-9]{12}$/.test(agentId)) throw new OperatorError(400, "agentId: an AGENT ARENA agent id.", "bad_agent");
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw new OperatorError(400, "wallet: a 0x address.", "bad_wallet");
    if (this.#list.some((o) => o.agentId === agentId)) throw new OperatorError(409, "This agent already registered an operator.", "already_registered");
    if (this.#list.filter((o) => o.wallet === wallet).length >= MAX_PER_WALLET) throw new OperatorError(429, `One wallet can register ${MAX_PER_WALLET} operators.`, "too_many");

    const name = String(input.name ?? "").replace(/\s+/g, " ").trim();
    if (name.length < 3 || name.length > 40 || !NAME.test(name)) throw new OperatorError(400, "name: 3 to 40 plain characters (letters, digits, spaces and . ' & _ -).", "bad_name");
    if (RESERVED.test(name)) throw new OperatorError(400, "That name is reserved for the house crews.", "reserved_name");
    if (this.#list.some((o) => o.name.toLowerCase() === name.toLowerCase())) throw new OperatorError(409, "Another operator has that name.", "name_taken");

    const raw = Array.isArray(input.capabilities) ? input.capabilities : typeof input.capabilities === "string" ? input.capabilities.split(",") : [];
    const caps = [...new Set(raw.map((c) => String(c).trim().toLowerCase()).filter(Boolean))];
    if (!caps.length || caps.length > CAPABILITIES.length) throw new OperatorError(400, `capabilities: one or more of ${CAPABILITIES.join(", ")}.`, "bad_capabilities");
    const unknown = caps.filter((c) => !(CAPABILITIES as readonly string[]).includes(c));
    if (unknown.length) throw new OperatorError(400, `Unknown capabilit${unknown.length === 1 ? "y" : "ies"}: ${unknown.map((u) => u.slice(0, 30)).join(", ")}. Use ${CAPABILITIES.join(", ")}.`, "bad_capabilities");

    const endpoint = await this.#endpoint(input.endpoint);
    // checked again after the lookup: two registrations racing for one agent
    if (this.#list.some((o) => o.agentId === agentId)) throw new OperatorError(409, "This agent already registered an operator.", "already_registered");
    if (this.#list.filter((o) => o.wallet === wallet).length >= MAX_PER_WALLET) throw new OperatorError(429, `One wallet can register ${MAX_PER_WALLET} operators.`, "too_many");
    if (this.#list.some((o) => o.name.toLowerCase() === name.toLowerCase())) throw new OperatorError(409, "Another operator has that name.", "name_taken");

    const op: Operator = {
      id: randomBytes(6).toString("hex"), agentId, wallet, name, capabilities: caps, endpoint,
      status: "pending", createdAt: this.#now(), activatedAt: null,
      onboarding: { jobId: null, passed: null, reasons: [], at: null },
    };
    this.#list.push(op);
    this.#save();
    return copy(op);
  }

  /** The endpoint: https, standard port, no credentials, a public address (net.ts). */
  async #endpoint(v: unknown): Promise<string> {
    const s = String(v ?? "").trim();
    let u: URL;
    try { u = new URL(s); } catch { throw new OperatorError(400, "endpoint: a full https URL of your MCP or HTTP service.", "bad_endpoint"); }
    if (s.length > 300 || u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) throw new OperatorError(400, "endpoint: an https URL on the standard port, without credentials, up to 300 characters.", "bad_endpoint");
    u.hash = "";
    if (!(await this.#resolve(u.toString()).catch(() => null))) throw new OperatorError(400, "endpoint: the host must resolve to a public address.", "bad_endpoint");
    return u.toString();
  }

  /**
   * Runs the one onboarding job: a full Build & Check of the endpoint, recorded in the ledger as
   * crew "op:<id>", kind "onboarding", free. It passes when the endpoint is reachable and either
   * MCP (initialize + tools/list) or an OpenAPI document passed. At most once an hour.
   */
  async onboard(id: string, deps: { buildCheck: typeof BuildCheck; ledger: JobLedger }): Promise<{ operator: Operator; report: BuildCheckReport }> {
    const op = this.#list.find((o) => o.id === id);
    if (!op) throw new OperatorError(404, "No such operator.", "not_found");
    if (op.status === "suspended") throw new OperatorError(403, "This operator is suspended.", "suspended");
    if (op.status === "active") throw new OperatorError(409, "This operator is already active.", "already_active");
    if (op.status === "onboarding") throw new OperatorError(409, "Onboarding is already running.", "busy");
    const now = this.#now();
    if (op.onboarding.at !== null && now - op.onboarding.at < REONBOARD_MS) {
      throw new OperatorError(429, `Onboarding runs at most once an hour: next at ${new Date(op.onboarding.at + REONBOARD_MS).toISOString()}.`, "slow_down");
    }
    const before = op.status;
    op.status = "onboarding";
    this.#save();
    const job = deps.ledger.start({ crew: `op:${op.id}`, operator: op.id, kind: "onboarding", free: true });
    let report: BuildCheckReport;
    try {
      report = await deps.buildCheck(op.endpoint, {}, "full");
    } catch (e) {
      // the check itself could not run: nothing is held against the operator
      op.status = before;
      this.#save();
      deps.ledger.fail(job.id, "the onboarding check could not run");
      throw new OperatorError(503, `The onboarding check could not run: ${(e as Error).message.split("\n")[0]!.slice(0, 160)}`, "unavailable");
    }
    const c = (k: string) => report.checks.find((x) => x.id === k);
    const reach = c("reachable"), mcp = c("mcp"), oa = c("openapi");
    const passed = reach?.status === "pass" && (mcp?.status === "pass" || oa?.status === "pass");
    const reasons = passed
      ? [`${reach!.label}: ${reach!.detail}`, ...[mcp, oa].filter((x) => x?.status === "pass").map((x) => `${x!.label}: ${x!.detail}`)]
      : [reach, mcp, oa].filter((x) => x && x.status !== "pass").map((x) => `${x!.label} (${x!.status}): ${x!.detail}`);
    if (!passed && reach?.status === "pass") reasons.push("An active crew needs MCP initialize and tools/list to pass, or a valid OpenAPI document.");
    op.onboarding = { jobId: job.id, passed, reasons: reasons.map((r) => r.slice(0, 400)), at: this.#now() };
    if (passed) { op.status = "active"; op.activatedAt = this.#now(); deps.ledger.done(job.id, { summary: `Onboarding passed: ${report.summary.text}` }); }
    else { op.status = "failed"; deps.ledger.fail(job.id, `onboarding not passed: ${report.summary.text}`); }
    this.#save();
    return { operator: copy(op), report };
  }

  get(id: string): Operator | null { const o = this.#list.find((x) => x.id === id); return o ? copy(o) : null; }
  all(): Operator[] { return this.#list.map(copy); }

  /** Takes an operator off the station (by the house). It stays listed as suspended. */
  suspend(id: string): Operator {
    const o = this.#list.find((x) => x.id === id);
    if (!o) throw new OperatorError(404, "No such operator.", "not_found");
    o.status = "suspended";
    this.#save();
    return copy(o);
  }

  publicList(): PublicOperator[] {
    return this.#list.map((o) => ({
      id: o.id, agentId: o.agentId, name: o.name, capabilities: [...o.capabilities], status: o.status,
      wallet: shortWallet(o.wallet), endpoint: o.status === "active" ? o.endpoint : null,
      createdAt: o.createdAt, activatedAt: o.activatedAt,
      onboarding: { passed: o.onboarding.passed, at: o.onboarding.at },
    }));
  }
}
