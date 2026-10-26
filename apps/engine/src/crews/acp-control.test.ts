import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACP_AGENT, ACP_OFFERINGS, ACP_WALLET } from "./acp-bridge.js";
import { acpCommand, type AcpControlDeps } from "./acp-control.js";

vi.mock("../services/routes.js", () => ({ liveServices: vi.fn() }));
const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    if (!resolve(dir).startsWith(resolve(join(tmpdir(), "nightshift-acp-control-")))) throw new Error("Unexpected test directory");
    rmSync(dir, { recursive: true, force: true });
  }
});
const owner = { chat: "1", from: "1", private: true, group: false };
function harness() {
  const dir = mkdtempSync(join(tmpdir(), "nightshift-acp-control-")); dirs.push(dir);
  const h = { authenticated: false, approved: false, signer: false, selected: true, enabled: false, found: true,
    name: "NIGHTSHIFT Swarm Desk", wallet: ACP_WALLET, authAvailable: true };
  const rows = [...Object.keys(ACP_OFFERINGS).map((name, i) => ({ id: `offering-${i}`, name, isHidden: true })),
    { id: "unrelated", name: "IMD Swarm: unrelated", isHidden: true }];
  const run = vi.fn(async (args: string[]): Promise<unknown> => {
    const cmd = args.slice(0, 2).join(" ");
    if (cmd === "configure start") return { url: "https://app.virtuals.io/sign-in?request=phone&access_token=access-sensitive", requestId: "auth-request", accessToken: "access-sensitive", refreshToken: "refresh-sensitive" };
    if (cmd === "configure complete") return { status: h.authenticated ? "authenticated" : "pending", token: "token-sensitive" };
    if (cmd === "agent use") { h.selected = true; return { success: true }; }
    if (cmd === "agent whoami") {
      if (!h.authAvailable || !h.selected) throw new Error("accessToken=whoami-sensitive");
      return { id: ACP_AGENT, walletAddress: h.wallet, name: h.name, accessToken: "name-sensitive", privateKey: "private-sensitive" };
    }
    if (cmd === "agent list") { if (!h.authAvailable) throw new Error("token=list-sensitive"); return []; }
    if (cmd === "agent add-signer") return { signerUrl: "https://app.virtuals.io/signer?request=signer-request&publicKey=public-key", requestId: "signer-request", publicKey: "public-key", privateKey: "private-sensitive" };
    if (cmd === "agent signer-status") { if (h.approved) h.signer = true; return { status: h.approved ? "completed" : "pending", secret: "signer-sensitive" }; }
    if (cmd === "job list") { if (!h.signer) throw new Error("privateKey=job-sensitive"); return { jobs: [] }; }
    if (cmd === "offering list") return rows.map((o) => ({ ...o, apiKey: "offering-sensitive" }));
    if (cmd === "offering update") { rows.find((o) => o.id === args[args.indexOf("--offering-id") + 1])!.isHidden = args.includes("--hidden"); return { success: true, token: "update-sensitive" }; }
    throw new Error("Unexpected CLI command");
  });
  const tick = vi.fn(async () => {}), setEnabled = vi.fn((on: boolean) => { h.enabled = on; });
  const d: AcpControlDeps = { file: join(dir, "acp-setup.json"), owners: ["1"], runner: { run, listen: vi.fn(), info: () => ({ found: h.found, version: h.found ? "1.0.40" : null }) }, setEnabled,
    bridge: () => ({ tick, status: () => ({ enabled: h.enabled, auth: null, signer: null, offerings: [], jobsToday: 4, running: 1, delivered: 2, rejected: 1 }) }) };
  return { h, d, run, rows, tick, setEnabled, command: (args: string[]) => acpCommand(args, owner, d), state: () => JSON.parse(readFileSync(d.file, "utf8")) };
}

