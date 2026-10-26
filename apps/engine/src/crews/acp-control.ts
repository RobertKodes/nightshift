import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeAtomic } from "../atomic.js";
import { config } from "../config.js";
import { writeSettings } from "../settings.js";
import { liveServices } from "../services/routes.js";
import { esc, type CommandContext } from "../social.js";
import { ACP_AGENT, ACP_OFFERINGS, ACP_WALLET, acpCli, acpRedact, liveAcpBridge, type AcpBridge, type AcpRunner } from "./acp-bridge.js";

type Setup = { requestId?: string; signer?: { requestId: string; publicKey: string } };
export type AcpControlDeps = { runner: AcpRunner; file: string; owners: string[]; bridge(): Pick<AcpBridge, "status" | "tick"> | null; setEnabled(on: boolean): void };
const defaults: AcpControlDeps = { runner: acpCli(config.dataDir), file: join(config.dataDir, "acp-setup.json"), owners: config.telegramAdmins,
  bridge: () => liveAcpBridge() ?? (liveServices(), liveAcpBridge()), setEnabled: (on) => { writeSettings({ ACP_BRIDGE: on ? "1" : "0" }); } };
const help = "/acp status · /acp setup · /acp setup done · /acp agent · /acp signer · /acp signer done · /acp visible · /acp hide · /acp on | off";
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const identity = (v: unknown) => { const who = obj(v); return who.id === ACP_AGENT && String(who.walletAddress).toLowerCase() === ACP_WALLET; };
const required = (v: unknown): string => { if (typeof v !== "string" || !v || v.length > 4096) throw new Error("Invalid CLI response"); return v; };
const url = (v: unknown, source: unknown): string => {
  const value = required(v), parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Invalid approval URL");
  return esc(acpRedact(value, source));
};
const offerings = (v: unknown) => {
  if (!Array.isArray(v)) throw new Error("Invalid offerings");
  return v.map(obj).filter((o) => typeof o.name === "string" && Object.hasOwn(ACP_OFFERINGS, o.name));
};

