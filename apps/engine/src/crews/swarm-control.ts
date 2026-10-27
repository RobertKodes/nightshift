import { config } from "../config.js";
import { writeSettings } from "../settings.js";
import { liveServices } from "../services/routes.js";
import { liveSwarmDesk } from "./swarm.js";

/** Owner-only bot controls, dispatched through the existing admin command gate. */
export async function swarmCommand(args: string[]): Promise<string> {
  const [verb, value] = args;
  if (verb === "refund" && args.length === 3) {
    const desk = liveSwarmDesk() ?? (liveServices(), liveSwarmDesk());
    if (!desk) return "Swarm Desk is starting; try again in a minute.";
    desk.confirmRefund(value!, args[2]!);
    return "Confirmed refund receipt recorded. No payment was sent by this command.";
  }
  if (verb === "cap" || verb === "inflight") {
    const n = Number(value);
    if (args.length !== 2 || !value || !/^\d+(?:\.\d{1,6})?$/.test(value) || !Number.isFinite(n) || n < (verb === "cap" ? 0 : 1) || n > (verb === "cap" ? 100_000 : 1000) || (verb === "inflight" && !Number.isInteger(n))) return "Use /swarm cap <0..100000 IMD> or /swarm inflight <1..1000 whole jobs>.";
    writeSettings({ [verb === "cap" ? "SWARM_DESK_DAILY_IMD" : "SWARM_DESK_IN_FLIGHT"]: value });
  } else if (verb === "on" || verb === "off") {
    if (args.length !== 1) return "Use /swarm on or /swarm off.";
    writeSettings({ SWARM_DESK: verb === "on" ? "1" : "0" });
  } else if (args.length) return "Use /swarm, /swarm cap <IMD>, /swarm inflight <jobs>, or /swarm on | off.";
  const desk = liveSwarmDesk() ?? (liveServices(), liveSwarmDesk());
  if (!desk) return "Swarm Desk is starting; try again in a minute. Saved settings will apply when it starts.";
  const queue = desk.revenue().filter((o) => o.refundOwed && !o.refundPaid);
  const stats = await desk.stats(), refill = stats.desk.refill as { imd?: string | null; eth?: string | null; floatImd?: string; revenueUsd?: number; unspentUsd?: number; active?: string | null; refills?: { kind: string; phase: string; usd: number }[] } | null;
  return `<b>Swarm Desk · ${stats.desk.enabled ? "on" : "off"}</b>\nIMD: ${refill?.imd ?? "unavailable"} · reserved ${stats.desk.reservedImd}\nEthereum ETH: ${refill?.eth ?? "unavailable"} · float ${config.swarmImdFloat} IMD\nIn flight: ${stats.desk.running}/${stats.desk.maxInFlight} · today ${stats.desk.todayJobs} jobs\nDaily ceiling: ${stats.desk.dailyImd} IMD\nRevenue after reserve: $${(refill?.revenueUsd ?? 0).toFixed(6)} · unspent $${(refill?.unspentUsd ?? 0).toFixed(6)}\nRefunds owed: ${stats.desk.refundsOwed}\n${queue.map((o) => `${o.orderId}: $${(Number(o.units) / 1e6).toFixed(6)}, payment ${o.tx}`).join("\n")}\nRefill: ${refill?.active ? "in flight; no replacement will be sent" : "idle"}\n${refill?.refills?.slice(-3).map((r) => `${r.kind}: ${r.phase}, $${r.usd.toFixed(6)}`).join("\n") ?? ""}\n/swarm cap &lt;IMD&gt; · /swarm inflight &lt;jobs&gt; · /swarm on | off`;
}
