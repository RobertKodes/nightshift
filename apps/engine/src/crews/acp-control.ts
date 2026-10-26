import { config } from "../config.js";
import { writeSettings } from "../settings.js";
import { liveServices } from "../services/routes.js";
import { liveAcpBridge } from "./acp-bridge.js";

/** Owner controls use the bot's existing private admin gate. */
export async function acpCommand(args: string[]): Promise<string> {
  if (args.length && (args.length !== 1 || !["on", "off"].includes(args[0]!))) return "Use /acp or /acp on | off.";
  if (args.length) writeSettings({ ACP_BRIDGE: args[0] === "on" ? "1" : "0" });
  const bridge = liveAcpBridge() ?? (liveServices(), liveAcpBridge());
  if (!bridge) return "ACP bridge is starting; saved settings apply when it starts.";
  if (args[0] === "off") await bridge.tick();
  if (config.acpBridge) await bridge.tick().catch(() => {});
  const s = bridge.status(), known = (v: boolean | null) => v === null ? "unknown" : v ? "ok" : "unavailable";
  const hidden = s.offerings.filter((o) => o.hidden).length;
  return `<b>Virtuals ACP bridge: ${s.enabled ? "on" : "off"}</b>\nAuth: ${known(s.auth)}; signer: ${known(s.signer)}\nOfferings: ${s.offerings.length ? `${hidden} hidden, ${s.offerings.length - hidden} visible` : "unknown"}\nJobs today: ${s.jobsToday}; running: ${s.running}\nDelivered: ${s.delivered}; rejected: ${s.rejected}\n/acp on | off`;
}