describe("ACP phone setup controls", () => {
  it("saves the auth request across calls, polls it, and never saves or replies with tokens", async () => {
    const x = harness();
    expect(await x.command(["setup", "done"])).toContain("setup first"); expect(x.run).not.toHaveBeenCalled();
    const start = await x.command(["setup"]);
    expect(x.run).toHaveBeenLastCalledWith(["configure", "start", "--json"]);
    expect(start).toContain("Open this on your phone and sign in"); expect(start).toContain("https://app.virtuals.io/sign-in?request=phone&amp;access_token=[redacted]");
    expect(start).not.toContain("access-sensitive"); expect(x.state()).toEqual({ requestId: "auth-request" });
    expect(await acpCommand(["setup", "done"], owner, { ...x.d })).toContain("pending");
    expect(x.run).toHaveBeenLastCalledWith(["configure", "complete", "--request-id", "auth-request", "--json"]);
    expect(x.state().requestId).toBe("auth-request");
    x.h.authenticated = true;
    expect(await x.command(["setup", "done"])).toBe("ACP authenticated. Send /acp agent."); expect(x.state()).toEqual({});
    expect(x.tick).not.toHaveBeenCalled();
  });

  it("selects only the fixed agent, replies with its name and wallet, and redacts and escapes public fields", async () => {
    const x = harness(); x.h.name = '<Desk> token=name-sensitive privateKey=private-sensitive';
    const reply = await x.command(["agent"]);
    expect(x.run.mock.calls.map(([args]) => args)).toEqual([["agent", "use", "--agent-id", ACP_AGENT, "--json"], ["agent", "whoami", "--json"]]);
    expect(reply).toContain("&lt;Desk&gt;"); expect(reply).toContain(ACP_WALLET); expect(reply).toContain("[redacted]");
    expect(reply).not.toContain("name-sensitive"); expect(reply).not.toContain("private-sensitive");
    x.h.wallet = "0x1111111111111111111111111111111111111111";
    expect(await x.command(["agent"])).toContain("not NIGHTSHIFT");
  });

  it("requests a restricted server signer, persists the split flow and confirms identity and the local signer", async () => {
    const x = harness(), start = await x.command(["signer"]);
    expect(x.run).toHaveBeenLastCalledWith(["agent", "add-signer", "--agent-id", ACP_AGENT, "--policy", "restricted", "--no-wait", "--json"]);
    expect(start).toContain("expires in 5 minutes"); expect(start).toContain("https://app.virtuals.io/signer?"); expect(start).not.toContain("private-sensitive");
    expect(x.state()).toEqual({ signer: { requestId: "signer-request", publicKey: "public-key" } });
    expect(await x.command(["signer", "done"])).toContain("pending");
    expect(x.run).toHaveBeenLastCalledWith(["agent", "signer-status", "--agent-id", ACP_AGENT, "--request-id", "signer-request", "--public-key", "public-key", "--json"]);
    x.h.approved = true;
    expect(await acpCommand(["signer", "done"], owner, { ...x.d })).toContain("Server signer present");
    expect(x.run.mock.calls.slice(-2).map(([args]) => args)).toEqual([["agent", "whoami", "--json"], ["job", "list", "--json"]]);
    expect(x.state()).toEqual({});
  });

  it("never treats owner authentication alone as a local signer", async () => {
    const x = harness();
    expect(await x.command(["signer", "done"])).not.toContain("Server signer present");
    expect(await x.command(["status"])).toContain("signer present: no");
  });

  it.each(["visible", "hide"])("sets %s only for the nine exact offerings and verifies the result", async (verb) => {
    const x = harness(); x.rows.forEach((o) => { o.isHidden = verb === "visible"; });
    expect(await x.command([verb])).toContain(`All 9 IMD Swarm offerings are ${verb === "visible" ? "visible" : "hidden"}`);
    const updates = x.run.mock.calls.filter(([args]) => args[1] === "update").map(([args]) => args);
    expect(updates).toEqual(Object.keys(ACP_OFFERINGS).map((_, i) => ["offering", "update", "--offering-id", `offering-${i}`, verb === "visible" ? "--no-hidden" : "--hidden", "--json"]));
    expect(x.rows.at(-1)?.isHidden).toBe(verb === "visible");
    expect(x.run).toHaveBeenLastCalledWith(["offering", "list", "--json"]);
  });

  it("refuses missing offerings or another agent before visibility changes", async () => {
    const x = harness(); x.rows.shift();
    expect(await x.command(["visible"])).toContain("No visibility changes made");
    expect(x.run.mock.calls.some(([args]) => args[1] === "update")).toBe(false);
    x.h.wallet = "another wallet"; x.run.mockClear();
    expect(await x.command(["hide"])).toContain("/acp agent first"); expect(x.run).toHaveBeenCalledTimes(1);
  });

  it("reports current CLI, auth, identity, signer, visibility and jobs while the bridge is off", async () => {
    const x = harness(); x.h.signer = true;
    const reply = await x.command([]);
    for (const field of ["bridge: off", "CLI: found; version 1.0.40", "Authenticated: yes", "agent selected: NIGHTSHIFT Swarm Desk", "signer present: yes", "9 hidden, 0 visible (9/9)", "Jobs today: 4; running: 1", "Delivered: 2; rejected: 1"]) expect(reply).toContain(field);
    expect(x.tick).not.toHaveBeenCalled();
    x.h.selected = false; expect(await x.command(["status"])).toContain("Authenticated: yes; agent selected: no");
    expect(x.run).toHaveBeenLastCalledWith(["agent", "list", "--json"]);
    x.h.authAvailable = false; expect(await x.command(["status"])).toContain("Authenticated: no");
    x.h.found = false; x.run.mockClear(); expect(await x.command(["status"])).toContain("CLI: not found"); expect(x.run).not.toHaveBeenCalled();
  });

  it("retains the existing on/off controls and rejects malformed commands", async () => {
    const x = harness();
    for (const verb of ["on", "off"]) { expect(await x.command([verb])).toContain(`bridge: ${verb}`); expect(x.setEnabled).toHaveBeenLastCalledWith(verb === "on"); }
    expect(x.tick).toHaveBeenCalledTimes(2); x.run.mockClear();
    for (const args of [["setup", "extra"], ["signer", "--policy", "unrestricted"], ["status", "extra"], ["agent", "another"]]) expect(await x.command(args)).toContain("/acp setup");
    expect(x.run).not.toHaveBeenCalled();
  });

  it("refuses non-owner or non-private contexts before any CLI or persistence action", async () => {
    const x = harness();
    for (const ctx of [undefined, { ...owner, private: false }, { ...owner, group: true }, { ...owner, from: "2" }, { ...owner, chat: "2", from: "2" }, { ...owner, chat: "-1", from: "-1" }]) {
      for (const args of [[], ["setup"], ["setup", "done"], ["agent"], ["signer"], ["signer", "done"], ["visible"], ["hide"], ["on"], ["off"]]) expect(await acpCommand(args, ctx, x.d)).toContain("owner's private chat");
    }
    expect(x.run).not.toHaveBeenCalled(); expect(x.setEnabled).not.toHaveBeenCalled(); expect(x.tick).not.toHaveBeenCalled();
  });

  it("suppresses raw CLI failures in every command and log", async () => {
    const x = harness(), log = vi.spyOn(console, "log"), error = vi.spyOn(console, "error");
    x.run.mockRejectedValue(new Error("Bearer failed-sensitive privateKey=private-sensitive token=token-sensitive"));
    for (const args of [["setup"], ["agent"], ["signer"], ["signer", "done"], ["visible"], ["hide"], ["status"]]) {
      const reply = await x.command(args);
      for (const secret of ["failed-sensitive", "private-sensitive", "token-sensitive"]) expect(reply).not.toContain(secret);
    }
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
});
