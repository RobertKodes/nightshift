import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { JobRoomEntry } from "@virtuals-protocol/acp-node-v2";
import { AssetToken } from "@virtuals-protocol/acp-node-v2";
import { HOUSE_TOOLS, NightshiftClient, type HouseTool, type Signer, type SignedRequest, type SwarmInput, type SwarmQuote } from "./client.ts";
import type { AcpConfig } from "./config.ts";
import type { SessionLike } from "./handler.ts";

type RecordRow = { input: Record<string, unknown>; budget: number; quote?: SwarmQuote; request?: SignedRequest; order?: Record<string, unknown>; delivered?: boolean };

/** Persist the exact authorization before a funded ACP job can call NIGHTSHIFT. */
export function makePaidEntryHandler(cfg: AcpConfig, options: { fetch?: typeof fetch; sign: Signer; file?: string | null; intervalMs?: number } ) {
  const client = new NightshiftClient({ baseUrl: cfg.nightshiftBase, fetch: options.fetch }), file = options.file === undefined ? cfg.stateFile : options.file;
  const rows: Record<string, RecordRow> = Object.create(null), running = new Map<string, Promise<void>>();
  if (file && !existsSync(file) && existsSync(`${file}.bak`)) throw new Error("ACP payment ledger missing; restore its backup.");
  if (file && existsSync(file)) { const saved = JSON.parse(readFileSync(file, "utf8")); if (saved.version !== 1 || !saved.rows || typeof saved.rows !== "object") throw new Error("Unreadable ACP payment ledger; refusing to reset it."); Object.assign(rows, saved.rows); }
  const save = () => { if (!file) return; mkdirSync(dirname(file), { recursive: true }); const temp = `${file}.tmp`, fd = openSync(temp, "w", 0o600); try { writeFileSync(fd, JSON.stringify({ version: 1, rows })); fsyncSync(fd); } finally { closeSync(fd); } if (existsSync(file)) copyFileSync(file, `${file}.bak`); renameSync(temp, file); };
  return async (session: SessionLike, entry: JobRoomEntry): Promise<void> => {
    if (session.job?.description && session.job.description !== cfg.offeringName) return;
    if (session.chainId !== 8453) { await session.sendMessage("This offering accepts USDC on Base only."); return; }
    if (entry.kind === "message" && entry.contentType === "requirement" && session.status === "open") {
      try {
        if (rows[session.jobId]?.request) throw new Error("A payment already exists; resume this funded job instead.");
        const input = JSON.parse(entry.content) as Record<string, unknown>;
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Use a JSON requirement.");
        const requested = Number(input.maxUsd ?? cfg.maxUsd), max = Math.min(requested, cfg.maxUsd);
        if (!Number.isFinite(max) || max <= 0) throw new Error("A positive maxUsd budget is required.");
        let budget: number, quote: SwarmQuote | undefined;
        if (input.service === "swarm") { const { service: _service, maxUsd: _max, ...job } = input; quote = await client.swarmQuote(job as SwarmInput); budget = quote.priceUsd; }
        else { if (!(HOUSE_TOOLS as readonly unknown[]).includes(input.service) || !input.input || typeof input.input !== "object") throw new Error("Choose service=swarm or a documented house tool with input."); const url = new URL(`${client.base}/api/v1/${input.service}`); for (const [k, v] of Object.entries(input.input)) url.searchParams.set(k, String(v)); const t = await client.getTerms(url.href); if (!t) throw new Error("Paid tool terms unavailable."); budget = t.priceUsd; }
        if (budget > max || !Number.isFinite(budget) || budget <= 0) throw new Error("The checked price exceeds the buyer/provider budget.");
        rows[session.jobId] = { input, budget, quote }; save(); await session.setBudget(AssetToken.usdc(budget, session.chainId));
      } catch (e) { await session.sendMessage(`Quote refused: ${(e as Error).message}`); }
      return;
    }
    if (entry.kind !== "system" || entry.event.type !== "job.funded") return;
    if (running.has(session.jobId)) return running.get(session.jobId);
    const run = (async () => {
      try {
        const row = rows[session.jobId]; if (!row) throw new Error("No saved checked requirement; no payment will be signed."); if (row.delivered) return;
        if (!row.request) {
          const opts = { maxUsd: row.budget, sign: options.sign };
          if (row.input.service === "swarm") {
            if (!row.quote || Date.parse(row.quote.expiresAt) <= Date.now()) { const { service: _service, maxUsd: _max, ...job } = row.input; row.quote = await client.swarmQuote(job as SwarmInput); if (row.quote.priceUsd > row.budget) throw new Error("Expired quote now exceeds the funded ACP budget; no payment was signed."); save(); }
            row.request = await client.prepareSwarmOrder(row.quote, opts);
          } else row.request = await client.prepareHouseTool(row.input.service as HouseTool, row.input.input as Record<string, string>, opts);
          save();
        }
        if (!row.order) { const answer = await client.submitPaid(row.request); if (answer.pending || answer.status === "settling") { await session.sendMessage("NIGHTSHIFT settlement pending; the saved authorization will be reused on resume."); return; } row.order = answer; save(); }
        let result: unknown = row.order;
        if (row.input.service === "swarm") {
          const id = row.order!.orderId, token = row.order!.orderToken;
          if (typeof id !== "string" || typeof token !== "string") throw new Error("Private polling receipt unavailable; keep the saved payment for reconciliation.");
          result = await client.pollSwarm(id, token, { intervalMs: options.intervalMs ?? 60_000 });
          if ((result as { refundOwed?: boolean }).refundOwed) { await session.sendMessage("The IMD job failed. Swarm Desk records a refund owed. The provider must reconcile that refund and the ACP escrow; no successful work is claimed."); return; }
          if ((result as { status?: string }).status !== "done") { await session.sendMessage("Work was not delivered. Keep the saved order for reconciliation; no successful work is claimed."); return; }
        }
        await session.submit(JSON.stringify(result)); row.delivered = true; save();
      } catch (e) { await session.sendMessage(`NIGHTSHIFT: ${(e as Error).message}. Resume with the saved request; do not create a replacement payment.`); }
    })().finally(() => running.delete(session.jobId));
    running.set(session.jobId, run); return run;
  };
}