/** Only the configured owner's own private chat may operate or see the CLI. */
export async function acpCommand(args: string[], ctx?: CommandContext, d: AcpControlDeps = defaults): Promise<string> {
  if (!ctx?.private || ctx.group || ctx.chat !== ctx.from || !d.owners.includes(ctx.chat) || Number(ctx.chat) <= 0) return "ACP controls require the owner's private chat.";
  const verb = args.join(" ");
  if (!["", "status", "setup", "setup done", "agent", "signer", "signer done", "visible", "hide", "on", "off"].includes(verb)) return help;
  const run = (args: string[]) => d.runner.run([...args, "--json"]);
  const load = (): Setup => {
    if (!existsSync(d.file)) return {};
    const state = obj(JSON.parse(readFileSync(d.file, "utf8")));
    if (state.requestId !== undefined) required(state.requestId);
    if (state.signer !== undefined) { required(obj(state.signer).requestId); required(obj(state.signer).publicKey); }
    return state as Setup;
  };
  const save = (state: Setup) => { mkdirSync(dirname(d.file), { recursive: true }); writeAtomic(d.file, JSON.stringify(state), { mode: 0o600 }); };
  try {
    if (verb === "setup") {
      const state = load(), result = obj(await run(["configure", "start"]));
      const link = url(result.url, result);
      state.requestId = required(result.requestId); save(state);
      return `Open this on your phone and sign in:\n${link}\nThen send /acp setup done.`;
    }
    if (verb === "setup done") {
      const state = load();
      if (!state.requestId) return "Send /acp setup first.";
      const result = obj(await run(["configure", "complete", "--request-id", state.requestId]));
      if (result.status !== "authenticated") return "Sign-in pending. Finish on your phone, then send /acp setup done again.";
      delete state.requestId; save(state);
      return "ACP authenticated. Send /acp agent.";
    }
    if (verb === "agent") {
      await run(["agent", "use", "--agent-id", ACP_AGENT]);
      const who = obj(await run(["agent", "whoami"]));
      if (!identity(who)) return "ACP active agent is not NIGHTSHIFT Swarm Desk. Check /acp agent before continuing.";
      return `Agent: ${esc(acpRedact(typeof who.name === "string" ? who.name : "NIGHTSHIFT Swarm Desk", who))}\nWallet: ${ACP_WALLET}\nSend /acp signer.`;
    }
    if (verb === "signer") {
      const state = load(), result = obj(await run(["agent", "add-signer", "--agent-id", ACP_AGENT, "--policy", "restricted", "--no-wait"]));
      const link = url(result.signerUrl, result);
      state.signer = { requestId: required(result.requestId), publicKey: required(result.publicKey) }; save(state);
      return `Approve the server signer on your phone (expires in 5 minutes):\n${link}\nThen send /acp signer done.`;
    }
    if (verb === "signer done") {
      const state = load();
      if (state.signer) {
        const result = obj(await run(["agent", "signer-status", "--agent-id", ACP_AGENT, "--request-id", state.signer.requestId, "--public-key", state.signer.publicKey]));
        if (result.status !== "completed") return "Signer approval pending. Approve on your phone, then send /acp signer done again.";
      }
      if (!identity(await run(["agent", "whoami"]))) return "Select NIGHTSHIFT Swarm Desk with /acp agent first.";
      // whoami checks owner authentication and identity; job list also requires the local signer.
      await run(["job", "list"]);
      delete state.signer; save(state);
      return "Server signer present for NIGHTSHIFT Swarm Desk. Use /acp status.";
    }
    if (verb === "visible" || verb === "hide") {
      if (!identity(await run(["agent", "whoami"]))) return "Select NIGHTSHIFT Swarm Desk with /acp agent first.";
      const rows = offerings(await run(["offering", "list"]));
      if (Object.keys(ACP_OFFERINGS).some((name) => rows.filter((o) => o.name === name).length !== 1) || new Set(rows.map((o) => o.id)).size !== 9 || rows.some((o) => typeof o.id !== "string" || !o.id)) return "Expected exactly the nine IMD Swarm offerings with unique names and IDs. No visibility changes made.";
      for (const row of rows) await run(["offering", "update", "--offering-id", row.id as string, verb === "hide" ? "--hidden" : "--no-hidden"]);
      const checked = offerings(await run(["offering", "list"]));
      if (checked.length !== 9 || checked.some((o) => o.isHidden !== (verb === "hide"))) return "Offering visibility is not fully confirmed. Check /acp status and retry the command.";
      return `All 9 IMD Swarm offerings are ${verb === "hide" ? "hidden" : "visible"}.`;
    }
    if (verb === "on" || verb === "off") {
      d.setEnabled(verb === "on");
      await d.bridge()?.tick().catch(() => {});
    }
    const cli = d.runner.info?.(), s = d.bridge()?.status();
    let auth: boolean | null = null, selected = false, signer = false, rows: Record<string, unknown>[] | null = null;
    if (cli?.found !== false) {
      try { selected = identity(await run(["agent", "whoami"])); auth = true; }
      catch { try { await run(["agent", "list"]); auth = true; } catch { auth = false; } }
      if (selected) {
        try { await run(["job", "list"]); signer = true; } catch { /* No raw CLI errors in replies or logs. */ }
        try { rows = offerings(await run(["offering", "list"])); } catch { /* Authentication may have expired. */ }
      }
    }
    const hidden = rows?.filter((o) => o.isHidden === true).length ?? 0;
    return `<b>Virtuals ACP bridge: ${s?.enabled ? "on" : "off"}</b>\nCLI: ${cli?.found ? `found; version ${cli.version ?? "unknown"}` : cli ? "not found" : "unknown"}\nAuthenticated: ${auth === null ? "unknown" : auth ? "yes" : "no"}; agent selected: ${selected ? "NIGHTSHIFT Swarm Desk" : "no"}; signer present: ${signer ? "yes" : "no"}\nOfferings: ${rows ? `${hidden} hidden, ${rows.filter((o) => o.isHidden === false).length} visible (${rows.length}/9)` : "unknown"}\nJobs today: ${s?.jobsToday ?? 0}; running: ${s?.running ?? 0}\nDelivered: ${s?.delivered ?? 0}; rejected: ${s?.rejected ?? 0}\n${help}`;
  } catch (e) { return `ACP command failed. ${String((e as Error).message ?? "").startsWith("ACP command failed: ") ? `Reason: ${(e as Error).message.slice(20, 220)}. ` : ""}Use /acp status; retry /acp setup or /acp signer if approval expired. No credentials are shown.`; }
}
