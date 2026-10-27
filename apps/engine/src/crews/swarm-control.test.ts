import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "swarm-control-")); vi.stubEnv("DATA_DIR", dir); vi.stubEnv("SWARM_DESK_DAILY_IMD", ""); vi.stubEnv("SWARM_DESK_IN_FLIGHT", ""); vi.stubEnv("SWARM_IMD_FLOAT", ""); });
afterAll(() => { vi.unstubAllEnvs(); if (!resolve(dir).startsWith(resolve(join(tmpdir(), "swarm-control-")))) throw new Error("Unexpected directory"); rmSync(dir, { recursive: true, force: true }); });
it("persists owner caps and on/off controls, exposes defaults and rejects malformed limits", async () => {
  const { config } = await import("../config.js"), { swarmCommand } = await import("./swarm-control.js");
  expect(config.swarmDeskDailyImd).toBe(100); expect(config.swarmDeskInFlight).toBe(25); expect(config.swarmImdFloat).toBe(5);
  await swarmCommand(["cap", "750"]); await swarmCommand(["inflight", "80"]); await swarmCommand(["on"]);
  expect(config.swarmDeskDailyImd).toBe(750); expect(config.swarmDeskInFlight).toBe(80); expect(config.swarmDesk).toBe(true);
  expect(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"))).toMatchObject({ SWARM_DESK_DAILY_IMD: "750", SWARM_DESK_IN_FLIGHT: "80", SWARM_DESK: "1" });
  for (const args of [["cap", "Infinity"], ["cap", "-1"], ["inflight", "1.5"], ["inflight", "0"]]) expect(await swarmCommand(args)).toContain("Use /swarm");
  expect(config.swarmDeskDailyImd).toBe(750); expect(config.swarmDeskInFlight).toBe(80); await swarmCommand(["off"]); expect(config.swarmDesk).toBe(false);
}, 20_000);


it("acknowledges a confirmed manual refund without sending money", async () => {
  const { setSwarmDesk } = await import("./swarm.js"), { swarmCommand } = await import("./swarm-control.js");
  const confirmRefund = vi.fn();
  setSwarmDesk({ confirmRefund, stop() {} } as unknown as import("./swarm.js").SwarmDesk);
  try {
    const tx = `0x${"ab".repeat(32)}`;
    expect(await swarmCommand(["refund", "sd_order", tx])).toContain("No payment was sent");
    expect(confirmRefund).toHaveBeenCalledWith("sd_order", tx);
  } finally { setSwarmDesk(null); }
});
