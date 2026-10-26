import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acpCli, acpCliScript, acpRedact } from "./acp-bridge.js";

const processes = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }));
vi.mock("node:child_process", () => processes);
const dirs: string[] = [];
afterEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) {
    if (!resolve(dir).startsWith(resolve(join(tmpdir(), "nightshift-acp-cli-")))) throw new Error("Unexpected test directory");
    rmSync(dir, { recursive: true, force: true });
  }
});
const tail = ["node_modules", "@virtuals-protocol", "acp-cli", "dist", "bin", "acp.js"];
describe("ACP CLI installation", () => {
  it("prefers the image CLI and falls back to the data volume", () => {
    const exists = vi.fn(() => true);
    expect(acpCliScript("/data", exists)).toBe(join("/opt/acp-cli", ...tail));
    expect(exists).toHaveBeenCalledExactlyOnceWith(join("/opt/acp-cli", ...tail));
    expect(acpCliScript("/data", () => false)).toBe(join("/data/acp-cli", ...tail));
  });

  it("runs Node with argument arrays, one JSON flag, persistent credential paths and suppressed CLI errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightshift-acp-cli-")); dirs.push(dir);
    const script = join(dir, "acp-cli", ...tail); mkdirSync(dirname(script), { recursive: true }); writeFileSync(script, "");
    const pkg = join(dirname(script), "..", "..", "package.json"); writeFileSync(pkg, JSON.stringify({ version: "1.0.40" }));
    for (const key of ["ACP_CONFIG_DIR", "XDG_CONFIG_HOME", "KEYRING_PROPERTY_FILE_PATH"]) vi.stubEnv(key, undefined);
    processes.execFile.mockImplementation((_node: string, _args: string[], _opts: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, '{"status":"pending"}', "privateKey=stderr-sensitive"); return {};
    });
    const runner = acpCli(dir);
    expect(runner.info?.()).toEqual({ found: true, version: "1.0.40" });
    const request = "request; $(echo never-run)";
    await expect(runner.run(["configure", "complete", "--request-id", request, "--json"])).resolves.toEqual({ status: "pending" });
    expect(execFile).toHaveBeenCalledWith(process.execPath, [script, "configure", "complete", "--request-id", request, "--json"], expect.objectContaining({ windowsHide: true, env: expect.objectContaining({ ACP_CONFIG_DIR: join(dir, "acp"), XDG_CONFIG_HOME: join(dir, "acp-xdg"), KEYRING_PROPERTY_FILE_PATH: join(dir, "acp", "keyring.json") }) }), expect.any(Function));
    expect(processes.execFile.mock.calls[0]![2].shell).toBeUndefined();
    await runner.run(["agent", "whoami"]); expect(processes.execFile.mock.calls[1]![1]).toEqual([script, "agent", "whoami", "--json"]);
    processes.execFile.mockImplementation((_node: string, _args: string[], _opts: unknown, callback: (error: Error, stdout: string, stderr: string) => void) => { callback(new Error("token=error-sensitive"), '{"error":"secret=json-sensitive"}', "privateKey=stderr-sensitive"); return {}; });
    await expect(runner.run(["configure", "complete", "--request-id", request])).rejects.toThrow(/^ACP command failed; check server authentication, signer and CLI configuration\.$/);
    writeFileSync(pkg, JSON.stringify({ version: "1.0.41" })); processes.execFile.mockClear();
    expect(() => runner.run(["agent", "whoami"])).toThrow("requires installed CLI 1.0.40"); expect(processes.execFile).not.toHaveBeenCalled();
  });

  it("redacts credential fields, env values, bearer tokens, JWTs, private keys and URL secrets", () => {
    vi.stubEnv("ACP_ACCESS_TOKEN", "env-sensitive");
    const reply = acpRedact(`env-sensitive payload-sensitive token=url-sensitive&publicKey=public-key Bearer bearer-sensitive eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature 0x${"a".repeat(64)}`, { nested: { accessToken: "payload-sensitive" } });
    for (const secret of ["env-sensitive", "payload-sensitive", "url-sensitive", "bearer-sensitive", "eyJ", "a".repeat(64)]) expect(reply).not.toContain(secret);
    expect(reply).toContain("publicKey=public-key");
  });
});
